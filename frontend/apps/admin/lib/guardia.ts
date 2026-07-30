import 'server-only'
import { crearClienteServidor } from '@suite/auth/server'

export async function verificarAdmin(): Promise<void> {
  const supabase = await crearClienteServidor()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const permitidos = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  if (!user?.email || !permitidos.includes(user.email.toLowerCase())) {
    throw new Error('No tienes permisos de administrador de la plataforma')
  }
}
