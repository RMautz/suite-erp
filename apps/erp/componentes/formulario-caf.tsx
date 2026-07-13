'use client'

import { useActionState } from 'react'
import { Boton, Campo, Insignia, Selector, Tarjeta } from '@suite/ui'
import type { EstadoForm } from '../app/tipos'

interface CafItem { tipo_documento: string; desde: number; hasta: number; siguiente: number; activo: boolean }

export function FormularioCAF({
  accion,
  cafs,
}: {
  accion: (prev: EstadoForm, formData: FormData) => Promise<EstadoForm>
  cafs: CafItem[]
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoForm)
  return (
    <Tarjeta className="max-w-2xl">
      <form action={enviar} className="flex flex-wrap items-end gap-3">
        <Campo etiqueta="Tipo">
          <Selector name="tipo_documento" defaultValue="factura">
            <option value="factura">Factura (33)</option>
            <option value="boleta">Boleta (39)</option>
            <option value="nota_credito">Nota de crédito (61)</option>
          </Selector>
        </Campo>
        <Campo etiqueta="Archivo CAF (.xml)">
          <input type="file" name="caf" accept=".xml" required className="text-sm" />
        </Campo>
        <Boton type="submit" disabled={pendiente}>{pendiente ? 'Cargando…' : 'Cargar CAF'}</Boton>
      </form>
      {estado.error && <p className="mt-2 text-sm text-red-600">{estado.error}</p>}
      <ul className="mt-4 space-y-1 text-sm text-slate-700">
        {cafs.map((c, i) => (
          <li key={i}>
            {c.tipo_documento}: folios {c.desde}–{c.hasta} (siguiente: {c.siguiente}){' '}
            {c.activo ? <Insignia tono="verde">Activo</Insignia> : <Insignia tono="gris">Inactivo</Insignia>}
          </li>
        ))}
        {cafs.length === 0 && <li className="text-slate-500">Aún no cargas folios CAF.</li>}
      </ul>
    </Tarjeta>
  )
}
