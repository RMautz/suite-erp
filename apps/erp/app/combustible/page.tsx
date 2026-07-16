import Link from 'next/link'
import { notFound } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP, formatearPatente, rangoDeMes } from '@suite/core'
import { Boton, Encabezado, Entrada, Insignia, Selector, Tabla, Td, Th, Tr } from '@suite/ui'
import { BotonEliminarCosto } from '../../componentes/boton-eliminar-costo'
import { FormularioCargaManual } from '../../componentes/formulario-carga-manual'
import { FormularioGasto } from '../../componentes/formulario-gasto'
import { FormularioImportTct } from '../../componentes/formulario-import-tct'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import { crearCargaManual, crearGasto, eliminarCarga, eliminarGasto } from './acciones'
import { ETIQUETA_CATEGORIA } from './categorias'
import { importarCargasTct } from './importar'

const NUM = (n: number) => n.toLocaleString('es-CL', { maximumFractionDigits: 2 })

export default async function PaginaCombustible({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string; vehiculo?: string }>
}) {
  const { mes = '', vehiculo = '' } = await searchParams
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  if (!activa.modulo_transporte) notFound()
  const ahora = new Date()
  const mesActual = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}`
  const mesEfectivo = rangoDeMes(mes) ? mes : mesActual
  // mesActual siempre es 'YYYY-MM' válido: el fallback nunca es null.
  const rango = rangoDeMes(mesEfectivo)!
  const supabase = await crearClienteServidor()
  const [{ data: vehiculos }, consultaCargas, consultaGastos] = await Promise.all([
    supabase.from('vehiculos').select('id, patente, activo').eq('empresa_id', activa.id).order('patente'),
    (() => {
      let q = supabase
        .from('cargas_combustible')
        .select('id, fecha, hora, litros, precio_litro, monto, estacion, guia, origen, vehiculos (patente)')
        .eq('empresa_id', activa.id)
        .gte('fecha', rango.desde)
        .lte('fecha', rango.hasta)
        .order('fecha', { ascending: false })
        .order('hora', { ascending: false, nullsFirst: false })
        .limit(1000)
      if (vehiculo) q = q.eq('vehiculo_id', vehiculo)
      return q
    })(),
    (() => {
      let q = supabase
        .from('gastos_vehiculo')
        .select('id, fecha, categoria, monto, notas, vehiculos (patente)')
        .eq('empresa_id', activa.id)
        .gte('fecha', rango.desde)
        .lte('fecha', rango.hasta)
        .order('fecha', { ascending: false })
        .limit(1000)
      if (vehiculo) q = q.eq('vehiculo_id', vehiculo)
      return q
    })(),
  ])
  const cargas = consultaCargas.data ?? []
  const gastos = consultaGastos.data ?? []
  const activos = (vehiculos ?? []).filter((v) => v.activo)
  const totCargas = cargas.reduce(
    (a, c) => ({ litros: a.litros + c.litros, monto: a.monto + c.monto }),
    { litros: 0, monto: 0 }
  )
  const totGastos = gastos.reduce((a, g) => a + g.monto, 0)
  // Derivadas del mes: lo que Copec entrega como reportes agregados, aquí en vivo.
  const porPatente = new Map<string, { cargas: number; litros: number; monto: number }>()
  const porEstacion = new Map<string, { cargas: number; litros: number; monto: number }>()
  for (const c of cargas) {
    const clavePatente = c.vehiculos ? formatearPatente(c.vehiculos.patente) : '—'
    const acumP = porPatente.get(clavePatente) ?? { cargas: 0, litros: 0, monto: 0 }
    porPatente.set(clavePatente, { cargas: acumP.cargas + 1, litros: acumP.litros + c.litros, monto: acumP.monto + c.monto })
    const claveEstacion = c.estacion ?? '—'
    const acumE = porEstacion.get(claveEstacion) ?? { cargas: 0, litros: 0, monto: 0 }
    porEstacion.set(claveEstacion, { cargas: acumE.cargas + 1, litros: acumE.litros + c.litros, monto: acumE.monto + c.monto })
  }
  const filasPatente = [...porPatente.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  const filasEstacion = [...porEstacion.entries()].sort((a, b) => b[1].monto - a[1].monto)
  return (
    <div>
      <Encabezado titulo="Combustible" />
      <div className="mb-8 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <FormularioImportTct accion={importarCargasTct} />
        <FormularioCargaManual accion={crearCargaManual} vehiculos={activos} />
        <FormularioGasto accion={crearGasto} vehiculos={activos} />
      </div>
      <form className="mb-4 flex flex-wrap items-center gap-3" action="/combustible" method="get">
        <Selector name="vehiculo" defaultValue={vehiculo} className="max-w-xs">
          <option value="">Todos los vehículos</option>
          {(vehiculos ?? []).map((v) => (
            <option key={v.id} value={v.id}>{formatearPatente(v.patente)}{v.activo ? '' : ' (inactivo)'}</option>
          ))}
        </Selector>
        <Entrada type="month" name="mes" defaultValue={mesEfectivo} className="w-40" />
        <Boton variante="secundario" type="submit">Filtrar</Boton>
        <Link className="text-sm text-marca-700 hover:underline" href="/combustible">Limpiar</Link>
      </form>
      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold text-slate-800">Cargas del mes</h2>
        <Tabla>
          <thead>
            <tr>
              <Th>Fecha</Th><Th>Hora</Th><Th>Patente</Th><Th className="text-right">Litros</Th>
              <Th className="text-right">$/L</Th><Th className="text-right">Monto</Th><Th>Estación</Th><Th>Guía</Th><Th>Origen</Th><Th />
            </tr>
          </thead>
          <tbody>
            {cargas.map((c) => (
              <Tr key={c.id}>
                <Td>{new Date(c.fecha + 'T00:00:00').toLocaleDateString('es-CL')}</Td>
                <Td className="font-mono">{c.hora ? c.hora.slice(0, 5) : '—'}</Td>
                <Td className="font-mono">{c.vehiculos ? formatearPatente(c.vehiculos.patente) : '—'}</Td>
                <Td className="text-right">{NUM(c.litros)}</Td>
                <Td className="text-right font-mono">{c.precio_litro == null ? '—' : formatearCLP(c.precio_litro)}</Td>
                <Td className="text-right font-mono">{formatearCLP(c.monto)}</Td>
                <Td>{c.estacion ?? '—'}</Td>
                <Td className="font-mono">{c.guia ?? '—'}</Td>
                <Td>{c.origen === 'tct' ? <Insignia tono="verde">TCT</Insignia> : <Insignia tono="gris">Manual</Insignia>}</Td>
                <Td className="text-right"><BotonEliminarCosto id={c.id} accion={eliminarCarga} /></Td>
              </Tr>
            ))}
            {cargas.length === 0 && <Tr><Td colSpan={10} className="py-8 text-center text-slate-500">No hay cargas en {mesEfectivo}{vehiculo ? ' para ese vehículo' : ''}.</Td></Tr>}
          </tbody>
        </Tabla>
        <div className="mt-3 flex flex-wrap justify-end gap-6 text-sm">
          <span>Cargas: <strong>{cargas.length}</strong></span>
          <span>Litros: <strong>{NUM(totCargas.litros)}</strong></span>
          <span>Combustible: <strong className="font-mono">{formatearCLP(totCargas.monto)}</strong></span>
        </div>
      </section>
      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold text-slate-800">Gastos del mes</h2>
        <Tabla>
          <thead>
            <tr><Th>Fecha</Th><Th>Patente</Th><Th>Categoría</Th><Th className="text-right">Monto</Th><Th>Notas</Th><Th /></tr>
          </thead>
          <tbody>
            {gastos.map((g) => (
              <Tr key={g.id}>
                <Td>{new Date(g.fecha + 'T00:00:00').toLocaleDateString('es-CL')}</Td>
                <Td className="font-mono">{g.vehiculos ? formatearPatente(g.vehiculos.patente) : '—'}</Td>
                <Td>{ETIQUETA_CATEGORIA[g.categoria] ?? g.categoria}</Td>
                <Td className="text-right font-mono">{formatearCLP(g.monto)}</Td>
                <Td>{g.notas ?? '—'}</Td>
                <Td className="text-right"><BotonEliminarCosto id={g.id} accion={eliminarGasto} /></Td>
              </Tr>
            ))}
            {gastos.length === 0 && <Tr><Td colSpan={6} className="py-8 text-center text-slate-500">No hay gastos en {mesEfectivo}{vehiculo ? ' para ese vehículo' : ''}.</Td></Tr>}
          </tbody>
        </Tabla>
        <div className="mt-3 flex flex-wrap justify-end gap-6 text-sm">
          <span>Gastos: <strong>{gastos.length}</strong></span>
          <span>Total: <strong className="font-mono">{formatearCLP(totGastos)}</strong></span>
        </div>
      </section>
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-800">Resumen del mes</h2>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-medium text-slate-600">Por patente</h3>
            <Tabla>
              <thead>
                <tr><Th>Patente</Th><Th className="text-right">Cargas</Th><Th className="text-right">Litros</Th><Th className="text-right">Monto</Th></tr>
              </thead>
              <tbody>
                {filasPatente.map(([patente, t]) => (
                  <Tr key={patente}>
                    <Td className="font-mono">{patente}</Td>
                    <Td className="text-right">{t.cargas}</Td>
                    <Td className="text-right">{NUM(t.litros)}</Td>
                    <Td className="text-right font-mono">{formatearCLP(t.monto)}</Td>
                  </Tr>
                ))}
                {filasPatente.length === 0 && <Tr><Td colSpan={4} className="py-8 text-center text-slate-500">Sin cargas que resumir.</Td></Tr>}
              </tbody>
            </Tabla>
          </div>
          <div>
            <h3 className="mb-2 text-sm font-medium text-slate-600">Por estación</h3>
            <Tabla>
              <thead>
                <tr><Th>Estación</Th><Th className="text-right">Cargas</Th><Th className="text-right">Litros</Th><Th className="text-right">Monto</Th></tr>
              </thead>
              <tbody>
                {filasEstacion.map(([estacion, t]) => (
                  <Tr key={estacion}>
                    <Td>{estacion}</Td>
                    <Td className="text-right">{t.cargas}</Td>
                    <Td className="text-right">{NUM(t.litros)}</Td>
                    <Td className="text-right font-mono">{formatearCLP(t.monto)}</Td>
                  </Tr>
                ))}
                {filasEstacion.length === 0 && <Tr><Td colSpan={4} className="py-8 text-center text-slate-500">Sin cargas que resumir.</Td></Tr>}
              </tbody>
            </Tabla>
          </div>
        </div>
      </section>
    </div>
  )
}
