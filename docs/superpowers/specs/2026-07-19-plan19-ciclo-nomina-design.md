# Plan 19 — Ciclo mensual de nómina completo (Fase 3 RRHH, parte 2) · diseño

**Fecha:** 2026-07-19 · **Estado:** aprobado por el usuario (diseño conversacional) · **Alcance:** un plan (~7-8 tasks)

## 1. Objetivo

Cerrar el ciclo mensual de nómina: **aportes del empleador** (SIS, cesantía patronal, mutual) con costo empresa visible y contabilizado, **archivo PREVIRED** (TXT 105 campos) para declarar, y los **candados de integridad** diferidos del P18. Finiquitos y vacaciones → Plan 20.

Decisiones del usuario (AskUserQuestion 2026-07-19):
- Alcance: **ciclo mensual completo** (aportes + Previred + integridad); finiquitos/vacaciones → Plan 20.
- Mutual ley 16.744: **sí, tasa configurable por empresa** (default 0,90%).

## 2. Modelo de datos (migración 0026)

- `indicadores_previsionales` gana **`tasa_sis numeric(5,2) not null default 1.53`** (% sobre imponible; varía por licitación — el admin la mantiene). Backfill: los períodos existentes quedan en 1.53.
- `empresas` gana **`tasa_mutual numeric(4,2) not null default 0.90`** con `check (tasa_mutual between 0 and 10)` (base 0,90% + adicional por actividad). Grant de UPDATE por columna a authenticated (la policy de fila ya limita a dueño/admin — patrón `factor_volumetrico`).
- Cesantía del empleador: **constantes de ley en el cálculo** (2,4% indefinido / 3,0% plazo fijo), como el 0,6% del trabajador. No van a indicadores.
- `liquidaciones` gana el snapshot de aportes (todo integer CLP, `not null default 0` — las liquidaciones pre-P19 quedan en 0, límite declarado): `sis_monto, cesantia_empleador_monto, mutual_monto, total_aportes`, y el snapshot de contexto gana `tasa_sis numeric(5,2) not null default 0` y `tasa_mutual numeric(4,2) not null default 0`.

## 3. Cálculo de aportes (extiende §3 del spec P18; SQL autoritativo + espejo TS)

Reglas nuevas (9-12), con las mismas bases topadas del P18:
9. `sis_monto = round(total_imponible * tasa_sis / 100)`.
10. `cesantia_empleador_monto = round(min(total_imponible, round(tope_cesantia_uf * uf)) * (tipo = 'indefinido' ? 2.4 : 3.0) / 100)` (misma base que la cesantía del trabajador; a diferencia de ella, plazo fijo SÍ cotiza — 3,0%).
11. `mutual_monto = round(total_imponible * tasa_mutual / 100)` (tasa de la EMPRESA, snapshoteada).
12. `total_aportes = sis + cesantia_empleador + mutual`. Los aportes NO afectan el líquido del trabajador (son costo empresa).

**Los 4 goldens del P18 ganan la capa de aportes** (con `tasa_sis 1.53` y `tasa_mutual 0.90` canónicas) y deben quedar idénticos en las 3 capas (SQL smoke, pgTAP, vitest) — el plan fija los montos exactos con la aritmética mostrada. `emitir_liquidacion` re-creada además **valida trabajador activo** (`'El trabajador está desactivado'` — minor diferido P18) y snapshotea `tasa_sis`/`tasa_mutual`. El espejo `calcularLiquidacion` gana los campos de aportes en `ResultadoLiquidacion` y los inputs necesarios (`tasa_sis` en `IndicadoresPeriodo`, `tasa_mutual` en `ContratoCalculo` o parámetro — el plan fija la firma y actualiza el único consumidor: la preview).

## 4. Integración contable

- 2 cuentas ancla nuevas (catálogo **31 cuentas / 16 anclas**): `gasto_leyes_sociales` (grupo 5, gasto) y `leyes_sociales_por_pagar` (grupo 2, pasivo) — códigos fijados por el plan mirando el catálogo real; sembradas en `activar_contabilidad` (re-create) + backfill híbrido (patrón P18). Los asserts existentes que cuentan anclas se parchean 14→16 (el plan los ubica por grep).
- Rama `'remuneracion'` de `contabilizar_documento` (re-create) ampliada: debe `gasto_remuneraciones` (imponible + no imponibles), **debe `gasto_leyes_sociales` (total_aportes)**, haber `remuneraciones_por_pagar` (líquido), haber `retenciones_por_pagar` (descuentos), **haber `leyes_sociales_por_pagar` (total_aportes)**. Cuadra por construcción; con `total_aportes = 0` (liquidaciones pre-P19 en catch-up) las 2 líneas nuevas se omiten y el asiento queda como en P18.
- **Regla 6 del auditor** (`revision_periodo` re-creada): el union de `asientos_tardios` gana el origen `'remuneracion'` (fecha del documento = último día del período de la liquidación) — cierra el minor diferido P18.

## 5. Archivo PREVIRED

- `packages/core/src/previred.ts`: `generarPrevired(filas): string` — archivo plano de **105 campos separados por `;`** (formato público "Archivo de carga masiva" de previred.com), una línea por liquidación no-anulada del período, CRLF, sin BOM. TDD con líneas doradas completas.
- Campos poblados v1: RUT/DV, nombres y apellidos (heurística declarada sobre `trabajadores.nombre`: última(s) 2 palabras = apellidos paterno/materno, el resto = nombres; con 2 palabras: nombre + paterno), código de movimiento 0 (sin novedades), días trabajados, **código AFP Previred** (tabla fija: capital 33, cuprum 3, habitat 14, modelo 34, planvital 29, provida 8, uno 35), renta imponible AFP, cotización obligatoria (afp_monto), SIS, renta y aporte cesantía (trabajador + empleador), **salud**: Fonasa código 7 con 7% / Isapre **código 0 genérico** + monto pactado (límite declarado: no almacenamos CUÁL isapre — catálogo de isapres → Plan 20), mutual. El resto de los 105 campos en vacío/cero según el estándar. El usuario puede ajustar el TXT antes de subirlo; la validación real la hará Previred al cargarlo.
- Botón **"Archivo Previred"** en `/libro-remuneraciones` → route `/libro-remuneraciones/previred?periodo=` (descarga .txt, guards en paridad con el export CSV).

## 6. Candados de integridad (admin /indicadores — minors P18)

`guardarPeriodo` endurece `leerTramos` y las tasas: tasas AFP y SIS **≤ 100**; tramos: el primero parte en `desde = 0`, **contiguos** (`hasta[i] = desde[i+1]`, sin huecos ni solapes), solo el último con `hasta` vacío (null). Mensajes de error claros por campo. La UI de admin gana el campo tasa SIS.

## 7. UI

- **Detalle de liquidación**: sección "Costo empresa" (aportes desglosados + **costo total empresa** = imponible + no imponibles + aportes); reemplaza la nota v1 "no incluye aportes del empleador". Las liquidaciones antiguas (aportes 0) muestran la nota "emitida antes de los aportes del empleador".
- **Libro de remuneraciones**: columnas nuevas (SIS, cesantía empleador, mutual, costo empresa) en tabla y CSV; botón Previred.
- **Vista previa** (generar): el desglose gana el bloque de costo empresa (espejo TS).
- **Configuración → Módulos**: card "Remuneraciones" con la tasa mutual editable (dueño/admin; validación 0-10 espejo del CHECK).
- **Admin /indicadores**: campo tasa SIS + validaciones §6.

## 8. Seed y tests

- Seed: sin sección nueva — las liquidaciones 2026-06 del seed se emiten con la RPC nueva y nacen CON aportes; el canario G1 del seed se actualiza a los montos golden nuevos (el plan los fija).
- **pgTAP**: se EXTIENDE `remuneraciones.test.sql` (asserts nuevos: goldens de aportes G1-G4, trabajador desactivado → raise, asiento de 5 líneas cuadrado con las 2 anclas nuevas, catch-up de liquidación vieja con aportes 0 → asiento de 3 líneas) + parches 14→16 en los asserts de anclas. El plan fija plan(N) y el total (392 + nuevos, 19 archivos).
- **Unit**: `previred.test.ts` (líneas doradas, heurística de nombres, códigos AFP) + tests de aportes en `remuneraciones.test.ts`. El plan fija el total (204 + nuevos).
- **Builds** 3 apps. **E2E Playwright** (~7 puntos): liquidación nueva muestra costo empresa (preview = emisión), asiento de 5 líneas, libro con columnas nuevas + CSV, descarga del TXT Previred con línea válida, tasa mutual editada en Configuración con efecto en la siguiente liquidación, tasa SIS editada en admin, validación de tramos rechaza hueco.

## 9. Fuera de alcance (Plan 20+)

- Finiquitos (causales, indemnizaciones) y vacaciones (15 días hábiles, saldos).
- Catálogo de Isapres (código Previred específico por institución).
- Separar nombre en apellidos/nombres como columnas.
- Licencias médicas, cargas familiares, asignación familiar, APV.
- Carga automática a Previred (API no pública; el TXT se sube a mano).
