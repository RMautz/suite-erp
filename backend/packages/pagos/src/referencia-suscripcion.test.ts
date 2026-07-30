import { describe, expect, it } from 'vitest'
import {
  armarReferenciaSuscripcion,
  parsearReferenciaSuscripcion,
} from './referencia-suscripcion'
import type { ReferenciaSuscripcion } from './referencia-suscripcion'

const PAGO = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
const BUY_ORDER = 'a1b2c3d4e5f6a7b8c9d0e1f2a'

describe('referencia de suscripción', () => {
  it('round-trip: armar y parsear preserva pagoId y buyOrder', () => {
    const ref: ReferenciaSuscripcion = { pagoId: PAGO, buyOrder: BUY_ORDER }
    expect(armarReferenciaSuscripcion(ref)).toBe(`suscripcion:${PAGO}:${BUY_ORDER}`)
    expect(parsearReferenciaSuscripcion(armarReferenciaSuscripcion(ref))).toEqual(ref)
  })

  it('una referencia malformada (≠3 segmentos, prefijo ajeno o pagoId no-uuid) → null', () => {
    expect(parsearReferenciaSuscripcion(`suscripcion:${PAGO}`)).toBe(null)
    expect(parsearReferenciaSuscripcion(`suscripcion:${PAGO}:${BUY_ORDER}:extra`)).toBe(null)
    // La referencia del Plan 13 (4 segmentos, tipo 'factura') JAMÁS parsea aquí.
    expect(parsearReferenciaSuscripcion(`factura:${PAGO}:${BUY_ORDER}:x`)).toBe(null)
    expect(parsearReferenciaSuscripcion(`suscripcion:no-uuid:${BUY_ORDER}`)).toBe(null)
  })

  it('un buyOrder inválido (no alfanumérico o > 26 chars) → null', () => {
    expect(parsearReferenciaSuscripcion(`suscripcion:${PAGO}:tiene-guion`)).toBe(null)
    expect(parsearReferenciaSuscripcion(`suscripcion:${PAGO}:${'x'.repeat(27)}`)).toBe(null)
  })
})
