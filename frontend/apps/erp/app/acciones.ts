'use server'

import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { COOKIE_EMPRESA, obtenerEmpresas } from '../lib/empresa-activa'

export async function cambiarEmpresaActiva(formData: FormData) {
  const id = String(formData.get('empresa_id') ?? '')
  const empresas = await obtenerEmpresas()
  if (!empresas.some((e) => e.id === id)) {
    throw new Error('La empresa seleccionada no pertenece a tu organización')
  }
  const almacen = await cookies()
  almacen.set(COOKIE_EMPRESA, id, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 365,
  })
  revalidatePath('/', 'layout')
}

export async function cerrarSesion() {
  const supabase = await crearClienteServidor()
  await supabase.auth.signOut()
  const almacen = await cookies()
  almacen.delete(COOKIE_EMPRESA)
  redirect(process.env.NEXT_PUBLIC_URL_WEB + '/login')
}
