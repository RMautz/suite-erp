import { notFound } from 'next/navigation'
import { clienteAdmin } from '@suite/auth/admin'
import { formatearCLP } from '@suite/core'
import { Encabezado, Tarjeta } from '@suite/ui'
import { FormularioMockSuscripcion } from '../../../componentes/formulario-mock-suscripcion'
import { aprobarMpSuscripcion, aprobarWebpaySuscripcion } from './acciones'

export default async function MockPagoSuscripcion({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ metodo?: string }>
}) {
  // Simulador SOLO modo mock (gate estricto): fuera de él la ruta no existe.
  if (process.env.PASARELA_SUSCRIPCIONES !== 'mock') notFound()
  const { id } = await params
  // [id] = pagoId (contrato unificado). El pagador tiene sesión ERP, pero el simulador lee con
  // admin (service_role) por id: pagos_suscripcion no tiene escritura directa y el lookup no
  // depende de la sesión.
  const admin = clienteAdmin()
  const { data: pago } = await admin
    .from('pagos_suscripcion')
    .select('id, buy_order, pasarela, monto, estado, plan_id')
    .eq('id', id)
    .maybeSingle()
  if (!pago) notFound()
  const { data: plan } = await admin
    .from('planes')
    .select('nombre')
    .eq('id', pago.plan_id)
    .maybeSingle()

  // El método lo trae ?metodo= (lo pone la action de la Task 6 al redirigir); si falta o es
  // inválido, cae al pasarela ya guardado en el pago (ambos coinciden por construcción).
  const { metodo } = await searchParams
  const pasarela = metodo === 'webpay' || metodo === 'mercadopago' ? metodo : pago.pasarela
  const esWebpay = pasarela === 'webpay'
  const nombreMetodo = esWebpay ? 'Webpay Plus' : 'MercadoPago'

  return (
    <div className="mx-auto max-w-lg p-8">
      <Encabezado titulo={'Pago simulado de suscripción (' + nombreMetodo + ')'} />
      <Tarjeta>
        <p className="text-sm text-slate-600">Entorno de prueba: no se cobra dinero real.</p>
        <p className="mt-4 text-sm text-slate-500">{plan?.nombre ?? 'Plan'}</p>
        <p className="mt-1 text-3xl font-semibold text-slate-900">{formatearCLP(pago.monto)}</p>
        <p className="mt-1 text-sm text-slate-500">
          {pago.estado === 'pagado'
            ? 'Este pago ya figura como acreditado; volver a simular no lo duplica.'
            : 'Presiona el botón para simular un pago aprobado.'}
        </p>
        <div className="mt-6">
          <FormularioMockSuscripcion
            accion={esWebpay ? aprobarWebpaySuscripcion : aprobarMpSuscripcion}
            pagoId={pago.id}
            etiqueta={esWebpay ? 'Aprobar pago Webpay' : 'Aprobar pago MercadoPago'}
          />
        </div>
      </Tarjeta>
    </div>
  )
}
