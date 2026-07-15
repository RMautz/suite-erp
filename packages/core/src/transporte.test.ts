import { describe, expect, it } from 'vitest'
import {
  formatearNumeroProforma,
  formatearPatente,
  kiloAfecto,
  normalizarPatente,
  puedeTransicionarProforma,
  validarPatente,
} from './transporte'

describe('kiloAfecto', () => {
  it('el volumen manda cuando supera al peso (fila real: 175 kg, 1.26 M3, factor 250)', () => {
    expect(kiloAfecto(175, 1.26, 250)).toBe(315)
  })
  it('el peso manda cuando supera al volumen (fila real: 787 kg, 2.88 M3, factor 250)', () => {
    expect(kiloAfecto(787, 2.88, 250)).toBe(787)
  })
  it('sin M3 tarifa por peso puro', () => {
    expect(kiloAfecto(100, null, 250)).toBe(100)
  })
  it('el factor volumétrico de la empresa cambia el resultado', () => {
    expect(kiloAfecto(175, 1.26, 300)).toBe(378)
  })
  it('frontera .5: 0.29 × 250 = 72.50 redondea a 73 como en Postgres (no 72 por flotantes)', () => {
    expect(kiloAfecto(10, 0.29, 250)).toBe(73)
  })
})

describe('normalizarPatente', () => {
  it('sube a mayúsculas y quita el guion', () => {
    expect(normalizarPatente('bbcl-23')).toBe('BBCL23')
  })
  it('quita espacios, puntos y punto medio', () => {
    expect(normalizarPatente(' ab·12.34 ')).toBe('AB1234')
  })
  it('una patente ya normalizada queda igual', () => {
    expect(normalizarPatente('BBCL23')).toBe('BBCL23')
  })
})

describe('validarPatente', () => {
  it('acepta el formato nuevo (4 letras + 2 dígitos)', () => {
    expect(validarPatente('BBCL23')).toBe(true)
  })
  it('acepta el formato antiguo (2 letras + 4 dígitos)', () => {
    expect(validarPatente('AB1234')).toBe(true)
  })
  it('rechaza 3 letras + 3 dígitos (no es formato chileno)', () => {
    expect(validarPatente('ABC123')).toBe(false)
  })
  it('exige entrada normalizada: minúsculas no validan', () => {
    expect(validarPatente('bbcl23')).toBe(false)
  })
  it('rechaza largos incorrectos y vacío', () => {
    expect(validarPatente('BBCL234')).toBe(false)
    expect(validarPatente('')).toBe(false)
  })
})

describe('formatearPatente', () => {
  it('separa letras y dígitos con guion', () => {
    expect(formatearPatente('BBCL23')).toBe('BBCL-23')
    expect(formatearPatente('AB1234')).toBe('AB-1234')
  })
  it('normaliza antes de formatear', () => {
    expect(formatearPatente('bb cl23')).toBe('BBCL-23')
  })
})

describe('puedeTransicionarProforma', () => {
  it('borrador puede enviarse', () => {
    expect(puedeTransicionarProforma('borrador', 'enviada')).toBe(true)
  })
  it('borrador puede rechazarse (proforma mal armada)', () => {
    expect(puedeTransicionarProforma('borrador', 'rechazada')).toBe(true)
  })
  it('enviada puede aprobarse o rechazarse', () => {
    expect(puedeTransicionarProforma('enviada', 'aprobada')).toBe(true)
    expect(puedeTransicionarProforma('enviada', 'rechazada')).toBe(true)
  })
  it('aprobada puede rechazarse (el rechazo libera las ODEs incluso aquí)', () => {
    expect(puedeTransicionarProforma('aprobada', 'rechazada')).toBe(true)
  })
  it('aprobada puede facturarse (en el servidor SOLO vía facturar_proforma)', () => {
    expect(puedeTransicionarProforma('aprobada', 'facturada')).toBe(true)
  })
  it('ninguna otra transición es válida', () => {
    // facturada→aprobada existe en el servidor SOLO vía anular_estado_pago, no por aquí.
    expect(puedeTransicionarProforma('facturada', 'aprobada')).toBe(false)
    expect(puedeTransicionarProforma('facturada', 'rechazada')).toBe(false)
    expect(puedeTransicionarProforma('rechazada', 'enviada')).toBe(false)
    expect(puedeTransicionarProforma('borrador', 'aprobada')).toBe(false)
    expect(puedeTransicionarProforma('enviada', 'facturada')).toBe(false)
  })
})

describe('formatearNumeroProforma', () => {
  it('rellena a 6 dígitos (el correlativo real del usuario)', () => {
    expect(formatearNumeroProforma(4)).toBe('PF-000004')
  })
  it('sobre 6 dígitos no rellena ni trunca', () => {
    expect(formatearNumeroProforma(123456)).toBe('PF-123456')
  })
})
