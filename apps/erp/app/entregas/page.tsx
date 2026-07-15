import Link from 'next/link'
import { notFound } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP, formatearNumeroProforma, rangoDeMes } from '@suite/core'
import { Boton, Encabezado, Entrada, Insignia, Selector, Tabla, Td, Th, Tr } from '@suite/ui'
import { FormularioAnularOrden } from '../../componentes/formulario-anular-orden'
import { FormularioDespacho } from '../../componentes/formulario-despacho'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import { ESTADOS_ORDEN, ETIQUETA_ESTADO, TONO_ESTADO } from './estados'

const NUM = (n: number | null) => (n == null ? '—' : n.toLocaleString('es-CL', { maximumFractionDigits: 2 }))

export default async function PaginaEntregas({
  searchParams,
}: {
  searchParams: Promise<{ cliente?: string; destino?: string; estado?: string; mes?: string }>
}) {
  const { cliente = '', destino = '', estado = '', mes = '' } = await searchParams
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  if (!activa.modulo_transporte) notFound()
  const rango = rangoDeMes(mes)
  const supabase = await crearClienteServidor()
  const [{ data: clientes }, { data: destinos }, { data: vehiculos }, { data: conductores }, consulta] = await Promise.all([
    supabase.from('clientes').select('id, razon_social').eq('empresa_id', activa.id).eq('activo', true).order('razon_social'),
    supabase.from('destinos').select('id, nombre').eq('empresa_id', activa.id).order('nombre'),
    supabase.from('vehiculos').select('id, patente').eq('empresa_id', activa.id).eq('activo', true).order('patente'),
    supabase.from('conductores').select('id, nombre').eq('empresa_id', activa.id).eq('activo', true).order('nombre'),
    (() => {
      let q = supabase
        .from('ordenes_entrega')
        .select('id, numero, fecha_ingreso, docum, oc_cliente, bultos, kilos, m3, kilo_afecto, neto, estado, proforma_id, vehiculo_id, conductor_id, clientes (razon_social), destinos (nombre), proformas (numero), vehiculos (patente), conductores (nombre)')
        .eq('empresa_id', activa.id)
        .order('numero', { ascending: false })
        .limit(200)
      if (cliente) q = q.eq('cliente_id', cliente)
      if (destino) q = q.eq('destino_id', destino)
      if ((ESTADOS_ORDEN as readonly string[]).includes(estado)) q = q.eq('estado', estado)
      if (rango) q = q.gte('fecha_ingreso', rango.desde).lte('fecha_ingreso', rango.hasta)
      return q
    })(),
  ])
  const filas = consulta.data ?? []
  // Totales sin anuladas: una carga anulada no suma ni kilos ni plata.
  const vivas = filas.filter((f) => f.estado !== 'anulada')
  const tot = vivas.reduce(
    (a, f) => ({
      bultos: a.bultos + f.bultos,
      kilos: a.kilos + f.kilos,
      m3: a.m3 + (f.m3 ?? 0),
      kiloAfecto: a.kiloAfecto + f.kilo_afecto,
      neto: a.neto + f.neto,
    }),
    { bultos: 0, kilos: 0, m3: 0, kiloAfecto: 0, neto: 0 }
  )
  return (
    <div>
      <Encabezado titulo="Órdenes de entrega">
        <Link href="/entregas/nueva"><Boton>Nueva orden</Boton></Link>
      </Encabezado>
      <form className="mb-4 flex flex-wrap items-center gap-3" action="/entregas" method="get">
        <Selector name="cliente" defaultValue={cliente} className="max-w-xs">
          <option value="">Todos los clientes</option>
          {(clientes ?? []).map((c) => <option key={c.id} value={c.id}>{c.razon_social}</option>)}
        </Selector>
        <Selector name="destino" defaultValue={destino} className="max-w-xs">
          <option value="">Todos los destinos</option>
          {(destinos ?? []).map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
        </Selector>
        <Selector name="estado" defaultValue={estado} className="max-w-xs">
          <option value="">Todos los estados</option>
          {ESTADOS_ORDEN.map((e) => <option key={e} value={e}>{ETIQUETA_ESTADO[e]}</option>)}
        </Selector>
        <Entrada type="month" name="mes" defaultValue={mes} className="w-40" />
        <Boton variante="secundario" type="submit">Filtrar</Boton>
        <Link className="text-sm text-marca-700 hover:underline" href="/entregas">Limpiar</Link>
      </form>
      <Tabla>
        <thead>
          <tr>
            <Th>N° ODE</Th><Th>Fecha ingreso</Th><Th>Cliente</Th><Th>Destino</Th><Th>Docum</Th><Th>OC</Th>
            <Th className="text-right">Bultos</Th><Th className="text-right">Kilos</Th><Th className="text-right">M3</Th>
            <Th className="text-right">Kilo afecto</Th><Th className="text-right">Neto</Th><Th>Estado</Th><Th>Despacho</Th><Th />
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <Tr key={f.id}>
              <Td>{f.numero}</Td>
              <Td>{new Date(f.fecha_ingreso + 'T00:00:00').toLocaleDateString('es-CL')}</Td>
              <Td>{f.clientes?.razon_social ?? '—'}</Td>
              <Td>{f.destinos?.nombre ?? '—'}</Td>
              <Td>{f.docum ?? '—'}</Td>
              <Td>{f.oc_cliente ?? '—'}</Td>
              <Td className="text-right">{f.bultos}</Td>
              <Td className="text-right">{NUM(f.kilos)}</Td>
              <Td className="text-right">{NUM(f.m3)}</Td>
              <Td className="text-right">{NUM(f.kilo_afecto)}</Td>
              <Td className="text-right font-mono">{formatearCLP(f.neto)}</Td>
              <Td>
                <Insignia tono={TONO_ESTADO[f.estado] ?? 'gris'}>{ETIQUETA_ESTADO[f.estado] ?? f.estado}</Insignia>
                {f.proforma_id && f.proformas && (
                  <Link className="ml-1 text-xs text-marca-700 hover:underline" href={`/proformas/${f.proforma_id}`}>
                    {formatearNumeroProforma(f.proformas.numero)}
                  </Link>
                )}
              </Td>
              <Td>
                {f.estado !== 'anulada' && (
                  <FormularioDespacho
                    ordenId={f.id}
                    vehiculoId={f.vehiculo_id}
                    conductorId={f.conductor_id}
                    actual={f.vehiculos?.patente ?? f.conductores?.nombre ?? null}
                    vehiculos={vehiculos ?? []}
                    conductores={conductores ?? []}
                  />
                )}
              </Td>
              <Td>
                {f.estado === 'registrada' && !f.proforma_id && <FormularioAnularOrden ordenId={f.id} />}
              </Td>
            </Tr>
          ))}
          {filas.length === 0 && <Tr><Td colSpan={14} className="py-8 text-center text-slate-500">No hay órdenes de entrega {cliente || destino || estado || mes ? 'que coincidan' : 'todavía'}.</Td></Tr>}
        </tbody>
      </Tabla>
      <div className="mt-3 flex flex-wrap justify-end gap-6 text-sm">
        <span className="text-slate-500">Totales (sin anuladas):</span>
        <span>Órdenes: <strong>{vivas.length}</strong></span>
        <span>Bultos: <strong>{tot.bultos}</strong></span>
        <span>Kilos: <strong>{NUM(tot.kilos)}</strong></span>
        <span>M3: <strong>{NUM(tot.m3)}</strong></span>
        <span>Kilo afecto: <strong>{NUM(tot.kiloAfecto)}</strong></span>
        <span>Neto: <strong className="font-mono">{formatearCLP(tot.neto)}</strong></span>
      </div>
    </div>
  )
}
