'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import type { EstadoForm } from '../tipos'

// IGUALDAD ESTRICTA del mensaje completo (contrato spec §7): cualquier otro error cae al genérico.
const ERRORES_CREAR = new Set([
  'El módulo de transporte no está activo',
  'Tu rol no permite gestionar proformas',
  'La proforma necesita al menos una orden de entrega',
  'Cliente no válido',
  'Hay una orden no válida, de otro cliente, ya facturada o en otra proforma',
  'La proforma supera el monto máximo facturable',
])

export async function crearProforma(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const cliente = String(formData.get('cliente_id') ?? '')
  const notas = String(formData.get('notas') ?? '').trim()
  if (!cliente) return { error: 'Selecciona un cliente' }

  let ordenes: string[]
  try {
    ordenes = JSON.parse(String(formData.get('ordenes') ?? '[]')) as string[]
  } catch {
    return { error: 'Las órdenes seleccionadas no son válidas' }
  }
  if (!Array.isArray(ordenes) || ordenes.length === 0) return { error: 'Selecciona al menos una orden de entrega' }
  if (ordenes.some((o) => typeof o !== 'string' || !o)) return { error: 'Las órdenes seleccionadas no son válidas' }

  const supabase = await crearClienteServidor()
  // p_notas acepta NULL en SQL, pero el codegen no refleja la nulabilidad de argumentos
  // de función: cast solo de tipo (mismo criterio que cotizaciones).
  const { data, error } = await supabase.rpc('crear_proforma', {
    p_empresa: activa.id,
    p_cliente: cliente,
    p_ordenes: ordenes,
    p_notas: (notas || null) as string,
  })
  if (error) {
    if (ERRORES_CREAR.has(error.message)) return { error: error.message }
    return { error: 'No se pudo crear la proforma' }
  }
  revalidatePath('/proformas')
  revalidatePath('/entregas')
  // redirect lanza NEXT_REDIRECT: va FUERA de cualquier try/catch. data = uuid de la proforma.
  redirect(`/proformas/${data}`)
}

const ESTADOS_DESTINO = ['enviada', 'aprobada', 'rechazada'] as const

export async function cambiarEstadoProforma(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  const proforma = String(formData.get('proforma_id') ?? '')
  const estado = String(formData.get('estado') ?? '')
  const motivo = String(formData.get('motivo') ?? '').trim()
  if (!proforma) return { error: 'Proforma no válida' }
  if (!(ESTADOS_DESTINO as readonly string[]).includes(estado)) return { error: 'Estado de destino no válido' }
  if (estado === 'rechazada' && motivo === '') return { error: 'El rechazo requiere un motivo' }
  const supabase = await crearClienteServidor()
  const { error } = await supabase.rpc('cambiar_estado_proforma', {
    p_empresa: activa.id,
    p_proforma: proforma,
    p_estado: estado,
    p_motivo: (motivo || null) as string,
  })
  if (error) {
    // Claves del spec §7: 'rol' / 'Transición' / 'motivo' / 'no existe'.
    if (error.message.includes('rol')) return { error: 'Tu rol no permite gestionar proformas' }
    if (error.message.includes('Transición')) return { error: 'Transición de estado no válida' }
    if (error.message.includes('motivo')) return { error: 'El rechazo requiere un motivo' }
    if (error.message.includes('no existe')) return { error: 'La proforma no existe' }
    return { error: 'No se pudo cambiar el estado de la proforma' }
  }
  revalidatePath('/proformas')
  revalidatePath(`/proformas/${proforma}`)
  revalidatePath('/entregas') // el rechazo libera ODEs
  return {}
}

const ERRORES_FACTURAR = new Set([
  'Tu rol no permite facturar proformas',
  'La proforma no existe',
  'Solo se puede facturar una proforma aprobada',
  'Hay una orden no válida, de otro cliente, ya facturada o en otra proforma',
])

export async function facturarProforma(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  const proforma = String(formData.get('proforma_id') ?? '')
  if (!proforma) return { error: 'Proforma no válida' }
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase.rpc('facturar_proforma', {
    p_empresa: activa.id,
    p_proforma: proforma,
  })
  if (error) {
    if (ERRORES_FACTURAR.has(error.message)) return { error: error.message }
    return { error: 'No se pudo facturar la proforma' }
  }
  revalidatePath('/proformas')
  revalidatePath(`/proformas/${proforma}`)
  revalidatePath('/entregas')
  revalidatePath('/ventas')
  // redirect lanza NEXT_REDIRECT: va FUERA de cualquier try/catch. data = uuid de la nota de venta creada.
  redirect(`/ventas/${data}`)
}

const ERRORES_DESHACER = new Set([
  'Tu rol no permite anular estados de pago',
  'El documento no existe',
  'El documento no proviene de una proforma',
  'Solo se puede deshacer un estado de pago en borrador o rechazado',
])

export async function anularEstadoPago(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  const documento = String(formData.get('documento_id') ?? '')
  const proforma = String(formData.get('proforma_id') ?? '')
  if (!documento) return { error: 'Documento no válido' }
  const supabase = await crearClienteServidor()
  const { error } = await supabase.rpc('anular_estado_pago', {
    p_empresa: activa.id,
    p_documento: documento,
  })
  if (error) {
    if (ERRORES_DESHACER.has(error.message)) return { error: error.message }
    return { error: 'No se pudo deshacer el estado de pago' }
  }
  revalidatePath('/proformas')
  if (proforma) revalidatePath(`/proformas/${proforma}`)
  revalidatePath('/entregas')
  revalidatePath('/ventas') // el documento de venta fue eliminado
  return {}
}
