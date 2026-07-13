import type {
  CredencialesDTE,
  EstadoDTE,
  ProveedorDTE,
  ResultadoEmision,
  SolicitudEmision,
  SolicitudNotaCredito,
} from './tipos'

const RUT_FALLA = '666666666'

export class MockDTE implements ProveedorDTE {
  async emitirDTE(solicitud: SolicitudEmision): Promise<ResultadoEmision> {
    if (solicitud.receptor.rut === RUT_FALLA) {
      return {
        estado: 'pendiente_envio',
        folio: solicitud.folio,
        trackId: null,
        xmlTimbrado: null,
        pdfBase64: null,
        error: 'Proveedor simulado no disponible (RUT de prueba de reintentos)',
      }
    }
    const xml = `<DTE folio="${solicitud.folio}" codigo="${solicitud.codigoSii}" referencia="${
      (solicitud as SolicitudNotaCredito).folioReferencia ?? ''
    }">MOCK</DTE>`
    return {
      estado: 'emitido',
      folio: solicitud.folio,
      trackId: 'mock-' + solicitud.folio,
      xmlTimbrado: xml,
      pdfBase64: Buffer.from('PDF simulado folio ' + solicitud.folio).toString('base64'),
      error: null,
    }
  }

  async consultarEstado(_trackId: string, _credenciales: CredencialesDTE): Promise<EstadoDTE> {
    return 'aceptado'
  }

  async anularConNotaCredito(solicitud: SolicitudNotaCredito): Promise<ResultadoEmision> {
    return this.emitirDTE(solicitud)
  }
}
