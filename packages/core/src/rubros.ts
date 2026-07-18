export const RUBROS = [
  { codigo: 'negocio', nombre: 'Negocio', descripcion: 'Comercio y servicios: ventas, compras, inventario y cobranza' },
  { codigo: 'transporte', nombre: 'Transporte', descripcion: 'Todo lo de Negocio más flota, tarifario, entregas, proformas y combustible' },
] as const
export type CodigoRubro = (typeof RUBROS)[number]['codigo']
