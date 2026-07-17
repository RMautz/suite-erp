import { randomUUID } from 'node:crypto'
import type { CorreoMock, Mensaje, ProveedorCorreo } from './tipos'

// Store a nivel de MÓDULO respaldado en globalThis (lección Plan 13, espejo de
// packages/pagos/src/mock.ts): en `next dev` el visor /mock-correo y las Server Actions
// son bundles distintos que el bundler recompila con SU PROPIA instancia del módulo — un
// `const` de módulo se reinicializaría vacío en cada recompilación y perdería los correos.
// globalThis sobrevive porque es el mismo proceso Node. Solo dev/mock; en producción se
// usa ResendCorreo.
interface GlobalConStoreCorreos {
  __suiteCorreoMockStore?: CorreoMock[]
}
const g = globalThis as unknown as GlobalConStoreCorreos
const STORE: CorreoMock[] = (g.__suiteCorreoMockStore ??= [])

// Proveedor simulado: "envía" guardando el correo en el store del módulo y devuelve un id
// mock. El visor lo lee con correosMockEnviados; los tests lo vacían con limpiarCorreosMock.
export class MockCorreo implements ProveedorCorreo {
  async enviar(mensaje: Mensaje): Promise<{ id: string }> {
    const id = 'mock-correo-' + randomUUID()
    STORE.push({ id, para: mensaje.para, asunto: mensaje.asunto, html: mensaje.html })
    return { id }
  }
}

// Los correos "enviados" por el mock, en orden de envío (el visor los muestra).
export function correosMockEnviados(): CorreoMock[] {
  return STORE
}

// Vacía el store (tests/E2E).
export function limpiarCorreosMock(): void {
  STORE.length = 0
}
