import { formatearCLP } from '@suite/core'
import type { ContextoBot, MotorBot } from './tipos'

// Motor scriptado 100% determinista (spec §3): reglas por palabra clave sobre las
// MISMAS herramientas que usa ClaudeMotor. Corre en demo/tests; sus goldens de
// conversacion son contractuales (seed y E2E los citan).
export const MENU_BOT = [
  'Hola! Soy el asistente de tu ERP. Escríbeme un número o una palabra:',
  '1. Ventas de hoy',
  '2. Ventas del mes',
  '3. Cobranza vencida',
  '4. Stock crítico',
  '5. Semáforo del auditor',
  '6. Saldo de un cliente (escribe: saldo <nombre>)',
  '7. Recordar una factura (escribe: recordar <folio>)',
  '8. Hablar con administración (escribe: ayuda <tu problema>)',
].join('\n')

export const AYUDA_BOT = 'No te entendí. Escribe "menú" para ver lo que puedo hacer.'

const ETIQUETA_SEMAFORO: Record<string, string> = { ok: 'verde', media: 'amarillo', critica: 'rojo' }

export class MockMotor implements MotorBot {
  async responder(ctx: ContextoBot, mensaje: string): Promise<string> {
    const t = ctx.herramientas
    const m = mensaje.trim().toLowerCase()

    if (m === 'hola' || m === 'menu' || m === 'menú' || m === 'buenas') return MENU_BOT

    if (m === '1' || m === 'ventas' || m.startsWith('ventas de hoy')) {
      const v = await t.ventasHoy()
      return `Ventas de hoy: ${formatearCLP(v.total)} en ${v.documentos} documento(s).`
    }

    if (m === '2' || m.startsWith('ventas del mes')) {
      const v = await t.ventasMes()
      return `Ventas del mes: ${formatearCLP(v.total)} en ${v.documentos} documento(s).`
    }

    if (m === '3' || m.includes('cobranza') || m.includes('vencid')) {
      const c = await t.cobranzaVencida()
      if (c.total <= 0) return 'No tienes facturas vencidas. Buen trabajo.'
      const lineas = c.deudores.map((d) => `- ${d.cliente}: ${formatearCLP(d.saldo)}`)
      return [`Cobranza vencida: ${formatearCLP(c.total)}.`, 'Top deudores:', ...lineas].join('\n')
    }

    if (m === '4' || m.includes('stock')) {
      const s = await t.stockCritico()
      if (s.length === 0) return 'Sin productos en stock crítico.'
      return ['Stock crítico:', ...s.map((p) => `- ${p.producto}: ${p.cantidad} unidades`)].join('\n')
    }

    if (m === '5' || m.includes('auditor') || m.includes('semaforo') || m.includes('semáforo')) {
      const s = await t.semaforoAuditor()
      const etiqueta = ETIQUETA_SEMAFORO[s.estado] ?? s.estado
      if (s.observaciones.length === 0) return `Semáforo del auditor: ${etiqueta}. Sin observaciones.`
      return [`Semáforo del auditor: ${etiqueta}.`, 'Observaciones:', ...s.observaciones.map((o) => `- ${o}`)].join('\n')
    }

    if (m === '6') return 'Escribe: saldo <nombre del cliente>'
    if (m.startsWith('saldo ')) {
      const nombre = mensaje.trim().slice('saldo '.length).trim()
      const s = await t.saldoCliente(nombre)
      if (!s) return `No encontré un cliente que se llame "${nombre}".`
      return `Saldo de ${s.cliente}: ${formatearCLP(s.saldo)}.`
    }

    if (m === '7') return 'Escribe: recordar <folio de la factura>'
    if (m.startsWith('recordar')) {
      const folio = Number.parseInt(m.slice('recordar'.length).trim(), 10)
      if (!Number.isInteger(folio) || folio <= 0) return 'Escribe: recordar <folio de la factura>'
      const r = await t.recordarFactura(folio)
      return r.detalle
    }

    if (m === '8' || m === 'ayuda' || m === 'soporte') return 'Escribe: ayuda <tu problema>'
    if (m.startsWith('ayuda ') || m.startsWith('soporte ')) {
      const problema = mensaje.trim().slice(m.startsWith('ayuda ') ? 'ayuda '.length : 'soporte '.length).trim()
      if (!problema) return 'Escribe: ayuda <tu problema>'
      const ticket = await t.crearTicket('Consulta por WhatsApp', problema)
      return `Ticket #${ticket.numero} creado. Administración te responderá pronto (míralo en el sitio, sección Consultas).`
    }

    return AYUDA_BOT
  }
}
