// Motor de VENTAS para el chat de la landing (spec 2026-07-24): visitantes anonimos,
// captacion de leads y explicacion del producto. Scriptado 100% determinista; la
// persona IA queda para cuando llegue la credencial #12 (seam: generalizar
// ClaudeMotor a system+tools parametrizables).

export interface HerramientasVentas {
  guardarLead(nombre: string, email: string, telefono: string | null, mensaje: string | null): Promise<{ numero: number }>
}

export interface MotorVentas {
  responder(mensaje: string): Promise<string>
}

export const MENU_VENTAS = [
  'Hola! Soy el asistente de Suite ERP. ¿Qué quieres saber?',
  '1. ¿Qué es Suite ERP y cómo funciona?',
  '2. Módulos',
  '3. Precios y prueba gratis',
  '4. Hablar con una persona (deja tus datos)',
  'Escribe el número o tu pregunta.',
].join('\n')

export const AYUDA_VENTAS =
  'Te puedo contar qué es Suite ERP (1), sus módulos (2) o los precios (3). Y si prefieres que te contactemos, escribe: contacto <nombre>, <correo>, <teléfono opcional>'

const QUE_ES = [
  'Suite ERP es la gestión completa de tu pyme chilena, en la nube:',
  'emites facturas y boletas electrónicas (SII), llevas cotizaciones, ventas y',
  'cobranza con recordatorios por correo y WhatsApp, controlas inventario y',
  'compras, y cierras el mes con remuneraciones, Previred y contabilidad.',
  'Te registras con el RUT de tu empresa y en menos de 10 minutos emites tu',
  'primer documento. Los primeros 14 días son gratis, sin tarjeta.',
].join(' ')

const MODULOS = [
  'Módulos de Suite ERP:',
  '- Ventas: cotizaciones, facturas y boletas electrónicas (SII)',
  '- Cobranza: pagos, anticipos y recordatorios por correo y WhatsApp',
  '- Compras e inventario: por pagar, stock y movimientos',
  '- Transporte: flota, tarifario, entregas, proformas y combustible',
  '- Personas: contratos, liquidaciones, Previred, finiquitos y vacaciones',
  '- Contabilidad: asientos automáticos, estados financieros y un auditor con semáforo',
  '- Un bot de WhatsApp para consultar tu empresa desde el teléfono',
].join('\n')

const PRECIOS = [
  'Plan Básico: $29.990 + IVA al mes por empresa, con todos los módulos.',
  'Partes con 14 días de prueba gratis, sin tarjeta. Crea tu cuenta en la opción',
  '"Prueba gratis" aquí arriba y emite tu primer documento hoy.',
].join(' ')

const PIDE_DATOS = 'Encantado. Escribe: contacto <tu nombre>, <tu correo>, <tu teléfono (opcional)> y te llamamos.'

export class MockMotorVentas implements MotorVentas {
  constructor(private readonly herramientas: HerramientasVentas) {}

  async responder(mensaje: string): Promise<string> {
    const m = mensaje.trim().toLowerCase()

    if (m === '' || m === 'hola' || m === 'menu' || m === 'menú' || m === 'buenas') return MENU_VENTAS
    if (m === '1' || m.includes('qué es') || m.includes('que es') || m.includes('cómo funciona') || m.includes('como funciona')) {
      return QUE_ES
    }
    if (m === '2' || m.includes('módulo') || m.includes('modulo')) return MODULOS
    if (m === '3' || m.includes('precio') || m.includes('plan') || m.includes('cuesta') || m.includes('vale')) return PRECIOS
    if (m === '4' || m === 'contacto' || m.includes('persona') || m.includes('llamen') || m.includes('vendedor') || m.includes('contacten')) {
      return PIDE_DATOS
    }

    if (m.startsWith('contacto ')) {
      const partes = mensaje.trim().slice('contacto '.length).split(',').map((p) => p.trim())
      const [nombre = '', email = '', telefono = ''] = partes
      try {
        const { numero } = await this.herramientas.guardarLead(nombre, email, telefono || null, null)
        return `¡Gracias ${nombre}! Quedaste registrado (#${numero}). Te contactaremos pronto al ${email}.`
      } catch (e) {
        // Los mensajes de validacion de la RPC son aptos para el visitante.
        const detalle = e instanceof Error ? e.message : 'No pudimos registrar tus datos.'
        return `${detalle} — escribe: contacto <tu nombre>, <tu correo>, <tu teléfono (opcional)>`
      }
    }

    return AYUDA_VENTAS
  }
}
