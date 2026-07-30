import { crearClienteServidor } from '@suite/auth/server'
import { Encabezado } from '@suite/ui'
import { FormularioCotizacion } from '../../../componentes/formulario-cotizacion'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { crearCotizacion } from '../acciones'

export default async function NuevaCotizacion() {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const supabase = await crearClienteServidor()
  const [{ data: productos }, { data: clientes }] = await Promise.all([
    supabase.from('productos').select('id, nombre, precio_neto, exento').eq('empresa_id', activa.id).eq('activo', true).order('nombre'),
    supabase.from('clientes').select('id, razon_social').eq('empresa_id', activa.id).eq('activo', true).order('razon_social'),
  ])
  return (
    <div>
      <Encabezado titulo="Nueva cotización" />
      <FormularioCotizacion accion={crearCotizacion} productos={productos ?? []} clientes={clientes ?? []} />
    </div>
  )
}
