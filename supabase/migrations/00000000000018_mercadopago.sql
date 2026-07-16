-- MercadoPago (Plan 13): links de pago, anticipos y metodo 'mercadopago' en
-- pagos. Capa 1 (Task 1): ALTER de empresas con las credenciales cifradas,
-- las tablas links_pago y anticipos (CERO escritura directa: solo lectura de
-- miembros; service_role escribe via RPC) y el metodo 'mercadopago' habilitado
-- en pagos. Task 2 anexa las 6 RPCs tras la marca del final.
--
-- Regla de oro del plan: ningun peso aprobado por MP queda sin registro local
-- (pago conciliado, o anticipo que se aplica al facturar el origen) y ningun
-- anticipo queda varado (registrar_anticipo_mp jamas valida estado; el rechazo
-- de una proforma con anticipo recibido queda bloqueado en Task 2).

-- ---------- empresas: credenciales MP cifradas (AES-256-GCM, helper de dte) ----------
-- Mismo trust boundary server-only que el certificado DTE (misma env
-- DTE_ENCRYPTION_KEY): el ciphertext es visible a miembros via Data API pero
-- inutil sin la clave, y la app JAMAS lo incluye en un select del cliente.
alter table public.empresas
  add column if not exists mp_access_token_cifrado text,
  add column if not exists mp_webhook_secret_cifrado text;

-- Grant ADITIVO: los grants por columna se acumulan sobre los de 0016 — NO se
-- re-declara aquella lista. Solo estas 2 columnas nuevas ganan update.
grant update (mp_access_token_cifrado, mp_webhook_secret_cifrado) on public.empresas to authenticated;

-- ---------- links_pago (un link vigente por objeto; la UI muestra la URL) ----------
-- origen_tipo/origen_id apuntan a factura (documentos_venta), proforma o
-- cotizacion: es polimorfico, sin FK unica sobre el origen. cliente_id (FK
-- compuesta) lo deriva crear_link_pago de la fila base bajo lock.
create table public.links_pago (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  origen_tipo text not null check (origen_tipo in ('factura', 'proforma', 'cotizacion')),
  origen_id uuid not null,
  cliente_id uuid not null,
  monto integer not null check (monto > 0),
  preferencia_id text not null,
  url text not null,
  estado text not null default 'vigente' check (estado in ('vigente', 'pagado', 'reemplazado')),
  -- El payment MP que pago este link (lo marca registrar_pago_mp/anticipo_mp).
  mp_payment_id text,
  creado_en timestamptz not null default now(),
  unique (empresa_id, id),
  foreign key (empresa_id, cliente_id) references public.clientes (empresa_id, id)
);
-- Un solo link VIGENTE por objeto: regenerar reemplaza al anterior bajo el lock
-- de crear_link_pago (Task 2). Parcial: pagado/reemplazado no ocupan el slot.
create unique index links_pago_vigente_idx on public.links_pago (empresa_id, origen_tipo, origen_id) where estado = 'vigente';
create index links_pago_origen_idx on public.links_pago (empresa_id, origen_tipo, origen_id);

-- ---------- anticipos (dinero recibido antes de la factura; jamas varado) ----------
-- origen_tipo 'excedente' = pago MP mayor al saldo de una factura (el origen es
-- esa misma factura); 'proforma'/'cotizacion' = anticipo puro. mp_payment_id
-- NOT NULL y unico por empresa: la idempotencia del webhook se apoya aqui.
create table public.anticipos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  cliente_id uuid not null,
  origen_tipo text not null check (origen_tipo in ('proforma', 'cotizacion', 'excedente')),
  origen_id uuid not null,
  monto integer not null check (monto > 0),
  mp_payment_id text not null,
  estado text not null default 'recibido' check (estado in ('recibido', 'aplicado')),
  -- Se llenan al aplicar (aplicar_anticipo / aplicar_anticipo_manual, Task 2).
  documento_venta_id uuid,
  pago_id uuid,
  recibido_en timestamptz not null default now(),
  unique (empresa_id, id),
  unique (empresa_id, mp_payment_id),
  foreign key (empresa_id, cliente_id) references public.clientes (empresa_id, id),
  foreign key (empresa_id, documento_venta_id) references public.documentos_venta (empresa_id, id),
  foreign key (empresa_id, pago_id) references public.pagos (empresa_id, id)
);
create index anticipos_origen_idx on public.anticipos (empresa_id, origen_tipo, origen_id);

-- ---------- RLS ----------
alter table public.links_pago enable row level security;
alter table public.anticipos enable row level security;

-- Solo lectura de miembros; CERO escritura directa (ni policy ni grant de
-- insert/update/delete para authenticated) — todo entra por RPC service_role,
-- patron proformas/ordenes_entrega de 0016.
create policy "miembros ven links de pago" on public.links_pago
  for select to authenticated using (empresa_id in (select app.mis_empresas()));
create policy "miembros ven anticipos" on public.anticipos
  for select to authenticated using (empresa_id in (select app.mis_empresas()));

-- ---------- Grants Data API (leccion Plan 1) ----------
grant select on public.links_pago, public.anticipos to authenticated;
grant select, insert, update, delete on public.links_pago, public.anticipos to service_role;

-- ---------- pagos: metodo 'mercadopago' + idempotencia por payment ----------
-- mp_payment_id nullable (los pagos manuales no lo llevan) con unique PARCIAL:
-- un payment MP registra a lo mas un pago por empresa (backstop de la
-- idempotencia de registrar_pago_mp).
alter table public.pagos add column if not exists mp_payment_id text;
create unique index pagos_mp_payment_idx on public.pagos (empresa_id, mp_payment_id) where mp_payment_id is not null;

-- Re-create del CHECK de metodo agregando 'mercadopago'. El constraint inline
-- de 0010 se llama pagos_metodo_check (convencion tabla_columna_check de
-- Postgres, confirmada contra la BD); se dropea y re-crea porque un CHECK no
-- admite ALTER en su lugar. Acepta todos los metodos previos: la data existente
-- (los 211 pgTAP) sigue validando.
alter table public.pagos drop constraint pagos_metodo_check;
alter table public.pagos add constraint pagos_metodo_check
  check (metodo in ('efectivo', 'transferencia', 'tarjeta', 'cheque', 'otro', 'mercadopago'));

-- ===== RPCs (Task 2) =====

-- ================== RPCs de MercadoPago (Task 2) ==================
-- security definer + set search_path = public; revoke/grant como los espejos.
-- registrar_pago_mp, registrar_anticipo_mp y aplicar_anticipo son SOLO
-- service_role (el webhook y el hook de emision corren con el admin client);
-- crear_link_pago y aplicar_anticipo_manual son authenticated (rol d/a/v).
-- Saldo INLINE bajo el lock de la fila base (patron registrar_pago 0010/0015):
-- la vista saldos_documentos no es lockeable.

-- ---------- Crear link de pago (rol d/a/v; valida por tipo bajo lock) ----------
-- Factura emitida (paga el SALDO), proforma enviada/aprobada o cotizacion
-- aceptada (pagan el TOTAL como anticipo). Reemplaza el link vigente anterior
-- del mismo objeto bajo el mismo lock (un link vigente por objeto).
create or replace function public.crear_link_pago(
  p_empresa uuid, p_id uuid, p_origen_tipo text, p_origen uuid,
  p_preferencia text, p_url text, p_monto integer
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_cliente uuid;
  v_estado text;
  v_total integer;
  v_saldo integer;
  v_link uuid;
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'vendedor']) then
    raise exception 'Tu rol no permite generar links de pago';
  end if;

  if p_origen_tipo = 'factura' then
    -- Lock de la factura y saldo INLINE (patron registrar_pago; NO la vista).
    select cliente_id into v_cliente
    from documentos_venta
    where id = p_origen and empresa_id = p_empresa
      and estado = 'emitido' and tipo in ('factura', 'boleta')
    for update;
    if not found then
      raise exception 'Solo se generan links para facturas emitidas con saldo';
    end if;
    select (d.total
      - coalesce((select sum(a.monto) from pagos_aplicaciones a
                  join pagos pg on pg.id = a.pago_id and pg.empresa_id = a.empresa_id
                  where a.documento_id = d.id and a.empresa_id = p_empresa and pg.estado = 'activo'), 0)
      - coalesce((select sum(nc.total) from documentos_venta nc
                  where nc.documento_referencia_id = d.id and nc.empresa_id = p_empresa
                    and nc.tipo = 'nota_credito' and nc.estado = 'emitido'), 0)
    ) into v_saldo
    from documentos_venta d
    where d.id = p_origen and d.empresa_id = p_empresa;
    if v_saldo <= 0 then
      raise exception 'Solo se generan links para facturas emitidas con saldo';
    end if;
    if p_monto is null or p_monto <> v_saldo then
      raise exception 'El monto no coincide con el saldo del documento';
    end if;
  elsif p_origen_tipo = 'proforma' then
    select cliente_id, estado, total into v_cliente, v_estado, v_total
    from proformas where id = p_origen and empresa_id = p_empresa
    for update;
    if not found then
      raise exception 'El documento no existe';
    end if;
    if v_estado not in ('enviada', 'aprobada') then
      raise exception 'La proforma no permite link de pago en su estado actual';
    end if;
    if p_monto is null or p_monto <> v_total then
      raise exception 'El monto no coincide con el total del documento';
    end if;
  elsif p_origen_tipo = 'cotizacion' then
    select cliente_id, estado, total into v_cliente, v_estado, v_total
    from cotizaciones where id = p_origen and empresa_id = p_empresa
    for update;
    if not found then
      raise exception 'El documento no existe';
    end if;
    if v_estado <> 'aceptada' then
      raise exception 'La cotización no permite link de pago en su estado actual';
    end if;
    if p_monto is null or p_monto <> v_total then
      raise exception 'El monto no coincide con el total del documento';
    end if;
  else
    raise exception 'El documento no existe';
  end if;

  -- Reemplaza el vigente anterior bajo el mismo lock (un link vigente por objeto);
  -- el indice unico parcial links_pago_vigente_idx es el backstop.
  update links_pago set estado = 'reemplazado'
  where empresa_id = p_empresa and origen_tipo = p_origen_tipo and origen_id = p_origen
    and estado = 'vigente';

  insert into links_pago (id, empresa_id, origen_tipo, origen_id, cliente_id, monto, preferencia_id, url)
  values (p_id, p_empresa, p_origen_tipo, p_origen, v_cliente, p_monto, p_preferencia, p_url)
  returning id into v_link;

  return v_link;
end $$;
revoke execute on function public.crear_link_pago(uuid, uuid, text, uuid, text, text, integer) from anon, public;
grant execute on function public.crear_link_pago(uuid, uuid, text, uuid, text, text, integer) to authenticated;

-- ---------- Registrar pago MP (SOLO service_role; idempotente; excedente) ----------
-- min(recibido, saldo) al pago (metodo 'mercadopago'); el excedente -> fila en
-- anticipos ('excedente', origen = el documento); saldo 0 -> todo a excedente
-- (sin fila en pagos). Marca el link 'pagado'. Idempotente por (empresa,
-- mp_payment_id): exists DENTRO del lock del doc + unique parcial de backstop.
create or replace function public.registrar_pago_mp(
  p_empresa uuid, p_documento uuid, p_monto integer,
  p_mp_payment_id text, p_link uuid
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_cliente uuid;
  v_saldo integer;
  v_aplicado integer;
  v_excedente integer;
  v_pago uuid;
begin
  -- Lock del documento: dos webhooks del mismo payment lockean el MISMO doc y
  -- se serializan; la idempotencia se resuelve dentro del lock.
  select cliente_id into v_cliente
  from documentos_venta
  where id = p_documento and empresa_id = p_empresa
    and estado = 'emitido' and tipo in ('factura', 'boleta')
  for update;
  if not found then
    raise exception 'El documento no existe';
  end if;

  -- Idempotencia primaria: este payment ya se registro (como pago o excedente).
  if exists (select 1 from pagos where empresa_id = p_empresa and mp_payment_id = p_mp_payment_id)
     or exists (select 1 from anticipos where empresa_id = p_empresa and mp_payment_id = p_mp_payment_id) then
    return;
  end if;

  select (d.total
    - coalesce((select sum(a.monto) from pagos_aplicaciones a
                join pagos pg on pg.id = a.pago_id and pg.empresa_id = a.empresa_id
                where a.documento_id = d.id and a.empresa_id = p_empresa and pg.estado = 'activo'), 0)
    - coalesce((select sum(nc.total) from documentos_venta nc
                where nc.documento_referencia_id = d.id and nc.empresa_id = p_empresa
                  and nc.tipo = 'nota_credito' and nc.estado = 'emitido'), 0)
  ) into v_saldo
  from documentos_venta d
  where d.id = p_documento and d.empresa_id = p_empresa;

  -- min(recibido, saldo) al pago; saldo 0 (o ya sobrepagado) -> todo a excedente.
  v_aplicado := greatest(least(p_monto, v_saldo), 0);
  v_excedente := p_monto - v_aplicado;

  -- El unique parcial (empresa_id, mp_payment_id) es el backstop: si un segundo
  -- webhook del mismo payment se cuela en paralelo, el 23505 lo vuelve no-op
  -- (re-select implicito: el existente ya cubre el registro, nada mas que hacer).
  begin
    if v_aplicado > 0 then
      insert into pagos (empresa_id, cliente_id, metodo, monto, mp_payment_id)
      values (p_empresa, v_cliente, 'mercadopago', v_aplicado, p_mp_payment_id)
      returning id into v_pago;
      insert into pagos_aplicaciones (empresa_id, pago_id, documento_id, monto)
      values (p_empresa, v_pago, p_documento, v_aplicado);
    end if;
    if v_excedente > 0 then
      insert into anticipos (empresa_id, cliente_id, origen_tipo, origen_id, monto, mp_payment_id)
      values (p_empresa, v_cliente, 'excedente', p_documento, v_excedente, p_mp_payment_id);
    end if;
  exception when unique_violation then
    return;
  end;

  update links_pago set estado = 'pagado', mp_payment_id = p_mp_payment_id
  where id = p_link and empresa_id = p_empresa;
end $$;
revoke execute on function public.registrar_pago_mp(uuid, uuid, integer, text, uuid) from anon, public;
grant execute on function public.registrar_pago_mp(uuid, uuid, integer, text, uuid) to service_role;

-- ---------- Registrar anticipo MP (SOLO service_role; jamas valida estado) ----------
-- Valida SOLO existencia + tenencia del origen (proforma/cotizacion) — NUNCA su
-- estado: el dinero aprobado se registra aunque el origen haya avanzado o sido
-- rechazado entre el pago y el webhook. Inserta 'recibido'; marca el link 'pagado'.
create or replace function public.registrar_anticipo_mp(
  p_empresa uuid, p_origen_tipo text, p_origen uuid, p_monto integer,
  p_mp_payment_id text, p_link uuid
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_cliente uuid;
begin
  if p_origen_tipo = 'proforma' then
    select cliente_id into v_cliente from proformas
    where id = p_origen and empresa_id = p_empresa;
  elsif p_origen_tipo = 'cotizacion' then
    select cliente_id into v_cliente from cotizaciones
    where id = p_origen and empresa_id = p_empresa;
  else
    raise exception 'El documento no existe';
  end if;
  if v_cliente is null then
    raise exception 'El documento no existe';
  end if;

  -- Idempotente por (empresa, mp_payment_id): exists primero; el unique es
  -- backstop y tras 23505 se re-selecciona el existente (no-op) y se retorna.
  if exists (select 1 from anticipos where empresa_id = p_empresa and mp_payment_id = p_mp_payment_id) then
    return;
  end if;

  begin
    insert into anticipos (empresa_id, cliente_id, origen_tipo, origen_id, monto, mp_payment_id)
    values (p_empresa, v_cliente, p_origen_tipo, p_origen, p_monto, p_mp_payment_id);
  exception when unique_violation then
    return;
  end;

  update links_pago set estado = 'pagado', mp_payment_id = p_mp_payment_id
  where id = p_link and empresa_id = p_empresa;
end $$;
revoke execute on function public.registrar_anticipo_mp(uuid, text, uuid, integer, text, uuid) from anon, public;
grant execute on function public.registrar_anticipo_mp(uuid, text, uuid, integer, text, uuid) to service_role;

-- ---------- Aplicar anticipo (SOLO service_role; hook de emision) ----------
-- Al emitir la factura del origen: el anticipo 'recibido' cuyo origen se facturo
-- en ESTE documento se aplica hasta el saldo (pago 'mercadopago', mp_payment_id
-- del anticipo) y queda 'aplicado'. Sin anticipo -> no-op. Doble aplicacion
-- imposible: el estado se decide bajo el lock del doc + for update del anticipo.
create or replace function public.aplicar_anticipo(p_empresa uuid, p_documento uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_cliente uuid;
  v_ant record;
  v_saldo integer;
  v_aplicado integer;
  v_pago uuid;
begin
  -- Lock del documento primero (orden estable doc -> anticipo, igual que el manual).
  select cliente_id into v_cliente
  from documentos_venta
  where id = p_documento and empresa_id = p_empresa
    and estado = 'emitido' and tipo in ('factura', 'boleta')
  for update;
  if not found then
    return;
  end if;

  -- Anticipo recibido cuyo origen (proforma/cotizacion) se facturo en este doc.
  select a.* into v_ant
  from anticipos a
  where a.empresa_id = p_empresa and a.estado = 'recibido'
    and (
      (a.origen_tipo = 'proforma' and a.origen_id in (
        select id from proformas where empresa_id = p_empresa and documento_venta_id = p_documento))
      or (a.origen_tipo = 'cotizacion' and a.origen_id in (
        select id from cotizaciones where empresa_id = p_empresa and documento_venta_id = p_documento))
    )
  order by a.recibido_en
  limit 1
  for update;
  if not found then
    return;
  end if;

  select (d.total
    - coalesce((select sum(a.monto) from pagos_aplicaciones a
                join pagos pg on pg.id = a.pago_id and pg.empresa_id = a.empresa_id
                where a.documento_id = d.id and a.empresa_id = p_empresa and pg.estado = 'activo'), 0)
    - coalesce((select sum(nc.total) from documentos_venta nc
                where nc.documento_referencia_id = d.id and nc.empresa_id = p_empresa
                  and nc.tipo = 'nota_credito' and nc.estado = 'emitido'), 0)
  ) into v_saldo
  from documentos_venta d
  where d.id = p_documento and d.empresa_id = p_empresa;

  v_aplicado := least(v_ant.monto, v_saldo);
  if v_aplicado <= 0 then
    return;
  end if;

  insert into pagos (empresa_id, cliente_id, metodo, monto, mp_payment_id)
  values (p_empresa, v_cliente, 'mercadopago', v_aplicado, v_ant.mp_payment_id)
  returning id into v_pago;
  insert into pagos_aplicaciones (empresa_id, pago_id, documento_id, monto)
  values (p_empresa, v_pago, p_documento, v_aplicado);

  update anticipos set estado = 'aplicado', pago_id = v_pago, documento_venta_id = p_documento
  where id = v_ant.id and empresa_id = p_empresa;
end $$;
revoke execute on function public.aplicar_anticipo(uuid, uuid) from anon, public;
grant execute on function public.aplicar_anticipo(uuid, uuid) to service_role;

-- ---------- Aplicar anticipo manual (authenticated; boton de /cobranza) ----------
-- Rol d/a/v elige un anticipo 'recibido' y una factura emitida CON saldo del
-- MISMO cliente. Misma aplicacion que el hook, con las validaciones extra.
create or replace function public.aplicar_anticipo_manual(
  p_empresa uuid, p_anticipo uuid, p_documento uuid
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_doc record;
  v_ant record;
  v_saldo integer;
  v_aplicado integer;
  v_pago uuid;
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'vendedor']) then
    raise exception 'Tu rol no permite aplicar anticipos';
  end if;

  -- Lock del documento primero (mismo orden doc -> anticipo que el hook).
  select cliente_id, total into v_doc
  from documentos_venta
  where id = p_documento and empresa_id = p_empresa
    and estado = 'emitido' and tipo in ('factura', 'boleta')
  for update;
  if not found then
    raise exception 'El documento no permite aplicar el anticipo';
  end if;

  select * into v_ant
  from anticipos
  where id = p_anticipo and empresa_id = p_empresa and estado = 'recibido'
  for update;
  if not found then
    raise exception 'El anticipo no existe o ya fue aplicado';
  end if;
  if v_ant.cliente_id <> v_doc.cliente_id then
    raise exception 'El documento no permite aplicar el anticipo';
  end if;

  select (d.total
    - coalesce((select sum(a.monto) from pagos_aplicaciones a
                join pagos pg on pg.id = a.pago_id and pg.empresa_id = a.empresa_id
                where a.documento_id = d.id and a.empresa_id = p_empresa and pg.estado = 'activo'), 0)
    - coalesce((select sum(nc.total) from documentos_venta nc
                where nc.documento_referencia_id = d.id and nc.empresa_id = p_empresa
                  and nc.tipo = 'nota_credito' and nc.estado = 'emitido'), 0)
  ) into v_saldo
  from documentos_venta d
  where d.id = p_documento and d.empresa_id = p_empresa;
  if v_saldo <= 0 then
    raise exception 'El documento no permite aplicar el anticipo';
  end if;

  v_aplicado := least(v_ant.monto, v_saldo);

  insert into pagos (empresa_id, cliente_id, metodo, monto, mp_payment_id)
  values (p_empresa, v_doc.cliente_id, 'mercadopago', v_aplicado, v_ant.mp_payment_id)
  returning id into v_pago;
  insert into pagos_aplicaciones (empresa_id, pago_id, documento_id, monto)
  values (p_empresa, v_pago, p_documento, v_aplicado);

  update anticipos set estado = 'aplicado', pago_id = v_pago, documento_venta_id = p_documento
  where id = v_ant.id and empresa_id = p_empresa;
end $$;
revoke execute on function public.aplicar_anticipo_manual(uuid, uuid, uuid) from anon, public;
grant execute on function public.aplicar_anticipo_manual(uuid, uuid, uuid) to authenticated;

-- ---------- RE-CREATE cambiar_estado_proforma (VERBATIM 0016 + bloqueo) ----------
-- Copia EXACTA de 0016 salvo el bloque marcado (0018): al transitar a
-- 'rechazada', si la proforma tiene un anticipo 'recibido' se bloquea (la
-- devolucion es manual en MP, fuera de v1). El lock del anticipo va DENTRO del
-- lock de la proforma -> la decision no se cruza con un webhook en vuelo.
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
    -- BLOQUEO (0018): una proforma con anticipo recibido no se rechaza hasta
    -- resolver la devolucion. Lock del anticipo dentro del lock de la proforma.
    perform 1 from anticipos
    where origen_tipo = 'proforma' and origen_id = p_proforma
      and empresa_id = p_empresa and estado = 'recibido'
    for update;
    if found then
      raise exception 'La proforma tiene un anticipo recibido; gestiona la devolución primero';
    end if;
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

-- ---------- RE-CREATE registrar_pago (VERBATIM 0015 + 'mercadopago') ----------
-- Copia EXACTA de la version vigente (0015, con el order by anti-deadlock) salvo
-- 'mercadopago' agregado a la whitelist interna de metodos (diff de 1 linea):
-- el pago manual gana el metodo sin abrir escritura directa.
create or replace function public.registrar_pago(
  p_empresa uuid, p_cliente uuid, p_fecha date, p_metodo text, p_monto integer,
  p_referencia text, p_notas text, p_aplicaciones jsonb
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_pago uuid;
  v_app jsonb;
  v_doc record;
  v_monto_app integer;
  v_suma integer := 0;
  v_saldo integer;
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'vendedor']) then
    raise exception 'Tu rol no permite registrar pagos';
  end if;
  if p_metodo is null or p_metodo not in ('efectivo', 'transferencia', 'tarjeta', 'cheque', 'otro', 'mercadopago') then
    raise exception 'Método de pago no válido';
  end if;
  if p_monto is null or p_monto <= 0 then
    raise exception 'El monto del pago debe ser mayor a 0';
  end if;
  if not exists (select 1 from clientes where id = p_cliente and empresa_id = p_empresa) then
    raise exception 'Cliente no encontrado en la empresa';
  end if;
  if p_aplicaciones is null or jsonb_array_length(p_aplicaciones) = 0 then
    raise exception 'El pago debe aplicarse a al menos un documento';
  end if;

  insert into pagos (empresa_id, cliente_id, fecha, metodo, monto, referencia, notas)
  values (p_empresa, p_cliente, coalesce(p_fecha, current_date), p_metodo, p_monto,
          nullif(trim(coalesce(p_referencia, '')), ''), nullif(trim(coalesce(p_notas, '')), ''))
  returning id into v_pago;

  for v_app in select * from jsonb_array_elements(p_aplicaciones) order by value->>'documentoId' loop
    -- Lock del documento: dos pagos concurrentes al mismo documento se serializan aqui
    -- y el saldo se calcula DENTRO del lock (sin TOCTOU).
    select d.id, d.total into v_doc
    from documentos_venta d
    where d.id = (v_app->>'documentoId')::uuid and d.empresa_id = p_empresa
      and d.cliente_id = p_cliente and d.estado = 'emitido' and d.tipo in ('factura', 'boleta')
    for update;
    if not found then
      raise exception 'Documento no cobrable o no pertenece al cliente';
    end if;
    v_monto_app := (v_app->>'monto')::integer;
    if v_monto_app is null or v_monto_app <= 0 then
      raise exception 'El monto aplicado debe ser mayor a 0';
    end if;

    select (v_doc.total
      - coalesce((select sum(a.monto) from pagos_aplicaciones a
                  join pagos pg on pg.id = a.pago_id and pg.empresa_id = a.empresa_id
                  where a.documento_id = v_doc.id and a.empresa_id = p_empresa and pg.estado = 'activo'), 0)
      - coalesce((select sum(nc.total) from documentos_venta nc
                  where nc.documento_referencia_id = v_doc.id and nc.empresa_id = p_empresa
                    and nc.tipo = 'nota_credito' and nc.estado = 'emitido'), 0)
    ) into v_saldo;
    if v_monto_app > v_saldo then
      raise exception 'El monto aplicado supera el saldo del documento (saldo: $%)', v_saldo;
    end if;

    insert into pagos_aplicaciones (empresa_id, pago_id, documento_id, monto)
    values (p_empresa, v_pago, v_doc.id, v_monto_app);
    v_suma := v_suma + v_monto_app;
  end loop;

  if v_suma <> p_monto then
    raise exception 'La suma de las aplicaciones debe ser igual al monto del pago';
  end if;

  return v_pago;
end $$;
revoke execute on function public.registrar_pago(uuid, uuid, date, text, integer, text, text, jsonb) from anon, public;
grant execute on function public.registrar_pago(uuid, uuid, date, text, integer, text, text, jsonb) to authenticated;
