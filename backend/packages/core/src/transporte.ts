export type EstadoProforma = 'borrador' | 'enviada' | 'aprobada' | 'rechazada' | 'facturada'

// Kilo afecto: reproduce la aritmética numeric(9,2) de crear_orden_entrega, donde
// v_kilos := round(p_kilos, 2) y v_m3 := round(p_m3, 2) se redondean a 2 decimales
// ANTES de comparar. El toFixed(2) en cada paso normaliza el flotante de JS: 0.29 * 250
// es 72.49999999999999 (redondearía a 72) pero en Postgres, con numeric exacto, es 72.50
// (redondea a 73) — el segundo toFixed(2), sobre el producto v_m3 × factor, replica eso.
export function kiloAfecto(kilos: number, m3: number | null, factor: number): number {
  const k = Number(kilos.toFixed(2))
  const v = m3 == null ? 0 : Number(m3.toFixed(2))
  return Math.round(Math.max(k, Number((v * factor).toFixed(2))))
}

// Patentes chilenas: formato nuevo BBCL23 (4 letras + 2 dígitos) y antiguo AB1234
// (2 letras + 4 dígitos) — espejo del CHECK de vehiculos.patente (migración 0016).
const PATENTE_NUEVA = /^[A-Z]{4}\d{2}$/
const PATENTE_ANTIGUA = /^[A-Z]{2}\d{4}$/

export function normalizarPatente(patente: string): string {
  return patente.replace(/[\s.\-·]/g, '').toUpperCase()
}

// Valida la forma NORMALIZADA (lo que se persiste); la UI normaliza antes de validar.
export function validarPatente(patente: string): boolean {
  return PATENTE_NUEVA.test(patente) || PATENTE_ANTIGUA.test(patente)
}

export function formatearPatente(patente: string): string {
  const p = normalizarPatente(patente)
  if (!validarPatente(p)) return p
  return p.replace(/^([A-Z]+)/, '$1-')
}

// Máquina de estados de proformas (espejo exacto de cambiar_estado_proforma +
// facturar_proforma). SOLO topología: en el servidor 'facturada' se alcanza SOLO
// vía facturar_proforma, y facturada→aprobada SOLO vía anular_estado_pago (por eso
// aquí es false: no es una transición pedible a la RPC de estado).
const TRANSICIONES: Record<EstadoProforma, readonly EstadoProforma[]> = {
  borrador: ['enviada', 'rechazada'],
  enviada: ['aprobada', 'rechazada'],
  aprobada: ['rechazada', 'facturada'],
  rechazada: [],
  facturada: [],
}

export function puedeTransicionarProforma(desde: EstadoProforma, hacia: EstadoProforma): boolean {
  return TRANSICIONES[desde].includes(hacia)
}

// Espejo de 'PF-' || lpad(numero::text, 6, '0') — padStart no trunca sobre 6 dígitos
// (lpad sí lo haría, pero es irrelevante bajo 1.000.000 de proformas).
export function formatearNumeroProforma(numero: number): string {
  return 'PF-' + String(numero).padStart(6, '0')
}
