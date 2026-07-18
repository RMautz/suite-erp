import { notFound } from 'next/navigation'
import Link from 'next/link'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP, rangoDeMes } from '@suite/core'
import { Boton, Encabezado, Entrada, Selector, Tabla, Td, Th, Tr } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'

interface LineaMayor {
  debe: number
  haber: number
  glosa: string | null
}
interface AsientoMayor {
  numero: number
  fecha: string
  glosa: string
  asientos_lineas: LineaMayor[]
}

export default async function PaginaLibroMayor({
  searchParams,
}: {
  searchParams: Promise<{ cuenta?: string; desde?: string; hasta?: string }>
}) {
  const { cuenta: qCuenta, desde: qDesde, hasta: qHasta } = await searchParams
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  if (!activa.modulo_contabilidad) notFound()
  // Guard de rol (paridad con el route de export — lección P12): dueno/admin/contador.
  // El rol YA viene en EmpresaResumen (task de UI) — se reusa sin re-consultar miembros.
  if (!activa.rol || !['dueno', 'admin', 'contador'].includes(activa.rol)) notFound()

  const supabase = await crearClienteServidor()

  const base = rangoDeMes(new Date().toISOString().slice(0, 7))!
  const desde = qDesde && /^\d{4}-\d{2}-\d{2}$/.test(qDesde) ? qDesde : base.desde
  const hasta = qHasta && /^\d{4}-\d{2}-\d{2}$/.test(qHasta) ? qHasta : base.hasta

  // Solo cuentas hoja (reciben líneas). Se incluyen las inactivas: pueden tener
  // movimientos históricos que el mayor debe poder mostrar.
  const { data: cuentas } = await supabase
    .from('cuentas_contables')
    .select('id, codigo, nombre, activa')
    .eq('empresa_id', activa.id)
    .eq('acepta_movimientos', true)
    .order('codigo')
  const hojas = cuentas ?? []
  const cuentaId = qCuenta && hojas.some((c) => c.id === qCuenta) ? qCuenta : ''
  const cuentaSel = hojas.find((c) => c.id === cuentaId) ?? null

  let saldoInicial = 0
  let movimientos: { fecha: string; numero: number; glosa: string; debe: number; haber: number }[] = []
  if (cuentaId) {
    // Saldo inicial: acumulado (debe - haber) de la cuenta ANTES del período.
    const { data: previos } = await supabase
      .from('asientos')
      .select('asientos_lineas!inner (debe, haber, cuenta_id)')
      .eq('empresa_id', activa.id)
      .eq('asientos_lineas.cuenta_id', cuentaId)
      .lt('fecha', desde)
    for (const a of (previos ?? []) as { asientos_lineas: { debe: number; haber: number }[] }[]) {
      for (const l of a.asientos_lineas) saldoInicial += l.debe - l.haber
    }
    // Movimientos del período: cada asiento aporta SOLO sus líneas de esta cuenta
    // (inner join filtrado). Orden por fecha, luego correlativo.
    const { data } = await supabase
      .from('asientos')
      .select('numero, fecha, glosa, asientos_lineas!inner (debe, haber, glosa, cuenta_id)')
      .eq('empresa_id', activa.id)
      .eq('asientos_lineas.cuenta_id', cuentaId)
      .gte('fecha', desde)
      .lte('fecha', hasta)
      .order('fecha')
      .order('numero')
    for (const a of (data ?? []) as AsientoMayor[]) {
      for (const l of a.asientos_lineas) {
        movimientos.push({ fecha: a.fecha, numero: a.numero, glosa: l.glosa ?? a.glosa, debe: l.debe, haber: l.haber })
      }
    }
  }

  const totDebe = movimientos.reduce((a, m) => a + m.debe, 0)
  const totHaber = movimientos.reduce((a, m) => a + m.haber, 0)
  const saldoFinal = saldoInicial + totDebe - totHaber
  let corriente = saldoInicial

  const qs = new URLSearchParams({ cuenta: cuentaId, desde, hasta }).toString()

  return (
    <div>
      <Encabezado titulo="Libro mayor">
        {cuentaId && (
          <Link href={`/contabilidad/mayor/export?${qs}`}>
            <Boton variante="secundario">Exportar CSV</Boton>
          </Link>
        )}
      </Encabezado>
      <form className="mb-4 flex flex-wrap items-end gap-3" action="/contabilidad/mayor" method="get">
        <label className="text-sm text-slate-600">
          Cuenta
          <Selector name="cuenta" defaultValue={cuentaId} className="mt-1 w-96">
            <option value="">Elige una cuenta…</option>
            {hojas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.codigo} — {c.nombre}{c.activa ? '' : ' (inactiva)'}
              </option>
            ))}
          </Selector>
        </label>
        <label className="text-sm text-slate-600">Desde<Entrada type="date" name="desde" defaultValue={desde} className="mt-1 w-44" /></label>
        <label className="text-sm text-slate-600">Hasta<Entrada type="date" name="hasta" defaultValue={hasta} className="mt-1 w-44" /></label>
        <Boton variante="secundario" type="submit">Ver mayor</Boton>
      </form>
      {!cuentaSel ? (
        <p className="text-slate-500">Elige una cuenta para ver su mayor.</p>
      ) : (
        <>
          <h2 className="mb-3 text-lg font-semibold text-slate-800">{cuentaSel.codigo} — {cuentaSel.nombre}</h2>
          <Tabla>
            <thead>
              <tr><Th>Fecha</Th><Th>N°</Th><Th>Glosa</Th><Th className="text-right">Debe</Th><Th className="text-right">Haber</Th><Th className="text-right">Saldo</Th></tr>
            </thead>
            <tbody>
              <Tr className="bg-slate-50">
                <Td colSpan={5} className="text-right font-medium text-slate-600">Saldo inicial</Td>
                <Td className="text-right font-mono">{formatearCLP(saldoInicial)}</Td>
              </Tr>
              {movimientos.map((m, i) => {
                corriente += m.debe - m.haber
                return (
                  <Tr key={i}>
                    <Td>{new Date(m.fecha + 'T00:00:00').toLocaleDateString('es-CL')}</Td>
                    <Td className="font-mono">{m.numero}</Td>
                    <Td>{m.glosa}</Td>
                    <Td className="text-right font-mono">{m.debe ? formatearCLP(m.debe) : ''}</Td>
                    <Td className="text-right font-mono">{m.haber ? formatearCLP(m.haber) : ''}</Td>
                    <Td className="text-right font-mono">{formatearCLP(corriente)}</Td>
                  </Tr>
                )
              })}
              {movimientos.length === 0 && (
                <Tr><Td colSpan={6} className="py-8 text-center text-slate-500">Sin movimientos entre {desde} y {hasta}.</Td></Tr>
              )}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-300 font-semibold">
                <Td colSpan={3} className="text-right">Totales del período</Td>
                <Td className="text-right font-mono">{formatearCLP(totDebe)}</Td>
                <Td className="text-right font-mono">{formatearCLP(totHaber)}</Td>
                <Td className="text-right font-mono">{formatearCLP(saldoFinal)}</Td>
              </tr>
            </tfoot>
          </Tabla>
        </>
      )}
    </div>
  )
}
