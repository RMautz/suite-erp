import { clienteAdmin } from '@suite/auth/admin'
import { descifrar } from '@suite/dte'
import { pasarelaPorAmbiente, parsearReferencia } from '@suite/pagos'
import { claveCifrado } from '../../../../../lib/cifrado'

// Webhook de MercadoPago POR EMPRESA (Plan 13, spec §5). POST público: MP no trae sesión, y la
// empresa viaja en la URL porque el payload de MP solo trae data.id (fuera de banda). El dinero se
// registra vía service_role (clienteAdmin). Idempotente por mp_payment_id (dentro de la RPC).
//
// Mapeo 200 vs 500 (spec §2, ENUMERADO):
//  200 no-op (MP NO reintenta): empresaId no-uuid; body no parseable o sin data.id; empresa
//      inexistente; empresa sin credenciales; firma inválida o vencida; pago no aprobado; pago
//      inexistente; external_reference malformado o con empresa != URL; validación de la RPC
//      (origen inexistente/ajeno, SQLSTATE P0001).
//  500 (MP reintenta): red/5xx al consultar el pago; fallo de descifrado; error de BD.
// Todo no-op sobre un pago APROBADO emite console.error de ALERTA: un peso aprobado jamás puede
// quedar solo en un log de paso.

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// MP notifica con { data: { id } } en el body (webhooks v2) o ?data.id= en la query (IPN legacy).
function extraerDataId(cuerpo: unknown, url: string): string | null {
  const id = (cuerpo as { data?: { id?: unknown } } | null)?.data?.id
  if (typeof id === 'string' && id !== '') return id
  if (typeof id === 'number') return String(id)
  const qp = new URL(url).searchParams.get('data.id')
  return qp && qp !== '' ? qp : null
}

export async function POST(req: Request, { params }: { params: Promise<{ empresaId: string }> }) {
  const { empresaId } = await params

  // (1) Empresa desde la URL: uuid válido o no-op.
  if (!RE_UUID.test(empresaId)) {
    console.error('webhook mercadopago: empresaId de la URL no es un uuid válido:', empresaId)
    return new Response(null, { status: 200 })
  }

  let cuerpo: unknown = null
  try {
    cuerpo = await req.json()
  } catch {
    cuerpo = null
  }
  const dataId = extraerDataId(cuerpo, req.url)
  if (!dataId) {
    console.error('webhook mercadopago: cuerpo sin data.id para la empresa', empresaId)
    return new Response(null, { status: 200 })
  }

  const admin = clienteAdmin()

  // (2) Credenciales cifradas de ESA empresa (service_role: el endpoint no tiene sesión).
  const { data: emp, error: eEmp } = await admin
    .from('empresas')
    .select('mp_access_token_cifrado, mp_webhook_secret_cifrado')
    .eq('id', empresaId)
    .maybeSingle()
  if (eEmp) {
    console.error('webhook mercadopago: error de BD al cargar credenciales:', eEmp.message)
    return new Response(null, { status: 500 })
  }
  if (!emp) {
    console.error('webhook mercadopago: empresa inexistente:', empresaId)
    return new Response(null, { status: 200 })
  }
  if (!emp.mp_access_token_cifrado || !emp.mp_webhook_secret_cifrado) {
    console.error('webhook mercadopago: empresa sin credenciales de MercadoPago:', empresaId)
    return new Response(null, { status: 200 })
  }

  let token: string
  let secret: string
  try {
    const k = claveCifrado()
    token = descifrar(emp.mp_access_token_cifrado, k).toString('utf8')
    secret = descifrar(emp.mp_webhook_secret_cifrado, k).toString('utf8')
  } catch {
    // Descifrado fallido (clave del servidor mal configurada): transitorio → MP reintenta.
    console.error('webhook mercadopago: fallo al descifrar credenciales de', empresaId)
    return new Response(null, { status: 500 })
  }

  const pasarela = pasarelaPorAmbiente(process.env.PASARELA_PAGOS, token)

  // (3) Firma x-signature (HMAC ts+v1, frescura ±5 min). Inválida o vencida → no-op.
  // req.headers es un Headers de Fetch: sus valores salen por .get(), no por corchete;
  // se arma el objeto plano EncabezadosFirma que verificarFirma indexa.
  if (
    !pasarela.verificarFirma(
      { 'x-signature': req.headers.get('x-signature'), 'x-request-id': req.headers.get('x-request-id') },
      dataId,
      secret,
    )
  ) {
    console.error('webhook mercadopago: firma inválida o vencida para', empresaId)
    return new Response(null, { status: 200 })
  }

  // (4) Consulta el pago con el token de la empresa. Red/5xx → 500 (MP reintenta).
  let pago: { estado: string; monto: number; externalReference: string } | null
  try {
    pago = await pasarela.obtenerPago(dataId)
  } catch (e) {
    console.error('webhook mercadopago: error al consultar el pago:', e instanceof Error ? e.message : 'desconocido')
    return new Response(null, { status: 500 })
  }
  if (!pago) {
    console.error('webhook mercadopago: pago inexistente en MercadoPago:', dataId)
    return new Response(null, { status: 200 })
  }

  // (5) Solo pagos aprobados producen registro.
  if (pago.estado !== 'approved') {
    console.error('webhook mercadopago: pago no aprobado (' + pago.estado + ') para', empresaId)
    return new Response(null, { status: 200 })
  }

  // (6) external_reference DEL PAGO (única fuente). Formato estricto; su empresa == la de la URL.
  const ref = parsearReferencia(pago.externalReference)
  if (!ref) {
    console.error('ALERTA webhook mercadopago: pago APROBADO con external_reference inválido, sin registrar:', empresaId, dataId)
    return new Response(null, { status: 200 })
  }
  if (ref.empresaId !== empresaId) {
    console.error('ALERTA webhook mercadopago: pago APROBADO cuya empresa no coincide con la URL, sin registrar:', empresaId, dataId)
    return new Response(null, { status: 200 })
  }

  // (7) Despacho con el MONTO DEL PAGO (service_role). Factura -> pago; proforma/cotización -> anticipo.
  let eRpc
  if (ref.tipo === 'factura') {
    const { error } = await admin.rpc('registrar_pago_mp', {
      p_empresa: empresaId,
      p_documento: ref.objetoId,
      p_monto: pago.monto,
      p_mp_payment_id: dataId,
      p_link: ref.linkId,
    })
    eRpc = error
  } else {
    const { error } = await admin.rpc('registrar_anticipo_mp', {
      p_empresa: empresaId,
      p_origen_tipo: ref.tipo,
      p_origen: ref.objetoId,
      p_monto: pago.monto,
      p_mp_payment_id: dataId,
      p_link: ref.linkId,
    })
    eRpc = error
  }
  if (eRpc) {
    // Validación de la RPC (origen inexistente/ajeno) = SQLSTATE P0001: permanente -> no-op + alerta.
    if (eRpc.code === 'P0001') {
      console.error('ALERTA webhook mercadopago: pago APROBADO rechazado por la RPC, sin registrar:', empresaId, eRpc.message)
      return new Response(null, { status: 200 })
    }
    // Error de BD/infra: transitorio -> 500 para que MP reintente.
    console.error('webhook mercadopago: error de BD al registrar; MP reintentará:', empresaId, eRpc.message)
    return new Response(null, { status: 500 })
  }

  return new Response(null, { status: 200 })
}
