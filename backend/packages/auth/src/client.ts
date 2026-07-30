import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@suite/db'
import { dominioCookie } from './cookies'

export function crearClienteNavegador() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookieOptions: dominioCookie() }
  )
}
