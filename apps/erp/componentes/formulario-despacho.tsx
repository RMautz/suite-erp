'use client'

import { useActionState, useState } from 'react'
import { Boton, Selector } from '@suite/ui'
import { asignarDespacho } from '../app/entregas/acciones'
import type { EstadoForm } from '../app/tipos'

interface VehiculoOpcion { id: string; patente: string }
interface ConductorOpcion { id: string; nombre: string }

export function FormularioDespacho({
  ordenId,
  vehiculoId,
  conductorId,
  actual,
  vehiculos,
  conductores,
}: {
  ordenId: string
  vehiculoId: string | null
  conductorId: string | null
  // Etiqueta del despacho vigente (patente o conductor), resuelta por la página vía embed
  // — cubre vehículos/conductores hoy inactivos que las listas de opciones ya no traen.
  actual: string | null
  vehiculos: VehiculoOpcion[]
  conductores: ConductorOpcion[]
}) {
  const [abierto, setAbierto] = useState(false)
  const [estado, enviar, pendiente] = useActionState(asignarDespacho, {} as EstadoForm)
  if (!abierto) {
    return (
      <Boton variante="secundario" type="button" className="px-2 py-1 text-xs" onClick={() => setAbierto(true)}>
        {actual ?? 'Despacho'}
      </Boton>
    )
  }
  return (
    <form action={enviar} className="flex items-center gap-1">
      <input type="hidden" name="orden_id" value={ordenId} />
      <Selector name="vehiculo_id" defaultValue={vehiculoId ?? ''} className="w-32 text-xs">
        <option value="">Sin vehículo</option>
        {vehiculos.map((v) => (
          <option key={v.id} value={v.id}>{v.patente}</option>
        ))}
      </Selector>
      <Selector name="conductor_id" defaultValue={conductorId ?? ''} className="w-32 text-xs">
        <option value="">Sin conductor</option>
        {conductores.map((c) => (
          <option key={c.id} value={c.id}>{c.nombre}</option>
        ))}
      </Selector>
      <Boton variante="secundario" type="submit" disabled={pendiente} className="px-2 py-1 text-xs">{pendiente ? '…' : 'Asignar'}</Boton>
      {estado.error && <span className="text-xs text-red-600">{estado.error}</span>}
    </form>
  )
}
