function detectarDelimitador(primeraLinea: string): ',' | ';' {
  let comas = 0
  let puntosComa = 0
  let enComillas = false
  for (const ch of primeraLinea) {
    if (ch === '"') enComillas = !enComillas
    else if (!enComillas && ch === ',') comas++
    else if (!enComillas && ch === ';') puntosComa++
  }
  return puntosComa > comas ? ';' : ','
}

export function parsearCSV(texto: string): string[][] {
  const limpio = texto.replace(/^﻿/, '')
  if (limpio.trim() === '') return []
  const finPrimeraLinea = limpio.indexOf('\n')
  const primeraLinea = finPrimeraLinea === -1 ? limpio : limpio.slice(0, finPrimeraLinea)
  const delimitador = detectarDelimitador(primeraLinea)

  const filas: string[][] = []
  let fila: string[] = []
  let campo = ''
  let enComillas = false

  for (let i = 0; i < limpio.length; i++) {
    const ch = limpio[i]
    if (enComillas) {
      if (ch === '"') {
        if (limpio[i + 1] === '"') {
          campo += '"'
          i++
        } else {
          enComillas = false
        }
      } else {
        campo += ch
      }
    } else if (ch === '"') {
      enComillas = true
    } else if (ch === delimitador) {
      fila.push(campo)
      campo = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && limpio[i + 1] === '\n') i++
      fila.push(campo)
      campo = ''
      if (fila.some((c) => c.trim() !== '')) filas.push(fila)
      fila = []
    } else {
      campo += ch
    }
  }
  fila.push(campo)
  if (fila.some((c) => c.trim() !== '')) filas.push(fila)
  return filas
}
