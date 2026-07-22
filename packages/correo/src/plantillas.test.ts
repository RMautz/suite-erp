import { describe, expect, it } from 'vitest'
import {
  plantillaCotizacion,
  plantillaDocumento,
  plantillaProforma,
  plantillaRecordatorio,
  plantillaTicketAdmin,
} from './plantillas'
import type { OdeCorreo } from './tipos'

const EMPRESA = { razonSocial: 'Transportes del Sur SpA', rut: '76543210-9' }
const CLIENTE = 'Comercial Andes Ltda'
const ODE: OdeCorreo = {
  numero: 5,
  destino: 'Puerto Montt',
  bultos: 12,
  kiloAfecto: 340,
  neto: 20000,
}

describe('plantillas de correo', () => {
  it('cotización: asunto con número y empresa; validez, cliente y total CLP; exento 0 no se lista', () => {
    const { asunto, html } = plantillaCotizacion({
      empresa: EMPRESA,
      clienteRazonSocial: CLIENTE,
      numero: 42,
      fecha: '17-07-2026',
      validez: '16-08-2026',
      lineas: [{ descripcion: 'Flete Santiago-Rancagua', cantidad: 2, precioNeto: 5000, subtotal: 10000 }],
      neto: 10000,
      exento: 0,
      iva: 1900,
      total: 11900,
    })
    expect(asunto).toContain('N° 42')
    expect(asunto).toContain('Transportes del Sur SpA')
    expect(html).toContain('Transportes del Sur SpA')
    expect(html).toContain('Comercial Andes Ltda')
    expect(html).toContain('16-08-2026')
    expect(html).toContain('Flete Santiago-Rancagua')
    expect(html).toContain('$11.900')
    expect(html).not.toContain('Exento')
    expect(html).toContain('Enviado con Suite ERP')
  })

  it('proforma: asunto con número y empresa; destino y neto de la ODE en el cuerpo', () => {
    const { asunto, html } = plantillaProforma({
      empresa: EMPRESA,
      clienteRazonSocial: CLIENTE,
      numero: 7,
      fecha: '17-07-2026',
      odes: [ODE],
      neto: 20000,
      iva: 3800,
      total: 23800,
    })
    expect(asunto).toContain('N° 7')
    expect(asunto).toContain('Transportes del Sur SpA')
    expect(html).toContain('Puerto Montt')
    expect(html).toContain('$23.800')
    expect(html).toContain('Enviado con Suite ERP')
  })

  it('documento: tipo minúscula capitaliza la etiqueta; exento > 0 se lista; total CLP en el cuerpo', () => {
    const { asunto, html } = plantillaDocumento({
      empresa: EMPRESA,
      clienteRazonSocial: CLIENTE,
      tipo: 'factura',
      folio: 100,
      fecha: '17-07-2026',
      lineas: [{ descripcion: 'Servicio de transporte', cantidad: 5, precioNeto: 10000, subtotal: 50000 }],
      neto: 50000,
      exento: 4000,
      iva: 9500,
      total: 63500,
    })
    expect(asunto).toContain('Factura N° 100')
    expect(asunto).toContain('Transportes del Sur SpA')
    expect(html).toContain('Exento')
    expect(html).toContain('$4.000')
    expect(html).toContain('$63.500')
    expect(html).toContain('Enviado con Suite ERP')
  })

  it('recordatorio: tipo minúscula capitaliza la etiqueta; total y saldo CLP y cliente en el cuerpo', () => {
    const { asunto, html } = plantillaRecordatorio({
      empresa: EMPRESA,
      clienteRazonSocial: CLIENTE,
      tipo: 'factura',
      folio: 88,
      total: 300000,
      saldo: 250000,
      fechaVencimiento: '01-07-2026',
    })
    expect(asunto).toContain('Factura N° 88')
    expect(asunto).toContain('Transportes del Sur SpA')
    expect(html).toContain('Comercial Andes Ltda')
    expect(html).toContain('$300.000')
    expect(html).toContain('$250.000')
    expect(html).toContain('Enviado con Suite ERP')
  })
})

describe('escape de datos de usuario en el HTML', () => {
  it('un <script> en la razón social de empresa y cliente, y en el destino de una ODE, se escapa', () => {
    const { html } = plantillaProforma({
      empresa: { razonSocial: '<script>e</script>', rut: '76543210-9' },
      clienteRazonSocial: '<script>c</script>',
      numero: 1,
      fecha: '17-07-2026',
      odes: [{ ...ODE, destino: '<script>d</script>' }],
      neto: 20000,
      iva: 3800,
      total: 23800,
    })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;e&lt;/script&gt;')
    expect(html).toContain('&lt;script&gt;c&lt;/script&gt;')
    expect(html).toContain('&lt;script&gt;d&lt;/script&gt;')
  })

  it('un <script> en la glosa de una línea se escapa', () => {
    const { html } = plantillaCotizacion({
      empresa: EMPRESA,
      clienteRazonSocial: CLIENTE,
      numero: 2,
      fecha: '17-07-2026',
      validez: '16-08-2026',
      lineas: [{ descripcion: '<script>x</script>', cantidad: 1, precioNeto: 1000, subtotal: 1000 }],
      neto: 1000,
      exento: 0,
      iva: 190,
      total: 1190,
    })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;')
  })

  it('plantillaTicketAdmin arma el aviso con numero, canal y datos escapados', () => {
    const { asunto, html } = plantillaTicketAdmin({
      numero: 7,
      organizacion: 'Transportes <Sur> SpA',
      rut: '76543210-9',
      autorEmail: 'dueno@sur.cl',
      asunto: 'No puedo emitir',
      mensaje: 'Línea 1\ncon <b>html</b>',
      origen: 'whatsapp',
    })
    expect(asunto).toBe('Nuevo ticket #7 — Transportes <Sur> SpA')
    expect(html).toContain('ticket #7')
    expect(html).toContain('vía WhatsApp')
    expect(html).toContain('Transportes &lt;Sur&gt; SpA')
    expect(html).toContain('con &lt;b&gt;html&lt;/b&gt;')
    expect(html).not.toContain('<b>html</b>')
  })
})
