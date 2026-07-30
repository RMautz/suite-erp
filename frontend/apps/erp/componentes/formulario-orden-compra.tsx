'use client'

import { useActionState, useState } from 'react'
import { Boton, Campo, Entrada, Selector, Tabla, Td, Th, Tr, Tarjeta } from '@suite/ui'
import { formatearCLP, totalOrden } from '@suite/core'
import type { EstadoForm } from '../app/tipos'

interface ProductoOpcion { id: string; nombre: string }
interface ProveedorOpcion { id: string; razon_social: string }
interface LineaOc { productoId: string; descripcion: string; cantidad: number; costoUnitario: number }

export function FormularioOrdenCompra({
  accion,
  productos,
  proveedores,
}: {
  accion: (prev: EstadoForm, formData: FormData) => Promise<EstadoForm>
  productos: ProductoOpcion[]
  proveedores: ProveedorOpcion[]
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoForm)
  const [lineas, setLineas] = useState<LineaOc[]>([])

  function agregar(productoId: string) {
    const p = productos.find((x) => x.id === productoId)
    if (!p) return
    setLineas((ls) => [...ls, { productoId: p.id, descripcion: p.nombre, cantidad: 1, costoUnitario: 0 }])
  }
  function cambiar(i: number, campo: 'cantidad' | 'costoUnitario', valor: number) {
    setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, [campo]: Math.max(campo === 'cantidad' ? 1 : 0, Math.trunc(valor) || 0) } : l)))
  }
  function quitar(i: number) {
    setLineas((ls) => ls.filter((_, j) => j !== i))
  }

  const total = totalOrden(lineas.map((l) => ({ cantidad: l.cantidad, costoUnitario: l.costoUnitario })))

  return (
    <form action={enviar}>
      <input type="hidden" name="lineas" value={JSON.stringify(lineas.map(({ descripcion: _d, ...resto }) => resto))} />
      <Tarjeta className="mb-4 max-w-3xl">
        <div className="flex flex-wrap items-end gap-3">
          <Campo etiqueta="Proveedor *">
            <Selector name="proveedor_id" required defaultValue="">
              <option value="" disabled>Selecciona…</option>
              {proveedores.map((p) => <option key={p.id} value={p.id}>{p.razon_social}</option>)}
            </Selector>
          </Campo>
          <Campo etiqueta="Agregar producto">
            <Selector value="" onChange={(e: React.ChangeEvent<HTMLSelectElement>) => { agregar(e.currentTarget.value); e.currentTarget.value = '' }}>
              <option value="" disabled>Selecciona…</option>
              {productos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </Selector>
          </Campo>
          <Campo etiqueta="Notas"><Entrada name="notas" placeholder="Opcional" /></Campo>
        </div>
      </Tarjeta>

      <Tabla>
        <thead>
          <tr><Th>Producto</Th><Th>Cantidad</Th><Th className="text-right">Costo unitario</Th><Th className="text-right">Subtotal</Th><Th /></tr>
        </thead>
        <tbody>
          {lineas.map((l, i) => (
            <Tr key={i}>
              <Td>{l.descripcion}</Td>
              <Td><Entrada type="number" min={1} value={l.cantidad} onChange={(e: React.ChangeEvent<HTMLInputElement>) => cambiar(i, 'cantidad', Number(e.currentTarget.value))} className="w-20" /></Td>
              <Td className="text-right"><Entrada type="number" min={0} value={l.costoUnitario} onChange={(e: React.ChangeEvent<HTMLInputElement>) => cambiar(i, 'costoUnitario', Number(e.currentTarget.value))} className="w-28 text-right" /></Td>
              <Td className="text-right">{formatearCLP(Math.round(l.cantidad * l.costoUnitario))}</Td>
              <Td><Boton variante="secundario" type="button" className="px-2 py-1 text-xs" onClick={() => quitar(i)}>Quitar</Boton></Td>
            </Tr>
          ))}
          {lineas.length === 0 && <Tr><Td colSpan={5} className="py-6 text-center text-slate-500">Agrega productos a la orden.</Td></Tr>}
        </tbody>
      </Tabla>

      <div className="mt-4 flex flex-col items-end text-sm">
        <div className="text-lg">Total: <strong>{formatearCLP(total)}</strong></div>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2">
        {estado.error && <span className="mr-auto text-sm text-red-600">{estado.error}</span>}
        <Boton type="submit" disabled={pendiente || lineas.length === 0}>{pendiente ? 'Creando…' : 'Crear orden de compra'}</Boton>
      </div>
    </form>
  )
}
