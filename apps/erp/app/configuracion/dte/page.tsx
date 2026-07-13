import { crearClienteServidor } from '@suite/auth/server'
import { Boton, Campo, Encabezado, Entrada, Insignia, Selector, Tarjeta } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { FormularioEmisor } from '../../../componentes/formulario-emisor'
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

  // ponytail: <form action> nativo exige (formData) => void; cargarCertificado/cargarCAF
  // usan la firma (prev, formData) del contrato EstadoForm. Envoltorio inline de una
  // línea para adaptar la firma sin tocar la lógica de las acciones.
  async function subirCertificado(formData: FormData) {
    'use server'
    await cargarCertificado({}, formData)
  }
  async function subirCAF(formData: FormData) {
    'use server'
    await cargarCAF({}, formData)
  }

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
      <Tarjeta className="max-w-2xl">
        <form action={subirCertificado} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Campo etiqueta="Certificado (.pfx) *">
            <input type="file" name="certificado" accept=".pfx,.p12" required className="text-sm" />
          </Campo>
          <Campo etiqueta="Contraseña del certificado *">
            <Entrada name="certificado_password" type="password" required />
          </Campo>
          <div className="sm:col-span-2">
            <Campo etiqueta="API key del proveedor DTE (SimpleAPI) *">
              <Entrada name="dte_api_key" required />
            </Campo>
          </div>
          <div className="flex justify-end sm:col-span-2">
            <Boton type="submit">Cargar certificado</Boton>
          </div>
        </form>
        <p className="mt-2 text-xs text-slate-500">
          El certificado se guarda cifrado y solo se usa en el servidor al emitir. Nunca se muestra ni se descarga.
        </p>
      </Tarjeta>

      <h2 className="mb-2 mt-8 text-lg font-semibold text-slate-800">Folios CAF</h2>
      <Tarjeta className="max-w-2xl">
        <form action={subirCAF} className="flex flex-wrap items-end gap-3">
          <Campo etiqueta="Tipo">
            <Selector name="tipo_documento" defaultValue="factura">
              <option value="factura">Factura (33)</option>
              <option value="boleta">Boleta (39)</option>
              <option value="nota_credito">Nota de crédito (61)</option>
            </Selector>
          </Campo>
          <Campo etiqueta="Archivo CAF (.xml)">
            <input type="file" name="caf" accept=".xml" required className="text-sm" />
          </Campo>
          <Boton type="submit">Cargar CAF</Boton>
        </form>
        <ul className="mt-4 space-y-1 text-sm text-slate-700">
          {(cafs ?? []).map((c, i) => (
            <li key={i}>
              {c.tipo_documento}: folios {c.desde}–{c.hasta} (siguiente: {c.siguiente}){' '}
              {c.activo ? <Insignia tono="verde">Activo</Insignia> : <Insignia tono="gris">Inactivo</Insignia>}
            </li>
          ))}
          {(cafs ?? []).length === 0 && <li className="text-slate-500">Aún no cargas folios CAF.</li>}
        </ul>
      </Tarjeta>
    </div>
  )
}
