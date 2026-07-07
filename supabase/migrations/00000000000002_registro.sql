-- Normalización y validación de RUT en la BD: última línea de defensa.
-- El RPC es invocable directo vía PostgREST, así que no se puede confiar
-- en que el cliente haya validado o normalizado.

create or replace function app.normalizar_rut(p_rut text)
returns text
language sql immutable
as $$
  select upper(regexp_replace(coalesce(p_rut, ''), '[^0-9kK]', '', 'g'))
$$;

create or replace function app.validar_rut(p_rut text)
returns boolean
language plpgsql immutable
as $$
declare
  limpio text := app.normalizar_rut(p_rut);
  cuerpo text;
  dv text;
  suma int := 0;
  factor int := 2;
  resto int;
  esperado text;
begin
  if length(limpio) < 2 then return false; end if;
  cuerpo := left(limpio, -1);
  dv := right(limpio, 1);
  if cuerpo !~ '^\d+$' then return false; end if;
  for i in reverse length(cuerpo)..1 loop
    suma := suma + substr(cuerpo, i, 1)::int * factor;
    factor := case when factor = 7 then 2 else factor + 1 end;
  end loop;
  resto := 11 - (suma % 11);
  esperado := case when resto = 11 then '0' when resto = 10 then 'K' else resto::text end;
  return esperado = dv;
end $$;

-- Registro self-service: crea organización + empresa + membresía dueño en una transacción.
create or replace function public.registrar_organizacion(p_rut text, p_razon_social text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_usuario uuid := auth.uid();
  v_rut text;
  v_org uuid;
  v_plan uuid;
begin
  if v_usuario is null then
    raise exception 'Debes iniciar sesión para registrar una organización';
  end if;
  if not app.validar_rut(p_rut) then
    raise exception 'El RUT ingresado no es válido';
  end if;
  if coalesce(trim(p_razon_social), '') = '' then
    raise exception 'La razón social es obligatoria';
  end if;

  -- Guardar normalizado: la restricción unique compara byte a byte, así que
  -- '76.543.210-3' y '765432103' deben ser la misma fila.
  v_rut := app.normalizar_rut(p_rut);

  select id into v_plan from planes where nombre = 'Básico';

  begin
    insert into organizaciones (rut, razon_social, plan_id)
    values (v_rut, p_razon_social, v_plan)
    returning id into v_org;
  exception when unique_violation then
    raise exception 'Ya existe una organización registrada con el RUT %', p_rut;
  end;

  insert into empresas (organizacion_id, rut, razon_social)
  values (v_org, v_rut, p_razon_social);

  insert into miembros (usuario_id, organizacion_id, rol)
  values (v_usuario, v_org, 'dueno');

  insert into suscripciones (organizacion_id, plan_id)
  values (v_org, v_plan);

  return v_org;
end $$;

revoke execute on function public.registrar_organizacion(text, text) from anon, public;
grant execute on function public.registrar_organizacion(text, text) to authenticated;
