'use server'

import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@suite/auth/server'

// Estado type-only (permitido en 'use server': se borra al compilar).
export type EstadoConsulta = { error?: string; ok?: boolean }

// La RPC valida todo (asunto/mensaje/organizacion) con mensajes byte-exactos que se
// muestran tal cual. El email y la organizacion salen de la sesion, no del form.
export async function crearConsulta(_prev: EstadoConsulta, formData: FormData): Promise<EstadoConsulta> {
  const asunto = String(formData.get('asunto') ?? '')
  const mensaje = String(formData.get('mensaje') ?? '')
  const supabase = await crearClienteServidor()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Inicia sesión para enviar una consulta' }
  const { error } = await supabase.rpc('crear_consulta_admin', { p_asunto: asunto, p_mensaje: mensaje })
  if (error) return { error: error.message }
  revalidatePath('/consultas')
  return { ok: true }
}
