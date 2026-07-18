import { crearClienteServidor } from '@suite/auth/server'
import { Encabezado } from '@suite/ui'
import type { CodigoRubro } from '@suite/core'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { FormularioModulos } from '../../../componentes/formulario-modulos'
import { PanelContabilidad } from '../../../componentes/panel-contabilidad'
import { alternarContabilidad, guardarModulos } from './acciones'

export default async function ConfigModulos() {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />

  const supabase = await crearClienteServidor()
  const { data: empresa } = await supabase
    .from('empresas')
    .select('rubro, factor_volumetrico')
    .eq('id', activa.id)
    .single()

  return (
    <div>
      <Encabezado titulo="Módulos" />
      <FormularioModulos
        accion={guardarModulos}
        inicial={{
          rubro: (empresa?.rubro ?? 'negocio') as CodigoRubro,
          factorVolumetrico: empresa?.factor_volumetrico ?? 250,
        }}
      />
      <PanelContabilidad accion={alternarContabilidad} activo={activa.modulo_contabilidad} />
    </div>
  )
}
