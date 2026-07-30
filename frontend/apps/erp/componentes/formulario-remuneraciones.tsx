'use client'

import { useActionState } from 'react'
import { Boton, Campo, Entrada, Tarjeta } from '@suite/ui'
import type { EstadoForm } from '../app/tipos'

// Card "Remuneraciones" de Configuración → Módulos (spec P19 §7). Visible
// SIEMPRE: RRHH no tiene toggle de módulo, así que no se condiciona a nada.
export function FormularioRemuneraciones({
  accion,
  inicial,
}: {
  accion: (prev: EstadoForm, formData: FormData) => Promise<EstadoForm>
  inicial: { tasaMutual: number }
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoForm)
  return (
    <Tarjeta className="mt-4 max-w-2xl">
      <form action={enviar} className="grid gap-4">
        <p className="text-sm font-medium text-slate-700">Remuneraciones</p>
        <Campo etiqueta="Tasa mutual ley 16.744 (% sobre el imponible, entre 0 y 10)">
          <Entrada
            name="tasa_mutual"
            type="number"
            inputMode="decimal"
            min={0}
            max={10}
            step={0.01}
            defaultValue={inicial.tasaMutual}
            required
            className="max-w-xs"
          />
        </Campo>
        <p className="text-sm text-slate-500">
          La mutual es el seguro de accidentes del trabajo y enfermedades profesionales
          (ley 16.744) que paga el empleador: tasa base 0,90% más un adicional según el
          riesgo de la actividad, fijado por tu mutualidad (ACHS, Mutual de Seguridad,
          IST o ISL). El cambio es prospectivo: aplica a las liquidaciones que emitas
          desde ahora — las ya emitidas conservan la tasa con que se calcularon.
        </p>
        <div className="flex items-center justify-end gap-2">
          {estado.error && <span className="mr-auto text-sm text-red-600">{estado.error}</span>}
          <Boton type="submit" disabled={pendiente}>{pendiente ? 'Guardando…' : 'Guardar tasa mutual'}</Boton>
        </div>
      </form>
    </Tarjeta>
  )
}
