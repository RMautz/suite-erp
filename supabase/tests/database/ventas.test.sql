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

insert into public.clientes (id, empresa_id, rut, razon_social)
values ('cccccccc-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '765432103', 'Cliente A');

insert into public.productos (id, empresa_id, sku, nombre, precio_neto, exento)
values ('99999999-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'P1', 'Producto A', 10000, false);

insert into public.folios_caf (empresa_id, tipo_documento, desde, hasta, siguiente, xml_caf)
values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'factura', 100, 102, 100, '<CAF/>');

-- Ana (duena A) toma folios atómicamente: 100, luego 101.
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select is( (select public.tomar_folio('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'factura')), 100, 'primer folio es 100' );
select is( (select public.tomar_folio('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'factura')), 101, 'segundo folio es 101 (no repite)' );

-- Ana crea una nota de venta SOLO vía la RPC (único camino de escritura permitido).
select lives_ok(
  $$select crear_documento_venta('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 'nota_venta',
    '[{"productoId":"99999999-0000-0000-0000-aaaaaaaaaaaa","cantidad":2}]'::jsonb)$$,
  'la dueña crea una nota de venta vía crear_documento_venta'
);
-- El IVA sale del producto (2 x 10000 x 0.19 = 3800), no de lo que envíe el cliente.
select is(
  (select iva from documentos_venta where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' limit 1),
  3800, 'el IVA se calcula del producto'
);

-- Beto (org B) no ve los documentos de A.
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
select is( (select count(*) from documentos_venta), 0::bigint, 'Beto no ve documentos de la empresa A' );

-- Beto no puede crear ventas en la empresa A (la RPC valida pertenencia).
select throws_ok(
  $$select crear_documento_venta('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 'nota_venta',
    '[{"productoId":"99999999-0000-0000-0000-aaaaaaaaaaaa","cantidad":1}]'::jsonb)$$,
  'P0001', 'Tu rol no permite crear ventas',
  'Beto no puede crear ventas en la empresa A'
);

-- Beto no puede tomar folios de la empresa A (cross-tenant).
select throws_ok(
  $$select public.tomar_folio('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'factura')$$,
  'P0001', 'No tienes permiso para emitir documentos en esta empresa',
  'Beto no puede tomar folios de la empresa A (cross-tenant)'
);

-- Ces (contador de A) NO puede crear ventas (rol sin permiso).
set local request.jwt.claims to '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated"}';
select throws_ok(
  $$select crear_documento_venta('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 'nota_venta',
    '[{"productoId":"99999999-0000-0000-0000-aaaaaaaaaaaa","cantidad":1}]'::jsonb)$$,
  'P0001', 'Tu rol no permite crear ventas',
  'el contador no puede crear ventas'
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
