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

// Fail-closed: tasa en % del imponible (> 0 y <= 100) — candado P19 §6 para
// TODAS las tasas (AFP y SIS): una tasa sobre 100% es siempre un error de tipeo.
function tasaPorcentual(formData: FormData, campo: string): number {
  const n = positivo(formData, campo)
  if (n > 100) throw new Error('Valor no válido en ' + campo + ' (una tasa en % no puede superar 100)')
  return n
}

// Arma tramos_impuesto desde los campos tramo_{i}_* del formulario (spec P18 §6:
// los tramos son campos individuales y el jsonb se arma server-side).
// Candados de integridad (P19 §6), todos fail-closed con mensaje por campo:
// el tramo 1 parte en desde = 0; tramos CONTIGUOS (hasta[i] = desde[i+1], sin
// huecos ni solapes); cada tramo con tope exige desde < hasta; SOLO el último
// queda sin tope (hasta vacío = null); factores entre 0 y 1; rebajas >= 0.
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
  // Los ! de abajo son por noUncheckedIndexedAccess: los índices están
  // garantizados por los propios límites de los bucles/length.
  if (lista[0]!.desde_utm !== 0) {
    throw new Error('El tramo 1 debe partir en desde = 0 (la tabla cubre desde la primera UTM)')
  }
  for (let i = 0; i < lista.length - 1; i++) {
    const hasta = lista[i]!.hasta_utm
    if (hasta == null) {
      throw new Error('Solo el último tramo puede quedar sin tope: completa hasta en el tramo ' + (i + 1))
    }
    // Contigüidad estricta comparando NÚMEROS (noNegativo ya parseó): sin
    // huecos ni solapes entre tramos consecutivos.
    if (hasta !== lista[i + 1]!.desde_utm) {
      throw new Error(
        'Tramos ' + (i + 1) + ' y ' + (i + 2) + ' no contiguos: hasta del tramo ' + (i + 1) +
        ' (' + hasta + ') debe ser igual a desde del tramo ' + (i + 2) + ' (' + lista[i + 1]!.desde_utm + ')'
      )
    }
  }
  if (lista[lista.length - 1]!.hasta_utm != null) {
    throw new Error('El último tramo debe quedar sin tope (deja hasta vacío)')
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
    tasa_sis: tasaPorcentual(formData, 'tasa_sis'),
    tasas_afp: Object.fromEntries(AFPS.map((a) => [a, tasaPorcentual(formData, 'tasa_' + a)])),
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
