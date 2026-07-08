'use server'

import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@suite/auth/server'
import {
  parsearCSV,
  validarFilaCliente,
  validarFilaProducto,
} from '@suite/core'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import type { ResultadoImport } from '../tipos'

const MAX_FILAS = 1000

async function leerCSV(formData: FormData): Promise<{ filas?: string[][]; error?: string }> {
  const archivo = formData.get('archivo')
  if (!(archivo instanceof File) || archivo.size === 0) {
    return { error: 'Selecciona un archivo CSV' }
  }
  const bytes = new Uint8Array(await archivo.arrayBuffer())
  // Excel en Windows suele exportar CP-1252; si UTF-8 falla, reintentar.
  let texto = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  if (texto.includes('�')) {
    texto = new TextDecoder('windows-1252').decode(bytes)
  }
  const filas = parsearCSV(texto)
  if (filas.length < 2) return { error: 'El archivo no tiene filas de datos' }
  if (filas.length - 1 > MAX_FILAS) return { error: `Máximo ${MAX_FILAS} filas por archivo` }
  return { filas }
}

function filasComoObjetos(filas: string[][]): Record<string, string>[] {
  const encabezados = filas[0]!.map((h) => h.trim().toLowerCase())
  return filas.slice(1).map((fila) => {
    const objeto: Record<string, string> = {}
    encabezados.forEach((encabezado, i) => {
      objeto[encabezado] = (fila[i] ?? '').trim()
    })
    return objeto
  })
}

export async function importarProductos(_prev: ResultadoImport, formData: FormData): Promise<ResultadoImport> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const lectura = await leerCSV(formData)
  if (lectura.error || !lectura.filas) return { error: lectura.error }

  const objetos = filasComoObjetos(lectura.filas)
  const validos = objetos.map(validarFilaProducto)
  const errores = validos
    .map((r, i) => (r.ok ? null : { fila: i + 2, mensajes: r.errores }))
    .filter((e): e is { fila: number; mensajes: string[] } => e !== null)
  const filasOk = validos
    .filter((r): r is Extract<typeof r, { ok: true }> => r.ok)
    .map((r) => r.datos)

  const supabase = await crearClienteServidor()

  // Resolver categorías por nombre (crear las que falten).
  const nombresCategorias = [...new Set(filasOk.map((f) => f.categoria).filter(Boolean))] as string[]
  const categoriaPorNombre = new Map<string, string>()
  for (const nombre of nombresCategorias) {
    const { data, error } = await supabase
      .from('categorias_producto')
      .upsert({ empresa_id: activa.id, nombre }, { onConflict: 'empresa_id,nombre' })
      .select('id')
      .single()
    if (error) return { error: 'No se pudieron crear las categorías: ' + nombre }
    categoriaPorNombre.set(nombre, data.id)
  }

  const registros = filasOk.map((f) => ({
    empresa_id: activa.id,
    sku: f.sku,
    nombre: f.nombre,
    precio_neto: f.precioNeto,
    unidad: f.unidad,
    codigo_barras: f.codigoBarras ?? null,
    categoria_id: f.categoria ? categoriaPorNombre.get(f.categoria)! : null,
    exento: f.exento,
    actualizado_en: new Date().toISOString(),
  }))

  for (let i = 0; i < registros.length; i += 500) {
    const { error } = await supabase
      .from('productos')
      .upsert(registros.slice(i, i + 500), { onConflict: 'empresa_id,sku' })
    if (error) {
      if (error.code === '42501') return { error: 'Tu rol no permite importar productos' }
      return { error: 'Error al guardar los productos: revisa el archivo' }
    }
  }

  revalidatePath('/productos')
  return { procesadas: registros.length, errores }
}

export async function importarClientes(_prev: ResultadoImport, formData: FormData): Promise<ResultadoImport> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const lectura = await leerCSV(formData)
  if (lectura.error || !lectura.filas) return { error: lectura.error }

  const objetos = filasComoObjetos(lectura.filas)
  const validos = objetos.map(validarFilaCliente)
  const errores = validos
    .map((r, i) => (r.ok ? null : { fila: i + 2, mensajes: r.errores }))
    .filter((e): e is { fila: number; mensajes: string[] } => e !== null)
  const filasOk = validos
    .filter((r): r is Extract<typeof r, { ok: true }> => r.ok)
    .map((r) => r.datos)

  const registros = filasOk.map((f) => ({
    empresa_id: activa.id,
    rut: f.rut,
    razon_social: f.razonSocial,
    giro: f.giro ?? null,
    email: f.email ?? null,
    telefono: f.telefono ?? null,
    direccion: f.direccion ?? null,
    comuna: f.comuna ?? null,
    condicion_pago_dias: f.condicionPagoDias,
  }))

  const supabase = await crearClienteServidor()
  for (let i = 0; i < registros.length; i += 500) {
    const { error } = await supabase
      .from('clientes')
      .upsert(registros.slice(i, i + 500), { onConflict: 'empresa_id,rut' })
    if (error) {
      if (error.code === '42501') return { error: 'Tu rol no permite importar clientes' }
      return { error: 'Error al guardar los clientes: revisa el archivo' }
    }
  }

  revalidatePath('/clientes')
  return { procesadas: registros.length, errores }
}
