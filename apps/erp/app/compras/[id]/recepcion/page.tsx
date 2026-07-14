import { notFound, redirect } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { pendienteLinea } from '@suite/core'
import { Encabezado } from '@suite/ui'
import { FormularioRecepcion } from '../../../../componentes/formulario-recepcion'
import { obtenerEmpresaActiva } from '../../../../lib/empresa-activa'
import { registrarRecepcion } from '../../acciones'

export default async function PaginaRecepcion({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const supabase = await crearClienteServidor()
  const [{ data: oc }, { data: bodegas }] = await Promise.all([
    supabase.from('ordenes_compra')
      .select('id, numero, estado, ordenes_compra_lineas (id, descripcion, cantidad_pedida, cantidad_recibida)')
      .eq('id', id).eq('empresa_id', activa.id).single(),
    supabase.from('bodegas').select('id, nombre').eq('empresa_id', activa.id).eq('activo', true).order('nombre'),
  ])
  if (!oc) notFound()
  if (oc.estado !== 'enviada' && oc.estado !== 'recibida_parcial') redirect('/compras/' + id)

  const lineas = (oc.ordenes_compra_lineas ?? [])
    .map((l) => ({ id: l.id, descripcion: l.descripcion, pendiente: pendienteLinea({ cantidadPedida: l.cantidad_pedida, cantidadRecibida: l.cantidad_recibida }) }))
    .filter((l) => l.pendiente > 0)

  return (
    <div>
      <Encabezado titulo={`Recepción — OC N° ${oc.numero}`} />
      <FormularioRecepcion
        accion={registrarRecepcion}
        ordenId={oc.id}
        bodegas={(bodegas ?? []).map((b) => ({ id: b.id, nombre: b.nombre }))}
        lineas={lineas}
      />
    </div>
  )
}
