# Plan 9b: Pulido de Fase 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar los 10 ítems de backlog/minors del spec 9b (logout, cookie, calcularDV, categorías CI, colisión de mensajes, empty state, UUID admin, re-import activo, assert de exención, lock ordering) sin cambiar ninguna semántica existente.

**Architecture:** Una migración 0015 (índice único CI + `create or replace` de las 2 RPCs de pago con locks ordenados); guard TDD en `@suite/core`; retoques quirúrgicos en apps existentes. Cero tablas nuevas, cero grants nuevos, cero cambios de contrato (los 132 pgTAP existentes deben pasar SIN modificarlos).

**Tech Stack:** Postgres 17 (pgTAP), Vitest, Next.js 15 Server Actions.

**Spec:** `docs/superpowers/specs/2026-07-15-plan9b-pulido-design.md` (aprobado 2026-07-15).

## Global Constraints

- Los 132 asserts pgTAP existentes pasan SIN tocar sus archivos (excepto los 2 asserts NUEVOS que este plan agrega). Si un test existente falla, el fix está mal — no "arregles" el test.
- Las RPCs recreadas conservan EXACTAMENTE: nombre, firma, `security definer`, `set search_path = public`, mensajes de error byte-a-byte, semántica de validación y los `revoke`/`grant` (re-declarados al final de 0015 porque `create or replace` no los altera — verificar igualmente).
- Multi-tenant intacto: ningún cambio afloja scoping ni RLS.
- CERO BOM literal (byte-scan = 0 en todo archivo tocado); UTF-8 sin BOM; español; Windows/PowerShell 5.1 (`&&` no encadena; prefijar comandos con el refresh de PATH).
- Conteos finales: **134 pgTAP** (132 + 2), **95 unit** (core 83 + auth 2 + dte 10), 3 apps build.

---

### Task 1: Migración 0015 — índice CI de categorías + lock ordering en pagos

**Files:**
- Create: `supabase/migrations/00000000000015_pulido.sql`

**Interfaces:**
- Produces: índice `categorias_producto_nombre_ci_idx`; `registrar_pago` y `registrar_pago_proveedor` re-creadas (misma firma/contrato).

- [ ] **Step 1: Escribir la migración**

La migración tiene 3 partes. Parte A — índice case-insensitive:

```sql
-- Plan 9b: pulido. (A) Categorías únicas sin distinguir mayúsculas:
-- 'Repuestos' y 'repuestos' eran filas distintas bajo unique (empresa_id, nombre).
-- El unique original queda (redundante pero inofensivo); este índice es el que bloquea.
create unique index categorias_producto_nombre_ci_idx
  on public.categorias_producto (empresa_id, lower(nombre));
```

Parte B — `registrar_pago` con locks ordenados: abre `supabase/migrations/00000000000010_cobranza.sql`, copia la función `public.registrar_pago` COMPLETA y VERBATIM (desde `create or replace function` hasta `$$;`), y cambia ÚNICAMENTE la línea del loop (0010:121):

```sql
-- antes (0010):
  for v_app in select * from jsonb_array_elements(p_aplicaciones) loop
-- después (0015) — locks siempre en el mismo orden => dos pagos concurrentes no pueden deadlockear:
  for v_app in select * from jsonb_array_elements(p_aplicaciones) order by value->>'documentoId' loop
```

Antepone a la función un comentario de una línea: `-- Igual a 0010 salvo el order by del loop: locks de documentos en orden estable (anti-deadlock).`

Parte C — `registrar_pago_proveedor`: lo mismo copiando de `supabase/migrations/00000000000013_por_pagar.sql` (loop en 0013:163), mismo cambio, mismo comentario (referenciando 0013).

Cierre — re-declarar los permisos de ambas funciones tal como están en 0010/0013 (`revoke ... from anon, public; grant execute ... to authenticated;` con las firmas exactas), aunque `create or replace` los conserve: la migración queda autocontenida y legible.

- [ ] **Step 2: Aplicar y verificar que nada se rompió**

Run: `pnpm supabase db reset` (aplica 15 migraciones) y luego `pnpm supabase test db`
Expected: **132/132 asserts pass, 10 files** (cero tests modificados). Si `registrar_pago`/`registrar_pago_proveedor` fallan asserts, el copy tiene drift — rehacer el copy verbatim.

- [ ] **Step 3: Smoke del índice CI**

Con psql (o el SQL editor del stack local), como service_role:

```sql
insert into categorias_producto (empresa_id, nombre) values ('<uuid de empresa del seed o cualquier empresa>', 'PruebaCI');
insert into categorias_producto (empresa_id, nombre) values ('<misma empresa>', 'pruebaci'); -- debe fallar 23505
delete from categorias_producto where nombre = 'PruebaCI';
```

Expected: el segundo insert falla con `duplicate key ... categorias_producto_nombre_ci_idx`.

- [ ] **Step 4: BOM + commit**

Run: `grep -c $'\xEF\xBB\xBF' supabase/migrations/00000000000015_pulido.sql` → `0` (grep sale con código 1 cuando el conteo es 0 — eso es lo esperado, no un error).

```bash
git add supabase/migrations/00000000000015_pulido.sql
git commit -m "fix(db): locks de pago en orden estable e índice CI de categorías"
```

### Task 2: pgTAP — exención cambiada + categoría case-insensitive

**Files:**
- Modify: `supabase/tests/database/cotizaciones.test.sql` (plan(26) → plan(27))
- Modify: el archivo de tests que cubre maestros/categorías — localízalo con `ls supabase/tests/database/` + `grep -l categorias_producto supabase/tests/database/*.sql`; súbele el plan() en +1.

**Interfaces:**
- Consumes: migración 0015 aplicada (Task 1).

- [ ] **Step 1: Assert de exención cambiada (cotizaciones.test.sql)**

Lee el archivo primero. Agrega, siguiendo el estilo de los asserts 20-23 existentes y con los MISMOS fixtures (usuario vendedor de la empresa A), un caso NUEVO e independiente: crear cotización sobre un producto AFECTO existente → enviarla → aceptarla → como service_role (`reset role`) cambiar `productos.exento` a `true` para ese producto → como el vendedor, `throws_ok` de `convertir_cotizacion` con el mensaje contractual EXACTO `'Un producto de la cotización ya no está disponible o cambió su condición de IVA; crea una nueva cotización'`. Restaurar `exento = false` del producto al final del caso (los tests corren en una transacción, pero deja el fixture limpio igualmente). Cambia `select plan(26);` → `select plan(27);` y ajusta el comentario de numeración si el archivo lo lleva.

- [ ] **Step 2: Assert de categoría CI (archivo de maestros)**

En el archivo localizado, con un fixture de empresa existente en ese archivo: inserta categoría `'Lubricantes'` (lives_ok si el archivo usa ese patrón, o insert directo de fixture) y `throws_ok` del insert de `'LUBRICANTES'` esperando `23505`. plan() +1.

- [ ] **Step 3: Correr la suite completa**

Run: `pnpm supabase test db`
Expected: **134/134 asserts, 10 files, PASS**.

- [ ] **Step 4: BOM + commit**

Byte-scan de ambos archivos → 0.

```bash
git add supabase/tests/database/
git commit -m "test(db): exención cambiada bloquea conversión y categorías case-insensitive"
```

### Task 3: `@suite/core` — guard de `calcularDV` (TDD)

**Files:**
- Modify: `packages/core/src/rut.ts:5-16`
- Test: `packages/core/src/rut.test.ts` (o donde vivan los tests de rut — `ls packages/core/src/*.test.ts`)

**Interfaces:**
- Produces: `calcularDV(cuerpo: string): string` — retorna `''` para entrada vacía o con no-dígitos (antes devolvía un DV falso, p.ej. `calcularDV('') === '0'`).

- [ ] **Step 1: Tests que fallan**

En el archivo de tests de rut, siguiendo su estilo:

```ts
it('calcularDV devuelve vacío para entrada vacía', () => {
  expect(calcularDV('')).toBe('')
})

it('calcularDV devuelve vacío si el cuerpo trae no-dígitos', () => {
  expect(calcularDV('12a45')).toBe('')
})
```

- [ ] **Step 2: Verificar que fallan**

Run: `pnpm --filter @suite/core test`
Expected: 2 FAIL (`'0'` !== `''` y similar), 81 pass.

- [ ] **Step 3: Implementar el guard**

Al inicio de `calcularDV` en `packages/core/src/rut.ts`:

```ts
export function calcularDV(cuerpo: string): string {
  // Un DV solo existe para un cuerpo numérico no vacío: '' antes devolvía '0' (DV falso).
  if (!/^\d+$/.test(cuerpo)) return ''
  let suma = 0
  // ... (resto igual)
```

- [ ] **Step 4: Verificar verde + repo completo**

Run: `pnpm --filter @suite/core test` → **83 pass**. Luego `pnpm test` → **95** (core 83 + auth 2 + dte 10).

- [ ] **Step 5: BOM + commit**

```bash
git add packages/core/src/rut.ts packages/core/src/rut.test.ts
git commit -m "fix(core): calcularDV rechaza entrada no numérica (TDD)"
```

### Task 4: Apps — logout, cookie, mensajes y validaciones

**Files:**
- Modify: `apps/erp/app/acciones.ts` (cookie flags + nueva action `cerrarSesion`)
- Modify: `apps/erp/app/layout.tsx` (botón de logout al pie de la barra)
- Modify: `apps/erp/app/page.tsx` (empty state sin empresas)
- Modify: `apps/erp/app/por-pagar/acciones.ts:141` (colisión 'válido')
- Modify: `apps/erp/app/importar/acciones.ts` (re-import reactiva + mapeo 23505 de categoría)
- Modify: `apps/admin/app/acciones.ts` (guard UUID)
- Create: `apps/erp/componentes/boton-cerrar-sesion.tsx` (client, mínimo)

**Interfaces:**
- Consumes: nada de tasks previas (independiente).

- [ ] **Step 1: Cookie con flags** (`apps/erp/app/acciones.ts:14`)

```ts
almacen.set(COOKIE_EMPRESA, id, {
  path: '/',
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 60 * 60 * 24 * 365,
})
```

- [ ] **Step 2: Action `cerrarSesion`** (mismo archivo, al final)

Primero mira cómo el middleware/redirect actual construye la URL del login cuando no hay sesión (`grep -rn "login" apps/erp/middleware.ts apps/erp/lib` y `.env.local` — existe la referencia al portal web). Reusa ESA misma fuente de URL:

```ts
export async function cerrarSesion() {
  const supabase = await crearClienteServidor()
  await supabase.auth.signOut()
  const almacen = await cookies()
  almacen.delete(COOKIE_EMPRESA)
  redirect(<la misma URL/base de login que usa el middleware — no hardcodear otra>)
}
```

(imports de `redirect` y lo que falte; respeta el estilo del archivo.)

- [ ] **Step 3: Botón en la barra** — Create `apps/erp/componentes/boton-cerrar-sesion.tsx`:

```tsx
'use client'

import { cerrarSesion } from '../app/acciones'

export function BotonCerrarSesion() {
  return (
    <form action={cerrarSesion}>
      <button
        type="submit"
        className="w-full rounded-md px-3 py-2 text-left text-sm text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
      >
        Cerrar sesión
      </button>
    </form>
  )
}
```

En `apps/erp/app/layout.tsx`, dentro del `pie` de `BarraLateral`, envolver selector + botón (respetando que `pie` hoy es `activa && <SelectorEmpresa .../>`):

```tsx
pie={
  <div className="grid gap-2">
    {activa && <SelectorEmpresa empresas={empresas} activaId={activa.id} accion={cambiarEmpresaActiva} />}
    <BotonCerrarSesion />
  </div>
}
```

Ajusta el className del botón si el pie de la barra usa otra paleta — míralo en `packages/ui/src/barra-lateral.tsx` y mantén coherencia visual.

- [ ] **Step 4: Empty state sin empresas** (`apps/erp/app/page.tsx`)

Lee el inicio del componente: hoy con `activa` null el dashboard no tiene qué mostrar. Agrega el early-return ANTES de las queries:

```tsx
if (!activa) {
  return (
    <main className="grid min-h-[60vh] place-items-center">
      <div className="max-w-md rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">Tu organización aún no tiene empresas</h1>
        <p className="mt-2 text-sm text-slate-500">
          Cuando tu organización registre una empresa vas a ver aquí el panel con sus ventas, stock y cobranza.
        </p>
      </div>
    </main>
  )
}
```

(Ajusta al shape real del componente — si ya destructura `{ activa }` arriba, úsalo tal cual.)

- [ ] **Step 5: Colisión 'válido'** (`apps/erp/app/por-pagar/acciones.ts`) — ANTES de la línea 141 (`includes('válido')`) insertar:

```ts
    if (error.message.includes('Método')) return { error: 'Selecciona un método de pago válido' }
```

- [ ] **Step 6: Re-import reactiva + mapeo categoría** (`apps/erp/app/importar/acciones.ts`)

(a) En el payload de productos del upsert (`onConflict: 'empresa_id,sku'`, ~línea 110) agregar `activo: true` a cada registro; ídem clientes (~línea 170, `onConflict: 'empresa_id,rut'`) — re-importar es declarar vigente. (b) En el upsert de categorías (~línea 70): si el error es `23505`, mensaje `'Esa categoría ya existe (revisa mayúsculas/minúsculas)'` siguiendo el patrón de manejo de errores del archivo.

- [ ] **Step 7: Guard UUID admin** (`apps/admin/app/acciones.ts`)

```ts
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function cambiarEstado(id: string, estado: 'activa' | 'suspendida') {
  if (!UUID.test(id)) return
  // ... (resto igual)
```

- [ ] **Step 8: Build + BOM + commit**

Run: `pnpm --filter erp build` y `pnpm --filter admin build` → verdes. Byte-scan de todos los archivos tocados → 0.

```bash
git add apps/erp apps/admin
git commit -m "fix(apps): logout, cookie segura, mensajes y validaciones del backlog"
```

### Task 5: Pipeline + verificación integral

**Files:** ninguno de producción.

- [ ] **Step 1: Pipeline completo**

Run: `pnpm test` → **95**. `pnpm supabase test db` → **134**. `pnpm build --concurrency=1` → 3 apps.

- [ ] **Step 2: Verificación funcional (Playwright o manual)**

Resembrar demo (`node scripts/seed-demo.mjs` tras el reset de los tests + `docker restart supabase_kong_ERP_Transportes` si auth da 502; reiniciar dev servers con `.next` limpio si estaban corriendo). Verificar: (1) login → botón "Cerrar sesión" visible al pie de la barra → click → vuelve al login y NO puede volver a entrar a /cotizaciones sin loguearse; (2) re-login OK; (3) el dashboard con la demo carga normal (el empty state no aplica con empresa — solo verificar que no rompió el caso normal).

- [ ] **Step 3: Reporte**

`.superpowers/sdd/task-5-plan9b-report.md` con los conteos y la evidencia del logout.

---

## Verificación final del plan

- `pnpm test` (**95**) + `pnpm supabase test db` (**134**) + `pnpm build` (3 apps) verdes.
- Logout funcional end-to-end; cookie con secure/maxAge; categorías no duplicables por caso; mensajes de pago sin colisión; dashboard sin empresas guía en vez de fallar; admin tolera ids basura; re-import reactiva; locks de pago ordenados.
- Criterio de éxito del spec §6 cumplido.
