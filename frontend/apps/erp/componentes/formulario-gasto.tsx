'use client'

import { useActionState } from 'react'
import { formatearPatente } from '@suite/core'
import { Boton, Campo, Entrada, Selector, Tarjeta } from '@suite/ui'
import { CATEGORIAS_GASTO, ETIQUETA_CATEGORIA } from '../app/combustible/categorias'
import type { EstadoForm } from '../app/tipos'

interface VehiculoOpcion {
  id: string
  patente: string
}

export function FormularioGasto({
  accion,
  vehiculos,
}: {
  accion: (prev: EstadoForm, formData: FormData) => Promise<EstadoForm>
  vehiculos: VehiculoOpcion[]
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoForm)
  return (
    <Tarjeta>
      <h2 className="text-lg font-semibold text-slate-900">Gasto del vehículo</h2>
      <p className="mt-1 text-sm text-slate-600">
        Peajes, mantención, neumáticos, seguros y otros costos directos del camión.
      </p>
      <form action={enviar} className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Campo etiqueta="Vehículo *">
          <Selector name="vehiculo_id" required defaultValue="">
            <option value="" disabled>Selecciona…</option>
            {vehiculos.map((v) => (
              <option key={v.id} value={v.id}>{formatearPatente(v.patente)}</option>
            ))}
          </Selector>
        </Campo>
        <Campo etiqueta="Fecha *"><Entrada type="date" name="fecha" required /></Campo>
        <Campo etiqueta="Categoría *">
          <Selector name="categoria" required defaultValue="">
            <option value="" disabled>Selecciona…</option>
            {CATEGORIAS_GASTO.map((c) => (
              <option key={c} value={c}>{ETIQUETA_CATEGORIA[c]}</option>
            ))}
          </Selector>
        </Campo>
        <Campo etiqueta="Monto ($) *"><Entrada name="monto" inputMode="numeric" placeholder="25000" required /></Campo>
        <div className="sm:col-span-2">
          <Campo etiqueta="Notas"><Entrada name="notas" placeholder="Cambio de aceite 10.000 km" /></Campo>
        </div>
        <div className="flex items-center justify-end gap-2 sm:col-span-2">
          {estado.error && <span className="mr-auto text-sm text-red-600">{estado.error}</span>}
          <Boton type="submit" disabled={pendiente}>
            {pendiente ? 'Guardando…' : 'Registrar gasto'}
          </Boton>
        </div>
      </form>
    </Tarjeta>
  )
}
