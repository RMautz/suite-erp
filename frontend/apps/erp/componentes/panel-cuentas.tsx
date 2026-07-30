'use client'

import { useActionState, useState } from 'react'
import { Boton, Campo, Entrada, Insignia, Selector, Tabla, Tarjeta, Td, Th, Tr } from '@suite/ui'
import type { EstadoCuenta } from '../app/contabilidad/cuentas/acciones'

export interface CuentaFila {
  id: string
  codigo: string
  nombre: string
  tipo: string
  acepta_movimientos: boolean
  clave_sistema: string | null
  activa: boolean
}

const TIPOS = ['activo', 'pasivo', 'patrimonio', 'ingreso', 'gasto'] as const

const TONO_TIPO: Record<string, 'verde' | 'amarillo' | 'rojo' | 'gris'> = {
  activo: 'verde',
  pasivo: 'amarillo',
  patrimonio: 'gris',
  ingreso: 'verde',
  gasto: 'rojo',
}

export function PanelCuentas({
  cuentas,
  accion,
}: {
  cuentas: CuentaFila[]
  accion: (prev: EstadoCuenta, formData: FormData) => Promise<EstadoCuenta>
}) {
  // null = nada abierto; 'nueva' = crear; CuentaFila = editar esa cuenta.
  const [editando, setEditando] = useState<CuentaFila | 'nueva' | null>(null)
  const cuenta = editando === 'nueva' ? null : editando

  return (
    <div>
      <div className="mb-4 flex items-center justify-end">
        <Boton type="button" onClick={() => setEditando(editando === 'nueva' ? null : 'nueva')}>
          {editando === 'nueva' ? 'Cerrar' : 'Nueva cuenta'}
        </Boton>
      </div>

      {editando !== null && (
        <FormularioCuenta key={cuenta?.id ?? 'nueva'} cuenta={cuenta} accion={accion} onCerrar={() => setEditando(null)} />
      )}

      <Tabla>
        <thead><tr><Th>Código</Th><Th>Cuenta</Th><Th>Tipo</Th><Th>Movimientos</Th><Th /></tr></thead>
        <tbody>
          {cuentas.map((c) => {
            const nivel = c.codigo.split('.').length - 1
            return (
              <Tr key={c.id}>
                <Td className="font-mono">{c.codigo}</Td>
                <Td>
                  <span style={{ paddingLeft: nivel * 16 }} className={c.acepta_movimientos ? '' : 'font-semibold text-slate-800'}>
                    {c.nombre}
                  </span>
                  {c.clave_sistema && <span className="ml-2 text-xs text-slate-400">(sistema)</span>}
                  {!c.activa && <span className="ml-2 text-xs text-red-500">(inactiva)</span>}
                </Td>
                <Td><Insignia tono={TONO_TIPO[c.tipo] ?? 'gris'}>{c.tipo}</Insignia></Td>
                <Td>{c.acepta_movimientos ? 'Sí' : '—'}</Td>
                <Td>
                  <Boton variante="secundario" type="button" className="px-2 py-1 text-xs" onClick={() => setEditando(c)}>Editar</Boton>
                </Td>
              </Tr>
            )
          })}
          {cuentas.length === 0 && <Tr><Td colSpan={5} className="py-8 text-center text-slate-500">Sin cuentas todavía.</Td></Tr>}
        </tbody>
      </Tabla>
    </div>
  )
}

function FormularioCuenta({
  cuenta,
  accion,
  onCerrar,
}: {
  cuenta: CuentaFila | null
  accion: (prev: EstadoCuenta, formData: FormData) => Promise<EstadoCuenta>
  onCerrar: () => void
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoCuenta)
  const bloqueada = !!cuenta?.clave_sistema

  return (
    <Tarjeta className="mb-4 max-w-3xl">
      <form action={enviar} className="grid gap-3">
        <input type="hidden" name="id" value={cuenta?.id ?? ''} />
        <div className="flex flex-wrap gap-3">
          <Campo etiqueta="Código *">
            <Entrada name="codigo" required defaultValue={cuenta?.codigo ?? ''} placeholder="1.1.05" className="w-32" />
          </Campo>
          <Campo etiqueta="Nombre *">
            <Entrada name="nombre" required defaultValue={cuenta?.nombre ?? ''} className="w-64" />
          </Campo>
          <Campo etiqueta="Tipo *">
            <Selector name="tipo" defaultValue={cuenta?.tipo ?? 'activo'}>
              {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
            </Selector>
          </Campo>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" name="acepta_movimientos" defaultChecked={cuenta ? cuenta.acepta_movimientos : true} />
          Acepta movimientos (solo las cuentas hoja reciben líneas)
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" name="activa" defaultChecked={cuenta ? cuenta.activa : true} />
          Activa
        </label>
        {bloqueada && (
          <p className="text-xs text-slate-500">
            Es una cuenta del sistema: solo puedes cambiar su código y su nombre; cualquier otro cambio será rechazado.
          </p>
        )}
        <div className="flex items-center justify-end gap-2">
          {estado.error && <span className="mr-auto text-sm text-red-600">{estado.error}</span>}
          {estado.ok && <span className="mr-auto text-sm text-green-700">Cuenta guardada.</span>}
          <Boton variante="secundario" type="button" onClick={onCerrar}>Cerrar</Boton>
          <Boton type="submit" disabled={pendiente}>{pendiente ? 'Guardando…' : 'Guardar cuenta'}</Boton>
        </div>
      </form>
    </Tarjeta>
  )
}
