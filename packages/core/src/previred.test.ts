import { describe, expect, it } from 'vitest'
import { CODIGO_AFP_PREVIRED, generarPrevired, separarNombre, type FilaPrevired } from './previred'
import { AFPS } from './remuneraciones'

// Fila del golden G1 (aportes P19): imponible 1.000.000, indefinido, habitat,
// Fonasa, tasas canónicas 1,53 / 0,90. RUT y nombre de fixture (mod-11 válido,
// formato de BD: cuerpo+DV sin puntos ni guión, como trabajadores.rut).
const FILA_G1: FilaPrevired = {
  rut: '123456785',
  nombre: 'María José Pérez Soto',
  periodo: '2026-06',
  dias_trabajados: 30,
  afp: 'habitat',
  salud: 'fonasa',
  total_imponible: 1000000,
  afp_monto: 112700,
  sis_monto: 15300,
  cesantia_monto: 6000,
  cesantia_empleador_monto: 24000,
  salud_monto: 70000,
  mutual_monto: 9000,
}

// Fila del golden G2: plazo fijo capital Isapre (monto pactado 196.000 = 5 UF).
const FILA_G2: FilaPrevired = {
  rut: '876543214',
  nombre: 'Ana Díaz',
  periodo: '2026-06',
  dias_trabajados: 30,
  afp: 'capital',
  salud: 'isapre',
  total_imponible: 1409396,
  afp_monto: 161235,
  sis_monto: 21564,
  cesantia_monto: 0,
  cesantia_empleador_monto: 42282,
  salud_monto: 196000,
  mutual_monto: 12685,
}

describe('separarNombre — heurística del spec §5', () => {
  it('tres o más palabras: las últimas 2 son apellidos paterno/materno', () => {
    expect(separarNombre('María José Pérez Soto')).toEqual({
      nombres: 'María José',
      paterno: 'Pérez',
      materno: 'Soto',
    })
    expect(separarNombre('Amanda Rojas Fuentes')).toEqual({
      nombres: 'Amanda',
      paterno: 'Rojas',
      materno: 'Fuentes',
    })
  })

  it('dos palabras: nombre + apellido paterno, sin materno', () => {
    expect(separarNombre('Ana Díaz')).toEqual({ nombres: 'Ana', paterno: 'Díaz', materno: '' })
  })

  it('una palabra o vacío: solo nombres (espacios extra se ignoran)', () => {
    expect(separarNombre('Cher')).toEqual({ nombres: 'Cher', paterno: '', materno: '' })
    expect(separarNombre('   ')).toEqual({ nombres: '', paterno: '', materno: '' })
  })
})

describe('generarPrevired — TXT de carga masiva (spec §5)', () => {
  it('G1: línea dorada completa de 105 campos', () => {
    const linea = generarPrevired([FILA_G1]).split('\r\n')[0]!
    expect(linea.split(';')).toEqual([
      '12345678', // 1 RUT trabajador (sin DV)
      '5', // 2 DV
      'Pérez', // 3 apellido paterno
      'Soto', // 4 apellido materno
      'María José', // 5 nombres
      '', // 6 sexo (no almacenado)
      '0', // 7 nacionalidad (0 = chileno)
      '01', // 8 tipo de pago (01 = remuneraciones)
      '062026', // 9 período desde (MMAAAA)
      '062026', // 10 período hasta (MMAAAA)
      'AFP', // 11 régimen previsional
      '0', // 12 tipo de trabajador (0 = activo)
      '30', // 13 días trabajados
      '00', // 14 tipo de línea (00 = principal)
      '0', // 15 código movimiento de personal (0 = sin novedades)
      '', // 16 fecha desde (solo con movimiento)
      '', // 17 fecha hasta (solo con movimiento)
      '', // 18 tramo asignación familiar (no gestionada — Plan 20+)
      '0', // 19 n° cargas simples
      '0', // 20 n° cargas maternales
      '0', // 21 n° cargas inválidas
      '0', // 22 asignación familiar
      '0', // 23 asignación familiar retroactiva
      '0', // 24 reintegro cargas familiares
      '', // 25 solicitud trabajador joven
      '14', // 26 código AFP Previred (habitat)
      '1000000', // 27 renta imponible AFP
      '112700', // 28 cotización obligatoria AFP
      '15300', // 29 cotización SIS (aporte del empleador)
      '0', // 30 cuenta de ahorro voluntario AFP
      '0', // 31 renta imponible sustitutiva
      '0', // 32 tasa pactada (sustitutiva)
      '0', // 33 aporte indemnización (sustitutiva)
      '0', // 34 n° períodos (sustitutiva)
      '', // 35 período desde (sustitutiva)
      '', // 36 período hasta (sustitutiva)
      '', // 37 puesto de trabajo pesado
      '0', // 38 % cotización trabajo pesado
      '0', // 39 cotización trabajo pesado
      '', // 40 código institución APVI
      '', // 41 n° contrato APVI
      '', // 42 forma de pago APVI
      '0', // 43 cotización APVI
      '0', // 44 cotización depósitos convenidos
      '', // 45 código institución APVC
      '', // 46 n° contrato APVC
      '', // 47 forma de pago APVC
      '0', // 48 cotización trabajador APVC
      '0', // 49 cotización empleador APVC
      '0', // 50 RUT afiliado voluntario
      '', // 51 DV afiliado voluntario
      '', // 52 apellido paterno (afiliado voluntario)
      '', // 53 apellido materno (afiliado voluntario)
      '', // 54 nombres (afiliado voluntario)
      '0', // 55 código movimiento personal (afiliado voluntario)
      '', // 56 fecha desde (afiliado voluntario)
      '', // 57 fecha hasta (afiliado voluntario)
      '', // 58 código AFP (afiliado voluntario)
      '0', // 59 monto capitalización voluntaria
      '0', // 60 monto ahorro voluntario
      '0', // 61 n° períodos de cotización
      '', // 62 código ex-caja régimen
      '0', // 63 tasa cotización ex-caja
      '0', // 64 renta imponible IPS
      '0', // 65 cotización obligatoria IPS
      '0', // 66 renta imponible desahucio
      '', // 67 código ex-caja desahucio
      '0', // 68 tasa cotización desahucio
      '0', // 69 cotización desahucio
      '70000', // 70 cotización Fonasa (7% del imponible)
      '0', // 71 cotización acc. trabajo ISL
      '0', // 72 bonificación ley 15.386
      '0', // 73 descuento cargas familiares IPS
      '0', // 74 bonos gobierno
      '7', // 75 código institución de salud (7 = Fonasa)
      '', // 76 número del FUN
      '0', // 77 renta imponible Isapre
      '', // 78 moneda del plan Isapre
      '0', // 79 cotización pactada Isapre
      '0', // 80 cotización obligatoria Isapre (7%)
      '0', // 81 cotización adicional voluntaria
      '0', // 82 monto GES
      '', // 83 código CCAF
      '0', // 84 renta imponible CCAF
      '0', // 85 créditos personales CCAF
      '0', // 86 descuento dental CCAF
      '0', // 87 descuentos por leasing CCAF
      '0', // 88 descuentos por seguro de vida CCAF
      '0', // 89 otros descuentos CCAF
      '0', // 90 cotización CCAF de no afiliados a Isapre
      '0', // 91 descuento cargas familiares CCAF
      '0', // 92 otros descuentos CCAF 1
      '0', // 93 otros descuentos CCAF 2
      '0', // 94 bonos gobierno CCAF
      '', // 95 código de sucursal CCAF
      '', // 96 código mutualidad (no almacenamos cuál — límite v1)
      '1000000', // 97 renta imponible mutual
      '9000', // 98 cotización accidente del trabajo (mutual)
      '', // 99 sucursal de pago mutual
      '1000000', // 100 renta imponible seguro cesantía
      '6000', // 101 aporte trabajador seguro cesantía
      '24000', // 102 aporte empleador seguro cesantía
      '0', // 103 RUT pagadora subsidio
      '', // 104 DV pagadora subsidio
      '', // 105 centro de costos / sucursal
    ])
  })

  it('Isapre: código 0 genérico con monto pactado; campos Fonasa en cero', () => {
    const campos = generarPrevired([FILA_G2]).split('\r\n')[0]!.split(';')
    expect(campos[69]).toBe('0') // 70: cotización Fonasa vacía en Isapre
    expect(campos[74]).toBe('0') // 75: código 0 = Isapre genérica (catálogo → Plan 20)
    expect(campos[76]).toBe('1409396') // 77: renta imponible Isapre
    expect(campos[77]).toBe('1') // 78: moneda del plan en pesos (guardamos CLP)
    expect(campos[78]).toBe('196000') // 79: cotización pactada = salud_monto
    expect(campos[25]).toBe('33') // 26: AFP capital
    expect(campos[100]).toBe('0') // 101: cesantía del trabajador (plazo fijo no cotiza)
    expect(campos[101]).toBe('42282') // 102: cesantía del empleador al 3,0%
  })

  it('códigos AFP Previred: tabla fija que cubre los 7 slugs del catálogo', () => {
    expect(CODIGO_AFP_PREVIRED).toEqual({
      capital: '33',
      cuprum: '3',
      habitat: '14',
      modelo: '34',
      planvital: '29',
      provida: '8',
      uno: '35',
    })
    // Toda AFP del catálogo compartido tiene código: si AFPS crece sin tabla,
    // este test revienta antes que Previred rechace el archivo.
    for (const { valor } of AFPS) expect(CODIGO_AFP_PREVIRED[valor]).toBeDefined()
  })

  it('archivo: CRLF por línea, sin BOM, 105 campos, una línea por liquidación', () => {
    const txt = generarPrevired([FILA_G1, FILA_G2])
    expect(txt.startsWith('\uFEFF')).toBe(false) // sin BOM: lo lee Previred, no Excel
    expect(txt.endsWith('\r\n')).toBe(true)
    const lineas = txt.split('\r\n').filter((l) => l !== '')
    expect(lineas).toHaveLength(2)
    for (const linea of lineas) expect(linea.split(';')).toHaveLength(105)
    expect(generarPrevired([])).toBe('')
  })

  it('AFP sin código Previred lanza (fail-closed: jamás una línea con código vacío)', () => {
    expect(() => generarPrevired([{ ...FILA_G1, afp: 'inexistente' }])).toThrow(
      'AFP sin código Previred: inexistente',
    )
  })
})
