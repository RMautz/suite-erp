'use server'

import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@suite/auth/server'
import { cifrar } from '@suite/dte'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { claveCifrado } from '../../../lib/cifrado'
import type { EstadoForm } from '../../tipos'

export async function guardarEmisor(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const giro = String(formData.get('giro_emisor') ?? '').trim()
  const direccion = String(formData.get('direccion_emisor') ?? '').trim()
  const comuna = String(formData.get('comuna_emisor') ?? '').trim()
  const resolucion = Number(String(formData.get('resolucion_sii_numero') ?? '').trim() || '0')
  const fecha = String(formData.get('resolucion_sii_fecha') ?? '').trim() || null

  if (giro === '') return { error: 'El giro es obligatorio' }

  const supabase = await crearClienteServidor()
  const { data, error } = await supabase
    .from('empresas')
    .update({
      giro_emisor: giro,
      direccion_emisor: direccion || null,
      comuna_emisor: comuna || null,
      resolucion_sii_numero: resolucion || null,
      resolucion_sii_fecha: fecha,
    })
    .eq('id', activa.id)
    .select('id')
  if (error) return { error: 'No se pudieron guardar los datos del emisor' }
  if ((data ?? []).length === 0) return { error: 'No se pudo guardar: tu rol no permite editar la empresa' }

  revalidatePath('/configuracion/dte')
  return {}
}

export async function cargarCertificado(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const archivo = formData.get('certificado')
  const password = String(formData.get('certificado_password') ?? '')
  const apiKey = String(formData.get('dte_api_key') ?? '').trim()
  if (!(archivo instanceof File) || archivo.size === 0) return { error: 'Selecciona el archivo del certificado (.pfx)' }
  if (password === '') return { error: 'Ingresa la contraseña del certificado' }
  if (apiKey === '') return { error: 'Ingresa la API key de tu proveedor DTE' }

  const bytes = Buffer.from(await archivo.arrayBuffer())
  const clave = claveCifrado()

  const supabase = await crearClienteServidor()
  const { data, error } = await supabase
    .from('empresas')
    .update({
      certificado_cifrado: cifrar(bytes, clave),
      certificado_password_cifrada: cifrar(Buffer.from(password, 'utf8'), clave),
      dte_api_key_cifrada: cifrar(Buffer.from(apiKey, 'utf8'), clave),
    })
    .eq('id', activa.id)
    .select('id')
  if (error) return { error: 'No se pudo guardar el certificado' }
  if ((data ?? []).length === 0) return { error: 'No se pudo guardar: solo el dueño o admin puede cargar el certificado' }

  revalidatePath('/configuracion/dte')
  return {}
}

export async function cargarCAF(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const tipo = String(formData.get('tipo_documento') ?? '')
  const archivo = formData.get('caf')
  if (!['factura', 'boleta', 'nota_credito'].includes(tipo)) return { error: 'Tipo de documento inválido' }
  if (!(archivo instanceof File) || archivo.size === 0) return { error: 'Selecciona el archivo CAF (.xml)' }

  const xml = await archivo.text()
  // El CAF del SII trae <RNG><D>desde</D><H>hasta</H></RNG>.
  const desde = Number(xml.match(/<D>(\d+)<\/D>/)?.[1] ?? '')
  const hasta = Number(xml.match(/<H>(\d+)<\/H>/)?.[1] ?? '')
  if (!Number.isInteger(desde) || !Number.isInteger(hasta) || desde < 1 || hasta < desde) {
    return { error: 'No se pudo leer el rango de folios del CAF (revisa el archivo)' }
  }

  const supabase = await crearClienteServidor()
  const { error } = await supabase.from('folios_caf').insert({
    empresa_id: activa.id,
    tipo_documento: tipo,
    desde,
    hasta,
    siguiente: desde,
    xml_caf: cifrar(Buffer.from(xml, 'utf8'), claveCifrado()),
  })
  if (error) {
    if (error.code === '42501') return { error: 'Solo el dueño o admin puede cargar folios CAF' }
    return { error: 'No se pudo cargar el CAF' }
  }

  revalidatePath('/configuracion/dte')
  return {}
}
