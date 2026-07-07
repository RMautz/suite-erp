'use server'

import { revalidatePath } from 'next/cache'
import { clienteAdmin } from '@suite/auth/admin'
import { verificarAdmin } from '../lib/guardia'

async function cambiarEstado(id: string, estado: 'activa' | 'suspendida') {
  await verificarAdmin()
  const admin = clienteAdmin()
  const { error } = await admin.from('organizaciones').update({ estado }).eq('id', id)
  if (error) throw new Error('No se pudo actualizar la organización: ' + error.message)
  revalidatePath('/')
}

export async function activarOrganizacion(formData: FormData) {
  await cambiarEstado(String(formData.get('id')), 'activa')
}

export async function suspenderOrganizacion(formData: FormData) {
  await cambiarEstado(String(formData.get('id')), 'suspendida')
}
