import 'server-only'
import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'

/** Decision pura de autorizacion: testeable sin Supabase ni Next. */
export function esAdmin(email: string | null | undefined, listaAdmins: string | undefined): boolean {
  if (!email) return false
  return (listaAdmins ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase())
}

/**
 * Corta el render de cualquier pagina o accion del panel que no sea de un admin.
 *
 * Antes lanzaba Error. Como el middleware solo ataja al visitante *sin sesion*,
 * un usuario logueado sin permisos llegaba a ejecutar la pagina, el throw subia
 * sin boundary y Next respondia 500 con la pantalla blanca "Application error"
 * en vez de mandarlo al login. Ahora redirige.
 *
 * La regla de acceso no cambia, solo el modo de fallo: `redirect()` interrumpe
 * igual que un throw (lanza NEXT_REDIRECT), asi que ningun caller continua
 * ejecutando. Ningun call site envuelve esta funcion en try/catch, condicion
 * necesaria para que la interrupcion no se trague.
 */
export async function verificarAdmin(): Promise<void> {
  const supabase = await crearClienteServidor()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect(`${process.env.NEXT_PUBLIC_URL_WEB}/login`)
  if (!esAdmin(user.email, process.env.ADMIN_EMAILS)) redirect('/sin-acceso')
}
