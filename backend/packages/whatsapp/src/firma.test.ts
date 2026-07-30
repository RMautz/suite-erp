import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verificarFirma } from './firma'

// Vector calculado con node:crypto directamente (mismo algoritmo que usa Meta):
// valida el contrato del prefijo 'sha256=' y la comparacion, no re-implementa HMAC.
function firmar(cuerpo: string, secreto: string): string {
  return 'sha256=' + createHmac('sha256', secreto).update(cuerpo, 'utf8').digest('hex')
}

describe('verificarFirma', () => {
  it('acepta la firma HMAC-SHA256 correcta del cuerpo crudo', () => {
    const cuerpo = '{"entry":[{"changes":[]}]}'
    expect(verificarFirma(cuerpo, firmar(cuerpo, 'app-secret'), 'app-secret')).toBe(true)
  })

  it('rechaza firma de otro secreto y cuerpo alterado', () => {
    const cuerpo = '{"entry":[]}'
    expect(verificarFirma(cuerpo, firmar(cuerpo, 'otro-secreto'), 'app-secret')).toBe(false)
    expect(verificarFirma(cuerpo + ' ', firmar(cuerpo, 'app-secret'), 'app-secret')).toBe(false)
  })

  it('rechaza header ausente, sin prefijo sha256= o de largo incorrecto', () => {
    expect(verificarFirma('x', null, 's')).toBe(false)
    expect(verificarFirma('x', 'md5=abc', 's')).toBe(false)
    expect(verificarFirma('x', 'sha256=abc', 's')).toBe(false)
  })
})
