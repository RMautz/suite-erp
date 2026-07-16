export const CATEGORIAS_GASTO = ['peaje', 'mantencion', 'neumaticos', 'seguro', 'permiso', 'otro'] as const

export const ETIQUETA_CATEGORIA: Record<string, string> = {
  peaje: 'Peaje',
  mantencion: 'Mantención',
  neumaticos: 'Neumáticos',
  seguro: 'Seguro',
  permiso: 'Permiso de circulación',
  otro: 'Otro',
}
