'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { armarReferenciaSuscripcion, pasarelaSuscripciones, webpaySuscripciones } from '@suite/pagos'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'

// Estado de la action (tipos permitidos en un archivo 'use server': se borran al
// compilar). `webpay` viaja al client component para el auto-POST con token_ws.
export type EstadoPagoSuscripcion = { error?: string; webpay?: { url: string; token: string } }

const NO_DISPONIBLE = 'Los pagos de suscripción no están disponibles todavía'

export async function pagarSuscripcion(
  _prev: EstadoPagoSuscripcion,
  formData: FormData,
): Promise<EstadoPagoSuscripcion> {
  // El método lo trae el botón submit (name="metodo").
  const metodo = String(formData.get('metodo') ?? '')
  if (metodo !== 'mercadopago' && metodo !== 'webpay') return { error: 'Método de pago no soportado' }

  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una organización activa' }

  // Config de PLATAFORMA validada ANTES de la RPC (para no dejar filas `pendiente`
  // huérfanas). Fail-closed: solo 'mock' | 'real'; en 'real' el credencial del
  // método elegido debe existir (los selectores no exigen token no vacío).
  const perilla = process.env.PASARELA_SUSCRIPCIONES
  if (perilla !== 'mock' && perilla !== 'real') return { error: NO_DISPONIBLE }
  if (perilla === 'real') {
    // MP real necesita el access token Y el webhook secret (sin secret el webhook no verifica
    // firma → la confirmación quedaría solo en el retorno-mp; se exige antes de crear el pago).
    if (metodo === 'mercadopago' && (!process.env.MP_PLATAFORMA_ACCESS_TOKEN || !process.env.MP_PLATAFORMA_WEBHOOK_SECRET)) return { error: NO_DISPONIBLE }
    // Webpay real exige también un ambiente válido: webpaySuscripciones lanzaría DESPUÉS
    // de la RPC (pendiente huérfano + excepción cruda en vez de banner).
    if (
      metodo === 'webpay' &&
      (!process.env.TBK_COMMERCE_CODE ||
        !process.env.TBK_API_KEY ||
        (process.env.TBK_AMBIENTE !== 'integracion' && process.env.TBK_AMBIENTE !== 'produccion'))
    ) return { error: NO_DISPONIBLE }
  }

  const supabase = await crearClienteServidor()

  // Datos para armar la preferencia/transacción: razón social (título) y precio del
  // plan (monto). Leer no crea filas. ponytail: el monto autoritativo lo copia la
  // RPC desde planes.precio_clp bajo lock; este es el MISMO valor (precio estable).
  // Si difiriera, confirmar_pago_suscripcion mandaría el pago a 'revision', nunca
  // extendería con un monto equivocado.
  const { data: org } = await supabase
    .from('organizaciones')
    .select('razon_social, planes (nombre, precio_clp)')
    .eq('id', activa.organizacion_id)
    .single()
  const plan = org?.planes
  if (!org || !plan) return { error: 'La organización no tiene un plan asignado' }
  const monto = plan.precio_clp

  // RPC: valida rol/plan/monto y genera el buy_order (no enumerable) DENTRO de BD.
  const { data: creado, error: eCrear } = await supabase.rpc('crear_pago_suscripcion', {
    p_organizacion: activa.organizacion_id,
    p_pasarela: metodo,
  })
  if (eCrear) return { error: eCrear.message }
  const { id: pagoId, buy_order: buyOrder } = creado as { id: string; buy_order: string }

  // Modo mock: NO se crea preferencia ni transacción real. Se redirige DIRECTO al simulador
  // local (id = pagoId), que registra el pago aprobado (MP → webhook) o siembra el store de
  // MockWebpay y va al retorno (Webpay). Así el contrato del simulador es uno solo y
  // MockPasarela.crearPreferencia del Plan 13 (url /mock-pago) jamás entra en este flujo.
  if (perilla === 'mock') {
    redirect(`/mock-pago-suscripcion/${pagoId}?metodo=${metodo}`)
  }

  const h = await headers()
  const host = h.get('host') ?? ''
  const proto = h.get('x-forwarded-proto') ?? 'https'
  const origin = `${proto}://${host}`

  if (metodo === 'mercadopago') {
    const pasarela = pasarelaSuscripciones(perilla, process.env.MP_PLATAFORMA_ACCESS_TOKEN ?? '')
    const pref = await pasarela.crearPreferencia({
      titulo: `Suscripción ${plan.nombre} — ${org.razon_social}`,
      monto,
      externalReference: armarReferenciaSuscripcion({ pagoId, buyOrder }),
      // back_url: la segunda vía de confirmación (lookup del payment server-side).
      urlRetorno: `${origin}/api/pagos-suscripcion/retorno-mp`,
      // notification_url POR PREFERENCIA: el webhook de plataforma no depende de
      // configurar la cuenta MP.
      notificationUrl: `${origin}/api/webhooks/suscripciones/mercadopago`,
    })
    redirect(pref.url)
  }

  // Webpay: crear() devuelve {token, url}; el envío es un FORMULARIO AUTO-POST con
  // token_ws oculto (mecanismo canónico de Transbank, no query string). La action
  // no puede auto-postear: devuelve {url, token} y el client component lo hace.
  const webpay = webpaySuscripciones(
    perilla,
    process.env.TBK_COMMERCE_CODE ?? '',
    process.env.TBK_API_KEY ?? '',
    process.env.TBK_AMBIENTE,
  )
  const tx = await webpay.crear({
    buyOrder,
    sessionId: pagoId,
    monto,
    returnUrl: `${origin}/api/pagos-suscripcion/retorno`,
  })
  return { webpay: { url: tx.url, token: tx.token } }
}
