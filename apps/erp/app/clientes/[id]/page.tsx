import { notFound } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP, formatearRut } from '@suite/core'
import { Encabezado, Tarjeta } from '@suite/ui'
import { FormularioCliente } from '../../../componentes/formulario-cliente'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { guardarCliente } from '../acciones'

export default async function EditarCliente({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const supabase = await crearClienteServidor()
  const { data: cliente } = await supabase
    .from('clientes')
    .select('*')
    .eq('id', id)
    .eq('empresa_id', activa.id)
    .single()
  if (!cliente) notFound()

  const [{ data: saldos }, { data: pagos }] = await Promise.all([
    supabase
      .from('saldos_documentos')
      .select('documento_id, tipo, folio, total, pagado, notas_credito, saldo, fecha_vencimiento')
      .eq('empresa_id', activa.id).eq('cliente_id', id).neq('saldo', 0)
      .order('fecha_vencimiento', { ascending: true }),
    supabase
      .from('pagos')
      .select('id, fecha, metodo, monto, estado')
      .eq('empresa_id', activa.id).eq('cliente_id', id)
      .order('creado_en', { ascending: false }).limit(20),
  ])
  const deuda = (saldos ?? []).reduce((s, d) => s + Math.max(0, d.saldo ?? 0), 0)

  return (
    <div>
      <Encabezado titulo={`Editar: ${cliente.razon_social}`} />
      <FormularioCliente
        accion={guardarCliente}
        inicial={{
          id: cliente.id,
          rut: formatearRut(cliente.rut),
          razon_social: cliente.razon_social,
          giro: cliente.giro ?? '',
          email: cliente.email ?? '',
          telefono: cliente.telefono ?? '',
          direccion: cliente.direccion ?? '',
          comuna: cliente.comuna ?? '',
          condicion_pago_dias: cliente.condicion_pago_dias,
        }}
      />
      <div className="mt-6 max-w-2xl">
        <h2 className="mb-2 text-lg font-semibold text-slate-800">Estado de cuenta</h2>
        <Tarjeta>
          <p className="mb-2 text-sm">Deuda vigente: <strong className="font-mono">{formatearCLP(deuda)}</strong></p>
          <ul className="space-y-1 text-sm">
            {(saldos ?? []).map((d) => (
              <li key={d.documento_id} className="flex justify-between">
                <span>{d.tipo === 'factura' ? 'Factura' : 'Boleta'} {d.folio ?? '—'} · vence {d.fecha_vencimiento ? new Date(d.fecha_vencimiento + 'T00:00:00').toLocaleDateString('es-CL') : '—'}</span>
                <span className="font-mono">{formatearCLP(d.saldo ?? 0)}</span>
              </li>
            ))}
            {(saldos ?? []).length === 0 && <li className="text-slate-500">Sin documentos con saldo pendiente.</li>}
          </ul>
          {(pagos ?? []).length > 0 && (
            <>
              <p className="mb-1 mt-4 text-sm font-medium text-slate-700">Últimos pagos</p>
              <ul className="space-y-1 text-sm">
                {(pagos ?? []).map((p) => (
                  <li key={p.id} className="flex justify-between">
                    <span>{new Date(p.fecha + 'T00:00:00').toLocaleDateString('es-CL')} · {p.metodo}{p.estado === 'anulado' ? ' (anulado)' : ''}</span>
                    <span className="font-mono">{formatearCLP(p.monto)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Tarjeta>
      </div>
    </div>
  )
}
