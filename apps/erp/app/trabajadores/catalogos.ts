// Catálogos UI de Personas (patrón origenes.ts de contabilidad). AFPS viene de
// @suite/core (Task 4): ÚNICA fuente de la lista de AFP en las 3 apps — acá
// solo se re-exporta y se derivan las etiquetas. La tasa vigente de cada AFP
// NO vive acá: está en indicadores_previsionales.tasas_afp y la mantiene el
// admin de plataforma.
import { AFPS } from '@suite/core'

export { AFPS }

export const ETIQUETA_AFP: Record<string, string> = Object.fromEntries(
  AFPS.map((a) => [a.valor, a.etiqueta])
)

export const ETIQUETA_TIPO: Record<string, string> = {
  indefinido: 'Indefinido',
  plazo_fijo: 'Plazo fijo',
}
