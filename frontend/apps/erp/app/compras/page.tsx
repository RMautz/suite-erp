import Link from 'next/link'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP, totalOrden } from '@suite/core'
import { Boton, Encabezado, Entrada, Insignia, Selector, Tabla, Td, Th, Tr } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import { ESTADOS_OC, ETIQUETA_ESTADO, TONO_ESTADO } from './estados'

export default async function PaginaCompras({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string; q?: string }>
}) {
  const { estado = '', q = '' } = await searchParams
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const supabase = await crearClienteServidor()
  let consulta = supabase
    .from('ordenes_compra')
    .select('id, numero, estado, creado_en, proveedores (razon_social), ordenes_compra_lineas (cantidad_pedida, costo_unitario)')
    .eq('empresa_id', activa.id)
    .order('numero', { ascending: false })
    .limit(100)
  if ((ESTADOS_OC as readonly string[]).includes(estado)) consulta = consulta.eq('estado', estado)
  const { data } = await consulta
  const qLimpia = q.trim().toLowerCase()
  const ordenes = (data ?? []).filter((o) => !qLimpia || (o.proveedores?.razon_social ?? '').toLowerCase().includes(qLimpia))
  return (
    <div>
      <Encabezado titulo="Órdenes de compra">
        <Link href="/compras/nueva"><Boton>Nueva orden</Boton></Link>
      </Encabezado>
      <form className="mb-4 flex flex-wrap items-end gap-3" action="/compras" method="get">
        <Selector name="estado" defaultValue={estado} className="max-w-xs">
          <option value="">Todos los estados</option>
          {ESTADOS_OC.map((e) => <option key={e} value={e}>{ETIQUETA_ESTADO[e]}</option>)}
        </Selector>
        <Entrada name="q" defaultValue={q} placeholder="Buscar por proveedor…" className="max-w-xs" />
        <Boton variante="secundario" type="submit">Filtrar</Boton>
        <Link className="text-sm text-marca-700 hover:underline" href="/compras">Limpiar</Link>
      </form>
      <Tabla>
        <thead><tr><Th>N°</Th><Th>Proveedor</Th><Th>Fecha</Th><Th>Estado</Th><Th className="text-right">Total</Th></tr></thead>
        <tbody>
          {ordenes.map((o) => (
            <Tr key={o.id}>
              <Td><Link className="text-marca-700 hover:underline" href={`/compras/${o.id}`}>OC {o.numero}</Link></Td>
              <Td>{o.proveedores?.razon_social ?? '—'}</Td>
              <Td>{new Date(o.creado_en).toLocaleDateString('es-CL')}</Td>
              <Td><Insignia tono={TONO_ESTADO[o.estado] ?? 'gris'}>{ETIQUETA_ESTADO[o.estado] ?? o.estado}</Insignia></Td>
              <Td className="text-right font-mono">
                {formatearCLP(totalOrden((o.ordenes_compra_lineas ?? []).map((l) => ({ cantidad: l.cantidad_pedida, costoUnitario: l.costo_unitario }))))}
              </Td>
            </Tr>
          ))}
          {ordenes.length === 0 && <Tr><Td colSpan={5} className="py-8 text-center text-slate-500">No hay órdenes {estado || q ? 'que coincidan' : 'todavía'}.</Td></Tr>}
        </tbody>
      </Tabla>
    </div>
  )
}
