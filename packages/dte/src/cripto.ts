import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGO = 'aes-256-gcm'

function claveBuffer(claveHex: string): Buffer {
  const b = Buffer.from(claveHex, 'hex')
  if (b.length !== 32) throw new Error('DTE_ENCRYPTION_KEY debe ser 32 bytes en hex (64 caracteres)')
  return b
}

export function cifrar(datos: Buffer, claveHex: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGO, claveBuffer(claveHex), iv)
  const ct = Buffer.concat([cipher.update(datos), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join('.')
}

export function descifrar(paquete: string, claveHex: string): Buffer {
  const [ivB64, tagB64, ctB64] = paquete.split('.')
  if (!ivB64 || !tagB64 || !ctB64) throw new Error('Paquete cifrado con formato inválido')
  const decipher = createDecipheriv(ALGO, claveBuffer(claveHex), Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()])
}

export function generarClave(): string {
  return randomBytes(32).toString('hex')
}
