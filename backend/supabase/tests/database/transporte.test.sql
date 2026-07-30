begin;
create extension if not exists pgtap with schema extensions;
select plan(59);

insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'ana@a.cl'),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'beto@b.cl'),
  ('00000000-0000-0000-0000-000000000000', '55555555-5555-5555-5555-555555555555', 'authenticated', 'authenticated', 'ces@a.cl'),
  ('00000000-0000-0000-0000-000000000000', '66666666-6666-6666-6666-666666666666', 'authenticated', 'authenticated', 'dora@a.cl'),
  ('00000000-0000-0000-0000-000000000000', '77777777-7777-7777-7777-777777777777', 'authenticated', 'authenticated', 'vero@a.cl');

-- RUT nuevos, únicos GLOBALES: no colisionan con otros tests (7611/7622/7633/7644/7655/7666/7677/76543210x),
-- el seed (771234569, 778899000) ni los E2E (999999999, 888888888).
insert into public.organizaciones (id, rut, razon_social)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '768888884', 'Org A'),
       ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '761112228', 'Org B');

-- La empresa A nace con el módulo ACTIVO (factor default 250); la B queda con el default (off).
insert into public.empresas (id, organizacion_id, rut, razon_social, modulo_transporte)
values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '768888884', 'Transportes A', true),
       ('eeeeeeee-0000-0000-0000-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '761112228', 'Empresa B', false);

insert into public.miembros (usuario_id, organizacion_id, rol)
values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'dueno'),
       ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'dueno'),
       ('55555555-5555-5555-5555-555555555555', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'contador'),
       ('66666666-6666-6666-6666-666666666666', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bodeguero'),
       ('77777777-7777-7777-7777-777777777777', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'vendedor');

insert into public.clientes (id, empresa_id, rut, razon_social)
values ('cccccccc-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '761234560', 'Cliente A'),
       ('cccccccc-0000-0000-0000-bbbbbbbbbbbb', 'eeeeeeee-0000-0000-0000-bbbbbbbbbbbb', '763334449', 'Cliente B');
insert into public.clientes (id, empresa_id, rut, razon_social, activo)
values ('cccccccc-1111-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '762223333', 'Cliente Inactivo', false);

-- Flota: VA activo de A; VB de B (para "vehículo ajeno"); KA activo, KI inactivo, KB de B.
insert into public.vehiculos (id, empresa_id, patente, descripcion)
values ('aaaa0001-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'ABCD12', 'Camión 3/4'),
       ('aaaa0002-0000-0000-0000-bbbbbbbbbbbb', 'eeeeeeee-0000-0000-0000-bbbbbbbbbbbb', 'WXYZ89', 'Camión B');
insert into public.conductores (id, empresa_id, rut, nombre)
values ('bbbb0001-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '123456785', 'Carlos Soto'),
       ('bbbb0003-0000-0000-0000-bbbbbbbbbbbb', 'eeeeeeee-0000-0000-0000-bbbbbbbbbbbb', '222222222', 'Chofer B');
insert into public.conductores (id, empresa_id, rut, nombre, activo)
values ('bbbb0002-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '111111111', 'Pedro Retirado', false);

-- Tarifario: Coyhaique $450/kg (la fila real: 315 × 450 = 141750), Puerto Aysén $120/kg; Castro es de B.
insert into public.destinos (id, empresa_id, nombre, tarifa_kg)
values ('dddd0001-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'Coyhaique', 450),
       ('dddd0002-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'Puerto Aysén', 120),
       ('dddd0003-0000-0000-0000-bbbbbbbbbbbb', 'eeeeeeee-0000-0000-0000-bbbbbbbbbbbb', 'Castro', 300);

-- Fixtures de B por insert directo (superuser salta grants/RLS a propósito, patrón cotizaciones):
-- OB y PB son los blancos cross-tenant y las filas del aislamiento de Beto.
insert into public.ordenes_entrega (id, empresa_id, numero, cliente_id, fecha_ingreso, destino_id, bultos, kilos, kilo_afecto, neto)
values ('0de00001-0000-0000-0000-bbbbbbbbbbbb', 'eeeeeeee-0000-0000-0000-bbbbbbbbbbbb', 1,
        'cccccccc-0000-0000-0000-bbbbbbbbbbbb', current_date, 'dddd0003-0000-0000-0000-bbbbbbbbbbbb', 1, 10, 10, 1000);
insert into public.proformas (id, empresa_id, numero, cliente_id, neto, iva, total)
values ('ff000001-0000-0000-0000-bbbbbbbbbbbb', 'eeeeeeee-0000-0000-0000-bbbbbbbbbbbb', 1,
        'cccccccc-0000-0000-0000-bbbbbbbbbbbb', 1000, 190, 1190);

-- Documentos: DVA0 = nota de venta de COMERCIO de A (jamás vino de una proforma); DVB = doc de B.
insert into public.documentos_venta (id, empresa_id, tipo, cliente_id)
values ('d0c00001-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'nota_venta', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa'),
       ('d0c00002-0000-0000-0000-bbbbbbbbbbbb', 'eeeeeeee-0000-0000-0000-bbbbbbbbbbbb', 'nota_venta', 'cccccccc-0000-0000-0000-bbbbbbbbbbbb');

-- ===== Ana (dueña A): las ODEs reales de su pantalla =====
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- Setup: ODE 1 = la fila REAL de PF-000004 (175 kg / 1.26 M3), con despacho asignado AL CREAR.
-- Si crear_orden_entrega fallara, el archivo entero aborta (feliz cubierto sin assert propio).
select crear_orden_entrega('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
  current_date, 'dddd0001-0000-0000-0000-aaaaaaaaaaaa', 'GD 4521, GD 4522', 'OC-9014',
  2, 175, 1.26, 141750, 'aaaa0001-0000-0000-0000-aaaaaaaaaaaa', 'bbbb0001-0000-0000-0000-aaaaaaaaaaaa', null);

-- Setup: Vero (vendedora) registra la ODE 2 (787 kg / 2.88 M3): el rol vendedor SÍ opera el ciclo.
set local request.jwt.claims to '{"sub": "77777777-7777-7777-7777-777777777777", "role": "authenticated"}';
select crear_orden_entrega('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
  current_date, 'dddd0002-0000-0000-0000-aaaaaaaaaaaa', 'GD 4600', null,
  5, 787, 2.88, 86086, null, null, null);

-- Setup: Ana sube el factor a 300 y registra la ODE 3 (100 kg / 1.00 M3: gana el volumen, 300).
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
update public.empresas set factor_volumetrico = 300 where id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa';
select crear_orden_entrega('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
  current_date, 'dddd0002-0000-0000-0000-aaaaaaaaaaaa', null, null,
  1, 100, 1.00, 30000, null, null, 'Carga voluminosa');

-- Setup: módulo off vía superuser (0023: modulo_transporte ya no es escribible
-- por authenticated — deriva del rubro y solo lo mueve la plataforma). El
-- toggle bloquea crear_*; NO borra ni esconde datos.
reset role;
update public.empresas set modulo_transporte = false where id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa';
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- 1) Con el módulo apagado no se registran ODEs (crear_proforma comparte guard y mensaje).
select throws_ok(
  $$select crear_orden_entrega('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
    current_date, 'dddd0001-0000-0000-0000-aaaaaaaaaaaa', null, null, 1, 10, null, 1000, null, null, null)$$,
  'P0001', 'El módulo de transporte no está activo',
  'con el módulo apagado no se registran órdenes de entrega'
);

-- 2) Con el módulo apagado la RLS NO cambia (las 3 ODEs siguen visibles) y el kilo afecto
--    persistido es el server-side: los DOS valores reales de su proforma y el factor 300.
select results_eq(
  $$select numero, kilo_afecto from ordenes_entrega
    where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' order by numero$$,
  $$values (1, 315), (2, 787), (3, 300)$$,
  'kilo afecto server-side (max(175, 1.26×250)=315; max(787, 2.88×250)=787; 1.00×300=300), correlativo secuencial y RLS intacta con módulo off'
);

-- Setup: módulo de vuelta (vía superuser, mismo motivo 0023).
reset role;
update public.empresas set modulo_transporte = true where id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa';
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- ===== Matriz de roles: contador y bodeguero NO operan NINGUNA de las 7 RPCs =====
set local request.jwt.claims to '{"sub": "66666666-6666-6666-6666-666666666666", "role": "authenticated"}';

-- 3) Dora (bodeguera) no registra ODEs.
select throws_ok(
  $$select crear_orden_entrega('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
    current_date, 'dddd0001-0000-0000-0000-aaaaaaaaaaaa', null, null, 1, 10, null, 1000, null, null, null)$$,
  'P0001', 'Tu rol no permite registrar órdenes de entrega',
  'la bodeguera no puede registrar órdenes de entrega'
);

-- 4) Dora no anula ODEs.
select throws_ok(
  $$select anular_orden_entrega('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from ordenes_entrega where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1),
    'Error de digitación')$$,
  'P0001', 'Tu rol no permite anular órdenes de entrega',
  'la bodeguera no puede anular órdenes de entrega'
);

-- 5) Dora no gestiona proformas (el rol se valida ANTES del lookup: el blanco es de B y aun así el mensaje es de rol).
select throws_ok(
  $$select cambiar_estado_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    'ff000001-0000-0000-0000-bbbbbbbbbbbb', 'enviada')$$,
  'P0001', 'Tu rol no permite gestionar proformas',
  'la bodeguera no puede gestionar proformas (rol antes del lookup)'
);

-- 6) Dora no anula estados de pago.
select throws_ok(
  $$select anular_estado_pago('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'd0c00001-0000-0000-0000-aaaaaaaaaaaa')$$,
  'P0001', 'Tu rol no permite anular estados de pago',
  'la bodeguera no puede anular estados de pago'
);

set local request.jwt.claims to '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated"}';

-- 7) Ces (contador) no asigna despachos.
select throws_ok(
  $$select asignar_despacho('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from ordenes_entrega where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1),
    null, null)$$,
  'P0001', 'Tu rol no permite asignar despachos',
  'el contador no puede asignar despachos'
);

-- 8) Ces no crea proformas.
select throws_ok(
  $$select crear_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
    array[(select id from ordenes_entrega where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1)],
    null)$$,
  'P0001', 'Tu rol no permite gestionar proformas',
  'el contador no puede crear proformas'
);

-- 9) Ces no factura proformas.
select throws_ok(
  $$select facturar_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'ff000001-0000-0000-0000-bbbbbbbbbbbb')$$,
  'P0001', 'Tu rol no permite facturar proformas',
  'el contador no puede facturar proformas'
);

-- ===== Ana: validaciones de crear_orden_entrega =====
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- 10) Destino ajeno (mismo mensaje que inexistente o inactivo).
select throws_ok(
  $$select crear_orden_entrega('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
    current_date, 'dddd0003-0000-0000-0000-bbbbbbbbbbbb', null, null, 1, 10, null, 1000, null, null, null)$$,
  'P0001', 'Destino no válido',
  'no se tarifa contra un destino de otra empresa'
);

-- 11) Conductor inactivo (misma guarda que el vehículo; 'Vehículo no válido' se testea en asignar_despacho).
select throws_ok(
  $$select crear_orden_entrega('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
    current_date, 'dddd0001-0000-0000-0000-aaaaaaaaaaaa', null, null, 1, 10, null, 1000,
    null, 'bbbb0002-0000-0000-0000-aaaaaaaaaaaa', null)$$,
  'P0001', 'Conductor no válido',
  'un conductor inactivo no recibe despachos al crear'
);

-- 12) Fecha de ingreso obligatoria.
select throws_ok(
  $$select crear_orden_entrega('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
    null, 'dddd0001-0000-0000-0000-aaaaaaaaaaaa', null, null, 1, 10, null, 1000, null, null, null)$$,
  'P0001', 'Ingresa la fecha de ingreso',
  'la fecha de ingreso es obligatoria'
);

-- 13) Bultos 0.
select throws_ok(
  $$select crear_orden_entrega('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
    current_date, 'dddd0001-0000-0000-0000-aaaaaaaaaaaa', null, null, 0, 10, null, 1000, null, null, null)$$,
  'P0001', 'Los bultos deben ser un entero mayor a 0',
  'los bultos no pueden ser 0'
);

-- 14) Kilos 0.
select throws_ok(
  $$select crear_orden_entrega('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
    current_date, 'dddd0001-0000-0000-0000-aaaaaaaaaaaa', null, null, 1, 0, null, 1000, null, null, null)$$,
  'P0001', 'Los kilos deben ser mayores a 0',
  'los kilos no pueden ser 0'
);

-- 15) Tope de kilos (1.000.000).
select throws_ok(
  $$select crear_orden_entrega('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
    current_date, 'dddd0001-0000-0000-0000-aaaaaaaaaaaa', null, null, 1, 1000001, null, 1000, null, null, null)$$,
  'P0001', 'Los kilos superan el máximo admitido',
  'los kilos tienen tope: 1000001 se rechaza con mensaje claro, no con overflow'
);

-- 16) M3 negativos.
select throws_ok(
  $$select crear_orden_entrega('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
    current_date, 'dddd0001-0000-0000-0000-aaaaaaaaaaaa', null, null, 1, 10, -0.5, 1000, null, null, null)$$,
  'P0001', 'Los M3 no pueden ser negativos',
  'los M3 no pueden ser negativos'
);

-- 17) Tope de M3 (100.000): con factor ≤ 10000 el producto siempre cabe en int4.
select throws_ok(
  $$select crear_orden_entrega('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
    current_date, 'dddd0001-0000-0000-0000-aaaaaaaaaaaa', null, null, 1, 10, 100001, 1000, null, null, null)$$,
  'P0001', 'Los M3 superan el máximo admitido',
  'los M3 tienen tope: 100001 se rechaza con mensaje claro'
);

-- 18) Neto 0 (el neto lo manda el llamador, pero entero >= 1).
select throws_ok(
  $$select crear_orden_entrega('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
    current_date, 'dddd0001-0000-0000-0000-aaaaaaaaaaaa', null, null, 1, 10, null, 0, null, null, null)$$,
  'P0001', 'El neto debe ser un entero mayor a 0',
  'el neto no puede ser 0'
);

-- 19) 0.4 kg sin M3: round(max(0.4, 0)) = 0 kg afecto — demasiado pequeño para tarifar.
select throws_ok(
  $$select crear_orden_entrega('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
    current_date, 'dddd0001-0000-0000-0000-aaaaaaaaaaaa', null, null, 1, 0.4, null, 1000, null, null, null)$$,
  'P0001', 'La carga es demasiado pequeña para tarifar',
  'una carga de 0.4 kg sin volumen no se puede tarifar'
);

-- ===== Escritura directa denegada: TODO entra por RPC (patrón cotizaciones assert 26) =====

-- 20) insert directo a ordenes_entrega.
select throws_ok(
  $$insert into ordenes_entrega (empresa_id, numero, cliente_id, fecha_ingreso, destino_id, bultos, kilos, kilo_afecto, neto)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 999, 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
            current_date, 'dddd0001-0000-0000-0000-aaaaaaaaaaaa', 1, 10, 10, 1000)$$,
  '42501', 'permission denied for table ordenes_entrega',
  'authenticated no puede insertar directamente en ordenes_entrega'
);

-- 21) update directo a ordenes_entrega.
select throws_ok(
  $$update ordenes_entrega set neto = 999999
    where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1$$,
  '42501', 'permission denied for table ordenes_entrega',
  'authenticated no puede actualizar directamente ordenes_entrega'
);

-- 22) insert directo a proformas.
select throws_ok(
  $$insert into proformas (empresa_id, numero, cliente_id, neto, iva, total)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 999, 'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 0, 0, 0)$$,
  '42501', 'permission denied for table proformas',
  'authenticated no puede insertar directamente en proformas'
);

-- 23) update directo a proformas.
select throws_ok(
  $$update proformas set estado = 'aprobada'
    where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'$$,
  '42501', 'permission denied for table proformas',
  'authenticated no puede actualizar directamente proformas'
);

-- ===== CHECKs de BD y endurecimiento de empresas =====

-- 24) Patente fuera de los dos formatos chilenos (AAAA99 / AA9999).
select throws_ok(
  $$insert into vehiculos (empresa_id, patente)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'ABC123')$$,
  '23514', null,
  'una patente fuera de formato se rechaza por CHECK'
);

-- 25) RUT de conductor con DV incorrecto (el DV real de 12345678 es 5).
select throws_ok(
  $$insert into conductores (empresa_id, rut, nombre)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '123456780', 'Chofer Falso')$$,
  '23514', null,
  'un RUT de conductor inválido se rechaza por CHECK'
);

-- 26) Destino duplicado case-insensitive ('coyhaique' choca con 'Coyhaique').
select throws_ok(
  $$insert into destinos (empresa_id, nombre, tarifa_kg)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'coyhaique', 500)$$,
  '23505', null,
  'el tarifario no admite el mismo destino con otra capitalización'
);

-- 27) Factor volumétrico fuera de rango (tope 10000).
select throws_ok(
  $$update empresas set factor_volumetrico = 10001
    where id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'$$,
  '23514', null,
  'el factor volumétrico tiene tope 10000 por CHECK'
);

-- 28) organizacion_id quedó FUERA del grant por columnas: ni la dueña puede moverse de organización.
select throws_ok(
  $$update empresas set organizacion_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
    where id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'$$,
  '42501', 'permission denied for table empresas',
  'la dueña no puede reasignar la empresa a otra organización'
);

-- ===== crear_proforma: la proforma REAL de su pantalla =====

-- Setup: P1 con las DOS ODEs reales; la ODE 1 va DUPLICADA en el array a propósito
-- (si contara dos veces, el neto daría 369586 y el assert 29 fallaría).
select crear_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
  array[
    (select id from ordenes_entrega where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1),
    (select id from ordenes_entrega where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1),
    (select id from ordenes_entrega where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 2)
  ], 'Consolidado Coyhaique');

-- 29) Totales DORADOS de la pantalla real: 141750 + 86086 = 227836; IVA sobre el neto TOTAL.
select is(
  (select neto::text || '/' || iva::text || '/' || total::text
   from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1),
  '227836/43289/271125',
  'los totales de su sistema real: neto 227836, iva 43289 (round(227836×0.19)), total 271125; la ODE duplicada contó una sola vez'
);

-- 30) Una ODE ya reservada no entra en otra proforma (mismo guard y mensaje cubren la ODE cross-tenant).
select throws_ok(
  $$select crear_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
    array[(select id from ordenes_entrega where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1)],
    null)$$,
  'P0001', 'Hay una orden no válida, de otro cliente, ya facturada o en otra proforma',
  'una ODE reservada no entra en una segunda proforma'
);

-- 31) crear_proforma con una ODE de B en el array (cross-tenant DIRECTO: la ODE
--     de B nunca cumple empresa_id = A, así que cae en el mismo conteo post-lock).
select throws_ok(
  $$select crear_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
    array['0de00001-0000-0000-0000-bbbbbbbbbbbb'::uuid], null)$$,
  'P0001', 'Hay una orden no válida, de otro cliente, ya facturada o en otra proforma',
  'una ODE de otra empresa en el array no arma una proforma'
);

-- 32) Proforma vacía.
select throws_ok(
  $$select crear_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
    array[]::uuid[], null)$$,
  'P0001', 'La proforma necesita al menos una orden de entrega',
  'una proforma no se crea sin ODEs'
);

-- 33) Cliente desactivado (mismo mensaje que inexistente o ajeno; cubre también la guarda de crear_orden_entrega).
select throws_ok(
  $$select crear_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-1111-0000-0000-aaaaaaaaaaaa',
    array[(select id from ordenes_entrega where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 3)],
    null)$$,
  'P0001', 'Cliente no válido',
  'no se factura a un cliente desactivado'
);

-- Setup: ODE 4 con neto 1.900.000.000 (cabe en int4; neto + IVA no).
select crear_orden_entrega('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
  current_date, 'dddd0002-0000-0000-0000-aaaaaaaaaaaa', null, null,
  1, 1000, null, 1900000000, null, null, null);

-- 34) Overflow BORDE: Σ netos ≤ 2147483647 pero neto + round(neto×0.19) = 2.261.000.000 lo supera
--     — mensaje del contrato, JAMÁS un 22003 crudo.
select throws_ok(
  $$select crear_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
    array[(select id from ordenes_entrega where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 4)],
    null)$$,
  'P0001', 'La proforma supera el monto máximo facturable',
  'el overflow de int4 en neto+iva se ataja con el mensaje del contrato, no con 22003'
);

-- ===== Transiciones de proforma =====

-- 35) 'facturada' está vetada en la RPC de estado (y borrador→facturada es además inválida).
select throws_ok(
  $$select cambiar_estado_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1), 'facturada')$$,
  'P0001', 'Transición de estado no válida',
  'facturada solo se alcanza vía facturar_proforma'
);

-- 36) Motivo de puro whitespace = motivo vacío (nullif/trim los iguala).
select throws_ok(
  $$select cambiar_estado_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1), 'rechazada', '   ')$$,
  'P0001', 'El rechazo requiere un motivo',
  'el motivo de rechazo no puede ser vacío ni whitespace'
);

-- 37) La proforma de B "no existe" para la empresa A.
select throws_ok(
  $$select cambiar_estado_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    'ff000001-0000-0000-0000-bbbbbbbbbbbb', 'enviada')$$,
  'P0001', 'La proforma no existe',
  'una proforma de otra empresa da el mismo mensaje que una inexistente'
);

-- ===== Prospectividad: subir tarifa y factor NO recalcula lo persistido =====
update public.destinos set tarifa_kg = 999
where id = 'dddd0001-0000-0000-0000-aaaaaaaaaaaa' and empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa';
update public.empresas set factor_volumetrico = 500 where id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa';

-- 38) La ODE 1 (315/141750), la ODE 3 (300: nació con factor 300, no 500) y la proforma quedan INTACTAS.
select is(
  (select o1.kilo_afecto::text || '/' || o1.neto::text || '/' || o3.kilo_afecto::text || '/' || p.neto::text || '/' || p.total::text
   from ordenes_entrega o1, ordenes_entrega o3, proformas p
   where o1.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and o1.numero = 1
     and o3.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and o3.numero = 3
     and p.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and p.numero = 1),
  '315/141750/300/227836/271125',
  'prospectividad: subir la tarifa (450 a 999) y el factor (300 a 500) no recalcula ODEs ni proformas existentes'
);

-- ===== Rechazos que LIBERAN (desde enviada y desde aprobada) =====

-- Setup: ODE 5 y P2; P2 se rechaza desde ENVIADA.
select crear_orden_entrega('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
  current_date, 'dddd0002-0000-0000-0000-aaaaaaaaaaaa', null, null,
  1, 50, null, 6000, null, null, null);
select crear_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
  array[(select id from ordenes_entrega where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 5)], null);
select cambiar_estado_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 2), 'enviada');
select cambiar_estado_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 2), 'rechazada', 'El cliente no aceptó la tarifa');

-- Setup: P3 con la MISMA ODE — esta creación PRUEBA que el rechazo desde enviada la liberó
-- (si no, 'Hay una orden no válida...' abortaría el archivo). P3 llega a aprobada y se rechaza.
select crear_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
  array[(select id from ordenes_entrega where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 5)], null);
select cambiar_estado_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 3), 'enviada');
select cambiar_estado_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 3), 'aprobada');
select cambiar_estado_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 3), 'rechazada', 'Se cayó el negocio');

-- 39) El rechazo desde APROBADA libera la ODE; el correlativo de proformas es secuencial (P3 = 3).
select is(
  (select p.numero::text || '/' || p.estado || '/' || coalesce(o.proforma_id::text, 'libre') || '/' || o.estado
   from proformas p, ordenes_entrega o
   where p.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and p.numero = 3
     and o.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and o.numero = 5),
  '3/rechazada/libre/registrada',
  'el rechazo desde aprobada libera la ODE (y el desde enviada también: P3 pudo re-reservarla) con correlativo 3'
);

-- ===== anular_orden_entrega y asignar_despacho =====

-- 40) La anulación exige motivo (whitespace = vacío).
select throws_ok(
  $$select anular_orden_entrega('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from ordenes_entrega where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 5), '   ')$$,
  'P0001', 'La anulación requiere un motivo',
  'la anulación no acepta motivo vacío ni whitespace'
);

-- 41) Una ODE reservada en una proforma no se anula (el orden de checks pone estado ANTES que reserva).
select throws_ok(
  $$select anular_orden_entrega('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from ordenes_entrega where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1),
    'Error de digitación')$$,
  'P0001', 'La orden está en una proforma; recházala primero',
  'una ODE reservada exige rechazar la proforma antes de anularse'
);

-- Setup: anulación feliz de la ODE 5 (libre); si fallara, el archivo aborta.
select anular_orden_entrega('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from ordenes_entrega where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 5),
  'Carga retirada por el cliente');

-- 42) A una ODE anulada no se le asigna despacho.
select throws_ok(
  $$select asignar_despacho('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from ordenes_entrega where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 5),
    'aaaa0001-0000-0000-0000-aaaaaaaaaaaa', 'bbbb0001-0000-0000-0000-aaaaaaaaaaaa')$$,
  'P0001', 'No se puede asignar despacho a una orden anulada',
  'una ODE anulada no recibe despacho'
);

-- 43) Vehículo de otra empresa (mismo mensaje que inexistente o inactivo).
select throws_ok(
  $$select asignar_despacho('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from ordenes_entrega where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 2),
    'aaaa0002-0000-0000-0000-bbbbbbbbbbbb', null)$$,
  'P0001', 'Vehículo no válido',
  'no se despacha con un vehículo de otra empresa'
);

-- 44) La ODE de B "no existe" para asignar_despacho.
select throws_ok(
  $$select asignar_despacho('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    '0de00001-0000-0000-0000-bbbbbbbbbbbb', null, null)$$,
  'P0001', 'La orden de entrega no existe',
  'una ODE de otra empresa da el mismo mensaje que una inexistente'
);

-- 45) La ODE de B "no existe" para anular_orden_entrega (cross-tenant DIRECTO, no solo por
--     identidad de mensaje con el assert 44).
select throws_ok(
  $$select anular_orden_entrega('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    '0de00001-0000-0000-0000-bbbbbbbbbbbb', 'Motivo cualquiera')$$,
  'P0001', 'La orden de entrega no existe',
  'anular_orden_entrega contra una ODE de otra empresa da el mismo mensaje que una inexistente'
);

-- 46) La proforma de B "no existe" para facturar_proforma (cross-tenant DIRECTO).
select throws_ok(
  $$select facturar_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    'ff000001-0000-0000-0000-bbbbbbbbbbbb')$$,
  'P0001', 'La proforma no existe',
  'facturar_proforma contra una proforma de otra empresa da el mismo mensaje que una inexistente'
);

-- ===== Ciclo completo: P1 enviada, aprobada y facturada =====
select cambiar_estado_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1), 'enviada');
select cambiar_estado_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1), 'aprobada');
select facturar_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1));

-- 47) La nota de venta nace en borrador, enlazada, con 2 líneas SIN producto y la descripción
--     'ODE N° <n> <destino> — guías <docum>' recortada a 80 (tope NmbItem del DTE), exenta = false.
select is(
  (select d.tipo || '/' || d.estado || '/' || d.total::text || '/'
        || (select count(*)::text from documentos_venta_lineas l2
            where l2.documento_id = d.id and l2.empresa_id = d.empresa_id) || '/'
        || l.precio_neto::text || '/' || l.exenta::text || '/' || l.descripcion
   from proformas p
   join documentos_venta d on d.id = p.documento_venta_id and d.empresa_id = p.empresa_id
   join documentos_venta_lineas l on l.documento_id = d.id and l.empresa_id = d.empresa_id
     and l.producto_id is null and l.precio_neto = 141750
   where p.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and p.numero = 1
     and p.estado = 'facturada'),
  'nota_venta/borrador/271125/2/141750/false/ODE N° 1 Coyhaique — guías GD 4521, GD 4522',
  'facturar crea la nota de venta en borrador con líneas sin producto y descripción ODE/destino/guías (left 80)'
);

-- 48) Nada se factura dos veces (mismo mensaje cubre facturar una no-aprobada).
select throws_ok(
  $$select facturar_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1))$$,
  'P0001', 'Solo se puede facturar una proforma aprobada',
  'una proforma facturada no se factura dos veces'
);

-- 49) El despacho físico es independiente de la facturación: se asigna sobre una ODE FACTURADA.
select lives_ok(
  $$select asignar_despacho('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from ordenes_entrega where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 2),
    'aaaa0001-0000-0000-0000-aaaaaaaaaaaa', 'bbbb0001-0000-0000-0000-aaaaaaaaaaaa')$$,
  'el despacho se asigna incluso con la ODE ya facturada'
);

-- 50) Una ODE facturada no se anula (mismo mensaje de estado cubre el doble-anular).
select throws_ok(
  $$select anular_orden_entrega('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from ordenes_entrega where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1),
    'Ya no corresponde')$$,
  'P0001', 'Solo se puede anular una orden registrada',
  'una ODE facturada no se anula por esta vía'
);

-- ===== anular_estado_pago: la reversa total =====

-- Setup: deshacer el estado de pago en BORRADOR (feliz); el assert 51 verifica la reversa completa.
select anular_estado_pago('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select documento_venta_id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1));

-- 51) Reversa: ODEs a registrada CONSERVANDO proforma y despacho (el del assert 49), proforma a
--     aprobada sin documento, y el doc borrado (solo queda DVA0 como nota de venta de A).
select is(
  (select o.estado || '/' || (o.proforma_id is not null)::text || '/' || (o.vehiculo_id is not null)::text
        || '/' || p.estado || '/' || (p.documento_venta_id is null)::text || '/'
        || (select count(*)::text from documentos_venta
            where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and tipo = 'nota_venta')
   from ordenes_entrega o, proformas p
   where o.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and o.numero = 2
     and p.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and p.numero = 1),
  'registrada/true/true/aprobada/true/1',
  'deshacer el borrador revierte: ODEs a registrada conservando proforma y despacho, proforma a aprobada y documento eliminado'
);

-- Setup: re-facturar (P1 volvió a aprobada) y simular la EMISIÓN al SII (superuser: folio consumido).
select facturar_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1));
reset role;
update public.documentos_venta set tipo = 'factura', folio = 778, estado = 'emitido'
where id = (select documento_venta_id from proformas
            where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1);
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- 52) Con folio VÁLIDO (emitido) no hay reversa: para eso existe la nota de crédito.
select throws_ok(
  $$select anular_estado_pago('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select documento_venta_id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1))$$,
  'P0001', 'Solo se puede deshacer un estado de pago en borrador o rechazado',
  'una factura emitida con folio válido no se deshace'
);

-- Setup: el SII RECHAZA el DTE (superuser): folio consumido = gap justificable.
reset role;
update public.documentos_venta set estado = 'rechazado'
where id = (select documento_venta_id from proformas
            where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1);
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- 53) Un DTE rechazado por el SII SÍ se deshace (la mecánica de reversa ya quedó fijada en el 51).
select lives_ok(
  $$select anular_estado_pago('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select documento_venta_id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1))$$,
  'un DTE rechazado por el SII se deshace: el folio consumido queda como gap justificable'
);

-- 54) Una nota de venta de COMERCIO en borrador no es deshacible por aquí (no proviene de proforma).
select throws_ok(
  $$select anular_estado_pago('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'd0c00001-0000-0000-0000-aaaaaaaaaaaa')$$,
  'P0001', 'El documento no proviene de una proforma',
  'una nota de venta de comercio no se deshace como estado de pago'
);

-- 55) El documento de B "no existe" para la empresa A.
select throws_ok(
  $$select anular_estado_pago('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'd0c00002-0000-0000-0000-bbbbbbbbbbbb')$$,
  'P0001', 'El documento no existe',
  'un documento de otra empresa da el mismo mensaje que uno inexistente'
);

-- ===== Aislamiento y anónimo =====

-- 56) Beto (org B) ve SOLO sus 5 filas en las 5 tablas nuevas (las ~10 de A serían visibles si la RLS fallara).
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
select is(
  (select count(*) from vehiculos) + (select count(*) from conductores) + (select count(*) from destinos)
    + (select count(*) from ordenes_entrega) + (select count(*) from proformas),
  5::bigint,
  'Beto ve solo lo suyo: una fila por tabla de transporte, nada de la empresa A'
);

-- 57) Anónimo denegado de plano.
set local request.jwt.claims to '{"role": "anon"}';
set local role anon;
select throws_ok(
  'select count(*) from ordenes_entrega',
  '42501', 'permission denied for table ordenes_entrega',
  'un anónimo no puede consultar órdenes de entrega'
);

-- ===== Módulo off: crear_proforma también lo bloquea; anular_orden_entrega sigue viva =====

-- Setup: apagar el módulo de A y fabricar una ODE fresca por insert directo (superuser
-- salta la RPC a propósito: aquí no se prueba crear_orden_entrega, sino que crear_proforma
-- comparte su guard y que anular_orden_entrega no depende del módulo).
reset role;
update public.empresas set modulo_transporte = false where id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa';
insert into public.ordenes_entrega (id, empresa_id, numero, cliente_id, fecha_ingreso, destino_id, bultos, kilos, kilo_afecto, neto)
values ('0de00002-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 6,
        'cccccccc-0000-0000-0000-aaaaaaaaaaaa', current_date, 'dddd0001-0000-0000-0000-aaaaaaaaaaaa', 1, 10, 10, 1000);
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- 58) Con el módulo apagado crear_proforma también se bloquea (mismo guard y mensaje que
--     crear_orden_entrega; Ana es dueña así que el rol pasa: el único bloqueo es el módulo).
select throws_ok(
  $$select crear_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
    array['0de00002-0000-0000-0000-aaaaaaaaaaaa'::uuid], null)$$,
  'P0001', 'El módulo de transporte no está activo',
  'con el módulo apagado tampoco se crean proformas'
);

-- 59) Apagar el módulo NO bloquea la operación existente: anular_orden_entrega sigue viva.
select lives_ok(
  $$select anular_orden_entrega('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    '0de00002-0000-0000-0000-aaaaaaaaaaaa', 'limpieza fin de suite')$$,
  'apagar el módulo no bloquea la operación existente: anular_orden_entrega sigue viva'
);

select * from finish();
rollback;
