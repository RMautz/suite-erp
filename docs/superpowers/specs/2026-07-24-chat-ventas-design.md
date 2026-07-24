# Chat de ventas en la landing: captación de leads y explicación del producto · diseño

**Fecha:** 2026-07-24 · **Estado:** aprobado (pedido directo del usuario) · **Ejecución:** inline con review final

## 1. Objetivo

El widget de chat también vive en la landing (`localhost:3000`), orientado a VISITANTES: explica qué es Suite ERP y cómo se usa, muestra módulos y precios, empuja a la prueba gratis y **captura leads** (nombre, correo, teléfono) que aterrizan en el panel admin con aviso por correo.

## 2. Migración 0031 — `leads`

`id, numero bigint identity (unique), nombre, email, telefono null, mensaje null, origen text default 'chat_web' check ('chat_web','otro'), creado_en`. RLS habilitada SIN policies y SIN grants API (solo service_role full): los leads son datos comerciales de la plataforma — nadie los lee por la Data API salvo el panel (service_role). Alta SOLO vía RPC `crear_lead(p_nombre, p_email, p_telefono, p_mensaje) returns bigint` (security definer, grant a **anon** y authenticated — el visitante no tiene sesión): valida byte-exacto `Dinos tu nombre` (vacío / >100), `Ingresa un correo válido` (regex simple), teléfono ≤30 y mensaje ≤1000 (`El mensaje es demasiado largo`). Aplicación con `migration up` (sin reset).

- pgTAP archivo 23 `leads.test.sql` `plan(8)`: feliz como ANON retorna numero, nombre vacío, correo inválido, mensaje largo, teléfono largo, select denegado a anon Y a authenticated (sin grant), insert directo denegado. Suite: **482 en 23 archivos**.
- Anti-spam v1 (corregido por review): solo los caps de largo — el origin-check de las server actions es protección CSRF, NO frena a un script directo. Mitigación parcial implementada: tope diario en memoria de 30 avisos de lead por proceso (el lead igual se guarda y se ve en el panel). El rate limiting real por IP (RPC `crear_lead` Y la action `responderVentas`) es requisito de deploy público — anotado en `docs/deploy.md`.

## 3. `@suite/bot` — `MockMotorVentas`

- `HerramientasVentas { guardarLead(nombre, email, telefono, mensaje): Promise<{ numero: number }> }` + `MotorVentas { responder(historial, mensaje) }`.
- Script determinista (goldens contractuales): `MENU_VENTAS` (1 qué es y cómo funciona · 2 módulos · 3 precios y prueba gratis · 4 hablar con una persona); respuestas con el contenido real del producto (SII/DTE, cotizaciones→ventas→cobranza con recordatorios por correo y WhatsApp, inventario, transporte, remuneraciones/Previred, contabilidad; Plan Básico $29.990/mes, 14 días sin tarjeta, registro en /registro); captura en un mensaje: `contacto <nombre>, <correo>, <teléfono opcional>` → `guardarLead` → `¡Gracias <nombre>! Te contactaremos pronto al <correo>.`; los errores de la RPC se relatan tal cual; fallback invita al menú.
- Sin variante Claude en v1 (seam: generalizar ClaudeMotor a system+tools parametrizables cuando llegue la credencial #12).
- Tests: +7 (menú, qué es, módulos, precios, contacto feliz con herramienta llamada, contacto sin datos → pista, desconocido). Unit bot 17→24.

## 4. Correo y panel

- `@suite/correo`: `plantillaLeadAdmin({ numero, nombre, email, telefono, mensaje })`, asunto `Nuevo lead #N — {nombre}` (+1 test; correo 15). Unit total **269**.
- `apps/web/lib/aviso-ticket.ts` gana `avisarLeadAdmin` (mismo best-effort a `ADMIN_EMAILS`).
- `apps/admin` `/leads`: `verificarAdmin` + service_role, lista con numero/nombre/email/teléfono/mensaje/fecha + link nav "Leads".

## 5. Widget en la landing

- `apps/web/app/chat-ventas/acciones.ts`: action `responderVentas(mensaje)` (anónima, stateless) → `MockMotorVentas` con `guardarLead` = RPC anon + `avisarLeadAdmin` best-effort.
- `apps/web/componentes/chat-ventas.tsx`: misma cáscara visual del widget del ERP (burbuja → panel, header con marca, burbujas, input) con copy de ventas: "¿Te ayudo a conocer Suite ERP?"; historial en estado del cliente (sin persistencia — el lead ES la persistencia).
- Render en `app/page.tsx` (la landing) — siempre visible, no requiere sesión.

## 6. Verificación

E2E vivo anónimo: abrir el widget en la landing → menú → precios → `contacto Juan Pérez, juan@empresa.cl, +56911112222` → gracias con nombre → lead visible en el panel admin `/leads` → aviso en `/mock-correo`. pgTAP 482/23 y unit 269 verdes. Review de seguridad (superficie anon de la RPC, XSS, spam) antes del push.

## 6b. Limitación conocida del mock (verificada en E2E)

Los avisos por correo enviados desde **apps/web** (leads y tickets web) usan el `MockCorreo` del PROCESO web, y el visor `/mock-correo` corre en el proceso del erp: en local esos avisos no se ven en el visor (el flujo corre igual y sin error). Con Resend real en producción no existe la separación — ambos procesos pegan al mismo servicio HTTP. La tubería completa de avisos quedó demostrada con los del bot (proceso erp).

## 7. Fuera de alcance

- Persona IA del chat de ventas (seam #12); persistir conversaciones anónimas; rate limiting de producción (seam deploy); captura multivuelta con estado.
