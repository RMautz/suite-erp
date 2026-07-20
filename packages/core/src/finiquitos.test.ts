import { describe, expect, it } from 'vitest'
import {
  calcularFiniquito,
  calcularVacaciones,
  nombreCompleto,
  type EntradaFiniquito,
} from './finiquitos'

// UF canónica del período 2026-07 — el MISMO valor que siembra la migración
// 0025 y que fijan los asserts pgTAP de emitir_finiquito (finiquitos.test.sql).
// Goldens GF1-GF3 compartidos byte a byte entre SQL y TS: divergencia = bug
// (spec P20 §2.4 y §3). Tope 90 UF = round(90 × 39.350) = 3.541.500.
const UF = 39350

// Entradas de los 3 goldens (las mismas de los asserts pgTAP).
const GF1: EntradaFiniquito = {
  causal: 'necesidades_empresa',
  fecha_inicio: '2023-01-15',
  fecha_termino: '2026-07-31',
  aviso_dado: false,
  sueldo_base: 800000,
  dias_tomados: 10,
  otros_haberes: 0,
  otros_descuentos: 0,
  uf: UF,
}
const GF2: EntradaFiniquito = {
  causal: 'renuncia',
  fecha_inicio: '2025-03-01',
  fecha_termino: '2026-07-31',
  aviso_dado: false,
  sueldo_base: 1200000,
  dias_tomados: 0,
  otros_haberes: 0,
  otros_descuentos: 0,
  uf: UF,
}
const GF3: EntradaFiniquito = {
  causal: 'necesidades_empresa',
  fecha_inicio: '2012-05-01',
  fecha_termino: '2026-07-31',
  aviso_dado: true,
  sueldo_base: 4000000,
  dias_tomados: 200,
  otros_haberes: 0,
  otros_descuentos: 0,
  uf: UF,
}

describe('nombreCompleto — composición del display (spec §2.1)', () => {
  it('compone nombres + paterno + materno con un espacio', () => {
    expect(nombreCompleto('María José', 'Pérez', 'Soto')).toBe('María José Pérez Soto')
  })

  it('materno null: sin espacio colgante (espejo del trim SQL)', () => {
    expect(nombreCompleto('Ana', 'Díaz', null)).toBe('Ana Díaz')
  })
})

describe('calcularVacaciones — devengo 1,25 días/mes (spec §2.4)', () => {
  it('GF1: age 3a6m16d → 42 meses completos → 52,5 devengados, 10 tomados, saldo 42,5', () => {
    expect(calcularVacaciones('2023-01-15', '2026-07-31', 10)).toEqual({
      devengados: 52.5, // 42 × 1,25
      tomados: 10,
      saldo: 42.5,
    })
  })

  it('GF2: age 1a4m30d → 16 meses completos → 20 devengados sin tomas', () => {
    expect(calcularVacaciones('2025-03-01', '2026-07-31', 0)).toEqual({
      devengados: 20, // 16 × 1,25
      tomados: 0,
      saldo: 20,
    })
  })

  it('GF3: age 14a2m30d → 170 meses completos → 212,5 devengados, 200 tomados, saldo 12,5', () => {
    expect(calcularVacaciones('2012-05-01', '2026-07-31', 200)).toEqual({
      devengados: 212.5,
      tomados: 200,
      saldo: 12.5,
    })
  })

  it('el saldo puede ser negativo (la UI lo pinta rojo; el finiquito lo trunca)', () => {
    expect(calcularVacaciones('2025-03-01', '2026-07-31', 25)).toEqual({
      devengados: 20,
      tomados: 25,
      saldo: -5,
    })
  })

  it('mes completo EXACTO: se cumple recién al llegar al mismo día del mes', () => {
    // Semántica age(): el día negativo presta los días del mes de INICIO —
    // del 15-ene al 14-feb hay 0 meses completos; al 15-feb, 1 exacto.
    expect(calcularVacaciones('2023-01-15', '2023-02-14', 0).devengados).toBe(0)
    expect(calcularVacaciones('2023-01-15', '2023-02-15', 0).devengados).toBe(1.25)
    expect(calcularVacaciones('2023-01-15', '2023-01-15', 0).devengados).toBe(0)
  })
})

describe('calcularFiniquito — goldens compartidos con pgTAP (spec §3)', () => {
  it('GF1: necesidades_empresa sin aviso, 800.000, 2023-01-15 → 2026-07-31, 10 tomados', () => {
    expect(calcularFiniquito(GF1)).toEqual({
      anos_servicio: 4, // age = 3a 6m 16d: la fracción de 6 meses Y días SUMA (m=6, d>0)
      indemnizacion_anos: 3200000, // 800.000 × 4 (bajo el tope de 90 UF)
      indemnizacion_aviso: 800000, // sin aviso → un mes de base
      feriado_dias: 42.5, // 52,5 devengados − 10 tomados
      feriado_monto: 1133333, // round(800.000 × 42,5 / 30) = round(1.133.333,33) — multiplicar ANTES de dividir
      total: 5133333, // 3.200.000 + 800.000 + 1.133.333
    })
  })

  it('GF2: renuncia 1.200.000, 2025-03-01 → 2026-07-31: solo feriado', () => {
    expect(calcularFiniquito(GF2)).toEqual({
      anos_servicio: 1, // age = 1a 4m 30d (el snapshot igual lo guarda)
      indemnizacion_anos: 0, // renuncia: sin indemnización por años
      indemnizacion_aviso: 0, // ni aviso, aunque aviso_dado sea false
      feriado_dias: 20,
      feriado_monto: 800000, // round(1.200.000 × 20 / 30) = 800.000 exacto
      total: 800000,
    })
  })

  it('GF3: tope 11 años + tope 90 UF; el feriado usa el sueldo SIN tope', () => {
    expect(calcularFiniquito(GF3)).toEqual({
      anos_servicio: 11, // age = 14a 2m 30d → 14 → tope legal 11
      indemnizacion_anos: 38956500, // min(4.000.000, 3.541.500) × 11
      indemnizacion_aviso: 0, // aviso dado
      feriado_dias: 12.5, // 212,5 − 200
      feriado_monto: 1666667, // round(4.000.000 × 12,5 / 30) — sueldo_base, no la base topada
      total: 40623167, // 38.956.500 + 1.666.667
    })
  })

  it('fracción de 6 meses EXACTOS no suma el año; con días encima sí (GF1)', () => {
    const r = calcularFiniquito({ ...GF1, fecha_termino: '2026-07-15' }) // age = 3a 6m 0d
    expect(r.anos_servicio).toBe(3) // m=6 y d=0: la fracción NO supera los 6 meses
    expect(r.indemnizacion_anos).toBe(2400000) // 800.000 × 3
  })

  it('saldo de vacaciones negativo: feriado 0, jamás resta', () => {
    expect(calcularFiniquito({ ...GF2, dias_tomados: 25 })).toEqual({
      anos_servicio: 1,
      indemnizacion_anos: 0,
      indemnizacion_aviso: 0,
      feriado_dias: 0, // max(−5, 0)
      feriado_monto: 0,
      total: 0,
    })
  })

  it('vencimiento_plazo sin aviso: cero indemnizaciones, solo feriado', () => {
    const r = calcularFiniquito({ ...GF1, causal: 'vencimiento_plazo' })
    expect(r.indemnizacion_anos).toBe(0)
    expect(r.indemnizacion_aviso).toBe(0)
    expect(r.total).toBe(1133333) // solo el feriado de GF1
  })

  it('otros haberes y descuentos entran al total tal cual', () => {
    const r = calcularFiniquito({ ...GF2, otros_haberes: 100000, otros_descuentos: 50000 })
    expect(r.total).toBe(850000) // 800.000 + 100.000 − 50.000
  })

  it('total negativo lanza el guard byte-exacto de la RPC', () => {
    expect(() => calcularFiniquito({ ...GF2, otros_descuentos: 900000 })).toThrow(
      'El total del finiquito no puede ser negativo: revisa los descuentos',
    )
  })

  it('fecha de término anterior al primer contrato lanza el guard byte-exacto de la RPC', () => {
    expect(() => calcularFiniquito({ ...GF1, fecha_termino: '2022-12-31' })).toThrow(
      'La fecha de término no puede ser anterior al inicio del primer contrato',
    )
  })
})
