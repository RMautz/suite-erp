# Rubros de empresa — diseño

**Fecha:** 2026-07-18 · **Estado:** aprobado por el usuario (diseño conversacional) · **Alcance:** un plan

## 1. Objetivo

Al crear la cuenta, la Pyme declara su **rubro** — `negocio` o `transporte` por ahora, extensible — y el sistema habilita los módulos correspondientes solo. El rubro reemplaza al toggle manual "Módulo transporte": pasa a ser la única fuente de verdad, y **solo el admin de plataforma** (panel 3002) puede cambiarlo después.

Decisiones del usuario (AskUserQuestion 2026-07-18):
- Selector en el registro: **tarjetas visuales** (no un select).
- El toggle manual de Configuración → Módulos **desaparece**; el rubro manda.
- Cambio posterior de rubro: **solo el admin de plataforma** (los clientes contactan soporte).
- Empresas existentes: **derivar del flag actual** (`modulo_transporte=true → 'transporte'`, si no `'negocio'`).

## 2. Modelo de datos (migración 0023)

- `empresas.rubro text not null default 'negocio'` con `check (rubro in ('negocio','transporte'))`. Agregar un rubro futuro = extender el CHECK en una migración.
- **Backfill** en la misma migración: `update empresas set rubro = 'transporte' where modulo_transporte;` (el default cubre el resto). Nadie gana ni pierde módulos.
- `modulo_transporte` se **conserva como flag derivado**: los ~30 consumidores actuales (NAV, páginas, RPCs de transporte, pgTAP) no se tocan. Deja de ser escribible directamente: se re-emite el grant de columnas de 0016 **sin** `modulo_transporte` (y sin `rubro`, que nunca lo tuvo). Mismo patrón blindado que `modulo_contabilidad` (0022): la columna solo se mueve por RPC.
- Invariante: `modulo_transporte = (rubro = 'transporte')` en toda fila, garantizado porque las únicas dos vías de escritura (registro y `cambiar_rubro`) los setean juntos.

## 3. RPCs

### 3.1 `registrar_organizacion(p_rut text, p_razon_social text, p_rubro text default 'negocio')`

Se hace `drop function public.registrar_organizacion(text, text)` y se re-crea con el tercer parámetro (cambia la firma; `create or replace` dejaría la vieja viva). Cuerpo idéntico al vigente (0002) más:
- Validación temprana: si `p_rubro not in ('negocio','transporte')` → `raise exception 'Rubro no válido'`.
- El insert de `empresas` incluye `rubro = p_rubro` y `modulo_transporte = (p_rubro = 'transporte')`.
- Re-emitir `revoke … from anon, public` / `grant … to authenticated` para la firma nueva.
- El default `'negocio'` mantiene compatible cualquier llamada existente sin el parámetro.

### 3.2 `cambiar_rubro(p_empresa uuid, p_rubro text)` — NUEVA, solo service_role

- Valida rubro (mismo mensaje) y que la empresa exista (`raise exception 'Empresa no encontrada'` si no).
- `update empresas set rubro = p_rubro, modulo_transporte = (p_rubro = 'transporte') where id = p_empresa;`
- `revoke execute … from public, anon, authenticated; grant execute … to service_role;` — los tenants no pueden ni verla. Es la ÚNICA vía de cambio post-registro, y concentra el mapping rubro→módulos junto con 3.1.
- Cambiar de `transporte` a `negocio` solo oculta el NAV/páginas de transporte (UX); los datos de flota/entregas/proformas/combustible quedan intactos y reaparecen si se revierte el rubro.

## 4. Constante compartida `RUBROS` (packages/core)

```ts
export const RUBROS = [
  { codigo: 'negocio', nombre: 'Negocio', descripcion: 'Comercio y servicios: ventas, compras, inventario y cobranza' },
  { codigo: 'transporte', nombre: 'Transporte', descripcion: 'Todo lo de Negocio más flota, tarifario, entregas, proformas y combustible' },
] as const
export type CodigoRubro = (typeof RUBROS)[number]['codigo']
```

Consumidores: tarjetas del registro (web), etiqueta en Configuración → Módulos (erp), selector del panel admin. Un rubro nuevo = 1 entrada aquí + 1 migración (CHECK + validaciones de las 2 RPCs).

## 5. Registro (apps/web)

- El formulario gana un grupo de **tarjetas radio obligatorias** entre razón social y el botón: una tarjeta por entrada de `RUBROS` (nombre + descripción), `input type="radio" name="rubro"` visualmente oculto, tarjeta resaltada al seleccionar (borde/fondo marca). Sin default preseleccionado: elegir es parte del registro (`required`).
- `registrar` (acción server) lee `rubro`, valida contra `RUBROS` (fail-closed: ausente o desconocido → `'Elige el rubro de tu Pyme'`) y lo pasa como `p_rubro`.

## 6. ERP — Configuración → Módulos

- `FormularioModulos` pierde el checkbox de transporte. En su lugar: bloque de solo lectura "Rubro: **Transporte**" (nombre desde `RUBROS`) con la nota "El rubro lo asigna la plataforma. Para cambiarlo, contacta a soporte."
- El **factor volumétrico** sigue editable (su grant de columna se mantiene) pero el formulario solo se muestra si `rubro = 'transporte'`.
- `guardarModulos` deja de escribir `modulo_transporte` (fallaría por el grant): solo valida y guarda `factor_volumetrico`.
- La página query de `empresas` agrega `rubro` al select. `EmpresaResumen` (empresa-activa.ts) NO cambia: el NAV sigue leyendo `modulo_transporte`.
- `PanelContabilidad` intacto.

## 7. Panel admin (apps/admin)

- El select de organizaciones agrega el join `empresas (id, razon_social, rubro)`.
- La tabla de organizaciones gana una columna **Rubro**: por cada empresa de la org (hoy 1:1, el diseño tolera N), un `<select>` con las entradas de `RUBROS` + botón "Cambiar" (form por empresa), mostrando el rubro actual.
- Nueva acción `cambiarRubro(formData)` en `apps/admin/app/acciones.ts`: `verificarAdmin()` → `clienteAdmin().rpc('cambiar_rubro', { p_empresa, p_rubro })` → `revalidatePath('/')`. Errores de la RPC se muestran con el patrón de las acciones existentes.

## 8. Seed demo (scripts/seed-demo.mjs)

- Org 1 "Demo Transportes SpA": `registrar_organizacion` con `p_rubro: 'transporte'`; el update directo de `modulo_transporte` (línea ~133) se elimina (fallaría por el grant) — queda solo el de `factor_volumetrico`.
- Org 2 "Comercial Ficticia SpA": sin `p_rubro` → nace `negocio` (hoy ya no usa transporte; sirve además para demostrar el NAV reducido).

## 9. Tests

- **pgTAP** nuevo archivo `supabase/tests/database/rubros.test.sql` (17º archivo): registrar con rubro transporte → `rubro` + `modulo_transporte=true`; sin parámetro → `negocio` + `false`; rubro inválido en registro → raise; `cambiar_rubro` como service_role mueve ambos campos en ambas direcciones; empresa inexistente → raise; rubro inválido → raise; `authenticated` no puede ejecutar `cambiar_rubro` (permiso denegado); `authenticated` no puede `update` directo de `modulo_transporte` ni de `rubro` (42501); CHECK rechaza valores fuera del catálogo. Mensajes de error byte-exactos.
- **Unit**: validación fail-closed del rubro en la acción de registro (si la acción se testea; si no, cubierto por E2E).
- **Builds**: las 3 apps.
- **E2E Playwright** (manual al cierre): registro nuevo eligiendo Transporte → NAV con sección Transporte; panel admin cambia esa empresa a Negocio → NAV sin transporte tras recargar; demo reseeded intacta.

## 10. Fuera de alcance

- Rubros adicionales (solo el mecanismo queda extensible).
- Precios/planes por rubro.
- UI de autoservicio para cambiar rubro (decisión explícita: solo plataforma).
- Emails de notificación al cambiar rubro.
