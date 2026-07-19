// Espejo TS del cálculo chileno de liquidaciones de sueldo (spec Plan 18 §3).
// La autoridad es la RPC emitir_liquidacion (plpgsql, migración 0025): este
// espejo existe SOLO para la vista previa en vivo del formulario. Ambos lados
// se prueban con los mismos goldens (unit acá, pgTAP allá): divergencia = bug.
//
// Redondeo: round() de plpgsql sobre numeric redondea mitades lejos del cero.
// Math.round coincide para valores >= 0 (mitades hacia arriba) y solo difiere
// en negativos; todos los montos de este módulo son >= 0, así que Math.round
// es un espejo fiel. La RPC debe dividir en numeric (/ 30.0, no / 30) para no
// truncar en división entera.

// Subconjunto estructural de contratos.Row (@suite/db): una fila de la BD se
// pasa directo. tipo: 'indefinido' | 'plazo_fijo'; salud: 'fonasa' | 'isapre';
// afp: clave de tasas_afp — los CHECK de la BD garantizan los valores.
export interface ContratoCalculo {
  tipo: string
  sueldo_base: number
  gratificacion_legal: boolean
  afp: string
  salud: string
  plan_isapre_uf: number | null
}

// Tramo de la tabla SII del período (elemento del jsonb tramos_impuesto).
export interface TramoImpuesto {
  desde_utm: number
  hasta_utm: number | null
  factor: number
  rebaja_utm: number
}

// Fila de indicadores_previsionales del período, con los jsonb ya parseados.
export interface IndicadoresPeriodo {
  uf: number
  utm: number
  ingreso_minimo: number
  tope_imponible_uf: number
  tope_cesantia_uf: number
  tasas_afp: Record<string, number>
  tramos_impuesto: TramoImpuesto[]
}

// Los únicos inputs del usuario: el resto sale de contrato + indicadores.
export interface InputsLiquidacion {
  dias_trabajados: number
  extras_imponibles: number
  no_imponibles: number
}

// Snapshot del cálculo (spec §2.4), todo integer CLP — las mismas columnas
// que la RPC guarda en liquidaciones.
export interface ResultadoLiquidacion {
  sueldo_proporcional: number
  gratificacion: number
  total_imponible: number
  afp_monto: number
  salud_monto: number
  cesantia_monto: number
  impuesto_unico: number
  total_descuentos: number
  liquido: number
}

// Catálogo compartido de AFP: slugs EXACTOS del CHECK de contratos.afp (0025,
// spec §2.2) + nombre comercial. Única fuente de la lista en las 3 apps; la
// tasa vigente de cada AFP NO vive acá (está en indicadores_previsionales).
export const AFPS = [
  { valor: 'capital', etiqueta: 'Capital' },
  { valor: 'cuprum', etiqueta: 'Cuprum' },
  { valor: 'habitat', etiqueta: 'Habitat' },
  { valor: 'modelo', etiqueta: 'Modelo' },
  { valor: 'planvital', etiqueta: 'PlanVital' },
  { valor: 'provida', etiqueta: 'ProVida' },
  { valor: 'uno', etiqueta: 'Uno' },
] as const

// Reglas 1-8 del spec §3, en el MISMO orden y con los MISMOS redondeos
// intermedios que la RPC emitir_liquidacion.
export function calcularLiquidacion(
  contrato: ContratoCalculo,
  indicadores: IndicadoresPeriodo,
  inputs: InputsLiquidacion,
): ResultadoLiquidacion {
  const tasaAfp = indicadores.tasas_afp[contrato.afp]
  if (tasaAfp === undefined) throw new Error(`AFP sin tasa en los indicadores: ${contrato.afp}`)

  // 1. Sueldo proporcional a los días trabajados (mes comercial de 30 días).
  const sueldoProporcional = Math.round((contrato.sueldo_base * inputs.dias_trabajados) / 30)

  // 2. Gratificación legal: 25% de lo imponible del mes, con tope anual de
  //    4,75 ingresos mínimos prorrateado a 1/12 mensual.
  const gratificacion = contrato.gratificacion_legal
    ? Math.min(
        Math.round(0.25 * (sueldoProporcional + inputs.extras_imponibles)),
        Math.round((4.75 * indicadores.ingreso_minimo) / 12),
      )
    : 0

  // 3. Imponible topado (87,8 UF para AFP y salud).
  const totalImponible = Math.min(
    sueldoProporcional + inputs.extras_imponibles + gratificacion,
    Math.round(indicadores.tope_imponible_uf * indicadores.uf),
  )

  // 4. AFP: tasa total con comisión, del jsonb del período según el contrato.
  const afpMonto = Math.round((totalImponible * tasaAfp) / 100)

  // 5. Salud: Fonasa 7%; Isapre max(7%, plan UF) — el plan pactado es piso.
  const sietePorCiento = Math.round(totalImponible * 0.07)
  const saludMonto =
    contrato.salud === 'fonasa'
      ? sietePorCiento
      : Math.max(sietePorCiento, Math.round((contrato.plan_isapre_uf ?? 0) * indicadores.uf))

  // 6. Cesantía 0,6% solo indefinido (plazo fijo: el trabajador no cotiza),
  //    con tope propio de 131,9 UF.
  const cesantiaMonto =
    contrato.tipo === 'indefinido'
      ? Math.round(
          Math.min(totalImponible, Math.round(indicadores.tope_cesantia_uf * indicadores.uf)) *
            0.006,
        )
      : 0

  // 7. Impuesto único de segunda categoría: primer tramo (en UTM) que
  //    contiene la base tributable; en un borde exacto ambos tramos dan el
  //    mismo impuesto (la tabla SII es continua). Mínimo 0.
  const baseTributable = totalImponible - afpMonto - saludMonto - cesantiaMonto
  const baseUtm = baseTributable / indicadores.utm
  const tramo = indicadores.tramos_impuesto.find(
    (t) => baseUtm >= t.desde_utm && (t.hasta_utm === null || baseUtm <= t.hasta_utm),
  )
  const impuestoUnico = tramo
    ? Math.max(0, Math.round(baseTributable * tramo.factor - tramo.rebaja_utm * indicadores.utm))
    : 0

  // 8. Totales: los no imponibles (colación/movilización) suman al líquido
  //    sin cotizar ni tributar.
  const totalDescuentos = afpMonto + saludMonto + cesantiaMonto + impuestoUnico
  const liquido = totalImponible + inputs.no_imponibles - totalDescuentos
  // Guard byte-exacto con la RPC (Global Constraints): pocos días + plan
  // Isapre como piso pueden dar líquido < 0 y el asiento nacería descuadrado.
  // La UI captura este throw y lo muestra como aviso en la vista previa.
  if (liquido < 0)
    throw new Error('El líquido no puede ser negativo: revisa los días trabajados y los descuentos')
  return {
    sueldo_proporcional: sueldoProporcional,
    gratificacion,
    total_imponible: totalImponible,
    afp_monto: afpMonto,
    salud_monto: saludMonto,
    cesantia_monto: cesantiaMonto,
    impuesto_unico: impuestoUnico,
    total_descuentos: totalDescuentos,
    liquido,
  }
}
