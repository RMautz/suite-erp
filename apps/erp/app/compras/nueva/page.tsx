import { crearClienteServidor } from '@suite/auth/server'
import { Encabezado } from '@suite/ui'
import { FormularioOrdenCompra } from '../../../componentes/formulario-orden-compra'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { crearOrdenCompra } from '../acciones'

export default async function NuevaOrdenCompra() {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const supabase = await crearClienteServidor()
  const [{ data: productos }, { data: proveedores }] = await Promise.all([
    supabase.from('productos').select('id, nombre').eq('empresa_id', activa.id).eq('activo', true).order('nombre'),
    supabase.from('proveedores').select('id, razon_social').eq('empresa_id', activa.id).eq('activo', true).order('razon_social'),
  ])
  return (
    <div>
      <Encabezado titulo="Nueva orden de compra" />
      <FormularioOrdenCompra
        accion={crearOrdenCompra}
        productos={(productos ?? []).map((p) => ({ id: p.id, nombre: p.nombre }))}
        proveedores={(proveedores ?? []).map((p) => ({ id: p.id, razon_social: p.razon_social }))}
      />
    </div>
  )
}
