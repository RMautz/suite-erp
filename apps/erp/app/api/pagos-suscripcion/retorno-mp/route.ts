import { clienteAdmin } from '@suite/auth/admin'
import { pasarelaSuscripciones, parsearReferenciaSuscripcion, type PasarelaPagos } from '@suite/pagos'

// Retorno de MercadoPago (Plan 14, spec §5): SEGUNDA vía de confirmación. Si el webhook se perdiera,
// un pago approved quedaría cobrado sin acreditar. MP agrega ?payment_id= al back_url; la query
// JAMÁS es fuente de verdad — se consulta el pago server-side con el token de la PLATAFORMA. Mismo
// pipeline que el webhook + RPC idempotente (si el webhook ya confirmó → 'noop', igual redirige ok).
// Cualquier error, falta de payment_id o pago no-approved: redirect a la página SIN confirmar
// (?resultado=mp-pendiente); el webhook es la vía primaria. EXCLUIDO del middleware.

// Token de PLATAFORMA SOLO desde env server-side; sin él no hay segunda vía. Nunca lo imprime.
function tokenPlataforma(): string | null {
  return process.env.MP_PLATAFORMA_ACCESS_TOKEN || null
}

function redirigir(req: Request, ruta: string): Response {
  return Response.redirect(new URL(ruta, req.url), 303)
}

export async function GET(req: Request): Promise<Response> {
  const paymentId = new URL(req.url).searchParams.get('payment_id')
  if (!paymentId) return redirigir(req, '/configuracion/suscripcion?resultado=mp-pendiente')

  const token = tokenPlataforma()
  if (!token) {
    console.error('retorno mp: plataforma sin token de MercadoPago (env)')
    return redirigir(req, '/configuracion/suscripcion?resultado=mp-pendiente')
  }

  let pasarela: PasarelaPagos
  try {
    pasarela = pasarelaSuscripciones(process.env.PASARELA_SUSCRIPCIONES, token)
  } catch {
    console.error('retorno mp: PASARELA_SUSCRIPCIONES ausente o desconocida')
    return redirigir(req, '/configuracion/suscripcion?resultado=mp-pendiente')
  }

  let pago: { estado: string; monto: number; externalReference: string } | null
  try {
    pago = await pasarela.obtenerPago(paymentId)
  } catch (e) {
    console.error('retorno mp: error al consultar el pago:', e instanceof Error ? e.message : 'desconocido')
    return redirigir(req, '/configuracion/suscripcion?resultado=mp-pendiente')
  }
  if (!pago || pago.estado !== 'approved') {
    return redirigir(req, '/configuracion/suscripcion?resultado=mp-pendiente')
  }

  const ref = parsearReferenciaSuscripcion(pago.externalReference)
  if (!ref) {
    console.error('ALERTA retorno mp: pago APROBADO con referencia inválida, sin registrar:', paymentId)
    return redirigir(req, '/configuracion/suscripcion?resultado=mp-pendiente')
  }

  const admin = clienteAdmin()
  const { data: pagoBd } = await admin
    .from('pagos_suscripcion')
    .select('buy_order')
    .eq('id', ref.pagoId)
    .maybeSingle()
  if (!pagoBd || pagoBd.buy_order !== ref.buyOrder) {
    console.error('ALERTA retorno mp: pago APROBADO cuyo buy_order no coincide, sin registrar:', paymentId)
    return redirigir(req, '/configuracion/suscripcion?resultado=mp-pendiente')
  }

  const { data: resultado, error } = await admin.rpc('confirmar_pago_suscripcion', {
    p_pago: ref.pagoId,
    p_referencia: 'mp:' + paymentId,
    p_monto: pago.monto,
  })
  if (error) {
    console.error('retorno mp: error al confirmar:', error.message)
    return redirigir(req, '/configuracion/suscripcion?resultado=mp-pendiente')
  }
  if (resultado === 'revision') {
    console.error('ALERTA pago suscripción en revisión: monto MP no coincide con el registrado:', ref.pagoId)
  }
  return redirigir(req, '/configuracion/suscripcion?resultado=mp-ok')
}
