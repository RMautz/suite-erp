'use server'

import { revalidatePath } from 'next/cache'
import { clienteAdmin } from '@suite/auth/admin'
import { verificarAdmin } from '../../lib/guardia'
import { AFPS } from './afps'

const PERIODO = /^\d{4}-(0[1-9]|1[0-2])$/

// Fail-closed: campo ausente, no numérico o <= 0 aborta la acción completa.
function positivo(formData: FormData, campo: string): number {
  const n = Number(String(formData.get(campo) ?? '').replace(',', '.'))
  if (!Number.isFinite(n) || n <= 0) throw new Error('Valor no válido en ' + campo + ' (se exige un número mayor que 0)')
  return n
}

// Fail-closed: >= 0 (los tramos admiten cero en desde, factor y rebaja).
function noNegativo(formData: FormData, campo: string): number {
  const n = Number(String(formData.get(campo) ?? '').replace(',', '.'))
  if (!Number.isFinite(n) || n < 0) throw new Error('Valor no válido en ' + campo + ' (se exige un número mayor o igual a 0)')
  return n
}

// Arma tramos_impuesto desde los campos tramo_{i}_* del formulario (spec §6:
// los tramos son campos individuales y el jsonb se arma server-side).
// Validación fail-closed: cada tramo exige desde < hasta; SOLO el último puede
// venir con hasta vacío (null = sin tope); factores entre 0 y 1; rebajas >= 0.
function leerTramos(formData: FormData) {
  const lista: { desde_utm: number; hasta_utm: number | null; factor: number; rebaja_utm: number }[] = []
  for (let i = 0; formData.has('tramo_' + i + '_desde'); i++) {
    const desde = noNegativo(formData, 'tramo_' + i + '_desde')
    const hastaCrudo = String(formData.get('tramo_' + i + '_hasta') ?? '').trim()
    const hasta = hastaCrudo === '' ? null : noNegativo(formData, 'tramo_' + i + '_hasta')
    const factor = noNegativo(formData, 'tramo_' + i + '_factor')
    if (factor > 1) throw new Error('Factor no válido en el tramo ' + (i + 1) + ' (se exige entre 0 y 1)')
    if (hasta != null && hasta <= desde) throw new Error('Tramo ' + (i + 1) + ' no válido: desde debe ser menor que hasta')
    lista.push({ desde_utm: desde, hasta_utm: hasta, factor, rebaja_utm: noNegativo(formData, 'tramo_' + i + '_rebaja') })
  }
  if (lista.length === 0) throw new Error('Faltan los tramos del impuesto único')
  if (lista.some((t, i) => t.hasta_utm == null && i < lista.length - 1)) {
    throw new Error('Solo el último tramo puede quedar sin tope (hasta vacío)')
  }
  return lista
}

export async function guardarPeriodo(formData: FormData) {
  const periodo = String(formData.get('periodo') ?? '').trim()
  if (!PERIODO.test(periodo)) throw new Error('Período no válido (formato YYYY-MM)')
  const valores = {
    uf: Math.round(positivo(formData, 'uf')),
    utm: Math.round(positivo(formData, 'utm')),
    ingreso_minimo: Math.round(positivo(formData, 'ingreso_minimo')),
    tope_imponible_uf: positivo(formData, 'tope_imponible_uf'),
    tope_cesantia_uf: positivo(formData, 'tope_cesantia_uf'),
    tasas_afp: Object.fromEntries(AFPS.map((a) => [a, positivo(formData, 'tasa_' + a)])),
    tramos_impuesto: leerTramos(formData),
    actualizado_en: new Date().toISOString(),
  }
  await verificarAdmin()
  const admin = clienteAdmin()
  // Upsert por PK periodo: crear y editar comparten el camino (TODOS los
  // campos, tramos incluidos, vienen del formulario — spec §6).
  const { error } = await admin.from('indicadores_previsionales').upsert({ periodo, ...valores })
  if (error) throw new Error('No se pudo guardar el período: ' + error.message)
  revalidatePath('/indicadores')
}
