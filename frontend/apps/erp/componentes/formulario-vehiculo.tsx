'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { Boton, Campo, Entrada, Tarjeta } from '@suite/ui'
import type { EstadoForm } from '../app/tipos'

export interface VehiculoEditable {
  id?: string
  patente: string
  descripcion: string
  capacidad_kg: string
}

const VACIO: VehiculoEditable = { patente: '', descripcion: '', capacidad_kg: '' }

export function FormularioVehiculo({
  accion, inicial = VACIO,
}: {
  accion: (prev: EstadoForm, formData: FormData) => Promise<EstadoForm>
  inicial?: VehiculoEditable
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoForm)
  return (
    <Tarjeta className="max-w-2xl">
      <form action={enviar} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {inicial.id && <input type="hidden" name="id" value={inicial.id} />}
        {inicial.id ? (
          <Campo etiqueta="Patente (no editable)"><Entrada value={inicial.patente} disabled /></Campo>
        ) : (
          <Campo etiqueta="Patente *"><Entrada name="patente" defaultValue={inicial.patente} placeholder="ABCD12" required /></Campo>
        )}
        <Campo etiqueta="Descripción"><Entrada name="descripcion" defaultValue={inicial.descripcion} placeholder="Camión 3/4" /></Campo>
        <Campo etiqueta="Capacidad (kg)"><Entrada name="capacidad_kg" inputMode="numeric" defaultValue={inicial.capacidad_kg} /></Campo>
        <div className="flex items-center justify-end gap-2 sm:col-span-3">
          {estado.error && <span className="mr-auto text-sm text-red-600">{estado.error}</span>}
          {inicial.id && <Link className="text-sm text-slate-500 hover:underline" href="/flota">Cancelar</Link>}
          <Boton type="submit" disabled={pendiente}>
            {pendiente ? 'Guardando…' : inicial.id ? 'Guardar cambios' : 'Agregar vehículo'}
          </Boton>
        </div>
      </form>
    </Tarjeta>
  )
}
