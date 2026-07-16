# Diseño: Plan 12 — Combustible TCT y rentabilidad por vehículo

**Fecha:** 2026-07-15
**Estado:** Aprobado por el usuario; modelado sobre sus 4 reportes TCT REALES; verificación adversarial aplicada (23 hallazgos, 2 críticos)
**Fase:** 2 del roadmap (verticalización), segundo plan. Depende del Plan 11 (flota, ODEs con vehículo asignado).

## 1. Propósito

Cerrar el ciclo económico del camión: importar las cargas de combustible del reporte **TCT Consumos Diarios** de Copec (nivel transacción — los otros 3 reportes de la plataforma son agregaciones que el ERP ahora deriva y supera), registrar gastos manuales por vehículo, y entregar la **rentabilidad mensual por vehículo**: ingresos (ODEs facturadas) − combustible − gastos = margen.

## 2. Decisiones fundacionales (aprobadas por el usuario; calibradas contra sus reportes reales)

| Decisión | Elección |
|---|---|
| Fuente de import | **Consumos Diarios TCT** (único a nivel transacción; 21 columnas). Los agregados (por patente / por estación / matriz mensual) NO se importan: se derivan en la app |
| Formato real (verificado) | UTF-8 **con BOM**; separador coma con comillas; fechas `DD-MM-YYYY`; decimales con COMA (`349,13` L; `392076,000` = $392.076); patentes con guion y padding (`"BBKF-71     "` → `normalizarPatente` → `BBKF71`); RUT chofer `10075262-K` |
| Dedup | **Guía de despacho** única por empresa: contra BD (pre-check por chunks) Y DENTRO del archivo (Set de vistas) — la repetida cuenta como `duplicada`. Fila TCT SIN guía → error de fila (sin guía no hay dedup posible). Re-importar jamás duplica |
| Monto vs precio | `monto` es LA fuente de verdad; `precio_litro` informativo (`'1123,000'` → 1123 vía `parsearMontoTct`). NO se valida `monto = litros × precio`: Copec redondea distinto (real: 349,13 × 1123 = 392.073 ≠ 392.076) — validarlo rompería el import con archivos reales |
| Odómetro | CRUDO (viene basura, casi siempre `1`); km/L y $/km FUERA de v1 |
| Chofer | RUT normalizado se cruza contra `conductores` DE LA EMPRESA → `conductor_id`; **minimización de datos** (Ley 21.719): `rut_chofer` se persiste SOLO cuando NO hubo match (si hay `conductor_id`, el RUT ya vive en `conductores`); finalidad: trazabilidad del import; se elimina con la carga |
| Vehículo del import | Acepta vehículos INACTIVOS (cargas históricas de camiones ya dados de baja); la carga MANUAL solo ofrece activos — asimetría deliberada |
| Costos v1 | Combustible TCT/manual + gastos manuales (peaje, mantención, neumáticos, seguro, permiso, otro) |
| Ingresos | Σ `neto` de ODEs **facturadas** por MES de `fecha_ingreso` (devengo operacional: el mes del flete casa con el mes del diésel que lo movió; facturar tarde re-escribe el mes del servicio retroactivamente — deliberado, coherente con la derivación); ODEs facturadas sin vehículo → fila **"Sin asignar"** |
| Escritura | insert/delete DIRECTO `dueno`/`admin` — **primer delete directo del schema** (patrón NUEVO, justificado: sin máquina de estados ni efectos derivados; corrección = borrar y re-crear); SIN update (ni policy ni grant); `vendedor` NO escribe; lectura miembros |

## 3. Arquitectura y modelo de datos (migración 0017)

Convenciones vigentes: `empresa_id` + RLS + grants explícitos + FK compuestas; CLP entero; litros `numeric(9,2)`; español.

- **`cargas_combustible`** — `empresa_id`, `vehiculo_id` NOT NULL (FK compuesta), `conductor_id` NULLABLE (FK compuesta), `fecha date not null`, `hora time` nullable (**primer uso de `time` en el schema** — PostgREST lo sirve como string `HH:MM:SS`), `litros numeric(9,2) not null check (litros > 0)`, `precio_litro integer` nullable `check (precio_litro > 0)`, `monto integer not null check (monto > 0)`, `estacion text` nullable, `comuna text` nullable, `guia text` nullable, `rut_chofer text` nullable (solo sin match), `tarjeta text` nullable, `odometro integer` nullable (sin check), `producto text not null default 'Diésel'`, `origen text not null check (origen in ('tct','manual'))`, `creado_en`. **Índice único parcial** `(empresa_id, guia) where guia is not null`. Índices `(empresa_id, vehiculo_id, fecha desc)` y `(empresa_id, fecha desc)`. Policies: select miembros; insert `dueno`/`admin` (`with check` rol sobre `empresa_id`); delete `dueno`/`admin` (`using` rol). Grants: `select, insert, delete` a authenticated (SIN update); service_role completo.
- **`gastos_vehiculo`** — `empresa_id`, `vehiculo_id` NOT NULL (FK compuesta), `fecha date not null`, `categoria text not null check (categoria in ('peaje','mantencion','neumaticos','seguro','permiso','otro'))`, `monto integer not null check (monto > 0)`, `notas text` nullable, `creado_en`. Índice `(empresa_id, vehiculo_id, fecha desc)`. Policies/grants idénticos a cargas.
- **Vista `rentabilidad_vehiculo`** (`security_invoker`) — fila por `(empresa_id, vehiculo_id, mes)` con `vehiculo_id` NULLABLE ("Sin asignar"): `mes date`, `ingresos` (Σ `ordenes_entrega.neto`, `estado='facturada'`, mes de `fecha_ingreso`), `combustible` (Σ `cargas_combustible.monto`), `gastos` (Σ `gastos_vehiculo.monto`). UNION de agregados re-agrupado; **SIN cast `::integer` en las sumas** (bigint natural de `sum()` — evita el overflow latente que Plan 7 dejó sin declarar; PostgREST serializa número igual); todos los sub-agregados `group by empresa_id` (la fila Sin asignar no cruza empresas). Margen y % los calcula la página. **`grant select on public.rentabilidad_vehiculo to authenticated, service_role;`** (lección 42501 — pgTAP positivo incluido). Deshacer un estado de pago saca esas ODEs del ingreso automáticamente (derivación).

## 4. `@suite/core` (TDD, con los valores REALES de sus archivos)

- **SE REUSA `parsearCSV`** (ya existe en core: pela BOM, comillas con comas internas, CRLF, auto-detecta `,`/`;`) y **`leerCSV`** de /importar (File→texto con fallback de encoding). NO se crea parser nuevo.
- **`localizarColumnasTct(headers: string[]): ColumnasTct | null`** — match por **igualdad EXACTA** del header normalizado (lowercase, sin tildes, trim): `patente`, `fecha transaccion`, `hora transaccion`, `guia de despacho`, `rut chofer`, `estacion de servicio`, `comuna`, `precio`, `volumen`, `monto`, `odometro (kms.)`, `tarjeta`, `producto` — NUNCA por inclusión (`'tarjeta'` matchearía `'Tipo de Tarjeta'`). Null si falta alguna clave (patente/fecha/volumen/monto/guía). Tests con los DOS headers reales: Consumos Diarios (21 columnas) → índices; Consumos_por_Patente → null.
- **`parsearMontoTct(texto): number | null`** — `'392076,000'` → 392076; `'1.060.459'` → 1060459; `'1123,000'` → 1123; puntos = miles, coma = decimal, redondea a entero; vacío/no-numérico/≤0 → null.
- **`parsearLitrosTct(texto): number | null`** — `'349,13'` → 349.13; ≤0 → null.
- **`parsearFechaTct(texto): string | null`** — `'13-07-2026'` → `'2026-07-13'`; valida **calendario REAL** (round-trip `Date.UTC` comparando componentes): `'31-02-2026'` → null (sin esto, el date inválido revienta el lote en Postgres).
- Reuso: `normalizarPatente`, `limpiarRut`/`validarRut`, `formatearCLP`, `rangoDeMes`, `filasACsv` (el export ya trae guard anti-fórmulas — cubre estaciones con `=`).

## 5. Import TCT (Server Action, patrón /importar endurecido)

`importarCargasTct(formData)`:
1. **Rol ANTES de parsear**: resuelve el rol del usuario en la empresa activa (select a `miembros`) y corta con `'Tu rol no permite importar cargas'` si no es dueno/admin — un vendedor no pone al server a decodificar 10MB. (RLS de insert = backstop.)
2. **Límites**: `archivo.size > 10MB` → error claro; `MAX_FILAS_TCT = 20000` (constante propia — el MAX_FILAS=1000 de /importar queda corto para un año de flota); `next.config` de apps/erp declara `serverActions.bodySizeLimit: '10mb'`.
3. `leerCSV` (BOM/encoding) + `parsearCSV` + `localizarColumnasTct`. Si faltan columnas clave → **guard de archivo y codificación**: si el texto contiene U+FFFD o el `;` domina la primera línea → `'El archivo parece re-guardado desde Excel (codificación o separador alterados); sube el CSV original descargado de TCT'`; si no → `'El archivo no parece el reporte TCT de Consumos Diarios'` (los agregados caen aquí: no traen fecha/volumen/guía).
4. Por fila: patente normalizada → `vehiculos` **`.eq('empresa_id', activa.id)`** (activos o no) → miss = error de fila `'Vehículo con patente X no está registrado en Flota'`; fecha/litros/monto parseados → inválidos = error de fila; guía vacía → error de fila `'sin guía de despacho, no se puede deduplicar'`; hora validada `/^\d{2}:\d{2}(:\d{2})?$/` → si no calza, null (NO es error); **dedup doble**: Set in-file de guías vistas + pre-check contra BD **en chunks de 500** con `.in()` **`.eq('empresa_id', activa.id)`** (el índice es por empresa; sin el filtro, un dueño de dos empresas saltaría cargas reales) → repetida = `duplicadas++`; RUT chofer normalizado → match en `conductores` de la empresa (miss = `rut_chofer` persistido, `conductor_id` null, sin error).
5. Insert en lotes de 500 (`origen='tct'`). **Si un lote falla (23505 residual de carrera / 23503): reintenta ESE lote fila a fila** y reporta solo las caídas — jamás se pierden 499 filas buenas en silencio.
6. Resultado `{importadas, duplicadas, errores: [{fila, motivo}]}` renderizado como /importar.

**TODOS los lookups del import llevan `.eq('empresa_id', activa.id)` explícito** — la RLS es backstop, no filtro funcional.

## 6. App ERP

NAV (module-gated, tras Proformas): **Combustible** (`/combustible`).

- **`/combustible`**: (a) importar TCT (resultado con importadas/duplicadas/errores por fila); (b) carga manual (vehículo ACTIVO, fecha, litros, monto, precio/L opcional, estación opcional); (c) gastos (vehículo, fecha, categoría, monto, notas); (d) lista de cargas del mes — **incluye hora** (`'—'` para manuales; distingue dos cargas del mismo camión el mismo día) — filtros vehículo/mes, totales (L y $), eliminar (confirm); (e) lista de gastos ídem; (f) vistas derivadas del mes: por patente y por estación (los reportes agregados de Copec, ahora vivos). **Todas las queries `.eq('empresa_id', activa.id)`**. Guard `notFound()` módulo off. **Eliminar** (action): `.delete().eq('id').eq('empresa_id', activa.id).select('id')` — 0 filas = error `'No se pudo eliminar'` (la policy filtra en silencio para roles sin permiso: sin el `.select` habría éxito falso).
- **Reportes → tarjeta "Rentabilidad por vehículo"** (visible solo con `activa.modulo_transporte`): **`/reportes/rentabilidad?mes=YYYY-MM`** — por vehículo: ingresos, combustible, gastos, margen $ y % (rojo si negativo), fila Sin asignar, totales; export CSV (`/reportes/rentabilidad/export`, 401/400 antes de query, `filasACsv` — patrón libro de ventas, `.eq('empresa_id', activa.id)` en página Y export).

## 7. Manejo de errores

Import: errores POR FILA sin abortar (con reintento fila-a-fila del lote caído); archivo equivocado/re-guardado → mensajes específicos; guía duplicada (BD o in-file) = contador, no error. Formularios: validación app-side antes del insert; 42501 → `'Tu rol no permite registrar costos'`; eliminar con verificación de filas afectadas. Español.

## 8. Testing

- **Unitario (@suite/core, TDD, ~20):** `localizarColumnasTct` (header real de 21 columnas → índices; header del agregado → null; headers con mojibake → null), `parsearMontoTct` (`'392076,000'`, `'1.060.459'`, `'1123,000'`, `'0,0'` → null, vacío → null), `parsearLitrosTct` (`'349,13'`, `'138,33'`), `parsearFechaTct` (`'13-07-2026'`, `'31-02-2026'` → null, `'2026-07-13'` → null — formato equivocado).
- **pgTAP (~18):** aislamiento (2 tablas + vista con **pgTAP positivo**: miembro lee la vista y ve SOLO su empresa), matriz de roles (vendedor NO inserta carga/gasto — 42501 por policy de insert; **delete de vendedor afecta 0 FILAS y la fila sigue viva** — el grant existe, la policy filtra: NO es 42501), update → 42501 (grant ausente — candado tipo cotizaciones #26), delete cross-tenant afecta 0 filas, guía única por empresa (23505; misma guía en OTRA empresa sí entra), checks (litros 0, monto 0, categoría inválida), vista con fixture a mano (ODE facturada 100000 julio + carga 30000 + gasto 20000 → 100000/30000/20000; ODE sin vehículo → fila null; ODE `registrada` NO suma; carga de agosto NO aparece en julio), anon 42501.
- **E2E integral:** fixture in-script de **7 filas** — 5 con patentes registradas + 2 con JDVJ88/XD2682 SIN registrar (las patentes reales del usuario) + 1 guía repetida in-file → primera pasada: **5 importadas, 1 duplicada (in-file), 2 errores**; re-importar el MISMO archivo → **0 importadas, 6 duplicadas, 2 errores** (las 5 insertadas + la repetida in-file ahora TODAS chocan contra BD; las filas con error se re-reportan como error, NO como duplicadas); conductor con RUT `10075262-K` creado antes → su carga queda con `conductor_id` y `rut_chofer` null; fila con RUT no registrado → `conductor_id` null y `rut_chofer` persistido; subir el reporte AGREGADO → rechazo con mensaje de archivo equivocado; contenido re-codificado Latin-1 → mensaje de Excel, 0 insertadas; carga manual + gasto → rentabilidad del mes cuadra a mano (con Sin asignar); export CSV parte con BOM; aislamiento org 2; cleanup a 0.

## 9. Fuera de v1 (YAGNI)

Web Service TCT (adaptador cuando haya convenio; el CSV queda como fallback permanente), km/L y $/km, reporte por conductor (dato capturado), alertas de consumo anómalo, edición de cargas/gastos, **dedup de cargas manuales** (sin guía no hay clave: re-digitar duplica y se corrige eliminando — aceptado), BlueMax sin tratamiento especial (columna producto), prorrateo de gastos generales, import de reportes agregados.

## 10. Criterio de éxito del Plan 12

El transportista sube su Consumos Diarios TAL CUAL sale de Copec y el ERP lo traga (BOM, comas decimales, patentes con guion); re-importar no duplica NUNCA (ni contra BD ni dentro del archivo) y ninguna fila buena se pierde por culpa de una mala; si el archivo viene re-guardado de Excel, el mensaje se lo dice; los choferes quedan cruzados con su flota y los RUT de terceros minimizados; lo que Copec daba en 3 reportes ahora vive filtrable y cuadrado; y la rentabilidad mensual por camión — ingresos de fletes, diésel, gastos, margen — sale sola, con la fila "Sin asignar" delatando ODEs sin vehículo. Vendedores no tocan costos; el pipeline queda verde.
