import 'server-only'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@suite/db'

// Cliente con service_role: salta RLS. SOLO para el panel Admin, solo en servidor.
export function clienteAdmin() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}
