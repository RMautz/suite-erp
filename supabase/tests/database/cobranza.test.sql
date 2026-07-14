begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'ana@a.cl'),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'beto@b.cl'),
  ('00000000-0000-0000-0000-000000000000', '55555555-5555-5555-5555-555555555555', 'authenticated', 'authenticated', 'ces@a.cl'),
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
       ('55555555-5555-5555-5555-555555555555', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'contador'),
       ('77777777-7777-7777-7777-777777777777', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'vendedor');

-- Clientes: A1 (30 dias) y A2 (otro cliente, para el test de pertenencia).
insert into public.clientes (id, empresa_id, rut, razon_social, condicion_pago_dias)
values ('cccccccc-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '765432103', 'Cliente A1', 30),
       ('cccccccc-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '761111116', 'Cliente A2', 0);

-- Documentos cobrables: doc1 (100000, reciente) y doc2 (50000, emitido hace 60 dias => VENCIDO).
insert into public.documentos_venta (id, empresa_id, tipo, cliente_id, folio, estado, neto, exento, iva, total, emitido_en)
values ('dddddddd-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'factura',
        'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 1, 'emitido', 84034, 0, 15966, 100000, now()),
       ('dddddddd-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'factura',
        'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 2, 'emitido', 42017, 0, 7983, 50000, now() - interval '60 days');

-- ===== Vero (vendedora A) registra un pago multi-documento =====
set local role authenticated;
set local request.jwt.claims to '{"sub": "77777777-7777-7777-7777-777777777777", "role": "authenticated"}';

-- 1) Pago de 60000: 40000 a doc1 + 20000 a doc2.
select lives_ok(
  $$select registrar_pago('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
    current_date, 'transferencia', 60000, 'OP-123', null,
    '[{"documentoId":"dddddddd-0000-0000-0000-000000000001","monto":40000},
      {"documentoId":"dddddddd-0000-0000-0000-000000000002","monto":20000}]'::jsonb)$$,
  'la vendedora registra un pago multi-documento'
);
-- 2) Saldo doc1 = 60000.
select is( (select saldo from saldos_documentos where documento_id = 'dddddddd-0000-0000-0000-000000000001'),
  60000, 'el saldo del doc1 baja a 60000' );
-- 3) Saldo doc2 = 30000.
select is( (select saldo from saldos_documentos where documento_id = 'dddddddd-0000-0000-0000-000000000002'),
  30000, 'el saldo del doc2 baja a 30000' );

-- 4) Sobre-aplicacion rechazada con el saldo en el mensaje.
select throws_ok(
  $$select registrar_pago('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
    current_date, 'efectivo', 70000, null, null,
    '[{"documentoId":"dddddddd-0000-0000-0000-000000000001","monto":70000}]'::jsonb)$$,
  'P0001', 'El monto aplicado supera el saldo del documento (saldo: $60000)',
  'la sobre-aplicación se rechaza con el saldo en el mensaje'
);

-- 5) Cuadratura rechazada (monto 100, aplicaciones suman 50).
select throws_ok(
  $$select registrar_pago('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
    current_date, 'efectivo', 100, null, null,
    '[{"documentoId":"dddddddd-0000-0000-0000-000000000001","monto":50}]'::jsonb)$$,
  'P0001', 'La suma de las aplicaciones debe ser igual al monto del pago',
  'la cuadratura se valida'
);

-- 6) Pago a documento de OTRO cliente rechazado (doc de A1 con cliente A2).
select throws_ok(
  $$select registrar_pago('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-000000000002',
    current_date, 'efectivo', 100, null, null,
    '[{"documentoId":"dddddddd-0000-0000-0000-000000000001","monto":100}]'::jsonb)$$,
  'P0001', 'Documento no cobrable o no pertenece al cliente',
  'no se puede pagar el documento de otro cliente'
);

-- 7) Vero (vendedora) NO anula.
select throws_ok(
  $$select anular_pago('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from pagos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' limit 1), 'error')$$,
  'P0001', 'Tu rol no permite anular pagos',
  'la vendedora no puede anular pagos'
);

-- 8) Ces (contador) NO registra pagos.
set local request.jwt.claims to '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated"}';
select throws_ok(
  $$select registrar_pago('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
    current_date, 'efectivo', 100, null, null,
    '[{"documentoId":"dddddddd-0000-0000-0000-000000000001","monto":100}]'::jsonb)$$,
  'P0001', 'Tu rol no permite registrar pagos',
  'el contador no puede registrar pagos'
);

-- ===== Ana (duena A) anula =====
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- 9) Anulacion sin motivo rechazada.
select throws_ok(
  $$select anular_pago('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from pagos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' limit 1), '  ')$$,
  'P0001', 'La anulación requiere un motivo',
  'anular exige motivo'
);
-- 10) Ana anula el pago con motivo.
select lives_ok(
  $$select anular_pago('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from pagos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' limit 1), 'Registrado por error')$$,
  'la dueña anula el pago con motivo'
);
-- 11) El saldo del doc1 se restaura a 100000.
select is( (select saldo from saldos_documentos where documento_id = 'dddddddd-0000-0000-0000-000000000001'),
  100000, 'anular el pago restaura el saldo' );
-- 12) Doble anulacion falla.
select throws_ok(
  $$select anular_pago('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from pagos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' limit 1), 'de nuevo')$$,
  'P0001', 'El pago no existe o ya está anulado',
  'no se puede anular dos veces'
);

-- 13) Una NC emitida neta el saldo del documento original.
set local role postgres;
insert into public.documentos_venta (id, empresa_id, tipo, cliente_id, folio, estado, neto, exento, iva, total, documento_referencia_id, emitido_en)
values ('dddddddd-0000-0000-0000-00000000000c', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'nota_credito',
        'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 1, 'emitido', 84034, 0, 15966, 100000,
        'dddddddd-0000-0000-0000-000000000001', now());
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select is( (select saldo from saldos_documentos where documento_id = 'dddddddd-0000-0000-0000-000000000001'),
  0, 'la nota de crédito neta el saldo del original' );

-- 14) El doc2 (emitido hace 60 dias, condicion 30) aparece VENCIDO.
select ok(
  (select fecha_vencimiento < current_date from saldos_documentos where documento_id = 'dddddddd-0000-0000-0000-000000000002'),
  'el doc2 está vencido (emitido hace 60 días, condición 30)'
);

-- 15) Beto (org B) no ve pagos ni saldos de A.
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
select is( (select count(*) from pagos) + (select count(*) from saldos_documentos), 0::bigint,
  'Beto no ve pagos ni saldos de la empresa A' );

-- 16) Anonimo denegado de plano.
set local request.jwt.claims to '{"role": "anon"}';
set local role anon;
select throws_ok(
  'select count(*) from pagos',
  '42501', 'permission denied for table pagos',
  'un anónimo no puede consultar pagos'
);

select * from finish();
rollback;
