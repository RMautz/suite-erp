'use client'

import { useActionState } from 'react'
import { Boton, Campo, Entrada, Tarjeta } from '@suite/ui'
import type { EstadoForm } from '../app/tipos'

export interface BodegaEditable { id?: string; nombre: string; direccion: string }

export function FormularioBodega({
  accion,
  inicial = { nombre: '', direccion: '' },
}: {
  accion: (prev: EstadoForm, formData: FormData) => Promise<EstadoForm>
  inicial?: BodegaEditable
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoForm)
  return (
    <Tarjeta className="max-w-xl">
      <form action={enviar} className="grid grid-cols-1 gap-4">
        {inicial.id && <input type="hidden" name="id" value={inicial.id} />}
        <Campo etiqueta="Nombre *"><Entrada name="nombre" defaultValue={inicial.nombre} required /></Campo>
        <Campo etiqueta="Dirección"><Entrada name="direccion" defaultValue={inicial.direccion} /></Campo>
        <div className="flex items-center justify-end gap-2">
          {estado.error && <span className="mr-auto text-sm text-red-600">{estado.error}</span>}
          <Boton type="submit" disabled={pendiente}>{pendiente ? 'Guardando…' : 'Guardar'}</Boton>
        </div>
      </form>
    </Tarjeta>
  )
}
