import { describe, expect, it } from 'vitest'
import {
  CODIGO_SII,
  esTributario,
  formatearFolio,
  subtotalLinea,
  totalesDocumento,
} from './ventas'

describe('CODIGO_SII', () => {
  it('mapea los tipos a sus códigos SII', () => {
    expect(CODIGO_SII.factura).toBe(33)
    expect(CODIGO_SII.boleta).toBe(39)
    expect(CODIGO_SII.nota_credito).toBe(61)
    expect(CODIGO_SII.nota_venta).toBeNull()
  })
})

describe('esTributario', () => {
  it('la nota de venta no es tributaria; el resto sí', () => {
    expect(esTributario('nota_venta')).toBe(false)
    expect(esTributario('factura')).toBe(true)
    expect(esTributario('boleta')).toBe(true)
    expect(esTributario('nota_credito')).toBe(true)
  })
})

describe('formatearFolio', () => {
  it('formatea el folio', () => {
    expect(formatearFolio(1)).toBe('N° 1')
    expect(formatearFolio(1500)).toBe('N° 1500')
  })
})

describe('subtotalLinea', () => {
  it('multiplica cantidad por precio y redondea', () => {
    expect(subtotalLinea({ productoId: 'p', descripcion: 'x', cantidad: 3, precioNeto: 990, exenta: false })).toBe(2970)
  })
})

describe('totalesDocumento', () => {
  it('suma líneas afectas y separa exentas', () => {
    const t = totalesDocumento([
      { productoId: 'a', descripcion: 'A', cantidad: 2, precioNeto: 5000, exenta: false },
      { productoId: 'b', descripcion: 'B', cantidad: 1, precioNeto: 3000, exenta: true },
    ])
    expect(t).toEqual({ neto: 10000, exento: 3000, iva: 1900, total: 14900 })
  })
  it('documento vacío da cero', () => {
    expect(totalesDocumento([])).toEqual({ neto: 0, exento: 0, iva: 0, total: 0 })
  })
})
