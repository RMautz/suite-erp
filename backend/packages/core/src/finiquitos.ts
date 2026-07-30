// Espejo TS del cálculo chileno de finiquitos y vacaciones (spec Plan 20 §2.4
// y §3). La autoridad es la RPC emitir_finiquito (plpgsql, migración 0027):
// este espejo existe SOLO para la vista previa en vivo del formulario de
// finiquito y la sección Vacaciones de la ficha. Ambos lados se prueban con
// los mismos goldens GF1-GF3 (unit acá, pgTAP allá): divergencia = bug.
//
// Redondeo: mismo contrato que remuneraciones.ts — Math.round es espejo fiel
// de round() de plpgsql porque todo lo que se redondea acá es >= 0
// (feriado_dias ya pasó por max(saldo, 0)) y porque se multiplica ANTES de
// dividir (paridad con numeric: dividir primero redondea dos veces en float).

// Días del mes m (1-12) del año y — vía Date.UTC(y, m, 0) = último día del
// mes m. Cubre bisiestos igual que el day_tab de Postgres.
function diasDelMes(anio: number, mes: number): number {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate()
}

// Réplica EXACTA de age(t, i) de Postgres para t >= i (Global Constraints del
// plan): resta campo a campo y normaliza — un día negativo presta los días
// del MES DE LA FECHA DE INICIO (day_tab del segundo argumento en
// timestamp_age); un mes negativo presta 12 del año. NO es la aritmética de
// '+ 1 month': age('2023-02-28','2023-01-31') = 28 días = 0 meses. Un solo
// préstamo basta porque día(inicio) <= días del mes de inicio. Fechas
// invertidas (hasta < desde) quedan fuera de contrato: calcularFiniquito las
// rechaza con el guard byte-exacto de la RPC; calcularVacaciones asume
// hasta >= desde (la ficha pasa hoy o el corte del finiquito).
function edadLaboral(desde: string, hasta: string): { y: number; m: number; d: number } {
  const [ay, am, ad] = desde.split('-').map(Number) as [number, number, number]
  const [by, bm, bd] = hasta.split('-').map(Number) as [number, number, number]
  let y = by - ay
  let m = bm - am
  let d = bd - ad
  if (d < 0) {
    d += diasDelMes(ay, am)
    m -= 1
  }
  if (m < 0) {
    m += 12
    y -= 1
  }
  return { y, m, d }
}

// Única vía de escritura de trabajadores.nombre (spec §2.1): la Server Action
// compone el display desde los 3 campos capturados. Espejo byte a byte de la
// expresión SQL del backfill de la 0027:
// trim(nombres || ' ' || apellido_paterno || ' ' || coalesce(materno, '')).
export function nombreCompleto(nombres: string, paterno: string, materno: string | null): string {
  return (nombres + ' ' + paterno + ' ' + (materno ?? '')).trim()
}

// Devengo y saldo de vacaciones (spec §2.4): 1,25 días hábiles por mes
// completo (y×12 + m de la edad laboral) desde la fecha_inicio del PRIMER
// contrato (continuidad laboral). Sin redondeo: meses × 1,25 siempre cae en
// cuartos exactos (numeric(6,2) en la BD los guarda tal cual) y diasTomados
// es entero → saldo también exacto.
export interface ResultadoVacaciones {
  devengados: number
  tomados: number
  saldo: number // puede ser negativo: la UI lo muestra en rojo (spec §2.4)
}

export function calcularVacaciones(
  fechaInicio: string,
  hasta: string,
  diasTomados: number,
): ResultadoVacaciones {
  const { y, m } = edadLaboral(fechaInicio, hasta)
  const devengados = (y * 12 + m) * 1.25
  return { devengados, tomados: diasTomados, saldo: devengados - diasTomados }
}

// Entrada del espejo: todo sale de BD + formulario. fecha_inicio es la del
// PRIMER contrato del trabajador; uf es el entero de indicadores_previsionales
// del período de fecha_termino (la RPC valida que exista con su propio
// mensaje; la UI no llama al espejo sin indicadores).
export interface EntradaFiniquito {
  causal: string // CHECK de finiquitos: renuncia | mutuo_acuerdo | necesidades_empresa | vencimiento_plazo | conducta_grave
  fecha_inicio: string // 'AAAA-MM-DD' del PRIMER contrato del trabajador
  fecha_termino: string // 'AAAA-MM-DD'
  aviso_dado: boolean // solo pesa en necesidades_empresa
  sueldo_base: number // del contrato vigente, integer CLP
  dias_tomados: number // Σ dias_habiles de vacaciones_tomadas del trabajador
  otros_haberes: number // >= 0
  otros_descuentos: number // >= 0
  uf: number // integer CLP del período de fecha_termino
}

// Snapshot del cálculo (spec §3): las MISMAS columnas que la RPC guarda en
// finiquitos (feriado_dias numeric(6,2); el resto integer CLP). La base
// topada NO se expone: quien la necesite (vista previa de T6) la recalcula
// con Math.min(sueldo_base, Math.round(90 * uf)).
export interface ResultadoFiniquito {
  anos_servicio: number
  indemnizacion_anos: number
  indemnizacion_aviso: number
  feriado_dias: number
  feriado_monto: number
  total: number
}

// Guard de fechas + pasos 1-6 del spec §3, en el MISMO orden y con los MISMOS
// redondeos que la RPC emitir_finiquito (multiplicar antes de dividir: la
// razón vive en el comentario del feriado). Simplificación v1 DECLARADA (visible en el documento
// imprimible): el feriado no convierte hábiles→corridos ni descuenta
// cotizaciones — el contador ajusta con asiento manual si lo necesita.
export function calcularFiniquito(entrada: EntradaFiniquito): ResultadoFiniquito {
  // 0. Guard de fechas byte-exacto con la RPC (Global Constraints): un typo de
  //    fecha produciría años negativos en el snapshot o aviso pagado sin
  //    devengo. Strings ISO comparan bien lexicográficamente.
  if (entrada.fecha_termino < entrada.fecha_inicio)
    throw new Error('La fecha de término no puede ser anterior al inicio del primer contrato')

  // 1. Años de servicio: fracción > 6 meses de la MISMA descomposición age()
  //    — m > 6, o m = 6 con días sobrantes — suma un año. Tope legal 11
  //    (art. 163 CdT). GF1 (3a 6m 16d) SUMA → 4.
  const { y, m, d } = edadLaboral(entrada.fecha_inicio, entrada.fecha_termino)
  const anosServicio = Math.min(y + (m > 6 || (m === 6 && d > 0) ? 1 : 0), 11)

  // 2. Base indemnizatoria topada a 90 UF del período de término.
  const base = Math.min(entrada.sueldo_base, Math.round(90 * entrada.uf))

  // 3-4. Indemnizaciones: solo necesidades_empresa (art. 161); el aviso
  //      omitido agrega un mes de base (art. 162).
  const indemnizacionAnos = entrada.causal === 'necesidades_empresa' ? base * anosServicio : 0
  const indemnizacionAviso =
    entrada.causal === 'necesidades_empresa' && !entrada.aviso_dado ? base : 0

  // 5. Feriado proporcional: saldo de vacaciones a fecha_termino, nunca
  //    negativo; se paga a sueldo_base/30 SIN tope de 90 UF (el tope es de la
  //    indemnización, no del feriado).
  const { saldo } = calcularVacaciones(
    entrada.fecha_inicio,
    entrada.fecha_termino,
    entrada.dias_tomados,
  )
  const feriadoDias = Math.max(saldo, 0)
  // Multiplicar ANTES de dividir: equivalente EXACTO del
  // round(sueldo::numeric × dias / 30) de la RPC. Dividir primero (sueldo/30
  // como float) redondea dos veces y diverge $1 en bordes .5 (ej. 122892 ×
  // 3,75 → 15361 vs 15362). Los goldens GF1-GF3/W5/Amanda no caen en el borde
  // (verificado): valen para ambas formas — el orden correcto se fija igual.
  const feriadoMonto = Math.round((entrada.sueldo_base * feriadoDias) / 30)

  // 6. Total con ajustes manuales. Guard byte-exacto con la RPC (Global
  //    Constraints): descuentos que superan los haberes dejarían un documento
  //    y un asiento negativos.
  const total =
    indemnizacionAnos +
    indemnizacionAviso +
    feriadoMonto +
    entrada.otros_haberes -
    entrada.otros_descuentos
  if (total < 0)
    throw new Error('El total del finiquito no puede ser negativo: revisa los descuentos')

  return {
    anos_servicio: anosServicio,
    indemnizacion_anos: indemnizacionAnos,
    indemnizacion_aviso: indemnizacionAviso,
    feriado_dias: feriadoDias,
    feriado_monto: feriadoMonto,
    total,
  }
}
