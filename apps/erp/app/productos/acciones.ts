'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { parsearPrecioCLP } from '@suite/core'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import type { EstadoForm } from '../tipos'

async function resolverCategoria(
  supabase: Awaited<ReturnType<typeof crearClienteServidor>>,
  empresaId: string,
  categoriaId: string,
  categoriaNueva: string
): Promise<{ id: string | null; error?: string }> {
  if (categoriaNueva.trim() !== '') {
    const { data, error } = await supabase
      .from('categorias_producto')
      .upsert(
        { empresa_id: empresaId, nombre: categoriaNueva.trim() },
        { onConflict: 'empresa_id,nombre' }
      )
      .select('id')
      .single()
    if (error) return { id: null, error: 'No se pudo crear la categoría' }
    return { id: data.id }
  }
  return { id: categoriaId || null }
}

export async function guardarProducto(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const id = String(formData.get('id') ?? '')
  const sku = String(formData.get('sku') ?? '').trim()
  const nombre = String(formData.get('nombre') ?? '').trim()
  const descripcion = String(formData.get('descripcion') ?? '').trim()
  const codigoBarras = String(formData.get('codigo_barras') ?? '').trim()
  const unidad = String(formData.get('unidad') ?? '').trim() || 'UN'
  const precioNeto = parsearPrecioCLP(String(formData.get('precio_neto') ?? ''))
  const exento = formData.get('exento') === 'on'

  if (sku === '') return { error: 'El SKU es obligatorio' }
  if (nombre === '') return { error: 'El nombre es obligatorio' }
  if (precioNeto === null) return { error: 'El precio neto debe ser un entero CLP mayor o igual a 0' }

  const supabase = await crearClienteServidor()
  const categoria = await resolverCategoria(
    supabase,
    activa.id,
    String(formData.get('categoria_id') ?? ''),
    String(formData.get('categoria_nueva') ?? '')
  )
  if (categoria.error) return { error: categoria.error }

  const datos = {
    sku,
    nombre,
    descripcion: descripcion || null,
    codigo_barras: codigoBarras || null,
    unidad,
    precio_neto: precioNeto,
    exento,
    categoria_id: categoria.id,
    actualizado_en: new Date().toISOString(),
  }

  if (id) {
    const { data, error } = await supabase
      .from('productos')
      .update(datos)
      .eq('id', id)
      .eq('empresa_id', activa.id)
      .select('id')
    if (error) {
      if (error.code === '23505') return { error: 'Ya existe un producto con ese SKU' }
      if (error.code === '42501') return { error: 'Tu rol no permite editar productos' }
      return { error: 'No se pudo guardar el producto' }
    }
    if ((data ?? []).length === 0) {
      return { error: 'No se pudo guardar: el producto no existe o tu rol no permite editarlo' }
    }
  } else {
    const { error } = await supabase
      .from('productos')
      .insert({ ...datos, empresa_id: activa.id })
    if (error) {
      if (error.code === '23505') return { error: 'Ya existe un producto con ese SKU' }
      if (error.code === '42501') return { error: 'Tu rol no permite crear productos' }
      return { error: 'No se pudo crear el producto' }
    }
  }

  revalidatePath('/productos')
  redirect('/productos')
}

export async function alternarActivoProducto(formData: FormData): Promise<void> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return
  const id = String(formData.get('id') ?? '')
  const activo = String(formData.get('activo') ?? '') === 'true'
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase
    .from('productos')
    .update({ activo: !activo, actualizado_en: new Date().toISOString() })
    .eq('id', id)
    .eq('empresa_id', activa.id)
    .select('id')
  if (error || (data ?? []).length === 0) {
    console.error('alternarActivo:', error ?? 'sin filas')
    return
  }
  revalidatePath('/productos')
}
