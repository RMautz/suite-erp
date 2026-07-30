import { describe, expect, it } from 'vitest'
import { estadoOrdenTrasRecepcion, pendienteLinea, totalOrden } from './compras'

describe('pendienteLinea', () => {
  it('resta lo recibido de lo pedido', () => {
    expect(pendienteLinea({ cantidadPedida: 10, cantidadRecibida: 4 })).toBe(6)
  })
  it('nunca es negativo', () => {
    expect(pendienteLinea({ cantidadPedida: 5, cantidadRecibida: 9 })).toBe(0)
  })
})

describe('estadoOrdenTrasRecepcion', () => {
  it('parcial si alguna línea tiene pendiente', () => {
    expect(
      estadoOrdenTrasRecepcion([
        { cantidadPedida: 10, cantidadRecibida: 10 },
        { cantidadPedida: 5, cantidadRecibida: 3 },
      ])
    ).toBe('recibida_parcial')
  })
  it('total si todas las líneas están completas', () => {
    expect(
      estadoOrdenTrasRecepcion([
        { cantidadPedida: 10, cantidadRecibida: 10 },
        { cantidadPedida: 5, cantidadRecibida: 5 },
      ])
    ).toBe('recibida_total')
  })
})

describe('totalOrden', () => {
  it('suma cantidad x costo por línea (CLP entero)', () => {
    expect(
      totalOrden([
        { cantidad: 10, costoUnitario: 1500 },
        { cantidad: 2, costoUnitario: 89900 },
      ])
    ).toBe(194800)
  })
  it('orden vacía vale 0', () => {
    expect(totalOrden([])).toBe(0)
  })
})
