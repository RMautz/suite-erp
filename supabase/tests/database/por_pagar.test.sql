begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'ana@a.cl'),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'beto@b.cl'),
  ('00000000-0000-0000-0000-000000000000', '77777777-7777-7777-7777-777777777777', 'authenticated', 'authenticated', 'vero@a.cl');

insert into public.organizaciones (id, rut, razon_social)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '761111116', 'Org A'),
       ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '762222221', 'Org B');

insert into public.empresas (id, organizacion_id, rut, razon_social)
values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '761111116', 'Empresa A'),
       ('eeeeeeee-0000-0000-0000-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '762222221', 'Empresa B');

insert into public.miembros (usuario_id, organizacion_id, rol)
values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'dueno'),
       ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'dueno'),
       ('77777777-7777-7777-7777-777777777777', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'vendedor');

-- Proveedor A (condicion 30 dias para el test de vencimiento).
insert into public.proveedores (id, empresa_id, rut, razon_social, condicion_pago_dias)
values ('dddd0000-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '765432103', 'Proveedor A', 30);

-- F2: factura suelta VIEJA (emitida hace 60 dias => vencida), insertada como fixture.
insert into public.documentos_compra (id, empresa_id, proveedor_id, tipo, folio, fecha_emision, neto, exento, iva, total)
values ('f2f2f2f2-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'dddd0000-0000-0000-0000-aaaaaaaaaaaa',
        'factura', 200, current_date - 60, 42017, 0, 7983, 50000);

-- ===== Ana (duena A) =====
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- 1) La duena registra una factura por insert directo (F1, folio 100, 100000).
select lives_ok(
  $$insert into documentos_compra (id, empresa_id, proveedor_id, tipo, folio, fecha_emision, neto, exento, iva, total)
    values ('f1f1f1f1-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'dddd0000-0000-0000-0000-aaaaaaaaaaaa',
            'factura', 100, current_date, 84034, 0, 15966, 100000)$$,
  'la dueña registra una factura de compra'
);

-- 2) Doble digitacion del mismo folio rechazada (23505).
select throws_ok(
  $$insert into documentos_compra (empresa_id, proveedor_id, tipo, folio, fecha_emision, neto, exento, iva, total)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'dddd0000-0000-0000-0000-aaaaaaaaaaaa',
            'factura', 100, current_date, 84034, 0, 15966, 100000)$$,
  '23505', null,
  'no se puede digitar dos veces la misma factura del mismo proveedor'
);

-- ===== Vero (vendedora A): lee pero no escribe =====
set local request.jwt.claims to '{"sub": "77777777-7777-7777-7777-777777777777", "role": "authenticated"}';

-- 3) La vendedora VE las facturas (lectura de miembros).
select is( (select count(*) from documentos_compra), 2::bigint, 'la vendedora ve las facturas de su empresa' );

-- 4) La vendedora NO registra facturas (policy dueno/admin).
select throws_ok(
  $$insert into documentos_compra (empresa_id, proveedor_id, tipo, folio, fecha_emision, neto, exento, iva, total)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'dddd0000-0000-0000-0000-aaaaaaaaaaaa',
            'factura', 300, current_date, 100, 0, 19, 119)$$,
  '42501', 'new row violates row-level security policy for table "documentos_compra"',
  'la vendedora no puede registrar facturas de compra'
);

-- 5) La vendedora NO registra pagos.
select throws_ok(
  $$select registrar_pago_proveedor('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'dddd0000-0000-0000-0000-aaaaaaaaaaaa',
    current_date, 'transferencia', 100, null, null,
    '[{"documentoId":"f1f1f1f1-0000-0000-0000-aaaaaaaaaaaa","monto":100}]'::jsonb)$$,
  'P0001', 'Tu rol no permite registrar pagos a proveedores',
  'la vendedora no puede pagar a proveedores'
);

-- ===== Ana paga =====
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- 6) Pago multi-factura: 120000 = 100000 a F1 + 20000 a F2.
select lives_ok(
  $$select registrar_pago_proveedor('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'dddd0000-0000-0000-0000-aaaaaaaaaaaa',
    current_date, 'transferencia', 120000, 'OP-900', null,
    '[{"documentoId":"f1f1f1f1-0000-0000-0000-aaaaaaaaaaaa","monto":100000},
      {"documentoId":"f2f2f2f2-0000-0000-0000-aaaaaaaaaaaa","monto":20000}]'::jsonb)$$,
  'la dueña paga dos facturas con una transferencia'
);
-- 7) Saldo F1 = 0.
select is( (select saldo from saldos_compras where documento_id = 'f1f1f1f1-0000-0000-0000-aaaaaaaaaaaa'),
  0, 'F1 quedó saldada' );
-- 8) Saldo F2 = 30000.
select is( (select saldo from saldos_compras where documento_id = 'f2f2f2f2-0000-0000-0000-aaaaaaaaaaaa'),
  30000, 'F2 quedó con saldo 30000' );

-- 9) Sobre-pago rechazado con el saldo en el mensaje.
select throws_ok(
  $$select registrar_pago_proveedor('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'dddd0000-0000-0000-0000-aaaaaaaaaaaa',
    current_date, 'efectivo', 40000, null, null,
    '[{"documentoId":"f2f2f2f2-0000-0000-0000-aaaaaaaaaaaa","monto":40000}]'::jsonb)$$,
  'P0001', 'El monto aplicado supera el saldo del documento (saldo: $30000)',
  'no se puede pagar más que el saldo'
);

-- 10) Cuadratura rechazada.
select throws_ok(
  $$select registrar_pago_proveedor('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'dddd0000-0000-0000-0000-aaaaaaaaaaaa',
    current_date, 'efectivo', 100, null, null,
    '[{"documentoId":"f2f2f2f2-0000-0000-0000-aaaaaaaaaaaa","monto":50}]'::jsonb)$$,
  'P0001', 'La suma de las aplicaciones debe ser igual al monto del pago',
  'la cuadratura se valida'
);

-- 11) Anular F1 con pagos activos esta bloqueado.
select throws_ok(
  $$select anular_documento_compra('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'f1f1f1f1-0000-0000-0000-aaaaaaaaaaaa', 'error de digitación')$$,
  'P0001', 'La factura tiene pagos aplicados; anula primero esos pagos',
  'no se anula una factura con pagos activos'
);

-- 12) Ana anula el pago (con motivo).
select lives_ok(
  $$select anular_pago_proveedor('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from pagos_proveedor where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' limit 1), 'Transferencia devuelta')$$,
  'la dueña anula el pago con motivo'
);
-- 13) El saldo de F1 se restaura.
select is( (select saldo from saldos_compras where documento_id = 'f1f1f1f1-0000-0000-0000-aaaaaaaaaaaa'),
  100000, 'anular el pago restaura el saldo de F1' );

-- 14) Ahora F1 (sin pagos activos) SÍ se puede anular.
select lives_ok(
  $$select anular_documento_compra('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'f1f1f1f1-0000-0000-0000-aaaaaaaaaaaa', 'folio mal digitado')$$,
  'la factura sin pagos activos se anula con motivo'
);

-- 15) El libro de compras excluye la anulada (queda solo F2).
select is( (select count(*) from libro_compras), 1::bigint, 'el libro de compras excluye facturas anuladas' );

-- 16) F2 (emitida hace 60 dias, condicion 30) esta vencida.
select ok(
  (select fecha_vencimiento < current_date from saldos_compras where documento_id = 'f2f2f2f2-0000-0000-0000-aaaaaaaaaaaa'),
  'F2 está vencida (60 días desde emisión, condición 30)'
);

-- 17) Beto (org B) no ve nada.
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
select is(
  (select count(*) from saldos_compras) + (select count(*) from libro_compras) + (select count(*) from pagos_proveedor),
  0::bigint, 'Beto no ve cuentas por pagar de la empresa A'
);

-- 18) Anonimo denegado.
set local request.jwt.claims to '{"role": "anon"}';
set local role anon;
select throws_ok(
  'select count(*) from documentos_compra',
  '42501', 'permission denied for table documentos_compra',
  'un anónimo no puede consultar facturas de compra'
);

select * from finish();
rollback;
