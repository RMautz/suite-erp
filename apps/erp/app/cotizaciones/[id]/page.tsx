import Link from 'next/link'
import { notFound } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { cotizacionVencida, formatearCLP, formatearRut, type EstadoCotizacion } from '@suite/core'
import { Boton, Encabezado, Insignia, Tabla, Tarjeta, Td, Th, Tr } from '@suite/ui'
import { AccionesCotizacion } from '../../../componentes/acciones-cotizacion'
import { BotonEnviarCorreo } from '../../../componentes/boton-enviar-correo'
import { BotonImprimir } from '../../../componentes/boton-imprimir'
import { GenerarLinkPago } from '../../../componentes/generar-link-pago'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { enviarCotizacionCorreo } from '../../correo/acciones'
import { ETIQUETA_ESTADO, TONO_ESTADO } from '../estados'

export default async function DetalleCotizacion({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const supabase = await crearClienteServidor()
  const { data: cot } = await supabase
    .from('cotizaciones')
    .select('*, clientes (razon_social, rut), cotizaciones_lineas (descripcion, cantidad, precio_neto, exenta, subtotal)')
    .eq('id', id).eq('empresa_id', activa.id).single()
  if (!cot) notFound()

  let linkPago: { url: string } | null = null
  if (cot.estado === 'aceptada') {
    const { data: link } = await supabase
      .from('links_pago')
      .select('url')
      .eq('empresa_id', activa.id).eq('origen_tipo', 'cotizacion').eq('origen_id', cot.id).eq('estado', 'vigente')
      .maybeSingle()
    linkPago = link ? { url: link.url } : null
  }

  const enviable = cot.estado === 'borrador' || cot.estado === 'enviada' || cot.estado === 'aceptada'
  const { data: ultimoCorreo } = enviable
    ? await supabase
        .from('correos_enviados')
        .select('para, creado_en')
        .eq('empresa_id', activa.id).eq('tipo', 'cotizacion').eq('referencia_id', cot.id)
        .order('creado_en', { ascending: false }).limit(1).maybeSingle()
    : { data: null }

  const hoy = new Date().toISOString().slice(0, 10)
  // estado es text + check en SQL; el codegen lo tipa string — cast solo de tipo.
  const vencida = cotizacionVencida(cot.fecha_validez, hoy, cot.estado as EstadoCotizacion)
  const creada = new Date(cot.creado_en).toLocaleDateString('es-CL')
  const validez = new Date(cot.fecha_validez + 'T00:00:00').toLocaleDateString('es-CL')

  return (
    <div>
      <div className="print:hidden">
        <Encabezado titulo={`Cotización N° ${cot.numero}`}>
          <Insignia tono={TONO_ESTADO[cot.estado] ?? 'gris'}>{ETIQUETA_ESTADO[cot.estado] ?? cot.estado}</Insignia>
          {vencida && <Insignia tono="rojo">Vencida</Insignia>}
          <BotonImprimir />
        </Encabezado>
      </div>

      <div className="mb-4 hidden print:block">
        <h1 className="text-xl font-bold">{activa.razon_social}</h1>
        <p className="text-sm text-slate-600">{formatearRut(activa.rut)}</p>
        <h2 className="mt-2 text-lg font-semibold">Cotización N° {cot.numero}</h2>
      </div>

      <Tarjeta className="mb-4 max-w-3xl">
        <p><strong>Cliente:</strong> {cot.clientes?.razon_social} ({cot.clientes && formatearRut(cot.clientes.rut)})</p>
        <p className="mt-1 text-sm text-slate-600">Creada: {creada} · Válida hasta: {validez}</p>
        {cot.notas && <p className="mt-1 text-sm text-slate-600">Notas: {cot.notas}</p>}
        {cot.estado === 'rechazada' && cot.motivo_rechazo && (
          <p className="mt-2 text-sm text-red-700"><strong>Motivo de rechazo:</strong> {cot.motivo_rechazo}</p>
        )}
      </Tarjeta>

      <Tabla>
        <thead><tr><Th>Descripción</Th><Th>Cantidad</Th><Th className="text-right">Precio unitario</Th><Th className="text-right">Subtotal</Th></tr></thead>
        <tbody>
          {cot.cotizaciones_lineas.map((l: { descripcion: string; cantidad: number; precio_neto: number; exenta: boolean; subtotal: number }, i: number) => (
            <Tr key={i}>
              <Td>{l.descripcion}{l.exenta && <span className="ml-1 text-xs text-slate-500">(exenta)</span>}</Td>
              <Td>{l.cantidad}</Td>
              <Td className="text-right">{formatearCLP(l.precio_neto)}</Td>
              <Td className="text-right">{formatearCLP(l.subtotal)}</Td>
            </Tr>
          ))}
        </tbody>
      </Tabla>

      <div className="mt-4 flex flex-col items-end gap-1 text-sm">
        <div>Neto: <strong>{formatearCLP(cot.neto)}</strong></div>
        {cot.exento > 0 && <div>Exento: <strong>{formatearCLP(cot.exento)}</strong></div>}
        <div>IVA: <strong>{formatearCLP(cot.iva)}</strong></div>
        <div className="text-lg">Total: <strong>{formatearCLP(cot.total)}</strong></div>
      </div>

      <p className="mt-6 hidden text-sm text-slate-600 print:block">Cotización válida hasta el {validez}.</p>

      <div className="mt-6 flex flex-wrap items-center gap-3 print:hidden">
        <AccionesCotizacion cotizacionId={cot.id} estado={cot.estado} vencida={vencida} />
        {enviable && (
          <BotonEnviarCorreo
            accion={enviarCotizacionCorreo}
            id={cot.id}
            ultimoEnvio={ultimoCorreo ? { para: ultimoCorreo.para, fecha: ultimoCorreo.creado_en } : null}
          />
        )}
        {cot.estado === 'convertida' && cot.documento_venta_id && (
          <Link href={`/ventas/${cot.documento_venta_id}`}>
            <Boton variante="secundario" type="button">Ver nota de venta</Boton>
          </Link>
        )}
      </div>

      {cot.estado === 'aceptada' && (
        <Tarjeta className="mt-6 max-w-3xl print:hidden">
          <h2 className="text-lg font-semibold text-slate-900">Anticipo con MercadoPago</h2>
          <p className="mt-1 text-sm text-slate-600">
            Cobra el total de la cotización (<strong className="font-mono">{formatearCLP(cot.total)}</strong>) como anticipo;
            se aplicará solo al facturarla.
          </p>
          <div className="mt-3">
            <GenerarLinkPago tipo="cotizacion" id={cot.id} linkVigente={linkPago} />
          </div>
        </Tarjeta>
      )}
    </div>
  )
}
