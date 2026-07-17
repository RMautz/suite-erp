begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'ana@a.cl'),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'beto@b.cl'),
  ('00000000-0000-0000-0000-000000000000', '77777777-7777-7777-7777-777777777777', 'authenticated', 'authenticated', 'vero@a.cl'),
  ('00000000-0000-0000-0000-000000000000', '55555555-5555-5555-5555-555555555555', 'authenticated', 'authenticated', 'ces@a.cl'),
  ('00000000-0000-0000-0000-000000000000', '66666666-6666-6666-6666-666666666666', 'authenticated', 'authenticated', 'dora@a.cl');

insert into public.organizaciones (id, rut, razon_social)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '770000014', 'Org A'),
       ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '770000022', 'Org B');

insert into public.empresas (id, organizacion_id, rut, razon_social)
values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '770000014', 'Empresa A'),
       ('eeeeeeee-0000-0000-0000-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '770000022', 'Empresa B');

-- Ana dueña de A; Beto dueño de B; Vero vendedora de A (SÍ registra correos);
-- Ces contador y Dora bodeguera de A (roles SIN permiso de envío).
insert into public.miembros (usuario_id, organizacion_id, rol)
values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'dueno'),
       ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'dueno'),
       ('77777777-7777-7777-7777-777777777777', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'vendedor'),
       ('55555555-5555-5555-5555-555555555555', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'contador'),
       ('66666666-6666-6666-6666-666666666666', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bodeguero');

-- ===== Ana (dueña A): registra, y ejerce los candados de tipo/empresa/inmutabilidad =====
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- 1) La dueña registra un correo enviado (insert directo) y la fila retorna.
select results_eq(
  $$with i as (
    insert into correos_enviados (empresa_id, tipo, referencia_id, para, asunto, proveedor_id)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cotizacion', 'cccc0000-0000-0000-0000-aaaaaaaaaaaa',
            'cliente@ejemplo.cl', 'Cotización N° 1 - Empresa A', 'mock-cot-1')
    returning 1
  ) select count(*) from i$$,
  array[1::bigint],
  'la dueña registra un correo enviado y la fila retorna'
);

-- 5) Un tipo fuera del catálogo es rechazado por el CHECK (Ana pasa la RLS; solo el
--    check falla → 23514, nunca 42501).
select throws_ok(
  $$insert into correos_enviados (empresa_id, tipo, referencia_id, para, asunto, proveedor_id)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'boletin', 'cccc0000-0000-0000-0000-aaaaaaaaaaaa',
            'cliente@ejemplo.cl', 'Boletín no soportado', 'mock-x')$$,
  '23514', null,
  'un tipo de correo fuera del catálogo es rechazado por el check'
);

-- 6) Empresa ajena: la dueña de A no puede registrar en la Empresa B (RLS with check).
select throws_ok(
  $$insert into correos_enviados (empresa_id, tipo, referencia_id, para, asunto, proveedor_id)
    values ('eeeeeeee-0000-0000-0000-bbbbbbbbbbbb', 'cotizacion', 'cccc0000-0000-0000-0000-aaaaaaaaaaaa',
            'cliente@ejemplo.cl', 'Cotización de otra empresa', 'mock-y')$$,
  '42501', 'new row violates row-level security policy for table "correos_enviados"',
  'la dueña no puede registrar un correo en una empresa ajena'
);

-- 9) Log inmutable: nadie edita un correo ya registrado (sin grant de update → 42501).
select throws_ok(
  $$update correos_enviados set asunto = 'editado'
    where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'$$,
  '42501', 'permission denied for table correos_enviados',
  'un correo registrado no se puede editar (log inmutable)'
);

-- 10) Log inmutable: nadie borra un correo ya registrado (sin grant de delete → 42501).
select throws_ok(
  $$delete from correos_enviados where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'$$,
  '42501', 'permission denied for table correos_enviados',
  'un correo registrado no se puede borrar (log inmutable)'
);

-- ===== Vero (vendedora A): el vendedor SÍ registra (rol incluido a propósito) =====
set local request.jwt.claims to '{"sub": "77777777-7777-7777-7777-777777777777", "role": "authenticated"}';

-- 2) El vendedor registra un correo enviado y la fila retorna.
select results_eq(
  $$with i as (
    insert into correos_enviados (empresa_id, tipo, referencia_id, para, asunto, proveedor_id)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'proforma', 'cccc0000-0000-0000-0000-aaaaaaaaaaaa',
            'cliente@ejemplo.cl', 'Proforma N° 1 - Empresa A', 'mock-pro-1')
    returning 1
  ) select count(*) from i$$,
  array[1::bigint],
  'un vendedor registra un correo enviado y la fila retorna'
);

-- ===== Ces (contador A): rol sin permiso de envío =====
set local request.jwt.claims to '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated"}';

-- 3) El contador NO registra correos (RLS with check: rol fuera de dueno/admin/vendedor).
select throws_ok(
  $$insert into correos_enviados (empresa_id, tipo, referencia_id, para, asunto, proveedor_id)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'documento', 'cccc0000-0000-0000-0000-aaaaaaaaaaaa',
            'cliente@ejemplo.cl', 'Factura N° 1', 'mock-doc-1')$$,
  '42501', 'new row violates row-level security policy for table "correos_enviados"',
  'un contador no puede registrar correos enviados'
);

-- ===== Dora (bodeguera A): rol sin permiso de envío =====
set local request.jwt.claims to '{"sub": "66666666-6666-6666-6666-666666666666", "role": "authenticated"}';

-- 4) La bodeguera NO registra correos (RLS with check).
select throws_ok(
  $$insert into correos_enviados (empresa_id, tipo, referencia_id, para, asunto, proveedor_id)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'recordatorio', 'cccc0000-0000-0000-0000-aaaaaaaaaaaa',
            'cliente@ejemplo.cl', 'Recordatorio de pago', 'mock-rec-1')$$,
  '42501', 'new row violates row-level security policy for table "correos_enviados"',
  'una bodeguera no puede registrar correos enviados'
);

-- ===== Beto (dueño B): aislamiento cross-tenant =====
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

-- 7) Beto solo ve los correos de su empresa (B, ninguno): 0 filas de los de A.
select is(
  (select count(*) from correos_enviados),
  0::bigint,
  'un dueño de otra empresa no ve los correos ajenos'
);

-- ===== Anónimo: denegado de plano =====
set local request.jwt.claims to '{"role": "anon"}';
set local role anon;

-- 8) El anónimo no puede consultar la tabla (sin grant → permission denied).
select throws_ok(
  'select count(*) from correos_enviados',
  '42501', 'permission denied for table correos_enviados',
  'un anónimo no puede consultar los correos enviados'
);

select * from finish();
rollback;
