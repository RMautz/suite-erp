import { createHmac, timingSafeEqual } from 'node:crypto'
import type {
  EncabezadosFirma,
  PagoConsultado,
  PasarelaPagos,
  Preferencia,
  SolicitudPreferencia,
} from './tipos'

const BASE = 'https://api.mercadopago.com'
const FRESCURA_MS = 5 * 60 * 1000

// Adaptador de MercadoPago Checkout Pro. El access token llega DESCIFRADO por el
// constructor (nunca lo lee del entorno). `ahora` es inyectable SOLO para que los
// tests fijen la ventana de frescura de la firma; en producción es Date.now.
export class MercadoPagoPasarela implements PasarelaPagos {
  constructor(
    private readonly token: string,
    private readonly ahora: () => number = () => Date.now(),
  ) {}

  async crearPreferencia(solicitud: SolicitudPreferencia): Promise<Preferencia> {
    const data = await this.pedir('POST', '/checkout/preferences', {
      items: [{ title: solicitud.titulo, quantity: 1, unit_price: solicitud.monto, currency_id: 'CLP' }],
      external_reference: solicitud.externalReference,
      back_urls: { success: solicitud.urlRetorno },
      auto_return: 'approved',
      // notification_url por PREFERENCIA (Plan 14): enruta el webhook de PLATAFORMA sin
      // depender de configurar la cuenta MP. undefined → JSON.stringify lo omite, asi el
      // body de los llamadores del Plan 13 (sin notificationUrl) queda idéntico al de hoy.
      notification_url: solicitud.notificationUrl,
    })
    return { preferenciaId: String(data.id), url: String(data.init_point) }
  }

  async obtenerPago(mpPaymentId: string): Promise<PagoConsultado | null> {
    const data = await this.pedir('GET', `/v1/payments/${encodeURIComponent(mpPaymentId)}`)
    if (data.status == null) return null
    return {
      estado: String(data.status),
      monto: Math.round(Number(data.transaction_amount)),
      externalReference: String(data.external_reference ?? ''),
    }
  }

  // Esquema x-signature de MP: el header trae `ts=<unix>,v1=<hmac hex>`. Se
  // reconstruye el manifest `id:{data.id};request-id:{x-request-id};ts:{ts};`,
  // se calcula HMAC-SHA256(secret) y se compara contra v1 en tiempo constante.
  // Rechaza si faltan headers, si el ts sale de ±5 min o si el HMAC no calza.
  verificarFirma(headers: EncabezadosFirma, dataId: string, secret: string): boolean {
    const firma = headers['x-signature']
    const requestId = headers['x-request-id']
    if (!firma || !requestId) return false

    const partes = new Map<string, string>()
    for (const trozo of firma.split(',')) {
      const i = trozo.indexOf('=')
      if (i > 0) partes.set(trozo.slice(0, i).trim(), trozo.slice(i + 1).trim())
    }
    const ts = partes.get('ts')
    const v1 = partes.get('v1')
    if (!ts || !v1) return false

    // ts de MP es un timestamp Unix en segundos; el reloj inyectable es la
    // perilla de calibración si MP cambiara la unidad.
    const tsMs = Number(ts) * 1000
    if (!Number.isFinite(tsMs) || Math.abs(this.ahora() - tsMs) > FRESCURA_MS) return false

    const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`
    const esperado = Buffer.from(createHmac('sha256', secret).update(manifest).digest('hex'), 'hex')
    const recibido = Buffer.from(v1, 'hex')
    return esperado.length === recibido.length && timingSafeEqual(esperado, recibido)
  }

  // Cliente HTTP mínimo. LOGGING: jamás headers, config ni body — solo el
  // error.message saneado (un test lo fija). El Bearer del token nunca se loguea.
  private async pedir(
    metodo: string,
    ruta: string,
    cuerpo?: unknown,
  ): Promise<Record<string, unknown>> {
    try {
      const res = await fetch(BASE + ruta, {
        method: metodo,
        headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
        body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      })
      if (!res.ok) throw new Error(`MercadoPago respondió ${res.status}`)
      return (await res.json()) as Record<string, unknown>
    } catch (error) {
      console.error('MercadoPago:', error instanceof Error ? error.message : 'error desconocido')
      throw error
    }
  }
}
