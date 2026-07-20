import { beforeEach, describe, expect, it } from 'vitest'
import { MockWhatsApp, whatsappMockEnviados, limpiarWhatsappMock } from './mock'

// El store vive en globalThis (sobrevive entre tests): se limpia antes de cada uno.
beforeEach(() => {
  limpiarWhatsappMock()
})

describe('MockWhatsApp', () => {
  it('enviarTexto guarda el mensaje en el store con id mock', async () => {
    await new MockWhatsApp().enviarTexto('+56912345678', 'hola')
    const enviados = whatsappMockEnviados()
    expect(enviados).toHaveLength(1)
    expect(enviados[0]?.id).toMatch(/^mock-wa-/)
    expect(enviados[0]?.telefono).toBe('+56912345678')
    expect(enviados[0]?.texto).toBe('hola')
  })

  it('limpiarWhatsappMock vacía el store', async () => {
    await new MockWhatsApp().enviarTexto('+56912345678', 'hola')
    expect(whatsappMockEnviados()).toHaveLength(1)
    limpiarWhatsappMock()
    expect(whatsappMockEnviados()).toHaveLength(0)
  })
})
