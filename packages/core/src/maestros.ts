import { limpiarRut, validarRut } from './rut'

export function formatearCLP(monto: number): string {
  const signo = monto < 0 ? '-' : ''
  const digitos = Math.trunc(Math.abs(monto)).toString()
  return signo + '$' + digitos.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

export function parsearPrecioCLP(valor: unknown): number | null {
  if (typeof valor === 'number') {
    return Number.isInteger(valor) && valor >= 0 ? valor : null
  }
  if (typeof valor !== 'string') return null
  const limpio = valor.trim().replace(/^\$/, '').trim()
  if (limpio === '') return null
  // Enteros puros o con puntos agrupando exactamente de a 3 (formato chileno).
  if (!/^\d+$/.test(limpio) && !/^\d{1,3}(\.\d{3})+$/.test(limpio)) return null
  return Number(limpio.replace(/\./g, ''))
}

const AFIRMATIVOS = new Set(['si', 'sí', 's', '1', 'true', 'verdadero'])
const NEGATIVOS = new Set(['', 'no', 'n', '0', 'false', 'falso'])

export function parsearBooleano(valor: unknown): boolean | null {
  if (typeof valor === 'boolean') return valor
  if (valor === undefined || valor === null) return false
  const texto = String(valor).trim().toLowerCase()
  if (AFIRMATIVOS.has(texto)) return true
  if (NEGATIVOS.has(texto)) return false
  return null
}

export interface FilaProducto {
  sku: string
  nombre: string
  precioNeto: number
  unidad: string
  codigoBarras?: string
  categoria?: string
  exento: boolean
}

export interface FilaCliente {
  rut: string
  razonSocial: string
  giro?: string
  email?: string
  telefono?: string
  direccion?: string
  comuna?: string
  condicionPagoDias: number
}

export type ResultadoFila<T> = { ok: true; datos: T } | { ok: false; errores: string[] }

function opcional(valor: string | undefined): string | undefined {
  const texto = (valor ?? '').trim()
  return texto === '' ? undefined : texto
}

export function validarFilaProducto(fila: Record<string, string>): ResultadoFila<FilaProducto> {
  const errores: string[] = []
  const sku = (fila.sku ?? '').trim()
  const nombre = (fila.nombre ?? '').trim()
  const precioNeto = parsearPrecioCLP(fila.precio_neto)
  const exento = parsearBooleano(fila.exento)

  if (sku === '') errores.push('El SKU es obligatorio')
  if (nombre === '') errores.push('El nombre es obligatorio')
  if (precioNeto === null) errores.push('El precio neto debe ser un entero CLP mayor o igual a 0')
  if (exento === null) errores.push('El campo exento debe ser si/no')

  if (errores.length > 0) return { ok: false, errores }
  return {
    ok: true,
    datos: {
      sku,
      nombre,
      precioNeto: precioNeto!,
      unidad: (fila.unidad ?? '').trim() || 'UN',
      ...(opcional(fila.codigo_barras) ? { codigoBarras: opcional(fila.codigo_barras) } : {}),
      ...(opcional(fila.categoria) ? { categoria: opcional(fila.categoria) } : {}),
      exento: exento!,
    },
  }
}

export function validarFilaCliente(fila: Record<string, string>): ResultadoFila<FilaCliente> {
  const errores: string[] = []
  const rutCrudo = (fila.rut ?? '').trim()
  const razonSocial = (fila.razon_social ?? '').trim()
  const email = opcional(fila.email)
  const condicionCruda = (fila.condicion_pago_dias ?? '').trim()

  if (!validarRut(rutCrudo)) errores.push('El RUT no es válido')
  if (razonSocial === '') errores.push('La razón social es obligatoria')
  if (email !== undefined && !email.includes('@')) errores.push('El correo no es válido')

  let condicionPagoDias = 0
  if (condicionCruda !== '') {
    const n = Number(condicionCruda)
    if (!Number.isInteger(n) || n < 0 || n > 120) {
      errores.push('La condición de pago debe ser un entero entre 0 y 120 días')
    } else {
      condicionPagoDias = n
    }
  }

  if (errores.length > 0) return { ok: false, errores }
  return {
    ok: true,
    datos: {
      rut: limpiarRut(rutCrudo),
      razonSocial,
      ...(opcional(fila.giro) ? { giro: opcional(fila.giro) } : {}),
      ...(email ? { email } : {}),
      ...(opcional(fila.telefono) ? { telefono: opcional(fila.telefono) } : {}),
      ...(opcional(fila.direccion) ? { direccion: opcional(fila.direccion) } : {}),
      ...(opcional(fila.comuna) ? { comuna: opcional(fila.comuna) } : {}),
      condicionPagoDias,
    },
  }
}
