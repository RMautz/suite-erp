import Link from 'next/link'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP } from '@suite/core'
import { Boton, Encabezado, Tabla, Td, Th, Tr } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'

export default async function PaginaValorizacion() {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const supabase = await crearClienteServidor()
  const { data } = await supabase
    .from('valorizacion_inventario')
    .select('producto_id, sku, nombre, stock, costo_unitario, valor')
    .eq('empresa_id', activa.id)
    .order('nombre')
  const filas = data ?? []
  const totalValor = filas.reduce((s, f) => s + (f.valor ?? 0), 0)
  return (
    <div>
      <Encabezado titulo="Valorización de inventario">
        <Link href="/reportes/valorizacion/export"><Boton variante="secundario">Exportar CSV</Boton></Link>
      </Encabezado>
      <Tabla>
        <thead><tr><Th>SKU</Th><Th>Producto</Th><Th className="text-right">Stock</Th><Th className="text-right">Costo unitario</Th><Th className="text-right">Valor</Th></tr></thead>
        <tbody>
          {filas.map((f) => (
            <Tr key={f.producto_id}>
              <Td className="font-mono">{f.sku}</Td>
              <Td>{f.nombre}</Td>
              <Td className="text-right font-mono">{f.stock}</Td>
              <Td className="text-right font-mono">{f.costo_unitario === null ? <span className="text-slate-400">sin costo</span> : formatearCLP(f.costo_unitario)}</Td>
              <Td className="text-right font-mono">{f.valor === null ? '—' : formatearCLP(f.valor)}</Td>
            </Tr>
          ))}
          {filas.length === 0 && <Tr><Td colSpan={5} className="py-8 text-center text-slate-500">No hay productos activos.</Td></Tr>}
        </tbody>
      </Tabla>
      <div className="mt-3 text-right text-sm">Valor total del inventario: <strong className="font-mono">{formatearCLP(totalValor)}</strong> <span className="text-slate-400">(productos sin costo no suman)</span></div>
    </div>
  )
}
