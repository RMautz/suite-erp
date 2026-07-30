'use server'

import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@suite/auth/server'
import {
  limpiarRut,
  localizarColumnasTct,
  normalizarPatente,
  parsearFechaTct,
  parsearLitrosTct,
  parsearMontoTct,
} from '@suite/core'
import { leerCSV } from '../../lib/csv'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'

export interface ResultadoImportTct {
  importadas: number
  duplicadas: number
  errores: { fila: number; motivo: string }[]
  error?: string
}

// El MAX_FILAS = 1000 de /importar queda corto para un año de flota.
const MAX_FILAS_TCT = 20000
const MAX_BYTES_TCT = 10 * 1024 * 1024
const LOTE = 500
const RE_HORA = /^\d{2}:\d{2}(:\d{2})?$/

// Celda por índice de columna; tolera índice ausente (== null cubre null y
// undefined: las columnas opcionales de ColumnasTct pueden venir de ambas formas).
// Campos INFORMATIVOS (precio_litro, odómetro): fuera de rango int4 → null en vez
// de error de fila — no son fuente de verdad y un desborde tumbaría el lote (22003).
function enRangoInt4(valor: number | null): number | null {
  return valor !== null && valor <= 2147483647 ? valor : null
}

function celda(fila: string[], indice: number | null | undefined): string {
  return indice == null ? '' : (fila[indice] ?? '').trim()
}

// Set COMPLETO de claves en todas las filas: el bulk insert de PostgREST exige
// que cada objeto del lote tenga las mismas columnas.
interface CargaNueva {
  empresa_id: string
  vehiculo_id: string
  conductor_id: string | null
  fecha: string
  hora: string | null
  litros: number
  precio_litro: number | null
  monto: number
  estacion: string | null
  comuna: string | null
  guia: string
  rut_chofer: string | null
  tarjeta: string | null
  odometro: number | null
  producto: string
  origen: 'tct'
}

export async function importarCargasTct(
  _prev: ResultadoImportTct,
  formData: FormData
): Promise<ResultadoImportTct> {
  const vacio: ResultadoImportTct = { importadas: 0, duplicadas: 0, errores: [] }

  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { ...vacio, error: 'No tienes una empresa activa' }

  const supabase = await crearClienteServidor()

  // (1) Rol ANTES de parsear: un vendedor no pone al server a decodificar
  // 10 MB. La policy de insert de 0017 es el backstop; esto es el corte barato.
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ...vacio, error: 'No tienes una empresa activa' }
  const { data: miembro } = await supabase
    .from('miembros')
    .select('rol')
    .eq('organizacion_id', activa.organizacion_id)
    .eq('usuario_id', user.id)
    .eq('estado', 'activo')
    .maybeSingle()
  if (!miembro || (miembro.rol !== 'dueno' && miembro.rol !== 'admin')) {
    return { ...vacio, error: 'Tu rol no permite importar cargas' }
  }

  // (2) Límites: el bodySizeLimit de next.config es la barrera dura; este
  // check da el mensaje claro. El tope de filas lo aplica leerCSV.
  const archivo = formData.get('archivo')
  if (archivo instanceof File && archivo.size > MAX_BYTES_TCT) {
    return { ...vacio, error: 'El archivo supera el máximo de 10 MB' }
  }

  // (3) Lectura (BOM/encoding) + guard de Excel + localización de columnas.
  const lectura = await leerCSV(formData, MAX_FILAS_TCT)
  if (lectura.error || !lectura.filas || !lectura.texto) {
    return { ...vacio, error: lectura.error ?? 'No se pudo leer el archivo' }
  }
  // Guard de archivo re-guardado desde Excel: el flag viene de leerCSV,
  // capturado ANTES del fallback CP-1252 — por eso es ALCANZABLE (a esta
  // altura lectura.texto ya es el resultado del fallback, sin U+FFFD, así
  // que revisarlo aquí directamente jamás dispararía). Corta ANTES de
  // localizar columnas: un header con mojibake jamás calza de todos modos,
  // pero así el mensaje señala la causa real en vez del genérico.
  if (lectura.codificacionRecuperada) {
    return {
      ...vacio,
      error:
        'El archivo parece re-guardado desde Excel (codificación o separador alterados); sube el CSV original descargado de TCT',
    }
  }
  const columnas = localizarColumnasTct(lectura.filas[0]!)
  if (!columnas) {
    // Guard adicional: ';' dominante en la primera línea delata el
    // re-guardado es-CL de Excel aunque la codificación haya decodificado
    // limpio (el separador cambia sin romper tildes). Los reportes
    // AGREGADOS de TCT caen al mensaje genérico.
    const primeraLinea = lectura.texto.split('\n', 1)[0] ?? ''
    const puntosComa = (primeraLinea.match(/;/g) ?? []).length
    const comas = (primeraLinea.match(/,/g) ?? []).length
    if (puntosComa > comas) {
      return {
        ...vacio,
        error:
          'El archivo parece re-guardado desde Excel (codificación o separador alterados); sube el CSV original descargado de TCT',
      }
    }
    return { ...vacio, error: 'El archivo no parece el reporte TCT de Consumos Diarios' }
  }

  // (4) Lookups por empresa — UNA query por maestro, a Map. El .eq('empresa_id')
  // es el filtro funcional; la RLS es backstop. Vehículos SIN filtrar activo:
  // las cargas históricas de camiones dados de baja entran igual (deliberado).
  // ponytail: sin paginar — una flota real no roza el límite de 1000 filas de PostgREST.
  const { data: vehiculos, error: errorVehiculos } = await supabase
    .from('vehiculos')
    .select('id, patente')
    .eq('empresa_id', activa.id)
  if (errorVehiculos) return { ...vacio, error: 'No se pudo leer la flota' }
  const vehiculoPorPatente = new Map((vehiculos ?? []).map((v) => [v.patente, v.id] as const))

  const { data: conductores, error: errorConductores } = await supabase
    .from('conductores')
    .select('id, rut')
    .eq('empresa_id', activa.id)
  if (errorConductores) return { ...vacio, error: 'No se pudieron leer los conductores' }
  const conductorPorRut = new Map((conductores ?? []).map((c) => [c.rut, c.id] as const))

  const errores: { fila: number; motivo: string }[] = []
  let duplicadas = 0
  const guiasVistas = new Set<string>()
  const candidatas: { fila: number; registro: CargaNueva }[] = []

  lectura.filas.slice(1).forEach((filaCsv, i) => {
    const fila = i + 2 // fila 1 = encabezado

    const patente = normalizarPatente(celda(filaCsv, columnas.patente))
    const vehiculoId = vehiculoPorPatente.get(patente)
    if (!vehiculoId) {
      errores.push({ fila, motivo: `Vehículo con patente ${patente || '(vacía)'} no está registrado en Flota` })
      return
    }

    const fecha = parsearFechaTct(celda(filaCsv, columnas.fecha))
    if (fecha === null) {
      errores.push({ fila, motivo: 'Fecha de transacción inválida (se espera DD-MM-YYYY)' })
      return
    }

    const litros = parsearLitrosTct(celda(filaCsv, columnas.volumen))
    if (litros === null) {
      errores.push({ fila, motivo: 'Volumen inválido (los litros deben ser un número mayor a 0)' })
      return
    }
    // Tope de litros numeric(9,2): sin este corte, un valor fuera de rango
    // revienta el lote entero en Postgres en vez de reportarse por fila.
    if (litros > 9999999.99) {
      errores.push({ fila, motivo: 'litros fuera de rango' })
      return
    }

    const monto = parsearMontoTct(celda(filaCsv, columnas.monto))
    if (monto === null) {
      errores.push({ fila, motivo: 'Monto inválido (debe ser un número mayor a 0)' })
      return
    }
    // Tope de integer de Postgres: mismo motivo que el de litros.
    if (monto > 2147483647) {
      errores.push({ fila, motivo: 'monto fuera de rango' })
      return
    }

    const guia = celda(filaCsv, columnas.guia)
    if (guia === '') {
      errores.push({ fila, motivo: 'sin guía de despacho, no se puede deduplicar' })
      return
    }

    // Dedup in-file: la repetida cuenta como duplicada, no como error.
    if (guiasVistas.has(guia)) {
      duplicadas++
      return
    }
    guiasVistas.add(guia)

    // Hora fuera de formato o de rango calendario NO es error de fila: queda
    // null (coherente con 'hora inválida = null sin error'). La regex sola
    // deja pasar '99:99:99'; HH<24/MM<60/SS<60 cierra ese hueco.
    const horaCruda = celda(filaCsv, columnas.hora)
    let hora: string | null = null
    if (RE_HORA.test(horaCruda)) {
      const [hh, mm, ss] = horaCruda.split(':').map(Number)
      if (hh! < 24 && mm! < 60 && (ss === undefined || ss < 60)) hora = horaCruda
    }

    // RUT del chofer: con match va conductor_id y el RUT NO se persiste
    // (minimización, Ley 21.719 — ya vive en conductores); sin match se
    // persiste el RUT normalizado para trazabilidad. Nunca es error.
    const rutNormalizado = limpiarRut(celda(filaCsv, columnas.rutChofer))
    const conductorId = rutNormalizado === '' ? null : (conductorPorRut.get(rutNormalizado) ?? null)

    const estacion = celda(filaCsv, columnas.estacion)
    const comuna = celda(filaCsv, columnas.comuna)
    const tarjeta = celda(filaCsv, columnas.tarjeta)
    const producto = celda(filaCsv, columnas.producto)

    candidatas.push({
      fila,
      registro: {
        empresa_id: activa.id,
        vehiculo_id: vehiculoId,
        conductor_id: conductorId,
        fecha,
        hora,
        litros,
        // monto es LA fuente de verdad; el precio es informativo y JAMÁS se
        // valida contra litros × precio (Copec redondea distinto: 349,13 ×
        // 1123 = 392.073 ≠ 392.076 del archivo real). Informativo fuera de
        // rango int4 → null (no rechaza la fila ni tumba el lote con 22003).
        precio_litro: enRangoInt4(parsearMontoTct(celda(filaCsv, columnas.precio))),
        monto,
        estacion: estacion || null,
        comuna: comuna || null,
        guia,
        rut_chofer: conductorId === null && rutNormalizado !== '' ? rutNormalizado : null,
        tarjeta: tarjeta || null,
        // Odómetro CRUDO (viene basura, casi siempre '1'); mismo parser
        // numérico TCT, null si no calza o si desborda int4.
        odometro: enRangoInt4(parsearMontoTct(celda(filaCsv, columnas.odometro))),
        producto: producto || 'Diésel',
        origen: 'tct',
      },
    })
  })

  // Dedup contra BD: pre-check por chunks de 500 con .in(). El índice único
  // es POR EMPRESA: sin el .eq('empresa_id'), a un dueño de dos empresas se
  // le saltarían cargas reales.
  const guias = candidatas.map((c) => c.registro.guia)
  const existentes = new Set<string>()
  for (let i = 0; i < guias.length; i += LOTE) {
    const { data, error } = await supabase
      .from('cargas_combustible')
      .select('guia')
      .eq('empresa_id', activa.id)
      .in('guia', guias.slice(i, i + LOTE))
    if (error) return { ...vacio, error: 'No se pudieron verificar duplicados; intenta de nuevo' }
    for (const d of data ?? []) {
      if (d.guia !== null) existentes.add(d.guia)
    }
  }
  const nuevas = candidatas.filter((c) => {
    if (existentes.has(c.registro.guia)) {
      duplicadas++
      return false
    }
    return true
  })

  // (5) Insert en lotes de 500. CUALQUIER error del lote (23505 por carrera
  // con otro import — el pre-check no es transaccional —, 23503 por
  // vehículo/conductor recién eliminado, u otro) dispara retry FILA A FILA:
  // jamás se pierden 499 filas buenas por culpa de una mala, y se reporta
  // solo la caída. La ÚNICA excepción es 42501: un permiso denegado es
  // terminal (el rol ya no cambia fila a fila), así que corta el import
  // entero con el mensaje de rol en vez de reintentar 500 veces en vano.
  let importadas = 0
  for (let i = 0; i < nuevas.length; i += LOTE) {
    const lote = nuevas.slice(i, i + LOTE)
    const { error } = await supabase.from('cargas_combustible').insert(lote.map((c) => c.registro))
    if (!error) {
      importadas += lote.length
      continue
    }
    if (error.code === '42501') {
      return { importadas, duplicadas, errores, error: 'Tu rol no permite importar cargas' }
    }
    for (const c of lote) {
      const { error: errorFila } = await supabase.from('cargas_combustible').insert(c.registro)
      if (!errorFila) {
        importadas++
      } else if (errorFila.code === '23505') {
        // Guía duplicada (BD) = contador, no error: otro import ganó la
        // carrera entre el pre-check y el insert.
        duplicadas++
      } else {
        errores.push({ fila: c.fila, motivo: 'No se pudo guardar la carga (referencia inválida o error de datos)' })
      }
    }
  }

  // (6) Retorno con errores ordenados (el retry puede haber agregado fuera de orden).
  errores.sort((a, b) => a.fila - b.fila)
  revalidatePath('/combustible')
  return { importadas, duplicadas, errores }
}
