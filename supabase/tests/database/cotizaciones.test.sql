begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'ana@a.cl'),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'beto@b.cl'),
  ('00000000-0000-0000-0000-000000000000', '55555555-5555-5555-5555-555555555555', 'authenticated', 'authenticated', 'ces@a.cl'),
  ('00000000-0000-0000-0000-000000000000', '66666666-6666-6666-6666-666666666666', 'authenticated', 'authenticated', 'dora@a.cl'),
  ('00000000-0000-0000-0000-000000000000', '77777777-7777-7777-7777-777777777777', 'authenticated', 'authenticated', 'vero@a.cl');

-- RUT nuevos: no colisionan con otros tests (7611/7622/76543210x) ni con el seed (771234569).
insert into public.organizaciones (id, rut, razon_social)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '763333337', 'Org A'),
       ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '764444442', 'Org B');

insert into public.empresas (id, organizacion_id, rut, razon_social)
values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '763333337', 'Empresa A'),
       ('eeeeeeee-0000-0000-0000-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '764444442', 'Empresa B');

insert into public.miembros (usuario_id, organizacion_id, rol)
values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'dueno'),
       ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'dueno'),
       ('55555555-5555-5555-5555-555555555555', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'contador'),
       ('66666666-6666-6666-6666-666666666666', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bodeguero'),
       ('77777777-7777-7777-7777-777777777777', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'vendedor');

insert into public.clientes (id, empresa_id, rut, razon_social)
values ('cccccccc-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '765555558', 'Cliente A'),
       ('cccccccc-0000-0000-0000-bbbbbbbbbbbb', 'eeeeeeee-0000-0000-0000-bbbbbbbbbbbb', '766666663', 'Cliente B');
insert into public.clientes (id, empresa_id, rut, razon_social, activo)
values ('cccccccc-1111-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '767777779', 'Cliente Inactivo', false);

-- P1 afecto (lista 10000), P2 exento (lista 5000), P3 afecto (se desactivara), PB de la empresa B.
insert into public.productos (id, empresa_id, sku, nombre, precio_neto, exento)
values ('99999999-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'P1', 'Producto Afecto', 10000, false),
       ('99999999-1111-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'P2', 'Producto Exento', 5000, true),
       ('99999999-2222-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'P3', 'Producto Fragil', 2000, false),
       ('99999999-0000-0000-0000-bbbbbbbbbbbb', 'eeeeeeee-0000-0000-0000-bbbbbbbbbbbb', 'PB', 'Producto B', 7000, false);

-- QB: cotizacion de la empresa B (fixture directo; totales 0 cumplen el check).
insert into public.cotizaciones (id, empresa_id, numero, cliente_id, fecha_validez)
values ('c0c0c0c0-0000-0000-0000-bbbbbbbbbbbb', 'eeeeeeee-0000-0000-0000-bbbbbbbbbbbb', 1,
        'cccccccc-0000-0000-0000-bbbbbbbbbbbb', current_date + 30);

-- ===== Ana (duena A) =====
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- 1) Ana crea C1 con precios negociados (P1: lista 10000 -> cotizado 8000).
--    neto 24000 + exento 10000 + iva 4560 = 38560.
select lives_ok(
  $$select crear_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
    current_date + 30, 'Descuento por volumen',
    '[{"productoId":"99999999-0000-0000-0000-aaaaaaaaaaaa","cantidad":3,"precioNeto":8000},
      {"productoId":"99999999-1111-0000-0000-aaaaaaaaaaaa","cantidad":2,"precioNeto":5000}]'::jsonb)$$,
  'la dueña crea una cotización con precios negociados'
);

-- Setup sin assert: Vero (vendedora) crea C2 — si el rol vendedor no pudiera,
-- esta llamada abortaria la transaccion del test (y el 2 de abajo no existiria).
set local request.jwt.claims to '{"sub": "77777777-7777-7777-7777-777777777777", "role": "authenticated"}';
select crear_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
  current_date + 30, null,
  '[{"productoId":"99999999-0000-0000-0000-aaaaaaaaaaaa","cantidad":1,"precioNeto":10000}]'::jsonb);

-- 2) Correlativo secuencial: 1 (Ana) y 2 (la vendedora SI cotiza).
select results_eq(
  $$select numero from cotizaciones where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' order by numero$$,
  array[1, 2],
  'los correlativos son secuenciales y la vendedora sí cotiza'
);

-- 3) Dora (bodeguera) NO crea cotizaciones.
set local request.jwt.claims to '{"sub": "66666666-6666-6666-6666-666666666666", "role": "authenticated"}';
select throws_ok(
  $$select crear_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
    current_date + 30, null, '[{"productoId":"99999999-0000-0000-0000-aaaaaaaaaaaa","cantidad":1,"precioNeto":1}]'::jsonb)$$,
  'P0001', 'Tu rol no permite crear cotizaciones',
  'la bodeguera no puede crear cotizaciones'
);

-- 4) Ces (contador) NO gestiona cotizaciones.
set local request.jwt.claims to '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated"}';
select throws_ok(
  $$select cambiar_estado_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from cotizaciones where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1), 'enviada')$$,
  'P0001', 'Tu rol no permite gestionar cotizaciones',
  'el contador no puede gestionar cotizaciones'
);

-- 5) Ces (contador) NO convierte cotizaciones (rol denegado en las 3 RPCs).
select throws_ok(
  $$select convertir_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from cotizaciones where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1))$$,
  'P0001', 'Tu rol no permite convertir cotizaciones',
  'el contador no puede convertir cotizaciones'
);

-- ===== Ana: validaciones de crear =====
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- 6) El precio cotizado no puede ser negativo (el precio SI viene del llamador).
select throws_ok(
  $$select crear_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
    current_date + 30, null, '[{"productoId":"99999999-0000-0000-0000-aaaaaaaaaaaa","cantidad":1,"precioNeto":-1}]'::jsonb)$$,
  'P0001', 'El precio debe ser un entero mayor o igual a 0',
  'el precio cotizado no puede ser negativo'
);

-- 7) Producto de otra empresa (mismo mensaje que inexistente o inactivo).
select throws_ok(
  $$select crear_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
    current_date + 30, null, '[{"productoId":"99999999-0000-0000-0000-bbbbbbbbbbbb","cantidad":1,"precioNeto":1000}]'::jsonb)$$,
  'P0001', 'Producto no válido',
  'no se cotiza un producto de otra empresa'
);

-- 8) Cliente inactivo (mismo mensaje que inexistente o ajeno).
select throws_ok(
  $$select crear_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-1111-0000-0000-aaaaaaaaaaaa',
    current_date + 30, null, '[{"productoId":"99999999-0000-0000-0000-aaaaaaaaaaaa","cantidad":1,"precioNeto":1000}]'::jsonb)$$,
  'P0001', 'Cliente no válido',
  'no se cotiza a un cliente inactivo'
);

-- 9) Sin líneas ('[]'::jsonb): la cotización necesita al menos una.
select throws_ok(
  $$select crear_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
    current_date + 30, null, '[]'::jsonb)$$,
  'P0001', 'La cotización necesita al menos una línea',
  'una cotización no se crea sin líneas'
);

-- 10) Cantidad 0 no es válida (mínimo 1).
select throws_ok(
  $$select crear_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
    current_date + 30, null, '[{"productoId":"99999999-0000-0000-0000-aaaaaaaaaaaa","cantidad":0,"precioNeto":1000}]'::jsonb)$$,
  'P0001', 'La cantidad debe ser al menos 1',
  'la cantidad no puede ser 0'
);

-- 11) Validez pasada.
select throws_ok(
  $$select crear_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
    current_date - 1, null, '[{"productoId":"99999999-0000-0000-0000-aaaaaaaaaaaa","cantidad":1,"precioNeto":1000}]'::jsonb)$$,
  'P0001', 'La fecha de validez no puede ser anterior a hoy',
  'la validez no puede ser anterior a hoy'
);

-- ===== Transiciones (C1 sigue en borrador) =====

-- 12) borrador -> aceptada es invalido (hay que enviar primero).
select throws_ok(
  $$select cambiar_estado_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from cotizaciones where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1), 'aceptada')$$,
  'P0001', 'Transición de estado no válida',
  'no se acepta una cotización en borrador'
);

-- 13) p_estado = 'convertida' esta vetado en la RPC de estado (mismo mensaje).
select throws_ok(
  $$select cambiar_estado_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from cotizaciones where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1), 'convertida')$$,
  'P0001', 'Transición de estado no válida',
  'convertida solo se alcanza vía convertir_cotizacion'
);

-- 14) Motivo de puro whitespace = motivo vacio (nullif/trim los iguala).
select throws_ok(
  $$select cambiar_estado_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from cotizaciones where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1), 'rechazada', '   ')$$,
  'P0001', 'El rechazo requiere un motivo',
  'el motivo de rechazo no puede ser vacío ni whitespace'
);

-- 15) Motivo NULL (sin motivo alguno) tampoco es válido para rechazar.
select throws_ok(
  $$select cambiar_estado_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from cotizaciones where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1), 'rechazada', null)$$,
  'P0001', 'El rechazo requiere un motivo',
  'el rechazo sin motivo (NULL) tampoco es válido'
);

-- 16) La cotizacion de la empresa B "no existe" para la empresa A.
select throws_ok(
  $$select cambiar_estado_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    'c0c0c0c0-0000-0000-0000-bbbbbbbbbbbb', 'enviada')$$,
  'P0001', 'La cotización no existe',
  'una cotización de otra empresa da el mismo mensaje que una inexistente'
);

-- 17) Convertir una cotizacion de otra empresa da el mismo mensaje que una inexistente.
select throws_ok(
  $$select convertir_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    'c0c0c0c0-0000-0000-0000-bbbbbbbbbbbb')$$,
  'P0001', 'La cotización no existe',
  'convertir una cotización de otra empresa da el mismo mensaje que una inexistente'
);

-- ===== Vigencia: C2 enviada y luego vencida =====
select cambiar_estado_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from cotizaciones where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 2), 'enviada');
-- Backdate como superuser: la tabla no tiene check contra creado_en a proposito.
reset role;
update public.cotizaciones set fecha_validez = current_date - 1
where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 2;
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- 18) Aceptar una vencida falla.
select throws_ok(
  $$select cambiar_estado_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from cotizaciones where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 2), 'aceptada')$$,
  'P0001', 'La cotización está vencida',
  'una cotización vencida no se puede aceptar'
);

-- ===== Conversion: C1 enviada -> aceptada (vigente) -> vencida -> convertida =====
select cambiar_estado_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from cotizaciones where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1), 'enviada');

-- 19) Convertir una no-aceptada falla.
select throws_ok(
  $$select convertir_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from cotizaciones where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1))$$,
  'P0001', 'Solo se puede convertir una cotización aceptada',
  'una cotización enviada (no aceptada) no se convierte'
);

-- Setup: Ana acepta C1 DENTRO de la vigencia; DESPUES la validez expira
-- (la aceptacion congelo el trato).
select cambiar_estado_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from cotizaciones where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1), 'aceptada');
reset role;
update public.cotizaciones set fecha_validez = current_date - 1
where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1;
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- 20) La aceptada-vencida SI se convierte (sin condicion de fecha).
select lives_ok(
  $$select convertir_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from cotizaciones where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1))$$,
  'una aceptada se convierte aunque la validez haya expirado después de aceptar'
);

-- 21) Nota de venta en borrador, enlazada, con el precio COTIZADO (8000, no 10000 de lista)
--     y los totales de la cotizacion (38560).
select is(
  (select d.tipo || '/' || d.estado || '/' || l.precio_neto::text || '/' || d.total::text
   from cotizaciones c
   join documentos_venta d on d.id = c.documento_venta_id and d.empresa_id = c.empresa_id
   join documentos_venta_lineas l on l.documento_id = d.id and l.empresa_id = d.empresa_id
     and l.producto_id = '99999999-0000-0000-0000-aaaaaaaaaaaa'
   where c.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and c.numero = 1 and c.estado = 'convertida'),
  'nota_venta/borrador/8000/38560',
  'la conversión crea la nota de venta en borrador con los precios cotizados y queda enlazada'
);

-- 22) Doble conversion imposible (convertida ya no esta aceptada).
select throws_ok(
  $$select convertir_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from cotizaciones where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1))$$,
  'P0001', 'Solo se puede convertir una cotización aceptada',
  'una cotización convertida no se convierte dos veces'
);

-- ===== Producto cambiado: C3 aceptada y P3 desactivado antes de convertir =====
select crear_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
  current_date + 30, null,
  '[{"productoId":"99999999-2222-0000-0000-aaaaaaaaaaaa","cantidad":1,"precioNeto":2000}]'::jsonb);
select cambiar_estado_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from cotizaciones where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 3), 'enviada');
select cambiar_estado_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from cotizaciones where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 3), 'aceptada');
reset role;
update public.productos set activo = false where id = '99999999-2222-0000-0000-aaaaaaaaaaaa';
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- 23) La conversion re-valida el producto (misma via si cambio la exencion).
select throws_ok(
  $$select convertir_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from cotizaciones where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 3))$$,
  'P0001', 'Un producto de la cotización ya no está disponible o cambió su condición de IVA; crea una nueva cotización',
  'no se convierte si un producto ya no está disponible'
);

-- ===== Exención cambiada: C4 aceptada y P1 (afecto) se vuelve exento antes de convertir =====
set local request.jwt.claims to '{"sub": "77777777-7777-7777-7777-777777777777", "role": "authenticated"}';
select crear_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
  current_date + 30, null,
  '[{"productoId":"99999999-0000-0000-0000-aaaaaaaaaaaa","cantidad":1,"precioNeto":10000}]'::jsonb);
select cambiar_estado_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from cotizaciones where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 4), 'enviada');
select cambiar_estado_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from cotizaciones where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 4), 'aceptada');
reset role;
update public.productos set exento = true where id = '99999999-0000-0000-0000-aaaaaaaaaaaa';
set local role authenticated;
set local request.jwt.claims to '{"sub": "77777777-7777-7777-7777-777777777777", "role": "authenticated"}';

-- 24) La conversion re-valida el producto (misma vía si cambió la exención, no solo si se desactivó).
select throws_ok(
  $$select convertir_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from cotizaciones where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 4))$$,
  'P0001', 'Un producto de la cotización ya no está disponible o cambió su condición de IVA; crea una nueva cotización',
  'no se convierte si un producto cambió su condición de IVA'
);

-- Restaurar el fixture: P1 vuelve a afecto.
reset role;
update public.productos set exento = false where id = '99999999-0000-0000-0000-aaaaaaaaaaaa';
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- 25) Beto (org B) solo ve su cotizacion QB: aislamiento en AMBAS tablas
--     (las 4 cotizaciones de A y sus lineas serian visibles si la RLS fallara).
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
select is(
  (select count(*) from cotizaciones) + (select count(*) from cotizaciones_lineas),
  1::bigint,
  'Beto ve solo su cotización: las de la empresa A y sus líneas quedan aisladas'
);

-- 26) Escritura directa denegada: authenticated no puede insertar en cotizaciones (toda escritura es por RPC).
select throws_ok(
  $$insert into cotizaciones (empresa_id, numero, cliente_id, fecha_validez)
    values ('eeeeeeee-0000-0000-0000-bbbbbbbbbbbb', 999, 'cccccccc-0000-0000-0000-bbbbbbbbbbbb', current_date + 30)$$,
  '42501', 'permission denied for table cotizaciones',
  'authenticated no puede insertar directamente en cotizaciones'
);

-- 27) Anonimo denegado de plano.
set local request.jwt.claims to '{"role": "anon"}';
set local role anon;
select throws_ok(
  'select count(*) from cotizaciones',
  '42501', 'permission denied for table cotizaciones',
  'un anónimo no puede consultar cotizaciones'
);

select * from finish();
rollback;
