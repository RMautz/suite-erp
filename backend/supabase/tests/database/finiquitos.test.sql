begin;
create extension if not exists pgtap with schema extensions;
select plan(36);

-- ===== Fixtures (superuser: salta grants/RLS, patrón contabilidad) =====
-- Ana dueña, Ces CONTADOR y Vero VENDEDORA de la empresa A.
insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'ana@finiq.cl'),
  ('00000000-0000-0000-0000-000000000000', '55555555-5555-5555-5555-555555555555', 'authenticated', 'authenticated', 'ces@finiq.cl'),
  ('00000000-0000-0000-0000-000000000000', '77777777-7777-7777-7777-777777777777', 'authenticated', 'authenticated', 'vero@finiq.cl');

-- RUT nuevo, único GLOBAL (módulo 11: cuerpo 76991001, DV 8): 769910018 no
-- aparece en ningún test, el seed ni los E2E (grep = 0).
insert into public.organizaciones (id, rut, razon_social)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '769910018', 'Org Finiquitos');

insert into public.empresas (id, organizacion_id, rut, razon_social)
values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '769910018', 'Finiquitos A');

insert into public.miembros (usuario_id, organizacion_id, rol)
values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'dueno'),
       ('55555555-5555-5555-5555-555555555555', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'contador'),
       ('77777777-7777-7777-7777-777777777777', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'vendedor');

-- Indicadores CANÓNICOS de '2026-07' (UF 39350: la de los goldens GF1-GF3 y
-- del espejo TS; el resto de campos no participa del finiquito pero mantiene
-- la forma canónica de la 0025/0026). UPSERT: si algún seed futuro siembra
-- '2026-07', el test fija los valores dentro de su transacción (rollback).
insert into public.indicadores_previsionales
  (periodo, uf, utm, ingreso_minimo, tope_imponible_uf, tope_cesantia_uf, tasa_sis, tasas_afp, tramos_impuesto)
values
  ('2026-07', 39350, 69500, 529000, 87.8, 131.9, 1.53,
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
      tasa_sis = excluded.tasa_sis, tasas_afp = excluded.tasas_afp, tramos_impuesto = excluded.tramos_impuesto;

-- Blindaje del negativo "sin indicadores": '2031-01' jamás debe existir.
delete from public.indicadores_previsionales where periodo = '2031-01';

-- Guard de fechas (assert 9): '2022-12' EXISTE (copia de la fila canónica de
-- '2026-07' — la 0025 solo siembra 2026-05/06/07) para que el término anterior
-- al primer contrato pase el chequeo de indicadores y muera EN el guard.
insert into public.indicadores_previsionales
  (periodo, uf, utm, ingreso_minimo, tope_imponible_uf, tope_cesantia_uf, tasa_sis, tasas_afp, tramos_impuesto)
select '2022-12', uf, utm, ingreso_minimo, tope_imponible_uf, tope_cesantia_uf, tasa_sis, tasas_afp, tramos_impuesto
from public.indicadores_previsionales
where periodo = '2026-07'
on conflict (periodo) do nothing;

-- ===== Activación de contabilidad (Ana, dueña) — para la sección del asiento =====
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select activar_contabilidad('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa');

-- 1) La 0027 volvió a extender el catálogo: 18 claves y las 2 anclas nuevas
--    (gasto_indemnizaciones grupo 5, finiquitos_por_pagar grupo 2) son hojas.
select is(
  (select count(*) from cuentas_contables
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema is not null)::text
  || '/' ||
  (select count(*) from cuentas_contables
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and clave_sistema in ('gasto_indemnizaciones', 'finiquitos_por_pagar')
     and acepta_movimientos)::text,
  '18/2',
  'activar siembra 18 claves de sistema; las 2 anclas de finiquitos son hojas'
);

-- ===== Trabajadores (Ana, camino real): la 0027 exige los 3 campos de nombre =====
-- RUT de trabajadores nuevos, únicos GLOBALES (módulo 11, DV en el plan):
-- 142356783 / 167890237 / 134567899 / 201234565 / 159876543 — grep = 0 en
-- tests, seed y E2E. Convención 0027: se escriben los 3 campos y nombre
-- compuesto (la Server Action compone; aquí se escribe la composición a mano).
insert into public.trabajadores (empresa_id, rut, nombre, nombres, apellido_paterno, apellido_materno)
values
  ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '142356783', 'Gabriel Fuentes Norambuena', 'Gabriel', 'Fuentes', 'Norambuena'),
  ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '167890237', 'Gloria Farías Bravo', 'Gloria', 'Farías', 'Bravo'),
  ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '134567899', 'Germán Figueroa Toledo', 'Germán', 'Figueroa', 'Toledo'),
  ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '201234565', 'Sara Contreras', 'Sara', 'Contreras', null),
  ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '159876543', 'Nicolás Osorio Pinto', 'Nicolás', 'Osorio', 'Pinto');

-- 2) La dueña inserta con los 3 campos (apellido_materno nullable) y los ve.
select is(
  (select count(*) from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'),
  5::bigint,
  'la dueña inserta trabajadores con nombres y apellidos separados y los ve'
);

-- 3) El DDL de la 0027 exige nombres y apellido_paterno: insertar solo el
--    display "nombre" (convención pre-P20) viola el not null. RUT válido y
--    nuevo (módulo 11: cuerpo 21345678, DV 4) que jamás persiste. El backfill
--    en sí lo smoke-testeó T1: aquí solo datos nuevos.
select throws_ok(
  $$insert into trabajadores (empresa_id, rut, nombre)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '213456784', 'Sin Apellidos Separados')$$,
  '23502',
  null,
  'un trabajador sin nombres/apellido_paterno viola el not null de la 0027'
);

-- ===== Contratos (Ana, escritura directa dueno/admin): W4 queda SIN contrato =====
-- SETUP (felices sin assert, patrón contabilidad: si fallaran, el archivo aborta).
-- Las fechas de inicio fijan los años de servicio y el devengo de los goldens.
insert into public.contratos (empresa_id, trabajador_id, tipo, fecha_inicio, cargo, sueldo_base, afp, salud)
values
  ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
   (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '142356783'),
   'indefinido', date '2023-01-15', 'Chofer', 800000, 'habitat', 'fonasa'),
  ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
   (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '167890237'),
   'indefinido', date '2025-03-01', 'Analista', 1200000, 'capital', 'fonasa'),
  ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
   (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '134567899'),
   'indefinido', date '2012-05-01', 'Gerente', 4000000, 'modelo', 'fonasa'),
  ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
   (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '159876543'),
   'indefinido', date '2026-01-01', 'Auxiliar', 500000, 'uno', 'fonasa');

-- ===== Vacaciones (Ana): INSERT y DELETE directo dueno/admin (precedente gastos_vehiculo) =====
-- SETUP: las tomas fijan el feriado de los goldens (W1 10, W3 200, W5 10);
-- la de W2 (5 días) es TEMPORAL: se borra en el assert 5 y GF2 queda con 0.
insert into public.vacaciones_tomadas (empresa_id, trabajador_id, desde, hasta, dias_habiles)
values
  ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
   (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '142356783'),
   date '2026-02-02', date '2026-02-13', 10),
  ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
   (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '134567899'),
   date '2020-01-06', date '2020-10-16', 200),
  ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
   (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '159876543'),
   date '2026-06-01', date '2026-06-12', 10),
  ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
   (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '167890237'),
   date '2026-04-06', date '2026-04-10', 5);

-- 4) La dueña registra las 4 tomas por escritura directa y las ve.
select is(
  (select count(*) from vacaciones_tomadas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'),
  4::bigint,
  'la dueña registra tomas de vacaciones por escritura directa y las ve'
);

-- 5) La dueña ELIMINA la toma de Gloria (DELETE directo del spec §2.3): GF2
--    queda con 0 días tomados, como exige su golden.
delete from public.vacaciones_tomadas
 where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
   and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '167890237');
select is(
  (select count(*) from vacaciones_tomadas
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '167890237')),
  0::bigint,
  'la dueña elimina una toma por DELETE directo y el saldo la deja de restar'
);

-- ===== emitir_finiquito: negativos (cada uno con UNA sola condición que falla) =====
-- Firma T2: 8 posicionales, el último es p_comentario (sin default) -> null.

-- 6) Vendedor (Vero): el rol se chequea PRIMERO, ids ficticios igual dan el mensaje de rol.
set local request.jwt.claims to '{"sub": "77777777-7777-7777-7777-777777777777", "role": "authenticated"}';
select throws_ok(
  $$select emitir_finiquito('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', gen_random_uuid(),
    'renuncia', date '2026-07-31', false, 0, 0, null)$$,
  'P0001', 'Tu rol no permite emitir finiquitos',
  'el vendedor no emite finiquitos'
);

set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- 7) Sara (W4) no tiene contrato vigente (mensaje P18 reutilizado).
select throws_ok(
  $$select emitir_finiquito('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '201234565'),
    'renuncia', date '2026-07-31', false, 0, 0, null)$$,
  'P0001', 'El trabajador no tiene contrato vigente',
  'sin contrato vigente no hay finiquito'
);

-- 8) Fecha de término en un período SIN indicadores ('2031-01' jamás sembrado):
--    el tope 90 UF exige la UF del período de término.
select throws_ok(
  $$select emitir_finiquito('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '134567899'),
    'necesidades_empresa', date '2031-01-15', true, 0, 0, null)$$,
  'P0001', 'No hay indicadores previsionales para el período',
  'sin indicadores del período de término no hay finiquito'
);

-- 9) Fecha de término ANTERIOR al primer contrato (Gabriel parte el
--    2023-01-15; '2022-12' SÍ tiene indicadores — fixture): guard byte-exacto.
--    Sin él, age() negativo envenenaría el snapshot (años negativos o aviso
--    pagado sin devengo).
select throws_ok(
  $$select emitir_finiquito('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '142356783'),
    'renuncia', date '2022-12-31', false, 0, 0, null)$$,
  'P0001', 'La fecha de término no puede ser anterior al inicio del primer contrato',
  'una fecha de término anterior al primer contrato es rechazada'
);

-- 10) Total negativo (Gloria, renuncia: feriado 800000 − descuentos 1000000 =
--    −200000): guard fail-closed ANTES de insertar (un total negativo
--    envenenaría el asiento). No persiste nada: GF2 se emite después.
select throws_ok(
  $$select emitir_finiquito('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '167890237'),
    'renuncia', date '2026-07-31', false, 0, 1000000, null)$$,
  'P0001', 'El total del finiquito no puede ser negativo: revisa los descuentos',
  'un finiquito con total negativo es rechazado antes de insertarse'
);

-- ===== Goldens GF1-GF3 y W5 (tabla de Global Constraints, espejo del TS) =====

-- SETUP (feliz sin assert): Ana emite GF1 (Gabriel, necesidades sin aviso).
select emitir_finiquito('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '142356783'),
  'necesidades_empresa', date '2026-07-31', false, 0, 0, null);

-- 11) GOLDEN GF1 (necesidades_empresa SIN aviso, 800000, 2023-01-15 → 2026-07-31,
--     10 tomados): age = 3a 6m 16d → fracción m=6 con d>0 SUPERA → 4 años;
--     base min(800000, 3541500) = 800000; indem_años 800000×4 = 3200000;
--     aviso no dado → 800000; devengo 42 meses × 1.25 = 52.50 − 10 = 42.50;
--     feriado round(800000×42.5/30) = 1133333;
--     total 3200000+800000+1133333 = 5133333. UF snapshoteada 39350.
select is(
  (select causal || '/' || anos_servicio || '/' || sueldo_base || '/' || indemnizacion_anos
     || '/' || indemnizacion_aviso || '/' || feriado_dias || '/' || feriado_monto
     || '/' || total || '/' || uf
   from finiquitos
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '142356783')),
  'necesidades_empresa/4/800000/3200000/800000/42.50/1133333/5133333/39350',
  'GF1: necesidades sin aviso calza byte a byte con el cálculo a mano'
);

-- 12) Efectos atómicos de emitir: nace emitido con emitido_en, el contrato del
--     snapshot queda vigente=false y Gabriel activo=false.
select is(
  (select f.estado || '/' || (f.emitido_en is not null)::text || '/' || c.vigente || '/' || t.activo
   from finiquitos f
   join contratos c on c.empresa_id = f.empresa_id and c.id = f.contrato_id
   join trabajadores t on t.empresa_id = f.empresa_id and t.id = f.trabajador_id
   where f.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and f.trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '142356783')),
  'emitido/true/false/false',
  'emitir deja el finiquito emitido, cierra el contrato y desactiva al trabajador'
);

-- SETUP (feliz sin assert): el CONTADOR (Ces) emite GF2 (spec §3: dueno/admin/contador).
set local request.jwt.claims to '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated"}';
select emitir_finiquito('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '167890237'),
  'renuncia', date '2026-07-31', false, 0, 0, null);

-- 13) GOLDEN GF2 (renuncia, 1200000, 2025-03-01 → 2026-07-31, 0 tomados,
--     emitido por el CONTADOR): age = 1a 4m 30d → fracción ≤ 6 meses → 1;
--     indemnizaciones 0 (renuncia); devengo 16 × 1.25 = 20.00; feriado
--     round(1200000×20/30) = 800000 = total.
select is(
  (select causal || '/' || anos_servicio || '/' || sueldo_base || '/' || indemnizacion_anos
     || '/' || indemnizacion_aviso || '/' || feriado_dias || '/' || feriado_monto || '/' || total
   from finiquitos
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '167890237')),
  'renuncia/1/1200000/0/0/20.00/800000/800000',
  'GF2: la renuncia solo paga el feriado proporcional y el contador SÍ emite'
);

-- SETUP (felices sin assert): Ana emite GF3 y el finiquito total-0 de Nicolás.
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select emitir_finiquito('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '134567899'),
  'necesidades_empresa', date '2026-07-31', true, 0, 0, null);
select emitir_finiquito('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '159876543'),
  'renuncia', date '2026-07-31', false, 0, 0, null);

-- 14) GOLDEN GF3 (necesidades CON aviso, 4000000, 2012-05-01 → 2026-07-31,
--     200 tomados): age = 14a 2m 30d → 14 → TOPE 11; base min(4000000,
--     round(90×39350) = 3541500) = 3541500 (TOPE 90 UF muerde); indem_años
--     3541500×11 = 38956500; aviso dado → 0; devengo 170 × 1.25 = 212.50 −
--     200 = 12.50; feriado round(4000000×12.5/30) = 1666667 (sobre el sueldo
--     SIN tope, spec §3.5); total 38956500+1666667 = 40623167.
select is(
  (select causal || '/' || anos_servicio || '/' || sueldo_base || '/' || indemnizacion_anos
     || '/' || indemnizacion_aviso || '/' || feriado_dias || '/' || feriado_monto || '/' || total
   from finiquitos
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '134567899')),
  'necesidades_empresa/11/4000000/38956500/0/12.50/1666667/40623167',
  'GF3: tope 11 años y tope 90 UF calzan byte a byte con el cálculo a mano'
);

-- 15) GOLDEN W5 (renuncia, 500000, 2026-01-01 → 2026-07-31, 10 tomados):
--     age = 0a 6m 30d → fracción m=6 con d>0 → 1 año; devengo 6 × 1.25 =
--     7.50 − 10 = −2.50 → feriado_dias = max(saldo, 0) = 0.00; total 0 (el
--     noop contable del assert 33 usa este finiquito).
select is(
  (select anos_servicio || '/' || indemnizacion_anos || '/' || indemnizacion_aviso
     || '/' || feriado_dias || '/' || feriado_monto || '/' || total
   from finiquitos
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '159876543')),
  '1/0/0/0.00/0/0',
  'con saldo negativo el feriado se clampea en 0 y el total queda en 0'
);

-- ===== Duplicado (simulación superuser DECLARADA, patrón catch-up P19) =====
-- Tras emitir, el contrato queda vigente=false y un segundo emitir moriría
-- antes con 'El trabajador no tiene contrato vigente'. La rama del duplicado
-- protege el estado inconsistente (contrato reabierto a mano con el finiquito
-- vivo): se simula como superusuario y se revierte al tiro.
reset role;
update public.contratos set vigente = true
 where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
   and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '142356783');
update public.trabajadores set activo = true
 where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '142356783';
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- 16) Con el contrato vigente de nuevo y el finiquito emitido vivo: duplicado.
select throws_ok(
  $$select emitir_finiquito('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '142356783'),
    'necesidades_empresa', date '2026-07-31', false, 0, 0, null)$$,
  'P0001', 'Ya existe un finiquito para este contrato',
  'no se emite un segundo finiquito para el mismo contrato'
);

-- SETUP: deshacer la simulación (el mundo vuelve al estado post-emisión real).
reset role;
update public.contratos set vigente = false
 where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
   and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '142356783');
update public.trabajadores set activo = false
 where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '142356783';
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- ===== pagar_finiquito (Ana): emitido → pagado, y solo emitido =====

-- SETUP (feliz sin assert): pagar el finiquito de Gabriel (GF1).
select pagar_finiquito('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from finiquitos
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '142356783')));

-- 17) Quedó pagado con pagado_en.
select is(
  (select estado || '/' || (pagado_en is not null)::text
   from finiquitos
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '142356783')),
  'pagado/true',
  'pagar deja el finiquito pagado y registra pagado_en'
);

-- 18) Re-pagar un pagado: solo emitido se paga.
select throws_ok(
  $$select pagar_finiquito('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from finiquitos
     where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
       and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '142356783')))$$,
  'P0001', 'Solo se puede pagar un finiquito emitido',
  'un finiquito pagado no se vuelve a pagar'
);

-- ===== anular_finiquito (Ana): motivo, otro-contrato-vigente y reactivación =====

-- 19) Motivo vacío: rechazo byte-exacto.
select throws_ok(
  $$select anular_finiquito('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from finiquitos
     where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
       and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '142356783')), '')$$,
  'P0001', 'Indica el motivo de la anulación',
  'anular sin motivo es rechazado'
);

-- SETUP: Ana RECONTRATA a Gabriel (contrato nuevo vigente, escritura directa
-- dueno/admin) — anular ya no puede reactivar el contrato viejo.
insert into public.contratos (empresa_id, trabajador_id, tipo, fecha_inicio, cargo, sueldo_base, afp, salud)
values
  ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
   (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '142356783'),
   'indefinido', date '2026-08-01', 'Chofer recontratado', 900000, 'habitat', 'fonasa');

-- 20) Con OTRO contrato vigente entremedio, anular es rechazado (la
--     reactivación chocaría con el unique parcial de contratos vigentes).
select throws_ok(
  $$select anular_finiquito('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from finiquitos
     where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
       and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '142356783')),
    'Error en la causal')$$,
  'P0001', 'El trabajador ya tiene otro contrato vigente',
  'anular con otro contrato vigente entremedio es rechazado'
);

-- SETUP (superuser: deshace la recontratación; no hay DELETE de contratos
-- para authenticated) y Ana anula con motivo — ahora sí procede.
reset role;
delete from public.contratos
 where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
   and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '142356783')
   and fecha_inicio = date '2026-08-01';
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select anular_finiquito('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from finiquitos
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '142356783')),
  'Error en la causal');

-- 21) Quedó anulado (desde PAGADO: spec §3, emitido o pagado se anulan) con
--     motivo y anulado_en.
select is(
  (select estado || '/' || motivo_anulacion || '/' || (anulado_en is not null)::text
   from finiquitos
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '142356783')),
  'anulado/Error en la causal/true',
  'anular deja el finiquito anulado con motivo y anulado_en'
);

-- 22) Anular REACTIVA: el contrato del finiquito vuelve a vigente=true y
--     Gabriel a activo=true.
select is(
  (select c.vigente::text || '/' || t.activo::text
   from finiquitos f
   join contratos c on c.empresa_id = f.empresa_id and c.id = f.contrato_id
   join trabajadores t on t.empresa_id = f.empresa_id and t.id = f.trabajador_id
   where f.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and f.trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '142356783')),
  'true/true',
  'anular reactiva el contrato y al trabajador'
);

-- 23) Re-anular el YA anulado: el candado de estado se dispara (solo emitido
--     o pagado son anulables) — único camino al mensaje en toda la suite.
select throws_ok(
  $$select anular_finiquito('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from finiquitos
     where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
       and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '142356783')),
    'Segundo intento')$$,
  'P0001', 'Solo se puede anular un finiquito emitido o pagado',
  'un finiquito ya anulado no se vuelve a anular'
);

-- 24) Re-emitir tras anular: el unique parcial ignora anulados → conviven. La
--     re-emisión usa la causal vencimiento_plazo — el MISMO setup alimenta el
--     golden VP del assert 25 (dos pájaros de un tiro).
select emitir_finiquito('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '142356783'),
  'vencimiento_plazo', date '2026-07-31', false, 0, 0, null);
select is(
  (select string_agg(estado, ',' order by estado)
   from finiquitos
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '142356783')),
  'anulado,emitido',
  'tras anular se puede volver a emitir el finiquito del mismo contrato'
);

-- 25) GOLDEN VP (vencimiento_plazo, mismos insumos de GF1: 800000, 2023-01-15
--     → 2026-07-31, 10 tomados — tabla de Global Constraints y espejo del unit
--     de T4): CERO indemnizaciones (ni años ni aviso), solo el feriado —
--     42.50 días → 1133333 = total. El snapshot igual guarda los 4 años.
select is(
  (select causal || '/' || anos_servicio || '/' || indemnizacion_anos
     || '/' || indemnizacion_aviso || '/' || feriado_dias || '/' || feriado_monto || '/' || total
   from finiquitos
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and estado = 'emitido'
     and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '142356783')),
  'vencimiento_plazo/4/0/0/42.50/1133333/1133333',
  'GOLDEN VP: vencimiento_plazo no paga indemnizaciones — solo el feriado proporcional'
);

-- ===== RLS por rol =====

-- 26) El CONTADOR (Ces) lee finiquitos y vacaciones (SELECT dueno/admin/contador):
--     5 finiquitos (Gabriel ×2 — anulado + vencimiento_plazo —, Gloria, Germán,
--     Nicolás) y 3 tomas vivas.
set local request.jwt.claims to '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated"}';
select is(
  (select count(*) from finiquitos)::text || '/' || (select count(*) from vacaciones_tomadas)::text,
  '5/3',
  'el contador ve finiquitos y vacaciones tomadas'
);

-- 27) El VENDEDOR (Vero) ve 0 filas en ambas tablas (dato sensible).
set local request.jwt.claims to '{"sub": "77777777-7777-7777-7777-777777777777", "role": "authenticated"}';
select is(
  (select count(*) from finiquitos) + (select count(*) from vacaciones_tomadas),
  0::bigint,
  'el vendedor no ve finiquitos ni vacaciones (select restringido por rol)'
);

-- 28) El vendedor tampoco inserta vacaciones (INSERT solo dueno/admin).
select throws_ok(
  $$insert into vacaciones_tomadas (empresa_id, trabajador_id, desde, hasta, dias_habiles)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', gen_random_uuid(), date '2026-05-04', date '2026-05-08', 5)$$,
  '42501', 'new row violates row-level security policy for table "vacaciones_tomadas"',
  'el vendedor no registra vacaciones (escritura solo dueno/admin)'
);

-- SETUP: el DELETE de Vero como sentencia SUELTA — un CTE modificador dentro
-- del subquery escalar de is() daría 0A000 y abortaría el archivo (dictamen
-- de los lentes). El grant de delete EXISTE: la policy filtra por rol y borra
-- 0 filas SIN error (precedente combustible.test.sql, delete de la vendedora).
delete from vacaciones_tomadas
where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa';

-- 29) Las 3 tomas siguen vivas — se cuenta con los claims de Ana (Vero vería
--     0 por RLS aunque existieran): el delete del vendedor afectó 0 filas.
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select is(
  (select count(*) from vacaciones_tomadas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'),
  3::bigint,
  'el delete del vendedor sobre vacaciones borra 0 filas: las 3 tomas siguen vivas'
);

-- 30) finiquitos: CERO escritura directa (solo RPCs) — el grant ES el candado,
--     ni el rol máximo pasa (los claims de Ana ya están activos).
select throws_ok(
  $$insert into finiquitos (empresa_id, trabajador_id, contrato_id, causal, fecha_termino)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', gen_random_uuid(), gen_random_uuid(), 'renuncia', date '2026-07-31')$$,
  '42501', 'permission denied for table finiquitos',
  'ni la dueña inserta finiquitos directamente (solo emitir_finiquito)'
);

-- ===== Asiento contable (service_role, el hook): regla 'finiquito' =====
set local role service_role;

-- SETUP (sin assert): contabilizar GF2 (Gloria, total 800000).
select contabilizar_documento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'finiquito',
  (select id from finiquitos
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '167890237')));

-- 31) GOLDEN líneas: 2 líneas por el TOTAL neto — debe gasto_indemnizaciones
--     800000, haber finiquitos_por_pagar 800000. Cuadra por construcción.
select is(
  (select string_agg(c.clave_sistema || ':' || l.debe || ':' || l.haber, '|' order by c.clave_sistema)
   from asientos_lineas l
   join cuentas_contables c on c.empresa_id = l.empresa_id and c.id = l.cuenta_id
   where l.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and l.asiento_id = (select id from asientos
                         where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and origen = 'finiquito'
                           and referencia_id = (select id from finiquitos
                                                where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
                                                  and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '167890237')))),
  'finiquitos_por_pagar:0:800000|gasto_indemnizaciones:800000:0',
  'el asiento del finiquito lleva 2 líneas por el total y cuadra'
);

-- 32) La fecha es la de término (vía app._fecha_contable; sin cierres: intacta)
--     y el origen nuevo del CHECK.
select is(
  (select a.fecha::text || '/' || a.origen
   from asientos a
   where a.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and a.origen = 'finiquito'
     and a.referencia_id = (select id from finiquitos
                            where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
                              and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '167890237'))),
  '2026-07-31/finiquito',
  'el asiento va a la fecha de término con origen finiquito'
);

-- 33) Total 0 (Nicolás) → noop, sin asiento (jamás un asiento vacío).
select is(
  contabilizar_documento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'finiquito',
    (select id from finiquitos
     where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
       and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '159876543')))
  || '/' ||
  (select count(*) from asientos
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and origen = 'finiquito'
     and referencia_id = (select id from finiquitos
                          where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
                            and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '159876543')))::text,
  'noop/0',
  'un finiquito con total 0 no genera asiento (noop)'
);

-- 34) Finiquito ANULADO (el primero de Gabriel) → noop, sin asiento (patrón P16).
select is(
  contabilizar_documento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'finiquito',
    (select id from finiquitos
     where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
       and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '142356783')
       and estado = 'anulado'))
  || '/' ||
  (select count(*) from asientos
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and origen = 'finiquito'
     and referencia_id = (select id from finiquitos
                          where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
                            and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '142356783')
                            and estado = 'anulado'))::text,
  'noop/0',
  'un finiquito anulado no genera asiento (noop)'
);

-- ===== Backfill de apellidos de la 0027 (portado del smoke de T1: la única
-- verificación PERMANENTE — el smoke no se comitea) =====
-- Se re-ejecuta el UPDATE EXACTO de la migración sobre 2 filas legacy (3 y 2
-- palabras) con el not null suspendido DENTRO de la transacción (rollback al
-- final). El set not null de vuelta prueba además que el backfill dejó cero
-- nulls. Sobre las filas ya pobladas el UPDATE es idempotente (la partición
-- de la heurística coincide con lo escrito a mano en los fixtures). RUTs
-- módulo 11 válidos del smoke (cuerpo 11111111 DV 1 / cuerpo 22222222 DV 2)
-- que viven SOLO dentro de esta transacción.
reset role;
alter table public.trabajadores
  alter column nombres drop not null,
  alter column apellido_paterno drop not null;
insert into public.trabajadores (id, empresa_id, rut, nombre) values
  ('10000000-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '111111111', 'Pedro Soto Rivas'),
  ('10000000-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '222222222', 'Ana Vergara');
update public.trabajadores t
set nombres = case when array_length(p.partes, 1) >= 3
                   then array_to_string(p.partes[1:array_length(p.partes, 1) - 2], ' ')
                   else p.partes[1] end,
    apellido_paterno = case when array_length(p.partes, 1) >= 3 then p.partes[array_length(p.partes, 1) - 1]
                            when array_length(p.partes, 1) = 2 then p.partes[2]
                            else '' end,
    apellido_materno = case when array_length(p.partes, 1) >= 3 then p.partes[array_length(p.partes, 1)]
                            else null end
from (select id, regexp_split_to_array(trim(nombre), '\s+') as partes from public.trabajadores) p
where p.id = t.id;
alter table public.trabajadores
  alter column nombres set not null,
  alter column apellido_paterno set not null;

-- 35) Partición de 3 palabras: 1 nombre + las últimas 2 como apellidos.
select is(
  (select nombres || '/' || apellido_paterno || '/' || apellido_materno
   from trabajadores
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '111111111'),
  'Pedro/Soto/Rivas',
  'backfill 0027: con 3 palabras las últimas 2 son los apellidos'
);

-- 36) Partición de 2 palabras: 1 nombre + 1 paterno, materno null.
select is(
  (select nombres || '/' || apellido_paterno || '/' || coalesce(apellido_materno, '(null)')
   from trabajadores
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '222222222'),
  'Ana/Vergara/(null)',
  'backfill 0027: con 2 palabras el materno queda null'
);

-- Limpieza de las filas legacy (el rollback final igual lo deshace todo).
delete from public.trabajadores
where id in ('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002');

select * from finish();
rollback;
