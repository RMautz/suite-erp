'use client'

import { useActionState, useState } from 'react'
import { Boton, Campo, Entrada, Selector, Tarjeta } from '@suite/ui'
import { formatearCLP } from '@suite/core'
import type { EstadoForm } from '../app/tipos'

interface ProveedorOpcion { id: string; razon_social: string }
interface OrdenOpcion { id: string; numero: number; proveedorId: string }

export function FormularioFacturaCompra({
  accion,
  proveedores,
  ordenes,
}: {
  accion: (prev: EstadoForm, formData: FormData) => Promise<EstadoForm>
  proveedores: ProveedorOpcion[]
  ordenes: OrdenOpcion[]
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoForm)
  const [proveedor, setProveedor] = useState('')
  const [neto, setNeto] = useState(0)
  const [exento, setExento] = useState(0)
  const [iva, setIva] = useState(0)
  const [total, setTotal] = useState(0)
  const entero = (v: string) => Math.max(0, Math.trunc(Number(v)) || 0)
  const cuadra = total === neto + exento + iva
  const ivaSugerido = Math.round(neto * 0.19)
  const ordenesDelProveedor = ordenes.filter((o) => o.proveedorId === proveedor)

  return (
    <Tarjeta className="max-w-2xl">
      <form action={enviar} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Campo etiqueta="Proveedor *">
          <Selector name="proveedor_id" required value={proveedor}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setProveedor(e.currentTarget.value)}>
            <option value="" disabled>Selecciona…</option>
            {proveedores.map((p) => <option key={p.id} value={p.id}>{p.razon_social}</option>)}
          </Selector>
        </Campo>
        <Campo etiqueta="Tipo *">
          <Selector name="tipo" required defaultValue="factura">
            <option value="factura">Factura (33)</option>
            <option value="factura_exenta">Factura exenta (34)</option>
          </Selector>
        </Campo>
        <Campo etiqueta="Folio *"><Entrada name="folio" inputMode="numeric" required /></Campo>
        <Campo etiqueta="Fecha de emisión *"><Entrada type="date" name="fecha_emision" required /></Campo>
        <Campo etiqueta="Neto">
          <Entrada name="neto" inputMode="numeric" value={neto}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNeto(entero(e.currentTarget.value))} />
        </Campo>
        <Campo etiqueta="Exento">
          <Entrada name="exento" inputMode="numeric" value={exento}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setExento(entero(e.currentTarget.value))} />
        </Campo>
        <Campo etiqueta={`IVA (sugerido: ${formatearCLP(ivaSugerido)})`}>
          <Entrada name="iva" inputMode="numeric" value={iva}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setIva(entero(e.currentTarget.value))} />
        </Campo>
        <Campo etiqueta="Total *">
          <Entrada name="total" inputMode="numeric" value={total}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTotal(entero(e.currentTarget.value))} />
        </Campo>
        <Campo etiqueta="Orden de compra (opcional)">
          <Selector name="orden_id" defaultValue="" disabled={!proveedor}>
            <option value="">Sin orden asociada</option>
            {ordenesDelProveedor.map((o) => <option key={o.id} value={o.id}>OC {o.numero}</option>)}
          </Selector>
        </Campo>
        <Campo etiqueta="Notas"><Entrada name="notas" /></Campo>
        <div className="flex items-center justify-end gap-3 sm:col-span-2">
          {!cuadra && total > 0 && <span className="mr-auto text-sm text-red-600">El total no cuadra (neto + exento + IVA = {formatearCLP(neto + exento + iva)})</span>}
          {estado.error && cuadra && <span className="mr-auto text-sm text-red-600">{estado.error}</span>}
          <Boton type="submit" disabled={pendiente || !cuadra || total === 0}>{pendiente ? 'Registrando…' : 'Registrar factura'}</Boton>
        </div>
      </form>
    </Tarjeta>
  )
}
