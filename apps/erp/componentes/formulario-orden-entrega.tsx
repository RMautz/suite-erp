'use client'

import { useActionState, useState } from 'react'
import { formatearCLP, kiloAfecto } from '@suite/core'
import { Boton, Campo, Entrada, Selector, Tarjeta } from '@suite/ui'
import type { EstadoForm } from '../app/tipos'

interface ClienteOpcion { id: string; razon_social: string }
interface DestinoOpcion { id: string; nombre: string; tarifa_kg: number }
interface VehiculoOpcion { id: string; patente: string }
interface ConductorOpcion { id: string; nombre: string }

const HOY = () => new Date().toISOString().slice(0, 10)

export function FormularioOrdenEntrega({
  accion,
  clientes,
  destinos,
  vehiculos,
  conductores,
  factor,
}: {
  accion: (prev: EstadoForm, formData: FormData) => Promise<EstadoForm>
  clientes: ClienteOpcion[]
  destinos: DestinoOpcion[]
  vehiculos: VehiculoOpcion[]
  conductores: ConductorOpcion[]
  factor: number
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoForm)
  const [destinoId, setDestinoId] = useState('')
  const [kilos, setKilos] = useState('')
  const [m3, setM3] = useState('')
  const [netoManual, setNetoManual] = useState(0)
  const [negociado, setNegociado] = useState(false)

  const destino = destinos.find((d) => d.id === destinoId)
  const kilosNum = Number(kilos)
  const m3Num = m3 === '' ? null : Number(m3)
  // Kilo afecto EN VIVO con la misma aritmética de la RPC (kiloAfecto de @suite/core).
  // Solo display: el valor que persiste lo calcula SIEMPRE el servidor.
  const ka = Number.isFinite(kilosNum) && kilosNum > 0 ? kiloAfecto(kilosNum, m3Num, factor) : 0
  const sugerido = destino && ka > 0 ? ka * destino.tarifa_kg : 0
  // Derivado, no efecto: mientras no esté negociado, el input refleja el sugerido en vivo.
  const neto = negociado ? netoManual : sugerido

  return (
    <form action={enviar} className="max-w-3xl">
      <Tarjeta className="mb-4">
        <div className="grid gap-3 md:grid-cols-3">
          <Campo etiqueta="Cliente *">
            <Selector name="cliente_id" required defaultValue="">
              <option value="" disabled>Selecciona…</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>{c.razon_social}</option>
              ))}
            </Selector>
          </Campo>
          <Campo etiqueta="Fecha de ingreso *">
            <Entrada type="date" name="fecha_ingreso" required defaultValue={HOY()} />
          </Campo>
          <Campo etiqueta="Destino *">
            <Selector
              name="destino_id"
              required
              value={destinoId}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => { setDestinoId(e.currentTarget.value); setNegociado(false) }}
            >
              <option value="" disabled>Selecciona…</option>
              {destinos.map((d) => (
                <option key={d.id} value={d.id}>{d.nombre} — {formatearCLP(d.tarifa_kg)}/kg</option>
              ))}
            </Selector>
          </Campo>
          <Campo etiqueta="Docum (guías)">
            <Entrada name="docum" placeholder="Opcional" />
          </Campo>
          <Campo etiqueta="OC del cliente">
            <Entrada name="oc_cliente" placeholder="Opcional" />
          </Campo>
          <Campo etiqueta="Bultos *">
            <Entrada type="number" name="bultos" min={1} step={1} required />
          </Campo>
          <Campo etiqueta="Kilos *">
            <Entrada type="number" name="kilos" min={0.01} step={0.01} required value={kilos} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setKilos(e.currentTarget.value)} />
          </Campo>
          <Campo etiqueta="M3">
            <Entrada type="number" name="m3" min={0} step={0.01} value={m3} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setM3(e.currentTarget.value)} />
          </Campo>
          <Campo etiqueta="Vehículo">
            <Selector name="vehiculo_id" defaultValue="">
              <option value="">Sin asignar</option>
              {vehiculos.map((v) => (
                <option key={v.id} value={v.id}>{v.patente}</option>
              ))}
            </Selector>
          </Campo>
          <Campo etiqueta="Conductor">
            <Selector name="conductor_id" defaultValue="">
              <option value="">Sin asignar</option>
              {conductores.map((c) => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
            </Selector>
          </Campo>
          <Campo etiqueta="Notas">
            <Entrada name="notas" placeholder="Opcional" />
          </Campo>
        </div>
      </Tarjeta>

      <Tarjeta className="mb-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="text-sm">
            Kilo afecto: <strong>{ka > 0 ? ka.toLocaleString('es-CL') : '—'}</strong>
            {destino && <span className="ml-2 text-slate-500">Tarifa {destino.nombre}: {formatearCLP(destino.tarifa_kg)}/kg afecto</span>}
          </div>
          <Campo etiqueta={negociado ? 'Neto (negociado)' : 'Neto (sugerido)'}>
            <Entrada
              type="number"
              name="neto"
              min={1}
              step={1}
              required
              value={neto === 0 ? '' : neto}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                setNetoManual(Math.max(0, Math.trunc(Number(e.currentTarget.value)) || 0))
                setNegociado(true)
              }}
              className="w-36 text-right"
            />
          </Campo>
          {negociado && sugerido > 0 && (
            <Boton variante="secundario" type="button" onClick={() => setNegociado(false)}>
              Usar sugerido ({formatearCLP(sugerido)})
            </Boton>
          )}
        </div>
      </Tarjeta>

      <div className="flex items-center justify-end gap-2">
        {estado.error && <span className="mr-auto text-sm text-red-600">{estado.error}</span>}
        <Boton type="submit" disabled={pendiente}>{pendiente ? 'Guardando…' : 'Registrar orden'}</Boton>
      </div>
    </form>
  )
}
