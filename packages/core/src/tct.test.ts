import { describe, expect, it } from 'vitest'
import {
  localizarColumnasTct,
  parsearFechaTct,
  parsearLitrosTct,
  parsearMontoTct,
} from './tct'

// Header del reporte TCT Consumos Diarios de Copec (21 columnas, con tildes
// tal como llegan en el CSV real). La localización es POR NOMBRE, no por
// posición: si Copec reordena columnas, el import sigue funcionando.
const HEADER_CONSUMOS_DIARIOS = [
  'N° Cuenta', //              0
  'Razón Social', //           1
  'Centro de Costo', //        2
  'Tipo de Tarjeta', //        3  ('tarjeta' por INCLUSIÓN matchearía aquí)
  'Tarjeta', //                4
  'N° Transacción', //         5
  'Fecha Transacción', //      6
  'Hora Transacción', //       7
  'Patente', //                8
  'Rut Chofer', //             9
  'Nombre Chofer', //          10
  'Estación de Servicio', //   11
  'Comuna', //                 12
  'Producto', //               13
  'Precio', //                 14
  'Volumen', //                15
  'Monto', //                  16
  'Odómetro (Kms.)', //        17
  'Kms. Recorridos', //        18
  'Rendimiento (Kms/Lts.)', // 19
  'Guía de Despacho', //       20
]

// Header del reporte AGREGADO Consumos_por_Patente: sin fecha, volumen a
// secas ni guía — no es importable (el ERP lo deriva, no lo traga).
const HEADER_AGREGADO = [
  'Patente',
  'N° Tarjetas',
  'N° Transacciones',
  'Cantidad (Unidad)',
  'Monto ($)',
  'Rendimiento Promedio',
]

describe('localizarColumnasTct', () => {
  it('localiza los índices en el header real de Consumos Diarios (21 columnas)', () => {
    expect(localizarColumnasTct(HEADER_CONSUMOS_DIARIOS)).toEqual({
      patente: 8,
      fecha: 6,
      volumen: 15,
      monto: 16,
      guia: 20,
      hora: 7,
      rutChofer: 9,
      estacion: 11,
      comuna: 12,
      precio: 14,
      odometro: 17,
      tarjeta: 4,
      producto: 13,
    })
  })
  it('el header del agregado Consumos_por_Patente no es importable → null', () => {
    expect(localizarColumnasTct(HEADER_AGREGADO)).toBe(null)
  })
  it('header con mojibake (archivo re-codificado) → null', () => {
    const roto = HEADER_CONSUMOS_DIARIOS.map((h) =>
      h.replace(/ó/g, '�').replace(/í/g, '�'),
    )
    expect(localizarColumnasTct(roto)).toBe(null)
  })
  it('igualdad exacta: sin la columna Tarjeta, Tipo de Tarjeta NO la sustituye', () => {
    const sinTarjeta = HEADER_CONSUMOS_DIARIOS.filter((h) => h !== 'Tarjeta')
    const columnas = localizarColumnasTct(sinTarjeta)
    expect(columnas).not.toBe(null)
    expect(columnas?.tarjeta).toBe(null)
  })
  it('falta una obligatoria (Volumen) → null', () => {
    expect(
      localizarColumnasTct(HEADER_CONSUMOS_DIARIOS.filter((h) => h !== 'Volumen')),
    ).toBe(null)
  })
  it('header mínimo con solo las 5 obligatorias: las opcionales quedan null', () => {
    expect(
      localizarColumnasTct(['Patente', 'Fecha Transacción', 'Volumen', 'Monto', 'Guía de Despacho']),
    ).toEqual({
      patente: 0,
      fecha: 1,
      volumen: 2,
      monto: 3,
      guia: 4,
      hora: null,
      rutChofer: null,
      estacion: null,
      comuna: null,
      precio: null,
      odometro: null,
      tarjeta: null,
      producto: null,
    })
  })
})

describe('parsearMontoTct', () => {
  it("monto real TCT '392076,000' (coma decimal, sin miles) → 392076", () => {
    expect(parsearMontoTct('392076,000')).toBe(392076)
  })
  it("total real con puntos de miles '1.060.459' → 1060459", () => {
    expect(parsearMontoTct('1.060.459')).toBe(1060459)
  })
  it("precio real por litro '1123,000' → 1123", () => {
    expect(parsearMontoTct('1123,000')).toBe(1123)
  })
  it("'0,0' → null (un monto debe ser > 0)", () => {
    expect(parsearMontoTct('0,0')).toBe(null)
  })
  it('vacío → null', () => {
    expect(parsearMontoTct('')).toBe(null)
  })
  it("no numérico ('S/I') → null", () => {
    expect(parsearMontoTct('S/I')).toBe(null)
  })
})

describe('parsearLitrosTct', () => {
  it("volumen real '349,13' → 349.13", () => {
    expect(parsearLitrosTct('349,13')).toBe(349.13)
  })
  it("volumen real '138,33' → 138.33", () => {
    expect(parsearLitrosTct('138,33')).toBe(138.33)
  })
  it("'0,00' → null (los litros deben ser > 0)", () => {
    expect(parsearLitrosTct('0,00')).toBe(null)
  })
})

describe('parsearFechaTct', () => {
  it("fecha real '13-07-2026' (DD-MM-YYYY) → '2026-07-13'", () => {
    expect(parsearFechaTct('13-07-2026')).toBe('2026-07-13')
  })
  it("'31-02-2026' → null (calendario real: febrero no tiene 31)", () => {
    expect(parsearFechaTct('31-02-2026')).toBe(null)
  })
  it("'2026-07-13' → null (formato equivocado: ya viene ISO)", () => {
    expect(parsearFechaTct('2026-07-13')).toBe(null)
  })
  it("'29-02-2024' → '2024-02-29' (bisiesto válido)", () => {
    expect(parsearFechaTct('29-02-2024')).toBe('2024-02-29')
  })
  it('vacío y basura → null', () => {
    expect(parsearFechaTct('')).toBe(null)
    expect(parsearFechaTct('ayer')).toBe(null)
  })
})
