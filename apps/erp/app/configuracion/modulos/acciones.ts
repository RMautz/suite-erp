'use server'

import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@suite/auth/server'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import type { EstadoForm } from '../../tipos'

export async function guardarModulos(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  // modulo_transporte ya no se escribe aquí: es un flag derivado del rubro (0023)
  // y su columna no tiene grant de UPDATE — solo se mueve por cambiar_rubro.
  const factor = Number(String(formData.get('factor_volumetrico') ?? '').trim())
  // Mismo rango que el check de la tabla (0016): rechazar aquí da mensaje claro
  // en vez de un 23514 crudo.
  if (!Number.isInteger(factor) || factor < 1 || factor > 10000) {
    return { error: 'El factor volumétrico debe ser un entero entre 1 y 10000' }
  }

  const supabase = await crearClienteServidor()
  const { data, error } = await supabase
    .from('empresas')
    .update({ factor_volumetrico: factor })
    .eq('id', activa.id)
    .select('id')
  if (error) return { error: 'No se pudo guardar la configuración de módulos' }
  if ((data ?? []).length === 0) return { error: 'No se pudo guardar: solo el dueño o admin puede cambiar los módulos' }

  // El NAV condicional vive en el layout raíz: revalidar todo el árbol.
  revalidatePath('/', 'layout')
  return {}
}

export type EstadoContabilidad = { error?: string; mensaje?: string }

export async function alternarContabilidad(
  _prev: EstadoContabilidad,
  formData: FormData,
): Promise<EstadoContabilidad> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const activar = formData.get('modulo_contabilidad') === 'on'
  const supabase = await crearClienteServidor()

  // Desactivar: solo apaga el flag (asientos y cuentas quedan). Es la ÚNICA vía junto
  // con activar de mover modulo_contabilidad (la columna no tiene grant de UPDATE).
  if (!activar) {
    const { error } = await supabase.rpc('desactivar_contabilidad', { p_empresa: activa.id })
    if (error) return { error: error.message }
    revalidatePath('/', 'layout')
    return { mensaje: 'Contabilidad desactivada.' }
  }

  // Activar = sembrar el catálogo + prender el flag (RPC 1) y luego contabilizar el
  // histórico (RPC 2, mismo motor que el botón "Contabilizar pendientes"). AMBAS por el
  // cliente del usuario: son authenticated dueno/admin (el admin client daría 42501).
  const { error: eActivar } = await supabase.rpc('activar_contabilidad', { p_empresa: activa.id })
  if (eActivar) return { error: eActivar.message }
  const { data: pendientes, error: ePend } = await supabase.rpc('contabilizar_pendientes', {
    p_empresa: activa.id,
  })
  if (ePend) return { error: ePend.message }
  const creados = (pendientes as unknown as { creados: number } | null)?.creados ?? 0
  revalidatePath('/', 'layout')
  return {
    mensaje: `Contabilidad activada. ${creados} asiento${creados === 1 ? '' : 's'} creado${creados === 1 ? '' : 's'} del historial.`,
  }
}

export async function guardarTasaMutual(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  // Coma decimal es-CL admitida; la columna es numeric(4,2), así que se redondea
  // a 2 decimales ACÁ para que lo guardado sea exactamente lo que la UI muestra.
  // Fail-closed: el vacío se rechaza ANTES de Number() — Number('') === 0 pasaría
  // el rango en silencio con un POST directo (el required del input no protege eso).
  const crudo = String(formData.get('tasa_mutual') ?? '').trim()
  const tasa = crudo === '' ? NaN : Math.round(Number(crudo.replace(',', '.')) * 100) / 100
  // Mismo rango que el check de la tabla (0026): rechazar aquí da mensaje claro
  // en vez de un 23514 crudo. Math.round(NaN)/100 sigue siendo NaN → cae acá.
  if (!Number.isFinite(tasa) || tasa < 0 || tasa > 10) {
    return { error: 'La tasa mutual debe ser un número entre 0 y 10 (% sobre el imponible)' }
  }

  const supabase = await crearClienteServidor()
  // Update por columna: el grant de tasa_mutual lo da la 0026 y la policy de fila
  // limita a dueño/admin — 0 filas actualizadas = RLS bloqueó, no un error SQL.
  const { data, error } = await supabase
    .from('empresas')
    .update({ tasa_mutual: tasa })
    .eq('id', activa.id)
    .select('id')
  if (error) return { error: 'No se pudo guardar la tasa mutual' }
  if ((data ?? []).length === 0) return { error: 'No se pudo guardar: solo el dueño o admin puede cambiar la tasa mutual' }

  // La vista previa de /liquidaciones/generar lee tasa_mutual server-side:
  // revalidar todo el árbol, igual que guardarModulos.
  revalidatePath('/', 'layout')
  return {}
}
