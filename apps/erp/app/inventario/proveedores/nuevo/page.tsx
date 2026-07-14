import { Encabezado } from '@suite/ui'
import { FormularioProveedor } from '../../../../componentes/formulario-proveedor'
import { obtenerEmpresaActiva } from '../../../../lib/empresa-activa'
import { guardarProveedor } from '../acciones'

export default async function NuevoProveedor() {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  return (
    <div>
      <Encabezado titulo="Nuevo proveedor" />
      <FormularioProveedor accion={guardarProveedor} />
    </div>
  )
}
