import { describe, expect, it } from 'vitest'
import { bajoMinimo, cantidadConSigno, formatearCantidad } from './stock'

describe('cantidadConSigno', () => {
  it('entrada suma, salida resta', () => {
    expect(cantidadConSigno('entrada', 10)).toBe(10)
    expect(cantidadConSigno('salida', 10)).toBe(-10)
  })
  it('rechaza cantidades no positivas', () => {
    expect(() => cantidadConSigno('entrada', 0)).toThrow()
    expect(() => cantidadConSigno('salida', -5)).toThrow()
  })
})

describe('bajoMinimo', () => {
  it('true cuando el stock es menor o igual al mínimo', () => {
    expect(bajoMinimo(3, 5)).toBe(true)
    expect(bajoMinimo(5, 5)).toBe(true)
    expect(bajoMinimo(6, 5)).toBe(false)
    expect(bajoMinimo(-1, 0)).toBe(true)
  })
})

describe('formatearCantidad', () => {
  it('separa miles y conserva el signo', () => {
    expect(formatearCantidad(1500)).toBe('1.500')
    expect(formatearCantidad(0)).toBe('0')
    expect(formatearCantidad(-3)).toBe('-3')
    expect(formatearCantidad(-12000)).toBe('-12.000')
  })
})
