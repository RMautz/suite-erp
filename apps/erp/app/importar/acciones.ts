'use server'

import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@suite/auth/server'
import { validarFilaCliente, validarFilaProducto } from '@suite/core'
import { leerCSV } from '../../lib/csv'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import type { ResultadoImport } from '../tipos'

const MAX_FILAS = 1000

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

  const lectura = await leerCSV(formData, MAX_FILAS)
  if (lectura.error || !lectura.filas) return { error: lectura.error }

  const objetos = filasComoObjetos(lectura.filas)
  const validos = objetos.map(validarFilaProducto)
  const errores = validos
    .map((r, i) => (r.ok ? null : { fila: i + 2, mensajes: r.errores }))
    .filter((e): e is { fila: number; mensajes: string[] } => e !== null)
  const filasOkConFila = validos
    .map((r, i) => (r.ok ? { datos: r.datos, fila: i + 2 } : null))
    .filter(
      (v): v is { datos: Extract<(typeof validos)[number], { ok: true }>['datos']; fila: number } => v !== null
    )
  const filasOk = filasOkConFila.map((v) => v.datos)

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
    if (error) {
      if (error.code === '42501') return { error: 'Tu rol no permite importar productos' }
      if (error.code === '23505') return { error: 'Esa categoría ya existe (revisa mayúsculas/minúsculas)' }
      return { error: 'No se pudieron crear las categorías: ' + nombre }
    }
    categoriaPorNombre.set(nombre, data.id)
  }

  const registrosConFila = filasOkConFila.map(({ datos: f, fila }) => ({
    registro: {
      empresa_id: activa.id,
      sku: f.sku,
      nombre: f.nombre,
      precio_neto: f.precioNeto,
      unidad: f.unidad,
      codigo_barras: f.codigoBarras ?? null,
      categoria_id: f.categoria ? categoriaPorNombre.get(f.categoria)! : null,
      exento: f.exento,
      activo: true,
      actualizado_en: new Date().toISOString(),
    },
    fila,
  }))

  const porClave = new Map<string, { registro: (typeof registrosConFila)[number]['registro']; fila: number }>()
  for (const { registro, fila } of registrosConFila) {
    const clave = registro.sku
    const previo = porClave.get(clave)
    if (previo) {
      errores.push({ fila: previo.fila, mensajes: ['SKU duplicado en el archivo; se usó la última aparición'] })
    }
    porClave.set(clave, { registro, fila })
  }
  const registros = [...porClave.values()].map((v) => v.registro)
  errores.sort((a, b) => a.fila - b.fila)

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

  const lectura = await leerCSV(formData, MAX_FILAS)
  if (lectura.error || !lectura.filas) return { error: lectura.error }

  const objetos = filasComoObjetos(lectura.filas)
  const validos = objetos.map(validarFilaCliente)
  const errores = validos
    .map((r, i) => (r.ok ? null : { fila: i + 2, mensajes: r.errores }))
    .filter((e): e is { fila: number; mensajes: string[] } => e !== null)
  const filasOkConFila = validos
    .map((r, i) => (r.ok ? { datos: r.datos, fila: i + 2 } : null))
    .filter(
      (v): v is { datos: Extract<(typeof validos)[number], { ok: true }>['datos']; fila: number } => v !== null
    )

  const registrosConFila = filasOkConFila.map(({ datos: f, fila }) => ({
    registro: {
      empresa_id: activa.id,
      rut: f.rut,
      razon_social: f.razonSocial,
      giro: f.giro ?? null,
      email: f.email ?? null,
      telefono: f.telefono ?? null,
      direccion: f.direccion ?? null,
      comuna: f.comuna ?? null,
      condicion_pago_dias: f.condicionPagoDias,
      activo: true,
    },
    fila,
  }))

  const porClave = new Map<string, { registro: (typeof registrosConFila)[number]['registro']; fila: number }>()
  for (const { registro, fila } of registrosConFila) {
    const clave = registro.rut
    const previo = porClave.get(clave)
    if (previo) {
      errores.push({ fila: previo.fila, mensajes: ['RUT duplicado en el archivo; se usó la última aparición'] })
    }
    porClave.set(clave, { registro, fila })
  }
  const registros = [...porClave.values()].map((v) => v.registro)
  errores.sort((a, b) => a.fila - b.fila)

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
