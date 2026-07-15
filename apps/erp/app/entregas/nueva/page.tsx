import { notFound } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { Encabezado } from '@suite/ui'
import { FormularioOrdenEntrega } from '../../../componentes/formulario-orden-entrega'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { crearOrdenEntrega } from '../acciones'

export default async function NuevaOrdenEntrega() {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  if (!activa.modulo_transporte) notFound()
  const supabase = await crearClienteServidor()
  const [{ data: empresa }, { data: clientes }, { data: destinos }, { data: vehiculos }, { data: conductores }] = await Promise.all([
    supabase.from('empresas').select('factor_volumetrico').eq('id', activa.id).single(),
    supabase.from('clientes').select('id, razon_social').eq('empresa_id', activa.id).eq('activo', true).order('razon_social'),
    supabase.from('destinos').select('id, nombre, tarifa_kg').eq('empresa_id', activa.id).eq('activo', true).order('nombre'),
    supabase.from('vehiculos').select('id, patente').eq('empresa_id', activa.id).eq('activo', true).order('patente'),
    supabase.from('conductores').select('id, nombre').eq('empresa_id', activa.id).eq('activo', true).order('nombre'),
  ])
  return (
    <div>
      <Encabezado titulo="Nueva orden de entrega" />
      <FormularioOrdenEntrega
        accion={crearOrdenEntrega}
        clientes={clientes ?? []}
        destinos={destinos ?? []}
        vehiculos={vehiculos ?? []}
        conductores={conductores ?? []}
        factor={empresa?.factor_volumetrico ?? 250}
      />
    </div>
  )
}
