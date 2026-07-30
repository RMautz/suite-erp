import { describe, expect, it } from 'vitest'
import { esTelefonoE164 } from './telefono'

describe('esTelefonoE164', () => {
  it('acepta E.164 válidos', () => {
    expect(esTelefonoE164('+56912345678')).toBe(true)
    expect(esTelefonoE164('+12025550123')).toBe(true)
    expect(esTelefonoE164('+549112345678')).toBe(true)
  })

  it('rechaza formatos inválidos (sin +, con espacios, cero inicial, corto, letras)', () => {
    expect(esTelefonoE164('56912345678')).toBe(false)
    expect(esTelefonoE164('+56 9 1234 5678')).toBe(false)
    expect(esTelefonoE164('+056912345678')).toBe(false)
    expect(esTelefonoE164('+5691234')).toBe(false)
    expect(esTelefonoE164('+56abc45678')).toBe(false)
    expect(esTelefonoE164('')).toBe(false)
  })
})
