# Diseño: Plan 3 — Ventas + Facturación Electrónica (DTE) ante el SII

**Fecha:** 2026-07-09
**Estado:** Aprobado por el usuario
**Fase:** 1 del roadmap (el ERP núcleo); tercer plan de implementación tras Fundación (Plan 1) y Maestros (Plan 2).

## 1. Propósito

Emitir documentos tributarios electrónicos (DTE) legalmente válidos ante el SII de Chile desde el ERP, usando los productos y clientes que ya existen (Plan 2). Es el módulo por el que una pyme chilena paga: facturar de verdad. Toda la construcción y verificación es contra el **ambiente de certificación** del proveedor; el paso a producción es un cambio de configuración.

## 2. Decisiones fundacionales (aprobadas por el usuario)

| Decisión | Elección |
|---|---|
| Proveedor DTE | **SimpleAPI** (API REST en la nube, plan gratis hasta 500 docs/mes, certificación SII incluida) |
| Ambiente v1 | Certificación de SimpleAPI; producción por cambio de env vars |
| Documentos v1 | Nota de venta (interna) → Factura electrónica (33), Boleta electrónica (39), Nota de Crédito (61) |
| Aislamiento del proveedor | Adaptador `packages/dte` con interfaz propia; el formato de SimpleAPI queda encapsulado |
| Reintentos | Cola de reintentos idempotente para emisión asíncrona |
| PDF | Descargable; XML timbrado y PDF en Supabase Storage |

**Requisitos inherentes a Chile (los aporta el usuario/su cliente, no el software):** certificado digital (~$12-20k CLP/año) y folios CAF autorizados por el SII. En certificación, ambos pueden ser de prueba.

## 3. Arquitectura

### 3.1 `packages/dte` — adaptador del proveedor

Interfaz propia, estable, independiente de SimpleAPI:

```ts
interface ProveedorDTE {
  emitirDTE(solicitud: SolicitudEmision): Promise<ResultadoEmision>
  consultarEstado(trackId: string, empresa: CredencialesDTE): Promise<EstadoDTE>
  anularConNotaCredito(solicitud: SolicitudNotaCredito): Promise<ResultadoEmision>
}
```

- `SolicitudEmision` incluye: tipo de documento (33/39/61), emisor, receptor, líneas, totales, folio, y las credenciales (certificado + CAF) ya descifradas.
- `ResultadoEmision`: `{ estado, folio, trackId, xmlTimbrado, pdfBase64, error? }`.
- La implementación `SimpleApiDTE` traduce esta interfaz al formato real de SimpleAPI (JSON, auth por header API key, certificado y CAF enviados en la petición). El wire-format exacto se fija en implementación leyendo la documentación/colección Postman en vivo de SimpleAPI — **queda confinado al interior del adaptador**.
- Selección de ambiente (certificación vs producción) por variable de entorno `DTE_AMBIENTE`.

### 3.2 Flujo de emisión

1. El usuario arma una **nota de venta** en el ERP (selector de productos y cliente existentes, cálculo de totales en vivo con `@suite/core`). Estado `borrador`.
2. Al confirmar el tipo tributario (33/39), la Server Action valida datos, toma el siguiente **folio** del rango CAF vigente para ese tipo, y marca el documento `pendiente_envio` dentro de una transacción (folio reservado atómicamente, nunca dos documentos con el mismo folio).
3. Llama a `packages/dte` → SimpleAPI (certificación) → SII timbra.
4. Éxito: guarda folio, track-id, XML timbrado y PDF en Supabase Storage; documento pasa a `emitido`.
5. Falla del proveedor/SII: el documento queda `pendiente_envio`; la **cola de reintentos** lo reintenta (backoff), con **clave de idempotencia** por documento para que un reintento nunca genere dos DTE.
6. **Nota de crédito (61):** referencia obligatoria al documento original (exigencia SII); anula o corrige una factura/boleta emitida.

### 3.3 Cola de reintentos

Documentos en `pendiente_envio` reintentados por una función programada (Supabase pg_cron o Vercel Cron — se elige en implementación por simplicidad operacional). Cada intento registra resultado; tras N fallos, alerta al usuario sin perder la venta. La reconciliación por track-id detecta documentos que el SII sí aceptó aunque la respuesta se perdió.

## 4. Modelo de datos (migración 4, multi-tenant)

Todas las tablas con `empresa_id` + RLS + grants explícitos + FK compuestas por tenant `(empresa_id, x_id)` (convención establecida en el review de Plan 2).

- **`documentos_venta`** — cabecera: `empresa_id`, `tipo` (`nota_venta`, `factura`, `boleta`, `nota_credito`), `cliente_id`, `folio` (nullable hasta emitir), `estado` (`borrador`, `pendiente_envio`, `emitido`, `rechazado`), `neto`, `exento`, `iva`, `total`, `track_id`, `documento_referencia_id` (para NC → documento original), `emitido_en`, timestamps.
- **`documentos_venta_lineas`** — detalle: `documento_id`, `producto_id` (FK compuesta), `descripcion`, `cantidad`, `precio_neto`, `exenta`, `subtotal`. Descripción y precio se copian del producto al momento de la venta (snapshot histórico, no referencia viva).
- **`folios_caf`** — rangos CAF cargados: `empresa_id`, `tipo_documento`, `desde`, `hasta`, `siguiente` (correlativo actual), `xml_caf` (el archivo CAF), `activo`. El folio siguiente se toma y avanza atómicamente.
- **`config_dte`** (o columnas en `empresas`) — certificado digital cifrado y su contraseña cifrada; RUT emisor, giro, dirección, resolución SII. Cifrado en reposo (Supabase Vault / pgsodium).

Totales en CLP entero con `@suite/core` (`calcularTotales`, `TASA_IVA`). Correlativos de folio parametrizados por tipo.

## 5. Seguridad

El **certificado digital + CAF son los datos más sensibles del sistema** — permiten firmar tributariamente en nombre de la empresa. Requisitos:

- **Cifrado en reposo** (Supabase Vault / pgsodium): el certificado (.pfx) y su contraseña se guardan cifrados; se descifran solo server-side, en memoria, en el instante de emitir; nunca se envían al navegador ni se registran en logs.
- Carga del certificado y CAF: solo rol `dueno`/`admin`, vía Server Action, con RLS.
- Emisión: Server Action server-side; el navegador nunca ve credenciales ni llama al proveedor directamente.
- Auditoría: quién emitió/anuló qué documento y cuándo.
- Las claves de API de SimpleAPI viven en variables de entorno del servidor (nunca `NEXT_PUBLIC_`).

## 6. Componentes y estructura de archivos

- `packages/dte/` — interfaz `ProveedorDTE`, tipos, implementación `SimpleApiDTE`, selección de ambiente, mock para tests.
- `packages/core/` — adiciones con TDD: gestión de folios (tomar/avanzar correlativo), mapeo de una venta a la estructura de totales DTE, validación de RUT emisor/receptor (reusa lo existente).
- `supabase/migrations/00000000000004_ventas.sql` — tablas de §4, RLS, grants, funciones de folio atómico.
- `supabase/tests/database/ventas.test.sql` — pgTAP: aislamiento por empresa, unicidad de folio, matriz de roles.
- `apps/erp/` — pantallas: lista de documentos (filtro por estado), nueva venta (selector productos/cliente, totales en vivo), acción de emitir, ver/descargar PDF, configuración (subir certificado + CAF). Reusa `@suite/ui`, `obtenerEmpresaActiva`, patrón de Server Actions y baja lógica de Plan 2.
- Cola de reintentos — función programada + tabla de estado ya cubierta por `documentos_venta.estado`.

## 7. Manejo de errores

- **Transaccional:** reserva de folio y cambio de estado son atómicos; jamás un folio consumido sin documento ni dos documentos con el mismo folio.
- **Emisión asíncrona con reintentos:** se puede seguir vendiendo con el SII/proveedor caídos; reconciliación por track-id.
- **Idempotencia:** clave única por operación de emisión; un reintento o doble clic no genera dos DTE.
- **Validación previa:** certificado y CAF válidos y vigentes antes de intentar emitir; si faltan, mensaje en español claro guiando a Configuración.
- Errores del proveedor traducidos a mensajes en español; detalle técnico a logs server-side (nunca credenciales).

## 8. Testing

- **Unitario (Vitest, TDD en `packages/core`):** correlativo de folios, mapeo venta→totales DTE, redondeos CLP. Un folio o total mal calculado es un problema legal.
- **`packages/dte`:** tests contra un **mock** del proveedor + una suite de **contrato** contra el sandbox de certificación de SimpleAPI (verifica que la traducción de nuestra interfaz al formato real sigue siendo válida).
- **Integración (pgTAP):** aislamiento multi-tenant de las tablas nuevas, unicidad de folio, matriz de roles.
- **E2E:** crear venta → emitir factura (33) contra ambiente de certificación → verificar folio, estado `emitido`, PDF descargable → emitir nota de crédito (61) referenciando la factura.

## 9. Fuera de v1 (YAGNI, van a Plan 4-5)

Guía de despacho (52), envío automático del PDF por correo (necesita SMTP/dominio propio), libros de compra y venta formato SII, cuentas por cobrar/cobranza, conciliación bancaria, exportación contable. El diseño no los construye; el modelo de datos no se complica por anticiparlos.

## 10. Criterio de éxito del Plan 3

Una pyme con su certificado digital y CAF (de certificación) puede: configurar su emisor en el ERP, armar una venta con sus productos y un cliente, emitir una factura o boleta electrónica que el SII de certificación acepta (folio + XML timbrado + PDF), y emitir una nota de crédito que la referencia — con los datos aislados por empresa y la venta nunca perdida ante una caída del proveedor. El paso a producción real es solo cambiar variables de entorno.
