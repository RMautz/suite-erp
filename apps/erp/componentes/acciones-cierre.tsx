'use client'

import { useActionState, useState } from 'react'
import { Boton } from '@suite/ui'
import type { EstadoCierre } from '../app/contabilidad/revision/acciones'

type AccionCierre = (prev: EstadoCierre, formData: FormData) => Promise<EstadoCierre>

function Mensajes({ estado }: { estado: EstadoCierre }) {
  return (
    <>
      {estado.error && <span className="w-full text-sm text-red-600">{estado.error}</span>}
      {estado.exito && <span className="w-full text-sm text-green-700">{estado.exito}</span>}
    </>
  )
}

export function BotonAprobarCierre({ anio, accion }: { anio: number; accion: AccionCierre }) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoCierre)
  return (
    <form action={enviar} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="anio" value={anio} />
      <Boton type="submit" disabled={pendiente}>
        {pendiente ? 'Cerrando…' : 'Aprobar cierre'}
      </Boton>
      <Mensajes estado={estado} />
    </form>
  )
}

// Confirmación destructiva en dos pasos (patrón BotonRevertir).
export function BotonReabrirEjercicio({ anio, accion }: { anio: number; accion: AccionCierre }) {
  const [abierto, setAbierto] = useState(false)
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoCierre)
  if (!abierto) {
    return (
      <Boton variante="secundario" type="button" className="px-2 py-1 text-xs" onClick={() => setAbierto(true)}>
        Reabrir
      </Boton>
    )
  }
  return (
    <form action={enviar} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="anio" value={anio} />
      <span className="text-xs text-slate-600">¿Reabrir {anio}? Se revierte el asiento de cierre.</span>
      <Boton variante="peligro" type="submit" disabled={pendiente} className="px-2 py-1 text-xs">
        {pendiente ? '…' : 'Confirmar'}
      </Boton>
      <Boton variante="secundario" type="button" className="px-2 py-1 text-xs" onClick={() => setAbierto(false)}>
        Cancelar
      </Boton>
      <Mensajes estado={estado} />
    </form>
  )
}
