const MODULOS = [
  {
    titulo: 'Ventas y facturación DTE',
    desc: 'Boletas, facturas y notas de crédito electrónicas con folios SII automáticos.',
    tinte: 'bg-sky-100 stroke-sky-600',
    icono: <path d="M4 6h16M4 12h16M4 18h10" />,
  },
  {
    titulo: 'Inventario multi-bodega',
    desc: 'Stock en tiempo real derivado de un libro de movimientos auditable.',
    tinte: 'bg-cyan-100 stroke-cyan-600',
    icono: <path d="M4 7l8-4 8 4v10l-8 4-8-4zM12 3v18M4 7l8 4 8-4" />,
  },
  {
    titulo: 'Compras',
    desc: 'Órdenes de compra y recepciones que suman stock con costo trazado.',
    tinte: 'bg-amber-100 stroke-amber-600',
    icono: <path d="M6 6h15l-2 8H8zM6 6L5 3H2M9 20a1 1 0 100-2 1 1 0 000 2zM17 20a1 1 0 100-2 1 1 0 000 2z" />,
  },
  {
    titulo: 'Cobranza',
    desc: 'Pagos multi-factura, saldos al día y alertas de documentos vencidos.',
    tinte: 'bg-emerald-100 stroke-emerald-600',
    icono: <path d="M12 8v8m-4-4h8M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />,
  },
  {
    titulo: 'Reportes SII',
    desc: 'Libro de ventas, ventas por período y valorización — exportables a Excel.',
    tinte: 'bg-violet-100 stroke-violet-600',
    icono: <path d="M4 20V10m6 10V4m6 16v-7m4 7H2" />,
  },
  {
    titulo: 'Multi-empresa',
    desc: 'Varias empresas bajo una organización, con roles por usuario.',
    tinte: 'bg-rose-100 stroke-rose-600',
    icono: (
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
    ),
  },
]

export function Modulos() {
  return (
    <section id="modulos" className="border-t border-slate-100 px-6 py-12 sm:px-10">
      <h2 className="text-xl font-bold text-slate-900">Todo lo que tu pyme necesita para operar</h2>
      <p className="mt-1 text-slate-600">Seis módulos integrados que comparten los mismos datos — nada de sistemas parchados.</p>
      <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {MODULOS.map((m) => (
          <div key={m.titulo} className="rounded-xl border border-slate-200 p-5 transition-colors hover:border-marca-300">
            <div className={`mb-3 grid h-10 w-10 place-items-center rounded-lg ${m.tinte}`}>
              <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none" strokeWidth={1.9}>
                {m.icono}
              </svg>
            </div>
            <h3 className="font-semibold text-slate-900">{m.titulo}</h3>
            <p className="mt-1 text-sm text-slate-600">{m.desc}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
