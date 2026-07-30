// Catálogos UI de Personas (patrón origenes.ts de contabilidad). AFPS e ISAPRES
// vienen de @suite/core: ÚNICA fuente de ambas listas en las 3 apps — acá solo
// se re-exportan y se derivan las etiquetas. La tasa vigente de cada AFP NO
// vive acá: está en indicadores_previsionales.tasas_afp y la mantiene el
// admin de plataforma.
import { AFPS, ISAPRES } from '@suite/core'

export { AFPS, ISAPRES }

export const ETIQUETA_AFP: Record<string, string> = Object.fromEntries(
  AFPS.map((a) => [a.valor, a.etiqueta])
)

export const ETIQUETA_TIPO: Record<string, string> = {
  indefinido: 'Indefinido',
  plazo_fijo: 'Plazo fijo',
}

// Causales legales de término (spec P20 §2.5/§6): la etiqueta lleva el artículo
// del Código del Trabajo — la usan el select del formulario Y el documento.
export const CAUSALES = [
  { valor: 'renuncia', etiqueta: 'Renuncia voluntaria (art. 159 N° 2)' },
  { valor: 'mutuo_acuerdo', etiqueta: 'Mutuo acuerdo de las partes (art. 159 N° 1)' },
  { valor: 'vencimiento_plazo', etiqueta: 'Vencimiento del plazo convenido (art. 159 N° 4)' },
  { valor: 'necesidades_empresa', etiqueta: 'Necesidades de la empresa (art. 161)' },
  { valor: 'conducta_grave', etiqueta: 'Conductas graves del trabajador (art. 160)' },
] as const

export const ETIQUETA_CAUSAL: Record<string, string> = Object.fromEntries(
  CAUSALES.map((c) => [c.valor, c.etiqueta])
)
