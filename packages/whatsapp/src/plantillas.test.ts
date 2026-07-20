import { describe, expect, it } from 'vitest'
import { plantillaRecordatorioWhatsApp } from './plantillas'

describe('plantillaRecordatorioWhatsApp', () => {
  it('arma el texto es-CL de factura con CLP formateado', () => {
    const texto = plantillaRecordatorioWhatsApp({
      empresaRazonSocial: 'Demo Transportes SpA',
      clienteRazonSocial: 'Comercial del Sur Ltda',
      tipo: 'factura',
      folio: 1043,
      saldo: 1190000,
      fechaVencimiento: '15-06-2026',
    })
    expect(texto).toBe(
      'Estimado/a Comercial del Sur Ltda: le recordamos que su Factura N° 1043 ' +
        'de Demo Transportes SpA venció el 15-06-2026 y registra un saldo ' +
        'pendiente de $1.190.000. Agradeceremos regularizar el pago.',
    )
  })

  it('usa la etiqueta Boleta para boletas', () => {
    const texto = plantillaRecordatorioWhatsApp({
      empresaRazonSocial: 'E',
      clienteRazonSocial: 'C',
      tipo: 'boleta',
      folio: 7,
      saldo: 1000,
      fechaVencimiento: '01-01-2026',
    })
    expect(texto).toContain('su Boleta N° 7')
  })
})
