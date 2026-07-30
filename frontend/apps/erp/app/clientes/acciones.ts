'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { limpiarRut, validarRut } from '@suite/core'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import type { EstadoForm } from '../tipos'

export async function guardarCliente(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const id = String(formData.get('id') ?? '')
  const rutCrudo = String(formData.get('rut') ?? '').trim()
  const razonSocial = String(formData.get('razon_social') ?? '').trim()
  const email = String(formData.get('email') ?? '').trim()
  const condicionCruda = String(formData.get('condicion_pago_dias') ?? '').trim()

  if (!validarRut(rutCrudo)) return { error: 'El RUT ingresado no es válido' }
  if (razonSocial === '') return { error: 'La razón social es obligatoria' }
  if (email !== '' && !email.includes('@')) return { error: 'El correo no es válido' }
  const condicionPagoDias = condicionCruda === '' ? 0 : Number(condicionCruda)
  if (!Number.isInteger(condicionPagoDias) || condicionPagoDias < 0 || condicionPagoDias > 120) {
    return { error: 'La condición de pago debe ser un entero entre 0 y 120 días' }
  }

  const datos = {
    rut: limpiarRut(rutCrudo),
    razon_social: razonSocial,
    giro: String(formData.get('giro') ?? '').trim() || null,
    email: email || null,
    telefono: String(formData.get('telefono') ?? '').trim() || null,
    direccion: String(formData.get('direccion') ?? '').trim() || null,
    comuna: String(formData.get('comuna') ?? '').trim() || null,
    condicion_pago_dias: condicionPagoDias,
  }

  const supabase = await crearClienteServidor()
  if (id) {
    const { data, error } = await supabase
      .from('clientes')
      .update(datos)
      .eq('id', id)
      .eq('empresa_id', activa.id)
      .select('id')
    if (error) {
      if (error.code === '23505') return { error: 'Ya existe un cliente con ese RUT' }
      if (error.code === '42501') return { error: 'Tu rol no permite editar clientes' }
      return { error: 'No se pudo guardar el cliente' }
    }
    if ((data ?? []).length === 0) {
      return { error: 'No se pudo guardar: el cliente no existe o tu rol no permite editarlo' }
    }
  } else {
    const { error } = await supabase.from('clientes').insert({ ...datos, empresa_id: activa.id })
    if (error) {
      if (error.code === '23505') return { error: 'Ya existe un cliente con ese RUT' }
      if (error.code === '42501') return { error: 'Tu rol no permite crear clientes' }
      return { error: 'No se pudo crear el cliente' }
    }
  }

  revalidatePath('/clientes')
  redirect('/clientes')
}

export async function alternarActivoCliente(formData: FormData): Promise<void> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return
  const id = String(formData.get('id') ?? '')
  const activo = String(formData.get('activo') ?? '') === 'true'
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase
    .from('clientes')
    .update({ activo: !activo })
    .eq('id', id)
    .eq('empresa_id', activa.id)
    .select('id')
  if (error || (data ?? []).length === 0) {
    console.error('alternarActivo:', error ?? 'sin filas')
    return
  }
  revalidatePath('/clientes')
}
