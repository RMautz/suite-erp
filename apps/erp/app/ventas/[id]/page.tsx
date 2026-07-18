import Link from 'next/link'
import { notFound } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP, formatearRut } from '@suite/core'
import { Boton, Encabezado, Insignia, Tabla, Tarjeta, Td, Th, Tr } from '@suite/ui'
import { BotonEnviarCorreo } from '../../../componentes/boton-enviar-correo'
import { GenerarLinkPago } from '../../../componentes/generar-link-pago'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { enviarDocumentoCorreo } from '../../correo/acciones'
import { emitirDocumento, emitirNotaCredito } from '../emitir'

export default async function DetalleVenta({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const supabase = await crearClienteServidor()
  const { data: doc } = await supabase
    .from('documentos_venta')
    .select('*, clientes (razon_social, rut), documentos_venta_lineas (descripcion, cantidad, precio_neto, subtotal)')
    .eq('id', id).eq('empresa_id', activa.id).single()
  if (!doc) notFound()

  // Asiento contable del documento (si el módulo está activo y el rol lo ve — la RLS por
  // rol devuelve 0 filas al resto). venta y nota_credito comparten referencia_id = doc.id.
  const { data: asiento } = await supabase
    .from('asientos')
    .select('id, numero')
    .eq('empresa_id', activa.id)
    .in('origen', ['venta', 'nota_credito'])
    .eq('referencia_id', doc.id)
    .maybeSingle()

  const emitible = doc.estado === 'borrador' || doc.estado === 'pendiente_envio'
  const esNotaVenta = doc.tipo === 'nota_venta'

  // Cobro con link MP: solo factura/boleta emitida con saldo > 0.
  const cobrable = doc.estado === 'emitido' && doc.tipo !== 'nota_credito' && doc.tipo !== 'nota_venta'
  let saldo = 0
  let linkPago: { url: string } | null = null
  if (cobrable) {
    const [{ data: fila }, { data: link }] = await Promise.all([
      supabase.from('saldos_documentos').select('saldo').eq('empresa_id', activa.id).eq('documento_id', doc.id).maybeSingle(),
      supabase.from('links_pago').select('url')
        .eq('empresa_id', activa.id).eq('origen_tipo', 'factura').eq('origen_id', doc.id).eq('estado', 'vigente').maybeSingle(),
    ])
    saldo = fila?.saldo ?? 0
    linkPago = link ? { url: link.url } : null
  }

  const enviable = doc.estado === 'emitido' && (doc.tipo === 'factura' || doc.tipo === 'boleta')
  const { data: ultimoCorreo } = enviable
    ? await supabase
        .from('correos_enviados')
        .select('para, creado_en')
        .eq('empresa_id', activa.id).eq('tipo', 'documento').eq('referencia_id', doc.id)
        .order('creado_en', { ascending: false }).limit(1).maybeSingle()
    : { data: null }

  return (
    <div>
      <Encabezado titulo={`${doc.tipo.replace('_', ' ')} ${doc.folio ? '· folio ' + doc.folio : ''}`}>
        <Insignia tono={doc.estado === 'emitido' ? 'verde' : doc.estado === 'rechazado' ? 'rojo' : doc.estado === 'pendiente_envio' ? 'amarillo' : 'gris'}>
          {doc.estado.replace('_', ' ')}
        </Insignia>
      </Encabezado>

      <Tarjeta className="mb-4 max-w-3xl">
        <p><strong>Cliente:</strong> {doc.clientes?.razon_social} ({doc.clientes && formatearRut(doc.clientes.rut)})</p>
        {doc.error_emision && <p className="mt-2 text-sm text-amber-700">Último error: {doc.error_emision}</p>}
        {asiento && (
          <p className="mt-2 text-sm text-slate-600">
            Asiento contable: <Link className="text-marca-700 hover:underline" href={`/contabilidad/asientos/${asiento.id}`}>N° {asiento.numero}</Link>
          </p>
        )}
      </Tarjeta>

      <Tabla>
        <thead><tr><Th>Descripción</Th><Th>Cantidad</Th><Th className="text-right">Precio</Th><Th className="text-right">Subtotal</Th></tr></thead>
        <tbody>
          {doc.documentos_venta_lineas.map((l: { descripcion: string; cantidad: number; precio_neto: number; subtotal: number }, i: number) => (
            <Tr key={i}><Td>{l.descripcion}</Td><Td>{l.cantidad}</Td><Td className="text-right">{formatearCLP(l.precio_neto)}</Td><Td className="text-right">{formatearCLP(l.subtotal)}</Td></Tr>
          ))}
        </tbody>
      </Tabla>

      <div className="mt-4 flex flex-col items-end gap-1 text-sm">
        <div>Neto: <strong>{formatearCLP(doc.neto)}</strong></div>
        {doc.exento > 0 && <div>Exento: <strong>{formatearCLP(doc.exento)}</strong></div>}
        <div>IVA: <strong>{formatearCLP(doc.iva)}</strong></div>
        <div className="text-lg">Total: <strong>{formatearCLP(doc.total)}</strong></div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {emitible && (esNotaVenta || doc.tipo === 'factura') && (
          <form action={emitirDocumento}>
            <input type="hidden" name="id" value={doc.id} /><input type="hidden" name="tipo" value="factura" />
            <Boton type="submit">Emitir factura</Boton>
          </form>
        )}
        {emitible && (esNotaVenta || doc.tipo === 'boleta') && (
          <form action={emitirDocumento}>
            <input type="hidden" name="id" value={doc.id} /><input type="hidden" name="tipo" value="boleta" />
            <Boton variante="secundario" type="submit">Emitir boleta</Boton>
          </form>
        )}
        {doc.estado === 'emitido' && doc.tipo !== 'nota_credito' && (
          <>
            <a href={`/ventas/${doc.id}/pdf`} target="_blank" rel="noreferrer"><Boton variante="secundario" type="button">Descargar PDF</Boton></a>
            <form action={emitirNotaCredito}>
              <input type="hidden" name="referencia_id" value={doc.id} /><input type="hidden" name="razon" value="Anula documento" />
              <Boton variante="peligro" type="submit">Anular con nota de crédito</Boton>
            </form>
          </>
        )}
        {enviable && (
          <BotonEnviarCorreo
            accion={enviarDocumentoCorreo}
            id={doc.id}
            ultimoEnvio={ultimoCorreo ? { para: ultimoCorreo.para, fecha: ultimoCorreo.creado_en } : null}
          />
        )}
      </div>

      {cobrable && saldo > 0 && (
        <Tarjeta className="mt-6 max-w-3xl">
          <h2 className="text-lg font-semibold text-slate-900">Cobro con MercadoPago</h2>
          <p className="mt-1 text-sm text-slate-600">
            Saldo pendiente: <strong className="font-mono">{formatearCLP(saldo)}</strong>. Genera un link para que el cliente pague en línea.
          </p>
          <div className="mt-3">
            <GenerarLinkPago tipo="factura" id={doc.id} linkVigente={linkPago} />
          </div>
        </Tarjeta>
      )}
    </div>
  )
}
