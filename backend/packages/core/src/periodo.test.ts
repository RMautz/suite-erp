import { describe, expect, it } from 'vitest'
import { periodoAnterior, rangoDeMes, rangoDePeriodo, variacion } from './periodo'

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

describe('rangoDePeriodo', () => {
  it('año completo', () => {
    expect(rangoDePeriodo('2026')).toEqual({ desde: '2026-01-01', hasta: '2026-12-31' })
  })
  it('primer trimestre', () => {
    expect(rangoDePeriodo('2026-T1')).toEqual({ desde: '2026-01-01', hasta: '2026-03-31' })
  })
  it('cuarto trimestre', () => {
    expect(rangoDePeriodo('2026-T4')).toEqual({ desde: '2026-10-01', hasta: '2026-12-31' })
  })
  it('mes delega en rangoDeMes', () => {
    expect(rangoDePeriodo('2026-07')).toEqual({ desde: '2026-07-01', hasta: '2026-07-31' })
  })
  it('trimestre fuera de rango es null', () => {
    expect(rangoDePeriodo('2026-T5')).toBeNull()
  })
  it('formato malformado es null', () => {
    expect(rangoDePeriodo('julio')).toBeNull()
  })
})

describe('periodoAnterior', () => {
  it('mes normal retrocede un mes', () => {
    expect(periodoAnterior('2026-07')).toBe('2026-06')
  })
  it('enero cruza al diciembre anterior', () => {
    expect(periodoAnterior('2026-01')).toBe('2025-12')
  })
  it('T1 cruza al T4 anterior', () => {
    expect(periodoAnterior('2026-T1')).toBe('2025-T4')
  })
  it('trimestre normal retrocede uno', () => {
    expect(periodoAnterior('2026-T3')).toBe('2026-T2')
  })
  it('año retrocede uno', () => {
    expect(periodoAnterior('2026')).toBe('2025')
  })
  it('formato malformado es null', () => {
    expect(periodoAnterior('2026-13')).toBeNull()
  })
})

describe('variacion', () => {
  it('subida lleva signo +', () => {
    expect(variacion(140000, 100000)).toBe('+40%')
  })
  it('caída lleva signo -', () => {
    expect(variacion(60000, 100000)).toBe('-40%')
  })
  it('base negativa (pérdida anterior) usa el valor absoluto', () => {
    expect(variacion(50000, -100000)).toBe('+150%')
  })
  it('anterior 0 no divide: —', () => {
    expect(variacion(50000, 0)).toBe('—')
  })
})
