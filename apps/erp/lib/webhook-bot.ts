import 'server-only'
import { headers } from 'next/headers'

// POST interno al webhook real con el shape de Meta (compartido por el simulador
// /mock-whatsapp y el widget de chat embebido). Solo tiene sentido en modo mock:
// el webhook exige firma en cloud y el bypass esta vetado en produccion.
export async function postearAlWebhook(telefono: string, texto: string): Promise<{ error?: string }> {
  const h = await headers()
  const host = h.get('host') ?? 'localhost:3001'
  const proto = h.get('x-forwarded-proto') ?? 'http'
  const cuerpo = JSON.stringify({
    entry: [{ changes: [{ value: { messages: [{ from: telefono.slice(1), type: 'text', text: { body: texto } }] } }] }],
  })
  const respuesta = await fetch(`${proto}://${host}/api/webhooks/whatsapp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: cuerpo,
    cache: 'no-store',
  })
  if (!respuesta.ok) return { error: `El webhook respondió ${respuesta.status}` }
  return {}
}
