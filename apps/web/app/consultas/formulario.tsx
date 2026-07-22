'use client'

import { useActionState } from 'react'
import { crearConsulta, type EstadoConsulta } from './acciones'

const inicial: EstadoConsulta = {}

const CLASES_INPUT =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-marca-500 focus:outline-none focus:ring-1 focus:ring-marca-500'

export function FormularioConsulta() {
  const [estado, accion, pendiente] = useActionState(crearConsulta, inicial)
  return (
    <form action={accion} className="grid gap-4">
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">Asunto</span>
        <input name="asunto" required maxLength={200} placeholder="Ej: duda con mi suscripción" className={CLASES_INPUT} />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">Consulta</span>
        <textarea
          name="mensaje"
          required
          maxLength={5000}
          rows={5}
          placeholder="Cuéntanos en qué te ayudamos…"
          className={CLASES_INPUT}
        />
      </label>
      {estado.error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{estado.error}</p>
      )}
      {estado.ok && !estado.error && (
        <p className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          Ticket #{estado.numero} enviado. Te responderemos aquí mismo.
        </p>
      )}
      <button
        type="submit"
        disabled={pendiente}
        className="justify-self-start rounded-lg bg-gradient-to-br from-marca-600 to-marca-700 px-5 py-2.5 font-semibold text-white shadow-lg shadow-marca-600/30 transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pendiente ? 'Enviando…' : 'Enviar consulta'}
      </button>
    </form>
  )
}
