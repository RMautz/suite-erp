-- Soporte de la cola de reintentos de emisión DTE.
-- v1: los documentos en 'pendiente_envio' se reintentan desde la UI con emitirDocumento
-- (que es idempotente porque no re-reserva folio si ya lo tiene). El cron programado se
-- activa en producción con pg_cron o Vercel Cron llamando a un endpoint que recorre pendientes.

create or replace function app.documentos_pendientes(p_empresa uuid)
returns setof public.documentos_venta
language sql stable security definer
set search_path = public
as $$
  select * from documentos_venta
  where empresa_id = p_empresa and estado = 'pendiente_envio'
    and empresa_id in (select app.mis_empresas())
  order by creado_en
$$;

revoke execute on function app.documentos_pendientes(uuid) from anon, public;
grant execute on function app.documentos_pendientes(uuid) to authenticated;
