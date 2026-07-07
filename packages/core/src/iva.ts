export const TASA_IVA = 0.19

export interface LineaVenta {
  cantidad: number
  precioNeto: number
  exenta?: boolean
}

export interface Totales {
  neto: number
  exento: number
  iva: number
  total: number
}

export function ivaDesdeNeto(neto: number, tasa: number = TASA_IVA): number {
  return Math.round(neto * tasa)
}

export function netoDesdeBruto(bruto: number, tasa: number = TASA_IVA): number {
  return Math.round(bruto / (1 + tasa))
}

export function calcularTotales(lineas: LineaVenta[], tasa: number = TASA_IVA): Totales {
  let neto = 0
  let exento = 0
  for (const linea of lineas) {
    const subtotal = Math.round(linea.cantidad * linea.precioNeto)
    if (linea.exenta) exento += subtotal
    else neto += subtotal
  }
  const iva = Math.round(neto * tasa)
  return { neto, exento, iva, total: neto + exento + iva }
}
