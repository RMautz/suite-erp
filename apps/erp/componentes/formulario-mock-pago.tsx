'use client'

import { useActionState } from 'react'
import { Boton } from '@suite/ui'
import type { EstadoMockPago } from '../app/mock-pago/[id]/acciones'

export function FormularioMockPago({
  accion,
  preferenciaId,
}: {
  accion: (prev: EstadoMockPago, formData: FormData) => Promise<EstadoMockPago>
  preferenciaId: string
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoMockPago)
  return (
    <form action={enviar}>
      <input type="hidden" name="preferencia_id" value={preferenciaId} />
      {estado.ok ? (
        <p className="text-sm font-medium text-green-700">Pago simulado enviado. Revisa Cobranza.</p>
      ) : (
        <Boton type="submit" disabled={pendiente}>
          {pendiente ? 'Procesando…' : 'Simular pago aprobado'}
        </Boton>
      )}
      {estado.error && <p className="mt-2 text-sm text-red-600">{estado.error}</p>}
    </form>
  )
}
