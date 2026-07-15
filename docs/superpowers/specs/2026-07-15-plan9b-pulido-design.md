# Diseño: Plan 9b — Pulido de Fase 1 (backlog + minors diferidos)

**Fecha:** 2026-07-15
**Estado:** Aprobado por el usuario (opción "Plan de pulido")
**Fase:** 1; plan corto de cierre de deuda antes del deploy. Sin features nuevas.

## 1. Propósito

Cerrar el backlog arrastrado desde los Planes 1-9 y los minors diferidos por los reviews que son baratos y reales, dejando documentado explícitamente lo que se decide NO hacer. Todo verificado con el pipeline de siempre.

## 2. Alcance — ítems que se ARREGLAN

| # | Ítem | Origen | Fix |
|---|---|---|---|
| 1 | **Logout no existe** | Backlog P1 | Server Action `cerrarSesion` en el ERP (`supabase.auth.signOut()` + redirect al login del web vía `NEXT_PUBLIC_URL_WEB` o ruta relativa del portal); botón "Cerrar sesión" al pie de la barra lateral, junto al selector de empresa. Borra también la cookie `empresa_activa`. |
| 2 | **Cookie `empresa_activa` sin flags** | Backlog P2 | `apps/erp/app/acciones.ts`: agregar `secure: process.env.NODE_ENV === 'production'` y `maxAge: 60 * 60 * 24 * 365` al `set` existente (httpOnly y sameSite ya están). |
| 3 | **`calcularDV('')` devuelve `'0'`** | Backlog P2 | Guard en `packages/core/src/rut.ts`: entrada vacía o con no-dígitos → retorna `''` (nunca un DV falso). TDD: 2 tests nuevos (`''` y `'12a4'`). `validarRut` no cambia (ya rechaza por otras vías). |
| 4 | **Categorías duplicables por caso** ('Repuestos' vs 'repuestos') | Backlog P4 | Migración 0015: `create unique index categorias_producto_nombre_ci_idx on categorias_producto (empresa_id, lower(nombre))` (el unique original queda: es redundante pero inofensivo). App: en crear categoría e importar, mapear 23505 → `'Esa categoría ya existe (revisa mayúsculas/minúsculas)'`. |
| 5 | **Colisión substring 'válido'** en `registrarPagoProveedor` | Review P8-T6 | En `apps/erp/app/por-pagar/acciones.ts`, anteponer `if (error.message.includes('Método')) return { error: 'Selecciona un método de pago válido' }` al check de `'válido'`. |
| 6 | **Sin mensaje cuando la org no tiene empresas** | Backlog P2 | Dashboard del ERP (`apps/erp/app/page.tsx`): si `activa === null`, empty state amable ("Tu organización aún no tiene empresas registradas…") en vez del error genérico. |
| 7 | **Admin no valida UUID** | Backlog P2 | `apps/admin/app/acciones.ts`: guard regex UUID sobre `formData.get('id')` antes del update; id malformado → return silencioso (no hay UI de error en admin v1). |
| 8 | **Re-import no reactiva productos** | Backlog P2 | `apps/erp/app/importar/acciones.ts`: el payload del upsert de productos incluye `activo: true` — re-importar un producto es declararlo vendible. Clientes: igual (`activo: true`). |
| 9 | **Rama 'exención cambiada' sin assert propio** | Review P9-T2 | +1 assert en `cotizaciones.test.sql`: producto activo cuyo `exento` cambió → convertir falla con el mensaje contractual. `plan(26)` → `plan(27)`. |
| 10 | **Lock ordering de pagos puede deadlockear** (dos pagos multi-factura concurrentes bloqueando documentos en orden opuesto) | Reviews P6/P8 | Migración 0015: `create or replace` de `registrar_pago` y `registrar_pago_proveedor` iterando las aplicaciones **ordenadas por documentoId** (`order by` en el loop de jsonb). Mensajes y semántica INTACTOS (los 132 pgTAP existentes deben seguir verdes sin tocarlos). |

## 3. Fuera de alcance — deuda que se DIFIERE con razón

- **Fechas UTC vs America/Santiago** (repo-wide): tocarlo a la rápida rompe más de lo que arregla; merece plan propio si algún cliente lo sufre.
- **Overflow `sum::integer` >$2.1B/día** y **`max_rows=1000` de PostgREST**: fallan safe y los umbrales son irreales para el segmento pyme v1.
- **Suite Playwright E2E permanente**: los E2E por plan (scripts Node) + pgTAP cubren la regresión; una suite browser es proyecto aparte.
- **Truthiness de `productoId` / tests de Server Actions**: convención repo-wide asumida; la validación de autoridad vive en las RPCs (pgTAP).
- **`orden_id`↔proveedor sin constraint DB** e **insert directo con estado arbitrario (dueno)**: elecciones del spec de P8, same-tenant, documentadas allí.

## 4. Arquitectura

Una migración (0015) con el índice CI + los 2 `create or replace` (sin tablas nuevas, sin grants nuevos: las funciones conservan owner/grants/`security definer`/`set search_path` — se re-declaran completos con el `order by` como única diferencia). Cambios de app quirúrgicos en archivos existentes; el único componente nuevo es el botón de logout (client, `useActionState` no requerido: form action directa).

## 5. Testing

- pgTAP: 132 existentes intactos + 1 (exención cambiada) + 1 (categoría case-insensitive: crear 'Repuestos' y luego 'repuestos' → 23505) = **134**.
- Unit core: 81 + 2 (calcularDV guard) = **83**; total `pnpm test` = **95**.
- Builds: 3 apps.
- Verificación manual/Playwright: logout redirige y mata sesión; dashboard sin empresas muestra el empty state; re-import reactiva.

## 6. Criterio de éxito

El usuario puede cerrar sesión desde el ERP; la cookie de empresa sobrevive el reinicio del navegador y viaja segura en prod; no se pueden duplicar categorías por mayúsculas; los mensajes de error de pagos no se cruzan; una org recién creada sin empresas ve una guía y no un error; el admin no lanza errores crudos ante ids basura; re-importar reactiva productos; dos pagos concurrentes multi-factura no pueden deadlockear; y todo el pipeline (95 unit + 134 pgTAP + 3 builds) queda verde.
