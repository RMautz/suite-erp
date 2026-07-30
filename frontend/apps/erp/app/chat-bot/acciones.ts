'use server'

import { crearClienteServidor } from '@suite/auth/server'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import { postearAlWebhook } from '../../lib/webhook-bot'

// Acciones del widget de chat embebido (spec tickets 2026-07-22, acceso visible):
// mismo bot real de WhatsApp — webhook, motor y log — presentado en un panel.

export type MensajeChat = { id: string; direccion: string; contenido: string; creado_en: string }

// Hilo del telefono vinculado, en orden cronologico (RLS: dueno/admin/contador).
export async function hiloDelBot(telefono: string): Promise<MensajeChat[]> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return []
  const supabase = await crearClienteServidor()
  const { data } = await supabase
    .from('whatsapp_mensajes')
    .select('id, direccion, contenido, creado_en')
    .eq('empresa_id', activa.id)
    .eq('telefono', telefono)
    .eq('origen', 'bot')
    .order('creado_en', { ascending: false })
    .limit(30)
  return (data ?? []).reverse()
}

// Envia como si el mensaje llegara del telefono vinculado. Gate estricto de mock
// (en produccion el widget ofrece wa.me, no inyecta al webhook real).
export async function enviarAlBot(telefono: string, texto: string): Promise<{ error?: string }> {
  if (process.env.PROVEEDOR_WHATSAPP !== 'mock') return { error: 'El chat embebido no está disponible' }
  const limpio = texto.trim()
  if (!limpio) return { error: 'Escribe un mensaje' }
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  return postearAlWebhook(telefono, limpio)
}
