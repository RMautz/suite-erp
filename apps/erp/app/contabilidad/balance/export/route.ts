import { crearClienteServidor } from '@suite/auth/server'
import { filasACsv } from '@suite/core'
import { obtenerEmpresaActiva } from '../../../../lib/empresa-activa'
import { aniosConAsientos, obtenerBalance, type FilaBalance } from '../calculo'

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
  // Año validado con el MISMO criterio de la página (paridad total): debe estar
  // en aniosConAsientos; si no, el mismo default (año actual si tiene asientos,
  // si no el más reciente).
  const anios = await aniosConAsientos(supabase, activa.id)
  const anioActual = new Date().getFullYear()
  const porDefecto = anios.includes(anioActual) ? anioActual : (anios[0] ?? anioActual)
  const qAnio = url.searchParams.get('anio')
  const anio = qAnio && /^\d{4}$/.test(qAnio) && anios.includes(Number(qAnio)) ? Number(qAnio) : porDefecto

  const { filas, filaResultado, totales } = await obtenerBalance(supabase, activa.id, anio)
  const aFila = (f: FilaBalance): (string | number)[] => [
    f.codigo, f.nombre, f.debitos, f.creditos, f.saldoDeudor, f.saldoAcreedor,
    f.activo, f.pasivo, f.perdida, f.ganancia,
  ]
  const filasCsv = [...filas, ...(filaResultado ? [filaResultado] : []), totales].map(aFila)
  const csv = filasACsv(
    ['Código', 'Cuenta', 'Débitos', 'Créditos', 'Saldo deudor', 'Saldo acreedor', 'Activo', 'Pasivo', 'Pérdida', 'Ganancia'],
    filasCsv
  )
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="balance-8-columnas-${anio}.csv"`,
    },
  })
}
