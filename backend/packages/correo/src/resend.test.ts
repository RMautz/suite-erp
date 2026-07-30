import { afterEach, describe, expect, it, vi } from 'vitest'
import { ResendCorreo } from './resend'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const MENSAJE = {
  para: 'cliente@ejemplo.cl',
  asunto: 'Cotización N° 42',
  html: '<p>hola</p>',
} as const

describe('ResendCorreo.enviar', () => {
  it('hace POST a la API de Resend con Bearer y el body {from,to,subject,html}', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ id: 'resend-id-1' }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const resultado = await new ResendCorreo('RESEND-KEY', 'Suite ERP <envios@suite.cl>').enviar(MENSAJE)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { method: string; headers: Record<string, string>; body: string },
    ]
    expect(url).toBe('https://api.resend.com/emails')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer RESEND-KEY')
    const body = JSON.parse(init.body)
    expect(body.from).toBe('Suite ERP <envios@suite.cl>')
    expect(body.to).toEqual(['cliente@ejemplo.cl'])
    expect(body.subject).toBe('Cotización N° 42')
    expect(body.html).toBe('<p>hola</p>')
    expect(resultado).toEqual({ id: 'resend-id-1' })
  })

  it('no filtra la apiKey ni el Bearer en los logs (serializa objetos)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const proveedor = new ResendCorreo('RESEND-SUPER-SECRETO', 'Suite ERP <envios@suite.cl>')

    await expect(proveedor.enviar(MENSAJE)).rejects.toThrow()

    // Lección Plan 13: map + JSON.stringify (join a secas daría '[object Object]'
    // y no vería un secreto que hubiese viajado dentro de un arg objeto).
    const loggeado = errSpy.mock.calls
      .flat()
      .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
      .join(' ')
    expect(loggeado).toContain('500')
    expect(loggeado).not.toContain('RESEND-SUPER-SECRETO')
    expect(loggeado).not.toContain('Bearer')
  })

  it('lanza limpio ante una respuesta no-ok de Resend', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 422, json: async () => ({}) })))
    const proveedor = new ResendCorreo('KEY', 'Suite ERP <envios@suite.cl>')
    await expect(proveedor.enviar(MENSAJE)).rejects.toThrow('Resend respondió 422')
  })
})
