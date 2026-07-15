import Link from 'next/link'
import { Encabezado, Tarjeta } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'

const SECCIONES = [
  { href: '/reportes/libro-ventas', titulo: 'Libro de ventas', desc: 'Formato SII por mes, con export CSV' },
  { href: '/reportes/libro-compras', titulo: 'Libro de compras', desc: 'Formato SII por mes, con IVA crédito y export CSV' },
  { href: '/reportes/ventas', titulo: 'Ventas por período', desc: 'Por día y top de productos' },
  { href: '/reportes/valorizacion', titulo: 'Valorización de inventario', desc: 'Stock a último costo de compra' },
]

export default async function IndiceReportes() {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  return (
    <div>
      <Encabezado titulo="Reportes" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {SECCIONES.map((s) => (
          <Link key={s.href} href={s.href}>
            <Tarjeta className="hover:border-marca-400">
              <p className="text-lg font-semibold text-slate-900">{s.titulo}</p>
              <p className="mt-1 text-sm text-slate-500">{s.desc}</p>
            </Tarjeta>
          </Link>
        ))}
      </div>
    </div>
  )
}
