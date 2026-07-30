'use client'

import { useActionState } from 'react'
import { RUBROS, type CodigoRubro } from '@suite/core'
import { Boton, Campo, Entrada, Tarjeta } from '@suite/ui'
import type { EstadoForm } from '../app/tipos'

export function FormularioModulos({
  accion,
  inicial,
}: {
  accion: (prev: EstadoForm, formData: FormData) => Promise<EstadoForm>
  inicial: { rubro: CodigoRubro; factorVolumetrico: number }
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoForm)
  const nombreRubro =
    RUBROS.find((r) => r.codigo === inicial.rubro)?.nombre ?? inicial.rubro
  return (
    <Tarjeta className="max-w-2xl">
      <div className="grid gap-4">
        <div>
          <p className="text-sm font-medium text-slate-700">
            Rubro: <span className="font-semibold">{nombreRubro}</span>
          </p>
          <p className="text-sm text-slate-500">
            El rubro lo asigna la plataforma. Para cambiarlo, contacta a soporte.
          </p>
        </div>
        {inicial.rubro === 'transporte' && (
          <form action={enviar} className="grid gap-4">
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
              proformas ya registradas no se recalculan.
            </p>
            <div className="flex items-center justify-end gap-2">
              {estado.error && <span className="mr-auto text-sm text-red-600">{estado.error}</span>}
              <Boton type="submit" disabled={pendiente}>{pendiente ? 'Guardando…' : 'Guardar módulos'}</Boton>
            </div>
          </form>
        )}
      </div>
    </Tarjeta>
  )
}
