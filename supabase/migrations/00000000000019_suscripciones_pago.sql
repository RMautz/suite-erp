-- Suscripciones de pago (Plan 14): pago autoservicio de la suscripcion del SaaS
-- por la ORGANIZACION (dinero organizacion -> plataforma, credenciales en env del
-- servidor). Tabla pagos_suscripcion (CERO escritura directa: dueno/admin solo
-- leen; service_role escribe via RPC), el constraint unique(organizacion_id) sobre
-- suscripciones que vuelve GARANTIA el invariante 1-fila-por-org, y 3 RPCs: crear
-- (authenticated dueno/admin de la org), confirmar y abortar (SOLO service_role: el
-- webhook y los retornos corren con el admin client).
--
-- Regla de oro del plan: ningun peso cobrado por la pasarela queda sin acreditar.
-- confirmar_pago_suscripcion es idempotente bajo lock y confirma DESDE pendiente Y
-- DESDE abortado (plata real gana sobre una anulacion de UI); monto discrepante ->
-- 'revision' (dinero registrado, jamas invisible) sin extender. Tablas de
-- PLATAFORMA (organizaciones/planes) sin empresa_id: las FK son SIMPLES.

-- ---------- suscripciones: una fila por organizacion ----------
-- registrar_organizacion (0002) inserta exactamente una y nada mas escribe la
-- tabla; el constraint vuelve garantia el invariante que el update de
-- confirmar_pago_suscripcion asume (extender toca EXACTAMENTE una fila).
alter table public.suscripciones
  add constraint suscripciones_organizacion_unica unique (organizacion_id);

-- ---------- pagos_suscripcion (un pago por periodo; sin recurrencia) ----------
-- monto se COPIA de planes.precio_clp al crear (jamas del cliente). buy_order:
-- <=26 chars alfanumerico (limite Webpay), no enumerable, generado DENTRO de
-- crear_pago_suscripcion; viaja como buy_order (Webpay) y en el external_reference
-- (MP). referencia_externa: mp_payment_id o token Webpay, null hasta confirmar.
create table public.pagos_suscripcion (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id),
  plan_id uuid not null references public.planes (id),
  monto integer not null check (monto > 0),
  pasarela text not null check (pasarela in ('mercadopago', 'webpay')),
  buy_order text not null unique,
  referencia_externa text,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'pagado', 'abortado', 'revision')),
  pagado_en timestamptz,
  creado_en timestamptz not null default now()
);

-- Idempotencia backstop: un mismo pago externo (pasarela, referencia) acredita a lo
-- mas una fila. Parcial: los pendientes (referencia null) no compiten por el slot.
create unique index pagos_suscripcion_referencia_idx
  on public.pagos_suscripcion (pasarela, referencia_externa)
  where referencia_externa is not null;

-- ---------- RLS ----------
alter table public.pagos_suscripcion enable row level security;

-- Solo dueno/admin de la ORG leen su historial; CERO escritura directa (ni policy
-- ni grant de insert/update/delete para authenticated) -- todo entra por RPC
-- service_role, patron links_pago/anticipos de 0018.
create policy "duenos ven pagos de suscripcion" on public.pagos_suscripcion
  for select to authenticated
  using (app.tiene_rol(organizacion_id, array['dueno', 'admin']));

-- ---------- Grants Data API (leccion 0001) ----------
-- El grant "on all tables" de 0001 solo cubrio las tablas de entonces; una tabla
-- nueva necesita su grant a service_role explicito.
grant select on public.pagos_suscripcion to authenticated;
grant select, insert, update, delete on public.pagos_suscripcion to service_role;

-- ---------- Crear pago (authenticated; rol dueno/admin de la ORG) ----------
-- Valida rol -> lockea la org -> lee plan y precio en BD -> genera buy_order no
-- enumerable DENTRO de la RPC (la no-enumerabilidad es invariante estructural, no
-- cortesia del llamador) -> inserta pendiente con monto = precio_clp. Retorna
-- {id, buy_order} para que la action arme la preferencia/transaccion.
create or replace function public.crear_pago_suscripcion(p_organizacion uuid, p_pasarela text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_plan uuid;
  v_precio integer;
  v_buy_order text;
  v_id uuid;
begin
  if not app.tiene_rol(p_organizacion, array['dueno', 'admin']) then
    raise exception 'Tu rol no permite pagar la suscripción';
  end if;

  -- Lock de la organizacion: el plan/precio se leen bajo el, no del cliente.
  select plan_id into v_plan
  from organizaciones where id = p_organizacion
  for update;

  -- Plan null o inactivo -> mismo mensaje; precio 0 -> no se cobra.
  select precio_clp into v_precio
  from planes where id = v_plan and activo;
  if v_plan is null or v_precio is null then
    raise exception 'La organización no tiene un plan asignado';
  end if;
  if v_precio = 0 then
    raise exception 'El plan actual no requiere pago';
  end if;

  if p_pasarela not in ('mercadopago', 'webpay') then
    raise exception 'Método de pago no soportado';
  end if;

  -- buy_order: 25 hex de un uuid sin guiones (<=26, no enumerable, unico).
  v_buy_order := substr(replace(gen_random_uuid()::text, '-', ''), 1, 25);
  insert into pagos_suscripcion (organizacion_id, plan_id, monto, pasarela, buy_order)
  values (p_organizacion, v_plan, v_precio, p_pasarela, v_buy_order)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'buy_order', v_buy_order);
end $$;
revoke execute on function public.crear_pago_suscripcion(uuid, text) from anon, public;
grant execute on function public.crear_pago_suscripcion(uuid, text) to authenticated;

-- ---------- Confirmar pago (SOLO service_role; idempotente; doble via) ----------
-- Webhook y retorno pueden llegar en cualquier orden y repetirse: idempotente bajo
-- el lock del pago. Confirma DESDE pendiente Y DESDE abortado (plata real gana sobre
-- una anulacion de UI). monto discrepante -> 'revision' (dinero registrado, jamas
-- invisible) SIN extender. Feliz: pagado + extiende un mes DESDE el mayor entre hoy,
-- el hasta actual y el fin de trial (no se pierden dias gratis) + org 'activa'.
create or replace function public.confirmar_pago_suscripcion(p_pago uuid, p_referencia text, p_monto integer)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  v_estado text;
  v_monto integer;
  v_org uuid;
  v_trial date;
begin
  -- Lock del pago: dos confirmaciones del mismo pago se serializan aqui.
  select estado, monto, organizacion_id into v_estado, v_monto, v_org
  from pagos_suscripcion where id = p_pago
  for update;
  if not found then
    raise exception 'El pago no existe';
  end if;

  -- Idempotencia primaria dentro del lock.
  if v_estado = 'pagado' then
    return 'noop';
  end if;

  -- Manipulacion (la preferencia/transaccion se crea con el monto de BD): registra
  -- el dinero en 'revision' y NO extiende; el handler emite console.error ALERTA.
  if p_monto <> v_monto then
    -- Backstop 23505 tambien en esta rama: una referencia ya usada llegando con un monto
    -- distinto JAMAS debe volverse 500/retry-loop; se resuelve idempotente 'noop' (misma red
    -- del camino feliz). Edge inalcanzable en operacion normal, pero cerrado por si acaso.
    begin
      update pagos_suscripcion
      set estado = 'revision', referencia_externa = p_referencia
      where id = p_pago;
    exception when unique_violation then
      return 'noop';
    end;
    return 'revision';
  end if;

  -- Marca pagado; backstop 23505 del indice unico parcial -> noop (otra via ya
  -- acredito con la misma referencia).
  begin
    update pagos_suscripcion
    set estado = 'pagado', referencia_externa = p_referencia, pagado_en = now()
    where id = p_pago;
  exception when unique_violation then
    return 'noop';
  end;

  -- Lock de la organizacion y su trial_hasta bajo ese lock (join implicito).
  select trial_hasta into v_trial
  from organizaciones where id = v_org
  for update;

  -- Extiende un mes desde el mayor entre hoy, el hasta actual y el fin de trial.
  update suscripciones
  set hasta = (greatest(current_date, coalesce(hasta, v_trial, current_date)) + interval '1 month')::date
  where organizacion_id = v_org;
  if not found then
    raise exception 'La suscripción de la organización no existe';
  end if;

  update organizaciones set estado = 'activa' where id = v_org;
  return 'extendido';
end $$;
revoke execute on function public.confirmar_pago_suscripcion(uuid, text, integer) from anon, public, authenticated;
grant execute on function public.confirmar_pago_suscripcion(uuid, text, integer) to service_role;

-- ---------- Abortar pago (SOLO service_role) ----------
-- Retorno Webpay con TBK_TOKEN = usuario anulo. Solo degrada un pendiente;
-- pagado/revision intactos (jamas degradar dinero confirmado). 0 filas = no-op.
create or replace function public.abortar_pago_suscripcion(p_pago uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  update pagos_suscripcion set estado = 'abortado'
  where id = p_pago and estado = 'pendiente';
end $$;
revoke execute on function public.abortar_pago_suscripcion(uuid) from anon, public, authenticated;
grant execute on function public.abortar_pago_suscripcion(uuid) to service_role;
