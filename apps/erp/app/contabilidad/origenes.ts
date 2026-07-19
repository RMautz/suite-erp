// Etiquetas legibles de los orígenes de asiento (spec §4). Compartidas por el resumen,
// la lista y el detalle para no repetir el mapa.
export const ETIQUETA_ORIGEN: Record<string, string> = {
  manual: 'Manual',
  venta: 'Venta',
  nota_credito: 'Nota de crédito',
  compra: 'Compra',
  pago: 'Pago de cliente',
  pago_proveedor: 'Pago a proveedor',
  anticipo: 'Anticipo',
  remuneracion: 'Remuneración',
  reversa: 'Reversa',
  cierre: 'Cierre de ejercicio',
}

// Ruta del documento de origen SOLO cuando existe una pantalla de detalle para él:
// ventas/NC tienen página propia; compra/pago/anticipo viven en listas -> sin link
// (se muestra solo la etiqueta). La usa el detalle de asiento (Task 7).
export function rutaOrigen(origen: string, referenciaId: string | null): string | null {
  if (!referenciaId) return null
  if (origen === 'venta' || origen === 'nota_credito') return `/ventas/${referenciaId}`
  if (origen === 'remuneracion') return `/liquidaciones/${referenciaId}`
  return null
}
