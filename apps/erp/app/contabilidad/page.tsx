import Link from 'next/link'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP } from '@suite/core'
import { Boton, Encabezado, Insignia, Tabla, Tarjeta, Td, Th, Tr } from '@suite/ui'
import { exigirContabilidad } from '../../lib/contabilidad-acceso'
import { BotonContabilizar } from '../../componentes/boton-contabilizar'
import { ETIQUETA_ORIGEN } from './origenes'
import { contabilizarPendientes } from './acciones'
import type { RevisionPeriodo } from './revision/reglas'
import { ETIQUETA_ESTADO, TONO_ESTADO } from './revision/semaforo'

export default async function PaginaContabilidad() {
  const activa = await exigirContabilidad()
  const supabase = await crearClienteServidor()

  // Semáforo del mes actual: misma RPC que /contabilidad/revision.
  const hoy = new Date().toISOString().slice(0, 7)
  const { data: revData } = await supabase.rpc('revision_periodo', {
    p_empresa: activa.id,
    p_anio: Number(hoy.slice(0, 4)),
    p_mes: Number(hoy.slice(5, 7)),
  })
  const revision = (revData as unknown as RevisionPeriodo | null) ?? null

  const { data: asientos } = await supabase
    .from('asientos')
    .select('id, numero, fecha, glosa, origen, asientos_lineas (debe)')
    .eq('empresa_id', activa.id)
    .order('numero', { ascending: false })
    .limit(10)

  return (
    <div>
      <Encabezado titulo="Contabilidad">
        <div className="flex items-center gap-2">
          <Link href="/contabilidad/cuentas"><Boton variante="secundario">Plan de cuentas</Boton></Link>
          <Link href="/contabilidad/asientos"><Boton variante="secundario">Ver asientos</Boton></Link>
          <Link href="/contabilidad/balance"><Boton variante="secundario">Balance</Boton></Link>
          <Link href="/contabilidad/eerr"><Boton variante="secundario">EERR</Boton></Link>
          <Link href="/contabilidad/asientos/nuevo"><Boton>Nuevo asiento</Boton></Link>
        </div>
      </Encabezado>

      <Tarjeta className="mb-4 max-w-3xl">
        <div className="flex flex-wrap items-center gap-3">
          <div className="grow">
            <h2 className="mb-1 text-lg font-semibold text-slate-800">Revisión del mes</h2>
            {revision ? (
              <p className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                <Insignia tono={TONO_ESTADO[revision.estado]}>{ETIQUETA_ESTADO[revision.estado]}</Insignia>
                {revision.observaciones.length === 0
                  ? 'El Contador Auditor no encontró observaciones.'
                  : `${revision.observaciones.length} observación${revision.observaciones.length === 1 ? '' : 'es'} este mes.`}
              </p>
            ) : (
              <p className="text-sm text-slate-500">No se pudo obtener la revisión del mes.</p>
            )}
          </div>
          <Link href="/contabilidad/revision"><Boton variante="secundario">Ver revisión</Boton></Link>
        </div>
      </Tarjeta>

      <Tarjeta className="mb-4 max-w-3xl">
        <h2 className="mb-1 text-lg font-semibold text-slate-800">Contabilizar pendientes</h2>
        <p className="mb-3 text-sm text-slate-600">
          Cada venta, compra, pago y anticipo se contabiliza solo. Si algo se emitió con el
          módulo apagado o quedó fuera, este botón crea los asientos que falten (es idempotente:
          repetirlo sin pendientes no duplica nada).
        </p>
        <BotonContabilizar accion={contabilizarPendientes} />
      </Tarjeta>

      <h2 className="mb-2 text-lg font-semibold text-slate-800">Últimos asientos</h2>
      <Tabla>
        <thead><tr><Th>N°</Th><Th>Fecha</Th><Th>Glosa</Th><Th>Origen</Th><Th className="text-right">Monto</Th></tr></thead>
        <tbody>
          {(asientos ?? []).map((a) => {
            const monto = (a.asientos_lineas ?? []).reduce((s: number, l: { debe: number }) => s + l.debe, 0)
            return (
              <Tr key={a.id}>
                <Td><Link className="text-marca-700 hover:underline" href={`/contabilidad/asientos/${a.id}`}>{a.numero}</Link></Td>
                <Td>{new Date(a.fecha + 'T00:00:00').toLocaleDateString('es-CL')}</Td>
                <Td>{a.glosa}</Td>
                <Td><Insignia tono="gris">{ETIQUETA_ORIGEN[a.origen] ?? a.origen}</Insignia></Td>
                <Td className="text-right font-mono">{formatearCLP(monto)}</Td>
              </Tr>
            )
          })}
          {(asientos ?? []).length === 0 && (
            <Tr><Td colSpan={5} className="py-8 text-center text-slate-500">Aún no hay asientos. Emite un documento o usa Contabilizar pendientes.</Td></Tr>
          )}
        </tbody>
      </Tabla>
    </div>
  )
}
