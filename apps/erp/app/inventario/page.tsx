import Link from 'next/link'
import { Encabezado, Tarjeta } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'

const SECCIONES = [
  { href: '/inventario/movimientos', titulo: 'Movimientos', desc: 'Entradas, ajustes y traslados de stock' },
  { href: '/inventario/bodegas', titulo: 'Bodegas', desc: 'Administra tus bodegas' },
  { href: '/inventario/proveedores', titulo: 'Proveedores', desc: 'Cartera de proveedores' },
]

export default async function IndiceInventario() {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  return (
    <div>
      <Encabezado titulo="Inventario" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
