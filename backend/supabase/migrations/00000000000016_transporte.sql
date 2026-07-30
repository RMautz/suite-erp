-- Vertical transporte (Plan 11): flota, tarifario por destino, ordenes de
-- entrega (ODE) y proformas numeradas. Modulo activable por empresa
-- (modulo_transporte) con factor volumetrico configurable. De pasada se
-- cierra un hueco pre-existente: empresas permitia update de TODAS sus
-- columnas (incluida organizacion_id) a cualquier dueno/admin.
-- Task 1: tablas + grants + vista. Task 2 anexa las RPCs al final.

-- ---------- empresas: activacion del modulo y factor volumetrico ----------
-- factor_volumetrico: kg por M3 para el kilo afecto (default 250). Los cambios
-- son PROSPECTIVOS: kilo_afecto/neto ya persistidos jamas se recalculan.
alter table public.empresas
  add column if not exists modulo_transporte boolean not null default false,
  add column if not exists factor_volumetrico integer not null default 250
    check (factor_volumetrico between 1 and 10000);

-- ---------- empresas: endurecimiento (update por columnas) ----------
-- La policy "duenos editan empresas" (0001) sigue siendo el filtro de FILA;
-- este grant restringe las COLUMNAS: id/rut/organizacion_id quedan FUERA
-- (un dueno no puede mover su empresa a otra organizacion). La lista incluye
-- las columnas del emisor DTE (0004) que Configuracion actualiza hoy.
revoke update on public.empresas from authenticated;
grant update (razon_social, giro, direccion, comuna, giro_emisor, direccion_emisor, comuna_emisor, resolucion_sii_numero, resolucion_sii_fecha, certificado_cifrado, certificado_password_cifrada, dte_api_key_cifrada, modulo_transporte, factor_volumetrico) on public.empresas to authenticated;

-- ---------- Vehiculos (maestro, espejo de proveedores) ----------
create table public.vehiculos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  -- Patentes chilenas: BBBB99 (actual) o BB9999 (antigua). Mayusculas ya
  -- normalizadas por la app (normalizarPatente en @suite/core).
  patente text not null check (patente ~ '^[A-Z]{4}[0-9]{2}$' or patente ~ '^[A-Z]{2}[0-9]{4}$'),
  descripcion text,
  capacidad_kg integer check (capacidad_kg > 0),
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  unique (empresa_id, patente),
  unique (empresa_id, id)
);

-- ---------- Conductores (maestro, espejo de proveedores) ----------
create table public.conductores (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  -- Ultima linea de defensa: normalizado y con DV correcto tambien en la BD.
  rut text not null check (rut = app.normalizar_rut(rut) and app.validar_rut(rut)),
  nombre text not null,
  telefono text,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  unique (empresa_id, rut),
  unique (empresa_id, id)
);

-- ---------- Destinos (tarifario: $/kg afecto por destino) ----------
-- SOLO indice unico CI (leccion 9b sin la redundancia: el CI implica el plano).
-- nombre/empresa_id son INMUTABLES por grants, asi la colision CI solo puede
-- ocurrir en el insert: un solo punto donde mapear el 23505.
create table public.destinos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  nombre text not null,
  tarifa_kg integer not null check (tarifa_kg > 0),
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  unique (empresa_id, id)
);
create unique index destinos_nombre_ci_idx on public.destinos (empresa_id, lower(nombre));

-- ---------- Proformas (ANTES que ordenes_entrega: la ODE le hace FK) ----------
-- Documento comercial NO tributario, correlativo por empresa (display
-- 'PF-' || lpad(numero, 6, '0')). neto/iva/total ALMACENADOS: sobreviven a la
-- liberacion de ODEs de una rechazada. IVA sobre el neto TOTAL (criterio
-- verificado contra el sistema real del usuario). Maquina de estados en RPC:
-- borrador -> enviada | rechazada; enviada -> aprobada | rechazada;
-- aprobada -> rechazada | facturada (SOLO facturar_proforma);
-- facturada -> aprobada (SOLO anular_estado_pago).
create table public.proformas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  numero integer not null,
  cliente_id uuid not null,
  fecha date not null default current_date,
  neto integer not null default 0 check (neto >= 0),
  iva integer not null default 0 check (iva >= 0),
  total integer not null default 0 check (total >= 0 and total = neto + iva),
  estado text not null default 'borrador'
    check (estado in ('borrador', 'enviada', 'aprobada', 'rechazada', 'facturada')),
  motivo_rechazo text,
  notas text,
  documento_venta_id uuid,
  creado_en timestamptz not null default now(),
  unique (empresa_id, numero),
  unique (empresa_id, id),
  foreign key (empresa_id, cliente_id) references public.clientes (empresa_id, id),
  -- Nota de venta generada por facturar_proforma (nullable hasta facturar).
  foreign key (empresa_id, documento_venta_id) references public.documentos_venta (empresa_id, id)
);
create index proformas_lista_idx on public.proformas (empresa_id, estado, creado_en desc);

-- ---------- Ordenes de entrega (ODE: la unidad comercial del transportista) ----------
-- kilo_afecto = round(max(kilos, m3 * factor_volumetrico)) calculado SIEMPRE
-- server-side en crear_orden_entrega; el neto lo manda el llamador (tarifario
-- como sugerencia, negociable — patron precios de cotizaciones).
create table public.ordenes_entrega (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  numero integer not null,
  cliente_id uuid not null,
  fecha_ingreso date not null,
  destino_id uuid not null,
  -- Guias de despacho asociadas (texto libre, como en su proforma real).
  docum text,
  oc_cliente text,
  bultos integer not null check (bultos > 0),
  kilos numeric(9,2) not null check (kilos > 0),
  m3 numeric(9,2) check (m3 >= 0),
  kilo_afecto integer not null check (kilo_afecto > 0),
  neto integer not null check (neto > 0),
  -- Despacho opcional: al crear o despues via asignar_despacho (insumo Plan 12).
  vehiculo_id uuid,
  conductor_id uuid,
  notas text,
  estado text not null default 'registrada'
    check (estado in ('registrada', 'facturada', 'anulada')),
  motivo_anulacion text,
  -- Reserva: la proforma que agrupa esta ODE (null = libre).
  proforma_id uuid,
  documento_venta_id uuid,
  creado_en timestamptz not null default now(),
  unique (empresa_id, numero),
  unique (empresa_id, id),
  foreign key (empresa_id, cliente_id) references public.clientes (empresa_id, id),
  foreign key (empresa_id, destino_id) references public.destinos (empresa_id, id),
  foreign key (empresa_id, vehiculo_id) references public.vehiculos (empresa_id, id),
  foreign key (empresa_id, conductor_id) references public.conductores (empresa_id, id),
  foreign key (empresa_id, proforma_id) references public.proformas (empresa_id, id),
  foreign key (empresa_id, documento_venta_id) references public.documentos_venta (empresa_id, id)
);
create index ordenes_entrega_lista_idx on public.ordenes_entrega (empresa_id, estado, fecha_ingreso desc);
create index ordenes_entrega_cliente_idx on public.ordenes_entrega (empresa_id, cliente_id, estado);
create index ordenes_entrega_proforma_idx on public.ordenes_entrega (empresa_id, proforma_id) where proforma_id is not null;
create index ordenes_entrega_documento_idx on public.ordenes_entrega (empresa_id, documento_venta_id) where documento_venta_id is not null;

-- ---------- RLS ----------
alter table public.vehiculos enable row level security;
alter table public.conductores enable row level security;
alter table public.destinos enable row level security;
alter table public.proformas enable row level security;
alter table public.ordenes_entrega enable row level security;

-- Maestros: ver miembros; crear/editar dueno/admin (tarifas y flota = dinero;
-- el vendedor NO edita — espejo de proveedores 0008).
create policy "miembros ven vehiculos" on public.vehiculos
  for select to authenticated using (empresa_id in (select app.mis_empresas()));
create policy "duenos crean vehiculos" on public.vehiculos
  for insert to authenticated
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']));
create policy "duenos editan vehiculos" on public.vehiculos
  for update to authenticated
  using (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']))
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']));

create policy "miembros ven conductores" on public.conductores
  for select to authenticated using (empresa_id in (select app.mis_empresas()));
create policy "duenos crean conductores" on public.conductores
  for insert to authenticated
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']));
create policy "duenos editan conductores" on public.conductores
  for update to authenticated
  using (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']))
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']));

create policy "miembros ven destinos" on public.destinos
  for select to authenticated using (empresa_id in (select app.mis_empresas()));
create policy "duenos crean destinos" on public.destinos
  for insert to authenticated
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']));
create policy "duenos editan destinos" on public.destinos
  for update to authenticated
  using (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']))
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']));

-- Proformas y ODEs: solo lectura para miembros. CERO escritura directa
-- (ni policies ni grants — leccion migraciones 4->7): todo entra por RPC.
create policy "miembros ven proformas" on public.proformas
  for select to authenticated using (empresa_id in (select app.mis_empresas()));
create policy "miembros ven ordenes de entrega" on public.ordenes_entrega
  for select to authenticated using (empresa_id in (select app.mis_empresas()));

-- ---------- Grants Data API (leccion Plan 1) ----------
-- Maestros: update POR COLUMNAS — patente/rut/nombre-de-destino/empresa_id
-- son INMUTABLES (renombrar un destino re-mapearia tarifas ya usadas; cambiar
-- una patente rompe la trazabilidad del despacho).
grant select, insert on public.vehiculos, public.conductores, public.destinos to authenticated;
grant update (descripcion, capacidad_kg, activo) on public.vehiculos to authenticated;
grant update (nombre, telefono, activo) on public.conductores to authenticated;
grant update (tarifa_kg, activo) on public.destinos to authenticated;
grant select on public.proformas, public.ordenes_entrega to authenticated;
grant select, insert, update, delete on public.vehiculos, public.conductores, public.destinos, public.proformas, public.ordenes_entrega to service_role;

-- ---------- Vista ventas_por_producto: fuera las lineas sin producto ----------
-- facturar_proforma insertara lineas con producto_id null (flete, no producto);
-- sin este filtro el top de productos agruparia basura por descripcion.
-- Copia exacta de 0012 cambiando SOLO el where; los grants de 0012 persisten.
create or replace view public.ventas_por_producto with (security_invoker = true) as
select
  l.empresa_id,
  coalesce(d.emitido_en, d.creado_en)::date as fecha,
  l.producto_id,
  l.descripcion,
  sum(l.cantidad)::integer as cantidad,
  sum(l.subtotal)::integer as subtotal
from public.documentos_venta_lineas l
join public.documentos_venta d on d.id = l.documento_id and d.empresa_id = l.empresa_id
where d.estado = 'emitido' and d.tipo in ('factura', 'boleta') and l.producto_id is not null
group by l.empresa_id, fecha, l.producto_id, l.descripcion;

-- ===== RPCs (Task 2) =====

-- ================== RPCs del ciclo de transporte (Task 2) ==================
-- security definer + search_path = public; rol via app.tiene_rol_en_empresa;
-- ciclo completo = dueno/admin/vendedor. Anti-TOCTOU: toda validacion de
-- estado/pertenencia corre DESPUES del for update; toda operacion multi-ODE
-- toma locks en orden estable (order by id) antes del UPDATE masivo.

-- ---------- Crear orden de entrega (kilo afecto SIEMPRE server-side) ----------
-- La RPC ni siquiera recibe kilo_afecto: se deriva de kilos/m3/factor de la
-- empresa. El neto SI viene del llamador (negociable, patron cotizaciones);
-- el tarifario es sugerencia de UI con control por visibilidad.
create or replace function public.crear_orden_entrega(
  p_empresa uuid, p_cliente uuid, p_fecha date, p_destino uuid,
  p_docum text, p_oc text, p_bultos integer, p_kilos numeric, p_m3 numeric,
  p_neto integer, p_vehiculo uuid, p_conductor uuid, p_notas text
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_modulo boolean;
  v_factor integer;
  v_kilos numeric;
  v_m3 numeric;
  v_kilo_afecto integer;
  v_numero integer;
  v_orden uuid;
begin
  -- Rol ANTES que modulo (precedente: cambiar_estado_proforma): si el modulo
  -- se consultara primero, el booleano modulo_transporte de una empresa AJENA
  -- seria un oraculo cross-tenant para quien no es miembro. Con el rol primero,
  -- un no-miembro nunca llega a leer ese booleano.
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'vendedor']) then
    raise exception 'Tu rol no permite registrar órdenes de entrega';
  end if;
  select modulo_transporte, factor_volumetrico into v_modulo, v_factor
  from empresas where id = p_empresa;
  -- Cubre empresa inexistente (v_modulo null) y modulo apagado.
  if not coalesce(v_modulo, false) then
    raise exception 'El módulo de transporte no está activo';
  end if;
  -- Cubre inexistente, ajeno e inactivo con el mismo mensaje.
  if not exists (select 1 from clientes where id = p_cliente and empresa_id = p_empresa and activo) then
    raise exception 'Cliente no válido';
  end if;
  if not exists (select 1 from destinos where id = p_destino and empresa_id = p_empresa and activo) then
    raise exception 'Destino no válido';
  end if;
  if p_fecha is null then
    raise exception 'Ingresa la fecha de ingreso';
  end if;
  if p_bultos is null or p_bultos < 1 then
    raise exception 'Los bultos deben ser un entero mayor a 0';
  end if;
  -- Kilos y M3 se redondean a 2 decimales ANTES de validar y de persistir
  -- (numeric(9,2) en tabla): lo validado es exactamente lo que se guarda.
  v_kilos := round(p_kilos, 2);
  if v_kilos is null or v_kilos <= 0 then
    raise exception 'Los kilos deben ser mayores a 0';
  end if;
  if v_kilos > 1000000 then
    raise exception 'Los kilos superan el máximo admitido';
  end if;
  v_m3 := round(p_m3, 2);
  if v_m3 < 0 then
    raise exception 'Los M3 no pueden ser negativos';
  end if;
  -- Con factor <= 10000 (check de tabla), m3 <= 100000 garantiza que
  -- m3 * factor cabe siempre en int4.
  if v_m3 > 100000 then
    raise exception 'Los M3 superan el máximo admitido';
  end if;
  if p_neto is null or p_neto < 1 then
    raise exception 'El neto debe ser un entero mayor a 0';
  end if;
  -- Vehiculo/conductor OPCIONALES al crear (tambien via asignar_despacho).
  if p_vehiculo is not null and not exists (
    select 1 from vehiculos where id = p_vehiculo and empresa_id = p_empresa and activo
  ) then
    raise exception 'Vehículo no válido';
  end if;
  if p_conductor is not null and not exists (
    select 1 from conductores where id = p_conductor and empresa_id = p_empresa and activo
  ) then
    raise exception 'Conductor no válido';
  end if;

  -- Kilo afecto server-side, verificado contra la proforma real del usuario:
  -- max(175, 1.26*250) = 315; max(787, 2.88*250) = 787.
  v_kilo_afecto := round(greatest(v_kilos, coalesce(v_m3, 0) * v_factor))::integer;
  if v_kilo_afecto < 1 then
    raise exception 'La carga es demasiado pequeña para tarifar';
  end if;

  -- Serializa la numeracion por empresa (patron cotizaciones).
  perform pg_advisory_xact_lock(hashtextextended('ordenes_entrega:' || p_empresa::text, 42));
  select coalesce(max(numero), 0) + 1 into v_numero
  from ordenes_entrega where empresa_id = p_empresa;

  insert into ordenes_entrega (
    empresa_id, numero, cliente_id, fecha_ingreso, destino_id, docum, oc_cliente,
    bultos, kilos, m3, kilo_afecto, neto, vehiculo_id, conductor_id, notas
  )
  values (
    p_empresa, v_numero, p_cliente, p_fecha, p_destino,
    nullif(trim(coalesce(p_docum, '')), ''), nullif(trim(coalesce(p_oc, '')), ''),
    p_bultos, v_kilos, v_m3, v_kilo_afecto, p_neto, p_vehiculo, p_conductor,
    nullif(trim(coalesce(p_notas, '')), '')
  )
  returning id into v_orden;

  return v_orden;
end $$;
revoke execute on function public.crear_orden_entrega(uuid, uuid, date, uuid, text, text, integer, numeric, numeric, integer, uuid, uuid, text) from anon, public;
grant execute on function public.crear_orden_entrega(uuid, uuid, date, uuid, text, text, integer, numeric, numeric, integer, uuid, uuid, text) to authenticated;

-- ---------- Asignar despacho (funciona con modulo off; insumo del Plan 12) ----------
create or replace function public.asignar_despacho(
  p_empresa uuid, p_orden uuid, p_vehiculo uuid, p_conductor uuid
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_estado text;
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'vendedor']) then
    raise exception 'Tu rol no permite asignar despachos';
  end if;

  select estado into v_estado
  from ordenes_entrega where id = p_orden and empresa_id = p_empresa
  for update;
  if not found then
    -- Cubre por igual inexistente y de-otro-tenant, sin distinguirlos.
    raise exception 'La orden de entrega no existe';
  end if;
  -- registrada O facturada valen: el despacho fisico es independiente
  -- de la facturacion.
  if v_estado = 'anulada' then
    raise exception 'No se puede asignar despacho a una orden anulada';
  end if;
  if p_vehiculo is not null and not exists (
    select 1 from vehiculos where id = p_vehiculo and empresa_id = p_empresa and activo
  ) then
    raise exception 'Vehículo no válido';
  end if;
  if p_conductor is not null and not exists (
    select 1 from conductores where id = p_conductor and empresa_id = p_empresa and activo
  ) then
    raise exception 'Conductor no válido';
  end if;

  -- null = desasignar: la RPC pisa ambos campos con lo que llega.
  update ordenes_entrega set vehiculo_id = p_vehiculo, conductor_id = p_conductor
  where id = p_orden and empresa_id = p_empresa;
end $$;
revoke execute on function public.asignar_despacho(uuid, uuid, uuid, uuid) from anon, public;
grant execute on function public.asignar_despacho(uuid, uuid, uuid, uuid) to authenticated;

-- ---------- Anular orden de entrega (solo registrada y libre) ----------
create or replace function public.anular_orden_entrega(
  p_empresa uuid, p_orden uuid, p_motivo text
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_orden record;
  v_motivo text;
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'vendedor']) then
    raise exception 'Tu rol no permite anular órdenes de entrega';
  end if;

  select estado, proforma_id into v_orden
  from ordenes_entrega where id = p_orden and empresa_id = p_empresa
  for update;
  if not found then
    raise exception 'La orden de entrega no existe';
  end if;

  v_motivo := nullif(trim(coalesce(p_motivo, '')), '');
  if v_motivo is null then
    raise exception 'La anulación requiere un motivo';
  end if;
  -- Orden de checks FIJADO por contrato: estado ANTES que reserva
  -- (una facturada reservada reclama por estado, no por proforma).
  if v_orden.estado <> 'registrada' then
    raise exception 'Solo se puede anular una orden registrada';
  end if;
  if v_orden.proforma_id is not null then
    raise exception 'La orden está en una proforma; recházala primero';
  end if;

  update ordenes_entrega set estado = 'anulada', motivo_anulacion = v_motivo
  where id = p_orden and empresa_id = p_empresa;
end $$;
revoke execute on function public.anular_orden_entrega(uuid, uuid, text) from anon, public;
grant execute on function public.anular_orden_entrega(uuid, uuid, text) to authenticated;

-- ---------- Crear proforma (agrupa ODEs registradas de UN cliente) ----------
-- IVA REAL sobre el neto TOTAL: round(neto * 0.19) — verificado contra el
-- sistema del usuario (43.289 = round(227.836 * 0.19) <> suma de IVAs por linea).
create or replace function public.crear_proforma(
  p_empresa uuid, p_cliente uuid, p_ordenes uuid[], p_notas text
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_proforma uuid;
  v_numero integer;
  v_ordenes uuid[];
  v_validas integer;
  v_neto bigint;
  v_iva integer;
begin
  -- Rol ANTES que modulo (mismo precedente que crear_orden_entrega y
  -- cambiar_estado_proforma): evita que el booleano modulo_transporte de una
  -- empresa ajena sea un oraculo cross-tenant para un no-miembro.
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'vendedor']) then
    raise exception 'Tu rol no permite gestionar proformas';
  end if;
  if not exists (select 1 from empresas where id = p_empresa and modulo_transporte) then
    raise exception 'El módulo de transporte no está activo';
  end if;
  if coalesce(array_length(p_ordenes, 1), 0) < 1 then
    raise exception 'La proforma necesita al menos una orden de entrega';
  end if;
  -- Dedup: la misma ODE repetida en el array cuenta y se reserva UNA vez.
  select array_agg(distinct x) into v_ordenes from unnest(p_ordenes) x;
  if not exists (select 1 from clientes where id = p_cliente and empresa_id = p_empresa and activo) then
    raise exception 'Cliente no válido';
  end if;

  -- Locks en orden estable ANTES de validar (anti-TOCTOU / anti-deadlock):
  -- dos crear_proforma concurrentes sobre la misma ODE se serializan aqui.
  perform 1 from ordenes_entrega
  where id = any(v_ordenes) and empresa_id = p_empresa
  order by id
  for update;

  -- Un solo conteo post-lock cubre inexistente/ajena, no-registrada,
  -- de otro cliente y ya reservada, con el mismo mensaje.
  select count(*) into v_validas
  from ordenes_entrega
  where id = any(v_ordenes) and empresa_id = p_empresa
    and estado = 'registrada' and cliente_id = p_cliente and proforma_id is null;
  if v_validas <> array_length(v_ordenes, 1) then
    raise exception 'Hay una orden no válida, de otro cliente, ya facturada o en otra proforma';
  end if;

  -- Dinero en bigint: el umbral neto+iva se chequea ANTES de castear a int4
  -- (sin esto, la suma grande revienta con 22003 en vez de un mensaje claro).
  select sum(neto)::bigint into v_neto
  from ordenes_entrega
  where id = any(v_ordenes) and empresa_id = p_empresa;
  if v_neto + round(v_neto * 0.19) > 2147483647 then
    raise exception 'La proforma supera el monto máximo facturable';
  end if;
  v_iva := round(v_neto * 0.19)::integer;

  -- Serializa la numeracion por empresa (display 'PF-' || lpad(numero, 6, '0')).
  perform pg_advisory_xact_lock(hashtextextended('proformas:' || p_empresa::text, 42));
  select coalesce(max(numero), 0) + 1 into v_numero
  from proformas where empresa_id = p_empresa;

  insert into proformas (empresa_id, numero, cliente_id, neto, iva, total, notas)
  values (p_empresa, v_numero, p_cliente, v_neto::integer, v_iva, v_neto::integer + v_iva,
          nullif(trim(coalesce(p_notas, '')), ''))
  returning id into v_proforma;

  update ordenes_entrega set proforma_id = v_proforma
  where id = any(v_ordenes) and empresa_id = p_empresa;

  return v_proforma;
end $$;
revoke execute on function public.crear_proforma(uuid, uuid, uuid[], text) from anon, public;
grant execute on function public.crear_proforma(uuid, uuid, uuid[], text) to authenticated;

-- ---------- Cambiar estado de proforma ('facturada' vetada aqui) ----------
create or replace function public.cambiar_estado_proforma(
  p_empresa uuid, p_proforma uuid, p_estado text, p_motivo text default null
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_actual text;
  v_motivo text;
begin
  -- Rol ANTES del lookup: un rol sin permiso no aprende si la proforma existe.
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'vendedor']) then
    raise exception 'Tu rol no permite gestionar proformas';
  end if;

  -- Lock: una transicion no se cruza con facturar/deshacer en vuelo.
  select estado into v_actual
  from proformas where id = p_proforma and empresa_id = p_empresa
  for update;
  if not found then
    -- Cubre por igual inexistente y de-otro-tenant, sin distinguirlos.
    raise exception 'La proforma no existe';
  end if;

  -- borrador -> enviada | rechazada; enviada -> aprobada | rechazada;
  -- aprobada -> rechazada. 'facturada' SOLO via facturar_proforma;
  -- facturada -> aprobada SOLO via anular_estado_pago.
  if p_estado is null or not (
    (v_actual = 'borrador' and p_estado in ('enviada', 'rechazada')) or
    (v_actual = 'enviada' and p_estado in ('aprobada', 'rechazada')) or
    (v_actual = 'aprobada' and p_estado = 'rechazada')
  ) then
    raise exception 'Transición de estado no válida';
  end if;

  v_motivo := nullif(trim(coalesce(p_motivo, '')), '');
  if p_estado = 'rechazada' and v_motivo is null then
    raise exception 'El rechazo requiere un motivo';
  end if;

  if p_estado = 'rechazada' then
    -- Todo rechazo LIBERA las ODEs: locks ordenados ANTES del update masivo.
    perform 1 from ordenes_entrega
    where proforma_id = p_proforma and empresa_id = p_empresa
    order by id
    for update;
    update ordenes_entrega set proforma_id = null
    where proforma_id = p_proforma and empresa_id = p_empresa;
  end if;

  update proformas
  set estado = p_estado,
      -- p_motivo solo se persiste al rechazar; en el resto queda null.
      motivo_rechazo = case when p_estado = 'rechazada' then v_motivo else null end
  where id = p_proforma and empresa_id = p_empresa;
end $$;
revoke execute on function public.cambiar_estado_proforma(uuid, uuid, text, text) from anon, public;
grant execute on function public.cambiar_estado_proforma(uuid, uuid, text, text) to authenticated;

-- ---------- Facturar proforma (aprobada -> nota de venta en borrador) ----------
-- Sin folio ni folios_caf: el folio se toma al EMITIR (tomar_folio), flujo
-- existente intacto.
create or replace function public.facturar_proforma(p_empresa uuid, p_proforma uuid)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_pf record;
  v_doc uuid;
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'vendedor']) then
    raise exception 'Tu rol no permite facturar proformas';
  end if;

  -- Lock: el check de estado corre DENTRO del lock (doble facturacion imposible).
  select estado, cliente_id, neto, iva, total into v_pf
  from proformas where id = p_proforma and empresa_id = p_empresa
  for update;
  if not found then
    raise exception 'La proforma no existe';
  end if;
  if v_pf.estado <> 'aprobada' then
    raise exception 'Solo se puede facturar una proforma aprobada';
  end if;

  -- Re-lock de SUS ODEs en orden estable y re-validacion post-lock
  -- (cinturon y tirantes: no hay camino natural que las saque de
  -- 'registrada' estando reservadas; se fija igual por contrato).
  perform 1 from ordenes_entrega
  where proforma_id = p_proforma and empresa_id = p_empresa
  order by id
  for update;
  if exists (
    select 1 from ordenes_entrega
    where proforma_id = p_proforma and empresa_id = p_empresa and estado <> 'registrada'
  ) then
    raise exception 'Hay una orden no válida, de otro cliente, ya facturada o en otra proforma';
  end if;

  -- Nota de venta en borrador con los totales DE LA PROFORMA
  -- (flete de carga AFECTO: exento = 0).
  insert into documentos_venta (empresa_id, tipo, cliente_id, estado, neto, exento, iva, total)
  values (p_empresa, 'nota_venta', v_pf.cliente_id, 'borrador', v_pf.neto, 0, v_pf.iva, v_pf.total)
  returning id into v_doc;

  -- Una linea por ODE, SIN producto (no contamina ventas_por_producto).
  -- left(..., 80) = tope NmbItem del DTE SII (evita rechazos con SimpleAPI).
  insert into documentos_venta_lineas (empresa_id, documento_id, producto_id, descripcion, cantidad, precio_neto, exenta, subtotal)
  select o.empresa_id, v_doc, null::uuid,
         left('ODE N° ' || o.numero || ' ' || d.nombre || coalesce(' — guías ' || o.docum, ''), 80),
         1, o.neto, false, o.neto
  from ordenes_entrega o
  join destinos d on d.id = o.destino_id and d.empresa_id = o.empresa_id
  where o.proforma_id = p_proforma and o.empresa_id = p_empresa
  order by o.numero;

  update ordenes_entrega set estado = 'facturada', documento_venta_id = v_doc
  where proforma_id = p_proforma and empresa_id = p_empresa;

  update proformas set estado = 'facturada', documento_venta_id = v_doc
  where id = p_proforma and empresa_id = p_empresa;

  return v_doc;
end $$;
revoke execute on function public.facturar_proforma(uuid, uuid) from anon, public;
grant execute on function public.facturar_proforma(uuid, uuid) to authenticated;

-- ---------- Deshacer estado de pago (reversa total de facturar_proforma) ----------
-- Acepta: nota de venta en borrador SIN folio (nada consumido) O DTE
-- factura/boleta RECHAZADO por el SII (folio consumido = gap justificable).
-- Con factura ACEPTADA: nota de credito, nada se libera (v1).
create or replace function public.anular_estado_pago(p_empresa uuid, p_documento uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_doc record;
  v_proforma uuid;
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'vendedor']) then
    raise exception 'Tu rol no permite anular estados de pago';
  end if;

  select tipo, estado, folio into v_doc
  from documentos_venta where id = p_documento and empresa_id = p_empresa
  for update;
  if not found then
    raise exception 'El documento no existe';
  end if;

  -- Solo documentos nacidos de una proforma son deshacibles por aqui:
  -- una nota de venta de comercio en borrador NO entra por esta puerta.
  select id into v_proforma
  from proformas where documento_venta_id = p_documento and empresa_id = p_empresa
  for update;
  if not found then
    raise exception 'El documento no proviene de una proforma';
  end if;

  if not (
    (v_doc.tipo = 'nota_venta' and v_doc.estado = 'borrador' and v_doc.folio is null) or
    (v_doc.tipo in ('factura', 'boleta') and v_doc.estado = 'rechazado')
  ) then
    raise exception 'Solo se puede deshacer un estado de pago en borrador o rechazado';
  end if;

  -- Reversa: locks ordenados; las ODEs vuelven a 'registrada' CONSERVANDO
  -- proforma_id (la proforma vuelve a 'aprobada' con su nomina intacta).
  perform 1 from ordenes_entrega
  where documento_venta_id = p_documento and empresa_id = p_empresa
  order by id
  for update;
  update ordenes_entrega set estado = 'registrada', documento_venta_id = null
  where documento_venta_id = p_documento and empresa_id = p_empresa;

  update proformas set estado = 'aprobada', documento_venta_id = null
  where id = v_proforma and empresa_id = p_empresa;

  -- El definer borra lineas y documento (authenticated no tiene delete;
  -- las FK a este doc ya quedaron en null arriba).
  delete from documentos_venta_lineas where documento_id = p_documento and empresa_id = p_empresa;
  delete from documentos_venta where id = p_documento and empresa_id = p_empresa;
end $$;
revoke execute on function public.anular_estado_pago(uuid, uuid) from anon, public;
grant execute on function public.anular_estado_pago(uuid, uuid) to authenticated;
