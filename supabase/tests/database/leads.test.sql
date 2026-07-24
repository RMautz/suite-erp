begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

-- ===== RPC como ANON (el visitante de la landing no tiene sesion) =====
set local role anon;
set local request.jwt.claims to '{"role": "anon"}';

-- 1) Lead feliz retorna un numero de ticket comercial.
select is(
  (select crear_lead('Juan Pérez', 'juan@empresa.cl', '+56911112222', 'Quiero saber de precios') > 0),
  true,
  'un visitante anonimo deja su lead'
);

-- 2) Nombre vacio se rechaza.
select throws_ok(
  $$select crear_lead('   ', 'juan@empresa.cl', null, null)$$,
  'P0001', 'Dinos tu nombre',
  'nombre vacio se rechaza'
);

-- 3) Correo invalido se rechaza.
select throws_ok(
  $$select crear_lead('Juan', 'no-es-correo', null, null)$$,
  'P0001', 'Ingresa un correo válido',
  'correo invalido se rechaza'
);

-- 4) Mensaje demasiado largo se rechaza.
select throws_ok(
  $$select crear_lead('Juan', 'juan@empresa.cl', null, repeat('m', 1001))$$,
  'P0001', 'El mensaje es demasiado largo',
  'mensaje sobre 1000 se rechaza'
);

-- 5) Telefono demasiado largo se rechaza.
select throws_ok(
  $$select crear_lead('Juan', 'juan@empresa.cl', repeat('9', 31), null)$$,
  'P0001', 'Ingresa un teléfono válido',
  'telefono sobre 30 se rechaza'
);

-- 6) Anon NO lee leads (sin grant: datos comerciales de la plataforma).
select throws_ok(
  $$select count(*) from leads$$,
  '42501', 'permission denied for table leads',
  'anon no lee leads'
);

-- 7) Authenticated tampoco lee leads.
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-0000-0000-000000000001", "role": "authenticated"}';
select throws_ok(
  $$select count(*) from leads$$,
  '42501', 'permission denied for table leads',
  'authenticated no lee leads'
);

-- 8) Insert directo denegado incluso para authenticated (solo la RPC).
select throws_ok(
  $$insert into leads (nombre, email) values ('X', 'x@x.cl')$$,
  '42501', 'permission denied for table leads',
  'insert directo denegado'
);

select * from finish();
rollback;
