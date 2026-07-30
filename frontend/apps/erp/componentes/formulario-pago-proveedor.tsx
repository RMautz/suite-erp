'use client'

import { useActionState, useState } from 'react'
import { Boton, Campo, Entrada, Selector, Tabla, Tarjeta, Td, Th, Tr } from '@suite/ui'
import { cuadraAplicaciones, formatearCLP } from '@suite/core'
import type { EstadoForm } from '../app/tipos'

interface DocumentoConSaldo { documentoId: string; etiqueta: string; saldo: number }

export function FormularioPagoProveedor({
  accion,
  proveedorId,
  documentos,
}: {
  accion: (prev: EstadoForm, formData: FormData) => Promise<EstadoForm>
  proveedorId: string
  documentos: DocumentoConSaldo[]
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoForm)
  const [montos, setMontos] = useState<Record<string, number>>(
    Object.fromEntries(documentos.map((d) => [d.documentoId, Math.max(0, d.saldo)]))
  )
  const [monto, setMonto] = useState(() => documentos.reduce((s, d) => s + Math.max(0, d.saldo), 0))

  function cambiar(id: string, max: number, valor: number) {
    setMontos((m) => ({ ...m, [id]: Math.min(max, Math.max(0, Math.trunc(valor) || 0)) }))
  }

  const aplicaciones = documentos
    .map((d) => ({ documentoId: d.documentoId, monto: montos[d.documentoId] ?? 0 }))
    .filter((a) => a.monto > 0)
  const aplicado = aplicaciones.reduce((s, a) => s + a.monto, 0)
  const cuadra = cuadraAplicaciones(aplicaciones, monto)

  return (
    <form action={enviar}>
      <input type="hidden" name="proveedor_id" value={proveedorId} />
      <input type="hidden" name="aplicaciones" value={JSON.stringify(aplicaciones)} />
      <Tarjeta className="mb-4 max-w-3xl">
        <div className="flex flex-wrap items-end gap-3">
          <Campo etiqueta="Monto del pago *">
            <Entrada name="monto" inputMode="numeric" value={monto}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMonto(Math.max(0, Math.trunc(Number(e.currentTarget.value)) || 0))} />
          </Campo>
          <Campo etiqueta="Método *">
            <Selector name="metodo" required defaultValue="transferencia">
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia</option>
              <option value="tarjeta">Tarjeta</option>
              <option value="cheque">Cheque</option>
              <option value="otro">Otro</option>
            </Selector>
          </Campo>
          <Campo etiqueta="Fecha"><Entrada type="date" name="fecha" /></Campo>
          <Campo etiqueta="Referencia"><Entrada name="referencia" placeholder="N° operación / cheque" /></Campo>
          <Campo etiqueta="Notas"><Entrada name="notas" /></Campo>
        </div>
      </Tarjeta>

      <Tabla>
        <thead><tr><Th>Documento</Th><Th className="text-right">Saldo</Th><Th className="text-right">Aplicar</Th></tr></thead>
        <tbody>
          {documentos.map((d) => (
            <Tr key={d.documentoId}>
              <Td>{d.etiqueta}</Td>
              <Td className="text-right font-mono">{formatearCLP(d.saldo)}</Td>
              <Td className="text-right">
                <Entrada type="number" min={0} max={Math.max(0, d.saldo)} value={montos[d.documentoId] ?? 0}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => cambiar(d.documentoId, Math.max(0, d.saldo), Number(e.currentTarget.value))}
                  className="w-28 text-right" />
              </Td>
            </Tr>
          ))}
        </tbody>
      </Tabla>

      <div className="mt-3 flex items-center justify-end gap-4 text-sm">
        <span>Aplicado: <strong className="font-mono">{formatearCLP(aplicado)}</strong> de <strong className="font-mono">{formatearCLP(monto)}</strong></span>
        {!cuadra && aplicado > 0 && <span className="text-red-600">La suma aplicada debe igualar el monto</span>}
      </div>
      <div className="mt-4 flex items-center justify-end gap-2">
        {estado.error && <span className="mr-auto text-sm text-red-600">{estado.error}</span>}
        <Boton type="submit" disabled={pendiente || monto <= 0 || !cuadra}>{pendiente ? 'Registrando…' : 'Registrar pago'}</Boton>
      </div>
    </form>
  )
}
