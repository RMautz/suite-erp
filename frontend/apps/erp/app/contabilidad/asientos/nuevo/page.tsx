import { crearClienteServidor } from '@suite/auth/server'
import { Encabezado } from '@suite/ui'
import { exigirContabilidad } from '../../../../lib/contabilidad-acceso'
import { FormularioAsiento } from '../../../../componentes/formulario-asiento'
import { crearAsiento } from '../acciones'

export default async function NuevoAsiento() {
  const activa = await exigirContabilidad()
  const supabase = await crearClienteServidor()
  // Solo cuentas hoja activas reciben líneas (acepta_movimientos = true).
  const { data: cuentas } = await supabase
    .from('cuentas_contables')
    .select('id, codigo, nombre')
    .eq('empresa_id', activa.id)
    .eq('acepta_movimientos', true)
    .eq('activa', true)
    .order('codigo')

  return (
    <div>
      <Encabezado titulo="Nuevo asiento manual" />
      <FormularioAsiento accion={crearAsiento} cuentas={cuentas ?? []} />
    </div>
  )
}
