import { notFound } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { Encabezado } from '@suite/ui'
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
        }}
      />
    </div>
  )
}
