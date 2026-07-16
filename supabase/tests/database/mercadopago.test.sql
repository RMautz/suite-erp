begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'ana@a.cl'),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'beto@b.cl'),
  ('00000000-0000-0000-0000-000000000000', '55555555-5555-5555-5555-555555555555', 'authenticated', 'authenticated', 'ces@a.cl'),
  ('00000000-0000-0000-0000-000000000000', '77777777-7777-7777-7777-777777777777', 'authenticated', 'authenticated', 'vero@a.cl');

-- RUT nuevos, únicos GLOBALES: no colisionan con otros tests (7611/7622/7633/7644/
-- 7655/7666/7677/7688/76121212x/76343434x/76464646x/76888888x/76123456x), el seed
-- (771234569, 778899000) ni los E2E (999999999, 888888888, 666666666, 765000017).
insert into public.organizaciones (id, rut, razon_social)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '769111115', 'Org A'),
       ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '769222227', 'Org B');

-- A nace con el módulo ACTIVO (las RPCs de ODE lo exigen); B queda off (solo siembra fijas).
insert into public.empresas (id, organizacion_id, rut, razon_social, modulo_transporte)
values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '769111115', 'Transportes A', true),
       ('eeeeeeee-0000-0000-0000-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '769222227', 'Empresa B', false);

insert into public.miembros (usuario_id, organizacion_id, rol)
values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'dueno'),
       ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'dueno'),
       ('55555555-5555-5555-5555-555555555555', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'contador'),
       ('77777777-7777-7777-7777-777777777777', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'vendedor');

-- A1 (blanco principal), A2 (para "documento de otro cliente"), B (dueño de las filas de aislamiento).
insert into public.clientes (id, empresa_id, rut, razon_social)
values ('cccccccc-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '769333339', 'Cliente A1'),
       ('cccccccc-1111-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '769444440', 'Cliente A2'),
       ('cccccccc-0000-0000-0000-bbbbbbbbbbbb', 'eeeeeeee-0000-0000-0000-bbbbbbbbbbbb', '769555552', 'Cliente B');

insert into public.vehiculos (id, empresa_id, patente, descripcion)
values ('aaaa0001-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'ABCD12', 'Camión A');
insert into public.destinos (id, empresa_id, nombre, tarifa_kg)
values ('dddd0001-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'Coyhaique', 450);
-- P1 afecto para la cotización.
insert into public.productos (id, empresa_id, sku, nombre, precio_neto, exento)
values ('99999999-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'P1', 'Producto Afecto', 10000, false);

-- Facturas emitidas por insert DIRECTO (superuser salta grants/RLS, patrón cobranza.test.sql).
-- neto = total, iva/exento 0: documentos_venta no cruza-chequea total = neto+iva+exento.
insert into public.documentos_venta (id, empresa_id, tipo, cliente_id, folio, estado, neto, exento, iva, total, emitido_en)
values ('dddddddd-0000-0000-0000-000000000101', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'factura', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 101, 'emitido', 100000, 0, 0, 100000, now()),
       ('dddddddd-0000-0000-0000-000000000102', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'factura', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 102, 'emitido', 50000, 0, 0, 50000, now()),
       ('dddddddd-0000-0000-0000-000000000103', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'factura', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 103, 'emitido', 100000, 0, 0, 100000, now()),
       ('dddddddd-0000-0000-0000-000000000104', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'factura', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 104, 'emitido', 50000, 0, 0, 50000, now()),
       ('dddddddd-0000-0000-0000-000000000105', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'factura', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 105, 'emitido', 50000, 0, 0, 50000, now()),
       ('dddddddd-0000-0000-0000-000000000106', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'factura', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 106, 'emitido', 71400, 0, 0, 71400, now()),
       ('dddddddd-0000-0000-0000-000000000107', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'factura', 'cccccccc-1111-0000-0000-aaaaaaaaaaaa', 107, 'emitido', 40000, 0, 0, 40000, now());
-- NC que deja el 102 en saldo 0 (para "factura sin saldo"): total - NC = 0.
insert into public.documentos_venta (id, empresa_id, tipo, cliente_id, folio, estado, neto, exento, iva, total, documento_referencia_id, emitido_en)
values ('dddddddd-0000-0000-0000-0000000001c2', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'nota_credito', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 202, 'emitido', 50000, 0, 0, 50000, 'dddddddd-0000-0000-0000-000000000102', now());

-- Fixtures de B por insert directo: 1 link + 1 anticipo, blancos del aislamiento POSITIVO
-- (origen_id es polimórfico, SIN FK: uuid dummy; cliente_id sí es FK compuesta a B).
insert into public.links_pago (empresa_id, origen_tipo, origen_id, cliente_id, monto, preferencia_id, url)
values ('eeeeeeee-0000-0000-0000-bbbbbbbbbbbb', 'factura', 'a0a0a0a0-0000-0000-0000-0000000000b1', 'cccccccc-0000-0000-0000-bbbbbbbbbbbb', 1000, 'pref-b', 'https://mp/b');
insert into public.anticipos (empresa_id, cliente_id, origen_tipo, origen_id, monto, mp_payment_id)
values ('eeeeeeee-0000-0000-0000-bbbbbbbbbbbb', 'cccccccc-0000-0000-0000-bbbbbbbbbbbb', 'proforma', 'a0a0a0a0-0000-0000-0000-0000000000b2', 1000, 'mp-b');

-- ===== Ana (dueña A): ODEs y proformas por el camino REAL (fechas fijas julio 2026) =====
-- Si cualquier setup fallara, el archivo entero aborta (feliz cubierto sin assert propio).
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select crear_orden_entrega('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
  date '2026-07-10', 'dddd0001-0000-0000-0000-aaaaaaaaaaaa', 'GD 1', null,
  1, 100, null, 100000, 'aaaa0001-0000-0000-0000-aaaaaaaaaaaa', null, null);
select crear_orden_entrega('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
  date '2026-07-10', 'dddd0001-0000-0000-0000-aaaaaaaaaaaa', 'GD 2', null,
  1, 100, null, 50000, null, null, null);
select crear_orden_entrega('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
  date '2026-07-10', 'dddd0001-0000-0000-0000-aaaaaaaaaaaa', 'GD 3', null,
  1, 100, null, 60000, null, null, null);

-- PF1 (numero 1): total 119000 → el flujo de aplicar_anticipo. PF2 (numero 2): total 59500 →
-- origen rechazado. PF3 (numero 3): total 71400 → anticipo del botón manual.
select crear_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
  array[(select id from ordenes_entrega where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1)], null);
select crear_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
  array[(select id from ordenes_entrega where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 2)], null);
select crear_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
  array[(select id from ordenes_entrega where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 3)], null);

-- ===== crear_link_pago: validaciones por tipo (Ana) =====

-- 1) Factura sin saldo: el 102 quedó en 0 por la NC → no se genera link.
select throws_ok(
  $$select crear_link_pago('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', gen_random_uuid(), 'factura',
    'dddddddd-0000-0000-0000-000000000102', 'pref-x', 'https://mp/x', 1)$$,
  'P0001', 'Solo se generan links para facturas emitidas con saldo',
  'no se genera link para una factura sin saldo'
);

-- 2) Factura con saldo pero monto ≠ saldo (saldo 100000, monto 50000).
select throws_ok(
  $$select crear_link_pago('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', gen_random_uuid(), 'factura',
    'dddddddd-0000-0000-0000-000000000101', 'pref-x', 'https://mp/x', 50000)$$,
  'P0001', 'El monto no coincide con el saldo del documento',
  'el monto del link debe igualar el saldo de la factura'
);

-- 3) Proforma en borrador (PF1 aún sin enviar) no admite link.
select throws_ok(
  $$select crear_link_pago('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', gen_random_uuid(), 'proforma',
    (select id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1),
    'pref-x', 'https://mp/x', 119000)$$,
  'P0001', 'La proforma no permite link de pago en su estado actual',
  'una proforma en borrador no admite link de pago'
);

-- Enviar PF1: ya admite link (enviada/aprobada pagan el TOTAL como anticipo).
select cambiar_estado_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1), 'enviada');

-- 4) Proforma enviada pero monto ≠ total (total 119000, monto 1).
select throws_ok(
  $$select crear_link_pago('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', gen_random_uuid(), 'proforma',
    (select id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1),
    'pref-x', 'https://mp/x', 1)$$,
  'P0001', 'El monto no coincide con el total del documento',
  'el monto del link debe igualar el total de la proforma'
);

-- Cotización enviada (numero 1): total 10000 + iva 1900 = 11900. Solo 'aceptada' admite link.
select crear_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
  current_date + 30, null,
  '[{"productoId":"99999999-0000-0000-0000-aaaaaaaaaaaa","cantidad":1,"precioNeto":10000}]'::jsonb);
select cambiar_estado_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from cotizaciones where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1), 'enviada');

-- 5) Cotización 'enviada' (no 'aceptada') no admite link, con el monto correcto: falla por ESTADO.
select throws_ok(
  $$select crear_link_pago('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', gen_random_uuid(), 'cotizacion',
    (select id from cotizaciones where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1),
    'pref-x', 'https://mp/x', 11900)$$,
  'P0001', 'La cotización no permite link de pago en su estado actual',
  'solo una cotización aceptada admite link; la enviada no'
);

-- ===== Roles (Ces contador) =====
set local request.jwt.claims to '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated"}';

-- 6) El contador NO genera links (rol dueno/admin/vendedor).
select throws_ok(
  $$select crear_link_pago('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', gen_random_uuid(), 'factura',
    'dddddddd-0000-0000-0000-000000000101', 'pref-x', 'https://mp/x', 100000)$$,
  'P0001', 'Tu rol no permite generar links de pago',
  'el contador no puede generar links de pago'
);

-- 7) El contador tampoco aplica anticipos: el rol se chequea ANTES de mirar el anticipo
--    (por eso un id de anticipo inexistente igual da el mensaje de rol).
select throws_ok(
  $$select aplicar_anticipo_manual('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    '00000000-0000-0000-0000-000000000000', 'dddddddd-0000-0000-0000-000000000106')$$,
  'P0001', 'Tu rol no permite aplicar anticipos',
  'el contador no puede aplicar anticipos'
);

-- ===== Vendedora (Vero): crea el link de DOC_LINK — SETUP (vendedor SÍ genera links) =====
set local request.jwt.claims to '{"sub": "77777777-7777-7777-7777-777777777777", "role": "authenticated"}';
select crear_link_pago('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', gen_random_uuid(), 'factura',
  'dddddddd-0000-0000-0000-000000000101', 'pref-doclink-1', 'https://mp/doclink-1', 100000);

-- ===== Ana: regenerar reemplaza; links de los flujos de pago/anticipo =====
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- SETUP: regenerar el link del 101 → el nuevo vigente, el viejo pasa a 'reemplazado'.
select crear_link_pago('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', gen_random_uuid(), 'factura',
  'dddddddd-0000-0000-0000-000000000101', 'pref-doclink-2', 'https://mp/doclink-2', 100000);

-- 8) Un solo link vigente por objeto; el anterior quedó 'reemplazado'.
select is(
  (select count(*) from links_pago
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and origen_id = 'dddddddd-0000-0000-0000-000000000101' and estado = 'vigente')::text
  || '/' ||
  (select estado from links_pago where preferencia_id = 'pref-doclink-1'),
  '1/reemplazado',
  'regenerar deja un solo link vigente y el anterior reemplazado'
);

-- SETUP: links de los tres flujos de registrar_pago_mp (monto = saldo al crearlos).
select crear_link_pago('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', gen_random_uuid(), 'factura',
  'dddddddd-0000-0000-0000-000000000103', 'pref-pay1', 'https://mp/pay1', 100000);
select crear_link_pago('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', gen_random_uuid(), 'factura',
  'dddddddd-0000-0000-0000-000000000104', 'pref-pay2', 'https://mp/pay2', 50000);
select crear_link_pago('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', gen_random_uuid(), 'factura',
  'dddddddd-0000-0000-0000-000000000105', 'pref-pay3', 'https://mp/pay3', 50000);

-- SETUP: link de PF1 (enviada) para el anticipo que se aplicará al facturar.
select crear_link_pago('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', gen_random_uuid(), 'proforma',
  (select id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1),
  'pref-pf-aplicar', 'https://mp/pf-aplicar', 119000);

-- PF2: enviar + link + rechazar (sin anticipo aún) — el rechazo fluye igual que 0016.
select cambiar_estado_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 2), 'enviada');
select crear_link_pago('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', gen_random_uuid(), 'proforma',
  (select id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 2),
  'pref-pf-rech', 'https://mp/pf-rech', 59500);

-- 9) Rechazo de proforma SIN anticipo recibido: fluye (mismo comportamiento que 0016).
select lives_ok(
  $$select cambiar_estado_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 2),
    'rechazada', 'Sin acuerdo comercial')$$,
  'una proforma sin anticipo se rechaza sin bloqueo'
);

-- PF3: enviar + link (para el anticipo del botón manual).
select cambiar_estado_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 3), 'enviada');
select crear_link_pago('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', gen_random_uuid(), 'proforma',
  (select id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 3),
  'pref-pf-manual', 'https://mp/pf-manual', 71400);

-- El 105 baja a saldo 0 por una NC ANTES del webhook (carrera saldo-cambió): el link ya existía.
set local role postgres;
insert into public.documentos_venta (id, empresa_id, tipo, cliente_id, folio, estado, neto, exento, iva, total, documento_referencia_id, emitido_en)
values ('dddddddd-0000-0000-0000-0000000001c5', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'nota_credito', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 205, 'emitido', 50000, 0, 0, 50000, 'dddddddd-0000-0000-0000-000000000105', now());
reset role;

-- ===== Webhook (service_role): registrar dinero. p_link estable por preferencia_id
--       (tras el primer pago el link pasa a 'pagado', así que no se filtra por estado). =====
set local role service_role;

-- Pago del 103 dos veces con el MISMO mp_payment_id (dos webhooks del mismo payment).
select registrar_pago_mp('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'dddddddd-0000-0000-0000-000000000103',
  60000, 'mp-pay1', (select id from links_pago where preferencia_id = 'pref-pay1'));
select registrar_pago_mp('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'dddddddd-0000-0000-0000-000000000103',
  60000, 'mp-pay1', (select id from links_pago where preferencia_id = 'pref-pay1'));
-- Pago del 104 MAYOR al saldo (saldo 50000, pago 70000): pago por 50000 + excedente 20000.
select registrar_pago_mp('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'dddddddd-0000-0000-0000-000000000104',
  70000, 'mp-pay2', (select id from links_pago where preferencia_id = 'pref-pay2'));
-- Pago del 105 con saldo 0 (NC lo neteó): sin fila en pagos, todo a excedente 30000.
select registrar_pago_mp('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'dddddddd-0000-0000-0000-000000000105',
  30000, 'mp-pay3', (select id from links_pago where preferencia_id = 'pref-pay3'));

-- Anticipo de PF1 (se aplicará al facturar). Anticipo de PF2 RECHAZADA (el dinero se registra igual).
select registrar_anticipo_mp('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'proforma',
  (select id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1),
  119000, 'mp-ant-aplicar', (select id from links_pago where preferencia_id = 'pref-pf-aplicar'));
select registrar_anticipo_mp('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'proforma',
  (select id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 2),
  59500, 'mp-ant-rech', (select id from links_pago where preferencia_id = 'pref-pf-rech'));
-- Anticipo de PF3 dos veces con el mismo mp_payment_id (idempotencia): un solo anticipo.
select registrar_anticipo_mp('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'proforma',
  (select id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 3),
  71400, 'mp-ant-manual', (select id from links_pago where preferencia_id = 'pref-pf-manual'));
select registrar_anticipo_mp('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'proforma',
  (select id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 3),
  71400, 'mp-ant-manual', (select id from links_pago where preferencia_id = 'pref-pf-manual'));
reset role;

-- ===== Ana: los efectos del webhook cuadran a mano =====
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- 10) registrar_pago_mp feliz + IDEMPOTENTE: el saldo del 103 baja UNA vez a 40000
--     y existe un solo pago para 'mp-pay1' (el segundo webhook no duplicó nada).
select is(
  (select saldo from saldos_documentos where documento_id = 'dddddddd-0000-0000-0000-000000000103')::text
  || '/' ||
  (select count(*) from pagos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and mp_payment_id = 'mp-pay1')::text,
  '40000/1',
  'dos webhooks del mismo payment: el saldo baja una vez a 40000 y hay un solo pago'
);

-- 11) monto > saldo: el 104 queda en saldo 0 (pago por el saldo) y el excedente 20000 va a anticipos.
select is(
  (select saldo from saldos_documentos where documento_id = 'dddddddd-0000-0000-0000-000000000104')::text
  || '/' ||
  (select monto from anticipos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and origen_tipo = 'excedente' and origen_id = 'dddddddd-0000-0000-0000-000000000104')::text,
  '0/20000',
  'pago mayor al saldo: pago por el saldo y excedente como anticipo'
);

-- 12) saldo 0: sin pago (0 filas para 'mp-pay3') y TODO el monto (30000) va a excedente.
select is(
  (select count(*) from pagos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and mp_payment_id = 'mp-pay3')::text
  || '/' ||
  (select monto from anticipos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and origen_tipo = 'excedente' and origen_id = 'dddddddd-0000-0000-0000-000000000105')::text,
  '0/30000',
  'pago sobre saldo 0: ningún pago y todo el monto como excedente'
);

-- 13) ORIGEN RECHAZADO igual registra: PF2 está 'rechazada' y su anticipo quedó 'recibido'.
select is(
  (select estado from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 2)
  || '/' ||
  (select estado from anticipos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and mp_payment_id = 'mp-ant-rech'),
  'rechazada/recibido',
  'un anticipo se registra aunque el origen ya esté rechazado: el dinero jamás se pierde'
);

-- 14) registrar_anticipo_mp idempotente: dos webhooks del mismo payment → un solo anticipo.
select is(
  (select count(*) from anticipos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and mp_payment_id = 'mp-ant-manual'),
  1::bigint,
  'el mismo mp_payment_id no duplica el anticipo'
);

-- 15) Rechazo de PF1 (que tiene anticipo 'recibido') → BLOQUEADO con el mensaje exacto.
select throws_ok(
  $$select cambiar_estado_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1),
    'rechazada', 'Cliente se arrepintió')$$,
  'P0001', 'La proforma tiene un anticipo recibido; gestiona la devolución primero',
  'no se rechaza una proforma con un anticipo recibido encima'
);

-- Emisión simulada de PF1: aprobar → facturar → el service_role la deja 'emitido' con folio
-- (el hook aplicarAnticipoDocumento vive en la app, no en un trigger, así que aquí NO auto-aplica).
select cambiar_estado_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1), 'aprobada');
select facturar_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1));
set local role postgres;
update public.documentos_venta set tipo = 'factura', estado = 'emitido', folio = 110, emitido_en = now()
where id = (select documento_venta_id from public.proformas
            where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1);
reset role;

-- ===== aplicar_anticipo (service_role, el hook de emisión) =====
set local role service_role;
-- Aplica el anticipo de PF1 a su factura emitida; segunda llamada = doble aplicación (no-op);
-- tercera sobre DOC_LINK (sin anticipo asociado) = no-op.
select aplicar_anticipo('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select documento_venta_id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1));
select aplicar_anticipo('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select documento_venta_id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1));
select aplicar_anticipo('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'dddddddd-0000-0000-0000-000000000101');
reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- 16) aplicar_anticipo feliz: la factura de PF1 (total 119000) queda en saldo 0 y el anticipo 'aplicado'.
select is(
  (select saldo from saldos_documentos
   where documento_id = (select documento_venta_id from proformas
                         where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1))::text
  || '/' ||
  (select estado from anticipos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and mp_payment_id = 'mp-ant-aplicar'),
  '0/aplicado',
  'al facturar, el anticipo se aplica solo: saldo 0 y anticipo aplicado'
);

-- 17) Doble aplicación imposible: la segunda llamada NO creó un segundo pago (uno solo).
select is(
  (select count(*) from pagos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and mp_payment_id = 'mp-ant-aplicar'),
  1::bigint,
  'aplicar un anticipo ya aplicado no genera un segundo pago'
);

-- 18) Sin anticipo → no-op: DOC_LINK (factura sin anticipo asociado) sigue con su saldo intacto.
select is(
  (select saldo from saldos_documentos where documento_id = 'dddddddd-0000-0000-0000-000000000101'),
  100000,
  'aplicar_anticipo sobre un documento sin anticipo no altera su saldo'
);

-- ===== aplicar_anticipo_manual (Ana): el botón de /cobranza =====

-- 19) El anticipo de A1 no aplica a una factura de A2 (documento de otro cliente).
select throws_ok(
  $$select aplicar_anticipo_manual('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from anticipos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and mp_payment_id = 'mp-ant-manual'),
    'dddddddd-0000-0000-0000-000000000107')$$,
  'P0001', 'El documento no permite aplicar el anticipo',
  'un anticipo no se aplica a la factura de otro cliente'
);

-- SETUP: aplicar el anticipo manual a una factura del MISMO cliente (A1, saldo 71400).
select aplicar_anticipo_manual('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from anticipos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and mp_payment_id = 'mp-ant-manual'),
  'dddddddd-0000-0000-0000-000000000106');

-- 20) Aplicar dos veces el mismo anticipo → error (ya fue aplicado): prueba también el feliz previo.
select throws_ok(
  $$select aplicar_anticipo_manual('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from anticipos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and mp_payment_id = 'mp-ant-manual'),
    'dddddddd-0000-0000-0000-000000000106')$$,
  'P0001', 'El anticipo no existe o ya fue aplicado',
  'un anticipo ya aplicado no se vuelve a aplicar'
);

-- 21) Cross-tenant: Ana (no es miembro de B) pide un link sobre la empresa B → rol denegado.
select throws_ok(
  $$select crear_link_pago('eeeeeeee-0000-0000-0000-bbbbbbbbbbbb', gen_random_uuid(), 'factura',
    'dddddddd-0000-0000-0000-000000000107', 'pref-x', 'https://mp/x', 40000)$$,
  'P0001', 'Tu rol no permite generar links de pago',
  'un usuario no puede operar links sobre una empresa ajena'
);

-- 22) pagos.metodo acepta 'mercadopago' (CHECK + whitelist de registrar_pago re-creados en 0018).
select lives_ok(
  $$select registrar_pago('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-1111-0000-0000-aaaaaaaaaaaa',
    current_date, 'mercadopago', 40000, 'MP-REF', null,
    '[{"documentoId":"dddddddd-0000-0000-0000-000000000107","monto":40000}]'::jsonb)$$,
  'un pago manual con método mercadopago se registra'
);

-- 23) Escritura directa en links_pago denegada (toda escritura es por RPC/service_role).
select throws_ok(
  $$insert into links_pago (empresa_id, origen_tipo, origen_id, cliente_id, monto, preferencia_id, url)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'factura', 'dddddddd-0000-0000-0000-000000000101',
            'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 1000, 'pref-hack', 'https://mp/hack')$$,
  '42501', 'permission denied for table links_pago',
  'authenticated no puede insertar directamente en links_pago'
);

-- 24) Escritura directa en anticipos denegada (update sin grant).
select throws_ok(
  $$update anticipos set monto = 1 where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'$$,
  '42501', 'permission denied for table anticipos',
  'authenticated no puede editar directamente los anticipos'
);

-- 25-27) authenticated NO ejecuta las RPCs service_role del webhook/hook. Esas RPCs son
--        security definer SIN guardia de rol/tenant interna (confían en service_role): su
--        ÚNICO candado es el grant. Una regresión que agregue `grant execute ... to
--        authenticated` dejaría a cualquier usuario fabricar pagos/anticipos — el grant ES
--        el candado, y aquí se testea (siguen bajo la sesión authenticated de Ana).
select throws_ok(
  $$select registrar_pago_mp('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    'dddddddd-0000-0000-0000-000000000101', 100000, 'mp-hack', null)$$,
  '42501', 'permission denied for function registrar_pago_mp',
  'authenticated no puede ejecutar registrar_pago_mp (solo service_role)'
);
select throws_ok(
  $$select registrar_anticipo_mp('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'proforma',
    '00000000-0000-0000-0000-000000000000', 100000, 'mp-hack2', null)$$,
  '42501', 'permission denied for function registrar_anticipo_mp',
  'authenticated no puede ejecutar registrar_anticipo_mp (solo service_role)'
);
select throws_ok(
  $$select aplicar_anticipo('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    'dddddddd-0000-0000-0000-000000000101')$$,
  '42501', 'permission denied for function aplicar_anticipo',
  'authenticated no puede ejecutar aplicar_anticipo (solo service_role)'
);

-- 28) Aislamiento + select POSITIVO: Beto ve SOLO sus 2 filas sembradas (1 link + 1 anticipo);
--     las muchas filas de A son invisibles por RLS.
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
select is(
  (select count(*) from links_pago) + (select count(*) from anticipos),
  2::bigint,
  'Beto ve solo su link y su anticipo: aislamiento de las 2 tablas y select positivo de miembro'
);

-- 29) Anónimo denegado de plano.
set local request.jwt.claims to '{"role": "anon"}';
set local role anon;
select throws_ok(
  'select count(*) from links_pago',
  '42501', 'permission denied for table links_pago',
  'un anónimo no puede consultar links_pago'
);

select * from finish();
rollback;
