'use client'

import { useActionState } from 'react'
import { Boton, Campo, Entrada, Tarjeta } from '@suite/ui'
import type { EstadoForm } from '../app/tipos'

export interface TrabajadorEditable {
  id?: string
  rut: string
  nombre: string
  email: string
  telefono: string
  direccion: string
  fecha_nacimiento: string
}

const VACIO: TrabajadorEditable = {
  rut: '',
  nombre: '',
  email: '',
  telefono: '',
  direccion: '',
  fecha_nacimiento: '',
}

export function FormularioTrabajador({
  accion,
  inicial = VACIO,
}: {
  accion: (prev: EstadoForm, formData: FormData) => Promise<EstadoForm>
  inicial?: TrabajadorEditable
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoForm)
  return (
    <Tarjeta className="max-w-2xl">
      <form action={enviar} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {inicial.id && <input type="hidden" name="id" value={inicial.id} />}
        <Campo etiqueta="RUT *">
          <Entrada name="rut" defaultValue={inicial.rut} placeholder="12.345.678-5" required />
        </Campo>
        <Campo etiqueta="Nombre completo *">
          <Entrada name="nombre" defaultValue={inicial.nombre} required />
        </Campo>
        <Campo etiqueta="Correo">
          <Entrada name="email" type="email" defaultValue={inicial.email} />
        </Campo>
        <Campo etiqueta="Teléfono">
          <Entrada name="telefono" defaultValue={inicial.telefono} />
        </Campo>
        <Campo etiqueta="Fecha de nacimiento">
          <Entrada name="fecha_nacimiento" type="date" defaultValue={inicial.fecha_nacimiento} />
        </Campo>
        <Campo etiqueta="Dirección">
          <Entrada name="direccion" defaultValue={inicial.direccion} />
        </Campo>
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
