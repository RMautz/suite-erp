'use client'

import { useActionState } from 'react'
import { Boton, Tarjeta } from '@suite/ui'
import type { ResultadoImportTct } from '../app/combustible/importar'

export function FormularioImportTct({
  accion,
}: {
  accion: (prev: ResultadoImportTct, formData: FormData) => Promise<ResultadoImportTct>
}) {
  const [resultado, enviar, pendiente] = useActionState(accion, { importadas: 0, duplicadas: 0, errores: [] })
  return (
    <Tarjeta>
      <h2 className="text-lg font-semibold text-slate-900">Importar Consumos Diarios (TCT)</h2>
      <p className="mt-1 text-sm text-slate-600">
        Sube el CSV tal cual se descarga de la plataforma TCT de Copec. Re-importar el mismo
        archivo no duplica: las guías ya registradas se cuentan como duplicadas.
      </p>
      <form action={enviar} className="mt-4 flex items-center gap-3">
        <input type="file" name="archivo" accept=".csv,text/csv" required className="text-sm" />
        <Boton type="submit" disabled={pendiente}>
          {pendiente ? 'Importando…' : 'Importar'}
        </Boton>
      </form>
      {resultado.error && <p className="mt-3 text-sm text-red-600">{resultado.error}</p>}
      {resultado.importadas !== undefined && (
        <div className="mt-3 text-sm">
          <p className="text-green-700">{resultado.importadas} carga(s) importada(s).</p>
          {(resultado.duplicadas ?? 0) > 0 && (
            <p className="text-slate-600">{resultado.duplicadas} duplicada(s) omitida(s) (guía ya registrada).</p>
          )}
          {resultado.errores && resultado.errores.length > 0 && (
            <div className="mt-2 rounded-md bg-amber-50 p-3 text-amber-900">
              <p className="font-medium">{resultado.errores.length} fila(s) con errores (no importadas):</p>
              <ul className="mt-1 list-inside list-disc">
                {resultado.errores.slice(0, 20).map((e) => (
                  <li key={e.fila}>
                    Fila {e.fila}: {e.motivo}
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
