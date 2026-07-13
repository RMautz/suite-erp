'use server'

import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import type { ResultadoVenta } from '../tipos'

export async function crearNotaVenta(_prev: ResultadoVenta, formData: FormData): Promise<ResultadoVenta> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const clienteId = String(formData.get('cliente_id') ?? '')
  if (!clienteId) return { error: 'Selecciona un cliente' }

  let lineas: unknown
  try {
    lineas = JSON.parse(String(formData.get('lineas') ?? '[]'))
  } catch {
    return { error: 'Líneas inválidas' }
  }
  if (!Array.isArray(lineas) || lineas.length === 0) return { error: 'Agrega al menos un producto' }

  const supabase = await crearClienteServidor()
  const { data, error } = await supabase.rpc('crear_documento_venta', {
    p_empresa: activa.id,
    p_cliente: clienteId,
    p_tipo: 'nota_venta',
    p_lineas: lineas,
  })
  if (error) return { error: error.message.includes('rol') ? 'Tu rol no permite crear ventas' : 'No se pudo crear la venta' }

  redirect('/ventas/' + data)
}
