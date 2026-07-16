import { randomUUID } from 'node:crypto'
import type {
  EncabezadosFirma,
  PagoConsultado,
  PasarelaPagos,
  Preferencia,
  SolicitudPreferencia,
} from './tipos'

// Store a nivel de MÓDULO: el simulador (Server Action, solo dev) escribe con
// registrarPagoMock y el webhook, en OTRA instancia de MockPasarela, lo lee con
// obtenerPago. Un registro por-instancia no cruzaría ese límite proceso→proceso.
const STORE: Record<string, PagoConsultado> = {}

// Cabeceras de firma que MockPasarela.verificarFirma acepta (ignora su contenido:
// solo el secret === 'mock' importa). El simulador las manda al webhook real.
export const CABECERA_FIRMA_MOCK: Record<string, string> = {
  'x-signature': 'mock',
  'x-request-id': 'mock',
}

// El simulador registra un pago aprobado en el store del módulo; el webhook lo
// consulta después con obtenerPago(mpPaymentId). Solo dev (modo mock).
export function registrarPagoMock(pago: {
  mpPaymentId: string
  monto: number
  externalReference: string
}): void {
  STORE[pago.mpPaymentId] = {
    estado: 'approved',
    monto: pago.monto,
    externalReference: pago.externalReference,
  }
}

// Pasarela simulada (patrón MockDTE): opera el ciclo completo sin credenciales.
// crearPreferencia devuelve una URL a la página local /mock-pago/[id] (solo dev)
// que dispara el webhook REAL con firma mock. obtenerPago lee el registro
// inyectado por constructor (unit tests) y, si no está, el store de módulo que
// alimenta registrarPagoMock (simulador → webhook).
export class MockPasarela implements PasarelaPagos {
  constructor(private readonly registro: Record<string, PagoConsultado> = {}) {}

  async crearPreferencia(_solicitud: SolicitudPreferencia): Promise<Preferencia> {
    const preferenciaId = 'mock-' + randomUUID()
    return { preferenciaId, url: '/mock-pago/' + preferenciaId }
  }

  async obtenerPago(mpPaymentId: string): Promise<PagoConsultado | null> {
    return this.registro[mpPaymentId] ?? STORE[mpPaymentId] ?? null
  }

  verificarFirma(_headers: EncabezadosFirma, _dataId: string, secret: string): boolean {
    return secret === 'mock'
  }
}
