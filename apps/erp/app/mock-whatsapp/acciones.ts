'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { esTelefonoE164 } from '@suite/whatsapp'

export type EstadoMockWhatsApp = { error?: string; ok?: boolean }

// El submit del simulador postea el MISMO shape de Meta al webhook real por HTTP
// (patron simularPago de /mock-pago): firma bypass SOLO en mock, y el flujo completo
// — vinculo, motor, herramientas, log, envio — corre tal cual correria con Meta.
export async function simularEntrante(_prev: EstadoMockWhatsApp, formData: FormData): Promise<EstadoMockWhatsApp> {
  if (process.env.PROVEEDOR_WHATSAPP !== 'mock') return { error: 'El simulador de WhatsApp no está disponible' }
  const telefono = String(formData.get('telefono') ?? '').trim()
  const texto = String(formData.get('texto') ?? '').trim()
  if (!esTelefonoE164(telefono)) return { error: 'Teléfono no válido: usa formato internacional +56...' }
  if (!texto) return { error: 'Escribe un mensaje' }

  const h = await headers()
  const host = h.get('host') ?? 'localhost:3001'
  const proto = h.get('x-forwarded-proto') ?? 'http'
  const cuerpo = JSON.stringify({
    entry: [{ changes: [{ value: { messages: [{ from: telefono.slice(1), type: 'text', text: { body: texto } }] } }] }],
  })
  const respuesta = await fetch(`${proto}://${host}/api/webhooks/whatsapp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: cuerpo,
    cache: 'no-store',
  })
  if (!respuesta.ok) return { error: `El webhook respondió ${respuesta.status}` }
  revalidatePath('/mock-whatsapp')
  return { ok: true }
}
