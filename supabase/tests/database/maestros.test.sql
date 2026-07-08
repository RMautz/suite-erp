begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

-- Usuarios: Ana (duena org A), Beto (dueno org B), Vito (vendedor org A).
insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'ana@empresa-a.cl'),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'beto@empresa-b.cl'),
  ('00000000-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444', 'authenticated', 'authenticated', 'vito@empresa-a.cl');

insert into public.organizaciones (id, rut, razon_social)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '761111116', 'Organización A'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '762222221', 'Organización B');

insert into public.empresas (id, organizacion_id, rut, razon_social)
values
  ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '761111116', 'Empresa A SpA'),
  ('eeeeeeee-0000-0000-0000-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '762222221', 'Empresa B SpA');

insert into public.miembros (usuario_id, organizacion_id, rol)
values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'dueno'),
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'dueno'),
  ('44444444-4444-4444-4444-444444444444', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'vendedor');

-- Producto seed de la empresa A (como service role implícito: rol postgres).
insert into public.productos (empresa_id, sku, nombre, precio_neto)
values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'A-001', 'Arroz', 12990);

-- 1-2) Ana (duena A): ve su producto y puede crear otro.
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select results_eq(
  'select count(*) from productos',
  array[1::bigint],
  'Ana ve exactamente su producto'
);

select lives_ok(
  $$insert into productos (empresa_id, sku, nombre, precio_neto)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'A-002', 'Azúcar', 8990)$$,
  'la dueña puede crear productos en su empresa'
);

-- 3) Beto (dueno B) no ve los productos de A.
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

select results_eq(
  'select count(*) from productos',
  array[0::bigint],
  'Beto no ve productos de la empresa A'
);

-- 4) Beto no puede crear productos en la empresa A.
select throws_ok(
  $$insert into productos (empresa_id, sku, nombre, precio_neto)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'X-1', 'Intruso', 1)$$,
  '42501',
  'new row violates row-level security policy for table "productos"',
  'Beto no puede crear productos en la empresa A'
);

-- 5-6) Vito (vendedor A): puede crear clientes pero NO productos.
set local request.jwt.claims to '{"sub": "44444444-4444-4444-4444-444444444444", "role": "authenticated"}';

select lives_ok(
  $$insert into clientes (empresa_id, rut, razon_social)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '765432103', 'Cliente Uno SpA')$$,
  'el vendedor puede crear clientes'
);

select throws_ok(
  $$insert into productos (empresa_id, sku, nombre, precio_neto)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'V-1', 'No debería', 1)$$,
  '42501',
  'new row violates row-level security policy for table "productos"',
  'el vendedor no puede crear productos'
);

-- 7-8) Checks de RUT en clientes: inválido y sin normalizar se rechazan.
select throws_ok(
  $$insert into clientes (empresa_id, rut, razon_social)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '765432104', 'DV Malo SpA')$$,
  '23514',
  null,
  'RUT con DV incorrecto viola el check'
);

select throws_ok(
  $$insert into clientes (empresa_id, rut, razon_social)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '76.543.210-3', 'Sin Normalizar SpA')$$,
  '23514',
  null,
  'RUT sin normalizar viola el check'
);

-- 9) Anónimo: denegado de plano.
set local request.jwt.claims to '{"role": "anon"}';
set local role anon;

select throws_ok(
  'select count(*) from productos',
  '42501',
  'permission denied for table productos',
  'un anónimo no puede consultar productos'
);

select * from finish();
rollback;
