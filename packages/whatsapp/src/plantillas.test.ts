import { describe, expect, it } from 'vitest'
import { plantillaLeadWhatsApp, plantillaRecordatorioWhatsApp, plantillaTicketWhatsApp } from './plantillas'

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

  it('plantillaTicketWhatsApp arma el aviso con canal legible', () => {
    const texto = plantillaTicketWhatsApp({
      numero: 7,
      organizacion: 'Demo Transportes SpA',
      asunto: 'No puedo emitir',
      autorEmail: 'dueno@demo.cl',
      origen: 'whatsapp',
    })
    expect(texto).toContain('Nuevo ticket #7 — Demo Transportes SpA')
    expect(texto).toContain('vía WhatsApp')
  })

  it('plantillaLeadWhatsApp arma el aviso con y sin teléfono', () => {
    const con = plantillaLeadWhatsApp({ numero: 3, nombre: 'María', email: 'm@x.cl', telefono: '+56911112222' })
    expect(con).toContain('Nuevo lead #3 — María')
    expect(con).toContain('m@x.cl · +56911112222')
    const sin = plantillaLeadWhatsApp({ numero: 4, nombre: 'Ana', email: 'a@x.cl', telefono: null })
    expect(sin).toContain('a@x.cl\nDesde el chat')
  })
})
