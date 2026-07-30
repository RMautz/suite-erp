export type EstadoCotizacion = 'borrador' | 'enviada' | 'aceptada' | 'rechazada' | 'convertida'

// Máquina de estados de cotizaciones (espejo exacto de cambiar_estado_cotizacion +
// convertir_cotizacion). SOLO topología: la condición de fecha para aceptar vive en la RPC.
const TRANSICIONES: Record<EstadoCotizacion, readonly EstadoCotizacion[]> = {
  borrador: ['enviada', 'rechazada'],
  enviada: ['aceptada', 'rechazada'],
  aceptada: ['convertida'],
  rechazada: [],
  convertida: [],
}

export function puedeTransicionarCotizacion(desde: EstadoCotizacion, hacia: EstadoCotizacion): boolean {
  return TRANSICIONES[desde].includes(hacia)
}

// Fechas ISO yyyy-mm-dd: la comparación lexicográfica equivale a la cronológica (criterio estaVencido).
// La insignia Vencida solo aplica a borrador/enviada: la aceptada congeló el trato y
// rechazada/convertida son terminales.
export function cotizacionVencida(fechaValidez: string | null, hoy: string, estado: EstadoCotizacion): boolean {
  if (estado !== 'borrador' && estado !== 'enviada') return false
  if (!fechaValidez) return false
  return fechaValidez < hoy
}
