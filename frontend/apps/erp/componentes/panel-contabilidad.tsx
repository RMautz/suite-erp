'use client'

import { useActionState } from 'react'
import { Boton, Tarjeta } from '@suite/ui'
import type { EstadoContabilidad } from '../app/configuracion/modulos/acciones'

export function PanelContabilidad({
  accion,
  activo,
}: {
  accion: (prev: EstadoContabilidad, formData: FormData) => Promise<EstadoContabilidad>
  activo: boolean
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoContabilidad)
  return (
    <Tarjeta className="mt-4 max-w-2xl">
      <form action={enviar} className="grid gap-4">
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            name="modulo_contabilidad"
            defaultChecked={activo}
            className="h-4 w-4 rounded border-slate-300 text-marca-600 focus:ring-marca-500"
          />
          <span className="text-sm font-medium text-slate-700">
            Módulo de contabilidad (plan de cuentas, asientos automáticos y libros)
          </span>
        </label>
        <p className="text-sm text-slate-500">
          Al activarlo se siembra un plan de cuentas chileno y se contabiliza todo el historial
          ya registrado. Apagarlo solo oculta las pantallas: los asientos y las cuentas quedan
          intactos.
        </p>
        <div className="flex items-center justify-end gap-2">
          {estado.error && <span className="mr-auto text-sm text-red-600">{estado.error}</span>}
          {estado.mensaje && <span className="mr-auto text-sm text-green-700">{estado.mensaje}</span>}
          <Boton type="submit" disabled={pendiente}>{pendiente ? 'Guardando…' : 'Guardar contabilidad'}</Boton>
        </div>
      </form>
    </Tarjeta>
  )
}
