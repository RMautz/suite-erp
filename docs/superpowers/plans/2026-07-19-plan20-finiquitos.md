# Plan 20 — Finiquitos, vacaciones y Previred completo · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute this plan task-by-task with fresh subagents in the current session (or superpowers:executing-plans in a separate session). Cada task es autocontenida: Files, Interfaces, Steps con el código completo y verificación con salida esperada. Marca los checkboxes al completar cada step. Las tasks se ejecutan EN ORDEN (1→7): hay costuras de secuencia declaradas (T1→T2 sobre la MISMA migración 0027; T4→T5 sobre el typecheck de erp; T6 edita archivos que deja T5; T7 migra el seed).

**Spec:** `docs/superpowers/specs/2026-07-19-plan20-finiquitos-vacaciones-design.md` (aprobado por el usuario). **Enmienda del ensamblador aplicada al spec §5:** los apellidos/nombres van en los campos **3-5** del TXT (no "2-4": el formato de 105 campos lleva RUT en el 1 y DV en el 2); el código de institución de salud es el campo **75** (índice 74 del split).

**Goal:** Cerrar RRHH (Fase 3, parte 3): **vacaciones** con devengo automático (1,25 días/mes completo desde el PRIMER contrato) y saldo visible en la ficha; **finiquitos** con causales legales, cálculo autoritativo en SQL (espejo TS para la vista previa), documento imprimible, asiento automático de 2 líneas y ciclo emitir → pagar / anular-con-reactivación; **TXT Previred completo** (apellidos reales desde columnas propias en los campos 3-5 + código de Isapre en el campo 75). Seed con vacaciones de Amanda + E2E de 7 puntos.

**Architecture:** SQL autoritativo + espejo TS (patrón P18/P19). Migración **0027 en DOS secciones sobre el MISMO archivo**: T1 escribe DDL (apellidos, isapre, `vacaciones_tomadas`, `finiquitos`) + capa contable (origen `'finiquito'`, 2 anclas, 4 re-creates) y deja la marca `-- ===== RPCs de finiquitos (Task 2) =====`; T2 anexa las 3 RPCs tras la marca → T3 crea el pgTAP `finiquitos.test.sql` (archivo 20) → T4 crea el espejo `finiquitos.ts` + catálogo `ISAPRES` + Previred v2 + types a mano → T5 UI de ficha/vacaciones/isapre/route Previred (cierra el typecheck roto por T4) → T6 UI del finiquito (preview en vivo, documento, pagar/anular con reversa, origen contable en erp) → T7 seed + pipeline + E2E Playwright. Los goldens GF1-GF3 son compartidos byte a byte entre pgTAP, vitest y los smokes: divergencia = bug.

**Tech Stack:** Postgres/Supabase local (plpgsql security definer, RLS, grants, pgTAP), monorepo pnpm TypeScript (Next.js 15 App Router × 3 apps, vitest, tipos codegen espejados a mano), Playwright MCP para el E2E manual. Windows/PowerShell 5.1 (separar comandos con `;`, nunca `&&`); byte-scans con Git Bash.

## Global Constraints

- **GOLDENS CANÓNICOS DE FINIQUITO** (única fuente; T2 smoke, T3 pgTAP y T4 unit usan ESTOS bytes — divergencia = bug del plan, no del código; UF 2026-07 = 39.350; tope 90 UF = round(90 × 39.350) = 3.541.500):

  | Golden | causal / aviso | sueldo | inicio → término | age() | anos_servicio | indem_anos | indem_aviso | feriado_dias | feriado_monto | **TOTAL** |
  |---|---|---|---|---|---|---|---|---|---|---|
  | **GF1** | necesidades_empresa / sin aviso | 800.000 | 2023-01-15 → 2026-07-31 (10 tomados) | 3a 6m 16d | **4** (6m16d > 6m SUMA) | **3200000** | **800000** | **42.50** | **1133333** | **5133333** |
  | **GF2** | renuncia | 1.200.000 | 2025-03-01 → 2026-07-31 (0 tomados) | 1a 4m 30d | **1** | **0** | **0** | **20.00** | **800000** | **800000** |
  | **GF3** | necesidades_empresa / con aviso | 4.000.000 | 2012-05-01 → 2026-07-31 (200 tomados) | 14a 2m 30d | **11** (tope) | **38956500** (base topada 3541500) | **0** | **12.50** | **1666667** (sueldo SIN tope) | **40623167** |
  | W5 (pgTAP) | renuncia | 500.000 | 2026-01-01 → 2026-07-31 (10 tomados) | 0a 6m 30d | **1** (6m30d > 6m) | 0 | 0 | **0.00** (clamp) | 0 | **0** |
  | VP (pgTAP re-emisión de Gabriel + unit T4) | vencimiento_plazo / — | 800.000 | 2023-01-15 → 2026-07-31 (10 tomados) | 3a 6m 16d | **4** (snapshot) | **0** | **0** | **42.50** | **1133333** | **1133333** |
  | E2E Amanda (seed real) | necesidades_empresa / sin aviso | 800.000 | 2025-03-01 → 2026-07-31 (5 tomados) | 1a 4m 30d | **1** | 800000 | 800000 | 15.00 | 400000 | **2000000** |

- **REGLA CANÓNICA de años/meses (la autoridad es la RPC de T2, que usa `age()`):** ambas fórmulas nacen de la MISMA descomposición `v_edad := age(fecha_termino, inicio)` con `inicio = min(fecha_inicio)` de TODOS los contratos del trabajador (continuidad laboral, spec §2.4). **Semántica REAL de `age(t, i)` con t ≥ i, que el espejo TS replica bug-for-bug:** resta campo a campo (`y = year(t)−year(i)`, `m = month(t)−month(i)`, `d = day(t)−day(i)`) y normaliza — si `d < 0`, presta los días del **MES DE LA FECHA DE INICIO** (`d += días_del_mes(year(i), month(i))`, `m −= 1`); si `m < 0`, `m += 12`, `y −= 1`. Un solo préstamo basta (día(i) ≤ días_del_mes(i) ⇒ d queda > 0). **NO es la aritmética de `+ interval '1 month'`**: `age('2023-02-28','2023-01-31') = '28 days'` (0 meses) aunque `2023-01-31 + 1 mes = 2023-02-28`; ejemplo de la doc de Postgres: `age('2001-04-10','1957-06-13') = 43 years 9 mons 27 days` (préstamo de 30 días de junio). Con esa tripleta `(y, m, d)`:
  - `meses_completos = y×12 + m` (los días sobrantes NO cuentan); `devengados = round(meses_completos × 1.25, 2)`; `saldo = devengados − Σ dias_habiles`; `feriado_dias = greatest(saldo, 0)`.
  - **fracción > 6 meses ⇔ `m > 6 OR (m = 6 AND d > 0)`** sobre la MISMA descomposición → `anos_servicio = least(y + 1, 11)`; si no, `least(y, 11)`. GF1 (6m16d) SUMA el año — el borrador de T4 que testeaba la fracción solo en meses enteros (años 3 / total 4333333) fue CORREGIDO por el ensamblador a esta regla.
  - Los goldens pgTAP fijan la verdad = `age()` si alguna esquina divergiera (el borde de febrero del préstamo queda declarado como decisión, no como bug).
  - `base = least(sueldo_base_vigente, round(90 × uf))` con la UF del período de `fecha_termino`; el **feriado NO usa la base topada**: `feriado_monto = round(sueldo_base_vigente::numeric × feriado_dias / 30)` (GF3 lo demuestra). `round()` numeric = mitad lejos del cero = `Math.round` en ≥ 0. **El espejo TS multiplica ANTES de dividir** (`Math.round((sueldo × dias) / 30)`): dividir primero redondea dos veces en float y diverge $1 del numeric en bordes .5 (ej. 122892 × 3,75 → 15361 vs 15362 — verificado). Los goldens GF1-GF3/W5/Amanda NO caen en el borde .5 (verificado): valen para ambas formas, pero el orden multiplicar-primero es el contractual.
- **Guard de fechas (agregado por los lentes):** `emitir_finiquito` valida `p_fecha_termino < v_inicio` (inicio del PRIMER contrato) inmediatamente después de calcular `v_inicio` → raise byte-exacto (lista de abajo); sin él un typo de fecha produce `age()` negativo (años negativos en el snapshot o aviso pagado sin devengo). El espejo TS (`calcularFiniquito`, T4) lanza el MISMO mensaje.
- **Firma de `emitir_finiquito` (T2 manda):** `(p_empresa uuid, p_trabajador uuid, p_causal text, p_fecha_termino date, p_aviso_dado boolean, p_otros_haberes integer, p_otros_descuentos integer, p_comentario text) returns uuid` — **8 parámetros SIN defaults**: TODOS los llamadores pasan los 8 (pgTAP T3: `null` posicional al final; action de T6: `p_comentario` string — la RPC normaliza `''` → null con `nullif(trim(...))`). `pagar_finiquito(p_empresa, p_finiquito)`, `anular_finiquito(p_empresa, p_finiquito, p_motivo)`.
- **Mensajes byte-exactos** (spec §3 + patrón 0025; es-CL con tildes):
  - `'Tu rol no permite emitir finiquitos'` (las 3 RPCs comparten este texto de rol)
  - `'El trabajador no tiene contrato vigente'` (reuso P18)
  - `'No hay indicadores previsionales para el período'` (reuso P18)
  - `'Ya existe un finiquito para este contrato'`
  - `'La fecha de término no puede ser anterior al inicio del primer contrato'` (guard de fechas; el espejo TS lanza el MISMO texto)
  - `'El total del finiquito no puede ser negativo: revisa los descuentos'`
  - `'Solo se puede pagar un finiquito emitido'`
  - `'Solo se puede anular un finiquito emitido o pagado'`
  - `'Indica el motivo de la anulación'`
  - `'El trabajador ya tiene otro contrato vigente'`
- **Glosas contables:** `'Finiquito {nombre}'` (asiento, usa `trabajadores.nombre` display) y `'Anulación finiquito {nombre}'` (reversa del hook de T6).
- **Conteos contractuales:** pgTAP **399 + plan(36) = 435 asserts en 20 archivos** (`finiquitos.test.sql` es el archivo 20; T1 y T2 NO cambian conteos — parchean sin extender). Unit **229 = 214 − 8 (previred v1) + 7 (previred v2) + 16 (finiquitos)**; suite de core queda en 179. **Catálogo contable: 33 cuentas / 18 claves / 5 grupos**; anclas nuevas `'5.1.07' Indemnizaciones` (gasto, `gasto_indemnizaciones`) y `'2.1.08' Finiquitos por pagar` (pasivo, `finiquitos_por_pagar`).
- **Asiento de finiquito:** 2 líneas por el TOTAL neto — debe `gasto_indemnizaciones` = total / haber `finiquitos_por_pagar` = total; total 0 → noop; anulado → noop; fecha = `fecha_termino` vía `app._fecha_contable`.
- **Secuencia T1→T2 sobre `supabase/migrations/00000000000027_finiquitos.sql` (nombre fijado por T1):** T1 escribe la sección 1 completa y termina con la marca `-- ===== RPCs de finiquitos (Task 2) =====`; T2 SOLO anexa después de esa marca (cero ediciones sobre la sección 1). Si la marca no está, T1 no corrió: STOP.
- **Secuencia T4→T5 (patrón P19 T3→T4):** T4 rompe el typecheck de `apps/erp` (la route Previred consume `FilaPrevired.nombre` que desaparece; `acciones.ts` de trabajadores inserta sin `nombres`/`apellido_paterno` requeridos). T4 NO corre `pnpm build` (verificación: vitest + `tsc --noEmit` de db/core); T5 corre `pnpm --filter erp build` y CIERRA la costura. Declarado en ambas tasks.
- **Reparto T5/T6 de la lista de trabajadores:** la insignia «Finiquitado» + «finiquitados al final» los implementa **T5** (query liviana de ids + Set + sort estable); **T6 NO re-toca `trabajadores/page.tsx`** (su Step 7 solo edita la FICHA).
- **Seed:** la migración de los inserts de trabajadores del seed a los 3 campos de nombre **ES DE T7** (T1-T6 no tocan `scripts/seed-demo.mjs`); Bruno gana `isapre: 'colmena'` en T7 Step 1b. SIN finiquitos sembrados.
- **Bytes:** todo archivo nuevo/modificado UTF-8 **SIN BOM** (el único BOM legítimo del repo es el escape de `filasACsv`; el TXT Previred va SIN BOM). Comentarios SQL en ASCII sin tildes; strings de usuario es-CL con tildes.
- Commits por task, mensajes en español, coautoría `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## Contexto verificado (por el ensamblador — no repetir esta investigación)

- **Suite pgTAP actual: 399 asserts en 19 archivos** (suma de `plan()` verificada). Unit actual: 214 (`previred.test.ts` tiene 8 tests hoy).
- **grep `'16/'` en `supabase/tests` = exactamente 3 hits:** `contabilidad.test.sql:85` (`'16/true'`, comentario en la línea 78), `estados_financieros.test.sql:67` (`'16/patrimonio:true'`, comentario en la 60), `remuneraciones.test.sql:66` (`'16/5'`, comentario en la 55). **Los old_string de los 7 parches de T1 (2a-2g) calzan byte a byte con los archivos reales** — verificado hoy contra los 3 archivos.
- **`remuneraciones.test.sql` es el ÚNICO archivo de la suite que inserta `trabajadores`** (grep = 4 hits: líneas 73, 89, 99 y 195); los 4 pasan solo `(empresa_id, rut, nombre)` → sin los parches 2d-2g la suite muere con el `23502` del not null de la 0027 (en el `throws_ok` del RUT el 23502 ganaría al `23514` esperado; en el del contador el `42501` de RLS gana igual — verificado en vivo por los lentes — y su parche 2f se mantiene por consistencia de fixtures). `supabase/seed.sql` NO inserta trabajadores (grep = 0). **T3 no duplica ninguno de estos parches: solo CREA `finiquitos.test.sql`.**
- **Cuerpos vigentes que T1 re-crea:** `activar_contabilidad`, `contabilizar_documento` y `revision_periodo` → 0026; `contabilizar_pendientes` → 0025 (la 0026 no la re-creó). CHECK vigente de origen: 0025. `emitir_liquidacion` NO se toca.
- **`packages/db/src/types.ts` — anclas reales verificadas:** `contratos:` 522, `empresas:` 1120, `folios_caf:` 1206, `trabajadores:` 2649, `vehiculos:` 2696, `anular_estado_pago:` 2976, `anular_liquidacion:` 2980, `desactivar_contabilidad:` 3133, `emitir_liquidacion:` 3137, `guardar_cuenta:` 3152, `pagar_liquidacion:` 3164.
- **`packages/core/src/previred.ts:143`** es hoy `fonasa ? '7' : '0'` — el código de institución de salud es el **campo 75 del TXT (índice 74 del split)**; lo cambia T4 (previred v2) y lo alimenta la route en T5.
- **`packages/core/src/index.ts`** termina en `export * from './previred'` (línea 15) — T4 agrega `./finiquitos` a continuación.
- **erp real:** `apps/erp/lib/rrhh-acceso.ts` exporta `puedeVerRRHH` y `exigirRRHH`; existen `componentes/boton-imprimir.tsx`, `componentes/boton-eliminar-costo.tsx` (genérico `id + accion`, se reusa para eliminar tomas) y `componentes/acciones-liquidacion.tsx` (patrón de T6). `apps/erp/lib/contabilidad.ts:19` — el union de `origen` termina hoy en `'remuneracion'`. `apps/erp/app/contabilidad/origenes.ts` — `ETIQUETA_ORIGEN` con `remuneracion:` en la línea 11 y `rutaOrigen` (líneas 16-24) **SÍ tiene la rama `remuneracion`** → los old_string de T6 Step 2 calzan con el archivo real. `apps/erp/app/contabilidad/asientos/page.tsx:8` — `const ORIGENES = [... 'cierre', 'remuneracion']`.
- **Seed real `scripts/seed-demo.mjs`:** insert de trabajadores en líneas 496-500 (verbatim del old_string de T7 1a), contrato de Bruno en 507-508, canario G1 en 521-533, `console.log('✓ remuneraciones: ...')` en 533, `// ----- Resumen de conteos -----` en 535, `console.log('liquidaciones:        ', ...)` en 560.
- **RUTs nuevos de T3** (`769910018`, `142356783`, `167890237`, `134567899`, `201234565`, `159876543`, `213456784`): grep en TODO el repo = 0 hits fuera de los drafts — sin colisiones con tests, seed ni E2E.
- **Divergencia resuelta (costura a):** el borrador de T4 traía `mesesCompletos` como "resta calendario con castigo por día" y testeaba la fracción SOLO en meses enteros (GF1 años 3 / total 4333333). La RPC de T2 usa `age()`: la fracción necesita el componente días (`m>6 OR (m=6 AND d>0)`) y GF1 (6m16d) da **4 años / 5133333**. El espejo TS de este plan replica `age()` exactamente (préstamo del mes de inicio); T3 (GF1 años 4, W5 6m30d → 1) es consistente con la regla canónica — su header proponía la comparación de fechas `fecha_termino > inicio + años + '6 months'`, que es EQUIVALENTE al predicado sobre (m, d) para toda descomposición de age().
- **Aritmética del golden E2E Amanda re-verificada:** age(2026-07-31, 2025-03-01) = **1a 4m 30d** (la fracción de 4m30d ≤ 6 meses NO suma) → 1 año; 16 meses × 1,25 = 20,00 − 5 = 15,00 días → 400.000; total 800.000 + 800.000 + 400.000 = **2.000.000**.

---
### Task 1: Migración 0027 — apellidos separados, isapre en contratos, vacaciones_tomadas, finiquitos y capa contable del finiquito

Baseline verde que esta task DEBE mantener: pgTAP **399 asserts / 19 archivos**, unit 214, 3 builds (unit y builds no se tocan: task 100% BD).

**Files:**
- Create: `supabase/migrations/00000000000027_finiquitos.sql`
- Modify: `supabase/tests/database/contabilidad.test.sql` (assert 1: `'16/true'` → `'18/true'`)
- Modify: `supabase/tests/database/estados_financieros.test.sql` (assert 1: `'16/patrimonio:true'` → `'18/patrimonio:true'`)
- Modify: `supabase/tests/database/remuneraciones.test.sql` (assert 1: `'16/5'` → `'18/5'`; **+ 4 inserts de trabajadores que deben ganar las columnas nuevas** — sin estos parches la suite se ROMPE con el `not null`, ver Contexto verificado)
- Create (validación, no comiteado): `.superpowers/sdd/smoke-p20-t1.sql`

**Interfaces:**
- Consumes: DDL y RLS por rol de `trabajadores`/`contratos` (0025:14-56, 0025:129-150); cuerpos VIGENTES que se re-crean: `activar_contabilidad` 0026:78-133, `contabilizar_documento` 0026:323-519, `revision_periodo` 0026:526-770 y `contabilizar_pendientes` **0025:748-807** (la 0026 NO la re-creó); CHECK vigente de origen `asientos_origen_check` 0025:204-207; precedente DELETE directo sin UPDATE: `gastos_vehiculo` 0017:78-91; heurística de `separarNombre` (core `packages/core/src/previred.ts:42-55` — paridad byte a byte del backfill); `app.tiene_rol_en_empresa` (0003); `app._fecha_contable` y `app._insertar_asiento` (0024) NO se tocan, solo se invocan.
- Produces (firmas exactas):
  - `trabajadores.nombres text not null`, `trabajadores.apellido_paterno text not null` (ambos `not null` SOLO tras el backfill), `trabajadores.apellido_materno text` (null). `nombre` se CONSERVA como display, sin cambios.
  - `contratos.isapre text` (null) con `check (isapre in ('cruzblanca', 'banmedica', 'colmena', 'consalud', 'vidatres', 'nuevamasvida', 'esencial'))` — constraint auto-nombrado `contratos_isapre_check`; con null el CHECK pasa (lógica de tres valores: contratos antiguos y fonasa quedan null).
  - `public.vacaciones_tomadas (id uuid pk, empresa_id uuid, trabajador_id uuid, desde date, hasta date, dias_habiles integer > 0, comentario text, creado_en timestamptz)` + `check (hasta >= desde)` + FK compuesta a trabajadores + índice `vacaciones_tomadas_trabajador_idx (empresa_id, trabajador_id, desde desc)`. RLS: SELECT dueno/admin/contador; INSERT y DELETE dueno/admin; **sin UPDATE** (ni grant ni policy).
  - `public.finiquitos` (spec §2.5 completo: causal/estado con CHECK, `otros_haberes`/`otros_descuentos >= 0`, snapshot `sueldo_base, anos_servicio, indemnizacion_anos, indemnizacion_aviso, feriado_dias numeric(6,2), feriado_monto, total`, contexto `uf, emitido_en, pagado_en, anulado_en, motivo_anulacion, creado_en`, `unique (empresa_id, id)`, FKs compuestas a trabajadores y contratos) + unique parcial `finiquitos_contrato_idx (empresa_id, contrato_id) where estado <> 'anulado'`. RLS: SELECT dueno/admin/contador; **CERO escritura directa** (grant solo select a authenticated). **`emitido_en`/`pagado_en`/`anulado_en` son NULLABLE sin default** (la RPC de T2 setea `emitido_en = now()` al insertar) — los types de T4 lo espejan (`emitido_en: string | null`).
  - `asientos_origen_check` re-creado: lista 0025 + `'finiquito'`.
  - `public.activar_contabilidad(p_empresa uuid) returns void` — catálogo **33 cuentas / 18 claves / 5 grupos**; anclas nuevas: `'5.1.07' Indemnizaciones` (gasto, clave `gasto_indemnizaciones`) y `'2.1.08' Finiquitos por pagar` (pasivo, clave `finiquitos_por_pagar`) — códigos libres fijados mirando el catálogo real 0026 (grupo 5 termina en 5.1.06; grupo 2 en 2.1.07).
  - `public.contabilizar_documento(p_empresa uuid, p_origen text, p_referencia uuid) returns text` — rama `'finiquito'`: asiento de **2 líneas por el TOTAL neto** (debe `gasto_indemnizaciones` = total / haber `finiquitos_por_pagar` = total); total 0 → 0 líneas → noop compartido; anulado → not found → noop; fecha = `fecha_termino` (después pasa por `app._fecha_contable`). Glosa fija: `'Finiquito ' || nombre` (usa `trabajadores.nombre`, la columna display).
  - `public.contabilizar_pendientes(p_empresa uuid) returns jsonb` — el union gana los finiquitos emitidos/pagados sin asiento (fecha = `fecha_termino`).
  - `public.revision_periodo(p_empresa uuid, p_anio integer, p_mes integer) returns jsonb` — regla 1 (documentos_sin_contabilizar) y regla 6 (asientos_tardios) ganan el origen `'finiquito'` (fecha del documento = `fecha_termino`).
- Sin mensajes de usuario nuevos en esta task (los raise de finiquitos llegan con las RPCs de Task 2).
- **Marca contractual para T2:** el archivo TERMINA con la línea `-- ===== RPCs de finiquitos (Task 2) =====` — T2 anexa ahí.

**Contexto de la task (verificado por el drafter, no repetir):**

- Los asserts que cuentan anclas son EXACTAMENTE tres (grep `'16/'` sobre `supabase/tests` = 3 hits, ver Contexto verificado del plan). `contabilidad.test.sql:438` suma counts pero espera `0` (RLS del vendedor) — no depende del tamaño del catálogo. Grep `asientos_origen_check` en tests = 0 hits (nadie fija la lista de orígenes).
- **Parches OBLIGATORIOS extra en `remuneraciones.test.sql`** (no cuentan anclas, pero sin ellos la suite muere con el `not null` de apellidos): los 4 inserts de trabajadores (líneas 73, 89, 99 y 195) pasan solo `(empresa_id, rut, nombre)` → violarían `23502 not null` en `nombres`. Peor: en el `throws_ok` del RUT con DV malo el 23502 del not null ganaría al `'23514'` esperado (los constraints de columna corren antes que el CHECK del rut) → assert rojo. En el `throws_ok` del contador, en cambio, el `'42501'` de RLS gana IGUAL al 23502 (verificado en vivo por los lentes: el WITH CHECK de RLS se evalúa ANTES que los constraints de columna) — su parche 2f se mantiene solo por consistencia de fixtures. Los 4 ganan `nombres`/`apellido_paterno` (+ `apellido_materno` en la fixture de 3 palabras) con la MISMA partición de la heurística. `plan(N)` no cambia en ningún archivo → suite sigue en **399/19**; los asserts de finiquitos llegan con `finiquitos.test.sql` (archivo 20, Task 3).
- **Heurística del backfill = paridad `separarNombre`** (core 42-55): ≥3 palabras → últimas 2 = apellidos, el resto nombres; 2 palabras → 1 nombre + 1 paterno (materno null); 1 palabra (borde teórico) → nombres = la palabra, paterno `''` (cadena vacía: satisface el `not null`, igual que el `paterno: ''` de core). `regexp_split_to_array(trim(nombre), '\s+')` sobre `''` devuelve `{""}` → nombres `''` (borde teórico, `nombre` es not null y los datos reales siempre tienen texto).
- Códigos libres reales del catálogo 0026: grupo 5 ocupa 5.1.01-5.1.06 → la serie `'5.1.0' || n (n=6..99)` entrega **5.1.07**; grupo 2 ocupa 2.1.01-2.1.07 → entrega **2.1.08**. Ninguna ancla tiene fila prístina del seed que reclamar (`'Indemnizaciones'` / `'Finiquitos por pagar'` jamás existieron): backfill **solo insert código-libre** (patrón 0026). JAMÁS `on conflict do nothing`.
- `finiquitos` no tiene triggers ni escritura authenticated → el smoke inserta finiquitos como superuser dentro de la transacción (patrón smoke P19 con asientos). El `unique (empresa_id, id)` sigue el patrón `liquidaciones` 0025:114 (las RPCs de Task 2 lo usan).
- Omisión deliberada: sin índice extra en `finiquitos (empresa_id, trabajador_id)` — la insignia de la lista filtra por empresa y la tabla es chica; agregar si la lista de trabajadores se sintiera lenta.

- [ ] **Step 1: Escribir la migración**

`supabase/migrations/00000000000027_finiquitos.sql` (Write tool, UTF-8 SIN BOM; comentarios ASCII sin tildes, mensajes/nombres visibles con tildes):

```sql
-- Finiquitos y vacaciones (Plan 20), Task 1: DDL + capa contable. trabajadores
-- gana nombres/apellido_paterno/apellido_materno (backfill UNICO con la
-- heuristica de separarNombre; nombre se CONSERVA como display), contratos
-- gana isapre (catalogo de 7 slugs; null = contrato antiguo o fonasa), nacen
-- vacaciones_tomadas (RLS por rol; INSERT + DELETE directo dueno/admin, sin
-- UPDATE -- precedente gastos_vehiculo 0017) y finiquitos (INMUTABLE:
-- snapshot completo, CERO escritura directa -- solo las RPCs de Task 2 la
-- mueven). Capa contable: origen 'finiquito' + 2 anclas ('5.1.07'
-- Indemnizaciones / '2.1.08' Finiquitos por pagar -> catalogo 33/18/5) y
-- re-creates de activar_contabilidad, contabilizar_documento (asiento de 2
-- lineas por el total), contabilizar_pendientes y revision_periodo (reglas 1
-- y 6). Task 2 anexa emitir/pagar/anular_finiquito tras la marca del final.

-- ---------- trabajadores: nombres y apellidos separados (Previred campos 3-5) ----------
-- nombre se CONSERVA como columna de display (todo el resto del sistema la
-- sigue leyendo sin cambios); la nueva convencion de escritura la compone la
-- Server Action desde los 3 campos (helper nombreCompleto de core, task de
-- UI). Backfill UNICO con la heuristica de separarNombre de core (paridad
-- byte a byte): ultimas 2 palabras = apellidos; 2 palabras = 1 nombre + 1
-- paterno; 1 palabra (borde teorico) = nombres y paterno '' (cadena vacia:
-- satisface el not null, igual que el paterno '' de core).
alter table public.trabajadores
  add column nombres text,
  add column apellido_paterno text,
  add column apellido_materno text;

update public.trabajadores t
set nombres = case when array_length(p.partes, 1) >= 3
                   then array_to_string(p.partes[1:array_length(p.partes, 1) - 2], ' ')
                   else p.partes[1] end,
    apellido_paterno = case when array_length(p.partes, 1) >= 3 then p.partes[array_length(p.partes, 1) - 1]
                            when array_length(p.partes, 1) = 2 then p.partes[2]
                            else '' end,
    apellido_materno = case when array_length(p.partes, 1) >= 3 then p.partes[array_length(p.partes, 1)]
                            else null end
from (select id, regexp_split_to_array(trim(nombre), '\s+') as partes from public.trabajadores) p
where p.id = t.id;

-- Tras el backfill quedan obligatorios (los formularios capturan los 3 campos
-- y la action compone nombre; apellido_materno sigue opcional).
alter table public.trabajadores
  alter column nombres set not null,
  alter column apellido_paterno set not null;

-- ---------- contratos.isapre (catalogo ISAPRES de core; codigo Previred) ----------
-- null = contrato isapre ANTIGUO sin institucion declarada (-> Previred
-- codigo 0, limite declarado del spec SS2.2) o contrato fonasa. Con null el
-- CHECK pasa (logica SQL de tres valores); la action exige isapre para
-- contratos nuevos con salud = 'isapre' (fail-closed en la app).
alter table public.contratos
  add column isapre text
    check (isapre in ('cruzblanca', 'banmedica', 'colmena', 'consalud', 'vidatres', 'nuevamasvida', 'esencial'));

-- ---------- vacaciones_tomadas (registro manual de dias tomados) ----------
-- Los trabajadores NO son usuarios: registra dueno/admin. Sin maquina de
-- estados ni efectos derivados: corregir = eliminar y re-crear (DELETE
-- directo, precedente gastos_vehiculo 0017; sin UPDATE). Sin validacion de
-- solape (v1: el saldo igual resta -- limite declarado del spec SS2.3).
create table public.vacaciones_tomadas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  trabajador_id uuid not null,
  desde date not null,
  hasta date not null,
  dias_habiles integer not null check (dias_habiles > 0),
  comentario text,
  creado_en timestamptz not null default now(),
  check (hasta >= desde),
  foreign key (empresa_id, trabajador_id) references public.trabajadores (empresa_id, id)
);
create index vacaciones_tomadas_trabajador_idx
  on public.vacaciones_tomadas (empresa_id, trabajador_id, desde desc);

-- ---------- finiquitos (INMUTABLE; snapshot completo, spec SS2.5) ----------
-- Estados: emitido -> pagado; emitido o pagado -> anulado (con motivo; anular
-- reactiva contrato y trabajador -- RPCs de Task 2). El snapshot de calculo +
-- contexto hace que el finiquito se explique solo aunque cambien el contrato
-- o los indicadores. CERO escritura directa: solo emitir/pagar/anular_finiquito.
create table public.finiquitos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  trabajador_id uuid not null,
  contrato_id uuid not null,
  causal text not null check (causal in ('renuncia', 'mutuo_acuerdo', 'necesidades_empresa', 'vencimiento_plazo', 'conducta_grave')),
  fecha_termino date not null,
  aviso_dado boolean not null default false,
  estado text not null default 'emitido' check (estado in ('emitido', 'pagado', 'anulado')),
  -- Inputs del cliente (lo UNICO que la RPC no recalcula).
  otros_haberes integer not null default 0 check (otros_haberes >= 0),
  otros_descuentos integer not null default 0 check (otros_descuentos >= 0),
  comentario text,
  -- Snapshot del calculo (CLP enteros; reglas 1-6 del spec SS3).
  sueldo_base integer not null,
  anos_servicio integer not null,
  indemnizacion_anos integer not null,
  indemnizacion_aviso integer not null,
  feriado_dias numeric(6, 2) not null,
  feriado_monto integer not null,
  total integer not null,
  -- Snapshot de contexto (auditabilidad: UF del periodo de termino).
  uf integer not null,
  emitido_en timestamptz,
  pagado_en timestamptz,
  anulado_en timestamptz,
  motivo_anulacion text,
  creado_en timestamptz not null default now(),
  unique (empresa_id, id),
  foreign key (empresa_id, trabajador_id) references public.trabajadores (empresa_id, id),
  foreign key (empresa_id, contrato_id) references public.contratos (empresa_id, id)
);
-- Un finiquito NO-anulado por contrato: anular libera el contrato y se puede
-- volver a emitir (patron liquidaciones_periodo_idx 0025).
create unique index finiquitos_contrato_idx
  on public.finiquitos (empresa_id, contrato_id) where estado <> 'anulado';

-- ---------- RLS ----------
alter table public.vacaciones_tomadas enable row level security;
alter table public.finiquitos enable row level security;

-- vacaciones: datos RRHH sensibles -> SELECT por rol (patron trabajadores
-- 0025, NO el mis_empresas de gastos_vehiculo); escribe dueno/admin. La
-- policy de delete filtra por FILA: un rol sin permiso "borra" 0 filas SIN
-- error -- la app verifica el conteo con .select('id') (leccion 0017).
create policy "contables ven vacaciones" on public.vacaciones_tomadas
  for select to authenticated
  using (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin', 'contador']));
create policy "duenos registran vacaciones" on public.vacaciones_tomadas
  for insert to authenticated
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']));
create policy "duenos eliminan vacaciones" on public.vacaciones_tomadas
  for delete to authenticated
  using (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']));

-- finiquitos: SELECT por rol; CERO escritura directa (ni policy ni grant).
create policy "contables ven finiquitos" on public.finiquitos
  for select to authenticated
  using (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin', 'contador']));

-- ---------- Grants Data API (leccion Plan 1: sin esto todo da 42501) ----------
-- vacaciones SIN update (inmutable: corregir = eliminar y re-crear);
-- finiquitos solo select (solo las RPCs de Task 2 escriben).
grant select, insert, delete on public.vacaciones_tomadas to authenticated;
grant select on public.finiquitos to authenticated;
grant select, insert, update, delete on public.vacaciones_tomadas, public.finiquitos to service_role;

-- ---------- asientos.origen: se suma 'finiquito' ----------
-- drop + re-add (un CHECK no admite ALTER en su lugar; patron 0018/0022/0024/0025).
-- Lista vigente = la de 0025 (con 'remuneracion') + 'finiquito'.
alter table public.asientos drop constraint asientos_origen_check;
alter table public.asientos add constraint asientos_origen_check
  check (origen in
    ('manual', 'venta', 'nota_credito', 'compra', 'pago', 'pago_proveedor', 'anticipo', 'reversa', 'cierre', 'remuneracion', 'finiquito'));

-- ---------- Backfill: las 2 anclas nuevas en empresas ya activas ----------
-- Ninguna tiene fila pristina del seed que reclamar ('Indemnizaciones' /
-- 'Finiquitos por pagar' jamas existieron en catalogos previos): solo insert
-- codigo-libre por empresa (patron 0026; JAMAS on conflict do nothing --
-- dejaria empresas sin ancla y contabilizar reventaria).
insert into public.cuentas_contables (empresa_id, codigo, nombre, tipo, acepta_movimientos, clave_sistema)
select e.id,
       (select '5.1.0' || n from generate_series(6, 99) as n
        where not exists (select 1 from public.cuentas_contables c2
                          where c2.empresa_id = e.id and c2.codigo = '5.1.0' || n)
        order by n limit 1),
       'Indemnizaciones', 'gasto', true, 'gasto_indemnizaciones'
from public.empresas e
where exists (select 1 from public.cuentas_contables c
              where c.empresa_id = e.id and c.clave_sistema is not null)
  and not exists (select 1 from public.cuentas_contables c
                  where c.empresa_id = e.id and c.clave_sistema = 'gasto_indemnizaciones');

insert into public.cuentas_contables (empresa_id, codigo, nombre, tipo, acepta_movimientos, clave_sistema)
select e.id,
       (select '2.1.0' || n from generate_series(6, 99) as n
        where not exists (select 1 from public.cuentas_contables c2
                          where c2.empresa_id = e.id and c2.codigo = '2.1.0' || n)
        order by n limit 1),
       'Finiquitos por pagar', 'pasivo', true, 'finiquitos_por_pagar'
from public.empresas e
where exists (select 1 from public.cuentas_contables c
              where c.empresa_id = e.id and c.clave_sistema is not null)
  and not exists (select 1 from public.cuentas_contables c
                  where c.empresa_id = e.id and c.clave_sistema = 'finiquitos_por_pagar');

-- ---------- RE-CREATE activar_contabilidad (VERBATIM 0026 + 2 anclas) ----------
-- Cambios contra 0026: filas nuevas '2.1.08' Finiquitos por pagar
-- (finiquitos_por_pagar) y '5.1.07' Indemnizaciones (gasto_indemnizaciones).
-- El catalogo queda en 33 cuentas / 18 claves / 5 grupos.
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
      (p_empresa, '2.1.08', 'Finiquitos por pagar',       'pasivo',     true,  'finiquitos_por_pagar'),
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
      (p_empresa, '5.1.06', 'Leyes sociales',             'gasto',      true,  'gasto_leyes_sociales'),
      (p_empresa, '5.1.07', 'Indemnizaciones',            'gasto',      true,  'gasto_indemnizaciones');
  end if;

  update empresas set modulo_contabilidad = true where id = p_empresa;
end $$;
revoke execute on function public.activar_contabilidad(uuid) from anon, public;
grant execute on function public.activar_contabilidad(uuid) to authenticated;

-- ---------- RE-CREATE contabilizar_documento (VERBATIM 0026 + rama 'finiquito') ----------
-- Cambios contra 0026: v_fin en el declare y la rama nueva. Regla: asiento de
-- 2 lineas por el TOTAL neto -- debe Indemnizaciones(total) / haber
-- Finiquitos por pagar(total). Total 0 -> el filtro deja 0 lineas y el noop
-- compartido lo absorbe; anulado -> not found -> noop. Fecha = fecha_termino;
-- el clamp de app._fecha_contable (linea compartida) la respeta contra
-- ejercicios cerrados.
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
  v_fin record;
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

  elsif p_origen = 'finiquito' then
    -- Finiquito emitido o pagado; anulado -> not found -> noop.
    select fecha_termino, trabajador_id, total
    into v_fin
    from finiquitos
    where id = p_referencia and empresa_id = p_empresa and estado in ('emitido', 'pagado')
    for update;
    if not found then return 'noop'; end if;
    -- Fecha = fecha de termino (el clamp compartido la pasa despues por
    -- app._fecha_contable).
    v_fecha := v_fin.fecha_termino;
    v_glosa := 'Finiquito ' ||
      (select nombre from trabajadores where id = v_fin.trabajador_id and empresa_id = p_empresa);
    -- Debe Indemnizaciones(total) / Haber Finiquitos por pagar(total): 2
    -- lineas por el TOTAL neto (spec SS4). Con total = 0 el filtro deja 0
    -- lineas y el noop compartido lo absorbe.
    select coalesce(jsonb_agg(jsonb_build_object('cuentaId', cuenta, 'debe', debe, 'haber', haber) order by ord), '[]'::jsonb)
    into v_lineas
    from (
                    select 1 as ord, (select id from cuentas_contables where empresa_id = p_empresa and clave_sistema = 'gasto_indemnizaciones') as cuenta, v_fin.total as debe, 0 as haber
      union all select 2,          (select id from cuentas_contables where empresa_id = p_empresa and clave_sistema = 'finiquitos_por_pagar'),             0, v_fin.total
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

-- ---------- RE-CREATE contabilizar_pendientes (VERBATIM 0025 + 1 rama) ----------
-- La 0026 NO la re-creo (cuerpo vigente = 0025). Unico cambio: el union all
-- de finiquitos emitidos/pagados sin asiento (fecha = fecha_termino, la misma
-- de la rama de contabilizar_documento; el order by clampeado queda intacto).
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
      union all select 'remuneracion', l.id, (to_date(l.periodo || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date
      from liquidaciones l
      where l.empresa_id = p_empresa and l.estado in ('emitida', 'pagada')
      union all select 'finiquito', f.id, f.fecha_termino
      from finiquitos f
      where f.empresa_id = p_empresa and f.estado in ('emitido', 'pagado')
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

-- ---------- RE-CREATE revision_periodo (VERBATIM 0026 + 'finiquito' en reglas 1 y 6) ----------
-- Cambios contra 0026: la subconsulta de la regla 1 suma los finiquitos
-- emitidos/pagados sin asiento (fecha = fecha_termino, la MISMA de
-- contabilizar_documento) y la regla 6 gana la rama 'finiquito' en el case y
-- en el filtro de origenes. Reglas 2-5 y 7, estado final, revoke y grant:
-- byte a byte desde 0026.
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
    union all select 'finiquito', f.id, f.fecha_termino
    from finiquitos f
    where f.empresa_id = p_empresa and f.estado in ('emitido', 'pagado')
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
  -- fecha por origen que contabilizar_documento (P19: 'remuneracion' = ultimo
  -- dia del mes del periodo; P20: 'finiquito' = fecha_termino).
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
        when 'finiquito'      then (select f.fecha_termino                          from finiquitos f        where f.id = a.referencia_id and f.empresa_id = a.empresa_id)
      end as fecha_doc
    ) d
    where a.empresa_id = p_empresa
      and a.fecha >= v_desde and a.fecha < v_hasta
      and a.referencia_id is not null
      and a.origen in ('venta', 'nota_credito', 'compra', 'pago', 'pago_proveedor', 'anticipo', 'remuneracion', 'finiquito')
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

-- ===== RPCs de finiquitos (Task 2) =====
```

Antes de aplicar, diffear los 4 cuerpos re-creados contra su fuente (activar/contabilizar_documento/revision_periodo → 0026; contabilizar_pendientes → 0025) — backstop del claim VERBATIM; solo deben aparecer los deltas declarados en el encabezado de cada `RE-CREATE`.

- [ ] **Step 2: Parchar los asserts e inserts afectados (Edit tool, old/new byte-exactos — verificados contra los archivos reales, ver Contexto verificado)**

**2a — `supabase/tests/database/contabilidad.test.sql`** (assert 1, `'16/true'` → `'18/true'`):

old_string:
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

new_string:
```sql
-- 1) Idempotente: 18 claves de sistema (no 36) y el flag encendido.
select is(
  (select count(*) from cuentas_contables
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema is not null)::text
  || '/' ||
  (select modulo_contabilidad from empresas where id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa')::text,
  '18/true',
  'activar es idempotente: las 18 claves de sistema y el flag encendido'
);
```

**2b — `supabase/tests/database/estados_financieros.test.sql`** (assert 1, `'16/patrimonio:true'` → `'18/patrimonio:true'`):

old_string:
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

new_string:
```sql
-- 1) La 0027 volvió a extender el catálogo: 18 claves y utilidad_ejercicio es hoja de patrimonio.
select is(
  (select count(*) from cuentas_contables
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema is not null)::text
  || '/' ||
  (select tipo || ':' || acepta_movimientos from cuentas_contables
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema = 'utilidad_ejercicio'),
  '18/patrimonio:true',
  'activar siembra 18 claves de sistema; utilidad_ejercicio es hoja de patrimonio'
);
```

**2c — `supabase/tests/database/remuneraciones.test.sql`** (assert 1, `'16/5'` → `'18/5'`; el conteo de las 5 anclas de remuneraciones sigue válido — los asserts de las 2 anclas de finiquitos llegan en `finiquitos.test.sql`, Task 3):

old_string:
```sql
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

new_string:
```sql
-- 1) La 0027 extendió el catálogo: 18 claves y las 5 anclas de remuneraciones
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
  '18/5',
  'activar siembra 18 claves de sistema; las 5 anclas de remuneraciones son hojas'
);
```

**2d — `supabase/tests/database/remuneraciones.test.sql`** (fixture de los 4 goldens: gana las columnas nuevas — sin esto el insert viola el `not null` de `nombres`):

old_string:
```sql
insert into public.trabajadores (empresa_id, rut, nombre)
values
  ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '157890123', 'Tomás Fonasa Habitat'),
  ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '165432096', 'Inés Isapre Capital'),
  ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '178901230', 'Mario Tope Modelo'),
  ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '189012349', 'Paula Tramo Habitat');
```

new_string:
```sql
insert into public.trabajadores (empresa_id, rut, nombre, nombres, apellido_paterno, apellido_materno)
values
  ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '157890123', 'Tomás Fonasa Habitat', 'Tomás', 'Fonasa', 'Habitat'),
  ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '165432096', 'Inés Isapre Capital', 'Inés', 'Isapre', 'Capital'),
  ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '178901230', 'Mario Tope Modelo', 'Mario', 'Tope', 'Modelo'),
  ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '189012349', 'Paula Tramo Habitat', 'Paula', 'Tramo', 'Habitat');
```

**2e — `supabase/tests/database/remuneraciones.test.sql`** (throws_ok del RUT con DV malo: con las columnas nuevas el 23514 del CHECK sigue siendo el PRIMER error — sin el parche ganaría el 23502 del not null):

old_string:
```sql
  $$insert into trabajadores (empresa_id, rut, nombre)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '157890124', 'DV Malo')$$,
```

new_string:
```sql
  $$insert into trabajadores (empresa_id, rut, nombre, nombres, apellido_paterno)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '157890124', 'DV Malo', 'DV', 'Malo')$$,
```

**2f — `supabase/tests/database/remuneraciones.test.sql`** (throws_ok del contador: el 42501 de RLS ganaría IGUAL sin este parche — verificado en vivo: el WITH CHECK de RLS se evalúa antes que los constraints de columna; el parche se mantiene por consistencia de fixtures, no por el código de error):

old_string:
```sql
  $$insert into trabajadores (empresa_id, rut, nombre)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '191234561', 'Colado Contador')$$,
```

new_string:
```sql
  $$insert into trabajadores (empresa_id, rut, nombre, nombres, apellido_paterno)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '191234561', 'Colado Contador', 'Colado', 'Contador')$$,
```

**2g — `supabase/tests/database/remuneraciones.test.sql`** (fixture Rosa Desactivada):

old_string:
```sql
insert into public.trabajadores (empresa_id, rut, nombre)
values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '198765430', 'Rosa Desactivada');
```

new_string:
```sql
insert into public.trabajadores (empresa_id, rut, nombre, nombres, apellido_paterno)
values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '198765430', 'Rosa Desactivada', 'Rosa', 'Desactivada');
```

`plan(N)` NO se toca en ningún archivo (mismos conteos: suite 399 / 19 archivos).

- [ ] **Step 3: Aplicar y verificar (smoke transaccional)**

Run: `npx supabase db reset` → aplica 0001-0027 sin errores. El backfill de apellidos y el de anclas corren sobre tablas vacías (las migraciones preceden al seed; `supabase/seed.sql` no inserta trabajadores) → 0 filas, sin choques.

Run: `npx supabase test db` → **19 archivos, 399 asserts** verdes (los 7 parches del Step 2 ya esperan el catálogo 18 y las columnas nuevas).

Validación en vivo (transaccional, TODO se revierte). Escribir (Write tool, UTF-8 sin BOM) `.superpowers/sdd/smoke-p20-t1.sql`:

```sql
\set ON_ERROR_STOP on
begin;

-- Fixture minima (superuser; rollback al final; uuids/RUTs del patron smoke P18/P19, no comiteados)
insert into auth.users (instance_id, id, aud, role, email)
values ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'ana@a.cl');
insert into public.organizaciones (id, rut, razon_social)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '769010007', 'Org A');
insert into public.empresas (id, organizacion_id, rut, razon_social)
values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '769010007', 'Finiquitos A');
insert into public.miembros (usuario_id, organizacion_id, rol)
values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'dueno');

-- 1) Backfill de apellidos: se re-ejecuta el UPDATE EXACTO de la migracion
--    sobre 2 filas legacy (3 palabras y 2 palabras). El drop/set not null es
--    temporal DENTRO de la transaccion (rollback final); el set not null de
--    vuelta prueba ademas que el backfill dejo cero nulls.
alter table public.trabajadores
  alter column nombres drop not null,
  alter column apellido_paterno drop not null;
insert into public.trabajadores (id, empresa_id, rut, nombre) values
  ('10000000-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '111111111', 'Pedro Soto Rivas'),
  ('10000000-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '222222222', 'Ana Vergara');
update public.trabajadores t
set nombres = case when array_length(p.partes, 1) >= 3
                   then array_to_string(p.partes[1:array_length(p.partes, 1) - 2], ' ')
                   else p.partes[1] end,
    apellido_paterno = case when array_length(p.partes, 1) >= 3 then p.partes[array_length(p.partes, 1) - 1]
                            when array_length(p.partes, 1) = 2 then p.partes[2]
                            else '' end,
    apellido_materno = case when array_length(p.partes, 1) >= 3 then p.partes[array_length(p.partes, 1)]
                            else null end
from (select id, regexp_split_to_array(trim(nombre), '\s+') as partes from public.trabajadores) p
where p.id = t.id;
alter table public.trabajadores
  alter column nombres set not null,
  alter column apellido_paterno set not null;
select nombre, nombres, apellido_paterno, coalesce(apellido_materno, '(null)') as apellido_materno
from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' order by rut;

-- 2) Camino real como la duena: activar + catalogo 33/18/5 + las 2 anclas nuevas
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select activar_contabilidad('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa');
select count(*) as cuentas,
       count(*) filter (where clave_sistema is not null) as claves,
       count(*) filter (where not acepta_movimientos) as grupos
from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa';
select codigo, nombre, tipo from cuentas_contables
where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
  and clave_sistema in ('gasto_indemnizaciones', 'finiquitos_por_pagar')
order by codigo;

-- 3) contratos.isapre: slug del catalogo pasa; slug invalido revienta en el CHECK
insert into public.contratos (id, empresa_id, trabajador_id, tipo, fecha_inicio, cargo, sueldo_base, afp, salud, plan_isapre_uf, isapre) values
  ('20000000-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '10000000-0000-0000-0000-000000000001', 'indefinido', date '2024-01-01', 'Chofer', 1500000, 'habitat', 'isapre', 3.5, 'cruzblanca');
insert into public.contratos (id, empresa_id, trabajador_id, tipo, fecha_inicio, cargo, sueldo_base, afp, salud) values
  ('20000000-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '10000000-0000-0000-0000-000000000002', 'indefinido', date '2025-06-01', 'Operaria', 700000, 'modelo', 'fonasa');
do $do$
begin
  update contratos set isapre = 'colmena_falsa' where id = '20000000-0000-0000-0000-000000000001';
  raise notice 'FALLO: isapre fuera del catalogo';
exception when others then
  raise notice 'OK check isapre: %', sqlerrm;
end $do$;

-- 4) vacaciones_tomadas: la duena registra y elimina; UPDATE directo no existe
insert into public.vacaciones_tomadas (empresa_id, trabajador_id, desde, hasta, dias_habiles)
values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '10000000-0000-0000-0000-000000000001', date '2026-02-02', date '2026-02-06', 5);
select count(*) as vacaciones from vacaciones_tomadas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa';
do $do$
begin
  update vacaciones_tomadas set dias_habiles = 3 where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa';
  raise notice 'FALLO: update directo de vacaciones paso';
exception when others then
  raise notice 'OK sin update: %', sqlerrm;
end $do$;
delete from vacaciones_tomadas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa';

-- 5) Candado: ni la duena escribe finiquitos directo (sin grant -> 42501)
do $do$
begin
  insert into finiquitos (empresa_id, trabajador_id, contrato_id, causal, fecha_termino,
    sueldo_base, anos_servicio, indemnizacion_anos, indemnizacion_aviso, feriado_dias, feriado_monto, total, uf)
  values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
    'renuncia', date '2026-06-30', 1, 0, 0, 0, 0, 0, 0, 1);
  raise notice 'FALLO: escritura directa de finiquitos paso';
exception when others then
  raise notice 'OK candado finiquitos: %', sqlerrm;
end $do$;

-- 6) Finiquito ficticio (superuser: simula el snapshot de la RPC de Task 2)
--    y asiento de 2 lineas por el total (1500000+1500000+500000 = 3500000)
reset role;
insert into public.finiquitos (id, empresa_id, trabajador_id, contrato_id, causal, fecha_termino, aviso_dado, estado,
  sueldo_base, anos_servicio, indemnizacion_anos, indemnizacion_aviso, feriado_dias, feriado_monto, total, uf, emitido_en)
values ('30000000-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
  'necesidades_empresa', date '2026-06-30', false, 'emitido',
  1500000, 1, 1500000, 1500000, 10.00, 500000, 3500000, 39200, now());
select contabilizar_documento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'finiquito', '30000000-0000-0000-0000-000000000001') as fin_contab;
select a.glosa, a.fecha,
       string_agg(c.clave_sistema || ':' || l.debe || ':' || l.haber, '|' order by c.clave_sistema) as lineas
from asientos a
join asientos_lineas l on l.asiento_id = a.id and l.empresa_id = a.empresa_id
join cuentas_contables c on c.id = l.cuenta_id and c.empresa_id = l.empresa_id
where a.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and a.origen = 'finiquito'
group by a.id, a.glosa, a.fecha;

-- 7) Noops: total 0 (renuncia sin feriado) y luego el mismo finiquito anulado
insert into public.finiquitos (id, empresa_id, trabajador_id, contrato_id, causal, fecha_termino, aviso_dado, estado,
  sueldo_base, anos_servicio, indemnizacion_anos, indemnizacion_aviso, feriado_dias, feriado_monto, total, uf, emitido_en)
values ('30000000-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002',
  'renuncia', date '2026-06-15', false, 'emitido',
  700000, 0, 0, 0, 0.00, 0, 0, 39200, now());
select contabilizar_documento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'finiquito', '30000000-0000-0000-0000-000000000002') as noop_total_cero;
update public.finiquitos set estado = 'anulado', anulado_en = now(), motivo_anulacion = 'smoke'
where id = '30000000-0000-0000-0000-000000000002';
select contabilizar_documento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'finiquito', '30000000-0000-0000-0000-000000000002') as noop_anulado;
select count(*) as asientos_finiquito from asientos
where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and origen = 'finiquito';

rollback;
```

Run (Bash tool / Git Bash — NO PowerShell 5.1, razones de encoding):

```bash
cat .superpowers/sdd/smoke-p20-t1.sql | docker exec -i supabase_db_ERP_Transportes psql -U postgres -d postgres -v ON_ERROR_STOP=1
```

Salida esperada (valores, en orden):
- (1) `UPDATE 2` (backfill) y 2 filas ordenadas por rut:
  - `Pedro Soto Rivas | Pedro | Soto | Rivas` (3 palabras → 1 nombre + 2 apellidos)
  - `Ana Vergara | Ana | Vergara | (null)` (2 palabras → 1 nombre + 1 paterno, materno null)
- (2) `cuentas = 33`, `claves = 18`, `grupos = 5`; 2 filas: `2.1.08 | Finiquitos por pagar | pasivo` y `5.1.07 | Indemnizaciones | gasto`.
- (3) `INSERT 0 1` (x2); `NOTICE:  OK check isapre: new row for relation "contratos" violates check constraint "contratos_isapre_check"`.
- (4) `vacaciones = 1`; `NOTICE:  OK sin update: permission denied for table vacaciones_tomadas`; `DELETE 1`.
- (5) `NOTICE:  OK candado finiquitos: permission denied for table finiquitos`.
- (6) `fin_contab = creado`; 1 fila: `Finiquito Pedro Soto Rivas | 2026-06-30 | finiquitos_por_pagar:0:3500000|gasto_indemnizaciones:3500000:0` (2 líneas por el TOTAL; fecha = fecha_termino sin clamp — no hay ejercicios cerrados).
- (7) `noop_total_cero = noop`; `UPDATE 1`; `noop_anulado = noop`; `asientos_finiquito = 1` (solo el de Pedro; total 0 y anulado jamás generan asiento).
- Cierre: `ROLLBACK` (nada persiste; los `alter column` de (1) también se revierten).

Byte-scan del archivo nuevo (JAMÁS BOM U+FEFF):

```bash
grep -c $'\xEF\xBB\xBF' supabase/migrations/00000000000027_finiquitos.sql
```

→ imprime `0` y sale con status 1 (sin coincidencias = pass).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/00000000000027_finiquitos.sql supabase/tests/database/contabilidad.test.sql supabase/tests/database/estados_financieros.test.sql supabase/tests/database/remuneraciones.test.sql
git commit -m "feat(db): apellidos separados, isapre, vacaciones y finiquitos con asiento contable — migración 0027

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---
### Task 2: RPCs de finiquitos — emitir con cálculo autoritativo, pagar y anular con reactivación

Baseline verde que esta task DEBE mantener: los conteos EXACTOS que dejó la Task 1 (**pgTAP 399/19**, unit 214; pgTAP y unit no se tocan aquí: task 100% BD; el archivo pgTAP de finiquitos es de la Task 3). `npx supabase test db` debe terminar en los mismos números que el commit de T1.

**Files:**
- Modify: `supabase/migrations/00000000000027_finiquitos.sql` (SOLO anexar la sección 2 DESPUÉS de la marca que dejó T1; cero ediciones sobre la sección 1)
- Create (validación, no comiteado): `.superpowers/sdd/smoke-p20-t2.sql`

**Interfaces:**
- **Secuencia con la Task 1 (cerrada por el ensamblador):**
  1. Nombre del archivo: `supabase/migrations/00000000000027_finiquitos.sql` (fijado por T1).
  2. T1 terminó su sección con la marca `-- ===== RPCs de finiquitos (Task 2) =====` (patrón 0025:192). Esta task anexa TODO su SQL inmediatamente después de esa línea.
  3. DDL de T1 que esta task consume (nombres confirmados contra el draft de T1): tabla `finiquitos` con columnas `id, empresa_id, trabajador_id, contrato_id, causal, fecha_termino, aviso_dado, estado (default 'emitido'), otros_haberes, otros_descuentos, comentario, sueldo_base, anos_servicio, indemnizacion_anos, indemnizacion_aviso, feriado_dias numeric(6,2), feriado_monto, total, uf, emitido_en, pagado_en, anulado_en, motivo_anulacion, creado_en` + **unique parcial: un finiquito no-anulado por (empresa_id, contrato_id)** (esta task NO depende del nombre del índice: captura `unique_violation`); tabla `vacaciones_tomadas` con `empresa_id, trabajador_id, dias_habiles`; `trabajadores.nombres`/`apellido_paterno` NOT NULL (los fixtures del smoke los incluyen).
- Consumes (verificado, no re-investigar): `app.tiene_rol_en_empresa(uuid, text[])` (0003:16); `contratos` + unique parcial `contratos_vigente_idx` (0025:33-56); `indicadores_previsionales` con el período `'2026-07'` sembrado con `uf = 39350` (0025:190); patrón de estructura de validaciones/security definer/revoke-grant: `emitir_liquidacion` (0026:141-315), `pagar_liquidacion` (0025:492-509), `anular_liquidacion` (0025:515-540); fixture del smoke: patrón P19 (auth.users + organizaciones + empresas + miembros + `set local role authenticated` + jwt claims).
- Produces (firmas exactas — **8 parámetros SIN defaults en emitir**: todos los llamadores pasan los 8, Global Constraints):
  - `public.emitir_finiquito(p_empresa uuid, p_trabajador uuid, p_causal text, p_fecha_termino date, p_aviso_dado boolean, p_otros_haberes integer, p_otros_descuentos integer, p_comentario text) returns uuid`
  - `public.pagar_finiquito(p_empresa uuid, p_finiquito uuid) returns void`
  - `public.anular_finiquito(p_empresa uuid, p_finiquito uuid, p_motivo text) returns void`
  - Grants: `revoke execute … from anon, public` + `grant execute … to authenticated` para las 3 (el rol se valida ADENTRO con `app.tiene_rol_en_empresa`).
- **Mensajes byte-exactos:** los 10 de Global Constraints (los dos "reuso P18" son idénticos a los de `emitir_liquidacion`; `'Solo se puede anular un finiquito emitido o pagado'` sigue el patrón 0025 `'Solo se puede anular una liquidación emitida o pagada'`; `'La fecha de término no puede ser anterior al inicio del primer contrato'` es el guard de fechas agregado por los lentes — el espejo TS de T4 lanza el mismo texto).
- **NO va aquí** (otras tasks): origen `'finiquito'` en asientos, anclas 33/18, re-creates contables (todo eso lo hizo T1), hooks de Server Action (T6). `emitir_finiquito` NO crea asientos y `anular_finiquito` NO revierte asientos (los hooks nunca-lanza de la Server Action lo hacen, patrón P18) → ninguna RPC toma el advisory lock del correlativo.

**Definiciones canónicas (contrato SQL⇄TS — el espejo `calcularVacaciones`/`calcularFiniquito` de T4 DEBE replicarlas idénticas):**

Ambas nacen de la MISMA descomposición `v_edad := age(p_fecha_termino, v_inicio)` donde `v_inicio = min(fecha_inicio)` de TODOS los contratos del trabajador en la empresa (primer contrato — continuidad laboral, spec §2.4). **Semántica REAL de `age(t, i)` con t ≥ i (Global Constraints, replicada bug-for-bug por el espejo TS):** resta campo a campo `(y, m, d)` y normaliza — `d < 0` presta los días del MES DE LA FECHA DE INICIO; `m < 0` presta 12 del año. NO es la aritmética de `+ interval '1 month'` (borde de febrero declarado). Los goldens de pgTAP fijan la verdad = `age()` si alguna esquina divergiera.

1. **`meses_completos`** (devengo §2.4): `extract(year from v_edad)::integer * 12 + extract(month from v_edad)::integer` — los días sobrantes NO cuentan. `devengados = round(meses_completos * 1.25, 2)`; `saldo = devengados − Σ dias_habiles`; `feriado_dias = greatest(saldo, 0)`.
2. **`fraccion > 6 meses`** (años de servicio §3.1): con la misma tripleta `(y, m, d)`: `m > 6 OR (m = 6 AND d > 0)` → `anos_servicio = least(y + 1, 11)`; si no, `least(y, 11)`. En TS: mismo predicado sobre la misma descomposición.
3. **Base topada** (§3.2): `least(sueldo_base_vigente, round(90 * uf)::integer)` con la UF del período `to_char(fecha_termino, 'YYYY-MM')`. El **feriado NO usa la base topada**: `feriado_monto = round(sueldo_base_vigente::numeric * feriado_dias / 30)::integer` (GF3 lo demuestra: feriado con 4000000, indemnizaciones con 3541500). `round()` numeric = mitad lejos del cero = `Math.round` para estos montos positivos.

**Aritmética de los 3 goldens: la tabla de Global Constraints es la fuente única** (GF1 con fracción 6m16d → **4 años / total 5133333**; GF2 → 1 año / 800000; GF3 → tope 11 y tope 90 UF / 40623167). pgTAP (T3), core (T4), el smoke de esta task y el E2E usan ESOS bytes.

- [ ] **Step 1: Verificar la marca de T1**

Leer el final de `supabase/migrations/00000000000027_finiquitos.sql` y confirmar que existe la línea-marca `-- ===== RPCs de finiquitos (Task 2) =====` y el DDL de `finiquitos`/`vacaciones_tomadas` con los nombres de Interfaces. Si la marca o algún nombre falta, T1 no corrió o divergió: STOP (no improvisar; NUNCA ajustar la aritmética ni los mensajes).

- [ ] **Step 2: Anexar la sección 2 (Edit tool; UTF-8 SIN BOM; comentarios ASCII sin tildes, mensajes de usuario con tildes)**

Anexar inmediatamente después de la marca:

```sql
-- ================== Finiquitos: RPCs (Task 2) ==================
-- security definer + set search_path = public. emitir NO crea asientos y
-- anular NO revierte asientos (hooks nunca-lanza de la Server Action, patron
-- P18) => ninguna toma el advisory lock del correlativo. La carrera de doble
-- emision la cierra el unique parcial de finiquitos (backstop 23505 ->
-- mensaje contractual); la de reactivacion, contratos_vigente_idx.

-- ---------- Emitir finiquito (calculo AUTORITATIVO, spec SS3) ----------
-- Orden de validacion (spec SS3.7 + guard de los lentes): rol -> contrato
-- vigente -> indicadores -> duplicado -> termino anterior al primer contrato.
-- p_fecha_termino null => periodo null => 0 filas de indicadores =>
-- mismo mensaje (fail-closed). Una causal fuera del catalogo la rechaza el
-- CHECK de la tabla (backstop; el select de la UI no la produce).
-- La formula de vacaciones VIVE aqui (spec SS2.4): primer contrato via
-- min(fecha_inicio) sobre TODOS los contratos del trabajador (continuidad
-- laboral) y suma de vacaciones_tomadas. El feriado usa el sueldo_base VIGENTE
-- SIN tope 90 UF; las indemnizaciones usan la base topada.
create or replace function public.emitir_finiquito(
  p_empresa uuid, p_trabajador uuid, p_causal text, p_fecha_termino date,
  p_aviso_dado boolean, p_otros_haberes integer, p_otros_descuentos integer,
  p_comentario text
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_con record;
  v_ind record;
  v_periodo text;
  v_aviso boolean := coalesce(p_aviso_dado, false);
  v_haberes integer := coalesce(p_otros_haberes, 0);
  v_descuentos integer := coalesce(p_otros_descuentos, 0);
  v_comentario text := nullif(trim(coalesce(p_comentario, '')), '');
  v_inicio date;
  v_edad interval;
  v_anos integer;
  v_base integer;
  v_indem_anos integer;
  v_indem_aviso integer;
  v_meses integer;
  v_devengados numeric(6, 2);
  v_tomados numeric;
  v_feriado_dias numeric(6, 2);
  v_feriado_monto integer;
  v_total integer;
  v_id uuid;
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'contador']) then
    raise exception 'Tu rol no permite emitir finiquitos';
  end if;

  -- Contrato vigente (a lo mas uno: contratos_vigente_idx). Mensaje P18.
  select * into v_con
  from contratos
  where empresa_id = p_empresa and trabajador_id = p_trabajador and vigente;
  if not found then
    raise exception 'El trabajador no tiene contrato vigente';
  end if;

  -- Indicadores del periodo de TERMINO (la UF del tope 90 UF sale de aqui).
  v_periodo := to_char(p_fecha_termino, 'YYYY-MM');
  select * into v_ind from indicadores_previsionales where periodo = v_periodo;
  if not found then
    raise exception 'No hay indicadores previsionales para el período';
  end if;

  -- Chequeo amable ANTES de calcular; el unique parcial es el backstop atomico.
  if exists (
    select 1 from finiquitos
    where empresa_id = p_empresa and contrato_id = v_con.id and estado <> 'anulado'
  ) then
    raise exception 'Ya existe un finiquito para este contrato';
  end if;

  -- SS3.1: anos de servicio desde el PRIMER contrato (continuidad laboral);
  -- fraccion > 6 meses (m > 6, o m = 6 con dias sobrantes) suma 1; tope 11.
  select min(fecha_inicio) into v_inicio
  from contratos
  where empresa_id = p_empresa and trabajador_id = p_trabajador;
  -- Guard de fechas (lentes): un termino anterior al primer contrato daria
  -- age() negativo -> anos negativos en el snapshot o aviso pagado sin devengo.
  if p_fecha_termino < v_inicio then
    raise exception 'La fecha de término no puede ser anterior al inicio del primer contrato';
  end if;
  v_edad := age(p_fecha_termino, v_inicio);
  v_anos := extract(year from v_edad)::integer;
  if extract(month from v_edad)::integer > 6
     or (extract(month from v_edad)::integer = 6 and extract(day from v_edad)::integer > 0) then
    v_anos := v_anos + 1;
  end if;
  v_anos := least(v_anos, 11);

  -- SS3.2: base topada en 90 UF del periodo de termino.
  v_base := least(v_con.sueldo_base, round(90 * v_ind.uf)::integer);

  -- SS3.3-3.4: indemnizaciones solo por necesidades de la empresa; el aviso
  -- omitido agrega un mes de la base topada.
  if p_causal = 'necesidades_empresa' then
    v_indem_anos := v_base * v_anos;
    v_indem_aviso := case when v_aviso then 0 else v_base end;
  else
    v_indem_anos := 0;
    v_indem_aviso := 0;
  end if;

  -- SS2.4 + SS3.5: feriado proporcional. meses COMPLETOS (los dias sobrantes
  -- no cuentan) x 1.25, menos los dias tomados; nunca negativo. El monto usa
  -- el sueldo_base VIGENTE sin tope (simplificacion v1 declarada en el spec:
  -- sin conversion habiles->corridos ni cotizaciones sobre el feriado).
  v_meses := extract(year from v_edad)::integer * 12 + extract(month from v_edad)::integer;
  v_devengados := round(v_meses * 1.25, 2);
  select coalesce(sum(dias_habiles), 0) into v_tomados
  from vacaciones_tomadas
  where empresa_id = p_empresa and trabajador_id = p_trabajador;
  v_feriado_dias := greatest(v_devengados - v_tomados, 0);
  v_feriado_monto := round(v_con.sueldo_base::numeric * v_feriado_dias / 30)::integer;

  -- SS3.6: total + guard fail-closed.
  v_total := v_indem_anos + v_indem_aviso + v_feriado_monto + v_haberes - v_descuentos;
  if v_total < 0 then
    raise exception 'El total del finiquito no puede ser negativo: revisa los descuentos';
  end if;

  -- SS3.7: efectos atomicos + snapshot completo. Un raise posterior (backstop
  -- 23505) revierte tambien estos updates: la RPC es una sola sentencia.
  update contratos set vigente = false
  where empresa_id = p_empresa and id = v_con.id;
  update trabajadores set activo = false
  where empresa_id = p_empresa and id = p_trabajador;

  begin
    insert into finiquitos (
      empresa_id, trabajador_id, contrato_id, causal, fecha_termino, aviso_dado,
      estado, otros_haberes, otros_descuentos, comentario,
      sueldo_base, anos_servicio, indemnizacion_anos, indemnizacion_aviso,
      feriado_dias, feriado_monto, total, uf, emitido_en)
    values (
      p_empresa, p_trabajador, v_con.id, p_causal, p_fecha_termino, v_aviso,
      'emitido', v_haberes, v_descuentos, v_comentario,
      v_con.sueldo_base, v_anos, v_indem_anos, v_indem_aviso,
      v_feriado_dias, v_feriado_monto, v_total, v_ind.uf, now())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Ya existe un finiquito para este contrato';
  end;
  return v_id;
end $$;
revoke execute on function public.emitir_finiquito(uuid, uuid, text, date, boolean, integer, integer, text) from anon, public;
grant execute on function public.emitir_finiquito(uuid, uuid, text, date, boolean, integer, integer, text) to authenticated;

-- ---------- Pagar finiquito (mismos roles; emitido -> pagado) ----------
-- El update re-evalua el estado bajo el row lock: dos pagos concurrentes dejan
-- al segundo con 0 filas -> mensaje contractual (patron 0025).
create or replace function public.pagar_finiquito(p_empresa uuid, p_finiquito uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'contador']) then
    raise exception 'Tu rol no permite emitir finiquitos';
  end if;
  update finiquitos
  set estado = 'pagado', pagado_en = now()
  where id = p_finiquito and empresa_id = p_empresa and estado = 'emitido';
  if not found then
    raise exception 'Solo se puede pagar un finiquito emitido';
  end if;
end $$;
revoke execute on function public.pagar_finiquito(uuid, uuid) from anon, public;
grant execute on function public.pagar_finiquito(uuid, uuid) to authenticated;

-- ---------- Anular finiquito (emitido O pagado -> anulado; REACTIVA) ----------
-- Reactiva contrato (vigente = true) y trabajador (activo = true) validando
-- ANTES que el puesto siga libre; contratos_vigente_idx es el backstop atomico
-- de la carrera contrato-nuevo-vs-anulacion (23505). La reversa contable NO va
-- aqui (hook nunca-lanza, patron 0025). Tras anular, el unique parcial libera
-- el contrato y se puede volver a emitir.
create or replace function public.anular_finiquito(
  p_empresa uuid, p_finiquito uuid, p_motivo text
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_motivo text;
  v_fin record;
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'contador']) then
    raise exception 'Tu rol no permite emitir finiquitos';
  end if;
  v_motivo := nullif(trim(coalesce(p_motivo, '')), '');
  if v_motivo is null then
    raise exception 'Indica el motivo de la anulación';
  end if;
  -- Row lock: dos anulaciones concurrentes dejan a la segunda leyendo
  -- 'anulado' bajo el lock -> mensaje contractual.
  select * into v_fin
  from finiquitos
  where id = p_finiquito and empresa_id = p_empresa
  for update;
  if not found or v_fin.estado not in ('emitido', 'pagado') then
    raise exception 'Solo se puede anular un finiquito emitido o pagado';
  end if;
  if exists (
    select 1 from contratos
    where empresa_id = p_empresa and trabajador_id = v_fin.trabajador_id
      and vigente and id <> v_fin.contrato_id
  ) then
    raise exception 'El trabajador ya tiene otro contrato vigente';
  end if;
  update finiquitos
  set estado = 'anulado', anulado_en = now(), motivo_anulacion = v_motivo
  where id = p_finiquito and empresa_id = p_empresa;
  update contratos set vigente = true
  where empresa_id = p_empresa and id = v_fin.contrato_id;
  update trabajadores set activo = true
  where empresa_id = p_empresa and id = v_fin.trabajador_id;
end $$;
revoke execute on function public.anular_finiquito(uuid, uuid, text) from anon, public;
grant execute on function public.anular_finiquito(uuid, uuid, text) to authenticated;
```

- [ ] **Step 3: Aplicar y verificar (smoke con los 3 goldens en vivo)**

Run: `npx supabase db reset` → aplica 0001-0027 sin errores.

Run: `npx supabase test db` → mismos conteos verdes que dejó la Task 1 (**399/19** — esta task no toca tests).

Validación en vivo (transaccional, TODO se revierte). Escribir (Write tool, UTF-8 sin BOM) `.superpowers/sdd/smoke-p20-t2.sql`:

```sql
\set ON_ERROR_STOP on
begin;

-- Fixture minima (superuser; rollback al final; uuids/RUTs del patron smoke P19)
insert into auth.users (instance_id, id, aud, role, email)
values ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'ana@a.cl');
insert into public.organizaciones (id, rut, razon_social)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '769010007', 'Org A');
insert into public.empresas (id, organizacion_id, rut, razon_social)
values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '769010007', 'Finiquitos A');
insert into public.miembros (usuario_id, organizacion_id, rol)
values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'dueno');

-- GF1 con DOS contratos (continuidad laboral: el calculo parte del 2023-01-15
-- aunque el vigente sea del 2025) y DOS tomas de vacaciones (6 + 4 = 10).
insert into public.trabajadores (id, empresa_id, rut, nombre, nombres, apellido_paterno) values
  ('10000000-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '111111111', 'GF1 Necesidades', 'GF1', 'Necesidades'),
  ('10000000-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '222222222', 'GF2 Renuncia', 'GF2', 'Renuncia'),
  ('10000000-0000-0000-0000-000000000003', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '333333333', 'GF3 Tope', 'GF3', 'Tope');
insert into public.contratos (id, empresa_id, trabajador_id, tipo, fecha_inicio, cargo, sueldo_base, gratificacion_legal, afp, salud, vigente) values
  ('20000000-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '10000000-0000-0000-0000-000000000001', 'indefinido', date '2023-01-15', 'Operario', 700000, true, 'habitat', 'fonasa', false),
  ('20000000-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '10000000-0000-0000-0000-000000000001', 'indefinido', date '2025-01-01', 'Operario', 800000, true, 'habitat', 'fonasa', true),
  ('20000000-0000-0000-0000-000000000003', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '10000000-0000-0000-0000-000000000002', 'indefinido', date '2025-03-01', 'Chofer', 1200000, true, 'capital', 'fonasa', true),
  ('20000000-0000-0000-0000-000000000004', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '10000000-0000-0000-0000-000000000003', 'indefinido', date '2012-05-01', 'Gerente', 4000000, true, 'modelo', 'fonasa', true);
-- dias_habiles no se cruza con el rango (v1 sin validacion de solape/consistencia)
insert into public.vacaciones_tomadas (empresa_id, trabajador_id, desde, hasta, dias_habiles) values
  ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '10000000-0000-0000-0000-000000000001', date '2026-02-02', date '2026-02-09', 6),
  ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '10000000-0000-0000-0000-000000000001', date '2026-04-06', date '2026-04-09', 4),
  ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '10000000-0000-0000-0000-000000000003', date '2020-02-03', date '2020-02-28', 200);

set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- 1) Fail-closed: sin indicadores del periodo de termino no hay finiquito
do $do$
begin
  perform emitir_finiquito('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '10000000-0000-0000-0000-000000000001', 'renuncia', date '2027-01-31', false, 0, 0, null);
  raise notice 'FALLO: emitio sin indicadores';
exception when others then
  raise notice 'OK indicadores: %', sqlerrm;
end $do$;

-- 2) Guard: total negativo por descuentos
do $do$
begin
  perform emitir_finiquito('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '10000000-0000-0000-0000-000000000002', 'renuncia', date '2026-07-31', false, 0, 10000000, null);
  raise notice 'FALLO: total negativo emitio';
exception when others then
  raise notice 'OK guard: %', sqlerrm;
end $do$;

-- 3) GOLDENS GF1/GF2/GF3 (tabla de Global Constraints del plan)
select emitir_finiquito('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '10000000-0000-0000-0000-000000000001', 'necesidades_empresa', date '2026-07-31', false, 0, 0, null) is not null as gf1_emitido;
select emitir_finiquito('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '10000000-0000-0000-0000-000000000002', 'renuncia', date '2026-07-31', false, 0, 0, null) is not null as gf2_emitido;
select emitir_finiquito('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '10000000-0000-0000-0000-000000000003', 'necesidades_empresa', date '2026-07-31', true, 0, 0, 'Reestructuración') is not null as gf3_emitido;
select t.nombre, f.causal, f.aviso_dado, f.anos_servicio, f.sueldo_base, f.uf,
       f.indemnizacion_anos, f.indemnizacion_aviso, f.feriado_dias, f.feriado_monto, f.total
from finiquitos f
join trabajadores t on t.id = f.trabajador_id and t.empresa_id = f.empresa_id
where f.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
order by t.nombre;

-- 4) Efectos: los 3 contratos finiquitados cerrados, los 3 trabajadores inactivos
select count(*) filter (where vigente) as contratos_vigentes
from contratos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa';
select count(*) filter (where activo) as trabajadores_activos
from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa';

-- 5) Duplicado: superuser simula la carrera reabriendo el contrato de GF2 SIN anular
reset role;
update contratos set vigente = true where id = '20000000-0000-0000-0000-000000000003';
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
do $do$
begin
  perform emitir_finiquito('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '10000000-0000-0000-0000-000000000002', 'renuncia', date '2026-07-31', false, 0, 0, null);
  raise notice 'FALLO: duplicado emitio';
exception when others then
  raise notice 'OK duplicado: %', sqlerrm;
end $do$;
reset role;
update contratos set vigente = false where id = '20000000-0000-0000-0000-000000000003';
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- 6) Maquina de estados: pagar GF2 (emitido -> pagado); repagar falla
select pagar_finiquito('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from finiquitos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and trabajador_id = '10000000-0000-0000-0000-000000000002'));
select estado, pagado_en is not null as con_fecha from finiquitos
where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
  and trabajador_id = '10000000-0000-0000-0000-000000000002';
do $do$
begin
  perform pagar_finiquito('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from finiquitos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
       and trabajador_id = '10000000-0000-0000-0000-000000000002'));
  raise notice 'FALLO: repago';
exception when others then
  raise notice 'OK repago: %', sqlerrm;
end $do$;

-- 7) Anular sin motivo -> raise byte-exacto
do $do$
begin
  perform anular_finiquito('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from finiquitos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
       and trabajador_id = '10000000-0000-0000-0000-000000000001'), '   ');
  raise notice 'FALLO: anulo sin motivo';
exception when others then
  raise notice 'OK motivo: %', sqlerrm;
end $do$;

-- 8) Anular GF1 -> REACTIVA el contrato del finiquito (el de 2025) y al trabajador
select anular_finiquito('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from finiquitos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and trabajador_id = '10000000-0000-0000-0000-000000000001'), 'Error en la causal');
select estado, anulado_en is not null as con_fecha, motivo_anulacion from finiquitos
where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
  and trabajador_id = '10000000-0000-0000-0000-000000000001';
select vigente from contratos where id = '20000000-0000-0000-0000-000000000002';
select activo from trabajadores where id = '10000000-0000-0000-0000-000000000001';

-- 9) Re-emitir tras anular: el anulado no bloquea; MISMOS montos (goldens estables)
select emitir_finiquito('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '10000000-0000-0000-0000-000000000001', 'necesidades_empresa', date '2026-07-31', false, 0, 0, null) is not null as gf1_reemitido;
select total from finiquitos
where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
  and trabajador_id = '10000000-0000-0000-0000-000000000001' and estado = 'emitido';

-- 10) Anular con OTRO contrato vigente: superuser contrata de nuevo a GF3 y
--     la anulacion se niega a reactivar
reset role;
insert into public.contratos (id, empresa_id, trabajador_id, tipo, fecha_inicio, cargo, sueldo_base, gratificacion_legal, afp, salud) values
  ('20000000-0000-0000-0000-000000000005', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '10000000-0000-0000-0000-000000000003', 'indefinido', date '2026-08-01', 'Asesor', 1000000, true, 'habitat', 'fonasa');
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
do $do$
begin
  perform anular_finiquito('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from finiquitos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
       and trabajador_id = '10000000-0000-0000-0000-000000000003'), 'Intento con recontratado');
  raise notice 'FALLO: anulo con otro contrato vigente';
exception when others then
  raise notice 'OK otro contrato: %', sqlerrm;
end $do$;

-- 11) Pagado -> anulado tambien reactiva (GF2; su contrato quedo cerrado en 5)
select anular_finiquito('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from finiquitos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and trabajador_id = '10000000-0000-0000-0000-000000000002'), 'Pago duplicado');
select estado from finiquitos
where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
  and trabajador_id = '10000000-0000-0000-0000-000000000002';
select vigente from contratos where id = '20000000-0000-0000-0000-000000000003';
select activo from trabajadores where id = '10000000-0000-0000-0000-000000000002';

reset role;
rollback;
```

Run (Bash tool / Git Bash — NO PowerShell 5.1, razones de encoding):

```bash
cat .superpowers/sdd/smoke-p20-t2.sql | docker exec -i supabase_db_ERP_Transportes psql -U postgres -d postgres -v ON_ERROR_STOP=1
```

Salida esperada (valores, en orden):
- (1) `NOTICE:  OK indicadores: No hay indicadores previsionales para el período`.
- (2) `NOTICE:  OK guard: El total del finiquito no puede ser negativo: revisa los descuentos`.
- (3) `gf1_emitido = t`, `gf2_emitido = t`, `gf3_emitido = t` y la tabla BYTE-EXACTA (orden por nombre):
  - `GF1 Necesidades | necesidades_empresa | f | 4 | 800000 | 39350 | 3200000 | 800000 | 42.50 | 1133333 | 5133333`
  - `GF2 Renuncia | renuncia | f | 1 | 1200000 | 39350 | 0 | 0 | 20.00 | 800000 | 800000`
  - `GF3 Tope | necesidades_empresa | t | 11 | 4000000 | 39350 | 38956500 | 0 | 12.50 | 1666667 | 40623167`
- (4) `contratos_vigentes = 0`; `trabajadores_activos = 0`.
- (5) `UPDATE 1`; `NOTICE:  OK duplicado: Ya existe un finiquito para este contrato`; `UPDATE 1` (contrato re-cerrado).
- (6) 1 fila `pagado | t`; `NOTICE:  OK repago: Solo se puede pagar un finiquito emitido`.
- (7) `NOTICE:  OK motivo: Indica el motivo de la anulación` (motivo solo-espacios cuenta como vacío).
- (8) 1 fila `anulado | t | Error en la causal`; `vigente = t` (contrato 2025 de GF1); `activo = t`.
- (9) `gf1_reemitido = t`; 1 fila `total = 5133333` (GF1 tiene ahora 2 finiquitos: el anulado y el emitido; el filtro `estado = 'emitido'` toma el nuevo).
- (10) `INSERT 0 1`; `NOTICE:  OK otro contrato: El trabajador ya tiene otro contrato vigente` (GF3 sigue `emitido`; nada se reactivó).
- (11) 1 fila `anulado`; `vigente = t` (contrato de GF2 reactivado); `activo = t`.
- Cierre: `ROLLBACK` (nada persiste).

Byte-scan de la migración (JAMÁS BOM U+FEFF):

```bash
grep -c $'\xEF\xBB\xBF' supabase/migrations/00000000000027_finiquitos.sql
```

→ imprime `0` y sale con status 1 (sin coincidencias = pass).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/00000000000027_finiquitos.sql
git commit -m "feat(db): emitir, pagar y anular finiquito — cálculo autoritativo con causales, topes legales y reactivación al anular

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

→ commit en la rama del plan; la suite sigue en los conteos de T1 (el pgTAP de finiquitos y el espejo TS consumen los goldens GF1-GF3 tal cual).

---
### Task 3: pgTAP de finiquitos — goldens GF1-GF3, ciclo emitir/pagar/anular y asiento de 2 líneas

Baseline: depende de T1 (migración 0027) y T2 (RPCs). Contratos confirmados por el ensamblador:

- **Firmas REALES de T2:** `emitir_finiquito(p_empresa, p_trabajador, p_causal, p_fecha_termino, p_aviso_dado, p_otros_haberes, p_otros_descuentos, p_comentario)` — **8 parámetros SIN defaults → TODAS las llamadas de este archivo pasan los 8 posicionales (comentario `null`)**; `pagar_finiquito(p_empresa, p_finiquito)`; `anular_finiquito(p_empresa, p_finiquito, p_motivo)`.
- **Regla de años (canónica, Global Constraints):** descomposición de `age()` + fracción `m > 6 OR (m = 6 AND d > 0)`. GF1 (6m16d) → 4 años; W5 (6m30d) → 1 año. (La comparación de fechas `fecha_termino > inicio + años + '6 months'` del borrador es EQUIVALENTE — se documenta como la misma regla.)
- **`anular_finiquito` acepta estado `pagado`** (spec §3: "emitido o pagado → anulado") — el flujo W1 anula un finiquito PAGADO.
- El mensaje `'Ya existe un finiquito para este contrato'` solo es alcanzable con el contrato reactivado a mano (tras emitir, `vigente` queda false y ganaría `'El trabajador no tiene contrato vigente'`): el test lo cubre con una simulación superuser declarada, igual que el catch-up pre-P19 de remuneraciones.
- Suite actual verificada: **399 asserts en 19 archivos**. Este archivo agrega `plan(36)` → **435 en 20 archivos**. Los 5 asserts que los lentes sumaron sobre el borrador: guard de fechas (9), re-anular un anulado (23), golden `vencimiento_plazo` (25, re-emisión de Gabriel — golden VP de Global Constraints) y el backfill de apellidos portado del smoke de T1 (35-36, verificación PERMANENTE — el smoke no se comitea).
- **Fixture extra del guard de fechas:** `'2022-12'` se siembra copiando la fila canónica de `'2026-07'` (la 0025 solo siembra 2026-05/06/07) — el término anterior al primer contrato debe pasar el chequeo de indicadores y morir EN el guard.
- **RUTs del bloque de backfill:** `111111111` (cuerpo 11111111, DV 1) y `222222222` (cuerpo 22222222, DV 2) — módulo 11 válidos, los mismos del smoke de T1; viven SOLO dentro de la transacción del archivo (insert legacy + delete + rollback), por eso NO entran al rg de colisiones del Step 2.

**RUTs nuevos (módulo 11, únicos GLOBALES — `rg` = 0 en tests, seed y E2E, verificado):**

| RUT | cuerpo | DV | uso |
|---|---|---|---|
| `769910018` | 76991001 | 8 | organización y empresa |
| `142356783` | 14235678 | 3 | W1 — GF1 (Gabriel) |
| `167890237` | 16789023 | 7 | W2 — GF2 (Gloria) |
| `134567899` | 13456789 | 9 | W3 — GF3 (Germán) |
| `201234565` | 20123456 | 5 | W4 — sin contrato (Sara) |
| `159876543` | 15987654 | 3 | W5 — total 0 (Nicolás) |
| `213456784` | 21345678 | 4 | insert que viola not null (nunca persiste) |

Negativo de total (assert 10): W2 con `otros_descuentos = 1000000` antes de su emisión real → 800000 − 1000000 = −200000 < 0 → raise (no persiste nada; W2 se emite después).

**Files:**
- Create: `supabase/tests/database/finiquitos.test.sql` (archivo 20 de la suite)

- [ ] **Step 1: crear `supabase/tests/database/finiquitos.test.sql` con este contenido exacto**

```sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(36);

-- ===== Fixtures (superuser: salta grants/RLS, patrón contabilidad) =====
-- Ana dueña, Ces CONTADOR y Vero VENDEDORA de la empresa A.
insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'ana@finiq.cl'),
  ('00000000-0000-0000-0000-000000000000', '55555555-5555-5555-5555-555555555555', 'authenticated', 'authenticated', 'ces@finiq.cl'),
  ('00000000-0000-0000-0000-000000000000', '77777777-7777-7777-7777-777777777777', 'authenticated', 'authenticated', 'vero@finiq.cl');

-- RUT nuevo, único GLOBAL (módulo 11: cuerpo 76991001, DV 8): 769910018 no
-- aparece en ningún test, el seed ni los E2E (grep = 0).
insert into public.organizaciones (id, rut, razon_social)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '769910018', 'Org Finiquitos');

insert into public.empresas (id, organizacion_id, rut, razon_social)
values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '769910018', 'Finiquitos A');

insert into public.miembros (usuario_id, organizacion_id, rol)
values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'dueno'),
       ('55555555-5555-5555-5555-555555555555', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'contador'),
       ('77777777-7777-7777-7777-777777777777', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'vendedor');

-- Indicadores CANÓNICOS de '2026-07' (UF 39350: la de los goldens GF1-GF3 y
-- del espejo TS; el resto de campos no participa del finiquito pero mantiene
-- la forma canónica de la 0025/0026). UPSERT: si algún seed futuro siembra
-- '2026-07', el test fija los valores dentro de su transacción (rollback).
insert into public.indicadores_previsionales
  (periodo, uf, utm, ingreso_minimo, tope_imponible_uf, tope_cesantia_uf, tasa_sis, tasas_afp, tramos_impuesto)
values
  ('2026-07', 39350, 69500, 529000, 87.8, 131.9, 1.53,
   '{"capital":11.44,"cuprum":11.44,"habitat":11.27,"modelo":10.58,"planvital":11.10,"provida":11.45,"uno":10.49}'::jsonb,
   '[{"desde_utm":0,"hasta_utm":13.5,"factor":0,"rebaja_utm":0},
     {"desde_utm":13.5,"hasta_utm":30,"factor":0.04,"rebaja_utm":0.54},
     {"desde_utm":30,"hasta_utm":50,"factor":0.08,"rebaja_utm":1.74},
     {"desde_utm":50,"hasta_utm":70,"factor":0.135,"rebaja_utm":4.49},
     {"desde_utm":70,"hasta_utm":90,"factor":0.23,"rebaja_utm":11.14},
     {"desde_utm":90,"hasta_utm":120,"factor":0.304,"rebaja_utm":17.8},
     {"desde_utm":120,"hasta_utm":310,"factor":0.35,"rebaja_utm":23.32},
     {"desde_utm":310,"hasta_utm":null,"factor":0.4,"rebaja_utm":38.82}]'::jsonb)
on conflict (periodo) do update
  set uf = excluded.uf, utm = excluded.utm, ingreso_minimo = excluded.ingreso_minimo,
      tope_imponible_uf = excluded.tope_imponible_uf, tope_cesantia_uf = excluded.tope_cesantia_uf,
      tasa_sis = excluded.tasa_sis, tasas_afp = excluded.tasas_afp, tramos_impuesto = excluded.tramos_impuesto;

-- Blindaje del negativo "sin indicadores": '2031-01' jamás debe existir.
delete from public.indicadores_previsionales where periodo = '2031-01';

-- Guard de fechas (assert 9): '2022-12' EXISTE (copia de la fila canónica de
-- '2026-07' — la 0025 solo siembra 2026-05/06/07) para que el término anterior
-- al primer contrato pase el chequeo de indicadores y muera EN el guard.
insert into public.indicadores_previsionales
  (periodo, uf, utm, ingreso_minimo, tope_imponible_uf, tope_cesantia_uf, tasa_sis, tasas_afp, tramos_impuesto)
select '2022-12', uf, utm, ingreso_minimo, tope_imponible_uf, tope_cesantia_uf, tasa_sis, tasas_afp, tramos_impuesto
from public.indicadores_previsionales
where periodo = '2026-07'
on conflict (periodo) do nothing;

-- ===== Activación de contabilidad (Ana, dueña) — para la sección del asiento =====
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select activar_contabilidad('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa');

-- 1) La 0027 volvió a extender el catálogo: 18 claves y las 2 anclas nuevas
--    (gasto_indemnizaciones grupo 5, finiquitos_por_pagar grupo 2) son hojas.
select is(
  (select count(*) from cuentas_contables
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema is not null)::text
  || '/' ||
  (select count(*) from cuentas_contables
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and clave_sistema in ('gasto_indemnizaciones', 'finiquitos_por_pagar')
     and acepta_movimientos)::text,
  '18/2',
  'activar siembra 18 claves de sistema; las 2 anclas de finiquitos son hojas'
);

-- ===== Trabajadores (Ana, camino real): la 0027 exige los 3 campos de nombre =====
-- RUT de trabajadores nuevos, únicos GLOBALES (módulo 11, DV en el plan):
-- 142356783 / 167890237 / 134567899 / 201234565 / 159876543 — grep = 0 en
-- tests, seed y E2E. Convención 0027: se escriben los 3 campos y nombre
-- compuesto (la Server Action compone; aquí se escribe la composición a mano).
insert into public.trabajadores (empresa_id, rut, nombre, nombres, apellido_paterno, apellido_materno)
values
  ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '142356783', 'Gabriel Fuentes Norambuena', 'Gabriel', 'Fuentes', 'Norambuena'),
  ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '167890237', 'Gloria Farías Bravo', 'Gloria', 'Farías', 'Bravo'),
  ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '134567899', 'Germán Figueroa Toledo', 'Germán', 'Figueroa', 'Toledo'),
  ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '201234565', 'Sara Contreras', 'Sara', 'Contreras', null),
  ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '159876543', 'Nicolás Osorio Pinto', 'Nicolás', 'Osorio', 'Pinto');

-- 2) La dueña inserta con los 3 campos (apellido_materno nullable) y los ve.
select is(
  (select count(*) from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'),
  5::bigint,
  'la dueña inserta trabajadores con nombres y apellidos separados y los ve'
);

-- 3) El DDL de la 0027 exige nombres y apellido_paterno: insertar solo el
--    display "nombre" (convención pre-P20) viola el not null. RUT válido y
--    nuevo (módulo 11: cuerpo 21345678, DV 4) que jamás persiste. El backfill
--    en sí lo smoke-testeó T1: aquí solo datos nuevos.
select throws_ok(
  $$insert into trabajadores (empresa_id, rut, nombre)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '213456784', 'Sin Apellidos Separados')$$,
  '23502',
  null,
  'un trabajador sin nombres/apellido_paterno viola el not null de la 0027'
);

-- ===== Contratos (Ana, escritura directa dueno/admin): W4 queda SIN contrato =====
-- SETUP (felices sin assert, patrón contabilidad: si fallaran, el archivo aborta).
-- Las fechas de inicio fijan los años de servicio y el devengo de los goldens.
insert into public.contratos (empresa_id, trabajador_id, tipo, fecha_inicio, cargo, sueldo_base, afp, salud)
values
  ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
   (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '142356783'),
   'indefinido', date '2023-01-15', 'Chofer', 800000, 'habitat', 'fonasa'),
  ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
   (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '167890237'),
   'indefinido', date '2025-03-01', 'Analista', 1200000, 'capital', 'fonasa'),
  ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
   (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '134567899'),
   'indefinido', date '2012-05-01', 'Gerente', 4000000, 'modelo', 'fonasa'),
  ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
   (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '159876543'),
   'indefinido', date '2026-01-01', 'Auxiliar', 500000, 'uno', 'fonasa');

-- ===== Vacaciones (Ana): INSERT y DELETE directo dueno/admin (precedente gastos_vehiculo) =====
-- SETUP: las tomas fijan el feriado de los goldens (W1 10, W3 200, W5 10);
-- la de W2 (5 días) es TEMPORAL: se borra en el assert 5 y GF2 queda con 0.
insert into public.vacaciones_tomadas (empresa_id, trabajador_id, desde, hasta, dias_habiles)
values
  ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
   (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '142356783'),
   date '2026-02-02', date '2026-02-13', 10),
  ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
   (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '134567899'),
   date '2020-01-06', date '2020-10-16', 200),
  ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
   (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '159876543'),
   date '2026-06-01', date '2026-06-12', 10),
  ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
   (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '167890237'),
   date '2026-04-06', date '2026-04-10', 5);

-- 4) La dueña registra las 4 tomas por escritura directa y las ve.
select is(
  (select count(*) from vacaciones_tomadas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'),
  4::bigint,
  'la dueña registra tomas de vacaciones por escritura directa y las ve'
);

-- 5) La dueña ELIMINA la toma de Gloria (DELETE directo del spec §2.3): GF2
--    queda con 0 días tomados, como exige su golden.
delete from public.vacaciones_tomadas
 where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
   and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '167890237');
select is(
  (select count(*) from vacaciones_tomadas
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '167890237')),
  0::bigint,
  'la dueña elimina una toma por DELETE directo y el saldo la deja de restar'
);

-- ===== emitir_finiquito: negativos (cada uno con UNA sola condición que falla) =====
-- Firma T2: 8 posicionales, el último es p_comentario (sin default) -> null.

-- 6) Vendedor (Vero): el rol se chequea PRIMERO, ids ficticios igual dan el mensaje de rol.
set local request.jwt.claims to '{"sub": "77777777-7777-7777-7777-777777777777", "role": "authenticated"}';
select throws_ok(
  $$select emitir_finiquito('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', gen_random_uuid(),
    'renuncia', date '2026-07-31', false, 0, 0, null)$$,
  'P0001', 'Tu rol no permite emitir finiquitos',
  'el vendedor no emite finiquitos'
);

set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- 7) Sara (W4) no tiene contrato vigente (mensaje P18 reutilizado).
select throws_ok(
  $$select emitir_finiquito('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '201234565'),
    'renuncia', date '2026-07-31', false, 0, 0, null)$$,
  'P0001', 'El trabajador no tiene contrato vigente',
  'sin contrato vigente no hay finiquito'
);

-- 8) Fecha de término en un período SIN indicadores ('2031-01' jamás sembrado):
--    el tope 90 UF exige la UF del período de término.
select throws_ok(
  $$select emitir_finiquito('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '134567899'),
    'necesidades_empresa', date '2031-01-15', true, 0, 0, null)$$,
  'P0001', 'No hay indicadores previsionales para el período',
  'sin indicadores del período de término no hay finiquito'
);

-- 9) Fecha de término ANTERIOR al primer contrato (Gabriel parte el
--    2023-01-15; '2022-12' SÍ tiene indicadores — fixture): guard byte-exacto.
--    Sin él, age() negativo envenenaría el snapshot (años negativos o aviso
--    pagado sin devengo).
select throws_ok(
  $$select emitir_finiquito('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '142356783'),
    'renuncia', date '2022-12-31', false, 0, 0, null)$$,
  'P0001', 'La fecha de término no puede ser anterior al inicio del primer contrato',
  'una fecha de término anterior al primer contrato es rechazada'
);

-- 10) Total negativo (Gloria, renuncia: feriado 800000 − descuentos 1000000 =
--    −200000): guard fail-closed ANTES de insertar (un total negativo
--    envenenaría el asiento). No persiste nada: GF2 se emite después.
select throws_ok(
  $$select emitir_finiquito('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '167890237'),
    'renuncia', date '2026-07-31', false, 0, 1000000, null)$$,
  'P0001', 'El total del finiquito no puede ser negativo: revisa los descuentos',
  'un finiquito con total negativo es rechazado antes de insertarse'
);

-- ===== Goldens GF1-GF3 y W5 (tabla de Global Constraints, espejo del TS) =====

-- SETUP (feliz sin assert): Ana emite GF1 (Gabriel, necesidades sin aviso).
select emitir_finiquito('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '142356783'),
  'necesidades_empresa', date '2026-07-31', false, 0, 0, null);

-- 11) GOLDEN GF1 (necesidades_empresa SIN aviso, 800000, 2023-01-15 → 2026-07-31,
--     10 tomados): age = 3a 6m 16d → fracción m=6 con d>0 SUPERA → 4 años;
--     base min(800000, 3541500) = 800000; indem_años 800000×4 = 3200000;
--     aviso no dado → 800000; devengo 42 meses × 1.25 = 52.50 − 10 = 42.50;
--     feriado round(800000×42.5/30) = 1133333;
--     total 3200000+800000+1133333 = 5133333. UF snapshoteada 39350.
select is(
  (select causal || '/' || anos_servicio || '/' || sueldo_base || '/' || indemnizacion_anos
     || '/' || indemnizacion_aviso || '/' || feriado_dias || '/' || feriado_monto
     || '/' || total || '/' || uf
   from finiquitos
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '142356783')),
  'necesidades_empresa/4/800000/3200000/800000/42.50/1133333/5133333/39350',
  'GF1: necesidades sin aviso calza byte a byte con el cálculo a mano'
);

-- 12) Efectos atómicos de emitir: nace emitido con emitido_en, el contrato del
--     snapshot queda vigente=false y Gabriel activo=false.
select is(
  (select f.estado || '/' || (f.emitido_en is not null)::text || '/' || c.vigente || '/' || t.activo
   from finiquitos f
   join contratos c on c.empresa_id = f.empresa_id and c.id = f.contrato_id
   join trabajadores t on t.empresa_id = f.empresa_id and t.id = f.trabajador_id
   where f.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and f.trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '142356783')),
  'emitido/true/false/false',
  'emitir deja el finiquito emitido, cierra el contrato y desactiva al trabajador'
);

-- SETUP (feliz sin assert): el CONTADOR (Ces) emite GF2 (spec §3: dueno/admin/contador).
set local request.jwt.claims to '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated"}';
select emitir_finiquito('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '167890237'),
  'renuncia', date '2026-07-31', false, 0, 0, null);

-- 13) GOLDEN GF2 (renuncia, 1200000, 2025-03-01 → 2026-07-31, 0 tomados,
--     emitido por el CONTADOR): age = 1a 4m 30d → fracción ≤ 6 meses → 1;
--     indemnizaciones 0 (renuncia); devengo 16 × 1.25 = 20.00; feriado
--     round(1200000×20/30) = 800000 = total.
select is(
  (select causal || '/' || anos_servicio || '/' || sueldo_base || '/' || indemnizacion_anos
     || '/' || indemnizacion_aviso || '/' || feriado_dias || '/' || feriado_monto || '/' || total
   from finiquitos
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '167890237')),
  'renuncia/1/1200000/0/0/20.00/800000/800000',
  'GF2: la renuncia solo paga el feriado proporcional y el contador SÍ emite'
);

-- SETUP (felices sin assert): Ana emite GF3 y el finiquito total-0 de Nicolás.
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select emitir_finiquito('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '134567899'),
  'necesidades_empresa', date '2026-07-31', true, 0, 0, null);
select emitir_finiquito('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '159876543'),
  'renuncia', date '2026-07-31', false, 0, 0, null);

-- 14) GOLDEN GF3 (necesidades CON aviso, 4000000, 2012-05-01 → 2026-07-31,
--     200 tomados): age = 14a 2m 30d → 14 → TOPE 11; base min(4000000,
--     round(90×39350) = 3541500) = 3541500 (TOPE 90 UF muerde); indem_años
--     3541500×11 = 38956500; aviso dado → 0; devengo 170 × 1.25 = 212.50 −
--     200 = 12.50; feriado round(4000000×12.5/30) = 1666667 (sobre el sueldo
--     SIN tope, spec §3.5); total 38956500+1666667 = 40623167.
select is(
  (select causal || '/' || anos_servicio || '/' || sueldo_base || '/' || indemnizacion_anos
     || '/' || indemnizacion_aviso || '/' || feriado_dias || '/' || feriado_monto || '/' || total
   from finiquitos
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '134567899')),
  'necesidades_empresa/11/4000000/38956500/0/12.50/1666667/40623167',
  'GF3: tope 11 años y tope 90 UF calzan byte a byte con el cálculo a mano'
);

-- 15) GOLDEN W5 (renuncia, 500000, 2026-01-01 → 2026-07-31, 10 tomados):
--     age = 0a 6m 30d → fracción m=6 con d>0 → 1 año; devengo 6 × 1.25 =
--     7.50 − 10 = −2.50 → feriado_dias = max(saldo, 0) = 0.00; total 0 (el
--     noop contable del assert 33 usa este finiquito).
select is(
  (select anos_servicio || '/' || indemnizacion_anos || '/' || indemnizacion_aviso
     || '/' || feriado_dias || '/' || feriado_monto || '/' || total
   from finiquitos
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '159876543')),
  '1/0/0/0.00/0/0',
  'con saldo negativo el feriado se clampea en 0 y el total queda en 0'
);

-- ===== Duplicado (simulación superuser DECLARADA, patrón catch-up P19) =====
-- Tras emitir, el contrato queda vigente=false y un segundo emitir moriría
-- antes con 'El trabajador no tiene contrato vigente'. La rama del duplicado
-- protege el estado inconsistente (contrato reabierto a mano con el finiquito
-- vivo): se simula como superusuario y se revierte al tiro.
reset role;
update public.contratos set vigente = true
 where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
   and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '142356783');
update public.trabajadores set activo = true
 where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '142356783';
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- 16) Con el contrato vigente de nuevo y el finiquito emitido vivo: duplicado.
select throws_ok(
  $$select emitir_finiquito('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '142356783'),
    'necesidades_empresa', date '2026-07-31', false, 0, 0, null)$$,
  'P0001', 'Ya existe un finiquito para este contrato',
  'no se emite un segundo finiquito para el mismo contrato'
);

-- SETUP: deshacer la simulación (el mundo vuelve al estado post-emisión real).
reset role;
update public.contratos set vigente = false
 where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
   and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '142356783');
update public.trabajadores set activo = false
 where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '142356783';
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- ===== pagar_finiquito (Ana): emitido → pagado, y solo emitido =====

-- SETUP (feliz sin assert): pagar el finiquito de Gabriel (GF1).
select pagar_finiquito('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from finiquitos
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '142356783')));

-- 17) Quedó pagado con pagado_en.
select is(
  (select estado || '/' || (pagado_en is not null)::text
   from finiquitos
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '142356783')),
  'pagado/true',
  'pagar deja el finiquito pagado y registra pagado_en'
);

-- 18) Re-pagar un pagado: solo emitido se paga.
select throws_ok(
  $$select pagar_finiquito('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from finiquitos
     where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
       and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '142356783')))$$,
  'P0001', 'Solo se puede pagar un finiquito emitido',
  'un finiquito pagado no se vuelve a pagar'
);

-- ===== anular_finiquito (Ana): motivo, otro-contrato-vigente y reactivación =====

-- 19) Motivo vacío: rechazo byte-exacto.
select throws_ok(
  $$select anular_finiquito('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from finiquitos
     where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
       and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '142356783')), '')$$,
  'P0001', 'Indica el motivo de la anulación',
  'anular sin motivo es rechazado'
);

-- SETUP: Ana RECONTRATA a Gabriel (contrato nuevo vigente, escritura directa
-- dueno/admin) — anular ya no puede reactivar el contrato viejo.
insert into public.contratos (empresa_id, trabajador_id, tipo, fecha_inicio, cargo, sueldo_base, afp, salud)
values
  ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
   (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '142356783'),
   'indefinido', date '2026-08-01', 'Chofer recontratado', 900000, 'habitat', 'fonasa');

-- 20) Con OTRO contrato vigente entremedio, anular es rechazado (la
--     reactivación chocaría con el unique parcial de contratos vigentes).
select throws_ok(
  $$select anular_finiquito('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from finiquitos
     where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
       and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '142356783')),
    'Error en la causal')$$,
  'P0001', 'El trabajador ya tiene otro contrato vigente',
  'anular con otro contrato vigente entremedio es rechazado'
);

-- SETUP (superuser: deshace la recontratación; no hay DELETE de contratos
-- para authenticated) y Ana anula con motivo — ahora sí procede.
reset role;
delete from public.contratos
 where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
   and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '142356783')
   and fecha_inicio = date '2026-08-01';
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select anular_finiquito('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from finiquitos
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '142356783')),
  'Error en la causal');

-- 21) Quedó anulado (desde PAGADO: spec §3, emitido o pagado se anulan) con
--     motivo y anulado_en.
select is(
  (select estado || '/' || motivo_anulacion || '/' || (anulado_en is not null)::text
   from finiquitos
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '142356783')),
  'anulado/Error en la causal/true',
  'anular deja el finiquito anulado con motivo y anulado_en'
);

-- 22) Anular REACTIVA: el contrato del finiquito vuelve a vigente=true y
--     Gabriel a activo=true.
select is(
  (select c.vigente::text || '/' || t.activo::text
   from finiquitos f
   join contratos c on c.empresa_id = f.empresa_id and c.id = f.contrato_id
   join trabajadores t on t.empresa_id = f.empresa_id and t.id = f.trabajador_id
   where f.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and f.trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '142356783')),
  'true/true',
  'anular reactiva el contrato y al trabajador'
);

-- 23) Re-anular el YA anulado: el candado de estado se dispara (solo emitido
--     o pagado son anulables) — único camino al mensaje en toda la suite.
select throws_ok(
  $$select anular_finiquito('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from finiquitos
     where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
       and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '142356783')),
    'Segundo intento')$$,
  'P0001', 'Solo se puede anular un finiquito emitido o pagado',
  'un finiquito ya anulado no se vuelve a anular'
);

-- 24) Re-emitir tras anular: el unique parcial ignora anulados → conviven. La
--     re-emisión usa la causal vencimiento_plazo — el MISMO setup alimenta el
--     golden VP del assert 25 (dos pájaros de un tiro).
select emitir_finiquito('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '142356783'),
  'vencimiento_plazo', date '2026-07-31', false, 0, 0, null);
select is(
  (select string_agg(estado, ',' order by estado)
   from finiquitos
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '142356783')),
  'anulado,emitido',
  'tras anular se puede volver a emitir el finiquito del mismo contrato'
);

-- 25) GOLDEN VP (vencimiento_plazo, mismos insumos de GF1: 800000, 2023-01-15
--     → 2026-07-31, 10 tomados — tabla de Global Constraints y espejo del unit
--     de T4): CERO indemnizaciones (ni años ni aviso), solo el feriado —
--     42.50 días → 1133333 = total. El snapshot igual guarda los 4 años.
select is(
  (select causal || '/' || anos_servicio || '/' || indemnizacion_anos
     || '/' || indemnizacion_aviso || '/' || feriado_dias || '/' || feriado_monto || '/' || total
   from finiquitos
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and estado = 'emitido'
     and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '142356783')),
  'vencimiento_plazo/4/0/0/42.50/1133333/1133333',
  'GOLDEN VP: vencimiento_plazo no paga indemnizaciones — solo el feriado proporcional'
);

-- ===== RLS por rol =====

-- 26) El CONTADOR (Ces) lee finiquitos y vacaciones (SELECT dueno/admin/contador):
--     5 finiquitos (Gabriel ×2 — anulado + vencimiento_plazo —, Gloria, Germán,
--     Nicolás) y 3 tomas vivas.
set local request.jwt.claims to '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated"}';
select is(
  (select count(*) from finiquitos)::text || '/' || (select count(*) from vacaciones_tomadas)::text,
  '5/3',
  'el contador ve finiquitos y vacaciones tomadas'
);

-- 27) El VENDEDOR (Vero) ve 0 filas en ambas tablas (dato sensible).
set local request.jwt.claims to '{"sub": "77777777-7777-7777-7777-777777777777", "role": "authenticated"}';
select is(
  (select count(*) from finiquitos) + (select count(*) from vacaciones_tomadas),
  0::bigint,
  'el vendedor no ve finiquitos ni vacaciones (select restringido por rol)'
);

-- 28) El vendedor tampoco inserta vacaciones (INSERT solo dueno/admin).
select throws_ok(
  $$insert into vacaciones_tomadas (empresa_id, trabajador_id, desde, hasta, dias_habiles)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', gen_random_uuid(), date '2026-05-04', date '2026-05-08', 5)$$,
  '42501', 'new row violates row-level security policy for table "vacaciones_tomadas"',
  'el vendedor no registra vacaciones (escritura solo dueno/admin)'
);

-- SETUP: el DELETE de Vero como sentencia SUELTA — un CTE modificador dentro
-- del subquery escalar de is() daría 0A000 y abortaría el archivo (dictamen
-- de los lentes). El grant de delete EXISTE: la policy filtra por rol y borra
-- 0 filas SIN error (precedente combustible.test.sql, delete de la vendedora).
delete from vacaciones_tomadas
where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa';

-- 29) Las 3 tomas siguen vivas — se cuenta con los claims de Ana (Vero vería
--     0 por RLS aunque existieran): el delete del vendedor afectó 0 filas.
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select is(
  (select count(*) from vacaciones_tomadas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'),
  3::bigint,
  'el delete del vendedor sobre vacaciones borra 0 filas: las 3 tomas siguen vivas'
);

-- 30) finiquitos: CERO escritura directa (solo RPCs) — el grant ES el candado,
--     ni el rol máximo pasa (los claims de Ana ya están activos).
select throws_ok(
  $$insert into finiquitos (empresa_id, trabajador_id, contrato_id, causal, fecha_termino)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', gen_random_uuid(), gen_random_uuid(), 'renuncia', date '2026-07-31')$$,
  '42501', 'permission denied for table finiquitos',
  'ni la dueña inserta finiquitos directamente (solo emitir_finiquito)'
);

-- ===== Asiento contable (service_role, el hook): regla 'finiquito' =====
set local role service_role;

-- SETUP (sin assert): contabilizar GF2 (Gloria, total 800000).
select contabilizar_documento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'finiquito',
  (select id from finiquitos
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '167890237')));

-- 31) GOLDEN líneas: 2 líneas por el TOTAL neto — debe gasto_indemnizaciones
--     800000, haber finiquitos_por_pagar 800000. Cuadra por construcción.
select is(
  (select string_agg(c.clave_sistema || ':' || l.debe || ':' || l.haber, '|' order by c.clave_sistema)
   from asientos_lineas l
   join cuentas_contables c on c.empresa_id = l.empresa_id and c.id = l.cuenta_id
   where l.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and l.asiento_id = (select id from asientos
                         where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and origen = 'finiquito'
                           and referencia_id = (select id from finiquitos
                                                where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
                                                  and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '167890237')))),
  'finiquitos_por_pagar:0:800000|gasto_indemnizaciones:800000:0',
  'el asiento del finiquito lleva 2 líneas por el total y cuadra'
);

-- 32) La fecha es la de término (vía app._fecha_contable; sin cierres: intacta)
--     y el origen nuevo del CHECK.
select is(
  (select a.fecha::text || '/' || a.origen
   from asientos a
   where a.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and a.origen = 'finiquito'
     and a.referencia_id = (select id from finiquitos
                            where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
                              and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '167890237'))),
  '2026-07-31/finiquito',
  'el asiento va a la fecha de término con origen finiquito'
);

-- 33) Total 0 (Nicolás) → noop, sin asiento (jamás un asiento vacío).
select is(
  contabilizar_documento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'finiquito',
    (select id from finiquitos
     where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
       and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '159876543')))
  || '/' ||
  (select count(*) from asientos
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and origen = 'finiquito'
     and referencia_id = (select id from finiquitos
                          where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
                            and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '159876543')))::text,
  'noop/0',
  'un finiquito con total 0 no genera asiento (noop)'
);

-- 34) Finiquito ANULADO (el primero de Gabriel) → noop, sin asiento (patrón P16).
select is(
  contabilizar_documento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'finiquito',
    (select id from finiquitos
     where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
       and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '142356783')
       and estado = 'anulado'))
  || '/' ||
  (select count(*) from asientos
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and origen = 'finiquito'
     and referencia_id = (select id from finiquitos
                          where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
                            and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '142356783')
                            and estado = 'anulado'))::text,
  'noop/0',
  'un finiquito anulado no genera asiento (noop)'
);

-- ===== Backfill de apellidos de la 0027 (portado del smoke de T1: la única
-- verificación PERMANENTE — el smoke no se comitea) =====
-- Se re-ejecuta el UPDATE EXACTO de la migración sobre 2 filas legacy (3 y 2
-- palabras) con el not null suspendido DENTRO de la transacción (rollback al
-- final). El set not null de vuelta prueba además que el backfill dejó cero
-- nulls. Sobre las filas ya pobladas el UPDATE es idempotente (la partición
-- de la heurística coincide con lo escrito a mano en los fixtures). RUTs
-- módulo 11 válidos del smoke (cuerpo 11111111 DV 1 / cuerpo 22222222 DV 2)
-- que viven SOLO dentro de esta transacción.
reset role;
alter table public.trabajadores
  alter column nombres drop not null,
  alter column apellido_paterno drop not null;
insert into public.trabajadores (id, empresa_id, rut, nombre) values
  ('10000000-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '111111111', 'Pedro Soto Rivas'),
  ('10000000-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '222222222', 'Ana Vergara');
update public.trabajadores t
set nombres = case when array_length(p.partes, 1) >= 3
                   then array_to_string(p.partes[1:array_length(p.partes, 1) - 2], ' ')
                   else p.partes[1] end,
    apellido_paterno = case when array_length(p.partes, 1) >= 3 then p.partes[array_length(p.partes, 1) - 1]
                            when array_length(p.partes, 1) = 2 then p.partes[2]
                            else '' end,
    apellido_materno = case when array_length(p.partes, 1) >= 3 then p.partes[array_length(p.partes, 1)]
                            else null end
from (select id, regexp_split_to_array(trim(nombre), '\s+') as partes from public.trabajadores) p
where p.id = t.id;
alter table public.trabajadores
  alter column nombres set not null,
  alter column apellido_paterno set not null;

-- 35) Partición de 3 palabras: 1 nombre + las últimas 2 como apellidos.
select is(
  (select nombres || '/' || apellido_paterno || '/' || apellido_materno
   from trabajadores
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '111111111'),
  'Pedro/Soto/Rivas',
  'backfill 0027: con 3 palabras las últimas 2 son los apellidos'
);

-- 36) Partición de 2 palabras: 1 nombre + 1 paterno, materno null.
select is(
  (select nombres || '/' || apellido_paterno || '/' || coalesce(apellido_materno, '(null)')
   from trabajadores
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '222222222'),
  'Ana/Vergara/(null)',
  'backfill 0027: con 2 palabras el materno queda null'
);

-- Limpieza de las filas legacy (el rollback final igual lo deshace todo).
delete from public.trabajadores
where id in ('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002');

select * from finish();
rollback;
```

- [ ] **Step 2: verificar que los RUTs nuevos siguen sin colisión**

```
rg -n "769910018|142356783|167890237|134567899|201234565|159876543|213456784" --glob "!supabase/tests/database/finiquitos.test.sql" --glob "!.superpowers/**" --glob "!docs/superpowers/**"
```

Salida esperada: **sin resultados** (exit code 1) — los 7 RUTs solo viven en el archivo nuevo (y en los documentos del plan).

- [ ] **Step 3: correr la suite pgTAP completa**

```
npx supabase test db
```

Salida esperada (fragmento):

```
finiquitos.test.sql ........... ok
...
All tests successful.
Files=20, Tests=435
Result: PASS
```

Los 19 archivos existentes suman 399 asserts y siguen verdes; `finiquitos.test.sql` agrega `plan(36)` → **435 asserts en 20 archivos**.

- [ ] **Step 4: commit**

```
git add supabase/tests/database/finiquitos.test.sql
git commit -m "test(db): pgTAP de finiquitos — goldens GF1-GF3, ciclo emitir/pagar/anular y asiento de 2 líneas" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Salida esperada: `1 file changed` con el archivo nuevo en `supabase/tests/database/`.

---
### Task 4: Espejo TS de finiquitos y vacaciones + catálogo ISAPRES + Previred v2 con apellidos reales

Crea el espejo TS del cálculo de finiquitos y vacaciones (spec §2.4 y §3) en `packages/core/src/finiquitos.ts` (la autoridad es la RPC `emitir_finiquito` de la 0027 — Tasks 1-2; goldens GF1-GF3 compartidos byte a byte con pgTAP), agrega el catálogo `ISAPRES` (spec §2.2, patrón AFPS) y `nombreCompleto` (spec §2.1), sube `generarPrevired` a v2 (spec §5 enmendado: apellidos desde columnas propias en los campos 3-5 + código de institución de salud en el 75) eliminando `separarNombre` (queda sin consumidores — verificado: solo `previred.ts` y su test la usan), y refleja en `packages/db/src/types.ts` las columnas y RPCs de la 0027. Todo unit; sin BD.

**ADVERTENCIA de orden (costura declarada con T5, patrón P19 T3→T4):** dos cambios de esta task ROMPEN el typecheck de `apps/erp` hasta que T5 ajuste los consumidores — en esta task NO se corre `pnpm build` ni `pnpm --filter erp build`; la verificación es SOLO vitest + `npx tsc --noEmit` de los paquetes db/core (vitest no typechequea las apps).

1. `apps/erp/app/libro-remuneraciones/previred/route.ts` construye `FilaPrevired` con `nombre` (campo que desaparece). T5 lo cierra (join nuevo + campos nuevos + `isapre_codigo`).
2. `apps/erp/app/trabajadores/acciones.ts` inserta/actualiza trabajadores sin `nombres`/`apellido_paterno` (requeridos en `Insert` tras la 0027). T5 migra el formulario a los 3 campos y compone `nombre` con `nombreCompleto`.
3. `scripts/seed-demo.mjs` no typechequea, pero su insert de trabajadores FALLARÁ en runtime tras la 0027 (NOT NULL): **T7** agrega los 3 campos (la migración del seed ES de T7).

**Cruce con la Task 2 (REGLA CANÓNICA, corregida por el ensamblador):** la RPC usa `age(p_fecha_termino, v_inicio)` — el espejo TS replica `age()` EXACTAMENTE (bug-for-bug), con la semántica de Global Constraints: resta campo a campo y préstamo de días del MES DE LA FECHA DE INICIO cuando `d < 0` (préstamo de 12 al año cuando `m < 0`). De la tripleta `(y, m, d)`: `meses_completos = y×12 + m`; fracción `m > 6 OR (m === 6 && d > 0)` suma el año (tope 11). El borrador previo de esta task (resta calendario + castigo por día, fracción solo en meses enteros) queda DESCARTADO: divergía de la RPC en GF1 (daba 3 años / 4333333 en vez de 4 / 5133333) y en los bordes de fin de mes.

**Files**

- `packages/core/src/finiquitos.ts` — **crear**: `diasDelMes`/`edadLaboral` (privadas), `nombreCompleto`, `calcularVacaciones`, `calcularFiniquito` + tipos.
- `packages/core/src/finiquitos.test.ts` — **crear**: 16 tests (goldens GF1-GF3 + bordes + guards byte-exactos).
- `packages/core/src/remuneraciones.ts` — modificar: catálogo `ISAPRES` a continuación de `AFPS`.
- `packages/core/src/previred.ts` — modificar: `FilaPrevired` v2, `separarNombre` ELIMINADA, campos 3/4/5 y 75 desde columnas.
- `packages/core/src/previred.test.ts` — modificar: reescritura completa (tests de `separarNombre` eliminados; línea dorada v2; 7 tests).
- `packages/core/src/index.ts` — modificar: `export * from './finiquitos'`.
- `packages/db/src/types.ts` — modificar: espejo del codegen de la 0027 (`trabajadores`, `contratos`, tablas `finiquitos` y `vacaciones_tomadas`, Functions `emitir/pagar/anular_finiquito`).

**Interfaces**

Firmas nuevas de `finiquitos.ts` — EXACTAS (T5/T6 consumen ESTOS tipos; la RPC guarda las MISMAS columnas del snapshot):

```ts
export function nombreCompleto(nombres: string, paterno: string, materno: string | null): string
// Espejo byte a byte del SQL del backfill/action (spec §2.1):
// trim(nombres || ' ' || apellido_paterno || ' ' || coalesce(materno, ''))

export interface ResultadoVacaciones {
  devengados: number // meses_completos × 1,25 — siempre cuartos exactos (numeric(6,2))
  tomados: number
  saldo: number // devengados − tomados; PUEDE ser negativo (la UI lo pinta rojo)
}

export function calcularVacaciones(
  fechaInicio: string, // 'AAAA-MM-DD' del PRIMER contrato del trabajador (continuidad laboral)
  hasta: string, // hoy (UI), o fecha_termino del finiquito no-anulado (T6)
  diasTomados: number, // Σ dias_habiles de vacaciones_tomadas
): ResultadoVacaciones

export interface EntradaFiniquito {
  causal: string // CHECK: renuncia | mutuo_acuerdo | necesidades_empresa | vencimiento_plazo | conducta_grave
  fecha_inicio: string // 'AAAA-MM-DD' del PRIMER contrato del trabajador
  fecha_termino: string // 'AAAA-MM-DD'
  aviso_dado: boolean // solo pesa en necesidades_empresa
  sueldo_base: number // del contrato vigente, integer CLP
  dias_tomados: number // Σ dias_habiles de vacaciones_tomadas
  otros_haberes: number // >= 0
  otros_descuentos: number // >= 0
  uf: number // integer CLP de indicadores_previsionales del período de fecha_termino
}

export interface ResultadoFiniquito {
  anos_servicio: number
  indemnizacion_anos: number
  indemnizacion_aviso: number
  feriado_dias: number // numeric(6,2) en la BD; acá cuartos exactos
  feriado_monto: number
  total: number
}
// NOTA para T6: ResultadoFiniquito NO expone la base topada — la vista previa
// que quiera mostrarla la recalcula con Math.min(sueldo_base, Math.round(90 * uf)).

export function calcularFiniquito(entrada: EntradaFiniquito): ResultadoFiniquito
// Lanza Error('El total del finiquito no puede ser negativo: revisa los descuentos')
// si total < 0, y Error('La fecha de término no puede ser anterior al inicio del
// primer contrato') si fecha_termino < fecha_inicio — mensajes byte-exactos con
// la RPC (Global Constraints).
```

Catálogo `ISAPRES` — EXACTO (spec §2.2; vive en `remuneraciones.ts` junto a `AFPS`, mismo patrón; `index.ts` ya lo re-exporta vía `./remuneraciones`); `FilaPrevired` v2 — EXACTA (ver Paso 4; `nombre` y `separarNombre` desaparecen; `apellido_materno: string | null`).

**Goldens GF1-GF3 (tabla de Global Constraints — los MISMOS valores que fijan los asserts pgTAP de `finiquitos.test.sql`).** Bordes adicionales fijados por tests: fracción de 6 meses EXACTOS no suma (GF1 con término 2026-07-15 → age 3a6m0d → 3 años); saldo negativo → feriado 0 (GF2 con 25 tomados → saldo −5); total negativo lanza (GF2 con otros_descuentos 900.000 → −100.000); vencimiento_plazo → cero indemnizaciones (golden VP, espejo del assert pgTAP); fecha de término anterior al primer contrato lanza el guard byte-exacto (GF1 con término 2022-12-31).

- [ ] **Paso 1 — RED: crear `packages/core/src/finiquitos.test.ts`**

Contenido COMPLETO del archivo nuevo (sin BOM — todos los archivos de esta task se escriben en UTF-8 sin BOM):

```ts
import { describe, expect, it } from 'vitest'
import {
  calcularFiniquito,
  calcularVacaciones,
  nombreCompleto,
  type EntradaFiniquito,
} from './finiquitos'

// UF canónica del período 2026-07 — el MISMO valor que siembra la migración
// 0025 y que fijan los asserts pgTAP de emitir_finiquito (finiquitos.test.sql).
// Goldens GF1-GF3 compartidos byte a byte entre SQL y TS: divergencia = bug
// (spec P20 §2.4 y §3). Tope 90 UF = round(90 × 39.350) = 3.541.500.
const UF = 39350

// Entradas de los 3 goldens (las mismas de los asserts pgTAP).
const GF1: EntradaFiniquito = {
  causal: 'necesidades_empresa',
  fecha_inicio: '2023-01-15',
  fecha_termino: '2026-07-31',
  aviso_dado: false,
  sueldo_base: 800000,
  dias_tomados: 10,
  otros_haberes: 0,
  otros_descuentos: 0,
  uf: UF,
}
const GF2: EntradaFiniquito = {
  causal: 'renuncia',
  fecha_inicio: '2025-03-01',
  fecha_termino: '2026-07-31',
  aviso_dado: false,
  sueldo_base: 1200000,
  dias_tomados: 0,
  otros_haberes: 0,
  otros_descuentos: 0,
  uf: UF,
}
const GF3: EntradaFiniquito = {
  causal: 'necesidades_empresa',
  fecha_inicio: '2012-05-01',
  fecha_termino: '2026-07-31',
  aviso_dado: true,
  sueldo_base: 4000000,
  dias_tomados: 200,
  otros_haberes: 0,
  otros_descuentos: 0,
  uf: UF,
}

describe('nombreCompleto — composición del display (spec §2.1)', () => {
  it('compone nombres + paterno + materno con un espacio', () => {
    expect(nombreCompleto('María José', 'Pérez', 'Soto')).toBe('María José Pérez Soto')
  })

  it('materno null: sin espacio colgante (espejo del trim SQL)', () => {
    expect(nombreCompleto('Ana', 'Díaz', null)).toBe('Ana Díaz')
  })
})

describe('calcularVacaciones — devengo 1,25 días/mes (spec §2.4)', () => {
  it('GF1: age 3a6m16d → 42 meses completos → 52,5 devengados, 10 tomados, saldo 42,5', () => {
    expect(calcularVacaciones('2023-01-15', '2026-07-31', 10)).toEqual({
      devengados: 52.5, // 42 × 1,25
      tomados: 10,
      saldo: 42.5,
    })
  })

  it('GF2: age 1a4m30d → 16 meses completos → 20 devengados sin tomas', () => {
    expect(calcularVacaciones('2025-03-01', '2026-07-31', 0)).toEqual({
      devengados: 20, // 16 × 1,25
      tomados: 0,
      saldo: 20,
    })
  })

  it('GF3: age 14a2m30d → 170 meses completos → 212,5 devengados, 200 tomados, saldo 12,5', () => {
    expect(calcularVacaciones('2012-05-01', '2026-07-31', 200)).toEqual({
      devengados: 212.5,
      tomados: 200,
      saldo: 12.5,
    })
  })

  it('el saldo puede ser negativo (la UI lo pinta rojo; el finiquito lo trunca)', () => {
    expect(calcularVacaciones('2025-03-01', '2026-07-31', 25)).toEqual({
      devengados: 20,
      tomados: 25,
      saldo: -5,
    })
  })

  it('mes completo EXACTO: se cumple recién al llegar al mismo día del mes', () => {
    // Semántica age(): el día negativo presta los días del mes de INICIO —
    // del 15-ene al 14-feb hay 0 meses completos; al 15-feb, 1 exacto.
    expect(calcularVacaciones('2023-01-15', '2023-02-14', 0).devengados).toBe(0)
    expect(calcularVacaciones('2023-01-15', '2023-02-15', 0).devengados).toBe(1.25)
    expect(calcularVacaciones('2023-01-15', '2023-01-15', 0).devengados).toBe(0)
  })
})

describe('calcularFiniquito — goldens compartidos con pgTAP (spec §3)', () => {
  it('GF1: necesidades_empresa sin aviso, 800.000, 2023-01-15 → 2026-07-31, 10 tomados', () => {
    expect(calcularFiniquito(GF1)).toEqual({
      anos_servicio: 4, // age = 3a 6m 16d: la fracción de 6 meses Y días SUMA (m=6, d>0)
      indemnizacion_anos: 3200000, // 800.000 × 4 (bajo el tope de 90 UF)
      indemnizacion_aviso: 800000, // sin aviso → un mes de base
      feriado_dias: 42.5, // 52,5 devengados − 10 tomados
      feriado_monto: 1133333, // round(800.000 × 42,5 / 30) = round(1.133.333,33) — multiplicar ANTES de dividir
      total: 5133333, // 3.200.000 + 800.000 + 1.133.333
    })
  })

  it('GF2: renuncia 1.200.000, 2025-03-01 → 2026-07-31: solo feriado', () => {
    expect(calcularFiniquito(GF2)).toEqual({
      anos_servicio: 1, // age = 1a 4m 30d (el snapshot igual lo guarda)
      indemnizacion_anos: 0, // renuncia: sin indemnización por años
      indemnizacion_aviso: 0, // ni aviso, aunque aviso_dado sea false
      feriado_dias: 20,
      feriado_monto: 800000, // round(1.200.000 × 20 / 30) = 800.000 exacto
      total: 800000,
    })
  })

  it('GF3: tope 11 años + tope 90 UF; el feriado usa el sueldo SIN tope', () => {
    expect(calcularFiniquito(GF3)).toEqual({
      anos_servicio: 11, // age = 14a 2m 30d → 14 → tope legal 11
      indemnizacion_anos: 38956500, // min(4.000.000, 3.541.500) × 11
      indemnizacion_aviso: 0, // aviso dado
      feriado_dias: 12.5, // 212,5 − 200
      feriado_monto: 1666667, // round(4.000.000 × 12,5 / 30) — sueldo_base, no la base topada
      total: 40623167, // 38.956.500 + 1.666.667
    })
  })

  it('fracción de 6 meses EXACTOS no suma el año; con días encima sí (GF1)', () => {
    const r = calcularFiniquito({ ...GF1, fecha_termino: '2026-07-15' }) // age = 3a 6m 0d
    expect(r.anos_servicio).toBe(3) // m=6 y d=0: la fracción NO supera los 6 meses
    expect(r.indemnizacion_anos).toBe(2400000) // 800.000 × 3
  })

  it('saldo de vacaciones negativo: feriado 0, jamás resta', () => {
    expect(calcularFiniquito({ ...GF2, dias_tomados: 25 })).toEqual({
      anos_servicio: 1,
      indemnizacion_anos: 0,
      indemnizacion_aviso: 0,
      feriado_dias: 0, // max(−5, 0)
      feriado_monto: 0,
      total: 0,
    })
  })

  it('vencimiento_plazo sin aviso: cero indemnizaciones, solo feriado', () => {
    const r = calcularFiniquito({ ...GF1, causal: 'vencimiento_plazo' })
    expect(r.indemnizacion_anos).toBe(0)
    expect(r.indemnizacion_aviso).toBe(0)
    expect(r.total).toBe(1133333) // solo el feriado de GF1
  })

  it('otros haberes y descuentos entran al total tal cual', () => {
    const r = calcularFiniquito({ ...GF2, otros_haberes: 100000, otros_descuentos: 50000 })
    expect(r.total).toBe(850000) // 800.000 + 100.000 − 50.000
  })

  it('total negativo lanza el guard byte-exacto de la RPC', () => {
    expect(() => calcularFiniquito({ ...GF2, otros_descuentos: 900000 })).toThrow(
      'El total del finiquito no puede ser negativo: revisa los descuentos',
    )
  })

  it('fecha de término anterior al primer contrato lanza el guard byte-exacto de la RPC', () => {
    expect(() => calcularFiniquito({ ...GF1, fecha_termino: '2022-12-31' })).toThrow(
      'La fecha de término no puede ser anterior al inicio del primer contrato',
    )
  })
})
```

Correr y confirmar el RED:

```
pnpm --filter @suite/core test
```

Salida esperada: falla la compilación del archivo nuevo con `Cannot find module './finiquitos'` (o equivalente de vitest). Los demás archivos siguen verdes.

- [ ] **Paso 2 — GREEN: crear `packages/core/src/finiquitos.ts` + export**

Contenido COMPLETO del archivo nuevo:

```ts
// Espejo TS del cálculo chileno de finiquitos y vacaciones (spec Plan 20 §2.4
// y §3). La autoridad es la RPC emitir_finiquito (plpgsql, migración 0027):
// este espejo existe SOLO para la vista previa en vivo del formulario de
// finiquito y la sección Vacaciones de la ficha. Ambos lados se prueban con
// los mismos goldens GF1-GF3 (unit acá, pgTAP allá): divergencia = bug.
//
// Redondeo: mismo contrato que remuneraciones.ts — Math.round es espejo fiel
// de round() de plpgsql porque todo lo que se redondea acá es >= 0
// (feriado_dias ya pasó por max(saldo, 0)) y porque se multiplica ANTES de
// dividir (paridad con numeric: dividir primero redondea dos veces en float).

// Días del mes m (1-12) del año y — vía Date.UTC(y, m, 0) = último día del
// mes m. Cubre bisiestos igual que el day_tab de Postgres.
function diasDelMes(anio: number, mes: number): number {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate()
}

// Réplica EXACTA de age(t, i) de Postgres para t >= i (Global Constraints del
// plan): resta campo a campo y normaliza — un día negativo presta los días
// del MES DE LA FECHA DE INICIO (day_tab del segundo argumento en
// timestamp_age); un mes negativo presta 12 del año. NO es la aritmética de
// '+ 1 month': age('2023-02-28','2023-01-31') = 28 días = 0 meses. Un solo
// préstamo basta porque día(inicio) <= días del mes de inicio. Fechas
// invertidas (hasta < desde) quedan fuera de contrato: calcularFiniquito las
// rechaza con el guard byte-exacto de la RPC; calcularVacaciones asume
// hasta >= desde (la ficha pasa hoy o el corte del finiquito).
function edadLaboral(desde: string, hasta: string): { y: number; m: number; d: number } {
  const [ay, am, ad] = desde.split('-').map(Number) as [number, number, number]
  const [by, bm, bd] = hasta.split('-').map(Number) as [number, number, number]
  let y = by - ay
  let m = bm - am
  let d = bd - ad
  if (d < 0) {
    d += diasDelMes(ay, am)
    m -= 1
  }
  if (m < 0) {
    m += 12
    y -= 1
  }
  return { y, m, d }
}

// Única vía de escritura de trabajadores.nombre (spec §2.1): la Server Action
// compone el display desde los 3 campos capturados. Espejo byte a byte de la
// expresión SQL del backfill de la 0027:
// trim(nombres || ' ' || apellido_paterno || ' ' || coalesce(materno, '')).
export function nombreCompleto(nombres: string, paterno: string, materno: string | null): string {
  return (nombres + ' ' + paterno + ' ' + (materno ?? '')).trim()
}

// Devengo y saldo de vacaciones (spec §2.4): 1,25 días hábiles por mes
// completo (y×12 + m de la edad laboral) desde la fecha_inicio del PRIMER
// contrato (continuidad laboral). Sin redondeo: meses × 1,25 siempre cae en
// cuartos exactos (numeric(6,2) en la BD los guarda tal cual) y diasTomados
// es entero → saldo también exacto.
export interface ResultadoVacaciones {
  devengados: number
  tomados: number
  saldo: number // puede ser negativo: la UI lo muestra en rojo (spec §2.4)
}

export function calcularVacaciones(
  fechaInicio: string,
  hasta: string,
  diasTomados: number,
): ResultadoVacaciones {
  const { y, m } = edadLaboral(fechaInicio, hasta)
  const devengados = (y * 12 + m) * 1.25
  return { devengados, tomados: diasTomados, saldo: devengados - diasTomados }
}

// Entrada del espejo: todo sale de BD + formulario. fecha_inicio es la del
// PRIMER contrato del trabajador; uf es el entero de indicadores_previsionales
// del período de fecha_termino (la RPC valida que exista con su propio
// mensaje; la UI no llama al espejo sin indicadores).
export interface EntradaFiniquito {
  causal: string // CHECK de finiquitos: renuncia | mutuo_acuerdo | necesidades_empresa | vencimiento_plazo | conducta_grave
  fecha_inicio: string // 'AAAA-MM-DD' del PRIMER contrato del trabajador
  fecha_termino: string // 'AAAA-MM-DD'
  aviso_dado: boolean // solo pesa en necesidades_empresa
  sueldo_base: number // del contrato vigente, integer CLP
  dias_tomados: number // Σ dias_habiles de vacaciones_tomadas del trabajador
  otros_haberes: number // >= 0
  otros_descuentos: number // >= 0
  uf: number // integer CLP del período de fecha_termino
}

// Snapshot del cálculo (spec §3): las MISMAS columnas que la RPC guarda en
// finiquitos (feriado_dias numeric(6,2); el resto integer CLP). La base
// topada NO se expone: quien la necesite (vista previa de T6) la recalcula
// con Math.min(sueldo_base, Math.round(90 * uf)).
export interface ResultadoFiniquito {
  anos_servicio: number
  indemnizacion_anos: number
  indemnizacion_aviso: number
  feriado_dias: number
  feriado_monto: number
  total: number
}

// Guard de fechas + pasos 1-6 del spec §3, en el MISMO orden y con los MISMOS
// redondeos que la RPC emitir_finiquito (multiplicar antes de dividir: la
// razón vive en el comentario del feriado). Simplificación v1 DECLARADA (visible en el documento
// imprimible): el feriado no convierte hábiles→corridos ni descuenta
// cotizaciones — el contador ajusta con asiento manual si lo necesita.
export function calcularFiniquito(entrada: EntradaFiniquito): ResultadoFiniquito {
  // 0. Guard de fechas byte-exacto con la RPC (Global Constraints): un typo de
  //    fecha produciría años negativos en el snapshot o aviso pagado sin
  //    devengo. Strings ISO comparan bien lexicográficamente.
  if (entrada.fecha_termino < entrada.fecha_inicio)
    throw new Error('La fecha de término no puede ser anterior al inicio del primer contrato')

  // 1. Años de servicio: fracción > 6 meses de la MISMA descomposición age()
  //    — m > 6, o m = 6 con días sobrantes — suma un año. Tope legal 11
  //    (art. 163 CdT). GF1 (3a 6m 16d) SUMA → 4.
  const { y, m, d } = edadLaboral(entrada.fecha_inicio, entrada.fecha_termino)
  const anosServicio = Math.min(y + (m > 6 || (m === 6 && d > 0) ? 1 : 0), 11)

  // 2. Base indemnizatoria topada a 90 UF del período de término.
  const base = Math.min(entrada.sueldo_base, Math.round(90 * entrada.uf))

  // 3-4. Indemnizaciones: solo necesidades_empresa (art. 161); el aviso
  //      omitido agrega un mes de base (art. 162).
  const indemnizacionAnos = entrada.causal === 'necesidades_empresa' ? base * anosServicio : 0
  const indemnizacionAviso =
    entrada.causal === 'necesidades_empresa' && !entrada.aviso_dado ? base : 0

  // 5. Feriado proporcional: saldo de vacaciones a fecha_termino, nunca
  //    negativo; se paga a sueldo_base/30 SIN tope de 90 UF (el tope es de la
  //    indemnización, no del feriado).
  const { saldo } = calcularVacaciones(
    entrada.fecha_inicio,
    entrada.fecha_termino,
    entrada.dias_tomados,
  )
  const feriadoDias = Math.max(saldo, 0)
  // Multiplicar ANTES de dividir: equivalente EXACTO del
  // round(sueldo::numeric × dias / 30) de la RPC. Dividir primero (sueldo/30
  // como float) redondea dos veces y diverge $1 en bordes .5 (ej. 122892 ×
  // 3,75 → 15361 vs 15362). Los goldens GF1-GF3/W5/Amanda no caen en el borde
  // (verificado): valen para ambas formas — el orden correcto se fija igual.
  const feriadoMonto = Math.round((entrada.sueldo_base * feriadoDias) / 30)

  // 6. Total con ajustes manuales. Guard byte-exacto con la RPC (Global
  //    Constraints): descuentos que superan los haberes dejarían un documento
  //    y un asiento negativos.
  const total =
    indemnizacionAnos +
    indemnizacionAviso +
    feriadoMonto +
    entrada.otros_haberes -
    entrada.otros_descuentos
  if (total < 0)
    throw new Error('El total del finiquito no puede ser negativo: revisa los descuentos')

  return {
    anos_servicio: anosServicio,
    indemnizacion_anos: indemnizacionAnos,
    indemnizacion_aviso: indemnizacionAviso,
    feriado_dias: feriadoDias,
    feriado_monto: feriadoMonto,
    total,
  }
}
```

En `packages/core/src/index.ts`, agregar al final (tras `export * from './previred'`):

```ts
export * from './finiquitos'
```

Correr:

```
pnpm --filter @suite/core test
```

Salida esperada: `finiquitos.test.ts` verde con 16 tests; el resto sin cambios (todavía 8 en `previred.test.ts`).

- [ ] **Paso 3 — RED: reescribir `packages/core/src/previred.test.ts` (v2)**

Reemplaza el contenido COMPLETO del archivo por (nota BOM: el assert construye el escape unicode `'\` + `uFEFF'`, JAMÁS el carácter literal):

```ts
import { describe, expect, it } from 'vitest'
import { CODIGO_AFP_PREVIRED, generarPrevired, type FilaPrevired } from './previred'
import { AFPS, ISAPRES } from './remuneraciones'

// Fila del golden G1 (aportes P19): imponible 1.000.000, indefinido, habitat,
// Fonasa, tasas canónicas 1,53 / 0,90. RUT de fixture (mod-11 válido, formato
// de BD: cuerpo+DV sin puntos ni guión). P20 §2.1: los apellidos ya vienen de
// columnas propias — la línea dorada queda BYTE-IDÉNTICA a la de P19: cambió
// la fuente de los campos 3/4/5, no el TXT.
const FILA_G1: FilaPrevired = {
  rut: '123456785',
  nombres: 'María José',
  apellido_paterno: 'Pérez',
  apellido_materno: 'Soto',
  periodo: '2026-06',
  dias_trabajados: 30,
  afp: 'habitat',
  salud: 'fonasa',
  isapre_codigo: null,
  total_imponible: 1000000,
  afp_monto: 112700,
  sis_monto: 15300,
  cesantia_monto: 6000,
  cesantia_empleador_monto: 24000,
  salud_monto: 70000,
  mutual_monto: 9000,
}

// Fila del golden G2: plazo fijo capital, Isapre Vida Tres (código Previred
// 12, del catálogo ISAPRES; monto pactado 196.000 = 5 UF); sin apellido
// materno (columna null en BD → campo 4 vacío).
const FILA_G2: FilaPrevired = {
  rut: '876543214',
  nombres: 'Ana',
  apellido_paterno: 'Díaz',
  apellido_materno: null,
  periodo: '2026-06',
  dias_trabajados: 30,
  afp: 'capital',
  salud: 'isapre',
  isapre_codigo: 12,
  total_imponible: 1409396,
  afp_monto: 161235,
  sis_monto: 21564,
  cesantia_monto: 0,
  cesantia_empleador_monto: 42282,
  salud_monto: 196000,
  mutual_monto: 12685,
}

describe('generarPrevired — TXT de carga masiva (specs P19 §5 + P20 §5)', () => {
  it('G1: línea dorada completa de 105 campos', () => {
    const linea = generarPrevired([FILA_G1]).split('\r\n')[0]!
    expect(linea.split(';')).toEqual([
      '12345678', // 1 RUT trabajador (sin DV)
      '5', // 2 DV
      'Pérez', // 3 apellido paterno (trabajadores.apellido_paterno, P20)
      'Soto', // 4 apellido materno (trabajadores.apellido_materno, P20)
      'María José', // 5 nombres (trabajadores.nombres, P20)
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
      '', // 18 tramo asignación familiar (no gestionada)
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

  it('Isapre con catálogo: código Previred real y materno null → campo 4 vacío', () => {
    const campos = generarPrevired([FILA_G2]).split('\r\n')[0]!.split(';')
    expect(campos[2]).toBe('Díaz') // 3: apellido paterno
    expect(campos[3]).toBe('') // 4: apellido materno null en BD → vacío
    expect(campos[4]).toBe('Ana') // 5: nombres
    expect(campos[69]).toBe('0') // 70: cotización Fonasa vacía en Isapre
    expect(campos[74]).toBe('12') // 75: código Vida Tres del catálogo ISAPRES (P20)
    expect(campos[76]).toBe('1409396') // 77: renta imponible Isapre
    expect(campos[77]).toBe('1') // 78: moneda del plan en pesos (guardamos CLP)
    expect(campos[78]).toBe('196000') // 79: cotización pactada = salud_monto
    expect(campos[25]).toBe('33') // 26: AFP capital
    expect(campos[100]).toBe('0') // 101: cesantía del trabajador (plazo fijo no cotiza)
    expect(campos[101]).toBe('42282') // 102: cesantía del empleador al 3,0%
  })

  it('Isapre sin catálogo (contratos pre-P20): código 0 — límite v1 declarado', () => {
    const campos = generarPrevired([{ ...FILA_G2, isapre_codigo: null }])
      .split('\r\n')[0]!
      .split(';')
    expect(campos[74]).toBe('0') // 75: isapre sin slug en contratos.isapre
    expect(campos[78]).toBe('196000') // 79: el monto pactado igual viaja
  })

  it('catálogo ISAPRES: los 7 slugs del CHECK de contratos.isapre con su código', () => {
    expect(ISAPRES).toEqual([
      { valor: 'cruzblanca', etiqueta: 'Cruz Blanca', codigo_previred: 1 },
      { valor: 'banmedica', etiqueta: 'Banmédica', codigo_previred: 3 },
      { valor: 'colmena', etiqueta: 'Colmena Golden Cross', codigo_previred: 4 },
      { valor: 'consalud', etiqueta: 'Consalud', codigo_previred: 9 },
      { valor: 'vidatres', etiqueta: 'Vida Tres', codigo_previred: 12 },
      { valor: 'nuevamasvida', etiqueta: 'Nueva Masvida', codigo_previred: 43 },
      { valor: 'esencial', etiqueta: 'Esencial', codigo_previred: 44 },
    ])
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

Salida esperada: `previred.test.ts` falla en compilación (`ISAPRES` no existe en `./remuneraciones`; `FilaPrevired` no tiene `nombres`/`isapre_codigo`).

- [ ] **Paso 4 — GREEN: `ISAPRES` en `remuneraciones.ts` + reescribir `previred.ts` (v2)**

En `packages/core/src/remuneraciones.ts`, inmediatamente DESPUÉS del cierre `] as const` del catálogo `AFPS` (línea ~84) y ANTES del comentario `// Reglas 1-12 de los specs P18 §3 y P19 §3`, insertar:

```ts
// Catálogo compartido de Isapres (P20 §2.2, patrón AFPS): slugs EXACTOS del
// CHECK de contratos.isapre (0027) + nombre comercial + código Previred del
// campo 75 del TXT. Códigos v1 representativos (misma lógica que
// CODIGO_AFP_PREVIRED: se validan contra Previred al tener cuenta). Única
// fuente de la lista en las 3 apps.
export const ISAPRES = [
  { valor: 'cruzblanca', etiqueta: 'Cruz Blanca', codigo_previred: 1 },
  { valor: 'banmedica', etiqueta: 'Banmédica', codigo_previred: 3 },
  { valor: 'colmena', etiqueta: 'Colmena Golden Cross', codigo_previred: 4 },
  { valor: 'consalud', etiqueta: 'Consalud', codigo_previred: 9 },
  { valor: 'vidatres', etiqueta: 'Vida Tres', codigo_previred: 12 },
  { valor: 'nuevamasvida', etiqueta: 'Nueva Masvida', codigo_previred: 43 },
  { valor: 'esencial', etiqueta: 'Esencial', codigo_previred: 44 },
] as const
```

Reemplazar el contenido COMPLETO de `packages/core/src/previred.ts` por:

```ts
// Archivo PREVIRED (Plan 19 §5 + Plan 20 §5): TXT plano de carga masiva, 105
// campos por línea separados por ';', líneas terminadas en CRLF, SIN BOM (lo
// lee Previred, no Excel — a diferencia de filasACsv). Formato público
// "Archivo de carga masiva" de previred.com. v2 (P20): apellidos desde las
// columnas propias de trabajadores (la heurística separarNombre murió con
// ellas) y código de institución de salud desde el catálogo ISAPRES; el resto
// queda ''/0 según el estándar — el usuario puede ajustar el TXT antes de
// subirlo y la validación final la hace Previred al cargarlo.
import { limpiarRut } from './rut'

// Una liquidación no-anulada del período, ya unida a su trabajador/contrato.
// Los montos vienen del snapshot de liquidaciones (specs P18 §2.4 + P19 §2);
// nombres/apellidos, de las columnas de trabajadores (P20 §2.1); isapre_codigo
// lo resuelve la route con el catálogo ISAPRES desde contratos.isapre.
export interface FilaPrevired {
  rut: string // como en la BD: cuerpo+DV sin puntos ni guión ('123456785')
  nombres: string // trabajadores.nombres
  apellido_paterno: string // trabajadores.apellido_paterno
  apellido_materno: string | null // trabajadores.apellido_materno ('' en el TXT si null)
  periodo: string // 'AAAA-MM' de la liquidación
  dias_trabajados: number
  afp: string // slug del CHECK de contratos.afp
  salud: string // 'fonasa' | 'isapre'
  isapre_codigo: number | null // codigo_previred de ISAPRES; null = fonasa o isapre sin catálogo
  total_imponible: number
  afp_monto: number
  sis_monto: number
  cesantia_monto: number // aporte del trabajador (0 en plazo fijo)
  cesantia_empleador_monto: number
  salud_monto: number // 7% Fonasa o monto pactado Isapre, en CLP
  mutual_monto: number
}

// Tabla FIJA de códigos Previred por slug de AFP (spec P19 §5). Cambia solo
// si entra una AFP nueva al catálogo AFPS de remuneraciones.ts.
export const CODIGO_AFP_PREVIRED: Record<string, string> = {
  capital: '33',
  cuprum: '3',
  habitat: '14',
  modelo: '34',
  planvital: '29',
  provida: '8',
  uno: '35',
}

// Los 105 campos del formato público, 1-based en los comentarios. Poblados
// v2 (specs P19 §5 + P20 §5): RUT/DV, apellidos y nombres de columnas, días,
// AFP + montos, cesantía trabajador/empleador, salud (7 Fonasa / código del
// catálogo / 0 isapre sin catálogo), mutual. El resto queda '' (texto/fecha/
// código) o 0 (montos/contadores).
function lineaPrevired(f: FilaPrevired): string {
  const codigoAfp = CODIGO_AFP_PREVIRED[f.afp]
  if (codigoAfp === undefined) throw new Error(`AFP sin código Previred: ${f.afp}`)
  const rut = limpiarRut(f.rut)
  const mmaaaa = f.periodo.slice(5, 7) + f.periodo.slice(0, 4)
  const fonasa = f.salud === 'fonasa'
  const campos: (string | number)[] = [
    rut.slice(0, -1), // 1 RUT trabajador (sin DV)
    rut.slice(-1), // 2 DV
    f.apellido_paterno, // 3 apellido paterno (columna propia desde P20)
    f.apellido_materno ?? '', // 4 apellido materno ('' si null en BD)
    f.nombres, // 5 nombres
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
    '', // 18 tramo asignación familiar (no gestionada)
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
    fonasa ? '7' : String(f.isapre_codigo ?? 0), // 75 código institución de salud (7 Fonasa; catálogo ISAPRES; 0 isapre sin catálogo — límite v1)
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

Correr:

```
pnpm --filter @suite/core test
```

Salida esperada (GREEN, total core FIJADO):

```
 Test Files  15 passed (15)
      Tests  179 passed (179)
```

(164 previos − 8 de previred v1 + 7 de previred v2 + 16 de finiquitos = 179.)

- [ ] **Paso 5 — types.ts: espejo del codegen de la migración 0027**

Seis ediciones sobre `packages/db/src/types.ts` (anclas del archivo REAL verificadas en el Contexto del plan; orden alfabético del codegen respetado en todo; **`emitido_en` es NULLABLE sin default y `creado_en` existe con default — DDL de T1 manda**; firmas de RPCs = T2, 8 args sin defaults):

**(a) `trabajadores`** (bloque en línea ~2649). Tres pares Edit old/new con contexto ÚNICO — las anclas cortas (`activo: boolean`, `nombre: string`) se repiten en media docena de tablas; la línea `fecha_nacimiento` solo existe en `trabajadores` y desambigua (dictamen de los lentes, mismo estilo que T6 Step 2). Cada par inserta los apellidos Y `nombres` de una vez, en orden alfabético del codegen:

`Row` — old_string:
```ts
          activo: boolean
          creado_en: string
          direccion: string | null
          email: string | null
          empresa_id: string
          fecha_nacimiento: string | null
          id: string
          nombre: string
```
new_string:
```ts
          activo: boolean
          apellido_materno: string | null
          apellido_paterno: string
          creado_en: string
          direccion: string | null
          email: string | null
          empresa_id: string
          fecha_nacimiento: string | null
          id: string
          nombre: string
          nombres: string
```

`Insert` — old_string (única: `empresa_id: string` requerido — en `Update` es opcional):
```ts
          activo?: boolean
          creado_en?: string
          direccion?: string | null
          email?: string | null
          empresa_id: string
          fecha_nacimiento?: string | null
          id?: string
          nombre: string
```
new_string:
```ts
          activo?: boolean
          apellido_materno?: string | null
          apellido_paterno: string
          creado_en?: string
          direccion?: string | null
          email?: string | null
          empresa_id: string
          fecha_nacimiento?: string | null
          id?: string
          nombre: string
          nombres: string
```

`Update` — old_string:
```ts
          activo?: boolean
          creado_en?: string
          direccion?: string | null
          email?: string | null
          empresa_id?: string
          fecha_nacimiento?: string | null
          id?: string
          nombre?: string
```
new_string:
```ts
          activo?: boolean
          apellido_materno?: string | null
          apellido_paterno?: string
          creado_en?: string
          direccion?: string | null
          email?: string | null
          empresa_id?: string
          fecha_nacimiento?: string | null
          id?: string
          nombre?: string
          nombres?: string
```

(`nombres` y `apellido_paterno` quedan NOT NULL sin default tras el backfill de la 0027 → requeridos en `Insert`; esto es lo que rompe `apps/erp/app/trabajadores/acciones.ts` hasta T5 — costura declarada arriba.)

**(b) `contratos`** (bloque en línea ~522). Tres pares Edit con contexto único — `id: string` a secas se repite en muchas tablas; el vecino `plan_isapre_uf` aparece solo en `contratos` y `liquidaciones`, y en `liquidaciones` lo precede `periodo`, no `id` (verificado) — y `salud`/`salud?` separa `Insert` de `Update`:

`Row` — old_string:
```ts
          id: string
          plan_isapre_uf: number | null
```
new_string:
```ts
          id: string
          isapre: string | null
          plan_isapre_uf: number | null
```

`Insert` — old_string:
```ts
          id?: string
          plan_isapre_uf?: number | null
          salud: string
```
new_string:
```ts
          id?: string
          isapre?: string | null
          plan_isapre_uf?: number | null
          salud: string
```

`Update` — old_string:
```ts
          id?: string
          plan_isapre_uf?: number | null
          salud?: string
```
new_string:
```ts
          id?: string
          isapre?: string | null
          plan_isapre_uf?: number | null
          salud?: string
```

**(c) Tabla `finiquitos`** — insertar el bloque completo inmediatamente ANTES de la línea `      folios_caf: {` (línea ~1206, tras el cierre del bloque `empresas`):

```ts
      finiquitos: {
        Row: {
          anos_servicio: number
          anulado_en: string | null
          aviso_dado: boolean
          causal: string
          comentario: string | null
          contrato_id: string
          creado_en: string
          emitido_en: string | null
          empresa_id: string
          estado: string
          fecha_termino: string
          feriado_dias: number
          feriado_monto: number
          id: string
          indemnizacion_anos: number
          indemnizacion_aviso: number
          motivo_anulacion: string | null
          otros_descuentos: number
          otros_haberes: number
          pagado_en: string | null
          sueldo_base: number
          total: number
          trabajador_id: string
          uf: number
        }
        Insert: {
          anos_servicio: number
          anulado_en?: string | null
          aviso_dado?: boolean
          causal: string
          comentario?: string | null
          contrato_id: string
          creado_en?: string
          emitido_en?: string | null
          empresa_id: string
          estado?: string
          fecha_termino: string
          feriado_dias: number
          feriado_monto: number
          id?: string
          indemnizacion_anos: number
          indemnizacion_aviso: number
          motivo_anulacion?: string | null
          otros_descuentos?: number
          otros_haberes?: number
          pagado_en?: string | null
          sueldo_base: number
          total: number
          trabajador_id: string
          uf: number
        }
        Update: {
          anos_servicio?: number
          anulado_en?: string | null
          aviso_dado?: boolean
          causal?: string
          comentario?: string | null
          contrato_id?: string
          creado_en?: string
          emitido_en?: string | null
          empresa_id?: string
          estado?: string
          fecha_termino?: string
          feriado_dias?: number
          feriado_monto?: number
          id?: string
          indemnizacion_anos?: number
          indemnizacion_aviso?: number
          motivo_anulacion?: string | null
          otros_descuentos?: number
          otros_haberes?: number
          pagado_en?: string | null
          sueldo_base?: number
          total?: number
          trabajador_id?: string
          uf?: number
        }
        Relationships: [
          {
            foreignKeyName: "finiquitos_empresa_id_contrato_id_fkey"
            columns: ["empresa_id", "contrato_id"]
            isOneToOne: false
            referencedRelation: "contratos"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "finiquitos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finiquitos_empresa_id_trabajador_id_fkey"
            columns: ["empresa_id", "trabajador_id"]
            isOneToOne: false
            referencedRelation: "trabajadores"
            referencedColumns: ["empresa_id", "id"]
          },
        ]
      }
```

(`aviso_dado` tiene `default false` en el DDL → opcional en `Insert`, igual que `estado`/`otros_*`/`creado_en`.)

**(d) Tabla `vacaciones_tomadas`** — insertar el bloque completo inmediatamente ANTES de la línea `      vehiculos: {` (línea ~2696, tras el cierre del bloque `trabajadores`):

```ts
      vacaciones_tomadas: {
        Row: {
          comentario: string | null
          creado_en: string
          desde: string
          dias_habiles: number
          empresa_id: string
          hasta: string
          id: string
          trabajador_id: string
        }
        Insert: {
          comentario?: string | null
          creado_en?: string
          desde: string
          dias_habiles: number
          empresa_id: string
          hasta: string
          id?: string
          trabajador_id: string
        }
        Update: {
          comentario?: string | null
          creado_en?: string
          desde?: string
          dias_habiles?: number
          empresa_id?: string
          hasta?: string
          id?: string
          trabajador_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vacaciones_tomadas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vacaciones_tomadas_empresa_id_trabajador_id_fkey"
            columns: ["empresa_id", "trabajador_id"]
            isOneToOne: false
            referencedRelation: "trabajadores"
            referencedColumns: ["empresa_id", "id"]
          },
        ]
      }
```

**(e) Functions** — tres entradas nuevas en orden alfabético (Args en orden alfabético, estilo codegen; nombres y opcionalidad CONFIRMADOS contra la firma plpgsql de T2 — 8 args SIN defaults → todos requeridos):

Tras el cierre de la entrada `anular_estado_pago` (línea ~2976) y ANTES de `anular_liquidacion`:

```ts
      anular_finiquito: {
        Args: { p_empresa: string; p_finiquito: string; p_motivo: string }
        Returns: undefined
      }
```

Tras el cierre de la entrada `desactivar_contabilidad` (línea ~3133) y ANTES de `emitir_liquidacion`:

```ts
      emitir_finiquito: {
        Args: {
          p_aviso_dado: boolean
          p_causal: string
          p_comentario: string
          p_empresa: string
          p_fecha_termino: string
          p_otros_descuentos: number
          p_otros_haberes: number
          p_trabajador: string
        }
        Returns: string
      }
```

Tras el cierre de la entrada `guardar_cuenta` (línea ~3152) y ANTES de `pagar_liquidacion`:

```ts
      pagar_finiquito: {
        Args: { p_empresa: string; p_finiquito: string }
        Returns: undefined
      }
```

- [ ] **Paso 6 — Verificación completa de la task**

```
pnpm test
```

Salida esperada (total de la suite unit FIJADO en **229** = 214 previos − 8 de previred v1 + 7 de previred v2 + 16 de finiquitos; 28 archivos):

```
 Test Files  28 passed (28)
      Tests  229 passed (229)
```

```
npx tsc --noEmit -p packages/db/tsconfig.json
npx tsc --noEmit -p packages/core/tsconfig.json
```

Salida esperada: ninguna (exit 0) en ambos. NO correr `pnpm build` ni `pnpm --filter erp build` (costura abierta declarada arriba; la cierra T5).

Paso de bytes — ningún archivo tocado quedó con BOM (PowerShell):

```powershell
$archivos = 'packages\core\src\finiquitos.ts','packages\core\src\finiquitos.test.ts','packages\core\src\previred.ts','packages\core\src\previred.test.ts','packages\core\src\remuneraciones.ts','packages\core\src\index.ts','packages\db\src\types.ts'
foreach ($a in $archivos) { $b = [System.IO.File]::ReadAllBytes($a); if ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF) { "BOM: $a" } }
```

Salida esperada: ninguna (ninguna línea `BOM:`).

- [ ] **Paso 7 — Commit**

```powershell
git add packages/core/src/finiquitos.ts packages/core/src/finiquitos.test.ts packages/core/src/previred.ts packages/core/src/previred.test.ts packages/core/src/remuneraciones.ts packages/core/src/index.ts packages/db/src/types.ts
git commit -m "feat(core): espejo TS de finiquitos y vacaciones, catálogo ISAPRES y Previred v2 con apellidos reales" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---
### Task 5: Ficha con apellidos, vacaciones e Isapre del contrato + Previred con datos reales

> Depende de la Task 1 (migración 0027: columnas `nombres`/`apellido_paterno`/`apellido_materno` en
> `trabajadores` — not null tras el backfill, materno nullable —, `contratos.isapre`, tabla
> `vacaciones_tomadas` con su RLS) y de la Task 4 (core + `packages/db/src/types.ts` reflejados).
> **Esta task CIERRA la costura T4→T5 (Global Constraints): al terminar, `pnpm --filter erp build`
> vuelve a verde.**
>
> **Firmas REALES de T4 que esta task consume (confirmadas por el ensamblador):**
>
> ```ts
> // @suite/core (Task 4)
> export function nombreCompleto(nombres: string, paterno: string, materno: string | null): string
>
> export function calcularVacaciones(
>   fechaInicio: string, // 'AAAA-MM-DD' del PRIMER contrato del trabajador
>   hasta: string, // 'AAAA-MM-DD': hoy, o fecha_termino del finiquito (T6)
>   diasTomados: number,
> ): { devengados: number; tomados: number; saldo: number } // ResultadoVacaciones — saldo puede ser negativo
>
> export const ISAPRES: readonly { valor: string; etiqueta: string; codigo_previred: number }[]
>
> export interface FilaPrevired {
>   // v2: 'nombre' desaparece → campos 3-5 del TXT poblados directo (spec §5 enmendado)
>   rut: string
>   nombres: string
>   apellido_paterno: string
>   apellido_materno: string | null // null → campo 4 del TXT vacío
>   periodo: string
>   dias_trabajados: number
>   afp: string
>   salud: string
>   isapre_codigo: number | null // código del catálogo; el TXT emite 7 (fonasa) / 0 (isapre sin catálogo)
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

**Declarado (NO va en esta task):**

- El botón **"Emitir finiquito"** de la ficha y la ruta `/trabajadores/[id]/finiquito` los agrega la **Task 6**. Esta task no navega al finiquito.
- El devengo de la ficha corta en `hoy`: mientras no exista la UI de emisión (T6) no hay finiquitos que corten antes. La **Task 6**, al cargar el finiquito para su botón, cambia `hasta` a `fecha_termino` cuando haya finiquito no-anulado — costura declarada en el código (Paso 6) y CERRADA por T6 Step 7.
- La lista y TODO el resto del sistema siguen leyendo `trabajadores.nombre` (columna de display, spec §2.1): cero cambios fuera de los archivos listados.
- Orden "finiquitados al final" es **dentro de la página** (sort estable en JS sobre las 25 filas; la paginación SQL sigue por nombre) — límite v1 declarado en comentario. **La insignia y el sort de la lista se implementan AQUÍ; T6 no re-toca `trabajadores/page.tsx`** (Global Constraints).

**Files:**

- Modify: `apps/erp/componentes/formulario-trabajador.tsx` (3 campos de nombre)
- Modify: `apps/erp/app/trabajadores/catalogos.ts` (re-export `ISAPRES`, patrón AFPS)
- Modify: `apps/erp/componentes/formulario-contrato.tsx` (select de Isapre con salud='isapre')
- Create: `apps/erp/componentes/formulario-vacaciones.tsx` (registrar toma)
- Modify: `apps/erp/app/trabajadores/acciones.ts` (`guardarTrabajador` compone nombre; `guardarContrato` exige isapre; `registrarVacaciones` y `eliminarVacaciones` nuevas)
- Modify: `apps/erp/app/trabajadores/[id]/page.tsx` (inicial con 3 campos + sección Vacaciones)
- Modify: `apps/erp/app/trabajadores/page.tsx` (insignia "Finiquitado" + finiquitados al final)
- Modify: `apps/erp/app/libro-remuneraciones/previred/route.ts` (apellidos reales + código de Isapre)

**Interfaces:**

- Consumes de la Task 4 (bloque de firmas de arriba): `nombreCompleto`, `calcularVacaciones`, `ISAPRES`, `FilaPrevired` v2, `generarPrevired`.
- Consumes de la Task 1: columnas nuevas de `trabajadores` y `contratos.isapre` en los selects; tabla `vacaciones_tomadas` (INSERT/DELETE directo dueno/admin, SELECT + contador — precedente `gastos_vehiculo` P12).
- Consumes existentes (sin cambios): `obtenerEmpresaActiva`, `crearClienteServidor`, `EstadoForm`, `puedeVerRRHH`, `periodoAnterior`/`rangoDeMes`/`formatearRut`/`limpiarRut`/`validarRut` de `@suite/core`, y **`BotonEliminarCosto`** (`apps/erp/componentes/boton-eliminar-costo.tsx` — ya es genérico `id + accion`, se reusa tal cual para eliminar tomas con confirmación inline).
- Produces: formularios de trabajador con nombres/apellidos (action compone `nombre` — única vía de escritura), sección Vacaciones en la ficha, contrato nuevo con Isapre obligatoria fail-closed, lista con insignia "Finiquitado", TXT Previred con campos 3-5 y 75 reales.

- [ ] **Paso 1 — `formulario-trabajador.tsx`: nombres / apellido paterno / apellido materno**

Contenido completo final de `apps\erp\componentes\formulario-trabajador.tsx`:

```tsx
'use client'

import { useActionState } from 'react'
import { Boton, Campo, Entrada, Tarjeta } from '@suite/ui'
import type { EstadoForm } from '../app/tipos'

export interface TrabajadorEditable {
  id?: string
  rut: string
  nombres: string
  apellido_paterno: string
  apellido_materno: string
  email: string
  telefono: string
  direccion: string
  fecha_nacimiento: string
}

const VACIO: TrabajadorEditable = {
  rut: '',
  nombres: '',
  apellido_paterno: '',
  apellido_materno: '',
  email: '',
  telefono: '',
  direccion: '',
  fecha_nacimiento: '',
}

export function FormularioTrabajador({
  accion,
  inicial = VACIO,
}: {
  accion: (prev: EstadoForm, formData: FormData) => Promise<EstadoForm>
  inicial?: TrabajadorEditable
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoForm)
  return (
    <Tarjeta className="max-w-2xl">
      <form action={enviar} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {inicial.id && <input type="hidden" name="id" value={inicial.id} />}
        <Campo etiqueta="RUT *">
          <Entrada name="rut" defaultValue={inicial.rut} placeholder="12.345.678-5" required />
        </Campo>
        <Campo etiqueta="Nombres *">
          <Entrada name="nombres" defaultValue={inicial.nombres} required />
        </Campo>
        <Campo etiqueta="Apellido paterno *">
          <Entrada name="apellido_paterno" defaultValue={inicial.apellido_paterno} required />
        </Campo>
        <Campo etiqueta="Apellido materno">
          <Entrada name="apellido_materno" defaultValue={inicial.apellido_materno} />
        </Campo>
        <Campo etiqueta="Correo">
          <Entrada name="email" type="email" defaultValue={inicial.email} />
        </Campo>
        <Campo etiqueta="Teléfono">
          <Entrada name="telefono" defaultValue={inicial.telefono} />
        </Campo>
        <Campo etiqueta="Fecha de nacimiento">
          <Entrada name="fecha_nacimiento" type="date" defaultValue={inicial.fecha_nacimiento} />
        </Campo>
        <Campo etiqueta="Dirección">
          <Entrada name="direccion" defaultValue={inicial.direccion} />
        </Campo>
        <div className="flex items-center justify-end gap-2 sm:col-span-2">
          {estado.error && <span className="mr-auto text-sm text-red-600">{estado.error}</span>}
          <Boton type="submit" disabled={pendiente}>
            {pendiente ? 'Guardando…' : 'Guardar'}
          </Boton>
        </div>
      </form>
    </Tarjeta>
  )
}
```

`apps\erp\app\trabajadores\nuevo\page.tsx` NO cambia: usa `FormularioTrabajador` sin `inicial` (el `VACIO` nuevo ya trae los 3 campos).

- [ ] **Paso 2 — `catalogos.ts`: re-export de `ISAPRES`**

Contenido completo final de `apps\erp\app\trabajadores\catalogos.ts`:

```ts
// Catálogos UI de Personas (patrón origenes.ts de contabilidad). AFPS e ISAPRES
// vienen de @suite/core: ÚNICA fuente de ambas listas en las 3 apps — acá solo
// se re-exportan y se derivan las etiquetas. La tasa vigente de cada AFP NO
// vive acá: está en indicadores_previsionales.tasas_afp y la mantiene el
// admin de plataforma.
import { AFPS, ISAPRES } from '@suite/core'

export { AFPS, ISAPRES }

export const ETIQUETA_AFP: Record<string, string> = Object.fromEntries(
  AFPS.map((a) => [a.valor, a.etiqueta])
)

export const ETIQUETA_TIPO: Record<string, string> = {
  indefinido: 'Indefinido',
  plazo_fijo: 'Plazo fijo',
}
```

- [ ] **Paso 3 — `formulario-contrato.tsx`: select de Isapre solo con salud='isapre'**

Contenido completo final de `apps\erp\componentes\formulario-contrato.tsx`:

```tsx
'use client'

import { useActionState, useState } from 'react'
import { Boton, Campo, Entrada, Selector, Tarjeta } from '@suite/ui'
import type { EstadoForm } from '../app/tipos'
import { AFPS, ISAPRES } from '../app/trabajadores/catalogos'

export function FormularioContrato({
  accion,
  trabajadorId,
  contratoVigenteId,
}: {
  accion: (prev: EstadoForm, formData: FormData) => Promise<EstadoForm>
  trabajadorId: string
  contratoVigenteId?: string
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoForm)
  const [tipo, setTipo] = useState('indefinido')
  const [salud, setSalud] = useState('fonasa')
  return (
    <Tarjeta className="max-w-2xl">
      <form action={enviar} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <input type="hidden" name="trabajador_id" value={trabajadorId} />
        {contratoVigenteId && (
          <input type="hidden" name="contrato_vigente_id" value={contratoVigenteId} />
        )}
        <Campo etiqueta="Tipo de contrato *">
          <Selector name="tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="indefinido">Indefinido</option>
            <option value="plazo_fijo">Plazo fijo</option>
          </Selector>
        </Campo>
        <Campo etiqueta="Cargo *">
          <Entrada name="cargo" required />
        </Campo>
        <Campo etiqueta="Fecha de inicio *">
          <Entrada name="fecha_inicio" type="date" required />
        </Campo>
        {tipo === 'plazo_fijo' && (
          <Campo etiqueta="Fecha de término *">
            <Entrada name="fecha_termino" type="date" required />
          </Campo>
        )}
        <Campo etiqueta="Sueldo base (CLP) *">
          <Entrada name="sueldo_base" inputMode="numeric" placeholder="800000" required />
        </Campo>
        <Campo etiqueta="AFP *">
          <Selector name="afp">
            {AFPS.map((a) => (
              <option key={a.valor} value={a.valor}>
                {a.etiqueta}
              </option>
            ))}
          </Selector>
        </Campo>
        <fieldset>
          <legend className="mb-1 block text-sm font-medium text-slate-700">Salud *</legend>
          <div className="flex items-center gap-4 py-2 text-sm text-slate-700">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="salud"
                value="fonasa"
                checked={salud === 'fonasa'}
                onChange={() => setSalud('fonasa')}
              />
              Fonasa (7%)
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="salud"
                value="isapre"
                checked={salud === 'isapre'}
                onChange={() => setSalud('isapre')}
              />
              Isapre
            </label>
          </div>
        </fieldset>
        {salud === 'isapre' && (
          <>
            <Campo etiqueta="Isapre *">
              {/* Sin selección por defecto: la action igual valida contra el catálogo (fail-closed §2.2). */}
              <Selector name="isapre" defaultValue="" required>
                <option value="" disabled>
                  Selecciona una Isapre…
                </option>
                {ISAPRES.map((i) => (
                  <option key={i.valor} value={i.valor}>
                    {i.etiqueta}
                  </option>
                ))}
              </Selector>
            </Campo>
            <Campo etiqueta="Plan Isapre (UF) *">
              <Entrada name="plan_isapre_uf" inputMode="decimal" placeholder="3,5" required />
            </Campo>
          </>
        )}
        <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2">
          <input type="checkbox" name="gratificacion_legal" defaultChecked />
          Gratificación legal (25% mensual con tope de 4,75 IMM anual)
        </label>
        <div className="flex items-center justify-end gap-2 sm:col-span-2">
          {estado.error && <span className="mr-auto text-sm text-red-600">{estado.error}</span>}
          <Boton type="submit" disabled={pendiente}>
            {pendiente
              ? 'Guardando…'
              : contratoVigenteId
                ? 'Cerrar vigente y crear contrato'
                : 'Crear contrato'}
          </Boton>
        </div>
      </form>
    </Tarjeta>
  )
}
```

- [ ] **Paso 4 — `formulario-vacaciones.tsx` (crear): registrar una toma**

Contenido completo de `apps\erp\componentes\formulario-vacaciones.tsx`:

```tsx
'use client'

import { useActionState } from 'react'
import { Boton, Campo, Entrada, Tarjeta } from '@suite/ui'
import type { EstadoForm } from '../app/tipos'

// Los días hábiles los ingresa el usuario (no se calculan de desde/hasta):
// feriados y medios días quedan a su criterio — spec §2.3.
export function FormularioVacaciones({
  accion,
  trabajadorId,
}: {
  accion: (prev: EstadoForm, formData: FormData) => Promise<EstadoForm>
  trabajadorId: string
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoForm)
  return (
    <Tarjeta className="max-w-2xl">
      <form action={enviar} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <input type="hidden" name="trabajador_id" value={trabajadorId} />
        <Campo etiqueta="Desde *">
          <Entrada name="desde" type="date" required />
        </Campo>
        <Campo etiqueta="Hasta *">
          <Entrada name="hasta" type="date" required />
        </Campo>
        <Campo etiqueta="Días hábiles *">
          <Entrada name="dias_habiles" inputMode="numeric" placeholder="5" required />
        </Campo>
        <Campo etiqueta="Comentario">
          <Entrada name="comentario" />
        </Campo>
        <div className="flex items-center justify-end gap-2 sm:col-span-2">
          {estado.error && <span className="mr-auto text-sm text-red-600">{estado.error}</span>}
          <Boton type="submit" disabled={pendiente}>
            {pendiente ? 'Registrando…' : 'Registrar vacaciones'}
          </Boton>
        </div>
      </form>
    </Tarjeta>
  )
}
```

- [ ] **Paso 5 — `acciones.ts`: componer nombre, exigir isapre, registrar/eliminar vacaciones**

Contenido completo final de `apps\erp\app\trabajadores\acciones.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { limpiarRut, nombreCompleto, validarRut } from '@suite/core'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import type { EstadoForm } from '../tipos'
import { AFPS, ISAPRES } from './catalogos'

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/

export async function guardarTrabajador(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const id = String(formData.get('id') ?? '')
  const rutCrudo = String(formData.get('rut') ?? '').trim()
  const nombres = String(formData.get('nombres') ?? '').trim()
  const apellidoPaterno = String(formData.get('apellido_paterno') ?? '').trim()
  const apellidoMaterno = String(formData.get('apellido_materno') ?? '').trim()
  const email = String(formData.get('email') ?? '').trim()
  const fechaNacimiento = String(formData.get('fecha_nacimiento') ?? '').trim()

  if (!validarRut(rutCrudo)) return { error: 'El RUT ingresado no es válido' }
  if (nombres === '') return { error: 'Los nombres son obligatorios' }
  if (apellidoPaterno === '') return { error: 'El apellido paterno es obligatorio' }
  if (email !== '' && !email.includes('@')) return { error: 'El correo no es válido' }
  if (fechaNacimiento !== '' && !FECHA_ISO.test(fechaNacimiento)) {
    return { error: 'La fecha de nacimiento no es válida' }
  }

  const datos = {
    rut: limpiarRut(rutCrudo),
    nombres,
    apellido_paterno: apellidoPaterno,
    apellido_materno: apellidoMaterno || null,
    // ÚNICA vía de escritura de la columna de display (spec §2.1): el resto
    // del sistema sigue leyendo trabajadores.nombre sin cambios.
    nombre: nombreCompleto(nombres, apellidoPaterno, apellidoMaterno || null),
    email: email || null,
    telefono: String(formData.get('telefono') ?? '').trim() || null,
    direccion: String(formData.get('direccion') ?? '').trim() || null,
    fecha_nacimiento: fechaNacimiento || null,
  }

  const supabase = await crearClienteServidor()
  if (id) {
    const { data, error } = await supabase
      .from('trabajadores')
      .update(datos)
      .eq('id', id)
      .eq('empresa_id', activa.id)
      .select('id')
    if (error) {
      if (error.code === '23505') return { error: 'Ya existe un trabajador con ese RUT' }
      if (error.code === '42501') return { error: 'Tu rol no permite editar trabajadores' }
      return { error: 'No se pudo guardar el trabajador' }
    }
    if ((data ?? []).length === 0) {
      return { error: 'No se pudo guardar: el trabajador no existe o tu rol no permite editarlo' }
    }
  } else {
    const { error } = await supabase.from('trabajadores').insert({ ...datos, empresa_id: activa.id })
    if (error) {
      if (error.code === '23505') return { error: 'Ya existe un trabajador con ese RUT' }
      if (error.code === '42501') return { error: 'Tu rol no permite crear trabajadores' }
      return { error: 'No se pudo crear el trabajador' }
    }
  }

  revalidatePath('/trabajadores')
  redirect('/trabajadores')
}

export async function alternarActivoTrabajador(formData: FormData): Promise<void> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return
  const id = String(formData.get('id') ?? '')
  const activo = String(formData.get('activo') ?? '') === 'true'
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase
    .from('trabajadores')
    .update({ activo: !activo })
    .eq('id', id)
    .eq('empresa_id', activa.id)
    .select('id')
  if (error || (data ?? []).length === 0) {
    console.error('alternarActivoTrabajador:', error ?? 'sin filas')
    return
  }
  revalidatePath('/trabajadores')
}

export async function guardarContrato(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const trabajadorId = String(formData.get('trabajador_id') ?? '')
  const contratoVigenteId = String(formData.get('contrato_vigente_id') ?? '')
  const tipo = String(formData.get('tipo') ?? '')
  const fechaInicio = String(formData.get('fecha_inicio') ?? '').trim()
  const fechaTermino = String(formData.get('fecha_termino') ?? '').trim()
  const cargo = String(formData.get('cargo') ?? '').trim()
  const sueldoCrudo = String(formData.get('sueldo_base') ?? '').trim()
  const afp = String(formData.get('afp') ?? '')
  const salud = String(formData.get('salud') ?? '')
  const isapreSel = String(formData.get('isapre') ?? '')
  const planCrudo = String(formData.get('plan_isapre_uf') ?? '').trim()

  if (trabajadorId === '') return { error: 'Falta el trabajador del contrato' }
  if (tipo !== 'indefinido' && tipo !== 'plazo_fijo') return { error: 'El tipo de contrato no es válido' }
  if (!FECHA_ISO.test(fechaInicio)) return { error: 'La fecha de inicio no es válida' }
  if (tipo === 'plazo_fijo') {
    if (!FECHA_ISO.test(fechaTermino)) return { error: 'Indica la fecha de término del contrato a plazo fijo' }
    if (fechaTermino <= fechaInicio) return { error: 'La fecha de término debe ser posterior al inicio' }
  }
  if (cargo === '') return { error: 'El cargo es obligatorio' }
  const sueldoBase = Number(sueldoCrudo)
  if (!Number.isInteger(sueldoBase) || sueldoBase <= 0) {
    return { error: 'El sueldo base debe ser un entero mayor que 0' }
  }
  if (!AFPS.some((a) => a.valor === afp)) return { error: 'La AFP no es válida' }
  if (salud !== 'fonasa' && salud !== 'isapre') return { error: 'El sistema de salud no es válido' }
  let isapre: string | null = null
  let planIsapreUf: number | null = null
  if (salud === 'isapre') {
    // Fail-closed (spec §2.2): contrato isapre NUEVO sin Isapre del catálogo no
    // entra — los contratos antiguos con isapre null son el límite declarado
    // (Previred los emite con código 0).
    if (!ISAPRES.some((i) => i.valor === isapreSel)) {
      return { error: 'Selecciona la Isapre del contrato' }
    }
    isapre = isapreSel
    // es-CL: se acepta coma decimal ("3,5"). La columna es numeric(6,2).
    planIsapreUf = Math.round(Number(planCrudo.replace(',', '.')) * 100) / 100
    if (!Number.isFinite(planIsapreUf) || planIsapreUf <= 0 || planIsapreUf > 9999.99) {
      return { error: 'Indica el plan Isapre en UF (mayor que 0)' }
    }
  }

  const supabase = await crearClienteServidor()

  // Cambiar condiciones = cerrar el vigente + crear uno nuevo (spec §2.2/§4).
  // DOS writes secuenciales, NO atómico (decisión del diseño §4): si el INSERT
  // falla después de cerrar el vigente, el trabajador queda sin contrato
  // vigente — estado visible en la ficha y reparable creando el contrato de
  // nuevo. El unique parcial (un vigente por trabajador) respalda la carrera.
  if (contratoVigenteId !== '') {
    const { data, error } = await supabase
      .from('contratos')
      .update({ vigente: false })
      .eq('id', contratoVigenteId)
      .eq('empresa_id', activa.id)
      .eq('vigente', true)
      .eq('trabajador_id', trabajadorId)
      .select('id')
    if (error) {
      if (error.code === '42501') return { error: 'Tu rol no permite gestionar contratos' }
      return { error: 'No se pudo cerrar el contrato vigente' }
    }
    if ((data ?? []).length === 0) {
      return { error: 'No se pudo cerrar: el contrato ya no está vigente o tu rol no permite gestionarlo' }
    }
  }

  const { error } = await supabase.from('contratos').insert({
    empresa_id: activa.id,
    trabajador_id: trabajadorId,
    tipo,
    fecha_inicio: fechaInicio,
    fecha_termino: tipo === 'plazo_fijo' ? fechaTermino : null,
    cargo,
    sueldo_base: sueldoBase,
    gratificacion_legal: formData.get('gratificacion_legal') === 'on',
    afp,
    salud,
    isapre,
    plan_isapre_uf: planIsapreUf,
  })
  if (error) {
    if (error.code === '23505') return { error: 'El trabajador ya tiene un contrato vigente' }
    if (error.code === '42501') return { error: 'Tu rol no permite gestionar contratos' }
    if (error.code === '23503') return { error: 'El trabajador no existe en esta empresa' }
    return { error: 'No se pudo crear el contrato' }
  }

  revalidatePath(`/trabajadores/${trabajadorId}`)
  redirect(`/trabajadores/${trabajadorId}`)
}

export async function registrarVacaciones(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const trabajadorId = String(formData.get('trabajador_id') ?? '')
  if (trabajadorId === '') return { error: 'Falta el trabajador' }
  const desde = String(formData.get('desde') ?? '').trim()
  const hasta = String(formData.get('hasta') ?? '').trim()
  if (!FECHA_ISO.test(desde) || !FECHA_ISO.test(hasta)) return { error: 'Las fechas no son válidas' }
  if (hasta < desde) return { error: 'La fecha hasta debe ser igual o posterior a desde' }
  const diasHabiles = Number(String(formData.get('dias_habiles') ?? '').trim())
  if (!Number.isInteger(diasHabiles) || diasHabiles <= 0) {
    return { error: 'Los días hábiles deben ser un entero mayor que 0' }
  }
  const comentario = String(formData.get('comentario') ?? '').trim()

  // INSERT directo con RLS (precedente gastos_vehiculo P12): dueno/admin
  // escriben, contador solo lee; sin RPC. Solape entre tomas NO se valida
  // (límite v1 del spec §2.3: el saldo igual resta).
  const supabase = await crearClienteServidor()
  const { error } = await supabase.from('vacaciones_tomadas').insert({
    empresa_id: activa.id,
    trabajador_id: trabajadorId,
    desde,
    hasta,
    dias_habiles: diasHabiles,
    comentario: comentario || null,
  })
  if (error) {
    if (error.code === '42501') return { error: 'Tu rol no permite registrar vacaciones' }
    if (error.code === '23503') return { error: 'El trabajador no existe en esta empresa' }
    return { error: 'No se pudo registrar las vacaciones' }
  }
  revalidatePath(`/trabajadores/${trabajadorId}`)
  return {}
}

export async function eliminarVacaciones(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  const id = String(formData.get('id') ?? '')
  const supabase = await crearClienteServidor()
  // .select delata el éxito falso (patrón eliminarGasto P12): la policy filtra
  // en silencio para roles sin permiso — 0 filas afectadas = NO hubo borrado.
  const { data, error } = await supabase
    .from('vacaciones_tomadas')
    .delete()
    .eq('id', id)
    .eq('empresa_id', activa.id)
    .select('trabajador_id')
  const filas = data ?? []
  if (error || filas.length === 0) return { error: 'No se pudo eliminar' }
  revalidatePath(`/trabajadores/${filas[0]!.trabajador_id}`)
  return {}
}
```

- [ ] **Paso 6 — ficha `[id]/page.tsx`: inicial con 3 campos + sección Vacaciones**

Contenido completo final de `apps\erp\app\trabajadores\[id]\page.tsx`:

```tsx
import { notFound } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { calcularVacaciones, formatearCLP, formatearRut } from '@suite/core'
import { Encabezado, Insignia, Tabla, Tarjeta, Td, Th, Tr } from '@suite/ui'
import { BotonEliminarCosto } from '../../../componentes/boton-eliminar-costo'
import { FormularioContrato } from '../../../componentes/formulario-contrato'
import { FormularioTrabajador } from '../../../componentes/formulario-trabajador'
import { FormularioVacaciones } from '../../../componentes/formulario-vacaciones'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { eliminarVacaciones, guardarContrato, guardarTrabajador, registrarVacaciones } from '../acciones'
import { ETIQUETA_AFP, ETIQUETA_TIPO } from '../catalogos'

interface Contrato {
  id: string
  tipo: string
  fecha_inicio: string
  fecha_termino: string | null
  cargo: string
  sueldo_base: number
  gratificacion_legal: boolean
  afp: string
  salud: string
  plan_isapre_uf: number | null
  vigente: boolean
}

interface Toma {
  id: string
  desde: string
  hasta: string
  dias_habiles: number
  comentario: string | null
}

const fmtFecha = (f: string | null) =>
  f ? new Date(f + 'T00:00:00').toLocaleDateString('es-CL') : '—'

const fmtDias = (n: number) => n.toLocaleString('es-CL', { maximumFractionDigits: 2 })

export default async function FichaTrabajador({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  // Escritura de ficha, contratos y vacaciones: solo dueno/admin. Contador:
  // TODO en solo lectura (los formularios ni se montan). Vendedor/bodeguero:
  // RLS por rol → 0 filas → notFound() de abajo. UX; la seguridad es RLS.
  const escribe = activa.rol === 'dueno' || activa.rol === 'admin'

  const supabase = await crearClienteServidor()
  const { data: trabajador } = await supabase
    .from('trabajadores')
    .select('*')
    .eq('id', id)
    .eq('empresa_id', activa.id)
    .single()
  if (!trabajador) notFound()

  const { data: contratosData } = await supabase
    .from('contratos')
    .select('id, tipo, fecha_inicio, fecha_termino, cargo, sueldo_base, gratificacion_legal, afp, salud, plan_isapre_uf, vigente')
    .eq('empresa_id', activa.id)
    .eq('trabajador_id', id)
    .order('creado_en', { ascending: false })
  const contratos = (contratosData ?? []) as Contrato[]
  const vigente = contratos.find((c) => c.vigente)

  const { data: tomasData } = await supabase
    .from('vacaciones_tomadas')
    .select('id, desde, hasta, dias_habiles, comentario')
    .eq('empresa_id', activa.id)
    .eq('trabajador_id', id)
    .order('desde', { ascending: false })
  const tomas = (tomasData ?? []) as Toma[]
  const totalTomados = tomas.reduce((s, t) => s + t.dias_habiles, 0)

  // PRIMER contrato = fecha_inicio más antigua: continuidad laboral entre
  // contratos consecutivos del mismo trabajador (spec §2.4).
  const primerContrato = contratos.length
    ? contratos.reduce((min, c) => (c.fecha_inicio < min.fecha_inicio ? c : min))
    : undefined
  const hoy = new Date().toISOString().slice(0, 10)
  // Costura Task 6: con finiquito no-anulado el devengo corta en su
  // fecha_termino; mientras la emisión no exista (Task 6) se devenga a hoy.
  const vac = primerContrato
    ? calcularVacaciones(primerContrato.fecha_inicio, hoy, totalTomados)
    : null

  return (
    <div>
      <Encabezado titulo={trabajador.nombre}>
        {!trabajador.activo && <Insignia tono="gris">Inactivo</Insignia>}
      </Encabezado>

      {escribe ? (
        <FormularioTrabajador
          accion={guardarTrabajador}
          inicial={{
            id: trabajador.id,
            rut: formatearRut(trabajador.rut),
            nombres: trabajador.nombres ?? '',
            apellido_paterno: trabajador.apellido_paterno ?? '',
            apellido_materno: trabajador.apellido_materno ?? '',
            email: trabajador.email ?? '',
            telefono: trabajador.telefono ?? '',
            direccion: trabajador.direccion ?? '',
            fecha_nacimiento: trabajador.fecha_nacimiento ?? '',
          }}
        />
      ) : (
        <Tarjeta className="max-w-2xl">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="font-medium text-slate-700">RUT</dt>
              <dd className="font-mono">{formatearRut(trabajador.rut)}</dd>
            </div>
            <div>
              <dt className="font-medium text-slate-700">Nombre</dt>
              <dd>{trabajador.nombre}</dd>
            </div>
            <div>
              <dt className="font-medium text-slate-700">Correo</dt>
              <dd>{trabajador.email ?? '—'}</dd>
            </div>
            <div>
              <dt className="font-medium text-slate-700">Teléfono</dt>
              <dd>{trabajador.telefono ?? '—'}</dd>
            </div>
            <div>
              <dt className="font-medium text-slate-700">Fecha de nacimiento</dt>
              <dd>{fmtFecha(trabajador.fecha_nacimiento)}</dd>
            </div>
            <div>
              <dt className="font-medium text-slate-700">Dirección</dt>
              <dd>{trabajador.direccion ?? '—'}</dd>
            </div>
          </dl>
          <p className="mt-3 text-sm text-slate-500">
            Tu rol permite solo lectura: la ficha y los contratos los editan dueño o admin.
          </p>
        </Tarjeta>
      )}

      <h2 className="mb-2 mt-8 text-lg font-semibold text-slate-800">Contratos</h2>
      <Tabla>
        <thead>
          <tr>
            <Th>Estado</Th>
            <Th>Tipo</Th>
            <Th>Cargo</Th>
            <Th>Inicio</Th>
            <Th>Término</Th>
            <Th className="text-right">Sueldo base</Th>
            <Th>AFP</Th>
            <Th>Salud</Th>
            <Th>Gratificación</Th>
          </tr>
        </thead>
        <tbody>
          {contratos.map((c) => (
            <Tr key={c.id}>
              <Td>
                {c.vigente ? <Insignia tono="verde">Vigente</Insignia> : <Insignia tono="gris">Cerrado</Insignia>}
              </Td>
              <Td>{ETIQUETA_TIPO[c.tipo] ?? c.tipo}</Td>
              <Td>{c.cargo}</Td>
              <Td>{fmtFecha(c.fecha_inicio)}</Td>
              <Td>{fmtFecha(c.fecha_termino)}</Td>
              <Td className="text-right font-mono">{formatearCLP(c.sueldo_base)}</Td>
              <Td>{ETIQUETA_AFP[c.afp] ?? c.afp}</Td>
              <Td>
                {c.salud === 'fonasa'
                  ? 'Fonasa'
                  : `Isapre · ${Number(c.plan_isapre_uf ?? 0).toLocaleString('es-CL')} UF`}
              </Td>
              <Td>{c.gratificacion_legal ? 'Sí' : 'No'}</Td>
            </Tr>
          ))}
          {contratos.length === 0 && (
            <Tr>
              <Td colSpan={9} className="py-8 text-center text-slate-500">
                Sin contratos todavía.
              </Td>
            </Tr>
          )}
        </tbody>
      </Tabla>

      {escribe && (
        <div className="mt-8">
          <h2 className="mb-2 text-lg font-semibold text-slate-800">
            {vigente ? 'Renovar contrato (cierra el vigente y crea uno nuevo)' : 'Primer contrato'}
          </h2>
          <FormularioContrato
            accion={guardarContrato}
            trabajadorId={trabajador.id}
            contratoVigenteId={vigente?.id}
          />
        </div>
      )}

      <h2 className="mb-2 mt-8 text-lg font-semibold text-slate-800">Vacaciones</h2>
      {vac && primerContrato ? (
        <>
          <Tarjeta className="mb-4 max-w-2xl">
            <dl className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <dt className="font-medium text-slate-700">Devengados</dt>
                <dd className="text-lg font-semibold">{fmtDias(vac.devengados)}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-700">Tomados</dt>
                <dd className="text-lg font-semibold">{fmtDias(totalTomados)}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-700">Saldo</dt>
                <dd className={`text-lg font-semibold ${vac.saldo < 0 ? 'text-red-600' : ''}`}>
                  {fmtDias(vac.saldo)}
                </dd>
              </div>
            </dl>
            <p className="mt-2 text-xs text-slate-500">
              Devengo desde el {fmtFecha(primerContrato.fecha_inicio)} (primer contrato), 1,25 días
              hábiles por mes completo.
            </p>
            {vac.saldo > 30 && (
              <p className="mt-3 text-sm font-medium text-red-600">
                El saldo supera los 30 días: la ley permite acumular como máximo 2 períodos.
              </p>
            )}
            {vac.saldo < 0 && (
              <p className="mt-3 text-sm font-medium text-red-600">
                El saldo es negativo: el trabajador tomó más días de los devengados.
              </p>
            )}
          </Tarjeta>

          <Tabla>
            <thead>
              <tr>
                <Th>Desde</Th>
                <Th>Hasta</Th>
                <Th className="text-right">Días hábiles</Th>
                <Th>Comentario</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {tomas.map((t) => (
                <Tr key={t.id}>
                  <Td>{fmtFecha(t.desde)}</Td>
                  <Td>{fmtFecha(t.hasta)}</Td>
                  <Td className="text-right font-mono">{t.dias_habiles}</Td>
                  <Td>{t.comentario ?? '—'}</Td>
                  <Td className="text-right">
                    {escribe && <BotonEliminarCosto id={t.id} accion={eliminarVacaciones} />}
                  </Td>
                </Tr>
              ))}
              {tomas.length === 0 && (
                <Tr>
                  <Td colSpan={5} className="py-8 text-center text-slate-500">
                    Sin vacaciones registradas todavía.
                  </Td>
                </Tr>
              )}
            </tbody>
          </Tabla>

          {escribe && (
            <div className="mt-4">
              <h3 className="mb-2 text-sm font-semibold text-slate-800">Registrar vacaciones</h3>
              <FormularioVacaciones accion={registrarVacaciones} trabajadorId={trabajador.id} />
            </div>
          )}
        </>
      ) : (
        <p className="text-sm text-slate-500">
          El devengo de vacaciones parte con el primer contrato del trabajador.
        </p>
      )}
    </div>
  )
}
```

Notas del paso:

- `BotonEliminarCosto` se reusa TAL CUAL (ya es genérico `id + accion`, con confirmación inline "¿Eliminar? / No" — no se crea un botón nuevo).
- El botón "Emitir finiquito" NO va acá: lo agrega T6 junto con la carga del finiquito (y ahí `hasta` pasa a `fecha_termino` cuando corresponda — T6 Step 7 edita EXACTAMENTE el bloque `const hoy … const vac` de arriba).

- [ ] **Paso 7 — lista `page.tsx`: insignia "Finiquitado" y finiquitados al final**

Contenido completo final de `apps\erp\app\trabajadores\page.tsx`:

```tsx
import Link from 'next/link'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearRut } from '@suite/core'
import { Boton, Encabezado, Entrada, Insignia, Paginacion, Tabla, Td, Th, Tr } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import { alternarActivoTrabajador } from './acciones'

const POR_PAGINA = 25

interface FilaTrabajador {
  id: string
  rut: string
  nombre: string
  activo: boolean
  contratos: { cargo: string }[]
}

export default async function PaginaTrabajadores({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; pagina?: string; inactivos?: string }>
}) {
  const { q = '', pagina: paginaCruda, inactivos } = await searchParams
  const pagina = Math.max(1, Math.trunc(Number(paginaCruda) || 1))
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  // Escritura solo dueno/admin (spec §2.1); contador ve todo en solo lectura.
  // UX, no seguridad: RLS por rol manda (vendedor/bodeguero → 0 filas → tabla vacía).
  const escribe = activa.rol === 'dueno' || activa.rol === 'admin'

  const supabase = await crearClienteServidor()
  // El join trae SOLO el contrato vigente (filtro embebido .eq sobre
  // contratos.vigente, sin !inner): un trabajador sin contrato queda con
  // contratos = [] y sigue apareciendo en la lista.
  let consulta = supabase
    .from('trabajadores')
    .select('id, rut, nombre, activo, contratos (cargo)', { count: 'exact' })
    .eq('empresa_id', activa.id)
    .eq('contratos.vigente', true)
    .order('nombre')
    .range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1)
  if (inactivos !== '1') consulta = consulta.eq('activo', true)
  // Comas y paréntesis rompen la sintaxis del filtro .or() de PostgREST.
  const qLimpia = q.replace(/[,()]/g, ' ').trim()
  if (qLimpia) consulta = consulta.or(`nombre.ilike.%${qLimpia}%,rut.ilike.%${qLimpia}%`)

  const { data, count, error } = await consulta
  if (error) throw new Error('No se pudieron cargar los trabajadores')
  const trabajadores = (data ?? []) as FilaTrabajador[]
  const totalPaginas = Math.max(1, Math.ceil((count ?? 0) / POR_PAGINA))
  const hrefBase = `/trabajadores?q=${encodeURIComponent(q)}${inactivos === '1' ? '&inactivos=1' : ''}`

  // Insignia "Finiquitado" (spec §6): un query liviano de ids por empresa
  // (finiquitos no-anulados) → Set en memoria. El sort ESTABLE deja a los
  // finiquitados al final conservando el orden por nombre dentro de cada
  // grupo. Límite v1 declarado: el orden es por página — la paginación SQL
  // sigue siendo por nombre.
  const { data: finiquitosData } = await supabase
    .from('finiquitos')
    .select('trabajador_id')
    .eq('empresa_id', activa.id)
    .neq('estado', 'anulado')
  const finiquitados = new Set((finiquitosData ?? []).map((f) => f.trabajador_id as string))
  trabajadores.sort((a, b) => Number(finiquitados.has(a.id)) - Number(finiquitados.has(b.id)))

  return (
    <div>
      <Encabezado titulo="Trabajadores">
        {escribe && (
          <Link href="/trabajadores/nuevo">
            <Boton>Nuevo trabajador</Boton>
          </Link>
        )}
      </Encabezado>

      <form className="mb-4 flex items-center gap-3" action="/trabajadores" method="get">
        <Entrada name="q" defaultValue={q} placeholder="Buscar por nombre o RUT…" className="max-w-xs" />
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" name="inactivos" value="1" defaultChecked={inactivos === '1'} />
          Ver inactivos
        </label>
        <Boton variante="secundario" type="submit">
          Buscar
        </Boton>
      </form>

      <Tabla>
        <thead>
          <tr>
            <Th>RUT</Th>
            <Th>Nombre</Th>
            <Th>Cargo (contrato vigente)</Th>
            <Th>Estado</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {trabajadores.map((t) => (
            <Tr key={t.id}>
              <Td className="font-mono">{formatearRut(t.rut)}</Td>
              <Td>
                <Link className="text-marca-700 hover:underline" href={`/trabajadores/${t.id}`}>
                  {t.nombre}
                </Link>
              </Td>
              <Td>{t.contratos[0]?.cargo ?? <span className="text-slate-400">Sin contrato</span>}</Td>
              <Td className="space-x-1">
                {t.activo ? <Insignia tono="verde">Activo</Insignia> : <Insignia tono="gris">Inactivo</Insignia>}
                {finiquitados.has(t.id) && <Insignia tono="rojo">Finiquitado</Insignia>}
              </Td>
              <Td>
                {escribe && (
                  <form action={alternarActivoTrabajador}>
                    <input type="hidden" name="id" value={t.id} />
                    <input type="hidden" name="activo" value={String(t.activo)} />
                    <Boton variante="secundario" type="submit" className="px-2 py-1 text-xs">
                      {t.activo ? 'Desactivar' : 'Reactivar'}
                    </Boton>
                  </form>
                )}
              </Td>
            </Tr>
          ))}
          {trabajadores.length === 0 && (
            <Tr>
              <Td colSpan={5} className="py-8 text-center text-slate-500">
                No hay trabajadores {q ? 'que coincidan con la búsqueda' : 'todavía. Crea el primero'}.
              </Td>
            </Tr>
          )}
        </tbody>
      </Tabla>

      <Paginacion pagina={pagina} totalPaginas={totalPaginas} hrefBase={hrefBase} />
    </div>
  )
}
```

- [ ] **Paso 8 — route Previred: apellidos reales + código de Isapre**

Contenido completo final de `apps\erp\app\libro-remuneraciones\previred\route.ts`:

```ts
import { crearClienteServidor } from '@suite/auth/server'
import { generarPrevired, periodoAnterior, rangoDeMes, ISAPRES, type FilaPrevired } from '@suite/core'
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
  // nombre se conserva SOLO para el orden del archivo; los campos 3-5 del TXT
  // salen de las columnas reales (0027 — la heurística separarNombre murió).
  trabajadores: { rut: string; nombre: string; nombres: string; apellido_paterno: string; apellido_materno: string | null } | null
  contratos: { isapre: string | null } | null
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
  // MISMA base que el libro y el CSV (empresa + período, sin anuladas). El join
  // a contratos usa la FK compuesta de liquidaciones.contrato_id: trae la
  // isapre del contrato de ESA liquidación (snapshot del vínculo, no del vigente).
  const { data, error } = await supabase
    .from('liquidaciones')
    .select('dias_trabajados, afp, total_imponible, afp_monto, sis_monto, cesantia_monto, cesantia_empleador_monto, salud, salud_monto, mutual_monto, trabajadores (rut, nombre, nombres, apellido_paterno, apellido_materno), contratos (isapre)')
    .eq('empresa_id', activa.id)
    .eq('periodo', periodo)
    .neq('estado', 'anulada')
  if (error) return new Response('No se pudo generar el archivo Previred', { status: 500 })
  const filas: FilaPrevired[] = ((data ?? []) as Fila[])
    .sort((a, b) => (a.trabajadores?.nombre ?? '').localeCompare(b.trabajadores?.nombre ?? '', 'es'))
    .map((f) => {
      const isapreContrato = f.contratos?.isapre ?? null
      // Código del catálogo SOLO si el contrato es isapre con isapre seteada;
      // null → lineaPrevired emite 7 (fonasa) o 0 (isapre legada sin catálogo,
      // límite declarado del spec §2.2).
      const isapreCodigo =
        f.salud === 'isapre' && isapreContrato
          ? (ISAPRES.find((i) => i.valor === isapreContrato)?.codigo_previred ?? null)
          : null
      return {
        rut: f.trabajadores?.rut ?? '',
        nombres: f.trabajadores?.nombres ?? '',
        apellido_paterno: f.trabajadores?.apellido_paterno ?? '',
        apellido_materno: f.trabajadores?.apellido_materno ?? null,
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
        isapre_codigo: isapreCodigo,
        salud_monto: f.salud_monto,
        mutual_monto: f.mutual_monto,
      }
    })

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

- [ ] **Paso 9 — verificación: build del ERP (CIERRA la costura T4→T5)**

```powershell
pnpm --filter erp build
```

Salida esperada: exit 0, `✓ Compiled successfully`, y `/trabajadores`, `/trabajadores/[id]`, `/trabajadores/nuevo` y `/libro-remuneraciones/previred` presentes en el listado de rutas. (Recordatorio de memoria del proyecto: el build pisa `.next` de los dev servers — reiniciarlos después.)

- [ ] **Paso 10 — commit**

```bash
git add apps/erp/componentes/formulario-trabajador.tsx apps/erp/componentes/formulario-contrato.tsx apps/erp/componentes/formulario-vacaciones.tsx apps/erp/app/trabajadores/acciones.ts apps/erp/app/trabajadores/catalogos.ts "apps/erp/app/trabajadores/[id]/page.tsx" apps/erp/app/trabajadores/page.tsx apps/erp/app/libro-remuneraciones/previred/route.ts
git commit -m "feat(erp): ficha con apellidos y vacaciones, isapre del contrato y Previred con datos reales

- formularios de trabajador (nuevo y ficha) capturan nombres/apellido paterno/
  apellido materno; guardarTrabajador compone la columna de display nombre con
  nombreCompleto (única vía de escritura) — la lista y el resto del sistema
  siguen leyendo nombre sin cambios
- sección Vacaciones en la ficha: devengado/tomados/saldo con calcularVacaciones
  (primer contrato; advertencia roja con saldo > 30 o negativo), registrar toma
  (INSERT directo con RLS) y eliminar con confirmación (reusa BotonEliminarCosto)
- formulario de contrato exige Isapre del catálogo ISAPRES con salud='isapre'
  (action fail-closed; contratos legados quedan null → Previred 0)
- lista de trabajadores: insignia Finiquitado (finiquitos no-anulados) y
  finiquitados al final de la página
- route Previred puebla apellidos reales (campos 3-5) e isapre_codigo (campo 75)
  desde los joins — la heurística separarNombre ya no se usa

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

→ commit en la rama del plan; `git status` limpio. Archivos UTF-8 SIN BOM; copy es-CL con tildes.

---
### Task 6: Finiquito — vista previa en vivo, documento imprimible, pagar/anular con reversa y origen contable

Baseline que esta task DEBE mantener: pgTAP **435 en 20 archivos**, unit **229** (task 100% UI: solo build). Contratos confirmados por el ensamblador: RPCs con nombres `p_*` de T2 (`emitir_finiquito` con **8 args sin defaults** — `p_comentario` es `string` requerido en el codegen: la action pasa el string tal cual y la RPC normaliza `''` → null); mensaje de anular `'Solo se puede anular un finiquito emitido o pagado'`; `calcularFiniquito` del espejo T4 devuelve `ResultadoFiniquito` **SIN el campo `base`** — la vista previa que muestra la base topada la recalcula localmente con `Math.min(sueldoBase, Math.round(90 * uf))`.

**Files:**
- Create: `apps/erp/app/trabajadores/[id]/finiquito/page.tsx` (detalle si hay finiquito no-anulado; formulario si no)
- Create: `apps/erp/app/trabajadores/[id]/finiquito/acciones.ts` (emitir / pagar / anular + hook + reversa)
- Create: `apps/erp/componentes/formulario-finiquito.tsx` (client: vista previa en vivo con el espejo T4)
- Create: `apps/erp/componentes/acciones-finiquito.tsx` (Pagar / Anular con motivo — patrón `acciones-liquidacion.tsx`)
- Modify: `apps/erp/app/trabajadores/catalogos.ts` (`CAUSALES` + `ETIQUETA_CAUSAL`)
- Modify: `apps/erp/lib/contabilidad.ts` (union de orígenes gana `'finiquito'` — ES DE ESTA TASK)
- Modify: `apps/erp/app/contabilidad/origenes.ts` (etiqueta `Finiquito` + nota en `rutaOrigen`)
- Modify: `apps/erp/app/contabilidad/asientos/page.tsx` (`ORIGENES` del filtro gana `'finiquito'`)
- Modify: `apps/erp/app/trabajadores/[id]/page.tsx` (botón "Emitir finiquito" / "Ver finiquito" + corte del devengo — SOBRE la versión que dejó T5)
- **NO se toca `apps/erp/app/trabajadores/page.tsx`**: la insignia y el orden de la lista ya los dejó T5 (Global Constraints).

**Interfaces:**
- Consumes `calcularFiniquito` / `EntradaFiniquito` / `ResultadoFiniquito` de T4 (firmas reales de la Task 4; LANZA con total negativo con el mensaje byte-exacto del guard §3.6 — la vista previa lo captura como aviso, patrón `calcularLiquidacion` en `formulario-liquidacion.tsx:82-88`).
- Consumes RPCs de T2: `emitir_finiquito(p_empresa, p_trabajador, p_causal, p_fecha_termino, p_aviso_dado, p_otros_haberes, p_otros_descuentos, p_comentario) → uuid`, `pagar_finiquito(p_empresa, p_finiquito)`, `anular_finiquito(p_empresa, p_finiquito, p_motivo)`, y `revertir_asiento` (P16, ya vivo) para la reversa.
- Consumes mensajes byte-exactos de Global Constraints (Sets de IGUALDAD ESTRICTA, patrón `liquidaciones/acciones.ts`).
- Produces: origen `'finiquito'` en el union del hook y en la UI de contabilidad; glosa de reversa fijada por el spec §4: `'Anulación finiquito {nombre}'`.

- [ ] **Step 1: Catálogo de causales**

En `apps/erp/app/trabajadores/catalogos.ts`, agregar al final:

```ts
// Causales legales de término (spec P20 §2.5/§6): la etiqueta lleva el artículo
// del Código del Trabajo — la usan el select del formulario Y el documento.
export const CAUSALES = [
  { valor: 'renuncia', etiqueta: 'Renuncia voluntaria (art. 159 N° 2)' },
  { valor: 'mutuo_acuerdo', etiqueta: 'Mutuo acuerdo de las partes (art. 159 N° 1)' },
  { valor: 'vencimiento_plazo', etiqueta: 'Vencimiento del plazo convenido (art. 159 N° 4)' },
  { valor: 'necesidades_empresa', etiqueta: 'Necesidades de la empresa (art. 161)' },
  { valor: 'conducta_grave', etiqueta: 'Conductas graves del trabajador (art. 160)' },
] as const

export const ETIQUETA_CAUSAL: Record<string, string> = Object.fromEntries(
  CAUSALES.map((c) => [c.valor, c.etiqueta])
)
```

- [ ] **Step 2: Origen contable en el hook y en la UI de contabilidad (old/new contra los archivos REALES, verificados)**

`apps/erp/lib/contabilidad.ts` — el union del parámetro `origen` (línea 19) gana `'finiquito'`:

old_string:
```ts
  origen: 'venta' | 'nota_credito' | 'compra' | 'pago' | 'pago_proveedor' | 'anticipo' | 'remuneracion',
```

new_string:
```ts
  origen: 'venta' | 'nota_credito' | 'compra' | 'pago' | 'pago_proveedor' | 'anticipo' | 'remuneracion' | 'finiquito',
```

`apps/erp/app/contabilidad/origenes.ts` — etiqueta nueva en `ETIQUETA_ORIGEN`:

old_string:
```ts
  remuneracion: 'Remuneración',
```

new_string:
```ts
  remuneracion: 'Remuneración',
  finiquito: 'Finiquito',
```

y en `rutaOrigen` SOLO se amplía el comentario (el finiquito queda SIN link: `referencia_id` es el id del finiquito y su pantalla vive bajo `/trabajadores/[trabajador]/finiquito` — no derivable desde el asiento; misma decisión que compra/pago/anticipo):

old_string:
```ts
// Ruta del documento de origen SOLO cuando existe una pantalla de detalle para él:
// ventas/NC tienen página propia; compra/pago/anticipo viven en listas -> sin link
// (se muestra solo la etiqueta). La usa el detalle de asiento (Task 7).
```

new_string:
```ts
// Ruta del documento de origen SOLO cuando existe una pantalla de detalle para él:
// ventas/NC tienen página propia; compra/pago/anticipo viven en listas -> sin link
// (se muestra solo la etiqueta). finiquito tampoco: su detalle vive bajo
// /trabajadores/[trabajador]/finiquito y referencia_id es el id del finiquito
// (no derivable desde el asiento). La usa el detalle de asiento (Task 7).
```

`apps/erp/app/contabilidad/asientos/page.tsx` línea 8 — el filtro gana el origen:

old_string:
```ts
const ORIGENES = ['manual', 'venta', 'nota_credito', 'compra', 'pago', 'pago_proveedor', 'anticipo', 'reversa', 'cierre', 'remuneracion']
```

new_string:
```ts
const ORIGENES = ['manual', 'venta', 'nota_credito', 'compra', 'pago', 'pago_proveedor', 'anticipo', 'reversa', 'cierre', 'remuneracion', 'finiquito']
```

(El resto de consumidores de `ETIQUETA_ORIGEN` — resumen, diario, export, detalle — la ganan gratis por el mapa compartido.)

- [ ] **Step 3: Server actions del finiquito**

Crear `apps/erp/app/trabajadores/[id]/finiquito/acciones.ts` (espejo del patrón `liquidaciones/acciones.ts`):

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { contabilizarAsiento } from '../../../../lib/contabilidad'
import { obtenerEmpresaActiva } from '../../../../lib/empresa-activa'
import type { EstadoForm } from '../../../tipos'
import { CAUSALES } from '../../catalogos'

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/

// IGUALDAD ESTRICTA del mensaje completo (spec §3, patrón liquidaciones):
// cualquier otro error cae al genérico.
const ERRORES_EMITIR = new Set([
  'Tu rol no permite emitir finiquitos',
  'El trabajador no tiene contrato vigente',
  'No hay indicadores previsionales para el período',
  'Ya existe un finiquito para este contrato',
  'La fecha de término no puede ser anterior al inicio del primer contrato',
  'El total del finiquito no puede ser negativo: revisa los descuentos',
])

export async function emitirFiniquito(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const trabajador = String(formData.get('trabajador_id') ?? '')
  const causal = String(formData.get('causal') ?? '')
  const fechaTermino = String(formData.get('fecha_termino') ?? '').trim()
  const avisoDado = formData.get('aviso_dado') === 'on'
  const otrosHaberes = Math.trunc(Number(formData.get('otros_haberes') || 0))
  const otrosDescuentos = Math.trunc(Number(formData.get('otros_descuentos') || 0))
  const comentario = String(formData.get('comentario') ?? '').trim()
  if (!trabajador) return { error: 'Falta el trabajador del finiquito' }
  if (!CAUSALES.some((c) => c.valor === causal)) return { error: 'La causal no es válida' }
  if (!FECHA_ISO.test(fechaTermino)) return { error: 'La fecha de término no es válida' }
  if (!Number.isFinite(otrosHaberes) || otrosHaberes < 0 || !Number.isFinite(otrosDescuentos) || otrosDescuentos < 0)
    return { error: 'Los montos no pueden ser negativos' }

  const supabase = await crearClienteServidor()
  const { data, error } = await supabase.rpc('emitir_finiquito', {
    p_empresa: activa.id,
    p_trabajador: trabajador,
    p_causal: causal,
    p_fecha_termino: fechaTermino,
    p_aviso_dado: avisoDado,
    p_otros_haberes: otrosHaberes,
    p_otros_descuentos: otrosDescuentos,
    // El Arg del codegen es string requerido (la firma T2 no tiene default);
    // la RPC normaliza '' -> null con nullif(trim(...)).
    p_comentario: comentario,
  })
  if (error) {
    if (ERRORES_EMITIR.has(error.message)) return { error: error.message }
    return { error: 'No se pudo emitir el finiquito' }
  }
  // Hook best-effort (NUNCA lanza, spec §4): el asiento origen 'finiquito' se crea
  // aparte; si falla, "Contabilizar pendientes" lo repara (mismo motor idempotente).
  await contabilizarAsiento(activa.id, 'finiquito', data)
  revalidatePath('/trabajadores')
  revalidatePath(`/trabajadores/${trabajador}`)
  revalidatePath(`/trabajadores/${trabajador}/finiquito`)
  // redirect lanza NEXT_REDIRECT: FUERA de try/catch. La misma ruta muestra ahora el DETALLE.
  redirect(`/trabajadores/${trabajador}/finiquito`)
}

const ERRORES_PAGAR = new Set(['Solo se puede pagar un finiquito emitido'])

export async function pagarFiniquito(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  const finiquito = String(formData.get('finiquito_id') ?? '')
  const trabajador = String(formData.get('trabajador_id') ?? '')
  if (!finiquito) return { error: 'Finiquito no válido' }
  const supabase = await crearClienteServidor()
  const { error } = await supabase.rpc('pagar_finiquito', {
    p_empresa: activa.id,
    p_finiquito: finiquito,
  })
  if (error) {
    if (ERRORES_PAGAR.has(error.message) || error.message.startsWith('Tu rol no permite'))
      return { error: error.message }
    return { error: 'No se pudo pagar el finiquito' }
  }
  revalidatePath(`/trabajadores/${trabajador}/finiquito`)
  return {}
}

const ERRORES_ANULAR = new Set([
  'Indica el motivo de la anulación',
  'Solo se puede anular un finiquito emitido o pagado',
  'El trabajador ya tiene otro contrato vigente',
])

export async function anularFiniquito(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  const finiquito = String(formData.get('finiquito_id') ?? '')
  const trabajador = String(formData.get('trabajador_id') ?? '')
  const motivo = String(formData.get('motivo') ?? '').trim()
  if (!finiquito) return { error: 'Finiquito no válido' }
  if (!motivo) return { error: 'Indica el motivo de la anulación' }
  const supabase = await crearClienteServidor()
  const { error } = await supabase.rpc('anular_finiquito', {
    p_empresa: activa.id,
    p_finiquito: finiquito,
    p_motivo: motivo,
  })
  if (error) {
    if (ERRORES_ANULAR.has(error.message) || error.message.startsWith('Tu rol no permite'))
      return { error: error.message }
    return { error: 'No se pudo anular el finiquito' }
  }

  // Reversa contable best-effort (patrón NUNCA-lanza de anularLiquidacion): la
  // anulación ya está confirmada en BD; si la reversa falla (p. ej. período
  // cerrado) el asiento original queda visible y se revierte a mano.
  try {
    const { data: asiento } = await supabase
      .from('asientos')
      .select('id')
      .eq('empresa_id', activa.id)
      .eq('origen', 'finiquito')
      .eq('referencia_id', finiquito)
      .maybeSingle()
    if (asiento) {
      const { data: fin } = await supabase
        .from('finiquitos')
        .select('trabajadores (nombre)')
        .eq('id', finiquito)
        .eq('empresa_id', activa.id)
        .single()
      const { error: errorReversa } = await supabase.rpc('revertir_asiento', {
        p_empresa: activa.id,
        p_asiento: asiento.id,
        // Glosa fijada por el spec §4: 'Anulación finiquito {nombre}'.
        p_glosa: `Anulación finiquito ${fin?.trabajadores?.nombre ?? ''}`.trim(),
      })
      if (errorReversa) console.error('anularFiniquito (reversa):', errorReversa.message)
    }
  } catch (e) {
    console.error('anularFiniquito (reversa):', e)
  }

  revalidatePath('/trabajadores')
  revalidatePath(`/trabajadores/${trabajador}`)
  revalidatePath(`/trabajadores/${trabajador}/finiquito`)
  revalidatePath('/contabilidad/asientos')
  return {}
}
```

- [ ] **Step 4: Formulario con vista previa en vivo (client)**

Crear `apps/erp/componentes/formulario-finiquito.tsx`. Patrón `formulario-liquidacion.tsx`: la página server serializa los datos (primer contrato, UF por período, saldo de vacaciones), el client calcula la preview con el espejo T4 y la RPC recalcula TODO al emitir. La base topada se recalcula LOCAL (ResultadoFiniquito no la expone):

```tsx
'use client'

import { useActionState, useState } from 'react'
import { calcularFiniquito, formatearCLP, formatearRut } from '@suite/core'
import { Boton, Campo, Entrada, Selector, Tarjeta } from '@suite/ui'
import { emitirFiniquito } from '../app/trabajadores/[id]/finiquito/acciones'
import { CAUSALES } from '../app/trabajadores/catalogos'
import type { EstadoForm } from '../app/tipos'

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/

function Linea({ concepto, monto }: { concepto: string; monto: number }) {
  return (
    <div className="flex justify-between gap-2 py-0.5 text-sm">
      <span>{concepto}</span>
      <span className="font-mono">{formatearCLP(monto)}</span>
    </div>
  )
}

export function FormularioFiniquito({
  trabajador,
  fechaInicioPrimerContrato,
  sueldoBase,
  diasTomados,
  ufPorPeriodo,
}: {
  trabajador: { id: string; nombre: string; rut: string }
  fechaInicioPrimerContrato: string
  sueldoBase: number
  diasTomados: number
  ufPorPeriodo: Record<string, number>
}) {
  const [causal, setCausal] = useState('necesidades_empresa')
  const [fechaTermino, setFechaTermino] = useState('')
  const [avisoDado, setAvisoDado] = useState(false)
  const [otrosHaberes, setOtrosHaberes] = useState('0')
  const [otrosDescuentos, setOtrosDescuentos] = useState('0')
  const [resultado, enviar, pendiente] = useActionState(emitirFiniquito, {} as EstadoForm)

  // La vista previa clampa igual que la action (vacío/NaN no rompe el cálculo);
  // el servidor re-valida estricto y la RPC recalcula TODO (spec §3).
  const haberes = Math.max(0, Math.trunc(Number(otrosHaberes)) || 0)
  const descuentos = Math.max(0, Math.trunc(Number(otrosDescuentos)) || 0)
  const uf = ufPorPeriodo[fechaTermino.slice(0, 7)]

  // El espejo LANZA con total negativo (mismo guard byte-exacto que la RPC): se
  // captura y se muestra como aviso — la vista previa jamás rompe el render.
  let previa: ReturnType<typeof calcularFiniquito> | null = null
  let baseTopada = 0 // min(sueldo, 90 UF) — el espejo no la expone; se recalcula para la etiqueta (§3.2)
  let aviso: string | null = null
  if (!FECHA_ISO.test(fechaTermino)) {
    aviso = 'Indica la fecha de término para ver el cálculo.'
  } else if (uf == null) {
    aviso = 'No hay indicadores previsionales para el período' // mismo texto que la RPC (spec §3.2)
  } else {
    try {
      previa = calcularFiniquito({
        causal,
        aviso_dado: avisoDado,
        fecha_inicio: fechaInicioPrimerContrato,
        fecha_termino: fechaTermino,
        sueldo_base: sueldoBase,
        dias_tomados: diasTomados,
        uf,
        otros_haberes: haberes,
        otros_descuentos: descuentos,
      })
      baseTopada = Math.min(sueldoBase, Math.round(90 * uf))
    } catch (e) {
      aviso = e instanceof Error ? e.message : 'No se pudo calcular la vista previa'
    }
  }

  return (
    <form action={enviar} className="grid max-w-5xl gap-6 md:grid-cols-2">
      <input type="hidden" name="trabajador_id" value={trabajador.id} />
      <Tarjeta className="grid gap-4 self-start">
        <Campo etiqueta="Causal legal de término">
          <Selector name="causal" value={causal} onChange={(e) => setCausal(e.target.value)}>
            {CAUSALES.map((c) => (
              <option key={c.valor} value={c.valor}>{c.etiqueta}</option>
            ))}
          </Selector>
        </Campo>
        <Campo etiqueta="Fecha de término">
          <Entrada name="fecha_termino" type="date" required value={fechaTermino} onChange={(e) => setFechaTermino(e.target.value)} />
        </Campo>
        {/* Visible SOLO para necesidades_empresa (spec §6): en las demás causales
            no hay indemnización sustitutiva del aviso previo. */}
        {causal === 'necesidades_empresa' && (
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" name="aviso_dado" checked={avisoDado} onChange={(e) => setAvisoDado(e.target.checked)} />
            Se dio el aviso previo de 30 días (sin aviso se paga un mes adicional)
          </label>
        )}
        <Campo etiqueta="Otros haberes (CLP)">
          <Entrada name="otros_haberes" type="number" min={0} step={1} value={otrosHaberes} onChange={(e) => setOtrosHaberes(e.target.value)} />
        </Campo>
        <Campo etiqueta="Otros descuentos (CLP)">
          <Entrada name="otros_descuentos" type="number" min={0} step={1} value={otrosDescuentos} onChange={(e) => setOtrosDescuentos(e.target.value)} />
        </Campo>
        <Campo etiqueta="Comentario (opcional)">
          <Entrada name="comentario" placeholder="Referencia interna" />
        </Campo>
        <div className="flex flex-wrap items-center gap-3">
          <Boton type="submit" disabled={pendiente || previa == null}>
            {pendiente ? 'Emitiendo…' : 'Emitir finiquito'}
          </Boton>
          {resultado.error && <span className="text-sm text-red-600">{resultado.error}</span>}
        </div>
      </Tarjeta>

      <Tarjeta>
        <h2 className="mb-1 text-lg font-semibold text-slate-800">Vista previa</h2>
        <p className="mb-3 text-sm text-slate-500">
          {trabajador.nombre} · {formatearRut(trabajador.rut)}. El cálculo definitivo lo hace el
          servidor al emitir; al emitir se cierra el contrato y el trabajador queda inactivo.
        </p>
        {aviso && <p className="text-sm text-amber-700">{aviso}</p>}
        {previa != null && (
          <div>
            <Linea
              concepto={`Indemnización por años de servicio (${previa.anos_servicio} ${previa.anos_servicio === 1 ? 'año' : 'años'}, base ${formatearCLP(baseTopada)})`}
              monto={previa.indemnizacion_anos}
            />
            <Linea concepto="Indemnización sustitutiva del aviso previo" monto={previa.indemnizacion_aviso} />
            <Linea
              concepto={`Feriado proporcional (${previa.feriado_dias.toLocaleString('es-CL')} días, saldo con ${diasTomados} tomados)`}
              monto={previa.feriado_monto}
            />
            <Linea concepto="Otros haberes" monto={haberes} />
            <Linea concepto="Otros descuentos" monto={-descuentos} />
            <div className="mt-2 flex items-center justify-between rounded-md bg-slate-100 px-3 py-2 text-lg font-semibold">
              <span>TOTAL FINIQUITO</span>
              <span className="font-mono">{formatearCLP(previa.total)}</span>
            </div>
            <p className="mt-3 text-xs text-slate-500">
              Simplificación v1: el feriado usa el saldo en días hábiles sin conversión a corridos y
              sin cotizaciones previsionales; el contador puede ajustar con un asiento manual.
            </p>
          </div>
        )}
      </Tarjeta>
    </form>
  )
}
```

- [ ] **Step 5: Acciones Pagar / Anular (client)**

Crear `apps/erp/componentes/acciones-finiquito.tsx` (copia adaptada de `acciones-liquidacion.tsx`; la advertencia de anulación DECLARA la reactivación, spec §6):

```tsx
'use client'

import { useActionState, useState } from 'react'
import { Boton } from '@suite/ui'
import { anularFiniquito, pagarFiniquito } from '../app/trabajadores/[id]/finiquito/acciones'
import type { EstadoForm } from '../app/tipos'

function BotonPagar({ finiquitoId, trabajadorId }: { finiquitoId: string; trabajadorId: string }) {
  const [confirmando, setConfirmando] = useState(false)
  const [estado, enviar, pendiente] = useActionState(pagarFiniquito, {} as EstadoForm)
  if (!confirmando) {
    return <Boton type="button" onClick={() => setConfirmando(true)}>Pagar</Boton>
  }
  return (
    <form action={enviar} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="finiquito_id" value={finiquitoId} />
      <input type="hidden" name="trabajador_id" value={trabajadorId} />
      <span className="text-sm text-slate-600">¿Marcar el finiquito como pagado?</span>
      <Boton type="submit" disabled={pendiente}>{pendiente ? '…' : 'Confirmar pago'}</Boton>
      <Boton variante="secundario" type="button" onClick={() => setConfirmando(false)}>Cancelar</Boton>
      {estado.error && <span className="w-full text-sm text-red-600">{estado.error}</span>}
    </form>
  )
}

function FormularioAnular({ finiquitoId, trabajadorId }: { finiquitoId: string; trabajadorId: string }) {
  const [abierto, setAbierto] = useState(false)
  const [estado, enviar, pendiente] = useActionState(anularFiniquito, {} as EstadoForm)
  if (!abierto) {
    return <Boton variante="peligro" type="button" onClick={() => setAbierto(true)}>Anular</Boton>
  }
  return (
    <form action={enviar} className="grid w-full max-w-md gap-2">
      <input type="hidden" name="finiquito_id" value={finiquitoId} />
      <input type="hidden" name="trabajador_id" value={trabajadorId} />
      {/* textarea plano con las clases de control de @suite/ui (no hay AreaTexto). */}
      <textarea
        name="motivo"
        required
        rows={3}
        placeholder="Motivo de la anulación *"
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-marca-500 focus:outline-none focus:ring-1 focus:ring-marca-500"
      />
      <p className="text-sm text-slate-600">
        Se anulará el finiquito, se creará la reversa de su asiento y se REACTIVARÁN el contrato y
        el trabajador. Después podrás volver a emitir el finiquito.
      </p>
      <div className="flex items-center gap-2">
        <Boton variante="peligro" type="submit" disabled={pendiente}>
          {pendiente ? 'Anulando…' : 'Confirmar anulación'}
        </Boton>
        <Boton variante="secundario" type="button" onClick={() => setAbierto(false)}>Cancelar</Boton>
      </div>
      {estado.error && <span className="text-sm text-red-600">{estado.error}</span>}
    </form>
  )
}

export function AccionesFiniquito({
  finiquitoId,
  trabajadorId,
  estado,
}: {
  finiquitoId: string
  trabajadorId: string
  estado: string
}) {
  // emitido → Pagar + Anular; pagado → Anular (spec §3: anula emitido O pagado).
  if (estado !== 'emitido' && estado !== 'pagado') return null
  return (
    <div className="flex flex-wrap items-start gap-3">
      {estado === 'emitido' && <BotonPagar finiquitoId={finiquitoId} trabajadorId={trabajadorId} />}
      <FormularioAnular finiquitoId={finiquitoId} trabajadorId={trabajadorId} />
    </div>
  )
}
```

- [ ] **Step 6: Página `/trabajadores/[id]/finiquito` — detalle o formulario**

Crear `apps/erp/app/trabajadores/[id]/finiquito/page.tsx`. **El unique parcial (spec §2.5) es POR CONTRATO, no por trabajador** (dictamen de los lentes): recontratar tras finiquitar deja finiquitos no-anulados históricos → con `maybeSingle` por trabajador el recontratado quedaría en un callejón sin salida (detalle viejo bloqueando el formulario; con 2 finiquitos históricos, PGRST116). La decisión formulario-vs-detalle se resuelve así: **contrato vigente SIN finiquito no-anulado de ESE contrato → formulario; si no, el finiquito no-anulado más reciente del trabajador** (`.order('emitido_en', …).limit(1)`). Anulado ⇒ vuelve el FORMULARIO (re-emitir tras anular):

```tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP, formatearRut } from '@suite/core'
import { Encabezado, Insignia, Tarjeta } from '@suite/ui'
import { AccionesFiniquito } from '../../../../componentes/acciones-finiquito'
import { BotonImprimir } from '../../../../componentes/boton-imprimir'
import { FormularioFiniquito } from '../../../../componentes/formulario-finiquito'
import { exigirRRHH } from '../../../../lib/rrhh-acceso'
import { ETIQUETA_CAUSAL } from '../../catalogos'

const TONO_FINIQUITO: Record<string, 'verde' | 'amarillo' | 'rojo' | 'gris'> = {
  emitido: 'amarillo',
  pagado: 'verde',
}
const ETIQUETA_FINIQUITO: Record<string, string> = { emitido: 'Emitido', pagado: 'Pagado' }

const fmtFecha = (f: string | null) =>
  f ? new Date(f + 'T00:00:00').toLocaleDateString('es-CL') : '—'

function Linea({ concepto, monto }: { concepto: string; monto: number }) {
  return (
    <div className="flex justify-between gap-2 py-0.5 text-sm">
      <span>{concepto}</span>
      <span className="font-mono">{formatearCLP(monto)}</span>
    </div>
  )
}

export default async function PaginaFiniquito({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const activa = await exigirRRHH()
  const supabase = await crearClienteServidor()

  const { data: trabajador } = await supabase
    .from('trabajadores')
    .select('id, nombre, rut')
    .eq('id', id)
    .eq('empresa_id', activa.id)
    .single()
  if (!trabajador) notFound()

  // Contratos ANTES que el finiquito: la decisión formulario-vs-detalle es POR
  // CONTRATO (el unique parcial es por contrato — recontratar tras finiquitar
  // deja finiquitos históricos no-anulados). Orden ASC por fecha_inicio:
  // [0] = PRIMER contrato (continuidad laboral, spec §2.4).
  const { data: contratos } = await supabase
    .from('contratos')
    .select('id, fecha_inicio, sueldo_base, vigente')
    .eq('empresa_id', activa.id)
    .eq('trabajador_id', id)
    .order('fecha_inicio', { ascending: true })
  const vigente = (contratos ?? []).find((c) => c.vigente)
  const primero = (contratos ?? [])[0]

  // Finiquito no-anulado más RECIENTE del trabajador (puede haber más de uno
  // con recontrataciones: el unique parcial es por contrato — jamás
  // maybeSingle, que con 2 filas daría PGRST116).
  const { data: fins } = await supabase
    .from('finiquitos')
    .select('*')
    .eq('empresa_id', activa.id)
    .eq('trabajador_id', id)
    .neq('estado', 'anulado')
    .order('emitido_en', { ascending: false })
    .limit(1)
  const fin = (fins ?? [])[0]

  // Contrato vigente SIN finiquito propio → FORMULARIO (cubre al recontratado:
  // su finiquito viejo queda como historia y no bloquea la nueva emisión).
  const emitible = vigente != null && (!fin || fin.contrato_id !== vigente.id)

  if (fin && !emitible) {
    // ---------- DETALLE: documento imprimible (patrón liquidaciones/[id]) ----------
    const { data: asiento } = await supabase
      .from('asientos')
      .select('id, numero')
      .eq('empresa_id', activa.id)
      .eq('origen', 'finiquito')
      .eq('referencia_id', fin.id)
      .maybeSingle()

    return (
      <div>
        <div className="print:hidden">
          <Encabezado titulo={`Finiquito — ${trabajador.nombre}`}>
            <Insignia tono={TONO_FINIQUITO[fin.estado] ?? 'gris'}>
              {ETIQUETA_FINIQUITO[fin.estado] ?? fin.estado}
            </Insignia>
            <BotonImprimir />
          </Encabezado>
        </div>

        <div className="mb-4 hidden print:block">
          <h1 className="text-xl font-bold">{activa.razon_social}</h1>
          <p className="text-sm text-slate-600">{formatearRut(activa.rut)}</p>
          <h2 className="mt-2 text-lg font-semibold">FINIQUITO DE CONTRATO DE TRABAJO</h2>
        </div>

        <Tarjeta className="mb-4 max-w-3xl">
          <p><strong>Empleador:</strong> {activa.razon_social} ({formatearRut(activa.rut)})</p>
          <p className="mt-1"><strong>Trabajador:</strong> {trabajador.nombre} ({formatearRut(trabajador.rut)})</p>
          <p className="mt-1 text-sm text-slate-600">
            Causal: {ETIQUETA_CAUSAL[fin.causal] ?? fin.causal} · Fecha de término: {fmtFecha(fin.fecha_termino)}
          </p>
          {/* Snapshot de contexto (spec §2.5): el finiquito se explica solo aunque
              cambien contrato o indicadores. */}
          <p className="mt-1 text-sm text-slate-600">
            Sueldo base: {formatearCLP(fin.sueldo_base)} · UF del período: {formatearCLP(fin.uf)}
            {fin.causal === 'necesidades_empresa' && <> · Aviso previo: {fin.aviso_dado ? 'dado' : 'no dado'}</>}
          </p>
          {fin.emitido_en && (
            <p className="mt-1 text-sm text-slate-600">
              Emitido el {new Date(fin.emitido_en).toLocaleDateString('es-CL')}
              {fin.pagado_en && <> · Pagado el {new Date(fin.pagado_en).toLocaleDateString('es-CL')}</>}
            </p>
          )}
          {fin.comentario && <p className="mt-1 text-sm text-slate-600">Comentario: {fin.comentario}</p>}
        </Tarjeta>

        <Tarjeta className="max-w-3xl">
          <h3 className="mb-2 border-b border-slate-200 pb-1 text-sm font-semibold uppercase text-slate-600">
            Desglose
          </h3>
          <Linea
            concepto={`Indemnización por años de servicio (${fin.anos_servicio} ${fin.anos_servicio === 1 ? 'año' : 'años'})`}
            monto={fin.indemnizacion_anos}
          />
          <Linea concepto="Indemnización sustitutiva del aviso previo" monto={fin.indemnizacion_aviso} />
          <Linea
            concepto={`Feriado proporcional (${Number(fin.feriado_dias).toLocaleString('es-CL')} días)`}
            monto={fin.feriado_monto}
          />
          <Linea concepto="Otros haberes" monto={fin.otros_haberes} />
          <Linea concepto="Otros descuentos" monto={-fin.otros_descuentos} />
        </Tarjeta>

        <div className="mt-4 flex max-w-3xl items-center justify-between rounded-md bg-slate-100 px-4 py-3 text-xl font-semibold">
          <span>TOTAL FINIQUITO</span>
          <span className="font-mono">{formatearCLP(fin.total)}</span>
        </div>

        {/* Nota v1 DECLARADA (spec §3.5): sale también en la impresión. */}
        <p className="mt-3 max-w-3xl text-xs text-slate-500">
          Simplificación v1: el feriado se calcula sobre el saldo en días hábiles, sin conversión a
          días corridos y sin cotizaciones previsionales; el contador puede ajustar la diferencia
          con un asiento manual.
        </p>

        {/* Línea de firmas: solo tiene sentido en el papel. */}
        <div className="mt-16 hidden max-w-3xl grid-cols-2 gap-16 print:grid">
          <div className="border-t border-slate-500 pt-2 text-center text-sm">
            <p>{activa.razon_social}</p>
            <p className="text-slate-600">Empleador</p>
          </div>
          <div className="border-t border-slate-500 pt-2 text-center text-sm">
            <p>{trabajador.nombre}</p>
            <p className="text-slate-600">Trabajador</p>
          </div>
        </div>

        <div className="mt-6 max-w-3xl print:hidden">
          {asiento ? (
            <p className="text-sm text-slate-600">
              Contabilizado en el{' '}
              <Link className="text-marca-700 hover:underline" href={`/contabilidad/asientos/${asiento.id}`}>
                Asiento N° {asiento.numero}
              </Link>.
            </p>
          ) : (
            <p className="text-sm text-slate-500">
              Sin asiento contable todavía: se genera con Contabilizar pendientes si el módulo de
              contabilidad está activo.
            </p>
          )}
        </div>

        <div className="mt-4 print:hidden">
          <AccionesFiniquito finiquitoId={fin.id} trabajadorId={trabajador.id} estado={fin.estado} />
        </div>
      </div>
    )
  }

  // ---------- FORMULARIO: contrato vigente sin finiquito propio ----------
  // (contratos/vigente/primero ya cargados arriba, antes de la decisión.)
  if (!vigente || !primero) {
    return (
      <div>
        <Encabezado titulo={`Finiquito — ${trabajador.nombre}`} />
        <Tarjeta className="max-w-xl">
          <p className="text-slate-600">
            El trabajador no tiene contrato vigente.{' '}
            <Link className="text-marca-700 hover:underline" href={`/trabajadores/${trabajador.id}`}>
              Volver a la ficha
            </Link>.
          </p>
        </Tarjeta>
      </div>
    )
  }

  const [{ data: tomas }, { data: inds }] = await Promise.all([
    supabase
      .from('vacaciones_tomadas')
      .select('dias_habiles')
      .eq('empresa_id', activa.id)
      .eq('trabajador_id', id),
    // UF por período (últimos 12, patrón liquidaciones/generar): la preview
    // resuelve la UF con el período de la fecha de término elegida.
    supabase
      .from('indicadores_previsionales')
      .select('periodo, uf')
      .order('periodo', { ascending: false })
      .limit(12),
  ])
  const diasTomados = (tomas ?? []).reduce((s, t) => s + t.dias_habiles, 0)
  const ufPorPeriodo = Object.fromEntries((inds ?? []).map((i) => [i.periodo, i.uf]))

  return (
    <div>
      <Encabezado titulo={`Emitir finiquito — ${trabajador.nombre}`} />
      <FormularioFiniquito
        trabajador={{ id: trabajador.id, nombre: trabajador.nombre, rut: trabajador.rut }}
        fechaInicioPrimerContrato={primero.fecha_inicio}
        sueldoBase={vigente.sueldo_base}
        diasTomados={diasTomados}
        ufPorPeriodo={ufPorPeriodo}
      />
    </div>
  )
}
```

- [ ] **Step 7: Botón y corte del devengo en la ficha (SOBRE la versión de T5; la lista NO se toca)**

Tres ediciones sobre `apps/erp/app/trabajadores/[id]/page.tsx` (los old_string son EXACTAMENTE los que dejó T5 Paso 6):

**7a — imports** (Link + Boton):

old_string:
```tsx
import { notFound } from 'next/navigation'
```

new_string:
```tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
```

y old_string:
```tsx
import { Encabezado, Insignia, Tabla, Tarjeta, Td, Th, Tr } from '@suite/ui'
```

new_string:
```tsx
import { Boton, Encabezado, Insignia, Tabla, Tarjeta, Td, Th, Tr } from '@suite/ui'
```

**7b — query del finiquito + corte del devengo** (cierra la costura declarada por T5):

old_string:
```tsx
  const hoy = new Date().toISOString().slice(0, 10)
  // Costura Task 6: con finiquito no-anulado el devengo corta en su
  // fecha_termino; mientras la emisión no exista (Task 6) se devenga a hoy.
  const vac = primerContrato
    ? calcularVacaciones(primerContrato.fecha_inicio, hoy, totalTomados)
    : null
```

new_string:
```tsx
  // Finiquito no-anulado más RECIENTE (el unique parcial es POR CONTRATO:
  // recontratar tras finiquitar deja más de uno por trabajador — jamás
  // maybeSingle, que con 2 filas daría PGRST116): manda la insignia, el botón
  // del encabezado y el corte del devengo (spec §2.4).
  const { data: finsData } = await supabase
    .from('finiquitos')
    .select('id, estado, fecha_termino, contrato_id')
    .eq('empresa_id', activa.id)
    .eq('trabajador_id', id)
    .neq('estado', 'anulado')
    .order('emitido_en', { ascending: false })
    .limit(1)
  const fin = (finsData ?? [])[0]

  const hoy = new Date().toISOString().slice(0, 10)
  // Con finiquito no-anulado el devengo corta en su fecha de término (spec §2.4).
  const corte = fin?.fecha_termino ?? hoy
  const vac = primerContrato
    ? calcularVacaciones(primerContrato.fecha_inicio, corte, totalTomados)
    : null
```

**7c — Encabezado con insignia y botón** (visible para los 3 roles RRHH; la RPC re-valida igual):

old_string:
```tsx
      <Encabezado titulo={trabajador.nombre}>
        {!trabajador.activo && <Insignia tono="gris">Inactivo</Insignia>}
      </Encabezado>
```

new_string:
```tsx
      <Encabezado titulo={trabajador.nombre}>
        {!trabajador.activo && <Insignia tono="gris">Inactivo</Insignia>}
        {fin && <Insignia tono="rojo">Finiquitado</Insignia>}
        {/* MISMA decisión por CONTRATO que la página del finiquito: contrato
            vigente sin finiquito propio → Emitir (cubre al recontratado, cuyo
            finiquito viejo es solo historia); si no y hay finiquito → Ver. */}
        {vigente && fin?.contrato_id !== vigente.id ? (
          <Link href={`/trabajadores/${trabajador.id}/finiquito`}>
            <Boton variante="secundario">Emitir finiquito</Boton>
          </Link>
        ) : (
          fin && (
            <Link href={`/trabajadores/${trabajador.id}/finiquito`}>
              <Boton variante="secundario">Ver finiquito</Boton>
            </Link>
          )
        )}
      </Encabezado>
```

(`apps/erp/app/trabajadores/page.tsx` NO se toca: la insignia «Finiquitado» y el orden ya los dejó T5 con la query de ids + Set — Global Constraints.)

- [ ] **Step 8: Verificación (build) + byte-scan**

```powershell
pnpm --filter erp build
```

→ compila sin errores y el listado de rutas incluye `ƒ /trabajadores/[id]/finiquito`.

Byte-scan sin BOM de los archivos tocados (imprime `0` por archivo y exit 1 = pass):

```bash
grep -c $'\xEF\xBB\xBF' "apps/erp/app/trabajadores/[id]/finiquito/page.tsx" "apps/erp/app/trabajadores/[id]/finiquito/acciones.ts" apps/erp/componentes/formulario-finiquito.tsx apps/erp/componentes/acciones-finiquito.tsx apps/erp/app/trabajadores/catalogos.ts apps/erp/lib/contabilidad.ts apps/erp/app/contabilidad/origenes.ts apps/erp/app/contabilidad/asientos/page.tsx "apps/erp/app/trabajadores/[id]/page.tsx"
```

- [ ] **Step 9: Commit**

```bash
git add apps/erp
git commit -m "feat(erp): finiquito con vista previa en vivo, documento imprimible y asiento automático

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---
### Task 7: Seed — vacaciones de Amanda + pipeline verde + E2E Playwright (task final)

**Files:**
- Modify: `scripts/seed-demo.mjs` (ÚNICO archivo de producción de esta task; el resto son comandos y verificación). **La migración de los inserts de trabajadores del seed a los 3 campos de nombre ES DE ESTA TASK** (T1-T6 no tocaron el seed) y **el contrato de Bruno gana `isapre: 'colmena'` en el Step 1b**.

**Interfaces:**
- Consumes (seed): sección 22 del P18/P19 (trabajadores/contratos G1-G3, canario G1, `userCli`, `die`), tabla `vacaciones_tomadas` (RLS INSERT dueno/admin — migración 0027, T1), columnas `nombres/apellido_paterno/apellido_materno` NOT NULL en `trabajadores` y `contratos.isapre` (T1).
- Consumes conteos contractuales del plan: pgTAP **435 en 20 archivos**, unit **229**.
- Produces: sección 23 (1 toma de vacaciones de Amanda, 5 días hábiles) + línea nueva del RESUMEN. **SIN finiquitos sembrados** (spec §7: el flujo se vive en el E2E; la demo conserva sus 3 trabajadores activos).
- **Golden E2E del finiquito de Amanda** (datos REALES del seed; única fuente del ítem 4 del checklist): contrato único `2025-03-01`, sueldo 800.000, causal `necesidades_empresa`, aviso NO dado, término `2026-07-31`, 5 días tomados (seed), UF 2026-07 = 39.350 (migración 0025):
  - `anos_servicio = 1` (age(2026-07-31, 2025-03-01) = **1a 4m 30d**; la fracción de 4m30d ≤ 6 meses NO suma)
  - `base = min(800.000, round(90 × 39.350) = 3.541.500) = 800.000` (el tope no muerde)
  - `indemnizacion_anos = 800.000 × 1 = 800.000`
  - `indemnizacion_aviso = 800.000` (necesidades_empresa sin aviso)
  - feriado: `devengados = 16 meses completos × 1,25 = 20,00` − 5 tomados = `feriado_dias = 15,00` → `feriado_monto = round(800.000 × 15 / 30) = 400.000` (exacto: no toca el borde .5)
  - `total = 800.000 + 800.000 + 400.000 = 2.000.000`
  Los devengados de la ficha valen 20,00 durante TODO julio 2026 (16 meses completos al día 1); si la demo se corre en otro mes, recalcular antes de exigir los números.

- [ ] **Step 1: Seed — 3 campos de nombre, isapre de Bruno y sección 23**

**(a)** Sección 22, insert de `trabajadores` (líneas 496-500, verbatim del archivo real — verificado). Con la 0027 `nombres` y `apellido_paterno` quedan NOT NULL: el insert actual (solo `nombre`) MORIRÍA en el reseed. Reemplazar por:

old_string:
```js
const { data: trabs, error: eTrab } = await userCli.from('trabajadores').insert([
  { empresa_id: empresaId, rut: '153312044', nombre: 'Amanda Rojas Fuentes', email: 'amanda.rojas@demotransportes.cl', telefono: '+56 9 5544 3322' },
  { empresa_id: empresaId, rut: '174065926', nombre: 'Bruno Castillo Mena', email: 'bruno.castillo@demotransportes.cl' },
  { empresa_id: empresaId, rut: '128834753', nombre: 'Carla Núñez Paredes', email: 'carla.nunez@demotransportes.cl' },
]).select('id, rut')
```

new_string:
```js
const { data: trabs, error: eTrab } = await userCli.from('trabajadores').insert([
  { empresa_id: empresaId, rut: '153312044', nombre: 'Amanda Rojas Fuentes', nombres: 'Amanda', apellido_paterno: 'Rojas', apellido_materno: 'Fuentes', email: 'amanda.rojas@demotransportes.cl', telefono: '+56 9 5544 3322' },
  { empresa_id: empresaId, rut: '174065926', nombre: 'Bruno Castillo Mena', nombres: 'Bruno', apellido_paterno: 'Castillo', apellido_materno: 'Mena', email: 'bruno.castillo@demotransportes.cl' },
  { empresa_id: empresaId, rut: '128834753', nombre: 'Carla Núñez Paredes', nombres: 'Carla', apellido_paterno: 'Núñez', apellido_materno: 'Paredes', email: 'carla.nunez@demotransportes.cl' },
]).select('id, rut')
```

(`nombre` se conserva compuesto a mano — misma composición que `nombreCompleto` de core, spec §2.1.)

**(b)** Sección 22, contrato de Bruno (líneas 507-508): gana la isapre del catálogo (spec §2.2; sin ella el TXT Previred mostraría `0` y el ítem 7 del E2E no tendría qué demostrar). Solo se agrega el campo:

old_string:
```js
  // G2: Isapre plazo fijo capital 1.200.000 plan 5,0 UF (plan > 7%; sin cesantía del trabajador)
  { empresa_id: empresaId, trabajador_id: bruno, tipo: 'plazo_fijo', fecha_inicio: '2026-01-01', fecha_termino: '2026-12-31', cargo: 'Coordinador logístico', sueldo_base: 1200000, gratificacion_legal: true, afp: 'capital', salud: 'isapre', plan_isapre_uf: 5.0 },
```

new_string:
```js
  // G2: Isapre plazo fijo capital 1.200.000 plan 5,0 UF (plan > 7%; sin cesantía del trabajador)
  { empresa_id: empresaId, trabajador_id: bruno, tipo: 'plazo_fijo', fecha_inicio: '2026-01-01', fecha_termino: '2026-12-31', cargo: 'Coordinador logístico', sueldo_base: 1200000, gratificacion_legal: true, afp: 'capital', salud: 'isapre', plan_isapre_uf: 5.0, isapre: 'colmena' },
```

**(c)** Sección 23 nueva, entre la línea `console.log('✓ remuneraciones: ...')` (533) y `// ----- Resumen de conteos -----` (535):

```js
// 23) Vacaciones (Plan 20): 1 toma de 5 días hábiles para Amanda (2026-06-08 →
//     2026-06-12: junio 2026 parte lunes; lunes a viernes = 5 hábiles) VÍA
//     userCli (RLS INSERT dueno/admin). SIN finiquitos sembrados: el flujo
//     emitir → pagar/anular se vive en el E2E y la demo conserva sus 3
//     trabajadores activos (spec §7). El saldo de Amanda queda 20,00 − 5 = 15,00
//     durante julio 2026 (golden del E2E).
const { error: eVac } = await userCli.from('vacaciones_tomadas').insert({
  empresa_id: empresaId, trabajador_id: amanda, desde: '2026-06-08', hasta: '2026-06-12', dias_habiles: 5, comentario: 'Vacaciones de invierno',
})
if (eVac) die('vacaciones_tomadas Amanda', eVac)
console.log('✓ vacaciones: 1 toma de Amanda (5 días hábiles, 2026-06)')
```

**(d)** RESUMEN — línea nueva inmediatamente bajo `console.log('liquidaciones:        ', await cuenta('liquidaciones'))` (línea 560):

```js
console.log('vacaciones tomadas:   ', await cuenta('vacaciones_tomadas'))
```

Byte-scan anti-BOM (imprime `0` y sale con status 1 = pass):

```bash
grep -c $'\xEF\xBB\xBF' scripts/seed-demo.mjs
```

- [ ] **Step 2: Pipeline completo**

Desde la raíz (PowerShell 5.1: separar con `;`, nunca `&&`):

```powershell
npx supabase test db
```

→ **20 archivos, 435 asserts** (`finiquitos.test.sql` de la Task 3 incluido), todos verdes.

```powershell
pnpm test
```

→ **229 tests** verdes (espejos finiquito/vacaciones + Previred con apellidos/isapre; los tests de `separarNombre` ya no existen).

```powershell
pnpm --filter @suite/db gen
git diff --exit-code packages/db/src/types.ts
```

→ exit 0, **cero diff**: los tipos a mano son espejo byte a byte del generador. Si hubiera diff, gana el generador: commitear su salida y volver a correr los builds.

```powershell
pnpm build --concurrency=1
```

→ **3 apps** (`web`, `erp`, `admin`) compilan sin errores. Gotcha conocido: el build **pisa el `.next` de los dev servers** → el Step 4 los reinicia SIEMPRE.

- [ ] **Step 3: Reseed de la demo (la suite pgTAP puede haberla borrado)**

```powershell
npx supabase db reset
```

→ termina con `Finished supabase db reset` (aplica 0001..0027 — la 0027 agrega apellidos, isapre, vacaciones_tomadas y finiquitos).

Gotcha Kong 502 tras el reset — curarlo SIEMPRE, es barato:

```powershell
docker restart supabase_kong_ERP_Transportes; Start-Sleep -Seconds 8
```

Cargar la clave DTE desde `apps/erp/.env.local` **sin imprimirla** (la asignación a `$env:` no emite salida; NO hacer `echo` de la variable) y sembrar:

```powershell
$env:DTE_ENCRYPTION_KEY = ((Get-Content apps/erp/.env.local | ? { $_ -like 'DTE_ENCRYPTION_KEY=*' }) -split '=',2)[1]
node scripts/seed-demo.mjs
```

→ el seed corre COMPLETO (secciones 1-23, Node ≥22): el insert de trabajadores pasa con los 3 campos, el canario G1 sigue verde y la salida incluye:

```
✓ remuneraciones: 3 trabajadores + contratos (G1-G3), 3 liquidaciones 2026-06 emitidas (Carla pagada) + 3 asientos
✓ vacaciones: 1 toma de Amanda (5 días hábiles, 2026-06)
```

y el RESUMEN suma `vacaciones tomadas:    1` (trabajadores 3 / liquidaciones 3 intactos).

- [ ] **Step 4: Reiniciar los dev servers (`.next` pisado por el build)**

```powershell
Get-NetTCPConnection -LocalPort 3000,3001,3002 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -Confirm:$false }
try { Remove-Item -Recurse -Force apps/web/.next, apps/erp/.next, apps/admin/.next -ErrorAction Stop } catch {}
Start-Process pnpm.cmd -ArgumentList '--filter','web','dev'
Start-Process pnpm.cmd -ArgumentList '--filter','erp','dev'
Start-Process pnpm.cmd -ArgumentList '--filter','admin','dev'
```

→ web 3000, erp 3001, admin 3002; esperar a que `http://localhost:3001` responda (primer compile ~10-30s).

- [ ] **Step 5: E2E manual con Playwright MCP (7 puntos, evidencia por punto)**

Login en `http://localhost:3000/login` con `demo@suite-erp.cl` / `demo1234`. Documentar la evidencia de CADA ítem en el reporte; cualquier fallo = defecto real → **BLOCKED** (no se maquilla el checklist).

1. **Reseed ok**: evidencia = salida del Step 3 (canario G1 verde + `✓ vacaciones: 1 toma de Amanda (5 días hábiles, 2026-06)` + `vacaciones tomadas:    1` en el RESUMEN); citarla en el reporte.
2. **Ficha de Amanda — apellidos separados + card Vacaciones**: `http://localhost:3001/trabajadores` → Amanda Rojas Fuentes. Evidencia: (a) el formulario muestra los 3 campos con `Amanda` / `Rojas` / `Fuentes` (ya NO un campo único "Nombre"); (b) la card Vacaciones muestra devengados `20` (formato es-CL de la Task 5), tomados `5`, saldo `15` — y la toma del seed (08-06-2026 → 12-06-2026, 5 días) en la lista.
3. **Registrar una toma nueva → saldo baja (y se limpia)**: registrar desde `2026-07-06` hasta `2026-07-07`, 2 días hábiles → el saldo baja a `13`. Evidencia: snapshot con saldo 13. Luego **eliminar** esa toma desde la lista → el saldo vuelve a `15`. (Ejercita también el DELETE directo del spec §2.3 y deja el golden del ítem 4 con 5 días tomados.)
4. **Emitir finiquito — preview = emisión (golden)**: en la ficha, botón **Emitir finiquito** → `/trabajadores/[id]/finiquito`. Causal `Necesidades de la empresa (art. 161)` (el checkbox de aviso APARECE al elegirla y desaparece con cualquier otra causal — evidencia de visibilidad condicional), fecha término `2026-07-31`, aviso NO marcado, otros 0/0. La vista previa muestra el golden: indemnización años `$800.000` (1 año, base 800.000), aviso previo `$800.000`, feriado `$400.000` (15 días), **TOTAL `$2.000.000`** — ANOTAR los números → **Emitir** → el DETALLE muestra exactamente los números anotados (espejo TS = RPC SQL; si divergen es bug, BLOCKED) con el documento imprimible: empleador/trabajador con RUT, causal con artículo, desglose, total destacado, y — **evidencia OBLIGATORIA del ítem** — la vista de impresión del navegador mostrando la línea de firmas (empleador/trabajador) y la nota de simplificación v1 (ambas salen en el papel; sin este snapshot el ítem no se marca).
5. **Asiento de 2 líneas + insignia en la lista**: la traza «Asiento N°» del detalle abre `/contabilidad/asientos/[id]` con origen «Finiquito» y **2 líneas cuadradas** (debe = haber = `2.000.000`): debe **«Indemnizaciones» (5.1.07)** `2.000.000`, haber **«Finiquitos por pagar» (2.1.08)** `2.000.000` (anclas del catálogo 33/18 de la Task 1). En `/contabilidad/asientos`, el filtro de origen ofrece «Finiquito» y lo lista. En `/trabajadores` con **Ver inactivos** marcado: Amanda aparece Inactiva + insignia **Finiquitado** (y al final de la página — sort de T5).
6. **Anular → reactivación + reversa**: en el detalle del finiquito, Anular con motivo `Prueba E2E: reversa y reactivación` (la advertencia declara la reactivación). Evidencia: (a) la ficha de Amanda muestra el contrato **Vigente** de nuevo y a la trabajadora Activa, sin insignia Finiquitado; (b) el asiento del finiquito muestra su reversa ligada (glosa `Anulación finiquito Amanda Rojas Fuentes`); (c) `/trabajadores/[id]/finiquito` vuelve a mostrar el FORMULARIO (re-emitir posible). La demo queda canónica: 3 trabajadores activos.
7. **TXT Previred — apellidos + código isapre**: con `browser_run_code_unsafe` (misma sesión):

   ```js
   const r = await fetch('/libro-remuneraciones/previred?periodo=2026-06');
   const t = await r.text();
   const lineas = t.split('\r\n').filter(Boolean);
   const fila = Object.fromEntries(lineas.map((l) => { const c = l.split(';'); return [c[0], c]; }));
   return {
     lineas: lineas.length,
     amanda_apellidos: fila['15331204'].slice(2, 5),
     bruno_apellidos: fila['17406592'].slice(2, 5),
     amanda_salud: fila['15331204'][74],
     bruno_salud: fila['17406592'][74],
   };
   ```

   → `{ lineas: 3, amanda_apellidos: ['Rojas','Fuentes','Amanda'], bruno_apellidos: ['Castillo','Mena','Bruno'], amanda_salud: '7', bruno_salud: '4' }`.
   Los apellidos/nombres van en los **campos 3-5** del formato de 105 (índices 2-4 del split — spec §5 ya enmendado por el ensamblador); el código de institución de salud es el **campo 75 (índice 74)**: `7` Fonasa (Amanda), `4` Colmena (Bruno, `isapre: 'colmena'` del seed — ya NO `0`).

- [ ] **Step 6: Solo el seed cambia en git**

```powershell
git status --porcelain
```

→ exactamente una línea: ` M scripts/seed-demo.mjs`. Si aparece `packages/db/src/types.ts` es que el Step 2 encontró diff (ya commiteado ahí); cualquier otro archivo es un desborde de la task.

- [ ] **Step 7: Commit**

```bash
git add scripts/seed-demo.mjs
git commit -m "feat(scripts): seed con apellidos separados, isapre de Bruno y vacaciones de Amanda

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 8: Reporte y cleanup**

`.superpowers/sdd/task-7-plan20-report.md` con: pipeline (**435 pgTAP en 20 archivos / 229 unit** / 3 builds / diff-cero de tipos), la salida del reseed y el checklist E2E ítem por ítem con su evidencia (equivalencia preview = emisión del ítem 4 con el TOTAL `2.000.000` + la vista de impresión con firmas y nota v1, las 2 líneas del ítem 5, la reactivación + reversa del ítem 6 y el objeto del ítem 7). Nada que borrar del scratchpad.

---

## Seams abiertos para los lentes

1. **age() bug-for-bug (costura a, decisión documentada):** el espejo TS replica el préstamo de `age()` de Postgres (días del MES DE INICIO). En el borde de fin de mes ambos lados coinciden entre sí pero difieren de la aritmética `+1 month` (ej.: 2023-01-31 → 2023-02-28 = 0 meses completos). Si una versión futura de Postgres cambiara `age()`, la divergencia la detectan los goldens pgTAP (la verdad), no los unit.
2. **Códigos de Isapre v1 representativos** (spec §2.2): se validan contra Previred al tener cuenta real — igual que los códigos AFP.
3. **Contratos isapre legados** con `isapre` null → TXT campo 75 = `0` (límite declarado del spec §2.2; el formulario solo exige isapre en contratos nuevos).
4. **Sin validación de solape de vacaciones** (v1, spec §2.3): dos tomas superpuestas restan doble; corregir = eliminar y re-crear.
5. **Feriado sin conversión hábiles→corridos ni cotizaciones** (simplificación v1 declarada, visible en el documento y en la vista previa).
6. **Orden «finiquitados al final» por página** (T5): el sort es en JS sobre las 25 filas; la paginación SQL sigue por nombre. Con >25 trabajadores un finiquitado puede aparecer en una página intermedia al final de ESA página.
7. **Asiento de finiquito sin link al documento** (`rutaOrigen`): `referencia_id` es el id del finiquito y la ruta necesita el id del TRABAJADOR — no derivable desde el asiento sin query extra; misma decisión que compra/pago/anticipo. Si molesta, un lente puede resolverlo con un lookup en el detalle del asiento.
8. **Assert 16 de T3 depende de la rama defensiva del duplicado en `emitir_finiquito`** (chequeo amable + backstop 23505): si un lente la considera código muerto y la borra, el assert cae y plan(36) baja — NO es código muerto, protege el estado contrato-reabierto-a-mano. *Dictamen de los lentes: la rama se mantiene.*
9. **Devengados del E2E (20,00 de Amanda) valen solo durante julio 2026**: la ficha devenga a `hoy` — si la demo se corre en otro mes, recalcular los números del checklist antes de exigirlos.
10. **RESUELTO por los lentes (2 de 3 lo exigieron):** `emitir_finiquito` ahora valida `p_fecha_termino < v_inicio` tras calcular `v_inicio` → raise `'La fecha de término no puede ser anterior al inicio del primer contrato'` (Global Constraints); el espejo TS lanza el MISMO mensaje en `calcularFiniquito`. Cubierto por el throws_ok 9 de pgTAP (con la fixture `'2022-12'`) y por 1 unit de T4; el mensaje entra a `ERRORES_EMITIR` en T6.
11. **Backfill de apellidos con nombres de 1 palabra** deja `apellido_paterno = ''` (borde teórico declarado, paridad con `separarNombre`); un lente podría preferir un NOT NULL + CHECK de no-vacío en una migración futura. *Dictamen de los lentes: SIGUE ABIERTO — borde teórico aceptado en v1 (los datos reales siempre traen ≥ 2 palabras); el backfill ahora sí queda verificado en suite permanente (asserts 35-36 de T3).*
12. **`pagar_finiquito` no mueve plata** (igual que `pagar_liquidacion`): el pago real (asiento de banco contra `finiquitos_por_pagar`) queda como asiento manual del contador — fuera del alcance del plan.
