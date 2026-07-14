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
