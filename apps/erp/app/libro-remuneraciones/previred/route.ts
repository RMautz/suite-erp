import { crearClienteServidor } from '@suite/auth/server'
import { generarPrevired, periodoAnterior, rangoDeMes, type FilaPrevired } from '@suite/core'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { puedeVerRRHH } from '../../../lib/rrhh-acceso'

interface Fila {
  dias_trabajados: number
  afp: string
  total_imponible: number
  afp_monto: number
  sis_monto: number
  cesantia_monto: number
  cesantia_empleador_monto: number
  salud: string
  salud_monto: number
  mutual_monto: number
  trabajadores: { rut: string; nombre: string } | null
}

export async function GET(req: Request) {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return new Response('No autorizado', { status: 401 })
  // Guard de rol EXPLÍCITO (lección P12): rol sin permiso → 403, jamás un TXT
  // vacío. Paridad byte a byte con el export CSV (mismo predicado).
  if (!puedeVerRRHH(activa)) {
    return new Response('No autorizado', { status: 403 })
  }
  // Paridad con la página y el CSV: ?periodo= inválido cae al mes anterior
  // (fallback silencioso, patrón de los exports de contabilidad).
  const qPeriodo = new URL(req.url).searchParams.get('periodo')
  const periodo =
    qPeriodo && rangoDeMes(qPeriodo) ? qPeriodo : periodoAnterior(new Date().toISOString().slice(0, 7))!

  const supabase = await crearClienteServidor()
  // MISMA base que el libro y el CSV (empresa + período, sin anuladas): solo
  // cambian las columnas — las del snapshot que consume FilaPrevired (Task 3).
  const { data, error } = await supabase
    .from('liquidaciones')
    .select('dias_trabajados, afp, total_imponible, afp_monto, sis_monto, cesantia_monto, cesantia_empleador_monto, salud, salud_monto, mutual_monto, trabajadores (rut, nombre)')
    .eq('empresa_id', activa.id)
    .eq('periodo', periodo)
    .neq('estado', 'anulada')
  if (error) return new Response('No se pudo generar el archivo Previred', { status: 500 })
  const filas: FilaPrevired[] = ((data ?? []) as Fila[])
    .sort((a, b) => (a.trabajadores?.nombre ?? '').localeCompare(b.trabajadores?.nombre ?? '', 'es'))
    .map((f) => ({
      rut: f.trabajadores?.rut ?? '',
      nombre: f.trabajadores?.nombre ?? '',
      // 'AAAA-MM' para los campos 9/10 del TXT (MMAAAA): todas las filas son
      // del período consultado (.eq de la query) — se puebla desde la variable.
      periodo,
      dias_trabajados: f.dias_trabajados,
      afp: f.afp,
      total_imponible: f.total_imponible,
      afp_monto: f.afp_monto,
      sis_monto: f.sis_monto,
      cesantia_monto: f.cesantia_monto,
      cesantia_empleador_monto: f.cesantia_empleador_monto,
      salud: f.salud,
      salud_monto: f.salud_monto,
      mutual_monto: f.mutual_monto,
    }))

  // generarPrevired ya emite CRLF SIN BOM (spec §5): el string va tal cual —
  // jamás pasar por filasACsv (ese helper antepone BOM para Excel).
  return new Response(generarPrevired(filas), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="previred-${periodo}.txt"`,
    },
  })
}
