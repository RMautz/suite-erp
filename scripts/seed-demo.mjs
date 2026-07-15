// Siembra la demo local COMPLETA (post-Plan 9). Correr tras cada `supabase db reset`
// o `pnpm supabase test db` (los tests borran todo): node scripts/seed-demo.mjs
//
// Lecciones acumuladas:
// - RUT org 77.123.456-9: NO colisiona con fixtures pgTAP ni con los RUT de E2E.
// - clientes/proveedores se insertan como usuario AUTHENTICATED (service_role no tiene USAGE en schema app).
// - folios_caf via service_role con XML dummy (MockDTE no lo valida) para poder emitir factura/boleta.
// - Claves: son las JWT públicas estándar del stack local de Supabase (issuer supabase-demo). Solo dev.
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(raiz, 'packages/auth/package.json'))
const { createClient } = require('@supabase/supabase-js')

const API = 'http://127.0.0.1:54321'
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const EMAIL = 'demo@suite-erp.cl', PASS = 'demo1234'

const admin = createClient(API, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } })
const userCli = createClient(API, ANON, { auth: { autoRefreshToken: false, persistSession: false } })
const die = (m, e) => { console.error('✗', m, e?.message ?? e ?? ''); process.exit(1) }

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

// 6) Folios CAF (XML dummy: MockDTE no valida el CAF) para poder emitir
const { error: eF } = await admin.from('folios_caf').insert([
  { empresa_id: empresaId, tipo_documento: 'factura', desde: 1, hasta: 100, siguiente: 1, xml_caf: '<CAF-DEMO/>' },
  { empresa_id: empresaId, tipo_documento: 'boleta', desde: 1, hasta: 200, siguiente: 1, xml_caf: '<CAF-DEMO/>' },
  { empresa_id: empresaId, tipo_documento: 'nota_credito', desde: 1, hasta: 50, siguiente: 1, xml_caf: '<CAF-DEMO/>' },
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

console.log('\n=== LISTO ===')
console.log('ERP:    http://localhost:3001  (o el puerto que muestre pnpm dev)')
console.log('Login:  ' + EMAIL + '  /  ' + PASS)
