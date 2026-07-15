# Diseño: Plan 9 — Cotizaciones (cotización → nota de venta)

**Fecha:** 2026-07-15
**Estado:** Aprobado por el usuario
**Fase:** 1 del roadmap; noveno plan. Se inserta ANTES de la cadena existente nota_venta → emisión DTE.

## 1. Propósito

Darle al vendedor el paso comercial previo a la venta: armar una cotización con precios negociables por línea, enviarla al cliente, registrar si la aceptó o rechazó, y convertir la aceptada en una nota de venta en borrador **con los precios cotizados** — desde ahí el flujo existente de emisión (factura/boleta, folios CAF, descuento de stock al emitir) sigue intacto.

## 2. Decisiones fundacionales (aprobadas por el usuario)

| Decisión | Elección |
|---|---|
| Precios | **Negociables por línea**: pre-llenados del producto, ajustables por el vendedor; la conversión respeta los precios COTIZADOS, no los de lista |
| Vigencia | `fecha_validez` (default hoy + 30 en la UI); insignia **Vencida** derivada (sin cron). **Aceptar exige vigencia; una aceptada a tiempo congela el trato y puede convertirse siempre**, aunque la fecha ya haya pasado |
| PDF / correo | FUERA de v1: vista de detalle imprimible (CSS de impresión, Ctrl+P); PDF formal y envío por correo llegan en Plan 10 |
| Modelo de datos | **Tabla propia** `cotizaciones` + líneas (patrón `ordenes_compra`): `documentos_venta` queda acoplada al ciclo DTE (CAF, track_id, XML) y una cotización no es documento tributario |
| Edición | Sin edición de líneas post-creación (patrón OC): una cotización mal digitada se rechaza con motivo (posible desde borrador) y se crea otra |
| Roles | Crear/gestionar/convertir = `dueno`/`admin`/`vendedor` (los vendedores cotizan y venden, igual que `crear_documento_venta`); `contador` y `bodeguero` solo leen; lectura = cualquier miembro |
| Numeración | Correlativo por empresa vía advisory lock (patrón OC exacto), sin folios SII |

## 3. Arquitectura y modelo de datos (migración 0014)

Convenciones vigentes: `empresa_id` + RLS + grants explícitos + FK compuestas `(empresa_id, x_id)` + `unique (empresa_id, id)`; CLP entero; español.

- **`cotizaciones`** — `empresa_id`, `numero integer not null` (correlativo, `unique (empresa_id, numero)`), `cliente_id` (FK compuesta), `fecha_validez date not null` (SIN check de tabla contra la fecha de creación: la validación vive solo en la RPC, y así los fixtures de test pueden backdatear vía service_role), `notas`, `neto`/`exento`/`iva`/`total` integers `>= 0` con `check (total = neto + exento + iva)`, `estado` (`check in ('borrador','enviada','aceptada','rechazada','convertida')` default `'borrador'`), `motivo_rechazo`, `documento_venta_id` (FK compuesta NULLABLE a `documentos_venta` — la nota de venta generada), `creado_en`, `unique (empresa_id, id)`. Índice de lista: `cotizaciones_lista_idx (empresa_id, estado, creado_en desc)` (patrón `documentos_venta_lista_idx`).
- **`cotizaciones_lineas`** — `cotizacion_id` (FK compuesta, `on delete cascade`), `producto_id` (FK compuesta, NOT NULL — v1 cotiza solo productos del catálogo), `descripcion` (copiada del producto), `cantidad > 0`, `precio_neto >= 0` (el COTIZADO, negociado), `exenta boolean` (del producto, no editable), `subtotal = cantidad × precio_neto` (check `>= 0`), índice `(empresa_id, cotizacion_id)`.
- **Vencida** es DERIVADA y aplica SOLO a estados `borrador`/`enviada` con `fecha_validez < hoy`; `aceptada`, `rechazada` y `convertida` NUNCA muestran la insignia (la aceptada congeló el trato; las otras son terminales). Helper puro nuevo en `@suite/core`: `cotizacionVencida(fechaValidez, hoy, estado)` (comparación lexicográfica de fechas ISO, mismo criterio que `estaVencido` — cuyo parámetro `saldo` lo hace inaplicable aquí tal cual). No hay estado `vencida` ni cron.

Máquina de estados (transiciones válidas, todo lo demás rechazado):

```
borrador → enviada | rechazada
enviada  → aceptada | rechazada      (aceptada exige fecha_validez >= hoy)
aceptada → convertida                (solo vía convertir_cotizacion, sin condición de fecha)
```

RLS/grants (dos capas, lección migraciones 4→7): policy ÚNICA de `select` para miembros en ambas tablas; CERO policies ni grants de escritura para `authenticated`; `grant select on cotizaciones, cotizaciones_lineas to authenticated`; `grant select, insert, update, delete ... to service_role`. Toda escritura entra por RPC security definer.

## 4. RPCs (security definer, `set search_path`, revoke anon/public, validan rol via `app.tiene_rol_en_empresa`)

Normalización de textos en todas: `p_notas` y `p_motivo` pasan por `nullif(trim(coalesce(..., '')), '')` (patrón `registrar_pago`/`anular_pago`); un motivo de puro whitespace cuenta como vacío.

- **`crear_cotizacion(p_empresa uuid, p_cliente uuid, p_validez date, p_notas text, p_lineas jsonb) returns uuid`** — rol `dueno`/`admin`/`vendedor`. Valida cliente de la empresa **y activo** (`'Cliente no válido'` cubre inexistente, ajeno e inactivo); `if p_validez is null or p_validez < current_date` → error (el default hoy+30 lo pone la UI, la RPC no lo suple); ≥1 línea. Por línea: producto de la empresa **y activo** (mismo filtro `and activo` de `crear_documento_venta`; `'Producto no válido'` cubre inexistente, ajeno e inactivo), de ahí salen `descripcion` y `exenta` — NO se confían del llamador; `cantidad >= 1`; `precio_neto` entero `>= 0` **enviado por el llamador** (negociable — única diferencia deliberada con `crear_documento_venta`). Tolerancia de casts (igual que `crear_orden_compra`): los mensajes contractuales cubren null y fuera de rango tras un cast exitoso; valores jsonb no casteables (`"abc"`, `12.5`, overflow int4) abortan con el error crudo de Postgres. Totales calculados server-side con el MISMO criterio de `crear_documento_venta` (neto = Σ subtotales no exentos, exento = Σ exentos, IVA 19% del neto con el mismo redondeo). Correlativo: `pg_advisory_xact_lock(hashtextextended('cotizaciones:' || p_empresa::text, 42))` y `select coalesce(max(numero), 0) + 1` DENTRO del lock (patrón `crear_orden_compra` literal). jsonb: `[{"productoId": uuid, "cantidad": int, "precioNeto": int}]`.
- **`cambiar_estado_cotizacion(p_empresa uuid, p_cotizacion uuid, p_estado text, p_motivo text default null)`** — rol `dueno`/`admin`/`vendedor`. Lookup explícito `select ... from cotizaciones where id = p_cotizacion and empresa_id = p_empresa for update`; 0 filas → `'La cotización no existe'` (cubre por igual inexistente y de-otro-tenant, sin distinguirlos). Solo transiciones de la máquina de §3; `p_estado = 'convertida'` o cualquier valor fuera del enum → `'Transición de estado no válida'` (mismo mensaje que una transición ilegal). `aceptada` exige `fecha_validez >= current_date` → si no, `'La cotización está vencida'`. `rechazada` exige motivo no-whitespace (se persiste `trim(p_motivo)` en `motivo_rechazo`); en cualquier otra transición `p_motivo` se ignora y `motivo_rechazo` queda null.
- **`convertir_cotizacion(p_empresa uuid, p_cotizacion uuid) returns uuid`** — rol `dueno`/`admin`/`vendedor`. Atómica: mismo lookup `where id = p_cotizacion and empresa_id = p_empresa for update` (0 filas → `'La cotización no existe'`); exige estado `aceptada` (SIN condición de fecha: la aceptación congeló el trato). **Re-valida por línea contra el producto actual**: sigue activo y `productos.exento = linea.exenta` — si algo cambió, `'Un producto de la cotización ya no está disponible o cambió su condición de IVA; crea una nueva cotización'` (protege la correctitud tributaria: la exención no es negociable). Inserta `documentos_venta` (tipo `'nota_venta'`, estado `'borrador'`, mismo cliente, totales de la cotización; las notas NO viajan — `documentos_venta` no tiene columna de notas) + `documentos_venta_lineas` copiando `producto_id`, `descripcion`, `cantidad`, **`precio_neto` COTIZADO**, `exenta`, `subtotal`; marca `estado = 'convertida'` y enlaza `documento_venta_id`; retorna el id del documento. Doble conversión imposible (check de estado dentro del lock).

Mensajes exactos (contrato de pgTAP): `'Tu rol no permite crear cotizaciones'`, `'Tu rol no permite gestionar cotizaciones'`, `'Tu rol no permite convertir cotizaciones'`, `'Cliente no válido'`, `'Producto no válido'`, `'La cotización necesita al menos una línea'`, `'La cantidad debe ser al menos 1'`, `'El precio debe ser un entero mayor o igual a 0'`, `'La fecha de validez no puede ser anterior a hoy'`, `'Transición de estado no válida'`, `'El rechazo requiere un motivo'`, `'La cotización no existe'`, `'La cotización está vencida'`, `'Solo se puede convertir una cotización aceptada'`, `'Un producto de la cotización ya no está disponible o cambió su condición de IVA; crea una nueva cotización'`.

## 5. App ERP

Menú **"Cotizaciones"** (antes de Ventas):

- **Lista** (`/cotizaciones`): número, cliente, creada, validez, total, estado — insignia **Vencida** SOLO en borrador/enviada con validez pasada (criterio §3; convertida/rechazada/aceptada nunca la muestran); filtros estado + cliente; orden creado_en desc.
- **Nueva** (`/cotizaciones/nueva`): cliente (solo activos), validez (default hoy + 30), líneas dinámicas — al elegir producto se pre-llena `precio_neto` (editable) y se muestra si es exenta; totales en vivo (helpers de `@suite/core`, mismos que ventas); notas. Server Action → RPC.
- **Detalle** (`/cotizaciones/[id]`): encabezado (número, cliente, fechas, estado), líneas con precios cotizados, totales; acciones según estado — **borrador**: Enviar y Rechazar con motivo (la vía de corrección de §2); **enviada**: Aceptar (deshabilitado si vencida, con leyenda) y Rechazar con motivo; **aceptada**: Convertir a venta (siempre habilitado → redirect a `/ventas/[docId]`); **convertida**: link a la nota de venta, sin acciones; **rechazada**: muestra `motivo_rechazo` en el encabezado, sin acciones. Botón **Imprimir** con `@media print` (oculta nav/acciones, muestra razón social de la empresa, líneas, totales, validez).

Ventas, dashboard y reportes NO cambian (la cotización no descuenta stock ni entra al libro; el stock baja al EMITIR la venta, como hoy).

## 6. Manejo de errores

Server Actions validan antes del RPC (cliente/producto seleccionados, cantidades y precios enteros, ≥1 línea, motivo en rechazo) y mapean los mensajes del RPC a español amigable sin ocultar el detalle útil; RLS 0-filas = denegación explícita; transiciones inválidas, dobles conversiones y productos cambiados llegan con mensaje claro del RPC.

## 7. Testing

- **Unitario (@suite/core, TDD):** reusar helpers de totales existentes; DOS funciones puras nuevas: `puedeTransicionarCotizacion(desde, hacia)` (máquina de §3) y `cotizacionVencida(fechaValidez, hoy, estado)` (insignia §3).
- **pgTAP (~18):** aislamiento (tablas), correlativo secuencial (la garantía bajo concurrencia se hereda del advisory lock patrón OC, no se re-testea), matriz de roles (bodeguero Y contador NO cotizan, gestionan ni convierten; vendedor sí), validaciones de crear (línea vacía, cantidad 0, precio negativo, producto ajeno/inactivo, cliente inactivo, validez pasada), transiciones inválidas rechazadas (incluye `p_estado='convertida'` por RPC de estado), rechazo sin motivo y con motivo whitespace fallan, aceptar vencida falla (fixture: backdatear `fecha_validez` a ayer vía UPDATE como service_role — la tabla no tiene check contra creado_en precisamente para permitirlo), cotización de otra empresa → `'La cotización no existe'`, convertir no-aceptada falla, conversión feliz (nota_venta borrador con precios cotizados + enlace + estado convertida), **aceptada vencida SÍ se convierte** (el trato quedó congelado), conversión con producto desactivado o con exención cambiada falla, doble conversión falla, anon 42501.
- **E2E integral:** cotización con descuento (precio menor al de lista) → enviar → aceptar → convertir → nota de venta con precios COTIZADOS (no de lista) → emitir factura → stock baja; rechazada con motivo desde borrador; vencida no aceptable pero aceptada-vencida convertible; correlativos consecutivos; aislamiento org 2; cleanup FK-safe.

## 8. Fuera de v1 (YAGNI)

PDF server-side y envío por correo (Plan 10), versionado/revisiones, duplicar cotización, líneas libres sin producto, margen/costo visible, aprobaciones internas, expiración automática por cron, descuento porcentual explícito (el precio editable lo cubre), re-cotizar automático cuando un producto cambió (el mensaje de conversión lo pide manualmente).

## 9. Criterio de éxito del Plan 9

Un vendedor puede: armar una cotización con descuento en un minuto (precios pre-llenados y ajustables, totales en vivo), imprimirla para el cliente, registrar la aceptación (solo dentro de la vigencia), convertirla en una venta que conserva los precios negociados — incluso si la fecha de validez pasó después de aceptar — y emitir la factura con el flujo de siempre (stock incluido); las vencidas no se pueden aceptar, las rechazadas guardan su motivo y nada se convierte dos veces; los correlativos no se saltan ni repiten (garantizado por el advisory lock, patrón OC ya probado); todo aislado por empresa.
