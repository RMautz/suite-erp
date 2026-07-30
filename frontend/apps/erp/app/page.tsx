import Link from 'next/link'
import { crearClienteServidor } from '@suite/auth/server'
import { estaVencido, formatearCLP, formatearRut, rangoDeMes } from '@suite/core'
import { Encabezado, Insignia, Tarjeta } from '@suite/ui'
import { GraficoBarras } from '../componentes/grafico-barras'
import { Kpi } from '../componentes/kpi'
import { obtenerEmpresaActiva } from '../lib/empresa-activa'

const RAPIDOS = [
  { href: '/ventas/nueva', titulo: '+ Nueva venta', sub: 'boleta o factura' },
  { href: '/cobranza/pagos/nuevo', titulo: '+ Registrar pago', sub: 'cobranza' },
  { href: '/compras/nueva', titulo: '+ Orden de compra', sub: 'a proveedor' },
  { href: '/inventario/movimientos', titulo: '+ Movimiento', sub: 'entrada / ajuste / traslado' },
]

function fechaUTC(diasAtras: number): string {
  const d = new Date(Date.now() - diasAtras * 24 * 3600 * 1000)
  return d.toISOString().slice(0, 10)
}

export default async function Inicio() {
  const { activa } = await obtenerEmpresaActiva()

  if (!activa) {
    return (
      <main className="grid min-h-[60vh] place-items-center">
        <div className="max-w-md rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">Tu organización aún no tiene empresas</h1>
          <p className="mt-2 text-sm text-slate-500">
            Cuando tu organización registre una empresa vas a ver aquí el panel con sus ventas, stock y cobranza.
          </p>
        </div>
      </main>
    )
  }

  const hoy = fechaUTC(0)
  const hace13 = fechaUTC(13)
  const mes = rangoDeMes(hoy.slice(0, 7))!
  const supabase = await crearClienteServidor()

  const [{ data: organizacion }, { data: dias14 }, { data: diasMes }, { data: topMes }, { data: prods }, { data: stockRows }, { data: saldosRows }] =
    await Promise.all([
      supabase
        .from('empresas')
        .select('organizaciones (estado, trial_hasta)')
        .eq('id', activa.id)
        .single()
        .then((r) => ({ data: r.data?.organizaciones ?? null })),
      supabase.from('ventas_diarias').select('fecha, documentos, total').eq('empresa_id', activa.id).gte('fecha', hace13).lte('fecha', hoy),
      supabase.from('ventas_diarias').select('documentos, total').eq('empresa_id', activa.id).gte('fecha', mes.desde).lte('fecha', mes.hasta),
      supabase.from('ventas_por_producto').select('producto_id, descripcion, cantidad, subtotal').eq('empresa_id', activa.id).gte('fecha', mes.desde).lte('fecha', mes.hasta),
      supabase.from('productos').select('id, stock_minimo').eq('empresa_id', activa.id).eq('activo', true),
      supabase.from('stock_actual').select('producto_id, cantidad').eq('empresa_id', activa.id),
      supabase.from('saldos_documentos').select('saldo, fecha_vencimiento').eq('empresa_id', activa.id).gt('saldo', 0),
    ])

  // KPIs de ventas.
  const deHoy = (dias14 ?? []).find((d) => d.fecha === hoy)
  const ventasHoy = deHoy?.total ?? 0
  const docsHoy = deHoy?.documentos ?? 0
  const ventasMes = (diasMes ?? []).reduce((s, d) => s + (d.total ?? 0), 0)
  const docsMes = (diasMes ?? []).reduce((s, d) => s + (d.documentos ?? 0), 0)

  // Grafico 14 dias: rellena los dias sin ventas con 0.
  const porFecha = new Map((dias14 ?? []).map((d) => [d.fecha, d.total ?? 0]))
  const dias = Array.from({ length: 14 }, (_, i) => {
    const f = fechaUTC(13 - i)
    const monto = porFecha.get(f) ?? 0
    return { etiqueta: i === 13 ? 'hoy' : f.slice(8), monto, titulo: `${f}: ${formatearCLP(monto)}`, esHoy: i === 13 }
  })

  // Top 5 del mes (mismo reduce del reporte de ventas).
  const porProducto = new Map<string, { descripcion: string; subtotal: number }>()
  for (const l of topMes ?? []) {
    const key = l.producto_id ?? l.descripcion ?? ''
    const acc = porProducto.get(key) ?? { descripcion: l.descripcion ?? '', subtotal: 0 }
    acc.subtotal += l.subtotal ?? 0
    porProducto.set(key, acc)
  }
  const top = [...porProducto.values()].sort((a, b) => b.subtotal - a.subtotal).slice(0, 5)
  const maxTop = Math.max(1, ...top.map((t) => t.subtotal))

  // Stock critico y vencido (logica existente conservada).
  const totalPorProd = new Map<string, number>()
  for (const s of stockRows ?? []) {
    if (!s.producto_id) continue
    totalPorProd.set(s.producto_id, (totalPorProd.get(s.producto_id) ?? 0) + (s.cantidad ?? 0))
  }
  const criticos = (prods ?? []).filter((p) => (totalPorProd.get(p.id) ?? 0) <= p.stock_minimo).length
  const vencidos = (saldosRows ?? []).filter((s) => estaVencido(s.fecha_vencimiento, hoy, s.saldo ?? 0))
  const montoVencido = vencidos.reduce((s, v) => s + (v.saldo ?? 0), 0)

  return (
    <div>
      <Encabezado titulo={activa.razon_social}>
        <span className="text-sm text-slate-500">{formatearRut(activa.rut)}</span>
      </Encabezado>

      {organizacion?.estado === 'trial' && (
        <div className="mb-6">
          <Insignia tono="amarillo">
            Período de prueba hasta el {new Date(organizacion.trial_hasta + 'T00:00:00').toLocaleDateString('es-CL')}
          </Insignia>
        </div>
      )}
      {organizacion?.estado === 'suspendida' && (
        <div className="mb-6">
          <Insignia tono="rojo">Organización suspendida. Contáctanos para reactivarla.</Insignia>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi etiqueta="Ventas de hoy" valor={formatearCLP(ventasHoy)} sub={`${docsHoy} documento${docsHoy === 1 ? '' : 's'}`} tono="verde" href="/reportes/ventas" />
        <Kpi etiqueta="Ventas del mes" valor={formatearCLP(ventasMes)} sub={`${docsMes} documento${docsMes === 1 ? '' : 's'}`} tono="marca" href="/reportes/ventas" />
        <Kpi etiqueta="Por cobrar vencido" valor={formatearCLP(montoVencido)} sub={`${vencidos.length} documento${vencidos.length === 1 ? '' : 's'} → Cobranza`} tono="rojo" href="/cobranza?vencidas=1" />
        <Kpi etiqueta="Stock crítico" valor={String(criticos)} sub="bajo mínimo → Productos" tono="ambar" href="/productos" />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[1.5fr_1fr]">
        <Tarjeta>
          <h2 className="mb-3 text-sm font-medium text-slate-600">Ventas últimos 14 días</h2>
          <GraficoBarras dias={dias} />
        </Tarjeta>
        <Tarjeta>
          <h2 className="mb-3 text-sm font-medium text-slate-600">Top 5 productos del mes</h2>
          {top.length === 0 && <p className="py-8 text-center text-sm text-slate-400">Aún sin ventas este mes.</p>}
          <div className="space-y-2.5">
            {top.map((t) => (
              <div key={t.descripcion} className="text-sm">
                <div className="mb-0.5 flex justify-between">
                  <span className="font-medium text-slate-800">{t.descripcion}</span>
                  <span className="tabular-nums text-slate-500">{formatearCLP(t.subtotal)}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <span
                    className="block h-full rounded-full bg-gradient-to-r from-cyan-400 to-marca-600"
                    style={{ width: `${Math.round((t.subtotal / maxTop) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Tarjeta>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {RAPIDOS.map((r) => (
          <Link key={r.href} href={r.href} className="rounded-xl border-2 border-dashed border-marca-300 bg-white p-3 text-center">
            <span className="font-semibold text-marca-700">{r.titulo}</span>
            <span className="block text-xs text-slate-400">{r.sub}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
