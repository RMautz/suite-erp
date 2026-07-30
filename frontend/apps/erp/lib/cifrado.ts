import 'server-only'

// Clave AES-256-GCM compartida del servidor: cifra certificados/CAF DTE y tokens MP
// por empresa. SOLO server-side; jamás llega al cliente ni a logs.
export function claveCifrado(): string {
  const k = process.env.DTE_ENCRYPTION_KEY
  if (!k) throw new Error('Falta DTE_ENCRYPTION_KEY en el servidor')
  return k
}
