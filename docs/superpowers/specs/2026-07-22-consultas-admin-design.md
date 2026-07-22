# Consultas a administración · diseño

**Fecha:** 2026-07-22 · **Estado:** aprobado (AskUserQuestion: "Formulario con bandeja") · **Alcance:** mini-plan (~4 tasks)

## 1. Objetivo

Canal tenant → plataforma: un usuario con cuenta escribe una consulta a la administración de Suite ERP desde el menú "Mi cuenta" de la landing; el admin la ve, responde y cierra en su panel (:3002); el usuario ve la respuesta en el mismo apartado.

## 2. Migración 0029 — `consultas_admin`

`id, organizacion_id → organizaciones, usuario_id, email, asunto, mensaje, estado check ('abierta','respondida','cerrada') default 'abierta', respuesta null, respondida_en null, creado_en`. Índices por `(organizacion_id, creado_en desc)` y `(estado, creado_en desc)`.

- RLS SELECT: miembros ACTIVOS de la organización (subquery a `miembros` por `auth.uid()` — RLS de miembros permite leer la propia membresía).
- Escritura de usuarios SOLO vía RPC (grant `select` a authenticated; el grant es el candado, patrón `whatsapp_vinculos`). Responder/cerrar es del admin vía service_role (apps/admin) — sin policies de update para authenticated.
- RPC `crear_consulta_admin(p_asunto, p_mensaje) returns uuid` (security definer): trim + mensajes byte-exactos `Escribe un asunto` · `Escribe tu consulta` · `El asunto no puede superar los 200 caracteres` · `La consulta no puede superar los 5000 caracteres` · `Tu cuenta no tiene una organización`; toma organización y email de `auth.uid()`; revoke anon/public.

**Aplicación SIN `db reset`** (`npx supabase migration up`): preserva las cuentas reales creadas por el usuario en la BD local.

## 3. UI

- **apps/web `/consultas`** (con sesión; sin sesión → redirect `/login`): formulario (asunto, mensaje) + lista de consultas de su organización con estado (Insignia-like) y respuesta cuando exista. Action `crearConsulta` → RPC, `error.message` tal cual, revalidatePath.
- **Menú "Mi cuenta"** de la landing: tercer item "Consultar a administración" → `/consultas` (ruta local de apps/web; también para el admin sin org NO aplica — el item va en la rama con organización).
- **apps/admin `/consultas`**: `verificarAdmin` + `clienteAdmin`; lista con razón social/RUT de la organización, abiertas primero; acciones **Responder** (textarea → `respuesta`, `respondida_en`, estado `respondida`) y **Cerrar**. Link "Consultas" en el nav del layout.

## 4. Tests y verificación

- pgTAP archivo 22 `consultas_admin.test.sql`, `plan(10)`: RPC feliz + estado inicial, asunto/mensaje vacíos, tope de largo, sin organización, RLS cross-org 0 filas, propio org visible, insert directo 42501, update directo 42501. Suite total: **458 + 10 = 468 en 22 archivos**.
- E2E en vivo: demo crea consulta desde el menú → admin la responde en :3002 → demo ve la respuesta. Sin `next build` con los dev servers arriba (lección 2026-07-21); el pipeline de builds corre en el próximo cierre.

## 5. Fuera de alcance

- Notificación por correo al admin o al usuario (la bandeja del panel basta en v1).
- Hilos/respuestas múltiples (una respuesta por consulta en v1; "cerrada" termina el ciclo).
- Adjuntos.
