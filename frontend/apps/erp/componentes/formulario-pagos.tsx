'use client'

import { useActionState, useState } from 'react'
import { Boton, Campo, Entrada, Insignia, Tarjeta } from '@suite/ui'
import type { EstadoForm } from '../app/tipos'

export function FormularioPagos({
  accion,
  configurado,
  webhookUrl,
}: {
  accion: (prev: EstadoForm, formData: FormData) => Promise<EstadoForm>
  configurado: boolean
  webhookUrl: string
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoForm)
  const [copiado, setCopiado] = useState(false)

  async function copiar() {
    try {
      await navigator.clipboard.writeText(webhookUrl)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch {
      // El navegador puede bloquear el portapapeles (sin https/permiso): el usuario copia a mano.
    }
  }

  return (
    <Tarjeta className="max-w-2xl">
      <div className="mb-4 flex items-center gap-2">
        <span className="text-sm font-medium text-slate-700">Estado:</span>
        {configurado ? <Insignia tono="verde">Configurado</Insignia> : <Insignia tono="amarillo">Sin configurar</Insignia>}
      </div>
      <form action={enviar} className="grid grid-cols-1 gap-4">
        <Campo etiqueta="Access Token de MercadoPago *">
          <Entrada name="mp_access_token" type="password" required autoComplete="off" />
        </Campo>
        <Campo etiqueta="Clave secreta del webhook *">
          <Entrada name="mp_webhook_secret" type="password" required autoComplete="off" />
        </Campo>
        <div className="flex items-center justify-end gap-2">
          {estado.error && <span className="mr-auto text-sm text-red-600">{estado.error}</span>}
          <Boton type="submit" disabled={pendiente}>{pendiente ? 'Guardando…' : 'Guardar credenciales'}</Boton>
        </div>
      </form>
      <p className="mt-2 text-xs text-slate-500">
        Las credenciales se guardan cifradas y solo se usan en el servidor al cobrar. Nunca se muestran ni se descargan.
      </p>
      <div className="mt-6 border-t border-slate-200 pt-4">
        <span className="mb-1 block text-sm font-medium text-slate-700">URL del webhook (pégala en tu cuenta de MercadoPago)</span>
        <div className="flex items-center gap-2">
          <code className="flex-1 overflow-x-auto rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-800">{webhookUrl}</code>
          <Boton type="button" variante="secundario" onClick={copiar}>{copiado ? 'Copiado' : 'Copiar'}</Boton>
        </div>
      </div>
    </Tarjeta>
  )
}
