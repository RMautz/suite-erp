begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

-- Dos usuarios y dos organizaciones independientes.
insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'ana@empresa-a.cl'),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'beto@empresa-b.cl');

insert into public.organizaciones (id, rut, razon_social)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '76111111-6', 'Organización A'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '76222222-1', 'Organización B');

insert into public.empresas (organizacion_id, rut, razon_social)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '76111111-6', 'Empresa A SpA'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '76222222-1', 'Empresa B SpA');

insert into public.miembros (usuario_id, organizacion_id, rol)
values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'dueno'),
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'dueno');

-- Impersonar a Ana (organización A).
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select results_eq(
  'select count(*) from organizaciones',
  array[1::bigint],
  'Ana ve exactamente una organización'
);

select results_eq(
  'select razon_social from organizaciones',
  array['Organización A'::text],
  'Ana ve solo la organización A'
);

select results_eq(
  'select razon_social from empresas',
  array['Empresa A SpA'::text],
  'Ana ve solo la empresa A'
);

select results_eq(
  'select count(*) from miembros',
  array[1::bigint],
  'Ana ve solo los miembros de su organización'
);

-- Escrituras cruzadas: Ana no puede crear empresas en la organización B.
select throws_ok(
  $$insert into empresas (organizacion_id, rut, razon_social)
    values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '76333333-7', 'Intrusa SpA')$$,
  '42501',
  'new row violates row-level security policy for table "empresas"',
  'Ana no puede insertar empresas en la organización B'
);

-- Usuario anónimo: sin grant sobre organizaciones, el acceso se deniega
-- de plano (42501) — más estricto que ver una lista vacía.
set local request.jwt.claims to '{"role": "anon"}';
set local role anon;

select throws_ok(
  'select count(*) from organizaciones',
  '42501',
  'permission denied for table organizaciones',
  'Un anónimo no puede consultar organizaciones'
);

select * from finish();
rollback;
