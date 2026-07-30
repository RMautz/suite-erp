// Parsers del reporte TCT Consumos Diarios de Copec (Plan 12). El CSV en sí
// lo parsea parsearCSV (csv.ts: pela BOM, comillas con comas internas, CRLF,
// auto-detecta separador); aquí vive SOLO lo específico de TCT: localizar
// columnas por nombre y convertir los formatos chilenos del reporte.

// Índices de columna dentro de una fila TCT. Las obligatorias definen si el
// archivo es un Consumos Diarios importable; las opcionales degradan a null.
export interface ColumnasTct {
  patente: number
  fecha: number
  volumen: number
  monto: number
  guia: number
  hora: number | null
  rutChofer: number | null
  estacion: number | null
  comuna: number | null
  precio: number | null
  odometro: number | null
  tarjeta: number | null
  producto: number | null
}

// lowercase + sin tildes + trim: 'Estación de Servicio ' → 'estacion de servicio'.
function normalizarHeader(header: string): string {
  return header
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

// Igualdad EXACTA post-normalización, JAMÁS por inclusión: 'tarjeta' por
// inclusión matchearía 'Tipo de Tarjeta' (columna real del reporte) y el
// import guardaría el tipo del plástico en vez del número de tarjeta.
export function localizarColumnasTct(headers: string[]): ColumnasTct | null {
  const indice = new Map<string, number>()
  headers.forEach((h, i) => {
    const clave = normalizarHeader(h)
    if (!indice.has(clave)) indice.set(clave, i)
  })
  const buscar = (clave: string): number | null => indice.get(clave) ?? null

  const patente = buscar('patente')
  const fecha = buscar('fecha transaccion')
  const volumen = buscar('volumen')
  const monto = buscar('monto')
  const guia = buscar('guia de despacho')
  if (patente === null || fecha === null || volumen === null || monto === null || guia === null) {
    return null
  }
  return {
    patente,
    fecha,
    volumen,
    monto,
    guia,
    hora: buscar('hora transaccion'),
    rutChofer: buscar('rut chofer'),
    estacion: buscar('estacion de servicio'),
    comuna: buscar('comuna'),
    precio: buscar('precio'),
    odometro: buscar('odometro (kms.)'),
    tarjeta: buscar('tarjeta'),
    producto: buscar('producto'),
  }
}

// Número chileno del reporte: puntos de miles, coma decimal ('392076,000',
// '1.060.459', '349,13'). Null si no tiene exactamente esa forma.
function parsearNumeroTct(texto: string): number | null {
  const limpio = texto.trim()
  if (!/^\d{1,3}(\.\d{3})+(,\d+)?$|^\d+(,\d+)?$/.test(limpio)) return null
  return Number(limpio.replace(/\./g, '').replace(',', '.'))
}

// Monto en CLP entero. 'monto' es LA fuente de verdad del import; NO se
// valida monto = litros × precio porque Copec redondea distinto (real:
// 349,13 × 1123 = 392.073 ≠ 392.076). También parsea 'Precio' ('1123,000' → 1123).
export function parsearMontoTct(texto: string): number | null {
  const n = parsearNumeroTct(texto)
  if (n === null) return null
  const monto = Math.round(n)
  return monto > 0 ? monto : null
}

// Litros con 2 decimales: paridad con numeric(9,2) de cargas_combustible.
export function parsearLitrosTct(texto: string): number | null {
  const n = parsearNumeroTct(texto)
  if (n === null) return null
  const litros = Number(n.toFixed(2))
  return litros > 0 ? litros : null
}

// 'DD-MM-YYYY' → 'YYYY-MM-DD' validando calendario REAL con round-trip por
// Date.UTC: '31-02-2026' rueda a marzo y los componentes ya no calzan → null.
// Sin esto, un date inválido revienta el lote completo en Postgres.
export function parsearFechaTct(texto: string): string | null {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(texto.trim())
  if (!m) return null
  const dia = Number(m[1])
  const mes = Number(m[2])
  const anio = Number(m[3])
  const fecha = new Date(Date.UTC(anio, mes - 1, dia))
  if (
    fecha.getUTCFullYear() !== anio ||
    fecha.getUTCMonth() !== mes - 1 ||
    fecha.getUTCDate() !== dia
  ) {
    return null
  }
  return `${m[3]}-${m[2]}-${m[1]}`
}
