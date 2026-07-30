'use client'

import { useActionState, useState } from 'react'
import { formatearCLP } from '@suite/core'
import { Boton, Selector } from '@suite/ui'
import type { EstadoForm } from '../app/tipos'

interface FacturaOpcion {
  documentoId: string
  etiqueta: string
  saldo: number
}

export function FormularioAplicarAnticipo({
  anticipoId,
  facturas,
  accion,
}: {
  anticipoId: string
  facturas: FacturaOpcion[]
  accion: (prev: EstadoForm, formData: FormData) => Promise<EstadoForm>
}) {
  const [abierto, setAbierto] = useState(false)
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoForm)
  if (facturas.length === 0) {
    return <span className="text-xs text-slate-400">Sin facturas con saldo</span>
  }
  if (!abierto) {
    return (
      <Boton variante="secundario" type="button" className="px-2 py-1 text-xs" onClick={() => setAbierto(true)}>
        Aplicar
      </Boton>
    )
  }
  return (
    <form action={enviar} className="flex flex-wrap items-center justify-end gap-2">
      <input type="hidden" name="anticipo_id" value={anticipoId} />
      <Selector name="documento_id" required defaultValue="" className="max-w-xs text-xs">
        <option value="" disabled>Factura…</option>
        {facturas.map((f) => (
          <option key={f.documentoId} value={f.documentoId}>
            {f.etiqueta} · {formatearCLP(f.saldo)}
          </option>
        ))}
      </Selector>
      <Boton type="submit" disabled={pendiente} className="px-2 py-1 text-xs">{pendiente ? '…' : 'Confirmar'}</Boton>
      <Boton variante="secundario" type="button" className="px-2 py-1 text-xs" onClick={() => setAbierto(false)}>No</Boton>
      {estado.error && <span className="text-xs text-red-600">{estado.error}</span>}
    </form>
  )
}
