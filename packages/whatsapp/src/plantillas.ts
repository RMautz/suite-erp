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
