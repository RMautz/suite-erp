// Siembra la demo local COMPLETA (post-Plan 9). Correr tras cada `supabase db reset`
// o `pnpm supabase test db` (los tests borran todo): node scripts/seed-demo.mjs
// Requiere DTE_ENCRYPTION_KEY en el entorno (la misma que usa apps/erp/.env.local)
// para cifrar los folios CAF sembrados — exportarla antes de correr el script.
//
// Lecciones acumuladas:
// - RUT org 77.123.456-9: NO colisiona con fixtures pgTAP ni con los RUT de E2E.
// - clientes/proveedores se insertan como usuario AUTHENTICATED (service_role no tiene USAGE en schema app).
// - folios_caf via service_role con XML dummy (MockDTE no lo valida) para poder emitir factura/boleta,
//   pero CIFRADO igual que cargarCAF (apps/erp/app/configuracion/dte/acciones.ts) — descifrar() truena
//   con texto plano. cifrarComoDte() de abajo espeja packages/dte/src/cripto.ts#cifrar byte a byte
//   (mismo algoritmo/formato); no se importa el paquete TS directo porque este script corre con
//   `node` plano y el pipeline fija Node 20 (.nvmrc), sin type-stripping nativo.
// - Claves: son las JWT públicas estándar del stack local de Supabase (issuer supabase-demo). Solo dev.
import { createCipheriv, randomBytes, randomUUID } from 'node:crypto'
import { createRequire, register } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(raiz, 'packages/auth/package.json'))
const { createClient } = require('@supabase/supabase-js')

// Espeja packages/dte/src/cripto.ts#cifrar byte a byte (mismo algoritmo/formato,
// descifrable por descifrar() sin cambios). No se importa el paquete TS directo:
// este script corre con `node` plano y el pipeline fija Node 20 (.nvmrc), sin
// type-stripping nativo para TypeScript.
function cifrarComoDte(datosUtf8, claveHex) {
  const clave = Buffer.from(claveHex, 'hex')
  if (clave.length !== 32) throw new Error('DTE_ENCRYPTION_KEY debe ser 32 bytes en hex (64 caracteres)')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', clave, iv)
  const ct = Buffer.concat([cipher.update(Buffer.from(datosUtf8, 'utf8')), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join('.')
}

const API = 'http://127.0.0.1:54321'
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const EMAIL = 'demo@suite-erp.cl', PASS = 'demo1234'

const admin = createClient(API, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } })
const userCli = createClient(API, ANON, { auth: { autoRefreshToken: false, persistSession: false } })
const die = (m, e) => { console.error('✗', m, e?.message ?? e ?? ''); process.exit(1) }

// Falla rápido: los folios CAF (paso 6) necesitan esta clave para cifrar xml_caf.
const claveDte = process.env.DTE_ENCRYPTION_KEY
if (!claveDte) die('Falta DTE_ENCRYPTION_KEY en el entorno (export la misma clave que usa apps/erp/.env.local)', null)

// 1) Usuario confirmado
const { error: eCu } = await admin.auth.admin.createUser({ email: EMAIL, password: PASS, email_confirm: true })
if (eCu) die('createUser (¿ya sembrado? la demo no es idempotente: resetea la BD primero)', eCu)
console.log('✓ usuario', EMAIL)

// 2) Organización por el camino real
const { error: eSi } = await userCli.auth.signInWithPassword({ email: EMAIL, password: PASS })
if (eSi) die('signIn', eSi)
const { data: orgId, error: eOrg } = await userCli.rpc('registrar_organizacion', { p_rut: '77.123.456-9', p_razon_social: 'Demo Transportes SpA', p_rubro: 'transporte' })
if (eOrg) die('registrar_organizacion', eOrg)
const { data: emp, error: eEmp } = await admin.from('empresas').select('id').eq('organizacion_id', orgId).single()
if (eEmp) die('empresas', eEmp)
const empresaId = emp.id
console.log('✓ org + empresa', empresaId)

// 3) Bodegas y productos (service_role)
const { data: bods, error: eB } = await admin.from('bodegas').insert([
  { empresa_id: empresaId, nombre: 'Bodega Central', direccion: 'Av. Principal 123, Santiago' },
  { empresa_id: empresaId, nombre: 'Bodega Norte', direccion: 'Ruta 5 Norte km 12, La Serena' },
]).select('id, nombre')
if (eB) die('bodegas', eB)
const central = bods.find((b) => b.nombre === 'Bodega Central').id
const { data: prods, error: eP } = await admin.from('productos').insert([
  { empresa_id: empresaId, sku: 'NEU-295', nombre: 'Neumático 295/80 R22.5', precio_neto: 285000, exento: false, stock_minimo: 4 },
  { empresa_id: empresaId, sku: 'FIL-100', nombre: 'Filtro de aceite pesado', precio_neto: 12900, exento: false, stock_minimo: 10 },
  { empresa_id: empresaId, sku: 'ACE-15W40', nombre: 'Aceite 15W40 balde 20L', precio_neto: 89900, exento: false, stock_minimo: 5 },
  { empresa_id: empresaId, sku: 'SRV-MANT', nombre: 'Servicio mantención flota', precio_neto: 450000, exento: true, stock_minimo: 0 },
]).select('id, sku')
if (eP) die('productos', eP)
const bySku = Object.fromEntries(prods.map((p) => [p.sku, p.id]))
console.log('✓ 2 bodegas + 4 productos (SRV-MANT exento)')

// 4) Clientes y proveedor (como usuario authenticated)
const { data: clis, error: eC } = await userCli.from('clientes').insert([
  { empresa_id: empresaId, rut: '762222221', razon_social: 'Transportes Cliente Ltda', giro: 'Transporte de carga', comuna: 'Maipú' },
  { empresa_id: empresaId, rut: '778899000', razon_social: 'Logística Andina SpA', giro: 'Logística y bodegaje', comuna: 'Pudahuel' },
]).select('id, razon_social')
if (eC) die('clientes', eC)
const { error: ePr } = await userCli.from('proveedores').insert({ empresa_id: empresaId, rut: '761111116', razon_social: 'Repuestos Proveedor SpA', giro: 'Venta de repuestos', comuna: 'Quilicura', condicion_pago_dias: 30 })
if (ePr) die('proveedores', ePr)
console.log('✓ 2 clientes + 1 proveedor')

// 5) Stock inicial (FIL-100 queda bajo mínimo: 6 <= 10 → crítico en dashboard)
const { error: eM } = await admin.from('movimientos_stock').insert([
  { empresa_id: empresaId, producto_id: bySku['NEU-295'], bodega_id: central, tipo: 'entrada', cantidad: 20, motivo: 'Ingreso inicial' },
  { empresa_id: empresaId, producto_id: bySku['FIL-100'], bodega_id: central, tipo: 'entrada', cantidad: 6, motivo: 'Ingreso inicial' },
  { empresa_id: empresaId, producto_id: bySku['ACE-15W40'], bodega_id: central, tipo: 'entrada', cantidad: 12, motivo: 'Ingreso inicial' },
])
if (eM) die('movimientos', eM)
console.log('✓ stock inicial (FIL-100 crítico)')

// 6) Folios CAF (XML dummy: MockDTE no valida el CAF) para poder emitir.
// xml_caf va CIFRADO (cifrarComoDte, misma clave DTE_ENCRYPTION_KEY) porque
// descifrar() lo espera así en cualquier emisión real (ver apps/erp/lib/emision.ts).
const { error: eF } = await admin.from('folios_caf').insert([
  { empresa_id: empresaId, tipo_documento: 'factura', desde: 1, hasta: 100, siguiente: 1, xml_caf: cifrarComoDte('<CAF-DEMO/>', claveDte) },
  { empresa_id: empresaId, tipo_documento: 'boleta', desde: 1, hasta: 200, siguiente: 1, xml_caf: cifrarComoDte('<CAF-DEMO/>', claveDte) },
  { empresa_id: empresaId, tipo_documento: 'nota_credito', desde: 1, hasta: 50, siguiente: 1, xml_caf: cifrarComoDte('<CAF-DEMO/>', claveDte) },
])
if (eF) die('folios_caf', eF)
console.log('✓ folios CAF factura/boleta/NC')

// 7) Cotización de muestra en 'enviada' (para que la lista no parta vacía)
const clienteDemo = clis.find((c) => c.razon_social === 'Logística Andina SpA').id
const validez = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
const { data: cotId, error: eQ } = await userCli.rpc('crear_cotizacion', {
  p_empresa: empresaId,
  p_cliente: clienteDemo,
  p_validez: validez,
  p_notas: 'Cotización de bienvenida — precios con descuento por volumen',
  p_lineas: [
    { productoId: bySku['NEU-295'], cantidad: 6, precioNeto: 270000 },
    { productoId: bySku['SRV-MANT'], cantidad: 1, precioNeto: 420000 },
  ],
})
if (eQ) die('crear_cotizacion', eQ)
const { error: eQs } = await userCli.rpc('cambiar_estado_cotizacion', { p_empresa: empresaId, p_cotizacion: cotId, p_estado: 'enviada', p_motivo: null })
if (eQs) die('enviar cotización', eQs)
console.log('✓ cotización N°1 enviada (2 líneas, precio negociado, 1 exenta)')

// 8) Módulo de transporte (Plan 11): la empresa ya nació con rubro 'transporte'
//    (registrar_organizacion setea modulo_transporte junto al rubro). El update
//    directo con service_role SÍ pasaría (los grants de 0023 solo limitan a
//    authenticated; service_role conserva update total de 0001), pero rompería
//    el invariante rubro/modulo_transporte — por eso el flag solo lo mueven
//    registrar_organizacion y cambiar_rubro. Tarifario + flota + ODEs que
//    replican la proforma real del usuario (PF con neto 227.836 / IVA 43.289 /
//    total 271.125).
const { error: eMod } = await admin.from('empresas')
  .update({ factor_volumetrico: 250 }).eq('id', empresaId)
if (eMod) die('factor_volumetrico', eMod)
const { data: dests, error: eD } = await admin.from('destinos').insert([
  { empresa_id: empresaId, nombre: 'Puerto Varas', tarifa_kg: 216 },
  { empresa_id: empresaId, nombre: 'Fresia', tarifa_kg: 203 },
]).select('id, nombre')
if (eD) die('destinos', eD)
const destino = Object.fromEntries(dests.map((d) => [d.nombre, d.id]))
const { data: veh, error: eV } = await admin.from('vehiculos')
  .insert({ empresa_id: empresaId, patente: 'JKLP23', descripcion: 'Camión Mercedes Actros', capacidad_kg: 12000 })
  .select('id').single()
if (eV) die('vehiculos', eV)
const { data: cond, error: eCo } = await admin.from('conductores')
  .insert({ empresa_id: empresaId, rut: '123456785', nombre: 'Pedro Soto', telefono: '+56 9 1234 5678' })
  .select('id').single()
if (eCo) die('conductores', eCo)
console.log('✓ transporte: tarifario (2 destinos) + vehículo + conductor')

// ODEs vía RPC (kilo_afecto lo calcula el servidor; netos negociados = los de la proforma real)
const clienteOde = clis.find((c) => c.razon_social === 'Transportes Cliente Ltda').id
const { data: ode1, error: eO1 } = await userCli.rpc('crear_orden_entrega', {
  p_empresa: empresaId, p_cliente: clienteOde, p_fecha: '2026-07-01',
  p_destino: destino['Puerto Varas'], p_docum: '401201-401202', p_oc: '408824',
  p_bultos: 10, p_kilos: 175, p_m3: 1.26, p_neto: 68134,
  p_vehiculo: veh.id, p_conductor: cond.id, p_notas: null,
})
if (eO1) die('ODE 1', eO1)
const { data: ode2, error: eO2 } = await userCli.rpc('crear_orden_entrega', {
  p_empresa: empresaId, p_cliente: clienteOde, p_fecha: '2026-07-09',
  p_destino: destino['Fresia'], p_docum: '883395', p_oc: '409292',
  p_bultos: 2, p_kilos: 787, p_m3: 2.88, p_neto: 159702,
  p_vehiculo: null, p_conductor: null, p_notas: null,
})
if (eO2) die('ODE 2', eO2)
const { data: pfId, error: ePf } = await userCli.rpc('crear_proforma', {
  p_empresa: empresaId, p_cliente: clienteOde, p_ordenes: [ode1, ode2], p_notas: null,
})
if (ePf) die('crear_proforma', ePf)
const { error: ePfE } = await userCli.rpc('cambiar_estado_proforma', {
  p_empresa: empresaId, p_proforma: pfId, p_estado: 'enviada', p_motivo: null,
})
if (ePfE) die('enviar proforma', ePfE)
console.log('✓ 2 ODEs (kilo afecto 315 y 787) + proforma PF-000001 enviada ($271.125)')

// ===================================================================================
// Datos ficticios completos (Plan demo-full): un reset + esta corrida deja TODOS los
// apartados con vida. FECHAS RELATIVAS a hoy. RPCs reales siempre que existan;
// service_role SOLO donde el camino real lo usa (emisión post-borrador, anticipos MP,
// confirmar suscripción, NC, correos). RUTs nuevos válidos mod-11 sin colisión con los
// fixtures pgTAP/scripts/docs. Todo se ANEXA: las secciones de arriba quedan intactas.
// ===================================================================================
const hoyISO = new Date().toISOString().slice(0, 10)
const fechaAtras = (d) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10)
const tsAtras = (d) => new Date(Date.now() - d * 86400000).toISOString()

// 9) Clientes (emails + condición de pago; +2 nuevos con y sin email) y proveedores (+3)
await userCli.from('clientes').update({ email: 'pagos@transportescliente.cl', condicion_pago_dias: 30 }).eq('id', clienteOde).eq('empresa_id', empresaId)
await userCli.from('clientes').update({ email: 'contacto@logisticaandina.cl', condicion_pago_dias: 15 }).eq('id', clienteDemo).eq('empresa_id', empresaId)
const { data: nuevosCli, error: eC2 } = await userCli.from('clientes').insert([
  { empresa_id: empresaId, rut: '772506309', razon_social: 'Comercial del Sur Ltda', giro: 'Comercio al por mayor', comuna: 'Puerto Montt', email: 'ventas@comercialdelsur.cl', condicion_pago_dias: 30 },
  { empresa_id: empresaId, rut: '768901201', razon_social: 'Ferretería El Roble EIRL', giro: 'Ferretería', comuna: 'Osorno', condicion_pago_dias: 0 },
]).select('id, rut')
if (eC2) die('clientes nuevos', eC2)
const cli3 = nuevosCli.find((c) => c.rut === '772506309').id
const cli4 = nuevosCli.find((c) => c.rut === '768901201').id
const { data: provs, error: eP2 } = await userCli.from('proveedores').insert([
  { empresa_id: empresaId, rut: '965112006', razon_social: 'Combustibles Copec Zona Sur SpA', giro: 'Distribución de combustibles', comuna: 'Puerto Montt', condicion_pago_dias: 15 },
  { empresa_id: empresaId, rut: '76455180K', razon_social: 'Distribuidora Mayorista Andes Ltda', giro: 'Venta de repuestos', comuna: 'Santiago', condicion_pago_dias: 30 },
  { empresa_id: empresaId, rut: '776803308', razon_social: 'Taller Mecánico Los Cerros SpA', giro: 'Mantención de vehículos', comuna: 'Puerto Varas', condicion_pago_dias: 30 },
]).select('id, rut')
if (eP2) die('proveedores nuevos', eP2)
const provCopec = provs.find((p) => p.rut === '965112006').id
const provMayorista = provs.find((p) => p.rut === '76455180K').id
const provTaller = provs.find((p) => p.rut === '776803308').id
console.log('✓ clientes +2 (con/sin email) + emails a los existentes + proveedores +3')

// 10) Inventario por RPC real: entradas a Bodega Norte, 1 ajuste negativo, 1 traslado.
//     FIL-100 no se toca aquí → sigue crítico (total 6 <= mínimo 10 en el dashboard).
const norte = bods.find((b) => b.nombre === 'Bodega Norte').id
for (const [prod, cant] of [['NEU-295', 8], ['ACE-15W40', 5]]) {
  const { error } = await userCli.rpc('registrar_entrada', { p_empresa: empresaId, p_producto: bySku[prod], p_bodega: norte, p_cantidad: cant, p_proveedor: null, p_motivo: 'Reposición Bodega Norte' })
  if (error) die('registrar_entrada ' + prod, error)
}
const { error: eAj } = await userCli.rpc('registrar_ajuste', { p_empresa: empresaId, p_producto: bySku['ACE-15W40'], p_bodega: central, p_cantidad: -3, p_motivo: 'Merma detectada en inventario físico' })
if (eAj) die('registrar_ajuste', eAj)
const { error: eTr } = await userCli.rpc('registrar_traslado', { p_empresa: empresaId, p_producto: bySku['NEU-295'], p_origen: central, p_destino: norte, p_cantidad: 5 })
if (eTr) die('registrar_traslado', eTr)
console.log('✓ inventario: 2 entradas Norte + ajuste (-3 ACE) + traslado (5 NEU); FIL-100 crítico')

// 11) Compras: 4 OC cubriendo los estados derivados (borrador / enviada / recibida_parcial
//     / recibida_total). Las recepciones alimentan la valorización (último costo por producto).
const crearOC = async (prov, lineas, notas) => {
  const { data, error } = await userCli.rpc('crear_orden_compra', { p_empresa: empresaId, p_proveedor: prov, p_lineas: lineas, p_notas: notas })
  if (error) die('crear_orden_compra', error)
  return data
}
const enviarOC = async (oc) => {
  const { error } = await userCli.from('ordenes_compra').update({ estado: 'enviada', actualizado_en: new Date().toISOString() }).eq('id', oc).eq('empresa_id', empresaId)
  if (error) die('enviar OC', error)
}
const lineasDe = async (oc) => {
  const { data, error } = await admin.from('ordenes_compra_lineas').select('id, cantidad_pedida').eq('orden_id', oc).eq('empresa_id', empresaId)
  if (error) die('lineas OC', error)
  return data
}
await crearOC(provMayorista, [{ productoId: bySku['ACE-15W40'], cantidad: 2, costoUnitario: 62000 }], 'Reposición aceite (pendiente de enviar)') // queda borrador
const ocEnviada = await crearOC(provMayorista, [{ productoId: bySku['NEU-295'], cantidad: 4, costoUnitario: 205000 }], null)
await enviarOC(ocEnviada)
const ocParcial = await crearOC(provTaller, [{ productoId: bySku['ACE-15W40'], cantidad: 10, costoUnitario: 61000 }], 'Stock de taller')
await enviarOC(ocParcial)
const lParcial = await lineasDe(ocParcial)
const { error: eRp } = await userCli.rpc('registrar_recepcion', { p_empresa: empresaId, p_orden: ocParcial, p_bodega: central, p_lineas: [{ ordenLineaId: lParcial[0].id, cantidad: 4 }], p_notas: 'Entrega parcial' })
if (eRp) die('recepción parcial', eRp)
const ocTotal = await crearOC(provMayorista, [{ productoId: bySku['NEU-295'], cantidad: 5, costoUnitario: 208000 }], null)
await enviarOC(ocTotal)
const lTotal = await lineasDe(ocTotal)
const { error: eRt } = await userCli.rpc('registrar_recepcion', { p_empresa: empresaId, p_orden: ocTotal, p_bodega: central, p_lineas: lTotal.map((l) => ({ ordenLineaId: l.id, cantidad: l.cantidad_pedida })), p_notas: 'Entrega completa' })
if (eRt) die('recepción total', eRt)
console.log('✓ compras: 4 OC (borrador/enviada/parcial/total) + 2 recepciones → valorización')

// 12) Ventas: crear_documento_venta (RPC real, nota_venta borrador) → tomar_folio (RPC real)
//     → promoción a emitido por service_role (el DTE real está gated: mismo patrón que los E2E).
//     No mueve stock: el inventario lo gobierna la sección 10 (demo determinista). ponytail.
const emitirDocExistente = async (docId, tipo, dias) => {
  const { data: folio, error } = await userCli.rpc('tomar_folio', { p_empresa: empresaId, p_tipo: tipo })
  if (error || folio === null) die('tomar_folio ' + tipo, error ?? 'sin folios')
  const { error: eUp } = await admin.from('documentos_venta').update({ tipo, folio, estado: 'emitido', emitido_en: tsAtras(dias) }).eq('id', docId).eq('empresa_id', empresaId)
  if (eUp) die('emitir documento', eUp)
  return folio
}
const emitirVenta = async (cliente, tipo, lineas, dias) => {
  const { data: docId, error } = await userCli.rpc('crear_documento_venta', { p_empresa: empresaId, p_cliente: cliente, p_tipo: 'nota_venta', p_lineas: lineas.map((l) => ({ productoId: bySku[l.p], cantidad: l.q })) })
  if (error) die('crear_documento_venta', error)
  const folio = await emitirDocExistente(docId, tipo, dias)
  const { data: d } = await admin.from('documentos_venta').select('total, cliente_id, neto, exento, iva').eq('id', docId).single()
  return { docId, folio, tipo, ...d }
}
// ~8 documentos repartidos en los últimos 18 días; el último es de HOY (Ventas de hoy).
const ventasPlan = [
  [cli3, 'boleta', [{ p: 'FIL-100', q: 4 }], 18],
  [cli4, 'factura', [{ p: 'NEU-295', q: 1 }], 15], // esta se anula con NC
  [clienteDemo, 'boleta', [{ p: 'ACE-15W40', q: 2 }], 12],
  [clienteOde, 'factura', [{ p: 'NEU-295', q: 2 }], 9],
  [cli3, 'boleta', [{ p: 'ACE-15W40', q: 1 }, { p: 'FIL-100', q: 2 }], 6],
  [clienteDemo, 'factura', [{ p: 'SRV-MANT', q: 1 }], 4], // exenta
  [cli4, 'factura', [{ p: 'NEU-295', q: 1 }, { p: 'ACE-15W40', q: 1 }], 2],
  [clienteOde, 'factura', [{ p: 'NEU-295', q: 2 }, { p: 'ACE-15W40', q: 1 }], 0], // HOY
]
const emitidas = []
for (const [cli, tipo, lineas, dias] of ventasPlan) emitidas.push(await emitirVenta(cli, tipo, lineas, dias))
// Nota de crédito emitida sobre la 2ª factura (patrón emitirNotaCredito): línea sintética,
// folio de NC real, totales copiados → libro_ventas la muestra en negativo.
const ref = emitidas[1]
const { data: ncDoc, error: eNc } = await admin.from('documentos_venta').insert({
  empresa_id: empresaId, tipo: 'nota_credito', cliente_id: ref.cliente_id, estado: 'borrador',
  documento_referencia_id: ref.docId, razon_anulacion: 'Anulación por acuerdo comercial',
  neto: ref.neto, exento: ref.exento, iva: ref.iva, total: ref.total,
}).select('id').single()
if (eNc) die('crear NC', eNc)
await admin.from('documentos_venta_lineas').insert({ empresa_id: empresaId, documento_id: ncDoc.id, producto_id: null, descripcion: 'Anulación factura folio ' + ref.folio, cantidad: 1, precio_neto: ref.total, exenta: false, subtotal: ref.total })
const { data: folioNc, error: eFn } = await userCli.rpc('tomar_folio', { p_empresa: empresaId, p_tipo: 'nota_credito' })
if (eFn) die('tomar_folio nota_credito', eFn)
await admin.from('documentos_venta').update({ folio: folioNc, estado: 'emitido', emitido_en: tsAtras(14) }).eq('id', ncDoc.id).eq('empresa_id', empresaId)
console.log('✓ ventas: 8 documentos emitidos (1 hoy, 1 exenta) + 1 nota de crédito')

// 13) Cobranza: 3 facturas backdateadas para Transportes (condición 30 días): 2 vencidas con
//     saldo (una con pago parcial) y 1 pagada completa. Todo por registrar_pago (RPC real).
const facturaBackdate = async (lineas, dias) => await emitirVenta(clienteOde, 'factura', lineas, dias)
const vencida1 = await facturaBackdate([{ p: 'NEU-295', q: 1 }], 55) // venc ~25d atrás, sin pago
const vencida2 = await facturaBackdate([{ p: 'ACE-15W40', q: 3 }], 50) // venc ~20d atrás, pago parcial
const pagada = await facturaBackdate([{ p: 'ACE-15W40', q: 1 }], 40) // pagada completa
const { error: ePp } = await userCli.rpc('registrar_pago', { p_empresa: empresaId, p_cliente: clienteOde, p_fecha: fechaAtras(10), p_metodo: 'transferencia', p_monto: 120000, p_referencia: 'TRX-8842', p_notas: 'Abono parcial', p_aplicaciones: [{ documentoId: vencida2.docId, monto: 120000 }] })
if (ePp) die('registrar_pago parcial', ePp)
const { error: ePt } = await userCli.rpc('registrar_pago', { p_empresa: empresaId, p_cliente: clienteOde, p_fecha: fechaAtras(35), p_metodo: 'efectivo', p_monto: pagada.total, p_referencia: null, p_notas: null, p_aplicaciones: [{ documentoId: pagada.docId, monto: pagada.total }] })
if (ePt) die('registrar_pago total', ePt)
console.log('✓ cobranza: 2 facturas vencidas (1 con abono parcial) + 1 pagada completa')

// 14) Por pagar: 3 facturas de compra (insert directo, patrón real) — 2 de Copec (una vencida)
//     y 1 de mayorista — + 1 pago proveedor multi-factura PARCIAL (registrar_pago_proveedor).
const { data: comprasIns, error: eDC } = await userCli.from('documentos_compra').insert([
  { empresa_id: empresaId, proveedor_id: provCopec, tipo: 'factura', folio: 4501, fecha_emision: fechaAtras(40), neto: 350000, exento: 0, iva: 66500, total: 416500, notas: 'Combustible flota — vencida' },
  { empresa_id: empresaId, proveedor_id: provCopec, tipo: 'factura', folio: 4622, fecha_emision: fechaAtras(12), neto: 200000, exento: 0, iva: 38000, total: 238000, notas: 'Combustible flota' },
  { empresa_id: empresaId, proveedor_id: provMayorista, tipo: 'factura', folio: 8890, fecha_emision: fechaAtras(8), neto: 500000, exento: 0, iva: 95000, total: 595000, notas: 'Repuestos varios' },
]).select('id, folio')
if (eDC) die('documentos_compra', eDC)
const compraA = comprasIns.find((x) => x.folio === 4501).id
const compraB = comprasIns.find((x) => x.folio === 4622).id
const { error: ePpr } = await userCli.rpc('registrar_pago_proveedor', { p_empresa: empresaId, p_proveedor: provCopec, p_fecha: fechaAtras(5), p_metodo: 'transferencia', p_monto: 250000, p_referencia: 'OP-5521', p_notas: 'Abono a Copec (2 facturas)', p_aplicaciones: [{ documentoId: compraA, monto: 150000 }, { documentoId: compraB, monto: 100000 }] })
if (ePpr) die('registrar_pago_proveedor', ePpr)
console.log('✓ por pagar: 3 facturas de compra (1 vencida) + 1 pago proveedor parcial multi-factura')

// 15) Transporte: +4 ODEs. 2 facturadas (proforma → facturar_proforma → emitir) con vehículo
//     asignado → rentabilidad con ingresos. 2 en una proforma APROBADA sin facturar, con
//     anticipo recibido vía crear_link_pago + registrar_anticipo_mp (service_role).
const crearODE = async (cli, destinoNombre, dias, bultos, kilos, m3, neto) => {
  const { data, error } = await userCli.rpc('crear_orden_entrega', { p_empresa: empresaId, p_cliente: cli, p_fecha: fechaAtras(dias), p_destino: destino[destinoNombre], p_docum: null, p_oc: null, p_bultos: bultos, p_kilos: kilos, p_m3: m3, p_neto: neto, p_vehiculo: veh.id, p_conductor: cond.id, p_notas: null })
  if (error) die('crear_orden_entrega', error)
  return data
}
const aprobarProforma = async (pf) => {
  for (const estado of ['enviada', 'aprobada']) {
    const { error } = await userCli.rpc('cambiar_estado_proforma', { p_empresa: empresaId, p_proforma: pf, p_estado: estado, p_motivo: null })
    if (error) die('cambiar_estado_proforma ' + estado, error)
  }
}
const odeF1 = await crearODE(clienteOde, 'Puerto Varas', 8, 12, 320, 1.8, 92000)
const odeF2 = await crearODE(clienteOde, 'Fresia', 5, 6, 540, 2.1, 118000)
const { data: pfFact, error: ePfF } = await userCli.rpc('crear_proforma', { p_empresa: empresaId, p_cliente: clienteOde, p_ordenes: [odeF1, odeF2], p_notas: null })
if (ePfF) die('crear_proforma facturable', ePfF)
await aprobarProforma(pfFact)
const { data: docFlete, error: eFac } = await userCli.rpc('facturar_proforma', { p_empresa: empresaId, p_proforma: pfFact })
if (eFac) die('facturar_proforma', eFac)
await emitirDocExistente(docFlete, 'factura', 5)
const odeA1 = await crearODE(clienteDemo, 'Puerto Varas', 6, 8, 210, 1.1, 54000)
const odeA2 = await crearODE(clienteDemo, 'Fresia', 3, 4, 160, 0.9, 41000)
const { data: pfAprob, error: ePfA } = await userCli.rpc('crear_proforma', { p_empresa: empresaId, p_cliente: clienteDemo, p_ordenes: [odeA1, odeA2], p_notas: 'Pendiente de facturar' })
if (ePfA) die('crear_proforma aprobada', ePfA)
await aprobarProforma(pfAprob)
const { data: pfAprobRow } = await admin.from('proformas').select('total').eq('id', pfAprob).single()
const linkId = randomUUID()
const { error: eLink } = await userCli.rpc('crear_link_pago', { p_empresa: empresaId, p_id: linkId, p_origen_tipo: 'proforma', p_origen: pfAprob, p_preferencia: 'pref-demo-' + linkId.slice(0, 8), p_url: 'https://mp.demo/checkout/' + linkId.slice(0, 8), p_monto: pfAprobRow.total })
if (eLink) die('crear_link_pago', eLink)
const { error: eAnt } = await admin.rpc('registrar_anticipo_mp', { p_empresa: empresaId, p_origen_tipo: 'proforma', p_origen: pfAprob, p_monto: pfAprobRow.total, p_mp_payment_id: 'MP-' + linkId.slice(0, 10), p_link: linkId })
if (eAnt) die('registrar_anticipo_mp', eAnt)
console.log('✓ transporte: 2 ODEs facturadas (rentabilidad) + 2 en proforma aprobada con anticipo recibido')

// 16) Combustible: ~10 cargas TCT del mes (patente del seed) + 4 gastos de vehículo.
const estaciones = [
  ['Copec Ruta 5 Sur', 'Puerto Montt'], ['Copec Maipú', 'Maipú'], ['Petrobras Alameda', 'Santiago'],
  ['Shell Puerto Varas', 'Puerto Varas'], ['Copec Osorno', 'Osorno'], ['Copec Ruta 5 Sur', 'Puerto Montt'],
  ['Aramco Temuco', 'Temuco'], ['Copec La Serena', 'La Serena'], ['Petrobras Rancagua', 'Rancagua'], ['Copec Maipú', 'Maipú'],
]
const cargas = estaciones.map(([estacion, comuna], i) => {
  const litros = 180 + i * 22
  const precio_litro = 1108 + (i % 5) * 7
  const hh = String(7 + (i % 10)).padStart(2, '0')
  const mm = String((i * 13) % 60).padStart(2, '0')
  return { empresa_id: empresaId, vehiculo_id: veh.id, conductor_id: cond.id, fecha: fechaAtras(i + 1), hora: `${hh}:${mm}:00`, litros, precio_litro, monto: Math.round(litros * precio_litro), estacion, comuna, guia: 'GD-' + (52100 + i), producto: 'Diésel', origen: 'tct' }
})
const { error: eCar } = await userCli.from('cargas_combustible').insert(cargas)
if (eCar) die('cargas_combustible', eCar)
const { error: eGas } = await userCli.from('gastos_vehiculo').insert([
  { empresa_id: empresaId, vehiculo_id: veh.id, fecha: fechaAtras(9), categoria: 'peaje', monto: 28500, notas: 'Ruta 5 ida y vuelta' },
  { empresa_id: empresaId, vehiculo_id: veh.id, fecha: fechaAtras(6), categoria: 'mantencion', monto: 145000, notas: 'Cambio de aceite y filtros' },
  { empresa_id: empresaId, vehiculo_id: veh.id, fecha: fechaAtras(3), categoria: 'neumaticos', monto: 320000, notas: '2 neumáticos traseros' },
  { empresa_id: empresaId, vehiculo_id: veh.id, fecha: fechaAtras(1), categoria: 'peaje', monto: 19800, notas: 'Peajes de la semana' },
])
if (eGas) die('gastos_vehiculo', eGas)
console.log('✓ combustible: 10 cargas TCT + 4 gastos de vehículo')

// 17) Suscripción: pago CONFIRMADO de la org demo. crear_pago_suscripcion (dueño) copia el
//     precio del plan; confirmar_pago_suscripcion (service_role) lo acredita → org activa +1 mes.
const { data: pagoSus, error: ePs } = await userCli.rpc('crear_pago_suscripcion', { p_organizacion: orgId, p_pasarela: 'webpay' })
if (ePs) die('crear_pago_suscripcion', ePs)
const { data: pagoRow } = await admin.from('pagos_suscripcion').select('monto').eq('id', pagoSus.id).single()
const { data: resConf, error: eConf } = await admin.rpc('confirmar_pago_suscripcion', { p_pago: pagoSus.id, p_referencia: 'wp-token-' + pagoSus.buy_order.slice(0, 8), p_monto: pagoRow.monto })
if (eConf) die('confirmar_pago_suscripcion', eConf)
console.log('✓ suscripción demo confirmada (' + resConf + ') → org activa, recaudación del mes')

// 17b) Cuenta ADMIN de plataforma dedicada (sin organización — solo opera el panel 3002).
//      Debe estar en ADMIN_EMAILS de apps/admin/.env.local; demo@ NO es admin.
const EMAIL_ADMIN = 'admin@suite-erp.cl'
const PASS_ADMIN = 'admin-suite-2026'
const { error: eCuA } = await admin.auth.admin.createUser({ email: EMAIL_ADMIN, password: PASS_ADMIN, email_confirm: true })
if (eCuA) die('createUser admin', eCuA)
console.log('✓ cuenta admin de plataforma: ' + EMAIL_ADMIN + ' / ' + PASS_ADMIN + ' (sin organización)')

// 18) Segunda organización en TRIAL sin pagar (otro usuario) → panel admin con 2 filas y estados distintos.
const EMAIL2 = 'ficticio2@suite-erp.cl'
const { error: eCu2 } = await admin.auth.admin.createUser({ email: EMAIL2, password: PASS, email_confirm: true })
if (eCu2) die('createUser ficticio2', eCu2)
const userCli2 = createClient(API, ANON, { auth: { autoRefreshToken: false, persistSession: false } })
const { error: eSi2 } = await userCli2.auth.signInWithPassword({ email: EMAIL2, password: PASS })
if (eSi2) die('signIn ficticio2', eSi2)
const { error: eOrg2 } = await userCli2.rpc('registrar_organizacion', { p_rut: '78.120.450-1', p_razon_social: 'Comercial Ficticia SpA' })
if (eOrg2) die('registrar_organizacion 2', eOrg2)
console.log('✓ 2da organización (trial, sin pagar): Comercial Ficticia SpA — login ' + EMAIL2 + ' / ' + PASS)

// 19) Correos enviados: 2 filas con HTML de las PLANTILLAS REALES de @suite/correo. El paquete
//     es TS (main src/index.ts) y su índice arrastra resend.ts (parameter properties, no soportado
//     por strip-only), así que se importa plantillas.ts directo. El hook agrega la extensión .ts
//     que Node ESM no infiere; requiere el type-stripping nativo de Node ≥22 (la demo corre con el
//     node del usuario). El recordatorio va con fecha de hace 5 días para no bloquear el anti-spam.
register('data:text/javascript,' + encodeURIComponent(
  'export async function resolve(s,c,n){try{return await n(s,c)}catch(e){for(const x of [".ts","/index.ts"]){try{return await n(s+x,c)}catch{}}throw e}}'
))
const requireErp = createRequire(join(raiz, 'apps/erp/package.json'))
const correoDir = dirname(requireErp.resolve('@suite/correo'))
const { plantillaRecordatorio, plantillaCotizacion } = await import(pathToFileURL(join(correoDir, 'plantillas.ts')).href)
const empresaCorreo = { razonSocial: 'Demo Transportes SpA', rut: '771234569' }
const fmtFecha = (iso) => new Date(iso.slice(0, 10) + 'T00:00:00').toLocaleDateString('es-CL')
const rec = plantillaRecordatorio({ empresa: empresaCorreo, clienteRazonSocial: 'Transportes Cliente Ltda', tipo: 'factura', folio: vencida1.folio, total: vencida1.total, saldo: vencida1.total, fechaVencimiento: fmtFecha(fechaAtras(25)) })
const { data: cot1, error: eCot } = await admin.from('cotizaciones').select('id, numero, fecha_validez, creado_en, neto, exento, iva, total').eq('empresa_id', empresaId).order('numero').limit(1).single()
if (eCot) die('cotización para correo', eCot)
const { data: cotLineas } = await admin.from('cotizaciones_lineas').select('descripcion, cantidad, precio_neto, subtotal').eq('cotizacion_id', cot1.id).eq('empresa_id', empresaId)
const cot = plantillaCotizacion({ empresa: empresaCorreo, clienteRazonSocial: 'Logística Andina SpA', numero: cot1.numero, fecha: fmtFecha(cot1.creado_en), validez: fmtFecha(cot1.fecha_validez), lineas: (cotLineas ?? []).map((l) => ({ descripcion: l.descripcion, cantidad: l.cantidad, precioNeto: l.precio_neto, subtotal: l.subtotal })), neto: cot1.neto, exento: cot1.exento, iva: cot1.iva, total: cot1.total })
const { error: eCor } = await admin.from('correos_enviados').insert([
  { empresa_id: empresaId, tipo: 'recordatorio', referencia_id: vencida1.docId, para: 'pagos@transportescliente.cl', asunto: rec.asunto, proveedor_id: 'mock-' + randomUUID().slice(0, 12), html: rec.html, creado_en: tsAtras(5) },
  { empresa_id: empresaId, tipo: 'cotizacion', referencia_id: cot1.id, para: 'contacto@logisticaandina.cl', asunto: cot.asunto, proveedor_id: 'mock-' + randomUUID().slice(0, 12), html: cot.html, creado_en: tsAtras(2) },
])
if (eCor) die('correos_enviados', eCor)
console.log('✓ correos: recordatorio (hace 5d) + cotización, HTML de plantillas reales')

// 20) Contabilidad: la demo NACE con el módulo activo y el histórico contabilizado.
//     VÍA userCli (el dueño): activar_contabilidad + contabilizar_pendientes son RPCs
//     authenticated — el admin client (service_role) daría 42501. activar siembra el
//     catálogo pyme chileno; contabilizar_pendientes recorre en orden de fecha todo lo
//     contabilizable (ventas/NC/compras/pagos/anticipos) y crea sus asientos cuadrados.
//     La 2da org (sección 18) queda SIN activar → muestra el gating del módulo.
const { error: eActC } = await userCli.rpc('activar_contabilidad', { p_empresa: empresaId })
if (eActC) die('activar_contabilidad', eActC)
const { data: pendCont, error: ePendCont } = await userCli.rpc('contabilizar_pendientes', { p_empresa: empresaId })
if (ePendCont) die('contabilizar_pendientes', ePendCont)
const { count: nAsientos } = await admin.from('asientos').select('*', { count: 'exact', head: true }).eq('empresa_id', empresaId)
console.log('✓ contabilidad activada (' + (nAsientos ?? 0) + ' asientos, ' + (pendCont?.creados ?? 0) + ' contabilizados)')

// ----- Resumen de conteos -----
const cuenta = async (tabla, filtros = {}) => {
  let q = admin.from(tabla).select('*', { count: 'exact', head: true }).eq('empresa_id', empresaId)
  for (const [k, v] of Object.entries(filtros)) q = q.eq(k, v)
  const { count } = await q
  return count ?? 0
}
const { count: vencidosCount } = await admin.from('saldos_documentos').select('*', { count: 'exact', head: true }).eq('empresa_id', empresaId).gt('saldo', 0).lt('fecha_vencimiento', hoyISO)
const { count: orgsCount } = await admin.from('organizaciones').select('*', { count: 'exact', head: true })
const { count: susPagados } = await admin.from('pagos_suscripcion').select('*', { count: 'exact', head: true }).eq('estado', 'pagado')
console.log('\n=== RESUMEN ===')
console.log('ventas emitidas:      ', await cuenta('documentos_venta', { estado: 'emitido' }))
console.log('saldos vencidos (>0): ', vencidosCount ?? 0)
console.log('órdenes de compra:    ', await cuenta('ordenes_compra'))
console.log('recepciones:          ', await cuenta('recepciones'))
console.log('movimientos de stock: ', await cuenta('movimientos_stock'))
console.log('facturas de compra:   ', await cuenta('documentos_compra'))
console.log('cargas combustible:   ', await cuenta('cargas_combustible'))
console.log('gastos de vehículo:   ', await cuenta('gastos_vehiculo'))
console.log('órdenes de entrega:   ', await cuenta('ordenes_entrega'))
console.log('proformas:            ', await cuenta('proformas'))
console.log('anticipos:            ', await cuenta('anticipos'))
console.log('correos enviados:     ', await cuenta('correos_enviados'))
console.log('asientos contables:   ', await cuenta('asientos'))
console.log('pagos suscripción pag:', susPagados ?? 0)
console.log('organizaciones:       ', orgsCount ?? 0)

console.log('\n=== LISTO ===')
console.log('ERP:    http://localhost:3001  (o el puerto que muestre pnpm dev)')
console.log('Login:  ' + EMAIL + '  /  ' + PASS)
