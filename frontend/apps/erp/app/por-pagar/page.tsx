import Link from 'next/link'
import { crearClienteServidor } from '@suite/auth/server'
import { estaVencido, formatearCLP } from '@suite/core'
import { Boton, Encabezado, Insignia, Selector, Tabla, Td, Th, Tr } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'

const HOY = () => new Date().toISOString().slice(0, 10)
const ETIQUETA: Record<string, string> = { factura: 'Factura', factura_exenta: 'Factura exenta' }

export default async function PaginaPorPagar({
  searchParams,
}: {
  searchParams: Promise<{ proveedor?: string; vencidas?: string }>
}) {
  const { proveedor = '', vencidas = '' } = await searchParams
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const supabase = await crearClienteServidor()
  const [{ data: proveedores }, consulta] = await Promise.all([
    supabase.from('proveedores').select('id, razon_social').eq('empresa_id', activa.id).eq('activo', true).order('razon_social'),
    (() => {
      let q = supabase
        .from('saldos_compras')
        .select('documento_id, tipo, folio, proveedor_id, proveedor_razon_social, fecha_emision, fecha_vencimiento, total, pagado, saldo')
        .eq('empresa_id', activa.id)
        .gt('saldo', 0)
        .order('fecha_vencimiento', { ascending: true })
        .limit(200)
      if (proveedor) q = q.eq('proveedor_id', proveedor)
      return q
    })(),
  ])
  const hoy = HOY()
  let filas = consulta.data ?? []
  if (vencidas === '1') filas = filas.filter((f) => estaVencido(f.fecha_vencimiento, hoy, f.saldo ?? 0))
  const porPagar = filas.reduce((s, f) => s + (f.saldo ?? 0), 0)
  const vencido = filas.filter((f) => estaVencido(f.fecha_vencimiento, hoy, f.saldo ?? 0)).reduce((s, f) => s + (f.saldo ?? 0), 0)
  return (
    <div>
      <Encabezado titulo="Cuentas por pagar">
        <div className="flex items-center gap-2">
          <Link href="/por-pagar/facturas"><Boton variante="secundario">Facturas</Boton></Link>
          <Link href="/por-pagar/pagos"><Boton variante="secundario">Pagos</Boton></Link>
          <Link href="/por-pagar/pagos/nuevo"><Boton>Registrar pago</Boton></Link>
        </div>
      </Encabezado>
      <form className="mb-4 flex flex-wrap items-center gap-3" action="/por-pagar" method="get">
        <Selector name="proveedor" defaultValue={proveedor} className="max-w-xs">
          <option value="">Todos los proveedores</option>
          {(proveedores ?? []).map((p) => <option key={p.id} value={p.id}>{p.razon_social}</option>)}
        </Selector>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" name="vencidas" value="1" defaultChecked={vencidas === '1'} /> Solo vencidas
        </label>
        <Boton variante="secundario" type="submit">Filtrar</Boton>
        <Link className="text-sm text-marca-700 hover:underline" href="/por-pagar">Limpiar</Link>
      </form>
      <Tabla>
        <thead><tr><Th>Documento</Th><Th>Proveedor</Th><Th>Emisión</Th><Th>Vencimiento</Th><Th className="text-right">Total</Th><Th className="text-right">Pagado</Th><Th className="text-right">Saldo</Th><Th /></tr></thead>
        <tbody>
          {filas.map((f) => {
            const venc = estaVencido(f.fecha_vencimiento, hoy, f.saldo ?? 0)
            return (
              <Tr key={f.documento_id}>
                <Td>{ETIQUETA[f.tipo ?? ''] ?? f.tipo} {f.folio}</Td>
                <Td>{f.proveedor_razon_social}</Td>
                <Td>{f.fecha_emision ? new Date(f.fecha_emision + 'T00:00:00').toLocaleDateString('es-CL') : '—'}</Td>
                <Td>{f.fecha_vencimiento ? new Date(f.fecha_vencimiento + 'T00:00:00').toLocaleDateString('es-CL') : '—'}</Td>
                <Td className="text-right font-mono">{formatearCLP(f.total ?? 0)}</Td>
                <Td className="text-right font-mono">{formatearCLP(f.pagado ?? 0)}</Td>
                <Td className="text-right font-mono">{formatearCLP(f.saldo ?? 0)}</Td>
                <Td>{venc && <Insignia tono="rojo">Vencida</Insignia>}</Td>
              </Tr>
            )
          })}
          {filas.length === 0 && <Tr><Td colSpan={8} className="py-8 text-center text-slate-500">No hay facturas con saldo {proveedor || vencidas ? 'que coincidan' : 'pendiente'}.</Td></Tr>}
        </tbody>
      </Tabla>
      <div className="mt-3 flex justify-end gap-6 text-sm">
        <span>Por pagar: <strong className="font-mono">{formatearCLP(porPagar)}</strong></span>
        <span className="text-red-600">Vencido: <strong className="font-mono">{formatearCLP(vencido)}</strong></span>
      </div>
    </div>
  )
}
