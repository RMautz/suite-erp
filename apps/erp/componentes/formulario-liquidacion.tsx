'use client'

import { useActionState, useState } from 'react'
import {
  calcularLiquidacion,
  formatearCLP,
  formatearRut,
  type ContratoCalculo,
  type IndicadoresPeriodo,
  type ResultadoLiquidacion,
} from '@suite/core'
import { Boton, Campo, Entrada, Selector, Tarjeta } from '@suite/ui'
import { emitirLiquidacion } from '../app/liquidaciones/acciones'
import { AFP_NOMBRE, etiquetaMes } from '../app/liquidaciones/estados'
import type { EstadoForm } from '../app/tipos'

export interface TrabajadorGenerar {
  trabajador_id: string
  nombre: string
  rut: string
  cargo: string
  contrato: ContratoCalculo
}

export interface IndicadorGenerar {
  periodo: string
  datos: IndicadoresPeriodo
}

function Linea({ concepto, monto, fuerte }: { concepto: string; monto: number; fuerte?: boolean }) {
  return (
    <div
      className={
        fuerte
          ? 'mt-1 flex justify-between gap-2 border-t border-slate-200 py-1 text-sm font-semibold'
          : 'flex justify-between gap-2 py-0.5 text-sm'
      }
    >
      <span>{concepto}</span>
      <span className="font-mono">{formatearCLP(monto)}</span>
    </div>
  )
}

export function FormularioLiquidacion({
  trabajadores,
  indicadores,
}: {
  trabajadores: TrabajadorGenerar[]
  indicadores: IndicadorGenerar[]
}) {
  // La página generar garantiza arrays NO vacíos (early returns): los ! son
  // seguros bajo noUncheckedIndexedAccess.
  const [trabajadorId, setTrabajadorId] = useState(trabajadores[0]!.trabajador_id)
  const [periodo, setPeriodo] = useState(indicadores[0]!.periodo)
  const [dias, setDias] = useState('30')
  const [extras, setExtras] = useState('0')
  const [noImponibles, setNoImponibles] = useState('0')
  const [resultado, enviar, pendiente] = useActionState(emitirLiquidacion, {} as EstadoForm)

  const trabajador = trabajadores.find((t) => t.trabajador_id === trabajadorId) ?? trabajadores[0]!
  const indicador = indicadores.find((i) => i.periodo === periodo) ?? indicadores[0]!

  // La vista previa clampa igual que la action (vacío/NaN no rompe el cálculo);
  // el servidor re-valida estricto y la RPC recalcula TODO (spec §3).
  const entradas = {
    dias_trabajados: Math.min(30, Math.max(1, Math.trunc(Number(dias)) || 30)),
    extras_imponibles: Math.max(0, Math.trunc(Number(extras)) || 0),
    no_imponibles: Math.max(0, Math.trunc(Number(noImponibles)) || 0),
  }
  const tasaAfp = indicador.datos.tasas_afp[trabajador.contrato.afp]
  // El espejo LANZA con líquido negativo (mismo guard byte-exacto que la RPC,
  // Global Constraints): acá se captura y se muestra como aviso — la vista
  // previa jamás rompe el render.
  let previa: ResultadoLiquidacion | null = null
  let aviso: string | null = null
  if (tasaAfp == null) {
    aviso = `El período no tiene tasa para la AFP ${AFP_NOMBRE[trabajador.contrato.afp] ?? trabajador.contrato.afp}: pide al administrador de la plataforma completar los indicadores.`
  } else {
    try {
      previa = calcularLiquidacion(trabajador.contrato, indicador.datos, entradas)
    } catch (e) {
      aviso = e instanceof Error ? e.message : 'No se pudo calcular la vista previa'
    }
  }

  return (
    <form action={enviar} className="grid max-w-5xl gap-6 md:grid-cols-2">
      <Tarjeta className="grid gap-4 self-start">
        <Campo etiqueta="Trabajador">
          <Selector name="trabajador_id" value={trabajadorId} onChange={(e) => setTrabajadorId(e.target.value)}>
            {trabajadores.map((t) => (
              <option key={t.trabajador_id} value={t.trabajador_id}>
                {t.nombre} — {formatearRut(t.rut)}
              </option>
            ))}
          </Selector>
        </Campo>
        <Campo etiqueta="Período">
          <Selector name="periodo" value={periodo} onChange={(e) => setPeriodo(e.target.value)}>
            {indicadores.map((i) => (
              <option key={i.periodo} value={i.periodo}>{etiquetaMes(i.periodo)}</option>
            ))}
          </Selector>
        </Campo>
        <Campo etiqueta="Días trabajados (1 a 30)">
          <Entrada name="dias" type="number" min={1} max={30} step={1} required value={dias} onChange={(e) => setDias(e.target.value)} />
        </Campo>
        <Campo etiqueta="Extras imponibles (CLP)">
          <Entrada name="extras" type="number" min={0} step={1} value={extras} onChange={(e) => setExtras(e.target.value)} />
        </Campo>
        <Campo etiqueta="No imponibles: colación y movilización (CLP)">
          <Entrada name="no_imponibles" type="number" min={0} step={1} value={noImponibles} onChange={(e) => setNoImponibles(e.target.value)} />
        </Campo>
        <div className="flex flex-wrap items-center gap-3">
          <Boton type="submit" disabled={pendiente || previa == null}>
            {pendiente ? 'Emitiendo…' : 'Emitir liquidación'}
          </Boton>
          {resultado.error && <span className="text-sm text-red-600">{resultado.error}</span>}
        </div>
      </Tarjeta>

      <Tarjeta>
        <h2 className="mb-1 text-lg font-semibold text-slate-800">Vista previa</h2>
        <p className="mb-3 text-sm text-slate-500">
          {trabajador.nombre} · {trabajador.cargo} · {etiquetaMes(indicador.periodo)}. El cálculo
          definitivo lo hace el servidor al emitir.
        </p>
        {aviso && <p className="text-sm text-amber-700">{aviso}</p>}
        {previa != null && tasaAfp != null && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <h3 className="mb-2 border-b border-slate-200 pb-1 text-sm font-semibold uppercase text-slate-600">Haberes</h3>
              <Linea concepto={`Sueldo base proporcional (${entradas.dias_trabajados} días)`} monto={previa.sueldo_proporcional} />
              <Linea concepto="Gratificación legal" monto={previa.gratificacion} />
              <Linea concepto="Extras imponibles" monto={entradas.extras_imponibles} />
              <Linea concepto="No imponibles" monto={entradas.no_imponibles} />
              <Linea concepto="Total imponible" monto={previa.total_imponible} fuerte />
            </div>
            <div>
              <h3 className="mb-2 border-b border-slate-200 pb-1 text-sm font-semibold uppercase text-slate-600">Descuentos</h3>
              <Linea
                concepto={`AFP ${AFP_NOMBRE[trabajador.contrato.afp] ?? trabajador.contrato.afp} (${tasaAfp.toLocaleString('es-CL')}%)`}
                monto={previa.afp_monto}
              />
              <Linea
                concepto={
                  trabajador.contrato.salud === 'fonasa'
                    ? 'Salud Fonasa (7%)'
                    : `Salud Isapre (plan ${(trabajador.contrato.plan_isapre_uf ?? 0).toLocaleString('es-CL')} UF)`
                }
                monto={previa.salud_monto}
              />
              <Linea concepto="Seguro de cesantía (0,6%)" monto={previa.cesantia_monto} />
              <Linea concepto="Impuesto único" monto={previa.impuesto_unico} />
              <Linea concepto="Total descuentos" monto={previa.total_descuentos} fuerte />
            </div>
            <div className="flex items-center justify-between rounded-md bg-slate-100 px-3 py-2 text-lg font-semibold sm:col-span-2">
              <span>Líquido a pagar</span>
              <span className="font-mono">{formatearCLP(previa.liquido)}</span>
            </div>
          </div>
        )}
      </Tarjeta>
    </form>
  )
}
