'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import type { Json } from '@suite/db'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import type { EstadoForm } from '../tipos'

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/

type LineaEntrada = { productoId: string; cantidad: number; precioNeto: number }

export async function crearCotizacion(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const cliente = String(formData.get('cliente_id') ?? '')
  const validez = String(formData.get('fecha_validez') ?? '').trim()
  const notas = String(formData.get('notas') ?? '').trim()
  if (!cliente) return { error: 'Selecciona un cliente' }
  if (!FECHA_ISO.test(validez)) return { error: 'Ingresa la fecha de validez' }

  let lineas: LineaEntrada[]
  try {
    // Sin .filter(): una línea malformada se RECHAZA en el loop de abajo, no se descarta en
    // silencio — el usuario no debe terminar con una cotización sin una línea que creyó incluir.
    lineas = JSON.parse(String(formData.get('lineas') ?? '[]')) as LineaEntrada[]
  } catch {
    return { error: 'Las líneas de la cotización no son válidas' }
  }
  if (lineas.length === 0) return { error: 'Agrega al menos un producto' }
  for (const l of lineas) {
    if (!l.productoId || !Number.isInteger(l.cantidad) || l.cantidad < 1) {
      return { error: 'Cada línea necesita producto y cantidad entera mayor a 0' }
    }
    if (!Number.isInteger(l.precioNeto) || l.precioNeto < 0) {
      return { error: 'Cada línea necesita un precio entero mayor o igual a 0' }
    }
  }

  const supabase = await crearClienteServidor()
  // p_lineas es jsonb en SQL; el generador de tipos lo tipa como Json, no como el shape real: castea sólo el tipo.
  // p_notas acepta NULL en SQL (nullif/trim/coalesce), pero el generador no refleja la nulabilidad de argumentos
  // de función: castea sólo el tipo, no el valor (mismo criterio que por-pagar/acciones.ts).
  const { error } = await supabase.rpc('crear_cotizacion', {
    p_empresa: activa.id,
    p_cliente: cliente,
    p_validez: validez,
    p_notas: (notas || null) as string,
    p_lineas: lineas.map((l) => ({ productoId: l.productoId, cantidad: l.cantidad, precioNeto: l.precioNeto })) as unknown as Json,
  })
  if (error) {
    // Substrings ÚNICOS dentro del set de mensajes de crear_cotizacion (verificado sin colisiones):
    // 'rol' / 'Cliente' / 'Producto' / 'línea' / 'cantidad' / 'precio' / 'validez'.
    // ('al menos' NO sirve: aparece en el mensaje de línea Y en el de cantidad.)
    if (error.message.includes('rol')) return { error: 'Tu rol no permite crear cotizaciones' }
    if (error.message.includes('Cliente')) return { error: 'El cliente no es válido o está inactivo' }
    if (error.message.includes('Producto')) return { error: 'Hay un producto no válido o inactivo en las líneas' }
    if (error.message.includes('línea')) return { error: 'La cotización necesita al menos una línea' }
    if (error.message.includes('cantidad')) return { error: 'La cantidad debe ser al menos 1' }
    if (error.message.includes('precio')) return { error: 'El precio debe ser un entero mayor o igual a 0' }
    if (error.message.includes('validez')) return { error: 'La fecha de validez no puede ser anterior a hoy' }
    return { error: 'No se pudo crear la cotización' }
  }
  revalidatePath('/cotizaciones')
  redirect('/cotizaciones')
}

const ESTADOS_DESTINO = ['enviada', 'aceptada', 'rechazada'] as const

export async function cambiarEstadoCotizacion(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  const cotizacion = String(formData.get('cotizacion_id') ?? '')
  const estado = String(formData.get('estado') ?? '')
  const motivo = String(formData.get('motivo') ?? '').trim()
  if (!cotizacion) return { error: 'Cotización no válida' }
  if (!(ESTADOS_DESTINO as readonly string[]).includes(estado)) return { error: 'Estado de destino no válido' }
  if (estado === 'rechazada' && motivo === '') return { error: 'El rechazo requiere un motivo' }
  const supabase = await crearClienteServidor()
  // p_motivo acepta NULL en SQL (nullif/trim en la RPC), pero el codegen no refleja la
  // nulabilidad de argumentos de función: el cast es sólo de tipo (mismo criterio que por-pagar).
  const { error } = await supabase.rpc('cambiar_estado_cotizacion', {
    p_empresa: activa.id,
    p_cotizacion: cotizacion,
    p_estado: estado,
    p_motivo: (motivo || null) as string,
  })
  if (error) {
    if (error.message.includes('rol')) return { error: 'Tu rol no permite gestionar cotizaciones' }
    if (error.message.includes('Transición')) return { error: 'Esa transición de estado no está permitida' }
    if (error.message.includes('vencida')) return { error: 'La cotización está vencida: ya no se puede aceptar' }
    if (error.message.includes('motivo')) return { error: 'El rechazo requiere un motivo' }
    if (error.message.includes('no existe')) return { error: 'La cotización no existe' }
    return { error: 'No se pudo cambiar el estado de la cotización' }
  }
  revalidatePath('/cotizaciones')
  revalidatePath(`/cotizaciones/${cotizacion}`)
  return {}
}

export async function convertirCotizacion(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  const cotizacion = String(formData.get('cotizacion_id') ?? '')
  if (!cotizacion) return { error: 'Cotización no válida' }
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase.rpc('convertir_cotizacion', {
    p_empresa: activa.id,
    p_cotizacion: cotizacion,
  })
  if (error) {
    if (error.message.includes('rol')) return { error: 'Tu rol no permite convertir cotizaciones' }
    if (error.message.includes('condición')) return { error: error.message }
    if (error.message.includes('aceptada')) return { error: 'Solo se puede convertir una cotización aceptada' }
    if (error.message.includes('no existe')) return { error: 'La cotización no existe' }
    return { error: 'No se pudo convertir la cotización' }
  }
  revalidatePath('/cotizaciones')
  revalidatePath('/ventas')
  // redirect lanza NEXT_REDIRECT: va FUERA de cualquier try/catch. data = uuid del documento de venta creado.
  redirect(`/ventas/${data}`)
}
