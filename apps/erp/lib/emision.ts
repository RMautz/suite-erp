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
    cafXml: descifrar(caf.xml_caf, k).toString('utf8'),
  }
}

// Registra movimientos de stock para un documento emitido. signo = -1 descuenta (venta),
// signo = +1 restituye (nota de crédito). Idempotente: no duplica si ya hay movimientos
// para esa referencia. Nunca lanza — el stock se puede reconciliar con un ajuste.
export async function registrarMovimientosDocumento(
  empresaId: string,
  documentoId: string,
  lineas: { producto_id: string | null; cantidad: number }[],
  signo: 1 | -1,
  motivo: string
): Promise<void> {
  try {
    const admin = clienteAdmin()
    const { data: previos } = await admin
      .from('movimientos_stock')
      .select('id')
      .eq('empresa_id', empresaId)
      .eq('referencia_documento_id', documentoId)
      .limit(1)
    if (previos && previos.length > 0) return // ya registrados (reintento)

    // Resuelve la bodega por defecto directamente vía admin (sin la RPC bodega_por_defecto:
    // esta valida pertenencia vía auth.uid(), que es null bajo service_role).
    let bodegaId: string | null = null
    const { data: b } = await admin
      .from('bodegas')
      .select('id')
      .eq('empresa_id', empresaId)
      .eq('activo', true)
      .order('creado_en')
      .limit(1)
      .maybeSingle()
    bodegaId = b?.id ?? null
    if (!bodegaId) {
      const { data: nueva } = await admin
        .from('bodegas')
        .insert({ empresa_id: empresaId, nombre: 'Bodega Principal' })
        .select('id')
        .single()
      bodegaId = nueva?.id ?? null
    }
    if (!bodegaId) return
    const bodega = bodegaId // const: preserva la narrow a `string` dentro del closure del .map()

    const filas = lineas
      .filter((l): l is { producto_id: string; cantidad: number } => l.producto_id !== null)
      .map((l) => ({
        empresa_id: empresaId,
        producto_id: l.producto_id,
        bodega_id: bodega,
        tipo: signo < 0 ? 'salida' : 'entrada',
        cantidad: signo * Math.abs(l.cantidad),
        motivo,
        referencia_documento_id: documentoId,
      }))
    if (filas.length > 0) await admin.from('movimientos_stock').insert(filas)
  } catch (e) {
    console.error('registrarMovimientosDocumento:', e)
  }
}

export { CODIGO_SII, proveedorPorAmbiente }
export type { SolicitudEmision }
