'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import type { EstadoForm } from '../tipos'

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/

export async function crearOrdenEntrega(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const cliente = String(formData.get('cliente_id') ?? '')
  const fecha = String(formData.get('fecha_ingreso') ?? '').trim()
  const destino = String(formData.get('destino_id') ?? '')
  const docum = String(formData.get('docum') ?? '').trim()
  const oc = String(formData.get('oc_cliente') ?? '').trim()
  const notas = String(formData.get('notas') ?? '').trim()
  const vehiculo = String(formData.get('vehiculo_id') ?? '')
  const conductor = String(formData.get('conductor_id') ?? '')
  const bultos = Number(formData.get('bultos'))
  const kilos = Number(formData.get('kilos'))
  const m3Crudo = String(formData.get('m3') ?? '').trim()
  const m3 = m3Crudo === '' ? null : Number(m3Crudo)
  const neto = Number(formData.get('neto'))

  if (!cliente) return { error: 'Selecciona un cliente' }
  if (!FECHA_ISO.test(fecha)) return { error: 'Ingresa la fecha de ingreso' }
  if (!destino) return { error: 'Selecciona un destino' }
  if (!Number.isInteger(bultos) || bultos < 1) return { error: 'Los bultos deben ser un entero mayor a 0' }
  if (!Number.isFinite(kilos) || kilos <= 0) return { error: 'Los kilos deben ser mayores a 0' }
  if (m3 !== null && (!Number.isFinite(m3) || m3 < 0)) return { error: 'Los M3 no pueden ser negativos' }
  if (!Number.isInteger(neto) || neto < 1) return { error: 'El neto debe ser un entero mayor a 0' }

  const supabase = await crearClienteServidor()
  // p_docum/p_oc/p_m3/p_vehiculo/p_conductor/p_notas aceptan NULL en SQL, pero el codegen no
  // refleja la nulabilidad de argumentos de función: casts solo de tipo (criterio cotizaciones).
  // kilo_afecto NO viaja: lo calcula SIEMPRE la RPC server-side.
  const { error } = await supabase.rpc('crear_orden_entrega', {
    p_empresa: activa.id,
    p_cliente: cliente,
    p_fecha: fecha,
    p_destino: destino,
    p_docum: (docum || null) as string,
    p_oc: (oc || null) as string,
    p_bultos: bultos,
    p_kilos: kilos,
    p_m3: m3 as number,
    p_neto: neto,
    p_vehiculo: (vehiculo || null) as string,
    p_conductor: (conductor || null) as string,
    p_notas: (notas || null) as string,
  })
  if (error) {
    // Claves de mapeo del spec §7 — substrings únicos dentro del set de crear_orden_entrega.
    // 'módulo' antes que 'rol' por claridad; 'kilos deben'/'kilos superan' y 'M3 no'/'M3 superan'
    // desambiguan mínimos de topes; 'bultos' se chequea antes que 'neto' (comparten 'entero mayor a 0').
    if (error.message.includes('módulo')) return { error: 'El módulo de transporte no está activo' }
    if (error.message.includes('rol')) return { error: 'Tu rol no permite registrar órdenes de entrega' }
    if (error.message.includes('Cliente')) return { error: 'Cliente no válido' }
    if (error.message.includes('Destino')) return { error: 'Destino no válido' }
    if (error.message.includes('Vehículo')) return { error: 'Vehículo no válido' }
    if (error.message.includes('Conductor')) return { error: 'Conductor no válido' }
    if (error.message.includes('fecha')) return { error: 'Ingresa la fecha de ingreso' }
    if (error.message.includes('bultos')) return { error: 'Los bultos deben ser un entero mayor a 0' }
    if (error.message.includes('kilos deben')) return { error: 'Los kilos deben ser mayores a 0' }
    if (error.message.includes('kilos superan')) return { error: 'Los kilos superan el máximo admitido' }
    if (error.message.includes('M3 no')) return { error: 'Los M3 no pueden ser negativos' }
    if (error.message.includes('M3 superan')) return { error: 'Los M3 superan el máximo admitido' }
    if (error.message.includes('neto')) return { error: 'El neto debe ser un entero mayor a 0' }
    if (error.message.includes('tarifar')) return { error: 'La carga es demasiado pequeña para tarifar' }
    return { error: 'No se pudo registrar la orden de entrega' }
  }
  revalidatePath('/entregas')
  redirect('/entregas')
}

export async function anularOrdenEntrega(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  const orden = String(formData.get('orden_id') ?? '')
  const motivo = String(formData.get('motivo') ?? '').trim()
  if (!orden) return { error: 'Orden no válida' }
  if (!motivo) return { error: 'La anulación requiere un motivo' }
  const supabase = await crearClienteServidor()
  const { error } = await supabase.rpc('anular_orden_entrega', {
    p_empresa: activa.id,
    p_orden: orden,
    p_motivo: motivo,
  })
  if (error) {
    // Claves del spec §7: 'rol' / 'motivo' / 'no existe' / 'registrada' / 'recházala'.
    if (error.message.includes('rol')) return { error: 'Tu rol no permite anular órdenes de entrega' }
    if (error.message.includes('motivo')) return { error: 'La anulación requiere un motivo' }
    if (error.message.includes('recházala')) return { error: 'La orden está en una proforma; recházala primero' }
    if (error.message.includes('registrada')) return { error: 'Solo se puede anular una orden registrada' }
    if (error.message.includes('no existe')) return { error: 'La orden de entrega no existe' }
    return { error: 'No se pudo anular la orden de entrega' }
  }
  revalidatePath('/entregas')
  return {}
}

export async function asignarDespacho(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  const orden = String(formData.get('orden_id') ?? '')
  const vehiculo = String(formData.get('vehiculo_id') ?? '')
  const conductor = String(formData.get('conductor_id') ?? '')
  if (!orden) return { error: 'Orden no válida' }
  const supabase = await crearClienteServidor()
  // p_vehiculo/p_conductor aceptan NULL en SQL (null = desasignar): cast solo de tipo.
  const { error } = await supabase.rpc('asignar_despacho', {
    p_empresa: activa.id,
    p_orden: orden,
    p_vehiculo: (vehiculo || null) as string,
    p_conductor: (conductor || null) as string,
  })
  if (error) {
    // Claves del spec §7: 'rol' / 'no existe' / 'anulada' / 'Vehículo' / 'Conductor'.
    if (error.message.includes('rol')) return { error: 'Tu rol no permite asignar despachos' }
    if (error.message.includes('no existe')) return { error: 'La orden de entrega no existe' }
    if (error.message.includes('anulada')) return { error: 'No se puede asignar despacho a una orden anulada' }
    if (error.message.includes('Vehículo')) return { error: 'Vehículo no válido' }
    if (error.message.includes('Conductor')) return { error: 'Conductor no válido' }
    return { error: 'No se pudo asignar el despacho' }
  }
  revalidatePath('/entregas')
  return {}
}
