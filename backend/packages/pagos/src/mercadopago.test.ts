import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MercadoPagoPasarela } from './mercadopago'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// Vector HMAC calculado A MANO (node crypto, fuera del código bajo prueba):
//   secret   = 'mi-secreto-webhook'
//   manifest = 'id:123456;request-id:req-abc-789;ts:1704908010;'
const SECRETO = 'mi-secreto-webhook'
const DATA_ID = '123456'
const REQUEST_ID = 'req-abc-789'
const TS = '1704908010'
const TS_MS = 1704908010 * 1000
const HMAC_OK = '9bda5031e5458d288acc84092eadc5df02f5db686040e5b004efc27e8ade3ba5'

function headers(v1: string) {
  return { 'x-signature': `ts=${TS},v1=${v1}`, 'x-request-id': REQUEST_ID }
}

describe('MercadoPagoPasarela.verificarFirma', () => {
  it('acepta el vector HMAC conocido dentro de la ventana de frescura', () => {
    // El golden vector ES HMAC-SHA256(secret, manifest) genuino (comprobado aquí).
    const manifest = `id:${DATA_ID};request-id:${REQUEST_ID};ts:${TS};`
    expect(createHmac('sha256', SECRETO).update(manifest).digest('hex')).toBe(HMAC_OK)

    const mp = new MercadoPagoPasarela('token-no-usado', () => TS_MS)
    expect(mp.verificarFirma(headers(HMAC_OK), DATA_ID, SECRETO)).toBe(true)
  })

  it('rechaza una firma con v1 incorrecto', () => {
    const mp = new MercadoPagoPasarela('token', () => TS_MS)
    expect(mp.verificarFirma(headers('00'.repeat(32)), DATA_ID, SECRETO)).toBe(false)
  })

  it('rechaza un ts fuera de la ventana de ±5 min aunque el HMAC calce', () => {
    const mp = new MercadoPagoPasarela('token', () => TS_MS + 6 * 60 * 1000)
    expect(mp.verificarFirma(headers(HMAC_OK), DATA_ID, SECRETO)).toBe(false)
  })

  it('rechaza cuando faltan los headers de firma', () => {
    const mp = new MercadoPagoPasarela('token', () => TS_MS)
    expect(mp.verificarFirma({}, DATA_ID, SECRETO)).toBe(false)
    expect(mp.verificarFirma({ 'x-signature': `ts=${TS},v1=${HMAC_OK}` }, DATA_ID, SECRETO)).toBe(false)
  })
})

describe('MercadoPagoPasarela.crearPreferencia', () => {
  it('envía título, monto y external_reference a /checkout/preferences con Bearer del token', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ id: 'pref-123', init_point: 'https://mp/checkout?pref=pref-123' }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    await new MercadoPagoPasarela('TOKEN-XYZ').crearPreferencia({
      titulo: 'Factura N° 42',
      monto: 11900,
      externalReference: 'factura:e:o:l',
      urlRetorno: 'https://erp/ok',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { method: string; headers: Record<string, string>; body: string },
    ]
    expect(url).toBe('https://api.mercadopago.com/checkout/preferences')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer TOKEN-XYZ')
    const body = JSON.parse(init.body)
    expect(body.items[0].title).toBe('Factura N° 42')
    expect(body.items[0].unit_price).toBe(11900)
    expect(body.external_reference).toBe('factura:e:o:l')
  })

  it('devuelve el preferenciaId y la url (init_point) que responde MercadoPago', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ id: 'pref-999', init_point: 'https://mp/checkout?pref=pref-999' }),
      })),
    )
    const pref = await new MercadoPagoPasarela('t').crearPreferencia({
      titulo: 'x',
      monto: 1000,
      externalReference: 'proforma:e:o:l',
      urlRetorno: 'https://erp/ok',
    })
    expect(pref).toEqual({ preferenciaId: 'pref-999', url: 'https://mp/checkout?pref=pref-999' })
  })
})

describe('MercadoPagoPasarela: no filtra secretos en los logs', () => {
  it('ante un error HTTP loguea solo el mensaje saneado, jamás el token ni el Bearer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const mp = new MercadoPagoPasarela('TOKEN-SUPER-SECRETO')

    await expect(mp.obtenerPago('pay-1')).rejects.toThrow()

    const loggeado = errSpy.mock.calls
      .flat()
      .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
      .join(' ')
    expect(loggeado).toContain('500')
    expect(loggeado).not.toContain('TOKEN-SUPER-SECRETO')
    expect(loggeado).not.toContain('Bearer')
  })
})
