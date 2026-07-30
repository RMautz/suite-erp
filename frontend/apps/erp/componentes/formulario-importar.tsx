'use client'

import { useActionState } from 'react'
import { Boton, Tarjeta } from '@suite/ui'
import type { ResultadoImport } from '../app/tipos'

export function FormularioImportar({
  titulo,
  descripcion,
  plantillaHref,
  accion,
}: {
  titulo: string
  descripcion: string
  plantillaHref: string
  accion: (prev: ResultadoImport, formData: FormData) => Promise<ResultadoImport>
}) {
  const [resultado, enviar, pendiente] = useActionState(accion, {} as ResultadoImport)
  return (
    <Tarjeta>
      <h2 className="text-lg font-semibold text-slate-900">{titulo}</h2>
      <p className="mt-1 text-sm text-slate-600">{descripcion}</p>
      <p className="mt-1 text-sm">
        <a className="text-marca-600 underline" href={plantillaHref} download>
          Descargar plantilla
        </a>{' '}
        <span className="text-slate-500">(complétala en Excel y guárdala como CSV)</span>
      </p>
      <form action={enviar} className="mt-4 flex items-center gap-3">
        <input type="file" name="archivo" accept=".csv,text/csv" required className="text-sm" />
        <Boton type="submit" disabled={pendiente}>
          {pendiente ? 'Importando…' : 'Importar'}
        </Boton>
      </form>
      {resultado.error && <p className="mt-3 text-sm text-red-600">{resultado.error}</p>}
      {resultado.procesadas !== undefined && (
        <div className="mt-3 text-sm">
          <p className="text-green-700">
            {resultado.procesadas} fila(s) importada(s) correctamente.
          </p>
          {resultado.errores && resultado.errores.length > 0 && (
            <div className="mt-2 rounded-md bg-amber-50 p-3 text-amber-900">
              <p className="font-medium">{resultado.errores.length} fila(s) con errores (no importadas):</p>
              <ul className="mt-1 list-inside list-disc">
                {resultado.errores.slice(0, 20).map((e) => (
                  <li key={e.fila}>
                    Fila {e.fila}: {e.mensajes.join('; ')}
                  </li>
                ))}
                {resultado.errores.length > 20 && <li>… y {resultado.errores.length - 20} más</li>}
              </ul>
            </div>
          )}
        </div>
      )}
    </Tarjeta>
  )
}
