import { notFound } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP, formatearRut } from '@suite/core'
import { Boton, Encabezado, Insignia, Tabla, Tarjeta, Td, Th, Tr } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
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

  const emitible = doc.estado === 'borrador' || doc.estado === 'pendiente_envio'

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
        {emitible && (
          <>
            <form action={emitirDocumento}>
              <input type="hidden" name="id" value={doc.id} /><input type="hidden" name="tipo" value="factura" />
              <Boton type="submit">Emitir factura</Boton>
            </form>
            <form action={emitirDocumento}>
              <input type="hidden" name="id" value={doc.id} /><input type="hidden" name="tipo" value="boleta" />
              <Boton variante="secundario" type="submit">Emitir boleta</Boton>
            </form>
          </>
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
      </div>
    </div>
  )
}
