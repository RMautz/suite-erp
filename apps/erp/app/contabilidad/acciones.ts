'use server'

import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@suite/auth/server'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'

export type EstadoContabilizar = { error?: string; creados?: number }

export async function contabilizarPendientes(
  _prev: EstadoContabilizar,
  _formData: FormData,
): Promise<EstadoContabilizar> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase.rpc('contabilizar_pendientes', { p_empresa: activa.id })
  if (error) return { error: error.message }
  revalidatePath('/contabilidad')
  return { creados: (data as unknown as { creados: number } | null)?.creados ?? 0 }
}
