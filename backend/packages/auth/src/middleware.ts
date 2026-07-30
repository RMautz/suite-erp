import { createServerClient } from '@supabase/ssr'
import type { CookieOptions } from '@supabase/ssr'
import type { Database } from '@suite/db'
import { NextResponse, type NextRequest } from 'next/server'
import { dominioCookie } from './cookies'

export async function actualizarSesion(request: NextRequest, urlLogin: string) {
  let respuesta = NextResponse.next({ request })
  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: dominioCookie(),
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (lista: Array<{ name: string; value: string; options?: CookieOptions }>) => {
          lista.forEach(({ name, value }) => request.cookies.set(name, value))
          respuesta = NextResponse.next({ request })
          lista.forEach(({ name, value, options }) =>
            respuesta.cookies.set(name, value, options)
          )
        },
      },
    }
  )
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL(urlLogin, request.url))
  return respuesta
}
