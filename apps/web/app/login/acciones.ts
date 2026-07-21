'use server'

import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { esAdminPlataforma } from '../../lib/plataforma'
import type { EstadoForm } from '../tipos'

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
