import { crearClienteServidor } from '@suite/auth/server'
import { Encabezado } from '@suite/ui'
import { exigirContabilidad } from '../../../lib/contabilidad-acceso'
import { PanelCuentas } from '../../../componentes/panel-cuentas'
import { guardarCuenta } from './acciones'

export default async function PaginaCuentas() {
  const activa = await exigirContabilidad()
  const supabase = await crearClienteServidor()
  const { data: cuentas } = await supabase
    .from('cuentas_contables')
    .select('id, codigo, nombre, tipo, acepta_movimientos, clave_sistema, activa')
    .eq('empresa_id', activa.id)
    .order('codigo')

  return (
    <div>
      <Encabezado titulo="Plan de cuentas" />
      <PanelCuentas cuentas={cuentas ?? []} accion={guardarCuenta} />
    </div>
  )
}
