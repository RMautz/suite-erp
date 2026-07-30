// Estados de liquidaciones (spec §2.4). 'borrador' está en el CHECK pero queda
// reservado para futuro: la emisión crea directo en 'emitida'.
export const TONO_ESTADO: Record<string, 'verde' | 'amarillo' | 'rojo' | 'gris'> = {
  borrador: 'gris',
  emitida: 'amarillo',
  pagada: 'verde',
  anulada: 'rojo',
}

export const ETIQUETA_ESTADO: Record<string, string> = {
  borrador: 'Borrador',
  emitida: 'Emitida',
  pagada: 'Pagada',
  anulada: 'Anulada',
}

// Nombres comerciales de las AFP: re-export de la derivación ÚNICA que la
// Task 5 dejó en trabajadores/catalogos.ts (ETIQUETA_AFP ← AFPS de
// @suite/core) — prohibido re-derivarla acá (Global Constraints).
export { ETIQUETA_AFP as AFP_NOMBRE } from '../trabajadores/catalogos'

// 'YYYY-MM' → 'julio de 2026'. Client-safe: la usan la vista previa (client
// component) y las páginas server; espejo del caso mes de etiquetaPeriodo de
// eerr/calculo.ts, que es server-only y por eso no se importa aquí.
export function etiquetaMes(periodo: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(periodo)
  if (!m) return periodo
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1))
    .toLocaleDateString('es-CL', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}
