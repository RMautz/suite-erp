'use server'

import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import type { EstadoForm } from '../tipos'

// Un correo de la lista blanca de plataforma aterriza directo en el panel admin;
// el resto va al ERP. Misma semántica de parsing que apps/admin/lib/guardia.ts.
function esAdminPlataforma(email: string): boolean {
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase())
}

export async function iniciarSesion(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')

  const supabase = await crearClienteServidor()
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) return { error: 'Correo o contraseña incorrectos' }

  if (esAdminPlataforma(email) && process.env.NEXT_PUBLIC_URL_ADMIN) {
    redirect(process.env.NEXT_PUBLIC_URL_ADMIN)
  }
  redirect(process.env.NEXT_PUBLIC_URL_ERP!)
}
