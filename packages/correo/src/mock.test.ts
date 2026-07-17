import { beforeEach, describe, expect, it } from 'vitest'
import { MockCorreo, correosMockEnviados, limpiarCorreosMock } from './mock'

// El store vive en globalThis (sobrevive entre tests): se limpia antes de cada uno.
beforeEach(() => {
  limpiarCorreosMock()
})

describe('MockCorreo', () => {
  it('enviar guarda el correo en el store y retorna un id mock', async () => {
    const { id } = await new MockCorreo().enviar({
      para: 'cliente@ejemplo.cl',
      asunto: 'Cotización N° 1',
      html: '<p>detalle</p>',
    })
    expect(id).toMatch(/^mock-correo-/)
    const enviados = correosMockEnviados()
    expect(enviados).toHaveLength(1)
    expect(enviados[0]).toEqual({
      id,
      para: 'cliente@ejemplo.cl',
      asunto: 'Cotización N° 1',
      html: '<p>detalle</p>',
    })
  })

  it('limpiarCorreosMock vacía el store', async () => {
    await new MockCorreo().enviar({ para: 'a@b.cl', asunto: 'x', html: '<p>y</p>' })
    expect(correosMockEnviados()).toHaveLength(1)
    limpiarCorreosMock()
    expect(correosMockEnviados()).toHaveLength(0)
  })
})
