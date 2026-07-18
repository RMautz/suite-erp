import { Fragment } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP, rangoDeMes } from '@suite/core'
import { Boton, Encabezado, Entrada, Insignia, Tabla, Td, Th, Tr } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { ETIQUETA_ORIGEN } from '../origenes'

interface Linea {
  debe: number
  haber: number
  glosa: string | null
  cuentas_contables: { codigo: string; nombre: string } | null
}
interface Asiento {
  id: string
  numero: number
  fecha: string
  glosa: string
  origen: string
  asientos_lineas: Linea[]
}

export default async function PaginaLibroDiario({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string }>
}) {
  const { desde: qDesde, hasta: qHasta } = await searchParams
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  if (!activa.modulo_contabilidad) notFound()
  // Guard de rol (paridad con el route de export — lección P12): contabilidad es
  // dueno/admin/contador. El rol YA viene en EmpresaResumen (la task de UI lo agregó,
  // leyéndolo de miembros por org con estado activo) — se reusa sin re-consultar.
  if (!activa.rol || !['dueno', 'admin', 'contador'].includes(activa.rol)) notFound()

  const supabase = await crearClienteServidor()

  // Rango por defecto: el mes actual (mismo helper que libro-ventas). Los inputs date
  // dejan al contador elegir cualquier rango; formato inválido → vuelve al mes.
  const base = rangoDeMes(new Date().toISOString().slice(0, 7))!
  const desde = qDesde && /^\d{4}-\d{2}-\d{2}$/.test(qDesde) ? qDesde : base.desde
  const hasta = qHasta && /^\d{4}-\d{2}-\d{2}$/.test(qHasta) ? qHasta : base.hasta

  const { data } = await supabase
    .from('asientos')
    .select('id, numero, fecha, glosa, origen, asientos_lineas (debe, haber, glosa, cuentas_contables (codigo, nombre))')
    .eq('empresa_id', activa.id)
    .gte('fecha', desde)
    .lte('fecha', hasta)
    .order('fecha')
    .order('numero')
  const asientos = (data ?? []) as Asiento[]
  const tot = asientos.reduce(
    (a, x) => {
      for (const l of x.asientos_lineas) {
        a.debe += l.debe
        a.haber += l.haber
      }
      return a
    },
    { debe: 0, haber: 0 }
  )

  return (
    <div>
      <Encabezado titulo="Libro diario">
        <Link href={`/contabilidad/diario/export?desde=${desde}&hasta=${hasta}`}>
          <Boton variante="secundario">Exportar CSV</Boton>
        </Link>
      </Encabezado>
      <form className="mb-4 flex flex-wrap items-end gap-3" action="/contabilidad/diario" method="get">
        <label className="text-sm text-slate-600">Desde<Entrada type="date" name="desde" defaultValue={desde} className="mt-1 w-44" /></label>
        <label className="text-sm text-slate-600">Hasta<Entrada type="date" name="hasta" defaultValue={hasta} className="mt-1 w-44" /></label>
        <Boton variante="secundario" type="submit">Ver período</Boton>
      </form>
      <Tabla>
        <thead>
          <tr><Th>Fecha</Th><Th>N°</Th><Th>Cuenta</Th><Th className="text-right">Debe</Th><Th className="text-right">Haber</Th></tr>
        </thead>
        <tbody>
          {asientos.map((a) => {
            // Debe primero, luego haber (lectura contable clásica).
            const lineas = [...a.asientos_lineas].sort((x, y) => (x.debe > 0 ? 0 : 1) - (y.debe > 0 ? 0 : 1))
            return (
              <Fragment key={a.id}>
                <Tr className="bg-slate-50">
                  <Td>{new Date(a.fecha + 'T00:00:00').toLocaleDateString('es-CL')}</Td>
                  <Td className="font-mono">{a.numero}</Td>
                  <Td colSpan={3}>
                    <span className="font-medium text-slate-700">{a.glosa}</span>{' '}
                    <Insignia tono="gris">{ETIQUETA_ORIGEN[a.origen] ?? a.origen}</Insignia>
                  </Td>
                </Tr>
                {lineas.map((l, i) => (
                  <Tr key={i}>
                    <Td />
                    <Td />
                    <Td>
                      <span className="font-mono">{l.cuentas_contables?.codigo ?? '—'}</span>{' '}
                      {l.cuentas_contables?.nombre ?? ''}
                      {l.glosa ? <span className="text-slate-400"> · {l.glosa}</span> : null}
                    </Td>
                    <Td className="text-right font-mono">{l.debe ? formatearCLP(l.debe) : ''}</Td>
                    <Td className="text-right font-mono">{l.haber ? formatearCLP(l.haber) : ''}</Td>
                  </Tr>
                ))}
              </Fragment>
            )
          })}
          {asientos.length === 0 && (
            <Tr><Td colSpan={5} className="py-8 text-center text-slate-500">Sin asientos entre {desde} y {hasta}.</Td></Tr>
          )}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-slate-300 font-semibold">
            <Td colSpan={3} className="text-right">Totales del período</Td>
            <Td className="text-right font-mono">{formatearCLP(tot.debe)}</Td>
            <Td className="text-right font-mono">{formatearCLP(tot.haber)}</Td>
          </tr>
        </tfoot>
      </Tabla>
      <p className="mt-2 text-right text-sm text-slate-500">
        {tot.debe === tot.haber ? 'Debe = Haber ✓' : 'Descuadre detectado'}
      </p>
    </div>
  )
}
