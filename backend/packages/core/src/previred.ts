// Archivo PREVIRED (Plan 19 §5 + Plan 20 §5): TXT plano de carga masiva, 105
// campos por línea separados por ';', líneas terminadas en CRLF, SIN BOM (lo
// lee Previred, no Excel — a diferencia de filasACsv). Formato público
// "Archivo de carga masiva" de previred.com. v2 (P20): apellidos desde las
// columnas propias de trabajadores (la heurística separarNombre murió con
// ellas) y código de institución de salud desde el catálogo ISAPRES; el resto
// queda ''/0 según el estándar — el usuario puede ajustar el TXT antes de
// subirlo y la validación final la hace Previred al cargarlo.
import { limpiarRut } from './rut'

// Una liquidación no-anulada del período, ya unida a su trabajador/contrato.
// Los montos vienen del snapshot de liquidaciones (specs P18 §2.4 + P19 §2);
// nombres/apellidos, de las columnas de trabajadores (P20 §2.1); isapre_codigo
// lo resuelve la route con el catálogo ISAPRES desde contratos.isapre.
export interface FilaPrevired {
  rut: string // como en la BD: cuerpo+DV sin puntos ni guión ('123456785')
  nombres: string // trabajadores.nombres
  apellido_paterno: string // trabajadores.apellido_paterno
  apellido_materno: string | null // trabajadores.apellido_materno ('' en el TXT si null)
  periodo: string // 'AAAA-MM' de la liquidación
  dias_trabajados: number
  afp: string // slug del CHECK de contratos.afp
  salud: string // 'fonasa' | 'isapre'
  isapre_codigo: number | null // codigo_previred de ISAPRES; null = fonasa o isapre sin catálogo
  total_imponible: number
  afp_monto: number
  sis_monto: number
  cesantia_monto: number // aporte del trabajador (0 en plazo fijo)
  cesantia_empleador_monto: number
  salud_monto: number // 7% Fonasa o monto pactado Isapre, en CLP
  mutual_monto: number
}

// Tabla FIJA de códigos Previred por slug de AFP (spec P19 §5). Cambia solo
// si entra una AFP nueva al catálogo AFPS de remuneraciones.ts.
export const CODIGO_AFP_PREVIRED: Record<string, string> = {
  capital: '33',
  cuprum: '3',
  habitat: '14',
  modelo: '34',
  planvital: '29',
  provida: '8',
  uno: '35',
}

// Los 105 campos del formato público, 1-based en los comentarios. Poblados
// v2 (specs P19 §5 + P20 §5): RUT/DV, apellidos y nombres de columnas, días,
// AFP + montos, cesantía trabajador/empleador, salud (7 Fonasa / código del
// catálogo / 0 isapre sin catálogo), mutual. El resto queda '' (texto/fecha/
// código) o 0 (montos/contadores).
function lineaPrevired(f: FilaPrevired): string {
  const codigoAfp = CODIGO_AFP_PREVIRED[f.afp]
  if (codigoAfp === undefined) throw new Error(`AFP sin código Previred: ${f.afp}`)
  const rut = limpiarRut(f.rut)
  const mmaaaa = f.periodo.slice(5, 7) + f.periodo.slice(0, 4)
  const fonasa = f.salud === 'fonasa'
  const campos: (string | number)[] = [
    rut.slice(0, -1), // 1 RUT trabajador (sin DV)
    rut.slice(-1), // 2 DV
    f.apellido_paterno, // 3 apellido paterno (columna propia desde P20)
    f.apellido_materno ?? '', // 4 apellido materno ('' si null en BD)
    f.nombres, // 5 nombres
    '', // 6 sexo (no almacenado)
    0, // 7 nacionalidad (0 = chileno)
    '01', // 8 tipo de pago (01 = remuneraciones)
    mmaaaa, // 9 período desde (MMAAAA)
    mmaaaa, // 10 período hasta (MMAAAA)
    'AFP', // 11 régimen previsional
    0, // 12 tipo de trabajador (0 = activo)
    f.dias_trabajados, // 13 días trabajados
    '00', // 14 tipo de línea (00 = principal)
    0, // 15 código movimiento de personal (0 = sin novedades)
    '', // 16 fecha desde (solo con movimiento)
    '', // 17 fecha hasta (solo con movimiento)
    '', // 18 tramo asignación familiar (no gestionada)
    0, // 19 n° cargas simples
    0, // 20 n° cargas maternales
    0, // 21 n° cargas inválidas
    0, // 22 asignación familiar
    0, // 23 asignación familiar retroactiva
    0, // 24 reintegro cargas familiares
    '', // 25 solicitud trabajador joven
    codigoAfp, // 26 código AFP Previred
    f.total_imponible, // 27 renta imponible AFP
    f.afp_monto, // 28 cotización obligatoria AFP
    f.sis_monto, // 29 cotización SIS (aporte del empleador)
    0, // 30 cuenta de ahorro voluntario AFP
    0, // 31 renta imponible sustitutiva
    0, // 32 tasa pactada (sustitutiva)
    0, // 33 aporte indemnización (sustitutiva)
    0, // 34 n° períodos (sustitutiva)
    '', // 35 período desde (sustitutiva)
    '', // 36 período hasta (sustitutiva)
    '', // 37 puesto de trabajo pesado
    0, // 38 % cotización trabajo pesado
    0, // 39 cotización trabajo pesado
    '', // 40 código institución APVI
    '', // 41 n° contrato APVI
    '', // 42 forma de pago APVI
    0, // 43 cotización APVI
    0, // 44 cotización depósitos convenidos
    '', // 45 código institución APVC
    '', // 46 n° contrato APVC
    '', // 47 forma de pago APVC
    0, // 48 cotización trabajador APVC
    0, // 49 cotización empleador APVC
    0, // 50 RUT afiliado voluntario
    '', // 51 DV afiliado voluntario
    '', // 52 apellido paterno (afiliado voluntario)
    '', // 53 apellido materno (afiliado voluntario)
    '', // 54 nombres (afiliado voluntario)
    0, // 55 código movimiento personal (afiliado voluntario)
    '', // 56 fecha desde (afiliado voluntario)
    '', // 57 fecha hasta (afiliado voluntario)
    '', // 58 código AFP (afiliado voluntario)
    0, // 59 monto capitalización voluntaria
    0, // 60 monto ahorro voluntario
    0, // 61 n° períodos de cotización
    '', // 62 código ex-caja régimen
    0, // 63 tasa cotización ex-caja
    0, // 64 renta imponible IPS
    0, // 65 cotización obligatoria IPS
    0, // 66 renta imponible desahucio
    '', // 67 código ex-caja desahucio
    0, // 68 tasa cotización desahucio
    0, // 69 cotización desahucio
    fonasa ? f.salud_monto : 0, // 70 cotización Fonasa
    0, // 71 cotización acc. trabajo ISL
    0, // 72 bonificación ley 15.386
    0, // 73 descuento cargas familiares IPS
    0, // 74 bonos gobierno
    fonasa ? '7' : String(f.isapre_codigo ?? 0), // 75 código institución de salud (7 Fonasa; catálogo ISAPRES; 0 isapre sin catálogo — límite v1)
    '', // 76 número del FUN
    fonasa ? 0 : f.total_imponible, // 77 renta imponible Isapre
    fonasa ? '' : '1', // 78 moneda del plan Isapre (1 = pesos: guardamos CLP)
    fonasa ? 0 : f.salud_monto, // 79 cotización pactada Isapre
    0, // 80 cotización obligatoria Isapre (7%)
    0, // 81 cotización adicional voluntaria
    0, // 82 monto GES
    '', // 83 código CCAF
    0, // 84 renta imponible CCAF
    0, // 85 créditos personales CCAF
    0, // 86 descuento dental CCAF
    0, // 87 descuentos por leasing CCAF
    0, // 88 descuentos por seguro de vida CCAF
    0, // 89 otros descuentos CCAF
    0, // 90 cotización CCAF de no afiliados a Isapre
    0, // 91 descuento cargas familiares CCAF
    0, // 92 otros descuentos CCAF 1
    0, // 93 otros descuentos CCAF 2
    0, // 94 bonos gobierno CCAF
    '', // 95 código de sucursal CCAF
    '', // 96 código mutualidad (no almacenamos cuál — límite v1)
    f.total_imponible, // 97 renta imponible mutual
    f.mutual_monto, // 98 cotización accidente del trabajo (mutual)
    '', // 99 sucursal de pago mutual
    f.total_imponible, // 100 renta imponible seguro cesantía (tope 131,9 UF > tope imponible 87,8: nunca muerde)
    f.cesantia_monto, // 101 aporte trabajador seguro cesantía
    f.cesantia_empleador_monto, // 102 aporte empleador seguro cesantía
    0, // 103 RUT pagadora subsidio
    '', // 104 DV pagadora subsidio
    '', // 105 centro de costos / sucursal
  ]
  return campos.join(';')
}

// Un archivo por período: una línea por liquidación no-anulada. Sin filas
// devuelve '' (la route igual debe responder 404/vacío antes de llegar acá).
export function generarPrevired(filas: FilaPrevired[]): string {
  return filas.map((f) => lineaPrevired(f) + '\r\n').join('')
}
