begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

-- ===== Fixtures (superuser: salta grants/RLS, patrón contabilidad) =====
-- Ana dueña, Ces CONTADOR y Vero VENDEDORA de la empresa A.
insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'ana@remu.cl'),
  ('00000000-0000-0000-0000-000000000000', '55555555-5555-5555-5555-555555555555', 'authenticated', 'authenticated', 'ces@remu.cl'),
  ('00000000-0000-0000-0000-000000000000', '77777777-7777-7777-7777-777777777777', 'authenticated', 'authenticated', 'vero@remu.cl');

-- RUT nuevo, único GLOBAL (módulo 11, cálculo en el plan): 769800018 no
-- aparece en ningún test, el seed ni los E2E (grep = 0).
insert into public.organizaciones (id, rut, razon_social)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '769800018', 'Org Remu');

insert into public.empresas (id, organizacion_id, rut, razon_social)
values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '769800018', 'Remu A');

insert into public.miembros (usuario_id, organizacion_id, rol)
values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'dueno'),
       ('55555555-5555-5555-5555-555555555555', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'contador'),
       ('77777777-7777-7777-7777-777777777777', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'vendedor');

-- Indicadores CANÓNICOS de '2026-06' (los MISMOS goldens del espejo TS).
-- UPSERT: la 0025 siembra '2026-06' con estos mismos valores; el test
-- fija los valores canónicos dentro de su transacción (rollback al final).
insert into public.indicadores_previsionales
  (periodo, uf, utm, ingreso_minimo, tope_imponible_uf, tope_cesantia_uf, tasas_afp, tramos_impuesto)
values
  ('2026-06', 39200, 69500, 529000, 87.8, 131.9,
   '{"capital":11.44,"cuprum":11.44,"habitat":11.27,"modelo":10.58,"planvital":11.10,"provida":11.45,"uno":10.49}'::jsonb,
   '[{"desde_utm":0,"hasta_utm":13.5,"factor":0,"rebaja_utm":0},
     {"desde_utm":13.5,"hasta_utm":30,"factor":0.04,"rebaja_utm":0.54},
     {"desde_utm":30,"hasta_utm":50,"factor":0.08,"rebaja_utm":1.74},
     {"desde_utm":50,"hasta_utm":70,"factor":0.135,"rebaja_utm":4.49},
     {"desde_utm":70,"hasta_utm":90,"factor":0.23,"rebaja_utm":11.14},
     {"desde_utm":90,"hasta_utm":120,"factor":0.304,"rebaja_utm":17.8},
     {"desde_utm":120,"hasta_utm":310,"factor":0.35,"rebaja_utm":23.32},
     {"desde_utm":310,"hasta_utm":null,"factor":0.4,"rebaja_utm":38.82}]'::jsonb)
on conflict (periodo) do update
  set uf = excluded.uf, utm = excluded.utm, ingreso_minimo = excluded.ingreso_minimo,
      tope_imponible_uf = excluded.tope_imponible_uf, tope_cesantia_uf = excluded.tope_cesantia_uf,
      tasas_afp = excluded.tasas_afp, tramos_impuesto = excluded.tramos_impuesto;

-- Blindaje del negativo "sin indicadores": '2031-01' jamás debe existir.
delete from public.indicadores_previsionales where periodo = '2031-01';

-- ===== Activación de contabilidad (Ana, dueña) — para la sección del asiento =====
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select activar_contabilidad('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa');

-- 1) La 0026 extendió el catálogo: 16 claves y las 3 anclas P18 de remuneraciones siguen siendo hojas.
select is(
  (select count(*) from cuentas_contables
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema is not null)::text
  || '/' ||
  (select count(*) from cuentas_contables
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and clave_sistema in ('gasto_remuneraciones', 'remuneraciones_por_pagar', 'retenciones_por_pagar')
     and acepta_movimientos)::text,
  '16/3',
  'activar siembra 16 claves de sistema; las 3 anclas P18 de remuneraciones son hojas'
);

-- ===== Trabajadores: escritura directa de la dueña (camino real, RLS por rol) =====
-- RUT de trabajadores nuevos, únicos GLOBALES (módulo 11, cálculo en el plan):
-- 157890123 / 165432096 / 178901230 / 189012349 — grep = 0 en tests, seed y E2E.
insert into public.trabajadores (empresa_id, rut, nombre)
values
  ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '157890123', 'Tomás Fonasa Habitat'),
  ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '165432096', 'Inés Isapre Capital'),
  ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '178901230', 'Mario Tope Modelo'),
  ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '189012349', 'Paula Tramo Habitat');

-- 2) La dueña inserta y ve sus 4 trabajadores (escritura dueno/admin del spec §2.1).
select is(
  (select count(*) from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'),
  4::bigint,
  'la dueña inserta trabajadores por escritura directa y los ve'
);

-- 3) RUT con DV malo: el CHECK (app.validar_rut) lo rechaza (convención maestros).
select throws_ok(
  $$insert into trabajadores (empresa_id, rut, nombre)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '157890124', 'DV Malo')$$,
  '23514',
  null,
  'un RUT de trabajador con DV incorrecto viola el check'
);

-- 4) El CONTADOR (Ces) lee pero NO escribe trabajadores (INSERT solo dueno/admin).
set local request.jwt.claims to '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated"}';
select throws_ok(
  $$insert into trabajadores (empresa_id, rut, nombre)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '191234561', 'Colado Contador')$$,
  '42501', 'new row violates row-level security policy for table "trabajadores"',
  'el contador no inserta trabajadores (escritura solo dueno/admin)'
);

-- ===== Candados de escritura directa (Ana, dueña: ni el rol máximo pasa) =====
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- 5) liquidaciones: CERO escritura directa (solo RPCs) — el grant ES el candado.
select throws_ok(
  $$insert into liquidaciones (empresa_id, trabajador_id, contrato_id, periodo)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', gen_random_uuid(), gen_random_uuid(), '2026-06')$$,
  '42501', 'permission denied for table liquidaciones',
  'ni la dueña inserta liquidaciones directamente (solo emitir_liquidacion)'
);

-- 6) indicadores_previsionales: escritura SOLO service_role (panel admin).
select throws_ok(
  $$update indicadores_previsionales set uf = 1 where periodo = '2026-06'$$,
  '42501', 'permission denied for table indicadores_previsionales',
  'authenticated no edita indicadores (escritura solo de la plataforma)'
);

-- ===== Contratos (Ana): T1/T2/T3 con contrato; Paula (T4) queda SIN contrato =====
-- SETUP (felices sin assert, patrón contabilidad: si fallaran, el archivo aborta).
insert into public.contratos (empresa_id, trabajador_id, tipo, fecha_inicio, cargo, sueldo_base, afp, salud)
values
  ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
   (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '157890123'),
   'indefinido', date '2026-01-01', 'Chofer', 800000, 'habitat', 'fonasa'),
  ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
   (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '178901230'),
   'indefinido', date '2026-01-01', 'Gerente', 4000000, 'modelo', 'fonasa');
-- Inés: plazo FIJO con Isapre (plan 5,0 UF > el 7% de su imponible).
insert into public.contratos (empresa_id, trabajador_id, tipo, fecha_inicio, fecha_termino, cargo, sueldo_base, afp, salud, plan_isapre_uf)
values
  ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
   (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '165432096'),
   'plazo_fijo', date '2026-01-01', date '2026-12-31', 'Analista', 1200000, 'capital', 'isapre', 5.0);

-- ===== emitir_liquidacion: negativos (cada uno con UNA sola condición que falla) =====

-- 7) Vendedor (Vero): el rol se chequea PRIMERO, ids ficticios igual dan el mensaje de rol.
set local request.jwt.claims to '{"sub": "77777777-7777-7777-7777-777777777777", "role": "authenticated"}';
select throws_ok(
  $$select emitir_liquidacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', gen_random_uuid(), '2026-06', 30, 0, 0)$$,
  'P0001', 'Tu rol no permite emitir liquidaciones',
  'el vendedor no emite liquidaciones'
);

set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- 8) Paula no tiene contrato vigente (período válido y con indicadores).
select throws_ok(
  $$select emitir_liquidacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '189012349'),
    '2026-06', 30, 0, 0)$$,
  'P0001', 'El trabajador no tiene contrato vigente',
  'sin contrato vigente no hay liquidación'
);

-- 9) Período bien formado pero SIN indicadores ('2031-01' jamás sembrado).
select throws_ok(
  $$select emitir_liquidacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '157890123'),
    '2031-01', 30, 0, 0)$$,
  'P0001', 'No hay indicadores previsionales para el período',
  'sin indicadores del período no hay liquidación'
);

-- 10) Período malformado: el formato se valida ANTES de buscar indicadores.
select throws_ok(
  $$select emitir_liquidacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '157890123'),
    '2026-13', 30, 0, 0)$$,
  'P0001', 'Período no válido',
  'un período malformado es rechazado con el mensaje del spec'
);

-- 11) Líquido negativo (Isapre cara con 1 día trabajado): prop 40.000, grat
--     10.000, imponible 50.000, afp 5.720, salud 196.000 (piso del plan 5,0 UF),
--     líquido −151.720 → guard fail-closed (un asiento descuadrado envenenaría
--     contabilizar_pendientes). Mensaje fijado por este plan.
select throws_ok(
  $$select emitir_liquidacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '165432096'),
    '2026-06', 1, 0, 0)$$,
  'P0001', 'El líquido no puede ser negativo: revisa los días trabajados y los descuentos',
  'una liquidación con líquido negativo es rechazada antes de insertarse'
);

-- ===== Goldens G1-G3 (Ana emite; aritmética a mano en el plan, espejo del TS) =====
-- SETUP (felices sin assert): los goldens 12-15 leen el snapshot persistido.
select emitir_liquidacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '157890123'),
  '2026-06', 30, 0, 50000);
select emitir_liquidacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '165432096'),
  '2026-06', 30, 0, 0);
select emitir_liquidacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '178901230'),
  '2026-06', 30, 0, 0);

-- 12) GOLDEN G1 (Fonasa indefinido habitat 800000 + 50000 no imponibles):
--     prop 800000; grat min(200000, 209396)=200000; imponible 1000000;
--     afp 11,27% = 112700; salud 7% = 70000; cesantía 0,6% = 6000;
--     base 811300 < 938250 (13,5 UTM) → impuesto 0; desc 188700;
--     líquido 1000000+50000-188700 = 861300.
select is(
  (select sueldo_proporcional || '/' || gratificacion || '/' || total_imponible || '/' || afp_monto
     || '/' || salud_monto || '/' || cesantia_monto || '/' || impuesto_unico
     || '/' || total_descuentos || '/' || liquido
   from liquidaciones
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '157890123')
     and periodo = '2026-06'),
  '800000/200000/1000000/112700/70000/6000/0/188700/861300',
  'G1: Fonasa indefinido habitat 800000 calza byte a byte con el cálculo a mano'
);

-- 13) G1 nace EMITIDA (sin borrador persistido) con el snapshot de contexto completo:
--     la liquidación se explica sola aunque cambien contrato o indicadores.
select is(
  (select estado || '/' || (emitida_en is not null)::text || '/' || sueldo_base || '/' || afp
     || '/' || tasa_afp || '/' || salud || '/' || uf || '/' || utm
   from liquidaciones
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '157890123')
     and periodo = '2026-06'),
  'emitida/true/800000/habitat/11.27/fonasa/39200/69500',
  'la liquidación nace emitida con emitida_en y el snapshot de contexto'
);

-- 14) GOLDEN G2 (Isapre plazo fijo capital 1200000, plan 5,0 UF):
--     grat topada 209396; imponible 1409396; afp 11,44% = round(161234,9024) = 161235;
--     salud max(round(98657,72)=98658, 5,0·39200=196000) = 196000; cesantía plazo fijo 0;
--     base 1052161 → tramo 4%: round(42086,44-37530) = 4556; desc 361791; líquido 1047605.
select is(
  (select sueldo_proporcional || '/' || gratificacion || '/' || total_imponible || '/' || afp_monto
     || '/' || salud_monto || '/' || cesantia_monto || '/' || impuesto_unico
     || '/' || total_descuentos || '/' || liquido
   from liquidaciones
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '165432096')
     and periodo = '2026-06'),
  '1200000/209396/1409396/161235/196000/0/4556/361791/1047605',
  'G2: Isapre plazo fijo con plan sobre el 7% y sin cesantía calza byte a byte'
);

-- 15) GOLDEN G3 (Fonasa indefinido modelo 4000000, sobre el tope imponible):
--     grat topada 209396; imponible min(4209396, 3441760) = 3441760;
--     afp 10,58% = round(364138,208) = 364138; salud round(240923,2) = 240923;
--     cesantía round(20650,56) = 20651; base 2816048 → tramo 8%:
--     round(225283,84-120930) = 104354; desc 730066; líquido 2711694.
select is(
  (select sueldo_proporcional || '/' || gratificacion || '/' || total_imponible || '/' || afp_monto
     || '/' || salud_monto || '/' || cesantia_monto || '/' || impuesto_unico
     || '/' || total_descuentos || '/' || liquido
   from liquidaciones
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '178901230')
     and periodo = '2026-06'),
  '4000000/209396/3441760/364138/240923/20651/104354/730066/2711694',
  'G3: sueldo sobre el tope imponible calza byte a byte (imponible topado en 87,8 UF)'
);

-- ===== G4: el CONTADOR emite (spec §4: dueno/admin/contador) =====
-- SETUP: Ana le crea el contrato a Paula (escritura sigue siendo dueno/admin).
insert into public.contratos (empresa_id, trabajador_id, tipo, fecha_inicio, cargo, sueldo_base, afp, salud)
values
  ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
   (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '189012349'),
   'indefinido', date '2026-01-01', 'Jefa de flota', 2500000, 'habitat', 'fonasa');

set local request.jwt.claims to '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated"}';
select emitir_liquidacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '189012349'),
  '2026-06', 30, 0, 0);

-- 16) GOLDEN G4 (Fonasa indefinido habitat 2500000, emitida por el CONTADOR):
--     grat topada 209396; imponible 2709396; afp 11,27% = round(305348,9292) = 305349;
--     salud round(189657,72) = 189658; cesantía round(16256,376) = 16256;
--     base 2198133 → tramo 8%: round(175850,64-120930) = 54921; desc 566184; líquido 2143212.
select is(
  (select sueldo_proporcional || '/' || gratificacion || '/' || total_imponible || '/' || afp_monto
     || '/' || salud_monto || '/' || cesantia_monto || '/' || impuesto_unico
     || '/' || total_descuentos || '/' || liquido
   from liquidaciones
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '189012349')
     and periodo = '2026-06'),
  '2500000/209396/2709396/305349/189658/16256/54921/566184/2143212',
  'G4: el contador SÍ emite y el tramo 2+ del impuesto calza byte a byte'
);

-- 17) Duplicada: Tomás ya tiene liquidación no-anulada de '2026-06' (unique parcial).
select throws_ok(
  $$select emitir_liquidacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '157890123'),
    '2026-06', 30, 0, 50000)$$,
  'P0001', 'Ya existe una liquidación de ese período',
  'no se emite dos veces el mismo período para el mismo trabajador'
);

-- 18) El CONTADOR (Ces) lee las 3 tablas (SELECT dueno/admin/contador).
select is(
  (select count(*) from trabajadores)::text || '/' ||
  (select count(*) from contratos)::text || '/' ||
  (select count(*) from liquidaciones)::text,
  '4/4/4',
  'el contador ve trabajadores, contratos y liquidaciones'
);

-- 19) El VENDEDOR (Vero) ve 0 filas en las 3 tablas (RLS por rol, dato sensible).
set local request.jwt.claims to '{"sub": "77777777-7777-7777-7777-777777777777", "role": "authenticated"}';
select is(
  (select count(*) from trabajadores) + (select count(*) from contratos) + (select count(*) from liquidaciones),
  0::bigint,
  'el vendedor no ve nada de remuneraciones (select restringido por rol)'
);

-- 20) Pero los indicadores son públicos: cualquier authenticated los lee.
select is(
  (select count(*) from indicadores_previsionales where periodo = '2026-06'),
  1::bigint,
  'el vendedor sí lee los indicadores previsionales (datos públicos)'
);

-- ===== pagar_liquidacion (Ana): emitida → pagada, y solo emitida =====
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- SETUP (feliz sin assert): pagar la liquidación de Inés (G2).
select pagar_liquidacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from liquidaciones
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '165432096')
     and periodo = '2026-06'));

-- 21) Quedó pagada con pagada_en.
select is(
  (select estado || '/' || (pagada_en is not null)::text
   from liquidaciones
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '165432096')
     and periodo = '2026-06'),
  'pagada/true',
  'pagar deja la liquidación pagada y registra pagada_en'
);

-- 22) Re-pagar una pagada: solo emitida se paga.
select throws_ok(
  $$select pagar_liquidacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from liquidaciones
     where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
       and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '165432096')
       and periodo = '2026-06'))$$,
  'P0001', 'Solo se puede pagar una liquidación emitida',
  'una liquidación pagada no se vuelve a pagar'
);

-- ===== anular_liquidacion (Ana): motivo obligatorio, anular y re-emitir =====

-- 23) Motivo vacío: rechazo byte-exacto.
select throws_ok(
  $$select anular_liquidacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from liquidaciones
     where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
       and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '157890123')
       and periodo = '2026-06'), '')$$,
  'P0001', 'Indica el motivo de la anulación',
  'anular sin motivo es rechazado'
);

-- SETUP (feliz sin assert): anular G1 con motivo.
select anular_liquidacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from liquidaciones
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '157890123')
     and periodo = '2026-06'),
  'Error en los días trabajados');

-- 24) Quedó anulada con motivo y anulada_en.
select is(
  (select estado || '/' || motivo_anulacion || '/' || (anulada_en is not null)::text
   from liquidaciones
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '157890123')
     and periodo = '2026-06'),
  'anulada/Error en los días trabajados/true',
  'anular deja la liquidación anulada con motivo y anulada_en'
);

-- 25) Re-emitir tras anular: el unique parcial ignora anuladas → conviven las dos filas.
select emitir_liquidacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '157890123'),
  '2026-06', 30, 0, 50000);
select is(
  (select string_agg(estado, ',' order by estado)
   from liquidaciones
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '157890123')
     and periodo = '2026-06'),
  'anulada,emitida',
  'tras anular se puede volver a emitir el mismo período'
);

-- 26) El AUDITOR (P17) ve las remuneraciones: la regla 1 de revision_periodo
--     (re-creada en 0025 con la rama de liquidaciones) cuenta las 4
--     emitidas/pagadas de junio sin asiento (G2, G3, G4 y la G1 re-emitida;
--     la anulada queda fuera) y el estado del período es crítico.
select is(
  (with rev as (
     select revision_periodo('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 2026, 6) as r)
   select (r ->> 'estado') || '/' || (
     select o ->> 'detalle'
     from jsonb_array_elements(r -> 'observaciones') as x(o)
     where o ->> 'regla' = 'documentos_sin_contabilizar')
   from rev),
  'critica/4 documentos del período sin asiento contable',
  'el auditor detecta liquidaciones sin contabilizar (regla 1 con la rama remuneracion)'
);

-- ===== Asiento contable (service_role, el hook): regla 'remuneracion' =====
set local role service_role;

-- SETUP (sin assert): contabilizar la G1 re-emitida.
select contabilizar_documento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'remuneracion',
  (select id from liquidaciones
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '157890123')
     and periodo = '2026-06' and estado = 'emitida'));

-- 27) GOLDEN líneas (P19: 5 líneas): Gasto remuneraciones (1050000) + Gasto leyes
--     sociales (aportes G1 = 15300+24000+9000 = 48300) al debe; Remuneraciones por
--     pagar (861300), Retenciones (188700) y Leyes sociales por pagar (48300) al
--     haber. Cuadra por construcción: 1050000+48300 = 861300+188700+48300 = 1098300.
select is(
  (select string_agg(c.clave_sistema || ':' || l.debe || ':' || l.haber, '|' order by c.clave_sistema)
   from asientos_lineas l
   join cuentas_contables c on c.empresa_id = l.empresa_id and c.id = l.cuenta_id
   where l.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and l.asiento_id = (select id from asientos
                         where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and origen = 'remuneracion'
                           and referencia_id = (select id from liquidaciones
                                                where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
                                                  and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '157890123')
                                                  and periodo = '2026-06' and estado = 'emitida'))),
  'gasto_leyes_sociales:48300:0|gasto_remuneraciones:1050000:0|leyes_sociales_por_pagar:0:48300|remuneraciones_por_pagar:0:861300|retenciones_por_pagar:0:188700',
  'el asiento de remuneración lleva las 5 líneas con los aportes del empleador y cuadra'
);

-- 28) La fecha es el ÚLTIMO día del mes del período (sin cierres: intacta) y el origen nuevo.
select is(
  (select a.fecha::text || '/' || a.origen
   from asientos a
   where a.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and a.origen = 'remuneracion'
     and a.referencia_id = (select id from liquidaciones
                            where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
                              and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '157890123')
                              and periodo = '2026-06' and estado = 'emitida')),
  '2026-06-30/remuneracion',
  'el asiento va al último día del mes del período con origen remuneracion'
);

-- 29) Liquidación ANULADA → noop, sin asiento (patrón P16).
select is(
  contabilizar_documento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'remuneracion',
    (select id from liquidaciones
     where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
       and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '157890123')
       and periodo = '2026-06' and estado = 'anulada'))
  || '/' ||
  (select count(*) from asientos
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and origen = 'remuneracion'
     and referencia_id = (select id from liquidaciones
                          where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
                            and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '157890123')
                            and periodo = '2026-06' and estado = 'anulada'))::text,
  'noop/0',
  'una liquidación anulada no genera asiento (noop)'
);

select * from finish();
rollback;
