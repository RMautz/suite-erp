import { notFound } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCantidad } from '@suite/core'
import { Encabezado, Tarjeta } from '@suite/ui'
import { FormularioProducto } from '../../../componentes/formulario-producto'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { guardarProducto } from '../acciones'

export default async function EditarProducto({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const supabase = await crearClienteServidor()
  const [{ data: producto }, { data: categorias }] = await Promise.all([
    supabase.from('productos').select('*').eq('id', id).eq('empresa_id', activa.id).single(),
    supabase.from('categorias_producto').select('id, nombre').eq('empresa_id', activa.id).order('nombre'),
  ])
  if (!producto) notFound()

  const { data: stockBodegas } = await supabase
    .from('stock_actual')
    .select('cantidad, bodegas (nombre)')
    .eq('empresa_id', activa.id)
    .eq('producto_id', id)

  return (
    <div>
      <Encabezado titulo={`Editar: ${producto.nombre}`} />
      <FormularioProducto
        accion={guardarProducto}
        categorias={categorias ?? []}
        inicial={{
          id: producto.id,
          sku: producto.sku,
          nombre: producto.nombre,
          descripcion: producto.descripcion ?? '',
          codigo_barras: producto.codigo_barras ?? '',
          unidad: producto.unidad,
          precio_neto: producto.precio_neto,
          exento: producto.exento,
          categoria_id: producto.categoria_id ?? '',
          stock_minimo: producto.stock_minimo,
        }}
      />
      <div className="mt-6 max-w-2xl">
        <h2 className="mb-2 text-lg font-semibold text-slate-800">Stock por bodega</h2>
        <Tarjeta>
          <ul className="space-y-1 text-sm">
            {(stockBodegas ?? []).map((s, i) => (
              <li key={i} className="flex justify-between">
                <span>{s.bodegas?.nombre ?? '—'}</span>
                <span className="font-mono">{formatearCantidad(s.cantidad ?? 0)}</span>
              </li>
            ))}
            {(stockBodegas ?? []).length === 0 && <li className="text-slate-500">Sin movimientos de stock.</li>}
          </ul>
        </Tarjeta>
      </div>
    </div>
  )
}
