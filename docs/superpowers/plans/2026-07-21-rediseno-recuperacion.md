# Rediseño del flujo de recuperación · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) o subagent-driven-development. Tasks en orden (1→3): T2 usa los componentes de T1; T3 verifica todo.

**Spec:** `docs/superpowers/specs/2026-07-21-rediseno-recuperacion-design.md` (aprobado).

**Goal:** Tarjeta guiada de dos pasos para el flujo de recuperación: badges de ícono SVG, stepper, reenviar con cooldown 60 s, mostrar/ocultar contraseña, medidor de fuerza y éxito animado — sin tocar la seguridad de las actions (anti-enumeración y mensajes intactos).

**Architecture:** Piezas compartidas en `apps/web/componentes/tarjeta-recuperacion.tsx` (MarcoRecuperacion, BadgeIcono, Stepper); `/recuperar` con 3 vistas cliente (form / éxito con cooldown / expirado); `/restablecer` con ojo + fuerza + éxito animado y su action devolviendo `{ ok: true }` en vez de redirect server (la navegación al ERP la hace el cliente tras la animación). Cero dependencias nuevas.

**Tech Stack:** Next 15 App Router (apps/web, sin middleware), Tailwind, SVG inline, CSS keyframes inline.

## Global Constraints

- Mensajes byte-exactos EXISTENTES no cambian: `Ingresa un correo válido` · `La contraseña debe tener al menos 8 caracteres` · `Las contraseñas no coinciden` · `El enlace expiró o no es válido. Pide uno nuevo desde "Recuperar contraseña".` · `La contraseña nueva debe ser distinta a la anterior` · `No se pudo cambiar la contraseña. Inténtalo de nuevo.`
- Anti-enumeración intacta: `solicitarRecuperacion` sigue devolviendo `{ ok: true }` en TODA rama post-validación de formato.
- `/auth/confirm`, login y registro NO se tocan.
- Baseline: `pnpm --filter web build` verde con las mismas rutas; sin BOM; commits español + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Componentes compartidos + rediseño de `/recuperar`

**Files:**
- Create: `apps/web/componentes/tarjeta-recuperacion.tsx`
- Rewrite: `apps/web/app/recuperar/formulario.tsx`
- Modify: `apps/web/app/recuperar/page.tsx` (usa MarcoRecuperacion)
- Sin cambios: `apps/web/app/recuperar/acciones.ts`

**Interfaces (Produces, las consume T2):** `MarcoRecuperacion({ children, pie? })` · `BadgeIcono({ icono: 'sobre'|'candado'|'reloj'|'check', tono?: 'marca'|'verde'|'ambar' })` · `Stepper({ paso: 1|2 })` · `CLASES_INPUT` exportada.

- [ ] **Step 1:** `apps/web/componentes/tarjeta-recuperacion.tsx`:

```tsx
import Link from 'next/link'
import type { ReactNode } from 'react'

// Piezas compartidas de las 5 vistas del flujo de recuperacion (spec §2-3): marco
// (logo + tarjeta + pie), badge de icono por paso y stepper "Paso N de 2".

export const CLASES_INPUT =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-marca-500 focus:outline-none focus:ring-1 focus:ring-marca-500'

export function MarcoRecuperacion({ children, pie }: { children: ReactNode; pie?: ReactNode }) {
  return (
    <main
      className="grid min-h-screen place-items-center bg-slate-50 px-4 py-10"
      style={{ background: 'radial-gradient(900px 420px at 50% -10%, #e0f2fe 0%, rgba(224,242,254,0) 60%), #f8fafc' }}
    >
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-6 block text-center text-2xl font-bold tracking-tight text-slate-900">
          Suite <span className="bg-gradient-to-r from-marca-600 to-cyan-500 bg-clip-text text-transparent">ERP</span>
        </Link>
        <div className="rounded-2xl border border-marca-100 bg-white p-8 shadow-xl shadow-marca-600/10">{children}</div>
        {pie && <p className="mt-6 text-center text-sm text-slate-500">{pie}</p>}
      </div>
    </main>
  )
}

export type IconoRecuperacion = 'sobre' | 'candado' | 'reloj' | 'check'

const FONDOS = {
  marca: 'bg-marca-50 text-marca-600',
  verde: 'bg-green-50 text-green-600',
  ambar: 'bg-amber-50 text-amber-600',
} as const

export function BadgeIcono({ icono, tono = 'marca' }: { icono: IconoRecuperacion; tono?: keyof typeof FONDOS }) {
  return (
    <div className={`mx-auto grid h-14 w-14 place-items-center rounded-full ${FONDOS[tono]}`}>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-7 w-7"
        aria-hidden="true"
      >
        {icono === 'sobre' && (
          <>
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="m3 7 9 6 9-6" />
          </>
        )}
        {icono === 'candado' && (
          <>
            <rect x="5" y="11" width="14" height="9" rx="2" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </>
        )}
        {icono === 'reloj' && (
          <>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </>
        )}
        {icono === 'check' && <path d="m5 13 4 4 10-10" />}
      </svg>
    </div>
  )
}

export function Stepper({ paso }: { paso: 1 | 2 }) {
  return (
    <div className="mb-5 mt-4 flex items-center justify-center gap-2">
      <span className={`h-1.5 w-6 rounded-full ${paso === 1 ? 'bg-marca-600' : 'bg-marca-300'}`} />
      <span className={`h-1.5 w-6 rounded-full ${paso === 2 ? 'bg-marca-600' : 'bg-slate-200'}`} />
      <span className="ml-2 text-xs font-medium text-slate-500">Paso {paso} de 2</span>
    </div>
  )
}
```

- [ ] **Step 2:** Rewrite `apps/web/app/recuperar/formulario.tsx` — 3 vistas con cooldown y corregir:

```tsx
'use client'

import Link from 'next/link'
import { useActionState, useEffect, useState } from 'react'
import { BadgeIcono, CLASES_INPUT, Stepper } from '../../componentes/tarjeta-recuperacion'
import { solicitarRecuperacion, type EstadoRecuperar } from './acciones'

const inicial: EstadoRecuperar = {}

export function FormularioRecuperar({ expirado }: { expirado: boolean }) {
  const [estado, accion, pendiente] = useActionState(solicitarRecuperacion, inicial)
  const [correo, setCorreo] = useState('')
  const [corrigiendo, setCorrigiendo] = useState(false)
  const [restante, setRestante] = useState(0)

  // Cada envio exitoso (incluido el reenvio) reinicia el cooldown de 60 s.
  useEffect(() => {
    if (estado.ok) {
      setCorrigiendo(false)
      setRestante(60)
    }
  }, [estado])
  const contando = restante > 0
  useEffect(() => {
    if (!contando) return
    const t = setInterval(() => setRestante((r) => r - 1), 1000)
    return () => clearInterval(t)
  }, [contando])

  // Vista 2: "Revisa tu correo" (exito del paso 1) con reenviar + corregir.
  if (estado.ok && !corrigiendo) {
    return (
      <div className="text-center">
        <BadgeIcono icono="check" tono="verde" />
        <Stepper paso={1} />
        <h1 className="text-xl font-semibold text-slate-900">Revisa tu correo</h1>
        <p className="mt-2 text-sm text-slate-600">
          Si el correo existe, enviamos un enlace a <strong className="text-slate-800">{correo}</strong>. Vence en una
          hora.
        </p>
        <form action={accion} className="mt-6">
          <input type="hidden" name="email" value={correo} />
          <button
            type="submit"
            disabled={pendiente || restante > 0}
            className="w-full rounded-lg border border-marca-200 px-5 py-2.5 text-sm font-semibold text-marca-700 transition-colors hover:bg-marca-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pendiente ? 'Reenviando…' : restante > 0 ? `Reenviar (${restante} s)` : 'Reenviar enlace'}
          </button>
        </form>
        <button
          type="button"
          onClick={() => setCorrigiendo(true)}
          className="mt-4 text-sm font-medium text-slate-500 hover:text-marca-700 hover:underline"
        >
          ¿Te equivocaste de correo? Corregir
        </button>
      </div>
    )
  }

  // Vista 5: enlace expirado (llega de /auth/confirm) hasta que pida uno nuevo.
  if (expirado && !corrigiendo) {
    return (
      <div className="text-center">
        <BadgeIcono icono="reloj" tono="ambar" />
        <h1 className="mt-4 text-xl font-semibold text-slate-900">El enlace expiró</h1>
        <p className="mt-2 text-sm text-slate-600">
          Los enlaces duran una hora y solo sirven una vez. Pide uno nuevo y usa el correo más reciente.
        </p>
        <button
          type="button"
          onClick={() => setCorrigiendo(true)}
          className="mt-6 w-full rounded-lg bg-gradient-to-br from-marca-600 to-marca-700 px-5 py-2.5 font-semibold text-white shadow-lg shadow-marca-600/30 transition-opacity hover:opacity-95"
        >
          Pedir enlace nuevo
        </button>
      </div>
    )
  }

  // Vista 1: formulario del paso 1.
  return (
    <div>
      <BadgeIcono icono="sobre" />
      <Stepper paso={1} />
      <h1 className="text-center text-xl font-semibold text-slate-900">Recuperar contraseña</h1>
      <p className="mt-1 text-center text-sm text-slate-500">Te enviaremos un enlace para crear una nueva.</p>
      <form action={accion} className="mt-6 grid gap-4">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Correo</span>
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="tu@empresa.cl"
            value={correo}
            onChange={(e) => setCorreo(e.target.value)}
            className={CLASES_INPUT}
          />
        </label>
        {estado.error && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{estado.error}</p>
        )}
        <button
          type="submit"
          disabled={pendiente}
          className="w-full rounded-lg bg-gradient-to-br from-marca-600 to-marca-700 px-5 py-2.5 font-semibold text-white shadow-lg shadow-marca-600/30 transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pendiente ? 'Enviando…' : 'Enviar enlace →'}
        </button>
      </form>
    </div>
  )
}
```

- [ ] **Step 3:** `apps/web/app/recuperar/page.tsx` usa el marco (mismo server component, sin lógica nueva):

```tsx
import Link from 'next/link'
import { MarcoRecuperacion } from '../../componentes/tarjeta-recuperacion'
import { FormularioRecuperar } from './formulario'

// Server component: lee ?expirado=1 (a donde manda /auth/confirm cuando el enlace
// no canjea) y delega las vistas al client component.
export default async function PaginaRecuperar({ searchParams }: { searchParams: Promise<{ expirado?: string }> }) {
  const { expirado = '' } = await searchParams
  return (
    <MarcoRecuperacion
      pie={
        <Link href="/login" className="font-semibold text-marca-700 hover:underline">
          Volver a iniciar sesión
        </Link>
      }
    >
      <FormularioRecuperar expirado={expirado === '1'} />
    </MarcoRecuperacion>
  )
}
```

- [ ] **Step 4:** `pnpm --filter web build` verde → commit:

```bash
git add apps/web
git commit -m "feat(web): tarjeta guiada del paso 1 — badges, stepper, reenviar con cooldown y vista de enlace expirado

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Rediseño de `/restablecer` — ojo, fuerza y éxito animado

**Files:**
- Create: `apps/web/app/restablecer/fuerza.ts`
- Rewrite: `apps/web/app/restablecer/page.tsx`
- Modify: `apps/web/app/restablecer/acciones.ts` (redirect → `{ ok: true }`)

**Interfaces:** `cambiarPassword` ahora `Promise<EstadoRestablecer>` con `EstadoRestablecer = { error?: string; ok?: boolean }` (export type del action); el cliente navega a `process.env.NEXT_PUBLIC_URL_ERP` tras 1,2 s de animación.

- [ ] **Step 1:** `apps/web/app/restablecer/fuerza.ts`:

```ts
// Heuristica de GUIA (spec §2.3): no es el gate — el minimo de 8 lo valida el action.
export type Fuerza = { nivel: 0 | 1 | 2 | 3; etiqueta: '' | 'Débil' | 'Aceptable' | 'Fuerte' }

export function fuerzaPassword(password: string): Fuerza {
  if (password.length === 0) return { nivel: 0, etiqueta: '' }
  if (password.length < 8) return { nivel: 1, etiqueta: 'Débil' }
  const clases = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) => re.test(password)).length
  if (password.length >= 12 && clases >= 3) return { nivel: 3, etiqueta: 'Fuerte' }
  if (clases >= 2) return { nivel: 2, etiqueta: 'Aceptable' }
  return { nivel: 1, etiqueta: 'Débil' }
}
```

- [ ] **Step 2:** En `apps/web/app/restablecer/acciones.ts`: quitar `redirect` (import y llamada), exportar `EstadoRestablecer` y devolver éxito. ANTES (cierre del action):

```ts
  const { error } = await supabase.auth.updateUser({ password })
  if (error) {
    if (error.code === 'same_password') return { error: 'La contraseña nueva debe ser distinta a la anterior' }
    console.error('cambiarPassword:', error.message)
    return { error: 'No se pudo cambiar la contraseña. Inténtalo de nuevo.' }
  }
  redirect(process.env.NEXT_PUBLIC_URL_ERP!)
```

DESPUÉS:

```ts
  const { error } = await supabase.auth.updateUser({ password })
  if (error) {
    if (error.code === 'same_password') return { error: 'La contraseña nueva debe ser distinta a la anterior' }
    console.error('cambiarPassword:', error.message)
    return { error: 'No se pudo cambiar la contraseña. Inténtalo de nuevo.' }
  }
  // El exito lo celebra el cliente (check animado) y navega al ERP (spec §3).
  return { ok: true }
```

Más: eliminar `import { redirect } from 'next/navigation'`, cambiar `import type { EstadoForm } from '../tipos'` por un tipo local exportado `export type EstadoRestablecer = { error?: string; ok?: boolean }` y la firma a `(_prev: EstadoRestablecer, formData: FormData): Promise<EstadoRestablecer>`.

- [ ] **Step 3:** Rewrite `apps/web/app/restablecer/page.tsx`:

```tsx
'use client'

import Link from 'next/link'
import { useActionState, useEffect, useState } from 'react'
import { BadgeIcono, CLASES_INPUT, MarcoRecuperacion, Stepper } from '../../componentes/tarjeta-recuperacion'
import { cambiarPassword, type EstadoRestablecer } from './acciones'
import { fuerzaPassword } from './fuerza'

const inicial: EstadoRestablecer = {}

const COLORES_FUERZA = ['bg-slate-200', 'bg-red-400', 'bg-amber-400', 'bg-green-500']
const TEXTO_FUERZA = ['text-slate-400', 'text-red-600', 'text-amber-600', 'text-green-600']

function CampoPassword({
  name,
  etiqueta,
  valor,
  onChange,
}: {
  name: string
  etiqueta: string
  valor: string
  onChange: (v: string) => void
}) {
  const [visible, setVisible] = useState(false)
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{etiqueta}</span>
      <span className="relative block">
        <input
          name={name}
          type={visible ? 'text' : 'password'}
          required
          minLength={8}
          autoComplete="new-password"
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          className={`${CLASES_INPUT} pr-10`}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
          className="absolute inset-y-0 right-0 grid w-10 place-items-center text-slate-400 hover:text-slate-600"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
            {visible ? (
              <>
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
                <circle cx="12" cy="12" r="3" />
                <path d="m4 4 16 16" />
              </>
            ) : (
              <>
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
                <circle cx="12" cy="12" r="3" />
              </>
            )}
          </svg>
        </button>
      </span>
    </label>
  )
}

export default function PaginaRestablecer() {
  const [estado, accion, pendiente] = useActionState(cambiarPassword, inicial)
  const [password, setPassword] = useState('')
  const [confirmar, setConfirmar] = useState('')
  const fuerza = fuerzaPassword(password)

  // Check animado 1,2 s y recien ahi entra al ERP (spec §2.4).
  useEffect(() => {
    if (!estado.ok) return
    const t = setTimeout(() => window.location.assign(process.env.NEXT_PUBLIC_URL_ERP!), 1200)
    return () => clearTimeout(t)
  }, [estado.ok])

  if (estado.ok) {
    return (
      <MarcoRecuperacion>
        <style>{'@keyframes exito-pop{0%{transform:scale(.5);opacity:0}70%{transform:scale(1.08)}100%{transform:scale(1);opacity:1}}'}</style>
        <div className="text-center" style={{ animation: 'exito-pop .45s ease-out' }}>
          <BadgeIcono icono="check" tono="verde" />
          <h1 className="mt-4 text-xl font-semibold text-slate-900">Contraseña actualizada</h1>
          <p className="mt-2 text-sm text-slate-600">Entrando a tu ERP…</p>
        </div>
      </MarcoRecuperacion>
    )
  }

  return (
    <MarcoRecuperacion
      pie={
        <>
          ¿El enlace expiró?{' '}
          <Link href="/recuperar" className="font-semibold text-marca-700 hover:underline">
            Pide uno nuevo
          </Link>
        </>
      }
    >
      <BadgeIcono icono="candado" />
      <Stepper paso={2} />
      <h1 className="text-center text-xl font-semibold text-slate-900">Nueva contraseña</h1>
      <p className="mt-1 text-center text-sm text-slate-500">Elige una contraseña de al menos 8 caracteres.</p>
      <form action={accion} className="mt-6 grid gap-4">
        <div>
          <CampoPassword name="password" etiqueta="Nueva contraseña" valor={password} onChange={setPassword} />
          <div className="mt-2 flex items-center gap-2">
            <div className="flex flex-1 gap-1">
              {[1, 2, 3].map((tramo) => (
                <span
                  key={tramo}
                  className={`h-1.5 flex-1 rounded-full transition-colors ${fuerza.nivel >= tramo ? COLORES_FUERZA[fuerza.nivel] : 'bg-slate-200'}`}
                />
              ))}
            </div>
            <span className={`w-16 text-right text-xs font-medium ${TEXTO_FUERZA[fuerza.nivel]}`}>{fuerza.etiqueta}</span>
          </div>
        </div>
        <CampoPassword name="confirmar" etiqueta="Repite la contraseña" valor={confirmar} onChange={setConfirmar} />
        {estado.error && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{estado.error}</p>
        )}
        <button
          type="submit"
          disabled={pendiente}
          className="w-full rounded-lg bg-gradient-to-br from-marca-600 to-marca-700 px-5 py-2.5 font-semibold text-white shadow-lg shadow-marca-600/30 transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pendiente ? 'Guardando…' : 'Guardar y entrar'}
        </button>
      </form>
    </MarcoRecuperacion>
  )
}
```

- [ ] **Step 4:** `pnpm --filter web build` verde → commit:

```bash
git add apps/web
git commit -m "feat(web): paso 2 con mostrar/ocultar, medidor de fuerza y éxito animado antes de entrar al ERP

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: E2E de los 5 estados + review

- [ ] **Step 1:** E2E con Playwright MCP (dev servers ya corriendo): (1) /recuperar → badge sobre + stepper; (2) enviar demo@suite-erp.cl → vista éxito con correo en negrita y "Reenviar (NN s)" deshabilitado; "Corregir" vuelve al form; (3) enlace de Mailpit → /restablecer: ojo alterna visibilidad, medidor reacciona (corto→Débil, "Demo12345!"→Fuerte); (4) guardar → check animado → aterriza en ERP; (5) /auth/confirm sin code → vista expirado con botón "Pedir enlace nuevo". Restaurar `demo1234` (script apps/erp/tmp + admin API) y verificar login.
- [ ] **Step 2:** Review de subagente (diff completo del rediseño) — regresiones de seguridad (anti-enumeración, mensajes, navegación del éxito) y calidad visual del código.
- [ ] **Step 3:** Fixes si los hay → push a origin/master.

## Seams abiertos

1. El cooldown de 60 s es solo del cliente (recargar la página lo salta); GoTrue rate-limita por su lado — suficiente para UX, no es control de abuso.
2. `estado.ok` de `useActionState` persiste: tras "Corregir" y reenviar, la vista éxito reaparece con el cooldown reiniciado (deseado).
3. El medidor de fuerza es heurístico local (sin zxcvbn): guía, no gate.
