-- Ventas y facturación electrónica (DTE). Multi-tenant por empresa.

-- ---------- Prerrequisito: unique compuesto para las FK por tenant ----------
-- Postgres exige que las columnas referenciadas por una FK compuesta tengan un
-- unique/PK que las cubra exactamente. clientes/productos solo tienen unique
-- (empresa_id, rut/sku); agregamos (empresa_id, id) para las FK de esta migración.
alter table public.clientes add constraint clientes_empresa_id_key unique (empresa_id, id);
alter table public.productos add constraint productos_empresa_id_key unique (empresa_id, id);

-- ---------- Datos del emisor y certificado cifrado en empresas ----------
alter table public.empresas
  add column if not exists giro_emisor text,
  add column if not exists direccion_emisor text,
  add column if not exists comuna_emisor text,
  add column if not exists resolucion_sii_numero integer,
  add column if not exists resolucion_sii_fecha date,
  -- Certificado .pfx cifrado (AES-256-GCM, formato iv.tag.ct base64) y su password cifrada.
  add column if not exists certificado_cifrado text,
  add column if not exists certificado_password_cifrada text,
  add column if not exists dte_api_key_cifrada text;

-- ---------- Folios CAF ----------
create table public.folios_caf (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  tipo_documento text not null check (tipo_documento in ('factura', 'boleta', 'nota_credito')),
  desde integer not null check (desde >= 1),
  hasta integer not null check (hasta >= desde),
  siguiente integer not null,
  xml_caf text not null,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  unique (empresa_id, id),
  check (siguiente between desde and hasta + 1)
);
create index folios_caf_lookup_idx on public.folios_caf (empresa_id, tipo_documento, activo);

-- ---------- Documentos de venta (cabecera) ----------
create table public.documentos_venta (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  tipo text not null check (tipo in ('nota_venta', 'factura', 'boleta', 'nota_credito')),
  cliente_id uuid not null,
  folio integer,
  estado text not null default 'borrador'
    check (estado in ('borrador', 'pendiente_envio', 'emitido', 'rechazado')),
  neto integer not null default 0 check (neto >= 0),
  exento integer not null default 0 check (exento >= 0),
  iva integer not null default 0 check (iva >= 0),
  total integer not null default 0 check (total >= 0),
  track_id text,
  xml_timbrado text,
  pdf_ruta text,
  documento_referencia_id uuid,
  razon_anulacion text,
  error_emision text,
  intentos integer not null default 0,
  creado_en timestamptz not null default now(),
  emitido_en timestamptz,
  unique (empresa_id, id),
  -- FK compuesta por tenant al cliente (convención Plan 2)
  foreign key (empresa_id, cliente_id) references public.clientes (empresa_id, id),
  -- Auto-referencia por tenant para la nota de crédito
  foreign key (empresa_id, documento_referencia_id) references public.documentos_venta (empresa_id, id)
);
create index documentos_venta_lista_idx on public.documentos_venta (empresa_id, estado, creado_en desc);

-- ---------- Líneas de documento ----------
create table public.documentos_venta_lineas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  documento_id uuid not null,
  producto_id uuid,
  descripcion text not null,
  cantidad integer not null check (cantidad > 0),
  precio_neto integer not null check (precio_neto >= 0),
  exenta boolean not null default false,
  subtotal integer not null check (subtotal >= 0),
  foreign key (empresa_id, documento_id) references public.documentos_venta (empresa_id, id) on delete cascade,
  foreign key (empresa_id, producto_id) references public.productos (empresa_id, id)
);
create index documentos_venta_lineas_doc_idx on public.documentos_venta_lineas (empresa_id, documento_id);

-- ---------- Reserva atómica de folio ----------
create or replace function public.tomar_folio(p_empresa uuid, p_tipo text)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  v_folio integer;
  v_caf_id uuid;
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'vendedor']) then
    raise exception 'No tienes permiso para emitir documentos en esta empresa';
  end if;

  -- Bloquea el CAF vigente y toma el siguiente folio si queda rango.
  select id, siguiente into v_caf_id, v_folio
  from folios_caf
  where empresa_id = p_empresa and tipo_documento = p_tipo and activo and siguiente <= hasta
  order by desde
  limit 1
  for update;

  if v_caf_id is null then
    raise exception 'No hay folios CAF disponibles para el tipo %; carga un CAF en Configuración', p_tipo;
  end if;

  update folios_caf set siguiente = siguiente + 1 where id = v_caf_id;
  return v_folio;
end $$;

revoke execute on function public.tomar_folio(uuid, text) from anon, public;
grant execute on function public.tomar_folio(uuid, text) to authenticated;

-- ---------- RLS ----------
alter table public.folios_caf enable row level security;
alter table public.documentos_venta enable row level security;
alter table public.documentos_venta_lineas enable row level security;

-- folios_caf: ver miembros; cargar/editar solo dueno/admin.
create policy "miembros ven folios" on public.folios_caf
  for select to authenticated using (empresa_id in (select app.mis_empresas()));
create policy "duenos cargan folios" on public.folios_caf
  for insert to authenticated
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']));
create policy "duenos editan folios" on public.folios_caf
  for update to authenticated
  using (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']))
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']));

-- documentos_venta: ver miembros; crear/editar vendedor+; sin delete (baja lógica vía estado).
create policy "miembros ven documentos" on public.documentos_venta
  for select to authenticated using (empresa_id in (select app.mis_empresas()));
create policy "vendedores crean documentos" on public.documentos_venta
  for insert to authenticated
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin', 'vendedor']));
create policy "vendedores editan documentos" on public.documentos_venta
  for update to authenticated
  using (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin', 'vendedor']))
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin', 'vendedor']));

-- líneas: heredan del documento.
create policy "miembros ven lineas" on public.documentos_venta_lineas
  for select to authenticated using (empresa_id in (select app.mis_empresas()));
create policy "vendedores crean lineas" on public.documentos_venta_lineas
  for insert to authenticated
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin', 'vendedor']));
create policy "vendedores editan lineas" on public.documentos_venta_lineas
  for update to authenticated
  using (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin', 'vendedor']))
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin', 'vendedor']));

-- ---------- Grants Data API (lección Plan 1) ----------
grant select, insert, update on public.folios_caf, public.documentos_venta, public.documentos_venta_lineas to authenticated;
grant select, insert, update, delete on public.folios_caf, public.documentos_venta, public.documentos_venta_lineas to service_role;
