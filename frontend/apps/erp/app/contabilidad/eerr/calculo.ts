import 'server-only'
import type { crearClienteServidor } from '@suite/auth/server'
import { periodoAnterior, rangoDePeriodo } from '@suite/core'

type ClienteSupabase = Awaited<ReturnType<typeof crearClienteServidor>>

export interface FilaEERR {
  codigo: string
  nombre: string
  actual: number
  anterior: number
}

export interface EERR {
  periodo: string
  anterior: string
  ingresos: FilaEERR[]
  gastos: FilaEERR[]
  totalIngresos: { actual: number; anterior: number }
  totalGastos: { actual: number; anterior: number }
  resultado: { actual: number; anterior: number }
  // false = ninguna línea en cuentas de resultado en el período anterior
  // (tras la exclusión de cierres) → columnas anterior/variación muestran '—'.
  anteriorConDatos: boolean
}

interface AsientoPeriodo {
  origen: string
  reversa_de: string | null
  asientos_lineas: { cuenta_id: string; debe: number; haber: number }[]
}

// (variacion() vive en @suite/core/periodo.ts — testeable; este archivo es server-only.)

// Etiqueta legible: '2026' → '2026'; '2026-T3' → 'T3 2026'; '2026-07' → 'julio de 2026'.
export function etiquetaPeriodo(periodo: string): string {
  const tri = /^(\d{4})-T([1-4])$/.exec(periodo)
  if (tri) return `T${tri[2]} ${tri[1]}`
  const mes = /^(\d{4})-(\d{2})$/.exec(periodo)
  if (mes) {
    return new Date(Date.UTC(Number(mes[1]), Number(mes[2]) - 1, 1))
      .toLocaleDateString('es-CL', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  }
  return periodo
}

// Suma debe/haber por cuenta en un rango, excluyendo asientos de cierre y sus
// reversas ligadas (misma exclusión del balance §4.1).
async function movimientosPorCuenta(
  supabase: ClienteSupabase,
  empresaId: string,
  rango: { desde: string; hasta: string },
  idsCierre: Set<string>
): Promise<Map<string, { debe: number; haber: number }>> {
  // ponytail: sin paginación (cap PostgREST 1000 asientos por rango, mismo techo
  // que el diario); .range() en páginas si una empresa lo supera.
  const { data } = await supabase
    .from('asientos')
    .select('origen, reversa_de, asientos_lineas (cuenta_id, debe, haber)')
    .eq('empresa_id', empresaId)
    .gte('fecha', rango.desde)
    .lte('fecha', rango.hasta)
  const porCuenta = new Map<string, { debe: number; haber: number }>()
  for (const a of (data ?? []) as AsientoPeriodo[]) {
    if (a.origen === 'cierre') continue
    if (a.reversa_de && idsCierre.has(a.reversa_de)) continue
    for (const l of a.asientos_lineas) {
      const acc = porCuenta.get(l.cuenta_id) ?? { debe: 0, haber: 0 }
      acc.debe += l.debe
      acc.haber += l.haber
      porCuenta.set(l.cuenta_id, acc)
    }
  }
  return porCuenta
}

// EERR del período con columna del período anterior equivalente (spec §4.2).
// null si el período no tiene formato válido.
export async function obtenerEERR(
  supabase: ClienteSupabase,
  empresaId: string,
  periodo: string
): Promise<EERR | null> {
  const anterior = periodoAnterior(periodo)
  const rangoActual = rangoDePeriodo(periodo)
  const rangoAnterior = anterior ? rangoDePeriodo(anterior) : null
  if (!anterior || !rangoActual || !rangoAnterior) return null

  const { data: cierres } = await supabase
    .from('asientos')
    .select('id')
    .eq('empresa_id', empresaId)
    .eq('origen', 'cierre')
  const idsCierre = new Set((cierres ?? []).map((c) => c.id))

  // Cuentas hoja de resultado, inactivas incluidas (patrón mayor).
  const { data: cuentas } = await supabase
    .from('cuentas_contables')
    .select('id, codigo, nombre, tipo')
    .eq('empresa_id', empresaId)
    .eq('acepta_movimientos', true)
    .in('tipo', ['ingreso', 'gasto'])
    .order('codigo')

  const movActual = await movimientosPorCuenta(supabase, empresaId, rangoActual, idsCierre)
  const movAnterior = await movimientosPorCuenta(supabase, empresaId, rangoAnterior, idsCierre)

  const cero = { debe: 0, haber: 0 }
  const ingresos: FilaEERR[] = []
  const gastos: FilaEERR[] = []
  let anteriorConDatos = false
  for (const c of cuentas ?? []) {
    if (movAnterior.has(c.id)) anteriorConDatos = true
    const a = movActual.get(c.id) ?? cero
    const p = movAnterior.get(c.id) ?? cero
    if (a === cero && p === cero) continue
    // Saldo natural: ingresos al haber (acreedor positivo), gastos al debe.
    const monto = (m: { debe: number; haber: number }) =>
      c.tipo === 'ingreso' ? m.haber - m.debe : m.debe - m.haber
    const fila = { codigo: c.codigo, nombre: c.nombre, actual: monto(a), anterior: monto(p) }
    if (c.tipo === 'ingreso') ingresos.push(fila)
    else gastos.push(fila)
  }

  const suma = (fs: FilaEERR[]) => ({
    actual: fs.reduce((s, f) => s + f.actual, 0),
    anterior: fs.reduce((s, f) => s + f.anterior, 0),
  })
  const totalIngresos = suma(ingresos)
  const totalGastos = suma(gastos)
  return {
    periodo,
    anterior,
    ingresos,
    gastos,
    totalIngresos,
    totalGastos,
    resultado: {
      actual: totalIngresos.actual - totalGastos.actual,
      anterior: totalIngresos.anterior - totalGastos.anterior,
    },
    anteriorConDatos,
  }
}
