import { describe, expect, it } from 'vitest'
import { cifrar, descifrar, generarClave } from './cripto'

const CLAVE = 'a'.repeat(64) // 32 bytes en hex

describe('cifrado del certificado', () => {
  it('round-trip: descifrar(cifrar(x)) === x', () => {
    const secreto = Buffer.from('contenido del certificado .pfx binario \x00\x01\x02')
    const paquete = cifrar(secreto, CLAVE)
    expect(paquete).not.toContain('certificado') // no filtra el plano
    expect(descifrar(paquete, CLAVE).equals(secreto)).toBe(true)
  })

  it('cada cifrado usa un IV distinto (no determinista)', () => {
    const x = Buffer.from('mismo')
    expect(cifrar(x, CLAVE)).not.toBe(cifrar(x, CLAVE))
  })

  it('una clave incorrecta falla al descifrar (tag GCM)', () => {
    const paquete = cifrar(Buffer.from('x'), CLAVE)
    expect(() => descifrar(paquete, 'b'.repeat(64))).toThrow()
  })

  it('generarClave produce 64 caracteres hex', () => {
    expect(generarClave()).toMatch(/^[0-9a-f]{64}$/)
  })
})
