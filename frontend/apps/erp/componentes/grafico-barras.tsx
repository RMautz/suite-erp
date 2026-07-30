export interface DiaBarra {
  etiqueta: string
  monto: number
  titulo: string
  esHoy?: boolean
}

// Semáforo relativo al promedio de los días CON venta (los ceros no distorsionan la
// media): bueno ≥ 120% del promedio, bajo ≤ 80% (incluido $0), media entre medio.
type Estado = 'bueno' | 'media' | 'bajo'

const BARRA: Record<Estado, string> = {
  bueno: 'block min-h-0.5 rounded-t-sm bg-gradient-to-b from-emerald-400 to-emerald-600',
  media: 'block min-h-0.5 rounded-t-sm bg-gradient-to-b from-marca-400 to-marca-600',
  bajo: 'block min-h-0.5 rounded-t-sm bg-gradient-to-b from-red-400 to-red-600',
}

const ETIQUETA_ESTADO: Record<Estado, string> = {
  bueno: 'sobre el promedio',
  media: 'en la media',
  bajo: 'bajo el promedio',
}

export function GraficoBarras({ dias }: { dias: DiaBarra[] }) {
  const max = Math.max(1, ...dias.map((d) => d.monto))
  const conVenta = dias.filter((d) => d.monto > 0)
  if (conVenta.length === 0) {
    return <p className="py-10 text-center text-sm text-slate-400">Aún sin ventas en los últimos 14 días.</p>
  }
  const promedio = conVenta.reduce((s, d) => s + d.monto, 0) / conVenta.length
  const estadoDe = (monto: number): Estado =>
    monto >= promedio * 1.2 ? 'bueno' : monto <= promedio * 0.8 ? 'bajo' : 'media'
  return (
    <div>
      <div className="flex h-36 items-end gap-1.5">
        {dias.map((d) => {
          const estado = estadoDe(d.monto)
          return (
            <div
              key={d.etiqueta}
              className="flex h-full flex-1 flex-col justify-end"
              title={`${d.titulo} — ${ETIQUETA_ESTADO[estado]}`}
            >
              <span className={BARRA[estado]} style={{ height: `${Math.round((d.monto / max) * 100)}%` }} />
              <span
                className={
                  d.esHoy
                    ? 'mt-1 text-center text-[9px] font-bold tabular-nums text-slate-700'
                    : 'mt-1 text-center text-[9px] tabular-nums text-slate-400'
                }
              >
                {d.etiqueta}
              </span>
            </div>
          )
        })}
      </div>
      <div className="mt-2 flex justify-end gap-4 text-[10px] text-slate-500">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Sobre el promedio</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-marca-500" /> En la media</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-500" /> Bajo el promedio</span>
      </div>
    </div>
  )
}
