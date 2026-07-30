export const TONO_ESTADO: Record<string, 'verde' | 'amarillo' | 'rojo' | 'gris'> = {
  borrador: 'gris',
  enviada: 'amarillo',
  aceptada: 'verde',
  rechazada: 'rojo',
  convertida: 'verde',
}

export const ETIQUETA_ESTADO: Record<string, string> = {
  borrador: 'Borrador',
  enviada: 'Enviada',
  aceptada: 'Aceptada',
  rechazada: 'Rechazada',
  convertida: 'Convertida',
}

export const ESTADOS_COTIZACION = ['borrador', 'enviada', 'aceptada', 'rechazada', 'convertida'] as const
