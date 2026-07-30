'use client'

import { useActionState, useState } from 'react'
import { Boton } from '@suite/ui'
import { anularFiniquito, pagarFiniquito } from '../app/trabajadores/[id]/finiquito/acciones'
import type { EstadoForm } from '../app/tipos'

function BotonPagar({ finiquitoId, trabajadorId }: { finiquitoId: string; trabajadorId: string }) {
  const [confirmando, setConfirmando] = useState(false)
  const [estado, enviar, pendiente] = useActionState(pagarFiniquito, {} as EstadoForm)
  if (!confirmando) {
    return <Boton type="button" onClick={() => setConfirmando(true)}>Pagar</Boton>
  }
  return (
    <form action={enviar} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="finiquito_id" value={finiquitoId} />
      <input type="hidden" name="trabajador_id" value={trabajadorId} />
      <span className="text-sm text-slate-600">¿Marcar el finiquito como pagado?</span>
      <Boton type="submit" disabled={pendiente}>{pendiente ? '…' : 'Confirmar pago'}</Boton>
      <Boton variante="secundario" type="button" onClick={() => setConfirmando(false)}>Cancelar</Boton>
      {estado.error && <span className="w-full text-sm text-red-600">{estado.error}</span>}
    </form>
  )
}

function FormularioAnular({ finiquitoId, trabajadorId }: { finiquitoId: string; trabajadorId: string }) {
  const [abierto, setAbierto] = useState(false)
  const [estado, enviar, pendiente] = useActionState(anularFiniquito, {} as EstadoForm)
  if (!abierto) {
    return <Boton variante="peligro" type="button" onClick={() => setAbierto(true)}>Anular</Boton>
  }
  return (
    <form action={enviar} className="grid w-full max-w-md gap-2">
      <input type="hidden" name="finiquito_id" value={finiquitoId} />
      <input type="hidden" name="trabajador_id" value={trabajadorId} />
      {/* textarea plano con las clases de control de @suite/ui (no hay AreaTexto). */}
      <textarea
        name="motivo"
        required
        rows={3}
        placeholder="Motivo de la anulación *"
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-marca-500 focus:outline-none focus:ring-1 focus:ring-marca-500"
      />
      <p className="text-sm text-slate-600">
        Se anulará el finiquito, se creará la reversa de su asiento y se REACTIVARÁN el contrato y
        el trabajador. Después podrás volver a emitir el finiquito.
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

export function AccionesFiniquito({
  finiquitoId,
  trabajadorId,
  estado,
}: {
  finiquitoId: string
  trabajadorId: string
  estado: string
}) {
  // emitido → Pagar + Anular; pagado → Anular (spec §3: anula emitido O pagado).
  if (estado !== 'emitido' && estado !== 'pagado') return null
  return (
    <div className="flex flex-wrap items-start gap-3">
      {estado === 'emitido' && <BotonPagar finiquitoId={finiquitoId} trabajadorId={trabajadorId} />}
      <FormularioAnular finiquitoId={finiquitoId} trabajadorId={trabajadorId} />
    </div>
  )
}
