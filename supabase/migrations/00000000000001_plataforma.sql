-- Esquema de plataforma SaaS: organizaciones clientes, planes, membresías.
create schema if not exists app;
-- Sin este grant, toda política que llame funciones de app falla con
-- "permission denied for schema app".
grant usage on schema app to anon, authenticated;

-- ---------- Tablas ----------

create table public.planes (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  precio_clp integer not null check (precio_clp >= 0),
  modulos text[] not null default '{erp}',
  limites jsonb not null default '{}',
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);

create table public.organizaciones (
  id uuid primary key default gen_random_uuid(),
  rut text not null unique,
  razon_social text not null,
  plan_id uuid references public.planes (id),
  estado text not null default 'trial' check (estado in ('trial', 'activa', 'suspendida')),
  trial_hasta date not null default (current_date + 14),
  creado_en timestamptz not null default now()
);

create table public.suscripciones (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id),
  plan_id uuid not null references public.planes (id),
  desde date not null default current_date,
  hasta date,
  creado_en timestamptz not null default now()
);

create table public.empresas (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id),
  rut text not null,
  razon_social text not null,
  giro text,
  direccion text,
  comuna text,
  creado_en timestamptz not null default now(),
  unique (organizacion_id, rut)
);

create table public.miembros (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users (id),
  organizacion_id uuid not null references public.organizaciones (id),
  rol text not null check (rol in ('dueno', 'admin', 'vendedor', 'contador', 'bodeguero')),
  estado text not null default 'activo' check (estado in ('activo', 'suspendido')),
  creado_en timestamptz not null default now(),
  unique (usuario_id, organizacion_id)
);

-- ---------- Funciones de autorización ----------
-- security definer (owner postgres) para evitar recursión de RLS sobre miembros.

create or replace function app.mis_organizaciones()
returns setof uuid
language sql stable security definer
set search_path = public
as $$
  select organizacion_id from miembros
  where usuario_id = auth.uid() and estado = 'activo'
$$;

create or replace function app.tiene_rol(org uuid, roles text[])
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from miembros
    where usuario_id = auth.uid()
      and organizacion_id = org
      and estado = 'activo'
      and rol = any (roles)
  )
$$;

-- ---------- RLS ----------

alter table public.planes enable row level security;
alter table public.organizaciones enable row level security;
alter table public.suscripciones enable row level security;
alter table public.empresas enable row level security;
alter table public.miembros enable row level security;

-- Catálogo de planes: visible para todos (página de precios pública).
create policy "planes visibles" on public.planes
  for select to anon, authenticated using (activo);

-- Organizaciones: solo miembros activos las ven. Cambios de estado/plan: solo service_role.
create policy "miembros ven su organizacion" on public.organizaciones
  for select to authenticated
  using (id in (select app.mis_organizaciones()));

-- Suscripciones: solo dueno/admin de la organización.
create policy "duenos ven suscripciones" on public.suscripciones
  for select to authenticated
  using (app.tiene_rol(organizacion_id, array['dueno', 'admin']));

-- Empresas: miembros ven; dueno/admin crean y editan.
create policy "miembros ven empresas" on public.empresas
  for select to authenticated
  using (organizacion_id in (select app.mis_organizaciones()));

create policy "duenos crean empresas" on public.empresas
  for insert to authenticated
  with check (app.tiene_rol(organizacion_id, array['dueno', 'admin']));

create policy "duenos editan empresas" on public.empresas
  for update to authenticated
  using (app.tiene_rol(organizacion_id, array['dueno', 'admin']))
  with check (app.tiene_rol(organizacion_id, array['dueno', 'admin']));

-- Miembros: los miembros ven la lista de su organización.
create policy "miembros ven miembros" on public.miembros
  for select to authenticated
  using (organizacion_id in (select app.mis_organizaciones()));

-- ---------- Grants Data API ----------
-- Supabase ya no expone tablas nuevas a los roles del Data API sin GRANT
-- explícito. RLS sigue siendo el filtro por fila; esto es el permiso a nivel
-- de tabla, espejando las operaciones que las políticas permiten.

grant select on public.planes to anon, authenticated;
grant select on public.organizaciones to authenticated;
grant select on public.suscripciones to authenticated;
grant select, insert, update on public.empresas to authenticated;
grant select on public.miembros to authenticated;

-- El panel Admin opera vía service_role (solo servidor).
grant select, insert, update, delete on all tables in schema public to service_role;

-- ---------- Seed de planes (valores editables desde Admin en planes futuros) ----------

insert into public.planes (nombre, precio_clp, modulos, limites) values
  ('Básico',  29990, '{erp}',                      '{"usuarios": 3,  "documentos_mes": 100,  "bodegas": 1}'),
  ('Pro',     49990, '{erp,conta}',                '{"usuarios": 10, "documentos_mes": 1000, "bodegas": 3}'),
  ('Empresa', 89990, '{erp,conta,rrhh,pos,crm}',   '{"usuarios": 50, "documentos_mes": 10000, "bodegas": 10}')
on conflict (nombre) do nothing;
