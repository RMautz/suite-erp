import { clienteAdmin } from '@suite/auth/admin'
import { webpaySuscripciones } from '@suite/pagos'

// Retorno de Webpay Plus (Plan 14, spec §5). Transbank vuelve por POST form-encoded (o el usuario
// refresca → GET); por eso se leen token_ws/TBK_TOKEN/TBK_ORDEN_COMPRA de formData Y de la query.
// EXCLUIDO del middleware (api/pagos-suscripcion): una sesión expirada durante el pago NO debe
// redirigir el retorno a /login — se perdería el token_ws y el commit jamás ocurriría (cargo sin
// confirmar). El commit es la ÚNICA fuente de verdad (jamás confiar en los params para monto/auth).
// INVARIANTE: un token de Webpay se commitea SOLO aquí, en el retorno síncrono — nunca un job
// posterior (Transbank auto-reversa lo no commiteado; un commit tardío crearía un cobro fantasma).

function valor(v: FormDataEntryValue | null | undefined): string | null {
  return typeof v === 'string' && v !== '' ? v : null
}

function redirigir(req: Request, ruta: string): Response {
  return Response.redirect(new URL(ruta, req.url), 303)
}

async function manejar(req: Request): Promise<Response> {
  const q = new URL(req.url).searchParams
  let form: FormData | null = null
  if (req.method === 'POST') {
    try {
      form = await req.formData()
    } catch {
      form = null
    }
  }
  const leer = (k: string) => valor(form?.get(k)) ?? valor(q.get(k))

  const tokenWs = leer('token_ws')
  const tbkToken = leer('TBK_TOKEN')
  const tbkOrden = leer('TBK_ORDEN_COMPRA')

  const admin = clienteAdmin()

  // Sin token_ws: anulación del usuario (TBK_TOKEN) o timeout del formulario (solo TBK_ORDEN_COMPRA).
  // No hubo commit → se aborta el pendiente por su buy_order (abortar_pago_suscripcion solo degrada
  // 'pendiente'; jamás toca un pago ya confirmado).
  if (!tokenWs) {
    if (tbkOrden) {
      const { data: pago } = await admin
        .from('pagos_suscripcion')
        .select('id')
        .eq('buy_order', tbkOrden)
        .maybeSingle()
      if (pago) await admin.rpc('abortar_pago_suscripcion', { p_pago: pago.id })
    } else {
      console.error('retorno webpay: retorno sin token_ws ni orden de compra' + (tbkToken ? ' (TBK_TOKEN presente)' : ''))
    }
    return redirigir(req, '/configuracion/suscripcion?resultado=webpay-abortado')
  }

  // Commit server-to-server (fail-closed por perilla; en 'real' liga a las credenciales de env).
  // Re-commit de un token ya commiteado → Transbank/mock LANZAN → redirect SIN banner: la BD manda
  // (si el pago ya está 'pagado', la idempotencia de la RPC no duplica ni degrada).
  let commit: { autorizado: boolean; buyOrder: string; monto: number }
  try {
    const webpay = webpaySuscripciones(
      process.env.PASARELA_SUSCRIPCIONES,
      process.env.TBK_COMMERCE_CODE ?? '',
      process.env.TBK_API_KEY ?? '',
      process.env.TBK_AMBIENTE,
    )
    commit = await webpay.confirmar(tokenWs)
  } catch (e) {
    console.error('retorno webpay: commit falló o token ya commiteado:', e instanceof Error ? e.message : 'desconocido')
    return redirigir(req, '/configuracion/suscripcion')
  }

  // El commit devuelve el buy_order (el token no está en BD aún): se resuelve el pago por él.
  const { data: pago } = await admin
    .from('pagos_suscripcion')
    .select('id')
    .eq('buy_order', commit.buyOrder)
    .maybeSingle()
  if (!pago) {
    console.error('ALERTA retorno webpay: commit sin pago local para buy_order', commit.buyOrder)
    return redirigir(req, '/configuracion/suscripcion')
  }

  // No autorizado: se aborta el pendiente (jamás confirma dinero no cobrado).
  if (!commit.autorizado) {
    await admin.rpc('abortar_pago_suscripcion', { p_pago: pago.id })
    return redirigir(req, '/configuracion/suscripcion?resultado=webpay-fallido')
  }

  // Autorizado: confirma con el MONTO DEL COMMIT (service_role). Idempotente; 'revision' → ALERTA.
  const { data: resultado, error } = await admin.rpc('confirmar_pago_suscripcion', {
    p_pago: pago.id,
    p_referencia: 'tbk:' + tokenWs,
    p_monto: commit.monto,
  })
  if (error) {
    console.error('retorno webpay: error al confirmar:', error.message)
    return redirigir(req, '/configuracion/suscripcion')
  }
  if (resultado === 'revision') {
    console.error('ALERTA pago suscripción en revisión: monto Webpay no coincide con el registrado:', pago.id)
  }
  return redirigir(req, '/configuracion/suscripcion?resultado=webpay-ok')
}

export async function GET(req: Request): Promise<Response> {
  return manejar(req)
}

export async function POST(req: Request): Promise<Response> {
  return manejar(req)
}
