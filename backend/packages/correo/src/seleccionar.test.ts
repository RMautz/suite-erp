import { describe, expect, it } from 'vitest'
import { MockCorreo } from './mock'
import { ResendCorreo } from './resend'
import { correoPorAmbiente } from './seleccionar'

describe('correoPorAmbiente (fail-closed)', () => {
  it("'mock' construye MockCorreo y 'resend' completo construye ResendCorreo", () => {
    expect(correoPorAmbiente('mock', undefined, undefined)).toBeInstanceOf(MockCorreo)
    expect(correoPorAmbiente('resend', 'RESEND-KEY', 'Suite ERP <envios@suite.cl>')).toBeInstanceOf(ResendCorreo)
  })

  it('perilla ausente/desconocida o resend incompleto lanza — JAMÁS cae a mock', () => {
    expect(() => correoPorAmbiente(undefined, 'k', 'r')).toThrow('Proveedor de correo no configurado')
    expect(() => correoPorAmbiente('sendgrid', 'k', 'r')).toThrow('Proveedor de correo no configurado')
    // resend con apiKey o remitente ausente/vacío también falla (nunca envío sin credenciales).
    expect(() => correoPorAmbiente('resend', undefined, 'r')).toThrow('Proveedor de correo no configurado')
    expect(() => correoPorAmbiente('resend', 'k', undefined)).toThrow('Proveedor de correo no configurado')
    expect(() => correoPorAmbiente('resend', '', 'r')).toThrow('Proveedor de correo no configurado')
  })
})
