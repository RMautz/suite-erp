import Link from 'next/link'

// Precios estáticos: la fuente de verdad es la tabla `planes` (Básico/Pro/Empresa).
// Se actualizan a mano hasta que exista un admin de planes (leerlos aquí requeriría grant a anon).
const PLANES = [
  {
    nombre: 'Básico',
    precio: '$29.990',
    destacado: false,
    bullets: ['1 empresa', 'Ventas y facturación DTE', 'Inventario y compras', '3 usuarios'],
  },
  {
    nombre: 'Pro',
    precio: '$49.990',
    destacado: true,
    bullets: ['Hasta 3 empresas', 'Todo lo del plan Básico', 'Cobranza y reportes SII', '10 usuarios'],
  },
  {
    nombre: 'Empresa',
    precio: '$89.990',
    destacado: false,
    bullets: ['Empresas ilimitadas', 'Todo lo del plan Pro', 'Soporte prioritario', 'Usuarios ilimitados'],
  },
]

export function Precios() {
  return (
    <section id="precios" className="border-t border-slate-100 px-6 py-12 sm:px-10">
      <h2 className="text-xl font-bold text-slate-900">Precios simples, en pesos chilenos</h2>
      <p className="mt-1 text-slate-600">14 días de prueba en cualquier plan. Sin costos de implementación.</p>
      <div className="mt-8 grid items-stretch gap-4 lg:grid-cols-3">
        {PLANES.map((p) => (
          <div
            key={p.nombre}
            className={
              p.destacado
                ? 'relative flex flex-col rounded-2xl border-2 border-marca-600 bg-gradient-to-b from-marca-50 to-white p-6 shadow-xl shadow-marca-600/15'
                : 'flex flex-col rounded-2xl border border-slate-200 p-6'
            }
          >
            {p.destacado && (
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-br from-marca-500 to-marca-600 px-3 py-0.5 text-xs font-medium tracking-wide text-white">
                Más elegido
              </span>
            )}
            <h3 className="font-semibold text-slate-900">{p.nombre}</h3>
            <p className="mt-2 text-3xl font-bold tabular-nums text-slate-900">
              {p.precio} <span className="text-sm font-normal text-slate-400">/ mes + IVA</span>
            </p>
            <ul className="mt-4 flex-1 space-y-2 text-sm text-slate-600">
              {p.bullets.map((b) => (
                <li key={b}>
                  <span className="mr-2 font-bold text-emerald-600">✓</span>
                  {b}
                </li>
              ))}
            </ul>
            <Link
              href="/registro"
              className={
                p.destacado
                  ? 'mt-6 rounded-lg bg-gradient-to-br from-marca-500 to-marca-600 px-4 py-2.5 text-center font-semibold text-white shadow-lg shadow-marca-600/30'
                  : 'mt-6 rounded-lg border-2 border-marca-300 px-4 py-2.5 text-center font-semibold text-marca-700'
              }
            >
              Comenzar
            </Link>
          </div>
        ))}
      </div>
    </section>
  )
}
