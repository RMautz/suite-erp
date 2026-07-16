// Contrato del adaptador de pagos (spec §4). PasarelaPagos abstrae MercadoPago
// para que la app opere igual contra el Mock (dev/E2E) y contra el proveedor
// real, seleccionados por env como el proveedor DTE.

// Tipo del segmento `tipo` del external_reference: el origen del link de pago.
export type TipoReferencia = 'factura' | 'proforma' | 'cotizacion'

// external_reference despiezado: "{tipo}:{empresaId}:{objetoId}:{linkId}".
export interface ReferenciaPago {
  tipo: TipoReferencia
  empresaId: string
  objetoId: string
  linkId: string
}

export interface SolicitudPreferencia {
  titulo: string
  monto: number
  externalReference: string
  urlRetorno: string
}

export interface Preferencia {
  preferenciaId: string
  url: string
}

// Lo mínimo que el webhook necesita de un pago consultado a MP. `estado` es el
// status crudo de MP ('approved' | 'pending' | 'rejected' | ...); el webhook
// solo actúa sobre 'approved'.
export interface PagoConsultado {
  estado: string
  monto: number
  externalReference: string
}

// Headers relevantes para verificar la firma del webhook. En el route handler
// se arman con request.headers.get(...), que devuelve string | null.
export interface EncabezadosFirma {
  'x-signature'?: string | null
  'x-request-id'?: string | null
}

export interface PasarelaPagos {
  crearPreferencia(solicitud: SolicitudPreferencia): Promise<Preferencia>
  obtenerPago(mpPaymentId: string): Promise<PagoConsultado | null>
  verificarFirma(headers: EncabezadosFirma, dataId: string, secret: string): boolean
}
