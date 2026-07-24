import { formatearCLP, formatearRut } from '@suite/core'
import { escaparHtml } from './escapar'
import type {
  ContenidoCorreo,
  DatosCotizacion,
  DatosDocumento,
  DatosProforma,
  DatosRecordatorio,
  EmpresaCorreo,
  LineaCorreo,
  OdeCorreo,
} from './tipos'

// Envoltura común email-safe (tablas + estilos INLINE: los clientes de correo no aplican
// <style> ni clases externas). Encabezado con la identidad de la EMPRESA (razón social
// escapada + RUT formateado) y pie fijo. `titulo` se escapa por si trae datos de usuario.
function envolver(empresa: EmpresaCorreo, titulo: string, cuerpo: string): string {
  return (
    '<div style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;max-width:640px;margin:0 auto">' +
    '<h1 style="font-size:18px;margin:0 0 4px">' +
    escaparHtml(empresa.razonSocial) +
    '</h1>' +
    '<p style="font-size:13px;color:#6b7280;margin:0 0 16px">RUT ' +
    formatearRut(empresa.rut) +
    '</p>' +
    '<h2 style="font-size:16px;margin:0 0 12px">' +
    escaparHtml(titulo) +
    '</h2>' +
    cuerpo +
    '<p style="font-size:12px;color:#9ca3af;margin-top:24px">Enviado con Suite ERP</p>' +
    '</div>'
  )
}

// Cabecera de la tabla de líneas (reusada por cotización/documento y proforma).
function tabla(filas: string): string {
  const th = 'style="padding:6px 8px;border-bottom:2px solid #d1d5db"'
  return (
    '<table style="width:100%;border-collapse:collapse;font-size:13px">' +
    '<thead><tr>' +
    '<th ' + th + ';text-align:left">Detalle</th>' +
    '<th ' + th + ';text-align:right">Cant.</th>' +
    '<th ' + th + ';text-align:right">Precio</th>' +
    '<th ' + th + ';text-align:right">Total</th>' +
    '</tr></thead><tbody>' +
    filas +
    '</tbody></table>'
  )
}

const CELDA = 'style="padding:6px 8px;border-bottom:1px solid #e5e7eb"'
const CELDA_D = 'style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right"'

function filasLineas(lineas: LineaCorreo[]): string {
  const filas = lineas
    .map(
      (l) =>
        '<tr>' +
        '<td ' + CELDA + '>' + escaparHtml(l.descripcion) + '</td>' +
        '<td ' + CELDA_D + '>' + l.cantidad + '</td>' +
        '<td ' + CELDA_D + '>' + formatearCLP(l.precioNeto) + '</td>' +
        '<td ' + CELDA_D + '>' + formatearCLP(l.subtotal) + '</td>' +
        '</tr>',
    )
    .join('')
  return tabla(filas)
}

// Nómina de ODEs de la proforma (spec §4): N° ODE, destino (escapado — origen usuario),
// bultos, kilo afecto y neto formateado. Tabla propia, encabezado distinto al de líneas.
function tablaOdes(odes: OdeCorreo[]): string {
  const th = 'style="padding:6px 8px;border-bottom:2px solid #d1d5db"'
  const filas = odes
    .map(
      (o) =>
        '<tr>' +
        '<td ' + CELDA + '>' + o.numero + '</td>' +
        '<td ' + CELDA + '>' + escaparHtml(o.destino) + '</td>' +
        '<td ' + CELDA_D + '>' + o.bultos + '</td>' +
        '<td ' + CELDA_D + '>' + o.kiloAfecto + '</td>' +
        '<td ' + CELDA_D + '>' + formatearCLP(o.neto) + '</td>' +
        '</tr>',
    )
    .join('')
  return (
    '<table style="width:100%;border-collapse:collapse;font-size:13px">' +
    '<thead><tr>' +
    '<th ' + th + ';text-align:left">N° ODE</th>' +
    '<th ' + th + ';text-align:left">Destino</th>' +
    '<th ' + th + ';text-align:right">Bultos</th>' +
    '<th ' + th + ';text-align:right">Kilo afecto</th>' +
    '<th ' + th + ';text-align:right">Neto</th>' +
    '</tr></thead><tbody>' +
    filas +
    '</tbody></table>'
  )
}

// Bloque de totales. exento se lista SOLO si > 0 (documentos exentos/mixtos); la proforma
// no lleva exento y lo omite (default 0).
function totales(neto: number, iva: number, total: number, exento = 0): string {
  const fila = (etiqueta: string, monto: number, fuerte = false) =>
    '<tr><td style="padding:4px 8px;text-align:right;color:#6b7280">' +
    etiqueta +
    '</td><td style="padding:4px 8px;text-align:right;width:120px' +
    (fuerte ? ';font-weight:bold;color:#111827' : '') +
    '">' +
    formatearCLP(monto) +
    '</td></tr>'
  return (
    '<table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:8px">' +
    fila('Neto', neto) +
    (exento > 0 ? fila('Exento', exento) : '') +
    fila('IVA', iva) +
    fila('Total', total, true) +
    '</table>'
  )
}

export function plantillaCotizacion(datos: DatosCotizacion): ContenidoCorreo {
  const asunto = `Cotización N° ${datos.numero} — ${datos.empresa.razonSocial}`
  const cuerpo =
    '<p style="font-size:14px">Cotización N° ' + datos.numero + ' del ' + datos.fecha +
    ' para ' + escaparHtml(datos.clienteRazonSocial) + '. Válida hasta el ' + datos.validez + '.</p>' +
    filasLineas(datos.lineas) +
    totales(datos.neto, datos.iva, datos.total, datos.exento)
  return { asunto, html: envolver(datos.empresa, `Cotización N° ${datos.numero}`, cuerpo) }
}

export function plantillaProforma(datos: DatosProforma): ContenidoCorreo {
  const asunto = `Proforma N° ${datos.numero} — ${datos.empresa.razonSocial}`
  const cuerpo =
    '<p style="font-size:14px">Proforma N° ' + datos.numero + ' del ' + datos.fecha +
    ' para ' + escaparHtml(datos.clienteRazonSocial) + '.</p>' +
    tablaOdes(datos.odes) +
    totales(datos.neto, datos.iva, datos.total)
  return { asunto, html: envolver(datos.empresa, `Proforma N° ${datos.numero}`, cuerpo) }
}

export function plantillaDocumento(datos: DatosDocumento): ContenidoCorreo {
  // tipo llega en minúscula ('factura'|'boleta'); la etiqueta se capitaliza aquí.
  const etiqueta = datos.tipo === 'boleta' ? 'Boleta' : 'Factura'
  const asunto = `${etiqueta} N° ${datos.folio} — ${datos.empresa.razonSocial}`
  const cuerpo =
    '<p style="font-size:14px">' + etiqueta + ' N° ' + datos.folio + ' emitida el ' + datos.fecha +
    ' a ' + escaparHtml(datos.clienteRazonSocial) + '.</p>' +
    filasLineas(datos.lineas) +
    totales(datos.neto, datos.iva, datos.total, datos.exento)
  return { asunto, html: envolver(datos.empresa, `${etiqueta} N° ${datos.folio}`, cuerpo) }
}

export function plantillaRecordatorio(datos: DatosRecordatorio): ContenidoCorreo {
  // tipo llega en minúscula ('factura'|'boleta'); la etiqueta se capitaliza aquí.
  const etiqueta = datos.tipo === 'boleta' ? 'Boleta' : 'Factura'
  const asunto = `Recordatorio de pago: ${etiqueta} N° ${datos.folio} — ${datos.empresa.razonSocial}`
  const cuerpo =
    '<p style="font-size:14px">Estimado/a ' + escaparHtml(datos.clienteRazonSocial) + ',</p>' +
    '<p style="font-size:14px">Le recordamos que su ' + etiqueta + ' N° ' + datos.folio +
    ' por un total de <strong>' + formatearCLP(datos.total) + '</strong> venció el ' + datos.fechaVencimiento +
    ' y registra un saldo pendiente de <strong>' + formatearCLP(datos.saldo) +
    '</strong>. Agradeceremos regularizar el pago.</p>'
  return { asunto, html: envolver(datos.empresa, `Recordatorio de pago — ${etiqueta} N° ${datos.folio}`, cuerpo) }
}

// Aviso de ticket al admin de la PLATAFORMA (spec tickets 2026-07-22): sin envolver()
// porque el remitente logico es Suite ERP, no una empresa. Todo dato de usuario escapado.
export function plantillaTicketAdmin(datos: DatosTicketAdmin): ContenidoCorreo {
  const asunto = `Nuevo ticket #${datos.numero} — ${datos.organizacion}`
  const canal = datos.origen === 'whatsapp' ? 'WhatsApp' : 'sitio web'
  const html =
    '<div style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;max-width:640px;margin:0 auto">' +
    '<h1 style="font-size:18px;margin:0 0 4px">Suite ERP — ticket #' + datos.numero + '</h1>' +
    '<p style="font-size:13px;color:#6b7280;margin:0 0 16px">' +
    escaparHtml(datos.organizacion) + ' · RUT ' + formatearRut(datos.rut) +
    ' · ' + escaparHtml(datos.autorEmail) + ' · vía ' + canal + '</p>' +
    '<h2 style="font-size:16px;margin:0 0 12px">' + escaparHtml(datos.asunto) + '</h2>' +
    '<p style="font-size:14px;white-space:pre-wrap">' + escaparHtml(datos.mensaje) + '</p>' +
    '<p style="font-size:12px;color:#9ca3af;margin-top:24px">Respóndelo en el panel de plataforma → Consultas.</p>' +
    '</div>'
  return { asunto, html }
}

// Aviso de LEAD del chat de ventas de la landing (spec 2026-07-24): un posible
// cliente dejo sus datos. Todo escapado.
export function plantillaLeadAdmin(datos: DatosLeadAdmin): ContenidoCorreo {
  const asunto = `Nuevo lead #${datos.numero} — ${datos.nombre}`
  const html =
    '<div style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;max-width:640px;margin:0 auto">' +
    '<h1 style="font-size:18px;margin:0 0 4px">Suite ERP — lead #' + datos.numero + '</h1>' +
    '<p style="font-size:14px;margin:0 0 4px"><strong>' + escaparHtml(datos.nombre) + '</strong></p>' +
    '<p style="font-size:13px;color:#6b7280;margin:0 0 12px">' +
    escaparHtml(datos.email) +
    (datos.telefono ? ' · ' + escaparHtml(datos.telefono) : '') +
    '</p>' +
    (datos.mensaje ? '<p style="font-size:14px;white-space:pre-wrap">' + escaparHtml(datos.mensaje) + '</p>' : '') +
    '<p style="font-size:12px;color:#9ca3af;margin-top:24px">Llegó desde el chat de la landing. Míralo en el panel → Leads.</p>' +
    '</div>'
  return { asunto, html }
}
