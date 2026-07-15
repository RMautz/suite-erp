'use server'

import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@suite/auth/server'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import type { EstadoForm } from '../../tipos'

export async function guardarModulos(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const moduloTransporte = formData.get('modulo_transporte') === 'on'
  const factor = Number(String(formData.get('factor_volumetrico') ?? '').trim())
  // Mismo rango que el check de la tabla (0016): rechazar aquí da mensaje claro
  // en vez de un 23514 crudo.
  if (!Number.isInteger(factor) || factor < 1 || factor > 10000) {
    return { error: 'El factor volumétrico debe ser un entero entre 1 y 10000' }
  }

  const supabase = await crearClienteServidor()
  const { data, error } = await supabase
    .from('empresas')
    .update({ modulo_transporte: moduloTransporte, factor_volumetrico: factor })
    .eq('id', activa.id)
    .select('id')
  if (error) return { error: 'No se pudo guardar la configuración de módulos' }
  if ((data ?? []).length === 0) return { error: 'No se pudo guardar: solo el dueño o admin puede cambiar los módulos' }

  // El NAV condicional vive en el layout raíz: revalidar todo el árbol.
  revalidatePath('/', 'layout')
  return {}
}
