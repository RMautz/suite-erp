-- Remuneraciones (Plan 18), capa 1 (Task 1): trabajadores y contratos (maestros
-- por empresa con RLS POR ROL: dueno/admin escriben, contador lee, vendedor y
-- bodeguero ven 0 filas — datos sensibles, spec §2.1), indicadores_previsionales
-- (tabla de PLATAFORMA sin empresa_id: lectura authenticated, escritura SOLO
-- service_role desde el panel admin) y liquidaciones (INMUTABLE emitida:
-- snapshot completo de calculo y contexto; CERO escritura directa — solo las
-- RPCs de Task 2 la mueven). Task 2 anexa emitir/pagar/anular_liquidacion, el
-- origen 'remuneracion', las 3 anclas contables y los re-creates tras la marca
-- del final.

-- ---------- trabajadores (maestro por empresa; sensible: RLS por rol) ----------
-- Sin DELETE: desactivar (activo = false). rut normalizado y con DV correcto
-- tambien en la BD (ultima linea de defensa, patron clientes 0003).
create table public.trabajadores (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  rut text not null check (rut = app.normalizar_rut(rut) and app.validar_rut(rut)),
  nombre text not null,
  email text,
  telefono text,
  direccion text,
  fecha_nacimiento date,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  unique (empresa_id, rut),
  unique (empresa_id, id)
);

-- ---------- contratos (historia laboral; a lo mas UNO vigente por trabajador) ----------
-- Cambiar condiciones = cerrar (vigente = false) + crear uno nuevo (dos writes
-- en la Server Action; no-atomico aceptado por el spec §4: el peor caso queda
-- sin contrato vigente, visible y reparable).
create table public.contratos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  trabajador_id uuid not null,
  tipo text not null check (tipo in ('indefinido', 'plazo_fijo')),
  fecha_inicio date not null,
  fecha_termino date,
  cargo text not null,
  sueldo_base integer not null check (sueldo_base > 0),
  gratificacion_legal boolean not null default true,
  afp text not null check (afp in ('capital', 'cuprum', 'habitat', 'modelo', 'planvital', 'provida', 'uno')),
  salud text not null check (salud in ('fonasa', 'isapre')),
  plan_isapre_uf numeric(6, 2),
  vigente boolean not null default true,
  creado_en timestamptz not null default now(),
  -- Plazo fijo exige fecha de termino; isapre exige el plan pactado en UF.
  check (tipo <> 'plazo_fijo' or fecha_termino is not null),
  check (salud <> 'isapre' or plan_isapre_uf is not null),
  unique (empresa_id, id),
  foreign key (empresa_id, trabajador_id) references public.trabajadores (empresa_id, id)
);
-- Un contrato vigente por trabajador (unique parcial).
create unique index contratos_vigente_idx
  on public.contratos (empresa_id, trabajador_id) where vigente;

-- ---------- indicadores_previsionales (tabla de PLATAFORMA; sin empresa_id) ----------
-- Un registro por periodo 'YYYY-MM'. Lectura para todo authenticated (datos
-- publicos); escritura SOLO service_role (panel admin 3002): cero grants ni
-- policies de escritura a authenticated.
create table public.indicadores_previsionales (
  periodo text primary key check (periodo ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  uf integer not null check (uf > 0),
  utm integer not null check (utm > 0),
  ingreso_minimo integer not null check (ingreso_minimo > 0),
  tope_imponible_uf numeric(5, 1) not null check (tope_imponible_uf > 0),
  tope_cesantia_uf numeric(5, 1) not null check (tope_cesantia_uf > 0),
  tasas_afp jsonb not null,
  tramos_impuesto jsonb not null,
  actualizado_en timestamptz not null default now()
);

-- ---------- liquidaciones (INMUTABLE emitida; snapshot completo) ----------
-- Estados: 'borrador' RESERVADO (v1 no lo usa: emitir inserta directo en
-- 'emitida'); emitida -> pagada; emitida o pagada -> anulada (con motivo). El
-- snapshot de calculo + contexto hace que la liquidacion se explique sola
-- aunque cambien el contrato o los indicadores. CERO escritura directa: solo
-- emitir/pagar/anular_liquidacion (Task 2).
create table public.liquidaciones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  trabajador_id uuid not null,
  contrato_id uuid not null,
  periodo text not null check (periodo ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  estado text not null default 'borrador' check (estado in ('borrador', 'emitida', 'pagada', 'anulada')),
  -- Inputs del cliente (lo UNICO que la RPC no recalcula).
  dias_trabajados integer not null default 30 check (dias_trabajados between 1 and 30),
  extras_imponibles integer not null default 0 check (extras_imponibles >= 0),
  no_imponibles integer not null default 0 check (no_imponibles >= 0),
  -- Snapshot del calculo (CLP enteros; reglas 1-8 del spec §3).
  sueldo_proporcional integer not null,
  gratificacion integer not null,
  total_imponible integer not null,
  afp_monto integer not null,
  salud_monto integer not null,
  cesantia_monto integer not null,
  impuesto_unico integer not null,
  total_descuentos integer not null,
  liquido integer not null,
  -- Snapshot de contexto (auditabilidad).
  sueldo_base integer not null,
  afp text not null,
  tasa_afp numeric(5, 2) not null,
  salud text not null,
  plan_isapre_uf numeric(6, 2),
  uf integer not null,
  utm integer not null,
  emitida_en timestamptz,
  pagada_en timestamptz,
  anulada_en timestamptz,
  motivo_anulacion text,
  creado_en timestamptz not null default now(),
  unique (empresa_id, id),
  foreign key (empresa_id, trabajador_id) references public.trabajadores (empresa_id, id),
  foreign key (empresa_id, contrato_id) references public.contratos (empresa_id, id)
);
-- Una liquidacion NO-anulada por (empresa, trabajador, periodo): anular libera
-- el periodo y se puede volver a emitir.
create unique index liquidaciones_periodo_idx
  on public.liquidaciones (empresa_id, trabajador_id, periodo) where estado <> 'anulada';

-- ---------- RLS ----------
alter table public.trabajadores enable row level security;
alter table public.contratos enable row level security;
alter table public.indicadores_previsionales enable row level security;
alter table public.liquidaciones enable row level security;

-- trabajadores/contratos: SELECT dueno/admin/contador; INSERT/UPDATE dueno/admin.
create policy "contables ven trabajadores" on public.trabajadores
  for select to authenticated
  using (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin', 'contador']));
create policy "duenos crean trabajadores" on public.trabajadores
  for insert to authenticated
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']));
create policy "duenos editan trabajadores" on public.trabajadores
  for update to authenticated
  using (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']))
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']));

create policy "contables ven contratos" on public.contratos
  for select to authenticated
  using (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin', 'contador']));
create policy "duenos crean contratos" on public.contratos
  for insert to authenticated
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']));
create policy "duenos editan contratos" on public.contratos
  for update to authenticated
  using (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']))
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']));

-- indicadores: datos publicos de plataforma (lectura para todo authenticated).
create policy "autenticados ven indicadores" on public.indicadores_previsionales
  for select to authenticated
  using (true);

-- liquidaciones: SELECT por rol; CERO escritura directa (ni policy ni grant).
create policy "contables ven liquidaciones" on public.liquidaciones
  for select to authenticated
  using (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin', 'contador']));

-- ---------- Grants Data API (leccion Plan 1: sin esto todo da 42501) ----------
grant select, insert, update on public.trabajadores, public.contratos to authenticated;
grant select on public.indicadores_previsionales, public.liquidaciones to authenticated;
grant select, insert, update, delete on public.trabajadores, public.contratos,
  public.indicadores_previsionales, public.liquidaciones to service_role;

-- ---------- Seed de indicadores (2026-06 canonico; el admin los mantiene) ----------
-- UF y UTM varian por mes (valores representativos, spec §2.3: el admin de
-- plataforma los corrige desde su panel; la fuente oficial queda pendiente en
-- docs/credenciales-pendientes.md #14). 2026-06 es el periodo CANONICO de los
-- goldens del plan: sus valores NO se tocan sin recalcular los goldens.
-- IMM/topes/tasas/tramos compartidos por los 3 meses. Tasas AFP en % total con
-- comision; tramos del impuesto unico de segunda categoria (mensual): factor
-- sobre la base en CLP, rebaja en UTM, intervalos semiabiertos (desde, hasta].
insert into public.indicadores_previsionales
  (periodo, uf, utm, ingreso_minimo, tope_imponible_uf, tope_cesantia_uf, tasas_afp, tramos_impuesto)
select p.periodo, p.uf, p.utm, 529000, 87.8, 131.9,
  '{"capital": 11.44, "cuprum": 11.44, "habitat": 11.27, "modelo": 10.58, "planvital": 11.10, "provida": 11.45, "uno": 10.49}'::jsonb,
  '[
    {"desde_utm": 0,    "hasta_utm": 13.5, "factor": 0,     "rebaja_utm": 0},
    {"desde_utm": 13.5, "hasta_utm": 30,   "factor": 0.04,  "rebaja_utm": 0.54},
    {"desde_utm": 30,   "hasta_utm": 50,   "factor": 0.08,  "rebaja_utm": 1.74},
    {"desde_utm": 50,   "hasta_utm": 70,   "factor": 0.135, "rebaja_utm": 4.49},
    {"desde_utm": 70,   "hasta_utm": 90,   "factor": 0.23,  "rebaja_utm": 11.14},
    {"desde_utm": 90,   "hasta_utm": 120,  "factor": 0.304, "rebaja_utm": 17.8},
    {"desde_utm": 120,  "hasta_utm": 310,  "factor": 0.35,  "rebaja_utm": 23.32},
    {"desde_utm": 310,  "hasta_utm": null, "factor": 0.4,   "rebaja_utm": 38.82}
  ]'::jsonb
from (values ('2026-05', 39050, 69200), ('2026-06', 39200, 69500), ('2026-07', 39350, 69800)) as p (periodo, uf, utm);

-- ===== RPCs de remuneraciones e integracion contable (Task 2) =====
