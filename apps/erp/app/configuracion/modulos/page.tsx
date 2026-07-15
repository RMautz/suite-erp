import { crearClienteServidor } from '@suite/auth/server'
import { Encabezado } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { FormularioModulos } from '../../../componentes/formulario-modulos'
import { guardarModulos } from './acciones'

export default async function ConfigModulos() {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />

  const supabase = await crearClienteServidor()
  const { data: empresa } = await supabase
    .from('empresas')
    .select('modulo_transporte, factor_volumetrico')
    .eq('id', activa.id)
    .single()

  return (
    <div>
      <Encabezado titulo="Módulos" />
      <FormularioModulos
        accion={guardarModulos}
        inicial={{
          moduloTransporte: empresa?.modulo_transporte ?? false,
          factorVolumetrico: empresa?.factor_volumetrico ?? 250,
        }}
      />
    </div>
  )
}
