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

-- ================== Remuneraciones: RPCs e integracion contable (Task 2) ==================
-- security definer + set search_path = public. emitir/pagar/anular NO crean
-- asientos (el asiento va por contabilizar_documento via hook nunca-lanza de la
-- Server Action) => NO toman el advisory lock del correlativo; la carrera de
-- doble emision la cierra el unique parcial liquidaciones_periodo_idx
-- (backstop 23505 -> mensaje contractual).

-- ---------- asientos.origen: se suma 'remuneracion' ----------
-- drop + re-add (un CHECK no admite ALTER en su lugar; patron 0018/0022/0024).
-- Lista vigente = la de 0024 (con 'cierre') + 'remuneracion'.
alter table public.asientos drop constraint asientos_origen_check;
alter table public.asientos add constraint asientos_origen_check
  check (origen in
    ('manual', 'venta', 'nota_credito', 'compra', 'pago', 'pago_proveedor', 'anticipo', 'reversa', 'cierre', 'remuneracion'));

-- ---------- Backfill: las 3 anclas de remuneraciones en empresas ya activas ----------
-- Dos pasos por ancla (retenciones solo inserta: su fila no existia en 0022):
-- (a) RECLAMO de la fila pristina del seed (mismo codigo+nombre+tipo, hoja,
--     activa, sin clave): la fila historica pasa a ser el ancla y los asientos
--     manuales que ya apuntaban a ella ruedan solos; si el usuario la edito,
--     renombro o desactivo, NO se toca (fail-closed).
-- (b) Resto: insert codigo-libre por empresa (patron 0024: el menor codigo
--     libre del grupo; JAMAS on conflict do nothing -- dejaria empresas sin
--     ancla y contabilizar reventaria). El ORDEN importa: el segundo insert
--     del grupo 2 ve el codigo que tomo el primero.

-- (a) remuneraciones_por_pagar: reclamo de '2.1.04 Remuneraciones por pagar'.
update public.cuentas_contables c
set clave_sistema = 'remuneraciones_por_pagar'
where c.codigo = '2.1.04' and c.nombre = 'Remuneraciones por pagar' and c.tipo = 'pasivo'
  and c.acepta_movimientos and c.activa and c.clave_sistema is null
  and exists (select 1 from public.cuentas_contables x
              where x.empresa_id = c.empresa_id and x.clave_sistema is not null)
  and not exists (select 1 from public.cuentas_contables x
                  where x.empresa_id = c.empresa_id and x.clave_sistema = 'remuneraciones_por_pagar');
-- (b) remuneraciones_por_pagar: codigo libre para las empresas restantes.
insert into public.cuentas_contables (empresa_id, codigo, nombre, tipo, acepta_movimientos, clave_sistema)
select e.id,
       (select '2.1.0' || n from generate_series(6, 99) as n
        where not exists (select 1 from public.cuentas_contables c2
                          where c2.empresa_id = e.id and c2.codigo = '2.1.0' || n)
        order by n limit 1),
       'Remuneraciones por pagar', 'pasivo', true, 'remuneraciones_por_pagar'
from public.empresas e
where exists (select 1 from public.cuentas_contables c
              where c.empresa_id = e.id and c.clave_sistema is not null)
  and not exists (select 1 from public.cuentas_contables c
                  where c.empresa_id = e.id and c.clave_sistema = 'remuneraciones_por_pagar');

-- retenciones_por_pagar: solo insert (no hay fila 0022 que reclamar).
insert into public.cuentas_contables (empresa_id, codigo, nombre, tipo, acepta_movimientos, clave_sistema)
select e.id,
       (select '2.1.0' || n from generate_series(6, 99) as n
        where not exists (select 1 from public.cuentas_contables c2
                          where c2.empresa_id = e.id and c2.codigo = '2.1.0' || n)
        order by n limit 1),
       'Retenciones previsionales por pagar', 'pasivo', true, 'retenciones_por_pagar'
from public.empresas e
where exists (select 1 from public.cuentas_contables c
              where c.empresa_id = e.id and c.clave_sistema is not null)
  and not exists (select 1 from public.cuentas_contables c
                  where c.empresa_id = e.id and c.clave_sistema = 'retenciones_por_pagar');

-- (a) gasto_remuneraciones: reclamo de '5.1.02 Remuneraciones'.
update public.cuentas_contables c
set clave_sistema = 'gasto_remuneraciones'
where c.codigo = '5.1.02' and c.nombre = 'Remuneraciones' and c.tipo = 'gasto'
  and c.acepta_movimientos and c.activa and c.clave_sistema is null
  and exists (select 1 from public.cuentas_contables x
              where x.empresa_id = c.empresa_id and x.clave_sistema is not null)
  and not exists (select 1 from public.cuentas_contables x
                  where x.empresa_id = c.empresa_id and x.clave_sistema = 'gasto_remuneraciones');
-- (b) gasto_remuneraciones: codigo libre para las empresas restantes.
insert into public.cuentas_contables (empresa_id, codigo, nombre, tipo, acepta_movimientos, clave_sistema)
select e.id,
       (select '5.1.0' || n from generate_series(6, 99) as n
        where not exists (select 1 from public.cuentas_contables c2
                          where c2.empresa_id = e.id and c2.codigo = '5.1.0' || n)
        order by n limit 1),
       'Remuneraciones', 'gasto', true, 'gasto_remuneraciones'
from public.empresas e
where exists (select 1 from public.cuentas_contables c
              where c.empresa_id = e.id and c.clave_sistema is not null)
  and not exists (select 1 from public.cuentas_contables c
                  where c.empresa_id = e.id and c.clave_sistema = 'gasto_remuneraciones');

-- ---------- RE-CREATE activar_contabilidad (VERBATIM 0024 + 3 anclas) ----------
-- Cambios contra 0024: '2.1.04' y '5.1.02' GANAN clave_sistema (eran filas del
-- seed sin clave; asi no nacen nombres duplicados) y se suma la fila '2.1.06'
-- Retenciones previsionales por pagar. El catalogo queda en 29 cuentas /
-- 14 claves / 5 grupos.
create or replace function public.activar_contabilidad(p_empresa uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin']) then
    raise exception 'Tu rol no permite activar la contabilidad';
  end if;

  -- Siembra idempotente: solo si el catalogo aun no existe (por clave_sistema).
  if not exists (select 1 from cuentas_contables where empresa_id = p_empresa and clave_sistema is not null) then
    insert into cuentas_contables (empresa_id, codigo, nombre, tipo, acepta_movimientos, clave_sistema)
    values
      -- 1 Activos
      (p_empresa, '1',      'Activos',                    'activo',     false, null),
      (p_empresa, '1.1.01', 'Caja',                       'activo',     true,  'caja'),
      (p_empresa, '1.1.02', 'Banco',                      'activo',     true,  'banco'),
      (p_empresa, '1.1.03', 'Clientes',                   'activo',     true,  'clientes'),
      (p_empresa, '1.1.04', 'IVA crédito fiscal',         'activo',     true,  'iva_credito'),
      (p_empresa, '1.1.05', 'Existencias',                'activo',     true,  null),
      (p_empresa, '1.2.01', 'Vehículos',                  'activo',     true,  null),
      (p_empresa, '1.2.02', 'Maquinaria y equipos',       'activo',     true,  null),
      -- 2 Pasivos
      (p_empresa, '2',      'Pasivos',                    'pasivo',     false, null),
      (p_empresa, '2.1.01', 'Proveedores',                'pasivo',     true,  'proveedores'),
      (p_empresa, '2.1.02', 'IVA débito fiscal',          'pasivo',     true,  'iva_debito'),
      (p_empresa, '2.1.03', 'Anticipos de clientes',      'pasivo',     true,  'anticipos_clientes'),
      (p_empresa, '2.1.04', 'Remuneraciones por pagar',   'pasivo',     true,  'remuneraciones_por_pagar'),
      (p_empresa, '2.1.05', 'Impuestos por pagar',        'pasivo',     true,  null),
      (p_empresa, '2.1.06', 'Retenciones previsionales por pagar', 'pasivo', true, 'retenciones_por_pagar'),
      -- 3 Patrimonio
      (p_empresa, '3',      'Patrimonio',                 'patrimonio', false, null),
      (p_empresa, '3.1.01', 'Capital',                    'patrimonio', true,  null),
      (p_empresa, '3.1.02', 'Resultados acumulados',      'patrimonio', true,  null),
      (p_empresa, '3.1.03', 'Utilidad del ejercicio',     'patrimonio', true,  'utilidad_ejercicio'),
      -- 4 Ingresos
      (p_empresa, '4',      'Ingresos',                   'ingreso',    false, null),
      (p_empresa, '4.1.01', 'Ventas afectas',             'ingreso',    true,  'ventas'),
      (p_empresa, '4.1.02', 'Ventas exentas',             'ingreso',    true,  'ventas_exentas'),
      (p_empresa, '4.1.03', 'Otros ingresos',             'ingreso',    true,  null),
      -- 5 Gastos
      (p_empresa, '5',      'Gastos',                     'gasto',      false, null),
      (p_empresa, '5.1.01', 'Costo de ventas y compras',  'gasto',      true,  'compras_gastos'),
      (p_empresa, '5.1.02', 'Remuneraciones',             'gasto',      true,  'gasto_remuneraciones'),
      (p_empresa, '5.1.03', 'Arriendos',                  'gasto',      true,  null),
      (p_empresa, '5.1.04', 'Servicios básicos',          'gasto',      true,  null),
      (p_empresa, '5.1.05', 'Gastos generales',           'gasto',      true,  null);
  end if;

  update empresas set modulo_contabilidad = true where id = p_empresa;
end $$;
revoke execute on function public.activar_contabilidad(uuid) from anon, public;
grant execute on function public.activar_contabilidad(uuid) to authenticated;

-- ---------- Emitir liquidacion (dueno/admin/contador; calculo AUTORITATIVO) ----------
-- Los unicos inputs del cliente son dias/extras/no imponibles: TODO lo demas se
-- recalcula aqui desde el contrato vigente + los indicadores del periodo
-- (reglas 1-8 del spec §3). round() de Postgres sobre numeric = mitad lejos de
-- cero; el espejo TS de core replica ese redondeo con los mismos goldens.
-- Inserta directo en 'emitida' (la vista previa vive en la UI; el borrador
-- persistido es YAGNI v1). Sin advisory lock: no crea asientos; la doble
-- emision concurrente muere en el unique parcial (backstop 23505 -> mensaje
-- contractual). Los CHECKs de la tabla (dias 1-30, extras/no imponibles >= 0)
-- son el candado de rango de los inputs.
create or replace function public.emitir_liquidacion(
  p_empresa uuid, p_trabajador uuid, p_periodo text,
  p_dias integer, p_extras integer, p_no_imponibles integer
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_con record;
  v_ind record;
  v_dias integer := coalesce(p_dias, 30);
  v_extras integer := coalesce(p_extras, 0);
  v_no_imp integer := coalesce(p_no_imponibles, 0);
  v_tasa numeric;
  v_proporcional integer;
  v_gratificacion integer;
  v_imponible integer;
  v_afp integer;
  v_salud integer;
  v_cesantia integer;
  v_base integer;
  v_tramo record;
  v_impuesto integer;
  v_descuentos integer;
  v_liquido integer;
  v_id uuid;
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'contador']) then
    raise exception 'Tu rol no permite emitir liquidaciones';
  end if;
  if p_periodo is null or p_periodo !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Período no válido';
  end if;

  -- Contrato vigente (a lo mas uno: contratos_vigente_idx).
  select * into v_con
  from contratos
  where empresa_id = p_empresa and trabajador_id = p_trabajador and vigente;
  if not found then
    raise exception 'El trabajador no tiene contrato vigente';
  end if;

  select * into v_ind from indicadores_previsionales where periodo = p_periodo;
  if not found then
    raise exception 'No hay indicadores previsionales para el período';
  end if;
  -- Tasa del jsonb segun la AFP del contrato; un periodo sin esa tasa esta
  -- incompleto => mismo mensaje fail-closed.
  v_tasa := (v_ind.tasas_afp ->> v_con.afp)::numeric;
  if v_tasa is null then
    raise exception 'No hay indicadores previsionales para el período';
  end if;

  -- Chequeo amable ANTES de calcular; el unique parcial es el backstop atomico.
  if exists (
    select 1 from liquidaciones
    where empresa_id = p_empresa and trabajador_id = p_trabajador
      and periodo = p_periodo and estado <> 'anulada'
  ) then
    raise exception 'Ya existe una liquidación de ese período';
  end if;

  -- Regla 1: sueldo proporcional a los dias trabajados (mes comercial de 30).
  v_proporcional := round(v_con.sueldo_base::numeric * v_dias / 30);
  -- Regla 2: gratificacion legal 25% con tope 4,75 IMM anual / 12.
  if v_con.gratificacion_legal then
    v_gratificacion := least(
      round(0.25 * (v_proporcional + v_extras)),
      round(4.75 * v_ind.ingreso_minimo / 12));
  else
    v_gratificacion := 0;
  end if;
  -- Regla 3: imponible topado (87,8 UF).
  v_imponible := least(
    v_proporcional + v_extras + v_gratificacion,
    round(v_ind.tope_imponible_uf * v_ind.uf));
  -- Regla 4: AFP (tasa % total con comision, del jsonb).
  v_afp := round(v_imponible * v_tasa / 100);
  -- Regla 5: salud 7% Fonasa; en Isapre el plan pactado en UF es un PISO.
  if v_con.salud = 'fonasa' then
    v_salud := round(v_imponible * 0.07);
  else
    v_salud := greatest(round(0.07 * v_imponible), round(v_con.plan_isapre_uf * v_ind.uf));
  end if;
  -- Regla 6: cesantia 0,6% solo indefinido, base topada a 131,9 UF.
  if v_con.tipo = 'indefinido' then
    v_cesantia := round(least(v_imponible, round(v_ind.tope_cesantia_uf * v_ind.uf)) * 0.006);
  else
    v_cesantia := 0;
  end if;
  -- Regla 7: impuesto unico por tramos UTM SEMIABIERTOS (desde < base <= hasta;
  -- la base exactamente en la frontera cae al tramo inferior). Sin tramo
  -- (base <= 0, borde teorico) o factor 0 => impuesto 0; minimo 0 siempre.
  v_base := v_imponible - v_afp - v_salud - v_cesantia;
  select (t.tramo ->> 'factor')::numeric as factor,
         (t.tramo ->> 'rebaja_utm')::numeric as rebaja_utm
  into v_tramo
  from jsonb_array_elements(v_ind.tramos_impuesto) as t(tramo)
  where v_base > (t.tramo ->> 'desde_utm')::numeric * v_ind.utm
    and (t.tramo ->> 'hasta_utm' is null
         or v_base <= (t.tramo ->> 'hasta_utm')::numeric * v_ind.utm);
  v_impuesto := greatest(coalesce(round(v_base * v_tramo.factor - v_tramo.rebaja_utm * v_ind.utm), 0)::integer, 0);
  -- Regla 8: totales.
  v_descuentos := v_afp + v_salud + v_cesantia + v_impuesto;
  v_liquido := v_imponible + v_no_imp - v_descuentos;
  -- Guard fail-closed (Global Constraints): pocos dias trabajados + plan Isapre
  -- como piso pueden dar liquido < 0; contabilizar_documento filtraria la linea
  -- (haber <= 0), el asiento naceria descuadrado y contabilizar_pendientes
  -- reventaria en cada catch-up (cola envenenada). Se rechaza antes de insertar.
  if v_liquido < 0 then
    raise exception 'El líquido no puede ser negativo: revisa los días trabajados y los descuentos';
  end if;

  begin
    insert into liquidaciones (
      empresa_id, trabajador_id, contrato_id, periodo, estado,
      dias_trabajados, extras_imponibles, no_imponibles,
      sueldo_proporcional, gratificacion, total_imponible,
      afp_monto, salud_monto, cesantia_monto, impuesto_unico,
      total_descuentos, liquido,
      sueldo_base, afp, tasa_afp, salud, plan_isapre_uf, uf, utm, emitida_en)
    values (
      p_empresa, p_trabajador, v_con.id, p_periodo, 'emitida',
      v_dias, v_extras, v_no_imp,
      v_proporcional, v_gratificacion, v_imponible,
      v_afp, v_salud, v_cesantia, v_impuesto,
      v_descuentos, v_liquido,
      v_con.sueldo_base, v_con.afp, v_tasa, v_con.salud, v_con.plan_isapre_uf,
      v_ind.uf, v_ind.utm, now())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Ya existe una liquidación de ese período';
  end;
  return v_id;
end $$;
revoke execute on function public.emitir_liquidacion(uuid, uuid, text, integer, integer, integer) from anon, public;
grant execute on function public.emitir_liquidacion(uuid, uuid, text, integer, integer, integer) to authenticated;

-- ---------- Pagar liquidacion (mismos roles; emitida -> pagada) ----------
-- El update re-evalua el estado bajo el row lock: dos pagos concurrentes dejan
-- al segundo con 0 filas -> mensaje contractual.
create or replace function public.pagar_liquidacion(p_empresa uuid, p_liquidacion uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'contador']) then
    raise exception 'Tu rol no permite emitir liquidaciones';
  end if;
  update liquidaciones
  set estado = 'pagada', pagada_en = now()
  where id = p_liquidacion and empresa_id = p_empresa and estado = 'emitida';
  if not found then
    raise exception 'Solo se puede pagar una liquidación emitida';
  end if;
end $$;
revoke execute on function public.pagar_liquidacion(uuid, uuid) from anon, public;
grant execute on function public.pagar_liquidacion(uuid, uuid) to authenticated;

-- ---------- Anular liquidacion (mismos roles; emitida O pagada -> anulada) ----------
-- La reversa contable NO va aqui: la maneja el hook nunca-lanza de la Server
-- Action (revertir_asiento si habia asiento). Tras anular, el unique parcial
-- libera el periodo y se puede volver a emitir.
create or replace function public.anular_liquidacion(
  p_empresa uuid, p_liquidacion uuid, p_motivo text
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_motivo text;
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'contador']) then
    raise exception 'Tu rol no permite emitir liquidaciones';
  end if;
  v_motivo := nullif(trim(coalesce(p_motivo, '')), '');
  if v_motivo is null then
    raise exception 'Indica el motivo de la anulación';
  end if;
  update liquidaciones
  set estado = 'anulada', anulada_en = now(), motivo_anulacion = v_motivo
  where id = p_liquidacion and empresa_id = p_empresa and estado in ('emitida', 'pagada');
  if not found then
    raise exception 'Solo se puede anular una liquidación emitida o pagada';
  end if;
end $$;
revoke execute on function public.anular_liquidacion(uuid, uuid, text) from anon, public;
grant execute on function public.anular_liquidacion(uuid, uuid, text) to authenticated;

-- ---------- RE-CREATE contabilizar_documento (VERBATIM 0024 + rama 'remuneracion') ----------
-- Cambios contra 0024: v_liq en el declare y la rama nueva. Regla: debe Gasto
-- remuneraciones (total_imponible + no_imponibles) / haber Remuneraciones por
-- pagar (liquido) + Retenciones previsionales por pagar (total_descuentos).
-- Cuadra por construccion (regla 8: liquido = imponible + no_imp - descuentos).
-- Fecha = ultimo dia del mes del periodo; el clamp de app._fecha_contable
-- (linea compartida) la respeta contra ejercicios cerrados. Liquidacion
-- anulada o borrador -> not found -> noop (patron P16).
create or replace function public.contabilizar_documento(
  p_empresa uuid, p_origen text, p_referencia uuid
)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  v_dv record;
  v_dc record;
  v_pago record;
  v_pp record;
  v_ant record;
  v_liq record;
  v_fecha date;
  v_glosa text;
  v_lineas jsonb := '[]'::jsonb;
  v_debe_clave text;
begin
  -- Modulo inactivo -> noop limpio (sin tomar el candado).
  if not exists (select 1 from empresas where id = p_empresa and modulo_contabilidad) then
    return 'noop';
  end if;

  -- Candado del correlativo PRIMERO, antes de cualquier for update de documentos.
  perform pg_advisory_xact_lock(hashtextextended('asientos:' || p_empresa::text, 42));

  -- Idempotencia bajo el candado.
  if exists (
    select 1 from asientos
    where empresa_id = p_empresa and origen = p_origen and referencia_id = p_referencia
  ) then
    return 'noop';
  end if;

  if p_origen = 'venta' then
    select tipo, folio, coalesce(emitido_en, creado_en)::date as fecha, neto, exento, iva, total
    into v_dv
    from documentos_venta
    where id = p_referencia and empresa_id = p_empresa and estado = 'emitido' and tipo in ('factura', 'boleta')
    for update;
    if not found then return 'noop'; end if;
    v_fecha := v_dv.fecha;
    v_glosa := 'Venta ' || v_dv.tipo || coalesce(' N° ' || v_dv.folio, '');
    -- Debe Clientes(total) / Haber Ventas(neto) + Ventas exentas(exento) + IVA débito(iva).
    select coalesce(jsonb_agg(jsonb_build_object('cuentaId', cuenta, 'debe', debe, 'haber', haber) order by ord), '[]'::jsonb)
    into v_lineas
    from (
                    select 1 as ord, (select id from cuentas_contables where empresa_id = p_empresa and clave_sistema = 'clientes')       as cuenta, v_dv.total as debe, 0 as haber
      union all select 2,          (select id from cuentas_contables where empresa_id = p_empresa and clave_sistema = 'ventas'),                    0, v_dv.neto
      union all select 3,          (select id from cuentas_contables where empresa_id = p_empresa and clave_sistema = 'ventas_exentas'),            0, v_dv.exento
      union all select 4,          (select id from cuentas_contables where empresa_id = p_empresa and clave_sistema = 'iva_debito'),                0, v_dv.iva
    ) s where debe > 0 or haber > 0;

  elsif p_origen = 'nota_credito' then
    select folio, coalesce(emitido_en, creado_en)::date as fecha, neto, exento, iva, total
    into v_dv
    from documentos_venta
    where id = p_referencia and empresa_id = p_empresa and estado = 'emitido' and tipo = 'nota_credito'
    for update;
    if not found then return 'noop'; end if;
    v_fecha := v_dv.fecha;
    v_glosa := 'Nota de crédito' || coalesce(' N° ' || v_dv.folio, '');
    -- Inversa de la venta: Debe Ventas + Ventas exentas + IVA débito / Haber Clientes(total).
    select coalesce(jsonb_agg(jsonb_build_object('cuentaId', cuenta, 'debe', debe, 'haber', haber) order by ord), '[]'::jsonb)
    into v_lineas
    from (
                    select 1 as ord, (select id from cuentas_contables where empresa_id = p_empresa and clave_sistema = 'ventas')         as cuenta, v_dv.neto as debe, 0 as haber
      union all select 2,          (select id from cuentas_contables where empresa_id = p_empresa and clave_sistema = 'ventas_exentas'), v_dv.exento, 0
      union all select 3,          (select id from cuentas_contables where empresa_id = p_empresa and clave_sistema = 'iva_debito'),     v_dv.iva, 0
      union all select 4,          (select id from cuentas_contables where empresa_id = p_empresa and clave_sistema = 'clientes'),       0, v_dv.total
    ) s where debe > 0 or haber > 0;

  elsif p_origen = 'compra' then
    select tipo, folio, fecha_emision, neto, exento, iva, total
    into v_dc
    from documentos_compra
    where id = p_referencia and empresa_id = p_empresa and estado = 'activa'
    for update;
    if not found then return 'noop'; end if;
    v_fecha := v_dc.fecha_emision;
    v_glosa := 'Compra ' || v_dc.tipo || ' N° ' || v_dc.folio;
    -- Debe Compras/Gastos(neto+exento) + IVA crédito(iva) / Haber Proveedores(total).
    select coalesce(jsonb_agg(jsonb_build_object('cuentaId', cuenta, 'debe', debe, 'haber', haber) order by ord), '[]'::jsonb)
    into v_lineas
    from (
                    select 1 as ord, (select id from cuentas_contables where empresa_id = p_empresa and clave_sistema = 'compras_gastos') as cuenta, (v_dc.neto + v_dc.exento) as debe, 0 as haber
      union all select 2,          (select id from cuentas_contables where empresa_id = p_empresa and clave_sistema = 'iva_credito'),   v_dc.iva, 0
      union all select 3,          (select id from cuentas_contables where empresa_id = p_empresa and clave_sistema = 'proveedores'),   0, v_dc.total
    ) s where debe > 0 or haber > 0;

  elsif p_origen = 'pago' then
    select fecha, monto, anticipo_id
    into v_pago
    from pagos
    where id = p_referencia and empresa_id = p_empresa and estado = 'activo'
    for update;
    if not found then return 'noop'; end if;
    v_fecha := v_pago.fecha;
    -- El debe ramifica por anticipo_id: con anticipo_id = reclasificacion
    -- (Anticipos de clientes); sin = plata nueva (Banco).
    if v_pago.anticipo_id is not null then
      v_debe_clave := 'anticipos_clientes';
      v_glosa := 'Aplicación de anticipo a cliente';
    else
      v_debe_clave := 'banco';
      v_glosa := 'Pago de cliente';
    end if;
    v_lineas := jsonb_build_array(
      jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = p_empresa and clave_sistema = v_debe_clave), 'debe', v_pago.monto, 'haber', 0),
      jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = p_empresa and clave_sistema = 'clientes'),   'debe', 0, 'haber', v_pago.monto)
    );

  elsif p_origen = 'pago_proveedor' then
    select fecha, monto
    into v_pp
    from pagos_proveedor
    where id = p_referencia and empresa_id = p_empresa and estado = 'activo'
    for update;
    if not found then return 'noop'; end if;
    v_fecha := v_pp.fecha;
    v_glosa := 'Pago a proveedor';
    -- Debe Proveedores(monto) / Haber Banco(monto).
    v_lineas := jsonb_build_array(
      jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = p_empresa and clave_sistema = 'proveedores'), 'debe', v_pp.monto, 'haber', 0),
      jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = p_empresa and clave_sistema = 'banco'),       'debe', 0, 'haber', v_pp.monto)
    );

  elsif p_origen = 'anticipo' then
    -- Solo el anticipo con mp_payment_id (plata nueva del webhook). El
    -- excedente-de-aplicacion (mp_payment_id null) NO aplica -> not found -> noop.
    select monto, recibido_en::date as fecha
    into v_ant
    from anticipos
    where id = p_referencia and empresa_id = p_empresa and mp_payment_id is not null
    for update;
    if not found then return 'noop'; end if;
    v_fecha := v_ant.fecha;
    v_glosa := 'Anticipo recibido';
    -- Debe Banco(monto) / Haber Anticipos de clientes(monto).
    v_lineas := jsonb_build_array(
      jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = p_empresa and clave_sistema = 'banco'),              'debe', v_ant.monto, 'haber', 0),
      jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = p_empresa and clave_sistema = 'anticipos_clientes'), 'debe', 0, 'haber', v_ant.monto)
    );

  elsif p_origen = 'remuneracion' then
    -- Liquidacion emitida o pagada; anulada (o borrador futuro) -> noop.
    select periodo, trabajador_id, total_imponible, no_imponibles, total_descuentos, liquido
    into v_liq
    from liquidaciones
    where id = p_referencia and empresa_id = p_empresa and estado in ('emitida', 'pagada')
    for update;
    if not found then return 'noop'; end if;
    -- Fecha = ultimo dia del mes del periodo (el clamp compartido la pasa
    -- despues por app._fecha_contable).
    v_fecha := (to_date(v_liq.periodo || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date;
    v_glosa := 'Liquidación de sueldo ' || v_liq.periodo || ' ' ||
      (select nombre from trabajadores where id = v_liq.trabajador_id and empresa_id = p_empresa);
    -- Debe Gasto remuneraciones(imponible + no imponibles) /
    -- Haber Remuneraciones por pagar(liquido) + Retenciones por pagar(descuentos).
    select coalesce(jsonb_agg(jsonb_build_object('cuentaId', cuenta, 'debe', debe, 'haber', haber) order by ord), '[]'::jsonb)
    into v_lineas
    from (
                    select 1 as ord, (select id from cuentas_contables where empresa_id = p_empresa and clave_sistema = 'gasto_remuneraciones')     as cuenta, (v_liq.total_imponible + v_liq.no_imponibles) as debe, 0 as haber
      union all select 2,          (select id from cuentas_contables where empresa_id = p_empresa and clave_sistema = 'remuneraciones_por_pagar'),           0, v_liq.liquido
      union all select 3,          (select id from cuentas_contables where empresa_id = p_empresa and clave_sistema = 'retenciones_por_pagar'),              0, v_liq.total_descuentos
    ) s where debe > 0 or haber > 0;

  else
    -- 'manual' / 'reversa' u origen desconocido nunca se contabilizan por aqui.
    return 'noop';
  end if;

  -- Documento tardio (P17): si el anio de la fecha ya esta cerrado, el asiento
  -- va al primer dia del ejercicio abierto (spec 2.5); el auditor lo observa.
  v_fecha := app._fecha_contable(p_empresa, v_fecha);

  -- Mapeo con 0 lineas = noop (documento total 0; jamas un asiento vacio).
  if jsonb_array_length(v_lineas) = 0 then
    return 'noop';
  end if;

  -- Backstop de idempotencia: el 23505 del unique parcial (empresa,origen,ref)
  -- ante un hook concurrente se vuelve noop limpio.
  begin
    perform app._insertar_asiento(p_empresa, v_fecha, v_glosa, p_origen, p_referencia, null, null, v_lineas);
  exception when unique_violation then
    return 'noop';
  end;
  return 'creado';
end $$;
revoke execute on function public.contabilizar_documento(uuid, text, uuid) from anon, public;
grant execute on function public.contabilizar_documento(uuid, text, uuid) to service_role;

-- ---------- RE-CREATE contabilizar_pendientes (VERBATIM 0024 + 1 rama) ----------
-- Unico cambio: el union all de liquidaciones emitidas/pagadas sin asiento
-- (fecha = ultimo dia del mes del periodo, la misma expresion de la rama de
-- contabilizar_documento; el order by clampeado de 0024 queda intacto).
create or replace function public.contabilizar_pendientes(p_empresa uuid)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_rec record;
  v_creados integer := 0;
  v_res text;
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'contador']) then
    raise exception 'Tu rol no permite contabilizar';
  end if;
  if not exists (select 1 from empresas where id = p_empresa and modulo_contabilidad) then
    raise exception 'La contabilidad no está activada';
  end if;

  -- Candado del correlativo PRIMERO, antes de los for update de contabilizar_documento.
  perform pg_advisory_xact_lock(hashtextextended('asientos:' || p_empresa::text, 42));

  for v_rec in
    select origen, referencia_id, fecha from (
                    select 'venta'::text as origen, d.id as referencia_id, coalesce(d.emitido_en, d.creado_en)::date as fecha
      from documentos_venta d
      where d.empresa_id = p_empresa and d.estado = 'emitido' and d.tipo in ('factura', 'boleta')
      union all select 'nota_credito', d.id, coalesce(d.emitido_en, d.creado_en)::date
      from documentos_venta d
      where d.empresa_id = p_empresa and d.estado = 'emitido' and d.tipo = 'nota_credito'
      union all select 'compra', c.id, c.fecha_emision
      from documentos_compra c
      where c.empresa_id = p_empresa and c.estado = 'activa'
      union all select 'pago', pg.id, pg.fecha
      from pagos pg
      where pg.empresa_id = p_empresa and pg.estado = 'activo'
      union all select 'pago_proveedor', pp.id, pp.fecha
      from pagos_proveedor pp
      where pp.empresa_id = p_empresa and pp.estado = 'activo'
      union all select 'anticipo', a.id, a.recibido_en::date
      from anticipos a
      where a.empresa_id = p_empresa and a.mp_payment_id is not null
      union all select 'remuneracion', l.id, (to_date(l.periodo || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date
      from liquidaciones l
      where l.empresa_id = p_empresa and l.estado in ('emitida', 'pagada')
    ) t
    where not exists (
      select 1 from asientos x
      where x.empresa_id = p_empresa and x.origen = t.origen and x.referencia_id = t.referencia_id
    )
    order by app._fecha_contable(p_empresa, t.fecha), t.origen, t.referencia_id
  loop
    v_res := public.contabilizar_documento(p_empresa, v_rec.origen, v_rec.referencia_id);
    if v_res = 'creado' then
      v_creados := v_creados + 1;
    end if;
  end loop;

  return jsonb_build_object('creados', v_creados);
end $$;
revoke execute on function public.contabilizar_pendientes(uuid) from anon, public;
grant execute on function public.contabilizar_pendientes(uuid) to authenticated;

-- ---------- RE-CREATE revision_periodo (VERBATIM 0024 + rama 'remuneracion' en la regla 1) ----------
-- Unico cambio contra 0024: la subconsulta de la regla 1 suma las
-- liquidaciones emitidas/pagadas sin asiento, con la MISMA expresion de fecha
-- que contabilizar_documento/contabilizar_pendientes (ultimo dia del mes del
-- periodo). Reglas 2-7, estado final, revoke y grant: byte a byte desde 0024.
create or replace function public.revision_periodo(p_empresa uuid, p_anio integer, p_mes integer)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_desde date;
  v_hasta date;             -- exclusivo (primer dia del mes siguiente)
  v_obs jsonb := '[]'::jsonb;
  v_n bigint;
  v_libro bigint;
  v_cuenta bigint;
  v_actual bigint;
  v_meses integer;
  v_prom numeric;
  v_doc record;
  v_ant record;
  v_tar record;
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'contador']) then
    raise exception 'Tu rol no permite ver la revisión';
  end if;
  -- Periodo valido (tras el rol): sin esto, make_date reventaria con un error
  -- crudo de Postgres ante p_mes fuera de 1-12.
  if p_anio is null or p_mes is null or p_mes not between 1 and 12 then
    raise exception 'Período no válido';
  end if;

  v_desde := make_date(p_anio, p_mes, 1);
  v_hasta := (v_desde + interval '1 month')::date;

  -- Regla 1: documentos_sin_contabilizar (CRITICA). Mismo criterio de
  -- pendientes de contabilizar_pendientes (0022), acotado al periodo.
  select count(*) into v_n from (
                  select 'venta'::text as origen, d.id as referencia_id, coalesce(d.emitido_en, d.creado_en)::date as fecha
    from documentos_venta d
    where d.empresa_id = p_empresa and d.estado = 'emitido' and d.tipo in ('factura', 'boleta')
    union all select 'nota_credito', d.id, coalesce(d.emitido_en, d.creado_en)::date
    from documentos_venta d
    where d.empresa_id = p_empresa and d.estado = 'emitido' and d.tipo = 'nota_credito'
    union all select 'compra', c.id, c.fecha_emision
    from documentos_compra c
    where c.empresa_id = p_empresa and c.estado = 'activa'
    union all select 'pago', pg.id, pg.fecha
    from pagos pg
    where pg.empresa_id = p_empresa and pg.estado = 'activo'
    union all select 'pago_proveedor', pp.id, pp.fecha
    from pagos_proveedor pp
    where pp.empresa_id = p_empresa and pp.estado = 'activo'
    union all select 'anticipo', a.id, a.recibido_en::date
    from anticipos a
    where a.empresa_id = p_empresa and a.mp_payment_id is not null
    union all select 'remuneracion', l.id, (to_date(l.periodo || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date
    from liquidaciones l
    where l.empresa_id = p_empresa and l.estado in ('emitida', 'pagada')
  ) t
  where t.fecha >= v_desde and t.fecha < v_hasta
    and not exists (
      select 1 from asientos x
      where x.empresa_id = p_empresa and x.origen = t.origen and x.referencia_id = t.referencia_id);
  if v_n > 0 then
    v_obs := v_obs || jsonb_build_array(jsonb_build_object(
      'regla', 'documentos_sin_contabilizar', 'severidad', 'critica',
      'titulo', 'Documentos sin contabilizar',
      'detalle', v_n || case when v_n = 1
        then ' documento del período sin asiento contable'
        else ' documentos del período sin asiento contable' end,
      'enlace_tipo', null, 'enlace_id', null));
  end if;

  -- Regla 2: iva_descuadrado (CRITICA). IVA debito del libro de ventas del mes
  -- (0011: NC con signo negativo) vs movimientos del mes en la cuenta ancla.
  select coalesce(sum(iva), 0) into v_libro
  from libro_ventas
  where empresa_id = p_empresa and fecha >= v_desde and fecha < v_hasta;
  select coalesce(sum(l.haber - l.debe), 0) into v_cuenta
  from asientos_lineas l
  join asientos a on a.id = l.asiento_id and a.empresa_id = l.empresa_id
  join cuentas_contables c on c.id = l.cuenta_id and c.empresa_id = l.empresa_id
  where l.empresa_id = p_empresa and c.clave_sistema = 'iva_debito'
    and a.fecha >= v_desde and a.fecha < v_hasta;
  if v_libro <> v_cuenta then
    v_obs := v_obs || jsonb_build_array(jsonb_build_object(
      'regla', 'iva_descuadrado', 'severidad', 'critica',
      'titulo', 'IVA débito descuadrado',
      'detalle', 'IVA débito del libro de ventas: $' || v_libro
        || ' · movimientos de la cuenta: $' || v_cuenta
        || ' · diferencia: $' || (v_libro - v_cuenta),
      'enlace_tipo', null, 'enlace_id', null));
  end if;

  -- Regla 3: facturas_vencidas_sin_gestion (MEDIA). Con saldo, vencidas hace
  -- mas de 30 dias y sin recordatorio (0020) en los ultimos 30 dias.
  for v_doc in
    select s.documento_id, s.folio, s.saldo, s.fecha_vencimiento
    from saldos_documentos s
    where s.empresa_id = p_empresa and s.tipo = 'factura' and s.saldo > 0
      and s.fecha_vencimiento < current_date - 30
      and not exists (
        select 1 from correos_enviados ce
        where ce.empresa_id = p_empresa and ce.tipo = 'recordatorio'
          and ce.referencia_id = s.documento_id
          and ce.creado_en > now() - interval '30 days')
    order by s.fecha_vencimiento, s.documento_id
  loop
    v_obs := v_obs || jsonb_build_array(jsonb_build_object(
      'regla', 'facturas_vencidas_sin_gestion', 'severidad', 'media',
      'titulo', 'Factura vencida sin gestión',
      'detalle', 'Factura N° ' || v_doc.folio || ' vencida el ' || v_doc.fecha_vencimiento
        || ' con saldo $' || v_doc.saldo || ' y sin recordatorio en los últimos 30 días',
      'enlace_tipo', 'documento_venta', 'enlace_id', v_doc.documento_id));
  end loop;

  -- Regla 4: anomalia_vs_promedio (MEDIA). Banda 60%-140% del promedio de los
  -- hasta 6 meses anteriores CON datos; minimo 2 meses para opinar (filosofia
  -- del semaforo del dashboard). Ventas por libro_ventas; gastos por compras activas.
  select coalesce(sum(total), 0) into v_actual
  from libro_ventas
  where empresa_id = p_empresa and fecha >= v_desde and fecha < v_hasta;
  select count(*), avg(m.monto) into v_meses, v_prom
  from (
    select date_trunc('month', fecha)::date as mes, sum(total) as monto
    from libro_ventas
    where empresa_id = p_empresa
      and fecha >= (v_desde - interval '6 months')::date and fecha < v_desde
    group by 1
  ) m;
  if v_meses >= 2 and (v_actual < 0.6 * v_prom or v_actual > 1.4 * v_prom) then
    v_obs := v_obs || jsonb_build_array(jsonb_build_object(
      'regla', 'anomalia_vs_promedio', 'severidad', 'media',
      'titulo', 'Ventas fuera de lo normal',
      'detalle', 'Ventas del mes: $' || v_actual || ' · promedio de los últimos '
        || v_meses || ' meses: $' || round(v_prom)::bigint || ' · banda normal: 60%-140%',
      'enlace_tipo', null, 'enlace_id', null));
  end if;
  select coalesce(sum(total), 0) into v_actual
  from documentos_compra
  where empresa_id = p_empresa and estado = 'activa'
    and fecha_emision >= v_desde and fecha_emision < v_hasta;
  select count(*), avg(m.monto) into v_meses, v_prom
  from (
    select date_trunc('month', fecha_emision)::date as mes, sum(total) as monto
    from documentos_compra
    where empresa_id = p_empresa and estado = 'activa'
      and fecha_emision >= (v_desde - interval '6 months')::date and fecha_emision < v_desde
    group by 1
  ) m;
  if v_meses >= 2 and (v_actual < 0.6 * v_prom or v_actual > 1.4 * v_prom) then
    v_obs := v_obs || jsonb_build_array(jsonb_build_object(
      'regla', 'anomalia_vs_promedio', 'severidad', 'media',
      'titulo', 'Gastos fuera de lo normal',
      'detalle', 'Gastos del mes: $' || v_actual || ' · promedio de los últimos '
        || v_meses || ' meses: $' || round(v_prom)::bigint || ' · banda normal: 60%-140%',
      'enlace_tipo', null, 'enlace_id', null));
  end if;

  -- Regla 5: anticipos_sin_aplicar (MEDIA). Recibidos hace mas de 60 dias.
  for v_ant in
    select a.id, a.monto, a.recibido_en::date as recibido
    from anticipos a
    where a.empresa_id = p_empresa and a.estado = 'recibido'
      and a.recibido_en < now() - interval '60 days'
    order by a.recibido_en, a.id
  loop
    v_obs := v_obs || jsonb_build_array(jsonb_build_object(
      'regla', 'anticipos_sin_aplicar', 'severidad', 'media',
      'titulo', 'Anticipo sin aplicar',
      'detalle', 'Anticipo de $' || v_ant.monto || ' recibido el ' || v_ant.recibido
        || ' sigue sin aplicarse (más de 60 días)',
      'enlace_tipo', 'anticipo', 'enlace_id', v_ant.id));
  end loop;

  -- Regla 6: asientos_tardios (MEDIA). Asientos automaticos del periodo cuya
  -- fecha difiere de la del documento origen (el clamping de app._fecha_contable
  -- o cualquier descalce): join por origen/referencia_id, misma expresion de
  -- fecha por origen que contabilizar_documento.
  for v_tar in
    select a.id, a.numero, a.fecha, d.fecha_doc
    from asientos a
    cross join lateral (
      select case a.origen
        when 'venta'          then (select coalesce(v.emitido_en, v.creado_en)::date from documentos_venta v  where v.id = a.referencia_id and v.empresa_id = a.empresa_id)
        when 'nota_credito'   then (select coalesce(v.emitido_en, v.creado_en)::date from documentos_venta v  where v.id = a.referencia_id and v.empresa_id = a.empresa_id)
        when 'compra'         then (select c.fecha_emision                          from documentos_compra c where c.id = a.referencia_id and c.empresa_id = a.empresa_id)
        when 'pago'           then (select p.fecha                                  from pagos p             where p.id = a.referencia_id and p.empresa_id = a.empresa_id)
        when 'pago_proveedor' then (select pp.fecha                                 from pagos_proveedor pp  where pp.id = a.referencia_id and pp.empresa_id = a.empresa_id)
        when 'anticipo'       then (select an.recibido_en::date                     from anticipos an        where an.id = a.referencia_id and an.empresa_id = a.empresa_id)
      end as fecha_doc
    ) d
    where a.empresa_id = p_empresa
      and a.fecha >= v_desde and a.fecha < v_hasta
      and a.referencia_id is not null
      and a.origen in ('venta', 'nota_credito', 'compra', 'pago', 'pago_proveedor', 'anticipo')
      and d.fecha_doc is not null and d.fecha_doc <> a.fecha
    order by a.numero
  loop
    v_obs := v_obs || jsonb_build_array(jsonb_build_object(
      'regla', 'asientos_tardios', 'severidad', 'media',
      'titulo', 'Asiento con fecha distinta al documento',
      'detalle', 'Asiento N° ' || v_tar.numero || ' con fecha ' || v_tar.fecha
        || ' registra un documento del ' || v_tar.fecha_doc,
      'enlace_tipo', 'asiento', 'enlace_id', v_tar.id));
  end loop;

  -- Regla 7: ejercicio_anterior_abierto (MEDIA, CTA al cierre asistido).
  -- Criterio UNIFICADO con el noop y el candado de orden de cerrar_ejercicio
  -- (Global Constraints): alguna cuenta de resultado con saldo neto <> 0 en el
  -- anio anterior (un anio sin nada que cerrar no genera observacion).
  if exists (
       select 1
       from asientos_lineas l
       join asientos a on a.id = l.asiento_id and a.empresa_id = l.empresa_id
       join cuentas_contables c on c.id = l.cuenta_id and c.empresa_id = l.empresa_id
       where l.empresa_id = p_empresa
         and extract(year from a.fecha)::integer = p_anio - 1
         and c.tipo in ('ingreso', 'gasto')
         and a.origen <> 'cierre'
         and not exists (
           select 1 from asientos x
           where x.empresa_id = p_empresa and x.id = a.reversa_de and x.origen = 'cierre')
       group by l.cuenta_id
       having sum(l.debe - l.haber) <> 0)
     and not exists (
       select 1 from cierres_ejercicio ce
       where ce.empresa_id = p_empresa and ce.anio = p_anio - 1 and ce.estado = 'cerrado') then
    v_obs := v_obs || jsonb_build_array(jsonb_build_object(
      'regla', 'ejercicio_anterior_abierto', 'severidad', 'media',
      'titulo', 'Ejercicio anterior sin cerrar',
      'detalle', 'El ejercicio ' || (p_anio - 1) || ' tiene movimientos de resultado y aún no está cerrado',
      'enlace_tipo', 'cierre', 'enlace_id', null));
  end if;

  return jsonb_build_object(
    'periodo', jsonb_build_object('anio', p_anio, 'mes', p_mes),
    'estado', case
      when v_obs @> '[{"severidad": "critica"}]'::jsonb then 'critica'
      when v_obs @> '[{"severidad": "media"}]'::jsonb then 'media'
      else 'ok' end,
    'observaciones', v_obs);
end $$;
revoke execute on function public.revision_periodo(uuid, integer, integer) from anon, public;
grant execute on function public.revision_periodo(uuid, integer, integer) to authenticated;
