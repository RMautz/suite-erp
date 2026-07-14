import Link from 'next/link'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP, rangoDeMes } from '@suite/core'
import { Boton, Encabezado, Entrada, Tabla, Tarjeta, Td, Th, Tr } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/

export default async function PaginaVentasPeriodo({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string }>
}) {
  const params = await searchParams
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const mesActual = rangoDeMes(new Date().toISOString().slice(0, 7))!
  const desde = FECHA_ISO.test(params.desde ?? '') ? params.desde! : mesActual.desde
  const hastaRaw = FECHA_ISO.test(params.hasta ?? '') ? params.hasta! : mesActual.hasta
  const hasta = hastaRaw >= desde ? hastaRaw : desde
  const supabase = await crearClienteServidor()

  const [{ data: dias }, { data: docs }] = await Promise.all([
    supabase.from('ventas_diarias')
      .select('fecha, documentos, neto, iva, total')
      .eq('empresa_id', activa.id).gte('fecha', desde).lte('fecha', hasta).order('fecha'),
    supabase.from('documentos_venta')
      .select('id')
      .eq('empresa_id', activa.id).eq('estado', 'emitido').in('tipo', ['factura', 'boleta'])
      .gte('emitido_en', desde).lte('emitido_en', hasta + 'T23:59:59.999').limit(1000),
  ])

  // Top 10 productos del rango (solo ventas: NC excluidas por el filtro de tipo de arriba).
  const ids = (docs ?? []).map((d) => d.id)
  const { data: lineas } = ids.length
    ? await supabase.from('documentos_venta_lineas')
        .select('producto_id, descripcion, cantidad, subtotal')
        .eq('empresa_id', activa.id).in('documento_id', ids)
    : { data: [] as { producto_id: string | null; descripcion: string; cantidad: number; subtotal: number }[] }
  const porProducto = new Map<string, { descripcion: string; cantidad: number; subtotal: number }>()
  for (const l of lineas ?? []) {
    const key = l.producto_id ?? l.descripcion
    const acc = porProducto.get(key) ?? { descripcion: l.descripcion, cantidad: 0, subtotal: 0 }
    acc.cantidad += l.cantidad
    acc.subtotal += l.subtotal
    porProducto.set(key, acc)
  }
  const top = [...porProducto.values()].sort((a, b) => b.subtotal - a.subtotal).slice(0, 10)
  const tot = (dias ?? []).reduce(
    (a, d) => ({ documentos: a.documentos + (d.documentos ?? 0), neto: a.neto + (d.neto ?? 0), iva: a.iva + (d.iva ?? 0), total: a.total + (d.total ?? 0) }),
    { documentos: 0, neto: 0, iva: 0, total: 0 }
  )
  return (
    <div>
      <Encabezado titulo="Ventas por período">
        <Link href={`/reportes/ventas/export?desde=${desde}&hasta=${hasta}`}><Boton variante="secundario">Exportar CSV</Boton></Link>
      </Encabezado>
      <form className="mb-4 flex items-end gap-3" action="/reportes/ventas" method="get">
        <Entrada type="date" name="desde" defaultValue={desde} className="max-w-xs" />
        <Entrada type="date" name="hasta" defaultValue={hasta} className="max-w-xs" />
        <Boton variante="secundario" type="submit">Ver rango</Boton>
      </form>
      <Tabla>
        <thead><tr><Th>Fecha</Th><Th className="text-right">Documentos</Th><Th className="text-right">Neto</Th><Th className="text-right">IVA</Th><Th className="text-right">Total</Th></tr></thead>
        <tbody>
          {(dias ?? []).map((d) => (
            <Tr key={d.fecha}>
              <Td>{d.fecha ? new Date(d.fecha + 'T00:00:00').toLocaleDateString('es-CL') : '—'}</Td>
              <Td className="text-right font-mono">{d.documentos}</Td>
              <Td className="text-right font-mono">{formatearCLP(d.neto ?? 0)}</Td>
              <Td className="text-right font-mono">{formatearCLP(d.iva ?? 0)}</Td>
              <Td className="text-right font-mono">{formatearCLP(d.total ?? 0)}</Td>
            </Tr>
          ))}
          {(dias ?? []).length === 0 && <Tr><Td colSpan={5} className="py-8 text-center text-slate-500">Sin ventas en el rango.</Td></Tr>}
        </tbody>
      </Tabla>
      <div className="mt-3 text-right text-sm">
        {tot.documentos} documentos · Neto <strong className="font-mono">{formatearCLP(tot.neto)}</strong> · IVA <strong className="font-mono">{formatearCLP(tot.iva)}</strong> · Total <strong className="font-mono">{formatearCLP(tot.total)}</strong>
      </div>

      <div className="mt-6 max-w-2xl">
        <h2 className="mb-2 text-lg font-semibold text-slate-800">Top 10 productos del rango</h2>
        <Tarjeta>
          <ul className="space-y-1 text-sm">
            {top.map((p, i) => (
              <li key={i} className="flex justify-between">
                <span>{i + 1}. {p.descripcion} <span className="text-slate-400">× {p.cantidad}</span></span>
                <span className="font-mono">{formatearCLP(p.subtotal)}</span>
              </li>
            ))}
            {top.length === 0 && <li className="text-slate-500">Sin líneas de venta en el rango.</li>}
          </ul>
        </Tarjeta>
      </div>
    </div>
  )
}
