import { notFound } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { Encabezado, Insignia } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'

const ETIQUETA: Record<string, string> = {
  cotizacion: 'Cotización',
  proforma: 'Proforma',
  documento: 'Documento',
  recordatorio: 'Recordatorio',
}

// Detalle de un correo enviado: metadatos + el HTML tal como salió, en un iframe
// sandboxeado (misma doble barrera del visor mock: escape en la plantilla + sandbox).
export default async function PaginaDetalleCorreo({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const supabase = await crearClienteServidor()
  const { data: correo } = await supabase
    .from('correos_enviados')
    .select('tipo, para, asunto, html, creado_en')
    .eq('empresa_id', activa.id)
    .eq('id', id)
    .maybeSingle()
  if (!correo) notFound()

  return (
    <div>
      <Encabezado titulo="Correo enviado" />
      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-slate-600">
        <span><Insignia tono="gris">{ETIQUETA[correo.tipo] ?? correo.tipo}</Insignia></span>
        <span>Enviado el {new Date(correo.creado_en).toLocaleString('es-CL')}</span>
        <span>Para: <strong>{correo.para}</strong></span>
      </div>
      <p className="mb-4 text-base font-medium text-slate-800">{correo.asunto}</p>
      {correo.html ? (
        <iframe
          srcDoc={correo.html}
          sandbox=""
          title="Contenido del correo"
          className="h-[70vh] w-full rounded-lg border border-slate-200 bg-white"
        />
      ) : (
        <p className="rounded-lg border border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">
          Este correo se envió antes de que el registro guardara el contenido — solo hay metadatos.
        </p>
      )}
    </div>
  )
}
