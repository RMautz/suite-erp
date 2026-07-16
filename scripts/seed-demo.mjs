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
import { createCipheriv, randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
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
const { data: orgId, error: eOrg } = await userCli.rpc('registrar_organizacion', { p_rut: '77.123.456-9', p_razon_social: 'Demo Transportes SpA' })
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

// 8) Módulo de transporte (Plan 11): activado + tarifario + flota + ODEs que replican
//    la proforma real del usuario (PF con neto 227.836 / IVA 43.289 / total 271.125).
const { error: eMod } = await admin.from('empresas')
  .update({ modulo_transporte: true, factor_volumetrico: 250 }).eq('id', empresaId)
if (eMod) die('modulo_transporte', eMod)
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

console.log('\n=== LISTO ===')
console.log('ERP:    http://localhost:3001  (o el puerto que muestre pnpm dev)')
console.log('Login:  ' + EMAIL + '  /  ' + PASS)
