export const TONO_ESTADO: Record<string, 'verde' | 'amarillo' | 'rojo' | 'gris'> = {
  borrador: 'gris',
  enviada: 'amarillo',
  aprobada: 'verde',
  rechazada: 'rojo',
  facturada: 'verde',
}

export const ETIQUETA_ESTADO: Record<string, string> = {
  borrador: 'Borrador',
  enviada: 'Enviada',
  aprobada: 'Aprobada',
  rechazada: 'Rechazada',
  facturada: 'Facturada',
}
