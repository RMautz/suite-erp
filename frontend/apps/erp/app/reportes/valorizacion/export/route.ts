import { crearClienteServidor } from '@suite/auth/server'
import { filasACsv } from '@suite/core'
import { obtenerEmpresaActiva } from '../../../../lib/empresa-activa'

export async function GET() {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return new Response('No autorizado', { status: 401 })
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase
    .from('valorizacion_inventario')
    .select('sku, nombre, stock, costo_unitario, valor')
    .eq('empresa_id', activa.id)
    .order('nombre')
  if (error) return new Response('No se pudo generar el reporte', { status: 500 })
  const hoy = new Date().toISOString().slice(0, 10)
  const csv = filasACsv(
    ['SKU', 'Producto', 'Stock', 'Costo unitario', 'Valor'],
    (data ?? []).map((f) => [f.sku, f.nombre, f.stock, f.costo_unitario, f.valor])
  )
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="valorizacion-${hoy}.csv"`,
    },
  })
}
