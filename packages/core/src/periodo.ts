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
