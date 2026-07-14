import Link from 'next/link'
import { crearClienteServidor } from '@suite/auth/server'
import { estaVencido, formatearCLP } from '@suite/core'
import { Boton, Encabezado, Insignia, Selector, Tabla, Td, Th, Tr } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'

const HOY = () => new Date().toISOString().slice(0, 10)

export default async function PaginaCobranza({
  searchParams,
}: {
  searchParams: Promise<{ cliente?: string; vencidas?: string }>
}) {
  const { cliente = '', vencidas = '' } = await searchParams
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const supabase = await crearClienteServidor()
  const [{ data: clientes }, consultaSaldos] = await Promise.all([
    supabase.from('clientes').select('id, razon_social').eq('empresa_id', activa.id).eq('activo', true).order('razon_social'),
    (() => {
      let q = supabase
        .from('saldos_documentos')
        .select('documento_id, tipo, folio, cliente_id, cliente_razon_social, total, emitido_en, fecha_vencimiento, pagado, notas_credito, saldo')
        .eq('empresa_id', activa.id)
        .neq('saldo', 0)
        .order('fecha_vencimiento', { ascending: true })
        .limit(200)
      if (cliente) q = q.eq('cliente_id', cliente)
      return q
    })(),
  ])
  const hoy = HOY()
  let filas = consultaSaldos.data ?? []
  if (vencidas === '1') filas = filas.filter((f) => estaVencido(f.fecha_vencimiento, hoy, f.saldo ?? 0))
  const porCobrar = filas.reduce((s, f) => s + Math.max(0, f.saldo ?? 0), 0)
  const vencido = filas.filter((f) => estaVencido(f.fecha_vencimiento, hoy, f.saldo ?? 0)).reduce((s, f) => s + (f.saldo ?? 0), 0)
  return (
    <div>
      <Encabezado titulo="Cuentas por cobrar">
        <div className="flex items-center gap-2">
          <Link href="/cobranza/pagos"><Boton variante="secundario">Pagos</Boton></Link>
          <Link href="/cobranza/pagos/nuevo"><Boton>Registrar pago</Boton></Link>
        </div>
      </Encabezado>
      <form className="mb-4 flex flex-wrap items-center gap-3" action="/cobranza" method="get">
        <Selector name="cliente" defaultValue={cliente} className="max-w-xs">
          <option value="">Todos los clientes</option>
          {(clientes ?? []).map((c) => <option key={c.id} value={c.id}>{c.razon_social}</option>)}
        </Selector>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" name="vencidas" value="1" defaultChecked={vencidas === '1'} /> Solo vencidas
        </label>
        <Boton variante="secundario" type="submit">Filtrar</Boton>
        <Link className="text-sm text-marca-700 hover:underline" href="/cobranza">Limpiar</Link>
      </form>
      <Tabla>
        <thead><tr><Th>Documento</Th><Th>Cliente</Th><Th>Emisión</Th><Th>Vencimiento</Th><Th className="text-right">Total</Th><Th className="text-right">Pagado</Th><Th className="text-right">Saldo</Th><Th /></tr></thead>
        <tbody>
          {filas.map((f) => {
            const venc = estaVencido(f.fecha_vencimiento, hoy, f.saldo ?? 0)
            return (
              <Tr key={f.documento_id}>
                <Td>{f.tipo === 'factura' ? 'Factura' : 'Boleta'} {f.folio ?? '—'}</Td>
                <Td>{f.cliente_razon_social}</Td>
                <Td>{f.emitido_en ? new Date(f.emitido_en).toLocaleDateString('es-CL') : '—'}</Td>
                <Td>{f.fecha_vencimiento ? new Date(f.fecha_vencimiento + 'T00:00:00').toLocaleDateString('es-CL') : '—'}</Td>
                <Td className="text-right font-mono">{formatearCLP(f.total ?? 0)}</Td>
                <Td className="text-right font-mono">{formatearCLP((f.pagado ?? 0) + (f.notas_credito ?? 0))}</Td>
                <Td className="text-right font-mono">{(f.saldo ?? 0) < 0 ? <span className="text-marca-700">{formatearCLP(f.saldo ?? 0)} (a favor)</span> : formatearCLP(f.saldo ?? 0)}</Td>
                <Td>{venc && <Insignia tono="rojo">Vencida</Insignia>}</Td>
              </Tr>
            )
          })}
          {filas.length === 0 && <Tr><Td colSpan={8} className="py-8 text-center text-slate-500">No hay documentos con saldo {cliente || vencidas ? 'que coincidan' : 'pendiente'}.</Td></Tr>}
        </tbody>
      </Tabla>
      <div className="mt-3 flex justify-end gap-6 text-sm">
        <span>Por cobrar: <strong className="font-mono">{formatearCLP(porCobrar)}</strong></span>
        <span className="text-red-600">Vencido: <strong className="font-mono">{formatearCLP(vencido)}</strong></span>
      </div>
    </div>
  )
}
