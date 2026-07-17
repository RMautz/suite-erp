# Plan 15: Rediseño del panel admin + recaudación de suscripciones

Fecha: 2026-07-16. Estado: diseño aprobado por el usuario (una página; KPIs + gráfico 6 meses + desglose por pasarela; últimos 20 pagos; aviso de pagos en revisión). Alcance deliberadamente chico: **cero cambios de BD** (ni migración, ni RPCs, ni pgTAP nuevos) — es una capa de lectura sobre lo que el Plan 14 ya dejó.

## §1 Objetivo

Que el operador de la plataforma vea de un vistazo cuánto dinero han recaudado las suscripciones y el estado del parque de organizaciones, en un panel con la identidad visual de la suite (hoy: una tabla con estilos inline y sin marca). El panel es además la vista de conciliación que el runbook del Plan 14 le asigna: los pagos en `revision` deben saltar a la vista.

## §2 Decisiones

- **Una sola página** (el admin es de un solo operador): dashboard + tablas en `apps/admin/app/page.tsx`. Sin navegación nueva.
- **Cero BD**: queries service_role directas + agregación en JS del server component. A escala de plataforma (decenas-cientos de organizaciones, miles de pagos) no amerita vista SQL; si algún día pesa, se extrae una vista `recaudacion_mensual` (documentado como evolución, no se construye ahora).
- **Solo `estado = 'pagado'` suma recaudación** (pendiente/abortado/revision NO suman — revision es dinero cobrado pero NO acreditado: se muestra aparte como alerta, jamás mezclado en los KPIs).
- **Identidad**: Tailwind 4 + `@suite/ui` en `apps/admin`, espejo EXACTO del wiring de `apps/web` (deps `tailwindcss`/`@tailwindcss/postcss`, `postcss.config.mjs`, `globals.css` que importa Tailwind y `@suite/ui/src/tema.css` — paleta marca sky). `verificarAdmin()` y las server actions existentes (activar/suspender) quedan INTACTOS.
- **Sin tests nuevos**: conteos actuales intactos (unit 163, pgTAP 269). Verificación = build 3 apps + checklist manual (ver §6). La agregación mensual es una función pura local del server component — si el reviewer del plan la considera digna de unit, se extrae a `@suite/core` con sus tests y se ajustan conteos EXPLÍCITAMENTE en el plan.

## §3 Infraestructura visual (espejo de apps/web)

- `apps/admin/package.json`: + `@suite/ui` workspace + `tailwindcss` + `@tailwindcss/postcss` (mismas versiones que apps/web).
- `apps/admin/postcss.config.mjs` y `apps/admin/app/globals.css`: copias del patrón de apps/web (import de tema compartido `packages/ui/src/tema.css`).
- `apps/admin/app/layout.tsx`: importa `globals.css`; header de plataforma (logo "Suite ERP" con gradiente de marca + etiqueta "Panel de plataforma"); `<main>` con ancho contenido (`max-w-6xl mx-auto`). Español.

## §4 Página y datos

### Queries (server component, `clienteAdmin()` service_role, tras `verificarAdmin()`)

1. `organizaciones`: `id, rut, razon_social, estado, trial_hasta, creado_en, planes (nombre, precio_clp), suscripciones (hasta)` — el embed de suscripciones es OBJETO (unique del Plan 14).
2. `pagos_suscripcion`: `id, organizacion_id, monto, pasarela, estado, pagado_en, creado_en` — todas las filas (volumen de plataforma; si pesa, se pagina después).
3. Mapa organización→razón social para etiquetar pagos (de la query 1).

### Derivaciones (JS puro en el server component)

- **Recaudado este mes**: Σ monto de `pagado` con `pagado_en` en el mes calendario actual (fechas locales del servidor; consistente con el resto del repo — la deuda timezone Chile es repo-wide y explícitamente NO se resuelve aquí).
- **Total histórico**: Σ monto de todos los `pagado`.
- **Pagos este mes**: conteo de los `pagado` del mes.
- **Organizaciones por estado**: activas / trial / suspendidas desde `organizaciones.estado`; **vencidas** = estado `activa` con `suscripciones.hasta < hoy` (se muestran como subconjunto: "N activas · de ellas M vencidas").
- **Serie mensual (6 meses)**: Σ monto de `pagado` por mes calendario, últimos 6 incluyendo el actual (meses sin pagos = 0). Barras CSS (mismo patrón del gráfico de ventas 14 días del dashboard ERP: alturas proporcionales al máximo, `formatearCLP` en tooltip/etiqueta).
- **Por pasarela**: Σ monto y conteo de `pagado` por `mercadopago`/`webpay` (histórico total).
- **En revisión**: filas con `estado = 'revision'` (cualquier fecha).

### Composición visual (de arriba hacia abajo)

1. **Aviso rojo condicional** (solo si hay `revision`): "⚠ N pago(s) en revisión — dinero cobrado sin acreditar" + tabla chica (fecha, organización, pasarela, monto) + recordatorio de una línea del runbook (consultar la pasarela y confirmar por SQL service_role).
2. **4 KPIs** (Tarjeta de @suite/ui): Recaudado este mes / Total histórico / Pagos este mes / Organizaciones (con desglose activas·trial·suspendidas y vencidas).
3. **Fila de 2 paneles**: gráfico de barras 6 meses + desglose por pasarela.
4. **Tabla organizaciones** (restilizada con Tabla/Th/Tr/Td + Insignia por estado — verde activa, amarillo trial, rojo suspendida, y punto rojo "Vencida" si aplica): RUT formateado, razón social, plan, estado, trial hasta, suscrita hasta, acciones Activar/Suspender (forms existentes, restilizados con Boton).
5. **Últimos 20 pagos** (orden `creado_en` desc): fecha (pagado_en ?? creado_en), organización, pasarela, monto, estado con Insignia (verde pagado, gris pendiente, amarillo revisión, rojo abortado).

Montos SIEMPRE con `formatearCLP`; RUT con `formatearRut`; fechas es-CL. Estados vacíos con mensaje ("Aún no hay pagos de suscripción.").

## §5 Seguridad

- `verificarAdmin()` primero, como hoy (throw si el email no está en `ADMIN_EMAILS`).
- Solo LECTURA nueva; las únicas mutaciones siguen siendo las server actions existentes (activar/suspender), sin cambios.
- Nada de `pagos_suscripcion` sale de la página (server component; no client components con datos — el gráfico es CSS estático server-rendered).
- Ninguna credencial/env nueva.

## §6 Verificación

- `pnpm build` (3 apps) + `pnpm test` (163) + `pnpm supabase test db` (269) — sin cambios de conteo.
- Checklist manual: (1) panel renderiza con la identidad (header, KPIs, tablas estilizadas); (2) pagar una suscripción mock desde el ERP demo → KPI "este mes", gráfico y últimos-pagos se mueven; (3) sembrar por SQL service_role un pago `revision` → aparece el aviso rojo con la fila; limpiarlo; (4) Activar/Suspender siguen funcionando; (5) usuario no-admin → error de permisos igual que hoy.

## §7 Fuera de alcance

Multi-página/nav, export CSV, filtros y paginación de pagos, MRR proyectado/churn, gestión de planes desde el admin, edición de organizaciones, timezone Chile, vista SQL de agregación (evolución documentada).
