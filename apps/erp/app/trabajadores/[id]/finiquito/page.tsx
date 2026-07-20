import Link from 'next/link'
import { notFound } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP, formatearRut } from '@suite/core'
import { Encabezado, Insignia, Tarjeta } from '@suite/ui'
import { AccionesFiniquito } from '../../../../componentes/acciones-finiquito'
import { BotonImprimir } from '../../../../componentes/boton-imprimir'
import { FormularioFiniquito } from '../../../../componentes/formulario-finiquito'
import { exigirRRHH } from '../../../../lib/rrhh-acceso'
import { ETIQUETA_CAUSAL } from '../../catalogos'

const TONO_FINIQUITO: Record<string, 'verde' | 'amarillo' | 'rojo' | 'gris'> = {
  emitido: 'amarillo',
  pagado: 'verde',
}
const ETIQUETA_FINIQUITO: Record<string, string> = { emitido: 'Emitido', pagado: 'Pagado' }

const fmtFecha = (f: string | null) =>
  f ? new Date(f + 'T00:00:00').toLocaleDateString('es-CL') : '—'

function Linea({ concepto, monto }: { concepto: string; monto: number }) {
  return (
    <div className="flex justify-between gap-2 py-0.5 text-sm">
      <span>{concepto}</span>
      <span className="font-mono">{formatearCLP(monto)}</span>
    </div>
  )
}

export default async function PaginaFiniquito({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const activa = await exigirRRHH()
  const supabase = await crearClienteServidor()

  const { data: trabajador } = await supabase
    .from('trabajadores')
    .select('id, nombre, rut')
    .eq('id', id)
    .eq('empresa_id', activa.id)
    .single()
  if (!trabajador) notFound()

  // Contratos ANTES que el finiquito: la decisión formulario-vs-detalle es POR
  // CONTRATO (el unique parcial es por contrato — recontratar tras finiquitar
  // deja finiquitos históricos no-anulados). Orden ASC por fecha_inicio:
  // [0] = PRIMER contrato (continuidad laboral, spec §2.4).
  const { data: contratos } = await supabase
    .from('contratos')
    .select('id, fecha_inicio, sueldo_base, vigente')
    .eq('empresa_id', activa.id)
    .eq('trabajador_id', id)
    .order('fecha_inicio', { ascending: true })
  const vigente = (contratos ?? []).find((c) => c.vigente)
  const primero = (contratos ?? [])[0]

  // Finiquito no-anulado más RECIENTE del trabajador (puede haber más de uno
  // con recontrataciones: el unique parcial es por contrato — jamás
  // maybeSingle, que con 2 filas daría PGRST116).
  const { data: fins } = await supabase
    .from('finiquitos')
    .select('*')
    .eq('empresa_id', activa.id)
    .eq('trabajador_id', id)
    .neq('estado', 'anulado')
    .order('emitido_en', { ascending: false })
    .limit(1)
  const fin = (fins ?? [])[0]

  // Contrato vigente SIN finiquito propio → FORMULARIO (cubre al recontratado:
  // su finiquito viejo queda como historia y no bloquea la nueva emisión).
  const emitible = vigente != null && (!fin || fin.contrato_id !== vigente.id)

  if (fin && !emitible) {
    // ---------- DETALLE: documento imprimible (patrón liquidaciones/[id]) ----------
    const { data: asiento } = await supabase
      .from('asientos')
      .select('id, numero')
      .eq('empresa_id', activa.id)
      .eq('origen', 'finiquito')
      .eq('referencia_id', fin.id)
      .maybeSingle()

    return (
      <div>
        <div className="print:hidden">
          <Encabezado titulo={`Finiquito — ${trabajador.nombre}`}>
            <Insignia tono={TONO_FINIQUITO[fin.estado] ?? 'gris'}>
              {ETIQUETA_FINIQUITO[fin.estado] ?? fin.estado}
            </Insignia>
            <BotonImprimir />
          </Encabezado>
        </div>

        <div className="mb-4 hidden print:block">
          <h1 className="text-xl font-bold">{activa.razon_social}</h1>
          <p className="text-sm text-slate-600">{formatearRut(activa.rut)}</p>
          <h2 className="mt-2 text-lg font-semibold">FINIQUITO DE CONTRATO DE TRABAJO</h2>
        </div>

        <Tarjeta className="mb-4 max-w-3xl">
          <p><strong>Empleador:</strong> {activa.razon_social} ({formatearRut(activa.rut)})</p>
          <p className="mt-1"><strong>Trabajador:</strong> {trabajador.nombre} ({formatearRut(trabajador.rut)})</p>
          <p className="mt-1 text-sm text-slate-600">
            Causal: {ETIQUETA_CAUSAL[fin.causal] ?? fin.causal} · Fecha de término: {fmtFecha(fin.fecha_termino)}
          </p>
          {/* Snapshot de contexto (spec §2.5): el finiquito se explica solo aunque
              cambien contrato o indicadores. */}
          <p className="mt-1 text-sm text-slate-600">
            Sueldo base: {formatearCLP(fin.sueldo_base)} · UF del período: {formatearCLP(fin.uf)}
            {fin.causal === 'necesidades_empresa' && <> · Aviso previo: {fin.aviso_dado ? 'dado' : 'no dado'}</>}
          </p>
          {fin.emitido_en && (
            <p className="mt-1 text-sm text-slate-600">
              Emitido el {new Date(fin.emitido_en).toLocaleDateString('es-CL')}
              {fin.pagado_en && <> · Pagado el {new Date(fin.pagado_en).toLocaleDateString('es-CL')}</>}
            </p>
          )}
          {fin.comentario && <p className="mt-1 text-sm text-slate-600">Comentario: {fin.comentario}</p>}
        </Tarjeta>

        <Tarjeta className="max-w-3xl">
          <h3 className="mb-2 border-b border-slate-200 pb-1 text-sm font-semibold uppercase text-slate-600">
            Desglose
          </h3>
          <Linea
            concepto={`Indemnización por años de servicio (${fin.anos_servicio} ${fin.anos_servicio === 1 ? 'año' : 'años'})`}
            monto={fin.indemnizacion_anos}
          />
          <Linea concepto="Indemnización sustitutiva del aviso previo" monto={fin.indemnizacion_aviso} />
          <Linea
            concepto={`Feriado proporcional (${Number(fin.feriado_dias).toLocaleString('es-CL')} días)`}
            monto={fin.feriado_monto}
          />
          <Linea concepto="Otros haberes" monto={fin.otros_haberes} />
          <Linea concepto="Otros descuentos" monto={-fin.otros_descuentos} />
        </Tarjeta>

        <div className="mt-4 flex max-w-3xl items-center justify-between rounded-md bg-slate-100 px-4 py-3 text-xl font-semibold">
          <span>TOTAL FINIQUITO</span>
          <span className="font-mono">{formatearCLP(fin.total)}</span>
        </div>

        {/* Nota v1 DECLARADA (spec §3.5): sale también en la impresión. */}
        <p className="mt-3 max-w-3xl text-xs text-slate-500">
          Simplificación v1: el feriado se calcula sobre el saldo en días hábiles, sin conversión a
          días corridos y sin cotizaciones previsionales; el contador puede ajustar la diferencia
          con un asiento manual.
        </p>

        {/* Línea de firmas: solo tiene sentido en el papel. */}
        <div className="mt-16 hidden max-w-3xl grid-cols-2 gap-16 print:grid">
          <div className="border-t border-slate-500 pt-2 text-center text-sm">
            <p>{activa.razon_social}</p>
            <p className="text-slate-600">Empleador</p>
          </div>
          <div className="border-t border-slate-500 pt-2 text-center text-sm">
            <p>{trabajador.nombre}</p>
            <p className="text-slate-600">Trabajador</p>
          </div>
        </div>

        <div className="mt-6 max-w-3xl print:hidden">
          {asiento ? (
            <p className="text-sm text-slate-600">
              Contabilizado en el{' '}
              <Link className="text-marca-700 hover:underline" href={`/contabilidad/asientos/${asiento.id}`}>
                Asiento N° {asiento.numero}
              </Link>.
            </p>
          ) : (
            <p className="text-sm text-slate-500">
              Sin asiento contable todavía: se genera con Contabilizar pendientes si el módulo de
              contabilidad está activo.
            </p>
          )}
        </div>

        <div className="mt-4 print:hidden">
          <AccionesFiniquito finiquitoId={fin.id} trabajadorId={trabajador.id} estado={fin.estado} />
        </div>
      </div>
    )
  }

  // ---------- FORMULARIO: contrato vigente sin finiquito propio ----------
  // (contratos/vigente/primero ya cargados arriba, antes de la decisión.)
  if (!vigente || !primero) {
    return (
      <div>
        <Encabezado titulo={`Finiquito — ${trabajador.nombre}`} />
        <Tarjeta className="max-w-xl">
          <p className="text-slate-600">
            El trabajador no tiene contrato vigente.{' '}
            <Link className="text-marca-700 hover:underline" href={`/trabajadores/${trabajador.id}`}>
              Volver a la ficha
            </Link>.
          </p>
        </Tarjeta>
      </div>
    )
  }

  const [{ data: tomas }, { data: inds }] = await Promise.all([
    supabase
      .from('vacaciones_tomadas')
      .select('dias_habiles')
      .eq('empresa_id', activa.id)
      .eq('trabajador_id', id),
    // UF por período (últimos 12, patrón liquidaciones/generar): la preview
    // resuelve la UF con el período de la fecha de término elegida.
    supabase
      .from('indicadores_previsionales')
      .select('periodo, uf')
      .order('periodo', { ascending: false })
      .limit(12),
  ])
  const diasTomados = (tomas ?? []).reduce((s, t) => s + t.dias_habiles, 0)
  const ufPorPeriodo = Object.fromEntries((inds ?? []).map((i) => [i.periodo, i.uf]))

  return (
    <div>
      <Encabezado titulo={`Emitir finiquito — ${trabajador.nombre}`} />
      <FormularioFiniquito
        trabajador={{ id: trabajador.id, nombre: trabajador.nombre, rut: trabajador.rut }}
        fechaInicioPrimerContrato={primero.fecha_inicio}
        sueldoBase={vigente.sueldo_base}
        diasTomados={diasTomados}
        ufPorPeriodo={ufPorPeriodo}
      />
    </div>
  )
}
