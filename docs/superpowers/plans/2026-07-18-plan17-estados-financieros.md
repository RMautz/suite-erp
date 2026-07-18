# Plan 17 — Estados financieros + Contador Auditor · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute this plan task-by-task with fresh subagents, or superpowers:executing-plans when running it in a dedicated session. Read the Global Constraints before ANY task.

**Goal:** Cerrar la Fase 2 de Contabilidad con la filosofía "el cliente no se preocupa, solo verifica": un **Contador Auditor de reglas expertas** (7 reglas deterministas, sin IA) revisa cada período y prepara el cierre; el cliente aprueba con un click. Cierre y reapertura de ejercicio reversibles (dueño/admin/contador), candado de período total, documentos tardíos clampeados al primer día del ejercicio abierto, **balance de 8 columnas** y **EERR comparativo** con export CSV.

**Architecture:** Migración 0024 en dos secciones — Task 1: tabla `cierres_ejercicio` (CERO escritura directa, solo RPCs), origen `'cierre'` en asientos, 11ª ancla `utilidad_ejercicio` (`'3.1.03'` en el seed; el backfill elige código libre), helper `app._fecha_contable`, candado de período en `app._insertar_asiento` y candado de cierre en `revertir_asiento` (el asiento de cierre NO se revierte por RPC: solo `reabrir_ejercicio`); Task 2: RPCs `cerrar_ejercicio` / `reabrir_ejercicio` / `revision_periodo` (security definer + advisory lock, patrón 0022). Estados financieros como lecturas SQL en páginas Next (patrón diario/mayor P16 T8, sin vistas nuevas); tipos a mano espejo del generador en `@suite/db`; tipos/etiquetas del payload del auditor en `reglas.ts` (fuente única); seed demo con 2025 preparado para vivir el cierre asistido.

**Tech Stack:** Postgres/Supabase local (migraciones SQL + pgTAP), monorepo pnpm/turbo con Next.js (apps web 3000, erp 3001, admin 3002), TypeScript compartido en `packages/core` y `packages/db`, seed demo en `scripts/seed-demo.mjs`, E2E manual con Playwright MCP.

Spec: `docs/superpowers/specs/2026-07-18-plan17-estados-financieros-design.md` (§2-§4 son CONTRATO; mensajes byte-exactos).

## Global Constraints

- **Mensajes byte-exactos** (no parafrasear, no cambiar tildes; `%` = año interpolado, p.ej. `'El ejercicio 2025 está cerrado'`):
  - Candado de período (§2.4, `app._insertar_asiento`): `'El ejercicio % está cerrado'`.
  - Candado de cierre en `revertir_asiento` (re-create 0024, Task 1): `'El cierre solo se deshace reabriendo el ejercicio'` (sin interpolación).
  - `cerrar_ejercicio` (§3.1): `'Tu rol no permite cerrar el ejercicio'`, `'La contabilidad no está activada'`, `'Solo se puede cerrar un ejercicio terminado'`, `'El ejercicio % ya está cerrado'`, `'Cierra primero el ejercicio %'`.
  - `reabrir_ejercicio` (§3.2): `'Tu rol no permite reabrir el ejercicio'`, `'El ejercicio % no está cerrado'`, `'Reabre primero el ejercicio %'`.
  - `revision_periodo` (§3.3): `'Tu rol no permite ver la revisión'`, `'Período no válido'` (p_anio/p_mes null o mes fuera de 1-12; se valida DESPUÉS del rol).
  - Roles de las 3 RPCs: dueño/admin/**contador** (validación adentro; grants `revoke from anon, public` + `grant to authenticated`).
- **Orden de operaciones contractual** (hace innecesario un escape hatch del candado): `cerrar_ejercicio` crea el asiento de cierre **ANTES** de marcar la fila `'cerrado'`; `reabrir_ejercicio` marca `'reabierto'` **ANTES** de crear la reversa.
- **Orden de validaciones de `cerrar_ejercicio`** (contractual — el assert 3 de la Task 3 depende de él): rol → módulo activo → ejercicio terminado → advisory lock → ya-cerrado → cierre-en-orden.
- **Decisión del plan (desviación deliberada del literal del spec §3.1/§3.3) — criterio UNIFICADO "hay algo que cerrar":** el candado "cierre en orden" (`'Cierra primero el ejercicio %'`), la regla 7 (`ejercicio_anterior_abierto`) y el noop de `cerrar_ejercicio` usan TODOS el mismo criterio: **existe al menos una cuenta ingreso/gasto con saldo neto ≠ 0 en el año** (`group by cuenta having sum(debe−haber) <> 0`, excluyendo cierres y sus reversas) — el MISMO `having` que arma las líneas del asiento de cierre. Porqué: un año sin movimientos de resultado, O con líneas que netean 0 por cuenta, cierra en **noop** (retorna null, no crea fila — spec §3.1); si el candado mirara cualquier asiento o la mera EXISTENCIA de líneas de resultado, ese año sería imposible de cerrar y bloquearía todos los años siguientes para siempre.
- **Exclusión contractual** en balance, EERR y preview del cierre asistido: fuera los asientos `origen = 'cierre'` **Y** sus reversas ligadas (`reversa_de` → asiento de cierre).
- **jsonb de líneas** de `crear_asiento` / `app._insertar_asiento`: `[{cuentaId, debe, haber}]` en **camelCase** (contrato P16, 0022).
- **Ancla nueva:** `clave_sistema = 'utilidad_ejercicio'`, hoja de patrimonio. Código `'3.1.03'` en el seed de `activar_contabilidad` (catálogo nuevo, nunca choca); el **backfill elige por empresa el menor código libre `'3.1.0'||n` con n ≥ 3** (una empresa pudo crear su propia `'3.1.03'` vía `guardar_cuenta` y el unique `(empresa_id, codigo)` de 0022:68 abortaría la migración; JAMÁS `on conflict do nothing`, dejaría empresas sin ancla). Catálogo queda en 28 cuentas / 11 claves / 5 grupos. En tests y código SIEMPRE referenciada por `clave_sistema`, nunca por código.
- **Contrato `enlace_tipo` de `revision_periodo`** (productor Task 2 → consumidor `rutaEnlace` de Task 4): `'documento_venta'` (regla 3), `'anticipo'` (regla 5), `'asiento'` (regla 6), `null` (reglas 1, 2 y 4); `'cierre'` (regla 7) se emite pero `rutaEnlace` lo mapea a **null** — sin link: el panel de cierre asistido vive en la MISMA página de Revisión donde se muestra la observación.
- **`apps/erp/app/contabilidad/revision/reglas.ts` (Task 4) es la fuente ÚNICA** de tipos del payload (`RevisionPeriodo` / `ObservacionRevision` / `SeveridadRevision`), etiquetas (`ETIQUETA_REGLA` / `ETIQUETA_SEVERIDAD`) y `rutaEnlace`. El `semaforo.ts` de la Task 7 SOLO agrega mapas de presentación que no existen en `reglas.ts` (`ETIQUETA_ESTADO`, `TONO_ESTADO`, `PANEL_ESTADO`).
- **`apps/erp/app/contabilidad/page.tsx` lo tocan TRES tasks en orden:** T5 agrega el botón Balance, T6 el botón EERR, T7 lo reemplaza completo (card de Revisión) **CONSERVANDO** ambos botones. Cada task declara el estado que espera encontrar.
- **Conteos contractuales:** pgTAP **363 asserts en 18 archivos** (327 baseline + `plan(36)` de la Task 3 — la Task 3 manda). Unit **192** (176 baseline + 16 de `periodo.test.ts` — 12 de rango/anterior + 4 de `variacion` —, los fija la Task 6; ninguna otra task agrega unit tests). Builds: las **3 apps** compilan.
- **CLI Supabase unificada:** `npx supabase ...` en TODOS los comandos (`db reset`, `test db`).
- **NO tocar** `apps/erp/lib/contabilidad.ts` (hook nunca-lanza: el clamping vive en SQL) ni el NAV (sin entradas nuevas; a Balance/EERR/Revisión se llega desde `/contabilidad`, patrón P16).
- **Prohibido el BOM U+FEFF** en cualquier archivo creado o modificado (SQL, TS, TSX, MJS). Cada task lo verifica.
- **Copy es-CL** en toda la UI y mensajes.
- **Reiniciar los dev servers tras cada `pnpm build`** (gotcha del repo: el build pisa los `.next` de los dev servers en 3000-3002 → 500s hasta reiniciar).

## Contexto verificado en el repo (no repetir esta investigación al ejecutar)

- Baseline verde al iniciar: **327 pgTAP (17 archivos) / 176 unit / 3 builds**.
- **Hallazgo crítico (verificado):** `supabase/tests/database/contabilidad.test.sql:79-87` (assert 1) espera `'10/true'` — 10 claves de sistema. La 11ª ancla `utilidad_ejercicio` lo rompería. La Task 1 ajusta ese valor esperado a `'11/true'` en el MISMO commit (mismo conteo de asserts: 36; la suite sigue en 327 hasta la Task 3).
- En `contabilizar_pendientes` la "expresión de fecha" es el `order by t.fecha` (0022:513): el cambio mínimo es ordenar por `app._fecha_contable(p_empresa, t.fecha)` para que el correlativo siga cronológico respecto de la fecha contable real. En `contabilizar_documento` es una sola línea antes del chequeo de 0 líneas (`v_fecha := app._fecha_contable(p_empresa, v_fecha);`) — cubre las 6 ramas de una vez.
- El código de la cuenta nueva es `'3.1.03'` en el SEED de `activar_contabilidad` (catálogo nuevo: el grupo patrimonio de 0022 termina en `3.1.02 Resultados acumulados`, 0022:253-255, y no puede chocar). En el BACKFILL el código se elige por empresa (menor `'3.1.0'||n` libre, n ≥ 3) por el unique `(empresa_id, codigo)` de 0022:68 — ver Global Constraints. Catálogo pasa de 27 cuentas / 10 claves a **28 cuentas / 11 claves / 5 grupos**.
- **Hallazgo crítico (verificado):** `revertir_asiento` (0022:565-610) solo bloquea `v_origen = 'reversa'`: sin re-create, un dueño revertiría el asiento de CIERRE desde el detalle (`apps/erp/app/contabilidad/asientos/[id]/page.tsx:35`), la reversa nacería con `current_date` (año abierto: el candado de período no la frena) y consumiría la única reversa permitida (`asientos_reversa_idx`, 0022:100) → `reabrir_ejercicio` reventaría para siempre con `unique_violation` y el año quedaría cerrado e irrecuperable. La 0024 re-crea `revertir_asiento` con el candado de cierre (Task 1) y la UI oculta el botón Revertir en asientos `origen = 'cierre'` (Task 7).
- Las Tasks 5-6 NO dependen en duro de la 0024: `origen = 'cierre'` sin filas ⇒ exclusión vacía y las páginas funcionan igual; el plan las ordena después de las tasks de BD de todos modos.
- Hallazgo T5-T6 (verificado): el resumen `/contabilidad` HOY no enlaza diario/mayor pese a lo que asume el spec §5. Este plan NO agrega esos links (a diario/mayor se sigue llegando como en P16); solo agrega Balance (T5), EERR (T6) y la card de Revisión (T7) — ver Global Constraints sobre el reparto del archivo.

---

### Task 1: Migración 0024 — cierres_ejercicio, origen 'cierre', cuenta de utilidad, fecha contable y candado de período

**Files:**
- Create: `supabase/migrations/00000000000024_estados_financieros.sql`
- Modify: `supabase/tests/database/contabilidad.test.sql` (assert 1: `'10/true'` → `'11/true'`)

**Interfaces:**
- Consumes: `public.empresas` / `public.asientos` con `unique (empresa_id, id)` (0022:92 — blanco de la FK compuesta de `asiento_cierre_id`), el CHECK `asientos_origen_check` (0022:85-86, auto-nombrado por Postgres con la convención `tabla_columna_check` — se dropea y re-emite con `'cierre'`), `public.cuentas_contables` con `unique (empresa_id, codigo)` (0022:68 — obliga el código elegido del backfill), `app.tiene_rol_en_empresa()` (0003 — RLS por rol), y los cuerpos VERBATIM de 0022: `app._insertar_asiento` (0022:155-215), `activar_contabilidad` (0022:222-273), `contabilizar_documento` (0022:298-462), `contabilizar_pendientes` (0022:468-524), `revertir_asiento` (0022:565-610).
- Produces: tabla `public.cierres_ejercicio` (spec §2.1 exacta; RLS select por rol contable; CERO grants de escritura a authenticated; service_role completo); `asientos_origen_check` re-emitido con `'cierre'`; cuenta `'Utilidad del ejercicio' / patrimonio / hoja / clave_sistema 'utilidad_ejercicio'` (seed de `activar_contabilidad` con código `'3.1.03'` + backfill idempotente con código libre por empresa); helper `app._fecha_contable(p_empresa uuid, p_fecha date) returns date` (SIN grants, como `_insertar_asiento`); re-creates con firma IDÉNTICA (sin drop): `app._insertar_asiento(uuid, date, text, text, uuid, uuid, uuid, jsonb) returns uuid` (+ candado spec §2.4, revoke re-emitido), `public.activar_contabilidad(uuid) returns void` (+ 1 fila), `public.contabilizar_documento(uuid, text, uuid) returns text` (+ 1 línea de clamp), `public.contabilizar_pendientes(uuid) returns jsonb` (order by clampeado), `public.revertir_asiento(uuid, uuid, text) returns uuid` (+ candado de cierre; revoke/grant re-emitidos). El archivo termina con la marca `-- ===== RPCs de cierre y revision (Task 2) =====`; Task 2 anexa tras ella (patrón 0022).
- Mensajes byte-exactos: candado de período `'El ejercicio 2025 está cerrado'` (año interpolado con `%`); candado de cierre de `revertir_asiento` `'El cierre solo se deshace reabriendo el ejercicio'`.

- [ ] **Step 1: Escribir la migración**

`supabase/migrations/00000000000024_estados_financieros.sql` (UTF-8 SIN BOM; comentarios SQL en ASCII sin tildes, mensajes de usuario con tildes — convención 0022):

```sql
-- Estados financieros (Plan 17), capa 1 (Task 1): cierres_ejercicio (historia
-- del cierre anual; solo las RPCs la mueven), origen 'cierre' en asientos, la
-- 11a ancla 'utilidad_ejercicio' (contrapartida del asiento de cierre; seed +
-- backfill), el helper app._fecha_contable (documentos tardios caen al primer
-- dia del ejercicio abierto), el candado de periodo en app._insertar_asiento
-- (ningun asiento entra a un ejercicio cerrado, por NINGUNA via) y el candado
-- de cierre en revertir_asiento (el asiento de cierre solo se deshace con
-- reabrir_ejercicio: una reversa directa consumiria la unica reversa permitida
-- y dejaria el anio irrecuperable). Task 2 anexa cerrar_ejercicio,
-- reabrir_ejercicio y revision_periodo tras la marca final.
--
-- Sin escape hatch en el candado: el ORDEN de operaciones de las RPCs de Task 2
-- lo hace innecesario — cerrar_ejercicio crea su asiento ANTES de marcar la
-- fila 'cerrado'; reabrir_ejercicio marca 'reabierto' ANTES de crear la reversa.

-- ---------- cierres_ejercicio (un anio esta cerrado si su fila esta 'cerrado') ----------
-- 'reabierto' deja la fila como historia y el anio vuelve a estar abierto;
-- re-cerrar la vuelve a 'cerrado' con asiento_cierre_id nuevo (update en la RPC).
-- CERO escritura directa (sin grants de insert/update/delete a authenticated):
-- solo cerrar_ejercicio / reabrir_ejercicio la mueven, bajo el advisory lock.
create table public.cierres_ejercicio (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  anio integer not null check (anio between 2000 and 2100),
  estado text not null default 'cerrado' check (estado in ('cerrado', 'reabierto')),
  asiento_cierre_id uuid not null,          -- el asiento de cierre vigente o el ultimo si reabierto
  resultado integer not null,               -- utilidad (+) o perdida (-) calculada al cerrar, CLP enteros
  creado_por uuid not null,
  creado_en timestamptz not null default now(),
  reabierto_por uuid,
  reabierto_en timestamptz,
  unique (empresa_id, anio),
  unique (empresa_id, id),
  foreign key (empresa_id, asiento_cierre_id) references public.asientos (empresa_id, id)
);

alter table public.cierres_ejercicio enable row level security;
create policy "contables ven cierres" on public.cierres_ejercicio
  for select to authenticated
  using (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin', 'contador']));

-- Grants Data API (leccion Plan 1): solo select; service_role completo.
grant select on public.cierres_ejercicio to authenticated;
grant select, insert, update, delete on public.cierres_ejercicio to service_role;

-- ---------- asientos.origen: se suma 'cierre' ----------
-- El CHECK inline de 0022 (auto-nombrado asientos_origen_check) no admite ALTER
-- en su lugar: drop + re-add con la lista extendida (patron 0018/0022). El
-- asiento de cierre lleva referencia_id null: la anti-doble-ejecucion vive en
-- la fila de cierres_ejercicio bajo el advisory lock, no en el indice parcial.
alter table public.asientos drop constraint asientos_origen_check;
alter table public.asientos add constraint asientos_origen_check
  check (origen in
    ('manual', 'venta', 'nota_credito', 'compra', 'pago', 'pago_proveedor', 'anticipo', 'reversa', 'cierre'));

-- ---------- Backfill: 11a ancla en toda empresa que ya tenga catalogo ----------
-- Mismo insert idempotente por clave que la siembra: si la empresa tiene
-- catalogo (alguna clave_sistema) y aun no tiene 'utilidad_ejercicio', se la
-- agrega. Empresas sin catalogo la reciben al activar (re-create de abajo).
-- Codigo POR EMPRESA: el menor '3.1.0'||n libre con n >= 3 ('3.1.03' casi
-- siempre) — una empresa pudo crear su propia '3.1.03' via guardar_cuenta y el
-- unique (empresa_id, codigo) de 0022 abortaria la migracion. JAMAS
-- on conflict do nothing: dejaria empresas sin ancla y el cierre reventaria.
insert into public.cuentas_contables (empresa_id, codigo, nombre, tipo, acepta_movimientos, clave_sistema)
select e.id,
       (select '3.1.0' || n from generate_series(3, 99) as n
        where not exists (select 1 from public.cuentas_contables c2
                          where c2.empresa_id = e.id and c2.codigo = '3.1.0' || n)
        order by n limit 1),
       'Utilidad del ejercicio', 'patrimonio', true, 'utilidad_ejercicio'
from public.empresas e
where exists (select 1 from public.cuentas_contables c
              where c.empresa_id = e.id and c.clave_sistema is not null)
  and not exists (select 1 from public.cuentas_contables c
                  where c.empresa_id = e.id and c.clave_sistema = 'utilidad_ejercicio');

-- ---------- RE-CREATE activar_contabilidad (VERBATIM 0022 + 1 fila) ----------
-- Unico cambio: el catalogo suma la 11a ancla '3.1.03' Utilidad del ejercicio
-- (hoja de patrimonio, clave 'utilidad_ejercicio'): contrapartida del asiento
-- de cierre. El catalogo queda en 28 cuentas / 11 claves / 5 grupos.
create or replace function public.activar_contabilidad(p_empresa uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin']) then
    raise exception 'Tu rol no permite activar la contabilidad';
  end if;

  -- Siembra idempotente: solo si el catalogo aun no existe (por clave_sistema).
  if not exists (select 1 from cuentas_contables where empresa_id = p_empresa and clave_sistema is not null) then
    insert into cuentas_contables (empresa_id, codigo, nombre, tipo, acepta_movimientos, clave_sistema)
    values
      -- 1 Activos
      (p_empresa, '1',      'Activos',                    'activo',     false, null),
      (p_empresa, '1.1.01', 'Caja',                       'activo',     true,  'caja'),
      (p_empresa, '1.1.02', 'Banco',                      'activo',     true,  'banco'),
      (p_empresa, '1.1.03', 'Clientes',                   'activo',     true,  'clientes'),
      (p_empresa, '1.1.04', 'IVA crédito fiscal',         'activo',     true,  'iva_credito'),
      (p_empresa, '1.1.05', 'Existencias',                'activo',     true,  null),
      (p_empresa, '1.2.01', 'Vehículos',                  'activo',     true,  null),
      (p_empresa, '1.2.02', 'Maquinaria y equipos',       'activo',     true,  null),
      -- 2 Pasivos
      (p_empresa, '2',      'Pasivos',                    'pasivo',     false, null),
      (p_empresa, '2.1.01', 'Proveedores',                'pasivo',     true,  'proveedores'),
      (p_empresa, '2.1.02', 'IVA débito fiscal',          'pasivo',     true,  'iva_debito'),
      (p_empresa, '2.1.03', 'Anticipos de clientes',      'pasivo',     true,  'anticipos_clientes'),
      (p_empresa, '2.1.04', 'Remuneraciones por pagar',   'pasivo',     true,  null),
      (p_empresa, '2.1.05', 'Impuestos por pagar',        'pasivo',     true,  null),
      -- 3 Patrimonio
      (p_empresa, '3',      'Patrimonio',                 'patrimonio', false, null),
      (p_empresa, '3.1.01', 'Capital',                    'patrimonio', true,  null),
      (p_empresa, '3.1.02', 'Resultados acumulados',      'patrimonio', true,  null),
      (p_empresa, '3.1.03', 'Utilidad del ejercicio',     'patrimonio', true,  'utilidad_ejercicio'),
      -- 4 Ingresos
      (p_empresa, '4',      'Ingresos',                   'ingreso',    false, null),
      (p_empresa, '4.1.01', 'Ventas afectas',             'ingreso',    true,  'ventas'),
      (p_empresa, '4.1.02', 'Ventas exentas',             'ingreso',    true,  'ventas_exentas'),
      (p_empresa, '4.1.03', 'Otros ingresos',             'ingreso',    true,  null),
      -- 5 Gastos
      (p_empresa, '5',      'Gastos',                     'gasto',      false, null),
      (p_empresa, '5.1.01', 'Costo de ventas y compras',  'gasto',      true,  'compras_gastos'),
      (p_empresa, '5.1.02', 'Remuneraciones',             'gasto',      true,  null),
      (p_empresa, '5.1.03', 'Arriendos',                  'gasto',      true,  null),
      (p_empresa, '5.1.04', 'Servicios básicos',          'gasto',      true,  null),
      (p_empresa, '5.1.05', 'Gastos generales',           'gasto',      true,  null);
  end if;

  update empresas set modulo_contabilidad = true where id = p_empresa;
end $$;
revoke execute on function public.activar_contabilidad(uuid) from anon, public;
grant execute on function public.activar_contabilidad(uuid) to authenticated;

-- ---------- app._fecha_contable (SIN grants: la llaman las RPCs) ----------
-- Fecha contable de un documento tardio: si el anio de p_fecha esta cerrado,
-- retorna el primer dia del primer ejercicio abierto tras la racha de anios
-- cerrados CONSECUTIVOS (2025 y 2026 cerrados -> 2027-01-01); si no, p_fecha
-- intacta. Los asientos manuales y reversas NO se clampean: el candado del
-- helper los rechaza y el usuario elige otra fecha.
create or replace function app._fecha_contable(p_empresa uuid, p_fecha date)
returns date
language plpgsql security definer
set search_path = public
as $$
declare
  v_anio integer := extract(year from p_fecha)::integer;
begin
  if not exists (select 1 from cierres_ejercicio
                 where empresa_id = p_empresa and anio = v_anio and estado = 'cerrado') then
    return p_fecha;
  end if;
  while exists (select 1 from cierres_ejercicio
                where empresa_id = p_empresa and anio = v_anio + 1 and estado = 'cerrado') loop
    v_anio := v_anio + 1;
  end loop;
  return make_date(v_anio + 1, 1, 1);
end $$;
revoke execute on function app._fecha_contable(uuid, date) from anon, public;

-- ---------- RE-CREATE app._insertar_asiento (VERBATIM 0022 + candado de periodo) ----------
-- Unico cambio: el candado al inicio del begin — ningun asiento puede caer en
-- un ejercicio cerrado, por NINGUNA via (TODA creacion pasa por este helper).
create or replace function app._insertar_asiento(
  p_empresa uuid, p_fecha date, p_glosa text, p_origen text,
  p_referencia uuid, p_reversa_de uuid, p_creado_por uuid, p_lineas jsonb
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_asiento uuid;
  v_numero integer;
  v_linea jsonb;
  v_cuenta uuid;
  v_debe integer;
  v_haber integer;
  v_suma_debe bigint := 0;
  v_suma_haber bigint := 0;
begin
  -- Candado de periodo (P17): un ejercicio cerrado no recibe asientos.
  if exists (select 1 from cierres_ejercicio
             where empresa_id = p_empresa
               and anio = extract(year from p_fecha)::integer
               and estado = 'cerrado') then
    raise exception 'El ejercicio % está cerrado', extract(year from p_fecha)::integer;
  end if;

  -- Pasada 1: valida las lineas y acumula sumas (bigint: sin overflow int4).
  for v_linea in select * from jsonb_array_elements(coalesce(p_lineas, '[]'::jsonb)) loop
    v_cuenta := (v_linea->>'cuentaId')::uuid;
    v_debe := coalesce((v_linea->>'debe')::integer, 0);
    v_haber := coalesce((v_linea->>'haber')::integer, 0);
    if not exists (
      select 1 from cuentas_contables
      where id = v_cuenta and empresa_id = p_empresa and activa and acepta_movimientos
    ) then
      raise exception 'Cuenta contable no válida';
    end if;
    if v_debe < 0 or v_haber < 0 or (v_debe = 0) = (v_haber = 0) then
      raise exception 'Cada línea lleva debe o haber, mayor que cero';
    end if;
    v_suma_debe := v_suma_debe + v_debe;
    v_suma_haber := v_suma_haber + v_haber;
  end loop;

  -- Cuadratura: Sigma-debe = Sigma-haber, ambos > 0 (cubre tambien 0 lineas).
  if v_suma_debe <> v_suma_haber or v_suma_debe = 0 then
    raise exception 'El asiento no cuadra: debe y haber difieren';
  end if;

  -- Correlativo bajo el advisory lock (ya tomado por la RPC llamadora).
  select coalesce(max(numero), 0) + 1 into v_numero from asientos where empresa_id = p_empresa;

  insert into asientos (empresa_id, numero, fecha, glosa, origen, referencia_id, reversa_de, creado_por)
  values (p_empresa, v_numero, p_fecha, p_glosa, p_origen, p_referencia, p_reversa_de, p_creado_por)
  returning id into v_asiento;

  -- Pasada 2: escribe las lineas.
  for v_linea in select * from jsonb_array_elements(p_lineas) loop
    insert into asientos_lineas (empresa_id, asiento_id, cuenta_id, debe, haber, glosa)
    values (
      p_empresa, v_asiento, (v_linea->>'cuentaId')::uuid,
      coalesce((v_linea->>'debe')::integer, 0), coalesce((v_linea->>'haber')::integer, 0),
      nullif(trim(coalesce(v_linea->>'glosa', '')), '')
    );
  end loop;

  return v_asiento;
end $$;
revoke execute on function app._insertar_asiento(uuid, date, text, text, uuid, uuid, uuid, jsonb) from anon, public;

-- ---------- RE-CREATE revertir_asiento (VERBATIM 0022 + candado de cierre) ----------
-- Unico cambio: el asiento de cierre NO se revierte por aqui — la unica via es
-- reabrir_ejercicio. Una reversa directa naceria con current_date (anio abierto:
-- el candado de periodo no la frena), consumiria la unica reversa permitida
-- (asientos_reversa_idx) y reabrir_ejercicio reventaria para siempre con
-- unique_violation: el anio quedaria cerrado e irrecuperable. Los mensajes de
-- 0022 ('El asiento ya fue revertido', etc.) quedan INTACTOS.
create or replace function public.revertir_asiento(
  p_empresa uuid, p_asiento uuid, p_glosa text
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_origen text;
  v_reversa_de uuid;
  v_glosa text;
  v_lineas jsonb;
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'contador']) then
    raise exception 'Tu rol no permite crear asientos';
  end if;
  v_glosa := nullif(trim(coalesce(p_glosa, '')), '');
  if v_glosa is null then
    raise exception 'El asiento necesita una glosa';
  end if;

  -- Candado del correlativo PRIMERO, luego el lock del asiento a revertir.
  perform pg_advisory_xact_lock(hashtextextended('asientos:' || p_empresa::text, 42));

  select origen, reversa_de into v_origen, v_reversa_de
  from asientos where id = p_asiento and empresa_id = p_empresa
  for update;
  if not found then
    raise exception 'El asiento no existe';
  end if;
  -- Candado de cierre (P17): el asiento de cierre solo se deshace reabriendo.
  if v_origen = 'cierre' then
    raise exception 'El cierre solo se deshace reabriendo el ejercicio';
  end if;
  -- Las reversas no se revierten; un asiento ya revertido tampoco (unique parcial backstop).
  if v_origen = 'reversa' or v_reversa_de is not null
     or exists (select 1 from asientos r where r.empresa_id = p_empresa and r.reversa_de = p_asiento) then
    raise exception 'El asiento ya fue revertido';
  end if;

  -- Lineas inversas (debe <-> haber) del asiento original.
  select jsonb_agg(jsonb_build_object('cuentaId', cuenta_id, 'debe', haber, 'haber', debe, 'glosa', glosa))
  into v_lineas
  from asientos_lineas
  where empresa_id = p_empresa and asiento_id = p_asiento;

  return app._insertar_asiento(p_empresa, current_date, v_glosa, 'reversa', null, p_asiento, auth.uid(), v_lineas);
end $$;
revoke execute on function public.revertir_asiento(uuid, uuid, text) from anon, public;
grant execute on function public.revertir_asiento(uuid, uuid, text) to authenticated;

-- ---------- RE-CREATE contabilizar_documento (VERBATIM 0022 + 1 linea) ----------
-- Unico cambio: la fecha calculada pasa por app._fecha_contable antes de crear
-- (documentos tardios caen al primer dia del ejercicio abierto; nada se
-- rechaza — el auditor lo deja como observacion, regla asientos_tardios).
create or replace function public.contabilizar_documento(
  p_empresa uuid, p_origen text, p_referencia uuid
)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  v_dv record;
  v_dc record;
  v_pago record;
  v_pp record;
  v_ant record;
  v_fecha date;
  v_glosa text;
  v_lineas jsonb := '[]'::jsonb;
  v_debe_clave text;
begin
  -- Modulo inactivo -> noop limpio (sin tomar el candado).
  if not exists (select 1 from empresas where id = p_empresa and modulo_contabilidad) then
    return 'noop';
  end if;

  -- Candado del correlativo PRIMERO, antes de cualquier for update de documentos.
  perform pg_advisory_xact_lock(hashtextextended('asientos:' || p_empresa::text, 42));

  -- Idempotencia bajo el candado.
  if exists (
    select 1 from asientos
    where empresa_id = p_empresa and origen = p_origen and referencia_id = p_referencia
  ) then
    return 'noop';
  end if;

  if p_origen = 'venta' then
    select tipo, folio, coalesce(emitido_en, creado_en)::date as fecha, neto, exento, iva, total
    into v_dv
    from documentos_venta
    where id = p_referencia and empresa_id = p_empresa and estado = 'emitido' and tipo in ('factura', 'boleta')
    for update;
    if not found then return 'noop'; end if;
    v_fecha := v_dv.fecha;
    v_glosa := 'Venta ' || v_dv.tipo || coalesce(' N° ' || v_dv.folio, '');
    -- Debe Clientes(total) / Haber Ventas(neto) + Ventas exentas(exento) + IVA débito(iva).
    select coalesce(jsonb_agg(jsonb_build_object('cuentaId', cuenta, 'debe', debe, 'haber', haber) order by ord), '[]'::jsonb)
    into v_lineas
    from (
                    select 1 as ord, (select id from cuentas_contables where empresa_id = p_empresa and clave_sistema = 'clientes')       as cuenta, v_dv.total as debe, 0 as haber
      union all select 2,          (select id from cuentas_contables where empresa_id = p_empresa and clave_sistema = 'ventas'),                    0, v_dv.neto
      union all select 3,          (select id from cuentas_contables where empresa_id = p_empresa and clave_sistema = 'ventas_exentas'),            0, v_dv.exento
      union all select 4,          (select id from cuentas_contables where empresa_id = p_empresa and clave_sistema = 'iva_debito'),                0, v_dv.iva
    ) s where debe > 0 or haber > 0;

  elsif p_origen = 'nota_credito' then
    select folio, coalesce(emitido_en, creado_en)::date as fecha, neto, exento, iva, total
    into v_dv
    from documentos_venta
    where id = p_referencia and empresa_id = p_empresa and estado = 'emitido' and tipo = 'nota_credito'
    for update;
    if not found then return 'noop'; end if;
    v_fecha := v_dv.fecha;
    v_glosa := 'Nota de crédito' || coalesce(' N° ' || v_dv.folio, '');
    -- Inversa de la venta: Debe Ventas + Ventas exentas + IVA débito / Haber Clientes(total).
    select coalesce(jsonb_agg(jsonb_build_object('cuentaId', cuenta, 'debe', debe, 'haber', haber) order by ord), '[]'::jsonb)
    into v_lineas
    from (
                    select 1 as ord, (select id from cuentas_contables where empresa_id = p_empresa and clave_sistema = 'ventas')         as cuenta, v_dv.neto as debe, 0 as haber
      union all select 2,          (select id from cuentas_contables where empresa_id = p_empresa and clave_sistema = 'ventas_exentas'), v_dv.exento, 0
      union all select 3,          (select id from cuentas_contables where empresa_id = p_empresa and clave_sistema = 'iva_debito'),     v_dv.iva, 0
      union all select 4,          (select id from cuentas_contables where empresa_id = p_empresa and clave_sistema = 'clientes'),       0, v_dv.total
    ) s where debe > 0 or haber > 0;

  elsif p_origen = 'compra' then
    select tipo, folio, fecha_emision, neto, exento, iva, total
    into v_dc
    from documentos_compra
    where id = p_referencia and empresa_id = p_empresa and estado = 'activa'
    for update;
    if not found then return 'noop'; end if;
    v_fecha := v_dc.fecha_emision;
    v_glosa := 'Compra ' || v_dc.tipo || ' N° ' || v_dc.folio;
    -- Debe Compras/Gastos(neto+exento) + IVA crédito(iva) / Haber Proveedores(total).
    select coalesce(jsonb_agg(jsonb_build_object('cuentaId', cuenta, 'debe', debe, 'haber', haber) order by ord), '[]'::jsonb)
    into v_lineas
    from (
                    select 1 as ord, (select id from cuentas_contables where empresa_id = p_empresa and clave_sistema = 'compras_gastos') as cuenta, (v_dc.neto + v_dc.exento) as debe, 0 as haber
      union all select 2,          (select id from cuentas_contables where empresa_id = p_empresa and clave_sistema = 'iva_credito'),   v_dc.iva, 0
      union all select 3,          (select id from cuentas_contables where empresa_id = p_empresa and clave_sistema = 'proveedores'),   0, v_dc.total
    ) s where debe > 0 or haber > 0;

  elsif p_origen = 'pago' then
    select fecha, monto, anticipo_id
    into v_pago
    from pagos
    where id = p_referencia and empresa_id = p_empresa and estado = 'activo'
    for update;
    if not found then return 'noop'; end if;
    v_fecha := v_pago.fecha;
    -- El debe ramifica por anticipo_id: con anticipo_id = reclasificacion
    -- (Anticipos de clientes); sin = plata nueva (Banco).
    if v_pago.anticipo_id is not null then
      v_debe_clave := 'anticipos_clientes';
      v_glosa := 'Aplicación de anticipo a cliente';
    else
      v_debe_clave := 'banco';
      v_glosa := 'Pago de cliente';
    end if;
    v_lineas := jsonb_build_array(
      jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = p_empresa and clave_sistema = v_debe_clave), 'debe', v_pago.monto, 'haber', 0),
      jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = p_empresa and clave_sistema = 'clientes'),   'debe', 0, 'haber', v_pago.monto)
    );

  elsif p_origen = 'pago_proveedor' then
    select fecha, monto
    into v_pp
    from pagos_proveedor
    where id = p_referencia and empresa_id = p_empresa and estado = 'activo'
    for update;
    if not found then return 'noop'; end if;
    v_fecha := v_pp.fecha;
    v_glosa := 'Pago a proveedor';
    -- Debe Proveedores(monto) / Haber Banco(monto).
    v_lineas := jsonb_build_array(
      jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = p_empresa and clave_sistema = 'proveedores'), 'debe', v_pp.monto, 'haber', 0),
      jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = p_empresa and clave_sistema = 'banco'),       'debe', 0, 'haber', v_pp.monto)
    );

  elsif p_origen = 'anticipo' then
    -- Solo el anticipo con mp_payment_id (plata nueva del webhook). El
    -- excedente-de-aplicacion (mp_payment_id null) NO aplica -> not found -> noop.
    select monto, recibido_en::date as fecha
    into v_ant
    from anticipos
    where id = p_referencia and empresa_id = p_empresa and mp_payment_id is not null
    for update;
    if not found then return 'noop'; end if;
    v_fecha := v_ant.fecha;
    v_glosa := 'Anticipo recibido';
    -- Debe Banco(monto) / Haber Anticipos de clientes(monto).
    v_lineas := jsonb_build_array(
      jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = p_empresa and clave_sistema = 'banco'),              'debe', v_ant.monto, 'haber', 0),
      jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = p_empresa and clave_sistema = 'anticipos_clientes'), 'debe', 0, 'haber', v_ant.monto)
    );

  else
    -- 'manual' / 'reversa' u origen desconocido nunca se contabilizan por aqui.
    return 'noop';
  end if;

  -- Documento tardio (P17): si el anio de la fecha ya esta cerrado, el asiento
  -- va al primer dia del ejercicio abierto (spec 2.5); el auditor lo observa.
  v_fecha := app._fecha_contable(p_empresa, v_fecha);

  -- Mapeo con 0 lineas = noop (documento total 0; jamas un asiento vacio).
  if jsonb_array_length(v_lineas) = 0 then
    return 'noop';
  end if;

  -- Backstop de idempotencia: el 23505 del unique parcial (empresa,origen,ref)
  -- ante un hook concurrente se vuelve noop limpio.
  begin
    perform app._insertar_asiento(p_empresa, v_fecha, v_glosa, p_origen, p_referencia, null, null, v_lineas);
  exception when unique_violation then
    return 'noop';
  end;
  return 'creado';
end $$;
revoke execute on function public.contabilizar_documento(uuid, text, uuid) from anon, public;
grant execute on function public.contabilizar_documento(uuid, text, uuid) to service_role;

-- ---------- RE-CREATE contabilizar_pendientes (VERBATIM 0022 + order by clampeado) ----------
-- Unico cambio: el orden del recorrido usa la fecha CONTABLE (clampeada) para
-- que el correlativo siga cronologico aunque haya documentos tardios.
create or replace function public.contabilizar_pendientes(p_empresa uuid)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_rec record;
  v_creados integer := 0;
  v_res text;
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'contador']) then
    raise exception 'Tu rol no permite contabilizar';
  end if;
  if not exists (select 1 from empresas where id = p_empresa and modulo_contabilidad) then
    raise exception 'La contabilidad no está activada';
  end if;

  -- Candado del correlativo PRIMERO, antes de los for update de contabilizar_documento.
  perform pg_advisory_xact_lock(hashtextextended('asientos:' || p_empresa::text, 42));

  for v_rec in
    select origen, referencia_id, fecha from (
                    select 'venta'::text as origen, d.id as referencia_id, coalesce(d.emitido_en, d.creado_en)::date as fecha
      from documentos_venta d
      where d.empresa_id = p_empresa and d.estado = 'emitido' and d.tipo in ('factura', 'boleta')
      union all select 'nota_credito', d.id, coalesce(d.emitido_en, d.creado_en)::date
      from documentos_venta d
      where d.empresa_id = p_empresa and d.estado = 'emitido' and d.tipo = 'nota_credito'
      union all select 'compra', c.id, c.fecha_emision
      from documentos_compra c
      where c.empresa_id = p_empresa and c.estado = 'activa'
      union all select 'pago', pg.id, pg.fecha
      from pagos pg
      where pg.empresa_id = p_empresa and pg.estado = 'activo'
      union all select 'pago_proveedor', pp.id, pp.fecha
      from pagos_proveedor pp
      where pp.empresa_id = p_empresa and pp.estado = 'activo'
      union all select 'anticipo', a.id, a.recibido_en::date
      from anticipos a
      where a.empresa_id = p_empresa and a.mp_payment_id is not null
    ) t
    where not exists (
      select 1 from asientos x
      where x.empresa_id = p_empresa and x.origen = t.origen and x.referencia_id = t.referencia_id
    )
    order by app._fecha_contable(p_empresa, t.fecha), t.origen, t.referencia_id
  loop
    v_res := public.contabilizar_documento(p_empresa, v_rec.origen, v_rec.referencia_id);
    if v_res = 'creado' then
      v_creados := v_creados + 1;
    end if;
  end loop;

  return jsonb_build_object('creados', v_creados);
end $$;
revoke execute on function public.contabilizar_pendientes(uuid) from anon, public;
grant execute on function public.contabilizar_pendientes(uuid) to authenticated;

-- ===== RPCs de cierre y revision (Task 2) =====
```

- [ ] **Step 2: Ajustar el assert 1 de contabilidad.test.sql (11 claves)**

En `supabase/tests/database/contabilidad.test.sql`, reemplazar (Edit, coincidencia exacta):

```sql
-- 1) Idempotente: 10 claves de sistema (no 20) y el flag encendido.
select is(
  (select count(*) from cuentas_contables
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema is not null)::text
  || '/' ||
  (select modulo_contabilidad from empresas where id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa')::text,
  '10/true',
  'activar es idempotente: las 10 claves de sistema y el flag encendido'
);
```

por:

```sql
-- 1) Idempotente: 11 claves de sistema (no 22) y el flag encendido.
select is(
  (select count(*) from cuentas_contables
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema is not null)::text
  || '/' ||
  (select modulo_contabilidad from empresas where id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa')::text,
  '11/true',
  'activar es idempotente: las 11 claves de sistema y el flag encendido'
);
```

`plan(36)` NO cambia (mismo conteo de asserts; solo cambia el valor esperado).

- [ ] **Step 3: Aplicar y verificar**

Run: `npx supabase db reset` → aplica 0001-0024 sin errores (0024 termina en la marca; las RPCs de cierre llegan en Task 2). El backfill corre sobre tablas vacías (las migraciones preceden al seed) → inserta 0 filas, sin choques.

Run: `npx supabase test db` → **17 archivos, 327 asserts** verdes (contabilidad.test.sql ahora espera `11/true`).

Smoke del CHECK re-emitido:

```
docker exec supabase_db_ERP_Transportes psql -U postgres -d postgres -c "select pg_get_constraintdef(oid) from pg_constraint where conname = 'asientos_origen_check';"
```

→ `CHECK ((origen = ANY (ARRAY['manual'::text, 'venta'::text, 'nota_credito'::text, 'compra'::text, 'pago'::text, 'pago_proveedor'::text, 'anticipo'::text, 'reversa'::text, 'cierre'::text])))`

Validación en vivo (transaccional, TODO se revierte). Escribir (Write tool, UTF-8 sin BOM) `.superpowers/sdd/smoke-p17-t1.sql`:

```sql
\set ON_ERROR_STOP on
begin;

-- Fixture minima (superuser; rollback al final; uuids/RUTs del patron pgTAP, no comiteados)
insert into auth.users (instance_id, id, aud, role, email)
values ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'ana@a.cl');
insert into public.organizaciones (id, rut, razon_social)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '769010007', 'Org A');
insert into public.empresas (id, organizacion_id, rut, razon_social)
values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '769010007', 'Contable A');
insert into public.miembros (usuario_id, organizacion_id, rol)
values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'dueno');
insert into public.clientes (id, empresa_id, rut, razon_social)
values ('cccccccc-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '769031006', 'Cliente A1');

-- Activar como la duena (camino real, rol via JWT)
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select activar_contabilidad('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa');
reset role;

-- 1) Catalogo: 28 cuentas / 11 claves / 5 grupos y la 11a ancla en 3.1.03
select count(*) as cuentas,
       count(*) filter (where clave_sistema is not null) as claves,
       count(*) filter (where not acepta_movimientos) as grupos
from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa';
select codigo, nombre, tipo, acepta_movimientos
from cuentas_contables
where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema = 'utilidad_ejercicio';

-- 2) Asiento 2025 (helper directo, superuser) + fila de cierre 2025 fabricada
select app._insertar_asiento(
  'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', date '2025-06-30', 'Asiento smoke 2025', 'manual', null, null, null,
  jsonb_build_array(
    jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema = 'banco'),  'debe', 1000, 'haber', 0),
    jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema = 'ventas'), 'debe', 0, 'haber', 1000)
  )) as asiento_2025 \gset
insert into cierres_ejercicio (empresa_id, anio, asiento_cierre_id, resultado, creado_por)
values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 2025, :'asiento_2025', 1000, '11111111-1111-1111-1111-111111111111');

-- 3) _fecha_contable: clamp simple (2025 cerrado -> 2026-01-01) e intacta (2026)
select app._fecha_contable('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', date '2025-03-15') as clamp_simple,
       app._fecha_contable('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', date '2026-03-15') as intacta;

-- 4) Documento tardio: venta emitida en 2025 -> asiento con fecha 2026-01-01
insert into public.documentos_venta (id, empresa_id, tipo, cliente_id, folio, estado, neto, exento, iva, total, emitido_en)
values ('dddddddd-0000-0000-0000-0000000000e1', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'factura', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 1001, 'emitido', 100000, 0, 19000, 119000, timestamptz '2025-05-10');
select contabilizar_documento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'venta', 'dddddddd-0000-0000-0000-0000000000e1') as tardio;
select fecha as fecha_asiento_tardio from asientos
where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and origen = 'venta'
  and referencia_id = 'dddddddd-0000-0000-0000-0000000000e1';

-- 5) Clamp CONSECUTIVO: cierro tambien 2026 (misma FK de asiento) -> 2027-01-01
insert into cierres_ejercicio (empresa_id, anio, asiento_cierre_id, resultado, creado_por)
values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 2026, :'asiento_2025', 0, '11111111-1111-1111-1111-111111111111');
select app._fecha_contable('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', date '2025-03-15') as clamp_consecutivo;

-- 6) Candado del helper: fecha en anio cerrado -> mensaje byte-exacto
do $do$
begin
  perform app._insertar_asiento(
    'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', date '2025-12-01', 'Bloqueado', 'manual', null, null, null,
    jsonb_build_array(
      jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema = 'banco'),  'debe', 100, 'haber', 0),
      jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema = 'ventas'), 'debe', 0, 'haber', 100)));
  raise notice 'FALLO: no bloqueo';
exception when others then
  raise notice 'OK candado: %', sqlerrm;
end $do$;

-- 7) RLS/escritura de cierres_ejercicio: la duena VE (2 filas) pero NO escribe (42501)
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select count(*) as filas_visibles from cierres_ejercicio where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa';
do $do$
begin
  insert into cierres_ejercicio (empresa_id, anio, asiento_cierre_id, resultado, creado_por)
  values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 2024, gen_random_uuid(), 0, '11111111-1111-1111-1111-111111111111');
  raise notice 'FALLO: inserto directo';
exception when insufficient_privilege then
  raise notice 'OK 42501 cierres sin escritura directa';
end $do$;
reset role;

rollback;
```

Run (Bash tool / Git Bash — NO PowerShell 5.1: su pipe re-encoda las tildes UTF-8 del SQL a ANSI/ASCII y el candado compararía mojibake):

```bash
cat .superpowers/sdd/smoke-p17-t1.sql | docker exec -i supabase_db_ERP_Transportes psql -U postgres -d postgres -v ON_ERROR_STOP=1
```

Salida esperada (valores, en orden):
- (1) `cuentas = 28`, `claves = 11`, `grupos = 5`; fila `3.1.03 | Utilidad del ejercicio | patrimonio | t`.
- (3) `clamp_simple = 2026-01-01`, `intacta = 2026-03-15`.
- (4) `tardio = creado`; `fecha_asiento_tardio = 2026-01-01` (la venta era de 2025-05-10: clampeada).
- (5) `clamp_consecutivo = 2027-01-01` (2025 y 2026 cerrados).
- (6) `NOTICE:  OK candado: El ejercicio 2025 está cerrado` (byte-exacto, año interpolado).
- (7) `filas_visibles = 2`; `NOTICE:  OK 42501 cierres sin escritura directa`.
- Cierre: `ROLLBACK` (nada persiste).

Byte-scan del archivo (JAMÁS BOM U+FEFF):

```
grep -c $'\xEF\xBB\xBF' supabase/migrations/00000000000024_estados_financieros.sql
```

→ imprime `0` y sale con status 1 (sin coincidencias = pass).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/00000000000024_estados_financieros.sql supabase/tests/database/contabilidad.test.sql
git commit -m "feat(db): cierres de ejercicio — candado de período, fecha contable y cuenta de utilidad"
```

---

### Task 2: Migración 0024 (sección 2) — cerrar_ejercicio, reabrir_ejercicio y revision_periodo

**Files:**
- Modify: `supabase/migrations/00000000000024_estados_financieros.sql` (anexa DESPUÉS de la marca `-- ===== RPCs de cierre y revision (Task 2) =====` de Task 1; la marca se conserva, patrón 0022).

**Interfaces:**
- Consumes (Task 1, mismo archivo): `cierres_ejercicio`, `app._fecha_contable`, el candado de `app._insertar_asiento`, la ancla `utilidad_ejercicio`. Del schema previo: `asientos`/`asientos_lineas`/`cuentas_contables` (0022), `libro_ventas` (0011 — regla 2, misma expresión de fecha `coalesce(emitido_en, creado_en)::date` y NC con signo), `saldos_documentos` (0010 — regla 3: `saldo`/`fecha_vencimiento`), `correos_enviados` tipo `'recordatorio'` (0020 — regla 3), `documentos_venta`/`documentos_compra` (reglas 1/4/6), `pagos`/`pagos_proveedor`/`anticipos` (reglas 1/5/6), `app.tiene_rol_en_empresa()` (0003).
- Produces (security definer, `set search_path = public`; advisory lock `'asientos:'||empresa` PRIMERO en las dos que crean asientos — patrón 0022; `revision_periodo` es solo lectura y no lo toma):
  - `public.cerrar_ejercicio(p_empresa uuid, p_anio integer) returns uuid` — asiento de cierre (origen `'cierre'`, `referencia_id null`, fecha 31-dic) ANTES de la marca `'cerrado'`; noop → `null` sin fila ni asiento; `resultado` guardado.
  - `public.reabrir_ejercicio(p_empresa uuid, p_anio integer) returns uuid` — marca `'reabierto'` ANTES de la reversa (origen `'reversa'`, `reversa_de = asiento_cierre_id`, misma fecha 31-dic).
  - `public.revision_periodo(p_empresa uuid, p_anio integer, p_mes integer) returns jsonb` — `{periodo: {anio, mes}, estado, observaciones: [{regla, severidad, titulo, detalle, enlace_tipo, enlace_id}]}`; 7 reglas en orden; semáforo = peor severidad (`critica` > `media` > `ok`).
  - Contrato `enlace_tipo` (consumido por `rutaEnlace` de la Task 4 — ver Global Constraints): `'documento_venta'` (regla 3), `'anticipo'` (regla 5), `'asiento'` (regla 6), `'cierre'` (regla 7 — la UI lo mapea a null: sin link), `null` (reglas 1, 2 y 4).
- Mensajes byte-exactos (año interpolado): `'Tu rol no permite cerrar el ejercicio'`, `'Solo se puede cerrar un ejercicio terminado'`, `'El ejercicio 2025 ya está cerrado'`, `'Cierra primero el ejercicio 2024'`, `'La contabilidad no está activada'`, `'Tu rol no permite reabrir el ejercicio'`, `'El ejercicio 2023 no está cerrado'`, `'Reabre primero el ejercicio 2025'`, `'Tu rol no permite ver la revisión'`, `'Período no válido'` (p_anio/p_mes null o mes fuera de 1-12, validado tras el rol).
- Grants (§3.4): las 3 RPCs `revoke from anon, public` + `grant to authenticated` (validación de rol adentro).

- [ ] **Step 1: Anexar las 3 RPCs a la migración**

Anexar a `supabase/migrations/00000000000024_estados_financieros.sql`, DESPUÉS de la marca (la marca queda):

```sql

-- ================== Cierre de ejercicio y Contador Auditor (Task 2) ==================
-- security definer + set search_path = public. cerrar/reabrir toman PRIMERO el
-- advisory xact-lock del correlativo (patron 0022): tambien serializa la fila
-- de cierres_ejercicio (anti doble-cierre concurrente). revision_periodo es
-- solo lectura: no crea asientos, no toma el candado.

-- ---------- Cerrar ejercicio (dueno/admin/contador; asiento ANTES de la marca) ----------
-- Una linea inversa por cuenta de resultado con saldo del anio (excluyendo
-- cierres previos y sus reversas) la deja en 0; contrapartida unica a
-- 'utilidad_ejercicio' (haber si utilidad, debe si perdida). Sin cuentas de
-- resultado con saldo neto <> 0 -> noop (null, ni asiento ni fila — patron noop
-- P16). El "cierre en orden" usa el MISMO criterio del noop (saldo neto por
-- cuenta <> 0, no la mera existencia de lineas): un anio con solo movimientos
-- de balance, o cuyas lineas de resultado netean 0 por cuenta, cierra en noop
-- (sin fila) y no debe bloquear los cierres siguientes.
create or replace function public.cerrar_ejercicio(p_empresa uuid, p_anio integer)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_abierto integer;
  v_lineas jsonb;
  v_resultado bigint;
  v_utilidad uuid;
  v_asiento uuid;
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'contador']) then
    raise exception 'Tu rol no permite cerrar el ejercicio';
  end if;
  if not exists (select 1 from empresas where id = p_empresa and modulo_contabilidad) then
    raise exception 'La contabilidad no está activada';
  end if;
  if p_anio is null or p_anio >= extract(year from current_date)::integer then
    raise exception 'Solo se puede cerrar un ejercicio terminado';
  end if;

  -- Candado del correlativo PRIMERO (patron 0022).
  perform pg_advisory_xact_lock(hashtextextended('asientos:' || p_empresa::text, 42));

  if exists (select 1 from cierres_ejercicio
             where empresa_id = p_empresa and anio = p_anio and estado = 'cerrado') then
    raise exception 'El ejercicio % ya está cerrado', p_anio;
  end if;

  -- Cierre EN ORDEN: el anio mas antiguo abierto con algo que cerrar, primero.
  -- Criterio UNIFICADO con el noop y la regla 7 (Global Constraints): alguna
  -- cuenta de resultado con saldo neto <> 0 en el anio (mismo having que arma
  -- las lineas del cierre) — la mera existencia de lineas que netean 0 NO cuenta.
  select min(t.anio) into v_abierto
  from (
    select extract(year from a.fecha)::integer as anio
    from asientos_lineas l
    join asientos a on a.id = l.asiento_id and a.empresa_id = l.empresa_id
    join cuentas_contables c on c.id = l.cuenta_id and c.empresa_id = l.empresa_id
    where l.empresa_id = p_empresa
      and extract(year from a.fecha)::integer < p_anio
      and c.tipo in ('ingreso', 'gasto')
      and a.origen <> 'cierre'
      and not exists (
        select 1 from asientos x
        where x.empresa_id = p_empresa and x.id = a.reversa_de and x.origen = 'cierre')
    group by extract(year from a.fecha)::integer, l.cuenta_id
    having sum(l.debe - l.haber) <> 0
  ) t
  where not exists (
    select 1 from cierres_ejercicio ce
    where ce.empresa_id = p_empresa and ce.anio = t.anio and ce.estado = 'cerrado');
  if v_abierto is not null then
    raise exception 'Cierra primero el ejercicio %', v_abierto;
  end if;

  -- Saldos de resultado del anio (excluyendo cierres previos y sus reversas):
  -- linea inversa por cuenta; el neto (haber - debe) es el resultado.
  select coalesce(jsonb_agg(jsonb_build_object(
           'cuentaId', s.cuenta_id,
           'debe',  case when s.saldo < 0 then -s.saldo else 0 end,
           'haber', case when s.saldo > 0 then s.saldo else 0 end) order by s.codigo), '[]'::jsonb),
         coalesce(sum(-s.saldo), 0)
  into v_lineas, v_resultado
  from (
    select l.cuenta_id, c.codigo, sum(l.debe - l.haber)::bigint as saldo
    from asientos_lineas l
    join asientos a on a.id = l.asiento_id and a.empresa_id = l.empresa_id
    join cuentas_contables c on c.id = l.cuenta_id and c.empresa_id = l.empresa_id
    where l.empresa_id = p_empresa
      and extract(year from a.fecha)::integer = p_anio
      and c.tipo in ('ingreso', 'gasto')
      and a.origen <> 'cierre'
      and not exists (
        select 1 from asientos x
        where x.empresa_id = p_empresa and x.id = a.reversa_de and x.origen = 'cierre')
    group by l.cuenta_id, c.codigo
    having sum(l.debe - l.haber) <> 0
  ) s;

  -- Sin movimientos de resultado -> noop (ni asiento ni fila).
  if jsonb_array_length(v_lineas) = 0 then
    return null;
  end if;

  -- Contrapartida unica (si el resultado es exactamente 0, las lineas cuadran solas).
  if v_resultado <> 0 then
    select id into v_utilidad from cuentas_contables
    where empresa_id = p_empresa and clave_sistema = 'utilidad_ejercicio';
    v_lineas := v_lineas || jsonb_build_array(jsonb_build_object(
      'cuentaId', v_utilidad,
      'debe',  case when v_resultado < 0 then -v_resultado else 0 end,
      'haber', case when v_resultado > 0 then v_resultado else 0 end));
  end if;

  -- Asiento PRIMERO (la fila aun no esta 'cerrado': el candado del helper no
  -- bloquea); referencia_id null (la anti-doble-ejecucion es la fila + el lock).
  v_asiento := app._insertar_asiento(
    p_empresa, make_date(p_anio, 12, 31), 'Cierre del ejercicio ' || p_anio,
    'cierre', null, null, auth.uid(), v_lineas);

  -- LUEGO la marca: insert la primera vez; al re-cerrar tras reabrir, la fila
  -- vuelve a 'cerrado' con el asiento nuevo (update via on conflict).
  insert into cierres_ejercicio (empresa_id, anio, asiento_cierre_id, resultado, creado_por)
  values (p_empresa, p_anio, v_asiento, v_resultado::integer, auth.uid())
  on conflict (empresa_id, anio) do update
    set estado = 'cerrado', asiento_cierre_id = excluded.asiento_cierre_id,
        resultado = excluded.resultado, creado_por = excluded.creado_por,
        creado_en = now(), reabierto_por = null, reabierto_en = null;

  return v_asiento;
end $$;
revoke execute on function public.cerrar_ejercicio(uuid, integer) from anon, public;
grant execute on function public.cerrar_ejercicio(uuid, integer) to authenticated;

-- ---------- Reabrir ejercicio (dueno/admin/contador; marca ANTES de la reversa) ----------
-- Solo el ultimo cierre vigente se reabre (sin cierre posterior 'cerrado').
-- La reversa liga reversa_de = asiento_cierre_id con la MISMA fecha 31-dic (no
-- contamina el ejercicio siguiente). La unicidad una-reversa-por-asiento (0022)
-- se respeta: cada re-cierre crea asiento nuevo, cada reapertura revierte el vigente.
create or replace function public.reabrir_ejercicio(p_empresa uuid, p_anio integer)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_cierre record;
  v_posterior integer;
  v_lineas jsonb;
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'contador']) then
    raise exception 'Tu rol no permite reabrir el ejercicio';
  end if;

  -- Candado del correlativo PRIMERO (patron 0022).
  perform pg_advisory_xact_lock(hashtextextended('asientos:' || p_empresa::text, 42));

  select * into v_cierre from cierres_ejercicio
  where empresa_id = p_empresa and anio = p_anio and estado = 'cerrado'
  for update;
  if not found then
    raise exception 'El ejercicio % no está cerrado', p_anio;
  end if;

  select max(anio) into v_posterior from cierres_ejercicio
  where empresa_id = p_empresa and anio > p_anio and estado = 'cerrado';
  if v_posterior is not null then
    raise exception 'Reabre primero el ejercicio %', v_posterior;
  end if;

  -- Marca PRIMERO (el candado del helper deja de bloquear el anio), LUEGO la reversa.
  update cierres_ejercicio
  set estado = 'reabierto', reabierto_por = auth.uid(), reabierto_en = now()
  where id = v_cierre.id and empresa_id = p_empresa;

  -- Lineas inversas del asiento de cierre vigente (debe <-> haber, patron revertir_asiento).
  select jsonb_agg(jsonb_build_object('cuentaId', cuenta_id, 'debe', haber, 'haber', debe, 'glosa', glosa))
  into v_lineas
  from asientos_lineas
  where empresa_id = p_empresa and asiento_id = v_cierre.asiento_cierre_id;

  return app._insertar_asiento(
    p_empresa, make_date(p_anio, 12, 31), 'Reapertura del ejercicio ' || p_anio,
    'reversa', null, v_cierre.asiento_cierre_id, auth.uid(), v_lineas);
end $$;
revoke execute on function public.reabrir_ejercicio(uuid, integer) from anon, public;
grant execute on function public.reabrir_ejercicio(uuid, integer) to authenticated;

-- ---------- Revision del periodo (Contador Auditor: 7 reglas deterministas) ----------
-- Solo lectura; jsonb {periodo, estado, observaciones}. severidad critica >
-- media > ok; estado = la peor presente (sin observaciones -> 'ok'). Los
-- montos van crudos en el detalle (CLP enteros, sin separador de miles: los
-- goldens pgTAP comparan byte a byte; la UI puede reformatear).
create or replace function public.revision_periodo(p_empresa uuid, p_anio integer, p_mes integer)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_desde date;
  v_hasta date;             -- exclusivo (primer dia del mes siguiente)
  v_obs jsonb := '[]'::jsonb;
  v_n bigint;
  v_libro bigint;
  v_cuenta bigint;
  v_actual bigint;
  v_meses integer;
  v_prom numeric;
  v_doc record;
  v_ant record;
  v_tar record;
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'contador']) then
    raise exception 'Tu rol no permite ver la revisión';
  end if;
  -- Periodo valido (tras el rol): sin esto, make_date reventaria con un error
  -- crudo de Postgres ante p_mes fuera de 1-12.
  if p_anio is null or p_mes is null or p_mes not between 1 and 12 then
    raise exception 'Período no válido';
  end if;

  v_desde := make_date(p_anio, p_mes, 1);
  v_hasta := (v_desde + interval '1 month')::date;

  -- Regla 1: documentos_sin_contabilizar (CRITICA). Mismo criterio de
  -- pendientes de contabilizar_pendientes (0022), acotado al periodo.
  select count(*) into v_n from (
                  select 'venta'::text as origen, d.id as referencia_id, coalesce(d.emitido_en, d.creado_en)::date as fecha
    from documentos_venta d
    where d.empresa_id = p_empresa and d.estado = 'emitido' and d.tipo in ('factura', 'boleta')
    union all select 'nota_credito', d.id, coalesce(d.emitido_en, d.creado_en)::date
    from documentos_venta d
    where d.empresa_id = p_empresa and d.estado = 'emitido' and d.tipo = 'nota_credito'
    union all select 'compra', c.id, c.fecha_emision
    from documentos_compra c
    where c.empresa_id = p_empresa and c.estado = 'activa'
    union all select 'pago', pg.id, pg.fecha
    from pagos pg
    where pg.empresa_id = p_empresa and pg.estado = 'activo'
    union all select 'pago_proveedor', pp.id, pp.fecha
    from pagos_proveedor pp
    where pp.empresa_id = p_empresa and pp.estado = 'activo'
    union all select 'anticipo', a.id, a.recibido_en::date
    from anticipos a
    where a.empresa_id = p_empresa and a.mp_payment_id is not null
  ) t
  where t.fecha >= v_desde and t.fecha < v_hasta
    and not exists (
      select 1 from asientos x
      where x.empresa_id = p_empresa and x.origen = t.origen and x.referencia_id = t.referencia_id);
  if v_n > 0 then
    v_obs := v_obs || jsonb_build_array(jsonb_build_object(
      'regla', 'documentos_sin_contabilizar', 'severidad', 'critica',
      'titulo', 'Documentos sin contabilizar',
      'detalle', v_n || case when v_n = 1
        then ' documento del período sin asiento contable'
        else ' documentos del período sin asiento contable' end,
      'enlace_tipo', null, 'enlace_id', null));
  end if;

  -- Regla 2: iva_descuadrado (CRITICA). IVA debito del libro de ventas del mes
  -- (0011: NC con signo negativo) vs movimientos del mes en la cuenta ancla.
  select coalesce(sum(iva), 0) into v_libro
  from libro_ventas
  where empresa_id = p_empresa and fecha >= v_desde and fecha < v_hasta;
  select coalesce(sum(l.haber - l.debe), 0) into v_cuenta
  from asientos_lineas l
  join asientos a on a.id = l.asiento_id and a.empresa_id = l.empresa_id
  join cuentas_contables c on c.id = l.cuenta_id and c.empresa_id = l.empresa_id
  where l.empresa_id = p_empresa and c.clave_sistema = 'iva_debito'
    and a.fecha >= v_desde and a.fecha < v_hasta;
  if v_libro <> v_cuenta then
    v_obs := v_obs || jsonb_build_array(jsonb_build_object(
      'regla', 'iva_descuadrado', 'severidad', 'critica',
      'titulo', 'IVA débito descuadrado',
      'detalle', 'IVA débito del libro de ventas: $' || v_libro
        || ' · movimientos de la cuenta: $' || v_cuenta
        || ' · diferencia: $' || (v_libro - v_cuenta),
      'enlace_tipo', null, 'enlace_id', null));
  end if;

  -- Regla 3: facturas_vencidas_sin_gestion (MEDIA). Con saldo, vencidas hace
  -- mas de 30 dias y sin recordatorio (0020) en los ultimos 30 dias.
  for v_doc in
    select s.documento_id, s.folio, s.saldo, s.fecha_vencimiento
    from saldos_documentos s
    where s.empresa_id = p_empresa and s.tipo = 'factura' and s.saldo > 0
      and s.fecha_vencimiento < current_date - 30
      and not exists (
        select 1 from correos_enviados ce
        where ce.empresa_id = p_empresa and ce.tipo = 'recordatorio'
          and ce.referencia_id = s.documento_id
          and ce.creado_en > now() - interval '30 days')
    order by s.fecha_vencimiento, s.documento_id
  loop
    v_obs := v_obs || jsonb_build_array(jsonb_build_object(
      'regla', 'facturas_vencidas_sin_gestion', 'severidad', 'media',
      'titulo', 'Factura vencida sin gestión',
      'detalle', 'Factura N° ' || v_doc.folio || ' vencida el ' || v_doc.fecha_vencimiento
        || ' con saldo $' || v_doc.saldo || ' y sin recordatorio en los últimos 30 días',
      'enlace_tipo', 'documento_venta', 'enlace_id', v_doc.documento_id));
  end loop;

  -- Regla 4: anomalia_vs_promedio (MEDIA). Banda 60%-140% del promedio de los
  -- hasta 6 meses anteriores CON datos; minimo 2 meses para opinar (filosofia
  -- del semaforo del dashboard). Ventas por libro_ventas; gastos por compras activas.
  select coalesce(sum(total), 0) into v_actual
  from libro_ventas
  where empresa_id = p_empresa and fecha >= v_desde and fecha < v_hasta;
  select count(*), avg(m.monto) into v_meses, v_prom
  from (
    select date_trunc('month', fecha)::date as mes, sum(total) as monto
    from libro_ventas
    where empresa_id = p_empresa
      and fecha >= (v_desde - interval '6 months')::date and fecha < v_desde
    group by 1
  ) m;
  if v_meses >= 2 and (v_actual < 0.6 * v_prom or v_actual > 1.4 * v_prom) then
    v_obs := v_obs || jsonb_build_array(jsonb_build_object(
      'regla', 'anomalia_vs_promedio', 'severidad', 'media',
      'titulo', 'Ventas fuera de lo normal',
      'detalle', 'Ventas del mes: $' || v_actual || ' · promedio de los últimos '
        || v_meses || ' meses: $' || round(v_prom)::bigint || ' · banda normal: 60%-140%',
      'enlace_tipo', null, 'enlace_id', null));
  end if;
  select coalesce(sum(total), 0) into v_actual
  from documentos_compra
  where empresa_id = p_empresa and estado = 'activa'
    and fecha_emision >= v_desde and fecha_emision < v_hasta;
  select count(*), avg(m.monto) into v_meses, v_prom
  from (
    select date_trunc('month', fecha_emision)::date as mes, sum(total) as monto
    from documentos_compra
    where empresa_id = p_empresa and estado = 'activa'
      and fecha_emision >= (v_desde - interval '6 months')::date and fecha_emision < v_desde
    group by 1
  ) m;
  if v_meses >= 2 and (v_actual < 0.6 * v_prom or v_actual > 1.4 * v_prom) then
    v_obs := v_obs || jsonb_build_array(jsonb_build_object(
      'regla', 'anomalia_vs_promedio', 'severidad', 'media',
      'titulo', 'Gastos fuera de lo normal',
      'detalle', 'Gastos del mes: $' || v_actual || ' · promedio de los últimos '
        || v_meses || ' meses: $' || round(v_prom)::bigint || ' · banda normal: 60%-140%',
      'enlace_tipo', null, 'enlace_id', null));
  end if;

  -- Regla 5: anticipos_sin_aplicar (MEDIA). Recibidos hace mas de 60 dias.
  for v_ant in
    select a.id, a.monto, a.recibido_en::date as recibido
    from anticipos a
    where a.empresa_id = p_empresa and a.estado = 'recibido'
      and a.recibido_en < now() - interval '60 days'
    order by a.recibido_en, a.id
  loop
    v_obs := v_obs || jsonb_build_array(jsonb_build_object(
      'regla', 'anticipos_sin_aplicar', 'severidad', 'media',
      'titulo', 'Anticipo sin aplicar',
      'detalle', 'Anticipo de $' || v_ant.monto || ' recibido el ' || v_ant.recibido
        || ' sigue sin aplicarse (más de 60 días)',
      'enlace_tipo', 'anticipo', 'enlace_id', v_ant.id));
  end loop;

  -- Regla 6: asientos_tardios (MEDIA). Asientos automaticos del periodo cuya
  -- fecha difiere de la del documento origen (el clamping de app._fecha_contable
  -- o cualquier descalce): join por origen/referencia_id, misma expresion de
  -- fecha por origen que contabilizar_documento.
  for v_tar in
    select a.id, a.numero, a.fecha, d.fecha_doc
    from asientos a
    cross join lateral (
      select case a.origen
        when 'venta'          then (select coalesce(v.emitido_en, v.creado_en)::date from documentos_venta v  where v.id = a.referencia_id and v.empresa_id = a.empresa_id)
        when 'nota_credito'   then (select coalesce(v.emitido_en, v.creado_en)::date from documentos_venta v  where v.id = a.referencia_id and v.empresa_id = a.empresa_id)
        when 'compra'         then (select c.fecha_emision                          from documentos_compra c where c.id = a.referencia_id and c.empresa_id = a.empresa_id)
        when 'pago'           then (select p.fecha                                  from pagos p             where p.id = a.referencia_id and p.empresa_id = a.empresa_id)
        when 'pago_proveedor' then (select pp.fecha                                 from pagos_proveedor pp  where pp.id = a.referencia_id and pp.empresa_id = a.empresa_id)
        when 'anticipo'       then (select an.recibido_en::date                     from anticipos an        where an.id = a.referencia_id and an.empresa_id = a.empresa_id)
      end as fecha_doc
    ) d
    where a.empresa_id = p_empresa
      and a.fecha >= v_desde and a.fecha < v_hasta
      and a.referencia_id is not null
      and a.origen in ('venta', 'nota_credito', 'compra', 'pago', 'pago_proveedor', 'anticipo')
      and d.fecha_doc is not null and d.fecha_doc <> a.fecha
    order by a.numero
  loop
    v_obs := v_obs || jsonb_build_array(jsonb_build_object(
      'regla', 'asientos_tardios', 'severidad', 'media',
      'titulo', 'Asiento con fecha distinta al documento',
      'detalle', 'Asiento N° ' || v_tar.numero || ' con fecha ' || v_tar.fecha
        || ' registra un documento del ' || v_tar.fecha_doc,
      'enlace_tipo', 'asiento', 'enlace_id', v_tar.id));
  end loop;

  -- Regla 7: ejercicio_anterior_abierto (MEDIA, CTA al cierre asistido).
  -- Criterio UNIFICADO con el noop y el candado de orden de cerrar_ejercicio
  -- (Global Constraints): alguna cuenta de resultado con saldo neto <> 0 en el
  -- anio anterior (un anio sin nada que cerrar no genera observacion).
  if exists (
       select 1
       from asientos_lineas l
       join asientos a on a.id = l.asiento_id and a.empresa_id = l.empresa_id
       join cuentas_contables c on c.id = l.cuenta_id and c.empresa_id = l.empresa_id
       where l.empresa_id = p_empresa
         and extract(year from a.fecha)::integer = p_anio - 1
         and c.tipo in ('ingreso', 'gasto')
         and a.origen <> 'cierre'
         and not exists (
           select 1 from asientos x
           where x.empresa_id = p_empresa and x.id = a.reversa_de and x.origen = 'cierre')
       group by l.cuenta_id
       having sum(l.debe - l.haber) <> 0)
     and not exists (
       select 1 from cierres_ejercicio ce
       where ce.empresa_id = p_empresa and ce.anio = p_anio - 1 and ce.estado = 'cerrado') then
    v_obs := v_obs || jsonb_build_array(jsonb_build_object(
      'regla', 'ejercicio_anterior_abierto', 'severidad', 'media',
      'titulo', 'Ejercicio anterior sin cerrar',
      'detalle', 'El ejercicio ' || (p_anio - 1) || ' tiene movimientos de resultado y aún no está cerrado',
      'enlace_tipo', 'cierre', 'enlace_id', null));
  end if;

  return jsonb_build_object(
    'periodo', jsonb_build_object('anio', p_anio, 'mes', p_mes),
    'estado', case
      when v_obs @> '[{"severidad": "critica"}]'::jsonb then 'critica'
      when v_obs @> '[{"severidad": "media"}]'::jsonb then 'media'
      else 'ok' end,
    'observaciones', v_obs);
end $$;
revoke execute on function public.revision_periodo(uuid, integer, integer) from anon, public;
grant execute on function public.revision_periodo(uuid, integer, integer) to authenticated;
```

- [ ] **Step 2: Aplicar y verificar**

Run: `npx supabase db reset` → aplica 0001-0024 completo sin errores.

Run: `npx supabase test db` → **17 archivos, 327 asserts** siguen verdes (las 3 RPCs son aditivas; `estados_financieros.test.sql` lo escribe una task posterior).

Validación en vivo de las 3 RPCs (transaccional, TODO se revierte). Escribir (Write tool, UTF-8 sin BOM) `.superpowers/sdd/smoke-p17-t2.sql`:

```sql
\set ON_ERROR_STOP on
begin;

-- Fixture (superuser): Ana duena, Ces CONTADOR, Vero VENDEDORA; movimientos de
-- resultado en 2024 y 2025; una venta emitida en julio 2026 SIN contabilizar.
insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'ana@a.cl'),
  ('00000000-0000-0000-0000-000000000000', '55555555-5555-5555-5555-555555555555', 'authenticated', 'authenticated', 'ces@a.cl'),
  ('00000000-0000-0000-0000-000000000000', '77777777-7777-7777-7777-777777777777', 'authenticated', 'authenticated', 'vero@a.cl');
insert into public.organizaciones (id, rut, razon_social)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '769010007', 'Org A');
insert into public.empresas (id, organizacion_id, rut, razon_social)
values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '769010007', 'Contable A');
insert into public.miembros (usuario_id, organizacion_id, rol)
values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'dueno'),
       ('55555555-5555-5555-5555-555555555555', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'contador'),
       ('77777777-7777-7777-7777-777777777777', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'vendedor');
insert into public.clientes (id, empresa_id, rut, razon_social)
values ('cccccccc-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '769031006', 'Cliente A1');

set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select activar_contabilidad('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa');
reset role;

-- Asientos de resultado (helper directo, superuser): 2024 utilidad 1000;
-- 2025 ventas 2000 y gasto 500 (utilidad 1500).
select app._insertar_asiento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', date '2024-06-30', 'Ventas 2024', 'manual', null, null, null,
  jsonb_build_array(
    jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema = 'banco'),  'debe', 1000, 'haber', 0),
    jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema = 'ventas'), 'debe', 0, 'haber', 1000)));
select app._insertar_asiento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', date '2025-04-15', 'Ventas 2025', 'manual', null, null, null,
  jsonb_build_array(
    jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema = 'banco'),  'debe', 2000, 'haber', 0),
    jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema = 'ventas'), 'debe', 0, 'haber', 2000)));
select app._insertar_asiento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', date '2025-05-20', 'Gastos 2025', 'manual', null, null, null,
  jsonb_build_array(
    jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema = 'compras_gastos'), 'debe', 500, 'haber', 0),
    jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema = 'banco'),          'debe', 0, 'haber', 500)));

-- Venta emitida en julio 2026 SIN contabilizar (alimenta reglas 1 y 2).
insert into public.documentos_venta (id, empresa_id, tipo, cliente_id, folio, estado, neto, exento, iva, total, emitido_en)
values ('dddddddd-0000-0000-0000-0000000000e1', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'factura', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 2001, 'emitido', 100000, 0, 19000, 119000, timestamptz '2026-07-05');

set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- 1) Noop: 2023 sin movimientos -> null, ni asiento ni fila.
select cerrar_ejercicio('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 2023) is null as noop_2023;

-- 2) Rol: la vendedora no cierra.
set local request.jwt.claims to '{"sub": "77777777-7777-7777-7777-777777777777", "role": "authenticated"}';
do $do$
begin
  perform cerrar_ejercicio('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 2024);
  raise notice 'FALLO: no bloqueo';
exception when others then
  raise notice 'OK rol: %', sqlerrm;
end $do$;

-- 3) Orden: 2025 no cierra con 2024 abierto.
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
do $do$
begin
  perform cerrar_ejercicio('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 2025);
  raise notice 'FALLO: no bloqueo';
exception when others then
  raise notice 'OK orden: %', sqlerrm;
end $do$;

-- 4) El CONTADOR cierra 2024 (spec: contador SI puede).
set local request.jwt.claims to '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated"}';
select cerrar_ejercicio('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 2024) as cierre_2024 \gset

-- 5) Anio en curso no se cierra.
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
do $do$
begin
  perform cerrar_ejercicio('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 2026);
  raise notice 'FALLO: no bloqueo';
exception when others then
  raise notice 'OK terminado: %', sqlerrm;
end $do$;

-- 6) Cierre feliz de 2025.
select cerrar_ejercicio('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 2025) as cierre_2025 \gset

-- 7) Doble cierre.
do $do$
begin
  perform cerrar_ejercicio('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 2025);
  raise notice 'FALLO: no bloqueo';
exception when others then
  raise notice 'OK doble: %', sqlerrm;
end $do$;

-- 8) Reabrir 2024 con 2025 cerrado -> primero el posterior.
do $do$
begin
  perform reabrir_ejercicio('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 2024);
  raise notice 'FALLO: no bloqueo';
exception when others then
  raise notice 'OK posterior: %', sqlerrm;
end $do$;

-- 9) Reabrir un anio nunca cerrado.
do $do$
begin
  perform reabrir_ejercicio('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 2023);
  raise notice 'FALLO: no bloqueo';
exception when others then
  raise notice 'OK no-cerrado: %', sqlerrm;
end $do$;

-- 10) Roles de reabrir y revision (vendedora).
set local request.jwt.claims to '{"sub": "77777777-7777-7777-7777-777777777777", "role": "authenticated"}';
do $do$
begin
  perform reabrir_ejercicio('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 2025);
  raise notice 'FALLO: no bloqueo';
exception when others then
  raise notice 'OK rol-reabrir: %', sqlerrm;
end $do$;
do $do$
begin
  perform revision_periodo('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 2026, 7);
  raise notice 'FALLO: no bloqueo';
exception when others then
  raise notice 'OK rol-revision: %', sqlerrm;
end $do$;

-- 11) Reabrir 2025 (duena) y revision de julio 2026.
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select reabrir_ejercicio('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 2025) as reversa_2025 \gset
select revision_periodo('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 2026, 7) as rev \gset
reset role;

-- ===== Verificaciones (superuser) =====
-- 12) Asiento de cierre 2025: origen/fecha/glosa y lineas doradas.
select origen, fecha, glosa from asientos where id = :'cierre_2025';
select string_agg(c.clave_sistema || ':' || l.debe || ':' || l.haber, '|' order by c.clave_sistema) as lineas_cierre
from asientos_lineas l
join cuentas_contables c on c.id = l.cuenta_id and c.empresa_id = l.empresa_id
where l.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and l.asiento_id = :'cierre_2025';

-- 13) Filas de cierre: 2024 cerrado (1000), 2025 reabierto (1500) con auditoria; 2023 sin fila.
select anio, estado, resultado, (reabierto_por is not null and reabierto_en is not null) as auditoria_reapertura
from cierres_ejercicio where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' order by anio;

-- 14) Reversa de reapertura: ligada al cierre, misma fecha 31-dic.
select origen, fecha, glosa, (reversa_de = :'cierre_2025'::uuid) as liga from asientos where id = :'reversa_2025';

-- 15) Resultado 2025 vuelve a estar abierto (neto haber-debe = 1500).
select coalesce(sum(l.haber - l.debe), 0) as resultado_2025_abierto
from asientos_lineas l
join asientos a on a.id = l.asiento_id and a.empresa_id = l.empresa_id
join cuentas_contables c on c.id = l.cuenta_id and c.empresa_id = l.empresa_id
where l.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
  and extract(year from a.fecha)::integer = 2025 and c.tipo in ('ingreso', 'gasto');

-- 16) Revision: semaforo y reglas presentes (en orden de regla).
select (:'rev'::jsonb)->>'estado' as estado,
       (select string_agg(o->>'regla', ',') from jsonb_array_elements((:'rev'::jsonb)->'observaciones') o) as reglas;

rollback;
```

Run (Bash tool / Git Bash — NO PowerShell 5.1: su pipe re-encoda las tildes UTF-8 del SQL, misma razón que el smoke de Task 1):

```bash
cat .superpowers/sdd/smoke-p17-t2.sql | docker exec -i supabase_db_ERP_Transportes psql -U postgres -d postgres -v ON_ERROR_STOP=1
```

Salida esperada (valores, en orden):
- (1) `noop_2023 = t`.
- (2) `NOTICE:  OK rol: Tu rol no permite cerrar el ejercicio`.
- (3) `NOTICE:  OK orden: Cierra primero el ejercicio 2024`.
- (4) fila con el uuid `cierre_2024` (el contador SÍ cierra).
- (5) `NOTICE:  OK terminado: Solo se puede cerrar un ejercicio terminado`.
- (6) fila con el uuid `cierre_2025`.
- (7) `NOTICE:  OK doble: El ejercicio 2025 ya está cerrado`.
- (8) `NOTICE:  OK posterior: Reabre primero el ejercicio 2025`.
- (9) `NOTICE:  OK no-cerrado: El ejercicio 2023 no está cerrado`.
- (10) `NOTICE:  OK rol-reabrir: Tu rol no permite reabrir el ejercicio` y `NOTICE:  OK rol-revision: Tu rol no permite ver la revisión`.
- (12) `cierre | 2025-12-31 | Cierre del ejercicio 2025`; `lineas_cierre = compras_gastos:0:500|utilidad_ejercicio:0:1500|ventas:2000:0` (las cuentas de resultado quedan en 0; contrapartida haber 1500 = utilidad).
- (13) dos filas: `2024 | cerrado | 1000 | f` y `2025 | reabierto | 1500 | t` (2023 noop: SIN fila).
- (14) `reversa | 2025-12-31 | Reapertura del ejercicio 2025 | t`.
- (15) `resultado_2025_abierto = 1500`.
- (16) `estado = critica` y `reglas = documentos_sin_contabilizar,iva_descuadrado,ejercicio_anterior_abierto` (la venta de julio sin asiento dispara 1 y 2; el 2025 reabierto con movimientos dispara 7; las demás reglas sin datos no opinan). Caveat de reloj: la factura del fixture está fija al 2026-07-05 — si este smoke se corre pasado agosto-2026, `facturas_vencidas_sin_gestion` puede sumarse a la lista (vencida > 30 días); no es fallo, el smoke es de ejecución inmediata.
- Cierre: `ROLLBACK` (nada persiste).

Byte-scan del archivo (JAMÁS BOM U+FEFF):

```
grep -c $'\xEF\xBB\xBF' supabase/migrations/00000000000024_estados_financieros.sql
```

→ imprime `0` y sale con status 1 (sin coincidencias = pass).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/00000000000024_estados_financieros.sql
git commit -m "feat(db): cerrar y reabrir ejercicio + revisión del período del contador auditor"
```

---

### Task 3: pgTAP de estados financieros — cierre y reapertura de ejercicio, fecha contable y revisión del período

Spec: `docs/superpowers/specs/2026-07-18-plan17-estados-financieros-design.md` (§7 es esta task; los contratos que se prueban son los de §2-§3). Baseline verde: **327 pgTAP (17 archivos)**. Tras esta task la suite queda en **363 pgTAP (18 archivos)**: 327 + 36 asserts nuevos.

Dependencia: esta task corre DESPUÉS de que la migración 0024 (Tasks 1-2 del plan) esté aplicada — el archivo prueba `cerrar_ejercicio`, `reabrir_ejercicio`, `revision_periodo`, `app._fecha_contable`, la tabla `cierres_ejercicio`, el candado de `app._insertar_asiento` y la 11ª ancla `utilidad_ejercicio`. La cuenta nueva se referencia SIEMPRE por `clave_sistema = 'utilidad_ejercicio'` (nunca por código: el código exacto lo fija la migración).

Contexto verificado en el repo (no repetir esta investigación al ejecutar):

- Convenciones copiadas de `supabase/tests/database/contabilidad.test.sql` y `rubros.test.sql`: `begin;` + `create extension if not exists pgtap with schema extensions;` + `select plan(N);` al inicio; fixtures como superuser (insert directo salta grants/RLS); cambio de actor con `set local role authenticated;` + `set local request.jwt.claims to '{"sub": "...", "role": "authenticated"}';`; `set local role service_role;` para el hook; `reset role;` para volver a superuser (patrón `transporte.test.sql:690`); `select * from finish(); rollback;` al final.
- Contrato de `crear_asiento` (P16, 0022): líneas jsonb `[{cuentaId, debe, haber}]` en camelCase; fecha válida entre `2000-01-01` y `current_date + 1`.
- Catálogo sembrado por `activar_contabilidad` (0022:234-267): 10 claves de sistema hoy (`caja, banco, clientes, iva_credito, proveedores, iva_debito, anticipos_clientes, ventas, ventas_exentas, compras_gastos`); la 0024 agrega `utilidad_ejercicio` (patrimonio, hoja) → **11 claves**. El test usa `banco` (activo), `ventas` (ingreso) y `compras_gastos` (gasto) para los movimientos de fixture.
- `contabilizar_documento` toma la fecha de `coalesce(emitido_en, creado_en)::date` para ventas (0022:333); tras 0024 la pasa por `app._fecha_contable`.
- Orden alfabético de claves en los goldens `string_agg(... order by c.clave_sistema)`: `compras_gastos` < `utilidad_ejercicio` < `ventas`.
- Fuentes de las reglas 3/4/5 (verificadas para los fixtures dirigidos): `saldos_documentos` (vista 0010) deriva `fecha_vencimiento = coalesce(emitido_en, creado_en)::date + clientes.condicion_pago_dias` (default **0**: una factura sin pagos vence el día que se emite y su `saldo` es el total); `correos_enviados` (0020) exige `para`/`asunto`/`proveedor_id` not null y `creado_en` default `now()` (un recordatorio insertado en el fixture SIEMPRE cae dentro de la ventana de 30 días de la regla 3); `anticipos` (0018) admite insert directo superuser con `mp_payment_id` **null** (así NO entra a la regla 1 ni a pendientes) y `estado` default `'recibido'`; `libro_ventas` (0011) usa la fecha del DOCUMENTO (`coalesce(emitido_en, creado_en)::date`), no la del asiento clampeado — por eso la factura a2 (nov-2025) cuenta para el promedio de la regla 4 aunque su asiento viva en enero.
- Suma de `plan(N)` vigente en los 17 archivos = 327 (verificado con grep): 6+7+9+10+10+11+11+12+16+18+18+19+27+27+31+36+59.
- Años fijos 2024/2025/2026 en los fixtures: consistente con la convención del repo (contabilidad.test.sql ya fija `date '2026-07-05'`). El único assert dependiente del reloj (año en curso) usa `extract(year from current_date)` y es válido para siempre; el resto exige correr la suite desde el **2026-01-15** en adelante (a2, emitida el 2025-11-15 con vencimiento +0 días, ya está vencida hace más de 30 días) — siempre cierto: hoy es julio 2026 y el reloj solo avanza.

### RUTs nuevos para pgTAP (módulo 11, sin colisión)

RUTs ya ocupados en la suite (grep en `supabase/tests/database/*.sql`): 761111116, 761112228, 761212125, 761234560, 762222221, 762223333, 763333337, 763334449, 763434346, 764444442, 764646460, 765000017, 765432103/4, 76543210K, 765555558, 766666663, 767777779, 768888884, 769010007, 769020002, 769031006, 769040005, 769111115, 769222227, 769333339, 769444440, 769555552, 769606017, 769606025, 769606033, 770000014, 770000022, 771234569, 777000012..777000071, 778899000, 123456785. Seed (`scripts/seed-demo.mjs`): 771234569, 778899000, 761111116, 762222221, 772506309, 768901201, 965112006, 76455180K, 776803308, 78120450-1, 123456785. E2E: 999999999, 888888888. El prefijo **7697100x** está libre en todo el repo (grep `769710` = 0 coincidencias).

Cálculo del dígito verificador (factores 2,3,4,5,6,7,2,3 desde la derecha; DV = 11 − (suma mod 11), 11→'0', 10→'K'):

- Cuerpo **76971001** (dígitos derecha→izquierda 1,0,0,1,7,9,6,7): 1·2 + 0·3 + 0·4 + 1·5 + 7·6 + 9·7 + 6·2 + 7·3 = 2+0+0+5+42+63+12+21 = **145**; 145 mod 11 = 2; DV = 11−2 = **9** → `76.971.001-9` (normalizado `769710019`) — organización y empresa.
- Cuerpo **76971002** (derecha→izquierda 2,0,0,1,7,9,6,7): 2·2 + 0 + 0 + 5 + 42 + 63 + 12 + 21 = **147**; 147 mod 11 = 4; DV = 11−4 = **7** → `76.971.002-7` (normalizado `769710027`) — cliente.

### Conteo de asserts (plan(36))

1. Catálogo: 11 claves de sistema y `utilidad_ejercicio` hoja de patrimonio.
2. Rol: vendedor no cierra → `'Tu rol no permite cerrar el ejercicio'`.
3. Año en curso → `'Solo se puede cerrar un ejercicio terminado'`.
4. Orden de cierre: 2025 antes que 2024 con movimientos → `'Cierra primero el ejercicio 2024'`.
5. Noop sin movimientos (2023): retorna null.
6. El noop no deja fila en `cierres_ejercicio` ni asiento de cierre.
7. El contador SÍ puede cerrar (cierra 2024, retorna uuid).
8. Golden líneas del cierre 2025: resultado contra `utilidad_ejercicio` (cuadrado).
9. Asiento de cierre 2025: fecha 31-dic, origen `cierre`, glosa contractual.
10. Cuentas de resultado con saldo 0 en 2025 tras el cierre.
11. Fila `cierres_ejercicio` 2025: `cerrado` con resultado 70000.
12. Doble cierre → `'El ejercicio 2025 ya está cerrado'`.
13. Candado del helper: asiento manual con fecha 2025 → `'El ejercicio 2025 está cerrado'`.
14. `revertir_asiento` sobre el asiento de cierre → `'El cierre solo se deshace reabriendo el ejercicio'`.
15. `contabilizar_documento` tardío: doc de nov-2025 → asiento al 1-ene-2026.
16. `app._fecha_contable` clamp simple: fecha 2025 → 1-ene-2026.
17. `app._fecha_contable` clamp consecutivo: 2024 y 2025 cerrados, fecha 2024 → 1-ene-2026.
18. `app._fecha_contable` sin cierre: fecha 2026 intacta.
19. Rol: vendedor no reabre → `'Tu rol no permite reabrir el ejercicio'`.
20. Reabrir año no cerrado (2026) → `'El ejercicio 2026 no está cerrado'`.
21. Reabrir 2024 con cierre posterior cerrado → `'Reabre primero el ejercicio 2025'`.
22. Reapertura: reversa ligada por `reversa_de` al asiento de cierre, fecha 31-dic, glosa contractual.
23. Fila 2025 `reabierto` con auditoría (`reabierto_por`/`reabierto_en`).
24. El año reabierto vuelve a aceptar asientos (crear_asiento 2025 feliz).
25. `revision_periodo` rol denegado (vendedor) → `'Tu rol no permite ver la revisión'`.
26. `revision_periodo` con p_mes 13 → `'Período no válido'`.
27. Golden regla 1 `documentos_sin_contabilizar` → severidad `critica`.
28. Golden regla 2 `iva_descuadrado` → severidad `critica`.
29. Golden regla 7 `ejercicio_anterior_abierto` → severidad `media`.
30. Golden regla 6 `asientos_tardios` → severidad `media`.
31. Golden regla 3 `facturas_vencidas_sin_gestion`: SOLO a2 (sin recordatorio); a1/a3 suprimidas por recordatorio reciente.
32. Golden regla 5 `anticipos_sin_aplicar` → severidad `media`, enlace_tipo `anticipo`.
33. Golden regla 4 `anomalia_vs_promedio` (ventas de enero fuera de la banda 60-140%) → severidad `media`.
34. Semáforo agregado del período = `critica` (peor severidad presente).
35. Re-cerrar tras reabrir: fila vuelve a `cerrado` con resultado recalculado (80000).
36. Re-cerrar crea asiento de cierre NUEVO (el vigente no es el revertido; hay 2 cierres al 31-dic-2025).

Los SIETE goldens de revisión (las 7 reglas del spec §7, una foto por regla) salen de UNA sola foto del período enero-2026, tomada con 2025 **reabierto** (entre la reapertura y el re-cierre): la factura a1 de enero sin contabilizar dispara la regla 1 y descuadra el IVA del libro (19000) contra la cuenta `iva_debito` (9500 del asiento clampeado) para la regla 2; a2 (vencida, con saldo, sin recordatorio) dispara la regla 3 mientras a1 y a3 quedan suprimidas por su recordatorio de fixture (`creado_en now()`); las ventas de enero (119000) contra el promedio nov-dic 2025 (59500) rompen la banda 140% para la regla 4 (sin `documentos_compra`, la mitad de gastos no opina: una sola observación); el anticipo de oct-2025 `'recibido'` dispara la regla 5; el asiento de la factura a2 (clampeado al 1-ene-2026, doc de nov-2025) dispara la regla 6; y 2025 reabierto con saldos de resultado dispara la regla 7. Los asserts filtran cada observación por `regla` (y la 3 fija además los `enlace_id`), así que ninguna observación pisa a otra, y el semáforo es `critica` de todos modos.

**Files:**
- Create: `supabase/tests/database/estados_financieros.test.sql`

**Interfaces:**
- Consumes (contratos del spec §2-§3, creados por la migración 0024):
  - `public.cerrar_ejercicio(p_empresa uuid, p_anio integer) returns uuid` — roles dueño/admin/contador; noop (null) sin movimientos de resultado; asiento `origen 'cierre'`, `fecha = make_date(p_anio,12,31)`, glosa `'Cierre del ejercicio <año>'`; fila en `cierres_ejercicio`. Errores byte-exactos: `'Tu rol no permite cerrar el ejercicio'`, `'Solo se puede cerrar un ejercicio terminado'`, `'El ejercicio % ya está cerrado'`, `'Cierra primero el ejercicio %'`.
  - `public.reabrir_ejercicio(p_empresa uuid, p_anio integer) returns uuid` — reversa `origen 'reversa'` con `reversa_de = asiento_cierre_id` y fecha 31-dic; fila a `reabierto`. Errores: `'Tu rol no permite reabrir el ejercicio'`, `'El ejercicio % no está cerrado'`, `'Reabre primero el ejercicio %'`.
  - `public.revision_periodo(p_empresa uuid, p_anio integer, p_mes integer) returns jsonb` — `{periodo, estado, observaciones: [{regla, severidad, titulo, detalle, enlace_tipo, enlace_id}]}`, severidad en `('critica','media','ok')`. Errores: `'Tu rol no permite ver la revisión'`, `'Período no válido'`.
  - `app._fecha_contable(p_empresa uuid, p_fecha date) returns date` — clamp al 1-ene del ejercicio abierto (sin grants: se llama como superuser).
  - Candado en `app._insertar_asiento`: `'El ejercicio % está cerrado'` (año interpolado; aquí `'El ejercicio 2025 está cerrado'`).
  - Candado de cierre en `revertir_asiento` (re-create 0024): `'El cierre solo se deshace reabriendo el ejercicio'`.
  - Tabla `cierres_ejercicio` (RLS select dueño/admin/contador) y ancla `clave_sistema = 'utilidad_ejercicio'`.
  - Ya existentes (0022): `activar_contabilidad`, `crear_asiento`, `contabilizar_documento`, `revertir_asiento`, tablas `asientos`/`asientos_lineas`/`cuentas_contables`. Para los goldens de las reglas 3/4/5: `saldos_documentos` (0010), `correos_enviados` (0020), `anticipos` (0018), `libro_ventas` (0011) — detalles verificados en el Contexto de arriba.
- Produces: archivo 18 de la suite pgTAP con `plan(36)`. Suite total: **363 asserts en 18 archivos**.

- [ ] **Step 1: Transcribir el archivo de test completo**

  Crear `supabase/tests/database/estados_financieros.test.sql` con este contenido EXACTO (sin BOM, UTF-8 — los mensajes llevan tildes byte-exactas):

  ```sql
  begin;
  create extension if not exists pgtap with schema extensions;
  select plan(36);

  -- ===== Fixtures (superuser: salta grants/RLS, patrón contabilidad) =====
  -- Ana dueña, Ces CONTADOR y Vero VENDEDORA de la empresa A.
  insert into auth.users (instance_id, id, aud, role, email)
  values
    ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'ana@cierre.cl'),
    ('00000000-0000-0000-0000-000000000000', '55555555-5555-5555-5555-555555555555', 'authenticated', 'authenticated', 'ces@cierre.cl'),
    ('00000000-0000-0000-0000-000000000000', '77777777-7777-7777-7777-777777777777', 'authenticated', 'authenticated', 'vero@cierre.cl');

  -- RUT nuevos, únicos GLOBALES (módulo 11, cálculo en el plan): 769710019 y
  -- 769710027 no aparecen en ningún test, el seed ni los E2E (grep = 0).
  insert into public.organizaciones (id, rut, razon_social)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '769710019', 'Org Cierre');

  insert into public.empresas (id, organizacion_id, rut, razon_social)
  values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '769710019', 'Cierre A');

  insert into public.miembros (usuario_id, organizacion_id, rol)
  values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'dueno'),
         ('55555555-5555-5555-5555-555555555555', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'contador'),
         ('77777777-7777-7777-7777-777777777777', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'vendedor');

  insert into public.clientes (id, empresa_id, rut, razon_social)
  values ('cccccccc-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '769710027', 'Cliente Cierre');

  -- Documentos por insert DIRECTO (respetan el CHECK total = neto+exento+iva):
  -- a1: factura ene-2026 que NUNCA se contabiliza (reglas 1 y 2 de revisión);
  -- a2: factura nov-2025 que se contabiliza DESPUÉS de cerrar 2025 (clamp + regla 6);
  --     además es la vencida-sin-recordatorio de la regla 3 (vence al emitirse:
  --     condicion_pago_dias default 0) y el 1er mes del promedio de la regla 4;
  -- a3: factura dic-2025 que NUNCA se contabiliza: 2° mes del promedio de la
  --     regla 4 (nov+dic promedian 59500; enero 119000 rompe la banda 140%).
  insert into public.documentos_venta (id, empresa_id, tipo, cliente_id, folio, estado, neto, exento, iva, total, emitido_en)
  values
    ('dddddddd-0000-0000-0000-0000000000a1', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'factura', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 2001, 'emitido', 100000, 0, 19000, 119000, timestamptz '2026-01-20 12:00:00+00'),
    ('dddddddd-0000-0000-0000-0000000000a2', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'factura', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 2002, 'emitido', 50000, 0, 9500, 59500, timestamptz '2025-11-15 12:00:00+00'),
    ('dddddddd-0000-0000-0000-0000000000a3', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'factura', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 2003, 'emitido', 50000, 0, 9500, 59500, timestamptz '2025-12-10 12:00:00+00');

  -- Regla 3 dirigida: recordatorio RECIENTE (creado_en default now(), siempre
  -- dentro de la ventana de 30 días) para a1 y a3 → quedan suprimidas; a2 queda
  -- SIN recordatorio y es la única que debe disparar la regla.
  insert into public.correos_enviados (empresa_id, tipo, referencia_id, para, asunto, proveedor_id)
  values
    ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'recordatorio', 'dddddddd-0000-0000-0000-0000000000a1', 'cobranza@cierre.cl', 'Recordatorio factura 2001', 'mock-rec-a1'),
    ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'recordatorio', 'dddddddd-0000-0000-0000-0000000000a3', 'cobranza@cierre.cl', 'Recordatorio factura 2003', 'mock-rec-a3');

  -- Regla 5 dirigida: anticipo 'recibido' (default) hace más de 60 días.
  -- mp_payment_id NULL a propósito: así NO entra a la regla 1 ni a pendientes.
  insert into public.anticipos (id, empresa_id, cliente_id, origen_tipo, origen_id, monto, recibido_en)
  values ('ffffffff-0000-0000-0000-0000000000a5', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 'cotizacion', gen_random_uuid(), 80000, timestamptz '2025-10-01 12:00:00+00');

  -- ===== Activación (Ana, dueña) =====
  set local role authenticated;
  set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
  select activar_contabilidad('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa');

  -- 1) La 0024 extendió el catálogo: 11 claves y utilidad_ejercicio es hoja de patrimonio.
  select is(
    (select count(*) from cuentas_contables
     where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema is not null)::text
    || '/' ||
    (select tipo || ':' || acepta_movimientos from cuentas_contables
     where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema = 'utilidad_ejercicio'),
    '11/patrimonio:true',
    'activar siembra 11 claves de sistema; utilidad_ejercicio es hoja de patrimonio'
  );

  -- ===== Fixtures de movimientos (Ces, contador): 2024 y 2025 =====
  -- SETUP (felices sin assert, patrón contabilidad: si fallaran, el archivo aborta).
  set local request.jwt.claims to '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated"}';
  -- 2024: una venta de 40000 (utilidad 2024 = 40000; da movimientos al orden de cierre).
  select crear_asiento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', date '2024-06-15', 'Venta 2024', jsonb_build_array(
    jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema = 'banco'), 'debe', 40000, 'haber', 0),
    jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema = 'ventas'), 'debe', 0, 'haber', 40000)));
  -- 2025: ingreso 100000 y gasto 30000 (utilidad 2025 = 70000).
  select crear_asiento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', date '2025-03-10', 'Venta 2025', jsonb_build_array(
    jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema = 'banco'), 'debe', 100000, 'haber', 0),
    jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema = 'ventas'), 'debe', 0, 'haber', 100000)));
  select crear_asiento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', date '2025-04-20', 'Gasto 2025', jsonb_build_array(
    jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema = 'compras_gastos'), 'debe', 30000, 'haber', 0),
    jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema = 'banco'), 'debe', 0, 'haber', 30000)));

  -- ===== cerrar_ejercicio: negativos =====

  -- 2) Vendedor (Vero): el rol se chequea PRIMERO.
  set local request.jwt.claims to '{"sub": "77777777-7777-7777-7777-777777777777", "role": "authenticated"}';
  select throws_ok(
    $$select cerrar_ejercicio('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 2024)$$,
    'P0001', 'Tu rol no permite cerrar el ejercicio',
    'el vendedor no puede cerrar el ejercicio'
  );

  -- 3) El año en curso no es un ejercicio terminado (dinámico: válido en cualquier año).
  set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
  select throws_ok(
    $$select cerrar_ejercicio('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', extract(year from current_date)::integer)$$,
    'P0001', 'Solo se puede cerrar un ejercicio terminado',
    'el año en curso no se puede cerrar'
  );

  -- 4) Cierre en orden: 2024 tiene movimientos y sigue abierto.
  select throws_ok(
    $$select cerrar_ejercicio('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 2025)$$,
    'P0001', 'Cierra primero el ejercicio 2024',
    'no se cierra 2025 con 2024 abierto y con movimientos'
  );

  -- 5) Año sin movimientos de resultado (2023): noop → null.
  select ok(
    (select cerrar_ejercicio('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 2023)) is null,
    'cerrar un año sin movimientos de resultado es noop: retorna null'
  );

  -- 6) El noop no deja rastro: ni fila de cierre ni asiento.
  select is(
    (select count(*) from cierres_ejercicio where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and anio = 2023)
    + (select count(*) from asientos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and origen = 'cierre' and extract(year from fecha) = 2023),
    0::bigint,
    'el noop no crea fila en cierres_ejercicio ni asiento de cierre'
  );

  -- ===== cerrar_ejercicio: felices =====

  -- 7) El CONTADOR (Ces) SÍ puede cerrar: cierra 2024.
  set local request.jwt.claims to '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated"}';
  select ok(
    (select cerrar_ejercicio('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 2024)) is not null,
    'el contador puede cerrar el ejercicio (retorna el asiento de cierre)'
  );

  -- SETUP (feliz sin assert): Ana cierra 2025. Los goldens 8-11 son el assert real.
  set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
  select cerrar_ejercicio('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 2025);

  -- 8) GOLDEN líneas del cierre 2025: ventas al debe (100000), compras_gastos al haber
  --    (30000) y la contrapartida única a utilidad_ejercicio al haber (70000). Cuadrado.
  select is(
    (select string_agg(c.clave_sistema || ':' || l.debe || ':' || l.haber, '|' order by c.clave_sistema)
     from asientos_lineas l
     join cuentas_contables c on c.empresa_id = l.empresa_id and c.id = l.cuenta_id
     where l.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
       and l.asiento_id = (select id from asientos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and origen = 'cierre' and fecha = date '2025-12-31')),
    'compras_gastos:0:30000|utilidad_ejercicio:0:70000|ventas:100000:0',
    'el cierre deja cada cuenta de resultado en 0 contra utilidad_ejercicio (utilidad 70000 al haber)'
  );

  -- 9) El asiento de cierre va al 31-dic con origen y glosa contractuales.
  select is(
    (select a.fecha::text || '/' || a.origen || '/' || a.glosa
     from asientos a
     where a.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and a.origen = 'cierre' and a.fecha = date '2025-12-31'),
    '2025-12-31/cierre/Cierre del ejercicio 2025',
    'el asiento de cierre lleva fecha 31-dic, origen cierre y la glosa del spec'
  );

  -- 10) Las cuentas de resultado quedan con saldo 0 en el año cerrado.
  select is(
    (select coalesce(sum(l.haber - l.debe), 0)
     from asientos_lineas l
     join asientos a on a.empresa_id = l.empresa_id and a.id = l.asiento_id
     join cuentas_contables c on c.empresa_id = l.empresa_id and c.id = l.cuenta_id
     where l.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
       and c.tipo in ('ingreso', 'gasto')
       and a.fecha between date '2025-01-01' and date '2025-12-31'),
    0::bigint,
    'tras el cierre, ingresos y gastos suman saldo 0 en 2025'
  );

  -- 11) La fila del cierre queda cerrada con el resultado correcto.
  select is(
    (select estado || '/' || resultado from cierres_ejercicio
     where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and anio = 2025),
    'cerrado/70000',
    'cierres_ejercicio registra 2025 cerrado con utilidad 70000'
  );

  -- 12) Doble cierre: 2025 ya está cerrado.
  select throws_ok(
    $$select cerrar_ejercicio('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 2025)$$,
    'P0001', 'El ejercicio 2025 ya está cerrado',
    'un ejercicio cerrado no se cierra dos veces'
  );

  -- 13) Candado del helper: un asiento manual con fecha en el año cerrado no entra
  --     (mensaje del spec §2.4 con el año interpolado).
  select throws_ok(
    $$select crear_asiento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', date '2025-08-01', 'Tardío manual', jsonb_build_array(
      jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema = 'banco'), 'debe', 1000, 'haber', 0),
      jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema = 'ventas'), 'debe', 0, 'haber', 1000)))$$,
    'P0001', 'El ejercicio 2025 está cerrado',
    'el candado rechaza asientos manuales con fecha en un año cerrado'
  );

  -- 14) El asiento de CIERRE no se revierte por revertir_asiento (una reversa
  --     directa consumiría la única reversa permitida y reabrir_ejercicio
  --     quedaría roto para siempre): la única vía es reabrir_ejercicio. En este
  --     punto hay un solo cierre al 31-dic-2025 (el de 2024 vive en su 31-dic).
  select throws_ok(
    $$select revertir_asiento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
      (select id from asientos
       where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
         and origen = 'cierre' and fecha = date '2025-12-31'),
      'Intento de reversa directa del cierre')$$,
    'P0001', 'El cierre solo se deshace reabriendo el ejercicio',
    'el asiento de cierre solo se deshace con reabrir_ejercicio'
  );

  -- ===== Documento tardío (service_role, el hook) =====
  set local role service_role;

  -- SETUP (sin assert): contabilizar la factura nov-2025 con 2025 ya cerrado.
  select contabilizar_documento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'venta', 'dddddddd-0000-0000-0000-0000000000a2');

  -- 15) El asiento no cae en el año cerrado: fecha = 1-ene del ejercicio abierto.
  select is(
    (select fecha from asientos
     where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and origen = 'venta'
       and referencia_id = 'dddddddd-0000-0000-0000-0000000000a2'),
    date '2026-01-01',
    'un documento de un año cerrado se contabiliza al 1-ene del ejercicio abierto'
  );

  -- ===== app._fecha_contable directo (superuser: el helper no tiene grants) =====
  reset role;

  -- 16) Clamp simple: 2025 cerrado → 1-ene-2026.
  select is(
    app._fecha_contable('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', date '2025-06-10'),
    date '2026-01-01',
    'una fecha en el año cerrado se clampea al 1-ene del ejercicio abierto'
  );

  -- 17) Clamp consecutivo: 2024 y 2025 cerrados → una fecha 2024 salta ambos.
  select is(
    app._fecha_contable('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', date '2024-03-01'),
    date '2026-01-01',
    'con dos años cerrados consecutivos, la fecha salta al primer ejercicio abierto'
  );

  -- 18) Sin cierre: la fecha queda intacta.
  select is(
    app._fecha_contable('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', date '2026-03-05'),
    date '2026-03-05',
    'una fecha en un año abierto queda intacta'
  );

  -- ===== reabrir_ejercicio =====

  -- 19) Vendedor (Vero): el rol se chequea PRIMERO.
  set local role authenticated;
  set local request.jwt.claims to '{"sub": "77777777-7777-7777-7777-777777777777", "role": "authenticated"}';
  select throws_ok(
    $$select reabrir_ejercicio('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 2025)$$,
    'P0001', 'Tu rol no permite reabrir el ejercicio',
    'el vendedor no puede reabrir el ejercicio'
  );

  set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

  -- 20) Reabrir un año que no está cerrado (2026 nunca se cerró).
  select throws_ok(
    $$select reabrir_ejercicio('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 2026)$$,
    'P0001', 'El ejercicio 2026 no está cerrado',
    'no se reabre un ejercicio que no está cerrado'
  );

  -- 21) Reapertura en orden inverso: 2025 (posterior) sigue cerrado.
  select throws_ok(
    $$select reabrir_ejercicio('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 2024)$$,
    'P0001', 'Reabre primero el ejercicio 2025',
    'no se reabre 2024 mientras 2025 siga cerrado'
  );

  -- SETUP (feliz sin assert): Ana reabre 2025. Los asserts 22-24 verifican el efecto.
  select reabrir_ejercicio('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 2025);

  -- 22) La reversa queda ligada por reversa_de al asiento de cierre vigente,
  --     con fecha 31-dic (no contamina el ejercicio siguiente) y glosa del spec.
  select is(
    (select r.fecha::text || '/' || r.glosa
     from asientos r
     where r.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and r.origen = 'reversa'
       and r.reversa_de = (select asiento_cierre_id from cierres_ejercicio
                           where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and anio = 2025)),
    '2025-12-31/Reapertura del ejercicio 2025',
    'la reapertura crea la reversa ligada al cierre, con fecha 31-dic'
  );

  -- 23) La fila queda reabierta con auditoría de quién y cuándo.
  select is(
    (select estado || '/' || (reabierto_por is not null)::text || '/' || (reabierto_en is not null)::text
     from cierres_ejercicio
     where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and anio = 2025),
    'reabierto/true/true',
    'la fila pasa a reabierto y registra reabierto_por y reabierto_en'
  );

  -- 24) El año reabierto vuelve a aceptar asientos (Ces, contador): la venta
  --     olvidada de 10000 sube la utilidad del re-cierre a 80000.
  set local request.jwt.claims to '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated"}';
  select ok(
    (select crear_asiento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', date '2025-05-05', 'Venta olvidada', jsonb_build_array(
      jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema = 'banco'), 'debe', 10000, 'haber', 0),
      jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema = 'ventas'), 'debe', 0, 'haber', 10000)))) is not null,
    'tras reabrir, 2025 vuelve a aceptar asientos'
  );

  -- ===== revision_periodo (foto de enero-2026 con 2025 reabierto): 7 goldens + semáforo =====

  -- 25) Vendedor (Vero): rol denegado.
  set local request.jwt.claims to '{"sub": "77777777-7777-7777-7777-777777777777", "role": "authenticated"}';
  select throws_ok(
    $$select revision_periodo('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 2026, 1)$$,
    'P0001', 'Tu rol no permite ver la revisión',
    'el vendedor no ve la revisión del período'
  );

  set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

  -- 26) Período inválido: p_mes 13 no es un mes (validado tras el rol).
  select throws_ok(
    $$select revision_periodo('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 2026, 13)$$,
    'P0001', 'Período no válido',
    'revision_periodo rechaza un mes fuera de 1-12'
  );

  -- 27) GOLDEN regla 1: la factura a1 (ene-2026) sigue sin asiento.
  select is(
    (select o->>'severidad'
     from jsonb_array_elements(revision_periodo('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 2026, 1)->'observaciones') as o
     where o->>'regla' = 'documentos_sin_contabilizar'),
    'critica',
    'la factura de enero sin contabilizar dispara documentos_sin_contabilizar (crítica)'
  );

  -- 28) GOLDEN regla 2: IVA del libro de ventas de enero (19000, factura a1) ≠
  --     movimientos de iva_debito en enero (9500, asiento clampeado de a2).
  select is(
    (select o->>'severidad'
     from jsonb_array_elements(revision_periodo('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 2026, 1)->'observaciones') as o
     where o->>'regla' = 'iva_descuadrado'),
    'critica',
    'el IVA del libro difiere de la cuenta iva_debito: iva_descuadrado (crítica)'
  );

  -- 29) GOLDEN regla 7: 2025 tiene saldos de resultado y está reabierto (no cerrado).
  select is(
    (select o->>'severidad'
     from jsonb_array_elements(revision_periodo('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 2026, 1)->'observaciones') as o
     where o->>'regla' = 'ejercicio_anterior_abierto'),
    'media',
    'el año anterior con movimientos y sin cerrar dispara ejercicio_anterior_abierto (media)'
  );

  -- 30) GOLDEN regla 6: el asiento de a2 (fecha 1-ene-2026) difiere de la fecha
  --     del documento origen (nov-2025): el clamping quedó como observación.
  select is(
    (select o->>'severidad'
     from jsonb_array_elements(revision_periodo('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 2026, 1)->'observaciones') as o
     where o->>'regla' = 'asientos_tardios'),
    'media',
    'el asiento clampeado difiere de la fecha del documento: asientos_tardios (media)'
  );

  -- 31) GOLDEN regla 3: SOLO a2 (vencida, con saldo, sin recordatorio) dispara;
  --     a1 y a3 también están vencidas pero su recordatorio del fixture
  --     (creado_en now(), siempre < 30 días) las suprime.
  select is(
    (select string_agg(o->>'enlace_id', ',')
     from jsonb_array_elements(revision_periodo('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 2026, 1)->'observaciones') as o
     where o->>'regla' = 'facturas_vencidas_sin_gestion'),
    'dddddddd-0000-0000-0000-0000000000a2',
    'solo la factura vencida sin recordatorio reciente dispara facturas_vencidas_sin_gestion'
  );

  -- 32) GOLDEN regla 5: el anticipo de oct-2025 sigue 'recibido' hace más de 60 días.
  select is(
    (select o->>'severidad' || '/' || (o->>'enlace_tipo')
     from jsonb_array_elements(revision_periodo('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 2026, 1)->'observaciones') as o
     where o->>'regla' = 'anticipos_sin_aplicar'),
    'media/anticipo',
    'el anticipo recibido hace más de 60 días dispara anticipos_sin_aplicar (media)'
  );

  -- 33) GOLDEN regla 4: ventas de enero (119000, a1) contra el promedio de
  --     nov-dic 2025 (59500 = a2/a3): 119000 > 140% de 59500 → fuera de banda.
  --     Sin documentos_compra, la mitad de gastos no opina: una sola observación.
  select is(
    (select o->>'severidad'
     from jsonb_array_elements(revision_periodo('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 2026, 1)->'observaciones') as o
     where o->>'regla' = 'anomalia_vs_promedio'),
    'media',
    'ventas de enero fuera de la banda 60-140% del promedio dispara anomalia_vs_promedio (media)'
  );

  -- 34) Semáforo agregado: la peor severidad presente es crítica.
  select is(
    revision_periodo('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 2026, 1)->>'estado',
    'critica',
    'el semáforo del período agrega la peor severidad presente'
  );

  -- ===== Re-cierre tras reapertura =====

  -- SETUP (feliz sin assert): Ana re-cierra 2025 (ahora con la venta olvidada).
  set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
  select cerrar_ejercicio('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 2025);

  -- 35) La fila vuelve a cerrado con el resultado recalculado (70000 + 10000).
  select is(
    (select estado || '/' || resultado from cierres_ejercicio
     where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and anio = 2025),
    'cerrado/80000',
    're-cerrar deja la fila cerrada con la utilidad recalculada (80000)'
  );

  -- 36) El re-cierre es un asiento NUEVO: el vigente no es el revertido y hay
  --     dos asientos de cierre al 31-dic-2025 (el histórico y el nuevo).
  select ok(
    (select asiento_cierre_id from cierres_ejercicio
     where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and anio = 2025)
    <> (select reversa_de from asientos
        where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and origen = 'reversa' and reversa_de is not null)
    and (select count(*) from asientos
         where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and origen = 'cierre' and fecha = date '2025-12-31') = 2,
    're-cerrar crea un asiento de cierre nuevo: el vigente no es el revertido'
  );

  select * from finish();
  rollback;
  ```

  Notas de diseño del archivo (no van en el SQL):
  - El orden es un timeline: negativos de cierre → cierre 2024 y 2025 → candados (período + revertir-cierre) → clamp → reapertura → revisión (con 2025 reabierto: única foto donde las 7 reglas dirigidas conviven) → re-cierre. Mover bloques de lugar rompe los estados que cada assert asume.
  - Los goldens 27-33 filtran por `regla` sobre el array `observaciones` (y el 31 fija además los `enlace_id`): cada regla dispara exactamente una observación con este fixture, ninguna pisa a otra, y el semáforo (34) es `critica` de todos modos por las reglas 1 y 2.
  - El assert 3 depende del orden de validaciones del spec §3.1 (terminado → ya cerrado → orden): con el año en curso, gana `'Solo se puede cerrar un ejercicio terminado'` aunque 2024/2025 estén abiertos en ese momento.
  - El assert 14 corre ANTES de la reapertura: en ese instante hay un solo asiento `origen 'cierre'` al 31-dic-2025 (tras el re-cierre habría dos y el subselect dejaría de ser escalar).
  - Los asserts 16-18 corren como superuser (`reset role`) porque `app._fecha_contable` no tiene grants (patrón `app._insertar_asiento` 0022).

- [ ] **Step 2: Correr la suite completa**

  ```bash
  npx supabase test db
  ```

  (timeout 600000; requiere el stack local levantado y la migración 0024 aplicada — `npx supabase db reset` antes si hay dudas del estado local.)

  Salida esperada (el orden/alineado exacto del listado lo decide pg_prove; lo que DEBE cumplirse es la última línea):

  ```
  ./supabase/tests/database/aislamiento.test.sql ........... ok
  ./supabase/tests/database/cobranza.test.sql .............. ok
  ./supabase/tests/database/combustible.test.sql ........... ok
  ./supabase/tests/database/compras.test.sql ............... ok
  ./supabase/tests/database/contabilidad.test.sql .......... ok
  ./supabase/tests/database/correos_enviados.test.sql ...... ok
  ./supabase/tests/database/cotizaciones.test.sql .......... ok
  ./supabase/tests/database/estados_financieros.test.sql ... ok
  ./supabase/tests/database/inventario.test.sql ............ ok
  ./supabase/tests/database/maestros.test.sql .............. ok
  ./supabase/tests/database/mercadopago.test.sql ........... ok
  ./supabase/tests/database/por_pagar.test.sql ............. ok
  ./supabase/tests/database/registro.test.sql .............. ok
  ./supabase/tests/database/reportes.test.sql .............. ok
  ./supabase/tests/database/rubros.test.sql ................ ok
  ./supabase/tests/database/suscripciones_pago.test.sql .... ok
  ./supabase/tests/database/transporte.test.sql ............ ok
  ./supabase/tests/database/ventas.test.sql ................ ok
  All tests successful.
  Files=18, Tests=363,  ...
  Result: PASS
  ```

  Si `estados_financieros.test.sql` falla: NO parchear el test para que pase — los mensajes y contratos son los del spec §2-§3; el bug está en la migración 0024 (volver a esa task con el assert exacto que falló).

- [ ] **Step 3: Commit**

  ```bash
  git add supabase/tests/database/estados_financieros.test.sql
  git commit -m "test(db): pgTAP de estados financieros — cierre y reapertura de ejercicio, fecha contable y revisión del período"
  ```

---

### Task 4: Tipos `@suite/db` del cierre de ejercicio + etiquetas del Contador Auditor

**Files:**
- Modify: `packages/db/src/types.ts` (a mano, emulando byte a byte la salida del generador: 1 tabla + 3 Functions)
- Create: `apps/erp/app/contabilidad/revision/reglas.ts`

**Interfaces:**
- Consumes: DDL de `cierres_ejercicio` (spec §2.1) y firmas de las 3 RPCs (spec §3.1-3.3) — ya aplicadas en la 0024 por las tasks anteriores; patrón de etiquetas `apps/erp/app/contabilidad/origenes.ts` (P16 T6).
- Produces: símbolos `cierres_ejercicio` / `cerrar_ejercicio` / `reabrir_ejercicio` / `revision_periodo` en `Database` + `ETIQUETA_REGLA` / `SeveridadRevision` / `ETIQUETA_SEVERIDAD` / `ObservacionRevision` / `RevisionPeriodo` / `rutaEnlace` — los consumen las páginas y actions de Revisión, cierre asistido, Balance y EERR (tasks siguientes). **BLOCKED** de esas tasks si falta algún símbolo (un tipo incompleto ocultaría un error de compilación hasta runtime). **`reglas.ts` es la fuente ÚNICA de tipos/etiquetas/`rutaEnlace` del payload de `revision_periodo` (ver Global Constraints): la Task 7 los importa desde aquí y su `semaforo.ts` solo agrega mapas de presentación que no existen acá.**
- Decisión — **edición manual espejo del generador** (no `pnpm --filter @suite/db gen` aquí): los bloques de abajo reproducen EXACTAMENTE lo que `supabase gen types typescript --local` emitiría con la 0024 aplicada (columnas en orden alfabético, Relationships ordenadas por `foreignKeyName`, indentación de 6 espacios para claves de tabla/función, prettier multilínea cuando la firma supera 80 columnas). La task de pipeline regenera al final y el diff contra estos bloques debe ser CERO; si hubiera diff, gana el generador y se commitea su salida.
- Cómo quedó tipado cada retorno (espejo de 0022 en `types.ts` actual): uuid → `Returns: string` **sin** `| null` (así quedó `crear_asiento`, aunque `cerrar_ejercicio` pueda retornar null en el noop — el generador no modela nulabilidad de retornos); jsonb → `Returns: Json` (así quedó `contabilizar_pendientes`). `app._fecha_contable` y el helper `app._insertar_asiento` viven en el schema `app` sin grants → NO aparecen en tipos. Los re-creates de `activar_contabilidad` / `contabilizar_documento` / `contabilizar_pendientes` no cambian firma → cero diff por ellos.
- Sin símbolo nuevo por CHECKs/unique/RLS de `cierres_ejercicio` ni por el CHECK re-emitido de `asientos.origen` (+`'cierre'`): son restricciones, no tipos. `asientos` NO cambia de forma.
- **Unit tests: NINGUNO nuevo** — `reglas.ts` es data estática + un helper de mapeo sin lógica de negocio (mismo criterio que `origenes.ts`, que tampoco tiene test). En esta task la suite unit sigue en 176; el total contractual del plan es **192** (los 16 de `periodo.test.ts` los agrega la Task 6).

- [ ] **Step 1: `types.ts` — tabla `cierres_ejercicio` (posición alfabética en `Tables`)**

Alfabéticamente va entre `categorias_producto` y `clientes`. En `packages/db/src/types.ts`, localizar este bloque ÚNICO (cierre de `categorias_producto` + apertura de `clientes`):

```ts
          {
            foreignKeyName: "categorias_producto_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      clientes: {
```

y reemplazarlo por (mismo bloque + la tabla nueva intercalada):

```ts
          {
            foreignKeyName: "categorias_producto_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      cierres_ejercicio: {
        Row: {
          anio: number
          asiento_cierre_id: string
          creado_en: string
          creado_por: string
          empresa_id: string
          estado: string
          id: string
          reabierto_en: string | null
          reabierto_por: string | null
          resultado: number
        }
        Insert: {
          anio: number
          asiento_cierre_id: string
          creado_en?: string
          creado_por: string
          empresa_id: string
          estado?: string
          id?: string
          reabierto_en?: string | null
          reabierto_por?: string | null
          resultado: number
        }
        Update: {
          anio?: number
          asiento_cierre_id?: string
          creado_en?: string
          creado_por?: string
          empresa_id?: string
          estado?: string
          id?: string
          reabierto_en?: string | null
          reabierto_por?: string | null
          resultado?: number
        }
        Relationships: [
          {
            foreignKeyName: "cierres_ejercicio_empresa_id_asiento_cierre_id_fkey"
            columns: ["empresa_id", "asiento_cierre_id"]
            isOneToOne: false
            referencedRelation: "asientos"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "cierres_ejercicio_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      clientes: {
```

Notas de fidelidad al generador: columnas en orden alfabético (`anio` … `resultado`); `Insert` marca opcionales SOLO las columnas con default (`creado_en`, `estado`, `id`) y las nullables (`reabierto_en`, `reabierto_por`); el CHECK de `estado` NO produce union (queda `string`, igual que `asientos.origen`); `creado_por`/`reabierto_por` son uuid sueltos sin FK → sin entrada en `Relationships`; las 2 Relationships van ordenadas por `foreignKeyName` (`…asiento_cierre_id_fkey` antes que `…empresa_id_fkey`, mismo orden que en `asientos_lineas`).

- [ ] **Step 2: `types.ts` — las 3 Functions (posiciones alfabéticas en `Functions`)**

Tres inserciones, cada una con su ancla única. Las tres firmas superan 80 columnas en una línea → formato multilínea (mismo estilo que `cambiar_rubro`). Args en orden alfabético (así ordena el generador: ver `cambiar_estado_proforma`).

**2a. `cerrar_ejercicio`** — entre `cambiar_rubro` y `confirmar_pago_suscripcion`. Localizar:

```ts
      cambiar_rubro: {
        Args: { p_empresa: string; p_rubro: string }
        Returns: undefined
      }
      confirmar_pago_suscripcion: {
```

Reemplazar por:

```ts
      cambiar_rubro: {
        Args: { p_empresa: string; p_rubro: string }
        Returns: undefined
      }
      cerrar_ejercicio: {
        Args: { p_anio: number; p_empresa: string }
        Returns: string
      }
      confirmar_pago_suscripcion: {
```

**2b. `reabrir_ejercicio`** — entre `guardar_cuenta` y `registrar_ajuste`. Localizar:

```ts
          p_tipo: string
        }
        Returns: string
      }
      registrar_ajuste: {
```

Reemplazar por:

```ts
          p_tipo: string
        }
        Returns: string
      }
      reabrir_ejercicio: {
        Args: { p_anio: number; p_empresa: string }
        Returns: string
      }
      registrar_ajuste: {
```

**2c. `revision_periodo`** — entre `revertir_asiento` y `tomar_folio` (`revertir` < `revision` porque `e` < `i` en la 4ª letra). Localizar:

```ts
      revertir_asiento: {
        Args: { p_asiento: string; p_empresa: string; p_glosa: string }
        Returns: string
      }
      tomar_folio: {
```

Reemplazar por:

```ts
      revertir_asiento: {
        Args: { p_asiento: string; p_empresa: string; p_glosa: string }
        Returns: string
      }
      revision_periodo: {
        Args: { p_anio: number; p_empresa: string; p_mes: number }
        Returns: Json
      }
      tomar_folio: {
```

- [ ] **Step 3: `apps/erp/app/contabilidad/revision/reglas.ts` (nuevo)**

Carpeta nueva `revision/` SOLO con este archivo — sin `page.tsx` no emite ruta (la página de Revisión llega en su task). Contenido COMPLETO (estilo `origenes.ts`: sin punto y coma, comillas simples):

```ts
// Etiquetas legibles de las reglas del Contador Auditor y sus severidades
// (spec §3.3). Compartidas por la página de Revisión y la card de
// /contabilidad para no repetir el mapa. Patrón espejo de origenes.ts (P16).
// Consumo defensivo: ETIQUETA_REGLA[obs.regla] ?? obs.regla (si la RPC ganara
// una regla nueva antes que la UI, se muestra la clave cruda, no revienta).
export const ETIQUETA_REGLA: Record<string, string> = {
  documentos_sin_contabilizar: 'Documentos sin contabilizar',
  iva_descuadrado: 'IVA descuadrado',
  facturas_vencidas_sin_gestion: 'Facturas vencidas sin gestión',
  anomalia_vs_promedio: 'Anomalía frente al promedio',
  anticipos_sin_aplicar: 'Anticipos sin aplicar',
  asientos_tardios: 'Asientos tardíos',
  ejercicio_anterior_abierto: 'Ejercicio anterior abierto',
}

// Severidades cerradas de la RPC (CHECK lógico en revision_periodo): union
// exacta para que el semáforo agregado `estado` y cada observación tipen igual.
export type SeveridadRevision = 'critica' | 'media' | 'ok'

export const ETIQUETA_SEVERIDAD: Record<SeveridadRevision, string> = {
  critica: 'Crítica',
  media: 'Media',
  ok: 'OK',
}

// Payload jsonb de revision_periodo (spec §3.3) tipado del lado TS. `estado`
// es el semáforo agregado: la peor severidad presente; sin observaciones, 'ok'.
export type ObservacionRevision = {
  regla: string
  severidad: SeveridadRevision
  titulo: string
  detalle: string
  enlace_tipo: string | null
  enlace_id: string | null
}

export type RevisionPeriodo = {
  // La RPC arma periodo como jsonb_build_object('anio', p_anio, 'mes', p_mes).
  periodo: { anio: number; mes: number }
  estado: SeveridadRevision
  observaciones: ObservacionRevision[]
}

// Ruta del objeto enlazado por una observación. Mapea EXACTAMENTE los valores
// de enlace_tipo que emite revision_periodo (Task 2): 'documento_venta'
// (regla 3), 'anticipo' (regla 5), 'asiento' (regla 6); las reglas 1/2/4
// emiten null -> sin link, y 'cierre' (regla 7) TAMBIÉN mapea a null: el panel
// de cierre asistido vive en la misma página de Revisión donde se muestra la
// observación (un self-link sería ruido). Mismo criterio que rutaOrigen en
// origenes.ts. La usa la página de Revisión.
export function rutaEnlace(enlaceTipo: string | null, enlaceId: string | null): string | null {
  if (enlaceTipo === 'documento_venta' && enlaceId) return `/ventas/${enlaceId}`
  if (enlaceTipo === 'asiento' && enlaceId) return `/contabilidad/asientos/${enlaceId}`
  if (enlaceTipo === 'anticipo') return '/cobranza'
  return null
}
```

Las tres rutas destino existen hoy: `apps/erp/app/ventas/[id]/page.tsx`, `apps/erp/app/contabilidad/asientos/[id]/page.tsx`, `apps/erp/app/cobranza/page.tsx`. El `enlace_tipo 'cierre'` (regla 7) se mapea a null a propósito (ver Global Constraints): el panel de cierre asistido aparece más abajo en la MISMA página de Revisión (hasta la Task 7 nadie importa `rutaEnlace`, así que no hay consumidor intermedio).

- [ ] **Step 4: Verificación**

Refrescar el PATH en la shell nueva (Windows) antes de todo. `&&` NO encadena en PowerShell 5.1 → un comando por línea.

Presencia Y orden alfabético de los símbolos nuevos entre sus vecinos (PowerShell; `Select-String` lista en orden de aparición en el archivo):

```powershell
Select-String -Path packages/db/src/types.ts -Pattern '^\s+(categorias_producto|cierres_ejercicio|clientes):'
Select-String -Path packages/db/src/types.ts -Pattern '^\s+(cambiar_rubro|cerrar_ejercicio|confirmar_pago_suscripcion|guardar_cuenta|reabrir_ejercicio|registrar_ajuste|revertir_asiento|revision_periodo|tomar_folio):'
```

Expected: el primer comando imprime EXACTAMENTE 3 líneas en este orden — `categorias_producto:`, `cierres_ejercicio:`, `clientes:`. El segundo imprime EXACTAMENTE 9 líneas en este orden — `cambiar_rubro:`, `cerrar_ejercicio:`, `confirmar_pago_suscripcion:`, `guardar_cuenta:`, `reabrir_ejercicio:`, `registrar_ajuste:`, `revertir_asiento:`, `revision_periodo:`, `tomar_folio:`. Cualquier ausencia u orden distinto = la inserción quedó mal ubicada → corregir antes de seguir.

Retornos exactos de las 3 RPCs nuevas:

```powershell
Select-String -Path packages/db/src/types.ts -Pattern '^\s+(cerrar_ejercicio|reabrir_ejercicio|revision_periodo):' -Context 0,3
```

Expected: tres bloques; `cerrar_ejercicio` y `reabrir_ejercicio` con `Args: { p_anio: number; p_empresa: string }` y `Returns: string`; `revision_periodo` con `Args: { p_anio: number; p_empresa: string; p_mes: number }` y `Returns: Json`.

Typecheck y build:

```powershell
pnpm tsc --noEmit -p packages/db/tsconfig.json
pnpm --filter erp exec tsc --noEmit
pnpm --filter erp build
```

Expected: los tres con exit 0, sin errores (el build de Next compila `reglas.ts` aunque nadie lo importe aún — el typecheck del proyecto cubre todo `app/`). Recordar: `pnpm build` pisa `.next` de un dev server corriendo → reiniciarlo después si estaba levantado.

Byte-scan JAMÁS BOM U+FEFF (Git Bash; el archivo nuevo y el editado):

```bash
grep -c $'\xEF\xBB\xBF' packages/db/src/types.ts apps/erp/app/contabilidad/revision/reglas.ts
```

Expected:

```
packages/db/src/types.ts:0
apps/erp/app/contabilidad/revision/reglas.ts:0
```

y exit 1 (cero coincidencias = pass). Cualquier conteo distinto de 0 → reescribir ese archivo en UTF-8 sin BOM y repetir.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/types.ts apps/erp/app/contabilidad/revision/reglas.ts
git commit -m "feat(erp): tipos del cierre de ejercicio en @suite/db y etiquetas del Contador Auditor"
```

---

### Task 5: Balance de 8 columnas + export CSV

**Files:**
- Create: `apps/erp/app/contabilidad/balance/calculo.ts`
- Create: `apps/erp/app/contabilidad/balance/page.tsx`
- Create: `apps/erp/app/contabilidad/balance/export/route.ts`
- Edit: `apps/erp/app/contabilidad/page.tsx` (link "Balance" en el encabezado del resumen; el link "EERR" lo agrega la Task 6 — reparto declarado)

**Interfaces:**
- Consumes: `exigirContabilidad()` (`apps/erp/lib/contabilidad-acceso.ts` — guard de la página: módulo + rol dueno/admin/contador → `notFound()`); `obtenerEmpresaActiva()` / `EmpresaResumen.rol` (`apps/erp/lib/empresa-activa.ts` — guard del route en PARIDAD, lección P12: 401 sin sesión / 404 módulo apagado / 403 rol sin permiso, jamás un CSV vacío); `crearClienteServidor()` (`@suite/auth/server`); `formatearCLP` + `filasACsv` (`@suite/core`); tablas 0022: `asientos` (`fecha, origen, reversa_de` — el origen `'cierre'` lo agrega la 0024, P17 tasks de BD), `asientos_lineas` (`cuenta_id, debe, haber`), `cuentas_contables` (`id, codigo, nombre, tipo in (activo|pasivo|patrimonio|ingreso|gasto), acepta_movimientos`). RLS select por rol ya corta a vendedor/bodeguero.
- Produces: `/contabilidad/balance` + `/contabilidad/balance/export`; módulo compartido `balance/calculo.ts` con `aniosConAsientos()` (la **Task 6 lo reusa** para el selector de año del EERR), `obtenerBalance()` y `FilaBalance`. La query y la agregación viven UNA vez: página y export llaman la misma función (paridad de números garantizada; los guards sí van duplicados en cada archivo, patrón P16).
- Exclusión spec §4.1 EXACTA, **scoped al año seleccionado**: fuera los asientos `origen = 'cierre'` Y sus reversas ligadas (`reversa_de` → asiento de cierre) DEL AÑO que se muestra. La detección de la reversa se hace en TS con un `Set` de ids de asientos de cierre (query aparte, minúscula: a lo más un cierre vigente + re-cierres por año) — sin vistas nuevas, patrón diario/mayor P16 T8 (queries server-side + agregación en TS).
- **ARRASTRE de saldos iniciales (spec §2.2 — el balance es correcto desde el 2º ejercicio):** `obtenerBalance()` suma además, por cuenta, el saldo acumulado ANTERIOR al 1-ene del año (query `lt('fecha', ...)` con líneas embebidas — patrón exacto del saldo inicial del mayor, `apps/erp/app/contabilidad/mayor/page.tsx:51-63`). Los cierres y reversas de años ANTERIORES se INCLUYEN en el arrastre (son precisamente el arrastre: con el año previo cerrado, las cuentas de resultado parten en 0 y `utilidad_ejercicio` trae el resultado). El saldo inicial deudor entra a la columna Débitos y el acreedor a Créditos: como Σ de saldos iniciales = 0 (partida doble), los 4 pares siguen cuadrando.
- **Desviación declarada del literal §4.1 (selector simple):** `aniosConAsientos()` devuelve el rango completo `[primer año..último año]` con asientos — un año intermedio sin asientos aparece en el selector y muestra un balance con solo arrastre. 2 queries de 1 fila en vez de un distinct que PostgREST no agrega.
- ESPEJOS leídos antes de escribir: `apps/erp/app/contabilidad/mayor/page.tsx` (agregación TS sobre líneas embebidas, cuentas inactivas incluidas), `apps/erp/app/contabilidad/diario/export/route.ts` y `mayor/export/route.ts` (guards 401/404/403 + `filasACsv` + `Content-Disposition`), `apps/erp/app/contabilidad/asientos/page.tsx` (uso de `exigirContabilidad`).

- [ ] **Step 1: Módulo compartido de cálculo**

`apps/erp/app/contabilidad/balance/calculo.ts`:

```ts
import 'server-only'
import type { crearClienteServidor } from '@suite/auth/server'

type ClienteSupabase = Awaited<ReturnType<typeof crearClienteServidor>>

export interface FilaBalance {
  codigo: string
  nombre: string
  debitos: number
  creditos: number
  saldoDeudor: number
  saldoAcreedor: number
  activo: number
  pasivo: number
  perdida: number
  ganancia: number
}

export interface Balance {
  filas: FilaBalance[]
  // Utilidad (+) o pérdida (−) del ejercicio: Ganancia − Pérdida (= Activo − Pasivo).
  resultado: number
  // Fila "Utilidad (o Pérdida) del ejercicio" que cuadra Inventario y Resultados.
  // null cuando resultado = 0 (no se muestra fila vacía).
  filaResultado: FilaBalance | null
  // Totales por columna, CON la fila de resultado ya sumada.
  totales: FilaBalance
  // Los 4 pares cuadran (Sumas, Saldos, Inventario, Resultados). false → alerta roja.
  cuadra: boolean
}

interface AsientoAnio {
  origen: string
  reversa_de: string | null
  asientos_lineas: { cuenta_id: string; debe: number; haber: number }[]
}

// Años con asientos de la empresa, descendente (selector de ejercicio).
// ponytail: rango [primero..último] en 2 queries de 1 fila (PostgREST no agrega
// distinct); un año intermedio sin asientos aparece y muestra un balance vacío.
export async function aniosConAsientos(supabase: ClienteSupabase, empresaId: string): Promise<number[]> {
  const { data: primero } = await supabase
    .from('asientos')
    .select('fecha')
    .eq('empresa_id', empresaId)
    .order('fecha')
    .limit(1)
  const { data: ultimo } = await supabase
    .from('asientos')
    .select('fecha')
    .eq('empresa_id', empresaId)
    .order('fecha', { ascending: false })
    .limit(1)
  if (!primero?.length || !ultimo?.length) return []
  const desde = Number(primero[0].fecha.slice(0, 4))
  const hasta = Number(ultimo[0].fecha.slice(0, 4))
  const anios: number[] = []
  for (let a = hasta; a >= desde; a--) anios.push(a)
  return anios
}

function sumar(filas: FilaBalance[], nombre: string): FilaBalance {
  const t: FilaBalance = {
    codigo: '',
    nombre,
    debitos: 0,
    creditos: 0,
    saldoDeudor: 0,
    saldoAcreedor: 0,
    activo: 0,
    pasivo: 0,
    perdida: 0,
    ganancia: 0,
  }
  for (const f of filas) {
    t.debitos += f.debitos
    t.creditos += f.creditos
    t.saldoDeudor += f.saldoDeudor
    t.saldoAcreedor += f.saldoAcreedor
    t.activo += f.activo
    t.pasivo += f.pasivo
    t.perdida += f.perdida
    t.ganancia += f.ganancia
  }
  return t
}

// Balance de 8 columnas del ejercicio (spec §4.1): agregado por cuenta hoja con
// ARRASTRE (saldo acumulado anterior al 1-ene, spec §2.2) + movimientos del
// año, EXCLUYENDO los asientos origen 'cierre' y sus reversas ligadas
// (reversa_de → asiento de cierre) DEL AÑO seleccionado: el balance muestra el
// ejercicio ANTES de su cierre, esté cerrado, reabierto o abierto. Los cierres
// de años ANTERIORES sí entran al arrastre (son el arrastre: resultado en
// utilidad_ejercicio y cuentas de resultado en 0).
export async function obtenerBalance(supabase: ClienteSupabase, empresaId: string, anio: number): Promise<Balance> {
  // Ids de asientos de cierre (pocos: uno vigente + re-cierres por año cerrado).
  const { data: cierres } = await supabase
    .from('asientos')
    .select('id')
    .eq('empresa_id', empresaId)
    .eq('origen', 'cierre')
  const idsCierre = new Set((cierres ?? []).map((c) => c.id))

  // Cuentas hoja, inactivas incluidas: pueden tener movimientos históricos (patrón mayor).
  const { data: cuentas } = await supabase
    .from('cuentas_contables')
    .select('id, codigo, nombre, tipo')
    .eq('empresa_id', empresaId)
    .eq('acepta_movimientos', true)
    .order('codigo')

  // Arrastre: saldo acumulado por cuenta ANTES del ejercicio (patrón saldo
  // inicial del mayor). SIN excluir cierres/reversas de años anteriores.
  // ponytail: mismo techo PostgREST 1000 asientos que la query del año.
  const { data: previos } = await supabase
    .from('asientos')
    .select('asientos_lineas (cuenta_id, debe, haber)')
    .eq('empresa_id', empresaId)
    .lt('fecha', `${anio}-01-01`)
  const inicial = new Map<string, number>()
  for (const a of (previos ?? []) as { asientos_lineas: { cuenta_id: string; debe: number; haber: number }[] }[]) {
    for (const l of a.asientos_lineas) {
      inicial.set(l.cuenta_id, (inicial.get(l.cuenta_id) ?? 0) + l.debe - l.haber)
    }
  }

  // Movimientos del ejercicio. ponytail: sin paginación (cap PostgREST 1000
  // asientos, el mismo techo que ya acepta el diario); .range() si una empresa lo supera.
  const { data } = await supabase
    .from('asientos')
    .select('origen, reversa_de, asientos_lineas (cuenta_id, debe, haber)')
    .eq('empresa_id', empresaId)
    .gte('fecha', `${anio}-01-01`)
    .lte('fecha', `${anio}-12-31`)

  const porCuenta = new Map<string, { debe: number; haber: number }>()
  for (const a of (data ?? []) as AsientoAnio[]) {
    if (a.origen === 'cierre') continue
    if (a.reversa_de && idsCierre.has(a.reversa_de)) continue
    for (const l of a.asientos_lineas) {
      const acc = porCuenta.get(l.cuenta_id) ?? { debe: 0, haber: 0 }
      acc.debe += l.debe
      acc.haber += l.haber
      porCuenta.set(l.cuenta_id, acc)
    }
  }

  const filas: FilaBalance[] = []
  for (const c of cuentas ?? []) {
    const mov = porCuenta.get(c.id)
    const ini = inicial.get(c.id) ?? 0
    if (!mov && ini === 0) continue
    // Saldo inicial deudor a Débitos, acreedor a Créditos: Σ iniciales = 0
    // (partida doble), así los 4 pares siguen cuadrando con el arrastre adentro.
    const debitos = (mov?.debe ?? 0) + Math.max(ini, 0)
    const creditos = (mov?.haber ?? 0) + Math.max(-ini, 0)
    const saldo = debitos - creditos
    const saldoDeudor = Math.max(saldo, 0)
    const saldoAcreedor = Math.max(-saldo, 0)
    // Inventario: activo/pasivo/patrimonio según el lado del saldo.
    // Resultados: ingreso/gasto según el lado del saldo (spec §4.1).
    const esResultado = c.tipo === 'ingreso' || c.tipo === 'gasto'
    filas.push({
      codigo: c.codigo,
      nombre: c.nombre,
      debitos,
      creditos,
      saldoDeudor,
      saldoAcreedor,
      activo: esResultado ? 0 : saldoDeudor,
      pasivo: esResultado ? 0 : saldoAcreedor,
      perdida: esResultado ? saldoDeudor : 0,
      ganancia: esResultado ? saldoAcreedor : 0,
    })
  }

  const parciales = sumar(filas, '')
  const resultado = parciales.ganancia - parciales.perdida
  let filaResultado: FilaBalance | null = null
  if (resultado > 0) {
    filaResultado = {
      codigo: '',
      nombre: 'Utilidad del ejercicio',
      debitos: 0,
      creditos: 0,
      saldoDeudor: 0,
      saldoAcreedor: 0,
      activo: 0,
      pasivo: resultado,
      perdida: resultado,
      ganancia: 0,
    }
  } else if (resultado < 0) {
    filaResultado = {
      codigo: '',
      nombre: 'Pérdida del ejercicio',
      debitos: 0,
      creditos: 0,
      saldoDeudor: 0,
      saldoAcreedor: 0,
      activo: -resultado,
      pasivo: 0,
      perdida: 0,
      ganancia: -resultado,
    }
  }
  const totales = sumar(filaResultado ? [...filas, filaResultado] : filas, 'Totales')
  const cuadra =
    totales.debitos === totales.creditos &&
    totales.saldoDeudor === totales.saldoAcreedor &&
    totales.activo === totales.pasivo &&
    totales.perdida === totales.ganancia

  return { filas, resultado, filaResultado, totales, cuadra }
}
```

- [ ] **Step 2: Página del balance**

`apps/erp/app/contabilidad/balance/page.tsx`:

```tsx
import Link from 'next/link'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP } from '@suite/core'
import { Boton, Encabezado, Selector, Tabla, Td, Th, Tr } from '@suite/ui'
import { exigirContabilidad } from '../../../lib/contabilidad-acceso'
import { aniosConAsientos, obtenerBalance, type FilaBalance } from './calculo'

// Celda numérica vacía cuando es 0 (lectura de libro contable, patrón diario/mayor).
const celda = (n: number) => (n ? formatearCLP(n) : '')

export default async function PaginaBalance({
  searchParams,
}: {
  searchParams: Promise<{ anio?: string }>
}) {
  const { anio: qAnio } = await searchParams
  const activa = await exigirContabilidad()
  const supabase = await crearClienteServidor()

  const anios = await aniosConAsientos(supabase, activa.id)
  if (anios.length === 0) {
    return (
      <div>
        <Encabezado titulo="Balance de 8 columnas" />
        <p className="text-slate-500">Aún no hay asientos. Emite un documento o usa Contabilizar pendientes.</p>
      </div>
    )
  }
  const anioActual = new Date().getFullYear()
  const porDefecto = anios.includes(anioActual) ? anioActual : anios[0]
  const anio = qAnio && /^\d{4}$/.test(qAnio) && anios.includes(Number(qAnio)) ? Number(qAnio) : porDefecto

  const { filas, resultado, filaResultado, totales, cuadra } = await obtenerBalance(supabase, activa.id, anio)

  const celdas = (f: FilaBalance) => (
    <>
      <Td className="text-right font-mono">{celda(f.debitos)}</Td>
      <Td className="text-right font-mono">{celda(f.creditos)}</Td>
      <Td className="text-right font-mono">{celda(f.saldoDeudor)}</Td>
      <Td className="text-right font-mono">{celda(f.saldoAcreedor)}</Td>
      <Td className="text-right font-mono">{celda(f.activo)}</Td>
      <Td className="text-right font-mono">{celda(f.pasivo)}</Td>
      <Td className="text-right font-mono">{celda(f.perdida)}</Td>
      <Td className="text-right font-mono">{celda(f.ganancia)}</Td>
    </>
  )

  return (
    <div>
      <Encabezado titulo="Balance de 8 columnas">
        <Link href={`/contabilidad/balance/export?anio=${anio}`}>
          <Boton variante="secundario">Exportar CSV</Boton>
        </Link>
      </Encabezado>

      <p className="mb-4 text-lg text-slate-800">
        {resultado > 0 && <>Ganaste <span className="font-semibold">{formatearCLP(resultado)}</span> en {anio}.</>}
        {resultado < 0 && <>Perdiste <span className="font-semibold">{formatearCLP(-resultado)}</span> en {anio}.</>}
        {resultado === 0 && <>Sin utilidad ni pérdida en {anio}.</>}
      </p>

      <form className="mb-4 flex flex-wrap items-end gap-3" action="/contabilidad/balance" method="get">
        <label className="text-sm text-slate-600">
          Ejercicio
          <Selector name="anio" defaultValue={String(anio)} className="mt-1 w-32">
            {anios.map((a) => <option key={a} value={a}>{a}</option>)}
          </Selector>
        </label>
        <Boton variante="secundario" type="submit">Ver balance</Boton>
      </form>

      {!cuadra && (
        <div className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          El balance no cuadra: algún par de columnas difiere. Revisa el libro diario del
          ejercicio (no debería ocurrir: la partida doble está blindada en la base).
        </div>
      )}

      <Tabla>
        <thead>
          <tr>
            <Th rowSpan={2}>Cuenta</Th>
            <Th colSpan={2} className="text-center">Sumas</Th>
            <Th colSpan={2} className="text-center">Saldos</Th>
            <Th colSpan={2} className="text-center">Inventario</Th>
            <Th colSpan={2} className="text-center">Resultados</Th>
          </tr>
          <tr>
            <Th className="text-right">Débitos</Th>
            <Th className="text-right">Créditos</Th>
            <Th className="text-right">Deudor</Th>
            <Th className="text-right">Acreedor</Th>
            <Th className="text-right">Activo</Th>
            <Th className="text-right">Pasivo</Th>
            <Th className="text-right">Pérdida</Th>
            <Th className="text-right">Ganancia</Th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <Tr key={f.codigo}>
              <Td><span className="font-mono">{f.codigo}</span> {f.nombre}</Td>
              {celdas(f)}
            </Tr>
          ))}
          {filas.length === 0 && (
            <Tr><Td colSpan={9} className="py-8 text-center text-slate-500">Sin movimientos en {anio}.</Td></Tr>
          )}
          {filaResultado && (
            <Tr className="bg-slate-50 font-medium">
              <Td>{filaResultado.nombre}</Td>
              {celdas(filaResultado)}
            </Tr>
          )}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-slate-300 font-semibold">
            <Td>Totales</Td>
            <Td className="text-right font-mono">{formatearCLP(totales.debitos)}</Td>
            <Td className="text-right font-mono">{formatearCLP(totales.creditos)}</Td>
            <Td className="text-right font-mono">{formatearCLP(totales.saldoDeudor)}</Td>
            <Td className="text-right font-mono">{formatearCLP(totales.saldoAcreedor)}</Td>
            <Td className="text-right font-mono">{formatearCLP(totales.activo)}</Td>
            <Td className="text-right font-mono">{formatearCLP(totales.pasivo)}</Td>
            <Td className="text-right font-mono">{formatearCLP(totales.perdida)}</Td>
            <Td className="text-right font-mono">{formatearCLP(totales.ganancia)}</Td>
          </tr>
        </tfoot>
      </Tabla>
    </div>
  )
}
```

- [ ] **Step 3: Export CSV del balance**

`apps/erp/app/contabilidad/balance/export/route.ts`:

```ts
import { crearClienteServidor } from '@suite/auth/server'
import { filasACsv } from '@suite/core'
import { obtenerEmpresaActiva } from '../../../../lib/empresa-activa'
import { aniosConAsientos, obtenerBalance, type FilaBalance } from '../calculo'

export async function GET(req: Request) {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return new Response('No autorizado', { status: 401 })
  // Paridad con la página: módulo apagado → 404 (misma condición que su notFound()).
  if (!activa.modulo_contabilidad) return new Response('No encontrado', { status: 404 })
  // Guard de rol EXPLÍCITO (lección P12): rol sin permiso → 403, jamás un CSV vacío.
  if (!activa.rol || !['dueno', 'admin', 'contador'].includes(activa.rol)) {
    return new Response('No autorizado', { status: 403 })
  }

  const supabase = await crearClienteServidor()
  const url = new URL(req.url)
  // Año validado con el MISMO criterio de la página (paridad total): debe estar
  // en aniosConAsientos; si no, el mismo default (año actual si tiene asientos,
  // si no el más reciente).
  const anios = await aniosConAsientos(supabase, activa.id)
  const anioActual = new Date().getFullYear()
  const porDefecto = anios.includes(anioActual) ? anioActual : (anios[0] ?? anioActual)
  const qAnio = url.searchParams.get('anio')
  const anio = qAnio && /^\d{4}$/.test(qAnio) && anios.includes(Number(qAnio)) ? Number(qAnio) : porDefecto

  const { filas, filaResultado, totales } = await obtenerBalance(supabase, activa.id, anio)
  const aFila = (f: FilaBalance): (string | number)[] => [
    f.codigo, f.nombre, f.debitos, f.creditos, f.saldoDeudor, f.saldoAcreedor,
    f.activo, f.pasivo, f.perdida, f.ganancia,
  ]
  const filasCsv = [...filas, ...(filaResultado ? [filaResultado] : []), totales].map(aFila)
  const csv = filasACsv(
    ['Código', 'Cuenta', 'Débitos', 'Créditos', 'Saldo deudor', 'Saldo acreedor', 'Activo', 'Pasivo', 'Pérdida', 'Ganancia'],
    filasCsv
  )
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="balance-8-columnas-${anio}.csv"`,
    },
  })
}
```

- [ ] **Step 4: Link "Balance" en el resumen de contabilidad**

`apps/erp/app/contabilidad/page.tsx` — en el `<Encabezado>`, reemplazar el bloque de botones:

```tsx
        <div className="flex items-center gap-2">
          <Link href="/contabilidad/cuentas"><Boton variante="secundario">Plan de cuentas</Boton></Link>
          <Link href="/contabilidad/asientos"><Boton variante="secundario">Ver asientos</Boton></Link>
          <Link href="/contabilidad/asientos/nuevo"><Boton>Nuevo asiento</Boton></Link>
        </div>
```

por:

```tsx
        <div className="flex items-center gap-2">
          <Link href="/contabilidad/cuentas"><Boton variante="secundario">Plan de cuentas</Boton></Link>
          <Link href="/contabilidad/asientos"><Boton variante="secundario">Ver asientos</Boton></Link>
          <Link href="/contabilidad/balance"><Boton variante="secundario">Balance</Boton></Link>
          <Link href="/contabilidad/asientos/nuevo"><Boton>Nuevo asiento</Boton></Link>
        </div>
```

(Estado que esta task espera encontrar: el bloque ORIGINAL de 3 botones — Plan de cuentas /
Ver asientos / Nuevo asiento. El link "EERR" en esta misma fila lo agrega la Task 6, y la
Task 7 reemplaza el archivo completo CONSERVANDO Balance y EERR — reparto declarado en
Global Constraints. Hallazgo verificado: hoy el resumen NO enlaza diario/mayor pese a lo
que asume el spec §5 — este plan NO agrega esos links; a diario/mayor se sigue llegando
como en P16.)

- [ ] **Step 5: Verificar**

Run: `pnpm build --concurrency=1` → **3 apps** compilan; el build del erp lista las rutas
nuevas `/contabilidad/balance` y `/contabilidad/balance/export`.

**Reseed de la demo ANTES del smoke** (los `db reset` de las Tasks 1-3 la borraron; este
bloque es el mismo de la Task 8 Step 3 — las Tasks 6 y 7 HEREDAN este estado sembrado y
no necesitan repetirlo):

```powershell
npx supabase db reset
docker restart supabase_kong_ERP_Transportes; Start-Sleep -Seconds 8
$env:DTE_ENCRYPTION_KEY = ((Get-Content apps/erp/.env.local | ? { $_ -like 'DTE_ENCRYPTION_KEY=*' }) -split '=',2)[1]
node scripts/seed-demo.mjs
```

(El reset aplica 0001-0024; el restart de Kong cura el 502 de `/auth/v1/*` que queda tras
todo reset; la clave DTE se carga desde `apps/erp/.env.local` SIN imprimirla — la
asignación a `$env:` no emite salida, NO hacer `echo` de la variable. El seed en esta
task aún NO tiene la sección 21 de asientos 2025 — la agrega la Task 8 —: el smoke se
hace sobre el ejercicio 2026.)

Reiniciar `pnpm --filter erp dev` (el build pisa el `.next` del dev server). Smoke manual
con el seed demo recién sembrado (login `demo@suite-erp.cl`): `/contabilidad/balance`
muestra el ejercicio 2026 con los 4 pares cuadrados (sin alerta roja), la frase
"Ganaste $X en 2026" (o "Perdiste…") coincide con `Ganancia − Pérdida`, la fila
"Utilidad del ejercicio" iguala Inventario y Resultados; "Exportar CSV" descarga
`balance-8-columnas-2026.csv` con las mismas 10 columnas y filas. Un vendedor recibe
404 en la página y 403 en el export. (Con el seed actual todos los asientos viven en
2026, así que el arrastre es 0; la verificación del arrastre con datos 2025 queda en el
E2E de la Task 8, ítem 4.)

Byte-scan de los archivos tocados (JAMÁS BOM U+FEFF; sin coincidencias = pass, exit 1):

```
grep -rc $'\xEF\xBB\xBF' apps/erp/app/contabilidad/balance apps/erp/app/contabilidad/page.tsx
```

→ cada archivo imprime `0`; el comando sale con status 1.

- [ ] **Step 6: Commit**

```bash
git add apps/erp/app/contabilidad/balance apps/erp/app/contabilidad/page.tsx
git commit -m "feat(erp): balance de 8 columnas con export CSV"
```

---

### Task 6: EERR comparativo por período + export CSV

**Files:**
- Edit: `packages/core/src/periodo.ts` (agrega `rangoDePeriodo`, `periodoAnterior` y `variacion` — `variacion` vive en `@suite/core` y no en `eerr/calculo.ts` para que sea testeable: `calculo.ts` es `server-only` y vitest no lo importa)
- Edit: `packages/core/src/periodo.test.ts` (16 tests nuevos → unit total 176 → **192**; el conteo que el spec §7 deja "a fijar por el plan" queda fijado aquí)
- Create: `apps/erp/app/contabilidad/eerr/calculo.ts`
- Create: `apps/erp/app/contabilidad/eerr/page.tsx`
- Create: `apps/erp/app/contabilidad/eerr/export/route.ts`
- Edit: `apps/erp/app/contabilidad/page.tsx` (link "EERR" junto al "Balance" de la Task 5)

**Interfaces:**
- Consumes: todo lo de la Task 5 (guards, cliente, `formatearCLP`/`filasACsv`, tablas 0022) + `aniosConAsientos()` de `apps/erp/app/contabilidad/balance/calculo.ts` (**depende de la Task 5**) + `rangoDeMes` existente en `packages/core/src/periodo.ts` (los helpers nuevos delegan en él).
- Produces: `/contabilidad/eerr` + `/contabilidad/eerr/export`; helpers puros `rangoDePeriodo('YYYY' | 'YYYY-MM' | 'YYYY-Tn')`, `periodoAnterior(...)` y `variacion(actual, anterior)` en `@suite/core` (testeados — la lógica de fechas no trivial y el único cálculo de formato con signo/redondeo/división-por-cero); `obtenerEERR()`, `etiquetaPeriodo()` y `FilaEERR` en `eerr/calculo.ts` (query + agregación UNA vez, página y export la comparten).
- Formato de período: string canónico `'2026'` (año), `'2026-T3'` (trimestre), `'2026-07'` (mes). La página lo construye desde los selectores `tipo`/`anio`/`n`; el export lo recibe ya resuelto en `?periodo=` y lo valida con el MISMO criterio de la página (formato válido + año en `aniosConAsientos`; si no, el mismo default — paridad total, Minor P12). Misma exclusión de cierres/reversas-de-cierre que el balance (spec §4.2) — **scoped a cada período consultado**.
- **El EERR NO arrastra saldos (a diferencia del balance T5), y es correcto así:** muestra el RESULTADO DEL PERÍODO (ingresos y gastos del rango), no saldos acumulados — los movimientos de resultado de años anteriores no pertenecen al período y los cierres/reversas quedan excluidos por la regla de arriba.
- Variación % (spec §4.2): `(actual − anterior) / |anterior| × 100`, redondeada, con signo. Período anterior sin datos (ninguna línea en cuentas de resultado tras la exclusión) → columna anterior y variación muestran `'—'`; también `'—'` por fila cuando el monto anterior es 0 (división por cero).

- [ ] **Step 1: Helpers de período en @suite/core + tests**

`packages/core/src/periodo.ts` (archivo completo tras el edit):

```ts
// Rango de un mes 'YYYY-MM' en fechas ISO. null si el formato no es válido.
export function rangoDeMes(mes: string): { desde: string; hasta: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(mes)
  if (!m) return null
  const anio = Number(m[1])
  const mm = Number(m[2])
  if (mm < 1 || mm > 12) return null
  const ultimo = new Date(Date.UTC(anio, mm, 0)).getUTCDate()
  const p2 = String(mm).padStart(2, '0')
  return { desde: `${anio}-${p2}-01`, hasta: `${anio}-${p2}-${String(ultimo).padStart(2, '0')}` }
}

// Rango de un período: 'YYYY' (año), 'YYYY-Tn' (trimestre 1-4) o 'YYYY-MM' (mes).
// null si el formato no es válido.
export function rangoDePeriodo(periodo: string): { desde: string; hasta: string } | null {
  if (/^\d{4}$/.test(periodo)) return { desde: `${periodo}-01-01`, hasta: `${periodo}-12-31` }
  const tri = /^(\d{4})-T([1-4])$/.exec(periodo)
  if (tri) {
    const t = Number(tri[2])
    const desde = rangoDeMes(`${tri[1]}-${String(t * 3 - 2).padStart(2, '0')}`)!.desde
    const hasta = rangoDeMes(`${tri[1]}-${String(t * 3).padStart(2, '0')}`)!.hasta
    return { desde, hasta }
  }
  return rangoDeMes(periodo)
}

// Período anterior equivalente: mes → mes anterior, trimestre → trimestre anterior,
// año → año anterior. null si el formato no es válido.
export function periodoAnterior(periodo: string): string | null {
  if (/^\d{4}$/.test(periodo)) return String(Number(periodo) - 1)
  const tri = /^(\d{4})-T([1-4])$/.exec(periodo)
  if (tri) {
    const t = Number(tri[2])
    return t === 1 ? `${Number(tri[1]) - 1}-T4` : `${tri[1]}-T${t - 1}`
  }
  const mes = /^(\d{4})-(\d{2})$/.exec(periodo)
  if (!mes || Number(mes[2]) < 1 || Number(mes[2]) > 12) return null
  const m = Number(mes[2])
  return m === 1 ? `${Number(mes[1]) - 1}-12` : `${mes[1]}-${String(m - 1).padStart(2, '0')}`
}

// Variación % contra el período anterior (spec §4.2): (actual − anterior) /
// |anterior| × 100, redondeada, con signo. '—' sin base de comparación
// (anterior 0: división por cero). Vive acá y no en eerr/calculo.ts para ser
// testeable (calculo.ts es server-only).
export function variacion(actual: number, anterior: number): string {
  if (anterior === 0) return '—'
  const pct = Math.round(((actual - anterior) / Math.abs(anterior)) * 100)
  return `${pct > 0 ? '+' : ''}${pct}%`
}
```

`packages/core/src/periodo.test.ts` (archivo completo tras el edit):

```ts
import { describe, expect, it } from 'vitest'
import { periodoAnterior, rangoDeMes, rangoDePeriodo, variacion } from './periodo'

describe('rangoDeMes', () => {
  it('devuelve primer y último día del mes', () => {
    expect(rangoDeMes('2026-07')).toEqual({ desde: '2026-07-01', hasta: '2026-07-31' })
  })
  it('maneja febrero bisiesto', () => {
    expect(rangoDeMes('2028-02')).toEqual({ desde: '2028-02-01', hasta: '2028-02-29' })
  })
  it('mes fuera de rango es null', () => {
    expect(rangoDeMes('2026-13')).toBeNull()
  })
  it('formato malformado es null', () => {
    expect(rangoDeMes('julio')).toBeNull()
  })
})

describe('rangoDePeriodo', () => {
  it('año completo', () => {
    expect(rangoDePeriodo('2026')).toEqual({ desde: '2026-01-01', hasta: '2026-12-31' })
  })
  it('primer trimestre', () => {
    expect(rangoDePeriodo('2026-T1')).toEqual({ desde: '2026-01-01', hasta: '2026-03-31' })
  })
  it('cuarto trimestre', () => {
    expect(rangoDePeriodo('2026-T4')).toEqual({ desde: '2026-10-01', hasta: '2026-12-31' })
  })
  it('mes delega en rangoDeMes', () => {
    expect(rangoDePeriodo('2026-07')).toEqual({ desde: '2026-07-01', hasta: '2026-07-31' })
  })
  it('trimestre fuera de rango es null', () => {
    expect(rangoDePeriodo('2026-T5')).toBeNull()
  })
  it('formato malformado es null', () => {
    expect(rangoDePeriodo('julio')).toBeNull()
  })
})

describe('periodoAnterior', () => {
  it('mes normal retrocede un mes', () => {
    expect(periodoAnterior('2026-07')).toBe('2026-06')
  })
  it('enero cruza al diciembre anterior', () => {
    expect(periodoAnterior('2026-01')).toBe('2025-12')
  })
  it('T1 cruza al T4 anterior', () => {
    expect(periodoAnterior('2026-T1')).toBe('2025-T4')
  })
  it('trimestre normal retrocede uno', () => {
    expect(periodoAnterior('2026-T3')).toBe('2026-T2')
  })
  it('año retrocede uno', () => {
    expect(periodoAnterior('2026')).toBe('2025')
  })
  it('formato malformado es null', () => {
    expect(periodoAnterior('2026-13')).toBeNull()
  })
})

describe('variacion', () => {
  it('subida lleva signo +', () => {
    expect(variacion(140000, 100000)).toBe('+40%')
  })
  it('caída lleva signo -', () => {
    expect(variacion(60000, 100000)).toBe('-40%')
  })
  it('base negativa (pérdida anterior) usa el valor absoluto', () => {
    expect(variacion(50000, -100000)).toBe('+150%')
  })
  it('anterior 0 no divide: —', () => {
    expect(variacion(50000, 0)).toBe('—')
  })
})
```

Run: `pnpm test` → **192 tests** verdes (176 previos + 16 de `periodo.test.ts`: 12 de rango/anterior + 4 de `variacion`).

- [ ] **Step 2: Módulo compartido de cálculo del EERR**

`apps/erp/app/contabilidad/eerr/calculo.ts`:

```ts
import 'server-only'
import type { crearClienteServidor } from '@suite/auth/server'
import { periodoAnterior, rangoDePeriodo } from '@suite/core'

type ClienteSupabase = Awaited<ReturnType<typeof crearClienteServidor>>

export interface FilaEERR {
  codigo: string
  nombre: string
  actual: number
  anterior: number
}

export interface EERR {
  periodo: string
  anterior: string
  ingresos: FilaEERR[]
  gastos: FilaEERR[]
  totalIngresos: { actual: number; anterior: number }
  totalGastos: { actual: number; anterior: number }
  resultado: { actual: number; anterior: number }
  // false = ninguna línea en cuentas de resultado en el período anterior
  // (tras la exclusión de cierres) → columnas anterior/variación muestran '—'.
  anteriorConDatos: boolean
}

interface AsientoPeriodo {
  origen: string
  reversa_de: string | null
  asientos_lineas: { cuenta_id: string; debe: number; haber: number }[]
}

// (variacion() vive en @suite/core/periodo.ts — testeable; este archivo es server-only.)

// Etiqueta legible: '2026' → '2026'; '2026-T3' → 'T3 2026'; '2026-07' → 'julio de 2026'.
export function etiquetaPeriodo(periodo: string): string {
  const tri = /^(\d{4})-T([1-4])$/.exec(periodo)
  if (tri) return `T${tri[2]} ${tri[1]}`
  const mes = /^(\d{4})-(\d{2})$/.exec(periodo)
  if (mes) {
    return new Date(Date.UTC(Number(mes[1]), Number(mes[2]) - 1, 1))
      .toLocaleDateString('es-CL', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  }
  return periodo
}

// Suma debe/haber por cuenta en un rango, excluyendo asientos de cierre y sus
// reversas ligadas (misma exclusión del balance §4.1).
async function movimientosPorCuenta(
  supabase: ClienteSupabase,
  empresaId: string,
  rango: { desde: string; hasta: string },
  idsCierre: Set<string>
): Promise<Map<string, { debe: number; haber: number }>> {
  // ponytail: sin paginación (cap PostgREST 1000 asientos por rango, mismo techo
  // que el diario); .range() en páginas si una empresa lo supera.
  const { data } = await supabase
    .from('asientos')
    .select('origen, reversa_de, asientos_lineas (cuenta_id, debe, haber)')
    .eq('empresa_id', empresaId)
    .gte('fecha', rango.desde)
    .lte('fecha', rango.hasta)
  const porCuenta = new Map<string, { debe: number; haber: number }>()
  for (const a of (data ?? []) as AsientoPeriodo[]) {
    if (a.origen === 'cierre') continue
    if (a.reversa_de && idsCierre.has(a.reversa_de)) continue
    for (const l of a.asientos_lineas) {
      const acc = porCuenta.get(l.cuenta_id) ?? { debe: 0, haber: 0 }
      acc.debe += l.debe
      acc.haber += l.haber
      porCuenta.set(l.cuenta_id, acc)
    }
  }
  return porCuenta
}

// EERR del período con columna del período anterior equivalente (spec §4.2).
// null si el período no tiene formato válido.
export async function obtenerEERR(
  supabase: ClienteSupabase,
  empresaId: string,
  periodo: string
): Promise<EERR | null> {
  const anterior = periodoAnterior(periodo)
  const rangoActual = rangoDePeriodo(periodo)
  const rangoAnterior = anterior ? rangoDePeriodo(anterior) : null
  if (!anterior || !rangoActual || !rangoAnterior) return null

  const { data: cierres } = await supabase
    .from('asientos')
    .select('id')
    .eq('empresa_id', empresaId)
    .eq('origen', 'cierre')
  const idsCierre = new Set((cierres ?? []).map((c) => c.id))

  // Cuentas hoja de resultado, inactivas incluidas (patrón mayor).
  const { data: cuentas } = await supabase
    .from('cuentas_contables')
    .select('id, codigo, nombre, tipo')
    .eq('empresa_id', empresaId)
    .eq('acepta_movimientos', true)
    .in('tipo', ['ingreso', 'gasto'])
    .order('codigo')

  const movActual = await movimientosPorCuenta(supabase, empresaId, rangoActual, idsCierre)
  const movAnterior = await movimientosPorCuenta(supabase, empresaId, rangoAnterior, idsCierre)

  const cero = { debe: 0, haber: 0 }
  const ingresos: FilaEERR[] = []
  const gastos: FilaEERR[] = []
  let anteriorConDatos = false
  for (const c of cuentas ?? []) {
    if (movAnterior.has(c.id)) anteriorConDatos = true
    const a = movActual.get(c.id) ?? cero
    const p = movAnterior.get(c.id) ?? cero
    if (a === cero && p === cero) continue
    // Saldo natural: ingresos al haber (acreedor positivo), gastos al debe.
    const monto = (m: { debe: number; haber: number }) =>
      c.tipo === 'ingreso' ? m.haber - m.debe : m.debe - m.haber
    const fila = { codigo: c.codigo, nombre: c.nombre, actual: monto(a), anterior: monto(p) }
    if (c.tipo === 'ingreso') ingresos.push(fila)
    else gastos.push(fila)
  }

  const suma = (fs: FilaEERR[]) => ({
    actual: fs.reduce((s, f) => s + f.actual, 0),
    anterior: fs.reduce((s, f) => s + f.anterior, 0),
  })
  const totalIngresos = suma(ingresos)
  const totalGastos = suma(gastos)
  return {
    periodo,
    anterior,
    ingresos,
    gastos,
    totalIngresos,
    totalGastos,
    resultado: {
      actual: totalIngresos.actual - totalGastos.actual,
      anterior: totalIngresos.anterior - totalGastos.anterior,
    },
    anteriorConDatos,
  }
}
```

- [ ] **Step 3: Página del EERR**

`apps/erp/app/contabilidad/eerr/page.tsx`:

```tsx
import Link from 'next/link'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP, variacion } from '@suite/core'
import { Boton, Encabezado, Selector, Tabla, Td, Th, Tr } from '@suite/ui'
import { exigirContabilidad } from '../../../lib/contabilidad-acceso'
import { aniosConAsientos } from '../balance/calculo'
import { etiquetaPeriodo, obtenerEERR, type FilaEERR } from './calculo'

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

export default async function PaginaEERR({
  searchParams,
}: {
  searchParams: Promise<{ tipo?: string; anio?: string; n?: string }>
}) {
  const { tipo: qTipo, anio: qAnio, n: qN } = await searchParams
  const activa = await exigirContabilidad()
  const supabase = await crearClienteServidor()

  const anios = await aniosConAsientos(supabase, activa.id)
  if (anios.length === 0) {
    return (
      <div>
        <Encabezado titulo="Estado de resultados" />
        <p className="text-slate-500">Aún no hay asientos. Emite un documento o usa Contabilizar pendientes.</p>
      </div>
    )
  }

  const hoy = new Date()
  const tipo = qTipo === 'trimestre' || qTipo === 'anio' ? qTipo : 'mes'
  const porDefecto = anios.includes(hoy.getFullYear()) ? hoy.getFullYear() : anios[0]
  const anio = qAnio && /^\d{4}$/.test(qAnio) && anios.includes(Number(qAnio)) ? Number(qAnio) : porDefecto
  const maxN = tipo === 'mes' ? 12 : 4
  const nDefecto = tipo === 'mes' ? hoy.getMonth() + 1 : Math.floor(hoy.getMonth() / 3) + 1
  const n = qN && /^\d{1,2}$/.test(qN) && Number(qN) >= 1 && Number(qN) <= maxN ? Number(qN) : nDefecto
  const periodo =
    tipo === 'anio' ? String(anio) : tipo === 'trimestre' ? `${anio}-T${n}` : `${anio}-${String(n).padStart(2, '0')}`

  // El período se construyó con formato válido: obtenerEERR nunca retorna null aquí.
  const eerr = (await obtenerEERR(supabase, activa.id, periodo))!
  const r = eerr.resultado
  const etActual = etiquetaPeriodo(periodo)
  const etAnterior = etiquetaPeriodo(eerr.anterior)
  const colAnterior = (v: number) => (eerr.anteriorConDatos ? formatearCLP(v) : '—')
  const colVariacion = (actual: number, anterior: number) =>
    eerr.anteriorConDatos ? variacion(actual, anterior) : '—'
  const filaCuenta = (f: FilaEERR) => (
    <Tr key={f.codigo}>
      <Td><span className="font-mono">{f.codigo}</span> {f.nombre}</Td>
      <Td className="text-right font-mono">{formatearCLP(f.actual)}</Td>
      <Td className="text-right font-mono">{colAnterior(f.anterior)}</Td>
      <Td className="text-right font-mono">{colVariacion(f.actual, f.anterior)}</Td>
    </Tr>
  )

  return (
    <div>
      <Encabezado titulo="Estado de resultados">
        <Link href={`/contabilidad/eerr/export?periodo=${periodo}`}>
          <Boton variante="secundario">Exportar CSV</Boton>
        </Link>
      </Encabezado>

      <p className="mb-4 text-lg text-slate-800">
        {r.actual > 0 && <>Ganaste <span className="font-semibold">{formatearCLP(r.actual)}</span> en {etActual}.</>}
        {r.actual < 0 && <>Perdiste <span className="font-semibold">{formatearCLP(-r.actual)}</span> en {etActual}.</>}
        {r.actual === 0 && <>Sin utilidad ni pérdida en {etActual}.</>}
        {eerr.anteriorConDatos ? (
          <span className="text-slate-500">
            {' '}{etAnterior}: {r.anterior < 0 ? <>pérdida de {formatearCLP(-r.anterior)}</> : <>utilidad de {formatearCLP(r.anterior)}</>} (variación {variacion(r.actual, r.anterior)}).
          </span>
        ) : (
          <span className="text-slate-500"> Sin datos de {etAnterior} para comparar.</span>
        )}
      </p>

      {/* Cambiar el tipo re-envía el form (server component sin JS): el selector
          de mes/trimestre se re-dibuja para el tipo recién elegido. */}
      <form className="mb-4 flex flex-wrap items-end gap-3" action="/contabilidad/eerr" method="get">
        <label className="text-sm text-slate-600">
          Período
          <Selector name="tipo" defaultValue={tipo} className="mt-1 w-36">
            <option value="mes">Mes</option>
            <option value="trimestre">Trimestre</option>
            <option value="anio">Año</option>
          </Selector>
        </label>
        {tipo !== 'anio' && (
          <label className="text-sm text-slate-600">
            {tipo === 'mes' ? 'Mes' : 'Trimestre'}
            <Selector name="n" defaultValue={String(n)} className="mt-1 w-40">
              {tipo === 'mes'
                ? MESES.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)
                : [1, 2, 3, 4].map((t) => <option key={t} value={t}>T{t}</option>)}
            </Selector>
          </label>
        )}
        <label className="text-sm text-slate-600">
          Año
          <Selector name="anio" defaultValue={String(anio)} className="mt-1 w-32">
            {anios.map((a) => <option key={a} value={a}>{a}</option>)}
          </Selector>
        </label>
        <Boton variante="secundario" type="submit">Ver EERR</Boton>
      </form>

      <Tabla>
        <thead>
          <tr>
            <Th>Cuenta</Th>
            <Th className="text-right">{etActual}</Th>
            <Th className="text-right">{etAnterior}</Th>
            <Th className="text-right">Variación</Th>
          </tr>
        </thead>
        <tbody>
          <Tr className="bg-slate-50"><Td colSpan={4} className="font-semibold text-slate-700">Ingresos</Td></Tr>
          {eerr.ingresos.map(filaCuenta)}
          {eerr.ingresos.length === 0 && (
            <Tr><Td colSpan={4} className="text-slate-500">Sin ingresos en {etActual} ni en {etAnterior}.</Td></Tr>
          )}
          <Tr className="font-medium">
            <Td className="text-right">Total ingresos</Td>
            <Td className="text-right font-mono">{formatearCLP(eerr.totalIngresos.actual)}</Td>
            <Td className="text-right font-mono">{colAnterior(eerr.totalIngresos.anterior)}</Td>
            <Td className="text-right font-mono">{colVariacion(eerr.totalIngresos.actual, eerr.totalIngresos.anterior)}</Td>
          </Tr>
          <Tr className="bg-slate-50"><Td colSpan={4} className="font-semibold text-slate-700">Gastos</Td></Tr>
          {eerr.gastos.map(filaCuenta)}
          {eerr.gastos.length === 0 && (
            <Tr><Td colSpan={4} className="text-slate-500">Sin gastos en {etActual} ni en {etAnterior}.</Td></Tr>
          )}
          <Tr className="font-medium">
            <Td className="text-right">Total gastos</Td>
            <Td className="text-right font-mono">{formatearCLP(eerr.totalGastos.actual)}</Td>
            <Td className="text-right font-mono">{colAnterior(eerr.totalGastos.anterior)}</Td>
            <Td className="text-right font-mono">{colVariacion(eerr.totalGastos.actual, eerr.totalGastos.anterior)}</Td>
          </Tr>
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-slate-300 font-semibold">
            <Td className="text-right">Resultado del período</Td>
            <Td className="text-right font-mono">{formatearCLP(r.actual)}</Td>
            <Td className="text-right font-mono">{colAnterior(r.anterior)}</Td>
            <Td className="text-right font-mono">{colVariacion(r.actual, r.anterior)}</Td>
          </tr>
        </tfoot>
      </Tabla>
    </div>
  )
}
```

- [ ] **Step 4: Export CSV del EERR**

`apps/erp/app/contabilidad/eerr/export/route.ts`:

```ts
import { crearClienteServidor } from '@suite/auth/server'
import { filasACsv, rangoDePeriodo, variacion } from '@suite/core'
import { obtenerEmpresaActiva } from '../../../../lib/empresa-activa'
import { aniosConAsientos } from '../../balance/calculo'
import { etiquetaPeriodo, obtenerEERR, type FilaEERR } from '../calculo'

export async function GET(req: Request) {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return new Response('No autorizado', { status: 401 })
  // Paridad con la página: módulo apagado → 404 (misma condición que su notFound()).
  if (!activa.modulo_contabilidad) return new Response('No encontrado', { status: 404 })
  // Guard de rol EXPLÍCITO (lección P12): rol sin permiso → 403, jamás un CSV vacío.
  if (!activa.rol || !['dueno', 'admin', 'contador'].includes(activa.rol)) {
    return new Response('No autorizado', { status: 403 })
  }

  const supabase = await crearClienteServidor()
  const url = new URL(req.url)
  // Período validado con el MISMO criterio de la página (paridad total): formato
  // canónico válido Y año dentro de aniosConAsientos; si no, el mismo default de
  // la página (mes actual del año por defecto).
  const anios = await aniosConAsientos(supabase, activa.id)
  const hoy = new Date()
  const porDefecto = anios.includes(hoy.getFullYear()) ? hoy.getFullYear() : (anios[0] ?? hoy.getFullYear())
  const qPeriodo = url.searchParams.get('periodo') ?? ''
  const periodo =
    rangoDePeriodo(qPeriodo) && anios.includes(Number(qPeriodo.slice(0, 4)))
      ? qPeriodo
      : `${porDefecto}-${String(hoy.getMonth() + 1).padStart(2, '0')}`
  // El período ya quedó con formato válido: obtenerEERR nunca retorna null aquí.
  const eerr = (await obtenerEERR(supabase, activa.id, periodo))!

  const colAnterior = (v: number) => (eerr.anteriorConDatos ? v : '—')
  const colVariacion = (actual: number, anterior: number) =>
    eerr.anteriorConDatos ? variacion(actual, anterior) : '—'
  const fila = (seccion: string, f: FilaEERR): (string | number)[] => [
    seccion, f.codigo, f.nombre, f.actual, colAnterior(f.anterior), colVariacion(f.actual, f.anterior),
  ]
  const filas: (string | number | null)[][] = []
  for (const f of eerr.ingresos) filas.push(fila('Ingresos', f))
  filas.push(['Ingresos', '', 'Total ingresos', eerr.totalIngresos.actual, colAnterior(eerr.totalIngresos.anterior), colVariacion(eerr.totalIngresos.actual, eerr.totalIngresos.anterior)])
  for (const f of eerr.gastos) filas.push(fila('Gastos', f))
  filas.push(['Gastos', '', 'Total gastos', eerr.totalGastos.actual, colAnterior(eerr.totalGastos.anterior), colVariacion(eerr.totalGastos.actual, eerr.totalGastos.anterior)])
  filas.push(['', '', 'Resultado del período', eerr.resultado.actual, colAnterior(eerr.resultado.anterior), colVariacion(eerr.resultado.actual, eerr.resultado.anterior)])

  const csv = filasACsv(
    ['Sección', 'Código', 'Cuenta', etiquetaPeriodo(eerr.periodo), etiquetaPeriodo(eerr.anterior), 'Variación'],
    filas
  )
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="eerr-${eerr.periodo}.csv"`,
    },
  })
}
```

- [ ] **Step 5: Link "EERR" en el resumen de contabilidad**

`apps/erp/app/contabilidad/page.tsx` — en el `<Encabezado>`, reemplazar (estado tras la Task 5):

```tsx
          <Link href="/contabilidad/balance"><Boton variante="secundario">Balance</Boton></Link>
```

por:

```tsx
          <Link href="/contabilidad/balance"><Boton variante="secundario">Balance</Boton></Link>
          <Link href="/contabilidad/eerr"><Boton variante="secundario">EERR</Boton></Link>
```

- [ ] **Step 6: Verificar**

Run: `pnpm test` → **192 tests** verdes (si el Step 1 ya corrió, re-confirma; el conteo
queda fijado: 176 + 16).

Run: `pnpm build --concurrency=1` → **3 apps** compilan; el build del erp lista
`/contabilidad/eerr` y `/contabilidad/eerr/export`.

Reiniciar `pnpm --filter erp dev`. Smoke manual con el seed demo (la demo quedó sembrada
en el Step 5 de la Task 5 — esta task HEREDA ese estado; si algo la borró, repetir el
bloque de reseed de esa task): `/contabilidad/eerr`
abre en el mes actual con columnas del mes, del mes anterior y variación % (el seed tiene
ventas en ambos meses → hay comparación; si el mes anterior no tiene movimientos de
resultado, las columnas muestran `—`); selector a trimestre y a año re-calculan; la
estructura Ingresos − Gastos = Resultado cuadra con el balance del mismo año; "Exportar
CSV" descarga `eerr-<periodo>.csv` con las mismas columnas. Un vendedor recibe 404 en la
página y 403 en el export.

Byte-scan (JAMÁS BOM U+FEFF; sin coincidencias = pass, exit 1):

```
grep -rc $'\xEF\xBB\xBF' apps/erp/app/contabilidad/eerr packages/core/src/periodo.ts packages/core/src/periodo.test.ts apps/erp/app/contabilidad/page.tsx
```

→ cada archivo imprime `0`; el comando sale con status 1.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/periodo.ts packages/core/src/periodo.test.ts apps/erp/app/contabilidad/eerr apps/erp/app/contabilidad/page.tsx
git commit -m "feat(erp): EERR comparativo por período con export CSV"
```

---

### Task 7: Revisión del período (/contabilidad/revision) + cierre asistido + semáforo en el resumen

**Files:**
- Create: `apps/erp/app/contabilidad/revision/semaforo.ts`
- Create: `apps/erp/app/contabilidad/revision/acciones.ts`
- Create: `apps/erp/app/contabilidad/revision/page.tsx`
- Create: `apps/erp/componentes/acciones-cierre.tsx`
- Modify: `apps/erp/app/contabilidad/page.tsx` (reemplazo COMPLETO — estado esperado: tras las Tasks 5-6, con los botones Balance y EERR ya presentes en el encabezado; el reemplazo los CONSERVA)
- Modify: `apps/erp/app/contabilidad/asientos/[id]/page.tsx` (1 línea: el botón Revertir se oculta cuando `origen === 'cierre'` — pareja UI del candado SQL de la Task 1; el RPC igual lo bloquea)

**Interfaces:**

*Consumes (BD, spec §3 — creadas por las tasks de migración/RPCs, con tipos ya regenerados en `@suite/db`):*
- `rpc revision_periodo(p_empresa uuid, p_anio integer, p_mes integer) returns jsonb` → `{periodo, estado, observaciones: [{regla, severidad, titulo, detalle, enlace_tipo, enlace_id}]}` con `severidad/estado in ('critica','media','ok')`. **Decisión de diseño (spec §3.3 vs §4.3 — seam ACEPTADO, ver sección Seams):** la RPC NO entrega una preview estructurada del asiento de cierre — la observación de `ejercicio_anterior_abierto` solo trae `titulo`/`detalle` de texto. Por lo tanto **la página calcula la preview con su propia lectura** (misma agregación que `cerrar_ejercicio`, sin crear nada), patrón lecturas-en-página del mayor (P16 T8); la evidencia de equivalencia son los ítems 3-4 del E2E de la Task 8 ($ preview = $ cierre real).
- `rpc cerrar_ejercicio(p_empresa uuid, p_anio integer) returns uuid` (null = noop sin movimientos de resultado; no crea fila).
- `rpc reabrir_ejercicio(p_empresa uuid, p_anio integer) returns uuid`.
- Tabla `cierres_ejercicio` (`anio, estado, resultado, creado_en`; SELECT vía RLS de roles contables).

*Consumes (Task 4 — `reglas.ts` es la fuente ÚNICA de tipos y etiquetas del payload, ver Global Constraints):* `rutaEnlace`, `ETIQUETA_SEVERIDAD`, `SeveridadRevision` y `RevisionPeriodo` de `apps/erp/app/contabilidad/revision/reglas.ts`. Esta task NO re-declara tipos ni etiquetas: `semaforo.ts` solo agrega los mapas de presentación que no existen en `reglas.ts` (`ETIQUETA_ESTADO`, `TONO_ESTADO`, `PANEL_ESTADO`).

*Consumes (repo):* `exigirContabilidad` (guard módulo + ROLES_CONTABLES — misma paridad P16), `obtenerEmpresaActiva`, `formatearCLP`, `rangoDeMes`, componentes `@suite/ui` (`Boton`, `Encabezado`, `Insignia`, `Tabla`, `Tarjeta`, `Td`, `Th`, `Tr`). Errores de RPC → campo `error` del estado del form, patrón `EstadoContabilizar`/`EstadoForm` del repo (el mensaje SQL llega por `error.message` sin reescribir).

*Provides:*
- Página `/contabilidad/revision` (Server Component, período por query param `mes=YYYY-MM`).
- `EstadoCierre = { error?: string; exito?: string }` y Server Actions `cerrarEjercicio`/`reabrirEjercicio`.
- `semaforo.ts`: SOLO mapas de presentación del semáforo (`ETIQUETA_ESTADO`, `TONO_ESTADO`, `PANEL_ESTADO`), tipados con `SeveridadRevision` importado de `reglas.ts` — compartidos por revisión y resumen. Los tipos del payload y `ETIQUETA_SEVERIDAD` viven en `reglas.ts` (Task 4, fuente única).

- [ ] **Step 1: Mapas de presentación del semáforo (los tipos viven en `reglas.ts`)**

Crear `apps/erp/app/contabilidad/revision/semaforo.ts`:

```ts
// Presentación del semáforo de revisión (spec §4.3). Los TIPOS del payload y
// ETIQUETA_SEVERIDAD viven en reglas.ts (Task 4, fuente única): aquí SOLO los
// mapas de presentación que reglas.ts no define. `severidad` y `estado`
// comparten dominio ('critica'|'media'|'ok'): un solo juego de mapas sirve
// para la insignia de cada observación y el estado agregado del período.
import type { SeveridadRevision } from './reglas'

export const ETIQUETA_ESTADO: Record<SeveridadRevision, string> = {
  ok: 'Al día',
  media: 'Con observaciones',
  critica: 'Requiere atención',
}

// Tonos de <Insignia> (verde/amarillo/rojo — paridad con el semáforo del dashboard).
export const TONO_ESTADO: Record<SeveridadRevision, 'verde' | 'amarillo' | 'rojo'> = {
  ok: 'verde',
  media: 'amarillo',
  critica: 'rojo',
}

// Clases ESTÁTICAS del panel grande (Tailwind no soporta nombres interpolados —
// mismo criterio que componentes/kpi.tsx: emerald/amber/red).
export const PANEL_ESTADO: Record<SeveridadRevision, string> = {
  ok: 'border-l-emerald-500 bg-emerald-50 text-emerald-800',
  media: 'border-l-amber-500 bg-amber-50 text-amber-800',
  critica: 'border-l-red-500 bg-red-50 text-red-800',
}
```

- [ ] **Step 2: Server Actions de cierre y reapertura**

Crear `apps/erp/app/contabilidad/revision/acciones.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP } from '@suite/core'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'

// Patrón EstadoContabilizar (contabilidad/acciones.ts): error del RPC sin
// reescribir + mensaje de éxito armado en la action.
export type EstadoCierre = { error?: string; exito?: string }

function leerAnio(formData: FormData): number | null {
  const anio = Number(formData.get('anio'))
  return Number.isInteger(anio) && anio >= 2000 && anio <= 2100 ? anio : null
}

export async function cerrarEjercicio(_prev: EstadoCierre, formData: FormData): Promise<EstadoCierre> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  const anio = leerAnio(formData)
  if (anio === null) return { error: 'Año no válido' }
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase.rpc('cerrar_ejercicio', { p_empresa: activa.id, p_anio: anio })
  if (error) return { error: error.message }
  revalidatePath('/contabilidad')
  revalidatePath('/contabilidad/revision')
  // noop del RPC (spec §3.1): sin movimientos de resultado retorna null y no crea fila.
  if (!data) return { exito: `El ejercicio ${anio} no tenía movimientos de resultado; no hizo falta asiento de cierre.` }
  // El RPC retorna el uuid del asiento; la utilidad quedó en cierres_ejercicio.resultado.
  const { data: cierre } = await supabase
    .from('cierres_ejercicio')
    .select('resultado')
    .eq('empresa_id', activa.id)
    .eq('anio', anio)
    .single()
  const resultado = cierre?.resultado ?? 0
  return {
    exito:
      resultado >= 0
        ? `Ejercicio ${anio} cerrado con utilidad de ${formatearCLP(resultado)}`
        : `Ejercicio ${anio} cerrado con pérdida de ${formatearCLP(Math.abs(resultado))}`,
  }
}

export async function reabrirEjercicio(_prev: EstadoCierre, formData: FormData): Promise<EstadoCierre> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  const anio = leerAnio(formData)
  if (anio === null) return { error: 'Año no válido' }
  const supabase = await crearClienteServidor()
  const { error } = await supabase.rpc('reabrir_ejercicio', { p_empresa: activa.id, p_anio: anio })
  if (error) return { error: error.message }
  revalidatePath('/contabilidad')
  revalidatePath('/contabilidad/revision')
  return { exito: `Ejercicio ${anio} reabierto: el asiento de cierre quedó revertido.` }
}
```

Limitación ACEPTADA (declarada, no bug): `revalidatePath` re-renderiza la página y el
form que mostró el mensaje puede desmontarse (el panel de cierre desaparece al cerrar; el
botón Reabrir desaparece al reabrir), perdiendo el `exito`. Se acepta porque el CAMBIO de
UI comunica el resultado por sí solo: la fila del ejercicio pasa a «Cerrado»/«Reabierto»
y el panel aparece/desaparece. No mover el mensaje a query params ni toasts por esto.

- [ ] **Step 3: Botones cliente (aprobar cierre y reabrir con confirmación)**

Crear `apps/erp/componentes/acciones-cierre.tsx`:

```tsx
'use client'

import { useActionState, useState } from 'react'
import { Boton } from '@suite/ui'
import type { EstadoCierre } from '../app/contabilidad/revision/acciones'

type AccionCierre = (prev: EstadoCierre, formData: FormData) => Promise<EstadoCierre>

function Mensajes({ estado }: { estado: EstadoCierre }) {
  return (
    <>
      {estado.error && <span className="w-full text-sm text-red-600">{estado.error}</span>}
      {estado.exito && <span className="w-full text-sm text-green-700">{estado.exito}</span>}
    </>
  )
}

export function BotonAprobarCierre({ anio, accion }: { anio: number; accion: AccionCierre }) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoCierre)
  return (
    <form action={enviar} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="anio" value={anio} />
      <Boton type="submit" disabled={pendiente}>
        {pendiente ? 'Cerrando…' : 'Aprobar cierre'}
      </Boton>
      <Mensajes estado={estado} />
    </form>
  )
}

// Confirmación destructiva en dos pasos (patrón BotonRevertir).
export function BotonReabrirEjercicio({ anio, accion }: { anio: number; accion: AccionCierre }) {
  const [abierto, setAbierto] = useState(false)
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoCierre)
  if (!abierto) {
    return (
      <Boton variante="secundario" type="button" className="px-2 py-1 text-xs" onClick={() => setAbierto(true)}>
        Reabrir
      </Boton>
    )
  }
  return (
    <form action={enviar} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="anio" value={anio} />
      <span className="text-xs text-slate-600">¿Reabrir {anio}? Se revierte el asiento de cierre.</span>
      <Boton variante="peligro" type="submit" disabled={pendiente} className="px-2 py-1 text-xs">
        {pendiente ? '…' : 'Confirmar'}
      </Boton>
      <Boton variante="secundario" type="button" className="px-2 py-1 text-xs" onClick={() => setAbierto(false)}>
        Cancelar
      </Boton>
      <Mensajes estado={estado} />
    </form>
  )
}
```

- [ ] **Step 4: Página de revisión**

Crear `apps/erp/app/contabilidad/revision/page.tsx`:

```tsx
import Link from 'next/link'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP, rangoDeMes } from '@suite/core'
import { Boton, Encabezado, Insignia, Tabla, Tarjeta, Td, Th, Tr } from '@suite/ui'
import { exigirContabilidad } from '../../../lib/contabilidad-acceso'
import { BotonAprobarCierre, BotonReabrirEjercicio } from '../../../componentes/acciones-cierre'
import { cerrarEjercicio, reabrirEjercicio } from './acciones'
import { ETIQUETA_REGLA, ETIQUETA_SEVERIDAD, rutaEnlace, type RevisionPeriodo } from './reglas'
import { ETIQUETA_ESTADO, PANEL_ESTADO, TONO_ESTADO } from './semaforo'

interface CuentaHoja {
  id: string
  codigo: string
  nombre: string
  tipo: string
  clave_sistema: string | null
}
interface AsientoAnio {
  id: string
  origen: string
  reversa_de: string | null
  asientos_lineas: { cuenta_id: string; debe: number; haber: number }[]
}
interface LineaPreview {
  codigo: string
  nombre: string
  debe: number
  haber: number
}

export default async function PaginaRevision({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>
}) {
  const { mes: qMes } = await searchParams
  const activa = await exigirContabilidad()
  const supabase = await crearClienteServidor()

  // Período: query param mes=YYYY-MM validado con rangoDeMes; default mes actual
  // (mismo criterio UTC que el mayor).
  const hoy = new Date().toISOString().slice(0, 7)
  const periodo = qMes && rangoDeMes(qMes) ? qMes : hoy
  const anio = Number(periodo.slice(0, 4))
  const mes = Number(periodo.slice(5, 7))
  const p2 = (n: number) => String(n).padStart(2, '0')
  const mesAnterior = mes === 1 ? `${anio - 1}-12` : `${anio}-${p2(mes - 1)}`
  const mesSiguiente = mes === 12 ? `${anio + 1}-01` : `${anio}-${p2(mes + 1)}`
  const etiquetaMes = new Date(Date.UTC(anio, mes - 1, 1)).toLocaleDateString('es-CL', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })

  const { data: revData, error: revError } = await supabase.rpc('revision_periodo', {
    p_empresa: activa.id,
    p_anio: anio,
    p_mes: mes,
  })
  const revision = (revData as unknown as RevisionPeriodo | null) ?? null
  const observaciones = revision?.observaciones ?? []

  // Historia de cierres (RLS: roles contables). Fila 'cerrado' = año cerrado;
  // 'reabierto' queda como historia sin botón.
  const { data: cierres } = await supabase
    .from('cierres_ejercicio')
    .select('anio, estado, resultado, creado_en')
    .eq('empresa_id', activa.id)
    .order('anio', { ascending: false })

  // --- Cierre asistido (regla 7). La RPC solo entrega texto en `detalle`
  // (spec §3.3): la preview se calcula aquí con la MISMA agregación de
  // cerrar_ejercicio, sin crear nada (patrón lecturas-en-página del mayor).
  // ponytail: se asume anio-1 como año a cerrar (es exactamente lo que observa
  // la regla 7); si hubiera un año aún más antiguo abierto con movimientos,
  // cerrar_ejercicio lo rechaza con 'Cierra primero el ejercicio X' y el
  // mensaje llega por EstadoCierre.error.
  const tieneRegla7 = observaciones.some((o) => o.regla === 'ejercicio_anterior_abierto')
  let panelCierre: {
    anio: number
    lineas: LineaPreview[]
    resultado: number
    cuentaUtilidad: CuentaHoja | null
  } | null = null
  if (tieneRegla7) {
    const anioCierre = anio - 1
    const { data: cuentasData } = await supabase
      .from('cuentas_contables')
      .select('id, codigo, nombre, tipo, clave_sistema')
      .eq('empresa_id', activa.id)
      .eq('acepta_movimientos', true)
    const hojas = (cuentasData ?? []) as CuentaHoja[]
    const { data: asientosData } = await supabase
      .from('asientos')
      .select('id, origen, reversa_de, asientos_lineas (cuenta_id, debe, haber)')
      .eq('empresa_id', activa.id)
      .gte('fecha', `${anioCierre}-01-01`)
      .lte('fecha', `${anioCierre}-12-31`)
    const asientosAnio = (asientosData ?? []) as AsientoAnio[]
    // Exclusión de cierres previos y sus reversas ligadas (spec §3.1) — cubre el
    // caso cerrado-y-reabierto, donde ese par vive con fecha 31-dic del mismo año.
    const idsCierre = new Set(asientosAnio.filter((a) => a.origen === 'cierre').map((a) => a.id))
    const neto = new Map<string, number>()
    for (const a of asientosAnio) {
      if (a.origen === 'cierre') continue
      if (a.origen === 'reversa' && a.reversa_de && idsCierre.has(a.reversa_de)) continue
      for (const l of a.asientos_lineas ?? []) {
        neto.set(l.cuenta_id, (neto.get(l.cuenta_id) ?? 0) + l.debe - l.haber)
      }
    }
    const porId = new Map(hojas.map((c) => [c.id, c]))
    const lineas: LineaPreview[] = []
    let resultado = 0
    for (const [cuentaId, n] of neto) {
      const c = porId.get(cuentaId)
      if (!c || (c.tipo !== 'ingreso' && c.tipo !== 'gasto') || n === 0) continue
      // Línea inversa que deja la cuenta en 0: saldo acreedor (n < 0) se debita.
      lineas.push({ codigo: c.codigo, nombre: c.nombre, debe: n < 0 ? -n : 0, haber: n > 0 ? n : 0 })
      resultado += -n
    }
    lineas.sort((a, b) => a.codigo.localeCompare(b.codigo))
    panelCierre = {
      anio: anioCierre,
      lineas,
      resultado,
      cuentaUtilidad: hojas.find((c) => c.clave_sistema === 'utilidad_ejercicio') ?? null,
    }
  }

  return (
    <div>
      <Encabezado titulo="Revisión del período" />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link href={`/contabilidad/revision?mes=${mesAnterior}`}>
          <Boton variante="secundario">← Mes anterior</Boton>
        </Link>
        <span className="text-lg font-semibold capitalize text-slate-800">{etiquetaMes}</span>
        <Link href={`/contabilidad/revision?mes=${mesSiguiente}`}>
          <Boton variante="secundario">Mes siguiente →</Boton>
        </Link>
      </div>

      {revError && <p className="mb-4 text-sm text-red-600">{revError.message}</p>}

      {revision && (
        <div
          className={`mb-6 max-w-3xl rounded-xl border border-slate-200 border-l-4 p-4 ${PANEL_ESTADO[revision.estado]}`}
        >
          <p className="text-xl font-bold">{ETIQUETA_ESTADO[revision.estado]}</p>
          <p className="text-sm">
            {observaciones.length === 0
              ? 'El Contador Auditor no encontró observaciones en este período.'
              : `${observaciones.length} observación${observaciones.length === 1 ? '' : 'es'} en ${etiquetaMes}.`}
          </p>
        </div>
      )}

      {observaciones.length > 0 && (
        <>
          <h2 className="mb-2 text-lg font-semibold text-slate-800">Observaciones</h2>
          <ul className="mb-6 max-w-3xl space-y-2">
            {observaciones.map((o, i) => {
              const ruta = rutaEnlace(o.enlace_tipo, o.enlace_id)
              return (
                <li key={i} className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Insignia tono={TONO_ESTADO[o.severidad]}>{ETIQUETA_SEVERIDAD[o.severidad]}</Insignia>
                    {/* Consumo defensivo declarado en reglas.ts: si la RPC ganara una
                        regla sin título, cae a la etiqueta y luego a la clave cruda. */}
                    <span className="font-medium text-slate-800">{o.titulo || ETIQUETA_REGLA[o.regla] || o.regla}</span>
                    {ruta && (
                      <Link className="ml-auto text-sm text-marca-700 hover:underline" href={ruta}>
                        Ver detalle →
                      </Link>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-slate-600">{o.detalle}</p>
                </li>
              )
            })}
          </ul>
        </>
      )}

      {panelCierre && (
        <Tarjeta className="mb-6 max-w-3xl">
          <h2 className="mb-1 text-lg font-semibold text-slate-800">Cierre de ejercicio {panelCierre.anio}</h2>
          <p className="mb-3 text-sm text-slate-600">
            El Contador Auditor preparó el asiento de cierre: las cuentas de resultado quedan en 0 y el
            resultado pasa a «Utilidad del ejercicio». Es reversible mientras no cierres el año siguiente.
          </p>
          <p className="mb-3 font-medium text-slate-800">
            Esto cierra tu {panelCierre.anio} con {panelCierre.resultado >= 0 ? 'utilidad' : 'pérdida'} de{' '}
            {formatearCLP(Math.abs(panelCierre.resultado))}.
          </p>
          <Tabla>
            <thead>
              <tr>
                <Th>Cuenta</Th>
                <Th className="text-right">Debe</Th>
                <Th className="text-right">Haber</Th>
              </tr>
            </thead>
            <tbody>
              {panelCierre.lineas.map((l) => (
                <Tr key={l.codigo}>
                  <Td>
                    {l.codigo} — {l.nombre}
                  </Td>
                  <Td className="text-right font-mono">{l.debe ? formatearCLP(l.debe) : ''}</Td>
                  <Td className="text-right font-mono">{l.haber ? formatearCLP(l.haber) : ''}</Td>
                </Tr>
              ))}
              {panelCierre.resultado !== 0 && (
                <Tr className="font-medium">
                  <Td>
                    {panelCierre.cuentaUtilidad
                      ? `${panelCierre.cuentaUtilidad.codigo} — ${panelCierre.cuentaUtilidad.nombre}`
                      : 'Utilidad del ejercicio'}
                  </Td>
                  <Td className="text-right font-mono">
                    {panelCierre.resultado < 0 ? formatearCLP(-panelCierre.resultado) : ''}
                  </Td>
                  <Td className="text-right font-mono">
                    {panelCierre.resultado > 0 ? formatearCLP(panelCierre.resultado) : ''}
                  </Td>
                </Tr>
              )}
              {panelCierre.lineas.length === 0 && (
                <Tr>
                  <Td colSpan={3} className="py-4 text-center text-slate-500">
                    El ejercicio {panelCierre.anio} no tiene movimientos de resultado.
                  </Td>
                </Tr>
              )}
            </tbody>
          </Tabla>
          <div className="mt-3">
            <BotonAprobarCierre anio={panelCierre.anio} accion={cerrarEjercicio} />
          </div>
        </Tarjeta>
      )}

      <h2 className="mb-2 text-lg font-semibold text-slate-800">Ejercicios cerrados</h2>
      {(cierres ?? []).length === 0 ? (
        <p className="text-slate-500">Aún no hay ejercicios cerrados.</p>
      ) : (
        <Tabla>
          <thead>
            <tr>
              <Th>Año</Th>
              <Th>Estado</Th>
              <Th className="text-right">Resultado</Th>
              <Th>Cerrado el</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {(cierres ?? []).map((c) => (
              <Tr key={c.anio}>
                <Td className="font-mono">{c.anio}</Td>
                <Td>
                  <Insignia tono={c.estado === 'cerrado' ? 'verde' : 'gris'}>
                    {c.estado === 'cerrado' ? 'Cerrado' : 'Reabierto'}
                  </Insignia>
                </Td>
                <Td className="text-right font-mono">{formatearCLP(c.resultado)}</Td>
                <Td>{new Date(c.creado_en).toLocaleDateString('es-CL')}</Td>
                <Td>
                  {c.estado === 'cerrado' && (
                    <BotonReabrirEjercicio anio={c.anio} accion={reabrirEjercicio} />
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Tabla>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Semáforo del mes en el resumen de contabilidad**

Reemplazar `apps/erp/app/contabilidad/page.tsx` completo por:

```tsx
import Link from 'next/link'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP } from '@suite/core'
import { Boton, Encabezado, Insignia, Tabla, Tarjeta, Td, Th, Tr } from '@suite/ui'
import { exigirContabilidad } from '../../lib/contabilidad-acceso'
import { BotonContabilizar } from '../../componentes/boton-contabilizar'
import { ETIQUETA_ORIGEN } from './origenes'
import { contabilizarPendientes } from './acciones'
import type { RevisionPeriodo } from './revision/reglas'
import { ETIQUETA_ESTADO, TONO_ESTADO } from './revision/semaforo'

export default async function PaginaContabilidad() {
  const activa = await exigirContabilidad()
  const supabase = await crearClienteServidor()

  // Semáforo del mes actual: misma RPC que /contabilidad/revision.
  const hoy = new Date().toISOString().slice(0, 7)
  const { data: revData } = await supabase.rpc('revision_periodo', {
    p_empresa: activa.id,
    p_anio: Number(hoy.slice(0, 4)),
    p_mes: Number(hoy.slice(5, 7)),
  })
  const revision = (revData as unknown as RevisionPeriodo | null) ?? null

  const { data: asientos } = await supabase
    .from('asientos')
    .select('id, numero, fecha, glosa, origen, asientos_lineas (debe)')
    .eq('empresa_id', activa.id)
    .order('numero', { ascending: false })
    .limit(10)

  return (
    <div>
      <Encabezado titulo="Contabilidad">
        <div className="flex items-center gap-2">
          <Link href="/contabilidad/cuentas"><Boton variante="secundario">Plan de cuentas</Boton></Link>
          <Link href="/contabilidad/asientos"><Boton variante="secundario">Ver asientos</Boton></Link>
          <Link href="/contabilidad/balance"><Boton variante="secundario">Balance</Boton></Link>
          <Link href="/contabilidad/eerr"><Boton variante="secundario">EERR</Boton></Link>
          <Link href="/contabilidad/asientos/nuevo"><Boton>Nuevo asiento</Boton></Link>
        </div>
      </Encabezado>

      <Tarjeta className="mb-4 max-w-3xl">
        <div className="flex flex-wrap items-center gap-3">
          <div className="grow">
            <h2 className="mb-1 text-lg font-semibold text-slate-800">Revisión del mes</h2>
            {revision ? (
              <p className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                <Insignia tono={TONO_ESTADO[revision.estado]}>{ETIQUETA_ESTADO[revision.estado]}</Insignia>
                {revision.observaciones.length === 0
                  ? 'El Contador Auditor no encontró observaciones.'
                  : `${revision.observaciones.length} observación${revision.observaciones.length === 1 ? '' : 'es'} este mes.`}
              </p>
            ) : (
              <p className="text-sm text-slate-500">No se pudo obtener la revisión del mes.</p>
            )}
          </div>
          <Link href="/contabilidad/revision"><Boton variante="secundario">Ver revisión</Boton></Link>
        </div>
      </Tarjeta>

      <Tarjeta className="mb-4 max-w-3xl">
        <h2 className="mb-1 text-lg font-semibold text-slate-800">Contabilizar pendientes</h2>
        <p className="mb-3 text-sm text-slate-600">
          Cada venta, compra, pago y anticipo se contabiliza solo. Si algo se emitió con el
          módulo apagado o quedó fuera, este botón crea los asientos que falten (es idempotente:
          repetirlo sin pendientes no duplica nada).
        </p>
        <BotonContabilizar accion={contabilizarPendientes} />
      </Tarjeta>

      <h2 className="mb-2 text-lg font-semibold text-slate-800">Últimos asientos</h2>
      <Tabla>
        <thead><tr><Th>N°</Th><Th>Fecha</Th><Th>Glosa</Th><Th>Origen</Th><Th className="text-right">Monto</Th></tr></thead>
        <tbody>
          {(asientos ?? []).map((a) => {
            const monto = (a.asientos_lineas ?? []).reduce((s: number, l: { debe: number }) => s + l.debe, 0)
            return (
              <Tr key={a.id}>
                <Td><Link className="text-marca-700 hover:underline" href={`/contabilidad/asientos/${a.id}`}>{a.numero}</Link></Td>
                <Td>{new Date(a.fecha + 'T00:00:00').toLocaleDateString('es-CL')}</Td>
                <Td>{a.glosa}</Td>
                <Td><Insignia tono="gris">{ETIQUETA_ORIGEN[a.origen] ?? a.origen}</Insignia></Td>
                <Td className="text-right font-mono">{formatearCLP(monto)}</Td>
              </Tr>
            )
          })}
          {(asientos ?? []).length === 0 && (
            <Tr><Td colSpan={5} className="py-8 text-center text-slate-500">Aún no hay asientos. Emite un documento o usa Contabilizar pendientes.</Td></Tr>
          )}
        </tbody>
      </Tabla>
    </div>
  )
}
```

- [ ] **Step 6: Ocultar Revertir en el asiento de cierre (pareja UI del candado de la Task 1)**

En `apps/erp/app/contabilidad/asientos/[id]/page.tsx`, reemplazar (Edit, coincidencia exacta):

```tsx
  const revertible = !esReversa && !reversa
```

por:

```tsx
  // El asiento de cierre no se revierte desde aquí: la única vía es reabrir el
  // ejercicio en /contabilidad/revision (el RPC igual lo bloquea — candado 0024).
  const revertible = !esReversa && asiento.origen !== 'cierre' && !reversa
```

- [ ] **Step 7: Verificación**

```powershell
pnpm --filter erp build
```

Salida esperada: exit 0, `✓ Compiled successfully`, y la tabla de rutas incluye `ƒ /contabilidad/revision` junto a las rutas existentes de `/contabilidad`. Sin errores de tipos (los tipos de `revision_periodo`, `cerrar_ejercicio`, `reabrir_ejercicio` y `cierres_ejercicio` ya están en `@suite/db` por la Task 4; los botones Balance y EERR de las Tasks 5-6 siguen presentes en el encabezado del resumen).

- [ ] **Step 8: Commit**

```powershell
git add apps/erp/app/contabilidad/page.tsx apps/erp/app/contabilidad/revision/ apps/erp/componentes/acciones-cierre.tsx "apps/erp/app/contabilidad/asientos/[id]/page.tsx"
git commit -m "feat(erp): revisión del período con cierre asistido y semáforo en contabilidad"
```

Salida esperada: commit creado en la rama del plan con 6 archivos (4 nuevos, 2 modificados).

---

### Task 8: Seed 2025 + pipeline verde + E2E manual del cierre asistido

**Files:**
- Modify: `scripts/seed-demo.mjs` (ÚNICO archivo de producción de esta task; el resto son comandos y verificación)

**Interfaces:**
- Consumes (ya vivos, no se re-crean): en el seed, `userCli` (cliente ANON firmado como el dueño `demo@suite-erp.cl`, paso 2), `admin` (service_role), `empresaId`, `die(msg, err)`; la RPC `crear_asiento(p_empresa uuid, p_fecha date, p_glosa text, p_lineas jsonb)` con líneas `[{cuentaId, debe, haber}]` (**camelCase — contrato P16**, 0022:527); el catálogo sembrado por `activar_contabilidad` en la sección 20 (`cuentas_contables` con `clave_sistema` `banco`/`ventas`/`compras_gastos` y `codigo` `5.1.03` Arriendos). En la BD, las RPCs del plan `cerrar_ejercicio`/`reabrir_ejercicio`/`revision_periodo` y las páginas `/contabilidad/revision`, `/contabilidad/balance`, `/contabilidad/eerr` (tasks previas).
- Produces: sección 21 del seed — **3 asientos manuales de 2025, cuadrados, SIN cerrar ningún ejercicio** (el usuario vive la aprobación en la demo, spec §6): venta contado $500.000 + gasto $200.000 + arriendo $150.000 → **utilidad 2025 esperada = $150.000** (número que la demo muestra en el cierre asistido, el balance y el EERR). Con ellos la regla 7 (`ejercicio_anterior_abierto`) dispara en cualquier mes de 2026 y el panel de cierre asistido de 2025 nace preparado.
- ESPEJO leído antes de escribir: `scripts/seed-demo.mjs` sección 20 (patrón `userCli.rpc(...)` + `die` + `console.log('✓ ...')`; la vía es **`userCli` — el dueño**: `crear_asiento` es `authenticated` con rol dueño/admin/contador; service_role daría 42501). Las fechas 2025 pasan el rango de `crear_asiento` (`>= 2000-01-01` y `<= hoy+1`) y NINGÚN cierre existe aún, así que el candado de período no aplica en el seed.

- [ ] **Step 1: Sección 21 del seed — asientos 2025**

En `scripts/seed-demo.mjs`, insertar el bloque nuevo JUSTO ANTES de la línea `// ----- Resumen de conteos -----` (queda a continuación de la sección 20 — el catálogo ya está sembrado porque `activar_contabilidad` corrió arriba):

```js
// 21) Asientos 2025 para el cierre asistido: 3 asientos manuales del año pasado,
//     cuadrados y chicos, VÍA userCli (crear_asiento es authenticated; service_role
//     daría 42501). Con movimientos 2025 sin cerrar, el Contador Auditor dispara la
//     regla ejercicio_anterior_abierto y /contabilidad/revision muestra el cierre
//     asistido de 2025 preparado (utilidad esperada $150.000 = 500.000 − 200.000 − 150.000).
//     NO se cierra ningún ejercicio aquí: la aprobación se vive en la demo (spec P17 §6).
const { data: ctasRows, error: eCtas } = await admin.from('cuentas_contables').select('id, clave_sistema, codigo').eq('empresa_id', empresaId)
if (eCtas) die('cuentas para asientos 2025', eCtas)
const porClave = Object.fromEntries(ctasRows.filter((c) => c.clave_sistema).map((c) => [c.clave_sistema, c.id]))
const ctaArriendos = ctasRows.find((c) => c.codigo === '5.1.03')?.id
if (!porClave.banco || !porClave.ventas || !porClave.compras_gastos || !ctaArriendos) die('faltan cuentas del catálogo para los asientos 2025', null)
const asientos2025 = [
  { fecha: '2025-03-14', glosa: 'Venta contado de servicios de flete', lineas: [
    { cuentaId: porClave.banco, debe: 500000, haber: 0 },
    { cuentaId: porClave.ventas, debe: 0, haber: 500000 },
  ] },
  { fecha: '2025-06-20', glosa: 'Compra de repuestos pagada por banco', lineas: [
    { cuentaId: porClave.compras_gastos, debe: 200000, haber: 0 },
    { cuentaId: porClave.banco, debe: 0, haber: 200000 },
  ] },
  { fecha: '2025-11-07', glosa: 'Arriendo de bodega de noviembre', lineas: [
    { cuentaId: ctaArriendos, debe: 150000, haber: 0 },
    { cuentaId: porClave.banco, debe: 0, haber: 150000 },
  ] },
]
for (const a of asientos2025) {
  const { error: eA25 } = await userCli.rpc('crear_asiento', { p_empresa: empresaId, p_fecha: a.fecha, p_glosa: a.glosa, p_lineas: a.lineas })
  if (eA25) die('crear_asiento 2025 (' + a.glosa + ')', eA25)
}
console.log('✓ 3 asientos manuales de 2025 (utilidad esperada $150.000) — cierre asistido de 2025 listo, ejercicio SIN cerrar')

```

No se toca el RESUMEN: la línea `asientos contables:` existente (helper `cuenta('asientos')`) ya suma los 3 nuevos.

Byte-scan del archivo modificado (JAMÁS BOM U+FEFF; imprime `0` y sale con status 1 = pass):

```bash
grep -c $'\xEF\xBB\xBF' scripts/seed-demo.mjs
```

- [ ] **Step 2: Pipeline completo**

Run desde la raíz del repo (PowerShell 5.1: separar con `;`, nunca `&&`):

```powershell
npx supabase test db
```

→ **18 archivos, 363 asserts**, todos verdes (327 de los 17 archivos previos + `plan(36)` de `estados_financieros.test.sql` — el total lo fija la Task 3).

```powershell
pnpm test
```

→ **192 tests** verdes (176 baseline + 16 de `periodo.test.ts`, fijados por la Task 6).

```powershell
pnpm --filter @suite/db gen
git diff --exit-code packages/db/src/types.ts
```

→ exit 0, **cero diff**: los tipos a mano de la Task 4 son espejo byte a byte del generador (contrato de esa task). Si hubiera diff, gana el generador: commitear su salida y volver a correr typecheck/builds.

```powershell
pnpm build --concurrency=1
```

→ **3 apps** (`web`, `erp`, `admin`) compilan sin errores. OJO gotcha conocido: este build **pisa el `.next` de los dev servers corriendos** → 500s en el browser; el Step 4 los reinicia SIEMPRE antes del checklist.

- [ ] **Step 3: Reseed de la demo (la suite pgTAP puede haberla borrado)**

```powershell
npx supabase db reset
```

→ termina con `Finished supabase db reset` (aplica las migraciones 0001..0024).

Gotcha Kong 502 tras el reset (el upstream de auth queda viejo y `/auth/v1/*` da 502 indefinidamente aunque auth esté healthy) — curarlo SIEMPRE, es barato:

```powershell
docker restart supabase_kong_ERP_Transportes; Start-Sleep -Seconds 8
```

Cargar la clave DTE desde `apps/erp/.env.local` **sin imprimirla** (la asignación a `$env:` no emite salida; NO hacer `echo` de la variable) y sembrar:

```powershell
$env:DTE_ENCRYPTION_KEY = ((Get-Content apps/erp/.env.local | ? { $_ -like 'DTE_ENCRYPTION_KEY=*' }) -split '=',2)[1]
node scripts/seed-demo.mjs
```

→ el seed corre COMPLETO (secciones 1-21, Node ≥22 del usuario por el type-stripping de la sección 19) y la salida incluye la línea nueva:

```
✓ 3 asientos manuales de 2025 (utilidad esperada $150.000) — cierre asistido de 2025 listo, ejercicio SIN cerrar
```

y en el RESUMEN `asientos contables:` sube en 3 respecto del conteo de la sección 20.

- [ ] **Step 4: Reiniciar los dev servers (`.next` pisado por el build)**

```powershell
Get-NetTCPConnection -LocalPort 3000,3001,3002 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -Confirm:$false }
try { Remove-Item -Recurse -Force apps/web/.next, apps/erp/.next, apps/admin/.next -ErrorAction Stop } catch {}
Start-Process pnpm.cmd -ArgumentList '--filter','web','dev'
Start-Process pnpm.cmd -ArgumentList '--filter','erp','dev'
Start-Process pnpm.cmd -ArgumentList '--filter','admin','dev'
```

→ tres ventanas de dev levantadas: web 3000, erp 3001, admin 3002. Esperar a que `http://localhost:3001` responda antes del checklist (primer compile de Next tarda ~10-30s). En el browser del checklist usar Ctrl+Shift+R si un chunk viejo quedó cacheado.

- [ ] **Step 5: E2E manual con Playwright MCP (checklist numerada, evidencia por punto)**

Browser vía Playwright MCP (`browser_navigate` / `browser_fill_form` / `browser_click` / `browser_snapshot`). Documentar la evidencia de CADA ítem en el reporte:

1. **Reseed ok con la sección 21**: evidencia = la salida del Step 3 contiene la línea `✓ 3 asientos manuales de 2025 ...` y el RESUMEN completo (ya capturada; citarla en el reporte).
2. **Login y card de contabilidad**: navegar `http://localhost:3000/login`, ingresar `demo@suite-erp.cl` / `demo1234`, luego navegar `http://localhost:3001/contabilidad`. Evidencia: la card/resumen muestra el **semáforo del mes actual** (estado agregado de `revision_periodo`) y un **link "Revisión"** hacia `/contabilidad/revision`.
3. **Revisión con observaciones + cierre asistido preparado**: navegar `http://localhost:3001/contabilidad/revision`. Evidencia: lista de observaciones del período visible con **al menos `ejercicio_anterior_abierto`** (regla 7, severidad media — la garantizan los 3 asientos 2025 del seed; reglas 3/5 pueden aparecer o no según los datos vivos del seed, no son exigibles), y el **panel de cierre asistido de 2025** con la preview del asiento de cierre (misma query de `cerrar_ejercicio`, sin crear nada) diciendo utilidad **$150.000** y el botón **Aprobar cierre**.
4. **Aprobar cierre → balance y EERR**: click en **Aprobar cierre**. Evidencia: el panel de cierre desaparece y la fila 2025 aparece «Cerrado» con resultado **$150.000** — este monto IGUAL al de la preview del ítem 3 es la **evidencia de equivalencia** de la preview TS con la query SQL de `cerrar_ejercicio` (seam aceptado, ver sección Seams); en `http://localhost:3001/contabilidad/balance` con ejercicio **2025** los 4 pares del 8 columnas **cuadran** (sin alerta roja) y la fila "Utilidad (o Pérdida) del ejercicio" muestra **$150.000** con el encabezado "Ganaste $150.000 en 2025"; con ejercicio **2026** el balance arrastra 2025 y sigue cuadrando (arrastre T5); en `http://localhost:3001/contabilidad/eerr` período año 2025: Ingresos $500.000 − Gastos $350.000 = **Resultado $150.000**; y en período **mes actual**, la columna Variación muestra un **% real con signo** contra el mes anterior (el seed tiene ventas del mes anterior y del actual — no debe verse `—` en el total de ingresos).
5. **Candado del ejercicio cerrado**: en `/contabilidad` crear un asiento manual con **fecha 2025** (p.ej. 2025-05-15, Debe Banco 1.000 / Haber Clientes 1.000, glosa cualquiera). Evidencia: la RPC rechaza con el mensaje byte-exacto **`El ejercicio 2025 está cerrado`** visible en la UI; el asiento NO aparece en el diario. Además, abrir el detalle del **asiento de cierre 2025** (origen «Cierre»): la card **Revertir NO aparece** (condición de la Task 7; el RPC igual lo bloquearía con `El cierre solo se deshace reabriendo el ejercicio`).
6. **Reabrir 2025**: en `/contabilidad/revision`, botón **Reabrir** de 2025 → confirmar el diálogo. Evidencia: 2025 queda reabierto (aparece la reversa del cierre ligada, fecha 31-12-2025) y **repetir el asiento manual del ítem 5 ahora SÍ entra** (aparece en el diario con fecha 2025-05-15).
7. **Vendedor no accede a Revisión**: el seed **NO crea ningún usuario con rol vendedor** (usuarios sembrados: `demo@suite-erp.cl` dueño, `ficticio2@suite-erp.cl` dueño de la 2ª org, `admin@suite-erp.cl` plataforma sin organización) — se declara explícitamente. Cobertura del flanco: el **assert pgTAP de la Task 3** (rol vendedor denegado en `revision_periodo` con `'Tu rol no permite ver la revisión'`) + el guard de página `puedeVerContabilidad` + ROLES_CONTABLES ya verificado con vendedor real en el checklist del Plan 16 (ítem 7 de P16-T10: `/contabilidad*` → 404). Evidencia: cita del assert en `estados_financieros.test.sql` en el reporte; no se navega este ítem.

Si cualquier ítem falla: defecto real → **BLOCKED** con detalle (no se maquilla el checklist).

- [ ] **Step 6: Commit**

```bash
git add scripts/seed-demo.mjs
git commit -m "feat(scripts): asientos 2025 en el seed — el cierre asistido de la demo nace preparado"
```

- [ ] **Step 7: Reporte y cleanup**

`.superpowers/sdd/task-8-plan17-report.md` con: pipeline (363 pgTAP en 18 archivos / 192 unit / 3 builds), la salida del reseed (línea de la sección 21) y el checklist E2E ítem por ítem con su evidencia (incluida la declaración del ítem 7 y la equivalencia preview = cierre real del ítem 4). Nada que borrar del scratchpad (esta task no crea scripts temporales).

---

## Seams (revisados por los lentes — los 3 abiertos quedaron FALLADOS e incorporados)

1. **Arrastre del balance (T5) — FALLADO: con arrastre.** Dictamen de los lentes: un balance de 8 columnas solo-movimientos-del-año da columnas Activo/Pasivo falsas desde el 2º ejercicio. `obtenerBalance()` suma ahora el saldo inicial por cuenta (query `lt('fecha', 1-ene)`, patrón saldo inicial del mayor), SIN excluir cierres/reversas de años anteriores (son el arrastre), con inicial deudor a Débitos y acreedor a Créditos para que los 4 pares sigan cuadrando. Incorporado en la Task 5. El EERR NO arrastra (resultado del período — correcto así, declarado en la Task 6).
2. **Cobertura pgTAP por regla (T3) — FALLADO: golden por regla.** El spec §7 exige fixture dirigido por regla: la Task 3 quedó con las 7 reglas cubiertas (a2 vencida-sin-recordatorio para la 3, a3 dic-2025 + banda 60-140% para la 4, anticipo `'recibido'` de oct-2025 para la 5, además de las 1/2/6/7 que ya estaban). `plan(36)`, suite 363.
3. **Self-link de la regla 7 — FALLADO: sin link.** `rutaEnlace('cierre')` retorna `null` (Task 4): el panel de cierre asistido vive en la misma página de Revisión; un "Ver detalle →" a la propia página era ruido. El contrato quedó declarado en Global Constraints.

Seam ACEPTADO (declarado, no se cambia):

4. **Preview del cierre re-implementada en TS (T7).** El spec §4.3 pedía "la MISMA query" del cierre; la RPC no expone una preview estructurada (spec §3.3: la observación de la regla 7 solo trae texto), así que la página calcula la preview con su propia lectura espejo de la agregación de `cerrar_ejercicio` (sin crear nada). Evidencia de equivalencia: ítems 3-4 del E2E de la Task 8 — el $ de la preview (ítem 3) debe IGUALAR el $ del cierre real (ítem 4). Si alguna vez divergen, es un bug de la preview, no del cierre.
