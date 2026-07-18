import Link from 'next/link'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP } from '@suite/core'
import { Boton, Encabezado, Selector, Tabla, Td, Th, Tr } from '@suite/ui'
import { exigirContabilidad } from '../../../lib/contabilidad-acceso'
import { aniosConAsientos, obtenerBalance, type FilaBalance } from './calculo'

// Celda numérica vacía cuando es 0 (lectura de libro contable, patrón diario/mayor).
const celda = (n: number) => (n ? formatearCLP(n) : '')

export default async function PaginaBalance({
  searchParams,
}: {
  searchParams: Promise<{ anio?: string }>
}) {
  const { anio: qAnio } = await searchParams
  const activa = await exigirContabilidad()
  const supabase = await crearClienteServidor()

  const anios = await aniosConAsientos(supabase, activa.id)
  if (anios.length === 0) {
    return (
      <div>
        <Encabezado titulo="Balance de 8 columnas" />
        <p className="text-slate-500">Aún no hay asientos. Emite un documento o usa Contabilizar pendientes.</p>
      </div>
    )
  }
  const anioActual = new Date().getFullYear()
  const porDefecto = anios.includes(anioActual) ? anioActual : anios[0]!
  const anio = qAnio && /^\d{4}$/.test(qAnio) && anios.includes(Number(qAnio)) ? Number(qAnio) : porDefecto

  const { filas, resultado, filaResultado, totales, cuadra } = await obtenerBalance(supabase, activa.id, anio)

  const celdas = (f: FilaBalance) => (
    <>
      <Td className="text-right font-mono">{celda(f.debitos)}</Td>
      <Td className="text-right font-mono">{celda(f.creditos)}</Td>
      <Td className="text-right font-mono">{celda(f.saldoDeudor)}</Td>
      <Td className="text-right font-mono">{celda(f.saldoAcreedor)}</Td>
      <Td className="text-right font-mono">{celda(f.activo)}</Td>
      <Td className="text-right font-mono">{celda(f.pasivo)}</Td>
      <Td className="text-right font-mono">{celda(f.perdida)}</Td>
      <Td className="text-right font-mono">{celda(f.ganancia)}</Td>
    </>
  )

  return (
    <div>
      <Encabezado titulo="Balance de 8 columnas">
        <Link href={`/contabilidad/balance/export?anio=${anio}`}>
          <Boton variante="secundario">Exportar CSV</Boton>
        </Link>
      </Encabezado>

      <p className="mb-4 text-lg text-slate-800">
        {resultado > 0 && <>Ganaste <span className="font-semibold">{formatearCLP(resultado)}</span> en {anio}.</>}
        {resultado < 0 && <>Perdiste <span className="font-semibold">{formatearCLP(-resultado)}</span> en {anio}.</>}
        {resultado === 0 && <>Sin utilidad ni pérdida en {anio}.</>}
      </p>

      <form className="mb-4 flex flex-wrap items-end gap-3" action="/contabilidad/balance" method="get">
        <label className="text-sm text-slate-600">
          Ejercicio
          <Selector name="anio" defaultValue={String(anio)} className="mt-1 w-32">
            {anios.map((a) => <option key={a} value={a}>{a}</option>)}
          </Selector>
        </label>
        <Boton variante="secundario" type="submit">Ver balance</Boton>
      </form>

      {!cuadra && (
        <div className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          El balance no cuadra: algún par de columnas difiere. Revisa el libro diario del
          ejercicio (no debería ocurrir: la partida doble está blindada en la base).
        </div>
      )}

      <Tabla>
        <thead>
          <tr>
            <Th rowSpan={2}>Cuenta</Th>
            <Th colSpan={2} className="text-center">Sumas</Th>
            <Th colSpan={2} className="text-center">Saldos</Th>
            <Th colSpan={2} className="text-center">Inventario</Th>
            <Th colSpan={2} className="text-center">Resultados</Th>
          </tr>
          <tr>
            <Th className="text-right">Débitos</Th>
            <Th className="text-right">Créditos</Th>
            <Th className="text-right">Deudor</Th>
            <Th className="text-right">Acreedor</Th>
            <Th className="text-right">Activo</Th>
            <Th className="text-right">Pasivo</Th>
            <Th className="text-right">Pérdida</Th>
            <Th className="text-right">Ganancia</Th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <Tr key={f.codigo}>
              <Td><span className="font-mono">{f.codigo}</span> {f.nombre}</Td>
              {celdas(f)}
            </Tr>
          ))}
          {filas.length === 0 && (
            <Tr><Td colSpan={9} className="py-8 text-center text-slate-500">Sin movimientos en {anio}.</Td></Tr>
          )}
          {filaResultado && (
            <Tr className="bg-slate-50 font-medium">
              <Td>{filaResultado.nombre}</Td>
              {celdas(filaResultado)}
            </Tr>
          )}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-slate-300 font-semibold">
            <Td>Totales</Td>
            <Td className="text-right font-mono">{formatearCLP(totales.debitos)}</Td>
            <Td className="text-right font-mono">{formatearCLP(totales.creditos)}</Td>
            <Td className="text-right font-mono">{formatearCLP(totales.saldoDeudor)}</Td>
            <Td className="text-right font-mono">{formatearCLP(totales.saldoAcreedor)}</Td>
            <Td className="text-right font-mono">{formatearCLP(totales.activo)}</Td>
            <Td className="text-right font-mono">{formatearCLP(totales.pasivo)}</Td>
            <Td className="text-right font-mono">{formatearCLP(totales.perdida)}</Td>
            <Td className="text-right font-mono">{formatearCLP(totales.ganancia)}</Td>
          </tr>
        </tfoot>
      </Tabla>
    </div>
  )
}
