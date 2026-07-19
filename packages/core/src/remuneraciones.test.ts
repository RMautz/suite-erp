import { describe, expect, it } from 'vitest'
import {
  calcularLiquidacion,
  type ContratoCalculo,
  type IndicadoresPeriodo,
  type InputsLiquidacion,
} from './remuneraciones'

// Indicadores canónicos del período 2026-06 — MISMOS valores que siembra la
// migración 0025 (+ tasa_sis de la 0026) y que fijan los asserts pgTAP de
// emitir_liquidacion (remuneraciones.test.sql). Los goldens son compartidos
// byte a byte entre SQL y TS: divergencia = bug (specs P18 §3 y P19 §3).
const INDICADORES: IndicadoresPeriodo = {
  uf: 39200,
  utm: 69500,
  ingreso_minimo: 529000,
  tope_imponible_uf: 87.8,
  tope_cesantia_uf: 131.9,
  tasa_sis: 1.53,
  tasas_afp: {
    capital: 11.44,
    cuprum: 11.44,
    habitat: 11.27,
    modelo: 10.58,
    planvital: 11.1,
    provida: 11.45,
    uno: 10.49,
  },
  tramos_impuesto: [
    { desde_utm: 0, hasta_utm: 13.5, factor: 0, rebaja_utm: 0 },
    { desde_utm: 13.5, hasta_utm: 30, factor: 0.04, rebaja_utm: 0.54 },
    { desde_utm: 30, hasta_utm: 50, factor: 0.08, rebaja_utm: 1.74 },
    { desde_utm: 50, hasta_utm: 70, factor: 0.135, rebaja_utm: 4.49 },
    { desde_utm: 70, hasta_utm: 90, factor: 0.23, rebaja_utm: 11.14 },
    { desde_utm: 90, hasta_utm: 120, factor: 0.304, rebaja_utm: 17.8 },
    { desde_utm: 120, hasta_utm: 310, factor: 0.35, rebaja_utm: 23.32 },
    { desde_utm: 310, hasta_utm: null, factor: 0.4, rebaja_utm: 38.82 },
  ],
}

// Tasa mutual canónica de los goldens (default de empresas.tasa_mutual, P19).
const TASA_MUTUAL = 0.9

const DIAS_COMPLETOS: InputsLiquidacion = {
  dias_trabajados: 30,
  extras_imponibles: 0,
  no_imponibles: 0,
}

// Contratos de los 4 goldens (los mismos de los asserts pgTAP).
const FONASA_800: ContratoCalculo = {
  tipo: 'indefinido',
  sueldo_base: 800000,
  gratificacion_legal: true,
  afp: 'habitat',
  salud: 'fonasa',
  plan_isapre_uf: null,
}
const ISAPRE_1200: ContratoCalculo = {
  tipo: 'plazo_fijo',
  sueldo_base: 1200000,
  gratificacion_legal: true,
  afp: 'capital',
  salud: 'isapre',
  plan_isapre_uf: 5.0,
}
const FONASA_4000: ContratoCalculo = {
  tipo: 'indefinido',
  sueldo_base: 4000000,
  gratificacion_legal: true,
  afp: 'modelo',
  salud: 'fonasa',
  plan_isapre_uf: null,
}
const FONASA_2500: ContratoCalculo = {
  tipo: 'indefinido',
  sueldo_base: 2500000,
  gratificacion_legal: true,
  afp: 'habitat',
  salud: 'fonasa',
  plan_isapre_uf: null,
}

describe('calcularLiquidacion — goldens compartidos con pgTAP', () => {
  it('G1: Fonasa indefinido habitat 800.000, 30 días, 50.000 no imponibles', () => {
    expect(
      calcularLiquidacion(
        FONASA_800,
        INDICADORES,
        { ...DIAS_COMPLETOS, no_imponibles: 50000 },
        TASA_MUTUAL,
      ),
    ).toEqual({
      sueldo_proporcional: 800000, // 800.000 × 30/30
      gratificacion: 200000, // min(25% de 800.000, tope 209.396)
      total_imponible: 1000000, // bajo el tope de 87,8 UF (3.441.760)
      afp_monto: 112700, // 11,27%
      salud_monto: 70000, // 7% Fonasa
      cesantia_monto: 6000, // 0,6% indefinido
      impuesto_unico: 0, // base 811.300 < 13,5 UTM (938.250): exenta
      total_descuentos: 188700,
      liquido: 861300, // 1.000.000 + 50.000 − 188.700
      sis_monto: 15300, // round(1.000.000 × 1,53%)
      cesantia_empleador_monto: 24000, // round(1.000.000 × 2,4%) — indefinido
      mutual_monto: 9000, // round(1.000.000 × 0,90%)
      total_aportes: 48300, // 15.300 + 24.000 + 9.000; NO toca el líquido
    })
  })

  it('G2: Isapre plazo fijo capital 1.200.000 con plan 5,0 UF sobre el 7%', () => {
    expect(calcularLiquidacion(ISAPRE_1200, INDICADORES, DIAS_COMPLETOS, TASA_MUTUAL)).toEqual({
      sueldo_proporcional: 1200000,
      gratificacion: 209396, // tope 4,75 IMM/12 muerde (el 25% sería 300.000)
      total_imponible: 1409396,
      afp_monto: 161235, // round(1.409.396 × 11,44%) = round(161.234,9024)
      salud_monto: 196000, // max(98.658, 5 UF = 196.000): el plan es piso
      cesantia_monto: 0, // plazo fijo: el trabajador no cotiza
      impuesto_unico: 4556, // tramo 2: round(1.052.161 × 4% − 37.530)
      total_descuentos: 361791,
      liquido: 1047605,
      sis_monto: 21564, // round(1.409.396 × 1,53%) = round(21.563,7588)
      cesantia_empleador_monto: 42282, // round(1.409.396 × 3,0%) — plazo fijo SÍ cotiza
      mutual_monto: 12685, // round(1.409.396 × 0,90%) = round(12.684,564)
      total_aportes: 76531,
    })
  })

  it('G3: Fonasa indefinido modelo 4.000.000 sobre el tope imponible de 87,8 UF', () => {
    expect(calcularLiquidacion(FONASA_4000, INDICADORES, DIAS_COMPLETOS, TASA_MUTUAL)).toEqual({
      sueldo_proporcional: 4000000,
      gratificacion: 209396,
      total_imponible: 3441760, // topado: round(87,8 × 39.200); sin tope sería 4.209.396
      afp_monto: 364138, // round(3.441.760 × 10,58%) = round(364.138,208)
      salud_monto: 240923, // round(240.923,2)
      cesantia_monto: 20651, // round(3.441.760 × 0,6%) = round(20.650,56)
      impuesto_unico: 104354, // tramo 3: round(2.816.048 × 8% − 120.930)
      total_descuentos: 730066,
      liquido: 2711694,
      sis_monto: 52659, // round(3.441.760 × 1,53%) = round(52.658,928)
      cesantia_empleador_monto: 82602, // round(3.441.760 × 2,4%) = round(82.602,24)
      mutual_monto: 30976, // round(3.441.760 × 0,90%) = round(30.975,84)
      total_aportes: 166237,
    })
  })

  it('G4: Fonasa indefinido habitat 2.500.000 cae en tramo 3 del impuesto', () => {
    expect(calcularLiquidacion(FONASA_2500, INDICADORES, DIAS_COMPLETOS, TASA_MUTUAL)).toEqual({
      sueldo_proporcional: 2500000,
      gratificacion: 209396,
      total_imponible: 2709396,
      afp_monto: 305349, // round(305.348,9292)
      salud_monto: 189658, // round(189.657,72)
      cesantia_monto: 16256, // round(16.256,376)
      impuesto_unico: 54921, // tramo 3: round(2.198.133 × 8% − 120.930) = round(54.920,64)
      total_descuentos: 566184,
      liquido: 2143212,
      sis_monto: 41454, // round(2.709.396 × 1,53%) = round(41.453,7588)
      cesantia_empleador_monto: 65026, // round(2.709.396 × 2,4%) = round(65.025,504)
      mutual_monto: 24385, // round(2.709.396 × 0,90%) = round(24.384,564)
      total_aportes: 130865,
    })
  })
})

describe('calcularLiquidacion — bordes', () => {
  it('15 días trabajados prorratean sueldo y gratificación', () => {
    expect(
      calcularLiquidacion(
        FONASA_800,
        INDICADORES,
        { dias_trabajados: 15, extras_imponibles: 0, no_imponibles: 50000 },
        TASA_MUTUAL,
      ),
    ).toEqual({
      sueldo_proporcional: 400000, // 800.000 × 15/30
      gratificacion: 100000, // 25% de 400.000, bajo el tope
      total_imponible: 500000,
      afp_monto: 56350,
      salud_monto: 35000,
      cesantia_monto: 3000,
      impuesto_unico: 0, // base 405.650: exenta
      total_descuentos: 94350,
      liquido: 455650, // 500.000 + 50.000 − 94.350
      sis_monto: 7650, // round(500.000 × 1,53%)
      cesantia_empleador_monto: 12000, // round(500.000 × 2,4%)
      mutual_monto: 4500, // round(500.000 × 0,90%)
      total_aportes: 24150,
    })
  })

  it('plazo fijo no cotiza cesantía (mismo contrato que G1)', () => {
    const r = calcularLiquidacion(
      { ...FONASA_800, tipo: 'plazo_fijo' },
      INDICADORES,
      { ...DIAS_COMPLETOS, no_imponibles: 50000 },
      TASA_MUTUAL,
    )
    expect(r.cesantia_monto).toBe(0)
    expect(r.liquido).toBe(867300) // los 6.000 de G1 no se descuentan
  })

  it('plan Isapre bajo el 7% del imponible: rige el 7% (el plan es piso, no techo)', () => {
    const r = calcularLiquidacion(
      { ...ISAPRE_1200, plan_isapre_uf: 2.0 },
      INDICADORES,
      DIAS_COMPLETOS,
      TASA_MUTUAL,
    )
    expect(r.salud_monto).toBe(98658) // 7% de 1.409.396 > 2 UF (78.400)
    expect(r.liquido).toBe(1141053)
  })

  it('el tope de cesantía muerde cuando es menor que el imponible', () => {
    // Con los indicadores reales el tope de 131,9 UF (5.170.480) nunca muerde:
    // el imponible ya viene topado a 87,8 UF. Se fuerza un tope menor para
    // ejercitar la rama min() en paridad con la fórmula SQL — la MISMA base
    // topada rige para el trabajador (regla 6) y el empleador (regla 10).
    const r = calcularLiquidacion(
      FONASA_4000,
      { ...INDICADORES, tope_cesantia_uf: 50 },
      DIAS_COMPLETOS,
      TASA_MUTUAL,
    )
    expect(r.cesantia_monto).toBe(11760) // round(round(50 × 39.200) × 0,006) = round(11.760)
    expect(r.cesantia_empleador_monto).toBe(47040) // round(1.960.000 × 2,4%)
  })

  it('base bajo 13,5 UTM queda exenta de impuesto (sueldo mínimo)', () => {
    expect(
      calcularLiquidacion(
        { ...FONASA_800, sueldo_base: 529000 },
        INDICADORES,
        DIAS_COMPLETOS,
        TASA_MUTUAL,
      ),
    ).toEqual({
      sueldo_proporcional: 529000,
      gratificacion: 132250, // 25%, bajo el tope
      total_imponible: 661250,
      afp_monto: 74523, // round(74.522,875) — mitades lejos del cero, como round() SQL
      salud_monto: 46288, // round(46.287,5)
      cesantia_monto: 3968, // round(3.967,5)
      impuesto_unico: 0, // base 536.471 < 938.250 (13,5 UTM)
      total_descuentos: 124779,
      liquido: 536471,
      sis_monto: 10117, // round(661.250 × 1,53%) = round(10.117,125)
      cesantia_empleador_monto: 15870, // round(661.250 × 2,4%)
      mutual_monto: 5951, // round(661.250 × 0,90%) = round(5.951,25)
      total_aportes: 31938,
    })
  })

  it('los no imponibles suman al líquido sin cotizar ni tributar (G4 + 80.000)', () => {
    const r = calcularLiquidacion(
      FONASA_2500,
      INDICADORES,
      { ...DIAS_COMPLETOS, no_imponibles: 80000 },
      TASA_MUTUAL,
    )
    expect(r.total_imponible).toBe(2709396) // igual que G4
    expect(r.impuesto_unico).toBe(54921) // igual que G4
    expect(r.liquido).toBe(2223212) // 2.143.212 + 80.000
  })

  it('AFP sin tasa en los indicadores del período lanza error (la RPC también valida)', () => {
    expect(() =>
      calcularLiquidacion(
        { ...FONASA_800, afp: 'inexistente' },
        INDICADORES,
        DIAS_COMPLETOS,
        TASA_MUTUAL,
      ),
    ).toThrow('AFP sin tasa en los indicadores: inexistente')
  })

  it('un líquido negativo lanza (Isapre cara con 1 día trabajado)', () => {
    // prop 40.000; grat 10.000; imponible 50.000; afp 5.720; salud max(3.500,
    // 5 UF = 196.000) = 196.000; base −151.720 sin tramo → impuesto 0;
    // descuentos 201.720; líquido −151.720 < 0 → mismo mensaje byte-exacto
    // que el guard de la RPC (Global Constraints).
    expect(() =>
      calcularLiquidacion(
        ISAPRE_1200,
        INDICADORES,
        { ...DIAS_COMPLETOS, dias_trabajados: 1 },
        TASA_MUTUAL,
      ),
    ).toThrow('El líquido no puede ser negativo: revisa los días trabajados y los descuentos')
  })
})

describe('calcularLiquidacion — aportes del empleador (P19)', () => {
  it('plazo fijo cotiza cesantía del empleador al 3,0% aunque el trabajador no cotice', () => {
    // G1 con tipo plazo_fijo: mismo imponible 1.000.000; el trabajador deja de
    // aportar (regla 6) pero el empleador sube de 2,4% a 3,0% (regla 10).
    const r = calcularLiquidacion(
      { ...FONASA_800, tipo: 'plazo_fijo' },
      INDICADORES,
      { ...DIAS_COMPLETOS, no_imponibles: 50000 },
      TASA_MUTUAL,
    )
    expect(r.cesantia_monto).toBe(0)
    expect(r.cesantia_empleador_monto).toBe(30000) // round(1.000.000 × 3,0%)
    expect(r.sis_monto).toBe(15300) // igual que G1: el SIS no depende del tipo
    expect(r.mutual_monto).toBe(9000)
    expect(r.total_aportes).toBe(54300)
    expect(r.liquido).toBe(867300) // los aportes JAMÁS tocan el líquido
  })

  it('tasa_sis 0 y tasa_mutual 0 dejan SIS y mutual en 0 (la cesantía patronal es de ley)', () => {
    const r = calcularLiquidacion(
      FONASA_800,
      { ...INDICADORES, tasa_sis: 0 },
      { ...DIAS_COMPLETOS, no_imponibles: 50000 },
      0,
    )
    expect(r.sis_monto).toBe(0)
    expect(r.mutual_monto).toBe(0)
    expect(r.cesantia_empleador_monto).toBe(24000) // 2,4% es constante de ley, no indicador
    expect(r.total_aportes).toBe(24000)
    expect(r.liquido).toBe(861300) // idéntico a G1: las tasas de aportes no tocan al trabajador
  })
})
