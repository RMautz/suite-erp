'use server'

import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP } from '@suite/core'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'

// Patrón EstadoContabilizar (contabilidad/acciones.ts): error del RPC sin
// reescribir + mensaje de éxito armado en la action.
export type EstadoCierre = { error?: string; exito?: string }

function leerAnio(formData: FormData): number | null {
  const anio = Number(formData.get('anio'))
  return Number.isInteger(anio) && anio >= 2000 && anio <= 2100 ? anio : null
}

export async function cerrarEjercicio(_prev: EstadoCierre, formData: FormData): Promise<EstadoCierre> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  const anio = leerAnio(formData)
  if (anio === null) return { error: 'Año no válido' }
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase.rpc('cerrar_ejercicio', { p_empresa: activa.id, p_anio: anio })
  if (error) return { error: error.message }
  revalidatePath('/contabilidad')
  revalidatePath('/contabilidad/revision')
  // noop del RPC (spec §3.1): sin movimientos de resultado retorna null y no crea fila.
  if (!data) return { exito: `El ejercicio ${anio} no tenía movimientos de resultado; no hizo falta asiento de cierre.` }
  // El RPC retorna el uuid del asiento; la utilidad quedó en cierres_ejercicio.resultado.
  const { data: cierre } = await supabase
    .from('cierres_ejercicio')
    .select('resultado')
    .eq('empresa_id', activa.id)
    .eq('anio', anio)
    .single()
  const resultado = cierre?.resultado ?? 0
  return {
    exito:
      resultado >= 0
        ? `Ejercicio ${anio} cerrado con utilidad de ${formatearCLP(resultado)}`
        : `Ejercicio ${anio} cerrado con pérdida de ${formatearCLP(Math.abs(resultado))}`,
  }
}

export async function reabrirEjercicio(_prev: EstadoCierre, formData: FormData): Promise<EstadoCierre> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  const anio = leerAnio(formData)
  if (anio === null) return { error: 'Año no válido' }
  const supabase = await crearClienteServidor()
  const { error } = await supabase.rpc('reabrir_ejercicio', { p_empresa: activa.id, p_anio: anio })
  if (error) return { error: error.message }
  revalidatePath('/contabilidad')
  revalidatePath('/contabilidad/revision')
  return { exito: `Ejercicio ${anio} reabierto: el asiento de cierre quedó revertido.` }
}
