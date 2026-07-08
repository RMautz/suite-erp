import { Encabezado } from '@suite/ui'
import { FormularioCliente } from '../../../componentes/formulario-cliente'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { guardarCliente } from '../acciones'

export default async function NuevoCliente() {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  return (
    <div>
      <Encabezado titulo="Nuevo cliente" />
      <FormularioCliente accion={guardarCliente} />
    </div>
  )
}
