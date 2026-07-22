begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

-- ===== Fixtures (superuser, patron whatsapp.test.sql) =====
-- Ana duena y Vero vendedora de la org A; Beto dueno de la org B; Caro sin organizacion.
insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', 'a1a1a1a1-c0c0-c0c0-c0c0-a1a1a1a1a1a1', 'authenticated', 'authenticated', 'ana@consultas.cl'),
  ('00000000-0000-0000-0000-000000000000', 'b2b2b2b2-c0c0-c0c0-c0c0-b2b2b2b2b2b2', 'authenticated', 'authenticated', 'beto@consultas.cl'),
  ('00000000-0000-0000-0000-000000000000', 'c3c3c3c3-c0c0-c0c0-c0c0-c3c3c3c3c3c3', 'authenticated', 'authenticated', 'caro@consultas.cl'),
  ('00000000-0000-0000-0000-000000000000', 'd4d4d4d4-c0c0-c0c0-c0c0-d4d4d4d4d4d4', 'authenticated', 'authenticated', 'vero@consultas.cl');

insert into public.organizaciones (id, rut, razon_social)
values
  ('aaaaaaaa-c0c0-c0c0-c0c0-aaaaaaaaaaaa', '769910042', 'Org Consultas A'),
  ('bbbbbbbb-c0c0-c0c0-c0c0-bbbbbbbbbbbb', '769910050', 'Org Consultas B');

insert into public.miembros (usuario_id, organizacion_id, rol)
values
  ('a1a1a1a1-c0c0-c0c0-c0c0-a1a1a1a1a1a1', 'aaaaaaaa-c0c0-c0c0-c0c0-aaaaaaaaaaaa', 'dueno'),
  ('b2b2b2b2-c0c0-c0c0-c0c0-b2b2b2b2b2b2', 'bbbbbbbb-c0c0-c0c0-c0c0-bbbbbbbbbbbb', 'dueno'),
  ('d4d4d4d4-c0c0-c0c0-c0c0-d4d4d4d4d4d4', 'aaaaaaaa-c0c0-c0c0-c0c0-aaaaaaaaaaaa', 'vendedor');

-- ===== RPC =====
-- 1) Ana crea una consulta.
set local role authenticated;
set local request.jwt.claims to '{"sub": "a1a1a1a1-c0c0-c0c0-c0c0-a1a1a1a1a1a1", "role": "authenticated"}';
select lives_ok(
  $$select crear_consulta_admin('Duda de facturacion', 'Como emito una nota de credito?')$$,
  'la duena crea una consulta'
);

-- 2) Queda abierta, con numero de ticket, origen web, su organizacion y su email.
reset role;
select is(
  (select estado = 'abierta'
      and numero is not null
      and origen = 'web'
      and organizacion_id = 'aaaaaaaa-c0c0-c0c0-c0c0-aaaaaaaaaaaa'
      and email = 'ana@consultas.cl'
      and respuesta is null
   from consultas_admin
   where usuario_id = 'a1a1a1a1-c0c0-c0c0-c0c0-a1a1a1a1a1a1'),
  true,
  'el ticket nace abierto, numerado y con origen web'
);

-- 3) Asunto vacio (solo espacios) se rechaza.
set local role authenticated;
set local request.jwt.claims to '{"sub": "a1a1a1a1-c0c0-c0c0-c0c0-a1a1a1a1a1a1", "role": "authenticated"}';
select throws_ok(
  $$select crear_consulta_admin('   ', 'hola')$$,
  'P0001', 'Escribe un asunto',
  'asunto vacio se rechaza'
);

-- 4) Mensaje vacio se rechaza.
select throws_ok(
  $$select crear_consulta_admin('Asunto', '')$$,
  'P0001', 'Escribe tu consulta',
  'mensaje vacio se rechaza'
);

-- 5) Asunto de mas de 200 caracteres se rechaza.
select throws_ok(
  $$select crear_consulta_admin(repeat('a', 201), 'hola')$$,
  'P0001', 'El asunto no puede superar los 200 caracteres',
  'asunto demasiado largo se rechaza'
);

-- 5b) Mensaje de mas de 5000 caracteres se rechaza (hallazgo review: rama sin test).
select throws_ok(
  $$select crear_consulta_admin('Asunto', repeat('m', 5001))$$,
  'P0001', 'La consulta no puede superar los 5000 caracteres',
  'mensaje demasiado largo se rechaza'
);

-- 6) Caro (sin organizacion) no puede consultar.
set local request.jwt.claims to '{"sub": "c3c3c3c3-c0c0-c0c0-c0c0-c3c3c3c3c3c3", "role": "authenticated"}';
select throws_ok(
  $$select crear_consulta_admin('Hola', 'Quiero una organizacion')$$,
  'P0001', 'Tu cuenta no tiene una organización',
  'sin membresia activa no hay consulta'
);

-- ===== RLS =====
-- 7) Beto (otra organizacion) ve 0 consultas.
set local request.jwt.claims to '{"sub": "b2b2b2b2-c0c0-c0c0-c0c0-b2b2b2b2b2b2", "role": "authenticated"}';
select is(
  (select count(*) from consultas_admin),
  0::bigint,
  'otra organizacion no ve consultas ajenas'
);

-- 8) Ana (duena y autora) ve la consulta de su organizacion.
set local request.jwt.claims to '{"sub": "a1a1a1a1-c0c0-c0c0-c0c0-a1a1a1a1a1a1", "role": "authenticated"}';
select is(
  (select count(*) from consultas_admin),
  1::bigint,
  'la organizacion autora ve su consulta'
);

-- 8b) Vero (vendedora de la MISMA org, no autora) ve 0: las consultas a plataforma
--     hablan de facturacion — solo autor y dueno/admin (hallazgo review 2026-07-22).
set local request.jwt.claims to '{"sub": "d4d4d4d4-c0c0-c0c0-c0c0-d4d4d4d4d4d4", "role": "authenticated"}';
select is(
  (select count(*) from consultas_admin),
  0::bigint,
  'un co-miembro sin rol admin no lee las consultas ajenas'
);

-- ===== Escritura directa: el grant es el candado =====
-- 9) Ni la autora inserta directo (solo la RPC).
select throws_ok(
  $$insert into consultas_admin (organizacion_id, usuario_id, email, asunto, mensaje)
    values ('aaaaaaaa-c0c0-c0c0-c0c0-aaaaaaaaaaaa', 'a1a1a1a1-c0c0-c0c0-c0c0-a1a1a1a1a1a1', 'x@x.cl', 'a', 'b')$$,
  '42501', 'permission denied for table consultas_admin',
  'insert directo denegado'
);

-- 10) Tampoco edita la respuesta (responder es del service_role del panel).
select throws_ok(
  $$update consultas_admin set respuesta = 'me la respondo sola'$$,
  '42501', 'permission denied for table consultas_admin',
  'update directo denegado'
);

-- ===== Alta por WhatsApp (crear_consulta_whatsapp, spec 2026-07-22b) =====
-- 11) authenticated NO ejecuta la variante del bot (exclusiva del webhook).
select throws_ok(
  $$select crear_consulta_whatsapp('a1a1a1a1-c0c0-c0c0-c0c0-a1a1a1a1a1a1', 'x', 'y')$$,
  '42501', 'permission denied for function crear_consulta_whatsapp',
  'crear_consulta_whatsapp vetada para authenticated'
);

-- 12) Como superuser (equivale a service_role): crea y el numero crece.
reset role;
select is(
  (select crear_consulta_whatsapp('a1a1a1a1-c0c0-c0c0-c0c0-a1a1a1a1a1a1', 'Desde el bot', 'No puedo emitir facturas')
     > (select max(numero) from consultas_admin where origen = 'web')),
  true,
  'el ticket del bot recibe un numero correlativo mayor'
);

-- 13) La fila del bot queda con origen whatsapp y el email del usuario del vinculo.
select is(
  (select origen = 'whatsapp' and email = 'ana@consultas.cl' and estado = 'abierta'
   from consultas_admin
   where asunto = 'Desde el bot'),
  true,
  'el ticket del bot nace con origen whatsapp'
);

-- 14) Usuario sin organizacion tampoco por el bot.
select throws_ok(
  $$select crear_consulta_whatsapp('c3c3c3c3-c0c0-c0c0-c0c0-c3c3c3c3c3c3', 'Hola', 'sin org')$$,
  'P0001', 'Tu cuenta no tiene una organización',
  'el bot no crea tickets para usuarios sin organizacion'
);

select * from finish();
rollback;
