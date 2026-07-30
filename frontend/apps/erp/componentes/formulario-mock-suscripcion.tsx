'use client'

import { useActionState } from 'react'
import { Boton } from '@suite/ui'
import type { EstadoMockSuscripcion } from '../app/mock-pago-suscripcion/[id]/acciones'

// Botón único del simulador: ambos métodos (MP y Webpay) submitan una Server Action que en
// ÉXITO REDIRIGE (MP → /configuracion/suscripcion; Webpay → el retorno síncrono), así que aquí
// solo se muestran errores. El pagoId viaja oculto; la etiqueta la fija la page según ?metodo=.
export function FormularioMockSuscripcion({
  accion,
  pagoId,
  etiqueta,
}: {
  accion: (prev: EstadoMockSuscripcion, formData: FormData) => Promise<EstadoMockSuscripcion>
  pagoId: string
  etiqueta: string
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoMockSuscripcion)

  return (
    <form action={enviar}>
      <input type="hidden" name="pago_id" value={pagoId} />
      <Boton type="submit" disabled={pendiente}>
        {pendiente ? 'Procesando…' : etiqueta}
      </Boton>
      {estado.error && <p className="mt-2 text-sm text-red-600">{estado.error}</p>}
    </form>
  )
}
