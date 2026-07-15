'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { limpiarRut, normalizarPatente, validarPatente, validarRut } from '@suite/core'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import type { EstadoForm } from '../tipos'

export async function guardarVehiculo(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const id = String(formData.get('id') ?? '')
  const descripcion = String(formData.get('descripcion') ?? '').trim()
  const capacidadCruda = String(formData.get('capacidad_kg') ?? '').trim()
  const capacidadKg = capacidadCruda === '' ? null : Number(capacidadCruda)
  if (capacidadKg !== null && (!Number.isInteger(capacidadKg) || capacidadKg < 1)) {
    return { error: 'La capacidad debe ser un entero de kilos mayor a 0 (o dejarse vacía)' }
  }

  const supabase = await crearClienteServidor()
  if (id) {
    // Solo columnas del grant: patente y empresa_id son inmutables (grant por columnas de 0016).
    const { data, error } = await supabase
      .from('vehiculos')
      .update({ descripcion: descripcion || null, capacidad_kg: capacidadKg })
      .eq('id', id)
      .eq('empresa_id', activa.id)
      .select('id')
    if (error) {
      if (error.code === '42501') return { error: 'Tu rol no permite editar vehículos' }
      return { error: 'No se pudo guardar el vehículo' }
    }
    if ((data ?? []).length === 0) {
      return { error: 'No se pudo guardar: el vehículo no existe o tu rol no permite editarlo' }
    }
  } else {
    const patente = normalizarPatente(String(formData.get('patente') ?? ''))
    if (!validarPatente(patente)) {
      return { error: 'La patente no es válida (formatos AAAA00 o AA0000)' }
    }
    const { error } = await supabase.from('vehiculos').insert({
      empresa_id: activa.id,
      patente,
      descripcion: descripcion || null,
      capacidad_kg: capacidadKg,
    })
    if (error) {
      if (error.code === '23505') return { error: 'Ya existe un vehículo con esa patente' }
      if (error.code === '42501') return { error: 'Tu rol no permite crear vehículos' }
      return { error: 'No se pudo crear el vehículo' }
    }
  }
  revalidatePath('/flota')
  redirect('/flota')
}

export async function alternarActivoVehiculo(formData: FormData): Promise<void> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return
  const id = String(formData.get('id') ?? '')
  const activo = String(formData.get('activo') ?? '') === 'true'
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase
    .from('vehiculos')
    .update({ activo: !activo })
    .eq('id', id)
    .eq('empresa_id', activa.id)
    .select('id')
  if (error || (data ?? []).length === 0) {
    console.error('alternarActivoVehiculo:', error ?? 'sin filas')
    return
  }
  revalidatePath('/flota')
}

export async function guardarConductor(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const id = String(formData.get('id') ?? '')
  const nombre = String(formData.get('nombre') ?? '').trim()
  const telefono = String(formData.get('telefono') ?? '').trim()
  if (nombre === '') return { error: 'El nombre es obligatorio' }

  const supabase = await crearClienteServidor()
  if (id) {
    // Solo columnas del grant: rut y empresa_id son inmutables (grant por columnas de 0016).
    const { data, error } = await supabase
      .from('conductores')
      .update({ nombre, telefono: telefono || null })
      .eq('id', id)
      .eq('empresa_id', activa.id)
      .select('id')
    if (error) {
      if (error.code === '42501') return { error: 'Tu rol no permite editar conductores' }
      return { error: 'No se pudo guardar el conductor' }
    }
    if ((data ?? []).length === 0) {
      return { error: 'No se pudo guardar: el conductor no existe o tu rol no permite editarlo' }
    }
  } else {
    const rutCrudo = String(formData.get('rut') ?? '').trim()
    if (!validarRut(rutCrudo)) return { error: 'El RUT ingresado no es válido' }
    const { error } = await supabase.from('conductores').insert({
      empresa_id: activa.id,
      // Normalizado como clientes/proveedores: el check de 0016 exige rut = app.normalizar_rut(rut).
      rut: limpiarRut(rutCrudo),
      nombre,
      telefono: telefono || null,
    })
    if (error) {
      if (error.code === '23505') return { error: 'Ya existe un conductor con ese RUT' }
      if (error.code === '42501') return { error: 'Tu rol no permite crear conductores' }
      return { error: 'No se pudo crear el conductor' }
    }
  }
  revalidatePath('/flota')
  redirect('/flota')
}

export async function alternarActivoConductor(formData: FormData): Promise<void> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return
  const id = String(formData.get('id') ?? '')
  const activo = String(formData.get('activo') ?? '') === 'true'
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase
    .from('conductores')
    .update({ activo: !activo })
    .eq('id', id)
    .eq('empresa_id', activa.id)
    .select('id')
  if (error || (data ?? []).length === 0) {
    console.error('alternarActivoConductor:', error ?? 'sin filas')
    return
  }
  revalidatePath('/flota')
}
