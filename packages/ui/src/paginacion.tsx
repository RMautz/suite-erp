import Link from 'next/link'
import { cn } from './cn'

export function Paginacion({
  pagina,
  totalPaginas,
  hrefBase,
}: {
  pagina: number
  totalPaginas: number
  hrefBase: string // ej. "/productos?q=arroz" — se le agrega &pagina=N
}) {
  if (totalPaginas <= 1) return null
  const separador = hrefBase.includes('?') ? '&' : '?'
  const enlace = (n: number) => `${hrefBase}${separador}pagina=${n}`
  const clase = (deshabilitado: boolean) =>
    cn(
      'rounded-md border border-slate-300 px-3 py-1.5 text-sm',
      deshabilitado ? 'pointer-events-none text-slate-300' : 'text-slate-700 hover:bg-slate-50'
    )
  return (
    <nav className="mt-4 flex items-center justify-between">
      <Link href={enlace(pagina - 1)} className={clase(pagina <= 1)} aria-disabled={pagina <= 1}>
        ← Anterior
      </Link>
      <span className="text-sm text-slate-500">
        Página {pagina} de {totalPaginas}
      </span>
      <Link href={enlace(pagina + 1)} className={clase(pagina >= totalPaginas)} aria-disabled={pagina >= totalPaginas}>
        Siguiente →
      </Link>
    </nav>
  )
}
