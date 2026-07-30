import { notFound } from 'next/navigation'
import { clienteAdmin } from '@suite/auth/admin'
import { formatearCLP } from '@suite/core'
import { Encabezado, Tarjeta } from '@suite/ui'
import { FormularioMockPago } from '../../../componentes/formulario-mock-pago'
import { simularPago } from './acciones'

export default async function MockPago({ params }: { params: Promise<{ id: string }> }) {
  // Simulador SOLO dev: fuera de modo mock la ruta no existe.
  if (process.env.PASARELA_PAGOS !== 'mock') notFound()
  const { id } = await params
  // El pagador no tiene sesión ERP: admin (service_role) para leer el link por su preferencia.
  const admin = clienteAdmin()
  const { data: link } = await admin
    .from('links_pago')
    .select('id, empresa_id, origen_tipo, origen_id, monto, estado')
    .eq('preferencia_id', id)
    .maybeSingle()
  if (!link) notFound()

  return (
    <div className="mx-auto max-w-lg p-8">
      <Encabezado titulo="Pago simulado (MercadoPago)" />
      <Tarjeta>
        <p className="text-sm text-slate-600">Entorno de prueba: no se cobra dinero real.</p>
        <p className="mt-4 text-3xl font-semibold text-slate-900">{formatearCLP(link.monto)}</p>
        <p className="mt-1 text-sm text-slate-500">
          {link.estado === 'pagado'
            ? 'Este link ya figura como pagado; volver a simular no duplica el pago.'
            : 'Presiona el botón para simular un pago aprobado.'}
        </p>
        <div className="mt-6">
          <FormularioMockPago accion={simularPago} preferenciaId={id} />
        </div>
      </Tarjeta>
    </div>
  )
}
