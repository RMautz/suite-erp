-- Maestros del ERP: categorías, productos y clientes (multi-tenant por empresa).

-- ---------- Helpers de autorización a nivel empresa ----------

create or replace function app.mis_empresas()
returns setof uuid
language sql stable security definer
set search_path = public
as $$
  select e.id
  from empresas e
  join miembros m on m.organizacion_id = e.organizacion_id
  where m.usuario_id = auth.uid() and m.estado = 'activo'
$$;

create or replace function app.tiene_rol_en_empresa(emp uuid, roles text[])
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from empresas e
    join miembros m on m.organizacion_id = e.organizacion_id
    where e.id = emp
      and m.usuario_id = auth.uid()
      and m.estado = 'activo'
      and m.rol = any (roles)
  )
$$;

-- ---------- Tablas ----------

create table public.categorias_producto (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  nombre text not null,
  creado_en timestamptz not null default now(),
  unique (empresa_id, nombre),
  unique (empresa_id, id)
);

create table public.productos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  categoria_id uuid,
  sku text not null,
  nombre text not null,
  descripcion text,
  codigo_barras text,
  unidad text not null default 'UN',
  precio_neto integer not null check (precio_neto >= 0),
  exento boolean not null default false,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  unique (empresa_id, sku),
  foreign key (empresa_id, categoria_id) references public.categorias_producto (empresa_id, id)
);

create index productos_nombre_idx on public.productos (empresa_id, nombre);
create index productos_codigo_barras_idx on public.productos (empresa_id, codigo_barras);
create index productos_categoria_idx on public.productos (empresa_id, categoria_id);

create table public.clientes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  -- Última línea de defensa: normalizado y con DV correcto también en la BD.
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
  unique (empresa_id, rut)
);

create index clientes_razon_social_idx on public.clientes (empresa_id, razon_social);

-- ---------- RLS ----------

alter table public.categorias_producto enable row level security;
alter table public.productos enable row level security;
alter table public.clientes enable row level security;

create policy "miembros ven categorias" on public.categorias_producto
  for select to authenticated
  using (empresa_id in (select app.mis_empresas()));

create policy "duenos crean categorias" on public.categorias_producto
  for insert to authenticated
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']));

create policy "duenos editan categorias" on public.categorias_producto
  for update to authenticated
  using (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']))
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']));

create policy "miembros ven productos" on public.productos
  for select to authenticated
  using (empresa_id in (select app.mis_empresas()));

create policy "duenos crean productos" on public.productos
  for insert to authenticated
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']));

create policy "duenos editan productos" on public.productos
  for update to authenticated
  using (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']))
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']));

create policy "miembros ven clientes" on public.clientes
  for select to authenticated
  using (empresa_id in (select app.mis_empresas()));

create policy "vendedores crean clientes" on public.clientes
  for insert to authenticated
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin', 'vendedor']));

create policy "vendedores editan clientes" on public.clientes
  for update to authenticated
  using (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin', 'vendedor']))
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin', 'vendedor']));

-- ---------- Grants Data API (lección Plan 1: sin esto todo da 42501) ----------

grant select, insert, update on public.categorias_producto, public.productos, public.clientes to authenticated;
grant select, insert, update, delete on public.categorias_producto, public.productos, public.clientes to service_role;
