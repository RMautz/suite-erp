import type { ReactNode } from 'react'

export function Encabezado({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold text-slate-900">{titulo}</h1>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  )
}
