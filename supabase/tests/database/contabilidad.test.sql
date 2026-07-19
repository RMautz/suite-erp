begin;
create extension if not exists pgtap with schema extensions;
select plan(36);

insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'ana@a.cl'),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'beto@b.cl'),
  ('00000000-0000-0000-0000-000000000000', '55555555-5555-5555-5555-555555555555', 'authenticated', 'authenticated', 'ces@a.cl'),
  ('00000000-0000-0000-0000-000000000000', '77777777-7777-7777-7777-777777777777', 'authenticated', 'authenticated', 'vero@a.cl');

-- RUT nuevos, únicos GLOBALES (módulo 11): no colisionan con ningún test, el seed
-- ni los E2E (grep = 0 coincidencias). A activa contabilidad por RPC; B queda sin ella
-- (gating cross-tenant + cuenta ajena).
insert into public.organizaciones (id, rut, razon_social)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '769010007', 'Org A'),
       ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '769020002', 'Org B');

-- modulo_contabilidad NO se setea aquí (sin grant, default false): A lo enciende vía
-- activar_contabilidad (camino real); B nunca lo enciende.
insert into public.empresas (id, organizacion_id, rut, razon_social)
values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '769010007', 'Contable A'),
       ('eeeeeeee-0000-0000-0000-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '769020002', 'Empresa B');

-- Ana dueña de A, Beto dueño de B, Ces CONTADOR de A, Vero VENDEDORA de A.
insert into public.miembros (usuario_id, organizacion_id, rol)
values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'dueno'),
       ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'dueno'),
       ('55555555-5555-5555-5555-555555555555', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'contador'),
       ('77777777-7777-7777-7777-777777777777', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'vendedor');

insert into public.clientes (id, empresa_id, rut, razon_social)
values ('cccccccc-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '769031006', 'Cliente A1');
insert into public.proveedores (id, empresa_id, rut, razon_social)
values ('dddd0000-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '769040005', 'Proveedor A');

-- ===== Documentos por insert DIRECTO (superuser salta grants/RLS, patrón cobranza) =====
-- Todos respetan el CHECK total = neto+exento+iva (0022). Cada golden lee del documento real.
insert into public.documentos_venta (id, empresa_id, tipo, cliente_id, folio, estado, neto, exento, iva, total, emitido_en)
values
  -- e1: venta con exento (golden 19)          -- e2: venta sin exento (golden 20)
  ('dddddddd-0000-0000-0000-0000000000e1', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'factura', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 1001, 'emitido', 100000, 20000, 19000, 139000, now()),
  ('dddddddd-0000-0000-0000-0000000000e2', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'factura', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 1002, 'emitido', 100000, 0, 19000, 119000, now()),
  -- e3: nota de crédito (golden 21)            -- e4: total 0 (golden 27 noop)
  ('dddddddd-0000-0000-0000-0000000000e3', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'nota_credito', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 1003, 'emitido', 50000, 0, 9500, 59500, now()),
  ('dddddddd-0000-0000-0000-0000000000e4', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'factura', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 1004, 'emitido', 0, 0, 0, 0, now()),
  -- e5: factura que recibe el anticipo aplicado (golden 24: genera el pago con anticipo_id)
  ('dddddddd-0000-0000-0000-0000000000e5', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'factura', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 1005, 'emitido', 40000, 0, 0, 40000, now());

-- Compra activa (golden 22): fecha contable = fecha_emision.
insert into public.documentos_compra (id, empresa_id, proveedor_id, tipo, folio, fecha_emision, neto, exento, iva, total, estado)
values ('dc000000-0000-0000-0000-0000000000c1', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'dddd0000-0000-0000-0000-aaaaaaaaaaaa', 'factura', 1, date '2026-07-05', 80000, 10000, 15200, 105200, 'activa');

-- Pago SIN anticipo_id (golden 23: Banco/Clientes; reversado + no re-creado en 29).
insert into public.pagos (id, empresa_id, cliente_id, monto, metodo, estado)
values ('fafa0000-0000-0000-0000-0000000000f1', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 50000, 'transferencia', 'activo');

-- Anticipos: e6 nuevo con mp_payment_id (golden 25); e7 se aplicará (golden 24);
-- e8 excedente-de-aplicación con mp_payment_id NULL (golden 26 noop). origen_id polimórfico sin FK.
insert into public.anticipos (id, empresa_id, cliente_id, origen_tipo, origen_id, monto, mp_payment_id, estado)
values
  ('a0a00000-0000-0000-0000-0000000000e6', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 'proforma', 'a0a0a0a0-0000-0000-0000-0000000000d1', 60000, 'mp-ant-new', 'recibido'),
  ('a0a00000-0000-0000-0000-0000000000e7', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 'proforma', 'a0a0a0a0-0000-0000-0000-0000000000d2', 40000, 'mp-ant-apl', 'recibido'),
  ('a0a00000-0000-0000-0000-0000000000e8', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 'excedente', 'dddddddd-0000-0000-0000-0000000000e5', 20000, null, 'recibido');

-- Cuenta AJENA: una cuenta de la empresa B (insert directo; B nunca activó, no tiene catálogo).
-- Referida por el test 9 (crear_asiento con cuenta de otra empresa).
insert into public.cuentas_contables (id, empresa_id, codigo, nombre, tipo, acepta_movimientos, activa)
values ('caca0000-0000-0000-0000-0000000000b1', 'eeeeeeee-0000-0000-0000-bbbbbbbbbbbb', '1.1.01', 'Banco B', 'activo', true, true);

-- ===== Activación (Ana, dueña A) =====
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- Dos llamadas: la segunda no debe re-sembrar el catálogo (idempotente).
select activar_contabilidad('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa');
select activar_contabilidad('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa');

-- 1) Idempotente: 14 claves de sistema (no 28) y el flag encendido.
select is(
  (select count(*) from cuentas_contables
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema is not null)::text
  || '/' ||
  (select modulo_contabilidad from empresas where id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa')::text,
  '14/true',
  'activar es idempotente: las 14 claves de sistema y el flag encendido'
);

-- 2) Flip crudo del flag bloqueado: modulo_contabilidad quedó FUERA del grant por columnas.
select throws_ok(
  $$update empresas set modulo_contabilidad = false where id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'$$,
  '42501', 'permission denied for table empresas',
  'ni la dueña puede apagar el módulo por escritura directa (solo por RPC)'
);

-- ===== guardar_cuenta (Ana) =====
-- SETUP (felices sin assert): una cuenta propia ACTIVA (blanco del duplicado) y una INACTIVA
-- (blanco del test de cuenta inactiva). Si fallaran, el archivo aborta.
select guardar_cuenta('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', null, '5.99.01', 'Fletes especiales', 'gasto', true, true);
select guardar_cuenta('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', null, '5.99.02', 'Gasto inactivo', 'gasto', true, false);

-- 3) Cuenta de sistema protegida: intentar cambiarle tipo y activa lanza (código nuevo, sin colisión).
select throws_ok(
  $$select guardar_cuenta('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema = 'banco'),
    '9.9.97', 'Banco', 'pasivo', true, false)$$,
  'P0001', 'Las cuentas del sistema no se pueden modificar así',
  'una cuenta de sistema no admite cambio de tipo/activa'
);

-- 4) Código duplicado: '5.99.01' ya existe (creada arriba).
select throws_ok(
  $$select guardar_cuenta('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', null, '5.99.01', 'Otra cuenta', 'gasto', true, true)$$,
  'P0001', 'Ya existe una cuenta con ese código',
  'no se crean dos cuentas con el mismo código'
);

-- ===== crear_asiento =====

-- 5) Módulo inactivo: Beto (dueño de B, pasa el rol) crea sobre B → falla por módulo.
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
select throws_ok(
  $$select crear_asiento('eeeeeeee-0000-0000-0000-bbbbbbbbbbbb', current_date, 'Prueba', jsonb_build_array(
    jsonb_build_object('cuentaId', gen_random_uuid(), 'debe', 100, 'haber', 0),
    jsonb_build_object('cuentaId', gen_random_uuid(), 'debe', 0, 'haber', 100)))$$,
  'P0001', 'La contabilidad no está activada',
  'sin el módulo activo no se crean asientos'
);

-- El CONTADOR (Ces) crea los DOS primeros asientos de A: multi-línea, balanceados.
set local request.jwt.claims to '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated"}';
select crear_asiento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', current_date, 'Asiento manual uno', jsonb_build_array(
  jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema = 'banco'), 'debe', 30000, 'haber', 0),
  jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema = 'ventas'), 'debe', 0, 'haber', 30000)));
select crear_asiento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', current_date, 'Asiento manual dos', jsonb_build_array(
  jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema = 'banco'), 'debe', 20000, 'haber', 0),
  jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema = 'ventas'), 'debe', 0, 'haber', 20000)));

-- 6) Contador feliz + correlativo consecutivo: los dos asientos llevan numero 1 y 2.
select is(
  (select numero from asientos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and glosa = 'Asiento manual uno')::text
  || '/' ||
  (select numero from asientos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and glosa = 'Asiento manual dos')::text,
  '1/2',
  'el contador crea asientos y el correlativo es consecutivo (1 y 2)'
);

-- Negativos como Ana (dueña, con permiso: así el error es el de validación, no el de rol).
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- 7) Descuadrado (100 debe vs 200 haber).
select throws_ok(
  $$select crear_asiento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', current_date, 'Descuadrado', jsonb_build_array(
    jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema = 'banco'), 'debe', 100, 'haber', 0),
    jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema = 'ventas'), 'debe', 0, 'haber', 200)))$$,
  'P0001', 'El asiento no cuadra: debe y haber difieren',
  'un asiento con debe distinto de haber no entra'
);

-- 8) Una sola línea.
select throws_ok(
  $$select crear_asiento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', current_date, 'Una línea', jsonb_build_array(
    jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema = 'banco'), 'debe', 100, 'haber', 0)))$$,
  'P0001', 'Un asiento necesita al menos dos líneas',
  'un asiento de una sola línea no entra'
);

-- 9) Cuenta AJENA (de la empresa B).
select throws_ok(
  $$select crear_asiento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', current_date, 'Ajena', jsonb_build_array(
    jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema = 'banco'), 'debe', 100, 'haber', 0),
    jsonb_build_object('cuentaId', 'caca0000-0000-0000-0000-0000000000b1', 'debe', 0, 'haber', 100)))$$,
  'P0001', 'Cuenta contable no válida',
  'una cuenta de otra empresa no es válida'
);

-- 10) Cuenta INACTIVA (la 5.99.02 creada con activa=false).
select throws_ok(
  $$select crear_asiento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', current_date, 'Inactiva', jsonb_build_array(
    jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema = 'banco'), 'debe', 100, 'haber', 0),
    jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and codigo = '5.99.02'), 'debe', 0, 'haber', 100)))$$,
  'P0001', 'Cuenta contable no válida',
  'una cuenta inactiva no recibe líneas'
);

-- 11) Cuenta NO-HOJA (acepta_movimientos = false).
select throws_ok(
  $$select crear_asiento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', current_date, 'No hoja', jsonb_build_array(
    jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and acepta_movimientos = false limit 1), 'debe', 100, 'haber', 0),
    jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema = 'ventas'), 'debe', 0, 'haber', 100)))$$,
  'P0001', 'Cuenta contable no válida',
  'una cuenta que no acepta movimientos no recibe líneas'
);

-- 12) Una línea con debe Y haber positivos a la vez.
select throws_ok(
  $$select crear_asiento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', current_date, 'Doble monto', jsonb_build_array(
    jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema = 'banco'), 'debe', 100, 'haber', 0),
    jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema = 'ventas'), 'debe', 100, 'haber', 100)))$$,
  'P0001', 'Cada línea lleva debe o haber, mayor que cero',
  'una línea no puede llevar debe y haber juntos'
);

-- 13) Vendedor (Vero): el rol se chequea PRIMERO, así que ids ficticios igual dan el mensaje de rol.
set local request.jwt.claims to '{"sub": "77777777-7777-7777-7777-777777777777", "role": "authenticated"}';
select throws_ok(
  $$select crear_asiento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', current_date, 'Vendedor', jsonb_build_array(
    jsonb_build_object('cuentaId', gen_random_uuid(), 'debe', 100, 'haber', 0),
    jsonb_build_object('cuentaId', gen_random_uuid(), 'debe', 0, 'haber', 100)))$$,
  'P0001', 'Tu rol no permite crear asientos',
  'el vendedor no crea asientos'
);

-- ===== revertir_asiento (Ana) =====
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- 14) Asiento inexistente.
select throws_ok(
  $$select revertir_asiento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', gen_random_uuid(), 'Reversa')$$,
  'P0001', 'El asiento no existe',
  'no se revierte un asiento que no existe'
);

-- SETUP feliz (sin assert): revertir el "Asiento manual uno" (Banco 30000 / Ventas 30000).
select revertir_asiento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from asientos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and glosa = 'Asiento manual uno'),
  'Reversa de prueba');

-- 15) La reversa lleva las líneas ESPEJO: Banco al haber, Ventas al debe (order by clave).
select is(
  (select string_agg(c.clave_sistema || ':' || l.debe || ':' || l.haber, '|' order by c.clave_sistema)
   from asientos_lineas l
   join cuentas_contables c on c.empresa_id = l.empresa_id and c.id = l.cuenta_id
   where l.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and l.asiento_id = (select id from asientos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
                         and reversa_de = (select id from asientos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and glosa = 'Asiento manual uno'))),
  'banco:0:30000|ventas:30000:0',
  'la reversa invierte debe y haber del asiento original'
);

-- 16) Doble reversa: el "Asiento manual uno" ya fue revertido.
select throws_ok(
  $$select revertir_asiento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from asientos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and glosa = 'Asiento manual uno'),
    'Otra reversa')$$,
  'P0001', 'El asiento ya fue revertido',
  'un asiento se revierte a lo más una vez'
);

-- 17) Revertir una reversa: las reversas no se revierten (mismo mensaje).
select throws_ok(
  $$select revertir_asiento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from asientos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and reversa_de = (select id from asientos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and glosa = 'Asiento manual uno')),
    'Reversa de reversa')$$,
  'P0001', 'El asiento ya fue revertido',
  'una reversa no se revierte'
);

-- 18) contabilizar_documento es SOLO service_role: authenticated → 42501 (el grant ES el candado).
select throws_ok(
  $$select contabilizar_documento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'venta', 'dddddddd-0000-0000-0000-0000000000e1')$$,
  '42501', 'permission denied for function contabilizar_documento',
  'authenticated no ejecuta contabilizar_documento (solo el hook service_role)'
);

-- SETUP (feliz sin assert): aplicar el anticipo e7 a la factura e5 → nace un pago con anticipo_id
-- (re-create real de aplicar_anticipo_manual). Probado por el golden 24.
select aplicar_anticipo_manual('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  'a0a00000-0000-0000-0000-0000000000e7', 'dddddddd-0000-0000-0000-0000000000e5');

-- ===== contabilizar_documento (service_role, el hook): goldens por regla + noops =====
-- service_role salta RLS y lee asientos/líneas/cuentas para verificar cada golden.
set local role service_role;

-- SETUP: contabiliza cada documento (creado). Un fallo aborta el archivo.
select contabilizar_documento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'venta', 'dddddddd-0000-0000-0000-0000000000e1');
select contabilizar_documento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'venta', 'dddddddd-0000-0000-0000-0000000000e2');
select contabilizar_documento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'nota_credito', 'dddddddd-0000-0000-0000-0000000000e3');
select contabilizar_documento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'compra', 'dc000000-0000-0000-0000-0000000000c1');
select contabilizar_documento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'pago', 'fafa0000-0000-0000-0000-0000000000f1');
select contabilizar_documento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'pago',
  (select id from pagos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and anticipo_id = 'a0a00000-0000-0000-0000-0000000000e7'));
select contabilizar_documento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'anticipo', 'a0a00000-0000-0000-0000-0000000000e6');

-- 19) GOLDEN venta con exento: Clientes(debe 139000) · IVA débito(haber 19000) · Ventas(haber 100000) · Ventas exentas(haber 20000).
select is(
  (select string_agg(c.clave_sistema || ':' || l.debe || ':' || l.haber, '|' order by c.clave_sistema)
   from asientos_lineas l join cuentas_contables c on c.empresa_id = l.empresa_id and c.id = l.cuenta_id
   where l.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and l.asiento_id = (select id from asientos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and origen = 'venta' and referencia_id = 'dddddddd-0000-0000-0000-0000000000e1')),
  'clientes:139000:0|iva_debito:0:19000|ventas:0:100000|ventas_exentas:0:20000',
  'venta con exento: Clientes al debe por el total; Ventas, Ventas exentas e IVA débito al haber'
);

-- 20) GOLDEN venta SIN exento: la línea de Ventas exentas (monto 0) se OMITE.
select is(
  (select string_agg(c.clave_sistema || ':' || l.debe || ':' || l.haber, '|' order by c.clave_sistema)
   from asientos_lineas l join cuentas_contables c on c.empresa_id = l.empresa_id and c.id = l.cuenta_id
   where l.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and l.asiento_id = (select id from asientos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and origen = 'venta' and referencia_id = 'dddddddd-0000-0000-0000-0000000000e2')),
  'clientes:119000:0|iva_debito:0:19000|ventas:0:100000',
  'venta sin exento: tres líneas, sin la de ventas exentas (monto 0 omitido)'
);

-- 21) GOLDEN nota de crédito: inversa de la venta.
select is(
  (select string_agg(c.clave_sistema || ':' || l.debe || ':' || l.haber, '|' order by c.clave_sistema)
   from asientos_lineas l join cuentas_contables c on c.empresa_id = l.empresa_id and c.id = l.cuenta_id
   where l.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and l.asiento_id = (select id from asientos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and origen = 'nota_credito' and referencia_id = 'dddddddd-0000-0000-0000-0000000000e3')),
  'clientes:0:59500|iva_debito:9500:0|ventas:50000:0',
  'nota de crédito: Ventas e IVA débito al debe; Clientes al haber por el total'
);

-- 22) GOLDEN compra: Compras/Gastos(debe neto+exento) · IVA crédito(debe) · Proveedores(haber total).
select is(
  (select string_agg(c.clave_sistema || ':' || l.debe || ':' || l.haber, '|' order by c.clave_sistema)
   from asientos_lineas l join cuentas_contables c on c.empresa_id = l.empresa_id and c.id = l.cuenta_id
   where l.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and l.asiento_id = (select id from asientos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and origen = 'compra' and referencia_id = 'dc000000-0000-0000-0000-0000000000c1')),
  'compras_gastos:90000:0|iva_credito:15200:0|proveedores:0:105200',
  'compra: Compras/Gastos (neto+exento) e IVA crédito al debe; Proveedores al haber'
);

-- 23) GOLDEN pago SIN anticipo_id → Banco(debe) · Clientes(haber): plata nueva.
select is(
  (select string_agg(c.clave_sistema || ':' || l.debe || ':' || l.haber, '|' order by c.clave_sistema)
   from asientos_lineas l join cuentas_contables c on c.empresa_id = l.empresa_id and c.id = l.cuenta_id
   where l.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and l.asiento_id = (select id from asientos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and origen = 'pago' and referencia_id = 'fafa0000-0000-0000-0000-0000000000f1')),
  'banco:50000:0|clientes:0:50000',
  'pago sin anticipo_id: Banco al debe (plata nueva), Clientes al haber'
);

-- 24) GOLDEN pago CON anticipo_id → Anticipos de clientes(debe) · Clientes(haber): reclasificación.
select is(
  (select string_agg(c.clave_sistema || ':' || l.debe || ':' || l.haber, '|' order by c.clave_sistema)
   from asientos_lineas l join cuentas_contables c on c.empresa_id = l.empresa_id and c.id = l.cuenta_id
   where l.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and l.asiento_id = (select id from asientos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and origen = 'pago'
                         and referencia_id = (select id from pagos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and anticipo_id = 'a0a00000-0000-0000-0000-0000000000e7'))),
  'anticipos_clientes:40000:0|clientes:0:40000',
  'pago con anticipo_id: Anticipos de clientes al debe (reclasificación), Clientes al haber'
);

-- 25) GOLDEN anticipo con mp_payment_id → Banco(debe) · Anticipos de clientes(haber).
select is(
  (select string_agg(c.clave_sistema || ':' || l.debe || ':' || l.haber, '|' order by c.clave_sistema)
   from asientos_lineas l join cuentas_contables c on c.empresa_id = l.empresa_id and c.id = l.cuenta_id
   where l.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and l.asiento_id = (select id from asientos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and origen = 'anticipo' and referencia_id = 'a0a00000-0000-0000-0000-0000000000e6')),
  'anticipos_clientes:0:60000|banco:60000:0',
  'anticipo con mp_payment_id: Banco al debe, Anticipos de clientes al haber'
);

-- 26) Anticipo-excedente de aplicación (mp_payment_id NULL) → noop, sin asiento (no duplica el pasivo).
select is(
  contabilizar_documento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'anticipo', 'a0a00000-0000-0000-0000-0000000000e8')
  || '/' ||
  (select count(*) from asientos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and origen = 'anticipo' and referencia_id = 'a0a00000-0000-0000-0000-0000000000e8')::text,
  'noop/0',
  'el excedente de aplicación (mp_payment_id null) no genera asiento'
);

-- 27) Documento total 0 → noop, sin asiento (0 líneas).
select is(
  contabilizar_documento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'venta', 'dddddddd-0000-0000-0000-0000000000e4')
  || '/' ||
  (select count(*) from asientos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and origen = 'venta' and referencia_id = 'dddddddd-0000-0000-0000-0000000000e4')::text,
  'noop/0',
  'un documento en 0 no genera asiento ni queda pendiente'
);

-- 28) Idempotencia: re-contabilizar la venta con exento → noop y sigue habiendo UN asiento.
select is(
  contabilizar_documento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'venta', 'dddddddd-0000-0000-0000-0000000000e1')
  || '/' ||
  (select count(*) from asientos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and origen = 'venta' and referencia_id = 'dddddddd-0000-0000-0000-0000000000e1')::text,
  'noop/1',
  'contabilizar dos veces el mismo documento es noop: un solo asiento'
);

set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- SETUP (sin assert): revertir el asiento AUTOMÁTICO del pago f1, luego correr el catch-up.
select revertir_asiento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from asientos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and origen = 'pago' and referencia_id = 'fafa0000-0000-0000-0000-0000000000f1'),
  'Reversa del pago automático');
select contabilizar_pendientes('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa');

-- 29) La reversa de un automático NO se re-crea: el unique (empresa,'pago',pago) sigue ocupado
--     por el asiento original inmutable → count sigue en 1.
select is(
  (select count(*) from asientos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and origen = 'pago' and referencia_id = 'fafa0000-0000-0000-0000-0000000000f1'),
  1::bigint,
  'un asiento automático revertido no se re-crea vía contabilizar_pendientes'
);

-- ===== Candados de escritura directa (Ana) =====

-- 30) Insert directo en asientos.
select throws_ok(
  $$insert into asientos (empresa_id, numero, fecha, glosa, origen)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 999, current_date, 'hack', 'manual')$$,
  '42501', 'permission denied for table asientos',
  'authenticated no inserta asientos directamente'
);

-- 31) Insert directo en asientos_lineas.
select throws_ok(
  $$insert into asientos_lineas (empresa_id, asiento_id, cuenta_id, debe, haber)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', gen_random_uuid(), gen_random_uuid(), 100, 0)$$,
  '42501', 'permission denied for table asientos_lineas',
  'authenticated no inserta líneas directamente'
);

-- 32) Update directo en cuentas_contables (toda edición es por guardar_cuenta).
select throws_ok(
  $$update cuentas_contables set nombre = 'hack' where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'$$,
  '42501', 'permission denied for table cuentas_contables',
  'authenticated no edita cuentas directamente'
);

-- ===== RLS por ROL =====

-- 33) El CONTADOR (Ces) ve asientos y líneas.
set local request.jwt.claims to '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated"}';
select ok(
  (select count(*) from asientos) > 0 and (select count(*) from asientos_lineas) > 0,
  'el contador ve los asientos y sus líneas'
);

-- 34) El VENDEDOR (Vero) ve 0 en las tres tablas (primer select por ROL del repo).
set local request.jwt.claims to '{"sub": "77777777-7777-7777-7777-777777777777", "role": "authenticated"}';
select is(
  (select count(*) from asientos) + (select count(*) from asientos_lineas) + (select count(*) from cuentas_contables),
  0::bigint,
  'el vendedor no ve nada de contabilidad (select restringido por rol)'
);

-- 35) Cross-tenant: Beto (dueño de B, sin asientos) no ve los de A.
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
select is(
  (select count(*) from asientos),
  0::bigint,
  'un dueño de otra empresa no ve asientos ajenos'
);

-- 36) Anónimo denegado de plano.
set local request.jwt.claims to '{"role": "anon"}';
set local role anon;
select throws_ok(
  'select count(*) from asientos',
  '42501', 'permission denied for table asientos',
  'un anónimo no puede consultar asientos'
);

select * from finish();
rollback;
