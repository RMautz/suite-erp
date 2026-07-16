import type { ReferenciaPago, TipoReferencia } from './tipos'

const TIPOS: readonly TipoReferencia[] = ['factura', 'proforma', 'cotizacion']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function esTipoReferencia(v: string): v is TipoReferencia {
  return (TIPOS as readonly string[]).includes(v)
}

// "{tipo}:{empresaId}:{objetoId}:{linkId}" (~120 chars < 256 de MP).
export function armarReferencia(ref: ReferenciaPago): string {
  return `${ref.tipo}:${ref.empresaId}:${ref.objetoId}:${ref.linkId}`
}

// Parseo ESTRICTO: exactamente 4 segmentos, tipo en el enum y los 3 ids uuids
// válidos. Cualquier desviación → null (el webhook lo convierte en 200 no-op:
// una referencia mal formada nunca dispara un registro de dinero).
export function parsearReferencia(texto: string): ReferenciaPago | null {
  const seg = texto.split(':')
  if (seg.length !== 4) return null
  const [tipo, empresaId, objetoId, linkId] = seg
  if (tipo === undefined || empresaId === undefined || objetoId === undefined || linkId === undefined) {
    return null
  }
  if (!esTipoReferencia(tipo)) return null
  if (!UUID.test(empresaId) || !UUID.test(objetoId) || !UUID.test(linkId)) return null
  return { tipo, empresaId, objetoId, linkId }
}
