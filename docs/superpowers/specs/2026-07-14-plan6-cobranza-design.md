# Diseño: Plan 6 — Cobranza (pagos recibidos + cuentas por cobrar)

**Fecha:** 2026-07-14
**Estado:** Aprobado por el usuario
**Fase:** 1 del roadmap; sexto plan tras Fundación (1), Maestros (2), Ventas+DTE (3), Inventario (4) y Compras (5).

## 1. Propósito

Cerrar el ciclo del dinero por el lado de la venta: registrar los pagos que los clientes hacen contra sus documentos (una transferencia puede pagar varias facturas), ver el saldo de cada documento y de cada cliente, detectar las cuentas por cobrar vencidas en el dashboard, y anular pagos mal registrados sin perder el histórico. Los saldos son SIEMPRE derivados (vista), jamás un número editable — la misma filosofía que el stock.

## 2. Decisiones fundacionales (aprobadas por el usuario)

| Decisión | Elección |
|---|---|
| Alcance v1 | Solo cobranza (CxC): pagos recibidos de clientes contra documentos de venta. CxP/factura de proveedor → plan posterior |
| Modelo de pago | Multi-documento: un pago (cabecera) se aplica a varios documentos con montos parciales (detalle), espejo del patrón recepciones |
| Saldos | Derivados en vista `security_invoker`; nunca almacenados. Enfoque A aprobado (vs libro de cuenta corriente o columna con trigger) |
| Sobre-pago | Un saldo puede quedar negativo por una NC posterior → permitido y marcado "a favor" (consistente con stock negativo) |
| Anulación | Baja lógica con motivo obligatorio (`activo → anulado`), nunca delete; el saldo se restaura solo porque la vista suma solo pagos activos |

## 3. Arquitectura y modelo de datos (migración 0010)

Convenciones vigentes (Planes 2-5): `empresa_id` + RLS + grants explícitos + FK compuestas `(empresa_id, x_id)` + `unique (empresa_id, id)`; escrituras de negocio vía RPC security definer; CLP entero; identificadores ASCII, dominio en español.

- **`pagos`** — `empresa_id`, `cliente_id` (FK compuesta), `fecha date not null default hoy`, `metodo` (`check in ('efectivo','transferencia','tarjeta','cheque','otro')`), `monto integer check (> 0)`, `referencia` (n° operación/cheque, nullable), `notas`, `estado` (`check in ('activo','anulado')`, default `activo`), `motivo_anulacion`, `creado_en`.
- **`pagos_aplicaciones`** — `empresa_id`, `pago_id` (FK compuesta), `documento_id` (FK compuesta a `documentos_venta`), `monto integer check (> 0)`. Índice `(empresa_id, documento_id)` para la vista de saldos.
- **`saldos_documentos`** — vista `with (security_invoker = true)`: por cada documento de venta **emitido** de tipo `factura`/`boleta`: `total`, `pagado` (Σ aplicaciones de pagos con `estado = 'activo'`), `notas_credito` (Σ `total` de NC en estado `emitido` cuyo `documento_referencia_id` lo referencia), `saldo = total − pagado − notas_credito`, y `fecha_vencimiento` derivada = `emitido_en + condicion_pago_dias` del cliente (valor ACTUAL — tolerancia v1: cambiar la condición del cliente recalcula vencimientos históricos; documentado). Las `nota_venta` y las NC no son cobrables y no aparecen como filas de la vista.

RLS: `select` para miembros en ambas tablas y la vista. Escrituras SOLO vía RPC (sin insert/update directo de `authenticated` — ni siquiera de columnas: la anulación también es RPC, a diferencia de las transiciones de OC, porque exige motivo y regla de rol distinta). `service_role` con grants completos.

## 4. RPCs (security definer, `set search_path`, revoke anon/public, validan rol y pertenencia)

- **`registrar_pago(p_empresa uuid, p_cliente uuid, p_fecha date, p_metodo text, p_monto integer, p_referencia text, p_notas text, p_aplicaciones jsonb) returns uuid`** — roles `dueno`/`admin`/`vendedor` (en la pyme el vendedor cobra). Forma jsonb: `[{"documentoId": uuid, "monto": integer}]`. **Atómica y serializada**: bloquea los documentos aplicados (`select … for update` sobre `documentos_venta`) para serializar pagos concurrentes al mismo documento; valida: método permitido, `p_monto > 0`, ≥1 aplicación, cada documento pertenece a la empresa Y al cliente, está `emitido` y es `factura`/`boleta`, cada `monto > 0` y `≤ saldo` vigente del documento (calculado dentro del lock), y **cuadratura exacta**: `Σ montos aplicados = p_monto`. Inserta cabecera + aplicaciones, todo o nada.
- **`anular_pago(p_empresa uuid, p_pago uuid, p_motivo text) returns void`** — solo `dueno`/`admin`; motivo obligatorio (trim ≠ ''); exige `estado = 'activo'` (anular dos veces falla explícito); marca `anulado` + motivo. No toca las aplicaciones: quedan como histórico y la vista deja de sumarlas.

**Matriz de roles:** registrar pago = `dueno`/`admin`/`vendedor`; anular pago = `dueno`/`admin`; lectura = cualquier miembro.

## 5. App ERP

Menú **Cobranza** (entre Compras y Configuración):

- **Cuentas por cobrar** (índice, `/cobranza`): documentos con `saldo > 0` (y los "a favor" con saldo < 0 marcados) — cliente, tipo/folio, emisión, **vencimiento**, total, pagado, saldo; insignia **Vencida** (roja) cuando `hoy > fecha_vencimiento` y saldo > 0. Filtros: cliente (selector) y "solo vencidas" (checkbox). Totales al pie (por cobrar / vencido).
- **Registrar pago** (`/cobranza/pagos/nuevo`): selector de cliente → tabla de sus documentos con saldo, montos a aplicar pre-llenados con el saldo (editables hacia abajo, mínimo 0 = no aplicar), método + fecha + referencia + notas; la cuadratura (Σ aplicado vs monto) se muestra en vivo y el submit se deshabilita si no cuadra o si Σ = 0. Llama `registrar_pago`.
- **Pagos** (`/cobranza/pagos`): historial — fecha, cliente, método, monto, documentos aplicados, estado; botón **Anular** (form con motivo) visible solo en pagos activos.
- **Estado de cuenta por cliente**: en el detalle del cliente existente (`/clientes/[id]`), una sección nueva con sus documentos cobrables (total/pagado/saldo/vencimiento) y sus pagos.
- **Dashboard**: tarjeta **"Por cobrar vencido"** (monto $ total y n° de documentos vencidos) con enlace a `/cobranza?vencidas=1`.

## 6. Manejo de errores

- Sobre-aplicación rechazada con el saldo en el mensaje: `'El monto aplicado supera el saldo del documento (saldo: $N)'`.
- Cuadratura: `'La suma de las aplicaciones debe ser igual al monto del pago'`.
- Documento no cobrable (no emitido / tipo NC o nota de venta / de otro cliente): mensajes específicos.
- Anulación sin motivo o de un pago ya anulado: rechazo explícito.
- Validación de pertenencia y rol server-side en cada RPC; empresa siempre de `obtenerEmpresaActiva()`, jamás del formulario; RLS 0-filas = denegación explícita.
- Mensajes al usuario en español claro.

## 7. Testing

- **Unitario (Vitest, TDD en `@suite/core`):** `saldoDocumento(total, pagado, notasCredito)`, `estaVencido(fechaVencimiento, hoy)` (sin saldo no hay vencida), validación de cuadratura de aplicaciones, formateo.
- **Integración (pgTAP):** aislamiento multi-tenant de pagos/aplicaciones/vista; matriz de roles (contador no registra pago; vendedor sí; vendedor NO anula); pago feliz multi-documento (saldos bajan); sobre-aplicación rechazada con saldo en el mensaje; cuadratura rechazada; anulación restaura saldo y doble anulación falla; NC emitida neta el saldo del original; pago a documento de otro cliente rechazado; anon denegado.
- **E2E integral:** factura emitida (mock) → pago parcial → saldo baja → segundo pago multi-documento (2 facturas de una) → saldo 0 → anular el primero → saldo restaurado → NC neta el saldo → documento vencido aparece en el conteo del dashboard → aislamiento entre empresas.

## 8. Fuera de v1 (YAGNI)

Cuentas por pagar y factura de proveedor, conciliación bancaria, pasarela de pago online, intereses/mora, recordatorios por correo, caja/arqueo diario, estados de cheque (en cartera/depositado/protestado), retenciones, pagos en moneda extranjera.

## 9. Criterio de éxito del Plan 6

Una pyme puede: registrar una transferencia que paga tres facturas de una vez, ver los saldos bajar al instante, detectar en el dashboard cuánto y cuántos documentos tiene vencidos, revisar cuánto le debe cada cliente en su estado de cuenta, y anular un pago mal registrado (con motivo, sin borrar el histórico) viendo el saldo restaurarse — todo aislado por empresa, con roles respetados y saldos siempre derivados del libro de pagos, jamás editables.
