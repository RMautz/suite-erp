# Rediseño del flujo de recuperación de contraseña · diseño

**Fecha:** 2026-07-21 · **Estado:** aprobado por el usuario (diseño conversacional) · **Alcance:** un plan chico (~3-4 tasks)

## 1. Objetivo

Elevar visualmente el flujo de recuperación de contraseña de `apps/web` (hoy: tarjetas planas heredadas del login) a una **tarjeta guiada** de dos pasos con estados ricos, sin tocar la seguridad ni los contratos de las server actions del flujo original (commit `3baf847`).

Decisiones del usuario (AskUserQuestion 2026-07-21): alcance SOLO el flujo de recuperación (login/registro intactos); estructura **tarjeta guiada** (centrada, badge de ícono por paso, indicador "Paso N de 2"); extras: **los 4** (reenviar con cooldown, mostrar/ocultar contraseña, medidor de fuerza, éxito animado).

## 2. Las 5 vistas

1. **Pedir correo** (`/recuperar`): badge circular con ícono de sobre (SVG inline), stepper "Paso 1 de 2" (dos puntos, el activo en marca-600), título "Recuperar contraseña", subtítulo, campo correo, botón "Enviar enlace →".
2. **Revisa tu correo** (estado de éxito del paso 1): badge de sobre con check verde; texto "Te enviamos un enlace a **{correo tipeado}**. Vence en una hora."; botón **Reenviar** deshabilitado 60 s con contador visible ("Reenviar (45 s)") que reutiliza la misma action con el correo guardado en estado del cliente; link "¿Te equivocaste de correo? Corregir" que vuelve al formulario.
3. **Nueva contraseña** (`/restablecer`): badge candado, stepper "Paso 2 de 2", dos campos de contraseña con botón de ojo (mostrar/ocultar, por campo), **medidor de fuerza** bajo el primero: barra de 3 tramos + etiqueta (débil / aceptable / fuerte) — heurística pura local (largo ≥8/≥12 + variedad de clases de caracteres), SOLO guía: el gate real sigue siendo el mínimo de 8 del action.
4. **Éxito final**: la tarjeta cambia a check verde animado (CSS keyframes, escala + fade, ~1 s) con "Contraseña actualizada"; luego navega al ERP.
5. **Enlace expirado** (`/recuperar?expirado=1`): badge de reloj + título "El enlace expiró" + copy claro + botón primario "Pedir enlace nuevo" (muestra el formulario del paso 1). Reemplaza el banner ámbar.

## 3. Técnica

- **Cero dependencias nuevas**: 4 íconos SVG inline (sobre, sobre+check, candado, reloj/check final), animaciones con Tailwind + `@keyframes` locales.
- **Server actions intactas en seguridad**: anti-enumeración (éxito genérico siempre), mensajes byte-exactos y validaciones no cambian. Único cambio de contrato: `cambiarPassword` deja el `redirect()` server y devuelve `{ ok: true }`; el cliente muestra el check animado y navega con `window.location.assign(process.env.NEXT_PUBLIC_URL_ERP!)` (NEXT_PUBLIC: disponible en el bundle; ya declarada en `apps/web/.env.example`).
- **Cooldown**: 60 s en estado del cliente (contador `setInterval`); GoTrue mantiene su rate limit propio como backstop.
- **Piezas compartidas** en `apps/web/componentes/tarjeta-recuperacion.tsx`: badge de ícono, stepper y el marco de tarjeta/encabezado que comparten las 5 vistas. El medidor de fuerza es función pura co-locada en `/restablecer`.
- `/auth/confirm`, `apps/web/app/login/*` y `registro/*` **no se tocan**. La decisión documentada del cambio-sin-contraseña-anterior (commit `2d98b0e`) sigue vigente.

## 4. Verificación

- `pnpm --filter web build` verde (mismas rutas).
- E2E en navegador de los 5 estados: pedir → revisa tu correo (contador visible y Reenviar funcional tras el cooldown o verificando el estado deshabilitado) → enlace de Mailpit → restablecer con ojo y medidor reaccionando → check animado → aterriza en ERP → enlace inválido muestra la vista expirado. Restaurar `demo1234` al cierre (contrato del seed).
- Unit: sin tests nuevos (apps sin harness de tests, patrón del repo); la heurística de fuerza es tabla simple y queda cubierta por el E2E visual.

## 5. Fuera de alcance

- Rediseño de login/registro (posible fase siguiente con la misma tarjeta guiada).
- OTP numérico en vez de enlace; personalización del template del correo de GoTrue.
- Librería de íconos o de animaciones.
