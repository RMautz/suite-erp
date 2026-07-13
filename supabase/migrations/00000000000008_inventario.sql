-- Inventario: bodegas, proveedores, movimientos de stock inmutables y stock actual.

-- ---------- productos: stock mínimo ----------
alter table public.productos add column if not exists stock_minimo integer not null default 0 check (stock_minimo >= 0);

-- ---------- Bodegas ----------
create table public.bodegas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  nombre text not null,
  direccion text,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  unique (empresa_id, nombre),
  unique (empresa_id, id)
);

-- ---------- Proveedores (espejo de clientes) ----------
create table public.proveedores (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  rut text not null check (rut = app.normalizar_rut(rut) and app.validar_rut(rut)),
  razon_social text not null,
  giro text,
  email text,
  telefono text,
  direccion text,
  comuna text,
  condicion_pago_dias integer not null default 0 check (condicion_pago_dias between 0 and 120),
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  unique (empresa_id, rut),
  unique (empresa_id, id)
);
create index proveedores_razon_social_idx on public.proveedores (empresa_id, razon_social);

-- ---------- Movimientos de stock (libro inmutable, cantidad con signo) ----------
create table public.movimientos_stock (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  producto_id uuid not null,
  bodega_id uuid not null,
  tipo text not null check (tipo in ('entrada', 'salida', 'ajuste', 'traslado')),
  cantidad integer not null check (cantidad <> 0),
  motivo text,
  proveedor_id uuid,
  referencia_documento_id uuid,
  creado_en timestamptz not null default now(),
  foreign key (empresa_id, producto_id) references public.productos (empresa_id, id),
  foreign key (empresa_id, bodega_id) references public.bodegas (empresa_id, id),
  foreign key (empresa_id, proveedor_id) references public.proveedores (empresa_id, id),
  foreign key (empresa_id, referencia_documento_id) references public.documentos_venta (empresa_id, id)
);
create index movimientos_stock_agg_idx on public.movimientos_stock (empresa_id, producto_id, bodega_id);
create index movimientos_stock_ref_idx on public.movimientos_stock (empresa_id, referencia_documento_id);

-- ---------- Vista de stock actual (security_invoker: la RLS del libro aplica al usuario) ----------
create view public.stock_actual with (security_invoker = true) as
  select empresa_id, producto_id, bodega_id, sum(cantidad)::integer as cantidad
  from public.movimientos_stock
  group by empresa_id, producto_id, bodega_id;

-- ---------- RLS ----------
alter table public.bodegas enable row level security;
alter table public.proveedores enable row level security;
alter table public.movimientos_stock enable row level security;

-- bodegas: ver miembros; crear/editar dueno/admin/bodeguero.
create policy "miembros ven bodegas" on public.bodegas
  for select to authenticated using (empresa_id in (select app.mis_empresas()));
create policy "bodegueros crean bodegas" on public.bodegas
  for insert to authenticated
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin', 'bodeguero']));
create policy "bodegueros editan bodegas" on public.bodegas
  for update to authenticated
  using (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin', 'bodeguero']))
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin', 'bodeguero']));

-- proveedores: ver miembros; crear/editar dueno/admin.
create policy "miembros ven proveedores" on public.proveedores
  for select to authenticated using (empresa_id in (select app.mis_empresas()));
create policy "duenos crean proveedores" on public.proveedores
  for insert to authenticated
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']));
create policy "duenos editan proveedores" on public.proveedores
  for update to authenticated
  using (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']))
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']));

-- movimientos: ver miembros; solo insert (inmutable). Escritura vía RPC/service_role.
create policy "miembros ven movimientos" on public.movimientos_stock
  for select to authenticated using (empresa_id in (select app.mis_empresas()));

-- ---------- Grants Data API (lección Plan 1) ----------
grant select, insert, update on public.bodegas, public.proveedores to authenticated;
grant select on public.movimientos_stock to authenticated;
grant select on public.stock_actual to authenticated;
grant select, insert, update, delete on public.bodegas, public.proveedores, public.movimientos_stock to service_role;

-- ---------- Bodega por defecto ----------
create or replace function public.bodega_por_defecto(p_empresa uuid)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_bodega uuid;
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'bodeguero', 'vendedor', 'contador']) then
    raise exception 'No perteneces a esta empresa';
  end if;
  select id into v_bodega from bodegas where empresa_id = p_empresa and activo order by creado_en limit 1;
  if v_bodega is null then
    insert into bodegas (empresa_id, nombre) values (p_empresa, 'Bodega Principal') returning id into v_bodega;
  end if;
  return v_bodega;
end $$;
revoke execute on function public.bodega_por_defecto(uuid) from anon, public;
grant execute on function public.bodega_por_defecto(uuid) to authenticated;

-- ---------- RPCs de movimientos (security definer, validan rol y pertenencia) ----------
create or replace function public.registrar_entrada(
  p_empresa uuid, p_producto uuid, p_bodega uuid, p_cantidad integer, p_proveedor uuid, p_motivo text
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'bodeguero']) then
    raise exception 'Tu rol no permite registrar movimientos de stock';
  end if;
  if p_cantidad <= 0 then raise exception 'La cantidad debe ser mayor a 0'; end if;
  insert into movimientos_stock (empresa_id, producto_id, bodega_id, tipo, cantidad, motivo, proveedor_id)
  values (p_empresa, p_producto, p_bodega, 'entrada', p_cantidad, p_motivo, p_proveedor)
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.registrar_entrada(uuid, uuid, uuid, integer, uuid, text) from anon, public;
grant execute on function public.registrar_entrada(uuid, uuid, uuid, integer, uuid, text) to authenticated;

create or replace function public.registrar_ajuste(
  p_empresa uuid, p_producto uuid, p_bodega uuid, p_cantidad integer, p_motivo text
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'bodeguero']) then
    raise exception 'Tu rol no permite ajustar stock';
  end if;
  if p_cantidad = 0 then raise exception 'El ajuste no puede ser 0'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'El ajuste requiere un motivo'; end if;
  insert into movimientos_stock (empresa_id, producto_id, bodega_id, tipo, cantidad, motivo)
  values (p_empresa, p_producto, p_bodega, 'ajuste', p_cantidad, p_motivo)
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.registrar_ajuste(uuid, uuid, uuid, integer, text) from anon, public;
grant execute on function public.registrar_ajuste(uuid, uuid, uuid, integer, text) to authenticated;

create or replace function public.registrar_traslado(
  p_empresa uuid, p_producto uuid, p_origen uuid, p_destino uuid, p_cantidad integer
)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'bodeguero']) then
    raise exception 'Tu rol no permite trasladar stock';
  end if;
  if p_cantidad <= 0 then raise exception 'La cantidad debe ser mayor a 0'; end if;
  if p_origen = p_destino then raise exception 'La bodega de origen y destino deben ser distintas'; end if;
  insert into movimientos_stock (empresa_id, producto_id, bodega_id, tipo, cantidad, motivo)
  values (p_empresa, p_producto, p_origen, 'traslado', -p_cantidad, 'Traslado'),
         (p_empresa, p_producto, p_destino, 'traslado', p_cantidad, 'Traslado');
end $$;
revoke execute on function public.registrar_traslado(uuid, uuid, uuid, uuid, integer) from anon, public;
grant execute on function public.registrar_traslado(uuid, uuid, uuid, uuid, integer) to authenticated;
