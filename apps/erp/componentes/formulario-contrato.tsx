'use client'

import { useActionState, useState } from 'react'
import { Boton, Campo, Entrada, Selector, Tarjeta } from '@suite/ui'
import type { EstadoForm } from '../app/tipos'
import { AFPS } from '../app/trabajadores/catalogos'

export function FormularioContrato({
  accion,
  trabajadorId,
  contratoVigenteId,
}: {
  accion: (prev: EstadoForm, formData: FormData) => Promise<EstadoForm>
  trabajadorId: string
  contratoVigenteId?: string
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoForm)
  const [tipo, setTipo] = useState('indefinido')
  const [salud, setSalud] = useState('fonasa')
  return (
    <Tarjeta className="max-w-2xl">
      <form action={enviar} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <input type="hidden" name="trabajador_id" value={trabajadorId} />
        {contratoVigenteId && (
          <input type="hidden" name="contrato_vigente_id" value={contratoVigenteId} />
        )}
        <Campo etiqueta="Tipo de contrato *">
          <Selector name="tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="indefinido">Indefinido</option>
            <option value="plazo_fijo">Plazo fijo</option>
          </Selector>
        </Campo>
        <Campo etiqueta="Cargo *">
          <Entrada name="cargo" required />
        </Campo>
        <Campo etiqueta="Fecha de inicio *">
          <Entrada name="fecha_inicio" type="date" required />
        </Campo>
        {tipo === 'plazo_fijo' && (
          <Campo etiqueta="Fecha de término *">
            <Entrada name="fecha_termino" type="date" required />
          </Campo>
        )}
        <Campo etiqueta="Sueldo base (CLP) *">
          <Entrada name="sueldo_base" inputMode="numeric" placeholder="800000" required />
        </Campo>
        <Campo etiqueta="AFP *">
          <Selector name="afp">
            {AFPS.map((a) => (
              <option key={a.valor} value={a.valor}>
                {a.etiqueta}
              </option>
            ))}
          </Selector>
        </Campo>
        <fieldset>
          <legend className="mb-1 block text-sm font-medium text-slate-700">Salud *</legend>
          <div className="flex items-center gap-4 py-2 text-sm text-slate-700">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="salud"
                value="fonasa"
                checked={salud === 'fonasa'}
                onChange={() => setSalud('fonasa')}
              />
              Fonasa (7%)
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="salud"
                value="isapre"
                checked={salud === 'isapre'}
                onChange={() => setSalud('isapre')}
              />
              Isapre
            </label>
          </div>
        </fieldset>
        {salud === 'isapre' && (
          <Campo etiqueta="Plan Isapre (UF) *">
            <Entrada name="plan_isapre_uf" inputMode="decimal" placeholder="3,5" required />
          </Campo>
        )}
        <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2">
          <input type="checkbox" name="gratificacion_legal" defaultChecked />
          Gratificación legal (25% mensual con tope de 4,75 IMM anual)
        </label>
        <div className="flex items-center justify-end gap-2 sm:col-span-2">
          {estado.error && <span className="mr-auto text-sm text-red-600">{estado.error}</span>}
          <Boton type="submit" disabled={pendiente}>
            {pendiente
              ? 'Guardando…'
              : contratoVigenteId
                ? 'Cerrar vigente y crear contrato'
                : 'Crear contrato'}
          </Boton>
        </div>
      </form>
    </Tarjeta>
  )
}
