import { notFound } from 'next/navigation'
import { Encabezado } from '@suite/ui'
import { FormularioTrabajador } from '../../../componentes/formulario-trabajador'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { guardarTrabajador } from '../acciones'

export default async function NuevoTrabajador() {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  // Contador es solo lectura en Personas: sin formulario de creación. UX —
  // RLS igual rechazaría el INSERT (42501) si llegara a enviarlo.
  if (!activa.rol || !['dueno', 'admin'].includes(activa.rol)) notFound()
  return (
    <div>
      <Encabezado titulo="Nuevo trabajador" />
      <FormularioTrabajador accion={guardarTrabajador} />
    </div>
  )
}
