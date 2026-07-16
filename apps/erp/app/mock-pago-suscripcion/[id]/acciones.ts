'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { clienteAdmin } from '@suite/auth/admin'
import {
  armarReferenciaSuscripcion,
  registrarPagoMock,
  webpaySuscripciones,
  CABECERA_FIRMA_MOCK,
} from '@suite/pagos'

// Estado type-only de la action (permitido en un archivo 'use server': los tipos se borran).
export type EstadoMockSuscripcion = { error?: string }

// Carga el pago por su id (= [id] del simulador = pagoId) con admin (service_role): el
// pagador tiene sesión pero pagos_suscripcion no tiene escritura directa y el lookup no
// depende de ella. Solo modo mock (la page ya hizo notFound() fuera de él).
async function cargarPago(pagoId: string) {
  const admin = clienteAdmin()
  const { data } = await admin
    .from('pagos_suscripcion')
    .select('id, buy_order, monto')
    .eq('id', pagoId)
    .maybeSingle()
  return data
}

// MercadoPago (mock): registra el pago aprobado en el store del mock y dispara el webhook
// REAL de la plataforma con CABECERA_FIRMA_MOCK (ejercita firma + obtenerPago + RPC, vía
// primaria); al confirmar, redirige a la suscripción. La action de la Task 6 en modo mock
// NO crea preferencia: redirige aquí, así MockPasarela.crearPreferencia (url /mock-pago del
// Plan 13) nunca entra en este flujo.
export async function aprobarMpSuscripcion(
  _prev: EstadoMockSuscripcion,
  formData: FormData,
): Promise<EstadoMockSuscripcion> {
  // Defensa en profundidad: el simulador solo existe en modo mock (la page ya hace notFound()).
  if (process.env.PASARELA_SUSCRIPCIONES !== 'mock') return { error: 'El simulador de suscripciones no está disponible' }

  const pagoId = String(formData.get('pago_id') ?? '')
  const pago = await cargarPago(pagoId)
  if (!pago) return { error: 'No se encontró el pago de suscripción' }

  // external_reference con el MISMO formato estricto que parsea el webhook.
  const externalReference = armarReferenciaSuscripcion({ pagoId: pago.id, buyOrder: pago.buy_order })
  // Id determinista por pago: re-simular reusa el MISMO id → el webhook lo dedup (idempotencia).
  const mpPaymentId = 'mock-sub-' + pago.id
  // Store en memoria del mock: que obtenerPago(id) del webhook devuelva este pago aprobado.
  registrarPagoMock({ mpPaymentId, monto: pago.monto, externalReference })

  const h = await headers()
  const host = h.get('host') ?? ''
  const proto = h.get('x-forwarded-proto') ?? 'http'
  let respuesta: Response
  try {
    respuesta = await fetch(`${proto}://${host}/api/webhooks/suscripciones/mercadopago`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...CABECERA_FIRMA_MOCK },
      body: JSON.stringify({ data: { id: mpPaymentId } }),
      cache: 'no-store',
    })
  } catch {
    return { error: 'No se pudo contactar el webhook' }
  }
  if (!respuesta.ok) return { error: `El webhook respondió ${respuesta.status}` }
  redirect('/configuracion/suscripcion?resultado=mp-ok')
}

// Webpay (mock): SIEMBRA el store del MockWebpay llamando crear (token determinista
// 'mock-tbk-' + buyOrder) y redirige al retorno SÍNCRONO con ese token; el retorno commitea
// (MockWebpay.confirmar) y confirma/aborta el pago por su buy_order. En 'mock' el selector
// ignora commerceCode/apiKey/ambiente, así que se pasan valores placeholder.
export async function aprobarWebpaySuscripcion(
  _prev: EstadoMockSuscripcion,
  formData: FormData,
): Promise<EstadoMockSuscripcion> {
  if (process.env.PASARELA_SUSCRIPCIONES !== 'mock') return { error: 'El simulador de suscripciones no está disponible' }

  const pagoId = String(formData.get('pago_id') ?? '')
  const pago = await cargarPago(pagoId)
  if (!pago) return { error: 'No se encontró el pago de suscripción' }

  const h = await headers()
  const host = h.get('host') ?? ''
  const proto = h.get('x-forwarded-proto') ?? 'http'
  const returnUrl = `${proto}://${host}/api/pagos-suscripcion/retorno`
  const webpay = webpaySuscripciones('mock', '', '', 'integracion')
  const { token } = await webpay.crear({ buyOrder: pago.buy_order, sessionId: pago.id, monto: pago.monto, returnUrl })
  redirect('/api/pagos-suscripcion/retorno?token_ws=' + token)
}
