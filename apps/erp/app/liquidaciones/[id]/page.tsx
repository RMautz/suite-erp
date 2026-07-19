import Link from 'next/link'
import { notFound } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP, formatearRut } from '@suite/core'
import { Encabezado, Insignia, Tarjeta } from '@suite/ui'
import { AccionesLiquidacion } from '../../../componentes/acciones-liquidacion'
import { BotonImprimir } from '../../../componentes/boton-imprimir'
import { exigirRRHH } from '../../../lib/rrhh-acceso'
import { AFP_NOMBRE, ETIQUETA_ESTADO, TONO_ESTADO, etiquetaMes } from '../estados'

function Linea({ concepto, monto, fuerte }: { concepto: string; monto: number; fuerte?: boolean }) {
  return (
    <div
      className={
        fuerte
          ? 'mt-1 flex justify-between gap-2 border-t border-slate-200 py-1 text-sm font-semibold'
          : 'flex justify-between gap-2 py-0.5 text-sm'
      }
    >
      <span>{concepto}</span>
      <span className="font-mono">{formatearCLP(monto)}</span>
    </div>
  )
}

export default async function DetalleLiquidacion({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const activa = await exigirRRHH()
  const supabase = await crearClienteServidor()
  const { data: liq } = await supabase
    .from('liquidaciones')
    .select('*, trabajadores (nombre, rut)')
    .eq('id', id)
    .eq('empresa_id', activa.id)
    .single()
  if (!liq) notFound()

  // Traza contable (patrón P16, como el detalle de asiento a la inversa): el asiento
  // de la liquidación vive en asientos (origen 'remuneracion', referencia_id).
  const { data: asiento } = await supabase
    .from('asientos')
    .select('id, numero')
    .eq('empresa_id', activa.id)
    .eq('origen', 'remuneracion')
    .eq('referencia_id', liq.id)
    .maybeSingle()

  const saludEtiqueta =
    liq.salud === 'fonasa'
      ? 'Salud Fonasa (7%)'
      : `Salud Isapre (plan ${Number(liq.plan_isapre_uf ?? 0).toLocaleString('es-CL')} UF)`

  return (
    <div>
      <div className="print:hidden">
        <Encabezado titulo={`Liquidación ${etiquetaMes(liq.periodo)} — ${liq.trabajadores?.nombre ?? ''}`}>
          <Insignia tono={TONO_ESTADO[liq.estado] ?? 'gris'}>{ETIQUETA_ESTADO[liq.estado] ?? liq.estado}</Insignia>
          {liq.estado !== 'anulada' && <BotonImprimir />}
        </Encabezado>
      </div>

      <div className="mb-4 hidden print:block">
        <h1 className="text-xl font-bold">{activa.razon_social}</h1>
        <p className="text-sm text-slate-600">{formatearRut(activa.rut)}</p>
        <h2 className="mt-2 text-lg font-semibold">LIQUIDACIÓN DE SUELDO — {etiquetaMes(liq.periodo)}</h2>
      </div>

      <Tarjeta className="mb-4 max-w-3xl">
        <p>
          <strong>Trabajador:</strong> {liq.trabajadores?.nombre}{' '}
          {liq.trabajadores && <>({formatearRut(liq.trabajadores.rut)})</>}
        </p>
        <p className="mt-1 text-sm text-slate-600">
          Período: {etiquetaMes(liq.periodo)} · Días trabajados: {liq.dias_trabajados} · Sueldo base:{' '}
          {formatearCLP(liq.sueldo_base)}
        </p>
        {/* Snapshot de contexto (spec §2.4): la liquidación se explica sola aunque
            cambien contrato o indicadores. */}
        <p className="mt-1 text-sm text-slate-600">
          Indicadores del período: UF {formatearCLP(liq.uf)} · UTM {formatearCLP(liq.utm)}
        </p>
        {liq.emitida_en && (
          <p className="mt-1 text-sm text-slate-600">
            Emitida el {new Date(liq.emitida_en).toLocaleDateString('es-CL')}
            {liq.pagada_en && <> · Pagada el {new Date(liq.pagada_en).toLocaleDateString('es-CL')}</>}
          </p>
        )}
        {liq.estado === 'anulada' && liq.motivo_anulacion && (
          <p className="mt-2 text-sm text-red-700"><strong>Motivo de anulación:</strong> {liq.motivo_anulacion}</p>
        )}
      </Tarjeta>

      <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
        <Tarjeta>
          <h3 className="mb-2 border-b border-slate-200 pb-1 text-sm font-semibold uppercase text-slate-600">Haberes</h3>
          <Linea concepto={`Sueldo base proporcional (${liq.dias_trabajados} días)`} monto={liq.sueldo_proporcional} />
          <Linea concepto="Gratificación legal" monto={liq.gratificacion} />
          <Linea concepto="Extras imponibles" monto={liq.extras_imponibles} />
          <Linea concepto="No imponibles (colación y movilización)" monto={liq.no_imponibles} />
          <Linea concepto="Total imponible" monto={liq.total_imponible} fuerte />
        </Tarjeta>
        <Tarjeta>
          <h3 className="mb-2 border-b border-slate-200 pb-1 text-sm font-semibold uppercase text-slate-600">Descuentos</h3>
          <Linea
            concepto={`AFP ${AFP_NOMBRE[liq.afp] ?? liq.afp} (${Number(liq.tasa_afp).toLocaleString('es-CL')}%)`}
            monto={liq.afp_monto}
          />
          <Linea concepto={saludEtiqueta} monto={liq.salud_monto} />
          <Linea concepto="Seguro de cesantía (0,6%)" monto={liq.cesantia_monto} />
          <Linea concepto="Impuesto único" monto={liq.impuesto_unico} />
          <Linea concepto="Total descuentos" monto={liq.total_descuentos} fuerte />
        </Tarjeta>
      </div>

      <div className="mt-4 flex max-w-3xl items-center justify-between rounded-md bg-slate-100 px-4 py-3 text-xl font-semibold">
        <span>TOTAL LÍQUIDO</span>
        <span className="font-mono">{formatearCLP(liq.liquido)}</span>
      </div>

      {/* Límite declarado de la v1 (spec §3): también sale en la impresión. */}
      <p className="mt-3 max-w-3xl text-sm text-slate-500">
        Esta liquidación no incluye los aportes del empleador (SIS y aporte patronal al seguro de
        cesantía); se incorporan en una versión futura.
      </p>

      <div className="mt-6 max-w-3xl print:hidden">
        {asiento ? (
          <p className="text-sm text-slate-600">
            Contabilizada en el{' '}
            <Link className="text-marca-700 hover:underline" href={`/contabilidad/asientos/${asiento.id}`}>
              Asiento N° {asiento.numero}
            </Link>.
          </p>
        ) : (
          liq.estado !== 'anulada' && (
            <p className="text-sm text-slate-500">
              Sin asiento contable todavía: se genera con Contabilizar pendientes si el módulo de
              contabilidad está activo.
            </p>
          )
        )}
      </div>

      <div className="mt-4 print:hidden">
        {liq.estado === 'anulada' ? (
          <p className="text-sm text-slate-600">
            Liquidación anulada: puedes volver a{' '}
            <Link className="text-marca-700 hover:underline" href="/liquidaciones/generar">
              emitir la liquidación del período
            </Link>.
          </p>
        ) : (
          <AccionesLiquidacion liquidacionId={liq.id} estado={liq.estado} />
        )}
      </div>
    </div>
  )
}
