'use client'

import { useActionState, useState } from 'react'
import { Boton, Campo, Entrada, Selector, Tarjeta } from '@suite/ui'
import type { EstadoForm } from '../app/tipos'

interface Opcion { id: string; nombre: string }

export function FormularioMovimiento({
  productos, bodegas, proveedores, accionEntrada, accionAjuste, accionTraslado,
}: {
  productos: Opcion[]
  bodegas: Opcion[]
  proveedores: Opcion[]
  accionEntrada: (prev: EstadoForm, formData: FormData) => Promise<EstadoForm>
  accionAjuste: (prev: EstadoForm, formData: FormData) => Promise<EstadoForm>
  accionTraslado: (prev: EstadoForm, formData: FormData) => Promise<EstadoForm>
}) {
  const [tab, setTab] = useState<'entrada' | 'ajuste' | 'traslado'>('entrada')
  const [eEntrada, fEntrada, pEntrada] = useActionState(accionEntrada, {} as EstadoForm)
  const [eAjuste, fAjuste, pAjuste] = useActionState(accionAjuste, {} as EstadoForm)
  const [eTraslado, fTraslado, pTraslado] = useActionState(accionTraslado, {} as EstadoForm)

  const tabClase = (t: string) => `rounded-md px-3 py-1.5 text-sm ${tab === t ? 'bg-marca-700 text-white' : 'bg-slate-100 text-slate-700'}`
  const selProducto = <Selector name="producto_id" required defaultValue=""><option value="" disabled>Producto…</option>{productos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</Selector>

  return (
    <Tarjeta className="mb-6 max-w-2xl">
      <div className="mb-4 flex gap-2">
        <button type="button" className={tabClase('entrada')} onClick={() => setTab('entrada')}>Entrada</button>
        <button type="button" className={tabClase('ajuste')} onClick={() => setTab('ajuste')}>Ajuste</button>
        <button type="button" className={tabClase('traslado')} onClick={() => setTab('traslado')}>Traslado</button>
      </div>

      {tab === 'entrada' && (
        <form action={fEntrada} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Campo etiqueta="Producto *">{selProducto}</Campo>
          <Campo etiqueta="Bodega *"><Selector name="bodega_id" required defaultValue=""><option value="" disabled>Bodega…</option>{bodegas.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}</Selector></Campo>
          <Campo etiqueta="Cantidad *"><Entrada name="cantidad" inputMode="numeric" required /></Campo>
          <Campo etiqueta="Proveedor"><Selector name="proveedor_id" defaultValue=""><option value="">Sin proveedor</option>{proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</Selector></Campo>
          <div className="sm:col-span-2"><Campo etiqueta="Motivo"><Entrada name="motivo" placeholder="Ej: Compra, ingreso inicial" /></Campo></div>
          <div className="flex items-center justify-end gap-2 sm:col-span-2">{eEntrada.error && <span className="mr-auto text-sm text-red-600">{eEntrada.error}</span>}<Boton type="submit" disabled={pEntrada}>{pEntrada ? 'Registrando…' : 'Registrar entrada'}</Boton></div>
        </form>
      )}

      {tab === 'ajuste' && (
        <form action={fAjuste} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Campo etiqueta="Producto *">{selProducto}</Campo>
          <Campo etiqueta="Bodega *"><Selector name="bodega_id" required defaultValue=""><option value="" disabled>Bodega…</option>{bodegas.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}</Selector></Campo>
          <Campo etiqueta="Cantidad (± ; negativo resta) *"><Entrada name="cantidad" inputMode="numeric" required /></Campo>
          <Campo etiqueta="Motivo *"><Entrada name="motivo" required placeholder="Ej: Merma, conteo físico" /></Campo>
          <div className="flex items-center justify-end gap-2 sm:col-span-2">{eAjuste.error && <span className="mr-auto text-sm text-red-600">{eAjuste.error}</span>}<Boton type="submit" disabled={pAjuste}>{pAjuste ? 'Registrando…' : 'Registrar ajuste'}</Boton></div>
        </form>
      )}

      {tab === 'traslado' && (
        <form action={fTraslado} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Campo etiqueta="Producto *">{selProducto}</Campo>
          <Campo etiqueta="Cantidad *"><Entrada name="cantidad" inputMode="numeric" required /></Campo>
          <Campo etiqueta="Desde bodega *"><Selector name="bodega_origen" required defaultValue=""><option value="" disabled>Origen…</option>{bodegas.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}</Selector></Campo>
          <Campo etiqueta="Hacia bodega *"><Selector name="bodega_destino" required defaultValue=""><option value="" disabled>Destino…</option>{bodegas.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}</Selector></Campo>
          <div className="flex items-center justify-end gap-2 sm:col-span-2">{eTraslado.error && <span className="mr-auto text-sm text-red-600">{eTraslado.error}</span>}<Boton type="submit" disabled={pTraslado}>{pTraslado ? 'Registrando…' : 'Registrar traslado'}</Boton></div>
        </form>
      )}
    </Tarjeta>
  )
}
