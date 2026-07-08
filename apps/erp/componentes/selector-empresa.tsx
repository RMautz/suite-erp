'use client'

import { Selector } from '@suite/ui'
import type { EmpresaResumen } from '../lib/empresa-activa'

export function SelectorEmpresa({
  empresas,
  activaId,
  accion,
}: {
  empresas: EmpresaResumen[]
  activaId: string
  accion: (formData: FormData) => Promise<void>
}) {
  if (empresas.length <= 1) return null
  return (
    <form action={accion}>
      <Selector
        name="empresa_id"
        defaultValue={activaId}
        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => e.currentTarget.form?.requestSubmit()}
        className="border-marca-700 bg-marca-900 text-white"
        aria-label="Empresa activa"
      >
        {empresas.map((e) => (
          <option key={e.id} value={e.id}>
            {e.razon_social}
          </option>
        ))}
      </Selector>
    </form>
  )
}
