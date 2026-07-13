# Plan 3 — Ventas + Facturación Electrónica (DTE) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El ERP arma notas de venta con productos y clientes existentes y emite Factura (33), Boleta (39) y Nota de Crédito (61) a través de un adaptador de proveedor DTE, con folios atómicos, certificado cifrado, PDF descargable y cola de reintentos — todo verificable ahora contra un mock, con la integración real a SimpleAPI como task final gated en credenciales.

**Architecture:** Tres tablas multi-tenant nuevas (`documentos_venta`, `documentos_venta_lineas`, `folios_caf`) más almacenamiento cifrado del certificado en `empresas`. Un paquete `@suite/dte` con interfaz propia `ProveedorDTE` (implementación `MockDTE` para tests+demo, `SimpleApiDTE` para real). Lógica pura de folios y mapeo venta→DTE en `@suite/core` con TDD. Emisión vía Server Action que reserva folio atómicamente y corre la máquina de estados; reintentos por función programada. El certificado se cifra con AES-256-GCM (Node crypto) con clave en env var, se descifra solo server-side al emitir.

**Tech Stack:** Lo de Planes 1-2 (Next.js 15, React 19, TS strict, Supabase Postgres 17, pgTAP, Vitest, Tailwind v4, `@suite/*`) + Node `crypto` (stdlib, sin dependencia nueva). El PDF v1 se genera server-side como HTML→PDF simple con la stdlib del proveedor (el `pdfBase64` que devuelve el adaptador); **sin librería de PDF nueva**.

## Global Constraints

- Node.js >= 20, pnpm >= 9, **Docker Desktop corriendo** (Supabase local + pgTAP).
- Windows/PowerShell 5.1: `&&` no funciona (usar `;`). Shells nuevas: `$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User');`
- TypeScript `strict: true`; identificadores ASCII; dominio y UI en español; mensajes de error al usuario en español claro.
- Montos CLP en enteros. `TASA_IVA` de `@suite/core`, nunca hardcodeado.
- **Multi-tenant obligatorio:** toda tabla operacional lleva `empresa_id` + RLS + grants explícitos (`authenticated` espejando políticas; `service_role` DML completo; `anon` nada). Toda migración que cree tablas en `public` incluye sus grants (lección Plan 1).
- **FK compuestas por tenant:** toda referencia cross-tabla usa `foreign key (empresa_id, x_id) references tabla (empresa_id, id)` (convención Plan 2). Requiere `unique (empresa_id, id)` en la tabla referenciada.
- **Mutaciones server-side:** empresa activa SIEMPRE desde `obtenerEmpresaActiva()` (cookie validada), jamás del formulario. Todo update con `.select('id')` y 0 filas = error explícito (RLS filtra en silencio).
- **Emisión atómica e idempotente:** reserva de folio y cambio de estado en una transacción; un reintento o doble clic nunca genera dos DTE con folios distintos para la misma venta.
- **Certificado + CAF = joyas de la corona:** cifrados en reposo (AES-256-GCM, clave en env var `DTE_ENCRYPTION_KEY` de 32 bytes hex), descifrados solo server-side en el instante de emitir, jamás al navegador ni a logs. Solo `dueno`/`admin` cargan certificado.
- Sin dependencias npm nuevas: CSV/crypto/PDF con stdlib y lo ya instalado.
- Puertos dev: web 3000, erp 3001, admin 3002. Supabase local: API 54321, Studio 54323.
- Scope npm `@suite/*`. Commits convencionales en español.
- **Roles de escritura:** documentos de venta y config DTE: crear/emitir requiere `dueno`/`admin`/`vendedor` para vender; **solo `dueno`/`admin`** para cargar certificado y CAF. Lectura: cualquier miembro activo.
- Ambiente DTE por env var `DTE_AMBIENTE` (`certificacion` | `produccion`); v1 usa `certificacion`.

---

### Task 1: `@suite/core` — folios y mapeo venta→DTE (TDD)

**Files:**
- Create: `packages/core/src/ventas.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/ventas.test.ts`

**Interfaces:**
- Consumes: `calcularTotales`, `TASA_IVA`, `type LineaVenta`, `type Totales` de `./iva` (ya existen).
- Produces (desde `@suite/core`):
  - `type TipoDocumento = 'nota_venta' | 'factura' | 'boleta' | 'nota_credito'`
  - `CODIGO_SII: Record<TipoDocumento, number | null>` — `{ nota_venta: null, factura: 33, boleta: 39, nota_credito: 61 }`
  - `esTributario(tipo: TipoDocumento): boolean` — true salvo `nota_venta`.
  - `formatearFolio(folio: number): string` — `1` → `"N° 1"`.
  - `interface LineaDocumento { productoId: string; descripcion: string; cantidad: number; precioNeto: number; exenta: boolean }`
  - `subtotalLinea(linea: LineaDocumento): number` — `Math.round(cantidad * precioNeto)`.
  - `totalesDocumento(lineas: LineaDocumento[], tasa?: number): Totales` — mapea a `calcularTotales`.

- [ ] **Step 1: Escribir los tests que fallan**

`packages/core/src/ventas.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  CODIGO_SII,
  esTributario,
  formatearFolio,
  subtotalLinea,
  totalesDocumento,
} from './ventas'

describe('CODIGO_SII', () => {
  it('mapea los tipos a sus códigos SII', () => {
    expect(CODIGO_SII.factura).toBe(33)
    expect(CODIGO_SII.boleta).toBe(39)
    expect(CODIGO_SII.nota_credito).toBe(61)
    expect(CODIGO_SII.nota_venta).toBeNull()
  })
})

describe('esTributario', () => {
  it('la nota de venta no es tributaria; el resto sí', () => {
    expect(esTributario('nota_venta')).toBe(false)
    expect(esTributario('factura')).toBe(true)
    expect(esTributario('boleta')).toBe(true)
    expect(esTributario('nota_credito')).toBe(true)
  })
})

describe('formatearFolio', () => {
  it('formatea el folio', () => {
    expect(formatearFolio(1)).toBe('N° 1')
    expect(formatearFolio(1500)).toBe('N° 1500')
  })
})

describe('subtotalLinea', () => {
  it('multiplica cantidad por precio y redondea', () => {
    expect(subtotalLinea({ productoId: 'p', descripcion: 'x', cantidad: 3, precioNeto: 990, exenta: false })).toBe(2970)
  })
})

describe('totalesDocumento', () => {
  it('suma líneas afectas y separa exentas', () => {
    const t = totalesDocumento([
      { productoId: 'a', descripcion: 'A', cantidad: 2, precioNeto: 5000, exenta: false },
      { productoId: 'b', descripcion: 'B', cantidad: 1, precioNeto: 3000, exenta: true },
    ])
    expect(t).toEqual({ neto: 10000, exento: 3000, iva: 1900, total: 14900 })
  })
  it('documento vacío da cero', () => {
    expect(totalesDocumento([])).toEqual({ neto: 0, exento: 0, iva: 0, total: 0 })
  })
})
```

- [ ] **Step 2: Verificar que fallan**

Run: `pnpm --filter @suite/core test`
Expected: FAIL — `Cannot find module './ventas'`. Los tests existentes (rut, iva, maestros, csv) siguen verdes.

- [ ] **Step 3: Implementar `ventas.ts`**

`packages/core/src/ventas.ts`:

```ts
import { calcularTotales, type LineaVenta, type Totales, TASA_IVA } from './iva'

export type TipoDocumento = 'nota_venta' | 'factura' | 'boleta' | 'nota_credito'

export const CODIGO_SII: Record<TipoDocumento, number | null> = {
  nota_venta: null,
  factura: 33,
  boleta: 39,
  nota_credito: 61,
}

export function esTributario(tipo: TipoDocumento): boolean {
  return CODIGO_SII[tipo] !== null
}

export function formatearFolio(folio: number): string {
  return 'N° ' + folio
}

export interface LineaDocumento {
  productoId: string
  descripcion: string
  cantidad: number
  precioNeto: number
  exenta: boolean
}

export function subtotalLinea(linea: LineaDocumento): number {
  return Math.round(linea.cantidad * linea.precioNeto)
}

export function totalesDocumento(lineas: LineaDocumento[], tasa: number = TASA_IVA): Totales {
  const lineasVenta: LineaVenta[] = lineas.map((l) => ({
    cantidad: l.cantidad,
    precioNeto: l.precioNeto,
    exenta: l.exenta,
  }))
  return calcularTotales(lineasVenta, tasa)
}
```

Actualizar `packages/core/src/index.ts` agregando al final:

```ts
export * from './ventas'
```

- [ ] **Step 4: Verificar GREEN**

Run: `pnpm --filter @suite/core test`
Expected: PASS — rut, iva, maestros, csv y ventas verdes.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/ventas.ts packages/core/src/ventas.test.ts packages/core/src/index.ts
git commit -m "feat(core): tipos de documento, codigos SII y totales de venta (TDD)"
```

---

### Task 2: `@suite/dte` — interfaz del proveedor + MockDTE (TDD)

**Files:**
- Create: `packages/dte/package.json`, `packages/dte/tsconfig.json`, `packages/dte/vitest.config.ts`, `packages/dte/src/index.ts`, `packages/dte/src/tipos.ts`, `packages/dte/src/mock.ts`
- Test: `packages/dte/src/mock.test.ts`

**Interfaces:**
- Consumes: `TipoDocumento` de `@suite/core`.
- Produces (desde `@suite/dte`):
  - Tipos `Emisor`, `Receptor`, `LineaDTE`, `SolicitudEmision`, `SolicitudNotaCredito`, `ResultadoEmision`, `EstadoDTE`, `CredencialesDTE`.
  - `interface ProveedorDTE { emitirDTE(s: SolicitudEmision): Promise<ResultadoEmision>; consultarEstado(trackId: string, cred: CredencialesDTE): Promise<EstadoDTE>; anularConNotaCredito(s: SolicitudNotaCredito): Promise<ResultadoEmision> }`
  - `class MockDTE implements ProveedorDTE` — determinista: emite con éxito devolviendo un folio eco, un trackId `mock-<folio>`, XML y PDF de marcador; `consultarEstado` → `'aceptado'`. Falla adrede si `receptor.rut === '66666666-6'` (para probar la cola de reintentos).
  - `proveedorPorAmbiente(ambiente: string): ProveedorDTE` — `'certificacion'`/`'produccion'` → (por ahora) `MockDTE`; Task 10 conecta `SimpleApiDTE`.

- [ ] **Step 1: Scaffold del paquete**

`packages/dte/package.json`:

```json
{
  "name": "@suite/dte",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": { "test": "vitest run" },
  "dependencies": { "@suite/core": "workspace:*" },
  "devDependencies": { "typescript": "^5.7.0", "vitest": "^3.0.0" }
}
```

`packages/dte/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

`packages/dte/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { environment: 'node' },
})
```

Run: `pnpm install`
Expected: agrega el paquete al workspace sin errores.

- [ ] **Step 2: Tipos del adaptador**

`packages/dte/src/tipos.ts`:

```ts
import type { TipoDocumento } from '@suite/core'

export interface Emisor {
  rut: string
  razonSocial: string
  giro: string
  direccion: string
  comuna: string
}

export interface Receptor {
  rut: string
  razonSocial: string
  giro?: string
  direccion?: string
  comuna?: string
}

export interface LineaDTE {
  descripcion: string
  cantidad: number
  precioNeto: number
  exenta: boolean
}

export interface CredencialesDTE {
  apiKey: string
  certificadoPfx: Buffer
  certificadoPassword: string
  cafXml: string
}

export interface SolicitudEmision {
  tipo: TipoDocumento
  codigoSii: number
  folio: number
  emisor: Emisor
  receptor: Receptor
  lineas: LineaDTE[]
  neto: number
  exento: number
  iva: number
  total: number
  credenciales: CredencialesDTE
}

export interface SolicitudNotaCredito extends SolicitudEmision {
  folioReferencia: number
  codigoSiiReferencia: number
  razonAnulacion: string
}

export type EstadoResultado = 'emitido' | 'pendiente_envio' | 'rechazado'

export interface ResultadoEmision {
  estado: EstadoResultado
  folio: number
  trackId: string | null
  xmlTimbrado: string | null
  pdfBase64: string | null
  error: string | null
}

export type EstadoDTE = 'aceptado' | 'rechazado' | 'pendiente'

export interface ProveedorDTE {
  emitirDTE(solicitud: SolicitudEmision): Promise<ResultadoEmision>
  consultarEstado(trackId: string, credenciales: CredencialesDTE): Promise<EstadoDTE>
  anularConNotaCredito(solicitud: SolicitudNotaCredito): Promise<ResultadoEmision>
}
```

- [ ] **Step 3: Test del mock (falla)**

`packages/dte/src/mock.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { MockDTE } from './mock'
import type { SolicitudEmision } from './tipos'

const base: SolicitudEmision = {
  tipo: 'factura',
  codigoSii: 33,
  folio: 101,
  emisor: { rut: '76543210-3', razonSocial: 'Emisor SpA', giro: 'Ventas', direccion: 'Calle 1', comuna: 'Santiago' },
  receptor: { rut: '11111111-1', razonSocial: 'Cliente Ltda' },
  lineas: [{ descripcion: 'Producto', cantidad: 1, precioNeto: 10000, exenta: false }],
  neto: 10000,
  exento: 0,
  iva: 1900,
  total: 11900,
  credenciales: { apiKey: 'k', certificadoPfx: Buffer.from(''), certificadoPassword: 'p', cafXml: '<CAF/>' },
}

describe('MockDTE', () => {
  it('emite con éxito devolviendo folio, trackId, xml y pdf', async () => {
    const r = await new MockDTE().emitirDTE(base)
    expect(r.estado).toBe('emitido')
    expect(r.folio).toBe(101)
    expect(r.trackId).toBe('mock-101')
    expect(r.xmlTimbrado).toContain('101')
    expect(r.pdfBase64).not.toBeNull()
    expect(r.error).toBeNull()
  })

  it('devuelve pendiente_envio para el RUT de falla (prueba de reintentos)', async () => {
    const r = await new MockDTE().emitirDTE({ ...base, receptor: { ...base.receptor, rut: '66666666-6' } })
    expect(r.estado).toBe('pendiente_envio')
    expect(r.trackId).toBeNull()
    expect(r.error).not.toBeNull()
  })

  it('consultarEstado devuelve aceptado', async () => {
    const estado = await new MockDTE().consultarEstado('mock-101', base.credenciales)
    expect(estado).toBe('aceptado')
  })

  it('la nota de crédito referencia el documento original', async () => {
    const r = await new MockDTE().anularConNotaCredito({
      ...base,
      tipo: 'nota_credito',
      codigoSii: 61,
      folio: 5,
      folioReferencia: 101,
      codigoSiiReferencia: 33,
      razonAnulacion: 'Anula factura',
    })
    expect(r.estado).toBe('emitido')
    expect(r.xmlTimbrado).toContain('101')
  })
})
```

Run: `pnpm --filter @suite/dte test`
Expected: FAIL — `Cannot find module './mock'`.

- [ ] **Step 4: Implementar el mock, index y selector**

`packages/dte/src/mock.ts`:

```ts
import type {
  CredencialesDTE,
  EstadoDTE,
  ProveedorDTE,
  ResultadoEmision,
  SolicitudEmision,
  SolicitudNotaCredito,
} from './tipos'

const RUT_FALLA = '66666666-6'

export class MockDTE implements ProveedorDTE {
  async emitirDTE(solicitud: SolicitudEmision): Promise<ResultadoEmision> {
    if (solicitud.receptor.rut === RUT_FALLA) {
      return {
        estado: 'pendiente_envio',
        folio: solicitud.folio,
        trackId: null,
        xmlTimbrado: null,
        pdfBase64: null,
        error: 'Proveedor simulado no disponible (RUT de prueba de reintentos)',
      }
    }
    const xml = `<DTE folio="${solicitud.folio}" codigo="${solicitud.codigoSii}" referencia="${
      (solicitud as SolicitudNotaCredito).folioReferencia ?? ''
    }">MOCK</DTE>`
    return {
      estado: 'emitido',
      folio: solicitud.folio,
      trackId: 'mock-' + solicitud.folio,
      xmlTimbrado: xml,
      pdfBase64: Buffer.from('PDF simulado folio ' + solicitud.folio).toString('base64'),
      error: null,
    }
  }

  async consultarEstado(_trackId: string, _credenciales: CredencialesDTE): Promise<EstadoDTE> {
    return 'aceptado'
  }

  async anularConNotaCredito(solicitud: SolicitudNotaCredito): Promise<ResultadoEmision> {
    return this.emitirDTE(solicitud)
  }
}
```

`packages/dte/src/index.ts`:

```ts
export * from './tipos'
export { MockDTE } from './mock'
import type { ProveedorDTE } from './tipos'
import { MockDTE } from './mock'

// Task 10 reemplaza el cuerpo por: return ambiente === 'produccion' || ambiente === 'certificacion'
//   ? new SimpleApiDTE(ambiente) : new MockDTE()  (con SimpleApiDTE leyendo la doc en vivo).
export function proveedorPorAmbiente(_ambiente: string): ProveedorDTE {
  return new MockDTE()
}
```

Run: `pnpm --filter @suite/dte test`
Expected: PASS — 4 tests verdes.

- [ ] **Step 5: Commit**

```bash
git add packages/dte pnpm-lock.yaml
git commit -m "feat(dte): interfaz ProveedorDTE y MockDTE determinista (TDD)"
```

---

### Task 3: `@suite/dte` — cifrado del certificado (AES-256-GCM, TDD)

**Files:**
- Create: `packages/dte/src/cripto.ts`
- Modify: `packages/dte/src/index.ts`
- Test: `packages/dte/src/cripto.test.ts`

**Interfaces:**
- Consumes: Node `crypto` (stdlib).
- Produces (desde `@suite/dte`):
  - `cifrar(datos: Buffer, claveHex: string): string` — AES-256-GCM; devuelve `iv:tag:ciphertext` en base64 separados por `.`.
  - `descifrar(paquete: string, claveHex: string): Buffer` — inverso; lanza si la clave o el tag no validan.
  - `generarClave(): string` — 32 bytes aleatorios en hex (para documentar cómo se crea `DTE_ENCRYPTION_KEY`).

- [ ] **Step 1: Test que falla**

`packages/dte/src/cripto.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { cifrar, descifrar, generarClave } from './cripto'

const CLAVE = 'a'.repeat(64) // 32 bytes en hex

describe('cifrado del certificado', () => {
  it('round-trip: descifrar(cifrar(x)) === x', () => {
    const secreto = Buffer.from('contenido del certificado .pfx binario \x00\x01\x02')
    const paquete = cifrar(secreto, CLAVE)
    expect(paquete).not.toContain('certificado') // no filtra el plano
    expect(descifrar(paquete, CLAVE).equals(secreto)).toBe(true)
  })

  it('cada cifrado usa un IV distinto (no determinista)', () => {
    const x = Buffer.from('mismo')
    expect(cifrar(x, CLAVE)).not.toBe(cifrar(x, CLAVE))
  })

  it('una clave incorrecta falla al descifrar (tag GCM)', () => {
    const paquete = cifrar(Buffer.from('x'), CLAVE)
    expect(() => descifrar(paquete, 'b'.repeat(64))).toThrow()
  })

  it('generarClave produce 64 caracteres hex', () => {
    expect(generarClave()).toMatch(/^[0-9a-f]{64}$/)
  })
})
```

Run: `pnpm --filter @suite/dte test`
Expected: FAIL — `Cannot find module './cripto'`.

- [ ] **Step 2: Implementar `cripto.ts`**

`packages/dte/src/cripto.ts`:

```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGO = 'aes-256-gcm'

function claveBuffer(claveHex: string): Buffer {
  const b = Buffer.from(claveHex, 'hex')
  if (b.length !== 32) throw new Error('DTE_ENCRYPTION_KEY debe ser 32 bytes en hex (64 caracteres)')
  return b
}

export function cifrar(datos: Buffer, claveHex: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGO, claveBuffer(claveHex), iv)
  const ct = Buffer.concat([cipher.update(datos), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join('.')
}

export function descifrar(paquete: string, claveHex: string): Buffer {
  const [ivB64, tagB64, ctB64] = paquete.split('.')
  if (!ivB64 || !tagB64 || !ctB64) throw new Error('Paquete cifrado con formato inválido')
  const decipher = createDecipheriv(ALGO, claveBuffer(claveHex), Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()])
}

export function generarClave(): string {
  return randomBytes(32).toString('hex')
}
```

Actualizar `packages/dte/src/index.ts` agregando:

```ts
export { cifrar, descifrar, generarClave } from './cripto'
```

Run: `pnpm --filter @suite/dte test`
Expected: PASS — mock + cripto verdes.

- [ ] **Step 3: Commit**

```bash
git add packages/dte/src/cripto.ts packages/dte/src/cripto.test.ts packages/dte/src/index.ts
git commit -m "feat(dte): cifrado AES-256-GCM del certificado con clave en env var (TDD)"
```

---

### Task 4: Migración de ventas (documentos, líneas, folios CAF, certificado)

**Files:**
- Create: `supabase/migrations/00000000000005_ventas.sql`

**Nota:** el número `00000000000004` puede estar tomado por un plan futuro; usar `00000000000005` solo si `00000000000004` existe. Verificar con `ls supabase/migrations/` y usar el siguiente correlativo libre; el nombre lógico es `_ventas`.

**Interfaces:**
- Consumes: `empresas`, `clientes`, `productos`, `app.mis_empresas`, `app.tiene_rol_en_empresa`, `app.validar_rut`, `app.normalizar_rut` (Planes 1-2).
- Produces:
  - Tablas `documentos_venta`, `documentos_venta_lineas`, `folios_caf`; columnas de certificado cifrado en `empresas`.
  - `app.tomar_folio(p_empresa uuid, p_tipo text) returns integer` — reserva atómica del siguiente folio del CAF vigente.
  - RLS + grants para las 3 tablas.

- [ ] **Step 1: Verificar el correlativo y escribir la migración**

Run: `ls supabase/migrations/`
Expected: existen `0001_plataforma`, `0002_registro`, `0003_maestros`. Usar `00000000000004_ventas.sql` si 0004 está libre (lo está salvo que un plan intermedio lo tomara).

`supabase/migrations/00000000000004_ventas.sql`:

```sql
-- Ventas y facturación electrónica (DTE). Multi-tenant por empresa.

-- ---------- Prerrequisito: unique compuesto para las FK por tenant ----------
-- Postgres exige que las columnas referenciadas por una FK compuesta tengan un
-- unique/PK que las cubra exactamente. clientes/productos solo tienen unique
-- (empresa_id, rut/sku); agregamos (empresa_id, id) para las FK de esta migración.
alter table public.clientes add constraint clientes_empresa_id_key unique (empresa_id, id);
alter table public.productos add constraint productos_empresa_id_key unique (empresa_id, id);

-- ---------- Datos del emisor y certificado cifrado en empresas ----------
alter table public.empresas
  add column if not exists giro_emisor text,
  add column if not exists direccion_emisor text,
  add column if not exists comuna_emisor text,
  add column if not exists resolucion_sii_numero integer,
  add column if not exists resolucion_sii_fecha date,
  -- Certificado .pfx cifrado (AES-256-GCM, formato iv.tag.ct base64) y su password cifrada.
  add column if not exists certificado_cifrado text,
  add column if not exists certificado_password_cifrada text,
  add column if not exists dte_api_key_cifrada text;

-- ---------- Folios CAF ----------
create table public.folios_caf (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  tipo_documento text not null check (tipo_documento in ('factura', 'boleta', 'nota_credito')),
  desde integer not null check (desde >= 1),
  hasta integer not null check (hasta >= desde),
  siguiente integer not null,
  xml_caf text not null,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  unique (empresa_id, id),
  check (siguiente between desde and hasta + 1)
);
create index folios_caf_lookup_idx on public.folios_caf (empresa_id, tipo_documento, activo);

-- ---------- Documentos de venta (cabecera) ----------
create table public.documentos_venta (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  tipo text not null check (tipo in ('nota_venta', 'factura', 'boleta', 'nota_credito')),
  cliente_id uuid not null,
  folio integer,
  estado text not null default 'borrador'
    check (estado in ('borrador', 'pendiente_envio', 'emitido', 'rechazado')),
  neto integer not null default 0 check (neto >= 0),
  exento integer not null default 0 check (exento >= 0),
  iva integer not null default 0 check (iva >= 0),
  total integer not null default 0 check (total >= 0),
  track_id text,
  xml_timbrado text,
  pdf_ruta text,
  documento_referencia_id uuid,
  razon_anulacion text,
  error_emision text,
  intentos integer not null default 0,
  creado_en timestamptz not null default now(),
  emitido_en timestamptz,
  unique (empresa_id, id),
  -- FK compuesta por tenant al cliente (convención Plan 2)
  foreign key (empresa_id, cliente_id) references public.clientes (empresa_id, id),
  -- Auto-referencia por tenant para la nota de crédito
  foreign key (empresa_id, documento_referencia_id) references public.documentos_venta (empresa_id, id)
);
create index documentos_venta_lista_idx on public.documentos_venta (empresa_id, estado, creado_en desc);

-- ---------- Líneas de documento ----------
create table public.documentos_venta_lineas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  documento_id uuid not null,
  producto_id uuid,
  descripcion text not null,
  cantidad integer not null check (cantidad > 0),
  precio_neto integer not null check (precio_neto >= 0),
  exenta boolean not null default false,
  subtotal integer not null check (subtotal >= 0),
  foreign key (empresa_id, documento_id) references public.documentos_venta (empresa_id, id) on delete cascade,
  foreign key (empresa_id, producto_id) references public.productos (empresa_id, id)
);
create index documentos_venta_lineas_doc_idx on public.documentos_venta_lineas (empresa_id, documento_id);

-- ---------- Reserva atómica de folio ----------
create or replace function app.tomar_folio(p_empresa uuid, p_tipo text)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  v_folio integer;
  v_caf_id uuid;
begin
  -- Bloquea el CAF vigente y toma el siguiente folio si queda rango.
  select id, siguiente into v_caf_id, v_folio
  from folios_caf
  where empresa_id = p_empresa and tipo_documento = p_tipo and activo and siguiente <= hasta
  order by desde
  limit 1
  for update;

  if v_caf_id is null then
    raise exception 'No hay folios CAF disponibles para el tipo %; carga un CAF en Configuración', p_tipo;
  end if;

  update folios_caf set siguiente = siguiente + 1 where id = v_caf_id;
  return v_folio;
end $$;

revoke execute on function app.tomar_folio(uuid, text) from anon, public;
grant execute on function app.tomar_folio(uuid, text) to authenticated;

-- ---------- RLS ----------
alter table public.folios_caf enable row level security;
alter table public.documentos_venta enable row level security;
alter table public.documentos_venta_lineas enable row level security;

-- folios_caf: ver miembros; cargar/editar solo dueno/admin.
create policy "miembros ven folios" on public.folios_caf
  for select to authenticated using (empresa_id in (select app.mis_empresas()));
create policy "duenos cargan folios" on public.folios_caf
  for insert to authenticated
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']));
create policy "duenos editan folios" on public.folios_caf
  for update to authenticated
  using (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']))
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']));

-- documentos_venta: ver miembros; crear/editar vendedor+; sin delete (baja lógica vía estado).
create policy "miembros ven documentos" on public.documentos_venta
  for select to authenticated using (empresa_id in (select app.mis_empresas()));
create policy "vendedores crean documentos" on public.documentos_venta
  for insert to authenticated
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin', 'vendedor']));
create policy "vendedores editan documentos" on public.documentos_venta
  for update to authenticated
  using (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin', 'vendedor']))
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin', 'vendedor']));

-- líneas: heredan del documento.
create policy "miembros ven lineas" on public.documentos_venta_lineas
  for select to authenticated using (empresa_id in (select app.mis_empresas()));
create policy "vendedores crean lineas" on public.documentos_venta_lineas
  for insert to authenticated
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin', 'vendedor']));
create policy "vendedores editan lineas" on public.documentos_venta_lineas
  for update to authenticated
  using (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin', 'vendedor']))
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin', 'vendedor']));

-- ---------- Grants Data API (lección Plan 1) ----------
grant select, insert, update on public.folios_caf, public.documentos_venta, public.documentos_venta_lineas to authenticated;
grant select, insert, update, delete on public.folios_caf, public.documentos_venta, public.documentos_venta_lineas to service_role;
```

- [ ] **Step 2: Aplicar y verificar**

Run: `pnpm supabase db reset`
Expected: aplica las 4 migraciones sin errores.

Run: `pnpm supabase db diff`
Expected: `No schema changes found`.

Run (verificar grant por rol en el contenedor DB — nombre con `docker ps --format '{{.Names}}'`, empieza con `supabase_db_`):
`docker exec <db> psql -U postgres -d postgres -c "set role authenticated; select count(*) from documentos_venta"`
Expected: `0` (sin error). Con `set role anon` debe dar `permission denied`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/00000000000004_ventas.sql
git commit -m "feat(db): ventas, folios CAF y certificado cifrado con RLS y folio atomico"
```

---

### Task 5: pgTAP de ventas (aislamiento, folio atómico, roles)

**Files:**
- Create: `supabase/tests/database/ventas.test.sql`

**Interfaces:**
- Consumes: esquema de Task 4. Patrón de impersonación de Planes 1-2.
- Produces: garantía verificable de aislamiento por empresa, unicidad/atomicidad de folio y matriz de roles.

- [ ] **Step 1: Escribir el test**

`supabase/tests/database/ventas.test.sql`:

```sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'ana@a.cl'),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'beto@b.cl'),
  ('00000000-0000-0000-0000-000000000000', '55555555-5555-5555-5555-555555555555', 'authenticated', 'authenticated', 'ces@a.cl');

insert into public.organizaciones (id, rut, razon_social)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '761111116', 'Org A'),
       ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '762222221', 'Org B');

insert into public.empresas (id, organizacion_id, rut, razon_social)
values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '761111116', 'Empresa A'),
       ('eeeeeeee-0000-0000-0000-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '762222221', 'Empresa B');

insert into public.miembros (usuario_id, organizacion_id, rol)
values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'dueno'),
       ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'dueno'),
       ('55555555-5555-5555-5555-555555555555', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'contador');

insert into public.clientes (id, empresa_id, rut, razon_social)
values ('cccccccc-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '765432103', 'Cliente A');

insert into public.folios_caf (empresa_id, tipo_documento, desde, hasta, siguiente, xml_caf)
values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'factura', 100, 102, 100, '<CAF/>');

-- Ana (duena A) toma folios atómicamente: 100, luego 101.
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select is( (select app.tomar_folio('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'factura')), 100, 'primer folio es 100' );
select is( (select app.tomar_folio('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'factura')), 101, 'segundo folio es 101 (no repite)' );

-- Ana crea un documento y su línea.
select lives_ok(
  $$insert into documentos_venta (id, empresa_id, tipo, cliente_id, total)
    values ('dddddddd-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'factura', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 11900)$$,
  'la dueña crea un documento de venta'
);
select lives_ok(
  $$insert into documentos_venta_lineas (empresa_id, documento_id, descripcion, cantidad, precio_neto, subtotal)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'dddddddd-0000-0000-0000-aaaaaaaaaaaa', 'Item', 1, 10000, 10000)$$,
  'la dueña agrega una línea'
);

-- Beto (org B) no ve los documentos de A.
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
select is( (select count(*) from documentos_venta), 0::bigint, 'Beto no ve documentos de la empresa A' );

-- Beto no puede crear documentos en la empresa A.
select throws_ok(
  $$insert into documentos_venta (empresa_id, tipo, cliente_id, total)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'factura', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 1)$$,
  '42501', null, 'Beto no puede crear documentos en la empresa A'
);

-- Ces (contador de A) NO puede crear documentos (rol sin permiso de venta): RLS filtra el insert.
set local request.jwt.claims to '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated"}';
select throws_ok(
  $$insert into documentos_venta (empresa_id, tipo, cliente_id, total)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'factura', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 1)$$,
  '42501', null, 'el contador no puede crear documentos de venta'
);

-- Anónimo denegado de plano.
set local request.jwt.claims to '{"role": "anon"}';
set local role anon;
select throws_ok(
  'select count(*) from documentos_venta',
  '42501', 'permission denied for table documentos_venta',
  'un anónimo no puede consultar documentos'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Correr y verificar**

Run: `pnpm supabase test db`
Expected: 4 archivos, 31 asserts (6 aislamiento + 7 registro + 10 maestros + 8 ventas), todos verdes. Si un assert de ventas falla, corregir la migración de Task 4 (nunca el test); reportar BLOCKED si el fix no es obvio.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/database/ventas.test.sql
git commit -m "test(db): aislamiento, folio atomico y roles de ventas con pgTAP"
```

---

### Task 6: Regenerar tipos `@suite/db`

**Files:**
- Modify: `packages/db/src/types.ts` (regenerado)

**Interfaces:**
- Produces: tipo `Database` con `documentos_venta`, `documentos_venta_lineas`, `folios_caf`, columnas nuevas de `empresas` y la función `tomar_folio`.

- [ ] **Step 1: Regenerar y verificar**

Run: `pnpm --filter @suite/db gen`
Expected: `packages/db/src/types.ts` incluye las 3 tablas nuevas y las columnas de certificado en `empresas`.

Run: `pnpm tsc --noEmit -p packages/db/tsconfig.json`
Expected: sin errores.

Run: `pnpm build`
Expected: las 3 apps compilan (usar `--concurrency=1` si el build en OneDrive falla por race de `.next`).

- [ ] **Step 2: Commit**

```bash
git add packages/db/src/types.ts
git commit -m "feat(db): tipos regenerados con tablas de ventas"
```

---

### Task 7: ERP — configuración del emisor (certificado + CAF cifrados)

**Files:**
- Create: `apps/erp/app/configuracion/dte/page.tsx`, `apps/erp/app/configuracion/dte/acciones.ts`, `apps/erp/componentes/formulario-emisor.tsx`, `apps/erp/componentes/formulario-certificado.tsx`, `apps/erp/componentes/formulario-caf.tsx`
- Modify: `apps/erp/app/layout.tsx` (agregar item "Configuración" al NAV), `apps/erp/.env.example` (agregar `DTE_ENCRYPTION_KEY` y `DTE_AMBIENTE`)

**Interfaces:**
- Consumes: `crearClienteServidor` (`@suite/auth/server`), `obtenerEmpresaActiva`, `cifrar` de `@suite/dte`, `@suite/ui`.
- Produces: Server Actions `guardarEmisor(prev, formData): Promise<EstadoForm>` (datos del emisor + resolución SII) y `cargarCertificado(prev, formData): Promise<EstadoForm>` (sube .pfx + password + api key, los cifra y guarda) y `cargarCAF(prev, formData): Promise<EstadoForm>` (sube XML CAF, parsea rango, inserta en `folios_caf`).

- [ ] **Step 1: Env vars**

Agregar a `apps/erp/.env.example`:

```
# Clave AES-256 (32 bytes hex) para cifrar el certificado DTE. Generar con:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
DTE_ENCRYPTION_KEY=
DTE_AMBIENTE=certificacion
```

Crear la clave real en `apps/erp/.env.local` (NO commitear): correr el comando node de arriba y pegar el valor.

- [ ] **Step 2: Server Actions de configuración**

`apps/erp/app/configuracion/dte/acciones.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@suite/auth/server'
import { cifrar } from '@suite/dte'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import type { EstadoForm } from '../../tipos'

function claveCifrado(): string {
  const clave = process.env.DTE_ENCRYPTION_KEY
  if (!clave) throw new Error('Falta DTE_ENCRYPTION_KEY en el servidor')
  return clave
}

export async function guardarEmisor(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const giro = String(formData.get('giro_emisor') ?? '').trim()
  const direccion = String(formData.get('direccion_emisor') ?? '').trim()
  const comuna = String(formData.get('comuna_emisor') ?? '').trim()
  const resolucion = Number(String(formData.get('resolucion_sii_numero') ?? '').trim() || '0')
  const fecha = String(formData.get('resolucion_sii_fecha') ?? '').trim() || null

  if (giro === '') return { error: 'El giro es obligatorio' }

  const supabase = await crearClienteServidor()
  const { data, error } = await supabase
    .from('empresas')
    .update({
      giro_emisor: giro,
      direccion_emisor: direccion || null,
      comuna_emisor: comuna || null,
      resolucion_sii_numero: resolucion || null,
      resolucion_sii_fecha: fecha,
    })
    .eq('id', activa.id)
    .select('id')
  if (error) return { error: 'No se pudieron guardar los datos del emisor' }
  if ((data ?? []).length === 0) return { error: 'No se pudo guardar: tu rol no permite editar la empresa' }

  revalidatePath('/configuracion/dte')
  return {}
}

export async function cargarCertificado(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const archivo = formData.get('certificado')
  const password = String(formData.get('certificado_password') ?? '')
  const apiKey = String(formData.get('dte_api_key') ?? '').trim()
  if (!(archivo instanceof File) || archivo.size === 0) return { error: 'Selecciona el archivo del certificado (.pfx)' }
  if (password === '') return { error: 'Ingresa la contraseña del certificado' }
  if (apiKey === '') return { error: 'Ingresa la API key de tu proveedor DTE' }

  const bytes = Buffer.from(await archivo.arrayBuffer())
  const clave = claveCifrado()

  const supabase = await crearClienteServidor()
  const { data, error } = await supabase
    .from('empresas')
    .update({
      certificado_cifrado: cifrar(bytes, clave),
      certificado_password_cifrada: cifrar(Buffer.from(password, 'utf8'), clave),
      dte_api_key_cifrada: cifrar(Buffer.from(apiKey, 'utf8'), clave),
    })
    .eq('id', activa.id)
    .select('id')
  if (error) return { error: 'No se pudo guardar el certificado' }
  if ((data ?? []).length === 0) return { error: 'No se pudo guardar: solo el dueño o admin puede cargar el certificado' }

  revalidatePath('/configuracion/dte')
  return {}
}

export async function cargarCAF(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const tipo = String(formData.get('tipo_documento') ?? '')
  const archivo = formData.get('caf')
  if (!['factura', 'boleta', 'nota_credito'].includes(tipo)) return { error: 'Tipo de documento inválido' }
  if (!(archivo instanceof File) || archivo.size === 0) return { error: 'Selecciona el archivo CAF (.xml)' }

  const xml = await archivo.text()
  // El CAF del SII trae <RNG><D>desde</D><H>hasta</H></RNG>.
  const desde = Number(xml.match(/<D>(\d+)<\/D>/)?.[1] ?? '')
  const hasta = Number(xml.match(/<H>(\d+)<\/H>/)?.[1] ?? '')
  if (!Number.isInteger(desde) || !Number.isInteger(hasta) || desde < 1 || hasta < desde) {
    return { error: 'No se pudo leer el rango de folios del CAF (revisa el archivo)' }
  }

  const supabase = await crearClienteServidor()
  const { error } = await supabase.from('folios_caf').insert({
    empresa_id: activa.id,
    tipo_documento: tipo,
    desde,
    hasta,
    siguiente: desde,
    xml_caf: xml,
  })
  if (error) {
    if (error.code === '42501') return { error: 'Solo el dueño o admin puede cargar folios CAF' }
    return { error: 'No se pudo cargar el CAF' }
  }

  revalidatePath('/configuracion/dte')
  return {}
}
```

- [ ] **Step 3: Formulario (client) y página**

`apps/erp/componentes/formulario-emisor.tsx`:

```tsx
'use client'

import { useActionState } from 'react'
import { Boton, Campo, Entrada, Tarjeta } from '@suite/ui'
import type { EstadoForm } from '../app/tipos'

export function FormularioEmisor({
  accion,
  inicial,
}: {
  accion: (prev: EstadoForm, formData: FormData) => Promise<EstadoForm>
  inicial: { giro: string; direccion: string; comuna: string; resolucion: number | ''; fecha: string }
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoForm)
  return (
    <Tarjeta className="max-w-2xl">
      <form action={enviar} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Campo etiqueta="Giro *">
          <Entrada name="giro_emisor" defaultValue={inicial.giro} required />
        </Campo>
        <Campo etiqueta="Comuna">
          <Entrada name="comuna_emisor" defaultValue={inicial.comuna} />
        </Campo>
        <div className="sm:col-span-2">
          <Campo etiqueta="Dirección">
            <Entrada name="direccion_emisor" defaultValue={inicial.direccion} />
          </Campo>
        </div>
        <Campo etiqueta="N° Resolución SII">
          <Entrada name="resolucion_sii_numero" inputMode="numeric" defaultValue={inicial.resolucion} />
        </Campo>
        <Campo etiqueta="Fecha Resolución SII">
          <Entrada name="resolucion_sii_fecha" type="date" defaultValue={inicial.fecha} />
        </Campo>
        <div className="flex items-center justify-end gap-2 sm:col-span-2">
          {estado.error && <span className="mr-auto text-sm text-red-600">{estado.error}</span>}
          <Boton type="submit" disabled={pendiente}>{pendiente ? 'Guardando…' : 'Guardar emisor'}</Boton>
        </div>
      </form>
    </Tarjeta>
  )
}
```

`apps/erp/app/configuracion/dte/page.tsx`:

```tsx
import { crearClienteServidor } from '@suite/auth/server'
import { Encabezado, Insignia } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { FormularioEmisor } from '../../../componentes/formulario-emisor'
import { FormularioCertificado } from '../../../componentes/formulario-certificado'
import { FormularioCAF } from '../../../componentes/formulario-caf'
import { cargarCAF, cargarCertificado, guardarEmisor } from './acciones'

export default async function ConfigDTE() {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />

  const supabase = await crearClienteServidor()
  const { data: empresa } = await supabase
    .from('empresas')
    .select('giro_emisor, direccion_emisor, comuna_emisor, resolucion_sii_numero, resolucion_sii_fecha, certificado_cifrado')
    .eq('id', activa.id)
    .single()
  const { data: cafs } = await supabase
    .from('folios_caf')
    .select('tipo_documento, desde, hasta, siguiente, activo')
    .eq('empresa_id', activa.id)
    .order('creado_en', { ascending: false })

  const tieneCert = Boolean(empresa?.certificado_cifrado)

  return (
    <div>
      <Encabezado titulo="Configuración de facturación electrónica" />

      <h2 className="mb-2 text-lg font-semibold text-slate-800">Datos del emisor</h2>
      <FormularioEmisor
        accion={guardarEmisor}
        inicial={{
          giro: empresa?.giro_emisor ?? '',
          direccion: empresa?.direccion_emisor ?? '',
          comuna: empresa?.comuna_emisor ?? '',
          resolucion: empresa?.resolucion_sii_numero ?? '',
          fecha: empresa?.resolucion_sii_fecha ?? '',
        }}
      />

      <h2 className="mb-2 mt-8 text-lg font-semibold text-slate-800">
        Certificado digital {tieneCert ? <Insignia tono="verde">Cargado</Insignia> : <Insignia tono="amarillo">Falta</Insignia>}
      </h2>
      <FormularioCertificado accion={cargarCertificado} />

      <h2 className="mb-2 mt-8 text-lg font-semibold text-slate-800">Folios CAF</h2>
      <FormularioCAF accion={cargarCAF} cafs={cafs ?? []} />
    </div>
  )
}
```

`apps/erp/componentes/formulario-certificado.tsx` y `apps/erp/componentes/formulario-caf.tsx` siguen el mismo patrón `useActionState` que `formulario-emisor.tsx` (arriba): cada uno envuelve su `<form action={enviar}>` con `const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoForm)` y muestra `estado.error` en rojo — necesario porque `<form action={server-action}>` nativo descarta el valor de retorno de la Server Action, por lo que sin `useActionState` los errores (contraseña vencida, CAF inválido, RLS) se pierden silenciosamente.

Modificar `apps/erp/app/layout.tsx` — agregar al array `NAV` (después de "Importar"):

```tsx
  { href: '/configuracion/dte', etiqueta: 'Configuración' },
```

- [ ] **Step 4: Verificar**

Run: `pnpm --filter erp build`
Expected: build sin errores.

Verificación manual/scriptada (Task 12 hace la integral): con sesión iniciada, `GET /configuracion/dte` sin cookies → 307 al login. La carga real de certificado/CAF se prueba en la verificación integral.

- [ ] **Step 5: Commit**

```bash
git add apps/erp/app/configuracion apps/erp/componentes/formulario-emisor.tsx apps/erp/app/layout.tsx apps/erp/.env.example
git commit -m "feat(erp): configuracion del emisor con certificado cifrado y carga de CAF"
```

---

### Task 8: ERP — nueva venta (selector de productos y cliente, totales en vivo)

**Files:**
- Create: `apps/erp/app/ventas/nueva/page.tsx`, `apps/erp/app/ventas/acciones.ts`, `apps/erp/componentes/formulario-venta.tsx`
- Modify: `apps/erp/app/layout.tsx` (agregar "Ventas" al NAV, antes de "Configuración"), `apps/erp/app/tipos.ts` (agregar tipo del resultado de venta)

**Interfaces:**
- Consumes: `obtenerEmpresaActiva`, `@suite/ui`, `formatearCLP`, `totalesDocumento`, `type LineaDocumento` de `@suite/core`, tablas `productos`/`clientes`/`documentos_venta`.
- Produces: Server Action `crearNotaVenta(prev, formData): Promise<ResultadoVenta>` que inserta un `documentos_venta` (estado `borrador`, tipo `nota_venta`) + sus líneas en una transacción vía RPC, y redirige a `/ventas/[id]`. `type ResultadoVenta = { error?: string }` en `tipos.ts`.

- [ ] **Step 1: Tipo del resultado**

Agregar a `apps/erp/app/tipos.ts`:

```ts
export type ResultadoVenta = { error?: string }
```

- [ ] **Step 2: RPC transaccional para crear la venta con líneas**

Crear `supabase/migrations/00000000000005_crear_venta.sql` (o el siguiente correlativo libre):

```sql
-- Crea un documento de venta (borrador) con sus líneas en una transacción,
-- calculando totales server-side. Devuelve el id del documento.
-- Precio, exención y nombre se toman del PRODUCTO (fuente de verdad tributaria),
-- nunca de lo que envía el cliente: evita sub-declarar IVA marcando un afecto como
-- exento o alterar el precio. Del cliente solo se confía la cantidad.
create or replace function public.crear_documento_venta(
  p_empresa uuid,
  p_cliente uuid,
  p_tipo text,
  p_lineas jsonb
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_doc uuid;
  v_neto integer := 0;
  v_exento integer := 0;
  v_iva integer;
  v_linea jsonb;
  v_sub integer;
  v_nombre text;
  v_precio integer;
  v_exenta boolean;
  v_cant integer;
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno','admin','vendedor']) then
    raise exception 'Tu rol no permite crear ventas';
  end if;
  -- Esta RPC solo crea notas de venta (borrador). Los documentos tributarios
  -- se generan al emitir (que toma folio y valida certificado).
  if p_tipo <> 'nota_venta' then
    raise exception 'Tipo de documento no permitido en esta operación';
  end if;
  if jsonb_array_length(p_lineas) = 0 then
    raise exception 'La venta debe tener al menos una línea';
  end if;

  insert into documentos_venta (empresa_id, tipo, cliente_id, estado)
  values (p_empresa, p_tipo, p_cliente, 'borrador')
  returning id into v_doc;

  for v_linea in select * from jsonb_array_elements(p_lineas) loop
    select nombre, precio_neto, exento into v_nombre, v_precio, v_exenta
    from productos
    where id = (v_linea->>'productoId')::uuid and empresa_id = p_empresa and activo;
    if not found then
      raise exception 'Producto no encontrado o inactivo en la empresa';
    end if;
    v_cant := (v_linea->>'cantidad')::integer;
    if v_cant < 1 then
      raise exception 'La cantidad debe ser al menos 1';
    end if;
    v_sub := round(v_cant * v_precio);
    insert into documentos_venta_lineas (empresa_id, documento_id, producto_id, descripcion, cantidad, precio_neto, exenta, subtotal)
    values (p_empresa, v_doc, (v_linea->>'productoId')::uuid, v_nombre, v_cant, v_precio, v_exenta, v_sub);
    if v_exenta then v_exento := v_exento + v_sub; else v_neto := v_neto + v_sub; end if;
  end loop;

  v_iva := round(v_neto * 0.19);
  update documentos_venta set neto = v_neto, exento = v_exento, iva = v_iva, total = v_neto + v_exento + v_iva
  where id = v_doc;

  return v_doc;
end $$;

revoke execute on function public.crear_documento_venta(uuid, uuid, text, jsonb) from anon, public;
grant execute on function public.crear_documento_venta(uuid, uuid, text, jsonb) to authenticated;
```

Run: `pnpm supabase db reset && pnpm supabase test db`
Expected: aplica; los 31 asserts pgTAP siguen verdes.

- [ ] **Step 3: Server Action de la venta**

`apps/erp/app/ventas/acciones.ts`:

```ts
'use server'

import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import type { ResultadoVenta } from '../tipos'

export async function crearNotaVenta(_prev: ResultadoVenta, formData: FormData): Promise<ResultadoVenta> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const clienteId = String(formData.get('cliente_id') ?? '')
  if (!clienteId) return { error: 'Selecciona un cliente' }

  let lineas: unknown
  try {
    lineas = JSON.parse(String(formData.get('lineas') ?? '[]'))
  } catch {
    return { error: 'Líneas inválidas' }
  }
  if (!Array.isArray(lineas) || lineas.length === 0) return { error: 'Agrega al menos un producto' }

  const supabase = await crearClienteServidor()
  const { data, error } = await supabase.rpc('crear_documento_venta', {
    p_empresa: activa.id,
    p_cliente: clienteId,
    p_tipo: 'nota_venta',
    p_lineas: lineas,
  })
  if (error) return { error: error.message.includes('rol') ? 'Tu rol no permite crear ventas' : 'No se pudo crear la venta' }

  redirect('/ventas/' + data)
}
```

- [ ] **Step 4: Formulario de venta (client) y página**

`apps/erp/componentes/formulario-venta.tsx`:

```tsx
'use client'

import { useActionState, useState } from 'react'
import { Boton, Campo, Entrada, Selector, Tabla, Td, Th, Tr, Tarjeta } from '@suite/ui'
import { formatearCLP, totalesDocumento, type LineaDocumento } from '@suite/core'
import type { ResultadoVenta } from '../app/tipos'

interface ProductoOpcion { id: string; nombre: string; precio_neto: number; exento: boolean }
interface ClienteOpcion { id: string; razon_social: string }

export function FormularioVenta({
  accion,
  productos,
  clientes,
}: {
  accion: (prev: ResultadoVenta, formData: FormData) => Promise<ResultadoVenta>
  productos: ProductoOpcion[]
  clientes: ClienteOpcion[]
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as ResultadoVenta)
  const [lineas, setLineas] = useState<LineaDocumento[]>([])

  function agregar(productoId: string) {
    const p = productos.find((x) => x.id === productoId)
    if (!p) return
    setLineas((ls) => [
      ...ls,
      { productoId: p.id, descripcion: p.nombre, cantidad: 1, precioNeto: p.precio_neto, exenta: p.exento },
    ])
  }
  function cambiarCantidad(i: number, cantidad: number) {
    setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, cantidad: Math.max(1, cantidad) } : l)))
  }
  function quitar(i: number) {
    setLineas((ls) => ls.filter((_, j) => j !== i))
  }

  const totales = totalesDocumento(lineas)

  return (
    <form action={enviar}>
      <input type="hidden" name="lineas" value={JSON.stringify(lineas)} />
      <Tarjeta className="mb-4 max-w-3xl">
        <div className="flex flex-wrap items-end gap-3">
          <Campo etiqueta="Cliente *">
            <Selector name="cliente_id" required defaultValue="">
              <option value="" disabled>Selecciona…</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>{c.razon_social}</option>
              ))}
            </Selector>
          </Campo>
          <Campo etiqueta="Agregar producto">
            <Selector value="" onChange={(e: React.ChangeEvent<HTMLSelectElement>) => { agregar(e.currentTarget.value); e.currentTarget.value = '' }}>
              <option value="" disabled>Selecciona…</option>
              {productos.map((p) => (
                <option key={p.id} value={p.id}>{p.nombre} — {formatearCLP(p.precio_neto)}</option>
              ))}
            </Selector>
          </Campo>
        </div>
      </Tarjeta>

      <Tabla>
        <thead>
          <tr><Th>Producto</Th><Th>Cantidad</Th><Th className="text-right">Precio neto</Th><Th className="text-right">Subtotal</Th><Th /></tr>
        </thead>
        <tbody>
          {lineas.map((l, i) => (
            <Tr key={i}>
              <Td>{l.descripcion}{l.exenta && ' (exento)'}</Td>
              <Td>
                <Entrada type="number" min={1} value={l.cantidad} onChange={(e: React.ChangeEvent<HTMLInputElement>) => cambiarCantidad(i, Number(e.currentTarget.value))} className="w-20" />
              </Td>
              <Td className="text-right">{formatearCLP(l.precioNeto)}</Td>
              <Td className="text-right">{formatearCLP(Math.round(l.cantidad * l.precioNeto))}</Td>
              <Td><Boton variante="secundario" type="button" className="px-2 py-1 text-xs" onClick={() => quitar(i)}>Quitar</Boton></Td>
            </Tr>
          ))}
          {lineas.length === 0 && <Tr><Td colSpan={5} className="py-6 text-center text-slate-500">Agrega productos a la venta.</Td></Tr>}
        </tbody>
      </Tabla>

      <div className="mt-4 flex flex-col items-end gap-1 text-sm">
        <div>Neto: <strong>{formatearCLP(totales.neto)}</strong></div>
        {totales.exento > 0 && <div>Exento: <strong>{formatearCLP(totales.exento)}</strong></div>}
        <div>IVA (19%): <strong>{formatearCLP(totales.iva)}</strong></div>
        <div className="text-lg">Total: <strong>{formatearCLP(totales.total)}</strong></div>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2">
        {estado.error && <span className="mr-auto text-sm text-red-600">{estado.error}</span>}
        <Boton type="submit" disabled={pendiente || lineas.length === 0}>{pendiente ? 'Guardando…' : 'Guardar nota de venta'}</Boton>
      </div>
    </form>
  )
}
```

`apps/erp/app/ventas/nueva/page.tsx`:

```tsx
import { crearClienteServidor } from '@suite/auth/server'
import { Encabezado } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { FormularioVenta } from '../../../componentes/formulario-venta'
import { crearNotaVenta } from '../acciones'

export default async function NuevaVenta() {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const supabase = await crearClienteServidor()
  const [{ data: productos }, { data: clientes }] = await Promise.all([
    supabase.from('productos').select('id, nombre, precio_neto, exento').eq('empresa_id', activa.id).eq('activo', true).order('nombre'),
    supabase.from('clientes').select('id, razon_social').eq('empresa_id', activa.id).eq('activo', true).order('razon_social'),
  ])
  return (
    <div>
      <Encabezado titulo="Nueva venta" />
      <FormularioVenta accion={crearNotaVenta} productos={productos ?? []} clientes={clientes ?? []} />
    </div>
  )
}
```

Modificar `apps/erp/app/layout.tsx` — agregar al `NAV` antes de "Configuración":

```tsx
  { href: '/ventas', etiqueta: 'Ventas' },
```

- [ ] **Step 5: Verificar**

Run: `pnpm --filter erp build`
Expected: build sin errores.

- [ ] **Step 6: Commit**

```bash
git add apps/erp/app/ventas/nueva apps/erp/app/ventas/acciones.ts apps/erp/componentes/formulario-venta.tsx apps/erp/app/layout.tsx apps/erp/app/tipos.ts supabase/migrations/00000000000005_crear_venta.sql
git commit -m "feat(erp): nueva venta con selector de productos, cliente y totales en vivo"
```

---

### Task 9: ERP — emisión del DTE, lista y detalle con PDF

**Files:**
- Create: `apps/erp/app/ventas/page.tsx`, `apps/erp/app/ventas/[id]/page.tsx`, `apps/erp/app/ventas/emitir.ts`, `apps/erp/lib/emision.ts`, `apps/erp/app/ventas/[id]/pdf/route.ts`

**Interfaces:**
- Consumes: `obtenerEmpresaActiva`, `@suite/dte` (`proveedorPorAmbiente`, `descifrar`, tipos), `@suite/core` (`esTributario`, `CODIGO_SII`, `formatearCLP`, `formatearRut`), `crearClienteServidor`, `clienteAdmin` de `@suite/auth/admin` (para escribir estado/xml saltando RLS de forma controlada en el servidor), tablas de ventas.
- Produces:
  - `emitirDocumento(formData): Promise<void>` — Server Action: valida certificado+CAF+emisor, reserva folio (`app.tomar_folio`), llama al proveedor, persiste resultado (folio, track_id, xml, estado). Idempotente por documento.
  - `emitirNotaCredito(formData): Promise<void>` — emite NC referenciando una factura/boleta emitida.
  - Lista de documentos con filtro por estado; detalle con líneas, totales y botón emitir/descargar PDF.
  - `GET /ventas/[id]/pdf` — devuelve el PDF (desde `pdf_ruta` en Storage o el `pdfBase64` guardado).

- [ ] **Step 1: Helper de emisión (server-only)**

`apps/erp/lib/emision.ts`:

```ts
import 'server-only'
import { clienteAdmin } from '@suite/auth/admin'
import { descifrar, proveedorPorAmbiente, type CredencialesDTE, type SolicitudEmision } from '@suite/dte'
import { CODIGO_SII, type TipoDocumento } from '@suite/core'

function clave(): string {
  const k = process.env.DTE_ENCRYPTION_KEY
  if (!k) throw new Error('Falta DTE_ENCRYPTION_KEY')
  return k
}

// Descifra las credenciales de la empresa. SOLO server-side. Usa service_role para leer
// las columnas cifradas de forma controlada (nunca expuestas al cliente).
export async function credencialesEmpresa(empresaId: string, tipo: TipoDocumento): Promise<CredencialesDTE> {
  const admin = clienteAdmin()
  const { data: emp, error } = await admin
    .from('empresas')
    .select('certificado_cifrado, certificado_password_cifrada, dte_api_key_cifrada')
    .eq('id', empresaId)
    .single()
  if (error || !emp?.certificado_cifrado || !emp.certificado_password_cifrada || !emp.dte_api_key_cifrada) {
    throw new Error('Falta configurar el certificado digital en Configuración')
  }
  const { data: caf } = await admin
    .from('folios_caf')
    .select('xml_caf')
    .eq('empresa_id', empresaId)
    .eq('tipo_documento', tipo)
    .eq('activo', true)
    .limit(1)
    .single()
  if (!caf) throw new Error('Falta cargar folios CAF para ' + tipo)

  const k = clave()
  return {
    apiKey: descifrar(emp.dte_api_key_cifrada, k).toString('utf8'),
    certificadoPfx: descifrar(emp.certificado_cifrado, k),
    certificadoPassword: descifrar(emp.certificado_password_cifrada, k).toString('utf8'),
    cafXml: caf.xml_caf,
  }
}

export { CODIGO_SII, proveedorPorAmbiente }
export type { SolicitudEmision }
```

- [ ] **Step 2: Server Action de emisión**

`apps/erp/app/ventas/emitir.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { clienteAdmin } from '@suite/auth/admin'
import { crearClienteServidor } from '@suite/auth/server'
import { CODIGO_SII, esTributario, type TipoDocumento } from '@suite/core'
import { proveedorPorAmbiente } from '@suite/dte'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import { credencialesEmpresa } from '../../lib/emision'

const TIPOS_EMISIBLES = ['factura', 'boleta'] as const

export async function emitirDocumento(formData: FormData): Promise<void> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return
  const id = String(formData.get('id') ?? '')
  const tipo = String(formData.get('tipo') ?? '') as TipoDocumento
  if (!TIPOS_EMISIBLES.includes(tipo as (typeof TIPOS_EMISIBLES)[number])) return

  const supabase = await crearClienteServidor()
  // Verifica que el documento pertenece a la empresa activa y está emitible (RLS lo acota).
  const { data: doc } = await supabase
    .from('documentos_venta')
    .select('id, estado, folio, cliente_id, neto, exento, iva, total')
    .eq('id', id)
    .eq('empresa_id', activa.id)
    .single()
  if (!doc || (doc.estado !== 'borrador' && doc.estado !== 'pendiente_envio')) return

  const admin = clienteAdmin()
  try {
    const cred = await credencialesEmpresa(activa.id, tipo)

    // Reserva de folio SOLO si aún no tiene (idempotencia ante reintento).
    // tomar_folio se llama en contexto de USUARIO (supabase, no admin): la función
    // valida internamente que el usuario pertenece a la empresa (auth.uid()), lo que
    // bajo service_role fallaría. security definer le permite avanzar folios_caf igual.
    let folio = doc.folio
    if (folio === null) {
      const { data: nuevo, error: eFolio } = await supabase.rpc('tomar_folio', { p_empresa: activa.id, p_tipo: tipo })
      if (eFolio || nuevo === null) throw new Error(eFolio?.message ?? 'No hay folios disponibles')
      folio = nuevo as number
      await admin.from('documentos_venta').update({ tipo, folio, estado: 'pendiente_envio' }).eq('id', id)
    }

    const [{ data: emp }, { data: cli }, { data: lineas }] = await Promise.all([
      admin.from('empresas').select('rut, razon_social, giro_emisor, direccion_emisor, comuna_emisor').eq('id', activa.id).single(),
      admin.from('clientes').select('rut, razon_social, giro, direccion, comuna').eq('id', doc.cliente_id).single(),
      admin.from('documentos_venta_lineas').select('descripcion, cantidad, precio_neto, exenta').eq('documento_id', id),
    ])

    const proveedor = proveedorPorAmbiente(process.env.DTE_AMBIENTE ?? 'certificacion')
    const resultado = await proveedor.emitirDTE({
      tipo,
      codigoSii: CODIGO_SII[tipo]!,
      folio: folio!,
      emisor: {
        rut: emp!.rut, razonSocial: emp!.razon_social, giro: emp!.giro_emisor ?? '',
        direccion: emp!.direccion_emisor ?? '', comuna: emp!.comuna_emisor ?? '',
      },
      receptor: {
        rut: cli!.rut, razonSocial: cli!.razon_social, giro: cli!.giro ?? undefined,
        direccion: cli!.direccion ?? undefined, comuna: cli!.comuna ?? undefined,
      },
      lineas: (lineas ?? []).map((l) => ({ descripcion: l.descripcion, cantidad: l.cantidad, precioNeto: l.precio_neto, exenta: l.exenta })),
      neto: doc.neto, exento: doc.exento, iva: doc.iva, total: doc.total,
      credenciales: cred,
    })

    await admin
      .from('documentos_venta')
      .update({
        estado: resultado.estado === 'emitido' ? 'emitido' : 'pendiente_envio',
        track_id: resultado.trackId,
        xml_timbrado: resultado.xmlTimbrado,
        pdf_ruta: resultado.pdfBase64,
        error_emision: resultado.error,
        emitido_en: resultado.estado === 'emitido' ? new Date().toISOString() : null,
        intentos: 1,
      })
      .eq('id', id)
  } catch (e) {
    await admin
      .from('documentos_venta')
      .update({ estado: 'pendiente_envio', error_emision: e instanceof Error ? e.message : 'Error de emisión' })
      .eq('id', id)
  }

  revalidatePath('/ventas')
  revalidatePath('/ventas/' + id)
}
```

`emitirNotaCredito` en el mismo `emitir.ts` (emite una NC que referencia una factura/boleta ya emitida, reservando su propio folio):

```ts
export async function emitirNotaCredito(formData: FormData): Promise<void> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return
  const refId = String(formData.get('referencia_id') ?? '')
  const razon = String(formData.get('razon') ?? '').trim() || 'Anula documento'

  const supabase = await crearClienteServidor()
  const { data: ref } = await supabase
    .from('documentos_venta')
    .select('id, tipo, folio, cliente_id, neto, exento, iva, total')
    .eq('id', refId).eq('empresa_id', activa.id).eq('estado', 'emitido').single()
  if (!ref || !ref.folio) return

  const admin = clienteAdmin()
  try {
    const cred = await credencialesEmpresa(activa.id, 'nota_credito')
    // tomar_folio en contexto de usuario (valida pertenencia por auth.uid()).
    const { data: folioNc, error: eF } = await supabase.rpc('tomar_folio', { p_empresa: activa.id, p_tipo: 'nota_credito' })
    if (eF || folioNc === null) throw new Error(eF?.message ?? 'No hay folios de nota de crédito')

    // Crea la NC como documento propio referenciando el original. Se inserta vía admin
    // (ya autorizado por el select RLS de arriba); NO vía crear_documento_venta, cuyo
    // check de rol usa auth.uid() y fallaría bajo service_role.
    const { data: ncDoc, error: eNc } = await admin
      .from('documentos_venta')
      .insert({
        empresa_id: activa.id, tipo: 'nota_credito', cliente_id: ref.cliente_id, estado: 'borrador',
        neto: ref.neto, exento: ref.exento, iva: ref.iva, total: ref.total,
      })
      .select('id')
      .single()
    if (eNc || !ncDoc) throw new Error('No se pudo crear la nota de crédito')
    const ncId = ncDoc.id
    await admin.from('documentos_venta_lineas').insert({
      empresa_id: activa.id, documento_id: ncId, producto_id: null,
      descripcion: 'Anulación ' + ref.tipo + ' folio ' + ref.folio, cantidad: 1,
      precio_neto: ref.total, exenta: false, subtotal: ref.total,
    })
    const [{ data: emp }, { data: cli }] = await Promise.all([
      admin.from('empresas').select('rut, razon_social, giro_emisor, direccion_emisor, comuna_emisor').eq('id', activa.id).single(),
      admin.from('clientes').select('rut, razon_social, giro, direccion, comuna').eq('id', ref.cliente_id).single(),
    ])
    const proveedor = proveedorPorAmbiente(process.env.DTE_AMBIENTE ?? 'certificacion')
    const resultado = await proveedor.anularConNotaCredito({
      tipo: 'nota_credito', codigoSii: 61, folio: folioNc as number,
      emisor: { rut: emp!.rut, razonSocial: emp!.razon_social, giro: emp!.giro_emisor ?? '', direccion: emp!.direccion_emisor ?? '', comuna: emp!.comuna_emisor ?? '' },
      receptor: { rut: cli!.rut, razonSocial: cli!.razon_social },
      lineas: [{ descripcion: 'Anulación', cantidad: 1, precioNeto: ref.total, exenta: false }],
      neto: ref.neto, exento: ref.exento, iva: ref.iva, total: ref.total,
      credenciales: cred,
      folioReferencia: ref.folio, codigoSiiReferencia: CODIGO_SII[ref.tipo as TipoDocumento]!, razonAnulacion: razon,
    })
    await admin.from('documentos_venta').update({
      folio: folioNc as number, documento_referencia_id: refId, razon_anulacion: razon,
      estado: resultado.estado === 'emitido' ? 'emitido' : 'pendiente_envio',
      track_id: resultado.trackId, xml_timbrado: resultado.xmlTimbrado, pdf_ruta: resultado.pdfBase64,
      emitido_en: resultado.estado === 'emitido' ? new Date().toISOString() : null,
    }).eq('id', ncId)
  } catch {
    // Silencioso; la NC queda sin emitir y el usuario reintenta.
  }
  revalidatePath('/ventas')
}
```

- [ ] **Step 3: Lista y detalle**

`apps/erp/app/ventas/page.tsx`:

```tsx
import Link from 'next/link'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP } from '@suite/core'
import { Boton, Encabezado, Insignia, Tabla, Td, Th, Tr } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'

const TONO: Record<string, 'verde' | 'amarillo' | 'rojo' | 'gris'> = {
  emitido: 'verde', pendiente_envio: 'amarillo', rechazado: 'rojo', borrador: 'gris',
}

export default async function PaginaVentas() {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const supabase = await crearClienteServidor()
  const { data: docs } = await supabase
    .from('documentos_venta')
    .select('id, tipo, folio, estado, total, creado_en, clientes (razon_social)')
    .eq('empresa_id', activa.id)
    .order('creado_en', { ascending: false })
    .limit(100)
  return (
    <div>
      <Encabezado titulo="Ventas">
        <Link href="/ventas/nueva"><Boton>Nueva venta</Boton></Link>
      </Encabezado>
      <Tabla>
        <thead><tr><Th>Tipo</Th><Th>Folio</Th><Th>Cliente</Th><Th className="text-right">Total</Th><Th>Estado</Th></tr></thead>
        <tbody>
          {(docs ?? []).map((d) => (
            <Tr key={d.id}>
              <Td><Link className="text-marca-700 hover:underline" href={`/ventas/${d.id}`}>{d.tipo.replace('_', ' ')}</Link></Td>
              <Td>{d.folio ?? '—'}</Td>
              <Td>{d.clientes?.razon_social ?? '—'}</Td>
              <Td className="text-right">{formatearCLP(d.total)}</Td>
              <Td><Insignia tono={TONO[d.estado] ?? 'gris'}>{d.estado.replace('_', ' ')}</Insignia></Td>
            </Tr>
          ))}
          {(docs ?? []).length === 0 && <Tr><Td colSpan={5} className="py-8 text-center text-slate-500">No hay ventas todavía.</Td></Tr>}
        </tbody>
      </Tabla>
    </div>
  )
}
```

`apps/erp/app/ventas/[id]/page.tsx`:

```tsx
import { notFound } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP, formatearRut } from '@suite/core'
import { Boton, Encabezado, Insignia, Tabla, Tarjeta, Td, Th, Tr } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { emitirDocumento, emitirNotaCredito } from '../emitir'

export default async function DetalleVenta({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const supabase = await crearClienteServidor()
  const { data: doc } = await supabase
    .from('documentos_venta')
    .select('*, clientes (razon_social, rut), documentos_venta_lineas (descripcion, cantidad, precio_neto, subtotal)')
    .eq('id', id).eq('empresa_id', activa.id).single()
  if (!doc) notFound()

  const emitible = doc.estado === 'borrador' || doc.estado === 'pendiente_envio'

  return (
    <div>
      <Encabezado titulo={`${doc.tipo.replace('_', ' ')} ${doc.folio ? '· folio ' + doc.folio : ''}`}>
        <Insignia tono={doc.estado === 'emitido' ? 'verde' : doc.estado === 'rechazado' ? 'rojo' : doc.estado === 'pendiente_envio' ? 'amarillo' : 'gris'}>
          {doc.estado.replace('_', ' ')}
        </Insignia>
      </Encabezado>

      <Tarjeta className="mb-4 max-w-3xl">
        <p><strong>Cliente:</strong> {doc.clientes?.razon_social} ({doc.clientes && formatearRut(doc.clientes.rut)})</p>
        {doc.error_emision && <p className="mt-2 text-sm text-amber-700">Último error: {doc.error_emision}</p>}
      </Tarjeta>

      <Tabla>
        <thead><tr><Th>Descripción</Th><Th>Cantidad</Th><Th className="text-right">Precio</Th><Th className="text-right">Subtotal</Th></tr></thead>
        <tbody>
          {doc.documentos_venta_lineas.map((l: { descripcion: string; cantidad: number; precio_neto: number; subtotal: number }, i: number) => (
            <Tr key={i}><Td>{l.descripcion}</Td><Td>{l.cantidad}</Td><Td className="text-right">{formatearCLP(l.precio_neto)}</Td><Td className="text-right">{formatearCLP(l.subtotal)}</Td></Tr>
          ))}
        </tbody>
      </Tabla>

      <div className="mt-4 flex flex-col items-end gap-1 text-sm">
        <div>Neto: <strong>{formatearCLP(doc.neto)}</strong></div>
        {doc.exento > 0 && <div>Exento: <strong>{formatearCLP(doc.exento)}</strong></div>}
        <div>IVA: <strong>{formatearCLP(doc.iva)}</strong></div>
        <div className="text-lg">Total: <strong>{formatearCLP(doc.total)}</strong></div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {emitible && (
          <>
            <form action={emitirDocumento}>
              <input type="hidden" name="id" value={doc.id} /><input type="hidden" name="tipo" value="factura" />
              <Boton type="submit">Emitir factura</Boton>
            </form>
            <form action={emitirDocumento}>
              <input type="hidden" name="id" value={doc.id} /><input type="hidden" name="tipo" value="boleta" />
              <Boton variante="secundario" type="submit">Emitir boleta</Boton>
            </form>
          </>
        )}
        {doc.estado === 'emitido' && doc.tipo !== 'nota_credito' && (
          <>
            <a href={`/ventas/${doc.id}/pdf`} target="_blank" rel="noreferrer"><Boton variante="secundario" type="button">Descargar PDF</Boton></a>
            <form action={emitirNotaCredito}>
              <input type="hidden" name="referencia_id" value={doc.id} /><input type="hidden" name="razon" value="Anula documento" />
              <Boton variante="peligro" type="submit">Anular con nota de crédito</Boton>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Ruta del PDF**

`apps/erp/app/ventas/[id]/pdf/route.ts`:

```ts
import { crearClienteServidor } from '@suite/auth/server'
import { obtenerEmpresaActiva } from '../../../../lib/empresa-activa'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return new Response('No autorizado', { status: 401 })
  const supabase = await crearClienteServidor()
  const { data: doc } = await supabase
    .from('documentos_venta').select('pdf_ruta').eq('id', id).eq('empresa_id', activa.id).single()
  if (!doc?.pdf_ruta) return new Response('PDF no disponible', { status: 404 })
  // v1: pdf_ruta guarda el PDF en base64 devuelto por el proveedor (mock/real).
  const pdf = Buffer.from(doc.pdf_ruta, 'base64')
  return new Response(pdf, {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="documento-${id}.pdf"` },
  })
}
```

- [ ] **Step 5: Verificar**

Run: `pnpm --filter erp build`
Expected: build sin errores.

- [ ] **Step 6: Commit**

```bash
git add apps/erp/app/ventas/page.tsx apps/erp/app/ventas/[id] apps/erp/app/ventas/emitir.ts apps/erp/lib/emision.ts
git commit -m "feat(erp): emision de DTE (mock), lista, detalle, nota de credito y PDF"
```

---

### Task 10: Cola de reintentos (función programada)

**Files:**
- Create: `supabase/migrations/00000000000006_reintentos.sql` (siguiente correlativo libre)

**Interfaces:**
- Consumes: `documentos_venta` (estado `pendiente_envio`).
- Produces: función `app.documentos_pendientes(p_empresa uuid) returns setof documentos_venta` que lista los reintentables, e infraestructura para reintento. En v1 el reintento se dispara desde la UI (botón "Reintentar" ya cubierto por `emitirDocumento` sobre un `pendiente_envio`); el cron real (pg_cron/Vercel Cron) se documenta pero se activa en producción.

- [ ] **Step 1: Escribir la migración**

`supabase/migrations/00000000000006_reintentos.sql`:

```sql
-- Soporte de la cola de reintentos de emisión DTE.
-- v1: los documentos en 'pendiente_envio' se reintentan desde la UI con emitirDocumento
-- (que es idempotente porque no re-reserva folio si ya lo tiene). El cron programado se
-- activa en producción con pg_cron o Vercel Cron llamando a un endpoint que recorre pendientes.

create or replace function app.documentos_pendientes(p_empresa uuid)
returns setof public.documentos_venta
language sql stable security definer
set search_path = public
as $$
  select * from documentos_venta
  where empresa_id = p_empresa and estado = 'pendiente_envio'
  order by creado_en
$$;

revoke execute on function app.documentos_pendientes(uuid) from anon, public;
grant execute on function app.documentos_pendientes(uuid) to authenticated;
```

- [ ] **Step 2: Aplicar y verificar**

Run: `pnpm supabase db reset && pnpm supabase test db`
Expected: aplica; los 31 asserts pgTAP siguen verdes.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/00000000000006_reintentos.sql
git commit -m "feat(db): soporte de cola de reintentos de emision DTE"
```

---

### Task 11: Regenerar tipos + CI verde end-to-end

**Files:**
- Modify: `packages/db/src/types.ts` (regenerado con RPCs nuevas)

**Interfaces:**
- Produces: tipos con `crear_documento_venta`, `tomar_folio`, `documentos_pendientes`.

- [ ] **Step 1: Regenerar tipos**

Run: `pnpm --filter @suite/db gen`
Expected: `types.ts` incluye las funciones RPC nuevas.

Run: `pnpm tsc --noEmit -p packages/db/tsconfig.json`
Expected: sin errores.

- [ ] **Step 2: Pipeline completo local**

Run: `pnpm test`
Expected: `@suite/core` (rut, iva, maestros, csv, ventas) + `@suite/auth` + `@suite/dte` (mock, cripto) verdes.

Run: `pnpm supabase test db`
Expected: 31 asserts pgTAP verdes.

Run: `pnpm build --concurrency=1`
Expected: 3 apps compilan.

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/types.ts
git commit -m "feat(db): tipos regenerados con RPCs de ventas y reintentos"
```

---

### Task 12: Verificación integral (mock) + E2E del ciclo de venta

**Files:**
- Ninguno de producción (task de verificación). Scripts temporales en el scratchpad, no en el repo.

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: evidencia de que el ciclo completo funciona contra el mock, con datos aislados por empresa.

- [ ] **Step 1: Flujo E2E a nivel API (script en scratchpad)**

Con Supabase local corriendo y `DTE_ENCRYPTION_KEY` de prueba, escribir un script Node en el scratchpad que, usando `@supabase/supabase-js` con el anon key: registra una organización, carga un CAF de factura (rango 1-5), guarda un certificado de prueba (bytes cualquiera + password), crea una nota de venta con 1 producto, y llama a la Server Action de emisión **a través de la app** (arrancar `pnpm --filter erp dev` y hacer el POST del formulario con cookies de sesión) — o, si es más simple, invocar directamente `crear_documento_venta` + `tomar_folio` + `MockDTE.emitirDTE` replicando el flujo, verificando: folio reservado = 1, documento pasa a `emitido`, `track_id = 'mock-1'`, `pdf_ruta` no nulo. Luego emitir una nota de crédito referenciando la factura y verificar `documento_referencia_id`.

- [ ] **Step 2: Prueba de la cola de reintentos**

Emitir hacia un cliente con RUT `66666666-6` (el RUT de falla del mock) → el documento queda `pendiente_envio` con `error_emision` no nulo y sin folio consumido de más. Reintentar (segunda emisión del mismo documento con un cliente válido) → pasa a `emitido` reutilizando el folio ya reservado (idempotencia).

- [ ] **Step 3: Verificación de aislamiento**

Confirmar (vía RLS con dos usuarios de organizaciones distintas) que los documentos de una empresa no son visibles ni emitibles desde otra. Reusar el patrón del pgTAP de Task 5 como referencia; aquí basta un chequeo a nivel de app.

- [ ] **Step 4: Limpieza y reporte**

Borrar los datos de prueba (orden FK-safe: líneas → documentos → folios_caf → clientes/productos → suscripciones/miembros/empresas/organizaciones → auth user). Verificar 0 filas. Documentar el resultado del E2E en el reporte de la task (fuera del repo).

- [ ] **Step 5: Commit (solo si hubo ajustes de código)**

Si la verificación no requirió cambios de producción, no hay commit. Si detectó y corrigió un defecto, commitearlo con mensaje descriptivo.

---

### Task 13: `@suite/dte` — integración real con SimpleAPI (GATED en credenciales)

**⚠️ Esta task requiere que el usuario tenga:** una cuenta SimpleAPI (plan gratis), su API key de certificación, un certificado digital de prueba y un CAF de certificación del SII. Sin esas credenciales, NO se puede ejecutar ni verificar — se ejecuta cuando el usuario las consiga. Hasta entonces, el sistema opera con `MockDTE` (todo lo anterior funciona).

**Files:**
- Create: `packages/dte/src/simpleapi.ts`, `packages/dte/src/simpleapi.contrato.test.ts` (test de contra sandbox, skippeable sin credenciales)
- Modify: `packages/dte/src/index.ts` (conectar `SimpleApiDTE` en `proveedorPorAmbiente`)

**Interfaces:**
- Consumes: `ProveedorDTE`, tipos de `@suite/dte`.
- Produces: `class SimpleApiDTE implements ProveedorDTE` que traduce la interfaz al formato REST real de SimpleAPI.

- [ ] **Step 1: Leer la documentación viva de SimpleAPI**

Abrir https://documentacion.simpleapi.cl/ y la colección Postman que ofrecen. Anotar: URL base de certificación, header de autenticación (API key), endpoint de emisión, cómo se envían el certificado (.pfx base64/multipart) y el CAF, estructura JSON del DTE (emisor/receptor/detalle/totales), y qué devuelve (XML timbrado, PDF, folio, track id).

- [ ] **Step 2: Implementar `SimpleApiDTE`**

Implementar `emitirDTE`, `consultarEstado`, `anularConNotaCredito` traduciendo `SolicitudEmision` (interfaz nuestra) al formato de SimpleAPI y mapeando su respuesta a `ResultadoEmision`. Todo error de red/HTTP se traduce a `{ estado: 'pendiente_envio', error }` para que la cola de reintentos lo tome. Mantener la interfaz idéntica — el resto del sistema no cambia.

- [ ] **Step 3: Test de contrato contra el sandbox**

`simpleapi.contrato.test.ts`: si `process.env.SIMPLEAPI_TEST_KEY` está presente, emite una factura de prueba contra el ambiente de certificación y verifica que devuelve folio + track id + XML; si no está, el test se `skip`ea (para que CI sin credenciales no falle). Documentar cómo correrlo.

- [ ] **Step 4: Conectar el proveedor real**

En `packages/dte/src/index.ts`, cambiar `proveedorPorAmbiente` para devolver `new SimpleApiDTE(ambiente)` cuando `ambiente` sea `certificacion`/`produccion` y haya credenciales; mantener `MockDTE` como fallback para desarrollo local sin credenciales (ej. `DTE_AMBIENTE=mock`).

- [ ] **Step 5: Verificar y commit**

Run: `pnpm --filter @suite/dte test` (el test de contrato se skippea sin credenciales; los de mock/cripto pasan).
Run: `pnpm build --concurrency=1`
Expected: verde.

```bash
git add packages/dte/src/simpleapi.ts packages/dte/src/simpleapi.contrato.test.ts packages/dte/src/index.ts
git commit -m "feat(dte): integracion real con SimpleAPI (ambiente certificacion)"
```

---

## Verificación final del plan

Al completar Tasks 1-12 (Task 13 gated en credenciales del usuario):

- `pnpm test` — core (rut, iva, maestros, csv, ventas), auth, dte (mock, cripto) verdes.
- `pnpm supabase test db` — 31 asserts pgTAP verdes.
- `pnpm build` — 3 apps compilan.
- Ciclo completo contra el mock: configurar emisor + certificado + CAF → nueva venta → emitir factura (folio reservado, estado emitido, PDF) → nota de crédito referenciando la factura → cola de reintentos ante falla simulada.
- Criterio de éxito del Plan 3 (§10 del spec) cumplido a nivel de máquina; la emisión real ante el SII de certificación se cierra en Task 13 cuando el usuario tenga credenciales SimpleAPI.
