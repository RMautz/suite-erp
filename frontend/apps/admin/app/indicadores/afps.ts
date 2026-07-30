// Derivaciones locales del catálogo AFPS de @suite/core (Task 4) — única
// fuente de la lista de AFP en las 3 apps (claves del jsonb tasas_afp,
// spec §2.2/§2.3): acá solo la forma que la UI del admin necesita.
import { AFPS as CATALOGO_AFPS } from '@suite/core'

export const AFPS: readonly string[] = CATALOGO_AFPS.map((a) => a.valor)

export const NOMBRES_AFP: Record<string, string> = Object.fromEntries(
  CATALOGO_AFPS.map((a) => [a.valor, a.etiqueta])
)
