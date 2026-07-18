import Link from 'next/link'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP, rangoDeMes } from '@suite/core'
import { Boton, Encabezado, Insignia, Tabla, Tarjeta, Td, Th, Tr } from '@suite/ui'
import { exigirContabilidad } from '../../../lib/contabilidad-acceso'
import { BotonAprobarCierre, BotonReabrirEjercicio } from '../../../componentes/acciones-cierre'
import { cerrarEjercicio, reabrirEjercicio } from './acciones'
import { ETIQUETA_REGLA, ETIQUETA_SEVERIDAD, rutaEnlace, type RevisionPeriodo } from './reglas'
import { ETIQUETA_ESTADO, PANEL_ESTADO, TONO_ESTADO } from './semaforo'

interface CuentaHoja {
  id: string
  codigo: string
  nombre: string
  tipo: string
  clave_sistema: string | null
}
interface AsientoAnio {
  id: string
  origen: string
  reversa_de: string | null
  asientos_lineas: { cuenta_id: string; debe: number; haber: number }[]
}
interface LineaPreview {
  codigo: string
  nombre: string
  debe: number
  haber: number
}

export default async function PaginaRevision({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>
}) {
  const { mes: qMes } = await searchParams
  const activa = await exigirContabilidad()
  const supabase = await crearClienteServidor()

  // Período: query param mes=YYYY-MM validado con rangoDeMes; default mes actual
  // (mismo criterio UTC que el mayor).
  const hoy = new Date().toISOString().slice(0, 7)
  const periodo = qMes && rangoDeMes(qMes) ? qMes : hoy
  const anio = Number(periodo.slice(0, 4))
  const mes = Number(periodo.slice(5, 7))
  const p2 = (n: number) => String(n).padStart(2, '0')
  const mesAnterior = mes === 1 ? `${anio - 1}-12` : `${anio}-${p2(mes - 1)}`
  const mesSiguiente = mes === 12 ? `${anio + 1}-01` : `${anio}-${p2(mes + 1)}`
  const etiquetaMes = new Date(Date.UTC(anio, mes - 1, 1)).toLocaleDateString('es-CL', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })

  const { data: revData, error: revError } = await supabase.rpc('revision_periodo', {
    p_empresa: activa.id,
    p_anio: anio,
    p_mes: mes,
  })
  const revision = (revData as unknown as RevisionPeriodo | null) ?? null
  const observaciones = revision?.observaciones ?? []

  // Historia de cierres (RLS: roles contables). Fila 'cerrado' = año cerrado;
  // 'reabierto' queda como historia sin botón.
  const { data: cierres } = await supabase
    .from('cierres_ejercicio')
    .select('anio, estado, resultado, creado_en')
    .eq('empresa_id', activa.id)
    .order('anio', { ascending: false })

  // --- Cierre asistido (regla 7). La RPC solo entrega texto en `detalle`
  // (spec §3.3): la preview se calcula aquí con la MISMA agregación de
  // cerrar_ejercicio, sin crear nada (patrón lecturas-en-página del mayor).
  // ponytail: se asume anio-1 como año a cerrar (es exactamente lo que observa
  // la regla 7); si hubiera un año aún más antiguo abierto con movimientos,
  // cerrar_ejercicio lo rechaza con 'Cierra primero el ejercicio X' y el
  // mensaje llega por EstadoCierre.error.
  const tieneRegla7 = observaciones.some((o) => o.regla === 'ejercicio_anterior_abierto')
  let panelCierre: {
    anio: number
    lineas: LineaPreview[]
    resultado: number
    cuentaUtilidad: CuentaHoja | null
  } | null = null
  if (tieneRegla7) {
    const anioCierre = anio - 1
    const { data: cuentasData } = await supabase
      .from('cuentas_contables')
      .select('id, codigo, nombre, tipo, clave_sistema')
      .eq('empresa_id', activa.id)
      .eq('acepta_movimientos', true)
    const hojas = (cuentasData ?? []) as CuentaHoja[]
    const { data: asientosData } = await supabase
      .from('asientos')
      .select('id, origen, reversa_de, asientos_lineas (cuenta_id, debe, haber)')
      .eq('empresa_id', activa.id)
      .gte('fecha', `${anioCierre}-01-01`)
      .lte('fecha', `${anioCierre}-12-31`)
    const asientosAnio = (asientosData ?? []) as AsientoAnio[]
    // Exclusión de cierres previos y sus reversas ligadas (spec §3.1) — cubre el
    // caso cerrado-y-reabierto, donde ese par vive con fecha 31-dic del mismo año.
    const idsCierre = new Set(asientosAnio.filter((a) => a.origen === 'cierre').map((a) => a.id))
    const neto = new Map<string, number>()
    for (const a of asientosAnio) {
      if (a.origen === 'cierre') continue
      if (a.origen === 'reversa' && a.reversa_de && idsCierre.has(a.reversa_de)) continue
      for (const l of a.asientos_lineas ?? []) {
        neto.set(l.cuenta_id, (neto.get(l.cuenta_id) ?? 0) + l.debe - l.haber)
      }
    }
    const porId = new Map(hojas.map((c) => [c.id, c]))
    const lineas: LineaPreview[] = []
    let resultado = 0
    for (const [cuentaId, n] of neto) {
      const c = porId.get(cuentaId)
      if (!c || (c.tipo !== 'ingreso' && c.tipo !== 'gasto') || n === 0) continue
      // Línea inversa que deja la cuenta en 0: saldo acreedor (n < 0) se debita.
      lineas.push({ codigo: c.codigo, nombre: c.nombre, debe: n < 0 ? -n : 0, haber: n > 0 ? n : 0 })
      resultado += -n
    }
    lineas.sort((a, b) => a.codigo.localeCompare(b.codigo))
    panelCierre = {
      anio: anioCierre,
      lineas,
      resultado,
      cuentaUtilidad: hojas.find((c) => c.clave_sistema === 'utilidad_ejercicio') ?? null,
    }
  }

  return (
    <div>
      <Encabezado titulo="Revisión del período" />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link href={`/contabilidad/revision?mes=${mesAnterior}`}>
          <Boton variante="secundario">← Mes anterior</Boton>
        </Link>
        <span className="text-lg font-semibold capitalize text-slate-800">{etiquetaMes}</span>
        <Link href={`/contabilidad/revision?mes=${mesSiguiente}`}>
          <Boton variante="secundario">Mes siguiente →</Boton>
        </Link>
      </div>

      {revError && <p className="mb-4 text-sm text-red-600">{revError.message}</p>}

      {revision && (
        <div
          className={`mb-6 max-w-3xl rounded-xl border border-slate-200 border-l-4 p-4 ${PANEL_ESTADO[revision.estado]}`}
        >
          <p className="text-xl font-bold">{ETIQUETA_ESTADO[revision.estado]}</p>
          <p className="text-sm">
            {observaciones.length === 0
              ? 'El Contador Auditor no encontró observaciones en este período.'
              : `${observaciones.length} ${observaciones.length === 1 ? 'observación' : 'observaciones'} en ${etiquetaMes}.`}
          </p>
        </div>
      )}

      {observaciones.length > 0 && (
        <>
          <h2 className="mb-2 text-lg font-semibold text-slate-800">Observaciones</h2>
          <ul className="mb-6 max-w-3xl space-y-2">
            {observaciones.map((o, i) => {
              const ruta = rutaEnlace(o.enlace_tipo, o.enlace_id)
              return (
                <li key={i} className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Insignia tono={TONO_ESTADO[o.severidad]}>{ETIQUETA_SEVERIDAD[o.severidad]}</Insignia>
                    {/* Consumo defensivo declarado en reglas.ts: si la RPC ganara una
                        regla sin título, cae a la etiqueta y luego a la clave cruda. */}
                    <span className="font-medium text-slate-800">{o.titulo || ETIQUETA_REGLA[o.regla] || o.regla}</span>
                    {ruta && (
                      <Link className="ml-auto text-sm text-marca-700 hover:underline" href={ruta}>
                        Ver detalle →
                      </Link>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-slate-600">{o.detalle}</p>
                </li>
              )
            })}
          </ul>
        </>
      )}

      {panelCierre && (
        <Tarjeta className="mb-6 max-w-3xl">
          <h2 className="mb-1 text-lg font-semibold text-slate-800">Cierre de ejercicio {panelCierre.anio}</h2>
          <p className="mb-3 text-sm text-slate-600">
            El Contador Auditor preparó el asiento de cierre: las cuentas de resultado quedan en 0 y el
            resultado pasa a «Utilidad del ejercicio». Es reversible mientras no cierres el año siguiente.
          </p>
          <p className="mb-3 font-medium text-slate-800">
            Esto cierra tu {panelCierre.anio} con {panelCierre.resultado >= 0 ? 'utilidad' : 'pérdida'} de{' '}
            {formatearCLP(Math.abs(panelCierre.resultado))}.
          </p>
          <Tabla>
            <thead>
              <tr>
                <Th>Cuenta</Th>
                <Th className="text-right">Debe</Th>
                <Th className="text-right">Haber</Th>
              </tr>
            </thead>
            <tbody>
              {panelCierre.lineas.map((l) => (
                <Tr key={l.codigo}>
                  <Td>
                    {l.codigo} — {l.nombre}
                  </Td>
                  <Td className="text-right font-mono">{l.debe ? formatearCLP(l.debe) : ''}</Td>
                  <Td className="text-right font-mono">{l.haber ? formatearCLP(l.haber) : ''}</Td>
                </Tr>
              ))}
              {panelCierre.resultado !== 0 && (
                <Tr className="font-medium">
                  <Td>
                    {panelCierre.cuentaUtilidad
                      ? `${panelCierre.cuentaUtilidad.codigo} — ${panelCierre.cuentaUtilidad.nombre}`
                      : 'Utilidad del ejercicio'}
                  </Td>
                  <Td className="text-right font-mono">
                    {panelCierre.resultado < 0 ? formatearCLP(-panelCierre.resultado) : ''}
                  </Td>
                  <Td className="text-right font-mono">
                    {panelCierre.resultado > 0 ? formatearCLP(panelCierre.resultado) : ''}
                  </Td>
                </Tr>
              )}
              {panelCierre.lineas.length === 0 && (
                <Tr>
                  <Td colSpan={3} className="py-4 text-center text-slate-500">
                    El ejercicio {panelCierre.anio} no tiene movimientos de resultado.
                  </Td>
                </Tr>
              )}
            </tbody>
          </Tabla>
          <div className="mt-3">
            <BotonAprobarCierre anio={panelCierre.anio} accion={cerrarEjercicio} />
          </div>
        </Tarjeta>
      )}

      <h2 className="mb-2 text-lg font-semibold text-slate-800">Ejercicios cerrados</h2>
      {(cierres ?? []).length === 0 ? (
        <p className="text-slate-500">Aún no hay ejercicios cerrados.</p>
      ) : (
        <Tabla>
          <thead>
            <tr>
              <Th>Año</Th>
              <Th>Estado</Th>
              <Th className="text-right">Resultado</Th>
              <Th>Cerrado el</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {(cierres ?? []).map((c) => (
              <Tr key={c.anio}>
                <Td className="font-mono">{c.anio}</Td>
                <Td>
                  <Insignia tono={c.estado === 'cerrado' ? 'verde' : 'gris'}>
                    {c.estado === 'cerrado' ? 'Cerrado' : 'Reabierto'}
                  </Insignia>
                </Td>
                <Td className="text-right font-mono">{formatearCLP(c.resultado)}</Td>
                <Td>{new Date(c.creado_en).toLocaleDateString('es-CL')}</Td>
                <Td>
                  {c.estado === 'cerrado' && (
                    <BotonReabrirEjercicio anio={c.anio} accion={reabrirEjercicio} />
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Tabla>
      )}
    </div>
  )
}
