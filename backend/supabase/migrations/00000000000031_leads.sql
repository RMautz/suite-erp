-- Leads del chat de ventas de la landing (spec 2026-07-24): datos comerciales de la
-- PLATAFORMA. Nadie los lee por la Data API (RLS sin policies y sin grants API; el
-- panel admin usa service_role). Alta SOLO via RPC, abierta a anon porque el
-- visitante de la landing no tiene sesion.

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  numero bigint generated always as identity,
  nombre text not null,
  email text not null,
  telefono text,
  mensaje text,
  origen text not null default 'chat_web' check (origen in ('chat_web', 'otro')),
  creado_en timestamptz not null default now()
);

create unique index leads_numero_idx on public.leads (numero);
create index leads_creado_idx on public.leads (creado_en desc);

alter table public.leads enable row level security;

-- Sin policies y sin grants a anon/authenticated: cero lectura y cero escritura
-- directa desde la API. service_role (panel admin) mantiene todo.
grant select, insert, update, delete on public.leads to service_role;

-- ---------- Alta de lead (unico camino desde la API) ----------
create or replace function public.crear_lead(p_nombre text, p_email text, p_telefono text, p_mensaje text)
returns bigint
language plpgsql security definer
set search_path = public
as $$
declare
  v_nombre text := trim(coalesce(p_nombre, ''));
  v_email text := trim(coalesce(p_email, ''));
  v_telefono text := nullif(trim(coalesce(p_telefono, '')), '');
  v_mensaje text := nullif(trim(coalesce(p_mensaje, '')), '');
  v_numero bigint;
begin
  if v_nombre = '' or length(v_nombre) > 100 then
    raise exception 'Dinos tu nombre';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 200 then
    raise exception 'Ingresa un correo válido';
  end if;
  if v_telefono is not null and length(v_telefono) > 30 then
    raise exception 'Ingresa un teléfono válido';
  end if;
  if v_mensaje is not null and length(v_mensaje) > 1000 then
    raise exception 'El mensaje es demasiado largo';
  end if;

  insert into leads (nombre, email, telefono, mensaje)
  values (v_nombre, v_email, v_telefono, v_mensaje)
  returning numero into v_numero;
  return v_numero;
end $$;
revoke execute on function public.crear_lead(text, text, text, text) from public;
grant execute on function public.crear_lead(text, text, text, text) to anon, authenticated;
