import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from '@suite/db'
import type { CookieOptions } from '@supabase/ssr'
import { dominioCookie } from './cookies'

export async function crearClienteServidor() {
  const almacenCookies = await cookies()
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: dominioCookie(),
      cookies: {
        getAll: () => almacenCookies.getAll(),
        setAll: (lista: Array<{ name: string; value: string; options?: CookieOptions }>) => {
          try {
            lista.forEach(({ name, value, options }) =>
              almacenCookies.set(name, value, options)
            )
          } catch {
            // Llamado desde un Server Component: el middleware refresca la sesión.
          }
        },
      },
    }
  )
}
