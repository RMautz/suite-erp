'use client'

import { useActionState } from 'react'
import type { EstadoRespuesta } from './acciones'

type Accion = (prev: EstadoRespuesta, formData: FormData) => Promise<EstadoRespuesta>

// Responder + cerrar, colapsado en un details para no inflar la bandeja.
export function FormularioRespuesta({
  consultaId,
  responder,
  cerrar,
  estado,
}: {
  consultaId: string
  responder: Accion
  cerrar: Accion
  estado: string
}) {
  const [resp, accionResponder, pendienteR] = useActionState(responder, {} as EstadoRespuesta)
  const [cierre, accionCerrar, pendienteC] = useActionState(cerrar, {} as EstadoRespuesta)

  if (estado === 'cerrada') return null
  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-sm font-semibold text-marca-700 hover:underline">
        {estado === 'respondida' ? 'Editar respuesta / cerrar' : 'Responder'}
      </summary>
      <form action={accionResponder} className="mt-3 grid gap-2">
        <input type="hidden" name="consulta_id" value={consultaId} />
        <textarea
          name="respuesta"
          required
          rows={4}
          maxLength={5000}
          placeholder="Escribe la respuesta para el cliente…"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-marca-500 focus:outline-none focus:ring-1 focus:ring-marca-500"
        />
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={pendienteR}
            className="rounded-lg bg-marca-600 px-4 py-2 text-sm font-semibold text-white hover:bg-marca-700 disabled:opacity-60"
          >
            {pendienteR ? 'Guardando…' : 'Enviar respuesta'}
          </button>
          {resp.error && <span className="text-sm text-red-600">{resp.error}</span>}
          {resp.ok && !resp.error && <span className="text-sm text-green-700">Respondida</span>}
        </div>
      </form>
      <form action={accionCerrar} className="mt-2">
        <input type="hidden" name="consulta_id" value={consultaId} />
        <button type="submit" disabled={pendienteC} className="text-sm font-medium text-slate-500 hover:text-slate-700 hover:underline">
          {pendienteC ? 'Cerrando…' : 'Cerrar consulta'}
        </button>
        {cierre.error && <span className="ml-2 text-sm text-red-600">{cierre.error}</span>}
      </form>
    </details>
  )
}
