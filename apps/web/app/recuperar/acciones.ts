'use server'

import { headers } from 'next/headers'
import { crearClienteServidor } from '@suite/auth/server'

// Estado type-only (permitido en 'use server': se borra al compilar).
export type EstadoRecuperar = { error?: string; ok?: boolean }

// Anti-enumeración: SIEMPRE responde el mismo éxito genérico, exista o no el correo
// (y aunque GoTrue falle por rate limit — se loguea, no se filtra). El correo llega
// con un enlace a /auth/confirm, que canjea el código y pasa a /restablecer.
// El redirectTo se arma del ORIGEN del request (apps/web no define NEXT_PUBLIC_URL_WEB;
// además así localhost y 127.0.0.1 calzan solos). GoTrue exige que la URL esté en
// additional_redirect_urls (config.toml en local; en producción, en el dashboard).
export async function solicitarRecuperacion(_prev: EstadoRecuperar, formData: FormData): Promise<EstadoRecuperar> {
  const email = String(formData.get('email') ?? '').trim()
  if (!email.includes('@')) return { error: 'Ingresa un correo válido' }

  const h = await headers()
  const host = h.get('host') ?? 'localhost:3000'
  const proto = h.get('x-forwarded-proto') ?? 'http'

  const supabase = await crearClienteServidor()
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${proto}://${host}/auth/confirm`,
  })
  if (error) console.error('resetPasswordForEmail:', error.message)
  return { ok: true }
}
