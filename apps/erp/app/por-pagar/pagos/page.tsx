import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP } from '@suite/core'
import { Encabezado, Insignia, Tabla, Td, Th, Tr } from '@suite/ui'
import { FormularioAnularPagoProveedor } from '../../../componentes/formulario-anular-pago-proveedor'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'

const METODO: Record<string, string> = { efectivo: 'Efectivo', transferencia: 'Transferencia', tarjeta: 'Tarjeta', cheque: 'Cheque', otro: 'Otro' }

export default async function PaginaPagosProveedor() {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const supabase = await crearClienteServidor()
  const { data: pagos } = await supabase
    .from('pagos_proveedor')
    .select('id, fecha, metodo, monto, referencia, estado, motivo_anulacion, proveedores (razon_social), pagos_proveedor_aplicaciones (monto, documentos_compra (tipo, folio))')
    .eq('empresa_id', activa.id)
    .order('creado_en', { ascending: false })
    .limit(100)
  return (
    <div>
      <Encabezado titulo="Pagos a proveedores" />
      <Tabla>
        <thead><tr><Th>Fecha</Th><Th>Proveedor</Th><Th>Método</Th><Th className="text-right">Monto</Th><Th>Aplicado a</Th><Th>Estado</Th><Th /></tr></thead>
        <tbody>
          {(pagos ?? []).map((p) => (
            <Tr key={p.id}>
              <Td>{new Date(p.fecha + 'T00:00:00').toLocaleDateString('es-CL')}</Td>
              <Td>{p.proveedores?.razon_social ?? '—'}</Td>
              <Td>{METODO[p.metodo] ?? p.metodo}{p.referencia ? ` · ${p.referencia}` : ''}</Td>
              <Td className="text-right font-mono">{formatearCLP(p.monto)}</Td>
              <Td className="text-sm">
                {(p.pagos_proveedor_aplicaciones ?? []).map((a, i) => (
                  <span key={i} className="mr-2">F{a.documentos_compra?.folio ?? '—'}: {formatearCLP(a.monto)}</span>
                ))}
              </Td>
              <Td>{p.estado === 'activo' ? <Insignia tono="verde">Activo</Insignia> : <Insignia tono="rojo">Anulado</Insignia>}</Td>
              <Td>{p.estado === 'activo' ? <FormularioAnularPagoProveedor pagoId={p.id} /> : <span className="text-xs text-slate-400">{p.motivo_anulacion}</span>}</Td>
            </Tr>
          ))}
          {(pagos ?? []).length === 0 && <Tr><Td colSpan={7} className="py-8 text-center text-slate-500">No hay pagos registrados.</Td></Tr>}
        </tbody>
      </Tabla>
    </div>
  )
}
