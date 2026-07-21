// Un correo de la lista blanca de plataforma aterriza en el panel admin; el resto
// va al ERP. Compartido por el login y la landing (misma semantica que
// apps/admin/lib/guardia.ts).
export function esAdminPlataforma(email: string): boolean {
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase())
}

// A donde vuelve un usuario con sesion: admin de plataforma -> panel admin (si esta
// configurado); cualquier otro -> su ERP.
export function urlMiCuenta(email: string): string {
  if (esAdminPlataforma(email) && process.env.NEXT_PUBLIC_URL_ADMIN) {
    return process.env.NEXT_PUBLIC_URL_ADMIN
  }
  return process.env.NEXT_PUBLIC_URL_ERP ?? '/login'
}
