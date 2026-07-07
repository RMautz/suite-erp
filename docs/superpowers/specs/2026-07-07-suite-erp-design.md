# Diseño: Suite ERP — SaaS multi-empresa para pymes chilenas

**Fecha:** 2026-07-07
**Estado:** Aprobado por el usuario (diseño validado sección por sección)
**Nombre provisorio:** "Suite ERP" (se renombra cuando exista marca/dominio definitivo)

## 1. Propósito

Producto SaaS comercial para el mercado chileno, inspirado en la suite de Defontana
(defontana.com/cl): un conjunto de productos de gestión empresarial en la nube que
comparten login, datos y diseño. Multi-tenant: muchas empresas clientes sobre la misma
plataforma. La visión es la suite completa; la construcción es por fases, cada fase
termina con software en producción.

### Decisiones fundacionales (respuestas del usuario)

| Decisión | Elección |
|---|---|
| Propósito | SaaS comercial multi-empresa |
| Alcance | Suite completa como visión, construida por fases |
| Emisión DTE (SII) | Vía proveedor autorizado de terceros (API), no motor propio |
| Stack | Next.js + Supabase (Postgres, Auth, Storage, RLS) |
| Monetización v1 | Planes definidos + trial 14 días + activación manual de pagos |
| Dominio | Aún no existe; deploy inicial en subdominio Vercel, dominio `.cl` después |
| Arquitectura | B: Multi-aplicación estilo Defontana, en versión pragmática (monorepo + datos compartidos) |

## 2. La suite y sus productos

| Producto | Equivalente Defontana | Qué hace | Fase |
|---|---|---|---|
| **ERP** (núcleo) | ERP Genesis/Sapiens | Ventas, facturación electrónica SII, compras, inventario, clientes/proveedores, reportes | 1 |
| **Portal web** | defontana.com | Sitio comercial: productos, precios, registro self-service, trial | 1 |
| **Admin** | (interno) | Panel del dueño del SaaS: clientes, planes, activaciones, métricas | 1 |
| **Contabilidad** | Booker | Plan de cuentas, libros, comprobantes, balances, multi-empresa para contadores | 2 |
| **RRHH** | Zenda | Remuneraciones, contratos, liquidaciones, asistencia, portal del empleado | 3 |
| **POS** | Tivendo | Punto de venta con stock en tiempo real, integrado al ERP | 4 |
| **CRM** | CRM Defontana | Oportunidades, pipeline de ventas | 4 |

**Fase 5:** cobro automático de suscripciones (pasarela chilena), API pública,
integraciones (bancos, e-commerce), agentes IA.

Cada producto vive en su propio subdominio (`erp.`, `conta.`, `rrhh.`, `pos.`, `crm.`,
`admin.`, `www.`) con sesión compartida (SSO), replicando la estructura comercial
multi-producto de Defontana.

## 3. Arquitectura técnica

### 3.1 Monorepo

Turborepo + pnpm:

```
suite-erp/
├── apps/
│   ├── web/        → Portal comercial (www.) — Next.js
│   ├── erp/        → App ERP (erp.) — Next.js
│   ├── admin/      → Panel interno (admin.) — Next.js
│   └── (fase 2+)   → conta/, rrhh/, pos/, crm/
├── packages/
│   ├── ui/         → Design system compartido (componentes, tablas, formularios)
│   ├── db/         → Tipos generados de Supabase + queries compartidas
│   ├── auth/       → Sesión compartida / SSO entre subdominios
│   ├── core/       → Lógica de negocio pura (RUT, IVA, montos CLP, folios)
│   └── dte/        → Adaptador del proveedor DTE (interfaz intercambiable)
└── supabase/       → Migraciones SQL, políticas RLS, Edge Functions
```

### 3.2 Decisiones clave

1. **Una sola base Supabase para toda la suite.** Las apps son frontends distintos
   sobre la misma plataforma de datos. Aislamiento entre clientes por RLS. Se obtiene
   la estructura multi-app sin duplicar datos ni sincronizar entre servicios.
2. **SSO entre subdominios.** Supabase Auth con cookie a nivel `.dominio.cl`. Login
   único; los productos visibles dependen de los módulos del plan contratado.
3. **Server-first.** Mutaciones de negocio solo vía Server Actions / Route Handlers.
   Lecturas simples pueden usar el cliente Supabase con RLS. Nada crítico corre en el
   navegador.
4. **Deploy en Vercel**, un proyecto por app, cada uno con su subdominio. Supabase
   plan Pro al tener clientes reales (backups diarios). Proyectos Supabase separados
   para desarrollo y producción.
5. **Adaptador DTE aislado** en `packages/dte` con interfaz propia
   (`emitirDocumento()`, `consultarEstado()`, `anular()`). El proveedor concreto
   (LibreDTE / SimpleAPI / Openfactura — se elige en implementación por precio,
   sandbox y cobertura de documentos) queda detrás de la interfaz; migrar de
   proveedor o a motor propio no toca el resto del sistema.

### 3.3 Flujo de referencia: emitir una factura

Usuario completa la venta en `erp/` → Server Action valida stock y datos → documento
en estado `borrador` → llamada a `packages/dte` → proveedor timbra ante SII →
documento pasa a `emitido` (folio, track-id, XML y PDF en Supabase Storage) →
descuento de stock + asiento pendiente para el futuro módulo contable. Si el
proveedor falla, el documento queda `pendiente_envio` con reintentos automáticos:
nunca se pierde una venta por caída del proveedor o del SII.

## 4. Modelo de datos y multi-tenancy

### 4.1 Nivel plataforma (el SaaS)

- `organizaciones` — la cuenta que paga: RUT, razón social, plan, estado
  (`trial`, `activa`, `suspendida`).
- `planes` — Básico / Pro / Empresa: precio CLP, módulos incluidos, límites
  (usuarios, documentos/mes, bodegas).
- `suscripciones` — historial de plan por organización, fechas, activación manual.
- `usuarios` (Supabase Auth) + `miembros` — vínculo usuario↔organización con rol:
  `dueño`, `admin`, `vendedor`, `contador`, `bodeguero`. Un usuario puede pertenecer
  a varias organizaciones (caso contadores).
- `empresas` — empresas operativas dentro de una organización (multi-empresa: una
  cuenta administra varios RUT). Toda la data operacional cuelga de `empresa_id`.

### 4.2 Nivel ERP (todas las tablas con `empresa_id` + RLS)

- **Maestros:** `productos` (SKU, código de barras, precios neto/bruto, afecto/exento
  IVA, categorías, unidad), `clientes`, `proveedores` (RUT con dígito verificador,
  giro, dirección, comuna, contactos, condición de pago), `bodegas`, `sucursales`.
- **Ventas:** `documentos_venta` + `documentos_venta_lineas`. Tipos: cotización, nota
  de venta, factura electrónica (33), boleta (39), nota de crédito (61), nota de
  débito (56), guía de despacho (52). Notas de crédito/débito con referencia
  obligatoria al documento original (exigencia SII). Estados DTE:
  `borrador → pendiente_envio → enviado → aceptado / rechazado / reparo`.
- **Compras:** `ordenes_compra`, `documentos_compra` (con recepción de mercadería).
- **Inventario:** `movimientos_stock` — libro inmutable (entrada, salida, ajuste,
  traslado); el stock actual es una vista materializada, nunca un número editable.
  `ajustes_inventario` con motivo.
- **Pagos:** pagos recibidos/realizados contra documentos; cuentas por cobrar/pagar.
- **Config Chile:** IVA 19% parametrizado, CLP en enteros (sin decimales), tabla de
  valores UF/UTM, correlativos de folios por tipo de documento.

### 4.3 Seguridad de datos

- **RLS en toda tabla operacional:** `empresa_id IN (empresas de organizaciones donde
  el usuario es miembro activo)`, más restricciones por rol (ej. solo `dueño`/`admin`
  anula documentos).
- El panel Admin usa `service_role` únicamente desde el servidor.
- **Tests de aislamiento multi-tenant en CI:** verifican que la organización A jamás
  lea datos de la B.
- `auditoria` — quién, qué, cuándo, valores antes/después, para toda mutación de
  documentos y stock. La impersonación desde Admin queda registrada aquí.

## 5. Funcionalidad v1

### 5.1 App ERP (`erp.`)

- **Dashboard:** ventas día/mes, documentos emitidos, top productos, stock crítico,
  cuentas por cobrar vencidas.
- **Ventas:** cotización → nota de venta → documento tributario (33/39/61/56/52).
  Envío de PDF por correo al cliente. Lista con filtros por estado SII, cliente, fecha.
- **Productos e inventario:** CRUD con categorías y códigos de barras; stock por
  bodega en tiempo real; ajustes y traslados; alertas de stock mínimo; **import
  masivo desde Excel/CSV** (crítico para migrar clientes desde otro sistema).
- **Compras:** orden de compra → recepción (suma stock) → factura de proveedor.
- **Clientes/Proveedores:** CRUD con validación de RUT; estado de cuenta por cliente.
- **Pagos/Cobranza:** registro de pagos (efectivo, transferencia, tarjeta) contra
  documentos; cuentas por cobrar/pagar. Conciliación bancaria automática: fase 2.
- **Reportes:** libros de compra y venta (formato SII), ventas por
  período/vendedor/producto, valorización de inventario. Export a Excel.
- **Configuración:** datos de empresa (RUT, giro, logo, certificado digital para el
  proveedor DTE), usuarios/invitaciones con roles, numeración de documentos, soporte
  impresora térmica 80mm para boletas.

### 5.2 Portal web (`www.`)

Landing estilo Defontana: productos, precios, página por producto, registro
self-service con **trial de 14 días** (crea organización + empresa + usuario dueño en
un paso), login. Sin pasarela de pago: vencido el trial la app muestra aviso y el
plan se activa manualmente desde Admin tras confirmar transferencia.

### 5.3 App Admin (`admin.`)

Organizaciones con estado y plan; activar/suspender/extender trial; métricas
(registros, conversión, documentos emitidos); impersonar organización para soporte
(auditado); gestión del catálogo de planes.

### 5.4 Explícitamente fuera de v1

Contabilidad, remuneraciones, POS, CRM, cobro automático, app móvil, API pública,
multi-moneda, e-commerce, conciliación bancaria. Todo está en el roadmap de fases,
no en v1.

## 6. Manejo de errores

- **Transaccionalidad:** toda operación de negocio es atómica (función Postgres o
  transacción en Server Action). Jamás stock descontado sin documento ni viceversa.
- **Emisión DTE asíncrona con reintentos:** documento `pendiente_envio` + reintento
  exponencial (pg_cron / Edge Function). Se puede seguir vendiendo con el proveedor
  DTE o el SII caídos; el sistema reconcilia estados por track-id.
- **Idempotencia** en emisión (clave única por operación): un doble clic o reintento
  no genera dos facturas.
- **Mensajes:** validaciones en español claro para el usuario; errores técnicos a
  Sentry con contexto, nunca mostrados en crudo.

## 7. Testing

- **Unitario (Vitest), con TDD estricto en `packages/core`:** validador de RUT,
  cálculo de IVA y totales, redondeos CLP, correlativos de folios. Un error de
  cálculo en una factura es un problema legal.
- **Integración:** tests de aislamiento RLS multi-tenant contra Supabase local en CI
  (GitHub Actions).
- **E2E (Playwright):** registro → crear producto → vender → emitir documento
  (sandbox del proveedor DTE) → verificar stock y PDF.
- **`packages/dte`:** tests contra mock del proveedor + suite de contrato contra su
  sandbox.

## 8. Seguridad y cumplimiento

RLS como última línea de defensa; 2FA opcional; rate-limiting en endpoints públicos;
certificados digitales de clientes cifrados en reposo (Supabase Vault); backups
diarios con prueba de restauración; HTTPS forzado y headers CSP. Cumplimiento Ley
19.628 (protección de datos personales, Chile): política de privacidad y términos de
servicio en el portal.

## 9. Puesta en línea

1. **CI/CD:** push a `main` → tests → deploy automático a Vercel; previews por rama.
2. **Lanzamiento inicial** en subdominios `*.vercel.app` con proyecto Supabase
   productivo separado del de desarrollo.
3. **Dominio definitivo:** comprar `.cl` en NIC Chile; apuntar DNS a Vercel;
   configurar subdominios (`www`, `erp`, `admin`) y cookie SSO `.dominio.cl`.
   Migración estimada en ~1 hora, sin cambios de arquitectura.

## 10. Criterio de éxito de v1

Una pyme chilena real puede: registrarse sola, configurar su empresa con su
certificado digital, cargar sus productos por Excel, vender, emitir una factura
electrónica legalmente válida ante el SII, registrar el pago y ver su stock y sus
libros — sin intervención manual del operador del SaaS más allá de activar el plan.
