begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'ana@a.cl'),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'beto@b.cl'),
  ('00000000-0000-0000-0000-000000000000', '55555555-5555-5555-5555-555555555555', 'authenticated', 'authenticated', 'ces@a.cl'),
  ('00000000-0000-0000-0000-000000000000', '66666666-6666-6666-6666-666666666666', 'authenticated', 'authenticated', 'dora@a.cl');

insert into public.organizaciones (id, rut, razon_social)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '761111116', 'Org A'),
       ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '762222221', 'Org B');

insert into public.empresas (id, organizacion_id, rut, razon_social)
values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '761111116', 'Empresa A'),
       ('eeeeeeee-0000-0000-0000-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '762222221', 'Empresa B');

insert into public.miembros (usuario_id, organizacion_id, rol)
values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'dueno'),
       ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'dueno'),
       ('55555555-5555-5555-5555-555555555555', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'contador'),
       ('66666666-6666-6666-6666-666666666666', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bodeguero');

insert into public.productos (id, empresa_id, sku, nombre, precio_neto)
values ('99999999-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'P1', 'Producto A', 10000);

insert into public.bodegas (id, empresa_id, nombre)
values ('bbbb0000-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'Bodega A');

insert into public.proveedores (id, empresa_id, rut, razon_social)
values ('dddd0000-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '765432103', 'Proveedor A');

insert into public.clientes (id, empresa_id, rut, razon_social)
values ('cccccccc-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '765432103', 'Cliente A');

insert into public.documentos_venta (id, empresa_id, tipo, cliente_id, estado, neto, exento, iva, total)
values ('dddddddd-1111-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'factura',
        'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 'emitido', 10000, 0, 1900, 11900);

-- ===== Ana (duena A) =====
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- 1) Ana crea una OC via RPC.
select lives_ok(
  $$select crear_orden_compra('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'dddd0000-0000-0000-0000-aaaaaaaaaaaa',
    '[{"productoId":"99999999-0000-0000-0000-aaaaaaaaaaaa","cantidad":10,"costoUnitario":1500}]'::jsonb, 'primera OC')$$,
  'la dueña crea una orden de compra'
);
-- 2) El numero correlativo parte en 1.
select is( (select numero from ordenes_compra where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' limit 1),
  1, 'el numero correlativo parte en 1' );
-- 3) La descripcion viene DEL PRODUCTO.
select is( (select descripcion from ordenes_compra_lineas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' limit 1),
  'Producto A', 'la descripción de la línea viene del producto' );

-- 4) Dora (bodeguera) NO crea OC.
set local request.jwt.claims to '{"sub": "66666666-6666-6666-6666-666666666666", "role": "authenticated"}';
select throws_ok(
  $$select crear_orden_compra('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'dddd0000-0000-0000-0000-aaaaaaaaaaaa',
    '[{"productoId":"99999999-0000-0000-0000-aaaaaaaaaaaa","cantidad":1,"costoUnitario":1}]'::jsonb, null)$$,
  'P0001', 'Tu rol no permite crear órdenes de compra',
  'la bodeguera no puede crear órdenes de compra'
);

-- 5) Recibir en borrador esta prohibido.
select throws_ok(
  $$select registrar_recepcion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from ordenes_compra where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' limit 1),
    'bbbb0000-0000-0000-0000-aaaaaaaaaaaa',
    '[{"ordenLineaId":"00000000-0000-0000-0000-000000000000","cantidad":1}]'::jsonb, null)$$,
  'P0001', 'La orden no está en un estado que permita recepción',
  'no se puede recibir una orden en borrador'
);

-- 6) Ana marca la OC enviada (update directo con guard de estado).
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select results_eq(
  $$with u as (
    update ordenes_compra set estado = 'enviada'
    where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and estado = 'borrador'
    returning 1
  ) select count(*) from u$$,
  array[1::bigint],
  'la dueña marca la orden enviada'
);

-- 7) Dora (bodeguera) registra una recepcion parcial (4 de 10).
set local request.jwt.claims to '{"sub": "66666666-6666-6666-6666-666666666666", "role": "authenticated"}';
select lives_ok(
  $$select registrar_recepcion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from ordenes_compra where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' limit 1),
    'bbbb0000-0000-0000-0000-aaaaaaaaaaaa',
    (select jsonb_build_array(jsonb_build_object('ordenLineaId', id, 'cantidad', 4))
       from ordenes_compra_lineas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' limit 1), 'entrega 1')$$,
  'la bodeguera registra una recepción parcial'
);
-- 8) El stock subio a 4.
select is( (select cantidad from stock_actual where producto_id = '99999999-0000-0000-0000-aaaaaaaaaaaa'),
  4, 'el stock refleja la recepción (4)' );
-- 9) La OC quedo recibida_parcial.
select is( (select estado from ordenes_compra where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' limit 1),
  'recibida_parcial', 'la orden queda recibida parcial' );

-- 10) Sobre-recepcion rechazada (7 > pendiente 6).
select throws_ok(
  $$select registrar_recepcion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from ordenes_compra where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' limit 1),
    'bbbb0000-0000-0000-0000-aaaaaaaaaaaa',
    (select jsonb_build_array(jsonb_build_object('ordenLineaId', id, 'cantidad', 7))
       from ordenes_compra_lineas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' limit 1), null)$$,
  'P0001', 'La cantidad recibida supera lo pendiente (pendiente: 6)',
  'la sobre-recepción se rechaza con el pendiente en el mensaje'
);

-- 11) Recibir el resto (6) completa la orden.
select lives_ok(
  $$select registrar_recepcion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from ordenes_compra where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' limit 1),
    'bbbb0000-0000-0000-0000-aaaaaaaaaaaa',
    (select jsonb_build_array(jsonb_build_object('ordenLineaId', id, 'cantidad', 6))
       from ordenes_compra_lineas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' limit 1), 'entrega 2')$$,
  'la bodeguera recibe el resto'
);
-- 12) La OC quedo recibida_total.
select is( (select estado from ordenes_compra where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' limit 1),
  'recibida_total', 'la orden queda recibida total' );

-- 13) Cancelar una orden recibida no hace nada (guard de estado: 0 filas).
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select results_eq(
  $$with u as (
    update ordenes_compra set estado = 'cancelada'
    where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and estado in ('borrador', 'enviada')
    returning 1
  ) select count(*) from u$$,
  array[0::bigint],
  'no se puede cancelar una orden ya recibida'
);

-- 14) Beto (org B) no ve las OCs de A.
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
select is( (select count(*) from ordenes_compra), 0::bigint, 'Beto no ve órdenes de la empresa A' );

-- 15) Ces (contador A) no puede recibir mercaderia.
set local request.jwt.claims to '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated"}';
select throws_ok(
  $$select registrar_recepcion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from ordenes_compra where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' limit 1),
    'bbbb0000-0000-0000-0000-aaaaaaaaaaaa',
    '[{"ordenLineaId":"00000000-0000-0000-0000-000000000000","cantidad":1}]'::jsonb, null)$$,
  'P0001', 'Tu rol no permite recibir mercadería',
  'el contador no puede recibir mercadería'
);

-- 16) authenticated NO puede ejecutar la RPC de movimientos por documento.
select throws_ok(
  $$select registrar_movimientos_documento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    'dddddddd-1111-0000-0000-aaaaaaaaaaaa', '[]'::jsonb, -1, 'x')$$,
  '42501', 'permission denied for function registrar_movimientos_documento',
  'un usuario autenticado no puede ejecutar registrar_movimientos_documento'
);

-- 17-18) service_role la ejecuta y es idempotente (2 llamadas -> 1 fila).
set local role service_role;
-- Primera llamada: setup sin assert (si falla, aborta la transacción del test igual).
select registrar_movimientos_documento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  'dddddddd-1111-0000-0000-aaaaaaaaaaaa',
  '[{"productoId":"99999999-0000-0000-0000-aaaaaaaaaaaa","cantidad":2}]'::jsonb, -1, 'Venta factura folio 1');
-- 17) Segunda llamada (reintento) no lanza.
select lives_ok(
  $$select registrar_movimientos_documento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
      'dddddddd-1111-0000-0000-aaaaaaaaaaaa',
      '[{"productoId":"99999999-0000-0000-0000-aaaaaaaaaaaa","cantidad":2}]'::jsonb, -1, 'Venta factura folio 1')$$,
  'service_role reintenta la RPC sin error'
);
reset role;
-- 18) El reintento no duplico filas.
select is(
  (select count(*) from public.movimientos_stock
   where referencia_documento_id = 'dddddddd-1111-0000-0000-aaaaaaaaaaaa'),
  1::bigint, 'el reintento no duplica movimientos (idempotente bajo el lock)'
);

-- 19) Anonimo denegado de plano.
set local request.jwt.claims to '{"role": "anon"}';
set local role anon;
select throws_ok(
  'select count(*) from ordenes_compra',
  '42501', 'permission denied for table ordenes_compra',
  'un anónimo no puede consultar órdenes de compra'
);

select * from finish();
rollback;
