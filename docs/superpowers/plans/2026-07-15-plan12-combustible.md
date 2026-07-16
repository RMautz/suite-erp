# Plan 12: Combustible TCT y rentabilidad por vehículo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Importar el reporte TCT Consumos Diarios de Copec tal cual se descarga (dedup doble por guía, sin perder filas buenas), registrar gastos manuales por vehículo, y entregar la rentabilidad mensual por vehículo (ingresos de ODEs facturadas − combustible − gastos) con export CSV.

**Architecture:** Migración 0017 SIN RPCs: `cargas_combustible` y `gastos_vehiculo` con insert/delete directo dueno/admin (primer delete directo del schema — sin máquina de estados ni efectos derivados) y vista `rentabilidad_vehiculo` security_invoker (sumas en bigint). Import como Server Action endurecida (rol pre-parse, límites, guard de Excel, dedup in-file + BD por chunks, retry fila-a-fila del lote caído). Parsers TCT en `@suite/core` con los valores REALES del usuario como contrato. UI bajo el módulo transporte.

**Tech Stack:** Postgres 17 (RLS, pgTAP), Next.js 15 Server Actions, Vitest (TDD), Tailwind CSS 4.

**Spec:** `docs/superpowers/specs/2026-07-15-plan12-combustible-design.md` (verificado, 23 hallazgos aplicados; §3 schema, §4 core, §5 import y §8 tests son CONTRATO).

## Global Constraints

- Multi-tenant: `empresa_id` + RLS + grants explícitos; FK compuestas `(empresa_id, x_id)`; app queries y TODOS los lookups del import con `.eq('empresa_id', activa.id)` (la RLS es backstop, no filtro funcional).
- `cargas_combustible`/`gastos_vehiculo`: policies select miembros / insert dueno-admin (`with check` rol) / **delete dueno-admin** (`using` rol) — PRIMER delete directo del schema, declarado; **SIN update** (ni policy ni grant — candado pgTAP tipo cotizaciones #26); grants `select, insert, delete` a authenticated; service_role completo. `vendedor` NO escribe costos.
- Vista `rentabilidad_vehiculo` security_invoker: fila por (empresa_id, vehiculo_id NULLABLE, mes); ingresos = Σ `ordenes_entrega.neto` con `estado='facturada'` por mes de `fecha_ingreso`; combustible/gastos por mes de `fecha`; **SIN cast `::integer` en las sumas** (bigint natural); sub-agregados `group by empresa_id`; **`grant select` a authenticated y service_role** (lección 42501; pgTAP positivo además del anon).
- Dedup del import: guía única por empresa (índice único parcial `where guia is not null`); dedup DOBLE — Set in-file + pre-check BD en **chunks de 500** con `.in()` + `.eq('empresa_id')`; repetida = `duplicadas++`; fila TCT con guía vacía = error de fila. Si un lote de insert falla (23505 carrera / 23503): **reintentar ESE lote fila a fila** y reportar solo las caídas.
- Import: rol dueno/admin resuelto ANTES de parsear (select a `miembros`; si no → `'Tu rol no permite importar cargas'`); `archivo.size > 10MB` → error; `MAX_FILAS_TCT = 20000`; `next.config` de apps/erp gana `experimental.serverActions.bodySizeLimit: '10mb'` (verificar la clave exacta para la versión de Next 15 instalada); guard de archivo/codificación: U+FFFD o `;` dominante → mensaje de Excel; columnas clave ausentes → `'El archivo no parece el reporte TCT de Consumos Diarios'`.
- Core (contrato §4): SE REUSA `parsearCSV` y `leerCSV` existentes (NO crear parser CSV nuevo). Nuevos: `localizarColumnasTct(headers: string[]): ColumnasTct | null` (igualdad EXACTA post-normalización lowercase/sin tildes/trim; claves: patente/fecha transaccion/volumen/monto/guia de despacho; opcionales: hora transaccion/rut chofer/estacion de servicio/comuna/precio/odometro (kms.)/tarjeta/producto; JAMÁS por inclusión), `parsearMontoTct` (`'392076,000'`→392076, `'1.060.459'`→1060459, `'1123,000'`→1123, `'0,0'`→null), `parsearLitrosTct` (`'349,13'`→349.13), `parsearFechaTct` (`'13-07-2026'`→`'2026-07-13'`, calendario REAL round-trip: `'31-02-2026'`→null).
- Reglas de fila del import (§5): patente `normalizarPatente` → vehiculos de la empresa (activos O NO — histórico deliberado; el form manual solo activos); miss → `'Vehículo con patente X no está registrado en Flota'`; hora `/^\d{2}:\d{2}(:\d{2})?$/` → si no, null SIN error; RUT chofer normalizado → match conductores de la empresa: match → `conductor_id` y `rut_chofer` NULL; miss → `conductor_id` null y `rut_chofer` persistido (minimización Ley 21.719); `monto` fuente de verdad, NO validar `monto = litros × precio` (real: 349,13×1123=392.073≠392.076); `precio` con parsearMontoTct; `origen='tct'`; lotes de 500.
- Eliminar (action): `.delete().eq('id').eq('empresa_id', activa.id).select('id')` — 0 filas = error (la policy filtra en silencio: sin `.select` habría éxito falso). pgTAP: delete de vendedor afecta **0 FILAS** (NO 42501 — el grant existe); delete cross-tenant 0 filas.
- UI: NAV `Combustible` → `/combustible` module-gated tras Proformas; guard `notFound()`; lista de cargas MUESTRA hora (`'—'` manuales); tarjeta de Reportes "Rentabilidad por vehículo" visible solo con `activa.modulo_transporte`; `/reportes/rentabilidad?mes=` + `/reportes/rentabilidad/export` (401/400 antes de query, `filasACsv`); margen $ y % en la página (rojo negativo); fila Sin asignar; español.
- Conteos finales: pgTAP **211** (193 + 18, `plan(18)`), unit **138** (core 126 = 106+20, auth 2, dte 10), 3 apps build.
- CERO BOM literal (secuencia de escape backslash-uFEFF, jamás el carácter; byte-scan = 0, `grep -c` exit 1 = pass); UTF-8 sin BOM; Windows/PowerShell 5.1 (`&&` no encadena; prefijar el refresh de PATH).

---
### Task 1: Migración 0017 — cargas, gastos y vista de rentabilidad

**Files:**
- Create: `supabase/migrations/00000000000017_combustible.sql`

**Interfaces:**
- Consumes: `vehiculos` y `conductores` con `unique (empresa_id, id)` (0016 — blancos de las FK compuestas), `ordenes_entrega` (0016 — columnas `estado`/`vehiculo_id`/`fecha_ingreso`/`neto` verificadas contra la migración real), `empresas` (FK de `empresa_id`), `app.mis_empresas()`/`app.tiene_rol_en_empresa()` (0003).
- Produces: tablas `cargas_combustible` y `gastos_vehiculo` (RLS: select miembros; insert y **delete** dueno/admin — PRIMER delete directo del schema; **SIN update**: ni policy ni grant); índice único parcial `(empresa_id, guia) where guia is not null` (la clave del dedup del import); vista `rentabilidad_vehiculo` security_invoker con `grant select` a authenticated y service_role.
- SIN RPCs: cargas y gastos no tienen máquina de estados ni efectos derivados — corrección = borrar y re-crear. El contrato queda fijado por pgTAP en Task 2.

- [ ] **Step 1: Escribir la migración**

`supabase/migrations/00000000000017_combustible.sql`:

```sql
-- Combustible y gastos por vehiculo (Plan 12): cargas de combustible (import
-- TCT de Copec y carga manual), gastos manuales por vehiculo y vista de
-- rentabilidad mensual (ingresos de ODEs facturadas - combustible - gastos).
-- PRIMER delete directo del schema: cargas y gastos no tienen maquina de
-- estados ni efectos derivados (corregir = borrar y re-crear), asi que
-- dueno/admin borran directo. SIN update: ni policy ni grant (candado).

-- ---------- Cargas de combustible (fila del reporte TCT o carga manual) ----------
create table public.cargas_combustible (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  vehiculo_id uuid not null,
  -- Cruce del RUT chofer del import contra conductores DE LA EMPRESA.
  conductor_id uuid,
  fecha date not null,
  -- Primer uso de time en el schema: PostgREST lo sirve como string 'HH:MM:SS'.
  -- Distingue dos cargas del mismo camion el mismo dia; null en las manuales.
  hora time,
  litros numeric(9,2) not null check (litros > 0),
  -- Informativo: monto es LA fuente de verdad. NO se valida monto = litros x
  -- precio (Copec redondea distinto: 349,13 x 1123 = 392.073 <> 392.076 real).
  precio_litro integer check (precio_litro > 0),
  monto integer not null check (monto > 0),
  estacion text,
  comuna text,
  -- Guia de despacho Copec: la clave de dedup del import (null en manuales).
  guia text,
  -- Minimizacion (Ley 21.719): se persiste SOLO cuando NO hubo match en
  -- conductores (con conductor_id, el RUT ya vive alla); se elimina con la carga.
  rut_chofer text,
  tarjeta text,
  -- CRUDO: el reporte real trae basura (casi siempre 1); sin check a proposito.
  odometro integer,
  producto text not null default 'Diésel',
  origen text not null check (origen in ('tct', 'manual')),
  creado_en timestamptz not null default now(),
  foreign key (empresa_id, vehiculo_id) references public.vehiculos (empresa_id, id),
  foreign key (empresa_id, conductor_id) references public.conductores (empresa_id, id)
);
-- Dedup del import: guia unica POR EMPRESA. Parcial: las cargas manuales van
-- sin guia y no chocan entre si (re-digitar duplica; se corrige eliminando).
create unique index cargas_combustible_guia_idx on public.cargas_combustible (empresa_id, guia) where guia is not null;
create index cargas_combustible_vehiculo_idx on public.cargas_combustible (empresa_id, vehiculo_id, fecha desc);
create index cargas_combustible_fecha_idx on public.cargas_combustible (empresa_id, fecha desc);

-- ---------- Gastos por vehiculo (manuales) ----------
create table public.gastos_vehiculo (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  vehiculo_id uuid not null,
  fecha date not null,
  categoria text not null check (categoria in ('peaje', 'mantencion', 'neumaticos', 'seguro', 'permiso', 'otro')),
  monto integer not null check (monto > 0),
  notas text,
  creado_en timestamptz not null default now(),
  foreign key (empresa_id, vehiculo_id) references public.vehiculos (empresa_id, id)
);
create index gastos_vehiculo_vehiculo_idx on public.gastos_vehiculo (empresa_id, vehiculo_id, fecha desc);

-- ---------- RLS ----------
alter table public.cargas_combustible enable row level security;
alter table public.gastos_vehiculo enable row level security;

-- Costos = dinero: escribe dueno/admin; el vendedor solo mira (espejo de los
-- maestros 0008/0016). PRIMER delete directo del schema: sin maquina de
-- estados ni efectos derivados, la correccion es eliminar y re-crear; la
-- policy de delete filtra por FILA, asi que un rol sin permiso "borra" 0
-- filas SIN error — por eso la app verifica el conteo con .select('id').
create policy "miembros ven cargas de combustible" on public.cargas_combustible
  for select to authenticated using (empresa_id in (select app.mis_empresas()));
create policy "duenos crean cargas de combustible" on public.cargas_combustible
  for insert to authenticated
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']));
create policy "duenos eliminan cargas de combustible" on public.cargas_combustible
  for delete to authenticated
  using (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']));

create policy "miembros ven gastos de vehiculo" on public.gastos_vehiculo
  for select to authenticated using (empresa_id in (select app.mis_empresas()));
create policy "duenos crean gastos de vehiculo" on public.gastos_vehiculo
  for insert to authenticated
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']));
create policy "duenos eliminan gastos de vehiculo" on public.gastos_vehiculo
  for delete to authenticated
  using (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']));

-- ---------- Grants Data API (leccion Plan 1) ----------
-- SIN update para authenticated (ni grant ni policy): cargas y gastos son
-- inmutables; corregir = eliminar y re-crear (Task 2 fija el candado en pgTAP).
grant select, insert, delete on public.cargas_combustible, public.gastos_vehiculo to authenticated;
grant select, insert, update, delete on public.cargas_combustible, public.gastos_vehiculo to service_role;

-- ---------- Vista rentabilidad_vehiculo (security_invoker) ----------
-- Fila por (empresa_id, vehiculo_id, mes) con vehiculo_id NULLABLE: las ODEs
-- facturadas sin vehiculo caen en la fila "Sin asignar" de la UI. Ingresos =
-- neto de ODEs FACTURADAS por mes de fecha_ingreso (devengo operacional;
-- deshacer un estado de pago las saca solo: derivacion, no copia). SIN cast
-- ::integer en las sumas: quedan en el tipo ancho natural de sum() (PostgREST
-- serializa numero igual) — sin el overflow latente de las vistas del Plan 7.
-- Cada sub-agregado agrupa por empresa_id: la fila "Sin asignar" jamas mezcla
-- empresas. Margen y % los calcula la pagina.
create view public.rentabilidad_vehiculo with (security_invoker = true) as
select empresa_id, vehiculo_id, mes,
       sum(ingresos) as ingresos,
       sum(combustible) as combustible,
       sum(gastos) as gastos
from (
  select o.empresa_id, o.vehiculo_id,
         date_trunc('month', o.fecha_ingreso)::date as mes,
         sum(o.neto) as ingresos, 0 as combustible, 0 as gastos
  from public.ordenes_entrega o
  where o.estado = 'facturada'
  group by o.empresa_id, o.vehiculo_id, mes
  union all
  select c.empresa_id, c.vehiculo_id,
         date_trunc('month', c.fecha)::date as mes,
         0, sum(c.monto), 0
  from public.cargas_combustible c
  group by c.empresa_id, c.vehiculo_id, mes
  union all
  select g.empresa_id, g.vehiculo_id,
         date_trunc('month', g.fecha)::date as mes,
         0, 0, sum(g.monto)
  from public.gastos_vehiculo g
  group by g.empresa_id, g.vehiculo_id, mes
) partes
group by empresa_id, vehiculo_id, mes;

-- Grant EXPLICITO tambien para la vista (leccion 42501 del Plan 7: una vista
-- sin grant da permission denied aunque el invoker vea las tablas base); el
-- pgTAP POSITIVO de Task 2 lo fija para siempre.
grant select on public.rentabilidad_vehiculo to authenticated, service_role;
```

- [ ] **Step 2: Aplicar y verificar**

Run: `pnpm supabase db reset` → aplica 0001-0017 sin errores.
Run: `pnpm supabase test db` → 11 archivos, **193 asserts** existentes siguen verdes (la migración no toca nada previo).

Smoke de grants (el contrato de escritura de una vez):

```
docker exec supabase_db_ERP_Transportes psql -U postgres -d postgres -c "select has_table_privilege('authenticated','public.cargas_combustible','insert') as cc_ins, has_table_privilege('authenticated','public.cargas_combustible','update') as cc_upd, has_table_privilege('authenticated','public.cargas_combustible','delete') as cc_del, has_table_privilege('authenticated','public.gastos_vehiculo','update') as gv_upd, has_table_privilege('authenticated','public.gastos_vehiculo','delete') as gv_del, has_table_privilege('authenticated','public.rentabilidad_vehiculo','select') as rv_auth, has_table_privilege('service_role','public.rentabilidad_vehiculo','select') as rv_sr;"
```

→ `cc_ins = t`, `cc_upd = f` (candado: SIN update), `cc_del = t` (primer delete directo), `gv_upd = f`, `gv_del = t`, `rv_auth = t`, `rv_sr = t` (la vista tiene grant para ambos).

Smoke de la vista (compila y agrega):

```
docker exec supabase_db_ERP_Transportes psql -U postgres -d postgres -c "select * from public.rentabilidad_vehiculo order by empresa_id, mes;"
```

→ consulta SIN error; devuelve las filas derivadas de las ODEs facturadas del seed (o 0 filas si no hay) — lo que importa es que la vista compila y las columnas son `empresa_id, vehiculo_id, mes, ingresos, combustible, gastos`.

Smoke del índice único parcial:

```
docker exec supabase_db_ERP_Transportes psql -U postgres -d postgres -c "select indexdef from pg_indexes where indexname = 'cargas_combustible_guia_idx';"
```

→ una fila con `CREATE UNIQUE INDEX ... (empresa_id, guia) WHERE (guia IS NOT NULL)`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/00000000000017_combustible.sql
git commit -m "feat(db): combustible y gastos por vehículo con vista de rentabilidad"
```

---
### Task 2: pgTAP de combustible

**Files:**
- Create: `supabase/tests/database/combustible.test.sql`

**Interfaces:**
- Consumes: migración 0017 (Task 1: `cargas_combustible`, `gastos_vehiculo`, vista `rentabilidad_vehiculo`, policies y grants) y las RPCs de 0016 (`crear_orden_entrega`, `crear_proforma`, `cambiar_estado_proforma`, `facturar_proforma`) para fabricar ODEs facturadas por el camino REAL (patrón transporte.test.sql).
- RUTs NUEVOS reservados para este archivo (válidos módulo 11; únicos GLOBALES — verificado con grep contra TODOS los tests `7611/7622/7633/7644/7655/7666/7677/7688/761112228/761234560/762223333/763334449/76543210x`, el seed `771234569`/`778899000` y los E2E `999999999`/`888888888`/`666666666`): `761212125` (Org/Empresa A), `763434346` (Org/Empresa B), `764646460` (Cliente A).
- Presupuesto EXACTO de `plan(18)` — mapeo del spec §8 contado a mano: vendedor NO inserta (42501 de POLICY) → asserts 1-2; delete de vendedor NO es 42501 (el grant existe) y afecta 0 filas → 3-4; update sin grant (candado tipo cotizaciones #26, probado como DUEÑA: más fuerte) → 5-6; guía única por empresa (23505) → 7; misma guía en OTRA empresa SÍ entra → 11; checks litros 0 / monto 0 / categoría inválida → 8-10; vista a mano: julio del camión A `100000/30000/20000` (cubre "ODE registrada NO suma" — daría 177777 — y "carga de agosto NO contamina julio") → 12, fila "Sin asignar" → 13, agosto en SU mes → 14; dueña SÍ elimina (primer delete directo) → 15; delete cross-tenant en 0 filas → setup previo al assert 16 (la carga de Beto sigue viva); aislamiento de las 2 tablas (patrón transporte #56) → 16; vista con pgTAP POSITIVO (lección 42501: Beto la LEE y ve solo su fila) → 17; anon 42501 → 18.
- Fechas FIJAS (julio/agosto 2026), jamás `current_date`: la vista agrupa por mes y el test debe cuadrar a mano siempre.

- [ ] **Step 1: Escribir el test**

`supabase/tests/database/combustible.test.sql`:

```sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'ana@a.cl'),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'beto@b.cl'),
  ('00000000-0000-0000-0000-000000000000', '77777777-7777-7777-7777-777777777777', 'authenticated', 'authenticated', 'vero@a.cl');

-- RUT nuevos, únicos GLOBALES: no colisionan con otros tests (7611/7622/7633/7644/7655/
-- 7666/7677/7688/761112228/761234560/762223333/763334449/76543210x), el seed
-- (771234569, 778899000) ni los E2E (999999999, 888888888, 666666666).
insert into public.organizaciones (id, rut, razon_social)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '761212125', 'Org A'),
       ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '763434346', 'Org B');

-- A nace con el módulo ACTIVO (las RPCs de ODE lo exigen); B queda off:
-- cargas, gastos y la vista NO dependen del módulo (solo la UI se gatea).
insert into public.empresas (id, organizacion_id, rut, razon_social, modulo_transporte)
values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '761212125', 'Transportes A', true),
       ('eeeeeeee-0000-0000-0000-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '763434346', 'Empresa B', false);

insert into public.miembros (usuario_id, organizacion_id, rol)
values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'dueno'),
       ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'dueno'),
       ('77777777-7777-7777-7777-777777777777', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'vendedor');

insert into public.clientes (id, empresa_id, rut, razon_social)
values ('cccccccc-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '764646460', 'Cliente A');

-- Flota: VA de A (blanco de cargas, gastos y vista); VB de B (aislamiento y dedup cruzado).
insert into public.vehiculos (id, empresa_id, patente, descripcion)
values ('aaaa0001-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'ABCD12', 'Camión A'),
       ('aaaa0002-0000-0000-0000-bbbbbbbbbbbb', 'eeeeeeee-0000-0000-0000-bbbbbbbbbbbb', 'WXYZ89', 'Camión B');

insert into public.destinos (id, empresa_id, nombre, tarifa_kg)
values ('dddd0001-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'Coyhaique', 450);

-- ===== Ana (dueña A): fixture de rentabilidad A MANO (fechas fijas julio/agosto 2026) =====
-- ODEs por RPC (patrón transporte.test.sql): la 1 facturada CON vehículo ($100.000, julio),
-- la 2 facturada SIN vehículo ($50.000, julio → fila "Sin asignar"), la 3 queda
-- 'registrada' ($77.777: si la vista la sumara, el assert 12 daría 177777).
-- Si cualquier setup fallara, el archivo entero aborta (feliz cubierto sin assert propio).
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select crear_orden_entrega('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
  date '2026-07-10', 'dddd0001-0000-0000-0000-aaaaaaaaaaaa', 'GD 9001', null,
  1, 400, null, 100000, 'aaaa0001-0000-0000-0000-aaaaaaaaaaaa', null, null);
select crear_orden_entrega('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
  date '2026-07-12', 'dddd0001-0000-0000-0000-aaaaaaaaaaaa', null, null,
  1, 200, null, 50000, null, null, null);
select crear_orden_entrega('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
  date '2026-07-20', 'dddd0001-0000-0000-0000-aaaaaaaaaaaa', null, null,
  1, 100, null, 77777, 'aaaa0001-0000-0000-0000-aaaaaaaaaaaa', null, null);

-- Ciclo completo SOLO para las ODEs 1 y 2: borrador → enviada → aprobada → facturada.
select crear_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
  array[
    (select id from ordenes_entrega where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1),
    (select id from ordenes_entrega where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 2)
  ], null);
select cambiar_estado_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1), 'enviada');
select cambiar_estado_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1), 'aprobada');
select facturar_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1));

-- Costos de la dueña por insert DIRECTO (así escribe la app): TCT-001 julio $30.000
-- y TCT-002 agosto $40.000 sobre el camión A; peaje julio $20.000.
insert into public.cargas_combustible (empresa_id, vehiculo_id, fecha, hora, litros, precio_litro, monto, estacion, guia, origen)
values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'aaaa0001-0000-0000-0000-aaaaaaaaaaaa', date '2026-07-08', '14:30:00', 100.00, 300, 30000, 'Copec Coyhaique', 'TCT-001', 'tct'),
       ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'aaaa0001-0000-0000-0000-aaaaaaaaaaaa', date '2026-08-02', null, 133.50, null, 40000, null, 'TCT-002', 'tct');
insert into public.gastos_vehiculo (empresa_id, vehiculo_id, fecha, categoria, monto, notas)
values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'aaaa0001-0000-0000-0000-aaaaaaaaaaaa', date '2026-07-15', 'peaje', 20000, 'Ruta 7');

-- ===== Vero (vendedora A): NO escribe costos; el delete existe pero la policy la filtra =====
set local request.jwt.claims to '{"sub": "77777777-7777-7777-7777-777777777777", "role": "authenticated"}';

-- 1) La vendedora no inserta cargas: la policy de insert es dueno/admin (42501 de RLS, no de grant).
select throws_ok(
  $$insert into cargas_combustible (empresa_id, vehiculo_id, fecha, litros, monto, origen)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'aaaa0001-0000-0000-0000-aaaaaaaaaaaa', date '2026-07-09', 50, 15000, 'manual')$$,
  '42501', 'new row violates row-level security policy for table "cargas_combustible"',
  'la vendedora no puede registrar cargas de combustible'
);

-- 2) La vendedora tampoco inserta gastos.
select throws_ok(
  $$insert into gastos_vehiculo (empresa_id, vehiculo_id, fecha, categoria, monto)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'aaaa0001-0000-0000-0000-aaaaaaaaaaaa', date '2026-07-09', 'peaje', 5000)$$,
  '42501', 'new row violates row-level security policy for table "gastos_vehiculo"',
  'la vendedora no puede registrar gastos de vehículo'
);

-- 3) El delete de la vendedora NO es 42501 (el grant de delete EXISTE): la policy
--    filtra en silencio y afecta 0 filas — por eso la app verifica con .select('id').
select lives_ok(
  $$delete from cargas_combustible
    where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and guia = 'TCT-001'$$,
  'el delete de la vendedora no da error: el grant existe y la policy filtra por rol'
);

-- 4) ...y la carga sigue viva (0 filas afectadas; la vendedora la VE porque es miembro).
select is(
  (select count(*) from cargas_combustible
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and guia = 'TCT-001'),
  1::bigint,
  'el delete de la vendedora afectó 0 filas: la carga sigue viva'
);

-- ===== Ana: candado de update y CHECKs =====
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- 5) SIN update NI SIQUIERA para la dueña: no hay grant (candado tipo cotizaciones #26).
--    Corregir una carga = eliminarla y re-crearla.
select throws_ok(
  $$update cargas_combustible set monto = 1
    where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'$$,
  '42501', 'permission denied for table cargas_combustible',
  'ni la dueña puede editar una carga: sin grant de update'
);

-- 6) Ídem gastos_vehiculo.
select throws_ok(
  $$update gastos_vehiculo set monto = 1
    where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'$$,
  '42501', 'permission denied for table gastos_vehiculo',
  'ni la dueña puede editar un gasto: sin grant de update'
);

-- 7) La guía es única POR EMPRESA (índice único parcial): re-insertar TCT-001 en A revienta.
select throws_ok(
  $$insert into cargas_combustible (empresa_id, vehiculo_id, fecha, litros, monto, guia, origen)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'aaaa0001-0000-0000-0000-aaaaaaaaaaaa', date '2026-07-09', 60, 18000, 'TCT-001', 'tct')$$,
  '23505', null,
  'la misma guía no entra dos veces en la misma empresa'
);

-- 8) CHECK: litros 0.
select throws_ok(
  $$insert into cargas_combustible (empresa_id, vehiculo_id, fecha, litros, monto, origen)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'aaaa0001-0000-0000-0000-aaaaaaaaaaaa', date '2026-07-09', 0, 15000, 'manual')$$,
  '23514', null,
  'una carga de 0 litros se rechaza por CHECK'
);

-- 9) CHECK: monto 0.
select throws_ok(
  $$insert into cargas_combustible (empresa_id, vehiculo_id, fecha, litros, monto, origen)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'aaaa0001-0000-0000-0000-aaaaaaaaaaaa', date '2026-07-09', 50, 0, 'manual')$$,
  '23514', null,
  'una carga de monto 0 se rechaza por CHECK'
);

-- 10) CHECK: categoría de gasto fuera de la lista.
select throws_ok(
  $$insert into gastos_vehiculo (empresa_id, vehiculo_id, fecha, categoria, monto)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'aaaa0001-0000-0000-0000-aaaaaaaaaaaa', date '2026-07-09', 'bencina', 5000)$$,
  '23514', null,
  'una categoría de gasto inválida se rechaza por CHECK'
);

-- ===== Beto (dueño B): la MISMA guía en OTRA empresa SÍ entra =====
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

-- 11) El índice de dedup es (empresa_id, guia): TCT-001 de B no choca con TCT-001 de A.
select lives_ok(
  $$insert into cargas_combustible (empresa_id, vehiculo_id, fecha, litros, monto, guia, origen)
    values ('eeeeeeee-0000-0000-0000-bbbbbbbbbbbb', 'aaaa0002-0000-0000-0000-bbbbbbbbbbbb', date '2026-07-05', 80, 25000, 'TCT-001', 'tct')$$,
  'la misma guía en OTRA empresa sí entra: el dedup es por empresa'
);

-- ===== Ana: la vista cuadra A MANO =====
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- 12) Julio del camión A: ingresos SOLO de la ODE facturada ($100.000 — la registrada
--     de $77.777 NO suma), combustible SOLO de julio ($30.000 — la carga de agosto
--     NO contamina) y el peaje ($20.000).
select is(
  (select ingresos::text || '/' || combustible::text || '/' || gastos::text
   from rentabilidad_vehiculo
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and vehiculo_id = 'aaaa0001-0000-0000-0000-aaaaaaaaaaaa' and mes = date '2026-07-01'),
  '100000/30000/20000',
  'julio del camión A cuadra a mano: 100000/30000/20000 (la ODE registrada no suma; agosto no contamina)'
);

-- 13) La ODE facturada SIN vehículo cae en la fila "Sin asignar" (vehiculo_id null) del mismo mes.
select is(
  (select ingresos::text || '/' || combustible::text || '/' || gastos::text
   from rentabilidad_vehiculo
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and vehiculo_id is null and mes = date '2026-07-01'),
  '50000/0/0',
  'la ODE facturada sin vehículo aparece como fila Sin asignar con sus 50000 de ingreso'
);

-- 14) La carga de agosto vive en SU mes (0 ingresos: nada facturado en agosto).
select is(
  (select ingresos::text || '/' || combustible::text || '/' || gastos::text
   from rentabilidad_vehiculo
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and vehiculo_id = 'aaaa0001-0000-0000-0000-aaaaaaaaaaaa' and mes = date '2026-08-01'),
  '0/40000/0',
  'la carga de agosto aparece en agosto, no en julio'
);

-- 15) La dueña SÍ elimina (primer delete directo del schema): TCT-002 desaparece.
delete from cargas_combustible
where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and guia = 'TCT-002';
select is(
  (select count(*) from cargas_combustible
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and guia = 'TCT-002'),
  0::bigint,
  'la dueña elimina una carga directamente: corregir = borrar y re-crear'
);

-- Setup: delete cross-tenant de Ana contra TODO lo de B — la policy lo deja en
-- 0 filas SIN error (el assert 16 lo prueba: la carga de Beto sigue viva).
delete from cargas_combustible where empresa_id = 'eeeeeeee-0000-0000-0000-bbbbbbbbbbbb';

-- ===== Beto: aislamiento (tablas y vista con pgTAP POSITIVO) =====
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

-- 16) Beto ve SOLO su carga: la de A es invisible, el gasto de A también, y el
--     delete cross-tenant de Ana afectó 0 filas (si hubiera borrado, esto daría 0).
select is(
  (select count(*) from cargas_combustible) + (select count(*) from gastos_vehiculo),
  1::bigint,
  'Beto ve solo su carga: aislamiento de las 2 tablas y delete cross-tenant en 0 filas'
);

-- 17) pgTAP POSITIVO de la vista (lección 42501): Beto la LEE sin error y ve UNA fila — la suya.
select is(
  (select count(*)::text from rentabilidad_vehiculo) || '/' ||
  (select vehiculo_id::text || '/' || mes::text || '/' || ingresos::text || '/' || combustible::text || '/' || gastos::text
   from rentabilidad_vehiculo where empresa_id = 'eeeeeeee-0000-0000-0000-bbbbbbbbbbbb'),
  '1/aaaa0002-0000-0000-0000-bbbbbbbbbbbb/2026-07-01/0/25000/0',
  'la vista tiene grant para authenticated y la RLS del invoker aísla: Beto ve solo su fila'
);

-- 18) Anónimo denegado de plano.
set local request.jwt.claims to '{"role": "anon"}';
set local role anon;
select throws_ok(
  'select count(*) from cargas_combustible',
  '42501', 'permission denied for table cargas_combustible',
  'un anónimo no puede consultar cargas de combustible'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Ejecutar**

Run: `pnpm supabase test db`
Expected: 12 archivos, **211 asserts** (aislamiento 6, cobranza 16, combustible 18, compras 19, cotizaciones 27, inventario 10, maestros 11, por_pagar 18, registro 7, reportes 11, transporte 59, ventas 9), todos verdes. Si un assert de combustible falla, el sospechoso es la migración 0017 (Task 1) — NO debilitar el test (única adaptación permitida: el TEXTO exacto de los mensajes nativos de Postgres en los asserts 1, 2, 5, 6 y 18, si la versión los formula distinto; los CÓDIGOS de error, el conteo de filas y los valores dorados de la vista son el contrato).

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/database/combustible.test.sql
git commit -m "test(db): pgTAP de combustible — dedup, roles, delete directo y rentabilidad"
```

---
### Task 3: Regenerar tipos `@suite/db`

**Files:**
- Modify: `packages/db/src/types.ts` (regenerado)

- [ ] **Step 1: Regenerar y verificar**

Run: `pnpm --filter @suite/db gen`
Expected: `types.ts` gana 3 símbolos: tablas `cargas_combustible` y `gastos_vehiculo` (Row/Insert/Update bajo `Tables`) y la vista `rentabilidad_vehiculo` (bajo `Views`, como `libro_compras`/`libro_ventas`). SIN Functions nuevas — primer plan del schema sin RPCs (insert/delete directo, spec §2). Sin columnas nuevas en `empresas`.

Verificación (PowerShell):

```powershell
$simbolos = 'cargas_combustible', 'gastos_vehiculo', 'rentabilidad_vehiculo'
foreach ($s in $simbolos) {
  if (-not (Select-String -Path packages/db/src/types.ts -Pattern $s -Quiet)) { "FALTA: $s" }
}
```

Expected: sin salida (los 3 símbolos presentes). Cualquier línea `FALTA:` significa que la migración 0017 no aplicó completa → BLOCKED (no seguir a las tasks de import/UI con tipos incompletos). En particular, si falta `rentabilidad_vehiculo` pero están las tablas, revisa que la vista se haya creado en `public` y con su `grant select` (una vista sin grant a `authenticated` no aparece para el rol del Data API).

Run: `pnpm tsc --noEmit -p packages/db/tsconfig.json` → sin errores.
Run: `pnpm build --concurrency=1` → 3 apps.

- [ ] **Step 2: Commit**

```bash
git add packages/db/src/types.ts
git commit -m "chore(db): tipos regenerados con combustible"
```

---
### Task 4: `@suite/core` — parsers del reporte TCT (TDD)

**Files:**
- Create: `packages/core/src/tct.ts`
- Create: `packages/core/src/tct.test.ts`
- Modify: `packages/core/src/index.ts` (agregar `export * from './tct'`)

**Interfaces:**
- Consumes: nada del monorepo (funciones puras). ESPEJO de formato y estilo: `packages/core/src/transporte.ts` / `.test.ts` — léelos antes de escribir estos archivos. El parsing del CSV NO se toca: `parsearCSV` (csv.ts) ya pela BOM, maneja comillas con comas internas, CRLF y auto-detecta `,`/`;`.
- Produces (LOCKED, spec §4): `export interface ColumnasTct` — índices `number` para las obligatorias `patente`/`fecha`/`volumen`/`monto`/`guia` y `number | null` para las opcionales `hora`/`rutChofer`/`estacion`/`comuna`/`precio`/`odometro`/`tarjeta`/`producto`; `localizarColumnasTct(headers: string[]): ColumnasTct | null` — igualdad EXACTA del header normalizado (lowercase + sin tildes + trim; la clave del odómetro es exactamente `'odometro (kms.)'`), null si falta alguna obligatoria, JAMÁS matching por inclusión (`'tarjeta'` matchearía `'Tipo de Tarjeta'`, columna real del reporte); `parsearMontoTct(texto: string): number | null`; `parsearLitrosTct(texto: string): number | null`; `parsearFechaTct(texto: string): string | null`. Los consume la Server Action `importarCargasTct` (task del import) sobre cada fila que entrega `parsearCSV`.
- Se reusan sin tocar: `parsearCSV`, `normalizarPatente`, `limpiarRut`/`validarRut`, `formatearCLP`, `filasACsv`.

- [ ] **Step 1: Test que falla**

`packages/core/src/tct.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  localizarColumnasTct,
  parsearFechaTct,
  parsearLitrosTct,
  parsearMontoTct,
} from './tct'

// Header del reporte TCT Consumos Diarios de Copec (21 columnas, con tildes
// tal como llegan en el CSV real). La localización es POR NOMBRE, no por
// posición: si Copec reordena columnas, el import sigue funcionando.
const HEADER_CONSUMOS_DIARIOS = [
  'N° Cuenta', //              0
  'Razón Social', //           1
  'Centro de Costo', //        2
  'Tipo de Tarjeta', //        3  ('tarjeta' por INCLUSIÓN matchearía aquí)
  'Tarjeta', //                4
  'N° Transacción', //         5
  'Fecha Transacción', //      6
  'Hora Transacción', //       7
  'Patente', //                8
  'Rut Chofer', //             9
  'Nombre Chofer', //          10
  'Estación de Servicio', //   11
  'Comuna', //                 12
  'Producto', //               13
  'Precio', //                 14
  'Volumen', //                15
  'Monto', //                  16
  'Odómetro (Kms.)', //        17
  'Kms. Recorridos', //        18
  'Rendimiento (Kms/Lts.)', // 19
  'Guía de Despacho', //       20
]

// Header del reporte AGREGADO Consumos_por_Patente: sin fecha, volumen a
// secas ni guía — no es importable (el ERP lo deriva, no lo traga).
const HEADER_AGREGADO = [
  'Patente',
  'N° Tarjetas',
  'N° Transacciones',
  'Cantidad (Unidad)',
  'Monto ($)',
  'Rendimiento Promedio',
]

describe('localizarColumnasTct', () => {
  it('localiza los índices en el header real de Consumos Diarios (21 columnas)', () => {
    expect(localizarColumnasTct(HEADER_CONSUMOS_DIARIOS)).toEqual({
      patente: 8,
      fecha: 6,
      volumen: 15,
      monto: 16,
      guia: 20,
      hora: 7,
      rutChofer: 9,
      estacion: 11,
      comuna: 12,
      precio: 14,
      odometro: 17,
      tarjeta: 4,
      producto: 13,
    })
  })
  it('el header del agregado Consumos_por_Patente no es importable → null', () => {
    expect(localizarColumnasTct(HEADER_AGREGADO)).toBe(null)
  })
  it('header con mojibake (archivo re-codificado) → null', () => {
    const roto = HEADER_CONSUMOS_DIARIOS.map((h) =>
      h.replace(/ó/g, '\uFFFD').replace(/í/g, '\uFFFD'),
    )
    expect(localizarColumnasTct(roto)).toBe(null)
  })
  it('igualdad exacta: sin la columna Tarjeta, Tipo de Tarjeta NO la sustituye', () => {
    const sinTarjeta = HEADER_CONSUMOS_DIARIOS.filter((h) => h !== 'Tarjeta')
    const columnas = localizarColumnasTct(sinTarjeta)
    expect(columnas).not.toBe(null)
    expect(columnas?.tarjeta).toBe(null)
  })
  it('falta una obligatoria (Volumen) → null', () => {
    expect(
      localizarColumnasTct(HEADER_CONSUMOS_DIARIOS.filter((h) => h !== 'Volumen')),
    ).toBe(null)
  })
  it('header mínimo con solo las 5 obligatorias: las opcionales quedan null', () => {
    expect(
      localizarColumnasTct(['Patente', 'Fecha Transacción', 'Volumen', 'Monto', 'Guía de Despacho']),
    ).toEqual({
      patente: 0,
      fecha: 1,
      volumen: 2,
      monto: 3,
      guia: 4,
      hora: null,
      rutChofer: null,
      estacion: null,
      comuna: null,
      precio: null,
      odometro: null,
      tarjeta: null,
      producto: null,
    })
  })
})

describe('parsearMontoTct', () => {
  it("monto real TCT '392076,000' (coma decimal, sin miles) → 392076", () => {
    expect(parsearMontoTct('392076,000')).toBe(392076)
  })
  it("total real con puntos de miles '1.060.459' → 1060459", () => {
    expect(parsearMontoTct('1.060.459')).toBe(1060459)
  })
  it("precio real por litro '1123,000' → 1123", () => {
    expect(parsearMontoTct('1123,000')).toBe(1123)
  })
  it("'0,0' → null (un monto debe ser > 0)", () => {
    expect(parsearMontoTct('0,0')).toBe(null)
  })
  it('vacío → null', () => {
    expect(parsearMontoTct('')).toBe(null)
  })
  it("no numérico ('S/I') → null", () => {
    expect(parsearMontoTct('S/I')).toBe(null)
  })
})

describe('parsearLitrosTct', () => {
  it("volumen real '349,13' → 349.13", () => {
    expect(parsearLitrosTct('349,13')).toBe(349.13)
  })
  it("volumen real '138,33' → 138.33", () => {
    expect(parsearLitrosTct('138,33')).toBe(138.33)
  })
  it("'0,00' → null (los litros deben ser > 0)", () => {
    expect(parsearLitrosTct('0,00')).toBe(null)
  })
})

describe('parsearFechaTct', () => {
  it("fecha real '13-07-2026' (DD-MM-YYYY) → '2026-07-13'", () => {
    expect(parsearFechaTct('13-07-2026')).toBe('2026-07-13')
  })
  it("'31-02-2026' → null (calendario real: febrero no tiene 31)", () => {
    expect(parsearFechaTct('31-02-2026')).toBe(null)
  })
  it("'2026-07-13' → null (formato equivocado: ya viene ISO)", () => {
    expect(parsearFechaTct('2026-07-13')).toBe(null)
  })
  it("'29-02-2024' → '2024-02-29' (bisiesto válido)", () => {
    expect(parsearFechaTct('29-02-2024')).toBe('2024-02-29')
  })
  it('vacío y basura → null', () => {
    expect(parsearFechaTct('')).toBe(null)
    expect(parsearFechaTct('ayer')).toBe(null)
  })
})
```

- [ ] **Step 2: Verificar que falla**

Run: `pnpm --filter @suite/core test`
Expected: FAIL — `Cannot find module './tct'`.

- [ ] **Step 3: Implementación mínima**

`packages/core/src/tct.ts`:

```ts
// Parsers del reporte TCT Consumos Diarios de Copec (Plan 12). El CSV en sí
// lo parsea parsearCSV (csv.ts: pela BOM, comillas con comas internas, CRLF,
// auto-detecta separador); aquí vive SOLO lo específico de TCT: localizar
// columnas por nombre y convertir los formatos chilenos del reporte.

// Índices de columna dentro de una fila TCT. Las obligatorias definen si el
// archivo es un Consumos Diarios importable; las opcionales degradan a null.
export interface ColumnasTct {
  patente: number
  fecha: number
  volumen: number
  monto: number
  guia: number
  hora: number | null
  rutChofer: number | null
  estacion: number | null
  comuna: number | null
  precio: number | null
  odometro: number | null
  tarjeta: number | null
  producto: number | null
}

// lowercase + sin tildes + trim: 'Estación de Servicio ' → 'estacion de servicio'.
function normalizarHeader(header: string): string {
  return header
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

// Igualdad EXACTA post-normalización, JAMÁS por inclusión: 'tarjeta' por
// inclusión matchearía 'Tipo de Tarjeta' (columna real del reporte) y el
// import guardaría el tipo del plástico en vez del número de tarjeta.
export function localizarColumnasTct(headers: string[]): ColumnasTct | null {
  const indice = new Map<string, number>()
  headers.forEach((h, i) => {
    const clave = normalizarHeader(h)
    if (!indice.has(clave)) indice.set(clave, i)
  })
  const buscar = (clave: string): number | null => indice.get(clave) ?? null

  const patente = buscar('patente')
  const fecha = buscar('fecha transaccion')
  const volumen = buscar('volumen')
  const monto = buscar('monto')
  const guia = buscar('guia de despacho')
  if (patente === null || fecha === null || volumen === null || monto === null || guia === null) {
    return null
  }
  return {
    patente,
    fecha,
    volumen,
    monto,
    guia,
    hora: buscar('hora transaccion'),
    rutChofer: buscar('rut chofer'),
    estacion: buscar('estacion de servicio'),
    comuna: buscar('comuna'),
    precio: buscar('precio'),
    odometro: buscar('odometro (kms.)'),
    tarjeta: buscar('tarjeta'),
    producto: buscar('producto'),
  }
}

// Número chileno del reporte: puntos de miles, coma decimal ('392076,000',
// '1.060.459', '349,13'). Null si no tiene exactamente esa forma.
function parsearNumeroTct(texto: string): number | null {
  const limpio = texto.trim()
  if (!/^\d{1,3}(\.\d{3})+(,\d+)?$|^\d+(,\d+)?$/.test(limpio)) return null
  return Number(limpio.replace(/\./g, '').replace(',', '.'))
}

// Monto en CLP entero. 'monto' es LA fuente de verdad del import; NO se
// valida monto = litros × precio porque Copec redondea distinto (real:
// 349,13 × 1123 = 392.073 ≠ 392.076). También parsea 'Precio' ('1123,000' → 1123).
export function parsearMontoTct(texto: string): number | null {
  const n = parsearNumeroTct(texto)
  if (n === null) return null
  const monto = Math.round(n)
  return monto > 0 ? monto : null
}

// Litros con 2 decimales: paridad con numeric(9,2) de cargas_combustible.
export function parsearLitrosTct(texto: string): number | null {
  const n = parsearNumeroTct(texto)
  if (n === null) return null
  const litros = Number(n.toFixed(2))
  return litros > 0 ? litros : null
}

// 'DD-MM-YYYY' → 'YYYY-MM-DD' validando calendario REAL con round-trip por
// Date.UTC: '31-02-2026' rueda a marzo y los componentes ya no calzan → null.
// Sin esto, un date inválido revienta el lote completo en Postgres.
export function parsearFechaTct(texto: string): string | null {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(texto.trim())
  if (!m) return null
  const dia = Number(m[1])
  const mes = Number(m[2])
  const anio = Number(m[3])
  const fecha = new Date(Date.UTC(anio, mes - 1, dia))
  if (
    fecha.getUTCFullYear() !== anio ||
    fecha.getUTCMonth() !== mes - 1 ||
    fecha.getUTCDate() !== dia
  ) {
    return null
  }
  return `${m[3]}-${m[2]}-${m[1]}`
}
```

En `packages/core/src/index.ts` agregar al final: `export * from './tct'`

- [ ] **Step 4: Verificar que pasa**

Run: `pnpm --filter @suite/core test`
Expected: PASS — **126 tests** (106 existentes + 20 nuevos: localizarColumnasTct 6, parsearMontoTct 6, parsearLitrosTct 3, parsearFechaTct 5).

Run: `pnpm test`
Expected: **138 tests** (core 126, auth 2, dte 10).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/tct.ts packages/core/src/tct.test.ts packages/core/src/index.ts
git commit -m "feat(core): parsers del reporte TCT Consumos Diarios (TDD)"
```

---
### Task 5: Import TCT (Server Action endurecida) + límites

**Files:**
- Create: `apps/erp/lib/csv.ts` (extracción de `leerCSV`), `apps/erp/app/combustible/importar.ts` (la action)
- Modify: `apps/erp/app/importar/acciones.ts` (usa la `leerCSV` extraída — sin cambio de conducta), `apps/erp/lib/empresa-activa.ts` (select + `EmpresaResumen` ganan `organizacion_id`), `apps/erp/next.config.ts` (`serverActions.bodySizeLimit`)

**Interfaces:**
- Consumes: tabla `cargas_combustible` (migración 0017, Task 1) vía tipos `@suite/db` regenerados (Task 3); parsers TCT de `@suite/core` (Task 4): `localizarColumnasTct` con su `ColumnasTct` (claves `patente`/`fecha`/`volumen`/`monto`/`guia: number`; opcionales `hora`/`rutChofer`/`estacion`/`comuna`/`precio`/`odometro`/`tarjeta`/`producto: number | null`), `parsearFechaTct`, `parsearLitrosTct`, `parsearMontoTct`; ya existentes: `normalizarPatente`, `limpiarRut`, `parsearCSV`; `obtenerEmpresaActiva`, `crearClienteServidor`; tabla `miembros` (la policy de plataforma deja al usuario ver su propia fila y el grant de select existe — el pre-check de rol no necesita nada nuevo en BD). Nota: `rutChofer` es el nombre canónico — la interface `ColumnasTct` es LOCKED en Task 4 y esa es la fuente de verdad del nombre de la clave, no este archivo.
- Espejo estructural: `apps/erp/app/importar/acciones.ts` COMPLETO (leerCSV, lotes de 500, mapeo 42501/23505) y `packages/core/src/csv.ts` (firma real `parsearCSV(texto: string): string[][]` — pela BOM y auto-detecta `,`/`;`) — léelos antes de escribir.
- Produces: `leerCSV(formData, maxFilas)` reutilizable (devuelve además `texto` decodificado y `codificacionRecuperada: boolean` — lo inspecciona el guard de Excel); `EmpresaResumen.organizacion_id` (aditivo: `SelectorEmpresa` y demás consumidores no se tocan); `importarCargasTct(_prev: ResultadoImportTct, formData: FormData): Promise<ResultadoImportTct>` + `export interface ResultadoImportTct` (type-only, permitido en un archivo `'use server'`) — los consume la page de `/combustible` (Task 6). Nota: la firma lleva `_prev` porque `useActionState` (Task 6) exige `(prevState, formData) => Promise<State>`; el spec §5 la describe como `importarCargasTct(formData)` — este ajuste de firma es el contrato real de React, no un cambio de conducta.
- Decisión — extraer `leerCSV` en vez de importarla: en `/importar` NO está exportada y trae `MAX_FILAS = 1000` fijo dentro del cuerpo; extraerla a `apps/erp/lib/csv.ts` con `maxFilas` como parámetro y `texto` en el retorno es el cambio mínimo que sirve a ambos imports sin duplicar el fallback de encoding.
- Decisión — bulk insert PostgREST exige el MISMO set de claves en todas las filas del lote: `CargaNueva` se construye SIEMPRE completo (`null` en los opcionales; `producto` con fallback `'Diésel'` porque la columna es NOT NULL).
- El ORDEN del spec §5 va CODIFICADO: (1) rol pre-parse → (2) límites → (3) lectura + guard → (4) reglas por fila + dedup doble → (5) lotes con retry fila a fila → (6) retorno.
- `codificacionRecuperada` (guard de Excel): capturado en `leerCSV` ANTES del fallback CP-1252 (true si el decode UTF-8 inicial tenía U+FFFD); `importarCargasTct` lo usa para cortar temprano. `/importar` recibe el mismo campo en su `lectura` pero lo IGNORA — cero cambio de conducta ahí.
- `bodySizeLimit` de `next.config.ts` es GLOBAL a la app (aplica a toda Server Action, no solo esta) — se acepta porque todas las actions son autenticadas de un solo tenant.

- [ ] **Step 1: Extraer `leerCSV` a `apps/erp/lib/csv.ts`**

```ts
import 'server-only'
import { parsearCSV } from '@suite/core'

// Extraída de app/importar/acciones.ts para que el import TCT (Plan 12) reuse
// la MISMA lectura File → texto → filas: el límite de filas pasa a parámetro
// (el 1000 de /importar queda corto para un año de flota) y se devuelve también
// el texto decodificado, que el guard de archivo re-guardado desde Excel
// necesita inspeccionar (U+FFFD / ';' dominante).
export async function leerCSV(
  formData: FormData,
  maxFilas: number
): Promise<{ filas?: string[][]; texto?: string; codificacionRecuperada?: boolean; error?: string }> {
  const archivo = formData.get('archivo')
  if (!(archivo instanceof File) || archivo.size === 0) {
    return { error: 'Selecciona un archivo CSV' }
  }
  const bytes = new Uint8Array(await archivo.arrayBuffer())
  // Excel en Windows suele exportar CP-1252; si UTF-8 falla, reintentar.
  let texto = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  // Capturado ANTES del fallback: si el decode UTF-8 inicial trae U+FFFD, el
  // archivo viene mal codificado (o re-guardado desde Excel). El import TCT
  // usa este flag para cortar con un mensaje claro; /importar lo IGNORA
  // (cero cambio de conducta ahí — sigue sin mirar el resultado del fallback).
  const codificacionRecuperada = texto.includes('�')
  if (codificacionRecuperada) {
    texto = new TextDecoder('windows-1252').decode(bytes)
  }
  const filas = parsearCSV(texto)
  if (filas.length < 2) return { error: 'El archivo no tiene filas de datos' }
  if (filas.length - 1 > maxFilas) return { error: `Máximo ${maxFilas} filas por archivo` }
  return { filas, texto, codificacionRecuperada }
}
```

- [ ] **Step 2: Re-cablear `/importar` a la `leerCSV` extraída (sin cambio de conducta)**

`apps/erp/app/importar/acciones.ts` completo queda así — cambian SOLO los imports (desaparece `parsearCSV`, entra `leerCSV` de `../../lib/csv`), se elimina la función local `leerCSV` y las dos llamadas pasan `MAX_FILAS`; `importarProductos` e `importarClientes` quedan idénticos:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@suite/auth/server'
import { validarFilaCliente, validarFilaProducto } from '@suite/core'
import { leerCSV } from '../../lib/csv'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import type { ResultadoImport } from '../tipos'

const MAX_FILAS = 1000

function filasComoObjetos(filas: string[][]): Record<string, string>[] {
  const encabezados = filas[0]!.map((h) => h.trim().toLowerCase())
  return filas.slice(1).map((fila) => {
    const objeto: Record<string, string> = {}
    encabezados.forEach((encabezado, i) => {
      objeto[encabezado] = (fila[i] ?? '').trim()
    })
    return objeto
  })
}

export async function importarProductos(_prev: ResultadoImport, formData: FormData): Promise<ResultadoImport> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const lectura = await leerCSV(formData, MAX_FILAS)
  if (lectura.error || !lectura.filas) return { error: lectura.error }

  const objetos = filasComoObjetos(lectura.filas)
  const validos = objetos.map(validarFilaProducto)
  const errores = validos
    .map((r, i) => (r.ok ? null : { fila: i + 2, mensajes: r.errores }))
    .filter((e): e is { fila: number; mensajes: string[] } => e !== null)
  const filasOkConFila = validos
    .map((r, i) => (r.ok ? { datos: r.datos, fila: i + 2 } : null))
    .filter(
      (v): v is { datos: Extract<(typeof validos)[number], { ok: true }>['datos']; fila: number } => v !== null
    )
  const filasOk = filasOkConFila.map((v) => v.datos)

  const supabase = await crearClienteServidor()

  // Resolver categorías por nombre (crear las que falten).
  const nombresCategorias = [...new Set(filasOk.map((f) => f.categoria).filter(Boolean))] as string[]
  const categoriaPorNombre = new Map<string, string>()
  for (const nombre of nombresCategorias) {
    const { data, error } = await supabase
      .from('categorias_producto')
      .upsert({ empresa_id: activa.id, nombre }, { onConflict: 'empresa_id,nombre' })
      .select('id')
      .single()
    if (error) {
      if (error.code === '42501') return { error: 'Tu rol no permite importar productos' }
      if (error.code === '23505') return { error: 'Esa categoría ya existe (revisa mayúsculas/minúsculas)' }
      return { error: 'No se pudieron crear las categorías: ' + nombre }
    }
    categoriaPorNombre.set(nombre, data.id)
  }

  const registrosConFila = filasOkConFila.map(({ datos: f, fila }) => ({
    registro: {
      empresa_id: activa.id,
      sku: f.sku,
      nombre: f.nombre,
      precio_neto: f.precioNeto,
      unidad: f.unidad,
      codigo_barras: f.codigoBarras ?? null,
      categoria_id: f.categoria ? categoriaPorNombre.get(f.categoria)! : null,
      exento: f.exento,
      activo: true,
      actualizado_en: new Date().toISOString(),
    },
    fila,
  }))

  const porClave = new Map<string, { registro: (typeof registrosConFila)[number]['registro']; fila: number }>()
  for (const { registro, fila } of registrosConFila) {
    const clave = registro.sku
    const previo = porClave.get(clave)
    if (previo) {
      errores.push({ fila: previo.fila, mensajes: ['SKU duplicado en el archivo; se usó la última aparición'] })
    }
    porClave.set(clave, { registro, fila })
  }
  const registros = [...porClave.values()].map((v) => v.registro)
  errores.sort((a, b) => a.fila - b.fila)

  for (let i = 0; i < registros.length; i += 500) {
    const { error } = await supabase
      .from('productos')
      .upsert(registros.slice(i, i + 500), { onConflict: 'empresa_id,sku' })
    if (error) {
      if (error.code === '42501') return { error: 'Tu rol no permite importar productos' }
      return { error: 'Error al guardar los productos: revisa el archivo' }
    }
  }

  revalidatePath('/productos')
  return { procesadas: registros.length, errores }
}

export async function importarClientes(_prev: ResultadoImport, formData: FormData): Promise<ResultadoImport> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const lectura = await leerCSV(formData, MAX_FILAS)
  if (lectura.error || !lectura.filas) return { error: lectura.error }

  const objetos = filasComoObjetos(lectura.filas)
  const validos = objetos.map(validarFilaCliente)
  const errores = validos
    .map((r, i) => (r.ok ? null : { fila: i + 2, mensajes: r.errores }))
    .filter((e): e is { fila: number; mensajes: string[] } => e !== null)
  const filasOkConFila = validos
    .map((r, i) => (r.ok ? { datos: r.datos, fila: i + 2 } : null))
    .filter(
      (v): v is { datos: Extract<(typeof validos)[number], { ok: true }>['datos']; fila: number } => v !== null
    )

  const registrosConFila = filasOkConFila.map(({ datos: f, fila }) => ({
    registro: {
      empresa_id: activa.id,
      rut: f.rut,
      razon_social: f.razonSocial,
      giro: f.giro ?? null,
      email: f.email ?? null,
      telefono: f.telefono ?? null,
      direccion: f.direccion ?? null,
      comuna: f.comuna ?? null,
      condicion_pago_dias: f.condicionPagoDias,
      activo: true,
    },
    fila,
  }))

  const porClave = new Map<string, { registro: (typeof registrosConFila)[number]['registro']; fila: number }>()
  for (const { registro, fila } of registrosConFila) {
    const clave = registro.rut
    const previo = porClave.get(clave)
    if (previo) {
      errores.push({ fila: previo.fila, mensajes: ['RUT duplicado en el archivo; se usó la última aparición'] })
    }
    porClave.set(clave, { registro, fila })
  }
  const registros = [...porClave.values()].map((v) => v.registro)
  errores.sort((a, b) => a.fila - b.fila)

  const supabase = await crearClienteServidor()
  for (let i = 0; i < registros.length; i += 500) {
    const { error } = await supabase
      .from('clientes')
      .upsert(registros.slice(i, i + 500), { onConflict: 'empresa_id,rut' })
    if (error) {
      if (error.code === '42501') return { error: 'Tu rol no permite importar clientes' }
      return { error: 'Error al guardar los clientes: revisa el archivo' }
    }
  }

  revalidatePath('/clientes')
  return { procesadas: registros.length, errores }
}
```

- [ ] **Step 3: `EmpresaResumen` gana `organizacion_id` (pre-check de rol)**

El rol vive en `miembros (usuario_id, organizacion_id)` y `EmpresaResumen` hoy no expone la organización de la empresa activa: se amplían interface y select (aditivo — RLS de `empresas` ya deja leer la columna; ningún otro consumidor se toca). `apps/erp/lib/empresa-activa.ts` completo queda así:

```ts
import 'server-only'
import { cookies } from 'next/headers'
import { crearClienteServidor } from '@suite/auth/server'

export const COOKIE_EMPRESA = 'empresa_activa'

export interface EmpresaResumen {
  id: string
  organizacion_id: string
  rut: string
  razon_social: string
  modulo_transporte: boolean
}

export async function obtenerEmpresas(): Promise<EmpresaResumen[]> {
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase
    .from('empresas')
    .select('id, organizacion_id, rut, razon_social, modulo_transporte')
    .order('razon_social')
  if (error) throw new Error('No se pudieron cargar tus empresas')
  return data ?? []
}

export async function obtenerEmpresaActiva(): Promise<{
  activa: EmpresaResumen | null
  empresas: EmpresaResumen[]
}> {
  const empresas = await obtenerEmpresas()
  const almacen = await cookies()
  const id = almacen.get(COOKIE_EMPRESA)?.value
  const activa = empresas.find((e) => e.id === id) ?? empresas[0] ?? null
  return { activa, empresas }
}
```

- [ ] **Step 4: `bodySizeLimit` en la config de Next**

El archivo real es `apps/erp/next.config.ts` (TypeScript, no `.mjs`) y la versión instalada es `next ^15.1.0`: en Next 15 la clave sigue bajo `experimental.serverActions.bodySizeLimit` (verificado contra la doc de `serverActions` de Next 15; el default de 1 MB cortaría el POST antes de llegar a la action). Completo queda así:

```ts
import type { NextConfig } from 'next'

const config: NextConfig = {
  transpilePackages: ['@suite/core', '@suite/db', '@suite/auth', '@suite/ui'],
  experimental: {
    // 11 MB: margen sobre el tope real de 10 MB para que el check
    // `archivo.size > 10MB` de la action llegue a ejecutarse y dé el mensaje
    // claro, en vez de que Next corte el POST justo en el límite y el
    // usuario reciba el error genérico del framework. Este bodySizeLimit es
    // GLOBAL a la app (toda Server Action, no solo importarCargasTct); se
    // acepta porque todas las actions son autenticadas de un solo tenant.
    serverActions: { bodySizeLimit: '11mb' },
  },
}

export default config
```

- [ ] **Step 5: la Server Action `importarCargasTct`**

`apps/erp/app/combustible/importar.ts` (el orden 1→6 del spec §5 va numerado en comentarios):

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@suite/auth/server'
import {
  limpiarRut,
  localizarColumnasTct,
  normalizarPatente,
  parsearFechaTct,
  parsearLitrosTct,
  parsearMontoTct,
} from '@suite/core'
import { leerCSV } from '../../lib/csv'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'

export interface ResultadoImportTct {
  importadas: number
  duplicadas: number
  errores: { fila: number; motivo: string }[]
  error?: string
}

// El MAX_FILAS = 1000 de /importar queda corto para un año de flota.
const MAX_FILAS_TCT = 20000
const MAX_BYTES_TCT = 10 * 1024 * 1024
const LOTE = 500
const RE_HORA = /^\d{2}:\d{2}(:\d{2})?$/

// Celda por índice de columna; tolera índice ausente (== null cubre null y
// undefined: las columnas opcionales de ColumnasTct pueden venir de ambas formas).
function celda(fila: string[], indice: number | null | undefined): string {
  return indice == null ? '' : (fila[indice] ?? '').trim()
}

// Set COMPLETO de claves en todas las filas: el bulk insert de PostgREST exige
// que cada objeto del lote tenga las mismas columnas.
interface CargaNueva {
  empresa_id: string
  vehiculo_id: string
  conductor_id: string | null
  fecha: string
  hora: string | null
  litros: number
  precio_litro: number | null
  monto: number
  estacion: string | null
  comuna: string | null
  guia: string
  rut_chofer: string | null
  tarjeta: string | null
  odometro: number | null
  producto: string
  origen: 'tct'
}

export async function importarCargasTct(
  _prev: ResultadoImportTct,
  formData: FormData
): Promise<ResultadoImportTct> {
  const vacio: ResultadoImportTct = { importadas: 0, duplicadas: 0, errores: [] }

  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { ...vacio, error: 'No tienes una empresa activa' }

  const supabase = await crearClienteServidor()

  // (1) Rol ANTES de parsear: un vendedor no pone al server a decodificar
  // 10 MB. La policy de insert de 0017 es el backstop; esto es el corte barato.
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ...vacio, error: 'No tienes una empresa activa' }
  const { data: miembro } = await supabase
    .from('miembros')
    .select('rol')
    .eq('organizacion_id', activa.organizacion_id)
    .eq('usuario_id', user.id)
    .eq('estado', 'activo')
    .maybeSingle()
  if (!miembro || (miembro.rol !== 'dueno' && miembro.rol !== 'admin')) {
    return { ...vacio, error: 'Tu rol no permite importar cargas' }
  }

  // (2) Límites: el bodySizeLimit de next.config es la barrera dura; este
  // check da el mensaje claro. El tope de filas lo aplica leerCSV.
  const archivo = formData.get('archivo')
  if (archivo instanceof File && archivo.size > MAX_BYTES_TCT) {
    return { ...vacio, error: 'El archivo supera el máximo de 10 MB' }
  }

  // (3) Lectura (BOM/encoding) + guard de Excel + localización de columnas.
  const lectura = await leerCSV(formData, MAX_FILAS_TCT)
  if (lectura.error || !lectura.filas || !lectura.texto) {
    return { ...vacio, error: lectura.error ?? 'No se pudo leer el archivo' }
  }
  // Guard de archivo re-guardado desde Excel: el flag viene de leerCSV,
  // capturado ANTES del fallback CP-1252 — por eso es ALCANZABLE (a esta
  // altura lectura.texto ya es el resultado del fallback, sin U+FFFD, así
  // que revisarlo aquí directamente jamás dispararía). Corta ANTES de
  // localizar columnas: un header con mojibake jamás calza de todos modos,
  // pero así el mensaje señala la causa real en vez del genérico.
  if (lectura.codificacionRecuperada) {
    return {
      ...vacio,
      error:
        'El archivo parece re-guardado desde Excel (codificación o separador alterados); sube el CSV original descargado de TCT',
    }
  }
  const columnas = localizarColumnasTct(lectura.filas[0]!)
  if (!columnas) {
    // Guard adicional: ';' dominante en la primera línea delata el
    // re-guardado es-CL de Excel aunque la codificación haya decodificado
    // limpio (el separador cambia sin romper tildes). Los reportes
    // AGREGADOS de TCT caen al mensaje genérico.
    const primeraLinea = lectura.texto.split('\n', 1)[0] ?? ''
    const puntosComa = (primeraLinea.match(/;/g) ?? []).length
    const comas = (primeraLinea.match(/,/g) ?? []).length
    if (puntosComa > comas) {
      return {
        ...vacio,
        error:
          'El archivo parece re-guardado desde Excel (codificación o separador alterados); sube el CSV original descargado de TCT',
      }
    }
    return { ...vacio, error: 'El archivo no parece el reporte TCT de Consumos Diarios' }
  }

  // (4) Lookups por empresa — UNA query por maestro, a Map. El .eq('empresa_id')
  // es el filtro funcional; la RLS es backstop. Vehículos SIN filtrar activo:
  // las cargas históricas de camiones dados de baja entran igual (deliberado).
  // ponytail: sin paginar — una flota real no roza el límite de 1000 filas de PostgREST.
  const { data: vehiculos, error: errorVehiculos } = await supabase
    .from('vehiculos')
    .select('id, patente')
    .eq('empresa_id', activa.id)
  if (errorVehiculos) return { ...vacio, error: 'No se pudo leer la flota' }
  const vehiculoPorPatente = new Map((vehiculos ?? []).map((v) => [v.patente, v.id] as const))

  const { data: conductores, error: errorConductores } = await supabase
    .from('conductores')
    .select('id, rut')
    .eq('empresa_id', activa.id)
  if (errorConductores) return { ...vacio, error: 'No se pudieron leer los conductores' }
  const conductorPorRut = new Map((conductores ?? []).map((c) => [c.rut, c.id] as const))

  const errores: { fila: number; motivo: string }[] = []
  let duplicadas = 0
  const guiasVistas = new Set<string>()
  const candidatas: { fila: number; registro: CargaNueva }[] = []

  lectura.filas.slice(1).forEach((filaCsv, i) => {
    const fila = i + 2 // fila 1 = encabezado

    const patente = normalizarPatente(celda(filaCsv, columnas.patente))
    const vehiculoId = vehiculoPorPatente.get(patente)
    if (!vehiculoId) {
      errores.push({ fila, motivo: `Vehículo con patente ${patente || '(vacía)'} no está registrado en Flota` })
      return
    }

    const fecha = parsearFechaTct(celda(filaCsv, columnas.fecha))
    if (fecha === null) {
      errores.push({ fila, motivo: 'Fecha de transacción inválida (se espera DD-MM-YYYY)' })
      return
    }

    const litros = parsearLitrosTct(celda(filaCsv, columnas.volumen))
    if (litros === null) {
      errores.push({ fila, motivo: 'Volumen inválido (los litros deben ser un número mayor a 0)' })
      return
    }
    // Tope de litros numeric(9,2): sin este corte, un valor fuera de rango
    // revienta el lote entero en Postgres en vez de reportarse por fila.
    if (litros > 9999999.99) {
      errores.push({ fila, motivo: 'litros fuera de rango' })
      return
    }

    const monto = parsearMontoTct(celda(filaCsv, columnas.monto))
    if (monto === null) {
      errores.push({ fila, motivo: 'Monto inválido (debe ser un número mayor a 0)' })
      return
    }
    // Tope de integer de Postgres: mismo motivo que el de litros.
    if (monto > 2147483647) {
      errores.push({ fila, motivo: 'monto fuera de rango' })
      return
    }

    const guia = celda(filaCsv, columnas.guia)
    if (guia === '') {
      errores.push({ fila, motivo: 'sin guía de despacho, no se puede deduplicar' })
      return
    }

    // Dedup in-file: la repetida cuenta como duplicada, no como error.
    if (guiasVistas.has(guia)) {
      duplicadas++
      return
    }
    guiasVistas.add(guia)

    // Hora fuera de formato o de rango calendario NO es error de fila: queda
    // null (coherente con 'hora inválida = null sin error'). La regex sola
    // deja pasar '99:99:99'; HH<24/MM<60/SS<60 cierra ese hueco.
    const horaCruda = celda(filaCsv, columnas.hora)
    let hora: string | null = null
    if (RE_HORA.test(horaCruda)) {
      const [hh, mm, ss] = horaCruda.split(':').map(Number)
      if (hh! < 24 && mm! < 60 && (ss === undefined || ss < 60)) hora = horaCruda
    }

    // RUT del chofer: con match va conductor_id y el RUT NO se persiste
    // (minimización, Ley 21.719 — ya vive en conductores); sin match se
    // persiste el RUT normalizado para trazabilidad. Nunca es error.
    const rutNormalizado = limpiarRut(celda(filaCsv, columnas.rutChofer))
    const conductorId = rutNormalizado === '' ? null : (conductorPorRut.get(rutNormalizado) ?? null)

    const estacion = celda(filaCsv, columnas.estacion)
    const comuna = celda(filaCsv, columnas.comuna)
    const tarjeta = celda(filaCsv, columnas.tarjeta)
    const producto = celda(filaCsv, columnas.producto)

    candidatas.push({
      fila,
      registro: {
        empresa_id: activa.id,
        vehiculo_id: vehiculoId,
        conductor_id: conductorId,
        fecha,
        hora,
        litros,
        // monto es LA fuente de verdad; el precio es informativo y JAMÁS se
        // valida contra litros × precio (Copec redondea distinto: 349,13 ×
        // 1123 = 392.073 ≠ 392.076 del archivo real).
        precio_litro: parsearMontoTct(celda(filaCsv, columnas.precio)),
        monto,
        estacion: estacion || null,
        comuna: comuna || null,
        guia,
        rut_chofer: conductorId === null && rutNormalizado !== '' ? rutNormalizado : null,
        tarjeta: tarjeta || null,
        // Odómetro CRUDO (viene basura, casi siempre '1'); mismo parser
        // numérico TCT, null si no calza.
        odometro: parsearMontoTct(celda(filaCsv, columnas.odometro)),
        producto: producto || 'Diésel',
        origen: 'tct',
      },
    })
  })

  // Dedup contra BD: pre-check por chunks de 500 con .in(). El índice único
  // es POR EMPRESA: sin el .eq('empresa_id'), a un dueño de dos empresas se
  // le saltarían cargas reales.
  const guias = candidatas.map((c) => c.registro.guia)
  const existentes = new Set<string>()
  for (let i = 0; i < guias.length; i += LOTE) {
    const { data, error } = await supabase
      .from('cargas_combustible')
      .select('guia')
      .eq('empresa_id', activa.id)
      .in('guia', guias.slice(i, i + LOTE))
    if (error) return { ...vacio, error: 'No se pudieron verificar duplicados; intenta de nuevo' }
    for (const d of data ?? []) {
      if (d.guia !== null) existentes.add(d.guia)
    }
  }
  const nuevas = candidatas.filter((c) => {
    if (existentes.has(c.registro.guia)) {
      duplicadas++
      return false
    }
    return true
  })

  // (5) Insert en lotes de 500. CUALQUIER error del lote (23505 por carrera
  // con otro import — el pre-check no es transaccional —, 23503 por
  // vehículo/conductor recién eliminado, u otro) dispara retry FILA A FILA:
  // jamás se pierden 499 filas buenas por culpa de una mala, y se reporta
  // solo la caída. La ÚNICA excepción es 42501: un permiso denegado es
  // terminal (el rol ya no cambia fila a fila), así que corta el import
  // entero con el mensaje de rol en vez de reintentar 500 veces en vano.
  let importadas = 0
  for (let i = 0; i < nuevas.length; i += LOTE) {
    const lote = nuevas.slice(i, i + LOTE)
    const { error } = await supabase.from('cargas_combustible').insert(lote.map((c) => c.registro))
    if (!error) {
      importadas += lote.length
      continue
    }
    if (error.code === '42501') {
      return { importadas, duplicadas, errores, error: 'Tu rol no permite importar cargas' }
    }
    for (const c of lote) {
      const { error: errorFila } = await supabase.from('cargas_combustible').insert(c.registro)
      if (!errorFila) {
        importadas++
      } else if (errorFila.code === '23505') {
        // Guía duplicada (BD) = contador, no error: otro import ganó la
        // carrera entre el pre-check y el insert.
        duplicadas++
      } else {
        errores.push({ fila: c.fila, motivo: 'No se pudo guardar la carga (referencia inválida o error de datos)' })
      }
    }
  }

  // (6) Retorno con errores ordenados (el retry puede haber agregado fuera de orden).
  errores.sort((a, b) => a.fila - b.fila)
  revalidatePath('/combustible')
  return { importadas, duplicadas, errores }
}
```

- [ ] **Step 6: Verificar y commit**

Run: `pnpm --filter erp build` → compila sin errores (typecheck cubre `importar.ts` aunque la ruta `/combustible` aún no exista: la page llega en Task 6) y `/importar` sigue apareciendo en el listado de rutas del output.

```bash
git add apps/erp/lib/csv.ts apps/erp/app/combustible/importar.ts apps/erp/app/importar/acciones.ts apps/erp/lib/empresa-activa.ts apps/erp/next.config.ts
git commit -m "feat(erp): import del reporte TCT con dedup doble y retry por fila"
```

---
### Task 6: ERP — /combustible (import UI + cargas + gastos + derivadas)

**Files:**
- Create: `apps/erp/app/combustible/categorias.ts`, `apps/erp/app/combustible/acciones.ts`, `apps/erp/componentes/formulario-import-tct.tsx`, `apps/erp/componentes/formulario-carga-manual.tsx`, `apps/erp/componentes/formulario-gasto.tsx`, `apps/erp/componentes/boton-eliminar-costo.tsx`, `apps/erp/app/combustible/page.tsx`
- Modify: `apps/erp/app/layout.tsx` (NAV: +Combustible tras Proformas, module-gated)

**Interfaces:**
- Consumes: tablas `cargas_combustible`/`gastos_vehiculo` (migración 0017, Task 1 — insert/delete directo dueno/admin, SIN update); tipos `@suite/db` regenerados (Task 3); Server Action `importarCargasTct` y tipo `ResultadoImportTct` de Task 5 — fuente ÚNICA: `apps/erp/app/combustible/importar.ts` (`{ importadas: number; duplicadas: number; errores: { fila: number; motivo: string }[]; error?: string }` — solo `error` es opcional); `formulario-import-tct.tsx` importa el tipo directo de ahí (`import type { ResultadoImportTct } from '../app/combustible/importar'`, type-only desde un archivo `'use server'` es válido) — NO de `apps/erp/app/tipos.ts`, que no lo re-exporta; `formatearCLP`, `formatearPatente`, `rangoDeMes` de `@suite/core`; `obtenerEmpresaActiva` (`activa.modulo_transporte`); `@suite/ui` (`Boton`, `Campo`, `Encabezado`, `Entrada`, `Insignia`, `Selector`, `Tabla`, `Tarjeta`, `Td`, `Th`, `Tr`). El `next.config` (bodySizeLimit) es de Task 5 — NO lo toques aquí.
- Espejos estructurales — léelos COMPLETOS antes de escribir: `apps/erp/app/importar/page.tsx` + `apps/erp/componentes/formulario-importar.tsx` (file input + useActionState + render del resumen), `apps/erp/app/entregas/page.tsx` (filtros GET mes/selector, totales al pie, embed `vehiculos (patente)`), `apps/erp/app/flota/acciones.ts` (validaciones app-side + mapeo 42501/23505 + `.select('id')` contra el éxito falso), `apps/erp/componentes/formulario-anular-orden.tsx` (confirmación en dos pasos con useState).
- Produces: página `/combustible` (guard `notFound()` módulo off; TODAS las queries `.eq('empresa_id', activa.id)`): import TCT con resumen, carga manual (solo vehículos ACTIVOS), gastos, lista de cargas del mes CON HORA (`'—'` manuales) y totales L/$, lista de gastos con total, tablas derivadas del mes por patente y por estación; Server Actions `crearCargaManual`, `crearGasto`, `eliminarCarga`, `eliminarGasto`; NAV con `Combustible`.
- Eliminar: `.delete().eq('id').eq('empresa_id', activa.id).select('id')` — 0 filas = error `'No se pudo eliminar'` (la policy de delete filtra en silencio para `vendedor`: sin el `.select` habría éxito falso).
- Asimetría deliberada (spec §2): el import acepta vehículos inactivos (histórico); los formularios manuales solo ofrecen ACTIVOS y la action re-verifica (el POST se puede forjar).

- [ ] **Step 1: Categorías de gasto**

`apps/erp/app/combustible/categorias.ts` (patrón `entregas/estados.ts` — un `'use server'` solo puede exportar funciones async, por eso las constantes viven aparte):

```ts
export const CATEGORIAS_GASTO = ['peaje', 'mantencion', 'neumaticos', 'seguro', 'permiso', 'otro'] as const

export const ETIQUETA_CATEGORIA: Record<string, string> = {
  peaje: 'Peaje',
  mantencion: 'Mantención',
  neumaticos: 'Neumáticos',
  seguro: 'Seguro',
  permiso: 'Permiso de circulación',
  otro: 'Otro',
}
```

- [ ] **Step 2: Server Actions de cargas y gastos**

`apps/erp/app/combustible/acciones.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import type { EstadoForm } from '../tipos'
import { CATEGORIAS_GASTO } from './categorias'

export async function crearCargaManual(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const vehiculoId = String(formData.get('vehiculo_id') ?? '')
  if (!vehiculoId) return { error: 'Selecciona un vehículo' }
  const fecha = String(formData.get('fecha') ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return { error: 'La fecha no es válida' }
  // Coma decimal tolerada: el transportista escribe "38,5" igual que en el papel.
  const litros = Number(String(formData.get('litros') ?? '').trim().replace(',', '.'))
  if (!Number.isFinite(litros) || litros <= 0) return { error: 'Los litros deben ser un número mayor a 0' }
  const monto = Number(String(formData.get('monto') ?? '').trim())
  if (!Number.isInteger(monto) || monto <= 0) return { error: 'El monto debe ser un entero de pesos mayor a 0' }
  const precioCrudo = String(formData.get('precio_litro') ?? '').trim()
  const precioLitro = precioCrudo === '' ? null : Number(precioCrudo)
  if (precioLitro !== null && (!Number.isInteger(precioLitro) || precioLitro <= 0)) {
    return { error: 'El precio por litro debe ser un entero de pesos mayor a 0 (o dejarse vacío)' }
  }
  const estacion = String(formData.get('estacion') ?? '').trim()

  const supabase = await crearClienteServidor()
  // Solo vehículos ACTIVOS de la empresa: el form ya filtra, pero el POST se puede forjar.
  // (El import TCT sí acepta inactivos — asimetría deliberada del spec §2.)
  const { data: vehiculo } = await supabase
    .from('vehiculos')
    .select('id')
    .eq('id', vehiculoId)
    .eq('empresa_id', activa.id)
    .eq('activo', true)
    .maybeSingle()
  if (!vehiculo) return { error: 'El vehículo no existe o está inactivo' }

  const { error } = await supabase.from('cargas_combustible').insert({
    empresa_id: activa.id,
    vehiculo_id: vehiculoId,
    fecha,
    litros,
    monto,
    precio_litro: precioLitro,
    estacion: estacion || null,
    origen: 'manual',
  })
  if (error) {
    if (error.code === '42501') return { error: 'Tu rol no permite registrar costos' }
    return { error: 'No se pudo registrar la carga' }
  }
  revalidatePath('/combustible')
  redirect('/combustible')
}

export async function crearGasto(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const vehiculoId = String(formData.get('vehiculo_id') ?? '')
  if (!vehiculoId) return { error: 'Selecciona un vehículo' }
  const fecha = String(formData.get('fecha') ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return { error: 'La fecha no es válida' }
  const categoria = String(formData.get('categoria') ?? '')
  if (!(CATEGORIAS_GASTO as readonly string[]).includes(categoria)) {
    return { error: 'Categoría de gasto no válida' }
  }
  const monto = Number(String(formData.get('monto') ?? '').trim())
  if (!Number.isInteger(monto) || monto <= 0) return { error: 'El monto debe ser un entero de pesos mayor a 0' }
  const notas = String(formData.get('notas') ?? '').trim()

  const supabase = await crearClienteServidor()
  const { data: vehiculo } = await supabase
    .from('vehiculos')
    .select('id')
    .eq('id', vehiculoId)
    .eq('empresa_id', activa.id)
    .eq('activo', true)
    .maybeSingle()
  if (!vehiculo) return { error: 'El vehículo no existe o está inactivo' }

  const { error } = await supabase.from('gastos_vehiculo').insert({
    empresa_id: activa.id,
    vehiculo_id: vehiculoId,
    fecha,
    categoria,
    monto,
    notas: notas || null,
  })
  if (error) {
    if (error.code === '42501') return { error: 'Tu rol no permite registrar costos' }
    return { error: 'No se pudo registrar el gasto' }
  }
  revalidatePath('/combustible')
  redirect('/combustible')
}

export async function eliminarCarga(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  const id = String(formData.get('id') ?? '')
  const supabase = await crearClienteServidor()
  // .select('id') delata el éxito falso: para vendedor el grant de delete existe
  // pero la policy filtra en silencio — 0 filas afectadas = NO hubo borrado.
  const { data, error } = await supabase
    .from('cargas_combustible')
    .delete()
    .eq('id', id)
    .eq('empresa_id', activa.id)
    .select('id')
  if (error || (data ?? []).length === 0) return { error: 'No se pudo eliminar' }
  revalidatePath('/combustible')
  return {}
}

export async function eliminarGasto(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  const id = String(formData.get('id') ?? '')
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase
    .from('gastos_vehiculo')
    .delete()
    .eq('id', id)
    .eq('empresa_id', activa.id)
    .select('id')
  if (error || (data ?? []).length === 0) return { error: 'No se pudo eliminar' }
  revalidatePath('/combustible')
  return {}
}
```

- [ ] **Step 3: Formulario de import TCT (cliente)**

`apps/erp/componentes/formulario-import-tct.tsx` (espejo de `formulario-importar.tsx`; los errores TCT traen `motivo` singular, no `mensajes`):

```tsx
'use client'

import { useActionState } from 'react'
import { Boton, Tarjeta } from '@suite/ui'
import type { ResultadoImportTct } from '../app/combustible/importar'

export function FormularioImportTct({
  accion,
}: {
  accion: (prev: ResultadoImportTct, formData: FormData) => Promise<ResultadoImportTct>
}) {
  const [resultado, enviar, pendiente] = useActionState(accion, { importadas: 0, duplicadas: 0, errores: [] })
  return (
    <Tarjeta>
      <h2 className="text-lg font-semibold text-slate-900">Importar Consumos Diarios (TCT)</h2>
      <p className="mt-1 text-sm text-slate-600">
        Sube el CSV tal cual se descarga de la plataforma TCT de Copec. Re-importar el mismo
        archivo no duplica: las guías ya registradas se cuentan como duplicadas.
      </p>
      <form action={enviar} className="mt-4 flex items-center gap-3">
        <input type="file" name="archivo" accept=".csv,text/csv" required className="text-sm" />
        <Boton type="submit" disabled={pendiente}>
          {pendiente ? 'Importando…' : 'Importar'}
        </Boton>
      </form>
      {resultado.error && <p className="mt-3 text-sm text-red-600">{resultado.error}</p>}
      {resultado.importadas !== undefined && (
        <div className="mt-3 text-sm">
          <p className="text-green-700">{resultado.importadas} carga(s) importada(s).</p>
          {(resultado.duplicadas ?? 0) > 0 && (
            <p className="text-slate-600">{resultado.duplicadas} duplicada(s) omitida(s) (guía ya registrada).</p>
          )}
          {resultado.errores && resultado.errores.length > 0 && (
            <div className="mt-2 rounded-md bg-amber-50 p-3 text-amber-900">
              <p className="font-medium">{resultado.errores.length} fila(s) con errores (no importadas):</p>
              <ul className="mt-1 list-inside list-disc">
                {resultado.errores.slice(0, 20).map((e) => (
                  <li key={e.fila}>
                    Fila {e.fila}: {e.motivo}
                  </li>
                ))}
                {resultado.errores.length > 20 && <li>… y {resultado.errores.length - 20} más</li>}
              </ul>
            </div>
          )}
        </div>
      )}
    </Tarjeta>
  )
}
```

- [ ] **Step 4: Formulario de carga manual (cliente)**

`apps/erp/componentes/formulario-carga-manual.tsx`:

```tsx
'use client'

import { useActionState } from 'react'
import { formatearPatente } from '@suite/core'
import { Boton, Campo, Entrada, Selector, Tarjeta } from '@suite/ui'
import type { EstadoForm } from '../app/tipos'

interface VehiculoOpcion {
  id: string
  patente: string
}

export function FormularioCargaManual({
  accion,
  vehiculos,
}: {
  accion: (prev: EstadoForm, formData: FormData) => Promise<EstadoForm>
  vehiculos: VehiculoOpcion[]
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoForm)
  return (
    <Tarjeta>
      <h2 className="text-lg font-semibold text-slate-900">Carga manual</h2>
      <p className="mt-1 text-sm text-slate-600">
        Para cargas fuera de TCT (efectivo, otra distribuidora). Sin guía no hay dedup:
        si la digitas dos veces, elimina la repetida.
      </p>
      <form action={enviar} className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Campo etiqueta="Vehículo *">
          <Selector name="vehiculo_id" required defaultValue="">
            <option value="" disabled>Selecciona…</option>
            {vehiculos.map((v) => (
              <option key={v.id} value={v.id}>{formatearPatente(v.patente)}</option>
            ))}
          </Selector>
        </Campo>
        <Campo etiqueta="Fecha *"><Entrada type="date" name="fecha" required /></Campo>
        <Campo etiqueta="Litros *"><Entrada name="litros" inputMode="decimal" placeholder="38,5" required /></Campo>
        <Campo etiqueta="Monto total ($) *"><Entrada name="monto" inputMode="numeric" placeholder="45000" required /></Campo>
        <Campo etiqueta="Precio por litro ($)"><Entrada name="precio_litro" inputMode="numeric" /></Campo>
        <Campo etiqueta="Estación"><Entrada name="estacion" placeholder="Copec Ruta 5" /></Campo>
        <div className="flex items-center justify-end gap-2 sm:col-span-2">
          {estado.error && <span className="mr-auto text-sm text-red-600">{estado.error}</span>}
          <Boton type="submit" disabled={pendiente}>
            {pendiente ? 'Guardando…' : 'Registrar carga'}
          </Boton>
        </div>
      </form>
    </Tarjeta>
  )
}
```

- [ ] **Step 5: Formulario de gasto (cliente)**

`apps/erp/componentes/formulario-gasto.tsx`:

```tsx
'use client'

import { useActionState } from 'react'
import { formatearPatente } from '@suite/core'
import { Boton, Campo, Entrada, Selector, Tarjeta } from '@suite/ui'
import { CATEGORIAS_GASTO, ETIQUETA_CATEGORIA } from '../app/combustible/categorias'
import type { EstadoForm } from '../app/tipos'

interface VehiculoOpcion {
  id: string
  patente: string
}

export function FormularioGasto({
  accion,
  vehiculos,
}: {
  accion: (prev: EstadoForm, formData: FormData) => Promise<EstadoForm>
  vehiculos: VehiculoOpcion[]
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoForm)
  return (
    <Tarjeta>
      <h2 className="text-lg font-semibold text-slate-900">Gasto del vehículo</h2>
      <p className="mt-1 text-sm text-slate-600">
        Peajes, mantención, neumáticos, seguros y otros costos directos del camión.
      </p>
      <form action={enviar} className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Campo etiqueta="Vehículo *">
          <Selector name="vehiculo_id" required defaultValue="">
            <option value="" disabled>Selecciona…</option>
            {vehiculos.map((v) => (
              <option key={v.id} value={v.id}>{formatearPatente(v.patente)}</option>
            ))}
          </Selector>
        </Campo>
        <Campo etiqueta="Fecha *"><Entrada type="date" name="fecha" required /></Campo>
        <Campo etiqueta="Categoría *">
          <Selector name="categoria" required defaultValue="">
            <option value="" disabled>Selecciona…</option>
            {CATEGORIAS_GASTO.map((c) => (
              <option key={c} value={c}>{ETIQUETA_CATEGORIA[c]}</option>
            ))}
          </Selector>
        </Campo>
        <Campo etiqueta="Monto ($) *"><Entrada name="monto" inputMode="numeric" placeholder="25000" required /></Campo>
        <div className="sm:col-span-2">
          <Campo etiqueta="Notas"><Entrada name="notas" placeholder="Cambio de aceite 10.000 km" /></Campo>
        </div>
        <div className="flex items-center justify-end gap-2 sm:col-span-2">
          {estado.error && <span className="mr-auto text-sm text-red-600">{estado.error}</span>}
          <Boton type="submit" disabled={pendiente}>
            {pendiente ? 'Guardando…' : 'Registrar gasto'}
          </Boton>
        </div>
      </form>
    </Tarjeta>
  )
}
```

- [ ] **Step 6: Botón eliminar con confirmación (cliente)**

`apps/erp/componentes/boton-eliminar-costo.tsx` (espejo de `formulario-anular-orden.tsx`: confirmación en dos pasos, sin `window.confirm` — la action llega por prop, así el mismo botón sirve para cargas y gastos):

```tsx
'use client'

import { useActionState, useState } from 'react'
import { Boton } from '@suite/ui'
import type { EstadoForm } from '../app/tipos'

export function BotonEliminarCosto({
  id,
  accion,
}: {
  id: string
  accion: (prev: EstadoForm, formData: FormData) => Promise<EstadoForm>
}) {
  const [abierto, setAbierto] = useState(false)
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoForm)
  if (!abierto) {
    return <Boton variante="secundario" type="button" className="px-2 py-1 text-xs" onClick={() => setAbierto(true)}>Eliminar</Boton>
  }
  return (
    <form action={enviar} className="flex items-center justify-end gap-2">
      <input type="hidden" name="id" value={id} />
      <Boton variante="secundario" type="submit" disabled={pendiente} className="px-2 py-1 text-xs">{pendiente ? '…' : '¿Eliminar?'}</Boton>
      <Boton variante="secundario" type="button" className="px-2 py-1 text-xs" onClick={() => setAbierto(false)}>No</Boton>
      {estado.error && <span className="text-xs text-red-600">{estado.error}</span>}
    </form>
  )
}
```

- [ ] **Step 7: Página `/combustible`**

`apps/erp/app/combustible/page.tsx` (espejo de `entregas/page.tsx` para filtros y totales; a diferencia de Entregas, aquí SIEMPRE hay un mes efectivo — las listas y derivadas son mensuales para cuadrar contra los reportes TCT; el selector de vehículo ofrece TODOS, incluso inactivos, porque el import acepta históricos):

```tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP, formatearPatente, rangoDeMes } from '@suite/core'
import { Boton, Encabezado, Entrada, Insignia, Selector, Tabla, Td, Th, Tr } from '@suite/ui'
import { BotonEliminarCosto } from '../../componentes/boton-eliminar-costo'
import { FormularioCargaManual } from '../../componentes/formulario-carga-manual'
import { FormularioGasto } from '../../componentes/formulario-gasto'
import { FormularioImportTct } from '../../componentes/formulario-import-tct'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import { crearCargaManual, crearGasto, eliminarCarga, eliminarGasto } from './acciones'
import { ETIQUETA_CATEGORIA } from './categorias'
import { importarCargasTct } from './importar'

const NUM = (n: number) => n.toLocaleString('es-CL', { maximumFractionDigits: 2 })

export default async function PaginaCombustible({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string; vehiculo?: string }>
}) {
  const { mes = '', vehiculo = '' } = await searchParams
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  if (!activa.modulo_transporte) notFound()
  const ahora = new Date()
  const mesActual = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}`
  const mesEfectivo = rangoDeMes(mes) ? mes : mesActual
  // mesActual siempre es 'YYYY-MM' válido: el fallback nunca es null.
  const rango = rangoDeMes(mesEfectivo)!
  const supabase = await crearClienteServidor()
  const [{ data: vehiculos }, consultaCargas, consultaGastos] = await Promise.all([
    supabase.from('vehiculos').select('id, patente, activo').eq('empresa_id', activa.id).order('patente'),
    (() => {
      let q = supabase
        .from('cargas_combustible')
        .select('id, fecha, hora, litros, precio_litro, monto, estacion, guia, origen, vehiculos (patente)')
        .eq('empresa_id', activa.id)
        .gte('fecha', rango.desde)
        .lte('fecha', rango.hasta)
        .order('fecha', { ascending: false })
        .order('hora', { ascending: false, nullsFirst: false })
        .limit(1000)
      if (vehiculo) q = q.eq('vehiculo_id', vehiculo)
      return q
    })(),
    (() => {
      let q = supabase
        .from('gastos_vehiculo')
        .select('id, fecha, categoria, monto, notas, vehiculos (patente)')
        .eq('empresa_id', activa.id)
        .gte('fecha', rango.desde)
        .lte('fecha', rango.hasta)
        .order('fecha', { ascending: false })
        .limit(1000)
      if (vehiculo) q = q.eq('vehiculo_id', vehiculo)
      return q
    })(),
  ])
  const cargas = consultaCargas.data ?? []
  const gastos = consultaGastos.data ?? []
  const activos = (vehiculos ?? []).filter((v) => v.activo)
  const totCargas = cargas.reduce(
    (a, c) => ({ litros: a.litros + c.litros, monto: a.monto + c.monto }),
    { litros: 0, monto: 0 }
  )
  const totGastos = gastos.reduce((a, g) => a + g.monto, 0)
  // Derivadas del mes: lo que Copec entrega como reportes agregados, aquí en vivo.
  const porPatente = new Map<string, { cargas: number; litros: number; monto: number }>()
  const porEstacion = new Map<string, { cargas: number; litros: number; monto: number }>()
  for (const c of cargas) {
    const clavePatente = c.vehiculos ? formatearPatente(c.vehiculos.patente) : '—'
    const acumP = porPatente.get(clavePatente) ?? { cargas: 0, litros: 0, monto: 0 }
    porPatente.set(clavePatente, { cargas: acumP.cargas + 1, litros: acumP.litros + c.litros, monto: acumP.monto + c.monto })
    const claveEstacion = c.estacion ?? '—'
    const acumE = porEstacion.get(claveEstacion) ?? { cargas: 0, litros: 0, monto: 0 }
    porEstacion.set(claveEstacion, { cargas: acumE.cargas + 1, litros: acumE.litros + c.litros, monto: acumE.monto + c.monto })
  }
  const filasPatente = [...porPatente.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  const filasEstacion = [...porEstacion.entries()].sort((a, b) => b[1].monto - a[1].monto)
  return (
    <div>
      <Encabezado titulo="Combustible" />
      <div className="mb-8 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <FormularioImportTct accion={importarCargasTct} />
        <FormularioCargaManual accion={crearCargaManual} vehiculos={activos} />
        <FormularioGasto accion={crearGasto} vehiculos={activos} />
      </div>
      <form className="mb-4 flex flex-wrap items-center gap-3" action="/combustible" method="get">
        <Selector name="vehiculo" defaultValue={vehiculo} className="max-w-xs">
          <option value="">Todos los vehículos</option>
          {(vehiculos ?? []).map((v) => (
            <option key={v.id} value={v.id}>{formatearPatente(v.patente)}{v.activo ? '' : ' (inactivo)'}</option>
          ))}
        </Selector>
        <Entrada type="month" name="mes" defaultValue={mesEfectivo} className="w-40" />
        <Boton variante="secundario" type="submit">Filtrar</Boton>
        <Link className="text-sm text-marca-700 hover:underline" href="/combustible">Limpiar</Link>
      </form>
      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold text-slate-800">Cargas del mes</h2>
        <Tabla>
          <thead>
            <tr>
              <Th>Fecha</Th><Th>Hora</Th><Th>Patente</Th><Th className="text-right">Litros</Th>
              <Th className="text-right">$/L</Th><Th className="text-right">Monto</Th><Th>Estación</Th><Th>Guía</Th><Th>Origen</Th><Th />
            </tr>
          </thead>
          <tbody>
            {cargas.map((c) => (
              <Tr key={c.id}>
                <Td>{new Date(c.fecha + 'T00:00:00').toLocaleDateString('es-CL')}</Td>
                <Td className="font-mono">{c.hora ? c.hora.slice(0, 5) : '—'}</Td>
                <Td className="font-mono">{c.vehiculos ? formatearPatente(c.vehiculos.patente) : '—'}</Td>
                <Td className="text-right">{NUM(c.litros)}</Td>
                <Td className="text-right font-mono">{c.precio_litro == null ? '—' : formatearCLP(c.precio_litro)}</Td>
                <Td className="text-right font-mono">{formatearCLP(c.monto)}</Td>
                <Td>{c.estacion ?? '—'}</Td>
                <Td className="font-mono">{c.guia ?? '—'}</Td>
                <Td>{c.origen === 'tct' ? <Insignia tono="verde">TCT</Insignia> : <Insignia tono="gris">Manual</Insignia>}</Td>
                <Td className="text-right"><BotonEliminarCosto id={c.id} accion={eliminarCarga} /></Td>
              </Tr>
            ))}
            {cargas.length === 0 && <Tr><Td colSpan={10} className="py-8 text-center text-slate-500">No hay cargas en {mesEfectivo}{vehiculo ? ' para ese vehículo' : ''}.</Td></Tr>}
          </tbody>
        </Tabla>
        <div className="mt-3 flex flex-wrap justify-end gap-6 text-sm">
          <span>Cargas: <strong>{cargas.length}</strong></span>
          <span>Litros: <strong>{NUM(totCargas.litros)}</strong></span>
          <span>Combustible: <strong className="font-mono">{formatearCLP(totCargas.monto)}</strong></span>
        </div>
      </section>
      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold text-slate-800">Gastos del mes</h2>
        <Tabla>
          <thead>
            <tr><Th>Fecha</Th><Th>Patente</Th><Th>Categoría</Th><Th className="text-right">Monto</Th><Th>Notas</Th><Th /></tr>
          </thead>
          <tbody>
            {gastos.map((g) => (
              <Tr key={g.id}>
                <Td>{new Date(g.fecha + 'T00:00:00').toLocaleDateString('es-CL')}</Td>
                <Td className="font-mono">{g.vehiculos ? formatearPatente(g.vehiculos.patente) : '—'}</Td>
                <Td>{ETIQUETA_CATEGORIA[g.categoria] ?? g.categoria}</Td>
                <Td className="text-right font-mono">{formatearCLP(g.monto)}</Td>
                <Td>{g.notas ?? '—'}</Td>
                <Td className="text-right"><BotonEliminarCosto id={g.id} accion={eliminarGasto} /></Td>
              </Tr>
            ))}
            {gastos.length === 0 && <Tr><Td colSpan={6} className="py-8 text-center text-slate-500">No hay gastos en {mesEfectivo}{vehiculo ? ' para ese vehículo' : ''}.</Td></Tr>}
          </tbody>
        </Tabla>
        <div className="mt-3 flex flex-wrap justify-end gap-6 text-sm">
          <span>Gastos: <strong>{gastos.length}</strong></span>
          <span>Total: <strong className="font-mono">{formatearCLP(totGastos)}</strong></span>
        </div>
      </section>
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-800">Resumen del mes</h2>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-medium text-slate-600">Por patente</h3>
            <Tabla>
              <thead>
                <tr><Th>Patente</Th><Th className="text-right">Cargas</Th><Th className="text-right">Litros</Th><Th className="text-right">Monto</Th></tr>
              </thead>
              <tbody>
                {filasPatente.map(([patente, t]) => (
                  <Tr key={patente}>
                    <Td className="font-mono">{patente}</Td>
                    <Td className="text-right">{t.cargas}</Td>
                    <Td className="text-right">{NUM(t.litros)}</Td>
                    <Td className="text-right font-mono">{formatearCLP(t.monto)}</Td>
                  </Tr>
                ))}
                {filasPatente.length === 0 && <Tr><Td colSpan={4} className="py-8 text-center text-slate-500">Sin cargas que resumir.</Td></Tr>}
              </tbody>
            </Tabla>
          </div>
          <div>
            <h3 className="mb-2 text-sm font-medium text-slate-600">Por estación</h3>
            <Tabla>
              <thead>
                <tr><Th>Estación</Th><Th className="text-right">Cargas</Th><Th className="text-right">Litros</Th><Th className="text-right">Monto</Th></tr>
              </thead>
              <tbody>
                {filasEstacion.map(([estacion, t]) => (
                  <Tr key={estacion}>
                    <Td>{estacion}</Td>
                    <Td className="text-right">{t.cargas}</Td>
                    <Td className="text-right">{NUM(t.litros)}</Td>
                    <Td className="text-right font-mono">{formatearCLP(t.monto)}</Td>
                  </Tr>
                ))}
                {filasEstacion.length === 0 && <Tr><Td colSpan={4} className="py-8 text-center text-slate-500">Sin cargas que resumir.</Td></Tr>}
              </tbody>
            </Tabla>
          </div>
        </div>
      </section>
    </div>
  )
}
```

- [ ] **Step 8: NAV — Combustible tras Proformas**

En `apps/erp/app/layout.tsx`, agrega la entrada al bloque module-gated. El `const nav` queda EXACTAMENTE así (solo cambia la línea de Combustible; el resto ya existe post-Plan 11):

```tsx
  const nav = [
    { href: '/', etiqueta: 'Inicio' },
    { href: '/productos', etiqueta: 'Productos' },
    { href: '/clientes', etiqueta: 'Clientes' },
    { href: '/importar', etiqueta: 'Importar' },
    { href: '/cotizaciones', etiqueta: 'Cotizaciones' },
    ...(activa?.modulo_transporte
      ? [
          { href: '/flota', etiqueta: 'Flota' },
          { href: '/tarifario', etiqueta: 'Tarifario' },
          { href: '/entregas', etiqueta: 'Entregas' },
          { href: '/proformas', etiqueta: 'Proformas' },
          { href: '/combustible', etiqueta: 'Combustible' },
        ]
      : []),
    { href: '/ventas', etiqueta: 'Ventas' },
    { href: '/inventario', etiqueta: 'Inventario' },
    { href: '/compras', etiqueta: 'Compras' },
    { href: '/cobranza', etiqueta: 'Cobranza' },
    { href: '/por-pagar', etiqueta: 'Por pagar' },
    { href: '/reportes', etiqueta: 'Reportes' },
    { href: '/configuracion', etiqueta: 'Configuración' },
  ]
```

- [ ] **Step 9: Verificar y commit**

Run: `pnpm --filter erp build` → compila sin errores y la ruta `/combustible` aparece en el listado de rutas del output.

```bash
git add apps/erp/app/combustible apps/erp/componentes/formulario-import-tct.tsx apps/erp/componentes/formulario-carga-manual.tsx apps/erp/componentes/formulario-gasto.tsx apps/erp/componentes/boton-eliminar-costo.tsx apps/erp/app/layout.tsx
git commit -m "feat(erp): combustible — import TCT, cargas, gastos y vistas derivadas"
```

---
### Task 7: ERP — Rentabilidad por vehículo (reporte + export)

**Files:**
- Create: `apps/erp/app/reportes/rentabilidad/page.tsx`, `apps/erp/app/reportes/rentabilidad/export/route.ts`
- Modify: `apps/erp/app/reportes/page.tsx` (5ª tarjeta condicional)

**Interfaces:**
- Consumes: vista `rentabilidad_vehiculo` (migración 0017, task previa — security_invoker; fila por `(empresa_id, vehiculo_id NULLABLE, mes)`; columnas `mes date` (primer día del mes), `ingresos`, `combustible`, `gastos`; `grant select` a authenticated); tabla `vehiculos` (Plan 11) para etiquetas — la vista NO declara FK hacia `vehiculos`, así que PostgREST no puede embeber: DOS queries y un `Map`; tipos `@suite/db` regenerados (task previa); `formatearCLP`, `formatearPatente`, `rangoDeMes`, `filasACsv` de `@suite/core`; `obtenerEmpresaActiva` con `modulo_transporte`; componentes `@suite/ui`.
- Espejos estructurales OBLIGATORIOS (léelos antes de escribir): `apps/erp/app/reportes/libro-compras/page.tsx` (página de reporte mensual con form de mes y export) y `apps/erp/app/reportes/libro-ventas/export/route.ts` (route handler CSV: 401 sin sesión y 400 mes inválido ANTES de cualquier query).
- Produces: página `/reportes/rentabilidad?mes=YYYY-MM` (margen $ y % calculados en la página — la vista solo suma), export `/reportes/rentabilidad/export?mes=YYYY-MM` (`rentabilidad-YYYY-MM.csv`), tarjeta "Rentabilidad por vehículo" en `/reportes` visible solo con `activa.modulo_transporte`.
- Guard de módulo: `notFound()` si `!activa.modulo_transporte` — UX, no seguridad (la vista es security_invoker y filtra por RLS igual).
- Nota de tipos: las sumas de la vista salen de `sum()` en bigint; el typegen las declara `number | null` pero PostgREST puede serializar bigint como string según versión → `Number()` defensivo en TODA lectura de `ingresos`/`combustible`/`gastos`.

- [ ] **Step 1: Página `/reportes/rentabilidad`**

`apps/erp/app/reportes/rentabilidad/page.tsx` (espejo de libro-compras: mes por searchParams validado con `rangoDeMes`, fallback al mes actual; se filtra `mes` con `gte/lte` del rango — robusto aunque la vista normalice al día 1; fila "Sin asignar" al final; margen negativo en rojo; fila de totales):

```tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP, formatearPatente, rangoDeMes } from '@suite/core'
import { Boton, Encabezado, Entrada, Tabla, Td, Th, Tr } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'

function pct(margen: number, ingresos: number): string {
  if (ingresos === 0) return '—'
  return ((margen / ingresos) * 100).toFixed(1).replace('.', ',') + '%'
}

export default async function PaginaRentabilidad({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const { mes = '' } = await searchParams
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  if (!activa.modulo_transporte) notFound()
  const mesActual = new Date().toISOString().slice(0, 7)
  const mesElegido = rangoDeMes(mes) ? mes : mesActual
  const rango = rangoDeMes(mesElegido)!
  const supabase = await crearClienteServidor()
  // La vista no tiene FK hacia vehiculos (PostgREST no puede embeber): dos queries y un Map.
  const [{ data: filasVista }, { data: vehiculos }] = await Promise.all([
    supabase
      .from('rentabilidad_vehiculo')
      .select('vehiculo_id, ingresos, combustible, gastos')
      .eq('empresa_id', activa.id)
      .gte('mes', rango.desde)
      .lte('mes', rango.hasta),
    supabase.from('vehiculos').select('id, patente, descripcion').eq('empresa_id', activa.id),
  ])
  const etiqueta = new Map(
    (vehiculos ?? []).map((v) => [v.id, formatearPatente(v.patente) + (v.descripcion ? ` — ${v.descripcion}` : '')])
  )
  // Las sumas vienen de sum() bigint: PostgREST puede serializarlas como string → Number() defensivo.
  const filas = (filasVista ?? [])
    .map((f) => {
      const ingresos = Number(f.ingresos ?? 0)
      const combustible = Number(f.combustible ?? 0)
      const gastos = Number(f.gastos ?? 0)
      return {
        vehiculo: f.vehiculo_id === null ? 'Sin asignar' : etiqueta.get(f.vehiculo_id) ?? '—',
        sinAsignar: f.vehiculo_id === null,
        ingresos,
        combustible,
        gastos,
        margen: ingresos - combustible - gastos,
      }
    })
    .sort((a, b) => Number(a.sinAsignar) - Number(b.sinAsignar) || a.vehiculo.localeCompare(b.vehiculo, 'es'))
  const tot = filas.reduce(
    (a, f) => ({ ingresos: a.ingresos + f.ingresos, combustible: a.combustible + f.combustible, gastos: a.gastos + f.gastos, margen: a.margen + f.margen }),
    { ingresos: 0, combustible: 0, gastos: 0, margen: 0 }
  )
  return (
    <div>
      <Encabezado titulo="Rentabilidad por vehículo">
        <Link href={`/reportes/rentabilidad/export?mes=${mesElegido}`}><Boton variante="secundario">Exportar CSV</Boton></Link>
      </Encabezado>
      <p className="mb-4 max-w-2xl text-sm text-slate-500">
        Ingresos = órdenes de entrega facturadas, por mes de fecha de ingreso; combustible y gastos por fecha
        de la transacción. La fila «Sin asignar» agrupa órdenes facturadas sin vehículo.
      </p>
      <form className="mb-4 flex items-end gap-3" action="/reportes/rentabilidad" method="get">
        <Entrada type="month" name="mes" defaultValue={mesElegido} className="max-w-xs" />
        <Boton variante="secundario" type="submit">Ver mes</Boton>
      </form>
      <Tabla>
        <thead><tr><Th>Vehículo</Th><Th className="text-right">Ingresos</Th><Th className="text-right">Combustible</Th><Th className="text-right">Gastos</Th><Th className="text-right">Margen</Th><Th className="text-right">Margen %</Th></tr></thead>
        <tbody>
          {filas.map((f) => (
            <Tr key={f.vehiculo}>
              <Td className={f.sinAsignar ? 'italic text-slate-500' : 'font-mono'}>{f.vehiculo}</Td>
              <Td className="text-right font-mono">{formatearCLP(f.ingresos)}</Td>
              <Td className="text-right font-mono">{formatearCLP(f.combustible)}</Td>
              <Td className="text-right font-mono">{formatearCLP(f.gastos)}</Td>
              <Td className={`text-right font-mono ${f.margen < 0 ? 'text-red-600' : ''}`}>{formatearCLP(f.margen)}</Td>
              <Td className={`text-right font-mono ${f.margen < 0 ? 'text-red-600' : ''}`}>{pct(f.margen, f.ingresos)}</Td>
            </Tr>
          ))}
          {filas.length > 0 && (
            <Tr>
              <Td className="font-semibold">Total</Td>
              <Td className="text-right font-mono font-semibold">{formatearCLP(tot.ingresos)}</Td>
              <Td className="text-right font-mono font-semibold">{formatearCLP(tot.combustible)}</Td>
              <Td className="text-right font-mono font-semibold">{formatearCLP(tot.gastos)}</Td>
              <Td className={`text-right font-mono font-semibold ${tot.margen < 0 ? 'text-red-600' : ''}`}>{formatearCLP(tot.margen)}</Td>
              <Td className={`text-right font-mono font-semibold ${tot.margen < 0 ? 'text-red-600' : ''}`}>{pct(tot.margen, tot.ingresos)}</Td>
            </Tr>
          )}
          {filas.length === 0 && <Tr><Td colSpan={6} className="py-8 text-center text-slate-500">Sin movimientos en {mesElegido}.</Td></Tr>}
        </tbody>
      </Tabla>
    </div>
  )
}
```

- [ ] **Step 2: Export CSV `/reportes/rentabilidad/export`**

`apps/erp/app/reportes/rentabilidad/export/route.ts` — espejo EXACTO de `libro-ventas/export/route.ts`: dinámico por `cookies()` (vía `obtenerEmpresaActiva`), 401 sin empresa activa y 400 de mes inválido ANTES de tocar la BD; `filasACsv` ya antepone el BOM (escape `\uFEFF` en core) y protege contra inyección de fórmulas. El Margen % va como número con un decimal (celda vacía si ingresos 0):

```ts
import { crearClienteServidor } from '@suite/auth/server'
import { filasACsv, formatearPatente, rangoDeMes } from '@suite/core'
import { obtenerEmpresaActiva } from '../../../../lib/empresa-activa'

export async function GET(req: Request) {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return new Response('No autorizado', { status: 401 })
  const mes = new URL(req.url).searchParams.get('mes') ?? new Date().toISOString().slice(0, 7)
  const rango = rangoDeMes(mes)
  if (!rango) return new Response('Mes inválido (use YYYY-MM)', { status: 400 })
  const supabase = await crearClienteServidor()
  const [{ data, error }, { data: vehiculos, error: errorVehiculos }] = await Promise.all([
    supabase
      .from('rentabilidad_vehiculo')
      .select('vehiculo_id, ingresos, combustible, gastos')
      .eq('empresa_id', activa.id)
      .gte('mes', rango.desde)
      .lte('mes', rango.hasta),
    supabase.from('vehiculos').select('id, patente, descripcion').eq('empresa_id', activa.id),
  ])
  if (error || errorVehiculos) return new Response('No se pudo generar el reporte', { status: 500 })
  const etiqueta = new Map(
    (vehiculos ?? []).map((v) => [v.id, formatearPatente(v.patente) + (v.descripcion ? ` — ${v.descripcion}` : '')])
  )
  const filas = (data ?? [])
    .map((f) => {
      const ingresos = Number(f.ingresos ?? 0)
      const combustible = Number(f.combustible ?? 0)
      const gastos = Number(f.gastos ?? 0)
      return {
        vehiculo: f.vehiculo_id === null ? 'Sin asignar' : etiqueta.get(f.vehiculo_id) ?? '—',
        sinAsignar: f.vehiculo_id === null,
        ingresos,
        combustible,
        gastos,
        margen: ingresos - combustible - gastos,
      }
    })
    .sort((a, b) => Number(a.sinAsignar) - Number(b.sinAsignar) || a.vehiculo.localeCompare(b.vehiculo, 'es'))
  const csv = filasACsv(
    ['Vehículo', 'Ingresos', 'Combustible', 'Gastos', 'Margen', 'Margen %'],
    filas.map((f) => [
      f.vehiculo,
      f.ingresos,
      f.combustible,
      f.gastos,
      f.margen,
      f.ingresos === 0 ? null : Math.round((f.margen / f.ingresos) * 1000) / 10,
    ])
  )
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="rentabilidad-${mes}.csv"`,
    },
  })
}
```

- [ ] **Step 3: 5ª tarjeta en `/reportes` (condicional al módulo)**

`apps/erp/app/reportes/page.tsx` hoy define un array constante `SECCIONES` de 4 tarjetas y lo mapea a `<Link><Tarjeta>` dentro de `IndiceReportes` (que ya resuelve `activa`). El diff exacto — la constante NO cambia; se deriva `secciones` según el módulo y el `.map` pasa a usarla:

```diff
 export default async function IndiceReportes() {
   const { activa } = await obtenerEmpresaActiva()
   if (!activa) return <Encabezado titulo="Sin empresa activa" />
+  const secciones = activa.modulo_transporte
+    ? [...SECCIONES, { href: '/reportes/rentabilidad', titulo: 'Rentabilidad por vehículo', desc: 'Ingresos, combustible y gastos por camión, con export CSV' }]
+    : SECCIONES
   return (
     <div>
       <Encabezado titulo="Reportes" />
       <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
-        {SECCIONES.map((s) => (
+        {secciones.map((s) => (
           <Link key={s.href} href={s.href}>
```

El resto del archivo (imports, `SECCIONES`, el cuerpo de la `Tarjeta`) queda intacto. Con módulo apagado la tarjeta no existe y la ruta directa cae en el `notFound()` de la página.

- [ ] **Step 4: Verificar y commit**

Run: `pnpm --filter erp build` → compila sin errores y el listado de rutas incluye `/reportes/rentabilidad` y `/reportes/rentabilidad/export` (ambas dinámicas — `ƒ` — por el uso de cookies).

```bash
git add apps/erp/app/reportes/rentabilidad apps/erp/app/reportes/page.tsx
git commit -m "feat(erp): reporte de rentabilidad por vehículo con export CSV"
```

---
### Task 8: Pipeline + verificación integral (E2E)

**Files:** ninguno de producción (script y fixtures en scratchpad, se borran al cerrar).

- [ ] **Step 1: Pipeline**

Run: `pnpm --filter @suite/db gen` — commitear solo si diff (`chore(db): tipos regenerados`).
Run: `pnpm test` — **138 tests** (core 126 incl. tct, auth 2, dte 10).
Run: `pnpm supabase test db` — **211 asserts** (los archivos existentes suman 193 + combustible `plan(18)`), todos verdes.
Run: `pnpm build --concurrency=1` — 3 apps. OJO: el build pisa el `.next` de los dev servers → reiniciar `pnpm --filter erp dev` ANTES del click-through del Step 3.

- [ ] **Step 2: E2E de capa de datos (script Node en scratchpad)**

**Partición explícita de la verificación** — a diferencia del Plan 11, la pieza central NO es una RPC: `importarCargasTct` es una Server Action y un script Node no puede invocarla (Next la expone solo como POST interno con action id cifrado). La verificación se parte en 3 capas sin hueco:

- **(a) Parsers y detección de archivo equivocado/mojibake** → ya cubiertos por los unit tests de Task 4 (verdes en Step 1): header real → índices, agregado → null, mojibake → null, montos/litros/fechas con los valores reales.
- **(b) Capa de datos** (índice de dedup, FKs compuestas, cruce de conductor, RLS por rol, vista y sus grants) → ESTE script: ejercita como `dueno` vía supabase-js exactamente los inserts/selects/deletes que la action y las páginas ejecutan.
- **(c) Flujo completo file→resultado** (leerCSV + guard de Excel + conteos + render) → click-through manual documentado con checklist (Step 3).

Patrón de siempre (createRequire sobre `packages/auth/package.json`; usuario real vía `admin.auth.admin.createUser` + `registrar_organizacion` como authenticated; RUT org `999999999` — NO fixtures ni demo `771234569`; cliente, destino, flota y activación del módulo como authenticated; service_role SOLO para el alta del miembro vendedor y el cleanup). Para que el resultado no dependa del día de ejecución: `const mes = new Date().toISOString().slice(0, 7) + '-01'` y TODAS las fechas de ODEs/cargas/gastos usan ese primer día del mes (la carga "de otro mes" usa el primer día del mes siguiente, calculado con `Date.UTC`).

1. Org 1 (RUT `999999999`) + activación como dueño: `update empresas set modulo_transporte = true, factor_volumetrico = 250` → re-leer y assert. Cliente activo RUT `765000017` (módulo-11 válido, sin colisión — mismo RUT ya verificado a mano en el plan del Plan 11 y limpiado por su E2E). Destino `Antofagasta` (`tarifa_kg` 120). Vehículo patente `BBCL23` (capacidad 12000). Conductor RUT `10075262K` (= `limpiarRut('10075262-K')`, el RUT REAL de los reportes del usuario; DV verificado a mano: dígitos de derecha a izquierda 2,6,2,5,7,0,0,1 × pesos 2,3,4,5,6,7,2,3 = 4+18+8+25+42+0+0+3 = 100 → `11 - (100 mod 11)` = 10 → `K`), nombre `Pedro Soto`.
2. Ingresos vía RPCs del Plan 11 (`fecha_ingreso` = mes): ODE 1 bultos 5, kilos 500, m3 null, neto **850000** → `asignar_despacho(empresa1, ODE1, vehiculo, conductor)`; ODE 2 bultos 2, kilos 100, m3 null, neto **90000**, SIN vehículo. `crear_proforma(cliente, [ODE1, ODE2])` → `cambiar_estado_proforma` a `enviada` → `aprobada` → `facturar_proforma`. Asserts: ambas ODEs `facturada`; ODE1 `vehiculo_id` = vehículo; ODE2 `vehiculo_id` null. (Que una ODE `registrada` NO sume a ingresos lo cubre pgTAP; aquí ambas se facturan a propósito.)
3. Cargas (insert directo como dueño, replicando el mapeo por fila de la action):
   - **A** `origen='tct'`: fecha mes, hora `'08:15:23'`, litros 349.13, precio_litro 1123, monto **392076** (la fila REAL del usuario: monto ≠ 349,13 × 1123 = 392.073 — nada valida ese cruce, deliberado), estacion `'COPEC PANAMERICANA NORTE'`, comuna `'ANTOFAGASTA'`, guia `'119725'`, tarjeta `'7800012345670001'`, odometro 1, producto `'PETROLEO DIESEL'`; cruce de chofer: `'10075262-K'` → `limpiarRut` → match en `conductores` de la empresa → `conductor_id` = conductor y `rut_chofer` null.
   - **B** `origen='tct'`: guia `'119726'`, litros 138.33, monto **155329**; RUT `'12.345.678-5'` sin match → `conductor_id` null y `rut_chofer` `'123456785'` (minimización Ley 21.719: el RUT SOLO se persiste al no haber match).
   - **C** `origen='manual'`: sin guía, sin hora, litros 45.5, monto **52595**.
   - **D** `origen='manual'`: sin guía, fecha del MES SIGUIENTE, litros 10, monto 10000.
   Asserts al re-leer: A con `conductor_id` = conductor, `rut_chofer` null y `hora === '08:15:23'` (primer `time` del schema: PostgREST lo sirve como string `HH:MM:SS`); B con `conductor_id` null y `rut_chofer` `'123456785'`; C y D conviven ambas sin guía (el índice único parcial no bloquea nulls — el dedup de manuales queda fuera de v1, deliberado).
4. Dedup capa BD: insert de otra carga con guia `'119725'` en org 1 → `error.code === '23505'` (índice único parcial `(empresa_id, guia)`); pre-check por chunks tal cual la action: `select guia` con `.in('guia', ['119725', '119726', '999999'])` **`.eq('empresa_id', empresa1)`** → exactamente 2 filas ('119725' y '119726').
5. Gastos (insert directo dueño, fecha mes): `peaje` **30000** + `mantencion` **45000**. (Checks de categoría inválida y monto 0: pgTAP.)
6. Vista `rentabilidad_vehiculo` (select como dueño `.eq('empresa_id', empresa1).eq('mes', mes)`): fila del vehículo → ingresos **850000**, combustible **600000** (cuadrado A MANO: 392076 + 155329 + 52595), gastos **75000**; fila con `vehiculo_id` null ("Sin asignar") → ingresos **90000** y combustible/gastos en 0 (aceptar null → coalesce en el assert); la carga D (mes siguiente) NO altera este mes; la vista NO trae margen (lo calcula la página). El select mismo re-prueba el `grant select` de la vista (la lección 42501 del Plan 7; el pgTAP positivo es el candado, esto el cinturón).
7. Vendedor: usuario 2 vía `admin.auth.admin.createUser` + insert service_role en `miembros` (organización de org 1, rol `'vendedor'`, estado `'activo'`) + `signInWithPassword`. Asserts: insert de carga → `error.code === '42501'` (policy de insert dueno/admin); delete de la carga A con `.delete().eq('id', A).eq('empresa_id', empresa1).select('id')` → **SIN error y 0 filas** (la policy de delete filtra en silencio — el éxito falso exacto que la action de eliminar detecta con el `.select`); el dueño re-lee A → sigue viva.
8. Aislamiento org 2 (RUT `888888888`, mismo patrón de registro; SIN activar el módulo — el gating del módulo vive en action/UI, no en policies: deliberado): vehículo propio `CCDD11`; insert de carga con guia `'119725'` (LA MISMA de org 1) → **OK**: la guía es única POR EMPRESA. org 2 ve exactamente 1 carga (la suya) y 0 gastos; su `rentabilidad_vehiculo` no trae filas de org 1; delete cross-tenant de la carga A de org 1 → 0 filas y A sigue viva.
9. Export: el 401/400 pre-query y el BOM exigen la sesión de cookies SSR que un script Node no forja — se verifican en el click-through (Step 3, ítems 12-13). El BOM que emite `filasACsv` ya está cubierto por `csv.test.ts`.
10. Cleanup FK-safe (service_role), cada delete seguido de `select count(*)` = **0** para las filas de ambas orgs: `cargas_combustible` → `gastos_vehiculo` → `documentos_venta_lineas` → `ordenes_entrega` → `proformas` → `documentos_venta` → `vehiculos` → `conductores` → `destinos` → `clientes` → `suscripciones` → `miembros` → `empresas` → `organizaciones` → `auth.users` (los 3 usuarios) + borrar el script.

Si alguna aserción falla: defecto real → BLOCKED con detalle.

- [ ] **Step 3: Click-through del flujo completo de upload (file→resultado)**

Generar los fixtures en el scratchpad con `node crear-fixtures-tct.mjs` (BOM SIEMPRE por secuencia de escape, jamás el carácter literal):

```js
// crear-fixtures-tct.mjs — CSVs de prueba del click-through (formato TCT real:
// UTF-8 con BOM, separador coma, todos los campos entre comillas, CRLF).
import { writeFileSync } from 'node:fs'

const HEADER = [
  'N° Cuenta', 'Razón Social', 'Centro de Costo', 'Tipo de Tarjeta', 'Tarjeta',
  'N° Transacción', 'Fecha Transacción', 'Hora Transacción', 'Patente',
  'Rut Chofer', 'Nombre Chofer', 'Estación de Servicio', 'Comuna', 'Producto',
  'Precio', 'Volumen', 'Monto', 'Odómetro (Kms.)', 'Kms. Recorridos',
  'Rendimiento (Kms/Lts.)', 'Guía de Despacho',
]

// [tx, fecha, hora, patente, rut, nombre, estacion, comuna, volumen, monto, guia]
const filas = [
  ['84512201', '01-07-2026', '08:15:23', 'BBKF-71     ', '10075262-K', 'PEDRO SOTO', 'COPEC PANAMERICANA NORTE', 'ANTOFAGASTA', '349,13', '392076,000', '119725'],
  ['84512202', '02-07-2026', '13:42:10', 'BBKF-71     ', '10075262-K', 'PEDRO SOTO', 'COPEC PANAMERICANA NORTE', 'ANTOFAGASTA', '138,33', '155329,000', '119726'],
  ['84512203', '03-07-2026', '07:05:44', 'BBCL-23', '12.345.678-5', 'JUAN PEREZ', 'COPEC LA NEGRA', 'ANTOFAGASTA', '210,50', '236392,000', '119727'],
  ['84512204', '05-07-2026', '18:22:01', 'BBCL-23', '12.345.678-5', 'JUAN PEREZ', 'COPEC LA NEGRA', 'ANTOFAGASTA', '95,00', '106685,000', '119728'],
  ['84512205', '08-07-2026', '09:57:36', 'BBKF-71     ', '10075262-K', 'PEDRO SOTO', 'COPEC PANAMERICANA NORTE', 'ANTOFAGASTA', '300,00', '336900,000', '119729'],
  ['84512206', '09-07-2026', '11:11:11', 'JDVJ-88', '12.345.678-5', 'JUAN PEREZ', 'COPEC LA NEGRA', 'ANTOFAGASTA', '120,00', '134760,000', '119730'],
  ['84512207', '10-07-2026', '16:40:02', 'XD-2682', '12.345.678-5', 'JUAN PEREZ', 'COPEC LA NEGRA', 'ANTOFAGASTA', '80,00', '89840,000', '119731'],
  // Copia de la fila 1: guía 119725 repetida DENTRO del archivo → duplicada.
  ['84512208', '01-07-2026', '08:15:23', 'BBKF-71     ', '10075262-K', 'PEDRO SOTO', 'COPEC PANAMERICANA NORTE', 'ANTOFAGASTA', '349,13', '392076,000', '119725'],
]

const fila21 = (f) => [
  '90210', 'TRANSPORTES DEMO LTDA.', 'FLOTA NORTE', 'TCT EMPRESAS', '7800012345670001',
  f[0], f[1], f[2], f[3], f[4], f[5], f[6], f[7], 'PETROLEO DIESEL',
  '1123,000', f[8], f[9], '1', '0', '0,00', f[10],
]
const aCsv = (matriz) => matriz.map((f) => f.map((c) => `"${c}"`).join(',')).join('\r\n') + '\r\n'

writeFileSync('fixture-tct.csv', '\uFEFF' + aCsv([HEADER, ...filas.map(fila21)]), 'utf8')

const HEADER_AGREGADO = ['Patente', 'N° Tarjetas', 'N° Transacciones', 'Cantidad (Unidad)', 'Monto ($)', 'Rendimiento Promedio']
const filaAgregado = ['BBKF-71     ', '1', '5', '1341,96 (Lts.)', '1.365.371', '2,15']
writeFileSync('fixture-agregado.csv', '\uFEFF' + aCsv([HEADER_AGREGADO, filaAgregado]), 'utf8')

console.log('fixtures listos')
```

Variante re-codificada (PowerShell — las tildes del header quedan como bytes 1252, inválidos en UTF-8):

```powershell
$texto = [System.IO.File]::ReadAllText("fixture-tct.csv")
[System.IO.File]::WriteAllText("fixture-tct-latin1.csv", $texto, [System.Text.Encoding]::GetEncoding(1252))
```

> **Nota de aritmética (corrige el "7 filas" del spec §8):** el fixture tiene **8 filas físicas** — 7 distintas (5 con patentes registradas + 2 sin registrar) + 1 copia con guía repetida; los conteos esperados del propio spec (5+1+2 y 0+6+2) suman 8 y se conservan tal cual. En la segunda pasada las 5 insertadas chocan contra BD y la copia in-file TAMBIÉN (su guía ya está en BD) → 5+1 = **6 duplicadas**; las 2 filas con error se re-reportan como ERROR, no como duplicadas.

Checklist (browser contra el dev server; documentar el resultado de CADA ítem en el reporte):

1. Dev server reiniciado tras el build (`pnpm --filter erp dev`, puerto 3001); login `demo@suite-erp.cl` / `demo1234` (resembrar si la demo está vencida — es perecible).
2. Configuración → módulos: transporte ACTIVO, factor 250.
3. Flota: vehículos `BBKF71` y `BBCL23` activos; conductor RUT `10075262-K` `Pedro Soto`.
4. `/combustible` → subir `fixture-tct.csv` → **5 importadas, 1 duplicada, 2 errores**; los errores nombran `JDVJ88` y `XD2682` (`no está registrado en Flota`).
5. Re-subir el MISMO archivo → **0 importadas, 6 duplicadas, 2 errores** (ver nota de aritmética).
6. Lista de cargas de julio 2026: 5 filas con hora `HH:MM:SS`; totales **1.092,96 L** y **$1.227.382**.
7. Carga manual (el select ofrece SOLO vehículos activos) → aparece en la lista con hora `—`.
8. Gasto manual (peaje, 30000) → aparece en la lista de gastos.
9. Vistas derivadas del mes: por patente (`BBKF71`: 787,46 L / $884.305; `BBCL23`: 305,50 L / $343.077) y por estación (`COPEC PANAMERICANA NORTE` / `COPEC LA NEGRA`).
10. Subir `fixture-agregado.csv` → `El archivo no parece el reporte TCT de Consumos Diarios`.
11. Subir `fixture-tct-latin1.csv` → mensaje de Excel (re-guardado/codificación alterada), **0 insertadas** (el `codificacionRecuperada` de `leerCSV`, capturado ANTES del fallback CP-1252, es lo que hace el guard alcanzable pese a que `lectura.texto` ya llega recuperado).
12. Sin sesión (ventana incógnito): `GET http://localhost:3001/reportes/rentabilidad/export?mes=2026-07` → **401**; con sesión y `?mes=2026-13` → **400**.
13. Reportes → tarjeta "Rentabilidad por vehículo" (visible solo con módulo on) → `/reportes/rentabilidad?mes=2026-07`: fila por vehículo con margen $ y % (rojo si negativo) y fila "Sin asignar" si hay ODEs facturadas sin vehículo; Export CSV → descargar y verificar BOM: `[System.IO.File]::ReadAllBytes("rentabilidad.csv")[0..2]` → `239 187 191`; tildes correctas al abrirlo en Excel.
14. Eliminar una carga desde la lista (confirm) → desaparece y los totales se actualizan.
15. Configuración → módulo transporte OFF → el NAV `Combustible` desaparece, `/combustible` da 404 y la tarjeta de rentabilidad desaparece de Reportes. Re-activar al terminar (y resembrar la demo antes de mostrarla: quedó con datos de prueba).

- [ ] **Step 4: Reporte**

`.superpowers/sdd/task-8-plan12-report.md` con el resultado del pipeline, las aserciones del script E2E y el checklist ítem por ítem; borrar del scratchpad el script y los 3 fixtures al cerrar.

---

## Verificación final del plan

- `pnpm test` (**138**) + `pnpm supabase test db` (**211**) + `pnpm build` (3 apps) verdes.
- Ciclo completo: el Consumos Diarios REAL entra tal cual sale de Copec (BOM, comas decimales, patentes con guion y padding) → re-importar jamás duplica (dentro del archivo Y contra BD, por empresa) y ninguna fila buena se pierde por culpa de una mala (retry fila a fila del lote caído) → archivo agregado y re-guardado de Excel rechazados con su mensaje específico → choferes cruzados contra la flota y RUT de terceros minimizados (solo persisten sin match) → cargas manuales y gastos por vehículo, con eliminar verificado por filas afectadas y vedado a vendedores → lo que Copec daba en 3 reportes agregados ahora vive derivado y filtrable → y `/reportes/rentabilidad` entrega ingresos − combustible − gastos = margen por camión y mes, con la fila "Sin asignar" delatando ODEs facturadas sin vehículo y export CSV con BOM, todo aislado por empresa.
- Criterio de éxito del spec §10 cumplido.
