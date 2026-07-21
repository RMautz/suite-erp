'use server'

import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import type { EstadoForm } from '../tipos'

// La sesión de recuperación la dejó /auth/confirm; sin ella (enlace viejo, cookie
// borrada) el cambio se rechaza. Misma regla de largo y mensaje que el registro.
// Decisión explícita (review 2026-07-20): CUALQUIER sesión viva puede cambiar la
// contraseña aquí sin la anterior — es el default de Supabase (secure_password_change
// off) y el vector exige una máquina desbloqueada con sesión activa, donde el atacante
// ya ve todos los datos. Upgrade path si se endurece: secure_password_change=true en
// GoTrue, o exigir factor 'recovery' en el AMR del JWT antes de updateUser.
export async function cambiarPassword(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const password = String(formData.get('password') ?? '')
  const confirmar = String(formData.get('confirmar') ?? '')
  if (password.length < 8) return { error: 'La contraseña debe tener al menos 8 caracteres' }
  if (password !== confirmar) return { error: 'Las contraseñas no coinciden' }

  const supabase = await crearClienteServidor()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'El enlace expiró o no es válido. Pide uno nuevo desde "Recuperar contraseña".' }

  const { error } = await supabase.auth.updateUser({ password })
  if (error) {
    if (error.code === 'same_password') return { error: 'La contraseña nueva debe ser distinta a la anterior' }
    console.error('cambiarPassword:', error.message)
    return { error: 'No se pudo cambiar la contraseña. Inténtalo de nuevo.' }
  }
  redirect(process.env.NEXT_PUBLIC_URL_ERP!)
}
