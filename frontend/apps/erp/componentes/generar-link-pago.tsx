'use client'

import { useActionState, useState } from 'react'
import { Boton } from '@suite/ui'
import { generarLinkPago } from '../app/pagos-mp/acciones'
import type { EstadoForm } from '../app/tipos'

export function GenerarLinkPago({
  tipo,
  id,
  linkVigente,
}: {
  tipo: 'factura' | 'proforma' | 'cotizacion'
  id: string
  linkVigente: { url: string } | null
}) {
  const [estado, enviar, pendiente] = useActionState(generarLinkPago, {} as EstadoForm)
  const [copiado, setCopiado] = useState(false)
  return (
    <div className="flex flex-col gap-2">
      {linkVigente && (
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={linkVigente.url}
            target="_blank"
            rel="noreferrer"
            className="break-all text-sm text-marca-700 hover:underline"
          >
            {linkVigente.url}
          </a>
          <Boton
            variante="secundario"
            type="button"
            className="px-2 py-1 text-xs"
            onClick={() => {
              navigator.clipboard.writeText(linkVigente.url)
              setCopiado(true)
            }}
          >
            {copiado ? 'Copiado' : 'Copiar'}
          </Boton>
        </div>
      )}
      <form action={enviar} className="flex items-center gap-2">
        <input type="hidden" name="tipo" value={tipo} />
        <input type="hidden" name="id" value={id} />
        <Boton variante={linkVigente ? 'secundario' : 'primario'} type="submit" disabled={pendiente}>
          {pendiente ? 'Generando…' : linkVigente ? 'Regenerar link' : 'Generar link de pago'}
        </Boton>
        {estado.error && <span className="text-xs text-red-600">{estado.error}</span>}
      </form>
    </div>
  )
}
