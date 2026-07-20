import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { correoPorAmbiente, plantillaRecordatorio, type Mensaje, type ProveedorCorreo } from '@suite/correo'
import type { Database } from '@suite/db'

// Nucleo compartido del recordatorio de cobranza (action P10 <-> herramienta del bot
// P21, spec §5). El caller pone la compuerta (action: guard de rol; bot: vinculo
// verificado) y el cliente (sesion RLS o admin con empresa fija): aqui viven las
// reglas comunes — vencida con saldo, anti-spam 3 dias, plantilla es-CL, envio y log
// SOLO en exito. Mensajes byte-exactos identicos a los del P10.
type DbCliente = SupabaseClient<Database>

const SIN_EMAIL = 'El cliente no tiene correo registrado'
const ANTISPAM = 'Ya se envió un recordatorio hace menos de 3 días'

// Fail-closed (P10 spec §4): solo 'mock' | 'resend'. El throw del selector se traga
// aqui y se vuelve el mensaje contractual — jamas llega un detalle del proveedor al
// usuario. PROHIBIDO el `?? 'mock'` de pagos.
export function proveedorCorreoConfigurado(): ProveedorCorreo | null {
  const perilla = process.env.PROVEEDOR_CORREO
  if (perilla !== 'mock' && perilla !== 'resend') return null
  try {
    return correoPorAmbiente(perilla, process.env.RESEND_API_KEY, process.env.CORREO_REMITENTE)
  } catch {
    return null
  }
}

// Ventana anti-spam de recordatorios (P10 spec §2): now() - 3 dias como ISO.
export function hace3Dias(): string {
  return new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
}

// enviar() + registro DRY (P10 spec §5): SOLO exitos se registran — si enviar() lanza,
// NO hay fila y el caller recibe error.
export async function enviarYRegistrar(
  db: DbCliente,
  proveedor: ProveedorCorreo,
  empresaId: string,
  tipo: 'cotizacion' | 'proforma' | 'documento' | 'recordatorio',
  referenciaId: string,
  mensaje: Mensaje,
): Promise<{ error: string } | { ok: true }> {
  let proveedorId: string
  try {
    proveedorId = (await proveedor.enviar(mensaje)).id
  } catch {
    return { error: 'No se pudo enviar el correo. Intenta de nuevo.' }
  }
  const { error } = await db.from('correos_enviados').insert({
    empresa_id: empresaId,
    tipo,
    referencia_id: referenciaId,
    para: mensaje.para,
    asunto: mensaje.asunto,
    proveedor_id: proveedorId,
    html: mensaje.html,
  })
  if (error) return { error: 'El correo se envió pero no se pudo registrar el envío.' }
  return { ok: true }
}

// Recordatorio de UNA factura: vencida con saldo -> anti-spam -> email del cliente ->
// plantilla -> envio+log. Devuelve para/folio para que el bot redacte su detalle.
export async function enviarRecordatorioDocumento(
  db: DbCliente,
  proveedor: ProveedorCorreo,
  empresa: { id: string; razonSocial: string; rut: string },
  documentoId: string,
): Promise<{ error: string } | { ok: true; para: string; folio: number }> {
  const { data: fila } = await db
    .from('saldos_documentos')
    .select('documento_id, tipo, folio, total, saldo, fecha_vencimiento, cliente_id, cliente_razon_social')
    .eq('empresa_id', empresa.id)
    .eq('documento_id', documentoId)
    .maybeSingle()
  if (!fila || !fila.documento_id) return { error: 'La factura no existe o no tiene saldo' }
  const hoy = new Date().toISOString().slice(0, 10)
  if ((fila.saldo ?? 0) <= 0 || !fila.fecha_vencimiento || fila.fecha_vencimiento >= hoy) {
    return { error: 'La factura no está vencida con saldo pendiente' }
  }

  const { data: reciente } = await db
    .from('correos_enviados')
    .select('id')
    .eq('empresa_id', empresa.id)
    .eq('tipo', 'recordatorio')
    .eq('referencia_id', documentoId)
    .gte('creado_en', hace3Dias())
    .limit(1)
    .maybeSingle()
  if (reciente) return { error: ANTISPAM }

  if (!fila.cliente_id) return { error: SIN_EMAIL }
  const { data: cliente } = await db
    .from('clientes')
    .select('email')
    .eq('empresa_id', empresa.id)
    .eq('id', fila.cliente_id)
    .maybeSingle()
  const email = cliente?.email
  if (!email) return { error: SIN_EMAIL }

  const { asunto, html } = plantillaRecordatorio({
    empresa: { razonSocial: empresa.razonSocial, rut: empresa.rut },
    clienteRazonSocial: fila.cliente_razon_social ?? '',
    tipo: fila.tipo === 'boleta' ? 'boleta' : 'factura',
    folio: fila.folio ?? 0,
    total: fila.total ?? 0,
    saldo: fila.saldo ?? 0,
    fechaVencimiento: new Date(fila.fecha_vencimiento).toLocaleDateString('es-CL'),
  })
  const resultado = await enviarYRegistrar(db, proveedor, empresa.id, 'recordatorio', documentoId, {
    para: email,
    asunto,
    html,
  })
  if ('error' in resultado) return resultado
  return { ok: true, para: email, folio: fila.folio ?? 0 }
}
