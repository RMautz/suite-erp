'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { contabilizarAsiento } from '../../lib/contabilidad'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import type { EstadoForm } from '../tipos'

// IGUALDAD ESTRICTA del mensaje completo (spec §4): cualquier otro error cae al genérico.
const ERRORES_EMITIR = new Set([
  'Tu rol no permite emitir liquidaciones',
  'El trabajador no tiene contrato vigente',
  'No hay indicadores previsionales para el período',
  'Ya existe una liquidación de ese período',
  'Período no válido',
  'El líquido no puede ser negativo: revisa los días trabajados y los descuentos',
])

// Mismo CHECK del período que la migración 0025.
const RE_PERIODO = /^\d{4}-(0[1-9]|1[0-2])$/

export async function emitirLiquidacion(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const trabajador = String(formData.get('trabajador_id') ?? '')
  const periodo = String(formData.get('periodo') ?? '')
  const dias = Math.trunc(Number(formData.get('dias')))
  const extras = Math.trunc(Number(formData.get('extras')))
  const noImponibles = Math.trunc(Number(formData.get('no_imponibles')))
  if (!trabajador) return { error: 'Selecciona un trabajador' }
  if (!RE_PERIODO.test(periodo)) return { error: 'Período no válido' }
  if (!Number.isFinite(dias) || dias < 1 || dias > 30)
    return { error: 'Los días trabajados deben estar entre 1 y 30' }
  if (!Number.isFinite(extras) || extras < 0 || !Number.isFinite(noImponibles) || noImponibles < 0)
    return { error: 'Los montos no pueden ser negativos' }

  const supabase = await crearClienteServidor()
  const { data, error } = await supabase.rpc('emitir_liquidacion', {
    p_empresa: activa.id,
    p_trabajador: trabajador,
    p_periodo: periodo,
    p_dias: dias,
    p_extras: extras,
    p_no_imponibles: noImponibles,
  })
  if (error) {
    if (ERRORES_EMITIR.has(error.message)) return { error: error.message }
    return { error: 'No se pudo emitir la liquidación' }
  }
  // Hook best-effort (NUNCA lanza): el asiento origen 'remuneracion' se crea aparte;
  // si falla, "Contabilizar pendientes" lo repara (mismo motor idempotente).
  await contabilizarAsiento(activa.id, 'remuneracion', data)
  revalidatePath('/liquidaciones')
  // redirect lanza NEXT_REDIRECT: va FUERA de cualquier try/catch. data = uuid de la liquidación.
  redirect(`/liquidaciones/${data}`)
}

const ERRORES_PAGAR = new Set(['Solo se puede pagar una liquidación emitida'])

export async function pagarLiquidacion(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  const liquidacion = String(formData.get('liquidacion_id') ?? '')
  if (!liquidacion) return { error: 'Liquidación no válida' }
  const supabase = await crearClienteServidor()
  const { error } = await supabase.rpc('pagar_liquidacion', {
    p_empresa: activa.id,
    p_liquidacion: liquidacion,
  })
  if (error) {
    if (ERRORES_PAGAR.has(error.message) || error.message.startsWith('Tu rol no permite'))
      return { error: error.message }
    return { error: 'No se pudo pagar la liquidación' }
  }
  revalidatePath('/liquidaciones')
  revalidatePath(`/liquidaciones/${liquidacion}`)
  return {}
}

const ERRORES_ANULAR = new Set([
  'Indica el motivo de la anulación',
  'Solo se puede anular una liquidación emitida o pagada',
])

export async function anularLiquidacion(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  const liquidacion = String(formData.get('liquidacion_id') ?? '')
  const motivo = String(formData.get('motivo') ?? '').trim()
  if (!liquidacion) return { error: 'Liquidación no válida' }
  if (!motivo) return { error: 'Indica el motivo de la anulación' }
  const supabase = await crearClienteServidor()
  const { error } = await supabase.rpc('anular_liquidacion', {
    p_empresa: activa.id,
    p_liquidacion: liquidacion,
    p_motivo: motivo,
  })
  if (error) {
    if (ERRORES_ANULAR.has(error.message) || error.message.startsWith('Tu rol no permite'))
      return { error: error.message }
    return { error: 'No se pudo anular la liquidación' }
  }

  // Reversa contable best-effort (patrón NUNCA-lanza del hook contabilizarAsiento):
  // la anulación ya está confirmada en BD; si la reversa falla (p. ej. período
  // cerrado) queda el asiento original visible en /contabilidad/asientos y se
  // revierte a mano desde su detalle. El rol ya pasó anular_liquidacion (mismos
  // roles que revertir_asiento), así que el cliente del usuario alcanza.
  try {
    const { data: asiento } = await supabase
      .from('asientos')
      .select('id')
      .eq('empresa_id', activa.id)
      .eq('origen', 'remuneracion')
      .eq('referencia_id', liquidacion)
      .maybeSingle()
    if (asiento) {
      const { data: liq } = await supabase
        .from('liquidaciones')
        .select('periodo, trabajadores (nombre)')
        .eq('id', liquidacion)
        .eq('empresa_id', activa.id)
        .single()
      const { error: errorReversa } = await supabase.rpc('revertir_asiento', {
        p_empresa: activa.id,
        p_asiento: asiento.id,
        // Glosa fijada por el spec §5: 'Anulación liquidación {periodo} {nombre}'.
        p_glosa: `Anulación liquidación ${liq?.periodo ?? ''} ${liq?.trabajadores?.nombre ?? ''}`.trim(),
      })
      if (errorReversa) console.error('anularLiquidacion (reversa):', errorReversa.message)
    }
  } catch (e) {
    console.error('anularLiquidacion (reversa):', e)
  }

  revalidatePath('/liquidaciones')
  revalidatePath(`/liquidaciones/${liquidacion}`)
  revalidatePath('/contabilidad/asientos')
  return {}
}
