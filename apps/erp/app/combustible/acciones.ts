'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import type { EstadoForm } from '../tipos'
import { CATEGORIAS_GASTO } from './categorias'

export async function crearCargaManual(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const vehiculoId = String(formData.get('vehiculo_id') ?? '')
  if (!vehiculoId) return { error: 'Selecciona un vehículo' }
  const fecha = String(formData.get('fecha') ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return { error: 'La fecha no es válida' }
  // Coma decimal tolerada: el transportista escribe "38,5" igual que en el papel.
  const litros = Number(String(formData.get('litros') ?? '').trim().replace(',', '.'))
  if (!Number.isFinite(litros) || litros <= 0) return { error: 'Los litros deben ser un número mayor a 0' }
  const monto = Number(String(formData.get('monto') ?? '').trim())
  if (!Number.isInteger(monto) || monto <= 0) return { error: 'El monto debe ser un entero de pesos mayor a 0' }
  const precioCrudo = String(formData.get('precio_litro') ?? '').trim()
  const precioLitro = precioCrudo === '' ? null : Number(precioCrudo)
  if (precioLitro !== null && (!Number.isInteger(precioLitro) || precioLitro <= 0)) {
    return { error: 'El precio por litro debe ser un entero de pesos mayor a 0 (o dejarse vacío)' }
  }
  const estacion = String(formData.get('estacion') ?? '').trim()

  const supabase = await crearClienteServidor()
  // Solo vehículos ACTIVOS de la empresa: el form ya filtra, pero el POST se puede forjar.
  // (El import TCT sí acepta inactivos — asimetría deliberada del spec §2.)
  const { data: vehiculo } = await supabase
    .from('vehiculos')
    .select('id')
    .eq('id', vehiculoId)
    .eq('empresa_id', activa.id)
    .eq('activo', true)
    .maybeSingle()
  if (!vehiculo) return { error: 'El vehículo no existe o está inactivo' }

  const { error } = await supabase.from('cargas_combustible').insert({
    empresa_id: activa.id,
    vehiculo_id: vehiculoId,
    fecha,
    litros,
    monto,
    precio_litro: precioLitro,
    estacion: estacion || null,
    origen: 'manual',
  })
  if (error) {
    if (error.code === '42501') return { error: 'Tu rol no permite registrar costos' }
    return { error: 'No se pudo registrar la carga' }
  }
  revalidatePath('/combustible')
  redirect('/combustible')
}

export async function crearGasto(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const vehiculoId = String(formData.get('vehiculo_id') ?? '')
  if (!vehiculoId) return { error: 'Selecciona un vehículo' }
  const fecha = String(formData.get('fecha') ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return { error: 'La fecha no es válida' }
  const categoria = String(formData.get('categoria') ?? '')
  if (!(CATEGORIAS_GASTO as readonly string[]).includes(categoria)) {
    return { error: 'Categoría de gasto no válida' }
  }
  const monto = Number(String(formData.get('monto') ?? '').trim())
  if (!Number.isInteger(monto) || monto <= 0) return { error: 'El monto debe ser un entero de pesos mayor a 0' }
  const notas = String(formData.get('notas') ?? '').trim()

  const supabase = await crearClienteServidor()
  const { data: vehiculo } = await supabase
    .from('vehiculos')
    .select('id')
    .eq('id', vehiculoId)
    .eq('empresa_id', activa.id)
    .eq('activo', true)
    .maybeSingle()
  if (!vehiculo) return { error: 'El vehículo no existe o está inactivo' }

  const { error } = await supabase.from('gastos_vehiculo').insert({
    empresa_id: activa.id,
    vehiculo_id: vehiculoId,
    fecha,
    categoria,
    monto,
    notas: notas || null,
  })
  if (error) {
    if (error.code === '42501') return { error: 'Tu rol no permite registrar costos' }
    return { error: 'No se pudo registrar el gasto' }
  }
  revalidatePath('/combustible')
  redirect('/combustible')
}

export async function eliminarCarga(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  const id = String(formData.get('id') ?? '')
  const supabase = await crearClienteServidor()
  // .select('id') delata el éxito falso: para vendedor el grant de delete existe
  // pero la policy filtra en silencio — 0 filas afectadas = NO hubo borrado.
  const { data, error } = await supabase
    .from('cargas_combustible')
    .delete()
    .eq('id', id)
    .eq('empresa_id', activa.id)
    .select('id')
  if (error || (data ?? []).length === 0) return { error: 'No se pudo eliminar' }
  revalidatePath('/combustible')
  return {}
}

export async function eliminarGasto(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  const id = String(formData.get('id') ?? '')
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase
    .from('gastos_vehiculo')
    .delete()
    .eq('id', id)
    .eq('empresa_id', activa.id)
    .select('id')
  if (error || (data ?? []).length === 0) return { error: 'No se pudo eliminar' }
  revalidatePath('/combustible')
  return {}
}
