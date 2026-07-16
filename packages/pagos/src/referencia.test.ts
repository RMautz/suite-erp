import { describe, expect, it } from 'vitest'
import { armarReferencia, parsearReferencia } from './referencia'
import type { ReferenciaPago } from './tipos'

const E = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
const O = 'aaaa0001-0000-0000-0000-aaaaaaaaaaaa'
const L = 'cccccccc-0000-0000-0000-aaaaaaaaaaaa'

describe('referencia de pago', () => {
  it('round-trip: armar y parsear preserva factura, proforma y cotización', () => {
    for (const tipo of ['factura', 'proforma', 'cotizacion'] as const) {
      const ref: ReferenciaPago = { tipo, empresaId: E, objetoId: O, linkId: L }
      expect(armarReferencia(ref)).toBe(`${tipo}:${E}:${O}:${L}`)
      expect(parsearReferencia(armarReferencia(ref))).toEqual(ref)
    }
  })

  it('una referencia con ≠ 4 segmentos → null', () => {
    expect(parsearReferencia(`factura:${E}:${O}`)).toBe(null)
    expect(parsearReferencia(`factura:${E}:${O}:${L}:extra`)).toBe(null)
  })

  it('empresa_id que no es un uuid → null', () => {
    expect(parsearReferencia(`factura:no-uuid:${O}:${L}`)).toBe(null)
  })

  it('un tipo fuera del enum → null', () => {
    expect(parsearReferencia(`boleta:${E}:${O}:${L}`)).toBe(null)
  })
})
