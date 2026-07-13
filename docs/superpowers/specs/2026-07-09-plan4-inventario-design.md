# Diseño: Plan 4 — Inventario + Proveedores (con integración a Ventas)

**Fecha:** 2026-07-09
**Estado:** Aprobado por el usuario
**Fase:** 1 del roadmap; cuarto plan de implementación tras Fundación (1), Maestros (2) y Ventas+DTE (3).

## 1. Propósito

Dar al ERP control de inventario real: stock por bodega calculado a partir de un libro de movimientos inmutable, y cerrar el círculo con el módulo de ventas — al emitir una factura o boleta el stock se descuenta automáticamente, y al emitir una nota de crédito se restituye. Incorpora también el maestro de proveedores (espejo de clientes), que queda listo para el futuro módulo de Compras.

## 2. Decisiones fundacionales (aprobadas por el usuario)

| Decisión | Elección |
|---|---|
| Alcance v1 | Bodegas + Proveedores + Movimientos de stock + integración con Ventas |
| Multi-bodega | Sí, con "Bodega Principal" auto-creada por empresa; traslados entre bodegas |
| Stock actual | Vista `security_invoker` que agrega el libro de movimientos; nunca un número editable |
| Stock insuficiente al emitir | Permitir y marcar (stock negativo con indicador "sobrevendido"); **no** bloquear la venta |
| Nota de crédito | Restituye stock (movimientos `entrada`) |
| Fuera de v1 | Órdenes de compra y recepción formal → Plan 5 "Compras" (proveedores queda como maestro) |

## 3. Arquitectura y modelo de datos (migración 0008)

Todas las tablas con `empresa_id` + RLS + grants explícitos + FK compuestas por tenant `(empresa_id, x_id)` (convención de Planes 2-3). Escrituras de negocio server-side; identificadores ASCII; dominio en español; CLP entero.

- **`bodegas`** — `empresa_id`, `nombre`, `direccion`, `activo`. `unique (empresa_id, nombre)`, `unique (empresa_id, id)`. CRUD desde el ERP. Baja lógica (`activo`).
- **`proveedores`** — mismo patrón que `clientes`: `empresa_id`, `rut` (normalizado + `check (rut = app.normalizar_rut(rut) and app.validar_rut(rut))`), `razon_social`, `giro`, `email`, `telefono`, `direccion`, `comuna`, `condicion_pago_dias`, `activo`. `unique (empresa_id, rut)`, `unique (empresa_id, id)`.
- **`movimientos_stock`** — libro **inmutable**:
  - `empresa_id`, `producto_id` (FK compuesta), `bodega_id` (FK compuesta), `tipo` (`check in ('entrada','salida','ajuste','traslado')`), `cantidad` (integer con signo: entrada/traslado-destino positivo, salida/traslado-origen negativo, ajuste cualquiera; `check cantidad <> 0`), `motivo`, `referencia_documento_id` (FK compuesta a `documentos_venta`, nullable — para las salidas/entradas por venta/NC), `creado_en`.
  - Solo `select` e `insert` para `authenticated`/`service_role`; **sin update ni delete** — las correcciones son movimientos inversos. Un traslado se registra como dos filas (salida en origen, entrada en destino).
  - Índice `(empresa_id, producto_id, bodega_id)` para el agregado.
- **`stock_actual`** — `create view public.stock_actual with (security_invoker = true) as select empresa_id, producto_id, bodega_id, sum(cantidad) as cantidad from movimientos_stock group by 1,2,3`. Con `security_invoker` la RLS de `movimientos_stock` aplica al usuario que consulta (Postgres 15+; el proyecto usa 17).
- **`productos.stock_minimo`** — columna nueva `integer not null default 0` para alertas de stock crítico.
- **Bodega por defecto:** función `public.bodega_por_defecto(p_empresa uuid) returns uuid` (security definer, valida pertenencia) que devuelve la primera bodega activa de la empresa, creando "Bodega Principal" si no existe. La usan la emisión y la UI para no bloquearse cuando la empresa aún no creó bodegas.
- **RPCs de movimientos** (security definer, validan rol y pertenencia): `registrar_entrada`, `registrar_ajuste`, `registrar_traslado` — insertan los movimientos con el signo correcto. Roles de escritura: `dueno`/`admin`/`bodeguero` para movimientos y bodegas; `dueno`/`admin` para proveedores. Lectura: cualquier miembro.

## 4. Integración con Ventas (modifica `apps/erp/app/ventas/emitir.ts` del Plan 3)

- Tras una emisión exitosa de **factura/boleta** (`estado 'emitido'`): insertar, vía el cliente admin (server-side), un movimiento `salida` por cada línea con producto — `cantidad = -linea.cantidad`, `bodega_id = bodega_por_defecto(empresa)`, `referencia_documento_id = documento`, `motivo = 'Venta ' + tipo + ' folio ' + folio`. **No** se bloquea ni revierte la emisión si el stock queda negativo (decisión "permitir y marcar").
- Tras una emisión exitosa de **nota de crédito**: insertar movimientos `entrada` (positivos) restituyendo el stock de las líneas del documento referenciado, con `referencia_documento_id = NC` y motivo de anulación.
- Idempotencia: los movimientos por venta se insertan solo cuando la emisión pasa a `emitido` (una vez), no en cada reintento; se evita duplicar comprobando que no exista ya un movimiento con esa `referencia_documento_id` para ese producto.

## 5. App ERP

Nueva entrada de menú **Inventario** (antes de "Configuración"), con subvistas y reuso de `@suite/ui`, `obtenerEmpresaActiva` y el patrón de Server Actions de Planes 2-3:

- **Bodegas** — lista + crear/editar; baja lógica.
- **Proveedores** — CRUD idéntico en forma a Clientes (validación de RUT, búsqueda, paginación, baja lógica).
- **Movimientos** — lista con filtros (producto, bodega, tipo, fecha) y formularios: **entrada** (producto, bodega, cantidad, proveedor opcional, motivo), **ajuste** (producto, bodega, cantidad ±, motivo obligatorio), **traslado** (producto, bodega origen, bodega destino, cantidad).
- **Stock en Productos** — la lista y el detalle de productos muestran el stock por bodega y el total, con indicador de **stock mínimo** (alerta cuando total ≤ `stock_minimo`). El formulario de producto gana el campo `stock_minimo`.
- **Dashboard** — el contador "stock crítico" (productos bajo mínimo) reemplaza su placeholder.

## 6. Manejo de errores

- Movimientos atómicos (RPC en una transacción); traslado inserta las dos filas o ninguna.
- Validación de pertenencia y rol server-side en cada RPC y Server Action; empresa siempre de `obtenerEmpresaActiva()`, jamás del formulario.
- Ajuste exige motivo; traslado exige bodegas distintas y cantidad > 0.
- El descuento por venta nunca hace fallar la emisión: si el registro del movimiento fallara, se registra el error pero el documento queda emitido (el stock se puede reconciliar con un ajuste).
- Mensajes al usuario en español claro.

## 7. Testing

- **Unitario (Vitest, TDD en `@suite/core`):** helper de construcción de movimientos con signo por tipo (entrada +, salida −, traslado origen/destino), y cálculo de si un producto está bajo mínimo.
- **Integración (pgTAP):** aislamiento multi-tenant de las 3 tablas nuevas; correctitud de la vista `stock_actual` (suma de movimientos); inmutabilidad (update/delete denegados); matriz de roles; que `bodega_por_defecto` valida pertenencia.
- **E2E (contra el mock de Plan 3):** entrada sube el stock → emitir factura baja el stock (salida con referencia) → nota de crédito lo restituye → traslado mueve entre bodegas dejando el total igual → un producto bajo mínimo aparece como crítico → aislamiento entre empresas.

## 8. Fuera de v1 (YAGNI)

Órdenes de compra, recepción formal de mercadería, costo promedio ponderado / valorización de inventario, lotes y vencimientos, códigos de barra en el flujo de bodega, selección de bodega por línea de venta (v1 usa la bodega por defecto). Todo esto va a planes posteriores; el modelo de datos no se complica por anticiparlos.

## 9. Criterio de éxito del Plan 4

Una pyme puede: crear bodegas y proveedores, registrar entradas de mercadería, ajustar y trasladar stock, ver el stock actual por bodega de cada producto con alertas de mínimo, y — al emitir una factura o boleta — ver el stock descontarse automáticamente (y restituirse al anular con nota de crédito), todo aislado por empresa y con el stock siempre derivado de un libro de movimientos auditable e inmutable.
