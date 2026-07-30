import { describe, expect, it } from 'vitest'
import { MockPasarela } from './mock'
import type { PagoConsultado } from './tipos'

describe('MockPasarela', () => {
  it('crea una preferencia mock- con URL a la página local /mock-pago/', async () => {
    const { preferenciaId, url } = await new MockPasarela().crearPreferencia({
      titulo: 'Factura N° 1',
      monto: 11900,
      externalReference: 'factura:e:o:l',
      urlRetorno: 'https://erp/ok',
    })
    expect(preferenciaId).toMatch(/^mock-/)
    expect(url).toBe('/mock-pago/' + preferenciaId)
  })

  it('obtenerPago devuelve el pago del registro inyectado y null si no existe', async () => {
    const pago: PagoConsultado = { estado: 'approved', monto: 11900, externalReference: 'factura:e:o:l' }
    const mock = new MockPasarela({ 'pay-1': pago })
    expect(await mock.obtenerPago('pay-1')).toEqual(pago)
    expect(await mock.obtenerPago('pay-desconocido')).toBe(null)
  })

  it('verificarFirma acepta el secreto mock y rechaza cualquier otro', () => {
    const mock = new MockPasarela()
    expect(mock.verificarFirma({}, 'data-1', 'mock')).toBe(true)
    expect(mock.verificarFirma({}, 'data-1', 'otro')).toBe(false)
  })
})
