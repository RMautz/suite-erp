import { describe, expect, it, vi } from 'vitest'
import { AYUDA_BOT, MENU_BOT, MockMotor } from './mock'
import type { ContextoBot, HerramientasBot } from './tipos'

// Herramientas fake 100% deterministas: los goldens de abajo son contractuales.
function herramientasFake(): HerramientasBot {
  return {
    ventasHoy: vi.fn(async () => ({ total: 1190000, documentos: 3 })),
    ventasMes: vi.fn(async () => ({ total: 25000000, documentos: 42 })),
    cobranzaVencida: vi.fn(async () => ({
      total: 2380000,
      deudores: [
        { cliente: 'Comercial del Sur Ltda', saldo: 1190000 },
        { cliente: 'Ferretería El Roble EIRL', saldo: 1190000 },
      ],
    })),
    stockCritico: vi.fn(async () => [{ producto: 'Aceite 15W40', cantidad: 2 }]),
    semaforoAuditor: vi.fn(async () => ({ estado: 'media', observaciones: ['Factura vencida sin gestión: Factura N° 1043'] })),
    saldoCliente: vi.fn(async (nombre: string) =>
      nombre.toLowerCase().includes('sur') ? { cliente: 'Comercial del Sur Ltda', saldo: 1190000 } : null,
    ),
    recordarFactura: vi.fn(async (folio: number) => ({ ok: true, detalle: `Recordatorio enviado por la factura N° ${folio}.` })),
  }
}

function ctx(herramientas: HerramientasBot): ContextoBot {
  return { nombreEmpresa: 'Demo Transportes SpA', rol: 'dueno', historial: [], herramientas }
}

describe('MockMotor (goldens contractuales)', () => {
  it('hola y menú devuelven el menú numerado 1-7', async () => {
    const motor = new MockMotor()
    const t = herramientasFake()
    expect(await motor.responder(ctx(t), 'hola')).toBe(MENU_BOT)
    expect(await motor.responder(ctx(t), 'Menú')).toBe(MENU_BOT)
    expect(MENU_BOT).toContain('7. Recordar una factura')
  })

  it('1 y "ventas" responden ventas de hoy con CLP', async () => {
    const t = herramientasFake()
    const golden = 'Ventas de hoy: $1.190.000 en 3 documento(s).'
    expect(await new MockMotor().responder(ctx(t), '1')).toBe(golden)
    expect(await new MockMotor().responder(ctx(t), 'ventas')).toBe(golden)
    expect(t.ventasHoy).toHaveBeenCalledTimes(2)
  })

  it('2 responde ventas del mes', async () => {
    const t = herramientasFake()
    expect(await new MockMotor().responder(ctx(t), '2')).toBe('Ventas del mes: $25.000.000 en 42 documento(s).')
  })

  it('3 responde cobranza vencida con top deudores', async () => {
    const t = herramientasFake()
    expect(await new MockMotor().responder(ctx(t), '3')).toBe(
      'Cobranza vencida: $2.380.000.\nTop deudores:\n- Comercial del Sur Ltda: $1.190.000\n- Ferretería El Roble EIRL: $1.190.000',
    )
  })

  it('4 responde stock crítico', async () => {
    const t = herramientasFake()
    expect(await new MockMotor().responder(ctx(t), '4')).toBe('Stock crítico:\n- Aceite 15W40: 2 unidades')
  })

  it('5 responde el semáforo con observaciones', async () => {
    const t = herramientasFake()
    expect(await new MockMotor().responder(ctx(t), '5')).toBe(
      'Semáforo del auditor: amarillo.\nObservaciones:\n- Factura vencida sin gestión: Factura N° 1043',
    )
  })

  it('saldo <nombre> encuentra y reporta no-encontrado', async () => {
    const t = herramientasFake()
    expect(await new MockMotor().responder(ctx(t), 'saldo del Sur')).toBe('Saldo de Comercial del Sur Ltda: $1.190.000.')
    expect(await new MockMotor().responder(ctx(t), 'saldo Nadie SpA')).toBe('No encontré un cliente que se llame "Nadie SpA".')
  })

  it('recordar 1043 dispara la herramienta y devuelve su detalle; 7 da la pista', async () => {
    const t = herramientasFake()
    expect(await new MockMotor().responder(ctx(t), 'recordar 1043')).toBe('Recordatorio enviado por la factura N° 1043.')
    expect(t.recordarFactura).toHaveBeenCalledWith(1043)
    expect(await new MockMotor().responder(ctx(t), '7')).toBe('Escribe: recordar <folio de la factura>')
  })

  it('mensaje desconocido devuelve la ayuda', async () => {
    const t = herramientasFake()
    expect(await new MockMotor().responder(ctx(t), 'qué hora es')).toBe(AYUDA_BOT)
  })
})
