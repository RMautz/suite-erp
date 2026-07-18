import Link from 'next/link'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP } from '@suite/core'
import { Boton, Campo, Encabezado, Entrada, Insignia, Selector, Tabla, Td, Th, Tr } from '@suite/ui'
import { exigirContabilidad } from '../../../lib/contabilidad-acceso'
import { ETIQUETA_ORIGEN } from '../origenes'

const ORIGENES = ['manual', 'venta', 'nota_credito', 'compra', 'pago', 'pago_proveedor', 'anticipo', 'reversa']

export default async function PaginaAsientos({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string; origen?: string }>
}) {
  const { desde = '', hasta = '', origen = '' } = await searchParams
  const activa = await exigirContabilidad()
  const supabase = await crearClienteServidor()
  let q = supabase
    .from('asientos')
    .select('id, numero, fecha, glosa, origen, asientos_lineas (debe)')
    .eq('empresa_id', activa.id)
    .order('numero', { ascending: false })
    .limit(200)
  if (desde) q = q.gte('fecha', desde)
  if (hasta) q = q.lte('fecha', hasta)
  if (origen) q = q.eq('origen', origen)
  const { data: asientos } = await q

  return (
    <div>
      <Encabezado titulo="Asientos">
        <Link href="/contabilidad/asientos/nuevo"><Boton>Nuevo asiento</Boton></Link>
      </Encabezado>

      <form className="mb-4 flex flex-wrap items-end gap-3" action="/contabilidad/asientos" method="get">
        <Campo etiqueta="Desde"><Entrada type="date" name="desde" defaultValue={desde} /></Campo>
        <Campo etiqueta="Hasta"><Entrada type="date" name="hasta" defaultValue={hasta} /></Campo>
        <Campo etiqueta="Origen">
          <Selector name="origen" defaultValue={origen}>
            <option value="">Todos</option>
            {ORIGENES.map((o) => <option key={o} value={o}>{ETIQUETA_ORIGEN[o]}</option>)}
          </Selector>
        </Campo>
        <Boton variante="secundario" type="submit">Filtrar</Boton>
        <Link className="text-sm text-marca-700 hover:underline" href="/contabilidad/asientos">Limpiar</Link>
      </form>

      <Tabla>
        <thead><tr><Th>N°</Th><Th>Fecha</Th><Th>Glosa</Th><Th>Origen</Th><Th className="text-right">Monto</Th></tr></thead>
        <tbody>
          {(asientos ?? []).map((a) => {
            const monto = (a.asientos_lineas ?? []).reduce((s: number, l: { debe: number }) => s + l.debe, 0)
            return (
              <Tr key={a.id}>
                <Td><Link className="text-marca-700 hover:underline" href={`/contabilidad/asientos/${a.id}`}>{a.numero}</Link></Td>
                <Td>{new Date(a.fecha + 'T00:00:00').toLocaleDateString('es-CL')}</Td>
                <Td>{a.glosa}</Td>
                <Td><Insignia tono="gris">{ETIQUETA_ORIGEN[a.origen] ?? a.origen}</Insignia></Td>
                <Td className="text-right font-mono">{formatearCLP(monto)}</Td>
              </Tr>
            )
          })}
          {(asientos ?? []).length === 0 && (
            <Tr><Td colSpan={5} className="py-8 text-center text-slate-500">No hay asientos que coincidan.</Td></Tr>
          )}
        </tbody>
      </Tabla>
    </div>
  )
}
