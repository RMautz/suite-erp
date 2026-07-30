// Referencia propia de suscripciones (spec §4): "suscripcion:{pagoId}:{buyOrder}".
// NO se cruza con armarReferencia del Plan 13 (4 segmentos con enum de tipos): el
// prefijo fijo 'suscripcion' nunca es un tipo del enum {factura, proforma,
// cotizacion} y el conteo de segmentos difiere → ninguna parsea a la otra.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// buy_order de Webpay: <=26 chars alfanumericos (crear_pago_suscripcion genera 25).
const BUY_ORDER = /^[0-9a-zA-Z]{1,26}$/

export interface ReferenciaSuscripcion {
  pagoId: string
  buyOrder: string
}

export function armarReferenciaSuscripcion(ref: ReferenciaSuscripcion): string {
  return `suscripcion:${ref.pagoId}:${ref.buyOrder}`
}

// Parseo ESTRICTO: exactamente 3 segmentos, prefijo literal 'suscripcion', pagoId
// uuid valido y buyOrder alfanumerico <=26. Cualquier desviacion → null (el webhook
// lo vuelve 200 no-op: una referencia mal formada nunca dispara un registro de dinero).
export function parsearReferenciaSuscripcion(texto: string): ReferenciaSuscripcion | null {
  const seg = texto.split(':')
  if (seg.length !== 3) return null
  const [prefijo, pagoId, buyOrder] = seg
  if (prefijo !== 'suscripcion') return null
  if (pagoId === undefined || buyOrder === undefined) return null
  if (!UUID.test(pagoId)) return null
  if (!BUY_ORDER.test(buyOrder)) return null
  return { pagoId, buyOrder }
}
