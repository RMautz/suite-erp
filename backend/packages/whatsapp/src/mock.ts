import { randomUUID } from 'node:crypto'
import type { ProveedorWhatsApp, WhatsAppMock } from './tipos'

// Store a nivel de modulo respaldado en globalThis (patron MockCorreo P10 / leccion
// Plan 13): en `next dev` el simulador /mock-whatsapp y el webhook son bundles
// distintos que el bundler recompila con SU PROPIA instancia del modulo; globalThis
// sobrevive porque es el mismo proceso Node. Solo dev/mock.
interface GlobalConStoreWhatsApp {
  __suiteWhatsappMockStore?: WhatsAppMock[]
}
const g = globalThis as unknown as GlobalConStoreWhatsApp
const STORE: WhatsAppMock[] = (g.__suiteWhatsappMockStore ??= [])

// Proveedor simulado: "envia" guardando el mensaje en el store; el simulador lo lee
// con whatsappMockEnviados; los tests lo vacian con limpiarWhatsappMock.
export class MockWhatsApp implements ProveedorWhatsApp {
  async enviarTexto(telefono: string, texto: string): Promise<void> {
    STORE.push({ id: 'mock-wa-' + randomUUID(), telefono, texto })
  }
}

export function whatsappMockEnviados(): WhatsAppMock[] {
  return STORE
}

export function limpiarWhatsappMock(): void {
  STORE.length = 0
}
