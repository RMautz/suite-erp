-- Tickets de administracion (spec 2026-07-22b): numero correlativo visible, origen
-- del canal, y alta desde el bot de WhatsApp (service_role, patron semaforo_whatsapp
-- 0028). El nucleo de validacion vive en app.crear_consulta (revocado a la API).

alter table public.consultas_admin
  add column numero bigint generated always as identity,
  add column origen text not null default 'web' check (origen in ('web', 'whatsapp'));

create unique index consultas_admin_numero_idx on public.consultas_admin (numero);

-- ---------- Nucleo compartido (sin chequeo de caller: lo ponen los wrappers) ----------
create or replace function app.crear_consulta(p_usuario uuid, p_origen text, p_asunto text, p_mensaje text)
returns bigint
language plpgsql security definer
set search_path = public
as $$
declare
  v_asunto text := trim(coalesce(p_asunto, ''));
  v_mensaje text := trim(coalesce(p_mensaje, ''));
  v_org uuid;
  v_email text;
  v_numero bigint;
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
  where m.usuario_id = p_usuario and m.estado = 'activo'
  order by m.creado_en
  limit 1;
  if v_org is null then
    raise exception 'Tu cuenta no tiene una organización';
  end if;

  select u.email into v_email from auth.users u where u.id = p_usuario;

  insert into consultas_admin (organizacion_id, usuario_id, email, asunto, mensaje, origen)
  values (v_org, p_usuario, coalesce(v_email, ''), v_asunto, v_mensaje, p_origen)
  returning numero into v_numero;
  return v_numero;
end $$;
revoke execute on function app.crear_consulta(uuid, text, text, text) from anon, public, authenticated;

-- ---------- Web (authenticated): retorna ahora el NUMERO del ticket ----------
drop function public.crear_consulta_admin(text, text);
create or replace function public.crear_consulta_admin(p_asunto text, p_mensaje text)
returns bigint
language plpgsql security definer
set search_path = public
as $$
begin
  return app.crear_consulta(auth.uid(), 'web', p_asunto, p_mensaje);
end $$;
revoke execute on function public.crear_consulta_admin(text, text) from anon, public;
grant execute on function public.crear_consulta_admin(text, text) to authenticated;

-- ---------- Bot de WhatsApp (SOLO service_role): el webhook pasa el usuario del
-- vinculo verificado; sin auth.uid() en ese contexto ----------
create or replace function public.crear_consulta_whatsapp(p_usuario uuid, p_asunto text, p_mensaje text)
returns bigint
language plpgsql security definer
set search_path = public
as $$
begin
  return app.crear_consulta(p_usuario, 'whatsapp', p_asunto, p_mensaje);
end $$;
revoke execute on function public.crear_consulta_whatsapp(uuid, text, text) from anon, public, authenticated;
grant execute on function public.crear_consulta_whatsapp(uuid, text, text) to service_role;
