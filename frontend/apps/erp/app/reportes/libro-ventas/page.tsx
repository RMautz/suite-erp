import Link from 'next/link'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP, formatearRut, rangoDeMes } from '@suite/core'
import { Boton, Encabezado, Entrada, Tabla, Td, Th, Tr } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'

const ETIQUETA: Record<string, string> = { factura: 'Factura', boleta: 'Boleta', nota_credito: 'Nota de crédito' }

export default async function PaginaLibroVentas({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const { mes = '' } = await searchParams
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const mesActual = new Date().toISOString().slice(0, 7)
  const mesElegido = rangoDeMes(mes) ? mes : mesActual
  const rango = rangoDeMes(mesElegido)!
  const supabase = await crearClienteServidor()
  const { data } = await supabase
    .from('libro_ventas')
    .select('documento_id, fecha, tipo, folio, rut_cliente, razon_social_cliente, neto, exento, iva, total')
    .eq('empresa_id', activa.id)
    .gte('fecha', rango.desde)
    .lte('fecha', rango.hasta)
    .order('fecha')
    .order('folio')
  const filas = data ?? []
  const tot = filas.reduce(
    (a, f) => ({ neto: a.neto + (f.neto ?? 0), exento: a.exento + (f.exento ?? 0), iva: a.iva + (f.iva ?? 0), total: a.total + (f.total ?? 0) }),
    { neto: 0, exento: 0, iva: 0, total: 0 }
  )
  return (
    <div>
      <Encabezado titulo="Libro de ventas">
        <Link href={`/reportes/libro-ventas/export?mes=${mesElegido}`}><Boton variante="secundario">Exportar CSV</Boton></Link>
      </Encabezado>
      <form className="mb-4 flex items-end gap-3" action="/reportes/libro-ventas" method="get">
        <Entrada type="month" name="mes" defaultValue={mesElegido} className="max-w-xs" />
        <Boton variante="secundario" type="submit">Ver mes</Boton>
      </form>
      <Tabla>
        <thead><tr><Th>Fecha</Th><Th>Tipo</Th><Th>Folio</Th><Th>RUT</Th><Th>Razón social</Th><Th className="text-right">Neto</Th><Th className="text-right">Exento</Th><Th className="text-right">IVA</Th><Th className="text-right">Total</Th></tr></thead>
        <tbody>
          {filas.map((f) => (
            <Tr key={f.documento_id}>
              <Td>{f.fecha ? new Date(f.fecha + 'T00:00:00').toLocaleDateString('es-CL') : '—'}</Td>
              <Td>{ETIQUETA[f.tipo ?? ''] ?? f.tipo}</Td>
              <Td className="font-mono">{f.folio ?? '—'}</Td>
              <Td className="font-mono">{f.rut_cliente ? formatearRut(f.rut_cliente) : '—'}</Td>
              <Td>{f.razon_social_cliente}</Td>
              <Td className="text-right font-mono">{formatearCLP(f.neto ?? 0)}</Td>
              <Td className="text-right font-mono">{formatearCLP(f.exento ?? 0)}</Td>
              <Td className="text-right font-mono">{formatearCLP(f.iva ?? 0)}</Td>
              <Td className="text-right font-mono">{formatearCLP(f.total ?? 0)}</Td>
            </Tr>
          ))}
          {filas.length === 0 && <Tr><Td colSpan={9} className="py-8 text-center text-slate-500">Sin documentos emitidos en {mesElegido}.</Td></Tr>}
        </tbody>
      </Tabla>
      <div className="mt-3 flex justify-end gap-6 text-sm">
        <span>Neto: <strong className="font-mono">{formatearCLP(tot.neto)}</strong></span>
        <span>Exento: <strong className="font-mono">{formatearCLP(tot.exento)}</strong></span>
        <span>IVA: <strong className="font-mono">{formatearCLP(tot.iva)}</strong></span>
        <span>Total: <strong className="font-mono">{formatearCLP(tot.total)}</strong></span>
      </div>
    </div>
  )
}
