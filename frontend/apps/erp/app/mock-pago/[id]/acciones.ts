'use server'

import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { clienteAdmin } from '@suite/auth/admin'
import { armarReferencia, registrarPagoMock, CABECERA_FIRMA_MOCK } from '@suite/pagos'

// Estado type-only de la action (permitido en un archivo 'use server': los tipos se borran).
export type EstadoMockPago = { ok?: boolean; error?: string }

export async function simularPago(_prev: EstadoMockPago, formData: FormData): Promise<EstadoMockPago> {
  // Defensa en profundidad: el simulador solo existe en modo mock (la page ya hace notFound()).
  if (process.env.PASARELA_PAGOS !== 'mock') return { error: 'El simulador de pagos no está disponible' }

  const preferenciaId = String(formData.get('preferencia_id') ?? '')
  // El pagador no tiene sesión: admin (service_role) para leer el link por su preferencia.
  const admin = clienteAdmin()
  const { data: link } = await admin
    .from('links_pago')
    .select('id, empresa_id, origen_tipo, origen_id, monto')
    .eq('preferencia_id', preferenciaId)
    .maybeSingle()
  if (!link) return { error: 'No se encontró el link de pago' }

  // external_reference con el MISMO formato estricto que parsea el webhook (empresa == la de la URL).
  const externalReference = armarReferencia({
    tipo: link.origen_tipo as 'factura' | 'proforma' | 'cotizacion',
    empresaId: link.empresa_id,
    objetoId: link.origen_id,
    linkId: link.id,
  })
  // Id determinista por link: re-simular reusa el MISMO id -> el webhook lo dedup (idempotencia).
  const mpPaymentId = 'mock-pay-' + link.id
  // Store en memoria del mock: que obtenerPago(id) del webhook devuelva este pago aprobado.
  registrarPagoMock({ mpPaymentId, monto: link.monto, externalReference })

  const h = await headers()
  const host = h.get('host') ?? ''
  const proto = h.get('x-forwarded-proto') ?? 'http'
  // POST al webhook REAL de la empresa: ejercita la URL por empresa y todo el flujo (firma incluida).
  let respuesta: Response
  try {
    respuesta = await fetch(`${proto}://${host}/api/webhooks/mercadopago/${link.empresa_id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...CABECERA_FIRMA_MOCK },
      body: JSON.stringify({ data: { id: mpPaymentId } }),
      cache: 'no-store',
    })
  } catch {
    return { error: 'No se pudo contactar el webhook' }
  }
  if (!respuesta.ok) return { error: `El webhook respondió ${respuesta.status}` }
  revalidatePath('/mock-pago/' + preferenciaId)
  return { ok: true }
}
