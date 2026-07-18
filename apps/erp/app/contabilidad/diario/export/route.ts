import { crearClienteServidor } from '@suite/auth/server'
import { filasACsv, rangoDeMes } from '@suite/core'
import { obtenerEmpresaActiva } from '../../../../lib/empresa-activa'
import { ETIQUETA_ORIGEN } from '../../origenes'

interface Linea {
  debe: number
  haber: number
  glosa: string | null
  cuentas_contables: { codigo: string; nombre: string } | null
}
interface Asiento {
  numero: number
  fecha: string
  glosa: string
  origen: string
  asientos_lineas: Linea[]
}

export async function GET(req: Request) {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return new Response('No autorizado', { status: 401 })
  // Paridad con la página: módulo apagado → 404 (misma condición que su notFound()).
  if (!activa.modulo_contabilidad) return new Response('No encontrado', { status: 404 })
  // Guard de rol EXPLÍCITO (lección P12): rol sin permiso → 403, jamás un CSV vacío.
  // El rol YA viene en EmpresaResumen (task de UI) — se reusa sin re-consultar miembros.
  if (!activa.rol || !['dueno', 'admin', 'contador'].includes(activa.rol)) {
    return new Response('No autorizado', { status: 403 })
  }

  const supabase = await crearClienteServidor()
  const url = new URL(req.url)
  const base = rangoDeMes(new Date().toISOString().slice(0, 7))!
  const qDesde = url.searchParams.get('desde')
  const qHasta = url.searchParams.get('hasta')
  const desde = qDesde && /^\d{4}-\d{2}-\d{2}$/.test(qDesde) ? qDesde : base.desde
  const hasta = qHasta && /^\d{4}-\d{2}-\d{2}$/.test(qHasta) ? qHasta : base.hasta

  const { data, error } = await supabase
    .from('asientos')
    .select('numero, fecha, glosa, origen, asientos_lineas (debe, haber, glosa, cuentas_contables (codigo, nombre))')
    .eq('empresa_id', activa.id)
    .gte('fecha', desde)
    .lte('fecha', hasta)
    .order('fecha')
    .order('numero')
  if (error) return new Response('No se pudo generar el libro', { status: 500 })
  const asientos = (data ?? []) as Asiento[]
  const filas: (string | number | null)[][] = []
  for (const a of asientos) {
    const lineas = [...a.asientos_lineas].sort((x, y) => (x.debe > 0 ? 0 : 1) - (y.debe > 0 ? 0 : 1))
    for (const l of lineas) {
      filas.push([
        a.fecha,
        a.numero,
        ETIQUETA_ORIGEN[a.origen] ?? a.origen,
        l.cuentas_contables?.codigo ?? '',
        l.cuentas_contables?.nombre ?? '',
        l.glosa ?? a.glosa,
        l.debe,
        l.haber,
      ])
    }
  }
  const csv = filasACsv(['Fecha', 'N° asiento', 'Origen', 'Código', 'Cuenta', 'Glosa', 'Debe', 'Haber'], filas)
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="libro-diario-${desde}_${hasta}.csv"`,
    },
  })
}
