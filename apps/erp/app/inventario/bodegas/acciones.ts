'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import type { EstadoForm } from '../../tipos'

export async function guardarBodega(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const id = String(formData.get('id') ?? '')
  const nombre = String(formData.get('nombre') ?? '').trim()
  const direccion = String(formData.get('direccion') ?? '').trim()
  if (nombre === '') return { error: 'El nombre de la bodega es obligatorio' }

  const datos = { nombre, direccion: direccion || null }
  const supabase = await crearClienteServidor()
  if (id) {
    const { data, error } = await supabase.from('bodegas').update(datos).eq('id', id).eq('empresa_id', activa.id).select('id')
    if (error) {
      if (error.code === '23505') return { error: 'Ya existe una bodega con ese nombre' }
      return { error: 'No se pudo guardar la bodega' }
    }
    if ((data ?? []).length === 0) return { error: 'No se pudo guardar: tu rol no permite editar bodegas' }
  } else {
    const { error } = await supabase.from('bodegas').insert({ ...datos, empresa_id: activa.id })
    if (error) {
      if (error.code === '23505') return { error: 'Ya existe una bodega con ese nombre' }
      if (error.code === '42501') return { error: 'Tu rol no permite crear bodegas' }
      return { error: 'No se pudo crear la bodega' }
    }
  }
  revalidatePath('/inventario/bodegas')
  redirect('/inventario/bodegas')
}

export async function alternarActivoBodega(formData: FormData): Promise<void> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return
  const id = String(formData.get('id') ?? '')
  const activo = String(formData.get('activo') ?? '') === 'true'
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase.from('bodegas').update({ activo: !activo }).eq('id', id).eq('empresa_id', activa.id).select('id')
  if (error || (data ?? []).length === 0) { console.error('alternarActivoBodega:', error ?? 'sin filas'); return }
  revalidatePath('/inventario/bodegas')
}
