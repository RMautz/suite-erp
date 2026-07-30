import type { ProveedorWhatsApp } from './tipos'

// Adaptador de WhatsApp Business Cloud API (Meta). Credenciales por constructor
// desde env server-side; el token viaja en Authorization: Bearer y JAMAS se loguea
// (solo error.message, espejo de ResendCorreo P10). El parametro `plantilla` se
// ignora hoy: envio por HSM cuando exista la credencial #15 (spec §9).
export class WhatsAppCloudAPI implements ProveedorWhatsApp {
  constructor(
    private readonly token: string,
    private readonly phoneId: string,
  ) {}

  async enviarTexto(telefono: string, texto: string): Promise<void> {
    try {
      const res = await fetch(`https://graph.facebook.com/v20.0/${this.phoneId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: telefono,
          type: 'text',
          text: { body: texto },
        }),
      })
      if (!res.ok) throw new Error(`WhatsApp Cloud respondió ${res.status}`)
    } catch (error) {
      // Solo el mensaje saneado: jamas el token, el Bearer ni el body.
      console.error('WhatsApp:', error instanceof Error ? error.message : 'error desconocido')
      throw error
    }
  }
}
