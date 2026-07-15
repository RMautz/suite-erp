# Plan 8: Cuentas por pagar (facturas de proveedor + pagos + libro de compras SII) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Registrar facturas de proveedor (digitación manual, con vínculo opcional a OC), pagarlas multi-documento con anulación lógica, ver CxP con vencimientos y estado de cuenta por proveedor, y entregar el libro de compras formato SII con export CSV.

**Architecture:** Espejo de Cobranza (Plan 6) + libro/export del Plan 7: `documentos_compra` con insert directo RLS (dueno/admin) porque no hay cálculo server-side que proteger; `pagos_proveedor`+aplicaciones escritos SOLO vía RPCs atómicas (`for update` + saldo-en-lock + cuadratura); vistas `security_invoker` `saldos_compras` y `libro_compras`; pantallas espejo bajo `/por-pagar` + libro en Reportes.

**Tech Stack:** Next.js 15, Supabase (Postgres 17, RLS, pgTAP), Vitest (sin funciones nuevas de core — todo se reusa), TypeScript.

**Spec:** `docs/superpowers/specs/2026-07-15-plan8-por-pagar-design.md` (aprobado 2026-07-15).

## Global Constraints

- Multi-tenant: tablas nuevas con `empresa_id` + RLS + grants explícitos; FK compuestas `(empresa_id, x_id)`; `unique (empresa_id, id)`; app queries `.eq('empresa_id', activa.id)` con `activa` de `obtenerEmpresaActiva()`, jamás del formulario.
- `documentos_compra`: insert directo de authenticated SOLO vía policy `dueno`/`admin`; `update`/`delete` directos PROHIBIDOS (anulación por RPC). `unique (empresa_id, proveedor_id, tipo, folio)` — folios 33/34 son series independientes. `check (total = neto + exento + iva)`.
- `pagos_proveedor`/aplicaciones: CERO escritura directa de authenticated — solo las RPCs.
- Roles: TODO CxP (registrar factura, pagar, anular) = `dueno`/`admin`; lectura = cualquier miembro.
- Saldo NUNCA almacenado: `saldo = total − Σ aplicaciones de pagos activos` (sin NC en v1 → saldo ≥ 0 siempre); `fecha_vencimiento = fecha_emision + proveedores.condicion_pago_dias`.
- Mensajes exactos (contrato pgTAP): `'Tu rol no permite registrar pagos a proveedores'`, `'Tu rol no permite anular pagos a proveedores'`, `'Tu rol no permite anular facturas de compra'`, `'El monto aplicado supera el saldo del documento (saldo: $%)'`, `'La suma de las aplicaciones debe ser igual al monto del pago'`, `'Documento no válido o no pertenece al proveedor'`, `'La anulación requiere un motivo'`, `'El pago no existe o ya está anulado'`, `'La factura no existe o ya está anulada'`, `'La factura tiene pagos aplicados; anula primero esos pagos'`.
- Libro de compras: solo documentos `activa`; columnas fecha/tipo/folio/RUT/razón social/neto/exento/IVA(crédito)/total; export CSV con `filasACsv` (BOM `﻿` escape, `;`); misma UX que libro de ventas.
- CERO BOM literal en fuentes; UTF-8 sin BOM; español; CLP entero.
- Windows/PowerShell 5.1: `&&` no encadena; prefijar todo comando con el refresh de PATH.

---

### Task 1: Migración 0013 — documentos de compra, pagos a proveedor, vistas y RPCs

**Files:**
- Create: `supabase/migrations/00000000000013_por_pagar.sql`

**Interfaces:**
- Consumes: `proveedores`/`ordenes_compra` (ambas con `unique (empresa_id, id)`), `app.mis_empresas()`, `app.tiene_rol_en_empresa(uuid, text[])`.
- Produces: tablas `documentos_compra`, `pagos_proveedor`, `pagos_proveedor_aplicaciones`; vistas `saldos_compras`, `libro_compras`; RPCs `registrar_pago_proveedor(p_empresa uuid, p_proveedor uuid, p_fecha date, p_metodo text, p_monto integer, p_referencia text, p_notas text, p_aplicaciones jsonb) returns uuid`, `anular_pago_proveedor(p_empresa uuid, p_pago uuid, p_motivo text) returns void`, `anular_documento_compra(p_empresa uuid, p_documento uuid, p_motivo text) returns void`. jsonb aplicaciones: `[{"documentoId": "<uuid>", "monto": 40000}]`.

- [ ] **Step 1: Escribir la migración**

`supabase/migrations/00000000000013_por_pagar.sql`:

```sql
-- Cuentas por pagar: facturas de proveedor (digitacion manual), pagos realizados
-- multi-documento y libro de compras SII. Espejo de Cobranza (0010) + libro (0011).

-- ---------- Facturas de proveedor ----------
create table public.documentos_compra (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  proveedor_id uuid not null,
  tipo text not null check (tipo in ('factura', 'factura_exenta')),
  folio integer not null check (folio > 0),
  fecha_emision date not null,
  neto integer not null default 0 check (neto >= 0),
  exento integer not null default 0 check (exento >= 0),
  iva integer not null default 0 check (iva >= 0),
  total integer not null check (total >= 0 and total = neto + exento + iva),
  orden_id uuid,
  notas text,
  estado text not null default 'activa' check (estado in ('activa', 'anulada')),
  motivo_anulacion text,
  creado_en timestamptz not null default now(),
  unique (empresa_id, id),
  -- Anti doble-digitacion: factura (33) y factura exenta (34) llevan series independientes.
  unique (empresa_id, proveedor_id, tipo, folio),
  foreign key (empresa_id, proveedor_id) references public.proveedores (empresa_id, id),
  foreign key (empresa_id, orden_id) references public.ordenes_compra (empresa_id, id)
);
create index documentos_compra_proveedor_idx on public.documentos_compra (empresa_id, proveedor_id);

-- ---------- Pagos a proveedor (espejo de pagos de cobranza) ----------
create table public.pagos_proveedor (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  proveedor_id uuid not null,
  fecha date not null default current_date,
  metodo text not null check (metodo in ('efectivo', 'transferencia', 'tarjeta', 'cheque', 'otro')),
  monto integer not null check (monto > 0),
  referencia text,
  notas text,
  estado text not null default 'activo' check (estado in ('activo', 'anulado')),
  motivo_anulacion text,
  creado_en timestamptz not null default now(),
  unique (empresa_id, id),
  foreign key (empresa_id, proveedor_id) references public.proveedores (empresa_id, id)
);
create index pagos_proveedor_prov_idx on public.pagos_proveedor (empresa_id, proveedor_id);

create table public.pagos_proveedor_aplicaciones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  pago_id uuid not null,
  documento_id uuid not null,
  monto integer not null check (monto > 0),
  unique (empresa_id, id),
  foreign key (empresa_id, pago_id) references public.pagos_proveedor (empresa_id, id),
  foreign key (empresa_id, documento_id) references public.documentos_compra (empresa_id, id)
);
create index pagos_proveedor_apl_doc_idx on public.pagos_proveedor_aplicaciones (empresa_id, documento_id);

-- ---------- Vistas (security_invoker) ----------
create view public.saldos_compras with (security_invoker = true) as
select
  d.empresa_id,
  d.id as documento_id,
  d.tipo,
  d.folio,
  d.proveedor_id,
  pr.razon_social as proveedor_razon_social,
  d.fecha_emision,
  (d.fecha_emision + pr.condicion_pago_dias) as fecha_vencimiento,
  d.total,
  coalesce(p.pagado, 0)::integer as pagado,
  (d.total - coalesce(p.pagado, 0))::integer as saldo
from public.documentos_compra d
join public.proveedores pr on pr.id = d.proveedor_id and pr.empresa_id = d.empresa_id
left join lateral (
  select sum(a.monto) as pagado
  from public.pagos_proveedor_aplicaciones a
  join public.pagos_proveedor pg on pg.id = a.pago_id and pg.empresa_id = a.empresa_id
  where a.documento_id = d.id and a.empresa_id = d.empresa_id and pg.estado = 'activo'
) p on true
where d.estado = 'activa';

create view public.libro_compras with (security_invoker = true) as
select
  d.empresa_id,
  d.id as documento_id,
  d.fecha_emision as fecha,
  d.tipo,
  d.folio,
  pr.rut as rut_proveedor,
  pr.razon_social as razon_social_proveedor,
  d.neto,
  d.exento,
  d.iva,
  d.total
from public.documentos_compra d
join public.proveedores pr on pr.id = d.proveedor_id and pr.empresa_id = d.empresa_id
where d.estado = 'activa';

-- ---------- RLS ----------
alter table public.documentos_compra enable row level security;
alter table public.pagos_proveedor enable row level security;
alter table public.pagos_proveedor_aplicaciones enable row level security;

create policy "miembros ven documentos de compra" on public.documentos_compra
  for select to authenticated using (empresa_id in (select app.mis_empresas()));
create policy "miembros ven pagos a proveedor" on public.pagos_proveedor
  for select to authenticated using (empresa_id in (select app.mis_empresas()));
create policy "miembros ven aplicaciones de pago a proveedor" on public.pagos_proveedor_aplicaciones
  for select to authenticated using (empresa_id in (select app.mis_empresas()));

-- Registro manual de facturas: insert directo SOLO dueno/admin (sin update/delete:
-- la anulacion va por RPC con motivo y precondicion de pagos).
create policy "duenos registran facturas de compra" on public.documentos_compra
  for insert to authenticated
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']));

-- ---------- Grants (leccion Plan 1) ----------
grant select, insert on public.documentos_compra to authenticated;
grant select on public.pagos_proveedor, public.pagos_proveedor_aplicaciones to authenticated;
grant select on public.saldos_compras, public.libro_compras to authenticated;
grant select, insert, update, delete on public.documentos_compra, public.pagos_proveedor, public.pagos_proveedor_aplicaciones to service_role;
grant select on public.saldos_compras, public.libro_compras to service_role;

-- ---------- Registrar pago a proveedor (atomico; espejo de registrar_pago 0010) ----------
create or replace function public.registrar_pago_proveedor(
  p_empresa uuid, p_proveedor uuid, p_fecha date, p_metodo text, p_monto integer,
  p_referencia text, p_notas text, p_aplicaciones jsonb
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_pago uuid;
  v_app jsonb;
  v_doc record;
  v_monto_app integer;
  v_suma integer := 0;
  v_saldo integer;
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin']) then
    raise exception 'Tu rol no permite registrar pagos a proveedores';
  end if;
  if p_metodo is null or p_metodo not in ('efectivo', 'transferencia', 'tarjeta', 'cheque', 'otro') then
    raise exception 'Método de pago no válido';
  end if;
  if p_monto is null or p_monto <= 0 then
    raise exception 'El monto del pago debe ser mayor a 0';
  end if;
  if not exists (select 1 from proveedores where id = p_proveedor and empresa_id = p_empresa) then
    raise exception 'Proveedor no encontrado en la empresa';
  end if;
  if p_aplicaciones is null or jsonb_array_length(p_aplicaciones) = 0 then
    raise exception 'El pago debe aplicarse a al menos un documento';
  end if;

  insert into pagos_proveedor (empresa_id, proveedor_id, fecha, metodo, monto, referencia, notas)
  values (p_empresa, p_proveedor, coalesce(p_fecha, current_date), p_metodo, p_monto,
          nullif(trim(coalesce(p_referencia, '')), ''), nullif(trim(coalesce(p_notas, '')), ''))
  returning id into v_pago;

  for v_app in select * from jsonb_array_elements(p_aplicaciones) loop
    select d.id, d.total into v_doc
    from documentos_compra d
    where d.id = (v_app->>'documentoId')::uuid and d.empresa_id = p_empresa
      and d.proveedor_id = p_proveedor and d.estado = 'activa'
    for update;
    if not found then
      raise exception 'Documento no válido o no pertenece al proveedor';
    end if;
    v_monto_app := (v_app->>'monto')::integer;
    if v_monto_app is null or v_monto_app <= 0 then
      raise exception 'El monto aplicado debe ser mayor a 0';
    end if;

    select (v_doc.total
      - coalesce((select sum(a.monto) from pagos_proveedor_aplicaciones a
                  join pagos_proveedor pg on pg.id = a.pago_id and pg.empresa_id = a.empresa_id
                  where a.documento_id = v_doc.id and a.empresa_id = p_empresa and pg.estado = 'activo'), 0)
    ) into v_saldo;
    if v_monto_app > v_saldo then
      raise exception 'El monto aplicado supera el saldo del documento (saldo: $%)', v_saldo;
    end if;

    insert into pagos_proveedor_aplicaciones (empresa_id, pago_id, documento_id, monto)
    values (p_empresa, v_pago, v_doc.id, v_monto_app);
    v_suma := v_suma + v_monto_app;
  end loop;

  if v_suma <> p_monto then
    raise exception 'La suma de las aplicaciones debe ser igual al monto del pago';
  end if;

  return v_pago;
end $$;
revoke execute on function public.registrar_pago_proveedor(uuid, uuid, date, text, integer, text, text, jsonb) from anon, public;
grant execute on function public.registrar_pago_proveedor(uuid, uuid, date, text, integer, text, text, jsonb) to authenticated;

-- ---------- Anular pago a proveedor ----------
create or replace function public.anular_pago_proveedor(p_empresa uuid, p_pago uuid, p_motivo text)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin']) then
    raise exception 'Tu rol no permite anular pagos a proveedores';
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'La anulación requiere un motivo';
  end if;
  update pagos_proveedor set estado = 'anulado', motivo_anulacion = trim(p_motivo)
  where id = p_pago and empresa_id = p_empresa and estado = 'activo';
  if not found then
    raise exception 'El pago no existe o ya está anulado';
  end if;
end $$;
revoke execute on function public.anular_pago_proveedor(uuid, uuid, text) from anon, public;
grant execute on function public.anular_pago_proveedor(uuid, uuid, text) to authenticated;

-- ---------- Anular factura de compra (bloqueada si tiene pagos activos) ----------
create or replace function public.anular_documento_compra(p_empresa uuid, p_documento uuid, p_motivo text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_estado text;
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin']) then
    raise exception 'Tu rol no permite anular facturas de compra';
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'La anulación requiere un motivo';
  end if;

  -- Lock: una anulacion no puede cruzarse con un pago en vuelo sobre el mismo documento.
  select estado into v_estado from documentos_compra
  where id = p_documento and empresa_id = p_empresa
  for update;
  if not found or v_estado <> 'activa' then
    raise exception 'La factura no existe o ya está anulada';
  end if;
  if exists (
    select 1 from pagos_proveedor_aplicaciones a
    join pagos_proveedor pg on pg.id = a.pago_id and pg.empresa_id = a.empresa_id
    where a.documento_id = p_documento and a.empresa_id = p_empresa and pg.estado = 'activo'
  ) then
    raise exception 'La factura tiene pagos aplicados; anula primero esos pagos';
  end if;

  update documentos_compra set estado = 'anulada', motivo_anulacion = trim(p_motivo)
  where id = p_documento;
end $$;
revoke execute on function public.anular_documento_compra(uuid, uuid, text) from anon, public;
grant execute on function public.anular_documento_compra(uuid, uuid, text) to authenticated;
```

- [ ] **Step 2: Aplicar y verificar**

Run: `pnpm supabase db reset` → aplica 0001-0013 sin errores.
Run: `pnpm supabase test db` → los 88 asserts existentes siguen verdes.
Smoke: `docker exec supabase_db_ERP_Transportes psql -U postgres -d postgres -c "select has_table_privilege('authenticated','public.documentos_compra','insert');"` → **t**; same con `'update'` → **f**; `has_function_privilege('anon','public.registrar_pago_proveedor(uuid,uuid,date,text,integer,text,text,jsonb)','execute')` → **f**.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/00000000000013_por_pagar.sql
git commit -m "feat(db): cuentas por pagar (facturas de proveedor, pagos multi-documento, libro de compras)"
```

---

### Task 2: pgTAP de por pagar

**Files:**
- Create: `supabase/tests/database/por_pagar.test.sql`

**Interfaces:**
- Consumes: migración 0013. RUTs reservados de fixtures: `761111116` (Org A), `762222221` (Org B), `765432103` (proveedor A).

- [ ] **Step 1: Escribir el test**

`supabase/tests/database/por_pagar.test.sql`:

```sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'ana@a.cl'),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'beto@b.cl'),
  ('00000000-0000-0000-0000-000000000000', '77777777-7777-7777-7777-777777777777', 'authenticated', 'authenticated', 'vero@a.cl');

insert into public.organizaciones (id, rut, razon_social)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '761111116', 'Org A'),
       ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '762222221', 'Org B');

insert into public.empresas (id, organizacion_id, rut, razon_social)
values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '761111116', 'Empresa A'),
       ('eeeeeeee-0000-0000-0000-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '762222221', 'Empresa B');

insert into public.miembros (usuario_id, organizacion_id, rol)
values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'dueno'),
       ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'dueno'),
       ('77777777-7777-7777-7777-777777777777', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'vendedor');

-- Proveedor A (condicion 30 dias para el test de vencimiento).
insert into public.proveedores (id, empresa_id, rut, razon_social, condicion_pago_dias)
values ('dddd0000-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '765432103', 'Proveedor A', 30);

-- F2: factura suelta VIEJA (emitida hace 60 dias => vencida), insertada como fixture.
insert into public.documentos_compra (id, empresa_id, proveedor_id, tipo, folio, fecha_emision, neto, exento, iva, total)
values ('f2f2f2f2-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'dddd0000-0000-0000-0000-aaaaaaaaaaaa',
        'factura', 200, current_date - 60, 42017, 0, 7983, 50000);

-- ===== Ana (duena A) =====
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- 1) La duena registra una factura por insert directo (F1, folio 100, 100000).
select lives_ok(
  $$insert into documentos_compra (id, empresa_id, proveedor_id, tipo, folio, fecha_emision, neto, exento, iva, total)
    values ('f1f1f1f1-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'dddd0000-0000-0000-0000-aaaaaaaaaaaa',
            'factura', 100, current_date, 84034, 0, 15966, 100000)$$,
  'la dueña registra una factura de compra'
);

-- 2) Doble digitacion del mismo folio rechazada (23505).
select throws_ok(
  $$insert into documentos_compra (empresa_id, proveedor_id, tipo, folio, fecha_emision, neto, exento, iva, total)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'dddd0000-0000-0000-0000-aaaaaaaaaaaa',
            'factura', 100, current_date, 84034, 0, 15966, 100000)$$,
  '23505', null,
  'no se puede digitar dos veces la misma factura del mismo proveedor'
);

-- ===== Vero (vendedora A): lee pero no escribe =====
set local request.jwt.claims to '{"sub": "77777777-7777-7777-7777-777777777777", "role": "authenticated"}';

-- 3) La vendedora VE las facturas (lectura de miembros).
select is( (select count(*) from documentos_compra), 2::bigint, 'la vendedora ve las facturas de su empresa' );

-- 4) La vendedora NO registra facturas (policy dueno/admin).
select throws_ok(
  $$insert into documentos_compra (empresa_id, proveedor_id, tipo, folio, fecha_emision, neto, exento, iva, total)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'dddd0000-0000-0000-0000-aaaaaaaaaaaa',
            'factura', 300, current_date, 100, 0, 19, 119)$$,
  '42501', 'new row violates row-level security policy for table "documentos_compra"',
  'la vendedora no puede registrar facturas de compra'
);

-- 5) La vendedora NO registra pagos.
select throws_ok(
  $$select registrar_pago_proveedor('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'dddd0000-0000-0000-0000-aaaaaaaaaaaa',
    current_date, 'transferencia', 100, null, null,
    '[{"documentoId":"f1f1f1f1-0000-0000-0000-aaaaaaaaaaaa","monto":100}]'::jsonb)$$,
  'P0001', 'Tu rol no permite registrar pagos a proveedores',
  'la vendedora no puede pagar a proveedores'
);

-- ===== Ana paga =====
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- 6) Pago multi-factura: 120000 = 100000 a F1 + 20000 a F2.
select lives_ok(
  $$select registrar_pago_proveedor('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'dddd0000-0000-0000-0000-aaaaaaaaaaaa',
    current_date, 'transferencia', 120000, 'OP-900', null,
    '[{"documentoId":"f1f1f1f1-0000-0000-0000-aaaaaaaaaaaa","monto":100000},
      {"documentoId":"f2f2f2f2-0000-0000-0000-aaaaaaaaaaaa","monto":20000}]'::jsonb)$$,
  'la dueña paga dos facturas con una transferencia'
);
-- 7) Saldo F1 = 0.
select is( (select saldo from saldos_compras where documento_id = 'f1f1f1f1-0000-0000-0000-aaaaaaaaaaaa'),
  0, 'F1 quedó saldada' );
-- 8) Saldo F2 = 30000.
select is( (select saldo from saldos_compras where documento_id = 'f2f2f2f2-0000-0000-0000-aaaaaaaaaaaa'),
  30000, 'F2 quedó con saldo 30000' );

-- 9) Sobre-pago rechazado con el saldo en el mensaje.
select throws_ok(
  $$select registrar_pago_proveedor('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'dddd0000-0000-0000-0000-aaaaaaaaaaaa',
    current_date, 'efectivo', 40000, null, null,
    '[{"documentoId":"f2f2f2f2-0000-0000-0000-aaaaaaaaaaaa","monto":40000}]'::jsonb)$$,
  'P0001', 'El monto aplicado supera el saldo del documento (saldo: $30000)',
  'no se puede pagar más que el saldo'
);

-- 10) Cuadratura rechazada.
select throws_ok(
  $$select registrar_pago_proveedor('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'dddd0000-0000-0000-0000-aaaaaaaaaaaa',
    current_date, 'efectivo', 100, null, null,
    '[{"documentoId":"f2f2f2f2-0000-0000-0000-aaaaaaaaaaaa","monto":50}]'::jsonb)$$,
  'P0001', 'La suma de las aplicaciones debe ser igual al monto del pago',
  'la cuadratura se valida'
);

-- 11) Anular F1 con pagos activos esta bloqueado.
select throws_ok(
  $$select anular_documento_compra('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'f1f1f1f1-0000-0000-0000-aaaaaaaaaaaa', 'error de digitación')$$,
  'P0001', 'La factura tiene pagos aplicados; anula primero esos pagos',
  'no se anula una factura con pagos activos'
);

-- 12) Ana anula el pago (con motivo).
select lives_ok(
  $$select anular_pago_proveedor('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from pagos_proveedor where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' limit 1), 'Transferencia devuelta')$$,
  'la dueña anula el pago con motivo'
);
-- 13) El saldo de F1 se restaura.
select is( (select saldo from saldos_compras where documento_id = 'f1f1f1f1-0000-0000-0000-aaaaaaaaaaaa'),
  100000, 'anular el pago restaura el saldo de F1' );

-- 14) Ahora F1 (sin pagos activos) SÍ se puede anular.
select lives_ok(
  $$select anular_documento_compra('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'f1f1f1f1-0000-0000-0000-aaaaaaaaaaaa', 'folio mal digitado')$$,
  'la factura sin pagos activos se anula con motivo'
);

-- 15) El libro de compras excluye la anulada (queda solo F2).
select is( (select count(*) from libro_compras), 1::bigint, 'el libro de compras excluye facturas anuladas' );

-- 16) F2 (emitida hace 60 dias, condicion 30) esta vencida.
select ok(
  (select fecha_vencimiento < current_date from saldos_compras where documento_id = 'f2f2f2f2-0000-0000-0000-aaaaaaaaaaaa'),
  'F2 está vencida (60 días desde emisión, condición 30)'
);

-- 17) Beto (org B) no ve nada.
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
select is(
  (select count(*) from saldos_compras) + (select count(*) from libro_compras) + (select count(*) from pagos_proveedor),
  0::bigint, 'Beto no ve cuentas por pagar de la empresa A'
);

-- 18) Anonimo denegado.
set local request.jwt.claims to '{"role": "anon"}';
set local role anon;
select throws_ok(
  'select count(*) from documentos_compra',
  '42501', 'permission denied for table documentos_compra',
  'un anónimo no puede consultar facturas de compra'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Ejecutar**

Run: `pnpm supabase test db`
Expected: 9 archivos, **106 asserts** (aislamiento 6, cobranza 16, compras 19, inventario 10, maestros 10, por_pagar 18, registro 7, reportes 11, ventas 9), todos verdes. Si un assert de por_pagar falla, el sospechoso es la migración de Task 1 — NO debilitar el test (única adaptación permitida: el TEXTO exacto de mensajes de Postgres como el del assert 4 si la versión lo formula distinto; el CÓDIGO es el contrato).

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/database/por_pagar.test.sql
git commit -m "test(db): facturas de proveedor, pagos, anulaciones y libro de compras con pgTAP"
```

---

### Task 3: Regenerar tipos `@suite/db`

**Files:**
- Modify: `packages/db/src/types.ts` (regenerado)

- [ ] **Step 1: Regenerar y verificar**

Run: `pnpm --filter @suite/db gen`
Expected: `types.ts` gana 8 símbolos: tablas `documentos_compra`, `pagos_proveedor`, `pagos_proveedor_aplicaciones`; vistas `saldos_compras`, `libro_compras`; Functions `registrar_pago_proveedor`, `anular_pago_proveedor`, `anular_documento_compra` (verificar por grep; faltante → BLOCKED).

Run: `pnpm tsc --noEmit -p packages/db/tsconfig.json` → sin errores.
Run: `pnpm build --concurrency=1` → 3 apps.

- [ ] **Step 2: Commit**

```bash
git add packages/db/src/types.ts
git commit -m "feat(db): tipos regenerados con cuentas por pagar"
```

---

### Task 4: ERP — CxP + NAV

**Files:**
- Create: `apps/erp/app/por-pagar/page.tsx`
- Modify: `apps/erp/app/layout.tsx` (NAV: `{ href: '/por-pagar', etiqueta: 'Por pagar' },` justo DESPUÉS de Cobranza)

**Interfaces:**
- Consumes: vista `saldos_compras` (columnas: documento_id, tipo, folio, proveedor_id, proveedor_razon_social, fecha_emision, fecha_vencimiento, total, pagado, saldo), `estaVencido`/`formatearCLP` de `@suite/core`. Columnas de vista NULLABLE → `?? 0` guards (precedente cobranza).

- [ ] **Step 1: Página CxP**

`apps/erp/app/por-pagar/page.tsx` (espejo estructural de `apps/erp/app/cobranza/page.tsx` — mismos filtros/totales, adaptado a proveedor):

```tsx
import Link from 'next/link'
import { crearClienteServidor } from '@suite/auth/server'
import { estaVencido, formatearCLP } from '@suite/core'
import { Boton, Encabezado, Insignia, Selector, Tabla, Td, Th, Tr } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'

const HOY = () => new Date().toISOString().slice(0, 10)
const ETIQUETA: Record<string, string> = { factura: 'Factura', factura_exenta: 'Factura exenta' }

export default async function PaginaPorPagar({
  searchParams,
}: {
  searchParams: Promise<{ proveedor?: string; vencidas?: string }>
}) {
  const { proveedor = '', vencidas = '' } = await searchParams
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const supabase = await crearClienteServidor()
  const [{ data: proveedores }, consulta] = await Promise.all([
    supabase.from('proveedores').select('id, razon_social').eq('empresa_id', activa.id).eq('activo', true).order('razon_social'),
    (() => {
      let q = supabase
        .from('saldos_compras')
        .select('documento_id, tipo, folio, proveedor_id, proveedor_razon_social, fecha_emision, fecha_vencimiento, total, pagado, saldo')
        .eq('empresa_id', activa.id)
        .gt('saldo', 0)
        .order('fecha_vencimiento', { ascending: true })
        .limit(200)
      if (proveedor) q = q.eq('proveedor_id', proveedor)
      return q
    })(),
  ])
  const hoy = HOY()
  let filas = consulta.data ?? []
  if (vencidas === '1') filas = filas.filter((f) => estaVencido(f.fecha_vencimiento, hoy, f.saldo ?? 0))
  const porPagar = filas.reduce((s, f) => s + (f.saldo ?? 0), 0)
  const vencido = filas.filter((f) => estaVencido(f.fecha_vencimiento, hoy, f.saldo ?? 0)).reduce((s, f) => s + (f.saldo ?? 0), 0)
  return (
    <div>
      <Encabezado titulo="Cuentas por pagar">
        <div className="flex items-center gap-2">
          <Link href="/por-pagar/facturas"><Boton variante="secundario">Facturas</Boton></Link>
          <Link href="/por-pagar/pagos"><Boton variante="secundario">Pagos</Boton></Link>
          <Link href="/por-pagar/pagos/nuevo"><Boton>Registrar pago</Boton></Link>
        </div>
      </Encabezado>
      <form className="mb-4 flex flex-wrap items-center gap-3" action="/por-pagar" method="get">
        <Selector name="proveedor" defaultValue={proveedor} className="max-w-xs">
          <option value="">Todos los proveedores</option>
          {(proveedores ?? []).map((p) => <option key={p.id} value={p.id}>{p.razon_social}</option>)}
        </Selector>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" name="vencidas" value="1" defaultChecked={vencidas === '1'} /> Solo vencidas
        </label>
        <Boton variante="secundario" type="submit">Filtrar</Boton>
        <Link className="text-sm text-marca-700 hover:underline" href="/por-pagar">Limpiar</Link>
      </form>
      <Tabla>
        <thead><tr><Th>Documento</Th><Th>Proveedor</Th><Th>Emisión</Th><Th>Vencimiento</Th><Th className="text-right">Total</Th><Th className="text-right">Pagado</Th><Th className="text-right">Saldo</Th><Th /></tr></thead>
        <tbody>
          {filas.map((f) => {
            const venc = estaVencido(f.fecha_vencimiento, hoy, f.saldo ?? 0)
            return (
              <Tr key={f.documento_id}>
                <Td>{ETIQUETA[f.tipo ?? ''] ?? f.tipo} {f.folio}</Td>
                <Td>{f.proveedor_razon_social}</Td>
                <Td>{f.fecha_emision ? new Date(f.fecha_emision + 'T00:00:00').toLocaleDateString('es-CL') : '—'}</Td>
                <Td>{f.fecha_vencimiento ? new Date(f.fecha_vencimiento + 'T00:00:00').toLocaleDateString('es-CL') : '—'}</Td>
                <Td className="text-right font-mono">{formatearCLP(f.total ?? 0)}</Td>
                <Td className="text-right font-mono">{formatearCLP(f.pagado ?? 0)}</Td>
                <Td className="text-right font-mono">{formatearCLP(f.saldo ?? 0)}</Td>
                <Td>{venc && <Insignia tono="rojo">Vencida</Insignia>}</Td>
              </Tr>
            )
          })}
          {filas.length === 0 && <Tr><Td colSpan={8} className="py-8 text-center text-slate-500">No hay facturas con saldo {proveedor || vencidas ? 'que coincidan' : 'pendiente'}.</Td></Tr>}
        </tbody>
      </Tabla>
      <div className="mt-3 flex justify-end gap-6 text-sm">
        <span>Por pagar: <strong className="font-mono">{formatearCLP(porPagar)}</strong></span>
        <span className="text-red-600">Vencido: <strong className="font-mono">{formatearCLP(vencido)}</strong></span>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verificar y commit**

Run: `pnpm --filter erp build` → sin errores (links a `/por-pagar/facturas|pagos*` 404ean hasta Tasks 5-6 — transitorio esperado).

```bash
git add apps/erp/app/por-pagar apps/erp/app/layout.tsx
git commit -m "feat(erp): cuentas por pagar con saldos y vencimientos"
```

---

### Task 5: ERP — facturas de compra (lista + registro + anulación)

**Files:**
- Create: `apps/erp/app/por-pagar/acciones.ts`, `apps/erp/app/por-pagar/facturas/page.tsx`, `apps/erp/app/por-pagar/facturas/nueva/page.tsx`, `apps/erp/componentes/formulario-factura-compra.tsx`, `apps/erp/componentes/formulario-anular-compra.tsx`

**Interfaces:**
- Consumes: `documentos_compra` (insert directo RLS), RPC `anular_documento_compra`, `ordenes_compra` (selector opcional), `EstadoForm`, `calcularIVA`? NO — el IVA sugerido se calcula inline (`Math.round(neto * 0.19)`).
- Produces: Server Actions `registrarFacturaCompra(prev, formData): Promise<EstadoForm>` y `anularFacturaCompra(prev, formData): Promise<EstadoForm>`; componente `FormularioAnularCompra` (motivo inline, mismo patrón que `formulario-anular.tsx` de cobranza pero llamando la action de compra).

- [ ] **Step 1: Server Actions**

`apps/erp/app/por-pagar/acciones.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import type { EstadoForm } from '../tipos'

const TIPOS = ['factura', 'factura_exenta'] as const
const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/

export async function registrarFacturaCompra(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const proveedor = String(formData.get('proveedor_id') ?? '')
  const tipo = String(formData.get('tipo') ?? '')
  const folio = Math.trunc(Number(String(formData.get('folio') ?? '').trim()))
  const fecha = String(formData.get('fecha_emision') ?? '').trim()
  const orden = String(formData.get('orden_id') ?? '')
  const notas = String(formData.get('notas') ?? '').trim()
  const neto = Math.trunc(Number(String(formData.get('neto') ?? '0').trim()))
  const exento = Math.trunc(Number(String(formData.get('exento') ?? '0').trim()))
  const iva = Math.trunc(Number(String(formData.get('iva') ?? '0').trim()))
  const total = Math.trunc(Number(String(formData.get('total') ?? '0').trim()))

  if (!proveedor) return { error: 'Selecciona un proveedor' }
  if (!(TIPOS as readonly string[]).includes(tipo)) return { error: 'Selecciona el tipo de documento' }
  if (!Number.isInteger(folio) || folio < 1) return { error: 'El folio debe ser un entero mayor a 0' }
  if (!FECHA_ISO.test(fecha)) return { error: 'Ingresa la fecha de emisión' }
  for (const [nombre, v] of [['neto', neto], ['exento', exento], ['IVA', iva], ['total', total]] as const) {
    if (!Number.isInteger(v) || v < 0) return { error: `El ${nombre} debe ser un entero mayor o igual a 0` }
  }
  if (total !== neto + exento + iva) return { error: 'El total no cuadra: debe ser neto + exento + IVA' }

  const supabase = await crearClienteServidor()
  const { error } = await supabase.from('documentos_compra').insert({
    empresa_id: activa.id,
    proveedor_id: proveedor,
    tipo,
    folio,
    fecha_emision: fecha,
    neto,
    exento,
    iva,
    total,
    orden_id: orden || null,
    notas: notas || null,
  })
  if (error) {
    if (error.code === '23505') return { error: 'Ya registraste esa factura de ese proveedor' }
    if (error.code === '42501') return { error: 'Tu rol no permite registrar facturas de compra' }
    return { error: 'No se pudo registrar la factura' }
  }
  revalidatePath('/por-pagar')
  revalidatePath('/por-pagar/facturas')
  redirect('/por-pagar/facturas')
}

export async function anularFacturaCompra(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  const documento = String(formData.get('documento_id') ?? '')
  const motivo = String(formData.get('motivo') ?? '').trim()
  if (!documento) return { error: 'Documento no válido' }
  if (motivo === '') return { error: 'La anulación requiere un motivo' }
  const supabase = await crearClienteServidor()
  const { error } = await supabase.rpc('anular_documento_compra', { p_empresa: activa.id, p_documento: documento, p_motivo: motivo })
  if (error) {
    if (error.message.includes('rol')) return { error: 'Tu rol no permite anular facturas de compra' }
    if (error.message.includes('pagos aplicados')) return { error: 'La factura tiene pagos aplicados; anula primero esos pagos' }
    if (error.message.includes('anulada')) return { error: 'La factura no existe o ya está anulada' }
    return { error: 'No se pudo anular la factura' }
  }
  revalidatePath('/por-pagar')
  revalidatePath('/por-pagar/facturas')
  return {}
}
```

- [ ] **Step 2: Formulario de factura (client, cuadre en vivo)**

`apps/erp/componentes/formulario-factura-compra.tsx`:

```tsx
'use client'

import { useActionState, useState } from 'react'
import { Boton, Campo, Entrada, Selector, Tarjeta } from '@suite/ui'
import { formatearCLP } from '@suite/core'
import type { EstadoForm } from '../app/tipos'

interface ProveedorOpcion { id: string; razon_social: string }
interface OrdenOpcion { id: string; numero: number; proveedorId: string }

export function FormularioFacturaCompra({
  accion,
  proveedores,
  ordenes,
}: {
  accion: (prev: EstadoForm, formData: FormData) => Promise<EstadoForm>
  proveedores: ProveedorOpcion[]
  ordenes: OrdenOpcion[]
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoForm)
  const [proveedor, setProveedor] = useState('')
  const [neto, setNeto] = useState(0)
  const [exento, setExento] = useState(0)
  const [iva, setIva] = useState(0)
  const [total, setTotal] = useState(0)
  const entero = (v: string) => Math.max(0, Math.trunc(Number(v)) || 0)
  const cuadra = total === neto + exento + iva
  const ivaSugerido = Math.round(neto * 0.19)
  const ordenesDelProveedor = ordenes.filter((o) => o.proveedorId === proveedor)

  return (
    <Tarjeta className="max-w-2xl">
      <form action={enviar} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Campo etiqueta="Proveedor *">
          <Selector name="proveedor_id" required value={proveedor}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setProveedor(e.currentTarget.value)}>
            <option value="" disabled>Selecciona…</option>
            {proveedores.map((p) => <option key={p.id} value={p.id}>{p.razon_social}</option>)}
          </Selector>
        </Campo>
        <Campo etiqueta="Tipo *">
          <Selector name="tipo" required defaultValue="factura">
            <option value="factura">Factura (33)</option>
            <option value="factura_exenta">Factura exenta (34)</option>
          </Selector>
        </Campo>
        <Campo etiqueta="Folio *"><Entrada name="folio" inputMode="numeric" required /></Campo>
        <Campo etiqueta="Fecha de emisión *"><Entrada type="date" name="fecha_emision" required /></Campo>
        <Campo etiqueta="Neto">
          <Entrada name="neto" inputMode="numeric" value={neto}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNeto(entero(e.currentTarget.value))} />
        </Campo>
        <Campo etiqueta="Exento">
          <Entrada name="exento" inputMode="numeric" value={exento}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setExento(entero(e.currentTarget.value))} />
        </Campo>
        <Campo etiqueta={`IVA (sugerido: ${formatearCLP(ivaSugerido)})`}>
          <Entrada name="iva" inputMode="numeric" value={iva}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setIva(entero(e.currentTarget.value))} />
        </Campo>
        <Campo etiqueta="Total *">
          <Entrada name="total" inputMode="numeric" value={total}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTotal(entero(e.currentTarget.value))} />
        </Campo>
        <Campo etiqueta="Orden de compra (opcional)">
          <Selector name="orden_id" defaultValue="" disabled={!proveedor}>
            <option value="">Sin orden asociada</option>
            {ordenesDelProveedor.map((o) => <option key={o.id} value={o.id}>OC {o.numero}</option>)}
          </Selector>
        </Campo>
        <Campo etiqueta="Notas"><Entrada name="notas" /></Campo>
        <div className="flex items-center justify-end gap-3 sm:col-span-2">
          {!cuadra && total > 0 && <span className="mr-auto text-sm text-red-600">El total no cuadra (neto + exento + IVA = {formatearCLP(neto + exento + iva)})</span>}
          {estado.error && cuadra && <span className="mr-auto text-sm text-red-600">{estado.error}</span>}
          <Boton type="submit" disabled={pendiente || !cuadra || total === 0}>{pendiente ? 'Registrando…' : 'Registrar factura'}</Boton>
        </div>
      </form>
    </Tarjeta>
  )
}
```

`apps/erp/componentes/formulario-anular-compra.tsx`:

```tsx
'use client'

import { useActionState, useState } from 'react'
import { Boton, Entrada } from '@suite/ui'
import { anularFacturaCompra } from '../app/por-pagar/acciones'
import type { EstadoForm } from '../app/tipos'

export function FormularioAnularCompra({ documentoId }: { documentoId: string }) {
  const [abierto, setAbierto] = useState(false)
  const [estado, enviar, pendiente] = useActionState(anularFacturaCompra, {} as EstadoForm)
  if (!abierto) {
    return <Boton variante="secundario" type="button" className="px-2 py-1 text-xs" onClick={() => setAbierto(true)}>Anular</Boton>
  }
  return (
    <form action={enviar} className="flex items-center gap-2">
      <input type="hidden" name="documento_id" value={documentoId} />
      <Entrada name="motivo" placeholder="Motivo *" required className="w-40 text-xs" />
      <Boton variante="secundario" type="submit" disabled={pendiente} className="px-2 py-1 text-xs">{pendiente ? '…' : 'Confirmar'}</Boton>
      {estado.error && <span className="text-xs text-red-600">{estado.error}</span>}
    </form>
  )
}
```

- [ ] **Step 3: Páginas lista y nueva**

`apps/erp/app/por-pagar/facturas/page.tsx`:

```tsx
import Link from 'next/link'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP } from '@suite/core'
import { Boton, Encabezado, Insignia, Tabla, Td, Th, Tr } from '@suite/ui'
import { FormularioAnularCompra } from '../../../componentes/formulario-anular-compra'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'

const ETIQUETA: Record<string, string> = { factura: 'Factura', factura_exenta: 'Factura exenta' }

export default async function PaginaFacturasCompra() {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const supabase = await crearClienteServidor()
  const { data: facturas } = await supabase
    .from('documentos_compra')
    .select('id, tipo, folio, fecha_emision, total, estado, motivo_anulacion, proveedores (razon_social), ordenes_compra (numero)')
    .eq('empresa_id', activa.id)
    .order('creado_en', { ascending: false })
    .limit(100)
  return (
    <div>
      <Encabezado titulo="Facturas de compra">
        <Link href="/por-pagar/facturas/nueva"><Boton>Registrar factura</Boton></Link>
      </Encabezado>
      <Tabla>
        <thead><tr><Th>Documento</Th><Th>Proveedor</Th><Th>Emisión</Th><Th>OC</Th><Th className="text-right">Total</Th><Th>Estado</Th><Th /></tr></thead>
        <tbody>
          {(facturas ?? []).map((f) => (
            <Tr key={f.id}>
              <Td>{ETIQUETA[f.tipo] ?? f.tipo} {f.folio}</Td>
              <Td>{f.proveedores?.razon_social ?? '—'}</Td>
              <Td>{new Date(f.fecha_emision + 'T00:00:00').toLocaleDateString('es-CL')}</Td>
              <Td>{f.ordenes_compra?.numero ? `OC ${f.ordenes_compra.numero}` : '—'}</Td>
              <Td className="text-right font-mono">{formatearCLP(f.total)}</Td>
              <Td>{f.estado === 'activa' ? <Insignia tono="verde">Activa</Insignia> : <Insignia tono="rojo">Anulada</Insignia>}</Td>
              <Td>{f.estado === 'activa' ? <FormularioAnularCompra documentoId={f.id} /> : <span className="text-xs text-slate-400">{f.motivo_anulacion}</span>}</Td>
            </Tr>
          ))}
          {(facturas ?? []).length === 0 && <Tr><Td colSpan={7} className="py-8 text-center text-slate-500">No hay facturas registradas.</Td></Tr>}
        </tbody>
      </Tabla>
    </div>
  )
}
```

`apps/erp/app/por-pagar/facturas/nueva/page.tsx`:

```tsx
import { crearClienteServidor } from '@suite/auth/server'
import { Encabezado } from '@suite/ui'
import { FormularioFacturaCompra } from '../../../../componentes/formulario-factura-compra'
import { obtenerEmpresaActiva } from '../../../../lib/empresa-activa'
import { registrarFacturaCompra } from '../../acciones'

export default async function NuevaFacturaCompra() {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const supabase = await crearClienteServidor()
  const [{ data: proveedores }, { data: ordenes }] = await Promise.all([
    supabase.from('proveedores').select('id, razon_social').eq('empresa_id', activa.id).eq('activo', true).order('razon_social'),
    supabase.from('ordenes_compra').select('id, numero, proveedor_id').eq('empresa_id', activa.id).neq('estado', 'cancelada').order('numero', { ascending: false }).limit(200),
  ])
  return (
    <div>
      <Encabezado titulo="Registrar factura de compra" />
      <FormularioFacturaCompra
        accion={registrarFacturaCompra}
        proveedores={(proveedores ?? []).map((p) => ({ id: p.id, razon_social: p.razon_social }))}
        ordenes={(ordenes ?? []).map((o) => ({ id: o.id, numero: o.numero, proveedorId: o.proveedor_id }))}
      />
    </div>
  )
}
```

- [ ] **Step 4: Verificar y commit**

Run: `pnpm --filter erp build` → sin errores.

```bash
git add apps/erp/app/por-pagar apps/erp/componentes/formulario-factura-compra.tsx apps/erp/componentes/formulario-anular-compra.tsx
git commit -m "feat(erp): registro y anulación de facturas de compra con vínculo opcional a OC"
```

---

### Task 6: ERP — pagos a proveedor (registro + historial + anulación)

**Files:**
- Create: `apps/erp/app/por-pagar/pagos/page.tsx`, `apps/erp/app/por-pagar/pagos/nuevo/page.tsx`, `apps/erp/componentes/formulario-pago-proveedor.tsx`, `apps/erp/componentes/formulario-anular-pago-proveedor.tsx`
- Modify: `apps/erp/app/por-pagar/acciones.ts` (agregar `registrarPagoProveedor` y `anularPagoProveedor`)

**Interfaces:**
- Consumes: RPCs `registrar_pago_proveedor`/`anular_pago_proveedor`, vista `saldos_compras`, `cuadraAplicaciones`/`formatearCLP` de `@suite/core`. Casts jsonb/no-null si el codegen los exige (precedente cobranza).

- [ ] **Step 1: Server Actions (agregar al final de acciones.ts)**

```ts
type AplicacionEntrada = { documentoId: string; monto: number }

const METODOS = ['efectivo', 'transferencia', 'tarjeta', 'cheque', 'otro'] as const

export async function registrarPagoProveedor(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const proveedor = String(formData.get('proveedor_id') ?? '')
  const metodo = String(formData.get('metodo') ?? '')
  const fecha = String(formData.get('fecha') ?? '').trim()
  const referencia = String(formData.get('referencia') ?? '').trim()
  const notas = String(formData.get('notas') ?? '').trim()
  const monto = Math.trunc(Number(String(formData.get('monto') ?? '').trim()))
  if (!proveedor) return { error: 'Selecciona un proveedor' }
  if (!(METODOS as readonly string[]).includes(metodo)) return { error: 'Selecciona un método de pago' }
  if (!Number.isInteger(monto) || monto <= 0) return { error: 'El monto debe ser un entero mayor a 0' }

  let aplicaciones: AplicacionEntrada[]
  try {
    aplicaciones = (JSON.parse(String(formData.get('aplicaciones') ?? '[]')) as AplicacionEntrada[]).filter((a) => a.monto > 0)
  } catch {
    return { error: 'Las aplicaciones del pago no son válidas' }
  }
  if (aplicaciones.length === 0) return { error: 'Aplica el pago a al menos un documento' }
  for (const a of aplicaciones) {
    if (!a.documentoId || !Number.isInteger(a.monto) || a.monto < 1) {
      return { error: 'Cada aplicación necesita documento y monto entero mayor a 0' }
    }
  }

  const supabase = await crearClienteServidor()
  const { error } = await supabase.rpc('registrar_pago_proveedor', {
    p_empresa: activa.id,
    p_proveedor: proveedor,
    p_fecha: fecha || null,
    p_metodo: metodo,
    p_monto: monto,
    p_referencia: referencia || null,
    p_notas: notas || null,
    p_aplicaciones: aplicaciones.map((a) => ({ documentoId: a.documentoId, monto: a.monto })),
  })
  if (error) {
    if (error.message.includes('rol')) return { error: 'Tu rol no permite registrar pagos a proveedores' }
    if (error.message.includes('saldo')) return { error: error.message }
    if (error.message.includes('suma')) return { error: 'La suma de las aplicaciones debe ser igual al monto del pago' }
    if (error.message.includes('válido')) return { error: 'Hay un documento no válido o de otro proveedor' }
    return { error: 'No se pudo registrar el pago' }
  }
  revalidatePath('/por-pagar')
  revalidatePath('/por-pagar/pagos')
  redirect('/por-pagar')
}

export async function anularPagoProveedor(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  const pago = String(formData.get('pago_id') ?? '')
  const motivo = String(formData.get('motivo') ?? '').trim()
  if (!pago) return { error: 'Pago no válido' }
  if (motivo === '') return { error: 'La anulación requiere un motivo' }
  const supabase = await crearClienteServidor()
  const { error } = await supabase.rpc('anular_pago_proveedor', { p_empresa: activa.id, p_pago: pago, p_motivo: motivo })
  if (error) {
    if (error.message.includes('rol')) return { error: 'Tu rol no permite anular pagos a proveedores' }
    if (error.message.includes('anulado')) return { error: 'El pago no existe o ya está anulado' }
    return { error: 'No se pudo anular el pago' }
  }
  revalidatePath('/por-pagar')
  revalidatePath('/por-pagar/pagos')
  return {}
}
```

(Nota de casts jsonb/no-null: mismo precedente que `apps/erp/app/cobranza/acciones.ts` si el codegen los exige.)

- [ ] **Step 2: Formularios (client)**

`apps/erp/componentes/formulario-pago-proveedor.tsx` — copia estructural de `formulario-pago.tsx` de cobranza (mismos estados/clamps/cuadratura en vivo), con `proveedor_id` en vez de `cliente_id` y llamando la action de proveedor. Código completo:

```tsx
'use client'

import { useActionState, useState } from 'react'
import { Boton, Campo, Entrada, Selector, Tabla, Tarjeta, Td, Th, Tr } from '@suite/ui'
import { cuadraAplicaciones, formatearCLP } from '@suite/core'
import type { EstadoForm } from '../app/tipos'

interface DocumentoConSaldo { documentoId: string; etiqueta: string; saldo: number }

export function FormularioPagoProveedor({
  accion,
  proveedorId,
  documentos,
}: {
  accion: (prev: EstadoForm, formData: FormData) => Promise<EstadoForm>
  proveedorId: string
  documentos: DocumentoConSaldo[]
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoForm)
  const [montos, setMontos] = useState<Record<string, number>>(
    Object.fromEntries(documentos.map((d) => [d.documentoId, Math.max(0, d.saldo)]))
  )
  const [monto, setMonto] = useState(() => documentos.reduce((s, d) => s + Math.max(0, d.saldo), 0))

  function cambiar(id: string, max: number, valor: number) {
    setMontos((m) => ({ ...m, [id]: Math.min(max, Math.max(0, Math.trunc(valor) || 0)) }))
  }

  const aplicaciones = documentos
    .map((d) => ({ documentoId: d.documentoId, monto: montos[d.documentoId] ?? 0 }))
    .filter((a) => a.monto > 0)
  const aplicado = aplicaciones.reduce((s, a) => s + a.monto, 0)
  const cuadra = cuadraAplicaciones(aplicaciones, monto)

  return (
    <form action={enviar}>
      <input type="hidden" name="proveedor_id" value={proveedorId} />
      <input type="hidden" name="aplicaciones" value={JSON.stringify(aplicaciones)} />
      <Tarjeta className="mb-4 max-w-3xl">
        <div className="flex flex-wrap items-end gap-3">
          <Campo etiqueta="Monto del pago *">
            <Entrada name="monto" inputMode="numeric" value={monto}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMonto(Math.max(0, Math.trunc(Number(e.currentTarget.value)) || 0))} />
          </Campo>
          <Campo etiqueta="Método *">
            <Selector name="metodo" required defaultValue="transferencia">
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia</option>
              <option value="tarjeta">Tarjeta</option>
              <option value="cheque">Cheque</option>
              <option value="otro">Otro</option>
            </Selector>
          </Campo>
          <Campo etiqueta="Fecha"><Entrada type="date" name="fecha" /></Campo>
          <Campo etiqueta="Referencia"><Entrada name="referencia" placeholder="N° operación / cheque" /></Campo>
          <Campo etiqueta="Notas"><Entrada name="notas" /></Campo>
        </div>
      </Tarjeta>

      <Tabla>
        <thead><tr><Th>Documento</Th><Th className="text-right">Saldo</Th><Th className="text-right">Aplicar</Th></tr></thead>
        <tbody>
          {documentos.map((d) => (
            <Tr key={d.documentoId}>
              <Td>{d.etiqueta}</Td>
              <Td className="text-right font-mono">{formatearCLP(d.saldo)}</Td>
              <Td className="text-right">
                <Entrada type="number" min={0} max={Math.max(0, d.saldo)} value={montos[d.documentoId] ?? 0}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => cambiar(d.documentoId, Math.max(0, d.saldo), Number(e.currentTarget.value))}
                  className="w-28 text-right" />
              </Td>
            </Tr>
          ))}
        </tbody>
      </Tabla>

      <div className="mt-3 flex items-center justify-end gap-4 text-sm">
        <span>Aplicado: <strong className="font-mono">{formatearCLP(aplicado)}</strong> de <strong className="font-mono">{formatearCLP(monto)}</strong></span>
        {!cuadra && aplicado > 0 && <span className="text-red-600">La suma aplicada debe igualar el monto</span>}
      </div>
      <div className="mt-4 flex items-center justify-end gap-2">
        {estado.error && <span className="mr-auto text-sm text-red-600">{estado.error}</span>}
        <Boton type="submit" disabled={pendiente || monto <= 0 || !cuadra}>{pendiente ? 'Registrando…' : 'Registrar pago'}</Boton>
      </div>
    </form>
  )
}
```

`apps/erp/componentes/formulario-anular-pago-proveedor.tsx` — copia de `formulario-anular.tsx` llamando `anularPagoProveedor` con `pago_id` (código idéntico salvo import y nombre: transcribir con esos dos cambios).

```tsx
'use client'

import { useActionState, useState } from 'react'
import { Boton, Entrada } from '@suite/ui'
import { anularPagoProveedor } from '../app/por-pagar/acciones'
import type { EstadoForm } from '../app/tipos'

export function FormularioAnularPagoProveedor({ pagoId }: { pagoId: string }) {
  const [abierto, setAbierto] = useState(false)
  const [estado, enviar, pendiente] = useActionState(anularPagoProveedor, {} as EstadoForm)
  if (!abierto) {
    return <Boton variante="secundario" type="button" className="px-2 py-1 text-xs" onClick={() => setAbierto(true)}>Anular</Boton>
  }
  return (
    <form action={enviar} className="flex items-center gap-2">
      <input type="hidden" name="pago_id" value={pagoId} />
      <Entrada name="motivo" placeholder="Motivo *" required className="w-40 text-xs" />
      <Boton variante="secundario" type="submit" disabled={pendiente} className="px-2 py-1 text-xs">{pendiente ? '…' : 'Confirmar'}</Boton>
      {estado.error && <span className="text-xs text-red-600">{estado.error}</span>}
    </form>
  )
}
```

- [ ] **Step 3: Páginas**

`apps/erp/app/por-pagar/pagos/nuevo/page.tsx` (proveedor por GET, espejo de cobranza):

```tsx
import { crearClienteServidor } from '@suite/auth/server'
import { Boton, Campo, Encabezado, Selector, Tarjeta } from '@suite/ui'
import { FormularioPagoProveedor } from '../../../../componentes/formulario-pago-proveedor'
import { obtenerEmpresaActiva } from '../../../../lib/empresa-activa'
import { registrarPagoProveedor } from '../../acciones'

const ETIQUETA: Record<string, string> = { factura: 'Factura', factura_exenta: 'Factura exenta' }

export default async function NuevoPagoProveedor({ searchParams }: { searchParams: Promise<{ proveedor?: string }> }) {
  const { proveedor = '' } = await searchParams
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const supabase = await crearClienteServidor()
  const { data: proveedores } = await supabase
    .from('proveedores').select('id, razon_social').eq('empresa_id', activa.id).eq('activo', true).order('razon_social')
  const { data: saldos } = proveedor
    ? await supabase
        .from('saldos_compras')
        .select('documento_id, tipo, folio, saldo')
        .eq('empresa_id', activa.id).eq('proveedor_id', proveedor).gt('saldo', 0)
        .order('fecha_vencimiento', { ascending: true })
    : { data: null }
  return (
    <div>
      <Encabezado titulo="Registrar pago a proveedor" />
      <Tarjeta className="mb-4 max-w-xl">
        <form action="/por-pagar/pagos/nuevo" method="get" className="flex items-end gap-3">
          <Campo etiqueta="Proveedor *">
            <Selector name="proveedor" defaultValue={proveedor} required>
              <option value="" disabled>Selecciona…</option>
              {(proveedores ?? []).map((p) => <option key={p.id} value={p.id}>{p.razon_social}</option>)}
            </Selector>
          </Campo>
          <Boton variante="secundario" type="submit">Ver facturas</Boton>
        </form>
      </Tarjeta>
      {proveedor && (saldos ?? []).length === 0 && (
        <p className="text-sm text-slate-500">Este proveedor no tiene facturas con saldo pendiente.</p>
      )}
      {proveedor && (saldos ?? []).length > 0 && (
        <FormularioPagoProveedor
          accion={registrarPagoProveedor}
          proveedorId={proveedor}
          documentos={(saldos ?? []).map((s) => ({
            documentoId: s.documento_id ?? '',
            etiqueta: `${ETIQUETA[s.tipo ?? ''] ?? s.tipo} ${s.folio ?? '—'}`,
            saldo: s.saldo ?? 0,
          }))}
        />
      )}
    </div>
  )
}
```

`apps/erp/app/por-pagar/pagos/page.tsx` (historial, espejo de cobranza):

```tsx
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP } from '@suite/core'
import { Encabezado, Insignia, Tabla, Td, Th, Tr } from '@suite/ui'
import { FormularioAnularPagoProveedor } from '../../../componentes/formulario-anular-pago-proveedor'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'

const METODO: Record<string, string> = { efectivo: 'Efectivo', transferencia: 'Transferencia', tarjeta: 'Tarjeta', cheque: 'Cheque', otro: 'Otro' }

export default async function PaginaPagosProveedor() {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const supabase = await crearClienteServidor()
  const { data: pagos } = await supabase
    .from('pagos_proveedor')
    .select('id, fecha, metodo, monto, referencia, estado, motivo_anulacion, proveedores (razon_social), pagos_proveedor_aplicaciones (monto, documentos_compra (tipo, folio))')
    .eq('empresa_id', activa.id)
    .order('creado_en', { ascending: false })
    .limit(100)
  return (
    <div>
      <Encabezado titulo="Pagos a proveedores" />
      <Tabla>
        <thead><tr><Th>Fecha</Th><Th>Proveedor</Th><Th>Método</Th><Th className="text-right">Monto</Th><Th>Aplicado a</Th><Th>Estado</Th><Th /></tr></thead>
        <tbody>
          {(pagos ?? []).map((p) => (
            <Tr key={p.id}>
              <Td>{new Date(p.fecha + 'T00:00:00').toLocaleDateString('es-CL')}</Td>
              <Td>{p.proveedores?.razon_social ?? '—'}</Td>
              <Td>{METODO[p.metodo] ?? p.metodo}{p.referencia ? ` · ${p.referencia}` : ''}</Td>
              <Td className="text-right font-mono">{formatearCLP(p.monto)}</Td>
              <Td className="text-sm">
                {(p.pagos_proveedor_aplicaciones ?? []).map((a, i) => (
                  <span key={i} className="mr-2">F{a.documentos_compra?.folio ?? '—'}: {formatearCLP(a.monto)}</span>
                ))}
              </Td>
              <Td>{p.estado === 'activo' ? <Insignia tono="verde">Activo</Insignia> : <Insignia tono="rojo">Anulado</Insignia>}</Td>
              <Td>{p.estado === 'activo' ? <FormularioAnularPagoProveedor pagoId={p.id} /> : <span className="text-xs text-slate-400">{p.motivo_anulacion}</span>}</Td>
            </Tr>
          ))}
          {(pagos ?? []).length === 0 && <Tr><Td colSpan={7} className="py-8 text-center text-slate-500">No hay pagos registrados.</Td></Tr>}
        </tbody>
      </Tabla>
    </div>
  )
}
```

- [ ] **Step 4: Verificar y commit**

Run: `pnpm --filter erp build` → sin errores.

```bash
git add apps/erp/app/por-pagar apps/erp/componentes/formulario-pago-proveedor.tsx apps/erp/componentes/formulario-anular-pago-proveedor.tsx
git commit -m "feat(erp): pagos a proveedores multi-factura con anulación"
```

---

### Task 7: ERP — estado de cuenta del proveedor + libro de compras en Reportes

**Files:**
- Modify: `apps/erp/app/inventario/proveedores/[id]/page.tsx` (sección "Estado de cuenta")
- Modify: `apps/erp/app/reportes/page.tsx` (4ª tarjeta)
- Create: `apps/erp/app/reportes/libro-compras/page.tsx`, `apps/erp/app/reportes/libro-compras/export/route.ts`

**Interfaces:**
- Consumes: vistas `saldos_compras`/`libro_compras`, `pagos_proveedor`, `filasACsv`/`rangoDeMes`/`formatearCLP`/`formatearRut` de `@suite/core`.

- [ ] **Step 1: Estado de cuenta del proveedor**

En `apps/erp/app/inventario/proveedores/[id]/page.tsx` (LEER primero; hoy: carga `prov` + `notFound()` + `<FormularioProveedor>`): agregar tras el notFound las consultas y tras el formulario la sección — espejo EXACTO del estado de cuenta de cliente (`apps/erp/app/clientes/[id]/page.tsx`, sección agregada en Plan 6 — usarla como referencia visual). Importar `formatearCLP` de `@suite/core` y `Tarjeta` de `@suite/ui`.

Consultas (tras `if (!prov) notFound()`):

```tsx
  const [{ data: saldos }, { data: pagos }] = await Promise.all([
    supabase
      .from('saldos_compras')
      .select('documento_id, tipo, folio, total, pagado, saldo, fecha_vencimiento')
      .eq('empresa_id', activa.id).eq('proveedor_id', id).gt('saldo', 0)
      .order('fecha_vencimiento', { ascending: true }),
    supabase
      .from('pagos_proveedor')
      .select('id, fecha, metodo, monto, estado')
      .eq('empresa_id', activa.id).eq('proveedor_id', id)
      .order('creado_en', { ascending: false }).limit(20),
  ])
  const deuda = (saldos ?? []).reduce((s, d) => s + Math.max(0, d.saldo ?? 0), 0)
```

Sección JSX (tras `<FormularioProveedor …/>`, dentro del div raíz):

```tsx
      <div className="mt-6 max-w-2xl">
        <h2 className="mb-2 text-lg font-semibold text-slate-800">Estado de cuenta</h2>
        <Tarjeta>
          <p className="mb-2 text-sm">Deuda vigente: <strong className="font-mono">{formatearCLP(deuda)}</strong></p>
          <ul className="space-y-1 text-sm">
            {(saldos ?? []).map((d) => (
              <li key={d.documento_id} className="flex justify-between">
                <span>{d.tipo === 'factura' ? 'Factura' : 'Factura exenta'} {d.folio} · vence {d.fecha_vencimiento ? new Date(d.fecha_vencimiento + 'T00:00:00').toLocaleDateString('es-CL') : '—'}</span>
                <span className="font-mono">{formatearCLP(d.saldo ?? 0)}</span>
              </li>
            ))}
            {(saldos ?? []).length === 0 && <li className="text-slate-500">Sin facturas con saldo pendiente.</li>}
          </ul>
          {(pagos ?? []).length > 0 && (
            <>
              <p className="mb-1 mt-4 text-sm font-medium text-slate-700">Últimos pagos</p>
              <ul className="space-y-1 text-sm">
                {(pagos ?? []).map((p) => (
                  <li key={p.id} className="flex justify-between">
                    <span>{new Date(p.fecha + 'T00:00:00').toLocaleDateString('es-CL')} · {p.metodo}{p.estado === 'anulado' ? ' (anulado)' : ''}</span>
                    <span className="font-mono">{formatearCLP(p.monto)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Tarjeta>
      </div>
```

- [ ] **Step 2: Libro de compras en Reportes**

En `apps/erp/app/reportes/page.tsx`, agregar a `SECCIONES` (tras "Libro de ventas"):

```tsx
  { href: '/reportes/libro-compras', titulo: 'Libro de compras', desc: 'Formato SII por mes, con IVA crédito y export CSV' },
```

(Y el grid pasa de `sm:grid-cols-3` a `sm:grid-cols-2 lg:grid-cols-4`.)

`apps/erp/app/reportes/libro-compras/page.tsx` — espejo EXACTO de `apps/erp/app/reportes/libro-ventas/page.tsx` (leerla como referencia) con: vista `libro_compras`, columnas RUT/razón social del PROVEEDOR, etiquetas `{ factura: 'Factura', factura_exenta: 'Factura exenta' }`, título "Libro de compras", header de IVA "IVA crédito", export a `/reportes/libro-compras/export?mes=…`, orden `.order('fecha').order('folio')`. Código completo:

```tsx
import Link from 'next/link'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP, formatearRut, rangoDeMes } from '@suite/core'
import { Boton, Encabezado, Entrada, Tabla, Td, Th, Tr } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'

const ETIQUETA: Record<string, string> = { factura: 'Factura', factura_exenta: 'Factura exenta' }

export default async function PaginaLibroCompras({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const { mes = '' } = await searchParams
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const mesActual = new Date().toISOString().slice(0, 7)
  const mesElegido = rangoDeMes(mes) ? mes : mesActual
  const rango = rangoDeMes(mesElegido)!
  const supabase = await crearClienteServidor()
  const { data } = await supabase
    .from('libro_compras')
    .select('documento_id, fecha, tipo, folio, rut_proveedor, razon_social_proveedor, neto, exento, iva, total')
    .eq('empresa_id', activa.id)
    .gte('fecha', rango.desde)
    .lte('fecha', rango.hasta)
    .order('fecha')
    .order('folio')
  const filas = data ?? []
  const tot = filas.reduce(
    (a, f) => ({ neto: a.neto + (f.neto ?? 0), exento: a.exento + (f.exento ?? 0), iva: a.iva + (f.iva ?? 0), total: a.total + (f.total ?? 0) }),
    { neto: 0, exento: 0, iva: 0, total: 0 }
  )
  return (
    <div>
      <Encabezado titulo="Libro de compras">
        <Link href={`/reportes/libro-compras/export?mes=${mesElegido}`}><Boton variante="secundario">Exportar CSV</Boton></Link>
      </Encabezado>
      <form className="mb-4 flex items-end gap-3" action="/reportes/libro-compras" method="get">
        <Entrada type="month" name="mes" defaultValue={mesElegido} className="max-w-xs" />
        <Boton variante="secundario" type="submit">Ver mes</Boton>
      </form>
      <Tabla>
        <thead><tr><Th>Fecha</Th><Th>Tipo</Th><Th>Folio</Th><Th>RUT</Th><Th>Razón social</Th><Th className="text-right">Neto</Th><Th className="text-right">Exento</Th><Th className="text-right">IVA crédito</Th><Th className="text-right">Total</Th></tr></thead>
        <tbody>
          {filas.map((f) => (
            <Tr key={f.documento_id}>
              <Td>{f.fecha ? new Date(f.fecha + 'T00:00:00').toLocaleDateString('es-CL') : '—'}</Td>
              <Td>{ETIQUETA[f.tipo ?? ''] ?? f.tipo}</Td>
              <Td className="font-mono">{f.folio ?? '—'}</Td>
              <Td className="font-mono">{f.rut_proveedor ? formatearRut(f.rut_proveedor) : '—'}</Td>
              <Td>{f.razon_social_proveedor}</Td>
              <Td className="text-right font-mono">{formatearCLP(f.neto ?? 0)}</Td>
              <Td className="text-right font-mono">{formatearCLP(f.exento ?? 0)}</Td>
              <Td className="text-right font-mono">{formatearCLP(f.iva ?? 0)}</Td>
              <Td className="text-right font-mono">{formatearCLP(f.total ?? 0)}</Td>
            </Tr>
          ))}
          {filas.length === 0 && <Tr><Td colSpan={9} className="py-8 text-center text-slate-500">Sin facturas de compra en {mesElegido}.</Td></Tr>}
        </tbody>
      </Tabla>
      <div className="mt-3 flex justify-end gap-6 text-sm">
        <span>Neto: <strong className="font-mono">{formatearCLP(tot.neto)}</strong></span>
        <span>Exento: <strong className="font-mono">{formatearCLP(tot.exento)}</strong></span>
        <span>IVA crédito: <strong className="font-mono">{formatearCLP(tot.iva)}</strong></span>
        <span>Total: <strong className="font-mono">{formatearCLP(tot.total)}</strong></span>
      </div>
    </div>
  )
}
```

`apps/erp/app/reportes/libro-compras/export/route.ts` — espejo del export del libro de ventas:

```ts
import { crearClienteServidor } from '@suite/auth/server'
import { filasACsv, rangoDeMes } from '@suite/core'
import { obtenerEmpresaActiva } from '../../../../lib/empresa-activa'

export async function GET(req: Request) {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return new Response('No autorizado', { status: 401 })
  const mes = new URL(req.url).searchParams.get('mes') ?? new Date().toISOString().slice(0, 7)
  const rango = rangoDeMes(mes)
  if (!rango) return new Response('Mes inválido (use YYYY-MM)', { status: 400 })
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase
    .from('libro_compras')
    .select('fecha, tipo, folio, rut_proveedor, razon_social_proveedor, neto, exento, iva, total')
    .eq('empresa_id', activa.id)
    .gte('fecha', rango.desde)
    .lte('fecha', rango.hasta)
    .order('fecha')
    .order('folio')
  if (error) return new Response('No se pudo generar el libro', { status: 500 })
  const csv = filasACsv(
    ['Fecha', 'Tipo', 'Folio', 'RUT proveedor', 'Razón social', 'Neto', 'Exento', 'IVA crédito', 'Total'],
    (data ?? []).map((f) => [f.fecha, f.tipo, f.folio, f.rut_proveedor, f.razon_social_proveedor, f.neto, f.exento, f.iva, f.total])
  )
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="libro-compras-${mes}.csv"`,
    },
  })
}
```

- [ ] **Step 3: Verificar y commit**

Run: `pnpm --filter erp build` → sin errores.

```bash
git add apps/erp/app/inventario/proveedores apps/erp/app/reportes
git commit -m "feat(erp): estado de cuenta del proveedor y libro de compras SII con export"
```

---

### Task 8: Pipeline + verificación integral (E2E)

**Files:** ninguno de producción (script en scratchpad, se borra).

- [ ] **Step 1: Pipeline**

Run: `pnpm --filter @suite/db gen` — commitear solo si diff (`chore(db): tipos regenerados`).
Run: `pnpm test` — core 69, auth 2, dte 10.
Run: `pnpm supabase test db` — **106 asserts** (6+16+19+10+10+18+7+11+9).
Run: `pnpm build --concurrency=1` — 3 apps.

- [ ] **Step 2: E2E integral (script Node en scratchpad)**

Patrón de siempre (createRequire, usuario real, RUT org `999999999` — NO fixtures ni demo `771234569`; proveedores como authenticated):

1. Org + proveedor (condición 30) + OC (para el vínculo) → factura F1 con `orden_id` + factura F2 suelta con `fecha_emision` hace 60 días → `saldos_compras` muestra ambas, F2 vencida.
2. Doble digitación de F1 → error con `23505`.
3. Pago parcial a F2 → saldo baja; pago multi-factura (resto F2 + F1 completa) → saldos 0.
4. Anular el segundo pago → saldos restaurados; anular F1 → bloqueada si aún tiene pagos activos / OK tras anularlos (probar ambas ramas).
5. `libro_compras` del mes de F1: fila con IVA crédito correcto; anulada fuera; CSV con `filasACsv` sobre las filas reales parte con BOM y cuadra.
6. Aislamiento: org 2 ve 0 en `saldos_compras`/`libro_compras`/`pagos_proveedor`.
7. Cleanup FK-safe (aplicaciones → pagos_proveedor → documentos_compra → ordenes/lineas → proveedores → … → auth.users) + 0 filas + borrar script.

- [ ] **Step 3: Reporte**

`.superpowers/sdd/task-8-plan8-report.md` con todo; nota: click-through del usuario en la demo.

---

## Verificación final del plan

- `pnpm test` (81) + `pnpm supabase test db` (**106**) + `pnpm build` (3 apps) verdes.
- Ciclo completo: factura (con y sin OC, sin duplicados) → CxP con vencimientos → pago multi-factura → anulaciones con precondiciones → estado de cuenta del proveedor → libro de compras SII con export CSV.
- Criterio de éxito del spec §9 cumplido.
