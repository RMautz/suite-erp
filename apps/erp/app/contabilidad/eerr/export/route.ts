import { crearClienteServidor } from '@suite/auth/server'
import { filasACsv, rangoDePeriodo, variacion } from '@suite/core'
import { obtenerEmpresaActiva } from '../../../../lib/empresa-activa'
import { aniosConAsientos } from '../../balance/calculo'
import { etiquetaPeriodo, obtenerEERR, type FilaEERR } from '../calculo'

export async function GET(req: Request) {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return new Response('No autorizado', { status: 401 })
  // Paridad con la página: módulo apagado → 404 (misma condición que su notFound()).
  if (!activa.modulo_contabilidad) return new Response('No encontrado', { status: 404 })
  // Guard de rol EXPLÍCITO (lección P12): rol sin permiso → 403, jamás un CSV vacío.
  if (!activa.rol || !['dueno', 'admin', 'contador'].includes(activa.rol)) {
    return new Response('No autorizado', { status: 403 })
  }

  const supabase = await crearClienteServidor()
  const url = new URL(req.url)
  // Período validado con el MISMO criterio de la página (paridad total): formato
  // canónico válido Y año dentro de aniosConAsientos; si no, el mismo default de
  // la página (mes actual del año por defecto).
  const anios = await aniosConAsientos(supabase, activa.id)
  const hoy = new Date()
  const porDefecto = anios.includes(hoy.getFullYear()) ? hoy.getFullYear() : (anios[0] ?? hoy.getFullYear())
  const qPeriodo = url.searchParams.get('periodo') ?? ''
  const periodo =
    rangoDePeriodo(qPeriodo) && anios.includes(Number(qPeriodo.slice(0, 4)))
      ? qPeriodo
      : `${porDefecto}-${String(hoy.getMonth() + 1).padStart(2, '0')}`
  // El período ya quedó con formato válido: obtenerEERR nunca retorna null aquí.
  const eerr = (await obtenerEERR(supabase, activa.id, periodo))!

  const colAnterior = (v: number) => (eerr.anteriorConDatos ? v : '—')
  const colVariacion = (actual: number, anterior: number) =>
    eerr.anteriorConDatos ? variacion(actual, anterior) : '—'
  const fila = (seccion: string, f: FilaEERR): (string | number)[] => [
    seccion, f.codigo, f.nombre, f.actual, colAnterior(f.anterior), colVariacion(f.actual, f.anterior),
  ]
  const filas: (string | number | null)[][] = []
  for (const f of eerr.ingresos) filas.push(fila('Ingresos', f))
  filas.push(['Ingresos', '', 'Total ingresos', eerr.totalIngresos.actual, colAnterior(eerr.totalIngresos.anterior), colVariacion(eerr.totalIngresos.actual, eerr.totalIngresos.anterior)])
  for (const f of eerr.gastos) filas.push(fila('Gastos', f))
  filas.push(['Gastos', '', 'Total gastos', eerr.totalGastos.actual, colAnterior(eerr.totalGastos.anterior), colVariacion(eerr.totalGastos.actual, eerr.totalGastos.anterior)])
  filas.push(['', '', 'Resultado del período', eerr.resultado.actual, colAnterior(eerr.resultado.anterior), colVariacion(eerr.resultado.actual, eerr.resultado.anterior)])

  const csv = filasACsv(
    ['Sección', 'Código', 'Cuenta', etiquetaPeriodo(eerr.periodo), etiquetaPeriodo(eerr.anterior), 'Variación'],
    filas
  )
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="eerr-${eerr.periodo}.csv"`,
    },
  })
}
