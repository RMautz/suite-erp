import type { Mensaje, ProveedorCorreo } from './tipos'

const URL_RESEND = 'https://api.resend.com/emails'

// Adaptador de Resend. apiKey y remitente llegan por constructor desde env server-side; la
// apiKey viaja en Authorization: Bearer y JAMÁS se loguea (solo error.message, espejo de
// MercadoPagoPasarela.pedir). remitente tiene formato "Nombre <correo@dominio>".
export class ResendCorreo implements ProveedorCorreo {
  constructor(
    private readonly apiKey: string,
    private readonly remitente: string,
  ) {}

  async enviar(mensaje: Mensaje): Promise<{ id: string }> {
    try {
      const res = await fetch(URL_RESEND, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.remitente,
          to: [mensaje.para],
          subject: mensaje.asunto,
          html: mensaje.html,
        }),
      })
      if (!res.ok) throw new Error(`Resend respondió ${res.status}`)
      const data = (await res.json()) as { id?: unknown }
      return { id: String(data.id) }
    } catch (error) {
      // Solo el mensaje saneado: jamás la apiKey, el Bearer ni el body.
      console.error('Resend:', error instanceof Error ? error.message : 'error desconocido')
      throw error
    }
  }
}
