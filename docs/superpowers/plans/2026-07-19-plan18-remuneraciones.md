# Plan 18 — Núcleo de Remuneraciones · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute this plan task-by-task with fresh subagents, or superpowers:executing-plans when running it in a dedicated session. Read the Global Constraints before ANY task.

**Goal:** Primer plan de la Fase 3 RRHH: ficha de trabajadores con contratos, liquidaciones de sueldo mensuales con el cálculo chileno completo (AFP, salud, cesantía, impuesto único, gratificación con topes), libro de remuneraciones con CSV, asiento contable automático (origen `'remuneracion'`) e indicadores previsionales mantenibles desde el panel admin de plataforma. El cálculo autoritativo vive en SQL; la vista previa es un espejo TS probado con los mismos goldens.

**Architecture:** Migración 0025 en dos secciones (Task 1: tablas `trabajadores`/`contratos`/`indicadores_previsionales`/`liquidaciones` con RLS por rol; Task 2: RPCs `emitir/pagar/anular_liquidacion` + origen `'remuneracion'` + 3 cuentas ancla + re-creates de `activar_contabilidad`/`contabilizar_documento`/`contabilizar_pendientes`/`revision_periodo`). Espejo TS `calcularLiquidacion` en `@suite/core` con 4 goldens compartidos byte a byte con pgTAP (divergencia SQL↔TS = bug). UI ERP: sección NAV "Personas" (visible solo para dueno/admin/contador vía `puedeVerRRHH`, patrón Contabilidad) con `/trabajadores`, `/liquidaciones` (vista previa en vivo + detalle imprimible) y `/libro-remuneraciones`. Admin 3002: página `/indicadores` (escritura SOLO service_role). Seed demo con 3 trabajadores que replican los goldens G1-G3.

**Tech Stack:** Postgres/Supabase local (migraciones SQL + pgTAP), monorepo pnpm/turbo con Next.js (apps web 3000, erp 3001, admin 3002), TypeScript compartido en `packages/core` y `packages/db`, seed demo en `scripts/seed-demo.mjs`, E2E manual con Playwright MCP.

Spec: `docs/superpowers/specs/2026-07-19-plan18-remuneraciones-design.md`.

## Global Constraints

- **Mensajes byte-exactos** (no parafrasear, no cambiar tildes; spec §4 + los fijados por este plan):
  - `'Tu rol no permite emitir liquidaciones'` — **reutilizado en las 3 RPCs** (`emitir`, `pagar` y `anular`: §4 dice "mismos roles" y no define mensajes propios).
  - `'Período no válido'` (mismo mensaje P17).
  - `'El trabajador no tiene contrato vigente'`.
  - `'No hay indicadores previsionales para el período'` (también cuando el período existe pero no trae la tasa de la AFP del contrato).
  - `'Ya existe una liquidación de ese período'`.
  - `'Solo se puede pagar una liquidación emitida'`.
  - `'Indica el motivo de la anulación'`.
  - `'Solo se puede anular una liquidación emitida o pagada'` (fijado por este plan; §4 no lo define).
  - Glosa del asiento: `'Liquidación de sueldo {periodo} {nombre}'`. Glosa de la reversa (spec §5): `'Anulación liquidación {periodo} {nombre}'`.
  - `'El líquido no puede ser negativo: revisa los días trabajados y los descuentos'` — fijado por este plan: guard tras la regla 8 en `emitir_liquidacion` Y en el espejo TS `calcularLiquidacion` (sin él, pocos días + plan Isapre como piso darían líquido < 0, `contabilizar_documento` filtraría la línea, el asiento nacería descuadrado y `contabilizar_pendientes` reventaría en cada catch-up).
- **GOLDENS CANÓNICOS (tabla contractual):** los 4 goldens son idénticos en pgTAP (Task 3), unit (Task 4) y el smoke de Task 2; el seed (Task 9) replica G1-G3 con los MISMOS inputs. Cualquier divergencia entre un golden y el cálculo (SQL o TS) es bug del código, JAMÁS se ajusta el valor esperado sin recalcular a mano.

  | # | Perfil (30 días, extras 0) | total_imponible | afp_monto | salud_monto | cesantia_monto | impuesto_unico | liquido |
  |---|---|---|---|---|---|---|---|
  | G1 | Fonasa indefinido habitat 800.000, **no_imponibles 50.000** | 1000000 | 112700 | 70000 | 6000 | 0 | 861300 |
  | G2 | Isapre plazo fijo capital 1.200.000, plan 5,0 UF | 1409396 | 161235 | 196000 | 0 | 4556 | 1047605 |
  | G3 | Fonasa indefinido modelo 4.000.000 (sobre tope) | 3441760 | 364138 | 240923 | 20651 | 104354 | 2711694 |
  | G4 | Fonasa indefinido habitat 2.500.000 (tramo 2+) | 2709396 | 305349 | 189658 | 16256 | 54921 | 2143212 |

- **Indicadores canónicos** (período `'2026-06'`, el ÚNICO contractual para los goldens): `uf 39200`, `utm 69500`, `ingreso_minimo 529000`, `tope_imponible_uf 87.8`, `tope_cesantia_uf 131.9`; tasas AFP `capital 11.44, cuprum 11.44, habitat 11.27, modelo 10.58, planvital 11.10, provida 11.45, uno 10.49`; 8 tramos de impuesto único (tabla SII mensual, intervalos semiabiertos `(desde, hasta]`). La 0025 siembra además `'2026-05'` (`uf 39050`, `utm 69200`) y `'2026-07'` (`uf 39350`, `utm 69800`) con los MISMOS IMM/topes/tasas/tramos — valores representativos (spec §2.3 amendado por este plan): ningún golden, test ni seed depende de 05/07; el E2E usa 2026-07 solo con montos derivados en pantalla (ítem 9 usa 5,0 × 39.350 = 196.750).
- **Conteos contractuales:** pgTAP **363 + plan(29) = 392 asserts en 19 archivos** (Task 3 fija `plan(29)`; Tasks 1-2 mantienen 363 — los dos parches de asserts `'11/…'→'14/…'` viven SOLO en Task 2 y no cambian conteos). Unit **192 + 12 = 204** (core pasa de 142 a 154; pagos 25, correo 13, dte 10, auth 2). Builds: las **3 apps** compilan. Catálogo contable tras Task 2: **29 cuentas / 14 claves de sistema (anclas) / 5 grupos**.
- **Redondeo declarado:** `round()` de plpgsql sobre `numeric` redondea mitades LEJOS del cero; `Math.round` coincide para todo valor ≥ 0 (todos los montos del módulo lo son). La RPC divide en numeric (nunca división entera) para calzar con el espejo.
- **`AFPS` de `@suite/core` es la ÚNICA fuente del catálogo de AFP** (slug + etiqueta) en las 3 apps: la exporta Task 4 (`packages/core/src/remuneraciones.ts`); Task 5 (`catalogos.ts` erp) y Task 8 (`afps.ts` admin) derivan de ella; Task 6 (`estados.ts`) NO re-deriva: re-exporta `ETIQUETA_AFP` de Task 5 como `AFP_NOMBRE`. Prohibido duplicar la lista de 7 AFP (o su derivación) a mano.
- **`apps/erp/lib/rrhh-acceso.ts` es el guard único de Personas:** lo CREA Task 5; Tasks 6 y 7 lo importan (jamás lo re-crean).
- **Exclusividad de archivos compartidos:** SOLO Task 7 toca `apps/erp/app/layout.tsx`; SOLO Task 6 toca `apps/erp/lib/contabilidad.ts` (union `+'remuneracion'`) y `apps/erp/app/contabilidad/origenes.ts`.
- **Período inválido en libro/export (patrón dominante verificado):** los 4 exports existentes (diario/mayor/balance/eerr) hacen FALLBACK silencioso al período por defecto ante un parámetro inválido — jamás 404 por período. `/libro-remuneraciones` (página y route) sigue ese patrón: `?periodo=` inválido cae al mes anterior.
- **Backfill de anclas:** JAMÁS `on conflict do nothing` (dejaría empresas sin ancla y `contabilizar_documento` reventaría). Patrón 0024: reclamo de fila prístina + insert código-libre.
- **Prohibido el BOM U+FEFF** en cualquier archivo creado o modificado (SQL, TS, TSX, MJS). Cada task con archivos nuevos verifica los primeros bytes.
- **Copy es-CL** en toda la UI; comentarios SQL en ASCII sin tildes, mensajes de usuario con tildes (convención 0022/0024).
- **Reiniciar los dev servers tras cada `pnpm build`** (gotcha del repo: el build pisa los `.next` de 3000-3002 → 500s hasta reiniciar).

## Contexto verificado

Verificado contra el repo al ensamblar el plan (no repetir esta investigación al ejecutar):

- **Baseline verde:** 363 pgTAP en 18 archivos (suma de los `plan(N)` verificada con grep) / 192 unit (core 142 `it(` + pagos 25 + correo 13 + dte 10 + auth 2) / 3 builds.
- **Hallazgo crítico:** dos asserts cuentan las anclas del catálogo y se rompen con las 3 nuevas: `supabase/tests/database/contabilidad.test.sql:85` espera `'11/true'` y `supabase/tests/database/estados_financieros.test.sql:67` espera `'11/patrimonio:true'`. Task 2 (que re-crea `activar_contabilidad`) parchea AMBOS a `14` en el MISMO commit — mismo conteo de asserts (`plan(36)` en ambos): la suite sigue en 363 hasta Task 3. Task 3 NO toca esos archivos (su assert 1 `'14/3'` vive en el archivo nuevo).
- **Códigos de las 3 anclas, mirando el catálogo real de 0024:81-133:** el seed YA trae `2.1.04 Remuneraciones por pagar` (pasivo) y `5.1.02 Remuneraciones` (gasto), ambas con `clave_sistema null`. Decisión adoptada (cambio mínimo que evita nombres duplicados): esas dos filas GANAN su clave (`remuneraciones_por_pagar`, `gasto_remuneraciones`) y se agrega UNA fila nueva `2.1.06 Retenciones previsionales por pagar` (clave `retenciones_por_pagar`; el grupo 2 termina en `2.1.05`, código libre). Catálogo: 28 cuentas / 11 claves → **29 / 14 / 5 grupos**.
- **Backfill a empresas ya activas (patrón 0024:56-75, extendido):** por ancla, (a) RECLAMO de la fila prístina del seed (mismo código+nombre+tipo, hoja, activa, sin clave) — los saldos históricos que ya apuntaban a `2.1.04`/`5.1.02` ruedan solos al ancla; (b) para empresas donde el usuario editó/desactivó esa fila, insert código-libre (`'2.1.0'||n` / `'5.1.0'||n`, n ≥ 6). `retenciones_por_pagar` no tiene fila que reclamar: solo inserta. Orden de statements fijo: el segundo insert del grupo 2 ve el código que tomó el primero.
- `emitir_liquidacion` **NO toma el advisory lock** del correlativo: no crea asientos (el asiento va por `contabilizar_documento` vía hook de la Server Action). La carrera de doble emisión muere en el unique parcial `liquidaciones_periodo_idx` (backstop `unique_violation` → mensaje contractual).
- **Orden de validación en `emitir_liquidacion` (OBLIGATORIO para el assert 10 de Task 3):** rol → formato de período → contrato vigente → indicadores → duplicada. Si el formato no se valida ANTES de buscar indicadores, `'2026-13'` daría `'No hay indicadores previsionales para el período'` en vez de `'Período no válido'`.
- Los cuerpos que Task 2 re-crea son los VIGENTES de **0024** (re-creates P17), no los de 0022: `activar_contabilidad` 0024:81-133, `contabilizar_documento` 0024:296-464 (con el clamp `app._fecha_contable`), `contabilizar_pendientes` 0024:469-525 (order by clampeado), `revision_periodo` 0024:713-956 (su regla 1 replica el union de pendientes; Task 2 también la re-crea para sumarle la rama de liquidaciones — sin eso el auditor quedaría ciego a remuneraciones sin contabilizar, spec §5). El CHECK de origen vigente es 0024:51-54 (lista con `'cierre'`). `app._insertar_asiento` (0024:164-232) NO se toca, solo se invoca.
- `'Período no válido'` no existe hoy en `apps/erp` (grep = 0): en las RPCs lo reutiliza byte-exacto de `revision_periodo` (0024:744).
- **Hook contable:** `apps/erp/lib/contabilidad.ts:19` tiene el union `origen: 'venta' | 'nota_credito' | 'compra' | 'pago' | 'pago_proveedor' | 'anticipo'` — SIN `'remuneracion'`. Task 6 hace el cambio mínimo (+1 miembro del union). `apps/erp/app/contabilidad/origenes.ts` vigente: `ETIQUETA_ORIGEN` termina en `anticipo / reversa / cierre` y `rutaOrigen` solo rutea venta/nota_credito — Task 6 agrega `remuneracion` a ambos.
- **NAV:** `apps/erp/app/layout.tsx:42-43` contiene el ancla exacta `{ href: '/importar', etiqueta: 'Importar' },` seguida de `{ seccion: 'Análisis' },`. SOLO Task 7 lo edita.
- **Precedente de export con período inválido:** `diario/export/route.ts:36-37` y `mayor` (fechas), `balance/export/route.ts:25` (año) y `eerr/export/route.ts:26-29` (período) hacen todos FALLBACK silencioso al valor por defecto — ninguno responde 404 por parámetro inválido. Task 7 se alinea a ese patrón.
- `apps/erp/lib/empresa-activa.ts` exporta `EmpresaResumen` con `rut`, `razon_social` y `rol` (resuelto de `miembros`, sin re-consultar). Existen `apps/erp/componentes/boton-imprimir.tsx`, `apps/erp/lib/contabilidad-acceso.ts` (patrón `exigirContabilidad`/`puedeVerContabilidad`) y `apps/erp/app/tipos.ts` (`EstadoForm`). `@suite/core` ya exporta `periodoAnterior`, `rangoDeMes`, `filasACsv`, `formatearCLP`, `formatearRut`, `validarRut`, `limpiarRut`. `revertir_asiento` ya está tipada en `packages/db/src/types.ts`.
- `packages/core/src/index.ts` vigente: 13 `export *` terminando en `'./rubros'` (Task 4 agrega `'./remuneraciones'` al final). Estilo del paquete: funciones puras, sin clases, sin semicolons, comillas simples, comentarios en español.
- **Anclas de `packages/db/src/types.ts`** (generado, orden alfabético): `contratos` va entre `conductores` y `correos_enviados`; `indicadores_previsionales` entre `gastos_vehiculo` y `links_pago`; `liquidaciones` entre `links_pago` y `miembros`; `trabajadores` entre `suscripciones` y `vehiculos`. Functions: `anular_liquidacion` entre `anular_estado_pago` y `anular_orden_entrega`; `emitir_liquidacion` entre `desactivar_contabilidad` y `facturar_proforma`; `pagar_liquidacion` entre `guardar_cuenta` y `reabrir_ejercicio`. Patrón FK compuesta: dos entradas en `Relationships` (verificado en `cargas_combustible`). `returns void` → `Returns: undefined`, `returns uuid` → `Returns: string`; Args alfabéticos; columnas con default → opcionales en Insert.
- **RUTs nuevos, únicos GLOBALES** (grep = 0 en `scripts`, `supabase`, `apps`, `packages`, verificado al ensamblar): pgTAP Task 3 → org `769800018`, trabajadores `157890123`, `165432096`, `178901230`, `189012349`, y `191234561` (RUT del insert denegado del contador — el borrador usaba `769710019`, que COLISIONA con `estados_financieros.test.sql:16`; corregido). Seed Task 9 → `153312044` (Amanda), `174065926` (Bruno), `128834753` (Carla); E2E → `162847511` (Diego). Cálculo módulo 11 (factores 2..7 desde la derecha; DV = 11 − suma%11, 11→0, 10→K):
  - Empresa `76980001`: 1·2+0·3+0·4+0·5+8·6+9·7+6·2+7·3 = **146**; 146%11 = 3; 11−3 = **8** → `'769800018'`.
  - T1 `15789012`: 4+3+0+45+48+49+10+3 = **162**; 162%11 = 8 → DV **3** → `'157890123'`.
  - T2 `16543209`: 18+0+8+15+24+35+12+3 = **115**; 115%11 = 5 → DV **6** → `'165432096'`.
  - T3 `17890123`: 6+6+4+0+54+56+14+3 = **143**; 143%11 = 0 → 11 → DV **0** → `'178901230'`.
  - T4 `18901234`: 8+9+8+5+0+63+16+3 = **112**; 112%11 = 2 → DV **9** → `'189012349'`.
  - Contador `19123456`: 12+15+16+15+12+7+18+3 = **98**; 98%11 = 10 → DV **1** → `'191234561'`.
- **Seed (`scripts/seed-demo.mjs`):** helpers vigentes `userCli` (cliente ANON firmado como `demo@suite-erp.cl`), `admin` (service_role), `empresaId`, `die(msg, err)`, `cuenta(tabla)`; ancla de inserción `// ----- Resumen de conteos -----` en la línea 486 y `console.log('asientos contables:   ', ...)` en la 509. Usuarios sembrados: `demo@` dueño, `ficticio2@` dueño org 2, `admin@` plataforma — NO hay vendedor sembrado.
- Admin 3002: `apps/admin/app/layout.tsx` NO tiene NAV y el panel es una sola página (`app/page.tsx`); `verificarAdmin()` en `apps/admin/lib/guardia.ts`, `clienteAdmin()` en `@suite/auth/admin`, patrón de acciones en `apps/admin/app/acciones.ts`.
- Contenedor BD local: `supabase_db_ERP_Transportes`.

### Aritmética completa de los goldens (fuente única — pgTAP, core y seed usan ESTOS bytes)

Constantes derivadas de los indicadores canónicos (compartidas por los 4 goldens):

- Tope gratificación mensual = `round(4.75 × 529000 / 12)` = `round(209395.8333…)` = **209396**.
- Tope imponible = `round(87.8 × 39200)` = **3441760** (exacto). Tope cesantía = `round(131.9 × 39200)` = **5170480** (exacto).
- Fronteras de tramos en CLP: `13.5 UTM = 938250`, `30 UTM = 2085000`, `50 UTM = 3475000`. Rebajas: `0.54 UTM = 37530`, `1.74 UTM = 120930`.
- Selección de tramo SEMIABIERTA: `desde_utm × utm < base ≤ hasta_utm × utm` (base exactamente en la frontera cae al tramo inferior; en un borde exacto ambos tramos dan el mismo impuesto — la tabla SII es continua — pero la convención debe ser la misma en SQL y TS).

**G1 — Fonasa indefinido hábitat, sueldo 800000, 30 días, sin extras, no imponibles 50000:**

1. `sueldo_proporcional = round(800000 × 30 / 30)` = **800000**
2. `gratificacion = min(round(0.25 × 800000), 209396) = min(200000, 209396)` = **200000**
3. `total_imponible = min(800000 + 0 + 200000, 3441760)` = **1000000**
4. `afp = round(1000000 × 11.27 / 100)` = **112700**
5. `salud = round(1000000 × 0.07)` = **70000**
6. `cesantia = round(min(1000000, 5170480) × 0.006)` = **6000**
7. `base = 1000000 − 112700 − 70000 − 6000 = 811300` ≤ 938250 (13.5 UTM) → tramo 1 (factor 0) → `impuesto` = **0**
8. `descuentos = 112700 + 70000 + 6000 + 0` = **188700**; `liquido = 1000000 + 50000 − 188700` = **861300**

**G2 — Isapre plazo fijo capital, sueldo 1200000, plan 5.0 UF, 30 días:**

1. `sueldo_proporcional` = **1200000**
2. `gratificacion = min(round(0.25 × 1200000), 209396) = min(300000, 209396)` = **209396** (topa)
3. `total_imponible = min(1200000 + 209396, 3441760)` = **1409396**
4. `afp = round(1409396 × 11.44 / 100) = round(161234.9024)` = **161235**
5. `salud = max(round(0.07 × 1409396), round(5.0 × 39200)) = max(98658, 196000)` = **196000** (el plan es piso)
6. `cesantia` = **0** (plazo fijo: el trabajador no cotiza)
7. `base = 1409396 − 161235 − 196000 = 1052161` ∈ (938250, 2085000] → tramo 2 (0.04 / rebaja 0.54 UTM): `impuesto = round(1052161 × 0.04 − 37530) = round(4556.44)` = **4556**
8. `descuentos = 161235 + 196000 + 0 + 4556` = **361791**; `liquido = 1409396 + 0 − 361791` = **1047605**

**G3 — Fonasa indefinido modelo, sueldo 4000000 (sobre tope imponible), 30 días:**

1. `sueldo_proporcional` = **4000000**
2. `gratificacion = min(round(0.25 × 4000000)=1000000, 209396)` = **209396**
3. `total_imponible = min(4000000 + 209396, 3441760)` = **3441760** (TOPA en 87.8 UF)
4. `afp = round(3441760 × 10.58 / 100) = round(364138.208)` = **364138**
5. `salud = round(3441760 × 0.07) = round(240923.2)` = **240923**
6. `cesantia = round(min(3441760, 5170480) × 0.006) = round(20650.56)` = **20651**
7. `base = 3441760 − 364138 − 240923 − 20651 = 2816048` ∈ (2085000, 3475000] → tramo 3 (0.08 / rebaja 1.74 UTM): `impuesto = round(225283.84 − 120930) = round(104353.84)` = **104354**
8. `descuentos = 364138 + 240923 + 20651 + 104354` = **730066**; `liquido = 3441760 + 0 − 730066` = **2711694**

**G4 — Fonasa indefinido hábitat, sueldo 2500000, 30 días (impuesto tramo 2+):**

1. `sueldo_proporcional` = **2500000**
2. `gratificacion = min(round(0.25 × 2500000)=625000, 209396)` = **209396**
3. `total_imponible = min(2500000 + 209396, 3441760)` = **2709396**
4. `afp = round(2709396 × 11.27 / 100) = round(305348.9292)` = **305349**
5. `salud = round(2709396 × 0.07) = round(189657.72)` = **189658**
6. `cesantia = round(2709396 × 0.006) = round(16256.376)` = **16256**
7. `base = 2709396 − 305349 − 189658 − 16256 = 2198133` ∈ (2085000, 3475000] → tramo 3 (cumple "tramo 2+"): `impuesto = round(175850.64 − 120930) = round(54920.64)` = **54921**
8. `descuentos = 305349 + 189658 + 16256 + 54921` = **566184**; `liquido = 2709396 + 0 − 566184` = **2143212**

Verificación de cuadratura del asiento G1 (regla 8 ⇒ cuadra por construcción): debe gasto `1000000 + 50000 = 1050000` = haber `861300 + 188700 = 1050000`. ✓

Bordes de la suite unit (Task 4), calculados igual: 15 días sobre G1 → proporcional 400000, líquido 455650; G1 plazo fijo → líquido 867300; G2 con plan 2,0 UF → salud 98658 (7% > 78400), líquido 1141053; G3 con tope cesantía forzado a 50 UF → cesantía round(1960000×0.006) = 11760; sueldo mínimo 529000 → afp round(74522,875)=74523, salud round(46287,5)=46288, cesantía round(3967,5)=3968 (tres mitades: fijan el redondeo declarado), base 536471 exenta → impuesto 0, líquido 536471; G4 con no imponibles 80000 → imponible e impuesto idénticos a G4, líquido 2223212; G2 con 1 día trabajado → proporcional 40000, grat 10000, imponible 50000, afp 5720, salud 196000 (piso del plan), base −151720 sin tramo → impuesto 0, líquido −151720 < 0 → guard byte-exacto (lanza en TS, raise en SQL).

---

### Task 1: Migración 0025 — trabajadores, contratos, indicadores previsionales y liquidaciones

**Files:**
- Create: `supabase/migrations/00000000000025_remuneraciones.sql` (termina en la marca `-- ===== RPCs de remuneraciones e integracion contable (Task 2) =====`; Task 2 anexa tras ella, patrón 0022/0024)
- Create (validación, no comiteado): `.superpowers/sdd/smoke-p18-t1.sql`

**Interfaces:**
- Consumes: `public.empresas` con PK `id` (FK de las 3 tablas por empresa), `app.normalizar_rut` / `app.validar_rut` (0002:5-19 — CHECK del rut, patrón `clientes` 0003:69), `app.tiene_rol_en_empresa(emp uuid, roles text[])` (0003:16-30 — RLS por rol), patrón de policies/grants por rol de 0022:120-140.
- Produces (spec §2.1-§2.4 EXACTO): tabla `public.trabajadores` (RLS: SELECT dueno/admin/contador, INSERT/UPDATE dueno/admin, sin DELETE; `unique (empresa_id, rut)`, `unique (empresa_id, id)`); tabla `public.contratos` (mismas policies; CHECKs `tipo`/`afp`/`salud`, plazo fijo ⇒ `fecha_termino`, isapre ⇒ `plan_isapre_uf`; FK compuesta a trabajadores; unique parcial `contratos_vigente_idx (empresa_id, trabajador_id) where vigente`; `unique (empresa_id, id)` — blanco de la FK de liquidaciones); tabla `public.indicadores_previsionales` (PK `periodo` con CHECK `'^\d{4}-(0[1-9]|1[0-2])$'`; SELECT authenticated con `using (true)`; escritura SOLO service_role — cero grants/policies de escritura a authenticated) sembrada con `'2026-05'/'2026-06'/'2026-07'` (2026-06 con los valores canónicos de los goldens; 05/07 con UF/UTM propios — Global Constraints); tabla `public.liquidaciones` (snapshot completo cálculo+contexto; SELECT por rol contable; CERO escritura directa; FKs compuestas a trabajadores y contratos; unique parcial `liquidaciones_periodo_idx (empresa_id, trabajador_id, periodo) where estado <> 'anulada'`).

- [ ] **Step 1: Escribir la migración**

`supabase/migrations/00000000000025_remuneraciones.sql` (UTF-8 SIN BOM; comentarios ASCII sin tildes, mensajes con tildes — acá solo hay DDL):

```sql
-- Remuneraciones (Plan 18), capa 1 (Task 1): trabajadores y contratos (maestros
-- por empresa con RLS POR ROL: dueno/admin escriben, contador lee, vendedor y
-- bodeguero ven 0 filas — datos sensibles, spec §2.1), indicadores_previsionales
-- (tabla de PLATAFORMA sin empresa_id: lectura authenticated, escritura SOLO
-- service_role desde el panel admin) y liquidaciones (INMUTABLE emitida:
-- snapshot completo de calculo y contexto; CERO escritura directa — solo las
-- RPCs de Task 2 la mueven). Task 2 anexa emitir/pagar/anular_liquidacion, el
-- origen 'remuneracion', las 3 anclas contables y los re-creates tras la marca
-- del final.

-- ---------- trabajadores (maestro por empresa; sensible: RLS por rol) ----------
-- Sin DELETE: desactivar (activo = false). rut normalizado y con DV correcto
-- tambien en la BD (ultima linea de defensa, patron clientes 0003).
create table public.trabajadores (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  rut text not null check (rut = app.normalizar_rut(rut) and app.validar_rut(rut)),
  nombre text not null,
  email text,
  telefono text,
  direccion text,
  fecha_nacimiento date,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  unique (empresa_id, rut),
  unique (empresa_id, id)
);

-- ---------- contratos (historia laboral; a lo mas UNO vigente por trabajador) ----------
-- Cambiar condiciones = cerrar (vigente = false) + crear uno nuevo (dos writes
-- en la Server Action; no-atomico aceptado por el spec §4: el peor caso queda
-- sin contrato vigente, visible y reparable).
create table public.contratos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  trabajador_id uuid not null,
  tipo text not null check (tipo in ('indefinido', 'plazo_fijo')),
  fecha_inicio date not null,
  fecha_termino date,
  cargo text not null,
  sueldo_base integer not null check (sueldo_base > 0),
  gratificacion_legal boolean not null default true,
  afp text not null check (afp in ('capital', 'cuprum', 'habitat', 'modelo', 'planvital', 'provida', 'uno')),
  salud text not null check (salud in ('fonasa', 'isapre')),
  plan_isapre_uf numeric(6, 2),
  vigente boolean not null default true,
  creado_en timestamptz not null default now(),
  -- Plazo fijo exige fecha de termino; isapre exige el plan pactado en UF.
  check (tipo <> 'plazo_fijo' or fecha_termino is not null),
  check (salud <> 'isapre' or plan_isapre_uf is not null),
  unique (empresa_id, id),
  foreign key (empresa_id, trabajador_id) references public.trabajadores (empresa_id, id)
);
-- Un contrato vigente por trabajador (unique parcial).
create unique index contratos_vigente_idx
  on public.contratos (empresa_id, trabajador_id) where vigente;

-- ---------- indicadores_previsionales (tabla de PLATAFORMA; sin empresa_id) ----------
-- Un registro por periodo 'YYYY-MM'. Lectura para todo authenticated (datos
-- publicos); escritura SOLO service_role (panel admin 3002): cero grants ni
-- policies de escritura a authenticated.
create table public.indicadores_previsionales (
  periodo text primary key check (periodo ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  uf integer not null check (uf > 0),
  utm integer not null check (utm > 0),
  ingreso_minimo integer not null check (ingreso_minimo > 0),
  tope_imponible_uf numeric(5, 1) not null check (tope_imponible_uf > 0),
  tope_cesantia_uf numeric(5, 1) not null check (tope_cesantia_uf > 0),
  tasas_afp jsonb not null,
  tramos_impuesto jsonb not null,
  actualizado_en timestamptz not null default now()
);

-- ---------- liquidaciones (INMUTABLE emitida; snapshot completo) ----------
-- Estados: 'borrador' RESERVADO (v1 no lo usa: emitir inserta directo en
-- 'emitida'); emitida -> pagada; emitida o pagada -> anulada (con motivo). El
-- snapshot de calculo + contexto hace que la liquidacion se explique sola
-- aunque cambien el contrato o los indicadores. CERO escritura directa: solo
-- emitir/pagar/anular_liquidacion (Task 2).
create table public.liquidaciones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  trabajador_id uuid not null,
  contrato_id uuid not null,
  periodo text not null check (periodo ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  estado text not null default 'borrador' check (estado in ('borrador', 'emitida', 'pagada', 'anulada')),
  -- Inputs del cliente (lo UNICO que la RPC no recalcula).
  dias_trabajados integer not null default 30 check (dias_trabajados between 1 and 30),
  extras_imponibles integer not null default 0 check (extras_imponibles >= 0),
  no_imponibles integer not null default 0 check (no_imponibles >= 0),
  -- Snapshot del calculo (CLP enteros; reglas 1-8 del spec §3).
  sueldo_proporcional integer not null,
  gratificacion integer not null,
  total_imponible integer not null,
  afp_monto integer not null,
  salud_monto integer not null,
  cesantia_monto integer not null,
  impuesto_unico integer not null,
  total_descuentos integer not null,
  liquido integer not null,
  -- Snapshot de contexto (auditabilidad).
  sueldo_base integer not null,
  afp text not null,
  tasa_afp numeric(5, 2) not null,
  salud text not null,
  plan_isapre_uf numeric(6, 2),
  uf integer not null,
  utm integer not null,
  emitida_en timestamptz,
  pagada_en timestamptz,
  anulada_en timestamptz,
  motivo_anulacion text,
  creado_en timestamptz not null default now(),
  unique (empresa_id, id),
  foreign key (empresa_id, trabajador_id) references public.trabajadores (empresa_id, id),
  foreign key (empresa_id, contrato_id) references public.contratos (empresa_id, id)
);
-- Una liquidacion NO-anulada por (empresa, trabajador, periodo): anular libera
-- el periodo y se puede volver a emitir.
create unique index liquidaciones_periodo_idx
  on public.liquidaciones (empresa_id, trabajador_id, periodo) where estado <> 'anulada';

-- ---------- RLS ----------
alter table public.trabajadores enable row level security;
alter table public.contratos enable row level security;
alter table public.indicadores_previsionales enable row level security;
alter table public.liquidaciones enable row level security;

-- trabajadores/contratos: SELECT dueno/admin/contador; INSERT/UPDATE dueno/admin.
create policy "contables ven trabajadores" on public.trabajadores
  for select to authenticated
  using (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin', 'contador']));
create policy "duenos crean trabajadores" on public.trabajadores
  for insert to authenticated
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']));
create policy "duenos editan trabajadores" on public.trabajadores
  for update to authenticated
  using (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']))
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']));

create policy "contables ven contratos" on public.contratos
  for select to authenticated
  using (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin', 'contador']));
create policy "duenos crean contratos" on public.contratos
  for insert to authenticated
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']));
create policy "duenos editan contratos" on public.contratos
  for update to authenticated
  using (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']))
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']));

-- indicadores: datos publicos de plataforma (lectura para todo authenticated).
create policy "autenticados ven indicadores" on public.indicadores_previsionales
  for select to authenticated
  using (true);

-- liquidaciones: SELECT por rol; CERO escritura directa (ni policy ni grant).
create policy "contables ven liquidaciones" on public.liquidaciones
  for select to authenticated
  using (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin', 'contador']));

-- ---------- Grants Data API (leccion Plan 1: sin esto todo da 42501) ----------
grant select, insert, update on public.trabajadores, public.contratos to authenticated;
grant select on public.indicadores_previsionales, public.liquidaciones to authenticated;
grant select, insert, update, delete on public.trabajadores, public.contratos,
  public.indicadores_previsionales, public.liquidaciones to service_role;

-- ---------- Seed de indicadores (2026-06 canonico; el admin los mantiene) ----------
-- UF y UTM varian por mes (valores representativos, spec §2.3: el admin de
-- plataforma los corrige desde su panel; la fuente oficial queda pendiente en
-- docs/credenciales-pendientes.md #14). 2026-06 es el periodo CANONICO de los
-- goldens del plan: sus valores NO se tocan sin recalcular los goldens.
-- IMM/topes/tasas/tramos compartidos por los 3 meses. Tasas AFP en % total con
-- comision; tramos del impuesto unico de segunda categoria (mensual): factor
-- sobre la base en CLP, rebaja en UTM, intervalos semiabiertos (desde, hasta].
insert into public.indicadores_previsionales
  (periodo, uf, utm, ingreso_minimo, tope_imponible_uf, tope_cesantia_uf, tasas_afp, tramos_impuesto)
select p.periodo, p.uf, p.utm, 529000, 87.8, 131.9,
  '{"capital": 11.44, "cuprum": 11.44, "habitat": 11.27, "modelo": 10.58, "planvital": 11.10, "provida": 11.45, "uno": 10.49}'::jsonb,
  '[
    {"desde_utm": 0,    "hasta_utm": 13.5, "factor": 0,     "rebaja_utm": 0},
    {"desde_utm": 13.5, "hasta_utm": 30,   "factor": 0.04,  "rebaja_utm": 0.54},
    {"desde_utm": 30,   "hasta_utm": 50,   "factor": 0.08,  "rebaja_utm": 1.74},
    {"desde_utm": 50,   "hasta_utm": 70,   "factor": 0.135, "rebaja_utm": 4.49},
    {"desde_utm": 70,   "hasta_utm": 90,   "factor": 0.23,  "rebaja_utm": 11.14},
    {"desde_utm": 90,   "hasta_utm": 120,  "factor": 0.304, "rebaja_utm": 17.8},
    {"desde_utm": 120,  "hasta_utm": 310,  "factor": 0.35,  "rebaja_utm": 23.32},
    {"desde_utm": 310,  "hasta_utm": null, "factor": 0.4,   "rebaja_utm": 38.82}
  ]'::jsonb
from (values ('2026-05', 39050, 69200), ('2026-06', 39200, 69500), ('2026-07', 39350, 69800)) as p (periodo, uf, utm);

-- ===== RPCs de remuneraciones e integracion contable (Task 2) =====
```

- [ ] **Step 2: Aplicar y verificar**

Run: `npx supabase db reset` → aplica 0001-0025 sin errores (0025 termina en la marca; las RPCs llegan en Task 2). El seed de indicadores inserta 3 filas fijas (tabla de plataforma, sin empresas de por medio).

Run: `npx supabase test db` → **18 archivos, 363 asserts** verdes (Task 1 no re-crea nada: los asserts `'11/...'` siguen intactos hasta Task 2).

Validación en vivo (transaccional, TODO se revierte). Escribir (Write tool, UTF-8 sin BOM) `.superpowers/sdd/smoke-p18-t1.sql`:

```sql
\set ON_ERROR_STOP on
begin;

-- Fixture minima (superuser; rollback al final; uuids/RUTs del patron pgTAP, no comiteados)
insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'ana@a.cl'),
  ('00000000-0000-0000-0000-000000000000', '55555555-5555-5555-5555-555555555555', 'authenticated', 'authenticated', 'ces@a.cl'),
  ('00000000-0000-0000-0000-000000000000', '77777777-7777-7777-7777-777777777777', 'authenticated', 'authenticated', 'vero@a.cl');
insert into public.organizaciones (id, rut, razon_social)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '769010007', 'Org A');
insert into public.empresas (id, organizacion_id, rut, razon_social)
values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '769010007', 'Remu A');
insert into public.miembros (usuario_id, organizacion_id, rol)
values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'dueno'),
       ('55555555-5555-5555-5555-555555555555', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'contador'),
       ('77777777-7777-7777-7777-777777777777', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'vendedor');

-- 1) Seed de indicadores: 3 periodos con las constantes canonicas
select periodo, uf, utm, ingreso_minimo, tope_imponible_uf, tope_cesantia_uf,
       tasas_afp ->> 'habitat' as habitat, jsonb_array_length(tramos_impuesto) as tramos
from indicadores_previsionales order by periodo;

-- 2) Duena crea trabajador + contrato (camino real via RLS) y los ve
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
insert into public.trabajadores (id, empresa_id, rut, nombre)
values ('10000000-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '769031006', 'Gabriela Prueba');
insert into public.contratos (id, empresa_id, trabajador_id, tipo, fecha_inicio, cargo, sueldo_base, afp, salud)
values ('20000000-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '10000000-0000-0000-0000-000000000001',
        'indefinido', date '2026-01-01', 'Operaria', 800000, 'habitat', 'fonasa');
select count(*) as duena_ve_trabajadores from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa';

-- 3) Contador LEE (1 fila) pero NO escribe (RLS with check -> 42501)
set local request.jwt.claims to '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated"}';
select count(*) as contador_ve from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa';
do $do$
begin
  insert into trabajadores (empresa_id, rut, nombre)
  values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '111111111', 'Hack Contador');
  raise notice 'FALLO: el contador inserto';
exception when insufficient_privilege then
  raise notice 'OK contador no escribe trabajadores';
end $do$;

-- 4) Vendedora: 0 filas en las 3 tablas por empresa
set local request.jwt.claims to '{"sub": "77777777-7777-7777-7777-777777777777", "role": "authenticated"}';
select (select count(*) from trabajadores)
     + (select count(*) from contratos)
     + (select count(*) from liquidaciones) as vendedora_total;

-- 5) Escritura directa bloqueada: liquidaciones (sin grant) e indicadores (solo lectura)
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
do $do$
begin
  insert into liquidaciones (empresa_id, trabajador_id, contrato_id, periodo)
  values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '10000000-0000-0000-0000-000000000001',
          '20000000-0000-0000-0000-000000000001', '2026-06');
  raise notice 'FALLO: inserto liquidacion directa';
exception when insufficient_privilege then
  raise notice 'OK 42501 liquidaciones sin escritura directa';
end $do$;
do $do$
begin
  update indicadores_previsionales set uf = 1 where periodo = '2026-06';
  raise notice 'FALLO: edito indicadores';
exception when insufficient_privilege then
  raise notice 'OK 42501 indicadores solo lectura';
end $do$;

-- 6) Candados de schema: plazo fijo sin termino (23514) y segundo vigente (23505)
do $do$
begin
  insert into contratos (empresa_id, trabajador_id, tipo, fecha_inicio, cargo, sueldo_base, afp, salud)
  values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '10000000-0000-0000-0000-000000000001',
          'plazo_fijo', date '2026-01-01', 'Temporal', 500000, 'modelo', 'fonasa');
  raise notice 'FALLO: plazo fijo sin termino';
exception when check_violation then
  raise notice 'OK check plazo fijo exige fecha de termino';
end $do$;
do $do$
begin
  insert into contratos (empresa_id, trabajador_id, tipo, fecha_inicio, cargo, sueldo_base, afp, salud)
  values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '10000000-0000-0000-0000-000000000001',
          'indefinido', date '2026-02-01', 'Doble', 900000, 'uno', 'fonasa');
  raise notice 'FALLO: segundo contrato vigente';
exception when unique_violation then
  raise notice 'OK unique parcial: un contrato vigente por trabajador';
end $do$;

reset role;
rollback;
```

Run (Bash tool / Git Bash — NO PowerShell 5.1: su pipe re-encoda las tildes UTF-8 a ANSI y los mensajes compararían mojibake):

```bash
cat .superpowers/sdd/smoke-p18-t1.sql | docker exec -i supabase_db_ERP_Transportes psql -U postgres -d postgres -v ON_ERROR_STOP=1
```

Salida esperada (valores, en orden):
- (1) 3 filas, en orden: `2026-05 | 39050 | 69200 | 529000 | 87.8 | 131.9 | 11.27 | 8`, `2026-06 | 39200 | 69500 | 529000 | 87.8 | 131.9 | 11.27 | 8`, `2026-07 | 39350 | 69800 | 529000 | 87.8 | 131.9 | 11.27 | 8`.
- (2) `duena_ve_trabajadores = 1`.
- (3) `contador_ve = 1`; `NOTICE:  OK contador no escribe trabajadores`.
- (4) `vendedora_total = 0`.
- (5) `NOTICE:  OK 42501 liquidaciones sin escritura directa`; `NOTICE:  OK 42501 indicadores solo lectura`.
- (6) `NOTICE:  OK check plazo fijo exige fecha de termino`; `NOTICE:  OK unique parcial: un contrato vigente por trabajador`.
- Cierre: `ROLLBACK` (nada persiste).

Byte-scan del archivo (JAMÁS BOM U+FEFF):

```bash
grep -c $'\xEF\xBB\xBF' supabase/migrations/00000000000025_remuneraciones.sql
```

→ imprime `0` y sale con status 1 (sin coincidencias = pass).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/00000000000025_remuneraciones.sql
git commit -m "feat(db): remuneraciones — trabajadores, contratos, indicadores previsionales y liquidaciones con RLS por rol

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Migración 0025 (sección 2) — emitir/pagar/anular liquidación, origen 'remuneracion', 3 anclas y re-creates contables

**Files:**
- Modify: `supabase/migrations/00000000000025_remuneraciones.sql` (anexa DESPUÉS de la marca `-- ===== RPCs de remuneraciones e integracion contable (Task 2) =====`; la marca se conserva, patrón 0022/0024)
- Modify: `supabase/tests/database/contabilidad.test.sql` (assert 1: `'11/true'` → `'14/true'`)
- Modify: `supabase/tests/database/estados_financieros.test.sql` (assert 1: `'11/patrimonio:true'` → `'14/patrimonio:true'`)
- Create (validación, no comiteado): `.superpowers/sdd/smoke-p18-t2.sql`

**Interfaces:**
- Consumes (Task 1, mismo archivo): `trabajadores` / `contratos` (contrato vigente único: `contratos_vigente_idx`) / `indicadores_previsionales` (seed canónico) / `liquidaciones` (unique parcial `liquidaciones_periodo_idx` — backstop de la doble emisión). Del schema previo, los cuerpos VIGENTES de 0024 (esos se re-crean, NO los de 0022): `activar_contabilidad` (0024:81-133), `contabilizar_documento` (0024:296-464, con el clamp), `contabilizar_pendientes` (0024:469-525, order by clampeado), `revision_periodo` (0024:713-956 — su regla 1 usa el mismo union de pendientes con alias `t(origen, referencia_id, fecha)`); además `app._fecha_contable` (0024:141-159 — la fecha del asiento la pasa por aquí la línea compartida de `contabilizar_documento`), `app._insertar_asiento` (0024:164-232 — NO se toca, solo se invoca), el CHECK vigente `asientos_origen_check` (0024:51-54, lista con `'cierre'`), `unique (empresa_id, codigo)` (0022:68) y el unique parcial de `clave_sistema` (0022:70-71 — idempotencia del backfill), `app.tiene_rol_en_empresa` (0003:16-30).
- Produces:
  - `public.emitir_liquidacion(p_empresa uuid, p_trabajador uuid, p_periodo text, p_dias integer, p_extras integer, p_no_imponibles integer) returns uuid` — rol dueno/admin/contador; cálculo completo spec §3 (reglas 1-8 en orden, `round()` numeric); guard fail-closed tras la regla 8: líquido < 0 → `'El líquido no puede ser negativo: revisa los días trabajados y los descuentos'` (Global Constraints); inserta directo en `'emitida'` con todos los snapshots; SIN advisory lock (no crea asientos).
  - `public.pagar_liquidacion(p_empresa uuid, p_liquidacion uuid) returns void` — emitida → pagada.
  - `public.anular_liquidacion(p_empresa uuid, p_liquidacion uuid, p_motivo text) returns void` — emitida O pagada → anulada con motivo; la reversa contable la maneja el hook (task de UI), NO esta RPC.
  - `asientos_origen_check` re-emitido con `'remuneracion'` (lista 0024 + 1).
  - 3 anclas: seed en `activar_contabilidad` re-creada (VERBATIM 0024 + 2 claves en filas existentes `2.1.04`/`5.1.02` + 1 fila nueva `2.1.06` — catálogo **29 cuentas / 14 claves / 5 grupos**) + backfill a empresas ya activas (reclamo de fila prístina, si no insert código-libre — patrón 0024).
  - `contabilizar_documento` re-creada (VERBATIM 0024 + rama `'remuneracion'`): debe `gasto_remuneraciones` = `total_imponible + no_imponibles`; haber `remuneraciones_por_pagar` = `liquido`; haber `retenciones_por_pagar` = `total_descuentos`; fecha = último día del mes del período (el clamp `app._fecha_contable` ya la cubre); anulada/borrador → not found → `'noop'`.
  - `contabilizar_pendientes` re-creada (VERBATIM 0024 + 1 rama `union all`): liquidaciones `emitida`/`pagada` sin asiento entran al catch-up.
  - `revision_periodo` re-creada (VERBATIM 0024:713-956 + la MISMA rama `union all` en la subconsulta de la regla 1): las liquidaciones emitidas/pagadas sin asiento cuentan como `documentos_sin_contabilizar` — el Contador Auditor las ve (spec §5). Los pgTAP existentes de la revisión siguen verdes (sin liquidaciones en sus fixtures, el conteo no cambia).
  - Parches pgTAP `'11/…'` → `'14/…'` (mismo conteo: `plan(36)` en ambos; suite sigue en 363).
- Mensajes byte-exactos (spec §4): `'Tu rol no permite emitir liquidaciones'` (también pagar/anular: §4 dice "mismos roles" y no define mensajes propios), `'Período no válido'`, `'El trabajador no tiene contrato vigente'`, `'No hay indicadores previsionales para el período'`, `'Ya existe una liquidación de ese período'`, `'Solo se puede pagar una liquidación emitida'`, `'Indica el motivo de la anulación'`, y (fijados por este plan, §4 no los define) `'Solo se puede anular una liquidación emitida o pagada'` y `'El líquido no puede ser negativo: revisa los días trabajados y los descuentos'`.

- [ ] **Step 1: Anexar la sección 2 a la migración**

Anexar a `supabase/migrations/00000000000025_remuneraciones.sql`, DESPUÉS de la marca (que se conserva):

```sql
-- ================== Remuneraciones: RPCs e integracion contable (Task 2) ==================
-- security definer + set search_path = public. emitir/pagar/anular NO crean
-- asientos (el asiento va por contabilizar_documento via hook nunca-lanza de la
-- Server Action) => NO toman el advisory lock del correlativo; la carrera de
-- doble emision la cierra el unique parcial liquidaciones_periodo_idx
-- (backstop 23505 -> mensaje contractual).

-- ---------- asientos.origen: se suma 'remuneracion' ----------
-- drop + re-add (un CHECK no admite ALTER en su lugar; patron 0018/0022/0024).
-- Lista vigente = la de 0024 (con 'cierre') + 'remuneracion'.
alter table public.asientos drop constraint asientos_origen_check;
alter table public.asientos add constraint asientos_origen_check
  check (origen in
    ('manual', 'venta', 'nota_credito', 'compra', 'pago', 'pago_proveedor', 'anticipo', 'reversa', 'cierre', 'remuneracion'));

-- ---------- Backfill: las 3 anclas de remuneraciones en empresas ya activas ----------
-- Dos pasos por ancla (retenciones solo inserta: su fila no existia en 0022):
-- (a) RECLAMO de la fila pristina del seed (mismo codigo+nombre+tipo, hoja,
--     activa, sin clave): la fila historica pasa a ser el ancla y los asientos
--     manuales que ya apuntaban a ella ruedan solos; si el usuario la edito,
--     renombro o desactivo, NO se toca (fail-closed).
-- (b) Resto: insert codigo-libre por empresa (patron 0024: el menor codigo
--     libre del grupo; JAMAS on conflict do nothing — dejaria empresas sin
--     ancla y contabilizar reventaria). El ORDEN importa: el segundo insert
--     del grupo 2 ve el codigo que tomo el primero.

-- (a) remuneraciones_por_pagar: reclamo de '2.1.04 Remuneraciones por pagar'.
update public.cuentas_contables c
set clave_sistema = 'remuneraciones_por_pagar'
where c.codigo = '2.1.04' and c.nombre = 'Remuneraciones por pagar' and c.tipo = 'pasivo'
  and c.acepta_movimientos and c.activa and c.clave_sistema is null
  and exists (select 1 from public.cuentas_contables x
              where x.empresa_id = c.empresa_id and x.clave_sistema is not null)
  and not exists (select 1 from public.cuentas_contables x
                  where x.empresa_id = c.empresa_id and x.clave_sistema = 'remuneraciones_por_pagar');
-- (b) remuneraciones_por_pagar: codigo libre para las empresas restantes.
insert into public.cuentas_contables (empresa_id, codigo, nombre, tipo, acepta_movimientos, clave_sistema)
select e.id,
       (select '2.1.0' || n from generate_series(6, 99) as n
        where not exists (select 1 from public.cuentas_contables c2
                          where c2.empresa_id = e.id and c2.codigo = '2.1.0' || n)
        order by n limit 1),
       'Remuneraciones por pagar', 'pasivo', true, 'remuneraciones_por_pagar'
from public.empresas e
where exists (select 1 from public.cuentas_contables c
              where c.empresa_id = e.id and c.clave_sistema is not null)
  and not exists (select 1 from public.cuentas_contables c
                  where c.empresa_id = e.id and c.clave_sistema = 'remuneraciones_por_pagar');

-- retenciones_por_pagar: solo insert (no hay fila 0022 que reclamar).
insert into public.cuentas_contables (empresa_id, codigo, nombre, tipo, acepta_movimientos, clave_sistema)
select e.id,
       (select '2.1.0' || n from generate_series(6, 99) as n
        where not exists (select 1 from public.cuentas_contables c2
                          where c2.empresa_id = e.id and c2.codigo = '2.1.0' || n)
        order by n limit 1),
       'Retenciones previsionales por pagar', 'pasivo', true, 'retenciones_por_pagar'
from public.empresas e
where exists (select 1 from public.cuentas_contables c
              where c.empresa_id = e.id and c.clave_sistema is not null)
  and not exists (select 1 from public.cuentas_contables c
                  where c.empresa_id = e.id and c.clave_sistema = 'retenciones_por_pagar');

-- (a) gasto_remuneraciones: reclamo de '5.1.02 Remuneraciones'.
update public.cuentas_contables c
set clave_sistema = 'gasto_remuneraciones'
where c.codigo = '5.1.02' and c.nombre = 'Remuneraciones' and c.tipo = 'gasto'
  and c.acepta_movimientos and c.activa and c.clave_sistema is null
  and exists (select 1 from public.cuentas_contables x
              where x.empresa_id = c.empresa_id and x.clave_sistema is not null)
  and not exists (select 1 from public.cuentas_contables x
                  where x.empresa_id = c.empresa_id and x.clave_sistema = 'gasto_remuneraciones');
-- (b) gasto_remuneraciones: codigo libre para las empresas restantes.
insert into public.cuentas_contables (empresa_id, codigo, nombre, tipo, acepta_movimientos, clave_sistema)
select e.id,
       (select '5.1.0' || n from generate_series(6, 99) as n
        where not exists (select 1 from public.cuentas_contables c2
                          where c2.empresa_id = e.id and c2.codigo = '5.1.0' || n)
        order by n limit 1),
       'Remuneraciones', 'gasto', true, 'gasto_remuneraciones'
from public.empresas e
where exists (select 1 from public.cuentas_contables c
              where c.empresa_id = e.id and c.clave_sistema is not null)
  and not exists (select 1 from public.cuentas_contables c
                  where c.empresa_id = e.id and c.clave_sistema = 'gasto_remuneraciones');

-- ---------- RE-CREATE activar_contabilidad (VERBATIM 0024 + 3 anclas) ----------
-- Cambios contra 0024: '2.1.04' y '5.1.02' GANAN clave_sistema (eran filas del
-- seed sin clave; asi no nacen nombres duplicados) y se suma la fila '2.1.06'
-- Retenciones previsionales por pagar. El catalogo queda en 29 cuentas /
-- 14 claves / 5 grupos.
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
      (p_empresa, '5.1.05', 'Gastos generales',           'gasto',      true,  null);
  end if;

  update empresas set modulo_contabilidad = true where id = p_empresa;
end $$;
revoke execute on function public.activar_contabilidad(uuid) from anon, public;
grant execute on function public.activar_contabilidad(uuid) to authenticated;
```

Continuar anexando (mismo bloque, a continuación):

```sql
-- ---------- Emitir liquidacion (dueno/admin/contador; calculo AUTORITATIVO) ----------
-- Los unicos inputs del cliente son dias/extras/no imponibles: TODO lo demas se
-- recalcula aqui desde el contrato vigente + los indicadores del periodo
-- (reglas 1-8 del spec §3). round() de Postgres sobre numeric = mitad lejos de
-- cero; el espejo TS de core replica ese redondeo con los mismos goldens.
-- Inserta directo en 'emitida' (la vista previa vive en la UI; el borrador
-- persistido es YAGNI v1). Sin advisory lock: no crea asientos; la doble
-- emision concurrente muere en el unique parcial (backstop 23505 -> mensaje
-- contractual). Los CHECKs de la tabla (dias 1-30, extras/no imponibles >= 0)
-- son el candado de rango de los inputs.
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
  v_id uuid;
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'contador']) then
    raise exception 'Tu rol no permite emitir liquidaciones';
  end if;
  if p_periodo is null or p_periodo !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Período no válido';
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

  begin
    insert into liquidaciones (
      empresa_id, trabajador_id, contrato_id, periodo, estado,
      dias_trabajados, extras_imponibles, no_imponibles,
      sueldo_proporcional, gratificacion, total_imponible,
      afp_monto, salud_monto, cesantia_monto, impuesto_unico,
      total_descuentos, liquido,
      sueldo_base, afp, tasa_afp, salud, plan_isapre_uf, uf, utm, emitida_en)
    values (
      p_empresa, p_trabajador, v_con.id, p_periodo, 'emitida',
      v_dias, v_extras, v_no_imp,
      v_proporcional, v_gratificacion, v_imponible,
      v_afp, v_salud, v_cesantia, v_impuesto,
      v_descuentos, v_liquido,
      v_con.sueldo_base, v_con.afp, v_tasa, v_con.salud, v_con.plan_isapre_uf,
      v_ind.uf, v_ind.utm, now())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Ya existe una liquidación de ese período';
  end;
  return v_id;
end $$;
revoke execute on function public.emitir_liquidacion(uuid, uuid, text, integer, integer, integer) from anon, public;
grant execute on function public.emitir_liquidacion(uuid, uuid, text, integer, integer, integer) to authenticated;

-- ---------- Pagar liquidacion (mismos roles; emitida -> pagada) ----------
-- El update re-evalua el estado bajo el row lock: dos pagos concurrentes dejan
-- al segundo con 0 filas -> mensaje contractual.
create or replace function public.pagar_liquidacion(p_empresa uuid, p_liquidacion uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'contador']) then
    raise exception 'Tu rol no permite emitir liquidaciones';
  end if;
  update liquidaciones
  set estado = 'pagada', pagada_en = now()
  where id = p_liquidacion and empresa_id = p_empresa and estado = 'emitida';
  if not found then
    raise exception 'Solo se puede pagar una liquidación emitida';
  end if;
end $$;
revoke execute on function public.pagar_liquidacion(uuid, uuid) from anon, public;
grant execute on function public.pagar_liquidacion(uuid, uuid) to authenticated;

-- ---------- Anular liquidacion (mismos roles; emitida O pagada -> anulada) ----------
-- La reversa contable NO va aqui: la maneja el hook nunca-lanza de la Server
-- Action (revertir_asiento si habia asiento). Tras anular, el unique parcial
-- libera el periodo y se puede volver a emitir.
create or replace function public.anular_liquidacion(
  p_empresa uuid, p_liquidacion uuid, p_motivo text
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_motivo text;
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'contador']) then
    raise exception 'Tu rol no permite emitir liquidaciones';
  end if;
  v_motivo := nullif(trim(coalesce(p_motivo, '')), '');
  if v_motivo is null then
    raise exception 'Indica el motivo de la anulación';
  end if;
  update liquidaciones
  set estado = 'anulada', anulada_en = now(), motivo_anulacion = v_motivo
  where id = p_liquidacion and empresa_id = p_empresa and estado in ('emitida', 'pagada');
  if not found then
    raise exception 'Solo se puede anular una liquidación emitida o pagada';
  end if;
end $$;
revoke execute on function public.anular_liquidacion(uuid, uuid, text) from anon, public;
grant execute on function public.anular_liquidacion(uuid, uuid, text) to authenticated;
```

Continuar anexando (mismo bloque, a continuación). `contabilizar_documento` es VERBATIM 0024:296-464 con DOS cambios: la variable `v_liq record;` en el declare y la rama `elsif p_origen = 'remuneracion'` antes del `else`. La línea compartida `v_fecha := app._fecha_contable(p_empresa, v_fecha);` de 0024 queda INTACTA y también clampea la fecha de remuneraciones:

```sql
-- ---------- RE-CREATE contabilizar_documento (VERBATIM 0024 + rama 'remuneracion') ----------
-- Cambios contra 0024: v_liq en el declare y la rama nueva. Regla: debe Gasto
-- remuneraciones (total_imponible + no_imponibles) / haber Remuneraciones por
-- pagar (liquido) + Retenciones previsionales por pagar (total_descuentos).
-- Cuadra por construccion (regla 8: liquido = imponible + no_imp - descuentos).
-- Fecha = ultimo dia del mes del periodo; el clamp de app._fecha_contable
-- (linea compartida) la respeta contra ejercicios cerrados. Liquidacion
-- anulada o borrador -> not found -> noop (patron P16).
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
    select periodo, trabajador_id, total_imponible, no_imponibles, total_descuentos, liquido
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
    -- Debe Gasto remuneraciones(imponible + no imponibles) /
    -- Haber Remuneraciones por pagar(liquido) + Retenciones por pagar(descuentos).
    select coalesce(jsonb_agg(jsonb_build_object('cuentaId', cuenta, 'debe', debe, 'haber', haber) order by ord), '[]'::jsonb)
    into v_lineas
    from (
                    select 1 as ord, (select id from cuentas_contables where empresa_id = p_empresa and clave_sistema = 'gasto_remuneraciones')     as cuenta, (v_liq.total_imponible + v_liq.no_imponibles) as debe, 0 as haber
      union all select 2,          (select id from cuentas_contables where empresa_id = p_empresa and clave_sistema = 'remuneraciones_por_pagar'),           0, v_liq.liquido
      union all select 3,          (select id from cuentas_contables where empresa_id = p_empresa and clave_sistema = 'retenciones_por_pagar'),              0, v_liq.total_descuentos
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

-- ---------- RE-CREATE contabilizar_pendientes (VERBATIM 0024 + 1 rama) ----------
-- Unico cambio: el union all de liquidaciones emitidas/pagadas sin asiento
-- (fecha = ultimo dia del mes del periodo, la misma expresion de la rama de
-- contabilizar_documento; el order by clampeado de 0024 queda intacto).
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
```

Continuar anexando (mismo bloque, a continuación): el RE-CREATE de `revision_periodo`, VERBATIM 0024 con UN solo cambio — la rama `union all` de liquidaciones en la subconsulta `from ( … ) t` de la regla 1 (`documentos_sin_contabilizar`); sin ella el auditor P17 quedaría ciego a liquidaciones sin contabilizar (spec §5). Procedimiento exacto (COPIAR, no re-tipear):

1. Anexar este encabezado a la migración:

```sql
-- ---------- RE-CREATE revision_periodo (VERBATIM 0024 + rama 'remuneracion' en la regla 1) ----------
-- Unico cambio contra 0024: la subconsulta de la regla 1 suma las
-- liquidaciones emitidas/pagadas sin asiento, con la MISMA expresion de fecha
-- que contabilizar_documento/contabilizar_pendientes (ultimo dia del mes del
-- periodo). Reglas 2-7, estado final, revoke y grant: byte a byte desde 0024.
```

2. Copiar a continuación, byte a byte desde `supabase/migrations/00000000000024_estados_financieros.sql` líneas 718-956, el bloque completo `create or replace function public.revision_periodo(…)` … `grant execute on function public.revision_periodo(uuid, integer, integer) to authenticated;`.

3. En el cuerpo recién copiado, insertar el delta EXACTO dentro de la subconsulta de la regla 1 — entre la rama de anticipos (su última línea es `where a.empresa_id = p_empresa and a.mp_payment_id is not null`) y el cierre `  ) t`:

```sql
    union all select 'remuneracion', l.id, (to_date(l.periodo || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date
    from liquidaciones l
    where l.empresa_id = p_empresa and l.estado in ('emitida', 'pagada')
```

4. Diff de control contra 0024:718-956: la ÚNICA diferencia debe ser esas 3 líneas (los pgTAP existentes de la revisión siguen verdes: sus fixtures no tienen liquidaciones, así que sus conteos no cambian).

- [ ] **Step 2: Parche mínimo de los asserts que cuentan anclas (mismo commit)**

El re-create de `activar_contabilidad` sube las claves de 11 a 14 y rompe DOS asserts existentes. `plan(36)` NO cambia en ninguno de los dos archivos (solo cambian valores esperados; la suite sigue en 363).

En `supabase/tests/database/contabilidad.test.sql` (líneas 79-87), reemplazar (Edit, coincidencia exacta):

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

por:

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

En `supabase/tests/database/estados_financieros.test.sql` (líneas 60-69), reemplazar (Edit, coincidencia exacta):

```sql
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
```

por:

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

- [ ] **Step 3: Aplicar y verificar (incluye los 4 goldens en vivo)**

Run: `npx supabase db reset` → aplica 0001-0025 completa sin errores. El backfill corre sobre tablas vacías (las migraciones preceden al seed) → reclama/inserta 0 filas, sin choques.

Run: `npx supabase test db` → **18 archivos, 363 asserts** verdes (los dos asserts parchados ahora esperan `14`).

Smoke del CHECK re-emitido:

```bash
docker exec supabase_db_ERP_Transportes psql -U postgres -d postgres -c "select pg_get_constraintdef(oid) from pg_constraint where conname = 'asientos_origen_check';"
```

→ `CHECK ((origen = ANY (ARRAY['manual'::text, 'venta'::text, 'nota_credito'::text, 'compra'::text, 'pago'::text, 'pago_proveedor'::text, 'anticipo'::text, 'reversa'::text, 'cierre'::text, 'remuneracion'::text])))`

Validación en vivo (transaccional, TODO se revierte). Escribir (Write tool, UTF-8 sin BOM) `.superpowers/sdd/smoke-p18-t2.sql`:

```sql
\set ON_ERROR_STOP on
begin;

-- Fixture minima (superuser; rollback al final; uuids/RUTs del patron pgTAP, no comiteados)
insert into auth.users (instance_id, id, aud, role, email)
values ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'ana@a.cl');
insert into public.organizaciones (id, rut, razon_social)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '769010007', 'Org A');
insert into public.empresas (id, organizacion_id, rut, razon_social)
values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '769010007', 'Remu A');
insert into public.miembros (usuario_id, organizacion_id, rol)
values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'dueno');

-- Camino real como la duena
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select activar_contabilidad('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa');

-- 1) Catalogo: 29 cuentas / 14 claves / 5 grupos + las 3 anclas nuevas
select count(*) as cuentas,
       count(*) filter (where clave_sistema is not null) as claves,
       count(*) filter (where not acepta_movimientos) as grupos
from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa';
select codigo, nombre, tipo from cuentas_contables
where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
  and clave_sistema in ('gasto_remuneraciones', 'remuneraciones_por_pagar', 'retenciones_por_pagar')
order by codigo;

-- 2) Trabajadores G1-G4 + t5 sin contrato (RUTs modulo 11 validos)
insert into public.trabajadores (id, empresa_id, rut, nombre) values
  ('10000000-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '769031006', 'G1 Fonasa Habitat'),
  ('10000000-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '111111111', 'G2 Isapre Capital'),
  ('10000000-0000-0000-0000-000000000003', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '222222222', 'G3 Tope Modelo'),
  ('10000000-0000-0000-0000-000000000004', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '333333333', 'G4 Tramo Habitat'),
  ('10000000-0000-0000-0000-000000000005', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '555555555', 'T5 Sin Contrato');
insert into public.contratos (id, empresa_id, trabajador_id, tipo, fecha_inicio, fecha_termino, cargo, sueldo_base, gratificacion_legal, afp, salud, plan_isapre_uf) values
  ('20000000-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '10000000-0000-0000-0000-000000000001', 'indefinido', date '2025-01-01', null, 'Operaria', 800000, true, 'habitat', 'fonasa', null),
  ('20000000-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '10000000-0000-0000-0000-000000000002', 'plazo_fijo', date '2026-01-01', date '2026-12-31', 'Chofer', 1200000, true, 'capital', 'isapre', 5.0),
  ('20000000-0000-0000-0000-000000000003', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '10000000-0000-0000-0000-000000000003', 'indefinido', date '2024-06-01', null, 'Gerente', 4000000, true, 'modelo', 'fonasa', null),
  ('20000000-0000-0000-0000-000000000004', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '10000000-0000-0000-0000-000000000004', 'indefinido', date '2025-03-01', null, 'Jefa de operaciones', 2500000, true, 'habitat', 'fonasa', null);

-- 3) GOLDENS: emitir '2026-06' (G1 con no imponibles 50000; el resto 30/0/0)
select emitir_liquidacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '10000000-0000-0000-0000-000000000001', '2026-06', 30, 0, 50000) is not null as g1_emitida;
select emitir_liquidacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '10000000-0000-0000-0000-000000000002', '2026-06', 30, 0, 0) is not null as g2_emitida;
select emitir_liquidacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '10000000-0000-0000-0000-000000000003', '2026-06', 30, 0, 0) is not null as g3_emitida;
select emitir_liquidacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '10000000-0000-0000-0000-000000000004', '2026-06', 30, 0, 0) is not null as g4_emitida;
select t.nombre, l.sueldo_proporcional, l.gratificacion, l.total_imponible, l.afp_monto,
       l.salud_monto, l.cesantia_monto, l.impuesto_unico, l.total_descuentos, l.liquido, l.estado
from liquidaciones l
join trabajadores t on t.id = l.trabajador_id and t.empresa_id = l.empresa_id
where l.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
order by t.nombre;

-- 4) Mensajes byte-exactos
do $do$
begin
  perform emitir_liquidacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '10000000-0000-0000-0000-000000000001', '2026-06', 30, 0, 0);
  raise notice 'FALLO: duplicada';
exception when others then
  raise notice 'OK duplicada: %', sqlerrm;
end $do$;
do $do$
begin
  perform emitir_liquidacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '10000000-0000-0000-0000-000000000005', '2026-06', 30, 0, 0);
  raise notice 'FALLO: sin contrato';
exception when others then
  raise notice 'OK sin contrato: %', sqlerrm;
end $do$;
do $do$
begin
  perform emitir_liquidacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '10000000-0000-0000-0000-000000000002', '2030-01', 30, 0, 0);
  raise notice 'FALLO: sin indicadores';
exception when others then
  raise notice 'OK sin indicadores: %', sqlerrm;
end $do$;
do $do$
begin
  perform emitir_liquidacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '10000000-0000-0000-0000-000000000002', '2026-13', 30, 0, 0);
  raise notice 'FALLO: periodo invalido';
exception when others then
  raise notice 'OK periodo: %', sqlerrm;
end $do$;

-- 5) Asiento G1 via contabilizar_documento (service_role path; superuser)
reset role;
select contabilizar_documento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'remuneracion',
  (select id from liquidaciones where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and trabajador_id = '10000000-0000-0000-0000-000000000001' and periodo = '2026-06')) as g1_contab;
select a.fecha, a.glosa from asientos a
where a.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and a.origen = 'remuneracion';
select string_agg(c.clave_sistema || ':' || l.debe || ':' || l.haber, '|' order by c.clave_sistema) as lineas_g1
from asientos_lineas l
join asientos a on a.id = l.asiento_id and a.empresa_id = l.empresa_id
join cuentas_contables c on c.id = l.cuenta_id and c.empresa_id = l.empresa_id
where l.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and a.origen = 'remuneracion';
-- Idempotencia bajo el candado
select contabilizar_documento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'remuneracion',
  (select id from liquidaciones where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and trabajador_id = '10000000-0000-0000-0000-000000000001' and periodo = '2026-06')) as g1_noop;

-- 6) Maquina de estados: pagar / anular / re-emitir
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select pagar_liquidacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from liquidaciones where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and trabajador_id = '10000000-0000-0000-0000-000000000002' and periodo = '2026-06'));
select estado, pagada_en is not null as con_fecha from liquidaciones
where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and trabajador_id = '10000000-0000-0000-0000-000000000002';
do $do$
begin
  perform pagar_liquidacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from liquidaciones where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
       and trabajador_id = '10000000-0000-0000-0000-000000000002' and periodo = '2026-06'));
  raise notice 'FALLO: pago doble';
exception when others then
  raise notice 'OK pagar dos veces: %', sqlerrm;
end $do$;
do $do$
begin
  perform anular_liquidacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from liquidaciones where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
       and trabajador_id = '10000000-0000-0000-0000-000000000003' and periodo = '2026-06'), '   ');
  raise notice 'FALLO: anulo sin motivo';
exception when others then
  raise notice 'OK motivo: %', sqlerrm;
end $do$;
select anular_liquidacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from liquidaciones where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and trabajador_id = '10000000-0000-0000-0000-000000000004' and periodo = '2026-06'), 'Error en días');
-- Re-emitir el periodo tras anular (el unique parcial ignora anuladas)
select emitir_liquidacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '10000000-0000-0000-0000-000000000004', '2026-06', 30, 0, 0) is not null as g4_reemitida;
select count(*) filter (where estado = 'anulada') as g4_anuladas,
       count(*) filter (where estado = 'emitida') as g4_emitidas
from liquidaciones
where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and trabajador_id = '10000000-0000-0000-0000-000000000004';

-- 7) Anulada -> noop (sin asiento) y catch-up de pendientes
reset role;
select contabilizar_documento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'remuneracion',
  (select id from liquidaciones where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and trabajador_id = '10000000-0000-0000-0000-000000000004' and estado = 'anulada')) as anulada_noop;
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select contabilizar_pendientes('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa') as pendientes;

reset role;
rollback;
```

Run (Bash tool / Git Bash — NO PowerShell 5.1, mismas razones de encoding):

```bash
cat .superpowers/sdd/smoke-p18-t2.sql | docker exec -i supabase_db_ERP_Transportes psql -U postgres -d postgres -v ON_ERROR_STOP=1
```

Salida esperada (valores, en orden):
- (1) `cuentas = 29`, `claves = 14`, `grupos = 5`; 3 filas: `2.1.04 | Remuneraciones por pagar | pasivo`, `2.1.06 | Retenciones previsionales por pagar | pasivo`, `5.1.02 | Remuneraciones | gasto`.
- (3) `g1_emitida … g4_emitida = t` (4 veces) y la tabla de goldens BYTE-EXACTA (orden por nombre):
  - `G1 Fonasa Habitat | 800000 | 200000 | 1000000 | 112700 | 70000 | 6000 | 0 | 188700 | 861300 | emitida`
  - `G2 Isapre Capital | 1200000 | 209396 | 1409396 | 161235 | 196000 | 0 | 4556 | 361791 | 1047605 | emitida`
  - `G3 Tope Modelo | 4000000 | 209396 | 3441760 | 364138 | 240923 | 20651 | 104354 | 730066 | 2711694 | emitida`
  - `G4 Tramo Habitat | 2500000 | 209396 | 2709396 | 305349 | 189658 | 16256 | 54921 | 566184 | 2143212 | emitida`
- (4) `NOTICE:  OK duplicada: Ya existe una liquidación de ese período`; `NOTICE:  OK sin contrato: El trabajador no tiene contrato vigente`; `NOTICE:  OK sin indicadores: No hay indicadores previsionales para el período`; `NOTICE:  OK periodo: Período no válido`.
- (5) `g1_contab = creado`; asiento `2026-06-30 | Liquidación de sueldo 2026-06 G1 Fonasa Habitat`; `lineas_g1 = gasto_remuneraciones:1050000:0|remuneraciones_por_pagar:0:861300|retenciones_por_pagar:0:188700` (cuadra: 1050000 = 861300 + 188700); `g1_noop = noop`.
- (6) G2 `pagada/true`; `NOTICE:  OK pagar dos veces: Solo se puede pagar una liquidación emitida`; `NOTICE:  OK motivo: Indica el motivo de la anulación`; `g4_reemitida = t`; `g4_anuladas = 1`, `g4_emitidas = 1`.
- (7) `anulada_noop = noop`; `pendientes = {"creados": 3}` (G2 pagada + G3 emitida + G4 re-emitida; G1 ya tenía asiento).
- Cierre: `ROLLBACK` (nada persiste).

Byte-scan del archivo (JAMÁS BOM U+FEFF):

```bash
grep -c $'\xEF\xBB\xBF' supabase/migrations/00000000000025_remuneraciones.sql
```

→ imprime `0` y sale con status 1 (sin coincidencias = pass).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/00000000000025_remuneraciones.sql supabase/tests/database/contabilidad.test.sql supabase/tests/database/estados_financieros.test.sql
git commit -m "feat(db): emitir, pagar y anular liquidación + asiento automático de remuneraciones con 3 cuentas ancla

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```


---

### Task 3: pgTAP `remuneraciones.test.sql` — RLS por rol, goldens G1-G4, máquina de estados y asiento con las 3 anclas

**Files:**
- Create: `supabase/tests/database/remuneraciones.test.sql`

**Interfaces:**
- Consumes (todo de la migración 0025, task previa del plan): tablas `public.trabajadores`, `public.contratos`, `public.liquidaciones`, `public.indicadores_previsionales` (spec §2.1-§2.4); RPCs `emitir_liquidacion(p_empresa uuid, p_trabajador uuid, p_periodo text, p_dias integer, p_extras integer, p_no_imponibles integer) returns uuid`, `pagar_liquidacion(p_empresa uuid, p_liquidacion uuid)`, `anular_liquidacion(p_empresa uuid, p_liquidacion uuid, p_motivo text)` (spec §4); `activar_contabilidad` re-creada (14 claves), `contabilizar_documento(uuid, text, uuid) returns text` con la regla `'remuneracion'` y `revision_periodo(uuid, integer, integer) returns jsonb` re-creada con la rama de liquidaciones en la regla 1 (spec §5); `app.tiene_rol_en_empresa` (0003), `app.normalizar_rut`/`app.validar_rut` (0002).
- Produces: archivo 19 de la suite, `plan(29)`; suite total **392 = 363 + 29**.
- Mensajes byte-exactos verificados (spec §4 + los fijados por este plan): `'Tu rol no permite emitir liquidaciones'`, `'El trabajador no tiene contrato vigente'`, `'No hay indicadores previsionales para el período'`, `'Ya existe una liquidación de ese período'`, `'Período no válido'`, `'El líquido no puede ser negativo: revisa los días trabajados y los descuentos'`, `'Solo se puede pagar una liquidación emitida'`, `'Indica el motivo de la anulación'`.

**Notas de contrato con la Task 2 (verificadas):**

1. Los parches de asserts existentes (`'11/true'` → `'14/true'` y `'11/patrimonio:true'` → `'14/patrimonio:true'`) viven SOLO en la Task 2 — esta task NO toca `contabilidad.test.sql` ni `estados_financieros.test.sql`; su assert 1 (`'14/3'`) vive en el archivo nuevo.
2. Grants que el test asume (los produce la 0025): `trabajadores`/`contratos` con grant de tabla a authenticated + policies por rol → el INSERT del contador falla `42501` / `new row violates row-level security policy for table "trabajadores"`; `liquidaciones` e `indicadores_previsionales` solo con `grant select` → `42501` / `permission denied for table …`.
3. Indicadores canónicos: la 0025 siembra `'2026-06'`; el test hace UPSERT superuser de ese período con los valores canónicos dentro de su transacción (rollback al final) — los goldens no dependen de qué sembró la migración. El negativo "sin indicadores" usa `'2031-01'` (jamás sembrado; el fixture además lo borra por blindaje).
4. El RUT del insert denegado del contador es `191234561` (mod-11 válido, grep = 0; el borrador usaba `769710019`, que COLISIONA con `estados_financieros.test.sql` — corregido al ensamblar).

- [ ] **Step 1: Escribir el test**

`supabase/tests/database/remuneraciones.test.sql` (UTF-8 SIN BOM; los comentarios de los tests SÍ llevan tildes — convención de la suite):

```sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

-- ===== Fixtures (superuser: salta grants/RLS, patrón contabilidad) =====
-- Ana dueña, Ces CONTADOR y Vero VENDEDORA de la empresa A.
insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'ana@remu.cl'),
  ('00000000-0000-0000-0000-000000000000', '55555555-5555-5555-5555-555555555555', 'authenticated', 'authenticated', 'ces@remu.cl'),
  ('00000000-0000-0000-0000-000000000000', '77777777-7777-7777-7777-777777777777', 'authenticated', 'authenticated', 'vero@remu.cl');

-- RUT nuevo, único GLOBAL (módulo 11, cálculo en el plan): 769800018 no
-- aparece en ningún test, el seed ni los E2E (grep = 0).
insert into public.organizaciones (id, rut, razon_social)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '769800018', 'Org Remu');

insert into public.empresas (id, organizacion_id, rut, razon_social)
values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '769800018', 'Remu A');

insert into public.miembros (usuario_id, organizacion_id, rol)
values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'dueno'),
       ('55555555-5555-5555-5555-555555555555', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'contador'),
       ('77777777-7777-7777-7777-777777777777', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'vendedor');

-- Indicadores CANÓNICOS de '2026-06' (los MISMOS goldens del espejo TS).
-- UPSERT: la 0025 siembra '2026-06' con estos mismos valores; el test
-- fija los valores canónicos dentro de su transacción (rollback al final).
insert into public.indicadores_previsionales
  (periodo, uf, utm, ingreso_minimo, tope_imponible_uf, tope_cesantia_uf, tasas_afp, tramos_impuesto)
values
  ('2026-06', 39200, 69500, 529000, 87.8, 131.9,
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
      tasas_afp = excluded.tasas_afp, tramos_impuesto = excluded.tramos_impuesto;

-- Blindaje del negativo "sin indicadores": '2031-01' jamás debe existir.
delete from public.indicadores_previsionales where periodo = '2031-01';

-- ===== Activación de contabilidad (Ana, dueña) — para la sección del asiento =====
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select activar_contabilidad('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa');

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

-- ===== Trabajadores: escritura directa de la dueña (camino real, RLS por rol) =====
-- RUT de trabajadores nuevos, únicos GLOBALES (módulo 11, cálculo en el plan):
-- 157890123 / 165432096 / 178901230 / 189012349 — grep = 0 en tests, seed y E2E.
insert into public.trabajadores (empresa_id, rut, nombre)
values
  ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '157890123', 'Tomás Fonasa Habitat'),
  ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '165432096', 'Inés Isapre Capital'),
  ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '178901230', 'Mario Tope Modelo'),
  ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '189012349', 'Paula Tramo Habitat');

-- 2) La dueña inserta y ve sus 4 trabajadores (escritura dueno/admin del spec §2.1).
select is(
  (select count(*) from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'),
  4::bigint,
  'la dueña inserta trabajadores por escritura directa y los ve'
);

-- 3) RUT con DV malo: el CHECK (app.validar_rut) lo rechaza (convención maestros).
select throws_ok(
  $$insert into trabajadores (empresa_id, rut, nombre)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '157890124', 'DV Malo')$$,
  '23514',
  null,
  'un RUT de trabajador con DV incorrecto viola el check'
);

-- 4) El CONTADOR (Ces) lee pero NO escribe trabajadores (INSERT solo dueno/admin).
set local request.jwt.claims to '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated"}';
select throws_ok(
  $$insert into trabajadores (empresa_id, rut, nombre)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '191234561', 'Colado Contador')$$,
  '42501', 'new row violates row-level security policy for table "trabajadores"',
  'el contador no inserta trabajadores (escritura solo dueno/admin)'
);

-- ===== Candados de escritura directa (Ana, dueña: ni el rol máximo pasa) =====
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- 5) liquidaciones: CERO escritura directa (solo RPCs) — el grant ES el candado.
select throws_ok(
  $$insert into liquidaciones (empresa_id, trabajador_id, contrato_id, periodo)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', gen_random_uuid(), gen_random_uuid(), '2026-06')$$,
  '42501', 'permission denied for table liquidaciones',
  'ni la dueña inserta liquidaciones directamente (solo emitir_liquidacion)'
);

-- 6) indicadores_previsionales: escritura SOLO service_role (panel admin).
select throws_ok(
  $$update indicadores_previsionales set uf = 1 where periodo = '2026-06'$$,
  '42501', 'permission denied for table indicadores_previsionales',
  'authenticated no edita indicadores (escritura solo de la plataforma)'
);

-- ===== Contratos (Ana): T1/T2/T3 con contrato; Paula (T4) queda SIN contrato =====
-- SETUP (felices sin assert, patrón contabilidad: si fallaran, el archivo aborta).
insert into public.contratos (empresa_id, trabajador_id, tipo, fecha_inicio, cargo, sueldo_base, afp, salud)
values
  ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
   (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '157890123'),
   'indefinido', date '2026-01-01', 'Chofer', 800000, 'habitat', 'fonasa'),
  ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
   (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '178901230'),
   'indefinido', date '2026-01-01', 'Gerente', 4000000, 'modelo', 'fonasa');
-- Inés: plazo FIJO con Isapre (plan 5,0 UF > el 7% de su imponible).
insert into public.contratos (empresa_id, trabajador_id, tipo, fecha_inicio, fecha_termino, cargo, sueldo_base, afp, salud, plan_isapre_uf)
values
  ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
   (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '165432096'),
   'plazo_fijo', date '2026-01-01', date '2026-12-31', 'Analista', 1200000, 'capital', 'isapre', 5.0);

-- ===== emitir_liquidacion: negativos (cada uno con UNA sola condición que falla) =====

-- 7) Vendedor (Vero): el rol se chequea PRIMERO, ids ficticios igual dan el mensaje de rol.
set local request.jwt.claims to '{"sub": "77777777-7777-7777-7777-777777777777", "role": "authenticated"}';
select throws_ok(
  $$select emitir_liquidacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', gen_random_uuid(), '2026-06', 30, 0, 0)$$,
  'P0001', 'Tu rol no permite emitir liquidaciones',
  'el vendedor no emite liquidaciones'
);

set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- 8) Paula no tiene contrato vigente (período válido y con indicadores).
select throws_ok(
  $$select emitir_liquidacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '189012349'),
    '2026-06', 30, 0, 0)$$,
  'P0001', 'El trabajador no tiene contrato vigente',
  'sin contrato vigente no hay liquidación'
);

-- 9) Período bien formado pero SIN indicadores ('2031-01' jamás sembrado).
select throws_ok(
  $$select emitir_liquidacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '157890123'),
    '2031-01', 30, 0, 0)$$,
  'P0001', 'No hay indicadores previsionales para el período',
  'sin indicadores del período no hay liquidación'
);

-- 10) Período malformado: el formato se valida ANTES de buscar indicadores.
select throws_ok(
  $$select emitir_liquidacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '157890123'),
    '2026-13', 30, 0, 0)$$,
  'P0001', 'Período no válido',
  'un período malformado es rechazado con el mensaje del spec'
);

-- 11) Líquido negativo (Isapre cara con 1 día trabajado): prop 40.000, grat
--     10.000, imponible 50.000, afp 5.720, salud 196.000 (piso del plan 5,0 UF),
--     líquido −151.720 → guard fail-closed (un asiento descuadrado envenenaría
--     contabilizar_pendientes). Mensaje fijado por este plan.
select throws_ok(
  $$select emitir_liquidacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '165432096'),
    '2026-06', 1, 0, 0)$$,
  'P0001', 'El líquido no puede ser negativo: revisa los días trabajados y los descuentos',
  'una liquidación con líquido negativo es rechazada antes de insertarse'
);

-- ===== Goldens G1-G3 (Ana emite; aritmética a mano en el plan, espejo del TS) =====
-- SETUP (felices sin assert): los goldens 12-15 leen el snapshot persistido.
select emitir_liquidacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '157890123'),
  '2026-06', 30, 0, 50000);
select emitir_liquidacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '165432096'),
  '2026-06', 30, 0, 0);
select emitir_liquidacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '178901230'),
  '2026-06', 30, 0, 0);

-- 12) GOLDEN G1 (Fonasa indefinido habitat 800000 + 50000 no imponibles):
--     prop 800000; grat min(200000, 209396)=200000; imponible 1000000;
--     afp 11,27% = 112700; salud 7% = 70000; cesantía 0,6% = 6000;
--     base 811300 < 938250 (13,5 UTM) → impuesto 0; desc 188700;
--     líquido 1000000+50000-188700 = 861300.
select is(
  (select sueldo_proporcional || '/' || gratificacion || '/' || total_imponible || '/' || afp_monto
     || '/' || salud_monto || '/' || cesantia_monto || '/' || impuesto_unico
     || '/' || total_descuentos || '/' || liquido
   from liquidaciones
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '157890123')
     and periodo = '2026-06'),
  '800000/200000/1000000/112700/70000/6000/0/188700/861300',
  'G1: Fonasa indefinido habitat 800000 calza byte a byte con el cálculo a mano'
);

-- 13) G1 nace EMITIDA (sin borrador persistido) con el snapshot de contexto completo:
--     la liquidación se explica sola aunque cambien contrato o indicadores.
select is(
  (select estado || '/' || (emitida_en is not null)::text || '/' || sueldo_base || '/' || afp
     || '/' || tasa_afp || '/' || salud || '/' || uf || '/' || utm
   from liquidaciones
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '157890123')
     and periodo = '2026-06'),
  'emitida/true/800000/habitat/11.27/fonasa/39200/69500',
  'la liquidación nace emitida con emitida_en y el snapshot de contexto'
);

-- 14) GOLDEN G2 (Isapre plazo fijo capital 1200000, plan 5,0 UF):
--     grat topada 209396; imponible 1409396; afp 11,44% = round(161234,9024) = 161235;
--     salud max(round(98657,72)=98658, 5,0·39200=196000) = 196000; cesantía plazo fijo 0;
--     base 1052161 → tramo 4%: round(42086,44-37530) = 4556; desc 361791; líquido 1047605.
select is(
  (select sueldo_proporcional || '/' || gratificacion || '/' || total_imponible || '/' || afp_monto
     || '/' || salud_monto || '/' || cesantia_monto || '/' || impuesto_unico
     || '/' || total_descuentos || '/' || liquido
   from liquidaciones
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '165432096')
     and periodo = '2026-06'),
  '1200000/209396/1409396/161235/196000/0/4556/361791/1047605',
  'G2: Isapre plazo fijo con plan sobre el 7% y sin cesantía calza byte a byte'
);

-- 15) GOLDEN G3 (Fonasa indefinido modelo 4000000, sobre el tope imponible):
--     grat topada 209396; imponible min(4209396, 3441760) = 3441760;
--     afp 10,58% = round(364138,208) = 364138; salud round(240923,2) = 240923;
--     cesantía round(20650,56) = 20651; base 2816048 → tramo 8%:
--     round(225283,84-120930) = 104354; desc 730066; líquido 2711694.
select is(
  (select sueldo_proporcional || '/' || gratificacion || '/' || total_imponible || '/' || afp_monto
     || '/' || salud_monto || '/' || cesantia_monto || '/' || impuesto_unico
     || '/' || total_descuentos || '/' || liquido
   from liquidaciones
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '178901230')
     and periodo = '2026-06'),
  '4000000/209396/3441760/364138/240923/20651/104354/730066/2711694',
  'G3: sueldo sobre el tope imponible calza byte a byte (imponible topado en 87,8 UF)'
);

-- ===== G4: el CONTADOR emite (spec §4: dueno/admin/contador) =====
-- SETUP: Ana le crea el contrato a Paula (escritura sigue siendo dueno/admin).
insert into public.contratos (empresa_id, trabajador_id, tipo, fecha_inicio, cargo, sueldo_base, afp, salud)
values
  ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
   (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '189012349'),
   'indefinido', date '2026-01-01', 'Jefa de flota', 2500000, 'habitat', 'fonasa');

set local request.jwt.claims to '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated"}';
select emitir_liquidacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '189012349'),
  '2026-06', 30, 0, 0);

-- 16) GOLDEN G4 (Fonasa indefinido habitat 2500000, emitida por el CONTADOR):
--     grat topada 209396; imponible 2709396; afp 11,27% = round(305348,9292) = 305349;
--     salud round(189657,72) = 189658; cesantía round(16256,376) = 16256;
--     base 2198133 → tramo 8%: round(175850,64-120930) = 54921; desc 566184; líquido 2143212.
select is(
  (select sueldo_proporcional || '/' || gratificacion || '/' || total_imponible || '/' || afp_monto
     || '/' || salud_monto || '/' || cesantia_monto || '/' || impuesto_unico
     || '/' || total_descuentos || '/' || liquido
   from liquidaciones
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '189012349')
     and periodo = '2026-06'),
  '2500000/209396/2709396/305349/189658/16256/54921/566184/2143212',
  'G4: el contador SÍ emite y el tramo 2+ del impuesto calza byte a byte'
);

-- 17) Duplicada: Tomás ya tiene liquidación no-anulada de '2026-06' (unique parcial).
select throws_ok(
  $$select emitir_liquidacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '157890123'),
    '2026-06', 30, 0, 50000)$$,
  'P0001', 'Ya existe una liquidación de ese período',
  'no se emite dos veces el mismo período para el mismo trabajador'
);

-- 18) El CONTADOR (Ces) lee las 3 tablas (SELECT dueno/admin/contador).
select is(
  (select count(*) from trabajadores)::text || '/' ||
  (select count(*) from contratos)::text || '/' ||
  (select count(*) from liquidaciones)::text,
  '4/4/4',
  'el contador ve trabajadores, contratos y liquidaciones'
);

-- 19) El VENDEDOR (Vero) ve 0 filas en las 3 tablas (RLS por rol, dato sensible).
set local request.jwt.claims to '{"sub": "77777777-7777-7777-7777-777777777777", "role": "authenticated"}';
select is(
  (select count(*) from trabajadores) + (select count(*) from contratos) + (select count(*) from liquidaciones),
  0::bigint,
  'el vendedor no ve nada de remuneraciones (select restringido por rol)'
);

-- 20) Pero los indicadores son públicos: cualquier authenticated los lee.
select is(
  (select count(*) from indicadores_previsionales where periodo = '2026-06'),
  1::bigint,
  'el vendedor sí lee los indicadores previsionales (datos públicos)'
);

-- ===== pagar_liquidacion (Ana): emitida → pagada, y solo emitida =====
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- SETUP (feliz sin assert): pagar la liquidación de Inés (G2).
select pagar_liquidacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from liquidaciones
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '165432096')
     and periodo = '2026-06'));

-- 21) Quedó pagada con pagada_en.
select is(
  (select estado || '/' || (pagada_en is not null)::text
   from liquidaciones
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '165432096')
     and periodo = '2026-06'),
  'pagada/true',
  'pagar deja la liquidación pagada y registra pagada_en'
);

-- 22) Re-pagar una pagada: solo emitida se paga.
select throws_ok(
  $$select pagar_liquidacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from liquidaciones
     where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
       and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '165432096')
       and periodo = '2026-06')$$,
  'P0001', 'Solo se puede pagar una liquidación emitida',
  'una liquidación pagada no se vuelve a pagar'
);

-- ===== anular_liquidacion (Ana): motivo obligatorio, anular y re-emitir =====

-- 23) Motivo vacío: rechazo byte-exacto.
select throws_ok(
  $$select anular_liquidacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from liquidaciones
     where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
       and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '157890123')
       and periodo = '2026-06'), '')$$,
  'P0001', 'Indica el motivo de la anulación',
  'anular sin motivo es rechazado'
);

-- SETUP (feliz sin assert): anular G1 con motivo.
select anular_liquidacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from liquidaciones
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '157890123')
     and periodo = '2026-06'),
  'Error en los días trabajados');

-- 24) Quedó anulada con motivo y anulada_en.
select is(
  (select estado || '/' || motivo_anulacion || '/' || (anulada_en is not null)::text
   from liquidaciones
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '157890123')
     and periodo = '2026-06'),
  'anulada/Error en los días trabajados/true',
  'anular deja la liquidación anulada con motivo y anulada_en'
);

-- 25) Re-emitir tras anular: el unique parcial ignora anuladas → conviven las dos filas.
select emitir_liquidacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '157890123'),
  '2026-06', 30, 0, 50000);
select is(
  (select string_agg(estado, ',' order by estado)
   from liquidaciones
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '157890123')
     and periodo = '2026-06'),
  'anulada,emitida',
  'tras anular se puede volver a emitir el mismo período'
);

-- 26) El AUDITOR (P17) ve las remuneraciones: la regla 1 de revision_periodo
--     (re-creada en 0025 con la rama de liquidaciones) cuenta las 4
--     emitidas/pagadas de junio sin asiento (G2, G3, G4 y la G1 re-emitida;
--     la anulada queda fuera) y el estado del período es crítico.
select is(
  (with rev as (
     select revision_periodo('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 2026, 6) as r)
   select (r ->> 'estado') || '/' || (
     select o ->> 'detalle'
     from jsonb_array_elements(r -> 'observaciones') as x(o)
     where o ->> 'regla' = 'documentos_sin_contabilizar')
   from rev),
  'critica/4 documentos del período sin asiento contable',
  'el auditor detecta liquidaciones sin contabilizar (regla 1 con la rama remuneracion)'
);

-- ===== Asiento contable (service_role, el hook): regla 'remuneracion' =====
set local role service_role;

-- SETUP (sin assert): contabilizar la G1 re-emitida.
select contabilizar_documento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'remuneracion',
  (select id from liquidaciones
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '157890123')
     and periodo = '2026-06' and estado = 'emitida'));

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

-- 28) La fecha es el ÚLTIMO día del mes del período (sin cierres: intacta) y el origen nuevo.
select is(
  (select a.fecha::text || '/' || a.origen
   from asientos a
   where a.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and a.origen = 'remuneracion'
     and a.referencia_id = (select id from liquidaciones
                            where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
                              and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '157890123')
                              and periodo = '2026-06' and estado = 'emitida')),
  '2026-06-30/remuneracion',
  'el asiento va al último día del mes del período con origen remuneracion'
);

-- 29) Liquidación ANULADA → noop, sin asiento (patrón P16).
select is(
  contabilizar_documento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'remuneracion',
    (select id from liquidaciones
     where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
       and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '157890123')
       and periodo = '2026-06' and estado = 'anulada'))
  || '/' ||
  (select count(*) from asientos
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and origen = 'remuneracion'
     and referencia_id = (select id from liquidaciones
                          where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
                            and trabajador_id = (select id from trabajadores where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and rut = '157890123')
                            and periodo = '2026-06' and estado = 'anulada'))::text,
  'noop/0',
  'una liquidación anulada no genera asiento (noop)'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Correr la suite**

Run: `pnpm supabase db reset` (aplica la 0025 y limpia datos previos)
Run: `pnpm supabase test db`

Expected: **19 archivos verdes, 392 asserts en total**; el archivo nuevo reporta:

```
supabase/tests/database/remuneraciones.test.sql .. ok
All tests successful.
Files=19, Tests=392
Result: PASS
```

(`remuneraciones.test.sql`: `1..29`, 29/29 ok. Si algún golden difiere del cálculo de la RPC, NO ajustar el valor esperado del test sin recalcular a mano: divergencia SQL↔goldens = bug de la migración o del plan, spec §3.)

- [ ] **Step 3: Commit**

```
git add supabase/tests/database/remuneraciones.test.sql
git commit -m "test(db): pgTAP de remuneraciones — goldens G1-G4, máquina de estados y asiento con las 3 anclas

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Espejo TS del cálculo de liquidaciones con goldens compartidos + tipos de BD de remuneraciones

**Files:**
- Create: `packages/core/src/remuneraciones.test.ts` (test primero — TDD)
- Create: `packages/core/src/remuneraciones.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/db/src/types.ts`

**Interfaces:**
- Produces (`@suite/core`, re-exportado desde `index.ts`):
  - `export interface ContratoCalculo { tipo: string; sueldo_base: number; gratificacion_legal: boolean; afp: string; salud: string; plan_isapre_uf: number | null }` — subconjunto estructural de `contratos.Row`: una fila de la BD se pasa directo (los CHECK de la BD garantizan los valores de `tipo`/`salud`/`afp`).
  - `export interface TramoImpuesto { desde_utm: number; hasta_utm: number | null; factor: number; rebaja_utm: number }`
  - `export interface IndicadoresPeriodo { uf: number; utm: number; ingreso_minimo: number; tope_imponible_uf: number; tope_cesantia_uf: number; tasas_afp: Record<string, number>; tramos_impuesto: TramoImpuesto[] }` — fila de `indicadores_previsionales` con los jsonb ya parseados.
  - `export interface InputsLiquidacion { dias_trabajados: number; extras_imponibles: number; no_imponibles: number }`
  - `export interface ResultadoLiquidacion` — los 9 campos del snapshot del cálculo del spec §2.4, todo integer CLP: `sueldo_proporcional, gratificacion, total_imponible, afp_monto, salud_monto, cesantia_monto, impuesto_unico, total_descuentos, liquido`.
  - `export function calcularLiquidacion(contrato: ContratoCalculo, indicadores: IndicadoresPeriodo, inputs: InputsLiquidacion): ResultadoLiquidacion` — pura; lanza `Error('AFP sin tasa en los indicadores: X')` si la AFP del contrato no está en `tasas_afp`, y `Error('El líquido no puede ser negativo: revisa los días trabajados y los descuentos')` si el líquido queda bajo 0 (mismo guard byte-exacto que la RPC, Global Constraints).
  - `export const AFPS` — catálogo compartido de las 7 AFP (`{ valor, etiqueta }`, slugs = CHECK de `contratos.afp`): ÚNICA fuente de la lista en las 3 apps (la consumen `catalogos.ts` del ERP en Task 5, `estados.ts` en Task 6 y `afps.ts` del admin en Task 8).
- Produces (`@suite/db`, tipos de `Database` según DDL del spec §2 y firmas §4):
  - Tablas `contratos`, `indicadores_previsionales`, `liquidaciones`, `trabajadores` (Row/Insert/Update/Relationships).
  - `Functions.anular_liquidacion { Args: { p_empresa, p_liquidacion, p_motivo }; Returns: undefined }`, `Functions.emitir_liquidacion { Args: { p_dias, p_empresa, p_extras, p_no_imponibles, p_periodo, p_trabajador }; Returns: string }`, `Functions.pagar_liquidacion { Args: { p_empresa, p_liquidacion }; Returns: undefined }`.
- Consumes: nada nuevo. Consumidores futuros: vista previa en vivo de `/liquidaciones` (ERP) y Server Actions del plan.

**Redondeo (declaración obligatoria):** `round()` de plpgsql sobre `numeric` redondea mitades LEJOS del cero. `Math.round` redondea mitades hacia +∞ — coincide con plpgsql para todo valor ≥ 0 y solo difiere en negativos. Todos los montos de este módulo son ≥ 0 (el impuesto se satura en 0), así que `Math.round` es espejo fiel. Dos avisos que las Tasks 1-2 ya respetan: (1) en plpgsql `sueldo_base * p_dias / 30` con integers TRUNCA — la RPC divide en numeric; (2) la selección de tramo usa la MISMA convención en ambos lados (en un borde exacto ambos tramos dan el mismo impuesto — la tabla SII es continua); AFP sin tasa en el jsonb → raise en SQL / `Error` en TS.

- [ ] **Step 1 (TDD): Crear `packages/core/src/remuneraciones.test.ts`**

Contenido EXACTO (UTF-8 sin BOM; comentarios con la aritmética de cada golden):

```ts
import { describe, expect, it } from 'vitest'
import {
  calcularLiquidacion,
  type ContratoCalculo,
  type IndicadoresPeriodo,
  type InputsLiquidacion,
} from './remuneraciones'

// Indicadores canónicos del período 2026-06 — MISMOS valores que siembra la
// migración 0025 y que fijan los asserts pgTAP de emitir_liquidacion
// (remuneraciones.test.sql). Los goldens son compartidos byte a byte entre
// SQL y TS: divergencia = bug (spec §3).
const INDICADORES: IndicadoresPeriodo = {
  uf: 39200,
  utm: 69500,
  ingreso_minimo: 529000,
  tope_imponible_uf: 87.8,
  tope_cesantia_uf: 131.9,
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
      calcularLiquidacion(FONASA_800, INDICADORES, { ...DIAS_COMPLETOS, no_imponibles: 50000 }),
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
    })
  })

  it('G2: Isapre plazo fijo capital 1.200.000 con plan 5,0 UF sobre el 7%', () => {
    expect(calcularLiquidacion(ISAPRE_1200, INDICADORES, DIAS_COMPLETOS)).toEqual({
      sueldo_proporcional: 1200000,
      gratificacion: 209396, // tope 4,75 IMM/12 muerde (el 25% sería 300.000)
      total_imponible: 1409396,
      afp_monto: 161235, // round(1.409.396 × 11,44%) = round(161.234,9024)
      salud_monto: 196000, // max(98.658, 5 UF = 196.000): el plan es piso
      cesantia_monto: 0, // plazo fijo: el trabajador no cotiza
      impuesto_unico: 4556, // tramo 2: round(1.052.161 × 4% − 37.530)
      total_descuentos: 361791,
      liquido: 1047605,
    })
  })

  it('G3: Fonasa indefinido modelo 4.000.000 sobre el tope imponible de 87,8 UF', () => {
    expect(calcularLiquidacion(FONASA_4000, INDICADORES, DIAS_COMPLETOS)).toEqual({
      sueldo_proporcional: 4000000,
      gratificacion: 209396,
      total_imponible: 3441760, // topado: round(87,8 × 39.200); sin tope sería 4.209.396
      afp_monto: 364138, // round(3.441.760 × 10,58%) = round(364.138,208)
      salud_monto: 240923, // round(240.923,2)
      cesantia_monto: 20651, // round(3.441.760 × 0,6%) = round(20.650,56)
      impuesto_unico: 104354, // tramo 3: round(2.816.048 × 8% − 120.930)
      total_descuentos: 730066,
      liquido: 2711694,
    })
  })

  it('G4: Fonasa indefinido habitat 2.500.000 cae en tramo 3 del impuesto', () => {
    expect(calcularLiquidacion(FONASA_2500, INDICADORES, DIAS_COMPLETOS)).toEqual({
      sueldo_proporcional: 2500000,
      gratificacion: 209396,
      total_imponible: 2709396,
      afp_monto: 305349, // round(305.348,9292)
      salud_monto: 189658, // round(189.657,72)
      cesantia_monto: 16256, // round(16.256,376)
      impuesto_unico: 54921, // tramo 3: round(2.198.133 × 8% − 120.930) = round(54.920,64)
      total_descuentos: 566184,
      liquido: 2143212,
    })
  })
})

describe('calcularLiquidacion — bordes', () => {
  it('15 días trabajados prorratean sueldo y gratificación', () => {
    expect(
      calcularLiquidacion(FONASA_800, INDICADORES, {
        dias_trabajados: 15,
        extras_imponibles: 0,
        no_imponibles: 50000,
      }),
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
    })
  })

  it('plazo fijo no cotiza cesantía (mismo contrato que G1)', () => {
    const r = calcularLiquidacion({ ...FONASA_800, tipo: 'plazo_fijo' }, INDICADORES, {
      ...DIAS_COMPLETOS,
      no_imponibles: 50000,
    })
    expect(r.cesantia_monto).toBe(0)
    expect(r.liquido).toBe(867300) // los 6.000 de G1 no se descuentan
  })

  it('plan Isapre bajo el 7% del imponible: rige el 7% (el plan es piso, no techo)', () => {
    const r = calcularLiquidacion(
      { ...ISAPRE_1200, plan_isapre_uf: 2.0 },
      INDICADORES,
      DIAS_COMPLETOS,
    )
    expect(r.salud_monto).toBe(98658) // 7% de 1.409.396 > 2 UF (78.400)
    expect(r.liquido).toBe(1141053)
  })

  it('el tope de cesantía muerde cuando es menor que el imponible', () => {
    // Con los indicadores reales el tope de 131,9 UF (5.170.480) nunca muerde:
    // el imponible ya viene topado a 87,8 UF. Se fuerza un tope menor para
    // ejercitar la rama min() en paridad con la fórmula SQL.
    const r = calcularLiquidacion(
      FONASA_4000,
      { ...INDICADORES, tope_cesantia_uf: 50 },
      DIAS_COMPLETOS,
    )
    expect(r.cesantia_monto).toBe(11760) // round(round(50 × 39.200) × 0,006) = round(11.760)
  })

  it('base bajo 13,5 UTM queda exenta de impuesto (sueldo mínimo)', () => {
    expect(
      calcularLiquidacion({ ...FONASA_800, sueldo_base: 529000 }, INDICADORES, DIAS_COMPLETOS),
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
    })
  })

  it('los no imponibles suman al líquido sin cotizar ni tributar (G4 + 80.000)', () => {
    const r = calcularLiquidacion(FONASA_2500, INDICADORES, {
      ...DIAS_COMPLETOS,
      no_imponibles: 80000,
    })
    expect(r.total_imponible).toBe(2709396) // igual que G4
    expect(r.impuesto_unico).toBe(54921) // igual que G4
    expect(r.liquido).toBe(2223212) // 2.143.212 + 80.000
  })

  it('AFP sin tasa en los indicadores del período lanza error (la RPC también valida)', () => {
    expect(() =>
      calcularLiquidacion({ ...FONASA_800, afp: 'inexistente' }, INDICADORES, DIAS_COMPLETOS),
    ).toThrow('AFP sin tasa en los indicadores: inexistente')
  })

  it('un líquido negativo lanza (Isapre cara con 1 día trabajado)', () => {
    // prop 40.000; grat 10.000; imponible 50.000; afp 5.720; salud max(3.500,
    // 5 UF = 196.000) = 196.000; base −151.720 sin tramo → impuesto 0;
    // descuentos 201.720; líquido −151.720 < 0 → mismo mensaje byte-exacto
    // que el guard de la RPC (Global Constraints).
    expect(() =>
      calcularLiquidacion(ISAPRE_1200, INDICADORES, { ...DIAS_COMPLETOS, dias_trabajados: 1 }),
    ).toThrow('El líquido no puede ser negativo: revisa los días trabajados y los descuentos')
  })
})
```

- [ ] **Step 2 (TDD): Correr y ver fallar**

```
pnpm --filter @suite/core test
```

Salida esperada: vitest falla en la resolución del import (`Failed to resolve import "./remuneraciones" from "src/remuneraciones.test.ts"`), `Test Files  1 failed | 12 passed (13)`, exit ≠ 0. Los 142 tests existentes siguen verdes.

- [ ] **Step 3: Crear `packages/core/src/remuneraciones.ts`**

Contenido EXACTO (UTF-8 sin BOM; estilo del paquete: sin clases, sin semicolons):

```ts
// Espejo TS del cálculo chileno de liquidaciones de sueldo (spec Plan 18 §3).
// La autoridad es la RPC emitir_liquidacion (plpgsql, migración 0025): este
// espejo existe SOLO para la vista previa en vivo del formulario. Ambos lados
// se prueban con los mismos goldens (unit acá, pgTAP allá): divergencia = bug.
//
// Redondeo: round() de plpgsql sobre numeric redondea mitades lejos del cero.
// Math.round coincide para valores >= 0 (mitades hacia arriba) y solo difiere
// en negativos; todos los montos de este módulo son >= 0, así que Math.round
// es un espejo fiel. La RPC debe dividir en numeric (/ 30.0, no / 30) para no
// truncar en división entera.

// Subconjunto estructural de contratos.Row (@suite/db): una fila de la BD se
// pasa directo. tipo: 'indefinido' | 'plazo_fijo'; salud: 'fonasa' | 'isapre';
// afp: clave de tasas_afp — los CHECK de la BD garantizan los valores.
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
  tasas_afp: Record<string, number>
  tramos_impuesto: TramoImpuesto[]
}

// Los únicos inputs del usuario: el resto sale de contrato + indicadores.
export interface InputsLiquidacion {
  dias_trabajados: number
  extras_imponibles: number
  no_imponibles: number
}

// Snapshot del cálculo (spec §2.4), todo integer CLP — las mismas columnas
// que la RPC guarda en liquidaciones.
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

// Reglas 1-8 del spec §3, en el MISMO orden y con los MISMOS redondeos
// intermedios que la RPC emitir_liquidacion.
export function calcularLiquidacion(
  contrato: ContratoCalculo,
  indicadores: IndicadoresPeriodo,
  inputs: InputsLiquidacion,
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

  // 6. Cesantía 0,6% solo indefinido (plazo fijo: el trabajador no cotiza),
  //    con tope propio de 131,9 UF.
  const cesantiaMonto =
    contrato.tipo === 'indefinido'
      ? Math.round(
          Math.min(totalImponible, Math.round(indicadores.tope_cesantia_uf * indicadores.uf)) *
            0.006,
        )
      : 0

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
  }
}
```

- [ ] **Step 4: Re-exportar desde `packages/core/src/index.ts`** (patrón del paquete: un `export *` por archivo, al final). El archivo queda COMPLETO así:

```ts
export * from './rut'
export * from './iva'
export * from './maestros'
export * from './csv'
export * from './ventas'
export * from './stock'
export * from './compras'
export * from './cobranza'
export * from './periodo'
export * from './cotizaciones'
export * from './transporte'
export * from './tct'
export * from './rubros'
export * from './remuneraciones'
```

- [ ] **Step 5 (TDD): Correr y ver pasar**

```
pnpm --filter @suite/core test
```

Salida esperada: `Test Files  13 passed (13)`, `Tests  154 passed (154)`, exit 0. Suite unit del monorepo tras esta task: **204 = 192 + 12** (core 154, pagos 25, correo 13, dte 10, auth 2).

- [ ] **Step 6: Tipos de BD en `packages/db/src/types.ts`** (7 ediciones, en este orden; los shapes replican byte a byte lo que `supabase gen types` emitirá tras la migración 0025 — orden alfabético de tablas, columnas, Args y Relationships; columnas con default → opcionales en Insert).

Edición 6a — tabla `contratos` (alfabético: entre `conductores` y `correos_enviados`). Reemplazar la línea única:

```ts
      correos_enviados: {
```

por:

```ts
      contratos: {
        Row: {
          afp: string
          cargo: string
          creado_en: string
          empresa_id: string
          fecha_inicio: string
          fecha_termino: string | null
          gratificacion_legal: boolean
          id: string
          plan_isapre_uf: number | null
          salud: string
          sueldo_base: number
          tipo: string
          trabajador_id: string
          vigente: boolean
        }
        Insert: {
          afp: string
          cargo: string
          creado_en?: string
          empresa_id: string
          fecha_inicio: string
          fecha_termino?: string | null
          gratificacion_legal?: boolean
          id?: string
          plan_isapre_uf?: number | null
          salud: string
          sueldo_base: number
          tipo: string
          trabajador_id: string
          vigente?: boolean
        }
        Update: {
          afp?: string
          cargo?: string
          creado_en?: string
          empresa_id?: string
          fecha_inicio?: string
          fecha_termino?: string | null
          gratificacion_legal?: boolean
          id?: string
          plan_isapre_uf?: number | null
          salud?: string
          sueldo_base?: number
          tipo?: string
          trabajador_id?: string
          vigente?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "contratos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contratos_empresa_id_trabajador_id_fkey"
            columns: ["empresa_id", "trabajador_id"]
            isOneToOne: false
            referencedRelation: "trabajadores"
            referencedColumns: ["empresa_id", "id"]
          },
        ]
      }
      correos_enviados: {
```

Edición 6b — tabla `indicadores_previsionales` (entre `gastos_vehiculo` y `links_pago`; tabla de plataforma: PK `periodo`, sin `empresa_id`, sin FKs). Reemplazar la línea única:

```ts
      links_pago: {
```

por:

```ts
      indicadores_previsionales: {
        Row: {
          actualizado_en: string
          ingreso_minimo: number
          periodo: string
          tasas_afp: Json
          tope_cesantia_uf: number
          tope_imponible_uf: number
          tramos_impuesto: Json
          uf: number
          utm: number
        }
        Insert: {
          actualizado_en?: string
          ingreso_minimo: number
          periodo: string
          tasas_afp: Json
          tope_cesantia_uf: number
          tope_imponible_uf: number
          tramos_impuesto: Json
          uf: number
          utm: number
        }
        Update: {
          actualizado_en?: string
          ingreso_minimo?: number
          periodo?: string
          tasas_afp?: Json
          tope_cesantia_uf?: number
          tope_imponible_uf?: number
          tramos_impuesto?: Json
          uf?: number
          utm?: number
        }
        Relationships: []
      }
      links_pago: {
```

Edición 6c — tabla `liquidaciones` (entre `links_pago` y `miembros`; snapshot completo del spec §2.4). Reemplazar la línea única:

```ts
      miembros: {
```

por:

```ts
      liquidaciones: {
        Row: {
          afp: string
          afp_monto: number
          anulada_en: string | null
          cesantia_monto: number
          contrato_id: string
          creado_en: string
          dias_trabajados: number
          emitida_en: string | null
          empresa_id: string
          estado: string
          extras_imponibles: number
          gratificacion: number
          id: string
          impuesto_unico: number
          liquido: number
          motivo_anulacion: string | null
          no_imponibles: number
          pagada_en: string | null
          periodo: string
          plan_isapre_uf: number | null
          salud: string
          salud_monto: number
          sueldo_base: number
          sueldo_proporcional: number
          tasa_afp: number
          total_descuentos: number
          total_imponible: number
          trabajador_id: string
          uf: number
          utm: number
        }
        Insert: {
          afp: string
          afp_monto: number
          anulada_en?: string | null
          cesantia_monto: number
          contrato_id: string
          creado_en?: string
          dias_trabajados?: number
          emitida_en?: string | null
          empresa_id: string
          estado?: string
          extras_imponibles?: number
          gratificacion: number
          id?: string
          impuesto_unico: number
          liquido: number
          motivo_anulacion?: string | null
          no_imponibles?: number
          pagada_en?: string | null
          periodo: string
          plan_isapre_uf?: number | null
          salud: string
          salud_monto: number
          sueldo_base: number
          sueldo_proporcional: number
          tasa_afp: number
          total_descuentos: number
          total_imponible: number
          trabajador_id: string
          uf: number
          utm: number
        }
        Update: {
          afp?: string
          afp_monto?: number
          anulada_en?: string | null
          cesantia_monto?: number
          contrato_id?: string
          creado_en?: string
          dias_trabajados?: number
          emitida_en?: string | null
          empresa_id?: string
          estado?: string
          extras_imponibles?: number
          gratificacion?: number
          id?: string
          impuesto_unico?: number
          liquido?: number
          motivo_anulacion?: string | null
          no_imponibles?: number
          pagada_en?: string | null
          periodo?: string
          plan_isapre_uf?: number | null
          salud?: string
          salud_monto?: number
          sueldo_base?: number
          sueldo_proporcional?: number
          tasa_afp?: number
          total_descuentos?: number
          total_imponible?: number
          trabajador_id?: string
          uf?: number
          utm?: number
        }
        Relationships: [
          {
            foreignKeyName: "liquidaciones_empresa_id_contrato_id_fkey"
            columns: ["empresa_id", "contrato_id"]
            isOneToOne: false
            referencedRelation: "contratos"
            referencedColumns: ["empresa_id", "id"]
          },
          {
            foreignKeyName: "liquidaciones_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "liquidaciones_empresa_id_trabajador_id_fkey"
            columns: ["empresa_id", "trabajador_id"]
            isOneToOne: false
            referencedRelation: "trabajadores"
            referencedColumns: ["empresa_id", "id"]
          },
        ]
      }
      miembros: {
```

Edición 6d — tabla `trabajadores` (entre `suscripciones` y `vehiculos`). Reemplazar la línea única:

```ts
      vehiculos: {
```

por:

```ts
      trabajadores: {
        Row: {
          activo: boolean
          creado_en: string
          direccion: string | null
          email: string | null
          empresa_id: string
          fecha_nacimiento: string | null
          id: string
          nombre: string
          rut: string
          telefono: string | null
        }
        Insert: {
          activo?: boolean
          creado_en?: string
          direccion?: string | null
          email?: string | null
          empresa_id: string
          fecha_nacimiento?: string | null
          id?: string
          nombre: string
          rut: string
          telefono?: string | null
        }
        Update: {
          activo?: boolean
          creado_en?: string
          direccion?: string | null
          email?: string | null
          empresa_id?: string
          fecha_nacimiento?: string | null
          id?: string
          nombre?: string
          rut?: string
          telefono?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trabajadores_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      vehiculos: {
```

Edición 6e — `Functions.anular_liquidacion` (alfabético: entre `anular_estado_pago` y `anular_orden_entrega`; `returns void` → `Returns: undefined`, mismo estilo que `anular_pago`). Reemplazar la línea única:

```ts
      anular_orden_entrega: {
```

por:

```ts
      anular_liquidacion: {
        Args: { p_empresa: string; p_liquidacion: string; p_motivo: string }
        Returns: undefined
      }
      anular_orden_entrega: {
```

Edición 6f — `Functions.emitir_liquidacion` (entre `desactivar_contabilidad` y `facturar_proforma`; `returns uuid` → `Returns: string`; Args alfabéticos, uno por línea como `asignar_despacho`). Reemplazar la línea única:

```ts
      facturar_proforma: {
```

por:

```ts
      emitir_liquidacion: {
        Args: {
          p_dias: number
          p_empresa: string
          p_extras: number
          p_no_imponibles: number
          p_periodo: string
          p_trabajador: string
        }
        Returns: string
      }
      facturar_proforma: {
```

Edición 6g — `Functions.pagar_liquidacion` (entre `guardar_cuenta` y `reabrir_ejercicio`). Reemplazar la línea única:

```ts
      reabrir_ejercicio: {
```

por:

```ts
      pagar_liquidacion: {
        Args: { p_empresa: string; p_liquidacion: string }
        Returns: undefined
      }
      reabrir_ejercicio: {
```

- [ ] **Step 7: Verificación de tipos por workspace**

```
pnpm --filter @suite/core exec tsc --noEmit
```

Salida esperada: sin diagnósticos, exit 0.

```
pnpm --filter @suite/db exec tsc --noEmit
```

Salida esperada: sin diagnósticos, exit 0.

- [ ] **Step 8: Byte-scan de los archivos nuevos** (JAMÁS BOM U+FEFF; sin coincidencias = pass, exit 1):

```
grep -rc $'\xEF\xBB\xBF' packages/core/src/remuneraciones.ts packages/core/src/remuneraciones.test.ts
```

→ cada archivo imprime `0`; el comando sale con status 1. Cualquier conteo distinto de 0 → reescribir ese archivo en UTF-8 sin BOM y repetir.

- [ ] **Step 9: Commit**

```
git add packages/core/src/remuneraciones.ts packages/core/src/remuneraciones.test.ts packages/core/src/index.ts packages/db/src/types.ts
git commit -m "feat(core): espejo TS del cálculo de liquidaciones con goldens compartidos y tipos de BD de remuneraciones

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Salida esperada: commit creado en la rama de trabajo con 4 archivos cambiados.

---

### Task 5: /trabajadores — ficha de trabajadores y gestión de contratos

**Files:**
- Create: `apps/erp/lib/rrhh-acceso.ts` (guard único de Personas — las Tasks 6 y 7 lo importan, jamás lo re-crean)
- Create: `apps/erp/app/trabajadores/page.tsx`
- Create: `apps/erp/app/trabajadores/nuevo/page.tsx`
- Create: `apps/erp/app/trabajadores/[id]/page.tsx`
- Create: `apps/erp/app/trabajadores/acciones.ts`
- Create: `apps/erp/app/trabajadores/catalogos.ts`
- Create: `apps/erp/componentes/formulario-trabajador.tsx`
- Create: `apps/erp/componentes/formulario-contrato.tsx`

**Interfaces:**
- Consumes: tablas `trabajadores` y `contratos` (0025, spec §2.1-§2.2; RLS por rol — la escritura directa es el patrón maestros: NO hay RPC, spec §4); `EmpresaResumen.rol` de `apps/erp/lib/empresa-activa.ts` (ya viene resuelto de `miembros`, sin re-consultar); `validarRut` / `limpiarRut` / `formatearRut` / `formatearCLP` y el catálogo `AFPS` de `@suite/core` (Task 4); `EstadoForm` de `apps/erp/app/tipos.ts`; kit `@suite/ui` (`Boton, Campo, Encabezado, Entrada, Insignia, Paginacion, Selector, Tabla, Tarjeta, Td, Th, Tr`).
- Produces: rutas `/trabajadores`, `/trabajadores/nuevo`, `/trabajadores/[id]`; Server Actions `guardarTrabajador` / `alternarActivoTrabajador` / `guardarContrato`; re-export de `AFPS` + `ETIQUETA_AFP` / `ETIQUETA_TIPO` en `apps/erp/app/trabajadores/catalogos.ts`; guard `exigirRRHH()` / `puedeVerRRHH()` / `ROLES_RRHH` en `apps/erp/lib/rrhh-acceso.ts` (las Tasks 6 y 7 lo importan; las páginas de ESTA task mantienen el patrón maestros — lista visible con 0 filas para vendedor — y no lo usan).
- Decisiones declaradas: el cierre+creación de contrato son **2 writes secuenciales NO atómicos** (spec §4: peor caso el trabajador queda sin contrato vigente — visible en la ficha y reparable); la escritura de UI se muestra solo a dueno/admin (`escribe`) y contador ve todo en solo lectura (**UX; la seguridad es RLS**: vendedor/bodeguero llega a estas URLs y ve tabla vacía o 404 por 0 filas). Esta task NO toca el NAV (llega en la Task 7); hasta entonces se navega por URL directa.

- [ ] **Step 1: Guard de RRHH + catálogos UI de Personas**

`apps/erp/lib/rrhh-acceso.ts` (UTF-8 sin BOM; guard ÚNICO de la sección Personas — las Tasks 6 y 7 lo importan, jamás lo re-crean):

```ts
import 'server-only'
import { notFound } from 'next/navigation'
import { obtenerEmpresaActiva, type EmpresaResumen } from './empresa-activa'

// Roles que ven la sección Personas (spec §2.1: SELECT dueno/admin/contador).
// Es SOLO UX: la seguridad real es la RLS por rol y las RPCs.
export const ROLES_RRHH = ['dueno', 'admin', 'contador'] as const

// Predicado puro para guards y route handlers (patrón puedeVerContabilidad).
export function puedeVerRRHH(activa: EmpresaResumen | null): boolean {
  return activa?.rol != null && (ROLES_RRHH as readonly string[]).includes(activa.rol)
}

// Guard de las pantallas de Personas que exigen rol: sin rol → notFound (misma
// cara que una ruta inexistente; patrón exigirContabilidad).
export async function exigirRRHH(): Promise<EmpresaResumen> {
  const { activa } = await obtenerEmpresaActiva()
  if (!puedeVerRRHH(activa)) notFound()
  return activa as EmpresaResumen
}
```

`apps/erp/app/trabajadores/catalogos.ts` (UTF-8 sin BOM):

```ts
// Catálogos UI de Personas (patrón origenes.ts de contabilidad). AFPS viene de
// @suite/core (Task 4): ÚNICA fuente de la lista de AFP en las 3 apps — acá
// solo se re-exporta y se derivan las etiquetas. La tasa vigente de cada AFP
// NO vive acá: está en indicadores_previsionales.tasas_afp y la mantiene el
// admin de plataforma.
import { AFPS } from '@suite/core'

export { AFPS }

export const ETIQUETA_AFP: Record<string, string> = Object.fromEntries(
  AFPS.map((a) => [a.valor, a.etiqueta])
)

export const ETIQUETA_TIPO: Record<string, string> = {
  indefinido: 'Indefinido',
  plazo_fijo: 'Plazo fijo',
}
```

- [ ] **Step 2: Server Actions**

`apps/erp/app/trabajadores/acciones.ts` (patrón `clientes/acciones.ts`: validarRut fail-closed, mensajes RLS con `.select('id')` y chequeo de 0 filas):

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { limpiarRut, validarRut } from '@suite/core'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import type { EstadoForm } from '../tipos'
import { AFPS } from './catalogos'

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/

export async function guardarTrabajador(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const id = String(formData.get('id') ?? '')
  const rutCrudo = String(formData.get('rut') ?? '').trim()
  const nombre = String(formData.get('nombre') ?? '').trim()
  const email = String(formData.get('email') ?? '').trim()
  const fechaNacimiento = String(formData.get('fecha_nacimiento') ?? '').trim()

  if (!validarRut(rutCrudo)) return { error: 'El RUT ingresado no es válido' }
  if (nombre === '') return { error: 'El nombre es obligatorio' }
  if (email !== '' && !email.includes('@')) return { error: 'El correo no es válido' }
  if (fechaNacimiento !== '' && !FECHA_ISO.test(fechaNacimiento)) {
    return { error: 'La fecha de nacimiento no es válida' }
  }

  const datos = {
    rut: limpiarRut(rutCrudo),
    nombre,
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
  let planIsapreUf: number | null = null
  if (salud === 'isapre') {
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
```

- [ ] **Step 3: Formulario de trabajador (cliente)**

`apps/erp/componentes/formulario-trabajador.tsx` (espejo de `formulario-cliente.tsx`):

```tsx
'use client'

import { useActionState } from 'react'
import { Boton, Campo, Entrada, Tarjeta } from '@suite/ui'
import type { EstadoForm } from '../app/tipos'

export interface TrabajadorEditable {
  id?: string
  rut: string
  nombre: string
  email: string
  telefono: string
  direccion: string
  fecha_nacimiento: string
}

const VACIO: TrabajadorEditable = {
  rut: '',
  nombre: '',
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
        <Campo etiqueta="Nombre completo *">
          <Entrada name="nombre" defaultValue={inicial.nombre} required />
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

- [ ] **Step 4: Formulario de contrato (cliente, campos condicionales)**

`apps/erp/componentes/formulario-contrato.tsx`. Los condicionales son estado de cliente: `fecha_termino` solo existe en el DOM con `plazo_fijo` y `plan_isapre_uf` solo con `isapre` (al desmontarse NO viajan en el FormData — la action igual los ignora si no corresponden). Los radios de salud NO van dentro de `Campo` (Campo es un `<label>`; anidar labels es HTML inválido) — van en un `fieldset` con la misma tipografía:

```tsx
'use client'

import { useActionState, useState } from 'react'
import { Boton, Campo, Entrada, Selector, Tarjeta } from '@suite/ui'
import type { EstadoForm } from '../app/tipos'
import { AFPS } from '../app/trabajadores/catalogos'

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
          <Campo etiqueta="Plan Isapre (UF) *">
            <Entrada name="plan_isapre_uf" inputMode="decimal" placeholder="3,5" required />
          </Campo>
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

- [ ] **Step 5: Lista de trabajadores**

`apps/erp/app/trabajadores/page.tsx` (patrón `clientes/page.tsx`: búsqueda, ver inactivos, paginación; el cargo del contrato vigente llega por join con filtro embebido de PostgREST):

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
              <Td>{t.activo ? <Insignia tono="verde">Activo</Insignia> : <Insignia tono="gris">Inactivo</Insignia>}</Td>
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

- [ ] **Step 6: Nuevo trabajador**

`apps/erp/app/trabajadores/nuevo/page.tsx`:

```tsx
import { notFound } from 'next/navigation'
import { Encabezado } from '@suite/ui'
import { FormularioTrabajador } from '../../../componentes/formulario-trabajador'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { guardarTrabajador } from '../acciones'

export default async function NuevoTrabajador() {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  // Contador es solo lectura en Personas: sin formulario de creación. UX —
  // RLS igual rechazaría el INSERT (42501) si llegara a enviarlo.
  if (!activa.rol || !['dueno', 'admin'].includes(activa.rol)) notFound()
  return (
    <div>
      <Encabezado titulo="Nuevo trabajador" />
      <FormularioTrabajador accion={guardarTrabajador} />
    </div>
  )
}
```

- [ ] **Step 7: Ficha del trabajador con contratos**

`apps/erp/app/trabajadores/[id]/page.tsx`:

```tsx
import { notFound } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP, formatearRut } from '@suite/core'
import { Encabezado, Insignia, Tabla, Tarjeta, Td, Th, Tr } from '@suite/ui'
import { FormularioContrato } from '../../../componentes/formulario-contrato'
import { FormularioTrabajador } from '../../../componentes/formulario-trabajador'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { guardarContrato, guardarTrabajador } from '../acciones'
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

const fmtFecha = (f: string | null) =>
  f ? new Date(f + 'T00:00:00').toLocaleDateString('es-CL') : '—'

export default async function FichaTrabajador({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  // Escritura de ficha y contratos: solo dueno/admin. Contador: TODO en solo
  // lectura (los formularios ni se montan). Vendedor/bodeguero: RLS por rol →
  // 0 filas → notFound() de abajo. UX; la seguridad es RLS.
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
            nombre: trabajador.nombre,
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
    </div>
  )
}
```

- [ ] **Step 8: Verificar**

```
node -e "const fs=require('fs');const con=process.argv.slice(1).filter(a=>fs.readFileSync(a)[0]===0xEF);if(con.length){console.error('BOM en: '+con.join(', '));process.exit(1)}console.log('sin BOM')" apps/erp/app/trabajadores/page.tsx apps/erp/app/trabajadores/nuevo/page.tsx "apps/erp/app/trabajadores/[id]/page.tsx" apps/erp/app/trabajadores/acciones.ts apps/erp/app/trabajadores/catalogos.ts apps/erp/lib/rrhh-acceso.ts apps/erp/componentes/formulario-trabajador.tsx apps/erp/componentes/formulario-contrato.tsx
pnpm --filter erp build
```

Salida esperada: `sin BOM`; build con exit 0, `✓ Compiled successfully` y la tabla de rutas incluye `ƒ /trabajadores`, `ƒ /trabajadores/[id]` y `ƒ /trabajadores/nuevo`.

Reiniciar `pnpm --filter erp dev` (el build pisa su `.next`). Smoke manual con la demo (login `demo@suite-erp.cl` / `demo1234`, URL directa `http://localhost:3001/trabajadores` — el NAV llega en la Task 7):

1. Crear trabajador con RUT `12.345.678-5` → aparece en la lista con "Sin contrato".
2. En la ficha, crear primer contrato `plazo_fijo` + `isapre`: los campos Fecha de término y Plan Isapre (UF) aparecen SOLO con esas opciones; guardar → tabla con 1 fila Vigente.
3. Renovar contrato (indefinido, Fonasa) → tabla con 2 filas: la nueva Vigente, la anterior Cerrado.
4. RUT inválido (`12.345.678-9`) → `El RUT ingresado no es válido` sin escribir en BD.
5. (Si la demo tiene usuario contador) la ficha se ve sin formularios; si no hay contador sembrado, la verificación por rol queda para el E2E final del plan.

- [ ] **Step 9: Commit**

```
git add apps/erp/app/trabajadores apps/erp/lib/rrhh-acceso.ts apps/erp/componentes/formulario-trabajador.tsx apps/erp/componentes/formulario-contrato.tsx
git commit -m "feat(erp): ficha de trabajadores con contratos — cerrar vigente y crear nuevo

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Salida esperada: commit creado en la rama del plan con 8 archivos nuevos.

---

### Task 6: /liquidaciones — lista por período, generar con vista previa en vivo y detalle imprimible con acciones

**Files:**
- Create: `apps/erp/app/liquidaciones/estados.ts`
- Create: `apps/erp/app/liquidaciones/acciones.ts`
- Create: `apps/erp/app/liquidaciones/page.tsx`
- Create: `apps/erp/app/liquidaciones/generar/page.tsx`
- Create: `apps/erp/app/liquidaciones/[id]/page.tsx`
- Create: `apps/erp/componentes/formulario-liquidacion.tsx`
- Create: `apps/erp/componentes/acciones-liquidacion.tsx`
- Modify: `apps/erp/lib/contabilidad.ts` (cambio MÍNIMO: `+ 'remuneracion'` al union de orígenes del hook — verificado que el union vigente NO lo trae)
- Modify: `apps/erp/app/contabilidad/origenes.ts` (etiqueta + ruta del origen `remuneracion`)

Esta task NO toca `apps/erp/app/layout.tsx` (el NAV Personas completo llega en la Task 7 — hasta entonces se navega por URL directa) y NO crea `apps/erp/lib/rrhh-acceso.ts` (lo creó la Task 5: acá solo se importa).

**Interfaces:**
- Consumes de `@suite/core` (Task 4 — nombres REALES del espejo; el borrador usaba otros y quedaron corregidos aquí): `calcularLiquidacion(contrato: ContratoCalculo, indicadores: IndicadoresPeriodo, inputs: InputsLiquidacion): ResultadoLiquidacion`, tipos `ContratoCalculo` (`tipo: string; sueldo_base: number; gratificacion_legal: boolean; afp: string; salud: string; plan_isapre_uf: number | null` — subconjunto estructural de `contratos.Row`), `TramoImpuesto`, `IndicadoresPeriodo` (jsonb ya parseados), `InputsLiquidacion` (`dias_trabajados/extras_imponibles/no_imponibles`), `ResultadoLiquidacion` (9 campos del snapshot del cálculo); además `formatearCLP` / `formatearRut`. La lista de AFP NO se re-deriva: `estados.ts` re-exporta `ETIQUETA_AFP` de `../trabajadores/catalogos` (Task 5) como `AFP_NOMBRE`.
- **Declaración (costura verificada):** `ResultadoLiquidacion` NO trae campos de contexto (tasa AFP, UF, UTM) — la vista previa los toma del propio `indicador.datos` (los indicadores serializados por la página generar: la tasa sale de `tasas_afp[contrato.afp]` del jsonb), consistente por diseño; el detalle post-emisión los lee del snapshot persistido de la fila de `liquidaciones`.
- Consumes RPCs (Task 2, tipadas en `@suite/db` por la Task 4): `emitir_liquidacion(p_empresa, p_trabajador, p_periodo, p_dias, p_extras, p_no_imponibles) returns uuid`, `pagar_liquidacion(p_empresa, p_liquidacion)`, `anular_liquidacion(p_empresa, p_liquidacion, p_motivo)`; `revertir_asiento(p_empresa, p_asiento, p_glosa) returns uuid` (P16, ya existe y ya está tipada).
- Consumes `exigirRRHH()` de `apps/erp/lib/rrhh-acceso.ts` (Task 5) y el hook `contabilizarAsiento(empresaId, 'remuneracion', referenciaId)` de `apps/erp/lib/contabilidad.ts` (best-effort, NUNCA lanza) — esta task le suma `'remuneracion'` al union en el mismo commit.
- Produces: rutas `/liquidaciones`, `/liquidaciones/generar`, `/liquidaciones/[id]`; Server Actions `emitirLiquidacion` / `pagarLiquidacion` / `anularLiquidacion`; `TONO_ESTADO` / `ETIQUETA_ESTADO` / `AFP_NOMBRE` / `etiquetaMes` en `apps/erp/app/liquidaciones/estados.ts`; hook contable con origen `'remuneracion'`; `origenes.ts` con etiqueta `Remuneración` y ruta `/liquidaciones/{id}` en la traza inversa.
- Mensajes de los Sets de `acciones.ts`: verificados byte a byte contra los que fijan las RPCs de la Task 2 (incluye `'Solo se puede anular una liquidación emitida o pagada'`, `'El líquido no puede ser negativo: revisa los días trabajados y los descuentos'` en `ERRORES_EMITIR`, y el mensaje de rol de emitir reutilizado en pagar/anular vía el prefijo `'Tu rol no permite'`).

**Acceso**: páginas para dueno/admin/contador vía `exigirRRHH()` (`notFound()` si no cumple). Es SOLO UX: la RLS por rol de `liquidaciones` deja 0 filas a vendedor/bodeguero y las RPCs re-validan rol.

---

#### Paso 1 — Estados, nombres AFP y etiqueta de mes

`apps/erp/app/liquidaciones/estados.ts`:

```ts
// Estados de liquidaciones (spec §2.4). 'borrador' está en el CHECK pero queda
// reservado para futuro: la emisión crea directo en 'emitida'.
export const TONO_ESTADO: Record<string, 'verde' | 'amarillo' | 'rojo' | 'gris'> = {
  borrador: 'gris',
  emitida: 'amarillo',
  pagada: 'verde',
  anulada: 'rojo',
}

export const ETIQUETA_ESTADO: Record<string, string> = {
  borrador: 'Borrador',
  emitida: 'Emitida',
  pagada: 'Pagada',
  anulada: 'Anulada',
}

// Nombres comerciales de las AFP: re-export de la derivación ÚNICA que la
// Task 5 dejó en trabajadores/catalogos.ts (ETIQUETA_AFP ← AFPS de
// @suite/core) — prohibido re-derivarla acá (Global Constraints).
export { ETIQUETA_AFP as AFP_NOMBRE } from '../trabajadores/catalogos'

// 'YYYY-MM' → 'julio de 2026'. Client-safe: la usan la vista previa (client
// component) y las páginas server; espejo del caso mes de etiquetaPeriodo de
// eerr/calculo.ts, que es server-only y por eso no se importa aquí.
export function etiquetaMes(periodo: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(periodo)
  if (!m) return periodo
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1))
    .toLocaleDateString('es-CL', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}
```

#### Paso 2 — Server Actions

`apps/erp/app/liquidaciones/acciones.ts`. Mensajes de RPC → `EstadoForm.error` por IGUALDAD ESTRICTA del mensaje completo (byte-exactos del spec §4); cualquier otro cae al genérico. El mensaje de rol de `pagar`/`anular` lo fija la RPC y se pasa tal cual vía el prefijo `'Tu rol no permite'`.

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { contabilizarAsiento } from '../../lib/contabilidad'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import type { EstadoForm } from '../tipos'

// IGUALDAD ESTRICTA del mensaje completo (spec §4): cualquier otro error cae al genérico.
const ERRORES_EMITIR = new Set([
  'Tu rol no permite emitir liquidaciones',
  'El trabajador no tiene contrato vigente',
  'No hay indicadores previsionales para el período',
  'Ya existe una liquidación de ese período',
  'Período no válido',
  'El líquido no puede ser negativo: revisa los días trabajados y los descuentos',
])

// Mismo CHECK del período que la migración 0025.
const RE_PERIODO = /^\d{4}-(0[1-9]|1[0-2])$/

export async function emitirLiquidacion(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const trabajador = String(formData.get('trabajador_id') ?? '')
  const periodo = String(formData.get('periodo') ?? '')
  const dias = Math.trunc(Number(formData.get('dias')))
  const extras = Math.trunc(Number(formData.get('extras')))
  const noImponibles = Math.trunc(Number(formData.get('no_imponibles')))
  if (!trabajador) return { error: 'Selecciona un trabajador' }
  if (!RE_PERIODO.test(periodo)) return { error: 'Período no válido' }
  if (!Number.isFinite(dias) || dias < 1 || dias > 30)
    return { error: 'Los días trabajados deben estar entre 1 y 30' }
  if (!Number.isFinite(extras) || extras < 0 || !Number.isFinite(noImponibles) || noImponibles < 0)
    return { error: 'Los montos no pueden ser negativos' }

  const supabase = await crearClienteServidor()
  const { data, error } = await supabase.rpc('emitir_liquidacion', {
    p_empresa: activa.id,
    p_trabajador: trabajador,
    p_periodo: periodo,
    p_dias: dias,
    p_extras: extras,
    p_no_imponibles: noImponibles,
  })
  if (error) {
    if (ERRORES_EMITIR.has(error.message)) return { error: error.message }
    return { error: 'No se pudo emitir la liquidación' }
  }
  // Hook best-effort (NUNCA lanza): el asiento origen 'remuneracion' se crea aparte;
  // si falla, "Contabilizar pendientes" lo repara (mismo motor idempotente).
  await contabilizarAsiento(activa.id, 'remuneracion', data)
  revalidatePath('/liquidaciones')
  // redirect lanza NEXT_REDIRECT: va FUERA de cualquier try/catch. data = uuid de la liquidación.
  redirect(`/liquidaciones/${data}`)
}

const ERRORES_PAGAR = new Set(['Solo se puede pagar una liquidación emitida'])

export async function pagarLiquidacion(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  const liquidacion = String(formData.get('liquidacion_id') ?? '')
  if (!liquidacion) return { error: 'Liquidación no válida' }
  const supabase = await crearClienteServidor()
  const { error } = await supabase.rpc('pagar_liquidacion', {
    p_empresa: activa.id,
    p_liquidacion: liquidacion,
  })
  if (error) {
    if (ERRORES_PAGAR.has(error.message) || error.message.startsWith('Tu rol no permite'))
      return { error: error.message }
    return { error: 'No se pudo pagar la liquidación' }
  }
  revalidatePath('/liquidaciones')
  revalidatePath(`/liquidaciones/${liquidacion}`)
  return {}
}

const ERRORES_ANULAR = new Set([
  'Indica el motivo de la anulación',
  'Solo se puede anular una liquidación emitida o pagada',
])

export async function anularLiquidacion(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  const liquidacion = String(formData.get('liquidacion_id') ?? '')
  const motivo = String(formData.get('motivo') ?? '').trim()
  if (!liquidacion) return { error: 'Liquidación no válida' }
  if (!motivo) return { error: 'Indica el motivo de la anulación' }
  const supabase = await crearClienteServidor()
  const { error } = await supabase.rpc('anular_liquidacion', {
    p_empresa: activa.id,
    p_liquidacion: liquidacion,
    p_motivo: motivo,
  })
  if (error) {
    if (ERRORES_ANULAR.has(error.message) || error.message.startsWith('Tu rol no permite'))
      return { error: error.message }
    return { error: 'No se pudo anular la liquidación' }
  }

  // Reversa contable best-effort (patrón NUNCA-lanza del hook contabilizarAsiento):
  // la anulación ya está confirmada en BD; si la reversa falla (p. ej. período
  // cerrado) queda el asiento original visible en /contabilidad/asientos y se
  // revierte a mano desde su detalle. El rol ya pasó anular_liquidacion (mismos
  // roles que revertir_asiento), así que el cliente del usuario alcanza.
  try {
    const { data: asiento } = await supabase
      .from('asientos')
      .select('id')
      .eq('empresa_id', activa.id)
      .eq('origen', 'remuneracion')
      .eq('referencia_id', liquidacion)
      .maybeSingle()
    if (asiento) {
      const { data: liq } = await supabase
        .from('liquidaciones')
        .select('periodo, trabajadores (nombre)')
        .eq('id', liquidacion)
        .eq('empresa_id', activa.id)
        .single()
      const { error: errorReversa } = await supabase.rpc('revertir_asiento', {
        p_empresa: activa.id,
        p_asiento: asiento.id,
        // Glosa fijada por el spec §5: 'Anulación liquidación {periodo} {nombre}'.
        p_glosa: `Anulación liquidación ${liq?.periodo ?? ''} ${liq?.trabajadores?.nombre ?? ''}`.trim(),
      })
      if (errorReversa) console.error('anularLiquidacion (reversa):', errorReversa.message)
    }
  } catch (e) {
    console.error('anularLiquidacion (reversa):', e)
  }

  revalidatePath('/liquidaciones')
  revalidatePath(`/liquidaciones/${liquidacion}`)
  revalidatePath('/contabilidad/asientos')
  return {}
}
```

#### Paso 3 — Lista por período

`apps/erp/app/liquidaciones/page.tsx`:

```tsx
import Link from 'next/link'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP, formatearRut } from '@suite/core'
import { Boton, Encabezado, Insignia, Selector, Tabla, Td, Th, Tr } from '@suite/ui'
import { exigirRRHH } from '../../lib/rrhh-acceso'
import { ETIQUETA_ESTADO, TONO_ESTADO, etiquetaMes } from './estados'

const RE_PERIODO = /^\d{4}-(0[1-9]|1[0-2])$/

export default async function PaginaLiquidaciones({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string }>
}) {
  const { periodo: qPeriodo } = await searchParams
  const activa = await exigirRRHH()
  const supabase = await crearClienteServidor()

  // Períodos con liquidaciones (dedupe en JS: PostgREST no hace DISTINCT).
  // ponytail: cap 1000 filas, mismo techo que el diario; .range() si se supera.
  const { data: filasPeriodos } = await supabase
    .from('liquidaciones')
    .select('periodo')
    .eq('empresa_id', activa.id)
    .order('periodo', { ascending: false })
    .limit(1000)
  const periodos = [...new Set((filasPeriodos ?? []).map((f) => f.periodo))]

  const hoy = new Date()
  const mesActual = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`
  const periodo = qPeriodo && RE_PERIODO.test(qPeriodo) ? qPeriodo : (periodos[0] ?? mesActual)
  if (!periodos.includes(periodo)) periodos.unshift(periodo)

  const { data: liqs } = await supabase
    .from('liquidaciones')
    .select('id, estado, total_imponible, total_descuentos, liquido, trabajadores (nombre, rut)')
    .eq('empresa_id', activa.id)
    .eq('periodo', periodo)
    .order('creado_en')
  // Orden por nombre en JS: PostgREST no ordena por columna del recurso embebido.
  const filas = [...(liqs ?? [])].sort((a, b) =>
    (a.trabajadores?.nombre ?? '').localeCompare(b.trabajadores?.nombre ?? '', 'es'),
  )

  return (
    <div>
      <Encabezado titulo="Liquidaciones">
        <Link href="/liquidaciones/generar"><Boton>Generar liquidación</Boton></Link>
      </Encabezado>

      {/* GET re-dibuja la lista para el período elegido (server component sin JS,
          patrón del selector de /contabilidad/eerr). */}
      <form className="mb-4 flex items-end gap-3" action="/liquidaciones" method="get">
        <label className="text-sm text-slate-600">
          Período
          <Selector name="periodo" defaultValue={periodo} className="mt-1 w-48">
            {periodos.map((p) => <option key={p} value={p}>{etiquetaMes(p)}</option>)}
          </Selector>
        </label>
        <Boton variante="secundario" type="submit">Ver</Boton>
      </form>

      <Tabla>
        <thead>
          <tr>
            <Th>Trabajador</Th><Th>RUT</Th>
            <Th className="text-right">Imponible</Th><Th className="text-right">Descuentos</Th>
            <Th className="text-right">Líquido</Th><Th>Estado</Th>
          </tr>
        </thead>
        <tbody>
          {filas.map((l) => (
            <Tr key={l.id}>
              <Td>
                <Link className="text-marca-700 hover:underline" href={`/liquidaciones/${l.id}`}>
                  {l.trabajadores?.nombre ?? '—'}
                </Link>
              </Td>
              <Td className="font-mono">{l.trabajadores ? formatearRut(l.trabajadores.rut) : '—'}</Td>
              <Td className="text-right font-mono">{formatearCLP(l.total_imponible)}</Td>
              <Td className="text-right font-mono">{formatearCLP(l.total_descuentos)}</Td>
              <Td className="text-right font-mono">{formatearCLP(l.liquido)}</Td>
              <Td><Insignia tono={TONO_ESTADO[l.estado] ?? 'gris'}>{ETIQUETA_ESTADO[l.estado] ?? l.estado}</Insignia></Td>
            </Tr>
          ))}
          {filas.length === 0 && (
            <Tr>
              <Td colSpan={6} className="py-8 text-center text-slate-500">
                No hay liquidaciones en {etiquetaMes(periodo)}.
              </Td>
            </Tr>
          )}
        </tbody>
      </Tabla>
    </div>
  )
}
```

#### Paso 4 — Generar: página server que serializa contratos e indicadores

`apps/erp/app/liquidaciones/generar/page.tsx`:

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

  const [indicadoresRes, contratosRes] = await Promise.all([
    // Períodos con indicadores existentes (RLS: SELECT authenticated — tabla de plataforma).
    supabase
      .from('indicadores_previsionales')
      .select('periodo, uf, utm, ingreso_minimo, tope_imponible_uf, tope_cesantia_uf, tasas_afp, tramos_impuesto')
      .order('periodo', { ascending: false })
      .limit(12),
    // Trabajadores con contrato vigente (unique parcial: a lo más uno por trabajador).
    supabase
      .from('contratos')
      .select('tipo, sueldo_base, gratificacion_legal, afp, salud, plan_isapre_uf, cargo, trabajador_id, trabajadores (nombre, rut, activo)')
      .eq('empresa_id', activa.id)
      .eq('vigente', true),
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
      tasas_afp: i.tasas_afp as Record<string, number>,
      tramos_impuesto: i.tramos_impuesto as unknown as IndicadoresPeriodo['tramos_impuesto'],
    },
  }))

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
      <FormularioLiquidacion trabajadores={trabajadores} indicadores={indicadores} />
    </div>
  )
}
```

#### Paso 5 — Formulario con vista previa en vivo (espejo TS)

`apps/erp/componentes/formulario-liquidacion.tsx`. La vista previa se recalcula en cada render con `calcularLiquidacion` (función pura y barata: sin useMemo); el cálculo autoritativo sigue siendo la RPC al emitir.

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
}: {
  trabajadores: TrabajadorGenerar[]
  indicadores: IndicadorGenerar[]
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
      previa = calcularLiquidacion(trabajador.contrato, indicador.datos, entradas)
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
          </div>
        )}
      </Tarjeta>
    </form>
  )
}
```

#### Paso 6 — Acciones por estado (Pagar con confirmación, Anular con motivo)

`apps/erp/componentes/acciones-liquidacion.tsx` (patrón `AccionesProforma` / `BotonRevertir`: confirmación en dos pasos, sin modales):

```tsx
'use client'

import { useActionState, useState } from 'react'
import { Boton } from '@suite/ui'
import { anularLiquidacion, pagarLiquidacion } from '../app/liquidaciones/acciones'
import type { EstadoForm } from '../app/tipos'

function BotonPagar({ liquidacionId }: { liquidacionId: string }) {
  const [confirmando, setConfirmando] = useState(false)
  const [estado, enviar, pendiente] = useActionState(pagarLiquidacion, {} as EstadoForm)
  if (!confirmando) {
    return <Boton type="button" onClick={() => setConfirmando(true)}>Pagar</Boton>
  }
  return (
    <form action={enviar} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="liquidacion_id" value={liquidacionId} />
      <span className="text-sm text-slate-600">¿Marcar la liquidación como pagada?</span>
      <Boton type="submit" disabled={pendiente}>{pendiente ? '…' : 'Confirmar pago'}</Boton>
      <Boton variante="secundario" type="button" onClick={() => setConfirmando(false)}>Cancelar</Boton>
      {estado.error && <span className="w-full text-sm text-red-600">{estado.error}</span>}
    </form>
  )
}

function FormularioAnular({ liquidacionId }: { liquidacionId: string }) {
  const [abierto, setAbierto] = useState(false)
  const [estado, enviar, pendiente] = useActionState(anularLiquidacion, {} as EstadoForm)
  if (!abierto) {
    return <Boton variante="peligro" type="button" onClick={() => setAbierto(true)}>Anular</Boton>
  }
  return (
    <form action={enviar} className="grid w-full max-w-md gap-2">
      <input type="hidden" name="liquidacion_id" value={liquidacionId} />
      {/* textarea plano con las clases de control de @suite/ui (no hay AreaTexto). */}
      <textarea
        name="motivo"
        required
        rows={3}
        placeholder="Motivo de la anulación *"
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-marca-500 focus:outline-none focus:ring-1 focus:ring-marca-500"
      />
      <p className="text-sm text-slate-600">
        Se anulará la liquidación y, si tenía asiento, se creará su reversa contable. Después
        podrás volver a emitir el período.
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

export function AccionesLiquidacion({ liquidacionId, estado }: { liquidacionId: string; estado: string }) {
  // emitida → Pagar + Anular; pagada → Anular; anulada/otros → nada (el detalle
  // muestra el aviso de re-emisión).
  if (estado !== 'emitida' && estado !== 'pagada') return null
  return (
    <div className="flex flex-wrap items-start gap-3">
      {estado === 'emitida' && <BotonPagar liquidacionId={liquidacionId} />}
      <FormularioAnular liquidacionId={liquidacionId} />
    </div>
  )
}
```

#### Paso 7 — Detalle imprimible (formato liquidación chilena) con traza contable

`apps/erp/app/liquidaciones/[id]/page.tsx` (bloque `print:` patrón proformas: encabezado de pantalla `print:hidden`, membrete del empleador `hidden print:block`; las columnas y el líquido sí se imprimen):

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

      {/* Límite declarado de la v1 (spec §3): también sale en la impresión. */}
      <p className="mt-3 max-w-3xl text-sm text-slate-500">
        Esta liquidación no incluye los aportes del empleador (SIS y aporte patronal al seguro de
        cesantía); se incorporan en una versión futura.
      </p>

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

#### Paso 8 — Origen `remuneracion` en el hook contable y la traza inversa

Edit 1 — `apps/erp/lib/contabilidad.ts` (cambio MÍNIMO; el resto del hook queda intacto: best-effort, NUNCA lanza). Reemplazar (Edit, coincidencia exacta):

```ts
  origen: 'venta' | 'nota_credito' | 'compra' | 'pago' | 'pago_proveedor' | 'anticipo',
```

por:

```ts
  origen: 'venta' | 'nota_credito' | 'compra' | 'pago' | 'pago_proveedor' | 'anticipo' | 'remuneracion',
```

Edit 2 — `apps/erp/app/contabilidad/origenes.ts`, etiqueta en `ETIQUETA_ORIGEN`. Reemplazar:

```ts
  pago_proveedor: 'Pago a proveedor',
  anticipo: 'Anticipo',
  reversa: 'Reversa',
```

por:

```ts
  pago_proveedor: 'Pago a proveedor',
  anticipo: 'Anticipo',
  remuneracion: 'Remuneración',
  reversa: 'Reversa',
```

(la entrada `cierre: 'Cierre de ejercicio'` que sigue queda intacta).

Edit 3 — `apps/erp/app/contabilidad/origenes.ts`, ruta del documento de origen (las liquidaciones SÍ tienen detalle propio). Reemplazar:

```ts
export function rutaOrigen(origen: string, referenciaId: string | null): string | null {
  if (!referenciaId) return null
  if (origen === 'venta' || origen === 'nota_credito') return `/ventas/${referenciaId}`
  return null
}
```

por:

```ts
export function rutaOrigen(origen: string, referenciaId: string | null): string | null {
  if (!referenciaId) return null
  if (origen === 'venta' || origen === 'nota_credito') return `/ventas/${referenciaId}`
  if (origen === 'remuneracion') return `/liquidaciones/${referenciaId}`
  return null
}
```

#### Paso 9 — Verificación

```
node -e "const fs=require('fs');const con=process.argv.slice(1).filter(a=>fs.readFileSync(a)[0]===0xEF);if(con.length){console.error('BOM en: '+con.join(', '));process.exit(1)}console.log('sin BOM')" apps/erp/app/liquidaciones/estados.ts apps/erp/app/liquidaciones/acciones.ts apps/erp/app/liquidaciones/page.tsx apps/erp/app/liquidaciones/generar/page.tsx "apps/erp/app/liquidaciones/[id]/page.tsx" apps/erp/componentes/formulario-liquidacion.tsx apps/erp/componentes/acciones-liquidacion.tsx
pnpm --filter erp build
```

Salida esperada: `sin BOM`; build con exit 0, `✓ Compiled successfully`, y en el listado de rutas aparecen `ƒ /liquidaciones`, `ƒ /liquidaciones/generar` y `ƒ /liquidaciones/[id]` (dinámicas, server-rendered). Sin errores de tipos: si `emitir_liquidacion`/`pagar_liquidacion`/`anular_liquidacion` no aparecen en los tipos de `@suite/db`, falta la Task 4 (tipos), no parchear con casts.

Recordatorio de entorno: `pnpm build` pisa el `.next` de los dev servers — reiniciarlos después. Smoke manual con la demo por URL directa (`http://localhost:3001/liquidaciones` — el NAV llega en la Task 7): generar una liquidación con la vista previa en vivo, emitirla y verificar el detalle imprimible con la traza "Asiento N°".

#### Paso 10 — Commit

```
git add apps/erp/app/liquidaciones apps/erp/componentes/formulario-liquidacion.tsx apps/erp/componentes/acciones-liquidacion.tsx apps/erp/app/contabilidad/origenes.ts apps/erp/lib/contabilidad.ts
git commit -m "feat(erp): liquidaciones — lista por período, generar con vista previa en vivo y detalle imprimible con acciones

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Salida esperada: commit creado en la rama del plan con 9 archivos (7 nuevos, 2 modificados).

---

### Task 7: /libro-remuneraciones + sección Personas en el NAV

**Files:**
- Create: `apps/erp/app/libro-remuneraciones/page.tsx`
- Create: `apps/erp/app/libro-remuneraciones/export/route.ts`
- Modify: `apps/erp/app/layout.tsx` (sección `Personas` entre Maestros y Análisis)

**Interfaces:**
- Consumes: tabla `liquidaciones` (0025, spec §2.4 — snapshot completo, RLS SELECT dueno/admin/contador) con join embebido a `trabajadores (rut, nombre)` (FK compuesta); `periodoAnterior` / `rangoDeMes` / `filasACsv` / `formatearCLP` / `formatearRut` de `@suite/core`; `puedeVerRRHH` de `apps/erp/lib/rrhh-acceso.ts` (Task 5); `EmpresaResumen.rol`; rutas `/trabajadores` (Task 5) y `/liquidaciones` (Task 6) para el NAV — por eso esta task corre DESPUÉS de la 6.
- Produces: ruta `/libro-remuneraciones` (por período, una fila por liquidación NO anulada + fila de totales) y `/libro-remuneraciones/export` (CSV con la misma data); NAV con `{ seccion: 'Personas' }`.
- Guards contractuales (paridad página↔route, lección P12; orden: sesión → rol → período): sin empresa activa → página `Sin empresa activa` / route **401**; rol fuera de dueno/admin/contador (predicado `puedeVerRRHH` de `rrhh-acceso.ts`, Task 5) → página `notFound()` / route **403** (jamás un CSV vacío); `?periodo=` inválido → **FALLBACK silencioso al período por defecto** en página y route (patrón dominante VERIFICADO en los 4 exports de contabilidad — diario/mayor fechas, balance año, eerr período: ninguno responde 404 por parámetro inválido; decisión declarada de este plan). Sin `?periodo=` (o inválido) → **mes anterior** (las remuneraciones se liquidan por mes vencido). No hay guard de módulo: Personas no depende de `modulo_contabilidad` ni `modulo_transporte`.
- Decisión (spec §6 y patrón real `layout.tsx:45` Contabilidad): el NAV Personas **SE condiciona por rol** — la sección completa va envuelta en `...(puedeVerRRHH(activa) ? […] : [])` (predicado de `rrhh-acceso.ts`, Task 5). Es UX, no seguridad: si un vendedor navega por URL directa, /trabajadores le muestra tabla vacía (RLS 0 filas) y /liquidaciones y /libro-remuneraciones le dan 404/vacío.

- [ ] **Step 1: Página del libro por período**

`apps/erp/app/libro-remuneraciones/page.tsx` (patrón `contabilidad/diario/page.tsx`: guards arriba, selector de período nativo, totales en `tfoot`):

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
  afp_monto: number
  salud_monto: number
  cesantia_monto: number
  impuesto_unico: number
  liquido: number
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
    .select('id, dias_trabajados, total_imponible, afp_monto, salud_monto, cesantia_monto, impuesto_unico, liquido, trabajadores (rut, nombre)')
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
    }),
    { imponible: 0, afp: 0, salud: 0, cesantia: 0, impuesto: 0, liquido: 0 }
  )

  return (
    <div>
      <Encabezado titulo="Libro de remuneraciones">
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
            </Tr>
          ))}
          {filas.length === 0 && (
            <Tr>
              <Td colSpan={9} className="py-8 text-center text-slate-500">
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
          </tr>
        </tfoot>
      </Tabla>
      <p className="mt-2 text-sm text-slate-500">
        Solo liquidaciones emitidas o pagadas del período; las anuladas quedan fuera del libro.
      </p>
    </div>
  )
}
```

- [ ] **Step 2: Export CSV del libro**

`apps/erp/app/libro-remuneraciones/export/route.ts` (misma data y mismo orden que la página; guards en paridad — ver Interfaces):

```ts
import { crearClienteServidor } from '@suite/auth/server'
import { filasACsv, formatearRut, periodoAnterior, rangoDeMes } from '@suite/core'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { puedeVerRRHH } from '../../../lib/rrhh-acceso'

interface Fila {
  dias_trabajados: number
  total_imponible: number
  afp_monto: number
  salud_monto: number
  cesantia_monto: number
  impuesto_unico: number
  liquido: number
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
    .select('dias_trabajados, total_imponible, afp_monto, salud_monto, cesantia_monto, impuesto_unico, liquido, trabajadores (rut, nombre)')
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
    }),
    { imponible: 0, afp: 0, salud: 0, cesantia: 0, impuesto: 0, liquido: 0 }
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
  ])
  const csv = filasACsv(
    ['RUT', 'Nombre', 'Días', 'Imponible', 'AFP', 'Salud', 'Cesantía', 'Impuesto único', 'Líquido'],
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

- [ ] **Step 3: Sección Personas en el NAV (condicionada por rol, patrón Contabilidad)**

En `apps/erp/app/layout.tsx`, DOS ediciones exactas.

Edit 1 — el import del predicado (junto al de contabilidad). Reemplazar:

```ts
import { puedeVerContabilidad } from '../lib/contabilidad-acceso'
```

por:

```ts
import { puedeVerContabilidad } from '../lib/contabilidad-acceso'
import { puedeVerRRHH } from '../lib/rrhh-acceso'
```

Edit 2 — la sección entre el bloque Maestros y `{ seccion: 'Análisis' }`, envuelta por rol (mismo patrón spread del NAV que `modulo_transporte` y `puedeVerContabilidad`, layout.tsx:45). Reemplazar:

```ts
    { href: '/importar', etiqueta: 'Importar' },
    { seccion: 'Análisis' },
```

por:

```ts
    { href: '/importar', etiqueta: 'Importar' },
    // Personas solo para dueno/admin/contador (spec §6). Es UX, no seguridad:
    // por URL directa la RLS igual manda (tabla vacía o 404).
    ...(puedeVerRRHH(activa)
      ? [
          { seccion: 'Personas' },
          { href: '/trabajadores', etiqueta: 'Trabajadores' },
          { href: '/liquidaciones', etiqueta: 'Liquidaciones' },
          { href: '/libro-remuneraciones', etiqueta: 'Libro de remuneraciones' },
        ]
      : []),
    { seccion: 'Análisis' },
```

El resto del arreglo `nav` queda intacto (esta task asume que las Tasks 5 y 6 ya crearon `/trabajadores` y `/liquidaciones`; ninguna otra task del plan toca `layout.tsx`).

- [ ] **Step 4: Verificar**

```
node -e "const fs=require('fs');const con=process.argv.slice(1).filter(a=>fs.readFileSync(a)[0]===0xEF);if(con.length){console.error('BOM en: '+con.join(', '));process.exit(1)}console.log('sin BOM')" apps/erp/app/libro-remuneraciones/page.tsx apps/erp/app/libro-remuneraciones/export/route.ts apps/erp/app/layout.tsx
pnpm --filter erp build
```

Salida esperada: `sin BOM`; build con exit 0, `✓ Compiled successfully` y la tabla de rutas incluye `ƒ /libro-remuneraciones` y `ƒ /libro-remuneraciones/export`.

Reiniciar `pnpm --filter erp dev` (el build pisa su `.next`). Smoke manual con la demo (`demo@suite-erp.cl` / `demo1234` en `http://localhost:3001`):

1. El NAV muestra la sección **Personas** (Trabajadores, Liquidaciones, Libro de remuneraciones) entre Maestros y Análisis (sesión dueña; a vendedor/bodeguero el condicional `puedeVerRRHH` se la oculta — flanco declarado en el E2E de la Task 9, no hay vendedor sembrado).
2. `/libro-remuneraciones` abre en el mes anterior; si la Task 6 dejó liquidaciones emitidas, hay una fila por trabajador y la fila de totales suma; si no, muestra `Sin liquidaciones en el período …` con totales en $0.
3. `/libro-remuneraciones?periodo=2026-13` abre en el mes anterior (fallback silencioso, SIN 404) y `/libro-remuneraciones/export?periodo=2026-13` descarga el CSV del mes anterior — paridad página↔route con el patrón de los exports de contabilidad.
4. Exportar CSV descarga `libro-remuneraciones-YYYY-MM.csv` con los encabezados `RUT,Nombre,Días,Imponible,AFP,Salud,Cesantía,Impuesto único,Líquido` y la última fila `Totales del período`.
5. Una liquidación anulada (si existe) NO aparece ni en la tabla ni en el CSV.

- [ ] **Step 5: Commit**

```
git add apps/erp/app/libro-remuneraciones apps/erp/app/layout.tsx
git commit -m "feat(erp): libro de remuneraciones por período con CSV y sección Personas en el NAV

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Salida esperada: commit creado en la rama del plan con 3 archivos (2 nuevos, 1 modificado).

---

### Task 8: Panel admin — página /indicadores para mantener los indicadores previsionales

**Files:**
- Modify: `apps/admin/app/layout.tsx` (NAV mínima de dos links)
- Create: `apps/admin/app/indicadores/afps.ts`
- Create: `apps/admin/app/indicadores/acciones.ts`
- Create: `apps/admin/app/indicadores/page.tsx`

**Interfaces:**
- Consumes (de tasks previas del plan): tabla `indicadores_previsionales` (migración 0025, Task 1) con
  `periodo pk, uf int, utm int, ingreso_minimo int, tope_imponible_uf numeric(5,1), tope_cesantia_uf numeric(5,1), tasas_afp jsonb, tramos_impuesto jsonb, actualizado_en` —
  RLS: SELECT authenticated, **escritura SOLO service_role** (cero grants a authenticated; el admin
  client es la única vía de escritura, spec §2.3/§6); tipos de la tabla en `@suite/db` (task de tipos).
  Del repo (ya vivos): `verificarAdmin()` (`apps/admin/lib/guardia.ts` — lanza si el email no está en
  `ADMIN_EMAILS`), `clienteAdmin()` (`@suite/auth/admin`, service_role), `formatearCLP` y el catálogo `AFPS` (`@suite/core` — `AFPS` lo exporta la Task 4),
  `Boton/Campo/Encabezado/Entrada/Tabla/Tarjeta/Td/Th/Tr` (`@suite/ui`).
- Produces: página `/indicadores` (tabla de períodos + editar por período + crear período nuevo) y la
  server action `guardarPeriodo(formData: FormData)` (upsert por período con verificarAdmin +
  service_role, validación fail-closed).
- **Decisión de ubicación (leído el layout real):** el admin es UNA página (`app/page.tsx`, 355 líneas
  de recaudación/organizaciones) y `layout.tsx` NO tiene NAV. Mezclar indicadores en esa página sería
  ruido → se crea `/indicadores` como SEGUNDA página y se agrega una NAV de dos links (`Panel`,
  `Indicadores`) al header del layout. Patrón de acciones espejo de `apps/admin/app/acciones.ts`
  (validar input → `verificarAdmin()` → `clienteAdmin()` → throw con mensaje es-CL → `revalidatePath`).
- **Alcance (spec §6, "tasas AFP y tramos como campos individuales que arman el jsonb server-side"):**
  TODOS los campos son editables como campos numéricos individuales, INCLUIDOS los 8 tramos del
  impuesto único (desde/hasta/factor/rebaja por tramo, con defaults del período que se edita — o del
  más reciente al crear). El server action arma los jsonb `tasas_afp` y `tramos_impuesto` con
  validación fail-closed: cada tramo exige `desde < hasta`; SOLO el último admite `hasta` vacío
  (= `null`, sin tope); factores entre 0 y 1; rebajas ≥ 0.
- Reuso: la Task 4 exporta `AFPS` desde `@suite/core` (única fuente, Global Constraints) — `afps.ts`
  es SOLO la derivación local (lista de slugs + nombres) para la UI del admin, no duplica la lista.

- [ ] **Step 1: NAV en `apps/admin/app/layout.tsx`**

Dos ediciones. Import al inicio del archivo:

```tsx
import Link from 'next/link'
import type { ReactNode } from 'react'
import './globals.css'
```

y dentro del `<div className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-4">`, JUSTO ANTES de su
cierre `</div>` (después del bloque `<div>` del título "Suite ERP"), agregar:

```tsx
            <nav className="ml-auto flex gap-5 text-sm font-medium text-slate-600">
              <Link href="/" className="hover:text-marca-700">
                Panel
              </Link>
              <Link href="/indicadores" className="hover:text-marca-700">
                Indicadores
              </Link>
            </nav>
```

- [ ] **Step 2: `apps/admin/app/indicadores/afps.ts`**

```ts
// Derivaciones locales del catálogo AFPS de @suite/core (Task 4) — única
// fuente de la lista de AFP en las 3 apps (claves del jsonb tasas_afp,
// spec §2.2/§2.3): acá solo la forma que la UI del admin necesita.
import { AFPS as CATALOGO_AFPS } from '@suite/core'

export const AFPS: readonly string[] = CATALOGO_AFPS.map((a) => a.valor)

export const NOMBRES_AFP: Record<string, string> = Object.fromEntries(
  CATALOGO_AFPS.map((a) => [a.valor, a.etiqueta])
)
```

- [ ] **Step 3: `apps/admin/app/indicadores/acciones.ts`**

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

// Arma tramos_impuesto desde los campos tramo_{i}_* del formulario (spec §6:
// los tramos son campos individuales y el jsonb se arma server-side).
// Validación fail-closed: cada tramo exige desde < hasta; SOLO el último puede
// venir con hasta vacío (null = sin tope); factores entre 0 y 1; rebajas >= 0.
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
  if (lista.some((t, i) => t.hasta_utm == null && i < lista.length - 1)) {
    throw new Error('Solo el último tramo puede quedar sin tope (hasta vacío)')
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
    tasas_afp: Object.fromEntries(AFPS.map((a) => [a, positivo(formData, 'tasa_' + a)])),
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

- [ ] **Step 4: `apps/admin/app/indicadores/page.tsx`**

```tsx
import { clienteAdmin } from '@suite/auth/admin'
import { formatearCLP } from '@suite/core'
import { Boton, Campo, Encabezado, Entrada, Tabla, Tarjeta, Td, Th, Tr } from '@suite/ui'
import { verificarAdmin } from '../../lib/guardia'
import { guardarPeriodo } from './acciones'
import { AFPS, NOMBRES_AFP } from './afps'

type Tramo = { desde_utm: number; hasta_utm: number | null; factor: number; rebaja_utm: number }
type Periodo = {
  periodo: string
  uf: number
  utm: number
  ingreso_minimo: number
  tope_imponible_uf: number
  tope_cesantia_uf: number
  tasas_afp: Record<string, number>
  tramos_impuesto: Tramo[]
}

const num = (v: number) => v.toLocaleString('es-CL')

// '2026-07' → '2026-08' (sugerencia del formulario de período nuevo).
// Defaults en el destructuring: bajo noUncheckedIndexedAccess los elementos
// son number | undefined (el pattern del input garantiza el formato real).
function periodoSiguiente(p: string): string {
  const [a = 0, m = 0] = p.split('-').map(Number)
  return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`
}

function FormPeriodo({ base, nuevo }: { base: Periodo; nuevo: boolean }) {
  return (
    <form action={guardarPeriodo} className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Campo etiqueta="Período (YYYY-MM)">
          <Entrada
            name="periodo"
            defaultValue={nuevo ? periodoSiguiente(base.periodo) : base.periodo}
            readOnly={!nuevo}
            required
            pattern="\d{4}-(0[1-9]|1[0-2])"
            className={nuevo ? undefined : 'bg-slate-100'}
          />
        </Campo>
        <Campo etiqueta="UF (CLP, último día del mes)">
          <Entrada name="uf" type="number" min={1} step={1} defaultValue={base.uf} required />
        </Campo>
        <Campo etiqueta="UTM (CLP)">
          <Entrada name="utm" type="number" min={1} step={1} defaultValue={base.utm} required />
        </Campo>
        <Campo etiqueta="Ingreso mínimo (CLP)">
          <Entrada name="ingreso_minimo" type="number" min={1} step={1} defaultValue={base.ingreso_minimo} required />
        </Campo>
        <Campo etiqueta="Tope imponible (UF)">
          <Entrada name="tope_imponible_uf" type="number" min={0.1} step={0.1} defaultValue={base.tope_imponible_uf} required />
        </Campo>
        <Campo etiqueta="Tope cesantía (UF)">
          <Entrada name="tope_cesantia_uf" type="number" min={0.1} step={0.1} defaultValue={base.tope_cesantia_uf} required />
        </Campo>
      </div>
      <div>
        <p className="mb-2 text-sm font-medium text-slate-700">Tasas AFP (% total con comisión)</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {AFPS.map((a) => (
            <Campo key={a} etiqueta={NOMBRES_AFP[a] ?? a}>
              <Entrada name={'tasa_' + a} type="number" min={0.01} step={0.01} defaultValue={base.tasas_afp[a]} required />
            </Campo>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-2 text-sm font-medium text-slate-700">
          Tramos del impuesto único (mensual; desde/hasta y rebaja en UTM — el jsonb se arma en el servidor)
        </p>
        <div className="space-y-2">
          {base.tramos_impuesto.map((t, i) => (
            <div key={i} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Campo etiqueta={`Tramo ${i + 1} · desde (UTM)`}>
                <Entrada name={`tramo_${i}_desde`} type="number" min={0} step={0.01} defaultValue={t.desde_utm} required />
              </Campo>
              <Campo etiqueta="Hasta (UTM; vacío = sin tope, solo el último)">
                <Entrada name={`tramo_${i}_hasta`} type="number" min={0} step={0.01} defaultValue={t.hasta_utm ?? ''} />
              </Campo>
              <Campo etiqueta="Factor (0 a 1)">
                <Entrada name={`tramo_${i}_factor`} type="number" min={0} max={1} step={0.001} defaultValue={t.factor} required />
              </Campo>
              <Campo etiqueta="Rebaja (UTM)">
                <Entrada name={`tramo_${i}_rebaja`} type="number" min={0} step={0.01} defaultValue={t.rebaja_utm} required />
              </Campo>
            </div>
          ))}
        </div>
      </div>
      <Boton type="submit">{nuevo ? 'Crear período' : 'Guardar cambios'}</Boton>
    </form>
  )
}

export default async function PaginaIndicadores() {
  await verificarAdmin()
  const admin = clienteAdmin()
  const { data, error } = await admin
    .from('indicadores_previsionales')
    .select('*')
    .order('periodo', { ascending: false })
  if (error) throw new Error('No se pudieron cargar los indicadores previsionales')
  const periodos = (data ?? []).map((p) => ({
    ...p,
    tasas_afp: p.tasas_afp as Record<string, number>,
    tramos_impuesto: p.tramos_impuesto as Tramo[],
  })) as Periodo[]
  // Solo se usa en la rama con períodos (length > 0 garantizado por el ternario);
  // el ! evita el undefined de noUncheckedIndexedAccess.
  const reciente = periodos[0]!

  return (
    <div className="space-y-6">
      <Encabezado titulo="Indicadores previsionales" />
      {periodos.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">
          No hay períodos cargados: los siembra la migración 0025. Corre las migraciones antes de usar esta sección.
        </p>
      ) : (
        <>
          <Tabla>
            <thead>
              <Tr>
                <Th>Período</Th>
                <Th>UF</Th>
                <Th>UTM</Th>
                <Th>Ingreso mínimo</Th>
                <Th>Topes imp./ces. (UF)</Th>
                <Th>Tasas AFP</Th>
                <Th>Impuesto único</Th>
              </Tr>
            </thead>
            <tbody>
              {periodos.map((p) => (
                <Tr key={p.periodo}>
                  <Td className="font-medium tabular-nums text-slate-900">{p.periodo}</Td>
                  <Td className="tabular-nums">{formatearCLP(p.uf)}</Td>
                  <Td className="tabular-nums">{formatearCLP(p.utm)}</Td>
                  <Td className="tabular-nums">{formatearCLP(p.ingreso_minimo)}</Td>
                  <Td className="tabular-nums">
                    {num(p.tope_imponible_uf)} / {num(p.tope_cesantia_uf)}
                  </Td>
                  <Td className="text-xs">{AFPS.map((a) => `${NOMBRES_AFP[a]} ${num(p.tasas_afp[a] ?? 0)}%`).join(' · ')}</Td>
                  <Td className="text-xs">
                    {p.tramos_impuesto.length} tramos · exento hasta {num(p.tramos_impuesto[0]?.hasta_utm ?? 0)} UTM
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Tabla>

          <section className="space-y-3">
            <h2 className="text-sm font-medium text-slate-600">Editar un período</h2>
            {periodos.map((p) => (
              <details key={p.periodo} className="rounded-lg border border-slate-200 bg-white">
                <summary className="cursor-pointer px-5 py-3 text-sm font-medium text-slate-800">{p.periodo}</summary>
                <div className="border-t border-slate-100 px-5 py-4">
                  <FormPeriodo base={p} nuevo={false} />
                </div>
              </details>
            ))}
          </section>

          <Tarjeta>
            <h2 className="mb-3 text-sm font-medium text-slate-600">
              Nuevo período (valores precargados del más reciente: {reciente.periodo})
            </h2>
            <FormPeriodo base={reciente} nuevo />
          </Tarjeta>
        </>
      )}
    </div>
  )
}
```

Notas de diseño (declaradas, no negociables en la implementación):
- La seguridad REAL es RLS + service_role: `verificarAdmin()` corre en la página y en la action, y la
  escritura va por `clienteAdmin()`; un authenticated cualquiera no puede escribir la tabla aunque
  llame el endpoint (cero grants — la migración lo garantiza y el pgTAP de la Task 3 lo asserta).
- Los atributos HTML (`required`, `min`, `pattern`) son UX; la validación autoritativa es la del server
  action (fail-closed: cualquier campo inválido lanza y no escribe nada).
- Sin filas no se muestra el formulario "Nuevo período" (no hay período del cual precargar los
  defaults; la 0025 siembra 3, así que el estado vacío solo delata un reset sin migrar).

- [ ] **Step 5: Verificación**

```powershell
pnpm --filter admin build
```

→ compila sin errores y el listado de rutas incluye `ƒ /indicadores` (además de `ƒ /`). Requiere que la
migración 0025 y los tipos de `@suite/db` (tasks previas) ya estén commiteados — sin la tabla en
`types.ts`, `.from('indicadores_previsionales')` no tipa.

Byte-scan sin BOM de los 4 archivos tocados (imprime `0` por archivo y exit 1 = pass):

```bash
grep -c $'\xEF\xBB\xBF' apps/admin/app/layout.tsx apps/admin/app/indicadores/afps.ts apps/admin/app/indicadores/acciones.ts apps/admin/app/indicadores/page.tsx
```

- [ ] **Step 6: Commit**

```bash
git add apps/admin
git commit -m "feat(admin): indicadores previsionales mantenibles desde el panel de plataforma

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Seed remuneraciones + pipeline verde + E2E Playwright (task final)

**Files:**
- Modify: `scripts/seed-demo.mjs` (ÚNICO archivo de producción de esta task; el resto son comandos y verificación)

**Interfaces:**
- Consumes (ya vivos en el seed, secciones 1-21): `userCli` (cliente ANON firmado como el dueño
  `demo@suite-erp.cl`), `admin` (service_role), `empresaId`, `die(msg, err)`, helper `cuenta(tabla)`
  del RESUMEN. De tasks previas del plan: tablas `trabajadores`/`contratos` (INSERT directo por RLS rol
  dueño — vía `userCli`, NUNCA service_role: mismo motivo GOTCHA clientes/proveedores si el CHECK de
  RUT llama `app.validar_rut`, y aunque no lo llamara, el camino real es el del dueño), RPCs
  `emitir_liquidacion(p_empresa, p_trabajador, p_periodo, p_dias, p_extras, p_no_imponibles) → uuid` y
  `pagar_liquidacion(p_empresa, p_liquidacion)` (authenticated, roles dueño/admin/contador),
  `contabilizar_pendientes(p_empresa)` re-creada para cubrir liquidaciones (patrón sección 20: vía
  `userCli`; service_role daría 42501).
- **COSTURA DE INDICADORES (verificada contra el spec §2.3 amendado y declarada):** los indicadores de
  2026-05/06/07 **los siembra la MIGRACIÓN 0025** ("sembrada con valores representativos", spec §2.3;
  2026-06 CANÓNICO: uf 39200 / utm 69500 / IMM 529000 / topes 87,8/131,9; 2026-05 uf 39050 / utm 69200;
  2026-07 uf 39350 / utm 69800). El "Indicadores de los últimos 3 períodos" del spec §7 se satisface
  por esa vía: la sección 22 del seed **NO inserta ni re-siembra indicadores** — solo VERIFICA que
  2026-06 exista y muere rápido si no (delata un reset sin migrar).
- Produces: sección 22 del seed — 3 trabajadores con contratos que replican los PERFILES de los goldens
  G1-G3 (G1 Fonasa indefinido habitat 800.000; G2 Isapre plazo fijo capital 1.200.000 plan 5,0 UF;
  G3 Fonasa indefinido modelo 4.000.000 sobre tope), liquidaciones 2026-06 emitidas vía RPC (la de
  Carla además pagada) y contabilizadas con `contabilizar_pendientes`, + 2 líneas nuevas en el RESUMEN
  (`trabajadores`, `liquidaciones`). La org 2 (`ficticio2@`) queda SIN RRHH → muestra los vacíos (spec §7).
- **RUTs nuevos, mod-11 válidos, sin colisión** (grep sobre seed + `supabase/tests` + repo: cero
  ocurrencias; DV calculado con el algoritmo estándar — suma ponderada 2..7 desde la derecha):
  `15.331.204-4` (Amanda), `17.406.592-6` (Bruno), `12.883.475-3` (Carla) y `16.284.751-1` (Diego, el
  trabajador que se crea EN el E2E, no en el seed).
- Sanidad de los perfiles con los indicadores canónicos (uf 39200 / imm 529000): G1 gratificación
  200.000 < tope 209.396 → imponible 1.000.000 (simple, bajo tope); G2 plan 5,0 UF = 196.000 > 7% del
  imponible (~98.658) → manda el plan; G3 imponible topado en 3.441.760 (87,8 × 39.200) y base
  tributable en tramo 2+ del impuesto. Los montos EXACTOS (líquidos, descuentos) los fijan los goldens
  de las Tasks 3-4 (tabla contractual de Global Constraints); los inputs del seed son los MISMOS de
  los goldens: G1 = 30 días / 0 extras / **50.000 no imponibles**; G2 y G3 = 30/0/0. El seed además
  ASSERTA el golden G1 completo (imponible/descuentos/líquido) como canario del cálculo.

- [ ] **Step 1: Verificar no-colisión de RUTs (barato, antes de escribir)**

```bash
grep -rn "153312044\|174065926\|128834753\|162847511\|15331204\|17406592\|12883475\|16284751" scripts supabase apps packages
```

→ **cero matches** (verificado al redactar esta task). Si algo matchea (una task previa los usó),
elegir otro cuerpo y recalcular el DV (mod-11) antes de seguir.

- [ ] **Step 2: Sección 22 del seed — remuneraciones**

En `scripts/seed-demo.mjs`, insertar el bloque nuevo JUSTO ANTES de la línea
`// ----- Resumen de conteos -----` (a continuación de la sección 21; el catálogo contable ya está
sembrado porque `activar_contabilidad` corrió en la sección 20):

```js
// 22) Remuneraciones (Plan 18): 3 trabajadores con contratos (perfiles = goldens G1-G3)
//     + liquidaciones 2026-06 emitidas vía RPC (Carla además pagada) y CONTABILIZADAS
//     con contabilizar_pendientes (patrón sección 20: vía userCli — el hook de la app
//     no corre en el seed; el catch-up es el camino real). COSTURA: los indicadores
//     2026-05/06/07 los siembra la MIGRACIÓN 0025 (spec §2.3) — aquí solo se VERIFICA
//     que existan, jamás se insertan. La 2ª org queda SIN RRHH (muestra los vacíos).
//     RUTs mod-11 válidos sin colisión con seed/tests (grep del Step 1 de la task).
//     Inserts vía userCli (RLS por rol: INSERT dueno/admin; el CHECK de rut usa app.validar_rut).
const { data: indJun, error: eInd } = await admin.from('indicadores_previsionales').select('uf').eq('periodo', '2026-06').maybeSingle()
if (eInd || !indJun) die('indicadores 2026-06 ausentes (los siembra la migración 0025 — ¿corriste supabase db reset?)', eInd)
const { data: trabs, error: eTrab } = await userCli.from('trabajadores').insert([
  { empresa_id: empresaId, rut: '153312044', nombre: 'Amanda Rojas Fuentes', email: 'amanda.rojas@demotransportes.cl', telefono: '+56 9 5544 3322' },
  { empresa_id: empresaId, rut: '174065926', nombre: 'Bruno Castillo Mena', email: 'bruno.castillo@demotransportes.cl' },
  { empresa_id: empresaId, rut: '128834753', nombre: 'Carla Núñez Paredes', email: 'carla.nunez@demotransportes.cl' },
]).select('id, rut')
if (eTrab) die('trabajadores', eTrab)
const porRutTrab = Object.fromEntries(trabs.map((t) => [t.rut, t.id]))
const amanda = porRutTrab['153312044'], bruno = porRutTrab['174065926'], carla = porRutTrab['128834753']
const { error: eContr } = await userCli.from('contratos').insert([
  // G1: Fonasa indefinido habitat 800.000 (simple, bajo tope)
  { empresa_id: empresaId, trabajador_id: amanda, tipo: 'indefinido', fecha_inicio: '2025-03-01', cargo: 'Asistente de operaciones', sueldo_base: 800000, gratificacion_legal: true, afp: 'habitat', salud: 'fonasa' },
  // G2: Isapre plazo fijo capital 1.200.000 plan 5,0 UF (plan > 7%; sin cesantía del trabajador)
  { empresa_id: empresaId, trabajador_id: bruno, tipo: 'plazo_fijo', fecha_inicio: '2026-01-01', fecha_termino: '2026-12-31', cargo: 'Coordinador logístico', sueldo_base: 1200000, gratificacion_legal: true, afp: 'capital', salud: 'isapre', plan_isapre_uf: 5.0 },
  // G3: Fonasa indefinido modelo 4.000.000 (sobre tope imponible; impuesto en tramo 2+)
  { empresa_id: empresaId, trabajador_id: carla, tipo: 'indefinido', fecha_inicio: '2024-08-01', cargo: 'Gerente general', sueldo_base: 4000000, gratificacion_legal: true, afp: 'modelo', salud: 'fonasa' },
])
if (eContr) die('contratos', eContr)
// Liquidaciones de 2026-06 con los MISMOS inputs de los goldens G1-G3 (tabla
// contractual del plan): Amanda = G1 con 50.000 no imponibles; Bruno/Carla = 30/0/0.
const liqIds = {}
for (const [nombre, trabajadorId, noImp] of [['Amanda', amanda, 50000], ['Bruno', bruno, 0], ['Carla', carla, 0]]) {
  const { data: liqId, error: eLiq } = await userCli.rpc('emitir_liquidacion', { p_empresa: empresaId, p_trabajador: trabajadorId, p_periodo: '2026-06', p_dias: 30, p_extras: 0, p_no_imponibles: noImp })
  if (eLiq) die('emitir_liquidacion ' + nombre, eLiq)
  liqIds[nombre] = liqId
}
// Canario del golden G1 (tabla contractual del plan): si la RPC divergiera del
// golden, el seed muere aquí antes de contabilizar.
const { data: liqAmanda, error: eG1 } = await userCli.from('liquidaciones').select('total_imponible, total_descuentos, liquido').eq('id', liqIds.Amanda).single()
if (eG1 || !liqAmanda) die('lectura liquidación Amanda (golden G1)', eG1)
if (liqAmanda.total_imponible !== 1000000 || liqAmanda.total_descuentos !== 188700 || liqAmanda.liquido !== 861300) die('golden G1 del seed no calza: ' + JSON.stringify(liqAmanda) + ' ≠ imponible 1000000 / descuentos 188700 / líquido 861300', null)
const { error: ePagLiq } = await userCli.rpc('pagar_liquidacion', { p_empresa: empresaId, p_liquidacion: liqIds.Carla })
if (ePagLiq) die('pagar_liquidacion Carla', ePagLiq)
const { data: pendRem, error: ePendRem } = await userCli.rpc('contabilizar_pendientes', { p_empresa: empresaId })
if (ePendRem) die('contabilizar_pendientes (remuneraciones)', ePendRem)
if ((pendRem?.creados ?? 0) !== 3) die('se esperaban exactamente 3 asientos de remuneración nuevos, llegaron ' + (pendRem?.creados ?? 0), null)
console.log('✓ remuneraciones: 3 trabajadores + contratos (G1-G3), 3 liquidaciones 2026-06 emitidas (Carla pagada) + 3 asientos')

```

- [ ] **Step 3: RESUMEN ampliado**

En el bloque `=== RESUMEN ===` del mismo archivo, agregar DESPUÉS de la línea
`console.log('asientos contables:   ', await cuenta('asientos'))`:

```js
console.log('trabajadores:         ', await cuenta('trabajadores'))
console.log('liquidaciones:        ', await cuenta('liquidaciones'))
```

Byte-scan del archivo modificado (JAMÁS BOM U+FEFF; imprime `0` y sale con status 1 = pass):

```bash
grep -c $'\xEF\xBB\xBF' scripts/seed-demo.mjs
```

- [ ] **Step 4: Pipeline completo**

Run desde la raíz del repo (PowerShell 5.1: separar con `;`, nunca `&&`):

```powershell
npx supabase test db
```

→ **19 archivos, 392 asserts** (363 del baseline P17 en 18 archivos + `plan(29)` de
`remuneraciones.test.sql`, Task 3), todos verdes.

```powershell
pnpm test
```

→ **204 tests** verdes (192 del baseline P17 + 12 de `remuneraciones.test.ts`, Task 4; core queda
en 154).

```powershell
pnpm --filter @suite/db gen
git diff --exit-code packages/db/src/types.ts
```

→ exit 0, **cero diff**: los tipos a mano de la task de tipos son espejo byte a byte del generador. Si
hubiera diff, gana el generador: commitear su salida y volver a correr typecheck/builds.

```powershell
pnpm build --concurrency=1
```

→ **3 apps** (`web`, `erp`, `admin`) compilan sin errores. Gotcha conocido: este build **pisa el
`.next` de los dev servers corriendo** → 500s en el browser; el Step 6 los reinicia SIEMPRE antes del
checklist.

- [ ] **Step 5: Reseed de la demo (la suite pgTAP puede haberla borrado)**

```powershell
npx supabase db reset
```

→ termina con `Finished supabase db reset` (aplica las migraciones 0001..0025 — la 0025 siembra los
indicadores 2026-05/06/07).

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

→ el seed corre COMPLETO (secciones 1-22, Node ≥22 del usuario por el type-stripping de la sección 19)
y la salida incluye la línea nueva:

```
✓ remuneraciones: 3 trabajadores + contratos (G1-G3), 3 liquidaciones 2026-06 emitidas (Carla pagada) + 3 asientos
```

y el RESUMEN muestra las dos líneas nuevas con `trabajadores: 3` y `liquidaciones: 3` (y `asientos
contables` sube en 3 respecto del baseline P17).

- [ ] **Step 6: Reiniciar los dev servers (`.next` pisado por el build)**

```powershell
Get-NetTCPConnection -LocalPort 3000,3001,3002 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -Confirm:$false }
try { Remove-Item -Recurse -Force apps/web/.next, apps/erp/.next, apps/admin/.next -ErrorAction Stop } catch {}
Start-Process pnpm.cmd -ArgumentList '--filter','web','dev'
Start-Process pnpm.cmd -ArgumentList '--filter','erp','dev'
Start-Process pnpm.cmd -ArgumentList '--filter','admin','dev'
```

→ tres dev servers: web 3000, erp 3001, admin 3002. Esperar a que `http://localhost:3001` responda
antes del checklist (primer compile ~10-30s); Ctrl+Shift+R en el browser si un chunk viejo quedó
cacheado.

- [ ] **Step 7: E2E manual con Playwright MCP (checklist numerada, evidencia por punto)**

Browser vía Playwright MCP (`browser_navigate` / `browser_fill_form` / `browser_click` /
`browser_snapshot`). Documentar la evidencia de CADA ítem en el reporte:

1. **Reseed ok con la sección 22**: evidencia = la salida del Step 5 contiene la línea
   `✓ remuneraciones: ...` y el RESUMEN con `trabajadores: 3` / `liquidaciones: 3` (ya capturada;
   citarla en el reporte).
2. **NAV Personas y lista de trabajadores**: login en `http://localhost:3000/login` con
   `demo@suite-erp.cl` / `demo1234` → `http://localhost:3001/trabajadores`. Evidencia: la NAV del ERP
   muestra la sección **Personas** (entre Maestros y Análisis) y la lista tiene **3 trabajadores** con
   RUT formateado y el cargo del contrato vigente (Amanda «Asistente de operaciones», Bruno
   «Coordinador logístico», Carla «Gerente general»).
3. **Crear trabajador + contrato desde la UI**: en `/trabajadores` crear a **Diego Salas Ortiz**, RUT
   `16.284.751-1` (mod-11 válido, sin colisión — Step 1), y en su ficha crear contrato: indefinido,
   fecha inicio `2026-07-01`, cargo «Chofer troncal», sueldo base `950000`, gratificación legal sí,
   AFP `provida`, salud `fonasa`. Evidencia: Diego aparece en la lista con su cargo.
4. **Generar liquidación 2026-07 con vista previa en vivo**: `/liquidaciones` → generar → trabajador
   Diego, período `2026-07`, días 30, extras 0, no imponibles 0. Evidencia: la **vista previa (espejo
   TS) muestra el desglose completo en vivo** (imponible, AFP, salud, cesantía, impuesto, líquido) SIN
   haber emitido; ANOTAR el líquido y el detalle de la preview.
5. **Emitir → detalle imprimible + traza contable**: click Emitir. Evidencia: (a) el detalle con
   formato de liquidación chilena (empleador/trabajador, haberes y descuentos en dos columnas, líquido
   destacado) muestra **exactamente los números anotados en la preview del ítem 4** (equivalencia
   espejo TS = RPC SQL — si divergen es bug, BLOCKED); (b) la traza **«Asiento N°»** está visible y su
   link abre el asiento en `/contabilidad/asientos/[id]` con origen «Remuneración», **debe = haber** y
   las 3 cuentas ancla (gasto remuneraciones / remuneraciones por pagar / retenciones por pagar).
6. **Libro de remuneraciones 2026-06 + CSV**: `/libro-remuneraciones` período `2026-06`. Evidencia:
   **3 filas** (Amanda, Bruno, Carla) con RUT, días, imponible, AFP, salud, cesantía, impuesto y
   líquido, la **fila de totales** suma las columnas, y el **export CSV** descarga con las mismas
   filas/totales.
7. **Pagar desde la UI (spec §8)**: en el detalle de la liquidación 2026-07 de Diego (emitida en el
   ítem 5) → botón **Pagar** → «Confirmar pago». Evidencia: la insignia pasa a **Pagada** y el
   detalle muestra la fecha («Pagada el …») junto a la de emisión.
8. **Anular con motivo → reversa ligada + re-emitir**: en el detalle de la liquidación 2026-06 de
   Amanda → Anular con motivo «Error en días trabajados» (confirmación). Evidencia: (a) queda
   «anulada» con el motivo visible; (b) el asiento de la liquidación muestra la **reversa ligada**
   (glosa `Anulación liquidación 2026-06 Amanda Rojas Fuentes`); (c) **re-emitir es posible**: generar
   y emitir de nuevo 2026-06 para Amanda (el unique parcial ignora anuladas) → nueva liquidación
   emitida y el libro 2026-06 vuelve a mostrar 3 filas no-anuladas.
9. **Admin: editar indicadores y que la próxima liquidación use el valor nuevo**: login con
   `admin@suite-erp.cl` / `admin-suite-2026` en 3000 → `http://localhost:3002/indicadores` → editar
   `2026-07`: **UF 39350 → 39500**, guardar (la tabla refleja 39.500; los tramos viajan prellenados
   en el mismo formulario). En el ERP (sesión demo), generar la preview 2026-07 de **Bruno** (Isapre
   plan 5,0 UF): la salud pasa de `196.750` (5,0 × 39.350) a **`197.500`** (5,0 × 39.500) → emitir →
   el detalle muestra el snapshot con UF 39500.
   Cierre: **revertir la UF de 2026-07 a 39350** desde el mismo formulario (demo canónica); la
   liquidación de Bruno conserva su snapshot 39500 — evidencia de la auditabilidad por snapshot
   (spec §2.4).

**Cobertura del rol vendedor (declarada, no navegada):** el seed **NO crea ningún usuario vendedor**
(usuarios sembrados: `demo@suite-erp.cl` dueño, `ficticio2@suite-erp.cl` dueño de la 2ª org,
`admin@suite-erp.cl` plataforma sin organización — verificado leyendo `scripts/seed-demo.mjs` secciones
1, 17b y 18). El flanco lo cubren los asserts pgTAP de la Task 3 (vendedor 0 filas en
`trabajadores`/`contratos`/`liquidaciones` y `emitir_liquidacion` denegada con
`'Tu rol no permite emitir liquidaciones'`) — mismo criterio declarativo del ítem 7 del E2E de P17.
Evidencia: cita del assert en `remuneraciones.test.sql` en el reporte.

Si cualquier ítem falla: defecto real → **BLOCKED** con detalle (no se maquilla el checklist).

- [ ] **Step 8: Commit**

```bash
git add scripts/seed-demo.mjs
git commit -m "feat(scripts): remuneraciones en el seed — trabajadores, liquidaciones y libro nacen poblados

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 9: Reporte y cleanup**

`.superpowers/sdd/task-9-plan18-report.md` con: pipeline (392 pgTAP en 19 archivos / 204 unit / 3
builds / diff-cero de tipos), la salida del reseed (línea de la
sección 22 + RESUMEN) y el checklist E2E ítem por ítem con su evidencia (incluida la equivalencia
preview = emisión de los ítems 4-5, el pago desde la UI del ítem 7, la UF nueva del ítem 9 y la
declaración del vendedor). Nada que borrar del scratchpad (esta task no crea scripts temporales).

---

## Seams — dictámenes de los lentes (revisión aplicada)

1. **Valores "reales" de los indicadores — RESUELTO (decisión del controller):** `'2026-06'` queda EXACTO como estaba (canónico: los goldens NO se tocan); la 0025 diferencia `'2026-05'` (uf 39050, utm 69200) y `'2026-07'` (uf 39350, utm 69800) con los mismos IMM/topes/tasas/tramos, y el spec §2.3 fue AMENDADO a "valores representativos (UF/UTM proyectados; el admin de plataforma los corrige desde su panel — la fuente oficial queda en `docs/credenciales-pendientes.md` #14)". Verificado: ningún golden/test/seed depende de 05/07 (T3 y el seed usan 2026-06; el E2E usa 2026-07 solo con montos derivados en pantalla — el ítem 9 ya cita 196.750 = 5,0 × 39.350).
2. **Claim VERBATIM 0024 de la Task 2 — RESUELTO (dictamen del lente):** el procedimiento quedó operativo: los cuerpos se COPIAN de 0024 (`activar_contabilidad` 81-133, `contabilizar_documento` 296-464, `contabilizar_pendientes` 469-525, `revision_periodo` 718-956) y el ejecutor diffea contra 0024 antes de aplicar (la Task 2 lo exige como paso 4 del re-create de `revision_periodo`); backstop: los 363 asserts existentes verdes.
3. **Anclas alfabéticas de `packages/db/src/types.ts` (Task 4):** verificadas por el drafter, no re-verificadas al ensamblar. Backstop contractual: `pnpm --filter @suite/db gen` + `git diff --exit-code` en la Task 9 (si hay diff, gana el generador).
4. **Credencial admin del E2E** (`admin@suite-erp.cl` / `admin-suite-2026`, ítem 9 de la Task 9): citada del borrador, no re-verificada contra el seed al ensamblar; si difiere, tomarla de `scripts/seed-demo.mjs` (sección 18).
5. **Guards heterogéneos dentro de Personas (decisión heredada, cosmética):** `/trabajadores` muestra lista con 0 filas al vendedor por URL directa (patrón maestros), `/liquidaciones` hace `notFound()` vía `exigirRRHH` (incluye el caso sin empresa activa) y `/libro-remuneraciones` distingue `Sin empresa activa` de `notFound()` por rol. El NAV ahora oculta la sección a esos roles (Task 7); coherente con la seguridad (RLS manda), la cara por URL directa sigue heterogénea.
6. **Mensaje de rol compartido en las 3 RPCs — ACEPTADO por los lentes:** `'Tu rol no permite emitir liquidaciones'` se mantiene también en pagar/anular (decisión fijada por el plan; §4 no define mensajes propios). No se piden mensajes por acción.
7. **Aportes del empleador fuera de v1** (SIS, cesantía patronal 2,4%, mutual): límite DECLARADO en la UI del detalle y en la impresión (Task 6); el asiento solo registra descuentos del trabajador. Plan 19 los incorpora — el lente contable no debe leerlo como asiento incompleto.
