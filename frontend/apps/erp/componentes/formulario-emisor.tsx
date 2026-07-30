'use client'

import { useActionState } from 'react'
import { Boton, Campo, Entrada, Tarjeta } from '@suite/ui'
import type { EstadoForm } from '../app/tipos'

export function FormularioEmisor({
  accion,
  inicial,
}: {
  accion: (prev: EstadoForm, formData: FormData) => Promise<EstadoForm>
  inicial: { giro: string; direccion: string; comuna: string; resolucion: number | ''; fecha: string }
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoForm)
  return (
    <Tarjeta className="max-w-2xl">
      <form action={enviar} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Campo etiqueta="Giro *">
          <Entrada name="giro_emisor" defaultValue={inicial.giro} required />
        </Campo>
        <Campo etiqueta="Comuna">
          <Entrada name="comuna_emisor" defaultValue={inicial.comuna} />
        </Campo>
        <div className="sm:col-span-2">
          <Campo etiqueta="Dirección">
            <Entrada name="direccion_emisor" defaultValue={inicial.direccion} />
          </Campo>
        </div>
        <Campo etiqueta="N° Resolución SII">
          <Entrada name="resolucion_sii_numero" inputMode="numeric" defaultValue={inicial.resolucion} />
        </Campo>
        <Campo etiqueta="Fecha Resolución SII">
          <Entrada name="resolucion_sii_fecha" type="date" defaultValue={inicial.fecha} />
        </Campo>
        <div className="flex items-center justify-end gap-2 sm:col-span-2">
          {estado.error && <span className="mr-auto text-sm text-red-600">{estado.error}</span>}
          <Boton type="submit" disabled={pendiente}>{pendiente ? 'Guardando…' : 'Guardar emisor'}</Boton>
        </div>
      </form>
    </Tarjeta>
  )
}
