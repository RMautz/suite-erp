'use client'

import { useActionState } from 'react'
import { Boton, Campo, Entrada, Selector, Tarjeta } from '@suite/ui'
import type { EstadoForm } from '../app/tipos'

export interface CategoriaOpcion {
  id: string
  nombre: string
}

export interface ProductoEditable {
  id?: string
  sku: string
  nombre: string
  descripcion: string
  codigo_barras: string
  unidad: string
  precio_neto: number | ''
  exento: boolean
  categoria_id: string
}

const VACIO: ProductoEditable = {
  sku: '',
  nombre: '',
  descripcion: '',
  codigo_barras: '',
  unidad: 'UN',
  precio_neto: '',
  exento: false,
  categoria_id: '',
}

export function FormularioProducto({
  accion,
  categorias,
  inicial = VACIO,
}: {
  accion: (prev: EstadoForm, formData: FormData) => Promise<EstadoForm>
  categorias: CategoriaOpcion[]
  inicial?: ProductoEditable
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoForm)
  return (
    <Tarjeta className="max-w-2xl">
      <form action={enviar} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {inicial.id && <input type="hidden" name="id" value={inicial.id} />}
        <Campo etiqueta="SKU *">
          <Entrada name="sku" defaultValue={inicial.sku} required />
        </Campo>
        <Campo etiqueta="Nombre *">
          <Entrada name="nombre" defaultValue={inicial.nombre} required />
        </Campo>
        <Campo etiqueta="Precio neto (CLP) *">
          <Entrada name="precio_neto" inputMode="numeric" defaultValue={inicial.precio_neto} required />
        </Campo>
        <Campo etiqueta="Unidad">
          <Entrada name="unidad" defaultValue={inicial.unidad} />
        </Campo>
        <Campo etiqueta="Código de barras">
          <Entrada name="codigo_barras" defaultValue={inicial.codigo_barras} />
        </Campo>
        <Campo etiqueta="Categoría">
          <Selector name="categoria_id" defaultValue={inicial.categoria_id}>
            <option value="">Sin categoría</option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </Selector>
        </Campo>
        <Campo etiqueta="…o crear categoría nueva">
          <Entrada name="categoria_nueva" placeholder="Ej: Abarrotes" />
        </Campo>
        <div className="sm:col-span-2">
          <Campo etiqueta="Descripción">
            <Entrada name="descripcion" defaultValue={inicial.descripcion} />
          </Campo>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" name="exento" defaultChecked={inicial.exento} />
          Exento de IVA
        </label>
        <div className="flex items-center justify-end gap-2 sm:col-span-2">
          {estado.error && <span className="mr-auto text-sm text-red-600">{estado.error}</span>}
          <Boton type="submit" disabled={pendiente}>
            {pendiente ? 'Guardando…' : 'Guardar'}
          </Boton>
        </div>
      </form>
    </Tarjeta>
  )
}
