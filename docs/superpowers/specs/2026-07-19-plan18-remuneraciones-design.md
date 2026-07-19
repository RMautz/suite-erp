# Plan 18 — Núcleo de Remuneraciones (Fase 3 RRHH, parte 1) · diseño

**Fecha:** 2026-07-19 · **Estado:** aprobado por el usuario (diseño conversacional) · **Alcance:** un plan (~9-10 tasks)

## 1. Objetivo

Primer plan de la Fase 3: ficha de trabajadores, contratos y **liquidaciones de sueldo mensuales con el cálculo chileno completo**, libro de remuneraciones, e integración automática con el núcleo contable (P16/P17). La plataforma mantiene los indicadores previsionales; el cálculo autoritativo vive en SQL.

Decisiones del usuario (AskUserQuestion 2026-07-18):
- Alcance: **núcleo remuneraciones**; asistencia, vacaciones, finiquitos, Previred y aportes del empleador → Plan 19.
- Indicadores: **tabla mantenible** por el admin de plataforma (sembrada con valores reales vigentes; enchufe futuro a mindicador.cl, fuera de alcance).
- Previred: **después** (v1 entrega el libro de remuneraciones + CSV).
- Asiento contable: **desde v1** (origen `'remuneracion'`, estándar de la casa).

## 2. Modelo de datos (migración 0025)

### 2.1 `trabajadores` (maestro por empresa)
`id, empresa_id, rut (normalizado, validado app.validar_rut, unique (empresa_id, rut)), nombre, email null, telefono null, direccion null, fecha_nacimiento null, activo bool default true, creado_en`. Patrón maestros (0003) con una diferencia por sensibilidad: RLS **por rol** — SELECT dueno/admin/contador; INSERT/UPDATE dueno/admin (vía `app.tiene_rol_en_empresa`); vendedor/bodeguero 0 filas. Sin DELETE (desactivar).

### 2.2 `contratos`
`id, empresa_id, trabajador_id (FK compuesta), tipo check ('indefinido','plazo_fijo'), fecha_inicio date, fecha_termino date null (obligatoria si plazo_fijo — CHECK), cargo text, sueldo_base integer > 0 (CLP), gratificacion_legal bool default true (tope 4,75 IMM anual → 1/12 mensual), afp text check (capital|cuprum|habitat|modelo|planvital|provida|uno), salud check ('fonasa','isapre'), plan_isapre_uf numeric(6,2) null (obligatorio si isapre — CHECK), vigente bool default true, creado_en`. **Unique parcial: un contrato vigente por trabajador** (`(empresa_id, trabajador_id) where vigente`). Mismas policies por rol que trabajadores. Cambiar condiciones = cerrar contrato (vigente=false) + crear nuevo.

### 2.3 `indicadores_previsionales` (tabla de PLATAFORMA — sin empresa_id)
`periodo text primary key check (periodo ~ '^\d{4}-(0[1-9]|1[0-2])$')`, `uf integer` (CLP último día del mes), `utm integer`, `ingreso_minimo integer`, `tope_imponible_uf numeric(5,1)` (87,8), `tope_cesantia_uf numeric(5,1)` (131,9), `tasas_afp jsonb` (`{capital: 11.44, ...}` — % total con comisión), `tramos_impuesto jsonb` (array `[{desde_utm, hasta_utm|null, factor, rebaja_utm}]` tabla SII), `actualizado_en`. RLS: SELECT authenticated (datos públicos); **escritura SOLO service_role** (panel admin) — cero grants de escritura a authenticated. Sembrada en la migración con los últimos 3 meses, con valores representativos (UF/UTM proyectados; el admin de plataforma los corrige desde su panel — la fuente oficial queda en `docs/credenciales-pendientes.md` #14).

### 2.4 `liquidaciones` (INMUTABLE emitida; snapshot completo)
`id, empresa_id, trabajador_id, contrato_id (FKs compuestas), periodo text (mismo CHECK), estado check ('borrador','emitida','pagada','anulada') default 'borrador'`, inputs: `dias_trabajados integer check 1-30 default 30, extras_imponibles integer >= 0 default 0, no_imponibles integer >= 0 default 0` (colación/movilización), snapshot del cálculo (todo integer CLP): `sueldo_proporcional, gratificacion, total_imponible, afp_monto, salud_monto, cesantia_monto, impuesto_unico, total_descuentos, liquido`, snapshot de contexto: `sueldo_base, afp, tasa_afp numeric(5,2), salud, plan_isapre_uf, uf, utm` (auditabilidad: la liquidación se explica sola aunque cambien contrato o indicadores), `emitida_en, pagada_en, anulada_en, motivo_anulacion`, `creado_en`. **Unique parcial: una liquidación no-anulada por (empresa, trabajador, periodo)**. RLS SELECT por rol dueno/admin/contador; CERO escritura directa (solo RPCs).

## 3. Cálculo chileno — SQL autoritativo + espejo TS con goldens compartidos

Reglas (v1, solo descuentos del trabajador — aportes del empleador SIS/cesantía 2,4% van en Plan 19, límite DECLARADO en la UI del detalle):
1. `sueldo_proporcional = round(sueldo_base * dias_trabajados / 30)`.
2. `gratificacion = gratificacion_legal ? min(round(0.25 * (sueldo_proporcional + extras_imponibles)), round(4.75 * ingreso_minimo / 12)) : 0`.
3. `total_imponible = min(sueldo_proporcional + extras_imponibles + gratificacion, round(tope_imponible_uf * uf))`.
4. `afp_monto = round(total_imponible * tasa_afp / 100)` (tasa del jsonb según AFP del contrato).
5. `salud_monto = salud = 'fonasa' ? round(total_imponible * 0.07) : max(round(0.07 * total_imponible), round(plan_isapre_uf * uf))` (el plan Isapre es piso; base imponible topada).
6. `cesantia_monto = tipo = 'indefinido' ? round(min(total_imponible, round(tope_cesantia_uf * uf)) * 0.006) : 0` (plazo fijo: trabajador no cotiza).
7. `base_tributable = total_imponible − afp_monto − salud_monto − cesantia_monto`; `impuesto_unico` por tramos UTM del jsonb (`round(base * factor − rebaja_utm * utm)`, mínimo 0).
8. `total_descuentos = afp + salud + cesantia + impuesto`; `liquido = total_imponible + no_imponibles − total_descuentos`.

**Autoridad:** la RPC recalcula TODO en plpgsql desde contrato + indicadores del período; los únicos inputs del cliente son `dias_trabajados, extras_imponibles, no_imponibles`. **Espejo:** `packages/core/src/remuneraciones.ts` (`calcularLiquidacion(contrato, indicadores, inputs)`) para la vista previa del formulario — probado por unit tests con **los mismos valores dorados** que los asserts pgTAP de la RPC (al menos 4 goldens calculados a mano: Fonasa indefinido simple; Isapre plazo fijo con plan > 7%; sueldo sobre tope imponible; base que cae en tramo 2+ del impuesto). Divergencia SQL↔TS = bug.

## 4. RPCs (security definer, search_path=public, patrón de la casa)

- `guardar_trabajador` / `guardar_contrato`: NO existen — escritura directa con RLS por rol (patrón maestros); el cierre+creación de contrato va en una Server Action con dos writes (no atómico aceptado: peor caso queda sin contrato vigente, visible y reparable).
- **`emitir_liquidacion(p_empresa, p_trabajador, p_periodo, p_dias, p_extras, p_no_imponibles) returns uuid`** — rol dueno/admin/contador (`'Tu rol no permite emitir liquidaciones'`); valida contrato vigente (`'El trabajador no tiene contrato vigente'`), indicadores del período (`'No hay indicadores previsionales para el período'`), no duplicada (`'Ya existe una liquidación de ese período'` — respaldada por el unique parcial), período con formato válido (`'Período no válido'` — mismo mensaje P17). Calcula (sección 3), inserta la fila directamente en estado `'emitida'` con `emitida_en = now()` (sin fase borrador persistida: la "vista previa" es el espejo TS en pantalla — YAGNI el borrador en BD) y setea todos los snapshots. El estado `'borrador'` del CHECK queda reservado para futuro (no se usa en v1).
- **`pagar_liquidacion(p_empresa, p_liquidacion)`** — mismos roles; emitida → pagada (`pagada_en`); `'Solo se puede pagar una liquidación emitida'`.
- **`anular_liquidacion(p_empresa, p_liquidacion, p_motivo)`** — mismos roles; emitida O pagada → anulada con motivo obligatorio (`'Indica el motivo de la anulación'`); la reversa contable la maneja el hook (sección 5). Tras anular se puede volver a emitir el período (unique parcial ignora anuladas).
- Asiento: fecha = **último día del mes del período**, pasada por `app._fecha_contable` (respeta cierres P17).

## 5. Integración contable

- Origen nuevo **`'remuneracion'`** en el CHECK de asientos (re-emitido) + regla en `contabilizar_documento` (re-create): debe **Gasto remuneraciones** = total_imponible + no_imponibles; haber **Remuneraciones por pagar** = liquido; haber **Retenciones previsionales por pagar** = total_descuentos. Cuadra por construcción (regla 8 de la sección 3). Liquidación anulada ANTES de contabilizarse → noop (patrón P16).
- 3 cuentas ancla nuevas (14 total): `gasto_remuneraciones` (gasto), `remuneraciones_por_pagar` (pasivo), `retenciones_por_pagar` (pasivo) — códigos fijados por el plan mirando el catálogo real; sembradas en `activar_contabilidad` (re-create) + backfill código-libre a empresas ya activas (patrón P17).
- Hooks nunca-lanza: `emitir_liquidacion` action → `contabilizarAsiento(empresa, 'remuneracion', liquidacionId)`; `anular_liquidacion` action → si había asiento, `revertir_asiento` vía la RPC existente (glosa `'Anulación liquidación {periodo} {nombre}'`). `contabilizar_pendientes` (re-create) cubre liquidaciones emitidas sin asiento (catch-up).
- El Contador Auditor (P17) las ve sin cambios: regla 1 (sin contabilizar) las detecta vía pendientes; el gasto entra a la regla 4 (anomalía).

## 6. UI

### ERP (sección NAV nueva "Personas", entre Maestros y Análisis; visible según rol — UX, la seguridad es RLS)
- **/trabajadores**: lista (nombre, RUT, cargo del contrato vigente, estado) + ficha con datos y contratos (crear/cerrar contrato con formulario completo: AFP, salud con plan UF condicional a isapre, gratificación). Escritura dueno/admin; contador solo lectura.
- **/liquidaciones**: lista por período (trabajador, imponible, descuentos, líquido, estado con insignias) + **generar**: elegir período y trabajador (con contrato vigente), inputs días/extras/no imponibles, **vista previa en vivo** (espejo TS) con el desglose completo, botón Emitir (→ RPC + hook). Detalle imprimible formato liquidación chilena (empleador, trabajador, haberes/descuentos en dos columnas, líquido destacado, `print:` como proformas) + acciones Pagar / Anular (motivo, confirmación) + traza "Asiento N°" (patrón P16).
- **/libro-remuneraciones**: por período — una fila por liquidación no-anulada (RUT, nombre, días, imponible, AFP, salud, cesantía, impuesto, líquido) + totales + export CSV (patrón libros, guards en paridad).

### Admin (3002)
- Sección **Indicadores previsionales**: tabla de períodos con los valores + formulario para crear/editar el período (todos los campos; tasas AFP y tramos como campos individuales que arman el jsonb server-side). Server action con verificarAdmin + service_role (única vía de escritura).

## 7. Seed demo

Indicadores de los últimos 3 períodos; 3 trabajadores con contratos variados (Fonasa indefinido, Isapre plazo fijo, Fonasa indefinido con sueldo alto sobre tope) en la empresa demo; liquidaciones del mes anterior emitidas (una pagada) y contabilizadas — el libro y los asientos nacen poblados; org 2 sin RRHH (muestra vacíos).

## 8. Tests

- **pgTAP** `remuneraciones.test.sql` (archivo 19): RLS por rol de las 3 tablas nuevas (vendedor 0 filas, contador lee, escritura de trabajadores solo dueno/admin), escritura directa de liquidaciones/indicadores denegada, emitir con goldens (los 4 de la sección 3, byte-exactos contra el espejo TS), duplicada → raise, sin contrato → raise, sin indicadores → raise, pagar/anular máquina de estados, re-emitir tras anular, asiento generado cuadrado con las 3 cuentas ancla (vía contabilizar_documento service_role), noop anulada, mensajes byte-exactos. El plan fija plan(N); suite = 363 + N en 19 archivos.
- **Unit**: `remuneraciones.test.ts` en core con los mismos goldens + bordes (días parciales, tope cesantía, tramo exento). El plan fija el total (192 + N).
- **Builds** 3 apps. **E2E Playwright**: crear trabajador+contrato → generar liquidación con preview → emitir → asiento visible en contabilidad → libro con totales → pagar → anular con reversa → indicadores editados en admin → vendedor no ve nada de Personas.

## 9. Fuera de alcance (Plan 19+)

- Aportes del empleador (SIS, cesantía 2,4%, mutual) y su asiento.
- Archivo Previred, finiquitos, vacaciones, asistencia, horas extra calculadas (v1: monto manual).
- Automatización de indicadores (mindicador.cl).
- Anticipos de sueldo, préstamos, descuentos judiciales.
- APV, cargas familiares, asignación familiar, semana corrida.
