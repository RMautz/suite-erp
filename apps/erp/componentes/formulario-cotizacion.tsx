'use client'

import { useActionState, useState } from 'react'
import { Boton, Campo, Entrada, Selector, Tabla, Td, Th, Tr, Tarjeta } from '@suite/ui'
import { formatearCLP, totalesDocumento, type LineaDocumento } from '@suite/core'
import type { EstadoForm } from '../app/tipos'

interface ProductoOpcion { id: string; nombre: string; precio_neto: number; exento: boolean }
interface ClienteOpcion { id: string; razon_social: string }

// Default de vigencia hoy + 30 (decisión de diseño §2); la RPC solo exige >= hoy.
function hoyMas30(): string {
  const d = new Date()
  d.setDate(d.getDate() + 30)
  return d.toISOString().slice(0, 10)
}

export function FormularioCotizacion({
  accion,
  productos,
  clientes,
}: {
  accion: (prev: EstadoForm, formData: FormData) => Promise<EstadoForm>
  productos: ProductoOpcion[]
  clientes: ClienteOpcion[]
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoForm)
  const [lineas, setLineas] = useState<LineaDocumento[]>([])

  function agregar(productoId: string) {
    const p = productos.find((x) => x.id === productoId)
    if (!p) return
    setLineas((ls) => [
      ...ls,
      { productoId: p.id, descripcion: p.nombre, cantidad: 1, precioNeto: p.precio_neto, exenta: p.exento },
    ])
  }
  function cambiarCantidad(i: number, cantidad: number) {
    setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, cantidad: Math.max(1, cantidad) } : l)))
  }
  function cambiarPrecio(i: number, precio: number) {
    setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, precioNeto: Math.max(0, Math.trunc(precio) || 0) } : l)))
  }
  function quitar(i: number) {
    setLineas((ls) => ls.filter((_, j) => j !== i))
  }

  const totales = totalesDocumento(lineas)

  return (
    <form action={enviar}>
      <input type="hidden" name="lineas" value={JSON.stringify(lineas)} />
      <Tarjeta className="mb-4 max-w-3xl">
        <div className="flex flex-wrap items-end gap-3">
          <Campo etiqueta="Cliente *">
            <Selector name="cliente_id" required defaultValue="">
              <option value="" disabled>Selecciona…</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>{c.razon_social}</option>
              ))}
            </Selector>
          </Campo>
          <Campo etiqueta="Válida hasta *">
            <Entrada type="date" name="fecha_validez" required defaultValue={hoyMas30()} />
          </Campo>
          <Campo etiqueta="Agregar producto">
            <Selector value="" onChange={(e: React.ChangeEvent<HTMLSelectElement>) => { agregar(e.currentTarget.value); e.currentTarget.value = '' }}>
              <option value="" disabled>Selecciona…</option>
              {productos.map((p) => (
                <option key={p.id} value={p.id}>{p.nombre} — {formatearCLP(p.precio_neto)}</option>
              ))}
            </Selector>
          </Campo>
          <Campo etiqueta="Notas">
            <Entrada name="notas" placeholder="Opcional" />
          </Campo>
        </div>
      </Tarjeta>

      <Tabla>
        <thead>
          <tr><Th>Producto</Th><Th>Cantidad</Th><Th className="text-right">Precio neto</Th><Th className="text-right">Subtotal</Th><Th /></tr>
        </thead>
        <tbody>
          {lineas.map((l, i) => (
            <Tr key={i}>
              <Td>{l.descripcion}{l.exenta && ' (exento)'}</Td>
              <Td>
                <Entrada type="number" min={1} value={l.cantidad} onChange={(e: React.ChangeEvent<HTMLInputElement>) => cambiarCantidad(i, Number(e.currentTarget.value))} className="w-20" />
              </Td>
              <Td className="text-right">
                <Entrada type="number" min={0} value={l.precioNeto} onChange={(e: React.ChangeEvent<HTMLInputElement>) => cambiarPrecio(i, Number(e.currentTarget.value))} className="w-28 text-right" />
              </Td>
              <Td className="text-right">{formatearCLP(Math.round(l.cantidad * l.precioNeto))}</Td>
              <Td><Boton variante="secundario" type="button" className="px-2 py-1 text-xs" onClick={() => quitar(i)}>Quitar</Boton></Td>
            </Tr>
          ))}
          {lineas.length === 0 && <Tr><Td colSpan={5} className="py-6 text-center text-slate-500">Agrega productos a la cotización.</Td></Tr>}
        </tbody>
      </Tabla>

      <div className="mt-4 flex flex-col items-end gap-1 text-sm">
        <div>Neto: <strong>{formatearCLP(totales.neto)}</strong></div>
        {totales.exento > 0 && <div>Exento: <strong>{formatearCLP(totales.exento)}</strong></div>}
        <div>IVA (19%): <strong>{formatearCLP(totales.iva)}</strong></div>
        <div className="text-lg">Total: <strong>{formatearCLP(totales.total)}</strong></div>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2">
        {estado.error && <span className="mr-auto text-sm text-red-600">{estado.error}</span>}
        <Boton type="submit" disabled={pendiente || lineas.length === 0}>{pendiente ? 'Guardando…' : 'Guardar cotización'}</Boton>
      </div>
    </form>
  )
}
