import { clienteAdmin } from '@suite/auth/admin'
import { formatearCLP, formatearRut } from '@suite/core'
import { Boton, Encabezado, Insignia, Tabla, Tarjeta, Td, Th, Tr } from '@suite/ui'
import { verificarAdmin } from '../lib/guardia'
import { activarOrganizacion, suspenderOrganizacion } from './acciones'

// Clave 'yyyy-mm' del mes calendario (fechas locales del servidor; la deuda
// timezone Chile es repo-wide y explícitamente no se resuelve aquí).
const claveMes = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

function tonoOrg(estado: string): 'verde' | 'amarillo' | 'rojo' {
  if (estado === 'activa') return 'verde'
  if (estado === 'suspendida') return 'rojo'
  return 'amarillo'
}

function tonoPago(estado: string): 'verde' | 'amarillo' | 'rojo' | 'gris' {
  if (estado === 'pagado') return 'verde'
  if (estado === 'revision') return 'amarillo'
  if (estado === 'abortado') return 'rojo'
  return 'gris'
}

const etiquetaPasarela = (p: string) =>
  p === 'mercadopago' ? 'MercadoPago' : p === 'webpay' ? 'Webpay Plus' : p

export default async function PanelAdmin() {
  await verificarAdmin()
  const admin = clienteAdmin()

  const [{ data: organizaciones, error: errOrg }, { data: pagosData, error: errPagos }] = await Promise.all([
    admin
      .from('organizaciones')
      .select('id, rut, razon_social, estado, trial_hasta, creado_en, planes (nombre, precio_clp), suscripciones (hasta)')
      .order('creado_en', { ascending: false }),
    admin
      .from('pagos_suscripcion')
      .select('id, organizacion_id, monto, pasarela, estado, pagado_en, creado_en')
      .order('creado_en', { ascending: false }),
  ])

  if (errOrg || errPagos) throw new Error('No se pudieron cargar los datos del panel')

  const orgs = organizaciones ?? []
  const pagos = pagosData ?? []

  const hoy = new Date()
  const hoyISO = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`
  const claveMesActual = claveMes(hoy)

  // ----- Agregación de pagos (SOLO 'pagado' suma recaudación) -----
  let recaudadoMes = 0
  let conteoMes = 0
  let totalHistorico = 0
  let conteoTotal = 0
  const serie = new Map<string, number>()
  const porPasarelaMap = new Map<string, { monto: number; conteo: number }>()

  for (const p of pagos) {
    if (p.estado !== 'pagado') continue
    const monto = p.monto ?? 0
    totalHistorico += monto
    conteoTotal += 1
    const pp = porPasarelaMap.get(p.pasarela) ?? { monto: 0, conteo: 0 }
    pp.monto += monto
    pp.conteo += 1
    porPasarelaMap.set(p.pasarela, pp)
    if (p.pagado_en) {
      const clave = claveMes(new Date(p.pagado_en))
      serie.set(clave, (serie.get(clave) ?? 0) + monto)
      if (clave === claveMesActual) {
        recaudadoMes += monto
        conteoMes += 1
      }
    }
  }

  // Serie de los últimos 6 meses (incluye el actual; meses sin pagos = 0).
  const meses = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - (5 - i), 1)
    const clave = claveMes(d)
    return { clave, etiqueta: d.toLocaleDateString('es-CL', { month: 'short' }), monto: serie.get(clave) ?? 0 }
  })
  const maxMes = Math.max(1, ...meses.map((m) => m.monto))
  const hayRecaudacion = meses.some((m) => m.monto > 0)

  const pasarelas = [
    { etiqueta: 'MercadoPago', ...(porPasarelaMap.get('mercadopago') ?? { monto: 0, conteo: 0 }) },
    { etiqueta: 'Webpay Plus', ...(porPasarelaMap.get('webpay') ?? { monto: 0, conteo: 0 }) },
  ]
  const maxPasarela = Math.max(1, ...pasarelas.map((p) => p.monto))

  const revision = pagos.filter((p) => p.estado === 'revision')
  const recientes = pagos.slice(0, 20)
  const razonPorOrg = new Map(orgs.map((o) => [o.id, o.razon_social]))

  // ----- Organizaciones por estado -----
  const activas = orgs.filter((o) => o.estado === 'activa').length
  const enTrial = orgs.filter((o) => o.estado === 'trial').length
  const suspendidas = orgs.filter((o) => o.estado === 'suspendida').length
  // Vencida: activa con suscripción cuyo 'hasta' ya pasó (subconjunto de las activas).
  const vencidaIds = new Set(
    orgs
      .filter((o) => o.estado === 'activa' && !!o.suscripciones?.hasta && o.suscripciones.hasta < hoyISO)
      .map((o) => o.id)
  )

  const fechaCorta = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('es-CL') : '—')
  const fechaDia = (dia: string | null) => (dia ? new Date(dia + 'T00:00:00').toLocaleDateString('es-CL') : '—')

  return (
    <div className="space-y-6">
      <Encabezado titulo="Recaudación y organizaciones" />

      {revision.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-5">
          <p className="font-semibold text-red-800">
            ⚠ {revision.length} pago{revision.length === 1 ? '' : 's'} en revisión — dinero cobrado sin acreditar
          </p>
          <table className="mt-3 w-full text-left text-sm">
            <thead>
              <tr className="text-red-700">
                <th className="py-1 pr-4 font-medium">Fecha</th>
                <th className="py-1 pr-4 font-medium">Organización</th>
                <th className="py-1 pr-4 font-medium">Pasarela</th>
                <th className="py-1 font-medium">Monto</th>
              </tr>
            </thead>
            <tbody>
              {revision.map((p) => (
                <tr key={p.id} className="border-t border-red-100 text-red-900">
                  <td className="py-1 pr-4 tabular-nums">{fechaCorta(p.pagado_en ?? p.creado_en)}</td>
                  <td className="py-1 pr-4">{razonPorOrg.get(p.organizacion_id) ?? '—'}</td>
                  <td className="py-1 pr-4">{etiquetaPasarela(p.pasarela)}</td>
                  <td className="py-1 tabular-nums">{formatearCLP(p.monto)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-red-700">
            Runbook: consulta el estado del cobro en la pasarela y confírmalo por SQL con el service_role antes de acreditar.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tarjeta>
          <p className="text-xs text-slate-400">Recaudado este mes</p>
          <p className="text-2xl font-bold tabular-nums tracking-tight text-emerald-600">{formatearCLP(recaudadoMes)}</p>
          <p className="text-xs text-slate-500">
            {conteoMes} pago{conteoMes === 1 ? '' : 's'} acreditado{conteoMes === 1 ? '' : 's'}
          </p>
        </Tarjeta>
        <Tarjeta>
          <p className="text-xs text-slate-400">Total histórico</p>
          <p className="text-2xl font-bold tabular-nums tracking-tight text-slate-900">{formatearCLP(totalHistorico)}</p>
          <p className="text-xs text-slate-500">
            {conteoTotal} pago{conteoTotal === 1 ? '' : 's'} en total
          </p>
        </Tarjeta>
        <Tarjeta>
          <p className="text-xs text-slate-400">Pagos este mes</p>
          <p className="text-2xl font-bold tabular-nums tracking-tight text-marca-700">{conteoMes}</p>
          <p className="text-xs text-slate-500">suscripciones acreditadas</p>
        </Tarjeta>
        <Tarjeta>
          <p className="text-xs text-slate-400">Organizaciones</p>
          <p className="text-2xl font-bold tabular-nums tracking-tight text-slate-900">{orgs.length}</p>
          <p className="text-xs text-slate-500">
            {activas} activas · {enTrial} trial · {suspendidas} suspendidas
          </p>
          {vencidaIds.size > 0 && (
            <p className="text-xs font-medium text-red-600">
              de ellas {vencidaIds.size} vencida{vencidaIds.size === 1 ? '' : 's'}
            </p>
          )}
        </Tarjeta>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.5fr_1fr]">
        <Tarjeta>
          <h2 className="mb-3 text-sm font-medium text-slate-600">Recaudación últimos 6 meses</h2>
          {!hayRecaudacion ? (
            <p className="py-10 text-center text-sm text-slate-400">Aún no hay recaudación en los últimos 6 meses.</p>
          ) : (
            <div className="flex h-40 items-end gap-2">
              {meses.map((m) => (
                <div
                  key={m.clave}
                  className="flex h-full flex-1 flex-col justify-end"
                  title={`${m.etiqueta}: ${formatearCLP(m.monto)}`}
                >
                  <span
                    className="block min-h-0.5 rounded-t-sm bg-gradient-to-b from-marca-400 to-marca-600"
                    style={{ height: `${Math.round((m.monto / maxMes) * 100)}%` }}
                  />
                  <span className="mt-1 text-center text-[10px] tabular-nums text-slate-400">{m.etiqueta}</span>
                </div>
              ))}
            </div>
          )}
        </Tarjeta>
        <Tarjeta>
          <h2 className="mb-3 text-sm font-medium text-slate-600">Recaudación por pasarela</h2>
          <div className="space-y-3">
            {pasarelas.map((p) => (
              <div key={p.etiqueta} className="text-sm">
                <div className="mb-0.5 flex justify-between">
                  <span className="font-medium text-slate-800">{p.etiqueta}</span>
                  <span className="tabular-nums text-slate-500">
                    {formatearCLP(p.monto)} · {p.conteo}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <span
                    className="block h-full rounded-full bg-gradient-to-r from-cyan-400 to-marca-600"
                    style={{ width: `${Math.round((p.monto / maxPasarela) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Tarjeta>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-medium text-slate-600">Organizaciones ({orgs.length})</h2>
        {orgs.length === 0 ? (
          <p className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">
            Aún no hay organizaciones registradas.
          </p>
        ) : (
          <Tabla>
            <thead>
              <Tr>
                <Th>RUT</Th>
                <Th>Razón social</Th>
                <Th>Plan</Th>
                <Th>Estado</Th>
                <Th>Trial hasta</Th>
                <Th>Suscrita hasta</Th>
                <Th>Acciones</Th>
              </Tr>
            </thead>
            <tbody>
              {orgs.map((org) => (
                <Tr key={org.id}>
                  <Td className="tabular-nums">{formatearRut(org.rut)}</Td>
                  <Td className="font-medium text-slate-900">{org.razon_social}</Td>
                  <Td>
                    {org.planes?.nombre ?? '—'}
                    {org.planes && (
                      <span className="block text-xs text-slate-400">{formatearCLP(org.planes.precio_clp)}/mes</span>
                    )}
                  </Td>
                  <Td>
                    <Insignia tono={tonoOrg(org.estado)}>{org.estado}</Insignia>
                    {vencidaIds.has(org.id) && <span className="ml-2 text-xs font-medium text-red-600">● Vencida</span>}
                  </Td>
                  <Td className="tabular-nums">{fechaDia(org.trial_hasta)}</Td>
                  <Td className="tabular-nums">{fechaDia(org.suscripciones?.hasta ?? null)}</Td>
                  <Td>
                    <div className="flex gap-2">
                      <form action={activarOrganizacion}>
                        <input type="hidden" name="id" value={org.id} />
                        <Boton type="submit" variante="secundario" disabled={org.estado === 'activa'}>
                          Activar
                        </Boton>
                      </form>
                      <form action={suspenderOrganizacion}>
                        <input type="hidden" name="id" value={org.id} />
                        <Boton type="submit" variante="peligro" disabled={org.estado === 'suspendida'}>
                          Suspender
                        </Boton>
                      </form>
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Tabla>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-slate-600">Últimos pagos</h2>
        {recientes.length === 0 ? (
          <p className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">
            Aún no hay pagos de suscripción.
          </p>
        ) : (
          <Tabla>
            <thead>
              <Tr>
                <Th>Fecha</Th>
                <Th>Organización</Th>
                <Th>Pasarela</Th>
                <Th>Monto</Th>
                <Th>Estado</Th>
              </Tr>
            </thead>
            <tbody>
              {recientes.map((p) => (
                <Tr key={p.id}>
                  <Td className="tabular-nums">{fechaCorta(p.pagado_en ?? p.creado_en)}</Td>
                  <Td>{razonPorOrg.get(p.organizacion_id) ?? '—'}</Td>
                  <Td>{etiquetaPasarela(p.pasarela)}</Td>
                  <Td className="tabular-nums">{formatearCLP(p.monto)}</Td>
                  <Td>
                    <Insignia tono={tonoPago(p.estado)}>{p.estado}</Insignia>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Tabla>
        )}
      </section>
    </div>
  )
}
