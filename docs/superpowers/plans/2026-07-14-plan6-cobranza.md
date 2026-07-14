# Plan 6: Cobranza (pagos multi-documento + CxC) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Registrar pagos de clientes (una transferencia puede pagar varias facturas) contra documentos de venta, con saldos SIEMPRE derivados, cuentas por cobrar con vencimientos, estado de cuenta por cliente, anulación con motivo y tarjeta de "por cobrar vencido" en el dashboard.

**Architecture:** Espejo de los patrones probados: `pagos` (cabecera) + `pagos_aplicaciones` (detalle) escritos SOLO vía RPC security-definer atómica (`registrar_pago` con `for update` sobre los documentos, valida saldo y cuadratura; `anular_pago` con motivo); vista `saldos_documentos` (`security_invoker`) que deriva saldo y vencimiento — la filosofía de `stock_actual` aplicada al dinero.

**Tech Stack:** Next.js 15 App Router (Server Actions + `useActionState`), Supabase (Postgres 17, RLS, pgTAP), Turborepo, Vitest, TypeScript.

**Spec:** `docs/superpowers/specs/2026-07-14-plan6-cobranza-design.md` (aprobado 2026-07-14).

## Global Constraints

- Multi-tenant: toda tabla nueva lleva `empresa_id` + RLS + grants explícitos; FK compuestas `(empresa_id, x_id) references tabla (empresa_id, id)`; las tablas referenciadas ya tienen `unique (empresa_id, id)` (clientes, documentos_venta, pagos la agrega).
- En app code, TODA query/mutación se acota con `.eq('empresa_id', activa.id)` y `activa` viene de `obtenerEmpresaActiva()` (cookie validada), JAMÁS del formulario.
- Escrituras de cobranza SOLO vía RPC: sin insert/update directo de `authenticated` en `pagos` ni `pagos_aplicaciones` (la anulación también es RPC — exige motivo y rol distinto).
- Saldos NUNCA almacenados: `saldo = total − Σ aplicaciones de pagos activos − Σ NC emitidas que referencian el documento`, derivado en la vista. Un saldo negativo ("a favor") es válido y se marca, no se bloquea.
- Cobrables = documentos `estado = 'emitido'` de tipo `factura`/`boleta`. Las `nota_venta` y `nota_credito` no son filas de la vista.
- `fecha_vencimiento` derivada = `emitido_en::date + clientes.condicion_pago_dias` (valor actual del cliente; tolerancia v1 documentada).
- Matriz de roles: registrar pago = `dueno`/`admin`/`vendedor`; anular pago = `dueno`/`admin`; lectura = cualquier miembro.
- Mensajes de error exactos (los pgTAP los matchean): `'Tu rol no permite registrar pagos'`, `'Tu rol no permite anular pagos'`, `'El monto aplicado supera el saldo del documento (saldo: $%)'`, `'La suma de las aplicaciones debe ser igual al monto del pago'`, `'Documento no cobrable o no pertenece al cliente'`, `'La anulación requiere un motivo'`, `'El pago no existe o ya está anulado'`.
- CLP entero; identificadores ASCII; dominio y copy en español; UTF-8 SIN BOM.
- Windows/PowerShell 5.1: `&&` no encadena; prefijar cada comando con el refresh de PATH.

---

### Task 1: `@suite/core` — lógica de cobranza (TDD)

**Files:**
- Create: `packages/core/src/cobranza.ts`
- Create: `packages/core/src/cobranza.test.ts`
- Modify: `packages/core/src/index.ts` (agregar `export * from './cobranza'`)

**Interfaces:**
- Produces: `saldoDocumento(total: number, pagado: number, notasCredito: number): number`; `estaVencido(fechaVencimiento: string | null, hoy: string, saldo: number): boolean` (fechas ISO `yyyy-mm-dd`, comparación lexicográfica); `cuadraAplicaciones(aplicaciones: { monto: number }[], monto: number): boolean`. Las usan las Tasks 5-7.

- [ ] **Step 1: Test que falla**

`packages/core/src/cobranza.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { cuadraAplicaciones, estaVencido, saldoDocumento } from './cobranza'

describe('saldoDocumento', () => {
  it('resta pagos y notas de crédito del total', () => {
    expect(saldoDocumento(100000, 40000, 10000)).toBe(50000)
  })
  it('puede quedar negativo (a favor del cliente)', () => {
    expect(saldoDocumento(100000, 50000, 60000)).toBe(-10000)
  })
})

describe('estaVencido', () => {
  it('vencido cuando la fecha pasó y hay saldo', () => {
    expect(estaVencido('2026-07-01', '2026-07-14', 5000)).toBe(true)
  })
  it('no vencido si el saldo es 0 o negativo', () => {
    expect(estaVencido('2026-07-01', '2026-07-14', 0)).toBe(false)
  })
  it('no vencido sin fecha de vencimiento', () => {
    expect(estaVencido(null, '2026-07-14', 5000)).toBe(false)
  })
  it('no vencido si vence hoy (vencida = estrictamente pasada)', () => {
    expect(estaVencido('2026-07-14', '2026-07-14', 5000)).toBe(false)
  })
})

describe('cuadraAplicaciones', () => {
  it('cuadra cuando la suma iguala el monto', () => {
    expect(cuadraAplicaciones([{ monto: 40000 }, { monto: 20000 }], 60000)).toBe(true)
  })
  it('no cuadra cuando difiere', () => {
    expect(cuadraAplicaciones([{ monto: 40000 }], 60000)).toBe(false)
  })
})
```

- [ ] **Step 2: Verificar que falla**

Run: `pnpm --filter @suite/core test`
Expected: FAIL — `Cannot find module './cobranza'`.

- [ ] **Step 3: Implementación mínima**

`packages/core/src/cobranza.ts`:

```ts
export function saldoDocumento(total: number, pagado: number, notasCredito: number): number {
  return total - pagado - notasCredito
}

// Fechas ISO yyyy-mm-dd: la comparación lexicográfica equivale a la cronológica.
export function estaVencido(fechaVencimiento: string | null, hoy: string, saldo: number): boolean {
  if (saldo <= 0 || !fechaVencimiento) return false
  return fechaVencimiento < hoy
}

export function cuadraAplicaciones(aplicaciones: { monto: number }[], monto: number): boolean {
  return aplicaciones.reduce((s, a) => s + a.monto, 0) === monto
}
```

En `packages/core/src/index.ts` agregar: `export * from './cobranza'`

- [ ] **Step 4: Verificar que pasa**

Run: `pnpm --filter @suite/core test`
Expected: PASS — 59 tests (51 existentes + 8 nuevos).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/cobranza.ts packages/core/src/cobranza.test.ts packages/core/src/index.ts
git commit -m "feat(core): lógica de cobranza (saldo, vencimiento, cuadratura) TDD"
```

---

### Task 2: Migración 0010 — pagos, aplicaciones, saldos y RPCs

**Files:**
- Create: `supabase/migrations/00000000000010_cobranza.sql`

**Interfaces:**
- Consumes: `app.mis_empresas()`, `app.tiene_rol_en_empresa(uuid, text[])`, `clientes`/`documentos_venta` (ambas con `unique (empresa_id, id)`).
- Produces: tablas `pagos`, `pagos_aplicaciones`; vista `saldos_documentos`; RPCs `registrar_pago(p_empresa uuid, p_cliente uuid, p_fecha date, p_metodo text, p_monto integer, p_referencia text, p_notas text, p_aplicaciones jsonb) returns uuid` y `anular_pago(p_empresa uuid, p_pago uuid, p_motivo text) returns void`.
- Forma jsonb de aplicaciones: `[{"documentoId": "<uuid>", "monto": 40000}]`.

- [ ] **Step 1: Escribir la migración**

`supabase/migrations/00000000000010_cobranza.sql`:

```sql
-- Cobranza: pagos multi-documento y cuentas por cobrar con saldos derivados.

-- ---------- Pagos (cabecera; baja logica, nunca delete) ----------
create table public.pagos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  cliente_id uuid not null,
  fecha date not null default current_date,
  metodo text not null check (metodo in ('efectivo', 'transferencia', 'tarjeta', 'cheque', 'otro')),
  monto integer not null check (monto > 0),
  referencia text,
  notas text,
  estado text not null default 'activo' check (estado in ('activo', 'anulado')),
  motivo_anulacion text,
  creado_en timestamptz not null default now(),
  unique (empresa_id, id),
  foreign key (empresa_id, cliente_id) references public.clientes (empresa_id, id)
);
create index pagos_cliente_idx on public.pagos (empresa_id, cliente_id);

-- ---------- Aplicaciones (detalle: un pago se reparte entre documentos) ----------
create table public.pagos_aplicaciones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  pago_id uuid not null,
  documento_id uuid not null,
  monto integer not null check (monto > 0),
  unique (empresa_id, id),
  foreign key (empresa_id, pago_id) references public.pagos (empresa_id, id),
  foreign key (empresa_id, documento_id) references public.documentos_venta (empresa_id, id)
);
create index pagos_aplicaciones_doc_idx on public.pagos_aplicaciones (empresa_id, documento_id);

-- ---------- Vista de saldos (security_invoker: RLS del consultante) ----------
-- saldo = total - pagos activos aplicados - NC emitidas que referencian el documento.
-- fecha_vencimiento derivada del condicion_pago_dias ACTUAL del cliente (tolerancia v1:
-- cambiar la condicion recalcula vencimientos historicos).
create view public.saldos_documentos with (security_invoker = true) as
select
  d.empresa_id,
  d.id as documento_id,
  d.tipo,
  d.folio,
  d.cliente_id,
  c.razon_social as cliente_razon_social,
  d.total,
  d.emitido_en,
  (coalesce(d.emitido_en, d.creado_en)::date + c.condicion_pago_dias) as fecha_vencimiento,
  coalesce(p.pagado, 0)::integer as pagado,
  coalesce(n.notas_credito, 0)::integer as notas_credito,
  (d.total - coalesce(p.pagado, 0) - coalesce(n.notas_credito, 0))::integer as saldo
from public.documentos_venta d
join public.clientes c on c.id = d.cliente_id and c.empresa_id = d.empresa_id
left join lateral (
  select sum(a.monto) as pagado
  from public.pagos_aplicaciones a
  join public.pagos pg on pg.id = a.pago_id and pg.empresa_id = a.empresa_id
  where a.documento_id = d.id and a.empresa_id = d.empresa_id and pg.estado = 'activo'
) p on true
left join lateral (
  select sum(nc.total) as notas_credito
  from public.documentos_venta nc
  where nc.documento_referencia_id = d.id and nc.empresa_id = d.empresa_id
    and nc.tipo = 'nota_credito' and nc.estado = 'emitido'
) n on true
where d.estado = 'emitido' and d.tipo in ('factura', 'boleta');

-- ---------- RLS ----------
alter table public.pagos enable row level security;
alter table public.pagos_aplicaciones enable row level security;

create policy "miembros ven pagos" on public.pagos
  for select to authenticated using (empresa_id in (select app.mis_empresas()));
create policy "miembros ven aplicaciones" on public.pagos_aplicaciones
  for select to authenticated using (empresa_id in (select app.mis_empresas()));

-- ---------- Grants Data API (leccion Plan 1) ----------
-- Sin insert/update para authenticated: TODA escritura va por RPC (incluida la anulacion).
grant select on public.pagos, public.pagos_aplicaciones, public.saldos_documentos to authenticated;
grant select, insert, update, delete on public.pagos, public.pagos_aplicaciones to service_role;
grant select on public.saldos_documentos to service_role;

-- ---------- Registrar pago (atomico; for update serializa contra el mismo documento) ----------
create or replace function public.registrar_pago(
  p_empresa uuid, p_cliente uuid, p_fecha date, p_metodo text, p_monto integer,
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
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'vendedor']) then
    raise exception 'Tu rol no permite registrar pagos';
  end if;
  if p_metodo is null or p_metodo not in ('efectivo', 'transferencia', 'tarjeta', 'cheque', 'otro') then
    raise exception 'Método de pago no válido';
  end if;
  if p_monto is null or p_monto <= 0 then
    raise exception 'El monto del pago debe ser mayor a 0';
  end if;
  if not exists (select 1 from clientes where id = p_cliente and empresa_id = p_empresa) then
    raise exception 'Cliente no encontrado en la empresa';
  end if;
  if p_aplicaciones is null or jsonb_array_length(p_aplicaciones) = 0 then
    raise exception 'El pago debe aplicarse a al menos un documento';
  end if;

  insert into pagos (empresa_id, cliente_id, fecha, metodo, monto, referencia, notas)
  values (p_empresa, p_cliente, coalesce(p_fecha, current_date), p_metodo, p_monto,
          nullif(trim(coalesce(p_referencia, '')), ''), nullif(trim(coalesce(p_notas, '')), ''))
  returning id into v_pago;

  for v_app in select * from jsonb_array_elements(p_aplicaciones) loop
    -- Lock del documento: dos pagos concurrentes al mismo documento se serializan aqui
    -- y el saldo se calcula DENTRO del lock (sin TOCTOU).
    select d.id, d.total into v_doc
    from documentos_venta d
    where d.id = (v_app->>'documentoId')::uuid and d.empresa_id = p_empresa
      and d.cliente_id = p_cliente and d.estado = 'emitido' and d.tipo in ('factura', 'boleta')
    for update;
    if not found then
      raise exception 'Documento no cobrable o no pertenece al cliente';
    end if;
    v_monto_app := (v_app->>'monto')::integer;
    if v_monto_app is null or v_monto_app <= 0 then
      raise exception 'El monto aplicado debe ser mayor a 0';
    end if;

    select (v_doc.total
      - coalesce((select sum(a.monto) from pagos_aplicaciones a
                  join pagos pg on pg.id = a.pago_id and pg.empresa_id = a.empresa_id
                  where a.documento_id = v_doc.id and a.empresa_id = p_empresa and pg.estado = 'activo'), 0)
      - coalesce((select sum(nc.total) from documentos_venta nc
                  where nc.documento_referencia_id = v_doc.id and nc.empresa_id = p_empresa
                    and nc.tipo = 'nota_credito' and nc.estado = 'emitido'), 0)
    ) into v_saldo;
    if v_monto_app > v_saldo then
      raise exception 'El monto aplicado supera el saldo del documento (saldo: $%)', v_saldo;
    end if;

    insert into pagos_aplicaciones (empresa_id, pago_id, documento_id, monto)
    values (p_empresa, v_pago, v_doc.id, v_monto_app);
    v_suma := v_suma + v_monto_app;
  end loop;

  if v_suma <> p_monto then
    raise exception 'La suma de las aplicaciones debe ser igual al monto del pago';
  end if;

  return v_pago;
end $$;
revoke execute on function public.registrar_pago(uuid, uuid, date, text, integer, text, text, jsonb) from anon, public;
grant execute on function public.registrar_pago(uuid, uuid, date, text, integer, text, text, jsonb) to authenticated;

-- ---------- Anular pago (baja logica con motivo; las aplicaciones quedan como historico) ----------
create or replace function public.anular_pago(p_empresa uuid, p_pago uuid, p_motivo text)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin']) then
    raise exception 'Tu rol no permite anular pagos';
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'La anulación requiere un motivo';
  end if;
  update pagos set estado = 'anulado', motivo_anulacion = trim(p_motivo)
  where id = p_pago and empresa_id = p_empresa and estado = 'activo';
  if not found then
    raise exception 'El pago no existe o ya está anulado';
  end if;
end $$;
revoke execute on function public.anular_pago(uuid, uuid, text) from anon, public;
grant execute on function public.anular_pago(uuid, uuid, text) to authenticated;
```

- [ ] **Step 2: Aplicar y verificar**

Run: `pnpm supabase db reset`
Expected: aplica 0001-0010 sin errores.

Run: `pnpm supabase test db`
Expected: los 61 asserts existentes siguen verdes (los de cobranza llegan en Task 3).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/00000000000010_cobranza.sql
git commit -m "feat(db): cobranza (pagos multi-documento, saldos derivados) con RPCs serializadas"
```

---

### Task 3: pgTAP de cobranza

**Files:**
- Create: `supabase/tests/database/cobranza.test.sql`

**Interfaces:**
- Consumes: migración 0010 (Task 2). Fixtures con el patrón de `compras.test.sql`. RUTs reservados: `761111116` (Org A), `762222221` (Org B), `765432103` (cliente/proveedor A).
- Nota pgTAP (lección Plan 5): un `is()` no puede envolver una CTE modificante en subquery escalar — para updates usar `results_eq($$...$$, array[...], ...)`; aquí no hay updates directos (todo RPC), así que no aplica.

- [ ] **Step 1: Escribir el test**

`supabase/tests/database/cobranza.test.sql`:

```sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'ana@a.cl'),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'beto@b.cl'),
  ('00000000-0000-0000-0000-000000000000', '55555555-5555-5555-5555-555555555555', 'authenticated', 'authenticated', 'ces@a.cl'),
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
       ('55555555-5555-5555-5555-555555555555', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'contador'),
       ('77777777-7777-7777-7777-777777777777', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'vendedor');

-- Clientes: A1 (30 dias) y A2 (otro cliente, para el test de pertenencia).
insert into public.clientes (id, empresa_id, rut, razon_social, condicion_pago_dias)
values ('cccccccc-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '765432103', 'Cliente A1', 30),
       ('cccccccc-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '761111116', 'Cliente A2', 0);

-- Documentos cobrables: doc1 (100000, reciente) y doc2 (50000, emitido hace 60 dias => VENCIDO).
insert into public.documentos_venta (id, empresa_id, tipo, cliente_id, folio, estado, neto, exento, iva, total, emitido_en)
values ('dddddddd-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'factura',
        'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 1, 'emitido', 84034, 0, 15966, 100000, now()),
       ('dddddddd-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'factura',
        'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 2, 'emitido', 42017, 0, 7983, 50000, now() - interval '60 days');

-- ===== Vero (vendedora A) registra un pago multi-documento =====
set local role authenticated;
set local request.jwt.claims to '{"sub": "77777777-7777-7777-7777-777777777777", "role": "authenticated"}';

-- 1) Pago de 60000: 40000 a doc1 + 20000 a doc2.
select lives_ok(
  $$select registrar_pago('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
    current_date, 'transferencia', 60000, 'OP-123', null,
    '[{"documentoId":"dddddddd-0000-0000-0000-000000000001","monto":40000},
      {"documentoId":"dddddddd-0000-0000-0000-000000000002","monto":20000}]'::jsonb)$$,
  'la vendedora registra un pago multi-documento'
);
-- 2) Saldo doc1 = 60000.
select is( (select saldo from saldos_documentos where documento_id = 'dddddddd-0000-0000-0000-000000000001'),
  60000, 'el saldo del doc1 baja a 60000' );
-- 3) Saldo doc2 = 30000.
select is( (select saldo from saldos_documentos where documento_id = 'dddddddd-0000-0000-0000-000000000002'),
  30000, 'el saldo del doc2 baja a 30000' );

-- 4) Sobre-aplicacion rechazada con el saldo en el mensaje.
select throws_ok(
  $$select registrar_pago('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
    current_date, 'efectivo', 70000, null, null,
    '[{"documentoId":"dddddddd-0000-0000-0000-000000000001","monto":70000}]'::jsonb)$$,
  'P0001', 'El monto aplicado supera el saldo del documento (saldo: $60000)',
  'la sobre-aplicación se rechaza con el saldo en el mensaje'
);

-- 5) Cuadratura rechazada (monto 100, aplicaciones suman 50).
select throws_ok(
  $$select registrar_pago('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
    current_date, 'efectivo', 100, null, null,
    '[{"documentoId":"dddddddd-0000-0000-0000-000000000001","monto":50}]'::jsonb)$$,
  'P0001', 'La suma de las aplicaciones debe ser igual al monto del pago',
  'la cuadratura se valida'
);

-- 6) Pago a documento de OTRO cliente rechazado (doc de A1 con cliente A2).
select throws_ok(
  $$select registrar_pago('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-000000000002',
    current_date, 'efectivo', 100, null, null,
    '[{"documentoId":"dddddddd-0000-0000-0000-000000000001","monto":100}]'::jsonb)$$,
  'P0001', 'Documento no cobrable o no pertenece al cliente',
  'no se puede pagar el documento de otro cliente'
);

-- 7) Vero (vendedora) NO anula.
select throws_ok(
  $$select anular_pago('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from pagos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' limit 1), 'error')$$,
  'P0001', 'Tu rol no permite anular pagos',
  'la vendedora no puede anular pagos'
);

-- 8) Ces (contador) NO registra pagos.
set local request.jwt.claims to '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated"}';
select throws_ok(
  $$select registrar_pago('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
    current_date, 'efectivo', 100, null, null,
    '[{"documentoId":"dddddddd-0000-0000-0000-000000000001","monto":100}]'::jsonb)$$,
  'P0001', 'Tu rol no permite registrar pagos',
  'el contador no puede registrar pagos'
);

-- ===== Ana (duena A) anula =====
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- 9) Anulacion sin motivo rechazada.
select throws_ok(
  $$select anular_pago('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from pagos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' limit 1), '  ')$$,
  'P0001', 'La anulación requiere un motivo',
  'anular exige motivo'
);
-- 10) Ana anula el pago con motivo.
select lives_ok(
  $$select anular_pago('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from pagos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' limit 1), 'Registrado por error')$$,
  'la dueña anula el pago con motivo'
);
-- 11) El saldo del doc1 se restaura a 100000.
select is( (select saldo from saldos_documentos where documento_id = 'dddddddd-0000-0000-0000-000000000001'),
  100000, 'anular el pago restaura el saldo' );
-- 12) Doble anulacion falla.
select throws_ok(
  $$select anular_pago('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from pagos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' limit 1), 'de nuevo')$$,
  'P0001', 'El pago no existe o ya está anulado',
  'no se puede anular dos veces'
);

-- 13) Una NC emitida neta el saldo del documento original.
set local role postgres;
insert into public.documentos_venta (id, empresa_id, tipo, cliente_id, folio, estado, neto, exento, iva, total, documento_referencia_id, emitido_en)
values ('dddddddd-0000-0000-0000-00000000000c', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'nota_credito',
        'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 1, 'emitido', 84034, 0, 15966, 100000,
        'dddddddd-0000-0000-0000-000000000001', now());
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select is( (select saldo from saldos_documentos where documento_id = 'dddddddd-0000-0000-0000-000000000001'),
  0, 'la nota de crédito neta el saldo del original' );

-- 14) El doc2 (emitido hace 60 dias, condicion 30) aparece VENCIDO.
select ok(
  (select fecha_vencimiento < current_date from saldos_documentos where documento_id = 'dddddddd-0000-0000-0000-000000000002'),
  'el doc2 está vencido (emitido hace 60 días, condición 30)'
);

-- 15) Beto (org B) no ve pagos ni saldos de A.
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
select is( (select count(*) from pagos) + (select count(*) from saldos_documentos), 0::bigint,
  'Beto no ve pagos ni saldos de la empresa A' );

-- 16) Anonimo denegado de plano.
set local request.jwt.claims to '{"role": "anon"}';
set local role anon;
select throws_ok(
  'select count(*) from pagos',
  '42501', 'permission denied for table pagos',
  'un anónimo no puede consultar pagos'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Ejecutar**

Run: `pnpm supabase test db`
Expected: 7 archivos, **77 asserts** (aislamiento 6, cobranza 16, compras 19, inventario 10, maestros 10, registro 7, ventas 9), todos verdes. Si un assert de cobranza falla, el sospechoso es la migración de Task 2 — NO debilitar el test.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/database/cobranza.test.sql
git commit -m "test(db): pagos multi-documento, saldos, roles y anulación con pgTAP"
```

---

### Task 4: Regenerar tipos `@suite/db`

**Files:**
- Modify: `packages/db/src/types.ts` (regenerado)

**Interfaces:**
- Produces: tipo `Database` con `pagos`, `pagos_aplicaciones`, la vista `saldos_documentos` (en Views) y las RPCs `registrar_pago`/`anular_pago` (en Functions).

- [ ] **Step 1: Regenerar y verificar**

Run: `pnpm --filter @suite/db gen`
Expected: `types.ts` incluye los 5 símbolos nuevos (verificar por grep antes de commitear; si falta alguno, el gen quedó stale → BLOCKED).

Run: `pnpm tsc --noEmit -p packages/db/tsconfig.json`
Expected: sin errores.

Run: `pnpm build --concurrency=1`
Expected: las 3 apps compilan.

- [ ] **Step 2: Commit**

```bash
git add packages/db/src/types.ts
git commit -m "feat(db): tipos regenerados con tablas de cobranza"
```

---

### Task 5: ERP — Cuentas por cobrar + NAV

**Files:**
- Create: `apps/erp/app/cobranza/page.tsx`
- Modify: `apps/erp/app/layout.tsx` (NAV: agregar Cobranza entre Compras y Configuración)

**Interfaces:**
- Consumes: vista `saldos_documentos` (columnas: documento_id, tipo, folio, cliente_id, cliente_razon_social, total, emitido_en, fecha_vencimiento, pagado, notas_credito, saldo), `estaVencido`/`formatearCLP` de `@suite/core`.
- Produces: la página `/cobranza` que las Tasks 6-7 enlazan.

- [ ] **Step 1: Página CxC**

`apps/erp/app/cobranza/page.tsx`:

```tsx
import Link from 'next/link'
import { crearClienteServidor } from '@suite/auth/server'
import { estaVencido, formatearCLP } from '@suite/core'
import { Boton, Encabezado, Insignia, Selector, Tabla, Td, Th, Tr } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'

const HOY = () => new Date().toISOString().slice(0, 10)

export default async function PaginaCobranza({
  searchParams,
}: {
  searchParams: Promise<{ cliente?: string; vencidas?: string }>
}) {
  const { cliente = '', vencidas = '' } = await searchParams
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const supabase = await crearClienteServidor()
  const [{ data: clientes }, consultaSaldos] = await Promise.all([
    supabase.from('clientes').select('id, razon_social').eq('empresa_id', activa.id).eq('activo', true).order('razon_social'),
    (() => {
      let q = supabase
        .from('saldos_documentos')
        .select('documento_id, tipo, folio, cliente_id, cliente_razon_social, total, emitido_en, fecha_vencimiento, pagado, notas_credito, saldo')
        .eq('empresa_id', activa.id)
        .neq('saldo', 0)
        .order('fecha_vencimiento', { ascending: true })
        .limit(200)
      if (cliente) q = q.eq('cliente_id', cliente)
      return q
    })(),
  ])
  const hoy = HOY()
  let filas = consultaSaldos.data ?? []
  if (vencidas === '1') filas = filas.filter((f) => estaVencido(f.fecha_vencimiento, hoy, f.saldo))
  const porCobrar = filas.reduce((s, f) => s + Math.max(0, f.saldo), 0)
  const vencido = filas.filter((f) => estaVencido(f.fecha_vencimiento, hoy, f.saldo)).reduce((s, f) => s + f.saldo, 0)
  return (
    <div>
      <Encabezado titulo="Cuentas por cobrar">
        <div className="flex items-center gap-2">
          <Link href="/cobranza/pagos"><Boton variante="secundario">Pagos</Boton></Link>
          <Link href="/cobranza/pagos/nuevo"><Boton>Registrar pago</Boton></Link>
        </div>
      </Encabezado>
      <form className="mb-4 flex flex-wrap items-center gap-3" action="/cobranza" method="get">
        <Selector name="cliente" defaultValue={cliente} className="max-w-xs">
          <option value="">Todos los clientes</option>
          {(clientes ?? []).map((c) => <option key={c.id} value={c.id}>{c.razon_social}</option>)}
        </Selector>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" name="vencidas" value="1" defaultChecked={vencidas === '1'} /> Solo vencidas
        </label>
        <Boton variante="secundario" type="submit">Filtrar</Boton>
        <Link className="text-sm text-marca-700 hover:underline" href="/cobranza">Limpiar</Link>
      </form>
      <Tabla>
        <thead><tr><Th>Documento</Th><Th>Cliente</Th><Th>Emisión</Th><Th>Vencimiento</Th><Th className="text-right">Total</Th><Th className="text-right">Pagado</Th><Th className="text-right">Saldo</Th><Th /></tr></thead>
        <tbody>
          {filas.map((f) => {
            const venc = estaVencido(f.fecha_vencimiento, hoy, f.saldo)
            return (
              <Tr key={f.documento_id}>
                <Td>{f.tipo === 'factura' ? 'Factura' : 'Boleta'} {f.folio ?? '—'}</Td>
                <Td>{f.cliente_razon_social}</Td>
                <Td>{f.emitido_en ? new Date(f.emitido_en).toLocaleDateString('es-CL') : '—'}</Td>
                <Td>{f.fecha_vencimiento ? new Date(f.fecha_vencimiento + 'T00:00:00').toLocaleDateString('es-CL') : '—'}</Td>
                <Td className="text-right font-mono">{formatearCLP(f.total)}</Td>
                <Td className="text-right font-mono">{formatearCLP(f.pagado + f.notas_credito)}</Td>
                <Td className="text-right font-mono">{f.saldo < 0 ? <span className="text-marca-700">{formatearCLP(f.saldo)} (a favor)</span> : formatearCLP(f.saldo)}</Td>
                <Td>{venc && <Insignia tono="rojo">Vencida</Insignia>}</Td>
              </Tr>
            )
          })}
          {filas.length === 0 && <Tr><Td colSpan={8} className="py-8 text-center text-slate-500">No hay documentos con saldo {cliente || vencidas ? 'que coincidan' : 'pendiente'}.</Td></Tr>}
        </tbody>
      </Tabla>
      <div className="mt-3 flex justify-end gap-6 text-sm">
        <span>Por cobrar: <strong className="font-mono">{formatearCLP(porCobrar)}</strong></span>
        <span className="text-red-600">Vencido: <strong className="font-mono">{formatearCLP(vencido)}</strong></span>
      </div>
    </div>
  )
}
```

Modificar `apps/erp/app/layout.tsx` — en el `NAV`, después de `{ href: '/compras', etiqueta: 'Compras' },` agregar:

```tsx
  { href: '/cobranza', etiqueta: 'Cobranza' },
```

- [ ] **Step 2: Verificar**

Run: `pnpm --filter erp build`
Expected: build sin errores. (Los links a `/cobranza/pagos*` 404ean hasta Task 6 — transitorio esperado, patrón de planes anteriores.)

- [ ] **Step 3: Commit**

```bash
git add apps/erp/app/cobranza apps/erp/app/layout.tsx
git commit -m "feat(erp): cuentas por cobrar con saldos y vencimientos"
```

---

### Task 6: ERP — registrar y anular pagos

**Files:**
- Create: `apps/erp/app/cobranza/acciones.ts`, `apps/erp/app/cobranza/pagos/page.tsx`, `apps/erp/app/cobranza/pagos/nuevo/page.tsx`, `apps/erp/componentes/formulario-pago.tsx`, `apps/erp/componentes/formulario-anular.tsx`

**Interfaces:**
- Consumes: RPCs `registrar_pago`/`anular_pago`, `cuadraAplicaciones`/`formatearCLP` de `@suite/core`, vista `saldos_documentos`, `EstadoForm`.
- Produces: Server Actions `registrarPago(prev, formData): Promise<EstadoForm>` y `anularPago(prev, formData): Promise<EstadoForm>`.
- Nota de tipos (precedente Planes 5): si los Args generados exigen `Json`/no-null, castear estrecho y comentado (`as unknown as Json`); `Json` se exporta de `@suite/db`.

- [ ] **Step 1: Server Actions**

`apps/erp/app/cobranza/acciones.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import type { EstadoForm } from '../tipos'

const METODOS = ['efectivo', 'transferencia', 'tarjeta', 'cheque', 'otro'] as const

type AplicacionEntrada = { documentoId: string; monto: number }

export async function registrarPago(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const cliente = String(formData.get('cliente_id') ?? '')
  const metodo = String(formData.get('metodo') ?? '')
  const fecha = String(formData.get('fecha') ?? '').trim()
  const referencia = String(formData.get('referencia') ?? '').trim()
  const notas = String(formData.get('notas') ?? '').trim()
  const monto = Math.trunc(Number(String(formData.get('monto') ?? '').trim()))
  if (!cliente) return { error: 'Selecciona un cliente' }
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
  const { error } = await supabase.rpc('registrar_pago', {
    p_empresa: activa.id,
    p_cliente: cliente,
    p_fecha: fecha || null,
    p_metodo: metodo,
    p_monto: monto,
    p_referencia: referencia || null,
    p_notas: notas || null,
    p_aplicaciones: aplicaciones.map((a) => ({ documentoId: a.documentoId, monto: a.monto })),
  })
  if (error) {
    if (error.message.includes('rol')) return { error: 'Tu rol no permite registrar pagos' }
    if (error.message.includes('saldo')) return { error: error.message }
    if (error.message.includes('suma')) return { error: 'La suma de las aplicaciones debe ser igual al monto del pago' }
    if (error.message.includes('cobrable')) return { error: 'Hay un documento no cobrable o de otro cliente' }
    return { error: 'No se pudo registrar el pago' }
  }
  revalidatePath('/cobranza')
  revalidatePath('/cobranza/pagos')
  redirect('/cobranza')
}

export async function anularPago(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  const pago = String(formData.get('pago_id') ?? '')
  const motivo = String(formData.get('motivo') ?? '').trim()
  if (!pago) return { error: 'Pago no válido' }
  if (motivo === '') return { error: 'La anulación requiere un motivo' }
  const supabase = await crearClienteServidor()
  const { error } = await supabase.rpc('anular_pago', { p_empresa: activa.id, p_pago: pago, p_motivo: motivo })
  if (error) {
    if (error.message.includes('rol')) return { error: 'Tu rol no permite anular pagos' }
    if (error.message.includes('anulado')) return { error: 'El pago no existe o ya está anulado' }
    return { error: 'No se pudo anular el pago' }
  }
  revalidatePath('/cobranza')
  revalidatePath('/cobranza/pagos')
  return {}
}
```

- [ ] **Step 2: Formulario de pago (client)**

`apps/erp/componentes/formulario-pago.tsx`:

```tsx
'use client'

import { useActionState, useState } from 'react'
import { Boton, Campo, Entrada, Selector, Tabla, Tarjeta, Td, Th, Tr } from '@suite/ui'
import { cuadraAplicaciones, formatearCLP } from '@suite/core'
import type { EstadoForm } from '../app/tipos'

interface DocumentoConSaldo { documentoId: string; etiqueta: string; saldo: number }

export function FormularioPago({
  accion,
  clienteId,
  documentos,
}: {
  accion: (prev: EstadoForm, formData: FormData) => Promise<EstadoForm>
  clienteId: string
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
      <input type="hidden" name="cliente_id" value={clienteId} />
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

- [ ] **Step 3: Páginas nuevo pago e historial**

`apps/erp/app/cobranza/pagos/nuevo/page.tsx` (el cliente se elige por GET → la página recarga con sus documentos):

```tsx
import { crearClienteServidor } from '@suite/auth/server'
import { Boton, Campo, Encabezado, Selector, Tarjeta } from '@suite/ui'
import { FormularioPago } from '../../../../componentes/formulario-pago'
import { obtenerEmpresaActiva } from '../../../../lib/empresa-activa'
import { registrarPago } from '../../acciones'

export default async function NuevoPago({ searchParams }: { searchParams: Promise<{ cliente?: string }> }) {
  const { cliente = '' } = await searchParams
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const supabase = await crearClienteServidor()
  const { data: clientes } = await supabase
    .from('clientes').select('id, razon_social').eq('empresa_id', activa.id).eq('activo', true).order('razon_social')
  const { data: saldos } = cliente
    ? await supabase
        .from('saldos_documentos')
        .select('documento_id, tipo, folio, saldo')
        .eq('empresa_id', activa.id).eq('cliente_id', cliente).gt('saldo', 0)
        .order('fecha_vencimiento', { ascending: true })
    : { data: null }
  return (
    <div>
      <Encabezado titulo="Registrar pago" />
      <Tarjeta className="mb-4 max-w-xl">
        <form action="/cobranza/pagos/nuevo" method="get" className="flex items-end gap-3">
          <Campo etiqueta="Cliente *">
            <Selector name="cliente" defaultValue={cliente} required>
              <option value="" disabled>Selecciona…</option>
              {(clientes ?? []).map((c) => <option key={c.id} value={c.id}>{c.razon_social}</option>)}
            </Selector>
          </Campo>
          <Boton variante="secundario" type="submit">Ver documentos</Boton>
        </form>
      </Tarjeta>
      {cliente && (saldos ?? []).length === 0 && (
        <p className="text-sm text-slate-500">Este cliente no tiene documentos con saldo pendiente.</p>
      )}
      {cliente && (saldos ?? []).length > 0 && (
        <FormularioPago
          accion={registrarPago}
          clienteId={cliente}
          documentos={(saldos ?? []).map((s) => ({
            documentoId: s.documento_id,
            etiqueta: `${s.tipo === 'factura' ? 'Factura' : 'Boleta'} ${s.folio ?? '—'}`,
            saldo: s.saldo,
          }))}
        />
      )}
    </div>
  )
}
```

`apps/erp/app/cobranza/pagos/page.tsx`:

```tsx
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP } from '@suite/core'
import { Encabezado, Insignia, Tabla, Td, Th, Tr } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { FormularioAnular } from '../../../componentes/formulario-anular'

const METODO: Record<string, string> = { efectivo: 'Efectivo', transferencia: 'Transferencia', tarjeta: 'Tarjeta', cheque: 'Cheque', otro: 'Otro' }

export default async function PaginaPagos() {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const supabase = await crearClienteServidor()
  const { data: pagos } = await supabase
    .from('pagos')
    .select('id, fecha, metodo, monto, referencia, estado, motivo_anulacion, clientes (razon_social), pagos_aplicaciones (monto, documentos_venta (tipo, folio))')
    .eq('empresa_id', activa.id)
    .order('creado_en', { ascending: false })
    .limit(100)
  return (
    <div>
      <Encabezado titulo="Pagos" />
      <Tabla>
        <thead><tr><Th>Fecha</Th><Th>Cliente</Th><Th>Método</Th><Th className="text-right">Monto</Th><Th>Aplicado a</Th><Th>Estado</Th><Th /></tr></thead>
        <tbody>
          {(pagos ?? []).map((p) => (
            <Tr key={p.id}>
              <Td>{new Date(p.fecha + 'T00:00:00').toLocaleDateString('es-CL')}</Td>
              <Td>{p.clientes?.razon_social ?? '—'}</Td>
              <Td>{METODO[p.metodo] ?? p.metodo}{p.referencia ? ` · ${p.referencia}` : ''}</Td>
              <Td className="text-right font-mono">{formatearCLP(p.monto)}</Td>
              <Td className="text-sm">
                {(p.pagos_aplicaciones ?? []).map((a, i) => (
                  <span key={i} className="mr-2">{a.documentos_venta?.tipo === 'factura' ? 'F' : 'B'}{a.documentos_venta?.folio ?? '—'}: {formatearCLP(a.monto)}</span>
                ))}
              </Td>
              <Td>{p.estado === 'activo' ? <Insignia tono="verde">Activo</Insignia> : <Insignia tono="rojo">Anulado</Insignia>}</Td>
              <Td>{p.estado === 'activo' ? <FormularioAnular pagoId={p.id} /> : <span className="text-xs text-slate-400">{p.motivo_anulacion}</span>}</Td>
            </Tr>
          ))}
          {(pagos ?? []).length === 0 && <Tr><Td colSpan={7} className="py-8 text-center text-slate-500">No hay pagos registrados.</Td></Tr>}
        </tbody>
      </Tabla>
    </div>
  )
}
```

`apps/erp/componentes/formulario-anular.tsx` (client, inline):

```tsx
'use client'

import { useActionState, useState } from 'react'
import { Boton, Entrada } from '@suite/ui'
import { anularPago } from '../app/cobranza/acciones'
import type { EstadoForm } from '../app/tipos'

export function FormularioAnular({ pagoId }: { pagoId: string }) {
  const [abierto, setAbierto] = useState(false)
  const [estado, enviar, pendiente] = useActionState(anularPago, {} as EstadoForm)
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

- [ ] **Step 4: Verificar**

Run: `pnpm --filter erp build`
Expected: build sin errores.

- [ ] **Step 5: Commit**

```bash
git add apps/erp/app/cobranza apps/erp/componentes/formulario-pago.tsx apps/erp/componentes/formulario-anular.tsx
git commit -m "feat(erp): registro y anulación de pagos multi-documento"
```

---

### Task 7: ERP — estado de cuenta del cliente + dashboard

**Files:**
- Modify: `apps/erp/app/clientes/[id]/page.tsx` (sección "Estado de cuenta")
- Modify: `apps/erp/app/page.tsx` (tarjeta "Por cobrar vencido")

**Interfaces:**
- Consumes: vista `saldos_documentos`, tabla `pagos`, `estaVencido`/`formatearCLP` de `@suite/core`.

- [ ] **Step 1: Estado de cuenta en el detalle del cliente**

En `apps/erp/app/clientes/[id]/page.tsx` (LEER el archivo primero; hoy termina con `<FormularioCliente …/>` dentro de un `<div>`): agregar tras cargar el cliente las dos consultas, y tras el formulario la sección. Importar `formatearCLP` de `@suite/core` y `Tarjeta` de `@suite/ui` (Encabezado ya está importado).

Tras `if (!cliente) notFound()` agregar:

```tsx
  const [{ data: saldos }, { data: pagos }] = await Promise.all([
    supabase
      .from('saldos_documentos')
      .select('documento_id, tipo, folio, total, pagado, notas_credito, saldo, fecha_vencimiento')
      .eq('empresa_id', activa.id).eq('cliente_id', id).neq('saldo', 0)
      .order('fecha_vencimiento', { ascending: true }),
    supabase
      .from('pagos')
      .select('id, fecha, metodo, monto, estado')
      .eq('empresa_id', activa.id).eq('cliente_id', id)
      .order('creado_en', { ascending: false }).limit(20),
  ])
  const deuda = (saldos ?? []).reduce((s, d) => s + Math.max(0, d.saldo), 0)
```

Y después de `<FormularioCliente …/>`, dentro del mismo `<div>` raíz:

```tsx
      <div className="mt-6 max-w-2xl">
        <h2 className="mb-2 text-lg font-semibold text-slate-800">Estado de cuenta</h2>
        <Tarjeta>
          <p className="mb-2 text-sm">Deuda vigente: <strong className="font-mono">{formatearCLP(deuda)}</strong></p>
          <ul className="space-y-1 text-sm">
            {(saldos ?? []).map((d) => (
              <li key={d.documento_id} className="flex justify-between">
                <span>{d.tipo === 'factura' ? 'Factura' : 'Boleta'} {d.folio ?? '—'} · vence {d.fecha_vencimiento ? new Date(d.fecha_vencimiento + 'T00:00:00').toLocaleDateString('es-CL') : '—'}</span>
                <span className="font-mono">{formatearCLP(d.saldo)}</span>
              </li>
            ))}
            {(saldos ?? []).length === 0 && <li className="text-slate-500">Sin documentos con saldo pendiente.</li>}
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

- [ ] **Step 2: Tarjeta del dashboard**

En `apps/erp/app/page.tsx` (LEER primero; el grid actual tiene 3 tarjetas: Productos activos, Clientes activos y Stock crítico — PRESERVARLAS). Importar `estaVencido` y `formatearCLP` de `@suite/core`. Tras el cálculo de `criticos` agregar:

```tsx
  const { data: saldosRows } = await supabase
    .from('saldos_documentos')
    .select('saldo, fecha_vencimiento')
    .eq('empresa_id', activa.id)
    .gt('saldo', 0)
  const hoy = new Date().toISOString().slice(0, 10)
  const vencidos = (saldosRows ?? []).filter((s) => estaVencido(s.fecha_vencimiento, hoy, s.saldo))
  const montoVencido = vencidos.reduce((s, v) => s + v.saldo, 0)
```

Y en el grid (cambiar `lg:grid-cols-3` por `lg:grid-cols-4`), después de la tarjeta de Stock crítico:

```tsx
        <Link href="/cobranza?vencidas=1">
          <Tarjeta>
            <p className="text-sm text-slate-500">Por cobrar vencido</p>
            <p className="mt-1 text-3xl font-semibold">{formatearCLP(montoVencido)}</p>
            <p className="text-xs text-slate-500">{vencidos.length} documento{vencidos.length === 1 ? '' : 's'}</p>
          </Tarjeta>
        </Link>
```

- [ ] **Step 3: Verificar**

Run: `pnpm --filter erp build`
Expected: build sin errores.

- [ ] **Step 4: Commit**

```bash
git add apps/erp/app/clientes apps/erp/app/page.tsx
git commit -m "feat(erp): estado de cuenta del cliente y por-cobrar vencido en dashboard"
```

---

### Task 8: Regenerar tipos + CI verde + verificación integral (E2E)

**Files:**
- Modify: `packages/db/src/types.ts` (solo si el gen produce diff)
- Ninguno de producción (scripts en scratchpad, se borran al final).

- [ ] **Step 1: Pipeline**

Run: `pnpm --filter @suite/db gen` — commitear solo si hay diff (`chore(db): tipos regenerados`).
Run: `pnpm test` — Expected: `@suite/core` 59 (incl. cobranza), `@suite/auth` 2, `@suite/dte` 10, verdes.
Run: `pnpm supabase test db` — Expected: **77 asserts** verdes (6+16+19+10+10+7+9).
Run: `pnpm build --concurrency=1` — Expected: 3 apps compilan.

- [ ] **Step 2: E2E integral (script Node en scratchpad)**

Con Supabase local, un script (patrón de los planes anteriores: `createRequire` sobre `packages/auth/package.json`; usuario vía `admin.auth.admin.createUser` + `registrar_organizacion` como authenticated; RUT de org válido NO-fixture y distinto del demo, p.ej. `999999999`; clientes como authenticated — service_role no accede al schema `app`):

1. Org nueva + cliente (condición 30 días) + 2 facturas emitidas (insert admin: total 100000 reciente y 50000 con `emitido_en` hace 60 días).
2. Pago parcial (40000 a doc1) → saldo doc1 = 60000.
3. Pago multi-documento (80000: 60000 a doc1 + 20000 a doc2) → saldo doc1 = 0, doc2 = 30000.
4. Anular el pago 1 → saldo doc1 = 40000 restaurado... **OJO:** al anular el pago 1 (40000), doc1 queda 100000 − 60000 = 40000. Assert exacto.
5. NC emitida por 40000 referenciando doc1 (insert admin) → saldo doc1 = 0.
6. Vencimiento: doc2 aparece vencido (fecha_vencimiento < hoy) y el conteo "vencidos" (réplica de la query del dashboard) = 1 con monto 30000.
7. Aislamiento: segunda org no ve pagos/saldos de la primera.
8. Cleanup FK-safe (pagos_aplicaciones → pagos → documentos → clientes → … → auth.users), verificar 0 filas, borrar el script.

Si alguna aserción falla: defecto real → BLOCKED con detalle.

- [ ] **Step 3: Reporte**

Escribir `.superpowers/sdd/task-8-plan6-report.md` con salidas del pipeline y del E2E, evidencia de limpieza y `git status` limpio. Nota: click-through real por navegador queda para la demo con el usuario.

---

## Verificación final del plan

Al completar las 8 tasks:

- `pnpm test` — core (incl. cobranza 59), auth, dte verdes.
- `pnpm supabase test db` — 77 asserts pgTAP verdes.
- `pnpm build` — 3 apps compilan.
- Ciclo completo: pago multi-documento baja saldos → anulación con motivo los restaura → NC neta el saldo → vencidas detectadas en CxC y dashboard → estado de cuenta por cliente — todo aislado por empresa, saldos siempre derivados.
- Criterio de éxito del Plan 6 (spec §9) cumplido.
