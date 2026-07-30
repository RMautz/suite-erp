export const TONO_ESTADO: Record<string, 'verde' | 'amarillo' | 'rojo' | 'gris'> = {
  registrada: 'amarillo',
  facturada: 'verde',
  anulada: 'rojo',
}

export const ETIQUETA_ESTADO: Record<string, string> = {
  registrada: 'Registrada',
  facturada: 'Facturada',
  anulada: 'Anulada',
}

export const ESTADOS_ORDEN = ['registrada', 'facturada', 'anulada'] as const
