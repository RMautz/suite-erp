'use server'

import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'

// Cerrar sesion desde el menu Mi cuenta de la landing (pedido 2026-07-24). Misma
// semantica que el ERP (signOut global); el visitante queda en la portada.
export async function cerrarSesion(): Promise<void> {
  const supabase = await crearClienteServidor()
  await supabase.auth.signOut()
  redirect('/')
}
