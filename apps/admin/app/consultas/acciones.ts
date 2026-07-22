'use server'

import { revalidatePath } from 'next/cache'
import { clienteAdmin } from '@suite/auth/admin'
import { verificarAdmin } from '../../lib/guardia'

export type EstadoRespuesta = { error?: string; ok?: boolean }

// Responder marca la consulta como respondida; el tenant la lee en /consultas de la
// web. service_role tras verificarAdmin (patron de todo apps/admin).
export async function responderConsulta(_prev: EstadoRespuesta, formData: FormData): Promise<EstadoRespuesta> {
  await verificarAdmin()
  const id = String(formData.get('consulta_id') ?? '')
  const respuesta = String(formData.get('respuesta') ?? '').trim()
  if (!id) return { error: 'Consulta no válida' }
  if (respuesta === '') return { error: 'Escribe una respuesta' }

  const { data, error } = await clienteAdmin()
    .from('consultas_admin')
    .update({ respuesta, estado: 'respondida', respondida_en: new Date().toISOString() })
    .eq('id', id)
    .neq('estado', 'cerrada')
    .select('id')
  if (error) return { error: 'No se pudo guardar la respuesta' }
  if ((data ?? []).length === 0) return { error: 'La consulta no existe o ya está cerrada' }
  revalidatePath('/consultas')
  return { ok: true }
}

export async function cerrarConsulta(_prev: EstadoRespuesta, formData: FormData): Promise<EstadoRespuesta> {
  await verificarAdmin()
  const id = String(formData.get('consulta_id') ?? '')
  if (!id) return { error: 'Consulta no válida' }
  const { error } = await clienteAdmin().from('consultas_admin').update({ estado: 'cerrada' }).eq('id', id)
  if (error) return { error: 'No se pudo cerrar la consulta' }
  revalidatePath('/consultas')
  return { ok: true }
}
