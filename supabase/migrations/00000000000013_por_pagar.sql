-- Cuentas por pagar: facturas de proveedor (digitacion manual), pagos realizados
-- multi-documento y libro de compras SII. Espejo de Cobranza (0010) + libro (0011).

-- ---------- Facturas de proveedor ----------
create table public.documentos_compra (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  proveedor_id uuid not null,
  tipo text not null check (tipo in ('factura', 'factura_exenta')),
  folio integer not null check (folio > 0),
  fecha_emision date not null,
  neto integer not null default 0 check (neto >= 0),
  exento integer not null default 0 check (exento >= 0),
  iva integer not null default 0 check (iva >= 0),
  total integer not null check (total >= 0 and total = neto + exento + iva),
  orden_id uuid,
  notas text,
  estado text not null default 'activa' check (estado in ('activa', 'anulada')),
  motivo_anulacion text,
  creado_en timestamptz not null default now(),
  unique (empresa_id, id),
  -- Anti doble-digitacion: factura (33) y factura exenta (34) llevan series independientes.
  unique (empresa_id, proveedor_id, tipo, folio),
  foreign key (empresa_id, proveedor_id) references public.proveedores (empresa_id, id),
  foreign key (empresa_id, orden_id) references public.ordenes_compra (empresa_id, id)
);
create index documentos_compra_proveedor_idx on public.documentos_compra (empresa_id, proveedor_id);

-- ---------- Pagos a proveedor (espejo de pagos de cobranza) ----------
create table public.pagos_proveedor (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  proveedor_id uuid not null,
  fecha date not null default current_date,
  metodo text not null check (metodo in ('efectivo', 'transferencia', 'tarjeta', 'cheque', 'otro')),
  monto integer not null check (monto > 0),
  referencia text,
  notas text,
  estado text not null default 'activo' check (estado in ('activo', 'anulado')),
  motivo_anulacion text,
  creado_en timestamptz not null default now(),
  unique (empresa_id, id),
  foreign key (empresa_id, proveedor_id) references public.proveedores (empresa_id, id)
);
create index pagos_proveedor_prov_idx on public.pagos_proveedor (empresa_id, proveedor_id);

create table public.pagos_proveedor_aplicaciones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  pago_id uuid not null,
  documento_id uuid not null,
  monto integer not null check (monto > 0),
  unique (empresa_id, id),
  foreign key (empresa_id, pago_id) references public.pagos_proveedor (empresa_id, id),
  foreign key (empresa_id, documento_id) references public.documentos_compra (empresa_id, id)
);
create index pagos_proveedor_apl_doc_idx on public.pagos_proveedor_aplicaciones (empresa_id, documento_id);

-- ---------- Vistas (security_invoker) ----------
create view public.saldos_compras with (security_invoker = true) as
select
  d.empresa_id,
  d.id as documento_id,
  d.tipo,
  d.folio,
  d.proveedor_id,
  pr.razon_social as proveedor_razon_social,
  d.fecha_emision,
  (d.fecha_emision + pr.condicion_pago_dias) as fecha_vencimiento,
  d.total,
  coalesce(p.pagado, 0)::integer as pagado,
  (d.total - coalesce(p.pagado, 0))::integer as saldo
from public.documentos_compra d
join public.proveedores pr on pr.id = d.proveedor_id and pr.empresa_id = d.empresa_id
left join lateral (
  select sum(a.monto) as pagado
  from public.pagos_proveedor_aplicaciones a
  join public.pagos_proveedor pg on pg.id = a.pago_id and pg.empresa_id = a.empresa_id
  where a.documento_id = d.id and a.empresa_id = d.empresa_id and pg.estado = 'activo'
) p on true
where d.estado = 'activa';

create view public.libro_compras with (security_invoker = true) as
select
  d.empresa_id,
  d.id as documento_id,
  d.fecha_emision as fecha,
  d.tipo,
  d.folio,
  pr.rut as rut_proveedor,
  pr.razon_social as razon_social_proveedor,
  d.neto,
  d.exento,
  d.iva,
  d.total
from public.documentos_compra d
join public.proveedores pr on pr.id = d.proveedor_id and pr.empresa_id = d.empresa_id
where d.estado = 'activa';

-- ---------- RLS ----------
alter table public.documentos_compra enable row level security;
alter table public.pagos_proveedor enable row level security;
alter table public.pagos_proveedor_aplicaciones enable row level security;

create policy "miembros ven documentos de compra" on public.documentos_compra
  for select to authenticated using (empresa_id in (select app.mis_empresas()));
create policy "miembros ven pagos a proveedor" on public.pagos_proveedor
  for select to authenticated using (empresa_id in (select app.mis_empresas()));
create policy "miembros ven aplicaciones de pago a proveedor" on public.pagos_proveedor_aplicaciones
  for select to authenticated using (empresa_id in (select app.mis_empresas()));

-- Registro manual de facturas: insert directo SOLO dueno/admin (sin update/delete:
-- la anulacion va por RPC con motivo y precondicion de pagos).
create policy "duenos registran facturas de compra" on public.documentos_compra
  for insert to authenticated
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']));

-- ---------- Grants (leccion Plan 1) ----------
grant select, insert on public.documentos_compra to authenticated;
grant select on public.pagos_proveedor, public.pagos_proveedor_aplicaciones to authenticated;
grant select on public.saldos_compras, public.libro_compras to authenticated;
grant select, insert, update, delete on public.documentos_compra, public.pagos_proveedor, public.pagos_proveedor_aplicaciones to service_role;
grant select on public.saldos_compras, public.libro_compras to service_role;

-- ---------- Registrar pago a proveedor (atomico; espejo de registrar_pago 0010) ----------
create or replace function public.registrar_pago_proveedor(
  p_empresa uuid, p_proveedor uuid, p_fecha date, p_metodo text, p_monto integer,
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
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin']) then
    raise exception 'Tu rol no permite registrar pagos a proveedores';
  end if;
  if p_metodo is null or p_metodo not in ('efectivo', 'transferencia', 'tarjeta', 'cheque', 'otro') then
    raise exception 'Método de pago no válido';
  end if;
  if p_monto is null or p_monto <= 0 then
    raise exception 'El monto del pago debe ser mayor a 0';
  end if;
  if not exists (select 1 from proveedores where id = p_proveedor and empresa_id = p_empresa) then
    raise exception 'Proveedor no encontrado en la empresa';
  end if;
  if p_aplicaciones is null or jsonb_array_length(p_aplicaciones) = 0 then
    raise exception 'El pago debe aplicarse a al menos un documento';
  end if;

  insert into pagos_proveedor (empresa_id, proveedor_id, fecha, metodo, monto, referencia, notas)
  values (p_empresa, p_proveedor, coalesce(p_fecha, current_date), p_metodo, p_monto,
          nullif(trim(coalesce(p_referencia, '')), ''), nullif(trim(coalesce(p_notas, '')), ''))
  returning id into v_pago;

  for v_app in select * from jsonb_array_elements(p_aplicaciones) loop
    select d.id, d.total into v_doc
    from documentos_compra d
    where d.id = (v_app->>'documentoId')::uuid and d.empresa_id = p_empresa
      and d.proveedor_id = p_proveedor and d.estado = 'activa'
    for update;
    if not found then
      raise exception 'Documento no válido o no pertenece al proveedor';
    end if;
    v_monto_app := (v_app->>'monto')::integer;
    if v_monto_app is null or v_monto_app <= 0 then
      raise exception 'El monto aplicado debe ser mayor a 0';
    end if;

    select (v_doc.total
      - coalesce((select sum(a.monto) from pagos_proveedor_aplicaciones a
                  join pagos_proveedor pg on pg.id = a.pago_id and pg.empresa_id = a.empresa_id
                  where a.documento_id = v_doc.id and a.empresa_id = p_empresa and pg.estado = 'activo'), 0)
    ) into v_saldo;
    if v_monto_app > v_saldo then
      raise exception 'El monto aplicado supera el saldo del documento (saldo: $%)', v_saldo;
    end if;

    insert into pagos_proveedor_aplicaciones (empresa_id, pago_id, documento_id, monto)
    values (p_empresa, v_pago, v_doc.id, v_monto_app);
    v_suma := v_suma + v_monto_app;
  end loop;

  if v_suma <> p_monto then
    raise exception 'La suma de las aplicaciones debe ser igual al monto del pago';
  end if;

  return v_pago;
end $$;
revoke execute on function public.registrar_pago_proveedor(uuid, uuid, date, text, integer, text, text, jsonb) from anon, public;
grant execute on function public.registrar_pago_proveedor(uuid, uuid, date, text, integer, text, text, jsonb) to authenticated;

-- ---------- Anular pago a proveedor ----------
create or replace function public.anular_pago_proveedor(p_empresa uuid, p_pago uuid, p_motivo text)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin']) then
    raise exception 'Tu rol no permite anular pagos a proveedores';
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'La anulación requiere un motivo';
  end if;
  update pagos_proveedor set estado = 'anulado', motivo_anulacion = trim(p_motivo)
  where id = p_pago and empresa_id = p_empresa and estado = 'activo';
  if not found then
    raise exception 'El pago no existe o ya está anulado';
  end if;
end $$;
revoke execute on function public.anular_pago_proveedor(uuid, uuid, text) from anon, public;
grant execute on function public.anular_pago_proveedor(uuid, uuid, text) to authenticated;

-- ---------- Anular factura de compra (bloqueada si tiene pagos activos) ----------
create or replace function public.anular_documento_compra(p_empresa uuid, p_documento uuid, p_motivo text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_estado text;
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin']) then
    raise exception 'Tu rol no permite anular facturas de compra';
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'La anulación requiere un motivo';
  end if;

  -- Lock: una anulacion no puede cruzarse con un pago en vuelo sobre el mismo documento.
  select estado into v_estado from documentos_compra
  where id = p_documento and empresa_id = p_empresa
  for update;
  if not found or v_estado <> 'activa' then
    raise exception 'La factura no existe o ya está anulada';
  end if;
  if exists (
    select 1 from pagos_proveedor_aplicaciones a
    join pagos_proveedor pg on pg.id = a.pago_id and pg.empresa_id = a.empresa_id
    where a.documento_id = p_documento and a.empresa_id = p_empresa and pg.estado = 'activo'
  ) then
    raise exception 'La factura tiene pagos aplicados; anula primero esos pagos';
  end if;

  update documentos_compra set estado = 'anulada', motivo_anulacion = trim(p_motivo)
  where id = p_documento;
end $$;
revoke execute on function public.anular_documento_compra(uuid, uuid, text) from anon, public;
grant execute on function public.anular_documento_compra(uuid, uuid, text) to authenticated;
