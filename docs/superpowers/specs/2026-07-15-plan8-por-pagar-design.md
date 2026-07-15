# Diseño: Plan 8 — Cuentas por pagar (facturas de proveedor, pagos realizados, libro de compras SII)

**Fecha:** 2026-07-15
**Estado:** Aprobado por el usuario
**Fase:** 1 del roadmap; octavo plan. Espejo de Cobranza (Plan 6) + la pieza del libro de compras diferida del Plan 7.

## 1. Propósito

Cerrar el ciclo del dinero por el lado de las compras: registrar las facturas que emiten los proveedores (digitación manual — los montos vienen del papel), pagarlas (un pago puede cubrir varias facturas), ver cuánto se debe y qué está vencido, consultar el estado de cuenta de cada proveedor, y entregar el **libro de compras formato SII** con su IVA crédito — la pieza que el Plan 7 difirió explícitamente hasta que existiera este documento.

## 2. Decisiones fundacionales (aprobadas por el usuario)

| Decisión | Elección |
|---|---|
| Alcance v1 | Factura de proveedor manual + pagos realizados multi-documento + CxP + estado de cuenta + libro de compras SII con export CSV |
| Vínculo con OC | **Opcional**: `orden_id` nullable — trazabilidad OC→factura cuando existe, facturas sueltas (luz, arriendo) cuando no |
| NC de proveedor | FUERA de v1: al ser digitación manual, los errores se corrigen anulando la factura con motivo |
| Registro de factura | Insert directo con RLS (patrón maestros): no hay cálculo server-side que proteger; `check` de totales + `unique` de folio guardan la coherencia |
| Pagos | RPCs espejo de Cobranza: atómicas, `for update`, saldo-en-lock, cuadratura exacta, anulación lógica con motivo |
| Roles | Todo CxP = `dueno`/`admin` (pagar dinero no es de vendedores ni bodegueros); lectura = cualquier miembro |
| Dashboard | NO cambia en v1 (los 4 KPIs quedan; lo vencido por pagar vive en su pantalla) |

## 3. Arquitectura y modelo de datos (migración 0013)

Convenciones vigentes: `empresa_id` + RLS + grants explícitos + FK compuestas `(empresa_id, x_id)` + `unique (empresa_id, id)`; CLP entero; español; vistas `security_invoker`.

- **`documentos_compra`** — `empresa_id`, `proveedor_id` (FK compuesta), `tipo` (`check in ('factura','factura_exenta')`), `folio integer` (el del proveedor, `> 0`), `fecha_emision date` (la del documento, digitada), `neto`/`exento`/`iva`/`total` integers `>= 0` con `check (total = neto + exento + iva)`, `orden_id` (FK compuesta NULLABLE a `ordenes_compra`), `notas`, `estado` (`check in ('activa','anulada')` default `activa`), `motivo_anulacion`, `creado_en`. **`unique (empresa_id, proveedor_id, tipo, folio)`** (anti doble-digitación; incluye `tipo` porque factura y factura exenta llevan series de folios SII independientes — 33 y 34) + `unique (empresa_id, id)`.
- **`pagos_proveedor`** — espejo de `pagos`: `proveedor_id` (FK compuesta), `fecha date default hoy`, `metodo` (`efectivo|transferencia|tarjeta|cheque|otro`), `monto > 0`, `referencia`, `notas`, `estado` (`activo|anulado`), `motivo_anulacion`, `creado_en`, `unique (empresa_id, id)`.
- **`pagos_proveedor_aplicaciones`** — espejo: `pago_id` (FK compuesta), `documento_id` (FK compuesta a `documentos_compra`), `monto > 0`, índice `(empresa_id, documento_id)`.
- **`saldos_compras`** (vista `security_invoker`): por `documentos_compra` con `estado = 'activa'`: empresa_id, documento_id, tipo, folio, proveedor_id, proveedor_razon_social, fecha_emision, `fecha_vencimiento = fecha_emision + proveedores.condicion_pago_dias`, total, `pagado` (Σ aplicaciones de pagos activos), `saldo = total − pagado`. (Sin componente de NC: no existen en v1.)
- **`libro_compras`** (vista `security_invoker`): por documento `activa`: empresa_id, documento_id, `fecha` (= fecha_emision), tipo, folio, rut_proveedor, razon_social_proveedor, neto, exento, iva (crédito fiscal), total. Las anuladas NO aparecen.

RLS/grants: `select` a miembros en todo; `documentos_compra` admite `insert` directo de authenticated restringido por policy a `dueno`/`admin` (registro manual) — `update`/`delete` NO (la anulación va por RPC); `pagos_proveedor`/aplicaciones sin escritura directa (solo RPC); service_role completo.

## 4. RPCs (security definer, `set search_path`, revoke anon/public, validan rol y pertenencia)

- **`registrar_pago_proveedor(p_empresa, p_proveedor, p_fecha, p_metodo, p_monto, p_referencia, p_notas, p_aplicaciones jsonb) returns uuid`** — rol `dueno`/`admin`. Copia estructural de `registrar_pago` (0010): valida método/monto/proveedor/≥1 aplicación; por aplicación `select … for update` del documento (activa, del proveedor y la empresa), `monto ≤ saldo` calculado DENTRO del lock, inserta aplicación; cuadratura final `Σ = p_monto`; todo o nada. jsonb: `[{"documentoId": uuid, "monto": int}]`.
- **`anular_pago_proveedor(p_empresa, p_pago, p_motivo)`** — rol `dueno`/`admin`, motivo obligatorio, solo `activo`; las aplicaciones quedan como histórico (la vista deja de sumarlas).
- **`anular_documento_compra(p_empresa, p_documento, p_motivo)`** — rol `dueno`/`admin`, motivo obligatorio, solo `activa`, y **falla con mensaje claro si el documento tiene pagos activos aplicados** ('La factura tiene pagos aplicados; anula primero esos pagos'). Serializado con `for update` del documento (una anulación no puede cruzarse con un pago en vuelo).

Mensajes exactos (contrato de pgTAP): `'Tu rol no permite registrar pagos a proveedores'`, `'Tu rol no permite anular pagos a proveedores'`, `'Tu rol no permite anular facturas de compra'`, `'El monto aplicado supera el saldo del documento (saldo: $%)'`, `'La suma de las aplicaciones debe ser igual al monto del pago'`, `'Documento no válido o no pertenece al proveedor'`, `'La anulación requiere un motivo'`, `'El pago no existe o ya está anulado'`, `'La factura no existe o ya está anulada'`, `'La factura tiene pagos aplicados; anula primero esos pagos'`.

## 5. App ERP

Menú **"Por pagar"** (entre Cobranza y Reportes):

- **CxP** (`/por-pagar`): documentos activos con saldo > 0 (sin NC de proveedor el saldo nunca es negativo: la RPC impide sobre-pagar) — proveedor, tipo/folio, emisión, vencimiento, total, pagado, saldo, insignia **Vencida** (`estaVencido`); filtros proveedor + "solo vencidas"; totales al pie. Botones a Facturas y Registrar pago.
- **Facturas de compra** (`/por-pagar/facturas` + `/por-pagar/facturas/nueva`): lista (proveedor, folio, fecha, total, estado, vínculo a OC si existe) + formulario de registro: proveedor, tipo, folio, fecha de emisión, neto/exento/IVA/total (con validación de cuadre en vivo `total = neto+exento+iva`; el IVA se pre-calcula como 19% del neto editable — la factura del papel manda), OC opcional (selector de OCs del proveedor), notas. Anular con motivo (inline, solo activas).
- **Registrar pago** (`/por-pagar/pagos/nuevo`): espejo del de Cobranza — proveedor por GET → facturas con saldo pre-llenadas → cuadratura en vivo → RPC. **Historial** (`/por-pagar/pagos`) con anulación.
- **Estado de cuenta del proveedor**: sección en `/inventario/proveedores/[id]` (espejo del de cliente: deuda vigente, documentos con saldo, últimos pagos).
- **Reportes**: 4ª tarjeta **"Libro de compras"** (`/reportes/libro-compras?mes=YYYY-MM` + export CSV) — espejo exacto del libro de ventas (misma UX, mismos helpers `rangoDeMes`/`filasACsv`, totales del período al pie; el IVA es crédito fiscal).

## 6. Manejo de errores

Doble digitación de folio → 23505 → 'Ya registraste esa factura de ese proveedor'; totales que no cuadran → validación en vivo + check DB; sobre-pago con saldo en el mensaje; anulaciones con motivos obligatorios y precondiciones claras; RLS 0-filas = denegación explícita; español.

## 7. Testing

- **Unitario:** cero funciones nuevas en core (`saldoDocumento`, `estaVencido`, `cuadraAplicaciones`, `filasACsv`, `rangoDeMes` se reusan) — sin task de core.
- **pgTAP (~16):** aislamiento (tablas + vistas), unique folio por proveedor (23505), matriz de roles (vendedor NO registra factura ni paga), pago feliz multi-factura (saldos bajan), sobre-pago rechazado con saldo exacto, cuadratura rechazada, pago a factura de otro proveedor rechazado, anulación de pago restaura saldo + doble anulación falla, anular factura con pagos activos bloqueada / sin pagos OK, libro excluye anuladas, fecha_vencimiento derivada, anon 42501.
- **E2E integral:** factura con OC + factura suelta → CxP muestra ambas con vencimientos → pago parcial → pago multi-factura → saldos 0 → anular pago → saldo restaurado → anular factura sin pagos OK / con pagos bloqueada → libro de compras del mes cuadra y su CSV parte con BOM → aislamiento → cleanup.

## 8. Fuera de v1 (YAGNI)

NC de proveedor, recepción electrónica de DTE de compra (integración SII), conciliación automática factura↔recepciones valorizadas, retenciones/boletas de honorarios, dashboard card de CxP, multi-moneda, calendario de pagos/flujo de caja proyectado.

## 9. Criterio de éxito del Plan 8

Una pyme puede: digitar la factura del proveedor en un minuto (con o sin OC, sin poder duplicarla), ver cuánto debe y qué está vencido, pagar tres facturas con una transferencia y ver los saldos bajar, anular un pago o una factura mal digitada (con motivo y sin romper la historia), consultar cuánto le debe a cada proveedor, y entregarle al contador el libro de compras del mes en CSV con el IVA crédito cuadrado — todo aislado por empresa con saldos siempre derivados.
