# Plan 20 — Finiquitos, vacaciones y Previred completo (Fase 3 RRHH, parte 3) · diseño

**Fecha:** 2026-07-19 · **Estado:** aprobado por el usuario (diseño conversacional) · **Alcance:** un plan (~8-9 tasks)

## 1. Objetivo

Cerrar RRHH: **vacaciones** con devengo automático y saldo, **finiquitos** con causales legales, cálculo autoritativo en SQL, documento imprimible y asiento automático, y el **TXT Previred completo** (apellidos reales + código de Isapre).

Decisiones del usuario (AskUserQuestion 2026-07-19): alcance RRHH completo (finiquitos + vacaciones + Isapres/apellidos); vacaciones registradas por dueño/admin (los trabajadores NO son usuarios).

## 2. Modelo de datos (migración 0027)

### 2.1 Apellidos separados en `trabajadores`
- Columnas nuevas: `nombres text`, `apellido_paterno text`, `apellido_materno text null`. **Backfill único** con la heurística de `separarNombre` (últimas 2 palabras = apellidos; con 2 palabras: 1 nombre + 1 paterno) en SQL; tras el backfill, `nombres` y `apellido_paterno` quedan `not null` (constraint agregada después del update).
- **`nombre` se CONSERVA como columna de display** (todo el resto del sistema la sigue leyendo sin cambios). Nueva convención de escritura: los formularios capturan los 3 campos y la Server Action **compone** `nombre = trim(nombres ‖ ' ' ‖ apellido_paterno ‖ ' ' ‖ coalesce(materno,''))` — única vía de escritura, la composición vive en un helper de core (`nombreCompleto`) usado por la action. Previred deja de usar la heurística: lee los 3 campos (y `separarNombre` se elimina de core con sus tests — ya no tiene consumidores).

### 2.2 Catálogo de Isapres + `contratos.isapre`
- `ISAPRES` en `packages/core` (patrón AFPS): `[{valor, etiqueta, codigo_previred}]` — `cruzblanca` "Cruz Blanca" 1, `banmedica` "Banmédica" 3, `colmena` "Colmena Golden Cross" 4, `consalud` "Consalud" 9, `vidatres` "Vida Tres" 12, `nuevamasvida` "Nueva Masvida" 43, `esencial` "Esencial" 44. Códigos v1 representativos (misma lógica que los códigos AFP: se validan contra Previred al tener cuenta).
- `contratos.isapre text null` con CHECK de pertenencia al catálogo cuando no es null. Los contratos isapre EXISTENTES quedan null (→ Previred código 0, como hoy — límite declarado); el formulario EXIGE isapre para contratos nuevos con salud='isapre' (validación en la action, fail-closed).

### 2.3 `vacaciones_tomadas`
`id, empresa_id, trabajador_id (FK compuesta), desde date, hasta date (check hasta >= desde), dias_habiles integer > 0, comentario text null, creado_en`. RLS por rol (SELECT dueno/admin/contador; INSERT y **DELETE directo** dueno/admin — precedente gastos_vehiculo P12; sin UPDATE). Sin solape validado (v1: se acepta solape, el saldo igual resta — límite declarado).

### 2.4 Devengo y saldo (espejo TS + SQL con goldens compartidos)
- `devengados = meses_completos(desde fecha_inicio del PRIMER contrato del trabajador hasta hoy o hasta fecha_termino del finiquito) × 1.25` (numeric 6,2 — continuidad laboral entre contratos consecutivos del mismo trabajador).
- `saldo = devengados − Σ dias_habiles tomados` (puede ser negativo → se muestra en rojo; el feriado del finiquito usa `max(saldo, 0)`).
- Advertencia UI si saldo > 30 (acumulación legal máx. ~2 períodos).
- Cálculo TS en core (`calcularVacaciones(fechaInicio, hasta, diasTomados)`) para la UI + la MISMA fórmula en la RPC de finiquito — goldens compartidos.

### 2.5 `finiquitos` (INMUTABLE; snapshot completo)
`id, empresa_id, trabajador_id, contrato_id (FKs compuestas), causal check ('renuncia','mutuo_acuerdo','necesidades_empresa','vencimiento_plazo','conducta_grave'), fecha_termino date, aviso_dado bool, estado check ('emitido','pagado','anulado') default 'emitido'`, inputs `otros_haberes integer >= 0 default 0, otros_descuentos integer >= 0 default 0, comentario text null`, snapshot (integer CLP): `sueldo_base, anos_servicio integer, indemnizacion_anos, indemnizacion_aviso, feriado_dias numeric(6,2), feriado_monto, total`, contexto: `uf integer` (del período de término), `emitido_en, pagado_en, anulado_en, motivo_anulacion`. **Unique parcial: un finiquito no-anulado por contrato.** RLS SELECT por rol; CERO escritura directa.

## 3. Cálculo del finiquito (SQL autoritativo en `emitir_finiquito` + espejo TS)

1. `anos_servicio`: años entre `fecha_inicio` del PRIMER contrato y `fecha_termino`; fracción > 6 meses → +1; **tope 11**.
2. `base = min(sueldo_base, round(90 × uf))` (tope legal 90 UF, con la UF del período de `fecha_termino` — exige indicadores del período: `'No hay indicadores previsionales para el período'`).
3. `indemnizacion_anos = causal = 'necesidades_empresa' ? base × anos_servicio : 0`.
4. `indemnizacion_aviso = (causal = 'necesidades_empresa' and not aviso_dado) ? base : 0`.
5. `feriado_dias = max(saldo de vacaciones a fecha_termino, 0)` (fórmula §2.4); `feriado_monto = round(sueldo_base / 30 × feriado_dias)`. **Simplificación v1 DECLARADA** (visible en el documento): sin conversión hábiles→corridos y sin descuentos previsionales sobre el feriado — el contador puede ajustar con asiento manual.
6. `total = indemnizacion_anos + indemnizacion_aviso + feriado_monto + otros_haberes − otros_descuentos`; guard `total < 0` → `'El total del finiquito no puede ser negativo: revisa los descuentos'`.
7. Efectos atómicos al emitir: contrato → `vigente = false`; trabajador → `activo = false`; snapshot completo. Validaciones (orden): rol (`'Tu rol no permite emitir finiquitos'` — dueno/admin/contador), contrato vigente del trabajador (`'El trabajador no tiene contrato vigente'` — mensaje P18 reutilizado), indicadores, duplicado (`'Ya existe un finiquito para este contrato'`).
- **`pagar_finiquito`** (emitido → pagado; `'Solo se puede pagar un finiquito emitido'`) y **`anular_finiquito`** (emitido o pagado → anulado, motivo obligatorio `'Indica el motivo de la anulación'`; **reactiva** contrato `vigente=true` y trabajador `activo=true` — valida antes que el trabajador no tenga OTRO contrato vigente: `'El trabajador ya tiene otro contrato vigente'`). Mismos roles.

## 4. Integración contable

- Origen **`'finiquito'`** en el CHECK de asientos + 2 anclas nuevas (catálogo **33/18**): `gasto_indemnizaciones` (grupo 5) y `finiquitos_por_pagar` (grupo 2) — códigos fijados por el plan; seed en `activar_contabilidad` (re-create) + backfill patrón P18/P19.
- Regla en `contabilizar_documento` (re-create): asiento de **2 líneas por el total neto** — debe `gasto_indemnizaciones` = total, haber `finiquitos_por_pagar` = total; total 0 → noop; anulado → noop. Fecha = `fecha_termino` vía `app._fecha_contable`. `contabilizar_pendientes` y la regla 1 y 6 del auditor ganan el origen (re-creates).
- Hooks: emitir → `contabilizarAsiento(empresa, 'finiquito', id)` nunca-lanza; anular → reversa vía `revertir_asiento` (glosa `'Anulación finiquito {nombre}'`).

## 5. Previred completo

`FilaPrevired` cambia: `nombre` → `nombres, apellido_paterno, apellido_materno` (campos 2-4 del TXT poblados directo) e `isapre_codigo` (campo de institución de salud: el código del catálogo si el contrato es isapre con isapre seteada, 7 si fonasa, 0 si isapre sin catálogo). `generarPrevired` ajustada + tests; la route del TXT alimenta los campos nuevos desde los joins.

## 6. UI

- **Ficha del trabajador** (`/trabajadores/[id]`): formulario con nombres/apellidos separados (el action compone `nombre`); sección **Vacaciones** (devengado / tomados / saldo con advertencia >30, formulario registrar toma desde/hasta/días hábiles, lista con eliminar — dueño/admin); botón **"Emitir finiquito"** (solo con contrato vigente) → `/trabajadores/[id]/finiquito`: causal (select con etiquetas legales), fecha término, aviso dado (checkbox, visible solo para necesidades_empresa), otros haberes/descuentos, **vista previa en vivo** (espejo TS) del desglose, Emitir.
- **Detalle del finiquito** (`/trabajadores/[id]/finiquito` muestra el emitido si existe): documento imprimible formato finiquito chileno (empleador, trabajador, causal con artículo legal, desglose, total destacado, nota de simplificación v1, línea de firmas), traza "Asiento N°", acciones Pagar / Anular (motivo + confirmación, con la advertencia de que reactiva el contrato).
- **Lista** `/trabajadores`: insignia "Finiquitado" en trabajadores con finiquito no-anulado; el formulario de contrato nuevo exige isapre del catálogo cuando salud='isapre'.
- Formularios existentes de trabajador (nuevo y ficha) migran a los 3 campos.

## 7. Seed y tests

- Seed: 1 registro de vacaciones para Amanda (5 días hábiles) — el saldo aparece en su ficha; SIN finiquitos sembrados (el flujo se vive en el E2E; la demo conserva sus 3 trabajadores activos).
- **pgTAP** `finiquitos.test.sql` (archivo 20): goldens por causal calculados a mano (necesidades_empresa 3,5 años sin aviso → 4 años + aviso + feriado; renuncia → solo feriado; vencimiento_plazo → 0 indemnizaciones), tope 11 años, tope 90 UF, devengo de vacaciones (goldens), efectos emitir (contrato/trabajador), anular reactiva + valida otro-contrato-vigente, re-emitir tras anular, RLS por rol, asiento 2 líneas + noop, escritura directa denegada, mensajes byte-exactos. Backfill de apellidos verificado. El plan fija plan(N); suite = 399 + N en 20 archivos.
- **Unit**: espejos finiquito y vacaciones con los mismos goldens + Previred con apellidos/isapre (tests de separarNombre eliminados con la función). El plan fija el total.
- **Builds** 3 apps. **E2E** (~7 puntos): ficha con apellidos, registrar vacaciones → saldo, finiquito necesidades_empresa con preview = emisión, documento impreso, asiento visible, anular → contrato reactivado, TXT Previred con apellidos y código isapre.

## 8. Fuera de alcance

- Cuentas de usuario para trabajadores (solicitudes de vacaciones).
- Conversión hábiles→corridos del feriado y cotizaciones sobre el feriado proporcional (declarado en el documento).
- Semana corrida, licencias médicas, subsidios; indemnización a todo evento (art. 164).
- Carga del finiquito a la Dirección del Trabajo (trámite externo).
