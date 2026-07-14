import { describe, expect, it } from 'vitest'
import { rangoDeMes } from './periodo'

describe('rangoDeMes', () => {
  it('devuelve primer y último día del mes', () => {
    expect(rangoDeMes('2026-07')).toEqual({ desde: '2026-07-01', hasta: '2026-07-31' })
  })
  it('maneja febrero bisiesto', () => {
    expect(rangoDeMes('2028-02')).toEqual({ desde: '2028-02-01', hasta: '2028-02-29' })
  })
  it('mes fuera de rango es null', () => {
    expect(rangoDeMes('2026-13')).toBeNull()
  })
  it('formato malformado es null', () => {
    expect(rangoDeMes('julio')).toBeNull()
  })
})
