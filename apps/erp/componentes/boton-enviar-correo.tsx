'use client'

import { useActionState } from 'react'
import { Boton } from '@suite/ui'
import type { EstadoCorreo, EstadoRecordatorios } from '../app/correo/acciones'

function fmtFecha(iso: string): string {
  return new Date(iso).toLocaleDateString('es-CL')
}

// Botón de los 3 detalles (cotización/proforma/venta). Muestra el último envío como PROP
// (query a correos_enviados en la page); tras enviar, revalidatePath refresca la page y el
// prop se actualiza solo.
export function BotonEnviarCorreo({
  accion,
  id,
  ultimoEnvio,
}: {
  accion: (prev: EstadoCorreo, formData: FormData) => Promise<EstadoCorreo>
  id: string
  ultimoEnvio: { para: string; fecha: string } | null
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoCorreo)
  return (
    <form action={enviar} className="flex flex-col gap-1">
      <input type="hidden" name="id" value={id} />
      <div className="flex items-center gap-2">
        <Boton variante="secundario" type="submit" disabled={pendiente}>
          {pendiente ? 'Enviando…' : 'Enviar por correo'}
        </Boton>
        {estado.error && <span className="text-xs text-red-600">{estado.error}</span>}
        {estado.ok && !estado.error && <span className="text-xs text-green-700">Correo enviado.</span>}
      </div>
      {ultimoEnvio && (
        <span className="text-xs text-slate-500">Enviado el {fmtFecha(ultimoEnvio.fecha)} a {ultimoEnvio.para}</span>
      )}
    </form>
  )
}

// Recordatorio individual por factura vencida (/cobranza).
export function BotonRecordar({
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
        {pendiente ? '…' : 'Recordar'}
      </Boton>
      {estado.error && <span className="text-xs text-red-600">{estado.error}</span>}
      {estado.ok && !estado.error && <span className="text-xs text-green-700">Enviado</span>}
    </form>
  )
}

// Recordatorio masivo + banner con el resumen {enviados, omitidos}.
export function BotonRecordarTodas({
  accion,
}: {
  accion: (prev: EstadoRecordatorios, formData: FormData) => Promise<EstadoRecordatorios>
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoRecordatorios)
  const conResumen = estado.enviados !== undefined || estado.omitidos !== undefined
  return (
    <div className="flex flex-col gap-2">
      <form action={enviar}>
        <Boton type="submit" disabled={pendiente}>
          {pendiente ? 'Enviando recordatorios…' : 'Recordar todas las vencidas'}
        </Boton>
      </form>
      {estado.error && <p className="text-sm text-red-600">{estado.error}</p>}
      {conResumen && !estado.error && (
        <p className="text-sm text-slate-600">
          Recordatorios enviados: <strong>{estado.enviados ?? 0}</strong>. Omitidos (sin correo o recordados hace menos de 3 días): <strong>{estado.omitidos ?? 0}</strong>.
        </p>
      )}
    </div>
  )
}
