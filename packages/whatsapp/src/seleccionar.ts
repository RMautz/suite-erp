import { MockWhatsApp } from './mock'
import { WhatsAppCloudAPI } from './cloud'
import type { ProveedorWhatsApp } from './tipos'

// Seleccion por env FAIL-CLOSED (patron correoPorAmbiente P10): 'mock' -> MockWhatsApp,
// 'cloud' -> WhatsAppCloudAPI y EXIGE las 4 variables (spec §2) — token y phoneId los
// usa el adaptador; verifyToken y appSecret los consume el webhook, pero un cloud a
// medias no debe arrancar. Cualquier otro valor o ausente -> THROW. Sin `?? 'mock'`.
const ERROR_NO_CONFIGURADO = 'WhatsApp no está configurado'

export function whatsappPorAmbiente(
  perilla: string | undefined,
  token: string | undefined,
  phoneId: string | undefined,
  verifyToken: string | undefined,
  appSecret: string | undefined,
): ProveedorWhatsApp {
  if (perilla === 'mock') return new MockWhatsApp()
  if (perilla === 'cloud') {
    if (!token || !phoneId || !verifyToken || !appSecret) throw new Error(ERROR_NO_CONFIGURADO)
    return new WhatsAppCloudAPI(token, phoneId)
  }
  throw new Error(ERROR_NO_CONFIGURADO)
}
