import { describe, expect, it } from 'vitest'
import { calcularDV, formatearRut, limpiarRut, validarRut } from './rut'

describe('limpiarRut', () => {
  it('quita puntos, guión y espacios', () => {
    expect(limpiarRut('12.345.678-5')).toBe('123456785')
    expect(limpiarRut(' 12345678-5 ')).toBe('123456785')
  })
  it('normaliza k minúscula a mayúscula', () => {
    expect(limpiarRut('6-k')).toBe('6K')
  })
})

describe('calcularDV', () => {
  it('calcula dígitos numéricos', () => {
    expect(calcularDV('12345678')).toBe('5')
    expect(calcularDV('11111111')).toBe('1')
    expect(calcularDV('9999999')).toBe('3')
  })
  it('calcula K cuando el resto es 10', () => {
    expect(calcularDV('6')).toBe('K')
  })
  it('calcula 0 cuando el resto es 11', () => {
    expect(calcularDV('59')).toBe('0')
  })
})

describe('validarRut', () => {
  it('acepta RUT válidos con y sin formato', () => {
    expect(validarRut('12.345.678-5')).toBe(true)
    expect(validarRut('123456785')).toBe(true)
    expect(validarRut('11111111-1')).toBe(true)
    expect(validarRut('6-K')).toBe(true)
    expect(validarRut('6-k')).toBe(true)
  })
  it('rechaza dígito verificador incorrecto', () => {
    expect(validarRut('12.345.678-6')).toBe(false)
    expect(validarRut('11111111-K')).toBe(false)
  })
  it('rechaza entradas malformadas', () => {
    expect(validarRut('')).toBe(false)
    expect(validarRut('K')).toBe(false)
    expect(validarRut('abc')).toBe(false)
    expect(validarRut('12a45678-5')).toBe(false)
    expect(validarRut('1a2345678-5')).toBe(false)
    expect(validarRut('12.345.678–5')).toBe(false) // guión tipográfico, no ASCII
  })
})

describe('formatearRut', () => {
  it('agrega puntos y guión', () => {
    expect(formatearRut('123456785')).toBe('12.345.678-5')
    expect(formatearRut('6K')).toBe('6-K')
  })
})
