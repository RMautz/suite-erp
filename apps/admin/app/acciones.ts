'use server'

import { revalidatePath } from 'next/cache'
import { clienteAdmin } from '@suite/auth/admin'
import { RUBROS } from '@suite/core'
import { verificarAdmin } from '../lib/guardia'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function cambiarEstado(id: string, estado: 'activa' | 'suspendida') {
  if (!UUID.test(id)) return
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

export async function cambiarRubro(formData: FormData) {
  const empresaId = String(formData.get('empresa_id'))
  const rubro = String(formData.get('rubro'))
  if (!UUID.test(empresaId)) return
  if (!RUBROS.some((r) => r.codigo === rubro)) return
  await verificarAdmin()
  const admin = clienteAdmin()
  const { error } = await admin.rpc('cambiar_rubro', { p_empresa: empresaId, p_rubro: rubro })
  if (error) throw new Error('No se pudo cambiar el rubro: ' + error.message)
  revalidatePath('/')
}
