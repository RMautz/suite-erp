import Link from 'next/link'
import { crearClienteServidor } from '@suite/auth/server'
import { cotizacionVencida, formatearCLP, formatearFolio, type EstadoCotizacion } from '@suite/core'
import { Boton, Encabezado, Insignia, Selector, Tabla, Td, Th, Tr } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import { ESTADOS_COTIZACION, ETIQUETA_ESTADO, TONO_ESTADO } from './estados'

const HOY = () => new Date().toISOString().slice(0, 10)

export default async function PaginaCotizaciones({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string; cliente?: string }>
}) {
  const { estado = '', cliente = '' } = await searchParams
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const supabase = await crearClienteServidor()
  const [{ data: clientes }, consulta] = await Promise.all([
    supabase.from('clientes').select('id, razon_social').eq('empresa_id', activa.id).eq('activo', true).order('razon_social'),
    (() => {
      let q = supabase
        .from('cotizaciones')
        .select('id, numero, fecha_validez, estado, total, creado_en, clientes (razon_social)')
        .eq('empresa_id', activa.id)
        .order('creado_en', { ascending: false })
        .limit(100)
      if ((ESTADOS_COTIZACION as readonly string[]).includes(estado)) q = q.eq('estado', estado)
      if (cliente) q = q.eq('cliente_id', cliente)
      return q
    })(),
  ])
  const hoy = HOY()
  const filas = consulta.data ?? []
  const totalCotizado = filas.reduce((s, c) => s + c.total, 0)
  return (
    <div>
      <Encabezado titulo="Cotizaciones">
        <Link href="/cotizaciones/nueva"><Boton>Nueva cotización</Boton></Link>
      </Encabezado>
      <form className="mb-4 flex flex-wrap items-center gap-3" action="/cotizaciones" method="get">
        <Selector name="estado" defaultValue={estado} className="max-w-xs">
          <option value="">Todos los estados</option>
          {ESTADOS_COTIZACION.map((e) => <option key={e} value={e}>{ETIQUETA_ESTADO[e]}</option>)}
        </Selector>
        <Selector name="cliente" defaultValue={cliente} className="max-w-xs">
          <option value="">Todos los clientes</option>
          {(clientes ?? []).map((cl) => <option key={cl.id} value={cl.id}>{cl.razon_social}</option>)}
        </Selector>
        <Boton variante="secundario" type="submit">Filtrar</Boton>
        <Link className="text-sm text-marca-700 hover:underline" href="/cotizaciones">Limpiar</Link>
      </form>
      <Tabla>
        <thead><tr><Th>N°</Th><Th>Cliente</Th><Th>Creada</Th><Th>Válida hasta</Th><Th className="text-right">Total</Th><Th>Estado</Th><Th /></tr></thead>
        <tbody>
          {filas.map((c) => {
            // estado es text + check en SQL; el codegen lo tipa string — cast solo de tipo, no de valor.
            const vencida = cotizacionVencida(c.fecha_validez, hoy, c.estado as EstadoCotizacion)
            return (
              <Tr key={c.id}>
                <Td><Link className="text-marca-700 hover:underline" href={`/cotizaciones/${c.id}`}>{formatearFolio(c.numero)}</Link></Td>
                <Td>{c.clientes?.razon_social ?? '—'}</Td>
                <Td>{new Date(c.creado_en).toLocaleDateString('es-CL')}</Td>
                <Td>{new Date(c.fecha_validez + 'T00:00:00').toLocaleDateString('es-CL')}</Td>
                <Td className="text-right font-mono">{formatearCLP(c.total)}</Td>
                <Td><Insignia tono={TONO_ESTADO[c.estado] ?? 'gris'}>{ETIQUETA_ESTADO[c.estado] ?? c.estado}</Insignia></Td>
                <Td>{vencida && <Insignia tono="rojo">Vencida</Insignia>}</Td>
              </Tr>
            )
          })}
          {filas.length === 0 && <Tr><Td colSpan={7} className="py-8 text-center text-slate-500">No hay cotizaciones {estado || cliente ? 'que coincidan' : 'todavía'}.</Td></Tr>}
        </tbody>
      </Tabla>
      <div className="mt-3 flex justify-end gap-6 text-sm">
        <span>Cotizaciones: <strong>{filas.length}</strong></span>
        <span>Total: <strong className="font-mono">{formatearCLP(totalCotizado)}</strong></span>
      </div>
    </div>
  )
}
