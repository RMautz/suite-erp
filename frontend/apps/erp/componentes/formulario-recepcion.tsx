'use client'

import { useActionState, useState } from 'react'
import { Boton, Campo, Entrada, Selector, Tabla, Tarjeta, Td, Th, Tr } from '@suite/ui'
import type { EstadoForm } from '../app/tipos'

interface BodegaOpcion { id: string; nombre: string }
interface LineaPendiente { id: string; descripcion: string; pendiente: number }

export function FormularioRecepcion({
  accion,
  ordenId,
  bodegas,
  lineas,
}: {
  accion: (prev: EstadoForm, formData: FormData) => Promise<EstadoForm>
  ordenId: string
  bodegas: BodegaOpcion[]
  lineas: LineaPendiente[]
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoForm)
  const [cantidades, setCantidades] = useState<Record<string, number>>(
    Object.fromEntries(lineas.map((l) => [l.id, l.pendiente]))
  )

  function cambiar(id: string, max: number, valor: number) {
    setCantidades((c) => ({ ...c, [id]: Math.min(max, Math.max(0, Math.trunc(valor) || 0)) }))
  }

  const payload = lineas.map((l) => ({ ordenLineaId: l.id, cantidad: cantidades[l.id] ?? 0 }))
  const totalARecibir = payload.reduce((s, l) => s + l.cantidad, 0)

  return (
    <form action={enviar}>
      <input type="hidden" name="orden_id" value={ordenId} />
      <input type="hidden" name="lineas" value={JSON.stringify(payload)} />
      <Tarjeta className="mb-4 max-w-2xl">
        <div className="flex flex-wrap items-end gap-3">
          <Campo etiqueta="Bodega de destino *">
            <Selector name="bodega_id" required defaultValue="">
              <option value="" disabled>Selecciona…</option>
              {bodegas.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
            </Selector>
          </Campo>
          <Campo etiqueta="Notas"><Entrada name="notas" placeholder="Ej: guía de despacho 1234" /></Campo>
        </div>
      </Tarjeta>

      <Tabla>
        <thead><tr><Th>Producto</Th><Th className="text-right">Pendiente</Th><Th className="text-right">Recibir ahora</Th></tr></thead>
        <tbody>
          {lineas.map((l) => (
            <Tr key={l.id}>
              <Td>{l.descripcion}</Td>
              <Td className="text-right font-mono">{l.pendiente}</Td>
              <Td className="text-right">
                <Entrada type="number" min={0} max={l.pendiente} value={cantidades[l.id] ?? 0}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => cambiar(l.id, l.pendiente, Number(e.currentTarget.value))}
                  className="w-24 text-right" />
              </Td>
            </Tr>
          ))}
        </tbody>
      </Tabla>

      <div className="mt-4 flex items-center justify-end gap-2">
        {estado.error && <span className="mr-auto text-sm text-red-600">{estado.error}</span>}
        <Boton type="submit" disabled={pendiente || totalARecibir === 0}>{pendiente ? 'Registrando…' : 'Registrar recepción'}</Boton>
      </div>
    </form>
  )
}
