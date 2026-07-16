import { afterEach, describe, expect, it, vi } from 'vitest'
import { MockWebpay, WebpayPlus } from './webpay'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const CREAR_MOCK = {
  buyOrder: 'a1b2c3d4e5f6a7b8c9d0e1f2a',
  sessionId: 'pago-1',
  monto: 19900,
  returnUrl: 'https://erp/api/pagos-suscripcion/retorno',
} as const

describe('MockWebpay', () => {
  it('crear usa un token determinista por buyOrder y refleja el returnUrl', async () => {
    const { token, url } = await new MockWebpay().crear(CREAR_MOCK)
    expect(token).toBe('mock-tbk-a1b2c3d4e5f6a7b8c9d0e1f2a')
    expect(url).toBe('https://erp/api/pagos-suscripcion/retorno')
  })

  it('confirmar autoriza UNA vez con buyOrder/monto guardados; el re-commit lanza', async () => {
    const wp = new MockWebpay()
    const { token } = await wp.crear(CREAR_MOCK)
    expect(await wp.confirmar(token)).toEqual({
      autorizado: true,
      buyOrder: 'a1b2c3d4e5f6a7b8c9d0e1f2a',
      monto: 19900,
    })
    await expect(wp.confirmar(token)).rejects.toThrow()
  })
})

describe('WebpayPlus.crear', () => {
  it('hace POST a la URL de integración con los headers Tbk y el body correcto', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ token: 'tbk-token-1', url: 'https://webpay3gint.transbank.cl/webpayserver/initTransaction' }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const resultado = await new WebpayPlus('597055555532', 'API-KEY-XYZ', 'integracion').crear({
      buyOrder: 'a1b2c3d4e5f6a7b8c9d0e1f2a',
      sessionId: 'pago-1',
      monto: 19900,
      returnUrl: 'https://erp/api/pagos-suscripcion/retorno',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { method: string; headers: Record<string, string>; body: string },
    ]
    expect(url).toBe('https://webpay3gint.transbank.cl/rswebpaytransaction/api/webpay/v1.2/transactions')
    expect(init.method).toBe('POST')
    expect(init.headers['Tbk-Api-Key-Id']).toBe('597055555532')
    expect(init.headers['Tbk-Api-Key-Secret']).toBe('API-KEY-XYZ')
    const body = JSON.parse(init.body)
    expect(body.buy_order).toBe('a1b2c3d4e5f6a7b8c9d0e1f2a')
    expect(body.session_id).toBe('pago-1')
    expect(body.amount).toBe(19900)
    expect(body.return_url).toBe('https://erp/api/pagos-suscripcion/retorno')
    expect(resultado).toEqual({ token: 'tbk-token-1', url: 'https://webpay3gint.transbank.cl/webpayserver/initTransaction' })
  })
})

describe('WebpayPlus.confirmar', () => {
  it('hace PUT al token en la URL de producción y mapea autorizado/buyOrder/monto', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        buy_order: 'a1b2c3d4e5f6a7b8c9d0e1f2a',
        status: 'AUTHORIZED',
        response_code: 0,
        amount: 19900,
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const resultado = await new WebpayPlus('597055555532', 'API-KEY', 'produccion').confirmar('tbk-token-1')

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { method: string }]
    expect(url).toBe('https://webpay3g.transbank.cl/rswebpaytransaction/api/webpay/v1.2/transactions/tbk-token-1')
    expect(init.method).toBe('PUT')
    expect(resultado).toEqual({ autorizado: true, buyOrder: 'a1b2c3d4e5f6a7b8c9d0e1f2a', monto: 19900 })
  })

  it('no filtra el commerceCode ni el apiKey en los logs (serializa objetos)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const wp = new WebpayPlus('COMMERCE-SECRETO', 'API-KEY-SECRETO', 'integracion')

    await expect(wp.confirmar('token-1')).rejects.toThrow()

    // Lección Plan 13: map + JSON.stringify (join a secas daría '[object Object]'
    // y no vería un secreto que hubiese viajado dentro de un arg objeto).
    const loggeado = errSpy.mock.calls
      .flat()
      .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
      .join(' ')
    expect(loggeado).toContain('500')
    expect(loggeado).not.toContain('COMMERCE-SECRETO')
    expect(loggeado).not.toContain('API-KEY-SECRETO')
  })

  it('lanza limpio ante un re-commit rechazado o un error de red', async () => {
    // Transbank responde no-ok a un token ya commiteado (re-commit); cubre igual 5xx/red.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 422, json: async () => ({}) })))
    const wp = new WebpayPlus('597055555532', 'API-KEY', 'integracion')
    await expect(wp.confirmar('token-ya-usado')).rejects.toThrow('Webpay respondió 422')
  })
})
