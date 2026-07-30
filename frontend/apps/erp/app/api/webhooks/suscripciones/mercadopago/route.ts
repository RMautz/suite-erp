import { clienteAdmin } from '@suite/auth/admin'
import { pasarelaSuscripciones, parsearReferenciaSuscripcion, type PasarelaPagos } from '@suite/pagos'

// Webhook de MercadoPago de la PLATAFORMA (Plan 14, spec §5). POST público: MP no trae sesión.
// Una sola "empresa" = la plataforma; credenciales SOLO de env (JAMÁS de BD, a diferencia del
// webhook por-empresa del Plan 13). El dinero se registra vía service_role (clienteAdmin) con la
// RPC idempotente confirmar_pago_suscripcion. Excluido del middleware por el prefijo api/webhooks.
//
// Mapeo 200 vs 500 (spec §5, ENUMERADO):
//  200 no-op (MP NO reintenta): plataforma sin credenciales (env); PASARELA_SUSCRIPCIONES
//      ausente/desconocida (fail-closed); cuerpo sin data.id; firma inválida o vencida; pago no
//      aprobado; pago inexistente; referencia malformada; pago de BD inexistente o buy_order !=
//      referencia; RPC en 'revision' (dinero registrado, alerta); RPC P0001 (pago inexistente).
//  500 (MP reintenta): red/5xx al consultar el pago; error de BD (cargar el pago o confirmar).
// Todo no-op sobre un pago APROBADO emite console.error de ALERTA: un peso aprobado jamás puede
// quedar solo en un log de paso.

// Credenciales de PLATAFORMA SOLO desde env server-side; JAMÁS de BD ni del cliente. Devuelve los
// valores o null — nunca los imprime (fail-closed: sin config, el webhook no procesa).
function cfgPlataforma(): { token: string; secret: string } | null {
  const token = process.env.MP_PLATAFORMA_ACCESS_TOKEN
  const secret = process.env.MP_PLATAFORMA_WEBHOOK_SECRET
  if (!token || !secret) return null
  return { token, secret }
}

// MP notifica con { data: { id } } en el body (webhooks v2) o ?data.id= en la query (IPN legacy).
function extraerDataId(cuerpo: unknown, url: string): string | null {
  const id = (cuerpo as { data?: { id?: unknown } } | null)?.data?.id
  if (typeof id === 'string' && id !== '') return id
  if (typeof id === 'number') return String(id)
  const qp = new URL(url).searchParams.get('data.id')
  return qp && qp !== '' ? qp : null
}

export async function POST(req: Request) {
  // (1) Plataforma configurada (env server-only). Sin config → 200 no-op (config, no dinero aún).
  const cfg = cfgPlataforma()
  if (!cfg) {
    console.error('webhook suscripciones: plataforma sin credenciales de MercadoPago (env)')
    return new Response(null, { status: 200 })
  }

  // (2) data.id del cuerpo (webhooks v2) o de la query (IPN legacy).
  let cuerpo: unknown = null
  try {
    cuerpo = await req.json()
  } catch {
    cuerpo = null
  }
  const dataId = extraerDataId(cuerpo, req.url)
  if (!dataId) {
    console.error('webhook suscripciones: cuerpo sin data.id')
    return new Response(null, { status: 200 })
  }

  // (3) Pasarela por la perilla PROPIA de suscripciones (FAIL-CLOSED: ausente/desconocida → throw).
  let pasarela: PasarelaPagos
  try {
    pasarela = pasarelaSuscripciones(process.env.PASARELA_SUSCRIPCIONES, cfg.token)
  } catch {
    console.error('webhook suscripciones: PASARELA_SUSCRIPCIONES ausente o desconocida; pagos no disponibles')
    return new Response(null, { status: 200 })
  }

  // (4) Firma x-signature (headers PLANOS via .get(); secret de PLATAFORMA). Inválida o vencida → no-op.
  if (
    !pasarela.verificarFirma(
      { 'x-signature': req.headers.get('x-signature'), 'x-request-id': req.headers.get('x-request-id') },
      dataId,
      cfg.secret,
    )
  ) {
    console.error('webhook suscripciones: firma inválida o vencida')
    return new Response(null, { status: 200 })
  }

  // (5) Consulta el pago con el token de la PLATAFORMA. Red/5xx → 500 (MP reintenta).
  let pago: { estado: string; monto: number; externalReference: string } | null
  try {
    pago = await pasarela.obtenerPago(dataId)
  } catch (e) {
    console.error('webhook suscripciones: error al consultar el pago:', e instanceof Error ? e.message : 'desconocido')
    return new Response(null, { status: 500 })
  }
  if (!pago) {
    console.error('webhook suscripciones: pago inexistente en MercadoPago:', dataId)
    return new Response(null, { status: 200 })
  }

  // (6) Solo pagos aprobados producen registro.
  if (pago.estado !== 'approved') {
    console.error('webhook suscripciones: pago no aprobado (' + pago.estado + ')')
    return new Response(null, { status: 200 })
  }

  // (7) external_reference DEL PAGO: "suscripcion:{pagoId}:{buyOrder}" estricto.
  const ref = parsearReferenciaSuscripcion(pago.externalReference)
  if (!ref) {
    console.error('ALERTA webhook suscripciones: pago APROBADO con referencia inválida, sin registrar:', dataId)
    return new Response(null, { status: 200 })
  }

  const admin = clienteAdmin()

  // (8) buy_order de la fila de BD == el de la referencia (consistencia interna; la referencia sola no basta).
  const { data: pagoBd, error: ePago } = await admin
    .from('pagos_suscripcion')
    .select('buy_order')
    .eq('id', ref.pagoId)
    .maybeSingle()
  if (ePago) {
    console.error('webhook suscripciones: error de BD al cargar el pago; MP reintentará:', ePago.message)
    return new Response(null, { status: 500 })
  }
  if (!pagoBd || pagoBd.buy_order !== ref.buyOrder) {
    console.error('ALERTA webhook suscripciones: pago APROBADO cuyo buy_order no coincide, sin registrar:', dataId)
    return new Response(null, { status: 200 })
  }

  // (9) Confirma con el MONTO DEL PAGO (service_role). Idempotente; 'revision' → ALERTA (no extiende).
  const { data: resultado, error: eRpc } = await admin.rpc('confirmar_pago_suscripcion', {
    p_pago: ref.pagoId,
    p_referencia: 'mp:' + dataId,
    p_monto: pago.monto,
  })
  if (eRpc) {
    // Validación de la RPC (pago inexistente) = SQLSTATE P0001: permanente → no-op + alerta.
    if (eRpc.code === 'P0001') {
      console.error('ALERTA webhook suscripciones: pago APROBADO rechazado por la RPC, sin registrar:', eRpc.message)
      return new Response(null, { status: 200 })
    }
    // Error de BD/infra: transitorio → 500 para que MP reintente.
    console.error('webhook suscripciones: error de BD al confirmar; MP reintentará:', eRpc.message)
    return new Response(null, { status: 500 })
  }
  if (resultado === 'revision') {
    console.error('ALERTA pago suscripción en revisión: monto no coincide con el registrado, sin extender:', ref.pagoId)
  }

  return new Response(null, { status: 200 })
}
