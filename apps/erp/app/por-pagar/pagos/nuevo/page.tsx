import { crearClienteServidor } from '@suite/auth/server'
import { Boton, Campo, Encabezado, Selector, Tarjeta } from '@suite/ui'
import { FormularioPagoProveedor } from '../../../../componentes/formulario-pago-proveedor'
import { obtenerEmpresaActiva } from '../../../../lib/empresa-activa'
import { registrarPagoProveedor } from '../../acciones'

const ETIQUETA: Record<string, string> = { factura: 'Factura', factura_exenta: 'Factura exenta' }

export default async function NuevoPagoProveedor({ searchParams }: { searchParams: Promise<{ proveedor?: string }> }) {
  const { proveedor = '' } = await searchParams
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const supabase = await crearClienteServidor()
  const { data: proveedores } = await supabase
    .from('proveedores').select('id, razon_social').eq('empresa_id', activa.id).eq('activo', true).order('razon_social')
  const { data: saldos } = proveedor
    ? await supabase
        .from('saldos_compras')
        .select('documento_id, tipo, folio, saldo')
        .eq('empresa_id', activa.id).eq('proveedor_id', proveedor).gt('saldo', 0)
        .order('fecha_vencimiento', { ascending: true })
    : { data: null }
  return (
    <div>
      <Encabezado titulo="Registrar pago a proveedor" />
      <Tarjeta className="mb-4 max-w-xl">
        <form action="/por-pagar/pagos/nuevo" method="get" className="flex items-end gap-3">
          <Campo etiqueta="Proveedor *">
            <Selector name="proveedor" defaultValue={proveedor} required>
              <option value="" disabled>Selecciona…</option>
              {(proveedores ?? []).map((p) => <option key={p.id} value={p.id}>{p.razon_social}</option>)}
            </Selector>
          </Campo>
          <Boton variante="secundario" type="submit">Ver facturas</Boton>
        </form>
      </Tarjeta>
      {proveedor && (saldos ?? []).length === 0 && (
        <p className="text-sm text-slate-500">Este proveedor no tiene facturas con saldo pendiente.</p>
      )}
      {proveedor && (saldos ?? []).length > 0 && (
        <FormularioPagoProveedor
          accion={registrarPagoProveedor}
          proveedorId={proveedor}
          documentos={(saldos ?? []).map((s) => ({
            documentoId: s.documento_id ?? '',
            etiqueta: `${ETIQUETA[s.tipo ?? ''] ?? s.tipo} ${s.folio ?? '—'}`,
            saldo: s.saldo ?? 0,
          }))}
        />
      )}
    </div>
  )
}
