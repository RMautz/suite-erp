import { createHmac, timingSafeEqual } from 'node:crypto'

// Verificacion de la firma X-Hub-Signature-256 de Meta: 'sha256=' + hex del
// HMAC-SHA256(appSecret, cuerpo crudo). Helper PURO (spec §2): el webhook le pasa el
// body como string y el header tal cual llego. timingSafeEqual evita fuga de tiempo;
// largo distinto -> false directo (timingSafeEqual exige buffers del mismo largo).
export function verificarFirma(cuerpo: string, firma: string | null, appSecret: string): boolean {
  if (!firma || !firma.startsWith('sha256=')) return false
  const esperada = createHmac('sha256', appSecret).update(cuerpo, 'utf8').digest('hex')
  const recibida = firma.slice('sha256='.length)
  if (recibida.length !== esperada.length) return false
  return timingSafeEqual(Buffer.from(recibida, 'utf8'), Buffer.from(esperada, 'utf8'))
}
