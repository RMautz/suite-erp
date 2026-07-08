import { notFound } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearRut } from '@suite/core'
import { Encabezado } from '@suite/ui'
import { FormularioCliente } from '../../../componentes/formulario-cliente'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { guardarCliente } from '../acciones'

export default async function EditarCliente({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const supabase = await crearClienteServidor()
  const { data: cliente } = await supabase
    .from('clientes')
    .select('*')
    .eq('id', id)
    .eq('empresa_id', activa.id)
    .single()
  if (!cliente) notFound()
  return (
    <div>
      <Encabezado titulo={`Editar: ${cliente.razon_social}`} />
      <FormularioCliente
        accion={guardarCliente}
        inicial={{
          id: cliente.id,
          rut: formatearRut(cliente.rut),
          razon_social: cliente.razon_social,
          giro: cliente.giro ?? '',
          email: cliente.email ?? '',
          telefono: cliente.telefono ?? '',
          direccion: cliente.direccion ?? '',
          comuna: cliente.comuna ?? '',
          condicion_pago_dias: cliente.condicion_pago_dias,
        }}
      />
    </div>
  )
}
