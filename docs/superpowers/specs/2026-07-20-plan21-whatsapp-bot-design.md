# Plan 21 — Chatbot de WhatsApp (consultas IA + cobranza saliente) · diseño

**Fecha:** 2026-07-20 · **Estado:** aprobado por el usuario (diseño conversacional) · **Alcance:** un plan (~9-10 tasks)

## 1. Objetivo

El "ERP en el bolsillo": el dueño/admin de cada pyme **conversa con su ERP por WhatsApp** (motor IA con herramientas deterministas) y la pyme envía **recordatorios de cobranza** a sus clientes por WhatsApp. Todo funciona HOY con mocks (motor scriptado + simulador de chat local); las credenciales (Meta y Anthropic) son 2 variables de entorno que encienden lo real sin reescribir nada.

Decisiones del usuario (AskUserQuestion 2026-07-20): audiencia **ambos** (consultas del dueño + cobranza saliente); alcance **lecturas + 1 acción** (recordar factura); motor **IA desde v1** (arquitectura IA-first: ClaudeMotor completo y probado con fetch inyectado; MockMotor scriptado corre en local/demo hasta poner la key — reconciliado con la regla "credenciales al final"); proveedor **WhatsApp Business Cloud API oficial** con adaptador mock + simulador.

## 2. `packages/whatsapp` — proveedor de mensajería

- `ProveedorWhatsApp { enviarTexto(telefono: string, texto: string): Promise<void> }`.
- **`MockWhatsApp`**: store en `globalThis` (patrón MockCorreo P10) con la bandeja de salientes que lee el simulador.
- **`WhatsAppCloudAPI`**: `POST https://graph.facebook.com/v20.0/{WHATSAPP_PHONE_ID}/messages` con Bearer `WHATSAPP_TOKEN`; a logs SOLO `error.message`. Verificación de webhook: GET con `WHATSAPP_VERIFY_TOKEN` (hub.challenge), POST con firma `X-Hub-Signature-256` HMAC-SHA256 de `WHATSAPP_APP_SECRET` (helper `verificarFirma` puro, testeable).
- Selector **fail-closed** `proveedorWhatsApp()`: `PROVEEDOR_WHATSAPP=mock|cloud`; otro valor o ausente → throw (patrón P14). `cloud` exige las 4 variables.
- Nota declarada: el envío business-initiated real exige plantillas HSM aprobadas por Meta — el adaptador cloud enviará por plantilla cuando exista la cuenta (parámetro `plantilla` opcional en la interface); el mock y las respuestas dentro de la ventana de 24 h usan texto libre.

## 3. `packages/bot` — motor de conversación IA

- `MotorBot { responder(ctx: ContextoBot, mensaje: string): Promise<string> }`. `ContextoBot = { nombreEmpresa, rol, historial: {direccion, contenido}[] (últimos 10), herramientas: HerramientasBot }`.
- **`HerramientasBot`** (interface tipada — las implementa el ERP, el package no depende de supabase): `ventasHoy()`, `ventasMes()`, `cobranzaVencida()` (total + top 5 deudores), `stockCritico()`, `semaforoAuditor()` (estado + observaciones del mes, P17), `saldoCliente(nombre)` (búsqueda por nombre parcial), `recordarFactura(folio)` (la ÚNICA acción — retorna resultado del envío). Cada una retorna datos tipados; el motor redacta.
- **`MockMotor`**: reglas por palabra clave sobre las MISMAS herramientas ("hola"/"menú" → menú numerado 1-7; "1"/"ventas" → ventasHoy; "recordar 1043" → recordarFactura; desconocido → ayuda). 100% determinista — es el que corre en demo/tests y sus goldens de conversación son contractuales.
- **`ClaudeMotor`**: Anthropic Messages API (`POST api.anthropic.com/v1/messages`, fetch INYECTABLE) con las herramientas expuestas como tools tipadas, system prompt es-CL (solo datos de SU empresa vía herramientas, jamás inventar cifras, respuestas cortas estilo WhatsApp), historial como turnos, máx 5 rondas de tool-use, modelo por `MOTOR_BOT_MODELO` (default `claude-sonnet-5`). A logs SOLO `error.message`; si la API falla → mensaje fijo de disculpa (nunca-lanza hacia el webhook).
- Selector **fail-closed** `motorBot()`: `MOTOR_BOT=mock|claude`; `claude` exige `ANTHROPIC_API_KEY` (throw si falta).

## 4. Vinculación y log (migración 0028)

### 4.1 `whatsapp_vinculos`
`id, empresa_id, usuario_id, telefono text (CHECK E.164: ^\+[1-9][0-9]{7,14}$), codigo text null, codigo_expira timestamptz null, verificado_en timestamptz null, activo bool default true, creado_en`. **Unique parcial: un teléfono verificado activo en TODA la plataforma** (`(telefono) where verificado_en is not null and activo`). RLS SELECT dueño/admin de su empresa; CERO escritura directa. RPCs (security definer, roles dueño/admin — `'Tu rol no permite gestionar WhatsApp'`):
- `solicitar_vinculo_whatsapp(p_empresa, p_telefono) returns uuid` — valida formato (`'Teléfono no válido: usa formato internacional +56...'`), genera código de 6 dígitos con expiración 10 min (reintento sobre el mismo teléfono regenera), retorna el id; el ENVÍO del código lo hace la Server Action vía `proveedorWhatsApp()` (la RPC no habla con el mundo).
- `confirmar_vinculo_whatsapp(p_empresa, p_vinculo, p_codigo)` — `'Código incorrecto o expirado'`; marca `verificado_en`, limpia código; colisión con el unique → `'Ese teléfono ya está vinculado a otra cuenta'`.
- `desvincular_whatsapp(p_empresa, p_vinculo)` — `activo=false`.

### 4.2 `whatsapp_mensajes` (log INMUTABLE)
`id, empresa_id, telefono, direccion check ('entrante','saliente'), origen check ('bot','cobranza','vinculacion'), contenido text, referencia_id uuid null` (la factura, para el anti-spam de cobranza), `creado_en`. RLS SELECT dueño/admin/contador; INSERT dueño/admin (acciones) — el webhook inserta con service_role; sin UPDATE/DELETE (patrón correos_enviados P10).

## 5. Webhook y herramientas (apps/erp)

- **`/api/whatsapp/route.ts`**: GET = verificación de Meta; POST **nunca-lanza (200 siempre)**: con `cloud` valida la firma (inválida → 200 silencioso); parsea el mensaje entrante, resuelve el vínculo verificado+activo por teléfono con el admin client — **sin vínculo → respuesta fija con instrucciones de vinculación, CERO datos**; con vínculo → construye `HerramientasBot` con **todas las queries explícitamente filtradas por la empresa del vínculo** (patrón webhook MP P13), carga historial (últimos 10 del log), llama `motorBot().responder`, loguea entrante y saliente, envía por `proveedorWhatsApp()`.
- **`apps/erp/lib/bot-herramientas.ts`**: implementación de las 7 herramientas con el admin client + `empresa_id` fijo. `recordarFactura` reutiliza la lógica del recordatorio del P10 (misma validación de vencida, mismo anti-spam 3 días, mismo log en `correos_enviados`) — el plan decide el refactor mínimo para compartirla con la action existente sin duplicar.

## 6. UI

- **Configuración → card "WhatsApp"** (dueño/admin): ingresar teléfono → "te enviamos un código por WhatsApp" → confirmar código → estado Vinculado (teléfono + fecha) con Desvincular. Errores de RPC byte-exactos.
- **`/cobranza`**: botón **"WhatsApp"** junto a "Recordar" en facturas vencidas cuyo cliente tenga `telefono`; action `recordarPorWhatsApp`: anti-spam 3 días por factura (sobre `whatsapp_mensajes` origen 'cobranza' + `referencia_id`), plantilla es-CL (razón social, folio, monto formateado, vencimiento), log saliente, envío por proveedor. Los enviados aparecen en la sección de recordatorios de cobranza junto a los correos (con ícono/etiqueta del canal).
- **`/mock-whatsapp`** (gate estricto `PROVEEDOR_WHATSAPP=mock`, patrón /mock-correo): simulador de chat de dos paneles — eliges/escribes un teléfono, ves la conversación (del log + bandeja mock) y escribes como si fueras el celular; el submit hace POST interno al webhook real (con bypass de firma SOLO en mock) y la respuesta del bot aparece en el hilo. Los salientes de cobranza y códigos de vinculación también se ven ahí.

## 7. Seed y env

- Seed: vínculo verificado para el dueño demo (`+56912345678`) + 4 mensajes de conversación de ejemplo (menú y ventas) — el simulador nace con historia.
- `.env.example`: `PROVEEDOR_WHATSAPP=mock`, `MOTOR_BOT=mock` + comentadas `WHATSAPP_TOKEN/WHATSAPP_PHONE_ID/WHATSAPP_VERIFY_TOKEN/WHATSAPP_APP_SECRET`, `ANTHROPIC_API_KEY`, `MOTOR_BOT_MODELO`. `docs/credenciales-pendientes.md`: #15 Meta WhatsApp Business (cuenta + número + token); el #12 (Anthropic) gana la mención del bot.

## 8. Tests

- **pgTAP** `whatsapp.test.sql` (archivo 21): RPCs de vinculación (feliz, código incorrecto, expirado — fixture con expiración vencida—, regeneración, teléfono duplicado cross-empresa, formato inválido, roles — vendedor no puede, contador tampoco (gestionar es dueño/admin)), RLS (vendedor 0 filas en ambas tablas), log sin UPDATE/DELETE (42501), escritura directa de vínculos denegada. Mensajes byte-exactos. El plan fija plan(N); suite = 435 + N en 21 archivos.
- **Unit**: MockMotor (goldens de conversación con herramientas fake inyectadas: menú, cada consulta, recordar, desconocido), ClaudeMotor (fetch mock: ronda de tool_use → respuesta final; error de API → mensaje de disculpa; selector sin key → throw), `verificarFirma` (vectores HMAC), plantilla de cobranza, formato E.164. El plan fija el total (229 + N).
- **Builds** 3 apps. **E2E Playwright** (~7 puntos, todo en el simulador): vincular desde Configuración (código visible en /mock-whatsapp) → confirmar → conversar (menú → ventas → cobranza → auditor) → "recordar {folio}" → saliente visible → botón WhatsApp en /cobranza → anti-spam al repetir → número desconocido recibe instrucciones sin datos.

## 9. Fuera de alcance

- Plantillas HSM reales de Meta (van con la credencial #15) y ventana de 24 h estricta.
- Audio, imágenes, documentos; multi-idioma; grupos.
- Más acciones de escritura por WhatsApp (emitir, pagar, etc.).
- Bot conversacional para los clientes FINALES de las pymes (solo reciben el recordatorio saliente).
- Rate limiting avanzado (v1: una respuesta por mensaje entrante, sin colas).
- Capa IA del Contador Auditor en el ERP web (sigue siendo plan futuro; este plan solo trae el bot).
