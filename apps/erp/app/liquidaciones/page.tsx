import Link from 'next/link'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP, formatearRut } from '@suite/core'
import { Boton, Encabezado, Insignia, Selector, Tabla, Td, Th, Tr } from '@suite/ui'
import { exigirRRHH } from '../../lib/rrhh-acceso'
import { ETIQUETA_ESTADO, TONO_ESTADO, etiquetaMes } from './estados'

const RE_PERIODO = /^\d{4}-(0[1-9]|1[0-2])$/

export default async function PaginaLiquidaciones({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string }>
}) {
  const { periodo: qPeriodo } = await searchParams
  const activa = await exigirRRHH()
  const supabase = await crearClienteServidor()

  // Períodos con liquidaciones (dedupe en JS: PostgREST no hace DISTINCT).
  // ponytail: cap 1000 filas, mismo techo que el diario; .range() si se supera.
  const { data: filasPeriodos } = await supabase
    .from('liquidaciones')
    .select('periodo')
    .eq('empresa_id', activa.id)
    .order('periodo', { ascending: false })
    .limit(1000)
  const periodos = [...new Set((filasPeriodos ?? []).map((f) => f.periodo))]

  const hoy = new Date()
  const mesActual = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`
  const periodo = qPeriodo && RE_PERIODO.test(qPeriodo) ? qPeriodo : (periodos[0] ?? mesActual)
  if (!periodos.includes(periodo)) periodos.unshift(periodo)

  const { data: liqs } = await supabase
    .from('liquidaciones')
    .select('id, estado, total_imponible, total_descuentos, liquido, trabajadores (nombre, rut)')
    .eq('empresa_id', activa.id)
    .eq('periodo', periodo)
    .order('creado_en')
  // Orden por nombre en JS: PostgREST no ordena por columna del recurso embebido.
  const filas = [...(liqs ?? [])].sort((a, b) =>
    (a.trabajadores?.nombre ?? '').localeCompare(b.trabajadores?.nombre ?? '', 'es'),
  )

  return (
    <div>
      <Encabezado titulo="Liquidaciones">
        <Link href="/liquidaciones/generar"><Boton>Generar liquidación</Boton></Link>
      </Encabezado>

      {/* GET re-dibuja la lista para el período elegido (server component sin JS,
          patrón del selector de /contabilidad/eerr). */}
      <form className="mb-4 flex items-end gap-3" action="/liquidaciones" method="get">
        <label className="text-sm text-slate-600">
          Período
          <Selector name="periodo" defaultValue={periodo} className="mt-1 w-48">
            {periodos.map((p) => <option key={p} value={p}>{etiquetaMes(p)}</option>)}
          </Selector>
        </label>
        <Boton variante="secundario" type="submit">Ver</Boton>
      </form>

      <Tabla>
        <thead>
          <tr>
            <Th>Trabajador</Th><Th>RUT</Th>
            <Th className="text-right">Imponible</Th><Th className="text-right">Descuentos</Th>
            <Th className="text-right">Líquido</Th><Th>Estado</Th>
          </tr>
        </thead>
        <tbody>
          {filas.map((l) => (
            <Tr key={l.id}>
              <Td>
                <Link className="text-marca-700 hover:underline" href={`/liquidaciones/${l.id}`}>
                  {l.trabajadores?.nombre ?? '—'}
                </Link>
              </Td>
              <Td className="font-mono">{l.trabajadores ? formatearRut(l.trabajadores.rut) : '—'}</Td>
              <Td className="text-right font-mono">{formatearCLP(l.total_imponible)}</Td>
              <Td className="text-right font-mono">{formatearCLP(l.total_descuentos)}</Td>
              <Td className="text-right font-mono">{formatearCLP(l.liquido)}</Td>
              <Td><Insignia tono={TONO_ESTADO[l.estado] ?? 'gris'}>{ETIQUETA_ESTADO[l.estado] ?? l.estado}</Insignia></Td>
            </Tr>
          ))}
          {filas.length === 0 && (
            <Tr>
              <Td colSpan={6} className="py-8 text-center text-slate-500">
                No hay liquidaciones en {etiquetaMes(periodo)}.
              </Td>
            </Tr>
          )}
        </tbody>
      </Tabla>
    </div>
  )
}
