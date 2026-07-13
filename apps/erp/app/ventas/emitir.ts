'use server'

import { revalidatePath } from 'next/cache'
import { clienteAdmin } from '@suite/auth/admin'
import { crearClienteServidor } from '@suite/auth/server'
import { CODIGO_SII, esTributario, type TipoDocumento } from '@suite/core'
import { proveedorPorAmbiente } from '@suite/dte'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import { credencialesEmpresa } from '../../lib/emision'

const TIPOS_EMISIBLES = ['factura', 'boleta'] as const

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
    .select('id, estado, folio, cliente_id, neto, exento, iva, total')
    .eq('id', id)
    .eq('empresa_id', activa.id)
    .single()
  if (!doc || (doc.estado !== 'borrador' && doc.estado !== 'pendiente_envio')) return

  const admin = clienteAdmin()
  try {
    const cred = await credencialesEmpresa(activa.id, tipo)

    // Reserva de folio SOLO si aún no tiene (idempotencia ante reintento).
    // tomar_folio se llama en contexto de USUARIO (supabase, no admin): la función
    // valida internamente que el usuario pertenece a la empresa (auth.uid()), lo que
    // bajo service_role fallaría. security definer le permite avanzar folios_caf igual.
    let folio = doc.folio
    if (folio === null) {
      const { data: nuevo, error: eFolio } = await supabase.rpc('tomar_folio', { p_empresa: activa.id, p_tipo: tipo })
      if (eFolio || nuevo === null) throw new Error(eFolio?.message ?? 'No hay folios disponibles')
      folio = nuevo as number
      await admin.from('documentos_venta').update({ tipo, folio, estado: 'pendiente_envio' }).eq('id', id)
    }

    const [{ data: emp }, { data: cli }, { data: lineas }] = await Promise.all([
      admin.from('empresas').select('rut, razon_social, giro_emisor, direccion_emisor, comuna_emisor').eq('id', activa.id).single(),
      admin.from('clientes').select('rut, razon_social, giro, direccion, comuna').eq('id', doc.cliente_id).single(),
      admin.from('documentos_venta_lineas').select('descripcion, cantidad, precio_neto, exenta').eq('documento_id', id),
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

    await admin
      .from('documentos_venta')
      .update({
        estado: resultado.estado === 'emitido' ? 'emitido' : 'pendiente_envio',
        track_id: resultado.trackId,
        xml_timbrado: resultado.xmlTimbrado,
        pdf_ruta: resultado.pdfBase64,
        error_emision: resultado.error,
        emitido_en: resultado.estado === 'emitido' ? new Date().toISOString() : null,
        intentos: 1,
      })
      .eq('id', id)
  } catch (e) {
    await admin
      .from('documentos_venta')
      .update({ estado: 'pendiente_envio', error_emision: e instanceof Error ? e.message : 'Error de emisión' })
      .eq('id', id)
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

  const admin = clienteAdmin()
  try {
    const cred = await credencialesEmpresa(activa.id, 'nota_credito')
    // tomar_folio en contexto de usuario (valida pertenencia por auth.uid()).
    const { data: folioNc, error: eF } = await supabase.rpc('tomar_folio', { p_empresa: activa.id, p_tipo: 'nota_credito' })
    if (eF || folioNc === null) throw new Error(eF?.message ?? 'No hay folios de nota de crédito')

    // Crea la NC como documento propio referenciando el original. Se inserta vía admin
    // (ya autorizado por el select RLS de arriba); NO vía crear_documento_venta, cuyo
    // check de rol usa auth.uid() y fallaría bajo service_role.
    const { data: ncDoc, error: eNc } = await admin
      .from('documentos_venta')
      .insert({
        empresa_id: activa.id, tipo: 'nota_credito', cliente_id: ref.cliente_id, estado: 'borrador',
        neto: ref.neto, exento: ref.exento, iva: ref.iva, total: ref.total,
      })
      .select('id')
      .single()
    if (eNc || !ncDoc) throw new Error('No se pudo crear la nota de crédito')
    const ncId = ncDoc.id
    await admin.from('documentos_venta_lineas').insert({
      empresa_id: activa.id, documento_id: ncId, producto_id: null,
      descripcion: 'Anulación ' + ref.tipo + ' folio ' + ref.folio, cantidad: 1,
      precio_neto: ref.total, exenta: false, subtotal: ref.total,
    })
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
    await admin.from('documentos_venta').update({
      folio: folioNc as number, documento_referencia_id: refId, razon_anulacion: razon,
      estado: resultado.estado === 'emitido' ? 'emitido' : 'pendiente_envio',
      track_id: resultado.trackId, xml_timbrado: resultado.xmlTimbrado, pdf_ruta: resultado.pdfBase64,
      emitido_en: resultado.estado === 'emitido' ? new Date().toISOString() : null,
    }).eq('id', ncId)
  } catch {
    // Silencioso; la NC queda sin emitir y el usuario reintenta.
  }
  revalidatePath('/ventas')
}
