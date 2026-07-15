'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import type { Json } from '@suite/db'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import type { EstadoForm } from '../tipos'

const TIPOS = ['factura', 'factura_exenta'] as const
const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/
const METODOS = ['efectivo', 'transferencia', 'tarjeta', 'cheque', 'otro'] as const

type AplicacionEntrada = { documentoId: string; monto: number }

export async function registrarFacturaCompra(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const proveedor = String(formData.get('proveedor_id') ?? '')
  const tipo = String(formData.get('tipo') ?? '')
  const folio = Math.trunc(Number(String(formData.get('folio') ?? '').trim()))
  const fecha = String(formData.get('fecha_emision') ?? '').trim()
  const orden = String(formData.get('orden_id') ?? '')
  const notas = String(formData.get('notas') ?? '').trim()
  const neto = Math.trunc(Number(String(formData.get('neto') ?? '0').trim()))
  const exento = Math.trunc(Number(String(formData.get('exento') ?? '0').trim()))
  const iva = Math.trunc(Number(String(formData.get('iva') ?? '0').trim()))
  const total = Math.trunc(Number(String(formData.get('total') ?? '0').trim()))

  if (!proveedor) return { error: 'Selecciona un proveedor' }
  if (!(TIPOS as readonly string[]).includes(tipo)) return { error: 'Selecciona el tipo de documento' }
  if (!Number.isInteger(folio) || folio < 1) return { error: 'El folio debe ser un entero mayor a 0' }
  if (!FECHA_ISO.test(fecha)) return { error: 'Ingresa la fecha de emisión' }
  for (const [nombre, v] of [['neto', neto], ['exento', exento], ['IVA', iva], ['total', total]] as const) {
    if (!Number.isInteger(v) || v < 0) return { error: `El ${nombre} debe ser un entero mayor o igual a 0` }
  }
  if (total !== neto + exento + iva) return { error: 'El total no cuadra: debe ser neto + exento + IVA' }

  const supabase = await crearClienteServidor()
  // El filtro de OCs por proveedor del formulario es solo UI: un POST manipulado podria
  // vincular una OC de otro proveedor del mismo tenant (la FK compuesta solo valida empresa).
  if (orden) {
    const { data: oc } = await supabase
      .from('ordenes_compra')
      .select('id')
      .eq('id', orden)
      .eq('empresa_id', activa.id)
      .eq('proveedor_id', proveedor)
      .maybeSingle()
    if (!oc) return { error: 'La orden de compra no corresponde a ese proveedor' }
  }
  const { error } = await supabase.from('documentos_compra').insert({
    empresa_id: activa.id,
    proveedor_id: proveedor,
    tipo,
    folio,
    fecha_emision: fecha,
    neto,
    exento,
    iva,
    total,
    orden_id: orden || null,
    notas: notas || null,
  })
  if (error) {
    if (error.code === '23505') return { error: 'Ya registraste esa factura de ese proveedor' }
    if (error.code === '42501') return { error: 'Tu rol no permite registrar facturas de compra' }
    return { error: 'No se pudo registrar la factura' }
  }
  revalidatePath('/por-pagar')
  revalidatePath('/por-pagar/facturas')
  redirect('/por-pagar/facturas')
}

export async function anularFacturaCompra(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  const documento = String(formData.get('documento_id') ?? '')
  const motivo = String(formData.get('motivo') ?? '').trim()
  if (!documento) return { error: 'Documento no válido' }
  if (motivo === '') return { error: 'La anulación requiere un motivo' }
  const supabase = await crearClienteServidor()
  const { error } = await supabase.rpc('anular_documento_compra', { p_empresa: activa.id, p_documento: documento, p_motivo: motivo })
  if (error) {
    if (error.message.includes('rol')) return { error: 'Tu rol no permite anular facturas de compra' }
    if (error.message.includes('pagos aplicados')) return { error: 'La factura tiene pagos aplicados; anula primero esos pagos' }
    if (error.message.includes('anulada')) return { error: 'La factura no existe o ya está anulada' }
    return { error: 'No se pudo anular la factura' }
  }
  revalidatePath('/por-pagar')
  revalidatePath('/por-pagar/facturas')
  return {}
}

export async function registrarPagoProveedor(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const proveedor = String(formData.get('proveedor_id') ?? '')
  const metodo = String(formData.get('metodo') ?? '')
  const fecha = String(formData.get('fecha') ?? '').trim()
  const referencia = String(formData.get('referencia') ?? '').trim()
  const notas = String(formData.get('notas') ?? '').trim()
  const monto = Math.trunc(Number(String(formData.get('monto') ?? '').trim()))
  if (!proveedor) return { error: 'Selecciona un proveedor' }
  if (!(METODOS as readonly string[]).includes(metodo)) return { error: 'Selecciona un método de pago' }
  if (!Number.isInteger(monto) || monto <= 0) return { error: 'El monto debe ser un entero mayor a 0' }

  let aplicaciones: AplicacionEntrada[]
  try {
    aplicaciones = (JSON.parse(String(formData.get('aplicaciones') ?? '[]')) as AplicacionEntrada[]).filter((a) => a.monto > 0)
  } catch {
    return { error: 'Las aplicaciones del pago no son válidas' }
  }
  if (aplicaciones.length === 0) return { error: 'Aplica el pago a al menos un documento' }
  for (const a of aplicaciones) {
    if (!a.documentoId || !Number.isInteger(a.monto) || a.monto < 1) {
      return { error: 'Cada aplicación necesita documento y monto entero mayor a 0' }
    }
  }

  const supabase = await crearClienteServidor()
  // p_aplicaciones es jsonb en SQL; el generador de tipos lo tipa como Json, no como el shape real: castea sólo el tipo.
  // p_fecha/p_referencia/p_notas aceptan NULL en SQL (coalesce/nullif), pero el generador no refleja la nulabilidad
  // de argumentos de función: castea sólo el tipo, no el valor (mismo criterio que cobranza/acciones.ts).
  const { error } = await supabase.rpc('registrar_pago_proveedor', {
    p_empresa: activa.id,
    p_proveedor: proveedor,
    p_fecha: (fecha || null) as string,
    p_metodo: metodo,
    p_monto: monto,
    p_referencia: (referencia || null) as string,
    p_notas: (notas || null) as string,
    p_aplicaciones: aplicaciones.map((a) => ({ documentoId: a.documentoId, monto: a.monto })) as unknown as Json,
  })
  if (error) {
    if (error.message.includes('rol')) return { error: 'Tu rol no permite registrar pagos a proveedores' }
    if (error.message.includes('saldo')) return { error: error.message }
    if (error.message.includes('suma')) return { error: 'La suma de las aplicaciones debe ser igual al monto del pago' }
    if (error.message.includes('válido')) return { error: 'Hay un documento no válido o de otro proveedor' }
    return { error: 'No se pudo registrar el pago' }
  }
  revalidatePath('/por-pagar')
  revalidatePath('/por-pagar/pagos')
  redirect('/por-pagar')
}

export async function anularPagoProveedor(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  const pago = String(formData.get('pago_id') ?? '')
  const motivo = String(formData.get('motivo') ?? '').trim()
  if (!pago) return { error: 'Pago no válido' }
  if (motivo === '') return { error: 'La anulación requiere un motivo' }
  const supabase = await crearClienteServidor()
  const { error } = await supabase.rpc('anular_pago_proveedor', { p_empresa: activa.id, p_pago: pago, p_motivo: motivo })
  if (error) {
    if (error.message.includes('rol')) return { error: 'Tu rol no permite anular pagos a proveedores' }
    if (error.message.includes('anulado')) return { error: 'El pago no existe o ya está anulado' }
    return { error: 'No se pudo anular el pago' }
  }
  revalidatePath('/por-pagar')
  revalidatePath('/por-pagar/pagos')
  return {}
}
