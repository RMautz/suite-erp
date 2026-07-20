'use client'

import { useActionState, useState } from 'react'
import { calcularFiniquito, formatearCLP, formatearRut } from '@suite/core'
import { Boton, Campo, Entrada, Selector, Tarjeta } from '@suite/ui'
import { emitirFiniquito } from '../app/trabajadores/[id]/finiquito/acciones'
import { CAUSALES } from '../app/trabajadores/catalogos'
import type { EstadoForm } from '../app/tipos'

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/

function Linea({ concepto, monto }: { concepto: string; monto: number }) {
  return (
    <div className="flex justify-between gap-2 py-0.5 text-sm">
      <span>{concepto}</span>
      <span className="font-mono">{formatearCLP(monto)}</span>
    </div>
  )
}

export function FormularioFiniquito({
  trabajador,
  fechaInicioPrimerContrato,
  sueldoBase,
  diasTomados,
  ufPorPeriodo,
}: {
  trabajador: { id: string; nombre: string; rut: string }
  fechaInicioPrimerContrato: string
  sueldoBase: number
  diasTomados: number
  ufPorPeriodo: Record<string, number>
}) {
  const [causal, setCausal] = useState('necesidades_empresa')
  const [fechaTermino, setFechaTermino] = useState('')
  const [avisoDado, setAvisoDado] = useState(false)
  const [otrosHaberes, setOtrosHaberes] = useState('0')
  const [otrosDescuentos, setOtrosDescuentos] = useState('0')
  const [resultado, enviar, pendiente] = useActionState(emitirFiniquito, {} as EstadoForm)

  // La vista previa clampa igual que la action (vacío/NaN no rompe el cálculo);
  // el servidor re-valida estricto y la RPC recalcula TODO (spec §3).
  const haberes = Math.max(0, Math.trunc(Number(otrosHaberes)) || 0)
  const descuentos = Math.max(0, Math.trunc(Number(otrosDescuentos)) || 0)
  const uf = ufPorPeriodo[fechaTermino.slice(0, 7)]

  // El espejo LANZA con total negativo (mismo guard byte-exacto que la RPC): se
  // captura y se muestra como aviso — la vista previa jamás rompe el render.
  let previa: ReturnType<typeof calcularFiniquito> | null = null
  let baseTopada = 0 // min(sueldo, 90 UF) — el espejo no la expone; se recalcula para la etiqueta (§3.2)
  let aviso: string | null = null
  if (!FECHA_ISO.test(fechaTermino)) {
    aviso = 'Indica la fecha de término para ver el cálculo.'
  } else if (uf == null) {
    aviso = 'No hay indicadores previsionales para el período' // mismo texto que la RPC (spec §3.2)
  } else {
    try {
      previa = calcularFiniquito({
        causal,
        aviso_dado: avisoDado,
        fecha_inicio: fechaInicioPrimerContrato,
        fecha_termino: fechaTermino,
        sueldo_base: sueldoBase,
        dias_tomados: diasTomados,
        uf,
        otros_haberes: haberes,
        otros_descuentos: descuentos,
      })
      baseTopada = Math.min(sueldoBase, Math.round(90 * uf))
    } catch (e) {
      aviso = e instanceof Error ? e.message : 'No se pudo calcular la vista previa'
    }
  }

  return (
    <form action={enviar} className="grid max-w-5xl gap-6 md:grid-cols-2">
      <input type="hidden" name="trabajador_id" value={trabajador.id} />
      <Tarjeta className="grid gap-4 self-start">
        <Campo etiqueta="Causal legal de término">
          <Selector name="causal" value={causal} onChange={(e) => setCausal(e.target.value)}>
            {CAUSALES.map((c) => (
              <option key={c.valor} value={c.valor}>{c.etiqueta}</option>
            ))}
          </Selector>
        </Campo>
        <Campo etiqueta="Fecha de término">
          <Entrada name="fecha_termino" type="date" required value={fechaTermino} onChange={(e) => setFechaTermino(e.target.value)} />
        </Campo>
        {/* Visible SOLO para necesidades_empresa (spec §6): en las demás causales
            no hay indemnización sustitutiva del aviso previo. */}
        {causal === 'necesidades_empresa' && (
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" name="aviso_dado" checked={avisoDado} onChange={(e) => setAvisoDado(e.target.checked)} />
            Se dio el aviso previo de 30 días (sin aviso se paga un mes adicional)
          </label>
        )}
        <Campo etiqueta="Otros haberes (CLP)">
          <Entrada name="otros_haberes" type="number" min={0} step={1} value={otrosHaberes} onChange={(e) => setOtrosHaberes(e.target.value)} />
        </Campo>
        <Campo etiqueta="Otros descuentos (CLP)">
          <Entrada name="otros_descuentos" type="number" min={0} step={1} value={otrosDescuentos} onChange={(e) => setOtrosDescuentos(e.target.value)} />
        </Campo>
        <Campo etiqueta="Comentario (opcional)">
          <Entrada name="comentario" placeholder="Referencia interna" />
        </Campo>
        <div className="flex flex-wrap items-center gap-3">
          <Boton type="submit" disabled={pendiente || previa == null}>
            {pendiente ? 'Emitiendo…' : 'Emitir finiquito'}
          </Boton>
          {resultado.error && <span className="text-sm text-red-600">{resultado.error}</span>}
        </div>
      </Tarjeta>

      <Tarjeta>
        <h2 className="mb-1 text-lg font-semibold text-slate-800">Vista previa</h2>
        <p className="mb-3 text-sm text-slate-500">
          {trabajador.nombre} · {formatearRut(trabajador.rut)}. El cálculo definitivo lo hace el
          servidor al emitir; al emitir se cierra el contrato y el trabajador queda inactivo.
        </p>
        {aviso && <p className="text-sm text-amber-700">{aviso}</p>}
        {previa != null && (
          <div>
            <Linea
              concepto={`Indemnización por años de servicio (${previa.anos_servicio} ${previa.anos_servicio === 1 ? 'año' : 'años'}, base ${formatearCLP(baseTopada)})`}
              monto={previa.indemnizacion_anos}
            />
            <Linea concepto="Indemnización sustitutiva del aviso previo" monto={previa.indemnizacion_aviso} />
            <Linea
              concepto={`Feriado proporcional (${previa.feriado_dias.toLocaleString('es-CL')} días, saldo con ${diasTomados} tomados)`}
              monto={previa.feriado_monto}
            />
            <Linea concepto="Otros haberes" monto={haberes} />
            <Linea concepto="Otros descuentos" monto={-descuentos} />
            <div className="mt-2 flex items-center justify-between rounded-md bg-slate-100 px-3 py-2 text-lg font-semibold">
              <span>TOTAL FINIQUITO</span>
              <span className="font-mono">{formatearCLP(previa.total)}</span>
            </div>
            <p className="mt-3 text-xs text-slate-500">
              Simplificación v1: el feriado usa el saldo en días hábiles sin conversión a corridos y
              sin cotizaciones previsionales; el contador puede ajustar con un asiento manual.
            </p>
          </div>
        )}
      </Tarjeta>
    </form>
  )
}
