'use server'

import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@suite/auth/server'
import { cifrar } from '@suite/dte'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import type { EstadoForm } from '../../tipos'

function claveCifrado(): string {
  const clave = process.env.DTE_ENCRYPTION_KEY
  if (!clave) throw new Error('Falta DTE_ENCRYPTION_KEY en el servidor')
  return clave
}

export async function guardarCredencialesMp(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const token = String(formData.get('mp_access_token') ?? '').trim()
  const secret = String(formData.get('mp_webhook_secret') ?? '').trim()
  if (token === '') return { error: 'Ingresa el Access Token de MercadoPago' }
  if (secret === '') return { error: 'Ingresa la clave secreta del webhook' }

  const clave = claveCifrado()
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase
    .from('empresas')
    .update({
      mp_access_token_cifrado: cifrar(Buffer.from(token, 'utf8'), clave),
      mp_webhook_secret_cifrado: cifrar(Buffer.from(secret, 'utf8'), clave),
    })
    .eq('id', activa.id)
    .select('id')
  if (error) return { error: 'No se pudo guardar la configuración de MercadoPago' }
  if ((data ?? []).length === 0) return { error: 'No se pudo guardar: solo el dueño o admin puede configurar los pagos' }

  revalidatePath('/configuracion/pagos')
  return {}
}
