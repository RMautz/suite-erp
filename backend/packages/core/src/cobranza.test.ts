import { describe, expect, it } from 'vitest'
import { cuadraAplicaciones, estaVencido, saldoDocumento } from './cobranza'

describe('saldoDocumento', () => {
  it('resta pagos y notas de crédito del total', () => {
    expect(saldoDocumento(100000, 40000, 10000)).toBe(50000)
  })
  it('puede quedar negativo (a favor del cliente)', () => {
    expect(saldoDocumento(100000, 50000, 60000)).toBe(-10000)
  })
})

describe('estaVencido', () => {
  it('vencido cuando la fecha pasó y hay saldo', () => {
    expect(estaVencido('2026-07-01', '2026-07-14', 5000)).toBe(true)
  })
  it('no vencido si el saldo es 0 o negativo', () => {
    expect(estaVencido('2026-07-01', '2026-07-14', 0)).toBe(false)
  })
  it('no vencido sin fecha de vencimiento', () => {
    expect(estaVencido(null, '2026-07-14', 5000)).toBe(false)
  })
  it('no vencido si vence hoy (vencida = estrictamente pasada)', () => {
    expect(estaVencido('2026-07-14', '2026-07-14', 5000)).toBe(false)
  })
})

describe('cuadraAplicaciones', () => {
  it('cuadra cuando la suma iguala el monto', () => {
    expect(cuadraAplicaciones([{ monto: 40000 }, { monto: 20000 }], 60000)).toBe(true)
  })
  it('no cuadra cuando difiere', () => {
    expect(cuadraAplicaciones([{ monto: 40000 }], 60000)).toBe(false)
  })
})
