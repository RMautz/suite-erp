import Link from 'next/link'
import { notFound } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP, pendienteLinea, totalOrden } from '@suite/core'
import { Boton, Encabezado, Insignia, Tabla, Tarjeta, Td, Th, Tr } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { cancelarOrden, marcarEnviada } from '../acciones'
import { ETIQUETA_ESTADO, TONO_ESTADO } from '../estados'

export default async function DetalleOrdenCompra({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const supabase = await crearClienteServidor()
  const { data: oc } = await supabase
    .from('ordenes_compra')
    .select(`id, numero, estado, notas, creado_en, proveedores (razon_social),
      ordenes_compra_lineas (id, descripcion, cantidad_pedida, cantidad_recibida, costo_unitario),
      recepciones (id, creado_en, notas, bodegas (nombre), recepciones_lineas (cantidad))`)
    .eq('id', id).eq('empresa_id', activa.id)
    .single()
  if (!oc) notFound()

  const lineas = oc.ordenes_compra_lineas ?? []
  const total = totalOrden(lineas.map((l) => ({ cantidad: l.cantidad_pedida, costoUnitario: l.costo_unitario })))
  const puedeRecibir = oc.estado === 'enviada' || oc.estado === 'recibida_parcial'

  return (
    <div>
      <Encabezado titulo={`Orden de compra N° ${oc.numero}`}>
        <div className="flex items-center gap-2">
          {oc.estado === 'borrador' && (
            <form action={marcarEnviada}><input type="hidden" name="id" value={oc.id} /><Boton type="submit">Marcar enviada</Boton></form>
          )}
          {(oc.estado === 'borrador' || oc.estado === 'enviada') && (
            <form action={cancelarOrden}><input type="hidden" name="id" value={oc.id} /><Boton variante="secundario" type="submit">Cancelar</Boton></form>
          )}
          {puedeRecibir && <Link href={`/compras/${oc.id}/recepcion`}><Boton>Registrar recepción</Boton></Link>}
        </div>
      </Encabezado>

      <div className="mb-4 flex items-center gap-3 text-sm text-slate-600">
        <Insignia tono={TONO_ESTADO[oc.estado] ?? 'gris'}>{ETIQUETA_ESTADO[oc.estado] ?? oc.estado}</Insignia>
        <span>Proveedor: <strong>{oc.proveedores?.razon_social ?? '—'}</strong></span>
        <span>Fecha: {new Date(oc.creado_en).toLocaleDateString('es-CL')}</span>
        {oc.notas && <span>Notas: {oc.notas}</span>}
      </div>

      <Tabla>
        <thead><tr><Th>Producto</Th><Th className="text-right">Pedido</Th><Th className="text-right">Recibido</Th><Th className="text-right">Pendiente</Th><Th className="text-right">Costo unitario</Th><Th className="text-right">Subtotal</Th></tr></thead>
        <tbody>
          {lineas.map((l) => (
            <Tr key={l.id}>
              <Td>{l.descripcion}</Td>
              <Td className="text-right font-mono">{l.cantidad_pedida}</Td>
              <Td className="text-right font-mono">{l.cantidad_recibida}</Td>
              <Td className="text-right font-mono">{pendienteLinea({ cantidadPedida: l.cantidad_pedida, cantidadRecibida: l.cantidad_recibida })}</Td>
              <Td className="text-right">{formatearCLP(l.costo_unitario)}</Td>
              <Td className="text-right">{formatearCLP(Math.round(l.cantidad_pedida * l.costo_unitario))}</Td>
            </Tr>
          ))}
        </tbody>
      </Tabla>
      <div className="mt-3 text-right text-lg">Total: <strong>{formatearCLP(total)}</strong></div>

      <div className="mt-6 max-w-2xl">
        <h2 className="mb-2 text-lg font-semibold text-slate-800">Recepciones</h2>
        <Tarjeta>
          <ul className="space-y-1 text-sm">
            {(oc.recepciones ?? []).map((r) => (
              <li key={r.id} className="flex justify-between">
                <span>{new Date(r.creado_en).toLocaleDateString('es-CL')} — {r.bodegas?.nombre ?? '—'}{r.notas ? ` · ${r.notas}` : ''}</span>
                <span className="font-mono">{(r.recepciones_lineas ?? []).reduce((s, l) => s + l.cantidad, 0)} unidades</span>
              </li>
            ))}
            {(oc.recepciones ?? []).length === 0 && <li className="text-slate-500">Sin recepciones todavía.</li>}
          </ul>
        </Tarjeta>
      </div>
    </div>
  )
}
