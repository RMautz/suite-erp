'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import type { Json } from '@suite/db'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import type { EstadoForm } from '../tipos'

type LineaEntrada = { productoId: string; cantidad: number; costoUnitario: number }

export async function crearOrdenCompra(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const proveedor = String(formData.get('proveedor_id') ?? '')
  const notas = String(formData.get('notas') ?? '').trim()
  if (!proveedor) return { error: 'Selecciona un proveedor' }

  let lineas: LineaEntrada[]
  try {
    lineas = JSON.parse(String(formData.get('lineas') ?? '[]')) as LineaEntrada[]
  } catch {
    return { error: 'Las líneas de la orden no son válidas' }
  }
  if (!Array.isArray(lineas) || lineas.length === 0) return { error: 'Agrega al menos una línea' }
  for (const l of lineas) {
    if (!l.productoId || !Number.isInteger(l.cantidad) || l.cantidad < 1) {
      return { error: 'Cada línea necesita producto y cantidad entera mayor a 0' }
    }
    if (!Number.isInteger(l.costoUnitario) || l.costoUnitario < 0) {
      return { error: 'El costo unitario debe ser un entero mayor o igual a 0' }
    }
  }

  const supabase = await crearClienteServidor()
  // p_lineas es jsonb en SQL; el generador de tipos lo tipa como Json, no como el shape real: castea sólo el tipo.
  // p_notas es opcional en SQL (text acepta NULL), pero el generador no refleja la nulabilidad de argumentos
  // de función: castea sólo el tipo, no el valor (mismo criterio que inventario/movimientos/acciones.ts).
  const { data: ordenId, error } = await supabase.rpc('crear_orden_compra', {
    p_empresa: activa.id,
    p_proveedor: proveedor,
    p_lineas: lineas.map((l) => ({ productoId: l.productoId, cantidad: l.cantidad, costoUnitario: l.costoUnitario })) as unknown as Json,
    p_notas: (notas || null) as string,
  })
  if (error || !ordenId) {
    return { error: error?.message.includes('rol') ? 'Tu rol no permite crear órdenes de compra' : 'No se pudo crear la orden' }
  }
  revalidatePath('/compras')
  redirect('/compras/' + ordenId)
}

// Transiciones simples por update directo (RLS: dueno/admin; grant solo columnas estado/actualizado_en).
// El guard .eq('estado', ...) + .select('id') convierte 0 filas de RLS/estado en no-op explícito.
export async function marcarEnviada(formData: FormData): Promise<void> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return
  const id = String(formData.get('id') ?? '')
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase
    .from('ordenes_compra')
    .update({ estado: 'enviada', actualizado_en: new Date().toISOString() })
    .eq('id', id).eq('empresa_id', activa.id).eq('estado', 'borrador')
    .select('id')
  if (error || (data ?? []).length === 0) { console.error('marcarEnviada:', error ?? 'sin filas'); return }
  revalidatePath('/compras')
  revalidatePath('/compras/' + id)
}

export async function cancelarOrden(formData: FormData): Promise<void> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return
  const id = String(formData.get('id') ?? '')
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase
    .from('ordenes_compra')
    .update({ estado: 'cancelada', actualizado_en: new Date().toISOString() })
    .eq('id', id).eq('empresa_id', activa.id).in('estado', ['borrador', 'enviada'])
    .select('id')
  if (error || (data ?? []).length === 0) { console.error('cancelarOrden:', error ?? 'sin filas'); return }
  revalidatePath('/compras')
  revalidatePath('/compras/' + id)
}

type LineaRecepcion = { ordenLineaId: string; cantidad: number }

export async function registrarRecepcion(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const orden = String(formData.get('orden_id') ?? '')
  const bodega = String(formData.get('bodega_id') ?? '')
  const notas = String(formData.get('notas') ?? '').trim()
  if (!orden || !bodega) return { error: 'Selecciona la bodega de destino' }

  let lineas: LineaRecepcion[]
  try {
    lineas = (JSON.parse(String(formData.get('lineas') ?? '[]')) as LineaRecepcion[]).filter((l) => l.cantidad > 0)
  } catch {
    return { error: 'Las cantidades de la recepción no son válidas' }
  }
  if (lineas.length === 0) return { error: 'Ingresa al menos una cantidad a recibir' }
  for (const l of lineas) {
    if (!l.ordenLineaId || !Number.isInteger(l.cantidad) || l.cantidad < 1) {
      return { error: 'Las cantidades deben ser enteros mayores a 0' }
    }
  }

  const supabase = await crearClienteServidor()
  // p_lineas es jsonb en SQL; el generador de tipos lo tipa como Json, no como el shape real: castea sólo el tipo.
  // p_notas es opcional en SQL (text acepta NULL), pero el generador no refleja la nulabilidad de argumentos
  // de función: castea sólo el tipo, no el valor (mismo criterio que crearOrdenCompra más arriba).
  const { error } = await supabase.rpc('registrar_recepcion', {
    p_empresa: activa.id,
    p_orden: orden,
    p_bodega: bodega,
    p_lineas: lineas.map((l) => ({ ordenLineaId: l.ordenLineaId, cantidad: l.cantidad })) as unknown as Json,
    p_notas: (notas || null) as string,
  })
  if (error) {
    if (error.message.includes('rol')) return { error: 'Tu rol no permite recibir mercadería' }
    if (error.message.includes('pendiente')) return { error: error.message }
    if (error.message.includes('estado')) return { error: 'La orden no está en un estado que permita recepción' }
    return { error: 'No se pudo registrar la recepción' }
  }
  revalidatePath('/compras')
  revalidatePath('/compras/' + orden)
  redirect('/compras/' + orden)
}
