import Link from 'next/link'

// Maqueta decorativa del dashboard (estática, aria-hidden): 3 mini-KPIs + barras.
const BARRAS = [34, 52, 41, 66, 48, 78, 59, 88]

export function Hero() {
  return (
    <section
      className="grid items-center gap-10 px-6 pb-12 pt-14 sm:px-10 lg:grid-cols-[1.15fr_1fr]"
      style={{ background: 'radial-gradient(900px 420px at 85% -10%, #e0f2fe 0%, rgba(224,242,254,0) 60%)' }}
    >
      <div>
        <h1 className="text-3xl font-bold leading-tight tracking-tight text-slate-900 sm:text-4xl" style={{ textWrap: 'balance' }}>
          El ERP para pymes chilenas: ventas,{' '}
          <em className="bg-gradient-to-r from-marca-600 to-cyan-500 bg-clip-text not-italic text-transparent">
            facturación SII
          </em>{' '}
          e inventario en un solo lugar
        </h1>
        <p className="mt-4 max-w-xl text-slate-600">
          Emite boletas y facturas electrónicas, controla tu stock en varias bodegas y cobra a tiempo — sin planillas,
          sin instalar nada.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Link
            href="/registro"
            className="rounded-lg bg-gradient-to-br from-marca-500 to-marca-600 px-5 py-2.5 font-semibold text-white shadow-lg shadow-marca-600/30"
          >
            Prueba gratis 14 días
          </Link>
          <a href="#precios" className="rounded-lg border-2 border-marca-300 px-5 py-2.5 font-semibold text-marca-700">
            Ver precios
          </a>
        </div>
        <p className="mt-4 text-sm text-slate-400">Sin tarjeta de crédito · Cancela cuando quieras</p>
      </div>

      <div aria-hidden className="rounded-xl border border-marca-200 bg-marca-50 p-4 shadow-2xl shadow-marca-600/20">
        <div className="mb-3 grid grid-cols-3 gap-2">
          <div className="rounded-lg border border-marca-100 bg-white px-3 py-2">
            <p className="text-[10px] text-slate-400">Ventas del mes</p>
            <p className="text-sm font-bold tabular-nums text-emerald-600">$4.280.500</p>
          </div>
          <div className="rounded-lg border border-marca-100 bg-white px-3 py-2">
            <p className="text-[10px] text-slate-400">Por cobrar</p>
            <p className="text-sm font-bold tabular-nums">$812.300</p>
          </div>
          <div className="rounded-lg border border-marca-100 bg-white px-3 py-2">
            <p className="text-[10px] text-slate-400">Stock crítico</p>
            <p className="text-sm font-bold tabular-nums">3</p>
          </div>
        </div>
        <div className="flex h-20 items-end gap-1.5 rounded-lg border border-marca-100 bg-white px-3 pb-2 pt-3">
          {BARRAS.map((h, i) => (
            <span key={i} className="flex-1 rounded-t-sm bg-gradient-to-b from-cyan-400 to-marca-600" style={{ height: `${h}%` }} />
          ))}
        </div>
      </div>
    </section>
  )
}
