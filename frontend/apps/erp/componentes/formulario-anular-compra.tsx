'use client'

import { useActionState, useState } from 'react'
import { Boton, Entrada } from '@suite/ui'
import { anularFacturaCompra } from '../app/por-pagar/acciones'
import type { EstadoForm } from '../app/tipos'

export function FormularioAnularCompra({ documentoId }: { documentoId: string }) {
  const [abierto, setAbierto] = useState(false)
  const [estado, enviar, pendiente] = useActionState(anularFacturaCompra, {} as EstadoForm)
  if (!abierto) {
    return <Boton variante="secundario" type="button" className="px-2 py-1 text-xs" onClick={() => setAbierto(true)}>Anular</Boton>
  }
  return (
    <form action={enviar} className="flex items-center gap-2">
      <input type="hidden" name="documento_id" value={documentoId} />
      <Entrada name="motivo" placeholder="Motivo *" required className="w-40 text-xs" />
      <Boton variante="secundario" type="submit" disabled={pendiente} className="px-2 py-1 text-xs">{pendiente ? '…' : 'Confirmar'}</Boton>
      {estado.error && <span className="text-xs text-red-600">{estado.error}</span>}
    </form>
  )
}
