import { headers } from 'next/headers'
import { crearClienteServidor } from '@suite/auth/server'
import { Encabezado } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { FormularioPagos } from '../../../componentes/formulario-pagos'
import { guardarCredencialesMp } from './acciones'

export default async function ConfigPagos() {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />

  const supabase = await crearClienteServidor()
  // Solo para el booleano configurado ✓/✗: el ciphertext jamás se renderiza (espejo de tieneCert).
  const { data: empresa } = await supabase
    .from('empresas')
    .select('mp_access_token_cifrado, mp_webhook_secret_cifrado')
    .eq('id', activa.id)
    .single()
  const configurado = Boolean(empresa?.mp_access_token_cifrado) && Boolean(empresa?.mp_webhook_secret_cifrado)

  const h = await headers()
  const host = h.get('host') ?? ''
  const proto = h.get('x-forwarded-proto') ?? 'https'
  const webhookUrl = `${proto}://${host}/api/webhooks/mercadopago/${activa.id}`

  return (
    <div>
      <Encabezado titulo="Pagos (MercadoPago)" />
      <p className="mb-4 max-w-2xl text-sm text-slate-600">
        Conecta tu cuenta de MercadoPago para cobrar con links de pago. El Access Token y la clave del
        webhook se guardan cifrados; el ERP solo los usa en el servidor.
      </p>
      <FormularioPagos accion={guardarCredencialesMp} configurado={configurado} webhookUrl={webhookUrl} />
    </div>
  )
}
