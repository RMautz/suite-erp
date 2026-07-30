// Presentación del semáforo de revisión (spec §4.3). Los TIPOS del payload y
// ETIQUETA_SEVERIDAD viven en reglas.ts (Task 4, fuente única): aquí SOLO los
// mapas de presentación que reglas.ts no define. `severidad` y `estado`
// comparten dominio ('critica'|'media'|'ok'): un solo juego de mapas sirve
// para la insignia de cada observación y el estado agregado del período.
import type { SeveridadRevision } from './reglas'

export const ETIQUETA_ESTADO: Record<SeveridadRevision, string> = {
  ok: 'Al día',
  media: 'Con observaciones',
  critica: 'Requiere atención',
}

// Tonos de <Insignia> (verde/amarillo/rojo — paridad con el semáforo del dashboard).
export const TONO_ESTADO: Record<SeveridadRevision, 'verde' | 'amarillo' | 'rojo'> = {
  ok: 'verde',
  media: 'amarillo',
  critica: 'rojo',
}

// Clases ESTÁTICAS del panel grande (Tailwind no soporta nombres interpolados —
// mismo criterio que componentes/kpi.tsx: emerald/amber/red).
export const PANEL_ESTADO: Record<SeveridadRevision, string> = {
  ok: 'border-l-emerald-500 bg-emerald-50 text-emerald-800',
  media: 'border-l-amber-500 bg-amber-50 text-amber-800',
  critica: 'border-l-red-500 bg-red-50 text-red-800',
}
