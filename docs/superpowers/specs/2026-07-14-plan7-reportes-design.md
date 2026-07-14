# Diseño: Plan 7 — Reportes (libro de ventas SII, ventas por período, valorización, export CSV)

**Fecha:** 2026-07-14
**Estado:** Aprobado por el usuario
**Fase:** 1 del roadmap; séptimo plan tras Fundación, Maestros, Ventas+DTE, Inventario, Compras y Cobranza.

## 1. Propósito

Darle a la pyme (y a su contador) los reportes que pide todos los meses: el libro de ventas en formato SII, las ventas por período con top de productos, y la valorización del inventario — todo consultable en pantalla y exportable a CSV que Excel abre con doble clic. Solo lectura derivada de los datos que ya existen: sin tablas nuevas, sin RPCs de escritura.

## 2. Decisiones fundacionales (aprobadas por el usuario)

| Decisión | Elección |
|---|---|
| Alcance v1 | Libro de VENTAS (SII) + ventas por período/producto + valorización de inventario + exports CSV |
| Libro de compras | DIFERIDO al Plan 8 (CxP): el formato SII exige folio/RUT/IVA crédito de la factura de proveedor, documento que aún no existe. No se construye una aproximación desechable |
| "Por vendedor" | EXCLUIDO: requiere la columna de auditoría `creado_por` en documentos_venta (diferida a Task 13 del Plan 3) |
| Export | CSV compatible con Excel: UTF-8 con BOM + separador `;` (Excel es-CL lo abre perfecto). Sin dependencia .xlsx |
| Arquitectura | Enfoque A: vistas SQL `security_invoker` agregadoras (filosofía `stock_actual`/`saldos_documentos`); pantalla y export consultan la MISMA vista |
| Valorización | Stock actual × ÚLTIMO costo de recepción conocido por producto (sin costo promedio — fuera de v1 desde Plan 5); productos sin costo se muestran marcados |

## 3. Arquitectura y modelo de datos (migración 0011 — solo vistas)

Convenciones vigentes: `security_invoker = true` (la RLS del consultante aplica), grants select explícitos a authenticated/service_role, CLP entero, identificadores ASCII.

- **`libro_ventas`** — una fila por documento tributario **emitido** (`tipo in ('factura','boleta','nota_credito')`): `empresa_id`, `documento_id`, `fecha` (`emitido_en::date`), `tipo`, `folio`, `rut_cliente`, `razon_social_cliente`, `neto`, `exento`, `iva`, `total`. **Las notas de crédito llevan TODOS sus montos con signo negativo** (multiplicados por −1), como exige el formato del libro: los totales del período cuadran restando las NC. Las `nota_venta` quedan fuera (no son documento tributario).
- **`ventas_diarias`** — agregada por día sobre el mismo conjunto: `empresa_id`, `fecha`, `documentos` (count), `neto`, `iva`, `total` (sumas con el signo de NC ya aplicado).
- **`valorizacion_inventario`** — por producto activo: `empresa_id`, `producto_id`, `sku`, `nombre`, `stock` (suma de movimientos, puede ser 0 o negativo), `costo_unitario` (el de la **recepción más reciente** del producto, vía lateral a `recepciones_lineas`+`recepciones`; NULL si nunca se recibió), `valor` (`stock × costo_unitario`, NULL si sin costo).

Sin tablas nuevas, sin RPCs, sin cambios a datos existentes. Grants: `select` a authenticated y service_role en las 3 vistas.

## 4. App ERP

Menú **Reportes** (entre Cobranza y Configuración), índice con 3 tarjetas:

- **Libro de ventas** (`/reportes/libro-ventas?mes=YYYY-MM`, default mes actual): tabla formato SII (fecha, tipo, folio, RUT, razón social, neto, exento, IVA, total) ordenada por fecha+folio, totales del período al pie (con NC restando), selector de mes, botón **Exportar CSV**.
- **Ventas por período** (`/reportes/ventas?desde=YYYY-MM-DD&hasta=YYYY-MM-DD`, default mes actual): tabla por día desde `ventas_diarias` + top 10 productos del rango (cantidad y neto, agregado en el server sobre `documentos_venta_lineas` de documentos emitidos del rango, NC excluidas del top), totales, export CSV del detalle diario.
- **Valorización de inventario** (`/reportes/valorizacion`): tabla por producto (sku, nombre, stock, costo unitario, valor), productos sin costo marcados "sin costo", total general valorizado al pie, export CSV.

**Exports** — 3 route handlers GET (`app/reportes/libro-ventas/export/route.ts`, etc.): validan sesión + `obtenerEmpresaActiva()` (401/redirect si no), consultan la MISMA vista con los mismos filtros, responden `text/csv; charset=utf-8` con `Content-Disposition: attachment` y nombre con período (`libro-ventas-2026-07.csv`). El CSV se arma con un helper de `@suite/core`: BOM inicial (escape `&#xFEFF;`, jamás el carácter literal en el fuente), separador `;`, comillas escapadas, y **protección contra inyección de fórmulas** (celdas que empiezan con `=`, `+`, `-`, `@` se prefijan con `'` — un nombre de cliente malicioso no debe ejecutar fórmulas en el Excel del contador).

## 5. Manejo de errores

- Parámetros de período inválidos (mes malformado, desde > hasta) → se normalizan al default (mes actual) en pantalla; en el export, 400 con mensaje.
- Períodos sin datos → tabla vacía con mensaje y CSV solo con encabezados (no error).
- Export sin sesión/empresa → redirect a login (mismo guard del resto del ERP).
- Mensajes en español.

## 6. Testing

- **Unitario (Vitest, TDD en `@suite/core`):** `filasACsv(encabezados, filas)` — separador `;`, escape de comillas/saltos, BOM, protección de fórmulas; `montosLibro(doc)` — signo negativo para NC; helpers de período (mes → rango).
- **Integración (pgTAP):** `libro_ventas` incluye factura/boleta emitidas y NC con montos negativos, excluye borradores y notas de venta; `ventas_diarias` cuadra con el libro; `valorizacion_inventario` usa el costo de la recepción MÁS RECIENTE y NULL sin recepciones; aislamiento multi-tenant de las 3 vistas; anon denegado.
- **E2E integral:** factura + boleta + NC en un mes → el libro muestra 3 filas y el total neto cuadra (factura + boleta − NC); export CSV descarga, empieza con BOM, parsea con `;` y sus totales cuadran con la pantalla; valorización = stock × último costo tras dos recepciones a costos distintos (usa el segundo); aislamiento.

## 7. Fuera de v1 (YAGNI)

Libro de compras (→ Plan 8 con factura de proveedor), ventas por vendedor (→ requiere `creado_por`, Task 13), export .xlsx nativo, reportes en PDF, costo promedio ponderado / FIFO, comparativas entre períodos, gráficos, programación de envío de reportes por correo (→ Plan 10).

## 8. Criterio de éxito del Plan 7

El contador de la pyme puede: abrir el libro de ventas de julio, verificar que los totales cuadran (las NC restando), descargarlo en CSV y abrirlo en Excel sin romper tildes ni formato; el dueño puede ver cuánto vendió por día en un rango, cuáles son sus 10 productos top, y cuánto vale el inventario que tiene en bodega — todo aislado por empresa y derivado en el momento de los datos reales, sin números almacenados que puedan desactualizarse.
