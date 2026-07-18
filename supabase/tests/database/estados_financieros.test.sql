begin;
create extension if not exists pgtap with schema extensions;
select plan(36);

-- ===== Fixtures (superuser: salta grants/RLS, patrón contabilidad) =====
-- Ana dueña, Ces CONTADOR y Vero VENDEDORA de la empresa A.
insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'ana@cierre.cl'),
  ('00000000-0000-0000-0000-000000000000', '55555555-5555-5555-5555-555555555555', 'authenticated', 'authenticated', 'ces@cierre.cl'),
  ('00000000-0000-0000-0000-000000000000', '77777777-7777-7777-7777-777777777777', 'authenticated', 'authenticated', 'vero@cierre.cl');

-- RUT nuevos, únicos GLOBALES (módulo 11, cálculo en el plan): 769710019 y
-- 769710027 no aparecen en ningún test, el seed ni los E2E (grep = 0).
insert into public.organizaciones (id, rut, razon_social)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '769710019', 'Org Cierre');

insert into public.empresas (id, organizacion_id, rut, razon_social)
values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '769710019', 'Cierre A');

insert into public.miembros (usuario_id, organizacion_id, rol)
values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'dueno'),
       ('55555555-5555-5555-5555-555555555555', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'contador'),
       ('77777777-7777-7777-7777-777777777777', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'vendedor');

insert into public.clientes (id, empresa_id, rut, razon_social)
values ('cccccccc-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '769710027', 'Cliente Cierre');

-- Documentos por insert DIRECTO (respetan el CHECK total = neto+exento+iva):
-- a1: factura ene-2026 que NUNCA se contabiliza (reglas 1 y 2 de revisión);
-- a2: factura nov-2025 que se contabiliza DESPUÉS de cerrar 2025 (clamp + regla 6);
--     además es la vencida-sin-recordatorio de la regla 3 (vence al emitirse:
--     condicion_pago_dias default 0) y el 1er mes del promedio de la regla 4;
-- a3: factura dic-2025 que NUNCA se contabiliza: 2° mes del promedio de la
--     regla 4 (nov+dic promedian 59500; enero 119000 rompe la banda 140%).
insert into public.documentos_venta (id, empresa_id, tipo, cliente_id, folio, estado, neto, exento, iva, total, emitido_en)
values
  ('dddddddd-0000-0000-0000-0000000000a1', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'factura', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 2001, 'emitido', 100000, 0, 19000, 119000, timestamptz '2026-01-20 12:00:00+00'),
  ('dddddddd-0000-0000-0000-0000000000a2', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'factura', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 2002, 'emitido', 50000, 0, 9500, 59500, timestamptz '2025-11-15 12:00:00+00'),
  ('dddddddd-0000-0000-0000-0000000000a3', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'factura', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 2003, 'emitido', 50000, 0, 9500, 59500, timestamptz '2025-12-10 12:00:00+00');

-- Regla 3 dirigida: recordatorio RECIENTE (creado_en default now(), siempre
-- dentro de la ventana de 30 días) para a1 y a3 → quedan suprimidas; a2 queda
-- SIN recordatorio y es la única que debe disparar la regla.
insert into public.correos_enviados (empresa_id, tipo, referencia_id, para, asunto, proveedor_id)
values
  ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'recordatorio', 'dddddddd-0000-0000-0000-0000000000a1', 'cobranza@cierre.cl', 'Recordatorio factura 2001', 'mock-rec-a1'),
  ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'recordatorio', 'dddddddd-0000-0000-0000-0000000000a3', 'cobranza@cierre.cl', 'Recordatorio factura 2003', 'mock-rec-a3');

-- Regla 5 dirigida: anticipo 'recibido' (default) hace más de 60 días.
-- mp_payment_id NULL a propósito: así NO entra a la regla 1 ni a pendientes.
insert into public.anticipos (id, empresa_id, cliente_id, origen_tipo, origen_id, monto, recibido_en)
values ('ffffffff-0000-0000-0000-0000000000a5', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 'cotizacion', gen_random_uuid(), 80000, timestamptz '2025-10-01 12:00:00+00');

-- ===== Activación (Ana, dueña) =====
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select activar_contabilidad('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa');

-- 1) La 0024 extendió el catálogo: 11 claves y utilidad_ejercicio es hoja de patrimonio.
select is(
  (select count(*) from cuentas_contables
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema is not null)::text
  || '/' ||
  (select tipo || ':' || acepta_movimientos from cuentas_contables
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema = 'utilidad_ejercicio'),
  '11/patrimonio:true',
  'activar siembra 11 claves de sistema; utilidad_ejercicio es hoja de patrimonio'
);

-- ===== Fixtures de movimientos (Ces, contador): 2024 y 2025 =====
-- SETUP (felices sin assert, patrón contabilidad: si fallaran, el archivo aborta).
set local request.jwt.claims to '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated"}';
-- 2024: una venta de 40000 (utilidad 2024 = 40000; da movimientos al orden de cierre).
select crear_asiento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', date '2024-06-15', 'Venta 2024', jsonb_build_array(
  jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema = 'banco'), 'debe', 40000, 'haber', 0),
  jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema = 'ventas'), 'debe', 0, 'haber', 40000)));
-- 2025: ingreso 100000 y gasto 30000 (utilidad 2025 = 70000).
select crear_asiento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', date '2025-03-10', 'Venta 2025', jsonb_build_array(
  jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema = 'banco'), 'debe', 100000, 'haber', 0),
  jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema = 'ventas'), 'debe', 0, 'haber', 100000)));
select crear_asiento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', date '2025-04-20', 'Gasto 2025', jsonb_build_array(
  jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema = 'compras_gastos'), 'debe', 30000, 'haber', 0),
  jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema = 'banco'), 'debe', 0, 'haber', 30000)));

-- ===== cerrar_ejercicio: negativos =====

-- 2) Vendedor (Vero): el rol se chequea PRIMERO.
set local request.jwt.claims to '{"sub": "77777777-7777-7777-7777-777777777777", "role": "authenticated"}';
select throws_ok(
  $$select cerrar_ejercicio('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 2024)$$,
  'P0001', 'Tu rol no permite cerrar el ejercicio',
  'el vendedor no puede cerrar el ejercicio'
);

-- 3) El año en curso no es un ejercicio terminado (dinámico: válido en cualquier año).
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select throws_ok(
  $$select cerrar_ejercicio('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', extract(year from current_date)::integer)$$,
  'P0001', 'Solo se puede cerrar un ejercicio terminado',
  'el año en curso no se puede cerrar'
);

-- 4) Cierre en orden: 2024 tiene movimientos y sigue abierto.
select throws_ok(
  $$select cerrar_ejercicio('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 2025)$$,
  'P0001', 'Cierra primero el ejercicio 2024',
  'no se cierra 2025 con 2024 abierto y con movimientos'
);

-- 5) Año sin movimientos de resultado (2023): noop → null.
select ok(
  (select cerrar_ejercicio('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 2023)) is null,
  'cerrar un año sin movimientos de resultado es noop: retorna null'
);

-- 6) El noop no deja rastro: ni fila de cierre ni asiento.
select is(
  (select count(*) from cierres_ejercicio where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and anio = 2023)
  + (select count(*) from asientos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and origen = 'cierre' and extract(year from fecha) = 2023),
  0::bigint,
  'el noop no crea fila en cierres_ejercicio ni asiento de cierre'
);

-- ===== cerrar_ejercicio: felices =====

-- 7) El CONTADOR (Ces) SÍ puede cerrar: cierra 2024.
set local request.jwt.claims to '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated"}';
select ok(
  (select cerrar_ejercicio('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 2024)) is not null,
  'el contador puede cerrar el ejercicio (retorna el asiento de cierre)'
);

-- SETUP (feliz sin assert): Ana cierra 2025. Los goldens 8-11 son el assert real.
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select cerrar_ejercicio('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 2025);

-- 8) GOLDEN líneas del cierre 2025: ventas al debe (100000), compras_gastos al haber
--    (30000) y la contrapartida única a utilidad_ejercicio al haber (70000). Cuadrado.
select is(
  (select string_agg(c.clave_sistema || ':' || l.debe || ':' || l.haber, '|' order by c.clave_sistema)
   from asientos_lineas l
   join cuentas_contables c on c.empresa_id = l.empresa_id and c.id = l.cuenta_id
   where l.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and l.asiento_id = (select id from asientos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and origen = 'cierre' and fecha = date '2025-12-31')),
  'compras_gastos:0:30000|utilidad_ejercicio:0:70000|ventas:100000:0',
  'el cierre deja cada cuenta de resultado en 0 contra utilidad_ejercicio (utilidad 70000 al haber)'
);

-- 9) El asiento de cierre va al 31-dic con origen y glosa contractuales.
select is(
  (select a.fecha::text || '/' || a.origen || '/' || a.glosa
   from asientos a
   where a.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and a.origen = 'cierre' and a.fecha = date '2025-12-31'),
  '2025-12-31/cierre/Cierre del ejercicio 2025',
  'el asiento de cierre lleva fecha 31-dic, origen cierre y la glosa del spec'
);

-- 10) Las cuentas de resultado quedan con saldo 0 en el año cerrado.
select is(
  (select coalesce(sum(l.haber - l.debe), 0)
   from asientos_lineas l
   join asientos a on a.empresa_id = l.empresa_id and a.id = l.asiento_id
   join cuentas_contables c on c.empresa_id = l.empresa_id and c.id = l.cuenta_id
   where l.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and c.tipo in ('ingreso', 'gasto')
     and a.fecha between date '2025-01-01' and date '2025-12-31'),
  0::bigint,
  'tras el cierre, ingresos y gastos suman saldo 0 en 2025'
);

-- 11) La fila del cierre queda cerrada con el resultado correcto.
select is(
  (select estado || '/' || resultado from cierres_ejercicio
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and anio = 2025),
  'cerrado/70000',
  'cierres_ejercicio registra 2025 cerrado con utilidad 70000'
);

-- 12) Doble cierre: 2025 ya está cerrado.
select throws_ok(
  $$select cerrar_ejercicio('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 2025)$$,
  'P0001', 'El ejercicio 2025 ya está cerrado',
  'un ejercicio cerrado no se cierra dos veces'
);

-- 13) Candado del helper: un asiento manual con fecha en el año cerrado no entra
--     (mensaje del spec §2.4 con el año interpolado).
select throws_ok(
  $$select crear_asiento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', date '2025-08-01', 'Tardío manual', jsonb_build_array(
    jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema = 'banco'), 'debe', 1000, 'haber', 0),
    jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema = 'ventas'), 'debe', 0, 'haber', 1000)))$$,
  'P0001', 'El ejercicio 2025 está cerrado',
  'el candado rechaza asientos manuales con fecha en un año cerrado'
);

-- 14) El asiento de CIERRE no se revierte por revertir_asiento (una reversa
--     directa consumiría la única reversa permitida y reabrir_ejercicio
--     quedaría roto para siempre): la única vía es reabrir_ejercicio. En este
--     punto hay un solo cierre al 31-dic-2025 (el de 2024 vive en su 31-dic).
select throws_ok(
  $$select revertir_asiento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from asientos
     where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
       and origen = 'cierre' and fecha = date '2025-12-31'),
    'Intento de reversa directa del cierre')$$,
  'P0001', 'El cierre solo se deshace reabriendo el ejercicio',
  'el asiento de cierre solo se deshace con reabrir_ejercicio'
);

-- ===== Documento tardío (service_role, el hook) =====
set local role service_role;

-- SETUP (sin assert): contabilizar la factura nov-2025 con 2025 ya cerrado.
select contabilizar_documento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'venta', 'dddddddd-0000-0000-0000-0000000000a2');

-- 15) El asiento no cae en el año cerrado: fecha = 1-ene del ejercicio abierto.
select is(
  (select fecha from asientos
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and origen = 'venta'
     and referencia_id = 'dddddddd-0000-0000-0000-0000000000a2'),
  date '2026-01-01',
  'un documento de un año cerrado se contabiliza al 1-ene del ejercicio abierto'
);

-- ===== app._fecha_contable directo (superuser: el helper no tiene grants) =====
reset role;

-- 16) Clamp simple: 2025 cerrado → 1-ene-2026.
select is(
  app._fecha_contable('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', date '2025-06-10'),
  date '2026-01-01',
  'una fecha en el año cerrado se clampea al 1-ene del ejercicio abierto'
);

-- 17) Clamp consecutivo: 2024 y 2025 cerrados → una fecha 2024 salta ambos.
select is(
  app._fecha_contable('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', date '2024-03-01'),
  date '2026-01-01',
  'con dos años cerrados consecutivos, la fecha salta al primer ejercicio abierto'
);

-- 18) Sin cierre: la fecha queda intacta.
select is(
  app._fecha_contable('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', date '2026-03-05'),
  date '2026-03-05',
  'una fecha en un año abierto queda intacta'
);

-- ===== reabrir_ejercicio =====

-- 19) Vendedor (Vero): el rol se chequea PRIMERO.
set local role authenticated;
set local request.jwt.claims to '{"sub": "77777777-7777-7777-7777-777777777777", "role": "authenticated"}';
select throws_ok(
  $$select reabrir_ejercicio('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 2025)$$,
  'P0001', 'Tu rol no permite reabrir el ejercicio',
  'el vendedor no puede reabrir el ejercicio'
);

set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- 20) Reabrir un año que no está cerrado (2026 nunca se cerró).
select throws_ok(
  $$select reabrir_ejercicio('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 2026)$$,
  'P0001', 'El ejercicio 2026 no está cerrado',
  'no se reabre un ejercicio que no está cerrado'
);

-- 21) Reapertura en orden inverso: 2025 (posterior) sigue cerrado.
select throws_ok(
  $$select reabrir_ejercicio('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 2024)$$,
  'P0001', 'Reabre primero el ejercicio 2025',
  'no se reabre 2024 mientras 2025 siga cerrado'
);

-- SETUP (feliz sin assert): Ana reabre 2025. Los asserts 22-24 verifican el efecto.
select reabrir_ejercicio('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 2025);

-- 22) La reversa queda ligada por reversa_de al asiento de cierre vigente,
--     con fecha 31-dic (no contamina el ejercicio siguiente) y glosa del spec.
select is(
  (select r.fecha::text || '/' || r.glosa
   from asientos r
   where r.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and r.origen = 'reversa'
     and r.reversa_de = (select asiento_cierre_id from cierres_ejercicio
                         where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and anio = 2025)),
  '2025-12-31/Reapertura del ejercicio 2025',
  'la reapertura crea la reversa ligada al cierre, con fecha 31-dic'
);

-- 23) La fila queda reabierta con auditoría de quién y cuándo.
select is(
  (select estado || '/' || (reabierto_por is not null)::text || '/' || (reabierto_en is not null)::text
   from cierres_ejercicio
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and anio = 2025),
  'reabierto/true/true',
  'la fila pasa a reabierto y registra reabierto_por y reabierto_en'
);

-- 24) El año reabierto vuelve a aceptar asientos (Ces, contador): la venta
--     olvidada de 10000 sube la utilidad del re-cierre a 80000.
set local request.jwt.claims to '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated"}';
select ok(
  (select crear_asiento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', date '2025-05-05', 'Venta olvidada', jsonb_build_array(
    jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema = 'banco'), 'debe', 10000, 'haber', 0),
    jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema = 'ventas'), 'debe', 0, 'haber', 10000)))) is not null,
  'tras reabrir, 2025 vuelve a aceptar asientos'
);

-- ===== revision_periodo (foto de enero-2026 con 2025 reabierto): 7 goldens + semáforo =====

-- 25) Vendedor (Vero): rol denegado.
set local request.jwt.claims to '{"sub": "77777777-7777-7777-7777-777777777777", "role": "authenticated"}';
select throws_ok(
  $$select revision_periodo('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 2026, 1)$$,
  'P0001', 'Tu rol no permite ver la revisión',
  'el vendedor no ve la revisión del período'
);

set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- 26) Período inválido: p_mes 13 no es un mes (validado tras el rol).
select throws_ok(
  $$select revision_periodo('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 2026, 13)$$,
  'P0001', 'Período no válido',
  'revision_periodo rechaza un mes fuera de 1-12'
);

-- 27) GOLDEN regla 1: la factura a1 (ene-2026) sigue sin asiento.
select is(
  (select o->>'severidad'
   from jsonb_array_elements(revision_periodo('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 2026, 1)->'observaciones') as o
   where o->>'regla' = 'documentos_sin_contabilizar'),
  'critica',
  'la factura de enero sin contabilizar dispara documentos_sin_contabilizar (crítica)'
);

-- 28) GOLDEN regla 2: IVA del libro de ventas de enero (19000, factura a1) ≠
--     movimientos de iva_debito en enero (9500, asiento clampeado de a2).
select is(
  (select o->>'severidad'
   from jsonb_array_elements(revision_periodo('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 2026, 1)->'observaciones') as o
   where o->>'regla' = 'iva_descuadrado'),
  'critica',
  'el IVA del libro difiere de la cuenta iva_debito: iva_descuadrado (crítica)'
);

-- 29) GOLDEN regla 7: 2025 tiene saldos de resultado y está reabierto (no cerrado).
select is(
  (select o->>'severidad'
   from jsonb_array_elements(revision_periodo('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 2026, 1)->'observaciones') as o
   where o->>'regla' = 'ejercicio_anterior_abierto'),
  'media',
  'el año anterior con movimientos y sin cerrar dispara ejercicio_anterior_abierto (media)'
);

-- 30) GOLDEN regla 6: el asiento de a2 (fecha 1-ene-2026) difiere de la fecha
--     del documento origen (nov-2025): el clamping quedó como observación.
select is(
  (select o->>'severidad'
   from jsonb_array_elements(revision_periodo('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 2026, 1)->'observaciones') as o
   where o->>'regla' = 'asientos_tardios'),
  'media',
  'el asiento clampeado difiere de la fecha del documento: asientos_tardios (media)'
);

-- 31) GOLDEN regla 3: SOLO a2 (vencida, con saldo, sin recordatorio) dispara;
--     a1 y a3 también están vencidas pero su recordatorio del fixture
--     (creado_en now(), siempre < 30 días) las suprime.
select is(
  (select string_agg(o->>'enlace_id', ',')
   from jsonb_array_elements(revision_periodo('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 2026, 1)->'observaciones') as o
   where o->>'regla' = 'facturas_vencidas_sin_gestion'),
  'dddddddd-0000-0000-0000-0000000000a2',
  'solo la factura vencida sin recordatorio reciente dispara facturas_vencidas_sin_gestion'
);

-- 32) GOLDEN regla 5: el anticipo de oct-2025 sigue 'recibido' hace más de 60 días.
select is(
  (select o->>'severidad' || '/' || (o->>'enlace_tipo')
   from jsonb_array_elements(revision_periodo('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 2026, 1)->'observaciones') as o
   where o->>'regla' = 'anticipos_sin_aplicar'),
  'media/anticipo',
  'el anticipo recibido hace más de 60 días dispara anticipos_sin_aplicar (media)'
);

-- 33) GOLDEN regla 4: ventas de enero (119000, a1) contra el promedio de
--     nov-dic 2025 (59500 = a2/a3): 119000 > 140% de 59500 → fuera de banda.
--     Sin documentos_compra, la mitad de gastos no opina: una sola observación.
select is(
  (select o->>'severidad'
   from jsonb_array_elements(revision_periodo('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 2026, 1)->'observaciones') as o
   where o->>'regla' = 'anomalia_vs_promedio'),
  'media',
  'ventas de enero fuera de la banda 60-140% del promedio dispara anomalia_vs_promedio (media)'
);

-- 34) Semáforo agregado: la peor severidad presente es crítica.
select is(
  revision_periodo('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 2026, 1)->>'estado',
  'critica',
  'el semáforo del período agrega la peor severidad presente'
);

-- ===== Re-cierre tras reapertura =====

-- SETUP (feliz sin assert): Ana re-cierra 2025 (ahora con la venta olvidada).
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select cerrar_ejercicio('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 2025);

-- 35) La fila vuelve a cerrado con el resultado recalculado (70000 + 10000).
select is(
  (select estado || '/' || resultado from cierres_ejercicio
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and anio = 2025),
  'cerrado/80000',
  're-cerrar deja la fila cerrada con la utilidad recalculada (80000)'
);

-- 36) El re-cierre es un asiento NUEVO: el vigente no es el revertido y hay
--     dos asientos de cierre al 31-dic-2025 (el histórico y el nuevo).
select ok(
  (select asiento_cierre_id from cierres_ejercicio
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and anio = 2025)
  <> (select reversa_de from asientos
      where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and origen = 'reversa' and reversa_de is not null)
  and (select count(*) from asientos
       where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and origen = 'cierre' and fecha = date '2025-12-31') = 2,
  're-cerrar crea un asiento de cierre nuevo: el vigente no es el revertido'
);

select * from finish();
rollback;
