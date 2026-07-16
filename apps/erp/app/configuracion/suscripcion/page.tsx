import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP } from '@suite/core'
import { Encabezado, Insignia, Tarjeta } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { FormularioPagarSuscripcion } from '../../../componentes/formulario-pagar-suscripcion'
import { pagarSuscripcion } from './acciones'

type Tono = 'verde' | 'amarillo' | 'rojo' | 'gris'

function fmtFecha(iso: string | null): string {
  return iso ? new Date(iso + 'T00:00:00').toLocaleDateString('es-CL') : '—'
}

// Banner por ?resultado= de las rutas de retorno (Task 5). TODOS los valores usados.
const BANNERS: Record<string, { tono: Tono; texto: string }> = {
  'mp-ok': { tono: 'verde', texto: 'Pago recibido. Tu suscripción quedó al día.' },
  'mp-pendiente': { tono: 'amarillo', texto: 'Estamos confirmando tu pago con MercadoPago. Si ya pagaste, se acreditará en unos minutos.' },
  'webpay-ok': { tono: 'verde', texto: 'Pago recibido. Tu suscripción quedó al día.' },
  'webpay-fallido': { tono: 'rojo', texto: 'El pago con Webpay no se completó. No se realizó ningún cobro.' },
  'webpay-abortado': { tono: 'gris', texto: 'Cancelaste el pago. No se realizó ningún cobro.' },
}

const ESTADO_PAGO: Record<string, { tono: Tono; texto: string }> = {
  pendiente: { tono: 'amarillo', texto: 'Pendiente' },
  pagado: { tono: 'verde', texto: 'Pagado' },
  abortado: { tono: 'gris', texto: 'Abortado' },
  revision: { tono: 'rojo', texto: 'En revisión' },
}

const PASARELAS: Record<string, string> = { mercadopago: 'MercadoPago', webpay: 'Webpay' }

export default async function PaginaSuscripcion({
  searchParams,
}: {
  searchParams: Promise<{ resultado?: string }>
}) {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin organización activa" />

  const supabase = await crearClienteServidor()

  // Guard rol dueño/admin de la ORG — patrón real del repo (importar.ts): query de
  // `miembros` filtrada por el usuario actual. app.tiene_rol vive en el schema `app`,
  // que el Data API no expone, así que no se llama por .rpc().
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data: miembro } = user
    ? await supabase
        .from('miembros')
        .select('rol')
        .eq('organizacion_id', activa.organizacion_id)
        .eq('usuario_id', user.id)
        .eq('estado', 'activo')
        .maybeSingle()
    : { data: null }
  if (!miembro || (miembro.rol !== 'dueno' && miembro.rol !== 'admin')) {
    return (
      <div>
        <Encabezado titulo="Suscripción" />
        <Tarjeta className="max-w-2xl">
          <p className="text-sm text-slate-600">Solo el dueño o el administrador de la organización pueden gestionar la suscripción.</p>
        </Tarjeta>
      </div>
    )
  }

  const [{ data: org }, { data: suscripcion }, { data: pagos }] = await Promise.all([
    supabase
      .from('organizaciones')
      .select('razon_social, estado, trial_hasta, planes (nombre, precio_clp)')
      .eq('id', activa.organizacion_id)
      .single(),
    supabase.from('suscripciones').select('hasta').eq('organizacion_id', activa.organizacion_id).maybeSingle(),
    supabase
      .from('pagos_suscripcion')
      .select('id, creado_en, pasarela, monto, estado')
      .eq('organizacion_id', activa.organizacion_id)
      .order('creado_en', { ascending: false }),
  ])

  const plan = org?.planes
  const hasta = suscripcion?.hasta ?? null
  const hoy = new Date().toISOString().slice(0, 10)
  const vencida = hasta !== null && hasta < hoy

  const { resultado } = await searchParams
  const banner = resultado ? BANNERS[resultado] : undefined

  return (
    <div>
      <Encabezado titulo="Suscripción" />

      {banner && (
        <div className="mb-4">
          <Insignia tono={banner.tono}>{banner.texto}</Insignia>
        </div>
      )}

      <Tarjeta className="mb-4 max-w-2xl">
        <h2 className="mb-2 text-lg font-semibold text-slate-800">{org?.razon_social}</h2>
        <dl className="grid grid-cols-1 gap-1 text-sm text-slate-600 sm:grid-cols-2">
          <div>Plan: <span className="font-medium text-slate-800">{plan?.nombre ?? '—'}</span></div>
          <div>Precio mensual: <span className="font-medium text-slate-800">{plan ? formatearCLP(plan.precio_clp) : '—'}</span></div>
        </dl>
        <div className="mt-3">
          {org?.estado === 'trial' && <Insignia tono="amarillo">Período de prueba hasta el {fmtFecha(org.trial_hasta)}</Insignia>}
          {org?.estado === 'suspendida' && <Insignia tono="rojo">Organización suspendida. Contáctanos para reactivarla.</Insignia>}
          {org?.estado === 'activa' && !vencida && <Insignia tono="verde">Activa hasta el {fmtFecha(hasta)}</Insignia>}
          {org?.estado === 'activa' && vencida && <Insignia tono="rojo">Vencida el {fmtFecha(hasta)}</Insignia>}
        </div>
      </Tarjeta>

      {plan && plan.precio_clp > 0 ? (
        <Tarjeta className="mb-4 max-w-2xl">
          <h3 className="mb-1 text-sm font-medium text-slate-700">Pagar 1 mes</h3>
          <p className="mb-4 text-sm text-slate-600">
            Extiende tu suscripción un mes ({formatearCLP(plan.precio_clp)}). Elige un medio de pago.
          </p>
          <FormularioPagarSuscripcion accion={pagarSuscripcion} />
        </Tarjeta>
      ) : (
        <Tarjeta className="mb-4 max-w-2xl">
          <p className="text-sm text-slate-600">Tu plan actual no requiere pago.</p>
        </Tarjeta>
      )}

      <Tarjeta className="max-w-2xl">
        <h3 className="mb-3 text-sm font-medium text-slate-700">Historial de pagos</h3>
        {(pagos ?? []).length === 0 ? (
          <p className="text-sm text-slate-400">Aún no hay pagos registrados.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="pb-2 font-medium">Fecha</th>
                <th className="pb-2 font-medium">Medio</th>
                <th className="pb-2 font-medium">Monto</th>
                <th className="pb-2 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody>
              {(pagos ?? []).map((p) => {
                const est = ESTADO_PAGO[p.estado] ?? { tono: 'gris' as Tono, texto: p.estado }
                return (
                  <tr key={p.id} className="border-t border-slate-100">
                    <td className="py-2">{new Date(p.creado_en).toLocaleDateString('es-CL')}</td>
                    <td className="py-2">{PASARELAS[p.pasarela] ?? p.pasarela}</td>
                    <td className="py-2 tabular-nums">{formatearCLP(p.monto)}</td>
                    <td className="py-2"><Insignia tono={est.tono}>{est.texto}</Insignia></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Tarjeta>
    </div>
  )
}
