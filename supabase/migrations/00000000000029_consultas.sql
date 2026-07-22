-- Consultas a administracion (spec 2026-07-22): canal tenant -> plataforma. El
-- usuario escribe via RPC (cero escritura directa, el grant es el candado, patron
-- whatsapp_vinculos 0028); el admin responde/cierra via service_role desde apps/admin.

-- ---------- Tabla ----------
create table public.consultas_admin (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id),
  usuario_id uuid not null,
  email text not null,
  asunto text not null,
  mensaje text not null,
  estado text not null default 'abierta' check (estado in ('abierta', 'respondida', 'cerrada')),
  respuesta text,
  respondida_en timestamptz,
  creado_en timestamptz not null default now()
);

-- La bandeja del admin (abiertas primero) y la lista del tenant.
create index consultas_admin_org_idx on public.consultas_admin (organizacion_id, creado_en desc);
create index consultas_admin_estado_idx on public.consultas_admin (estado, creado_en desc);

-- ---------- RLS ----------
alter table public.consultas_admin enable row level security;

-- El AUTOR siempre ve las suyas; dueno/admin ven todas las de su organizacion
-- (hallazgo review 2026-07-22: las consultas hablan de facturacion/suscripcion —
-- un vendedor o conductor no tiene por que leer las del dueno). app.tiene_rol es
-- security definer: sin RLS-sobre-RLS.
create policy "autor y administradores ven consultas" on public.consultas_admin
  for select to authenticated
  using (
    usuario_id = auth.uid()
    or app.tiene_rol(consultas_admin.organizacion_id, array['dueno', 'admin'])
  );

-- ---------- Grants Data API (leccion 0001) ----------
-- Solo lectura para authenticated: crear va por la RPC; responder es service_role.
grant select on public.consultas_admin to authenticated;
grant select, insert, update, delete on public.consultas_admin to service_role;

-- ---------- Crear consulta ----------
create or replace function public.crear_consulta_admin(p_asunto text, p_mensaje text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_asunto text := trim(coalesce(p_asunto, ''));
  v_mensaje text := trim(coalesce(p_mensaje, ''));
  v_org uuid;
  v_email text;
  v_id uuid;
begin
  if v_asunto = '' then
    raise exception 'Escribe un asunto';
  end if;
  if length(v_asunto) > 200 then
    raise exception 'El asunto no puede superar los 200 caracteres';
  end if;
  if v_mensaje = '' then
    raise exception 'Escribe tu consulta';
  end if;
  if length(v_mensaje) > 5000 then
    raise exception 'La consulta no puede superar los 5000 caracteres';
  end if;

  select m.organizacion_id into v_org
  from miembros m
  where m.usuario_id = auth.uid() and m.estado = 'activo'
  order by m.creado_en
  limit 1;
  if v_org is null then
    raise exception 'Tu cuenta no tiene una organización';
  end if;

  select u.email into v_email from auth.users u where u.id = auth.uid();

  insert into consultas_admin (organizacion_id, usuario_id, email, asunto, mensaje)
  values (v_org, auth.uid(), coalesce(v_email, ''), v_asunto, v_mensaje)
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.crear_consulta_admin(text, text) from anon, public;
grant execute on function public.crear_consulta_admin(text, text) to authenticated;
