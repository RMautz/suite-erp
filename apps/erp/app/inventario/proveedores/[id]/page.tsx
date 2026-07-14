import { notFound } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearRut } from '@suite/core'
import { Encabezado } from '@suite/ui'
import { FormularioProveedor } from '../../../../componentes/formulario-proveedor'
import { obtenerEmpresaActiva } from '../../../../lib/empresa-activa'
import { guardarProveedor } from '../acciones'

export default async function EditarProveedor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const supabase = await crearClienteServidor()
  const { data: prov } = await supabase.from('proveedores').select('*').eq('id', id).eq('empresa_id', activa.id).single()
  if (!prov) notFound()
  return (
    <div>
      <Encabezado titulo={`Editar: ${prov.razon_social}`} />
      <FormularioProveedor accion={guardarProveedor} inicial={{
        id: prov.id, rut: formatearRut(prov.rut), razon_social: prov.razon_social, giro: prov.giro ?? '',
        email: prov.email ?? '', telefono: prov.telefono ?? '', direccion: prov.direccion ?? '', comuna: prov.comuna ?? '',
        condicion_pago_dias: prov.condicion_pago_dias,
      }} />
    </div>
  )
}
