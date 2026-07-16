'use client'

import { useActionState, useEffect, useRef } from 'react'
import { Boton } from '@suite/ui'
import type { EstadoPagoSuscripcion } from '../app/configuracion/suscripcion/acciones'

export function FormularioPagarSuscripcion({
  accion,
}: {
  accion: (prev: EstadoPagoSuscripcion, formData: FormData) => Promise<EstadoPagoSuscripcion>
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoPagoSuscripcion)
  const formWebpay = useRef<HTMLFormElement>(null)

  // MercadoPago redirige server-side (redirect() en la action). Webpay se envía por
  // FORMULARIO AUTO-POST con token_ws oculto: cuando la action devuelve el token, el
  // form oculto se auto-submitea hacia la URL de la transacción de Transbank.
  useEffect(() => {
    if (estado.webpay) formWebpay.current?.submit()
  }, [estado.webpay])

  return (
    <>
      <form action={enviar} className="flex flex-wrap items-center gap-3">
        <Boton type="submit" name="metodo" value="mercadopago" disabled={pendiente}>
          {pendiente ? 'Redirigiendo…' : 'Pagar 1 mes con MercadoPago'}
        </Boton>
        <Boton type="submit" name="metodo" value="webpay" variante="secundario" disabled={pendiente}>
          {pendiente ? 'Redirigiendo…' : 'Pagar 1 mes con Webpay'}
        </Boton>
        {estado.error && <span className="w-full text-sm text-red-600">{estado.error}</span>}
      </form>

      {estado.webpay && (
        <form ref={formWebpay} method="POST" action={estado.webpay.url} className="hidden">
          <input type="hidden" name="token_ws" value={estado.webpay.token} />
        </form>
      )}
    </>
  )
}
