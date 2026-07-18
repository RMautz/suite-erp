begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

-- Rita registra sus organizaciones por la RPC (camino real). RUT nuevos, únicos
-- GLOBALES (módulo 11, cálculo en el plan): 769606017 / 769606025 / 769606033
-- no aparecen en ningún test, el seed (771234569, 778899000, 772506309,
-- 768901201, 965112006, 76455180K, 776803308) ni los E2E (999999999, 888888888).
insert into auth.users (instance_id, id, aud, role, email)
values ('00000000-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444', 'authenticated', 'authenticated', 'rita@rubros.cl');

set local role authenticated;
set local request.jwt.claims to '{"sub": "44444444-4444-4444-4444-444444444444", "role": "authenticated"}';

-- SETUP (felices sin assert propio, patrón contabilidad: si fallaran, el archivo
-- entero aborta): registro con rubro explícito y registro sin el parámetro.
select registrar_organizacion('76.960.601-7', 'Rubros Transporte SpA', 'transporte');
select registrar_organizacion('76.960.602-5', 'Rubros Negocio SpA');

-- 1) Registrar con rubro transporte deja AMBOS campos coherentes.
select is(
  (select rubro || '/' || modulo_transporte from empresas where rut = '769606017'),
  'transporte/true',
  'registrar con rubro transporte enciende rubro y modulo_transporte juntos'
);

-- 2) Sin p_rubro rige el default: negocio con el módulo apagado.
select is(
  (select rubro || '/' || modulo_transporte from empresas where rut = '769606025'),
  'negocio/false',
  'registrar sin rubro usa el default negocio con el módulo apagado'
);

-- 3) Rubro fuera del catálogo: rechazo temprano, mensaje byte-exacto.
select throws_ok(
  $$select registrar_organizacion('76.960.603-3', 'Rubros Inválida SpA', 'minera')$$,
  'P0001', 'Rubro no válido',
  'registrar con un rubro fuera del catálogo es rechazado'
);

-- 4) cambiar_rubro es SOLO service_role: authenticated → 42501 (el grant ES el candado).
select throws_ok(
  $$select cambiar_rubro((select id from empresas where rut = '769606017'), 'negocio')$$,
  '42501', 'permission denied for function cambiar_rubro',
  'authenticated no ejecuta cambiar_rubro (solo la plataforma vía service_role)'
);

-- 5) Flip crudo del flag bloqueado: modulo_transporte quedó FUERA del grant por
--    columnas (Rita es dueña: la RLS de fila pasa, el grant de columna no).
select throws_ok(
  $$update empresas set modulo_transporte = false where rut = '769606017'$$,
  '42501', 'permission denied for table empresas',
  'ni la dueña puede mover modulo_transporte por escritura directa'
);

-- 6) rubro tampoco es escribible en directo.
select throws_ok(
  $$update empresas set rubro = 'negocio' where rut = '769606017'$$,
  '42501', 'permission denied for table empresas',
  'ni la dueña puede mover rubro por escritura directa'
);

-- 7) La vía INSERT también está cerrada: el grant de INSERT por columnas de
--    0023 no incluye modulo_transporte (ni rubro ni modulo_contabilidad), así
--    que ni la dueña puede autohabilitarse el módulo creando una 2ª empresa.
select throws_ok(
  $$insert into empresas (organizacion_id, rut, razon_social, modulo_transporte)
    values ((select organizacion_id from empresas where rut = '769606017'), '769606033', 'Colada SpA', true)$$,
  '42501', 'permission denied for table empresas',
  'ni la dueña puede insertar una empresa con modulo_transporte en directo'
);

-- ===== cambiar_rubro (service_role: el panel admin; salta RLS, patrón contabilidad) =====
set local role service_role;

-- 8) transporte → negocio mueve AMBOS campos.
select cambiar_rubro((select id from empresas where rut = '769606017'), 'negocio');
select is(
  (select rubro || '/' || modulo_transporte from empresas where rut = '769606017'),
  'negocio/false',
  'cambiar_rubro a negocio apaga el módulo junto con el rubro'
);

-- 9) negocio → transporte de vuelta: reversible sin pérdida.
select cambiar_rubro((select id from empresas where rut = '769606017'), 'transporte');
select is(
  (select rubro || '/' || modulo_transporte from empresas where rut = '769606017'),
  'transporte/true',
  'cambiar_rubro a transporte reenciende el módulo junto con el rubro'
);

-- 10) Empresa inexistente: mensaje byte-exacto.
select throws_ok(
  $$select cambiar_rubro('00000000-0000-0000-0000-000000000099', 'negocio')$$,
  'P0001', 'Empresa no encontrada',
  'cambiar_rubro sobre una empresa inexistente reclama'
);

-- 11) Rubro fuera del catálogo también en cambiar_rubro.
select throws_ok(
  $$select cambiar_rubro((select id from empresas where rut = '769606017'), 'minera')$$,
  'P0001', 'Rubro no válido',
  'cambiar_rubro con un rubro fuera del catálogo es rechazado'
);

-- 12) Última línea de defensa: el CHECK rechaza la escritura cruda incluso de
--     service_role (que sí tiene grant de update completo desde 0001).
select throws_ok(
  $$update empresas set rubro = 'minera' where rut = '769606017'$$,
  '23514', 'new row for relation "empresas" violates check constraint "empresas_rubro_check"',
  'el CHECK rechaza cualquier rubro fuera del catálogo aun en escritura cruda'
);

select * from finish();
rollback;
