-- Crea un documento de venta (borrador) con sus líneas en una transacción,
-- calculando totales server-side. Devuelve el id del documento.
-- Precio, exención y nombre se toman del PRODUCTO (fuente de verdad tributaria),
-- nunca de lo que envía el cliente: evita sub-declarar IVA marcando un afecto como
-- exento o alterar el precio. Del cliente solo se confía la cantidad.
create or replace function public.crear_documento_venta(
  p_empresa uuid,
  p_cliente uuid,
  p_tipo text,
  p_lineas jsonb
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_doc uuid;
  v_neto integer := 0;
  v_exento integer := 0;
  v_iva integer;
  v_linea jsonb;
  v_sub integer;
  v_nombre text;
  v_precio integer;
  v_exenta boolean;
  v_cant integer;
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno','admin','vendedor']) then
    raise exception 'Tu rol no permite crear ventas';
  end if;
  -- Esta RPC solo crea notas de venta (borrador). Los documentos tributarios
  -- se generan al emitir (que toma folio y valida certificado).
  if p_tipo <> 'nota_venta' then
    raise exception 'Tipo de documento no permitido en esta operación';
  end if;
  if jsonb_array_length(p_lineas) = 0 then
    raise exception 'La venta debe tener al menos una línea';
  end if;

  insert into documentos_venta (empresa_id, tipo, cliente_id, estado)
  values (p_empresa, p_tipo, p_cliente, 'borrador')
  returning id into v_doc;

  for v_linea in select * from jsonb_array_elements(p_lineas) loop
    select nombre, precio_neto, exento into v_nombre, v_precio, v_exenta
    from productos
    where id = (v_linea->>'productoId')::uuid and empresa_id = p_empresa and activo;
    if not found then
      raise exception 'Producto no encontrado o inactivo en la empresa';
    end if;
    v_cant := (v_linea->>'cantidad')::integer;
    if v_cant < 1 then
      raise exception 'La cantidad debe ser al menos 1';
    end if;
    v_sub := round(v_cant * v_precio);
    insert into documentos_venta_lineas (empresa_id, documento_id, producto_id, descripcion, cantidad, precio_neto, exenta, subtotal)
    values (p_empresa, v_doc, (v_linea->>'productoId')::uuid, v_nombre, v_cant, v_precio, v_exenta, v_sub);
    if v_exenta then v_exento := v_exento + v_sub; else v_neto := v_neto + v_sub; end if;
  end loop;

  v_iva := round(v_neto * 0.19);
  update documentos_venta set neto = v_neto, exento = v_exento, iva = v_iva, total = v_neto + v_exento + v_iva
  where id = v_doc;

  return v_doc;
end $$;

revoke execute on function public.crear_documento_venta(uuid, uuid, text, jsonb) from anon, public;
grant execute on function public.crear_documento_venta(uuid, uuid, text, jsonb) to authenticated;
