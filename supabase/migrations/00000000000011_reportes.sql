-- Reportes: vistas de solo lectura (security_invoker: la RLS del consultante aplica).
-- Sin tablas nuevas, sin RPCs, sin escrituras.

-- ---------- Libro de ventas (formato SII: NC con signo negativo) ----------
create view public.libro_ventas with (security_invoker = true) as
select
  d.empresa_id,
  d.id as documento_id,
  coalesce(d.emitido_en, d.creado_en)::date as fecha,
  d.tipo,
  d.folio,
  c.rut as rut_cliente,
  c.razon_social as razon_social_cliente,
  (case when d.tipo = 'nota_credito' then -d.neto else d.neto end) as neto,
  (case when d.tipo = 'nota_credito' then -d.exento else d.exento end) as exento,
  (case when d.tipo = 'nota_credito' then -d.iva else d.iva end) as iva,
  (case when d.tipo = 'nota_credito' then -d.total else d.total end) as total
from public.documentos_venta d
join public.clientes c on c.id = d.cliente_id and c.empresa_id = d.empresa_id
where d.estado = 'emitido' and d.tipo in ('factura', 'boleta', 'nota_credito');

-- ---------- Ventas agregadas por dia (mismo conjunto que el libro) ----------
create view public.ventas_diarias with (security_invoker = true) as
select empresa_id, fecha,
       count(*)::integer as documentos,
       sum(neto)::integer as neto,
       sum(iva)::integer as iva,
       sum(total)::integer as total
from public.libro_ventas
group by empresa_id, fecha;

-- ---------- Valorizacion de inventario (stock x ultimo costo de recepcion) ----------
create view public.valorizacion_inventario with (security_invoker = true) as
select
  p.empresa_id,
  p.id as producto_id,
  p.sku,
  p.nombre,
  coalesce(s.stock, 0)::integer as stock,
  uc.costo_unitario,
  (coalesce(s.stock, 0) * uc.costo_unitario)::integer as valor
from public.productos p
left join lateral (
  select sum(m.cantidad) as stock
  from public.movimientos_stock m
  where m.producto_id = p.id and m.empresa_id = p.empresa_id
) s on true
left join lateral (
  select rl.costo_unitario
  from public.recepciones_lineas rl
  join public.recepciones r on r.id = rl.recepcion_id and r.empresa_id = rl.empresa_id
  where rl.producto_id = p.id and rl.empresa_id = p.empresa_id
  order by r.creado_en desc
  limit 1
) uc on true
where p.activo;

-- ---------- Grants (leccion Plan 1) ----------
grant select on public.libro_ventas, public.ventas_diarias, public.valorizacion_inventario to authenticated;
grant select on public.libro_ventas, public.ventas_diarias, public.valorizacion_inventario to service_role;
