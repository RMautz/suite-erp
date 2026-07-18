import Link from 'next/link'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP, variacion } from '@suite/core'
import { Boton, Encabezado, Selector, Tabla, Td, Th, Tr } from '@suite/ui'
import { exigirContabilidad } from '../../../lib/contabilidad-acceso'
import { aniosConAsientos } from '../balance/calculo'
import { etiquetaPeriodo, obtenerEERR, type FilaEERR } from './calculo'

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

export default async function PaginaEERR({
  searchParams,
}: {
  searchParams: Promise<{ tipo?: string; anio?: string; n?: string }>
}) {
  const { tipo: qTipo, anio: qAnio, n: qN } = await searchParams
  const activa = await exigirContabilidad()
  const supabase = await crearClienteServidor()

  const anios = await aniosConAsientos(supabase, activa.id)
  if (anios.length === 0) {
    return (
      <div>
        <Encabezado titulo="Estado de resultados" />
        <p className="text-slate-500">Aún no hay asientos. Emite un documento o usa Contabilizar pendientes.</p>
      </div>
    )
  }

  const hoy = new Date()
  const tipo = qTipo === 'trimestre' || qTipo === 'anio' ? qTipo : 'mes'
  const porDefecto = anios.includes(hoy.getFullYear()) ? hoy.getFullYear() : anios[0]
  const anio = qAnio && /^\d{4}$/.test(qAnio) && anios.includes(Number(qAnio)) ? Number(qAnio) : porDefecto
  const maxN = tipo === 'mes' ? 12 : 4
  const nDefecto = tipo === 'mes' ? hoy.getMonth() + 1 : Math.floor(hoy.getMonth() / 3) + 1
  const n = qN && /^\d{1,2}$/.test(qN) && Number(qN) >= 1 && Number(qN) <= maxN ? Number(qN) : nDefecto
  const periodo =
    tipo === 'anio' ? String(anio) : tipo === 'trimestre' ? `${anio}-T${n}` : `${anio}-${String(n).padStart(2, '0')}`

  // El período se construyó con formato válido: obtenerEERR nunca retorna null aquí.
  const eerr = (await obtenerEERR(supabase, activa.id, periodo))!
  const r = eerr.resultado
  const etActual = etiquetaPeriodo(periodo)
  const etAnterior = etiquetaPeriodo(eerr.anterior)
  const colAnterior = (v: number) => (eerr.anteriorConDatos ? formatearCLP(v) : '—')
  const colVariacion = (actual: number, anterior: number) =>
    eerr.anteriorConDatos ? variacion(actual, anterior) : '—'
  const filaCuenta = (f: FilaEERR) => (
    <Tr key={f.codigo}>
      <Td><span className="font-mono">{f.codigo}</span> {f.nombre}</Td>
      <Td className="text-right font-mono">{formatearCLP(f.actual)}</Td>
      <Td className="text-right font-mono">{colAnterior(f.anterior)}</Td>
      <Td className="text-right font-mono">{colVariacion(f.actual, f.anterior)}</Td>
    </Tr>
  )

  return (
    <div>
      <Encabezado titulo="Estado de resultados">
        <Link href={`/contabilidad/eerr/export?periodo=${periodo}`}>
          <Boton variante="secundario">Exportar CSV</Boton>
        </Link>
      </Encabezado>

      <p className="mb-4 text-lg text-slate-800">
        {r.actual > 0 && <>Ganaste <span className="font-semibold">{formatearCLP(r.actual)}</span> en {etActual}.</>}
        {r.actual < 0 && <>Perdiste <span className="font-semibold">{formatearCLP(-r.actual)}</span> en {etActual}.</>}
        {r.actual === 0 && <>Sin utilidad ni pérdida en {etActual}.</>}
        {eerr.anteriorConDatos ? (
          <span className="text-slate-500">
            {' '}{etAnterior}: {r.anterior < 0 ? <>pérdida de {formatearCLP(-r.anterior)}</> : <>utilidad de {formatearCLP(r.anterior)}</>} (variación {variacion(r.actual, r.anterior)}).
          </span>
        ) : (
          <span className="text-slate-500"> Sin datos de {etAnterior} para comparar.</span>
        )}
      </p>

      {/* Cambiar el tipo re-envía el form (server component sin JS): el selector
          de mes/trimestre se re-dibuja para el tipo recién elegido. */}
      <form className="mb-4 flex flex-wrap items-end gap-3" action="/contabilidad/eerr" method="get">
        <label className="text-sm text-slate-600">
          Período
          <Selector name="tipo" defaultValue={tipo} className="mt-1 w-36">
            <option value="mes">Mes</option>
            <option value="trimestre">Trimestre</option>
            <option value="anio">Año</option>
          </Selector>
        </label>
        {tipo !== 'anio' && (
          <label className="text-sm text-slate-600">
            {tipo === 'mes' ? 'Mes' : 'Trimestre'}
            <Selector name="n" defaultValue={String(n)} className="mt-1 w-40">
              {tipo === 'mes'
                ? MESES.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)
                : [1, 2, 3, 4].map((t) => <option key={t} value={t}>T{t}</option>)}
            </Selector>
          </label>
        )}
        <label className="text-sm text-slate-600">
          Año
          <Selector name="anio" defaultValue={String(anio)} className="mt-1 w-32">
            {anios.map((a) => <option key={a} value={a}>{a}</option>)}
          </Selector>
        </label>
        <Boton variante="secundario" type="submit">Ver EERR</Boton>
      </form>

      <Tabla>
        <thead>
          <tr>
            <Th>Cuenta</Th>
            <Th className="text-right">{etActual}</Th>
            <Th className="text-right">{etAnterior}</Th>
            <Th className="text-right">Variación</Th>
          </tr>
        </thead>
        <tbody>
          <Tr className="bg-slate-50"><Td colSpan={4} className="font-semibold text-slate-700">Ingresos</Td></Tr>
          {eerr.ingresos.map(filaCuenta)}
          {eerr.ingresos.length === 0 && (
            <Tr><Td colSpan={4} className="text-slate-500">Sin ingresos en {etActual} ni en {etAnterior}.</Td></Tr>
          )}
          <Tr className="font-medium">
            <Td className="text-right">Total ingresos</Td>
            <Td className="text-right font-mono">{formatearCLP(eerr.totalIngresos.actual)}</Td>
            <Td className="text-right font-mono">{colAnterior(eerr.totalIngresos.anterior)}</Td>
            <Td className="text-right font-mono">{colVariacion(eerr.totalIngresos.actual, eerr.totalIngresos.anterior)}</Td>
          </Tr>
          <Tr className="bg-slate-50"><Td colSpan={4} className="font-semibold text-slate-700">Gastos</Td></Tr>
          {eerr.gastos.map(filaCuenta)}
          {eerr.gastos.length === 0 && (
            <Tr><Td colSpan={4} className="text-slate-500">Sin gastos en {etActual} ni en {etAnterior}.</Td></Tr>
          )}
          <Tr className="font-medium">
            <Td className="text-right">Total gastos</Td>
            <Td className="text-right font-mono">{formatearCLP(eerr.totalGastos.actual)}</Td>
            <Td className="text-right font-mono">{colAnterior(eerr.totalGastos.anterior)}</Td>
            <Td className="text-right font-mono">{colVariacion(eerr.totalGastos.actual, eerr.totalGastos.anterior)}</Td>
          </Tr>
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-slate-300 font-semibold">
            <Td className="text-right">Resultado del período</Td>
            <Td className="text-right font-mono">{formatearCLP(r.actual)}</Td>
            <Td className="text-right font-mono">{colAnterior(r.anterior)}</Td>
            <Td className="text-right font-mono">{colVariacion(r.actual, r.anterior)}</Td>
          </tr>
        </tfoot>
      </Tabla>
    </div>
  )
}
