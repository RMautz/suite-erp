import { describe, expect, it } from 'vitest'
import {
  formatearCLP,
  parsearBooleano,
  parsearPrecioCLP,
  validarFilaCliente,
  validarFilaProducto,
} from './maestros'

describe('formatearCLP', () => {
  it('separa miles con punto y antepone $', () => {
    expect(formatearCLP(12990)).toBe('$12.990')
    expect(formatearCLP(1500000)).toBe('$1.500.000')
    expect(formatearCLP(0)).toBe('$0')
    expect(formatearCLP(999)).toBe('$999')
  })
})

describe('parsearPrecioCLP', () => {
  it('acepta enteros y strings numéricos', () => {
    expect(parsearPrecioCLP(12990)).toBe(12990)
    expect(parsearPrecioCLP('12990')).toBe(12990)
    expect(parsearPrecioCLP('0')).toBe(0)
  })
  it('acepta formato chileno con $ y puntos de miles', () => {
    expect(parsearPrecioCLP('12.990')).toBe(12990)
    expect(parsearPrecioCLP(' $1.500.000 ')).toBe(1500000)
  })
  it('rechaza decimales, negativos y basura', () => {
    expect(parsearPrecioCLP('12,50')).toBeNull()
    expect(parsearPrecioCLP('12990.00')).toBeNull() // puntos que no agrupan de a 3
    expect(parsearPrecioCLP(-5)).toBeNull()
    expect(parsearPrecioCLP(12.5)).toBeNull()
    expect(parsearPrecioCLP('')).toBeNull()
    expect(parsearPrecioCLP('abc')).toBeNull()
    expect(parsearPrecioCLP(undefined)).toBeNull()
  })
})

describe('parsearBooleano', () => {
  it('reconoce afirmativos en español', () => {
    expect(parsearBooleano('si')).toBe(true)
    expect(parsearBooleano('SÍ')).toBe(true)
    expect(parsearBooleano('1')).toBe(true)
    expect(parsearBooleano('true')).toBe(true)
    expect(parsearBooleano(true)).toBe(true)
  })
  it('reconoce negativos y vacío como false', () => {
    expect(parsearBooleano('no')).toBe(false)
    expect(parsearBooleano('0')).toBe(false)
    expect(parsearBooleano('false')).toBe(false)
    expect(parsearBooleano('')).toBe(false)
    expect(parsearBooleano(undefined)).toBe(false)
    expect(parsearBooleano(null)).toBe(false)
  })
  it('devuelve null ante valores ambiguos', () => {
    expect(parsearBooleano('quizás')).toBeNull()
    expect(parsearBooleano('2')).toBeNull()
  })
})

describe('validarFilaProducto', () => {
  it('acepta una fila completa', () => {
    const r = validarFilaProducto({
      sku: ' A-001 ',
      nombre: ' Arroz grado 1 ',
      precio_neto: '12.990',
      unidad: 'UN',
      codigo_barras: '780001112223',
      categoria: 'Abarrotes',
      exento: 'no',
    })
    expect(r).toEqual({
      ok: true,
      datos: {
        sku: 'A-001',
        nombre: 'Arroz grado 1',
        precioNeto: 12990,
        unidad: 'UN',
        codigoBarras: '780001112223',
        categoria: 'Abarrotes',
        exento: false,
      },
    })
  })
  it('aplica defaults: unidad UN, exento false, opcionales ausentes', () => {
    const r = validarFilaProducto({ sku: 'B1', nombre: 'Pan', precio_neto: '990' })
    expect(r).toEqual({
      ok: true,
      datos: { sku: 'B1', nombre: 'Pan', precioNeto: 990, unidad: 'UN', exento: false },
    })
  })
  it('acumula todos los errores en español', () => {
    const r = validarFilaProducto({ sku: '', nombre: ' ', precio_neto: '12,5', exento: 'quizás' })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errores).toEqual([
        'El SKU es obligatorio',
        'El nombre es obligatorio',
        'El precio neto debe ser un entero CLP mayor o igual a 0',
        'El campo exento debe ser si/no',
      ])
    }
  })
})

describe('validarFilaCliente', () => {
  it('acepta una fila completa y normaliza el RUT', () => {
    const r = validarFilaCliente({
      rut: '76.543.210-3',
      razon_social: ' Comercial Andes SpA ',
      giro: 'Venta al por menor',
      email: 'contacto@andes.cl',
      telefono: '+56 9 1234 5678',
      direccion: 'Av. Siempre Viva 123',
      comuna: 'Maipú',
      condicion_pago_dias: '30',
    })
    expect(r).toEqual({
      ok: true,
      datos: {
        rut: '765432103',
        razonSocial: 'Comercial Andes SpA',
        giro: 'Venta al por menor',
        email: 'contacto@andes.cl',
        telefono: '+56 9 1234 5678',
        direccion: 'Av. Siempre Viva 123',
        comuna: 'Maipú',
        condicionPagoDias: 30,
      },
    })
  })
  it('defaults: condición de pago 0, opcionales ausentes', () => {
    const r = validarFilaCliente({ rut: '11111111-1', razon_social: 'Ana Ltda' })
    expect(r).toEqual({
      ok: true,
      datos: { rut: '111111111', razonSocial: 'Ana Ltda', condicionPagoDias: 0 },
    })
  })
  it('acumula errores: RUT inválido, razón social vacía, email sin @, condición fuera de rango', () => {
    const r = validarFilaCliente({
      rut: '76.543.210-K',
      razon_social: '',
      email: 'no-es-correo',
      condicion_pago_dias: '900',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errores).toEqual([
        'El RUT no es válido',
        'La razón social es obligatoria',
        'El correo no es válido',
        'La condición de pago debe ser un entero entre 0 y 120 días',
      ])
    }
  })
})
