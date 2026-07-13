import 'server-only'
import { clienteAdmin } from '@suite/auth/admin'
import { descifrar, proveedorPorAmbiente, type CredencialesDTE, type SolicitudEmision } from '@suite/dte'
import { CODIGO_SII, type TipoDocumento } from '@suite/core'

function clave(): string {
  const k = process.env.DTE_ENCRYPTION_KEY
  if (!k) throw new Error('Falta DTE_ENCRYPTION_KEY')
  return k
}

// Descifra las credenciales de la empresa. SOLO server-side. Usa service_role para leer
// las columnas cifradas de forma controlada (nunca expuestas al cliente).
export async function credencialesEmpresa(empresaId: string, tipo: TipoDocumento): Promise<CredencialesDTE> {
  const admin = clienteAdmin()
  const { data: emp, error } = await admin
    .from('empresas')
    .select('certificado_cifrado, certificado_password_cifrada, dte_api_key_cifrada')
    .eq('id', empresaId)
    .single()
  if (error || !emp?.certificado_cifrado || !emp.certificado_password_cifrada || !emp.dte_api_key_cifrada) {
    throw new Error('Falta configurar el certificado digital en Configuración')
  }
  const { data: caf } = await admin
    .from('folios_caf')
    .select('xml_caf')
    .eq('empresa_id', empresaId)
    .eq('tipo_documento', tipo)
    .eq('activo', true)
    .limit(1)
    .single()
  if (!caf) throw new Error('Falta cargar folios CAF para ' + tipo)

  const k = clave()
  return {
    apiKey: descifrar(emp.dte_api_key_cifrada, k).toString('utf8'),
    certificadoPfx: descifrar(emp.certificado_cifrado, k),
    certificadoPassword: descifrar(emp.certificado_password_cifrada, k).toString('utf8'),
    cafXml: caf.xml_caf,
  }
}

export { CODIGO_SII, proveedorPorAmbiente }
export type { SolicitudEmision }
