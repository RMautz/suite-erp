'use client'

import { useActionState } from 'react'
import { formatearPatente } from '@suite/core'
import { Boton, Campo, Entrada, Selector, Tarjeta } from '@suite/ui'
import type { EstadoForm } from '../app/tipos'

interface VehiculoOpcion {
  id: string
  patente: string
}

export function FormularioCargaManual({
  accion,
  vehiculos,
}: {
  accion: (prev: EstadoForm, formData: FormData) => Promise<EstadoForm>
  vehiculos: VehiculoOpcion[]
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoForm)
  return (
    <Tarjeta>
      <h2 className="text-lg font-semibold text-slate-900">Carga manual</h2>
      <p className="mt-1 text-sm text-slate-600">
        Para cargas fuera de TCT (efectivo, otra distribuidora). Sin guía no hay dedup:
        si la digitas dos veces, elimina la repetida.
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
        <Campo etiqueta="Litros *"><Entrada name="litros" inputMode="decimal" placeholder="38,5" required /></Campo>
        <Campo etiqueta="Monto total ($) *"><Entrada name="monto" inputMode="numeric" placeholder="45000" required /></Campo>
        <Campo etiqueta="Precio por litro ($)"><Entrada name="precio_litro" inputMode="numeric" /></Campo>
        <Campo etiqueta="Estación"><Entrada name="estacion" placeholder="Copec Ruta 5" /></Campo>
        <div className="flex items-center justify-end gap-2 sm:col-span-2">
          {estado.error && <span className="mr-auto text-sm text-red-600">{estado.error}</span>}
          <Boton type="submit" disabled={pendiente}>
            {pendiente ? 'Guardando…' : 'Registrar carga'}
          </Boton>
        </div>
      </form>
    </Tarjeta>
  )
}
