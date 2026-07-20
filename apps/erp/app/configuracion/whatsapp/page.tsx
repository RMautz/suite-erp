import { crearClienteServidor } from '@suite/auth/server'
import { Encabezado } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { FormularioWhatsApp } from '../../../componentes/formulario-whatsapp'
import { confirmarVinculo, desvincularWhatsApp, solicitarVinculo } from './acciones'

export default async function ConfigWhatsApp() {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const supabase = await crearClienteServidor()
  // El vinculo verificado activo (a lo mas uno visible aqui; RLS dueno/admin).
  const { data: vinculos } = await supabase
    .from('whatsapp_vinculos')
    .select('id, telefono, verificado_en')
    .eq('empresa_id', activa.id)
    .eq('activo', true)
    .not('verificado_en', 'is', null)
    .order('creado_en', { ascending: false })
    .limit(1)
  const vinculo = vinculos?.[0] ?? null

  return (
    <div>
      <Encabezado titulo="WhatsApp" />
      <p className="mb-4 max-w-2xl text-sm text-slate-600">
        Vincula el teléfono del dueño o admin para conversar con tu ERP por WhatsApp (ventas, cobranza,
        stock, auditor y recordatorios de facturas). Te enviaremos un código de 6 dígitos para verificarlo.
      </p>
      <FormularioWhatsApp
        solicitar={solicitarVinculo}
        confirmar={confirmarVinculo}
        desvincular={desvincularWhatsApp}
        vinculo={vinculo}
      />
    </div>
  )
}
