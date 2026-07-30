// Interface propia de Webpay (spec §4). PasarelaWebpay NO es PasarelaPagos: Webpay
// no tiene webhook ni firma — el ciclo es crear → redirect → retorno → commit
// server-to-server (confirmar). Mock y real la implementan por igual.
export interface PasarelaWebpay {
  crear(solicitud: {
    buyOrder: string
    sessionId: string
    monto: number
    returnUrl: string
  }): Promise<{ token: string; url: string }>
  confirmar(token: string): Promise<{ autorizado: boolean; buyOrder: string; monto: number }>
}

export type TbkAmbiente = 'integracion' | 'produccion'

const BASE_INTEGRACION = 'https://webpay3gint.transbank.cl'
const BASE_PRODUCCION = 'https://webpay3g.transbank.cl'
const RUTA = '/rswebpaytransaction/api/webpay/v1.2/transactions'

// Adaptador de Webpay Plus (Transbank REST v1.2). commerceCode y apiKey llegan por
// constructor desde las env de PLATAFORMA y viajan en los headers Tbk-Api-Key-Id /
// Tbk-Api-Key-Secret; JAMAS se loguean (solo error.message, espejo de MercadoPagoPasarela).
export class WebpayPlus implements PasarelaWebpay {
  private readonly base: string

  constructor(
    private readonly commerceCode: string,
    private readonly apiKey: string,
    ambiente: TbkAmbiente,
  ) {
    this.base = ambiente === 'produccion' ? BASE_PRODUCCION : BASE_INTEGRACION
  }

  async crear(solicitud: {
    buyOrder: string
    sessionId: string
    monto: number
    returnUrl: string
  }): Promise<{ token: string; url: string }> {
    const data = await this.pedir('POST', RUTA, {
      buy_order: solicitud.buyOrder,
      session_id: solicitud.sessionId,
      amount: solicitud.monto,
      return_url: solicitud.returnUrl,
    })
    return { token: String(data.token), url: String(data.url) }
  }

  async confirmar(token: string): Promise<{ autorizado: boolean; buyOrder: string; monto: number }> {
    // El commit (PUT) es la UNICA fuente de verdad: autorizacion y monto salen de aca,
    // jamas de los params del retorno. autorizado = response_code 0 Y status AUTHORIZED.
    const data = await this.pedir('PUT', `${RUTA}/${encodeURIComponent(token)}`)
    const autorizado = Number(data.response_code) === 0 && data.status === 'AUTHORIZED'
    return {
      autorizado,
      buyOrder: String(data.buy_order ?? ''),
      monto: Math.round(Number(data.amount)),
    }
  }

  // Cliente HTTP minimo (espejo de MercadoPagoPasarela.pedir). LOGGING: jamas headers,
  // config ni body — solo error.message saneado. commerceCode/apiKey nunca se loguean.
  private async pedir(
    metodo: string,
    ruta: string,
    cuerpo?: unknown,
  ): Promise<Record<string, unknown>> {
    try {
      const res = await fetch(this.base + ruta, {
        method: metodo,
        headers: {
          'Tbk-Api-Key-Id': this.commerceCode,
          'Tbk-Api-Key-Secret': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      })
      if (!res.ok) throw new Error(`Webpay respondió ${res.status}`)
      return (await res.json()) as Record<string, unknown>
    } catch (error) {
      console.error('Webpay:', error instanceof Error ? error.message : 'error desconocido')
      throw error
    }
  }
}

// Store a nivel de MODULO respaldado en globalThis (leccion Plan 13, espejo de mock.ts):
// crear (Server Action del simulador, solo dev) escribe token→{buyOrder, monto} y el
// retorno, en OTRA instancia de MockWebpay, lo lee en confirmar. En `next dev` cada ruta
// recompila con su propia instancia del modulo; un `const` normal se reinicializaria
// vacio en cada recompilacion. Solo dev/mock; en produccion no se usa MockWebpay.
interface SolicitudWebpayGuardada {
  buyOrder: string
  monto: number
}
interface GlobalConStoreWebpay {
  __suiteWebpayMockStore?: Record<string, SolicitudWebpayGuardada>
}
const gw = globalThis as unknown as GlobalConStoreWebpay
const STORE_WEBPAY: Record<string, SolicitudWebpayGuardada> = (gw.__suiteWebpayMockStore ??= {})

// Pasarela Webpay simulada: opera el ciclo sin credenciales. crear guarda la solicitud
// bajo un token DETERMINISTA ('mock-tbk-' + buyOrder) y lo retorna; el simulador (Server
// Action Webpay) llama crear para sembrar el store y luego redirige al retorno con ese
// token. La url retornada es IRRELEVANTE para el flujo mock (nadie la consume): refleja el
// returnUrl. confirmar autoriza UNA vez (consume la entrada); el re-commit del mismo token
// lanza, como Transbank real (el retorno lo trata via idempotencia de BD: si el pago ya
// esta pagado, ni llama a confirmar).
export class MockWebpay implements PasarelaWebpay {
  async crear(solicitud: {
    buyOrder: string
    sessionId: string
    monto: number
    returnUrl: string
  }): Promise<{ token: string; url: string }> {
    const token = 'mock-tbk-' + solicitud.buyOrder
    STORE_WEBPAY[token] = { buyOrder: solicitud.buyOrder, monto: solicitud.monto }
    return { token, url: solicitud.returnUrl }
  }

  async confirmar(token: string): Promise<{ autorizado: boolean; buyOrder: string; monto: number }> {
    const guardada = STORE_WEBPAY[token]
    if (guardada === undefined) {
      throw new Error('Webpay: transacción no encontrada o ya confirmada')
    }
    delete STORE_WEBPAY[token]
    return { autorizado: true, buyOrder: guardada.buyOrder, monto: guardada.monto }
  }
}
