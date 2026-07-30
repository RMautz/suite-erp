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
