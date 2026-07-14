begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'ana@a.cl'),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'beto@b.cl'),
  ('00000000-0000-0000-0000-000000000000', '55555555-5555-5555-5555-555555555555', 'authenticated', 'authenticated', 'ces@a.cl');

insert into public.organizaciones (id, rut, razon_social)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '761111116', 'Org A'),
       ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '762222221', 'Org B');

insert into public.empresas (id, organizacion_id, rut, razon_social)
values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '761111116', 'Empresa A'),
       ('eeeeeeee-0000-0000-0000-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '762222221', 'Empresa B');

insert into public.miembros (usuario_id, organizacion_id, rol)
values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'dueno'),
       ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'dueno'),
       ('55555555-5555-5555-5555-555555555555', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'contador');

insert into public.productos (id, empresa_id, sku, nombre, precio_neto)
values ('99999999-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'P1', 'Producto A', 1000);

insert into public.bodegas (id, empresa_id, nombre)
values ('bbbb0000-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'Bodega A');

-- Movimientos seed (como postgres, antes de cambiar de rol): +10, -3 => stock 7.
insert into public.movimientos_stock (empresa_id, producto_id, bodega_id, tipo, cantidad)
values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '99999999-0000-0000-0000-aaaaaaaaaaaa', 'bbbb0000-0000-0000-0000-aaaaaaaaaaaa', 'entrada', 10),
       ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '99999999-0000-0000-0000-aaaaaaaaaaaa', 'bbbb0000-0000-0000-0000-aaaaaaaaaaaa', 'salida', -3);

-- Ana (duena A).
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- 1) La vista de stock suma el libro: 10 - 3 = 7.
select is(
  (select cantidad from stock_actual where producto_id = '99999999-0000-0000-0000-aaaaaaaaaaaa'),
  7, 'stock_actual suma los movimientos (10 - 3 = 7)'
);

-- 2) Ana registra una entrada vía RPC.
select lives_ok(
  $$select registrar_entrada('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '99999999-0000-0000-0000-aaaaaaaaaaaa', 'bbbb0000-0000-0000-0000-aaaaaaaaaaaa', 5, null, 'Compra')$$,
  'la dueña registra una entrada'
);
-- 3) El stock refleja la entrada: 7 + 5 = 12.
select is(
  (select cantidad from stock_actual where producto_id = '99999999-0000-0000-0000-aaaaaaaaaaaa'),
  12, 'stock_actual refleja la entrada (7 + 5 = 12)'
);

-- 4) El libro es inmutable: no se puede update (ni siquiera la dueña).
select throws_ok(
  $$update movimientos_stock set cantidad = 999 where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'$$,
  '42501', null, 'los movimientos de stock son inmutables (update denegado)'
);

-- 5) bodega_por_defecto devuelve la bodega existente.
select is(
  (select bodega_por_defecto('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa')),
  'bbbb0000-0000-0000-0000-aaaaaaaaaaaa'::uuid,
  'bodega_por_defecto devuelve la bodega activa existente'
);

-- 6) Beto (org B) no ve el stock de A.
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
select is( (select count(*) from stock_actual), 0::bigint, 'Beto no ve el stock de la empresa A' );

-- 7) Beto no puede registrar entradas en A (cross-tenant).
select throws_ok(
  $$select registrar_entrada('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '99999999-0000-0000-0000-aaaaaaaaaaaa', 'bbbb0000-0000-0000-0000-aaaaaaaaaaaa', 1, null, 'x')$$,
  'P0001', 'Tu rol no permite registrar movimientos de stock',
  'Beto no puede registrar movimientos en la empresa A'
);

-- 8) Ces (contador de A) no puede registrar movimientos (rol sin permiso).
set local request.jwt.claims to '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated"}';
select throws_ok(
  $$select registrar_entrada('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '99999999-0000-0000-0000-aaaaaaaaaaaa', 'bbbb0000-0000-0000-0000-aaaaaaaaaaaa', 1, null, 'x')$$,
  'P0001', 'Tu rol no permite registrar movimientos de stock',
  'el contador no puede registrar movimientos'
);

-- 9) Anónimo denegado de plano.
set local request.jwt.claims to '{"role": "anon"}';
set local role anon;
select throws_ok(
  'select count(*) from movimientos_stock',
  '42501', 'permission denied for table movimientos_stock',
  'un anónimo no puede consultar movimientos'
);

select * from finish();
rollback;
