'use server'

import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@suite/auth/server'
import { esTelefonoE164, plantillaRecordatorioWhatsApp } from '@suite/whatsapp'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import { hace3Dias } from '../../lib/recordatorio'
import { proveedorWhatsAppConfigurado, WHATSAPP_NO_CONFIGURADO } from '../../lib/whatsapp'
import type { EstadoCorreo } from '../correo/acciones'

const SIN_TELEFONO = 'El cliente no tiene teléfono registrado'
const ANTISPAM_WHATSAPP = 'Ya se envió un recordatorio por WhatsApp hace menos de 3 días'

// Recordatorio de cobranza POR WHATSAPP (spec §6): mismas validaciones de vencida que
// el correo, anti-spam propio de 3 dias sobre whatsapp_mensajes (origen 'cobranza' +
// referencia_id) y log inmutable. Guard dueno/admin: coincide con el INSERT RLS de
// whatsapp_mensajes y con quien gestiona WhatsApp.
export async function recordarPorWhatsApp(_prev: EstadoCorreo, formData: FormData): Promise<EstadoCorreo> {
  const documentoId = String(formData.get('documento_id') ?? '')
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  if (activa.rol !== 'dueno' && activa.rol !== 'admin') return { error: 'Tu rol no permite enviar WhatsApp' }
  const proveedor = proveedorWhatsAppConfigurado()
  if (!proveedor) return { error: WHATSAPP_NO_CONFIGURADO }

  const supabase = await crearClienteServidor()
  const { data: fila } = await supabase
    .from('saldos_documentos')
    .select('documento_id, tipo, folio, saldo, fecha_vencimiento, cliente_id, cliente_razon_social')
    .eq('empresa_id', activa.id)
    .eq('documento_id', documentoId)
    .maybeSingle()
  if (!fila || !fila.documento_id) return { error: 'La factura no existe o no tiene saldo' }
  const hoy = new Date().toISOString().slice(0, 10)
  if ((fila.saldo ?? 0) <= 0 || !fila.fecha_vencimiento || fila.fecha_vencimiento >= hoy) {
    return { error: 'La factura no está vencida con saldo pendiente' }
  }

  const { data: reciente } = await supabase
    .from('whatsapp_mensajes')
    .select('id')
    .eq('empresa_id', activa.id)
    .eq('origen', 'cobranza')
    .eq('referencia_id', documentoId)
    .gte('creado_en', hace3Dias())
    .limit(1)
    .maybeSingle()
  if (reciente) return { error: ANTISPAM_WHATSAPP }

  if (!fila.cliente_id) return { error: SIN_TELEFONO }
  const { data: cliente } = await supabase
    .from('clientes')
    .select('telefono')
    .eq('empresa_id', activa.id)
    .eq('id', fila.cliente_id)
    .maybeSingle()
  const telefono = cliente?.telefono?.trim() ?? ''
  if (!telefono) return { error: SIN_TELEFONO }
  if (!esTelefonoE164(telefono)) return { error: 'El teléfono del cliente no está en formato internacional (+56...)' }

  const texto = plantillaRecordatorioWhatsApp({
    empresaRazonSocial: activa.razon_social,
    clienteRazonSocial: fila.cliente_razon_social ?? '',
    tipo: fila.tipo === 'boleta' ? 'boleta' : 'factura',
    folio: fila.folio ?? 0,
    saldo: fila.saldo ?? 0,
    fechaVencimiento: new Date(fila.fecha_vencimiento).toLocaleDateString('es-CL'),
  })
  try {
    await proveedor.enviarTexto(telefono, texto)
  } catch {
    return { error: 'No se pudo enviar el WhatsApp. Intenta de nuevo.' }
  }
  const { error } = await supabase.from('whatsapp_mensajes').insert({
    empresa_id: activa.id,
    telefono,
    direccion: 'saliente',
    origen: 'cobranza',
    contenido: texto,
    referencia_id: documentoId,
  })
  if (error) return { error: 'El WhatsApp se envió pero no se pudo registrar el envío.' }
  revalidatePath('/cobranza')
  return { ok: true }
}
