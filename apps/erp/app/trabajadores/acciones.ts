'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { limpiarRut, nombreCompleto, validarRut } from '@suite/core'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import type { EstadoForm } from '../tipos'
import { AFPS, ISAPRES } from './catalogos'

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/

export async function guardarTrabajador(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const id = String(formData.get('id') ?? '')
  const rutCrudo = String(formData.get('rut') ?? '').trim()
  const nombres = String(formData.get('nombres') ?? '').trim()
  const apellidoPaterno = String(formData.get('apellido_paterno') ?? '').trim()
  const apellidoMaterno = String(formData.get('apellido_materno') ?? '').trim()
  const email = String(formData.get('email') ?? '').trim()
  const fechaNacimiento = String(formData.get('fecha_nacimiento') ?? '').trim()

  if (!validarRut(rutCrudo)) return { error: 'El RUT ingresado no es válido' }
  if (nombres === '') return { error: 'Los nombres son obligatorios' }
  if (apellidoPaterno === '') return { error: 'El apellido paterno es obligatorio' }
  if (email !== '' && !email.includes('@')) return { error: 'El correo no es válido' }
  if (fechaNacimiento !== '' && !FECHA_ISO.test(fechaNacimiento)) {
    return { error: 'La fecha de nacimiento no es válida' }
  }

  const datos = {
    rut: limpiarRut(rutCrudo),
    nombres,
    apellido_paterno: apellidoPaterno,
    apellido_materno: apellidoMaterno || null,
    // ÚNICA vía de escritura de la columna de display (spec §2.1): el resto
    // del sistema sigue leyendo trabajadores.nombre sin cambios.
    nombre: nombreCompleto(nombres, apellidoPaterno, apellidoMaterno || null),
    email: email || null,
    telefono: String(formData.get('telefono') ?? '').trim() || null,
    direccion: String(formData.get('direccion') ?? '').trim() || null,
    fecha_nacimiento: fechaNacimiento || null,
  }

  const supabase = await crearClienteServidor()
  if (id) {
    const { data, error } = await supabase
      .from('trabajadores')
      .update(datos)
      .eq('id', id)
      .eq('empresa_id', activa.id)
      .select('id')
    if (error) {
      if (error.code === '23505') return { error: 'Ya existe un trabajador con ese RUT' }
      if (error.code === '42501') return { error: 'Tu rol no permite editar trabajadores' }
      return { error: 'No se pudo guardar el trabajador' }
    }
    if ((data ?? []).length === 0) {
      return { error: 'No se pudo guardar: el trabajador no existe o tu rol no permite editarlo' }
    }
  } else {
    const { error } = await supabase.from('trabajadores').insert({ ...datos, empresa_id: activa.id })
    if (error) {
      if (error.code === '23505') return { error: 'Ya existe un trabajador con ese RUT' }
      if (error.code === '42501') return { error: 'Tu rol no permite crear trabajadores' }
      return { error: 'No se pudo crear el trabajador' }
    }
  }

  revalidatePath('/trabajadores')
  redirect('/trabajadores')
}

export async function alternarActivoTrabajador(formData: FormData): Promise<void> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return
  const id = String(formData.get('id') ?? '')
  const activo = String(formData.get('activo') ?? '') === 'true'
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase
    .from('trabajadores')
    .update({ activo: !activo })
    .eq('id', id)
    .eq('empresa_id', activa.id)
    .select('id')
  if (error || (data ?? []).length === 0) {
    console.error('alternarActivoTrabajador:', error ?? 'sin filas')
    return
  }
  revalidatePath('/trabajadores')
}

export async function guardarContrato(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const trabajadorId = String(formData.get('trabajador_id') ?? '')
  const contratoVigenteId = String(formData.get('contrato_vigente_id') ?? '')
  const tipo = String(formData.get('tipo') ?? '')
  const fechaInicio = String(formData.get('fecha_inicio') ?? '').trim()
  const fechaTermino = String(formData.get('fecha_termino') ?? '').trim()
  const cargo = String(formData.get('cargo') ?? '').trim()
  const sueldoCrudo = String(formData.get('sueldo_base') ?? '').trim()
  const afp = String(formData.get('afp') ?? '')
  const salud = String(formData.get('salud') ?? '')
  const isapreSel = String(formData.get('isapre') ?? '')
  const planCrudo = String(formData.get('plan_isapre_uf') ?? '').trim()

  if (trabajadorId === '') return { error: 'Falta el trabajador del contrato' }
  if (tipo !== 'indefinido' && tipo !== 'plazo_fijo') return { error: 'El tipo de contrato no es válido' }
  if (!FECHA_ISO.test(fechaInicio)) return { error: 'La fecha de inicio no es válida' }
  if (tipo === 'plazo_fijo') {
    if (!FECHA_ISO.test(fechaTermino)) return { error: 'Indica la fecha de término del contrato a plazo fijo' }
    if (fechaTermino <= fechaInicio) return { error: 'La fecha de término debe ser posterior al inicio' }
  }
  if (cargo === '') return { error: 'El cargo es obligatorio' }
  const sueldoBase = Number(sueldoCrudo)
  if (!Number.isInteger(sueldoBase) || sueldoBase <= 0) {
    return { error: 'El sueldo base debe ser un entero mayor que 0' }
  }
  if (!AFPS.some((a) => a.valor === afp)) return { error: 'La AFP no es válida' }
  if (salud !== 'fonasa' && salud !== 'isapre') return { error: 'El sistema de salud no es válido' }
  let isapre: string | null = null
  let planIsapreUf: number | null = null
  if (salud === 'isapre') {
    // Fail-closed (spec §2.2): contrato isapre NUEVO sin Isapre del catálogo no
    // entra — los contratos antiguos con isapre null son el límite declarado
    // (Previred los emite con código 0).
    if (!ISAPRES.some((i) => i.valor === isapreSel)) {
      return { error: 'Selecciona la Isapre del contrato' }
    }
    isapre = isapreSel
    // es-CL: se acepta coma decimal ("3,5"). La columna es numeric(6,2).
    planIsapreUf = Math.round(Number(planCrudo.replace(',', '.')) * 100) / 100
    if (!Number.isFinite(planIsapreUf) || planIsapreUf <= 0 || planIsapreUf > 9999.99) {
      return { error: 'Indica el plan Isapre en UF (mayor que 0)' }
    }
  }

  const supabase = await crearClienteServidor()

  // Cambiar condiciones = cerrar el vigente + crear uno nuevo (spec §2.2/§4).
  // DOS writes secuenciales, NO atómico (decisión del diseño §4): si el INSERT
  // falla después de cerrar el vigente, el trabajador queda sin contrato
  // vigente — estado visible en la ficha y reparable creando el contrato de
  // nuevo. El unique parcial (un vigente por trabajador) respalda la carrera.
  if (contratoVigenteId !== '') {
    const { data, error } = await supabase
      .from('contratos')
      .update({ vigente: false })
      .eq('id', contratoVigenteId)
      .eq('empresa_id', activa.id)
      .eq('vigente', true)
      .eq('trabajador_id', trabajadorId)
      .select('id')
    if (error) {
      if (error.code === '42501') return { error: 'Tu rol no permite gestionar contratos' }
      return { error: 'No se pudo cerrar el contrato vigente' }
    }
    if ((data ?? []).length === 0) {
      return { error: 'No se pudo cerrar: el contrato ya no está vigente o tu rol no permite gestionarlo' }
    }
  }

  const { error } = await supabase.from('contratos').insert({
    empresa_id: activa.id,
    trabajador_id: trabajadorId,
    tipo,
    fecha_inicio: fechaInicio,
    fecha_termino: tipo === 'plazo_fijo' ? fechaTermino : null,
    cargo,
    sueldo_base: sueldoBase,
    gratificacion_legal: formData.get('gratificacion_legal') === 'on',
    afp,
    salud,
    isapre,
    plan_isapre_uf: planIsapreUf,
  })
  if (error) {
    if (error.code === '23505') return { error: 'El trabajador ya tiene un contrato vigente' }
    if (error.code === '42501') return { error: 'Tu rol no permite gestionar contratos' }
    if (error.code === '23503') return { error: 'El trabajador no existe en esta empresa' }
    return { error: 'No se pudo crear el contrato' }
  }

  revalidatePath(`/trabajadores/${trabajadorId}`)
  redirect(`/trabajadores/${trabajadorId}`)
}

export async function registrarVacaciones(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const trabajadorId = String(formData.get('trabajador_id') ?? '')
  if (trabajadorId === '') return { error: 'Falta el trabajador' }
  const desde = String(formData.get('desde') ?? '').trim()
  const hasta = String(formData.get('hasta') ?? '').trim()
  if (!FECHA_ISO.test(desde) || !FECHA_ISO.test(hasta)) return { error: 'Las fechas no son válidas' }
  if (hasta < desde) return { error: 'La fecha hasta debe ser igual o posterior a desde' }
  const diasHabiles = Number(String(formData.get('dias_habiles') ?? '').trim())
  if (!Number.isInteger(diasHabiles) || diasHabiles <= 0) {
    return { error: 'Los días hábiles deben ser un entero mayor que 0' }
  }
  const comentario = String(formData.get('comentario') ?? '').trim()

  // INSERT directo con RLS (precedente gastos_vehiculo P12): dueno/admin
  // escriben, contador solo lee; sin RPC. Solape entre tomas NO se valida
  // (límite v1 del spec §2.3: el saldo igual resta).
  const supabase = await crearClienteServidor()
  const { error } = await supabase.from('vacaciones_tomadas').insert({
    empresa_id: activa.id,
    trabajador_id: trabajadorId,
    desde,
    hasta,
    dias_habiles: diasHabiles,
    comentario: comentario || null,
  })
  if (error) {
    if (error.code === '42501') return { error: 'Tu rol no permite registrar vacaciones' }
    if (error.code === '23503') return { error: 'El trabajador no existe en esta empresa' }
    return { error: 'No se pudo registrar las vacaciones' }
  }
  revalidatePath(`/trabajadores/${trabajadorId}`)
  return {}
}

export async function eliminarVacaciones(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  const id = String(formData.get('id') ?? '')
  const supabase = await crearClienteServidor()
  // .select delata el éxito falso (patrón eliminarGasto P12): la policy filtra
  // en silencio para roles sin permiso — 0 filas afectadas = NO hubo borrado.
  const { data, error } = await supabase
    .from('vacaciones_tomadas')
    .delete()
    .eq('id', id)
    .eq('empresa_id', activa.id)
    .select('trabajador_id')
  const filas = data ?? []
  if (error || filas.length === 0) return { error: 'No se pudo eliminar' }
  revalidatePath(`/trabajadores/${filas[0]!.trabajador_id}`)
  return {}
}
