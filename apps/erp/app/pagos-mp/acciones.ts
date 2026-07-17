'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearNumeroProforma } from '@suite/core'
import { armarReferencia } from '@suite/pagos'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import { pasarelaParaEmpresa } from '../../lib/pagos'
import type { EstadoForm } from '../tipos'

const TIPOS = ['factura', 'proforma', 'cotizacion'] as const
type TipoOrigen = (typeof TIPOS)[number]

const RUTA: Record<TipoOrigen, string> = { factura: 'ventas', proforma: 'proformas', cotizacion: 'cotizaciones' }

export async function generarLinkPago(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  const tipo = String(formData.get('tipo') ?? '')
  const objetoId = String(formData.get('id') ?? '')
  if (!(TIPOS as readonly string[]).includes(tipo) || !objetoId) return { error: 'Origen de pago no válido' }
  const origen = tipo as TipoOrigen

  // Config MP de la empresa (token cifrado, descifrado server-side). Sin config → mensaje claro.
  const pasarela = await pasarelaParaEmpresa(activa.id)
  if (!pasarela) return { error: 'MercadoPago no está configurado para esta empresa' }

  const supabase = await crearClienteServidor()

  // Título (razón social + folio / PF-N° / N° cotización) y monto según el tipo, leyendo el
  // objeto scoped a la empresa. El monto es el que crear_link_pago re-valida bajo lock.
  let titulo: string
  let monto: number
  if (origen === 'factura') {
    const { data } = await supabase
      .from('saldos_documentos')
      .select('tipo, folio, saldo, cliente_razon_social')
      .eq('empresa_id', activa.id)
      .eq('documento_id', objetoId)
      .maybeSingle()
    if (!data || (data.saldo ?? 0) <= 0) return { error: 'Solo se generan links para facturas emitidas con saldo' }
    titulo = `${data.cliente_razon_social} — ${data.tipo === 'factura' ? 'Factura' : 'Boleta'} ${data.folio ?? ''}`.trim()
    monto = data.saldo ?? 0
  } else if (origen === 'proforma') {
    const { data } = await supabase
      .from('proformas')
      .select('numero, total, clientes (razon_social)')
      .eq('empresa_id', activa.id)
      .eq('id', objetoId)
      .maybeSingle()
    if (!data) return { error: 'El documento no existe' }
    titulo = `${data.clientes?.razon_social ?? ''} — Proforma ${formatearNumeroProforma(data.numero)}`.trim()
    monto = data.total
  } else {
    const { data } = await supabase
      .from('cotizaciones')
      .select('numero, total, clientes (razon_social)')
      .eq('empresa_id', activa.id)
      .eq('id', objetoId)
      .maybeSingle()
    if (!data) return { error: 'El documento no existe' }
    titulo = `${data.clientes?.razon_social ?? ''} — Cotización N° ${data.numero}`.trim()
    monto = data.total
  }

  // external_reference (spec §2). El link_id se genera acá porque la preferencia se crea
  // ANTES de crear_link_pago (preferencia_id/url son NOT NULL) y el webhook parsea link_id
  // de la referencia — la fila persiste ESTE id (p_id).
  const linkId = crypto.randomUUID()
  const referencia = armarReferencia({ tipo: origen, empresaId: activa.id, objetoId, linkId })
  const h = await headers()
  const base = `${h.get('x-forwarded-proto') ?? 'http'}://${h.get('host') ?? 'localhost:3000'}`
  const urlRetorno = `${base}/${RUTA[origen]}/${objetoId}`

  let preferencia: { preferenciaId: string; url: string }
  try {
    preferencia = await pasarela.crearPreferencia({ titulo, monto, externalReference: referencia, urlRetorno })
  } catch {
    return { error: 'No se pudo generar el link de pago' }
  }

  const { error } = await supabase.rpc('crear_link_pago', {
    p_empresa: activa.id,
    p_id: linkId,
    p_origen_tipo: origen,
    p_origen: objetoId,
    p_preferencia: preferencia.preferenciaId,
    p_url: preferencia.url,
    p_monto: monto,
  })
  if (error) {
    if (error.message.includes('rol')) return { error: 'Tu rol no permite generar links de pago' }
    // Carreras UI↔RPC (el botón se gateó por estado, pero el estado cambió entre el render
    // y el click): el mensaje exacto de la RPC es más útil que el genérico.
    if (error.message.includes('no permite link de pago') || error.message.includes('El documento no existe')) {
      return { error: error.message }
    }
    // Saldo/monto/total ya no calzan (otro abono, link viejo): la preferencia queda huérfana
    // y expira sola (spec §2) — el usuario regenera.
    if (error.message.includes('saldo') || error.message.includes('monto') || error.message.includes('total')) {
      return { error: 'El saldo cambió; vuelve a generar el link' }
    }
    return { error: 'No se pudo generar el link de pago' }
  }
  revalidatePath(`/${RUTA[origen]}/${objetoId}`)
  return {}
}
