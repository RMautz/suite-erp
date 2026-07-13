import { calcularTotales, type LineaVenta, type Totales, TASA_IVA } from './iva'

export type TipoDocumento = 'nota_venta' | 'factura' | 'boleta' | 'nota_credito'

export const CODIGO_SII: Record<TipoDocumento, number | null> = {
  nota_venta: null,
  factura: 33,
  boleta: 39,
  nota_credito: 61,
}

export function esTributario(tipo: TipoDocumento): boolean {
  return CODIGO_SII[tipo] !== null
}

export function formatearFolio(folio: number): string {
  return 'N° ' + folio
}

export interface LineaDocumento {
  productoId: string
  descripcion: string
  cantidad: number
  precioNeto: number
  exenta: boolean
}

export function subtotalLinea(linea: LineaDocumento): number {
  return Math.round(linea.cantidad * linea.precioNeto)
}

export function totalesDocumento(lineas: LineaDocumento[], tasa: number = TASA_IVA): Totales {
  const lineasVenta: LineaVenta[] = lineas.map((l) => ({
    cantidad: l.cantidad,
    precioNeto: l.precioNeto,
    exenta: l.exenta,
  }))
  return calcularTotales(lineasVenta, tasa)
}
