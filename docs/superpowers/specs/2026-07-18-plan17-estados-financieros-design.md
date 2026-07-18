# Plan 17 — Estados financieros + Contador Auditor · diseño

**Fecha:** 2026-07-18 · **Estado:** aprobado por el usuario (diseño conversacional) · **Alcance:** un plan (~10 tasks)

## 1. Objetivo

Cerrar la Fase 2 de Contabilidad con la filosofía "el cliente no se preocupa, solo verifica": un **Contador Auditor de reglas expertas** (determinista, sin IA) revisa cada período y prepara el cierre; el cliente aprueba con un click. Estados financieros chilenos: **balance de 8 columnas** y **EERR comparativo**.

Decisiones del usuario (AskUserQuestion 2026-07-18):
- Motor del auditor: **reglas expertas** deterministas (100% pgTAP-testeable; enchufe para capa IA futura, fuera de alcance).
- Alcance: **revisión por período + cierre asistido** (el auditor prepara, el cliente aprueba).
- Empaque: **un solo plan** (estados financieros + auditor juntos).
- Cierre: aprueban **dueño, admin o contador**; **reversible** (reabrir mientras no exista cierre posterior).
- Ejercicio: **año calendario fijo** (enero-diciembre, sin configuración).
- EERR y anomalías: **comparativo contra período anterior** con variación %.
- Documentos tardíos: el hook contabiliza con **fecha del primer día del ejercicio abierto** y el auditor lo deja como observación. Nada se rechaza.

## 2. Modelo de datos (migración 0024)

### 2.1 `cierres_ejercicio`
```sql
create table public.cierres_ejercicio (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  anio integer not null check (anio between 2000 and 2100),
  estado text not null default 'cerrado' check (estado in ('cerrado', 'reabierto')),
  asiento_cierre_id uuid not null,          -- el asiento de cierre vigente o el último si reabierto
  resultado integer not null,               -- utilidad (+) o pérdida (−) calculada al cerrar, CLP enteros
  creado_por uuid not null,
  creado_en timestamptz not null default now(),
  reabierto_por uuid,
  reabierto_en timestamptz,
  unique (empresa_id, anio),
  unique (empresa_id, id),
  foreign key (empresa_id, asiento_cierre_id) references public.asientos (empresa_id, id)
);
```
RLS SELECT por rol contable (`app.tiene_rol_en_empresa(empresa_id, array['dueno','admin','contador'])` — mismo patrón 0022). CERO escritura directa (sin grants de insert/update/delete a authenticated): solo las RPCs la mueven. Un año está **cerrado** si existe fila con `estado = 'cerrado'`; `reabierto` deja la fila como historia y el año vuelve a estar abierto. Re-cerrar tras reabrir: la fila vuelve a `estado='cerrado'` con `asiento_cierre_id` nuevo (update dentro de la RPC).

### 2.2 Origen nuevo `'cierre'`
El CHECK de `asientos.origen` (0022:85-86) se re-emite agregando `'cierre'` (drop constraint + add). **No hay asiento de apertura**: el ledger es continuo y el arrastre de saldos de balance lo hace el cálculo de saldo inicial que ya existe (mayor, P16 T8). El asiento de cierre lleva `referencia_id null` (la anti-doble-ejecución vive en la fila de `cierres_ejercicio` bajo el advisory lock, no en el índice de idempotencia).

### 2.3 Cuenta "Utilidad del ejercicio" (11ª ancla)
Nueva cuenta hoja de patrimonio con `clave_sistema = 'utilidad_ejercicio'` (código y grupo consistentes con el catálogo de 0022 — el plan fija el código exacto mirando el catálogo sembrado). La migración: (a) la agrega al seed de `activar_contabilidad` (re-create de la función con la lista extendida), y (b) backfill: la inserta en toda empresa que ya tenga catálogo (`exists clave_sistema is not null`) y no la tenga aún — mismo insert idempotente por clave.

### 2.4 Candado de período en `app._insertar_asiento`
Al inicio del helper (tras validar empresa):
```sql
if exists (select 1 from cierres_ejercicio
           where empresa_id = p_empresa
             and anio = extract(year from p_fecha)::integer
             and estado = 'cerrado') then
  raise exception 'El ejercicio % está cerrado', extract(year from p_fecha)::integer;
end if;
```
Mensaje byte-exacto: `'El ejercicio 2026 está cerrado'` (con el año interpolado). Sin excepción por origen: el **orden de operaciones** de las RPCs hace innecesario un escape hatch — `cerrar_ejercicio` crea el asiento ANTES de marcar la fila `cerrado`; `reabrir_ejercicio` marca `reabierto` ANTES de crear la reversa. TODA vía de creación pasa por el helper, así que el candado es total.

### 2.5 Fecha contable de documentos tardíos — `app._fecha_contable`
Helper nuevo `app._fecha_contable(p_empresa uuid, p_fecha date) returns date`: si el año de `p_fecha` está cerrado, retorna `make_date(A+1, 1, 1)` donde `A` es el último año cerrado consecutivo ≥ año de la fecha (cubre 2025 y 2026 ambos cerrados → 1-ene-2027); si no, retorna `p_fecha` intacta. `contabilizar_documento` y `contabilizar_pendientes` (re-creates) pasan su fecha calculada por este helper. Los asientos manuales y reversas NO se clampean: `crear_asiento`/`revertir_asiento` dejan que el candado rechace con el mensaje de 2.4 (el usuario elige otra fecha). La observación del auditor detecta el clamping comparando `asientos.fecha` vs la fecha del documento origen (join por origen/referencia_id) — sin columna nueva.

## 3. RPCs (todas security definer, search_path=public, advisory lock `'asientos:'||empresa` PRIMERO — patrón 0022)

### 3.1 `cerrar_ejercicio(p_empresa uuid, p_anio integer) returns uuid`
Roles: dueño/admin/**contador** (`'Tu rol no permite cerrar el ejercicio'`). Validaciones (mensajes byte-exactos):
- `p_anio < extract(year from current_date)` → si no, `'Solo se puede cerrar un ejercicio terminado'`.
- Año no cerrado ya (`'El ejercicio % ya está cerrado'`).
- Años anteriores con movimientos deben estar cerrados primero (`'Cierra primero el ejercicio %'` con el año más antiguo abierto con asientos) — cierre en orden.
- Módulo activo (`exigir` patrón P16).

Cálculo: por cada cuenta hoja de tipo ingreso/gasto con saldo neto ≠ 0 en el año (excluyendo asientos de cierre previos y sus reversas), una línea inversa que la deja en 0; contrapartida única a `utilidad_ejercicio` (haber si utilidad, debe si pérdida). Total 0 (sin movimientos de resultado) → **noop** (retorna null, no crea fila ni asiento — patrón noop P16). Crea el asiento (`origen 'cierre'`, `fecha = make_date(p_anio,12,31)`, glosa `'Cierre del ejercicio 2026'`) vía `app._insertar_asiento`, LUEGO inserta/actualiza la fila `cierres_ejercicio` a `cerrado` con `resultado`. Retorna el id del asiento.

### 3.2 `reabrir_ejercicio(p_empresa uuid, p_anio integer) returns uuid`
Mismos roles (`'Tu rol no permite reabrir el ejercicio'`). Valida: fila `cerrado` existe (`'El ejercicio % no está cerrado'`); no hay cierre posterior en estado cerrado (`'Reabre primero el ejercicio %'`). Marca `reabierto` (+auditoría reabierto_por/en), LUEGO crea el asiento inverso vía `app._insertar_asiento` con `origen 'reversa'`, `reversa_de = asiento_cierre_id`, `fecha = make_date(p_anio,12,31)` (misma fecha del cierre: no contamina el ejercicio siguiente), glosa `'Reapertura del ejercicio 2026'`. La unicidad una-reversa-por-asiento (0022) se respeta: cada re-cierre crea asiento nuevo, cada reapertura revierte el vigente.

### 3.3 `revision_periodo(p_empresa uuid, p_anio integer, p_mes integer) returns jsonb`
Roles contables (`'Tu rol no permite ver la revisión'`). Retorna `{periodo, estado, observaciones: [{regla, severidad, titulo, detalle, enlace_tipo, enlace_id}]}` donde `severidad in ('critica','media','ok')` y `estado` es el semáforo agregado (peor severidad presente; sin observaciones → `'ok'`). **Las 7 reglas (deterministas, cada una con sus números en `detalle`):**
1. `documentos_sin_contabilizar` — documentos emitidos del período sin asiento (query de pendientes P16). 🔴 crítica.
2. `iva_descuadrado` — IVA débito del libro de ventas del mes ≠ movimientos del mes en la cuenta ancla `iva_debito`. 🔴 crítica (monto de la diferencia en detalle).
3. `facturas_vencidas_sin_gestion` — facturas con saldo vencidas hace >30 días sin recordatorio enviado en los últimos 30 días (cruza `correos_enviados` P10). 🟡 media.
4. `anomalia_vs_promedio` — ventas o gastos del mes fuera de la banda 60%-140% del promedio de los hasta 6 meses anteriores con datos (mínimo 2 meses para opinar; misma filosofía del semáforo del dashboard). 🟡 media.
5. `anticipos_sin_aplicar` — anticipos en estado recibido hace >60 días. 🟡 media.
6. `asientos_tardios` — asientos automáticos del período cuya fecha difiere de la fecha del documento origen (el clamping de 2.5). 🟡 media.
7. `ejercicio_anterior_abierto` — enero en adelante: el año anterior tiene movimientos y no está cerrado. 🟡 media, con CTA al cierre asistido.

### 3.4 Grants
Las 3 RPCs: `revoke from anon, public` + `grant to authenticated` (validación de rol adentro, patrón 0022). Re-creates de `activar_contabilidad` (catálogo +1), `contabilizar_documento` y `contabilizar_pendientes` (fecha vía `app._fecha_contable`) — cuerpos verbatim + cambio mínimo, con drop previo si cambia la firma (no cambia).

## 4. Estados financieros (lecturas SQL en páginas, sin vistas nuevas — patrón diario/mayor P16 T8)

### 4.1 Balance de 8 columnas — `/contabilidad/balance`
Selector de ejercicio (años con movimientos). Por cuenta hoja con movimientos en el año, **excluyendo** asientos `origen='cierre'` y sus reversas ligadas (`reversa_de` → asiento de cierre): Débitos, Créditos, Saldo Deudor, Saldo Acreedor, Activo, Pasivo (cuentas activo/pasivo/patrimonio según lado del saldo), Pérdida, Ganancia (cuentas ingreso/gasto). Fila de totales por columna + fila **"Utilidad (o Pérdida) del ejercicio"** que cuadra los pares Inventario y Resultados — los 4 pares deben cuadrar o la página muestra alerta roja (no debería ocurrir: partida doble blindada). Encabezado simple: "Ganaste $X en 2026" (o pérdida). Export CSV (`filasACsv`, route handler con guards 404 módulo / 403 rol en paridad — patrón P16).

### 4.2 EERR — `/contabilidad/eerr`
Selector de período (mes / trimestre / año) + **columna del período anterior equivalente y variación %**. Estructura: Ingresos (cuentas ingreso, saldo acreedor positivo), menos Gastos (cuentas gasto), = Resultado del período. Misma exclusión de cierres/reversas-de-cierre. Encabezado simple + tabla técnica. Export CSV.

### 4.3 Revisión — `/contabilidad/revision`
Semáforo del período (mes actual por defecto, navegable), observaciones con link directo (factura → `/ventas/[id]`, asiento → `/contabilidad/asientos/[id]`, etc.), y **panel de cierre asistido**: si aplica la regla 7, muestra el asiento de cierre propuesto (preview calculada con la MISMA query de cerrar_ejercicio, sin crear nada) con "esto cierra tu 2026 con utilidad de $X" y botón **Aprobar cierre** (→ `cerrar_ejercicio`). Ejercicios cerrados listados con botón Reabrir (confirmación). Acceso: `puedeVerContabilidad` + ROLES_CONTABLES (P16); la card de `/contabilidad` (resumen) gana el semáforo del mes y link a Revisión.

## 5. Fuera de la BD

- `apps/erp/lib/contabilidad.ts` (hook nunca-lanza) NO cambia — el clamping vive en SQL.
- NAV: sin entradas nuevas (Revisión/Balance/EERR se llega desde `/contabilidad`; el patrón P16 ya enlaza diario/mayor así).
- Etiquetas de reglas/severidades en un `apps/erp/app/contabilidad/revision/reglas.ts` (patrón `origenes.ts` P16).

## 6. Seed demo

Sección nueva: 3 asientos manuales de 2025 (ingresos/gastos chicos, cuadrados) para que la demo muestre la regla 7 con el **cierre asistido de 2025 preparado**; además el estado natural del seed ya alimenta reglas 3/5 (vencidas y anticipos según datos existentes). No se cierra ningún ejercicio en el seed (el usuario vive la aprobación en la demo).

## 7. Tests

- **pgTAP** `estados_financieros.test.sql` (archivo 18): cerrar_ejercicio feliz (asiento cuadrado, cuentas de resultado en 0, fila cerrada, resultado correcto), noop sin movimientos, doble cierre → raise, año en curso → raise, orden de cierre → raise, roles (vendedor no puede; contador SÍ puede), candado del helper (asiento manual en año cerrado → `'El ejercicio 2026 está cerrado'`), reabrir (reversa ligada fecha 31-dic, año vuelve a aceptar asientos, re-cerrar crea asiento nuevo), reabrir sin cierre / con cierre posterior → raise, `app._fecha_contable` (clamp simple, clamp consecutivo, sin cierre = intacta), contabilizar_documento tardío → asiento 1-ene del año abierto, revision_periodo: golden por regla (7 fixtures dirigidos) + semáforo agregado + rol denegado. Mensajes byte-exactos. El plan fija plan(N) contando asserts; suite = 327 + N en 18 archivos.
- **Unit**: helpers TS de presentación si los hay (formateo de bandas/variaciones); si todo queda server-side SQL, 176 sin cambios — el plan lo fija.
- **Builds**: las 3 apps. **E2E Playwright** (checklist): revisión con observaciones de la demo, cierre asistido 2025 aprobado → balance 2025 cuadrado con utilidad, EERR comparativo con variación, reabrir 2025, asiento manual en año cerrado rechazado con el mensaje, roles (vendedor no ve nada de esto).

## 8. Fuera de alcance

- Capa IA (informes narrados, chat contable) — plan futuro con API key del usuario.
- Ejercicio configurable no-calendario; multi-moneda; corrección monetaria.
- Notificaciones/correos de observaciones del auditor.
- Editar las reglas o sus umbrales desde la UI (valores fijos en v1: 30 días, 60 días, banda 60-140%, mínimo 2 meses).
- Balance clasificado (activo corriente/no corriente) — el de 8 columnas es el tributario chileno.
