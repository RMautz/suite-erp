import { crearClienteServidor } from '@suite/auth/server'
import { Encabezado } from '@suite/ui'
import { FormularioFacturaCompra } from '../../../../componentes/formulario-factura-compra'
import { obtenerEmpresaActiva } from '../../../../lib/empresa-activa'
import { registrarFacturaCompra } from '../../acciones'

export default async function NuevaFacturaCompra() {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const supabase = await crearClienteServidor()
  const [{ data: proveedores }, { data: ordenes }] = await Promise.all([
    supabase.from('proveedores').select('id, razon_social').eq('empresa_id', activa.id).eq('activo', true).order('razon_social'),
    supabase.from('ordenes_compra').select('id, numero, proveedor_id').eq('empresa_id', activa.id).neq('estado', 'cancelada').order('numero', { ascending: false }).limit(200),
  ])
  return (
    <div>
      <Encabezado titulo="Registrar factura de compra" />
      <FormularioFacturaCompra
        accion={registrarFacturaCompra}
        proveedores={(proveedores ?? []).map((p) => ({ id: p.id, razon_social: p.razon_social }))}
        ordenes={(ordenes ?? []).map((o) => ({ id: o.id, numero: o.numero, proveedorId: o.proveedor_id }))}
      />
    </div>
  )
}
