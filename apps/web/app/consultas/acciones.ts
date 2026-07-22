'use server'

import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@suite/auth/server'
import { avisarTicketAdmin } from '../../lib/aviso-ticket'

// Estado type-only (permitido en 'use server': se borra al compilar).
export type EstadoConsulta = { error?: string; ok?: boolean; numero?: number }

// La RPC valida todo (asunto/mensaje/organizacion) con mensajes byte-exactos que se
// muestran tal cual, y retorna el NUMERO del ticket. El aviso por correo al admin es
// best-effort (jamas bloquea el alta).
export async function crearConsulta(_prev: EstadoConsulta, formData: FormData): Promise<EstadoConsulta> {
  const asunto = String(formData.get('asunto') ?? '')
  const mensaje = String(formData.get('mensaje') ?? '')
  const supabase = await crearClienteServidor()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Inicia sesión para enviar una consulta' }
  const { data: numero, error } = await supabase.rpc('crear_consulta_admin', { p_asunto: asunto, p_mensaje: mensaje })
  if (error || numero == null) return { error: error?.message ?? 'No se pudo crear el ticket' }

  // Datos del aviso: la autora ve su propia fila (RLS) y su organizacion.
  const { data: fila } = await supabase
    .from('consultas_admin')
    .select('organizacion_id')
    .eq('numero', numero)
    .maybeSingle()
  const { data: org } = fila
    ? await supabase.from('organizaciones').select('razon_social, rut').eq('id', fila.organizacion_id).maybeSingle()
    : { data: null }
  await avisarTicketAdmin({
    numero: Number(numero),
    organizacion: org?.razon_social ?? '',
    rut: org?.rut ?? '',
    autorEmail: user.email ?? '',
    asunto: asunto.trim(),
    mensaje: mensaje.trim(),
    origen: 'web',
  })

  revalidatePath('/consultas')
  return { ok: true, numero: Number(numero) }
}
