# Diseño: Plan 5 — Compras (órdenes de compra + recepción de mercadería)

**Fecha:** 2026-07-14
**Estado:** Aprobado por el usuario
**Fase:** 1 del roadmap; quinto plan tras Fundación (1), Maestros (2), Ventas+DTE (3) e Inventario (4).

## 1. Propósito

Cerrar el ciclo de abastecimiento de la pyme: crear una orden de compra a un proveedor, recibir la mercadería (en una o varias entregas) y que el stock suba automáticamente con el costo trazado. Incluye además el hardening del TOCTOU de ventas detectado en el Plan 4, para que ambos caminos de escritura al ledger de stock (venta y recepción) queden serializados.

## 2. Decisiones fundacionales (aprobadas por el usuario)

| Decisión | Elección |
|---|---|
| Alcance v1 | Loop de abastecimiento: OC → recepción → entrada de stock, con costo unitario por línea |
| Recepciones | Parciales: una OC se recibe en varias entregas; se trackea pedido vs recibido por línea |
| Modelo | Enfoque A "espejo de Ventas": recepción como documento propio (`recepciones` + líneas) |
| Costo | Se registra en la línea de OC y se copia a la línea de recepción; `productos` NO gana columna de costo |
| Fuera de v1 | Cuentas por pagar, factura de compra, IVA crédito, valorización/costo promedio, devoluciones a proveedor |

## 3. Arquitectura y modelo de datos (migración 0009)

Convenciones vigentes (Planes 2-4): `empresa_id` + RLS + grants explícitos + FK compuestas por tenant `(empresa_id, x_id) references tabla (empresa_id, id)` + `unique (empresa_id, id)` en toda tabla referenciada; escrituras de negocio server-side; CLP entero; identificadores ASCII, dominio en español.

- **`ordenes_compra`** — `empresa_id`, `numero` (correlativo por empresa, asignado atómicamente en la RPC de creación; `unique (empresa_id, numero)`), `proveedor_id` (FK compuesta), `estado` (`check in ('borrador','enviada','recibida_parcial','recibida_total','cancelada')`, default `borrador`), `notas`, `creado_en`, `actualizado_en`. Sin columnas de totales: se calculan de las líneas.
- **`ordenes_compra_lineas`** — `empresa_id`, `orden_id` (FK compuesta), `producto_id` (FK compuesta), `descripcion` (denormalizada, tomada DEL PRODUCTO al crear, como en ventas), `cantidad_pedida integer check (> 0)`, `costo_unitario integer check (>= 0)`, `cantidad_recibida integer not null default 0 check (cantidad_recibida >= 0 and cantidad_recibida <= cantidad_pedida)`.
- **`recepciones`** — `empresa_id`, `orden_id` (FK compuesta), `bodega_id` (FK compuesta; una recepción entra completa a UNA bodega), `notas`, `creado_en`. Una entrega física = un documento de recepción.
- **`recepciones_lineas`** — `empresa_id`, `recepcion_id` (FK compuesta), `orden_linea_id` (FK compuesta a `ordenes_compra_lineas`), `producto_id` (FK compuesta), `cantidad integer check (> 0)`, `costo_unitario` copiado de la línea de la OC al momento de recibir (traza histórica auditable).
- **`movimientos_stock.referencia_recepcion_id`** — columna nueva nullable, FK compuesta a `recepciones`: espejo de `referencia_documento_id` (ventas). Cada `entrada` por recepción queda ligada a su documento en el ledger inmutable.

RLS: `select` para miembros (`app.mis_empresas()`). Escrituras: los `insert` de las 4 tablas SOLO vía RPCs (sin insert directo de `authenticated`); `ordenes_compra` admite además `update` directo vía RLS restringido a `dueno`/`admin` únicamente para las transiciones simples (enviar/cancelar) desde Server Actions; `recepciones`, `recepciones_lineas` y `ordenes_compra_lineas` no admiten escritura directa alguna. Grants explícitos (lección Plan 1: sin grant todo da 42501).

## 4. Máquina de estados de la OC

`borrador → enviada → recibida_parcial → recibida_total`; `cancelada` solo desde `borrador`/`enviada` — y como toda recepción saca la OC de `enviada` en su misma transacción, este guard de estado YA garantiza que no se cancela una OC con recepciones. Editable (líneas) solo en `borrador`. Se puede recibir solo en `enviada`/`recibida_parcial`. Tras cada recepción el estado se deriva: todas las líneas con `cantidad_recibida = cantidad_pedida` → `recibida_total`; si no → `recibida_parcial`. Las transiciones simples (enviar, cancelar) validan el estado actual en el `where` (`.eq('estado', …).select('id')`, 0 filas = rechazo) — y son race-safe contra recepciones concurrentes porque `registrar_recepcion` re-valida el estado tras adquirir el `for update`.

## 5. RPCs (security definer, `set search_path`, revoke anon/public, validan rol y pertenencia)

- **`crear_orden_compra(p_empresa uuid, p_proveedor uuid, p_lineas jsonb, p_notas text) returns uuid`** — rol `dueno`/`admin`; valida proveedor de la empresa y líneas (producto existente, cantidad > 0, costo >= 0); toma `numero` correlativo de forma atómica; inserta OC en `borrador` + líneas con descripción DEL PRODUCTO (anti-manipulación, mismo principio que `crear_documento_venta`).
- **`registrar_recepcion(p_empresa uuid, p_orden uuid, p_bodega uuid, p_lineas jsonb, p_notas text) returns uuid`** — rol `dueno`/`admin`/`bodeguero`. **Atómica y serializada**: `select … from ordenes_compra where … for update` bloquea la OC (dos recepciones concurrentes se serializan → sin TOCTOU por diseño); valida estado ∈ (`enviada`,`recibida_parcial`) y, por línea, `cantidad > 0` y `cantidad ≤ pendiente` (`cantidad_pedida - cantidad_recibida`); inserta `recepciones` + `recepciones_lineas`; actualiza `cantidad_recibida`; inserta los movimientos `entrada` (positivos) con `proveedor_id`, `referencia_recepcion_id` y motivo `'Recepción OC N° X'`; deriva y actualiza el estado de la OC. Todo o nada.

**Matriz de roles:** crear/enviar/cancelar OC = `dueno`/`admin`; registrar recepción = `dueno`/`admin`/`bodeguero`; lectura = cualquier miembro.

## 6. Hardening TOCTOU de Ventas (follow-up del Plan 4, incluido en este plan)

- **`registrar_movimientos_documento(p_empresa uuid, p_documento uuid, p_lineas jsonb, p_signo integer, p_motivo text)`** — security definer ejecutable **SOLO por `service_role`** (revoke a anon/authenticated/public): toma `pg_advisory_xact_lock` derivado del documento y hace el check-de-existencia por `referencia_documento_id` + inserts DENTRO del lock; resuelve/crea la bodega por defecto dentro de la misma transacción. NO se usa índice único como backstop (un documento produce N filas y `producto_id` puede repetirse — análisis del review del Plan 4).
- `registrarMovimientosDocumento` en `apps/erp/lib/emision.ts` pasa a llamar esta RPC (una llamada) en vez del check-then-insert en dos pasos. Conserva sus invariantes: nunca lanza (la emisión jamás falla por stock), corre tras persistir el documento `emitido`.
- Con esto, ambos caminos de escritura al ledger (venta/NC vía RPC con advisory lock; recepción vía `for update`) quedan serializados.

## 7. App ERP

Menú **Compras** (entre Inventario y Configuración), reusando `@suite/ui`, `obtenerEmpresaActiva` y el patrón de Server Actions:

- **Lista de OCs** — número, proveedor, fecha, estado (insignia por color), total calculado de las líneas; filtro por estado y búsqueda por proveedor.
- **Nueva OC** — selector de proveedor + líneas dinámicas (producto, cantidad, costo unitario); crea en `borrador` vía `crear_orden_compra`.
- **Detalle OC** — líneas con pedido / recibido / pendiente, totales; botones según estado: Marcar enviada (borrador), Cancelar (borrador/enviada sin recepciones), Registrar recepción (enviada/recibida_parcial); historial de recepciones (fecha, bodega, líneas).
- **Formulario de recepción** — bodega destino + cantidad por línea pre-llenada con lo pendiente (editable hacia abajo); llama `registrar_recepcion`.

Sin cambios al dashboard en v1.

## 8. Manejo de errores

- Sobre-recepción rechazada con detalle (`'Cantidad supera lo pendiente (pendiente: N)'`); recepción sobre OC en estado inválido rechazada; cancelación con recepciones bloqueada.
- Validación de pertenencia y rol server-side en cada RPC; empresa siempre de `obtenerEmpresaActiva()`, jamás del formulario; RLS 0-filas en mutaciones = denegación explícita.
- Mensajes al usuario en español claro.

## 9. Testing

- **Unitario (Vitest, TDD en `@suite/core`):** pendiente por línea (`pedida - recibida`), derivación de estado de la OC desde sus líneas, validación de cantidades de recepción, formateo de totales CLP.
- **Integración (pgTAP):** aislamiento multi-tenant de las 4 tablas; matriz de roles (contador no crea OC ni recibe; bodeguero recibe pero no crea OC); recepción parcial → stock sube y estado `recibida_parcial`; completar → `recibida_total`; sobre-recepción rechazada; cancelación con recepciones bloqueada; `registrar_movimientos_documento` solo ejecutable por service_role y no duplica bajo llamadas repetidas.
- **E2E integral:** crear OC (2 productos) → enviar → recibir parcial en Bodega Central → stock sube con costo trazado en el ledger → recibir el resto → `recibida_total` → aislamiento entre empresas → reintento concurrente de emisión de venta ya NO duplica movimientos (verifica el hardening).

## 10. Fuera de v1 (YAGNI)

Cuentas por pagar y factura de compra del proveedor (IVA crédito, registro de compras), valorización de inventario / costo promedio ponderado, devoluciones a proveedor, multi-bodega por línea de recepción, aprobaciones/workflow de OC, dashboard de compras, edición de OC enviada (se cancela y se crea otra).

## 11. Criterio de éxito del Plan 5

Una pyme puede: crear una orden de compra numerada a un proveedor con costos por línea, marcarla enviada, recibir la mercadería en una o varias entregas eligiendo bodega, ver el stock subir automáticamente con cada recepción (trazado en el ledger inmutable con referencia y proveedor), seguir el estado pedido-vs-recibido hasta `recibida_total`, y cancelar órdenes que no prosperaron — todo aislado por empresa. Además, el doble-reintento simultáneo de una emisión de venta ya no puede duplicar movimientos de stock.
