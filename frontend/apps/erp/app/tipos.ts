export type EstadoForm = { error?: string }

export type ResultadoImport = {
  error?: string
  procesadas?: number
  errores?: { fila: number; mensajes: string[] }[]
}

export type ResultadoVenta = { error?: string }
