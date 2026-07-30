-- Rubros de empresa: la Pyme declara su rubro ('negocio' | 'transporte') al
-- registrarse y el sistema habilita los modulos correspondientes. El rubro es
-- la UNICA fuente de verdad; modulo_transporte se conserva como flag DERIVADO
-- (los ~30 consumidores actuales no se tocan) pero deja de ser escribible por
-- authenticated: se re-emite el grant de columnas de empresas SIN
-- modulo_transporte y sin rubro (patron modulo_contabilidad 0022: la columna
-- solo se mueve por RPC).
--
-- Invariante: modulo_transporte = (rubro = 'transporte') en TODA fila —
-- garantizado porque las unicas dos vias de escritura (registrar_organizacion
-- y cambiar_rubro) setean ambos campos juntos.

-- ---------- empresas.rubro + backfill ----------
-- Agregar un rubro futuro = extender este CHECK en una migracion nueva (mas
-- las validaciones de las 2 RPCs de abajo y la constante RUBROS de @suite/core).
alter table public.empresas
  add column if not exists rubro text not null default 'negocio'
    check (rubro in ('negocio', 'transporte'));

-- Backfill: derivar del flag actual. Nadie gana ni pierde modulos.
update public.empresas set rubro = 'transporte' where modulo_transporte;

-- ---------- empresas: re-emision de los grants de columnas ----------
-- UPDATE: el revoke borra TODOS los grants de update de authenticated (los 14
-- de 0016 Y los 2 de mercadopago 0018), por eso el grant nuevo re-lista TODO
-- lo que sigue permitido: la lista vigente MENOS modulo_transporte (solo por
-- RPC) y sin rubro (nunca lo tuvo). Un update directo de authenticated sobre
-- modulo_transporte o rubro falla con 42501.
revoke update on public.empresas from authenticated;
grant update (razon_social, giro, direccion, comuna, giro_emisor, direccion_emisor, comuna_emisor, resolucion_sii_numero, resolucion_sii_fecha, certificado_cifrado, certificado_password_cifrada, dte_api_key_cifrada, factor_volumetrico, mp_access_token_cifrado, mp_webhook_secret_cifrado) on public.empresas to authenticated;

-- INSERT: el grant de TABLA de 0001 (select, insert, update) cubria columnas
-- futuras, asi que un dueno podia insertar una segunda empresa en su org con
-- modulo_transporte/rubro/modulo_contabilidad a gusto (la policy "duenos crean
-- empresas" lo permite) y saltarse el control "solo plataforma". Se re-emite
-- por columnas SIN esos 3 campos custodiados. NO revocar a secas sin re-grant:
-- aislamiento.test.sql espera el mensaje de RLS en el insert cruzado, y sin
-- privilegio de insert fallaria antes con "permission denied for table".
-- Nadie inserta empresas como authenticated en apps/seed (verificado); el
-- unico camino real es registrar_organizacion (security definer).
revoke insert on public.empresas from authenticated;
grant insert (organizacion_id, rut, razon_social, giro, direccion, comuna, giro_emisor, direccion_emisor, comuna_emisor, resolucion_sii_numero, resolucion_sii_fecha, certificado_cifrado, certificado_password_cifrada, dte_api_key_cifrada, factor_volumetrico, mp_access_token_cifrado, mp_webhook_secret_cifrado) on public.empresas to authenticated;

-- ---------- registrar_organizacion: gana p_rubro (cambia la firma) ----------
-- DROP + CREATE porque cambia la firma: un create or replace dejaria viva la
-- version (text, text). El default 'negocio' mantiene compatible cualquier
-- llamada existente sin el parametro (registro web actual, seed org 2).
drop function public.registrar_organizacion(text, text);

create function public.registrar_organizacion(p_rut text, p_razon_social text, p_rubro text default 'negocio')
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
  -- Validacion temprana del rubro (el guard "is null" importa: null not in (...)
  -- evalua a null y el if no dispararia; sin el guard, un null reventaria recien
  -- en el not null de la columna con un 23502 criptico).
  if p_rubro is null or p_rubro not in ('negocio', 'transporte') then
    raise exception 'Rubro no válido';
  end if;

  -- Guardar normalizado: la restricción unique compara byte a byte, así que
  -- '76.543.210-3' y '765432103' deben ser la misma fila.
  v_rut := app.normalizar_rut(p_rut);

  select id into v_plan from planes where nombre = 'Básico';
  if v_plan is null then
    raise exception 'No existe el plan Básico; contacta a soporte';
  end if;

  begin
    insert into organizaciones (rut, razon_social, plan_id)
    values (v_rut, trim(p_razon_social), v_plan)
    returning id into v_org;
  exception when unique_violation then
    raise exception 'Ya existe una organización registrada con el RUT %', p_rut;
  end;

  -- Rubro y flag derivado SIEMPRE juntos (invariante de cabecera).
  insert into empresas (organizacion_id, rut, razon_social, rubro, modulo_transporte)
  values (v_org, v_rut, trim(p_razon_social), p_rubro, p_rubro = 'transporte');

  insert into miembros (usuario_id, organizacion_id, rol)
  values (v_usuario, v_org, 'dueno');

  insert into suscripciones (organizacion_id, plan_id)
  values (v_org, v_plan);

  return v_org;
end $$;

revoke execute on function public.registrar_organizacion(text, text, text) from anon, public;
grant execute on function public.registrar_organizacion(text, text, text) to authenticated;

-- ---------- cambiar_rubro (SOLO service_role: el panel admin 3002) ----------
-- UNICA via de cambio post-registro; concentra el mapping rubro -> modulos
-- junto con registrar_organizacion. Cambiar transporte -> negocio solo oculta
-- el NAV y las paginas de transporte (UX): los datos de flota, entregas,
-- proformas y combustible quedan intactos y reaparecen si se revierte.
create function public.cambiar_rubro(p_empresa uuid, p_rubro text)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if p_rubro is null or p_rubro not in ('negocio', 'transporte') then
    raise exception 'Rubro no válido';
  end if;
  -- Existencia validada por el propio update (found): equivalente al select
  -- previo del diseño pero en una sola pasada y sin ventana TOCTOU.
  update empresas
  set rubro = p_rubro, modulo_transporte = (p_rubro = 'transporte')
  where id = p_empresa;
  if not found then
    raise exception 'Empresa no encontrada';
  end if;
end $$;

-- Los tenants no pueden ni verla: execute SOLO para service_role.
revoke execute on function public.cambiar_rubro(uuid, text) from public, anon, authenticated;
grant execute on function public.cambiar_rubro(uuid, text) to service_role;
