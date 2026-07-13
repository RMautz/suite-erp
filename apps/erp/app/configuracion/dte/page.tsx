import { crearClienteServidor } from '@suite/auth/server'
import { Encabezado, Insignia } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { FormularioEmisor } from '../../../componentes/formulario-emisor'
import { FormularioCertificado } from '../../../componentes/formulario-certificado'
import { FormularioCAF } from '../../../componentes/formulario-caf'
import { cargarCAF, cargarCertificado, guardarEmisor } from './acciones'

export default async function ConfigDTE() {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />

  const supabase = await crearClienteServidor()
  const { data: empresa } = await supabase
    .from('empresas')
    .select('giro_emisor, direccion_emisor, comuna_emisor, resolucion_sii_numero, resolucion_sii_fecha, certificado_cifrado')
    .eq('id', activa.id)
    .single()
  const { data: cafs } = await supabase
    .from('folios_caf')
    .select('tipo_documento, desde, hasta, siguiente, activo')
    .eq('empresa_id', activa.id)
    .order('creado_en', { ascending: false })

  const tieneCert = Boolean(empresa?.certificado_cifrado)

  return (
    <div>
      <Encabezado titulo="Configuración de facturación electrónica" />

      <h2 className="mb-2 text-lg font-semibold text-slate-800">Datos del emisor</h2>
      <FormularioEmisor
        accion={guardarEmisor}
        inicial={{
          giro: empresa?.giro_emisor ?? '',
          direccion: empresa?.direccion_emisor ?? '',
          comuna: empresa?.comuna_emisor ?? '',
          resolucion: empresa?.resolucion_sii_numero ?? '',
          fecha: empresa?.resolucion_sii_fecha ?? '',
        }}
      />

      <h2 className="mb-2 mt-8 text-lg font-semibold text-slate-800">
        Certificado digital {tieneCert ? <Insignia tono="verde">Cargado</Insignia> : <Insignia tono="amarillo">Falta</Insignia>}
      </h2>
      <FormularioCertificado accion={cargarCertificado} />

      <h2 className="mb-2 mt-8 text-lg font-semibold text-slate-800">Folios CAF</h2>
      <FormularioCAF accion={cargarCAF} cafs={cafs ?? []} />
    </div>
  )
}
