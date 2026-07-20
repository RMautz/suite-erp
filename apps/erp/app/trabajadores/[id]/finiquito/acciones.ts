'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { contabilizarAsiento } from '../../../../lib/contabilidad'
import { obtenerEmpresaActiva } from '../../../../lib/empresa-activa'
import type { EstadoForm } from '../../../tipos'
import { CAUSALES } from '../../catalogos'

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/

// IGUALDAD ESTRICTA del mensaje completo (spec §3, patrón liquidaciones):
// cualquier otro error cae al genérico.
const ERRORES_EMITIR = new Set([
  'Tu rol no permite emitir finiquitos',
  'El trabajador no tiene contrato vigente',
  'No hay indicadores previsionales para el período',
  'Ya existe un finiquito para este contrato',
  'La fecha de término no puede ser anterior al inicio del primer contrato',
  'El total del finiquito no puede ser negativo: revisa los descuentos',
])

export async function emitirFiniquito(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const trabajador = String(formData.get('trabajador_id') ?? '')
  const causal = String(formData.get('causal') ?? '')
  const fechaTermino = String(formData.get('fecha_termino') ?? '').trim()
  const avisoDado = formData.get('aviso_dado') === 'on'
  const otrosHaberes = Math.trunc(Number(formData.get('otros_haberes') || 0))
  const otrosDescuentos = Math.trunc(Number(formData.get('otros_descuentos') || 0))
  const comentario = String(formData.get('comentario') ?? '').trim()
  if (!trabajador) return { error: 'Falta el trabajador del finiquito' }
  if (!CAUSALES.some((c) => c.valor === causal)) return { error: 'La causal no es válida' }
  if (!FECHA_ISO.test(fechaTermino)) return { error: 'La fecha de término no es válida' }
  if (!Number.isFinite(otrosHaberes) || otrosHaberes < 0 || !Number.isFinite(otrosDescuentos) || otrosDescuentos < 0)
    return { error: 'Los montos no pueden ser negativos' }

  const supabase = await crearClienteServidor()
  const { data, error } = await supabase.rpc('emitir_finiquito', {
    p_empresa: activa.id,
    p_trabajador: trabajador,
    p_causal: causal,
    p_fecha_termino: fechaTermino,
    p_aviso_dado: avisoDado,
    p_otros_haberes: otrosHaberes,
    p_otros_descuentos: otrosDescuentos,
    // El Arg del codegen es string requerido (la firma T2 no tiene default);
    // la RPC normaliza '' -> null con nullif(trim(...)).
    p_comentario: comentario,
  })
  if (error) {
    if (ERRORES_EMITIR.has(error.message)) return { error: error.message }
    return { error: 'No se pudo emitir el finiquito' }
  }
  // Hook best-effort (NUNCA lanza, spec §4): el asiento origen 'finiquito' se crea
  // aparte; si falla, "Contabilizar pendientes" lo repara (mismo motor idempotente).
  await contabilizarAsiento(activa.id, 'finiquito', data)
  revalidatePath('/trabajadores')
  revalidatePath(`/trabajadores/${trabajador}`)
  revalidatePath(`/trabajadores/${trabajador}/finiquito`)
  // redirect lanza NEXT_REDIRECT: FUERA de try/catch. La misma ruta muestra ahora el DETALLE.
  redirect(`/trabajadores/${trabajador}/finiquito`)
}

const ERRORES_PAGAR = new Set(['Solo se puede pagar un finiquito emitido'])

export async function pagarFiniquito(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  const finiquito = String(formData.get('finiquito_id') ?? '')
  const trabajador = String(formData.get('trabajador_id') ?? '')
  if (!finiquito) return { error: 'Finiquito no válido' }
  const supabase = await crearClienteServidor()
  const { error } = await supabase.rpc('pagar_finiquito', {
    p_empresa: activa.id,
    p_finiquito: finiquito,
  })
  if (error) {
    if (ERRORES_PAGAR.has(error.message) || error.message.startsWith('Tu rol no permite'))
      return { error: error.message }
    return { error: 'No se pudo pagar el finiquito' }
  }
  revalidatePath(`/trabajadores/${trabajador}/finiquito`)
  return {}
}

const ERRORES_ANULAR = new Set([
  'Indica el motivo de la anulación',
  'Solo se puede anular un finiquito emitido o pagado',
  'El trabajador ya tiene otro contrato vigente',
])

export async function anularFiniquito(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  const finiquito = String(formData.get('finiquito_id') ?? '')
  const trabajador = String(formData.get('trabajador_id') ?? '')
  const motivo = String(formData.get('motivo') ?? '').trim()
  if (!finiquito) return { error: 'Finiquito no válido' }
  if (!motivo) return { error: 'Indica el motivo de la anulación' }
  const supabase = await crearClienteServidor()
  const { error } = await supabase.rpc('anular_finiquito', {
    p_empresa: activa.id,
    p_finiquito: finiquito,
    p_motivo: motivo,
  })
  if (error) {
    if (ERRORES_ANULAR.has(error.message) || error.message.startsWith('Tu rol no permite'))
      return { error: error.message }
    return { error: 'No se pudo anular el finiquito' }
  }

  // Reversa contable best-effort (patrón NUNCA-lanza de anularLiquidacion): la
  // anulación ya está confirmada en BD; si la reversa falla (p. ej. período
  // cerrado) el asiento original queda visible y se revierte a mano.
  try {
    const { data: asiento } = await supabase
      .from('asientos')
      .select('id')
      .eq('empresa_id', activa.id)
      .eq('origen', 'finiquito')
      .eq('referencia_id', finiquito)
      .maybeSingle()
    if (asiento) {
      const { data: fin } = await supabase
        .from('finiquitos')
        .select('trabajadores (nombre)')
        .eq('id', finiquito)
        .eq('empresa_id', activa.id)
        .single()
      const { error: errorReversa } = await supabase.rpc('revertir_asiento', {
        p_empresa: activa.id,
        p_asiento: asiento.id,
        // Glosa fijada por el spec §4: 'Anulación finiquito {nombre}'.
        p_glosa: `Anulación finiquito ${fin?.trabajadores?.nombre ?? ''}`.trim(),
      })
      if (errorReversa) console.error('anularFiniquito (reversa):', errorReversa.message)
    }
  } catch (e) {
    console.error('anularFiniquito (reversa):', e)
  }

  revalidatePath('/trabajadores')
  revalidatePath(`/trabajadores/${trabajador}`)
  revalidatePath(`/trabajadores/${trabajador}/finiquito`)
  revalidatePath('/contabilidad/asientos')
  return {}
}
