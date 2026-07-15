'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { iniciarSesion } from './acciones'
import type { EstadoForm } from '../tipos'

const inicial: EstadoForm = {}

const CLASES_INPUT =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-marca-500 focus:outline-none focus:ring-1 focus:ring-marca-500'

export default function PaginaLogin() {
  const [estado, accion, pendiente] = useActionState(iniciarSesion, inicial)
  return (
    <main
      className="grid min-h-screen place-items-center bg-slate-50 px-4 py-10"
      style={{ background: 'radial-gradient(900px 420px at 50% -10%, #e0f2fe 0%, rgba(224,242,254,0) 60%), #f8fafc' }}
    >
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-6 block text-center text-2xl font-bold tracking-tight text-slate-900">
          Suite <span className="bg-gradient-to-r from-marca-600 to-cyan-500 bg-clip-text text-transparent">ERP</span>
        </Link>
        <div className="rounded-2xl border border-marca-100 bg-white p-8 shadow-xl shadow-marca-600/10">
          <h1 className="text-xl font-semibold text-slate-900">Iniciar sesión</h1>
          <p className="mt-1 text-sm text-slate-500">Bienvenido de vuelta a tu gestión.</p>
          <form action={accion} className="mt-6 grid gap-4">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">Correo</span>
              <input name="email" type="email" required autoComplete="email" placeholder="tu@empresa.cl" className={CLASES_INPUT} />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">Contraseña</span>
              <input name="password" type="password" required autoComplete="current-password" className={CLASES_INPUT} />
            </label>
            {estado.error && (
              <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{estado.error}</p>
            )}
            <button
              type="submit"
              disabled={pendiente}
              className="w-full rounded-lg bg-gradient-to-br from-marca-600 to-marca-700 px-5 py-2.5 font-semibold text-white shadow-lg shadow-marca-600/30 transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pendiente ? 'Entrando…' : 'Entrar'}
            </button>
          </form>
        </div>
        <p className="mt-6 text-center text-sm text-slate-500">
          ¿Aún no tienes cuenta?{' '}
          <Link href="/registro" className="font-semibold text-marca-700 hover:underline">
            Prueba gratis 14 días
          </Link>
        </p>
      </div>
    </main>
  )
}
