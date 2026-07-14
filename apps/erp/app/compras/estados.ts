export const TONO_ESTADO: Record<string, 'verde' | 'amarillo' | 'rojo' | 'gris'> = {
  borrador: 'gris',
  enviada: 'amarillo',
  recibida_parcial: 'amarillo',
  recibida_total: 'verde',
  cancelada: 'rojo',
}

export const ETIQUETA_ESTADO: Record<string, string> = {
  borrador: 'Borrador',
  enviada: 'Enviada',
  recibida_parcial: 'Recibida parcial',
  recibida_total: 'Recibida total',
  cancelada: 'Cancelada',
}

export const ESTADOS_OC = ['borrador', 'enviada', 'recibida_parcial', 'recibida_total', 'cancelada'] as const
