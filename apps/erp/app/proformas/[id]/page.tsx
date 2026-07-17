import { notFound } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP, formatearNumeroProforma, formatearRut } from '@suite/core'
import { Encabezado, Insignia, Tabla, Tarjeta, Td, Th, Tr } from '@suite/ui'
import { AccionesProforma } from '../../../componentes/acciones-proforma'
import { BotonEnviarCorreo } from '../../../componentes/boton-enviar-correo'
import { BotonImprimir } from '../../../componentes/boton-imprimir'
import { GenerarLinkPago } from '../../../componentes/generar-link-pago'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { enviarProformaCorreo } from '../../correo/acciones'
import { ETIQUETA_ESTADO, TONO_ESTADO } from '../estados'

const NUM = (n: number | null) => (n == null ? '—' : n.toLocaleString('es-CL', { maximumFractionDigits: 2 }))

export default async function DetalleProforma({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  if (!activa.modulo_transporte) notFound()
  const supabase = await crearClienteServidor()
  const { data: prof } = await supabase
    .from('proformas')
    .select('*, clientes (razon_social, rut), documentos_venta (tipo, folio, estado, emitido_en)')
    .eq('id', id).eq('empresa_id', activa.id).single()
  if (!prof) notFound()

  const rechazada = prof.estado === 'rechazada'
  // Una proforma rechazada ya liberó sus ODEs (pueden ser de otras proformas):
  // solo encabezado + motivo + totales ALMACENADOS, sin nómina ni Imprimir.
  const consultaOdes = rechazada
    ? null
    : await supabase
        .from('ordenes_entrega')
        .select('numero, fecha_ingreso, docum, oc_cliente, bultos, kilos, m3, kilo_afecto, neto, destinos (nombre)')
        .eq('empresa_id', activa.id).eq('proforma_id', id).order('numero')
  const odes = consultaOdes?.data ?? []
  const totBultos = odes.reduce((s, o) => s + o.bultos, 0)
  const totM3 = odes.reduce((s, o) => s + (o.m3 ?? 0), 0)
  const totKiloAfecto = odes.reduce((s, o) => s + o.kilo_afecto, 0)

  const conLinkPago = prof.estado === 'enviada' || prof.estado === 'aprobada'
  let linkPago: { url: string } | null = null
  if (conLinkPago) {
    const { data: link } = await supabase
      .from('links_pago')
      .select('url')
      .eq('empresa_id', activa.id).eq('origen_tipo', 'proforma').eq('origen_id', prof.id).eq('estado', 'vigente')
      .maybeSingle()
    linkPago = link ? { url: link.url } : null
  }

  const enviable = prof.estado === 'borrador' || prof.estado === 'enviada' || prof.estado === 'aprobada'
  const { data: ultimoCorreo } = enviable
    ? await supabase
        .from('correos_enviados')
        .select('para, creado_en')
        .eq('empresa_id', activa.id).eq('tipo', 'proforma').eq('referencia_id', prof.id)
        .order('creado_en', { ascending: false }).limit(1).maybeSingle()
    : { data: null }

  const fav = prof.documentos_venta
  const fecha = new Date(prof.fecha + 'T00:00:00').toLocaleDateString('es-CL')

  return (
    <div>
      <div className="print:hidden">
        <Encabezado titulo={`Proforma ${formatearNumeroProforma(prof.numero)}`}>
          <Insignia tono={TONO_ESTADO[prof.estado] ?? 'gris'}>{ETIQUETA_ESTADO[prof.estado] ?? prof.estado}</Insignia>
          {!rechazada && <BotonImprimir />}
        </Encabezado>
      </div>

      <div className="mb-4 hidden print:block">
        <h1 className="text-xl font-bold">{activa.razon_social}</h1>
        <p className="text-sm text-slate-600">{formatearRut(activa.rut)}</p>
        <h2 className="mt-2 text-lg font-semibold">PROFORMA — Documento no tributario</h2>
        <p className="text-sm">{formatearNumeroProforma(prof.numero)}</p>
      </div>

      <Tarjeta className="mb-4 max-w-3xl">
        <p><strong>Cliente:</strong> {prof.clientes?.razon_social} ({prof.clientes && formatearRut(prof.clientes.rut)})</p>
        <p className="mt-1 text-sm text-slate-600">Fecha: {fecha}</p>
        {prof.estado === 'facturada' && (
          <p className="mt-1 text-sm text-slate-600">
            Nro. FAV: {fav?.folio ?? '— (sin folio)'} · Fecha FAV: {fav?.emitido_en ? new Date(fav.emitido_en).toLocaleDateString('es-CL') : '—'}
          </p>
        )}
        {prof.notas && <p className="mt-1 text-sm text-slate-600">Notas: {prof.notas}</p>}
        {rechazada && prof.motivo_rechazo && (
          <p className="mt-2 text-sm text-red-700"><strong>Motivo de rechazo:</strong> {prof.motivo_rechazo}</p>
        )}
      </Tarjeta>

      {!rechazada && (
        <Tabla>
          <thead>
            <tr>
              <Th>N° ODE</Th><Th>Fecha ingreso</Th><Th>Destino</Th><Th>Docum</Th><Th>OC</Th>
              <Th className="text-right">Bultos</Th><Th className="text-right">Kilos</Th><Th className="text-right">M3</Th>
              <Th className="text-right">Kilo afecto</Th><Th className="text-right">Neto</Th>
            </tr>
          </thead>
          <tbody>
            {odes.map((o) => (
              <Tr key={o.numero}>
                <Td>{o.numero}</Td>
                <Td>{new Date(o.fecha_ingreso + 'T00:00:00').toLocaleDateString('es-CL')}</Td>
                <Td>{o.destinos?.nombre ?? '—'}</Td>
                <Td>{o.docum ?? '—'}</Td>
                <Td>{o.oc_cliente ?? '—'}</Td>
                <Td className="text-right">{o.bultos}</Td>
                <Td className="text-right">{NUM(o.kilos)}</Td>
                <Td className="text-right">{NUM(o.m3)}</Td>
                <Td className="text-right">{NUM(o.kilo_afecto)}</Td>
                <Td className="text-right font-mono">{formatearCLP(o.neto)}</Td>
              </Tr>
            ))}
          </tbody>
        </Tabla>
      )}

      <div className="mt-4 flex flex-col items-end gap-1 text-sm">
        {!rechazada && (
          <>
            <div>Bultos: <strong>{totBultos}</strong></div>
            <div>M3: <strong>{NUM(totM3)}</strong></div>
            <div>Kilo afecto: <strong>{NUM(totKiloAfecto)}</strong></div>
          </>
        )}
        <div>Neto: <strong>{formatearCLP(prof.neto)}</strong></div>
        <div>IVA (19%): <strong>{formatearCLP(prof.iva)}</strong></div>
        <div className="text-lg">Total: <strong>{formatearCLP(prof.total)}</strong></div>
      </div>

      <p className="mt-6 hidden text-sm text-slate-600 print:block">Documento no tributario: no constituye factura ni comprobante fiscal.</p>

      <div className="mt-6 flex flex-wrap items-center gap-3 print:hidden">
        <AccionesProforma
          proformaId={prof.id}
          estado={prof.estado}
          documentoVentaId={prof.documento_venta_id}
          // Espejo EXACTO de la condición de anular_estado_pago (no confiar en el
          // invariante de emitir.ts): borrador de nota_venta sin folio, o DTE rechazado.
          puedeDeshacer={
            (fav?.tipo === 'nota_venta' && fav?.estado === 'borrador' && fav?.folio === null) ||
            ((fav?.tipo === 'factura' || fav?.tipo === 'boleta') && fav?.estado === 'rechazado')
          }
        />
        {enviable && (
          <BotonEnviarCorreo
            accion={enviarProformaCorreo}
            id={prof.id}
            ultimoEnvio={ultimoCorreo ? { para: ultimoCorreo.para, fecha: ultimoCorreo.creado_en } : null}
          />
        )}
      </div>

      {conLinkPago && (
        <Tarjeta className="mt-6 max-w-3xl print:hidden">
          <h2 className="text-lg font-semibold text-slate-900">Anticipo con MercadoPago</h2>
          <p className="mt-1 text-sm text-slate-600">
            Cobra el total de la proforma (<strong className="font-mono">{formatearCLP(prof.total)}</strong>) como anticipo;
            se aplicará solo al facturarla.
          </p>
          <div className="mt-3">
            <GenerarLinkPago tipo="proforma" id={prof.id} linkVigente={linkPago} />
          </div>
        </Tarjeta>
      )}
    </div>
  )
}
