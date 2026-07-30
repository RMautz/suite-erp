-- Compras: ordenes de compra, recepciones parciales y hardening TOCTOU de ventas.

-- ---------- Ordenes de compra ----------
create table public.ordenes_compra (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  numero integer not null,
  proveedor_id uuid not null,
  estado text not null default 'borrador'
    check (estado in ('borrador', 'enviada', 'recibida_parcial', 'recibida_total', 'cancelada')),
  notas text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  unique (empresa_id, numero),
  unique (empresa_id, id),
  foreign key (empresa_id, proveedor_id) references public.proveedores (empresa_id, id)
);
create index ordenes_compra_estado_idx on public.ordenes_compra (empresa_id, estado);

create table public.ordenes_compra_lineas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  orden_id uuid not null,
  producto_id uuid not null,
  descripcion text not null,
  cantidad_pedida integer not null check (cantidad_pedida > 0),
  costo_unitario integer not null check (costo_unitario >= 0),
  cantidad_recibida integer not null default 0
    check (cantidad_recibida >= 0 and cantidad_recibida <= cantidad_pedida),
  unique (empresa_id, id),
  foreign key (empresa_id, orden_id) references public.ordenes_compra (empresa_id, id),
  foreign key (empresa_id, producto_id) references public.productos (empresa_id, id)
);
create index ordenes_compra_lineas_orden_idx on public.ordenes_compra_lineas (empresa_id, orden_id);

-- ---------- Recepciones (una entrega física = un documento) ----------
create table public.recepciones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  orden_id uuid not null,
  bodega_id uuid not null,
  notas text,
  creado_en timestamptz not null default now(),
  unique (empresa_id, id),
  foreign key (empresa_id, orden_id) references public.ordenes_compra (empresa_id, id),
  foreign key (empresa_id, bodega_id) references public.bodegas (empresa_id, id)
);
create index recepciones_orden_idx on public.recepciones (empresa_id, orden_id);

create table public.recepciones_lineas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  recepcion_id uuid not null,
  orden_linea_id uuid not null,
  producto_id uuid not null,
  cantidad integer not null check (cantidad > 0),
  costo_unitario integer not null check (costo_unitario >= 0),
  unique (empresa_id, id),
  foreign key (empresa_id, recepcion_id) references public.recepciones (empresa_id, id),
  foreign key (empresa_id, orden_linea_id) references public.ordenes_compra_lineas (empresa_id, id),
  foreign key (empresa_id, producto_id) references public.productos (empresa_id, id)
);
create index recepciones_lineas_recepcion_idx on public.recepciones_lineas (empresa_id, recepcion_id);

-- ---------- Ledger: referencia a la recepción (espejo de referencia_documento_id) ----------
alter table public.movimientos_stock add column referencia_recepcion_id uuid;
alter table public.movimientos_stock
  add constraint movimientos_stock_recepcion_fk
  foreign key (empresa_id, referencia_recepcion_id) references public.recepciones (empresa_id, id);
create index movimientos_stock_recepcion_idx on public.movimientos_stock (empresa_id, referencia_recepcion_id);

-- ---------- RLS ----------
alter table public.ordenes_compra enable row level security;
alter table public.ordenes_compra_lineas enable row level security;
alter table public.recepciones enable row level security;
alter table public.recepciones_lineas enable row level security;

create policy "miembros ven ordenes" on public.ordenes_compra
  for select to authenticated using (empresa_id in (select app.mis_empresas()));
create policy "miembros ven lineas de orden" on public.ordenes_compra_lineas
  for select to authenticated using (empresa_id in (select app.mis_empresas()));
create policy "miembros ven recepciones" on public.recepciones
  for select to authenticated using (empresa_id in (select app.mis_empresas()));
create policy "miembros ven lineas de recepcion" on public.recepciones_lineas
  for select to authenticated using (empresa_id in (select app.mis_empresas()));

-- Transiciones simples (enviar/cancelar) por update directo, SOLO dueno/admin.
-- El grant de columnas (abajo) limita el update a (estado, actualizado_en).
-- Tolerancia v1 (spec §3): un dueno podria forzar un estado de su PROPIA empresa via API;
-- no cruza tenant y no crea stock (el stock solo entra por registrar_recepcion).
create policy "duenos transicionan ordenes" on public.ordenes_compra
  for update to authenticated
  using (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']))
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']));

-- ---------- Grants Data API (leccion Plan 1) ----------
grant select on public.ordenes_compra, public.ordenes_compra_lineas,
  public.recepciones, public.recepciones_lineas to authenticated;
grant update (estado, actualizado_en) on public.ordenes_compra to authenticated;
grant select, insert, update, delete on public.ordenes_compra, public.ordenes_compra_lineas,
  public.recepciones, public.recepciones_lineas to service_role;

-- ---------- Crear orden de compra (numeracion correlativa atomica) ----------
-- Descripcion y validaciones DEL PRODUCTO (fuente de verdad), como crear_documento_venta.
create or replace function public.crear_orden_compra(
  p_empresa uuid, p_proveedor uuid, p_lineas jsonb, p_notas text
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_orden uuid;
  v_numero integer;
  v_linea jsonb;
  v_nombre text;
  v_cant integer;
  v_costo integer;
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin']) then
    raise exception 'Tu rol no permite crear órdenes de compra';
  end if;
  if not exists (select 1 from proveedores where id = p_proveedor and empresa_id = p_empresa and activo) then
    raise exception 'Proveedor no encontrado en la empresa';
  end if;
  if p_lineas is null or jsonb_array_length(p_lineas) = 0 then
    raise exception 'La orden debe tener al menos una línea';
  end if;

  -- Serializa la numeracion por empresa (dos creaciones concurrentes no chocan el unique).
  perform pg_advisory_xact_lock(hashtextextended('ordenes_compra:' || p_empresa::text, 42));
  select coalesce(max(numero), 0) + 1 into v_numero from ordenes_compra where empresa_id = p_empresa;

  insert into ordenes_compra (empresa_id, numero, proveedor_id, notas)
  values (p_empresa, v_numero, p_proveedor, nullif(trim(coalesce(p_notas, '')), ''))
  returning id into v_orden;

  for v_linea in select * from jsonb_array_elements(p_lineas) loop
    select nombre into v_nombre
    from productos
    where id = (v_linea->>'productoId')::uuid and empresa_id = p_empresa and activo;
    if not found then
      raise exception 'Producto no encontrado o inactivo en la empresa';
    end if;
    v_cant := (v_linea->>'cantidad')::integer;
    v_costo := (v_linea->>'costoUnitario')::integer;
    if v_cant is null or v_cant < 1 then
      raise exception 'La cantidad debe ser al menos 1';
    end if;
    if v_costo is null or v_costo < 0 then
      raise exception 'El costo unitario no puede ser negativo';
    end if;
    insert into ordenes_compra_lineas (empresa_id, orden_id, producto_id, descripcion, cantidad_pedida, costo_unitario)
    values (p_empresa, v_orden, (v_linea->>'productoId')::uuid, v_nombre, v_cant, v_costo);
  end loop;

  return v_orden;
end $$;
revoke execute on function public.crear_orden_compra(uuid, uuid, jsonb, text) from anon, public;
grant execute on function public.crear_orden_compra(uuid, uuid, jsonb, text) to authenticated;

-- ---------- Registrar recepcion (atomica, serializada por for update) ----------
create or replace function public.registrar_recepcion(
  p_empresa uuid, p_orden uuid, p_bodega uuid, p_lineas jsonb, p_notas text
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_recepcion uuid;
  v_estado text;
  v_numero integer;
  v_proveedor uuid;
  v_linea jsonb;
  v_ol record;
  v_cant integer;
  v_pendiente integer;
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'bodeguero']) then
    raise exception 'Tu rol no permite recibir mercadería';
  end if;
  if p_lineas is null or jsonb_array_length(p_lineas) = 0 then
    raise exception 'La recepción debe tener al menos una línea';
  end if;

  -- Lock de la orden: dos recepciones concurrentes (o una recepcion vs una cancelacion)
  -- se serializan aqui; el estado se re-valida DESPUES de adquirir el lock.
  select estado, numero, proveedor_id into v_estado, v_numero, v_proveedor
  from ordenes_compra where id = p_orden and empresa_id = p_empresa
  for update;
  if not found then
    raise exception 'Orden no encontrada en la empresa';
  end if;
  if v_estado not in ('enviada', 'recibida_parcial') then
    raise exception 'La orden no está en un estado que permita recepción';
  end if;

  insert into recepciones (empresa_id, orden_id, bodega_id, notas)
  values (p_empresa, p_orden, p_bodega, nullif(trim(coalesce(p_notas, '')), ''))
  returning id into v_recepcion;

  for v_linea in select * from jsonb_array_elements(p_lineas) loop
    select id, producto_id, costo_unitario, cantidad_pedida, cantidad_recibida into v_ol
    from ordenes_compra_lineas
    where id = (v_linea->>'ordenLineaId')::uuid and orden_id = p_orden and empresa_id = p_empresa;
    if not found then
      raise exception 'Línea de la orden no encontrada';
    end if;
    v_cant := (v_linea->>'cantidad')::integer;
    if v_cant is null or v_cant < 1 then
      raise exception 'La cantidad debe ser al menos 1';
    end if;
    v_pendiente := v_ol.cantidad_pedida - v_ol.cantidad_recibida;
    if v_cant > v_pendiente then
      raise exception 'La cantidad recibida supera lo pendiente (pendiente: %)', v_pendiente;
    end if;

    insert into recepciones_lineas (empresa_id, recepcion_id, orden_linea_id, producto_id, cantidad, costo_unitario)
    values (p_empresa, v_recepcion, v_ol.id, v_ol.producto_id, v_cant, v_ol.costo_unitario);

    update ordenes_compra_lineas set cantidad_recibida = cantidad_recibida + v_cant where id = v_ol.id;

    insert into movimientos_stock (empresa_id, producto_id, bodega_id, tipo, cantidad, motivo, proveedor_id, referencia_recepcion_id)
    values (p_empresa, v_ol.producto_id, p_bodega, 'entrada', v_cant,
            'Recepción OC N° ' || v_numero, v_proveedor, v_recepcion);
  end loop;

  update ordenes_compra
  set estado = case
        when exists (select 1 from ordenes_compra_lineas where orden_id = p_orden and cantidad_recibida < cantidad_pedida)
        then 'recibida_parcial' else 'recibida_total' end,
      actualizado_en = now()
  where id = p_orden;

  return v_recepcion;
end $$;
revoke execute on function public.registrar_recepcion(uuid, uuid, uuid, jsonb, text) from anon, public;
grant execute on function public.registrar_recepcion(uuid, uuid, uuid, jsonb, text) to authenticated;

-- ---------- Hardening TOCTOU de ventas (review Plan 4): SOLO service_role ----------
-- Sin check de pertenencia: auth.uid() es null bajo service_role y el UNICO ejecutor
-- permitido es service_role (nuestro backend confiable) — el revoke ES la frontera.
create or replace function public.registrar_movimientos_documento(
  p_empresa uuid, p_documento uuid, p_lineas jsonb, p_signo integer, p_motivo text
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_bodega uuid;
  v_linea jsonb;
  v_prod uuid;
  v_cant integer;
begin
  if p_signo not in (1, -1) then
    raise exception 'El signo debe ser 1 o -1';
  end if;

  -- Serializa por documento: el check de idempotencia y los inserts corren dentro
  -- del lock — cierra el double-decrement de reintentos simultaneos (Plan 4).
  perform pg_advisory_xact_lock(hashtextextended(p_documento::text, 42));

  if exists (select 1 from movimientos_stock
             where empresa_id = p_empresa and referencia_documento_id = p_documento) then
    return; -- ya registrados (reintento)
  end if;

  select id into v_bodega from bodegas where empresa_id = p_empresa and activo order by creado_en limit 1;
  if v_bodega is null then
    insert into bodegas (empresa_id, nombre) values (p_empresa, 'Bodega Principal') returning id into v_bodega;
  end if;

  for v_linea in select * from jsonb_array_elements(coalesce(p_lineas, '[]'::jsonb)) loop
    v_prod := nullif(v_linea->>'productoId', '')::uuid;
    v_cant := (v_linea->>'cantidad')::integer;
    if v_prod is null or v_cant is null or v_cant = 0 then
      continue; -- linea sin producto (p.ej. la linea sintetica de una NC)
    end if;
    insert into movimientos_stock (empresa_id, producto_id, bodega_id, tipo, cantidad, motivo, referencia_documento_id)
    values (p_empresa, v_prod, v_bodega,
            case when p_signo < 0 then 'salida' else 'entrada' end,
            p_signo * abs(v_cant), p_motivo, p_documento);
  end loop;
end $$;
revoke execute on function public.registrar_movimientos_documento(uuid, uuid, jsonb, integer, text) from anon, authenticated, public;
grant execute on function public.registrar_movimientos_documento(uuid, uuid, jsonb, integer, text) to service_role;
