export * from './tipos'
export { MockDTE } from './mock'
export { cifrar, descifrar, generarClave } from './cripto'
import type { ProveedorDTE } from './tipos'
import { MockDTE } from './mock'

// Task 10 reemplaza el cuerpo por: return ambiente === 'produccion' || ambiente === 'certificacion'
//   ? new SimpleApiDTE(ambiente) : new MockDTE()  (con SimpleApiDTE leyendo la doc en vivo).
export function proveedorPorAmbiente(ambiente: string): ProveedorDTE {
  if (ambiente === 'produccion') {
    throw new Error('El proveedor DTE de producción aún no está configurado (integración SimpleAPI pendiente)')
  }
  return new MockDTE()
}
