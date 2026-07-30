-- Endurecimiento de seguridad tributaria (review final Plan 3).

-- documentos_venta y sus líneas se escriben SOLO vía crear_documento_venta (security
-- definer) y el service_role de la emisión. Las políticas de insert/update para
-- authenticated permitían a un miembro forjar documentos 'emitido' o alterar totales/IVA
-- saltándose la RPC. Se deja solo lectura para authenticated.
drop policy if exists "vendedores crean documentos" on public.documentos_venta;
drop policy if exists "vendedores editan documentos" on public.documentos_venta;
drop policy if exists "vendedores crean lineas" on public.documentos_venta_lineas;
drop policy if exists "vendedores editan lineas" on public.documentos_venta_lineas;
revoke insert, update on public.documentos_venta from authenticated;
revoke insert, update on public.documentos_venta_lineas from authenticated;

-- folios_caf: authenticated puede cargar (insert) pero NO editar 'siguiente'
-- (tomar_folio lo avanza como security definer). Poder editarlo permitía rebobinar folios.
drop policy if exists "duenos editan folios" on public.folios_caf;
revoke update on public.folios_caf from authenticated;

-- Un folio no puede repetirse por (empresa, tipo): defensa ante bugs o escritores futuros.
create unique index documentos_venta_folio_unico
  on public.documentos_venta (empresa_id, tipo, folio)
  where folio is not null;
