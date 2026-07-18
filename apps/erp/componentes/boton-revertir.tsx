'use client'

import { useActionState, useState } from 'react'
import { Boton, Entrada } from '@suite/ui'
import type { EstadoAsiento } from '../app/contabilidad/asientos/acciones'

export function BotonRevertir({
  asientoId,
  accion,
}: {
  asientoId: string
  accion: (prev: EstadoAsiento, formData: FormData) => Promise<EstadoAsiento>
}) {
  const [abierto, setAbierto] = useState(false)
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoAsiento)
  if (!abierto) {
    return <Boton variante="peligro" type="button" onClick={() => setAbierto(true)}>Revertir asiento</Boton>
  }
  return (
    <form action={enviar} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="asiento_id" value={asientoId} />
      <Entrada name="glosa" placeholder="Motivo de la reversa *" required className="w-72" />
      <Boton variante="peligro" type="submit" disabled={pendiente}>{pendiente ? 'Revirtiendo…' : 'Confirmar reversa'}</Boton>
      <Boton variante="secundario" type="button" onClick={() => setAbierto(false)}>Cancelar</Boton>
      {estado.error && <span className="w-full text-sm text-red-600">{estado.error}</span>}
    </form>
  )
}
