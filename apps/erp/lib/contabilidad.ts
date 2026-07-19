import 'server-only'
import { clienteAdmin } from '@suite/auth/admin'

// Contabiliza un documento del ERP en tiempo real, justo despues de que se registra (venta, nota
// de credito, compra, pago de cliente, pago a proveedor o anticipo). Delegado a la RPC
// contabilizar_documento (SOLO service_role): bajo el candado del correlativo y del documento,
// aplica la regla de mapeo del origen y crea el asiento via el helper unico _insertar_asiento (la
// cuadratura debe = haber se revalida SIEMPRE, tambien en la via automatica). No-op limpio si el
// modulo de contabilidad esta inactivo, si ya existe el asiento (idempotencia por (empresa, origen,
// referencia)) o si el mapeo produce 0 lineas.
//
// NUNCA lanza -- espejo EXACTO de aplicarAnticipoDocumento: la contabilizacion es best-effort en el
// hook; cualquier camino que se salte el hook (RPC directa, E2E) se repara con el boton
// "Contabilizar pendientes" de /contabilidad (el MISMO motor idempotente). Si lanzara, romperia el
// flujo que la invoca (una emision de DTE ya vivo, un pago ya registrado): el fallo se traga con
// console.error y sigue.
export async function contabilizarAsiento(
  empresaId: string,
  origen: 'venta' | 'nota_credito' | 'compra' | 'pago' | 'pago_proveedor' | 'anticipo' | 'remuneracion',
  referenciaId: string,
): Promise<void> {
  try {
    const admin = clienteAdmin()
    const { error } = await admin.rpc('contabilizar_documento', {
      p_empresa: empresaId,
      p_origen: origen,
      p_referencia: referenciaId,
    })
    if (error) console.error('contabilizarAsiento:', error.message)
  } catch (e) {
    console.error('contabilizarAsiento:', e)
  }
}
