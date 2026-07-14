-- Ventas por producto y dia (para el top de productos sin cap arbitrario).
-- Mismo conjunto que el libro EXCEPTO notas de credito: el top mide venta bruta.
create view public.ventas_por_producto with (security_invoker = true) as
select
  l.empresa_id,
  coalesce(d.emitido_en, d.creado_en)::date as fecha,
  l.producto_id,
  l.descripcion,
  sum(l.cantidad)::integer as cantidad,
  sum(l.subtotal)::integer as subtotal
from public.documentos_venta_lineas l
join public.documentos_venta d on d.id = l.documento_id and d.empresa_id = l.empresa_id
where d.estado = 'emitido' and d.tipo in ('factura', 'boleta')
group by l.empresa_id, fecha, l.producto_id, l.descripcion;

grant select on public.ventas_por_producto to authenticated;
grant select on public.ventas_por_producto to service_role;
