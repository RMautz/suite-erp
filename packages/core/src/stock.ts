export type TipoMovimiento = 'entrada' | 'salida' | 'ajuste' | 'traslado'

export function cantidadConSigno(tipo: 'entrada' | 'salida', cantidad: number): number {
  if (!Number.isInteger(cantidad) || cantidad <= 0) {
    throw new Error('La cantidad debe ser un entero positivo')
  }
  return tipo === 'salida' ? -cantidad : cantidad
}

export function bajoMinimo(stock: number, minimo: number): boolean {
  return stock <= minimo
}

export function formatearCantidad(n: number): string {
  const signo = n < 0 ? '-' : ''
  const abs = Math.abs(Math.trunc(n)).toString()
  return signo + abs.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}
