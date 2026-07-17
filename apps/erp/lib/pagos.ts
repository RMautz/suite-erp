import 'server-only'
import { clienteAdmin } from '@suite/auth/admin'
import { descifrar } from '@suite/dte'
import { pasarelaPorAmbiente, type PasarelaPagos } from '@suite/pagos'
import { claveCifrado } from './cifrado'

// Devuelve la pasarela ligada al token MP de la empresa, o null si NO está configurada.
// SOLO server-side: usa service_role (clienteAdmin) para leer la columna cifrada (sin
// grant a authenticated) y la descifra con DTE_ENCRYPTION_KEY — espejo EXACTO de
// credencialesEmpresa. En modo mock, pasarelaPorAmbiente ignora el token.
export async function pasarelaParaEmpresa(empresaId: string): Promise<PasarelaPagos | null> {
  const admin = clienteAdmin()
  const { data: emp, error } = await admin
    .from('empresas')
    .select('mp_access_token_cifrado')
    .eq('id', empresaId)
    .single()
  if (error || !emp?.mp_access_token_cifrado) return null
  const token = descifrar(emp.mp_access_token_cifrado, claveCifrado()).toString('utf8')
  return pasarelaPorAmbiente(process.env.PASARELA_PAGOS, token)
}
