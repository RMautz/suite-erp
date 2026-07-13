'use client'

import { useActionState } from 'react'
import { Boton, Campo, Entrada, Tarjeta } from '@suite/ui'
import type { EstadoForm } from '../app/tipos'

export function FormularioCertificado({
  accion,
}: {
  accion: (prev: EstadoForm, formData: FormData) => Promise<EstadoForm>
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoForm)
  return (
    <Tarjeta className="max-w-2xl">
      <form action={enviar} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Campo etiqueta="Certificado (.pfx) *">
          <input type="file" name="certificado" accept=".pfx,.p12" required className="text-sm" />
        </Campo>
        <Campo etiqueta="Contraseña del certificado *">
          <Entrada name="certificado_password" type="password" required />
        </Campo>
        <div className="sm:col-span-2">
          <Campo etiqueta="API key del proveedor DTE (SimpleAPI) *">
            <Entrada name="dte_api_key" required />
          </Campo>
        </div>
        <div className="flex items-center justify-end gap-2 sm:col-span-2">
          {estado.error && <span className="mr-auto text-sm text-red-600">{estado.error}</span>}
          <Boton type="submit" disabled={pendiente}>{pendiente ? 'Cargando…' : 'Cargar certificado'}</Boton>
        </div>
      </form>
      <p className="mt-2 text-xs text-slate-500">
        El certificado se guarda cifrado y solo se usa en el servidor al emitir. Nunca se muestra ni se descarga.
      </p>
    </Tarjeta>
  )
}
