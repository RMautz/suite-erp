'use client'

import { useActionState } from 'react'
import { Boton, Campo, Entrada, Tarjeta } from '@suite/ui'
import type { EstadoForm } from '../app/tipos'

export function FormularioModulos({
  accion,
  inicial,
}: {
  accion: (prev: EstadoForm, formData: FormData) => Promise<EstadoForm>
  inicial: { moduloTransporte: boolean; factorVolumetrico: number }
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoForm)
  return (
    <Tarjeta className="max-w-2xl">
      <form action={enviar} className="grid gap-4">
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            name="modulo_transporte"
            defaultChecked={inicial.moduloTransporte}
            className="h-4 w-4 rounded border-slate-300 text-marca-600 focus:ring-marca-500"
          />
          <span className="text-sm font-medium text-slate-700">
            Módulo de transporte (flota, tarifario, entregas y proformas)
          </span>
        </label>
        <Campo etiqueta="Factor volumétrico (kg por M3, entre 1 y 10000)">
          <Entrada
            name="factor_volumetrico"
            type="number"
            inputMode="numeric"
            min={1}
            max={10000}
            step={1}
            defaultValue={inicial.factorVolumetrico}
            required
            className="max-w-xs"
          />
        </Campo>
        <p className="text-sm text-slate-500">
          Los cambios del factor volumétrico son prospectivos: las órdenes de entrega y
          proformas ya registradas no se recalculan. Apagar el módulo solo oculta las
          pantallas; no borra ni bloquea los datos existentes.
        </p>
        <div className="flex items-center justify-end gap-2">
          {estado.error && <span className="mr-auto text-sm text-red-600">{estado.error}</span>}
          <Boton type="submit" disabled={pendiente}>{pendiente ? 'Guardando…' : 'Guardar módulos'}</Boton>
        </div>
      </form>
    </Tarjeta>
  )
}
