import { formatearCLP } from '@suite/core'

// Recordatorio de cobranza por WhatsApp (spec §6): texto plano es-CL. La fecha llega
// YA formateada es-CL (la action la pasa por toLocaleDateString('es-CL'), mismo
// contrato que plantillaRecordatorio de @suite/correo).
export interface DatosRecordatorioWhatsApp {
  empresaRazonSocial: string
  clienteRazonSocial: string
  tipo: 'factura' | 'boleta'
  folio: number
  saldo: number
  fechaVencimiento: string
}

export function plantillaRecordatorioWhatsApp(datos: DatosRecordatorioWhatsApp): string {
  const etiqueta = datos.tipo === 'boleta' ? 'Boleta' : 'Factura'
  return (
    `Estimado/a ${datos.clienteRazonSocial}: le recordamos que su ${etiqueta} N° ${datos.folio} ` +
    `de ${datos.empresaRazonSocial} venció el ${datos.fechaVencimiento} y registra un saldo ` +
    `pendiente de ${formatearCLP(datos.saldo)}. Agradeceremos regularizar el pago.`
  )
}

// Avisos al WHATSAPP del admin de plataforma (spec avisos 2026-07-24): texto plano,
// espejo de las plantillas de correo de tickets y leads.
export interface DatosTicketWhatsApp {
  numero: number
  organizacion: string
  asunto: string
  autorEmail: string
  origen: 'web' | 'whatsapp'
}

export function plantillaTicketWhatsApp(datos: DatosTicketWhatsApp): string {
  const canal = datos.origen === 'whatsapp' ? 'WhatsApp' : 'la web'
  return `Nuevo ticket #${datos.numero} — ${datos.organizacion}\n${datos.asunto}\nDe ${datos.autorEmail} vía ${canal}. Respóndelo en el panel → Consultas.`
}

export interface DatosLeadWhatsApp {
  numero: number
  nombre: string
  email: string
  telefono: string | null
}

export function plantillaLeadWhatsApp(datos: DatosLeadWhatsApp): string {
  const contacto = datos.telefono ? `${datos.email} · ${datos.telefono}` : datos.email
  return `Nuevo lead #${datos.numero} — ${datos.nombre}\n${contacto}\nDesde el chat de la landing. Míralo en el panel → Leads.`
}
