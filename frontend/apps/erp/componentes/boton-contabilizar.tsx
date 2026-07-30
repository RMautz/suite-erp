'use client'

import { useActionState } from 'react'
import { Boton } from '@suite/ui'
import type { EstadoContabilizar } from '../app/contabilidad/acciones'

export function BotonContabilizar({
  accion,
}: {
  accion: (prev: EstadoContabilizar, formData: FormData) => Promise<EstadoContabilizar>
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoContabilizar)
  return (
    <form action={enviar} className="flex flex-wrap items-center gap-3">
      <Boton type="submit" disabled={pendiente}>
        {pendiente ? 'Contabilizando…' : 'Contabilizar pendientes'}
      </Boton>
      {estado.error && <span className="text-sm text-red-600">{estado.error}</span>}
      {estado.creados !== undefined && !estado.error && (
        <span className="text-sm text-green-700">
          {estado.creados === 0
            ? 'Todo al día: no había documentos pendientes.'
            : `${estado.creados} asiento${estado.creados === 1 ? '' : 's'} creado${estado.creados === 1 ? '' : 's'}.`}
        </span>
      )}
    </form>
  )
}
