'use client'

import { useActionState, useState } from 'react'
import { formatearCLP } from '@suite/core'
import { Boton, Campo, Entrada, Selector, Tabla, Tarjeta, Td, Th, Tr } from '@suite/ui'
import type { EstadoForm } from '../app/tipos'

interface ClienteOpcion { id: string; razon_social: string }
interface OrdenDisponible {
  id: string
  cliente_id: string
  numero: number
  fecha_ingreso: string
  destino_nombre: string
  bultos: number
  kilos: number
  m3: number | null
  kilo_afecto: number
  neto: number
}

const NUM = (n: number | null) => (n == null ? '—' : n.toLocaleString('es-CL', { maximumFractionDigits: 2 }))

export function FormularioProforma({
  accion,
  clientes,
  ordenes,
}: {
  accion: (prev: EstadoForm, formData: FormData) => Promise<EstadoForm>
  clientes: ClienteOpcion[]
  ordenes: OrdenDisponible[]
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoForm)
  const [clienteId, setClienteId] = useState('')
  const [seleccion, setSeleccion] = useState<string[]>([])

  const disponibles = ordenes.filter((o) => o.cliente_id === clienteId)
  const elegidas = disponibles.filter((o) => seleccion.includes(o.id))
  const bultos = elegidas.reduce((s, o) => s + o.bultos, 0)
  const m3 = elegidas.reduce((s, o) => s + (o.m3 ?? 0), 0)
  const totalKiloAfecto = elegidas.reduce((s, o) => s + o.kilo_afecto, 0)
  const neto = elegidas.reduce((s, o) => s + o.neto, 0)
  const iva = Math.round(neto * 0.19)
  const total = neto + iva

  function alternar(id: string) {
    setSeleccion((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  }

  return (
    <form action={enviar}>
      <input type="hidden" name="ordenes" value={JSON.stringify(seleccion)} />
      <Tarjeta className="mb-4 max-w-3xl">
        <div className="flex flex-wrap items-end gap-3">
          <Campo etiqueta="Cliente *">
            <Selector
              name="cliente_id"
              required
              value={clienteId}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => { setClienteId(e.currentTarget.value); setSeleccion([]) }}
            >
              <option value="" disabled>Selecciona…</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>{c.razon_social}</option>
              ))}
            </Selector>
          </Campo>
          <Campo etiqueta="Notas">
            <Entrada name="notas" placeholder="Opcional" />
          </Campo>
        </div>
      </Tarjeta>

      <Tabla>
        <thead>
          <tr><Th /><Th>N° ODE</Th><Th>Fecha ingreso</Th><Th>Destino</Th><Th className="text-right">Bultos</Th><Th className="text-right">Kilos</Th><Th className="text-right">M3</Th><Th className="text-right">Kilo afecto</Th><Th className="text-right">Neto</Th></tr>
        </thead>
        <tbody>
          {disponibles.map((o) => (
            <Tr key={o.id}>
              <Td><input type="checkbox" checked={seleccion.includes(o.id)} onChange={() => alternar(o.id)} /></Td>
              <Td>{o.numero}</Td>
              <Td>{new Date(o.fecha_ingreso + 'T00:00:00').toLocaleDateString('es-CL')}</Td>
              <Td>{o.destino_nombre}</Td>
              <Td className="text-right">{o.bultos}</Td>
              <Td className="text-right">{NUM(o.kilos)}</Td>
              <Td className="text-right">{NUM(o.m3)}</Td>
              <Td className="text-right">{NUM(o.kilo_afecto)}</Td>
              <Td className="text-right font-mono">{formatearCLP(o.neto)}</Td>
            </Tr>
          ))}
          {disponibles.length === 0 && (
            <Tr><Td colSpan={9} className="py-6 text-center text-slate-500">{clienteId ? 'El cliente no tiene órdenes de entrega libres.' : 'Selecciona un cliente para ver sus órdenes libres.'}</Td></Tr>
          )}
        </tbody>
      </Tabla>

      <div className="mt-4 flex flex-col items-end gap-1 text-sm">
        <div>Bultos: <strong>{bultos}</strong></div>
        <div>M3: <strong>{NUM(m3)}</strong></div>
        <div>Kilo afecto: <strong>{NUM(totalKiloAfecto)}</strong></div>
        <div>Neto: <strong>{formatearCLP(neto)}</strong></div>
        <div>IVA (19%): <strong>{formatearCLP(iva)}</strong></div>
        <div className="text-lg">Total: <strong>{formatearCLP(total)}</strong></div>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2">
        {estado.error && <span className="mr-auto text-sm text-red-600">{estado.error}</span>}
        <Boton type="submit" disabled={pendiente || seleccion.length === 0}>{pendiente ? 'Guardando…' : 'Crear proforma'}</Boton>
      </div>
    </form>
  )
}
