begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

-- ===== Fixtures (superuser: salta grants/RLS, patron finiquitos) =====
-- Empresa A: Ana duena, Ces contador, Vero vendedora. Empresa B: Beto dueno.
insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', 'authenticated', 'authenticated', 'ana@wsp.cl'),
  ('00000000-0000-0000-0000-000000000000', 'c5c5c5c5-c5c5-c5c5-c5c5-c5c5c5c5c5c5', 'authenticated', 'authenticated', 'ces@wsp.cl'),
  ('00000000-0000-0000-0000-000000000000', 'b7b7b7b7-b7b7-b7b7-b7b7-b7b7b7b7b7b7', 'authenticated', 'authenticated', 'vero@wsp.cl'),
  ('00000000-0000-0000-0000-000000000000', 'd9d9d9d9-d9d9-d9d9-d9d9-d9d9d9d9d9d9', 'authenticated', 'authenticated', 'beto@wsp.cl');

insert into public.organizaciones (id, rut, razon_social)
values
  ('aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa', '769910026', 'Org WhatsApp A'),
  ('bbbbbbbb-0000-0000-0000-bbbbbbbbbbbb', '769910034', 'Org WhatsApp B');

insert into public.empresas (id, organizacion_id, rut, razon_social)
values
  ('eeeeeeee-0000-0000-0000-aaaaaaaaaa21', 'aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa', '769910026', 'WhatsApp A'),
  ('eeeeeeee-0000-0000-0000-bbbbbbbbbb21', 'bbbbbbbb-0000-0000-0000-bbbbbbbbbbbb', '769910034', 'WhatsApp B');

insert into public.miembros (usuario_id, organizacion_id, rol)
values
  ('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', 'aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa', 'dueno'),
  ('c5c5c5c5-c5c5-c5c5-c5c5-c5c5c5c5c5c5', 'aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa', 'contador'),
  ('b7b7b7b7-b7b7-b7b7-b7b7-b7b7b7b7b7b7', 'aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa', 'vendedor'),
  ('d9d9d9d9-d9d9-d9d9-d9d9-d9d9d9d9d9d9', 'bbbbbbbb-0000-0000-0000-bbbbbbbbbbbb', 'dueno');

-- ===== Solicitar =====
-- 1) Ana (duena) solicita: retorna uuid.
set local role authenticated;
set local request.jwt.claims to '{"sub": "a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1", "role": "authenticated"}';
select lives_ok(
  $$select solicitar_vinculo_whatsapp('eeeeeeee-0000-0000-0000-aaaaaaaaaa21', '+56911111111')$$,
  'la duena solicita un vinculo'
);

-- 2) El codigo queda de 6 digitos con expiracion futura (lectura como superuser).
reset role;
select is(
  (select codigo ~ '^[0-9]{6}$' and codigo_expira > now()
   from whatsapp_vinculos
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaa21' and telefono = '+56911111111'),
  true,
  'codigo de 6 digitos con expiracion de 10 minutos'
);

-- 3) Formato invalido (byte-exacto).
set local role authenticated;
set local request.jwt.claims to '{"sub": "a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1", "role": "authenticated"}';
select throws_ok(
  $$select solicitar_vinculo_whatsapp('eeeeeeee-0000-0000-0000-aaaaaaaaaa21', '56 9 1111')$$,
  'P0001', 'Teléfono no válido: usa formato internacional +56...',
  'telefono sin formato E.164 se rechaza'
);

-- 4) Vero (vendedora) no gestiona WhatsApp.
set local request.jwt.claims to '{"sub": "b7b7b7b7-b7b7-b7b7-b7b7-b7b7b7b7b7b7", "role": "authenticated"}';
select throws_ok(
  $$select solicitar_vinculo_whatsapp('eeeeeeee-0000-0000-0000-aaaaaaaaaa21', '+56911111111')$$,
  'P0001', 'Tu rol no permite gestionar WhatsApp',
  'el vendedor no solicita vinculos'
);

-- 5) Ces (contador) tampoco (gestionar es dueno/admin).
set local request.jwt.claims to '{"sub": "c5c5c5c5-c5c5-c5c5-c5c5-c5c5c5c5c5c5", "role": "authenticated"}';
select throws_ok(
  $$select solicitar_vinculo_whatsapp('eeeeeeee-0000-0000-0000-aaaaaaaaaa21', '+56911111111')$$,
  'P0001', 'Tu rol no permite gestionar WhatsApp',
  'el contador no solicita vinculos'
);

-- ===== Confirmar =====
-- 6) Codigo incorrecto.
set local request.jwt.claims to '{"sub": "a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1", "role": "authenticated"}';
select throws_ok(
  $$select confirmar_vinculo_whatsapp('eeeeeeee-0000-0000-0000-aaaaaaaaaa21',
    (select id from whatsapp_vinculos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaa21' and telefono = '+56911111111'),
    '000000')$$,
  'P0001', 'Código incorrecto o expirado',
  'codigo incorrecto no confirma'
);

-- 7) Regeneracion: re-solicitar el mismo telefono pendiente vive.
select lives_ok(
  $$select solicitar_vinculo_whatsapp('eeeeeeee-0000-0000-0000-aaaaaaaaaa21', '+56911111111')$$,
  're-solicitar regenera el codigo'
);

-- 8) ... sobre la MISMA fila (no crea duplicados pendientes).
reset role;
select is(
  (select count(*) from whatsapp_vinculos
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaa21' and telefono = '+56911111111'),
  1::bigint,
  'la regeneracion reusa la fila pendiente'
);

-- 9) Confirmar feliz: fixture con codigo conocido (superuser lo fija).
update whatsapp_vinculos set codigo = '123456', codigo_expira = now() + interval '10 minutes'
where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaa21' and telefono = '+56911111111';
set local role authenticated;
set local request.jwt.claims to '{"sub": "a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1", "role": "authenticated"}';
select lives_ok(
  $$select confirmar_vinculo_whatsapp('eeeeeeee-0000-0000-0000-aaaaaaaaaa21',
    (select id from whatsapp_vinculos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaa21' and telefono = '+56911111111'),
    '123456')$$,
  'la duena confirma con el codigo correcto'
);

-- 10) Queda verificado y sin codigo.
reset role;
select is(
  (select verificado_en is not null and codigo is null and codigo_expira is null
   from whatsapp_vinculos
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaa21' and telefono = '+56911111111'),
  true,
  'confirmar marca verificado_en y limpia el codigo'
);

-- 11) Expirado: Beto (empresa B) solicita y el superuser vence el codigo.
set local role authenticated;
set local request.jwt.claims to '{"sub": "d9d9d9d9-d9d9-d9d9-d9d9-d9d9d9d9d9d9", "role": "authenticated"}';
-- (fixture: beto solicita en la empresa B; no cuenta como assert, ver nota Step 2 del brief)
select solicitar_vinculo_whatsapp('eeeeeeee-0000-0000-0000-bbbbbbbbbb21', '+56922222222');
reset role;
update whatsapp_vinculos set codigo = '654321', codigo_expira = now() - interval '1 minute'
where empresa_id = 'eeeeeeee-0000-0000-0000-bbbbbbbbbb21' and telefono = '+56922222222';
set local role authenticated;
set local request.jwt.claims to '{"sub": "d9d9d9d9-d9d9-d9d9-d9d9-d9d9d9d9d9d9", "role": "authenticated"}';
select throws_ok(
  $$select confirmar_vinculo_whatsapp('eeeeeeee-0000-0000-0000-bbbbbbbbbb21',
    (select id from whatsapp_vinculos where empresa_id = 'eeeeeeee-0000-0000-0000-bbbbbbbbbb21' and telefono = '+56922222222'),
    '654321')$$,
  'P0001', 'Código incorrecto o expirado',
  'codigo expirado no confirma (fixture con expiracion vencida)'
);

-- ===== Duplicado cross-empresa (unique parcial de PLATAFORMA) =====
-- 12) Beto puede SOLICITAR el telefono ya verificado por Ana (fila pendiente propia)...
select lives_ok(
  $$select solicitar_vinculo_whatsapp('eeeeeeee-0000-0000-0000-bbbbbbbbbb21', '+56911111111')$$,
  'solicitar un telefono ajeno vive (el candado es al confirmar)'
);

-- 13) ... pero CONFIRMARLO choca con el unique parcial (mensaje byte-exacto).
reset role;
update whatsapp_vinculos set codigo = '111111', codigo_expira = now() + interval '10 minutes'
where empresa_id = 'eeeeeeee-0000-0000-0000-bbbbbbbbbb21' and telefono = '+56911111111';
set local role authenticated;
set local request.jwt.claims to '{"sub": "d9d9d9d9-d9d9-d9d9-d9d9-d9d9d9d9d9d9", "role": "authenticated"}';
select throws_ok(
  $$select confirmar_vinculo_whatsapp('eeeeeeee-0000-0000-0000-bbbbbbbbbb21',
    (select id from whatsapp_vinculos where empresa_id = 'eeeeeeee-0000-0000-0000-bbbbbbbbbb21' and telefono = '+56911111111'),
    '111111')$$,
  'P0001', 'Ese teléfono ya está vinculado a otra cuenta',
  'un telefono verificado en la plataforma no se vincula dos veces'
);

-- ===== RLS y escritura directa =====
-- 14) Vero (vendedora) ve 0 filas en ambas tablas.
set local request.jwt.claims to '{"sub": "b7b7b7b7-b7b7-b7b7-b7b7-b7b7b7b7b7b7", "role": "authenticated"}';
select is(
  (select count(*) from whatsapp_vinculos) + (select count(*) from whatsapp_mensajes),
  0::bigint,
  'el vendedor no ve vinculos ni mensajes'
);

-- 15) Ni la duena inserta vinculos directo (grant = candado, solo RPCs).
set local request.jwt.claims to '{"sub": "a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1", "role": "authenticated"}';
select throws_ok(
  $$insert into whatsapp_vinculos (empresa_id, usuario_id, telefono)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaa21', 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', '+56933333333')$$,
  '42501', 'permission denied for table whatsapp_vinculos',
  'ni la duena escribe vinculos directamente'
);

-- 16) La duena SI registra mensajes (acciones de la app: cobranza/vinculacion).
select lives_ok(
  $$insert into whatsapp_mensajes (empresa_id, telefono, direccion, origen, contenido, referencia_id)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaa21', '+56987654321', 'saliente', 'cobranza',
            'Recordatorio de prueba', gen_random_uuid())$$,
  'la duena inserta un mensaje saliente de cobranza'
);

-- 17) Log inmutable: sin UPDATE.
select throws_ok(
  $$update whatsapp_mensajes set contenido = 'editado'
    where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaa21'$$,
  '42501', 'permission denied for table whatsapp_mensajes',
  'un mensaje registrado no se edita'
);

-- 18) Log inmutable: sin DELETE.
select throws_ok(
  $$delete from whatsapp_mensajes where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaa21'$$,
  '42501', 'permission denied for table whatsapp_mensajes',
  'un mensaje registrado no se borra'
);

-- 19) Ces (contador) SI ve los mensajes (audita la gestion de cobranza).
set local request.jwt.claims to '{"sub": "c5c5c5c5-c5c5-c5c5-c5c5-c5c5c5c5c5c5", "role": "authenticated"}';
select is(
  (select count(*) from whatsapp_mensajes where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaa21'),
  1::bigint,
  'el contador ve el log de mensajes'
);

-- ===== Desvincular =====
-- 20) Ana desvincula su telefono verificado.
set local request.jwt.claims to '{"sub": "a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1", "role": "authenticated"}';
select lives_ok(
  $$select desvincular_whatsapp('eeeeeeee-0000-0000-0000-aaaaaaaaaa21',
    (select id from whatsapp_vinculos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaa21' and telefono = '+56911111111'))$$,
  'la duena desvincula'
);

-- 21) El vinculo queda inactivo (y libera el telefono en la plataforma).
reset role;
select is(
  (select activo from whatsapp_vinculos
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaa21' and telefono = '+56911111111'),
  false,
  'desvincular deja activo = false'
);

-- ===== semaforo_whatsapp (wrapper del bot, SOLO service_role) =====
-- 22) Como superuser (bypassa grants, igual que service_role): retorna el payload
--     de revision_periodo impersonando a Ana (duena).
select is(
  (select (semaforo_whatsapp('eeeeeeee-0000-0000-0000-aaaaaaaaaa21',
                             'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', 2026, 7)) ? 'estado'),
  true,
  'semaforo_whatsapp retorna el payload del auditor para el usuario del vinculo'
);

-- 23) authenticated NO puede ejecutarlo (revocado: es exclusivo del webhook).
set local role authenticated;
set local request.jwt.claims to '{"sub": "a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1", "role": "authenticated"}';
select throws_ok(
  $$select semaforo_whatsapp('eeeeeeee-0000-0000-0000-aaaaaaaaaa21',
    'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', 2026, 7)$$,
  '42501', 'permission denied for function semaforo_whatsapp',
  'semaforo_whatsapp esta vetado para authenticated'
);

select * from finish();
rollback;
