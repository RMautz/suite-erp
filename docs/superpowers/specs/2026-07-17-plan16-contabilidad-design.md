# Plan 16: Núcleo contable (Fase 2 — Contabilidad, parte 1 de 2)

Fecha: 2026-07-17. Estado: diseño aprobado por el usuario (catálogo chileno sembrado; asiento por documento; contabilización automática en tiempo real + catch-up idempotente; histórico completo al activar). Parte 2 (Plan 17): balance 8 columnas, EERR, cierre — FUERA de este plan.

## §1 Objetivo

Partida doble real sobre lo que el ERP ya registra: cada empresa activa el módulo, nace con un plan de cuentas pyme chileno, y sus ventas/compras/pagos/anticipos generan asientos solos — con libro diario y mayor consultables y exportables, asientos manuales para el resto, y el rol `contador` finalmente operativo. Invariante suprema: **ningún asiento descuadrado entra jamás a la base** — TODAS las vías (manual, reversa, hook, catch-up) funnelan a UN helper interno de inserción que valida `Σdebe = Σhaber > 0` y líneas válidas ANTES de escribir; ninguna RPC inserta asientos por su cuenta. Defensa en profundidad: 0022 agrega a `documentos_venta` el CHECK `total = neto + exento + iva` que compras ya tiene (0013) y ventas no (0004) — un documento manipulado por escritura directa se vuelve error visible, jamás asiento descuadrado.

## §2 Decisiones

- **Módulo activable** `empresas.modulo_contabilidad` — espejo EXACTO del patrón `modulo_transporte` (columna + toggle en /configuracion/modulos + NAV condicional + gating). Al activar: siembra del catálogo + contabilización del histórico (ver §4 activación).
- **Asiento por documento** con `origen` + `referencia_id` → trazabilidad total e idempotencia por `(empresa, origen, referencia)`.
- **Tiempo real**: hooks nunca-lanza a nivel de app (patrón del descuento de stock) tras emitir/registrar/pagar. El proceso "contabilizar pendientes" es el MISMO motor y sirve de catch-up idempotente: cualquier camino que se salte un hook (RPC directa, E2E) se repara con un click.
- **Asientos INMUTABLES**: sin update/delete; corregir = `revertir_asiento` (asiento inverso ligado, un asiento se revierte a lo más una vez).
- **CLP enteros** (debe/haber integer ≥ 0; exactamente uno > 0 por línea).
- **Roles contables**: dueno/admin/contador ven el módulo y crean asientos manuales/reversas; vendedor y bodeguero NO ven contabilidad (RLS select restringido — primera tabla del repo con select por rol, no por membresía).
- **La suscripción del SaaS NO se contabiliza** (dinero de la plataforma, no del tenant).
- **Fecha contable** del asiento automático: ventas/NC → `coalesce(emitido_en, creado_en)::date` (expresión IDÉNTICA a la vista `libro_ventas` 0011 — diario y libro jamás divergen un día); compras → `fecha_emision`; pagos → fecha del pago; anticipos → `recibido_en::date`. Manuales: la que indique el usuario (no futura > hoy + 1 día; no anterior a 2000-01-01). La deuda timezone UTC-vs-Chile es repo-wide y aquí solo se hereda, no se agrava.
- **Efectivo → Banco en v1**: los pagos método `efectivo` se asientan contra Banco (cuentas por método de pago quedan fuera de alcance §9); la cuenta Caja existe en el catálogo solo para asientos manuales.
- **Mapeo con 0 líneas = noop**: si un documento deja todas las líneas en monto 0 (p.ej. boleta total 0, posible con el DTE mock), NO se genera asiento y NO cuenta como pendiente — regla aplicada igual por el hook y por contabilizar_pendientes (jamás un pendiente eterno ni un asiento vacío).

## §3 Schema (migración 0022)

### `empresas.modulo_contabilidad boolean not null default false`
**SIN grant de columna a authenticated** (deliberadamente distinto de `modulo_transporte`): un flip crudo por Data API saltearía la siembra del catálogo. Activar y desactivar van SOLO por RPC (§4.1 y §4.1b).

### `cuentas_contables`
- `id uuid pk`, `empresa_id` FK, `unique (empresa_id, id)` (referenciada por FK compuesta de líneas)
- `codigo text` jerárquico visible ('1.1.01'); `unique (empresa_id, codigo)`
- `nombre text not null`
- `tipo text check in ('activo','pasivo','patrimonio','ingreso','gasto')`
- `acepta_movimientos boolean` (solo hojas reciben líneas)
- `clave_sistema text null` + `unique parcial (empresa_id, clave_sistema) where clave_sistema is not null` — ancla ESTABLE de los mapeos automáticos (`caja`, `banco`, `clientes`, `anticipos_clientes`, `iva_debito`, `iva_credito`, `proveedores`, `ventas`, `ventas_exentas`, `compras_gastos`); las cuentas con clave_sistema no se desactivan ni cambian de tipo (nombre/código sí editables)
- `activa boolean default true`
- RLS: select dueno/admin/contador. **CERO escritura directa** (RLS con `WITH CHECK` no puede comparar OLD vs NEW, así que la inmutabilidad de `clave_sistema`/`tipo` de cuentas de sistema es inexpresable por policy): crear/editar/desactivar van por la RPC `guardar_cuenta` (§4.6). Grant explícito SOLO select; service_role completo.
- **Catálogo sembrado** (~25 cuentas pyme chilena en la RPC de activación, jerarquía 1 Activos / 2 Pasivos / 3 Patrimonio / 4 Ingresos / 5 Gastos, con las 10 claves de sistema; `caja` no la usa ningún mapeo automático — ver §2 efectivo→Banco).

### `asientos`
- `id`, `empresa_id`, `unique (empresa_id, id)`; `numero integer` correlativo por empresa (advisory lock `hashtextextended('asientos:' || p_empresa::text, 42)` — patrón exacto de cotizaciones 0014), `unique (empresa_id, numero)`
- `fecha date not null`, `glosa text not null`
- `origen text check in ('manual','venta','nota_credito','compra','pago','pago_proveedor','anticipo','reversa')` — **UN solo origen `'pago'` para todo pago de cliente**: la REGLA ramifica el debe (Banco vs Anticipos de clientes) según `pagos.anticipo_id`; así el unique de idempotencia garantiza a lo más UN asiento por pago y el hook y el catch-up no pueden divergir jamás (con dos orígenes sobre el mismo pago.id, el unique no los respaldaba).
- `referencia_id uuid null` + **unique parcial `(empresa_id, origen, referencia_id) where referencia_id is not null`** (idempotencia)
- `reversa_de uuid null` FK compuesta a asientos + **unique parcial `(empresa_id, reversa_de) where reversa_de is not null`** (una reversa por asiento)
- `creado_por uuid null default auth.uid()` (auditoría de manuales/reversas; null en los automáticos vía service_role), `creado_en`. RLS select dueno/admin/contador; CERO escritura directa; service_role completo.

### `asientos_lineas`
- `id`, `empresa_id`, `asiento_id` FK compuesta, `cuenta_id` FK compuesta, `debe integer check ≥0`, `haber integer check ≥0`, `check ((debe=0) <> (haber=0))` (exactamente uno positivo), `glosa text null`
- RLS select dueno/admin/contador; CERO escritura directa; service_role completo.

### `pagos.anticipo_id uuid null` + re-creates
Columna nueva (FK compuesta a anticipos — su `unique (empresa_id, id)` ya existe, 0018:69) que marca los pagos NACIDOS de aplicar un anticipo. Re-creates VERBATIM+diff declarado (patrón Plan 13) de `aplicar_anticipo` y `aplicar_anticipo_manual` (el 0018 VIGENTE ya incluye el split dc1526b) con DOS cambios: setean `anticipo_id` al insertar su pago Y **retornan el `pago_id` creado** (hoy `void` — el hook de tiempo real lo necesita como referencia). Distingue el hecho contable: pago con `anticipo_id` = reclasificación (no es plata nueva); sin = plata al banco.

### CHECK de integridad en `documentos_venta`
`alter table documentos_venta add constraint documentos_venta_total_check check (total = neto + exento + iva)` — espejo del que compras ya tiene (0013); cierra la manipulación por escritura directa que rompería la cuadratura automática (§1).

## §4 RPCs (security definer, search_path, revoke anon/public, matrix explícita)

**Helper interno `app._insertar_asiento(p_empresa, p_fecha, p_glosa, p_origen, p_referencia, p_reversa_de, p_creado_por, p_lineas)`** — SIN grants (solo invocable por las RPCs de este módulo): valida líneas (cuentas de la empresa, activas, hoja; montos enteros con exactamente uno positivo), **`Σdebe = Σhaber > 0`**, toma el correlativo y escribe asiento+líneas. TODA creación de asiento pasa por aquí — el invariante §1 vive en un solo lugar.

**Orden de candados UNIFORME anti-deadlock**: toda RPC que crea asientos toma PRIMERO el advisory lock del correlativo (`hashtextextended('asientos:' || p_empresa::text, 42)` — xact-scoped, candado más externo) y DESPUÉS cualquier `for update` de documentos. Sin esto, contabilizar_pendientes (batch) y un hook concurrente pueden abrazarse (advisory↔fila) y Postgres aborta uno.

1. **`activar_contabilidad(p_empresa)`** — dueno/admin. Idempotente: siembra el catálogo si no existe (por clave_sistema) y setea `modulo_contabilidad = true`. NO contabiliza (eso es de contabilizar_pendientes; la ACTION del toggle llama ambas seguidas y muestra el resumen).

1b. **`desactivar_contabilidad(p_empresa)`** — dueno/admin. Solo apaga el flag (asientos y cuentas quedan). Junto con 4.1 son la ÚNICA vía de mover `modulo_contabilidad` (sin grant de columna, §3).
2. **`contabilizar_pendientes(p_empresa) returns jsonb {creados}`** — dueno/admin/contador. Recorre EN ORDEN DE FECHA todo lo contabilizable sin asiento (ventas/NC emitidas, facturas de compra, pagos activos de clientes y proveedores, anticipos, aplicaciones) y crea sus asientos con las reglas de §4-mapeos. Idempotente vía el unique parcial (y check dentro de lock). Motor único: la activación, el catch-up y el botón de la UI son la misma RPC.
3. **`crear_asiento(p_empresa, p_fecha, p_glosa, p_lineas jsonb) returns uuid`** — dueno/admin/contador. Valida: módulo activo → `'La contabilidad no está activada'`; ≥2 líneas → `'Un asiento necesita al menos dos líneas'`; cada cuenta existe, es de la empresa, activa y acepta_movimientos → `'Cuenta contable no válida'`; montos enteros ≥0 con exactamente uno >0 → `'Cada línea lleva debe o haber, mayor que cero'`; **Σdebe = Σhaber > 0** → `'El asiento no cuadra: debe y haber difieren'`; fecha en rango §2. Correlativo bajo advisory lock. Rol → `'Tu rol no permite crear asientos'`.
4. **`revertir_asiento(p_empresa, p_asiento, p_glosa) returns uuid`** — dueno/admin/contador. Lock del asiento; no existe → `'El asiento no existe'`; ya revertido (o es reversa) → `'El asiento ya fue revertido'` / las reversas no se revierten → mismo mensaje. Crea el inverso (debe↔haber) con origen 'reversa', `reversa_de` ligado, fecha = hoy, glosa dada.
5. **`contabilizar_documento(p_empresa, p_origen, p_referencia) returns text 'creado'|'noop'`** — SOLO service_role (hook). No-op limpio si módulo inactivo, si ya existe asiento (idempotencia bajo lock + backstop 23505→'noop'), si el objeto no aplica (p.ej. pago anulado) o si el mapeo produce 0 líneas (§2). Aplica la regla del origen leyendo las filas reales bajo el candado del documento y crea vía `_insertar_asiento` (la cuadratura se re-valida SIEMPRE, también en la vía automática).

6. **`guardar_cuenta(p_empresa, p_id nullable, p_codigo, p_nombre, p_tipo, p_acepta_movimientos, p_activa)`** — dueno/admin/contador. Crea (p_id null) o edita; en cuentas con `clave_sistema`: SOLO `codigo`/`nombre` mutables (tipo/clave/activa intactos → `'Las cuentas del sistema no se pueden modificar así'`); código duplicado → `'Ya existe una cuenta con ese código'`; jamás delete (desactivar cuentas propias vía p_activa; con movimientos igual pueden desactivarse — los asientos históricos no se tocan).

### Mapeos automáticos (reglas fijas v1; montos SIEMPRE de las filas reales; líneas con monto 0 se omiten)

| Origen (referencia) | Debe | Haber |
|---|---|---|
| `venta` (documento emitido factura/boleta) | Clientes (total) | Ventas (neto) · Ventas exentas (exento) · IVA débito (iva) |
| `nota_credito` (NC emitida) | Ventas (neto) · Ventas exentas (exento) · IVA débito (iva) | Clientes (total) |
| `compra` (documento_compra activo) | Compras/Gastos (neto+exento) · IVA crédito (iva) | Proveedores (total) |
| `pago` (TODO pago activo de cliente; el debe ramifica por `anticipo_id`) | sin `anticipo_id`: Banco (monto) — plata nueva · con `anticipo_id`: Anticipos de clientes (monto) — reclasificación | Clientes (monto) |
| `pago_proveedor` (pago activo a proveedor) | Proveedores (monto) | Banco (monto) |
| `anticipo` (anticipo con `mp_payment_id NOT NULL` — plata nueva del webhook, incl. excedente de pago) | Banco (monto) | Anticipos de clientes (monto) |

- El anticipo-excedente **de aplicación** (split dc1526b, `mp_payment_id NULL`) NO genera asiento: es el mismo pasivo de anticipos cambiando de fila, no plata nueva — regla explícita para no duplicar el pasivo. (Traza verificada: anticipo 2.3M recibido [Banco/Anticipos 2.3M] → aplicado a factura de 450k [pago con anticipo_id: Anticipos/Clientes 450k] → pasivo neto 1.85M = el excedente sin asiento. Cuadra.)
- Pagos ANULADOS después de contabilizados: v1 NO auto-revierte — el contador usa `revertir_asiento` (documentado en la UI del asiento); `contabilizar_pendientes` no re-crea asientos de pagos anulados (filtra activos) ni revierte solo — y el unique por (empresa,'pago',pago_id), ocupado por el asiento original inmutable, hace imposible la re-creación tras una reversa.

## §5 Hooks de app (nunca-lanza, patrón registrarMovimientosDocumento)

`apps/erp/lib/contabilidad.ts` → `contabilizarAsiento(empresaId, origen, referenciaId)` (admin client → RPC 5; catch → console.error, jamás rompe el flujo). Obtención del `referencia_id` POR CAMINO (hallazgo del lente: varias RPCs retornan void y las actions descartan ids):
- **Emisión** (venta/NC): el id del documento ya está en emitir.ts — hook junto a los existentes.
- **Cobranza / por-pagar**: `registrar_pago`/`registrar_pago_proveedor` YA retornan el uuid — las actions pasan a CAPTURARLO (cambio de 1 línea) y la compra agrega `.select('id')` a su insert.
- **Webhook/retorno MP tenant**: `registrar_pago_mp`/`registrar_anticipo_mp` retornan void — tras la RPC, el route resuelve por `mp_payment_id` (`select id from pagos where ...` y `from anticipos where ...` — un solo mp_payment_id puede haber creado pago Y anticipo-excedente: se contabilizan AMBOS, 'pago' y 'anticipo').
- **Aplicación de anticipos**: las re-creates ahora RETORNAN el pago_id (§3) → hook 'pago' (la regla ramifica sola por anticipo_id).
Los caminos que no pasan por la app quedan cubiertos por `contabilizar_pendientes`.

## §6 UI (`/contabilidad`, NAV condicional al módulo; guard rol dueno/admin/contador)

- **Resumen**: últimos asientos + botón "Contabilizar pendientes" (muestra `{creados}`) + aviso si hay documentos sin contabilizar.
- **Plan de cuentas**: árbol/lista por código, insignias de tipo, crear/editar/desactivar cuentas propias (las de sistema: solo nombre/código).
- **Asientos**: lista con filtros (rango, origen), detalle (líneas, link al documento origen, botón Revertir con glosa), **nuevo asiento manual** (líneas dinámicas, cuadratura viva Σdebe/Σhaber, solo cuentas hoja activas).
- **Libro diario**: rango de fechas, export CSV (`filasACsv`). **Libro mayor**: selector de cuenta + rango, debe/haber/saldo acumulado, export CSV.
- `/configuracion/modulos`: toggle Contabilidad (activar → RPC 1 + RPC 2, resumen "N asientos creados"; desactivar solo apaga el flag y esconde la UI — los asientos quedan).
- Detalle de venta y lista de pagos: línea/columna "Asiento N°X" (link) si existe. Compra: SIN traza en v1 — no existe página de detalle de `documentos_compra` (solo la lista `/por-pagar/facturas`; `/compras/[id]` es órdenes de compra, otra tabla). La traza de compra se agrega cuando exista ese detalle (desviación documentada; mismo patrón batch por origen+referencia).
- Español; queries `.eq('empresa_id', activa.id)`; export con guard de módulo Y rol (paridad página/route — lección P12).

## §7 Seed demo

El seed activa contabilidad en la empresa demo al final, tras sembrar todo — **vía `userCli` (el dueño demo), NO el admin client** (las RPCs 1 y 2 son de authenticated; service_role daría 42501) → libros poblados con el histórico completo; imprime el conteo de asientos. La 2ª organización queda SIN contabilidad (muestra el gating). Nota: el seed no ejercita la rama pago-con-anticipo_id (aplicación) — esa queda cubierta por pgTAP y el checklist.

## §8 Tests

- **pgTAP** `contabilidad.test.sql` (~32-36, el plan fija el número EXACTO y el nuevo total — hoy 279 en 15 archivos): activación idempotente + catálogo con las 10 claves + flip crudo del flag bloqueado (update directo de modulo_contabilidad → 42501); guardar_cuenta (propia feliz, sistema protegida, código duplicado); crear_asiento (feliz multi-línea, descuadrado, 1 línea, cuenta ajena/inactiva/no-hoja, debe y haber simultáneos, rol vendedor NO, contador SÍ, correlativo consecutivo); revertir (feliz espejo, doble reversa, revertir una reversa); contabilizar_documento service_role only (42501 authenticated) + golden por CADA regla de la tabla §4 (venta con exento y sin exento, NC, compra, pago sin anticipo_id → Banco, pago con anticipo_id → Anticipos, anticipo mp_payment_id, excedente-de-aplicación → 'noop', documento total 0 → 'noop' sin asiento) + idempotencia + reversa-de-automático NO se re-crea vía pendientes; re-creates de aplicar_anticipo con anticipo_id seteado Y pago_id retornado; candados escritura directa (asientos, líneas, cuentas); RLS: contador ve, vendedor 0 filas, cross-tenant 0.
- **Unit**: si el plan extrae helpers puros (p.ej. armado de líneas para la UI de cuadratura viva) van a `@suite/core` con tests; si no, conteo unit intacto (176) — el plan lo fija.
- **E2E capa de datos** + **checklist manual** (~10: activar en demo limpia → N asientos; venta nueva → asiento solo; compra; pago; anticipo mock → asiento; aplicar → reclasificación; manual descuadrado rechazado en vivo; reversa; mayor cuadra con el diario; vendedor no ve NAV ni páginas; export CSV).
- Suite completa verde + 3 builds.

## §9 Fuera de alcance (Plan 17+)

Balance de 8 columnas, estado de resultados, cierre/apertura de ejercicio, asiento de apertura manual para saldos iniciales de otra procedencia, centros de costo, conciliación bancaria, corrección monetaria/UF, multi-moneda, auto-reversa al anular pagos, edición de asientos, eliminación de cuentas, **cuentas por método de pago** (efectivo/transferencia/cheque → todo a Banco en v1; Caja solo manual), reportes tributarios contables (F29 se apoya en los libros SII ya existentes).

## §10 Criterio de éxito

En la demo: activar el módulo deja los libros completos del histórico sembrado (diario y mayor cuadrados: Σdebe = Σhaber global e igual por asiento); emitir una venta o simular un pago mock crea su asiento solo y trazable desde el detalle; un asiento manual descuadrado es imposible de guardar; la reversa deja rastro ligado; el contador opera el módulo y el vendedor ni lo ve; los exports CSV abren en Excel. Suite completa verde con los conteos del plan.
