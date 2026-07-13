begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

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

insert into public.clientes (id, empresa_id, rut, razon_social)
values ('cccccccc-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '765432103', 'Cliente A');

insert into public.folios_caf (empresa_id, tipo_documento, desde, hasta, siguiente, xml_caf)
values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'factura', 100, 102, 100, '<CAF/>');

-- Ana (duena A) toma folios atómicamente: 100, luego 101.
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select is( (select app.tomar_folio('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'factura')), 100, 'primer folio es 100' );
select is( (select app.tomar_folio('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'factura')), 101, 'segundo folio es 101 (no repite)' );

-- Ana crea un documento y su línea.
select lives_ok(
  $$insert into documentos_venta (id, empresa_id, tipo, cliente_id, total)
    values ('dddddddd-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'factura', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 11900)$$,
  'la dueña crea un documento de venta'
);
select lives_ok(
  $$insert into documentos_venta_lineas (empresa_id, documento_id, descripcion, cantidad, precio_neto, subtotal)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'dddddddd-0000-0000-0000-aaaaaaaaaaaa', 'Item', 1, 10000, 10000)$$,
  'la dueña agrega una línea'
);

-- Beto (org B) no ve los documentos de A.
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
select is( (select count(*) from documentos_venta), 0::bigint, 'Beto no ve documentos de la empresa A' );

-- Beto no puede crear documentos en la empresa A.
select throws_ok(
  $$insert into documentos_venta (empresa_id, tipo, cliente_id, total)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'factura', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 1)$$,
  '42501', null, 'Beto no puede crear documentos en la empresa A'
);

-- Ces (contador de A) NO puede crear documentos (rol sin permiso de venta): RLS filtra el insert.
set local request.jwt.claims to '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated"}';
select throws_ok(
  $$insert into documentos_venta (empresa_id, tipo, cliente_id, total)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'factura', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 1)$$,
  '42501', null, 'el contador no puede crear documentos de venta'
);

-- Anónimo denegado de plano.
set local request.jwt.claims to '{"role": "anon"}';
set local role anon;
select throws_ok(
  'select count(*) from documentos_venta',
  '42501', 'permission denied for table documentos_venta',
  'un anónimo no puede consultar documentos'
);

select * from finish();
rollback;
