import Link from 'next/link'

// Clases ESTATICAS por tono (Tailwind no soporta nombres interpolados).
const TONOS = {
  marca: { borde: 'border-l-marca-500', cifra: 'text-slate-900' },
  verde: { borde: 'border-l-emerald-500', cifra: 'text-emerald-600' },
  rojo: { borde: 'border-l-red-500', cifra: 'text-red-600' },
  ambar: { borde: 'border-l-amber-500', cifra: 'text-amber-600' },
} as const

export function Kpi({
  etiqueta,
  valor,
  sub,
  tono,
  href,
}: {
  etiqueta: string
  valor: string
  sub: string
  tono: keyof typeof TONOS
  href?: string
}) {
  const t = TONOS[tono]
  const tarjeta = (
    <div className={`rounded-xl border border-slate-200 border-l-4 bg-white px-4 py-3 ${t.borde}`}>
      <p className="text-xs text-slate-400">{etiqueta}</p>
      <p className={`text-2xl font-bold tabular-nums tracking-tight ${t.cifra}`}>{valor}</p>
      <p className="text-xs text-slate-500">{sub}</p>
    </div>
  )
  return href ? <Link href={href}>{tarjeta}</Link> : tarjeta
}
