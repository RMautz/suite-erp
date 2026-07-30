'use client'

import { useActionState, useState } from 'react'
import { Boton } from '@suite/ui'
import type { EstadoForm } from '../app/tipos'

export function BotonEliminarCosto({
  id,
  accion,
}: {
  id: string
  accion: (prev: EstadoForm, formData: FormData) => Promise<EstadoForm>
}) {
  const [abierto, setAbierto] = useState(false)
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoForm)
  if (!abierto) {
    return <Boton variante="secundario" type="button" className="px-2 py-1 text-xs" onClick={() => setAbierto(true)}>Eliminar</Boton>
  }
  return (
    <form action={enviar} className="flex items-center justify-end gap-2">
      <input type="hidden" name="id" value={id} />
      <Boton variante="secundario" type="submit" disabled={pendiente} className="px-2 py-1 text-xs">{pendiente ? '…' : '¿Eliminar?'}</Boton>
      <Boton variante="secundario" type="button" className="px-2 py-1 text-xs" onClick={() => setAbierto(false)}>No</Boton>
      {estado.error && <span className="text-xs text-red-600">{estado.error}</span>}
    </form>
  )
}
