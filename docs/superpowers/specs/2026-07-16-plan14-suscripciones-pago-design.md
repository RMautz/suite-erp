# Plan 14: Pago de suscripciones del SaaS (MercadoPago + Webpay Plus)

Fecha: 2026-07-16. Estado: diseño aprobado por el usuario (enfoque A; Webpay Plus en lugar de Onepay — descontinuado por Transbank; link por período de 1 mes; autoservicio en ERP → Configuración).

## §1 Objetivo

Que la organización (tenant) pague su suscripción del SaaS de forma autoservicio: el dueño entra a `/configuracion/suscripcion`, paga 1 mes con MercadoPago o Webpay Plus, y la suscripción se extiende y activa sola. Hoy el cobro es manual (admin activa/suspende a mano). Dinero ORGANIZACIÓN → PLATAFORMA: credenciales de la plataforma en env del servidor — NO las credenciales por-empresa del Plan 13.

## §2 Decisiones

- **Métodos v1**: MercadoPago (Checkout Pro, reuso de `MercadoPagoPasarela` del Plan 13) y **Webpay Plus** (Transbank REST v1.2; Onepay está descontinuado). Ambos con mock; `PASARELA_SUSCRIPCIONES=mock|real` gobierna los DOS (una sola perilla) vía un selector PROPIO de suscripciones que FALLA CERRADO: `'real'` → adaptadores reales, `'mock'` → mocks, cualquier otro valor o ausente → lanza (los botones muestran 'no disponibles'); JAMÁS cae a mock por defecto — dinero de plataforma no se auto-aprueba por una env olvidada (a diferencia del `?? 'mock'` del Plan 13, aceptable allí por estar gated en credenciales por-empresa).
- **Sin recurrencia**: link por período. Cada pago exitoso extiende 1 mes. Sin tokenización.
- **1 mes fijo**: monto = `planes.precio_clp` leído en BD (jamás del cliente).
- **Ubicación**: página en el ERP (rol dueño/admin de la ORGANIZACIÓN via `app.tiene_rol`); rutas de webhook/retorno también en `apps/erp` (la sesión del pagador vive ahí; el admin 3002 queda mínimo: 1 columna nueva).
- **Extensión**: `suscripciones.hasta = greatest(current_date, coalesce(hasta, current_date)) + interval '1 month'` y `organizaciones.estado = 'activa'`. Trial que paga se convierte en activa.
- **Suspensión al vencer**: FUERA de v1 — sigue siendo el botón manual del admin. La UI muestra "Vencida" si `hasta < hoy` (badge, sin gating nuevo).
- **Plan precio 0**: no se ofrece pago (mensaje informativo, sin botones).
- **Pendientes abandonados**: un `pendiente` SIN cobro (el pagador nunca completó) es inofensivo y queda así para siempre (sin expiración en v1). Distinto es aprobado-sin-acreditar (plata cobrada sin extensión): para eso hay DOBLE vía de confirmación en ambos métodos (webhook + retorno con lookup en MP; commit en retorno en Webpay) — ver §5; si ambas fallaran, conciliación manual del admin consultando la pasarela (documentada como runbook en §7).
- **Doble confirmación jamás duplica**: `confirmar_pago_suscripcion` es idempotente bajo lock; webhook y retorno pueden llegar en cualquier orden.

## §3 Schema y RPCs (migración 0019)

### Tabla `pagos_suscripcion`

- `id uuid pk default gen_random_uuid()`
- `organizacion_id uuid not null references organizaciones (id)`
- `plan_id uuid not null references planes (id)`
- `monto integer not null check (monto > 0)` — copiado de `planes.precio_clp` al crear
- `pasarela text not null check (pasarela in ('mercadopago', 'webpay'))`
- `buy_order text not null unique` — ≤26 chars alfanumérico (límite Webpay), generado server-side aleatorio no enumerable; se usa como `buy_order` (Webpay) y viaja en el `external_reference` (MP)
- `referencia_externa text` — `mp_payment_id` (MP) o `token` de transacción (Webpay); null hasta confirmar
- `estado text not null default 'pendiente' check (estado in ('pendiente', 'pagado', 'abortado', 'revision'))`
- `pagado_en timestamptz`, `creado_en timestamptz not null default now()`
- Índice único parcial: `(pasarela, referencia_externa) where referencia_externa is not null` (idempotencia backstop).

RLS: `select` para dueño/admin de la org (`app.tiene_rol(organizacion_id, array['dueno','admin'])`) + `grant select` a authenticated. CERO escritura directa (sin policies ni grants de escritura). service_role completo. GRANTs explícitos obligatorios (lección 0001).

### RPC `crear_pago_suscripcion(p_organizacion uuid, p_pasarela text) returns jsonb` — `{"id": uuid, "buy_order": text}`

security definer, `set search_path = public`; revoke anon/public + grant authenticated.
1. Rol: `app.tiene_rol(p_organizacion, array['dueno','admin'])` → si no: `'Tu rol no permite pagar la suscripción'`.
2. Lock de la organización (`for update`); plan: `organizaciones.plan_id` → `planes` (si null o inactivo: `'La organización no tiene un plan asignado'`; si `precio_clp = 0`: `'El plan actual no requiere pago'`).
3. Valida `p_pasarela in ('mercadopago','webpay')` → `'Método de pago no soportado'`.
4. Genera el `buy_order` DENTRO de la RPC (`substr(replace(gen_random_uuid()::text, '-', ''), 1, 25)` — la no-enumerabilidad es invariante estructural, no cortesía del llamador), inserta fila `pendiente` con `monto = precio_clp` y retorna `{id, buy_order}`.

### RPC `confirmar_pago_suscripcion(p_pago uuid, p_referencia text, p_monto integer) returns text` — `'extendido' | 'revision' | 'noop'`

security definer; revoke anon/public/authenticated + grant SOLO service_role (candado pgTAP 42501).
1. Lock del pago (`where id = p_pago for update`) → si no existe: `'El pago no existe'`.
2. Idempotencia DENTRO del lock: si `estado = 'pagado'` → return `'noop'`. Backstop: 23505 del índice único → return `'noop'`. Procede desde `pendiente` Y desde `abortado` (plata real cobrada gana sobre una anulación de UI).
3. Si `p_monto <> monto` → marca `estado = 'revision'`, guarda `referencia_externa`, return `'revision'` — dinero registrado, jamás invisible; NO extiende. El handler (webhook/retorno) emite `console.error('ALERTA pago suscripción en revisión: ...')` — patrón de alertas del Plan 13, no un `raise warning` que nadie mira. (Solo alcanzable por manipulación: la preferencia/transacción se crea con el monto de BD.)
4. Marca `pagado` + `referencia_externa` + `pagado_en = now()`; lock de la organización; `update suscripciones set hasta = (greatest(current_date, coalesce(hasta, o.trial_hasta, current_date)) + interval '1 month')::date where organizacion_id = ...` — pagar durante el trial extiende DESDE el fin del trial (no se pierden días gratis); si el update toca 0 filas → raise (el invariante 1-fila-por-org lo garantiza el `unique (organizacion_id)` nuevo — ver abajo); `update organizaciones set estado = 'activa'`. Return `'extendido'`. Nota v1 documentada: pagar reactiva también una org `suspendida` (la suspensión de v1 es por impago; suspensión-por-abuso inmune al pago queda fuera de alcance).

### RPC `abortar_pago_suscripcion(p_pago uuid) returns void`

service_role only. `update ... set estado = 'abortado' where id = p_pago and estado = 'pendiente'` (retorno Webpay con `TBK_TOKEN` = usuario anuló). Solo degrada `pendiente`; `pagado`/`revision` intactos (jamás degradar dinero confirmado). 0 filas = no-op silencioso.

### Constraint nuevo sobre tabla existente

`alter table suscripciones add constraint suscripciones_organizacion_unica unique (organizacion_id)` — `registrar_organizacion` (0002) inserta exactamente una y nada más escribe; el constraint vuelve garantía el invariante que el `update` de confirmar asume.

Mensajes contractuales (pgTAP byte-exactos): los 5 de arriba (`'Tu rol no permite pagar la suscripción'`, `'La organización no tiene un plan asignado'`, `'El plan actual no requiere pago'`, `'Método de pago no soportado'`, `'El pago no existe'`).

## §4 packages/pagos: módulo Webpay

Nuevo `packages/pagos/src/webpay.ts` + tipos. La interface `PasarelaPagos` del Plan 13 NO calza (Webpay no tiene webhook ni firma: crear → redirect → retorno → commit server-to-server). Interface propia:

```ts
interface PasarelaWebpay {
  crear(solicitud: { buyOrder: string; sessionId: string; monto: number; returnUrl: string }): Promise<{ token: string; url: string }>
  confirmar(token: string): Promise<{ autorizado: boolean; buyOrder: string; monto: number }>
}
```

- `WebpayPlus`: REST Transbank v1.2. Base URL por ambiente: integración `https://webpay3gint.transbank.cl`, producción `https://webpay3g.transbank.cl`. `POST /rswebpaytransaction/api/webpay/v1.2/transactions` (crear) y `PUT .../transactions/{token}` (commit). Headers `Tbk-Api-Key-Id` (código de comercio) y `Tbk-Api-Key-Secret` (API key) — constructor recibe ambos + ambiente; JAMÁS los loguea (solo `error.message`; test de no-logging espejo del de MP). `autorizado = (response_code === 0 && status === 'AUTHORIZED')`. Re-commit de un token ya commiteado → Transbank responde error → `confirmar` lanza; el route lo trata vía idempotencia BD (si el pago ya está `pagado`, ni siquiera llama a `confirmar`).
- `MockWebpay`: store a nivel de módulo respaldado en `globalThis` (lección Plan 13): `crear` guarda token→solicitud y devuelve `url` del simulador local; `confirmar` devuelve autorizado una vez (buyOrder/monto guardados).
- MP reusa `MercadoPagoPasarela` y `MockPasarela` tal cual (token de PLATAFORMA inyectado ya en claro desde env), con UNA extensión aditiva: `crearPreferencia` acepta `notificationUrl?: string` opcional que viaja como `notification_url` de la preferencia (los llamadores del Plan 13 no cambian — el webhook tenant se configura a nivel de cuenta MP del tenant; el de PLATAFORMA va POR PREFERENCIA apuntando a `/api/webhooks/suscripciones/mercadopago`, así el enrutamiento no depende de configurar la cuenta).
- Referencia propia de suscripciones: `armarReferenciaSuscripcion({ pagoId, buyOrder })` → `'suscripcion:{pagoId}:{buyOrder}'` + `parsearReferenciaSuscripcion` estricto (3 segmentos, uuid + buy_order válidos, si no → null). NO se toca `armarReferencia` del Plan 13 (4 segmentos con enum de tipos: ninguno parsea al otro — verificado).
- Selectores FAIL-CLOSED propios de suscripciones (en `packages/pagos`): `pasarelaSuscripciones(perilla, tokenDescifrado)` → `'mock'` = `MockPasarela`, `'real'` = `MercadoPagoPasarela`, otro/ausente = throw; `webpaySuscripciones(perilla, commerceCode, apiKey, tbkAmbiente)` → ídem con `MockWebpay`/`WebpayPlus`. NO se reusa `pasarelaPorAmbiente` (su contrato `mock|mercadopago` con default `?? 'mock'` fallaría ABIERTO al mock con la perilla ausente y lanzaría con `'real'`).

## §5 Flujos

### Crear pago (Server Action, `apps/erp/app/configuracion/suscripcion/acciones.ts`)

1. Sesión + `obtenerEmpresaActiva` → `organizacion_id`.
2. RPC `crear_pago_suscripcion(organizacion, pasarela)` (valida rol/plan/monto y genera `buy_order` en BD) → `{pagoId, buyOrder}`.
3. Según pasarela elegida:
   - **MP**: `crearPreferencia` con token plataforma env, `external_reference = armarReferenciaSuscripcion(...)`, `notificationUrl = {origin}/api/webhooks/suscripciones/mercadopago`, título `'Suscripción {plan} — {razón social}'`, `back_urls → {origin}/api/pagos-suscripcion/retorno-mp`. Redirect a `init_point`.
   - **Webpay**: `crear({ buyOrder, sessionId: pagoId, monto, returnUrl: {origin}/api/pagos-suscripcion/retorno })`. El envío a Transbank es un **formulario auto-POST** con `token_ws` oculto hacia `url` (mecanismo canónico de Webpay; no query string): la action retorna `{url, token}` y un client component chico hace el auto-submit.
4. Sin config de plataforma (env faltante en modo `real`, o perilla ausente/desconocida — selectores fail-closed) → `'Los pagos de suscripción no están disponibles todavía'`. La action valida el env ANTES de llamar la RPC, así no queda ninguna fila `pendiente` huérfana.

### Webhook MP plataforma: `POST /api/webhooks/suscripciones/mercadopago`

Orden (espejo §5 del Plan 13, una sola empresa = la plataforma): secret/token de PLATAFORMA desde env (sin configurar → 200 + alerta) → `verificarFirma` (HMAC ±5 min, headers como objeto plano con `.get()` — lección Plan 13) → `obtenerPago(data.id)` (red/5xx → 500) → solo `approved` → `parsearReferenciaSuscripcion(external_reference DEL payment)` (malformada → 200 + alerta) → verifica `buy_order` del pago BD == el de la referencia (no coincide → 200 + alerta) → RPC `confirmar_pago_suscripcion(pagoId, 'mp:' + payment.id, monto DEL payment)` (retorno `'revision'` → `console.error` ALERTA) → 200. Errores BD → 500 (retry MP). Mapeo 200/500 enumerado como comentario. Exclusión de middleware: el prefijo `api/webhooks` ya está excluido (Plan 13).

### Retorno MP: `GET /api/pagos-suscripcion/retorno-mp`

Segunda vía de confirmación (el webhook puede perderse; sin esto un pago approved quedaría cobrado sin acreditar): lee `payment_id` de la query que MP agrega al `back_url` → si existe, `obtenerPago(payment_id)` server-side con token plataforma (la API es la fuente de verdad, jamás la query) → `approved` → `parsearReferenciaSuscripcion` + verificación de `buy_order` (mismo pipeline del webhook) → RPC `confirmar_pago_suscripcion` (idempotente: si el webhook ya confirmó, `'noop'`) → redirect `/configuracion/suscripcion?resultado=mp-ok`. Sin `payment_id`, no-approved o cualquier error: redirect a la página SIN confirmar nada (`?resultado=mp-pendiente`) — el webhook sigue siendo la vía primaria.

### Retorno Webpay: `GET|POST /api/pagos-suscripcion/retorno`

**Exclusión de middleware OBLIGATORIA**: el matcher real (`apps/erp/middleware.ts`) solo excluye `api/webhooks` y `mock-pago` — este plan AÑADE `api/pagos-suscripcion` al negative-lookahead. Sin eso, una sesión expirada durante el formulario de pago redirige el retorno a /login y se pierde el `token_ws` (= commit nunca ocurre = cargo sin confirmar). El handler lee `token_ws`/`TBK_TOKEN`/`TBK_ORDEN_COMPRA` tanto de `request.formData()` (el retorno primario de Transbank llega POST form-encoded) como de la query.

- Con `token_ws`: `confirmar(token_ws)` (commit; el token no está en BD aún — el commit devuelve `buyOrder` y `monto`) → resuelve el pago por `buy_order` (lookup service_role) → si `autorizado`: RPC `confirmar_pago_suscripcion(pagoId, 'tbk:' + token_ws, monto del commit)` (`'revision'` → ALERTA); si no: `abortar_pago_suscripcion(pagoId)`. Redirect a `/configuracion/suscripcion?resultado=webpay-ok|webpay-fallido`. Si `confirmar` LANZA (p.ej. refresh del retorno = re-commit de token ya commiteado, que Transbank rechaza): redirect a `/configuracion/suscripcion` SIN banner — la página muestra el estado real de BD y la idempotencia de BD garantiza que no se duplica ni degrada nada.
- Con `TBK_TOKEN` (anulación del usuario) o timeout (solo `TBK_ORDEN_COMPRA`): `abortar_pago_suscripcion` por buy_order → redirect `?resultado=webpay-abortado`.
- El commit es la ÚNICA fuente de verdad (jamás confiar en los params para montos/autorización). **Invariante declarada**: un token de Webpay se commitea ÚNICAMENTE en este retorno síncrono — jamás un job posterior commiteando tokens viejos (Transbank auto-reversa lo no commiteado: browser cerrado = no hay cobro; un commit tardío CREARÍA un cobro que el usuario cree cancelado).

### Simulador mock: `/mock-pago-suscripcion/[id]` (gate estricto `PASARELA_SUSCRIPCIONES === 'mock'`, si no `notFound()`)

Muestra el pago pendiente (plan, monto) y dos botones según pasarela: aprobar MP (registra en el store mock + POST al webhook de suscripciones con `CABECERA_FIRMA_MOCK`) o aprobar Webpay (redirect al retorno con el `token_ws` mock). El matcher del middleware debe excluirlo (verificar si el prefijo `mock-pago` existente ya lo cubre; si no, añadirlo).

## §6 UI

### `/configuracion/suscripcion` (ERP; guard rol dueño/admin de la org — distinto de las páginas por-empresa)

- Datos: organización (razón social, estado, `trial_hasta`), plan (`nombre`, `precio_clp` formateado CLP), suscripción (`hasta`), historial `pagos_suscripcion` (fecha, pasarela, monto, estado — con insignias).
- Estados mostrados: `trial` → "Período de prueba hasta X"; `activa` con `hasta >= hoy` → "Activa hasta X"; `hasta < hoy` → insignia "Vencida" (roja); `suspendida` → aviso.
- Botones (si `precio_clp > 0`): "Pagar 1 mes con MercadoPago" y "Pagar 1 mes con Webpay" (`useActionState`, mensajes de error de la action). Banner por `?resultado=` del retorno.
- Tarjeta "Suscripción" en `/configuracion`. Español; queries con scope org; jamás tocar columnas cifradas de empresas.

### Admin (3002)

- Columna "Suscrita hasta" en la tabla (embed `suscripciones (hasta)` — PostgREST lo devuelve como ARRAY aunque haya 1 fila: tomar `[0]`; con el `unique (organizacion_id)` nuevo es a lo más una), formato es-CL. Nada más.

## §7 Config de plataforma (env, server-only — NUNCA BD ni cliente)

En `apps/erp/.env.example` (documentadas, sin valores): `PASARELA_SUSCRIPCIONES=mock|real` (ausente = pagos no disponibles, fail-closed), `MP_PLATAFORMA_ACCESS_TOKEN`, `MP_PLATAFORMA_WEBHOOK_SECRET`, `TBK_COMMERCE_CODE`, `TBK_API_KEY`, `TBK_AMBIENTE=integracion|produccion`. Para probar Webpay real sin convenio: credenciales PÚBLICAS de integración de Transbank (comercio `597055555532` + API key pública de integración, documentadas en transbankdevelopers.cl) — van como comentario en `.env.example`.

**Runbook de conciliación manual** (documentado en el propio `.env.example` o README del plan): si una org reporta "pagué y no se activó" y el pago figura `pendiente`/`revision`, el operador consulta la pasarela (panel MP / portal Transbank) por el `buy_order`, y si el cobro existe ejecuta `select confirmar_pago_suscripcion(id, referencia, monto)` como service_role. La doble vía (webhook + retorno) hace esto excepcional.

## §8 Tests

- **pgTAP** `suscripciones_pago.test.sql`: crear (feliz dueño — retorna id y buy_order de 25 chars, vendedor mensaje-rol, org ajena, sin plan, precio 0, pasarela inválida), confirmar (feliz extiende+activa — verificar `hasta` y `estado` org, `'noop'` idempotente, monto≠ → `'revision'` sin extensión, pago inexistente, confirmar-gana-sobre-abortado), abortar (pendiente→abortado, pagado no degrada), candados (authenticated no ejecuta confirmar/abortar 42501, insert/update directo 42501, RLS cross-org 0 filas, anon), extensión desde trial (usa trial_hasta) y desde hasta futuro (greatest), unique(organizacion_id) en suscripciones. ~24 asserts — el plan fija el número EXACTO y el nuevo total de la suite (hoy 242).
- **Unit `packages/pagos`**: webpay (crear/confirmar contra MockWebpay, headers Tbk correctos con fetch interceptado, no-logging con serialización de objetos — lección Plan 13, re-commit lanza limpio) + referencia suscripción (round-trip + malformadas). ~8-10 nuevos sobre los 14 — el plan fija el exacto (total unit hoy 152).
- **E2E capa de datos** (supabase-js admin): crear→confirmar→hasta extendido→org activa; idempotencia; revision; abortar; aislamiento cross-org. **Checklist manual HTTP**: click-through con mocks de ambos métodos + firma inválida MP + TBK_TOKEN (anulación) + retorno-mp confirmando con webhook "caído" (la doble vía funciona) + refresh del retorno Webpay (idempotencia).
- Los route handlers HTTP quedan cubiertos por checklist manual + unit de adapters (mismo riesgo aceptado del Plan 13: sin servidor en CI).

## §9 Fuera de alcance v1

Suspensión/gating automático al vencer; recordatorios y comprobantes por correo (Plan 10); multi-mes y descuentos; cargo recurrente (MP preapproval / Oneclick); facturación DTE de la propia suscripción (la plataforma emitiéndose facturas); reembolsos; cambio de plan con prorrateo (el cambio de plan sigue siendo manual del admin).

## §10 Criterio de éxito

Con `PASARELA_SUSCRIPCIONES=mock`: el dueño demo entra a `/configuracion/suscripcion`, paga 1 mes por CUALQUIERA de los dos métodos vía el simulador, y sin intervención del admin la organización queda `activa` con `hasta` un mes más adelante y el pago visible en el historial; repetir el webhook/retorno no duplica; un vendedor no puede pagar; otra org no ve nada. Suite completa verde (conteos exactos fijados por el plan). Con credenciales reales (cuando existan): mismo flujo contra MP producción y Webpay integración.
