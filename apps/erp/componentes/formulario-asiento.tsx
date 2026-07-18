'use client'

import { useActionState, useState } from 'react'
import { Boton, Campo, Entrada, Selector, Tabla, Tarjeta, Td, Th, Tr } from '@suite/ui'
import { formatearCLP } from '@suite/core'
import type { EstadoAsiento } from '../app/contabilidad/asientos/acciones'

interface CuentaOpcion { id: string; codigo: string; nombre: string }
interface LineaAsiento { cuentaId: string; glosa: string; debe: number; haber: number }

function hoy(): string {
  return new Date().toISOString().slice(0, 10)
}

const LINEA_VACIA: LineaAsiento = { cuentaId: '', glosa: '', debe: 0, haber: 0 }

export function FormularioAsiento({
  accion,
  cuentas,
}: {
  accion: (prev: EstadoAsiento, formData: FormData) => Promise<EstadoAsiento>
  cuentas: CuentaOpcion[]
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoAsiento)
  const [lineas, setLineas] = useState<LineaAsiento[]>([{ ...LINEA_VACIA }, { ...LINEA_VACIA }])

  function agregar() {
    setLineas((ls) => [...ls, { ...LINEA_VACIA }])
  }
  function quitar(i: number) {
    setLineas((ls) => (ls.length <= 2 ? ls : ls.filter((_, j) => j !== i)))
  }
  function set(i: number, campo: Partial<LineaAsiento>) {
    setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, ...campo } : l)))
  }
  function entero(valor: string): number {
    return Math.max(0, Math.trunc(Number(valor)) || 0)
  }

  const totalDebe = lineas.reduce((s, l) => s + (l.debe || 0), 0)
  const totalHaber = lineas.reduce((s, l) => s + (l.haber || 0), 0)
  const cuadra = totalDebe === totalHaber && totalDebe > 0
  const completas = lineas.every((l) => l.cuentaId !== '' && (l.debe > 0) !== (l.haber > 0))

  return (
    <form action={enviar}>
      <input type="hidden" name="lineas" value={JSON.stringify(lineas)} />
      <Tarjeta className="mb-4 max-w-3xl">
        <div className="flex flex-wrap items-end gap-3">
          <Campo etiqueta="Fecha *"><Entrada type="date" name="fecha" required defaultValue={hoy()} /></Campo>
          <Campo etiqueta="Glosa *"><Entrada name="glosa" required placeholder="Descripción del asiento" className="w-80" /></Campo>
        </div>
      </Tarjeta>

      <Tabla>
        <thead>
          <tr><Th>Cuenta</Th><Th>Glosa</Th><Th className="text-right">Debe</Th><Th className="text-right">Haber</Th><Th /></tr>
        </thead>
        <tbody>
          {lineas.map((l, i) => (
            <Tr key={i}>
              <Td>
                <Selector value={l.cuentaId} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => set(i, { cuentaId: e.currentTarget.value })} className="min-w-[16rem]">
                  <option value="" disabled>Selecciona…</option>
                  {cuentas.map((c) => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
                </Selector>
              </Td>
              <Td>
                <Entrada value={l.glosa} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set(i, { glosa: e.currentTarget.value })} placeholder="Opcional" />
              </Td>
              <Td className="text-right">
                <Entrada type="number" min={0} value={l.debe} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set(i, { debe: entero(e.currentTarget.value), haber: 0 })} className="w-28 text-right" />
              </Td>
              <Td className="text-right">
                <Entrada type="number" min={0} value={l.haber} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set(i, { haber: entero(e.currentTarget.value), debe: 0 })} className="w-28 text-right" />
              </Td>
              <Td><Boton variante="secundario" type="button" className="px-2 py-1 text-xs" onClick={() => quitar(i)} disabled={lineas.length <= 2}>Quitar</Boton></Td>
            </Tr>
          ))}
        </tbody>
      </Tabla>

      <div className="mt-3 flex items-center justify-between">
        <Boton variante="secundario" type="button" onClick={agregar}>Agregar línea</Boton>
        <div className="flex gap-6 text-sm">
          <span>Debe: <strong className="font-mono">{formatearCLP(totalDebe)}</strong></span>
          <span>Haber: <strong className="font-mono">{formatearCLP(totalHaber)}</strong></span>
          <span className={cuadra ? 'text-green-700' : 'text-red-600'}>
            {cuadra ? 'Cuadrado' : `Descuadre: ${formatearCLP(Math.abs(totalDebe - totalHaber))}`}
          </span>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2">
        {estado.error && <span className="mr-auto text-sm text-red-600">{estado.error}</span>}
        <Boton type="submit" disabled={pendiente || !cuadra || !completas}>{pendiente ? 'Guardando…' : 'Guardar asiento'}</Boton>
      </div>
    </form>
  )
}
