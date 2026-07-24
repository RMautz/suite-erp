import { describe, expect, it, vi } from 'vitest'
import { AYUDA_VENTAS, MENU_VENTAS, MockMotorVentas, type HerramientasVentas } from './ventas'

function herramientasFake(): HerramientasVentas {
  return { guardarLead: vi.fn(async () => ({ numero: 9 })) }
}

describe('MockMotorVentas (goldens contractuales)', () => {
  it('hola, vacío y menú devuelven el menú de ventas', async () => {
    const motor = new MockMotorVentas(herramientasFake())
    expect(await motor.responder('hola')).toBe(MENU_VENTAS)
    expect(await motor.responder('')).toBe(MENU_VENTAS)
    expect(MENU_VENTAS).toContain('4. Hablar con una persona')
  })

  it('1 explica qué es y cómo funciona (SII, 10 minutos, 14 días)', async () => {
    const r = await new MockMotorVentas(herramientasFake()).responder('1')
    expect(r).toContain('facturas y boletas electrónicas (SII)')
    expect(r).toContain('10 minutos')
    expect(r).toContain('14 días son gratis')
  })

  it('2 lista los módulos incluyendo el bot de WhatsApp', async () => {
    const r = await new MockMotorVentas(herramientasFake()).responder('2')
    expect(r).toContain('- Ventas: cotizaciones')
    expect(r).toContain('bot de WhatsApp')
  })

  it('3 y "precio" responden el plan y la prueba gratis', async () => {
    const motor = new MockMotorVentas(herramientasFake())
    const r = await motor.responder('3')
    expect(r).toContain('$29.990 + IVA')
    expect(await motor.responder('cuánto cuesta el precio?')).toBe(r)
  })

  it('contacto <datos> guarda el lead y agradece con nombre y número', async () => {
    const t = herramientasFake()
    const r = await new MockMotorVentas(t).responder('contacto Juan Pérez, juan@empresa.cl, +56911112222')
    expect(t.guardarLead).toHaveBeenCalledWith('Juan Pérez', 'juan@empresa.cl', '+56911112222', null)
    expect(r).toBe('¡Gracias Juan Pérez! Quedaste registrado (#9). Te contactaremos pronto al juan@empresa.cl.')
  })

  it('si guardarLead lanza, el motor relata el error y repite la pista', async () => {
    const t: HerramientasVentas = { guardarLead: vi.fn(async () => { throw new Error('Ingresa un correo válido') }) }
    const r = await new MockMotorVentas(t).responder('contacto Juan, no-es-correo')
    expect(r).toContain('Ingresa un correo válido')
    expect(r).toContain('contacto <tu nombre>')
  })

  it('4 pide los datos y lo desconocido devuelve la ayuda', async () => {
    const motor = new MockMotorVentas(herramientasFake())
    expect(await motor.responder('4')).toContain('contacto <tu nombre>')
    expect(await motor.responder('qué hora es')).toBe(AYUDA_VENTAS)
  })
})
