'use server'

import { revalidatePath } from 'next/cache'
import { clienteAdmin } from '@suite/auth/admin'
import { crearClienteServidor } from '@suite/auth/server'
import { esTelefonoE164 } from '@suite/whatsapp'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { proveedorWhatsAppConfigurado, WHATSAPP_NO_CONFIGURADO } from '../../../lib/whatsapp'

// Estados type-only (permitidos en 'use server': se borran al compilar).
export type EstadoWhatsApp = { error?: string; ok?: boolean; vinculoId?: string; telefono?: string }

// Solicitar: la RPC valida rol/formato y genera el codigo; el ENVIO del codigo lo
// hace esta action via el proveedor (la RPC no habla con el mundo, spec 4.1). El
// codigo NO es legible por authenticated (grant por columnas, hallazgo review T3):
// se lee con el admin client DESPUES de que la RPC ya valido el rol del caller. El
// envio se loguea con origen 'vinculacion' (visible en /mock-whatsapp).
export async function solicitarVinculo(_prev: EstadoWhatsApp, formData: FormData): Promise<EstadoWhatsApp> {
  const telefono = String(formData.get('telefono') ?? '').trim()
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  const proveedor = proveedorWhatsAppConfigurado()
  if (!proveedor) return { error: WHATSAPP_NO_CONFIGURADO }
  if (!esTelefonoE164(telefono)) return { error: 'Teléfono no válido: usa formato internacional +56...' }

  const supabase = await crearClienteServidor()
  const { data: vinculoId, error } = await supabase.rpc('solicitar_vinculo_whatsapp', {
    p_empresa: activa.id,
    p_telefono: telefono,
  })
  if (error || !vinculoId) return { error: error?.message ?? 'No se pudo solicitar el vínculo' }

  const { data: fila } = await clienteAdmin()
    .from('whatsapp_vinculos')
    .select('codigo')
    .eq('id', vinculoId)
    .eq('empresa_id', activa.id)
    .maybeSingle()
  if (!fila?.codigo) return { error: 'No se pudo generar el código. Intenta de nuevo.' }

  const texto = `Tu código para vincular este WhatsApp con ${activa.razon_social} es ${fila.codigo}. Vence en 10 minutos.`
  try {
    await proveedor.enviarTexto(telefono, texto)
  } catch {
    return { error: 'No se pudo enviar el WhatsApp. Intenta de nuevo.' }
  }
  // El log guarda el codigo ENMASCARADO (lo leen roles que no gestionan WhatsApp,
  // p.ej. contador); el texto real solo viaja al telefono / bandeja mock.
  const { error: eLog } = await supabase.from('whatsapp_mensajes').insert({
    empresa_id: activa.id,
    telefono,
    direccion: 'saliente',
    origen: 'vinculacion',
    contenido: `Tu código para vincular este WhatsApp con ${activa.razon_social} es ******. Vence en 10 minutos.`,
  })
  if (eLog) return { error: 'El WhatsApp se envió pero no se pudo registrar el envío.' }
  revalidatePath('/configuracion/whatsapp')
  return { ok: true, vinculoId, telefono }
}

export async function confirmarVinculo(_prev: EstadoWhatsApp, formData: FormData): Promise<EstadoWhatsApp> {
  const vinculoId = String(formData.get('vinculo_id') ?? '')
  const codigo = String(formData.get('codigo') ?? '').trim()
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  if (!vinculoId || !codigo) return { error: 'Ingresa el código que te llegó por WhatsApp' }
  const supabase = await crearClienteServidor()
  const { error } = await supabase.rpc('confirmar_vinculo_whatsapp', {
    p_empresa: activa.id,
    p_vinculo: vinculoId,
    p_codigo: codigo,
  })
  // Mensajes de la RPC byte-exactos (Codigo incorrecto o expirado / telefono ajeno).
  if (error) return { error: error.message }
  revalidatePath('/configuracion/whatsapp')
  return { ok: true }
}

export async function desvincularWhatsApp(_prev: EstadoWhatsApp, formData: FormData): Promise<EstadoWhatsApp> {
  const vinculoId = String(formData.get('vinculo_id') ?? '')
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  if (!vinculoId) return { error: 'Vínculo no válido' }
  const supabase = await crearClienteServidor()
  const { error } = await supabase.rpc('desvincular_whatsapp', { p_empresa: activa.id, p_vinculo: vinculoId })
  if (error) return { error: error.message }
  revalidatePath('/configuracion/whatsapp')
  return { ok: true }
}
