'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import type { Json } from '@suite/db'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import type { EstadoForm } from '../tipos'

const METODOS = ['efectivo', 'transferencia', 'tarjeta', 'cheque', 'otro'] as const

type AplicacionEntrada = { documentoId: string; monto: number }

export async function registrarPago(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const cliente = String(formData.get('cliente_id') ?? '')
  const metodo = String(formData.get('metodo') ?? '')
  const fecha = String(formData.get('fecha') ?? '').trim()
  const referencia = String(formData.get('referencia') ?? '').trim()
  const notas = String(formData.get('notas') ?? '').trim()
  const monto = Math.trunc(Number(String(formData.get('monto') ?? '').trim()))
  if (!cliente) return { error: 'Selecciona un cliente' }
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
  // de argumentos de función: castea sólo el tipo, no el valor (mismo criterio que compras/acciones.ts).
  const { error } = await supabase.rpc('registrar_pago', {
    p_empresa: activa.id,
    p_cliente: cliente,
    p_fecha: (fecha || null) as string,
    p_metodo: metodo,
    p_monto: monto,
    p_referencia: (referencia || null) as string,
    p_notas: (notas || null) as string,
    p_aplicaciones: aplicaciones.map((a) => ({ documentoId: a.documentoId, monto: a.monto })) as unknown as Json,
  })
  if (error) {
    if (error.message.includes('rol')) return { error: 'Tu rol no permite registrar pagos' }
    if (error.message.includes('saldo')) return { error: error.message }
    if (error.message.includes('suma')) return { error: 'La suma de las aplicaciones debe ser igual al monto del pago' }
    if (error.message.includes('cobrable')) return { error: 'Hay un documento no cobrable o de otro cliente' }
    return { error: 'No se pudo registrar el pago' }
  }
  revalidatePath('/cobranza')
  revalidatePath('/cobranza/pagos')
  redirect('/cobranza')
}

export async function anularPago(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  const pago = String(formData.get('pago_id') ?? '')
  const motivo = String(formData.get('motivo') ?? '').trim()
  if (!pago) return { error: 'Pago no válido' }
  if (motivo === '') return { error: 'La anulación requiere un motivo' }
  const supabase = await crearClienteServidor()
  const { error } = await supabase.rpc('anular_pago', { p_empresa: activa.id, p_pago: pago, p_motivo: motivo })
  if (error) {
    if (error.message.includes('rol')) return { error: 'Tu rol no permite anular pagos' }
    if (error.message.includes('anulado')) return { error: 'El pago no existe o ya está anulado' }
    return { error: 'No se pudo anular el pago' }
  }
  revalidatePath('/cobranza')
  revalidatePath('/cobranza/pagos')
  return {}
}
