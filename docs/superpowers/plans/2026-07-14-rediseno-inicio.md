# Rediseño de páginas de inicio (landing + dashboard + paleta viva) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Landing comercial para el portal, dashboard ejecutivo para el ERP y paleta azul eléctrico en los tokens compartidos — fiel a la maqueta v2 aprobada por el usuario.

**Architecture:** Solo UI: swap de tokens en `packages/ui/src/tema.css` (toda la app hereda), Tailwind 4 instalado en `apps/web` (espejo del setup de `apps/erp`), landing como componentes presentacionales estáticos, dashboard reescrito leyendo SOLO vistas existentes (Planes 4-7) con gráficos en CSS puro.

**Tech Stack:** Next.js 15, Tailwind CSS 4 (`@tailwindcss/postcss`), TypeScript. CERO migraciones, CERO librerías de charts.

**Spec:** `docs/superpowers/specs/2026-07-14-rediseno-inicio-design.md` (aprobado; la maqueta v2 — artifact `4bebc90c`, label `maqueta-v2-colores-vivos` — es la referencia visual vinculante).

## Global Constraints

- Paleta: la escala `--color-marca-*` de `packages/ui/src/tema.css` pasa EXACTAMENTE a la escala sky de Tailwind (valores en Task 1). Ningún otro token cambia. `@suite/ui` `Boton` NO cambia de forma.
- Landing: estática, server-rendered, sin JS cliente adicional, sin fetching; precios ESTÁTICOS con comentario apuntando a la tabla `planes`; copy en español chileno exacto de la maqueta.
- Dashboard: un único `Promise.all`; TODAS las queries `.eq('empresa_id', activa.id)` con `activa` de `obtenerEmpresaActiva()`; vistas existentes solamente (`ventas_diarias`, `ventas_por_producto`, `saldos_documentos`, `stock_actual`); guards `?? 0` en columnas nullable de vistas; sin divisiones por cero (`Math.max(1, …)`); banners trial/suspendida y lógica de vencido/crítico SE CONSERVAN.
- Gráfico 14 días: rango `[hoy−13, hoy]` (UTC, convención repo), días sin ventas rellenados con 0, barra de hoy en verde, `title` con monto exacto.
- Semáforo KPI: verde `emerald-600`, rojo `red-600`, ámbar `amber-600` (clases Tailwind estáticas — jamás nombres de clase interpolados dinámicamente).
- Íconos de módulos: SVG inline `stroke` sobre fondos tintados (sky/cyan/amber/emerald/violet/rose 100 + 600).
- CERO caracteres BOM literales en fuentes; UTF-8 sin BOM; identificadores ASCII.
- Windows/PowerShell 5.1: `&&` no encadena; prefijar cada comando con el refresh de PATH. `pnpm install` tras tocar package.json.

---

### Task 1: Paleta viva en `tema.css`

**Files:**
- Modify: `packages/ui/src/tema.css` (swap completo de valores)

- [ ] **Step 1: Reemplazar la escala**

Contenido COMPLETO nuevo de `packages/ui/src/tema.css`:

```css
@theme {
  /* Marca: azul eléctrico vivo (escala sky de Tailwind; antes azul petróleo) */
  --color-marca-50: #f0f9ff;
  --color-marca-100: #e0f2fe;
  --color-marca-200: #bae6fd;
  --color-marca-300: #7dd3fc;
  --color-marca-400: #38bdf8;
  --color-marca-500: #0ea5e9;
  --color-marca-600: #0284c7;
  --color-marca-700: #0369a1;
  --color-marca-800: #075985;
  --color-marca-900: #0c4a6e;
  --color-marca-950: #082f49;
}
```

- [ ] **Step 2: Verificar**

Run: `pnpm build --concurrency=1`
Expected: las 3 apps compilan (el cambio es solo de valores de tokens; ninguna clase cambia de nombre).

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/tema.css
git commit -m "feat(ui): paleta marca azul eléctrico (toda la app hereda)"
```

---

### Task 2: Tailwind en `apps/web` + landing completa

**Files:**
- Modify: `apps/web/package.json` (devDependencies), `apps/web/app/layout.tsx`
- Create: `apps/web/postcss.config.mjs`, `apps/web/app/globals.css`, `apps/web/componentes/landing/hero.tsx`, `apps/web/componentes/landing/modulos.tsx`, `apps/web/componentes/landing/precios.tsx`
- Rewrite: `apps/web/app/page.tsx`

**Interfaces:**
- Consumes: tokens `marca-*` (Task 1). Los componentes de landing son presentacionales puros sin props (contenido estático).
- Nota: al importar Tailwind, el preflight resetea estilos base — `/login` y `/registro` (hoy con estilos inline mínimos) quedan visualmente más planos pero funcionales; su restyling es fast-follow explícito, NO de esta task.

- [ ] **Step 1: Setup Tailwind (espejo del erp)**

En `apps/web/package.json`, agregar a `devDependencies` (creando la sección si no existe):

```json
    "@tailwindcss/postcss": "^4.3.2",
    "tailwindcss": "^4.3.2"
```

Run: `pnpm install`

`apps/web/postcss.config.mjs`:

```js
export default {
  plugins: { '@tailwindcss/postcss': {} },
}
```

`apps/web/app/globals.css`:

```css
@import 'tailwindcss';
@import '../../../packages/ui/src/tema.css';
```

`apps/web/app/layout.tsx` (completo):

```tsx
import type { ReactNode } from 'react'
import './globals.css'

export const metadata = { title: 'Suite ERP — Gestión para pymes chilenas' }

export default function LayoutRaiz({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body className="font-sans text-slate-800 antialiased">{children}</body>
    </html>
  )
}
```

- [ ] **Step 2: Componentes de la landing**

`apps/web/componentes/landing/hero.tsx`:

```tsx
import Link from 'next/link'

// Maqueta decorativa del dashboard (estática, aria-hidden): 3 mini-KPIs + barras.
const BARRAS = [34, 52, 41, 66, 48, 78, 59, 88]

export function Hero() {
  return (
    <section
      className="grid items-center gap-10 px-6 pb-12 pt-14 sm:px-10 lg:grid-cols-[1.15fr_1fr]"
      style={{ background: 'radial-gradient(900px 420px at 85% -10%, #e0f2fe 0%, rgba(224,242,254,0) 60%)' }}
    >
      <div>
        <h1 className="text-3xl font-bold leading-tight tracking-tight text-slate-900 sm:text-4xl" style={{ textWrap: 'balance' }}>
          El ERP para pymes chilenas: ventas,{' '}
          <em className="bg-gradient-to-r from-marca-600 to-cyan-500 bg-clip-text not-italic text-transparent">
            facturación SII
          </em>{' '}
          e inventario en un solo lugar
        </h1>
        <p className="mt-4 max-w-xl text-slate-600">
          Emite boletas y facturas electrónicas, controla tu stock en varias bodegas y cobra a tiempo — sin planillas,
          sin instalar nada.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Link
            href="/registro"
            className="rounded-lg bg-gradient-to-br from-marca-500 to-marca-600 px-5 py-2.5 font-semibold text-white shadow-lg shadow-marca-600/30"
          >
            Prueba gratis 14 días
          </Link>
          <a href="#precios" className="rounded-lg border-2 border-marca-300 px-5 py-2.5 font-semibold text-marca-700">
            Ver precios
          </a>
        </div>
        <p className="mt-4 text-sm text-slate-400">Sin tarjeta de crédito · Cancela cuando quieras</p>
      </div>

      <div aria-hidden className="rounded-xl border border-marca-200 bg-marca-50 p-4 shadow-2xl shadow-marca-600/20">
        <div className="mb-3 grid grid-cols-3 gap-2">
          <div className="rounded-lg border border-marca-100 bg-white px-3 py-2">
            <p className="text-[10px] text-slate-400">Ventas del mes</p>
            <p className="text-sm font-bold tabular-nums text-emerald-600">$4.280.500</p>
          </div>
          <div className="rounded-lg border border-marca-100 bg-white px-3 py-2">
            <p className="text-[10px] text-slate-400">Por cobrar</p>
            <p className="text-sm font-bold tabular-nums">$812.300</p>
          </div>
          <div className="rounded-lg border border-marca-100 bg-white px-3 py-2">
            <p className="text-[10px] text-slate-400">Stock crítico</p>
            <p className="text-sm font-bold tabular-nums">3</p>
          </div>
        </div>
        <div className="flex h-20 items-end gap-1.5 rounded-lg border border-marca-100 bg-white px-3 pb-2 pt-3">
          {BARRAS.map((h, i) => (
            <span key={i} className="flex-1 rounded-t-sm bg-gradient-to-b from-cyan-400 to-marca-600" style={{ height: `${h}%` }} />
          ))}
        </div>
      </div>
    </section>
  )
}
```

`apps/web/componentes/landing/modulos.tsx`:

```tsx
const MODULOS = [
  {
    titulo: 'Ventas y facturación DTE',
    desc: 'Boletas, facturas y notas de crédito electrónicas con folios SII automáticos.',
    tinte: 'bg-sky-100 stroke-sky-600',
    icono: <path d="M4 6h16M4 12h16M4 18h10" />,
  },
  {
    titulo: 'Inventario multi-bodega',
    desc: 'Stock en tiempo real derivado de un libro de movimientos auditable.',
    tinte: 'bg-cyan-100 stroke-cyan-600',
    icono: <path d="M4 7l8-4 8 4v10l-8 4-8-4zM12 3v18M4 7l8 4 8-4" />,
  },
  {
    titulo: 'Compras',
    desc: 'Órdenes de compra y recepciones que suman stock con costo trazado.',
    tinte: 'bg-amber-100 stroke-amber-600',
    icono: <path d="M6 6h15l-2 8H8zM6 6L5 3H2M9 20a1 1 0 100-2 1 1 0 000 2zM17 20a1 1 0 100-2 1 1 0 000 2z" />,
  },
  {
    titulo: 'Cobranza',
    desc: 'Pagos multi-factura, saldos al día y alertas de documentos vencidos.',
    tinte: 'bg-emerald-100 stroke-emerald-600',
    icono: <path d="M12 8v8m-4-4h8M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />,
  },
  {
    titulo: 'Reportes SII',
    desc: 'Libro de ventas, ventas por período y valorización — exportables a Excel.',
    tinte: 'bg-violet-100 stroke-violet-600',
    icono: <path d="M4 20V10m6 10V4m6 16v-7m4 7H2" />,
  },
  {
    titulo: 'Multi-empresa',
    desc: 'Varias empresas bajo una organización, con roles por usuario.',
    tinte: 'bg-rose-100 stroke-rose-600',
    icono: (
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
    ),
  },
]

export function Modulos() {
  return (
    <section id="modulos" className="border-t border-slate-100 px-6 py-12 sm:px-10">
      <h2 className="text-xl font-bold text-slate-900">Todo lo que tu pyme necesita para operar</h2>
      <p className="mt-1 text-slate-600">Seis módulos integrados que comparten los mismos datos — nada de sistemas parchados.</p>
      <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {MODULOS.map((m) => (
          <div key={m.titulo} className="rounded-xl border border-slate-200 p-5 transition-colors hover:border-marca-300">
            <div className={`mb-3 grid h-10 w-10 place-items-center rounded-lg ${m.tinte}`}>
              <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none" strokeWidth={1.9}>
                {m.icono}
              </svg>
            </div>
            <h3 className="font-semibold text-slate-900">{m.titulo}</h3>
            <p className="mt-1 text-sm text-slate-600">{m.desc}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
```

`apps/web/componentes/landing/precios.tsx`:

```tsx
import Link from 'next/link'

// Precios estáticos: la fuente de verdad es la tabla `planes` (Básico/Pro/Empresa).
// Se actualizan a mano hasta que exista un admin de planes (leerlos aquí requeriría grant a anon).
const PLANES = [
  {
    nombre: 'Básico',
    precio: '$29.990',
    destacado: false,
    bullets: ['1 empresa', 'Ventas y facturación DTE', 'Inventario y compras', '3 usuarios'],
  },
  {
    nombre: 'Pro',
    precio: '$49.990',
    destacado: true,
    bullets: ['Hasta 3 empresas', 'Todo lo del plan Básico', 'Cobranza y reportes SII', '10 usuarios'],
  },
  {
    nombre: 'Empresa',
    precio: '$89.990',
    destacado: false,
    bullets: ['Empresas ilimitadas', 'Todo lo del plan Pro', 'Soporte prioritario', 'Usuarios ilimitados'],
  },
]

export function Precios() {
  return (
    <section id="precios" className="border-t border-slate-100 px-6 py-12 sm:px-10">
      <h2 className="text-xl font-bold text-slate-900">Precios simples, en pesos chilenos</h2>
      <p className="mt-1 text-slate-600">14 días de prueba en cualquier plan. Sin costos de implementación.</p>
      <div className="mt-8 grid items-stretch gap-4 lg:grid-cols-3">
        {PLANES.map((p) => (
          <div
            key={p.nombre}
            className={
              p.destacado
                ? 'relative flex flex-col rounded-2xl border-2 border-marca-600 bg-gradient-to-b from-marca-50 to-white p-6 shadow-xl shadow-marca-600/15'
                : 'flex flex-col rounded-2xl border border-slate-200 p-6'
            }
          >
            {p.destacado && (
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-br from-marca-500 to-marca-600 px-3 py-0.5 text-xs font-medium tracking-wide text-white">
                Más elegido
              </span>
            )}
            <h3 className="font-semibold text-slate-900">{p.nombre}</h3>
            <p className="mt-2 text-3xl font-bold tabular-nums text-slate-900">
              {p.precio} <span className="text-sm font-normal text-slate-400">/ mes + IVA</span>
            </p>
            <ul className="mt-4 flex-1 space-y-2 text-sm text-slate-600">
              {p.bullets.map((b) => (
                <li key={b}>
                  <span className="mr-2 font-bold text-emerald-600">✓</span>
                  {b}
                </li>
              ))}
            </ul>
            <Link
              href="/registro"
              className={
                p.destacado
                  ? 'mt-6 rounded-lg bg-gradient-to-br from-marca-500 to-marca-600 px-4 py-2.5 text-center font-semibold text-white shadow-lg shadow-marca-600/30'
                  : 'mt-6 rounded-lg border-2 border-marca-300 px-4 py-2.5 text-center font-semibold text-marca-700'
              }
            >
              Comenzar
            </Link>
          </div>
        ))}
      </div>
    </section>
  )
}
```

- [ ] **Step 3: Página de inicio (composición + header/CTA/footer)**

`apps/web/app/page.tsx` (completo):

```tsx
import Link from 'next/link'
import { Hero } from '../componentes/landing/hero'
import { Modulos } from '../componentes/landing/modulos'
import { Precios } from '../componentes/landing/precios'

export default function Inicio() {
  return (
    <main className="mx-auto max-w-6xl">
      <header className="flex items-center justify-between border-b border-slate-100 px-6 py-4 sm:px-10">
        <div className="flex items-center gap-2 font-bold text-slate-900">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-marca-500 to-marca-700 text-sm text-white">
            S
          </span>
          Suite ERP
        </div>
        <nav className="hidden gap-6 text-sm text-slate-600 sm:flex">
          <a href="#modulos">Módulos</a>
          <a href="#precios">Precios</a>
        </nav>
        <div className="flex items-center gap-3 text-sm">
          <Link href="/login" className="font-semibold text-marca-700">
            Iniciar sesión
          </Link>
          <Link
            href="/registro"
            className="rounded-lg bg-gradient-to-br from-marca-500 to-marca-600 px-4 py-2 font-semibold text-white shadow-md shadow-marca-600/30"
          >
            Prueba gratis
          </Link>
        </div>
      </header>

      <Hero />
      <Modulos />
      <Precios />

      <section className="bg-gradient-to-br from-marca-700 via-marca-600 to-cyan-500 px-6 py-14 text-center text-white">
        <h2 className="text-2xl font-bold">Deja las planillas hoy</h2>
        <p className="mt-1 text-marca-100">Crea tu cuenta y emite tu primer documento en menos de 10 minutos.</p>
        <Link href="/registro" className="mt-5 inline-block rounded-lg bg-white px-5 py-2.5 font-semibold text-marca-800">
          Prueba gratis 14 días
        </Link>
      </section>

      <footer className="flex justify-between px-6 py-5 text-sm text-slate-400 sm:px-10">
        <span>© 2026 Suite ERP</span>
        <span>contacto@suite-erp.cl</span>
      </footer>
    </main>
  )
}
```

- [ ] **Step 4: Verificar**

Run: `pnpm --filter web build`
Expected: build sin errores; `/` estática.

- [ ] **Step 5: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/postcss.config.mjs apps/web/app/globals.css apps/web/app/layout.tsx apps/web/app/page.tsx apps/web/componentes
git commit -m "feat(web): landing comercial con Tailwind y paleta viva"
```

---

### Task 3: Dashboard ejecutivo del ERP

**Files:**
- Create: `apps/erp/componentes/kpi.tsx`, `apps/erp/componentes/grafico-barras.tsx`
- Rewrite: `apps/erp/app/page.tsx`

**Interfaces:**
- Consumes: vistas `ventas_diarias`/`ventas_por_producto`/`saldos_documentos`/`stock_actual`, `rangoDeMes`/`estaVencido`/`formatearCLP`/`formatearRut` de `@suite/core`, `obtenerEmpresaActiva`, `Encabezado`/`Insignia`/`Tarjeta` de `@suite/ui`.
- Produces: `Kpi({ etiqueta, valor, sub, tono, href? })` y `GraficoBarras({ dias })` — presentacionales puros.

- [ ] **Step 1: Componentes presentacionales**

`apps/erp/componentes/kpi.tsx`:

```tsx
import Link from 'next/link'

// Clases ESTATICAS por tono (Tailwind no soporta nombres interpolados).
const TONOS = {
  marca: { borde: 'border-l-marca-500', cifra: 'text-slate-900' },
  verde: { borde: 'border-l-emerald-500', cifra: 'text-emerald-600' },
  rojo: { borde: 'border-l-red-500', cifra: 'text-red-600' },
  ambar: { borde: 'border-l-amber-500', cifra: 'text-amber-600' },
} as const

export function Kpi({
  etiqueta,
  valor,
  sub,
  tono,
  href,
}: {
  etiqueta: string
  valor: string
  sub: string
  tono: keyof typeof TONOS
  href?: string
}) {
  const t = TONOS[tono]
  const tarjeta = (
    <div className={`rounded-xl border border-slate-200 border-l-4 bg-white px-4 py-3 ${t.borde}`}>
      <p className="text-xs text-slate-400">{etiqueta}</p>
      <p className={`text-2xl font-bold tabular-nums tracking-tight ${t.cifra}`}>{valor}</p>
      <p className="text-xs text-slate-500">{sub}</p>
    </div>
  )
  return href ? <Link href={href}>{tarjeta}</Link> : tarjeta
}
```

`apps/erp/componentes/grafico-barras.tsx`:

```tsx
export interface DiaBarra {
  etiqueta: string
  monto: number
  titulo: string
  esHoy?: boolean
}

export function GraficoBarras({ dias }: { dias: DiaBarra[] }) {
  const max = Math.max(1, ...dias.map((d) => d.monto))
  const hayVentas = dias.some((d) => d.monto > 0)
  if (!hayVentas) {
    return <p className="py-10 text-center text-sm text-slate-400">Aún sin ventas en los últimos 14 días.</p>
  }
  return (
    <div className="flex h-36 items-end gap-1.5">
      {dias.map((d) => (
        <div key={d.etiqueta} className="flex h-full flex-1 flex-col justify-end" title={d.titulo}>
          <span
            className={
              d.esHoy
                ? 'block min-h-0.5 rounded-t-sm bg-gradient-to-b from-emerald-400 to-emerald-600'
                : 'block min-h-0.5 rounded-t-sm bg-gradient-to-b from-marca-400 to-marca-600'
            }
            style={{ height: `${Math.round((d.monto / max) * 100)}%` }}
          />
          <span className="mt-1 text-center text-[9px] tabular-nums text-slate-400">{d.etiqueta}</span>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Reescribir el dashboard**

`apps/erp/app/page.tsx` (completo):

```tsx
import Link from 'next/link'
import { crearClienteServidor } from '@suite/auth/server'
import { estaVencido, formatearCLP, formatearRut, rangoDeMes } from '@suite/core'
import { Encabezado, Insignia, Tarjeta } from '@suite/ui'
import { GraficoBarras } from '../componentes/grafico-barras'
import { Kpi } from '../componentes/kpi'
import { obtenerEmpresaActiva } from '../lib/empresa-activa'

const RAPIDOS = [
  { href: '/ventas/nueva', titulo: '+ Nueva venta', sub: 'boleta o factura' },
  { href: '/cobranza/pagos/nuevo', titulo: '+ Registrar pago', sub: 'cobranza' },
  { href: '/compras/nueva', titulo: '+ Orden de compra', sub: 'a proveedor' },
  { href: '/inventario/movimientos', titulo: '+ Movimiento', sub: 'entrada / ajuste / traslado' },
]

function fechaUTC(diasAtras: number): string {
  const d = new Date(Date.now() - diasAtras * 24 * 3600 * 1000)
  return d.toISOString().slice(0, 10)
}

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

  const hoy = fechaUTC(0)
  const hace13 = fechaUTC(13)
  const mes = rangoDeMes(hoy.slice(0, 7))!
  const supabase = await crearClienteServidor()

  const [{ data: organizacion }, { data: dias14 }, { data: diasMes }, { data: topMes }, { data: prods }, { data: stockRows }, { data: saldosRows }] =
    await Promise.all([
      supabase
        .from('empresas')
        .select('organizaciones (estado, trial_hasta)')
        .eq('id', activa.id)
        .single()
        .then((r) => ({ data: r.data?.organizaciones ?? null })),
      supabase.from('ventas_diarias').select('fecha, documentos, total').eq('empresa_id', activa.id).gte('fecha', hace13).lte('fecha', hoy),
      supabase.from('ventas_diarias').select('documentos, total').eq('empresa_id', activa.id).gte('fecha', mes.desde).lte('fecha', mes.hasta),
      supabase.from('ventas_por_producto').select('producto_id, descripcion, cantidad, subtotal').eq('empresa_id', activa.id).gte('fecha', mes.desde).lte('fecha', mes.hasta),
      supabase.from('productos').select('id, stock_minimo').eq('empresa_id', activa.id).eq('activo', true),
      supabase.from('stock_actual').select('producto_id, cantidad').eq('empresa_id', activa.id),
      supabase.from('saldos_documentos').select('saldo, fecha_vencimiento').eq('empresa_id', activa.id).gt('saldo', 0),
    ])

  // KPIs de ventas.
  const deHoy = (dias14 ?? []).find((d) => d.fecha === hoy)
  const ventasHoy = deHoy?.total ?? 0
  const docsHoy = deHoy?.documentos ?? 0
  const ventasMes = (diasMes ?? []).reduce((s, d) => s + (d.total ?? 0), 0)
  const docsMes = (diasMes ?? []).reduce((s, d) => s + (d.documentos ?? 0), 0)

  // Grafico 14 dias: rellena los dias sin ventas con 0.
  const porFecha = new Map((dias14 ?? []).map((d) => [d.fecha, d.total ?? 0]))
  const dias = Array.from({ length: 14 }, (_, i) => {
    const f = fechaUTC(13 - i)
    const monto = porFecha.get(f) ?? 0
    return { etiqueta: i === 13 ? 'hoy' : f.slice(8), monto, titulo: `${f}: ${formatearCLP(monto)}`, esHoy: i === 13 }
  })

  // Top 5 del mes (mismo reduce del reporte de ventas).
  const porProducto = new Map<string, { descripcion: string; subtotal: number }>()
  for (const l of topMes ?? []) {
    const key = l.producto_id ?? l.descripcion ?? ''
    const acc = porProducto.get(key) ?? { descripcion: l.descripcion ?? '', subtotal: 0 }
    acc.subtotal += l.subtotal ?? 0
    porProducto.set(key, acc)
  }
  const top = [...porProducto.values()].sort((a, b) => b.subtotal - a.subtotal).slice(0, 5)
  const maxTop = Math.max(1, ...top.map((t) => t.subtotal))

  // Stock critico y vencido (logica existente conservada).
  const totalPorProd = new Map<string, number>()
  for (const s of stockRows ?? []) {
    if (!s.producto_id) continue
    totalPorProd.set(s.producto_id, (totalPorProd.get(s.producto_id) ?? 0) + (s.cantidad ?? 0))
  }
  const criticos = (prods ?? []).filter((p) => (totalPorProd.get(p.id) ?? 0) <= p.stock_minimo).length
  const vencidos = (saldosRows ?? []).filter((s) => estaVencido(s.fecha_vencimiento, hoy, s.saldo ?? 0))
  const montoVencido = vencidos.reduce((s, v) => s + (v.saldo ?? 0), 0)

  return (
    <div>
      <Encabezado titulo={activa.razon_social}>
        <span className="text-sm text-slate-500">{formatearRut(activa.rut)}</span>
      </Encabezado>

      {organizacion?.estado === 'trial' && (
        <div className="mb-6">
          <Insignia tono="amarillo">
            Período de prueba hasta el {new Date(organizacion.trial_hasta + 'T00:00:00').toLocaleDateString('es-CL')}
          </Insignia>
        </div>
      )}
      {organizacion?.estado === 'suspendida' && (
        <div className="mb-6">
          <Insignia tono="rojo">Organización suspendida. Contáctanos para reactivarla.</Insignia>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi etiqueta="Ventas de hoy" valor={formatearCLP(ventasHoy)} sub={`${docsHoy} documento${docsHoy === 1 ? '' : 's'}`} tono="verde" href="/reportes/ventas" />
        <Kpi etiqueta="Ventas del mes" valor={formatearCLP(ventasMes)} sub={`${docsMes} documento${docsMes === 1 ? '' : 's'}`} tono="marca" href="/reportes/ventas" />
        <Kpi etiqueta="Por cobrar vencido" valor={formatearCLP(montoVencido)} sub={`${vencidos.length} documento${vencidos.length === 1 ? '' : 's'} → Cobranza`} tono="rojo" href="/cobranza?vencidas=1" />
        <Kpi etiqueta="Stock crítico" valor={String(criticos)} sub="bajo mínimo → Productos" tono="ambar" href="/productos" />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[1.5fr_1fr]">
        <Tarjeta>
          <h2 className="mb-3 text-sm font-medium text-slate-600">Ventas últimos 14 días</h2>
          <GraficoBarras dias={dias} />
        </Tarjeta>
        <Tarjeta>
          <h2 className="mb-3 text-sm font-medium text-slate-600">Top 5 productos del mes</h2>
          {top.length === 0 && <p className="py-8 text-center text-sm text-slate-400">Aún sin ventas este mes.</p>}
          <div className="space-y-2.5">
            {top.map((t) => (
              <div key={t.descripcion} className="text-sm">
                <div className="mb-0.5 flex justify-between">
                  <span className="font-medium text-slate-800">{t.descripcion}</span>
                  <span className="tabular-nums text-slate-500">{formatearCLP(t.subtotal)}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <span
                    className="block h-full rounded-full bg-gradient-to-r from-cyan-400 to-marca-600"
                    style={{ width: `${Math.round((t.subtotal / maxTop) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Tarjeta>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {RAPIDOS.map((r) => (
          <Link key={r.href} href={r.href} className="rounded-xl border-2 border-dashed border-marca-300 bg-white p-3 text-center">
            <span className="font-semibold text-marca-600">{r.titulo}</span>
            <span className="block text-xs text-slate-400">{r.sub}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Verificar**

Run: `pnpm --filter erp build`
Expected: build sin errores.

- [ ] **Step 4: Commit**

```bash
git add apps/erp/app/page.tsx apps/erp/componentes/kpi.tsx apps/erp/componentes/grafico-barras.tsx
git commit -m "feat(erp): dashboard ejecutivo con KPIs, gráfico de 14 días y top de productos"
```

---

### Task 4: Pipeline + verificación integral ligera

**Files:** ninguno de producción (script en scratchpad, se borra al final).

- [ ] **Step 1: Pipeline**

Run: `pnpm test` — Expected: core 69, auth 2, dte 10 (sin cambios — no hay lógica nueva).
Run: `pnpm supabase test db` — Expected: **88 asserts** verdes (sin SQL nuevo).
Run: `pnpm build --concurrency=1` — Expected: 3 apps compilan.

- [ ] **Step 2: E2E ligero (script Node en scratchpad)**

1. Fetch `http://localhost:3000/` → 200 y el HTML contiene `facturación SII`, `$49.990`, `Más elegido` y `Deja las planillas hoy`.
2. Fetch `http://localhost:3001/` sin sesión → 307 (guard intacto).
3. Con la demo sembrada, verificación de datos del dashboard vía las MISMAS queries del page (como usuario authenticated con `@supabase/supabase-js`): `ventas_diarias` del mes y `ventas_por_producto` devuelven filas coherentes (si la demo tiene facturas, ventasMes > 0). Nota: el render visual con sesión queda para la verificación del controlador con Playwright en la demo.
4. Borrar el script.

- [ ] **Step 3: Reporte**

Escribir `.superpowers/sdd/task-4-rediseno-report.md` con salidas y `git status` limpio. Nota: screenshots con Playwright (landing + dashboard logueado) los toma el CONTROLADOR tras el merge, en la demo.

---

## Verificación final del plan

- `pnpm test` (81) + `pnpm supabase test db` (88) + `pnpm build` (3 apps) verdes.
- Landing: header/hero/módulos/precios/CTA/footer con la paleta viva, responsive, copy exacto de la maqueta.
- Dashboard: 4 KPIs con semáforo, gráfico 14 días (hoy en verde), top 5 con barras, 4 accesos rápidos, banners conservados.
- Toda la app luce el azul eléctrico vía tokens.
- Criterio de éxito del spec §9 cumplido.
