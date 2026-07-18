import 'server-only'
import type { crearClienteServidor } from '@suite/auth/server'

type ClienteSupabase = Awaited<ReturnType<typeof crearClienteServidor>>

export interface FilaBalance {
  codigo: string
  nombre: string
  debitos: number
  creditos: number
  saldoDeudor: number
  saldoAcreedor: number
  activo: number
  pasivo: number
  perdida: number
  ganancia: number
}

export interface Balance {
  filas: FilaBalance[]
  // Utilidad (+) o pérdida (−) del ejercicio: Ganancia − Pérdida (= Activo − Pasivo).
  resultado: number
  // Fila "Utilidad (o Pérdida) del ejercicio" que cuadra Inventario y Resultados.
  // null cuando resultado = 0 (no se muestra fila vacía).
  filaResultado: FilaBalance | null
  // Totales por columna, CON la fila de resultado ya sumada.
  totales: FilaBalance
  // Los 4 pares cuadran (Sumas, Saldos, Inventario, Resultados). false → alerta roja.
  cuadra: boolean
}

interface AsientoAnio {
  origen: string
  reversa_de: string | null
  asientos_lineas: { cuenta_id: string; debe: number; haber: number }[]
}

// Años con asientos de la empresa, descendente (selector de ejercicio).
// ponytail: rango [primero..último] en 2 queries de 1 fila (PostgREST no agrega
// distinct); un año intermedio sin asientos aparece y muestra un balance vacío.
export async function aniosConAsientos(supabase: ClienteSupabase, empresaId: string): Promise<number[]> {
  const { data: primero } = await supabase
    .from('asientos')
    .select('fecha')
    .eq('empresa_id', empresaId)
    .order('fecha')
    .limit(1)
  const { data: ultimo } = await supabase
    .from('asientos')
    .select('fecha')
    .eq('empresa_id', empresaId)
    .order('fecha', { ascending: false })
    .limit(1)
  if (!primero?.length || !ultimo?.length) return []
  const desde = Number(primero[0]!.fecha.slice(0, 4))
  const hasta = Number(ultimo[0]!.fecha.slice(0, 4))
  const anios: number[] = []
  for (let a = hasta; a >= desde; a--) anios.push(a)
  return anios
}

function sumar(filas: FilaBalance[], nombre: string): FilaBalance {
  const t: FilaBalance = {
    codigo: '',
    nombre,
    debitos: 0,
    creditos: 0,
    saldoDeudor: 0,
    saldoAcreedor: 0,
    activo: 0,
    pasivo: 0,
    perdida: 0,
    ganancia: 0,
  }
  for (const f of filas) {
    t.debitos += f.debitos
    t.creditos += f.creditos
    t.saldoDeudor += f.saldoDeudor
    t.saldoAcreedor += f.saldoAcreedor
    t.activo += f.activo
    t.pasivo += f.pasivo
    t.perdida += f.perdida
    t.ganancia += f.ganancia
  }
  return t
}

// Balance de 8 columnas del ejercicio (spec §4.1): agregado por cuenta hoja con
// ARRASTRE (saldo acumulado anterior al 1-ene, spec §2.2) + movimientos del
// año, EXCLUYENDO los asientos origen 'cierre' y sus reversas ligadas
// (reversa_de → asiento de cierre) DEL AÑO seleccionado: el balance muestra el
// ejercicio ANTES de su cierre, esté cerrado, reabierto o abierto. Los cierres
// de años ANTERIORES sí entran al arrastre (son el arrastre: resultado en
// utilidad_ejercicio y cuentas de resultado en 0).
export async function obtenerBalance(supabase: ClienteSupabase, empresaId: string, anio: number): Promise<Balance> {
  // Ids de asientos de cierre (pocos: uno vigente + re-cierres por año cerrado).
  const { data: cierres } = await supabase
    .from('asientos')
    .select('id')
    .eq('empresa_id', empresaId)
    .eq('origen', 'cierre')
  const idsCierre = new Set((cierres ?? []).map((c) => c.id))

  // Cuentas hoja, inactivas incluidas: pueden tener movimientos históricos (patrón mayor).
  const { data: cuentas } = await supabase
    .from('cuentas_contables')
    .select('id, codigo, nombre, tipo')
    .eq('empresa_id', empresaId)
    .eq('acepta_movimientos', true)
    .order('codigo')

  // Arrastre: saldo acumulado por cuenta ANTES del ejercicio (patrón saldo
  // inicial del mayor). SIN excluir cierres/reversas de años anteriores.
  // ponytail: mismo techo PostgREST 1000 asientos que la query del año.
  const { data: previos } = await supabase
    .from('asientos')
    .select('asientos_lineas (cuenta_id, debe, haber)')
    .eq('empresa_id', empresaId)
    .lt('fecha', `${anio}-01-01`)
  const inicial = new Map<string, number>()
  for (const a of (previos ?? []) as { asientos_lineas: { cuenta_id: string; debe: number; haber: number }[] }[]) {
    for (const l of a.asientos_lineas) {
      inicial.set(l.cuenta_id, (inicial.get(l.cuenta_id) ?? 0) + l.debe - l.haber)
    }
  }

  // Movimientos del ejercicio. ponytail: sin paginación (cap PostgREST 1000
  // asientos, el mismo techo que ya acepta el diario); .range() si una empresa lo supera.
  const { data } = await supabase
    .from('asientos')
    .select('origen, reversa_de, asientos_lineas (cuenta_id, debe, haber)')
    .eq('empresa_id', empresaId)
    .gte('fecha', `${anio}-01-01`)
    .lte('fecha', `${anio}-12-31`)

  const porCuenta = new Map<string, { debe: number; haber: number }>()
  for (const a of (data ?? []) as AsientoAnio[]) {
    if (a.origen === 'cierre') continue
    if (a.reversa_de && idsCierre.has(a.reversa_de)) continue
    for (const l of a.asientos_lineas) {
      const acc = porCuenta.get(l.cuenta_id) ?? { debe: 0, haber: 0 }
      acc.debe += l.debe
      acc.haber += l.haber
      porCuenta.set(l.cuenta_id, acc)
    }
  }

  const filas: FilaBalance[] = []
  for (const c of cuentas ?? []) {
    const mov = porCuenta.get(c.id)
    const ini = inicial.get(c.id) ?? 0
    if (!mov && ini === 0) continue
    // Saldo inicial deudor a Débitos, acreedor a Créditos: Σ iniciales = 0
    // (partida doble), así los 4 pares siguen cuadrando con el arrastre adentro.
    const debitos = (mov?.debe ?? 0) + Math.max(ini, 0)
    const creditos = (mov?.haber ?? 0) + Math.max(-ini, 0)
    const saldo = debitos - creditos
    const saldoDeudor = Math.max(saldo, 0)
    const saldoAcreedor = Math.max(-saldo, 0)
    // Inventario: activo/pasivo/patrimonio según el lado del saldo.
    // Resultados: ingreso/gasto según el lado del saldo (spec §4.1).
    const esResultado = c.tipo === 'ingreso' || c.tipo === 'gasto'
    filas.push({
      codigo: c.codigo,
      nombre: c.nombre,
      debitos,
      creditos,
      saldoDeudor,
      saldoAcreedor,
      activo: esResultado ? 0 : saldoDeudor,
      pasivo: esResultado ? 0 : saldoAcreedor,
      perdida: esResultado ? saldoDeudor : 0,
      ganancia: esResultado ? saldoAcreedor : 0,
    })
  }

  const parciales = sumar(filas, '')
  const resultado = parciales.ganancia - parciales.perdida
  let filaResultado: FilaBalance | null = null
  if (resultado > 0) {
    filaResultado = {
      codigo: '',
      nombre: 'Utilidad del ejercicio',
      debitos: 0,
      creditos: 0,
      saldoDeudor: 0,
      saldoAcreedor: 0,
      activo: 0,
      pasivo: resultado,
      perdida: resultado,
      ganancia: 0,
    }
  } else if (resultado < 0) {
    filaResultado = {
      codigo: '',
      nombre: 'Pérdida del ejercicio',
      debitos: 0,
      creditos: 0,
      saldoDeudor: 0,
      saldoAcreedor: 0,
      activo: -resultado,
      pasivo: 0,
      perdida: 0,
      ganancia: -resultado,
    }
  }
  const totales = sumar(filaResultado ? [...filas, filaResultado] : filas, 'Totales')
  const cuadra =
    totales.debitos === totales.creditos &&
    totales.saldoDeudor === totales.saldoAcreedor &&
    totales.activo === totales.pasivo &&
    totales.perdida === totales.ganancia

  return { filas, resultado, filaResultado, totales, cuadra }
}
