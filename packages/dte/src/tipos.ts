import type { TipoDocumento } from '@suite/core'

export interface Emisor {
  rut: string
  razonSocial: string
  giro: string
  direccion: string
  comuna: string
}

export interface Receptor {
  rut: string
  razonSocial: string
  giro?: string
  direccion?: string
  comuna?: string
}

export interface LineaDTE {
  descripcion: string
  cantidad: number
  precioNeto: number
  exenta: boolean
}

export interface CredencialesDTE {
  apiKey: string
  certificadoPfx: Buffer
  certificadoPassword: string
  cafXml: string
}

export interface SolicitudEmision {
  tipo: TipoDocumento
  codigoSii: number
  folio: number
  emisor: Emisor
  receptor: Receptor
  lineas: LineaDTE[]
  neto: number
  exento: number
  iva: number
  total: number
  credenciales: CredencialesDTE
}

export interface SolicitudNotaCredito extends SolicitudEmision {
  folioReferencia: number
  codigoSiiReferencia: number
  razonAnulacion: string
}

export type EstadoResultado = 'emitido' | 'pendiente_envio' | 'rechazado'

export interface ResultadoEmision {
  estado: EstadoResultado
  folio: number
  trackId: string | null
  xmlTimbrado: string | null
  pdfBase64: string | null
  error: string | null
}

export type EstadoDTE = 'aceptado' | 'rechazado' | 'pendiente'

export interface ProveedorDTE {
  emitirDTE(solicitud: SolicitudEmision): Promise<ResultadoEmision>
  consultarEstado(trackId: string, credenciales: CredencialesDTE): Promise<EstadoDTE>
  anularConNotaCredito(solicitud: SolicitudNotaCredito): Promise<ResultadoEmision>
}
