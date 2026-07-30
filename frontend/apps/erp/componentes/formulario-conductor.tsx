'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { Boton, Campo, Entrada, Tarjeta } from '@suite/ui'
import type { EstadoForm } from '../app/tipos'

export interface ConductorEditable {
  id?: string
  rut: string
  nombre: string
  telefono: string
}

const VACIO: ConductorEditable = { rut: '', nombre: '', telefono: '' }

export function FormularioConductor({
  accion, inicial = VACIO,
}: {
  accion: (prev: EstadoForm, formData: FormData) => Promise<EstadoForm>
  inicial?: ConductorEditable
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoForm)
  return (
    <Tarjeta className="max-w-2xl">
      <form action={enviar} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {inicial.id && <input type="hidden" name="id" value={inicial.id} />}
        {inicial.id ? (
          <Campo etiqueta="RUT (no editable)"><Entrada value={inicial.rut} disabled /></Campo>
        ) : (
          <Campo etiqueta="RUT *"><Entrada name="rut" defaultValue={inicial.rut} placeholder="12.345.678-5" required /></Campo>
        )}
        <Campo etiqueta="Nombre *"><Entrada name="nombre" defaultValue={inicial.nombre} required /></Campo>
        <Campo etiqueta="Teléfono"><Entrada name="telefono" defaultValue={inicial.telefono} /></Campo>
        <div className="flex items-center justify-end gap-2 sm:col-span-3">
          {estado.error && <span className="mr-auto text-sm text-red-600">{estado.error}</span>}
          {inicial.id && <Link className="text-sm text-slate-500 hover:underline" href="/flota">Cancelar</Link>}
          <Boton type="submit" disabled={pendiente}>
            {pendiente ? 'Guardando…' : inicial.id ? 'Guardar cambios' : 'Agregar conductor'}
          </Boton>
        </div>
      </form>
    </Tarjeta>
  )
}
