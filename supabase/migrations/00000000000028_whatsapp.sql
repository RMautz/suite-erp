-- WhatsApp (Plan 21): vinculacion segura de telefonos del dueno/admin y log INMUTABLE
-- de mensajes. La conversacion entra por el webhook (service_role); la gestion de
-- vinculos va SOLO por RPCs security definer (cero escritura directa, patron
-- finiquitos 0027). El log copia el patron correos_enviados 0020.

-- ---------- whatsapp_vinculos ----------
create table public.whatsapp_vinculos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  usuario_id uuid not null,
  -- E.164 estricto: mismo regex que esTelefonoE164 en @suite/whatsapp.
  telefono text not null check (telefono ~ '^\+[1-9][0-9]{7,14}$'),
  codigo text,
  codigo_expira timestamptz,
  verificado_en timestamptz,
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);

-- Un telefono VERIFICADO activo en TODA la plataforma (spec 4.1): backstop atomico
-- del mensaje 'Ese telefono ya esta vinculado a otra cuenta'.
create unique index whatsapp_vinculos_telefono_idx
  on public.whatsapp_vinculos (telefono)
  where verificado_en is not null and activo;

-- El webhook resuelve el vinculo por telefono; la UI lista por empresa.
create index whatsapp_vinculos_empresa_idx
  on public.whatsapp_vinculos (empresa_id, activo, creado_en desc);

-- ---------- whatsapp_mensajes (log INMUTABLE) ----------
create table public.whatsapp_mensajes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  telefono text not null,
  direccion text not null check (direccion in ('entrante', 'saliente')),
  origen text not null check (origen in ('bot', 'cobranza', 'vinculacion')),
  contenido text not null,
  -- La factura del recordatorio de cobranza (anti-spam 3 dias). Sin FK dura:
  -- traza, patron referencia_id de correos_enviados.
  referencia_id uuid,
  creado_en timestamptz not null default now()
);

-- Conversacion por telefono (historial del bot) y anti-spam de cobranza por factura.
create index whatsapp_mensajes_telefono_idx
  on public.whatsapp_mensajes (empresa_id, telefono, creado_en desc);
create index whatsapp_mensajes_ref_idx
  on public.whatsapp_mensajes (empresa_id, origen, referencia_id, creado_en desc);

-- ---------- RLS ----------
alter table public.whatsapp_vinculos enable row level security;
alter table public.whatsapp_mensajes enable row level security;

-- vinculos: SELECT dueno/admin (el codigo de verificacion es sensible);
-- CERO escritura directa (ni policy ni grant: el grant es el candado).
create policy "duenos ven vinculos whatsapp" on public.whatsapp_vinculos
  for select to authenticated
  using (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']));

-- mensajes: SELECT dueno/admin/contador (el contador audita la gestion de cobranza);
-- INSERT dueno/admin (acciones de la app; el webhook inserta con service_role).
-- Sin UPDATE/DELETE: log inmutable.
create policy "contables ven mensajes whatsapp" on public.whatsapp_mensajes
  for select to authenticated
  using (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin', 'contador']));
create policy "duenos registran mensajes whatsapp" on public.whatsapp_mensajes
  for insert to authenticated
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']));

-- ---------- Grants Data API (leccion 0001: sin esto todo da 42501) ----------
grant select on public.whatsapp_vinculos to authenticated;
grant select, insert on public.whatsapp_mensajes to authenticated;
grant select, insert, update, delete on public.whatsapp_vinculos, public.whatsapp_mensajes to service_role;

-- ---------- Solicitar vinculo (codigo de 6 digitos, expira en 10 min) ----------
create or replace function public.solicitar_vinculo_whatsapp(p_empresa uuid, p_telefono text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_codigo text;
  v_id uuid;
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin']) then
    raise exception 'Tu rol no permite gestionar WhatsApp';
  end if;
  if p_telefono is null or p_telefono !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'Teléfono no válido: usa formato internacional +56...';
  end if;

  v_codigo := lpad((floor(random() * 1000000))::int::text, 6, '0');

  -- Reintento sobre el mismo telefono pendiente (misma empresa, no verificado,
  -- activo): regenera codigo y expiracion sobre la MISMA fila (spec 4.1).
  update whatsapp_vinculos
  set codigo = v_codigo,
      codigo_expira = now() + interval '10 minutes',
      usuario_id = auth.uid()
  where empresa_id = p_empresa and telefono = p_telefono
    and verificado_en is null and activo
  returning id into v_id;

  if v_id is null then
    insert into whatsapp_vinculos (empresa_id, usuario_id, telefono, codigo, codigo_expira)
    values (p_empresa, auth.uid(), p_telefono, v_codigo, now() + interval '10 minutes')
    returning id into v_id;
  end if;

  -- El ENVIO del codigo lo hace la Server Action via proveedorWhatsApp():
  -- la RPC no habla con el mundo (spec 4.1).
  return v_id;
end $$;
revoke execute on function public.solicitar_vinculo_whatsapp(uuid, text) from anon, public;
grant execute on function public.solicitar_vinculo_whatsapp(uuid, text) to authenticated;

-- ---------- Confirmar vinculo ----------
create or replace function public.confirmar_vinculo_whatsapp(p_empresa uuid, p_vinculo uuid, p_codigo text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_ok boolean;
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin']) then
    raise exception 'Tu rol no permite gestionar WhatsApp';
  end if;
  begin
    update whatsapp_vinculos
    set verificado_en = now(), codigo = null, codigo_expira = null
    where id = p_vinculo and empresa_id = p_empresa
      and verificado_en is null and activo
      and codigo is not null and codigo = p_codigo and codigo_expira > now()
    returning true into v_ok;
  exception when unique_violation then
    -- El unique parcial de plataforma: ese telefono ya esta verificado en otra fila.
    raise exception 'Ese teléfono ya está vinculado a otra cuenta';
  end;
  if v_ok is null then
    raise exception 'Código incorrecto o expirado';
  end if;
end $$;
revoke execute on function public.confirmar_vinculo_whatsapp(uuid, uuid, text) from anon, public;
grant execute on function public.confirmar_vinculo_whatsapp(uuid, uuid, text) to authenticated;

-- ---------- Desvincular ----------
create or replace function public.desvincular_whatsapp(p_empresa uuid, p_vinculo uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin']) then
    raise exception 'Tu rol no permite gestionar WhatsApp';
  end if;
  update whatsapp_vinculos set activo = false
  where id = p_vinculo and empresa_id = p_empresa and activo;
  if not found then
    raise exception 'El vínculo no existe';
  end if;
end $$;
revoke execute on function public.desvincular_whatsapp(uuid, uuid) from anon, public;
grant execute on function public.desvincular_whatsapp(uuid, uuid) to authenticated;

-- ---------- Semaforo del auditor para el bot (SOLO service_role) ----------
-- El webhook corre como service_role: auth.uid() es null y el guard de
-- revision_periodo lanzaria. Este wrapper valida el rol del usuario del VINCULO
-- verificado y lo impersona con set_config transaccional (mismo mecanismo que los
-- tests pgTAP) para reusar revision_periodo tal cual, sin re-crear su cuerpo.
create or replace function public.semaforo_whatsapp(p_empresa uuid, p_usuario uuid, p_anio integer, p_mes integer)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from empresas e
    join miembros m on m.organizacion_id = e.organizacion_id
    where e.id = p_empresa
      and m.usuario_id = p_usuario
      and m.estado = 'activo'
      and m.rol in ('dueno', 'admin')
  ) then
    raise exception 'Tu rol no permite ver la revisión';
  end if;
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_usuario, 'role', 'authenticated')::text,
    true
  );
  return revision_periodo(p_empresa, p_anio, p_mes);
end $$;
revoke execute on function public.semaforo_whatsapp(uuid, uuid, integer, integer) from anon, public, authenticated;
grant execute on function public.semaforo_whatsapp(uuid, uuid, integer, integer) to service_role;
