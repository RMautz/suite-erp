import { crearClienteServidor } from '@suite/auth/server'
import { Boton, Campo, Encabezado, Selector, Tarjeta } from '@suite/ui'
import { FormularioPago } from '../../../../componentes/formulario-pago'
import { obtenerEmpresaActiva } from '../../../../lib/empresa-activa'
import { registrarPago } from '../../acciones'

export default async function NuevoPago({ searchParams }: { searchParams: Promise<{ cliente?: string }> }) {
  const { cliente = '' } = await searchParams
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const supabase = await crearClienteServidor()
  const { data: clientes } = await supabase
    .from('clientes').select('id, razon_social').eq('empresa_id', activa.id).eq('activo', true).order('razon_social')
  const { data: saldos } = cliente
    ? await supabase
        .from('saldos_documentos')
        .select('documento_id, tipo, folio, saldo')
        .eq('empresa_id', activa.id).eq('cliente_id', cliente).gt('saldo', 0)
        .order('fecha_vencimiento', { ascending: true })
    : { data: null }
  return (
    <div>
      <Encabezado titulo="Registrar pago" />
      <Tarjeta className="mb-4 max-w-xl">
        <form action="/cobranza/pagos/nuevo" method="get" className="flex items-end gap-3">
          <Campo etiqueta="Cliente *">
            <Selector name="cliente" defaultValue={cliente} required>
              <option value="" disabled>Selecciona…</option>
              {(clientes ?? []).map((c) => <option key={c.id} value={c.id}>{c.razon_social}</option>)}
            </Selector>
          </Campo>
          <Boton variante="secundario" type="submit">Ver documentos</Boton>
        </form>
      </Tarjeta>
      {cliente && (saldos ?? []).length === 0 && (
        <p className="text-sm text-slate-500">Este cliente no tiene documentos con saldo pendiente.</p>
      )}
      {cliente && (saldos ?? []).length > 0 && (
        <FormularioPago
          accion={registrarPago}
          clienteId={cliente}
          documentos={(saldos ?? [])
            .filter((s) => s.documento_id !== null)
            .map((s) => ({
              documentoId: s.documento_id as string,
              etiqueta: `${s.tipo === 'factura' ? 'Factura' : 'Boleta'} ${s.folio ?? '—'}`,
              saldo: s.saldo ?? 0,
            }))}
        />
      )}
    </div>
  )
}
