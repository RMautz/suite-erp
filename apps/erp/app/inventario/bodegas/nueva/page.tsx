import { Encabezado } from '@suite/ui'
import { FormularioBodega } from '../../../../componentes/formulario-bodega'
import { obtenerEmpresaActiva } from '../../../../lib/empresa-activa'
import { guardarBodega } from '../acciones'

export default async function NuevaBodega() {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  return (
    <div>
      <Encabezado titulo="Nueva bodega" />
      <FormularioBodega accion={guardarBodega} />
    </div>
  )
}
