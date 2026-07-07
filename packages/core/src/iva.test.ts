import { describe, expect, it } from 'vitest'
import { calcularTotales, ivaDesdeNeto, netoDesdeBruto, TASA_IVA } from './iva'

describe('ivaDesdeNeto', () => {
  it('calcula 19% redondeado a entero', () => {
    expect(ivaDesdeNeto(10000)).toBe(1900)
    expect(ivaDesdeNeto(999)).toBe(190) // 189.81 → 190
    expect(ivaDesdeNeto(0)).toBe(0)
  })
})

describe('netoDesdeBruto', () => {
  it('invierte el IVA redondeando a entero', () => {
    expect(netoDesdeBruto(11900)).toBe(10000)
    expect(netoDesdeBruto(1190)).toBe(1000)
    expect(netoDesdeBruto(1000)).toBe(840) // 840.336 → 840
  })
})

describe('calcularTotales', () => {
  it('suma líneas afectas', () => {
    const totales = calcularTotales([
      { cantidad: 2, precioNeto: 5000 },
      { cantidad: 1, precioNeto: 990 },
    ])
    expect(totales).toEqual({ neto: 10990, exento: 0, iva: 2088, total: 13078 })
  })
  it('separa líneas exentas (sin IVA)', () => {
    const totales = calcularTotales([
      { cantidad: 1, precioNeto: 10000 },
      { cantidad: 1, precioNeto: 5000, exenta: true },
    ])
    expect(totales).toEqual({ neto: 10000, exento: 5000, iva: 1900, total: 16900 })
  })
  it('lista vacía da cero', () => {
    expect(calcularTotales([])).toEqual({ neto: 0, exento: 0, iva: 0, total: 0 })
  })
  it('la tasa es parametrizable', () => {
    expect(calcularTotales([{ cantidad: 1, precioNeto: 1000 }], 0.1).iva).toBe(100)
  })
  it('expone la tasa vigente', () => {
    expect(TASA_IVA).toBe(0.19)
  })
})
