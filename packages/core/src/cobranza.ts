export function saldoDocumento(total: number, pagado: number, notasCredito: number): number {
  return total - pagado - notasCredito
}

// Fechas ISO yyyy-mm-dd: la comparación lexicográfica equivale a la cronológica.
export function estaVencido(fechaVencimiento: string | null, hoy: string, saldo: number): boolean {
  if (saldo <= 0 || !fechaVencimiento) return false
  return fechaVencimiento < hoy
}

export function cuadraAplicaciones(aplicaciones: { monto: number }[], monto: number): boolean {
  return aplicaciones.reduce((s, a) => s + a.monto, 0) === monto
}
