# Suite ERP — Fase 1, Plan 1: Fundación — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Monorepo funcionando con base de datos multi-tenant (RLS testeada), lógica de negocio chilena (RUT/IVA) con TDD, SSO entre apps, y las tres apps (web, erp, admin) desplegables con registro, login y gestión básica de organizaciones.

**Architecture:** Turborepo con apps Next.js separadas (web/erp/admin) sobre una única base Supabase. Aislamiento multi-tenant por RLS con tests pgTAP. Lógica pura en `packages/core`, acceso a datos tipado en `packages/db`, sesión SSO en `packages/auth`. Mutaciones solo server-side (Server Actions).

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript 5 (strict), pnpm 9, Turborepo 2, Supabase (Postgres 17, Auth, CLI local), @supabase/ssr, Vitest 3, pgTAP, GitHub Actions, Vercel.

**Secuencia de planes de la Fase 1** (este documento es el Plan 1):

1. **Fundación** (este plan) — monorepo, esquema plataforma, RLS, RUT/IVA, SSO, registro/login, admin mínimo, CI, deploy inicial.
2. Maestros ERP — productos, clientes, proveedores, bodegas, import Excel/CSV. (Aquí nace `packages/ui` — design system compartido — con las primeras pantallas CRUD reales.)
3. Ventas + DTE — documentos de venta, adaptador proveedor DTE, emisión con cola de reintentos.
4. Inventario + Compras — movimientos de stock inmutables, órdenes de compra, recepción.
5. Pagos + Reportes — cobranza, libros compra/venta formato SII, exportes Excel.
6. Portal comercial completo + Admin completo + lanzamiento en dominio.

## Global Constraints

- Node.js >= 20, pnpm >= 9. **Docker Desktop corriendo** (requisito de Supabase local y pgTAP).
- Next.js 15 App Router, TypeScript `strict: true` en todos los paquetes.
- Dominio y UI en español; identificadores de código y valores de BD en ASCII (rol `dueno`, sin ñ).
- Montos CLP en enteros (sin decimales). IVA 19% parametrizado (`TASA_IVA`), nunca hardcodeado en cálculos.
- Multi-tenant: toda tabla operacional lleva RLS; el panel Admin usa `service_role` solo desde el servidor.
- Mutaciones de negocio solo vía Server Actions / RPC; nunca desde el navegador directo a la BD.
- Mensajes de error al usuario en español claro.
- Scope de paquetes npm: `@suite/*` (nombre provisorio "Suite ERP").
- Sin dependencias fuera de las listadas en cada task (YAGNI).
- Puertos dev: web 3000, erp 3001, admin 3002. Supabase local: API 54321, DB 54322.
- Decisión v1: confirmación de email de Supabase Auth **desactivada** (registro crea sesión inmediata; el flujo con confirmación se aborda cuando haya cobro automático). Documentado en Task 13.

---

### Task 1: Monorepo base (pnpm + Turborepo + TypeScript)

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.gitignore`, `.nvmrc`
- Modify: (ninguno)
- Test: verificación por comandos (no hay código de negocio aún)

**Interfaces:**
- Consumes: nada.
- Produces: workspace pnpm con carpetas `apps/*` y `packages/*`; script raíz `pnpm test` → `turbo run test`, `pnpm build` → `turbo run build`; `tsconfig.base.json` que todos los paquetes extienden.

- [ ] **Step 1: Crear archivos raíz del monorepo**

`package.json`:

```json
{
  "name": "suite-erp",
  "private": true,
  "engines": { "node": ">=20" },
  "packageManager": "pnpm@9.15.0",
  "scripts": {
    "build": "turbo run build",
    "test": "turbo run test",
    "dev": "turbo run dev"
  },
  "devDependencies": {
    "turbo": "^2.3.0",
    "typescript": "^5.7.0",
    "supabase": "^2.0.0"
  }
}
```

`pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

`turbo.json`:

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**", "!.next/cache/**"]
    },
    "test": {},
    "dev": { "cache": false, "persistent": true }
  }
}
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noUncheckedIndexedAccess": true
  }
}
```

`.gitignore`:

```
node_modules/
.next/
.turbo/
.env
.env.local
.env*.local
coverage/
supabase/.temp/
*.tsbuildinfo
.vercel
```

`.nvmrc`:

```
20
```

- [ ] **Step 2: Instalar y verificar**

Run: `pnpm install`
Expected: instala `turbo`, `typescript` y `supabase` sin errores; se crea `pnpm-lock.yaml`.

Run: `pnpm turbo --version`
Expected: imprime versión 2.x.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-workspace.yaml turbo.json tsconfig.base.json .gitignore .nvmrc pnpm-lock.yaml
git commit -m "chore: monorepo base con pnpm, turborepo y typescript"
```

---

### Task 2: `@suite/core` — RUT chileno (TDD)

**Files:**
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/vitest.config.ts`, `packages/core/src/index.ts`, `packages/core/src/rut.ts`
- Test: `packages/core/src/rut.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces (desde `@suite/core`):
  - `limpiarRut(rut: string): string` — quita puntos/guión/espacios, mayúscula la K. `"12.345.678-5"` → `"123456785"`.
  - `calcularDV(cuerpo: string): string` — dígito verificador módulo 11: `"0"`–`"9"` o `"K"`.
  - `validarRut(rut: string): boolean` — acepta con o sin formato.
  - `formatearRut(rut: string): string` — `"123456785"` → `"12.345.678-5"`.

- [ ] **Step 1: Scaffold del paquete**

`packages/core/package.json`:

```json
{
  "name": "@suite/core",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": { "test": "vitest run" },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

`packages/core/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

`packages/core/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { environment: 'node' },
})
```

`packages/core/src/index.ts`:

```ts
export * from './rut'
```

Run: `pnpm install`
Expected: agrega vitest al workspace sin errores.

- [ ] **Step 2: Escribir los tests que fallan**

`packages/core/src/rut.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { calcularDV, formatearRut, limpiarRut, validarRut } from './rut'

describe('limpiarRut', () => {
  it('quita puntos, guión y espacios', () => {
    expect(limpiarRut('12.345.678-5')).toBe('123456785')
    expect(limpiarRut(' 12345678-5 ')).toBe('123456785')
  })
  it('normaliza k minúscula a mayúscula', () => {
    expect(limpiarRut('6-k')).toBe('6K')
  })
})

describe('calcularDV', () => {
  it('calcula dígitos numéricos', () => {
    expect(calcularDV('12345678')).toBe('5')
    expect(calcularDV('11111111')).toBe('1')
    expect(calcularDV('9999999')).toBe('3')
  })
  it('calcula K cuando el resto es 10', () => {
    expect(calcularDV('6')).toBe('K')
  })
  it('calcula 0 cuando el resto es 11', () => {
    expect(calcularDV('59')).toBe('0')
  })
})

describe('validarRut', () => {
  it('acepta RUT válidos con y sin formato', () => {
    expect(validarRut('12.345.678-5')).toBe(true)
    expect(validarRut('123456785')).toBe(true)
    expect(validarRut('11111111-1')).toBe(true)
    expect(validarRut('6-K')).toBe(true)
    expect(validarRut('6-k')).toBe(true)
  })
  it('rechaza dígito verificador incorrecto', () => {
    expect(validarRut('12.345.678-6')).toBe(false)
    expect(validarRut('11111111-K')).toBe(false)
  })
  it('rechaza entradas malformadas', () => {
    expect(validarRut('')).toBe(false)
    expect(validarRut('K')).toBe(false)
    expect(validarRut('abc')).toBe(false)
    expect(validarRut('12a45678-5')).toBe(false)
    expect(validarRut('1a2345678-5')).toBe(false)
    expect(validarRut('12.345.678–5')).toBe(false) // guión tipográfico, no ASCII
  })
})

describe('formatearRut', () => {
  it('agrega puntos y guión', () => {
    expect(formatearRut('123456785')).toBe('12.345.678-5')
    expect(formatearRut('6K')).toBe('6-K')
  })
})
```

- [ ] **Step 3: Verificar que fallan**

Run: `pnpm --filter @suite/core test`
Expected: FAIL — `Cannot find module './rut'` (o equivalente).

- [ ] **Step 4: Implementación mínima**

`packages/core/src/rut.ts`:

```ts
export function limpiarRut(rut: string): string {
  return rut.replace(/[^0-9kK]/g, '').toUpperCase()
}

export function calcularDV(cuerpo: string): string {
  let suma = 0
  let factor = 2
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * factor
    factor = factor === 7 ? 2 : factor + 1
  }
  const resto = 11 - (suma % 11)
  if (resto === 11) return '0'
  if (resto === 10) return 'K'
  return String(resto)
}

export function validarRut(rut: string): boolean {
  if (!/^[0-9.\- kK]+$/.test(rut.trim())) return false
  const limpio = limpiarRut(rut)
  if (limpio.length < 2) return false
  const cuerpo = limpio.slice(0, -1)
  const dv = limpio.slice(-1)
  if (!/^\d+$/.test(cuerpo)) return false
  return calcularDV(cuerpo) === dv
}

export function formatearRut(rut: string): string {
  const limpio = limpiarRut(rut)
  const cuerpo = limpio.slice(0, -1)
  const dv = limpio.slice(-1)
  return cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + '-' + dv
}
```

- [ ] **Step 5: Verificar que pasan**

Run: `pnpm --filter @suite/core test`
Expected: PASS — todos los tests verdes.

- [ ] **Step 6: Commit**

```bash
git add packages/core pnpm-lock.yaml
git commit -m "feat(core): validación, cálculo de DV y formato de RUT chileno"
```

---

### Task 3: `@suite/core` — IVA y totales en CLP (TDD)

**Files:**
- Create: `packages/core/src/iva.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/iva.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces (desde `@suite/core`):
  - `TASA_IVA: number` — `0.19`.
  - `ivaDesdeNeto(neto: number, tasa?: number): number` — redondeo a entero CLP.
  - `netoDesdeBruto(bruto: number, tasa?: number): number` — redondeo a entero CLP.
  - `interface LineaVenta { cantidad: number; precioNeto: number; exenta?: boolean }`
  - `interface Totales { neto: number; exento: number; iva: number; total: number }`
  - `calcularTotales(lineas: LineaVenta[], tasa?: number): Totales`

- [ ] **Step 1: Escribir los tests que fallan**

`packages/core/src/iva.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { calcularTotales, ivaDesdeNeto, netoDesdeBruto, TASA_IVA } from './iva'

describe('ivaDesdeNeto', () => {
  it('calcula 19% redondeado a entero', () => {
    expect(ivaDesdeNeto(10000)).toBe(1900)
    expect(ivaDesdeNeto(999)).toBe(190) // 189.81 → 190
    expect(ivaDesdeNeto(0)).toBe(0)
  })
})

describe('netoDesdeBruto', () => {
  it('invierte el IVA redondeando a entero', () => {
    expect(netoDesdeBruto(11900)).toBe(10000)
    expect(netoDesdeBruto(1190)).toBe(1000)
    expect(netoDesdeBruto(1000)).toBe(840) // 840.336 → 840
  })
})

describe('calcularTotales', () => {
  it('suma líneas afectas', () => {
    const totales = calcularTotales([
      { cantidad: 2, precioNeto: 5000 },
      { cantidad: 1, precioNeto: 990 },
    ])
    expect(totales).toEqual({ neto: 10990, exento: 0, iva: 2088, total: 13078 })
  })
  it('separa líneas exentas (sin IVA)', () => {
    const totales = calcularTotales([
      { cantidad: 1, precioNeto: 10000 },
      { cantidad: 1, precioNeto: 5000, exenta: true },
    ])
    expect(totales).toEqual({ neto: 10000, exento: 5000, iva: 1900, total: 16900 })
  })
  it('lista vacía da cero', () => {
    expect(calcularTotales([])).toEqual({ neto: 0, exento: 0, iva: 0, total: 0 })
  })
  it('la tasa es parametrizable', () => {
    expect(calcularTotales([{ cantidad: 1, precioNeto: 1000 }], 0.1).iva).toBe(100)
  })
  it('expone la tasa vigente', () => {
    expect(TASA_IVA).toBe(0.19)
  })
})
```

- [ ] **Step 2: Verificar que fallan**

Run: `pnpm --filter @suite/core test`
Expected: FAIL — `Cannot find module './iva'`.

- [ ] **Step 3: Implementación mínima**

`packages/core/src/iva.ts`:

```ts
export const TASA_IVA = 0.19

export interface LineaVenta {
  cantidad: number
  precioNeto: number
  exenta?: boolean
}

export interface Totales {
  neto: number
  exento: number
  iva: number
  total: number
}

export function ivaDesdeNeto(neto: number, tasa: number = TASA_IVA): number {
  return Math.round(neto * tasa)
}

export function netoDesdeBruto(bruto: number, tasa: number = TASA_IVA): number {
  return Math.round(bruto / (1 + tasa))
}

export function calcularTotales(lineas: LineaVenta[], tasa: number = TASA_IVA): Totales {
  let neto = 0
  let exento = 0
  for (const linea of lineas) {
    const subtotal = Math.round(linea.cantidad * linea.precioNeto)
    if (linea.exenta) exento += subtotal
    else neto += subtotal
  }
  const iva = Math.round(neto * tasa)
  return { neto, exento, iva, total: neto + exento + iva }
}
```

Actualizar `packages/core/src/index.ts`:

```ts
export * from './rut'
export * from './iva'
```

- [ ] **Step 4: Verificar que pasan**

Run: `pnpm --filter @suite/core test`
Expected: PASS — suites de rut e iva verdes.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/iva.ts packages/core/src/iva.test.ts packages/core/src/index.ts
git commit -m "feat(core): cálculo de IVA y totales de venta en CLP entero"
```

---

### Task 4: Supabase local + esquema de plataforma

**Files:**
- Create: `supabase/config.toml` (generado por CLI), `supabase/migrations/00000000000001_plataforma.sql`
- Test: verificación por `supabase db reset` (los tests pgTAP llegan en Task 5)

**Interfaces:**
- Consumes: nada.
- Produces: tablas `planes`, `organizaciones`, `suscripciones`, `empresas`, `miembros`; funciones `app.mis_organizaciones(): setof uuid` y `app.tiene_rol(org uuid, roles text[]): boolean`; 3 planes seed (`Básico`, `Pro`, `Empresa`).

- [ ] **Step 1: Inicializar Supabase local**

Run: `pnpm supabase init`
Expected: crea `supabase/config.toml`. (Si pregunta por settings de IDE, responder `N`.)

Run: `pnpm supabase start`
Expected: descarga contenedores (requiere Docker Desktop corriendo) y termina imprimiendo `API URL: http://127.0.0.1:54321`, `anon key: ...`, `service_role key: ...`. Guardar esos valores para Task 9.

- [ ] **Step 2: Escribir la migración del esquema de plataforma**

`supabase/migrations/00000000000001_plataforma.sql`:

```sql
-- Esquema de plataforma SaaS: organizaciones clientes, planes, membresías.
create schema if not exists app;
-- Sin este grant, toda política que llame funciones de app falla con
-- "permission denied for schema app".
grant usage on schema app to anon, authenticated;

-- ---------- Tablas ----------

create table public.planes (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  precio_clp integer not null check (precio_clp >= 0),
  modulos text[] not null default '{erp}',
  limites jsonb not null default '{}',
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);

create table public.organizaciones (
  id uuid primary key default gen_random_uuid(),
  rut text not null unique,
  razon_social text not null,
  plan_id uuid references public.planes (id),
  estado text not null default 'trial' check (estado in ('trial', 'activa', 'suspendida')),
  trial_hasta date not null default (current_date + 14),
  creado_en timestamptz not null default now()
);

create table public.suscripciones (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id),
  plan_id uuid not null references public.planes (id),
  desde date not null default current_date,
  hasta date,
  creado_en timestamptz not null default now()
);

create table public.empresas (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id),
  rut text not null,
  razon_social text not null,
  giro text,
  direccion text,
  comuna text,
  creado_en timestamptz not null default now(),
  unique (organizacion_id, rut)
);

create table public.miembros (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users (id),
  organizacion_id uuid not null references public.organizaciones (id),
  rol text not null check (rol in ('dueno', 'admin', 'vendedor', 'contador', 'bodeguero')),
  estado text not null default 'activo' check (estado in ('activo', 'suspendido')),
  creado_en timestamptz not null default now(),
  unique (usuario_id, organizacion_id)
);

-- ---------- Funciones de autorización ----------
-- security definer (owner postgres) para evitar recursión de RLS sobre miembros.

create or replace function app.mis_organizaciones()
returns setof uuid
language sql stable security definer
set search_path = public
as $$
  select organizacion_id from miembros
  where usuario_id = auth.uid() and estado = 'activo'
$$;

create or replace function app.tiene_rol(org uuid, roles text[])
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from miembros
    where usuario_id = auth.uid()
      and organizacion_id = org
      and estado = 'activo'
      and rol = any (roles)
  )
$$;

-- ---------- RLS ----------

alter table public.planes enable row level security;
alter table public.organizaciones enable row level security;
alter table public.suscripciones enable row level security;
alter table public.empresas enable row level security;
alter table public.miembros enable row level security;

-- Catálogo de planes: visible para todos (página de precios pública).
create policy "planes visibles" on public.planes
  for select to anon, authenticated using (activo);

-- Organizaciones: solo miembros activos las ven. Cambios de estado/plan: solo service_role.
create policy "miembros ven su organizacion" on public.organizaciones
  for select to authenticated
  using (id in (select app.mis_organizaciones()));

-- Suscripciones: solo dueno/admin de la organización.
create policy "duenos ven suscripciones" on public.suscripciones
  for select to authenticated
  using (app.tiene_rol(organizacion_id, array['dueno', 'admin']));

-- Empresas: miembros ven; dueno/admin crean y editan.
create policy "miembros ven empresas" on public.empresas
  for select to authenticated
  using (organizacion_id in (select app.mis_organizaciones()));

create policy "duenos crean empresas" on public.empresas
  for insert to authenticated
  with check (app.tiene_rol(organizacion_id, array['dueno', 'admin']));

create policy "duenos editan empresas" on public.empresas
  for update to authenticated
  using (app.tiene_rol(organizacion_id, array['dueno', 'admin']))
  with check (app.tiene_rol(organizacion_id, array['dueno', 'admin']));

-- Miembros: los miembros ven la lista de su organización.
create policy "miembros ven miembros" on public.miembros
  for select to authenticated
  using (organizacion_id in (select app.mis_organizaciones()));

-- ---------- Grants Data API ----------
-- Supabase ya no expone tablas nuevas a los roles del Data API sin GRANT
-- explícito. RLS sigue siendo el filtro por fila; esto es el permiso a nivel
-- de tabla, espejando las operaciones que las políticas permiten.

grant select on public.planes to anon, authenticated;
grant select on public.organizaciones to authenticated;
grant select on public.suscripciones to authenticated;
grant select, insert, update on public.empresas to authenticated;
grant select on public.miembros to authenticated;

-- El panel Admin opera vía service_role (solo servidor).
grant select, insert, update, delete on all tables in schema public to service_role;

-- ---------- Seed de planes (valores editables desde Admin en planes futuros) ----------

insert into public.planes (nombre, precio_clp, modulos, limites) values
  ('Básico',  29990, '{erp}',                      '{"usuarios": 3,  "documentos_mes": 100,  "bodegas": 1}'),
  ('Pro',     49990, '{erp,conta}',                '{"usuarios": 10, "documentos_mes": 1000, "bodegas": 3}'),
  ('Empresa', 89990, '{erp,conta,rrhh,pos,crm}',   '{"usuarios": 50, "documentos_mes": 10000, "bodegas": 10}')
on conflict (nombre) do nothing;
```

- [ ] **Step 3: Aplicar y verificar**

Run: `pnpm supabase db reset`
Expected: `Applying migration 00000000000001_plataforma.sql...` y termina sin errores.

Run: `pnpm supabase db diff`
Expected: sin diferencias (`No schema changes found`).

- [ ] **Step 4: Commit**

```bash
git add supabase/config.toml supabase/migrations/00000000000001_plataforma.sql
git commit -m "feat(db): esquema de plataforma multi-tenant con RLS y seed de planes"
```

---

### Task 5: Tests pgTAP de aislamiento multi-tenant

**Files:**
- Create: `supabase/tests/database/aislamiento.test.sql`
- Test: el archivo ES el test (corre con `supabase test db`)

**Interfaces:**
- Consumes: esquema de Task 4.
- Produces: garantía verificable de que una organización no ve datos de otra. Patrón de impersonación reutilizable en tests futuros: `set local role authenticated; set local request.jwt.claims to '{"sub": "<uuid>", "role": "authenticated"}'`.

- [ ] **Step 1: Escribir el test de aislamiento**

`supabase/tests/database/aislamiento.test.sql`:

```sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

-- Dos usuarios y dos organizaciones independientes.
insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'ana@empresa-a.cl'),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'beto@empresa-b.cl');

insert into public.organizaciones (id, rut, razon_social)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '76111111-6', 'Organización A'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '76222222-1', 'Organización B');

insert into public.empresas (organizacion_id, rut, razon_social)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '76111111-6', 'Empresa A SpA'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '76222222-1', 'Empresa B SpA');

insert into public.miembros (usuario_id, organizacion_id, rol)
values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'dueno'),
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'dueno');

-- Impersonar a Ana (organización A).
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select results_eq(
  'select count(*) from organizaciones',
  array[1::bigint],
  'Ana ve exactamente una organización'
);

select results_eq(
  'select razon_social from organizaciones',
  array['Organización A'::text],
  'Ana ve solo la organización A'
);

select results_eq(
  'select razon_social from empresas',
  array['Empresa A SpA'::text],
  'Ana ve solo la empresa A'
);

select results_eq(
  'select count(*) from miembros',
  array[1::bigint],
  'Ana ve solo los miembros de su organización'
);

-- Escrituras cruzadas: Ana no puede crear empresas en la organización B.
select throws_ok(
  $$insert into empresas (organizacion_id, rut, razon_social)
    values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '76333333-7', 'Intrusa SpA')$$,
  '42501',
  'new row violates row-level security policy for table "empresas"',
  'Ana no puede insertar empresas en la organización B'
);

-- Usuario anónimo: sin grant sobre organizaciones, el acceso se deniega
-- de plano (42501) — más estricto que ver una lista vacía.
set local request.jwt.claims to '{"role": "anon"}';
set local role anon;

select throws_ok(
  'select count(*) from organizaciones',
  '42501',
  'permission denied for table organizaciones',
  'Un anónimo no puede consultar organizaciones'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Correr los tests**

Run: `pnpm supabase test db`
Expected: `aislamiento.test.sql .. ok` — 6/6 tests pasan. Si alguno falla, corregir políticas RLS de Task 4 antes de continuar (no ajustar el test para que pase).

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/database/aislamiento.test.sql
git commit -m "test(db): aislamiento multi-tenant RLS verificado con pgTAP"
```

---

### Task 6: RPC `registrar_organizacion`

**Files:**
- Create: `supabase/migrations/00000000000002_registro.sql`
- Test: `supabase/tests/database/registro.test.sql`

**Interfaces:**
- Consumes: esquema de Task 4.
- Produces:
  - `app.normalizar_rut(p_rut text) returns text` — mayúsculas y solo `[0-9K]` (`'76.543.210-3'` → `'765432103'`).
  - `app.validar_rut(p_rut text) returns boolean` — dígito verificador módulo 11 (misma regla que `@suite/core`).
  - RPC `public.registrar_organizacion(p_rut text, p_razon_social text) returns uuid` — valida el RUT, lo guarda **normalizado** (la unicidad no depende del cliente), y crea organización (estado `trial`, plan `Básico`) + empresa homónima + miembro `dueno` para `auth.uid()`, en una transacción. Lanza excepción con mensaje en español si no hay sesión, el RUT es inválido o ya existe.

- [ ] **Step 1: Escribir el test que falla**

`supabase/tests/database/registro.test.sql`:

```sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (instance_id, id, aud, role, email)
values ('00000000-0000-0000-0000-000000000000', '33333333-3333-3333-3333-333333333333', 'authenticated', 'authenticated', 'carla@nueva.cl');

set local role authenticated;
set local request.jwt.claims to '{"sub": "33333333-3333-3333-3333-333333333333", "role": "authenticated"}';

select lives_ok(
  $$select registrar_organizacion('76.543.210-3', 'Nueva SpA')$$,
  'un usuario autenticado puede registrar su organización'
);

select results_eq(
  'select razon_social, estado from organizaciones',
  $$values ('Nueva SpA'::text, 'trial'::text)$$,
  'la organización queda en trial y visible para su dueño'
);

select results_eq(
  'select rut from organizaciones',
  array['765432103'::text],
  'el RUT se guarda normalizado'
);

select results_eq(
  'select razon_social from empresas',
  array['Nueva SpA'::text],
  'se crea la empresa operativa homónima'
);

select results_eq(
  'select rol from miembros where usuario_id = auth.uid()',
  array['dueno'::text],
  'el usuario queda como dueño'
);

-- Mismo RUT lógico escrito distinto: la normalización lo detecta como duplicado.
select throws_ok(
  $$select registrar_organizacion('765432103', 'Duplicada SpA')$$,
  'P0001',
  'Ya existe una organización registrada con el RUT 765432103',
  'RUT duplicado (aun sin formato) da error claro en español'
);

select throws_ok(
  $$select registrar_organizacion('76.543.210-K', 'Inválida SpA')$$,
  'P0001',
  'El RUT ingresado no es válido',
  'RUT con dígito verificador incorrecto es rechazado por la BD'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Verificar que falla**

Run: `pnpm supabase test db`
Expected: `registro.test.sql` FALLA con `function registrar_organizacion(unknown, unknown) does not exist`. `aislamiento.test.sql` sigue ok.

- [ ] **Step 3: Escribir la migración del RPC**

`supabase/migrations/00000000000002_registro.sql`:

```sql
-- Normalización y validación de RUT en la BD: última línea de defensa.
-- El RPC es invocable directo vía PostgREST, así que no se puede confiar
-- en que el cliente haya validado o normalizado.

create or replace function app.normalizar_rut(p_rut text)
returns text
language sql immutable
as $$
  select upper(regexp_replace(coalesce(p_rut, ''), '[^0-9kK]', '', 'g'))
$$;

create or replace function app.validar_rut(p_rut text)
returns boolean
language plpgsql immutable
as $$
declare
  limpio text := app.normalizar_rut(p_rut);
  cuerpo text;
  dv text;
  suma int := 0;
  factor int := 2;
  resto int;
  esperado text;
begin
  if length(limpio) < 2 then return false; end if;
  cuerpo := left(limpio, -1);
  dv := right(limpio, 1);
  if cuerpo !~ '^\d+$' then return false; end if;
  for i in reverse length(cuerpo)..1 loop
    suma := suma + substr(cuerpo, i, 1)::int * factor;
    factor := case when factor = 7 then 2 else factor + 1 end;
  end loop;
  resto := 11 - (suma % 11);
  esperado := case when resto = 11 then '0' when resto = 10 then 'K' else resto::text end;
  return esperado = dv;
end $$;

-- Registro self-service: crea organización + empresa + membresía dueño en una transacción.
create or replace function public.registrar_organizacion(p_rut text, p_razon_social text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_usuario uuid := auth.uid();
  v_rut text;
  v_org uuid;
  v_plan uuid;
begin
  if v_usuario is null then
    raise exception 'Debes iniciar sesión para registrar una organización';
  end if;
  if not app.validar_rut(p_rut) then
    raise exception 'El RUT ingresado no es válido';
  end if;
  if coalesce(trim(p_razon_social), '') = '' then
    raise exception 'La razón social es obligatoria';
  end if;

  -- Guardar normalizado: la restricción unique compara byte a byte, así que
  -- '76.543.210-3' y '765432103' deben ser la misma fila.
  v_rut := app.normalizar_rut(p_rut);

  select id into v_plan from planes where nombre = 'Básico';
  if v_plan is null then
    raise exception 'No existe el plan Básico; contacta a soporte';
  end if;

  begin
    insert into organizaciones (rut, razon_social, plan_id)
    values (v_rut, trim(p_razon_social), v_plan)
    returning id into v_org;
  exception when unique_violation then
    raise exception 'Ya existe una organización registrada con el RUT %', p_rut;
  end;

  insert into empresas (organizacion_id, rut, razon_social)
  values (v_org, v_rut, trim(p_razon_social));

  insert into miembros (usuario_id, organizacion_id, rol)
  values (v_usuario, v_org, 'dueno');

  insert into suscripciones (organizacion_id, plan_id)
  values (v_org, v_plan);

  return v_org;
end $$;

revoke execute on function public.registrar_organizacion(text, text) from anon, public;
grant execute on function public.registrar_organizacion(text, text) to authenticated;
```

- [ ] **Step 4: Verificar que pasa**

Run: `pnpm supabase db reset && pnpm supabase test db`
Expected: ambos archivos de test pasan (13 asserts en total: 6 de aislamiento + 7 de registro).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/00000000000002_registro.sql supabase/tests/database/registro.test.sql
git commit -m "feat(db): RPC registrar_organizacion con test pgTAP"
```

---

### Task 7: `@suite/db` — tipos generados de Supabase

**Files:**
- Create: `packages/db/package.json`, `packages/db/tsconfig.json`, `packages/db/src/index.ts`, `packages/db/src/types.ts` (generado)

**Interfaces:**
- Consumes: esquema de Tasks 4 y 6 (Supabase local corriendo).
- Produces: tipo `Database` (export desde `@suite/db`) que tipa todas las tablas y el RPC `registrar_organizacion` para los clientes Supabase.

- [ ] **Step 1: Scaffold del paquete**

`packages/db/package.json`:

```json
{
  "name": "@suite/db",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "gen": "supabase gen types typescript --local > src/types.ts"
  },
  "devDependencies": {
    "supabase": "^2.0.0",
    "typescript": "^5.7.0"
  }
}
```

`packages/db/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

`packages/db/src/index.ts`:

```ts
export type { Database } from './types'
```

- [ ] **Step 2: Generar tipos y verificar**

Run: `pnpm install && pnpm --filter @suite/db gen`
Expected: crea `packages/db/src/types.ts` conteniendo `organizaciones`, `empresas`, `miembros`, `planes`, `suscripciones` y la función `registrar_organizacion`.

Run: `pnpm tsc --noEmit -p packages/db/tsconfig.json`
Expected: sin errores de tipos.

- [ ] **Step 3: Commit**

```bash
git add packages/db pnpm-lock.yaml
git commit -m "feat(db): paquete de tipos generados de Supabase"
```

---

### Task 8: `@suite/auth` — clientes Supabase y SSO entre subdominios

**Files:**
- Create: `packages/auth/package.json`, `packages/auth/tsconfig.json`, `packages/auth/vitest.config.ts`, `packages/auth/src/cookies.ts`, `packages/auth/src/server.ts`, `packages/auth/src/client.ts`, `packages/auth/src/middleware.ts`, `packages/auth/src/admin.ts`
- Test: `packages/auth/src/cookies.test.ts`

**Interfaces:**
- Consumes: `Database` de `@suite/db`.
- Produces:
  - `dominioCookie(dominio?: string)` (desde `@suite/auth/cookies`) — `{}` si no hay dominio configurado; `{ domain, path: '/', sameSite: 'lax', secure: true }` si lo hay. Lee `NEXT_PUBLIC_COOKIE_DOMAIN` por defecto.
  - `crearClienteServidor()` (desde `@suite/auth/server`) — cliente Supabase tipado para Server Components/Actions.
  - `crearClienteNavegador()` (desde `@suite/auth/client`) — cliente para componentes cliente (solo lecturas).
  - `actualizarSesion(request: NextRequest, urlLogin: string)` (desde `@suite/auth/middleware`) — refresca sesión y redirige a login si no hay usuario.
  - `clienteAdmin()` (desde `@suite/auth/admin`) — cliente `service_role`, **solo importable en código de servidor**.

- [ ] **Step 1: Scaffold del paquete**

`packages/auth/package.json`:

```json
{
  "name": "@suite/auth",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    "./cookies": "./src/cookies.ts",
    "./server": "./src/server.ts",
    "./client": "./src/client.ts",
    "./middleware": "./src/middleware.ts",
    "./admin": "./src/admin.ts"
  },
  "scripts": { "test": "vitest run" },
  "dependencies": {
    "@supabase/ssr": "^0.12.0",
    "@supabase/supabase-js": "^2.47.0",
    "@suite/db": "workspace:*"
  },
  "peerDependencies": { "next": "^15.0.0" },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "next": "^15.1.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

`packages/auth/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

`packages/auth/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { environment: 'node' },
})
```

- [ ] **Step 2: Test de `dominioCookie` (falla)**

`packages/auth/src/cookies.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { dominioCookie } from './cookies'

describe('dominioCookie', () => {
  it('sin dominio configurado devuelve objeto vacío (cookies por host, dev local)', () => {
    expect(dominioCookie(undefined)).toEqual({})
    expect(dominioCookie('')).toEqual({})
  })
  it('con dominio configurado habilita SSO entre subdominios', () => {
    expect(dominioCookie('.misuite.cl')).toEqual({
      domain: '.misuite.cl',
      path: '/',
      sameSite: 'lax',
      secure: true,
    })
  })
})
```

Run: `pnpm install && pnpm --filter @suite/auth test`
Expected: FAIL — `Cannot find module './cookies'`.

- [ ] **Step 3: Implementar `cookies.ts`**

`packages/auth/src/cookies.ts`:

```ts
export interface OpcionesCookie {
  domain?: string
  path?: string
  sameSite?: 'lax'
  secure?: boolean
}

export function dominioCookie(
  dominio: string | undefined = process.env.NEXT_PUBLIC_COOKIE_DOMAIN
): OpcionesCookie {
  if (!dominio) return {}
  return { domain: dominio, path: '/', sameSite: 'lax', secure: true }
}
```

Run: `pnpm --filter @suite/auth test`
Expected: PASS.

- [ ] **Step 4: Implementar los clientes**

`packages/auth/src/server.ts`:

```ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from '@suite/db'
import { dominioCookie } from './cookies'

export async function crearClienteServidor() {
  const almacenCookies = await cookies()
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: dominioCookie(),
      cookies: {
        getAll: () => almacenCookies.getAll(),
        setAll: (lista) => {
          try {
            lista.forEach(({ name, value, options }) =>
              almacenCookies.set(name, value, options)
            )
          } catch {
            // Llamado desde un Server Component: el middleware refresca la sesión.
          }
        },
      },
    }
  )
}
```

`packages/auth/src/client.ts`:

```ts
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@suite/db'
import { dominioCookie } from './cookies'

export function crearClienteNavegador() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookieOptions: dominioCookie() }
  )
}
```

`packages/auth/src/middleware.ts`:

```ts
import { createServerClient } from '@supabase/ssr'
import type { Database } from '@suite/db'
import { NextResponse, type NextRequest } from 'next/server'
import { dominioCookie } from './cookies'

export async function actualizarSesion(request: NextRequest, urlLogin: string) {
  let respuesta = NextResponse.next({ request })
  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: dominioCookie(),
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (lista) => {
          lista.forEach(({ name, value }) => request.cookies.set(name, value))
          respuesta = NextResponse.next({ request })
          lista.forEach(({ name, value, options }) =>
            respuesta.cookies.set(name, value, options)
          )
        },
      },
    }
  )
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL(urlLogin, request.url))
  return respuesta
}
```

`packages/auth/src/admin.ts`:

```ts
import 'server-only'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@suite/db'

// Cliente con service_role: salta RLS. SOLO para el panel Admin, solo en servidor.
export function clienteAdmin() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}
```

Agregar `server-only` a las dependencias:

```bash
pnpm --filter @suite/auth add server-only
```

- [ ] **Step 5: Verificar tipos y tests**

Run: `pnpm tsc --noEmit -p packages/auth/tsconfig.json && pnpm --filter @suite/auth test`
Expected: sin errores de tipos; tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/auth pnpm-lock.yaml
git commit -m "feat(auth): clientes Supabase tipados con SSO por dominio de cookie"
```

---

### Task 9: `apps/web` — portal con registro y login

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/next.config.ts`, `apps/web/next-env.d.ts` (generado), `apps/web/.env.example`, `apps/web/app/layout.tsx`, `apps/web/app/page.tsx`, `apps/web/app/tipos.ts`, `apps/web/app/registro/page.tsx`, `apps/web/app/registro/acciones.ts`, `apps/web/app/registro/exito/page.tsx`, `apps/web/app/login/page.tsx`, `apps/web/app/login/acciones.ts`

**Interfaces:**
- Consumes: `validarRut` y `formatearRut` de `@suite/core`; `crearClienteServidor` de `@suite/auth/server`; RPC `registrar_organizacion`.
- Produces: flujo completo registro → organización creada → redirect; login → redirect a la URL del ERP (`NEXT_PUBLIC_URL_ERP`). Tipo compartido de los formularios en `apps/web/app/tipos.ts`: `type EstadoForm = { error?: string }` (en archivo propio porque un archivo `'use server'` solo puede exportar funciones async).

- [ ] **Step 1: Scaffold de la app**

`apps/web/package.json`:

```json
{
  "name": "web",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3000",
    "build": "next build",
    "start": "next start -p 3000"
  },
  "dependencies": {
    "@suite/auth": "workspace:*",
    "@suite/core": "workspace:*",
    "@suite/db": "workspace:*",
    "next": "^15.1.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "typescript": "^5.7.0"
  }
}
```

`apps/web/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "preserve",
    "allowJs": true,
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`apps/web/next.config.ts`:

```ts
import type { NextConfig } from 'next'

const config: NextConfig = {
  transpilePackages: ['@suite/core', '@suite/db', '@suite/auth'],
}

export default config
```

`apps/web/.env.example`:

```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key de `pnpm supabase start`>
NEXT_PUBLIC_URL_ERP=http://localhost:3001
# En producción con dominio propio: NEXT_PUBLIC_COOKIE_DOMAIN=.tudominio.cl
NEXT_PUBLIC_COOKIE_DOMAIN=
```

Copiar `.env.example` a `apps/web/.env.local` y completar el anon key real de Task 4.

- [ ] **Step 2: Layout y landing mínima**

`apps/web/app/layout.tsx`:

```tsx
import type { ReactNode } from 'react'

export const metadata = { title: 'Suite ERP — Gestión para pymes chilenas' }

export default function LayoutRaiz({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body style={{ fontFamily: 'system-ui', margin: 0 }}>{children}</body>
    </html>
  )
}
```

`apps/web/app/page.tsx`:

```tsx
import Link from 'next/link'

export default function Inicio() {
  return (
    <main style={{ maxWidth: 720, margin: '4rem auto', padding: '0 1rem' }}>
      <h1>Suite ERP</h1>
      <p>
        Ventas, facturación electrónica e inventario para pymes chilenas.
        100% web. Prueba gratis por 14 días.
      </p>
      <p>
        <Link href="/registro">Crear cuenta</Link> · <Link href="/login">Iniciar sesión</Link>
      </p>
    </main>
  )
}
```

- [ ] **Step 3: Registro (Server Action + página)**

`apps/web/app/tipos.ts`:

```ts
export type EstadoForm = { error?: string }
```

`apps/web/app/registro/acciones.ts`:

```ts
'use server'

import { redirect } from 'next/navigation'
import { validarRut } from '@suite/core'
import { crearClienteServidor } from '@suite/auth/server'
import type { EstadoForm } from '../tipos'

export async function registrar(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')
  const rut = String(formData.get('rut') ?? '').trim()
  const razonSocial = String(formData.get('razon_social') ?? '').trim()

  if (!email.includes('@')) return { error: 'Ingresa un correo válido' }
  if (password.length < 8) return { error: 'La contraseña debe tener al menos 8 caracteres' }
  if (!validarRut(rut)) return { error: 'El RUT ingresado no es válido' }
  if (!razonSocial) return { error: 'Ingresa la razón social de tu empresa' }

  const supabase = await crearClienteServidor()

  // Reintento tras un fallo posterior (ej. RUT duplicado): si ya hay sesión o el
  // correo ya tiene cuenta, no volver a crear el usuario — así el segundo envío
  // del formulario llega al RPC en vez de morir en "User already registered".
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (user && user.email?.toLowerCase() !== email.toLowerCase()) {
    return {
      error:
        'Ya hay una sesión iniciada con otro correo en este navegador. Cierra esa sesión para registrar una cuenta nueva.',
    }
  }
  if (!user) {
    const { error: errorAuth } = await supabase.auth.signUp({ email, password })
    if (errorAuth?.code === 'user_already_exists') {
      const { error: errorLogin } = await supabase.auth.signInWithPassword({ email, password })
      if (errorLogin) return { error: 'Este correo ya tiene una cuenta. Inicia sesión para continuar.' }
    } else if (errorAuth) {
      console.error('Error de signUp en registro:', errorAuth)
      return { error: 'No se pudo crear la cuenta. Inténtalo de nuevo en unos minutos.' }
    }
  }

  // La BD normaliza y valida el RUT de nuevo (última línea de defensa).
  const { error: errorOrg } = await supabase.rpc('registrar_organizacion', {
    p_rut: rut,
    p_razon_social: razonSocial,
  })
  if (errorOrg) return { error: errorOrg.message }

  redirect('/registro/exito')
}
```

`apps/web/app/registro/page.tsx`:

```tsx
'use client'

import { useActionState } from 'react'
import { registrar } from './acciones'
import type { EstadoForm } from '../tipos'

const inicial: EstadoForm = {}

export default function PaginaRegistro() {
  const [estado, accion, pendiente] = useActionState(registrar, inicial)
  return (
    <main style={{ maxWidth: 420, margin: '4rem auto', padding: '0 1rem' }}>
      <h1>Crea tu cuenta</h1>
      <p>14 días de prueba gratis. Sin tarjeta.</p>
      <form action={accion} style={{ display: 'grid', gap: 12 }}>
        <label>
          Correo
          <input name="email" type="email" required style={{ width: '100%' }} />
        </label>
        <label>
          Contraseña (mínimo 8 caracteres)
          <input name="password" type="password" required minLength={8} style={{ width: '100%' }} />
        </label>
        <label>
          RUT de la empresa
          <input name="rut" placeholder="76.543.210-3" required style={{ width: '100%' }} />
        </label>
        <label>
          Razón social
          <input name="razon_social" required style={{ width: '100%' }} />
        </label>
        {estado.error && <p style={{ color: 'crimson' }}>{estado.error}</p>}
        <button type="submit" disabled={pendiente}>
          {pendiente ? 'Creando cuenta…' : 'Crear cuenta'}
        </button>
      </form>
    </main>
  )
}
```

`apps/web/app/registro/exito/page.tsx`:

```tsx
export default function RegistroExitoso() {
  return (
    <main style={{ maxWidth: 420, margin: '4rem auto', padding: '0 1rem' }}>
      <h1>¡Cuenta creada!</h1>
      <p>Tu organización quedó registrada con 14 días de prueba.</p>
      <a href={process.env.NEXT_PUBLIC_URL_ERP}>Entrar al ERP</a>
    </main>
  )
}
```

- [ ] **Step 4: Login (Server Action + página)**

`apps/web/app/login/acciones.ts`:

```ts
'use server'

import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import type { EstadoForm } from '../tipos'

export async function iniciarSesion(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')

  const supabase = await crearClienteServidor()
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) return { error: 'Correo o contraseña incorrectos' }

  redirect(process.env.NEXT_PUBLIC_URL_ERP!)
}
```

`apps/web/app/login/page.tsx`:

```tsx
'use client'

import { useActionState } from 'react'
import { iniciarSesion } from './acciones'
import type { EstadoForm } from '../tipos'

const inicial: EstadoForm = {}

export default function PaginaLogin() {
  const [estado, accion, pendiente] = useActionState(iniciarSesion, inicial)
  return (
    <main style={{ maxWidth: 420, margin: '4rem auto', padding: '0 1rem' }}>
      <h1>Iniciar sesión</h1>
      <form action={accion} style={{ display: 'grid', gap: 12 }}>
        <label>
          Correo
          <input name="email" type="email" required style={{ width: '100%' }} />
        </label>
        <label>
          Contraseña
          <input name="password" type="password" required style={{ width: '100%' }} />
        </label>
        {estado.error && <p style={{ color: 'crimson' }}>{estado.error}</p>}
        <button type="submit" disabled={pendiente}>
          {pendiente ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </main>
  )
}
```

- [ ] **Step 5: Verificar flujo completo manualmente**

Run: `pnpm install && pnpm --filter web dev` (con Supabase local corriendo)
Expected: en `http://localhost:3000/registro`, crear cuenta con RUT `76.543.210-3` redirige a `/registro/exito`.

Verificar en la BD: abrir Supabase Studio (`http://127.0.0.1:54323`) → Table Editor → `organizaciones`.
Expected: una fila con la razón social ingresada y estado `trial`; en `empresas` y `miembros`, una fila cada una.

Probar también:

1. RUT inválido (ej. `76.543.210-K`, DV incorrecto) muestra "El RUT ingresado no es válido".
2. Con un **segundo correo**, registrar el mismo RUT `76.543.210-3` muestra el error de duplicado; corregir el RUT a `12.345.678-5` y reenviar el formulario **completa el registro** (el reintento no debe morir en "User already registered").

- [ ] **Step 6: Verificar build y commit**

Run: `pnpm --filter web build`
Expected: build sin errores.

```bash
git add apps/web pnpm-lock.yaml
git commit -m "feat(web): portal con registro self-service y login"
```

---

### Task 10: `apps/erp` — shell autenticado con selector de empresa

**Files:**
- Create: `apps/erp/package.json`, `apps/erp/tsconfig.json`, `apps/erp/next.config.ts`, `apps/erp/.env.example`, `apps/erp/middleware.ts`, `apps/erp/app/layout.tsx`, `apps/erp/app/page.tsx`

**Interfaces:**
- Consumes: `crearClienteServidor` de `@suite/auth/server`; `actualizarSesion` de `@suite/auth/middleware`; `formatearRut` de `@suite/core`; tablas `organizaciones`/`empresas` vía RLS.
- Produces: app ERP protegida — sin sesión redirige al login del portal; con sesión muestra organizaciones, banner de trial y empresas. Los planes 2-5 construyen sus pantallas dentro de esta app.

- [ ] **Step 1: Scaffold**

`apps/erp/package.json` (igual a web salvo nombre y puerto):

```json
{
  "name": "erp",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3001",
    "build": "next build",
    "start": "next start -p 3001"
  },
  "dependencies": {
    "@suite/auth": "workspace:*",
    "@suite/core": "workspace:*",
    "@suite/db": "workspace:*",
    "next": "^15.1.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "typescript": "^5.7.0"
  }
}
```

`apps/erp/tsconfig.json` y `apps/erp/next.config.ts`: idénticos a los de `apps/web` (Task 9, Step 1).

`apps/erp/.env.example`:

```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key de `pnpm supabase start`>
NEXT_PUBLIC_URL_WEB=http://localhost:3000
NEXT_PUBLIC_COOKIE_DOMAIN=
```

Copiar a `apps/erp/.env.local` con el anon key real.

- [ ] **Step 2: Middleware de autenticación**

`apps/erp/middleware.ts`:

```ts
import type { NextRequest } from 'next/server'
import { actualizarSesion } from '@suite/auth/middleware'

export async function middleware(request: NextRequest) {
  return actualizarSesion(request, process.env.NEXT_PUBLIC_URL_WEB + '/login')
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
```

- [ ] **Step 3: Layout y página de inicio**

`apps/erp/app/layout.tsx`:

```tsx
import type { ReactNode } from 'react'

export const metadata = { title: 'Suite ERP' }

export default function LayoutRaiz({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body style={{ fontFamily: 'system-ui', margin: 0 }}>{children}</body>
    </html>
  )
}
```

`apps/erp/app/page.tsx`:

```tsx
import { crearClienteServidor } from '@suite/auth/server'
import { formatearRut } from '@suite/core'

export default async function Inicio() {
  const supabase = await crearClienteServidor()
  const { data: organizaciones, error } = await supabase
    .from('organizaciones')
    .select('id, razon_social, estado, trial_hasta, empresas (id, rut, razon_social)')

  if (error) throw new Error('No se pudieron cargar tus organizaciones')

  if (!organizaciones || organizaciones.length === 0) {
    return (
      <main style={{ maxWidth: 720, margin: '4rem auto', padding: '0 1rem' }}>
        <h1>Sin organización</h1>
        <p>
          Tu usuario no pertenece a ninguna organización. Pide una invitación o{' '}
          <a href={process.env.NEXT_PUBLIC_URL_WEB + '/registro'}>crea tu cuenta</a>.
        </p>
      </main>
    )
  }

  return (
    <main style={{ maxWidth: 720, margin: '2rem auto', padding: '0 1rem' }}>
      <h1>Suite ERP</h1>
      {organizaciones.map((org) => (
        <section key={org.id} style={{ border: '1px solid #ddd', padding: 16, marginBottom: 16 }}>
          <h2>{org.razon_social}</h2>
          {org.estado === 'trial' && (
            <p style={{ background: '#fff3cd', padding: 8 }}>
              Período de prueba hasta el {new Date(org.trial_hasta + 'T00:00:00').toLocaleDateString('es-CL')}.
            </p>
          )}
          {org.estado === 'suspendida' && (
            <p style={{ background: '#f8d7da', padding: 8 }}>
              Organización suspendida. Contáctanos para reactivarla.
            </p>
          )}
          <h3>Empresas</h3>
          <ul>
            {org.empresas.map((empresa) => (
              <li key={empresa.id}>
                {empresa.razon_social} — {formatearRut(empresa.rut)}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  )
}
```

- [ ] **Step 4: Verificar manualmente**

Con Supabase local y `pnpm --filter web dev` + `pnpm --filter erp dev` corriendo:

1. Sin sesión: abrir `http://localhost:3001` → redirige a `http://localhost:3000/login`.
2. Iniciar sesión con la cuenta de Task 9 → redirige al ERP → se ve la organización con banner de trial y su empresa con RUT formateado.

- [ ] **Step 5: Verificar build y commit**

Run: `pnpm --filter erp build`
Expected: build sin errores.

```bash
git add apps/erp
git commit -m "feat(erp): shell autenticado con organizaciones, empresas y banner de trial"
```

---

### Task 11: `apps/admin` — panel interno mínimo

**Files:**
- Create: `apps/admin/package.json`, `apps/admin/tsconfig.json`, `apps/admin/next.config.ts`, `apps/admin/.env.example`, `apps/admin/middleware.ts`, `apps/admin/app/layout.tsx`, `apps/admin/app/page.tsx`, `apps/admin/app/acciones.ts`, `apps/admin/lib/guardia.ts`

**Interfaces:**
- Consumes: `clienteAdmin` de `@suite/auth/admin`; `crearClienteServidor` de `@suite/auth/server`; `actualizarSesion` de `@suite/auth/middleware`.
- Produces: panel en puerto 3002 restringido por allowlist `ADMIN_EMAILS`; lista todas las organizaciones; acciones `activarOrganizacion(id)` y `suspenderOrganizacion(id)`. Guardia reutilizable `verificarAdmin(): Promise<void>` (lanza si el usuario no es admin de plataforma).

- [ ] **Step 1: Scaffold**

`apps/admin/package.json`:

```json
{
  "name": "admin",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3002",
    "build": "next build",
    "start": "next start -p 3002"
  },
  "dependencies": {
    "@suite/auth": "workspace:*",
    "@suite/core": "workspace:*",
    "@suite/db": "workspace:*",
    "next": "^15.1.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "server-only": "^0.0.1"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "typescript": "^5.7.0"
  }
}
```

Nota: `server-only` va declarado aquí porque `lib/guardia.ts` lo importa directamente — con la resolución estricta de pnpm no basta con que `@suite/auth` lo tenga.

`apps/admin/tsconfig.json` y `apps/admin/next.config.ts`: idénticos a los de `apps/web` (Task 9, Step 1).

`apps/admin/.env.example`:

```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key de `pnpm supabase start`>
SUPABASE_SERVICE_ROLE_KEY=<service_role key de `pnpm supabase start`>
NEXT_PUBLIC_URL_WEB=http://localhost:3000
NEXT_PUBLIC_COOKIE_DOMAIN=
ADMIN_EMAILS=rpmautz@gmail.com
```

Copiar a `apps/admin/.env.local` con las keys reales.

`apps/admin/middleware.ts`: idéntico a `apps/erp/middleware.ts` (Task 10, Step 2).

- [ ] **Step 2: Guardia de administrador**

`apps/admin/lib/guardia.ts`:

```ts
import 'server-only'
import { crearClienteServidor } from '@suite/auth/server'

export async function verificarAdmin(): Promise<void> {
  const supabase = await crearClienteServidor()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const permitidos = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  if (!user?.email || !permitidos.includes(user.email.toLowerCase())) {
    throw new Error('No tienes permisos de administrador de la plataforma')
  }
}
```

- [ ] **Step 3: Acciones y página**

`apps/admin/app/acciones.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { clienteAdmin } from '@suite/auth/admin'
import { verificarAdmin } from '../lib/guardia'

async function cambiarEstado(id: string, estado: 'activa' | 'suspendida') {
  await verificarAdmin()
  const admin = clienteAdmin()
  const { error } = await admin.from('organizaciones').update({ estado }).eq('id', id)
  if (error) throw new Error('No se pudo actualizar la organización: ' + error.message)
  revalidatePath('/')
}

export async function activarOrganizacion(formData: FormData) {
  await cambiarEstado(String(formData.get('id')), 'activa')
}

export async function suspenderOrganizacion(formData: FormData) {
  await cambiarEstado(String(formData.get('id')), 'suspendida')
}
```

`apps/admin/app/layout.tsx`: idéntico a `apps/erp/app/layout.tsx` pero con `title: 'Suite ERP — Admin'`.

`apps/admin/app/page.tsx`:

```tsx
import { clienteAdmin } from '@suite/auth/admin'
import { formatearRut } from '@suite/core'
import { verificarAdmin } from '../lib/guardia'
import { activarOrganizacion, suspenderOrganizacion } from './acciones'

export default async function PanelAdmin() {
  await verificarAdmin()
  const admin = clienteAdmin()
  const { data: organizaciones, error } = await admin
    .from('organizaciones')
    .select('id, rut, razon_social, estado, trial_hasta, creado_en, planes (nombre)')
    .order('creado_en', { ascending: false })

  if (error) throw new Error('No se pudieron cargar las organizaciones')

  return (
    <main style={{ maxWidth: 960, margin: '2rem auto', padding: '0 1rem' }}>
      <h1>Organizaciones ({organizaciones?.length ?? 0})</h1>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th align="left">RUT</th>
            <th align="left">Razón social</th>
            <th align="left">Plan</th>
            <th align="left">Estado</th>
            <th align="left">Trial hasta</th>
            <th align="left">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {organizaciones?.map((org) => (
            <tr key={org.id} style={{ borderTop: '1px solid #ddd' }}>
              <td>{formatearRut(org.rut)}</td>
              <td>{org.razon_social}</td>
              <td>{org.planes?.nombre ?? '—'}</td>
              <td>{org.estado}</td>
              <td>{new Date(org.trial_hasta + 'T00:00:00').toLocaleDateString('es-CL')}</td>
              <td>
                <form action={activarOrganizacion} style={{ display: 'inline' }}>
                  <input type="hidden" name="id" value={org.id} />
                  <button type="submit" disabled={org.estado === 'activa'}>Activar</button>
                </form>{' '}
                <form action={suspenderOrganizacion} style={{ display: 'inline' }}>
                  <input type="hidden" name="id" value={org.id} />
                  <button type="submit" disabled={org.estado === 'suspendida'}>Suspender</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  )
}
```

- [ ] **Step 4: Verificar manualmente**

Con las tres apps y Supabase corriendo:

1. Login en el portal con el correo listado en `ADMIN_EMAILS` → abrir `http://localhost:3002` → se ve la tabla de organizaciones.
2. Pulsar "Activar" en la organización de prueba → el estado cambia a `activa` (y el banner de trial desaparece en el ERP).
3. Login con un correo NO listado → abrir `http://localhost:3002` → página de error (sin datos expuestos).

- [ ] **Step 5: Verificar build y commit**

Run: `pnpm --filter admin build`
Expected: build sin errores.

```bash
git add apps/admin
git commit -m "feat(admin): panel interno con activación/suspensión de organizaciones"
```

---

### Task 12: CI con GitHub Actions

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: scripts `test`/`build` de tasks anteriores; tests pgTAP.
- Produces: pipeline que corre en cada push/PR: tests unitarios, tests de BD (RLS incluido) y builds de las 3 apps.

- [ ] **Step 1: Escribir el workflow**

`.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [master, main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    env:
      NEXT_PUBLIC_SUPABASE_URL: http://127.0.0.1:54321
      NEXT_PUBLIC_SUPABASE_ANON_KEY: clave-dummy-para-build
      SUPABASE_SERVICE_ROLE_KEY: clave-dummy-para-build
      NEXT_PUBLIC_URL_WEB: http://localhost:3000
      NEXT_PUBLIC_URL_ERP: http://localhost:3001
      ADMIN_EMAILS: ci@example.com
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm test
      - uses: supabase/setup-cli@v1
        with:
          version: 2.109.1
      - run: supabase start
      - run: supabase test db
      - run: pnpm build
```

- [ ] **Step 2: Verificar localmente el equivalente**

Run: `pnpm test && pnpm supabase test db && pnpm build`
Expected: todo verde (mismo pipeline que correrá CI).

- [ ] **Step 3: Commit y push**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: pipeline con tests unitarios, pgTAP y builds"
```

Si el repositorio ya tiene remote en GitHub: `git push` y verificar que el workflow pasa en la pestaña Actions. Si aún no hay remote, crearlo primero: `gh repo create suite-erp --private --source . --push`.

---

### Task 13: Deploy inicial (Supabase producción + Vercel)

**Files:**
- Create: `docs/deploy.md` (runbook)
- Modify: (ninguno — esta task es operacional)

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: las 3 apps en línea en URLs `*.vercel.app` contra un proyecto Supabase productivo. Runbook documentado para repetir el proceso.

**Nota:** estos pasos requieren cuentas del usuario (Supabase, Vercel, GitHub). El ejecutor debe pedir al usuario que esté disponible para autorizar logins la primera vez.

- [ ] **Step 1: Crear proyecto Supabase de producción**

1. En [supabase.com](https://supabase.com) crear proyecto `suite-erp-prod` (región `sa-east-1`, São Paulo — la más cercana a Chile). Guardar la contraseña de BD en un gestor de contraseñas.
2. Vincular y aplicar migraciones:

```bash
pnpm supabase link --project-ref <ref-del-proyecto>
pnpm supabase db push
```

Expected: aplica las 2 migraciones sin errores.

3. En el dashboard: Authentication → Providers → Email → desactivar "Confirm email" (decisión v1 documentada en Global Constraints).

- [ ] **Step 2: Crear los 3 proyectos en Vercel**

Para cada app (`web`, `erp`, `admin`): en Vercel "Add New Project" → importar el repo GitHub → **Root Directory** = `apps/web` / `apps/erp` / `apps/admin` (Vercel detecta Turborepo). Variables de entorno de producción según el `.env.example` de cada app, con los valores del proyecto Supabase prod (Settings → API):

- Las 3 apps: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- web: `NEXT_PUBLIC_URL_ERP` = URL Vercel de erp
- erp y admin: `NEXT_PUBLIC_URL_WEB` = URL Vercel de web
- admin: `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_EMAILS=rpmautz@gmail.com`
- `NEXT_PUBLIC_COOKIE_DOMAIN`: **dejar vacía** mientras se use `*.vercel.app` (dominios distintos; el SSO por cookie compartida se activa recién con el dominio propio — cada app redirige al login del portal mientras tanto).

- [ ] **Step 3: Smoke test en producción**

En `*.vercel.app` **solo `web` es utilizable**: `erp` y `admin` redirigen en
bucle al login de `web` porque la cookie de sesión es host-only y `vercel.app`
está en la Public Suffix List (no hay dominio raíz común entre subdominios
`vercel.app` del que colgarla). El smoke test completo (login cruzado a
`erp`/`admin`) requiere primero configurar un dominio propio y
`NEXT_PUBLIC_COOKIE_DOMAIN=.dominio.cl` (ver `docs/deploy.md` §5) y solo
entonces correrlo (`docs/deploy.md` §6):

1. Abrir la URL del portal → registro con un RUT de prueba → éxito (smoke test
   parcial en `*.vercel.app`, ver `docs/deploy.md` §4).
2. Configurar dominio propio + `NEXT_PUBLIC_COOKIE_DOMAIN=.dominio.cl` + redeploy
   de las 3 apps (`docs/deploy.md` §5).
3. Login en el dominio propio → clic "Entrar al ERP" → la cookie ahora es
   compartida → se ve la organización sin pedir login de nuevo.
4. Abrir admin con el correo de `ADMIN_EMAILS` → activar la organización de prueba.
5. Borrar la organización de prueba desde el SQL editor de Supabase.

- [ ] **Step 4: Escribir el runbook**

Crear `docs/deploy.md` documentando exactamente lo ejecutado: URLs de los 3 proyectos Vercel, ref del proyecto Supabase, dónde viven las env vars, cómo aplicar nuevas migraciones (`pnpm supabase db push`), y el paso pendiente para cuando exista dominio propio (apuntar DNS en Vercel, poner `NEXT_PUBLIC_COOKIE_DOMAIN=.dominio.cl` en las 3 apps y redeploy — eso habilita el SSO real entre subdominios).

- [ ] **Step 5: Commit**

```bash
git add docs/deploy.md
git commit -m "docs: runbook de deploy a Supabase y Vercel"
```

---

## Verificación final del plan

Al completar las 13 tasks:

- `pnpm test` — unitarios de `@suite/core` y `@suite/auth` verdes.
- `pnpm supabase test db` — 13 asserts pgTAP verdes (aislamiento RLS + registro).
- `pnpm build` — 3 apps compilan.
- Flujo real en producción: registro → login → ERP muestra organización → admin activa el plan.

Esto cumple la porción del spec (secciones 3, 4, 5.2 parcial, 5.3 parcial, 7, 9) que corresponde a la fundación. Los planes 2-6 construyen el resto de la Fase 1 sobre esta base.
