import Link from 'next/link'
import { Encabezado, Tarjeta } from '@suite/ui'

export default function PaginaConfiguracion() {
  return (
    <div>
      <Encabezado titulo="Configuración" />
      <div className="grid max-w-3xl grid-cols-1 gap-4 sm:grid-cols-2">
        <Link href="/configuracion/dte" className="block">
          <Tarjeta className="h-full transition hover:border-marca-500">
            <h2 className="mb-1 text-lg font-semibold text-slate-800">Facturación electrónica</h2>
            <p className="text-sm text-slate-600">Datos del emisor, certificado digital y folios CAF.</p>
          </Tarjeta>
        </Link>
        <Link href="/configuracion/modulos" className="block">
          <Tarjeta className="h-full transition hover:border-marca-500">
            <h2 className="mb-1 text-lg font-semibold text-slate-800">Módulos</h2>
            <p className="text-sm text-slate-600">Activa el módulo de transporte y define el factor volumétrico.</p>
          </Tarjeta>
        </Link>
      </div>
    </div>
  )
}
