import Link from 'next/link'
import { crearClienteServidor } from '@suite/auth/server'
import { estaVencido, formatearCLP, formatearRut } from '@suite/core'
import { Encabezado, Insignia, Tarjeta } from '@suite/ui'
import { obtenerEmpresaActiva } from '../lib/empresa-activa'

export default async function Inicio() {
  const { activa } = await obtenerEmpresaActiva()

  if (!activa) {
    return (
      <div>
        <Encabezado titulo="Sin organización" />
        <Tarjeta>
          <p>
            Tu usuario no pertenece a ninguna organización. Pide una invitación o{' '}
            <a className="text-marca-600 underline" href={process.env.NEXT_PUBLIC_URL_WEB + '/registro'}>
              crea tu cuenta
            </a>
            .
          </p>
        </Tarjeta>
      </div>
    )
  }

  const supabase = await crearClienteServidor()
  // Todas las consultas del dashboard en un solo roundtrip paralelo (eran 3 awaits
  // secuenciales tras el Promise.all: ~100-150ms extra de TTFB en la página de aterrizaje).
  const [{ data: organizacion }, productos, clientes, { data: prods }, { data: stockRows }, { data: saldosRows }] =
    await Promise.all([
      supabase
        .from('empresas')
        .select('organizaciones (estado, trial_hasta)')
        .eq('id', activa.id)
        .single()
        .then((r) => ({ data: r.data?.organizaciones ?? null })),
      supabase
        .from('productos')
        .select('id', { count: 'exact', head: true })
        .eq('empresa_id', activa.id)
        .eq('activo', true),
      supabase
        .from('clientes')
        .select('id', { count: 'exact', head: true })
        .eq('empresa_id', activa.id)
        .eq('activo', true),
      supabase.from('productos').select('id, stock_minimo').eq('empresa_id', activa.id).eq('activo', true),
      supabase.from('stock_actual').select('producto_id, cantidad').eq('empresa_id', activa.id),
      supabase
        .from('saldos_documentos')
        .select('saldo, fecha_vencimiento')
        .eq('empresa_id', activa.id)
        .gt('saldo', 0),
    ])

  const totalPorProd = new Map<string, number>()
  for (const s of stockRows ?? []) {
    if (!s.producto_id) continue
    totalPorProd.set(s.producto_id, (totalPorProd.get(s.producto_id) ?? 0) + (s.cantidad ?? 0))
  }
  const criticos = (prods ?? []).filter((p) => (totalPorProd.get(p.id) ?? 0) <= p.stock_minimo).length
  const hoy = new Date().toISOString().slice(0, 10)
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
            Período de prueba hasta el{' '}
            {new Date(organizacion.trial_hasta + 'T00:00:00').toLocaleDateString('es-CL')}
          </Insignia>
        </div>
      )}
      {organizacion?.estado === 'suspendida' && (
        <div className="mb-6">
          <Insignia tono="rojo">Organización suspendida. Contáctanos para reactivarla.</Insignia>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tarjeta>
          <p className="text-sm text-slate-500">Productos activos</p>
          <p className="mt-1 text-3xl font-semibold">{productos.count ?? 0}</p>
        </Tarjeta>
        <Tarjeta>
          <p className="text-sm text-slate-500">Clientes activos</p>
          <p className="mt-1 text-3xl font-semibold">{clientes.count ?? 0}</p>
        </Tarjeta>
        <Link href="/productos?inactivos=0">
          <Tarjeta>
            <p className="text-sm text-slate-500">Stock crítico</p>
            <p className="mt-1 text-3xl font-semibold">{criticos}</p>
          </Tarjeta>
        </Link>
        <Link href="/cobranza?vencidas=1">
          <Tarjeta>
            <p className="text-sm text-slate-500">Por cobrar vencido</p>
            <p className="mt-1 text-3xl font-semibold">{formatearCLP(montoVencido)}</p>
            <p className="text-xs text-slate-500">{vencidos.length} documento{vencidos.length === 1 ? '' : 's'}</p>
          </Tarjeta>
        </Link>
      </div>
    </div>
  )
}
