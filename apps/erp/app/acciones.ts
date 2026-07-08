'use server'

import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { COOKIE_EMPRESA, obtenerEmpresas } from '../lib/empresa-activa'

export async function cambiarEmpresaActiva(formData: FormData) {
  const id = String(formData.get('empresa_id') ?? '')
  const empresas = await obtenerEmpresas()
  if (!empresas.some((e) => e.id === id)) {
    throw new Error('La empresa seleccionada no pertenece a tu organización')
  }
  const almacen = await cookies()
  almacen.set(COOKIE_EMPRESA, id, { path: '/', httpOnly: true, sameSite: 'lax' })
  revalidatePath('/', 'layout')
}
