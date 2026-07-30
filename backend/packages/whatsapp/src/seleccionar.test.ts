import { describe, expect, it } from 'vitest'
import { MockWhatsApp } from './mock'
import { WhatsAppCloudAPI } from './cloud'
import { whatsappPorAmbiente } from './seleccionar'

describe('whatsappPorAmbiente (fail-closed)', () => {
  it("'mock' construye MockWhatsApp y 'cloud' completo construye WhatsAppCloudAPI", () => {
    expect(whatsappPorAmbiente('mock', undefined, undefined, undefined, undefined)).toBeInstanceOf(MockWhatsApp)
    expect(whatsappPorAmbiente('cloud', 't', 'p', 'v', 's')).toBeInstanceOf(WhatsAppCloudAPI)
  })

  it('perilla ausente/desconocida o cloud incompleto lanza — JAMÁS cae a mock', () => {
    expect(() => whatsappPorAmbiente(undefined, 't', 'p', 'v', 's')).toThrow('WhatsApp no está configurado')
    expect(() => whatsappPorAmbiente('twilio', 't', 'p', 'v', 's')).toThrow('WhatsApp no está configurado')
    expect(() => whatsappPorAmbiente('cloud', undefined, 'p', 'v', 's')).toThrow('WhatsApp no está configurado')
    expect(() => whatsappPorAmbiente('cloud', 't', '', 'v', 's')).toThrow('WhatsApp no está configurado')
    expect(() => whatsappPorAmbiente('cloud', 't', 'p', undefined, 's')).toThrow('WhatsApp no está configurado')
    expect(() => whatsappPorAmbiente('cloud', 't', 'p', 'v', '')).toThrow('WhatsApp no está configurado')
  })
})
