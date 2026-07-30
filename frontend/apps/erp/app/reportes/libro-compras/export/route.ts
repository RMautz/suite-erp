import { crearClienteServidor } from '@suite/auth/server'
import { filasACsv, rangoDeMes } from '@suite/core'
import { obtenerEmpresaActiva } from '../../../../lib/empresa-activa'

export async function GET(req: Request) {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return new Response('No autorizado', { status: 401 })
  const mes = new URL(req.url).searchParams.get('mes') ?? new Date().toISOString().slice(0, 7)
  const rango = rangoDeMes(mes)
  if (!rango) return new Response('Mes inválido (use YYYY-MM)', { status: 400 })
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase
    .from('libro_compras')
    .select('fecha, tipo, folio, rut_proveedor, razon_social_proveedor, neto, exento, iva, total')
    .eq('empresa_id', activa.id)
    .gte('fecha', rango.desde)
    .lte('fecha', rango.hasta)
    .order('fecha')
    .order('folio')
  if (error) return new Response('No se pudo generar el libro', { status: 500 })
  const csv = filasACsv(
    ['Fecha', 'Tipo', 'Folio', 'RUT proveedor', 'Razón social', 'Neto', 'Exento', 'IVA crédito', 'Total'],
    (data ?? []).map((f) => [f.fecha, f.tipo, f.folio, f.rut_proveedor, f.razon_social_proveedor, f.neto, f.exento, f.iva, f.total])
  )
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="libro-compras-${mes}.csv"`,
    },
  })
}
