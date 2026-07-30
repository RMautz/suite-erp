import { describe, expect, it } from 'vitest'
import { parsearCSV, filasACsv } from './csv'

describe('parsearCSV', () => {
  it('parsea CSV simple con coma', () => {
    expect(parsearCSV('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ])
  })
  it('autodetecta punto y coma (export típico de Excel chileno)', () => {
    expect(parsearCSV('sku;nombre;precio\nA1;Arroz;12.990')).toEqual([
      ['sku', 'nombre', 'precio'],
      ['A1', 'Arroz', '12.990'],
    ])
  })
  it('respeta comillas: delimitadores y saltos dentro del campo', () => {
    expect(parsearCSV('a,"b,c",d\n"línea1\nlínea2",x,y')).toEqual([
      ['a', 'b,c', 'd'],
      ['línea1\nlínea2', 'x', 'y'],
    ])
  })
  it('des-escapa comillas dobles', () => {
    expect(parsearCSV('nombre\n"Arroz ""premium"""')).toEqual([['nombre'], ['Arroz "premium"']])
  })
  it('maneja CRLF, BOM y línea final vacía', () => {
    expect(parsearCSV('\uFEFFa,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })
  it('texto vacío da lista vacía', () => {
    expect(parsearCSV('')).toEqual([])
    expect(parsearCSV('\n\n')).toEqual([])
  })
})

describe('filasACsv', () => {
  it('separa con ; y termina lineas en CRLF', () => {
    expect(filasACsv(['a', 'b'], [['x', 1]])).toBe('\uFEFFa;b\r\nx;1\r\n')
  })
  it('parte con BOM para que Excel detecte UTF-8', () => {
    expect(filasACsv(['a'], []).startsWith('\uFEFF')).toBe(true)
  })
  it('entrecomilla celdas con ; comillas o saltos, escapando comillas', () => {
    expect(filasACsv(['a'], [['dice "hola"; chao']])).toBe('\uFEFFa\r\n"dice ""hola""; chao"\r\n')
  })
  it('protege contra inyección de fórmulas en celdas de texto', () => {
    expect(filasACsv(['a'], [['=SUM(A1:A9)']])).toBe("\uFEFFa\r\n'=SUM(A1:A9)\r\n")
  })
  it('los números (incluso negativos) van sin proteger ni entrecomillar', () => {
    expect(filasACsv(['a'], [[-100000]])).toBe('\uFEFFa\r\n-100000\r\n')
  })
  it('null y undefined son celdas vacías', () => {
    expect(filasACsv(['a', 'b'], [[null, undefined]])).toBe('\uFEFFa;b\r\n;\r\n')
  })
})
