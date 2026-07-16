import 'server-only'
import { clienteAdmin } from '@suite/auth/admin'
import { descifrar, proveedorPorAmbiente, type CredencialesDTE, type SolicitudEmision } from '@suite/dte'
import { CODIGO_SII, type TipoDocumento } from '@suite/core'
import type { Json } from '@suite/db'

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
// signo = +1 restituye (nota de crédito). Delegado a la RPC registrar_movimientos_documento
// (solo service_role): advisory lock por documento — el check de idempotencia y los inserts
// corren serializados en la BD, cerrando el TOCTOU de reintentos simultáneos (review Plan 4).
// Nunca lanza — el stock se puede reconciliar con un ajuste.
export async function registrarMovimientosDocumento(
  empresaId: string,
  documentoId: string,
  lineas: { producto_id: string | null; cantidad: number }[],
  signo: 1 | -1,
  motivo: string
): Promise<void> {
  // Sin líneas con producto (p. ej. factura nacida de una proforma de transporte:
  // todas sus líneas llevan producto_id = null) no hay stock que mover, y llamar
  // la RPC igual crearía la bodega 'Principal' fantasma en empresas que jamás
  // han usado inventario. Early-return antes de tocar la BD.
  const conProducto = lineas
    .filter((l): l is { producto_id: string; cantidad: number } => l.producto_id !== null)
    .map((l) => ({ productoId: l.producto_id, cantidad: l.cantidad }))
  if (conProducto.length === 0) return
  try {
    const admin = clienteAdmin()
    const { error } = await admin.rpc('registrar_movimientos_documento', {
      p_empresa: empresaId,
      p_documento: documentoId,
      p_lineas: conProducto as unknown as Json,
      p_signo: signo,
      p_motivo: motivo,
    })
    if (error) console.error('registrarMovimientosDocumento:', error.message)
  } catch (e) {
    console.error('registrarMovimientosDocumento:', e)
  }
}

// Aplica un anticipo `recibido` a la factura recién emitida cuyo origen (proforma/cotización)
// enlaza a ese documento. Delegado a la RPC aplicar_anticipo (solo service_role): bajo lock del
// documento aplica el anticipo hasta el saldo con un pago método 'mercadopago'; sin anticipo, no-op.
// NUNCA lanza — espejo de registrarMovimientosDocumento: si lanzara, el catch de emitirDocumento
// revertiría un DTE ya vivo (re-emisión con el mismo folio). El fallo best-effort se recupera con
// el botón "Aplicar" manual de /cobranza (que también cubre la emisión anterior al webhook).
export async function aplicarAnticipoDocumento(empresaId: string, documentoId: string): Promise<void> {
  try {
    const admin = clienteAdmin()
    const { error } = await admin.rpc('aplicar_anticipo', {
      p_empresa: empresaId,
      p_documento: documentoId,
    })
    if (error) console.error('aplicarAnticipoDocumento:', error.message)
  } catch (e) {
    console.error('aplicarAnticipoDocumento:', e)
  }
}

export { CODIGO_SII, proveedorPorAmbiente }
export type { SolicitudEmision }
