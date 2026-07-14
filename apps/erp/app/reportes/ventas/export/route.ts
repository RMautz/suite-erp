import { crearClienteServidor } from '@suite/auth/server'
import { filasACsv } from '@suite/core'
import { obtenerEmpresaActiva } from '../../../../lib/empresa-activa'

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/

export async function GET(req: Request) {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return new Response('No autorizado', { status: 401 })
  const url = new URL(req.url)
  const desde = url.searchParams.get('desde') ?? ''
  const hasta = url.searchParams.get('hasta') ?? ''
  if (!FECHA_ISO.test(desde) || !FECHA_ISO.test(hasta) || hasta < desde) {
    return new Response('Rango inválido (use desde/hasta YYYY-MM-DD)', { status: 400 })
  }
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase
    .from('ventas_diarias')
    .select('fecha, documentos, neto, iva, total')
    .eq('empresa_id', activa.id).gte('fecha', desde).lte('fecha', hasta).order('fecha')
  if (error) return new Response('No se pudo generar el reporte', { status: 500 })
  const csv = filasACsv(
    ['Fecha', 'Documentos', 'Neto', 'IVA', 'Total'],
    (data ?? []).map((d) => [d.fecha, d.documentos, d.neto, d.iva, d.total])
  )
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="ventas-${desde}-a-${hasta}.csv"`,
    },
  })
}
