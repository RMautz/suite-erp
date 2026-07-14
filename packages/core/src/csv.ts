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
  const limpio = texto.replace(/^\uFEFF/, '')
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

// Genera CSV compatible con Excel es-CL: BOM (escape \uFEFF, jamás el carácter
// literal en el fuente), separador ';', CRLF. Celdas de TEXTO que parten con
// = + - @ se prefijan con ' (anti inyección de fórmulas: un nombre de cliente
// malicioso no debe ejecutar nada en el Excel del contador). Números sin comillas.
function celdaCsv(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return String(v)
  let s = v
  if (/^[=+\-@]/.test(s)) s = "'" + s
  if (/[";\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"'
  return s
}

export function filasACsv(encabezados: string[], filas: (string | number | null | undefined)[][]): string {
  const lineas = [encabezados as (string | number | null | undefined)[], ...filas].map((f) => f.map(celdaCsv).join(';'))
  return '\uFEFF' + lineas.join('\r\n') + '\r\n'
}
