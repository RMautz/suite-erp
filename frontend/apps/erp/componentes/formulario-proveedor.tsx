'use client'

import { useActionState } from 'react'
import { Boton, Campo, Entrada, Tarjeta } from '@suite/ui'
import type { EstadoForm } from '../app/tipos'

export interface ProveedorEditable {
  id?: string; rut: string; razon_social: string; giro: string; email: string
  telefono: string; direccion: string; comuna: string; condicion_pago_dias: number
}

const VACIO: ProveedorEditable = { rut: '', razon_social: '', giro: '', email: '', telefono: '', direccion: '', comuna: '', condicion_pago_dias: 0 }

export function FormularioProveedor({
  accion, inicial = VACIO,
}: {
  accion: (prev: EstadoForm, formData: FormData) => Promise<EstadoForm>
  inicial?: ProveedorEditable
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoForm)
  return (
    <Tarjeta className="max-w-2xl">
      <form action={enviar} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {inicial.id && <input type="hidden" name="id" value={inicial.id} />}
        <Campo etiqueta="RUT *"><Entrada name="rut" defaultValue={inicial.rut} placeholder="76.543.210-3" required /></Campo>
        <Campo etiqueta="Razón social *"><Entrada name="razon_social" defaultValue={inicial.razon_social} required /></Campo>
        <Campo etiqueta="Giro"><Entrada name="giro" defaultValue={inicial.giro} /></Campo>
        <Campo etiqueta="Correo"><Entrada name="email" type="email" defaultValue={inicial.email} /></Campo>
        <Campo etiqueta="Teléfono"><Entrada name="telefono" defaultValue={inicial.telefono} /></Campo>
        <Campo etiqueta="Comuna"><Entrada name="comuna" defaultValue={inicial.comuna} /></Campo>
        <div className="sm:col-span-2"><Campo etiqueta="Dirección"><Entrada name="direccion" defaultValue={inicial.direccion} /></Campo></div>
        <Campo etiqueta="Condición de pago (días; 0 = contado)">
          <Entrada name="condicion_pago_dias" inputMode="numeric" defaultValue={inicial.condicion_pago_dias} />
        </Campo>
        <div className="flex items-center justify-end gap-2 sm:col-span-2">
          {estado.error && <span className="mr-auto text-sm text-red-600">{estado.error}</span>}
          <Boton type="submit" disabled={pendiente}>{pendiente ? 'Guardando…' : 'Guardar'}</Boton>
        </div>
      </form>
    </Tarjeta>
  )
}
