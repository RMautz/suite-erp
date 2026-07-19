# Plan 19 — Ciclo mensual de nómina · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute this plan task-by-task with fresh subagents in the current session (or superpowers:executing-plans in a separate session). Cada task es autocontenida: Files, Interfaces, Steps con el código completo y verificación con salida esperada. Marca los checkboxes al completar cada step. Las tasks se ejecutan EN ORDEN (1→7): hay costuras de secuencia declaradas (T1→T2 sobre el mismo archivo de test; T3→T4 sobre el typecheck de erp).

**Spec:** `docs/superpowers/specs/2026-07-19-plan19-ciclo-nomina-design.md` (aprobado por el usuario).

**Goal:** Cerrar el ciclo mensual de nómina (Fase 3 RRHH, parte 2): aportes del EMPLEADOR (SIS, cesantía patronal 2,4/3,0%, mutual ley 16.744) calculados, snapshoteados y contabilizados como costo empresa; archivo PREVIRED (TXT de 105 campos) descargable; candados de integridad diferidos del P18 (trabajador desactivado, regla 6 del auditor, tramos/tasas del admin); UI de costo empresa en preview/detalle/libro; seed con canario extendido y E2E verde. Finiquitos y vacaciones → Plan 20.

**Architecture:** SQL autoritativo + espejo TS (patrón P18). Migración 0026 (columnas nuevas + 4 re-creates verbatim-más-delta de la 0025) → pgTAP EXTIENDE `remuneraciones.test.sql` → espejo `calcularLiquidacion` reglas 9-12 + `previred.ts` nuevo en `@suite/core` + tipos a mano en `@suite/db` → UI erp (vista previa, detalle, libro, routes CSV/Previred) → Configuración erp (tasa mutual) + admin /indicadores (tasa SIS + candados) → seed + pipeline + E2E Playwright. Los goldens G1-G4 son compartidos byte a byte entre las 3 capas (pgTAP, vitest, smoke) y el canario del seed: divergencia = bug.

**Tech Stack:** Postgres/Supabase local (plpgsql security definer, RLS, grants por columna, pgTAP), monorepo pnpm TypeScript (Next.js 15 App Router × 3 apps, vitest, tipos codegen espejados a mano), Playwright MCP para el E2E manual. Windows/PowerShell 5.1 (separar comandos con `;`, nunca `&&`); byte-scans con Git Bash.

## Global Constraints

- **Tasas canónicas:** `tasa_sis 1.53` (columna nueva de `indicadores_previsionales`, backfill 1.53), `tasa_mutual 0.90` (columna nueva de `empresas`, `check between 0 and 10`), cesantía del empleador **2,4% indefinido / 3,0% plazo fijo** (constantes de ley EN el cálculo, jamás en indicadores). Base de cesantía = `min(total_imponible, round(tope_cesantia_uf × uf))` — la MISMA base topada de la regla 6 del P18. `round()` = mitad lejos del cero (Math.round es espejo fiel en ≥ 0).
- **Tabla contractual de APORTES GOLDEN** (única fuente; pgTAP, vitest, smoke y seed usan ESTOS bytes — divergencia = bug del plan, no del código):

  | Golden | Imponible | Tipo | sis_monto | cesantia_empleador_monto | mutual_monto | total_aportes |
  |---|---|---|---|---|---|---|
  | G1 | 1.000.000 | indefinido | **15300** | **24000** | **9000** | **48300** |
  | G2 | 1.409.396 | plazo fijo (3,0%) | **21564** | **42282** | **12685** | **76531** |
  | G3 | 3.441.760 | indefinido | **52659** | **82602** | **30976** | **166237** |
  | G4 | 2.709.396 | indefinido | **41454** | **65026** | **24385** | **130865** |

  Los montos P18 (imponible, descuentos, líquido) NO cambian: los aportes jamás tocan el líquido (regla 12).
- **Mensajes byte-exactos nuevos de este plan** (es-CL, con tildes):
  - RPC `emitir_liquidacion`: `El trabajador está desactivado`
  - Action erp `guardarTasaMutual`: `La tasa mutual debe ser un número entre 0 y 10 (% sobre el imponible)`
  - Nota pre-P19 del detalle de liquidación: `Liquidación emitida antes de los aportes del empleador: no incluye SIS, cesantía del empleador ni mutual.`
  - Validaciones admin de la Task 6 (contractuales para el E2E de la Task 7, plantillas exactas de `acciones.ts`):
    - `Valor no válido en {campo} (se exige un número mayor que 0)`
    - `Valor no válido en {campo} (se exige un número mayor o igual a 0)`
    - `Valor no válido en {campo} (una tasa en % no puede superar 100)`
    - `Factor no válido en el tramo {i} (se exige entre 0 y 1)`
    - `Tramo {i} no válido: desde debe ser menor que hasta`
    - `Faltan los tramos del impuesto único`
    - `El tramo 1 debe partir en desde = 0 (la tabla cubre desde la primera UTM)`
    - `Solo el último tramo puede quedar sin tope: completa hasta en el tramo {i}`
    - `Tramos {i} y {j} no contiguos: hasta del tramo {i} ({hasta}) debe ser igual a desde del tramo {j} ({desde})`
    - `El último tramo debe quedar sin tope (deja hasta vacío)`
- **Conteos contractuales:** pgTAP **392 + 7 = 399 asserts en 19 archivos** (`remuneraciones.test.sql` `plan(29)` → `plan(36)`; ningún archivo nuevo). Unit **204 + 10 = 214** (core 154 → 164, 1 archivo nuevo `previred.test.ts`). **Tras la Task 1 la suite queda verde en 392/19** (T1 parchea, no extiende); tras la Task 2 queda en 399/19.
- **Catálogo contable:** **31 cuentas / 16 claves de sistema / 5 grupos**. Anclas nuevas: `'5.1.06' Leyes sociales` (gasto, clave `gasto_leyes_sociales`) y `'2.1.07' Leyes sociales por pagar` (pasivo, clave `leyes_sociales_por_pagar`).
- **Asiento de remuneración:** 5 líneas — debe `gasto_remuneraciones` (imponible + no imponibles) + `gasto_leyes_sociales` (total_aportes); haber `remuneraciones_por_pagar` (líquido) + `retenciones_por_pagar` (descuentos) + `leyes_sociales_por_pagar` (total_aportes). Con `total_aportes = 0` (catch-up pre-P19) el filtro `debe > 0 or haber > 0` omite las 2 nuevas → asiento de 3 líneas P18.
- **Firma nueva del espejo (fijada por la Task 3, consumida por las Tasks 4-5):** `calcularLiquidacion(contrato: ContratoCalculo, indicadores: IndicadoresPeriodo, inputs: InputsLiquidacion, tasaMutual: number): ResultadoLiquidacion` — `tasa_sis` entra en `IndicadoresPeriodo`; `ContratoCalculo` e `InputsLiquidacion` NO cambian; `ResultadoLiquidacion` gana `sis_monto`/`cesantia_empleador_monto`/`mutual_monto`/`total_aportes`. `generarPrevired(filas: FilaPrevired[]): string` — TXT de 105 campos `;` por línea, CRLF, SIN BOM; `FilaPrevired` incluye `periodo: string` ('AAAA-MM').
- **Secuencia T1→T2 sobre `remuneraciones.test.sql` (regla del plan):** la Task 1 aplica los parches MÍNIMOS para que la suite quede verde en 392/19 inmediatamente tras su commit (assert 1: `'14/3'` → `'16/3'`; assert 27: golden del asiento G1 a 5 líneas; `plan(29)` intacto). La Task 2 después EXTIENDE (plan(36), 7 asserts nuevos, fixture Rosa, contador `'4/4/4'` → `'5/5/4'`, re-parche del assert 1 `'16/3'` → `'16/5'`). **Los `old_string` de la Task 2 sobre asserts ya parchados son los NEW de la Task 1** — si no calzan, la Task 1 no corrió o divergió: STOP, no improvisar.
- **Secuencia T3→T4 (orden de builds):** la firma nueva de `calcularLiquidacion` ROMPE el typecheck de `apps/erp` hasta que la Task 4 ajuste el consumidor. La Task 3 NO corre `pnpm build` (su verificación: vitest + `tsc --noEmit` de los paquetes db/core); la Task 4 corre `pnpm --filter erp build` y cierra la costura.
- **Bytes:** todo archivo nuevo/modificado UTF-8 SIN BOM (el único BOM legítimo del repo es el escape de `filasACsv`; el TXT Previred va SIN BOM). Comentarios SQL en ASCII sin tildes; strings de usuario con tildes.
- Commits por task, mensajes en español, coautoría `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## Contexto verificado (por el ensamblador — no repetir esta investigación)

- **`supabase/tests/database/remuneraciones.test.sql` real:** `plan(29)` en línea 3; assert 1 en líneas 55-66 con golden `'14/3'`; assert 18 (contador `'4/4/4'`) en líneas 302-309; assert 27 (asiento G1 de 3 líneas) en líneas 430-446; fixture de indicadores (INSERT + ON CONFLICT) en líneas 29-45. **Todos los `old_string` P18 de las Tasks 1-2 calzan byte a byte con el archivo real.**
- **Semántica del assert 1 (`'14/3'`):** el primer número cuenta las claves de sistema del catálogo de la empresa (14 → 16 tras la 0026); el segundo cuenta cuántas de las anclas de remuneraciones LISTADAS en el `in (...)` son hojas (`acepta_movimientos`) — 3 en P18; la Task 2 amplía la lista a 5. NO cuenta grupos ni líneas de asiento.
- **grep `'14/` en `supabase/tests` = exactamente 3 hits:** `contabilidad.test.sql:85` (`'14/true'`), `estados_financieros.test.sql:67` (`'14/patrimonio:true'`), `remuneraciones.test.sql:64` (`'14/3'`). Los 3 los parchea la Task 1. `contabilidad.test.sql:438` espera `0` (RLS del vendedor): no depende del tamaño del catálogo.
- **Regla 6 de `revision_periodo` en la 0025 real (líneas 986-1016):** `cross join lateral (select case a.origen … end as fecha_doc)` con ramas venta/nota_credito/compra/pago/pago_proveedor/anticipo + filtro `and a.origen in ('venta', 'nota_credito', 'compra', 'pago', 'pago_proveedor', 'anticipo')` (línea 1006). El delta de la Task 1 (rama `'remuneracion'` en el case + `, 'remuneracion'` en el filtro) es consistente byte a byte con ese cuerpo.
- **RUT de Rosa `198765430` (DV 0, módulo 11):** grep = **0 colisiones** en todo el repo (tests, seed, E2E, apps).
- **Seed real `scripts/seed-demo.mjs`:** el bloque ANTES del canario G1 de la Task 7 (líneas 521-525) es verbatim del archivo actual; el assert `(pendRem?.creados ?? 0) !== 3` (línea 530) sigue válido (mismos 3 asientos, ahora de 5 líneas).
- **La 0025 siembra indicadores 2026-05/06/07** (uf 39050/39200/39350; IMM, topes, tasas AFP y tramos COMPARTIDOS por los 3 meses — línea 190). Por eso el E2E de la Task 7 puede emitir en 2026-07 y obtener los MISMOS montos golden (G1/G2 están bajo tope; sis/cesantía/mutual dependen del imponible y las tasas, no de la UF).
- **La 0026 (Task 1) SÍ incluye los snapshots `liquidaciones.tasa_sis` y `liquidaciones.tasa_mutual`** (`numeric not null default 0`, spec §2): la costura del detalle de la Task 4 (`liq.tasa_mutual`, `liq.tasa_sis`) está CERRADA.
- **`packages/db` y `packages/core` tienen `tsconfig.json` propio** (ningún script `typecheck` existe): la verificación de la Task 3 usa `npx tsc --noEmit -p <paquete>/tsconfig.json`. El typecheck de `apps/erp` queda ROTO entre la Task 3 y la Task 4 (declarado en ambas).
- **`apps/erp/app/configuracion/modulos/acciones.ts`** ya importa `revalidatePath`/`crearClienteServidor`/`obtenerEmpresaActiva`/`EstadoForm` (líneas 3-6): la action nueva de la Task 6 no suma imports.
- **`apps/admin/app/indicadores/page.tsx`:** las 5 anclas de edición de la Task 6 existen (tipo `Periodo` línea 15, input `tope_cesantia_uf` línea 57, `<Th>Topes imp./ces. (UF)</Th>` línea 131, celda línea 144).
- **Aritmética del ítem 5 del E2E (Task 7) verificada:** mutual con tasa editada 2,00 sobre el imponible G2 1.409.396 = `round(28.187,92)` = **28.188** (con 0,90 sería 12.685, el golden). Coherente con el escenario.

---
### Task 1: Migración 0026 — aportes del empleador: tasas SIS/mutual, snapshot de aportes, 2 anclas contables y re-creates

Baseline verde que esta task DEBE mantener: pgTAP **392 asserts / 19 archivos**, unit 204, 3 builds (unit y builds no se tocan: task 100% BD).

**Files:**
- Create: `supabase/migrations/00000000000026_ciclo_nomina.sql`
- Modify: `supabase/tests/database/contabilidad.test.sql` (assert 1: `'14/true'` → `'16/true'`)
- Modify: `supabase/tests/database/estados_financieros.test.sql` (assert 1: `'14/patrimonio:true'` → `'16/patrimonio:true'`)
- Modify: `supabase/tests/database/remuneraciones.test.sql` (assert 1: `'14/3'` → `'16/3'`; assert 27: el asiento de la G1 re-emitida pasa a 5 líneas — sin este parche la suite se ROMPE, ver Contexto)
- Create (validación, no comiteado): `.superpowers/sdd/smoke-p19-t1.sql`

**Interfaces:**
- **Secuencia con la Task 2 (regla del plan, Global Constraints):** esta task aplica SOLO los parches MÍNIMOS de `remuneraciones.test.sql` (assert 1 → `'16/3'`, assert 27 → golden de 5 líneas) y deja la suite verde en **392/19** inmediatamente tras su commit. La Task 2 EXTIENDE después ese archivo (plan(36), `'16/3'` → `'16/5'`, 7 asserts nuevos) tomando como `old_string` los NEW de esta task. NO agregar aquí nada más que los 4 parches del Step 2.
- Consumes: cuerpos VIGENTES de la 0025 (son los que se re-crean; JAMÁS los de 0022/0024): `emitir_liquidacion` 0025:350-487, `activar_contabilidad` 0025:285-338 (catálogo real 0025:296-332 — de ahí salen los códigos libres de las 2 anclas nuevas), `contabilizar_documento` 0025:550-742, `revision_periodo` 0025:814-1055. Patrón de grant UPDATE por columna: `factor_volumetrico` 0016:21-22. `app._fecha_contable` y `app._insertar_asiento` (0024) NO se tocan, solo se invocan. `app.tiene_rol_en_empresa` (0003).
- Produces (firmas exactas):
  - `indicadores_previsionales.tasa_sis numeric(5, 2) not null default 1.53` — el `add column` con default backfillea los períodos existentes a 1.53 (spec §2).
  - `empresas.tasa_mutual numeric(4, 2) not null default 0.90` con `check (tasa_mutual between 0 and 10)` (constraint auto-nombrado `empresas_tasa_mutual_check`) + `grant update (tasa_mutual) on public.empresas to authenticated` (la policy de fila 0001 sigue limitando a dueño/admin).
  - `liquidaciones.sis_monto integer not null default 0`, `liquidaciones.cesantia_empleador_monto integer not null default 0`, `liquidaciones.mutual_monto integer not null default 0`, `liquidaciones.total_aportes integer not null default 0`, `liquidaciones.tasa_sis numeric(5, 2) not null default 0`, `liquidaciones.tasa_mutual numeric(4, 2) not null default 0` (las pre-P19 quedan en 0 — límite declarado del spec §2).
  - `public.emitir_liquidacion(p_empresa uuid, p_trabajador uuid, p_periodo text, p_dias integer, p_extras integer, p_no_imponibles integer) returns uuid` — MISMA firma; gana reglas 9-12 (spec §3), el raise nuevo `'El trabajador está desactivado'` y los snapshots `tasa_sis`/`tasa_mutual`.
  - `public.activar_contabilidad(p_empresa uuid) returns void` — catálogo **31 cuentas / 16 claves / 5 grupos**; anclas nuevas: `'5.1.06' Leyes sociales` (gasto, clave `gasto_leyes_sociales`) y `'2.1.07' Leyes sociales por pagar` (pasivo, clave `leyes_sociales_por_pagar`) — códigos libres fijados mirando el catálogo real 0025 (grupo 5 termina en 5.1.05; grupo 2 en 2.1.06).
  - `public.contabilizar_documento(p_empresa uuid, p_origen text, p_referencia uuid) returns text` — rama `'remuneracion'` de 5 líneas (spec §4); con `total_aportes = 0` el filtro `debe > 0 or haber > 0` omite las 2 nuevas y el asiento queda como en P18.
  - `public.revision_periodo(p_empresa uuid, p_anio integer, p_mes integer) returns jsonb` — la regla 6 gana el origen `'remuneracion'` (fecha del documento = último día del mes del período).
- Mensaje nuevo byte-exacto (minor diferido P18, fijado por el spec §3): `'El trabajador está desactivado'`.

**Contexto verificado (no repetir esta investigación al ejecutar):**

- Los asserts que cuentan anclas son EXACTAMENTE tres (grep `'14/'` sobre `supabase/tests` = 3 hits): `contabilidad.test.sql:85` (`'14/true'`), `estados_financieros.test.sql:67` (`'14/patrimonio:true'`), `remuneraciones.test.sql:64` (`'14/3'`). `contabilidad.test.sql:438` suma counts pero espera `0` (RLS del vendedor) — no depende del tamaño del catálogo.
- **Cuarto parche OBLIGATORIO** (no es un conteo de anclas, pero sin él la suite muere): `remuneraciones.test.sql:444` — el assert 27 verifica el asiento de la **G1 re-emitida** (assert 25), que tras la 0026 nace CON aportes (`total_aportes = 48300 > 0`) → su asiento pasa de 3 a 5 líneas. Los goldens 12-16 y el resto del archivo NO cambian (leen columnas que siguen intactas); el assert 26 sigue en `'critica/4 …'`; `plan(29)` NO cambia → la suite sigue en 392.
- **`contabilizar_pendientes` NO se re-crea:** su union ya trae la rama de liquidaciones desde 0025 (0025:788-790) y no lee columnas nuevas.
- La regla 6 de `revision_periodo` NO usa un union: arma la fecha del documento con un `cross join lateral (select case a.origen … end as fecha_doc)` (0025:993-1002) más un filtro `a.origen in (…)` (0025:1006). **Delta exacto** (2 ediciones dentro del cuerpo, el resto byte a byte desde 0025):
  1. El `case` gana la rama (antes de `end as fecha_doc`):
     ```sql
        when 'remuneracion'   then (select (to_date(l.periodo || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date
                                    from liquidaciones l   where l.id = a.referencia_id and l.empresa_id = a.empresa_id)
     ```
  2. `and a.origen in ('venta', 'nota_credito', 'compra', 'pago', 'pago_proveedor', 'anticipo')` → se suma `, 'remuneracion'` al final de la lista.
- **Orden de validación en `emitir_liquidacion` (obligatorio):** rol → formato de período → **trabajador activo** → contrato vigente → indicadores/tasa AFP → duplicada. Un trabajador INEXISTENTE no lanza el mensaje nuevo: el `select activo` no encuentra fila y cae al mensaje P18 `'El trabajador no tiene contrato vigente'` (comportamiento preservado byte a byte).
- Las 2 anclas nuevas NO tienen fila prístina del seed que reclamar (`'Leyes sociales'` jamás existió en catálogos previos): el backfill es **solo insert código-libre** (patrón `retenciones_por_pagar` 0025:243-255). JAMÁS `on conflict do nothing`.
- `asientos` y `liquidaciones` no tienen triggers (grep `create trigger` en migraciones = 0): la inmutabilidad es por grants → el smoke puede simular una liquidación pre-P19 y un asiento tardío como superuser.

**Aritmética de la capa de aportes de los 4 goldens (fuente única; pgTAP, core, seed y smoke usan ESTOS bytes):**

Constantes canónicas: `tasa_sis 1.53` (indicadores), `tasa_mutual 0.90` (empresa), cesantía empleador `2.4%` indefinido / `3.0%` plazo fijo (constantes de ley en el cálculo). Base de cesantía = `min(total_imponible, round(131.9 × 39200)) = min(imponible, 5170480)` — la MISMA base topada de la regla 6 del P18. `round()` = mitad lejos del cero.

**G1** (imponible 1000000, indefinido):
- `sis = round(1000000 × 1.53 / 100) = round(15300)` = **15300**
- `ces_emp = round(min(1000000, 5170480) × 2.4 / 100) = round(24000)` = **24000**
- `mutual = round(1000000 × 0.90 / 100) = round(9000)` = **9000**
- `total_aportes = 15300 + 24000 + 9000` = **48300**

**G2** (imponible 1409396, plazo fijo — SÍ cotiza cesantía patronal, al 3.0%):
- `sis = round(1409396 × 1.53 / 100) = round(21563.7588)` = **21564**
- `ces_emp = round(min(1409396, 5170480) × 3.0 / 100) = round(42281.88)` = **42282**
- `mutual = round(1409396 × 0.90 / 100) = round(12684.564)` = **12685**
- `total_aportes = 21564 + 42282 + 12685` = **76531**

**G3** (imponible 3441760 — topado en 87.8 UF —, indefinido):
- `sis = round(3441760 × 1.53 / 100) = round(52658.928)` = **52659**
- `ces_emp = round(min(3441760, 5170480) × 2.4 / 100) = round(82602.24)` = **82602**
- `mutual = round(3441760 × 0.90 / 100) = round(30975.84)` = **30976**
- `total_aportes = 52659 + 82602 + 30976` = **166237**

**G4** (imponible 2709396, indefinido):
- `sis = round(2709396 × 1.53 / 100) = round(41453.7588)` = **41454**
- `ces_emp = round(min(2709396, 5170480) × 2.4 / 100) = round(65025.504)` = **65026**
- `mutual = round(2709396 × 0.90 / 100) = round(24384.564)` = **24385**
- `total_aportes = 41454 + 65026 + 24385` = **130865**

Cuadratura del asiento G1 de 5 líneas (no imponibles 50000): debe `1050000 + 48300 = 1098300` = haber `861300 + 188700 + 48300 = 1098300`. ✓ Los montos P18 (imponible, descuentos, líquido) NO cambian: los aportes jamás tocan el líquido (regla 12).

- [ ] **Step 1: Escribir la migración**

`supabase/migrations/00000000000026_ciclo_nomina.sql` (Write tool, UTF-8 SIN BOM; comentarios ASCII sin tildes, mensajes de usuario con tildes):

```sql
-- Ciclo de nomina (Plan 19), Task 1: aportes del EMPLEADOR (SIS, cesantia
-- patronal 2,4%/3,0% y mutual ley 16.744) como costo empresa. tasa_sis vive en
-- indicadores_previsionales (varia por licitacion; backfill 1.53), tasa_mutual
-- en empresas (0-10, default 0.90, grant de UPDATE por columna patron 0016);
-- liquidaciones gana el snapshot de aportes y de tasas (not null default 0:
-- las pre-P19 quedan en 0, limite declarado del spec §2). Se re-crean
-- emitir_liquidacion (reglas 9-12 + trabajador activo + snapshots),
-- activar_contabilidad (2 anclas nuevas -> 31 cuentas / 16 claves / 5 grupos),
-- contabilizar_documento (rama remuneracion de 5 lineas; con total_aportes = 0
-- las 2 nuevas se omiten y queda el asiento P18) y revision_periodo (la regla
-- 6 gana el origen 'remuneracion'). contabilizar_pendientes NO cambia: su
-- union ya trae la rama de liquidaciones desde 0025.

-- ---------- indicadores_previsionales: tasa SIS (% sobre imponible) ----------
-- Varia por licitacion; el admin de plataforma la mantiene junto al resto del
-- periodo. El add column con default backfillea los periodos existentes a 1.53.
alter table public.indicadores_previsionales
  add column tasa_sis numeric(5, 2) not null default 1.53;

-- ---------- empresas: tasa mutual ley 16.744 (base 0,90 + adicional por actividad) ----------
alter table public.empresas
  add column tasa_mutual numeric(4, 2) not null default 0.90
    check (tasa_mutual between 0 and 10);
-- Grant de UPDATE por COLUMNA (patron factor_volumetrico 0016): la policy
-- "duenos editan empresas" (0001) sigue filtrando la FILA a dueno/admin.
grant update (tasa_mutual) on public.empresas to authenticated;

-- ---------- liquidaciones: snapshot de aportes del empleador ----------
-- Todo not null default 0: las liquidaciones pre-P19 quedan en 0 (limite
-- declarado del spec §2; la UI muestra la nota "emitida antes de los
-- aportes"). tasa_sis/tasa_mutual son snapshot de CONTEXTO (auditabilidad,
-- patron tasa_afp 0025): la liquidacion se explica sola aunque cambien la
-- licitacion del SIS o la tasa mutual de la empresa.
alter table public.liquidaciones
  add column sis_monto integer not null default 0,
  add column cesantia_empleador_monto integer not null default 0,
  add column mutual_monto integer not null default 0,
  add column total_aportes integer not null default 0,
  add column tasa_sis numeric(5, 2) not null default 0,
  add column tasa_mutual numeric(4, 2) not null default 0;

-- ---------- Backfill: las 2 anclas nuevas en empresas ya activas ----------
-- Ninguna tiene fila pristina del seed que reclamar ('Leyes sociales' /
-- 'Leyes sociales por pagar' jamas existieron en catalogos previos): solo
-- insert codigo-libre por empresa (patron retenciones_por_pagar 0025; JAMAS
-- on conflict do nothing -- dejaria empresas sin ancla y contabilizar
-- reventaria).
insert into public.cuentas_contables (empresa_id, codigo, nombre, tipo, acepta_movimientos, clave_sistema)
select e.id,
       (select '5.1.0' || n from generate_series(6, 99) as n
        where not exists (select 1 from public.cuentas_contables c2
                          where c2.empresa_id = e.id and c2.codigo = '5.1.0' || n)
        order by n limit 1),
       'Leyes sociales', 'gasto', true, 'gasto_leyes_sociales'
from public.empresas e
where exists (select 1 from public.cuentas_contables c
              where c.empresa_id = e.id and c.clave_sistema is not null)
  and not exists (select 1 from public.cuentas_contables c
                  where c.empresa_id = e.id and c.clave_sistema = 'gasto_leyes_sociales');

insert into public.cuentas_contables (empresa_id, codigo, nombre, tipo, acepta_movimientos, clave_sistema)
select e.id,
       (select '2.1.0' || n from generate_series(6, 99) as n
        where not exists (select 1 from public.cuentas_contables c2
                          where c2.empresa_id = e.id and c2.codigo = '2.1.0' || n)
        order by n limit 1),
       'Leyes sociales por pagar', 'pasivo', true, 'leyes_sociales_por_pagar'
from public.empresas e
where exists (select 1 from public.cuentas_contables c
              where c.empresa_id = e.id and c.clave_sistema is not null)
  and not exists (select 1 from public.cuentas_contables c
                  where c.empresa_id = e.id and c.clave_sistema = 'leyes_sociales_por_pagar');

-- ---------- RE-CREATE activar_contabilidad (VERBATIM 0025 + 2 anclas) ----------
-- Cambios contra 0025: filas nuevas '2.1.07' Leyes sociales por pagar
-- (leyes_sociales_por_pagar) y '5.1.06' Leyes sociales (gasto_leyes_sociales).
-- El catalogo queda en 31 cuentas / 16 claves / 5 grupos.
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
      (p_empresa, '2.1.04', 'Remuneraciones por pagar',   'pasivo',     true,  'remuneraciones_por_pagar'),
      (p_empresa, '2.1.05', 'Impuestos por pagar',        'pasivo',     true,  null),
      (p_empresa, '2.1.06', 'Retenciones previsionales por pagar', 'pasivo', true, 'retenciones_por_pagar'),
      (p_empresa, '2.1.07', 'Leyes sociales por pagar',   'pasivo',     true,  'leyes_sociales_por_pagar'),
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
      (p_empresa, '5.1.02', 'Remuneraciones',             'gasto',      true,  'gasto_remuneraciones'),
      (p_empresa, '5.1.03', 'Arriendos',                  'gasto',      true,  null),
      (p_empresa, '5.1.04', 'Servicios básicos',          'gasto',      true,  null),
      (p_empresa, '5.1.05', 'Gastos generales',           'gasto',      true,  null),
      (p_empresa, '5.1.06', 'Leyes sociales',             'gasto',      true,  'gasto_leyes_sociales');
  end if;

  update empresas set modulo_contabilidad = true where id = p_empresa;
end $$;
revoke execute on function public.activar_contabilidad(uuid) from anon, public;
grant execute on function public.activar_contabilidad(uuid) to authenticated;

-- ---------- RE-CREATE emitir_liquidacion (VERBATIM 0025 + reglas 9-12 + trabajador activo) ----------
-- Cambios contra 0025: (a) valida trabajador ACTIVO tras el formato del
-- periodo y ANTES del contrato vigente ('El trabajador está desactivado';
-- inexistente NO lanza aqui: cae al mensaje de contrato, comportamiento P18);
-- (b) lee empresas.tasa_mutual; (c) reglas 9-12 del spec §3 (los aportes
-- JAMAS tocan el liquido); (d) el insert snapshotea aportes y tasas.
create or replace function public.emitir_liquidacion(
  p_empresa uuid, p_trabajador uuid, p_periodo text,
  p_dias integer, p_extras integer, p_no_imponibles integer
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_con record;
  v_ind record;
  v_activo boolean;
  v_tasa_mutual numeric;
  v_dias integer := coalesce(p_dias, 30);
  v_extras integer := coalesce(p_extras, 0);
  v_no_imp integer := coalesce(p_no_imponibles, 0);
  v_tasa numeric;
  v_proporcional integer;
  v_gratificacion integer;
  v_imponible integer;
  v_afp integer;
  v_salud integer;
  v_cesantia integer;
  v_base integer;
  v_tramo record;
  v_impuesto integer;
  v_descuentos integer;
  v_liquido integer;
  v_sis integer;
  v_ces_emp integer;
  v_mutual integer;
  v_aportes integer;
  v_id uuid;
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'contador']) then
    raise exception 'Tu rol no permite emitir liquidaciones';
  end if;
  if p_periodo is null or p_periodo !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Período no válido';
  end if;

  -- Trabajador ACTIVO (minor diferido P18): un desactivado no genera nuevas
  -- liquidaciones. Inexistente NO lanza aqui: el select no encuentra fila y
  -- cae al mensaje de contrato vigente (comportamiento P18 intacto).
  select activo into v_activo
  from trabajadores
  where empresa_id = p_empresa and id = p_trabajador;
  if found and not v_activo then
    raise exception 'El trabajador está desactivado';
  end if;

  -- Contrato vigente (a lo mas uno: contratos_vigente_idx).
  select * into v_con
  from contratos
  where empresa_id = p_empresa and trabajador_id = p_trabajador and vigente;
  if not found then
    raise exception 'El trabajador no tiene contrato vigente';
  end if;

  select * into v_ind from indicadores_previsionales where periodo = p_periodo;
  if not found then
    raise exception 'No hay indicadores previsionales para el período';
  end if;
  -- Tasa del jsonb segun la AFP del contrato; un periodo sin esa tasa esta
  -- incompleto => mismo mensaje fail-closed.
  v_tasa := (v_ind.tasas_afp ->> v_con.afp)::numeric;
  if v_tasa is null then
    raise exception 'No hay indicadores previsionales para el período';
  end if;

  -- Tasa mutual de la EMPRESA (ley 16.744, configurable; not null default 0.90).
  select tasa_mutual into v_tasa_mutual from empresas where id = p_empresa;

  -- Chequeo amable ANTES de calcular; el unique parcial es el backstop atomico.
  if exists (
    select 1 from liquidaciones
    where empresa_id = p_empresa and trabajador_id = p_trabajador
      and periodo = p_periodo and estado <> 'anulada'
  ) then
    raise exception 'Ya existe una liquidación de ese período';
  end if;

  -- Regla 1: sueldo proporcional a los dias trabajados (mes comercial de 30).
  v_proporcional := round(v_con.sueldo_base::numeric * v_dias / 30);
  -- Regla 2: gratificacion legal 25% con tope 4,75 IMM anual / 12.
  if v_con.gratificacion_legal then
    v_gratificacion := least(
      round(0.25 * (v_proporcional + v_extras)),
      round(4.75 * v_ind.ingreso_minimo / 12));
  else
    v_gratificacion := 0;
  end if;
  -- Regla 3: imponible topado (87,8 UF).
  v_imponible := least(
    v_proporcional + v_extras + v_gratificacion,
    round(v_ind.tope_imponible_uf * v_ind.uf));
  -- Regla 4: AFP (tasa % total con comision, del jsonb).
  v_afp := round(v_imponible * v_tasa / 100);
  -- Regla 5: salud 7% Fonasa; en Isapre el plan pactado en UF es un PISO.
  if v_con.salud = 'fonasa' then
    v_salud := round(v_imponible * 0.07);
  else
    v_salud := greatest(round(0.07 * v_imponible), round(v_con.plan_isapre_uf * v_ind.uf));
  end if;
  -- Regla 6: cesantia 0,6% solo indefinido, base topada a 131,9 UF.
  if v_con.tipo = 'indefinido' then
    v_cesantia := round(least(v_imponible, round(v_ind.tope_cesantia_uf * v_ind.uf)) * 0.006);
  else
    v_cesantia := 0;
  end if;
  -- Regla 7: impuesto unico por tramos UTM SEMIABIERTOS (desde < base <= hasta;
  -- la base exactamente en la frontera cae al tramo inferior). Sin tramo
  -- (base <= 0, borde teorico) o factor 0 => impuesto 0; minimo 0 siempre.
  v_base := v_imponible - v_afp - v_salud - v_cesantia;
  select (t.tramo ->> 'factor')::numeric as factor,
         (t.tramo ->> 'rebaja_utm')::numeric as rebaja_utm
  into v_tramo
  from jsonb_array_elements(v_ind.tramos_impuesto) as t(tramo)
  where v_base > (t.tramo ->> 'desde_utm')::numeric * v_ind.utm
    and (t.tramo ->> 'hasta_utm' is null
         or v_base <= (t.tramo ->> 'hasta_utm')::numeric * v_ind.utm);
  v_impuesto := greatest(coalesce(round(v_base * v_tramo.factor - v_tramo.rebaja_utm * v_ind.utm), 0)::integer, 0);
  -- Regla 8: totales.
  v_descuentos := v_afp + v_salud + v_cesantia + v_impuesto;
  v_liquido := v_imponible + v_no_imp - v_descuentos;
  -- Guard fail-closed (Global Constraints): pocos dias trabajados + plan Isapre
  -- como piso pueden dar liquido < 0; contabilizar_documento filtraria la linea
  -- (haber <= 0), el asiento naceria descuadrado y contabilizar_pendientes
  -- reventaria en cada catch-up (cola envenenada). Se rechaza antes de insertar.
  if v_liquido < 0 then
    raise exception 'El líquido no puede ser negativo: revisa los días trabajados y los descuentos';
  end if;

  -- Regla 9: SIS de cargo del empleador (% sobre imponible; tasa del periodo).
  v_sis := round(v_imponible * v_ind.tasa_sis / 100);
  -- Regla 10: cesantia del EMPLEADOR sobre la MISMA base topada de la regla 6;
  -- a diferencia del trabajador, plazo fijo SI cotiza (3,0% vs 2,4%).
  if v_con.tipo = 'indefinido' then
    v_ces_emp := round(least(v_imponible, round(v_ind.tope_cesantia_uf * v_ind.uf)) * 2.4 / 100);
  else
    v_ces_emp := round(least(v_imponible, round(v_ind.tope_cesantia_uf * v_ind.uf)) * 3.0 / 100);
  end if;
  -- Regla 11: mutual ley 16.744 (tasa de la empresa).
  v_mutual := round(v_imponible * v_tasa_mutual / 100);
  -- Regla 12: total de aportes -- costo empresa; JAMAS toca el liquido.
  v_aportes := v_sis + v_ces_emp + v_mutual;

  begin
    insert into liquidaciones (
      empresa_id, trabajador_id, contrato_id, periodo, estado,
      dias_trabajados, extras_imponibles, no_imponibles,
      sueldo_proporcional, gratificacion, total_imponible,
      afp_monto, salud_monto, cesantia_monto, impuesto_unico,
      total_descuentos, liquido,
      sis_monto, cesantia_empleador_monto, mutual_monto, total_aportes,
      sueldo_base, afp, tasa_afp, salud, plan_isapre_uf, uf, utm,
      tasa_sis, tasa_mutual, emitida_en)
    values (
      p_empresa, p_trabajador, v_con.id, p_periodo, 'emitida',
      v_dias, v_extras, v_no_imp,
      v_proporcional, v_gratificacion, v_imponible,
      v_afp, v_salud, v_cesantia, v_impuesto,
      v_descuentos, v_liquido,
      v_sis, v_ces_emp, v_mutual, v_aportes,
      v_con.sueldo_base, v_con.afp, v_tasa, v_con.salud, v_con.plan_isapre_uf,
      v_ind.uf, v_ind.utm,
      v_ind.tasa_sis, v_tasa_mutual, now())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Ya existe una liquidación de ese período';
  end;
  return v_id;
end $$;
revoke execute on function public.emitir_liquidacion(uuid, uuid, text, integer, integer, integer) from anon, public;
grant execute on function public.emitir_liquidacion(uuid, uuid, text, integer, integer, integer) to authenticated;

-- ---------- RE-CREATE contabilizar_documento (VERBATIM 0025 + aportes en la rama 'remuneracion') ----------
-- Cambios contra 0025: la rama 'remuneracion' suma total_aportes al select y
-- gana 2 lineas: debe Gasto leyes sociales(total_aportes) / haber Leyes
-- sociales por pagar(total_aportes). Sigue cuadrando por construccion; con
-- total_aportes = 0 (liquidaciones pre-P19 en catch-up) el filtro
-- debe > 0 or haber > 0 las omite y el asiento queda como en P18.
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
  v_liq record;
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

  elsif p_origen = 'remuneracion' then
    -- Liquidacion emitida o pagada; anulada (o borrador futuro) -> noop.
    select periodo, trabajador_id, total_imponible, no_imponibles, total_descuentos, liquido, total_aportes
    into v_liq
    from liquidaciones
    where id = p_referencia and empresa_id = p_empresa and estado in ('emitida', 'pagada')
    for update;
    if not found then return 'noop'; end if;
    -- Fecha = ultimo dia del mes del periodo (el clamp compartido la pasa
    -- despues por app._fecha_contable).
    v_fecha := (to_date(v_liq.periodo || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date;
    v_glosa := 'Liquidación de sueldo ' || v_liq.periodo || ' ' ||
      (select nombre from trabajadores where id = v_liq.trabajador_id and empresa_id = p_empresa);
    -- Debe Gasto remuneraciones(imponible + no imponibles) + Gasto leyes
    -- sociales(total_aportes) / Haber Remuneraciones por pagar(liquido) +
    -- Retenciones por pagar(descuentos) + Leyes sociales por pagar(aportes).
    -- Con total_aportes = 0 (pre-P19) el filtro omite las lineas 2 y 5.
    select coalesce(jsonb_agg(jsonb_build_object('cuentaId', cuenta, 'debe', debe, 'haber', haber) order by ord), '[]'::jsonb)
    into v_lineas
    from (
                    select 1 as ord, (select id from cuentas_contables where empresa_id = p_empresa and clave_sistema = 'gasto_remuneraciones')     as cuenta, (v_liq.total_imponible + v_liq.no_imponibles) as debe, 0 as haber
      union all select 2,          (select id from cuentas_contables where empresa_id = p_empresa and clave_sistema = 'gasto_leyes_sociales'),      v_liq.total_aportes, 0
      union all select 3,          (select id from cuentas_contables where empresa_id = p_empresa and clave_sistema = 'remuneraciones_por_pagar'),            0, v_liq.liquido
      union all select 4,          (select id from cuentas_contables where empresa_id = p_empresa and clave_sistema = 'retenciones_por_pagar'),               0, v_liq.total_descuentos
      union all select 5,          (select id from cuentas_contables where empresa_id = p_empresa and clave_sistema = 'leyes_sociales_por_pagar'),            0, v_liq.total_aportes
    ) s where debe > 0 or haber > 0;

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

-- ---------- RE-CREATE revision_periodo (VERBATIM 0025 + regla 6 con 'remuneracion') ----------
-- Unico cambio contra 0025: el case de la regla 6 gana la rama 'remuneracion'
-- (fecha del documento = ultimo dia del mes del periodo de la liquidacion, la
-- MISMA expresion de contabilizar_documento) y el filtro de origenes la suma.
-- Reglas 1-5 y 7, estado final, revoke y grant: byte a byte desde 0025.
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
    union all select 'remuneracion', l.id, (to_date(l.periodo || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date
    from liquidaciones l
    where l.empresa_id = p_empresa and l.estado in ('emitida', 'pagada')
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
  -- fecha por origen que contabilizar_documento (P19: se suma 'remuneracion',
  -- fecha del documento = ultimo dia del mes del periodo de la liquidacion).
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
        when 'remuneracion'   then (select (to_date(l.periodo || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date
                                    from liquidaciones l   where l.id = a.referencia_id and l.empresa_id = a.empresa_id)
      end as fecha_doc
    ) d
    where a.empresa_id = p_empresa
      and a.fecha >= v_desde and a.fecha < v_hasta
      and a.referencia_id is not null
      and a.origen in ('venta', 'nota_credito', 'compra', 'pago', 'pago_proveedor', 'anticipo', 'remuneracion')
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

Antes de aplicar, diffear los 4 cuerpos re-creados contra la 0025 (backstop del claim VERBATIM; solo deben aparecer los deltas declarados en los encabezados de cada `RE-CREATE`).

- [ ] **Step 2: Parchar los 4 asserts afectados (Edit tool, old/new byte-exactos)**

**2a — `supabase/tests/database/contabilidad.test.sql`** (assert 1, `'14/true'` → `'16/true'`):

old_string:
```sql
-- 1) Idempotente: 14 claves de sistema (no 28) y el flag encendido.
select is(
  (select count(*) from cuentas_contables
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema is not null)::text
  || '/' ||
  (select modulo_contabilidad from empresas where id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa')::text,
  '14/true',
  'activar es idempotente: las 14 claves de sistema y el flag encendido'
);
```

new_string:
```sql
-- 1) Idempotente: 16 claves de sistema (no 32) y el flag encendido.
select is(
  (select count(*) from cuentas_contables
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema is not null)::text
  || '/' ||
  (select modulo_contabilidad from empresas where id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa')::text,
  '16/true',
  'activar es idempotente: las 16 claves de sistema y el flag encendido'
);
```

**2b — `supabase/tests/database/estados_financieros.test.sql`** (assert 1, `'14/patrimonio:true'` → `'16/patrimonio:true'`):

old_string:
```sql
-- 1) La 0025 volvió a extender el catálogo: 14 claves y utilidad_ejercicio es hoja de patrimonio.
select is(
  (select count(*) from cuentas_contables
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema is not null)::text
  || '/' ||
  (select tipo || ':' || acepta_movimientos from cuentas_contables
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema = 'utilidad_ejercicio'),
  '14/patrimonio:true',
  'activar siembra 14 claves de sistema; utilidad_ejercicio es hoja de patrimonio'
);
```

new_string:
```sql
-- 1) La 0026 volvió a extender el catálogo: 16 claves y utilidad_ejercicio es hoja de patrimonio.
select is(
  (select count(*) from cuentas_contables
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema is not null)::text
  || '/' ||
  (select tipo || ':' || acepta_movimientos from cuentas_contables
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema = 'utilidad_ejercicio'),
  '16/patrimonio:true',
  'activar siembra 16 claves de sistema; utilidad_ejercicio es hoja de patrimonio'
);
```

**2c — `supabase/tests/database/remuneraciones.test.sql`** (assert 1, `'14/3'` → `'16/3'`; el conteo de las 3 anclas P18 sigue siendo válido — el `'16/3'` → `'16/5'` con las 2 anclas nuevas lo hace la Task 2, que toma ESTE new_string como su old_string):

old_string:
```sql
-- 1) La 0025 extendió el catálogo: 14 claves y las 3 anclas de remuneraciones son hojas.
select is(
  (select count(*) from cuentas_contables
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema is not null)::text
  || '/' ||
  (select count(*) from cuentas_contables
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and clave_sistema in ('gasto_remuneraciones', 'remuneraciones_por_pagar', 'retenciones_por_pagar')
     and acepta_movimientos)::text,
  '14/3',
  'activar siembra 14 claves de sistema; las 3 anclas de remuneraciones son hojas'
);
```

new_string:
```sql
-- 1) La 0026 extendió el catálogo: 16 claves y las 3 anclas P18 de remuneraciones siguen siendo hojas.
select is(
  (select count(*) from cuentas_contables
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema is not null)::text
  || '/' ||
  (select count(*) from cuentas_contables
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and clave_sistema in ('gasto_remuneraciones', 'remuneraciones_por_pagar', 'retenciones_por_pagar')
     and acepta_movimientos)::text,
  '16/3',
  'activar siembra 16 claves de sistema; las 3 anclas P18 de remuneraciones son hojas'
);
```

**2d — `supabase/tests/database/remuneraciones.test.sql`** (assert 27: la G1 re-emitida nace CON aportes tras la 0026 → asiento de 5 líneas; aportes G1 = 15300+24000+9000 = 48300. La Task 2 renumera este assert a 32 y le agrega el assert de cuadre tomando ESTE new_string como su old_string):

old_string:
```sql
-- 27) GOLDEN líneas: Gasto (imponible 1000000 + no imponibles 50000 = 1050000 al debe),
--     Remuneraciones por pagar (líquido 861300 al haber) y Retenciones por pagar
--     (descuentos 188700 al haber). Cuadra por construcción: 861300+188700 = 1050000.
select is(
  (select string_agg(c.clave_sistema || ':' || l.debe || ':' || l.haber, '|' order by c.clave_sistema)
   from asientos_lineas l
   join cuentas_contables c on c.empresa_id = l.empresa_id and c.id = l.cuenta_id
   where l.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and l.asiento_id = (select id from asientos
                         where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and origen = 'remuneracion'
                           and referencia_id = (select id from liquidaciones
                                                where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
                                                  and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '157890123')
                                                  and periodo = '2026-06' and estado = 'emitida'))),
  'gasto_remuneraciones:1050000:0|remuneraciones_por_pagar:0:861300|retenciones_por_pagar:0:188700',
  'el asiento de remuneración lleva las 3 anclas con los montos del spec §5 y cuadra'
);
```

new_string:
```sql
-- 27) GOLDEN líneas (P19: 5 líneas): Gasto remuneraciones (1050000) + Gasto leyes
--     sociales (aportes G1 = 15300+24000+9000 = 48300) al debe; Remuneraciones por
--     pagar (861300), Retenciones (188700) y Leyes sociales por pagar (48300) al
--     haber. Cuadra por construcción: 1050000+48300 = 861300+188700+48300 = 1098300.
select is(
  (select string_agg(c.clave_sistema || ':' || l.debe || ':' || l.haber, '|' order by c.clave_sistema)
   from asientos_lineas l
   join cuentas_contables c on c.empresa_id = l.empresa_id and c.id = l.cuenta_id
   where l.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and l.asiento_id = (select id from asientos
                         where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and origen = 'remuneracion'
                           and referencia_id = (select id from liquidaciones
                                                where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
                                                  and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '157890123')
                                                  and periodo = '2026-06' and estado = 'emitida'))),
  'gasto_leyes_sociales:48300:0|gasto_remuneraciones:1050000:0|leyes_sociales_por_pagar:0:48300|remuneraciones_por_pagar:0:861300|retenciones_por_pagar:0:188700',
  'el asiento de remuneración lleva las 5 líneas con los aportes del empleador y cuadra'
);
```

`plan(29)` de `remuneraciones.test.sql` NO se toca (mismos conteos: suite 392 / 19 archivos).

- [ ] **Step 3: Aplicar y verificar (incluye los 4 goldens de aportes en vivo)**

Run: `npx supabase db reset` → aplica 0001-0026 sin errores. El backfill de anclas corre sobre tablas vacías (las migraciones preceden al seed) → inserta 0 filas, sin choques.

Run: `npx supabase test db` → **19 archivos, 392 asserts** verdes (los 4 parches del Step 2 ya esperan el catálogo 16 y el asiento de 5 líneas).

Validación en vivo (transaccional, TODO se revierte). Escribir (Write tool, UTF-8 sin BOM) `.superpowers/sdd/smoke-p19-t1.sql`:

```sql
\set ON_ERROR_STOP on
begin;

-- Fixture minima (superuser; rollback al final; uuids/RUTs del patron smoke P18, no comiteados)
insert into auth.users (instance_id, id, aud, role, email)
values ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'ana@a.cl');
insert into public.organizaciones (id, rut, razon_social)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '769010007', 'Org A');
insert into public.empresas (id, organizacion_id, rut, razon_social)
values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '769010007', 'Nomina A');
insert into public.miembros (usuario_id, organizacion_id, rol)
values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'dueno');

-- 1) Backfill de tasas: todos los periodos en 1.53; la empresa nace en 0.90
select count(*) = count(*) filter (where tasa_sis = 1.53) as sis_backfill_ok,
       count(*) as periodos
from indicadores_previsionales;
select tasa_mutual from empresas where id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa';

-- 2) Camino real como la duena: activar + catalogo 31/16/5 + las 2 anclas nuevas
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select activar_contabilidad('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa');
select count(*) as cuentas,
       count(*) filter (where clave_sistema is not null) as claves,
       count(*) filter (where not acepta_movimientos) as grupos
from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa';
select codigo, nombre, tipo from cuentas_contables
where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
  and clave_sistema in ('gasto_leyes_sociales', 'leyes_sociales_por_pagar')
order by codigo;

-- 3) Grant de columna: la duena edita tasa_mutual; el CHECK acota 0-10
update empresas set tasa_mutual = 3.40 where id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa';
select tasa_mutual from empresas where id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa';
do $do$
begin
  update empresas set tasa_mutual = 12 where id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa';
  raise notice 'FALLO: check tasa_mutual';
exception when others then
  raise notice 'OK check: %', sqlerrm;
end $do$;
-- Volver a la tasa CANONICA antes de los goldens.
update empresas set tasa_mutual = 0.90 where id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa';

-- 4) Trabajadores y contratos de los goldenes + T5 DESACTIVADO con contrato vigente
insert into public.trabajadores (id, empresa_id, rut, nombre) values
  ('10000000-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '769031006', 'G1 Fonasa Habitat'),
  ('10000000-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '111111111', 'G2 Isapre Capital'),
  ('10000000-0000-0000-0000-000000000003', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '222222222', 'G3 Tope Modelo'),
  ('10000000-0000-0000-0000-000000000004', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '333333333', 'G4 Tramo Habitat');
insert into public.trabajadores (id, empresa_id, rut, nombre, activo) values
  ('10000000-0000-0000-0000-000000000005', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '555555555', 'T5 Desactivado', false);
insert into public.contratos (id, empresa_id, trabajador_id, tipo, fecha_inicio, fecha_termino, cargo, sueldo_base, gratificacion_legal, afp, salud, plan_isapre_uf) values
  ('20000000-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '10000000-0000-0000-0000-000000000001', 'indefinido', date '2025-01-01', null, 'Operaria', 800000, true, 'habitat', 'fonasa', null),
  ('20000000-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '10000000-0000-0000-0000-000000000002', 'plazo_fijo', date '2026-01-01', date '2026-12-31', 'Chofer', 1200000, true, 'capital', 'isapre', 5.0),
  ('20000000-0000-0000-0000-000000000003', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '10000000-0000-0000-0000-000000000003', 'indefinido', date '2024-06-01', null, 'Gerente', 4000000, true, 'modelo', 'fonasa', null),
  ('20000000-0000-0000-0000-000000000004', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '10000000-0000-0000-0000-000000000004', 'indefinido', date '2025-03-01', null, 'Jefa de operaciones', 2500000, true, 'habitat', 'fonasa', null),
  ('20000000-0000-0000-0000-000000000005', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '10000000-0000-0000-0000-000000000005', 'indefinido', date '2025-01-01', null, 'Bodega', 600000, true, 'modelo', 'fonasa', null);

-- 5) GOLDENS con la capa de aportes (montos P18 intactos + aportes nuevos)
select emitir_liquidacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '10000000-0000-0000-0000-000000000001', '2026-06', 30, 0, 50000) is not null as g1_emitida;
select emitir_liquidacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '10000000-0000-0000-0000-000000000002', '2026-06', 30, 0, 0) is not null as g2_emitida;
select emitir_liquidacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '10000000-0000-0000-0000-000000000003', '2026-06', 30, 0, 0) is not null as g3_emitida;
select emitir_liquidacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '10000000-0000-0000-0000-000000000004', '2026-06', 30, 0, 0) is not null as g4_emitida;
select t.nombre, l.total_imponible, l.liquido, l.sis_monto, l.cesantia_empleador_monto,
       l.mutual_monto, l.total_aportes, l.tasa_sis, l.tasa_mutual
from liquidaciones l
join trabajadores t on t.id = l.trabajador_id and t.empresa_id = l.empresa_id
where l.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
order by t.nombre;

-- 6) Trabajador desactivado -> raise byte-exacto
do $do$
begin
  perform emitir_liquidacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '10000000-0000-0000-0000-000000000005', '2026-06', 30, 0, 0);
  raise notice 'FALLO: un desactivado emitio';
exception when others then
  raise notice 'OK desactivado: %', sqlerrm;
end $do$;

-- 7) Asiento G1 de 5 lineas (path del hook; superuser)
reset role;
select contabilizar_documento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'remuneracion',
  (select id from liquidaciones where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and trabajador_id = '10000000-0000-0000-0000-000000000001' and periodo = '2026-06')) as g1_contab;
select string_agg(c.clave_sistema || ':' || l.debe || ':' || l.haber, '|' order by c.clave_sistema) as lineas_g1
from asientos_lineas l
join asientos a on a.id = l.asiento_id and a.empresa_id = l.empresa_id
join cuentas_contables c on c.id = l.cuenta_id and c.empresa_id = l.empresa_id
where l.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and a.origen = 'remuneracion';

-- 8) Catch-up pre-P19: G2 con aportes forzados a 0 (superuser simula una
--    liquidacion vieja) -> el asiento vuelve a las 3 lineas P18
update liquidaciones set sis_monto = 0, cesantia_empleador_monto = 0, mutual_monto = 0, total_aportes = 0
where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
  and trabajador_id = '10000000-0000-0000-0000-000000000002' and periodo = '2026-06';
select contabilizar_documento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'remuneracion',
  (select id from liquidaciones where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and trabajador_id = '10000000-0000-0000-0000-000000000002' and periodo = '2026-06')) as g2_contab;
select string_agg(c.clave_sistema || ':' || l.debe || ':' || l.haber, '|' order by c.clave_sistema) as lineas_g2
from asientos_lineas l
join asientos a on a.id = l.asiento_id and a.empresa_id = l.empresa_id
join cuentas_contables c on c.id = l.cuenta_id and c.empresa_id = l.empresa_id
where l.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and a.origen = 'remuneracion'
  and a.referencia_id = (select id from liquidaciones where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
                           and trabajador_id = '10000000-0000-0000-0000-000000000002' and periodo = '2026-06');

-- 9) Regla 6 del auditor: un asiento de remuneracion cuya fecha difiere del
--    documento (superuser lo mueve a julio) aparece como asiento tardio
update asientos set fecha = date '2026-07-15'
where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and origen = 'remuneracion'
  and referencia_id = (select id from liquidaciones where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
                         and trabajador_id = '10000000-0000-0000-0000-000000000001' and periodo = '2026-06');
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select o ->> 'regla' as regla, o ->> 'detalle' as detalle
from jsonb_array_elements(revision_periodo('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 2026, 7) -> 'observaciones') as x(o)
where o ->> 'regla' = 'asientos_tardios';

reset role;
rollback;
```

Run (Bash tool / Git Bash — NO PowerShell 5.1, razones de encoding):

```bash
cat .superpowers/sdd/smoke-p19-t1.sql | docker exec -i supabase_db_ERP_Transportes psql -U postgres -d postgres -v ON_ERROR_STOP=1
```

Salida esperada (valores, en orden):
- (1) `sis_backfill_ok = t`, `periodos = 3` (2026-05/06/07 sembrados por la 0025, todos backfilleados a 1.53); `tasa_mutual = 0.90`.
- (2) `cuentas = 31`, `claves = 16`, `grupos = 5`; 2 filas: `2.1.07 | Leyes sociales por pagar | pasivo` y `5.1.06 | Leyes sociales | gasto`.
- (3) `UPDATE 1`; `tasa_mutual = 3.40`; `NOTICE:  OK check: new row for relation "empresas" violates check constraint "empresas_tasa_mutual_check"`; `UPDATE 1` (vuelta a 0.90).
- (5) `g1_emitida … g4_emitida = t` (4 veces) y la tabla de aportes BYTE-EXACTA (orden por nombre; imponible y líquido = goldens P18 INTACTOS):
  - `G1 Fonasa Habitat | 1000000 | 861300 | 15300 | 24000 | 9000 | 48300 | 1.53 | 0.90`
  - `G2 Isapre Capital | 1409396 | 1047605 | 21564 | 42282 | 12685 | 76531 | 1.53 | 0.90`
  - `G3 Tope Modelo | 3441760 | 2711694 | 52659 | 82602 | 30976 | 166237 | 1.53 | 0.90`
  - `G4 Tramo Habitat | 2709396 | 2143212 | 41454 | 65026 | 24385 | 130865 | 1.53 | 0.90`
- (6) `NOTICE:  OK desactivado: El trabajador está desactivado`.
- (7) `g1_contab = creado`; `lineas_g1 = gasto_leyes_sociales:48300:0|gasto_remuneraciones:1050000:0|leyes_sociales_por_pagar:0:48300|remuneraciones_por_pagar:0:861300|retenciones_por_pagar:0:188700` (cuadra: 1050000+48300 = 861300+188700+48300 = 1098300).
- (8) `UPDATE 1`; `g2_contab = creado`; `lineas_g2 = gasto_remuneraciones:1409396:0|remuneraciones_por_pagar:0:1047605|retenciones_por_pagar:0:361791` (3 líneas, forma P18: 1047605+361791 = 1409396).
- (9) `UPDATE 1`; 1 fila: `asientos_tardios | Asiento N° 1 con fecha 2026-07-15 registra un documento del 2026-06-30`.
- Cierre: `ROLLBACK` (nada persiste).

Byte-scan del archivo nuevo (JAMÁS BOM U+FEFF):

```bash
grep -c $'\xEF\xBB\xBF' supabase/migrations/00000000000026_ciclo_nomina.sql
```

→ imprime `0` y sale con status 1 (sin coincidencias = pass).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/00000000000026_ciclo_nomina.sql supabase/tests/database/contabilidad.test.sql supabase/tests/database/estados_financieros.test.sql supabase/tests/database/remuneraciones.test.sql
git commit -m "feat(db): aportes del empleador en la nómina — SIS, cesantía patronal y mutual con 2 anclas contables

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

→ commit en la rama del plan; la suite queda VERDE en 392/19 en este commit (la Task 2 la sube a 399).

---
### Task 2: pgTAP de aportes patronales — goldens, desactivado y asientos de 5/3 líneas

> Depende de la Task 1 (migración 0026 aplicada: columnas de aportes + `tasa_sis`/`tasa_mutual`,
> catálogo 31 cuentas / 16 anclas, `emitir_liquidacion` / `contabilizar_documento` /
> `activar_contabilidad` / `revision_periodo` re-creadas, y los 4 parches de asserts YA aplicados).
> Las validaciones de admin (`guardarPeriodo`, tramos, tasa SIS ≤ 100) NO van aquí — son TS (spec §6, Task 6).

**Files**

- Modificar: `supabase/tests/database/remuneraciones.test.sql` (plan(29) → plan(36); asserts 29 → 36)

**Aritmética golden de aportes** (spec §3 reglas 9-12; tasas canónicas 1,53 / 0,90 / 2,4-3,0):

Base cesantía = `min(total_imponible, round(131.9 · 39200))` = `min(imponible, 5170480)`.
`round()` de Postgres sobre numeric: mitad se aleja de cero.

| Golden | Imponible | Tipo | sis (1,53%) | ces. empleador | mutual (0,90%) | total |
|---|---|---|---|---|---|---|
| G1 | 1.000.000 | indefinido 2,4% | round(15300) = **15300** | round(24000) = **24000** | round(9000) = **9000** | **48300** |
| G2 | 1.409.396 | plazo fijo 3,0% | round(21563,7588) = **21564** | round(42281,88) = **42282** | round(12684,564) = **12685** | **76531** |
| G3 | 3.441.760 | indefinido 2,4% | round(52658,928) = **52659** | round(82602,24) = **82602** | round(30975,84) = **30976** | **166237** |
| G4 | 2.709.396 | indefinido 2,4% | round(41453,7588) = **41454** | round(65025,504) = **65026** | round(24384,564) = **24385** | **130865** |

En G1-G4 la base de cesantía nunca se topa (máx. imponible 3.441.760 < 5.170.480; en G3
el tope imponible de 87,8 UF muerde antes que el de cesantía de 131,9 UF). En G2 la
cesantía del TRABAJADOR es 0 (plazo fijo) pero la del EMPLEADOR sí cotiza al 3,0%.

Asiento G1 re-emitida (5 líneas): debe 1.050.000 + 48.300 = **1.098.300** = haber
861.300 + 188.700 + 48.300. Asiento catch-up G3 con aportes 0 (3 líneas): debe
3.441.760 = haber 2.711.694 + 730.066.

**Declaraciones (secuencia con la Task 1 — regla del plan):**

1. **La Task 1 YA parcheó este archivo** con los parches mínimos (assert 1 `'14/3'` → `'16/3'` con comentario y descripción nuevos; assert 27 → golden del asiento de 5 líneas) y dejó la suite verde en 392/19. **Esta task EXTIENDE**: plan(29) → plan(36), 7 asserts nuevos, fixture Rosa, contador `'4/4/4'` → `'5/5/4'`, y el re-parche del assert 1 `'16/3'` → `'16/5'` (amplía el `in (...)` a las 5 anclas). Los `old_string` de los Steps 2 y 13 son los NEW de la Task 1 — si un Edit no calza, la Task 1 no corrió o divergió: STOP, reportar, no improvisar.
2. **Semántica del assert 1:** primer número = claves de sistema del catálogo (16 tras la 0026); segundo = cuántas de las anclas LISTADAS en el `in (...)` son hojas (3 P18 → 5 con `gasto_leyes_sociales` y `leyes_sociales_por_pagar`).
3. **Mecanismo aportes-0 (declarado):** NO existe liquidación pre-P19 simulable vía tasas — la cesantía patronal es constante de ley (2,4%/3,0%) y no se anula con `tasa_sis = 0` y `tasa_mutual = 0`. La simulación de catch-up pone en 0 el snapshot de aportes de G3 (emitida, aún sin asiento) por UPDATE como superusuario (`reset role`, mismo patrón del bloque de fixtures) y vuelve a `service_role` para contabilizar.
4. **RUT nuevo del fixture desactivado:** `198765430` (19.876.543-0; módulo 11: 3·2+4·3+5·4+6·5+7·6+8·7+9·2+1·3 = 187, 187 mod 11 = 0 → DV 0). grep = 0 en tests, seed y E2E (verificado por el ensamblador).
5. **Conteo colateral:** el fixture desactivado suma 1 trabajador y 1 contrato → el assert del contador (`'4/4/4'`) pasa a `'5/5/4'` (Step 11). El auditor sigue en 4 (Rosa jamás emite) y el vendedor sigue viendo 0.

Aplica los Steps EN ORDEN (varios `old_string` incluyen el encabezado del assert
siguiente, que se renumera en el mismo edit). Numeración final: 1-11 intactos,
12 nuevo (desactivada), 13-14 (ex 12-13), 15 nuevo (G1 aportes), 16 (ex 14),
17 nuevo (G2 aportes), 18 (ex 15), 19 nuevo (G3 aportes), 20 (ex 16), 21 nuevo
(G4 aportes), 22-31 (ex 17-26), 32 (ex 27, ya parchado a 5 líneas por la Task 1),
33 nuevo (cuadre), 34-35 (ex 28-29), 36 nuevo (catch-up 3 líneas).

- [ ] **Step 1: plan(29) → plan(36)**

Edit sobre `supabase/tests/database/remuneraciones.test.sql`:

```
old_string:
select plan(29);

new_string:
select plan(36);
```

- [ ] **Step 2: assert 1 — `'16/3'` → `'16/5'` (el old_string es el NEW de la Task 1)**

```
old_string:
-- 1) La 0026 extendió el catálogo: 16 claves y las 3 anclas P18 de remuneraciones siguen siendo hojas.
select is(
  (select count(*) from cuentas_contables
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema is not null)::text
  || '/' ||
  (select count(*) from cuentas_contables
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and clave_sistema in ('gasto_remuneraciones', 'remuneraciones_por_pagar', 'retenciones_por_pagar')
     and acepta_movimientos)::text,
  '16/3',
  'activar siembra 16 claves de sistema; las 3 anclas P18 de remuneraciones son hojas'
);

new_string:
-- 1) La 0026 extendió el catálogo: 16 claves y las 5 anclas de remuneraciones
--    (3 del P18 + gasto_leyes_sociales y leyes_sociales_por_pagar) son hojas.
select is(
  (select count(*) from cuentas_contables
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema is not null)::text
  || '/' ||
  (select count(*) from cuentas_contables
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and clave_sistema in ('gasto_remuneraciones', 'remuneraciones_por_pagar', 'retenciones_por_pagar',
                           'gasto_leyes_sociales', 'leyes_sociales_por_pagar')
     and acepta_movimientos)::text,
  '16/5',
  'activar siembra 16 claves de sistema; las 5 anclas de remuneraciones son hojas'
);
```

- [ ] **Step 3: el fixture de indicadores fija tasa_sis 1.53 explícita (canon dentro de la transacción)**

Dos edits (INSERT y ON CONFLICT del mismo upsert):

```
old_string:
insert into public.indicadores_previsionales
  (periodo, uf, utm, ingreso_minimo, tope_imponible_uf, tope_cesantia_uf, tasas_afp, tramos_impuesto)
values
  ('2026-06', 39200, 69500, 529000, 87.8, 131.9,

new_string:
insert into public.indicadores_previsionales
  (periodo, uf, utm, ingreso_minimo, tope_imponible_uf, tope_cesantia_uf, tasa_sis, tasas_afp, tramos_impuesto)
values
  ('2026-06', 39200, 69500, 529000, 87.8, 131.9, 1.53,
```

```
old_string:
on conflict (periodo) do update
  set uf = excluded.uf, utm = excluded.utm, ingreso_minimo = excluded.ingreso_minimo,
      tope_imponible_uf = excluded.tope_imponible_uf, tope_cesantia_uf = excluded.tope_cesantia_uf,
      tasas_afp = excluded.tasas_afp, tramos_impuesto = excluded.tramos_impuesto;

new_string:
on conflict (periodo) do update
  set uf = excluded.uf, utm = excluded.utm, ingreso_minimo = excluded.ingreso_minimo,
      tope_imponible_uf = excluded.tope_imponible_uf, tope_cesantia_uf = excluded.tope_cesantia_uf,
      tasa_sis = excluded.tasa_sis, tasas_afp = excluded.tasas_afp, tramos_impuesto = excluded.tramos_impuesto;
```

La `tasa_mutual` de la empresa NO se fija: el fixture usa el default 0,90 de la 0026
(camino canónico del spec §2 — la empresa recién creada cotiza mutual base).

- [ ] **Step 4: nuevo assert 12 — trabajador desactivado (fixture Rosa, tras el assert 11)**

El bloque se inserta ENTRE el assert 11 (líquido negativo) y la sección de goldens;
seguimos con jwt de Ana (dueña: inserta y edita trabajadores por RLS). Rosa tiene
contrato vigente y período válido — la ÚNICA condición que falla es el candado nuevo.

```
old_string:
-- ===== Goldens G1-G3 (Ana emite; aritmética a mano en el plan, espejo del TS) =====
-- SETUP (felices sin assert): los goldens 12-15 leen el snapshot persistido.

new_string:
-- ===== Trabajador desactivado (P19 cierra el minor diferido del P18) =====
-- SETUP: Ana crea a Rosa con contrato vigente y la desactiva — al emitir, la
-- ÚNICA condición que falla es el candado nuevo. RUT nuevo, único GLOBAL
-- (módulo 11, cálculo en el plan): 198765430 — grep = 0 en tests, seed y E2E.
insert into public.trabajadores (empresa_id, rut, nombre)
values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '198765430', 'Rosa Desactivada');
insert into public.contratos (empresa_id, trabajador_id, tipo, fecha_inicio, cargo, sueldo_base, afp, salud)
values
  ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
   (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '198765430'),
   'indefinido', date '2026-01-01', 'Bodeguera', 600000, 'habitat', 'fonasa');
update public.trabajadores set activo = false
 where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '198765430';

-- 12) Desactivada con contrato vigente: emitir la rechaza con el mensaje del spec §3.
select throws_ok(
  $$select emitir_liquidacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '198765430'),
    '2026-06', 30, 0, 0)$$,
  'P0001', 'El trabajador está desactivado',
  'un trabajador desactivado no recibe liquidaciones'
);

-- ===== Goldens G1-G3 (Ana emite; aritmética a mano en el plan, espejo del TS) =====
-- SETUP (felices sin assert): los goldens 13-19 leen el snapshot persistido.
```

- [ ] **Step 5: renumerar G1 (12→13) y su snapshot (13→14)**

Dos edits de una línea:

```
old_string:
-- 12) GOLDEN G1 (Fonasa indefinido habitat 800000 + 50000 no imponibles):

new_string:
-- 13) GOLDEN G1 (Fonasa indefinido habitat 800000 + 50000 no imponibles):
```

```
old_string:
-- 13) G1 nace EMITIDA (sin borrador persistido) con el snapshot de contexto completo:

new_string:
-- 14) G1 nace EMITIDA (sin borrador persistido) con el snapshot de contexto completo:
```

- [ ] **Step 6: nuevo assert 15 — G1 aportes (y G2 pasa de 14 a 16)**

```
old_string:
  'emitida/true/800000/habitat/11.27/fonasa/39200/69500',
  'la liquidación nace emitida con emitida_en y el snapshot de contexto'
);

-- 14) GOLDEN G2 (Isapre plazo fijo capital 1200000, plan 5,0 UF):

new_string:
  'emitida/true/800000/habitat/11.27/fonasa/39200/69500',
  'la liquidación nace emitida con emitida_en y el snapshot de contexto'
);

-- 15) G1 · APORTES (P19, reglas 9-12): sis 1,53% de 1000000 = 15300; cesantía
--     empleador indefinido 2,4% sobre min(1000000, round(131,9·39200) = 5170480)
--     = 24000; mutual 0,90% = 9000; total 48300. Tasas snapshoteadas en la fila.
select is(
  (select sis_monto || '/' || cesantia_empleador_monto || '/' || mutual_monto
     || '/' || total_aportes || '/' || tasa_sis || '/' || tasa_mutual
   from liquidaciones
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '157890123')
     and periodo = '2026-06'),
  '15300/24000/9000/48300/1.53/0.90',
  'G1 aportes: SIS, cesantía patronal y mutual calzan byte a byte con las tasas snapshoteadas'
);

-- 16) GOLDEN G2 (Isapre plazo fijo capital 1200000, plan 5,0 UF):
```

- [ ] **Step 7: nuevo assert 17 — G2 aportes (y G3 pasa de 15 a 18)**

```
old_string:
  '1200000/209396/1409396/161235/196000/0/4556/361791/1047605',
  'G2: Isapre plazo fijo con plan sobre el 7% y sin cesantía calza byte a byte'
);

-- 15) GOLDEN G3 (Fonasa indefinido modelo 4000000, sobre el tope imponible):

new_string:
  '1200000/209396/1409396/161235/196000/0/4556/361791/1047605',
  'G2: Isapre plazo fijo con plan sobre el 7% y sin cesantía calza byte a byte'
);

-- 17) G2 · APORTES: plazo fijo SÍ cotiza cesantía patronal (3,0%) aunque la del
--     trabajador sea 0. sis round(21563,7588) = 21564; cesantía round(42281,88)
--     = 42282; mutual round(12684,564) = 12685; total 76531.
select is(
  (select sis_monto || '/' || cesantia_empleador_monto || '/' || mutual_monto
     || '/' || total_aportes || '/' || tasa_sis || '/' || tasa_mutual
   from liquidaciones
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '165432096')
     and periodo = '2026-06'),
  '21564/42282/12685/76531/1.53/0.90',
  'G2 aportes: la cesantía patronal del plazo fijo (3,0%) calza byte a byte'
);

-- 18) GOLDEN G3 (Fonasa indefinido modelo 4000000, sobre el tope imponible):
```

- [ ] **Step 8: nuevo assert 19 — G3 aportes (antes de la sección G4)**

```
old_string:
  '4000000/209396/3441760/364138/240923/20651/104354/730066/2711694',
  'G3: sueldo sobre el tope imponible calza byte a byte (imponible topado en 87,8 UF)'
);

-- ===== G4: el CONTADOR emite (spec §4: dueno/admin/contador) =====

new_string:
  '4000000/209396/3441760/364138/240923/20651/104354/730066/2711694',
  'G3: sueldo sobre el tope imponible calza byte a byte (imponible topado en 87,8 UF)'
);

-- 19) G3 · APORTES: base 3441760 (el tope imponible 87,8 UF muerde antes que el
--     de cesantía 131,9 UF = 5170480). sis round(52658,928) = 52659; cesantía
--     2,4% round(82602,24) = 82602; mutual round(30975,84) = 30976; total 166237.
select is(
  (select sis_monto || '/' || cesantia_empleador_monto || '/' || mutual_monto
     || '/' || total_aportes || '/' || tasa_sis || '/' || tasa_mutual
   from liquidaciones
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '178901230')
     and periodo = '2026-06'),
  '52659/82602/30976/166237/1.53/0.90',
  'G3 aportes: los aportes se calculan sobre el imponible topado'
);

-- ===== G4: el CONTADOR emite (spec §4: dueno/admin/contador) =====
```

- [ ] **Step 9: renumerar G4 (16→20)**

```
old_string:
-- 16) GOLDEN G4 (Fonasa indefinido habitat 2500000, emitida por el CONTADOR):

new_string:
-- 20) GOLDEN G4 (Fonasa indefinido habitat 2500000, emitida por el CONTADOR):
```

- [ ] **Step 10: nuevo assert 21 — G4 aportes (leído por el contador; y Duplicada pasa de 17 a 22)**

```
old_string:
  '2500000/209396/2709396/305349/189658/16256/54921/566184/2143212',
  'G4: el contador SÍ emite y el tramo 2+ del impuesto calza byte a byte'
);

-- 17) Duplicada: Tomás ya tiene liquidación no-anulada de '2026-06' (unique parcial).

new_string:
  '2500000/209396/2709396/305349/189658/16256/54921/566184/2143212',
  'G4: el contador SÍ emite y el tramo 2+ del impuesto calza byte a byte'
);

-- 21) G4 · APORTES: sis round(41453,7588) = 41454; cesantía 2,4%
--     round(65025,504) = 65026; mutual round(24384,564) = 24385; total 130865.
select is(
  (select sis_monto || '/' || cesantia_empleador_monto || '/' || mutual_monto
     || '/' || total_aportes || '/' || tasa_sis || '/' || tasa_mutual
   from liquidaciones
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '189012349')
     and periodo = '2026-06'),
  '41454/65026/24385/130865/1.53/0.90',
  'G4 aportes: la emisión del contador también snapshotea los aportes'
);

-- 22) Duplicada: Tomás ya tiene liquidación no-anulada de '2026-06' (unique parcial).
```

- [ ] **Step 11: assert del contador (18→23) — Rosa y su contrato suman: '5/5/4'**

```
old_string:
-- 18) El CONTADOR (Ces) lee las 3 tablas (SELECT dueno/admin/contador).
select is(
  (select count(*) from trabajadores)::text || '/' ||
  (select count(*) from contratos)::text || '/' ||
  (select count(*) from liquidaciones)::text,
  '4/4/4',
  'el contador ve trabajadores, contratos y liquidaciones'
);

new_string:
-- 23) El CONTADOR (Ces) lee las 3 tablas (SELECT dueno/admin/contador).
--     Rosa (desactivada) y su contrato cuentan: 5/5; liquidaciones siguen en 4.
select is(
  (select count(*) from trabajadores)::text || '/' ||
  (select count(*) from contratos)::text || '/' ||
  (select count(*) from liquidaciones)::text,
  '5/5/4',
  'el contador ve trabajadores, contratos y liquidaciones'
);
```

- [ ] **Step 12: renumerar 19-26 → 24-31 (ocho edits de una línea)**

```
old_string:
-- 19) El VENDEDOR (Vero) ve 0 filas en las 3 tablas (RLS por rol, dato sensible).

new_string:
-- 24) El VENDEDOR (Vero) ve 0 filas en las 3 tablas (RLS por rol, dato sensible).
```

```
old_string:
-- 20) Pero los indicadores son públicos: cualquier authenticated los lee.

new_string:
-- 25) Pero los indicadores son públicos: cualquier authenticated los lee.
```

```
old_string:
-- 21) Quedó pagada con pagada_en.

new_string:
-- 26) Quedó pagada con pagada_en.
```

```
old_string:
-- 22) Re-pagar una pagada: solo emitida se paga.

new_string:
-- 27) Re-pagar una pagada: solo emitida se paga.
```

```
old_string:
-- 23) Motivo vacío: rechazo byte-exacto.

new_string:
-- 28) Motivo vacío: rechazo byte-exacto.
```

```
old_string:
-- 24) Quedó anulada con motivo y anulada_en.

new_string:
-- 29) Quedó anulada con motivo y anulada_en.
```

```
old_string:
-- 25) Re-emitir tras anular: el unique parcial ignora anuladas → conviven las dos filas.

new_string:
-- 30) Re-emitir tras anular: el unique parcial ignora anuladas → conviven las dos filas.
```

```
old_string:
-- 26) El AUDITOR (P17) ve las remuneraciones: la regla 1 de revision_periodo

new_string:
-- 31) El AUDITOR (P17) ve las remuneraciones: la regla 1 de revision_periodo
```

- [ ] **Step 13: assert del asiento (27→32, ya en 5 líneas por la Task 1) + nuevo assert 33 de cuadre**

La Task 1 YA dejó este assert con el golden de 5 líneas — aquí solo se renumera y se
agrega el assert de cuadre. Primero el comentario (solo cambia `27` → `32`):

```
old_string:
-- 27) GOLDEN líneas (P19: 5 líneas): Gasto remuneraciones (1050000) + Gasto leyes
--     sociales (aportes G1 = 15300+24000+9000 = 48300) al debe; Remuneraciones por
--     pagar (861300), Retenciones (188700) y Leyes sociales por pagar (48300) al
--     haber. Cuadra por construcción: 1050000+48300 = 861300+188700+48300 = 1098300.

new_string:
-- 32) GOLDEN líneas (P19: 5 líneas): Gasto remuneraciones (1050000) + Gasto leyes
--     sociales (aportes G1 = 15300+24000+9000 = 48300) al debe; Remuneraciones por
--     pagar (861300), Retenciones (188700) y Leyes sociales por pagar (48300) al
--     haber. Cuadra por construcción: 1050000+48300 = 861300+188700+48300 = 1098300.
```

Luego el nuevo assert 33 de cuadre tras el golden (y La fecha pasa de 28 a 34; el
old_string es la cola del new_string de la Task 1):

```
old_string:
  'gasto_leyes_sociales:48300:0|gasto_remuneraciones:1050000:0|leyes_sociales_por_pagar:0:48300|remuneraciones_por_pagar:0:861300|retenciones_por_pagar:0:188700',
  'el asiento de remuneración lleva las 5 líneas con los aportes del empleador y cuadra'
);

-- 28) La fecha es el ÚLTIMO día del mes del período (sin cierres: intacta) y el origen nuevo.

new_string:
  'gasto_leyes_sociales:48300:0|gasto_remuneraciones:1050000:0|leyes_sociales_por_pagar:0:48300|remuneraciones_por_pagar:0:861300|retenciones_por_pagar:0:188700',
  'el asiento de remuneración lleva las 5 líneas con los aportes del empleador y cuadra'
);

-- 33) El asiento de 5 líneas CUADRA: suma debe = suma haber = 1098300
--     (1050000 + 48300 = 861300 + 188700 + 48300).
select is(
  (select sum(l.debe)::text || '/' || sum(l.haber)::text
   from asientos_lineas l
   where l.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and l.asiento_id = (select id from asientos
                         where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and origen = 'remuneracion'
                           and referencia_id = (select id from liquidaciones
                                                where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
                                                  and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '157890123')
                                                  and periodo = '2026-06' and estado = 'emitida'))),
  '1098300/1098300',
  'el asiento con aportes cuadra: debe = haber = 1098300'
);

-- 34) La fecha es el ÚLTIMO día del mes del período (sin cierres: intacta) y el origen nuevo.
```

- [ ] **Step 14: renumerar noop (29→35)**

```
old_string:
-- 29) Liquidación ANULADA → noop, sin asiento (patrón P16).

new_string:
-- 35) Liquidación ANULADA → noop, sin asiento (patrón P16).
```

- [ ] **Step 15: nuevo assert 36 — catch-up pre-P19: aportes 0 → asiento de 3 líneas**

```
old_string:
  'noop/0',
  'una liquidación anulada no genera asiento (noop)'
);

select * from finish();

new_string:
  'noop/0',
  'una liquidación anulada no genera asiento (noop)'
);

-- ===== Catch-up pre-P19: liquidación con aportes 0 → asiento de 3 líneas =====
-- SETUP (mecanismo declarado en el plan): NO se puede emitir una liquidación
-- real con total_aportes = 0 vía tasas — la cesantía patronal es constante de
-- ley (2,4%/3,0%). La simulación pone en 0 el snapshot de aportes de G3
-- (emitida, aún sin asiento) como superusuario (mismo patrón del bloque de
-- fixtures: salta grants/RLS) y vuelve a service_role para contabilizar.
reset role;
update public.liquidaciones
   set sis_monto = 0, cesantia_empleador_monto = 0, mutual_monto = 0,
       total_aportes = 0, tasa_sis = 0, tasa_mutual = 0
 where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
   and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '178901230')
   and periodo = '2026-06';
set local role service_role;

-- SETUP (sin assert): contabilizar la G3 "vieja".
select contabilizar_documento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'remuneracion',
  (select id from liquidaciones
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '178901230')
     and periodo = '2026-06'));

-- 36) Con total_aportes = 0 las 2 líneas nuevas se omiten y el asiento queda de
--     3 líneas como en el P18: gasto 3441760 = líquido 2711694 + retenciones 730066.
select is(
  (select string_agg(c.clave_sistema || ':' || l.debe || ':' || l.haber, '|' order by c.clave_sistema)
   from asientos_lineas l
   join cuentas_contables c on c.empresa_id = l.empresa_id and c.id = l.cuenta_id
   where l.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and l.asiento_id = (select id from asientos
                         where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and origen = 'remuneracion'
                           and referencia_id = (select id from liquidaciones
                                                where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
                                                  and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '178901230')
                                                  and periodo = '2026-06'))),
  'gasto_remuneraciones:3441760:0|remuneraciones_por_pagar:0:2711694|retenciones_por_pagar:0:730066',
  'con aportes 0 (catch-up pre-P19) el asiento vuelve a las 3 líneas del P18'
);

select * from finish();
```

- [ ] **Step 16: correr la suite completa**

Run desde la raíz del repo (PowerShell 5.1: separar con `;`, nunca `&&`; Supabase
local corriendo):

```powershell
npx supabase test db
```

→ **19 archivos, 399 asserts** (392 del baseline P18 + 7 nuevos de `remuneraciones.test.sql`
`plan(36)`), todos verdes. Salida esperada (formato pg_prove del CLI):

```
supabase/tests/database/remuneraciones.test.sql .. ok
All tests successful.
Files=19, Tests=399,  ... Result: PASS
```

Si `remuneraciones.test.sql` sale rojo en los asserts 15/17/19/21, verificar que la
Task 1 aplicó la 0026 (columnas de aportes y defaults 1.53/0.90) ANTES de esta task.

- [ ] **Step 17: commit**

```powershell
git add supabase/tests/database/remuneraciones.test.sql
git commit -m "test(db): pgTAP de aportes patronales — goldens G1-G4, trabajador desactivado y asientos de 5/3 líneas" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

→ commit en la rama del plan; `git status` limpio.

---
### Task 3: Espejo TS de aportes del empleador + generador Previred de 105 campos

Extiende el espejo `calcularLiquidacion` con las reglas 9-12 del spec P19 §3 (SIS, cesantía patronal, mutual, total de aportes), crea `packages/core/src/previred.ts` (spec §5) y refleja en `packages/db/src/types.ts` las columnas de la migración 0026 (Task 1). Todo unit; sin BD. Los montos de aportes de los goldens G1-G4 son los de la tabla contractual de Global Constraints — divergencia = bug del plan, no del código.

**ADVERTENCIA de orden (costura declarada con la Task 4):** la firma nueva de `calcularLiquidacion` ROMPE el typecheck de `apps/erp` (el consumidor se ajusta en la Task 4, misma sesión). En esta task NO se corre `pnpm build` ni `pnpm --filter erp build`; la verificación es SOLO `pnpm --filter @suite/core test`, `pnpm test` (vitest no typechequea las apps) y `npx tsc --noEmit -p packages/db/tsconfig.json` + `npx tsc --noEmit -p packages/core/tsconfig.json` (ambos paquetes tienen tsconfig propio, verificado). La Task 4 corre `pnpm --filter erp build` y cierra la costura.

**Files**

- `packages/core/src/remuneraciones.ts` — modificar: `tasa_sis` en `IndicadoresPeriodo`, 4º parámetro `tasaMutual`, reglas 9-12, 4 campos nuevos en `ResultadoLiquidacion`.
- `packages/core/src/remuneraciones.test.ts` — modificar: goldens G1-G4 y bordes extendidos con aportes + 2 tests nuevos.
- `packages/core/src/previred.ts` — **crear**: `generarPrevired`, `separarNombre`, `CODIGO_AFP_PREVIRED`, `FilaPrevired`.
- `packages/core/src/previred.test.ts` — **crear**: 8 tests (línea dorada G1 de 105 campos, heurística de nombres, códigos AFP, Isapre, estructura, fail-closed).
- `packages/core/src/index.ts` — modificar: `export * from './previred'`.
- `packages/db/src/types.ts` — modificar: espejo del codegen de la migración 0026 (`liquidaciones`, `indicadores_previsionales`, `empresas`).

**Interfaces**

Firma nueva de `calcularLiquidacion` — EXACTA (decisión de mínima ruptura: `ContratoCalculo` está documentado como "una fila de la BD se pasa directo" y `tasa_mutual` vive en `empresas`, no en `contratos`; meterla al contrato rompería ese contrato estructural. Parámetro 4º obligatorio = 1 consumidor + tests, fail-closed en compile):

```ts
export interface IndicadoresPeriodo {
  uf: number
  utm: number
  ingreso_minimo: number
  tope_imponible_uf: number
  tope_cesantia_uf: number
  tasa_sis: number // NUEVO P19: % SIS del período (varía por licitación; default BD 1.53)
  tasas_afp: Record<string, number>
  tramos_impuesto: TramoImpuesto[]
}

export interface ResultadoLiquidacion {
  sueldo_proporcional: number
  gratificacion: number
  total_imponible: number
  afp_monto: number
  salud_monto: number
  cesantia_monto: number
  impuesto_unico: number
  total_descuentos: number
  liquido: number
  // NUEVOS P19 — aportes del empleador (costo empresa, NO tocan el líquido):
  sis_monto: number
  cesantia_empleador_monto: number
  mutual_monto: number
  total_aportes: number
}

export function calcularLiquidacion(
  contrato: ContratoCalculo, // SIN cambios (sigue siendo subconjunto de contratos.Row)
  indicadores: IndicadoresPeriodo,
  inputs: InputsLiquidacion, // SIN cambios
  tasaMutual: number, // NUEVO: % de empresas.tasa_mutual (0-10; default BD 0.90)
): ResultadoLiquidacion
```

Firma nueva de `generarPrevired` — EXACTA (las Tasks 4-5 consumen ESTOS tipos):

```ts
export interface FilaPrevired {
  rut: string // como en la BD: cuerpo+DV sin puntos ni guión ('123456785')
  nombre: string // trabajadores.nombre completo; separarNombre lo divide
  periodo: string // 'AAAA-MM' de la liquidación (campos 9/10 en MMAAAA)
  dias_trabajados: number
  afp: string // slug del CHECK de contratos.afp (clave de CODIGO_AFP_PREVIRED)
  salud: string // 'fonasa' | 'isapre'
  total_imponible: number
  afp_monto: number
  sis_monto: number
  cesantia_monto: number // aporte del trabajador (0 en plazo fijo)
  cesantia_empleador_monto: number
  salud_monto: number // 7% Fonasa o monto pactado Isapre, en CLP
  mutual_monto: number
}

export const CODIGO_AFP_PREVIRED: Record<string, string>
// capital '33' · cuprum '3' · habitat '14' · modelo '34' · planvital '29' · provida '8' · uno '35'

export function separarNombre(nombre: string): { nombres: string; paterno: string; materno: string }

export function generarPrevired(filas: FilaPrevired[]): string
// TXT: una línea de 105 campos ';' por fila, cada línea termina en CRLF, SIN BOM.
// Con filas = [] devuelve ''.
```

**Ajuste del consumidor — lo implementa la Task 4 (declarado aquí porque la firma lo exige):**

- `apps/erp/app/liquidaciones/generar/page.tsx`: el select de `indicadores_previsionales` agrega `tasa_sis`; el map agrega `tasa_sis: Number(i.tasa_sis)`; la página consulta `empresas.tasa_mutual` de la empresa activa (`.eq('id', activa.id)`) y pasa la prop nueva serializable `tasaMutual: number` a `FormularioLiquidacion`.
- `apps/erp/componentes/formulario-liquidacion.tsx`: prop nueva `tasaMutual: number`; la llamada queda `calcularLiquidacion(trabajador.contrato, indicador.datos, entradas, tasaMutual)`; la vista previa gana el bloque "Costo empresa" (spec §7).

**Tabla contractual de aportes de los goldens** (tasas canónicas `tasa_sis 1.53`, `tasa_mutual 0.90`; cesantía patronal 2,4% indefinido / 3,0% plazo fijo; base cesantía = `min(imponible, round(131,9 × 39.200) = 5.170.480)` — con los indicadores 2026-06 el tope jamás muerde porque el imponible ya viene topado a 87,8 UF = 3.441.760):

| Golden | Imponible | Tipo | sis_monto | cesantia_empleador_monto | mutual_monto | total_aportes |
|---|---|---|---|---|---|---|
| G1 | 1.000.000 | indefinido | round(15.300,00) = **15.300** | round(1.000.000 × 2,4%) = round(24.000,00) = **24.000** | round(9.000,00) = **9.000** | **48.300** |
| G2 | 1.409.396 | plazo fijo | round(21.563,7588) = **21.564** | round(1.409.396 × 3,0%) = round(42.281,88) = **42.282** | round(12.684,564) = **12.685** | **76.531** |
| G3 | 3.441.760 | indefinido | round(52.658,928) = **52.659** | round(3.441.760 × 2,4%) = round(82.602,24) = **82.602** | round(30.975,84) = **30.976** | **166.237** |
| G4 | 2.709.396 | indefinido | round(41.453,7588) = **41.454** | round(2.709.396 × 2,4%) = round(65.025,504) = **65.026** | round(24.384,564) = **24.385** | **130.865** |

Bordes con `toEqual` que también ganan la capa de aportes (mismas tasas):

| Caso | Imponible | sis | ces. empleador | mutual | total |
|---|---|---|---|---|---|
| 15 días (G1 prorrateado) | 500.000 | 7.650 | 12.000 | 4.500 | 24.150 |
| Sueldo mínimo 529.000 | 661.250 | round(10.117,125) = 10.117 | 15.870 | round(5.951,25) = 5.951 | 31.938 |
| Tope cesantía forzado a 50 UF (G3) | 3.441.760 | — | round(min(3.441.760, 1.960.000) × 2,4%) = **47.040** | — | — |
| G1 como plazo fijo (test nuevo) | 1.000.000 | 15.300 | round(1.000.000 × 3,0%) = **30.000** | 9.000 | 54.300 |

- [ ] **Paso 1 — RED: extender `remuneraciones.test.ts`**

Reemplaza el contenido COMPLETO de `packages/core/src/remuneraciones.test.ts` por:

```ts
import { describe, expect, it } from 'vitest'
import {
  calcularLiquidacion,
  type ContratoCalculo,
  type IndicadoresPeriodo,
  type InputsLiquidacion,
} from './remuneraciones'

// Indicadores canónicos del período 2026-06 — MISMOS valores que siembra la
// migración 0025 (+ tasa_sis de la 0026) y que fijan los asserts pgTAP de
// emitir_liquidacion (remuneraciones.test.sql). Los goldens son compartidos
// byte a byte entre SQL y TS: divergencia = bug (specs P18 §3 y P19 §3).
const INDICADORES: IndicadoresPeriodo = {
  uf: 39200,
  utm: 69500,
  ingreso_minimo: 529000,
  tope_imponible_uf: 87.8,
  tope_cesantia_uf: 131.9,
  tasa_sis: 1.53,
  tasas_afp: {
    capital: 11.44,
    cuprum: 11.44,
    habitat: 11.27,
    modelo: 10.58,
    planvital: 11.1,
    provida: 11.45,
    uno: 10.49,
  },
  tramos_impuesto: [
    { desde_utm: 0, hasta_utm: 13.5, factor: 0, rebaja_utm: 0 },
    { desde_utm: 13.5, hasta_utm: 30, factor: 0.04, rebaja_utm: 0.54 },
    { desde_utm: 30, hasta_utm: 50, factor: 0.08, rebaja_utm: 1.74 },
    { desde_utm: 50, hasta_utm: 70, factor: 0.135, rebaja_utm: 4.49 },
    { desde_utm: 70, hasta_utm: 90, factor: 0.23, rebaja_utm: 11.14 },
    { desde_utm: 90, hasta_utm: 120, factor: 0.304, rebaja_utm: 17.8 },
    { desde_utm: 120, hasta_utm: 310, factor: 0.35, rebaja_utm: 23.32 },
    { desde_utm: 310, hasta_utm: null, factor: 0.4, rebaja_utm: 38.82 },
  ],
}

// Tasa mutual canónica de los goldens (default de empresas.tasa_mutual, P19).
const TASA_MUTUAL = 0.9

const DIAS_COMPLETOS: InputsLiquidacion = {
  dias_trabajados: 30,
  extras_imponibles: 0,
  no_imponibles: 0,
}

// Contratos de los 4 goldens (los mismos de los asserts pgTAP).
const FONASA_800: ContratoCalculo = {
  tipo: 'indefinido',
  sueldo_base: 800000,
  gratificacion_legal: true,
  afp: 'habitat',
  salud: 'fonasa',
  plan_isapre_uf: null,
}
const ISAPRE_1200: ContratoCalculo = {
  tipo: 'plazo_fijo',
  sueldo_base: 1200000,
  gratificacion_legal: true,
  afp: 'capital',
  salud: 'isapre',
  plan_isapre_uf: 5.0,
}
const FONASA_4000: ContratoCalculo = {
  tipo: 'indefinido',
  sueldo_base: 4000000,
  gratificacion_legal: true,
  afp: 'modelo',
  salud: 'fonasa',
  plan_isapre_uf: null,
}
const FONASA_2500: ContratoCalculo = {
  tipo: 'indefinido',
  sueldo_base: 2500000,
  gratificacion_legal: true,
  afp: 'habitat',
  salud: 'fonasa',
  plan_isapre_uf: null,
}

describe('calcularLiquidacion — goldens compartidos con pgTAP', () => {
  it('G1: Fonasa indefinido habitat 800.000, 30 días, 50.000 no imponibles', () => {
    expect(
      calcularLiquidacion(
        FONASA_800,
        INDICADORES,
        { ...DIAS_COMPLETOS, no_imponibles: 50000 },
        TASA_MUTUAL,
      ),
    ).toEqual({
      sueldo_proporcional: 800000, // 800.000 × 30/30
      gratificacion: 200000, // min(25% de 800.000, tope 209.396)
      total_imponible: 1000000, // bajo el tope de 87,8 UF (3.441.760)
      afp_monto: 112700, // 11,27%
      salud_monto: 70000, // 7% Fonasa
      cesantia_monto: 6000, // 0,6% indefinido
      impuesto_unico: 0, // base 811.300 < 13,5 UTM (938.250): exenta
      total_descuentos: 188700,
      liquido: 861300, // 1.000.000 + 50.000 − 188.700
      sis_monto: 15300, // round(1.000.000 × 1,53%)
      cesantia_empleador_monto: 24000, // round(1.000.000 × 2,4%) — indefinido
      mutual_monto: 9000, // round(1.000.000 × 0,90%)
      total_aportes: 48300, // 15.300 + 24.000 + 9.000; NO toca el líquido
    })
  })

  it('G2: Isapre plazo fijo capital 1.200.000 con plan 5,0 UF sobre el 7%', () => {
    expect(calcularLiquidacion(ISAPRE_1200, INDICADORES, DIAS_COMPLETOS, TASA_MUTUAL)).toEqual({
      sueldo_proporcional: 1200000,
      gratificacion: 209396, // tope 4,75 IMM/12 muerde (el 25% sería 300.000)
      total_imponible: 1409396,
      afp_monto: 161235, // round(1.409.396 × 11,44%) = round(161.234,9024)
      salud_monto: 196000, // max(98.658, 5 UF = 196.000): el plan es piso
      cesantia_monto: 0, // plazo fijo: el trabajador no cotiza
      impuesto_unico: 4556, // tramo 2: round(1.052.161 × 4% − 37.530)
      total_descuentos: 361791,
      liquido: 1047605,
      sis_monto: 21564, // round(1.409.396 × 1,53%) = round(21.563,7588)
      cesantia_empleador_monto: 42282, // round(1.409.396 × 3,0%) — plazo fijo SÍ cotiza
      mutual_monto: 12685, // round(1.409.396 × 0,90%) = round(12.684,564)
      total_aportes: 76531,
    })
  })

  it('G3: Fonasa indefinido modelo 4.000.000 sobre el tope imponible de 87,8 UF', () => {
    expect(calcularLiquidacion(FONASA_4000, INDICADORES, DIAS_COMPLETOS, TASA_MUTUAL)).toEqual({
      sueldo_proporcional: 4000000,
      gratificacion: 209396,
      total_imponible: 3441760, // topado: round(87,8 × 39.200); sin tope sería 4.209.396
      afp_monto: 364138, // round(3.441.760 × 10,58%) = round(364.138,208)
      salud_monto: 240923, // round(240.923,2)
      cesantia_monto: 20651, // round(3.441.760 × 0,6%) = round(20.650,56)
      impuesto_unico: 104354, // tramo 3: round(2.816.048 × 8% − 120.930)
      total_descuentos: 730066,
      liquido: 2711694,
      sis_monto: 52659, // round(3.441.760 × 1,53%) = round(52.658,928)
      cesantia_empleador_monto: 82602, // round(3.441.760 × 2,4%) = round(82.602,24)
      mutual_monto: 30976, // round(3.441.760 × 0,90%) = round(30.975,84)
      total_aportes: 166237,
    })
  })

  it('G4: Fonasa indefinido habitat 2.500.000 cae en tramo 3 del impuesto', () => {
    expect(calcularLiquidacion(FONASA_2500, INDICADORES, DIAS_COMPLETOS, TASA_MUTUAL)).toEqual({
      sueldo_proporcional: 2500000,
      gratificacion: 209396,
      total_imponible: 2709396,
      afp_monto: 305349, // round(305.348,9292)
      salud_monto: 189658, // round(189.657,72)
      cesantia_monto: 16256, // round(16.256,376)
      impuesto_unico: 54921, // tramo 3: round(2.198.133 × 8% − 120.930) = round(54.920,64)
      total_descuentos: 566184,
      liquido: 2143212,
      sis_monto: 41454, // round(2.709.396 × 1,53%) = round(41.453,7588)
      cesantia_empleador_monto: 65026, // round(2.709.396 × 2,4%) = round(65.025,504)
      mutual_monto: 24385, // round(2.709.396 × 0,90%) = round(24.384,564)
      total_aportes: 130865,
    })
  })
})

describe('calcularLiquidacion — bordes', () => {
  it('15 días trabajados prorratean sueldo y gratificación', () => {
    expect(
      calcularLiquidacion(
        FONASA_800,
        INDICADORES,
        { dias_trabajados: 15, extras_imponibles: 0, no_imponibles: 50000 },
        TASA_MUTUAL,
      ),
    ).toEqual({
      sueldo_proporcional: 400000, // 800.000 × 15/30
      gratificacion: 100000, // 25% de 400.000, bajo el tope
      total_imponible: 500000,
      afp_monto: 56350,
      salud_monto: 35000,
      cesantia_monto: 3000,
      impuesto_unico: 0, // base 405.650: exenta
      total_descuentos: 94350,
      liquido: 455650, // 500.000 + 50.000 − 94.350
      sis_monto: 7650, // round(500.000 × 1,53%)
      cesantia_empleador_monto: 12000, // round(500.000 × 2,4%)
      mutual_monto: 4500, // round(500.000 × 0,90%)
      total_aportes: 24150,
    })
  })

  it('plazo fijo no cotiza cesantía (mismo contrato que G1)', () => {
    const r = calcularLiquidacion(
      { ...FONASA_800, tipo: 'plazo_fijo' },
      INDICADORES,
      { ...DIAS_COMPLETOS, no_imponibles: 50000 },
      TASA_MUTUAL,
    )
    expect(r.cesantia_monto).toBe(0)
    expect(r.liquido).toBe(867300) // los 6.000 de G1 no se descuentan
  })

  it('plan Isapre bajo el 7% del imponible: rige el 7% (el plan es piso, no techo)', () => {
    const r = calcularLiquidacion(
      { ...ISAPRE_1200, plan_isapre_uf: 2.0 },
      INDICADORES,
      DIAS_COMPLETOS,
      TASA_MUTUAL,
    )
    expect(r.salud_monto).toBe(98658) // 7% de 1.409.396 > 2 UF (78.400)
    expect(r.liquido).toBe(1141053)
  })

  it('el tope de cesantía muerde cuando es menor que el imponible', () => {
    // Con los indicadores reales el tope de 131,9 UF (5.170.480) nunca muerde:
    // el imponible ya viene topado a 87,8 UF. Se fuerza un tope menor para
    // ejercitar la rama min() en paridad con la fórmula SQL — la MISMA base
    // topada rige para el trabajador (regla 6) y el empleador (regla 10).
    const r = calcularLiquidacion(
      FONASA_4000,
      { ...INDICADORES, tope_cesantia_uf: 50 },
      DIAS_COMPLETOS,
      TASA_MUTUAL,
    )
    expect(r.cesantia_monto).toBe(11760) // round(round(50 × 39.200) × 0,006) = round(11.760)
    expect(r.cesantia_empleador_monto).toBe(47040) // round(1.960.000 × 2,4%)
  })

  it('base bajo 13,5 UTM queda exenta de impuesto (sueldo mínimo)', () => {
    expect(
      calcularLiquidacion(
        { ...FONASA_800, sueldo_base: 529000 },
        INDICADORES,
        DIAS_COMPLETOS,
        TASA_MUTUAL,
      ),
    ).toEqual({
      sueldo_proporcional: 529000,
      gratificacion: 132250, // 25%, bajo el tope
      total_imponible: 661250,
      afp_monto: 74523, // round(74.522,875) — mitades lejos del cero, como round() SQL
      salud_monto: 46288, // round(46.287,5)
      cesantia_monto: 3968, // round(3.967,5)
      impuesto_unico: 0, // base 536.471 < 938.250 (13,5 UTM)
      total_descuentos: 124779,
      liquido: 536471,
      sis_monto: 10117, // round(661.250 × 1,53%) = round(10.117,125)
      cesantia_empleador_monto: 15870, // round(661.250 × 2,4%)
      mutual_monto: 5951, // round(661.250 × 0,90%) = round(5.951,25)
      total_aportes: 31938,
    })
  })

  it('los no imponibles suman al líquido sin cotizar ni tributar (G4 + 80.000)', () => {
    const r = calcularLiquidacion(
      FONASA_2500,
      INDICADORES,
      { ...DIAS_COMPLETOS, no_imponibles: 80000 },
      TASA_MUTUAL,
    )
    expect(r.total_imponible).toBe(2709396) // igual que G4
    expect(r.impuesto_unico).toBe(54921) // igual que G4
    expect(r.liquido).toBe(2223212) // 2.143.212 + 80.000
  })

  it('AFP sin tasa en los indicadores del período lanza error (la RPC también valida)', () => {
    expect(() =>
      calcularLiquidacion(
        { ...FONASA_800, afp: 'inexistente' },
        INDICADORES,
        DIAS_COMPLETOS,
        TASA_MUTUAL,
      ),
    ).toThrow('AFP sin tasa en los indicadores: inexistente')
  })

  it('un líquido negativo lanza (Isapre cara con 1 día trabajado)', () => {
    // prop 40.000; grat 10.000; imponible 50.000; afp 5.720; salud max(3.500,
    // 5 UF = 196.000) = 196.000; base −151.720 sin tramo → impuesto 0;
    // descuentos 201.720; líquido −151.720 < 0 → mismo mensaje byte-exacto
    // que el guard de la RPC (Global Constraints).
    expect(() =>
      calcularLiquidacion(
        ISAPRE_1200,
        INDICADORES,
        { ...DIAS_COMPLETOS, dias_trabajados: 1 },
        TASA_MUTUAL,
      ),
    ).toThrow('El líquido no puede ser negativo: revisa los días trabajados y los descuentos')
  })
})

describe('calcularLiquidacion — aportes del empleador (P19)', () => {
  it('plazo fijo cotiza cesantía del empleador al 3,0% aunque el trabajador no cotice', () => {
    // G1 con tipo plazo_fijo: mismo imponible 1.000.000; el trabajador deja de
    // aportar (regla 6) pero el empleador sube de 2,4% a 3,0% (regla 10).
    const r = calcularLiquidacion(
      { ...FONASA_800, tipo: 'plazo_fijo' },
      INDICADORES,
      { ...DIAS_COMPLETOS, no_imponibles: 50000 },
      TASA_MUTUAL,
    )
    expect(r.cesantia_monto).toBe(0)
    expect(r.cesantia_empleador_monto).toBe(30000) // round(1.000.000 × 3,0%)
    expect(r.sis_monto).toBe(15300) // igual que G1: el SIS no depende del tipo
    expect(r.mutual_monto).toBe(9000)
    expect(r.total_aportes).toBe(54300)
    expect(r.liquido).toBe(867300) // los aportes JAMÁS tocan el líquido
  })

  it('tasa_sis 0 y tasa_mutual 0 dejan SIS y mutual en 0 (la cesantía patronal es de ley)', () => {
    const r = calcularLiquidacion(
      FONASA_800,
      { ...INDICADORES, tasa_sis: 0 },
      { ...DIAS_COMPLETOS, no_imponibles: 50000 },
      0,
    )
    expect(r.sis_monto).toBe(0)
    expect(r.mutual_monto).toBe(0)
    expect(r.cesantia_empleador_monto).toBe(24000) // 2,4% es constante de ley, no indicador
    expect(r.total_aportes).toBe(24000)
    expect(r.liquido).toBe(861300) // idéntico a G1: las tasas de aportes no tocan al trabajador
  })
})
```

Correr y confirmar el RED:

```
pnpm --filter @suite/core test
```

Salida esperada (los 6 `toEqual` fallan por los 4 campos ausentes, el borde del tope falla por `cesantia_empleador_monto` undefined y los 2 tests nuevos fallan):

```
 Test Files  1 failed | 12 passed (13)
      Tests  9 failed | 147 passed (156)
```

- [ ] **Paso 2 — GREEN: reglas 9-12 en `remuneraciones.ts`**

Reemplaza el contenido COMPLETO de `packages/core/src/remuneraciones.ts` por:

```ts
// Espejo TS del cálculo chileno de liquidaciones de sueldo (specs Plan 18 §3
// y Plan 19 §3 — aportes del empleador). La autoridad es la RPC
// emitir_liquidacion (plpgsql, migraciones 0025/0026): este espejo existe SOLO
// para la vista previa en vivo del formulario. Ambos lados se prueban con los
// mismos goldens (unit acá, pgTAP allá): divergencia = bug.
//
// Redondeo: round() de plpgsql sobre numeric redondea mitades lejos del cero.
// Math.round coincide para valores >= 0 (mitades hacia arriba) y solo difiere
// en negativos; todos los montos de este módulo son >= 0, así que Math.round
// es un espejo fiel. La RPC debe dividir en numeric (/ 30.0, no / 30) para no
// truncar en división entera.

// Subconjunto estructural de contratos.Row (@suite/db): una fila de la BD se
// pasa directo. tipo: 'indefinido' | 'plazo_fijo'; salud: 'fonasa' | 'isapre';
// afp: clave de tasas_afp — los CHECK de la BD garantizan los valores.
// La tasa mutual NO va acá: vive en empresas, no en contratos (P19 §2), y por
// eso entra como 4º parámetro de calcularLiquidacion.
export interface ContratoCalculo {
  tipo: string
  sueldo_base: number
  gratificacion_legal: boolean
  afp: string
  salud: string
  plan_isapre_uf: number | null
}

// Tramo de la tabla SII del período (elemento del jsonb tramos_impuesto).
export interface TramoImpuesto {
  desde_utm: number
  hasta_utm: number | null
  factor: number
  rebaja_utm: number
}

// Fila de indicadores_previsionales del período, con los jsonb ya parseados.
export interface IndicadoresPeriodo {
  uf: number
  utm: number
  ingreso_minimo: number
  tope_imponible_uf: number
  tope_cesantia_uf: number
  tasa_sis: number // % SIS a cargo del empleador (P19 §2: varía por licitación)
  tasas_afp: Record<string, number>
  tramos_impuesto: TramoImpuesto[]
}

// Los únicos inputs del usuario: el resto sale de contrato + indicadores.
export interface InputsLiquidacion {
  dias_trabajados: number
  extras_imponibles: number
  no_imponibles: number
}

// Snapshot del cálculo (specs P18 §2.4 + P19 §2), todo integer CLP — las
// mismas columnas que la RPC guarda en liquidaciones. Los 4 campos de aportes
// son costo empresa: NO participan de descuentos ni líquido.
export interface ResultadoLiquidacion {
  sueldo_proporcional: number
  gratificacion: number
  total_imponible: number
  afp_monto: number
  salud_monto: number
  cesantia_monto: number
  impuesto_unico: number
  total_descuentos: number
  liquido: number
  sis_monto: number
  cesantia_empleador_monto: number
  mutual_monto: number
  total_aportes: number
}

// Catálogo compartido de AFP: slugs EXACTOS del CHECK de contratos.afp (0025,
// spec §2.2) + nombre comercial. Única fuente de la lista en las 3 apps; la
// tasa vigente de cada AFP NO vive acá (está en indicadores_previsionales).
export const AFPS = [
  { valor: 'capital', etiqueta: 'Capital' },
  { valor: 'cuprum', etiqueta: 'Cuprum' },
  { valor: 'habitat', etiqueta: 'Habitat' },
  { valor: 'modelo', etiqueta: 'Modelo' },
  { valor: 'planvital', etiqueta: 'PlanVital' },
  { valor: 'provida', etiqueta: 'ProVida' },
  { valor: 'uno', etiqueta: 'Uno' },
] as const

// Reglas 1-12 de los specs P18 §3 y P19 §3, en el MISMO orden y con los
// MISMOS redondeos intermedios que la RPC emitir_liquidacion. tasaMutual es
// el % de empresas.tasa_mutual (ley 16.744; la empresa lo edita en Módulos).
export function calcularLiquidacion(
  contrato: ContratoCalculo,
  indicadores: IndicadoresPeriodo,
  inputs: InputsLiquidacion,
  tasaMutual: number,
): ResultadoLiquidacion {
  const tasaAfp = indicadores.tasas_afp[contrato.afp]
  if (tasaAfp === undefined) throw new Error(`AFP sin tasa en los indicadores: ${contrato.afp}`)

  // 1. Sueldo proporcional a los días trabajados (mes comercial de 30 días).
  const sueldoProporcional = Math.round((contrato.sueldo_base * inputs.dias_trabajados) / 30)

  // 2. Gratificación legal: 25% de lo imponible del mes, con tope anual de
  //    4,75 ingresos mínimos prorrateado a 1/12 mensual.
  const gratificacion = contrato.gratificacion_legal
    ? Math.min(
        Math.round(0.25 * (sueldoProporcional + inputs.extras_imponibles)),
        Math.round((4.75 * indicadores.ingreso_minimo) / 12),
      )
    : 0

  // 3. Imponible topado (87,8 UF para AFP y salud).
  const totalImponible = Math.min(
    sueldoProporcional + inputs.extras_imponibles + gratificacion,
    Math.round(indicadores.tope_imponible_uf * indicadores.uf),
  )

  // 4. AFP: tasa total con comisión, del jsonb del período según el contrato.
  const afpMonto = Math.round((totalImponible * tasaAfp) / 100)

  // 5. Salud: Fonasa 7%; Isapre max(7%, plan UF) — el plan pactado es piso.
  const sietePorCiento = Math.round(totalImponible * 0.07)
  const saludMonto =
    contrato.salud === 'fonasa'
      ? sietePorCiento
      : Math.max(sietePorCiento, Math.round((contrato.plan_isapre_uf ?? 0) * indicadores.uf))

  // 6. Cesantía: base propia topada a 131,9 UF, COMPARTIDA con el aporte del
  //    empleador (regla 10). El trabajador cotiza 0,6% solo en indefinido
  //    (plazo fijo: no cotiza).
  const baseCesantia = Math.min(
    totalImponible,
    Math.round(indicadores.tope_cesantia_uf * indicadores.uf),
  )
  const cesantiaMonto = contrato.tipo === 'indefinido' ? Math.round(baseCesantia * 0.006) : 0

  // 7. Impuesto único de segunda categoría: primer tramo (en UTM) que
  //    contiene la base tributable; en un borde exacto ambos tramos dan el
  //    mismo impuesto (la tabla SII es continua). Mínimo 0.
  const baseTributable = totalImponible - afpMonto - saludMonto - cesantiaMonto
  const baseUtm = baseTributable / indicadores.utm
  const tramo = indicadores.tramos_impuesto.find(
    (t) => baseUtm >= t.desde_utm && (t.hasta_utm === null || baseUtm <= t.hasta_utm),
  )
  const impuestoUnico = tramo
    ? Math.max(0, Math.round(baseTributable * tramo.factor - tramo.rebaja_utm * indicadores.utm))
    : 0

  // 8. Totales: los no imponibles (colación/movilización) suman al líquido
  //    sin cotizar ni tributar.
  const totalDescuentos = afpMonto + saludMonto + cesantiaMonto + impuestoUnico
  const liquido = totalImponible + inputs.no_imponibles - totalDescuentos
  // Guard byte-exacto con la RPC (Global Constraints): pocos días + plan
  // Isapre como piso pueden dar líquido < 0 y el asiento nacería descuadrado.
  // La UI captura este throw y lo muestra como aviso en la vista previa.
  if (liquido < 0)
    throw new Error('El líquido no puede ser negativo: revisa los días trabajados y los descuentos')

  // 9. SIS (P19): cargo del empleador sobre el mismo imponible topado.
  const sisMonto = Math.round((totalImponible * indicadores.tasa_sis) / 100)

  // 10. Cesantía del empleador (P19): la MISMA base topada de la regla 6; a
  //     diferencia del trabajador, plazo fijo SÍ cotiza (3,0% vs 2,4%).
  const cesantiaEmpleadorMonto = Math.round(
    (baseCesantia * (contrato.tipo === 'indefinido' ? 2.4 : 3.0)) / 100,
  )

  // 11. Mutual ley 16.744 (P19): tasa de la EMPRESA (base 0,90 + adicional
  //     por actividad), snapshoteada por la RPC.
  const mutualMonto = Math.round((totalImponible * tasaMutual) / 100)

  // 12. Total de aportes (P19): costo empresa — NO descuenta del líquido.
  const totalAportes = sisMonto + cesantiaEmpleadorMonto + mutualMonto

  return {
    sueldo_proporcional: sueldoProporcional,
    gratificacion,
    total_imponible: totalImponible,
    afp_monto: afpMonto,
    salud_monto: saludMonto,
    cesantia_monto: cesantiaMonto,
    impuesto_unico: impuestoUnico,
    total_descuentos: totalDescuentos,
    liquido,
    sis_monto: sisMonto,
    cesantia_empleador_monto: cesantiaEmpleadorMonto,
    mutual_monto: mutualMonto,
    total_aportes: totalAportes,
  }
}
```

Nota de fidelidad: la regla 6 se reescribe extrayendo `baseCesantia` (antes inline en el ternario) para compartirla con la regla 10 — resultado byte-idéntico, lo prueban los goldens intactos.

Correr y confirmar el GREEN parcial:

```
pnpm --filter @suite/core test
```

Salida esperada:

```
 Test Files  13 passed (13)
      Tests  156 passed (156)
```

- [ ] **Paso 3 — RED: crear `packages/core/src/previred.test.ts`**

Contenido COMPLETO (la línea dorada de G1 va contada campo a campo — el array del test tiene EXACTAMENTE 105 entradas, numeradas 1-105 en los comentarios):

```ts
import { describe, expect, it } from 'vitest'
import { CODIGO_AFP_PREVIRED, generarPrevired, separarNombre, type FilaPrevired } from './previred'
import { AFPS } from './remuneraciones'

// Fila del golden G1 (aportes P19): imponible 1.000.000, indefinido, habitat,
// Fonasa, tasas canónicas 1,53 / 0,90. RUT y nombre de fixture (mod-11 válido,
// formato de BD: cuerpo+DV sin puntos ni guión, como trabajadores.rut).
const FILA_G1: FilaPrevired = {
  rut: '123456785',
  nombre: 'María José Pérez Soto',
  periodo: '2026-06',
  dias_trabajados: 30,
  afp: 'habitat',
  salud: 'fonasa',
  total_imponible: 1000000,
  afp_monto: 112700,
  sis_monto: 15300,
  cesantia_monto: 6000,
  cesantia_empleador_monto: 24000,
  salud_monto: 70000,
  mutual_monto: 9000,
}

// Fila del golden G2: plazo fijo capital Isapre (monto pactado 196.000 = 5 UF).
const FILA_G2: FilaPrevired = {
  rut: '876543214',
  nombre: 'Ana Díaz',
  periodo: '2026-06',
  dias_trabajados: 30,
  afp: 'capital',
  salud: 'isapre',
  total_imponible: 1409396,
  afp_monto: 161235,
  sis_monto: 21564,
  cesantia_monto: 0,
  cesantia_empleador_monto: 42282,
  salud_monto: 196000,
  mutual_monto: 12685,
}

describe('separarNombre — heurística del spec §5', () => {
  it('tres o más palabras: las últimas 2 son apellidos paterno/materno', () => {
    expect(separarNombre('María José Pérez Soto')).toEqual({
      nombres: 'María José',
      paterno: 'Pérez',
      materno: 'Soto',
    })
    expect(separarNombre('Amanda Rojas Fuentes')).toEqual({
      nombres: 'Amanda',
      paterno: 'Rojas',
      materno: 'Fuentes',
    })
  })

  it('dos palabras: nombre + apellido paterno, sin materno', () => {
    expect(separarNombre('Ana Díaz')).toEqual({ nombres: 'Ana', paterno: 'Díaz', materno: '' })
  })

  it('una palabra o vacío: solo nombres (espacios extra se ignoran)', () => {
    expect(separarNombre('Cher')).toEqual({ nombres: 'Cher', paterno: '', materno: '' })
    expect(separarNombre('   ')).toEqual({ nombres: '', paterno: '', materno: '' })
  })
})

describe('generarPrevired — TXT de carga masiva (spec §5)', () => {
  it('G1: línea dorada completa de 105 campos', () => {
    const linea = generarPrevired([FILA_G1]).split('\r\n')[0]!
    expect(linea.split(';')).toEqual([
      '12345678', // 1 RUT trabajador (sin DV)
      '5', // 2 DV
      'Pérez', // 3 apellido paterno
      'Soto', // 4 apellido materno
      'María José', // 5 nombres
      '', // 6 sexo (no almacenado)
      '0', // 7 nacionalidad (0 = chileno)
      '01', // 8 tipo de pago (01 = remuneraciones)
      '062026', // 9 período desde (MMAAAA)
      '062026', // 10 período hasta (MMAAAA)
      'AFP', // 11 régimen previsional
      '0', // 12 tipo de trabajador (0 = activo)
      '30', // 13 días trabajados
      '00', // 14 tipo de línea (00 = principal)
      '0', // 15 código movimiento de personal (0 = sin novedades)
      '', // 16 fecha desde (solo con movimiento)
      '', // 17 fecha hasta (solo con movimiento)
      '', // 18 tramo asignación familiar (no gestionada — Plan 20+)
      '0', // 19 n° cargas simples
      '0', // 20 n° cargas maternales
      '0', // 21 n° cargas inválidas
      '0', // 22 asignación familiar
      '0', // 23 asignación familiar retroactiva
      '0', // 24 reintegro cargas familiares
      '', // 25 solicitud trabajador joven
      '14', // 26 código AFP Previred (habitat)
      '1000000', // 27 renta imponible AFP
      '112700', // 28 cotización obligatoria AFP
      '15300', // 29 cotización SIS (aporte del empleador)
      '0', // 30 cuenta de ahorro voluntario AFP
      '0', // 31 renta imponible sustitutiva
      '0', // 32 tasa pactada (sustitutiva)
      '0', // 33 aporte indemnización (sustitutiva)
      '0', // 34 n° períodos (sustitutiva)
      '', // 35 período desde (sustitutiva)
      '', // 36 período hasta (sustitutiva)
      '', // 37 puesto de trabajo pesado
      '0', // 38 % cotización trabajo pesado
      '0', // 39 cotización trabajo pesado
      '', // 40 código institución APVI
      '', // 41 n° contrato APVI
      '', // 42 forma de pago APVI
      '0', // 43 cotización APVI
      '0', // 44 cotización depósitos convenidos
      '', // 45 código institución APVC
      '', // 46 n° contrato APVC
      '', // 47 forma de pago APVC
      '0', // 48 cotización trabajador APVC
      '0', // 49 cotización empleador APVC
      '0', // 50 RUT afiliado voluntario
      '', // 51 DV afiliado voluntario
      '', // 52 apellido paterno (afiliado voluntario)
      '', // 53 apellido materno (afiliado voluntario)
      '', // 54 nombres (afiliado voluntario)
      '0', // 55 código movimiento personal (afiliado voluntario)
      '', // 56 fecha desde (afiliado voluntario)
      '', // 57 fecha hasta (afiliado voluntario)
      '', // 58 código AFP (afiliado voluntario)
      '0', // 59 monto capitalización voluntaria
      '0', // 60 monto ahorro voluntario
      '0', // 61 n° períodos de cotización
      '', // 62 código ex-caja régimen
      '0', // 63 tasa cotización ex-caja
      '0', // 64 renta imponible IPS
      '0', // 65 cotización obligatoria IPS
      '0', // 66 renta imponible desahucio
      '', // 67 código ex-caja desahucio
      '0', // 68 tasa cotización desahucio
      '0', // 69 cotización desahucio
      '70000', // 70 cotización Fonasa (7% del imponible)
      '0', // 71 cotización acc. trabajo ISL
      '0', // 72 bonificación ley 15.386
      '0', // 73 descuento cargas familiares IPS
      '0', // 74 bonos gobierno
      '7', // 75 código institución de salud (7 = Fonasa)
      '', // 76 número del FUN
      '0', // 77 renta imponible Isapre
      '', // 78 moneda del plan Isapre
      '0', // 79 cotización pactada Isapre
      '0', // 80 cotización obligatoria Isapre (7%)
      '0', // 81 cotización adicional voluntaria
      '0', // 82 monto GES
      '', // 83 código CCAF
      '0', // 84 renta imponible CCAF
      '0', // 85 créditos personales CCAF
      '0', // 86 descuento dental CCAF
      '0', // 87 descuentos por leasing CCAF
      '0', // 88 descuentos por seguro de vida CCAF
      '0', // 89 otros descuentos CCAF
      '0', // 90 cotización CCAF de no afiliados a Isapre
      '0', // 91 descuento cargas familiares CCAF
      '0', // 92 otros descuentos CCAF 1
      '0', // 93 otros descuentos CCAF 2
      '0', // 94 bonos gobierno CCAF
      '', // 95 código de sucursal CCAF
      '', // 96 código mutualidad (no almacenamos cuál — límite v1)
      '1000000', // 97 renta imponible mutual
      '9000', // 98 cotización accidente del trabajo (mutual)
      '', // 99 sucursal de pago mutual
      '1000000', // 100 renta imponible seguro cesantía
      '6000', // 101 aporte trabajador seguro cesantía
      '24000', // 102 aporte empleador seguro cesantía
      '0', // 103 RUT pagadora subsidio
      '', // 104 DV pagadora subsidio
      '', // 105 centro de costos / sucursal
    ])
  })

  it('Isapre: código 0 genérico con monto pactado; campos Fonasa en cero', () => {
    const campos = generarPrevired([FILA_G2]).split('\r\n')[0]!.split(';')
    expect(campos[69]).toBe('0') // 70: cotización Fonasa vacía en Isapre
    expect(campos[74]).toBe('0') // 75: código 0 = Isapre genérica (catálogo → Plan 20)
    expect(campos[76]).toBe('1409396') // 77: renta imponible Isapre
    expect(campos[77]).toBe('1') // 78: moneda del plan en pesos (guardamos CLP)
    expect(campos[78]).toBe('196000') // 79: cotización pactada = salud_monto
    expect(campos[25]).toBe('33') // 26: AFP capital
    expect(campos[100]).toBe('0') // 101: cesantía del trabajador (plazo fijo no cotiza)
    expect(campos[101]).toBe('42282') // 102: cesantía del empleador al 3,0%
  })

  it('códigos AFP Previred: tabla fija que cubre los 7 slugs del catálogo', () => {
    expect(CODIGO_AFP_PREVIRED).toEqual({
      capital: '33',
      cuprum: '3',
      habitat: '14',
      modelo: '34',
      planvital: '29',
      provida: '8',
      uno: '35',
    })
    // Toda AFP del catálogo compartido tiene código: si AFPS crece sin tabla,
    // este test revienta antes que Previred rechace el archivo.
    for (const { valor } of AFPS) expect(CODIGO_AFP_PREVIRED[valor]).toBeDefined()
  })

  it('archivo: CRLF por línea, sin BOM, 105 campos, una línea por liquidación', () => {
    const txt = generarPrevired([FILA_G1, FILA_G2])
    expect(txt.startsWith('\uFEFF')).toBe(false) // sin BOM: lo lee Previred, no Excel
    expect(txt.endsWith('\r\n')).toBe(true)
    const lineas = txt.split('\r\n').filter((l) => l !== '')
    expect(lineas).toHaveLength(2)
    for (const linea of lineas) expect(linea.split(';')).toHaveLength(105)
    expect(generarPrevired([])).toBe('')
  })

  it('AFP sin código Previred lanza (fail-closed: jamás una línea con código vacío)', () => {
    expect(() => generarPrevired([{ ...FILA_G1, afp: 'inexistente' }])).toThrow(
      'AFP sin código Previred: inexistente',
    )
  })
})
```

Correr y confirmar el RED:

```
pnpm --filter @suite/core test
```

Salida esperada (el import de `./previred` no resuelve):

```
 Test Files  1 failed | 13 passed (14)
      Tests  156 passed (156)
 Error: Failed to resolve import "./previred" from "src/previred.test.ts"
```

- [ ] **Paso 4 — GREEN: crear `packages/core/src/previred.ts` y exportarlo**

Contenido COMPLETO (el array tiene EXACTAMENTE 105 entradas, numeradas en los comentarios — al editar, verificar que la numeración llegue a 105 sin saltos):

```ts
// Archivo PREVIRED (Plan 19 §5): TXT plano de carga masiva, 105 campos por
// línea separados por ';', líneas terminadas en CRLF, SIN BOM (lo lee
// Previred, no Excel — a diferencia de filasACsv). Formato público "Archivo
// de carga masiva" de previred.com. v1 puebla los campos del spec §5 y deja
// el resto ''/0 según el estándar; el usuario puede ajustar el TXT antes de
// subirlo y la validación final la hace Previred al cargarlo.
import { limpiarRut } from './rut'

// Una liquidación no-anulada del período, ya unida a su trabajador/contrato.
// Los montos vienen del snapshot de liquidaciones (specs P18 §2.4 + P19 §2).
export interface FilaPrevired {
  rut: string // como en la BD: cuerpo+DV sin puntos ni guión ('123456785')
  nombre: string // trabajadores.nombre completo; separarNombre lo divide
  periodo: string // 'AAAA-MM' de la liquidación
  dias_trabajados: number
  afp: string // slug del CHECK de contratos.afp
  salud: string // 'fonasa' | 'isapre'
  total_imponible: number
  afp_monto: number
  sis_monto: number
  cesantia_monto: number // aporte del trabajador (0 en plazo fijo)
  cesantia_empleador_monto: number
  salud_monto: number // 7% Fonasa o monto pactado Isapre, en CLP
  mutual_monto: number
}

// Tabla FIJA de códigos Previred por slug de AFP (spec §5). Cambia solo si
// entra una AFP nueva al catálogo AFPS de remuneraciones.ts.
export const CODIGO_AFP_PREVIRED: Record<string, string> = {
  capital: '33',
  cuprum: '3',
  habitat: '14',
  modelo: '34',
  planvital: '29',
  provida: '8',
  uno: '35',
}

// Heurística del spec §5 sobre trabajadores.nombre (no hay columnas de
// apellidos — Plan 20+): las últimas 2 palabras son apellidos paterno/materno,
// el resto son nombres; con 2 palabras: nombre + paterno; con 1: solo nombres.
export function separarNombre(nombre: string): {
  nombres: string
  paterno: string
  materno: string
} {
  const partes = nombre.trim().split(/\s+/).filter((p) => p !== '')
  if (partes.length <= 1) return { nombres: partes[0] ?? '', paterno: '', materno: '' }
  if (partes.length === 2) return { nombres: partes[0]!, paterno: partes[1]!, materno: '' }
  return {
    nombres: partes.slice(0, -2).join(' '),
    paterno: partes[partes.length - 2]!,
    materno: partes[partes.length - 1]!,
  }
}

// Los 105 campos del formato público, 1-based en los comentarios. Poblados
// v1 (spec §5): RUT/DV, nombres, movimiento 0, días, AFP + montos, cesantía
// trabajador/empleador, salud (Fonasa 7 / Isapre 0 genérica), mutual. El
// resto queda '' (texto/fecha/código) o 0 (montos/contadores).
function lineaPrevired(f: FilaPrevired): string {
  const codigoAfp = CODIGO_AFP_PREVIRED[f.afp]
  if (codigoAfp === undefined) throw new Error(`AFP sin código Previred: ${f.afp}`)
  const rut = limpiarRut(f.rut)
  const { nombres, paterno, materno } = separarNombre(f.nombre)
  const mmaaaa = f.periodo.slice(5, 7) + f.periodo.slice(0, 4)
  const fonasa = f.salud === 'fonasa'
  const campos: (string | number)[] = [
    rut.slice(0, -1), // 1 RUT trabajador (sin DV)
    rut.slice(-1), // 2 DV
    paterno, // 3 apellido paterno
    materno, // 4 apellido materno
    nombres, // 5 nombres
    '', // 6 sexo (no almacenado)
    0, // 7 nacionalidad (0 = chileno)
    '01', // 8 tipo de pago (01 = remuneraciones)
    mmaaaa, // 9 período desde (MMAAAA)
    mmaaaa, // 10 período hasta (MMAAAA)
    'AFP', // 11 régimen previsional
    0, // 12 tipo de trabajador (0 = activo)
    f.dias_trabajados, // 13 días trabajados
    '00', // 14 tipo de línea (00 = principal)
    0, // 15 código movimiento de personal (0 = sin novedades)
    '', // 16 fecha desde (solo con movimiento)
    '', // 17 fecha hasta (solo con movimiento)
    '', // 18 tramo asignación familiar (no gestionada — Plan 20+)
    0, // 19 n° cargas simples
    0, // 20 n° cargas maternales
    0, // 21 n° cargas inválidas
    0, // 22 asignación familiar
    0, // 23 asignación familiar retroactiva
    0, // 24 reintegro cargas familiares
    '', // 25 solicitud trabajador joven
    codigoAfp, // 26 código AFP Previred
    f.total_imponible, // 27 renta imponible AFP
    f.afp_monto, // 28 cotización obligatoria AFP
    f.sis_monto, // 29 cotización SIS (aporte del empleador)
    0, // 30 cuenta de ahorro voluntario AFP
    0, // 31 renta imponible sustitutiva
    0, // 32 tasa pactada (sustitutiva)
    0, // 33 aporte indemnización (sustitutiva)
    0, // 34 n° períodos (sustitutiva)
    '', // 35 período desde (sustitutiva)
    '', // 36 período hasta (sustitutiva)
    '', // 37 puesto de trabajo pesado
    0, // 38 % cotización trabajo pesado
    0, // 39 cotización trabajo pesado
    '', // 40 código institución APVI
    '', // 41 n° contrato APVI
    '', // 42 forma de pago APVI
    0, // 43 cotización APVI
    0, // 44 cotización depósitos convenidos
    '', // 45 código institución APVC
    '', // 46 n° contrato APVC
    '', // 47 forma de pago APVC
    0, // 48 cotización trabajador APVC
    0, // 49 cotización empleador APVC
    0, // 50 RUT afiliado voluntario
    '', // 51 DV afiliado voluntario
    '', // 52 apellido paterno (afiliado voluntario)
    '', // 53 apellido materno (afiliado voluntario)
    '', // 54 nombres (afiliado voluntario)
    0, // 55 código movimiento personal (afiliado voluntario)
    '', // 56 fecha desde (afiliado voluntario)
    '', // 57 fecha hasta (afiliado voluntario)
    '', // 58 código AFP (afiliado voluntario)
    0, // 59 monto capitalización voluntaria
    0, // 60 monto ahorro voluntario
    0, // 61 n° períodos de cotización
    '', // 62 código ex-caja régimen
    0, // 63 tasa cotización ex-caja
    0, // 64 renta imponible IPS
    0, // 65 cotización obligatoria IPS
    0, // 66 renta imponible desahucio
    '', // 67 código ex-caja desahucio
    0, // 68 tasa cotización desahucio
    0, // 69 cotización desahucio
    fonasa ? f.salud_monto : 0, // 70 cotización Fonasa
    0, // 71 cotización acc. trabajo ISL
    0, // 72 bonificación ley 15.386
    0, // 73 descuento cargas familiares IPS
    0, // 74 bonos gobierno
    fonasa ? '7' : '0', // 75 código institución de salud (7 Fonasa; 0 Isapre genérica, límite v1)
    '', // 76 número del FUN
    fonasa ? 0 : f.total_imponible, // 77 renta imponible Isapre
    fonasa ? '' : '1', // 78 moneda del plan Isapre (1 = pesos: guardamos CLP)
    fonasa ? 0 : f.salud_monto, // 79 cotización pactada Isapre
    0, // 80 cotización obligatoria Isapre (7%)
    0, // 81 cotización adicional voluntaria
    0, // 82 monto GES
    '', // 83 código CCAF
    0, // 84 renta imponible CCAF
    0, // 85 créditos personales CCAF
    0, // 86 descuento dental CCAF
    0, // 87 descuentos por leasing CCAF
    0, // 88 descuentos por seguro de vida CCAF
    0, // 89 otros descuentos CCAF
    0, // 90 cotización CCAF de no afiliados a Isapre
    0, // 91 descuento cargas familiares CCAF
    0, // 92 otros descuentos CCAF 1
    0, // 93 otros descuentos CCAF 2
    0, // 94 bonos gobierno CCAF
    '', // 95 código de sucursal CCAF
    '', // 96 código mutualidad (no almacenamos cuál — límite v1)
    f.total_imponible, // 97 renta imponible mutual
    f.mutual_monto, // 98 cotización accidente del trabajo (mutual)
    '', // 99 sucursal de pago mutual
    f.total_imponible, // 100 renta imponible seguro cesantía (tope 131,9 UF > tope imponible 87,8: nunca muerde)
    f.cesantia_monto, // 101 aporte trabajador seguro cesantía
    f.cesantia_empleador_monto, // 102 aporte empleador seguro cesantía
    0, // 103 RUT pagadora subsidio
    '', // 104 DV pagadora subsidio
    '', // 105 centro de costos / sucursal
  ]
  return campos.join(';')
}

// Un archivo por período: una línea por liquidación no-anulada. Sin filas
// devuelve '' (la route igual debe responder 404/vacío antes de llegar acá).
export function generarPrevired(filas: FilaPrevired[]): string {
  return filas.map((f) => lineaPrevired(f) + '\r\n').join('')
}
```

En `packages/core/src/index.ts`, agregar al final (queda como línea 15):

```ts
export * from './previred'
```

Correr y confirmar el GREEN:

```
pnpm --filter @suite/core test
```

Salida esperada:

```
 Test Files  14 passed (14)
      Tests  164 passed (164)
```

- [ ] **Paso 5 — `packages/db/src/types.ts`: espejo de la migración 0026**

El archivo replica el codegen de Supabase: claves en orden ALFABÉTICO dentro de cada bloque, columnas con default → opcionales (`?`) en `Insert`. Tres tablas se tocan; anclas del archivo real (branch actual: `empresas` ~línea 1120, `indicadores_previsionales` ~1295, `liquidaciones` ~1388).

**5a. `empresas`** — `tasa_mutual numeric(4,2) not null default 0.90` (alfabético: después de `rut`).

En `Row` (ancla: `rubro: string` seguido de `rut: string`):

```ts
          rubro: string
          rut: string
          tasa_mutual: number
```

En `Insert` (ancla: `rubro?: string` seguido de `rut: string`):

```ts
          rubro?: string
          rut: string
          tasa_mutual?: number
```

En `Update` (ancla: `rubro?: string` seguido de `rut?: string`):

```ts
          rubro?: string
          rut?: string
          tasa_mutual?: number
```

**5b. `indicadores_previsionales`** — `tasa_sis numeric(5,2) not null default 1.53` (alfabético: `tasa_sis` < `tasas_afp` porque `_` < `s`).

En `Row` (ancla: `periodo: string` seguido de `tasas_afp: Json`):

```ts
          periodo: string
          tasa_sis: number
          tasas_afp: Json
```

En `Insert` (ancla: `periodo: string` seguido de `tasas_afp: Json`):

```ts
          periodo: string
          tasa_sis?: number
          tasas_afp: Json
```

En `Update` (ancla: `periodo?: string` seguido de `tasas_afp?: Json`):

```ts
          periodo?: string
          tasa_sis?: number
          tasas_afp?: Json
```

**5c. `liquidaciones`** — 6 columnas nuevas, todas `not null default 0` → opcionales en `Insert` y `Update`. Posiciones alfabéticas exactas:

En `Row`:

- `cesantia_empleador_monto: number` ANTES de `cesantia_monto: number` (ancla: `anulada_en: string | null` seguido de `cesantia_monto: number`):

```ts
          anulada_en: string | null
          cesantia_empleador_monto: number
          cesantia_monto: number
```

- `mutual_monto: number` entre `motivo_anulacion: string | null` y `no_imponibles: number`:

```ts
          motivo_anulacion: string | null
          mutual_monto: number
          no_imponibles: number
```

- `sis_monto: number` entre `salud_monto: number` y `sueldo_base: number`:

```ts
          salud_monto: number
          sis_monto: number
          sueldo_base: number
```

- `tasa_mutual: number` y `tasa_sis: number` entre `tasa_afp: number` y `total_aportes`; `total_aportes: number` antes de `total_descuentos: number`:

```ts
          tasa_afp: number
          tasa_mutual: number
          tasa_sis: number
          total_aportes: number
          total_descuentos: number
```

En `Insert` — las mismas 6 en las mismas posiciones, todas opcionales:

```ts
          cesantia_empleador_monto?: number
```
```ts
          mutual_monto?: number
```
```ts
          sis_monto?: number
```
```ts
          tasa_mutual?: number
          tasa_sis?: number
          total_aportes?: number
```

En `Update` — idéntico a `Insert` (todas `?: number`, mismas posiciones).

Verificación de que el espejo compila — typecheck aislado de los DOS paquetes (ninguno tiene script `typecheck`; ambos tienen tsconfig propio, verificado por el ensamblador):

```
npx tsc --noEmit -p packages/db/tsconfig.json
npx tsc --noEmit -p packages/core/tsconfig.json
```

→ exit 0 y sin salida en ambos. NO correr `pnpm build` en esta task: el typecheck de `apps/erp` queda roto por diseño hasta la Task 4 (costura declarada).

- [ ] **Paso 6 — Verificación total unit + bytes sin BOM**

```
pnpm test
```

Salida esperada (**214 = 204 + 10**; core pasa de 154 a 164 con 1 archivo nuevo):

```
@suite/core:test:    Test Files  14 passed (14)
@suite/core:test:         Tests  164 passed (164)
@suite/correo:test:       Tests  13 passed (13)
@suite/dte:test:          Tests  10 passed (10)
@suite/pagos:test:        Tests  25 passed (25)
@suite/auth:test:         Tests  2 passed (2)
```

Paso de bytes (PowerShell 5.1) — los archivos nuevos NO deben partir con BOM `EF BB BF` (el TXT Previred se genera sin BOM y los fuentes tampoco lo llevan; el único BOM legítimo del repo es el escape `\uFEFF` de `filasACsv`):

```
Get-Content packages\core\src\previred.ts -Encoding Byte -TotalCount 3
Get-Content packages\core\src\previred.test.ts -Encoding Byte -TotalCount 3
```

Salida esperada (`//` + espacio = `47 47 32`; `imp` de `import` = `105 109 112`):

```
47
47
32
```

```
105
109
112
```

Si aparece `239 187 191` (BOM), reescribir el archivo como UTF-8 sin BOM antes de commitear.

- [ ] **Paso 7 — Commit**

```
git add packages/core/src/remuneraciones.ts packages/core/src/remuneraciones.test.ts packages/core/src/previred.ts packages/core/src/previred.test.ts packages/core/src/index.ts packages/db/src/types.ts
git commit -m "feat(core): aportes del empleador en el espejo TS y generador Previred de 105 campos

- calcularLiquidacion gana las reglas 9-12 (SIS, cesantía patronal 2,4/3,0,
  mutual, total_aportes) con las mismas bases topadas del P18; la firma suma
  tasaMutual como 4º parámetro (la mutual es de la empresa, no del contrato;
  el consumidor de la vista previa se ajusta en la task siguiente)
- previred.ts nuevo: generarPrevired — TXT de carga masiva de 105 campos ';'
  CRLF sin BOM, separarNombre (heurística de apellidos) y CODIGO_AFP_PREVIRED
- types.ts espejo de la migración 0026 (liquidaciones, indicadores, empresas)
- unit 204 → 214: goldens G1-G4 con capa de aportes + línea dorada Previred

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---
### Task 4: Vista previa y detalle de liquidación con costo empresa

> **Firma real fijada por la Task 3 (costura FIRMA_T3 resuelta al ensamblar; los tipos de abajo
> son copia exacta del código de la Task 3):**
>
> ```ts
> export function calcularLiquidacion(
>   contrato: ContratoCalculo,        // SIN cambios
>   indicadores: IndicadoresPeriodo,  // gana tasa_sis: number
>   inputs: InputsLiquidacion,        // SIN cambios
>   tasaMutual: number,               // NUEVO 4º parámetro obligatorio
> ): ResultadoLiquidacion             // gana sis_monto / cesantia_empleador_monto / mutual_monto / total_aportes
>
> export interface FilaPrevired {
>   rut: string
>   nombre: string
>   periodo: string // 'AAAA-MM' de la liquidación (campos 9/10 del TXT en MMAAAA)
>   dias_trabajados: number
>   afp: string
>   salud: string // 'fonasa' | 'isapre'
>   total_imponible: number
>   afp_monto: number
>   sis_monto: number
>   cesantia_monto: number
>   cesantia_empleador_monto: number
>   salud_monto: number
>   mutual_monto: number
> }
> export function generarPrevired(filas: FilaPrevired[]): string
> ```

**Files:**
- Modify: `apps/erp/app/liquidaciones/generar/page.tsx` (serializa `tasa_sis` de indicadores y `tasa_mutual` de la empresa activa)
- Modify: `apps/erp/componentes/formulario-liquidacion.tsx` (prop `tasaMutual`, llamada con la firma de la Task 3, bloque "Costo empresa" en la vista previa)
- Modify: `apps/erp/app/liquidaciones/[id]/page.tsx` (sección "Costo empresa" desde el snapshot; reemplaza la nota v1)

Esta task NO toca `packages/core` (el espejo y sus tipos son de la Task 3) ni el libro (Task 5).

**Interfaces:**
- Consumes la firma de la Task 3 (bloque de arriba): `calcularLiquidacion(contrato, indicadores, inputs, tasaMutual)` con `tasa_sis` en `IndicadoresPeriodo` y `sis_monto`/`cesantia_empleador_monto`/`mutual_monto`/`total_aportes` en `ResultadoLiquidacion`. **Costura CERRADA:** la Task 3 fijó `tasaMutual` como 4º parámetro (NO dentro de `ContratoCalculo`) — el código de abajo ya lo asume tal cual.
- **Costura de orden CERRADA en esta task:** la Task 3 dejó ROTO el typecheck de `apps/erp` (firma nueva + `tasa_sis` obligatoria). El `pnpm --filter erp build` del Paso 4 de ESTA task es el primer build que debe pasar tras la Task 3.
- Consumes migración 0026 + tipos `@suite/db` (Tasks 1 y 3): columnas `sis_monto`, `cesantia_empleador_monto`, `mutual_monto`, `total_aportes`, `tasa_sis`, `tasa_mutual` en `liquidaciones` (el detalle usa `select('*')`: fluyen solas con los tipos nuevos); `tasa_sis` en `indicadores_previsionales`; `tasa_mutual` en `empresas` (SELECT ya cubierto por la policy de fila; el grant de UPDATE por columna es asunto de Configuración, Task 6). **Costura del snapshot CERRADA:** la 0026 incluye `liquidaciones.tasa_sis`/`tasa_mutual` (spec §2, verificado) — `liq.tasa_sis`/`liq.tasa_mutual` existen en el detalle.
- Consumes existentes: `exigirRRHH()`, `crearClienteServidor()`, `formatearCLP`/`formatearRut`, `AFP_NOMBRE`/`etiquetaMes`/`ETIQUETA_ESTADO`/`TONO_ESTADO`, `emitirLiquidacion` (Server Action — NO cambia: la RPC recalcula los aportes sola), patrón de consulta puntual a `empresas` de `apps/erp/app/entregas/nueva/page.tsx:14` (`factor_volumetrico`).
- Produces: vista previa con bloque "Costo empresa" (espejo TS) y detalle con la sección "Costo empresa" desde el snapshot (también en impresión). Mensaje pre-P19 fijado por este plan (Global Constraints): `'Liquidación emitida antes de los aportes del empleador: no incluye SIS, cesantía del empleador ni mutual.'`

**Decisión de UI (verificada contra 0025):** `liquidaciones` NO snapshotea el `tipo` del contrato, así que el detalle NO puede rotular la tasa de cesantía del empleador (2,4/3,0%) — la línea va sin porcentaje. La vista previa SÍ conoce `contrato.tipo` y rotula la tasa. SIS y mutual muestran su tasa en ambos lados (snapshot en el detalle).

- [ ] **Paso 1 — `generar/page.tsx`: serializar `tasa_sis` y `tasa_mutual`**

Contenido completo final de `apps/erp/app/liquidaciones/generar/page.tsx`:

```tsx
import Link from 'next/link'
import { crearClienteServidor } from '@suite/auth/server'
import type { IndicadoresPeriodo } from '@suite/core'
import { Encabezado, Tarjeta } from '@suite/ui'
import {
  FormularioLiquidacion,
  type IndicadorGenerar,
  type TrabajadorGenerar,
} from '../../../componentes/formulario-liquidacion'
import { exigirRRHH } from '../../../lib/rrhh-acceso'

export default async function PaginaGenerar() {
  const activa = await exigirRRHH()
  const supabase = await crearClienteServidor()

  const [indicadoresRes, contratosRes, empresaRes] = await Promise.all([
    // Períodos con indicadores existentes (RLS: SELECT authenticated — tabla de plataforma).
    supabase
      .from('indicadores_previsionales')
      .select('periodo, uf, utm, ingreso_minimo, tope_imponible_uf, tope_cesantia_uf, tasa_sis, tasas_afp, tramos_impuesto')
      .order('periodo', { ascending: false })
      .limit(12),
    // Trabajadores con contrato vigente (unique parcial: a lo más uno por trabajador).
    supabase
      .from('contratos')
      .select('tipo, sueldo_base, gratificacion_legal, afp, salud, plan_isapre_uf, cargo, trabajador_id, trabajadores (nombre, rut, activo)')
      .eq('empresa_id', activa.id)
      .eq('vigente', true),
    // Tasa mutual de la EMPRESA activa (spec P19 §2): EmpresaResumen no la trae —
    // consulta puntual a empresas, patrón factor_volumetrico de entregas/nueva.
    supabase.from('empresas').select('tasa_mutual').eq('id', activa.id).single(),
  ])

  // jsonb llega tipado como Json del codegen: cast SOLO de tipo al espejo del §3.
  // tramos_impuesto exige `as unknown as` (TramoImpuesto es interface sin index
  // signature: no solapa con Json — TS2352; precedente asientos/acciones.ts:50).
  const indicadores: IndicadorGenerar[] = (indicadoresRes.data ?? []).map((i) => ({
    periodo: i.periodo,
    datos: {
      uf: i.uf,
      utm: i.utm,
      ingreso_minimo: i.ingreso_minimo,
      tope_imponible_uf: Number(i.tope_imponible_uf),
      tope_cesantia_uf: Number(i.tope_cesantia_uf),
      tasa_sis: Number(i.tasa_sis),
      tasas_afp: i.tasas_afp as Record<string, number>,
      tramos_impuesto: i.tramos_impuesto as unknown as IndicadoresPeriodo['tramos_impuesto'],
    },
  }))

  // Espejo del default de la BD (0026): si la fila no llegara, la vista previa
  // usa el 0,90% base — el servidor snapshotea la tasa REAL al emitir.
  const tasaMutual = Number(empresaRes.data?.tasa_mutual ?? 0.9)

  const trabajadores: TrabajadorGenerar[] = (contratosRes.data ?? [])
    .filter((c) => c.trabajadores?.activo)
    .map((c) => ({
      trabajador_id: c.trabajador_id,
      nombre: c.trabajadores!.nombre,
      rut: c.trabajadores!.rut,
      cargo: c.cargo,
      contrato: {
        tipo: c.tipo as 'indefinido' | 'plazo_fijo',
        sueldo_base: c.sueldo_base,
        gratificacion_legal: c.gratificacion_legal,
        afp: c.afp,
        salud: c.salud as 'fonasa' | 'isapre',
        plan_isapre_uf: c.plan_isapre_uf == null ? null : Number(c.plan_isapre_uf),
      },
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))

  if (indicadores.length === 0) {
    return (
      <div>
        <Encabezado titulo="Generar liquidación" />
        <Tarjeta className="max-w-xl">
          <p className="text-slate-600">
            No hay indicadores previsionales cargados. El administrador de la plataforma debe
            crearlos antes de emitir liquidaciones.
          </p>
        </Tarjeta>
      </div>
    )
  }
  if (trabajadores.length === 0) {
    return (
      <div>
        <Encabezado titulo="Generar liquidación" />
        <Tarjeta className="max-w-xl">
          <p className="text-slate-600">
            No hay trabajadores con contrato vigente.{' '}
            <Link className="text-marca-700 hover:underline" href="/trabajadores">
              Crea el trabajador y su contrato
            </Link>{' '}
            antes de emitir la liquidación.
          </p>
        </Tarjeta>
      </div>
    )
  }

  return (
    <div>
      <Encabezado titulo="Generar liquidación" />
      <FormularioLiquidacion trabajadores={trabajadores} indicadores={indicadores} tasaMutual={tasaMutual} />
    </div>
  )
}
```

- [ ] **Paso 2 — `formulario-liquidacion.tsx`: prop `tasaMutual` y bloque "Costo empresa"**

Contenido completo final de `apps/erp/componentes/formulario-liquidacion.tsx`:

```tsx
'use client'

import { useActionState, useState } from 'react'
import {
  calcularLiquidacion,
  formatearCLP,
  formatearRut,
  type ContratoCalculo,
  type IndicadoresPeriodo,
  type ResultadoLiquidacion,
} from '@suite/core'
import { Boton, Campo, Entrada, Selector, Tarjeta } from '@suite/ui'
import { emitirLiquidacion } from '../app/liquidaciones/acciones'
import { AFP_NOMBRE, etiquetaMes } from '../app/liquidaciones/estados'
import type { EstadoForm } from '../app/tipos'

export interface TrabajadorGenerar {
  trabajador_id: string
  nombre: string
  rut: string
  cargo: string
  contrato: ContratoCalculo
}

export interface IndicadorGenerar {
  periodo: string
  datos: IndicadoresPeriodo
}

function Linea({ concepto, monto, fuerte }: { concepto: string; monto: number; fuerte?: boolean }) {
  return (
    <div
      className={
        fuerte
          ? 'mt-1 flex justify-between gap-2 border-t border-slate-200 py-1 text-sm font-semibold'
          : 'flex justify-between gap-2 py-0.5 text-sm'
      }
    >
      <span>{concepto}</span>
      <span className="font-mono">{formatearCLP(monto)}</span>
    </div>
  )
}

export function FormularioLiquidacion({
  trabajadores,
  indicadores,
  tasaMutual,
}: {
  trabajadores: TrabajadorGenerar[]
  indicadores: IndicadorGenerar[]
  tasaMutual: number
}) {
  // La página generar garantiza arrays NO vacíos (early returns): los ! son
  // seguros bajo noUncheckedIndexedAccess.
  const [trabajadorId, setTrabajadorId] = useState(trabajadores[0]!.trabajador_id)
  const [periodo, setPeriodo] = useState(indicadores[0]!.periodo)
  const [dias, setDias] = useState('30')
  const [extras, setExtras] = useState('0')
  const [noImponibles, setNoImponibles] = useState('0')
  const [resultado, enviar, pendiente] = useActionState(emitirLiquidacion, {} as EstadoForm)

  const trabajador = trabajadores.find((t) => t.trabajador_id === trabajadorId) ?? trabajadores[0]!
  const indicador = indicadores.find((i) => i.periodo === periodo) ?? indicadores[0]!

  // La vista previa clampa igual que la action (vacío/NaN no rompe el cálculo);
  // el servidor re-valida estricto y la RPC recalcula TODO (spec §3).
  const entradas = {
    dias_trabajados: Math.min(30, Math.max(1, Math.trunc(Number(dias)) || 30)),
    extras_imponibles: Math.max(0, Math.trunc(Number(extras)) || 0),
    no_imponibles: Math.max(0, Math.trunc(Number(noImponibles)) || 0),
  }
  const tasaAfp = indicador.datos.tasas_afp[trabajador.contrato.afp]
  // El espejo LANZA con líquido negativo (mismo guard byte-exacto que la RPC,
  // Global Constraints): acá se captura y se muestra como aviso — la vista
  // previa jamás rompe el render.
  let previa: ResultadoLiquidacion | null = null
  let aviso: string | null = null
  if (tasaAfp == null) {
    aviso = `El período no tiene tasa para la AFP ${AFP_NOMBRE[trabajador.contrato.afp] ?? trabajador.contrato.afp}: pide al administrador de la plataforma completar los indicadores.`
  } else {
    try {
      // Firma Task 3: tasa_mutual como 4º parámetro (tasa_sis viaja en indicador.datos).
      previa = calcularLiquidacion(trabajador.contrato, indicador.datos, entradas, tasaMutual)
    } catch (e) {
      aviso = e instanceof Error ? e.message : 'No se pudo calcular la vista previa'
    }
  }

  return (
    <form action={enviar} className="grid max-w-5xl gap-6 md:grid-cols-2">
      <Tarjeta className="grid gap-4 self-start">
        <Campo etiqueta="Trabajador">
          <Selector name="trabajador_id" value={trabajadorId} onChange={(e) => setTrabajadorId(e.target.value)}>
            {trabajadores.map((t) => (
              <option key={t.trabajador_id} value={t.trabajador_id}>
                {t.nombre} — {formatearRut(t.rut)}
              </option>
            ))}
          </Selector>
        </Campo>
        <Campo etiqueta="Período">
          <Selector name="periodo" value={periodo} onChange={(e) => setPeriodo(e.target.value)}>
            {indicadores.map((i) => (
              <option key={i.periodo} value={i.periodo}>{etiquetaMes(i.periodo)}</option>
            ))}
          </Selector>
        </Campo>
        <Campo etiqueta="Días trabajados (1 a 30)">
          <Entrada name="dias" type="number" min={1} max={30} step={1} required value={dias} onChange={(e) => setDias(e.target.value)} />
        </Campo>
        <Campo etiqueta="Extras imponibles (CLP)">
          <Entrada name="extras" type="number" min={0} step={1} value={extras} onChange={(e) => setExtras(e.target.value)} />
        </Campo>
        <Campo etiqueta="No imponibles: colación y movilización (CLP)">
          <Entrada name="no_imponibles" type="number" min={0} step={1} value={noImponibles} onChange={(e) => setNoImponibles(e.target.value)} />
        </Campo>
        <div className="flex flex-wrap items-center gap-3">
          <Boton type="submit" disabled={pendiente || previa == null}>
            {pendiente ? 'Emitiendo…' : 'Emitir liquidación'}
          </Boton>
          {resultado.error && <span className="text-sm text-red-600">{resultado.error}</span>}
        </div>
      </Tarjeta>

      <Tarjeta>
        <h2 className="mb-1 text-lg font-semibold text-slate-800">Vista previa</h2>
        <p className="mb-3 text-sm text-slate-500">
          {trabajador.nombre} · {trabajador.cargo} · {etiquetaMes(indicador.periodo)}. El cálculo
          definitivo lo hace el servidor al emitir.
        </p>
        {aviso && <p className="text-sm text-amber-700">{aviso}</p>}
        {previa != null && tasaAfp != null && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <h3 className="mb-2 border-b border-slate-200 pb-1 text-sm font-semibold uppercase text-slate-600">Haberes</h3>
              <Linea concepto={`Sueldo base proporcional (${entradas.dias_trabajados} días)`} monto={previa.sueldo_proporcional} />
              <Linea concepto="Gratificación legal" monto={previa.gratificacion} />
              <Linea concepto="Extras imponibles" monto={entradas.extras_imponibles} />
              <Linea concepto="No imponibles" monto={entradas.no_imponibles} />
              <Linea concepto="Total imponible" monto={previa.total_imponible} fuerte />
            </div>
            <div>
              <h3 className="mb-2 border-b border-slate-200 pb-1 text-sm font-semibold uppercase text-slate-600">Descuentos</h3>
              <Linea
                concepto={`AFP ${AFP_NOMBRE[trabajador.contrato.afp] ?? trabajador.contrato.afp} (${tasaAfp.toLocaleString('es-CL')}%)`}
                monto={previa.afp_monto}
              />
              <Linea
                concepto={
                  trabajador.contrato.salud === 'fonasa'
                    ? 'Salud Fonasa (7%)'
                    : `Salud Isapre (plan ${(trabajador.contrato.plan_isapre_uf ?? 0).toLocaleString('es-CL')} UF)`
                }
                monto={previa.salud_monto}
              />
              <Linea concepto="Seguro de cesantía (0,6%)" monto={previa.cesantia_monto} />
              <Linea concepto="Impuesto único" monto={previa.impuesto_unico} />
              <Linea concepto="Total descuentos" monto={previa.total_descuentos} fuerte />
            </div>
            <div className="flex items-center justify-between rounded-md bg-slate-100 px-3 py-2 text-lg font-semibold sm:col-span-2">
              <span>Líquido a pagar</span>
              <span className="font-mono">{formatearCLP(previa.liquido)}</span>
            </div>
            {/* Costo empresa (spec P19 §7): los aportes NO restan del líquido —
                son costo del empleador. La vista previa SÍ conoce contrato.tipo
                y rotula la tasa de cesantía patronal (el detalle no: no hay
                snapshot de tipo en liquidaciones). */}
            <div className="sm:col-span-2">
              <h3 className="mb-2 border-b border-slate-200 pb-1 text-sm font-semibold uppercase text-slate-600">Costo empresa</h3>
              <Linea concepto={`SIS (${indicador.datos.tasa_sis.toLocaleString('es-CL')}%)`} monto={previa.sis_monto} />
              <Linea
                concepto={`Cesantía empleador (${trabajador.contrato.tipo === 'indefinido' ? '2,4' : '3,0'}%)`}
                monto={previa.cesantia_empleador_monto}
              />
              <Linea concepto={`Mutual ley 16.744 (${tasaMutual.toLocaleString('es-CL')}%)`} monto={previa.mutual_monto} />
              <Linea concepto="Total aportes del empleador" monto={previa.total_aportes} fuerte />
              <Linea
                concepto="Costo total empresa (imponible + no imponibles + aportes)"
                monto={previa.total_imponible + entradas.no_imponibles + previa.total_aportes}
                fuerte
              />
            </div>
          </div>
        )}
      </Tarjeta>
    </form>
  )
}
```

- [ ] **Paso 3 — `[id]/page.tsx`: sección "Costo empresa" desde el snapshot (también en print)**

Contenido completo final de `apps/erp/app/liquidaciones/[id]/page.tsx`:

```tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP, formatearRut } from '@suite/core'
import { Encabezado, Insignia, Tarjeta } from '@suite/ui'
import { AccionesLiquidacion } from '../../../componentes/acciones-liquidacion'
import { BotonImprimir } from '../../../componentes/boton-imprimir'
import { exigirRRHH } from '../../../lib/rrhh-acceso'
import { AFP_NOMBRE, ETIQUETA_ESTADO, TONO_ESTADO, etiquetaMes } from '../estados'

function Linea({ concepto, monto, fuerte }: { concepto: string; monto: number; fuerte?: boolean }) {
  return (
    <div
      className={
        fuerte
          ? 'mt-1 flex justify-between gap-2 border-t border-slate-200 py-1 text-sm font-semibold'
          : 'flex justify-between gap-2 py-0.5 text-sm'
      }
    >
      <span>{concepto}</span>
      <span className="font-mono">{formatearCLP(monto)}</span>
    </div>
  )
}

export default async function DetalleLiquidacion({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const activa = await exigirRRHH()
  const supabase = await crearClienteServidor()
  const { data: liq } = await supabase
    .from('liquidaciones')
    .select('*, trabajadores (nombre, rut)')
    .eq('id', id)
    .eq('empresa_id', activa.id)
    .single()
  if (!liq) notFound()

  // Traza contable (patrón P16, como el detalle de asiento a la inversa): el asiento
  // de la liquidación vive en asientos (origen 'remuneracion', referencia_id).
  const { data: asiento } = await supabase
    .from('asientos')
    .select('id, numero')
    .eq('empresa_id', activa.id)
    .eq('origen', 'remuneracion')
    .eq('referencia_id', liq.id)
    .maybeSingle()

  const saludEtiqueta =
    liq.salud === 'fonasa'
      ? 'Salud Fonasa (7%)'
      : `Salud Isapre (plan ${Number(liq.plan_isapre_uf ?? 0).toLocaleString('es-CL')} UF)`

  // Liquidaciones emitidas ANTES del P19 (spec §2, límite declarado): la 0026
  // backfillea aportes en 0 y el snapshot tasa_sis en 0. total_aportes = 0 con
  // tasa_sis > 0 sería un caso real (imponible minúsculo) — por eso el AND.
  const esPreP19 = liq.total_aportes === 0 && Number(liq.tasa_sis) === 0

  return (
    <div>
      <div className="print:hidden">
        <Encabezado titulo={`Liquidación ${etiquetaMes(liq.periodo)} — ${liq.trabajadores?.nombre ?? ''}`}>
          <Insignia tono={TONO_ESTADO[liq.estado] ?? 'gris'}>{ETIQUETA_ESTADO[liq.estado] ?? liq.estado}</Insignia>
          {liq.estado !== 'anulada' && <BotonImprimir />}
        </Encabezado>
      </div>

      <div className="mb-4 hidden print:block">
        <h1 className="text-xl font-bold">{activa.razon_social}</h1>
        <p className="text-sm text-slate-600">{formatearRut(activa.rut)}</p>
        <h2 className="mt-2 text-lg font-semibold">LIQUIDACIÓN DE SUELDO — {etiquetaMes(liq.periodo)}</h2>
      </div>

      <Tarjeta className="mb-4 max-w-3xl">
        <p>
          <strong>Trabajador:</strong> {liq.trabajadores?.nombre}{' '}
          {liq.trabajadores && <>({formatearRut(liq.trabajadores.rut)})</>}
        </p>
        <p className="mt-1 text-sm text-slate-600">
          Período: {etiquetaMes(liq.periodo)} · Días trabajados: {liq.dias_trabajados} · Sueldo base:{' '}
          {formatearCLP(liq.sueldo_base)}
        </p>
        {/* Snapshot de contexto (spec §2.4): la liquidación se explica sola aunque
            cambien contrato o indicadores. */}
        <p className="mt-1 text-sm text-slate-600">
          Indicadores del período: UF {formatearCLP(liq.uf)} · UTM {formatearCLP(liq.utm)}
        </p>
        {liq.emitida_en && (
          <p className="mt-1 text-sm text-slate-600">
            Emitida el {new Date(liq.emitida_en).toLocaleDateString('es-CL')}
            {liq.pagada_en && <> · Pagada el {new Date(liq.pagada_en).toLocaleDateString('es-CL')}</>}
          </p>
        )}
        {liq.estado === 'anulada' && liq.motivo_anulacion && (
          <p className="mt-2 text-sm text-red-700"><strong>Motivo de anulación:</strong> {liq.motivo_anulacion}</p>
        )}
      </Tarjeta>

      <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
        <Tarjeta>
          <h3 className="mb-2 border-b border-slate-200 pb-1 text-sm font-semibold uppercase text-slate-600">Haberes</h3>
          <Linea concepto={`Sueldo base proporcional (${liq.dias_trabajados} días)`} monto={liq.sueldo_proporcional} />
          <Linea concepto="Gratificación legal" monto={liq.gratificacion} />
          <Linea concepto="Extras imponibles" monto={liq.extras_imponibles} />
          <Linea concepto="No imponibles (colación y movilización)" monto={liq.no_imponibles} />
          <Linea concepto="Total imponible" monto={liq.total_imponible} fuerte />
        </Tarjeta>
        <Tarjeta>
          <h3 className="mb-2 border-b border-slate-200 pb-1 text-sm font-semibold uppercase text-slate-600">Descuentos</h3>
          <Linea
            concepto={`AFP ${AFP_NOMBRE[liq.afp] ?? liq.afp} (${Number(liq.tasa_afp).toLocaleString('es-CL')}%)`}
            monto={liq.afp_monto}
          />
          <Linea concepto={saludEtiqueta} monto={liq.salud_monto} />
          <Linea concepto="Seguro de cesantía (0,6%)" monto={liq.cesantia_monto} />
          <Linea concepto="Impuesto único" monto={liq.impuesto_unico} />
          <Linea concepto="Total descuentos" monto={liq.total_descuentos} fuerte />
        </Tarjeta>
      </div>

      <div className="mt-4 flex max-w-3xl items-center justify-between rounded-md bg-slate-100 px-4 py-3 text-xl font-semibold">
        <span>TOTAL LÍQUIDO</span>
        <span className="font-mono">{formatearCLP(liq.liquido)}</span>
      </div>

      {/* Costo empresa (spec P19 §7): aportes del empleador desde el SNAPSHOT —
          reemplaza la nota v1 "no incluye aportes del empleador" y también sale
          en la impresión (sin print:hidden). Sin tasa en cesantía empleador:
          liquidaciones no snapshotea el tipo de contrato (0025). */}
      <Tarjeta className="mt-4 max-w-3xl">
        <h3 className="mb-2 border-b border-slate-200 pb-1 text-sm font-semibold uppercase text-slate-600">Costo empresa</h3>
        {esPreP19 ? (
          <p className="text-sm text-slate-500">
            Liquidación emitida antes de los aportes del empleador: no incluye SIS, cesantía del
            empleador ni mutual.
          </p>
        ) : (
          <>
            <Linea concepto={`SIS (${Number(liq.tasa_sis).toLocaleString('es-CL')}%)`} monto={liq.sis_monto} />
            <Linea concepto="Cesantía empleador" monto={liq.cesantia_empleador_monto} />
            <Linea concepto={`Mutual ley 16.744 (${Number(liq.tasa_mutual).toLocaleString('es-CL')}%)`} monto={liq.mutual_monto} />
            <Linea concepto="Total aportes del empleador" monto={liq.total_aportes} fuerte />
            <Linea
              concepto="Costo total empresa (imponible + no imponibles + aportes)"
              monto={liq.total_imponible + liq.no_imponibles + liq.total_aportes}
              fuerte
            />
          </>
        )}
      </Tarjeta>

      <div className="mt-6 max-w-3xl print:hidden">
        {asiento ? (
          <p className="text-sm text-slate-600">
            Contabilizada en el{' '}
            <Link className="text-marca-700 hover:underline" href={`/contabilidad/asientos/${asiento.id}`}>
              Asiento N° {asiento.numero}
            </Link>.
          </p>
        ) : (
          liq.estado !== 'anulada' && (
            <p className="text-sm text-slate-500">
              Sin asiento contable todavía: se genera con Contabilizar pendientes si el módulo de
              contabilidad está activo.
            </p>
          )
        )}
      </div>

      <div className="mt-4 print:hidden">
        {liq.estado === 'anulada' ? (
          <p className="text-sm text-slate-600">
            Liquidación anulada: puedes volver a{' '}
            <Link className="text-marca-700 hover:underline" href="/liquidaciones/generar">
              emitir la liquidación del período
            </Link>.
          </p>
        ) : (
          <AccionesLiquidacion liquidacionId={liq.id} estado={liq.estado} />
        )}
      </div>
    </div>
  )
}
```

- [ ] **Paso 4 — Verificación**

```
node -e "const fs=require('fs');const con=process.argv.slice(1).filter(a=>fs.readFileSync(a)[0]===0xEF);if(con.length){console.error('BOM en: '+con.join(', '));process.exit(1)}console.log('sin BOM')" apps/erp/app/liquidaciones/generar/page.tsx "apps/erp/app/liquidaciones/[id]/page.tsx" apps/erp/componentes/formulario-liquidacion.tsx
pnpm --filter erp build
```

Salida esperada: `sin BOM`; build con exit 0 y `✓ Compiled successfully`, con `ƒ /liquidaciones/generar` y `ƒ /liquidaciones/[id]` en el listado de rutas (este build CIERRA la costura de orden que dejó abierta la Task 3). Si TypeScript reclama `tasa_sis`/`tasa_mutual`/`sis_monto` inexistentes, faltan la migración 0026 o los tipos regenerados (Tasks 1 y 3) o el espejo de la Task 3 — NO parchear con casts.

Recordatorio de entorno: `pnpm build` pisa el `.next` de los dev servers — reiniciarlos después. Smoke manual con la demo: `http://localhost:3001/liquidaciones/generar` muestra el bloque "Costo empresa" en la vista previa; emitir y verificar que el detalle muestra la misma sección con los snapshots; una liquidación del seed viejo (si existiera sin re-seed) muestra la nota pre-P19.

- [ ] **Paso 5 — Commit**

```
git add apps/erp/app/liquidaciones/generar/page.tsx "apps/erp/app/liquidaciones/[id]/page.tsx" apps/erp/componentes/formulario-liquidacion.tsx
git commit -m "feat(erp): costo empresa en la vista previa y el detalle de liquidación

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Salida esperada: commit creado en la rama del plan con 3 archivos modificados.

---
### Task 5: Libro de remuneraciones ampliado con aportes y archivo Previred

**Files:**
- Modify: `apps/erp/app/libro-remuneraciones/page.tsx` (4 columnas nuevas + totales + botón "Archivo Previred")
- Modify: `apps/erp/app/libro-remuneraciones/export/route.ts` (paridad de columnas en el CSV)
- Create: `apps/erp/app/libro-remuneraciones/previred/route.ts` (descarga del TXT Previred)

**Interfaces:**
- Consumes la firma REAL de la Task 3 (costura FIRMA_T3 resuelta al ensamblar): `generarPrevired(filas: FilaPrevired[]): string` de `@suite/core` — TXT de 105 campos `;`, CRLF, SIN BOM (el BOM lo agrega `filasACsv` para Excel; Previred NO lo lleva — por eso el route responde el string tal cual). `FilaPrevired` EXACTA de la Task 3: `{ rut, nombre, periodo, dias_trabajados, afp, salud, total_imponible, afp_monto, sis_monto, cesantia_monto, cesantia_empleador_monto, salud_monto, mutual_monto }` — **incluye `periodo: string`** ('AAAA-MM'; campos 9/10 del TXT en MMAAAA). El `.map()` del Paso 3 lo puebla desde la variable `periodo` del route (todas las filas son del período consultado, `.eq('periodo', periodo)`).
- Consumes migración 0026 + tipos (Tasks 1 y 3): columnas `sis_monto`, `cesantia_empleador_monto`, `mutual_monto`, `total_aportes` en `liquidaciones`.
- Consumes existentes: `puedeVerRRHH`/`obtenerEmpresaActiva` (guards idénticos al export CSV vigente), `periodoAnterior`/`rangoDeMes`/`filasACsv`/`formatearCLP`/`formatearRut` de `@suite/core`.
- Produces: tabla y CSV con SIS / Cesantía empleador / Mutual / Costo empresa (paridad total); route `GET /libro-remuneraciones/previred?periodo=` → `text/plain; charset=utf-8`, `previred-YYYY-MM.txt`, con guards 401/403/fallback EXACTOS al export CSV.

**Definición contractual:** `Costo empresa` por fila = `total_imponible + no_imponibles + total_aportes` (misma fórmula del detalle, Task 4). La consulta del libro y del CSV suma `no_imponibles` y `total_aportes` al select SOLO para esa columna calculada.

- [ ] **Paso 1 — `page.tsx`: columnas nuevas, totales y botón Previred**

Contenido completo final de `apps/erp/app/libro-remuneraciones/page.tsx`:

```tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP, formatearRut, periodoAnterior, rangoDeMes } from '@suite/core'
import { Boton, Encabezado, Entrada, Tabla, Td, Th, Tr } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import { puedeVerRRHH } from '../../lib/rrhh-acceso'

interface Fila {
  id: string
  dias_trabajados: number
  total_imponible: number
  no_imponibles: number
  afp_monto: number
  salud_monto: number
  cesantia_monto: number
  impuesto_unico: number
  liquido: number
  sis_monto: number
  cesantia_empleador_monto: number
  mutual_monto: number
  total_aportes: number
  trabajadores: { rut: string; nombre: string } | null
}

export default async function PaginaLibroRemuneraciones({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string }>
}) {
  const { periodo: qPeriodo } = await searchParams
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  // Guard de rol (paridad con el route de export — lección P12): el libro es
  // dueno/admin/contador vía puedeVerRRHH (guard único de Personas, Task 5).
  // Vendedor/bodeguero → 404 (el NAV ya les oculta Personas; esto cubre la
  // URL directa).
  if (!puedeVerRRHH(activa)) notFound()

  // Período por defecto: el mes ANTERIOR (las remuneraciones se liquidan por
  // mes vencido). Un ?periodo= inválido cae al por defecto (fallback silencioso,
  // patrón de los exports de contabilidad; paridad con el route).
  const porDefecto = periodoAnterior(new Date().toISOString().slice(0, 7))!
  const periodo = qPeriodo && rangoDeMes(qPeriodo) ? qPeriodo : porDefecto

  const supabase = await crearClienteServidor()
  const { data, error } = await supabase
    .from('liquidaciones')
    .select('id, dias_trabajados, total_imponible, no_imponibles, afp_monto, salud_monto, cesantia_monto, impuesto_unico, liquido, sis_monto, cesantia_empleador_monto, mutual_monto, total_aportes, trabajadores (rut, nombre)')
    .eq('empresa_id', activa.id)
    .eq('periodo', periodo)
    .neq('estado', 'anulada')
  if (error) throw new Error('No se pudo cargar el libro de remuneraciones')
  // Orden alfabético por trabajador (PostgREST no ordena el padre por columnas
  // del join embebido) — el export ordena igual.
  const filas = ((data ?? []) as Fila[]).sort((a, b) =>
    (a.trabajadores?.nombre ?? '').localeCompare(b.trabajadores?.nombre ?? '', 'es')
  )
  const tot = filas.reduce(
    (t, f) => ({
      imponible: t.imponible + f.total_imponible,
      afp: t.afp + f.afp_monto,
      salud: t.salud + f.salud_monto,
      cesantia: t.cesantia + f.cesantia_monto,
      impuesto: t.impuesto + f.impuesto_unico,
      liquido: t.liquido + f.liquido,
      sis: t.sis + f.sis_monto,
      cesEmpleador: t.cesEmpleador + f.cesantia_empleador_monto,
      mutual: t.mutual + f.mutual_monto,
      costo: t.costo + f.total_imponible + f.no_imponibles + f.total_aportes,
    }),
    { imponible: 0, afp: 0, salud: 0, cesantia: 0, impuesto: 0, liquido: 0, sis: 0, cesEmpleador: 0, mutual: 0, costo: 0 }
  )

  return (
    <div>
      <Encabezado titulo="Libro de remuneraciones">
        <Link href={`/libro-remuneraciones/previred?periodo=${periodo}`}>
          <Boton variante="secundario">Archivo Previred</Boton>
        </Link>
        <Link href={`/libro-remuneraciones/export?periodo=${periodo}`}>
          <Boton variante="secundario">Exportar CSV</Boton>
        </Link>
      </Encabezado>
      <form className="mb-4 flex items-end gap-3" action="/libro-remuneraciones" method="get">
        <label className="text-sm text-slate-600">
          Período
          <Entrada type="month" name="periodo" defaultValue={periodo} className="mt-1 w-44" />
        </label>
        <Boton variante="secundario" type="submit">Ver período</Boton>
      </form>
      <Tabla>
        <thead>
          <tr>
            <Th>RUT</Th>
            <Th>Nombre</Th>
            <Th className="text-right">Días</Th>
            <Th className="text-right">Imponible</Th>
            <Th className="text-right">AFP</Th>
            <Th className="text-right">Salud</Th>
            <Th className="text-right">Cesantía</Th>
            <Th className="text-right">Impuesto único</Th>
            <Th className="text-right">Líquido</Th>
            <Th className="text-right">SIS</Th>
            <Th className="text-right">Ces. empleador</Th>
            <Th className="text-right">Mutual</Th>
            <Th className="text-right">Costo empresa</Th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <Tr key={f.id}>
              <Td className="font-mono">{f.trabajadores ? formatearRut(f.trabajadores.rut) : '—'}</Td>
              <Td>{f.trabajadores?.nombre ?? '—'}</Td>
              <Td className="text-right font-mono">{f.dias_trabajados}</Td>
              <Td className="text-right font-mono">{formatearCLP(f.total_imponible)}</Td>
              <Td className="text-right font-mono">{formatearCLP(f.afp_monto)}</Td>
              <Td className="text-right font-mono">{formatearCLP(f.salud_monto)}</Td>
              <Td className="text-right font-mono">{formatearCLP(f.cesantia_monto)}</Td>
              <Td className="text-right font-mono">{formatearCLP(f.impuesto_unico)}</Td>
              <Td className="text-right font-mono">{formatearCLP(f.liquido)}</Td>
              <Td className="text-right font-mono">{formatearCLP(f.sis_monto)}</Td>
              <Td className="text-right font-mono">{formatearCLP(f.cesantia_empleador_monto)}</Td>
              <Td className="text-right font-mono">{formatearCLP(f.mutual_monto)}</Td>
              <Td className="text-right font-mono">{formatearCLP(f.total_imponible + f.no_imponibles + f.total_aportes)}</Td>
            </Tr>
          ))}
          {filas.length === 0 && (
            <Tr>
              <Td colSpan={13} className="py-8 text-center text-slate-500">
                Sin liquidaciones en el período {periodo}.
              </Td>
            </Tr>
          )}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-slate-300 font-semibold">
            <Td colSpan={3} className="text-right">Totales del período</Td>
            <Td className="text-right font-mono">{formatearCLP(tot.imponible)}</Td>
            <Td className="text-right font-mono">{formatearCLP(tot.afp)}</Td>
            <Td className="text-right font-mono">{formatearCLP(tot.salud)}</Td>
            <Td className="text-right font-mono">{formatearCLP(tot.cesantia)}</Td>
            <Td className="text-right font-mono">{formatearCLP(tot.impuesto)}</Td>
            <Td className="text-right font-mono">{formatearCLP(tot.liquido)}</Td>
            <Td className="text-right font-mono">{formatearCLP(tot.sis)}</Td>
            <Td className="text-right font-mono">{formatearCLP(tot.cesEmpleador)}</Td>
            <Td className="text-right font-mono">{formatearCLP(tot.mutual)}</Td>
            <Td className="text-right font-mono">{formatearCLP(tot.costo)}</Td>
          </tr>
        </tfoot>
      </Tabla>
      <p className="mt-2 text-sm text-slate-500">
        Solo liquidaciones emitidas o pagadas del período; las anuladas quedan fuera del libro.
        Costo empresa = imponible + no imponibles + aportes del empleador.
      </p>
    </div>
  )
}
```

- [ ] **Paso 2 — `export/route.ts`: paridad de columnas en el CSV**

Contenido completo final de `apps/erp/app/libro-remuneraciones/export/route.ts`:

```ts
import { crearClienteServidor } from '@suite/auth/server'
import { filasACsv, formatearRut, periodoAnterior, rangoDeMes } from '@suite/core'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { puedeVerRRHH } from '../../../lib/rrhh-acceso'

interface Fila {
  dias_trabajados: number
  total_imponible: number
  no_imponibles: number
  afp_monto: number
  salud_monto: number
  cesantia_monto: number
  impuesto_unico: number
  liquido: number
  sis_monto: number
  cesantia_empleador_monto: number
  mutual_monto: number
  total_aportes: number
  trabajadores: { rut: string; nombre: string } | null
}

export async function GET(req: Request) {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return new Response('No autorizado', { status: 401 })
  // Guard de rol EXPLÍCITO (lección P12): rol sin permiso → 403, jamás un CSV
  // vacío. Paridad con el notFound() por rol de la página (mismo predicado).
  if (!puedeVerRRHH(activa)) {
    return new Response('No autorizado', { status: 403 })
  }
  // Paridad con la página: ?periodo= inválido cae al mes anterior (fallback
  // silencioso, patrón de los exports de contabilidad).
  const qPeriodo = new URL(req.url).searchParams.get('periodo')
  const periodo =
    qPeriodo && rangoDeMes(qPeriodo) ? qPeriodo : periodoAnterior(new Date().toISOString().slice(0, 7))!

  const supabase = await crearClienteServidor()
  const { data, error } = await supabase
    .from('liquidaciones')
    .select('dias_trabajados, total_imponible, no_imponibles, afp_monto, salud_monto, cesantia_monto, impuesto_unico, liquido, sis_monto, cesantia_empleador_monto, mutual_monto, total_aportes, trabajadores (rut, nombre)')
    .eq('empresa_id', activa.id)
    .eq('periodo', periodo)
    .neq('estado', 'anulada')
  if (error) return new Response('No se pudo generar el libro', { status: 500 })
  const filas = ((data ?? []) as Fila[]).sort((a, b) =>
    (a.trabajadores?.nombre ?? '').localeCompare(b.trabajadores?.nombre ?? '', 'es')
  )
  const tot = filas.reduce(
    (t, f) => ({
      imponible: t.imponible + f.total_imponible,
      afp: t.afp + f.afp_monto,
      salud: t.salud + f.salud_monto,
      cesantia: t.cesantia + f.cesantia_monto,
      impuesto: t.impuesto + f.impuesto_unico,
      liquido: t.liquido + f.liquido,
      sis: t.sis + f.sis_monto,
      cesEmpleador: t.cesEmpleador + f.cesantia_empleador_monto,
      mutual: t.mutual + f.mutual_monto,
      costo: t.costo + f.total_imponible + f.no_imponibles + f.total_aportes,
    }),
    { imponible: 0, afp: 0, salud: 0, cesantia: 0, impuesto: 0, liquido: 0, sis: 0, cesEmpleador: 0, mutual: 0, costo: 0 }
  )

  const cuerpo: (string | number | null)[][] = filas.map((f) => [
    f.trabajadores ? formatearRut(f.trabajadores.rut) : '',
    f.trabajadores?.nombre ?? '',
    f.dias_trabajados,
    f.total_imponible,
    f.afp_monto,
    f.salud_monto,
    f.cesantia_monto,
    f.impuesto_unico,
    f.liquido,
    f.sis_monto,
    f.cesantia_empleador_monto,
    f.mutual_monto,
    f.total_imponible + f.no_imponibles + f.total_aportes,
  ])
  cuerpo.push([
    'Totales del período',
    '',
    '',
    tot.imponible,
    tot.afp,
    tot.salud,
    tot.cesantia,
    tot.impuesto,
    tot.liquido,
    tot.sis,
    tot.cesEmpleador,
    tot.mutual,
    tot.costo,
  ])
  const csv = filasACsv(
    ['RUT', 'Nombre', 'Días', 'Imponible', 'AFP', 'Salud', 'Cesantía', 'Impuesto único', 'Líquido', 'SIS', 'Cesantía empleador', 'Mutual', 'Costo empresa'],
    cuerpo
  )
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="libro-remuneraciones-${periodo}.csv"`,
    },
  })
}
```

- [ ] **Paso 3 — Route nuevo `previred/route.ts`**

`apps/erp/app/libro-remuneraciones/previred/route.ts` (nuevo):

```ts
import { crearClienteServidor } from '@suite/auth/server'
import { generarPrevired, periodoAnterior, rangoDeMes, type FilaPrevired } from '@suite/core'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { puedeVerRRHH } from '../../../lib/rrhh-acceso'

interface Fila {
  dias_trabajados: number
  afp: string
  total_imponible: number
  afp_monto: number
  sis_monto: number
  cesantia_monto: number
  cesantia_empleador_monto: number
  salud: string
  salud_monto: number
  mutual_monto: number
  trabajadores: { rut: string; nombre: string } | null
}

export async function GET(req: Request) {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return new Response('No autorizado', { status: 401 })
  // Guard de rol EXPLÍCITO (lección P12): rol sin permiso → 403, jamás un TXT
  // vacío. Paridad byte a byte con el export CSV (mismo predicado).
  if (!puedeVerRRHH(activa)) {
    return new Response('No autorizado', { status: 403 })
  }
  // Paridad con la página y el CSV: ?periodo= inválido cae al mes anterior
  // (fallback silencioso, patrón de los exports de contabilidad).
  const qPeriodo = new URL(req.url).searchParams.get('periodo')
  const periodo =
    qPeriodo && rangoDeMes(qPeriodo) ? qPeriodo : periodoAnterior(new Date().toISOString().slice(0, 7))!

  const supabase = await crearClienteServidor()
  // MISMA base que el libro y el CSV (empresa + período, sin anuladas): solo
  // cambian las columnas — las del snapshot que consume FilaPrevired (Task 3).
  const { data, error } = await supabase
    .from('liquidaciones')
    .select('dias_trabajados, afp, total_imponible, afp_monto, sis_monto, cesantia_monto, cesantia_empleador_monto, salud, salud_monto, mutual_monto, trabajadores (rut, nombre)')
    .eq('empresa_id', activa.id)
    .eq('periodo', periodo)
    .neq('estado', 'anulada')
  if (error) return new Response('No se pudo generar el archivo Previred', { status: 500 })
  const filas: FilaPrevired[] = ((data ?? []) as Fila[])
    .sort((a, b) => (a.trabajadores?.nombre ?? '').localeCompare(b.trabajadores?.nombre ?? '', 'es'))
    .map((f) => ({
      rut: f.trabajadores?.rut ?? '',
      nombre: f.trabajadores?.nombre ?? '',
      // 'AAAA-MM' para los campos 9/10 del TXT (MMAAAA): todas las filas son
      // del período consultado (.eq de la query) — se puebla desde la variable.
      periodo,
      dias_trabajados: f.dias_trabajados,
      afp: f.afp,
      total_imponible: f.total_imponible,
      afp_monto: f.afp_monto,
      sis_monto: f.sis_monto,
      cesantia_monto: f.cesantia_monto,
      cesantia_empleador_monto: f.cesantia_empleador_monto,
      salud: f.salud,
      salud_monto: f.salud_monto,
      mutual_monto: f.mutual_monto,
    }))

  // generarPrevired ya emite CRLF SIN BOM (spec §5): el string va tal cual —
  // jamás pasar por filasACsv (ese helper antepone BOM para Excel).
  return new Response(generarPrevired(filas), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="previred-${periodo}.txt"`,
    },
  })
}
```

Período sin liquidaciones → TXT de 0 líneas, descarga igual (paridad con el CSV, que baja solo encabezados; sin caso especial).

- [ ] **Paso 4 — Verificación**

```
node -e "const fs=require('fs');const con=process.argv.slice(1).filter(a=>fs.readFileSync(a)[0]===0xEF);if(con.length){console.error('BOM en: '+con.join(', '));process.exit(1)}console.log('sin BOM')" apps/erp/app/libro-remuneraciones/page.tsx apps/erp/app/libro-remuneraciones/export/route.ts apps/erp/app/libro-remuneraciones/previred/route.ts
pnpm --filter erp build
```

Salida esperada: `sin BOM`; build con exit 0 y `✓ Compiled successfully`, con `ƒ /libro-remuneraciones`, `ƒ /libro-remuneraciones/export` y `ƒ /libro-remuneraciones/previred` en el listado de rutas. Si `generarPrevired`/`FilaPrevired` no existen en `@suite/core`, falta la Task 3 — NO stubear.

Recordatorio de entorno: reiniciar los dev servers tras el build. Smoke manual con la demo (período 2026-06 del seed): la tabla muestra las 4 columnas nuevas con totales; "Exportar CSV" baja 13 columnas; "Archivo Previred" baja `previred-2026-06.txt` con una línea de 105 campos `;` por trabajador (verificar con `(Get-Content archivo -TotalCount 1).Split(';').Count` → 105).

- [ ] **Paso 5 — Commit**

```
git add apps/erp/app/libro-remuneraciones
git commit -m "feat(erp): libro de remuneraciones con aportes del empleador y archivo Previred

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Salida esperada: commit creado en la rama del plan con 3 archivos (1 nuevo, 2 modificados).

---
### Task 6: Tasa mutual editable en Configuración → Módulos + tasa SIS y candados de tramos en admin /indicadores

**Files:**
- Modify: `apps/erp/app/configuracion/modulos/acciones.ts`
- Create: `apps/erp/componentes/formulario-remuneraciones.tsx`
- Modify: `apps/erp/app/configuracion/modulos/page.tsx`
- Modify: `apps/admin/app/indicadores/acciones.ts`
- Modify: `apps/admin/app/indicadores/page.tsx`

**Interfaces:**
- Consumes (de tasks previas del plan): migración 0026 — `empresas.tasa_mutual numeric(4,2) not null default 0.90` con `check (tasa_mutual between 0 and 10)` y **grant de UPDATE por columna** a authenticated (la policy de fila ya limita la escritura a dueño/admin — mismo mecanismo que `factor_volumetrico`, 0016); `indicadores_previsionales.tasa_sis numeric(5,2) not null default 1.53` (escritura SOLO service_role, como el resto de la tabla). Tipos de `@suite/db` (Task 3): sin `tasa_mutual`/`tasa_sis` en `types.ts`, los `.update(...)`/`select` de abajo no tipan.
- Del repo (ya vivos): `obtenerEmpresaActiva`, `crearClienteServidor`, `EstadoForm` (`apps/erp/app/tipos.ts`), `Boton/Campo/Entrada/Tarjeta` (`@suite/ui`), `verificarAdmin`, `clienteAdmin`, `AFPS`/`NOMBRES_AFP` (`apps/admin/app/indicadores/afps.ts`).
- Produces: server action `guardarTasaMutual` (erp), card "Remuneraciones" en `/configuracion/modulos`, campo `tasa_sis` en `FormPeriodo`/`guardarPeriodo` (admin) y `leerTramos` endurecido (candados P19 §6). **Los mensajes de validación de esta task son CONTRACTUALES** (byte-exactos, ecoados en Global Constraints): el E2E de la Task 7 (ítem 6) espera el texto de la contigüidad tal cual.
- **Decisiones (leído el código real):**
  - ERP: la tasa mutual va en una card propia ("Remuneraciones") con su propia action, calcada del patrón `guardarModulos`/factor volumétrico (update por columna + validación espejo del CHECK + mensaje "RLS devolvió 0 filas" = no eres dueño/admin). NO se mete en `guardarModulos`: el form del factor solo se renderiza con rubro `transporte`, y la card Remuneraciones es **visible siempre** (RRHH no tiene toggle de módulo — spec §7).
  - Admin: candados fail-closed en el server action (spec §6) — TODAS las tasas (AFP y SIS) > 0 y ≤ 100; tramos: el primero parte en `desde = 0`, contiguos (`hasta[i] === desde[i+1]`, comparación de números — `noNegativo` ya devuelve `number`), solo el último sin tope. Los atributos HTML (`min`/`max`) son UX; la validación autoritativa es la del server action.

- [ ] **Step 1: `apps/erp/app/configuracion/modulos/acciones.ts` — action `guardarTasaMutual`**

Agregar al final del archivo (después de `alternarContabilidad`; los imports existentes del archivo ya cubren todo — verificado):

```ts
export async function guardarTasaMutual(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  // Coma decimal es-CL admitida; la columna es numeric(4,2), así que se redondea
  // a 2 decimales ACÁ para que lo guardado sea exactamente lo que la UI muestra.
  // Fail-closed: el vacío se rechaza ANTES de Number() — Number('') === 0 pasaría
  // el rango en silencio con un POST directo (el required del input no protege eso).
  const crudo = String(formData.get('tasa_mutual') ?? '').trim()
  const tasa = crudo === '' ? NaN : Math.round(Number(crudo.replace(',', '.')) * 100) / 100
  // Mismo rango que el check de la tabla (0026): rechazar aquí da mensaje claro
  // en vez de un 23514 crudo. Math.round(NaN)/100 sigue siendo NaN → cae acá.
  if (!Number.isFinite(tasa) || tasa < 0 || tasa > 10) {
    return { error: 'La tasa mutual debe ser un número entre 0 y 10 (% sobre el imponible)' }
  }

  const supabase = await crearClienteServidor()
  // Update por columna: el grant de tasa_mutual lo da la 0026 y la policy de fila
  // limita a dueño/admin — 0 filas actualizadas = RLS bloqueó, no un error SQL.
  const { data, error } = await supabase
    .from('empresas')
    .update({ tasa_mutual: tasa })
    .eq('id', activa.id)
    .select('id')
  if (error) return { error: 'No se pudo guardar la tasa mutual' }
  if ((data ?? []).length === 0) return { error: 'No se pudo guardar: solo el dueño o admin puede cambiar la tasa mutual' }

  // La vista previa de /liquidaciones/generar lee tasa_mutual server-side:
  // revalidar todo el árbol, igual que guardarModulos.
  revalidatePath('/', 'layout')
  return {}
}
```

No cambia nada más del archivo: `guardarModulos` y `alternarContabilidad` quedan intactos (los imports ya cubren todo lo que la action nueva usa).

- [ ] **Step 2: `apps/erp/componentes/formulario-remuneraciones.tsx` (nuevo)**

```tsx
'use client'

import { useActionState } from 'react'
import { Boton, Campo, Entrada, Tarjeta } from '@suite/ui'
import type { EstadoForm } from '../app/tipos'

// Card "Remuneraciones" de Configuración → Módulos (spec P19 §7). Visible
// SIEMPRE: RRHH no tiene toggle de módulo, así que no se condiciona a nada.
export function FormularioRemuneraciones({
  accion,
  inicial,
}: {
  accion: (prev: EstadoForm, formData: FormData) => Promise<EstadoForm>
  inicial: { tasaMutual: number }
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoForm)
  return (
    <Tarjeta className="mt-4 max-w-2xl">
      <form action={enviar} className="grid gap-4">
        <p className="text-sm font-medium text-slate-700">Remuneraciones</p>
        <Campo etiqueta="Tasa mutual ley 16.744 (% sobre el imponible, entre 0 y 10)">
          <Entrada
            name="tasa_mutual"
            type="number"
            inputMode="decimal"
            min={0}
            max={10}
            step={0.01}
            defaultValue={inicial.tasaMutual}
            required
            className="max-w-xs"
          />
        </Campo>
        <p className="text-sm text-slate-500">
          La mutual es el seguro de accidentes del trabajo y enfermedades profesionales
          (ley 16.744) que paga el empleador: tasa base 0,90% más un adicional según el
          riesgo de la actividad, fijado por tu mutualidad (ACHS, Mutual de Seguridad,
          IST o ISL). El cambio es prospectivo: aplica a las liquidaciones que emitas
          desde ahora — las ya emitidas conservan la tasa con que se calcularon.
        </p>
        <div className="flex items-center justify-end gap-2">
          {estado.error && <span className="mr-auto text-sm text-red-600">{estado.error}</span>}
          <Boton type="submit" disabled={pendiente}>{pendiente ? 'Guardando…' : 'Guardar tasa mutual'}</Boton>
        </div>
      </form>
    </Tarjeta>
  )
}
```

- [ ] **Step 3: `apps/erp/app/configuracion/modulos/page.tsx` — card en la página**

Archivo completo resultante (3 cambios sobre el actual: import del componente + `guardarTasaMutual`, `tasa_mutual` en el select, y la card entre Módulos y Contabilidad):

```tsx
import { crearClienteServidor } from '@suite/auth/server'
import { Encabezado } from '@suite/ui'
import type { CodigoRubro } from '@suite/core'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { FormularioModulos } from '../../../componentes/formulario-modulos'
import { FormularioRemuneraciones } from '../../../componentes/formulario-remuneraciones'
import { PanelContabilidad } from '../../../componentes/panel-contabilidad'
import { alternarContabilidad, guardarModulos, guardarTasaMutual } from './acciones'

export default async function ConfigModulos() {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />

  const supabase = await crearClienteServidor()
  const { data: empresa } = await supabase
    .from('empresas')
    .select('rubro, factor_volumetrico, tasa_mutual')
    .eq('id', activa.id)
    .single()

  return (
    <div>
      <Encabezado titulo="Módulos" />
      <FormularioModulos
        accion={guardarModulos}
        inicial={{
          rubro: (empresa?.rubro ?? 'negocio') as CodigoRubro,
          factorVolumetrico: empresa?.factor_volumetrico ?? 250,
        }}
      />
      <FormularioRemuneraciones
        accion={guardarTasaMutual}
        inicial={{ tasaMutual: empresa?.tasa_mutual ?? 0.9 }}
      />
      <PanelContabilidad accion={alternarContabilidad} activo={activa.modulo_contabilidad} />
    </div>
  )
}
```

- [ ] **Step 4: `apps/admin/app/indicadores/acciones.ts` — tasa SIS + candados §6**

Archivo completo resultante (nuevo helper `tasaPorcentual`, `leerTramos` endurecido, `tasa_sis` en `guardarPeriodo` y las tasas AFP pasan de `positivo` a `tasaPorcentual`). Los mensajes de error son BYTE-EXACTOS (Global Constraints — el E2E de la Task 7 los espera tal cual):

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { clienteAdmin } from '@suite/auth/admin'
import { verificarAdmin } from '../../lib/guardia'
import { AFPS } from './afps'

const PERIODO = /^\d{4}-(0[1-9]|1[0-2])$/

// Fail-closed: campo ausente, no numérico o <= 0 aborta la acción completa.
function positivo(formData: FormData, campo: string): number {
  const n = Number(String(formData.get(campo) ?? '').replace(',', '.'))
  if (!Number.isFinite(n) || n <= 0) throw new Error('Valor no válido en ' + campo + ' (se exige un número mayor que 0)')
  return n
}

// Fail-closed: >= 0 (los tramos admiten cero en desde, factor y rebaja).
function noNegativo(formData: FormData, campo: string): number {
  const n = Number(String(formData.get(campo) ?? '').replace(',', '.'))
  if (!Number.isFinite(n) || n < 0) throw new Error('Valor no válido en ' + campo + ' (se exige un número mayor o igual a 0)')
  return n
}

// Fail-closed: tasa en % del imponible (> 0 y <= 100) — candado P19 §6 para
// TODAS las tasas (AFP y SIS): una tasa sobre 100% es siempre un error de tipeo.
function tasaPorcentual(formData: FormData, campo: string): number {
  const n = positivo(formData, campo)
  if (n > 100) throw new Error('Valor no válido en ' + campo + ' (una tasa en % no puede superar 100)')
  return n
}

// Arma tramos_impuesto desde los campos tramo_{i}_* del formulario (spec P18 §6:
// los tramos son campos individuales y el jsonb se arma server-side).
// Candados de integridad (P19 §6), todos fail-closed con mensaje por campo:
// el tramo 1 parte en desde = 0; tramos CONTIGUOS (hasta[i] = desde[i+1], sin
// huecos ni solapes); cada tramo con tope exige desde < hasta; SOLO el último
// queda sin tope (hasta vacío = null); factores entre 0 y 1; rebajas >= 0.
function leerTramos(formData: FormData) {
  const lista: { desde_utm: number; hasta_utm: number | null; factor: number; rebaja_utm: number }[] = []
  for (let i = 0; formData.has('tramo_' + i + '_desde'); i++) {
    const desde = noNegativo(formData, 'tramo_' + i + '_desde')
    const hastaCrudo = String(formData.get('tramo_' + i + '_hasta') ?? '').trim()
    const hasta = hastaCrudo === '' ? null : noNegativo(formData, 'tramo_' + i + '_hasta')
    const factor = noNegativo(formData, 'tramo_' + i + '_factor')
    if (factor > 1) throw new Error('Factor no válido en el tramo ' + (i + 1) + ' (se exige entre 0 y 1)')
    if (hasta != null && hasta <= desde) throw new Error('Tramo ' + (i + 1) + ' no válido: desde debe ser menor que hasta')
    lista.push({ desde_utm: desde, hasta_utm: hasta, factor, rebaja_utm: noNegativo(formData, 'tramo_' + i + '_rebaja') })
  }
  if (lista.length === 0) throw new Error('Faltan los tramos del impuesto único')
  // Los ! de abajo son por noUncheckedIndexedAccess: los índices están
  // garantizados por los propios límites de los bucles/length.
  if (lista[0]!.desde_utm !== 0) {
    throw new Error('El tramo 1 debe partir en desde = 0 (la tabla cubre desde la primera UTM)')
  }
  for (let i = 0; i < lista.length - 1; i++) {
    const hasta = lista[i]!.hasta_utm
    if (hasta == null) {
      throw new Error('Solo el último tramo puede quedar sin tope: completa hasta en el tramo ' + (i + 1))
    }
    // Contigüidad estricta comparando NÚMEROS (noNegativo ya parseó): sin
    // huecos ni solapes entre tramos consecutivos.
    if (hasta !== lista[i + 1]!.desde_utm) {
      throw new Error(
        'Tramos ' + (i + 1) + ' y ' + (i + 2) + ' no contiguos: hasta del tramo ' + (i + 1) +
        ' (' + hasta + ') debe ser igual a desde del tramo ' + (i + 2) + ' (' + lista[i + 1]!.desde_utm + ')'
      )
    }
  }
  if (lista[lista.length - 1]!.hasta_utm != null) {
    throw new Error('El último tramo debe quedar sin tope (deja hasta vacío)')
  }
  return lista
}

export async function guardarPeriodo(formData: FormData) {
  const periodo = String(formData.get('periodo') ?? '').trim()
  if (!PERIODO.test(periodo)) throw new Error('Período no válido (formato YYYY-MM)')
  const valores = {
    uf: Math.round(positivo(formData, 'uf')),
    utm: Math.round(positivo(formData, 'utm')),
    ingreso_minimo: Math.round(positivo(formData, 'ingreso_minimo')),
    tope_imponible_uf: positivo(formData, 'tope_imponible_uf'),
    tope_cesantia_uf: positivo(formData, 'tope_cesantia_uf'),
    tasa_sis: tasaPorcentual(formData, 'tasa_sis'),
    tasas_afp: Object.fromEntries(AFPS.map((a) => [a, tasaPorcentual(formData, 'tasa_' + a)])),
    tramos_impuesto: leerTramos(formData),
    actualizado_en: new Date().toISOString(),
  }
  await verificarAdmin()
  const admin = clienteAdmin()
  // Upsert por PK periodo: crear y editar comparten el camino (TODOS los
  // campos, tramos incluidos, vienen del formulario — spec §6).
  const { error } = await admin.from('indicadores_previsionales').upsert({ periodo, ...valores })
  if (error) throw new Error('No se pudo guardar el período: ' + error.message)
  revalidatePath('/indicadores')
}
```

- [ ] **Step 5: `apps/admin/app/indicadores/page.tsx` — tasa SIS en tipo, formulario y tabla**

Cinco ediciones exactas sobre el archivo actual (el resto del archivo no cambia).

Edición 1 — el tipo `Periodo` gana `tasa_sis`:

```tsx
  tope_cesantia_uf: number
  tasas_afp: Record<string, number>
```

→

```tsx
  tope_cesantia_uf: number
  tasa_sis: number
  tasas_afp: Record<string, number>
```

Edición 2 — `FormPeriodo`: campo Tasa SIS al final de la grilla de escalares (queda de 7 campos; los defaults salen de `base`, como el resto — al crear período nuevo, `base` es el período más reciente):

```tsx
        <Campo etiqueta="Tope cesantía (UF)">
          <Entrada name="tope_cesantia_uf" type="number" min={0.1} step={0.1} defaultValue={base.tope_cesantia_uf} required />
        </Campo>
      </div>
```

→

```tsx
        <Campo etiqueta="Tope cesantía (UF)">
          <Entrada name="tope_cesantia_uf" type="number" min={0.1} step={0.1} defaultValue={base.tope_cesantia_uf} required />
        </Campo>
        <Campo etiqueta="Tasa SIS (% sobre imponible)">
          <Entrada name="tasa_sis" type="number" min={0.01} max={100} step={0.01} defaultValue={base.tasa_sis} required />
        </Campo>
      </div>
```

Edición 3 — los inputs de tasas AFP ganan `max={100}` (UX espejo del candado del server, que sigue siendo el autoritativo):

```tsx
              <Entrada name={'tasa_' + a} type="number" min={0.01} step={0.01} defaultValue={base.tasas_afp[a]} required />
```

→

```tsx
              <Entrada name={'tasa_' + a} type="number" min={0.01} max={100} step={0.01} defaultValue={base.tasas_afp[a]} required />
```

Edición 4 — encabezado de la tabla resumida:

```tsx
                <Th>Topes imp./ces. (UF)</Th>
                <Th>Tasas AFP</Th>
```

→

```tsx
                <Th>Topes imp./ces. (UF)</Th>
                <Th>SIS</Th>
                <Th>Tasas AFP</Th>
```

Edición 5 — celda correspondiente en el cuerpo:

```tsx
                  <Td className="tabular-nums">
                    {num(p.tope_imponible_uf)} / {num(p.tope_cesantia_uf)}
                  </Td>
                  <Td className="text-xs">{AFPS.map((a) => `${NOMBRES_AFP[a]} ${num(p.tasas_afp[a] ?? 0)}%`).join(' · ')}</Td>
```

→

```tsx
                  <Td className="tabular-nums">
                    {num(p.tope_imponible_uf)} / {num(p.tope_cesantia_uf)}
                  </Td>
                  <Td className="tabular-nums">{num(p.tasa_sis)}%</Td>
                  <Td className="text-xs">{AFPS.map((a) => `${NOMBRES_AFP[a]} ${num(p.tasas_afp[a] ?? 0)}%`).join(' · ')}</Td>
```

- [ ] **Step 6: Verificación**

Requiere la migración 0026 y los tipos de `@suite/db` (Tasks 1 y 3) ya commiteados — sin `tasa_mutual`/`tasa_sis` en `types.ts` ninguna de las dos apps tipa.

```powershell
pnpm --filter erp build
```

→ compila sin errores y el listado de rutas incluye `ƒ /configuracion/modulos`.

```powershell
pnpm --filter admin build
```

→ compila sin errores y el listado de rutas incluye `ƒ /indicadores`.

Byte-scan sin BOM de los 5 archivos tocados (imprime `0` por archivo y exit 1 = pass):

```bash
grep -c $'\xEF\xBB\xBF' apps/erp/app/configuracion/modulos/acciones.ts apps/erp/componentes/formulario-remuneraciones.tsx apps/erp/app/configuracion/modulos/page.tsx apps/admin/app/indicadores/acciones.ts apps/admin/app/indicadores/page.tsx
```

- [ ] **Step 7: Commit**

```bash
git add apps/erp apps/admin
git commit -m "feat(erp,admin): tasa mutual configurable por empresa y tasa SIS con candados de tramos

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---
### Task 7: Seed — canario G1 con aportes del empleador + pipeline verde + E2E Playwright (task final)

**Files:**
- Modify: `scripts/seed-demo.mjs` (ÚNICO archivo de producción de esta task; el resto son comandos y verificación)

**Interfaces:**
- Consumes (ya vivos en el seed): sección 22 completa del P18 — trabajadores/contratos G1-G3, RPC
  `emitir_liquidacion` (re-creada en este plan: ahora snapshotea `tasa_sis`/`tasa_mutual` y calcula
  `sis_monto`/`cesantia_empleador_monto`/`mutual_monto`/`total_aportes`), `pagar_liquidacion`,
  `contabilizar_pendientes` (rama `'remuneracion'` ampliada a 5 líneas), `userCli`, `die(msg, err)`.
- Consumes conteos contractuales del plan (Tasks 2-3): pgTAP **399 en 19 archivos** (`plan(36)`),
  unit **214**.
- Produces: canario G1 EXTENDIDO con los aportes del empleador. **Nada más cambia en el seed**: las
  liquidaciones 2026-06 nacen CON aportes por la RPC nueva, los 3 asientos siguen siendo 3 (ahora de
  5 líneas cada uno — el assert `creados !== 3` queda igual), los indicadores los sigue sembrando la
  migración, y el RESUMEN no gana líneas.
- **Aritmética del canario G1** (tabla contractual del plan; imponible 1.000.000, contrato indefinido,
  `tasa_sis` 1,53, `tasa_mutual` 0,90, uf 39.200 / tope cesantía 131,9 UF):
  - `sis_monto = round(1.000.000 × 1,53 / 100) = 15.300`
  - base cesantía empleador `= min(1.000.000, round(131,9 × 39.200) = 5.170.480) = 1.000.000` →
    `cesantia_empleador_monto = round(1.000.000 × 2,4 / 100) = 24.000` (indefinido; plazo fijo sería 3,0%)
  - `mutual_monto = round(1.000.000 × 0,90 / 100) = 9.000`
  - `total_aportes = 15.300 + 24.000 + 9.000 = 48.300`
  - costo total empresa G1 `= 1.000.000 + 50.000 (no imponibles) + 48.300 = 1.098.300`
  Los montos exactos de G2-G4 los fijan los goldens de las Tasks 2-3; el canario del seed cubre SOLO
  G1 (igual que en P18).

- [ ] **Step 1: Canario G1 del seed — extender con los aportes**

En `scripts/seed-demo.mjs`, sección 22, reemplazar el bloque del canario. ANTES (verbatim actual,
líneas 521-525 — verificado por el ensamblador):

```js
// Canario del golden G1 (tabla contractual del plan): si la RPC divergiera del
// golden, el seed muere aquí antes de contabilizar.
const { data: liqAmanda, error: eG1 } = await userCli.from('liquidaciones').select('total_imponible, total_descuentos, liquido').eq('id', liqIds.Amanda).single()
if (eG1 || !liqAmanda) die('lectura liquidación Amanda (golden G1)', eG1)
if (liqAmanda.total_imponible !== 1000000 || liqAmanda.total_descuentos !== 188700 || liqAmanda.liquido !== 861300) die('golden G1 del seed no calza: ' + JSON.stringify(liqAmanda) + ' ≠ imponible 1000000 / descuentos 188700 / líquido 861300', null)
```

DESPUÉS (el assert existente queda intacto; se amplía el select y se suma UN assert de aportes):

```js
// Canario del golden G1 (tabla contractual del plan): si la RPC divergiera del
// golden, el seed muere aquí antes de contabilizar. P19: cubre también los aportes
// del empleador (sis 1,53% / cesantía indefinido 2,4% / mutual 0,90% de la empresa).
const { data: liqAmanda, error: eG1 } = await userCli.from('liquidaciones').select('total_imponible, total_descuentos, liquido, sis_monto, cesantia_empleador_monto, mutual_monto, total_aportes').eq('id', liqIds.Amanda).single()
if (eG1 || !liqAmanda) die('lectura liquidación Amanda (golden G1)', eG1)
if (liqAmanda.total_imponible !== 1000000 || liqAmanda.total_descuentos !== 188700 || liqAmanda.liquido !== 861300) die('golden G1 del seed no calza: ' + JSON.stringify(liqAmanda) + ' ≠ imponible 1000000 / descuentos 188700 / líquido 861300', null)
if (liqAmanda.sis_monto !== 15300 || liqAmanda.cesantia_empleador_monto !== 24000 || liqAmanda.mutual_monto !== 9000 || liqAmanda.total_aportes !== 48300) die('aportes G1 del seed no calzan: ' + JSON.stringify(liqAmanda) + ' ≠ sis 15300 / cesantía empleador 24000 / mutual 9000 / total 48300', null)
```

Nada más se toca en el archivo (el assert `(pendRem?.creados ?? 0) !== 3` sigue válido: son los mismos
3 asientos, ahora de 5 líneas). Byte-scan anti-BOM (imprime `0` y sale con status 1 = pass):

```bash
grep -c $'\xEF\xBB\xBF' scripts/seed-demo.mjs
```

- [ ] **Step 2: Pipeline completo**

Run desde la raíz del repo (PowerShell 5.1: separar con `;`, nunca `&&`):

```powershell
npx supabase test db
```

→ **19 archivos, 399 asserts** (`remuneraciones.test.sql` extendido por la Task 2 a `plan(36)` con los
goldens de aportes G1-G4, trabajador desactivado, asiento de 5 líneas y catch-up con aportes 0;
parches 14→16 en los asserts de anclas por la Task 1), todos verdes.

```powershell
pnpm test
```

→ **214 tests** verdes (baseline 204 + 10 nuevos: `previred.test.ts` y aportes en
`remuneraciones.test.ts`, Task 3).

```powershell
pnpm --filter @suite/db gen
git diff --exit-code packages/db/src/types.ts
```

→ exit 0, **cero diff**: los tipos a mano son espejo byte a byte del generador. Si hubiera diff, gana
el generador: commitear su salida y volver a correr typecheck/builds.

```powershell
pnpm build --concurrency=1
```

→ **3 apps** (`web`, `erp`, `admin`) compilan sin errores. Gotcha conocido: este build **pisa el
`.next` de los dev servers corriendo** → 500s en el browser; el Step 4 los reinicia SIEMPRE.

- [ ] **Step 3: Reseed de la demo (la suite pgTAP puede haberla borrado)**

```powershell
npx supabase db reset
```

→ termina con `Finished supabase db reset` (aplica 0001..0026 — la 0026 agrega `tasa_sis` a
indicadores, `tasa_mutual` a empresas y las columnas de aportes en liquidaciones).

Gotcha Kong 502 tras el reset (el upstream de auth queda viejo y `/auth/v1/*` da 502 indefinidamente
aunque auth esté healthy) — curarlo SIEMPRE, es barato:

```powershell
docker restart supabase_kong_ERP_Transportes; Start-Sleep -Seconds 8
```

Cargar la clave DTE desde `apps/erp/.env.local` **sin imprimirla** (la asignación a `$env:` no emite
salida; NO hacer `echo` de la variable) y sembrar:

```powershell
$env:DTE_ENCRYPTION_KEY = ((Get-Content apps/erp/.env.local | ? { $_ -like 'DTE_ENCRYPTION_KEY=*' }) -split '=',2)[1]
node scripts/seed-demo.mjs
```

→ el seed corre COMPLETO (secciones 1-22, Node ≥22) y pasa el canario nuevo: si la RPC re-creada
divergiera de los goldens de aportes, muere con `aportes G1 del seed no calzan`. La salida incluye:

```
✓ remuneraciones: 3 trabajadores + contratos (G1-G3), 3 liquidaciones 2026-06 emitidas (Carla pagada) + 3 asientos
```

y el RESUMEN sigue con `trabajadores: 3` / `liquidaciones: 3`.

- [ ] **Step 4: Reiniciar los dev servers (`.next` pisado por el build)**

Gotcha doble: el build pisa `.next` de los dev servers, y en Windows borrar `.next` puede tirar
`EINVAL readlink` en el primer compile si quedó un symlink zombi — por eso se matan los procesos
ANTES de borrar y se borra `.next` completo:

```powershell
Get-NetTCPConnection -LocalPort 3000,3001,3002 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -Confirm:$false }
try { Remove-Item -Recurse -Force apps/web/.next, apps/erp/.next, apps/admin/.next -ErrorAction Stop } catch {}
Start-Process pnpm.cmd -ArgumentList '--filter','web','dev'
Start-Process pnpm.cmd -ArgumentList '--filter','erp','dev'
Start-Process pnpm.cmd -ArgumentList '--filter','admin','dev'
```

→ tres dev servers: web 3000, erp 3001, admin 3002. Esperar a que `http://localhost:3001` responda
antes del checklist (primer compile ~10-30s); Ctrl+Shift+R si un chunk viejo quedó cacheado.

- [ ] **Step 5: E2E manual con Playwright MCP (checklist numerada, evidencia por punto)**

Browser vía Playwright MCP (`browser_navigate` / `browser_fill_form` / `browser_click` /
`browser_snapshot` / `browser_run_code_unsafe`). Documentar la evidencia de CADA ítem en el reporte:

1. **Reseed ok con el canario nuevo**: evidencia = la salida del Step 3 (el seed NO murió en
   `aportes G1 del seed no calzan` → la RPC calza con sis 15.300 / cesantía 24.000 / mutual 9.000 /
   total 48.300) + la línea `✓ remuneraciones: ...`; citarla en el reporte.
2. **Generar liquidación 2026-07 — preview con Costo empresa = emisión**: login en
   `http://localhost:3000/login` con `demo@suite-erp.cl` / `demo1234` → `http://localhost:3001/liquidaciones`
   → generar → **Amanda**, período `2026-07`, días 30, extras 0, no imponibles `50000` (mismos inputs
   G1; con uf 39.350 e IMM/topes/tramos iguales, los montos son LOS MISMOS del canario: G1 está bajo
   tope y es Fonasa). Evidencia: la vista previa (espejo TS) muestra el bloque **Costo empresa** con
   SIS `15.300`, cesantía empleador `24.000`, mutual `9.000`, total aportes `48.300` y costo total
   empresa `1.098.300`, con líquido `861.300` — ANOTAR los números → **Emitir** → el detalle muestra
   exactamente los números anotados (equivalencia espejo TS = RPC SQL; si divergen es bug, BLOCKED).
3. **Detalle con Costo empresa + asiento de 5 líneas**: en el detalle recién emitido, evidencia:
   (a) la sección **Costo empresa** reemplaza la nota v1 «no incluye aportes del empleador»; (b) la
   traza «Asiento N°» abre `/contabilidad/asientos/[id]` con origen «Remuneración» y **5 líneas
   cuadradas** (debe = haber = `1.098.300`): debe gasto remuneraciones `1.050.000`, debe **gasto
   leyes sociales `48.300`** (ancla nueva), haber remuneraciones por pagar `861.300`, haber
   retenciones por pagar `188.700`, haber **leyes sociales por pagar `48.300`** (ancla nueva).
4. **Libro 2026-06: columnas nuevas + CSV + TXT Previred**: `/libro-remuneraciones` período `2026-06`.
   Evidencia: (a) las 3 filas traen las columnas nuevas (SIS, cesantía empleador, mutual, costo
   empresa) — la fila de Amanda con `15.300 / 24.000 / 9.000` y costo empresa `1.098.300` — y la fila
   de totales las suma; (b) el **export CSV** descarga con las mismas filas/totales, columnas nuevas
   incluidas; (c) el botón **Archivo Previred** descarga el TXT — verificar los 105 campos con
   `browser_run_code_unsafe` (misma sesión, mismos guards que el CSV):

   ```js
   const r = await fetch('/libro-remuneraciones/previred?periodo=2026-06');
   const t = await r.text();
   const lineas = t.split('\r\n').filter(Boolean);
   return { lineas: lineas.length, separadores: lineas.map((l) => (l.match(/;/g) || []).length) };
   ```

   → `{ lineas: 3, separadores: [104, 104, 104] }` (105 campos = 104 `;` por línea, CRLF, una línea
   por liquidación no-anulada).
5. **Tasa mutual configurable con efecto real**: en el ERP, Configuración → Módulos, card
   «Remuneraciones» → editar tasa mutual `0,90 → 2,00`, guardar. Generar liquidación 2026-07 de
   **Bruno** (imponible golden G2 `1.409.396`): la preview muestra mutual
   `round(1.409.396 × 2,00 / 100) = 28.188` (con 0,90 habría sido `12.685` — aritmética verificada
   contra el golden G2) → emitir → el detalle snapshotea tasa mutual 2,00. Cierre: **revertir a
   `0,90`** (demo canónica) → una preview nueva de cualquier trabajador vuelve a usar 0,90, y la
   liquidación de Bruno CONSERVA su snapshot 2,00 — evidencia de auditabilidad por snapshot.
6. **Admin: tasa SIS + candados de tramos**: login `admin@suite-erp.cl` / `admin-suite-2026` en 3000
   → `http://localhost:3002/indicadores`. Evidencia: (a) el período `2026-07` muestra el campo
   **Tasa SIS** con `1,53`; editarla a `1,60`, guardar (la tabla refleja `1,6` — `toLocaleString('es-CL')` omite el cero final; aceptar `1,6`) y **revertir a `1,53`**
   (demo canónica); (b) en los tramos del mismo formulario, introducir un **hueco**: subir el `desde`
   del tramo 2 de `13.5` a `14` → guardar → el guardado es RECHAZADO con el mensaje byte-exacto de la
   Task 6 (Global Constraints):
   `Tramos 1 y 2 no contiguos: hasta del tramo 1 (13.5) debe ser igual a desde del tramo 2 (14)`
   y la tabla NO cambia; restaurar el valor original sin guardar cambios rotos.
7. **Demo intacta**: logout del admin, login `demo@suite-erp.cl` / `demo1234` → `/liquidaciones`
   muestra las 3 liquidaciones 2026-06 del seed (Carla pagada) + las emitidas en los ítems 2 y 5;
   `/inicio` carga sin errores. Evidencia: snapshot con las credenciales de siempre funcionando y los
   datos del seed presentes.

Si cualquier ítem falla: defecto real → **BLOCKED** con detalle (no se maquilla el checklist).

- [ ] **Step 6: Solo el seed cambia en git**

```powershell
git status --porcelain
```

→ exactamente una línea: ` M scripts/seed-demo.mjs`. Si aparece `packages/db/src/types.ts` es que el
Step 2 encontró diff (ya commiteado ahí); cualquier otro archivo es un desborde de la task → revisar
antes de commitear.

- [ ] **Step 7: Commit**

```bash
git add scripts/seed-demo.mjs
git commit -m "feat(scripts): canario del seed cubre los aportes del empleador del golden G1

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 8: Reporte y cleanup**

`.superpowers/sdd/task-7-plan19-report.md` con: pipeline (**399 pgTAP en 19 archivos / 214 unit** /
3 builds / diff-cero de tipos), la salida del reseed (canario de aportes pasado) y el checklist
E2E ítem por ítem con su evidencia (equivalencia preview = emisión del ítem 2, las 5 líneas del ítem 3,
el `{ lineas: 3, separadores: [104, 104, 104] }` del ítem 4, el snapshot 2,00 del ítem 5 y el rechazo
del hueco del ítem 6). Nada que borrar del scratchpad (esta task no crea scripts temporales).

---

## Seams abiertos para los lentes

1. **Códigos Previred de 1 dígito**: la tabla usa `'3'`, `'7'`, `'8'`, `'0'` tal como los enumera el spec §5 (cuprum 3, fonasa 7, provida 8, isapre 0); el formato oficial suele mostrarlos a 2 dígitos (`'03'`, `'07'`). No verificable offline — si Previred rechaza el archivo, el fix es 4 strings + la línea dorada del test (nota del drafter de la Task 3).
2. **Campos Previred poblados más allá de la lista literal del spec §5**: período (campos 9/10 en MMAAAA — sin él el archivo no es cargable) y las constantes estructurales del formato (7 nacionalidad, 8 tipo pago `'01'`, 11 régimen `'AFP'`, 12 tipo trabajador, 14 tipo línea `'00'`). Decisión declarada del drafter; si se exige purismo estricto, vaciar esos índices y recalcular la línea dorada.
3. **El mapa completo de los 105 campos** se fijó del formato público de previred.com sin validador local: la validación final la hace Previred al cargar el TXT (límite declarado del spec §5 — el usuario puede ajustar el TXT antes de subirlo).
4. **`npx tsc --noEmit -p packages/{db,core}` nunca ha sido gate del repo** (no existe script `typecheck`; ambos tsconfig existen pero no se han corrido standalone como verificación). Si el tsconfig del paquete arrojara errores de configuración ajenos al cambio, el fallback declarado es el vitest de core (Task 3, compila ambos paquetes) + el build de erp (Task 4) como primer typecheck completo — anotar el hallazgo en el reporte de la task, no parchear tsconfigs.
5. **`guardarPeriodo` (admin) lanza `throw` en vez de devolver `EstadoForm`** (patrón P18 heredado, esta task no lo cambia): la evidencia del ítem 6 del E2E depende de cómo Next presente el error del server action en dev. El TEXTO del mensaje es contractual (Global Constraints); el canal de presentación no lo es.
6. **La heurística `separarNombre`** (últimas 2 palabras = apellidos) es declaradamente imperfecta para apellidos compuestos («De la Fuente») — límite v1 del spec §5; columnas de apellidos → Plan 20+.
