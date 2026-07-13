import { describe, expect, it } from 'vitest'
import { MockDTE } from './mock'
import type { SolicitudEmision } from './tipos'

const base: SolicitudEmision = {
  tipo: 'factura',
  codigoSii: 33,
  folio: 101,
  emisor: { rut: '76543210-3', razonSocial: 'Emisor SpA', giro: 'Ventas', direccion: 'Calle 1', comuna: 'Santiago' },
  receptor: { rut: '11111111-1', razonSocial: 'Cliente Ltda' },
  lineas: [{ descripcion: 'Producto', cantidad: 1, precioNeto: 10000, exenta: false }],
  neto: 10000,
  exento: 0,
  iva: 1900,
  total: 11900,
  credenciales: { apiKey: 'k', certificadoPfx: Buffer.from(''), certificadoPassword: 'p', cafXml: '<CAF/>' },
}

describe('MockDTE', () => {
  it('emite con éxito devolviendo folio, trackId, xml y pdf', async () => {
    const r = await new MockDTE().emitirDTE(base)
    expect(r.estado).toBe('emitido')
    expect(r.folio).toBe(101)
    expect(r.trackId).toBe('mock-101')
    expect(r.xmlTimbrado).toContain('101')
    expect(r.pdfBase64).not.toBeNull()
    expect(r.error).toBeNull()
  })

  it('devuelve pendiente_envio para el RUT de falla (prueba de reintentos)', async () => {
    const r = await new MockDTE().emitirDTE({ ...base, receptor: { ...base.receptor, rut: '66666666-6' } })
    expect(r.estado).toBe('pendiente_envio')
    expect(r.trackId).toBeNull()
    expect(r.error).not.toBeNull()
  })

  it('consultarEstado devuelve aceptado', async () => {
    const estado = await new MockDTE().consultarEstado('mock-101', base.credenciales)
    expect(estado).toBe('aceptado')
  })

  it('la nota de crédito referencia el documento original', async () => {
    const r = await new MockDTE().anularConNotaCredito({
      ...base,
      tipo: 'nota_credito',
      codigoSii: 61,
      folio: 5,
      folioReferencia: 101,
      codigoSiiReferencia: 33,
      razonAnulacion: 'Anula factura',
    })
    expect(r.estado).toBe('emitido')
    expect(r.xmlTimbrado).toContain('101')
  })
})
