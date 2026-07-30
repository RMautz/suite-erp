'use server'

import { revalidatePath } from 'next/cache'
import { clienteAdmin } from '@suite/auth/admin'
import { crearClienteServidor } from '@suite/auth/server'
import { CODIGO_SII, type TipoDocumento } from '@suite/core'
import { proveedorPorAmbiente, type EstadoResultado } from '@suite/dte'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import { aplicarAnticipoDocumento, credencialesEmpresa, registrarMovimientosDocumento } from '../../lib/emision'
import { contabilizarAsiento } from '../../lib/contabilidad'

const TIPOS_EMISIBLES = ['factura', 'boleta'] as const

// Mapea el estado del proveedor al estado del documento, preservando 'rechazado'
// (un rechazo del SII es terminal, no un fallo transitorio de la cola de reintentos).
function estadoDocumento(estado: EstadoResultado): 'emitido' | 'rechazado' | 'pendiente_envio' {
  if (estado === 'emitido') return 'emitido'
  if (estado === 'rechazado') return 'rechazado'
  return 'pendiente_envio'
}

export async function emitirDocumento(formData: FormData): Promise<void> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return
  const id = String(formData.get('id') ?? '')
  const tipo = String(formData.get('tipo') ?? '') as TipoDocumento
  if (!TIPOS_EMISIBLES.includes(tipo as (typeof TIPOS_EMISIBLES)[number])) return

  const supabase = await crearClienteServidor()
  // Verifica que el documento pertenece a la empresa activa y está emitible (RLS lo acota).
  const { data: doc } = await supabase
    .from('documentos_venta')
    .select('id, tipo, estado, folio, cliente_id, neto, exento, iva, total')
    .eq('id', id)
    .eq('empresa_id', activa.id)
    .single()
  if (!doc || (doc.estado !== 'borrador' && doc.estado !== 'pendiente_envio')) return
  // No cambiar el tipo de un documento ya tributario (evita cruzar folio con el CAF equivocado).
  if (doc.tipo !== 'nota_venta' && doc.tipo !== tipo) return

  const admin = clienteAdmin()
  // Fuera del try: el catch decide con folioPersistido si revierte a 'borrador' (nada
  // persistido, nada que reintentar) o deja 'pendiente_envio' (folio YA escrito en la fila).
  let folio = doc.folio
  let folioPersistido = folio !== null // reintento: la fila ya traía folio persistido
  try {
    // Claim atómico ANTES de tomar folio: dos clics simultáneos sobre el mismo
    // borrador → solo uno pasa; el perdedor sale SIN consumir folio. Un doc ya
    // en pendiente_envio (reintento) no se re-clama: su folio ya está reservado
    // o se reserva más abajo con el guard .is('folio', null).
    if (doc.estado === 'borrador') {
      const { data: reclamado, error: eClaim } = await admin
        .from('documentos_venta')
        .update({ estado: 'pendiente_envio' })
        .eq('id', id)
        .eq('empresa_id', activa.id)
        .eq('estado', 'borrador')
        .select('id')
      if (eClaim) throw new Error('No se pudo iniciar la emisión; reintenta')
      if ((reclamado ?? []).length === 0) return // otra emisión concurrente ya tomó el documento
    }

    const cred = await credencialesEmpresa(activa.id, tipo)

    // Reserva de folio SOLO si aún no tiene (idempotencia ante reintento).
    // tomar_folio en contexto de USUARIO (valida pertenencia por auth.uid()).
    if (folio === null) {
      const { data: nuevo, error: eFolio } = await supabase.rpc('tomar_folio', { p_empresa: activa.id, p_tipo: tipo })
      if (eFolio || nuevo === null) throw new Error(eFolio?.message ?? 'No hay folios disponibles')
      folio = nuevo as number
      // El folio DEBE quedar persistido antes de continuar: si este write falla, abortamos
      // para que el reintento reutilice el mismo folio (nunca dos folios para una venta).
      const { data: reservado, error: eUpd } = await admin
        .from('documentos_venta')
        .update({ tipo, folio, estado: 'pendiente_envio' })
        .eq('id', id)
        .eq('empresa_id', activa.id)
        .is('folio', null)
        .select('id')
      if (eUpd) throw new Error('No se pudo reservar el folio; reintenta')
      if ((reservado ?? []).length === 0) return // otra emisión concurrente ya reservó el folio
      // Folio PERSISTIDO recién aquí: si este write hubiera fallado, el folio ya tomado
      // se pierde como gap (misma familia que el gap ya aceptado de un DTE rechazado por el SII).
      folioPersistido = true
    }

    const [{ data: emp }, { data: cli }, { data: lineas }] = await Promise.all([
      admin.from('empresas').select('rut, razon_social, giro_emisor, direccion_emisor, comuna_emisor').eq('id', activa.id).single(),
      admin.from('clientes').select('rut, razon_social, giro, direccion, comuna').eq('id', doc.cliente_id).single(),
      admin.from('documentos_venta_lineas').select('producto_id, descripcion, cantidad, precio_neto, exenta').eq('documento_id', id),
    ])

    const proveedor = proveedorPorAmbiente(process.env.DTE_AMBIENTE ?? 'certificacion')
    const resultado = await proveedor.emitirDTE({
      tipo,
      codigoSii: CODIGO_SII[tipo]!,
      folio: folio!,
      emisor: {
        rut: emp!.rut, razonSocial: emp!.razon_social, giro: emp!.giro_emisor ?? '',
        direccion: emp!.direccion_emisor ?? '', comuna: emp!.comuna_emisor ?? '',
      },
      receptor: {
        rut: cli!.rut, razonSocial: cli!.razon_social, giro: cli!.giro ?? undefined,
        direccion: cli!.direccion ?? undefined, comuna: cli!.comuna ?? undefined,
      },
      lineas: (lineas ?? []).map((l) => ({ descripcion: l.descripcion, cantidad: l.cantidad, precioNeto: l.precio_neto, exenta: l.exenta })),
      neto: doc.neto, exento: doc.exento, iva: doc.iva, total: doc.total,
      credenciales: cred,
    })

    const estado = estadoDocumento(resultado.estado)
    await admin
      .from('documentos_venta')
      .update({
        tipo,
        folio,
        estado,
        track_id: resultado.trackId,
        xml_timbrado: resultado.xmlTimbrado,
        pdf_ruta: resultado.pdfBase64,
        error_emision: resultado.error,
        emitido_en: estado === 'emitido' ? new Date().toISOString() : null,
        intentos: doc.estado === 'pendiente_envio' ? 2 : 1,
      })
      .eq('id', id)
      .eq('empresa_id', activa.id)

    if (estado === 'emitido') {
      await registrarMovimientosDocumento(
        activa.id,
        id,
        (lineas ?? []).map((l) => ({ producto_id: l.producto_id, cantidad: l.cantidad })),
        -1,
        'Venta ' + tipo + ' folio ' + folio
      )
      // Anticipo recibido por un link de pago sobre la proforma/cotización de origen: se aplica
      // solo al emitirse la factura. NUNCA lanza (espejo de registrarMovimientosDocumento): si
      // lanzara, el catch revertiría un DTE vivo. Fallo best-effort → botón "Aplicar" en /cobranza.
      await aplicarAnticipoDocumento(activa.id, id)
      // Contabiliza la venta en tiempo real: Debe Clientes (total) / Haber Ventas (neto) + Ventas
      // exentas (exento) + IVA débito (iva). Hook nunca-lanza; si el módulo está inactivo o el
      // mapeo da 0 líneas (boleta total 0), la RPC es no-op.
      await contabilizarAsiento(activa.id, 'venta', id)
    }
  } catch (e) {
    // La decisión es sobre folio PERSISTIDO, no sobre la variable local `folio`: si se
    // tomó un folio pero el UPDATE que lo escribe falló, `folio` ya no es null pero la
    // fila jamás lo guardó — ese folio se pierde como gap (misma familia que el gap ya
    // aceptado de un DTE rechazado por el SII). Sin folio persistido el documento vuelve
    // a 'borrador' (un certificado o CAF faltante ya no lo deja atascado en pendiente_envio);
    // con folio persistido queda 'pendiente_envio': el reintento reutiliza el MISMO folio
    // (guard .is('folio', null) más arriba).
    const revertir = admin
      .from('documentos_venta')
      .update({
        estado: folioPersistido ? 'pendiente_envio' : 'borrador',
        error_emision: e instanceof Error ? e.message : 'Error de emisión',
      })
      .eq('id', id)
      .eq('empresa_id', activa.id)
    // El revert a 'borrador' solo aplica si la fila sigue SIN folio: una invocación
    // concurrente que sí emitió (folio persistido) no debe ser pisada — sin este guard,
    // un doc emitido volvería a verse como borrador y un re-clic re-emitiría el MISMO folio.
    if (!folioPersistido) revertir.is('folio', null)
    await revertir
  }

  revalidatePath('/ventas')
  revalidatePath('/ventas/' + id)
}

export async function emitirNotaCredito(formData: FormData): Promise<void> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return
  const refId = String(formData.get('referencia_id') ?? '')
  const razon = String(formData.get('razon') ?? '').trim() || 'Anula documento'

  const supabase = await crearClienteServidor()
  const { data: ref } = await supabase
    .from('documentos_venta')
    .select('id, tipo, folio, cliente_id, neto, exento, iva, total')
    .eq('id', refId).eq('empresa_id', activa.id).eq('estado', 'emitido').single()
  if (!ref || !ref.folio) return
  if (ref.tipo === 'nota_credito') return // no se anula una nota de crédito con otra NC
  // Evita crear una segunda NC para el mismo documento (reintento del botón).
  const { data: ncPrevia } = await supabase
    .from('documentos_venta')
    .select('id')
    .eq('empresa_id', activa.id)
    .eq('documento_referencia_id', refId)
    .neq('estado', 'rechazado')
    .limit(1)
  if (ncPrevia && ncPrevia.length > 0) return

  const admin = clienteAdmin()
  let ncId: string | null = null
  try {
    const cred = await credencialesEmpresa(activa.id, 'nota_credito')

    // 1. Crea la NC (borrador) referenciando el original ANTES de reservar folio, para que
    // cualquier fallo posterior tenga una fila donde registrar el error (no se pierde).
    const { data: ncDoc, error: eNc } = await admin
      .from('documentos_venta')
      .insert({
        empresa_id: activa.id, tipo: 'nota_credito', cliente_id: ref.cliente_id, estado: 'borrador',
        documento_referencia_id: refId, razon_anulacion: razon,
        neto: ref.neto, exento: ref.exento, iva: ref.iva, total: ref.total,
      })
      .select('id')
      .single()
    if (eNc || !ncDoc) throw new Error('No se pudo crear la nota de crédito')
    ncId = ncDoc.id
    const { error: eLinea } = await admin.from('documentos_venta_lineas').insert({
      empresa_id: activa.id, documento_id: ncId, producto_id: null,
      descripcion: 'Anulación ' + ref.tipo + ' folio ' + ref.folio, cantidad: 1,
      precio_neto: ref.total, exenta: false, subtotal: ref.total,
    })
    if (eLinea) throw new Error('No se pudo crear la línea de la nota de crédito')

    // 2. Reserva el folio (contexto usuario) y persístelo en la NC antes de emitir.
    const { data: folioNc, error: eF } = await supabase.rpc('tomar_folio', { p_empresa: activa.id, p_tipo: 'nota_credito' })
    if (eF || folioNc === null) throw new Error(eF?.message ?? 'No hay folios de nota de crédito')
    const { error: eUpd } = await admin
      .from('documentos_venta')
      .update({ folio: folioNc as number, estado: 'pendiente_envio' })
      .eq('id', ncId)
    if (eUpd) throw new Error('No se pudo reservar el folio de la nota de crédito')

    const [{ data: emp }, { data: cli }] = await Promise.all([
      admin.from('empresas').select('rut, razon_social, giro_emisor, direccion_emisor, comuna_emisor').eq('id', activa.id).single(),
      admin.from('clientes').select('rut, razon_social, giro, direccion, comuna').eq('id', ref.cliente_id).single(),
    ])
    const proveedor = proveedorPorAmbiente(process.env.DTE_AMBIENTE ?? 'certificacion')
    const resultado = await proveedor.anularConNotaCredito({
      tipo: 'nota_credito', codigoSii: 61, folio: folioNc as number,
      emisor: { rut: emp!.rut, razonSocial: emp!.razon_social, giro: emp!.giro_emisor ?? '', direccion: emp!.direccion_emisor ?? '', comuna: emp!.comuna_emisor ?? '' },
      receptor: { rut: cli!.rut, razonSocial: cli!.razon_social },
      lineas: [{ descripcion: 'Anulación', cantidad: 1, precioNeto: ref.total, exenta: false }],
      neto: ref.neto, exento: ref.exento, iva: ref.iva, total: ref.total,
      credenciales: cred,
      folioReferencia: ref.folio, codigoSiiReferencia: CODIGO_SII[ref.tipo as TipoDocumento]!, razonAnulacion: razon,
    })
    const estado = estadoDocumento(resultado.estado)
    await admin.from('documentos_venta').update({
      estado,
      track_id: resultado.trackId, xml_timbrado: resultado.xmlTimbrado, pdf_ruta: resultado.pdfBase64,
      error_emision: resultado.error,
      emitido_en: estado === 'emitido' ? new Date().toISOString() : null,
    }).eq('id', ncId)

    if (estado === 'emitido') {
      const { data: lineasRef } = await admin
        .from('documentos_venta_lineas')
        .select('producto_id, cantidad')
        .eq('documento_id', refId)
      await registrarMovimientosDocumento(
        activa.id,
        ncId,
        (lineasRef ?? []).map((l) => ({ producto_id: l.producto_id, cantidad: l.cantidad })),
        1,
        'Nota de crédito folio ' + (folioNc as number)
      )
      // Contabiliza la NC en tiempo real: Debe Ventas (neto) + Ventas exentas (exento) + IVA débito
      // (iva) / Haber Clientes (total) — inversa de la venta. Hook nunca-lanza.
      await contabilizarAsiento(activa.id, 'nota_credito', ncId)
    }
  } catch (e) {
    // No silencioso: registra el error en la NC (si se creó) para que el usuario lo vea y la
    // cola de reintentos la tome. La venta original queda intacta.
    if (ncId) {
      await admin
        .from('documentos_venta')
        .update({ estado: 'pendiente_envio', error_emision: e instanceof Error ? e.message : 'Error al emitir la nota de crédito' })
        .eq('id', ncId)
    }
  }
  revalidatePath('/ventas')
  if (ncId) revalidatePath('/ventas/' + ncId)
}
