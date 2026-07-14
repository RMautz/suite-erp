import { notFound } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { Encabezado } from '@suite/ui'
import { FormularioBodega } from '../../../../componentes/formulario-bodega'
import { obtenerEmpresaActiva } from '../../../../lib/empresa-activa'
import { guardarBodega } from '../acciones'

export default async function EditarBodega({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const supabase = await crearClienteServidor()
  const { data: bodega } = await supabase.from('bodegas').select('*').eq('id', id).eq('empresa_id', activa.id).single()
  if (!bodega) notFound()
  return (
    <div>
      <Encabezado titulo={`Editar: ${bodega.nombre}`} />
      <FormularioBodega accion={guardarBodega} inicial={{ id: bodega.id, nombre: bodega.nombre, direccion: bodega.direccion ?? '' }} />
    </div>
  )
}
