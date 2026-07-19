'use client'

import { useActionState, useState } from 'react'
import { Boton } from '@suite/ui'
import { anularLiquidacion, pagarLiquidacion } from '../app/liquidaciones/acciones'
import type { EstadoForm } from '../app/tipos'

function BotonPagar({ liquidacionId }: { liquidacionId: string }) {
  const [confirmando, setConfirmando] = useState(false)
  const [estado, enviar, pendiente] = useActionState(pagarLiquidacion, {} as EstadoForm)
  if (!confirmando) {
    return <Boton type="button" onClick={() => setConfirmando(true)}>Pagar</Boton>
  }
  return (
    <form action={enviar} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="liquidacion_id" value={liquidacionId} />
      <span className="text-sm text-slate-600">¿Marcar la liquidación como pagada?</span>
      <Boton type="submit" disabled={pendiente}>{pendiente ? '…' : 'Confirmar pago'}</Boton>
      <Boton variante="secundario" type="button" onClick={() => setConfirmando(false)}>Cancelar</Boton>
      {estado.error && <span className="w-full text-sm text-red-600">{estado.error}</span>}
    </form>
  )
}

function FormularioAnular({ liquidacionId }: { liquidacionId: string }) {
  const [abierto, setAbierto] = useState(false)
  const [estado, enviar, pendiente] = useActionState(anularLiquidacion, {} as EstadoForm)
  if (!abierto) {
    return <Boton variante="peligro" type="button" onClick={() => setAbierto(true)}>Anular</Boton>
  }
  return (
    <form action={enviar} className="grid w-full max-w-md gap-2">
      <input type="hidden" name="liquidacion_id" value={liquidacionId} />
      {/* textarea plano con las clases de control de @suite/ui (no hay AreaTexto). */}
      <textarea
        name="motivo"
        required
        rows={3}
        placeholder="Motivo de la anulación *"
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-marca-500 focus:outline-none focus:ring-1 focus:ring-marca-500"
      />
      <p className="text-sm text-slate-600">
        Se anulará la liquidación y, si tenía asiento, se creará su reversa contable. Después
        podrás volver a emitir el período.
      </p>
      <div className="flex items-center gap-2">
        <Boton variante="peligro" type="submit" disabled={pendiente}>
          {pendiente ? 'Anulando…' : 'Confirmar anulación'}
        </Boton>
        <Boton variante="secundario" type="button" onClick={() => setAbierto(false)}>Cancelar</Boton>
      </div>
      {estado.error && <span className="text-sm text-red-600">{estado.error}</span>}
    </form>
  )
}

export function AccionesLiquidacion({ liquidacionId, estado }: { liquidacionId: string; estado: string }) {
  // emitida → Pagar + Anular; pagada → Anular; anulada/otros → nada (el detalle
  // muestra el aviso de re-emisión).
  if (estado !== 'emitida' && estado !== 'pagada') return null
  return (
    <div className="flex flex-wrap items-start gap-3">
      {estado === 'emitida' && <BotonPagar liquidacionId={liquidacionId} />}
      <FormularioAnular liquidacionId={liquidacionId} />
    </div>
  )
}
