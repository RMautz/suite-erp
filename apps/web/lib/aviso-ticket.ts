import 'server-only'
import { correoPorAmbiente, plantillaTicketAdmin, type DatosTicketAdmin, type ProveedorCorreo } from '@suite/correo'

// Fail-closed (patron proveedorCorreoConfigurado del erp): solo 'mock' | 'resend';
// throw del selector tragado -> null.
function proveedorCorreo(): ProveedorCorreo | null {
  const perilla = process.env.PROVEEDOR_CORREO
  if (perilla !== 'mock' && perilla !== 'resend') return null
  try {
    return correoPorAmbiente(perilla, process.env.RESEND_API_KEY, process.env.CORREO_REMITENTE)
  } catch {
    return null
  }
}

// Aviso al admin de plataforma por un ticket nuevo. BEST-EFFORT: si el correo no
// esta configurado o falla, el ticket ya quedo creado y esto solo se loguea.
export async function avisarTicketAdmin(datos: DatosTicketAdmin): Promise<void> {
  try {
    const destino = (process.env.ADMIN_EMAILS ?? '').split(',').map((e) => e.trim()).filter(Boolean)[0]
    const proveedor = proveedorCorreo()
    if (!destino || !proveedor) return
    const { asunto, html } = plantillaTicketAdmin(datos)
    await proveedor.enviar({ para: destino, asunto, html })
  } catch (e) {
    console.error('aviso ticket:', e instanceof Error ? e.message : 'error desconocido')
  }
}
