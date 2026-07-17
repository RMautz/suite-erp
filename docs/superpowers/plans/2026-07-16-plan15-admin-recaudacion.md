# Plan 15: Rediseño del panel admin + recaudación de suscripciones — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el operador de la plataforma vea de un vistazo cuánto han recaudado las suscripciones y el estado del parque de organizaciones, en un panel con la identidad visual de la suite. Es la vista de conciliación del runbook del Plan 14: los pagos en `revision` (dinero cobrado sin acreditar) saltan a la vista. Alcance deliberadamente chico: **cero cambios de BD** (ni migración, ni RPCs, ni pgTAP), pura capa de lectura sobre lo que el Plan 14 ya dejó.

**Architecture:** `apps/admin` gana la infra visual de `apps/web` (Tailwind 4 + `@suite/ui`, `postcss.config.mjs`, `globals.css`, `next.config.ts` con `transpilePackages`, `layout.tsx` con header de plataforma). `apps/admin/app/page.tsx` pasa de una tabla con estilos inline a un dashboard server component: dos queries service_role (`organizaciones` + `pagos_suscripcion`), agregación en JS puro dentro del archivo (recaudado del mes, total histórico, serie de 6 meses, desglose por pasarela, revisión), y composición con `Tarjeta`/`Tabla`/`Insignia`/`Boton`. `verificarAdmin()` y las server actions `activar/suspender` quedan INTACTOS.

**Tech Stack:** Next.js 15 (App Router, server components + Server Actions existentes), Tailwind CSS 4 (`@tailwindcss/postcss`), `@suite/ui`, `@suite/core` (`formatearCLP`/`formatearRut`), `@suite/auth/admin` (`clienteAdmin` service_role).

**Spec:** `docs/superpowers/specs/2026-07-16-plan15-admin-recaudacion-design.md` (§2 decisiones, §4 queries/derivaciones/composición y §6 verificación son CONTRATO).

## Global Constraints

- **Cero BD, cero tests nuevos:** no hay migración, RPC ni pgTAP; conteos EXACTOS SIN CAMBIO — unit **163**, pgTAP **269**. La agregación mensual es función pura LOCAL del server component (spec §2): si el reviewer la considera digna de unit, se extrae a `@suite/core` con sus tests y se ajustan los conteos EXPLÍCITAMENTE — en este plan no se extrae y no se crea ningún test.
- **Solo `estado = 'pagado'` suma recaudación:** `pendiente`/`abortado`/`revision` NO suman. `revision` es dinero cobrado sin acreditar: se muestra aparte como aviso rojo, JAMÁS mezclado en los KPIs ni en la serie.
- **Identidad = espejo de una app que consume `@suite/ui`.** El wiring Tailwind 4 (deps, `postcss.config.mjs`) espeja `apps/web`; `globals.css` y `next.config.ts` espejan `apps/erp` (la app que SÍ renderiza componentes de `@suite/ui`): la línea `@source '../../../packages/ui/src'` y `@suite/ui` en `transpilePackages` son LOAD-BEARING — sin ellas Tailwind 4 purga las clases que solo viven en `packages/ui/src` (`bg-green-100` de `Insignia`, variantes de `Boton`, etc.) y los componentes salen sin estilo, y Next no transpila el `.tsx` crudo que `@suite/ui` exporta. `apps/web` no las necesita porque no usa componentes de `@suite/ui` (solo clases inline).
- **Solo LECTURA nueva.** Las únicas mutaciones siguen siendo las server actions `activarOrganizacion`/`suspenderOrganizacion` (`apps/admin/app/acciones.ts`), sin cambios. `verificarAdmin()` (`apps/admin/lib/guardia.ts`) corre PRIMERO, como hoy. Ninguna credencial/env nueva.
- **Cero client components nuevos.** Todo el HTML es server-rendered; el gráfico es CSS estático (patrón del gráfico de ventas del ERP adaptado a 6 meses). Ningún dato de `pagos_suscripcion` sale de la página.
- **Embed de suscripciones es OBJETO.** El `unique (organizacion_id)` del Plan 14 volvió `suscripciones_organizacion_id_fkey` `isOneToOne: true` en `packages/db/src/types.ts`, así que `organizaciones ... suscripciones (hasta)` devuelve `{ hasta: string | null } | null` (acceso `org.suscripciones?.hasta`, como el `page.tsx` actual), NO un array.
- **Formato es-CL:** montos SIEMPRE con `formatearCLP`; RUT con `formatearRut`; timestamps (`pagado_en`/`creado_en`) con `new Date(iso).toLocaleDateString('es-CL')`; fechas-día (`trial_hasta`/`suscripciones.hasta`) con `new Date(dia + 'T00:00:00').toLocaleDateString('es-CL')` (patrón del `page.tsx` actual). Estados vacíos con mensaje ("Aún no hay pagos de suscripción."). La deuda timezone Chile es repo-wide y NO se resuelve aquí.
- **CERO BOM literal** (UTF-8 sin BOM; byte-scan `grep -c` al final de cada task, `0` + exit 1 = pass). Windows/**PowerShell 5.1**: `&&` NO encadena comandos — un comando por línea; PATH refresh en shells nuevas.

---

### Task 1: Infra visual del admin (espejo de apps/web + apps/erp)

**Files:**
- Modify: `apps/admin/package.json` (+ `@suite/ui`, `tailwindcss`, `@tailwindcss/postcss`)
- Create: `apps/admin/postcss.config.mjs`
- Create: `apps/admin/app/globals.css`
- Modify: `apps/admin/next.config.ts` (+ `@suite/ui` en `transpilePackages`)
- Modify: `apps/admin/app/layout.tsx` (header de plataforma; importa `globals.css`)

**Interfaces:**
- Consumes: `apps/web/package.json` (versiones EXACTAS `tailwindcss@^4.3.2` / `@tailwindcss/postcss@^4.3.2`) y `apps/web/postcss.config.mjs` (plugin); `apps/erp/app/globals.css` (las 3 líneas con `@source`, patrón de app que consume `@suite/ui`) y `apps/erp/next.config.ts` (`@suite/ui` en `transpilePackages` — el paquete exporta `.tsx` crudo desde `packages/ui/src/index.ts`, sin build step); `packages/ui/src/tema.css` (paleta marca sky, importada por `globals.css`); `apps/web/app/layout.tsx` y `apps/web/app/login/page.tsx` (patrón del logo con gradiente de marca).
- Produces: `apps/admin` con Tailwind 4 + `@suite/ui` cableados y un `layout.tsx` con header de plataforma (`max-w-6xl`), listos para que Task 2 reescriba `page.tsx` con componentes de `@suite/ui`. La página actual (inline) sigue compilando bajo el nuevo layout: es un checkpoint transitorio (Task 2 la reemplaza).

- [ ] **Step 1: Editar `apps/admin/package.json`**

Antes (repo actual):

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

Después (+ `@suite/ui` en dependencies con `workspace:^` como `apps/erp`; + `tailwindcss` y `@tailwindcss/postcss` en devDependencies con las versiones EXACTAS de `apps/web`):

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
    "@suite/ui": "workspace:^",
    "next": "^15.1.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "server-only": "^0.0.1"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4.3.2",
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "tailwindcss": "^4.3.2",
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 2: Crear `apps/admin/postcss.config.mjs`** (copia literal de `apps/web/postcss.config.mjs`)

```js
export default {
  plugins: { '@tailwindcss/postcss': {} },
}
```

- [ ] **Step 3: Crear `apps/admin/app/globals.css`** (patrón de `apps/erp/app/globals.css`: import de Tailwind + tema compartido + `@source` que evita que Tailwind purgue las clases de `@suite/ui`)

```css
@import 'tailwindcss';
@import '../../../packages/ui/src/tema.css';
@source '../../../packages/ui/src';
```

- [ ] **Step 4: Editar `apps/admin/next.config.ts`** (añadir `@suite/ui` a `transpilePackages`, como `apps/erp`)

Antes (repo actual):

```ts
import type { NextConfig } from 'next'

const config: NextConfig = {
  transpilePackages: ['@suite/core', '@suite/db', '@suite/auth'],
}

export default config
```

Después:

```ts
import type { NextConfig } from 'next'

const config: NextConfig = {
  transpilePackages: ['@suite/core', '@suite/db', '@suite/auth', '@suite/ui'],
}

export default config
```

- [ ] **Step 5: Reescribir `apps/admin/app/layout.tsx`** (importa `globals.css`; header de plataforma con logo de gradiente marca + "Panel de plataforma"; `<main>` con `max-w-6xl mx-auto`)

Antes (repo actual):

```tsx
import type { ReactNode } from 'react'

export const metadata = { title: 'Suite ERP — Admin' }

export default function LayoutRaiz({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body style={{ fontFamily: 'system-ui', margin: 0 }}>{children}</body>
    </html>
  )
}
```

Después:

```tsx
import type { ReactNode } from 'react'
import './globals.css'

export const metadata = { title: 'Suite ERP — Panel de plataforma' }

export default function LayoutRaiz({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-slate-50 font-sans text-slate-800 antialiased">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-4">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-marca-500 to-marca-700 text-sm font-bold text-white">
              SE
            </span>
            <div>
              <p className="text-lg font-semibold leading-tight text-slate-900">
                Suite{' '}
                <span className="bg-gradient-to-r from-marca-600 to-cyan-500 bg-clip-text text-transparent">
                  ERP
                </span>
              </p>
              <p className="text-xs text-slate-500">Panel de plataforma</p>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
      </body>
    </html>
  )
}
```

- [ ] **Step 6: Instalar y verificar el build**

Run (PowerShell 5.1 — un comando por línea; `pnpm install` primero porque cambió `package.json`):

```
pnpm install
```

```
pnpm --filter admin build
```

Expected: `pnpm install` enlaza `@suite/ui` (workspace) y baja `tailwindcss`/`@tailwindcss/postcss`; `pnpm --filter admin build` compila sin errores. La página actual (estilos inline) sigue válida bajo el nuevo layout — checkpoint transitorio; Task 2 la reemplaza. (El `<main>` inline de la página vieja queda anidado dentro del `<main>` del layout: HTML no ideal pero compila; desaparece en Task 2.)

- [ ] **Step 7: Byte-scan (JAMÁS BOM U+FEFF)** — git-bash:

```
grep -c $'\xEF\xBB\xBF' apps/admin/package.json apps/admin/postcss.config.mjs apps/admin/app/globals.css apps/admin/next.config.ts apps/admin/app/layout.tsx
```

→ cada archivo imprime `:0` y el comando sale con status 1 (sin coincidencias = pass).

- [ ] **Step 8: Commit**

```
git add apps/admin/package.json apps/admin/postcss.config.mjs apps/admin/app/globals.css apps/admin/next.config.ts apps/admin/app/layout.tsx pnpm-lock.yaml
git commit -m "feat(admin): infra visual — Tailwind 4 + @suite/ui + header de plataforma"
```

---

### Task 2: Página dashboard + recaudación (`apps/admin/app/page.tsx`)

**Files:**
- Modify: `apps/admin/app/page.tsx` (reescritura completa: server component con KPIs, gráfico de 6 meses, desglose por pasarela, tabla de organizaciones restilizada y últimos pagos)

**Interfaces:**
- Consumes: `verificarAdmin()` (`apps/admin/lib/guardia.ts` — throw si el email no está en `ADMIN_EMAILS`; SIN cambios); `clienteAdmin()` (`@suite/auth/admin` — cliente service_role tipado `Database`); `activarOrganizacion`/`suspenderOrganizacion` (`apps/admin/app/acciones.ts` — server actions existentes, SIN cambios); `formatearCLP`/`formatearRut` (`@suite/core`); `Boton`/`Encabezado`/`Insignia`/`Tabla`/`Tarjeta`/`Td`/`Th`/`Tr` (`@suite/ui`); tablas `organizaciones` (embed `planes (nombre, precio_clp)` OBJETO y `suscripciones (hasta)` OBJETO por `isOneToOne`) y `pagos_suscripcion` (`Row`: `id`, `organizacion_id`, `monto:number`, `pasarela:string`, `estado:string`, `pagado_en:string|null`, `creado_en:string`) de `@suite/db`.
- Produces: el dashboard completo, server-rendered, sin client components nuevos. Las derivaciones (recaudado del mes, total histórico, serie de 6 meses, por pasarela, revisión, orgs por estado y vencidas) son funciones puras locales del archivo — spec §2: NO se extraen ni se testean (conteos 163/269 intactos).
- Contrato de mapeo de tonos (spec §4.4/§4.5): org `activa`→verde, `trial`→amarillo, `suspendida`→rojo; pago `pagado`→verde, `pendiente`→gris, `revision`→amarillo, `abortado`→rojo. `vencida` = org `activa` con `suscripciones.hasta < hoy` (comparación lexicográfica de fechas ISO `yyyy-mm-dd`, válida = cronológica). Etiqueta de pasarela: `mercadopago`→"MercadoPago", `webpay`→"Webpay Plus".

- [ ] **Step 1: Reescribir `apps/admin/app/page.tsx`**

Antes (repo actual): una tabla con estilos inline (`<table style=...>`) que selecciona `planes (nombre)` y `suscripciones (hasta)` y renderiza `activarOrganizacion`/`suspenderOrganizacion` con `<button>` desnudos. Se reemplaza por completo.

Después:

```tsx
import { clienteAdmin } from '@suite/auth/admin'
import { formatearCLP, formatearRut } from '@suite/core'
import { Boton, Encabezado, Insignia, Tabla, Tarjeta, Td, Th, Tr } from '@suite/ui'
import { verificarAdmin } from '../lib/guardia'
import { activarOrganizacion, suspenderOrganizacion } from './acciones'

// Clave 'yyyy-mm' del mes calendario (fechas locales del servidor; la deuda
// timezone Chile es repo-wide y explícitamente no se resuelve aquí).
const claveMes = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

function tonoOrg(estado: string): 'verde' | 'amarillo' | 'rojo' {
  if (estado === 'activa') return 'verde'
  if (estado === 'suspendida') return 'rojo'
  return 'amarillo'
}

function tonoPago(estado: string): 'verde' | 'amarillo' | 'rojo' | 'gris' {
  if (estado === 'pagado') return 'verde'
  if (estado === 'revision') return 'amarillo'
  if (estado === 'abortado') return 'rojo'
  return 'gris'
}

const etiquetaPasarela = (p: string) =>
  p === 'mercadopago' ? 'MercadoPago' : p === 'webpay' ? 'Webpay Plus' : p

export default async function PanelAdmin() {
  await verificarAdmin()
  const admin = clienteAdmin()

  const [{ data: organizaciones, error: errOrg }, { data: pagosData, error: errPagos }] = await Promise.all([
    admin
      .from('organizaciones')
      .select('id, rut, razon_social, estado, trial_hasta, creado_en, planes (nombre, precio_clp), suscripciones (hasta)')
      .order('creado_en', { ascending: false }),
    admin
      .from('pagos_suscripcion')
      .select('id, organizacion_id, monto, pasarela, estado, pagado_en, creado_en')
      .order('creado_en', { ascending: false }),
  ])

  if (errOrg || errPagos) throw new Error('No se pudieron cargar los datos del panel')

  const orgs = organizaciones ?? []
  const pagos = pagosData ?? []

  const hoy = new Date()
  const hoyISO = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`
  const claveMesActual = claveMes(hoy)

  // ----- Agregación de pagos (SOLO 'pagado' suma recaudación) -----
  let recaudadoMes = 0
  let conteoMes = 0
  let totalHistorico = 0
  let conteoTotal = 0
  const serie = new Map<string, number>()
  const porPasarelaMap = new Map<string, { monto: number; conteo: number }>()

  for (const p of pagos) {
    if (p.estado !== 'pagado') continue
    const monto = p.monto ?? 0
    totalHistorico += monto
    conteoTotal += 1
    const pp = porPasarelaMap.get(p.pasarela) ?? { monto: 0, conteo: 0 }
    pp.monto += monto
    pp.conteo += 1
    porPasarelaMap.set(p.pasarela, pp)
    if (p.pagado_en) {
      const clave = claveMes(new Date(p.pagado_en))
      serie.set(clave, (serie.get(clave) ?? 0) + monto)
      if (clave === claveMesActual) {
        recaudadoMes += monto
        conteoMes += 1
      }
    }
  }

  // Serie de los últimos 6 meses (incluye el actual; meses sin pagos = 0).
  const meses = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - (5 - i), 1)
    const clave = claveMes(d)
    return { clave, etiqueta: d.toLocaleDateString('es-CL', { month: 'short' }), monto: serie.get(clave) ?? 0 }
  })
  const maxMes = Math.max(1, ...meses.map((m) => m.monto))
  const hayRecaudacion = meses.some((m) => m.monto > 0)

  const pasarelas = [
    { etiqueta: 'MercadoPago', ...(porPasarelaMap.get('mercadopago') ?? { monto: 0, conteo: 0 }) },
    { etiqueta: 'Webpay Plus', ...(porPasarelaMap.get('webpay') ?? { monto: 0, conteo: 0 }) },
  ]
  const maxPasarela = Math.max(1, ...pasarelas.map((p) => p.monto))

  const revision = pagos.filter((p) => p.estado === 'revision')
  const recientes = pagos.slice(0, 20)
  const razonPorOrg = new Map(orgs.map((o) => [o.id, o.razon_social]))

  // ----- Organizaciones por estado -----
  const activas = orgs.filter((o) => o.estado === 'activa').length
  const enTrial = orgs.filter((o) => o.estado === 'trial').length
  const suspendidas = orgs.filter((o) => o.estado === 'suspendida').length
  // Vencida: activa con suscripción cuyo 'hasta' ya pasó (subconjunto de las activas).
  const vencidaIds = new Set(
    orgs
      .filter((o) => o.estado === 'activa' && !!o.suscripciones?.hasta && o.suscripciones.hasta < hoyISO)
      .map((o) => o.id)
  )

  const fechaCorta = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('es-CL') : '—')
  const fechaDia = (dia: string | null) => (dia ? new Date(dia + 'T00:00:00').toLocaleDateString('es-CL') : '—')

  return (
    <div className="space-y-6">
      <Encabezado titulo="Recaudación y organizaciones" />

      {revision.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-5">
          <p className="font-semibold text-red-800">
            ⚠ {revision.length} pago{revision.length === 1 ? '' : 's'} en revisión — dinero cobrado sin acreditar
          </p>
          <table className="mt-3 w-full text-left text-sm">
            <thead>
              <tr className="text-red-700">
                <th className="py-1 pr-4 font-medium">Fecha</th>
                <th className="py-1 pr-4 font-medium">Organización</th>
                <th className="py-1 pr-4 font-medium">Pasarela</th>
                <th className="py-1 font-medium">Monto</th>
              </tr>
            </thead>
            <tbody>
              {revision.map((p) => (
                <tr key={p.id} className="border-t border-red-100 text-red-900">
                  <td className="py-1 pr-4 tabular-nums">{fechaCorta(p.pagado_en ?? p.creado_en)}</td>
                  <td className="py-1 pr-4">{razonPorOrg.get(p.organizacion_id) ?? '—'}</td>
                  <td className="py-1 pr-4">{etiquetaPasarela(p.pasarela)}</td>
                  <td className="py-1 tabular-nums">{formatearCLP(p.monto)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-red-700">
            Runbook: consulta el estado del cobro en la pasarela y confírmalo por SQL con el service_role antes de acreditar.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tarjeta>
          <p className="text-xs text-slate-400">Recaudado este mes</p>
          <p className="text-2xl font-bold tabular-nums tracking-tight text-emerald-600">{formatearCLP(recaudadoMes)}</p>
          <p className="text-xs text-slate-500">
            {conteoMes} pago{conteoMes === 1 ? '' : 's'} acreditado{conteoMes === 1 ? '' : 's'}
          </p>
        </Tarjeta>
        <Tarjeta>
          <p className="text-xs text-slate-400">Total histórico</p>
          <p className="text-2xl font-bold tabular-nums tracking-tight text-slate-900">{formatearCLP(totalHistorico)}</p>
          <p className="text-xs text-slate-500">
            {conteoTotal} pago{conteoTotal === 1 ? '' : 's'} en total
          </p>
        </Tarjeta>
        <Tarjeta>
          <p className="text-xs text-slate-400">Pagos este mes</p>
          <p className="text-2xl font-bold tabular-nums tracking-tight text-marca-700">{conteoMes}</p>
          <p className="text-xs text-slate-500">suscripciones acreditadas</p>
        </Tarjeta>
        <Tarjeta>
          <p className="text-xs text-slate-400">Organizaciones</p>
          <p className="text-2xl font-bold tabular-nums tracking-tight text-slate-900">{orgs.length}</p>
          <p className="text-xs text-slate-500">
            {activas} activas · {enTrial} trial · {suspendidas} suspendidas
          </p>
          {vencidaIds.size > 0 && (
            <p className="text-xs font-medium text-red-600">
              de ellas {vencidaIds.size} vencida{vencidaIds.size === 1 ? '' : 's'}
            </p>
          )}
        </Tarjeta>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.5fr_1fr]">
        <Tarjeta>
          <h2 className="mb-3 text-sm font-medium text-slate-600">Recaudación últimos 6 meses</h2>
          {!hayRecaudacion ? (
            <p className="py-10 text-center text-sm text-slate-400">Aún no hay recaudación en los últimos 6 meses.</p>
          ) : (
            <div className="flex h-40 items-end gap-2">
              {meses.map((m) => (
                <div
                  key={m.clave}
                  className="flex h-full flex-1 flex-col justify-end"
                  title={`${m.etiqueta}: ${formatearCLP(m.monto)}`}
                >
                  <span
                    className="block min-h-0.5 rounded-t-sm bg-gradient-to-b from-marca-400 to-marca-600"
                    style={{ height: `${Math.round((m.monto / maxMes) * 100)}%` }}
                  />
                  <span className="mt-1 text-center text-[10px] tabular-nums text-slate-400">{m.etiqueta}</span>
                </div>
              ))}
            </div>
          )}
        </Tarjeta>
        <Tarjeta>
          <h2 className="mb-3 text-sm font-medium text-slate-600">Recaudación por pasarela</h2>
          <div className="space-y-3">
            {pasarelas.map((p) => (
              <div key={p.etiqueta} className="text-sm">
                <div className="mb-0.5 flex justify-between">
                  <span className="font-medium text-slate-800">{p.etiqueta}</span>
                  <span className="tabular-nums text-slate-500">
                    {formatearCLP(p.monto)} · {p.conteo}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <span
                    className="block h-full rounded-full bg-gradient-to-r from-cyan-400 to-marca-600"
                    style={{ width: `${Math.round((p.monto / maxPasarela) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Tarjeta>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-medium text-slate-600">Organizaciones ({orgs.length})</h2>
        {orgs.length === 0 ? (
          <p className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">
            Aún no hay organizaciones registradas.
          </p>
        ) : (
          <Tabla>
            <thead>
              <Tr>
                <Th>RUT</Th>
                <Th>Razón social</Th>
                <Th>Plan</Th>
                <Th>Estado</Th>
                <Th>Trial hasta</Th>
                <Th>Suscrita hasta</Th>
                <Th>Acciones</Th>
              </Tr>
            </thead>
            <tbody>
              {orgs.map((org) => (
                <Tr key={org.id}>
                  <Td className="tabular-nums">{formatearRut(org.rut)}</Td>
                  <Td className="font-medium text-slate-900">{org.razon_social}</Td>
                  <Td>
                    {org.planes?.nombre ?? '—'}
                    {org.planes && (
                      <span className="block text-xs text-slate-400">{formatearCLP(org.planes.precio_clp)}/mes</span>
                    )}
                  </Td>
                  <Td>
                    <Insignia tono={tonoOrg(org.estado)}>{org.estado}</Insignia>
                    {vencidaIds.has(org.id) && <span className="ml-2 text-xs font-medium text-red-600">● Vencida</span>}
                  </Td>
                  <Td className="tabular-nums">{fechaDia(org.trial_hasta)}</Td>
                  <Td className="tabular-nums">{fechaDia(org.suscripciones?.hasta ?? null)}</Td>
                  <Td>
                    <div className="flex gap-2">
                      <form action={activarOrganizacion}>
                        <input type="hidden" name="id" value={org.id} />
                        <Boton type="submit" variante="secundario" disabled={org.estado === 'activa'}>
                          Activar
                        </Boton>
                      </form>
                      <form action={suspenderOrganizacion}>
                        <input type="hidden" name="id" value={org.id} />
                        <Boton type="submit" variante="peligro" disabled={org.estado === 'suspendida'}>
                          Suspender
                        </Boton>
                      </form>
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Tabla>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-slate-600">Últimos pagos</h2>
        {recientes.length === 0 ? (
          <p className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">
            Aún no hay pagos de suscripción.
          </p>
        ) : (
          <Tabla>
            <thead>
              <Tr>
                <Th>Fecha</Th>
                <Th>Organización</Th>
                <Th>Pasarela</Th>
                <Th>Monto</Th>
                <Th>Estado</Th>
              </Tr>
            </thead>
            <tbody>
              {recientes.map((p) => (
                <Tr key={p.id}>
                  <Td className="tabular-nums">{fechaCorta(p.pagado_en ?? p.creado_en)}</Td>
                  <Td>{razonPorOrg.get(p.organizacion_id) ?? '—'}</Td>
                  <Td>{etiquetaPasarela(p.pasarela)}</Td>
                  <Td className="tabular-nums">{formatearCLP(p.monto)}</Td>
                  <Td>
                    <Insignia tono={tonoPago(p.estado)}>{p.estado}</Insignia>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Tabla>
        )}
      </section>
    </div>
  )
}
```

- [ ] **Step 2: Verificar build + tipos**

Run (PowerShell 5.1 — un comando por línea; `build` primero para que Next genere `.next/types` que `tsc` lee):

```
pnpm --filter admin build
```

```
pnpm --filter admin exec tsc --noEmit
```

Expected: `pnpm --filter admin build` compila y type-checkea el server component sin errores (embeds `planes`/`suscripciones` como OBJETO; `Insignia tono` acepta la unión de `tonoOrg`/`tonoPago`; `Boton` acepta `type`/`disabled`/`variante`). `tsc --noEmit` sin salida. Conteos de tests SIN CAMBIO (no se corren aquí; se validan en Task 3): unit 163 / pgTAP 269.

- [ ] **Step 3: Byte-scan (JAMÁS BOM U+FEFF)** — git-bash:

```
grep -c $'\xEF\xBB\xBF' apps/admin/app/page.tsx
```

→ imprime `0` y sale con status 1 (sin coincidencias = pass).

- [ ] **Step 4: Commit**

```
git add apps/admin/app/page.tsx
git commit -m "feat(admin): dashboard de recaudación de suscripciones — KPIs, gráfico 6 meses y aviso de revisión"
```

---

### Task 3: Pipeline completo + checklist manual (spec §6)

**Files:**
- (ninguno — task de verificación; sin cambios de código)

**Interfaces:**
- Consumes: el árbol tras Tasks 1-2 (`apps/admin` con infra visual + dashboard); la migración 0019 del Plan 14 ya aplicada en el Postgres local (tabla `pagos_suscripcion`, `estado in ('pendiente','pagado','abortado','revision')`, pasarelas `mercadopago`/`webpay`); el seed demo (`pnpm demo`) que crea la organización `771234569` "Demo Transportes SpA" con su `plan_id`.
- Produces: evidencia de que el plan cierra SIN mover conteos (unit 163, pgTAP 269, 3 apps build) y de que la vista cumple el runbook (el aviso de `revision` aparece y se limpia). Ningún artefacto nuevo.

- [ ] **Step 1: Suite unitaria (163, sin cambio)**

```
pnpm test
```

Expected: **163** unit verdes (este plan no crea ni borra tests). Si el número cambió, algo se rompió fuera del alcance — investigar, no ajustar.

- [ ] **Step 2: Suite pgTAP (269, sin cambio)**

```
pnpm supabase test db
```

Expected: **269** asserts verdes (cero BD nueva).

- [ ] **Step 3: Build de las 3 apps**

```
pnpm build --concurrency=1
```

Expected: `web`, `erp` y `admin` compilan. `--concurrency=1` evita que dos `next build` pisen el mismo `.next` (lección de la memoria del proyecto).

- [ ] **Step 4: Checklist manual (spec §6 — 5 ítems)**

Prep: `pnpm demo` (resiembra la demo; es perecible) y `pnpm --filter admin dev` (admin en `http://localhost:3002`). Inicia sesión con un email listado en `ADMIN_EMAILS`.

1. **Identidad visual.** Abre `/`: se ve el header de plataforma (logo "Suite **ERP**" con gradiente marca + "Panel de plataforma"), los 4 KPIs en `Tarjeta`, el gráfico de 6 meses, el desglose por pasarela y las dos tablas (organizaciones + últimos pagos) estilizadas con `@suite/ui` — NO la tabla inline anterior.

2. **Un pago mueve los números.** Paga una suscripción mock desde el ERP demo (`/configuracion/suscripcion`, pasarela mock del Plan 14). Recarga `/` del admin: el KPI "Recaudado este mes" y "Pagos este mes" suben, la barra del mes actual crece en el gráfico, el desglose por pasarela suma, y el pago aparece arriba en "Últimos pagos" con `Insignia` verde (`pagado`).

3. **Aviso de revisión.** Siembra por SQL service_role un pago `revision` para la org demo (`771234569`) y recarga `/`: aparece el bloque rojo "⚠ 1 pago en revisión — dinero cobrado sin acreditar" con su fila (fecha, "Demo Transportes SpA", "Webpay Plus", monto) y la línea de runbook. Un `revision` NO suma en los KPIs ni en la serie. Luego límpialo.

   Sembrar (git-bash; container `supabase_db_ERP_Transportes`; `buy_order` fijo ≤26 chars, `pagado_en` null como un `revision` real, `referencia_externa` presente):

   ```
   docker exec -i supabase_db_ERP_Transportes psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
   insert into public.pagos_suscripcion
     (organizacion_id, plan_id, monto, pasarela, buy_order, estado, referencia_externa)
   select o.id, o.plan_id, pl.precio_clp, 'webpay', 'demorevision0001', 'revision', 'tbk:demo-revision'
   from public.organizaciones o
   join public.planes pl on pl.id = o.plan_id
   where o.rut = '771234569';
   SQL
   ```

   Limpiar (deja la demo como estaba):

   ```
   docker exec -i supabase_db_ERP_Transportes psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
   delete from public.pagos_suscripcion where buy_order = 'demorevision0001';
   SQL
   ```

4. **Activar/Suspender siguen funcionando.** En la tabla de organizaciones, "Suspender" pasa la org a `suspendida` (Insignia roja) y "Activar" la vuelve `activa` (Insignia verde); los botones se deshabilitan según el estado actual (server actions `apps/admin/app/acciones.ts`, sin cambios).

5. **No-admin sin acceso.** Con un usuario cuyo email NO está en `ADMIN_EMAILS`, abrir `/` lanza el error de permisos de siempre ("No tienes permisos de administrador de la plataforma") — `verificarAdmin()` corre primero, intacto.

## Verificación final del plan

- `pnpm test` → **163** unit verdes (sin cambio).
- `pnpm supabase test db` → **269** asserts pgTAP verdes (sin cambio).
- `pnpm build --concurrency=1` → `web` + `erp` + `admin` compilan.
- Byte-scan de todos los archivos tocados sin BOM (pass = `0` + exit 1):

  ```
  grep -c $'\xEF\xBB\xBF' apps/admin/package.json apps/admin/postcss.config.mjs apps/admin/app/globals.css apps/admin/next.config.ts apps/admin/app/layout.tsx apps/admin/app/page.tsx
  ```

- Checklist manual §6 (5 ítems) OK: identidad visual, un pago mueve KPIs/gráfico/últimos-pagos, el aviso de `revision` aparece y se limpia, Activar/Suspender operan, no-admin bloqueado.
- Cero BD nueva, cero tests nuevos, cero client components nuevos; `verificarAdmin()` y las server actions intactos.
