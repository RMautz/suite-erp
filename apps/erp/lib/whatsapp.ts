import 'server-only'
import { whatsappPorAmbiente, type ProveedorWhatsApp } from '@suite/whatsapp'

// Fail-closed (patron proveedorCorreoConfigurado P10): solo 'mock' | 'cloud'. El
// throw del selector se traga aqui y se vuelve el mensaje contractual de la UI —
// jamas llega un detalle del proveedor al usuario. PROHIBIDO el `?? 'mock'`.
export const WHATSAPP_NO_CONFIGURADO = 'WhatsApp no está configurado'

export function proveedorWhatsAppConfigurado(): ProveedorWhatsApp | null {
  const perilla = process.env.PROVEEDOR_WHATSAPP
  if (perilla !== 'mock' && perilla !== 'cloud') return null
  try {
    return whatsappPorAmbiente(
      perilla,
      process.env.WHATSAPP_TOKEN,
      process.env.WHATSAPP_PHONE_ID,
      process.env.WHATSAPP_VERIFY_TOKEN,
      process.env.WHATSAPP_APP_SECRET,
    )
  } catch {
    return null
  }
}
