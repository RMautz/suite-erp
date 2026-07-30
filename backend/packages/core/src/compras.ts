export type LineaOrdenCompra = { cantidadPedida: number; cantidadRecibida: number }

export function pendienteLinea(linea: LineaOrdenCompra): number {
  return Math.max(0, linea.cantidadPedida - linea.cantidadRecibida)
}

export function estadoOrdenTrasRecepcion(lineas: LineaOrdenCompra[]): 'recibida_parcial' | 'recibida_total' {
  return lineas.some((l) => pendienteLinea(l) > 0) ? 'recibida_parcial' : 'recibida_total'
}

export function totalOrden(lineas: { cantidad: number; costoUnitario: number }[]): number {
  return lineas.reduce((s, l) => s + Math.round(l.cantidad * l.costoUnitario), 0)
}
