'use server'

import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@suite/auth/server'
import {
  plantillaCotizacion,
  plantillaDocumento,
  plantillaProforma,
  plantillaRecordatorio,
  type ProveedorCorreo,
} from '@suite/correo'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import {
  enviarRecordatorioDocumento,
  enviarYRegistrar,
  hace3Dias,
  proveedorCorreoConfigurado,
} from '../../lib/recordatorio'

// Estados type-only (permitidos en un archivo 'use server': se borran al compilar).
export type EstadoCorreo = { error?: string; ok?: boolean }
export type EstadoRecordatorios = { error?: string; enviados?: number; omitidos?: number }

type Supa = Awaited<ReturnType<typeof crearClienteServidor>>

const NO_CONFIGURADO = 'El correo no está configurado'
const SIN_EMAIL = 'El cliente no tiene correo registrado'

// Prefijo común del ORDEN ESTRICTO: env fail-closed → rol EXPLÍCITO dueno/admin/vendedor
// (patrón guard de combustible/importar.ts: getUser + query miembros; el RLS del insert es
// backstop, no compuerta — un correo real jamás debe salir y luego no poder registrarse).
// La sesión+empresa se resuelven en cada action ANTES de llamar a este guard.
async function guardCorreo(
  supabase: Supa,
  organizacionId: string,
): Promise<{ error: string } | { proveedor: ProveedorCorreo }> {
  const proveedor = proveedorCorreoConfigurado()
  if (!proveedor) return { error: NO_CONFIGURADO }
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data: miembro } = user
    ? await supabase
        .from('miembros')
        .select('rol')
        .eq('organizacion_id', organizacionId)
        .eq('usuario_id', user.id)
        .eq('estado', 'activo')
        .maybeSingle()
    : { data: null }
  if (!miembro || (miembro.rol !== 'dueno' && miembro.rol !== 'admin' && miembro.rol !== 'vendedor')) {
    return { error: 'Tu rol no permite enviar correos' }
  }
  return { proveedor }
}

// ---------- 1) Cotización ----------
export async function enviarCotizacionCorreo(_prev: EstadoCorreo, formData: FormData): Promise<EstadoCorreo> {
  const id = String(formData.get('id') ?? '')
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  const supabase = await crearClienteServidor()
  const guard = await guardCorreo(supabase, activa.organizacion_id)
  if ('error' in guard) return guard

  const { data: cot } = await supabase
    .from('cotizaciones')
    .select('id, numero, estado, fecha_validez, creado_en, neto, exento, iva, total, clientes (razon_social, email), cotizaciones_lineas (descripcion, cantidad, precio_neto, subtotal)')
    .eq('id', id)
    .eq('empresa_id', activa.id)
    .single()
  if (!cot) return { error: 'La cotización no existe' }
  if (cot.estado !== 'borrador' && cot.estado !== 'enviada' && cot.estado !== 'aceptada') {
    return { error: 'Solo se envía una cotización en borrador, enviada o aceptada' }
  }
  const email = cot.clientes?.email
  if (!email) return { error: SIN_EMAIL }

  // Transición SOLO tras validar email: un cliente sin correo jamás deja la cotización 'enviada'.
  if (cot.estado === 'borrador') {
    const { error } = await supabase.rpc('cambiar_estado_cotizacion', {
      p_empresa: activa.id,
      p_cotizacion: cot.id,
      p_estado: 'enviada',
    })
    if (error) return { error: 'No se pudo actualizar el estado de la cotización' }
  }

  const { asunto, html } = plantillaCotizacion({
    empresa: { razonSocial: activa.razon_social, rut: activa.rut },
    clienteRazonSocial: cot.clientes?.razon_social ?? '',
    numero: cot.numero,
    fecha: new Date(cot.creado_en).toLocaleDateString('es-CL'),
    validez: new Date(cot.fecha_validez).toLocaleDateString('es-CL'),
    lineas: cot.cotizaciones_lineas.map((l) => ({ descripcion: l.descripcion, cantidad: l.cantidad, precioNeto: l.precio_neto, subtotal: l.subtotal })),
    neto: cot.neto,
    exento: cot.exento,
    iva: cot.iva,
    total: cot.total,
  })
  const resultado = await enviarYRegistrar(supabase, guard.proveedor, activa.id, 'cotizacion', cot.id, { para: email, asunto, html })
  if ('error' in resultado) return resultado
  revalidatePath(`/cotizaciones/${cot.id}`)
  return { ok: true }
}

// ---------- 2) Proforma ----------
export async function enviarProformaCorreo(_prev: EstadoCorreo, formData: FormData): Promise<EstadoCorreo> {
  const id = String(formData.get('id') ?? '')
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  const supabase = await crearClienteServidor()
  const guard = await guardCorreo(supabase, activa.organizacion_id)
  if ('error' in guard) return guard

  const { data: prof } = await supabase
    .from('proformas')
    .select('id, numero, estado, fecha, neto, iva, total, clientes (razon_social, email)')
    .eq('id', id)
    .eq('empresa_id', activa.id)
    .single()
  if (!prof) return { error: 'La proforma no existe' }
  if (prof.estado !== 'borrador' && prof.estado !== 'enviada' && prof.estado !== 'aprobada') {
    return { error: 'Solo se envía una proforma en borrador, enviada o aprobada' }
  }
  const email = prof.clientes?.email
  if (!email) return { error: SIN_EMAIL }

  if (prof.estado === 'borrador') {
    const { error } = await supabase.rpc('cambiar_estado_proforma', {
      p_empresa: activa.id,
      p_proforma: prof.id,
      p_estado: 'enviada',
    })
    if (error) return { error: 'No se pudo actualizar el estado de la proforma' }
  }

  const { data: odes } = await supabase
    .from('ordenes_entrega')
    .select('numero, bultos, kilo_afecto, neto, destinos (nombre)')
    .eq('empresa_id', activa.id)
    .eq('proforma_id', prof.id)
    .order('numero')

  const { asunto, html } = plantillaProforma({
    empresa: { razonSocial: activa.razon_social, rut: activa.rut },
    clienteRazonSocial: prof.clientes?.razon_social ?? '',
    numero: prof.numero,
    fecha: new Date(prof.fecha).toLocaleDateString('es-CL'),
    odes: (odes ?? []).map((o) => ({ numero: o.numero, destino: o.destinos?.nombre ?? '—', bultos: o.bultos, kiloAfecto: o.kilo_afecto, neto: o.neto })),
    neto: prof.neto,
    iva: prof.iva,
    total: prof.total,
  })
  const resultado = await enviarYRegistrar(supabase, guard.proveedor, activa.id, 'proforma', prof.id, { para: email, asunto, html })
  if ('error' in resultado) return resultado
  revalidatePath(`/proformas/${prof.id}`)
  return { ok: true }
}

// ---------- 3) Documento de venta (factura/boleta emitida) ----------
export async function enviarDocumentoCorreo(_prev: EstadoCorreo, formData: FormData): Promise<EstadoCorreo> {
  const id = String(formData.get('id') ?? '')
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  const supabase = await crearClienteServidor()
  const guard = await guardCorreo(supabase, activa.organizacion_id)
  if ('error' in guard) return guard

  const { data: doc } = await supabase
    .from('documentos_venta')
    .select('id, tipo, estado, folio, emitido_en, neto, exento, iva, total, clientes (razon_social, email), documentos_venta_lineas (descripcion, cantidad, precio_neto, subtotal)')
    .eq('id', id)
    .eq('empresa_id', activa.id)
    .single()
  if (!doc) return { error: 'El documento no existe' }
  if (doc.estado !== 'emitido' || (doc.tipo !== 'factura' && doc.tipo !== 'boleta')) {
    return { error: 'Solo se envía una factura o boleta emitida' }
  }
  if (doc.folio == null) return { error: 'El documento no tiene folio' }
  const email = doc.clientes?.email
  if (!email) return { error: SIN_EMAIL }

  const { asunto, html } = plantillaDocumento({
    empresa: { razonSocial: activa.razon_social, rut: activa.rut },
    clienteRazonSocial: doc.clientes?.razon_social ?? '',
    tipo: doc.tipo === 'boleta' ? 'boleta' : 'factura',
    folio: doc.folio,
    fecha: doc.emitido_en ? new Date(doc.emitido_en).toLocaleDateString('es-CL') : '',
    lineas: doc.documentos_venta_lineas.map((l) => ({ descripcion: l.descripcion, cantidad: l.cantidad, precioNeto: l.precio_neto, subtotal: l.subtotal })),
    neto: doc.neto,
    exento: doc.exento,
    iva: doc.iva,
    total: doc.total,
  })
  const resultado = await enviarYRegistrar(supabase, guard.proveedor, activa.id, 'documento', doc.id, { para: email, asunto, html })
  if ('error' in resultado) return resultado
  revalidatePath(`/ventas/${doc.id}`)
  return { ok: true }
}

// ---------- 4a) Recordatorio individual (anti-spam) ----------
export async function enviarRecordatorio(_prev: EstadoCorreo, formData: FormData): Promise<EstadoCorreo> {
  const documentoId = String(formData.get('documento_id') ?? '')
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  const supabase = await crearClienteServidor()
  const guard = await guardCorreo(supabase, activa.organizacion_id)
  if ('error' in guard) return guard

  // Nucleo compartido con la herramienta recordarFactura del bot (P21): vencida,
  // anti-spam 3 dias, plantilla, envio+log. Aqui solo guard de rol y revalidate.
  const resultado = await enviarRecordatorioDocumento(
    supabase,
    guard.proveedor,
    { id: activa.id, razonSocial: activa.razon_social, rut: activa.rut },
    documentoId,
  )
  if ('error' in resultado) return { error: resultado.error }
  revalidatePath('/cobranza')
  return { ok: true }
}

// ---------- 4b) Recordatorios masivos (todas las vencidas con saldo) ----------
export async function enviarRecordatorios(_prev: EstadoRecordatorios, _formData: FormData): Promise<EstadoRecordatorios> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  const supabase = await crearClienteServidor()
  const guard = await guardCorreo(supabase, activa.organizacion_id)
  if ('error' in guard) return guard

  const hoy = new Date().toISOString().slice(0, 10)
  const { data: vencidas } = await supabase
    .from('saldos_documentos')
    .select('documento_id, tipo, folio, total, saldo, fecha_vencimiento, cliente_id, cliente_razon_social')
    .eq('empresa_id', activa.id)
    .gt('saldo', 0)
    .lt('fecha_vencimiento', hoy)
    .order('fecha_vencimiento', { ascending: true })
    .limit(500)
  const filas = (vencidas ?? []).filter((f) => f.documento_id)
  if (filas.length === 0) return { enviados: 0, omitidos: 0 }

  // Anti-spam en lote: un solo query trae los recordatorios de los últimos 3 días.
  const { data: recientes } = await supabase
    .from('correos_enviados')
    .select('referencia_id')
    .eq('empresa_id', activa.id)
    .eq('tipo', 'recordatorio')
    .gte('creado_en', hace3Dias())
  const bloqueados = new Set((recientes ?? []).map((r) => r.referencia_id))

  // Emails por cliente en un solo query (saldos_documentos no expone email).
  const clienteIds = [...new Set(filas.map((f) => f.cliente_id).filter((v): v is string => !!v))]
  const { data: clientes } = await supabase
    .from('clientes')
    .select('id, email')
    .eq('empresa_id', activa.id)
    .in('id', clienteIds)
  const emailPorCliente = new Map((clientes ?? []).map((c) => [c.id, c.email]))

  let enviados = 0
  let omitidos = 0
  for (const f of filas) {
    const documentoId = f.documento_id as string
    const email = f.cliente_id ? emailPorCliente.get(f.cliente_id) : null
    if (bloqueados.has(documentoId) || !email) {
      omitidos++
      continue
    }
    const { asunto, html } = plantillaRecordatorio({
      empresa: { razonSocial: activa.razon_social, rut: activa.rut },
      clienteRazonSocial: f.cliente_razon_social ?? '',
      tipo: f.tipo === 'boleta' ? 'boleta' : 'factura',
      folio: f.folio ?? 0,
      total: f.total ?? 0,
      saldo: f.saldo ?? 0,
      fechaVencimiento: new Date(f.fecha_vencimiento ?? hoy).toLocaleDateString('es-CL'),
    })
    const resultado = await enviarYRegistrar(supabase, guard.proveedor, activa.id, 'recordatorio', documentoId, { para: email, asunto, html })
    if ('error' in resultado) omitidos++
    else enviados++
  }
  revalidatePath('/cobranza')
  return { enviados, omitidos }
}
