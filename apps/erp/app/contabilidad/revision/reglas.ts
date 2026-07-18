// Etiquetas legibles de las reglas del Contador Auditor y sus severidades
// (spec §3.3). Compartidas por la página de Revisión y la card de
// /contabilidad para no repetir el mapa. Patrón espejo de origenes.ts (P16).
// Consumo defensivo: ETIQUETA_REGLA[obs.regla] ?? obs.regla (si la RPC ganara
// una regla nueva antes que la UI, se muestra la clave cruda, no revienta).
export const ETIQUETA_REGLA: Record<string, string> = {
  documentos_sin_contabilizar: 'Documentos sin contabilizar',
  iva_descuadrado: 'IVA descuadrado',
  facturas_vencidas_sin_gestion: 'Facturas vencidas sin gestión',
  anomalia_vs_promedio: 'Anomalía frente al promedio',
  anticipos_sin_aplicar: 'Anticipos sin aplicar',
  asientos_tardios: 'Asientos tardíos',
  ejercicio_anterior_abierto: 'Ejercicio anterior abierto',
}

// Severidades cerradas de la RPC (CHECK lógico en revision_periodo): union
// exacta para que el semáforo agregado `estado` y cada observación tipen igual.
export type SeveridadRevision = 'critica' | 'media' | 'ok'

export const ETIQUETA_SEVERIDAD: Record<SeveridadRevision, string> = {
  critica: 'Crítica',
  media: 'Media',
  ok: 'OK',
}

// Payload jsonb de revision_periodo (spec §3.3) tipado del lado TS. `estado`
// es el semáforo agregado: la peor severidad presente; sin observaciones, 'ok'.
export type ObservacionRevision = {
  regla: string
  severidad: SeveridadRevision
  titulo: string
  detalle: string
  enlace_tipo: string | null
  enlace_id: string | null
}

export type RevisionPeriodo = {
  // La RPC arma periodo como jsonb_build_object('anio', p_anio, 'mes', p_mes).
  periodo: { anio: number; mes: number }
  estado: SeveridadRevision
  observaciones: ObservacionRevision[]
}

// Ruta del objeto enlazado por una observación. Mapea EXACTAMENTE los valores
// de enlace_tipo que emite revision_periodo (Task 2): 'documento_venta'
// (regla 3), 'anticipo' (regla 5), 'asiento' (regla 6); las reglas 1/2/4
// emiten null -> sin link, y 'cierre' (regla 7) TAMBIÉN mapea a null: el panel
// de cierre asistido vive en la misma página de Revisión donde se muestra la
// observación (un self-link sería ruido). Mismo criterio que rutaOrigen en
// origenes.ts. La usa la página de Revisión.
export function rutaEnlace(enlaceTipo: string | null, enlaceId: string | null): string | null {
  if (enlaceTipo === 'documento_venta' && enlaceId) return `/ventas/${enlaceId}`
  if (enlaceTipo === 'asiento' && enlaceId) return `/contabilidad/asientos/${enlaceId}`
  if (enlaceTipo === 'anticipo') return '/cobranza'
  return null
}
