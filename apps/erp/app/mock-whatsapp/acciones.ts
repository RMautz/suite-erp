'use server'

import { revalidatePath } from 'next/cache'
import { esTelefonoE164 } from '@suite/whatsapp'
import { postearAlWebhook } from '../../lib/webhook-bot'

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

  const resultado = await postearAlWebhook(telefono, texto)
  if (resultado.error) return { error: resultado.error }
  revalidatePath('/mock-whatsapp')
  return { ok: true }
}
