import { describe, expect, it } from 'vitest'
import { parsearCSV } from './csv'

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
    expect(parsearCSV('﻿a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })
  it('texto vacío da lista vacía', () => {
    expect(parsearCSV('')).toEqual([])
    expect(parsearCSV('\n\n')).toEqual([])
  })
})
