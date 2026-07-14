# Plan 7: Reportes (libro de ventas SII, ventas por período, valorización, CSV) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Libro de ventas en formato SII (NC restando), ventas por período con top de productos, y valorización de inventario — en pantalla y exportables a CSV que Excel abre bien — todo derivado con vistas de solo lectura.

**Architecture:** Migración 0011 con 3 vistas `security_invoker` (la filosofía de `stock_actual`/`saldos_documentos` aplicada a reportes); las pantallas y los exports CSV consultan LAS MISMAS vistas (cero duplicación); exports como route handlers GET protegidos por el middleware existente + re-validación de empresa; generador CSV en `@suite/core` con BOM, separador `;` y protección contra inyección de fórmulas.

**Tech Stack:** Next.js 15 App Router (server components + route handlers), Supabase (Postgres 17, vistas + RLS, pgTAP), Vitest, TypeScript. Sin dependencias nuevas.

**Spec:** `docs/superpowers/specs/2026-07-14-plan7-reportes-design.md` (aprobado 2026-07-14).

**Desviación documentada del spec §6:** el spec lista un helper unitario `montosLibro(doc)` para el signo de NC; NO se implementa — el signo vive únicamente en la vista SQL (fuente de verdad) y lo prueban los pgTAP. Un helper TS sin consumidor sería un export muerto (el review del Plan 5 marcó exactamente eso con `estadoOrdenTrasRecepcion`).

## Global Constraints

- Las 3 vistas con `security_invoker = true` + `grant select` explícito a authenticated y service_role (lección Plan 1: sin grant → 42501). SIN tablas nuevas, SIN RPCs, SIN escrituras.
- Libro de ventas: solo documentos `estado = 'emitido'` de `tipo in ('factura','boleta','nota_credito')`; las `nota_venta` NUNCA aparecen; **las NC llevan neto/exento/iva/total multiplicados por −1**.
- Valorización: productos ACTIVOS; `costo_unitario` = el de la recepción MÁS RECIENTE (`recepciones.creado_en desc limit 1`); NULL si nunca se recibió; `valor = stock × costo` (NULL sin costo).
- En app code, TODA query con `.eq('empresa_id', activa.id)` y `activa` de `obtenerEmpresaActiva()` — también en los route handlers de export (el middleware ya redirige sin sesión — matcher global — pero el handler re-valida y usa la empresa de la cookie).
- CSV: BOM inicial + separador `;` + CRLF; celdas de TEXTO que comienzan con `=`, `+`, `-` o `@` se prefijan con `'` (anti inyección de fórmulas); números van sin comillas. En el CÓDIGO FUENTE el BOM se escribe SIEMPRE como el escape `\uFEFF` — JAMÁS el carácter literal (regla del proyecto).
- Fechas de filtro en ISO `YYYY-MM-DD`; mes `YYYY-MM`; parámetros inválidos → default (mes actual) en pantalla, 400 en export. Convención de fecha "hoy" en UTC (deuda técnica repo-wide conocida y aceptada).
- CLP entero; identificadores ASCII; copy en español; UTF-8 sin BOM en los fuentes.
- Windows/PowerShell 5.1: `&&` no encadena; prefijar cada comando con el refresh de PATH.

---

### Task 1: `@suite/core` — generador CSV y rango de mes (TDD)

**Files:**
- Modify: `packages/core/src/csv.ts` (agregar `filasACsv`; conserva `parsearCSV` intacto)
- Create: `packages/core/src/periodo.ts`
- Create: `packages/core/src/periodo.test.ts`
- Modify: `packages/core/src/csv.test.ts` si existe, si no Create (agregar describe de `filasACsv` sin tocar los tests de `parsearCSV`)
- Modify: `packages/core/src/index.ts` (agregar `export * from './periodo'` — csv ya está exportado)

**Interfaces:**
- Produces: `filasACsv(encabezados: string[], filas: (string | number | null | undefined)[][]): string` y `rangoDeMes(mes: string): { desde: string; hasta: string } | null`. Los consumen las Tasks 5-6.

- [ ] **Step 1: Tests que fallan**

Agregar a `packages/core/src/csv.test.ts` (crear el archivo si no existe; si existe, agregar el describe al final):

```ts
import { describe, expect, it } from 'vitest'
import { filasACsv } from './csv'

describe('filasACsv', () => {
  it('separa con ; y termina lineas en CRLF', () => {
    expect(filasACsv(['a', 'b'], [['x', 1]])).toBe('\uFEFFa;b\r\nx;1\r\n')
  })
  it('parte con BOM para que Excel detecte UTF-8', () => {
    expect(filasACsv(['a'], []).startsWith('\uFEFF')).toBe(true)
  })
  it('entrecomilla celdas con ; comillas o saltos, escapando comillas', () => {
    expect(filasACsv(['a'], [['dice "hola"; chao']])).toBe('\uFEFFa\r\n"dice ""hola""; chao"\r\n')
  })
  it('protege contra inyección de fórmulas en celdas de texto', () => {
    expect(filasACsv(['a'], [['=SUM(A1:A9)']])).toBe("\uFEFFa\r\n'=SUM(A1:A9)\r\n")
  })
  it('los números (incluso negativos) van sin proteger ni entrecomillar', () => {
    expect(filasACsv(['a'], [[-100000]])).toBe('\uFEFFa\r\n-100000\r\n')
  })
  it('null y undefined son celdas vacías', () => {
    expect(filasACsv(['a', 'b'], [[null, undefined]])).toBe('\uFEFFa;b\r\n;\r\n')
  })
})
```

`packages/core/src/periodo.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { rangoDeMes } from './periodo'

describe('rangoDeMes', () => {
  it('devuelve primer y último día del mes', () => {
    expect(rangoDeMes('2026-07')).toEqual({ desde: '2026-07-01', hasta: '2026-07-31' })
  })
  it('maneja febrero bisiesto', () => {
    expect(rangoDeMes('2028-02')).toEqual({ desde: '2028-02-01', hasta: '2028-02-29' })
  })
  it('mes fuera de rango es null', () => {
    expect(rangoDeMes('2026-13')).toBeNull()
  })
  it('formato malformado es null', () => {
    expect(rangoDeMes('julio')).toBeNull()
  })
})
```

- [ ] **Step 2: Verificar que fallan**

Run: `pnpm --filter @suite/core test`
Expected: FAIL — `filasACsv` no exportado / `Cannot find module './periodo'`.

- [ ] **Step 3: Implementación mínima**

Agregar al final de `packages/core/src/csv.ts`:

```ts
// Genera CSV compatible con Excel es-CL: BOM (escape \uFEFF, jamás el carácter
// literal en el fuente), separador ';', CRLF. Celdas de TEXTO que parten con
// = + - @ se prefijan con ' (anti inyección de fórmulas: un nombre de cliente
// malicioso no debe ejecutar nada en el Excel del contador). Números sin comillas.
function celdaCsv(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return String(v)
  let s = v
  if (/^[=+\-@]/.test(s)) s = "'" + s
  if (/[";\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"'
  return s
}

export function filasACsv(encabezados: string[], filas: (string | number | null | undefined)[][]): string {
  const lineas = [encabezados as (string | number | null | undefined)[], ...filas].map((f) => f.map(celdaCsv).join(';'))
  return '\uFEFF' + lineas.join('\r\n') + '\r\n'
}
```

`packages/core/src/periodo.ts`:

```ts
// Rango de un mes 'YYYY-MM' en fechas ISO. null si el formato no es válido.
export function rangoDeMes(mes: string): { desde: string; hasta: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(mes)
  if (!m) return null
  const anio = Number(m[1])
  const mm = Number(m[2])
  if (mm < 1 || mm > 12) return null
  const ultimo = new Date(Date.UTC(anio, mm, 0)).getUTCDate()
  const p2 = String(mm).padStart(2, '0')
  return { desde: `${anio}-${p2}-01`, hasta: `${anio}-${p2}-${String(ultimo).padStart(2, '0')}` }
}
```

En `packages/core/src/index.ts` agregar: `export * from './periodo'`

- [ ] **Step 4: Verificar que pasan**

Run: `pnpm --filter @suite/core test`
Expected: PASS — 69 tests (59 existentes + 10 nuevos). Los tests existentes de `parsearCSV` siguen verdes.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/csv.ts packages/core/src/csv.test.ts packages/core/src/periodo.ts packages/core/src/periodo.test.ts packages/core/src/index.ts
git commit -m "feat(core): generador CSV Excel-compatible y rango de mes TDD"
```

---

### Task 2: Migración 0011 — vistas de reportes

**Files:**
- Create: `supabase/migrations/00000000000011_reportes.sql`

**Interfaces:**
- Consumes: `documentos_venta`, `clientes`, `productos`, `movimientos_stock`, `recepciones`, `recepciones_lineas` (todas existentes).
- Produces: vistas `libro_ventas` (empresa_id, documento_id, fecha, tipo, folio, rut_cliente, razon_social_cliente, neto, exento, iva, total), `ventas_diarias` (empresa_id, fecha, documentos, neto, iva, total), `valorizacion_inventario` (empresa_id, producto_id, sku, nombre, stock, costo_unitario, valor).

- [ ] **Step 1: Escribir la migración**

`supabase/migrations/00000000000011_reportes.sql`:

```sql
-- Reportes: vistas de solo lectura (security_invoker: la RLS del consultante aplica).
-- Sin tablas nuevas, sin RPCs, sin escrituras.

-- ---------- Libro de ventas (formato SII: NC con signo negativo) ----------
create view public.libro_ventas with (security_invoker = true) as
select
  d.empresa_id,
  d.id as documento_id,
  coalesce(d.emitido_en, d.creado_en)::date as fecha,
  d.tipo,
  d.folio,
  c.rut as rut_cliente,
  c.razon_social as razon_social_cliente,
  (case when d.tipo = 'nota_credito' then -d.neto else d.neto end) as neto,
  (case when d.tipo = 'nota_credito' then -d.exento else d.exento end) as exento,
  (case when d.tipo = 'nota_credito' then -d.iva else d.iva end) as iva,
  (case when d.tipo = 'nota_credito' then -d.total else d.total end) as total
from public.documentos_venta d
join public.clientes c on c.id = d.cliente_id and c.empresa_id = d.empresa_id
where d.estado = 'emitido' and d.tipo in ('factura', 'boleta', 'nota_credito');

-- ---------- Ventas agregadas por dia (mismo conjunto que el libro) ----------
create view public.ventas_diarias with (security_invoker = true) as
select empresa_id, fecha,
       count(*)::integer as documentos,
       sum(neto)::integer as neto,
       sum(iva)::integer as iva,
       sum(total)::integer as total
from public.libro_ventas
group by empresa_id, fecha;

-- ---------- Valorizacion de inventario (stock x ultimo costo de recepcion) ----------
create view public.valorizacion_inventario with (security_invoker = true) as
select
  p.empresa_id,
  p.id as producto_id,
  p.sku,
  p.nombre,
  coalesce(s.stock, 0)::integer as stock,
  uc.costo_unitario,
  (coalesce(s.stock, 0) * uc.costo_unitario)::integer as valor
from public.productos p
left join lateral (
  select sum(m.cantidad) as stock
  from public.movimientos_stock m
  where m.producto_id = p.id and m.empresa_id = p.empresa_id
) s on true
left join lateral (
  select rl.costo_unitario
  from public.recepciones_lineas rl
  join public.recepciones r on r.id = rl.recepcion_id and r.empresa_id = rl.empresa_id
  where rl.producto_id = p.id and rl.empresa_id = p.empresa_id
  order by r.creado_en desc
  limit 1
) uc on true
where p.activo;

-- ---------- Grants (leccion Plan 1) ----------
grant select on public.libro_ventas, public.ventas_diarias, public.valorizacion_inventario to authenticated;
grant select on public.libro_ventas, public.ventas_diarias, public.valorizacion_inventario to service_role;
```

- [ ] **Step 2: Aplicar y verificar**

Run: `pnpm supabase db reset`
Expected: aplica 0001-0011 sin errores.

Run: `pnpm supabase test db`
Expected: los 77 asserts existentes siguen verdes (los de reportes llegan en Task 3).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/00000000000011_reportes.sql
git commit -m "feat(db): vistas de reportes (libro de ventas, ventas diarias, valorización)"
```

---

### Task 3: pgTAP de reportes

**Files:**
- Create: `supabase/tests/database/reportes.test.sql`

**Interfaces:**
- Consumes: migración 0011. Fixtures con el patrón de la suite; RUTs reservados: `761111116` (Org A), `762222221` (Org B), `765432103` (cliente/proveedor A).

- [ ] **Step 1: Escribir el test**

`supabase/tests/database/reportes.test.sql`:

```sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'ana@a.cl'),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'beto@b.cl');

insert into public.organizaciones (id, rut, razon_social)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '761111116', 'Org A'),
       ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '762222221', 'Org B');

insert into public.empresas (id, organizacion_id, rut, razon_social)
values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '761111116', 'Empresa A'),
       ('eeeeeeee-0000-0000-0000-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '762222221', 'Empresa B');

insert into public.miembros (usuario_id, organizacion_id, rol)
values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'dueno'),
       ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'dueno');

insert into public.clientes (id, empresa_id, rut, razon_social)
values ('cccccccc-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '765432103', 'Cliente A');

-- Productos: P1 (con stock y dos recepciones a costos distintos) y P2 (sin recepciones).
insert into public.productos (id, empresa_id, sku, nombre, precio_neto)
values ('99999999-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'P1', 'Producto Uno', 10000),
       ('99999999-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'P2', 'Producto Dos', 5000);

insert into public.bodegas (id, empresa_id, nombre)
values ('bbbb0000-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'Bodega A');

insert into public.proveedores (id, empresa_id, rut, razon_social)
values ('dddd0000-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '765432103', 'Proveedor A');

-- Stock P1 = 10.
insert into public.movimientos_stock (empresa_id, producto_id, bodega_id, tipo, cantidad, motivo)
values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '99999999-0000-0000-0000-000000000001', 'bbbb0000-0000-0000-0000-aaaaaaaaaaaa', 'entrada', 10, 'seed');

-- Dos recepciones de P1 a costos distintos: la MAS RECIENTE (1500) debe ganar.
insert into public.ordenes_compra (id, empresa_id, numero, proveedor_id, estado)
values ('0c0c0c0c-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 1, 'dddd0000-0000-0000-0000-aaaaaaaaaaaa', 'recibida_parcial');
insert into public.ordenes_compra_lineas (id, empresa_id, orden_id, producto_id, descripcion, cantidad_pedida, costo_unitario, cantidad_recibida)
values ('0a0a0a0a-0000-0000-0000-00000000000a', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '0c0c0c0c-0000-0000-0000-aaaaaaaaaaaa', '99999999-0000-0000-0000-000000000001', 'Producto Uno', 20, 1500, 10);
insert into public.recepciones (id, empresa_id, orden_id, bodega_id, creado_en)
values ('4e4e4e4e-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '0c0c0c0c-0000-0000-0000-aaaaaaaaaaaa', 'bbbb0000-0000-0000-0000-aaaaaaaaaaaa', now() - interval '2 days'),
       ('4e4e4e4e-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '0c0c0c0c-0000-0000-0000-aaaaaaaaaaaa', 'bbbb0000-0000-0000-0000-aaaaaaaaaaaa', now() - interval '1 day');
insert into public.recepciones_lineas (empresa_id, recepcion_id, orden_linea_id, producto_id, cantidad, costo_unitario)
values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '4e4e4e4e-0000-0000-0000-000000000001', '0a0a0a0a-0000-0000-0000-00000000000a', '99999999-0000-0000-0000-000000000001', 5, 1000),
       ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '4e4e4e4e-0000-0000-0000-000000000002', '0a0a0a0a-0000-0000-0000-00000000000a', '99999999-0000-0000-0000-000000000001', 5, 1500);

-- Documentos: factura y boleta emitidas el 2026-07-10, NC emitida el 2026-07-11,
-- mas un borrador y una nota de venta (que NO deben aparecer en el libro).
insert into public.documentos_venta (id, empresa_id, tipo, cliente_id, folio, estado, neto, exento, iva, total, emitido_en)
values ('dddddddd-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'factura', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 1, 'emitido', 84034, 0, 15966, 100000, '2026-07-10T12:00:00Z'),
       ('dddddddd-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'boleta',  'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 5, 'emitido', 50000, 0, 9500, 59500, '2026-07-10T15:00:00Z'),
       ('dddddddd-0000-0000-0000-000000000003', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'nota_credito', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 1, 'emitido', 84034, 0, 15966, 100000, '2026-07-11T10:00:00Z'),
       ('dddddddd-0000-0000-0000-000000000004', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'factura', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa', null, 'borrador', 10000, 0, 1900, 11900, null),
       ('dddddddd-0000-0000-0000-000000000005', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'nota_venta', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa', null, 'borrador', 10000, 0, 1900, 11900, null);

-- ===== Ana (duena A) =====
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- 1) El libro tiene exactamente 3 filas (borrador y nota de venta excluidos).
select is( (select count(*) from libro_ventas), 3::bigint, 'el libro tiene 3 documentos (borrador y nota de venta fuera)' );

-- 2) La NC aparece con total NEGATIVO.
select is( (select total from libro_ventas where tipo = 'nota_credito'), -100000, 'la nota de crédito resta en el libro' );

-- 3) ventas_diarias del 2026-07-10 suma factura + boleta.
select is( (select total from ventas_diarias where fecha = '2026-07-10'), 159500, 'el día 10 suma factura y boleta (159500)' );

-- 4) ventas_diarias del 2026-07-11 es la NC en negativo.
select is( (select total from ventas_diarias where fecha = '2026-07-11'), -100000, 'el día 11 es la NC en negativo' );

-- 5) Valorización: stock de P1 = 10.
select is( (select stock from valorizacion_inventario where sku = 'P1'), 10, 'la valorización toma el stock del ledger' );

-- 6) Valorización: costo de P1 = 1500 (la recepción MÁS RECIENTE, no la primera).
select is( (select costo_unitario from valorizacion_inventario where sku = 'P1'), 1500, 'el costo es el de la recepción más reciente' );

-- 7) Valorización: valor de P1 = 15000.
select is( (select valor from valorizacion_inventario where sku = 'P1'), 15000, 'valor = stock x costo' );

-- 8) P2 sin recepciones: costo NULL.
select ok( (select costo_unitario is null from valorizacion_inventario where sku = 'P2'), 'sin recepciones el costo es NULL' );

-- 9) Beto (org B) no ve nada en las 3 vistas.
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
select is(
  (select count(*) from libro_ventas) + (select count(*) from ventas_diarias) + (select count(*) from valorizacion_inventario),
  0::bigint, 'Beto no ve reportes de la empresa A'
);

-- 10) Anónimo denegado.
set local request.jwt.claims to '{"role": "anon"}';
set local role anon;
select throws_ok(
  'select count(*) from libro_ventas',
  '42501', 'permission denied for view libro_ventas',
  'un anónimo no puede consultar el libro de ventas'
);

select * from finish();
rollback;
```

Nota: si el mensaje exacto del assert 10 difiere (`permission denied for table libro_ventas` en vez de `view` según la versión de Postgres), ajustar SOLO el texto esperado al real — el código 42501 es el contrato.

- [ ] **Step 2: Ejecutar**

Run: `pnpm supabase test db`
Expected: 8 archivos, **87 asserts** (aislamiento 6, cobranza 16, compras 19, inventario 10, maestros 10, registro 7, reportes 10, ventas 9), todos verdes. Si un assert de reportes falla, el sospechoso es la migración de Task 2 — NO debilitar el test.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/database/reportes.test.sql
git commit -m "test(db): libro de ventas con NC negativa, ventas diarias y valorización con pgTAP"
```

---

### Task 4: Regenerar tipos `@suite/db`

**Files:**
- Modify: `packages/db/src/types.ts` (regenerado)

- [ ] **Step 1: Regenerar y verificar**

Run: `pnpm --filter @suite/db gen`
Expected: `types.ts` incluye `libro_ventas`, `ventas_diarias`, `valorizacion_inventario` en Views (verificar por grep; si falta alguno → BLOCKED, gen stale).

Run: `pnpm tsc --noEmit -p packages/db/tsconfig.json` → sin errores.
Run: `pnpm build --concurrency=1` → 3 apps compilan.

- [ ] **Step 2: Commit**

```bash
git add packages/db/src/types.ts
git commit -m "feat(db): tipos regenerados con vistas de reportes"
```

---

### Task 5: ERP — índice de Reportes + libro de ventas (pantalla y export) + NAV

**Files:**
- Create: `apps/erp/app/reportes/page.tsx`, `apps/erp/app/reportes/libro-ventas/page.tsx`, `apps/erp/app/reportes/libro-ventas/export/route.ts`
- Modify: `apps/erp/app/layout.tsx` (NAV: agregar Reportes entre Cobranza y Configuración)

**Interfaces:**
- Consumes: vista `libro_ventas`, `filasACsv`/`rangoDeMes`/`formatearCLP`/`formatearRut` de `@suite/core`. Nota de tipos: las columnas de vistas llegan NULLABLE del generador → `?? 0`/guards en lecturas (precedente cobranza), sin `any`.
- Produces: `/reportes` (índice que Task 6 completa), patrón de export que Task 6 replica.

- [ ] **Step 1: Índice**

`apps/erp/app/reportes/page.tsx`:

```tsx
import Link from 'next/link'
import { Encabezado, Tarjeta } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'

const SECCIONES = [
  { href: '/reportes/libro-ventas', titulo: 'Libro de ventas', desc: 'Formato SII por mes, con export CSV' },
  { href: '/reportes/ventas', titulo: 'Ventas por período', desc: 'Por día y top de productos' },
  { href: '/reportes/valorizacion', titulo: 'Valorización de inventario', desc: 'Stock a último costo de compra' },
]

export default async function IndiceReportes() {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  return (
    <div>
      <Encabezado titulo="Reportes" />
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

- [ ] **Step 2: Pantalla del libro**

`apps/erp/app/reportes/libro-ventas/page.tsx`:

```tsx
import Link from 'next/link'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP, formatearRut, rangoDeMes } from '@suite/core'
import { Boton, Encabezado, Entrada, Tabla, Td, Th, Tr } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'

const ETIQUETA: Record<string, string> = { factura: 'Factura', boleta: 'Boleta', nota_credito: 'Nota de crédito' }

export default async function PaginaLibroVentas({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const { mes = '' } = await searchParams
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const mesActual = new Date().toISOString().slice(0, 7)
  const mesElegido = rangoDeMes(mes) ? mes : mesActual
  const rango = rangoDeMes(mesElegido)!
  const supabase = await crearClienteServidor()
  const { data } = await supabase
    .from('libro_ventas')
    .select('documento_id, fecha, tipo, folio, rut_cliente, razon_social_cliente, neto, exento, iva, total')
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
      <Encabezado titulo="Libro de ventas">
        <Link href={`/reportes/libro-ventas/export?mes=${mesElegido}`}><Boton variante="secundario">Exportar CSV</Boton></Link>
      </Encabezado>
      <form className="mb-4 flex items-end gap-3" action="/reportes/libro-ventas" method="get">
        <Entrada type="month" name="mes" defaultValue={mesElegido} className="max-w-xs" />
        <Boton variante="secundario" type="submit">Ver mes</Boton>
      </form>
      <Tabla>
        <thead><tr><Th>Fecha</Th><Th>Tipo</Th><Th>Folio</Th><Th>RUT</Th><Th>Razón social</Th><Th className="text-right">Neto</Th><Th className="text-right">Exento</Th><Th className="text-right">IVA</Th><Th className="text-right">Total</Th></tr></thead>
        <tbody>
          {filas.map((f) => (
            <Tr key={f.documento_id}>
              <Td>{f.fecha ? new Date(f.fecha + 'T00:00:00').toLocaleDateString('es-CL') : '—'}</Td>
              <Td>{ETIQUETA[f.tipo ?? ''] ?? f.tipo}</Td>
              <Td className="font-mono">{f.folio ?? '—'}</Td>
              <Td className="font-mono">{f.rut_cliente ? formatearRut(f.rut_cliente) : '—'}</Td>
              <Td>{f.razon_social_cliente}</Td>
              <Td className="text-right font-mono">{formatearCLP(f.neto ?? 0)}</Td>
              <Td className="text-right font-mono">{formatearCLP(f.exento ?? 0)}</Td>
              <Td className="text-right font-mono">{formatearCLP(f.iva ?? 0)}</Td>
              <Td className="text-right font-mono">{formatearCLP(f.total ?? 0)}</Td>
            </Tr>
          ))}
          {filas.length === 0 && <Tr><Td colSpan={9} className="py-8 text-center text-slate-500">Sin documentos emitidos en {mesElegido}.</Td></Tr>}
        </tbody>
      </Tabla>
      <div className="mt-3 flex justify-end gap-6 text-sm">
        <span>Neto: <strong className="font-mono">{formatearCLP(tot.neto)}</strong></span>
        <span>Exento: <strong className="font-mono">{formatearCLP(tot.exento)}</strong></span>
        <span>IVA: <strong className="font-mono">{formatearCLP(tot.iva)}</strong></span>
        <span>Total: <strong className="font-mono">{formatearCLP(tot.total)}</strong></span>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Export del libro**

`apps/erp/app/reportes/libro-ventas/export/route.ts`:

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
    .from('libro_ventas')
    .select('fecha, tipo, folio, rut_cliente, razon_social_cliente, neto, exento, iva, total')
    .eq('empresa_id', activa.id)
    .gte('fecha', rango.desde)
    .lte('fecha', rango.hasta)
    .order('fecha')
    .order('folio')
  if (error) return new Response('No se pudo generar el libro', { status: 500 })
  const csv = filasACsv(
    ['Fecha', 'Tipo', 'Folio', 'RUT cliente', 'Razón social', 'Neto', 'Exento', 'IVA', 'Total'],
    (data ?? []).map((f) => [f.fecha, f.tipo, f.folio, f.rut_cliente, f.razon_social_cliente, f.neto, f.exento, f.iva, f.total])
  )
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="libro-ventas-${mes}.csv"`,
    },
  })
}
```

Modificar `apps/erp/app/layout.tsx` — en el `NAV`, después de `{ href: '/cobranza', etiqueta: 'Cobranza' },` agregar:

```tsx
  { href: '/reportes', etiqueta: 'Reportes' },
```

- [ ] **Step 4: Verificar**

Run: `pnpm --filter erp build`
Expected: build sin errores. (Los links a `/reportes/ventas` y `/reportes/valorizacion` 404ean hasta Task 6 — transitorio esperado.)

- [ ] **Step 5: Commit**

```bash
git add apps/erp/app/reportes apps/erp/app/layout.tsx
git commit -m "feat(erp): libro de ventas con export CSV"
```

---

### Task 6: ERP — ventas por período y valorización (pantallas y exports)

**Files:**
- Create: `apps/erp/app/reportes/ventas/page.tsx`, `apps/erp/app/reportes/ventas/export/route.ts`, `apps/erp/app/reportes/valorizacion/page.tsx`, `apps/erp/app/reportes/valorizacion/export/route.ts`

**Interfaces:**
- Consumes: vistas `ventas_diarias`/`valorizacion_inventario`, `documentos_venta`+`documentos_venta_lineas` (top productos), `filasACsv`/`rangoDeMes`/`formatearCLP` de `@suite/core`.

- [ ] **Step 1: Ventas por período**

`apps/erp/app/reportes/ventas/page.tsx`:

```tsx
import Link from 'next/link'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP, rangoDeMes } from '@suite/core'
import { Boton, Encabezado, Entrada, Tabla, Tarjeta, Td, Th, Tr } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/

export default async function PaginaVentasPeriodo({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string }>
}) {
  const params = await searchParams
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const mesActual = rangoDeMes(new Date().toISOString().slice(0, 7))!
  const desde = FECHA_ISO.test(params.desde ?? '') ? params.desde! : mesActual.desde
  const hastaRaw = FECHA_ISO.test(params.hasta ?? '') ? params.hasta! : mesActual.hasta
  const hasta = hastaRaw >= desde ? hastaRaw : desde
  const supabase = await crearClienteServidor()

  const [{ data: dias }, { data: docs }] = await Promise.all([
    supabase.from('ventas_diarias')
      .select('fecha, documentos, neto, iva, total')
      .eq('empresa_id', activa.id).gte('fecha', desde).lte('fecha', hasta).order('fecha'),
    supabase.from('documentos_venta')
      .select('id')
      .eq('empresa_id', activa.id).eq('estado', 'emitido').in('tipo', ['factura', 'boleta'])
      .gte('emitido_en', desde).lte('emitido_en', hasta + 'T23:59:59.999').limit(1000),
  ])

  // Top 10 productos del rango (solo ventas: NC excluidas por el filtro de tipo de arriba).
  const ids = (docs ?? []).map((d) => d.id)
  const { data: lineas } = ids.length
    ? await supabase.from('documentos_venta_lineas')
        .select('producto_id, descripcion, cantidad, subtotal')
        .eq('empresa_id', activa.id).in('documento_id', ids)
    : { data: [] as { producto_id: string | null; descripcion: string; cantidad: number; subtotal: number }[] }
  const porProducto = new Map<string, { descripcion: string; cantidad: number; subtotal: number }>()
  for (const l of lineas ?? []) {
    const key = l.producto_id ?? l.descripcion
    const acc = porProducto.get(key) ?? { descripcion: l.descripcion, cantidad: 0, subtotal: 0 }
    acc.cantidad += l.cantidad
    acc.subtotal += l.subtotal
    porProducto.set(key, acc)
  }
  const top = [...porProducto.values()].sort((a, b) => b.subtotal - a.subtotal).slice(0, 10)
  const tot = (dias ?? []).reduce(
    (a, d) => ({ documentos: a.documentos + (d.documentos ?? 0), neto: a.neto + (d.neto ?? 0), iva: a.iva + (d.iva ?? 0), total: a.total + (d.total ?? 0) }),
    { documentos: 0, neto: 0, iva: 0, total: 0 }
  )
  return (
    <div>
      <Encabezado titulo="Ventas por período">
        <Link href={`/reportes/ventas/export?desde=${desde}&hasta=${hasta}`}><Boton variante="secundario">Exportar CSV</Boton></Link>
      </Encabezado>
      <form className="mb-4 flex items-end gap-3" action="/reportes/ventas" method="get">
        <Entrada type="date" name="desde" defaultValue={desde} className="max-w-xs" />
        <Entrada type="date" name="hasta" defaultValue={hasta} className="max-w-xs" />
        <Boton variante="secundario" type="submit">Ver rango</Boton>
      </form>
      <Tabla>
        <thead><tr><Th>Fecha</Th><Th className="text-right">Documentos</Th><Th className="text-right">Neto</Th><Th className="text-right">IVA</Th><Th className="text-right">Total</Th></tr></thead>
        <tbody>
          {(dias ?? []).map((d) => (
            <Tr key={d.fecha}>
              <Td>{d.fecha ? new Date(d.fecha + 'T00:00:00').toLocaleDateString('es-CL') : '—'}</Td>
              <Td className="text-right font-mono">{d.documentos}</Td>
              <Td className="text-right font-mono">{formatearCLP(d.neto ?? 0)}</Td>
              <Td className="text-right font-mono">{formatearCLP(d.iva ?? 0)}</Td>
              <Td className="text-right font-mono">{formatearCLP(d.total ?? 0)}</Td>
            </Tr>
          ))}
          {(dias ?? []).length === 0 && <Tr><Td colSpan={5} className="py-8 text-center text-slate-500">Sin ventas en el rango.</Td></Tr>}
        </tbody>
      </Tabla>
      <div className="mt-3 text-right text-sm">
        {tot.documentos} documentos · Neto <strong className="font-mono">{formatearCLP(tot.neto)}</strong> · IVA <strong className="font-mono">{formatearCLP(tot.iva)}</strong> · Total <strong className="font-mono">{formatearCLP(tot.total)}</strong>
      </div>

      <div className="mt-6 max-w-2xl">
        <h2 className="mb-2 text-lg font-semibold text-slate-800">Top 10 productos del rango</h2>
        <Tarjeta>
          <ul className="space-y-1 text-sm">
            {top.map((p, i) => (
              <li key={i} className="flex justify-between">
                <span>{i + 1}. {p.descripcion} <span className="text-slate-400">× {p.cantidad}</span></span>
                <span className="font-mono">{formatearCLP(p.subtotal)}</span>
              </li>
            ))}
            {top.length === 0 && <li className="text-slate-500">Sin líneas de venta en el rango.</li>}
          </ul>
        </Tarjeta>
      </div>
    </div>
  )
}
```

`apps/erp/app/reportes/ventas/export/route.ts`:

```ts
import { crearClienteServidor } from '@suite/auth/server'
import { filasACsv } from '@suite/core'
import { obtenerEmpresaActiva } from '../../../../lib/empresa-activa'

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/

export async function GET(req: Request) {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return new Response('No autorizado', { status: 401 })
  const url = new URL(req.url)
  const desde = url.searchParams.get('desde') ?? ''
  const hasta = url.searchParams.get('hasta') ?? ''
  if (!FECHA_ISO.test(desde) || !FECHA_ISO.test(hasta) || hasta < desde) {
    return new Response('Rango inválido (use desde/hasta YYYY-MM-DD)', { status: 400 })
  }
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase
    .from('ventas_diarias')
    .select('fecha, documentos, neto, iva, total')
    .eq('empresa_id', activa.id).gte('fecha', desde).lte('fecha', hasta).order('fecha')
  if (error) return new Response('No se pudo generar el reporte', { status: 500 })
  const csv = filasACsv(
    ['Fecha', 'Documentos', 'Neto', 'IVA', 'Total'],
    (data ?? []).map((d) => [d.fecha, d.documentos, d.neto, d.iva, d.total])
  )
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="ventas-${desde}-a-${hasta}.csv"`,
    },
  })
}
```

- [ ] **Step 2: Valorización**

`apps/erp/app/reportes/valorizacion/page.tsx`:

```tsx
import Link from 'next/link'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP } from '@suite/core'
import { Boton, Encabezado, Tabla, Td, Th, Tr } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'

export default async function PaginaValorizacion() {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const supabase = await crearClienteServidor()
  const { data } = await supabase
    .from('valorizacion_inventario')
    .select('producto_id, sku, nombre, stock, costo_unitario, valor')
    .eq('empresa_id', activa.id)
    .order('nombre')
  const filas = data ?? []
  const totalValor = filas.reduce((s, f) => s + (f.valor ?? 0), 0)
  return (
    <div>
      <Encabezado titulo="Valorización de inventario">
        <Link href="/reportes/valorizacion/export"><Boton variante="secundario">Exportar CSV</Boton></Link>
      </Encabezado>
      <Tabla>
        <thead><tr><Th>SKU</Th><Th>Producto</Th><Th className="text-right">Stock</Th><Th className="text-right">Costo unitario</Th><Th className="text-right">Valor</Th></tr></thead>
        <tbody>
          {filas.map((f) => (
            <Tr key={f.producto_id}>
              <Td className="font-mono">{f.sku}</Td>
              <Td>{f.nombre}</Td>
              <Td className="text-right font-mono">{f.stock}</Td>
              <Td className="text-right font-mono">{f.costo_unitario === null ? <span className="text-slate-400">sin costo</span> : formatearCLP(f.costo_unitario)}</Td>
              <Td className="text-right font-mono">{f.valor === null ? '—' : formatearCLP(f.valor)}</Td>
            </Tr>
          ))}
          {filas.length === 0 && <Tr><Td colSpan={5} className="py-8 text-center text-slate-500">No hay productos activos.</Td></Tr>}
        </tbody>
      </Tabla>
      <div className="mt-3 text-right text-sm">Valor total del inventario: <strong className="font-mono">{formatearCLP(totalValor)}</strong> <span className="text-slate-400">(productos sin costo no suman)</span></div>
    </div>
  )
}
```

`apps/erp/app/reportes/valorizacion/export/route.ts`:

```ts
import { crearClienteServidor } from '@suite/auth/server'
import { filasACsv } from '@suite/core'
import { obtenerEmpresaActiva } from '../../../../lib/empresa-activa'

export async function GET() {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return new Response('No autorizado', { status: 401 })
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase
    .from('valorizacion_inventario')
    .select('sku, nombre, stock, costo_unitario, valor')
    .eq('empresa_id', activa.id)
    .order('nombre')
  if (error) return new Response('No se pudo generar el reporte', { status: 500 })
  const hoy = new Date().toISOString().slice(0, 10)
  const csv = filasACsv(
    ['SKU', 'Producto', 'Stock', 'Costo unitario', 'Valor'],
    (data ?? []).map((f) => [f.sku, f.nombre, f.stock, f.costo_unitario, f.valor])
  )
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="valorizacion-${hoy}.csv"`,
    },
  })
}
```

- [ ] **Step 3: Verificar**

Run: `pnpm --filter erp build`
Expected: build sin errores; rutas `/reportes/ventas`, `/reportes/valorizacion` y ambos exports generados.

- [ ] **Step 4: Commit**

```bash
git add apps/erp/app/reportes
git commit -m "feat(erp): ventas por período con top de productos y valorización, con exports CSV"
```

---

### Task 7: Pipeline + verificación integral (E2E)

**Files:**
- Modify: `packages/db/src/types.ts` (solo si el gen produce diff)
- Ninguno de producción (scripts en scratchpad, se borran al final).

- [ ] **Step 1: Pipeline**

Run: `pnpm --filter @suite/db gen` — commitear solo si hay diff (`chore(db): tipos regenerados`).
Run: `pnpm test` — Expected: `@suite/core` 69 (incl. csv/periodo), `@suite/auth` 2, `@suite/dte` 10, verdes.
Run: `pnpm supabase test db` — Expected: **87 asserts** verdes (6+16+19+10+10+7+10+9).
Run: `pnpm build --concurrency=1` — Expected: 3 apps compilan.

- [ ] **Step 2: E2E integral (script Node en scratchpad)**

Script con el patrón de siempre (`createRequire` sobre `packages/auth/package.json`; usuario real vía `registrar_organizacion`; RUT válido NO-fixture y distinto del demo, p.ej. `555555555`; clientes como authenticated; documentos/movimientos/recepciones vía admin):

1. Org + cliente + producto + bodega + proveedor; factura (total 100000) y boleta (59500) emitidas el mismo día; NC (100000) emitida al día siguiente; un borrador y una nota_venta (que NO deben aparecer).
2. `libro_ventas` del mes (como usuario authenticated): 3 filas; NC con total −100000; totales del mes = 59500.
3. `ventas_diarias`: día 1 = 159500; día 2 = −100000.
4. **Export HTTP real:** con la sesión del usuario (cookies del sign-in vía `@supabase/ssr`... si montar la cookie es frágil en script, alternativa aceptada: fetch al route handler con el flujo del navegador NO es viable sin browser — en su lugar validar el CSV llamando `filasACsv` directamente sobre las filas de la vista Y verificar el route handler con Playwright MCP queda para la demo; documentar cuál camino se usó). Mínimo obligatorio: el CSV generado con las filas reales parte con BOM (`charCodeAt(0) === 0xFEFF`), usa `;`, y sus totales cuadran con la pantalla.
5. Valorización: OC + 2 recepciones a costos 1000 y 1500 → `valorizacion_inventario` muestra costo 1500 y valor = stock × 1500; producto sin recepciones → costo null.
6. Aislamiento: org 2 no ve nada en las 3 vistas.
7. Cleanup FK-safe completo + verificar 0 filas + borrar script.

Si alguna aserción falla: defecto real → BLOCKED con detalle.

- [ ] **Step 3: Reporte**

Escribir `.superpowers/sdd/task-7-plan7-report.md` con salidas del pipeline y del E2E, evidencia de limpieza y `git status` limpio. Nota: el click-through por navegador (incluida la descarga real del CSV) queda para la demo con el usuario.

---

## Verificación final del plan

Al completar las 7 tasks:

- `pnpm test` — core 69, auth 2, dte 10, verdes.
- `pnpm supabase test db` — 87 asserts pgTAP verdes.
- `pnpm build` — 3 apps compilan.
- Ciclo completo: libro de ventas del mes cuadra con NC restando → export CSV con BOM/`;` abre en Excel → ventas por día + top productos → valorización a último costo — todo aislado por empresa, todo derivado de vistas.
- Criterio de éxito del Plan 7 (spec §8) cumplido.
