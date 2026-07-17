# Plan 10: Correo transaccional (cotizaciones, proformas, facturas y recordatorios)

Fecha: 2026-07-16. Estado: diseño aprobado por el usuario (4 envíos v1; HTML en el cuerpo; disparo manual con anti-spam; adapter con mock hasta tener cuenta Resend). Patrón de la casa: como `packages/dte` y `packages/pagos`, TODO opera con mock hasta enchufar credenciales reales por env.

## §1 Objetivo

Que el tenant envíe por correo sus documentos al cliente (cotización, proforma, factura/boleta emitida) y recuerde facturas vencidas, desde los detalles que ya existen — con un proveedor real (Resend) listo para enchufar la API key, y un visor mock local para probarlo todo hoy. Restricción conocida: sin dominio verificado, Resend real solo envía al correo del dueño de la cuenta desde `onboarding@resend.dev` — irrelevante mientras se opere con mock.

## §2 Decisiones

- **4 envíos v1**: cotización, proforma, factura/boleta emitida, recordatorio de vencidas. Formato: **HTML en el cuerpo** (tabla de líneas + totales; sin PDF — las vistas print de la app cubren la impresión).
- **Disparo manual**: botones en los detalles y en /cobranza. Cron automático FUERA de v1 (documentado como evolución: Vercel cron → route handler con secret).
- **Remitente de PLATAFORMA por env** (`CORREO_REMITENTE`); la identidad de la empresa viaja en el asunto y el cuerpo. Sin reply-to ni remitente por empresa en v1.
- **Fail-closed** (lección Plan 14): `PROVEEDOR_CORREO=mock|resend`; ausente/otro → los botones devuelven `'El correo no está configurado'` — jamás envío silencioso ni caída muda a mock. Con `resend`, la action exige además `RESEND_API_KEY` y `CORREO_REMITENTE`.
- **Enviar transiciona**: mandar por correo una cotización o proforma en `borrador` primero la pasa a `enviada` (RPCs existentes `cambiar_estado_cotizacion`/`cambiar_estado_proforma`), luego envía. Si el envío falla después de transicionar, la action lo dice y el usuario reintenta (el estado queda `enviada` — aceptado, no hay dinero en juego). Estados válidos para enviar: cotización `borrador|enviada|aceptada`; proforma `borrador|enviada|aprobada`; documento venta `emitido` tipo `factura|boleta`; recordatorio: factura vencida con saldo > 0 (vía `saldos_documentos`).
- **Solo éxitos se registran**: si `enviar()` lanza, la action devuelve error y NO hay fila. La tabla es log de lo efectivamente enviado.
- **Anti-spam de recordatorios**: si existe un `recordatorio` para el mismo documento hace < 3 días → individual: `'Ya se envió un recordatorio hace menos de 3 días'`; masivo: se omite y el resumen dice cuántos se enviaron y cuántos se omitieron.
- **Destinatario**: `clientes.email` (ya existe, nullable) → si falta: `'El cliente no tiene correo registrado'`.

## §3 Schema (migración 0020) — lo ÚNICO de BD

### Tabla `correos_enviados`

- `id uuid pk default gen_random_uuid()`
- `empresa_id uuid not null` + FK a empresas — patrón tenant estándar del repo
- `tipo text not null check (tipo in ('cotizacion', 'proforma', 'documento', 'recordatorio'))`
- `referencia_id uuid not null` — id del objeto origen (cotización, proforma o documento_venta según tipo; SIN FK dura: apunta a 3 tablas — documentado; la action siempre valida el objeto scoped antes de enviar)
- `para text not null`, `asunto text not null`, `proveedor_id text not null` (id devuelto por el proveedor)
- `creado_en timestamptz not null default now()`
- Índice `(empresa_id, tipo, referencia_id, creado_en desc)` — consulta del anti-spam y del "Enviado el X".

RLS: `select` miembros de la empresa; `insert` con `with check (app.tiene_rol_en_empresa(empresa_id, array['dueno','admin','vendedor']))` — la misma función de rol de las tablas tenant (0003); vendedor incluido deliberadamente para calzar con los roles de las RPCs de cotización/proforma (documentos_compra usa solo dueno/admin). SIN update/delete (log inmutable). Grants explícitos `select, insert` a authenticated + service_role completo (lección 0001). Es registro operativo (no dinero): insert directo desde la action, patrón `documentos_compra` (0013).

## §4 packages/correo (espejo estructural de packages/pagos)

- `src/tipos.ts`: `Mensaje { para: string; asunto: string; html: string }`; `interface ProveedorCorreo { enviar(m: Mensaje): Promise<{ id: string }> }`; tipos de entrada de las plantillas (datos planos, sin dependencia de @suite/db).
- `src/mock.ts`: `MockCorreo` con store a nivel de módulo respaldado en `globalThis` (lección Plan 13: `next dev` re-instancia módulos por bundle) — guarda `{id, para, asunto, html}`; export `correosMockEnviados()` para el visor y `limpiarCorreosMock()` para tests.
- `src/resend.ts`: `ResendCorreo` — `POST https://api.resend.com/emails` con `Authorization: Bearer <apiKey>`, body `{from, to: [para], subject, html}`; constructor `(apiKey, remitente)`; errores → lanza SOLO con `error.message`/status, JAMÁS loguea apiKey/headers/body (test de no-logging con serialización de objetos — lección Plan 13).
- `src/plantillas.ts`: funciones PURAS `plantillaCotizacion/plantillaProforma/plantillaDocumento/plantillaRecordatorio(datos) → {asunto, html}` — tablas inline-styled email-safe, montos CLP formateados, identidad de la empresa (razón social/RUT) en encabezado y asunto, pie "Enviado con Suite ERP". **Escape enumerado**: pasa por `escaparHtml()` CADA string de origen usuario interpolado en el HTML — razón social del cliente Y de la empresa, glosa/descripción de cada línea, nombre de producto/servicio, destino/observaciones de ODEs en proformas (montos, folios y fechas son numéricos/formateados → seguros). El `asunto` NO se escapa (header de texto plano vía API JSON; sin vector CRLF). Tests: inyección `<script>` en razón social Y en una glosa de línea.
- `src/seleccionar.ts`: `correoPorAmbiente(perilla: string | undefined, apiKey: string | undefined, remitente: string | undefined): ProveedorCorreo` — `'mock'` → MockCorreo; `'resend'` → exige apiKey Y remitente no vacíos (si faltan → throw); otro/ausente → throw `'Proveedor de correo no configurado'`. FAIL-CLOSED — OJO redactor: NO copiar el `?? 'mock'` de `packages/pagos/src/seleccionar.ts` (aquel default es del Plan 13 y aquí está prohibido).
- `src/index.ts` barrel. Tests TDD del package: plantillas (4 tipos + escape), mock, resend (payload/headers, no-logging, error limpio), selector fail-closed — el plan fija el conteo EXACTO y el nuevo total unit (hoy 163).

## §5 ERP: actions, UI y visor

### Server actions (`apps/erp/app/correo/acciones.ts` o co-ubicadas por pantalla — el plan decide, patrón del repo)

Todas, en este ORDEN ESTRICTO — todas las precondiciones baratas ANTES de cualquier mutación; solo `enviar()` puede fallar después de la transición: sesión + empresa activa → env fail-closed (`'El correo no está configurado'` — mensaje contractual que TAMBIÉN cubre la rama `resend` sin `RESEND_API_KEY`/`CORREO_REMITENTE`; el throw del selector §4 es backstop interno, jamás llega al usuario) → **rol dueno/admin/vendedor verificado EXPLÍCITAMENTE** (patrón guard de `combustible/importar.ts`: getUser → query `miembros`; el RLS del insert es backstop, no compuerta — un correo real jamás debe salir y luego no poder registrarse) → objeto SCOPED a la empresa + estado válido → **`clientes.email` presente** → SOLO AHORA la transición RPC si `borrador` (un cliente sin email jamás deja el documento en `enviada` sin correo) → plantilla → `enviar()` → insert en `correos_enviados` → revalidate. Para el recordatorio masivo: `saldos_documentos` no expone email — la action une `clientes` para el destinatario. Mensajes de error en español, sin filtrar detalles del proveedor.

1. `enviarCotizacionCorreo(id)` — estados válidos §2; si `borrador`: RPC transición primero.
2. `enviarProformaCorreo(id)` — ídem.
3. `enviarDocumentoCorreo(id)` — factura/boleta emitida (folio en el asunto).
4. `enviarRecordatorio(documentoId)` y `enviarRecordatorios()` (masivo sobre TODAS las vencidas con saldo de la empresa) — anti-spam §2; el masivo retorna `{enviados, omitidos}` para el banner.

### UI

- Botón "Enviar por correo" en `/cotizaciones/[id]`, `/proformas/[id]` y `/ventas/[id]` (solo emitida factura/boleta), con `useActionState` y el último envío visible ("Enviado el 16-07-2026 a cliente@x.cl" — query a `correos_enviados`).
- `/cobranza`: botón "Recordar" por factura vencida + botón "Recordar todas las vencidas" arriba, banner con resumen `{enviados, omitidos}`.
- **Visor `/mock-correo`** (gate estricto `PROVEEDOR_CORREO === 'mock'`, si no `notFound()`; server component): lista de correos del store mock (para, asunto, fecha) y el HTML renderizado en `<iframe srcDoc>` sandboxeado. Middleware: verificar si el matcher necesita exclusión (es página autenticada del ERP — NO necesita exclusión, a diferencia de los simuladores de pago que reciben redirects externos; el plan lo confirma contra el matcher real).

## §6 Config (env, server-only)

`apps/erp/.env.example`: `PROVEEDOR_CORREO=mock|resend` (ausente = correo no disponible, fail-closed), `RESEND_API_KEY`, `CORREO_REMITENTE` (formato `Nombre <correo@dominio>`; sin dominio propio: `onboarding@resend.dev`, solo entrega al correo del dueño de la cuenta — documentado como comentario). Ninguna en BD ni al cliente; el adapter jamás las loguea.

## §7 Tests

- **Unit `packages/correo`**: plantillas (una por tipo con asserts de contenido clave: asunto con folio/número, montos CLP, datos de empresa, escape de `<script>` en razón social Y en glosa de línea), mock store, resend payload+no-logging+error, selector fail-closed (3 ramas). El plan fija el conteo exacto MIDIENDO los totales reales de la suite al arrancar (referencia al escribir este spec: 163 unit / 269 pgTAP — post Plan 14).
- **pgTAP** `correos_enviados.test.sql`: insert feliz (dueno y vendedor), contador/bodeguero 42501, check de tipo inválido, cross-tenant (insert con empresa ajena bloqueado + select 0 filas), anon, update/delete 42501 (log inmutable). El plan fija el conteo exacto.
- **E2E/checklist manual** con `PROVEEDOR_CORREO=mock`: enviar cotización en borrador → queda `enviada` + correo en el visor; proforma ídem; factura emitida; recordatorio individual + repetido antes de 3 días (bloqueado) + masivo con resumen; cliente sin email → mensaje; visor gated.

## §8 Fuera de alcance v1

Cron automático (evolución documentada: Vercel cron → route con `CRON_SECRET` que ejecuta el masivo por empresa), PDF adjunto, tracking de apertura/rebote, remitente/reply-to por empresa, editor de plantillas, correos de plataforma (bienvenida/suscripción — candidato a plan futuro), reintentos automáticos.

## §9 Criterio de éxito

Con `PROVEEDOR_CORREO=mock` en la demo: los 4 flujos operan de punta a punta y cada correo se ve en `/mock-correo` con su HTML; el anti-spam bloquea el re-recordatorio; cotización/proforma en borrador quedan `enviada` al mandarse; suite completa verde con los nuevos conteos del plan. Con cuenta Resend real: cambiar 3 env y los mismos flujos entregan correo real (al correo del dueño hasta tener dominio).
