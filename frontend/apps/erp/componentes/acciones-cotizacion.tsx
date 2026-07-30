'use client'

import { useActionState, useState } from 'react'
import { Boton, Entrada } from '@suite/ui'
import { cambiarEstadoCotizacion, convertirCotizacion } from '../app/cotizaciones/acciones'
import type { EstadoForm } from '../app/tipos'

function BotonEstado({
  cotizacionId,
  estado,
  etiqueta,
  deshabilitado,
  leyenda,
}: {
  cotizacionId: string
  estado: 'enviada' | 'aceptada'
  etiqueta: string
  deshabilitado?: boolean
  leyenda?: string
}) {
  const [resultado, enviar, pendiente] = useActionState(cambiarEstadoCotizacion, {} as EstadoForm)
  return (
    <form action={enviar} className="flex items-center gap-2">
      <input type="hidden" name="cotizacion_id" value={cotizacionId} />
      <input type="hidden" name="estado" value={estado} />
      <Boton type="submit" disabled={pendiente || deshabilitado}>{pendiente ? '…' : etiqueta}</Boton>
      {leyenda && <span className="text-xs text-amber-700">{leyenda}</span>}
      {resultado.error && <span className="text-xs text-red-600">{resultado.error}</span>}
    </form>
  )
}

function FormularioRechazo({ cotizacionId }: { cotizacionId: string }) {
  const [abierto, setAbierto] = useState(false)
  const [resultado, enviar, pendiente] = useActionState(cambiarEstadoCotizacion, {} as EstadoForm)
  if (!abierto) {
    return <Boton variante="peligro" type="button" onClick={() => setAbierto(true)}>Rechazar</Boton>
  }
  return (
    <form action={enviar} className="flex items-center gap-2">
      <input type="hidden" name="cotizacion_id" value={cotizacionId} />
      <input type="hidden" name="estado" value="rechazada" />
      <Entrada name="motivo" placeholder="Motivo del rechazo *" required className="w-56 text-xs" />
      <Boton variante="peligro" type="submit" disabled={pendiente} className="px-2 py-1 text-xs">{pendiente ? '…' : 'Confirmar rechazo'}</Boton>
      {resultado.error && <span className="text-xs text-red-600">{resultado.error}</span>}
    </form>
  )
}

function BotonConvertir({ cotizacionId }: { cotizacionId: string }) {
  const [resultado, enviar, pendiente] = useActionState(convertirCotizacion, {} as EstadoForm)
  return (
    <form action={enviar} className="flex items-center gap-2">
      <input type="hidden" name="cotizacion_id" value={cotizacionId} />
      <Boton type="submit" disabled={pendiente}>{pendiente ? 'Convirtiendo…' : 'Convertir a venta'}</Boton>
      {resultado.error && <span className="text-xs text-red-600">{resultado.error}</span>}
    </form>
  )
}

export function AccionesCotizacion({
  cotizacionId,
  estado,
  vencida,
}: {
  cotizacionId: string
  estado: string
  vencida: boolean
}) {
  if (estado === 'borrador') {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <BotonEstado cotizacionId={cotizacionId} estado="enviada" etiqueta="Enviar" />
        <FormularioRechazo cotizacionId={cotizacionId} />
      </div>
    )
  }
  if (estado === 'enviada') {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <BotonEstado
          cotizacionId={cotizacionId}
          estado="aceptada"
          etiqueta="Aceptar"
          deshabilitado={vencida}
          leyenda={vencida ? 'Vencida: no se puede aceptar' : undefined}
        />
        <FormularioRechazo cotizacionId={cotizacionId} />
      </div>
    )
  }
  if (estado === 'aceptada') {
    return <BotonConvertir cotizacionId={cotizacionId} />
  }
  return null
}
