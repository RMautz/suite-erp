import 'server-only'
import {
  correoPorAmbiente,
  plantillaLeadAdmin,
  plantillaTicketAdmin,
  type DatosLeadAdmin,
  type DatosTicketAdmin,
  type ProveedorCorreo,
} from '@suite/correo'
import {
  plantillaLeadWhatsApp,
  plantillaTicketWhatsApp,
  whatsappPorAmbiente,
  type ProveedorWhatsApp,
} from '@suite/whatsapp'

// Aviso al WHATSAPP del admin (spec avisos 2026-07-24): mismo best-effort que el
// correo. WHATSAPP_ADMIN (E.164) + proveedor fail-closed; en mock el mensaje queda
// en el store del proceso web (misma limitacion cross-proceso documentada §6b).
// Produccion real: exige plantillas HSM aprobadas (credencial #15).
async function avisarWhatsAppAdmin(texto: string): Promise<void> {
  const destino = process.env.WHATSAPP_ADMIN
  if (!destino) return
  const perilla = process.env.PROVEEDOR_WHATSAPP
  if (perilla !== 'mock' && perilla !== 'cloud') return
  let proveedor: ProveedorWhatsApp
  try {
    proveedor = whatsappPorAmbiente(
      perilla,
      process.env.WHATSAPP_TOKEN,
      process.env.WHATSAPP_PHONE_ID,
      process.env.WHATSAPP_VERIFY_TOKEN,
      process.env.WHATSAPP_APP_SECRET,
    )
  } catch {
    return
  }
  await proveedor.enviarTexto(destino, texto)
}

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
  try {
    await avisarWhatsAppAdmin(
      plantillaTicketWhatsApp({
        numero: datos.numero,
        organizacion: datos.organizacion,
        asunto: datos.asunto,
        autorEmail: datos.autorEmail,
        origen: datos.origen,
      }),
    )
  } catch (e) {
    console.error('aviso ticket whatsapp:', e instanceof Error ? e.message : 'error desconocido')
  }
}

// Tope diario de avisos de LEAD (hallazgo review: la superficie es ANONIMA y cada
// lead dispara un correo — sin freno es un amplificador contra la casilla del admin
// y la cuota de Resend). En memoria por proceso: freno parcial (se reinicia con el
// deploy/instancia); el rate limiting real por IP es seam de produccion (deploy.md).
const TOPE_AVISOS_LEAD_DIA = 30
let avisosLeadHoy = { fecha: '', enviados: 0 }

// Mismo best-effort para los LEADS del chat de ventas de la landing.
export async function avisarLeadAdmin(datos: DatosLeadAdmin): Promise<void> {
  try {
    const hoy = new Date().toISOString().slice(0, 10)
    if (avisosLeadHoy.fecha !== hoy) avisosLeadHoy = { fecha: hoy, enviados: 0 }
    if (avisosLeadHoy.enviados >= TOPE_AVISOS_LEAD_DIA) {
      console.error('aviso lead: tope diario alcanzado, lead #' + datos.numero + ' sin aviso (queda en el panel)')
      return
    }
    const destino = (process.env.ADMIN_EMAILS ?? '').split(',').map((e) => e.trim()).filter(Boolean)[0]
    const proveedor = proveedorCorreo()
    if (!destino || !proveedor) return
    const { asunto, html } = plantillaLeadAdmin(datos)
    await proveedor.enviar({ para: destino, asunto, html })
    await avisarWhatsAppAdmin(
      plantillaLeadWhatsApp({
        numero: datos.numero,
        nombre: datos.nombre,
        email: datos.email,
        telefono: datos.telefono,
      }),
    )
    avisosLeadHoy.enviados++
  } catch (e) {
    console.error('aviso lead:', e instanceof Error ? e.message : 'error desconocido')
  }
}
