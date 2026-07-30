begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'ana@a.cl'),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'beto@b.cl'),
  ('00000000-0000-0000-0000-000000000000', '77777777-7777-7777-7777-777777777777', 'authenticated', 'authenticated', 'vero@a.cl');

-- RUT nuevos, únicos GLOBALES: no colisionan con otros tests (7611/7622/7633/7644/7655/
-- 7666/7677/7688/761112228/761234560/762223333/763334449/76543210x), el seed
-- (771234569, 778899000) ni los E2E (999999999, 888888888, 666666666).
insert into public.organizaciones (id, rut, razon_social)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '761212125', 'Org A'),
       ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '763434346', 'Org B');

-- A nace con el módulo ACTIVO (las RPCs de ODE lo exigen); B queda off:
-- cargas, gastos y la vista NO dependen del módulo (solo la UI se gatea).
insert into public.empresas (id, organizacion_id, rut, razon_social, modulo_transporte)
values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '761212125', 'Transportes A', true),
       ('eeeeeeee-0000-0000-0000-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '763434346', 'Empresa B', false);

insert into public.miembros (usuario_id, organizacion_id, rol)
values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'dueno'),
       ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'dueno'),
       ('77777777-7777-7777-7777-777777777777', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'vendedor');

insert into public.clientes (id, empresa_id, rut, razon_social)
values ('cccccccc-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '764646460', 'Cliente A');

-- Flota: VA de A (blanco de cargas, gastos y vista); VB de B (aislamiento y dedup cruzado).
insert into public.vehiculos (id, empresa_id, patente, descripcion)
values ('aaaa0001-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'ABCD12', 'Camión A'),
       ('aaaa0002-0000-0000-0000-bbbbbbbbbbbb', 'eeeeeeee-0000-0000-0000-bbbbbbbbbbbb', 'WXYZ89', 'Camión B');

insert into public.destinos (id, empresa_id, nombre, tarifa_kg)
values ('dddd0001-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'Coyhaique', 450);

-- ===== Ana (dueña A): fixture de rentabilidad A MANO (fechas fijas julio/agosto 2026) =====
-- ODEs por RPC (patrón transporte.test.sql): la 1 facturada CON vehículo ($100.000, julio),
-- la 2 facturada SIN vehículo ($50.000, julio → fila "Sin asignar"), la 3 queda
-- 'registrada' ($77.777: si la vista la sumara, el assert 12 daría 177777).
-- Si cualquier setup fallara, el archivo entero aborta (feliz cubierto sin assert propio).
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select crear_orden_entrega('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
  date '2026-07-10', 'dddd0001-0000-0000-0000-aaaaaaaaaaaa', 'GD 9001', null,
  1, 400, null, 100000, 'aaaa0001-0000-0000-0000-aaaaaaaaaaaa', null, null);
select crear_orden_entrega('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
  date '2026-07-12', 'dddd0001-0000-0000-0000-aaaaaaaaaaaa', null, null,
  1, 200, null, 50000, null, null, null);
select crear_orden_entrega('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
  date '2026-07-20', 'dddd0001-0000-0000-0000-aaaaaaaaaaaa', null, null,
  1, 100, null, 77777, 'aaaa0001-0000-0000-0000-aaaaaaaaaaaa', null, null);

-- Ciclo completo SOLO para las ODEs 1 y 2: borrador → enviada → aprobada → facturada.
select crear_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
  array[
    (select id from ordenes_entrega where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1),
    (select id from ordenes_entrega where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 2)
  ], null);
select cambiar_estado_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1), 'enviada');
select cambiar_estado_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1), 'aprobada');
select facturar_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1));

-- Costos de la dueña por insert DIRECTO (así escribe la app): TCT-001 julio $30.000
-- y TCT-002 agosto $40.000 sobre el camión A; peaje julio $20.000.
insert into public.cargas_combustible (empresa_id, vehiculo_id, fecha, hora, litros, precio_litro, monto, estacion, guia, origen)
values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'aaaa0001-0000-0000-0000-aaaaaaaaaaaa', date '2026-07-08', '14:30:00', 100.00, 300, 30000, 'Copec Coyhaique', 'TCT-001', 'tct'),
       ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'aaaa0001-0000-0000-0000-aaaaaaaaaaaa', date '2026-08-02', null, 133.50, null, 40000, null, 'TCT-002', 'tct');
insert into public.gastos_vehiculo (empresa_id, vehiculo_id, fecha, categoria, monto, notas)
values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'aaaa0001-0000-0000-0000-aaaaaaaaaaaa', date '2026-07-15', 'peaje', 20000, 'Ruta 7');

-- ===== Vero (vendedora A): NO escribe costos; el delete existe pero la policy la filtra =====
set local request.jwt.claims to '{"sub": "77777777-7777-7777-7777-777777777777", "role": "authenticated"}';

-- 1) La vendedora no inserta cargas: la policy de insert es dueno/admin (42501 de RLS, no de grant).
select throws_ok(
  $$insert into cargas_combustible (empresa_id, vehiculo_id, fecha, litros, monto, origen)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'aaaa0001-0000-0000-0000-aaaaaaaaaaaa', date '2026-07-09', 50, 15000, 'manual')$$,
  '42501', 'new row violates row-level security policy for table "cargas_combustible"',
  'la vendedora no puede registrar cargas de combustible'
);

-- 2) La vendedora tampoco inserta gastos.
select throws_ok(
  $$insert into gastos_vehiculo (empresa_id, vehiculo_id, fecha, categoria, monto)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'aaaa0001-0000-0000-0000-aaaaaaaaaaaa', date '2026-07-09', 'peaje', 5000)$$,
  '42501', 'new row violates row-level security policy for table "gastos_vehiculo"',
  'la vendedora no puede registrar gastos de vehículo'
);

-- 3) El delete de la vendedora NO es 42501 (el grant de delete EXISTE): la policy
--    filtra en silencio y afecta 0 filas — por eso la app verifica con .select('id').
select lives_ok(
  $$delete from cargas_combustible
    where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and guia = 'TCT-001'$$,
  'el delete de la vendedora no da error: el grant existe y la policy filtra por rol'
);

-- 4) ...y la carga sigue viva (0 filas afectadas; la vendedora la VE porque es miembro).
select is(
  (select count(*) from cargas_combustible
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and guia = 'TCT-001'),
  1::bigint,
  'el delete de la vendedora afectó 0 filas: la carga sigue viva'
);

-- ===== Ana: candado de update y CHECKs =====
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- 5) SIN update NI SIQUIERA para la dueña: no hay grant (candado tipo cotizaciones #26).
--    Corregir una carga = eliminarla y re-crearla.
select throws_ok(
  $$update cargas_combustible set monto = 1
    where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'$$,
  '42501', 'permission denied for table cargas_combustible',
  'ni la dueña puede editar una carga: sin grant de update'
);

-- 6) Ídem gastos_vehiculo.
select throws_ok(
  $$update gastos_vehiculo set monto = 1
    where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'$$,
  '42501', 'permission denied for table gastos_vehiculo',
  'ni la dueña puede editar un gasto: sin grant de update'
);

-- 7) La guía es única POR EMPRESA (índice único parcial): re-insertar TCT-001 en A revienta.
select throws_ok(
  $$insert into cargas_combustible (empresa_id, vehiculo_id, fecha, litros, monto, guia, origen)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'aaaa0001-0000-0000-0000-aaaaaaaaaaaa', date '2026-07-09', 60, 18000, 'TCT-001', 'tct')$$,
  '23505', null,
  'la misma guía no entra dos veces en la misma empresa'
);

-- 8) CHECK: litros 0.
select throws_ok(
  $$insert into cargas_combustible (empresa_id, vehiculo_id, fecha, litros, monto, origen)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'aaaa0001-0000-0000-0000-aaaaaaaaaaaa', date '2026-07-09', 0, 15000, 'manual')$$,
  '23514', null,
  'una carga de 0 litros se rechaza por CHECK'
);

-- 9) CHECK: monto 0.
select throws_ok(
  $$insert into cargas_combustible (empresa_id, vehiculo_id, fecha, litros, monto, origen)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'aaaa0001-0000-0000-0000-aaaaaaaaaaaa', date '2026-07-09', 50, 0, 'manual')$$,
  '23514', null,
  'una carga de monto 0 se rechaza por CHECK'
);

-- 10) CHECK: categoría de gasto fuera de la lista.
select throws_ok(
  $$insert into gastos_vehiculo (empresa_id, vehiculo_id, fecha, categoria, monto)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'aaaa0001-0000-0000-0000-aaaaaaaaaaaa', date '2026-07-09', 'bencina', 5000)$$,
  '23514', null,
  'una categoría de gasto inválida se rechaza por CHECK'
);

-- ===== Beto (dueño B): la MISMA guía en OTRA empresa SÍ entra =====
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

-- 11) El índice de dedup es (empresa_id, guia): TCT-001 de B no choca con TCT-001 de A.
select lives_ok(
  $$insert into cargas_combustible (empresa_id, vehiculo_id, fecha, litros, monto, guia, origen)
    values ('eeeeeeee-0000-0000-0000-bbbbbbbbbbbb', 'aaaa0002-0000-0000-0000-bbbbbbbbbbbb', date '2026-07-05', 80, 25000, 'TCT-001', 'tct')$$,
  'la misma guía en OTRA empresa sí entra: el dedup es por empresa'
);

-- ===== Ana: la vista cuadra A MANO =====
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- 12) Julio del camión A: ingresos SOLO de la ODE facturada ($100.000 — la registrada
--     de $77.777 NO suma), combustible SOLO de julio ($30.000 — la carga de agosto
--     NO contamina) y el peaje ($20.000).
select is(
  (select ingresos::text || '/' || combustible::text || '/' || gastos::text
   from rentabilidad_vehiculo
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and vehiculo_id = 'aaaa0001-0000-0000-0000-aaaaaaaaaaaa' and mes = date '2026-07-01'),
  '100000/30000/20000',
  'julio del camión A cuadra a mano: 100000/30000/20000 (la ODE registrada no suma; agosto no contamina)'
);

-- 13) La ODE facturada SIN vehículo cae en la fila "Sin asignar" (vehiculo_id null) del mismo mes.
select is(
  (select ingresos::text || '/' || combustible::text || '/' || gastos::text
   from rentabilidad_vehiculo
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and vehiculo_id is null and mes = date '2026-07-01'),
  '50000/0/0',
  'la ODE facturada sin vehículo aparece como fila Sin asignar con sus 50000 de ingreso'
);

-- 14) La carga de agosto vive en SU mes (0 ingresos: nada facturado en agosto).
select is(
  (select ingresos::text || '/' || combustible::text || '/' || gastos::text
   from rentabilidad_vehiculo
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and vehiculo_id = 'aaaa0001-0000-0000-0000-aaaaaaaaaaaa' and mes = date '2026-08-01'),
  '0/40000/0',
  'la carga de agosto aparece en agosto, no en julio'
);

-- 15) La dueña SÍ elimina (primer delete directo del schema): TCT-002 desaparece.
delete from cargas_combustible
where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and guia = 'TCT-002';
select is(
  (select count(*) from cargas_combustible
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and guia = 'TCT-002'),
  0::bigint,
  'la dueña elimina una carga directamente: corregir = borrar y re-crear'
);

-- Setup: delete cross-tenant de Ana contra TODO lo de B — la policy lo deja en
-- 0 filas SIN error (el assert 16 lo prueba: la carga de Beto sigue viva).
delete from cargas_combustible where empresa_id = 'eeeeeeee-0000-0000-0000-bbbbbbbbbbbb';

-- ===== Beto: aislamiento (tablas y vista con pgTAP POSITIVO) =====
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

-- 16) Beto ve SOLO su carga: la de A es invisible, el gasto de A también, y el
--     delete cross-tenant de Ana afectó 0 filas (si hubiera borrado, esto daría 0).
select is(
  (select count(*) from cargas_combustible) + (select count(*) from gastos_vehiculo),
  1::bigint,
  'Beto ve solo su carga: aislamiento de las 2 tablas y delete cross-tenant en 0 filas'
);

-- 17) pgTAP POSITIVO de la vista (lección 42501): Beto la LEE sin error y ve UNA fila — la suya.
select is(
  (select count(*)::text from rentabilidad_vehiculo) || '/' ||
  (select vehiculo_id::text || '/' || mes::text || '/' || ingresos::text || '/' || combustible::text || '/' || gastos::text
   from rentabilidad_vehiculo where empresa_id = 'eeeeeeee-0000-0000-0000-bbbbbbbbbbbb'),
  '1/aaaa0002-0000-0000-0000-bbbbbbbbbbbb/2026-07-01/0/25000/0',
  'la vista tiene grant para authenticated y la RLS del invoker aísla: Beto ve solo su fila'
);

-- 18) Anónimo denegado de plano.
set local request.jwt.claims to '{"role": "anon"}';
set local role anon;
select throws_ok(
  'select count(*) from cargas_combustible',
  '42501', 'permission denied for table cargas_combustible',
  'un anónimo no puede consultar cargas de combustible'
);

select * from finish();
rollback;
