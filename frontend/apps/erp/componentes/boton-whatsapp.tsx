'use client'

import { useActionState } from 'react'
import { Boton } from '@suite/ui'
import type { EstadoCorreo } from '../app/correo/acciones'

// Espejo de BotonRecordar (canal WhatsApp): la page solo lo muestra en vencidas cuyo
// cliente tiene telefono.
export function BotonWhatsApp({
  accion,
  documentoId,
}: {
  accion: (prev: EstadoCorreo, formData: FormData) => Promise<EstadoCorreo>
  documentoId: string
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoCorreo)
  return (
    <form action={enviar} className="flex items-center gap-2">
      <input type="hidden" name="documento_id" value={documentoId} />
      <Boton variante="secundario" type="submit" disabled={pendiente} className="px-2 py-1 text-xs">
        {pendiente ? '…' : 'WhatsApp'}
      </Boton>
      {estado.error && <span className="text-xs text-red-600">{estado.error}</span>}
      {estado.ok && !estado.error && <span className="text-xs text-green-700">Enviado</span>}
    </form>
  )
}
