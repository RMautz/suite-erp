# Tickets de administración: número, aviso por correo y alta por WhatsApp · diseño

**Fecha:** 2026-07-22 · **Estado:** aprobado (pedido directo del usuario) · **Ejecución:** inline con review final

## 1. Objetivo

Cada consulta a administración es un **ticket numerado** (`#N`); crear uno **avisa por correo al administrador** de la plataforma; y el **bot de WhatsApp** (Plan 21) puede crear el mismo ticket con `ayuda <problema>` — para resolver o escalar más rápido sin abrir la web.

## 2. Migración 0030 — número, origen y alta por WhatsApp

- `consultas_admin` gana `numero bigint generated always as identity` (unique) y `origen check ('web','whatsapp') default 'web'`. Correlativo GLOBAL de plataforma (decisión: la fuga de volumen entre tenants es aceptable para tickets de soporte).
- Núcleo compartido `app.crear_consulta(p_usuario, p_origen, p_asunto, p_mensaje) returns bigint` (security definer, revocada a todos los roles API): validaciones byte-exactas de la 0029 + inserta y retorna `numero`.
- `crear_consulta_admin(p_asunto, p_mensaje)` se re-crea (drop: cambia el retorno uuid→bigint) delegando con `auth.uid()` y origen `web`.
- **Nueva** `crear_consulta_whatsapp(p_usuario, p_asunto, p_mensaje) returns bigint`: SOLO service_role (patrón `semaforo_whatsapp` 0028) — el webhook corre sin `auth.uid()` y pasa el usuario del vínculo verificado; origen `whatsapp`.
- Aplicación con `migration up` (sin reset: preserva las cuentas locales del usuario).

## 3. Aviso por correo al administrador

- `@suite/correo` gana `plantillaTicketAdmin({ numero, organizacion, rut, autorEmail, asunto, mensaje, origen })` → asunto `Nuevo ticket #N — {organizacion}` (+ test).
- Destinatario: primera entrada de `ADMIN_EMAILS` (se agrega a `apps/erp/.env.example` con comentario; apps/web ya la tiene). Proveedor fail-closed de siempre (`mock` → visible en `/mock-correo`).
- **Best-effort**: si el correo falla o no está configurado, el ticket se crea igual (se loguea `error.message`); el aviso jamás bloquea el alta.
- Envío desde ambos callers: la action de `/consultas` (apps/web, gana dep `@suite/correo`) y la herramienta del bot (apps/erp).

## 4. Bot de WhatsApp

- `HerramientasBot` gana la 8ª herramienta: `crearTicket(asunto: string, mensaje: string): Promise<{ numero: number }>` (segunda acción del bot).
- `MockMotor`: menú gana `8. Hablar con administración (escribe: ayuda <tu problema>)`; regla `ayuda <texto>` / `soporte <texto>` → `crearTicket('Consulta por WhatsApp', texto)` → golden `Ticket #N creado. Administración te responderá pronto (míralo en el sitio, sección Consultas).`; `ayuda` a secas da la pista.
- `ClaudeMotor`: tool `crear_ticket {asunto, mensaje}` (8 tools) + case en `ejecutarHerramienta`.
- `apps/erp/lib/bot-herramientas.ts`: implementación → RPC `crear_consulta_whatsapp` con el `usuarioId` del vínculo + aviso por correo best-effort.
- Seed §24: `MENU_WA` se actualiza al nuevo golden (contrato byte-exacto con `MENU_BOT`).

## 5. UI

- `/consultas` (web): éxito muestra `Ticket #N enviado…`; cada tarjeta muestra `#N` y, si vino por WhatsApp, la etiqueta del canal.
- Panel admin `/consultas`: `#N` + etiqueta de origen en cada fila.

## 6. Tests y verificación

- pgTAP archivo 22 extendido a `plan(16)`: numero asignado/creciente y origen web (reformulando assert 2), whatsapp feliz retorna numero + origen, whatsapp con usuario sin org lanza, whatsapp denegada a authenticated (42501). Suite: **474 en 22 archivos**.
- Unit: correo 13→14 (plantilla), bot 16→17 (golden crearTicket; el assert de tools pasa 7→8). Total **261**.
- E2E vivo: web crea ticket → correo en `/mock-correo` + bandeja admin con `#N`; por `/mock-whatsapp` `ayuda ...` → respuesta con `#N` → misma bandeja con origen whatsapp.

## 7. Fuera de alcance

- Respuesta del admin POR WhatsApp (v1: se responde en el panel; el tenant la ve en /consultas). Notificación al tenant cuando le responden. Numeración por organización.
