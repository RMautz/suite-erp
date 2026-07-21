import type { crearClienteServidor } from '@suite/auth/server'

// Un correo de la lista blanca de plataforma puede entrar al panel admin; misma
// semantica de parsing que apps/admin/lib/guardia.ts. Compartido por login y landing.
export function esAdminPlataforma(email: string): boolean {
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase())
}

type Supa = Awaited<ReturnType<typeof crearClienteServidor>>

// A donde vuelve un usuario con sesion. LA EMPRESA MANDA (fix 2026-07-21): quien
// tiene organizacion va a SU ERP aunque su correo este en la lista admin — el panel
// de plataforma es solo para cuentas admin SIN empresa (y siempre queda accesible
// directo en su URL). Sin membresia y sin lista -> ERP, que muestra su propio aviso.
export async function urlMiCuenta(supabase: Supa, email: string): Promise<string> {
  const { data: miembro } = await supabase
    .from('miembros')
    .select('organizacion_id')
    .eq('estado', 'activo')
    .limit(1)
    .maybeSingle()
  const urlErp = process.env.NEXT_PUBLIC_URL_ERP ?? '/login'
  if (!miembro && esAdminPlataforma(email) && process.env.NEXT_PUBLIC_URL_ADMIN) {
    return process.env.NEXT_PUBLIC_URL_ADMIN
  }
  return urlErp
}
