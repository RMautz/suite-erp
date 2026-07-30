import { notFound } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { Encabezado } from '@suite/ui'
import { FormularioProforma } from '../../../componentes/formulario-proforma'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { crearProforma } from '../acciones'

export default async function NuevaProforma() {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  if (!activa.modulo_transporte) notFound()
  const supabase = await crearClienteServidor()
  const [{ data: clientes }, { data: libres }] = await Promise.all([
    supabase.from('clientes').select('id, razon_social').eq('empresa_id', activa.id).eq('activo', true).order('razon_social'),
    supabase
      .from('ordenes_entrega')
      .select('id, cliente_id, numero, fecha_ingreso, bultos, kilos, m3, kilo_afecto, neto, destinos (nombre)')
      .eq('empresa_id', activa.id)
      .eq('estado', 'registrada')
      .is('proforma_id', null)
      .order('numero'),
  ])
  const ordenes = (libres ?? []).map((o) => ({
    id: o.id,
    cliente_id: o.cliente_id,
    numero: o.numero,
    fecha_ingreso: o.fecha_ingreso,
    destino_nombre: o.destinos?.nombre ?? '—',
    bultos: o.bultos,
    kilos: o.kilos,
    m3: o.m3,
    kilo_afecto: o.kilo_afecto,
    neto: o.neto,
  }))
  return (
    <div>
      <Encabezado titulo="Nueva proforma" />
      <FormularioProforma accion={crearProforma} clientes={clientes ?? []} ordenes={ordenes} />
    </div>
  )
}
