'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import type { EstadoForm } from '../tipos'

export async function guardarDestino(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const id = String(formData.get('id') ?? '')
  const tarifaCruda = String(formData.get('tarifa_kg') ?? '').trim()
  const tarifaKg = Number(tarifaCruda)
  if (tarifaCruda === '' || !Number.isInteger(tarifaKg) || tarifaKg < 1) {
    return { error: 'La tarifa debe ser un entero CLP mayor a 0' }
  }

  const supabase = await crearClienteServidor()
  if (id) {
    // Solo columnas del grant: nombre y empresa_id son inmutables (grant por columnas de 0016).
    const { data, error } = await supabase
      .from('destinos')
      .update({ tarifa_kg: tarifaKg })
      .eq('id', id)
      .eq('empresa_id', activa.id)
      .select('id')
    if (error) {
      if (error.code === '42501') return { error: 'Tu rol no permite gestionar el tarifario' }
      return { error: 'No se pudo guardar el destino' }
    }
    if ((data ?? []).length === 0) {
      return { error: 'No se pudo guardar: el destino no existe o tu rol no permite editarlo' }
    }
  } else {
    const nombre = String(formData.get('nombre') ?? '').trim()
    if (nombre === '') return { error: 'El nombre del destino es obligatorio' }
    const { error } = await supabase.from('destinos').insert({
      empresa_id: activa.id,
      nombre,
      tarifa_kg: tarifaKg,
    })
    if (error) {
      // El índice CI (empresa_id, lower(nombre)) lanza 23505 también con variantes de caso (patrón categorías 0015).
      if (error.code === '23505') return { error: 'Ese destino ya existe' }
      if (error.code === '42501') return { error: 'Tu rol no permite gestionar el tarifario' }
      return { error: 'No se pudo crear el destino' }
    }
  }
  revalidatePath('/tarifario')
  redirect('/tarifario')
}

export async function alternarActivoDestino(formData: FormData): Promise<void> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return
  const id = String(formData.get('id') ?? '')
  const activo = String(formData.get('activo') ?? '') === 'true'
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase
    .from('destinos')
    .update({ activo: !activo })
    .eq('id', id)
    .eq('empresa_id', activa.id)
    .select('id')
  if (error || (data ?? []).length === 0) {
    console.error('alternarActivoDestino:', error ?? 'sin filas')
    return
  }
  revalidatePath('/tarifario')
}
