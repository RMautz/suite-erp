import { crearClienteServidor } from '@suite/auth/server'

// El enlace del correo de recuperación aterriza aquí con ?code=... (flujo PKCE de
// GoTrue). El canje establece la sesión — las cookies solo se pueden escribir en un
// route handler, no en un server component — y pasa a /restablecer. Enlace inválido
// o expirado → /recuperar con aviso.
export async function GET(req: Request) {
  const url = new URL(req.url)
  // Tras el proxy multi-zone de www.letier.cl el origin del request es el del
  // deployment interno; x-forwarded-host conserva el dominio que ve el usuario.
  const host = req.headers.get('x-forwarded-host')
  const proto = req.headers.get('x-forwarded-proto') ?? 'https'
  const origen = host ? `${proto}://${host}` : url.origin
  const code = url.searchParams.get('code')
  if (code) {
    const supabase = await crearClienteServidor()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) return Response.redirect(new URL('/erp/cuenta/restablecer', origen), 303)
    console.error('auth/confirm: canje fallido:', error.message)
  }
  return Response.redirect(new URL('/erp/cuenta/recuperar?expirado=1', origen), 303)
}
