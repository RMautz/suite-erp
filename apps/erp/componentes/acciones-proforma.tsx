'use client'

import Link from 'next/link'
import { useActionState, useState } from 'react'
import { Boton, Entrada } from '@suite/ui'
import { anularEstadoPago, cambiarEstadoProforma, facturarProforma } from '../app/proformas/acciones'
import type { EstadoForm } from '../app/tipos'

function BotonEstado({
  proformaId,
  estado,
  etiqueta,
}: {
  proformaId: string
  estado: 'enviada' | 'aprobada'
  etiqueta: string
}) {
  const [resultado, enviar, pendiente] = useActionState(cambiarEstadoProforma, {} as EstadoForm)
  return (
    <form action={enviar} className="flex items-center gap-2">
      <input type="hidden" name="proforma_id" value={proformaId} />
      <input type="hidden" name="estado" value={estado} />
      <Boton type="submit" disabled={pendiente}>{pendiente ? '…' : etiqueta}</Boton>
      {resultado.error && <span className="text-xs text-red-600">{resultado.error}</span>}
    </form>
  )
}

function FormularioRechazo({ proformaId }: { proformaId: string }) {
  const [abierto, setAbierto] = useState(false)
  const [resultado, enviar, pendiente] = useActionState(cambiarEstadoProforma, {} as EstadoForm)
  if (!abierto) {
    return <Boton variante="peligro" type="button" onClick={() => setAbierto(true)}>Rechazar</Boton>
  }
  return (
    <form action={enviar} className="flex items-center gap-2">
      <input type="hidden" name="proforma_id" value={proformaId} />
      <input type="hidden" name="estado" value="rechazada" />
      <Entrada name="motivo" placeholder="Motivo del rechazo *" required className="w-56 text-xs" />
      <Boton variante="peligro" type="submit" disabled={pendiente} className="px-2 py-1 text-xs">{pendiente ? '…' : 'Confirmar rechazo'}</Boton>
      {resultado.error && <span className="text-xs text-red-600">{resultado.error}</span>}
    </form>
  )
}

function BotonFacturar({ proformaId }: { proformaId: string }) {
  const [resultado, enviar, pendiente] = useActionState(facturarProforma, {} as EstadoForm)
  return (
    <form action={enviar} className="flex items-center gap-2">
      <input type="hidden" name="proforma_id" value={proformaId} />
      <Boton type="submit" disabled={pendiente}>{pendiente ? 'Facturando…' : 'Facturar'}</Boton>
      {resultado.error && <span className="text-xs text-red-600">{resultado.error}</span>}
    </form>
  )
}

function BotonDeshacer({ proformaId, documentoId }: { proformaId: string; documentoId: string }) {
  const [resultado, enviar, pendiente] = useActionState(anularEstadoPago, {} as EstadoForm)
  return (
    <form action={enviar} className="flex items-center gap-2">
      <input type="hidden" name="documento_id" value={documentoId} />
      <input type="hidden" name="proforma_id" value={proformaId} />
      <Boton variante="peligro" type="submit" disabled={pendiente}>{pendiente ? '…' : 'Deshacer estado de pago'}</Boton>
      {resultado.error && <span className="text-xs text-red-600">{resultado.error}</span>}
    </form>
  )
}

export function AccionesProforma({
  proformaId,
  estado,
  documentoVentaId,
  puedeDeshacer,
}: {
  proformaId: string
  estado: string
  documentoVentaId: string | null
  // Calculado en el server con la condición EXACTA de anular_estado_pago (tipo+estado+folio).
  puedeDeshacer: boolean
}) {
  if (estado === 'borrador') {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <BotonEstado proformaId={proformaId} estado="enviada" etiqueta="Enviar" />
        <FormularioRechazo proformaId={proformaId} />
      </div>
    )
  }
  if (estado === 'enviada') {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <BotonEstado proformaId={proformaId} estado="aprobada" etiqueta="Aprobar" />
        <FormularioRechazo proformaId={proformaId} />
      </div>
    )
  }
  if (estado === 'aprobada') {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <BotonFacturar proformaId={proformaId} />
        <FormularioRechazo proformaId={proformaId} />
      </div>
    )
  }
  if (estado === 'facturada' && documentoVentaId) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/ventas/${documentoVentaId}`}>
          <Boton variante="secundario" type="button">Ver documento de venta</Boton>
        </Link>
        {puedeDeshacer && (
          <BotonDeshacer proformaId={proformaId} documentoId={documentoVentaId} />
        )}
      </div>
    )
  }
  return null
}
