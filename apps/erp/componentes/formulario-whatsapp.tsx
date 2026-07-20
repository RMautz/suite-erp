'use client'

import { useActionState } from 'react'
import { Boton, Campo, Entrada, Insignia, Tarjeta } from '@suite/ui'
import type { EstadoWhatsApp } from '../app/configuracion/whatsapp/acciones'

type AccionWhatsApp = (prev: EstadoWhatsApp, formData: FormData) => Promise<EstadoWhatsApp>

// Flujo de dos pasos (spec §6): telefono -> "te enviamos un codigo" -> confirmar ->
// Vinculado (telefono + fecha) con Desvincular. Errores de RPC byte-exactos inline.
export function FormularioWhatsApp({
  solicitar,
  confirmar,
  desvincular,
  vinculo,
}: {
  solicitar: AccionWhatsApp
  confirmar: AccionWhatsApp
  desvincular: AccionWhatsApp
  vinculo: { id: string; telefono: string; verificado_en: string | null } | null
}) {
  const [estadoSolicitud, enviarSolicitud, pendienteSolicitud] = useActionState(solicitar, {} as EstadoWhatsApp)
  const [estadoCodigo, enviarCodigo, pendienteCodigo] = useActionState(confirmar, {} as EstadoWhatsApp)
  const [estadoDesvincular, enviarDesvincular, pendienteDesvincular] = useActionState(desvincular, {} as EstadoWhatsApp)

  if (vinculo) {
    return (
      <Tarjeta className="max-w-2xl">
        <div className="mb-4 flex items-center gap-2">
          <span className="text-sm font-medium text-slate-700">Estado:</span>
          <Insignia tono="verde">Vinculado</Insignia>
        </div>
        <p className="text-sm text-slate-700">
          Teléfono <strong>{vinculo.telefono}</strong>
          {vinculo.verificado_en && <> · vinculado el {new Date(vinculo.verificado_en).toLocaleDateString('es-CL')}</>}
        </p>
        <form action={enviarDesvincular} className="mt-4 flex items-center gap-2">
          <input type="hidden" name="vinculo_id" value={vinculo.id} />
          <Boton variante="secundario" type="submit" disabled={pendienteDesvincular}>
            {pendienteDesvincular ? 'Desvinculando…' : 'Desvincular'}
          </Boton>
          {estadoDesvincular.error && <span className="text-sm text-red-600">{estadoDesvincular.error}</span>}
        </form>
      </Tarjeta>
    )
  }

  if (estadoSolicitud.vinculoId && !estadoCodigo.ok) {
    return (
      <Tarjeta className="max-w-2xl">
        <p className="mb-4 text-sm text-slate-700">
          Te enviamos un código por WhatsApp al <strong>{estadoSolicitud.telefono}</strong>. Vence en 10
          minutos. (En modo mock, míralo en <code className="rounded bg-slate-100 px-1">/mock-whatsapp</code>.)
        </p>
        <form action={enviarCodigo} className="grid max-w-xs grid-cols-1 gap-4">
          <input type="hidden" name="vinculo_id" value={estadoSolicitud.vinculoId} />
          <Campo etiqueta="Código de 6 dígitos *">
            <Entrada name="codigo" required autoComplete="one-time-code" inputMode="numeric" maxLength={6} />
          </Campo>
          <div className="flex items-center gap-2">
            <Boton type="submit" disabled={pendienteCodigo}>
              {pendienteCodigo ? 'Confirmando…' : 'Confirmar código'}
            </Boton>
            {estadoCodigo.error && <span className="text-sm text-red-600">{estadoCodigo.error}</span>}
          </div>
        </form>
      </Tarjeta>
    )
  }

  return (
    <Tarjeta className="max-w-2xl">
      <div className="mb-4 flex items-center gap-2">
        <span className="text-sm font-medium text-slate-700">Estado:</span>
        <Insignia tono="amarillo">Sin vincular</Insignia>
      </div>
      <form action={enviarSolicitud} className="grid max-w-xs grid-cols-1 gap-4">
        <Campo etiqueta="Teléfono (formato internacional) *">
          <Entrada name="telefono" required placeholder="+56912345678" />
        </Campo>
        <div className="flex items-center gap-2">
          <Boton type="submit" disabled={pendienteSolicitud}>
            {pendienteSolicitud ? 'Enviando…' : 'Enviar código por WhatsApp'}
          </Boton>
          {estadoSolicitud.error && <span className="text-sm text-red-600">{estadoSolicitud.error}</span>}
        </div>
      </form>
    </Tarjeta>
  )
}
