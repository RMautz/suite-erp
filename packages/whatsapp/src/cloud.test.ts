import { afterEach, describe, expect, it, vi } from 'vitest'
import { WhatsAppCloudAPI } from './cloud'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('WhatsAppCloudAPI.enviarTexto', () => {
  it('hace POST a graph.facebook.com con Bearer y el body de texto', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await new WhatsAppCloudAPI('TOKEN-META', 'PHONE-1').enviarTexto('+56912345678', 'hola')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { method: string; headers: Record<string, string>; body: string },
    ]
    expect(url).toBe('https://graph.facebook.com/v20.0/PHONE-1/messages')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer TOKEN-META')
    const body = JSON.parse(init.body)
    expect(body.messaging_product).toBe('whatsapp')
    expect(body.to).toBe('+56912345678')
    expect(body.type).toBe('text')
    expect(body.text.body).toBe('hola')
  })

  it('no filtra el token ni el Bearer en los logs', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(new WhatsAppCloudAPI('TOKEN-SUPER-SECRETO', 'PHONE-1').enviarTexto('+56912345678', 'x')).rejects.toThrow()

    const loggeado = errSpy.mock.calls
      .flat()
      .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
      .join(' ')
    expect(loggeado).toContain('500')
    expect(loggeado).not.toContain('TOKEN-SUPER-SECRETO')
    expect(loggeado).not.toContain('Bearer')
  })

  it('lanza limpio ante una respuesta no-ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401 })))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(new WhatsAppCloudAPI('T', 'P').enviarTexto('+56912345678', 'x')).rejects.toThrow('WhatsApp Cloud respondió 401')
  })
})
