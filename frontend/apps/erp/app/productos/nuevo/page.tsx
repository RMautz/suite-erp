import { crearClienteServidor } from '@suite/auth/server'
import { Encabezado } from '@suite/ui'
import { FormularioProducto } from '../../../componentes/formulario-producto'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { guardarProducto } from '../acciones'

export default async function NuevoProducto() {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const supabase = await crearClienteServidor()
  const { data: categorias } = await supabase
    .from('categorias_producto')
    .select('id, nombre')
    .eq('empresa_id', activa.id)
    .order('nombre')
  return (
    <div>
      <Encabezado titulo="Nuevo producto" />
      <FormularioProducto accion={guardarProducto} categorias={categorias ?? []} />
    </div>
  )
}
