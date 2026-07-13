# Plan 4 — Inventario + Proveedores (integración a Ventas) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El ERP maneja bodegas, proveedores y stock por bodega derivado de un libro de movimientos inmutable, y al emitir factura/boleta descuenta stock (restituyéndolo con nota de crédito), todo aislado por empresa y verificado contra el mock de ventas.

**Architecture:** Migración 0008 agrega `bodegas`, `proveedores`, `movimientos_stock` (libro inmutable con cantidad con signo), la vista `stock_actual` (`security_invoker`), la columna `productos.stock_minimo`, y RPCs security-definer (`bodega_por_defecto`, `registrar_entrada`, `registrar_ajuste`, `registrar_traslado`) que validan rol y pertenencia. La lógica pura de signos vive en `@suite/core` (TDD). El descuento por venta se engancha en `apps/erp/app/ventas/emitir.ts` insertando movimientos `salida`/`entrada` server-side. Pantallas ERP nuevas (Bodegas, Proveedores, Movimientos) más stock en Productos.

**Tech Stack:** Lo de Planes 1-3 (Next.js 15, React 19, TS strict, Supabase Postgres 17, pgTAP, Vitest, Tailwind v4, `@suite/*`). **Sin dependencias npm nuevas.**

## Global Constraints

- Node.js >= 20, pnpm >= 9, **Docker Desktop corriendo** (Supabase local + pgTAP).
- Windows/PowerShell 5.1: `&&` no funciona (usar `;`). Shells nuevas: `$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User');`
- TypeScript `strict: true`; identificadores ASCII; dominio y UI en español; mensajes de error al usuario en español claro.
- Montos/cantidades CLP y stock en enteros.
- **Multi-tenant obligatorio:** toda tabla lleva `empresa_id` + RLS + grants explícitos (`authenticated` espejando políticas; `service_role` DML completo; `anon` nada). Toda migración que cree tablas en `public` incluye sus grants (lección Plan 1).
- **FK compuestas por tenant:** `foreign key (empresa_id, x_id) references tabla (empresa_id, id)`. Requiere `unique (empresa_id, id)` en la tabla referenciada (productos/clientes/documentos_venta ya lo tienen tras migración 0007; bodegas lo agrega para sí).
- **Funciones que se llaman vía PostgREST van en el schema `public`** (el schema `app` no está expuesto por el Data API — lección Plan 3). Las security-definer que devuelven o tocan datos de un tenant DEBEN validar pertenencia con `app.tiene_rol_en_empresa`/`app.mis_empresas` (lección Plan 3: sin el check son cross-tenant).
- **Movimientos de stock inmutables:** solo `select`/`insert` para `authenticated`; **sin update ni delete**. Correcciones vía movimientos inversos. `cantidad` es entero con signo (entrada/traslado-destino +, salida/traslado-origen −, ajuste ±; `check cantidad <> 0`).
- **Escrituras server-side:** empresa SIEMPRE desde `obtenerEmpresaActiva()`, jamás del formulario. Todo update con `.select('id')` y 0 filas = error explícito.
- **Roles:** movimientos y bodegas → `dueno`/`admin`/`bodeguero`. Proveedores → `dueno`/`admin`. Lectura: cualquier miembro activo.
- **Stock insuficiente al emitir: NO bloquea** — se permite stock negativo (decisión "permitir y marcar"). El registro del movimiento nunca hace fallar la emisión.
- Puertos dev: web 3000, erp 3001, admin 3002. Supabase local: API 54321, Studio 54323.
- Scope npm `@suite/*`. Commits convencionales en español.

---

### Task 1: `@suite/core` — lógica de movimientos de stock (TDD)

**Files:**
- Create: `packages/core/src/stock.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/stock.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces (desde `@suite/core`):
  - `type TipoMovimiento = 'entrada' | 'salida' | 'ajuste' | 'traslado'`
  - `cantidadConSigno(tipo: 'entrada' | 'salida', cantidad: number): number` — entrada → `+cantidad`, salida → `-cantidad` (recibe cantidad positiva; lanza si `cantidad <= 0`).
  - `bajoMinimo(stock: number, minimo: number): boolean` — `stock <= minimo`.
  - `formatearCantidad(n: number): string` — entero con separador de miles, ej. `1500` → `"1.500"`, `-3` → `"-3"`.

- [ ] **Step 1: Escribir los tests que fallan**

`packages/core/src/stock.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { bajoMinimo, cantidadConSigno, formatearCantidad } from './stock'

describe('cantidadConSigno', () => {
  it('entrada suma, salida resta', () => {
    expect(cantidadConSigno('entrada', 10)).toBe(10)
    expect(cantidadConSigno('salida', 10)).toBe(-10)
  })
  it('rechaza cantidades no positivas', () => {
    expect(() => cantidadConSigno('entrada', 0)).toThrow()
    expect(() => cantidadConSigno('salida', -5)).toThrow()
  })
})

describe('bajoMinimo', () => {
  it('true cuando el stock es menor o igual al mínimo', () => {
    expect(bajoMinimo(3, 5)).toBe(true)
    expect(bajoMinimo(5, 5)).toBe(true)
    expect(bajoMinimo(6, 5)).toBe(false)
    expect(bajoMinimo(-1, 0)).toBe(true)
  })
})

describe('formatearCantidad', () => {
  it('separa miles y conserva el signo', () => {
    expect(formatearCantidad(1500)).toBe('1.500')
    expect(formatearCantidad(0)).toBe('0')
    expect(formatearCantidad(-3)).toBe('-3')
    expect(formatearCantidad(-12000)).toBe('-12.000')
  })
})
```

- [ ] **Step 2: Verificar que fallan**

Run: `pnpm --filter @suite/core test`
Expected: FAIL — `Cannot find module './stock'`. Los tests existentes siguen verdes.

- [ ] **Step 3: Implementar `stock.ts`**

`packages/core/src/stock.ts`:

```ts
export type TipoMovimiento = 'entrada' | 'salida' | 'ajuste' | 'traslado'

export function cantidadConSigno(tipo: 'entrada' | 'salida', cantidad: number): number {
  if (!Number.isInteger(cantidad) || cantidad <= 0) {
    throw new Error('La cantidad debe ser un entero positivo')
  }
  return tipo === 'salida' ? -cantidad : cantidad
}

export function bajoMinimo(stock: number, minimo: number): boolean {
  return stock <= minimo
}

export function formatearCantidad(n: number): string {
  const signo = n < 0 ? '-' : ''
  const abs = Math.abs(Math.trunc(n)).toString()
  return signo + abs.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}
```

Actualizar `packages/core/src/index.ts` agregando al final:

```ts
export * from './stock'
```

- [ ] **Step 4: Verificar GREEN**

Run: `pnpm --filter @suite/core test`
Expected: PASS — todas las suites verdes (las existentes + stock).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/stock.ts packages/core/src/stock.test.ts packages/core/src/index.ts
git commit -m "feat(core): lógica de movimientos de stock (signo, bajo mínimo, formato) TDD"
```

---

### Task 2: Migración de inventario (bodegas, proveedores, movimientos, stock)

**Files:**
- Create: `supabase/migrations/00000000000008_inventario.sql`

**Interfaces:**
- Consumes: `empresas`, `productos` (con `unique (empresa_id, id)`), `documentos_venta` (con `unique (empresa_id, id)`), `app.mis_empresas`, `app.tiene_rol_en_empresa`, `app.validar_rut`, `app.normalizar_rut`.
- Produces:
  - Tablas `bodegas`, `proveedores`, `movimientos_stock`; vista `stock_actual`; columna `productos.stock_minimo`.
  - `public.bodega_por_defecto(p_empresa uuid) returns uuid` — primera bodega activa; crea "Bodega Principal" si no hay. Valida pertenencia.
  - RPCs `public.registrar_entrada`, `public.registrar_ajuste`, `public.registrar_traslado`.

- [ ] **Step 1: Escribir la migración**

`supabase/migrations/00000000000008_inventario.sql`:

```sql
-- Inventario: bodegas, proveedores, movimientos de stock inmutables y stock actual.

-- ---------- productos: stock mínimo ----------
alter table public.productos add column if not exists stock_minimo integer not null default 0 check (stock_minimo >= 0);

-- ---------- Bodegas ----------
create table public.bodegas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  nombre text not null,
  direccion text,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  unique (empresa_id, nombre),
  unique (empresa_id, id)
);

-- ---------- Proveedores (espejo de clientes) ----------
create table public.proveedores (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  rut text not null check (rut = app.normalizar_rut(rut) and app.validar_rut(rut)),
  razon_social text not null,
  giro text,
  email text,
  telefono text,
  direccion text,
  comuna text,
  condicion_pago_dias integer not null default 0 check (condicion_pago_dias between 0 and 120),
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  unique (empresa_id, rut),
  unique (empresa_id, id)
);
create index proveedores_razon_social_idx on public.proveedores (empresa_id, razon_social);

-- ---------- Movimientos de stock (libro inmutable, cantidad con signo) ----------
create table public.movimientos_stock (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  producto_id uuid not null,
  bodega_id uuid not null,
  tipo text not null check (tipo in ('entrada', 'salida', 'ajuste', 'traslado')),
  cantidad integer not null check (cantidad <> 0),
  motivo text,
  proveedor_id uuid,
  referencia_documento_id uuid,
  creado_en timestamptz not null default now(),
  foreign key (empresa_id, producto_id) references public.productos (empresa_id, id),
  foreign key (empresa_id, bodega_id) references public.bodegas (empresa_id, id),
  foreign key (empresa_id, proveedor_id) references public.proveedores (empresa_id, id),
  foreign key (empresa_id, referencia_documento_id) references public.documentos_venta (empresa_id, id)
);
create index movimientos_stock_agg_idx on public.movimientos_stock (empresa_id, producto_id, bodega_id);
create index movimientos_stock_ref_idx on public.movimientos_stock (empresa_id, referencia_documento_id);

-- ---------- Vista de stock actual (security_invoker: la RLS del libro aplica al usuario) ----------
create view public.stock_actual with (security_invoker = true) as
  select empresa_id, producto_id, bodega_id, sum(cantidad)::integer as cantidad
  from public.movimientos_stock
  group by empresa_id, producto_id, bodega_id;

-- ---------- RLS ----------
alter table public.bodegas enable row level security;
alter table public.proveedores enable row level security;
alter table public.movimientos_stock enable row level security;

-- bodegas: ver miembros; crear/editar dueno/admin/bodeguero.
create policy "miembros ven bodegas" on public.bodegas
  for select to authenticated using (empresa_id in (select app.mis_empresas()));
create policy "bodegueros crean bodegas" on public.bodegas
  for insert to authenticated
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin', 'bodeguero']));
create policy "bodegueros editan bodegas" on public.bodegas
  for update to authenticated
  using (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin', 'bodeguero']))
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin', 'bodeguero']));

-- proveedores: ver miembros; crear/editar dueno/admin.
create policy "miembros ven proveedores" on public.proveedores
  for select to authenticated using (empresa_id in (select app.mis_empresas()));
create policy "duenos crean proveedores" on public.proveedores
  for insert to authenticated
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']));
create policy "duenos editan proveedores" on public.proveedores
  for update to authenticated
  using (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']))
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']));

-- movimientos: ver miembros; solo insert (inmutable). Escritura vía RPC/service_role.
create policy "miembros ven movimientos" on public.movimientos_stock
  for select to authenticated using (empresa_id in (select app.mis_empresas()));

-- ---------- Grants Data API (lección Plan 1) ----------
grant select, insert, update on public.bodegas, public.proveedores to authenticated;
grant select on public.movimientos_stock to authenticated;
grant select on public.stock_actual to authenticated;
grant select, insert, update, delete on public.bodegas, public.proveedores, public.movimientos_stock to service_role;

-- ---------- Bodega por defecto ----------
create or replace function public.bodega_por_defecto(p_empresa uuid)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_bodega uuid;
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'bodeguero', 'vendedor', 'contador']) then
    raise exception 'No perteneces a esta empresa';
  end if;
  select id into v_bodega from bodegas where empresa_id = p_empresa and activo order by creado_en limit 1;
  if v_bodega is null then
    insert into bodegas (empresa_id, nombre) values (p_empresa, 'Bodega Principal') returning id into v_bodega;
  end if;
  return v_bodega;
end $$;
revoke execute on function public.bodega_por_defecto(uuid) from anon, public;
grant execute on function public.bodega_por_defecto(uuid) to authenticated;

-- ---------- RPCs de movimientos (security definer, validan rol y pertenencia) ----------
create or replace function public.registrar_entrada(
  p_empresa uuid, p_producto uuid, p_bodega uuid, p_cantidad integer, p_proveedor uuid, p_motivo text
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'bodeguero']) then
    raise exception 'Tu rol no permite registrar movimientos de stock';
  end if;
  if p_cantidad <= 0 then raise exception 'La cantidad debe ser mayor a 0'; end if;
  insert into movimientos_stock (empresa_id, producto_id, bodega_id, tipo, cantidad, motivo, proveedor_id)
  values (p_empresa, p_producto, p_bodega, 'entrada', p_cantidad, p_motivo, p_proveedor)
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.registrar_entrada(uuid, uuid, uuid, integer, uuid, text) from anon, public;
grant execute on function public.registrar_entrada(uuid, uuid, uuid, integer, uuid, text) to authenticated;

create or replace function public.registrar_ajuste(
  p_empresa uuid, p_producto uuid, p_bodega uuid, p_cantidad integer, p_motivo text
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'bodeguero']) then
    raise exception 'Tu rol no permite ajustar stock';
  end if;
  if p_cantidad = 0 then raise exception 'El ajuste no puede ser 0'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'El ajuste requiere un motivo'; end if;
  insert into movimientos_stock (empresa_id, producto_id, bodega_id, tipo, cantidad, motivo)
  values (p_empresa, p_producto, p_bodega, 'ajuste', p_cantidad, p_motivo)
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.registrar_ajuste(uuid, uuid, uuid, integer, text) from anon, public;
grant execute on function public.registrar_ajuste(uuid, uuid, uuid, integer, text) to authenticated;

create or replace function public.registrar_traslado(
  p_empresa uuid, p_producto uuid, p_origen uuid, p_destino uuid, p_cantidad integer
)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'bodeguero']) then
    raise exception 'Tu rol no permite trasladar stock';
  end if;
  if p_cantidad <= 0 then raise exception 'La cantidad debe ser mayor a 0'; end if;
  if p_origen = p_destino then raise exception 'La bodega de origen y destino deben ser distintas'; end if;
  insert into movimientos_stock (empresa_id, producto_id, bodega_id, tipo, cantidad, motivo)
  values (p_empresa, p_producto, p_origen, 'traslado', -p_cantidad, 'Traslado'),
         (p_empresa, p_producto, p_destino, 'traslado', p_cantidad, 'Traslado');
end $$;
revoke execute on function public.registrar_traslado(uuid, uuid, uuid, uuid, integer) from anon, public;
grant execute on function public.registrar_traslado(uuid, uuid, uuid, uuid, integer) to authenticated;
```

- [ ] **Step 2: Aplicar y verificar**

Run: `pnpm supabase db reset`
Expected: aplica las 8 migraciones sin errores.

Run: `pnpm supabase db diff`
Expected: `No schema changes found`.

Run (grant por rol; contenedor con `docker ps --format '{{.Names}}'` → `supabase_db_...`):
`docker exec <db> psql -U postgres -d postgres -c "set role authenticated; select count(*) from bodegas; select count(*) from stock_actual"`
Expected: `0` en ambas sin error. Con `set role anon` → `permission denied`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/00000000000008_inventario.sql
git commit -m "feat(db): inventario (bodegas, proveedores, movimientos, stock) con RLS y RPCs"
```

---

### Task 3: pgTAP de inventario (aislamiento, inmutabilidad, stock, roles)

**Files:**
- Create: `supabase/tests/database/inventario.test.sql`

**Interfaces:**
- Consumes: esquema de Task 2. Patrón de impersonación de Planes 1-3.
- Produces: garantía verificable de aislamiento, inmutabilidad del libro, correctitud del stock, matriz de roles y validación de pertenencia de `bodega_por_defecto`.

- [ ] **Step 1: Escribir el test**

`supabase/tests/database/inventario.test.sql`:

```sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'ana@a.cl'),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'beto@b.cl'),
  ('00000000-0000-0000-0000-000000000000', '55555555-5555-5555-5555-555555555555', 'authenticated', 'authenticated', 'ces@a.cl');

insert into public.organizaciones (id, rut, razon_social)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '761111116', 'Org A'),
       ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '762222221', 'Org B');

insert into public.empresas (id, organizacion_id, rut, razon_social)
values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '761111116', 'Empresa A'),
       ('eeeeeeee-0000-0000-0000-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '762222221', 'Empresa B');

insert into public.miembros (usuario_id, organizacion_id, rol)
values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'dueno'),
       ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'dueno'),
       ('55555555-5555-5555-5555-555555555555', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'contador');

insert into public.productos (id, empresa_id, sku, nombre, precio_neto)
values ('99999999-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'P1', 'Producto A', 1000);

insert into public.bodegas (id, empresa_id, nombre)
values ('bbbb0000-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'Bodega A');

-- Movimientos seed (como postgres, antes de cambiar de rol): +10, -3 => stock 7.
insert into public.movimientos_stock (empresa_id, producto_id, bodega_id, tipo, cantidad)
values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '99999999-0000-0000-0000-aaaaaaaaaaaa', 'bbbb0000-0000-0000-0000-aaaaaaaaaaaa', 'entrada', 10),
       ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '99999999-0000-0000-0000-aaaaaaaaaaaa', 'bbbb0000-0000-0000-0000-aaaaaaaaaaaa', 'salida', -3);

-- Ana (duena A).
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- 1) La vista de stock suma el libro: 10 - 3 = 7.
select is(
  (select cantidad from stock_actual where producto_id = '99999999-0000-0000-0000-aaaaaaaaaaaa'),
  7, 'stock_actual suma los movimientos (10 - 3 = 7)'
);

-- 2) Ana registra una entrada vía RPC.
select lives_ok(
  $$select registrar_entrada('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '99999999-0000-0000-0000-aaaaaaaaaaaa', 'bbbb0000-0000-0000-0000-aaaaaaaaaaaa', 5, null, 'Compra')$$,
  'la dueña registra una entrada'
);
-- 3) El stock refleja la entrada: 7 + 5 = 12.
select is(
  (select cantidad from stock_actual where producto_id = '99999999-0000-0000-0000-aaaaaaaaaaaa'),
  12, 'stock_actual refleja la entrada (7 + 5 = 12)'
);

-- 4) El libro es inmutable: no se puede update (ni siquiera la dueña).
select throws_ok(
  $$update movimientos_stock set cantidad = 999 where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'$$,
  '42501', null, 'los movimientos de stock son inmutables (update denegado)'
);

-- 5) bodega_por_defecto devuelve la bodega existente.
select is(
  (select bodega_por_defecto('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa')),
  'bbbb0000-0000-0000-0000-aaaaaaaaaaaa'::uuid,
  'bodega_por_defecto devuelve la bodega activa existente'
);

-- 6) Beto (org B) no ve el stock de A.
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
select is( (select count(*) from stock_actual), 0::bigint, 'Beto no ve el stock de la empresa A' );

-- 7) Beto no puede registrar entradas en A (cross-tenant).
select throws_ok(
  $$select registrar_entrada('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '99999999-0000-0000-0000-aaaaaaaaaaaa', 'bbbb0000-0000-0000-0000-aaaaaaaaaaaa', 1, null, 'x')$$,
  'P0001', 'Tu rol no permite registrar movimientos de stock',
  'Beto no puede registrar movimientos en la empresa A'
);

-- 8) Ces (contador de A) no puede registrar movimientos (rol sin permiso).
set local request.jwt.claims to '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated"}';
select throws_ok(
  $$select registrar_entrada('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '99999999-0000-0000-0000-aaaaaaaaaaaa', 'bbbb0000-0000-0000-0000-aaaaaaaaaaaa', 1, null, 'x')$$,
  'P0001', 'Tu rol no permite registrar movimientos de stock',
  'el contador no puede registrar movimientos'
);

-- 9) Anónimo denegado de plano.
set local request.jwt.claims to '{"role": "anon"}';
set local role anon;
select throws_ok(
  'select count(*) from movimientos_stock',
  '42501', 'permission denied for table movimientos_stock',
  'un anónimo no puede consultar movimientos'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Correr y verificar**

Run: `pnpm supabase test db`
Expected: 5 archivos, 41 asserts (6 aislamiento + 7 registro + 10 maestros + 9 ventas + 9 inventario), todos verdes. Si un assert de inventario falla, el sospechoso es la migración de Task 2 — NO debilitar el test; diagnosticar o reportar BLOCKED.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/database/inventario.test.sql
git commit -m "test(db): aislamiento, inmutabilidad, stock y roles de inventario con pgTAP"
```

---

### Task 4: Regenerar tipos `@suite/db`

**Files:**
- Modify: `packages/db/src/types.ts` (regenerado)

**Interfaces:**
- Produces: tipo `Database` con `bodegas`, `proveedores`, `movimientos_stock`, la vista `stock_actual`, la columna `stock_minimo` en productos y las RPCs (`bodega_por_defecto`, `registrar_entrada`, `registrar_ajuste`, `registrar_traslado`).

- [ ] **Step 1: Regenerar y verificar**

Run: `pnpm --filter @suite/db gen`
Expected: `packages/db/src/types.ts` incluye las 3 tablas nuevas, la vista, la columna y las RPCs.

Run: `pnpm tsc --noEmit -p packages/db/tsconfig.json`
Expected: sin errores.

Run: `pnpm build --concurrency=1`
Expected: las 3 apps compilan.

- [ ] **Step 2: Commit**

```bash
git add packages/db/src/types.ts
git commit -m "feat(db): tipos regenerados con tablas de inventario"
```

---

### Task 5: ERP — CRUD de Bodegas

**Files:**
- Create: `apps/erp/app/inventario/bodegas/page.tsx`, `apps/erp/app/inventario/bodegas/acciones.ts`, `apps/erp/app/inventario/bodegas/nueva/page.tsx`, `apps/erp/app/inventario/bodegas/[id]/page.tsx`, `apps/erp/componentes/formulario-bodega.tsx`
- Modify: `apps/erp/app/layout.tsx` (agregar "Inventario" al NAV antes de "Configuración")

**Interfaces:**
- Consumes: `obtenerEmpresaActiva`, `@suite/ui`, `crearClienteServidor`, tabla `bodegas`, `EstadoForm` de `apps/erp/app/tipos.ts`.
- Produces: Server Actions `guardarBodega(prev, formData): Promise<EstadoForm>` (crea/edita según `id`) y `alternarActivoBodega(formData)`. Patrón idéntico al CRUD de clientes de Plan 2.

- [ ] **Step 1: Server Actions**

`apps/erp/app/inventario/bodegas/acciones.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import type { EstadoForm } from '../../tipos'

export async function guardarBodega(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const id = String(formData.get('id') ?? '')
  const nombre = String(formData.get('nombre') ?? '').trim()
  const direccion = String(formData.get('direccion') ?? '').trim()
  if (nombre === '') return { error: 'El nombre de la bodega es obligatorio' }

  const datos = { nombre, direccion: direccion || null }
  const supabase = await crearClienteServidor()
  if (id) {
    const { data, error } = await supabase.from('bodegas').update(datos).eq('id', id).eq('empresa_id', activa.id).select('id')
    if (error) {
      if (error.code === '23505') return { error: 'Ya existe una bodega con ese nombre' }
      return { error: 'No se pudo guardar la bodega' }
    }
    if ((data ?? []).length === 0) return { error: 'No se pudo guardar: tu rol no permite editar bodegas' }
  } else {
    const { error } = await supabase.from('bodegas').insert({ ...datos, empresa_id: activa.id })
    if (error) {
      if (error.code === '23505') return { error: 'Ya existe una bodega con ese nombre' }
      if (error.code === '42501') return { error: 'Tu rol no permite crear bodegas' }
      return { error: 'No se pudo crear la bodega' }
    }
  }
  revalidatePath('/inventario/bodegas')
  redirect('/inventario/bodegas')
}

export async function alternarActivoBodega(formData: FormData): Promise<void> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return
  const id = String(formData.get('id') ?? '')
  const activo = String(formData.get('activo') ?? '') === 'true'
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase.from('bodegas').update({ activo: !activo }).eq('id', id).eq('empresa_id', activa.id).select('id')
  if (error || (data ?? []).length === 0) { console.error('alternarActivoBodega:', error ?? 'sin filas'); return }
  revalidatePath('/inventario/bodegas')
}
```

- [ ] **Step 2: Lista**

`apps/erp/app/inventario/bodegas/page.tsx`:

```tsx
import Link from 'next/link'
import { crearClienteServidor } from '@suite/auth/server'
import { Boton, Encabezado, Insignia, Tabla, Td, Th, Tr } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { alternarActivoBodega } from './acciones'

export default async function PaginaBodegas() {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const supabase = await crearClienteServidor()
  const { data: bodegas } = await supabase
    .from('bodegas').select('id, nombre, direccion, activo').eq('empresa_id', activa.id).order('nombre')
  return (
    <div>
      <Encabezado titulo="Bodegas">
        <Link href="/inventario/bodegas/nueva"><Boton>Nueva bodega</Boton></Link>
      </Encabezado>
      <Tabla>
        <thead><tr><Th>Nombre</Th><Th>Dirección</Th><Th>Estado</Th><Th /></tr></thead>
        <tbody>
          {(bodegas ?? []).map((b) => (
            <Tr key={b.id}>
              <Td><Link className="text-marca-700 hover:underline" href={`/inventario/bodegas/${b.id}`}>{b.nombre}</Link></Td>
              <Td>{b.direccion ?? '—'}</Td>
              <Td>{b.activo ? <Insignia tono="verde">Activa</Insignia> : <Insignia tono="gris">Inactiva</Insignia>}</Td>
              <Td>
                <form action={alternarActivoBodega}>
                  <input type="hidden" name="id" value={b.id} /><input type="hidden" name="activo" value={String(b.activo)} />
                  <Boton variante="secundario" type="submit" className="px-2 py-1 text-xs">{b.activo ? 'Desactivar' : 'Reactivar'}</Boton>
                </form>
              </Td>
            </Tr>
          ))}
          {(bodegas ?? []).length === 0 && <Tr><Td colSpan={4} className="py-8 text-center text-slate-500">No hay bodegas. Crea la primera.</Td></Tr>}
        </tbody>
      </Tabla>
    </div>
  )
}
```

- [ ] **Step 3: Formulario (client) y páginas crear/editar**

`apps/erp/componentes/formulario-bodega.tsx`:

```tsx
'use client'

import { useActionState } from 'react'
import { Boton, Campo, Entrada, Tarjeta } from '@suite/ui'
import type { EstadoForm } from '../app/tipos'

export interface BodegaEditable { id?: string; nombre: string; direccion: string }

export function FormularioBodega({
  accion,
  inicial = { nombre: '', direccion: '' },
}: {
  accion: (prev: EstadoForm, formData: FormData) => Promise<EstadoForm>
  inicial?: BodegaEditable
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoForm)
  return (
    <Tarjeta className="max-w-xl">
      <form action={enviar} className="grid grid-cols-1 gap-4">
        {inicial.id && <input type="hidden" name="id" value={inicial.id} />}
        <Campo etiqueta="Nombre *"><Entrada name="nombre" defaultValue={inicial.nombre} required /></Campo>
        <Campo etiqueta="Dirección"><Entrada name="direccion" defaultValue={inicial.direccion} /></Campo>
        <div className="flex items-center justify-end gap-2">
          {estado.error && <span className="mr-auto text-sm text-red-600">{estado.error}</span>}
          <Boton type="submit" disabled={pendiente}>{pendiente ? 'Guardando…' : 'Guardar'}</Boton>
        </div>
      </form>
    </Tarjeta>
  )
}
```

`apps/erp/app/inventario/bodegas/nueva/page.tsx`:

```tsx
import { Encabezado } from '@suite/ui'
import { FormularioBodega } from '../../../../componentes/formulario-bodega'
import { obtenerEmpresaActiva } from '../../../../lib/empresa-activa'
import { guardarBodega } from '../acciones'

export default async function NuevaBodega() {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  return (
    <div>
      <Encabezado titulo="Nueva bodega" />
      <FormularioBodega accion={guardarBodega} />
    </div>
  )
}
```

`apps/erp/app/inventario/bodegas/[id]/page.tsx`:

```tsx
import { notFound } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { Encabezado } from '@suite/ui'
import { FormularioBodega } from '../../../../componentes/formulario-bodega'
import { obtenerEmpresaActiva } from '../../../../lib/empresa-activa'
import { guardarBodega } from '../acciones'

export default async function EditarBodega({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const supabase = await crearClienteServidor()
  const { data: bodega } = await supabase.from('bodegas').select('*').eq('id', id).eq('empresa_id', activa.id).single()
  if (!bodega) notFound()
  return (
    <div>
      <Encabezado titulo={`Editar: ${bodega.nombre}`} />
      <FormularioBodega accion={guardarBodega} inicial={{ id: bodega.id, nombre: bodega.nombre, direccion: bodega.direccion ?? '' }} />
    </div>
  )
}
```

Modificar `apps/erp/app/layout.tsx` — agregar al `NAV` antes de "Configuración":

```tsx
  { href: '/inventario', etiqueta: 'Inventario' },
```

- [ ] **Step 4: Verificar**

Run: `pnpm --filter erp build`
Expected: build sin errores.

Verificación: dev server → GET `/inventario/bodegas` sin cookies → 307 al login. El CRUD completo se prueba en Task 10.

- [ ] **Step 5: Commit**

```bash
git add apps/erp/app/inventario/bodegas apps/erp/componentes/formulario-bodega.tsx apps/erp/app/layout.tsx
git commit -m "feat(erp): CRUD de bodegas"
```

---

### Task 6: ERP — CRUD de Proveedores

**Files:**
- Create: `apps/erp/app/inventario/proveedores/page.tsx`, `apps/erp/app/inventario/proveedores/acciones.ts`, `apps/erp/app/inventario/proveedores/nuevo/page.tsx`, `apps/erp/app/inventario/proveedores/[id]/page.tsx`, `apps/erp/componentes/formulario-proveedor.tsx`

**Interfaces:**
- Consumes: `obtenerEmpresaActiva`, `@suite/ui`, `validarRut`/`limpiarRut`/`formatearRut` de `@suite/core`, tabla `proveedores`, `EstadoForm`.
- Produces: `guardarProveedor(prev, formData): Promise<EstadoForm>` y `alternarActivoProveedor(formData)`.

- [ ] **Step 1: Server Actions**

`apps/erp/app/inventario/proveedores/acciones.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { limpiarRut, validarRut } from '@suite/core'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import type { EstadoForm } from '../../tipos'

export async function guardarProveedor(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const id = String(formData.get('id') ?? '')
  const rutCrudo = String(formData.get('rut') ?? '').trim()
  const razonSocial = String(formData.get('razon_social') ?? '').trim()
  const email = String(formData.get('email') ?? '').trim()
  const condicionCruda = String(formData.get('condicion_pago_dias') ?? '').trim()

  if (!validarRut(rutCrudo)) return { error: 'El RUT ingresado no es válido' }
  if (razonSocial === '') return { error: 'La razón social es obligatoria' }
  if (email !== '' && !email.includes('@')) return { error: 'El correo no es válido' }
  const condicionPagoDias = condicionCruda === '' ? 0 : Number(condicionCruda)
  if (!Number.isInteger(condicionPagoDias) || condicionPagoDias < 0 || condicionPagoDias > 120) {
    return { error: 'La condición de pago debe ser un entero entre 0 y 120 días' }
  }

  const datos = {
    rut: limpiarRut(rutCrudo),
    razon_social: razonSocial,
    giro: String(formData.get('giro') ?? '').trim() || null,
    email: email || null,
    telefono: String(formData.get('telefono') ?? '').trim() || null,
    direccion: String(formData.get('direccion') ?? '').trim() || null,
    comuna: String(formData.get('comuna') ?? '').trim() || null,
    condicion_pago_dias: condicionPagoDias,
  }

  const supabase = await crearClienteServidor()
  if (id) {
    const { data, error } = await supabase.from('proveedores').update(datos).eq('id', id).eq('empresa_id', activa.id).select('id')
    if (error) {
      if (error.code === '23505') return { error: 'Ya existe un proveedor con ese RUT' }
      if (error.code === '42501') return { error: 'Tu rol no permite editar proveedores' }
      return { error: 'No se pudo guardar el proveedor' }
    }
    if ((data ?? []).length === 0) return { error: 'No se pudo guardar: el proveedor no existe o tu rol no permite editarlo' }
  } else {
    const { error } = await supabase.from('proveedores').insert({ ...datos, empresa_id: activa.id })
    if (error) {
      if (error.code === '23505') return { error: 'Ya existe un proveedor con ese RUT' }
      if (error.code === '42501') return { error: 'Tu rol no permite crear proveedores' }
      return { error: 'No se pudo crear el proveedor' }
    }
  }
  revalidatePath('/inventario/proveedores')
  redirect('/inventario/proveedores')
}

export async function alternarActivoProveedor(formData: FormData): Promise<void> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return
  const id = String(formData.get('id') ?? '')
  const activo = String(formData.get('activo') ?? '') === 'true'
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase.from('proveedores').update({ activo: !activo }).eq('id', id).eq('empresa_id', activa.id).select('id')
  if (error || (data ?? []).length === 0) { console.error('alternarActivoProveedor:', error ?? 'sin filas'); return }
  revalidatePath('/inventario/proveedores')
}
```

- [ ] **Step 2: Lista**

`apps/erp/app/inventario/proveedores/page.tsx`:

```tsx
import Link from 'next/link'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearRut } from '@suite/core'
import { Boton, Encabezado, Entrada, Insignia, Tabla, Td, Th, Tr } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { alternarActivoProveedor } from './acciones'

export default async function PaginaProveedores({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = '' } = await searchParams
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const supabase = await crearClienteServidor()
  let consulta = supabase.from('proveedores').select('id, rut, razon_social, comuna, activo').eq('empresa_id', activa.id).order('razon_social')
  const qLimpia = q.replace(/[,()]/g, ' ').trim()
  if (qLimpia) consulta = consulta.or(`razon_social.ilike.%${qLimpia}%,rut.ilike.%${qLimpia}%`)
  const { data: proveedores } = await consulta
  return (
    <div>
      <Encabezado titulo="Proveedores">
        <Link href="/inventario/proveedores/nuevo"><Boton>Nuevo proveedor</Boton></Link>
      </Encabezado>
      <form className="mb-4 flex items-center gap-3" action="/inventario/proveedores" method="get">
        <Entrada name="q" defaultValue={q} placeholder="Buscar por razón social o RUT…" className="max-w-xs" />
        <Boton variante="secundario" type="submit">Buscar</Boton>
      </form>
      <Tabla>
        <thead><tr><Th>RUT</Th><Th>Razón social</Th><Th>Comuna</Th><Th>Estado</Th><Th /></tr></thead>
        <tbody>
          {(proveedores ?? []).map((p) => (
            <Tr key={p.id}>
              <Td className="font-mono">{formatearRut(p.rut)}</Td>
              <Td><Link className="text-marca-700 hover:underline" href={`/inventario/proveedores/${p.id}`}>{p.razon_social}</Link></Td>
              <Td>{p.comuna ?? '—'}</Td>
              <Td>{p.activo ? <Insignia tono="verde">Activo</Insignia> : <Insignia tono="gris">Inactivo</Insignia>}</Td>
              <Td>
                <form action={alternarActivoProveedor}>
                  <input type="hidden" name="id" value={p.id} /><input type="hidden" name="activo" value={String(p.activo)} />
                  <Boton variante="secundario" type="submit" className="px-2 py-1 text-xs">{p.activo ? 'Desactivar' : 'Reactivar'}</Boton>
                </form>
              </Td>
            </Tr>
          ))}
          {(proveedores ?? []).length === 0 && <Tr><Td colSpan={5} className="py-8 text-center text-slate-500">No hay proveedores {q ? 'que coincidan' : 'todavía'}.</Td></Tr>}
        </tbody>
      </Tabla>
    </div>
  )
}
```

- [ ] **Step 3: Formulario y páginas crear/editar**

`apps/erp/componentes/formulario-proveedor.tsx`:

```tsx
'use client'

import { useActionState } from 'react'
import { Boton, Campo, Entrada, Tarjeta } from '@suite/ui'
import type { EstadoForm } from '../app/tipos'

export interface ProveedorEditable {
  id?: string; rut: string; razon_social: string; giro: string; email: string
  telefono: string; direccion: string; comuna: string; condicion_pago_dias: number
}

const VACIO: ProveedorEditable = { rut: '', razon_social: '', giro: '', email: '', telefono: '', direccion: '', comuna: '', condicion_pago_dias: 0 }

export function FormularioProveedor({
  accion, inicial = VACIO,
}: {
  accion: (prev: EstadoForm, formData: FormData) => Promise<EstadoForm>
  inicial?: ProveedorEditable
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoForm)
  return (
    <Tarjeta className="max-w-2xl">
      <form action={enviar} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {inicial.id && <input type="hidden" name="id" value={inicial.id} />}
        <Campo etiqueta="RUT *"><Entrada name="rut" defaultValue={inicial.rut} placeholder="76.543.210-3" required /></Campo>
        <Campo etiqueta="Razón social *"><Entrada name="razon_social" defaultValue={inicial.razon_social} required /></Campo>
        <Campo etiqueta="Giro"><Entrada name="giro" defaultValue={inicial.giro} /></Campo>
        <Campo etiqueta="Correo"><Entrada name="email" type="email" defaultValue={inicial.email} /></Campo>
        <Campo etiqueta="Teléfono"><Entrada name="telefono" defaultValue={inicial.telefono} /></Campo>
        <Campo etiqueta="Comuna"><Entrada name="comuna" defaultValue={inicial.comuna} /></Campo>
        <div className="sm:col-span-2"><Campo etiqueta="Dirección"><Entrada name="direccion" defaultValue={inicial.direccion} /></Campo></div>
        <Campo etiqueta="Condición de pago (días; 0 = contado)">
          <Entrada name="condicion_pago_dias" inputMode="numeric" defaultValue={inicial.condicion_pago_dias} />
        </Campo>
        <div className="flex items-center justify-end gap-2 sm:col-span-2">
          {estado.error && <span className="mr-auto text-sm text-red-600">{estado.error}</span>}
          <Boton type="submit" disabled={pendiente}>{pendiente ? 'Guardando…' : 'Guardar'}</Boton>
        </div>
      </form>
    </Tarjeta>
  )
}
```

`apps/erp/app/inventario/proveedores/nuevo/page.tsx`:

```tsx
import { Encabezado } from '@suite/ui'
import { FormularioProveedor } from '../../../../componentes/formulario-proveedor'
import { obtenerEmpresaActiva } from '../../../../lib/empresa-activa'
import { guardarProveedor } from '../acciones'

export default async function NuevoProveedor() {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  return (
    <div>
      <Encabezado titulo="Nuevo proveedor" />
      <FormularioProveedor accion={guardarProveedor} />
    </div>
  )
}
```

`apps/erp/app/inventario/proveedores/[id]/page.tsx`:

```tsx
import { notFound } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearRut } from '@suite/core'
import { Encabezado } from '@suite/ui'
import { FormularioProveedor } from '../../../../componentes/formulario-proveedor'
import { obtenerEmpresaActiva } from '../../../../lib/empresa-activa'
import { guardarProveedor } from '../acciones'

export default async function EditarProveedor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const supabase = await crearClienteServidor()
  const { data: prov } = await supabase.from('proveedores').select('*').eq('id', id).eq('empresa_id', activa.id).single()
  if (!prov) notFound()
  return (
    <div>
      <Encabezado titulo={`Editar: ${prov.razon_social}`} />
      <FormularioProveedor accion={guardarProveedor} inicial={{
        id: prov.id, rut: formatearRut(prov.rut), razon_social: prov.razon_social, giro: prov.giro ?? '',
        email: prov.email ?? '', telefono: prov.telefono ?? '', direccion: prov.direccion ?? '', comuna: prov.comuna ?? '',
        condicion_pago_dias: prov.condicion_pago_dias,
      }} />
    </div>
  )
}
```

- [ ] **Step 4: Verificar**

Run: `pnpm --filter erp build`
Expected: build sin errores.

- [ ] **Step 5: Commit**

```bash
git add apps/erp/app/inventario/proveedores apps/erp/componentes/formulario-proveedor.tsx
git commit -m "feat(erp): CRUD de proveedores"
```

---

### Task 7: ERP — Movimientos de stock (lista + entrada/ajuste/traslado)

**Files:**
- Create: `apps/erp/app/inventario/page.tsx` (índice de Inventario), `apps/erp/app/inventario/movimientos/page.tsx`, `apps/erp/app/inventario/movimientos/acciones.ts`, `apps/erp/componentes/formulario-movimiento.tsx`

**Interfaces:**
- Consumes: `obtenerEmpresaActiva`, `@suite/ui`, `formatearCantidad` de `@suite/core`, RPCs `registrar_entrada`/`registrar_ajuste`/`registrar_traslado`, `bodega_por_defecto`, tablas `movimientos_stock`/`productos`/`bodegas`/`proveedores`.
- Produces: Server Actions `registrarEntrada(prev, formData)`, `registrarAjuste(prev, formData)`, `registrarTraslado(prev, formData)` (todas `Promise<EstadoForm>`).

- [ ] **Step 1: Índice de Inventario**

`apps/erp/app/inventario/page.tsx`:

```tsx
import Link from 'next/link'
import { Encabezado, Tarjeta } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'

const SECCIONES = [
  { href: '/inventario/movimientos', titulo: 'Movimientos', desc: 'Entradas, ajustes y traslados de stock' },
  { href: '/inventario/bodegas', titulo: 'Bodegas', desc: 'Administra tus bodegas' },
  { href: '/inventario/proveedores', titulo: 'Proveedores', desc: 'Cartera de proveedores' },
]

export default async function IndiceInventario() {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  return (
    <div>
      <Encabezado titulo="Inventario" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {SECCIONES.map((s) => (
          <Link key={s.href} href={s.href}>
            <Tarjeta className="hover:border-marca-400">
              <p className="text-lg font-semibold text-slate-900">{s.titulo}</p>
              <p className="mt-1 text-sm text-slate-500">{s.desc}</p>
            </Tarjeta>
          </Link>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Server Actions de movimientos**

`apps/erp/app/inventario/movimientos/acciones.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@suite/auth/server'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import type { EstadoForm } from '../../tipos'

function enteroPositivo(v: FormDataEntryValue | null): number | null {
  const n = Number(String(v ?? '').trim())
  return Number.isInteger(n) && n > 0 ? n : null
}

export async function registrarEntrada(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  const producto = String(formData.get('producto_id') ?? '')
  const bodega = String(formData.get('bodega_id') ?? '')
  const cantidad = enteroPositivo(formData.get('cantidad'))
  const proveedor = String(formData.get('proveedor_id') ?? '') || null
  const motivo = String(formData.get('motivo') ?? '').trim() || null
  if (!producto || !bodega) return { error: 'Selecciona producto y bodega' }
  if (cantidad === null) return { error: 'La cantidad debe ser un entero mayor a 0' }
  const supabase = await crearClienteServidor()
  const { error } = await supabase.rpc('registrar_entrada', {
    p_empresa: activa.id, p_producto: producto, p_bodega: bodega, p_cantidad: cantidad, p_proveedor: proveedor, p_motivo: motivo,
  })
  if (error) return { error: error.message.includes('rol') ? 'Tu rol no permite registrar entradas' : 'No se pudo registrar la entrada' }
  revalidatePath('/inventario/movimientos')
  return {}
}

export async function registrarAjuste(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  const producto = String(formData.get('producto_id') ?? '')
  const bodega = String(formData.get('bodega_id') ?? '')
  const cantidad = Number(String(formData.get('cantidad') ?? '').trim())
  const motivo = String(formData.get('motivo') ?? '').trim()
  if (!producto || !bodega) return { error: 'Selecciona producto y bodega' }
  if (!Number.isInteger(cantidad) || cantidad === 0) return { error: 'El ajuste debe ser un entero distinto de 0 (usa negativo para restar)' }
  if (motivo === '') return { error: 'El ajuste requiere un motivo' }
  const supabase = await crearClienteServidor()
  const { error } = await supabase.rpc('registrar_ajuste', {
    p_empresa: activa.id, p_producto: producto, p_bodega: bodega, p_cantidad: cantidad, p_motivo: motivo,
  })
  if (error) return { error: error.message.includes('rol') ? 'Tu rol no permite ajustar stock' : 'No se pudo registrar el ajuste' }
  revalidatePath('/inventario/movimientos')
  return {}
}

export async function registrarTraslado(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  const producto = String(formData.get('producto_id') ?? '')
  const origen = String(formData.get('bodega_origen') ?? '')
  const destino = String(formData.get('bodega_destino') ?? '')
  const cantidad = enteroPositivo(formData.get('cantidad'))
  if (!producto || !origen || !destino) return { error: 'Selecciona producto y ambas bodegas' }
  if (origen === destino) return { error: 'La bodega de origen y destino deben ser distintas' }
  if (cantidad === null) return { error: 'La cantidad debe ser un entero mayor a 0' }
  const supabase = await crearClienteServidor()
  const { error } = await supabase.rpc('registrar_traslado', {
    p_empresa: activa.id, p_producto: producto, p_origen: origen, p_destino: destino, p_cantidad: cantidad,
  })
  if (error) return { error: error.message.includes('rol') ? 'Tu rol no permite trasladar stock' : 'No se pudo registrar el traslado' }
  revalidatePath('/inventario/movimientos')
  return {}
}
```

- [ ] **Step 3: Formulario de movimientos (client, con pestañas) y lista**

`apps/erp/componentes/formulario-movimiento.tsx`:

```tsx
'use client'

import { useActionState, useState } from 'react'
import { Boton, Campo, Entrada, Selector, Tarjeta } from '@suite/ui'
import type { EstadoForm } from '../app/tipos'

interface Opcion { id: string; nombre: string }

export function FormularioMovimiento({
  productos, bodegas, proveedores, accionEntrada, accionAjuste, accionTraslado,
}: {
  productos: Opcion[]
  bodegas: Opcion[]
  proveedores: Opcion[]
  accionEntrada: (prev: EstadoForm, formData: FormData) => Promise<EstadoForm>
  accionAjuste: (prev: EstadoForm, formData: FormData) => Promise<EstadoForm>
  accionTraslado: (prev: EstadoForm, formData: FormData) => Promise<EstadoForm>
}) {
  const [tab, setTab] = useState<'entrada' | 'ajuste' | 'traslado'>('entrada')
  const [eEntrada, fEntrada, pEntrada] = useActionState(accionEntrada, {} as EstadoForm)
  const [eAjuste, fAjuste, pAjuste] = useActionState(accionAjuste, {} as EstadoForm)
  const [eTraslado, fTraslado, pTraslado] = useActionState(accionTraslado, {} as EstadoForm)

  const tabClase = (t: string) => `rounded-md px-3 py-1.5 text-sm ${tab === t ? 'bg-marca-600 text-white' : 'bg-slate-100 text-slate-700'}`
  const selProducto = <Selector name="producto_id" required defaultValue=""><option value="" disabled>Producto…</option>{productos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</Selector>

  return (
    <Tarjeta className="mb-6 max-w-2xl">
      <div className="mb-4 flex gap-2">
        <button type="button" className={tabClase('entrada')} onClick={() => setTab('entrada')}>Entrada</button>
        <button type="button" className={tabClase('ajuste')} onClick={() => setTab('ajuste')}>Ajuste</button>
        <button type="button" className={tabClase('traslado')} onClick={() => setTab('traslado')}>Traslado</button>
      </div>

      {tab === 'entrada' && (
        <form action={fEntrada} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Campo etiqueta="Producto *">{selProducto}</Campo>
          <Campo etiqueta="Bodega *"><Selector name="bodega_id" required defaultValue=""><option value="" disabled>Bodega…</option>{bodegas.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}</Selector></Campo>
          <Campo etiqueta="Cantidad *"><Entrada name="cantidad" inputMode="numeric" required /></Campo>
          <Campo etiqueta="Proveedor"><Selector name="proveedor_id" defaultValue=""><option value="">Sin proveedor</option>{proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</Selector></Campo>
          <div className="sm:col-span-2"><Campo etiqueta="Motivo"><Entrada name="motivo" placeholder="Ej: Compra, ingreso inicial" /></Campo></div>
          <div className="flex items-center justify-end gap-2 sm:col-span-2">{eEntrada.error && <span className="mr-auto text-sm text-red-600">{eEntrada.error}</span>}<Boton type="submit" disabled={pEntrada}>{pEntrada ? 'Registrando…' : 'Registrar entrada'}</Boton></div>
        </form>
      )}

      {tab === 'ajuste' && (
        <form action={fAjuste} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Campo etiqueta="Producto *">{selProducto}</Campo>
          <Campo etiqueta="Bodega *"><Selector name="bodega_id" required defaultValue=""><option value="" disabled>Bodega…</option>{bodegas.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}</Selector></Campo>
          <Campo etiqueta="Cantidad (± ; negativo resta) *"><Entrada name="cantidad" inputMode="numeric" required /></Campo>
          <Campo etiqueta="Motivo *"><Entrada name="motivo" required placeholder="Ej: Merma, conteo físico" /></Campo>
          <div className="flex items-center justify-end gap-2 sm:col-span-2">{eAjuste.error && <span className="mr-auto text-sm text-red-600">{eAjuste.error}</span>}<Boton type="submit" disabled={pAjuste}>{pAjuste ? 'Registrando…' : 'Registrar ajuste'}</Boton></div>
        </form>
      )}

      {tab === 'traslado' && (
        <form action={fTraslado} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Campo etiqueta="Producto *">{selProducto}</Campo>
          <Campo etiqueta="Cantidad *"><Entrada name="cantidad" inputMode="numeric" required /></Campo>
          <Campo etiqueta="Desde bodega *"><Selector name="bodega_origen" required defaultValue=""><option value="" disabled>Origen…</option>{bodegas.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}</Selector></Campo>
          <Campo etiqueta="Hacia bodega *"><Selector name="bodega_destino" required defaultValue=""><option value="" disabled>Destino…</option>{bodegas.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}</Selector></Campo>
          <div className="flex items-center justify-end gap-2 sm:col-span-2">{eTraslado.error && <span className="mr-auto text-sm text-red-600">{eTraslado.error}</span>}<Boton type="submit" disabled={pTraslado}>{pTraslado ? 'Registrando…' : 'Registrar traslado'}</Boton></div>
        </form>
      )}
    </Tarjeta>
  )
}
```

`apps/erp/app/inventario/movimientos/page.tsx`:

```tsx
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCantidad } from '@suite/core'
import { Encabezado, Insignia, Tabla, Td, Th, Tr } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { FormularioMovimiento } from '../../../componentes/formulario-movimiento'
import { registrarAjuste, registrarEntrada, registrarTraslado } from './acciones'

const TONO: Record<string, 'verde' | 'amarillo' | 'rojo' | 'gris'> = { entrada: 'verde', salida: 'rojo', ajuste: 'amarillo', traslado: 'gris' }

export default async function PaginaMovimientos() {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const supabase = await crearClienteServidor()
  const [{ data: productos }, { data: bodegas }, { data: proveedores }, { data: movimientos }] = await Promise.all([
    supabase.from('productos').select('id, nombre').eq('empresa_id', activa.id).eq('activo', true).order('nombre'),
    supabase.from('bodegas').select('id, nombre').eq('empresa_id', activa.id).eq('activo', true).order('nombre'),
    supabase.from('proveedores').select('id, razon_social').eq('empresa_id', activa.id).eq('activo', true).order('razon_social'),
    supabase.from('movimientos_stock').select('id, tipo, cantidad, motivo, creado_en, productos (nombre), bodegas (nombre)').eq('empresa_id', activa.id).order('creado_en', { ascending: false }).limit(100),
  ])
  return (
    <div>
      <Encabezado titulo="Movimientos de stock" />
      <FormularioMovimiento
        productos={(productos ?? []).map((p) => ({ id: p.id, nombre: p.nombre }))}
        bodegas={(bodegas ?? []).map((b) => ({ id: b.id, nombre: b.nombre }))}
        proveedores={(proveedores ?? []).map((p) => ({ id: p.id, nombre: p.razon_social }))}
        accionEntrada={registrarEntrada} accionAjuste={registrarAjuste} accionTraslado={registrarTraslado}
      />
      <Tabla>
        <thead><tr><Th>Fecha</Th><Th>Tipo</Th><Th>Producto</Th><Th>Bodega</Th><Th className="text-right">Cantidad</Th><Th>Motivo</Th></tr></thead>
        <tbody>
          {(movimientos ?? []).map((m) => (
            <Tr key={m.id}>
              <Td>{new Date(m.creado_en).toLocaleDateString('es-CL')}</Td>
              <Td><Insignia tono={TONO[m.tipo] ?? 'gris'}>{m.tipo}</Insignia></Td>
              <Td>{m.productos?.nombre ?? '—'}</Td>
              <Td>{m.bodegas?.nombre ?? '—'}</Td>
              <Td className="text-right font-mono">{formatearCantidad(m.cantidad)}</Td>
              <Td>{m.motivo ?? '—'}</Td>
            </Tr>
          ))}
          {(movimientos ?? []).length === 0 && <Tr><Td colSpan={6} className="py-8 text-center text-slate-500">No hay movimientos todavía.</Td></Tr>}
        </tbody>
      </Tabla>
    </div>
  )
}
```

- [ ] **Step 4: Verificar**

Run: `pnpm --filter erp build`
Expected: build sin errores.

- [ ] **Step 5: Commit**

```bash
git add apps/erp/app/inventario/page.tsx apps/erp/app/inventario/movimientos apps/erp/componentes/formulario-movimiento.tsx
git commit -m "feat(erp): movimientos de stock (entrada, ajuste, traslado) y lista"
```

---

### Task 8: ERP — stock por bodega en Productos + stock mínimo

**Files:**
- Modify: `apps/erp/app/productos/page.tsx` (columna de stock total + alerta), `apps/erp/app/productos/[id]/page.tsx` (stock por bodega), `apps/erp/componentes/formulario-producto.tsx` (campo `stock_minimo`), `apps/erp/app/productos/acciones.ts` (persistir `stock_minimo`), `apps/erp/app/page.tsx` (dashboard: contador de stock crítico)

**Interfaces:**
- Consumes: vista `stock_actual`, `bajoMinimo`/`formatearCantidad` de `@suite/core`, `productos.stock_minimo`.
- Produces: la lista de productos muestra stock total y marca los bajo mínimo; el detalle muestra stock por bodega; el formulario guarda `stock_minimo`; el dashboard cuenta productos críticos.

- [ ] **Step 1: Lista de productos con stock total y alerta**

En `apps/erp/app/productos/page.tsx`, tras cargar los productos, agregar la carga del stock agregado y mostrarlo. Reemplazar el bloque que arma `consulta`/`data: productos` para además traer `stock_minimo`, y agregar una consulta de stock. Insertar después de `const { data: productos, count, error } = await consulta` (que ya existe):

```tsx
  // Stock total por producto (suma de todas las bodegas).
  const ids = (productos ?? []).map((p) => p.id)
  const stockPorProducto = new Map<string, number>()
  if (ids.length > 0) {
    const { data: stock } = await supabase
      .from('stock_actual')
      .select('producto_id, cantidad')
      .eq('empresa_id', activa.id)
      .in('producto_id', ids)
    for (const s of stock ?? []) {
      stockPorProducto.set(s.producto_id, (stockPorProducto.get(s.producto_id) ?? 0) + (s.cantidad ?? 0))
    }
  }
```

Agregar `stock_minimo` al `.select(...)` de la consulta de productos (la lista ya selecciona `id, sku, nombre, unidad, precio_neto, exento, activo, categorias_producto (nombre)`; agregar `, stock_minimo`). Agregar en el `<thead>` una `<Th className="text-right">Stock</Th>` antes de `<Th>Estado</Th>`, e importar `bajoMinimo, formatearCantidad` de `@suite/core`. En cada fila, antes de la celda de Estado, insertar:

```tsx
              <Td className="text-right">
                {(() => {
                  const s = stockPorProducto.get(p.id) ?? 0
                  return bajoMinimo(s, p.stock_minimo) ? (
                    <span className="font-mono text-red-600" title="Bajo el mínimo">{formatearCantidad(s)} ⚠</span>
                  ) : (
                    <span className="font-mono">{formatearCantidad(s)}</span>
                  )
                })()}
              </Td>
```

(El `colSpan` del mensaje "no hay productos" pasa de 7 a 8.)

- [ ] **Step 2: Detalle de producto con stock por bodega**

En `apps/erp/app/productos/[id]/page.tsx`, tras cargar el producto, agregar la carga del stock por bodega y renderizarlo. Antes del `return`, agregar:

```tsx
  const { data: stockBodegas } = await supabase
    .from('stock_actual')
    .select('cantidad, bodegas (nombre)')
    .eq('empresa_id', activa.id)
    .eq('producto_id', id)
```

Y en el JSX, después del `<FormularioProducto ... />`, agregar una tarjeta (importar `Tarjeta` de `@suite/ui`, `formatearCantidad` de `@suite/core`):

```tsx
      <div className="mt-6 max-w-2xl">
        <h2 className="mb-2 text-lg font-semibold text-slate-800">Stock por bodega</h2>
        <Tarjeta>
          <ul className="space-y-1 text-sm">
            {(stockBodegas ?? []).map((s, i) => (
              <li key={i} className="flex justify-between">
                <span>{s.bodegas?.nombre ?? '—'}</span>
                <span className="font-mono">{formatearCantidad(s.cantidad ?? 0)}</span>
              </li>
            ))}
            {(stockBodegas ?? []).length === 0 && <li className="text-slate-500">Sin movimientos de stock.</li>}
          </ul>
        </Tarjeta>
      </div>
```

- [ ] **Step 3: Campo stock_minimo en el formulario y su persistencia**

En `apps/erp/componentes/formulario-producto.tsx`, agregar a la interfaz `ProductoEditable` el campo `stock_minimo: number | ''`, a `VACIO` `stock_minimo: 0`, y un `<Campo>` nuevo (junto a Unidad):

```tsx
        <Campo etiqueta="Stock mínimo (alerta)">
          <Entrada name="stock_minimo" inputMode="numeric" defaultValue={inicial.stock_minimo} />
        </Campo>
```

En `apps/erp/app/productos/acciones.ts` (`guardarProducto`), leer y persistir `stock_minimo`. Tras la línea que lee `exento`, agregar:

```ts
  const stockMinimo = Math.max(0, Math.trunc(Number(String(formData.get('stock_minimo') ?? '0'))) || 0)
```

y agregar `stock_minimo: stockMinimo,` al objeto `datos`. En `apps/erp/app/productos/[id]/page.tsx`, pasar `stock_minimo: producto.stock_minimo` dentro del `inicial` del `<FormularioProducto>`.

- [ ] **Step 4: Dashboard con contador de stock crítico**

En `apps/erp/app/page.tsx`, reemplazar la Tarjeta placeholder de "Ventas" (o agregar una nueva) por el contador de stock crítico. Agregar a las consultas `Promise.all` una que cuente productos bajo mínimo. Como la comparación stock vs mínimo cruza dos fuentes, hacerlo con una consulta a `stock_actual` sumada por producto y comparada con `stock_minimo` en JS:

```tsx
  const { data: prods } = await supabase.from('productos').select('id, stock_minimo').eq('empresa_id', activa.id).eq('activo', true)
  const { data: stockRows } = await supabase.from('stock_actual').select('producto_id, cantidad').eq('empresa_id', activa.id)
  const totalPorProd = new Map<string, number>()
  for (const s of stockRows ?? []) totalPorProd.set(s.producto_id, (totalPorProd.get(s.producto_id) ?? 0) + (s.cantidad ?? 0))
  const criticos = (prods ?? []).filter((p) => (totalPorProd.get(p.id) ?? 0) <= p.stock_minimo).length
```

y renderizar una `<Tarjeta>` con "Stock crítico" mostrando `criticos` (con enlace a `/productos?inactivos=0`). Mantener las tarjetas de Productos y Clientes activos existentes.

- [ ] **Step 5: Verificar**

Run: `pnpm --filter erp build`
Expected: build sin errores.

Verificación (Task 10 hace la integral): la lista de productos muestra la columna Stock; el detalle muestra "Stock por bodega".

- [ ] **Step 6: Commit**

```bash
git add apps/erp/app/productos apps/erp/componentes/formulario-producto.tsx apps/erp/app/page.tsx
git commit -m "feat(erp): stock por bodega y alerta de stock mínimo en productos y dashboard"
```

---

### Task 9: Integración con Ventas — descuento y restitución de stock

**Files:**
- Modify: `apps/erp/app/ventas/emitir.ts` (registrar movimientos tras emitir), `apps/erp/lib/emision.ts` (helper de movimientos por venta)

**Interfaces:**
- Consumes: `bodega_por_defecto` (RPC), `movimientos_stock`, `clienteAdmin`.
- Produces: tras una emisión exitosa de factura/boleta se insertan movimientos `salida`; tras una nota de crédito, `entrada`. Idempotente por `referencia_documento_id`.

- [ ] **Step 1: Helper de movimientos por documento**

En `apps/erp/lib/emision.ts`, agregar (usa `clienteAdmin`, ya importado en ese archivo — si no, importarlo):

```ts
import { clienteAdmin } from '@suite/auth/admin'

// Registra movimientos de stock para un documento emitido. signo = -1 descuenta (venta),
// signo = +1 restituye (nota de crédito). Idempotente: no duplica si ya hay movimientos
// para esa referencia. Nunca lanza — el stock se puede reconciliar con un ajuste.
export async function registrarMovimientosDocumento(
  empresaId: string,
  documentoId: string,
  lineas: { producto_id: string | null; cantidad: number }[],
  signo: 1 | -1,
  motivo: string
): Promise<void> {
  try {
    const admin = clienteAdmin()
    const { data: previos } = await admin
      .from('movimientos_stock').select('id').eq('empresa_id', empresaId).eq('referencia_documento_id', documentoId).limit(1)
    if (previos && previos.length > 0) return // ya registrados (reintento)

    const { data: bodega } = await admin.rpc('bodega_por_defecto', { p_empresa: empresaId })
    const bodegaId = bodega as string | null
    if (!bodegaId) return

    const filas = lineas
      .filter((l) => l.producto_id)
      .map((l) => ({
        empresa_id: empresaId, producto_id: l.producto_id, bodega_id: bodegaId,
        tipo: signo < 0 ? 'salida' : 'entrada', cantidad: signo * Math.abs(l.cantidad),
        motivo, referencia_documento_id: documentoId,
      }))
    if (filas.length > 0) await admin.from('movimientos_stock').insert(filas)
  } catch (e) {
    console.error('registrarMovimientosDocumento:', e)
  }
}
```

**Nota:** `bodega_por_defecto` se llama con `admin` (service_role), donde `auth.uid()` es null → su check `app.tiene_rol_en_empresa` fallaría. Por eso, para este uso server-side, cambiar la validación de `bodega_por_defecto` a que NO exija rol cuando corre bajo service_role no es trivial. En su lugar, el helper NO usa la RPC: lee/crea la bodega por defecto directamente vía admin. Reemplazar las dos líneas de `admin.rpc('bodega_por_defecto', ...)` por:

```ts
    let bodegaId: string | null = null
    const { data: b } = await admin.from('bodegas').select('id').eq('empresa_id', empresaId).eq('activo', true).order('creado_en').limit(1).maybeSingle()
    bodegaId = b?.id ?? null
    if (!bodegaId) {
      const { data: nueva } = await admin.from('bodegas').insert({ empresa_id: empresaId, nombre: 'Bodega Principal' }).select('id').single()
      bodegaId = nueva?.id ?? null
    }
    if (!bodegaId) return
```

(Es decir: el helper resuelve la bodega por defecto con el cliente admin directamente, sin la RPC.)

- [ ] **Step 2: Enganchar en la emisión de factura/boleta**

En `apps/erp/app/ventas/emitir.ts`, dentro de `emitirDocumento`, tras la actualización final que deja el documento en su estado, cuando `estado === 'emitido'` registrar la salida. Importar el helper: `import { credencialesEmpresa, registrarMovimientosDocumento } from '../../lib/emision'`. Después del bloque `await admin.from('documentos_venta').update({ ... estado ... }).eq('id', id)` (el del camino feliz), agregar:

```ts
    if (estado === 'emitido') {
      await registrarMovimientosDocumento(
        activa.id, id,
        (lineas ?? []).map((l) => ({ producto_id: (l as { producto_id?: string }).producto_id ?? null, cantidad: l.cantidad })),
        -1, 'Venta ' + tipo + ' folio ' + folio
      )
    }
```

**Ajuste necesario:** la consulta de `lineas` en `emitirDocumento` hoy selecciona `descripcion, cantidad, precio_neto, exenta` — agregar `producto_id`: cambiar ese `.select('descripcion, cantidad, precio_neto, exenta')` por `.select('producto_id, descripcion, cantidad, precio_neto, exenta')`.

- [ ] **Step 3: Enganchar en la nota de crédito (restitución)**

En `emitirNotaCredito`, tras la actualización final cuando la NC queda `emitido`, restituir el stock del documento original. Necesita las líneas del documento referenciado. Tras el `await admin.from('documentos_venta').update({ estado ... }).eq('id', ncId)` del camino feliz, agregar:

```ts
    const estadoNc = estadoDocumento(resultado.estado)
    if (estadoNc === 'emitido') {
      const { data: lineasRef } = await admin
        .from('documentos_venta_lineas').select('producto_id, cantidad').eq('documento_id', refId)
      await registrarMovimientosDocumento(
        activa.id, ncId,
        (lineasRef ?? []).map((l) => ({ producto_id: l.producto_id, cantidad: l.cantidad })),
        1, 'Nota de crédito folio ' + (folioNc as number)
      )
    }
```

(Importar el helper `registrarMovimientosDocumento` en el mismo import de `credencialesEmpresa`. `estadoDocumento` ya existe en el archivo.)

- [ ] **Step 4: Verificar**

Run: `pnpm --filter erp build`
Expected: build sin errores.

- [ ] **Step 5: Commit**

```bash
git add apps/erp/app/ventas/emitir.ts apps/erp/lib/emision.ts
git commit -m "feat(erp): emisión descuenta stock y la nota de crédito lo restituye"
```

---

### Task 10: Regenerar tipos + CI verde + verificación integral (E2E)

**Files:**
- Modify: `packages/db/src/types.ts` (si el gen produce diff)
- Ninguno de producción para la verificación (scripts en scratchpad).

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: evidencia de que el ciclo de inventario funciona de punta a punta, con datos aislados por empresa.

- [ ] **Step 1: Regenerar tipos y pipeline**

Run: `pnpm --filter @suite/db gen`
Expected: `types.ts` current (o commitear si hay diff, mensaje `chore(db): tipos regenerados`).

Run: `pnpm test`
Expected: `@suite/core` (incl. stock), `@suite/auth`, `@suite/dte` verdes.

Run: `pnpm supabase test db`
Expected: 41 asserts pgTAP verdes (6+7+10+9+9).

Run: `pnpm build --concurrency=1`
Expected: 3 apps compilan.

- [ ] **Step 2: E2E integral (script en scratchpad)**

Con Supabase local y `DTE_ENCRYPTION_KEY` de prueba, un script Node en el scratchpad que usando `@supabase/supabase-js` (resuelto desde `packages/auth`): registra una organización; crea un producto (precio 10000) y un cliente; crea una bodega; registra una **entrada** de 20 → verifica `stock_actual` = 20; crea una nota de venta con cantidad 5 y la emite como factura (usando el mock, replicando el flujo de `emitirDocumento` incluido `registrarMovimientosDocumento`) → verifica stock = 15 (20 − 5) y que existe un movimiento `salida` con `referencia_documento_id`; emite una **nota de crédito** referenciando la factura → verifica stock = 20 (restituido); registra un **traslado** de 8 a una segunda bodega → verifica que el total sigue 20 pero repartido (12 y 8); confirma que una segunda organización no ve nada de lo anterior (aislamiento). Cleanup FK-safe (movimientos → documentos/lineas → bodegas/proveedores/productos/clientes → suscripciones/miembros/empresas/organizaciones → auth users). Verificar 0 filas. Borrar el script.

Si alguna aserción de stock falla, es un defecto real → reportar BLOCKED con detalle.

- [ ] **Step 3: Reporte**

Escribir el reporte a `.superpowers/sdd/task-10-plan4-report.md` con las salidas del pipeline y del E2E (cada aserción de stock), evidencia de limpieza, y nota de que el click-through real por navegador queda para la demo con el usuario. Confirmar `git status` limpio (salvo el posible commit de tipos).

- [ ] **Step 4: Commit (solo si hubo cambios de código/tipos)**

Si la verificación no requirió cambios, no hay commit adicional.

---

## Verificación final del plan

Al completar las 10 tasks:

- `pnpm test` — core (incl. stock), auth, dte verdes.
- `pnpm supabase test db` — 41 asserts pgTAP verdes.
- `pnpm build` — 3 apps compilan.
- Ciclo completo: entrada sube stock → emitir factura lo baja (salida con referencia) → nota de crédito lo restituye → traslado reparte entre bodegas → producto bajo mínimo marcado como crítico → todo aislado por empresa.
- Criterio de éxito del Plan 4 (§9 del spec) cumplido: stock siempre derivado del libro inmutable, integrado con ventas, multi-bodega, con proveedores listos para el Plan 5.
