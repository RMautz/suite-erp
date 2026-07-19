import Link from 'next/link'
import { notFound } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP, formatearRut, periodoAnterior, rangoDeMes } from '@suite/core'
import { Boton, Encabezado, Entrada, Tabla, Td, Th, Tr } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import { puedeVerRRHH } from '../../lib/rrhh-acceso'

interface Fila {
  id: string
  dias_trabajados: number
  total_imponible: number
  afp_monto: number
  salud_monto: number
  cesantia_monto: number
  impuesto_unico: number
  liquido: number
  trabajadores: { rut: string; nombre: string } | null
}

export default async function PaginaLibroRemuneraciones({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string }>
}) {
  const { periodo: qPeriodo } = await searchParams
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  // Guard de rol (paridad con el route de export — lección P12): el libro es
  // dueno/admin/contador vía puedeVerRRHH (guard único de Personas, Task 5).
  // Vendedor/bodeguero → 404 (el NAV ya les oculta Personas; esto cubre la
  // URL directa).
  if (!puedeVerRRHH(activa)) notFound()

  // Período por defecto: el mes ANTERIOR (las remuneraciones se liquidan por
  // mes vencido). Un ?periodo= inválido cae al por defecto (fallback silencioso,
  // patrón de los exports de contabilidad; paridad con el route).
  const porDefecto = periodoAnterior(new Date().toISOString().slice(0, 7))!
  const periodo = qPeriodo && rangoDeMes(qPeriodo) ? qPeriodo : porDefecto

  const supabase = await crearClienteServidor()
  const { data, error } = await supabase
    .from('liquidaciones')
    .select('id, dias_trabajados, total_imponible, afp_monto, salud_monto, cesantia_monto, impuesto_unico, liquido, trabajadores (rut, nombre)')
    .eq('empresa_id', activa.id)
    .eq('periodo', periodo)
    .neq('estado', 'anulada')
  if (error) throw new Error('No se pudo cargar el libro de remuneraciones')
  // Orden alfabético por trabajador (PostgREST no ordena el padre por columnas
  // del join embebido) — el export ordena igual.
  const filas = ((data ?? []) as Fila[]).sort((a, b) =>
    (a.trabajadores?.nombre ?? '').localeCompare(b.trabajadores?.nombre ?? '', 'es')
  )
  const tot = filas.reduce(
    (t, f) => ({
      imponible: t.imponible + f.total_imponible,
      afp: t.afp + f.afp_monto,
      salud: t.salud + f.salud_monto,
      cesantia: t.cesantia + f.cesantia_monto,
      impuesto: t.impuesto + f.impuesto_unico,
      liquido: t.liquido + f.liquido,
    }),
    { imponible: 0, afp: 0, salud: 0, cesantia: 0, impuesto: 0, liquido: 0 }
  )

  return (
    <div>
      <Encabezado titulo="Libro de remuneraciones">
        <Link href={`/libro-remuneraciones/export?periodo=${periodo}`}>
          <Boton variante="secundario">Exportar CSV</Boton>
        </Link>
      </Encabezado>
      <form className="mb-4 flex items-end gap-3" action="/libro-remuneraciones" method="get">
        <label className="text-sm text-slate-600">
          Período
          <Entrada type="month" name="periodo" defaultValue={periodo} className="mt-1 w-44" />
        </label>
        <Boton variante="secundario" type="submit">Ver período</Boton>
      </form>
      <Tabla>
        <thead>
          <tr>
            <Th>RUT</Th>
            <Th>Nombre</Th>
            <Th className="text-right">Días</Th>
            <Th className="text-right">Imponible</Th>
            <Th className="text-right">AFP</Th>
            <Th className="text-right">Salud</Th>
            <Th className="text-right">Cesantía</Th>
            <Th className="text-right">Impuesto único</Th>
            <Th className="text-right">Líquido</Th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <Tr key={f.id}>
              <Td className="font-mono">{f.trabajadores ? formatearRut(f.trabajadores.rut) : '—'}</Td>
              <Td>{f.trabajadores?.nombre ?? '—'}</Td>
              <Td className="text-right font-mono">{f.dias_trabajados}</Td>
              <Td className="text-right font-mono">{formatearCLP(f.total_imponible)}</Td>
              <Td className="text-right font-mono">{formatearCLP(f.afp_monto)}</Td>
              <Td className="text-right font-mono">{formatearCLP(f.salud_monto)}</Td>
              <Td className="text-right font-mono">{formatearCLP(f.cesantia_monto)}</Td>
              <Td className="text-right font-mono">{formatearCLP(f.impuesto_unico)}</Td>
              <Td className="text-right font-mono">{formatearCLP(f.liquido)}</Td>
            </Tr>
          ))}
          {filas.length === 0 && (
            <Tr>
              <Td colSpan={9} className="py-8 text-center text-slate-500">
                Sin liquidaciones en el período {periodo}.
              </Td>
            </Tr>
          )}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-slate-300 font-semibold">
            <Td colSpan={3} className="text-right">Totales del período</Td>
            <Td className="text-right font-mono">{formatearCLP(tot.imponible)}</Td>
            <Td className="text-right font-mono">{formatearCLP(tot.afp)}</Td>
            <Td className="text-right font-mono">{formatearCLP(tot.salud)}</Td>
            <Td className="text-right font-mono">{formatearCLP(tot.cesantia)}</Td>
            <Td className="text-right font-mono">{formatearCLP(tot.impuesto)}</Td>
            <Td className="text-right font-mono">{formatearCLP(tot.liquido)}</Td>
          </tr>
        </tfoot>
      </Tabla>
      <p className="mt-2 text-sm text-slate-500">
        Solo liquidaciones emitidas o pagadas del período; las anuladas quedan fuera del libro.
      </p>
    </div>
  )
}
