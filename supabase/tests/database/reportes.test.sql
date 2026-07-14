begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'ana@a.cl'),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'beto@b.cl');

insert into public.organizaciones (id, rut, razon_social)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '761111116', 'Org A'),
       ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '762222221', 'Org B');

insert into public.empresas (id, organizacion_id, rut, razon_social)
values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '761111116', 'Empresa A'),
       ('eeeeeeee-0000-0000-0000-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '762222221', 'Empresa B');

insert into public.miembros (usuario_id, organizacion_id, rol)
values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'dueno'),
       ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'dueno');

insert into public.clientes (id, empresa_id, rut, razon_social)
values ('cccccccc-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '765432103', 'Cliente A');

-- Productos: P1 (con stock y dos recepciones a costos distintos) y P2 (sin recepciones).
insert into public.productos (id, empresa_id, sku, nombre, precio_neto)
values ('99999999-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'P1', 'Producto Uno', 10000),
       ('99999999-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'P2', 'Producto Dos', 5000);

insert into public.bodegas (id, empresa_id, nombre)
values ('bbbb0000-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'Bodega A');

insert into public.proveedores (id, empresa_id, rut, razon_social)
values ('dddd0000-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '765432103', 'Proveedor A');

-- Stock P1 = 10.
insert into public.movimientos_stock (empresa_id, producto_id, bodega_id, tipo, cantidad, motivo)
values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '99999999-0000-0000-0000-000000000001', 'bbbb0000-0000-0000-0000-aaaaaaaaaaaa', 'entrada', 10, 'seed');

-- Dos recepciones de P1 a costos distintos: la MAS RECIENTE (1500) debe ganar.
insert into public.ordenes_compra (id, empresa_id, numero, proveedor_id, estado)
values ('0c0c0c0c-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 1, 'dddd0000-0000-0000-0000-aaaaaaaaaaaa', 'recibida_parcial');
insert into public.ordenes_compra_lineas (id, empresa_id, orden_id, producto_id, descripcion, cantidad_pedida, costo_unitario, cantidad_recibida)
values ('0a0a0a0a-0000-0000-0000-00000000000a', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '0c0c0c0c-0000-0000-0000-aaaaaaaaaaaa', '99999999-0000-0000-0000-000000000001', 'Producto Uno', 20, 1500, 10);
insert into public.recepciones (id, empresa_id, orden_id, bodega_id, creado_en)
values ('4e4e4e4e-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '0c0c0c0c-0000-0000-0000-aaaaaaaaaaaa', 'bbbb0000-0000-0000-0000-aaaaaaaaaaaa', now() - interval '2 days'),
       ('4e4e4e4e-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '0c0c0c0c-0000-0000-0000-aaaaaaaaaaaa', 'bbbb0000-0000-0000-0000-aaaaaaaaaaaa', now() - interval '1 day');
insert into public.recepciones_lineas (empresa_id, recepcion_id, orden_linea_id, producto_id, cantidad, costo_unitario)
values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '4e4e4e4e-0000-0000-0000-000000000001', '0a0a0a0a-0000-0000-0000-00000000000a', '99999999-0000-0000-0000-000000000001', 5, 1000),
       ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '4e4e4e4e-0000-0000-0000-000000000002', '0a0a0a0a-0000-0000-0000-00000000000a', '99999999-0000-0000-0000-000000000001', 5, 1500);

-- Documentos: factura y boleta emitidas el 2026-07-10, NC emitida el 2026-07-11,
-- mas un borrador y una nota de venta (que NO deben aparecer en el libro).
insert into public.documentos_venta (id, empresa_id, tipo, cliente_id, folio, estado, neto, exento, iva, total, emitido_en)
values ('dddddddd-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'factura', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 1, 'emitido', 84034, 0, 15966, 100000, '2026-07-10T12:00:00Z'),
       ('dddddddd-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'boleta',  'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 5, 'emitido', 50000, 0, 9500, 59500, '2026-07-10T15:00:00Z'),
       ('dddddddd-0000-0000-0000-000000000003', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'nota_credito', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 1, 'emitido', 84034, 0, 15966, 100000, '2026-07-11T10:00:00Z'),
       ('dddddddd-0000-0000-0000-000000000004', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'factura', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa', null, 'borrador', 10000, 0, 1900, 11900, null),
       ('dddddddd-0000-0000-0000-000000000005', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'nota_venta', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa', null, 'borrador', 10000, 0, 1900, 11900, null);

-- ===== Ana (duena A) =====
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- 1) El libro tiene exactamente 3 filas (borrador y nota de venta excluidos).
select is( (select count(*) from libro_ventas), 3::bigint, 'el libro tiene 3 documentos (borrador y nota de venta fuera)' );

-- 2) La NC aparece con total NEGATIVO.
select is( (select total from libro_ventas where tipo = 'nota_credito'), -100000, 'la nota de crédito resta en el libro' );

-- 3) ventas_diarias del 2026-07-10 suma factura + boleta.
select is( (select total from ventas_diarias where fecha = '2026-07-10'), 159500, 'el día 10 suma factura y boleta (159500)' );

-- 4) ventas_diarias del 2026-07-11 es la NC en negativo.
select is( (select total from ventas_diarias where fecha = '2026-07-11'), -100000, 'el día 11 es la NC en negativo' );

-- 5) Valorización: stock de P1 = 10.
select is( (select stock from valorizacion_inventario where sku = 'P1'), 10, 'la valorización toma el stock del ledger' );

-- 6) Valorización: costo de P1 = 1500 (la recepción MÁS RECIENTE, no la primera).
select is( (select costo_unitario from valorizacion_inventario where sku = 'P1'), 1500, 'el costo es el de la recepción más reciente' );

-- 7) Valorización: valor de P1 = 15000.
select is( (select valor from valorizacion_inventario where sku = 'P1'), 15000, 'valor = stock x costo' );

-- 8) P2 sin recepciones: costo NULL.
select ok( (select costo_unitario is null from valorizacion_inventario where sku = 'P2'), 'sin recepciones el costo es NULL' );

-- 9) Beto (org B) no ve nada en las 3 vistas.
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
select is(
  (select count(*) from libro_ventas) + (select count(*) from ventas_diarias) + (select count(*) from valorizacion_inventario),
  0::bigint, 'Beto no ve reportes de la empresa A'
);

-- 10) Anónimo denegado.
set local request.jwt.claims to '{"role": "anon"}';
set local role anon;
select throws_ok(
  'select count(*) from libro_ventas',
  '42501', 'permission denied for view libro_ventas',
  'un anónimo no puede consultar el libro de ventas'
);

select * from finish();
rollback;
