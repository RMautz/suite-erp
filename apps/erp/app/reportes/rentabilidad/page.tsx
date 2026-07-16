import Link from 'next/link'
import { notFound } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP, formatearPatente, rangoDeMes } from '@suite/core'
import { Boton, Encabezado, Entrada, Tabla, Td, Th, Tr } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'

function pct(margen: number, ingresos: number): string {
  if (ingresos === 0) return '—'
  return ((margen / ingresos) * 100).toFixed(1).replace('.', ',') + '%'
}

export default async function PaginaRentabilidad({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const { mes = '' } = await searchParams
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  if (!activa.modulo_transporte) notFound()
  const mesActual = new Date().toISOString().slice(0, 7)
  const mesElegido = rangoDeMes(mes) ? mes : mesActual
  const rango = rangoDeMes(mesElegido)!
  const supabase = await crearClienteServidor()
  // La vista no tiene FK hacia vehiculos (PostgREST no puede embeber): dos queries y un Map.
  const [{ data: filasVista }, { data: vehiculos }] = await Promise.all([
    supabase
      .from('rentabilidad_vehiculo')
      .select('vehiculo_id, ingresos, combustible, gastos')
      .eq('empresa_id', activa.id)
      .gte('mes', rango.desde)
      .lte('mes', rango.hasta),
    supabase.from('vehiculos').select('id, patente, descripcion').eq('empresa_id', activa.id),
  ])
  const etiqueta = new Map(
    (vehiculos ?? []).map((v) => [v.id, formatearPatente(v.patente) + (v.descripcion ? ` — ${v.descripcion}` : '')])
  )
  // Las sumas vienen de sum() bigint: PostgREST puede serializarlas como string → Number() defensivo.
  const filas = (filasVista ?? [])
    .map((f) => {
      const ingresos = Number(f.ingresos ?? 0)
      const combustible = Number(f.combustible ?? 0)
      const gastos = Number(f.gastos ?? 0)
      return {
        vehiculo: f.vehiculo_id === null ? 'Sin asignar' : etiqueta.get(f.vehiculo_id) ?? '—',
        sinAsignar: f.vehiculo_id === null,
        ingresos,
        combustible,
        gastos,
        margen: ingresos - combustible - gastos,
      }
    })
    .sort((a, b) => Number(a.sinAsignar) - Number(b.sinAsignar) || a.vehiculo.localeCompare(b.vehiculo, 'es'))
  const tot = filas.reduce(
    (a, f) => ({ ingresos: a.ingresos + f.ingresos, combustible: a.combustible + f.combustible, gastos: a.gastos + f.gastos, margen: a.margen + f.margen }),
    { ingresos: 0, combustible: 0, gastos: 0, margen: 0 }
  )
  return (
    <div>
      <Encabezado titulo="Rentabilidad por vehículo">
        <Link href={`/reportes/rentabilidad/export?mes=${mesElegido}`}><Boton variante="secundario">Exportar CSV</Boton></Link>
      </Encabezado>
      <p className="mb-4 max-w-2xl text-sm text-slate-500">
        Ingresos = órdenes de entrega facturadas, por mes de fecha de ingreso; combustible y gastos por fecha
        de la transacción. La fila «Sin asignar» agrupa órdenes facturadas sin vehículo.
      </p>
      <form className="mb-4 flex items-end gap-3" action="/reportes/rentabilidad" method="get">
        <Entrada type="month" name="mes" defaultValue={mesElegido} className="max-w-xs" />
        <Boton variante="secundario" type="submit">Ver mes</Boton>
      </form>
      <Tabla>
        <thead><tr><Th>Vehículo</Th><Th className="text-right">Ingresos</Th><Th className="text-right">Combustible</Th><Th className="text-right">Gastos</Th><Th className="text-right">Margen</Th><Th className="text-right">Margen %</Th></tr></thead>
        <tbody>
          {filas.map((f) => (
            <Tr key={f.vehiculo}>
              <Td className={f.sinAsignar ? 'italic text-slate-500' : 'font-mono'}>{f.vehiculo}</Td>
              <Td className="text-right font-mono">{formatearCLP(f.ingresos)}</Td>
              <Td className="text-right font-mono">{formatearCLP(f.combustible)}</Td>
              <Td className="text-right font-mono">{formatearCLP(f.gastos)}</Td>
              {/* El rojo va en un span interno: el cn() del repo no resuelve conflictos
                  y el text-slate-800 base del Td le ganaría a text-red-600 en la celda. */}
              <Td className="text-right font-mono"><span className={f.margen < 0 ? 'text-red-600' : ''}>{formatearCLP(f.margen)}</span></Td>
              <Td className="text-right font-mono"><span className={f.margen < 0 ? 'text-red-600' : ''}>{pct(f.margen, f.ingresos)}</span></Td>
            </Tr>
          ))}
          {filas.length > 0 && (
            <Tr>
              <Td className="font-semibold">Total</Td>
              <Td className="text-right font-mono font-semibold">{formatearCLP(tot.ingresos)}</Td>
              <Td className="text-right font-mono font-semibold">{formatearCLP(tot.combustible)}</Td>
              <Td className="text-right font-mono font-semibold">{formatearCLP(tot.gastos)}</Td>
              <Td className="text-right font-mono font-semibold"><span className={tot.margen < 0 ? 'text-red-600' : ''}>{formatearCLP(tot.margen)}</span></Td>
              <Td className="text-right font-mono font-semibold"><span className={tot.margen < 0 ? 'text-red-600' : ''}>{pct(tot.margen, tot.ingresos)}</span></Td>
            </Tr>
          )}
          {filas.length === 0 && <Tr><Td colSpan={6} className="py-8 text-center text-slate-500">Sin movimientos en {mesElegido}.</Td></Tr>}
        </tbody>
      </Tabla>
    </div>
  )
}
