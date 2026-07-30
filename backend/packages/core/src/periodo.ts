// Rango de un mes 'YYYY-MM' en fechas ISO. null si el formato no es válido.
export function rangoDeMes(mes: string): { desde: string; hasta: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(mes)
  if (!m) return null
  const anio = Number(m[1])
  const mm = Number(m[2])
  if (mm < 1 || mm > 12) return null
  const ultimo = new Date(Date.UTC(anio, mm, 0)).getUTCDate()
  const p2 = String(mm).padStart(2, '0')
  return { desde: `${anio}-${p2}-01`, hasta: `${anio}-${p2}-${String(ultimo).padStart(2, '0')}` }
}

// Rango de un período: 'YYYY' (año), 'YYYY-Tn' (trimestre 1-4) o 'YYYY-MM' (mes).
// null si el formato no es válido.
export function rangoDePeriodo(periodo: string): { desde: string; hasta: string } | null {
  if (/^\d{4}$/.test(periodo)) return { desde: `${periodo}-01-01`, hasta: `${periodo}-12-31` }
  const tri = /^(\d{4})-T([1-4])$/.exec(periodo)
  if (tri) {
    const t = Number(tri[2])
    const desde = rangoDeMes(`${tri[1]}-${String(t * 3 - 2).padStart(2, '0')}`)!.desde
    const hasta = rangoDeMes(`${tri[1]}-${String(t * 3).padStart(2, '0')}`)!.hasta
    return { desde, hasta }
  }
  return rangoDeMes(periodo)
}

// Período anterior equivalente: mes → mes anterior, trimestre → trimestre anterior,
// año → año anterior. null si el formato no es válido.
export function periodoAnterior(periodo: string): string | null {
  if (/^\d{4}$/.test(periodo)) return String(Number(periodo) - 1)
  const tri = /^(\d{4})-T([1-4])$/.exec(periodo)
  if (tri) {
    const t = Number(tri[2])
    return t === 1 ? `${Number(tri[1]) - 1}-T4` : `${tri[1]}-T${t - 1}`
  }
  const mes = /^(\d{4})-(\d{2})$/.exec(periodo)
  if (!mes || Number(mes[2]) < 1 || Number(mes[2]) > 12) return null
  const m = Number(mes[2])
  return m === 1 ? `${Number(mes[1]) - 1}-12` : `${mes[1]}-${String(m - 1).padStart(2, '0')}`
}

// Variación % contra el período anterior (spec §4.2): (actual − anterior) /
// |anterior| × 100, redondeada, con signo. '—' sin base de comparación
// (anterior 0: división por cero). Vive acá y no en eerr/calculo.ts para ser
// testeable (calculo.ts es server-only).
export function variacion(actual: number, anterior: number): string {
  if (anterior === 0) return '—'
  const pct = Math.round(((actual - anterior) / Math.abs(anterior)) * 100)
  return `${pct > 0 ? '+' : ''}${pct}%`
}
