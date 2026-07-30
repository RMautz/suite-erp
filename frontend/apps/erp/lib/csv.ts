import 'server-only'
import { parsearCSV } from '@suite/core'

// Extraída de app/importar/acciones.ts para que el import TCT (Plan 12) reuse
// la MISMA lectura File → texto → filas: el límite de filas pasa a parámetro
// (el 1000 de /importar queda corto para un año de flota) y se devuelve también
// el texto decodificado, que el guard de archivo re-guardado desde Excel
// necesita inspeccionar (U+FFFD / ';' dominante).
export async function leerCSV(
  formData: FormData,
  maxFilas: number
): Promise<{ filas?: string[][]; texto?: string; codificacionRecuperada?: boolean; error?: string }> {
  const archivo = formData.get('archivo')
  if (!(archivo instanceof File) || archivo.size === 0) {
    return { error: 'Selecciona un archivo CSV' }
  }
  const bytes = new Uint8Array(await archivo.arrayBuffer())
  // Excel en Windows suele exportar CP-1252; si UTF-8 falla, reintentar.
  let texto = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  // Capturado ANTES del fallback: si el decode UTF-8 inicial trae U+FFFD, el
  // archivo viene mal codificado (o re-guardado desde Excel). El import TCT
  // usa este flag para cortar con un mensaje claro; /importar lo IGNORA
  // (cero cambio de conducta ahí — sigue sin mirar el resultado del fallback).
  const codificacionRecuperada = texto.includes('�')
  if (codificacionRecuperada) {
    texto = new TextDecoder('windows-1252').decode(bytes)
  }
  const filas = parsearCSV(texto)
  if (filas.length < 2) return { error: 'El archivo no tiene filas de datos' }
  if (filas.length - 1 > maxFilas) return { error: `Máximo ${maxFilas} filas por archivo` }
  return { filas, texto, codificacionRecuperada }
}
