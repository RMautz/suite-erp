begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (instance_id, id, aud, role, email)
values ('00000000-0000-0000-0000-000000000000', '33333333-3333-3333-3333-333333333333', 'authenticated', 'authenticated', 'carla@nueva.cl');

set local role authenticated;
set local request.jwt.claims to '{"sub": "33333333-3333-3333-3333-333333333333", "role": "authenticated"}';

select lives_ok(
  $$select registrar_organizacion('76.543.210-3', 'Nueva SpA')$$,
  'un usuario autenticado puede registrar su organización'
);

select results_eq(
  'select razon_social, estado from organizaciones',
  $$values ('Nueva SpA'::text, 'trial'::text)$$,
  'la organización queda en trial y visible para su dueño'
);

select results_eq(
  'select rut from organizaciones',
  array['765432103'::text],
  'el RUT se guarda normalizado'
);

select results_eq(
  'select razon_social from empresas',
  array['Nueva SpA'::text],
  'se crea la empresa operativa homónima'
);

select results_eq(
  'select rol from miembros where usuario_id = auth.uid()',
  array['dueno'::text],
  'el usuario queda como dueño'
);

-- Mismo RUT lógico escrito distinto: la normalización lo detecta como duplicado.
select throws_ok(
  $$select registrar_organizacion('765432103', 'Duplicada SpA')$$,
  'P0001',
  'Ya existe una organización registrada con el RUT 765432103',
  'RUT duplicado (aun sin formato) da error claro en español'
);

select throws_ok(
  $$select registrar_organizacion('76.543.210-K', 'Inválida SpA')$$,
  'P0001',
  'El RUT ingresado no es válido',
  'RUT con dígito verificador incorrecto es rechazado por la BD'
);

select * from finish();
rollback;
