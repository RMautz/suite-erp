-- Cotizaciones: paso comercial previo a la venta. Correlativo por empresa
-- (advisory lock, patron ordenes_compra), precios negociables por linea,
-- maquina de estados validada en RPC y conversion a nota de venta en borrador
-- con los precios COTIZADOS. Sin folio SII: el folio se toma al emitir.

-- ---------- Cotizaciones (cabecera) ----------
create table public.cotizaciones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  numero integer not null,
  cliente_id uuid not null,
  -- SIN check contra la fecha de creacion: la validacion vive solo en la RPC,
  -- asi los fixtures de test pueden backdatear via service_role/superuser.
  fecha_validez date not null,
  notas text,
  neto integer not null default 0 check (neto >= 0),
  exento integer not null default 0 check (exento >= 0),
  iva integer not null default 0 check (iva >= 0),
  total integer not null default 0 check (total >= 0 and total = neto + exento + iva),
  estado text not null default 'borrador'
    check (estado in ('borrador', 'enviada', 'aceptada', 'rechazada', 'convertida')),
  motivo_rechazo text,
  documento_venta_id uuid,
  creado_en timestamptz not null default now(),
  unique (empresa_id, numero),
  unique (empresa_id, id),
  foreign key (empresa_id, cliente_id) references public.clientes (empresa_id, id),
  -- Nota de venta generada por la conversion (nullable hasta convertir).
  foreign key (empresa_id, documento_venta_id) references public.documentos_venta (empresa_id, id)
);
create index cotizaciones_lista_idx on public.cotizaciones (empresa_id, estado, creado_en desc);

-- ---------- Lineas (precio COTIZADO, negociado por el vendedor) ----------
create table public.cotizaciones_lineas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  cotizacion_id uuid not null,
  producto_id uuid not null,
  descripcion text not null,
  cantidad integer not null check (cantidad > 0),
  precio_neto integer not null check (precio_neto >= 0),
  exenta boolean not null default false,
  subtotal integer not null check (subtotal >= 0),
  foreign key (empresa_id, cotizacion_id) references public.cotizaciones (empresa_id, id) on delete cascade,
  foreign key (empresa_id, producto_id) references public.productos (empresa_id, id)
);
create index cotizaciones_lineas_cotizacion_idx on public.cotizaciones_lineas (empresa_id, cotizacion_id);

-- ---------- RLS ----------
alter table public.cotizaciones enable row level security;
alter table public.cotizaciones_lineas enable row level security;

create policy "miembros ven cotizaciones" on public.cotizaciones
  for select to authenticated using (empresa_id in (select app.mis_empresas()));
create policy "miembros ven lineas de cotizacion" on public.cotizaciones_lineas
  for select to authenticated using (empresa_id in (select app.mis_empresas()));

-- ---------- Grants Data API (leccion Plan 1) ----------
-- CERO escritura directa de authenticated: toda escritura entra por RPC.
grant select on public.cotizaciones, public.cotizaciones_lineas to authenticated;
grant select, insert, update, delete on public.cotizaciones, public.cotizaciones_lineas to service_role;

-- ---------- Crear cotizacion (numeracion correlativa atomica) ----------
-- descripcion y exenta vienen DEL PRODUCTO (fuente de verdad tributaria);
-- el precio_neto viene del llamador: es la unica diferencia deliberada con
-- crear_documento_venta (precio negociable por linea).
create or replace function public.crear_cotizacion(
  p_empresa uuid, p_cliente uuid, p_validez date, p_notas text, p_lineas jsonb
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_cotizacion uuid;
  v_numero integer;
  v_neto integer := 0;
  v_exento integer := 0;
  v_iva integer;
  v_linea jsonb;
  v_nombre text;
  v_exenta boolean;
  v_cant integer;
  v_precio integer;
  v_sub integer;
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'vendedor']) then
    raise exception 'Tu rol no permite crear cotizaciones';
  end if;
  -- Cubre inexistente, ajeno e inactivo con el mismo mensaje.
  if not exists (select 1 from clientes where id = p_cliente and empresa_id = p_empresa and activo) then
    raise exception 'Cliente no válido';
  end if;
  -- El default hoy+30 lo pone la UI; la RPC no lo suple.
  if p_validez is null or p_validez < current_date then
    raise exception 'La fecha de validez no puede ser anterior a hoy';
  end if;
  if p_lineas is null or jsonb_array_length(p_lineas) = 0 then
    raise exception 'La cotización necesita al menos una línea';
  end if;

  -- Serializa la numeracion por empresa (dos creaciones concurrentes no chocan el unique).
  perform pg_advisory_xact_lock(hashtextextended('cotizaciones:' || p_empresa::text, 42));
  select coalesce(max(numero), 0) + 1 into v_numero from cotizaciones where empresa_id = p_empresa;

  insert into cotizaciones (empresa_id, numero, cliente_id, fecha_validez, notas)
  values (p_empresa, v_numero, p_cliente, p_validez, nullif(trim(coalesce(p_notas, '')), ''))
  returning id into v_cotizacion;

  for v_linea in select * from jsonb_array_elements(p_lineas) loop
    select nombre, exento into v_nombre, v_exenta
    from productos
    where id = (v_linea->>'productoId')::uuid and empresa_id = p_empresa and activo;
    if not found then
      raise exception 'Producto no válido';
    end if;
    v_cant := (v_linea->>'cantidad')::integer;
    v_precio := (v_linea->>'precioNeto')::integer;
    if v_cant is null or v_cant < 1 then
      raise exception 'La cantidad debe ser al menos 1';
    end if;
    if v_precio is null or v_precio < 0 then
      raise exception 'El precio debe ser un entero mayor o igual a 0';
    end if;
    v_sub := round(v_cant * v_precio);
    insert into cotizaciones_lineas (empresa_id, cotizacion_id, producto_id, descripcion, cantidad, precio_neto, exenta, subtotal)
    values (p_empresa, v_cotizacion, (v_linea->>'productoId')::uuid, v_nombre, v_cant, v_precio, v_exenta, v_sub);
    if v_exenta then v_exento := v_exento + v_sub; else v_neto := v_neto + v_sub; end if;
  end loop;

  -- Mismo criterio y redondeo que crear_documento_venta.
  v_iva := round(v_neto * 0.19);
  update cotizaciones set neto = v_neto, exento = v_exento, iva = v_iva, total = v_neto + v_exento + v_iva
  where id = v_cotizacion and empresa_id = p_empresa;

  return v_cotizacion;
end $$;
revoke execute on function public.crear_cotizacion(uuid, uuid, date, text, jsonb) from anon, public;
grant execute on function public.crear_cotizacion(uuid, uuid, date, text, jsonb) to authenticated;

-- ---------- Cambiar estado (maquina de estados; 'convertida' vetada aqui) ----------
create or replace function public.cambiar_estado_cotizacion(
  p_empresa uuid, p_cotizacion uuid, p_estado text, p_motivo text default null
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_actual text;
  v_validez date;
  v_motivo text;
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'vendedor']) then
    raise exception 'Tu rol no permite gestionar cotizaciones';
  end if;

  -- Lock: una transicion no se cruza con una conversion en vuelo.
  select estado, fecha_validez into v_actual, v_validez
  from cotizaciones where id = p_cotizacion and empresa_id = p_empresa
  for update;
  if not found then
    -- Cubre por igual inexistente y de-otro-tenant, sin distinguirlos.
    raise exception 'La cotización no existe';
  end if;

  -- borrador -> enviada | rechazada; enviada -> aceptada | rechazada.
  -- 'convertida' SOLO via convertir_cotizacion; todo lo demas es invalido.
  if p_estado is null or not (
    (v_actual = 'borrador' and p_estado in ('enviada', 'rechazada')) or
    (v_actual = 'enviada' and p_estado in ('aceptada', 'rechazada'))
  ) then
    raise exception 'Transición de estado no válida';
  end if;

  -- Aceptar exige vigencia (una vez aceptada, el trato queda congelado).
  if p_estado = 'aceptada' and v_validez < current_date then
    raise exception 'La cotización está vencida';
  end if;

  v_motivo := nullif(trim(coalesce(p_motivo, '')), '');
  if p_estado = 'rechazada' and v_motivo is null then
    raise exception 'El rechazo requiere un motivo';
  end if;

  update cotizaciones
  set estado = p_estado,
      -- p_motivo solo se persiste al rechazar; en el resto queda null.
      motivo_rechazo = case when p_estado = 'rechazada' then v_motivo else null end
  where id = p_cotizacion and empresa_id = p_empresa;
end $$;
revoke execute on function public.cambiar_estado_cotizacion(uuid, uuid, text, text) from anon, public;
grant execute on function public.cambiar_estado_cotizacion(uuid, uuid, text, text) to authenticated;

-- ---------- Convertir a nota de venta (atomica; sin condicion de fecha) ----------
create or replace function public.convertir_cotizacion(p_empresa uuid, p_cotizacion uuid)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_cot record;
  v_doc uuid;
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'vendedor']) then
    raise exception 'Tu rol no permite convertir cotizaciones';
  end if;

  -- Lock: el check de estado corre DENTRO del lock (doble conversion imposible).
  select estado, cliente_id, neto, exento, iva, total into v_cot
  from cotizaciones where id = p_cotizacion and empresa_id = p_empresa
  for update;
  if not found then
    raise exception 'La cotización no existe';
  end if;
  if v_cot.estado <> 'aceptada' then
    raise exception 'Solo se puede convertir una cotización aceptada';
  end if;

  -- Re-validacion tributaria por linea: el producto sigue activo y su exencion
  -- no cambio desde que se cotizo (la exencion NO es negociable).
  if exists (
    select 1 from cotizaciones_lineas l
    where l.cotizacion_id = p_cotizacion and l.empresa_id = p_empresa
      and not exists (
        select 1 from productos p
        where p.id = l.producto_id and p.empresa_id = l.empresa_id
          and p.activo and p.exento = l.exenta
      )
  ) then
    raise exception 'Un producto de la cotización ya no está disponible o cambió su condición de IVA; crea una nueva cotización';
  end if;

  -- Nota de venta en borrador con los totales COTIZADOS. Sin folio ni folios_caf:
  -- el folio se toma al emitir (tomar_folio), igual que crear_documento_venta.
  -- Las notas de la cotizacion NO viajan (documentos_venta no tiene esa columna).
  insert into documentos_venta (empresa_id, tipo, cliente_id, estado, neto, exento, iva, total)
  values (p_empresa, 'nota_venta', v_cot.cliente_id, 'borrador', v_cot.neto, v_cot.exento, v_cot.iva, v_cot.total)
  returning id into v_doc;

  insert into documentos_venta_lineas (empresa_id, documento_id, producto_id, descripcion, cantidad, precio_neto, exenta, subtotal)
  select l.empresa_id, v_doc, l.producto_id, l.descripcion, l.cantidad, l.precio_neto, l.exenta, l.subtotal
  from cotizaciones_lineas l
  where l.cotizacion_id = p_cotizacion and l.empresa_id = p_empresa;

  update cotizaciones set estado = 'convertida', documento_venta_id = v_doc
  where id = p_cotizacion and empresa_id = p_empresa;

  return v_doc;
end $$;
revoke execute on function public.convertir_cotizacion(uuid, uuid) from anon, public;
grant execute on function public.convertir_cotizacion(uuid, uuid) to authenticated;
