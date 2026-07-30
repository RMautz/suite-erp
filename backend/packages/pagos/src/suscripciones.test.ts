import { describe, expect, it } from 'vitest'
import { MercadoPagoPasarela } from './mercadopago'
import { WebpayPlus } from './webpay'
import { pasarelaSuscripciones, webpaySuscripciones } from './suscripciones'

describe('selectores fail-closed de suscripciones', () => {
  it("perilla 'real' construye los adaptadores reales", () => {
    expect(pasarelaSuscripciones('real', 'token')).toBeInstanceOf(MercadoPagoPasarela)
    expect(webpaySuscripciones('real', '597055555532', 'api-key', 'integracion')).toBeInstanceOf(WebpayPlus)
  })

  it('perilla ausente o desconocida lanza — JAMÁS cae a mock (dinero de plataforma)', () => {
    expect(() => pasarelaSuscripciones(undefined, 'token')).toThrow('Pasarela de suscripciones no configurada')
    expect(() => pasarelaSuscripciones('produccion', 'token')).toThrow('Pasarela de suscripciones no configurada')
    expect(() => webpaySuscripciones(undefined, 'c', 'k', 'integracion')).toThrow('Pasarela de suscripciones no configurada')
    expect(() => webpaySuscripciones('mercadopago', 'c', 'k', 'integracion')).toThrow('Pasarela de suscripciones no configurada')
    // 'real' con ambiente ausente o inválido TAMBIÉN lanza — un TBK_AMBIENTE olvidado jamás
    // cae a integración (mandaría pagos reales al ambiente de pruebas de Transbank).
    expect(() => webpaySuscripciones('real', 'c', 'k', undefined)).toThrow('Pasarela de suscripciones no configurada')
    expect(() => webpaySuscripciones('real', 'c', 'k', 'sandbox')).toThrow('Pasarela de suscripciones no configurada')
  })
})
