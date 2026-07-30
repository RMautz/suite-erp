'use client'

import { useActionState } from 'react'
import { Boton, Campo, Entrada, Tarjeta } from '@suite/ui'
import type { EstadoForm } from '../app/tipos'

// Los días hábiles los ingresa el usuario (no se calculan de desde/hasta):
// feriados y medios días quedan a su criterio — spec §2.3.
export function FormularioVacaciones({
  accion,
  trabajadorId,
}: {
  accion: (prev: EstadoForm, formData: FormData) => Promise<EstadoForm>
  trabajadorId: string
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoForm)
  return (
    <Tarjeta className="max-w-2xl">
      <form action={enviar} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <input type="hidden" name="trabajador_id" value={trabajadorId} />
        <Campo etiqueta="Desde *">
          <Entrada name="desde" type="date" required />
        </Campo>
        <Campo etiqueta="Hasta *">
          <Entrada name="hasta" type="date" required />
        </Campo>
        <Campo etiqueta="Días hábiles *">
          <Entrada name="dias_habiles" inputMode="numeric" placeholder="5" required />
        </Campo>
        <Campo etiqueta="Comentario">
          <Entrada name="comentario" />
        </Campo>
        <div className="flex items-center justify-end gap-2 sm:col-span-2">
          {estado.error && <span className="mr-auto text-sm text-red-600">{estado.error}</span>}
          <Boton type="submit" disabled={pendiente}>
            {pendiente ? 'Registrando…' : 'Registrar vacaciones'}
          </Boton>
        </div>
      </form>
    </Tarjeta>
  )
}
