'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { Boton, Campo, Entrada, Tarjeta } from '@suite/ui'
import type { EstadoForm } from '../app/tipos'

export interface DestinoEditable {
  id?: string
  nombre: string
  tarifa_kg: string
}

const VACIO: DestinoEditable = { nombre: '', tarifa_kg: '' }

export function FormularioDestino({
  accion, inicial = VACIO,
}: {
  accion: (prev: EstadoForm, formData: FormData) => Promise<EstadoForm>
  inicial?: DestinoEditable
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoForm)
  return (
    <Tarjeta className="max-w-2xl">
      <form action={enviar} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {inicial.id && <input type="hidden" name="id" value={inicial.id} />}
        {inicial.id ? (
          <Campo etiqueta="Destino (no editable)"><Entrada value={inicial.nombre} disabled /></Campo>
        ) : (
          <Campo etiqueta="Destino *"><Entrada name="nombre" defaultValue={inicial.nombre} placeholder="Punta Arenas" required /></Campo>
        )}
        <Campo etiqueta="Tarifa por kg afecto (CLP) *">
          <Entrada name="tarifa_kg" inputMode="numeric" defaultValue={inicial.tarifa_kg} required />
        </Campo>
        <div className="flex items-center justify-end gap-2 sm:col-span-3">
          {estado.error && <span className="mr-auto text-sm text-red-600">{estado.error}</span>}
          {inicial.id && <Link className="text-sm text-slate-500 hover:underline" href="/tarifario">Cancelar</Link>}
          <Boton type="submit" disabled={pendiente}>
            {pendiente ? 'Guardando…' : inicial.id ? 'Guardar tarifa' : 'Agregar destino'}
          </Boton>
        </div>
      </form>
    </Tarjeta>
  )
}
