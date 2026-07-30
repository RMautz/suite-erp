import { crearClienteServidor } from '@suite/auth/server'

// El enlace del correo de recuperación aterriza aquí con ?code=... (flujo PKCE de
// GoTrue). El canje establece la sesión — las cookies solo se pueden escribir en un
// route handler, no en un server component — y pasa a /restablecer. Enlace inválido
// o expirado → /recuperar con aviso.
export async function GET(req: Request) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  if (code) {
    const supabase = await crearClienteServidor()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) return Response.redirect(new URL('/restablecer', url.origin), 303)
    console.error('auth/confirm: canje fallido:', error.message)
  }
  return Response.redirect(new URL('/recuperar?expirado=1', url.origin), 303)
}
