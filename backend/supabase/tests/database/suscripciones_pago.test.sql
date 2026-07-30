begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'ana@s.cl'),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'beto@s.cl'),
  ('00000000-0000-0000-0000-000000000000', '77777777-7777-7777-7777-777777777777', 'authenticated', 'authenticated', 'vero@s.cl');

-- Plan gratis (precio 0) para el caso "El plan actual no requiere pago". El seed de
-- 0001 solo trae Básico/Pro/Empresa (todos > 0); este es el único precio 0 de la suite.
insert into public.planes (id, nombre, precio_clp)
values ('00000000-0000-0000-0000-0000000000f0', 'Gratis', 0);

-- ===== Orgs por el CAMINO REAL (registrar_organizacion): cada una nace con plan
--       Básico (29990 > 0), estado 'trial', trial_hasta = current_date + 14 y una
--       fila suscripciones con hasta nulo. Ana es dueña de A/C/SP/P0/IDEM/X. =====
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select registrar_organizacion('777000012', 'Org A');      -- feliz + candados
select registrar_organizacion('777000020', 'Org C');      -- extensión con hasta futuro
select registrar_organizacion('777000039', 'Org SP');     -- se le quita el plan
select registrar_organizacion('777000047', 'Org P0');     -- se le pone el plan gratis
select registrar_organizacion('777000055', 'Org IDEM');   -- revisión sin extender
select registrar_organizacion('777000063', 'Org X');      -- abortado -> confirmado

-- Beto: dueño de B (otra org, para rol cross-org y aislamiento RLS).
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
select registrar_organizacion('777000071', 'Org B');

-- ===== Ajustes de fixtures (superusuario: salta grants/RLS) =====
set local role postgres;

-- Vero, vendedora de A (rol sin permiso de pago).
insert into public.miembros (usuario_id, organizacion_id, rol)
values ('77777777-7777-7777-7777-777777777777',
        (select id from organizaciones where rut = '777000012'), 'vendedor');

-- Org C: ya activa y pagada hasta una fecha FUTURA (para probar greatest).
update public.suscripciones set hasta = current_date + 90
  where organizacion_id = (select id from organizaciones where rut = '777000020');
update public.organizaciones set estado = 'activa' where rut = '777000020';

-- Org SP: sin plan asignado. Org P0: plan precio 0.
update public.organizaciones set plan_id = null where rut = '777000039';
update public.organizaciones set plan_id = '00000000-0000-0000-0000-0000000000f0' where rut = '777000047';

-- Pagos sembrados (ids fijos) para confirmar/abortar. monto = precio Básico (29990);
-- confirmar compara p_monto contra ESTE monto, no contra el plan.
insert into public.pagos_suscripcion (id, organizacion_id, plan_id, monto, pasarela, buy_order, estado)
values
  ('a0000001-0000-0000-0000-000000000001', (select id from organizaciones where rut = '777000012'),
   (select id from planes where nombre = 'Básico'), 29990, 'mercadopago', 'bopa', 'pendiente'),
  ('a0000002-0000-0000-0000-000000000002', (select id from organizaciones where rut = '777000020'),
   (select id from planes where nombre = 'Básico'), 29990, 'mercadopago', 'bopc', 'pendiente'),
  ('a0000003-0000-0000-0000-000000000003', (select id from organizaciones where rut = '777000055'),
   (select id from planes where nombre = 'Básico'), 29990, 'mercadopago', 'bopr', 'pendiente'),
  ('a0000004-0000-0000-0000-000000000004', (select id from organizaciones where rut = '777000063'),
   (select id from planes where nombre = 'Básico'), 29990, 'mercadopago', 'bopx', 'pendiente'),
  -- Backstop 23505 (assert 26): un segundo pendiente mercadopago de A; se confirma con la
  -- MISMA referencia 'mp:pa' que PA ya acredito -> colision en el indice unico parcial.
  ('a0000005-0000-0000-0000-000000000005', (select id from organizaciones where rut = '777000012'),
   (select id from planes where nombre = 'Básico'), 29990, 'mercadopago', 'bopb', 'pendiente');

-- ===== crear_pago_suscripcion (authenticated; rol dueño/admin) =====
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- 1) Feliz: retorna un id de pago.
select ok(
  (crear_pago_suscripcion((select id from organizaciones where rut = '777000012'), 'mercadopago') ->> 'id') is not null,
  'crear_pago_suscripcion feliz retorna un id de pago'
);

-- 2) Feliz: el buy_order es de 25 caracteres alfanuméricos (hex de gen_random_uuid).
select ok(
  (crear_pago_suscripcion((select id from organizaciones where rut = '777000012'), 'webpay') ->> 'buy_order') ~ '^[0-9a-f]{25}$',
  'el buy_order es de 25 caracteres alfanuméricos'
);

-- 5) Org sin plan (plan_id nulo).
select throws_ok(
  $$select crear_pago_suscripcion((select id from organizaciones where rut = '777000039'), 'mercadopago')$$,
  'P0001', 'La organización no tiene un plan asignado',
  'una org sin plan no puede pagar'
);

-- 6) Plan precio 0.
select throws_ok(
  $$select crear_pago_suscripcion((select id from organizaciones where rut = '777000047'), 'mercadopago')$$,
  'P0001', 'El plan actual no requiere pago',
  'un plan de precio 0 no ofrece pago'
);

-- 7) Pasarela inválida (rol y plan OK, pasarela no soportada).
select throws_ok(
  $$select crear_pago_suscripcion((select id from organizaciones where rut = '777000012'), 'paypal')$$,
  'P0001', 'Método de pago no soportado',
  'una pasarela desconocida es rechazada'
);

-- 3) Vendedora de la MISMA org: sin permiso de pago.
set local request.jwt.claims to '{"sub": "77777777-7777-7777-7777-777777777777", "role": "authenticated"}';
select throws_ok(
  $$select crear_pago_suscripcion((select id from organizaciones where rut = '777000012'), 'mercadopago')$$,
  'P0001', 'Tu rol no permite pagar la suscripción',
  'un vendedor no puede pagar la suscripción'
);

-- 4) Dueño de OTRA org (Beto no es miembro de A): mismo mensaje de rol.
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
select throws_ok(
  $$select crear_pago_suscripcion((select id from organizaciones where rut = '777000012'), 'mercadopago')$$,
  'P0001', 'Tu rol no permite pagar la suscripción',
  'un miembro de otra org no puede pagar una suscripción ajena'
);

-- ===== confirmar / abortar (SOLO service_role) =====
set local role service_role;

-- 8) Feliz: confirmar extiende y retorna 'extendido' (A: trial, hasta nulo).
select is(
  confirmar_pago_suscripcion('a0000001-0000-0000-0000-000000000001', 'mp:pa', 29990),
  'extendido',
  'confirmar un pago pendiente retorna extendido'
);

-- 9) Idempotente: el segundo confirmar del mismo pago (ya pagado) es 'noop' y no re-extiende.
select is(
  confirmar_pago_suscripcion('a0000001-0000-0000-0000-000000000001', 'mp:pa', 29990),
  'noop',
  'reconfirmar un pago ya pagado es noop'
);

-- Setup EXT2: confirmar el pago de C (hasta futuro) — leído por el assert 18.
select confirmar_pago_suscripcion('a0000002-0000-0000-0000-000000000002', 'mp:pc', 29990);

-- 10) Monto distinto al del pago → 'revision' (no extiende).
select is(
  confirmar_pago_suscripcion('a0000003-0000-0000-0000-000000000003', 'mp:pr', 999),
  'revision',
  'confirmar con un monto distinto marca revision'
);

-- 11) Abortar degrada un pendiente a 'abortado' (setup del assert; leído a continuación).
select abortar_pago_suscripcion('a0000004-0000-0000-0000-000000000004');
select is(
  (select estado from pagos_suscripcion where id = 'a0000004-0000-0000-0000-000000000004'),
  'abortado',
  'abortar degrada un pago pendiente a abortado'
);

-- 12) Confirmar sobre un abortado GANA: la plata real vence a la anulación de UI.
select is(
  confirmar_pago_suscripcion('a0000004-0000-0000-0000-000000000004', 'mp:px', 29990),
  'extendido',
  'confirmar sobre un abortado extiende igual (la plata real gana)'
);

-- 13) Abortar NO degrada un pago ya pagado (setup + assert): PA quedó 'pagado'.
select abortar_pago_suscripcion('a0000001-0000-0000-0000-000000000001');
select is(
  (select estado from pagos_suscripcion where id = 'a0000001-0000-0000-0000-000000000001'),
  'pagado',
  'abortar no degrada un pago ya pagado'
);

-- 14) Confirmar un pago inexistente lanza.
select throws_ok(
  $$select confirmar_pago_suscripcion('dead0000-0000-0000-0000-000000000000', 'mp:none', 1)$$,
  'P0001', 'El pago no existe',
  'confirmar un pago inexistente lanza'
);

-- 15) hasta se extiende un mes desde trial_hasta (A nació en trial con hasta nulo:
--     greatest(current_date, coalesce(null, trial_hasta, current_date)) + 1 mes).
select is(
  (select hasta from suscripciones
   where organizacion_id = (select id from organizaciones where rut = '777000012')),
  ((current_date + 14) + interval '1 month')::date,
  'la suscripción se extiende un mes desde trial_hasta'
);

-- 16) La org queda activa tras pagar (trial -> activa).
select is(
  (select estado from organizaciones where rut = '777000012'),
  'activa',
  'la org queda activa tras el pago'
);

-- 17) Extensión desde trial: hasta NO colapsa a current_date + 1 mes (usó trial_hasta).
select ok(
  (select hasta from suscripciones
   where organizacion_id = (select id from organizaciones where rut = '777000012'))
  <> (current_date + interval '1 month')::date,
  'pagar en trial extiende desde trial_hasta, no desde hoy'
);

-- 18) Extensión con hasta futuro: greatest extiende desde hasta (current_date + 90), no desde hoy.
select is(
  (select hasta from suscripciones
   where organizacion_id = (select id from organizaciones where rut = '777000020')),
  ((current_date + 90) + interval '1 month')::date,
  'pagar con hasta futuro usa greatest y extiende desde hasta'
);

-- 19) La revisión no extendió: IDEM sigue sin hasta y en trial.
select is(
  coalesce((select hasta from suscripciones
            where organizacion_id = (select id from organizaciones where rut = '777000055'))::text, 'sin-hasta')
  || '/' ||
  (select estado from organizaciones where rut = '777000055'),
  'sin-hasta/trial',
  'un pago en revision no extiende ni activa la org'
);

-- 26) Backstop 23505 anti-doble-acreditación: PA (a0000001) ya está 'pagado' con
--     referencia 'mp:pa'. Un SEGUNDO pago pendiente mercadopago (a0000005) confirmado con
--     esa MISMA referencia colisiona en el índice único parcial → el handler devuelve
--     'noop' y el UPDATE se revierte, así el segundo pago sigue 'pendiente' (jamás doble
--     acreditación; segundo pago intacto). Se asserta ambos hechos en una expresión.
select is(
  confirmar_pago_suscripcion('a0000005-0000-0000-0000-000000000005', 'mp:pa', 29990)
  || '/' ||
  (select estado from pagos_suscripcion where id = 'a0000005-0000-0000-0000-000000000005'),
  'noop/pendiente',
  'un segundo pago con una referencia ya acreditada es noop y queda pendiente (backstop 23505)'
);

-- ===== Candados (authenticated / anon) =====
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- 20) authenticated NO ejecuta confirmar (solo service_role; el grant ES el candado).
select throws_ok(
  $$select confirmar_pago_suscripcion('a0000001-0000-0000-0000-000000000001', 'x', 1)$$,
  '42501', 'permission denied for function confirmar_pago_suscripcion',
  'authenticated no puede ejecutar confirmar_pago_suscripcion'
);

-- 21) authenticated NO ejecuta abortar.
select throws_ok(
  $$select abortar_pago_suscripcion('a0000001-0000-0000-0000-000000000001')$$,
  '42501', 'permission denied for function abortar_pago_suscripcion',
  'authenticated no puede ejecutar abortar_pago_suscripcion'
);

-- 22) Escritura directa denegada: insert (toda escritura es por RPC service_role).
select throws_ok(
  $$insert into pagos_suscripcion (organizacion_id, plan_id, monto, pasarela, buy_order)
    values (gen_random_uuid(), gen_random_uuid(), 1000, 'mercadopago', 'bohack')$$,
  '42501', 'permission denied for table pagos_suscripcion',
  'authenticated no puede insertar directamente en pagos_suscripcion'
);

-- 23) Escritura directa denegada: update.
select throws_ok(
  $$update pagos_suscripcion set monto = 1
    where organizacion_id = (select id from organizaciones where rut = '777000012')$$,
  '42501', 'permission denied for table pagos_suscripcion',
  'authenticated no puede editar directamente pagos_suscripcion'
);

-- 24) RLS cross-org: Beto (dueño de B, sin pagos) no ve ningún pago de las orgs de Ana.
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
select is(
  (select count(*) from pagos_suscripcion),
  0::bigint,
  'un dueño de otra org no ve pagos de suscripción ajenos'
);

-- 27) RLS mismo-org: Vero es VENDEDORA de A (777000012); el select solo lo ve dueño/admin,
--     así que aun siendo miembro de A ve 0 pagos. Cierra el otro flanco del cross-org (24).
set local request.jwt.claims to '{"sub": "77777777-7777-7777-7777-777777777777", "role": "authenticated"}';
select is(
  (select count(*) from pagos_suscripcion),
  0::bigint,
  'un vendedor de la misma org no ve pagos de suscripción (RLS solo dueño/admin)'
);

-- 25) Anónimo denegado de plano.
set local role anon;
set local request.jwt.claims to '{"role": "anon"}';
select throws_ok(
  'select count(*) from pagos_suscripcion',
  '42501', 'permission denied for table pagos_suscripcion',
  'un anónimo no puede consultar pagos_suscripcion'
);

select * from finish();
rollback;
