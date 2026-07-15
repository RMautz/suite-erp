export interface DiaBarra {
  etiqueta: string
  monto: number
  titulo: string
  esHoy?: boolean
}

export function GraficoBarras({ dias }: { dias: DiaBarra[] }) {
  const max = Math.max(1, ...dias.map((d) => d.monto))
  const hayVentas = dias.some((d) => d.monto > 0)
  if (!hayVentas) {
    return <p className="py-10 text-center text-sm text-slate-400">Aún sin ventas en los últimos 14 días.</p>
  }
  return (
    <div className="flex h-36 items-end gap-1.5">
      {dias.map((d) => (
        <div key={d.etiqueta} className="flex h-full flex-1 flex-col justify-end" title={d.titulo}>
          <span
            className={
              d.esHoy
                ? 'block min-h-0.5 rounded-t-sm bg-gradient-to-b from-emerald-400 to-emerald-600'
                : 'block min-h-0.5 rounded-t-sm bg-gradient-to-b from-marca-400 to-marca-600'
            }
            style={{ height: `${Math.round((d.monto / max) * 100)}%` }}
          />
          <span className="mt-1 text-center text-[9px] tabular-nums text-slate-400">{d.etiqueta}</span>
        </div>
      ))}
    </div>
  )
}
