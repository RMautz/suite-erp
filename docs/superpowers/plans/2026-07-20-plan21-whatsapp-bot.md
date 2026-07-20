# Plan 21 — Chatbot de WhatsApp (consultas IA + cobranza saliente) · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute this plan task-by-task with fresh subagents in the current session (or superpowers:executing-plans in a separate session). Cada task es autocontenida: Files, Interfaces, Steps con el código completo y verificación con salida esperada. Marca los checkboxes al completar cada step. Las tasks se ejecutan EN ORDEN (1→9): T3 (migración+tipos) precede a T4 (pgTAP) y T5-T8 (usan las tablas/RPCs); T1-T2 (packages) preceden a T5-T8 (los importan).

**Spec:** `docs/superpowers/specs/2026-07-20-plan21-whatsapp-bot-design.md` (aprobado por el usuario).

**Goal:** El "ERP en el bolsillo": el dueño/admin conversa con su ERP por WhatsApp (motor IA con 7 herramientas deterministas; MockMotor scriptado hoy, ClaudeMotor listo y probado) y la pyme envía recordatorios de cobranza por WhatsApp a sus clientes; vinculación segura por código de 6 dígitos, log inmutable, simulador local `/mock-whatsapp`. Todo funciona HOY con mocks; 2 env (`MOTOR_BOT=claude` + key, `PROVEEDOR_WHATSAPP=cloud` + 4 vars) encienden lo real sin reescribir nada.

**Architecture:** Dos packages nuevos espejo de `packages/correo` (interface + mock globalThis + adaptador real con fetch + selector fail-closed): `@suite/whatsapp` (proveedor de mensajería + firma HMAC + plantilla cobranza) y `@suite/bot` (MotorBot con MockMotor/ClaudeMotor sobre `HerramientasBot` tipadas, sin dependencia de supabase). Migración 0028 (vínculos con RPCs security definer + log inmutable patrón `correos_enviados`) → pgTAP archivo 21 → webhook nunca-lanza en `app/api/webhooks/whatsapp/` (hereda la exclusión del middleware) + `lib/bot-herramientas.ts` (admin client, TODO filtrado por la empresa del vínculo) → UI (Configuración, /cobranza, /mock-whatsapp) → seed + env + E2E.

**Tech Stack:** Postgres/Supabase local (plpgsql security definer, RLS, grants, pgTAP), monorepo pnpm TypeScript (Next.js 15 App Router × 3 apps, vitest 3, packages sin build step), WhatsApp Business Cloud API (adaptador fetch), Anthropic Messages API vía fetch inyectable (SIN SDK — decisión del spec), Playwright MCP para el E2E manual. Windows/PowerShell 5.1 (separar comandos con `;`, nunca `&&`); byte-scans con Git Bash.

## Global Constraints

- **Baselines verdes que TODA task debe mantener:** pgTAP **435 asserts / 20 archivos** (`npx supabase test db`), unit **229** (`pnpm test`), **3 builds** (`pnpm build --concurrency=1`).
- **Conteos contractuales finales:** pgTAP **435 + 23 = 458 asserts en 21 archivos** (`whatsapp.test.sql` con `plan(23)`); unit **229 + 28 = 257** (14 en `@suite/whatsapp`, 14 en `@suite/bot`); 3 builds verdes.
- **Env nuevas (todas fail-closed):** `PROVEEDOR_WHATSAPP=mock|cloud` (cloud exige `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`); `MOTOR_BOT=mock|claude` (claude exige `ANTHROPIC_API_KEY`; modelo por `MOTOR_BOT_MODELO`, default `claude-sonnet-5`). PROHIBIDO `?? 'mock'`.
- **Mensajes byte-exactos NUEVOS de este plan** (es-CL, con tildes):
  - RPCs: `Tu rol no permite gestionar WhatsApp` · `Teléfono no válido: usa formato internacional +56...` · `Código incorrecto o expirado` · `Ese teléfono ya está vinculado a otra cuenta` · `El vínculo no existe` (semaforo_whatsapp reusa `Tu rol no permite ver la revisión` de revision_periodo).
  - Selectores: `WhatsApp no está configurado` (whatsapp) · `El motor del bot no está configurado` (bot).
  - Actions/webhook: `El cliente no tiene teléfono registrado` · `Ya se envió un recordatorio por WhatsApp hace menos de 3 días` · `Tu rol no permite enviar WhatsApp` · `No se pudo enviar el WhatsApp. Intenta de nuevo.` · `El WhatsApp se envió pero no se pudo registrar el envío.` · `El teléfono del cliente no está en formato internacional (+56...)`.
  - Bot: DISCULPA = `Perdona, tuve un problema para responderte. Intenta de nuevo en unos minutos.` · AYUDA = `No te entendí. Escribe "menú" para ver lo que puedo hacer.` · SIN_VINCULO = `Este número no está vinculado a ninguna empresa. El dueño o admin puede vincularlo en el ERP: Configuración → WhatsApp.`
- **Teléfonos:** E.164 estricto `^\+[1-9][0-9]{7,14}$` — mismo regex en el CHECK SQL (0028) y en `esTelefonoE164` (TS). Meta manda `from` SIN `+`; el webhook normaliza con `'+' + from`.
- **Unique parcial de plataforma:** un teléfono VERIFICADO activo en toda la plataforma: `(telefono) where verificado_en is not null and activo`.
- **Log inmutable:** `whatsapp_mensajes` con grants `select, insert` a authenticated (SIN update/delete — el grant es el candado, patrón `correos_enviados` 0020); `whatsapp_vinculos` con grant SOLO `select` (escritura únicamente vía RPCs security definer, patrón `finiquitos` 0027).
- **Webhook:** POST **nunca-lanza, 200 SIEMPRE** salvo errores de BD transitorios (500 para que Meta reintente); en `cloud` firma `X-Hub-Signature-256` obligatoria (inválida → 200 silencioso); en `mock` bypass de firma (el simulador postea sin firmar). Vive en `app/api/webhooks/whatsapp/route.ts` — decisión deliberada distinta del spec (§5 decía `/api/whatsapp`): bajo `api/webhooks` hereda la exclusión del matcher del middleware sin tocarlo.
- **Bytes:** todo archivo nuevo/modificado UTF-8 SIN BOM (usar Write/Edit tools; verificación `grep -c $'\xEF\xBB\xBF' <archivos>` en Git Bash → 0 por archivo). Comentarios SQL en ASCII sin tildes; strings de usuario CON tildes.
- Commits por task, mensajes en español, coautoría exacta: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## Contexto verificado (por el ensamblador — no repetir esta investigación)

- Última migración: `00000000000027_finiquitos.sql` → la nueva es `00000000000028_whatsapp.sql`. pgTAP: 20 archivos en `supabase/tests/database/`, suma plan() = 435.
- Helpers de autorización existentes: `app.mis_empresas()` y `app.tiene_rol_en_empresa(emp uuid, roles text[])` (0003, security definer).
- `revision_periodo(p_empresa uuid, p_anio integer, p_mes integer) returns jsonb` (última re-create en 0027:551) — guard `array['dueno','admin','contador']` vía `auth.uid()`, payload `{ periodo: {anio, mes}, estado: 'critica'|'media'|'ok', observaciones: [{regla, severidad, titulo, detalle, enlace_tipo, enlace_id}] }` (tipado en `apps/erp/app/contabilidad/revision/reglas.ts`). Con service_role `auth.uid()` es null → el guard lanza: por eso la 0028 agrega el wrapper `semaforo_whatsapp` que impersona con `set_config('request.jwt.claims', ...)` (mismo mecanismo que usan los tests pgTAP).
- `documentos_venta.estado`: `('borrador','pendiente_envio','emitido','rechazado')`; ventas reales = `estado='emitido'` y `tipo in ('factura','boleta')`. Vencimiento/saldo salen de la VIEW `saldos_documentos` (documento_id, tipo, folio, cliente_id, cliente_razon_social, total, saldo, fecha_vencimiento, emitido_en).
- `stock_actual` VIEW (0008:58): `(empresa_id, producto_id, bodega_id, cantidad)` — sin nombre de producto (join con `productos`).
- `clientes.telefono` existe (`string | null`, texto libre — el seed hoy usa formatos con espacios).
- `apps/erp/middleware.ts` matcher: `['/((?!_next/static|_next/image|favicon.ico|api/webhooks|api/pagos-suscripcion|mock-pago).*)']` — `api/webhooks/whatsapp` ya queda excluido; `/mock-whatsapp` queda CON sesión (como `/mock-correo`).
- `apps/erp/app/correo/acciones.ts` (368 líneas): helpers module-private `proveedorConfigurado` (l.29-37), `guardCorreo` (l.43-65), `enviarYRegistrar` (l.70-95), `hace3Dias` (l.97-100), action `enviarRecordatorio` (l.247-303), masivo `enviarRecordatorios` (l.305-367). T5 extrae núcleo compartido a `lib/recordatorio.ts`.
- `apps/erp/app/cobranza/page.tsx`: botón por fila en l.144-156 (`BotonRecordar` dentro del `<div className="flex items-center justify-end gap-2">`), sección "Recordatorios enviados" en l.192-209. `apps/erp/app/cobranza/acciones.ts` existe (registrarPago/anularPago/aplicarAnticipoManual) — la action WhatsApp va en archivo NUEVO `acciones-whatsapp.ts` (evita mezclar imports de correo en un archivo que no los usa).
- Seed (`scripts/seed-demo.mjs`): clientes demo `Transportes Cliente Ltda` (rut 762222221) y `Comercial del Sur Ltda` (rut 772506309); `userCli` queda con sesión del dueño demo desde la sección 2; `admin` = service_role; helper `die(m, e)`; sección 23 (vacaciones) es la última antes del RESUMEN. El id del dueño demo NO está en variable — se obtiene con `userCli.auth.getUser()`.
- Patrón package: `main`/`types` → `./src/index.ts` (sin build), tsconfig `{ "extends": "../../tsconfig.base.json", "include": ["src"] }`, vitest co-located `src/*.test.ts`, script `"test": "vitest run"`. Apps declaran `"@suite/x": "workspace:*"` + `pnpm install`.
- NO existe SDK de Anthropic en el repo (decisión del spec: fetch directo a `api.anthropic.com/v1/messages`). NO existe Playwright como harness (E2E = checklist manual con Playwright MCP).
- RUTs de fixtures pgTAP nuevos SIN colisión, válidos mod-11: `769910026` (org/empresa A) y `769910034` (org/empresa B) — los existentes usan 769910018 y otros.

---

### Task 1: `packages/whatsapp` — proveedor de mensajería (mock + cloud + firma + plantilla + selector)

Baseline verde que esta task DEBE mantener: pgTAP 435/20, unit 229 → **243** al cerrar (14 nuevos), 3 builds.

**Files:**
- Create: `packages/whatsapp/package.json`
- Create: `packages/whatsapp/tsconfig.json`
- Create: `packages/whatsapp/vitest.config.ts`
- Create: `packages/whatsapp/src/tipos.ts`
- Create: `packages/whatsapp/src/telefono.ts`
- Create: `packages/whatsapp/src/mock.ts`
- Create: `packages/whatsapp/src/cloud.ts`
- Create: `packages/whatsapp/src/firma.ts`
- Create: `packages/whatsapp/src/plantillas.ts`
- Create: `packages/whatsapp/src/seleccionar.ts`
- Create: `packages/whatsapp/src/index.ts`
- Test: `packages/whatsapp/src/mock.test.ts`, `telefono.test.ts`, `cloud.test.ts`, `firma.test.ts`, `plantillas.test.ts`, `seleccionar.test.ts`

**Interfaces:**
- Produces (las consumen T5-T9): `ProveedorWhatsApp { enviarTexto(telefono: string, texto: string, plantilla?: string): Promise<void> }` · `WhatsAppMock { id, telefono, texto }` · `MockWhatsApp` · `whatsappMockEnviados(): WhatsAppMock[]` · `limpiarWhatsappMock(): void` · `WhatsAppCloudAPI` · `verificarFirma(cuerpo: string, firma: string | null, appSecret: string): boolean` · `esTelefonoE164(telefono: string): boolean` · `plantillaRecordatorioWhatsApp(datos: DatosRecordatorioWhatsApp): string` · `whatsappPorAmbiente(perilla, token, phoneId, verifyToken, appSecret): ProveedorWhatsApp` (fail-closed).
- Consumes: `formatearCLP` de `@suite/core` (solo plantillas).

- [ ] **Step 1: Scaffolding del package**

`packages/whatsapp/package.json`:
```json
{
  "name": "@suite/whatsapp",
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

`packages/whatsapp/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

`packages/whatsapp/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { environment: 'node' },
})
```

- [ ] **Step 2: Tipos y helper E.164**

`packages/whatsapp/src/tipos.ts`:
```ts
// Un envio de WhatsApp: telefono E.164 + texto plano. `plantilla` (opcional) es el
// nombre de la plantilla HSM aprobada por Meta para mensajes business-initiated —
// va en la interface desde ya (spec §2) pero AMBOS adaptadores la ignoran hoy: las
// HSM reales van con la credencial #15 (fuera de alcance §9); dentro de la ventana
// de 24 h el texto libre es valido.
export interface ProveedorWhatsApp {
  enviarTexto(telefono: string, texto: string, plantilla?: string): Promise<void>
}

// Mensaje guardado por MockWhatsApp (lo lee el simulador /mock-whatsapp).
export interface WhatsAppMock {
  id: string
  telefono: string
  texto: string
}
```

`packages/whatsapp/src/telefono.ts`:
```ts
// E.164 estricto — MISMO regex que el CHECK de whatsapp_vinculos (migracion 0028):
// '+', primer digito 1-9, 8 a 15 digitos en total.
const RE_E164 = /^\+[1-9][0-9]{7,14}$/

export function esTelefonoE164(telefono: string): boolean {
  return RE_E164.test(telefono)
}
```

- [ ] **Step 3: MockWhatsApp (store en globalThis, patrón MockCorreo P10)**

`packages/whatsapp/src/mock.ts`:
```ts
import { randomUUID } from 'node:crypto'
import type { ProveedorWhatsApp, WhatsAppMock } from './tipos'

// Store a nivel de modulo respaldado en globalThis (patron MockCorreo P10 / leccion
// Plan 13): en `next dev` el simulador /mock-whatsapp y el webhook son bundles
// distintos que el bundler recompila con SU PROPIA instancia del modulo; globalThis
// sobrevive porque es el mismo proceso Node. Solo dev/mock.
interface GlobalConStoreWhatsApp {
  __suiteWhatsappMockStore?: WhatsAppMock[]
}
const g = globalThis as unknown as GlobalConStoreWhatsApp
const STORE: WhatsAppMock[] = (g.__suiteWhatsappMockStore ??= [])

// Proveedor simulado: "envia" guardando el mensaje en el store; el simulador lo lee
// con whatsappMockEnviados; los tests lo vacian con limpiarWhatsappMock.
export class MockWhatsApp implements ProveedorWhatsApp {
  async enviarTexto(telefono: string, texto: string): Promise<void> {
    STORE.push({ id: 'mock-wa-' + randomUUID(), telefono, texto })
  }
}

export function whatsappMockEnviados(): WhatsAppMock[] {
  return STORE
}

export function limpiarWhatsappMock(): void {
  STORE.length = 0
}
```

- [ ] **Step 4: Adaptador cloud + firma HMAC**

`packages/whatsapp/src/cloud.ts`:
```ts
import type { ProveedorWhatsApp } from './tipos'

// Adaptador de WhatsApp Business Cloud API (Meta). Credenciales por constructor
// desde env server-side; el token viaja en Authorization: Bearer y JAMAS se loguea
// (solo error.message, espejo de ResendCorreo P10). El parametro `plantilla` se
// ignora hoy: envio por HSM cuando exista la credencial #15 (spec §9).
export class WhatsAppCloudAPI implements ProveedorWhatsApp {
  constructor(
    private readonly token: string,
    private readonly phoneId: string,
  ) {}

  async enviarTexto(telefono: string, texto: string): Promise<void> {
    try {
      const res = await fetch(`https://graph.facebook.com/v20.0/${this.phoneId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: telefono,
          type: 'text',
          text: { body: texto },
        }),
      })
      if (!res.ok) throw new Error(`WhatsApp Cloud respondió ${res.status}`)
    } catch (error) {
      // Solo el mensaje saneado: jamas el token, el Bearer ni el body.
      console.error('WhatsApp:', error instanceof Error ? error.message : 'error desconocido')
      throw error
    }
  }
}
```

`packages/whatsapp/src/firma.ts`:
```ts
import { createHmac, timingSafeEqual } from 'node:crypto'

// Verificacion de la firma X-Hub-Signature-256 de Meta: 'sha256=' + hex del
// HMAC-SHA256(appSecret, cuerpo crudo). Helper PURO (spec §2): el webhook le pasa el
// body como string y el header tal cual llego. timingSafeEqual evita fuga de tiempo;
// largo distinto -> false directo (timingSafeEqual exige buffers del mismo largo).
export function verificarFirma(cuerpo: string, firma: string | null, appSecret: string): boolean {
  if (!firma || !firma.startsWith('sha256=')) return false
  const esperada = createHmac('sha256', appSecret).update(cuerpo, 'utf8').digest('hex')
  const recibida = firma.slice('sha256='.length)
  if (recibida.length !== esperada.length) return false
  return timingSafeEqual(Buffer.from(recibida, 'utf8'), Buffer.from(esperada, 'utf8'))
}
```

- [ ] **Step 5: Plantilla de cobranza + selector fail-closed**

`packages/whatsapp/src/plantillas.ts`:
```ts
import { formatearCLP } from '@suite/core'

// Recordatorio de cobranza por WhatsApp (spec §6): texto plano es-CL. La fecha llega
// YA formateada es-CL (la action la pasa por toLocaleDateString('es-CL'), mismo
// contrato que plantillaRecordatorio de @suite/correo).
export interface DatosRecordatorioWhatsApp {
  empresaRazonSocial: string
  clienteRazonSocial: string
  tipo: 'factura' | 'boleta'
  folio: number
  saldo: number
  fechaVencimiento: string
}

export function plantillaRecordatorioWhatsApp(datos: DatosRecordatorioWhatsApp): string {
  const etiqueta = datos.tipo === 'boleta' ? 'Boleta' : 'Factura'
  return (
    `Estimado/a ${datos.clienteRazonSocial}: le recordamos que su ${etiqueta} N° ${datos.folio} ` +
    `de ${datos.empresaRazonSocial} venció el ${datos.fechaVencimiento} y registra un saldo ` +
    `pendiente de ${formatearCLP(datos.saldo)}. Agradeceremos regularizar el pago.`
  )
}
```

`packages/whatsapp/src/seleccionar.ts`:
```ts
import { MockWhatsApp } from './mock'
import { WhatsAppCloudAPI } from './cloud'
import type { ProveedorWhatsApp } from './tipos'

// Seleccion por env FAIL-CLOSED (patron correoPorAmbiente P10): 'mock' -> MockWhatsApp,
// 'cloud' -> WhatsAppCloudAPI y EXIGE las 4 variables (spec §2) — token y phoneId los
// usa el adaptador; verifyToken y appSecret los consume el webhook, pero un cloud a
// medias no debe arrancar. Cualquier otro valor o ausente -> THROW. Sin `?? 'mock'`.
const ERROR_NO_CONFIGURADO = 'WhatsApp no está configurado'

export function whatsappPorAmbiente(
  perilla: string | undefined,
  token: string | undefined,
  phoneId: string | undefined,
  verifyToken: string | undefined,
  appSecret: string | undefined,
): ProveedorWhatsApp {
  if (perilla === 'mock') return new MockWhatsApp()
  if (perilla === 'cloud') {
    if (!token || !phoneId || !verifyToken || !appSecret) throw new Error(ERROR_NO_CONFIGURADO)
    return new WhatsAppCloudAPI(token, phoneId)
  }
  throw new Error(ERROR_NO_CONFIGURADO)
}
```

`packages/whatsapp/src/index.ts`:
```ts
export type { ProveedorWhatsApp, WhatsAppMock } from './tipos'
export type { DatosRecordatorioWhatsApp } from './plantillas'
export { esTelefonoE164 } from './telefono'
export { MockWhatsApp, whatsappMockEnviados, limpiarWhatsappMock } from './mock'
export { WhatsAppCloudAPI } from './cloud'
export { verificarFirma } from './firma'
export { plantillaRecordatorioWhatsApp } from './plantillas'
export { whatsappPorAmbiente } from './seleccionar'
```

- [ ] **Step 6: Los 6 archivos de test (14 tests) — escribirlos y verlos FALLAR no aplica (package nuevo: se escriben junto al código; el ciclo TDD real es correr `vitest` al final del step y ver 14 PASS)**

`packages/whatsapp/src/mock.test.ts` (2 tests):
```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { MockWhatsApp, whatsappMockEnviados, limpiarWhatsappMock } from './mock'

// El store vive en globalThis (sobrevive entre tests): se limpia antes de cada uno.
beforeEach(() => {
  limpiarWhatsappMock()
})

describe('MockWhatsApp', () => {
  it('enviarTexto guarda el mensaje en el store con id mock', async () => {
    await new MockWhatsApp().enviarTexto('+56912345678', 'hola')
    const enviados = whatsappMockEnviados()
    expect(enviados).toHaveLength(1)
    expect(enviados[0]?.id).toMatch(/^mock-wa-/)
    expect(enviados[0]?.telefono).toBe('+56912345678')
    expect(enviados[0]?.texto).toBe('hola')
  })

  it('limpiarWhatsappMock vacía el store', async () => {
    await new MockWhatsApp().enviarTexto('+56912345678', 'hola')
    expect(whatsappMockEnviados()).toHaveLength(1)
    limpiarWhatsappMock()
    expect(whatsappMockEnviados()).toHaveLength(0)
  })
})
```

`packages/whatsapp/src/telefono.test.ts` (2 tests):
```ts
import { describe, expect, it } from 'vitest'
import { esTelefonoE164 } from './telefono'

describe('esTelefonoE164', () => {
  it('acepta E.164 válidos', () => {
    expect(esTelefonoE164('+56912345678')).toBe(true)
    expect(esTelefonoE164('+12025550123')).toBe(true)
    expect(esTelefonoE164('+549112345678')).toBe(true)
  })

  it('rechaza formatos inválidos (sin +, con espacios, cero inicial, corto, letras)', () => {
    expect(esTelefonoE164('56912345678')).toBe(false)
    expect(esTelefonoE164('+56 9 1234 5678')).toBe(false)
    expect(esTelefonoE164('+056912345678')).toBe(false)
    expect(esTelefonoE164('+5691234')).toBe(false)
    expect(esTelefonoE164('+56abc45678')).toBe(false)
    expect(esTelefonoE164('')).toBe(false)
  })
})
```

`packages/whatsapp/src/cloud.test.ts` (3 tests, molde `resend.test.ts`):
```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WhatsAppCloudAPI } from './cloud'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('WhatsAppCloudAPI.enviarTexto', () => {
  it('hace POST a graph.facebook.com con Bearer y el body de texto', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await new WhatsAppCloudAPI('TOKEN-META', 'PHONE-1').enviarTexto('+56912345678', 'hola')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { method: string; headers: Record<string, string>; body: string },
    ]
    expect(url).toBe('https://graph.facebook.com/v20.0/PHONE-1/messages')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer TOKEN-META')
    const body = JSON.parse(init.body)
    expect(body.messaging_product).toBe('whatsapp')
    expect(body.to).toBe('+56912345678')
    expect(body.type).toBe('text')
    expect(body.text.body).toBe('hola')
  })

  it('no filtra el token ni el Bearer en los logs', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(new WhatsAppCloudAPI('TOKEN-SUPER-SECRETO', 'PHONE-1').enviarTexto('+56912345678', 'x')).rejects.toThrow()

    const loggeado = errSpy.mock.calls
      .flat()
      .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
      .join(' ')
    expect(loggeado).toContain('500')
    expect(loggeado).not.toContain('TOKEN-SUPER-SECRETO')
    expect(loggeado).not.toContain('Bearer')
  })

  it('lanza limpio ante una respuesta no-ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401 })))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(new WhatsAppCloudAPI('T', 'P').enviarTexto('+56912345678', 'x')).rejects.toThrow('WhatsApp Cloud respondió 401')
  })
})
```

`packages/whatsapp/src/firma.test.ts` (3 tests):
```ts
import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verificarFirma } from './firma'

// Vector calculado con node:crypto directamente (mismo algoritmo que usa Meta):
// valida el contrato del prefijo 'sha256=' y la comparacion, no re-implementa HMAC.
function firmar(cuerpo: string, secreto: string): string {
  return 'sha256=' + createHmac('sha256', secreto).update(cuerpo, 'utf8').digest('hex')
}

describe('verificarFirma', () => {
  it('acepta la firma HMAC-SHA256 correcta del cuerpo crudo', () => {
    const cuerpo = '{"entry":[{"changes":[]}]}'
    expect(verificarFirma(cuerpo, firmar(cuerpo, 'app-secret'), 'app-secret')).toBe(true)
  })

  it('rechaza firma de otro secreto y cuerpo alterado', () => {
    const cuerpo = '{"entry":[]}'
    expect(verificarFirma(cuerpo, firmar(cuerpo, 'otro-secreto'), 'app-secret')).toBe(false)
    expect(verificarFirma(cuerpo + ' ', firmar(cuerpo, 'app-secret'), 'app-secret')).toBe(false)
  })

  it('rechaza header ausente, sin prefijo sha256= o de largo incorrecto', () => {
    expect(verificarFirma('x', null, 's')).toBe(false)
    expect(verificarFirma('x', 'md5=abc', 's')).toBe(false)
    expect(verificarFirma('x', 'sha256=abc', 's')).toBe(false)
  })
})
```

`packages/whatsapp/src/plantillas.test.ts` (2 tests):
```ts
import { describe, expect, it } from 'vitest'
import { plantillaRecordatorioWhatsApp } from './plantillas'

describe('plantillaRecordatorioWhatsApp', () => {
  it('arma el texto es-CL de factura con CLP formateado', () => {
    const texto = plantillaRecordatorioWhatsApp({
      empresaRazonSocial: 'Demo Transportes SpA',
      clienteRazonSocial: 'Comercial del Sur Ltda',
      tipo: 'factura',
      folio: 1043,
      saldo: 1190000,
      fechaVencimiento: '15-06-2026',
    })
    expect(texto).toBe(
      'Estimado/a Comercial del Sur Ltda: le recordamos que su Factura N° 1043 ' +
        'de Demo Transportes SpA venció el 15-06-2026 y registra un saldo ' +
        'pendiente de $1.190.000. Agradeceremos regularizar el pago.',
    )
  })

  it('usa la etiqueta Boleta para boletas', () => {
    const texto = plantillaRecordatorioWhatsApp({
      empresaRazonSocial: 'E',
      clienteRazonSocial: 'C',
      tipo: 'boleta',
      folio: 7,
      saldo: 1000,
      fechaVencimiento: '01-01-2026',
    })
    expect(texto).toContain('su Boleta N° 7')
  })
})
```

Nota: si `formatearCLP(1190000)` del repo no produce exactamente `$1.190.000`, ajustar el literal esperado al output real de `formatearCLP` (es la única fuente de verdad) — NO cambiar la plantilla.

`packages/whatsapp/src/seleccionar.test.ts` (2 tests):
```ts
import { describe, expect, it } from 'vitest'
import { MockWhatsApp } from './mock'
import { WhatsAppCloudAPI } from './cloud'
import { whatsappPorAmbiente } from './seleccionar'

describe('whatsappPorAmbiente (fail-closed)', () => {
  it("'mock' construye MockWhatsApp y 'cloud' completo construye WhatsAppCloudAPI", () => {
    expect(whatsappPorAmbiente('mock', undefined, undefined, undefined, undefined)).toBeInstanceOf(MockWhatsApp)
    expect(whatsappPorAmbiente('cloud', 't', 'p', 'v', 's')).toBeInstanceOf(WhatsAppCloudAPI)
  })

  it('perilla ausente/desconocida o cloud incompleto lanza — JAMÁS cae a mock', () => {
    expect(() => whatsappPorAmbiente(undefined, 't', 'p', 'v', 's')).toThrow('WhatsApp no está configurado')
    expect(() => whatsappPorAmbiente('twilio', 't', 'p', 'v', 's')).toThrow('WhatsApp no está configurado')
    expect(() => whatsappPorAmbiente('cloud', undefined, 'p', 'v', 's')).toThrow('WhatsApp no está configurado')
    expect(() => whatsappPorAmbiente('cloud', 't', '', 'v', 's')).toThrow('WhatsApp no está configurado')
    expect(() => whatsappPorAmbiente('cloud', 't', 'p', undefined, 's')).toThrow('WhatsApp no está configurado')
    expect(() => whatsappPorAmbiente('cloud', 't', 'p', 'v', '')).toThrow('WhatsApp no está configurado')
  })
})
```

- [ ] **Step 7: Verificación**

```powershell
pnpm install
pnpm --filter @suite/whatsapp test
```
→ `Tests  14 passed`.

```powershell
pnpm test
```
→ `243` tests verdes en total (229 + 14).

Byte-scan sin BOM (Git Bash; imprime 0 por archivo):
```bash
grep -c $'\xEF\xBB\xBF' packages/whatsapp/package.json packages/whatsapp/src/*.ts
```

- [ ] **Step 8: Commit**

```bash
git add packages/whatsapp pnpm-lock.yaml
git commit -m "feat(whatsapp): package de mensajería con mock, Cloud API, firma HMAC y selector fail-closed

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---
### Task 2: `packages/bot` — motor de conversación (tipos + MockMotor + ClaudeMotor + selector)

Baseline: pgTAP 435/20, unit 243 → **257** al cerrar (14 nuevos), 3 builds.

**Files:**
- Create: `packages/bot/package.json` (idéntico al de whatsapp cambiando `"name": "@suite/bot"`)
- Create: `packages/bot/tsconfig.json` y `packages/bot/vitest.config.ts` (idénticos a los de whatsapp)
- Create: `packages/bot/src/tipos.ts`
- Create: `packages/bot/src/mock.ts`
- Create: `packages/bot/src/claude.ts`
- Create: `packages/bot/src/seleccionar.ts`
- Create: `packages/bot/src/index.ts`
- Test: `packages/bot/src/mock.test.ts`, `claude.test.ts`, `seleccionar.test.ts`

**Interfaces:**
- Produces (las consumen T5 y los tests): `MotorBot { responder(ctx: ContextoBot, mensaje: string): Promise<string> }` · `ContextoBot = { nombreEmpresa: string; rol: string; historial: TurnoHistorial[]; herramientas: HerramientasBot }` · `TurnoHistorial = { direccion: 'entrante' | 'saliente'; contenido: string }` · `HerramientasBot` (7 métodos, firmas exactas abajo) · `MockMotor` · `ClaudeMotor(apiKey, modelo, fetchFn?)` · `motorPorAmbiente(perilla, apiKey, modelo): MotorBot` (fail-closed; default modelo `claude-sonnet-5`).
- Consumes: `formatearCLP` de `@suite/core`.
- Los goldens del MockMotor son CONTRACTUALES: el seed (T9) y el E2E los citan byte a byte.

- [ ] **Step 1: Scaffolding + tipos**

`packages/bot/package.json`:
```json
{
  "name": "@suite/bot",
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

`packages/bot/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

`packages/bot/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { environment: 'node' },
})
```

`packages/bot/src/tipos.ts`:
```ts
// Las 7 herramientas del bot (spec §3): interface tipada que implementa el ERP
// (apps/erp/lib/bot-herramientas.ts) con el admin client scoped a la empresa del
// vinculo. El package NO depende de supabase: recibe datos, el motor redacta.
export interface HerramientasBot {
  ventasHoy(): Promise<{ total: number; documentos: number }>
  ventasMes(): Promise<{ total: number; documentos: number }>
  cobranzaVencida(): Promise<{ total: number; deudores: { cliente: string; saldo: number }[] }>
  stockCritico(): Promise<{ producto: string; cantidad: number }[]>
  semaforoAuditor(): Promise<{ estado: string; observaciones: string[] }>
  saldoCliente(nombre: string): Promise<{ cliente: string; saldo: number } | null>
  // La UNICA accion (spec §3): dispara el recordatorio de cobranza P10 por correo.
  recordarFactura(folio: number): Promise<{ ok: boolean; detalle: string }>
}

export interface TurnoHistorial {
  direccion: 'entrante' | 'saliente'
  contenido: string
}

export interface ContextoBot {
  nombreEmpresa: string
  rol: string
  historial: TurnoHistorial[]
  herramientas: HerramientasBot
}

export interface MotorBot {
  responder(ctx: ContextoBot, mensaje: string): Promise<string>
}
```

- [ ] **Step 2: MockMotor (goldens contractuales)**

`packages/bot/src/mock.ts`:
```ts
import { formatearCLP } from '@suite/core'
import type { ContextoBot, MotorBot } from './tipos'

// Motor scriptado 100% determinista (spec §3): reglas por palabra clave sobre las
// MISMAS herramientas que usa ClaudeMotor. Corre en demo/tests; sus goldens de
// conversacion son contractuales (seed y E2E los citan).
export const MENU_BOT = [
  'Hola! Soy el asistente de tu ERP. Escríbeme un número o una palabra:',
  '1. Ventas de hoy',
  '2. Ventas del mes',
  '3. Cobranza vencida',
  '4. Stock crítico',
  '5. Semáforo del auditor',
  '6. Saldo de un cliente (escribe: saldo <nombre>)',
  '7. Recordar una factura (escribe: recordar <folio>)',
].join('\n')

export const AYUDA_BOT = 'No te entendí. Escribe "menú" para ver lo que puedo hacer.'

const ETIQUETA_SEMAFORO: Record<string, string> = { ok: 'verde', media: 'amarillo', critica: 'rojo' }

export class MockMotor implements MotorBot {
  async responder(ctx: ContextoBot, mensaje: string): Promise<string> {
    const t = ctx.herramientas
    const m = mensaje.trim().toLowerCase()

    if (m === 'hola' || m === 'menu' || m === 'menú' || m === 'buenas') return MENU_BOT

    if (m === '1' || m === 'ventas' || m.startsWith('ventas de hoy')) {
      const v = await t.ventasHoy()
      return `Ventas de hoy: ${formatearCLP(v.total)} en ${v.documentos} documento(s).`
    }

    if (m === '2' || m.startsWith('ventas del mes')) {
      const v = await t.ventasMes()
      return `Ventas del mes: ${formatearCLP(v.total)} en ${v.documentos} documento(s).`
    }

    if (m === '3' || m.includes('cobranza') || m.includes('vencid')) {
      const c = await t.cobranzaVencida()
      if (c.total <= 0) return 'No tienes facturas vencidas. Buen trabajo.'
      const lineas = c.deudores.map((d) => `- ${d.cliente}: ${formatearCLP(d.saldo)}`)
      return [`Cobranza vencida: ${formatearCLP(c.total)}.`, 'Top deudores:', ...lineas].join('\n')
    }

    if (m === '4' || m.includes('stock')) {
      const s = await t.stockCritico()
      if (s.length === 0) return 'Sin productos en stock crítico.'
      return ['Stock crítico:', ...s.map((p) => `- ${p.producto}: ${p.cantidad} unidades`)].join('\n')
    }

    if (m === '5' || m.includes('auditor') || m.includes('semaforo') || m.includes('semáforo')) {
      const s = await t.semaforoAuditor()
      const etiqueta = ETIQUETA_SEMAFORO[s.estado] ?? s.estado
      if (s.observaciones.length === 0) return `Semáforo del auditor: ${etiqueta}. Sin observaciones.`
      return [`Semáforo del auditor: ${etiqueta}.`, 'Observaciones:', ...s.observaciones.map((o) => `- ${o}`)].join('\n')
    }

    if (m === '6') return 'Escribe: saldo <nombre del cliente>'
    if (m.startsWith('saldo ')) {
      const nombre = mensaje.trim().slice('saldo '.length).trim()
      const s = await t.saldoCliente(nombre)
      if (!s) return `No encontré un cliente que se llame "${nombre}".`
      return `Saldo de ${s.cliente}: ${formatearCLP(s.saldo)}.`
    }

    if (m === '7') return 'Escribe: recordar <folio de la factura>'
    if (m.startsWith('recordar')) {
      const folio = Number.parseInt(m.slice('recordar'.length).trim(), 10)
      if (!Number.isInteger(folio) || folio <= 0) return 'Escribe: recordar <folio de la factura>'
      const r = await t.recordarFactura(folio)
      return r.detalle
    }

    return AYUDA_BOT
  }
}
```

- [ ] **Step 3: ClaudeMotor (Anthropic Messages API, fetch inyectable, máx 5 rondas)**

`packages/bot/src/claude.ts`:
```ts
import type { ContextoBot, HerramientasBot, MotorBot } from './tipos'

// Motor IA real (spec §3): Anthropic Messages API via fetch INYECTABLE (sin SDK,
// decision del spec). Las 7 herramientas van como tools tipadas; maximo 5 rondas de
// tool-use; si la API falla o se agotan las rondas -> DISCULPA (nunca-lanza hacia el
// webhook). A logs SOLO error.message: jamas la apiKey.
export const DISCULPA_BOT = 'Perdona, tuve un problema para responderte. Intenta de nuevo en unos minutos.'

const URL_ANTHROPIC = 'https://api.anthropic.com/v1/messages'
const SIN_PARAMETROS = { type: 'object' as const, properties: {}, additionalProperties: false }

const TOOLS = [
  { name: 'ventas_hoy', description: 'Total de ventas de hoy (documentos emitidos) de la empresa.', input_schema: SIN_PARAMETROS },
  { name: 'ventas_mes', description: 'Total de ventas del mes en curso de la empresa.', input_schema: SIN_PARAMETROS },
  { name: 'cobranza_vencida', description: 'Total vencido por cobrar y top 5 deudores.', input_schema: SIN_PARAMETROS },
  { name: 'stock_critico', description: 'Productos con stock critico (5 o menos unidades).', input_schema: SIN_PARAMETROS },
  { name: 'semaforo_auditor', description: 'Estado del semaforo del Contador Auditor del mes y sus observaciones.', input_schema: SIN_PARAMETROS },
  {
    name: 'saldo_cliente',
    description: 'Saldo por cobrar de UN cliente buscado por nombre parcial.',
    input_schema: { type: 'object' as const, properties: { nombre: { type: 'string', description: 'Nombre o parte del nombre del cliente' } }, required: ['nombre'], additionalProperties: false },
  },
  {
    name: 'recordar_factura',
    description: 'Envia el recordatorio de pago por correo de UNA factura vencida (unica accion disponible).',
    input_schema: { type: 'object' as const, properties: { folio: { type: 'integer', description: 'Folio de la factura' } }, required: ['folio'], additionalProperties: false },
  },
]

type BloqueContenido =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }

interface RespuestaMensajes {
  content: BloqueContenido[]
  stop_reason: string
}

async function ejecutarHerramienta(t: HerramientasBot, nombre: string, input: Record<string, unknown>): Promise<unknown> {
  switch (nombre) {
    case 'ventas_hoy':
      return t.ventasHoy()
    case 'ventas_mes':
      return t.ventasMes()
    case 'cobranza_vencida':
      return t.cobranzaVencida()
    case 'stock_critico':
      return t.stockCritico()
    case 'semaforo_auditor':
      return t.semaforoAuditor()
    case 'saldo_cliente':
      return t.saldoCliente(String(input.nombre ?? ''))
    case 'recordar_factura':
      return t.recordarFactura(Number(input.folio ?? 0))
    default:
      return { error: `Herramienta desconocida: ${nombre}` }
  }
}

function promptSistema(ctx: ContextoBot): string {
  return (
    `Eres el asistente por WhatsApp del ERP de ${ctx.nombreEmpresa}. Hablas con su ${ctx.rol} ` +
    'en español de Chile. Respondes SOLO con datos de SU empresa obtenidos con las herramientas; ' +
    'JAMÁS inventes cifras ni hables de otras empresas. Respuestas cortas, estilo WhatsApp, sin ' +
    'markdown. Si te piden algo fuera de las herramientas, dilo con amabilidad.'
  )
}

export class ClaudeMotor implements MotorBot {
  constructor(
    private readonly apiKey: string,
    private readonly modelo: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async responder(ctx: ContextoBot, mensaje: string): Promise<string> {
    try {
      const mensajes: unknown[] = ctx.historial.map((t) => ({
        role: t.direccion === 'entrante' ? 'user' : 'assistant',
        content: t.contenido,
      }))
      mensajes.push({ role: 'user', content: mensaje })

      for (let ronda = 0; ronda < 5; ronda++) {
        const res = await this.fetchFn(URL_ANTHROPIC, {
          method: 'POST',
          headers: {
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: this.modelo,
            max_tokens: 1024,
            system: promptSistema(ctx),
            tools: TOOLS,
            messages: mensajes,
          }),
        })
        if (!res.ok) throw new Error(`Anthropic respondió ${res.status}`)
        const data = (await res.json()) as RespuestaMensajes

        if (data.stop_reason === 'tool_use') {
          mensajes.push({ role: 'assistant', content: data.content })
          const resultados: unknown[] = []
          for (const bloque of data.content) {
            if (bloque.type !== 'tool_use') continue
            resultados.push({
              type: 'tool_result',
              tool_use_id: bloque.id,
              content: JSON.stringify(await ejecutarHerramienta(ctx.herramientas, bloque.name, bloque.input)),
            })
          }
          mensajes.push({ role: 'user', content: resultados })
          continue
        }

        const texto = data.content
          .filter((b): b is Extract<BloqueContenido, { type: 'text' }> => b.type === 'text')
          .map((b) => b.text)
          .join('')
          .trim()
        return texto || DISCULPA_BOT
      }
      // 5 rondas de tool-use sin respuesta final: se corta con la disculpa.
      return DISCULPA_BOT
    } catch (error) {
      console.error('ClaudeMotor:', error instanceof Error ? error.message : 'error desconocido')
      return DISCULPA_BOT
    }
  }
}
```

- [ ] **Step 4: Selector fail-closed + barrel**

`packages/bot/src/seleccionar.ts`:
```ts
import { ClaudeMotor } from './claude'
import { MockMotor } from './mock'
import type { MotorBot } from './tipos'

// Seleccion por env FAIL-CLOSED (patron correoPorAmbiente P10): 'mock' -> MockMotor,
// 'claude' -> ClaudeMotor (exige apiKey; modelo por MOTOR_BOT_MODELO con default
// claude-sonnet-5). Cualquier otro valor o ausente -> THROW. Sin `?? 'mock'`.
const ERROR_NO_CONFIGURADO = 'El motor del bot no está configurado'

export function motorPorAmbiente(
  perilla: string | undefined,
  apiKey: string | undefined,
  modelo: string | undefined,
): MotorBot {
  if (perilla === 'mock') return new MockMotor()
  if (perilla === 'claude') {
    if (!apiKey) throw new Error(ERROR_NO_CONFIGURADO)
    return new ClaudeMotor(apiKey, modelo || 'claude-sonnet-5')
  }
  throw new Error(ERROR_NO_CONFIGURADO)
}
```

`packages/bot/src/index.ts`:
```ts
export type { ContextoBot, HerramientasBot, MotorBot, TurnoHistorial } from './tipos'
export { AYUDA_BOT, MENU_BOT, MockMotor } from './mock'
export { ClaudeMotor, DISCULPA_BOT } from './claude'
export { motorPorAmbiente } from './seleccionar'
```

- [ ] **Step 5: Tests (14) — herramientas fake inyectadas**

`packages/bot/src/mock.test.ts` (9 tests):
```ts
import { describe, expect, it, vi } from 'vitest'
import { AYUDA_BOT, MENU_BOT, MockMotor } from './mock'
import type { ContextoBot, HerramientasBot } from './tipos'

// Herramientas fake 100% deterministas: los goldens de abajo son contractuales.
function herramientasFake(): HerramientasBot {
  return {
    ventasHoy: vi.fn(async () => ({ total: 1190000, documentos: 3 })),
    ventasMes: vi.fn(async () => ({ total: 25000000, documentos: 42 })),
    cobranzaVencida: vi.fn(async () => ({
      total: 2380000,
      deudores: [
        { cliente: 'Comercial del Sur Ltda', saldo: 1190000 },
        { cliente: 'Ferretería El Roble EIRL', saldo: 1190000 },
      ],
    })),
    stockCritico: vi.fn(async () => [{ producto: 'Aceite 15W40', cantidad: 2 }]),
    semaforoAuditor: vi.fn(async () => ({ estado: 'media', observaciones: ['Factura vencida sin gestión: Factura N° 1043'] })),
    saldoCliente: vi.fn(async (nombre: string) =>
      nombre.toLowerCase().includes('sur') ? { cliente: 'Comercial del Sur Ltda', saldo: 1190000 } : null,
    ),
    recordarFactura: vi.fn(async (folio: number) => ({ ok: true, detalle: `Recordatorio enviado por la factura N° ${folio}.` })),
  }
}

function ctx(herramientas: HerramientasBot): ContextoBot {
  return { nombreEmpresa: 'Demo Transportes SpA', rol: 'dueno', historial: [], herramientas }
}

describe('MockMotor (goldens contractuales)', () => {
  it('hola y menú devuelven el menú numerado 1-7', async () => {
    const motor = new MockMotor()
    const t = herramientasFake()
    expect(await motor.responder(ctx(t), 'hola')).toBe(MENU_BOT)
    expect(await motor.responder(ctx(t), 'Menú')).toBe(MENU_BOT)
    expect(MENU_BOT).toContain('7. Recordar una factura')
  })

  it('1 y "ventas" responden ventas de hoy con CLP', async () => {
    const t = herramientasFake()
    const golden = 'Ventas de hoy: $1.190.000 en 3 documento(s).'
    expect(await new MockMotor().responder(ctx(t), '1')).toBe(golden)
    expect(await new MockMotor().responder(ctx(t), 'ventas')).toBe(golden)
    expect(t.ventasHoy).toHaveBeenCalledTimes(2)
  })

  it('2 responde ventas del mes', async () => {
    const t = herramientasFake()
    expect(await new MockMotor().responder(ctx(t), '2')).toBe('Ventas del mes: $25.000.000 en 42 documento(s).')
  })

  it('3 responde cobranza vencida con top deudores', async () => {
    const t = herramientasFake()
    expect(await new MockMotor().responder(ctx(t), '3')).toBe(
      'Cobranza vencida: $2.380.000.\nTop deudores:\n- Comercial del Sur Ltda: $1.190.000\n- Ferretería El Roble EIRL: $1.190.000',
    )
  })

  it('4 responde stock crítico', async () => {
    const t = herramientasFake()
    expect(await new MockMotor().responder(ctx(t), '4')).toBe('Stock crítico:\n- Aceite 15W40: 2 unidades')
  })

  it('5 responde el semáforo con observaciones', async () => {
    const t = herramientasFake()
    expect(await new MockMotor().responder(ctx(t), '5')).toBe(
      'Semáforo del auditor: amarillo.\nObservaciones:\n- Factura vencida sin gestión: Factura N° 1043',
    )
  })

  it('saldo <nombre> encuentra y reporta no-encontrado', async () => {
    const t = herramientasFake()
    expect(await new MockMotor().responder(ctx(t), 'saldo del Sur')).toBe('Saldo de Comercial del Sur Ltda: $1.190.000.')
    expect(await new MockMotor().responder(ctx(t), 'saldo Nadie SpA')).toBe('No encontré un cliente que se llame "Nadie SpA".')
  })

  it('recordar 1043 dispara la herramienta y devuelve su detalle; 7 da la pista', async () => {
    const t = herramientasFake()
    expect(await new MockMotor().responder(ctx(t), 'recordar 1043')).toBe('Recordatorio enviado por la factura N° 1043.')
    expect(t.recordarFactura).toHaveBeenCalledWith(1043)
    expect(await new MockMotor().responder(ctx(t), '7')).toBe('Escribe: recordar <folio de la factura>')
  })

  it('mensaje desconocido devuelve la ayuda', async () => {
    const t = herramientasFake()
    expect(await new MockMotor().responder(ctx(t), 'qué hora es')).toBe(AYUDA_BOT)
  })
})
```

Nota: igual que en T1, si `formatearCLP` difiere del formato `$1.190.000`, ajustar los literales esperados al output real (una sola vez, consistente).

`packages/bot/src/claude.test.ts` (3 tests):
```ts
import { describe, expect, it, vi } from 'vitest'
import { ClaudeMotor, DISCULPA_BOT } from './claude'
import type { ContextoBot, HerramientasBot } from './tipos'

function herramientasFake(): HerramientasBot {
  return {
    ventasHoy: vi.fn(async () => ({ total: 500000, documentos: 2 })),
    ventasMes: vi.fn(async () => ({ total: 0, documentos: 0 })),
    cobranzaVencida: vi.fn(async () => ({ total: 0, deudores: [] })),
    stockCritico: vi.fn(async () => []),
    semaforoAuditor: vi.fn(async () => ({ estado: 'ok', observaciones: [] })),
    saldoCliente: vi.fn(async () => null),
    recordarFactura: vi.fn(async () => ({ ok: true, detalle: 'x' })),
  }
}

function ctx(herramientas: HerramientasBot): ContextoBot {
  return {
    nombreEmpresa: 'Demo Transportes SpA',
    rol: 'dueno',
    historial: [{ direccion: 'entrante', contenido: 'hola' }, { direccion: 'saliente', contenido: 'Hola!' }],
    herramientas,
  }
}

function respuesta(json: unknown): { ok: true; status: 200; json: () => Promise<unknown> } {
  return { ok: true, status: 200, json: async () => json }
}

describe('ClaudeMotor.responder', () => {
  it('resuelve una ronda de tool_use y devuelve el texto final', async () => {
    const t = herramientasFake()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        respuesta({
          stop_reason: 'tool_use',
          content: [{ type: 'tool_use', id: 'tu-1', name: 'ventas_hoy', input: {} }],
        }),
      )
      .mockResolvedValueOnce(
        respuesta({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Hoy llevas $500.000 en 2 documentos.' }] }),
      )
    const motor = new ClaudeMotor('KEY', 'claude-sonnet-5', fetchMock as unknown as typeof fetch)

    const salida = await motor.responder(ctx(t), 'cuánto vendí hoy?')

    expect(salida).toBe('Hoy llevas $500.000 en 2 documentos.')
    expect(t.ventasHoy).toHaveBeenCalledTimes(1)
    const segundoBody = JSON.parse((fetchMock.mock.calls[1] as unknown as [string, { body: string }])[1].body)
    const ultimoMensaje = segundoBody.messages.at(-1)
    expect(ultimoMensaje.role).toBe('user')
    expect(ultimoMensaje.content[0].type).toBe('tool_result')
    expect(ultimoMensaje.content[0].tool_use_id).toBe('tu-1')
  })

  it('arma el request correcto: url, headers de Anthropic, modelo, system, tools e historial', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respuesta({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] }))
    await new ClaudeMotor('KEY-123', 'claude-sonnet-5', fetchMock as unknown as typeof fetch).responder(ctx(herramientasFake()), 'hola')

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string>; body: string }]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(init.headers['x-api-key']).toBe('KEY-123')
    expect(init.headers['anthropic-version']).toBe('2023-06-01')
    const body = JSON.parse(init.body)
    expect(body.model).toBe('claude-sonnet-5')
    expect(body.system).toContain('Demo Transportes SpA')
    expect(body.tools).toHaveLength(7)
    expect(body.messages).toHaveLength(3)
    expect(body.messages[0]).toEqual({ role: 'user', content: 'hola' })
    expect(body.messages[1]).toEqual({ role: 'assistant', content: 'Hola!' })
  })

  it('error de API devuelve la disculpa sin lanzar y sin filtrar la key', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 529, json: async () => ({}) })
    const salida = await new ClaudeMotor('KEY-SECRETA', 'claude-sonnet-5', fetchMock as unknown as typeof fetch).responder(
      ctx(herramientasFake()),
      'hola',
    )
    expect(salida).toBe(DISCULPA_BOT)
    const loggeado = errSpy.mock.calls.flat().join(' ')
    expect(loggeado).toContain('529')
    expect(loggeado).not.toContain('KEY-SECRETA')
    errSpy.mockRestore()
  })
})
```

`packages/bot/src/seleccionar.test.ts` (2 tests):
```ts
import { describe, expect, it } from 'vitest'
import { ClaudeMotor } from './claude'
import { MockMotor } from './mock'
import { motorPorAmbiente } from './seleccionar'

describe('motorPorAmbiente (fail-closed)', () => {
  it("'mock' construye MockMotor y 'claude' con key construye ClaudeMotor (modelo default)", () => {
    expect(motorPorAmbiente('mock', undefined, undefined)).toBeInstanceOf(MockMotor)
    expect(motorPorAmbiente('claude', 'KEY', undefined)).toBeInstanceOf(ClaudeMotor)
    expect(motorPorAmbiente('claude', 'KEY', 'claude-opus-4-8')).toBeInstanceOf(ClaudeMotor)
  })

  it('perilla ausente/desconocida o claude sin key lanza — JAMÁS cae a mock', () => {
    expect(() => motorPorAmbiente(undefined, 'KEY', undefined)).toThrow('El motor del bot no está configurado')
    expect(() => motorPorAmbiente('gpt', 'KEY', undefined)).toThrow('El motor del bot no está configurado')
    expect(() => motorPorAmbiente('claude', undefined, undefined)).toThrow('El motor del bot no está configurado')
    expect(() => motorPorAmbiente('claude', '', undefined)).toThrow('El motor del bot no está configurado')
  })
})
```

- [ ] **Step 6: Verificación**

```powershell
pnpm install
pnpm --filter @suite/bot test
```
→ `Tests  14 passed`.

```powershell
pnpm test
```
→ `257` verdes (229 + 14 + 14).

Byte-scan (Git Bash): `grep -c $'\xEF\xBB\xBF' packages/bot/package.json packages/bot/src/*.ts` → 0 por archivo.

- [ ] **Step 7: Commit**

```bash
git add packages/bot pnpm-lock.yaml
git commit -m "feat(bot): motor de conversación con MockMotor scriptado, ClaudeMotor tool-use y selector fail-closed

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---
### Task 3: Migración 0028 — `whatsapp_vinculos`, `whatsapp_mensajes`, RPCs y tipos regenerados

Baseline: pgTAP 435/20 (la migración no rompe ningún test existente), unit 257, 3 builds.

**Files:**
- Create: `supabase/migrations/00000000000028_whatsapp.sql`
- Modify: `packages/db/src/types.ts` (regenerado con `pnpm --filter @suite/db gen`)

**Interfaces:**
- Produces (los consumen T4-T9): tablas `whatsapp_vinculos` y `whatsapp_mensajes`; RPCs `solicitar_vinculo_whatsapp(p_empresa uuid, p_telefono text) returns uuid`, `confirmar_vinculo_whatsapp(p_empresa uuid, p_vinculo uuid, p_codigo text) returns void`, `desvincular_whatsapp(p_empresa uuid, p_vinculo uuid) returns void` (todas `authenticated`), `semaforo_whatsapp(p_empresa uuid, p_usuario uuid, p_anio integer, p_mes integer) returns jsonb` (SOLO `service_role`).
- Consumes: `app.tiene_rol_en_empresa` (0003), `revision_periodo` (0027), patrón grants/log inmutable de `correos_enviados` (0020) y escritura-solo-RPC de `finiquitos` (0027).

- [ ] **Step 1: Escribir la migración**

`supabase/migrations/00000000000028_whatsapp.sql`:
```sql
-- WhatsApp (Plan 21): vinculacion segura de telefonos del dueno/admin y log INMUTABLE
-- de mensajes. La conversacion entra por el webhook (service_role); la gestion de
-- vinculos va SOLO por RPCs security definer (cero escritura directa, patron
-- finiquitos 0027). El log copia el patron correos_enviados 0020.

-- ---------- whatsapp_vinculos ----------
create table public.whatsapp_vinculos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  usuario_id uuid not null,
  -- E.164 estricto: mismo regex que esTelefonoE164 en @suite/whatsapp.
  telefono text not null check (telefono ~ '^\+[1-9][0-9]{7,14}$'),
  codigo text,
  codigo_expira timestamptz,
  verificado_en timestamptz,
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);

-- Un telefono VERIFICADO activo en TODA la plataforma (spec 4.1): backstop atomico
-- del mensaje 'Ese telefono ya esta vinculado a otra cuenta'.
create unique index whatsapp_vinculos_telefono_idx
  on public.whatsapp_vinculos (telefono)
  where verificado_en is not null and activo;

-- El webhook resuelve el vinculo por telefono; la UI lista por empresa.
create index whatsapp_vinculos_empresa_idx
  on public.whatsapp_vinculos (empresa_id, activo, creado_en desc);

-- ---------- whatsapp_mensajes (log INMUTABLE) ----------
create table public.whatsapp_mensajes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  telefono text not null,
  direccion text not null check (direccion in ('entrante', 'saliente')),
  origen text not null check (origen in ('bot', 'cobranza', 'vinculacion')),
  contenido text not null,
  -- La factura del recordatorio de cobranza (anti-spam 3 dias). Sin FK dura:
  -- traza, patron referencia_id de correos_enviados.
  referencia_id uuid,
  creado_en timestamptz not null default now()
);

-- Conversacion por telefono (historial del bot) y anti-spam de cobranza por factura.
create index whatsapp_mensajes_telefono_idx
  on public.whatsapp_mensajes (empresa_id, telefono, creado_en desc);
create index whatsapp_mensajes_ref_idx
  on public.whatsapp_mensajes (empresa_id, origen, referencia_id, creado_en desc);

-- ---------- RLS ----------
alter table public.whatsapp_vinculos enable row level security;
alter table public.whatsapp_mensajes enable row level security;

-- vinculos: SELECT dueno/admin (el codigo de verificacion es sensible);
-- CERO escritura directa (ni policy ni grant: el grant es el candado).
create policy "duenos ven vinculos whatsapp" on public.whatsapp_vinculos
  for select to authenticated
  using (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']));

-- mensajes: SELECT dueno/admin/contador (el contador audita la gestion de cobranza);
-- INSERT dueno/admin (acciones de la app; el webhook inserta con service_role).
-- Sin UPDATE/DELETE: log inmutable.
create policy "contables ven mensajes whatsapp" on public.whatsapp_mensajes
  for select to authenticated
  using (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin', 'contador']));
create policy "duenos registran mensajes whatsapp" on public.whatsapp_mensajes
  for insert to authenticated
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']));

-- ---------- Grants Data API (leccion 0001: sin esto todo da 42501) ----------
grant select on public.whatsapp_vinculos to authenticated;
grant select, insert on public.whatsapp_mensajes to authenticated;
grant select, insert, update, delete on public.whatsapp_vinculos, public.whatsapp_mensajes to service_role;

-- ---------- Solicitar vinculo (codigo de 6 digitos, expira en 10 min) ----------
create or replace function public.solicitar_vinculo_whatsapp(p_empresa uuid, p_telefono text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_codigo text;
  v_id uuid;
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin']) then
    raise exception 'Tu rol no permite gestionar WhatsApp';
  end if;
  if p_telefono is null or p_telefono !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'Teléfono no válido: usa formato internacional +56...';
  end if;

  v_codigo := lpad((floor(random() * 1000000))::int::text, 6, '0');

  -- Reintento sobre el mismo telefono pendiente (misma empresa, no verificado,
  -- activo): regenera codigo y expiracion sobre la MISMA fila (spec 4.1).
  update whatsapp_vinculos
  set codigo = v_codigo,
      codigo_expira = now() + interval '10 minutes',
      usuario_id = auth.uid()
  where empresa_id = p_empresa and telefono = p_telefono
    and verificado_en is null and activo
  returning id into v_id;

  if v_id is null then
    insert into whatsapp_vinculos (empresa_id, usuario_id, telefono, codigo, codigo_expira)
    values (p_empresa, auth.uid(), p_telefono, v_codigo, now() + interval '10 minutes')
    returning id into v_id;
  end if;

  -- El ENVIO del codigo lo hace la Server Action via proveedorWhatsApp():
  -- la RPC no habla con el mundo (spec 4.1).
  return v_id;
end $$;
revoke execute on function public.solicitar_vinculo_whatsapp(uuid, text) from anon, public;
grant execute on function public.solicitar_vinculo_whatsapp(uuid, text) to authenticated;

-- ---------- Confirmar vinculo ----------
create or replace function public.confirmar_vinculo_whatsapp(p_empresa uuid, p_vinculo uuid, p_codigo text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_ok boolean;
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin']) then
    raise exception 'Tu rol no permite gestionar WhatsApp';
  end if;
  begin
    update whatsapp_vinculos
    set verificado_en = now(), codigo = null, codigo_expira = null
    where id = p_vinculo and empresa_id = p_empresa
      and verificado_en is null and activo
      and codigo is not null and codigo = p_codigo and codigo_expira > now()
    returning true into v_ok;
  exception when unique_violation then
    -- El unique parcial de plataforma: ese telefono ya esta verificado en otra fila.
    raise exception 'Ese teléfono ya está vinculado a otra cuenta';
  end;
  if v_ok is null then
    raise exception 'Código incorrecto o expirado';
  end if;
end $$;
revoke execute on function public.confirmar_vinculo_whatsapp(uuid, uuid, text) from anon, public;
grant execute on function public.confirmar_vinculo_whatsapp(uuid, uuid, text) to authenticated;

-- ---------- Desvincular ----------
create or replace function public.desvincular_whatsapp(p_empresa uuid, p_vinculo uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin']) then
    raise exception 'Tu rol no permite gestionar WhatsApp';
  end if;
  update whatsapp_vinculos set activo = false
  where id = p_vinculo and empresa_id = p_empresa and activo;
  if not found then
    raise exception 'El vínculo no existe';
  end if;
end $$;
revoke execute on function public.desvincular_whatsapp(uuid, uuid) from anon, public;
grant execute on function public.desvincular_whatsapp(uuid, uuid) to authenticated;

-- ---------- Semaforo del auditor para el bot (SOLO service_role) ----------
-- El webhook corre como service_role: auth.uid() es null y el guard de
-- revision_periodo lanzaria. Este wrapper valida el rol del usuario del VINCULO
-- verificado y lo impersona con set_config transaccional (mismo mecanismo que los
-- tests pgTAP) para reusar revision_periodo tal cual, sin re-crear su cuerpo.
create or replace function public.semaforo_whatsapp(p_empresa uuid, p_usuario uuid, p_anio integer, p_mes integer)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from empresas e
    join miembros m on m.organizacion_id = e.organizacion_id
    where e.id = p_empresa
      and m.usuario_id = p_usuario
      and m.estado = 'activo'
      and m.rol in ('dueno', 'admin')
  ) then
    raise exception 'Tu rol no permite ver la revisión';
  end if;
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_usuario, 'role', 'authenticated')::text,
    true
  );
  return revision_periodo(p_empresa, p_anio, p_mes);
end $$;
revoke execute on function public.semaforo_whatsapp(uuid, uuid, integer, integer) from anon, public, authenticated;
grant execute on function public.semaforo_whatsapp(uuid, uuid, integer, integer) to service_role;
```

- [ ] **Step 2: Aplicar y regenerar tipos**

```powershell
npx supabase db reset
```
→ termina con `Finished supabase db reset` aplicando las 28 migraciones sin error (la demo se borra; se resiembra en T9).

```powershell
pnpm --filter @suite/db gen
```
→ `packages/db/src/types.ts` gana `whatsapp_vinculos`, `whatsapp_mensajes` y las 4 funciones.

```powershell
git diff --stat packages/db/src/types.ts
```
→ SOLO adiciones coherentes (tablas + Functions nuevas).

- [ ] **Step 3: Smoke en vivo (psql via supabase, no comiteado)**

```powershell
npx supabase test db
```
→ **20 archivos, 435 asserts, todos verdes** (la migración no rompe nada existente).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/00000000000028_whatsapp.sql packages/db/src/types.ts
git commit -m "feat(db): migración 0028 — vínculos WhatsApp con RPCs seguras, log inmutable y semáforo para el bot

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: pgTAP `whatsapp.test.sql` — archivo 21, `plan(23)`

Baseline: pgTAP 435/20 → **458/21** al cerrar; unit 257; 3 builds.

**Files:**
- Create: `supabase/tests/database/whatsapp.test.sql`

**Interfaces:**
- Consumes: tablas/RPCs de la 0028; helpers de fixtures del patrón `finiquitos.test.sql` (auth.users + organizaciones + empresas + miembros; impersonación con `set local request.jwt.claims`).
- Fixtures propios: org/empresa A rut `769910026` (Ana dueña `a1a1...`, Ces contador `c5c5...`, Vero vendedora `b7b7...`), org/empresa B rut `769910034` (Beto dueño `d9d9...`). UUIDs completos abajo.

- [ ] **Step 1: Escribir el archivo de test completo**

`supabase/tests/database/whatsapp.test.sql`:
```sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

-- ===== Fixtures (superuser: salta grants/RLS, patron finiquitos) =====
-- Empresa A: Ana duena, Ces contador, Vero vendedora. Empresa B: Beto dueno.
insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', 'authenticated', 'authenticated', 'ana@wsp.cl'),
  ('00000000-0000-0000-0000-000000000000', 'c5c5c5c5-c5c5-c5c5-c5c5-c5c5c5c5c5c5', 'authenticated', 'authenticated', 'ces@wsp.cl'),
  ('00000000-0000-0000-0000-000000000000', 'b7b7b7b7-b7b7-b7b7-b7b7-b7b7b7b7b7b7', 'authenticated', 'authenticated', 'vero@wsp.cl'),
  ('00000000-0000-0000-0000-000000000000', 'd9d9d9d9-d9d9-d9d9-d9d9-d9d9d9d9d9d9', 'authenticated', 'authenticated', 'beto@wsp.cl');

insert into public.organizaciones (id, rut, razon_social)
values
  ('aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa', '769910026', 'Org WhatsApp A'),
  ('bbbbbbbb-0000-0000-0000-bbbbbbbbbbbb', '769910034', 'Org WhatsApp B');

insert into public.empresas (id, organizacion_id, rut, razon_social)
values
  ('eeeeeeee-0000-0000-0000-aaaaaaaaaa21', 'aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa', '769910026', 'WhatsApp A'),
  ('eeeeeeee-0000-0000-0000-bbbbbbbbbb21', 'bbbbbbbb-0000-0000-0000-bbbbbbbbbbbb', '769910034', 'WhatsApp B');

insert into public.miembros (usuario_id, organizacion_id, rol)
values
  ('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', 'aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa', 'dueno'),
  ('c5c5c5c5-c5c5-c5c5-c5c5-c5c5c5c5c5c5', 'aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa', 'contador'),
  ('b7b7b7b7-b7b7-b7b7-b7b7-b7b7b7b7b7b7', 'aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa', 'vendedor'),
  ('d9d9d9d9-d9d9-d9d9-d9d9-d9d9d9d9d9d9', 'bbbbbbbb-0000-0000-0000-bbbbbbbbbbbb', 'dueno');

-- ===== Solicitar =====
-- 1) Ana (duena) solicita: retorna uuid.
set local role authenticated;
set local request.jwt.claims to '{"sub": "a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1", "role": "authenticated"}';
select lives_ok(
  $$select solicitar_vinculo_whatsapp('eeeeeeee-0000-0000-0000-aaaaaaaaaa21', '+56911111111')$$,
  'la duena solicita un vinculo'
);

-- 2) El codigo queda de 6 digitos con expiracion futura (lectura como superuser).
reset role;
select is(
  (select codigo ~ '^[0-9]{6}$' and codigo_expira > now()
   from whatsapp_vinculos
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaa21' and telefono = '+56911111111'),
  true,
  'codigo de 6 digitos con expiracion de 10 minutos'
);

-- 3) Formato invalido (byte-exacto).
set local role authenticated;
set local request.jwt.claims to '{"sub": "a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1", "role": "authenticated"}';
select throws_ok(
  $$select solicitar_vinculo_whatsapp('eeeeeeee-0000-0000-0000-aaaaaaaaaa21', '56 9 1111')$$,
  'P0001', 'Teléfono no válido: usa formato internacional +56...',
  'telefono sin formato E.164 se rechaza'
);

-- 4) Vero (vendedora) no gestiona WhatsApp.
set local request.jwt.claims to '{"sub": "b7b7b7b7-b7b7-b7b7-b7b7-b7b7b7b7b7b7", "role": "authenticated"}';
select throws_ok(
  $$select solicitar_vinculo_whatsapp('eeeeeeee-0000-0000-0000-aaaaaaaaaa21', '+56911111111')$$,
  'P0001', 'Tu rol no permite gestionar WhatsApp',
  'el vendedor no solicita vinculos'
);

-- 5) Ces (contador) tampoco (gestionar es dueno/admin).
set local request.jwt.claims to '{"sub": "c5c5c5c5-c5c5-c5c5-c5c5-c5c5c5c5c5c5", "role": "authenticated"}';
select throws_ok(
  $$select solicitar_vinculo_whatsapp('eeeeeeee-0000-0000-0000-aaaaaaaaaa21', '+56911111111')$$,
  'P0001', 'Tu rol no permite gestionar WhatsApp',
  'el contador no solicita vinculos'
);

-- ===== Confirmar =====
-- 6) Codigo incorrecto.
set local request.jwt.claims to '{"sub": "a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1", "role": "authenticated"}';
select throws_ok(
  $$select confirmar_vinculo_whatsapp('eeeeeeee-0000-0000-0000-aaaaaaaaaa21',
    (select id from whatsapp_vinculos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaa21' and telefono = '+56911111111'),
    '000000')$$,
  'P0001', 'Código incorrecto o expirado',
  'codigo incorrecto no confirma'
);

-- 7) Regeneracion: re-solicitar el mismo telefono pendiente vive.
select lives_ok(
  $$select solicitar_vinculo_whatsapp('eeeeeeee-0000-0000-0000-aaaaaaaaaa21', '+56911111111')$$,
  're-solicitar regenera el codigo'
);

-- 8) ... sobre la MISMA fila (no crea duplicados pendientes).
reset role;
select is(
  (select count(*) from whatsapp_vinculos
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaa21' and telefono = '+56911111111'),
  1::bigint,
  'la regeneracion reusa la fila pendiente'
);

-- 9) Confirmar feliz: fixture con codigo conocido (superuser lo fija).
update whatsapp_vinculos set codigo = '123456', codigo_expira = now() + interval '10 minutes'
where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaa21' and telefono = '+56911111111';
set local role authenticated;
set local request.jwt.claims to '{"sub": "a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1", "role": "authenticated"}';
select lives_ok(
  $$select confirmar_vinculo_whatsapp('eeeeeeee-0000-0000-0000-aaaaaaaaaa21',
    (select id from whatsapp_vinculos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaa21' and telefono = '+56911111111'),
    '123456')$$,
  'la duena confirma con el codigo correcto'
);

-- 10) Queda verificado y sin codigo.
reset role;
select is(
  (select verificado_en is not null and codigo is null and codigo_expira is null
   from whatsapp_vinculos
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaa21' and telefono = '+56911111111'),
  true,
  'confirmar marca verificado_en y limpia el codigo'
);

-- 11) Expirado: Beto (empresa B) solicita y el superuser vence el codigo.
set local role authenticated;
set local request.jwt.claims to '{"sub": "d9d9d9d9-d9d9-d9d9-d9d9-d9d9d9d9d9d9", "role": "authenticated"}';
select lives_ok(
  $$select solicitar_vinculo_whatsapp('eeeeeeee-0000-0000-0000-bbbbbbbbbb21', '+56922222222')$$,
  'beto solicita en la empresa B'
);
reset role;
update whatsapp_vinculos set codigo = '654321', codigo_expira = now() - interval '1 minute'
where empresa_id = 'eeeeeeee-0000-0000-0000-bbbbbbbbbb21' and telefono = '+56922222222';
set local role authenticated;
set local request.jwt.claims to '{"sub": "d9d9d9d9-d9d9-d9d9-d9d9-d9d9d9d9d9d9", "role": "authenticated"}';
select throws_ok(
  $$select confirmar_vinculo_whatsapp('eeeeeeee-0000-0000-0000-bbbbbbbbbb21',
    (select id from whatsapp_vinculos where empresa_id = 'eeeeeeee-0000-0000-0000-bbbbbbbbbb21' and telefono = '+56922222222'),
    '654321')$$,
  'P0001', 'Código incorrecto o expirado',
  'codigo expirado no confirma (fixture con expiracion vencida)'
);

-- ===== Duplicado cross-empresa (unique parcial de PLATAFORMA) =====
-- 12) Beto puede SOLICITAR el telefono ya verificado por Ana (fila pendiente propia)...
select lives_ok(
  $$select solicitar_vinculo_whatsapp('eeeeeeee-0000-0000-0000-bbbbbbbbbb21', '+56911111111')$$,
  'solicitar un telefono ajeno vive (el candado es al confirmar)'
);

-- 13) ... pero CONFIRMARLO choca con el unique parcial (mensaje byte-exacto).
reset role;
update whatsapp_vinculos set codigo = '111111', codigo_expira = now() + interval '10 minutes'
where empresa_id = 'eeeeeeee-0000-0000-0000-bbbbbbbbbb21' and telefono = '+56911111111';
set local role authenticated;
set local request.jwt.claims to '{"sub": "d9d9d9d9-d9d9-d9d9-d9d9-d9d9d9d9d9d9", "role": "authenticated"}';
select throws_ok(
  $$select confirmar_vinculo_whatsapp('eeeeeeee-0000-0000-0000-bbbbbbbbbb21',
    (select id from whatsapp_vinculos where empresa_id = 'eeeeeeee-0000-0000-0000-bbbbbbbbbb21' and telefono = '+56911111111'),
    '111111')$$,
  'P0001', 'Ese teléfono ya está vinculado a otra cuenta',
  'un telefono verificado en la plataforma no se vincula dos veces'
);

-- ===== RLS y escritura directa =====
-- 14) Vero (vendedora) ve 0 filas en ambas tablas.
set local request.jwt.claims to '{"sub": "b7b7b7b7-b7b7-b7b7-b7b7-b7b7b7b7b7b7", "role": "authenticated"}';
select is(
  (select count(*) from whatsapp_vinculos) + (select count(*) from whatsapp_mensajes),
  0::bigint,
  'el vendedor no ve vinculos ni mensajes'
);

-- 15) Ni la duena inserta vinculos directo (grant = candado, solo RPCs).
set local request.jwt.claims to '{"sub": "a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1", "role": "authenticated"}';
select throws_ok(
  $$insert into whatsapp_vinculos (empresa_id, usuario_id, telefono)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaa21', 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', '+56933333333')$$,
  '42501', 'permission denied for table whatsapp_vinculos',
  'ni la duena escribe vinculos directamente'
);

-- 16) La duena SI registra mensajes (acciones de la app: cobranza/vinculacion).
select lives_ok(
  $$insert into whatsapp_mensajes (empresa_id, telefono, direccion, origen, contenido, referencia_id)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaa21', '+56987654321', 'saliente', 'cobranza',
            'Recordatorio de prueba', gen_random_uuid())$$,
  'la duena inserta un mensaje saliente de cobranza'
);

-- 17) Log inmutable: sin UPDATE.
select throws_ok(
  $$update whatsapp_mensajes set contenido = 'editado'
    where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaa21'$$,
  '42501', 'permission denied for table whatsapp_mensajes',
  'un mensaje registrado no se edita'
);

-- 18) Log inmutable: sin DELETE.
select throws_ok(
  $$delete from whatsapp_mensajes where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaa21'$$,
  '42501', 'permission denied for table whatsapp_mensajes',
  'un mensaje registrado no se borra'
);

-- 19) Ces (contador) SI ve los mensajes (audita la gestion de cobranza).
set local request.jwt.claims to '{"sub": "c5c5c5c5-c5c5-c5c5-c5c5-c5c5c5c5c5c5", "role": "authenticated"}';
select is(
  (select count(*) from whatsapp_mensajes where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaa21'),
  1::bigint,
  'el contador ve el log de mensajes'
);

-- ===== Desvincular =====
-- 20) Ana desvincula su telefono verificado.
set local request.jwt.claims to '{"sub": "a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1", "role": "authenticated"}';
select lives_ok(
  $$select desvincular_whatsapp('eeeeeeee-0000-0000-0000-aaaaaaaaaa21',
    (select id from whatsapp_vinculos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaa21' and telefono = '+56911111111'))$$,
  'la duena desvincula'
);

-- 21) El vinculo queda inactivo (y libera el telefono en la plataforma).
reset role;
select is(
  (select activo from whatsapp_vinculos
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaa21' and telefono = '+56911111111'),
  false,
  'desvincular deja activo = false'
);

-- ===== semaforo_whatsapp (wrapper del bot, SOLO service_role) =====
-- 22) Como superuser (bypassa grants, igual que service_role): retorna el payload
--     de revision_periodo impersonando a Ana (duena).
select is(
  (select (semaforo_whatsapp('eeeeeeee-0000-0000-0000-aaaaaaaaaa21',
                             'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', 2026, 7)) ? 'estado'),
  true,
  'semaforo_whatsapp retorna el payload del auditor para el usuario del vinculo'
);

-- 23) authenticated NO puede ejecutarlo (revocado: es exclusivo del webhook).
set local role authenticated;
set local request.jwt.claims to '{"sub": "a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1", "role": "authenticated"}';
select throws_ok(
  $$select semaforo_whatsapp('eeeeeeee-0000-0000-0000-aaaaaaaaaa21',
    'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', 2026, 7)$$,
  '42501', 'permission denied for function semaforo_whatsapp',
  'semaforo_whatsapp esta vetado para authenticated'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Correr la suite completa**

```powershell
npx supabase test db
```
→ **21 archivos, 458 asserts, todos verdes**. Si el assert 22 fallara porque `set_config` dentro de la transaccion pgTAP pisa los claims del test (se restauran con el siguiente `set local`), es aceptable moverlo justo antes de `finish()` — el orden de arriba ya lo deja al final precisamente por eso.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/database/whatsapp.test.sql
git commit -m "test(db): pgTAP de WhatsApp — vinculación, unique de plataforma, log inmutable y semáforo del bot (23 asserts)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---
### Task 5: Núcleo compartido de recordatorio + `bot-herramientas` + webhook

Baseline: pgTAP 458/21, unit 257, 3 builds.

**Files:**
- Create: `apps/erp/lib/recordatorio.ts`
- Create: `apps/erp/lib/bot-herramientas.ts`
- Create: `apps/erp/app/api/webhooks/whatsapp/route.ts`
- Modify: `apps/erp/app/correo/acciones.ts` (extrae helpers al lib; 4 ediciones abajo)
- Modify: `apps/erp/package.json` (dependencias `@suite/whatsapp` y `@suite/bot`)

**Interfaces:**
- Consumes: `ProveedorWhatsApp`/`verificarFirma`/`whatsappPorAmbiente` (T1), `MotorBot`/`motorPorAmbiente`/`herramientasBot`-types/`DISCULPA_BOT` (T2), tablas/RPC `semaforo_whatsapp` (T3), `clienteAdmin` (`@suite/auth/admin`), `plantillaRecordatorio`/`correoPorAmbiente` (`@suite/correo`).
- Produces (los consumen T6-T8): `proveedorCorreoConfigurado(): ProveedorCorreo | null` · `hace3Dias(): string` · `enviarYRegistrar(db, proveedor, empresaId, tipo, referenciaId, mensaje)` · `enviarRecordatorioDocumento(db, proveedor, empresa: {id, razonSocial, rut}, documentoId): Promise<{error: string} | {ok: true; para: string; folio: number}>` · `herramientasBot(admin, empresaId, empresa: {razonSocial, rut}, usuarioId): HerramientasBot` · webhook `GET/POST /api/webhooks/whatsapp`.
- El refactor de `correo/acciones.ts` NO cambia ningún mensaje ni comportamiento: mueve `proveedorConfigurado` (renombrado `proveedorCorreoConfigurado`), `enviarYRegistrar`, `hace3Dias` y el cuerpo del recordatorio individual a `lib/recordatorio.ts`. El masivo (`enviarRecordatorios`) queda igual, importando los helpers.

- [ ] **Step 1: Declarar dependencias en apps/erp**

En `apps/erp/package.json`, dentro de `"dependencies"`, junto a `"@suite/auth": "workspace:*"` (orden alfabético):
```json
    "@suite/bot": "workspace:*",
```
y junto a `"@suite/ui"`:
```json
    "@suite/whatsapp": "workspace:*",
```
Luego:
```powershell
pnpm install
```

- [ ] **Step 2: Crear `apps/erp/lib/recordatorio.ts`**

```ts
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { correoPorAmbiente, plantillaRecordatorio, type Mensaje, type ProveedorCorreo } from '@suite/correo'
import type { Database } from '@suite/db'

// Nucleo compartido del recordatorio de cobranza (action P10 <-> herramienta del bot
// P21, spec §5). El caller pone la compuerta (action: guard de rol; bot: vinculo
// verificado) y el cliente (sesion RLS o admin con empresa fija): aqui viven las
// reglas comunes — vencida con saldo, anti-spam 3 dias, plantilla es-CL, envio y log
// SOLO en exito. Mensajes byte-exactos identicos a los del P10.
type DbCliente = SupabaseClient<Database>

const SIN_EMAIL = 'El cliente no tiene correo registrado'
const ANTISPAM = 'Ya se envió un recordatorio hace menos de 3 días'

// Fail-closed (P10 spec §4): solo 'mock' | 'resend'. El throw del selector se traga
// aqui y se vuelve el mensaje contractual — jamas llega un detalle del proveedor al
// usuario. PROHIBIDO el `?? 'mock'` de pagos.
export function proveedorCorreoConfigurado(): ProveedorCorreo | null {
  const perilla = process.env.PROVEEDOR_CORREO
  if (perilla !== 'mock' && perilla !== 'resend') return null
  try {
    return correoPorAmbiente(perilla, process.env.RESEND_API_KEY, process.env.CORREO_REMITENTE)
  } catch {
    return null
  }
}

// Ventana anti-spam de recordatorios (P10 spec §2): now() - 3 dias como ISO.
export function hace3Dias(): string {
  return new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
}

// enviar() + registro DRY (P10 spec §5): SOLO exitos se registran — si enviar()
// lanza, NO hay fila y el caller recibe error.
export async function enviarYRegistrar(
  db: DbCliente,
  proveedor: ProveedorCorreo,
  empresaId: string,
  tipo: 'cotizacion' | 'proforma' | 'documento' | 'recordatorio',
  referenciaId: string,
  mensaje: Mensaje,
): Promise<{ error: string } | { ok: true }> {
  let proveedorId: string
  try {
    proveedorId = (await proveedor.enviar(mensaje)).id
  } catch {
    return { error: 'No se pudo enviar el correo. Intenta de nuevo.' }
  }
  const { error } = await db.from('correos_enviados').insert({
    empresa_id: empresaId,
    tipo,
    referencia_id: referenciaId,
    para: mensaje.para,
    asunto: mensaje.asunto,
    proveedor_id: proveedorId,
    html: mensaje.html,
  })
  if (error) return { error: 'El correo se envió pero no se pudo registrar el envío.' }
  return { ok: true }
}

// Recordatorio de UNA factura: vencida con saldo -> anti-spam -> email del cliente ->
// plantilla -> envio+log. Devuelve para/folio para que el bot redacte su detalle.
export async function enviarRecordatorioDocumento(
  db: DbCliente,
  proveedor: ProveedorCorreo,
  empresa: { id: string; razonSocial: string; rut: string },
  documentoId: string,
): Promise<{ error: string } | { ok: true; para: string; folio: number }> {
  const { data: fila } = await db
    .from('saldos_documentos')
    .select('documento_id, tipo, folio, total, saldo, fecha_vencimiento, cliente_id, cliente_razon_social')
    .eq('empresa_id', empresa.id)
    .eq('documento_id', documentoId)
    .maybeSingle()
  if (!fila || !fila.documento_id) return { error: 'La factura no existe o no tiene saldo' }
  const hoy = new Date().toISOString().slice(0, 10)
  if ((fila.saldo ?? 0) <= 0 || !fila.fecha_vencimiento || fila.fecha_vencimiento >= hoy) {
    return { error: 'La factura no está vencida con saldo pendiente' }
  }

  const { data: reciente } = await db
    .from('correos_enviados')
    .select('id')
    .eq('empresa_id', empresa.id)
    .eq('tipo', 'recordatorio')
    .eq('referencia_id', documentoId)
    .gte('creado_en', hace3Dias())
    .limit(1)
    .maybeSingle()
  if (reciente) return { error: ANTISPAM }

  if (!fila.cliente_id) return { error: SIN_EMAIL }
  const { data: cliente } = await db
    .from('clientes')
    .select('email')
    .eq('empresa_id', empresa.id)
    .eq('id', fila.cliente_id)
    .maybeSingle()
  const email = cliente?.email
  if (!email) return { error: SIN_EMAIL }

  const { asunto, html } = plantillaRecordatorio({
    empresa: { razonSocial: empresa.razonSocial, rut: empresa.rut },
    clienteRazonSocial: fila.cliente_razon_social ?? '',
    tipo: fila.tipo === 'boleta' ? 'boleta' : 'factura',
    folio: fila.folio ?? 0,
    total: fila.total ?? 0,
    saldo: fila.saldo ?? 0,
    fechaVencimiento: new Date(fila.fecha_vencimiento).toLocaleDateString('es-CL'),
  })
  const resultado = await enviarYRegistrar(db, proveedor, empresa.id, 'recordatorio', documentoId, {
    para: email,
    asunto,
    html,
  })
  if ('error' in resultado) return resultado
  return { ok: true, para: email, folio: fila.folio ?? 0 }
}
```

Nota de tipos: `crearClienteServidor()` (ssr) y `clienteAdmin()` (supabase-js) son ambos `SupabaseClient<Database>`; si `tsc` reclamara por los generics del cliente ssr, relajar `DbCliente` a `Pick<SupabaseClient<Database>, 'from'>` (solo se usa `.from`).

- [ ] **Step 3: Refactor de `apps/erp/app/correo/acciones.ts` (4 ediciones exactas)**

**Edición A — imports** (quitar `correoPorAmbiente` y `Mensaje`, importar el lib). ANTES:
```ts
import {
  correoPorAmbiente,
  plantillaCotizacion,
  plantillaDocumento,
  plantillaProforma,
  plantillaRecordatorio,
  type Mensaje,
  type ProveedorCorreo,
} from '@suite/correo'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
```
DESPUÉS:
```ts
import {
  plantillaCotizacion,
  plantillaDocumento,
  plantillaProforma,
  plantillaRecordatorio,
  type ProveedorCorreo,
} from '@suite/correo'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import {
  enviarRecordatorioDocumento,
  enviarYRegistrar,
  hace3Dias,
  proveedorCorreoConfigurado,
} from '../../lib/recordatorio'
```

**Edición B — constantes y `proveedorConfigurado` local fuera** (ANTISPAM y el selector viven ahora en el lib). ANTES:
```ts
const NO_CONFIGURADO = 'El correo no está configurado'
const SIN_EMAIL = 'El cliente no tiene correo registrado'
const ANTISPAM = 'Ya se envió un recordatorio hace menos de 3 días'

// Fail-closed (spec §4): solo 'mock' | 'resend'. El throw del selector (resend sin
// apiKey/remitente, u otro valor) se traga aquí y se vuelve el mensaje contractual —
// jamás llega un detalle del proveedor al usuario. PROHIBIDO el `?? 'mock'` de pagos.
function proveedorConfigurado(): ProveedorCorreo | null {
  const perilla = process.env.PROVEEDOR_CORREO
  if (perilla !== 'mock' && perilla !== 'resend') return null
  try {
    return correoPorAmbiente(perilla, process.env.RESEND_API_KEY, process.env.CORREO_REMITENTE)
  } catch {
    return null
  }
}
```
DESPUÉS:
```ts
const NO_CONFIGURADO = 'El correo no está configurado'
const SIN_EMAIL = 'El cliente no tiene correo registrado'
```
Y en `guardCorreo`, la línea `const proveedor = proveedorConfigurado()` pasa a `const proveedor = proveedorCorreoConfigurado()`.

**Edición C — borrar los helpers movidos.** Eliminar completo el bloque desde el comentario `// enviar() + registro DRY (spec §5): ...` hasta el cierre de `hace3Dias()` inclusive (líneas 67-100 del archivo actual: las funciones `enviarYRegistrar` y `hace3Dias` locales). Las 3 actions de cotización/proforma/documento y el masivo siguen llamando `enviarYRegistrar(...)`/`hace3Dias()` — ahora las importadas (misma firma).

**Edición D — `enviarRecordatorio` delega en el núcleo.** ANTES (cuerpo completo actual de la action individual, líneas 247-303). DESPUÉS:
```ts
// ---------- 4a) Recordatorio individual (anti-spam) ----------
export async function enviarRecordatorio(_prev: EstadoCorreo, formData: FormData): Promise<EstadoCorreo> {
  const documentoId = String(formData.get('documento_id') ?? '')
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  const supabase = await crearClienteServidor()
  const guard = await guardCorreo(supabase, activa.organizacion_id)
  if ('error' in guard) return guard

  // Nucleo compartido con la herramienta recordarFactura del bot (P21): vencida,
  // anti-spam 3 dias, plantilla, envio+log. Aqui solo guard de rol y revalidate.
  const resultado = await enviarRecordatorioDocumento(
    supabase,
    guard.proveedor,
    { id: activa.id, razonSocial: activa.razon_social, rut: activa.rut },
    documentoId,
  )
  if ('error' in resultado) return { error: resultado.error }
  revalidatePath('/cobranza')
  return { ok: true }
}
```

- [ ] **Step 4: Crear `apps/erp/lib/bot-herramientas.ts`**

```ts
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { HerramientasBot } from '@suite/bot'
import type { Database } from '@suite/db'
import { enviarRecordatorioDocumento, proveedorCorreoConfigurado } from './recordatorio'

// Las 7 herramientas del bot (spec §5): implementacion con el ADMIN client y TODAS
// las queries explicitamente filtradas por la empresa del vinculo (patron webhook MP
// P13). El motor redacta; aqui solo datos tipados.
type Admin = SupabaseClient<Database>

const hoyISO = () => new Date().toISOString().slice(0, 10)

export function herramientasBot(
  admin: Admin,
  empresaId: string,
  empresa: { razonSocial: string; rut: string },
  usuarioId: string,
): HerramientasBot {
  return {
    async ventasHoy() {
      const { data } = await admin
        .from('documentos_venta')
        .select('total')
        .eq('empresa_id', empresaId)
        .eq('estado', 'emitido')
        .in('tipo', ['factura', 'boleta'])
        .gte('emitido_en', hoyISO())
      const filas = data ?? []
      return { total: filas.reduce((s, d) => s + (d.total ?? 0), 0), documentos: filas.length }
    },

    async ventasMes() {
      const primerDia = hoyISO().slice(0, 8) + '01'
      const { data } = await admin
        .from('documentos_venta')
        .select('total')
        .eq('empresa_id', empresaId)
        .eq('estado', 'emitido')
        .in('tipo', ['factura', 'boleta'])
        .gte('emitido_en', primerDia)
      const filas = data ?? []
      return { total: filas.reduce((s, d) => s + (d.total ?? 0), 0), documentos: filas.length }
    },

    async cobranzaVencida() {
      const { data } = await admin
        .from('saldos_documentos')
        .select('cliente_razon_social, saldo')
        .eq('empresa_id', empresaId)
        .gt('saldo', 0)
        .lt('fecha_vencimiento', hoyISO())
      const porCliente = new Map<string, number>()
      let total = 0
      for (const f of data ?? []) {
        const saldo = f.saldo ?? 0
        total += saldo
        const cliente = f.cliente_razon_social ?? '—'
        porCliente.set(cliente, (porCliente.get(cliente) ?? 0) + saldo)
      }
      const deudores = [...porCliente.entries()]
        .map(([cliente, saldo]) => ({ cliente, saldo }))
        .sort((a, b) => b.saldo - a.saldo)
        .slice(0, 5)
      return { total, deudores }
    },

    async stockCritico() {
      // ponytail: "critico" = 5 o menos unidades sumando bodegas; umbral por producto
      // cuando el maestro gane stock_minimo.
      const { data } = await admin
        .from('stock_actual')
        .select('producto_id, cantidad')
        .eq('empresa_id', empresaId)
      const porProducto = new Map<string, number>()
      for (const m of data ?? []) {
        if (!m.producto_id) continue
        porProducto.set(m.producto_id, (porProducto.get(m.producto_id) ?? 0) + (m.cantidad ?? 0))
      }
      const criticos = [...porProducto.entries()]
        .filter(([, cantidad]) => cantidad <= 5)
        .sort((a, b) => a[1] - b[1])
        .slice(0, 5)
      if (criticos.length === 0) return []
      const { data: productos } = await admin
        .from('productos')
        .select('id, nombre')
        .eq('empresa_id', empresaId)
        .in('id', criticos.map(([id]) => id))
      const nombrePorId = new Map((productos ?? []).map((p) => [p.id, p.nombre]))
      return criticos.map(([id, cantidad]) => ({ producto: nombrePorId.get(id) ?? id, cantidad }))
    },

    async semaforoAuditor() {
      const ahora = new Date()
      const { data, error } = await admin.rpc('semaforo_whatsapp', {
        p_empresa: empresaId,
        p_usuario: usuarioId,
        p_anio: ahora.getFullYear(),
        p_mes: ahora.getMonth() + 1,
      })
      if (error || !data) return { estado: 'sin datos', observaciones: [] }
      const payload = data as { estado?: string; observaciones?: { titulo?: string; detalle?: string }[] }
      return {
        estado: payload.estado ?? 'sin datos',
        observaciones: (payload.observaciones ?? []).map((o) => `${o.titulo ?? ''}: ${o.detalle ?? ''}`),
      }
    },

    async saldoCliente(nombre) {
      const limpio = nombre.trim()
      if (!limpio) return null
      const { data: cliente } = await admin
        .from('clientes')
        .select('id, razon_social')
        .eq('empresa_id', empresaId)
        .ilike('razon_social', `%${limpio}%`)
        .order('razon_social')
        .limit(1)
        .maybeSingle()
      if (!cliente) return null
      const { data: saldos } = await admin
        .from('saldos_documentos')
        .select('saldo')
        .eq('empresa_id', empresaId)
        .eq('cliente_id', cliente.id)
      return { cliente: cliente.razon_social, saldo: (saldos ?? []).reduce((s, f) => s + (f.saldo ?? 0), 0) }
    },

    async recordarFactura(folio) {
      const proveedor = proveedorCorreoConfigurado()
      if (!proveedor) return { ok: false, detalle: 'El correo no está configurado' }
      const { data: fila } = await admin
        .from('saldos_documentos')
        .select('documento_id')
        .eq('empresa_id', empresaId)
        .eq('tipo', 'factura')
        .eq('folio', folio)
        .maybeSingle()
      if (!fila?.documento_id) {
        return { ok: false, detalle: `No encontré una factura con folio ${folio} y saldo pendiente.` }
      }
      const resultado = await enviarRecordatorioDocumento(
        admin,
        proveedor,
        { id: empresaId, razonSocial: empresa.razonSocial, rut: empresa.rut },
        fila.documento_id,
      )
      if ('error' in resultado) return { ok: false, detalle: resultado.error }
      return { ok: true, detalle: `Recordatorio enviado a ${resultado.para} por la factura N° ${folio}.` }
    },
  }
}
```

- [ ] **Step 5: Crear el webhook `apps/erp/app/api/webhooks/whatsapp/route.ts`**

```ts
import { clienteAdmin } from '@suite/auth/admin'
import { DISCULPA_BOT, motorPorAmbiente, type MotorBot, type TurnoHistorial } from '@suite/bot'
import { verificarFirma, whatsappPorAmbiente, type ProveedorWhatsApp } from '@suite/whatsapp'
import { herramientasBot } from '../../../../lib/bot-herramientas'

// Webhook de WhatsApp (Plan 21, spec §5). GET = verificacion de Meta (hub.challenge).
// POST nunca-lanza (200 SIEMPRE; 500 solo ante errores de BD transitorios, para que
// Meta reintente). Sin vinculo verificado -> instrucciones de vinculacion, CERO datos.
// Con vinculo -> herramientas de SU empresa (patron webhook MP P13) -> motor -> log
// entrante/saliente -> envio. Vive bajo api/webhooks/ para heredar la exclusion del
// middleware sin tocar el matcher.

const SIN_VINCULO =
  'Este número no está vinculado a ninguna empresa. El dueño o admin puede vincularlo en el ERP: Configuración → WhatsApp.'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const esperado = process.env.WHATSAPP_VERIFY_TOKEN
  const challenge = url.searchParams.get('hub.challenge')
  if (
    url.searchParams.get('hub.mode') === 'subscribe' &&
    esperado &&
    url.searchParams.get('hub.verify_token') === esperado &&
    challenge
  ) {
    return new Response(challenge, { status: 200 })
  }
  return new Response(null, { status: 403 })
}

// Payload de Meta: entry[].changes[].value.messages[] con from (SIN '+') y text.body.
// El simulador /mock-whatsapp postea este mismo shape.
function parsearEntrante(crudo: string): { telefono: string; texto: string } | null {
  try {
    const cuerpo = JSON.parse(crudo) as {
      entry?: { changes?: { value?: { messages?: { from?: string; type?: string; text?: { body?: string } }[] } }[] }[]
    }
    const msg = cuerpo.entry?.[0]?.changes?.[0]?.value?.messages?.[0]
    if (!msg || msg.type !== 'text' || !msg.from || !msg.text?.body) return null
    return { telefono: '+' + msg.from.replace(/^\+/, ''), texto: msg.text.body }
  } catch {
    return null
  }
}

export async function POST(req: Request) {
  const crudo = await req.text().catch(() => '')
  const perilla = process.env.PROVEEDOR_WHATSAPP

  // Firma obligatoria en cloud (invalida -> 200 silencioso); bypass SOLO en mock (el
  // simulador postea sin firmar); sin perilla valida no se procesa nada (fail-closed).
  if (perilla === 'cloud') {
    if (!verificarFirma(crudo, req.headers.get('x-hub-signature-256'), process.env.WHATSAPP_APP_SECRET ?? '')) {
      console.error('webhook whatsapp: firma inválida')
      return new Response(null, { status: 200 })
    }
  } else if (perilla !== 'mock') {
    console.error('webhook whatsapp: PROVEEDOR_WHATSAPP no configurado')
    return new Response(null, { status: 200 })
  }

  const entrante = parsearEntrante(crudo)
  if (!entrante) return new Response(null, { status: 200 })

  let proveedor: ProveedorWhatsApp
  let motor: MotorBot
  try {
    proveedor = whatsappPorAmbiente(
      perilla,
      process.env.WHATSAPP_TOKEN,
      process.env.WHATSAPP_PHONE_ID,
      process.env.WHATSAPP_VERIFY_TOKEN,
      process.env.WHATSAPP_APP_SECRET,
    )
    motor = motorPorAmbiente(process.env.MOTOR_BOT, process.env.ANTHROPIC_API_KEY, process.env.MOTOR_BOT_MODELO)
  } catch (e) {
    console.error('webhook whatsapp:', e instanceof Error ? e.message : 'selector no configurado')
    return new Response(null, { status: 200 })
  }

  const admin = clienteAdmin()

  // El vinculo verificado y activo es la UNICA llave de entrada a datos.
  const { data: vinculo, error: eVinculo } = await admin
    .from('whatsapp_vinculos')
    .select('empresa_id, usuario_id')
    .eq('telefono', entrante.telefono)
    .eq('activo', true)
    .not('verificado_en', 'is', null)
    .maybeSingle()
  if (eVinculo) {
    console.error('webhook whatsapp: error de BD al resolver el vínculo:', eVinculo.message)
    return new Response(null, { status: 500 })
  }
  if (!vinculo) {
    try {
      await proveedor.enviarTexto(entrante.telefono, SIN_VINCULO)
    } catch {
      // nunca-lanza: el numero desconocido simplemente no recibe respuesta.
    }
    return new Response(null, { status: 200 })
  }

  const { data: empresa } = await admin
    .from('empresas')
    .select('razon_social, rut, organizacion_id')
    .eq('id', vinculo.empresa_id)
    .maybeSingle()
  if (!empresa) {
    console.error('webhook whatsapp: vínculo sin empresa:', vinculo.empresa_id)
    return new Response(null, { status: 200 })
  }
  const { data: miembro } = await admin
    .from('miembros')
    .select('rol')
    .eq('organizacion_id', empresa.organizacion_id)
    .eq('usuario_id', vinculo.usuario_id)
    .eq('estado', 'activo')
    .maybeSingle()

  // Historial: ultimos 10 mensajes del telefono, en orden cronologico para el motor.
  const { data: previos } = await admin
    .from('whatsapp_mensajes')
    .select('direccion, contenido')
    .eq('empresa_id', vinculo.empresa_id)
    .eq('telefono', entrante.telefono)
    .order('creado_en', { ascending: false })
    .limit(10)
  const historial: TurnoHistorial[] = (previos ?? [])
    .reverse()
    .map((m) => ({ direccion: m.direccion === 'saliente' ? 'saliente' : 'entrante', contenido: m.contenido }))

  const { error: eLogIn } = await admin.from('whatsapp_mensajes').insert({
    empresa_id: vinculo.empresa_id,
    telefono: entrante.telefono,
    direccion: 'entrante',
    origen: 'bot',
    contenido: entrante.texto,
  })
  if (eLogIn) {
    console.error('webhook whatsapp: error de BD al loguear el entrante:', eLogIn.message)
    return new Response(null, { status: 500 })
  }

  let respuesta: string
  try {
    respuesta = await motor.responder(
      {
        nombreEmpresa: empresa.razon_social,
        rol: miembro?.rol ?? 'dueno',
        historial,
        herramientas: herramientasBot(
          admin,
          vinculo.empresa_id,
          { razonSocial: empresa.razon_social, rut: empresa.rut },
          vinculo.usuario_id,
        ),
      },
      entrante.texto,
    )
  } catch (e) {
    // ClaudeMotor nunca lanza; esto cubre un throw de herramienta bajo MockMotor.
    console.error('webhook whatsapp: motor:', e instanceof Error ? e.message : 'error desconocido')
    respuesta = DISCULPA_BOT
  }

  const { error: eLogOut } = await admin.from('whatsapp_mensajes').insert({
    empresa_id: vinculo.empresa_id,
    telefono: entrante.telefono,
    direccion: 'saliente',
    origen: 'bot',
    contenido: respuesta,
  })
  if (eLogOut) console.error('webhook whatsapp: error de BD al loguear el saliente:', eLogOut.message)

  try {
    await proveedor.enviarTexto(entrante.telefono, respuesta)
  } catch {
    // El envio fallo pero el log ya quedo; Meta no debe reintentar (el motor ya corrio).
  }
  return new Response(null, { status: 200 })
}
```

- [ ] **Step 6: Verificación**

```powershell
pnpm --filter erp build
```
→ compila sin errores; el listado de rutas incluye `ƒ /api/webhooks/whatsapp`.

```powershell
pnpm test
```
→ 257 verdes (el refactor no toca packages).

Byte-scan (Git Bash):
```bash
grep -c $'\xEF\xBB\xBF' apps/erp/lib/recordatorio.ts apps/erp/lib/bot-herramientas.ts apps/erp/app/api/webhooks/whatsapp/route.ts apps/erp/app/correo/acciones.ts
```
→ 0 por archivo.

- [ ] **Step 7: Commit**

```bash
git add apps/erp pnpm-lock.yaml
git commit -m "feat(erp): webhook de WhatsApp nunca-lanza, herramientas del bot por empresa y recordatorio compartido

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---
### Task 6: Configuración → WhatsApp (vinculación por código)

Baseline: pgTAP 458/21, unit 257, 3 builds.

**Files:**
- Create: `apps/erp/lib/whatsapp.ts`
- Create: `apps/erp/app/configuracion/whatsapp/acciones.ts`
- Create: `apps/erp/app/configuracion/whatsapp/page.tsx`
- Create: `apps/erp/componentes/formulario-whatsapp.tsx`
- Modify: `apps/erp/app/configuracion/page.tsx` (card nueva)

**Interfaces:**
- Consumes: RPCs de vinculación (T3), `esTelefonoE164`/`whatsappPorAmbiente` (T1), `obtenerEmpresaActiva`, `crearClienteServidor`.
- Produces (lo consume T7): `proveedorWhatsAppConfigurado(): ProveedorWhatsApp | null` y `WHATSAPP_NO_CONFIGURADO` en `apps/erp/lib/whatsapp.ts`; `EstadoWhatsApp = { error?, ok?, vinculoId?, telefono? }`.
- Los mensajes de error de las RPCs se muestran TAL CUAL (`error.message` byte-exacto: `Tu rol no permite gestionar WhatsApp`, `Código incorrecto o expirado`, `Ese teléfono ya está vinculado a otra cuenta`).

- [ ] **Step 1: Crear `apps/erp/lib/whatsapp.ts`**

```ts
import 'server-only'
import { whatsappPorAmbiente, type ProveedorWhatsApp } from '@suite/whatsapp'

// Fail-closed (patron proveedorCorreoConfigurado P10): solo 'mock' | 'cloud'. El
// throw del selector se traga aqui y se vuelve el mensaje contractual de la UI —
// jamas llega un detalle del proveedor al usuario. PROHIBIDO el `?? 'mock'`.
export const WHATSAPP_NO_CONFIGURADO = 'WhatsApp no está configurado'

export function proveedorWhatsAppConfigurado(): ProveedorWhatsApp | null {
  const perilla = process.env.PROVEEDOR_WHATSAPP
  if (perilla !== 'mock' && perilla !== 'cloud') return null
  try {
    return whatsappPorAmbiente(
      perilla,
      process.env.WHATSAPP_TOKEN,
      process.env.WHATSAPP_PHONE_ID,
      process.env.WHATSAPP_VERIFY_TOKEN,
      process.env.WHATSAPP_APP_SECRET,
    )
  } catch {
    return null
  }
}
```

- [ ] **Step 2: Crear `apps/erp/app/configuracion/whatsapp/acciones.ts`**

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@suite/auth/server'
import { esTelefonoE164 } from '@suite/whatsapp'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { proveedorWhatsAppConfigurado, WHATSAPP_NO_CONFIGURADO } from '../../../lib/whatsapp'

// Estados type-only (permitidos en 'use server': se borran al compilar).
export type EstadoWhatsApp = { error?: string; ok?: boolean; vinculoId?: string; telefono?: string }

// Solicitar: la RPC valida rol/formato y genera el codigo; el ENVIO del codigo lo
// hace esta action via el proveedor (la RPC no habla con el mundo, spec 4.1). El
// codigo se lee por RLS (SELECT dueno/admin de su empresa) y el envio se loguea con
// origen 'vinculacion' (visible en /mock-whatsapp).
export async function solicitarVinculo(_prev: EstadoWhatsApp, formData: FormData): Promise<EstadoWhatsApp> {
  const telefono = String(formData.get('telefono') ?? '').trim()
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  const proveedor = proveedorWhatsAppConfigurado()
  if (!proveedor) return { error: WHATSAPP_NO_CONFIGURADO }
  if (!esTelefonoE164(telefono)) return { error: 'Teléfono no válido: usa formato internacional +56...' }

  const supabase = await crearClienteServidor()
  const { data: vinculoId, error } = await supabase.rpc('solicitar_vinculo_whatsapp', {
    p_empresa: activa.id,
    p_telefono: telefono,
  })
  if (error || !vinculoId) return { error: error?.message ?? 'No se pudo solicitar el vínculo' }

  const { data: fila } = await supabase
    .from('whatsapp_vinculos')
    .select('codigo')
    .eq('id', vinculoId)
    .eq('empresa_id', activa.id)
    .maybeSingle()
  if (!fila?.codigo) return { error: 'No se pudo generar el código. Intenta de nuevo.' }

  const texto = `Tu código para vincular este WhatsApp con ${activa.razon_social} es ${fila.codigo}. Vence en 10 minutos.`
  try {
    await proveedor.enviarTexto(telefono, texto)
  } catch {
    return { error: 'No se pudo enviar el WhatsApp. Intenta de nuevo.' }
  }
  await supabase.from('whatsapp_mensajes').insert({
    empresa_id: activa.id,
    telefono,
    direccion: 'saliente',
    origen: 'vinculacion',
    contenido: texto,
  })
  revalidatePath('/configuracion/whatsapp')
  return { ok: true, vinculoId, telefono }
}

export async function confirmarVinculo(_prev: EstadoWhatsApp, formData: FormData): Promise<EstadoWhatsApp> {
  const vinculoId = String(formData.get('vinculo_id') ?? '')
  const codigo = String(formData.get('codigo') ?? '').trim()
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  if (!vinculoId || !codigo) return { error: 'Ingresa el código que te llegó por WhatsApp' }
  const supabase = await crearClienteServidor()
  const { error } = await supabase.rpc('confirmar_vinculo_whatsapp', {
    p_empresa: activa.id,
    p_vinculo: vinculoId,
    p_codigo: codigo,
  })
  // Mensajes de la RPC byte-exactos (Codigo incorrecto o expirado / telefono ajeno).
  if (error) return { error: error.message }
  revalidatePath('/configuracion/whatsapp')
  return { ok: true }
}

export async function desvincularWhatsApp(_prev: EstadoWhatsApp, formData: FormData): Promise<EstadoWhatsApp> {
  const vinculoId = String(formData.get('vinculo_id') ?? '')
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  if (!vinculoId) return { error: 'Vínculo no válido' }
  const supabase = await crearClienteServidor()
  const { error } = await supabase.rpc('desvincular_whatsapp', { p_empresa: activa.id, p_vinculo: vinculoId })
  if (error) return { error: error.message }
  revalidatePath('/configuracion/whatsapp')
  return { ok: true }
}
```

- [ ] **Step 3: Crear `apps/erp/app/configuracion/whatsapp/page.tsx`**

```tsx
import { crearClienteServidor } from '@suite/auth/server'
import { Encabezado } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { FormularioWhatsApp } from '../../../componentes/formulario-whatsapp'
import { confirmarVinculo, desvincularWhatsApp, solicitarVinculo } from './acciones'

export default async function ConfigWhatsApp() {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const supabase = await crearClienteServidor()
  // El vinculo verificado activo (a lo mas uno visible aqui; RLS dueno/admin).
  const { data: vinculos } = await supabase
    .from('whatsapp_vinculos')
    .select('id, telefono, verificado_en')
    .eq('empresa_id', activa.id)
    .eq('activo', true)
    .not('verificado_en', 'is', null)
    .order('creado_en', { ascending: false })
    .limit(1)
  const vinculo = vinculos?.[0] ?? null

  return (
    <div>
      <Encabezado titulo="WhatsApp" />
      <p className="mb-4 max-w-2xl text-sm text-slate-600">
        Vincula el teléfono del dueño o admin para conversar con tu ERP por WhatsApp (ventas, cobranza,
        stock, auditor y recordatorios de facturas). Te enviaremos un código de 6 dígitos para verificarlo.
      </p>
      <FormularioWhatsApp
        solicitar={solicitarVinculo}
        confirmar={confirmarVinculo}
        desvincular={desvincularWhatsApp}
        vinculo={vinculo}
      />
    </div>
  )
}
```

- [ ] **Step 4: Crear `apps/erp/componentes/formulario-whatsapp.tsx`**

```tsx
'use client'

import { useActionState } from 'react'
import { Boton, Campo, Entrada, Insignia, Tarjeta } from '@suite/ui'
import type { EstadoWhatsApp } from '../app/configuracion/whatsapp/acciones'

type AccionWhatsApp = (prev: EstadoWhatsApp, formData: FormData) => Promise<EstadoWhatsApp>

// Flujo de dos pasos (spec §6): telefono -> "te enviamos un codigo" -> confirmar ->
// Vinculado (telefono + fecha) con Desvincular. Errores de RPC byte-exactos inline.
export function FormularioWhatsApp({
  solicitar,
  confirmar,
  desvincular,
  vinculo,
}: {
  solicitar: AccionWhatsApp
  confirmar: AccionWhatsApp
  desvincular: AccionWhatsApp
  vinculo: { id: string; telefono: string; verificado_en: string | null } | null
}) {
  const [estadoSolicitud, enviarSolicitud, pendienteSolicitud] = useActionState(solicitar, {} as EstadoWhatsApp)
  const [estadoCodigo, enviarCodigo, pendienteCodigo] = useActionState(confirmar, {} as EstadoWhatsApp)
  const [estadoDesvincular, enviarDesvincular, pendienteDesvincular] = useActionState(desvincular, {} as EstadoWhatsApp)

  if (vinculo) {
    return (
      <Tarjeta className="max-w-2xl">
        <div className="mb-4 flex items-center gap-2">
          <span className="text-sm font-medium text-slate-700">Estado:</span>
          <Insignia tono="verde">Vinculado</Insignia>
        </div>
        <p className="text-sm text-slate-700">
          Teléfono <strong>{vinculo.telefono}</strong>
          {vinculo.verificado_en && <> · vinculado el {new Date(vinculo.verificado_en).toLocaleDateString('es-CL')}</>}
        </p>
        <form action={enviarDesvincular} className="mt-4 flex items-center gap-2">
          <input type="hidden" name="vinculo_id" value={vinculo.id} />
          <Boton variante="secundario" type="submit" disabled={pendienteDesvincular}>
            {pendienteDesvincular ? 'Desvinculando…' : 'Desvincular'}
          </Boton>
          {estadoDesvincular.error && <span className="text-sm text-red-600">{estadoDesvincular.error}</span>}
        </form>
      </Tarjeta>
    )
  }

  if (estadoSolicitud.vinculoId && !estadoCodigo.ok) {
    return (
      <Tarjeta className="max-w-2xl">
        <p className="mb-4 text-sm text-slate-700">
          Te enviamos un código por WhatsApp al <strong>{estadoSolicitud.telefono}</strong>. Vence en 10
          minutos. (En modo mock, míralo en <code className="rounded bg-slate-100 px-1">/mock-whatsapp</code>.)
        </p>
        <form action={enviarCodigo} className="grid max-w-xs grid-cols-1 gap-4">
          <input type="hidden" name="vinculo_id" value={estadoSolicitud.vinculoId} />
          <Campo etiqueta="Código de 6 dígitos *">
            <Entrada name="codigo" required autoComplete="one-time-code" inputMode="numeric" maxLength={6} />
          </Campo>
          <div className="flex items-center gap-2">
            <Boton type="submit" disabled={pendienteCodigo}>
              {pendienteCodigo ? 'Confirmando…' : 'Confirmar código'}
            </Boton>
            {estadoCodigo.error && <span className="text-sm text-red-600">{estadoCodigo.error}</span>}
          </div>
        </form>
      </Tarjeta>
    )
  }

  return (
    <Tarjeta className="max-w-2xl">
      <div className="mb-4 flex items-center gap-2">
        <span className="text-sm font-medium text-slate-700">Estado:</span>
        <Insignia tono="amarillo">Sin vincular</Insignia>
      </div>
      <form action={enviarSolicitud} className="grid max-w-xs grid-cols-1 gap-4">
        <Campo etiqueta="Teléfono (formato internacional) *">
          <Entrada name="telefono" required placeholder="+56912345678" />
        </Campo>
        <div className="flex items-center gap-2">
          <Boton type="submit" disabled={pendienteSolicitud}>
            {pendienteSolicitud ? 'Enviando…' : 'Enviar código por WhatsApp'}
          </Boton>
          {estadoSolicitud.error && <span className="text-sm text-red-600">{estadoSolicitud.error}</span>}
        </div>
      </form>
    </Tarjeta>
  )
}
```

- [ ] **Step 5: Card en `apps/erp/app/configuracion/page.tsx`**

ANTES (bloque final del grid):
```tsx
        <Link href="/configuracion/suscripcion" className="block">
          <Tarjeta className="h-full transition hover:border-marca-500">
            <h2 className="mb-1 text-lg font-semibold text-slate-800">Suscripción</h2>
            <p className="text-sm text-slate-600">Estado de tu plan y pago mensual con MercadoPago o Webpay.</p>
          </Tarjeta>
        </Link>
      </div>
```
DESPUÉS:
```tsx
        <Link href="/configuracion/suscripcion" className="block">
          <Tarjeta className="h-full transition hover:border-marca-500">
            <h2 className="mb-1 text-lg font-semibold text-slate-800">Suscripción</h2>
            <p className="text-sm text-slate-600">Estado de tu plan y pago mensual con MercadoPago o Webpay.</p>
          </Tarjeta>
        </Link>
        <Link href="/configuracion/whatsapp" className="block">
          <Tarjeta className="h-full transition hover:border-marca-500">
            <h2 className="mb-1 text-lg font-semibold text-slate-800">WhatsApp</h2>
            <p className="text-sm text-slate-600">Vincula tu teléfono para hablar con el ERP y cobrar por WhatsApp.</p>
          </Tarjeta>
        </Link>
      </div>
```

- [ ] **Step 6: Verificación**

```powershell
pnpm --filter erp build
```
→ compila; el listado incluye `ƒ /configuracion/whatsapp`.

Byte-scan (Git Bash): `grep -c $'\xEF\xBB\xBF' apps/erp/lib/whatsapp.ts apps/erp/app/configuracion/whatsapp/acciones.ts apps/erp/app/configuracion/whatsapp/page.tsx apps/erp/componentes/formulario-whatsapp.tsx apps/erp/app/configuracion/page.tsx` → 0 por archivo.

- [ ] **Step 7: Commit**

```bash
git add apps/erp
git commit -m "feat(erp): vinculación de WhatsApp por código de 6 dígitos en Configuración

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: `/cobranza` — botón WhatsApp y recordatorios con canal

Baseline: pgTAP 458/21, unit 257, 3 builds.

**Files:**
- Create: `apps/erp/app/cobranza/acciones-whatsapp.ts`
- Create: `apps/erp/componentes/boton-whatsapp.tsx`
- Modify: `apps/erp/app/cobranza/page.tsx` (5 ediciones abajo)

**Interfaces:**
- Consumes: `proveedorWhatsAppConfigurado`/`WHATSAPP_NO_CONFIGURADO` (T6), `hace3Dias` (T5), `esTelefonoE164`/`plantillaRecordatorioWhatsApp` (T1), `EstadoCorreo` (tipo existente de `app/correo/acciones.ts`), tabla `whatsapp_mensajes` (T3).
- Produces: action `recordarPorWhatsApp(prev: EstadoCorreo, formData): Promise<EstadoCorreo>` (input hidden `documento_id`), componente `BotonWhatsApp`.
- Anti-spam PROPIO del canal: 3 días sobre `whatsapp_mensajes` con `origen='cobranza'` + `referencia_id` (independiente del anti-spam de correo).

- [ ] **Step 1: Crear `apps/erp/app/cobranza/acciones-whatsapp.ts`**

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@suite/auth/server'
import { esTelefonoE164, plantillaRecordatorioWhatsApp } from '@suite/whatsapp'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import { hace3Dias } from '../../lib/recordatorio'
import { proveedorWhatsAppConfigurado, WHATSAPP_NO_CONFIGURADO } from '../../lib/whatsapp'
import type { EstadoCorreo } from '../correo/acciones'

const SIN_TELEFONO = 'El cliente no tiene teléfono registrado'
const ANTISPAM_WHATSAPP = 'Ya se envió un recordatorio por WhatsApp hace menos de 3 días'

// Recordatorio de cobranza POR WHATSAPP (spec §6): mismas validaciones de vencida que
// el correo, anti-spam propio de 3 dias sobre whatsapp_mensajes (origen 'cobranza' +
// referencia_id) y log inmutable. Guard dueno/admin: coincide con el INSERT RLS de
// whatsapp_mensajes y con quien gestiona WhatsApp.
export async function recordarPorWhatsApp(_prev: EstadoCorreo, formData: FormData): Promise<EstadoCorreo> {
  const documentoId = String(formData.get('documento_id') ?? '')
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  if (activa.rol !== 'dueno' && activa.rol !== 'admin') return { error: 'Tu rol no permite enviar WhatsApp' }
  const proveedor = proveedorWhatsAppConfigurado()
  if (!proveedor) return { error: WHATSAPP_NO_CONFIGURADO }

  const supabase = await crearClienteServidor()
  const { data: fila } = await supabase
    .from('saldos_documentos')
    .select('documento_id, tipo, folio, saldo, fecha_vencimiento, cliente_id, cliente_razon_social')
    .eq('empresa_id', activa.id)
    .eq('documento_id', documentoId)
    .maybeSingle()
  if (!fila || !fila.documento_id) return { error: 'La factura no existe o no tiene saldo' }
  const hoy = new Date().toISOString().slice(0, 10)
  if ((fila.saldo ?? 0) <= 0 || !fila.fecha_vencimiento || fila.fecha_vencimiento >= hoy) {
    return { error: 'La factura no está vencida con saldo pendiente' }
  }

  const { data: reciente } = await supabase
    .from('whatsapp_mensajes')
    .select('id')
    .eq('empresa_id', activa.id)
    .eq('origen', 'cobranza')
    .eq('referencia_id', documentoId)
    .gte('creado_en', hace3Dias())
    .limit(1)
    .maybeSingle()
  if (reciente) return { error: ANTISPAM_WHATSAPP }

  if (!fila.cliente_id) return { error: SIN_TELEFONO }
  const { data: cliente } = await supabase
    .from('clientes')
    .select('telefono')
    .eq('empresa_id', activa.id)
    .eq('id', fila.cliente_id)
    .maybeSingle()
  const telefono = cliente?.telefono?.trim() ?? ''
  if (!telefono) return { error: SIN_TELEFONO }
  if (!esTelefonoE164(telefono)) return { error: 'El teléfono del cliente no está en formato internacional (+56...)' }

  const texto = plantillaRecordatorioWhatsApp({
    empresaRazonSocial: activa.razon_social,
    clienteRazonSocial: fila.cliente_razon_social ?? '',
    tipo: fila.tipo === 'boleta' ? 'boleta' : 'factura',
    folio: fila.folio ?? 0,
    saldo: fila.saldo ?? 0,
    fechaVencimiento: new Date(fila.fecha_vencimiento).toLocaleDateString('es-CL'),
  })
  try {
    await proveedor.enviarTexto(telefono, texto)
  } catch {
    return { error: 'No se pudo enviar el WhatsApp. Intenta de nuevo.' }
  }
  const { error } = await supabase.from('whatsapp_mensajes').insert({
    empresa_id: activa.id,
    telefono,
    direccion: 'saliente',
    origen: 'cobranza',
    contenido: texto,
    referencia_id: documentoId,
  })
  if (error) return { error: 'El WhatsApp se envió pero no se pudo registrar el envío.' }
  revalidatePath('/cobranza')
  return { ok: true }
}
```

- [ ] **Step 2: Crear `apps/erp/componentes/boton-whatsapp.tsx`**

```tsx
'use client'

import { useActionState } from 'react'
import { Boton } from '@suite/ui'
import type { EstadoCorreo } from '../app/correo/acciones'

// Espejo de BotonRecordar (canal WhatsApp): la page solo lo muestra en vencidas cuyo
// cliente tiene telefono.
export function BotonWhatsApp({
  accion,
  documentoId,
}: {
  accion: (prev: EstadoCorreo, formData: FormData) => Promise<EstadoCorreo>
  documentoId: string
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoCorreo)
  return (
    <form action={enviar} className="flex items-center gap-2">
      <input type="hidden" name="documento_id" value={documentoId} />
      <Boton variante="secundario" type="submit" disabled={pendiente} className="px-2 py-1 text-xs">
        {pendiente ? '…' : 'WhatsApp'}
      </Boton>
      {estado.error && <span className="text-xs text-red-600">{estado.error}</span>}
      {estado.ok && !estado.error && <span className="text-xs text-green-700">Enviado</span>}
    </form>
  )
}
```

- [ ] **Step 3: Ediciones en `apps/erp/app/cobranza/page.tsx` (5, byte-exactas)**

**Edición A — imports.** ANTES:
```tsx
import { BotonRecordar, BotonRecordarTodas } from '../../componentes/boton-enviar-correo'
```
DESPUÉS:
```tsx
import { BotonRecordar, BotonRecordarTodas } from '../../componentes/boton-enviar-correo'
import { BotonWhatsApp } from '../../componentes/boton-whatsapp'
```
Y ANTES:
```tsx
import { enviarRecordatorio, enviarRecordatorios } from '../correo/acciones'
```
DESPUÉS:
```tsx
import { enviarRecordatorio, enviarRecordatorios } from '../correo/acciones'
import { recordarPorWhatsApp } from './acciones-whatsapp'
```

**Edición B — teléfono en el query de clientes.** ANTES:
```tsx
    supabase.from('clientes').select('id, razon_social').eq('empresa_id', activa.id).eq('activo', true).order('razon_social'),
```
DESPUÉS:
```tsx
    supabase.from('clientes').select('id, razon_social, telefono').eq('empresa_id', activa.id).eq('activo', true).order('razon_social'),
```

**Edición C — mapa de teléfonos.** ANTES:
```tsx
  const hoy = HOY()
  let filas = consultaSaldos.data ?? []
```
DESPUÉS:
```tsx
  const hoy = HOY()
  let filas = consultaSaldos.data ?? []
  const telefonoPorCliente = new Map((clientes ?? []).map((c) => [c.id, c.telefono]))
```

**Edición D — recordatorios de AMBOS canales.** ANTES:
```tsx
  const { data: recordatorios } = await supabase
    .from('correos_enviados')
    .select('id, referencia_id, para, asunto, creado_en')
    .eq('empresa_id', activa.id)
    .eq('tipo', 'recordatorio')
    .order('creado_en', { ascending: false })
    .limit(200)
  const listaRecordatorios = recordatorios ?? []
  const ultimoRecordatorio = new Map<string, string>()
  for (const r of listaRecordatorios) {
    if (!ultimoRecordatorio.has(r.referencia_id)) ultimoRecordatorio.set(r.referencia_id, r.creado_en)
  }
  const recientes = listaRecordatorios.slice(0, 20)
  const idsRecordados = [...new Set(recientes.map((r) => r.referencia_id))]
```
DESPUÉS:
```tsx
  const [{ data: recordatorios }, { data: recordatoriosWa }] = await Promise.all([
    supabase
      .from('correos_enviados')
      .select('id, referencia_id, para, asunto, creado_en')
      .eq('empresa_id', activa.id)
      .eq('tipo', 'recordatorio')
      .order('creado_en', { ascending: false })
      .limit(200),
    supabase
      .from('whatsapp_mensajes')
      .select('id, referencia_id, telefono, contenido, creado_en')
      .eq('empresa_id', activa.id)
      .eq('origen', 'cobranza')
      .order('creado_en', { ascending: false })
      .limit(200),
  ])
  const listaRecordatorios = recordatorios ?? []
  const ultimoRecordatorio = new Map<string, string>()
  for (const r of listaRecordatorios) {
    if (!ultimoRecordatorio.has(r.referencia_id)) ultimoRecordatorio.set(r.referencia_id, r.creado_en)
  }
  // Ambos canales en una sola lista con etiqueta (spec §6); 20 mas recientes.
  const recientes = [
    ...listaRecordatorios.map((r) => ({
      id: r.id,
      canal: 'correo' as const,
      referencia_id: r.referencia_id,
      destinatario: r.para,
      resumen: r.asunto,
      creado_en: r.creado_en,
    })),
    ...(recordatoriosWa ?? []).map((r) => ({
      id: r.id,
      canal: 'whatsapp' as const,
      referencia_id: r.referencia_id ?? '',
      destinatario: r.telefono,
      resumen: r.contenido,
      creado_en: r.creado_en,
    })),
  ]
    .sort((a, b) => (a.creado_en < b.creado_en ? 1 : -1))
    .slice(0, 20)
  const idsRecordados = [...new Set(recientes.map((r) => r.referencia_id).filter(Boolean))]
```

**Edición E — botón en la fila.** ANTES:
```tsx
                    {venc && f.documento_id && (
                      <BotonRecordar accion={enviarRecordatorio} documentoId={f.documento_id} />
                    )}
                  </div>
```
DESPUÉS:
```tsx
                    {venc && f.documento_id && (
                      <BotonRecordar accion={enviarRecordatorio} documentoId={f.documento_id} />
                    )}
                    {venc && f.documento_id && f.cliente_id && telefonoPorCliente.get(f.cliente_id) && (
                      <BotonWhatsApp accion={recordarPorWhatsApp} documentoId={f.documento_id} />
                    )}
                  </div>
```

**Edición F — sección con columna Canal.** ANTES:
```tsx
        <Tabla>
          <thead><tr><Th>Fecha</Th><Th>Documento</Th><Th>Destinatario</Th><Th>Asunto</Th><Th /></tr></thead>
          <tbody>
            {recientes.map((r) => (
              <Tr key={r.id}>
                <Td>{new Date(r.creado_en).toLocaleDateString('es-CL')}</Td>
                <Td>{mapaDocRecordado.get(r.referencia_id) ?? '—'}</Td>
                <Td>{r.para}</Td>
                <Td className="max-w-md truncate">{r.asunto}</Td>
                <Td className="text-right"><Link className="text-sm text-marca-700 hover:underline" href={`/correo/${r.id}`}>Ver</Link></Td>
              </Tr>
            ))}
            {recientes.length === 0 && <Tr><Td colSpan={5} className="py-8 text-center text-slate-500">Aún no se envían recordatorios.</Td></Tr>}
          </tbody>
        </Tabla>
```
DESPUÉS:
```tsx
        <Tabla>
          <thead><tr><Th>Fecha</Th><Th>Canal</Th><Th>Documento</Th><Th>Destinatario</Th><Th>Mensaje</Th><Th /></tr></thead>
          <tbody>
            {recientes.map((r) => (
              <Tr key={`${r.canal}-${r.id}`}>
                <Td>{new Date(r.creado_en).toLocaleDateString('es-CL')}</Td>
                <Td>{r.canal === 'correo' ? 'Correo' : 'WhatsApp'}</Td>
                <Td>{r.referencia_id ? (mapaDocRecordado.get(r.referencia_id) ?? '—') : '—'}</Td>
                <Td>{r.destinatario}</Td>
                <Td className="max-w-md truncate">{r.resumen}</Td>
                <Td className="text-right">
                  {r.canal === 'correo' && (
                    <Link className="text-sm text-marca-700 hover:underline" href={`/correo/${r.id}`}>Ver</Link>
                  )}
                </Td>
              </Tr>
            ))}
            {recientes.length === 0 && <Tr><Td colSpan={6} className="py-8 text-center text-slate-500">Aún no se envían recordatorios.</Td></Tr>}
          </tbody>
        </Tabla>
```

- [ ] **Step 4: Verificación**

```powershell
pnpm --filter erp build
```
→ compila sin errores (misma lista de rutas + las de T5/T6).

Byte-scan (Git Bash): `grep -c $'\xEF\xBB\xBF' apps/erp/app/cobranza/acciones-whatsapp.ts apps/erp/componentes/boton-whatsapp.tsx apps/erp/app/cobranza/page.tsx` → 0 por archivo.

- [ ] **Step 5: Commit**

```bash
git add apps/erp
git commit -m "feat(erp): recordatorio de cobranza por WhatsApp con anti-spam propio y canal en el historial

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---
### Task 8: Simulador `/mock-whatsapp` (chat de dos paneles contra el webhook real)

Baseline: pgTAP 458/21, unit 257, 3 builds.

**Files:**
- Create: `apps/erp/app/mock-whatsapp/page.tsx`
- Create: `apps/erp/app/mock-whatsapp/acciones.ts`
- Create: `apps/erp/componentes/formulario-mock-whatsapp.tsx`

**Interfaces:**
- Consumes: `whatsappMockEnviados` (T1), webhook `POST /api/webhooks/whatsapp` (T5), log `whatsapp_mensajes` (T3), `esTelefonoE164` (T1).
- Gate estricto `PROVEEDOR_WHATSAPP === 'mock'` (comparación estricta → `notFound()`, patrón /mock-pago). La ruta queda CON sesión (patrón /mock-correo): NO se toca el matcher del middleware. El submit postea el shape de Meta al webhook real (bypass de firma porque el webhook en mock no la exige) — el flujo vínculo→motor→log→envío corre completo.
- Produces: `EstadoMockWhatsApp = { error?: string; ok?: boolean }`.

- [ ] **Step 1: Crear `apps/erp/app/mock-whatsapp/acciones.ts`**

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { esTelefonoE164 } from '@suite/whatsapp'

export type EstadoMockWhatsApp = { error?: string; ok?: boolean }

// El submit del simulador postea el MISMO shape de Meta al webhook real por HTTP
// (patron simularPago de /mock-pago): firma bypass SOLO en mock, y el flujo completo
// — vinculo, motor, herramientas, log, envio — corre tal cual correria con Meta.
export async function simularEntrante(_prev: EstadoMockWhatsApp, formData: FormData): Promise<EstadoMockWhatsApp> {
  if (process.env.PROVEEDOR_WHATSAPP !== 'mock') return { error: 'El simulador de WhatsApp no está disponible' }
  const telefono = String(formData.get('telefono') ?? '').trim()
  const texto = String(formData.get('texto') ?? '').trim()
  if (!esTelefonoE164(telefono)) return { error: 'Teléfono no válido: usa formato internacional +56...' }
  if (!texto) return { error: 'Escribe un mensaje' }

  const h = await headers()
  const host = h.get('host') ?? 'localhost:3001'
  const proto = h.get('x-forwarded-proto') ?? 'http'
  const cuerpo = JSON.stringify({
    entry: [{ changes: [{ value: { messages: [{ from: telefono.slice(1), type: 'text', text: { body: texto } }] } }] }],
  })
  const respuesta = await fetch(`${proto}://${host}/api/webhooks/whatsapp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: cuerpo,
    cache: 'no-store',
  })
  if (!respuesta.ok) return { error: `El webhook respondió ${respuesta.status}` }
  revalidatePath('/mock-whatsapp')
  return { ok: true }
}
```

- [ ] **Step 2: Crear `apps/erp/componentes/formulario-mock-whatsapp.tsx`**

```tsx
'use client'

import { useActionState } from 'react'
import { Boton, Entrada } from '@suite/ui'
import type { EstadoMockWhatsApp } from '../app/mock-whatsapp/acciones'

// "Teclado del celular": telefono + texto -> action que postea al webhook real.
export function FormularioMockWhatsApp({
  accion,
  telefonoInicial,
}: {
  accion: (prev: EstadoMockWhatsApp, formData: FormData) => Promise<EstadoMockWhatsApp>
  telefonoInicial: string
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoMockWhatsApp)
  return (
    <form action={enviar} className="flex flex-wrap items-center gap-2">
      <Entrada name="telefono" defaultValue={telefonoInicial} placeholder="+56912345678" required className="w-44 font-mono" />
      <Entrada name="texto" placeholder="Escribe como si fueras el celular…" required className="min-w-0 flex-1" />
      <Boton type="submit" disabled={pendiente}>{pendiente ? 'Enviando…' : 'Enviar'}</Boton>
      {estado.error && <span className="text-sm text-red-600">{estado.error}</span>}
    </form>
  )
}
```

- [ ] **Step 3: Crear `apps/erp/app/mock-whatsapp/page.tsx`**

```tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { whatsappMockEnviados } from '@suite/whatsapp'
import { Encabezado, Tarjeta } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import { FormularioMockWhatsApp } from '../../componentes/formulario-mock-whatsapp'
import { simularEntrante } from './acciones'

// Simulador de chat (spec §6, patron /mock-correo + /mock-pago): panel de telefonos +
// hilo del log de la empresa activa + bandeja mock (lo que "llego al celular", incluye
// codigos de vinculacion y respuestas a numeros sin vinculo). Gate estricto.
export default async function SimuladorWhatsApp({ searchParams }: { searchParams: Promise<{ tel?: string }> }) {
  if (process.env.PROVEEDOR_WHATSAPP !== 'mock') notFound()
  const { tel = '' } = await searchParams
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const supabase = await crearClienteServidor()

  const { data: mensajes } = await supabase
    .from('whatsapp_mensajes')
    .select('telefono')
    .eq('empresa_id', activa.id)
    .order('creado_en', { ascending: false })
    .limit(500)
  const bandeja = [...whatsappMockEnviados()].reverse()
  const telefonos = [
    ...new Set([...(mensajes ?? []).map((m) => m.telefono), ...bandeja.map((b) => b.telefono), ...(tel ? [tel] : [])]),
  ]

  const { data: hilo } = tel
    ? await supabase
        .from('whatsapp_mensajes')
        .select('id, direccion, origen, contenido, creado_en')
        .eq('empresa_id', activa.id)
        .eq('telefono', tel)
        .order('creado_en', { ascending: true })
        .limit(100)
    : { data: [] as { id: string; direccion: string; origen: string; contenido: string; creado_en: string }[] }
  const bandejaTel = bandeja.filter((b) => b.telefono === tel)

  return (
    <div>
      <Encabezado titulo="Simulador de WhatsApp (mock)" />
      <p className="mb-4 text-sm text-slate-600">
        Chat de prueba local: escribe como si fueras el celular y el webhook real responde con el bot.
        No se envía nada de verdad.
      </p>
      <div className="grid max-w-5xl grid-cols-1 gap-4 md:grid-cols-[16rem_1fr]">
        <Tarjeta>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Teléfonos</h2>
          <ul className="space-y-1">
            {telefonos.map((t) => (
              <li key={t}>
                <Link
                  className={`block rounded px-2 py-1 font-mono text-sm ${t === tel ? 'bg-slate-100 font-semibold text-marca-700' : 'text-slate-700 hover:bg-slate-50'}`}
                  href={`/mock-whatsapp?tel=${encodeURIComponent(t)}`}
                >
                  {t}
                </Link>
              </li>
            ))}
            {telefonos.length === 0 && <li className="text-sm text-slate-500">Sin conversaciones aún.</li>}
          </ul>
          <p className="mt-3 text-xs text-slate-500">
            Elige un teléfono o escribe uno nuevo abajo (E.164, ej. +56912345678). Tras escribir a un
            teléfono nuevo, haz clic en él para ver su hilo.
          </p>
        </Tarjeta>
        <Tarjeta>
          {tel ? (
            <>
              <h2 className="mb-3 text-sm font-semibold text-slate-700">
                Conversación con <span className="font-mono">{tel}</span>
              </h2>
              <div className="mb-4 max-h-96 space-y-2 overflow-y-auto rounded border border-slate-200 bg-slate-50 p-3">
                {(hilo ?? []).map((m) => (
                  <div key={m.id} className={m.direccion === 'entrante' ? 'flex justify-end' : 'flex justify-start'}>
                    <div
                      className={`max-w-md whitespace-pre-wrap rounded-lg px-3 py-2 text-sm text-slate-800 ${
                        m.direccion === 'entrante' ? 'bg-green-100' : 'border border-slate-200 bg-white'
                      }`}
                    >
                      {m.contenido}
                      <div className="mt-1 text-right text-[10px] text-slate-400">
                        {m.origen} · {new Date(m.creado_en).toLocaleTimeString('es-CL')}
                      </div>
                    </div>
                  </div>
                ))}
                {(hilo ?? []).length === 0 && (
                  <p className="text-sm text-slate-500">Sin mensajes en el log para este teléfono.</p>
                )}
              </div>
              {bandejaTel.length > 0 && (
                <div className="mb-4">
                  <h3 className="mb-1 text-xs font-semibold uppercase text-slate-500">
                    Bandeja mock (lo que llegó al celular)
                  </h3>
                  <ul className="space-y-1">
                    {bandejaTel.map((b) => (
                      <li
                        key={b.id}
                        className="whitespace-pre-wrap rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                      >
                        {b.texto}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <p className="mb-4 text-sm text-slate-500">Elige o escribe un teléfono para ver su conversación.</p>
          )}
          <FormularioMockWhatsApp key={tel} accion={simularEntrante} telefonoInicial={tel} />
        </Tarjeta>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Verificación**

```powershell
pnpm --filter erp build
```
→ compila; el listado incluye `ƒ /mock-whatsapp`.

Byte-scan (Git Bash): `grep -c $'\xEF\xBB\xBF' apps/erp/app/mock-whatsapp/page.tsx apps/erp/app/mock-whatsapp/acciones.ts apps/erp/componentes/formulario-mock-whatsapp.tsx` → 0 por archivo.

- [ ] **Step 5: Commit**

```bash
git add apps/erp
git commit -m "feat(erp): simulador /mock-whatsapp de dos paneles contra el webhook real

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Seed + env + credenciales + pipeline completo + E2E

Baseline final: pgTAP **458/21**, unit **257**, 3 builds, seed verde, E2E 7/7.

**Files:**
- Modify: `scripts/seed-demo.mjs` (sección 24 nueva + teléfonos E.164 de 2 clientes)
- Modify: `apps/erp/.env.example` (sección WhatsApp/bot al final)
- Modify: `docs/credenciales-pendientes.md` (#12 actualizado, #15 nuevo, fecha)

**Interfaces:**
- Consumes: goldens `MENU_BOT` (T2 — el texto sembrado debe calzar byte a byte), tablas (T3), simulador (T8).
- El vínculo demo se inserta con `admin` (service_role: `whatsapp_vinculos` no tiene INSERT para authenticated); los teléfonos de clientes con `userCli` (RLS update de clientes permite vendedor+).

- [ ] **Step 1: Sección 24 del seed**

En `scripts/seed-demo.mjs`, ANTES (cierre de la sección 23):
```js
console.log('✓ vacaciones: 1 toma de Amanda (5 días hábiles, 2026-06)')
```
DESPUÉS:
```js
console.log('✓ vacaciones: 1 toma de Amanda (5 días hábiles, 2026-06)')

// 24) WhatsApp (Plan 21): vínculo VERIFICADO del dueño demo + conversación de ejemplo
//     (goldens del MockMotor: menú y ventas) — el simulador nace con historia. El
//     vínculo va por admin (whatsapp_vinculos no tiene INSERT para authenticated).
const { data: { user: usuarioDemo } } = await userCli.auth.getUser()
if (!usuarioDemo) die('auth.getUser dueño demo', null)
const TEL_DEMO = '+56912345678'
const { error: eWa } = await admin.from('whatsapp_vinculos').insert({
  empresa_id: empresaId, usuario_id: usuarioDemo.id, telefono: TEL_DEMO, verificado_en: new Date().toISOString(),
})
if (eWa) die('whatsapp_vinculos', eWa)
const MENU_WA = [
  'Hola! Soy el asistente de tu ERP. Escríbeme un número o una palabra:',
  '1. Ventas de hoy',
  '2. Ventas del mes',
  '3. Cobranza vencida',
  '4. Stock crítico',
  '5. Semáforo del auditor',
  '6. Saldo de un cliente (escribe: saldo <nombre>)',
  '7. Recordar una factura (escribe: recordar <folio>)',
].join('\n')
const conversacionWa = [
  { direccion: 'entrante', contenido: 'hola' },
  { direccion: 'saliente', contenido: MENU_WA },
  { direccion: 'entrante', contenido: '1' },
  { direccion: 'saliente', contenido: 'Ventas de hoy: $0 en 0 documento(s).' },
]
for (const m of conversacionWa) {
  const { error: eMsg } = await admin.from('whatsapp_mensajes').insert({
    empresa_id: empresaId, telefono: TEL_DEMO, direccion: m.direccion, origen: 'bot', contenido: m.contenido,
  })
  if (eMsg) die('whatsapp_mensajes', eMsg)
}
// Teléfonos E.164 para el botón WhatsApp de /cobranza (clientes con facturas vencidas).
const { error: eTel1 } = await userCli.from('clientes').update({ telefono: '+56987654321' })
  .eq('empresa_id', empresaId).eq('rut', '772506309')
if (eTel1) die('telefono Comercial del Sur', eTel1)
const { error: eTel2 } = await userCli.from('clientes').update({ telefono: '+56976543210' })
  .eq('empresa_id', empresaId).eq('rut', '762222221')
if (eTel2) die('telefono Transportes Cliente', eTel2)
console.log('✓ whatsapp: vínculo del dueño (' + TEL_DEMO + ') + 4 mensajes + teléfonos E.164 de 2 clientes')
```
Nota: si el nombre real de la variable de la empresa en el seed no es `empresaId`, usar el existente (Contexto verificado: es `empresaId`). El golden `MENU_WA` DEBE quedar byte-idéntico a `MENU_BOT` de `packages/bot/src/mock.ts`.

- [ ] **Step 2: `.env.example` — anexar al FINAL de `apps/erp/.env.example`**

```
# ============ WhatsApp y bot IA (Plan 21) ============
# Proveedor de WhatsApp saliente + webhook. Fail-closed: sin un valor válido las
# acciones devuelven "WhatsApp no está configurado" y el webhook no procesa nada.
# 'mock' habilita el simulador local /mock-whatsapp y no entrega nada real.
# 'cloud' EXIGE las 4 variables WHATSAPP_* (Meta WhatsApp Business Cloud API, credencial #15).
PROVEEDOR_WHATSAPP=mock          # mock | cloud (ausente u otro valor = WhatsApp deshabilitado)
WHATSAPP_TOKEN=                  # token de acceso de la app de Meta (solo modo cloud)
WHATSAPP_PHONE_ID=               # id del número de WhatsApp Business (solo modo cloud)
WHATSAPP_VERIFY_TOKEN=           # token de verificación del webhook (GET hub.challenge de Meta)
WHATSAPP_APP_SECRET=             # app secret para la firma X-Hub-Signature-256 del POST

# Motor de conversación del bot. Fail-closed: 'mock' (scriptado determinista, corre en
# demo/tests) o 'claude' (IA real; EXIGE ANTHROPIC_API_KEY, credencial #12).
MOTOR_BOT=mock                   # mock | claude (ausente u otro valor = bot deshabilitado)
ANTHROPIC_API_KEY=               # API key de Anthropic (solo modo claude)
MOTOR_BOT_MODELO=                # modelo del ClaudeMotor; vacío = claude-sonnet-5
```

- [ ] **Step 3: `docs/credenciales-pendientes.md` (3 ediciones)**

ANTES: `Última actualización: 2026-07-18.` → DESPUÉS: `Última actualización: 2026-07-20.`

ANTES:
```markdown
12. **Anthropic API key** — capa IA del Contador Auditor (informes narrados, chat contable). Plan futuro ya diseñado como enchufe.
```
DESPUÉS:
```markdown
12. **Anthropic API key** — enciende el motor IA del chatbot de WhatsApp (Plan 21: `MOTOR_BOT=claude`; el ClaudeMotor ya está construido y probado con fetch inyectado) y, a futuro, la capa IA del Contador Auditor (informes narrados, chat contable).
```

ANTES (última línea del archivo):
```markdown
14. **Indicadores previsionales para RRHH** (UF/UTM/topes/tasas AFP) — mindicador.cl es gratis y sin key para UF/UTM; las tasas AFP/topes se mantienen como tabla editable (sin API oficial). Se decide en el diseño de la Fase 3.
```
DESPUÉS:
```markdown
14. **Indicadores previsionales para RRHH** (UF/UTM/topes/tasas AFP) — mindicador.cl es gratis y sin key para UF/UTM; las tasas AFP/topes se mantienen como tabla editable (sin API oficial). Se decide en el diseño de la Fase 3.
15. **Meta WhatsApp Business Cloud API** — cuenta WhatsApp Business + número + credenciales de la app (Plan 21): `PROVEEDOR_WHATSAPP=cloud` con `WHATSAPP_TOKEN` / `WHATSAPP_PHONE_ID` / `WHATSAPP_VERIFY_TOKEN` / `WHATSAPP_APP_SECRET`, más plantillas HSM aprobadas para el saliente business-initiated. Adaptador, firma y webhook ya construidos; el simulador /mock-whatsapp cubre todo el flujo mientras tanto.
```

- [ ] **Step 4: Pipeline completo**

```powershell
npx supabase test db
```
→ **21 archivos, 458 asserts**, todos verdes.
```powershell
pnpm test
```
→ **257** verdes.
```powershell
pnpm --filter @suite/db gen
git diff --exit-code packages/db/src/types.ts
```
→ exit 0, cero diff (los tipos ya estaban regenerados en T3).
```powershell
pnpm build --concurrency=1
```
→ 3 apps compilan.

- [ ] **Step 5: Reseed**

```powershell
npx supabase db reset
docker restart supabase_kong_ERP_Transportes; Start-Sleep -Seconds 8
```
Cargar `DTE_ENCRYPTION_KEY` desde `apps/erp/.env.local` SIN imprimirla y correr el seed:
```powershell
$linea = Select-String -Path "apps/erp/.env.local" -Pattern '^DTE_ENCRYPTION_KEY='; $env:DTE_ENCRYPTION_KEY = $linea.Line.Substring('DTE_ENCRYPTION_KEY='.Length); node scripts/seed-demo.mjs
```
→ termina con el RESUMEN e incluye `✓ whatsapp: vínculo del dueño (+56912345678) + 4 mensajes + teléfonos E.164 de 2 clientes`.

- [ ] **Step 6: Reiniciar dev servers**

Matar procesos en 3000/3001/3002 si los hay, borrar `.next` de las 3 apps y levantar:
```powershell
Get-NetTCPConnection -LocalPort 3000,3001,3002 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
Remove-Item -Recurse -Force apps/web/.next, apps/erp/.next, apps/admin/.next -ErrorAction SilentlyContinue
Start-Process pnpm.cmd -ArgumentList '--filter','web','dev' -WorkingDirectory (Get-Location)
Start-Process pnpm.cmd -ArgumentList '--filter','erp','dev' -WorkingDirectory (Get-Location)
Start-Process pnpm.cmd -ArgumentList '--filter','admin','dev' -WorkingDirectory (Get-Location)
```

- [ ] **Step 7: E2E manual con Playwright MCP (7 puntos)**

Login `demo@suite-erp.cl` / `demo1234` en `http://localhost:3000` (redirige al ERP en :3001).

1. **Vinculación completa:** Configuración → WhatsApp muestra **Vinculado** (+56912345678, seed). Desvincular → estado Sin vincular. Vincular de nuevo con `+56912345678` → "Te enviamos un código" → en `/mock-whatsapp?tel=%2B56912345678` la bandeja mock muestra el mensaje `Tu código para vincular este WhatsApp con Demo Transportes SpA es NNNNNN...` → confirmar el código → **Vinculado**.
2. **Menú:** en `/mock-whatsapp` (tel +56912345678) escribir `hola` → el hilo muestra el saliente con el menú 1-7 (golden `MENU_BOT`).
3. **Consultas:** escribir `1` → `Ventas de hoy: $... en N documento(s).` con cifras del seed; escribir `2` → ventas del mes.
4. **Cobranza y auditor:** `3` → `Cobranza vencida: $...` con top deudores del seed; `5` → `Semáforo del auditor: ...`.
5. **Acción recordar:** `recordar <folio de una factura VENCIDA del seed>` (verla en /cobranza) → respuesta `Recordatorio enviado a ... por la factura N° ...` y el correo aparece en `/mock-correo`.
6. **Botón WhatsApp en /cobranza:** en una factura vencida de cliente con teléfono (Comercial del Sur / Transportes Cliente) aparece el botón **WhatsApp** junto a **Recordar** → clic → `Enviado`; la sección "Recordatorios enviados" lo lista con canal **WhatsApp**; en `/mock-whatsapp` el teléfono del cliente muestra el texto de la plantilla.
7. **Anti-spam y desconocido:** repetir el botón WhatsApp de la misma factura → `Ya se envió un recordatorio por WhatsApp hace menos de 3 días`; en `/mock-whatsapp` escribir desde `+56900000001` → la bandeja mock muestra el mensaje SIN_VINCULO (instrucciones, CERO datos).

Si cualquier ítem falla: defecto real → **BLOCKED** con detalle.

- [ ] **Step 8: Estado limpio y commit**

```powershell
git status --porcelain
```
→ exactamente las 3 rutas modificadas de esta task (seed, .env.example, credenciales).

```bash
git add scripts/seed-demo.mjs apps/erp/.env.example docs/credenciales-pendientes.md
git commit -m "feat(scripts,docs): seed con vínculo WhatsApp demo, env del bot y credencial Meta pendiente

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 9: Reporte**

Escribir `.superpowers/sdd/task-9-plan21-report.md` con el pipeline (4 números) y la checklist E2E ítem por ítem.

---

## Seams abiertos para los lentes

1. `stockCritico` usa umbral fijo ≤ 5 unidades (el maestro no tiene `stock_minimo`); marcado con comentario `ponytail:` y upgrade path.
2. `ventasHoy`/`ventasMes` cortan por fecha UTC (`emitido_en >= YYYY-MM-DD`): hasta 3-4 h de deriva frente a medianoche de Chile. Mismo criterio simple que `HOY()` en /cobranza.
3. `semaforo_whatsapp` impersona con `set_config('request.jwt.claims', ..., true)` transaccional para reusar `revision_periodo` sin re-crearla; si el auditor gana reglas nuevas, el bot las hereda gratis. El assert 22 va al final del pgTAP por si el set_config interactuara con los claims del propio test.
4. `ClaudeMotor` no se ejercita contra la API viva (sin `ANTHROPIC_API_KEY` por diseño): queda probado con fetch mock sobre el contrato Messages API (tool_use → tool_result → texto). El historial se pasa tal cual del log; si la API reclamara por roles no alternantes, colapsar consecutivos es el fix.
5. Plantillas HSM de Meta ignoradas a propósito (param `plantilla` reservado en la interface; spec §9 las difiere a la credencial #15).
6. En el simulador, tras escribir a un teléfono NUEVO hay que clickearlo en la lista para ver su hilo (el form no navega el searchParam); anotado en la UI.
7. La conversación demo del seed cita el golden del menú por copia literal (`MENU_WA`): si `MENU_BOT` cambia, el seed debe actualizarse a mano (divergencia visible en el simulador, no rompe tests).





