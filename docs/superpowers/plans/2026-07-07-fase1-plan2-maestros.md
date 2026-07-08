# Suite ERP — Fase 1, Plan 2: Maestros ERP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El ERP administra el catálogo de productos (con categorías) y la cartera de clientes de la empresa activa, con carga masiva por CSV, sobre un design system compartido (`@suite/ui` + Tailwind) con navegación lateral y selector de empresa.

**Architecture:** Se agregan 3 tablas multi-tenant (categorias_producto, productos, clientes) con RLS por empresa + grants explícitos y validación de RUT en la BD. Nace `packages/ui` (componentes React + Tailwind v4, solo montado en `apps/erp` por ahora). La "empresa activa" vive en una cookie validada server-side; las Server Actions JAMÁS toman `empresa_id` del formulario. La lógica pura de import (parser CSV, validadores de fila, parseo de precios CLP) va en `@suite/core` con TDD.

**Tech Stack:** Lo de Plan 1 (Next.js 15, React 19, TS strict, Supabase con Postgres 17, pgTAP, Vitest) + Tailwind CSS v4 (`tailwindcss`, `@tailwindcss/postcss`) solo en `apps/erp`. **Sin ninguna otra dependencia nueva** (el CSV se parsea con código propio testeado; sin exceljs/papaparse/zod).

**Re-scope respecto a la secuencia original:** proveedores y bodegas se mueven al Plan 4 (compras/inventario), donde se consumen por primera vez. Plan 2 entrega exactamente lo que Plan 3 (ventas) necesita: productos y clientes.

## Global Constraints

- Node.js >= 20, pnpm >= 9, **Docker Desktop corriendo** (Supabase local y pgTAP).
- Windows/PowerShell 5.1: `&&` no funciona (usar `;`). Shells nuevas pueden requerir refresh del PATH: `$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User');`
- TypeScript `strict: true`; identificadores ASCII; dominio y UI en español; mensajes de error al usuario en español claro.
- Montos CLP en enteros. `TASA_IVA` parametrizado (ya existe).
- **LECCIÓN PLAN 1 (obligatoria):** toda migración que cree tablas en `public` DEBE incluir sus GRANTs explícitos (`authenticated` espejando lo que permiten las políticas; `service_role` con DML completo). Sin grant, todo da 42501 antes de evaluar RLS.
- Multi-tenant: toda tabla operacional lleva `empresa_id` + RLS. Tests pgTAP de aislamiento para cada tabla nueva. Si un assert falla, se corrige la política, nunca se debilita el test.
- **La empresa activa se resuelve SIEMPRE server-side** desde la cookie `empresa_activa` validada contra las membresías del usuario (`obtenerEmpresaActiva()`). Ninguna Server Action acepta `empresa_id` desde el formulario.
- Roles de escritura en maestros: `productos`/`categorias_producto`: `dueno`, `admin`. `clientes`: `dueno`, `admin`, `vendedor`. Lectura: cualquier miembro activo. Sin DELETE para `authenticated` (baja lógica vía `activo = false`).
- RUT de clientes se guarda **normalizado** (`limpiarRut` en la app; checks `rut = app.normalizar_rut(rut)` y `app.validar_rut(rut)` en la BD como última línea).
- Import masivo: **CSV** (UTF-8 o Windows-1252; delimitador `,` o `;` autodetectado; plantillas descargables). La UI indica "completa la plantilla en Excel y guarda como CSV". Límite 1.000 filas por archivo. El import de productos lo garantizan las políticas para `dueno`/`admin`; el de clientes también lo permite `vendedor` (misma matriz de roles que el CRUD).
- Tailwind v4 + `@suite/ui` solo en `apps/erp` (web y admin se estilizan en el Plan 6).
- Puertos dev: web 3000, erp 3001, admin 3002. Supabase local: API 54321, Studio 54323.
- Scope npm `@suite/*`. Commits frecuentes con mensajes convencionales en español.

---

### Task 1: `@suite/core` — utilidades de maestros e import (TDD)

**Files:**
- Create: `packages/core/src/maestros.ts`, `packages/core/src/csv.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/maestros.test.ts`, `packages/core/src/csv.test.ts`

**Interfaces:**
- Consumes: `validarRut`, `limpiarRut` de `./rut` (ya existen).
- Produces (desde `@suite/core`):
  - `formatearCLP(monto: number): string` — `12990` → `"$12.990"`.
  - `parsearPrecioCLP(valor: unknown): number | null` — acepta enteros y strings con `$`/puntos de miles; rechaza decimales.
  - `parsearBooleano(valor: unknown): boolean | null` — `'si'/'sí'/'1'/'true'/true` → `true`; `''/'no'/'0'/'false'/false/undefined/null` → `false`; otro → `null`.
  - `parsearCSV(texto: string): string[][]` — BOM, comillas, delimitador `,`/`;` autodetectado, CRLF.
  - `interface FilaProducto { sku: string; nombre: string; precioNeto: number; unidad: string; codigoBarras?: string; categoria?: string; exento: boolean }`
  - `interface FilaCliente { rut: string; razonSocial: string; giro?: string; email?: string; telefono?: string; direccion?: string; comuna?: string; condicionPagoDias: number }` (rut ya normalizado)
  - `type ResultadoFila<T> = { ok: true; datos: T } | { ok: false; errores: string[] }`
  - `validarFilaProducto(fila: Record<string, string>): ResultadoFila<FilaProducto>`
  - `validarFilaCliente(fila: Record<string, string>): ResultadoFila<FilaCliente>`

- [ ] **Step 1: Tests de maestros (fallan)**

`packages/core/src/maestros.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  formatearCLP,
  parsearBooleano,
  parsearPrecioCLP,
  validarFilaCliente,
  validarFilaProducto,
} from './maestros'

describe('formatearCLP', () => {
  it('separa miles con punto y antepone $', () => {
    expect(formatearCLP(12990)).toBe('$12.990')
    expect(formatearCLP(1500000)).toBe('$1.500.000')
    expect(formatearCLP(0)).toBe('$0')
    expect(formatearCLP(999)).toBe('$999')
  })
})

describe('parsearPrecioCLP', () => {
  it('acepta enteros y strings numéricos', () => {
    expect(parsearPrecioCLP(12990)).toBe(12990)
    expect(parsearPrecioCLP('12990')).toBe(12990)
    expect(parsearPrecioCLP('0')).toBe(0)
  })
  it('acepta formato chileno con $ y puntos de miles', () => {
    expect(parsearPrecioCLP('12.990')).toBe(12990)
    expect(parsearPrecioCLP(' $1.500.000 ')).toBe(1500000)
  })
  it('rechaza decimales, negativos y basura', () => {
    expect(parsearPrecioCLP('12,50')).toBeNull()
    expect(parsearPrecioCLP('12990.00')).toBeNull() // puntos que no agrupan de a 3
    expect(parsearPrecioCLP(-5)).toBeNull()
    expect(parsearPrecioCLP(12.5)).toBeNull()
    expect(parsearPrecioCLP('')).toBeNull()
    expect(parsearPrecioCLP('abc')).toBeNull()
    expect(parsearPrecioCLP(undefined)).toBeNull()
  })
})

describe('parsearBooleano', () => {
  it('reconoce afirmativos en español', () => {
    expect(parsearBooleano('si')).toBe(true)
    expect(parsearBooleano('SÍ')).toBe(true)
    expect(parsearBooleano('1')).toBe(true)
    expect(parsearBooleano('true')).toBe(true)
    expect(parsearBooleano(true)).toBe(true)
  })
  it('reconoce negativos y vacío como false', () => {
    expect(parsearBooleano('no')).toBe(false)
    expect(parsearBooleano('0')).toBe(false)
    expect(parsearBooleano('false')).toBe(false)
    expect(parsearBooleano('')).toBe(false)
    expect(parsearBooleano(undefined)).toBe(false)
    expect(parsearBooleano(null)).toBe(false)
  })
  it('devuelve null ante valores ambiguos', () => {
    expect(parsearBooleano('quizás')).toBeNull()
    expect(parsearBooleano('2')).toBeNull()
  })
})

describe('validarFilaProducto', () => {
  it('acepta una fila completa', () => {
    const r = validarFilaProducto({
      sku: ' A-001 ',
      nombre: ' Arroz grado 1 ',
      precio_neto: '12.990',
      unidad: 'UN',
      codigo_barras: '780001112223',
      categoria: 'Abarrotes',
      exento: 'no',
    })
    expect(r).toEqual({
      ok: true,
      datos: {
        sku: 'A-001',
        nombre: 'Arroz grado 1',
        precioNeto: 12990,
        unidad: 'UN',
        codigoBarras: '780001112223',
        categoria: 'Abarrotes',
        exento: false,
      },
    })
  })
  it('aplica defaults: unidad UN, exento false, opcionales ausentes', () => {
    const r = validarFilaProducto({ sku: 'B1', nombre: 'Pan', precio_neto: '990' })
    expect(r).toEqual({
      ok: true,
      datos: { sku: 'B1', nombre: 'Pan', precioNeto: 990, unidad: 'UN', exento: false },
    })
  })
  it('acumula todos los errores en español', () => {
    const r = validarFilaProducto({ sku: '', nombre: ' ', precio_neto: '12,5', exento: 'quizás' })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errores).toEqual([
        'El SKU es obligatorio',
        'El nombre es obligatorio',
        'El precio neto debe ser un entero CLP mayor o igual a 0',
        'El campo exento debe ser si/no',
      ])
    }
  })
})

describe('validarFilaCliente', () => {
  it('acepta una fila completa y normaliza el RUT', () => {
    const r = validarFilaCliente({
      rut: '76.543.210-3',
      razon_social: ' Comercial Andes SpA ',
      giro: 'Venta al por menor',
      email: 'contacto@andes.cl',
      telefono: '+56 9 1234 5678',
      direccion: 'Av. Siempre Viva 123',
      comuna: 'Maipú',
      condicion_pago_dias: '30',
    })
    expect(r).toEqual({
      ok: true,
      datos: {
        rut: '765432103',
        razonSocial: 'Comercial Andes SpA',
        giro: 'Venta al por menor',
        email: 'contacto@andes.cl',
        telefono: '+56 9 1234 5678',
        direccion: 'Av. Siempre Viva 123',
        comuna: 'Maipú',
        condicionPagoDias: 30,
      },
    })
  })
  it('defaults: condición de pago 0, opcionales ausentes', () => {
    const r = validarFilaCliente({ rut: '11111111-1', razon_social: 'Ana Ltda' })
    expect(r).toEqual({
      ok: true,
      datos: { rut: '111111111', razonSocial: 'Ana Ltda', condicionPagoDias: 0 },
    })
  })
  it('acumula errores: RUT inválido, razón social vacía, email sin @, condición fuera de rango', () => {
    const r = validarFilaCliente({
      rut: '76.543.210-K',
      razon_social: '',
      email: 'no-es-correo',
      condicion_pago_dias: '900',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errores).toEqual([
        'El RUT no es válido',
        'La razón social es obligatoria',
        'El correo no es válido',
        'La condición de pago debe ser un entero entre 0 y 120 días',
      ])
    }
  })
})
```

- [ ] **Step 2: Verificar que fallan**

Run: `pnpm --filter @suite/core test`
Expected: FAIL — `Cannot find module './maestros'`. Los tests existentes de rut/iva siguen verdes.

- [ ] **Step 3: Implementar `maestros.ts`**

`packages/core/src/maestros.ts`:

```ts
import { limpiarRut, validarRut } from './rut'

export function formatearCLP(monto: number): string {
  const signo = monto < 0 ? '-' : ''
  const digitos = Math.trunc(Math.abs(monto)).toString()
  return signo + '$' + digitos.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

export function parsearPrecioCLP(valor: unknown): number | null {
  if (typeof valor === 'number') {
    return Number.isInteger(valor) && valor >= 0 ? valor : null
  }
  if (typeof valor !== 'string') return null
  const limpio = valor.trim().replace(/^\$/, '').trim()
  if (limpio === '') return null
  // Enteros puros o con puntos agrupando exactamente de a 3 (formato chileno).
  if (!/^\d+$/.test(limpio) && !/^\d{1,3}(\.\d{3})+$/.test(limpio)) return null
  return Number(limpio.replace(/\./g, ''))
}

const AFIRMATIVOS = new Set(['si', 'sí', 's', '1', 'true', 'verdadero'])
const NEGATIVOS = new Set(['', 'no', 'n', '0', 'false', 'falso'])

export function parsearBooleano(valor: unknown): boolean | null {
  if (typeof valor === 'boolean') return valor
  if (valor === undefined || valor === null) return false
  const texto = String(valor).trim().toLowerCase()
  if (AFIRMATIVOS.has(texto)) return true
  if (NEGATIVOS.has(texto)) return false
  return null
}

export interface FilaProducto {
  sku: string
  nombre: string
  precioNeto: number
  unidad: string
  codigoBarras?: string
  categoria?: string
  exento: boolean
}

export interface FilaCliente {
  rut: string
  razonSocial: string
  giro?: string
  email?: string
  telefono?: string
  direccion?: string
  comuna?: string
  condicionPagoDias: number
}

export type ResultadoFila<T> = { ok: true; datos: T } | { ok: false; errores: string[] }

function opcional(valor: string | undefined): string | undefined {
  const texto = (valor ?? '').trim()
  return texto === '' ? undefined : texto
}

export function validarFilaProducto(fila: Record<string, string>): ResultadoFila<FilaProducto> {
  const errores: string[] = []
  const sku = (fila.sku ?? '').trim()
  const nombre = (fila.nombre ?? '').trim()
  const precioNeto = parsearPrecioCLP(fila.precio_neto)
  const exento = parsearBooleano(fila.exento)

  if (sku === '') errores.push('El SKU es obligatorio')
  if (nombre === '') errores.push('El nombre es obligatorio')
  if (precioNeto === null) errores.push('El precio neto debe ser un entero CLP mayor o igual a 0')
  if (exento === null) errores.push('El campo exento debe ser si/no')

  if (errores.length > 0) return { ok: false, errores }
  return {
    ok: true,
    datos: {
      sku,
      nombre,
      precioNeto: precioNeto!,
      unidad: (fila.unidad ?? '').trim() || 'UN',
      ...(opcional(fila.codigo_barras) ? { codigoBarras: opcional(fila.codigo_barras) } : {}),
      ...(opcional(fila.categoria) ? { categoria: opcional(fila.categoria) } : {}),
      exento: exento!,
    },
  }
}

export function validarFilaCliente(fila: Record<string, string>): ResultadoFila<FilaCliente> {
  const errores: string[] = []
  const rutCrudo = (fila.rut ?? '').trim()
  const razonSocial = (fila.razon_social ?? '').trim()
  const email = opcional(fila.email)
  const condicionCruda = (fila.condicion_pago_dias ?? '').trim()

  if (!validarRut(rutCrudo)) errores.push('El RUT no es válido')
  if (razonSocial === '') errores.push('La razón social es obligatoria')
  if (email !== undefined && !email.includes('@')) errores.push('El correo no es válido')

  let condicionPagoDias = 0
  if (condicionCruda !== '') {
    const n = Number(condicionCruda)
    if (!Number.isInteger(n) || n < 0 || n > 120) {
      errores.push('La condición de pago debe ser un entero entre 0 y 120 días')
    } else {
      condicionPagoDias = n
    }
  }

  if (errores.length > 0) return { ok: false, errores }
  return {
    ok: true,
    datos: {
      rut: limpiarRut(rutCrudo),
      razonSocial,
      ...(opcional(fila.giro) ? { giro: opcional(fila.giro) } : {}),
      ...(email ? { email } : {}),
      ...(opcional(fila.telefono) ? { telefono: opcional(fila.telefono) } : {}),
      ...(opcional(fila.direccion) ? { direccion: opcional(fila.direccion) } : {}),
      ...(opcional(fila.comuna) ? { comuna: opcional(fila.comuna) } : {}),
      condicionPagoDias,
    },
  }
}
```

Run: `pnpm --filter @suite/core test`
Expected: los tests de maestros pasan; siguen los de csv por crear.

- [ ] **Step 4: Tests del parser CSV (fallan)**

`packages/core/src/csv.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parsearCSV } from './csv'

describe('parsearCSV', () => {
  it('parsea CSV simple con coma', () => {
    expect(parsearCSV('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ])
  })
  it('autodetecta punto y coma (export típico de Excel chileno)', () => {
    expect(parsearCSV('sku;nombre;precio\nA1;Arroz;12.990')).toEqual([
      ['sku', 'nombre', 'precio'],
      ['A1', 'Arroz', '12.990'],
    ])
  })
  it('respeta comillas: delimitadores y saltos dentro del campo', () => {
    expect(parsearCSV('a,"b,c",d\n"línea1\nlínea2",x,y')).toEqual([
      ['a', 'b,c', 'd'],
      ['línea1\nlínea2', 'x', 'y'],
    ])
  })
  it('des-escapa comillas dobles', () => {
    expect(parsearCSV('nombre\n"Arroz ""premium"""')).toEqual([['nombre'], ['Arroz "premium"']])
  })
  it('maneja CRLF, BOM y línea final vacía', () => {
    expect(parsearCSV('\uFEFFa,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })
  it('texto vacío da lista vacía', () => {
    expect(parsearCSV('')).toEqual([])
    expect(parsearCSV('\n\n')).toEqual([])
  })
})
```

- [ ] **Step 5: Verificar que fallan**

Run: `pnpm --filter @suite/core test`
Expected: FAIL — `Cannot find module './csv'`.

- [ ] **Step 6: Implementar `csv.ts`**

`packages/core/src/csv.ts`:

```ts
function detectarDelimitador(primeraLinea: string): ',' | ';' {
  let comas = 0
  let puntosComa = 0
  let enComillas = false
  for (const ch of primeraLinea) {
    if (ch === '"') enComillas = !enComillas
    else if (!enComillas && ch === ',') comas++
    else if (!enComillas && ch === ';') puntosComa++
  }
  return puntosComa > comas ? ';' : ','
}

export function parsearCSV(texto: string): string[][] {
  const limpio = texto.replace(/^\uFEFF/, '')
  if (limpio.trim() === '') return []
  const finPrimeraLinea = limpio.indexOf('\n')
  const primeraLinea = finPrimeraLinea === -1 ? limpio : limpio.slice(0, finPrimeraLinea)
  const delimitador = detectarDelimitador(primeraLinea)

  const filas: string[][] = []
  let fila: string[] = []
  let campo = ''
  let enComillas = false

  for (let i = 0; i < limpio.length; i++) {
    const ch = limpio[i]
    if (enComillas) {
      if (ch === '"') {
        if (limpio[i + 1] === '"') {
          campo += '"'
          i++
        } else {
          enComillas = false
        }
      } else {
        campo += ch
      }
    } else if (ch === '"') {
      enComillas = true
    } else if (ch === delimitador) {
      fila.push(campo)
      campo = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && limpio[i + 1] === '\n') i++
      fila.push(campo)
      campo = ''
      if (fila.some((c) => c.trim() !== '')) filas.push(fila)
      fila = []
    } else {
      campo += ch
    }
  }
  fila.push(campo)
  if (fila.some((c) => c.trim() !== '')) filas.push(fila)
  return filas
}
```

Actualizar `packages/core/src/index.ts`:

```ts
export * from './rut'
export * from './iva'
export * from './maestros'
export * from './csv'
```

- [ ] **Step 7: Verificar GREEN completo**

Run: `pnpm --filter @suite/core test`
Expected: PASS — suites rut, iva, maestros y csv verdes (16 tests previos + los nuevos).

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/maestros.ts packages/core/src/maestros.test.ts packages/core/src/csv.ts packages/core/src/csv.test.ts packages/core/src/index.ts
git commit -m "feat(core): utilidades de maestros e import CSV (precios CLP, filas, parser)"
```

---

### Task 2: Migración de maestros (categorías, productos, clientes)

**Files:**
- Create: `supabase/migrations/00000000000003_maestros.sql`

**Interfaces:**
- Consumes: `empresas`, `miembros`, `app.normalizar_rut`, `app.validar_rut` (Plan 1).
- Produces:
  - `app.mis_empresas() returns setof uuid` — empresas de las organizaciones donde soy miembro activo.
  - `app.tiene_rol_en_empresa(emp uuid, roles text[]) returns boolean`.
  - Tablas `categorias_producto`, `productos`, `clientes` con RLS + grants. Roles de escritura según Global Constraints.

- [ ] **Step 1: Escribir la migración**

`supabase/migrations/00000000000003_maestros.sql`:

```sql
-- Maestros del ERP: categorías, productos y clientes (multi-tenant por empresa).

-- ---------- Helpers de autorización a nivel empresa ----------

create or replace function app.mis_empresas()
returns setof uuid
language sql stable security definer
set search_path = public
as $$
  select e.id
  from empresas e
  join miembros m on m.organizacion_id = e.organizacion_id
  where m.usuario_id = auth.uid() and m.estado = 'activo'
$$;

create or replace function app.tiene_rol_en_empresa(emp uuid, roles text[])
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from empresas e
    join miembros m on m.organizacion_id = e.organizacion_id
    where e.id = emp
      and m.usuario_id = auth.uid()
      and m.estado = 'activo'
      and m.rol = any (roles)
  )
$$;

-- ---------- Tablas ----------

create table public.categorias_producto (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  nombre text not null,
  creado_en timestamptz not null default now(),
  unique (empresa_id, nombre),
  unique (empresa_id, id)
);

create table public.productos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  categoria_id uuid,
  sku text not null,
  nombre text not null,
  descripcion text,
  codigo_barras text,
  unidad text not null default 'UN',
  precio_neto integer not null check (precio_neto >= 0),
  exento boolean not null default false,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  unique (empresa_id, sku),
  foreign key (empresa_id, categoria_id) references public.categorias_producto (empresa_id, id)
);

create index productos_nombre_idx on public.productos (empresa_id, nombre);
create index productos_codigo_barras_idx on public.productos (empresa_id, codigo_barras);
create index productos_categoria_idx on public.productos (empresa_id, categoria_id);

create table public.clientes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  -- Última línea de defensa: normalizado y con DV correcto también en la BD.
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
  unique (empresa_id, rut)
);

create index clientes_razon_social_idx on public.clientes (empresa_id, razon_social);

-- ---------- RLS ----------

alter table public.categorias_producto enable row level security;
alter table public.productos enable row level security;
alter table public.clientes enable row level security;

create policy "miembros ven categorias" on public.categorias_producto
  for select to authenticated
  using (empresa_id in (select app.mis_empresas()));

create policy "duenos crean categorias" on public.categorias_producto
  for insert to authenticated
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']));

create policy "duenos editan categorias" on public.categorias_producto
  for update to authenticated
  using (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']))
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']));

create policy "miembros ven productos" on public.productos
  for select to authenticated
  using (empresa_id in (select app.mis_empresas()));

create policy "duenos crean productos" on public.productos
  for insert to authenticated
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']));

create policy "duenos editan productos" on public.productos
  for update to authenticated
  using (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']))
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']));

create policy "miembros ven clientes" on public.clientes
  for select to authenticated
  using (empresa_id in (select app.mis_empresas()));

create policy "vendedores crean clientes" on public.clientes
  for insert to authenticated
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin', 'vendedor']));

create policy "vendedores editan clientes" on public.clientes
  for update to authenticated
  using (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin', 'vendedor']))
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin', 'vendedor']));

-- ---------- Grants Data API (lección Plan 1: sin esto todo da 42501) ----------

grant select, insert, update on public.categorias_producto, public.productos, public.clientes to authenticated;
grant select, insert, update, delete on public.categorias_producto, public.productos, public.clientes to service_role;
```

- [ ] **Step 2: Aplicar y verificar**

Run: `pnpm supabase db reset`
Expected: aplica las 3 migraciones sin errores.

Run: `pnpm supabase test db`
Expected: los 13 asserts existentes siguen verdes (los de maestros llegan en Task 3).

Run: `pnpm supabase db diff`
Expected: `No schema changes found`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/00000000000003_maestros.sql
git commit -m "feat(db): maestros de productos y clientes con RLS por empresa y grants"
```

---

### Task 3: pgTAP de maestros (aislamiento + roles + checks)

**Files:**
- Create: `supabase/tests/database/maestros.test.sql`

**Interfaces:**
- Consumes: esquema de Tasks 2 y Plan 1. Patrón de impersonación de Plan 1.
- Produces: garantía verificable del aislamiento por empresa y de la matriz de roles en maestros.

- [ ] **Step 1: Escribir el test**

`supabase/tests/database/maestros.test.sql`:

```sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

-- Usuarios: Ana (duena org A), Beto (dueno org B), Vito (vendedor org A).
insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'ana@empresa-a.cl'),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'beto@empresa-b.cl'),
  ('00000000-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444', 'authenticated', 'authenticated', 'vito@empresa-a.cl');

insert into public.organizaciones (id, rut, razon_social)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '761111116', 'Organización A'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '762222221', 'Organización B');

insert into public.empresas (id, organizacion_id, rut, razon_social)
values
  ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '761111116', 'Empresa A SpA'),
  ('eeeeeeee-0000-0000-0000-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '762222221', 'Empresa B SpA');

insert into public.miembros (usuario_id, organizacion_id, rol)
values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'dueno'),
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'dueno'),
  ('44444444-4444-4444-4444-444444444444', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'vendedor');

-- Producto seed de la empresa A (como service role implícito: rol postgres).
insert into public.productos (empresa_id, sku, nombre, precio_neto)
values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'A-001', 'Arroz', 12990);

-- 1-2) Ana (duena A): ve su producto y puede crear otro.
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select results_eq(
  'select count(*) from productos',
  array[1::bigint],
  'Ana ve exactamente su producto'
);

select lives_ok(
  $$insert into productos (empresa_id, sku, nombre, precio_neto)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'A-002', 'Azúcar', 8990)$$,
  'la dueña puede crear productos en su empresa'
);

-- 3) Beto (dueno B) no ve los productos de A.
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

select results_eq(
  'select count(*) from productos',
  array[0::bigint],
  'Beto no ve productos de la empresa A'
);

-- 4) Beto no puede crear productos en la empresa A.
select throws_ok(
  $$insert into productos (empresa_id, sku, nombre, precio_neto)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'X-1', 'Intruso', 1)$$,
  '42501',
  'new row violates row-level security policy for table "productos"',
  'Beto no puede crear productos en la empresa A'
);

-- 5-6) Vito (vendedor A): puede crear clientes pero NO productos.
set local request.jwt.claims to '{"sub": "44444444-4444-4444-4444-444444444444", "role": "authenticated"}';

select lives_ok(
  $$insert into clientes (empresa_id, rut, razon_social)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '765432103', 'Cliente Uno SpA')$$,
  'el vendedor puede crear clientes'
);

select throws_ok(
  $$insert into productos (empresa_id, sku, nombre, precio_neto)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'V-1', 'No debería', 1)$$,
  '42501',
  'new row violates row-level security policy for table "productos"',
  'el vendedor no puede crear productos'
);

select results_eq(
  $$with u as (
    update productos set nombre = 'Hackeado'
    where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
    returning 1
  ) select count(*) from u$$,
  array[0::bigint],
  'el vendedor no puede editar productos (RLS filtra, 0 filas)'
);

-- 7-8) Checks de RUT en clientes: inválido y sin normalizar se rechazan.
select throws_ok(
  $$insert into clientes (empresa_id, rut, razon_social)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '765432104', 'DV Malo SpA')$$,
  '23514',
  null,
  'RUT con DV incorrecto viola el check'
);

select throws_ok(
  $$insert into clientes (empresa_id, rut, razon_social)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '76.543.210-3', 'Sin Normalizar SpA')$$,
  '23514',
  null,
  'RUT sin normalizar viola el check'
);

-- 9) Anónimo: denegado de plano.
set local request.jwt.claims to '{"role": "anon"}';
set local role anon;

select throws_ok(
  'select count(*) from productos',
  '42501',
  'permission denied for table productos',
  'un anónimo no puede consultar productos'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Correr y verificar**

Run: `pnpm supabase test db`
Expected: 3 archivos, 23 asserts en total (6 aislamiento + 7 registro + 10 maestros), todos verdes. Si un assert de maestros falla, se corrige la migración de Task 2 (nunca el test) — reportar BLOCKED si el fix no es obvio.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/database/maestros.test.sql
git commit -m "test(db): aislamiento y matriz de roles de maestros con pgTAP"
```

---

### Task 4: Regenerar tipos `@suite/db`

**Files:**
- Modify: `packages/db/src/types.ts` (regenerado)

**Interfaces:**
- Produces: tipo `Database` actualizado con `categorias_producto`, `productos`, `clientes` (lo consumen Tasks 6-9).

- [ ] **Step 1: Regenerar y verificar**

Run: `pnpm --filter @suite/db gen`
Expected: `packages/db/src/types.ts` regenerado; contiene las 3 tablas nuevas.

Run: `pnpm tsc --noEmit -p packages/db/tsconfig.json`
Expected: sin errores.

Run: `pnpm build`
Expected: las 3 apps siguen compilando.

- [ ] **Step 2: Commit**

```bash
git add packages/db/src/types.ts
git commit -m "feat(db): tipos regenerados con tablas de maestros"
```

---

### Task 5: `@suite/ui` — design system con Tailwind v4 (montado en `apps/erp`)

**Files:**
- Create: `packages/ui/package.json`, `packages/ui/tsconfig.json`, `packages/ui/src/index.ts`, `packages/ui/src/tema.css`, `packages/ui/src/cn.ts`, `packages/ui/src/boton.tsx`, `packages/ui/src/campo.tsx`, `packages/ui/src/tabla.tsx`, `packages/ui/src/insignia.tsx`, `packages/ui/src/tarjeta.tsx`, `packages/ui/src/encabezado.tsx`, `packages/ui/src/barra-lateral.tsx`, `packages/ui/src/paginacion.tsx`, `apps/erp/postcss.config.mjs`, `apps/erp/app/globals.css`
- Modify: `apps/erp/package.json`, `apps/erp/next.config.ts`, `apps/erp/app/layout.tsx`

**Interfaces:**
- Consumes: nada nuevo del monorepo.
- Produces (desde `@suite/ui`): `cn`, `Boton` (`variante?: 'primario' | 'secundario' | 'peligro'`), `Campo` (`etiqueta`, `error?`, children), `Entrada`, `Selector`, `Tabla`/`Th`/`Td`/`Tr`, `Insignia` (`tono: 'verde' | 'amarillo' | 'rojo' | 'gris'`), `Tarjeta`, `Encabezado` (`titulo`, `children?` = acciones), `BarraLateral` (`items: { href: string; etiqueta: string }[]`, client component con resaltado por ruta), `Paginacion` (`pagina`, `totalPaginas`, `hrefBase`).

- [ ] **Step 1: Scaffold del paquete UI**

`packages/ui/package.json`:

```json
{
  "name": "@suite/ui",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./tema.css": "./src/tema.css"
  },
  "peerDependencies": {
    "next": "^15.1.0",
    "react": "^19.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "next": "^15.1.0",
    "react": "^19.0.0",
    "typescript": "^5.7.0"
  }
}
```

`packages/ui/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "jsx": "preserve" },
  "include": ["src"]
}
```

`packages/ui/src/tema.css`:

```css
@theme {
  /* Marca: azul petróleo profesional */
  --color-marca-50: #f0f7fa;
  --color-marca-100: #dcebf2;
  --color-marca-200: #bcd8e6;
  --color-marca-300: #8dbcd3;
  --color-marca-400: #5698ba;
  --color-marca-500: #3b7ea1;
  --color-marca-600: #2d6485;
  --color-marca-700: #27546e;
  --color-marca-800: #24485d;
  --color-marca-900: #223e4f;
  --color-marca-950: #16293a;
}
```

`packages/ui/src/cn.ts`:

```ts
export function cn(...clases: Array<string | false | null | undefined>): string {
  return clases.filter(Boolean).join(' ')
}
```

- [ ] **Step 2: Componentes**

`packages/ui/src/boton.tsx`:

```tsx
import type { ButtonHTMLAttributes } from 'react'
import { cn } from './cn'

const VARIANTES = {
  primario: 'bg-marca-600 text-white hover:bg-marca-700 disabled:bg-marca-300',
  secundario: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:text-slate-400',
  peligro: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300',
} as const

export interface BotonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: keyof typeof VARIANTES
}

export function Boton({ variante = 'primario', className, ...props }: BotonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed',
        VARIANTES[variante],
        className
      )}
      {...props}
    />
  )
}
```

`packages/ui/src/campo.tsx`:

```tsx
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'
import { cn } from './cn'

export function Campo({
  etiqueta,
  error,
  children,
}: {
  etiqueta: string
  error?: string
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{etiqueta}</span>
      {children}
      {error && <span className="mt-1 block text-sm text-red-600">{error}</span>}
    </label>
  )
}

const CLASES_CONTROL =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-marca-500 focus:outline-none focus:ring-1 focus:ring-marca-500'

export function Entrada({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(CLASES_CONTROL, className)} {...props} />
}

export function Selector({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(CLASES_CONTROL, 'bg-white', className)} {...props} />
}
```

`packages/ui/src/tabla.tsx`:

```tsx
import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react'
import { cn } from './cn'

export function Tabla({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">{children}</table>
    </div>
  )
}

export function Th({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn('border-b border-slate-200 bg-slate-50 px-4 py-3 font-medium text-slate-600', className)}
      {...props}
    />
  )
}

export function Tr({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('hover:bg-slate-50', className)} {...props} />
}

export function Td({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('border-b border-slate-100 px-4 py-3 text-slate-800', className)} {...props} />
}
```

`packages/ui/src/insignia.tsx`:

```tsx
import type { ReactNode } from 'react'
import { cn } from './cn'

const TONOS = {
  verde: 'bg-green-100 text-green-800',
  amarillo: 'bg-amber-100 text-amber-800',
  rojo: 'bg-red-100 text-red-800',
  gris: 'bg-slate-100 text-slate-600',
} as const

export function Insignia({ tono, children }: { tono: keyof typeof TONOS; children: ReactNode }) {
  return (
    <span className={cn('inline-block rounded-full px-2.5 py-0.5 text-xs font-medium', TONOS[tono])}>
      {children}
    </span>
  )
}
```

`packages/ui/src/tarjeta.tsx`:

```tsx
import type { ReactNode } from 'react'
import { cn } from './cn'

export function Tarjeta({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section className={cn('rounded-lg border border-slate-200 bg-white p-5', className)}>{children}</section>
  )
}
```

`packages/ui/src/encabezado.tsx`:

```tsx
import type { ReactNode } from 'react'

export function Encabezado({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold text-slate-900">{titulo}</h1>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  )
}
```

`packages/ui/src/barra-lateral.tsx`:

```tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { cn } from './cn'

export interface ItemNav {
  href: string
  etiqueta: string
}

export function BarraLateral({
  titulo,
  items,
  pie,
}: {
  titulo: string
  items: ItemNav[]
  pie?: ReactNode
}) {
  const ruta = usePathname()
  return (
    <aside className="flex h-screen w-56 shrink-0 flex-col border-r border-slate-200 bg-marca-950 text-white">
      <div className="px-4 py-5 text-lg font-semibold">{titulo}</div>
      <nav className="flex-1 space-y-1 px-2">
        {items.map((item) => {
          const activo = item.href === '/' ? ruta === '/' : ruta.startsWith(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'block rounded-md px-3 py-2 text-sm',
                activo ? 'bg-marca-700 font-medium text-white' : 'text-marca-100 hover:bg-marca-800'
              )}
            >
              {item.etiqueta}
            </Link>
          )
        })}
      </nav>
      {pie && <div className="border-t border-marca-800 p-3">{pie}</div>}
    </aside>
  )
}
```

`packages/ui/src/paginacion.tsx`:

```tsx
import Link from 'next/link'
import { cn } from './cn'

export function Paginacion({
  pagina,
  totalPaginas,
  hrefBase,
}: {
  pagina: number
  totalPaginas: number
  hrefBase: string // ej. "/productos?q=arroz" — se le agrega &pagina=N
}) {
  if (totalPaginas <= 1) return null
  const separador = hrefBase.includes('?') ? '&' : '?'
  const enlace = (n: number) => `${hrefBase}${separador}pagina=${n}`
  const clase = (deshabilitado: boolean) =>
    cn(
      'rounded-md border border-slate-300 px-3 py-1.5 text-sm',
      deshabilitado ? 'pointer-events-none text-slate-300' : 'text-slate-700 hover:bg-slate-50'
    )
  return (
    <nav className="mt-4 flex items-center justify-between">
      <Link href={enlace(pagina - 1)} className={clase(pagina <= 1)} aria-disabled={pagina <= 1}>
        ← Anterior
      </Link>
      <span className="text-sm text-slate-500">
        Página {pagina} de {totalPaginas}
      </span>
      <Link href={enlace(pagina + 1)} className={clase(pagina >= totalPaginas)} aria-disabled={pagina >= totalPaginas}>
        Siguiente →
      </Link>
    </nav>
  )
}
```

`packages/ui/src/index.ts`:

```ts
export { cn } from './cn'
export { Boton, type BotonProps } from './boton'
export { Campo, Entrada, Selector } from './campo'
export { Tabla, Th, Tr, Td } from './tabla'
export { Insignia } from './insignia'
export { Tarjeta } from './tarjeta'
export { Encabezado } from './encabezado'
export { BarraLateral, type ItemNav } from './barra-lateral'
export { Paginacion } from './paginacion'
```

- [ ] **Step 3: Montar Tailwind en `apps/erp`**

Run: `pnpm --filter erp add tailwindcss @tailwindcss/postcss`
Expected: agrega ambas dependencias (^4.x).

Run: `pnpm --filter erp add '@suite/ui@workspace:*'`
Expected: agrega la dependencia workspace.

`apps/erp/postcss.config.mjs`:

```js
export default {
  plugins: { '@tailwindcss/postcss': {} },
}
```

(Si esta versión de Next no detectara `postcss.config.mjs`, renombrar a `postcss.config.js` con `module.exports = { plugins: { '@tailwindcss/postcss': {} } }` — mismo contenido en CJS.)

`apps/erp/app/globals.css`:

```css
@import 'tailwindcss';
@import '../../../packages/ui/src/tema.css';
@source '../../../packages/ui/src';
```

Modificar `apps/erp/next.config.ts` — agregar `'@suite/ui'` a `transpilePackages`:

```ts
import type { NextConfig } from 'next'

const config: NextConfig = {
  transpilePackages: ['@suite/core', '@suite/db', '@suite/auth', '@suite/ui'],
}

export default config
```

Modificar `apps/erp/app/layout.tsx` para importar los estilos (el shell con sidebar llega en Task 6):

```tsx
import type { ReactNode } from 'react'
import './globals.css'

export const metadata = { title: 'Suite ERP' }

export default function LayoutRaiz({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body className="bg-slate-100 text-slate-900 antialiased">{children}</body>
    </html>
  )
}
```

- [ ] **Step 4: Verificar build y estilos**

Run: `pnpm --filter erp build`
Expected: build sin errores (valida Tailwind + transpile de `@suite/ui`).

Con el dev server corriendo, `curl.exe -s http://localhost:3001` (tras login redirect basta ver que el HTML raíz responde). La verificación visual completa ocurre en Task 6.

- [ ] **Step 5: Commit**

```bash
git add packages/ui apps/erp/postcss.config.mjs apps/erp/app/globals.css apps/erp/next.config.ts apps/erp/app/layout.tsx apps/erp/package.json pnpm-lock.yaml
git commit -m "feat(ui): design system @suite/ui con Tailwind v4 montado en el ERP"
```

---

### Task 6: ERP — empresa activa, layout con sidebar y dashboard

**Files:**
- Create: `apps/erp/lib/empresa-activa.ts`, `apps/erp/app/acciones.ts`, `apps/erp/componentes/selector-empresa.tsx`
- Modify: `apps/erp/app/layout.tsx`, `apps/erp/app/page.tsx`

**Interfaces:**
- Consumes: `crearClienteServidor` (`@suite/auth/server`), `formatearRut` (`@suite/core`), `BarraLateral`/`Tarjeta`/`Encabezado`/`Insignia`/`Selector` (`@suite/ui`).
- Produces (contrato para Tasks 7-9):
  - `obtenerEmpresaActiva(): Promise<{ activa: EmpresaResumen | null; empresas: EmpresaResumen[] }>` en `apps/erp/lib/empresa-activa.ts`, con `interface EmpresaResumen { id: string; rut: string; razon_social: string }`. Lee la cookie `empresa_activa` y la valida contra las empresas visibles por RLS; fallback: primera empresa.
  - Server Action `cambiarEmpresaActiva(formData: FormData)` en `apps/erp/app/acciones.ts`.
  - El layout envuelve TODAS las páginas con sidebar (Inicio, Productos, Clientes, Importar) + selector de empresa.

- [ ] **Step 1: Helper de empresa activa**

`apps/erp/lib/empresa-activa.ts`:

```ts
import 'server-only'
import { cookies } from 'next/headers'
import { crearClienteServidor } from '@suite/auth/server'

export const COOKIE_EMPRESA = 'empresa_activa'

export interface EmpresaResumen {
  id: string
  rut: string
  razon_social: string
}

export async function obtenerEmpresas(): Promise<EmpresaResumen[]> {
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase
    .from('empresas')
    .select('id, rut, razon_social')
    .order('razon_social')
  if (error) throw new Error('No se pudieron cargar tus empresas')
  return data ?? []
}

export async function obtenerEmpresaActiva(): Promise<{
  activa: EmpresaResumen | null
  empresas: EmpresaResumen[]
}> {
  const empresas = await obtenerEmpresas()
  const almacen = await cookies()
  const id = almacen.get(COOKIE_EMPRESA)?.value
  const activa = empresas.find((e) => e.id === id) ?? empresas[0] ?? null
  return { activa, empresas }
}
```

- [ ] **Step 2: Server Action para cambiar de empresa**

`apps/erp/app/acciones.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { COOKIE_EMPRESA, obtenerEmpresas } from '../lib/empresa-activa'

export async function cambiarEmpresaActiva(formData: FormData) {
  const id = String(formData.get('empresa_id') ?? '')
  const empresas = await obtenerEmpresas()
  if (!empresas.some((e) => e.id === id)) {
    throw new Error('La empresa seleccionada no pertenece a tu organización')
  }
  const almacen = await cookies()
  almacen.set(COOKIE_EMPRESA, id, { path: '/', httpOnly: true, sameSite: 'lax' })
  revalidatePath('/', 'layout')
}
```

- [ ] **Step 3: Selector (client) y layout con sidebar**

`apps/erp/componentes/selector-empresa.tsx`:

```tsx
'use client'

import { Selector } from '@suite/ui'
import type { EmpresaResumen } from '../lib/empresa-activa'

export function SelectorEmpresa({
  empresas,
  activaId,
  accion,
}: {
  empresas: EmpresaResumen[]
  activaId: string
  accion: (formData: FormData) => Promise<void>
}) {
  if (empresas.length <= 1) return null
  return (
    <form action={accion}>
      <Selector
        name="empresa_id"
        defaultValue={activaId}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="border-marca-700 bg-marca-900 text-white"
        aria-label="Empresa activa"
      >
        {empresas.map((e) => (
          <option key={e.id} value={e.id}>
            {e.razon_social}
          </option>
        ))}
      </Selector>
    </form>
  )
}
```

Reemplazar `apps/erp/app/layout.tsx`:

```tsx
import type { ReactNode } from 'react'
import { BarraLateral } from '@suite/ui'
import './globals.css'
import { cambiarEmpresaActiva } from './acciones'
import { SelectorEmpresa } from '../componentes/selector-empresa'
import { obtenerEmpresaActiva } from '../lib/empresa-activa'

export const metadata = { title: 'Suite ERP' }

const NAV = [
  { href: '/', etiqueta: 'Inicio' },
  { href: '/productos', etiqueta: 'Productos' },
  { href: '/clientes', etiqueta: 'Clientes' },
  { href: '/importar', etiqueta: 'Importar' },
]

export default async function LayoutRaiz({ children }: { children: ReactNode }) {
  const { activa, empresas } = await obtenerEmpresaActiva()
  return (
    <html lang="es">
      <body className="bg-slate-100 text-slate-900 antialiased">
        <div className="flex">
          <BarraLateral
            titulo="Suite ERP"
            items={NAV}
            pie={
              activa && (
                <SelectorEmpresa empresas={empresas} activaId={activa.id} accion={cambiarEmpresaActiva} />
              )
            }
          />
          <main className="min-h-screen flex-1 p-8">{children}</main>
        </div>
      </body>
    </html>
  )
}
```

- [ ] **Step 4: Dashboard de la empresa activa**

Reemplazar `apps/erp/app/page.tsx`:

```tsx
import { crearClienteServidor } from '@suite/auth/server'
import { formatearRut } from '@suite/core'
import { Encabezado, Insignia, Tarjeta } from '@suite/ui'
import { obtenerEmpresaActiva } from '../lib/empresa-activa'

export default async function Inicio() {
  const { activa } = await obtenerEmpresaActiva()

  if (!activa) {
    return (
      <div>
        <Encabezado titulo="Sin organización" />
        <Tarjeta>
          <p>
            Tu usuario no pertenece a ninguna organización. Pide una invitación o{' '}
            <a className="text-marca-600 underline" href={process.env.NEXT_PUBLIC_URL_WEB + '/registro'}>
              crea tu cuenta
            </a>
            .
          </p>
        </Tarjeta>
      </div>
    )
  }

  const supabase = await crearClienteServidor()
  const [{ data: organizacion }, productos, clientes] = await Promise.all([
    supabase
      .from('empresas')
      .select('organizaciones (estado, trial_hasta)')
      .eq('id', activa.id)
      .single()
      .then((r) => ({ data: r.data?.organizaciones ?? null })),
    supabase
      .from('productos')
      .select('id', { count: 'exact', head: true })
      .eq('empresa_id', activa.id)
      .eq('activo', true),
    supabase
      .from('clientes')
      .select('id', { count: 'exact', head: true })
      .eq('empresa_id', activa.id)
      .eq('activo', true),
  ])

  return (
    <div>
      <Encabezado titulo={activa.razon_social}>
        <span className="text-sm text-slate-500">{formatearRut(activa.rut)}</span>
      </Encabezado>

      {organizacion?.estado === 'trial' && (
        <div className="mb-6">
          <Insignia tono="amarillo">
            Período de prueba hasta el{' '}
            {new Date(organizacion.trial_hasta + 'T00:00:00').toLocaleDateString('es-CL')}
          </Insignia>
        </div>
      )}
      {organizacion?.estado === 'suspendida' && (
        <div className="mb-6">
          <Insignia tono="rojo">Organización suspendida. Contáctanos para reactivarla.</Insignia>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Tarjeta>
          <p className="text-sm text-slate-500">Productos activos</p>
          <p className="mt-1 text-3xl font-semibold">{productos.count ?? 0}</p>
        </Tarjeta>
        <Tarjeta>
          <p className="text-sm text-slate-500">Clientes activos</p>
          <p className="mt-1 text-3xl font-semibold">{clientes.count ?? 0}</p>
        </Tarjeta>
        <Tarjeta>
          <p className="text-sm text-slate-500">Ventas</p>
          <p className="mt-1 text-sm text-slate-400">Disponible en el módulo de ventas (Plan 3)</p>
        </Tarjeta>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Verificar**

Run: `pnpm --filter erp build`
Expected: build sin errores.

Verificación manual/scriptada: con sesión iniciada, `GET /` muestra sidebar con navegación, nombre y RUT de la empresa, banner de trial y contadores en 0. Sin sesión: redirect 307 al login (middleware intacto).

- [ ] **Step 6: Commit**

```bash
git add apps/erp/lib/empresa-activa.ts apps/erp/app/acciones.ts apps/erp/componentes/selector-empresa.tsx apps/erp/app/layout.tsx apps/erp/app/page.tsx
git commit -m "feat(erp): empresa activa con selector, layout con sidebar y dashboard"
```

---

### Task 7: CRUD de Productos (+ categorías)

**Files:**
- Create: `apps/erp/app/productos/page.tsx`, `apps/erp/app/productos/acciones.ts`, `apps/erp/app/productos/nuevo/page.tsx`, `apps/erp/app/productos/[id]/page.tsx`, `apps/erp/componentes/formulario-producto.tsx`
- Modify: (ninguno)

**Interfaces:**
- Consumes: `obtenerEmpresaActiva`, `@suite/ui`, `formatearCLP`/`parsearPrecioCLP` de `@suite/core`, tablas `productos`/`categorias_producto`.
- Produces: Server Actions `guardarProducto(prev, formData): Promise<EstadoForm>` (crea o edita según `formData.id`; `EstadoForm = { error?: string }` local del archivo `apps/erp/app/tipos.ts` — crearlo aquí) y `alternarActivoProducto(formData)`. Patrón de lista con búsqueda `?q=` y paginación `?pagina=` (25 por página) que Task 8 replica.

- [ ] **Step 1: Tipos compartidos del app**

Create `apps/erp/app/tipos.ts`:

```ts
export type EstadoForm = { error?: string }
```

- [ ] **Step 2: Server Actions de productos**

`apps/erp/app/productos/acciones.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { parsearPrecioCLP } from '@suite/core'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import type { EstadoForm } from '../tipos'

async function resolverCategoria(
  supabase: Awaited<ReturnType<typeof crearClienteServidor>>,
  empresaId: string,
  categoriaId: string,
  categoriaNueva: string
): Promise<{ id: string | null; error?: string }> {
  if (categoriaNueva.trim() !== '') {
    const { data, error } = await supabase
      .from('categorias_producto')
      .upsert(
        { empresa_id: empresaId, nombre: categoriaNueva.trim() },
        { onConflict: 'empresa_id,nombre' }
      )
      .select('id')
      .single()
    if (error) return { id: null, error: 'No se pudo crear la categoría' }
    return { id: data.id }
  }
  return { id: categoriaId || null }
}

export async function guardarProducto(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const id = String(formData.get('id') ?? '')
  const sku = String(formData.get('sku') ?? '').trim()
  const nombre = String(formData.get('nombre') ?? '').trim()
  const descripcion = String(formData.get('descripcion') ?? '').trim()
  const codigoBarras = String(formData.get('codigo_barras') ?? '').trim()
  const unidad = String(formData.get('unidad') ?? '').trim() || 'UN'
  const precioNeto = parsearPrecioCLP(String(formData.get('precio_neto') ?? ''))
  const exento = formData.get('exento') === 'on'

  if (sku === '') return { error: 'El SKU es obligatorio' }
  if (nombre === '') return { error: 'El nombre es obligatorio' }
  if (precioNeto === null) return { error: 'El precio neto debe ser un entero CLP mayor o igual a 0' }

  const supabase = await crearClienteServidor()
  const categoria = await resolverCategoria(
    supabase,
    activa.id,
    String(formData.get('categoria_id') ?? ''),
    String(formData.get('categoria_nueva') ?? '')
  )
  if (categoria.error) return { error: categoria.error }

  const datos = {
    sku,
    nombre,
    descripcion: descripcion || null,
    codigo_barras: codigoBarras || null,
    unidad,
    precio_neto: precioNeto,
    exento,
    categoria_id: categoria.id,
    actualizado_en: new Date().toISOString(),
  }

  if (id) {
    const { data, error } = await supabase
      .from('productos')
      .update(datos)
      .eq('id', id)
      .eq('empresa_id', activa.id)
      .select('id')
    if (error) {
      if (error.code === '23505') return { error: 'Ya existe un producto con ese SKU' }
      if (error.code === '42501') return { error: 'Tu rol no permite editar productos' }
      return { error: 'No se pudo guardar el producto' }
    }
    if ((data ?? []).length === 0) {
      return { error: 'No se pudo guardar: el producto no existe o tu rol no permite editarlo' }
    }
  } else {
    const { error } = await supabase
      .from('productos')
      .insert({ ...datos, empresa_id: activa.id })
    if (error) {
      if (error.code === '23505') return { error: 'Ya existe un producto con ese SKU' }
      if (error.code === '42501') return { error: 'Tu rol no permite crear productos' }
      return { error: 'No se pudo crear el producto' }
    }
  }

  revalidatePath('/productos')
  redirect('/productos')
}

export async function alternarActivoProducto(formData: FormData): Promise<void> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return
  const id = String(formData.get('id') ?? '')
  const activo = String(formData.get('activo') ?? '') === 'true'
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase
    .from('productos')
    .update({ activo: !activo, actualizado_en: new Date().toISOString() })
    .eq('id', id)
    .eq('empresa_id', activa.id)
    .select('id')
  if (error || (data ?? []).length === 0) {
    console.error('alternarActivo:', error ?? 'sin filas')
    return
  }
  revalidatePath('/productos')
}
```

- [ ] **Step 3: Lista con búsqueda y paginación**

`apps/erp/app/productos/page.tsx`:

```tsx
import Link from 'next/link'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP } from '@suite/core'
import { Boton, Encabezado, Entrada, Insignia, Paginacion, Tabla, Td, Th, Tr } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import { alternarActivoProducto } from './acciones'

const POR_PAGINA = 25

export default async function PaginaProductos({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; pagina?: string; inactivos?: string }>
}) {
  const { q = '', pagina: paginaCruda, inactivos } = await searchParams
  const pagina = Math.max(1, Math.trunc(Number(paginaCruda) || 1))
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />

  const supabase = await crearClienteServidor()
  let consulta = supabase
    .from('productos')
    .select('id, sku, nombre, unidad, precio_neto, exento, activo, categorias_producto (nombre)', {
      count: 'exact',
    })
    .eq('empresa_id', activa.id)
    .order('nombre')
    .range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1)
  if (inactivos !== '1') consulta = consulta.eq('activo', true)
  // Comas y paréntesis rompen la sintaxis del filtro .or() de PostgREST.
  const qLimpia = q.replace(/[,()]/g, ' ').trim()
  if (qLimpia) consulta = consulta.or(`nombre.ilike.%${qLimpia}%,sku.ilike.%${qLimpia}%`)

  const { data: productos, count, error } = await consulta
  if (error) throw new Error('No se pudieron cargar los productos')
  const totalPaginas = Math.max(1, Math.ceil((count ?? 0) / POR_PAGINA))

  const hrefBase = `/productos?q=${encodeURIComponent(q)}${inactivos === '1' ? '&inactivos=1' : ''}`

  return (
    <div>
      <Encabezado titulo="Productos">
        <Link href="/productos/nuevo">
          <Boton>Nuevo producto</Boton>
        </Link>
      </Encabezado>

      <form className="mb-4 flex items-center gap-3" action="/productos" method="get">
        <Entrada name="q" defaultValue={q} placeholder="Buscar por nombre o SKU…" className="max-w-xs" />
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" name="inactivos" value="1" defaultChecked={inactivos === '1'} />
          Ver inactivos
        </label>
        <Boton variante="secundario" type="submit">
          Buscar
        </Boton>
      </form>

      <Tabla>
        <thead>
          <tr>
            <Th>SKU</Th>
            <Th>Nombre</Th>
            <Th>Categoría</Th>
            <Th>Unidad</Th>
            <Th className="text-right">Precio neto</Th>
            <Th>Estado</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {(productos ?? []).map((p) => (
            <Tr key={p.id}>
              <Td className="font-mono">{p.sku}</Td>
              <Td>
                <Link className="text-marca-700 hover:underline" href={`/productos/${p.id}`}>
                  {p.nombre}
                </Link>
                {p.exento && (
                  <span className="ml-2">
                    <Insignia tono="gris">Exento</Insignia>
                  </span>
                )}
              </Td>
              <Td>{p.categorias_producto?.nombre ?? '—'}</Td>
              <Td>{p.unidad}</Td>
              <Td className="text-right">{formatearCLP(p.precio_neto)}</Td>
              <Td>{p.activo ? <Insignia tono="verde">Activo</Insignia> : <Insignia tono="gris">Inactivo</Insignia>}</Td>
              <Td>
                <form action={alternarActivoProducto}>
                  <input type="hidden" name="id" value={p.id} />
                  <input type="hidden" name="activo" value={String(p.activo)} />
                  <Boton variante="secundario" type="submit" className="px-2 py-1 text-xs">
                    {p.activo ? 'Desactivar' : 'Reactivar'}
                  </Boton>
                </form>
              </Td>
            </Tr>
          ))}
          {(productos ?? []).length === 0 && (
            <Tr>
              <Td colSpan={7} className="py-8 text-center text-slate-500">
                No hay productos {q ? 'que coincidan con la búsqueda' : 'todavía. Crea el primero o usa Importar'}.
              </Td>
            </Tr>
          )}
        </tbody>
      </Tabla>

      <Paginacion pagina={pagina} totalPaginas={totalPaginas} hrefBase={hrefBase} />
    </div>
  )
}
```

- [ ] **Step 4: Formulario compartido (client) y páginas crear/editar**

`apps/erp/componentes/formulario-producto.tsx`:

```tsx
'use client'

import { useActionState } from 'react'
import { Boton, Campo, Entrada, Selector, Tarjeta } from '@suite/ui'
import type { EstadoForm } from '../app/tipos'

export interface CategoriaOpcion {
  id: string
  nombre: string
}

export interface ProductoEditable {
  id?: string
  sku: string
  nombre: string
  descripcion: string
  codigo_barras: string
  unidad: string
  precio_neto: number | ''
  exento: boolean
  categoria_id: string
}

const VACIO: ProductoEditable = {
  sku: '',
  nombre: '',
  descripcion: '',
  codigo_barras: '',
  unidad: 'UN',
  precio_neto: '',
  exento: false,
  categoria_id: '',
}

export function FormularioProducto({
  accion,
  categorias,
  inicial = VACIO,
}: {
  accion: (prev: EstadoForm, formData: FormData) => Promise<EstadoForm>
  categorias: CategoriaOpcion[]
  inicial?: ProductoEditable
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoForm)
  return (
    <Tarjeta className="max-w-2xl">
      <form action={enviar} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {inicial.id && <input type="hidden" name="id" value={inicial.id} />}
        <Campo etiqueta="SKU *">
          <Entrada name="sku" defaultValue={inicial.sku} required />
        </Campo>
        <Campo etiqueta="Nombre *">
          <Entrada name="nombre" defaultValue={inicial.nombre} required />
        </Campo>
        <Campo etiqueta="Precio neto (CLP) *">
          <Entrada name="precio_neto" inputMode="numeric" defaultValue={inicial.precio_neto} required />
        </Campo>
        <Campo etiqueta="Unidad">
          <Entrada name="unidad" defaultValue={inicial.unidad} />
        </Campo>
        <Campo etiqueta="Código de barras">
          <Entrada name="codigo_barras" defaultValue={inicial.codigo_barras} />
        </Campo>
        <Campo etiqueta="Categoría">
          <Selector name="categoria_id" defaultValue={inicial.categoria_id}>
            <option value="">Sin categoría</option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </Selector>
        </Campo>
        <Campo etiqueta="…o crear categoría nueva">
          <Entrada name="categoria_nueva" placeholder="Ej: Abarrotes" />
        </Campo>
        <div className="sm:col-span-2">
          <Campo etiqueta="Descripción">
            <Entrada name="descripcion" defaultValue={inicial.descripcion} />
          </Campo>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" name="exento" defaultChecked={inicial.exento} />
          Exento de IVA
        </label>
        <div className="flex items-center justify-end gap-2 sm:col-span-2">
          {estado.error && <span className="mr-auto text-sm text-red-600">{estado.error}</span>}
          <Boton type="submit" disabled={pendiente}>
            {pendiente ? 'Guardando…' : 'Guardar'}
          </Boton>
        </div>
      </form>
    </Tarjeta>
  )
}
```

`apps/erp/app/productos/nuevo/page.tsx`:

```tsx
import { crearClienteServidor } from '@suite/auth/server'
import { Encabezado } from '@suite/ui'
import { FormularioProducto } from '../../../componentes/formulario-producto'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { guardarProducto } from '../acciones'

export default async function NuevoProducto() {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const supabase = await crearClienteServidor()
  const { data: categorias } = await supabase
    .from('categorias_producto')
    .select('id, nombre')
    .eq('empresa_id', activa.id)
    .order('nombre')
  return (
    <div>
      <Encabezado titulo="Nuevo producto" />
      <FormularioProducto accion={guardarProducto} categorias={categorias ?? []} />
    </div>
  )
}
```

`apps/erp/app/productos/[id]/page.tsx`:

```tsx
import { notFound } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { Encabezado } from '@suite/ui'
import { FormularioProducto } from '../../../componentes/formulario-producto'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { guardarProducto } from '../acciones'

export default async function EditarProducto({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const supabase = await crearClienteServidor()
  const [{ data: producto }, { data: categorias }] = await Promise.all([
    supabase.from('productos').select('*').eq('id', id).eq('empresa_id', activa.id).single(),
    supabase.from('categorias_producto').select('id, nombre').eq('empresa_id', activa.id).order('nombre'),
  ])
  if (!producto) notFound()
  return (
    <div>
      <Encabezado titulo={`Editar: ${producto.nombre}`} />
      <FormularioProducto
        accion={guardarProducto}
        categorias={categorias ?? []}
        inicial={{
          id: producto.id,
          sku: producto.sku,
          nombre: producto.nombre,
          descripcion: producto.descripcion ?? '',
          codigo_barras: producto.codigo_barras ?? '',
          unidad: producto.unidad,
          precio_neto: producto.precio_neto,
          exento: producto.exento,
          categoria_id: producto.categoria_id ?? '',
        }}
      />
    </div>
  )
}
```

- [ ] **Step 5: Verificar**

Run: `pnpm --filter erp build`
Expected: build sin errores.

Verificación integral (scriptada o manual): con un usuario dueño logueado — crear producto con categoría nueva → aparece en la lista con precio formateado `$12.990` → editar cambia el nombre → desactivar lo saca de la lista por defecto y aparece con "Ver inactivos". SKU duplicado muestra "Ya existe un producto con ese SKU".

- [ ] **Step 6: Commit**

```bash
git add apps/erp/app/tipos.ts apps/erp/app/productos apps/erp/componentes/formulario-producto.tsx
git commit -m "feat(erp): CRUD de productos con categorías, búsqueda y paginación"
```

---

### Task 8: CRUD de Clientes

**Files:**
- Create: `apps/erp/app/clientes/page.tsx`, `apps/erp/app/clientes/acciones.ts`, `apps/erp/app/clientes/nuevo/page.tsx`, `apps/erp/app/clientes/[id]/page.tsx`, `apps/erp/componentes/formulario-cliente.tsx`

**Interfaces:**
- Consumes: mismo patrón de Task 7; `validarRut`, `limpiarRut`, `formatearRut` de `@suite/core`.
- Produces: `guardarCliente(prev, formData): Promise<EstadoForm>` y `alternarActivoCliente(formData)`.

- [ ] **Step 1: Server Actions de clientes**

`apps/erp/app/clientes/acciones.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { limpiarRut, validarRut } from '@suite/core'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import type { EstadoForm } from '../tipos'

export async function guardarCliente(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
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
    const { data, error } = await supabase
      .from('clientes')
      .update(datos)
      .eq('id', id)
      .eq('empresa_id', activa.id)
      .select('id')
    if (error) {
      if (error.code === '23505') return { error: 'Ya existe un cliente con ese RUT' }
      if (error.code === '42501') return { error: 'Tu rol no permite editar clientes' }
      return { error: 'No se pudo guardar el cliente' }
    }
    if ((data ?? []).length === 0) {
      return { error: 'No se pudo guardar: el cliente no existe o tu rol no permite editarlo' }
    }
  } else {
    const { error } = await supabase.from('clientes').insert({ ...datos, empresa_id: activa.id })
    if (error) {
      if (error.code === '23505') return { error: 'Ya existe un cliente con ese RUT' }
      if (error.code === '42501') return { error: 'Tu rol no permite crear clientes' }
      return { error: 'No se pudo crear el cliente' }
    }
  }

  revalidatePath('/clientes')
  redirect('/clientes')
}

export async function alternarActivoCliente(formData: FormData): Promise<void> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return
  const id = String(formData.get('id') ?? '')
  const activo = String(formData.get('activo') ?? '') === 'true'
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase
    .from('clientes')
    .update({ activo: !activo })
    .eq('id', id)
    .eq('empresa_id', activa.id)
    .select('id')
  if (error || (data ?? []).length === 0) {
    console.error('alternarActivo:', error ?? 'sin filas')
    return
  }
  revalidatePath('/clientes')
}
```

- [ ] **Step 2: Lista de clientes**

`apps/erp/app/clientes/page.tsx`:

```tsx
import Link from 'next/link'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearRut } from '@suite/core'
import { Boton, Encabezado, Entrada, Insignia, Paginacion, Tabla, Td, Th, Tr } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import { alternarActivoCliente } from './acciones'

const POR_PAGINA = 25

export default async function PaginaClientes({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; pagina?: string; inactivos?: string }>
}) {
  const { q = '', pagina: paginaCruda, inactivos } = await searchParams
  const pagina = Math.max(1, Math.trunc(Number(paginaCruda) || 1))
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />

  const supabase = await crearClienteServidor()
  let consulta = supabase
    .from('clientes')
    .select('id, rut, razon_social, comuna, condicion_pago_dias, activo', { count: 'exact' })
    .eq('empresa_id', activa.id)
    .order('razon_social')
    .range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1)
  if (inactivos !== '1') consulta = consulta.eq('activo', true)
  // Comas y paréntesis rompen la sintaxis del filtro .or() de PostgREST.
  const qLimpia = q.replace(/[,()]/g, ' ').trim()
  if (qLimpia) consulta = consulta.or(`razon_social.ilike.%${qLimpia}%,rut.ilike.%${qLimpia}%`)

  const { data: clientes, count, error } = await consulta
  if (error) throw new Error('No se pudieron cargar los clientes')
  const totalPaginas = Math.max(1, Math.ceil((count ?? 0) / POR_PAGINA))
  const hrefBase = `/clientes?q=${encodeURIComponent(q)}${inactivos === '1' ? '&inactivos=1' : ''}`

  return (
    <div>
      <Encabezado titulo="Clientes">
        <Link href="/clientes/nuevo">
          <Boton>Nuevo cliente</Boton>
        </Link>
      </Encabezado>

      <form className="mb-4 flex items-center gap-3" action="/clientes" method="get">
        <Entrada name="q" defaultValue={q} placeholder="Buscar por razón social o RUT…" className="max-w-xs" />
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" name="inactivos" value="1" defaultChecked={inactivos === '1'} />
          Ver inactivos
        </label>
        <Boton variante="secundario" type="submit">
          Buscar
        </Boton>
      </form>

      <Tabla>
        <thead>
          <tr>
            <Th>RUT</Th>
            <Th>Razón social</Th>
            <Th>Comuna</Th>
            <Th>Condición de pago</Th>
            <Th>Estado</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {(clientes ?? []).map((c) => (
            <Tr key={c.id}>
              <Td className="font-mono">{formatearRut(c.rut)}</Td>
              <Td>
                <Link className="text-marca-700 hover:underline" href={`/clientes/${c.id}`}>
                  {c.razon_social}
                </Link>
              </Td>
              <Td>{c.comuna ?? '—'}</Td>
              <Td>{c.condicion_pago_dias === 0 ? 'Contado' : `${c.condicion_pago_dias} días`}</Td>
              <Td>{c.activo ? <Insignia tono="verde">Activo</Insignia> : <Insignia tono="gris">Inactivo</Insignia>}</Td>
              <Td>
                <form action={alternarActivoCliente}>
                  <input type="hidden" name="id" value={c.id} />
                  <input type="hidden" name="activo" value={String(c.activo)} />
                  <Boton variante="secundario" type="submit" className="px-2 py-1 text-xs">
                    {c.activo ? 'Desactivar' : 'Reactivar'}
                  </Boton>
                </form>
              </Td>
            </Tr>
          ))}
          {(clientes ?? []).length === 0 && (
            <Tr>
              <Td colSpan={6} className="py-8 text-center text-slate-500">
                No hay clientes {q ? 'que coincidan con la búsqueda' : 'todavía. Crea el primero o usa Importar'}.
              </Td>
            </Tr>
          )}
        </tbody>
      </Tabla>

      <Paginacion pagina={pagina} totalPaginas={totalPaginas} hrefBase={hrefBase} />
    </div>
  )
}
```

- [ ] **Step 3: Formulario y páginas crear/editar**

`apps/erp/componentes/formulario-cliente.tsx`:

```tsx
'use client'

import { useActionState } from 'react'
import { Boton, Campo, Entrada, Tarjeta } from '@suite/ui'
import type { EstadoForm } from '../app/tipos'

export interface ClienteEditable {
  id?: string
  rut: string
  razon_social: string
  giro: string
  email: string
  telefono: string
  direccion: string
  comuna: string
  condicion_pago_dias: number
}

const VACIO: ClienteEditable = {
  rut: '',
  razon_social: '',
  giro: '',
  email: '',
  telefono: '',
  direccion: '',
  comuna: '',
  condicion_pago_dias: 0,
}

export function FormularioCliente({
  accion,
  inicial = VACIO,
}: {
  accion: (prev: EstadoForm, formData: FormData) => Promise<EstadoForm>
  inicial?: ClienteEditable
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoForm)
  return (
    <Tarjeta className="max-w-2xl">
      <form action={enviar} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {inicial.id && <input type="hidden" name="id" value={inicial.id} />}
        <Campo etiqueta="RUT *">
          <Entrada name="rut" defaultValue={inicial.rut} placeholder="76.543.210-3" required />
        </Campo>
        <Campo etiqueta="Razón social *">
          <Entrada name="razon_social" defaultValue={inicial.razon_social} required />
        </Campo>
        <Campo etiqueta="Giro">
          <Entrada name="giro" defaultValue={inicial.giro} />
        </Campo>
        <Campo etiqueta="Correo">
          <Entrada name="email" type="email" defaultValue={inicial.email} />
        </Campo>
        <Campo etiqueta="Teléfono">
          <Entrada name="telefono" defaultValue={inicial.telefono} />
        </Campo>
        <Campo etiqueta="Comuna">
          <Entrada name="comuna" defaultValue={inicial.comuna} />
        </Campo>
        <div className="sm:col-span-2">
          <Campo etiqueta="Dirección">
            <Entrada name="direccion" defaultValue={inicial.direccion} />
          </Campo>
        </div>
        <Campo etiqueta="Condición de pago (días; 0 = contado)">
          <Entrada
            name="condicion_pago_dias"
            inputMode="numeric"
            defaultValue={inicial.condicion_pago_dias}
          />
        </Campo>
        <div className="flex items-center justify-end gap-2 sm:col-span-2">
          {estado.error && <span className="mr-auto text-sm text-red-600">{estado.error}</span>}
          <Boton type="submit" disabled={pendiente}>
            {pendiente ? 'Guardando…' : 'Guardar'}
          </Boton>
        </div>
      </form>
    </Tarjeta>
  )
}
```

`apps/erp/app/clientes/nuevo/page.tsx`:

```tsx
import { Encabezado } from '@suite/ui'
import { FormularioCliente } from '../../../componentes/formulario-cliente'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { guardarCliente } from '../acciones'

export default async function NuevoCliente() {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  return (
    <div>
      <Encabezado titulo="Nuevo cliente" />
      <FormularioCliente accion={guardarCliente} />
    </div>
  )
}
```

`apps/erp/app/clientes/[id]/page.tsx`:

```tsx
import { notFound } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearRut } from '@suite/core'
import { Encabezado } from '@suite/ui'
import { FormularioCliente } from '../../../componentes/formulario-cliente'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { guardarCliente } from '../acciones'

export default async function EditarCliente({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const supabase = await crearClienteServidor()
  const { data: cliente } = await supabase
    .from('clientes')
    .select('*')
    .eq('id', id)
    .eq('empresa_id', activa.id)
    .single()
  if (!cliente) notFound()
  return (
    <div>
      <Encabezado titulo={`Editar: ${cliente.razon_social}`} />
      <FormularioCliente
        accion={guardarCliente}
        inicial={{
          id: cliente.id,
          rut: formatearRut(cliente.rut),
          razon_social: cliente.razon_social,
          giro: cliente.giro ?? '',
          email: cliente.email ?? '',
          telefono: cliente.telefono ?? '',
          direccion: cliente.direccion ?? '',
          comuna: cliente.comuna ?? '',
          condicion_pago_dias: cliente.condicion_pago_dias,
        }}
      />
    </div>
  )
}
```

- [ ] **Step 4: Verificar**

Run: `pnpm --filter erp build`
Expected: build sin errores.

Verificación: crear cliente con RUT `76.543.210-3` → lista lo muestra formateado; RUT inválido da error en español; RUT duplicado da "Ya existe un cliente con ese RUT"; condición 30 días se muestra como "30 días" y 0 como "Contado".

- [ ] **Step 5: Commit**

```bash
git add apps/erp/app/clientes apps/erp/componentes/formulario-cliente.tsx
git commit -m "feat(erp): CRUD de clientes con validación de RUT"
```

---

### Task 9: Import CSV (productos y clientes) + verificación integral

**Files:**
- Create: `apps/erp/app/importar/page.tsx`, `apps/erp/app/importar/acciones.ts`, `apps/erp/componentes/formulario-importar.tsx`, `apps/erp/public/plantillas/productos.csv`, `apps/erp/public/plantillas/clientes.csv`
- Modify: `docs/superpowers/plans/2026-07-07-fase1-plan1-fundacion.md` (línea de secuencia de planes: re-scope de Plan 2/4)

**Interfaces:**
- Consumes: `parsearCSV`, `validarFilaProducto`, `validarFilaCliente` de `@suite/core`; `obtenerEmpresaActiva`; upserts con `onConflict`.
- Produces: Server Actions `importarProductos(prev, formData)` e `importarClientes(prev, formData)` con `type ResultadoImport = { error?: string; procesadas?: number; errores?: { fila: number; mensajes: string[] }[] }` (en `apps/erp/app/importar/acciones.ts` no se puede exportar el tipo — va en `apps/erp/app/tipos.ts`).

- [ ] **Step 1: Plantillas CSV**

`apps/erp/public/plantillas/productos.csv`:

```csv
sku,nombre,precio_neto,unidad,codigo_barras,categoria,exento
A-001,Arroz grado 1 kg,1290,UN,7800011122233,Abarrotes,no
```

`apps/erp/public/plantillas/clientes.csv`:

```csv
rut,razon_social,giro,email,telefono,direccion,comuna,condicion_pago_dias
76.543.210-3,Comercial Andes SpA,Venta al por menor,contacto@andes.cl,+56912345678,Av. Siempre Viva 123,Maipú,30
```

- [ ] **Step 2: Tipo del resultado**

Agregar a `apps/erp/app/tipos.ts`:

```ts
export type ResultadoImport = {
  error?: string
  procesadas?: number
  errores?: { fila: number; mensajes: string[] }[]
}
```

- [ ] **Step 3: Server Actions de import**

`apps/erp/app/importar/acciones.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@suite/auth/server'
import {
  parsearCSV,
  validarFilaCliente,
  validarFilaProducto,
} from '@suite/core'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import type { ResultadoImport } from '../tipos'

const MAX_FILAS = 1000

async function leerCSV(formData: FormData): Promise<{ filas?: string[][]; error?: string }> {
  const archivo = formData.get('archivo')
  if (!(archivo instanceof File) || archivo.size === 0) {
    return { error: 'Selecciona un archivo CSV' }
  }
  const bytes = new Uint8Array(await archivo.arrayBuffer())
  // Excel en Windows suele exportar CP-1252; si UTF-8 falla, reintentar.
  let texto = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  if (texto.includes('�')) {
    texto = new TextDecoder('windows-1252').decode(bytes)
  }
  const filas = parsearCSV(texto)
  if (filas.length < 2) return { error: 'El archivo no tiene filas de datos' }
  if (filas.length - 1 > MAX_FILAS) return { error: `Máximo ${MAX_FILAS} filas por archivo` }
  return { filas }
}

function filasComoObjetos(filas: string[][]): Record<string, string>[] {
  const encabezados = filas[0]!.map((h) => h.trim().toLowerCase())
  return filas.slice(1).map((fila) => {
    const objeto: Record<string, string> = {}
    encabezados.forEach((encabezado, i) => {
      objeto[encabezado] = (fila[i] ?? '').trim()
    })
    return objeto
  })
}

export async function importarProductos(_prev: ResultadoImport, formData: FormData): Promise<ResultadoImport> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const lectura = await leerCSV(formData)
  if (lectura.error || !lectura.filas) return { error: lectura.error }

  const objetos = filasComoObjetos(lectura.filas)
  const validos = objetos.map(validarFilaProducto)
  const errores = validos
    .map((r, i) => (r.ok ? null : { fila: i + 2, mensajes: r.errores }))
    .filter((e): e is { fila: number; mensajes: string[] } => e !== null)
  const filasOkConFila = validos
    .map((r, i) => (r.ok ? { datos: r.datos, fila: i + 2 } : null))
    .filter(
      (v): v is { datos: Extract<(typeof validos)[number], { ok: true }>['datos']; fila: number } => v !== null
    )
  const filasOk = filasOkConFila.map((v) => v.datos)

  const supabase = await crearClienteServidor()

  // Resolver categorías por nombre (crear las que falten).
  const nombresCategorias = [...new Set(filasOk.map((f) => f.categoria).filter(Boolean))] as string[]
  const categoriaPorNombre = new Map<string, string>()
  for (const nombre of nombresCategorias) {
    const { data, error } = await supabase
      .from('categorias_producto')
      .upsert({ empresa_id: activa.id, nombre }, { onConflict: 'empresa_id,nombre' })
      .select('id')
      .single()
    if (error) {
      if (error.code === '42501') return { error: 'Tu rol no permite importar productos' }
      return { error: 'No se pudieron crear las categorías: ' + nombre }
    }
    categoriaPorNombre.set(nombre, data.id)
  }

  const registrosConFila = filasOkConFila.map(({ datos: f, fila }) => ({
    registro: {
      empresa_id: activa.id,
      sku: f.sku,
      nombre: f.nombre,
      precio_neto: f.precioNeto,
      unidad: f.unidad,
      codigo_barras: f.codigoBarras ?? null,
      categoria_id: f.categoria ? categoriaPorNombre.get(f.categoria)! : null,
      exento: f.exento,
      actualizado_en: new Date().toISOString(),
    },
    fila,
  }))

  const porClave = new Map<string, { registro: (typeof registrosConFila)[number]['registro']; fila: number }>()
  for (const { registro, fila } of registrosConFila) {
    const clave = registro.sku
    const previo = porClave.get(clave)
    if (previo) {
      errores.push({ fila: previo.fila, mensajes: ['SKU duplicado en el archivo; se usó la última aparición'] })
    }
    porClave.set(clave, { registro, fila })
  }
  const registros = [...porClave.values()].map((v) => v.registro)
  errores.sort((a, b) => a.fila - b.fila)

  for (let i = 0; i < registros.length; i += 500) {
    const { error } = await supabase
      .from('productos')
      .upsert(registros.slice(i, i + 500), { onConflict: 'empresa_id,sku' })
    if (error) {
      if (error.code === '42501') return { error: 'Tu rol no permite importar productos' }
      return { error: 'Error al guardar los productos: revisa el archivo' }
    }
  }

  revalidatePath('/productos')
  return { procesadas: registros.length, errores }
}

export async function importarClientes(_prev: ResultadoImport, formData: FormData): Promise<ResultadoImport> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const lectura = await leerCSV(formData)
  if (lectura.error || !lectura.filas) return { error: lectura.error }

  const objetos = filasComoObjetos(lectura.filas)
  const validos = objetos.map(validarFilaCliente)
  const errores = validos
    .map((r, i) => (r.ok ? null : { fila: i + 2, mensajes: r.errores }))
    .filter((e): e is { fila: number; mensajes: string[] } => e !== null)
  const filasOkConFila = validos
    .map((r, i) => (r.ok ? { datos: r.datos, fila: i + 2 } : null))
    .filter(
      (v): v is { datos: Extract<(typeof validos)[number], { ok: true }>['datos']; fila: number } => v !== null
    )

  const registrosConFila = filasOkConFila.map(({ datos: f, fila }) => ({
    registro: {
      empresa_id: activa.id,
      rut: f.rut,
      razon_social: f.razonSocial,
      giro: f.giro ?? null,
      email: f.email ?? null,
      telefono: f.telefono ?? null,
      direccion: f.direccion ?? null,
      comuna: f.comuna ?? null,
      condicion_pago_dias: f.condicionPagoDias,
    },
    fila,
  }))

  const porClave = new Map<string, { registro: (typeof registrosConFila)[number]['registro']; fila: number }>()
  for (const { registro, fila } of registrosConFila) {
    const clave = registro.rut
    const previo = porClave.get(clave)
    if (previo) {
      errores.push({ fila: previo.fila, mensajes: ['RUT duplicado en el archivo; se usó la última aparición'] })
    }
    porClave.set(clave, { registro, fila })
  }
  const registros = [...porClave.values()].map((v) => v.registro)
  errores.sort((a, b) => a.fila - b.fila)

  const supabase = await crearClienteServidor()
  for (let i = 0; i < registros.length; i += 500) {
    const { error } = await supabase
      .from('clientes')
      .upsert(registros.slice(i, i + 500), { onConflict: 'empresa_id,rut' })
    if (error) {
      if (error.code === '42501') return { error: 'Tu rol no permite importar clientes' }
      return { error: 'Error al guardar los clientes: revisa el archivo' }
    }
  }

  revalidatePath('/clientes')
  return { procesadas: registros.length, errores }
}
```

- [ ] **Step 4: Página y formulario de import**

`apps/erp/componentes/formulario-importar.tsx`:

```tsx
'use client'

import { useActionState } from 'react'
import { Boton, Tarjeta } from '@suite/ui'
import type { ResultadoImport } from '../app/tipos'

export function FormularioImportar({
  titulo,
  descripcion,
  plantillaHref,
  accion,
}: {
  titulo: string
  descripcion: string
  plantillaHref: string
  accion: (prev: ResultadoImport, formData: FormData) => Promise<ResultadoImport>
}) {
  const [resultado, enviar, pendiente] = useActionState(accion, {} as ResultadoImport)
  return (
    <Tarjeta>
      <h2 className="text-lg font-semibold text-slate-900">{titulo}</h2>
      <p className="mt-1 text-sm text-slate-600">{descripcion}</p>
      <p className="mt-1 text-sm">
        <a className="text-marca-600 underline" href={plantillaHref} download>
          Descargar plantilla
        </a>{' '}
        <span className="text-slate-500">(complétala en Excel y guárdala como CSV)</span>
      </p>
      <form action={enviar} className="mt-4 flex items-center gap-3">
        <input type="file" name="archivo" accept=".csv,text/csv" required className="text-sm" />
        <Boton type="submit" disabled={pendiente}>
          {pendiente ? 'Importando…' : 'Importar'}
        </Boton>
      </form>
      {resultado.error && <p className="mt-3 text-sm text-red-600">{resultado.error}</p>}
      {resultado.procesadas !== undefined && (
        <div className="mt-3 text-sm">
          <p className="text-green-700">
            {resultado.procesadas} fila(s) importada(s) correctamente.
          </p>
          {resultado.errores && resultado.errores.length > 0 && (
            <div className="mt-2 rounded-md bg-amber-50 p-3 text-amber-900">
              <p className="font-medium">{resultado.errores.length} fila(s) con errores (no importadas):</p>
              <ul className="mt-1 list-inside list-disc">
                {resultado.errores.slice(0, 20).map((e) => (
                  <li key={e.fila}>
                    Fila {e.fila}: {e.mensajes.join('; ')}
                  </li>
                ))}
                {resultado.errores.length > 20 && <li>… y {resultado.errores.length - 20} más</li>}
              </ul>
            </div>
          )}
        </div>
      )}
    </Tarjeta>
  )
}
```

`apps/erp/app/importar/page.tsx`:

```tsx
import { Encabezado } from '@suite/ui'
import { FormularioImportar } from '../../componentes/formulario-importar'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import { importarClientes, importarProductos } from './acciones'

export default async function PaginaImportar() {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  return (
    <div>
      <Encabezado titulo="Importar datos" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <FormularioImportar
          titulo="Productos"
          descripcion="Carga o actualiza tu catálogo completo. Las filas con el mismo SKU actualizan el producto existente."
          plantillaHref="/plantillas/productos.csv"
          accion={importarProductos}
        />
        <FormularioImportar
          titulo="Clientes"
          descripcion="Carga o actualiza tu cartera. Las filas con el mismo RUT actualizan el cliente existente."
          plantillaHref="/plantillas/clientes.csv"
          accion={importarClientes}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Actualizar la secuencia de planes en el doc del Plan 1**

En `docs/superpowers/plans/2026-07-07-fase1-plan1-fundacion.md`, reemplazar las líneas 2 y 4 de la secuencia:

- Línea del Plan 2 → `2. Maestros ERP — productos con categorías, clientes, import CSV, design system @suite/ui y empresa activa. (Proveedores y bodegas se movieron al Plan 4, donde se consumen.)`
- Línea del Plan 4 → `4. Inventario + Compras — bodegas, proveedores, movimientos de stock inmutables, órdenes de compra, recepción.`

- [ ] **Step 6: Verificación integral del Plan 2**

1. `pnpm test` → todas las suites verdes (core con maestros/csv nuevos, auth).
2. `pnpm supabase test db` → 23 asserts verdes (6 + 7 + 10).
3. `pnpm build` → 3 apps compilan.
4. Flujo completo con navegador o script: login → importar `productos.csv` de plantilla → 1 procesada → aparece en /productos → importar CSV con una fila mala → reporte de errores por fila → importar clientes → dashboard muestra contadores > 0.

- [ ] **Step 7: Commit**

```bash
git add apps/erp/app/importar apps/erp/componentes/formulario-importar.tsx apps/erp/public/plantillas apps/erp/app/tipos.ts docs/superpowers/plans/2026-07-07-fase1-plan1-fundacion.md
git commit -m "feat(erp): import CSV de productos y clientes con reporte de errores por fila"
```

---

## Verificación final del plan

Al completar las 9 tasks:

- `pnpm test` — core (rut, iva, maestros, csv) y auth verdes.
- `pnpm supabase test db` — 23 asserts pgTAP verdes.
- `pnpm build` — 3 apps compilan.
- Criterio de éxito del Plan 2: un usuario dueño puede cargar su catálogo y su cartera de clientes por CSV o a mano, navegando un ERP con identidad visual propia, con los datos aislados por empresa y validados (RUT/precios) en cliente, servidor y base de datos.
