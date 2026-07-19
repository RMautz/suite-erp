import { crearClienteServidor } from '@suite/auth/server'
import { filasACsv, formatearRut, periodoAnterior, rangoDeMes } from '@suite/core'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { puedeVerRRHH } from '../../../lib/rrhh-acceso'

interface Fila {
  dias_trabajados: number
  total_imponible: number
  afp_monto: number
  salud_monto: number
  cesantia_monto: number
  impuesto_unico: number
  liquido: number
  trabajadores: { rut: string; nombre: string } | null
}

export async function GET(req: Request) {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return new Response('No autorizado', { status: 401 })
  // Guard de rol EXPLÍCITO (lección P12): rol sin permiso → 403, jamás un CSV
  // vacío. Paridad con el notFound() por rol de la página (mismo predicado).
  if (!puedeVerRRHH(activa)) {
    return new Response('No autorizado', { status: 403 })
  }
  // Paridad con la página: ?periodo= inválido cae al mes anterior (fallback
  // silencioso, patrón de los exports de contabilidad).
  const qPeriodo = new URL(req.url).searchParams.get('periodo')
  const periodo =
    qPeriodo && rangoDeMes(qPeriodo) ? qPeriodo : periodoAnterior(new Date().toISOString().slice(0, 7))!

  const supabase = await crearClienteServidor()
  const { data, error } = await supabase
    .from('liquidaciones')
    .select('dias_trabajados, total_imponible, afp_monto, salud_monto, cesantia_monto, impuesto_unico, liquido, trabajadores (rut, nombre)')
    .eq('empresa_id', activa.id)
    .eq('periodo', periodo)
    .neq('estado', 'anulada')
  if (error) return new Response('No se pudo generar el libro', { status: 500 })
  const filas = ((data ?? []) as Fila[]).sort((a, b) =>
    (a.trabajadores?.nombre ?? '').localeCompare(b.trabajadores?.nombre ?? '', 'es')
  )
  const tot = filas.reduce(
    (t, f) => ({
      imponible: t.imponible + f.total_imponible,
      afp: t.afp + f.afp_monto,
      salud: t.salud + f.salud_monto,
      cesantia: t.cesantia + f.cesantia_monto,
      impuesto: t.impuesto + f.impuesto_unico,
      liquido: t.liquido + f.liquido,
    }),
    { imponible: 0, afp: 0, salud: 0, cesantia: 0, impuesto: 0, liquido: 0 }
  )

  const cuerpo: (string | number | null)[][] = filas.map((f) => [
    f.trabajadores ? formatearRut(f.trabajadores.rut) : '',
    f.trabajadores?.nombre ?? '',
    f.dias_trabajados,
    f.total_imponible,
    f.afp_monto,
    f.salud_monto,
    f.cesantia_monto,
    f.impuesto_unico,
    f.liquido,
  ])
  cuerpo.push([
    'Totales del período',
    '',
    '',
    tot.imponible,
    tot.afp,
    tot.salud,
    tot.cesantia,
    tot.impuesto,
    tot.liquido,
  ])
  const csv = filasACsv(
    ['RUT', 'Nombre', 'Días', 'Imponible', 'AFP', 'Salud', 'Cesantía', 'Impuesto único', 'Líquido'],
    cuerpo
  )
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="libro-remuneraciones-${periodo}.csv"`,
    },
  })
}
