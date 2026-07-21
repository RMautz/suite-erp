'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { solicitarRecuperacion, type EstadoRecuperar } from './acciones'

const inicial: EstadoRecuperar = {}

const CLASES_INPUT =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-marca-500 focus:outline-none focus:ring-1 focus:ring-marca-500'

export function FormularioRecuperar({ expirado }: { expirado: boolean }) {
  const [estado, accion, pendiente] = useActionState(solicitarRecuperacion, inicial)

  if (estado.ok) {
    return (
      <div className="rounded-2xl border border-marca-100 bg-white p-8 shadow-xl shadow-marca-600/10">
        <h1 className="text-xl font-semibold text-slate-900">Revisa tu correo</h1>
        <p className="mt-2 text-sm text-slate-600">
          Si el correo existe, te enviamos un enlace para restablecer tu contraseña. Vence en una hora.
        </p>
        <p className="mt-4 text-sm text-slate-500">
          ¿No llegó? Revisa el spam o{' '}
          <Link href="/recuperar" className="font-semibold text-marca-700 hover:underline">
            pide otro enlace
          </Link>
          .
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-marca-100 bg-white p-8 shadow-xl shadow-marca-600/10">
      <h1 className="text-xl font-semibold text-slate-900">Recuperar contraseña</h1>
      <p className="mt-1 text-sm text-slate-500">Te enviaremos un enlace para crear una nueva.</p>
      {expirado && (
        <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          El enlace expiró o no es válido. Pide uno nuevo.
        </p>
      )}
      <form action={accion} className="mt-6 grid gap-4">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Correo</span>
          <input name="email" type="email" required autoComplete="email" placeholder="tu@empresa.cl" className={CLASES_INPUT} />
        </label>
        {estado.error && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{estado.error}</p>
        )}
        <button
          type="submit"
          disabled={pendiente}
          className="w-full rounded-lg bg-gradient-to-br from-marca-600 to-marca-700 px-5 py-2.5 font-semibold text-white shadow-lg shadow-marca-600/30 transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pendiente ? 'Enviando…' : 'Enviar enlace'}
        </button>
      </form>
    </div>
  )
}
