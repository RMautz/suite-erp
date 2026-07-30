import { Encabezado } from '@suite/ui'
import { FormularioImportar } from '../../componentes/formulario-importar'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import { importarClientes, importarProductos } from './acciones'

export default async function PaginaImportar() {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  return (
    <div>
      <Encabezado titulo="Importar datos" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <FormularioImportar
          titulo="Productos"
          descripcion="Carga o actualiza tu catálogo completo. Las filas con el mismo SKU actualizan el producto existente."
          plantillaHref="/plantillas/productos.csv"
          accion={importarProductos}
        />
        <FormularioImportar
          titulo="Clientes"
          descripcion="Carga o actualiza tu cartera. Las filas con el mismo RUT actualizan el cliente existente."
          plantillaHref="/plantillas/clientes.csv"
          accion={importarClientes}
        />
      </div>
    </div>
  )
}
