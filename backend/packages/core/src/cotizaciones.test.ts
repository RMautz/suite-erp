import { describe, expect, it } from 'vitest'
import { cotizacionVencida, puedeTransicionarCotizacion } from './cotizaciones'

describe('puedeTransicionarCotizacion', () => {
  it('borrador puede enviarse', () => {
    expect(puedeTransicionarCotizacion('borrador', 'enviada')).toBe(true)
  })
  it('borrador puede rechazarse (vía de corrección de una mal digitada)', () => {
    expect(puedeTransicionarCotizacion('borrador', 'rechazada')).toBe(true)
  })
  it('enviada puede aceptarse', () => {
    expect(puedeTransicionarCotizacion('enviada', 'aceptada')).toBe(true)
  })
  it('enviada puede rechazarse', () => {
    expect(puedeTransicionarCotizacion('enviada', 'rechazada')).toBe(true)
  })
  it('aceptada puede convertirse', () => {
    expect(puedeTransicionarCotizacion('aceptada', 'convertida')).toBe(true)
  })
  it('enviada no puede convertirse sin pasar por aceptada', () => {
    expect(puedeTransicionarCotizacion('enviada', 'convertida')).toBe(false)
  })
  it('ninguna otra transición es válida', () => {
    expect(puedeTransicionarCotizacion('borrador', 'aceptada')).toBe(false)
    expect(puedeTransicionarCotizacion('aceptada', 'enviada')).toBe(false)
    expect(puedeTransicionarCotizacion('rechazada', 'enviada')).toBe(false)
    expect(puedeTransicionarCotizacion('convertida', 'borrador')).toBe(false)
  })
})

describe('cotizacionVencida', () => {
  it('vencida cuando la validez pasó y sigue en borrador o enviada', () => {
    expect(cotizacionVencida('2026-07-01', '2026-07-15', 'borrador')).toBe(true)
    expect(cotizacionVencida('2026-07-01', '2026-07-15', 'enviada')).toBe(true)
  })
  it('no vencida sin fecha de validez', () => {
    expect(cotizacionVencida(null, '2026-07-15', 'enviada')).toBe(false)
  })
  it('vigente el día exacto de la validez (vencida = estrictamente pasada)', () => {
    expect(cotizacionVencida('2026-07-15', '2026-07-15', 'enviada')).toBe(false)
  })
  it('una aceptada nunca se muestra vencida (el trato quedó congelado)', () => {
    expect(cotizacionVencida('2026-07-01', '2026-07-15', 'aceptada')).toBe(false)
  })
  it('rechazada y convertida nunca se muestran vencidas', () => {
    expect(cotizacionVencida('2026-07-01', '2026-07-15', 'rechazada')).toBe(false)
    expect(cotizacionVencida('2026-07-01', '2026-07-15', 'convertida')).toBe(false)
  })
})
