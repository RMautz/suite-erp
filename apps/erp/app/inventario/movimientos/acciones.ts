'use server'

import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@suite/auth/server'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import type { EstadoForm } from '../../tipos'

function enteroPositivo(v: FormDataEntryValue | null): number | null {
  const n = Number(String(v ?? '').trim())
  return Number.isInteger(n) && n > 0 ? n : null
}

export async function registrarEntrada(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  const producto = String(formData.get('producto_id') ?? '')
  const bodega = String(formData.get('bodega_id') ?? '')
  const cantidad = enteroPositivo(formData.get('cantidad'))
  const proveedor = String(formData.get('proveedor_id') ?? '') || null
  const motivo = String(formData.get('motivo') ?? '').trim() || null
  if (!producto || !bodega) return { error: 'Selecciona producto y bodega' }
  if (cantidad === null) return { error: 'La cantidad debe ser un entero mayor a 0' }
  const supabase = await crearClienteServidor()
  // p_proveedor/p_motivo son opcionales en SQL (uuid/text aceptan NULL), pero el generador de tipos
  // no refleja la nulabilidad de argumentos de función: castea sólo el tipo, no el valor.
  const { error } = await supabase.rpc('registrar_entrada', {
    p_empresa: activa.id, p_producto: producto, p_bodega: bodega, p_cantidad: cantidad,
    p_proveedor: proveedor as string, p_motivo: motivo as string,
  })
  if (error) return { error: error.message.includes('rol') ? 'Tu rol no permite registrar entradas' : 'No se pudo registrar la entrada' }
  revalidatePath('/inventario/movimientos')
  return {}
}

export async function registrarAjuste(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  const producto = String(formData.get('producto_id') ?? '')
  const bodega = String(formData.get('bodega_id') ?? '')
  const cantidad = Number(String(formData.get('cantidad') ?? '').trim())
  const motivo = String(formData.get('motivo') ?? '').trim()
  if (!producto || !bodega) return { error: 'Selecciona producto y bodega' }
  if (!Number.isInteger(cantidad) || cantidad === 0) return { error: 'El ajuste debe ser un entero distinto de 0 (usa negativo para restar)' }
  if (motivo === '') return { error: 'El ajuste requiere un motivo' }
  const supabase = await crearClienteServidor()
  const { error } = await supabase.rpc('registrar_ajuste', {
    p_empresa: activa.id, p_producto: producto, p_bodega: bodega, p_cantidad: cantidad, p_motivo: motivo,
  })
  if (error) return { error: error.message.includes('rol') ? 'Tu rol no permite ajustar stock' : 'No se pudo registrar el ajuste' }
  revalidatePath('/inventario/movimientos')
  return {}
}

export async function registrarTraslado(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  const producto = String(formData.get('producto_id') ?? '')
  const origen = String(formData.get('bodega_origen') ?? '')
  const destino = String(formData.get('bodega_destino') ?? '')
  const cantidad = enteroPositivo(formData.get('cantidad'))
  if (!producto || !origen || !destino) return { error: 'Selecciona producto y ambas bodegas' }
  if (origen === destino) return { error: 'La bodega de origen y destino deben ser distintas' }
  if (cantidad === null) return { error: 'La cantidad debe ser un entero mayor a 0' }
  const supabase = await crearClienteServidor()
  const { error } = await supabase.rpc('registrar_traslado', {
    p_empresa: activa.id, p_producto: producto, p_origen: origen, p_destino: destino, p_cantidad: cantidad,
  })
  if (error) return { error: error.message.includes('rol') ? 'Tu rol no permite trasladar stock' : 'No se pudo registrar el traslado' }
  revalidatePath('/inventario/movimientos')
  return {}
}
