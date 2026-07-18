# Plan 16: Núcleo contable — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Partida doble real por empresa: catálogo chileno sembrado, asientos automáticos por documento (tiempo real + catch-up idempotente) y manuales, libro diario y mayor con export — con la invariante de que ningún asiento descuadrado puede entrar a la base por NINGUNA vía.

**Architecture:** Migración 0022 en dos capas (schema: modulo_contabilidad sin grant + CHECK de ventas + pagos.anticipo_id + 3 tablas con RLS por ROL; lógica: helper único `app._insertar_asiento` + 7 RPCs + catálogo + 2 re-creates); hooks nunca-lanza en 6 caminos de app con ids capturados; UI /contabilidad (resumen, cuentas, asientos, diario, mayor) + toggle + NAV por rol; seed activa vía usuario dueño.

**Tech Stack:** Postgres 17 (RLS, pgTAP, advisory locks), Next.js 15, Vitest, CSV export (filasACsv).

**Spec:** `docs/superpowers/specs/2026-07-17-plan16-contabilidad-design.md` (2 lentes aplicados: auditor contable + técnico; §§1-8 son CONTRATO — la tabla de mapeos §4 y sus notas de trazas son ley).

## Global Constraints

- **Invariante suprema (§1)**: TODA creación de asiento pasa por `app._insertar_asiento(...)` (SIN grants; valida cuentas de la empresa/activas/hoja, montos enteros con exactamente uno positivo por línea, `Σdebe = Σhaber > 0`, correlativo, inserta asiento+líneas). Ninguna RPC inserta asientos por su cuenta. 0022 agrega a `documentos_venta` el CHECK `total = neto + exento + iva` (espejo 0013).
- **Orden de candados UNIFORME**: toda RPC que crea asientos toma PRIMERO `perform pg_advisory_xact_lock(hashtextextended('asientos:' || p_empresa::text, 42))` y DESPUÉS cualquier `for update` de documentos (anti-deadlock batch↔hook).
- **Orígenes**: `manual|venta|nota_credito|compra|pago|pago_proveedor|anticipo|reversa` — SIN 'aplicacion_anticipo': la regla `pago` ramifica el DEBE por `pagos.anticipo_id` (null → Banco = plata nueva; not null → Anticipos de clientes = reclasificación). Unique parcial `(empresa_id, origen, referencia_id) where referencia_id is not null` = idempotencia; `(empresa_id, reversa_de)` parcial = una reversa por asiento; `(empresa_id, numero)`.
- **Mapeos (§4, montos SIEMPRE de filas reales; líneas monto 0 se omiten; 0 líneas → 'noop' sin asiento NI pendiente)**: venta emitida → Debe Clientes(total) / Haber Ventas(neto)+Ventas exentas(exento)+IVA débito(iva); NC → inversa; compra activa → Debe Compras/Gastos(neto+exento)+IVA crédito(iva) / Haber Proveedores(total); pago activo → Debe [Banco|Anticipos](monto) / Haber Clientes(monto); pago_proveedor activo → Debe Proveedores / Haber Banco; anticipo `mp_payment_id NOT NULL` → Debe Banco / Haber Anticipos de clientes. Excedente-de-aplicación (`mp_payment_id NULL`) → 'noop' (jamás duplicar el pasivo). Suscripciones de plataforma: JAMÁS se contabilizan.
- **Fechas contables**: ventas/NC `coalesce(emitido_en, creado_en)::date` (idéntico a libro_ventas 0011); compras `fecha_emision`; pagos su fecha; anticipos `recibido_en::date`. Manuales: > 2000-01-01 y ≤ hoy+1 día.
- **`cuentas_contables`**: codigo jerárquico unique por empresa, tipo `activo|pasivo|patrimonio|ingreso|gasto`, `acepta_movimientos` (solo hojas reciben líneas), `clave_sistema` unique parcial con las 10 anclas (`caja, banco, clientes, anticipos_clientes, iva_debito, iva_credito, proveedores, ventas, ventas_exentas, compras_gastos` — `caja` sin uso automático: efectivo→Banco v1). CERO escritura directa (RLS no ve OLD/NEW): todo por `guardar_cuenta`. Grant SOLO select.
- **`asientos`/`asientos_lineas`**: inmutables (sin update/delete en ninguna vía); `creado_por uuid null default auth.uid()`; RLS select **POR ROL** dueno/admin/contador vía `app.tiene_rol_en_empresa` (primera del repo — vendedor/bodeguero ven 0 filas); CERO escritura directa; service_role completo; grants explícitos.
- **`empresas.modulo_contabilidad`**: SIN grant de columna (flip crudo bloqueado — pgTAP 42501); activar/desactivar SOLO por RPC. `pagos.anticipo_id uuid null` + FK compuesta a anticipos (su unique (empresa_id,id) ya existe 0018:69).
- **RPCs (7 + helper)**: `activar_contabilidad` (dueno/admin; idempotente; siembra catálogo ~25 por clave_sistema + flag), `desactivar_contabilidad` (solo flag off), `contabilizar_pendientes returns jsonb {creados}` (dueno/admin/contador; recorre EN ORDEN DE FECHA todo lo contabilizable sin asiento; motor único de activación/catch-up/botón), `crear_asiento` (dueno/admin/contador; jsonb de líneas patrón registrar_pago), `revertir_asiento` (inverso ligado origen 'reversa', fecha hoy), `contabilizar_documento returns text 'creado'|'noop'` (SOLO service_role; no-op limpio: módulo inactivo / ya existe (idempotencia bajo lock + backstop 23505) / objeto no aplica / 0 líneas), `guardar_cuenta` (dueno/admin/contador; cuentas de sistema: SOLO codigo/nombre mutables). security definer set search_path = public; revoke anon/public; matrix explícita.
- **Re-creates** de `aplicar_anticipo` y `aplicar_anticipo_manual` (el 0018 VIGENTE ya trae el split dc1526b): VERBATIM + exactamente DOS cambios c/u — setear `anticipo_id` en el insert del pago y RETORNAR el `pago_id` (hoy void). Diff declarado contra el original.
- **Mensajes contractuales EXACTOS (10)**: `'La contabilidad no está activada'`, `'Un asiento necesita al menos dos líneas'`, `'Cuenta contable no válida'`, `'Cada línea lleva debe o haber, mayor que cero'`, `'El asiento no cuadra: debe y haber difieren'`, `'Tu rol no permite crear asientos'`, `'El asiento no existe'`, `'El asiento ya fue revertido'`, `'Las cuentas del sistema no se pueden modificar así'`, `'Ya existe una cuenta con ese código'`.
- **Hooks de app** (`apps/erp/lib/contabilidad.ts` → `contabilizarAsiento(empresaId, origen, referenciaId)` — admin client, NUNCA lanza, espejo registrarMovimientosDocumento) con ids POR CAMINO (§5): emisión usa el id local; cobranza/por-pagar CAPTURAN el uuid que sus RPCs ya retornan (+ `.select('id')` en el insert de compra); webhook/retorno MP resuelven por `mp_payment_id` post-RPC (puede haber pago Y anticipo-excedente: se contabilizan ambos); aplicación usa el pago_id retornado por las re-creates.
- **UI**: NAV condicionado por `modulo_contabilidad` Y ROL (agregar `modulo_contabilidad` a `EmpresaResumen` y el rol del usuario al layout — vendedor NI VE el link); pages con guard módulo+rol; export routes con guard EXPLÍCITO módulo+rol (403, no CSV vacío — lección P12); toggle en /configuracion/modulos llama activar+pendientes y muestra `{creados}`; detalle de venta y lista de pagos muestran "Asiento N°X" (query por origen+referencia); compra difiere hasta tener página de detalle (ver Task 7 y spec §6).
- **Seed**: sección nueva al final — activa vía `userCli` (dueño demo; RPCs son authenticated — admin client daría 42501) + imprime conteo. 2ª org queda sin contabilidad.
- **Conteos finales EXACTOS**: pgTAP **315** (279 + 36, `plan(36)`, 16 archivos — el redactor de la task diseña el mapeo de 36 cubriendo TODO el set del spec §8), unit **176** (SIN cambios — la cuadratura viva del form es inline, no se extraen helpers a core), 3 apps build.
- CERO BOM literal (escape backslash-uFEFF; byte-scan `grep -c` exit 1 = pass); UTF-8; español; Windows/PowerShell 5.1 (`&&` no encadena; PATH refresh en shells nuevas). RUTs de fixtures nuevos válidos módulo-11 sin colisión global.

---

### Task 1: Migración 0022 — schema de contabilidad (capa 1)

**Files:**
- Create: `supabase/migrations/00000000000022_contabilidad.sql`

**Interfaces:**
- Consumes: `empresas` (0001/0004/0016 — blanco del ALTER de `modulo_contabilidad`; la FK de `empresa_id`), `documentos_venta` con su CHECK inline de 0004 (blanco del re-create del CHECK de cuadratura), `pagos` con `unique (empresa_id, id)` (0010 — blanco del ALTER `anticipo_id`), `anticipos` con `unique (empresa_id, id)` (0018:69 — blanco de la FK de `pagos.anticipo_id`), `app.tiene_rol_en_empresa()` (0003 — RLS por rol), `auth.uid()` (default de `asientos.creado_por`). El rol `contador` ya es válido en el CHECK de `miembros.rol` (0001, confirmado contra la BD).
- Produces: `empresas.modulo_contabilidad` (SIN grant de columna a authenticated); el CHECK `documentos_venta_total_check` re-creado COMBINADO (`total >= 0 AND total = neto + exento + iva`); `pagos.anticipo_id` + FK compuesta `pagos_anticipo_fk`; las 3 tablas `cuentas_contables` / `asientos` / `asientos_lineas` (uniques parciales de idempotencia/reversa/clave_sistema; RLS **select POR ROL** dueno/admin/contador — primera del repo; CERO escritura directa; grants explícitos solo select + service_role completo). El archivo termina con la marca `-- ===== RPCs (Task 2) =====`; Task 2 anexa el helper, las 7 RPCs, el catálogo y los 2 re-creates tras ella.
- ESPEJOS leídos antes de escribir: `0016` (patrón `modulo_transporte` para CONTRASTAR — aquí SIN grant de columna), `0013` (el CHECK combinado `documentos_compra_check`), `0014` (advisory lock del correlativo), `0018` (tablas nuevas con policy de select + grants; `anticipos.unique (empresa_id, id)`), `0004`/`0010` (`documentos_venta`/`pagos`). Convención del schema: comentarios SQL en ASCII (sin tildes); mensajes de usuario con tildes correctas.
- **HALLAZGO CRÍTICO (verificado contra la BD, resuelto en el SQL de abajo):** el nombre `documentos_venta_total_check` YA está ocupado — es el CHECK inline `total >= 0` de 0004 (Postgres lo auto-nombró con la convención `tabla_columna_check`). La DDL literal del spec §3 (`add constraint documentos_venta_total_check check (total = neto + exento + iva)`) FALLARÍA con `constraint ... already exists`. Se DROPEA y re-crea COMBINADO (`total >= 0 AND total = neto + exento + iva`) — la misma semántica que `documentos_compra_check` de 0013 (el verdadero espejo), conservando el nombre del spec. Un CHECK no admite ALTER en su lugar (patrón del re-create de `pagos_metodo_check` en 0018).

- [ ] **Step 1: Escribir la migración (capa 1)**

`supabase/migrations/00000000000022_contabilidad.sql`:

```sql
-- Contabilidad (Plan 16): partida doble real por empresa. Capa 1 (Task 1):
-- modulo_contabilidad SIN grant de columna (flip crudo bloqueado; activar y
-- desactivar van SOLO por RPC), el CHECK de cuadratura en documentos_venta
-- (espejo del que compras ya tiene, 0013), pagos.anticipo_id (marca los pagos
-- nacidos de aplicar un anticipo) y las tres tablas del nucleo contable
-- (cuentas_contables, asientos, asientos_lineas) con RLS select POR ROL
-- (primera del repo: dueno/admin/contador via app.tiene_rol_en_empresa; el
-- vendedor y el bodeguero ven 0 filas) y CERO escritura directa. Task 2 anexa
-- el helper de insercion, las 7 RPCs, el catalogo chileno y los 2 re-creates
-- tras la marca del final.
--
-- Invariante suprema: ningun asiento descuadrado entra jamas a la base — TODA
-- creacion pasa por app._insertar_asiento (Task 2), que valida Sigma-debe =
-- Sigma-haber > 0 antes de escribir. Este archivo pone los candados de schema
-- (inmutabilidad por ausencia de grants) sobre los que ese invariante se apoya.

-- ---------- empresas: modulo_contabilidad (SIN grant de columna) ----------
alter table public.empresas
  add column if not exists modulo_contabilidad boolean not null default false;
-- Deliberadamente SIN `grant update (modulo_contabilidad) ... to authenticated`
-- (a diferencia de modulo_transporte 0016): un flip crudo por Data API saltaria
-- la siembra del catalogo. Activar y desactivar van SOLO por RPC
-- (activar_contabilidad / desactivar_contabilidad, Task 2). Un update directo de
-- authenticated sobre esta columna falla con 42501 (verificado).

-- ---------- documentos_venta: CHECK de cuadratura (espejo de compras 0013) ----------
-- documentos_venta ya trae de 0004 el CHECK inline `total >= 0`, que Postgres
-- nombro `documentos_venta_total_check` (convencion tabla_columna_check,
-- confirmado contra la BD). Ese nombre esta ocupado: se DROPEA y re-crea
-- COMBINADO (`total >= 0 AND total = neto + exento + iva`) — la misma semantica
-- que `documentos_compra_check` de 0013. Un CHECK no admite ALTER en su lugar
-- (patron del re-create de pagos_metodo_check en 0018). Cierra la manipulacion
-- por escritura directa que rompio la cuadratura automatica de las ventas.
alter table public.documentos_venta drop constraint documentos_venta_total_check;
alter table public.documentos_venta add constraint documentos_venta_total_check
  check (total >= 0 and total = neto + exento + iva);

-- ---------- pagos.anticipo_id (marca los pagos nacidos de aplicar un anticipo) ----------
-- FK compuesta a anticipos (su unique (empresa_id, id) ya existe, 0018:69). La
-- rellenan las re-creates de aplicar_anticipo / aplicar_anticipo_manual (Task 2);
-- distingue el hecho contable del pago: con anticipo_id = reclasificacion (no es
-- plata nueva, debe a Anticipos de clientes); sin = plata al banco.
alter table public.pagos add column if not exists anticipo_id uuid;
alter table public.pagos add constraint pagos_anticipo_fk
  foreign key (empresa_id, anticipo_id) references public.anticipos (empresa_id, id);

-- ---------- cuentas_contables (plan de cuentas por empresa) ----------
-- codigo jerarquico visible ('1.1.01'); clave_sistema ancla ESTABLE de los
-- mapeos automaticos (unica parcial). CERO escritura directa: RLS con WITH CHECK
-- no compara OLD vs NEW, asi que la inmutabilidad de clave/tipo de las cuentas de
-- sistema es inexpresable por policy — crear/editar/desactivar van por la RPC
-- guardar_cuenta (Task 2).
create table public.cuentas_contables (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  codigo text not null,
  nombre text not null,
  tipo text not null check (tipo in ('activo', 'pasivo', 'patrimonio', 'ingreso', 'gasto')),
  -- Solo las hojas reciben lineas de asiento; los grupos (1, 1.1, ...) no.
  acepta_movimientos boolean not null default true,
  -- Ancla estable de los mapeos automaticos: caja, banco, clientes,
  -- anticipos_clientes, iva_debito, iva_credito, proveedores, ventas,
  -- ventas_exentas, compras_gastos. Null en las cuentas propias del usuario.
  clave_sistema text,
  activa boolean not null default true,
  creado_en timestamptz not null default now(),
  unique (empresa_id, id),
  unique (empresa_id, codigo)
);
create unique index cuentas_contables_clave_idx
  on public.cuentas_contables (empresa_id, clave_sistema) where clave_sistema is not null;

-- ---------- asientos (cabecera del asiento; INMUTABLE: sin update/delete) ----------
-- numero correlativo por empresa (advisory lock, patron cotizaciones 0014).
-- origen + referencia_id => trazabilidad e idempotencia; UN solo origen 'pago'
-- para todo pago de cliente (la REGLA ramifica el debe por pagos.anticipo_id).
-- Corregir = revertir_asiento (asiento inverso ligado por reversa_de, a lo mas
-- una reversa por asiento).
create table public.asientos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  numero integer not null,
  fecha date not null,
  glosa text not null,
  origen text not null check (origen in
    ('manual', 'venta', 'nota_credito', 'compra', 'pago', 'pago_proveedor', 'anticipo', 'reversa')),
  referencia_id uuid,
  reversa_de uuid,
  -- Auditoria de manuales/reversas; null en los automaticos (service_role).
  creado_por uuid default auth.uid(),
  creado_en timestamptz not null default now(),
  unique (empresa_id, id),
  unique (empresa_id, numero),
  foreign key (empresa_id, reversa_de) references public.asientos (empresa_id, id)
);
-- Idempotencia: a lo mas UN asiento por (empresa, origen, referencia).
create unique index asientos_referencia_idx
  on public.asientos (empresa_id, origen, referencia_id) where referencia_id is not null;
-- Una reversa por asiento.
create unique index asientos_reversa_idx
  on public.asientos (empresa_id, reversa_de) where reversa_de is not null;
create index asientos_lista_idx on public.asientos (empresa_id, fecha desc, numero desc);

-- ---------- asientos_lineas (detalle; exactamente uno de debe/haber > 0) ----------
create table public.asientos_lineas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  asiento_id uuid not null,
  cuenta_id uuid not null,
  debe integer not null default 0 check (debe >= 0),
  haber integer not null default 0 check (haber >= 0),
  glosa text,
  -- CLP enteros: exactamente uno positivo por linea.
  check ((debe = 0) <> (haber = 0)),
  foreign key (empresa_id, asiento_id) references public.asientos (empresa_id, id) on delete cascade,
  foreign key (empresa_id, cuenta_id) references public.cuentas_contables (empresa_id, id)
);
create index asientos_lineas_asiento_idx on public.asientos_lineas (empresa_id, asiento_id);

-- ---------- RLS: select POR ROL (primera del repo) ----------
-- dueno/admin/contador ven la contabilidad; vendedor/bodeguero ven 0 filas.
-- CERO escritura directa (ni policy ni grant de insert/update/delete a
-- authenticated): todo entra por las RPCs de Task 2. service_role completo.
alter table public.cuentas_contables enable row level security;
alter table public.asientos enable row level security;
alter table public.asientos_lineas enable row level security;

create policy "contables ven cuentas" on public.cuentas_contables
  for select to authenticated
  using (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin', 'contador']));
create policy "contables ven asientos" on public.asientos
  for select to authenticated
  using (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin', 'contador']));
create policy "contables ven lineas de asiento" on public.asientos_lineas
  for select to authenticated
  using (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin', 'contador']));

-- ---------- Grants Data API (leccion Plan 1) ----------
grant select on public.cuentas_contables, public.asientos, public.asientos_lineas to authenticated;
grant select, insert, update, delete on public.cuentas_contables, public.asientos, public.asientos_lineas to service_role;

-- ===== RPCs (Task 2) =====
```

- [ ] **Step 2: Aplicar y verificar**

Run: `pnpm supabase db reset` → aplica 0001-0022 sin errores (0022 termina en la marca; las RPCs llegan en Task 2). El `drop`/`add` del CHECK corre sobre tablas vacías (las migraciones preceden al seed), así que jamás choca con datos.

Run: `pnpm supabase test db` → **15 archivos, 279 asserts** siguen verdes. El CHECK combinado NO rompe ningún fixture: todos los inserts directos de `documentos_venta` de los tests y del seed cumplen `total = neto + exento + iva` (verificado contra la BD — la única inserción sin montos, en `transporte.test.sql`, deja los cuatro en 0). El archivo `contabilidad.test.sql` lo escribe una task posterior — aún no existe.

Smoke de privilegios (contrato de escritura de una vez):

```
docker exec supabase_db_ERP_Transportes psql -U postgres -d postgres -c "select has_column_privilege('authenticated','public.empresas','modulo_contabilidad','update') as mc_col, has_column_privilege('authenticated','public.empresas','razon_social','update') as rs_col, has_table_privilege('authenticated','public.asientos','select') as a_sel, has_table_privilege('authenticated','public.asientos','insert') as a_ins, has_table_privilege('service_role','public.asientos','insert') as a_sr, has_table_privilege('authenticated','public.cuentas_contables','select') as c_sel, has_table_privilege('authenticated','public.cuentas_contables','insert') as c_ins;"
```

→ `mc_col = f` (SIN grant de columna: el flip crudo queda bloqueado), `rs_col = t` (los grants por columna de 0016 siguen vivos: NO se re-declaró la lista), `a_sel = t`, `a_ins = f` (CERO escritura directa), `a_sr = t` (service_role escribe), `c_sel = t`, `c_ins = f`.

Smoke del CHECK combinado:

```
docker exec supabase_db_ERP_Transportes psql -U postgres -d postgres -c "select pg_get_constraintdef(oid) from pg_constraint where conname = 'documentos_venta_total_check';"
```

→ `CHECK (((total >= 0) AND (total = ((neto + exento) + iva))))` — misma semántica que `documentos_compra_check` (0013).

Smoke del flip crudo bloqueado (42501):

```
docker exec supabase_db_ERP_Transportes psql -U postgres -d postgres -c "begin; set local role authenticated; do \$\$ begin update public.empresas set modulo_contabilidad = true; raise notice 'FALLO: no bloqueo'; exception when insufficient_privilege then raise notice 'OK 42501 insufficient_privilege'; end \$\$; rollback;"
```

→ imprime `NOTICE: OK 42501 insufficient_privilege` (un update directo de `modulo_contabilidad` por authenticated no tiene grant de columna → 42501; activar/desactivar van SOLO por RPC).

Smoke de los índices únicos parciales:

```
docker exec supabase_db_ERP_Transportes psql -U postgres -d postgres -c "select indexname from pg_indexes where indexname in ('cuentas_contables_clave_idx','asientos_referencia_idx','asientos_reversa_idx') order by indexname;"
```

→ tres filas (idempotencia por `(empresa, origen, referencia)`, una reversa por asiento, y `clave_sistema` única parcial).

Byte-scan del archivo (JAMÁS BOM U+FEFF):

```
grep -c $'\xEF\xBB\xBF' supabase/migrations/00000000000022_contabilidad.sql
```

→ imprime `0` y sale con status 1 (sin coincidencias = pass).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/00000000000022_contabilidad.sql
git commit -m "feat(db): contabilidad — schema de cuentas, asientos y candados"
```

---

### Task 2: Migración 0022 — helper, 7 RPCs, catálogo y 2 re-creates (capa 2)

**Files:**
- Modify: `supabase/migrations/00000000000022_contabilidad.sql` (anexa DESPUÉS de la marca `-- ===== RPCs (Task 2) =====` de Task 1; la marca se conserva, patrón 0016/0018).

**Interfaces:**
- Consumes (Task 1, mismo archivo): `cuentas_contables` / `asientos` / `asientos_lineas`, `empresas.modulo_contabilidad`, `pagos.anticipo_id`. Del schema previo: `documentos_venta`/`pagos`/`pagos_aplicaciones` (0004/0010 — saldo INLINE del re-create), `documentos_compra` (0013), `pagos_proveedor` (0013), `anticipos` (0018), `proformas`/`cotizaciones` (0014/0016), `app.tiene_rol_en_empresa()` (0003).
- Produces: el helper `app._insertar_asiento` (SIN grants — único funnel de creación; valida cuentas de la empresa/activas/hoja, montos enteros con exactamente uno positivo, `Σdebe = Σhaber > 0`, numera el correlativo); 7 RPCs (`activar_contabilidad`, `desactivar_contabilidad` = dueno/admin; `contabilizar_pendientes` returns jsonb `{creados}`, `crear_asiento`, `revertir_asiento`, `guardar_cuenta` = dueno/admin/contador; `contabilizar_documento` returns text `'creado'|'noop'` = SOLO service_role); el catálogo de 27 cuentas pyme chilenas con las 10 claves de sistema; y los 2 RE-CREATES de `aplicar_anticipo` (service_role) y `aplicar_anticipo_manual` (authenticated).
- ESPEJOS: el saldo INLINE de las re-creates es copia EXACTA de las versiones VIGENTES en 0018 (con el split dc1526b); el advisory lock del correlativo es el patrón de cotizaciones 0014 (`hashtextextended('asientos:' || p_empresa, 42)`). Grants execute: `revoke ... from anon, public` y luego `grant ... to authenticated` (RPCs de usuario) o `to service_role` (el hook); el helper `app._insertar_asiento` NO recibe grant (solo lo invocan estas RPCs, que corren como su definer superusuario). `service_role` NO hereda execute de authenticated.
- **Orden de candados UNIFORME (anti-deadlock)**: cada RPC que crea asientos toma PRIMERO `pg_advisory_xact_lock(hashtextextended('asientos:' || p_empresa::text, 42))` y DESPUÉS cualquier `for update` de documentos; el helper numera bajo ese candado ya tomado. `contabilizar_pendientes` lo toma una vez al inicio y reusa `contabilizar_documento` (re-toma el mismo lock — reentrante, no-op) como motor por documento → activación, catch-up y botón de la UI son la MISMA RPC.
- **Mapeos (§4, verificados en vivo con golden por regla)**: venta emitida → Debe Clientes(total) / Haber Ventas(neto) + Ventas exentas(exento) + IVA débito(iva); NC → inversa; compra activa → Debe Compras/Gastos(neto+exento) + IVA crédito(iva) / Haber Proveedores(total); pago activo → Debe [Banco si `anticipo_id` null, Anticipos de clientes si no](monto) / Haber Clientes(monto); pago_proveedor activo → Debe Proveedores / Haber Banco; anticipo `mp_payment_id NOT NULL` → Debe Banco / Haber Anticipos de clientes. Líneas con monto 0 se omiten; 0 líneas → `'noop'` sin asiento; excedente-de-aplicación (`mp_payment_id NULL`) → `'noop'`. La cuadratura de venta/NC/compra la garantiza el CHECK `total = neto + exento + iva` (Task 1).
- **Mensajes contractuales EXACTOS (verificados en vivo)**: `'La contabilidad no está activada'`, `'Un asiento necesita al menos dos líneas'`, `'Cuenta contable no válida'`, `'Cada línea lleva debe o haber, mayor que cero'`, `'El asiento no cuadra: debe y haber difieren'`, `'Tu rol no permite crear asientos'` (crear y revertir), `'El asiento no existe'`, `'El asiento ya fue revertido'`, `'Las cuentas del sistema no se pueden modificar así'`, `'Ya existe una cuenta con ese código'`. No contractuales (elegidos para claridad y consumidos por la task de pgTAP): `'Tu rol no permite activar/desactivar la contabilidad'`, `'Tu rol no permite contabilizar'`, `'Tu rol no permite editar el plan de cuentas'`, `'La cuenta necesita código y nombre'`, `'Tipo de cuenta no válido'`, `'El asiento necesita una glosa'`, `'La fecha del asiento no es válida'`.
- **HALLAZGO (verificado): las 2 re-creates cambian el tipo de retorno `void → uuid`.** `create or replace function` NO puede cambiar el tipo de retorno de una función existente → hay que `drop function` ANTES de recrear (el SQL de abajo ya lo hace con `drop function if exists`). Cada re-create es VERBATIM del 0018 vigente + exactamente DOS cambios: (1) `returns uuid` y `return v_pago;` al final (los caminos no-op de `aplicar_anticipo` retornan `null`); (2) el insert del pago agrega la columna `anticipo_id` con valor `v_ant.id`. Diff declarado en el comentario de cada función.

- [ ] **Step 1: Anexar el helper, las RPCs, el catálogo y los re-creates tras la marca**

Agregar al FINAL de `supabase/migrations/00000000000022_contabilidad.sql` (después de la línea `-- ===== RPCs (Task 2) =====`):

```sql
-- ================== Contabilidad: helper, RPCs y catalogo (Task 2) ==================
-- security definer + set search_path = public. Orden de candados UNIFORME
-- anti-deadlock: toda RPC que crea asientos toma PRIMERO el advisory xact-lock
-- del correlativo (hashtextextended('asientos:' || p_empresa, 42)) y DESPUES
-- cualquier for update de documentos; el helper numera bajo ese candado.

-- ---------- Helper interno de insercion (SIN grants: solo lo llaman las RPCs) ----------
-- Unico funnel de creacion de asientos: valida cada linea (cuenta de la empresa,
-- activa, hoja; entero >= 0 con exactamente uno positivo), la cuadratura global
-- (Sigma-debe = Sigma-haber > 0) y numera el correlativo (advisory lock ya
-- tomado por la RPC). Aqui vive el invariante suprema, en un solo lugar.
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

-- ---------- Activar contabilidad (dueno/admin; idempotente; siembra catalogo) ----------
-- Siembra el plan de cuentas pyme chileno si aun no existe (por clave_sistema) y
-- enciende el flag. NO contabiliza (eso es contabilizar_pendientes; la ACTION del
-- toggle llama ambas seguidas). Unica via, con desactivar_contabilidad, de mover
-- modulo_contabilidad (la columna no tiene grant de update, capa 1).
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

-- ---------- Desactivar contabilidad (dueno/admin; solo apaga el flag) ----------
-- Los asientos y las cuentas quedan; solo se esconde la UI. Junto con
-- activar_contabilidad, la UNICA via de mover modulo_contabilidad.
create or replace function public.desactivar_contabilidad(p_empresa uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin']) then
    raise exception 'Tu rol no permite desactivar la contabilidad';
  end if;
  update empresas set modulo_contabilidad = false where id = p_empresa;
end $$;
revoke execute on function public.desactivar_contabilidad(uuid) from anon, public;
grant execute on function public.desactivar_contabilidad(uuid) to authenticated;

-- ---------- Contabilizar documento (SOLO service_role; hook y motor del catch-up) ----------
-- No-op limpio si: modulo inactivo, ya existe asiento (idempotencia bajo el
-- candado + backstop 23505), el objeto no aplica (anulado/inexistente) o el
-- mapeo produce 0 lineas (documento total 0). Aplica la REGLA del origen leyendo
-- las filas reales bajo el candado del documento y crea via _insertar_asiento (la
-- cuadratura se re-valida SIEMPRE, tambien en la via automatica).
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

-- ---------- Contabilizar pendientes (dueno/admin/contador; motor unico) ----------
-- Recorre EN ORDEN DE FECHA todo lo contabilizable sin asiento y lo crea con las
-- reglas de contabilizar_documento. Idempotente. La activacion, el catch-up y el
-- boton de la UI son la MISMA RPC.
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
    order by t.fecha, t.origen, t.referencia_id
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

-- ---------- Crear asiento manual (dueno/admin/contador) ----------
create or replace function public.crear_asiento(
  p_empresa uuid, p_fecha date, p_glosa text, p_lineas jsonb
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_glosa text;
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'contador']) then
    raise exception 'Tu rol no permite crear asientos';
  end if;
  if not exists (select 1 from empresas where id = p_empresa and modulo_contabilidad) then
    raise exception 'La contabilidad no está activada';
  end if;
  if p_lineas is null or jsonb_array_length(p_lineas) < 2 then
    raise exception 'Un asiento necesita al menos dos líneas';
  end if;
  v_glosa := nullif(trim(coalesce(p_glosa, '')), '');
  if v_glosa is null then
    raise exception 'El asiento necesita una glosa';
  end if;
  -- Fecha en rango: > 2000-01-01 y <= hoy + 1 dia (herencia timezone repo-wide).
  if p_fecha is null or p_fecha < date '2000-01-01' or p_fecha > current_date + 1 then
    raise exception 'La fecha del asiento no es válida';
  end if;

  -- Candado del correlativo PRIMERO (sin for update de documentos en el manual).
  perform pg_advisory_xact_lock(hashtextextended('asientos:' || p_empresa::text, 42));

  -- El helper valida cuentas/montos/cuadratura y numera bajo el candado.
  return app._insertar_asiento(p_empresa, p_fecha, v_glosa, 'manual', null, null, auth.uid(), p_lineas);
end $$;
revoke execute on function public.crear_asiento(uuid, date, text, jsonb) from anon, public;
grant execute on function public.crear_asiento(uuid, date, text, jsonb) to authenticated;

-- ---------- Revertir asiento (dueno/admin/contador; inverso ligado) ----------
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

-- ---------- Guardar cuenta (dueno/admin/contador; crea o edita; nunca borra) ----------
-- p_id null = crea una cuenta propia (sin clave_sistema). Editar: en las cuentas
-- del sistema SOLO codigo/nombre mutan (tipo/acepta_movimientos/activa intactos);
-- en las propias todo muta. Desactivar cuentas propias via p_activa (los asientos
-- historicos no se tocan). Codigo duplicado -> mensaje contractual.
create or replace function public.guardar_cuenta(
  p_empresa uuid, p_id uuid, p_codigo text, p_nombre text,
  p_tipo text, p_acepta_movimientos boolean, p_activa boolean
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_codigo text;
  v_nombre text;
  v_cuenta record;
  v_id uuid;
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'contador']) then
    raise exception 'Tu rol no permite editar el plan de cuentas';
  end if;
  if not exists (select 1 from empresas where id = p_empresa and modulo_contabilidad) then
    raise exception 'La contabilidad no está activada';
  end if;

  v_codigo := nullif(trim(coalesce(p_codigo, '')), '');
  v_nombre := nullif(trim(coalesce(p_nombre, '')), '');
  if v_codigo is null or v_nombre is null then
    raise exception 'La cuenta necesita código y nombre';
  end if;
  if p_tipo is null or p_tipo not in ('activo', 'pasivo', 'patrimonio', 'ingreso', 'gasto') then
    raise exception 'Tipo de cuenta no válido';
  end if;

  if p_id is null then
    begin
      insert into cuentas_contables (empresa_id, codigo, nombre, tipo, acepta_movimientos, activa)
      values (p_empresa, v_codigo, v_nombre, p_tipo, coalesce(p_acepta_movimientos, true), coalesce(p_activa, true))
      returning id into v_id;
    exception when unique_violation then
      raise exception 'Ya existe una cuenta con ese código';
    end;
    return v_id;
  end if;

  select * into v_cuenta from cuentas_contables
  where id = p_id and empresa_id = p_empresa
  for update;
  if not found then
    raise exception 'Cuenta contable no válida';
  end if;

  if v_cuenta.clave_sistema is not null then
    -- Cuentas del sistema: SOLO codigo/nombre mutables.
    if p_tipo <> v_cuenta.tipo
       or coalesce(p_acepta_movimientos, v_cuenta.acepta_movimientos) <> v_cuenta.acepta_movimientos
       or coalesce(p_activa, v_cuenta.activa) <> v_cuenta.activa then
      raise exception 'Las cuentas del sistema no se pueden modificar así';
    end if;
    begin
      update cuentas_contables set codigo = v_codigo, nombre = v_nombre
      where id = p_id and empresa_id = p_empresa;
    exception when unique_violation then
      raise exception 'Ya existe una cuenta con ese código';
    end;
    return p_id;
  end if;

  -- Cuenta propia: todo mutable.
  begin
    update cuentas_contables
    set codigo = v_codigo, nombre = v_nombre, tipo = p_tipo,
        acepta_movimientos = coalesce(p_acepta_movimientos, acepta_movimientos),
        activa = coalesce(p_activa, activa)
    where id = p_id and empresa_id = p_empresa;
  exception when unique_violation then
    raise exception 'Ya existe una cuenta con ese código';
  end;
  return p_id;
end $$;
revoke execute on function public.guardar_cuenta(uuid, uuid, text, text, text, boolean, boolean) from anon, public;
grant execute on function public.guardar_cuenta(uuid, uuid, text, text, text, boolean, boolean) to authenticated;

-- ---------- RE-CREATE aplicar_anticipo (VERBATIM 0018 + 2 cambios) ----------
-- Cambios contra 0018: (1) returns void -> uuid (el hook de tiempo real necesita
-- el pago_id como referencia); (2) el insert del pago setea anticipo_id = v_ant.id
-- (marca la reclasificacion). El resto es IDENTICO al 0018 vigente (con el split
-- dc1526b). El return type cambia, asi que se DROPEA antes de recrear.
drop function if exists public.aplicar_anticipo(uuid, uuid);
create or replace function public.aplicar_anticipo(p_empresa uuid, p_documento uuid)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_cliente uuid;
  v_ant record;
  v_saldo integer;
  v_aplicado integer;
  v_pago uuid;
begin
  select cliente_id into v_cliente
  from documentos_venta
  where id = p_documento and empresa_id = p_empresa
    and estado = 'emitido' and tipo in ('factura', 'boleta')
  for update;
  if not found then
    return null;
  end if;

  select a.* into v_ant
  from anticipos a
  where a.empresa_id = p_empresa and a.estado = 'recibido'
    and (
      (a.origen_tipo = 'proforma' and a.origen_id in (
        select id from proformas where empresa_id = p_empresa and documento_venta_id = p_documento))
      or (a.origen_tipo = 'cotizacion' and a.origen_id in (
        select id from cotizaciones where empresa_id = p_empresa and documento_venta_id = p_documento))
    )
  order by a.recibido_en
  limit 1
  for update;
  if not found then
    return null;
  end if;

  select (d.total
    - coalesce((select sum(a.monto) from pagos_aplicaciones a
                join pagos pg on pg.id = a.pago_id and pg.empresa_id = a.empresa_id
                where a.documento_id = d.id and a.empresa_id = p_empresa and pg.estado = 'activo'), 0)
    - coalesce((select sum(nc.total) from documentos_venta nc
                where nc.documento_referencia_id = d.id and nc.empresa_id = p_empresa
                  and nc.tipo = 'nota_credito' and nc.estado = 'emitido'), 0)
  ) into v_saldo
  from documentos_venta d
  where d.id = p_documento and d.empresa_id = p_empresa;

  v_aplicado := least(v_ant.monto, v_saldo);
  if v_aplicado <= 0 then
    return null;
  end if;

  insert into pagos (empresa_id, cliente_id, metodo, monto, mp_payment_id, anticipo_id)
  values (p_empresa, v_cliente, 'mercadopago', v_aplicado, v_ant.mp_payment_id, v_ant.id)
  returning id into v_pago;
  insert into pagos_aplicaciones (empresa_id, pago_id, documento_id, monto)
  values (p_empresa, v_pago, p_documento, v_aplicado);

  update anticipos set estado = 'aplicado', pago_id = v_pago, documento_venta_id = p_documento
  where id = v_ant.id and empresa_id = p_empresa;

  if v_aplicado < v_ant.monto then
    insert into anticipos (empresa_id, cliente_id, origen_tipo, origen_id, monto, mp_payment_id)
    values (p_empresa, v_cliente, 'excedente', p_documento, v_ant.monto - v_aplicado, null);
  end if;

  return v_pago;
end $$;
revoke execute on function public.aplicar_anticipo(uuid, uuid) from anon, public;
grant execute on function public.aplicar_anticipo(uuid, uuid) to service_role;

-- ---------- RE-CREATE aplicar_anticipo_manual (VERBATIM 0018 + 2 cambios) ----------
-- Mismos DOS cambios: returns void -> uuid y anticipo_id = v_ant.id en el insert
-- del pago. Idem, se DROPEA por el cambio de return type.
drop function if exists public.aplicar_anticipo_manual(uuid, uuid, uuid);
create or replace function public.aplicar_anticipo_manual(
  p_empresa uuid, p_anticipo uuid, p_documento uuid
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_doc record;
  v_ant record;
  v_saldo integer;
  v_aplicado integer;
  v_pago uuid;
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'vendedor']) then
    raise exception 'Tu rol no permite aplicar anticipos';
  end if;

  select cliente_id, total into v_doc
  from documentos_venta
  where id = p_documento and empresa_id = p_empresa
    and estado = 'emitido' and tipo in ('factura', 'boleta')
  for update;
  if not found then
    raise exception 'El documento no permite aplicar el anticipo';
  end if;

  select * into v_ant
  from anticipos
  where id = p_anticipo and empresa_id = p_empresa and estado = 'recibido'
  for update;
  if not found then
    raise exception 'El anticipo no existe o ya fue aplicado';
  end if;
  if v_ant.cliente_id <> v_doc.cliente_id then
    raise exception 'El documento no permite aplicar el anticipo';
  end if;

  select (d.total
    - coalesce((select sum(a.monto) from pagos_aplicaciones a
                join pagos pg on pg.id = a.pago_id and pg.empresa_id = a.empresa_id
                where a.documento_id = d.id and a.empresa_id = p_empresa and pg.estado = 'activo'), 0)
    - coalesce((select sum(nc.total) from documentos_venta nc
                where nc.documento_referencia_id = d.id and nc.empresa_id = p_empresa
                  and nc.tipo = 'nota_credito' and nc.estado = 'emitido'), 0)
  ) into v_saldo
  from documentos_venta d
  where d.id = p_documento and d.empresa_id = p_empresa;
  if v_saldo <= 0 then
    raise exception 'El documento no permite aplicar el anticipo';
  end if;

  v_aplicado := least(v_ant.monto, v_saldo);

  insert into pagos (empresa_id, cliente_id, metodo, monto, mp_payment_id, anticipo_id)
  values (p_empresa, v_doc.cliente_id, 'mercadopago', v_aplicado, v_ant.mp_payment_id, v_ant.id)
  returning id into v_pago;
  insert into pagos_aplicaciones (empresa_id, pago_id, documento_id, monto)
  values (p_empresa, v_pago, p_documento, v_aplicado);

  update anticipos set estado = 'aplicado', pago_id = v_pago, documento_venta_id = p_documento
  where id = v_ant.id and empresa_id = p_empresa;

  if v_aplicado < v_ant.monto then
    insert into anticipos (empresa_id, cliente_id, origen_tipo, origen_id, monto, mp_payment_id)
    values (p_empresa, v_doc.cliente_id, 'excedente', p_documento, v_ant.monto - v_aplicado, null);
  end if;

  return v_pago;
end $$;
revoke execute on function public.aplicar_anticipo_manual(uuid, uuid, uuid) from anon, public;
grant execute on function public.aplicar_anticipo_manual(uuid, uuid, uuid) to authenticated;
```

- [ ] **Step 2: Aplicar y verificar**

Run: `pnpm supabase db reset` → aplica 0001-0022 completo (schema + helper + 7 RPCs + catálogo + 2 re-creates) sin errores.

Run: `pnpm supabase test db` → **15 archivos, 279 asserts** siguen verdes. Los re-creates son aditivos sobre 0018 (la data existente sigue validando); `contabilidad.test.sql` (los 36 asserts nuevos → 315) lo escribe una task posterior.

Smokes de flujo (todos verificados en vivo en transacción con `rollback`; usan la empresa demo tras el reset — ajustar el `empresa_id` al de la BD):

Activar → catálogo sembrado (27 cuentas, 10 claves, 5 grupos) e idempotente (reactivar no duplica):

```
docker exec supabase_db_ERP_Transportes psql -U postgres -d postgres -c "select count(*) cuentas, count(*) filter (where clave_sistema is not null) claves, count(*) filter (where not acepta_movimientos) grupos from public.cuentas_contables where empresa_id = (select id from public.empresas order by creado_en limit 1);"
```

→ `cuentas = 27`, `claves = 10`, `grupos = 5` (tras `select public.activar_contabilidad(...)` como el dueño; una segunda llamada deja el conteo intacto). Las 10 claves: `anticipos_clientes, banco, caja, clientes, compras_gastos, iva_credito, iva_debito, proveedores, ventas, ventas_exentas`.

`crear_asiento` — cuadratura viva:
- Feliz (2 líneas Caja/Banco, `Σdebe = Σhaber`) → devuelve el uuid del asiento.
- Descuadrado → `'El asiento no cuadra: debe y haber difieren'`.
- 1 línea → `'Un asiento necesita al menos dos líneas'`.
- Cuenta grupo (no-hoja) → `'Cuenta contable no válida'`.

`contabilizar_documento` (service_role) — golden por regla (todas cuadran `Σdebe = Σhaber`):
- Venta afecta (neto 100000, iva 19000, total 119000) → `'creado'`; líneas: Debe Clientes 119000 / Haber Ventas 100000 + IVA débito 19000.
- Venta con exento (neto 100000, exento 50000, iva 19000) → Haber Ventas 100000 + Ventas exentas 50000 + IVA débito 19000.
- Boleta total 0 → `'noop'` (0 líneas, sin asiento).
- Segunda llamada sobre el mismo documento → `'noop'` (idempotencia bajo el candado).
- Compra / pago sin `anticipo_id` (Banco) / pago con `anticipo_id` (Anticipos de clientes) / pago_proveedor / anticipo `mp_payment_id` → `'creado'`; anticipo-excedente `mp_payment_id` null → `'noop'`.

`contabilizar_pendientes` (dueño) desde cero → `{"creados": N}` (crea lo contabilizable en orden de fecha; una boleta total 0 NO cuenta); una segunda llamada → `{"creados": 0}` (idempotente). Verificar cuadratura global:

```
docker exec supabase_db_ERP_Transportes psql -U postgres -d postgres -c "select sum(debe) debe, sum(haber) haber, sum(debe) = sum(haber) cuadra from public.asientos_lineas where empresa_id = (select id from public.empresas order by creado_en limit 1);"
```

→ `debe = haber` y `cuadra = t` (Σdebe = Σhaber global; e igual por cada asiento).

`revertir_asiento` (dueño/contador) → crea el inverso ligado (origen `'reversa'`, `reversa_de` seteado); una segunda reversa del mismo asiento → `'El asiento ya fue revertido'`. Un vendedor: `crear_asiento` → `'Tu rol no permite crear asientos'` y `select count(*) from asientos` = 0 (RLS select por rol).

Byte-scan del archivo (JAMÁS BOM U+FEFF):

```
grep -c $'\xEF\xBB\xBF' supabase/migrations/00000000000022_contabilidad.sql
```

→ imprime `0` y sale con status 1 (sin coincidencias = pass).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/00000000000022_contabilidad.sql
git commit -m "feat(db): contabilidad — partida doble, mapeos automáticos y catálogo chileno"
```

---

### Task 3: pgTAP de contabilidad

**Files:**
- Create: `supabase/tests/database/contabilidad.test.sql`

**Interfaces:**
- Consumes: migración 0022 (schema: `empresas.modulo_contabilidad` sin grant de columna; `cuentas_contables` / `asientos` / `asientos_lineas` con RLS por ROL y CERO escritura directa; `pagos.anticipo_id`; CHECK `documentos_venta` total = neto+exento+iva; helper `app._insertar_asiento`; RPCs `activar_contabilidad`, `desactivar_contabilidad`, `contabilizar_pendientes`, `crear_asiento`, `revertir_asiento`, `contabilizar_documento`, `guardar_cuenta`; re-creates de `aplicar_anticipo_manual` que setean `anticipo_id` y retornan el `pago_id`). Del schema previo: `documentos_venta` (0004), `documentos_compra` (0013), `pagos` (0010), `anticipos` (0018), `clientes`/`proveedores` (0002/0003) — sembrados por insert directo como en cobranza/mercadopago.test.sql.
- **jsonb de líneas de `crear_asiento`** (contrato que esta task fija para las Tasks de RPC — patrón camelCase de `registrar_pago`): array de objetos `{"cuentaId": uuid, "debe": int, "haber": int}`, construido con `jsonb_build_array(jsonb_build_object(...))` para referir las cuentas sembradas por su `clave_sistema` sin acoplarse a ids aleatorios.
- **RUTs NUEVOS reservados para este archivo** (válidos módulo 11; únicos GLOBALES — verificado con grep contra TODOS los tests, el seed y los E2E: cero coincidencias): `769010007` (Org/Empresa A), `769020002` (Org/Empresa B), `769031006` (Cliente A1), `769040005` (Proveedor A). NO reutiliza los de mercadopago (`7691.../7692.../7693.../7694.../7695...`) ni ningún otro.
- **Orden de validación que el test IMPONE como contrato** (la Task de RPC debe cumplirlo o el test cae rojo): en `crear_asiento` el ROL se chequea PRIMERO (antes de mirar módulo/cuentas — patrón `cambiar_estado_proforma` "Rol ANTES del lookup"), luego módulo activo, luego líneas. Así el test del vendedor (líneas con ids ficticios) falla por rol y no por cuenta, y el de módulo inactivo (Beto es dueño de B, pasa el rol) falla por módulo.
- **Fixtures cuadran a mano** (todos respetan el nuevo CHECK `total = neto+exento+iva`): venta con exento 139000 (100000+20000+19000), venta sin exento 119000 (100000+0+19000), NC 59500 (50000+0+9500), compra 105200 (80000+10000+15200), factura del anticipo 40000, documento total 0, pago sin anticipo 50000, anticipo nuevo 60000, anticipo a aplicar 40000, excedente 20000.
- **Presupuesto EXACTO de `plan(36)`** — mapeo del spec §8 contado A MANO. Cinco caminos felices son SETUP sin assert propio (si fallaran, la transacción aborta y el archivo cae rojo): `activar_contabilidad` (probado por el assert 1), las dos `guardar_cuenta` propias (probadas por el duplicado, assert 4), `aplicar_anticipo_manual` feliz (probado por el golden del pago-con-anticipo, assert 24) y `revertir_asiento` feliz (probado por el golden espejo, assert 15). El resto es 1 assert por comportamiento:
  1. `activar_contabilidad` idempotente: llamada dos veces deja las 10 claves de sistema (no 20) y el flag `modulo_contabilidad` encendido
  2. flip crudo de `modulo_contabilidad` (update directo) → `42501 permission denied for table empresas` (sin grant de columna)
  3. `guardar_cuenta` sobre una cuenta de sistema (cambia tipo/activa) → `'Las cuentas del sistema no se pueden modificar así'`
  4. `guardar_cuenta` código duplicado → `'Ya existe una cuenta con ese código'`
  5. `crear_asiento` con el módulo inactivo (empresa B) → `'La contabilidad no está activada'`
  6. `crear_asiento` feliz del CONTADOR, multi-línea y balanceado: los dos primeros asientos de A llevan numero 1 y 2 (correlativo consecutivo)
  7. `crear_asiento` descuadrado (Σdebe ≠ Σhaber) → `'El asiento no cuadra: debe y haber difieren'`
  8. `crear_asiento` con una sola línea → `'Un asiento necesita al menos dos líneas'`
  9. `crear_asiento` con una cuenta AJENA (de empresa B) → `'Cuenta contable no válida'`
  10. `crear_asiento` con una cuenta INACTIVA (propia, activa=false) → `'Cuenta contable no válida'`
  11. `crear_asiento` con una cuenta NO-HOJA (acepta_movimientos=false) → `'Cuenta contable no válida'`
  12. `crear_asiento` con una línea que lleva debe Y haber a la vez → `'Cada línea lleva debe o haber, mayor que cero'`
  13. `crear_asiento` como VENDEDOR → `'Tu rol no permite crear asientos'`
  14. `revertir_asiento` sobre un id inexistente → `'El asiento no existe'`
  15. `revertir_asiento` feliz: la reversa lleva las líneas ESPEJO (debe↔haber) del original
  16. `revertir_asiento` doble (revertir un asiento ya revertido) → `'El asiento ya fue revertido'`
  17. `revertir_asiento` de una reversa (las reversas no se revierten) → `'El asiento ya fue revertido'`
  18. `contabilizar_documento` como authenticated → `42501 permission denied for function contabilizar_documento` (solo service_role; el grant ES el candado)
  19. GOLDEN venta con exento: líneas exactas — Clientes(debe total) · IVA débito(haber) · Ventas(haber neto) · Ventas exentas(haber exento)
  20. GOLDEN venta SIN exento: Clientes(debe) · IVA débito(haber) · Ventas(haber) — la línea exenta con monto 0 se OMITE
  21. GOLDEN nota de crédito: inversa — Clientes(haber total) · IVA débito(debe) · Ventas(debe neto)
  22. GOLDEN compra: Compras/Gastos(debe neto+exento) · IVA crédito(debe) · Proveedores(haber total)
  23. GOLDEN pago SIN `anticipo_id` → Banco(debe) · Clientes(haber) — plata nueva
  24. GOLDEN pago CON `anticipo_id` → Anticipos de clientes(debe) · Clientes(haber) — reclasificación; el pago nace de `aplicar_anticipo_manual` (re-create real)
  25. GOLDEN anticipo con `mp_payment_id` → Banco(debe) · Anticipos de clientes(haber)
  26. anticipo-excedente de aplicación (`mp_payment_id` NULL) → `'noop'` y NINGÚN asiento (no se duplica el pasivo)
  27. documento total 0 (0 líneas) → `'noop'` y NINGÚN asiento
  28. idempotencia: re-contabilizar la venta con exento → `'noop'` y sigue habiendo UN solo asiento
  29. reversa-de-automático: revertido el asiento de un pago, `contabilizar_pendientes` NO lo re-crea (el unique lo hace imposible)
  30. candado: insert directo en `asientos` → `42501 permission denied for table asientos`
  31. candado: insert directo en `asientos_lineas` → `42501 permission denied for table asientos_lineas`
  32. candado: update directo en `cuentas_contables` → `42501 permission denied for table cuentas_contables`
  33. RLS positivo: el CONTADOR ve asientos y líneas (count > 0 en ambas tablas)
  34. RLS por rol: el VENDEDOR ve 0 filas en asientos + líneas + cuentas (primera tabla del repo con select por ROL)
  35. RLS cross-tenant: el dueño de otra empresa (B) ve 0 asientos
  36. anónimo denegado de plano sobre `asientos` → `42501 permission denied for table asientos`

- [ ] **Step 1: Escribir el test**

`supabase/tests/database/contabilidad.test.sql`:

```sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(36);

insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'ana@a.cl'),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'beto@b.cl'),
  ('00000000-0000-0000-0000-000000000000', '55555555-5555-5555-5555-555555555555', 'authenticated', 'authenticated', 'ces@a.cl'),
  ('00000000-0000-0000-0000-000000000000', '77777777-7777-7777-7777-777777777777', 'authenticated', 'authenticated', 'vero@a.cl');

-- RUT nuevos, únicos GLOBALES (módulo 11): no colisionan con ningún test, el seed
-- ni los E2E (grep = 0 coincidencias). A activa contabilidad por RPC; B queda sin ella
-- (gating cross-tenant + cuenta ajena).
insert into public.organizaciones (id, rut, razon_social)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '769010007', 'Org A'),
       ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '769020002', 'Org B');

-- modulo_contabilidad NO se setea aquí (sin grant, default false): A lo enciende vía
-- activar_contabilidad (camino real); B nunca lo enciende.
insert into public.empresas (id, organizacion_id, rut, razon_social)
values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '769010007', 'Contable A'),
       ('eeeeeeee-0000-0000-0000-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '769020002', 'Empresa B');

-- Ana dueña de A, Beto dueño de B, Ces CONTADOR de A, Vero VENDEDORA de A.
insert into public.miembros (usuario_id, organizacion_id, rol)
values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'dueno'),
       ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'dueno'),
       ('55555555-5555-5555-5555-555555555555', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'contador'),
       ('77777777-7777-7777-7777-777777777777', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'vendedor');

insert into public.clientes (id, empresa_id, rut, razon_social)
values ('cccccccc-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '769031006', 'Cliente A1');
insert into public.proveedores (id, empresa_id, rut, razon_social)
values ('dddd0000-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '769040005', 'Proveedor A');

-- ===== Documentos por insert DIRECTO (superuser salta grants/RLS, patrón cobranza) =====
-- Todos respetan el CHECK total = neto+exento+iva (0022). Cada golden lee del documento real.
insert into public.documentos_venta (id, empresa_id, tipo, cliente_id, folio, estado, neto, exento, iva, total, emitido_en)
values
  -- e1: venta con exento (golden 19)          -- e2: venta sin exento (golden 20)
  ('dddddddd-0000-0000-0000-0000000000e1', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'factura', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 1001, 'emitido', 100000, 20000, 19000, 139000, now()),
  ('dddddddd-0000-0000-0000-0000000000e2', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'factura', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 1002, 'emitido', 100000, 0, 19000, 119000, now()),
  -- e3: nota de crédito (golden 21)            -- e4: total 0 (golden 27 noop)
  ('dddddddd-0000-0000-0000-0000000000e3', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'nota_credito', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 1003, 'emitido', 50000, 0, 9500, 59500, now()),
  ('dddddddd-0000-0000-0000-0000000000e4', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'factura', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 1004, 'emitido', 0, 0, 0, 0, now()),
  -- e5: factura que recibe el anticipo aplicado (golden 24: genera el pago con anticipo_id)
  ('dddddddd-0000-0000-0000-0000000000e5', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'factura', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 1005, 'emitido', 40000, 0, 0, 40000, now());

-- Compra activa (golden 22): fecha contable = fecha_emision.
insert into public.documentos_compra (id, empresa_id, proveedor_id, tipo, folio, fecha_emision, neto, exento, iva, total, estado)
values ('dc000000-0000-0000-0000-0000000000c1', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'dddd0000-0000-0000-0000-aaaaaaaaaaaa', 'factura', 1, date '2026-07-05', 80000, 10000, 15200, 105200, 'activa');

-- Pago SIN anticipo_id (golden 23: Banco/Clientes; reversado + no re-creado en 29).
insert into public.pagos (id, empresa_id, cliente_id, monto, metodo, estado)
values ('fafa0000-0000-0000-0000-0000000000f1', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 50000, 'transferencia', 'activo');

-- Anticipos: e6 nuevo con mp_payment_id (golden 25); e7 se aplicará (golden 24);
-- e8 excedente-de-aplicación con mp_payment_id NULL (golden 26 noop). origen_id polimórfico sin FK.
insert into public.anticipos (id, empresa_id, cliente_id, origen_tipo, origen_id, monto, mp_payment_id, estado)
values
  ('a0a00000-0000-0000-0000-0000000000e6', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 'proforma', 'a0a0a0a0-0000-0000-0000-0000000000d1', 60000, 'mp-ant-new', 'recibido'),
  ('a0a00000-0000-0000-0000-0000000000e7', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 'proforma', 'a0a0a0a0-0000-0000-0000-0000000000d2', 40000, 'mp-ant-apl', 'recibido'),
  ('a0a00000-0000-0000-0000-0000000000e8', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 'excedente', 'dddddddd-0000-0000-0000-0000000000e5', 20000, null, 'recibido');

-- Cuenta AJENA: una cuenta de la empresa B (insert directo; B nunca activó, no tiene catálogo).
-- Referida por el test 9 (crear_asiento con cuenta de otra empresa).
insert into public.cuentas_contables (id, empresa_id, codigo, nombre, tipo, acepta_movimientos, activa)
values ('caca0000-0000-0000-0000-0000000000b1', 'eeeeeeee-0000-0000-0000-bbbbbbbbbbbb', '1.1.01', 'Banco B', 'activo', true, true);

-- ===== Activación (Ana, dueña A) =====
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- Dos llamadas: la segunda no debe re-sembrar el catálogo (idempotente).
select activar_contabilidad('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa');
select activar_contabilidad('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa');

-- 1) Idempotente: 10 claves de sistema (no 20) y el flag encendido.
select is(
  (select count(*) from cuentas_contables
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema is not null)::text
  || '/' ||
  (select modulo_contabilidad from empresas where id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa')::text,
  '10/true',
  'activar es idempotente: las 10 claves de sistema y el flag encendido'
);

-- 2) Flip crudo del flag bloqueado: modulo_contabilidad quedó FUERA del grant por columnas.
select throws_ok(
  $$update empresas set modulo_contabilidad = false where id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'$$,
  '42501', 'permission denied for table empresas',
  'ni la dueña puede apagar el módulo por escritura directa (solo por RPC)'
);

-- ===== guardar_cuenta (Ana) =====
-- SETUP (felices sin assert): una cuenta propia ACTIVA (blanco del duplicado) y una INACTIVA
-- (blanco del test de cuenta inactiva). Si fallaran, el archivo aborta.
select guardar_cuenta('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', null, '5.99.01', 'Fletes especiales', 'gasto', true, true);
select guardar_cuenta('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', null, '5.99.02', 'Gasto inactivo', 'gasto', true, false);

-- 3) Cuenta de sistema protegida: intentar cambiarle tipo y activa lanza (código nuevo, sin colisión).
select throws_ok(
  $$select guardar_cuenta('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema = 'banco'),
    '9.9.97', 'Banco', 'pasivo', true, false)$$,
  'P0001', 'Las cuentas del sistema no se pueden modificar así',
  'una cuenta de sistema no admite cambio de tipo/activa'
);

-- 4) Código duplicado: '5.99.01' ya existe (creada arriba).
select throws_ok(
  $$select guardar_cuenta('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', null, '5.99.01', 'Otra cuenta', 'gasto', true, true)$$,
  'P0001', 'Ya existe una cuenta con ese código',
  'no se crean dos cuentas con el mismo código'
);

-- ===== crear_asiento =====

-- 5) Módulo inactivo: Beto (dueño de B, pasa el rol) crea sobre B → falla por módulo.
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
select throws_ok(
  $$select crear_asiento('eeeeeeee-0000-0000-0000-bbbbbbbbbbbb', current_date, 'Prueba', jsonb_build_array(
    jsonb_build_object('cuentaId', gen_random_uuid(), 'debe', 100, 'haber', 0),
    jsonb_build_object('cuentaId', gen_random_uuid(), 'debe', 0, 'haber', 100)))$$,
  'P0001', 'La contabilidad no está activada',
  'sin el módulo activo no se crean asientos'
);

-- El CONTADOR (Ces) crea los DOS primeros asientos de A: multi-línea, balanceados.
set local request.jwt.claims to '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated"}';
select crear_asiento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', current_date, 'Asiento manual uno', jsonb_build_array(
  jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema = 'banco'), 'debe', 30000, 'haber', 0),
  jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema = 'ventas'), 'debe', 0, 'haber', 30000)));
select crear_asiento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', current_date, 'Asiento manual dos', jsonb_build_array(
  jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema = 'banco'), 'debe', 20000, 'haber', 0),
  jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema = 'ventas'), 'debe', 0, 'haber', 20000)));

-- 6) Contador feliz + correlativo consecutivo: los dos asientos llevan numero 1 y 2.
select is(
  (select numero from asientos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and glosa = 'Asiento manual uno')::text
  || '/' ||
  (select numero from asientos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and glosa = 'Asiento manual dos')::text,
  '1/2',
  'el contador crea asientos y el correlativo es consecutivo (1 y 2)'
);

-- Negativos como Ana (dueña, con permiso: así el error es el de validación, no el de rol).
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- 7) Descuadrado (100 debe vs 200 haber).
select throws_ok(
  $$select crear_asiento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', current_date, 'Descuadrado', jsonb_build_array(
    jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema = 'banco'), 'debe', 100, 'haber', 0),
    jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema = 'ventas'), 'debe', 0, 'haber', 200)))$$,
  'P0001', 'El asiento no cuadra: debe y haber difieren',
  'un asiento con debe distinto de haber no entra'
);

-- 8) Una sola línea.
select throws_ok(
  $$select crear_asiento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', current_date, 'Una línea', jsonb_build_array(
    jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema = 'banco'), 'debe', 100, 'haber', 0)))$$,
  'P0001', 'Un asiento necesita al menos dos líneas',
  'un asiento de una sola línea no entra'
);

-- 9) Cuenta AJENA (de la empresa B).
select throws_ok(
  $$select crear_asiento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', current_date, 'Ajena', jsonb_build_array(
    jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema = 'banco'), 'debe', 100, 'haber', 0),
    jsonb_build_object('cuentaId', 'caca0000-0000-0000-0000-0000000000b1', 'debe', 0, 'haber', 100)))$$,
  'P0001', 'Cuenta contable no válida',
  'una cuenta de otra empresa no es válida'
);

-- 10) Cuenta INACTIVA (la 5.99.02 creada con activa=false).
select throws_ok(
  $$select crear_asiento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', current_date, 'Inactiva', jsonb_build_array(
    jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema = 'banco'), 'debe', 100, 'haber', 0),
    jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and codigo = '5.99.02'), 'debe', 0, 'haber', 100)))$$,
  'P0001', 'Cuenta contable no válida',
  'una cuenta inactiva no recibe líneas'
);

-- 11) Cuenta NO-HOJA (acepta_movimientos = false).
select throws_ok(
  $$select crear_asiento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', current_date, 'No hoja', jsonb_build_array(
    jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and acepta_movimientos = false limit 1), 'debe', 100, 'haber', 0),
    jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema = 'ventas'), 'debe', 0, 'haber', 100)))$$,
  'P0001', 'Cuenta contable no válida',
  'una cuenta que no acepta movimientos no recibe líneas'
);

-- 12) Una línea con debe Y haber positivos a la vez.
select throws_ok(
  $$select crear_asiento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', current_date, 'Doble monto', jsonb_build_array(
    jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema = 'banco'), 'debe', 100, 'haber', 0),
    jsonb_build_object('cuentaId', (select id from cuentas_contables where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and clave_sistema = 'ventas'), 'debe', 100, 'haber', 100)))$$,
  'P0001', 'Cada línea lleva debe o haber, mayor que cero',
  'una línea no puede llevar debe y haber juntos'
);

-- 13) Vendedor (Vero): el rol se chequea PRIMERO, así que ids ficticios igual dan el mensaje de rol.
set local request.jwt.claims to '{"sub": "77777777-7777-7777-7777-777777777777", "role": "authenticated"}';
select throws_ok(
  $$select crear_asiento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', current_date, 'Vendedor', jsonb_build_array(
    jsonb_build_object('cuentaId', gen_random_uuid(), 'debe', 100, 'haber', 0),
    jsonb_build_object('cuentaId', gen_random_uuid(), 'debe', 0, 'haber', 100)))$$,
  'P0001', 'Tu rol no permite crear asientos',
  'el vendedor no crea asientos'
);

-- ===== revertir_asiento (Ana) =====
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- 14) Asiento inexistente.
select throws_ok(
  $$select revertir_asiento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', gen_random_uuid(), 'Reversa')$$,
  'P0001', 'El asiento no existe',
  'no se revierte un asiento que no existe'
);

-- SETUP feliz (sin assert): revertir el "Asiento manual uno" (Banco 30000 / Ventas 30000).
select revertir_asiento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from asientos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and glosa = 'Asiento manual uno'),
  'Reversa de prueba');

-- 15) La reversa lleva las líneas ESPEJO: Banco al haber, Ventas al debe (order by clave).
select is(
  (select string_agg(c.clave_sistema || ':' || l.debe || ':' || l.haber, '|' order by c.clave_sistema)
   from asientos_lineas l
   join cuentas_contables c on c.empresa_id = l.empresa_id and c.id = l.cuenta_id
   where l.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and l.asiento_id = (select id from asientos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
                         and reversa_de = (select id from asientos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and glosa = 'Asiento manual uno'))),
  'banco:0:30000|ventas:30000:0',
  'la reversa invierte debe y haber del asiento original'
);

-- 16) Doble reversa: el "Asiento manual uno" ya fue revertido.
select throws_ok(
  $$select revertir_asiento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from asientos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and glosa = 'Asiento manual uno'),
    'Otra reversa')$$,
  'P0001', 'El asiento ya fue revertido',
  'un asiento se revierte a lo más una vez'
);

-- 17) Revertir una reversa: las reversas no se revierten (mismo mensaje).
select throws_ok(
  $$select revertir_asiento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from asientos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and reversa_de = (select id from asientos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and glosa = 'Asiento manual uno')),
    'Reversa de reversa')$$,
  'P0001', 'El asiento ya fue revertido',
  'una reversa no se revierte'
);

-- 18) contabilizar_documento es SOLO service_role: authenticated → 42501 (el grant ES el candado).
select throws_ok(
  $$select contabilizar_documento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'venta', 'dddddddd-0000-0000-0000-0000000000e1')$$,
  '42501', 'permission denied for function contabilizar_documento',
  'authenticated no ejecuta contabilizar_documento (solo el hook service_role)'
);

-- SETUP (feliz sin assert): aplicar el anticipo e7 a la factura e5 → nace un pago con anticipo_id
-- (re-create real de aplicar_anticipo_manual). Probado por el golden 24.
select aplicar_anticipo_manual('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  'a0a00000-0000-0000-0000-0000000000e7', 'dddddddd-0000-0000-0000-0000000000e5');

-- ===== contabilizar_documento (service_role, el hook): goldens por regla + noops =====
-- service_role salta RLS y lee asientos/líneas/cuentas para verificar cada golden.
set local role service_role;

-- SETUP: contabiliza cada documento (creado). Un fallo aborta el archivo.
select contabilizar_documento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'venta', 'dddddddd-0000-0000-0000-0000000000e1');
select contabilizar_documento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'venta', 'dddddddd-0000-0000-0000-0000000000e2');
select contabilizar_documento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'nota_credito', 'dddddddd-0000-0000-0000-0000000000e3');
select contabilizar_documento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'compra', 'dc000000-0000-0000-0000-0000000000c1');
select contabilizar_documento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'pago', 'fafa0000-0000-0000-0000-0000000000f1');
select contabilizar_documento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'pago',
  (select id from pagos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and anticipo_id = 'a0a00000-0000-0000-0000-0000000000e7'));
select contabilizar_documento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'anticipo', 'a0a00000-0000-0000-0000-0000000000e6');

-- 19) GOLDEN venta con exento: Clientes(debe 139000) · IVA débito(haber 19000) · Ventas(haber 100000) · Ventas exentas(haber 20000).
select is(
  (select string_agg(c.clave_sistema || ':' || l.debe || ':' || l.haber, '|' order by c.clave_sistema)
   from asientos_lineas l join cuentas_contables c on c.empresa_id = l.empresa_id and c.id = l.cuenta_id
   where l.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and l.asiento_id = (select id from asientos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and origen = 'venta' and referencia_id = 'dddddddd-0000-0000-0000-0000000000e1')),
  'clientes:139000:0|iva_debito:0:19000|ventas:0:100000|ventas_exentas:0:20000',
  'venta con exento: Clientes al debe por el total; Ventas, Ventas exentas e IVA débito al haber'
);

-- 20) GOLDEN venta SIN exento: la línea de Ventas exentas (monto 0) se OMITE.
select is(
  (select string_agg(c.clave_sistema || ':' || l.debe || ':' || l.haber, '|' order by c.clave_sistema)
   from asientos_lineas l join cuentas_contables c on c.empresa_id = l.empresa_id and c.id = l.cuenta_id
   where l.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and l.asiento_id = (select id from asientos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and origen = 'venta' and referencia_id = 'dddddddd-0000-0000-0000-0000000000e2')),
  'clientes:119000:0|iva_debito:0:19000|ventas:0:100000',
  'venta sin exento: tres líneas, sin la de ventas exentas (monto 0 omitido)'
);

-- 21) GOLDEN nota de crédito: inversa de la venta.
select is(
  (select string_agg(c.clave_sistema || ':' || l.debe || ':' || l.haber, '|' order by c.clave_sistema)
   from asientos_lineas l join cuentas_contables c on c.empresa_id = l.empresa_id and c.id = l.cuenta_id
   where l.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and l.asiento_id = (select id from asientos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and origen = 'nota_credito' and referencia_id = 'dddddddd-0000-0000-0000-0000000000e3')),
  'clientes:0:59500|iva_debito:9500:0|ventas:50000:0',
  'nota de crédito: Ventas e IVA débito al debe; Clientes al haber por el total'
);

-- 22) GOLDEN compra: Compras/Gastos(debe neto+exento) · IVA crédito(debe) · Proveedores(haber total).
select is(
  (select string_agg(c.clave_sistema || ':' || l.debe || ':' || l.haber, '|' order by c.clave_sistema)
   from asientos_lineas l join cuentas_contables c on c.empresa_id = l.empresa_id and c.id = l.cuenta_id
   where l.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and l.asiento_id = (select id from asientos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and origen = 'compra' and referencia_id = 'dc000000-0000-0000-0000-0000000000c1')),
  'compras_gastos:90000:0|iva_credito:15200:0|proveedores:0:105200',
  'compra: Compras/Gastos (neto+exento) e IVA crédito al debe; Proveedores al haber'
);

-- 23) GOLDEN pago SIN anticipo_id → Banco(debe) · Clientes(haber): plata nueva.
select is(
  (select string_agg(c.clave_sistema || ':' || l.debe || ':' || l.haber, '|' order by c.clave_sistema)
   from asientos_lineas l join cuentas_contables c on c.empresa_id = l.empresa_id and c.id = l.cuenta_id
   where l.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and l.asiento_id = (select id from asientos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and origen = 'pago' and referencia_id = 'fafa0000-0000-0000-0000-0000000000f1')),
  'banco:50000:0|clientes:0:50000',
  'pago sin anticipo_id: Banco al debe (plata nueva), Clientes al haber'
);

-- 24) GOLDEN pago CON anticipo_id → Anticipos de clientes(debe) · Clientes(haber): reclasificación.
select is(
  (select string_agg(c.clave_sistema || ':' || l.debe || ':' || l.haber, '|' order by c.clave_sistema)
   from asientos_lineas l join cuentas_contables c on c.empresa_id = l.empresa_id and c.id = l.cuenta_id
   where l.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and l.asiento_id = (select id from asientos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and origen = 'pago'
                         and referencia_id = (select id from pagos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and anticipo_id = 'a0a00000-0000-0000-0000-0000000000e7'))),
  'anticipos_clientes:40000:0|clientes:0:40000',
  'pago con anticipo_id: Anticipos de clientes al debe (reclasificación), Clientes al haber'
);

-- 25) GOLDEN anticipo con mp_payment_id → Banco(debe) · Anticipos de clientes(haber).
select is(
  (select string_agg(c.clave_sistema || ':' || l.debe || ':' || l.haber, '|' order by c.clave_sistema)
   from asientos_lineas l join cuentas_contables c on c.empresa_id = l.empresa_id and c.id = l.cuenta_id
   where l.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and l.asiento_id = (select id from asientos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and origen = 'anticipo' and referencia_id = 'a0a00000-0000-0000-0000-0000000000e6')),
  'anticipos_clientes:0:60000|banco:60000:0',
  'anticipo con mp_payment_id: Banco al debe, Anticipos de clientes al haber'
);

-- 26) Anticipo-excedente de aplicación (mp_payment_id NULL) → noop, sin asiento (no duplica el pasivo).
select is(
  contabilizar_documento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'anticipo', 'a0a00000-0000-0000-0000-0000000000e8')
  || '/' ||
  (select count(*) from asientos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and origen = 'anticipo' and referencia_id = 'a0a00000-0000-0000-0000-0000000000e8')::text,
  'noop/0',
  'el excedente de aplicación (mp_payment_id null) no genera asiento'
);

-- 27) Documento total 0 → noop, sin asiento (0 líneas).
select is(
  contabilizar_documento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'venta', 'dddddddd-0000-0000-0000-0000000000e4')
  || '/' ||
  (select count(*) from asientos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and origen = 'venta' and referencia_id = 'dddddddd-0000-0000-0000-0000000000e4')::text,
  'noop/0',
  'un documento en 0 no genera asiento ni queda pendiente'
);

-- 28) Idempotencia: re-contabilizar la venta con exento → noop y sigue habiendo UN asiento.
select is(
  contabilizar_documento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'venta', 'dddddddd-0000-0000-0000-0000000000e1')
  || '/' ||
  (select count(*) from asientos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and origen = 'venta' and referencia_id = 'dddddddd-0000-0000-0000-0000000000e1')::text,
  'noop/1',
  'contabilizar dos veces el mismo documento es noop: un solo asiento'
);

set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- SETUP (sin assert): revertir el asiento AUTOMÁTICO del pago f1, luego correr el catch-up.
select revertir_asiento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from asientos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and origen = 'pago' and referencia_id = 'fafa0000-0000-0000-0000-0000000000f1'),
  'Reversa del pago automático');
select contabilizar_pendientes('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa');

-- 29) La reversa de un automático NO se re-crea: el unique (empresa,'pago',pago) sigue ocupado
--     por el asiento original inmutable → count sigue en 1.
select is(
  (select count(*) from asientos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and origen = 'pago' and referencia_id = 'fafa0000-0000-0000-0000-0000000000f1'),
  1::bigint,
  'un asiento automático revertido no se re-crea vía contabilizar_pendientes'
);

-- ===== Candados de escritura directa (Ana) =====

-- 30) Insert directo en asientos.
select throws_ok(
  $$insert into asientos (empresa_id, numero, fecha, glosa, origen)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 999, current_date, 'hack', 'manual')$$,
  '42501', 'permission denied for table asientos',
  'authenticated no inserta asientos directamente'
);

-- 31) Insert directo en asientos_lineas.
select throws_ok(
  $$insert into asientos_lineas (empresa_id, asiento_id, cuenta_id, debe, haber)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', gen_random_uuid(), gen_random_uuid(), 100, 0)$$,
  '42501', 'permission denied for table asientos_lineas',
  'authenticated no inserta líneas directamente'
);

-- 32) Update directo en cuentas_contables (toda edición es por guardar_cuenta).
select throws_ok(
  $$update cuentas_contables set nombre = 'hack' where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'$$,
  '42501', 'permission denied for table cuentas_contables',
  'authenticated no edita cuentas directamente'
);

-- ===== RLS por ROL =====

-- 33) El CONTADOR (Ces) ve asientos y líneas.
set local request.jwt.claims to '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated"}';
select ok(
  (select count(*) from asientos) > 0 and (select count(*) from asientos_lineas) > 0,
  'el contador ve los asientos y sus líneas'
);

-- 34) El VENDEDOR (Vero) ve 0 en las tres tablas (primer select por ROL del repo).
set local request.jwt.claims to '{"sub": "77777777-7777-7777-7777-777777777777", "role": "authenticated"}';
select is(
  (select count(*) from asientos) + (select count(*) from asientos_lineas) + (select count(*) from cuentas_contables),
  0::bigint,
  'el vendedor no ve nada de contabilidad (select restringido por rol)'
);

-- 35) Cross-tenant: Beto (dueño de B, sin asientos) no ve los de A.
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
select is(
  (select count(*) from asientos),
  0::bigint,
  'un dueño de otra empresa no ve asientos ajenos'
);

-- 36) Anónimo denegado de plano.
set local request.jwt.claims to '{"role": "anon"}';
set local role anon;
select throws_ok(
  'select count(*) from asientos',
  '42501', 'permission denied for table asientos',
  'un anónimo no puede consultar asientos'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Aplicar y verificar**

Run: `pnpm supabase db reset` → aplica 0001-0022 sin errores (la migración de contabilidad la escriben las Tasks previas del plan).
Run: `pnpm supabase test db` → **16 archivos, 315 asserts** (279 previos + 36). El archivo nuevo `contabilidad.test.sql` pasa `plan(36)` completo.

Byte-scan del archivo (JAMÁS BOM U+FEFF):

```
grep -c $'\xEF\xBB\xBF' supabase/tests/database/contabilidad.test.sql
```

→ imprime `0` y sale con status 1 (sin coincidencias = pass).

Smoke del conteo total de la suite:

```
grep -rhoE "select plan\([0-9]+\)" supabase/tests/database/*.test.sql | grep -oE "[0-9]+" | paste -sd+ | bc
```

→ `315`.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/database/contabilidad.test.sql
git commit -m "test(db): pgTAP de contabilidad — partida doble, mapeos y candados"
```

---

### Task 4: Regenerar tipos `@suite/db`

**Files:**
- Modify: `packages/db/src/types.ts` (regenerado)

**Interfaces:**
- Consumes: migración 0022 aplicada (Tasks 1-3: `empresas.modulo_contabilidad`; las 3 tablas nuevas `cuentas_contables` / `asientos` / `asientos_lineas` con sus RLS/CHECKs/índices; `pagos.anticipo_id`; el helper `app._insertar_asiento` — SIN grants, no aparece en tipos — y las **7 RPCs** `activar_contabilidad` / `desactivar_contabilidad` / `contabilizar_pendientes` / `crear_asiento` / `revertir_asiento` / `contabilizar_documento` / `guardar_cuenta`; las 2 re-creates `aplicar_anticipo` / `aplicar_anticipo_manual` que pasaron de `returns void` a `returns uuid`; el CHECK `documentos_venta_total_check`). El `pnpm supabase db reset` de la task de pgTAP dejó el Postgres local con **0001-0022** (22 migraciones) → `gen` lee ESE estado (`--local`).
- Produces: `types.ts` regenerado — lo consumen el hook `apps/erp/lib/contabilidad.ts` (Task 5: RPC `contabilizar_documento`), las actions con id capturado (Task 5: `aplicar_anticipo` / `aplicar_anticipo_manual` ahora `Returns: string`) y las páginas/rutas de `/contabilidad` (tasks de UI) vía `@suite/db`. **BLOCKED** de las tasks de hooks/UI si algún símbolo falta (tipos incompletos ocultarían un error de compilación hasta runtime).
- Espejo del patrón: Task 3 del Plan 14 (regeneración de `@suite/db` tras una migración) — `gen` + loop de verificación de los símbolos nuevos + `tsc` + build + commit; el comando `gen` de `packages/db` es `supabase gen types typescript --local > src/types.ts`.
- Nota de subcadenas (por qué el loop usa un ancla de inicio de línea `^\s+<nombre>:` y NO `-SimpleMatch` pelado): dos símbolos nuevos son SUBcadena de otro y un `-SimpleMatch` los daría por presentes aunque falten. `activar_contabilidad` es subcadena de `desactivar_contabilidad` (colisión de PREFIJO — el truco del colon del espejo Plan 13/14 NO sirve aquí: `activar_contabilidad:` también casa dentro de `desactivar_contabilidad:`), y `asientos` es subcadena de `asientos_lineas` y de los `foreignKeyName`/`referencedRelation` que llevan `asientos_...`. El ancla `^\s+<nombre>:` (inicio de línea + indentación + el nombre como CLAVE de objeto seguida de dos puntos) prueba cada símbolo como su PROPIA clave: `^\s+activar_contabilidad:` no casa la línea `      desactivar_contabilidad: {` (tras la indentación viene `des`, no `activar`), y `^\s+asientos:` no casa `      asientos_lineas: {` (tras `asientos` viene `_`, no `:`) ni las líneas de relación (empiezan por `foreignKeyName:` / `referencedRelation:`). Robusto para TODOS los símbolos, colisionen o no.
- Sin símbolo nuevo por CHECKs/constraints/índices: Postgres NO expone en los tipos el CHECK `documentos_venta_total_check` (0022), ni los CHECKs de `asientos.origen` / `cuentas_contables.tipo` / `debe`-`haber`, ni los unique parciales de idempotencia — son restricciones, no tipos. `documentos_venta` NO cambia de forma (el CHECK no altera columnas). No confundir "sin diff de esos" con "la migración no aplicó".

- [ ] **Step 1: Regenerar y verificar**

Refrescar el PATH en la shell nueva (Windows) antes de todo. `&&` NO encadena en PowerShell 5.1 → un comando por línea.

Run: `pnpm --filter @suite/db gen`

Expected: `types.ts` gana estos símbolos:
- **3 tablas** bajo `Tables` (Row/Insert/Update, como las de 0018): `cuentas_contables`, `asientos`, `asientos_lineas`.
- **1 columna nueva** en `empresas.Row`/`Insert`/`Update`: `modulo_contabilidad: boolean` (siembra el gating de NAV de la UI).
- **1 columna nueva** en `pagos.Row`/`Insert`/`Update`: `anticipo_id: string | null`.
- **7 Functions nuevas** bajo `Functions`: `activar_contabilidad`, `desactivar_contabilidad`, `contabilizar_pendientes`, `crear_asiento`, `revertir_asiento`, `contabilizar_documento`, `guardar_cuenta`.
- **2 Functions con `Returns` cambiado** de `undefined` a `string` (las re-creates que ahora retornan `pago_id`): `aplicar_anticipo` y `aplicar_anticipo_manual`.

Verificación de los 12 símbolos que SÍ deben aparecer (PowerShell 5.1; `Select-String` usa regex por defecto, `^` ancla cada línea):

```powershell
$patrones =
  '^\s+cuentas_contables:',
  '^\s+asientos:',
  '^\s+asientos_lineas:',
  '^\s+modulo_contabilidad:',
  '^\s+anticipo_id:',
  '^\s+activar_contabilidad:',
  '^\s+desactivar_contabilidad:',
  '^\s+contabilizar_pendientes:',
  '^\s+crear_asiento:',
  '^\s+revertir_asiento:',
  '^\s+contabilizar_documento:',
  '^\s+guardar_cuenta:'
foreach ($p in $patrones) {
  if (-not (Select-String -Path packages/db/src/types.ts -Pattern $p -Quiet)) { "FALTA: $p" }
}
```

Expected: **sin salida** (los 12 presentes). Cualquier línea `FALTA:` significa que 0022 no aplicó completa → **BLOCKED** (no seguir a hooks/UI con tipos incompletos). Triage:
- Falta una tabla (`cuentas_contables` / `asientos` / `asientos_lineas`) → falló su `create table` en 0022 (`pnpm supabase db reset` y releer el error de 0022).
- Falta `modulo_contabilidad` o `anticipo_id` → falló el `alter table` de esa capa.
- Faltan RPCs → falló el bloque de funciones; `pnpm supabase db reset` y releer el error de 0022.
- Los 12 presentes pero `contabilizar_documento` no ejecuta luego desde authenticated → es el candado service_role (grant), NO un problema de tipos: se cubre en la task de pgTAP, no aquí.

Verificación del cambio de `Returns` de las 2 re-creates (de `undefined` a `string` — lo que el hook de aplicación de anticipos captura como `pago_id` en Task 5):

```powershell
Select-String -Path packages/db/src/types.ts -Pattern '^\s+aplicar_anticipo(_manual)?:' -Context 0,2
```

Expected: dos bloques, cada uno con su `Args:` y luego `Returns: string` (NO `Returns: undefined`). Si sale `Returns: undefined`, la re-create de 0022 no cambió el `returns` → **BLOCKED** (el hook 'pago' de la aplicación de anticipos se quedaría sin referencia).

Run: `pnpm tsc --noEmit -p packages/db/tsconfig.json` → sin errores.
Run: `pnpm build --concurrency=1` → 3 apps.

Byte-scan del archivo regenerado (JAMÁS BOM U+FEFF; `gen` de supabase escribe UTF-8 sin BOM, pero se verifica; salida vacía / exit 1 = pass):

```
grep -c $'\xEF\xBB\xBF' packages/db/src/types.ts
```

→ imprime `0` y sale con status 1 (sin coincidencias = pass).

- [ ] **Step 2: Commit**

```bash
git add packages/db/src/types.ts
git commit -m "chore(db): tipos regenerados con el núcleo contable"
```

---

### Task 5: Hooks de contabilización en los 6 caminos de app

**Files:**
- Create: `apps/erp/lib/contabilidad.ts`
- Modify: `apps/erp/lib/emision.ts`, `apps/erp/app/ventas/emitir.ts`, `apps/erp/app/cobranza/acciones.ts`, `apps/erp/app/por-pagar/acciones.ts`, `apps/erp/app/api/webhooks/mercadopago/[empresaId]/route.ts`

**Interfaces:**
- Consumes: Task 4 (tipos `@suite/db` regenerados — RPC `contabilizar_documento` con `Args: { p_empresa; p_origen; p_referencia }` / `Returns: string`; `aplicar_anticipo` y `aplicar_anticipo_manual` con `Returns: string`; columna `pagos.anticipo_id`). RPC `contabilizar_documento` de la migración 0022 (SOLO service_role: `'creado'|'noop'`, no-op limpio si el módulo está inactivo / ya existe el asiento / el objeto no aplica / el mapeo da 0 líneas). `clienteAdmin` de `@suite/auth/admin` (service_role: el hook corre sin sesión, patrón `apps/erp/lib/emision.ts`). Las re-creates de 0022 que ahora **retornan el `pago_id`**: `aplicar_anticipo` (hook de emisión) y `aplicar_anticipo_manual` (botón de /cobranza). `registrar_pago` / `registrar_pago_proveedor` ya retornaban el uuid (0015/0013) — las actions solo pasan a CAPTURARLO.
- Produces: `contabilizarAsiento(empresaId, origen, referenciaId)` (nuevo `apps/erp/lib/contabilidad.ts`, admin client, NUNCA lanza) invocado en los 6 caminos que registran un hecho contable en la app: emisión de venta (`'venta'`) y de NC (`'nota_credito'`) en `emitir.ts`; pago de cliente (`'pago'`) en `cobranza/acciones.ts`; aplicación de anticipo (`'pago'`) en `cobranza/acciones.ts` (manual) y en `emision.ts` (automático al emitir); factura de compra (`'compra'`) y pago a proveedor (`'pago_proveedor'`) en `por-pagar/acciones.ts`; pago MP y anticipo-excedente (`'pago'` y `'anticipo'`) en el webhook. Los caminos que NO pasan por la app (RPC directa, E2E) quedan cubiertos por `contabilizar_pendientes`.
- Espejo estructural OBLIGATORIO (leído completo antes de escribir): `apps/erp/lib/emision.ts` → `aplicarAnticipoDocumento` es el patrón EXACTO de nunca-lanza (`try { admin.rpc(...); if (error) console.error(...) } catch (e) { console.error(...) }`); `contabilizarAsiento` lo copia línea a línea. Formato de la task: Task 5 del Plan 14 (rutas + hooks en `apps/erp`, admin client server-only).
- **Decisión — un solo helper, un solo origen 'pago'.** `contabilizarAsiento` es la ÚNICA envoltura de app sobre `contabilizar_documento`. TODO pago de cliente (manual, aplicación de anticipo, pago MP) se contabiliza con origen `'pago'`: la RPC ramifica el debe por `pagos.anticipo_id` (null → Banco = plata nueva; not null → Anticipos de clientes = reclasificación), así el unique de idempotencia `(empresa, 'pago', pago_id)` garantiza a lo más UN asiento por pago y el hook y `contabilizar_pendientes` jamás divergen. El tipo `origen` del helper excluye `'manual'` y `'reversa'` (esos nacen por `crear_asiento` / `revertir_asiento`, no por este hook).
- **Decisión — dónde llegan pago_mp/anticipo (hallazgo del lente).** `registrar_pago_mp` y `registrar_anticipo_mp` se invocan SÓLO en `apps/erp/app/api/webhooks/mercadopago/[empresaId]/route.ts` (verificado por grep: ningún otro caller). El simulador `apps/erp/app/mock-pago/[id]/acciones.ts` NO llama esas RPCs — hace `fetch` POST al webhook REAL, así que un hook en el webhook cubre AMBOS (MP real y simulador mock) → `mock-pago/[id]/acciones.ts` NO se toca. Tras la RPC (éxito), el webhook resuelve por `mp_payment_id` (= `dataId`) el pago y/o el anticipo-excedente creados y contabiliza AMBOS: `registrar_pago_mp` pudo crear un pago (`min(recibido, saldo)`) Y un anticipo-excedente (`mp_payment_id NOT NULL`); `registrar_anticipo_mp` crea solo el anticipo. Los dos `.eq('mp_payment_id', dataId)` van sobre índices unique parciales (a lo más una fila cada uno) → `maybeSingle()`. El excedente-DE-APLICACIÓN (`mp_payment_id NULL`, split de `aplicar_anticipo`) no se resuelve aquí: es el mismo pasivo cambiando de fila, no plata nueva (spec §4).
- **Decisión — el hook JAMÁS rompe el flujo.** `contabilizarAsiento` traga todo error (`console.error` y sigue) — igual que `registrarMovimientosDocumento` / `aplicarAnticipoDocumento`: en emisión un throw revertiría un DTE vivo; en un pago dejaría la action a medias. Idempotencia + catch-up (`contabilizar_pendientes`) reparan cualquier fallo best-effort. Los `if (pagoId)` / `if (compra)` / `if (pagoContab)` guardan el caso null (RPC/insert que no produjo fila: p.ej. `aplicar_anticipo` sin anticipo que aplicar retorna null).

- [ ] **Step 1: Crear `apps/erp/lib/contabilidad.ts`**

Espejo EXACTO de `aplicarAnticipoDocumento` (mismo `try/catch`, mismo admin client, mismo nunca-lanza).

```ts
import 'server-only'
import { clienteAdmin } from '@suite/auth/admin'

// Contabiliza un documento del ERP en tiempo real, justo despues de que se registra (venta, nota
// de credito, compra, pago de cliente, pago a proveedor o anticipo). Delegado a la RPC
// contabilizar_documento (SOLO service_role): bajo el candado del correlativo y del documento,
// aplica la regla de mapeo del origen y crea el asiento via el helper unico _insertar_asiento (la
// cuadratura debe = haber se revalida SIEMPRE, tambien en la via automatica). No-op limpio si el
// modulo de contabilidad esta inactivo, si ya existe el asiento (idempotencia por (empresa, origen,
// referencia)) o si el mapeo produce 0 lineas.
//
// NUNCA lanza -- espejo EXACTO de aplicarAnticipoDocumento: la contabilizacion es best-effort en el
// hook; cualquier camino que se salte el hook (RPC directa, E2E) se repara con el boton
// "Contabilizar pendientes" de /contabilidad (el MISMO motor idempotente). Si lanzara, romperia el
// flujo que la invoca (una emision de DTE ya vivo, un pago ya registrado): el fallo se traga con
// console.error y sigue.
export async function contabilizarAsiento(
  empresaId: string,
  origen: 'venta' | 'nota_credito' | 'compra' | 'pago' | 'pago_proveedor' | 'anticipo',
  referenciaId: string,
): Promise<void> {
  try {
    const admin = clienteAdmin()
    const { error } = await admin.rpc('contabilizar_documento', {
      p_empresa: empresaId,
      p_origen: origen,
      p_referencia: referenciaId,
    })
    if (error) console.error('contabilizarAsiento:', error.message)
  } catch (e) {
    console.error('contabilizarAsiento:', e)
  }
}
```

- [ ] **Step 2: `apps/erp/lib/emision.ts` — capturar el `pago_id` de `aplicar_anticipo` → hook 'pago'**

Import nuevo (tras `import { claveCifrado } from './cifrado'`):

```diff
 import type { Json } from '@suite/db'
 import { claveCifrado } from './cifrado'
+import { contabilizarAsiento } from './contabilidad'
```

`aplicarAnticipoDocumento` captura el `pago_id` que la re-create ahora retorna y lo contabiliza:

```diff
 export async function aplicarAnticipoDocumento(empresaId: string, documentoId: string): Promise<void> {
   try {
     const admin = clienteAdmin()
-    const { error } = await admin.rpc('aplicar_anticipo', {
+    const { data: pagoId, error } = await admin.rpc('aplicar_anticipo', {
       p_empresa: empresaId,
       p_documento: documentoId,
     })
     if (error) console.error('aplicarAnticipoDocumento:', error.message)
+    // aplicar_anticipo retorna el pago_id de la reclasificacion (null si no habia anticipo que
+    // aplicar). Se contabiliza como 'pago': la regla ramifica el debe por anticipo_id -> Anticipos
+    // de clientes (reclasificacion, no plata nueva). contabilizarAsiento nunca lanza.
+    else if (pagoId) await contabilizarAsiento(empresaId, 'pago', pagoId)
   } catch (e) {
     console.error('aplicarAnticipoDocumento:', e)
   }
 }
```

- [ ] **Step 3: `apps/erp/app/ventas/emitir.ts` — hooks 'venta' y 'nota_credito' tras los hooks existentes**

Import nuevo (tras el import de `../../lib/emision`):

```diff
 import { aplicarAnticipoDocumento, credencialesEmpresa, registrarMovimientosDocumento } from '../../lib/emision'
+import { contabilizarAsiento } from '../../lib/contabilidad'
```

`emitirDocumento`: el id del documento ya está (`id`), tras `aplicarAnticipoDocumento`:

```diff
       // Anticipo recibido por un link de pago sobre la proforma/cotización de origen: se aplica
       // solo al emitirse la factura. NUNCA lanza (espejo de registrarMovimientosDocumento): si
       // lanzara, el catch revertiría un DTE vivo. Fallo best-effort → botón "Aplicar" en /cobranza.
       await aplicarAnticipoDocumento(activa.id, id)
+      // Contabiliza la venta en tiempo real: Debe Clientes (total) / Haber Ventas (neto) + Ventas
+      // exentas (exento) + IVA débito (iva). Hook nunca-lanza; si el módulo está inactivo o el
+      // mapeo da 0 líneas (boleta total 0), la RPC es no-op.
+      await contabilizarAsiento(activa.id, 'venta', id)
     }
```

`emitirNotaCredito`: el id de la NC ya está (`ncId`, narrowed a `string` tras su insert), tras `registrarMovimientosDocumento`:

```diff
       await registrarMovimientosDocumento(
         activa.id,
         ncId,
         (lineasRef ?? []).map((l) => ({ producto_id: l.producto_id, cantidad: l.cantidad })),
         1,
         'Nota de crédito folio ' + (folioNc as number)
       )
+      // Contabiliza la NC en tiempo real: Debe Ventas (neto) + Ventas exentas (exento) + IVA débito
+      // (iva) / Haber Clientes (total) — inversa de la venta. Hook nunca-lanza.
+      await contabilizarAsiento(activa.id, 'nota_credito', ncId)
     }
```

- [ ] **Step 4: `apps/erp/app/cobranza/acciones.ts` — capturar uuid de `registrar_pago` y de `aplicar_anticipo_manual` → hook 'pago'**

Import nuevo (tras el import de `../../lib/empresa-activa`):

```diff
 import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
+import { contabilizarAsiento } from '../../lib/contabilidad'
 import type { EstadoForm } from '../tipos'
```

`registrarPago`: captura el uuid que `registrar_pago` retorna y contabiliza antes de revalidar/redirigir:

```diff
-  const { error } = await supabase.rpc('registrar_pago', {
+  const { data: pagoId, error } = await supabase.rpc('registrar_pago', {
     p_empresa: activa.id,
     p_cliente: cliente,
     p_fecha: (fecha || null) as string,
     p_metodo: metodo,
     p_monto: monto,
     p_referencia: (referencia || null) as string,
     p_notas: (notas || null) as string,
     p_aplicaciones: aplicaciones.map((a) => ({ documentoId: a.documentoId, monto: a.monto })) as unknown as Json,
   })
   if (error) {
     if (error.message.includes('rol')) return { error: 'Tu rol no permite registrar pagos' }
     if (error.message.includes('saldo')) return { error: error.message }
     if (error.message.includes('suma')) return { error: 'La suma de las aplicaciones debe ser igual al monto del pago' }
     if (error.message.includes('cobrable')) return { error: 'Hay un documento no cobrable o de otro cliente' }
     return { error: 'No se pudo registrar el pago' }
   }
+  // Contabiliza el pago en tiempo real: Debe Banco (pago manual, sin anticipo_id) / Haber Clientes.
+  // registrar_pago retorna el uuid del pago; el hook nunca lanza.
+  if (pagoId) await contabilizarAsiento(activa.id, 'pago', pagoId)
   revalidatePath('/cobranza')
   revalidatePath('/cobranza/pagos')
   redirect('/cobranza')
```

`aplicarAnticipoManual`: captura el `pago_id` que la re-create AHORA retorna y contabiliza:

```diff
-  const { error } = await supabase.rpc('aplicar_anticipo_manual', {
+  const { data: pagoId, error } = await supabase.rpc('aplicar_anticipo_manual', {
     p_empresa: activa.id,
     p_anticipo: anticipo,
     p_documento: documento,
   })
   if (error) {
     if (error.message.includes('rol')) return { error: 'Tu rol no permite aplicar anticipos' }
     if (error.message.includes('documento')) return { error: 'El documento no permite aplicar el anticipo' }
     if (error.message.includes('anticipo')) return { error: 'El anticipo no existe o ya fue aplicado' }
     return { error: 'No se pudo aplicar el anticipo' }
   }
+  // La re-create de aplicar_anticipo_manual ahora retorna el pago_id de la reclasificación: se
+  // contabiliza como 'pago' (debe Anticipos de clientes, por anticipo_id no nulo). Nunca lanza.
+  if (pagoId) await contabilizarAsiento(activa.id, 'pago', pagoId)
   revalidatePath('/cobranza')
   return {}
```

- [ ] **Step 5: `apps/erp/app/por-pagar/acciones.ts` — `.select('id')` en la compra → hook 'compra'; uuid de `registrar_pago_proveedor` → hook 'pago_proveedor'**

Import nuevo (tras el import de `../../lib/empresa-activa`):

```diff
 import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
+import { contabilizarAsiento } from '../../lib/contabilidad'
 import type { EstadoForm } from '../tipos'
```

`registrarFacturaCompra`: el insert directo gana `.select('id').single()` y se contabiliza:

```diff
-  const { error } = await supabase.from('documentos_compra').insert({
-    empresa_id: activa.id,
-    proveedor_id: proveedor,
-    tipo,
-    folio,
-    fecha_emision: fecha,
-    neto,
-    exento,
-    iva,
-    total,
-    orden_id: orden || null,
-    notas: notas || null,
-  })
+  const { data: compra, error } = await supabase
+    .from('documentos_compra')
+    .insert({
+      empresa_id: activa.id,
+      proveedor_id: proveedor,
+      tipo,
+      folio,
+      fecha_emision: fecha,
+      neto,
+      exento,
+      iva,
+      total,
+      orden_id: orden || null,
+      notas: notas || null,
+    })
+    .select('id')
+    .single()
   if (error) {
     if (error.code === '23505') return { error: 'Ya registraste esa factura de ese proveedor' }
     if (error.code === '42501') return { error: 'Tu rol no permite registrar facturas de compra' }
     return { error: 'No se pudo registrar la factura' }
   }
+  // Contabiliza la compra en tiempo real: Debe Compras/Gastos (neto+exento) + IVA crédito (iva) /
+  // Haber Proveedores (total). El .select('id') del insert entrega la referencia; el hook nunca lanza.
+  if (compra) await contabilizarAsiento(activa.id, 'compra', compra.id)
   revalidatePath('/por-pagar')
   revalidatePath('/por-pagar/facturas')
   redirect('/por-pagar/facturas')
```

`registrarPagoProveedor`: captura el uuid que `registrar_pago_proveedor` retorna y contabiliza:

```diff
-  const { error } = await supabase.rpc('registrar_pago_proveedor', {
+  const { data: pagoId, error } = await supabase.rpc('registrar_pago_proveedor', {
     p_empresa: activa.id,
     p_proveedor: proveedor,
     p_fecha: (fecha || null) as string,
     p_metodo: metodo,
     p_monto: monto,
     p_referencia: (referencia || null) as string,
     p_notas: (notas || null) as string,
     p_aplicaciones: aplicaciones.map((a) => ({ documentoId: a.documentoId, monto: a.monto })) as unknown as Json,
   })
   if (error) {
     if (error.message.includes('rol')) return { error: 'Tu rol no permite registrar pagos a proveedores' }
     if (error.message.includes('saldo')) return { error: error.message }
     if (error.message.includes('suma')) return { error: 'La suma de las aplicaciones debe ser igual al monto del pago' }
     if (error.message.includes('Método')) return { error: 'Selecciona un método de pago válido' }
     if (error.message.includes('válido')) return { error: 'Hay un documento no válido o de otro proveedor' }
     return { error: 'No se pudo registrar el pago' }
   }
+  // Contabiliza el pago a proveedor en tiempo real: Debe Proveedores (monto) / Haber Banco (monto).
+  // registrar_pago_proveedor retorna el uuid del pago; el hook nunca lanza.
+  if (pagoId) await contabilizarAsiento(activa.id, 'pago_proveedor', pagoId)
   revalidatePath('/por-pagar')
   revalidatePath('/por-pagar/pagos')
   redirect('/por-pagar')
```

- [ ] **Step 6: `apps/erp/app/api/webhooks/mercadopago/[empresaId]/route.ts` — resolver por `mp_payment_id` y contabilizar pago Y anticipo-excedente**

Import nuevo (tras `import { claveCifrado } from '../../../../../lib/cifrado'`):

```diff
 import { claveCifrado } from '../../../../../lib/cifrado'
+import { contabilizarAsiento } from '../../../../../lib/contabilidad'
```

Tras la RPC (`registrar_pago_mp` o `registrar_anticipo_mp`) exitosa — el bloque `if (eRpc) { ... }` ya retornó en error — y antes del `return` final de éxito:

```diff
     // Error de BD/infra: transitorio -> 500 para que MP reintente.
     console.error('webhook mercadopago: error de BD al registrar; MP reintentará:', empresaId, eRpc.message)
     return new Response(null, { status: 500 })
   }
 
+  // Contabilización en tiempo real (hooks nunca-lanza). Un mismo mp_payment_id pudo crear un pago
+  // (min(recibido, saldo)) Y un anticipo-excedente: ambos llevan este mp_payment_id (= dataId), se
+  // resuelven por él (índices unique parciales -> maybeSingle) y se contabilizan por separado.
+  // registrar_anticipo_mp crea solo el anticipo (el select de pagos no encuentra fila). El
+  // excedente-DE-APLICACIÓN (mp_payment_id null) no entra por aquí: es reclasificación, no plata nueva.
+  const { data: pagoContab } = await admin
+    .from('pagos')
+    .select('id')
+    .eq('empresa_id', empresaId)
+    .eq('mp_payment_id', dataId)
+    .maybeSingle()
+  if (pagoContab) await contabilizarAsiento(empresaId, 'pago', pagoContab.id)
+  const { data: anticipoContab } = await admin
+    .from('anticipos')
+    .select('id')
+    .eq('empresa_id', empresaId)
+    .eq('mp_payment_id', dataId)
+    .maybeSingle()
+  if (anticipoContab) await contabilizarAsiento(empresaId, 'anticipo', anticipoContab.id)
+
   return new Response(null, { status: 200 })
 }
```

`admin` ya está en scope (`const admin = clienteAdmin()` al inicio del handler). El simulador mock (`apps/erp/app/mock-pago/[id]/acciones.ts`) queda cubierto transitivamente: hace POST a este mismo webhook — NO se toca.

- [ ] **Step 7: Verificar y commit**

Refrescar el PATH en la shell nueva (Windows). `&&` NO encadena en PowerShell 5.1 → un comando por línea. Requisito previo: Task 4 (tipos `@suite/db` regenerados con `contabilizar_documento` y el `Returns: string` de `aplicar_anticipo`/`aplicar_anticipo_manual`) ya debe estar aplicada — sin ella el `admin.rpc('contabilizar_documento', ...)` y la captura de `pago_id` no compilan.

Run (3 apps compilan sin errores; `next build` de `erp` type-checkea los 5 archivos `.ts` tocados):

```
pnpm --filter erp build
pnpm --filter admin build
pnpm --filter web build
```

Chequeo de tipos explícito de `erp` (además del de `next build`):

```
pnpm tsc --noEmit -p apps/erp/tsconfig.json
```

→ sin errores.

Byte-scan (CERO BOM literal U+FEFF en el archivo nuevo y los 5 tocados; 0 coincidencias = pass):

```bash
grep -rlP '\xEF\xBB\xBF' apps/erp/lib/contabilidad.ts apps/erp/lib/emision.ts apps/erp/app/ventas/emitir.ts apps/erp/app/cobranza/acciones.ts apps/erp/app/por-pagar/acciones.ts "apps/erp/app/api/webhooks/mercadopago/[empresaId]/route.ts" && echo "FALLA: hay BOM" || echo "sin BOM (pass)"
```

Commit:

```bash
git add apps/erp/lib/contabilidad.ts apps/erp/lib/emision.ts apps/erp/app/ventas/emitir.ts apps/erp/app/cobranza/acciones.ts apps/erp/app/por-pagar/acciones.ts "apps/erp/app/api/webhooks/mercadopago/[empresaId]/route.ts"
git commit -m "feat(erp): hooks de contabilización en emisión, pagos, compras y anticipos"
```

---

### Task 6: ERP — módulo activable + NAV por rol + resumen + plan de cuentas

**Files:**
- Modify: `apps/erp/lib/empresa-activa.ts` (`EmpresaResumen` gana `modulo_contabilidad` y el `rol` del usuario)
- Create: `apps/erp/lib/contabilidad-acceso.ts` (predicado NAV + guard `notFound` de las pantallas)
- Modify: `apps/erp/app/layout.tsx` (link Contabilidad si módulo Y rol contable)
- Modify: `apps/erp/app/configuracion/modulos/acciones.ts` (action `alternarContabilidad`)
- Modify: `apps/erp/app/configuracion/modulos/page.tsx` (sección Contabilidad)
- Create: `apps/erp/componentes/panel-contabilidad.tsx` (toggle activar/desactivar)
- Create: `apps/erp/app/contabilidad/origenes.ts` (etiquetas + ruta del documento origen)
- Create: `apps/erp/app/contabilidad/page.tsx` (resumen) + `apps/erp/app/contabilidad/acciones.ts`
- Create: `apps/erp/componentes/boton-contabilizar.tsx`
- Create: `apps/erp/app/contabilidad/cuentas/page.tsx` + `apps/erp/app/contabilidad/cuentas/acciones.ts`
- Create: `apps/erp/componentes/panel-cuentas.tsx`

**Interfaces:**
- Consumes (tareas previas del Plan 16): migración 0022 aplicada y tipos `@suite/db` regenerados con la columna `empresas.modulo_contabilidad` (legible por el `grant select` de tabla de 0001 — solo la vía de UPDATE queda sin grant de columna, el toggle NUNCA hace update directo), las tablas `cuentas_contables` / `asientos` / `asientos_lineas` (RLS select por rol dueno/admin/contador) y las RPCs `activar_contabilidad(p_empresa)`, `desactivar_contabilidad(p_empresa)`, `contabilizar_pendientes(p_empresa) returns jsonb {creados}`, `guardar_cuenta(p_empresa, p_id, p_codigo, p_nombre, p_tipo, p_acepta_movimientos, p_activa)`. De `@suite/core`: `formatearCLP`. De `@suite/ui`: `Boton, Campo, Encabezado, Entrada, Insignia, Selector, Tabla, Tarjeta, Td, Th, Tr`. La tabla `miembros` (0001: `usuario_id, organizacion_id, rol, estado`) para resolver el rol.
- Produces: `EmpresaResumen.modulo_contabilidad` + `EmpresaResumen.rol` (los consume el layout de este task y TODAS las pantallas de contabilidad del Task 7 vía `exigirContabilidad`); el guard `exigirContabilidad()` / predicado `puedeVerContabilidad()`; el árbol `/contabilidad` (resumen + plan de cuentas); la action `alternarContabilidad`; `ETIQUETA_ORIGEN` / `rutaOrigen` (los consume el Task 7).
- ESPEJOS leídos antes de escribir: `apps/erp/lib/empresa-activa.ts` (forma de `EmpresaResumen` + `obtenerEmpresas`), `apps/erp/app/combustible/importar.ts` (guard de rol real: `auth.getUser()` + query `miembros` filtrada por `usuario_id`/`estado`), `apps/erp/app/configuracion/modulos/` (page async + action `_prev/formData` con `EstadoForm`), `apps/erp/componentes/formulario-modulos.tsx` (`useActionState`, checkbox de módulo), `apps/erp/app/cotizaciones/nueva/` (page que arma opciones para un form de líneas), `apps/erp/app/ventas/[id]/page.tsx` (guard `if (!doc) notFound()`, tablas/insignias).
- Mensajes: los de las RPCs (spec §4 — `'Las cuentas del sistema no se pueden modificar así'`, `'Ya existe una cuenta con ese código'`, `'Tu rol no permite crear asientos'`, etc.) son contractuales y llegan por `error.message` sin reescribir. Los del guard de cliente (`'No tienes una empresa activa'`, `'El código y el nombre son obligatorios'`, `'Tipo de cuenta no válido'`) son locales de la action.

- [ ] **Step 1: `EmpresaResumen` gana `modulo_contabilidad` y el rol**

Reemplazar COMPLETO `apps/erp/lib/empresa-activa.ts`:

```ts
import 'server-only'
import { cookies } from 'next/headers'
import { crearClienteServidor } from '@suite/auth/server'

export const COOKIE_EMPRESA = 'empresa_activa'

export interface EmpresaResumen {
  id: string
  organizacion_id: string
  rut: string
  razon_social: string
  modulo_transporte: boolean
  modulo_contabilidad: boolean
  rol: string | null
}

export async function obtenerEmpresas(): Promise<EmpresaResumen[]> {
  const supabase = await crearClienteServidor()
  const [empresasRes, usuarioRes] = await Promise.all([
    supabase
      .from('empresas')
      .select('id, organizacion_id, rut, razon_social, modulo_transporte, modulo_contabilidad')
      .order('razon_social'),
    supabase.auth.getUser(),
  ])
  if (empresasRes.error) throw new Error('No se pudieron cargar tus empresas')
  const empresas = empresasRes.data ?? []

  // Rol del usuario POR organización (UNA consulta a miembros, no N): el NAV y los
  // guards de /contabilidad necesitan saber si es dueno/admin/contador. Un vendedor
  // ve sus empresas pero con rol 'vendedor' -> sin acceso al módulo contable.
  let rolPorOrg = new Map<string, string>()
  const usuario = usuarioRes.data.user
  if (usuario) {
    const { data: miembros } = await supabase
      .from('miembros')
      .select('organizacion_id, rol')
      .eq('usuario_id', usuario.id)
      .eq('estado', 'activo')
    rolPorOrg = new Map((miembros ?? []).map((m) => [m.organizacion_id, m.rol] as const))
  }

  return empresas.map((e) => ({ ...e, rol: rolPorOrg.get(e.organizacion_id) ?? null }))
}

export async function obtenerEmpresaActiva(): Promise<{
  activa: EmpresaResumen | null
  empresas: EmpresaResumen[]
}> {
  const empresas = await obtenerEmpresas()
  const almacen = await cookies()
  const id = almacen.get(COOKIE_EMPRESA)?.value
  const activa = empresas.find((e) => e.id === id) ?? empresas[0] ?? null
  return { activa, empresas }
}
```

- [ ] **Step 2: Guard módulo + rol (`lib/contabilidad-acceso.ts`)**

`apps/erp/lib/contabilidad-acceso.ts`:

```ts
import 'server-only'
import { notFound } from 'next/navigation'
import { obtenerEmpresaActiva, type EmpresaResumen } from './empresa-activa'

// Roles que ven y operan contabilidad (spec §2). vendedor/bodeguero NO.
export const ROLES_CONTABLES = ['dueno', 'admin', 'contador'] as const

// Predicado puro para el NAV (layout) y los guards. Es SOLO UX: la seguridad real
// vive en la RLS por rol de asientos/cuentas y en las RPCs; esto oculta el link y
// devuelve notFound en las pantallas.
export function puedeVerContabilidad(activa: EmpresaResumen | null): boolean {
  return (
    !!activa?.modulo_contabilidad &&
    activa.rol !== null &&
    (ROLES_CONTABLES as readonly string[]).includes(activa.rol)
  )
}

// Guard de todas las pantallas de /contabilidad: sin módulo o sin rol -> notFound
// (misma cara que una ruta inexistente). Devuelve la empresa activa ya validada.
export async function exigirContabilidad(): Promise<EmpresaResumen> {
  const { activa } = await obtenerEmpresaActiva()
  if (!puedeVerContabilidad(activa)) notFound()
  return activa as EmpresaResumen
}
```

- [ ] **Step 3: NAV condicional en el layout**

En `apps/erp/app/layout.tsx`, agregar el import y la entrada de NAV.

Tras `import { obtenerEmpresaActiva } from '../lib/empresa-activa'` añadir:

```ts
import { puedeVerContabilidad } from '../lib/contabilidad-acceso'
```

Y en el array `nav`, insertar la entrada Contabilidad entre Reportes y Configuración:

```ts
    { href: '/reportes', etiqueta: 'Reportes' },
    ...(puedeVerContabilidad(activa) ? [{ href: '/contabilidad', etiqueta: 'Contabilidad' }] : []),
    { href: '/configuracion', etiqueta: 'Configuración' },
  ]
```

- [ ] **Step 4: Toggle Contabilidad en `/configuracion/modulos`**

Anexar al FINAL de `apps/erp/app/configuracion/modulos/acciones.ts` (sin tocar `guardarModulos`; los imports `revalidatePath` / `crearClienteServidor` / `obtenerEmpresaActiva` ya están):

```ts
export type EstadoContabilidad = { error?: string; mensaje?: string }

export async function alternarContabilidad(
  _prev: EstadoContabilidad,
  formData: FormData,
): Promise<EstadoContabilidad> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const activar = formData.get('modulo_contabilidad') === 'on'
  const supabase = await crearClienteServidor()

  // Desactivar: solo apaga el flag (asientos y cuentas quedan). Es la ÚNICA vía junto
  // con activar de mover modulo_contabilidad (la columna no tiene grant de UPDATE).
  if (!activar) {
    const { error } = await supabase.rpc('desactivar_contabilidad', { p_empresa: activa.id })
    if (error) return { error: error.message }
    revalidatePath('/', 'layout')
    return { mensaje: 'Contabilidad desactivada.' }
  }

  // Activar = sembrar el catálogo + prender el flag (RPC 1) y luego contabilizar el
  // histórico (RPC 2, mismo motor que el botón "Contabilizar pendientes"). AMBAS por el
  // cliente del usuario: son authenticated dueno/admin (el admin client daría 42501).
  const { error: eActivar } = await supabase.rpc('activar_contabilidad', { p_empresa: activa.id })
  if (eActivar) return { error: eActivar.message }
  const { data: pendientes, error: ePend } = await supabase.rpc('contabilizar_pendientes', {
    p_empresa: activa.id,
  })
  if (ePend) return { error: ePend.message }
  const creados = (pendientes as unknown as { creados: number } | null)?.creados ?? 0
  revalidatePath('/', 'layout')
  return {
    mensaje: `Contabilidad activada. ${creados} asiento${creados === 1 ? '' : 's'} creado${creados === 1 ? '' : 's'} del historial.`,
  }
}
```

`apps/erp/componentes/panel-contabilidad.tsx`:

```tsx
'use client'

import { useActionState } from 'react'
import { Boton, Tarjeta } from '@suite/ui'
import type { EstadoContabilidad } from '../app/configuracion/modulos/acciones'

export function PanelContabilidad({
  accion,
  activo,
}: {
  accion: (prev: EstadoContabilidad, formData: FormData) => Promise<EstadoContabilidad>
  activo: boolean
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoContabilidad)
  return (
    <Tarjeta className="mt-4 max-w-2xl">
      <form action={enviar} className="grid gap-4">
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            name="modulo_contabilidad"
            defaultChecked={activo}
            className="h-4 w-4 rounded border-slate-300 text-marca-600 focus:ring-marca-500"
          />
          <span className="text-sm font-medium text-slate-700">
            Módulo de contabilidad (plan de cuentas, asientos automáticos y libros)
          </span>
        </label>
        <p className="text-sm text-slate-500">
          Al activarlo se siembra un plan de cuentas chileno y se contabiliza todo el historial
          ya registrado. Apagarlo solo oculta las pantallas: los asientos y las cuentas quedan
          intactos.
        </p>
        <div className="flex items-center justify-end gap-2">
          {estado.error && <span className="mr-auto text-sm text-red-600">{estado.error}</span>}
          {estado.mensaje && <span className="mr-auto text-sm text-green-700">{estado.mensaje}</span>}
          <Boton type="submit" disabled={pendiente}>{pendiente ? 'Guardando…' : 'Guardar contabilidad'}</Boton>
        </div>
      </form>
    </Tarjeta>
  )
}
```

Reemplazar COMPLETO `apps/erp/app/configuracion/modulos/page.tsx` (usa `activa.modulo_contabilidad` — ya viene en `EmpresaResumen`, sin re-query):

```tsx
import { crearClienteServidor } from '@suite/auth/server'
import { Encabezado } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { FormularioModulos } from '../../../componentes/formulario-modulos'
import { PanelContabilidad } from '../../../componentes/panel-contabilidad'
import { alternarContabilidad, guardarModulos } from './acciones'

export default async function ConfigModulos() {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />

  const supabase = await crearClienteServidor()
  const { data: empresa } = await supabase
    .from('empresas')
    .select('modulo_transporte, factor_volumetrico')
    .eq('id', activa.id)
    .single()

  return (
    <div>
      <Encabezado titulo="Módulos" />
      <FormularioModulos
        accion={guardarModulos}
        inicial={{
          moduloTransporte: empresa?.modulo_transporte ?? false,
          factorVolumetrico: empresa?.factor_volumetrico ?? 250,
        }}
      />
      <PanelContabilidad accion={alternarContabilidad} activo={activa.modulo_contabilidad} />
    </div>
  )
}
```

- [ ] **Step 5: Etiquetas de origen compartidas (`contabilidad/origenes.ts`)**

`apps/erp/app/contabilidad/origenes.ts`:

```ts
// Etiquetas legibles de los orígenes de asiento (spec §4). Compartidas por el resumen,
// la lista y el detalle para no repetir el mapa.
export const ETIQUETA_ORIGEN: Record<string, string> = {
  manual: 'Manual',
  venta: 'Venta',
  nota_credito: 'Nota de crédito',
  compra: 'Compra',
  pago: 'Pago de cliente',
  pago_proveedor: 'Pago a proveedor',
  anticipo: 'Anticipo',
  reversa: 'Reversa',
}

// Ruta del documento de origen SOLO cuando existe una pantalla de detalle para él:
// ventas/NC tienen página propia; compra/pago/anticipo viven en listas -> sin link
// (se muestra solo la etiqueta). La usa el detalle de asiento (Task 7).
export function rutaOrigen(origen: string, referenciaId: string | null): string | null {
  if (!referenciaId) return null
  if (origen === 'venta' || origen === 'nota_credito') return `/ventas/${referenciaId}`
  return null
}
```

- [ ] **Step 6: Resumen `/contabilidad`**

`apps/erp/app/contabilidad/acciones.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@suite/auth/server'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'

export type EstadoContabilizar = { error?: string; creados?: number }

export async function contabilizarPendientes(
  _prev: EstadoContabilizar,
  _formData: FormData,
): Promise<EstadoContabilizar> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase.rpc('contabilizar_pendientes', { p_empresa: activa.id })
  if (error) return { error: error.message }
  revalidatePath('/contabilidad')
  return { creados: (data as unknown as { creados: number } | null)?.creados ?? 0 }
}
```

`apps/erp/componentes/boton-contabilizar.tsx`:

```tsx
'use client'

import { useActionState } from 'react'
import { Boton } from '@suite/ui'
import type { EstadoContabilizar } from '../app/contabilidad/acciones'

export function BotonContabilizar({
  accion,
}: {
  accion: (prev: EstadoContabilizar, formData: FormData) => Promise<EstadoContabilizar>
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoContabilizar)
  return (
    <form action={enviar} className="flex flex-wrap items-center gap-3">
      <Boton type="submit" disabled={pendiente}>
        {pendiente ? 'Contabilizando…' : 'Contabilizar pendientes'}
      </Boton>
      {estado.error && <span className="text-sm text-red-600">{estado.error}</span>}
      {estado.creados !== undefined && !estado.error && (
        <span className="text-sm text-green-700">
          {estado.creados === 0
            ? 'Todo al día: no había documentos pendientes.'
            : `${estado.creados} asiento${estado.creados === 1 ? '' : 's'} creado${estado.creados === 1 ? '' : 's'}.`}
        </span>
      )}
    </form>
  )
}
```

`apps/erp/app/contabilidad/page.tsx`:

```tsx
import Link from 'next/link'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP } from '@suite/core'
import { Boton, Encabezado, Insignia, Tabla, Tarjeta, Td, Th, Tr } from '@suite/ui'
import { exigirContabilidad } from '../../lib/contabilidad-acceso'
import { BotonContabilizar } from '../../componentes/boton-contabilizar'
import { ETIQUETA_ORIGEN } from './origenes'
import { contabilizarPendientes } from './acciones'

export default async function PaginaContabilidad() {
  const activa = await exigirContabilidad()
  const supabase = await crearClienteServidor()
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
          <Link href="/contabilidad/asientos/nuevo"><Boton>Nuevo asiento</Boton></Link>
        </div>
      </Encabezado>

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

- [ ] **Step 7: Plan de cuentas `/contabilidad/cuentas`**

`apps/erp/app/contabilidad/cuentas/acciones.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@suite/auth/server'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'

export type EstadoCuenta = { error?: string; ok?: boolean }

const TIPOS = ['activo', 'pasivo', 'patrimonio', 'ingreso', 'gasto']

export async function guardarCuenta(_prev: EstadoCuenta, formData: FormData): Promise<EstadoCuenta> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const id = String(formData.get('id') ?? '').trim()
  const codigo = String(formData.get('codigo') ?? '').trim()
  const nombre = String(formData.get('nombre') ?? '').trim()
  const tipo = String(formData.get('tipo') ?? '').trim()
  if (!codigo || !nombre) return { error: 'El código y el nombre son obligatorios' }
  if (!TIPOS.includes(tipo)) return { error: 'Tipo de cuenta no válido' }

  const supabase = await crearClienteServidor()
  // p_id acepta NULL en SQL (crear cuando es null); el codegen no refleja la nulabilidad
  // de argumentos, así que el cast es SOLO de tipo (mismo criterio que cotizaciones/acciones.ts).
  // Los mensajes de la RPC (spec §4.6) son contractuales y pasan por error.message sin reescribir.
  const { error } = await supabase.rpc('guardar_cuenta', {
    p_empresa: activa.id,
    p_id: (id || null) as string,
    p_codigo: codigo,
    p_nombre: nombre,
    p_tipo: tipo,
    p_acepta_movimientos: formData.get('acepta_movimientos') === 'on',
    p_activa: formData.get('activa') === 'on',
  })
  if (error) return { error: error.message }
  revalidatePath('/contabilidad/cuentas')
  return { ok: true }
}
```

`apps/erp/app/contabilidad/cuentas/page.tsx`:

```tsx
import { crearClienteServidor } from '@suite/auth/server'
import { Encabezado } from '@suite/ui'
import { exigirContabilidad } from '../../../lib/contabilidad-acceso'
import { PanelCuentas } from '../../../componentes/panel-cuentas'
import { guardarCuenta } from './acciones'

export default async function PaginaCuentas() {
  const activa = await exigirContabilidad()
  const supabase = await crearClienteServidor()
  const { data: cuentas } = await supabase
    .from('cuentas_contables')
    .select('id, codigo, nombre, tipo, acepta_movimientos, clave_sistema, activa')
    .eq('empresa_id', activa.id)
    .order('codigo')

  return (
    <div>
      <Encabezado titulo="Plan de cuentas" />
      <PanelCuentas cuentas={cuentas ?? []} accion={guardarCuenta} />
    </div>
  )
}
```

`apps/erp/componentes/panel-cuentas.tsx` (lista jerárquica por código con insignia de tipo + marca de sistema; crear/editar vía `guardar_cuenta`; las cuentas de sistema solo cambian código/nombre — la RPC es el guard, el aviso lo advierte):

```tsx
'use client'

import { useActionState, useState } from 'react'
import { Boton, Campo, Entrada, Insignia, Selector, Tabla, Tarjeta, Td, Th, Tr } from '@suite/ui'
import type { EstadoCuenta } from '../app/contabilidad/cuentas/acciones'

export interface CuentaFila {
  id: string
  codigo: string
  nombre: string
  tipo: string
  acepta_movimientos: boolean
  clave_sistema: string | null
  activa: boolean
}

const TIPOS = ['activo', 'pasivo', 'patrimonio', 'ingreso', 'gasto'] as const

const TONO_TIPO: Record<string, 'verde' | 'amarillo' | 'rojo' | 'gris'> = {
  activo: 'verde',
  pasivo: 'amarillo',
  patrimonio: 'gris',
  ingreso: 'verde',
  gasto: 'rojo',
}

export function PanelCuentas({
  cuentas,
  accion,
}: {
  cuentas: CuentaFila[]
  accion: (prev: EstadoCuenta, formData: FormData) => Promise<EstadoCuenta>
}) {
  // null = nada abierto; 'nueva' = crear; CuentaFila = editar esa cuenta.
  const [editando, setEditando] = useState<CuentaFila | 'nueva' | null>(null)
  const cuenta = editando === 'nueva' ? null : editando

  return (
    <div>
      <div className="mb-4 flex items-center justify-end">
        <Boton type="button" onClick={() => setEditando(editando === 'nueva' ? null : 'nueva')}>
          {editando === 'nueva' ? 'Cerrar' : 'Nueva cuenta'}
        </Boton>
      </div>

      {editando !== null && (
        <FormularioCuenta key={cuenta?.id ?? 'nueva'} cuenta={cuenta} accion={accion} onCerrar={() => setEditando(null)} />
      )}

      <Tabla>
        <thead><tr><Th>Código</Th><Th>Cuenta</Th><Th>Tipo</Th><Th>Movimientos</Th><Th /></tr></thead>
        <tbody>
          {cuentas.map((c) => {
            const nivel = c.codigo.split('.').length - 1
            return (
              <Tr key={c.id}>
                <Td className="font-mono">{c.codigo}</Td>
                <Td>
                  <span style={{ paddingLeft: nivel * 16 }} className={c.acepta_movimientos ? '' : 'font-semibold text-slate-800'}>
                    {c.nombre}
                  </span>
                  {c.clave_sistema && <span className="ml-2 text-xs text-slate-400">(sistema)</span>}
                  {!c.activa && <span className="ml-2 text-xs text-red-500">(inactiva)</span>}
                </Td>
                <Td><Insignia tono={TONO_TIPO[c.tipo] ?? 'gris'}>{c.tipo}</Insignia></Td>
                <Td>{c.acepta_movimientos ? 'Sí' : '—'}</Td>
                <Td>
                  <Boton variante="secundario" type="button" className="px-2 py-1 text-xs" onClick={() => setEditando(c)}>Editar</Boton>
                </Td>
              </Tr>
            )
          })}
          {cuentas.length === 0 && <Tr><Td colSpan={5} className="py-8 text-center text-slate-500">Sin cuentas todavía.</Td></Tr>}
        </tbody>
      </Tabla>
    </div>
  )
}

function FormularioCuenta({
  cuenta,
  accion,
  onCerrar,
}: {
  cuenta: CuentaFila | null
  accion: (prev: EstadoCuenta, formData: FormData) => Promise<EstadoCuenta>
  onCerrar: () => void
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoCuenta)
  const bloqueada = !!cuenta?.clave_sistema

  return (
    <Tarjeta className="mb-4 max-w-3xl">
      <form action={enviar} className="grid gap-3">
        <input type="hidden" name="id" value={cuenta?.id ?? ''} />
        <div className="flex flex-wrap gap-3">
          <Campo etiqueta="Código *">
            <Entrada name="codigo" required defaultValue={cuenta?.codigo ?? ''} placeholder="1.1.05" className="w-32" />
          </Campo>
          <Campo etiqueta="Nombre *">
            <Entrada name="nombre" required defaultValue={cuenta?.nombre ?? ''} className="w-64" />
          </Campo>
          <Campo etiqueta="Tipo *">
            <Selector name="tipo" defaultValue={cuenta?.tipo ?? 'activo'}>
              {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
            </Selector>
          </Campo>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" name="acepta_movimientos" defaultChecked={cuenta ? cuenta.acepta_movimientos : true} />
          Acepta movimientos (solo las cuentas hoja reciben líneas)
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" name="activa" defaultChecked={cuenta ? cuenta.activa : true} />
          Activa
        </label>
        {bloqueada && (
          <p className="text-xs text-slate-500">
            Es una cuenta del sistema: solo puedes cambiar su código y su nombre; cualquier otro cambio será rechazado.
          </p>
        )}
        <div className="flex items-center justify-end gap-2">
          {estado.error && <span className="mr-auto text-sm text-red-600">{estado.error}</span>}
          {estado.ok && <span className="mr-auto text-sm text-green-700">Cuenta guardada.</span>}
          <Boton variante="secundario" type="button" onClick={onCerrar}>Cerrar</Boton>
          <Boton type="submit" disabled={pendiente}>{pendiente ? 'Guardando…' : 'Guardar cuenta'}</Boton>
        </div>
      </form>
    </Tarjeta>
  )
}
```

- [ ] **Step 8: Verificar (build 3 apps + type-check + byte-scan)**

Run: `pnpm --filter erp exec tsc --noEmit` → sin errores (referencia `activar_contabilidad`/`desactivar_contabilidad`/`contabilizar_pendientes`/`guardar_cuenta`/`asientos`/`cuentas_contables`/`modulo_contabilidad` de los tipos regenerados en la task previa).
Run: `pnpm build --concurrency=1` → 3 apps compilan. OJO: el build pisa el `.next` de los dev servers → reiniciar `pnpm --filter erp dev` antes de cualquier click-through.

Byte-scan (JAMÁS BOM U+FEFF; `\xEF\xBB\xBF` es la secuencia de bytes; sin coincidencias / exit 1 = pass):

```
grep -lc $'\xEF\xBB\xBF' apps/erp/lib/empresa-activa.ts apps/erp/lib/contabilidad-acceso.ts apps/erp/app/layout.tsx apps/erp/app/configuracion/modulos/acciones.ts apps/erp/app/configuracion/modulos/page.tsx apps/erp/componentes/panel-contabilidad.tsx apps/erp/app/contabilidad/origenes.ts apps/erp/app/contabilidad/page.tsx apps/erp/app/contabilidad/acciones.ts apps/erp/componentes/boton-contabilizar.tsx apps/erp/app/contabilidad/cuentas/page.tsx apps/erp/app/contabilidad/cuentas/acciones.ts apps/erp/componentes/panel-cuentas.tsx
```

→ ninguna línea impresa (exit 1) = pass.

- [ ] **Step 9: Commit**

```bash
git add apps/erp/lib/empresa-activa.ts apps/erp/lib/contabilidad-acceso.ts apps/erp/app/layout.tsx apps/erp/app/configuracion/modulos apps/erp/componentes/panel-contabilidad.tsx apps/erp/app/contabilidad apps/erp/componentes/boton-contabilizar.tsx apps/erp/componentes/panel-cuentas.tsx
git commit -m "feat(erp): módulo contabilidad — activación, resumen y plan de cuentas"
```

---

### Task 7: ERP — asientos (lista, detalle, manual, reversa) + trazabilidad en los detalles

**Files:**
- Create: `apps/erp/app/contabilidad/asientos/page.tsx` (lista con filtros rango/origen)
- Create: `apps/erp/app/contabilidad/asientos/acciones.ts` (`crearAsiento` + `revertirAsiento`)
- Create: `apps/erp/app/contabilidad/asientos/[id]/page.tsx` (detalle: líneas, link al origen, reversa)
- Create: `apps/erp/componentes/boton-revertir.tsx`
- Create: `apps/erp/app/contabilidad/asientos/nuevo/page.tsx`
- Create: `apps/erp/componentes/formulario-asiento.tsx` (líneas dinámicas + cuadratura viva)
- Modify: `apps/erp/app/ventas/[id]/page.tsx` (línea "Asiento N°X")
- Modify: `apps/erp/app/cobranza/pagos/page.tsx` (columna "Asiento")

**Interfaces:**
- Consumes (Task 6 + tareas previas del Plan 16): `exigirContabilidad()` y `ETIQUETA_ORIGEN`/`rutaOrigen` (Task 6); tipos `@suite/db` regenerados con las tablas `asientos`/`asientos_lineas`/`cuentas_contables` (RLS select por rol dueno/admin/contador) y las RPCs `crear_asiento(p_empresa, p_fecha, p_glosa, p_lineas jsonb) returns uuid` y `revertir_asiento(p_empresa, p_asiento, p_glosa) returns uuid`. De `@suite/db`: `Json` (cast del jsonb de líneas). De `@suite/core`: `formatearCLP`. De `@suite/ui`: `Boton, Campo, Encabezado, Entrada, Insignia, Selector, Tabla, Tarjeta, Td, Th, Tr`.
- Produces: el árbol `/contabilidad/asientos` (lista/detalle/nuevo con reversa) y la trazabilidad bidireccional documento↔asiento (el detalle de asiento enlaza al documento origen; el detalle de venta y la lista de pagos enlazan al asiento).
- ESPEJOS leídos antes de escribir: `apps/erp/componentes/formulario-cotizacion.tsx` (form de líneas dinámicas: `useState` de líneas, hidden `JSON.stringify`, totales vivos, submit deshabilitado por regla — la cuadratura viva del asiento es su espejo), `apps/erp/app/cotizaciones/acciones.ts` (`crear_cotizacion` con `p_lineas` jsonb casteado `as unknown as Json`, `redirect` FUERA de try/catch tras la RPC), `apps/erp/componentes/formulario-anular.tsx` (patrón toggle-abrir + input motivo + confirmar de `revertir`), `apps/erp/app/ventas/[id]/page.tsx` y `apps/erp/app/cobranza/pagos/page.tsx` (páginas reales a modificar), `apps/erp/app/por-pagar/page.tsx` (filtros GET con `searchParams`).
- Decisión — 2 puntos de trazabilidad (spec §6 pide venta/compra/pago; el "mínimo" es ventas/[id]): `ventas/[id]` (única página de DETALLE de documento — cubre venta y nota_credito, comparten `referencia_id`) y `cobranza/pagos` (lista — cubre el origen `pago`, alto valor: no hay página de detalle de pago). Compra y pago_proveedor viven solo en listas de `por-pagar`: NO hay página de detalle de `documentos_compra` (`/compras/[id]` es órdenes de compra, otra tabla — no confundir), así que la traza de compra se difiere hasta que exista ese detalle (mismo patrón de query batch por origen+referencia). El spec §6 quedó actualizado registrando esta desviación. En AMBOS puntos la query a `asientos` no necesita guard extra: la RLS por rol devuelve 0 filas al que no ve contabilidad y no hay asientos si el módulo está apagado → la línea/columna simplemente no aparece.
- Mensajes: los de `crear_asiento`/`revertir_asiento` (spec §4.3-4.4: `'La contabilidad no está activada'`, `'Un asiento necesita al menos dos líneas'`, `'Cuenta contable no válida'`, `'Cada línea lleva debe o haber, mayor que cero'`, `'El asiento no cuadra: debe y haber difieren'`, `'Tu rol no permite crear asientos'`, `'El asiento no existe'`, `'El asiento ya fue revertido'`) son contractuales y llegan por `error.message` sin reescribir (el form ya impide en vivo el descuadre y las líneas incompletas; estos mensajes son el backstop del servidor).

- [ ] **Step 1: Actions de asiento (`crearAsiento` + `revertirAsiento`)**

`apps/erp/app/contabilidad/asientos/acciones.ts`:

```ts
'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@suite/auth/server'
import type { Json } from '@suite/db'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'

export type EstadoAsiento = { error?: string }

interface LineaEntrada {
  cuentaId: string
  debe: number
  haber: number
  glosa: string
}

export async function crearAsiento(_prev: EstadoAsiento, formData: FormData): Promise<EstadoAsiento> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const fecha = String(formData.get('fecha') ?? '').trim()
  const glosa = String(formData.get('glosa') ?? '').trim()
  if (!fecha) return { error: 'La fecha es obligatoria' }
  if (!glosa) return { error: 'La glosa es obligatoria' }

  let lineas: LineaEntrada[]
  try {
    lineas = JSON.parse(String(formData.get('lineas') ?? '[]')) as LineaEntrada[]
  } catch {
    return { error: 'No se pudieron leer las líneas del asiento' }
  }

  const supabase = await crearClienteServidor()
  // p_lineas es jsonb en SQL; el codegen lo tipa como Json -> cast SOLO de tipo (mismo
  // criterio que cotizaciones/acciones.ts). Las claves camelCase (`cuentaId`) son el
  // contrato de la RPC (part-2, patrón registrar_pago) — se pasan tal cual, sin re-map.
  // Los montos van clampados a enteros >= 0 (Math.max(0, trunc) — defensa en profundidad;
  // el form ya clampa, la action también). El RPC valida cuadratura/cuentas/montos/rol
  // y sus mensajes (spec §4.3) llegan por error.message sin reescribir.
  const { data, error } = await supabase.rpc('crear_asiento', {
    p_empresa: activa.id,
    p_fecha: fecha,
    p_glosa: glosa,
    p_lineas: lineas.map((l) => ({
      cuentaId: l.cuentaId,
      debe: Math.max(0, Math.trunc(l.debe) || 0),
      haber: Math.max(0, Math.trunc(l.haber) || 0),
      glosa: l.glosa || null,
    })) as unknown as Json,
  })
  if (error) return { error: error.message }
  revalidatePath('/contabilidad/asientos')
  // redirect lanza NEXT_REDIRECT: va FUERA de cualquier try/catch. data = uuid del asiento.
  redirect(`/contabilidad/asientos/${data}`)
}

export async function revertirAsiento(_prev: EstadoAsiento, formData: FormData): Promise<EstadoAsiento> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  const asiento = String(formData.get('asiento_id') ?? '')
  const glosa = String(formData.get('glosa') ?? '').trim()
  if (!asiento) return { error: 'Asiento no válido' }
  if (!glosa) return { error: 'Indica el motivo de la reversa' }
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase.rpc('revertir_asiento', {
    p_empresa: activa.id,
    p_asiento: asiento,
    p_glosa: glosa,
  })
  if (error) return { error: error.message }
  revalidatePath('/contabilidad/asientos')
  redirect(`/contabilidad/asientos/${data}`)
}
```

- [ ] **Step 2: Lista `/contabilidad/asientos` (filtros rango + origen)**

`apps/erp/app/contabilidad/asientos/page.tsx`:

```tsx
import Link from 'next/link'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP } from '@suite/core'
import { Boton, Campo, Encabezado, Entrada, Insignia, Selector, Tabla, Td, Th, Tr } from '@suite/ui'
import { exigirContabilidad } from '../../../lib/contabilidad-acceso'
import { ETIQUETA_ORIGEN } from '../origenes'

const ORIGENES = ['manual', 'venta', 'nota_credito', 'compra', 'pago', 'pago_proveedor', 'anticipo', 'reversa']

export default async function PaginaAsientos({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string; origen?: string }>
}) {
  const { desde = '', hasta = '', origen = '' } = await searchParams
  const activa = await exigirContabilidad()
  const supabase = await crearClienteServidor()
  let q = supabase
    .from('asientos')
    .select('id, numero, fecha, glosa, origen, asientos_lineas (debe)')
    .eq('empresa_id', activa.id)
    .order('numero', { ascending: false })
    .limit(200)
  if (desde) q = q.gte('fecha', desde)
  if (hasta) q = q.lte('fecha', hasta)
  if (origen) q = q.eq('origen', origen)
  const { data: asientos } = await q

  return (
    <div>
      <Encabezado titulo="Asientos">
        <Link href="/contabilidad/asientos/nuevo"><Boton>Nuevo asiento</Boton></Link>
      </Encabezado>

      <form className="mb-4 flex flex-wrap items-end gap-3" action="/contabilidad/asientos" method="get">
        <Campo etiqueta="Desde"><Entrada type="date" name="desde" defaultValue={desde} /></Campo>
        <Campo etiqueta="Hasta"><Entrada type="date" name="hasta" defaultValue={hasta} /></Campo>
        <Campo etiqueta="Origen">
          <Selector name="origen" defaultValue={origen}>
            <option value="">Todos</option>
            {ORIGENES.map((o) => <option key={o} value={o}>{ETIQUETA_ORIGEN[o]}</option>)}
          </Selector>
        </Campo>
        <Boton variante="secundario" type="submit">Filtrar</Boton>
        <Link className="text-sm text-marca-700 hover:underline" href="/contabilidad/asientos">Limpiar</Link>
      </form>

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
            <Tr><Td colSpan={5} className="py-8 text-center text-slate-500">No hay asientos que coincidan.</Td></Tr>
          )}
        </tbody>
      </Tabla>
    </div>
  )
}
```

- [ ] **Step 3: Detalle `/contabilidad/asientos/[id]` (líneas + link al origen + reversa)**

`apps/erp/componentes/boton-revertir.tsx` (espejo de `formulario-anular.tsx`):

```tsx
'use client'

import { useActionState, useState } from 'react'
import { Boton, Entrada } from '@suite/ui'
import type { EstadoAsiento } from '../app/contabilidad/asientos/acciones'

export function BotonRevertir({
  asientoId,
  accion,
}: {
  asientoId: string
  accion: (prev: EstadoAsiento, formData: FormData) => Promise<EstadoAsiento>
}) {
  const [abierto, setAbierto] = useState(false)
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoAsiento)
  if (!abierto) {
    return <Boton variante="peligro" type="button" onClick={() => setAbierto(true)}>Revertir asiento</Boton>
  }
  return (
    <form action={enviar} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="asiento_id" value={asientoId} />
      <Entrada name="glosa" placeholder="Motivo de la reversa *" required className="w-72" />
      <Boton variante="peligro" type="submit" disabled={pendiente}>{pendiente ? 'Revirtiendo…' : 'Confirmar reversa'}</Boton>
      <Boton variante="secundario" type="button" onClick={() => setAbierto(false)}>Cancelar</Boton>
      {estado.error && <span className="w-full text-sm text-red-600">{estado.error}</span>}
    </form>
  )
}
```

`apps/erp/app/contabilidad/asientos/[id]/page.tsx`:

```tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP } from '@suite/core'
import { Encabezado, Insignia, Tabla, Tarjeta, Td, Th, Tr } from '@suite/ui'
import { exigirContabilidad } from '../../../../lib/contabilidad-acceso'
import { BotonRevertir } from '../../../../componentes/boton-revertir'
import { ETIQUETA_ORIGEN, rutaOrigen } from '../../origenes'
import { revertirAsiento } from '../acciones'

export default async function DetalleAsiento({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const activa = await exigirContabilidad()
  const supabase = await crearClienteServidor()
  const { data: asiento } = await supabase
    .from('asientos')
    .select('id, numero, fecha, glosa, origen, referencia_id, reversa_de, asientos_lineas (id, debe, haber, glosa, cuentas_contables (codigo, nombre))')
    .eq('id', id).eq('empresa_id', activa.id).single()
  if (!asiento) notFound()

  // ¿Ya tiene una reversa? (a lo más una por asiento). Si el propio asiento es reversa
  // o ya fue revertido, no se ofrece revertir (el RPC igual lo bloquea).
  const { data: reversa } = await supabase
    .from('asientos')
    .select('id, numero')
    .eq('empresa_id', activa.id)
    .eq('reversa_de', asiento.id)
    .maybeSingle()

  const lineas = asiento.asientos_lineas ?? []
  const totalDebe = lineas.reduce((s: number, l: { debe: number }) => s + l.debe, 0)
  const totalHaber = lineas.reduce((s: number, l: { haber: number }) => s + l.haber, 0)
  const href = rutaOrigen(asiento.origen, asiento.referencia_id)
  const esReversa = asiento.origen === 'reversa'
  const revertible = !esReversa && !reversa

  return (
    <div>
      <Encabezado titulo={`Asiento N° ${asiento.numero}`}>
        <Insignia tono="gris">{ETIQUETA_ORIGEN[asiento.origen] ?? asiento.origen}</Insignia>
      </Encabezado>

      <Tarjeta className="mb-4 max-w-3xl">
        <p><strong>Fecha:</strong> {new Date(asiento.fecha + 'T00:00:00').toLocaleDateString('es-CL')}</p>
        <p className="mt-1"><strong>Glosa:</strong> {asiento.glosa}</p>
        {href && (
          <p className="mt-1"><Link className="text-marca-700 hover:underline" href={href}>Ver documento de origen</Link></p>
        )}
        {esReversa && asiento.reversa_de && (
          <p className="mt-1"><Link className="text-marca-700 hover:underline" href={`/contabilidad/asientos/${asiento.reversa_de}`}>Es la reversa del asiento original</Link></p>
        )}
        {reversa && (
          <p className="mt-1 text-sm text-amber-700">
            Revertido por el <Link className="underline" href={`/contabilidad/asientos/${reversa.id}`}>asiento N° {reversa.numero}</Link>.
          </p>
        )}
      </Tarjeta>

      <Tabla>
        <thead><tr><Th>Cuenta</Th><Th>Glosa</Th><Th className="text-right">Debe</Th><Th className="text-right">Haber</Th></tr></thead>
        <tbody>
          {lineas.map((l: { id: string; debe: number; haber: number; glosa: string | null; cuentas_contables: { codigo: string; nombre: string } | null }) => (
            <Tr key={l.id}>
              <Td className="font-mono">{l.cuentas_contables?.codigo} · {l.cuentas_contables?.nombre}</Td>
              <Td className="text-sm text-slate-500">{l.glosa ?? ''}</Td>
              <Td className="text-right font-mono">{l.debe ? formatearCLP(l.debe) : ''}</Td>
              <Td className="text-right font-mono">{l.haber ? formatearCLP(l.haber) : ''}</Td>
            </Tr>
          ))}
          <Tr>
            <Td className="font-semibold" colSpan={2}>Totales</Td>
            <Td className="text-right font-mono font-semibold">{formatearCLP(totalDebe)}</Td>
            <Td className="text-right font-mono font-semibold">{formatearCLP(totalHaber)}</Td>
          </Tr>
        </tbody>
      </Tabla>

      {revertible && (
        <Tarjeta className="mt-6 max-w-3xl">
          <h2 className="mb-1 text-lg font-semibold text-slate-800">Revertir</h2>
          <p className="mb-3 text-sm text-slate-600">
            Los asientos son inmutables: para corregir uno se crea su asiento inverso ligado. Un
            asiento se revierte a lo más una vez.
          </p>
          <BotonRevertir asientoId={asiento.id} accion={revertirAsiento} />
        </Tarjeta>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Nuevo asiento manual + form de cuadratura viva**

`apps/erp/app/contabilidad/asientos/nuevo/page.tsx`:

```tsx
import { crearClienteServidor } from '@suite/auth/server'
import { Encabezado } from '@suite/ui'
import { exigirContabilidad } from '../../../../lib/contabilidad-acceso'
import { FormularioAsiento } from '../../../../componentes/formulario-asiento'
import { crearAsiento } from '../acciones'

export default async function NuevoAsiento() {
  const activa = await exigirContabilidad()
  const supabase = await crearClienteServidor()
  // Solo cuentas hoja activas reciben líneas (acepta_movimientos = true).
  const { data: cuentas } = await supabase
    .from('cuentas_contables')
    .select('id, codigo, nombre')
    .eq('empresa_id', activa.id)
    .eq('acepta_movimientos', true)
    .eq('activa', true)
    .order('codigo')

  return (
    <div>
      <Encabezado titulo="Nuevo asiento manual" />
      <FormularioAsiento accion={crearAsiento} cuentas={cuentas ?? []} />
    </div>
  )
}
```

`apps/erp/componentes/formulario-asiento.tsx` (espejo de `formulario-cotizacion.tsx`: líneas en `useState`, hidden `JSON.stringify`, Σdebe/Σhaber vivos, submit deshabilitado si no cuadra; al escribir debe se pone haber en 0 y viceversa — impone en vivo "exactamente uno positivo"):

```tsx
'use client'

import { useActionState, useState } from 'react'
import { Boton, Campo, Entrada, Selector, Tabla, Tarjeta, Td, Th, Tr } from '@suite/ui'
import { formatearCLP } from '@suite/core'
import type { EstadoAsiento } from '../app/contabilidad/asientos/acciones'

interface CuentaOpcion { id: string; codigo: string; nombre: string }
interface LineaAsiento { cuentaId: string; glosa: string; debe: number; haber: number }

function hoy(): string {
  return new Date().toISOString().slice(0, 10)
}

const LINEA_VACIA: LineaAsiento = { cuentaId: '', glosa: '', debe: 0, haber: 0 }

export function FormularioAsiento({
  accion,
  cuentas,
}: {
  accion: (prev: EstadoAsiento, formData: FormData) => Promise<EstadoAsiento>
  cuentas: CuentaOpcion[]
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoAsiento)
  const [lineas, setLineas] = useState<LineaAsiento[]>([{ ...LINEA_VACIA }, { ...LINEA_VACIA }])

  function agregar() {
    setLineas((ls) => [...ls, { ...LINEA_VACIA }])
  }
  function quitar(i: number) {
    setLineas((ls) => (ls.length <= 2 ? ls : ls.filter((_, j) => j !== i)))
  }
  function set(i: number, campo: Partial<LineaAsiento>) {
    setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, ...campo } : l)))
  }
  function entero(valor: string): number {
    return Math.max(0, Math.trunc(Number(valor)) || 0)
  }

  const totalDebe = lineas.reduce((s, l) => s + (l.debe || 0), 0)
  const totalHaber = lineas.reduce((s, l) => s + (l.haber || 0), 0)
  const cuadra = totalDebe === totalHaber && totalDebe > 0
  const completas = lineas.every((l) => l.cuentaId !== '' && (l.debe > 0) !== (l.haber > 0))

  return (
    <form action={enviar}>
      <input type="hidden" name="lineas" value={JSON.stringify(lineas)} />
      <Tarjeta className="mb-4 max-w-3xl">
        <div className="flex flex-wrap items-end gap-3">
          <Campo etiqueta="Fecha *"><Entrada type="date" name="fecha" required defaultValue={hoy()} /></Campo>
          <Campo etiqueta="Glosa *"><Entrada name="glosa" required placeholder="Descripción del asiento" className="w-80" /></Campo>
        </div>
      </Tarjeta>

      <Tabla>
        <thead>
          <tr><Th>Cuenta</Th><Th>Glosa</Th><Th className="text-right">Debe</Th><Th className="text-right">Haber</Th><Th /></tr>
        </thead>
        <tbody>
          {lineas.map((l, i) => (
            <Tr key={i}>
              <Td>
                <Selector value={l.cuentaId} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => set(i, { cuentaId: e.currentTarget.value })} className="min-w-[16rem]">
                  <option value="" disabled>Selecciona…</option>
                  {cuentas.map((c) => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
                </Selector>
              </Td>
              <Td>
                <Entrada value={l.glosa} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set(i, { glosa: e.currentTarget.value })} placeholder="Opcional" />
              </Td>
              <Td className="text-right">
                <Entrada type="number" min={0} value={l.debe} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set(i, { debe: entero(e.currentTarget.value), haber: 0 })} className="w-28 text-right" />
              </Td>
              <Td className="text-right">
                <Entrada type="number" min={0} value={l.haber} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set(i, { haber: entero(e.currentTarget.value), debe: 0 })} className="w-28 text-right" />
              </Td>
              <Td><Boton variante="secundario" type="button" className="px-2 py-1 text-xs" onClick={() => quitar(i)} disabled={lineas.length <= 2}>Quitar</Boton></Td>
            </Tr>
          ))}
        </tbody>
      </Tabla>

      <div className="mt-3 flex items-center justify-between">
        <Boton variante="secundario" type="button" onClick={agregar}>Agregar línea</Boton>
        <div className="flex gap-6 text-sm">
          <span>Debe: <strong className="font-mono">{formatearCLP(totalDebe)}</strong></span>
          <span>Haber: <strong className="font-mono">{formatearCLP(totalHaber)}</strong></span>
          <span className={cuadra ? 'text-green-700' : 'text-red-600'}>
            {cuadra ? 'Cuadrado' : `Descuadre: ${formatearCLP(Math.abs(totalDebe - totalHaber))}`}
          </span>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2">
        {estado.error && <span className="mr-auto text-sm text-red-600">{estado.error}</span>}
        <Boton type="submit" disabled={pendiente || !cuadra || !completas}>{pendiente ? 'Guardando…' : 'Guardar asiento'}</Boton>
      </div>
    </form>
  )
}
```

- [ ] **Step 5: Trazabilidad en el detalle de venta (`ventas/[id]`)**

En `apps/erp/app/ventas/[id]/page.tsx`:

(a) Agregar `import Link from 'next/link'` como PRIMERA línea (antes de `import { notFound } from 'next/navigation'`).

(b) Tras `if (!doc) notFound()`, agregar la query del asiento:

```ts
  // Asiento contable del documento (si el módulo está activo y el rol lo ve — la RLS por
  // rol devuelve 0 filas al resto). venta y nota_credito comparten referencia_id = doc.id.
  const { data: asiento } = await supabase
    .from('asientos')
    .select('id, numero')
    .eq('empresa_id', activa.id)
    .in('origen', ['venta', 'nota_credito'])
    .eq('referencia_id', doc.id)
    .maybeSingle()
```

(c) En la `<Tarjeta>` del cliente, añadir la línea del asiento tras la del `error_emision`. Reemplazar:

```tsx
      <Tarjeta className="mb-4 max-w-3xl">
        <p><strong>Cliente:</strong> {doc.clientes?.razon_social} ({doc.clientes && formatearRut(doc.clientes.rut)})</p>
        {doc.error_emision && <p className="mt-2 text-sm text-amber-700">Último error: {doc.error_emision}</p>}
      </Tarjeta>
```

por:

```tsx
      <Tarjeta className="mb-4 max-w-3xl">
        <p><strong>Cliente:</strong> {doc.clientes?.razon_social} ({doc.clientes && formatearRut(doc.clientes.rut)})</p>
        {doc.error_emision && <p className="mt-2 text-sm text-amber-700">Último error: {doc.error_emision}</p>}
        {asiento && (
          <p className="mt-2 text-sm text-slate-600">
            Asiento contable: <Link className="text-marca-700 hover:underline" href={`/contabilidad/asientos/${asiento.id}`}>N° {asiento.numero}</Link>
          </p>
        )}
      </Tarjeta>
```

- [ ] **Step 6: Trazabilidad en la lista de pagos (`cobranza/pagos`)**

En `apps/erp/app/cobranza/pagos/page.tsx`:

(a) Agregar `import Link from 'next/link'` como PRIMERA línea (antes de `import { crearClienteServidor } from '@suite/auth/server'`).

(b) Tras el `const { data: pagos } = ...` (cerrado en `.limit(100)`), agregar el batch de asientos por pago:

```ts
  const ids = (pagos ?? []).map((p) => p.id)
  const { data: asientos } = ids.length
    ? await supabase.from('asientos').select('id, numero, referencia_id').eq('empresa_id', activa.id).eq('origen', 'pago').in('referencia_id', ids)
    : { data: [] as { id: string; numero: number; referencia_id: string | null }[] }
  const asientoPorPago = new Map((asientos ?? []).map((a) => [a.referencia_id, a] as const))
```

(c) En el `<thead>`, insertar `<Th>Asiento</Th>` antes del `<Th />` final. Reemplazar:

```tsx
        <thead><tr><Th>Fecha</Th><Th>Cliente</Th><Th>Método</Th><Th className="text-right">Monto</Th><Th>Aplicado a</Th><Th>Estado</Th><Th /></tr></thead>
```

por:

```tsx
        <thead><tr><Th>Fecha</Th><Th>Cliente</Th><Th>Método</Th><Th className="text-right">Monto</Th><Th>Aplicado a</Th><Th>Estado</Th><Th>Asiento</Th><Th /></tr></thead>
```

(d) En cada fila, insertar la celda del asiento tras la de Estado (antes de la `<Td>` de anular). Reemplazar:

```tsx
              <Td>{p.estado === 'activo' ? <Insignia tono="verde">Activo</Insignia> : <Insignia tono="rojo">Anulado</Insignia>}</Td>
              <Td>{p.estado === 'activo' ? <FormularioAnular pagoId={p.id} /> : <span className="text-xs text-slate-400">{p.motivo_anulacion}</span>}</Td>
```

por:

```tsx
              <Td>{p.estado === 'activo' ? <Insignia tono="verde">Activo</Insignia> : <Insignia tono="rojo">Anulado</Insignia>}</Td>
              <Td className="text-sm">
                {asientoPorPago.has(p.id)
                  ? <Link className="text-marca-700 hover:underline" href={`/contabilidad/asientos/${asientoPorPago.get(p.id)!.id}`}>N° {asientoPorPago.get(p.id)!.numero}</Link>
                  : <span className="text-slate-400">—</span>}
              </Td>
              <Td>{p.estado === 'activo' ? <FormularioAnular pagoId={p.id} /> : <span className="text-xs text-slate-400">{p.motivo_anulacion}</span>}</Td>
```

(e) Ajustar el `colSpan` de la fila vacía de 7 a 8. Reemplazar:

```tsx
          {(pagos ?? []).length === 0 && <Tr><Td colSpan={7} className="py-8 text-center text-slate-500">No hay pagos registrados.</Td></Tr>}
```

por:

```tsx
          {(pagos ?? []).length === 0 && <Tr><Td colSpan={8} className="py-8 text-center text-slate-500">No hay pagos registrados.</Td></Tr>}
```

- [ ] **Step 7: Verificar (build 3 apps + type-check + byte-scan)**

Run: `pnpm --filter erp exec tsc --noEmit` → sin errores (referencia `crear_asiento`/`revertir_asiento` y las tablas `asientos`/`asientos_lineas`/`cuentas_contables` de los tipos regenerados; `Json` de `@suite/db`).
Run: `pnpm build --concurrency=1` → 3 apps compilan. OJO: el build pisa el `.next` de los dev servers → reiniciar `pnpm --filter erp dev` antes del click-through.

Prueba en vivo (dev server, demo `demo@suite-erp.cl` / `demo1234` con contabilidad activa — resembrar si la demo venció):
- `/contabilidad/asientos/nuevo`: agregar 2 líneas descuadradas → botón "Guardar asiento" deshabilitado y el marcador muestra "Descuadre: $…"; equilibrar debe = haber con cuentas hoja distintas → se habilita → guardar redirige al detalle con las líneas.
- Detalle del asiento manual → "Revertir asiento" con glosa → crea la reversa ligada (origen Reversa) y el original muestra "Revertido por el asiento N°…".
- `/ventas/{factura emitida}`: aparece "Asiento contable: N°X" que enlaza al detalle; ese detalle enlaza de vuelta con "Ver documento de origen".
- `/cobranza/pagos`: la columna Asiento enlaza el asiento de cada pago activo contabilizado.

Byte-scan (JAMÁS BOM U+FEFF; sin coincidencias / exit 1 = pass):

```
grep -lc $'\xEF\xBB\xBF' apps/erp/app/contabilidad/asientos/page.tsx apps/erp/app/contabilidad/asientos/acciones.ts apps/erp/app/contabilidad/asientos/[id]/page.tsx apps/erp/componentes/boton-revertir.tsx apps/erp/app/contabilidad/asientos/nuevo/page.tsx apps/erp/componentes/formulario-asiento.tsx apps/erp/app/ventas/[id]/page.tsx apps/erp/app/cobranza/pagos/page.tsx
```

→ ninguna línea impresa (exit 1) = pass.

- [ ] **Step 8: Commit**

```bash
git add apps/erp/app/contabilidad/asientos apps/erp/componentes/boton-revertir.tsx apps/erp/componentes/formulario-asiento.tsx apps/erp/app/ventas/[id]/page.tsx apps/erp/app/cobranza/pagos/page.tsx
git commit -m "feat(erp): asientos — manual con cuadratura viva, detalle, reversa y trazabilidad"
```

---

### Task 8: Libro diario + libro mayor + exports CSV

**Files:**
- Create: `apps/erp/app/contabilidad/diario/page.tsx`
- Create: `apps/erp/app/contabilidad/diario/export/route.ts`
- Create: `apps/erp/app/contabilidad/mayor/page.tsx`
- Create: `apps/erp/app/contabilidad/mayor/export/route.ts`

**Interfaces:**
- Consumes: `obtenerEmpresaActiva()` / `EmpresaResumen` (apps/erp/lib/empresa-activa.ts) — YA con `modulo_contabilidad` Y `rol` (`string | null`), que la task de layout/NAV agregó a la interfaz y a `obtenerEmpresas` (part-0, constraint UI: "agregar `modulo_contabilidad` a `EmpresaResumen`" + el rol del usuario); el guard de rol REUSA `activa.rol` — sin re-consultar `miembros`; `crearClienteServidor()` (`@suite/auth/server`); `filasACsv` + `rangoDeMes` + `formatearCLP` (`@suite/core`); tablas `asientos` (`id, numero, fecha, glosa, origen, empresa_id`), `asientos_lineas` (`debe, haber, glosa, cuenta_id` — FK compuesta a `asientos` y a `cuentas_contables`) y `cuentas_contables` (`id, codigo, nombre, acepta_movimientos, activa`) de la migración 0022 (Tasks 1-2), con RLS **select por rol** dueno/admin/contador (un vendedor lee 0 filas por RLS, y además el guard lo corta antes). El rol del guard sale de `EmpresaResumen.rol` (part-0 lo lee de `miembros` en UNA query por org, estado activo) — las 4 pantallas NO re-consultan `miembros`.
- Produces: las 2 páginas de libros (`/contabilidad/diario`, `/contabilidad/mayor`) y sus 2 routes de export CSV. Las consume la NAV de contabilidad (link desde el resumen/`/contabilidad`, task de UI) — Task 8 solo agrega las rutas; el link en la NAV lo pone la task de UI.
- ESPEJOS leídos antes de escribir: `apps/erp/app/reportes/libro-ventas/page.tsx` + `.../export/route.ts` (estructura de libro: filtro por rango, `<Tabla>`, totales, `filasACsv`, headers `Content-Disposition`); `apps/erp/app/reportes/rentabilidad/export/route.ts` (**lección P12**: el route repite el guard de módulo de la página — 404 si el módulo está apagado — NUNCA un CSV vacío); `apps/erp/app/combustible/importar.ts` y `apps/erp/app/configuracion/suscripcion/page.tsx` (guard de rol REAL del repo — contexto de por qué `app.tiene_rol_en_empresa` vive en el schema `app`, que el Data API no expone y NO se llama por `.rpc()`; aquí el rol NO se re-consulta: sale de `EmpresaResumen.rol`, que part-0 ya derivó de `miembros`); `apps/erp/app/ventas/[id]/page.tsx` (embed anidado con FK compuesta: `documentos_venta_lineas (...)` → aquí `asientos_lineas ( ..., cuentas_contables ( codigo, nombre ) )`).
- Guard de módulo Y rol en PARIDAD página/route (spec §6, lección P12): la página hace `notFound()` si el módulo está apagado o el rol no es dueno/admin/contador (un vendedor que teclea la URL recibe 404, no la existencia); el route de export repite EL MISMO corte y devuelve **404** (módulo apagado, paridad con el `notFound()`) o **403** (rol sin permiso) — jamás un CSV vacío. El guard va inline en los 4 archivos (módulo + rol), reusando `activa.rol` de `EmpresaResumen` (sin re-query a `miembros`): 404 módulo / 403 rol en los routes, `notFound()` en las páginas.

- [ ] **Step 1: Libro diario — página**

`apps/erp/app/contabilidad/diario/page.tsx`:

```tsx
import { Fragment } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP, rangoDeMes } from '@suite/core'
import { Boton, Encabezado, Entrada, Insignia, Tabla, Td, Th, Tr } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { ETIQUETA_ORIGEN } from '../origenes'

interface Linea {
  debe: number
  haber: number
  glosa: string | null
  cuentas_contables: { codigo: string; nombre: string } | null
}
interface Asiento {
  id: string
  numero: number
  fecha: string
  glosa: string
  origen: string
  asientos_lineas: Linea[]
}

export default async function PaginaLibroDiario({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string }>
}) {
  const { desde: qDesde, hasta: qHasta } = await searchParams
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  if (!activa.modulo_contabilidad) notFound()
  // Guard de rol (paridad con el route de export — lección P12): contabilidad es
  // dueno/admin/contador. El rol YA viene en EmpresaResumen (la task de UI lo agregó,
  // leyéndolo de miembros por org con estado activo) — se reusa sin re-consultar.
  if (!activa.rol || !['dueno', 'admin', 'contador'].includes(activa.rol)) notFound()

  const supabase = await crearClienteServidor()

  // Rango por defecto: el mes actual (mismo helper que libro-ventas). Los inputs date
  // dejan al contador elegir cualquier rango; formato inválido → vuelve al mes.
  const base = rangoDeMes(new Date().toISOString().slice(0, 7))!
  const desde = qDesde && /^\d{4}-\d{2}-\d{2}$/.test(qDesde) ? qDesde : base.desde
  const hasta = qHasta && /^\d{4}-\d{2}-\d{2}$/.test(qHasta) ? qHasta : base.hasta

  const { data } = await supabase
    .from('asientos')
    .select('id, numero, fecha, glosa, origen, asientos_lineas (debe, haber, glosa, cuentas_contables (codigo, nombre))')
    .eq('empresa_id', activa.id)
    .gte('fecha', desde)
    .lte('fecha', hasta)
    .order('fecha')
    .order('numero')
  const asientos = (data ?? []) as Asiento[]
  const tot = asientos.reduce(
    (a, x) => {
      for (const l of x.asientos_lineas) {
        a.debe += l.debe
        a.haber += l.haber
      }
      return a
    },
    { debe: 0, haber: 0 }
  )

  return (
    <div>
      <Encabezado titulo="Libro diario">
        <Link href={`/contabilidad/diario/export?desde=${desde}&hasta=${hasta}`}>
          <Boton variante="secundario">Exportar CSV</Boton>
        </Link>
      </Encabezado>
      <form className="mb-4 flex flex-wrap items-end gap-3" action="/contabilidad/diario" method="get">
        <label className="text-sm text-slate-600">Desde<Entrada type="date" name="desde" defaultValue={desde} className="mt-1 w-44" /></label>
        <label className="text-sm text-slate-600">Hasta<Entrada type="date" name="hasta" defaultValue={hasta} className="mt-1 w-44" /></label>
        <Boton variante="secundario" type="submit">Ver período</Boton>
      </form>
      <Tabla>
        <thead>
          <tr><Th>Fecha</Th><Th>N°</Th><Th>Cuenta</Th><Th className="text-right">Debe</Th><Th className="text-right">Haber</Th></tr>
        </thead>
        <tbody>
          {asientos.map((a) => {
            // Debe primero, luego haber (lectura contable clásica).
            const lineas = [...a.asientos_lineas].sort((x, y) => (x.debe > 0 ? 0 : 1) - (y.debe > 0 ? 0 : 1))
            return (
              <Fragment key={a.id}>
                <Tr className="bg-slate-50">
                  <Td>{new Date(a.fecha + 'T00:00:00').toLocaleDateString('es-CL')}</Td>
                  <Td className="font-mono">{a.numero}</Td>
                  <Td colSpan={3}>
                    <span className="font-medium text-slate-700">{a.glosa}</span>{' '}
                    <Insignia tono="gris">{ETIQUETA_ORIGEN[a.origen] ?? a.origen}</Insignia>
                  </Td>
                </Tr>
                {lineas.map((l, i) => (
                  <Tr key={i}>
                    <Td />
                    <Td />
                    <Td>
                      <span className="font-mono">{l.cuentas_contables?.codigo ?? '—'}</span>{' '}
                      {l.cuentas_contables?.nombre ?? ''}
                      {l.glosa ? <span className="text-slate-400"> · {l.glosa}</span> : null}
                    </Td>
                    <Td className="text-right font-mono">{l.debe ? formatearCLP(l.debe) : ''}</Td>
                    <Td className="text-right font-mono">{l.haber ? formatearCLP(l.haber) : ''}</Td>
                  </Tr>
                ))}
              </Fragment>
            )
          })}
          {asientos.length === 0 && (
            <Tr><Td colSpan={5} className="py-8 text-center text-slate-500">Sin asientos entre {desde} y {hasta}.</Td></Tr>
          )}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-slate-300 font-semibold">
            <Td colSpan={3} className="text-right">Totales del período</Td>
            <Td className="text-right font-mono">{formatearCLP(tot.debe)}</Td>
            <Td className="text-right font-mono">{formatearCLP(tot.haber)}</Td>
          </tr>
        </tfoot>
      </Tabla>
      <p className="mt-2 text-right text-sm text-slate-500">
        {tot.debe === tot.haber ? 'Debe = Haber ✓' : 'Descuadre detectado'}
      </p>
    </div>
  )
}
```

- [ ] **Step 2: Libro diario — route de export**

`apps/erp/app/contabilidad/diario/export/route.ts`:

```ts
import { crearClienteServidor } from '@suite/auth/server'
import { filasACsv, rangoDeMes } from '@suite/core'
import { obtenerEmpresaActiva } from '../../../../lib/empresa-activa'
import { ETIQUETA_ORIGEN } from '../../origenes'

interface Linea {
  debe: number
  haber: number
  glosa: string | null
  cuentas_contables: { codigo: string; nombre: string } | null
}
interface Asiento {
  numero: number
  fecha: string
  glosa: string
  origen: string
  asientos_lineas: Linea[]
}

export async function GET(req: Request) {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return new Response('No autorizado', { status: 401 })
  // Paridad con la página: módulo apagado → 404 (misma condición que su notFound()).
  if (!activa.modulo_contabilidad) return new Response('No encontrado', { status: 404 })
  // Guard de rol EXPLÍCITO (lección P12): rol sin permiso → 403, jamás un CSV vacío.
  // El rol YA viene en EmpresaResumen (task de UI) — se reusa sin re-consultar miembros.
  if (!activa.rol || !['dueno', 'admin', 'contador'].includes(activa.rol)) {
    return new Response('No autorizado', { status: 403 })
  }

  const supabase = await crearClienteServidor()
  const url = new URL(req.url)
  const base = rangoDeMes(new Date().toISOString().slice(0, 7))!
  const qDesde = url.searchParams.get('desde')
  const qHasta = url.searchParams.get('hasta')
  const desde = qDesde && /^\d{4}-\d{2}-\d{2}$/.test(qDesde) ? qDesde : base.desde
  const hasta = qHasta && /^\d{4}-\d{2}-\d{2}$/.test(qHasta) ? qHasta : base.hasta

  const { data, error } = await supabase
    .from('asientos')
    .select('numero, fecha, glosa, origen, asientos_lineas (debe, haber, glosa, cuentas_contables (codigo, nombre))')
    .eq('empresa_id', activa.id)
    .gte('fecha', desde)
    .lte('fecha', hasta)
    .order('fecha')
    .order('numero')
  if (error) return new Response('No se pudo generar el libro', { status: 500 })
  const asientos = (data ?? []) as Asiento[]
  const filas: (string | number | null)[][] = []
  for (const a of asientos) {
    const lineas = [...a.asientos_lineas].sort((x, y) => (x.debe > 0 ? 0 : 1) - (y.debe > 0 ? 0 : 1))
    for (const l of lineas) {
      filas.push([
        a.fecha,
        a.numero,
        ETIQUETA_ORIGEN[a.origen] ?? a.origen,
        l.cuentas_contables?.codigo ?? '',
        l.cuentas_contables?.nombre ?? '',
        l.glosa ?? a.glosa,
        l.debe,
        l.haber,
      ])
    }
  }
  const csv = filasACsv(['Fecha', 'N° asiento', 'Origen', 'Código', 'Cuenta', 'Glosa', 'Debe', 'Haber'], filas)
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="libro-diario-${desde}_${hasta}.csv"`,
    },
  })
}
```

- [ ] **Step 3: Libro mayor — página**

`apps/erp/app/contabilidad/mayor/page.tsx`:

```tsx
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP, rangoDeMes } from '@suite/core'
import { Boton, Encabezado, Entrada, Selector, Tabla, Td, Th, Tr } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'

interface LineaMayor {
  debe: number
  haber: number
  glosa: string | null
}
interface AsientoMayor {
  numero: number
  fecha: string
  glosa: string
  asientos_lineas: LineaMayor[]
}

export default async function PaginaLibroMayor({
  searchParams,
}: {
  searchParams: Promise<{ cuenta?: string; desde?: string; hasta?: string }>
}) {
  const { cuenta: qCuenta, desde: qDesde, hasta: qHasta } = await searchParams
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  if (!activa.modulo_contabilidad) notFound()
  // Guard de rol (paridad con el route de export — lección P12): dueno/admin/contador.
  // El rol YA viene en EmpresaResumen (task de UI) — se reusa sin re-consultar miembros.
  if (!activa.rol || !['dueno', 'admin', 'contador'].includes(activa.rol)) notFound()

  const supabase = await crearClienteServidor()

  const base = rangoDeMes(new Date().toISOString().slice(0, 7))!
  const desde = qDesde && /^\d{4}-\d{2}-\d{2}$/.test(qDesde) ? qDesde : base.desde
  const hasta = qHasta && /^\d{4}-\d{2}-\d{2}$/.test(qHasta) ? qHasta : base.hasta

  // Solo cuentas hoja (reciben líneas). Se incluyen las inactivas: pueden tener
  // movimientos históricos que el mayor debe poder mostrar.
  const { data: cuentas } = await supabase
    .from('cuentas_contables')
    .select('id, codigo, nombre, activa')
    .eq('empresa_id', activa.id)
    .eq('acepta_movimientos', true)
    .order('codigo')
  const hojas = cuentas ?? []
  const cuentaId = qCuenta && hojas.some((c) => c.id === qCuenta) ? qCuenta : ''
  const cuentaSel = hojas.find((c) => c.id === cuentaId) ?? null

  let saldoInicial = 0
  let movimientos: { fecha: string; numero: number; glosa: string; debe: number; haber: number }[] = []
  if (cuentaId) {
    // Saldo inicial: acumulado (debe - haber) de la cuenta ANTES del período.
    const { data: previos } = await supabase
      .from('asientos')
      .select('asientos_lineas!inner (debe, haber, cuenta_id)')
      .eq('empresa_id', activa.id)
      .eq('asientos_lineas.cuenta_id', cuentaId)
      .lt('fecha', desde)
    for (const a of (previos ?? []) as { asientos_lineas: LineaMayor[] }[]) {
      for (const l of a.asientos_lineas) saldoInicial += l.debe - l.haber
    }
    // Movimientos del período: cada asiento aporta SOLO sus líneas de esta cuenta
    // (inner join filtrado). Orden por fecha, luego correlativo.
    const { data } = await supabase
      .from('asientos')
      .select('numero, fecha, glosa, asientos_lineas!inner (debe, haber, glosa, cuenta_id)')
      .eq('empresa_id', activa.id)
      .eq('asientos_lineas.cuenta_id', cuentaId)
      .gte('fecha', desde)
      .lte('fecha', hasta)
      .order('fecha')
      .order('numero')
    for (const a of (data ?? []) as AsientoMayor[]) {
      for (const l of a.asientos_lineas) {
        movimientos.push({ fecha: a.fecha, numero: a.numero, glosa: l.glosa ?? a.glosa, debe: l.debe, haber: l.haber })
      }
    }
  }

  const totDebe = movimientos.reduce((a, m) => a + m.debe, 0)
  const totHaber = movimientos.reduce((a, m) => a + m.haber, 0)
  const saldoFinal = saldoInicial + totDebe - totHaber
  let corriente = saldoInicial

  const qs = new URLSearchParams({ cuenta: cuentaId, desde, hasta }).toString()

  return (
    <div>
      <Encabezado titulo="Libro mayor">
        {cuentaId && (
          <Link href={`/contabilidad/mayor/export?${qs}`}>
            <Boton variante="secundario">Exportar CSV</Boton>
          </Link>
        )}
      </Encabezado>
      <form className="mb-4 flex flex-wrap items-end gap-3" action="/contabilidad/mayor" method="get">
        <label className="text-sm text-slate-600">
          Cuenta
          <Selector name="cuenta" defaultValue={cuentaId} className="mt-1 w-96">
            <option value="">Elige una cuenta…</option>
            {hojas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.codigo} — {c.nombre}{c.activa ? '' : ' (inactiva)'}
              </option>
            ))}
          </Selector>
        </label>
        <label className="text-sm text-slate-600">Desde<Entrada type="date" name="desde" defaultValue={desde} className="mt-1 w-44" /></label>
        <label className="text-sm text-slate-600">Hasta<Entrada type="date" name="hasta" defaultValue={hasta} className="mt-1 w-44" /></label>
        <Boton variante="secundario" type="submit">Ver mayor</Boton>
      </form>
      {!cuentaSel ? (
        <p className="text-slate-500">Elige una cuenta para ver su mayor.</p>
      ) : (
        <>
          <h2 className="mb-3 text-lg font-semibold text-slate-800">{cuentaSel.codigo} — {cuentaSel.nombre}</h2>
          <Tabla>
            <thead>
              <tr><Th>Fecha</Th><Th>N°</Th><Th>Glosa</Th><Th className="text-right">Debe</Th><Th className="text-right">Haber</Th><Th className="text-right">Saldo</Th></tr>
            </thead>
            <tbody>
              <Tr className="bg-slate-50">
                <Td colSpan={5} className="text-right font-medium text-slate-600">Saldo inicial</Td>
                <Td className="text-right font-mono">{formatearCLP(saldoInicial)}</Td>
              </Tr>
              {movimientos.map((m, i) => {
                corriente += m.debe - m.haber
                return (
                  <Tr key={i}>
                    <Td>{new Date(m.fecha + 'T00:00:00').toLocaleDateString('es-CL')}</Td>
                    <Td className="font-mono">{m.numero}</Td>
                    <Td>{m.glosa}</Td>
                    <Td className="text-right font-mono">{m.debe ? formatearCLP(m.debe) : ''}</Td>
                    <Td className="text-right font-mono">{m.haber ? formatearCLP(m.haber) : ''}</Td>
                    <Td className="text-right font-mono">{formatearCLP(corriente)}</Td>
                  </Tr>
                )
              })}
              {movimientos.length === 0 && (
                <Tr><Td colSpan={6} className="py-8 text-center text-slate-500">Sin movimientos entre {desde} y {hasta}.</Td></Tr>
              )}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-300 font-semibold">
                <Td colSpan={3} className="text-right">Totales del período</Td>
                <Td className="text-right font-mono">{formatearCLP(totDebe)}</Td>
                <Td className="text-right font-mono">{formatearCLP(totHaber)}</Td>
                <Td className="text-right font-mono">{formatearCLP(saldoFinal)}</Td>
              </tr>
            </tfoot>
          </Tabla>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Libro mayor — route de export**

`apps/erp/app/contabilidad/mayor/export/route.ts`:

```ts
import { crearClienteServidor } from '@suite/auth/server'
import { filasACsv, rangoDeMes } from '@suite/core'
import { obtenerEmpresaActiva } from '../../../../lib/empresa-activa'

interface LineaMayor {
  debe: number
  haber: number
  glosa: string | null
}
interface AsientoMayor {
  numero: number
  fecha: string
  glosa: string
  asientos_lineas: LineaMayor[]
}

export async function GET(req: Request) {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return new Response('No autorizado', { status: 401 })
  if (!activa.modulo_contabilidad) return new Response('No encontrado', { status: 404 })
  // Guard de rol EXPLÍCITO (lección P12): rol sin permiso → 403, jamás un CSV vacío.
  // El rol YA viene en EmpresaResumen (task de UI) — se reusa sin re-consultar miembros.
  if (!activa.rol || !['dueno', 'admin', 'contador'].includes(activa.rol)) {
    return new Response('No autorizado', { status: 403 })
  }

  const supabase = await crearClienteServidor()
  const url = new URL(req.url)
  const cuentaId = url.searchParams.get('cuenta')
  if (!cuentaId) return new Response('Falta la cuenta (use ?cuenta=<id>)', { status: 400 })
  // La cuenta debe pertenecer a la empresa (RLS ya lo cubre; el chequeo evita un CSV
  // vacío silencioso cuando el id es de otra empresa).
  const { data: cuenta } = await supabase
    .from('cuentas_contables')
    .select('codigo, nombre')
    .eq('empresa_id', activa.id)
    .eq('id', cuentaId)
    .maybeSingle()
  if (!cuenta) return new Response('Cuenta no encontrada', { status: 404 })

  const base = rangoDeMes(new Date().toISOString().slice(0, 7))!
  const qDesde = url.searchParams.get('desde')
  const qHasta = url.searchParams.get('hasta')
  const desde = qDesde && /^\d{4}-\d{2}-\d{2}$/.test(qDesde) ? qDesde : base.desde
  const hasta = qHasta && /^\d{4}-\d{2}-\d{2}$/.test(qHasta) ? qHasta : base.hasta

  const { data: previos } = await supabase
    .from('asientos')
    .select('asientos_lineas!inner (debe, haber, cuenta_id)')
    .eq('empresa_id', activa.id)
    .eq('asientos_lineas.cuenta_id', cuentaId)
    .lt('fecha', desde)
  let saldoInicial = 0
  for (const a of (previos ?? []) as { asientos_lineas: LineaMayor[] }[]) {
    for (const l of a.asientos_lineas) saldoInicial += l.debe - l.haber
  }

  const { data, error } = await supabase
    .from('asientos')
    .select('numero, fecha, glosa, asientos_lineas!inner (debe, haber, glosa, cuenta_id)')
    .eq('empresa_id', activa.id)
    .eq('asientos_lineas.cuenta_id', cuentaId)
    .gte('fecha', desde)
    .lte('fecha', hasta)
    .order('fecha')
    .order('numero')
  if (error) return new Response('No se pudo generar el mayor', { status: 500 })

  let corriente = saldoInicial
  const filas: (string | number | null)[][] = [['', '', 'Saldo inicial', null, null, saldoInicial]]
  for (const a of (data ?? []) as AsientoMayor[]) {
    for (const l of a.asientos_lineas) {
      corriente += l.debe - l.haber
      filas.push([a.fecha, a.numero, l.glosa ?? a.glosa, l.debe, l.haber, corriente])
    }
  }
  const csv = filasACsv(['Fecha', 'N° asiento', 'Glosa', 'Debe', 'Haber', 'Saldo acumulado'], filas)
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="libro-mayor-${cuenta.codigo}-${desde}_${hasta}.csv"`,
    },
  })
}
```

- [ ] **Step 5: Verificar**

Run: `pnpm build --concurrency=1` → **3 apps** compilan (las 4 rutas nuevas tipan contra `@suite/db` regenerado en la task de tipos; `asientos`/`asientos_lineas`/`cuentas_contables` y el embed anidado existen).

Reiniciar `pnpm --filter erp dev` (el build pisa el `.next` del dev server). Smoke manual mínimo (se detalla en el checklist de la Task 10, ítems 6-8): `/contabilidad/diario` y `/contabilidad/mayor` cargan como dueño; el export CSV descarga; un vendedor recibe 404 en la página Y 403 en el route de export.

Byte-scan de los 4 archivos creados (JAMÁS BOM U+FEFF; salida vacía / exit 1 = pass):

```
grep -rc $'\xEF\xBB\xBF' apps/erp/app/contabilidad/diario apps/erp/app/contabilidad/mayor
```

→ cada archivo imprime `0`; el comando sale con status 1 (sin coincidencias = pass).

- [ ] **Step 6: Commit**

```bash
git add apps/erp/app/contabilidad/diario apps/erp/app/contabilidad/mayor
git commit -m "feat(erp): libro diario y mayor con export CSV"
```

---

### Task 9: Seed demo — la demo nace con contabilidad activada

**Files:**
- Modify: `scripts/seed-demo.mjs`

**Interfaces:**
- Consumes (ya vivos en el script, no se re-crean): `userCli` (cliente ANON logueado como el DUEÑO demo `demo@suite-erp.cl`, firmado en el paso 2), `admin` (service_role), `orgId`/`empresaId` (empresa demo), `die(msg, err)`; las RPCs `activar_contabilidad(p_empresa)` (dueno/admin) y `contabilizar_pendientes(p_empresa) returns jsonb {creados}` (dueno/admin/contador) de la migración 0022; tablas `asientos`/`asientos_lineas` (para el conteo del RESUMEN).
- Produces: la empresa demo con `modulo_contabilidad = true` y TODO su histórico sembrado ya contabilizado (ventas/NC/compras/pagos/anticipos → asientos con `Σdebe = Σhaber`); el aviso `✓ contabilidad activada (N asientos)`; una línea `asientos contables:` en el RESUMEN. La **2ª organización** (`Comercial Ficticia SpA`, sección 18) queda **SIN activar** — muestra el gating del módulo en la demo.
- ESPEJO leído antes de escribir: `scripts/seed-demo.mjs` sección 17 (patrón `userCli.rpc(...)` para una RPC authenticated del dueño, luego `admin.from(...).select(count)` para leer un agregado) y el bloque `// ----- Resumen de conteos -----` (helper `cuenta(tabla)`). Regla del spec §7: se activa **VÍA `userCli`** (el dueño), NUNCA el admin client — `activar_contabilidad`/`contabilizar_pendientes` son `authenticated`; `service_role` daría **42501**. El seed no ejercita la rama pago-con-`anticipo_id` (aplicación de anticipo) — esa queda cubierta por pgTAP y el checklist (Task 10).

- [ ] **Step 1: Agregar la sección de contabilidad (antes del RESUMEN)**

En `scripts/seed-demo.mjs`, insertar el bloque nuevo JUSTO ANTES de la línea `// ----- Resumen de conteos -----` (queda como la última sección de siembra, tras los correos de la sección 19):

```js
// 20) Contabilidad: la demo NACE con el módulo activo y el histórico contabilizado.
//     VÍA userCli (el dueño): activar_contabilidad + contabilizar_pendientes son RPCs
//     authenticated — el admin client (service_role) daría 42501. activar siembra el
//     catálogo pyme chileno; contabilizar_pendientes recorre en orden de fecha todo lo
//     contabilizable (ventas/NC/compras/pagos/anticipos) y crea sus asientos cuadrados.
//     La 2da org (sección 18) queda SIN activar → muestra el gating del módulo.
const { error: eActC } = await userCli.rpc('activar_contabilidad', { p_empresa: empresaId })
if (eActC) die('activar_contabilidad', eActC)
const { data: pendCont, error: ePendCont } = await userCli.rpc('contabilizar_pendientes', { p_empresa: empresaId })
if (ePendCont) die('contabilizar_pendientes', ePendCont)
const { count: nAsientos } = await admin.from('asientos').select('*', { count: 'exact', head: true }).eq('empresa_id', empresaId)
console.log('✓ contabilidad activada (' + (nAsientos ?? 0) + ' asientos, ' + (pendCont?.creados ?? 0) + ' contabilizados)')

```

- [ ] **Step 2: Sumar el conteo de asientos al RESUMEN**

En el bloque `=== RESUMEN ===`, agregar una línea tras `console.log('correos enviados:     ', await cuenta('correos_enviados'))` (el helper `cuenta` ya filtra por `empresa_id`):

```js
console.log('asientos contables:   ', await cuenta('asientos'))
```

- [ ] **Step 3: Reset + seed + verificar**

Run (PowerShell 5.1 — `$env:` para la clave; Node ≥22 del usuario para el type-stripping de los correos):

```powershell
pnpm supabase db reset
$env:DTE_ENCRYPTION_KEY = '<la misma clave de apps/erp/.env.local>'
node scripts/seed-demo.mjs
```

El seed corre completo y estampa `✓ contabilidad activada (N asientos, M contabilizados)` con **N > 0**, y `asientos contables:  N` en el RESUMEN.

Query psql — asientos poblados, cuadratura global y UNA sola empresa con asientos (la 2da org NO activada):

```
docker exec supabase_db_ERP_Transportes psql -U postgres -d postgres -c "select (select count(*) from asientos) > 0 as hay_asientos, (select coalesce(sum(debe),0) = coalesce(sum(haber),0) from asientos_lineas) as cuadra_global, (select count(distinct empresa_id) from asientos) as empresas_con_asientos;"
```

→ `hay_asientos = t`, `cuadra_global = t` (Σdebe = Σhaber sobre TODAS las líneas), `empresas_con_asientos = 1` (solo la empresa demo; `Comercial Ficticia SpA` quedó sin contabilidad).

Byte-scan del archivo modificado (JAMÁS BOM U+FEFF; salida vacía / exit 1 = pass):

```
grep -c $'\xEF\xBB\xBF' scripts/seed-demo.mjs
```

→ imprime `0` y sale con status 1 (sin coincidencias = pass).

- [ ] **Step 4: Commit**

```bash
git add scripts/seed-demo.mjs
git commit -m "feat(scripts): la demo nace con contabilidad activada y libros completos"
```

---

### Task 10: Pipeline + verificación integral (E2E de datos + checklist)

**Files:** ninguno de producción (script y comandos en scratchpad, se borran al cerrar).

- [ ] **Step 1: Pipeline**

Run: `pnpm --filter @suite/db gen` — commitear solo si hay diff (`chore(db): tipos regenerados`; ya regenerados en la task de tipos, aquí es verificación).
Run: `pnpm test` — **176 tests**, SIN cambios (la cuadratura viva del formulario de asiento manual es inline en la UI; el plan NO extrae helpers a `@suite/core`).
Run: `pnpm supabase test db` — **315 asserts** (los 15 archivos previos suman 279 + `contabilidad.test.sql` `plan(36)` = 16 archivos), todos verdes.
Run: `pnpm build --concurrency=1` — 3 apps. OJO: el build pisa el `.next` de los dev servers → reiniciar `pnpm --filter erp dev` ANTES del checklist del Step 3.

- [ ] **Step 2: E2E de capa de datos (script Node en scratchpad)**

**Partición explícita de la verificación** — la contabilización en tiempo real es un hook de app (`apps/erp/lib/contabilidad.ts` → `contabilizarAsiento`, admin client) sobre un route/Server Action, no una RPC directa; se parte en 3 capas sin hueco:

- **(a) Capa de datos y de dinero** (activación + catálogo, todas las reglas de mapeo §4, idempotencia, reversa, cuadratura global, aislamiento) → ESTE script. `contabilizar_documento` es **service_role** (el hook lo llama con el admin client tras leer el documento); `contabilizar_pendientes` es el MISMO motor y es authenticated — el script lo llama con la sesión del dueño, réplica EXACTA del catch-up. Así el spec §8 (todo el ciclo contable) queda cubierto SIN HTTP.
- **(b) El wiring HTTP real** (emisión/pago/anticipo → hook `contabilizarAsiento` → asiento solo; toggle del módulo; trazabilidad "Asiento N°X" en los detalles) → checklist manual del Step 3 (un script Node no forja la sesión SSR ni dispara las Server Actions).
- **(c)** No hay unit tests nuevos (conteo 176 intacto): la cuadratura viva del form es inline y la invariante `Σdebe = Σhaber` vive en `app._insertar_asiento` (cubierta por pgTAP `plan(36)`).

**Riesgo aceptado (documentado):** el mapeo HTTP 200/500 y el disparo del hook desde las Server Actions no corren en CI (el repo NO levanta servidor HTTP); quedan cubiertos por el checklist manual del Step 3 + los goldens de `contabilizar_documento`/`contabilizar_pendientes` de pgTAP — **mismo riesgo aceptado que los Planes 13 y 14**. NO se agregan tests HTTP automatizados de rutas.

Patrón de siempre (`createRequire` sobre `packages/auth/package.json`; usuarios reales vía `admin.auth.admin.createUser` + `registrar_organizacion` como authenticated; RUT org1 `999999999` y org2 `888888888`, cliente `765000017` — E2E-reservados, sin colisión con fixtures/demo; keys de `pnpm supabase status`). Fecha estable: `const mes = new Date().toISOString().slice(0, 7) + '-01'`.

**Sombras deliberadas del stand-in (documentadas, no huecos):**
- Las facturas emitidas se siembran por **service_role** (insert directo, `estado='emitido'`, `emitido_en=now()`) — espejo EXACTO del sembrado de `cobranza.test.sql`, porque el E2E no invoca `emitirDocumento`. El wiring emisión→hook se prueba en (b).
- El anticipo (plata nueva) y el pago-de-aplicación (`anticipo_id` seteado → reclasificación) se siembran por service_role directo en `anticipos`/`pagos`: reproducen las FILAS que en producción crean `registrar_anticipo_mp` y las re-creates de `aplicar_anticipo`; `contabilizar_pendientes` lee esas filas reales y aplica la regla de §4 igual.

`scratchpad/e2e-contabilidad.js`:

```js
// E2E capa de datos del Plan 16. Ejecutar desde la raíz con el stack local arriba:
//   SERVICE_ROLE_KEY=... ANON_KEY=... node <scratchpad>/e2e-contabilidad.js
// (ambas keys salen de `pnpm supabase status`). Borra sus propios datos al final.
const { createRequire } = require('node:module')
const { randomUUID } = require('node:crypto')
const path = require('node:path')
const req = createRequire(path.join(process.cwd(), 'packages/auth/package.json'))
const { createClient } = req('@supabase/supabase-js')

const URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321'
const ANON = process.env.ANON_KEY
const SERVICE = process.env.SERVICE_ROLE_KEY
if (!ANON || !SERVICE) throw new Error('Faltan ANON_KEY / SERVICE_ROLE_KEY (ver pnpm supabase status)')

const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } })
const mes = new Date().toISOString().slice(0, 7) + '-01'
const CLAVES = ['caja', 'banco', 'clientes', 'anticipos_clientes', 'iva_debito', 'iva_credito', 'proveedores', 'ventas', 'ventas_exentas', 'compras_gastos']

let ok = 0
function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT FALLÓ: ' + msg)
  ok++
  console.log('  ok ' + ok + ': ' + msg)
}

async function crearUsuarioOrg(email, rut) {
  const { data: u, error: eu } = await admin.auth.admin.createUser({ email, password: 'secret1234', email_confirm: true })
  if (eu) throw eu
  const cli = createClient(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } })
  const { error: es } = await cli.auth.signInWithPassword({ email, password: 'secret1234' })
  if (es) throw es
  const { data: org, error: eo } = await cli.rpc('registrar_organizacion', { p_rut: rut, p_razon_social: 'E2E ' + rut })
  if (eo) throw eo
  const { data: e } = await admin.from('empresas').select('id').eq('organizacion_id', org).single()
  return { userId: u.user.id, orgId: org, empId: e.id, cli }
}

// clave_sistema -> {debe, haber} agregado del ÚNICO asiento que matchea el filtro.
async function lineasPorClave(empId, filtro) {
  let q = admin
    .from('asientos')
    .select('id, reversa_de, asientos_lineas (debe, haber, cuentas_contables (clave_sistema))')
    .eq('empresa_id', empId)
  for (const [k, v] of Object.entries(filtro)) q = q.eq(k, v)
  const { data } = await q.maybeSingle()
  if (!data) return null
  const m = {}
  for (const l of data.asientos_lineas) {
    const k = l.cuentas_contables ? l.cuentas_contables.clave_sistema : '?'
    m[k] = m[k] || { debe: 0, haber: 0 }
    m[k].debe += l.debe
    m[k].haber += l.haber
  }
  return { id: data.id, reversa_de: data.reversa_de, m, n: Object.keys(m).length }
}

async function main() {
  const o1 = await crearUsuarioOrg('e2e-conta-1@example.com', '999999999')
  const o2 = await crearUsuarioOrg('e2e-conta-2@example.com', '888888888')
  const emp1 = o1.empId

  // Vendedor de org1 (para el flanco RLS-por-rol: no ve asientos).
  const { data: uv } = await admin.auth.admin.createUser({ email: 'e2e-conta-vend@example.com', password: 'secret1234', email_confirm: true })
  const vend = createClient(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } })
  await vend.auth.signInWithPassword({ email: 'e2e-conta-vend@example.com', password: 'secret1234' })
  await admin.from('miembros').insert({ usuario_id: uv.user.id, organizacion_id: o1.orgId, rol: 'vendedor' })

  // Cliente de org1 (insert como authenticated: service_role no tiene USAGE en schema app).
  const { data: cli, error: ec } = await o1.cli.from('clientes').insert({ empresa_id: emp1, rut: '765000017', razon_social: 'Cliente E2E' }).select('id').single()
  if (ec) throw ec
  const clienteId = cli.id

  // --- 1) Activar: siembra el catálogo (10 claves de sistema + ~25 cuentas) ---
  const { error: ea } = await o1.cli.rpc('activar_contabilidad', { p_empresa: emp1 })
  if (ea) throw ea
  const { data: clavesRows } = await admin.from('cuentas_contables').select('clave_sistema').eq('empresa_id', emp1).not('clave_sistema', 'is', null)
  const claves = new Set((clavesRows ?? []).map((r) => r.clave_sistema))
  const { count: nCuentas } = await admin.from('cuentas_contables').select('*', { count: 'exact', head: true }).eq('empresa_id', emp1)
  assert(CLAVES.every((k) => claves.has(k)) && claves.size === 10, 'activar sembró las 10 claves de sistema')
  assert((nCuentas ?? 0) >= 20, 'catálogo pyme sembrado (>= 20 cuentas)')

  // --- Facturas emitidas (service_role): F1 sin exento, F2 con exento ---
  const f1 = randomUUID(), f2 = randomUUID()
  const { error: ef } = await admin.from('documentos_venta').insert([
    { id: f1, empresa_id: emp1, tipo: 'factura', cliente_id: clienteId, folio: 9001, estado: 'emitido', neto: 100000, exento: 0, iva: 19000, total: 119000, emitido_en: mes + 'T12:00:00Z' },
    { id: f2, empresa_id: emp1, tipo: 'factura', cliente_id: clienteId, folio: 9002, estado: 'emitido', neto: 50000, exento: 30000, iva: 9500, total: 89500, emitido_en: mes + 'T12:00:00Z' },
  ])
  if (ef) throw ef

  // --- 2) Contabilizar pendientes: crea los asientos de venta ---
  const { data: r1, error: er1 } = await o1.cli.rpc('contabilizar_pendientes', { p_empresa: emp1 })
  if (er1) throw er1
  assert((r1?.creados ?? 0) >= 2, 'contabilizar_pendientes creó los asientos de venta')

  // --- 3) Golden venta SIN exento (F1): Clientes / Ventas + IVA débito ---
  const gv1 = await lineasPorClave(emp1, { origen: 'venta', referencia_id: f1 })
  assert(gv1 && gv1.n === 3 && gv1.m.clientes.debe === 119000 && gv1.m.ventas.haber === 100000 && gv1.m.iva_debito.haber === 19000, 'asiento venta F1: Debe Clientes 119000 / Haber Ventas 100000 + IVA débito 19000')

  // --- 4) Golden venta CON exento (F2): agrega Ventas exentas ---
  const gv2 = await lineasPorClave(emp1, { origen: 'venta', referencia_id: f2 })
  assert(gv2 && gv2.n === 4 && gv2.m.clientes.debe === 89500 && gv2.m.ventas.haber === 50000 && gv2.m.ventas_exentas.haber === 30000 && gv2.m.iva_debito.haber === 9500, 'asiento venta F2: incluye Ventas exentas 30000')

  // --- 5) Pago sin anticipo_id → Banco (registrar_pago, dueño) ---
  const { data: pagoId, error: ep } = await o1.cli.rpc('registrar_pago', {
    p_empresa: emp1, p_cliente: clienteId, p_fecha: mes, p_metodo: 'transferencia', p_monto: 119000,
    p_referencia: null, p_notas: null, p_aplicaciones: [{ documentoId: f1, monto: 119000 }],
  })
  if (ep) throw ep

  // --- 6) Anticipo (plata nueva, mp_payment_id NOT NULL) → Banco / Anticipos ---
  const antId = randomUUID()
  await admin.from('anticipos').insert({ id: antId, empresa_id: emp1, cliente_id: clienteId, origen_tipo: 'proforma', origen_id: randomUUID(), monto: 200000, mp_payment_id: 'PMT-E2E-ANT', estado: 'recibido' })

  // --- 7) Pago de APLICACIÓN (anticipo_id seteado) → Anticipos / Clientes (reclasificación) ---
  const pagoAplId = randomUUID()
  await admin.from('pagos').insert({ id: pagoAplId, empresa_id: emp1, cliente_id: clienteId, metodo: 'mercadopago', monto: 50000, estado: 'activo', anticipo_id: antId })

  const { data: r2, error: er2 } = await o1.cli.rpc('contabilizar_pendientes', { p_empresa: emp1 })
  if (er2) throw er2
  assert((r2?.creados ?? 0) >= 3, 'segundo pendientes: pago + anticipo + aplicación contabilizados')

  const gp = await lineasPorClave(emp1, { origen: 'pago', referencia_id: pagoId })
  assert(gp && gp.n === 2 && gp.m.banco.debe === 119000 && gp.m.clientes.haber === 119000, 'asiento pago sin anticipo_id: Debe Banco / Haber Clientes')
  const ga = await lineasPorClave(emp1, { origen: 'anticipo', referencia_id: antId })
  assert(ga && ga.n === 2 && ga.m.banco.debe === 200000 && ga.m.anticipos_clientes.haber === 200000, 'asiento anticipo: Debe Banco / Haber Anticipos de clientes')
  const gr = await lineasPorClave(emp1, { origen: 'pago', referencia_id: pagoAplId })
  assert(gr && gr.n === 2 && gr.m.anticipos_clientes.debe === 50000 && gr.m.clientes.haber === 50000, 'asiento aplicación (anticipo_id): Debe Anticipos / Haber Clientes (reclasificación)')

  // --- 8) Reversa: espejo ligado del asiento de venta F1 ---
  const { data: revId, error: erev } = await o1.cli.rpc('revertir_asiento', { p_empresa: emp1, p_asiento: gv1.id, p_glosa: 'Reversa E2E' })
  if (erev) throw erev
  const grev = await lineasPorClave(emp1, { origen: 'reversa', reversa_de: gv1.id })
  assert(grev && grev.id === revId && grev.m.clientes.haber === 119000 && grev.m.ventas.debe === 100000 && grev.m.iva_debito.debe === 19000, 'reversa: espejo exacto (debe<->haber) ligado por reversa_de')

  // --- 9) Doble reversa rechazada ---
  const e9 = (await o1.cli.rpc('revertir_asiento', { p_empresa: emp1, p_asiento: gv1.id, p_glosa: 'otra' })).error
  assert(e9 && /El asiento ya fue revertido/.test(e9.message), 'doble reversa -> "El asiento ya fue revertido"')

  // --- 10) Idempotencia: re-contabilizar no crea nada (ni re-crea el venta ya revertido) ---
  const { count: antesN } = await admin.from('asientos').select('*', { count: 'exact', head: true }).eq('empresa_id', emp1)
  const { data: r3 } = await o1.cli.rpc('contabilizar_pendientes', { p_empresa: emp1 })
  const { count: despuesN } = await admin.from('asientos').select('*', { count: 'exact', head: true }).eq('empresa_id', emp1)
  assert((r3?.creados ?? -1) === 0 && antesN === despuesN, 'pendientes idempotente: 0 creados y el venta revertido NO se re-crea')

  // --- 11) crear_asiento descuadrado rechazado ---
  const banco = (await admin.from('cuentas_contables').select('id').eq('empresa_id', emp1).eq('clave_sistema', 'banco').single()).data.id
  const clientes = (await admin.from('cuentas_contables').select('id').eq('empresa_id', emp1).eq('clave_sistema', 'clientes').single()).data.id
  const e11 = (await o1.cli.rpc('crear_asiento', { p_empresa: emp1, p_fecha: mes, p_glosa: 'descuadrado', p_lineas: [{ cuentaId: banco, debe: 1000, haber: 0 }, { cuentaId: clientes, debe: 500, haber: 0 }] })).error
  assert(e11 && /El asiento no cuadra: debe y haber difieren/.test(e11.message), 'crear_asiento descuadrado -> mensaje contractual')

  // --- 12) crear_asiento feliz (cuadrado) ---
  const { data: manualId, error: e12 } = await o1.cli.rpc('crear_asiento', { p_empresa: emp1, p_fecha: mes, p_glosa: 'Asiento manual E2E', p_lineas: [{ cuentaId: banco, debe: 1000, haber: 0 }, { cuentaId: clientes, debe: 0, haber: 1000 }] })
  assert(!e12 && typeof manualId === 'string', 'crear_asiento cuadrado -> uuid')

  // --- 13) Cuadratura GLOBAL: Σdebe = Σhaber sobre todas las líneas de org1 ---
  const { data: todas } = await admin.from('asientos_lineas').select('debe, haber').eq('empresa_id', emp1)
  const sd = (todas ?? []).reduce((a, l) => a + l.debe, 0)
  const sh = (todas ?? []).reduce((a, l) => a + l.haber, 0)
  assert(sd === sh && sd > 0, 'cuadratura global: Σdebe = Σhaber (' + sd + ')')

  // --- 14) Cross-tenant: org2 (sin contabilidad) no ve asientos de org1, y 0 propios ---
  const ajenos = (await o2.cli.from('asientos').select('id').eq('empresa_id', emp1)).data
  assert((ajenos ?? []).length === 0, 'org2 no ve asientos de org1 (RLS del invoker)')
  const { count: nOrg2 } = await admin.from('asientos').select('*', { count: 'exact', head: true }).eq('empresa_id', o2.empId)
  assert((nOrg2 ?? 0) === 0, 'org2 sin activar: 0 asientos')

  // --- 15) RLS por ROL: el vendedor de org1 ve 0 asientos (select solo d/a/contador) ---
  const delVend = (await vend.from('asientos').select('id').eq('empresa_id', emp1)).data
  assert((delVend ?? []).length === 0, 'un vendedor de org1 no ve asientos (RLS por rol)')

  console.log('\n' + ok + ' aserciones de datos verdes\n')

  // --- Cleanup FK-safe (cada delete -> count 0), en orden de dependencia ---
  const empIds = [emp1, o2.empId]
  const orgIds = [o1.orgId, o2.orgId]
  const pasos = [
    ['asientos_lineas', 'empresa_id', empIds], ['asientos', 'empresa_id', empIds], ['cuentas_contables', 'empresa_id', empIds],
    ['pagos_aplicaciones', 'empresa_id', empIds], ['pagos', 'empresa_id', empIds], ['anticipos', 'empresa_id', empIds],
    ['documentos_venta', 'empresa_id', empIds], ['clientes', 'empresa_id', empIds],
    ['suscripciones', 'organizacion_id', orgIds], ['miembros', 'organizacion_id', orgIds], ['empresas', 'organizacion_id', orgIds],
    ['organizaciones', 'id', orgIds],
  ]
  for (const [tabla, col, ids] of pasos) {
    await admin.from(tabla).delete().in(col, ids)
    const { count } = await admin.from(tabla).select('*', { count: 'exact', head: true }).in(col, ids)
    assert((count ?? 0) === 0, 'cleanup ' + tabla + ' -> 0')
  }
  await admin.auth.admin.deleteUser(o1.userId)
  await admin.auth.admin.deleteUser(o2.userId)
  await admin.auth.admin.deleteUser(uv.user.id)
  console.log('cleanup completo (' + ok + ' asserts totales)')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
```

Cubre el set contable del spec §8 en **17 aserciones de datos + 12 de cleanup**. Las claves jsonb de `crear_asiento` son `cuentaId`/`debe`/`haber` (camelCase — contrato fijado en part-2, patrón `registrar_pago`). Si alguna aserción falla: defecto real → **BLOCKED** con detalle.

- [ ] **Step 3: Checklist manual del wiring HTTP (browser + dev server)**

Reiniciar `pnpm --filter erp dev` (puerto 3001) tras el build; login `demo@suite-erp.cl` / `demo1234` (resembrar si la demo está vencida — es perecible). Para los ítems 7 y 9 crear un miembro **vendedor** y uno **contador** de la org demo (invitar desde `/configuracion/equipo`, o `insert into miembros` por psql). Documentar el resultado de CADA ítem en el reporte:

1. **Demo activada**: la demo ya nace con contabilidad (Task 9). `/contabilidad` muestra los últimos asientos del histórico y el aviso "sin documentos pendientes" (o 0 pendientes). `/configuracion/modulos` muestra el toggle Contabilidad en ON.
2. **Emitir venta → asiento solo y trazable**: emitir una factura/boleta nueva → `/ventas/[id]` muestra la línea "Asiento N°X" (link al asiento); el asiento existe SOLO por esa emisión (no aparece duplicado ni suelto).
3. **Pago → asiento**: registrar un pago en `/cobranza` para una factura con saldo → el hook crea su asiento (Debe Banco / Haber Clientes); trazable desde el pago.
4. **Manual descuadrado imposible**: `/contabilidad` → nuevo asiento manual con líneas dinámicas → la cuadratura viva muestra Σdebe/Σhaber; con descuadre el botón **Guardar** está deshabilitado; forzar el submit → la RPC rechaza con `'El asiento no cuadra: debe y haber difieren'`.
5. **Reversa ligada**: en el detalle de un asiento → **Revertir** con glosa → aparece el asiento inverso ligado (N° de reversa apunta al original), y el original queda marcado como revertido; un segundo Revertir está bloqueado.
6. **Mayor cuadra con diario**: elegir una cuenta en `/contabilidad/mayor` para un rango → sus movimientos y su saldo final coinciden con las líneas de esa misma cuenta en `/contabilidad/diario` del mismo rango.
7. **Vendedor no ve NAV ni entra por URL**: login como **vendedor** → sin el link Contabilidad en la NAV; `/contabilidad`, `/contabilidad/diario` y `/contabilidad/mayor` → **404**; el route `/contabilidad/diario/export` → **403** (no un CSV vacío — lección P12).
8. **Export CSV abre en Excel**: `/contabilidad/diario` y `/contabilidad/mayor` (cuenta elegida) → **Exportar CSV** → el archivo abre en Excel es-CL con BOM, separador `;` y las columnas correctas (diario: Fecha/N°/Origen/Código/Cuenta/Glosa/Debe/Haber; mayor: con Saldo acumulado y la fila Saldo inicial).
9. **Contador opera el módulo**: login como **contador** → ve el módulo; crea un asiento manual cuadrado que se guarda y aparece en el diario; puede contabilizar pendientes y revertir.
10. **Desactivar esconde la UI, los asientos quedan**: `/configuracion/modulos` → toggle Contabilidad **OFF** → la NAV pierde el link y `/contabilidad*` da 404; re-activar → los asientos históricos siguen ahí, sin recrearse ni duplicarse (idempotencia).

- [ ] **Step 4: Reporte y cleanup**

`.superpowers/sdd/task-10-plan16-report.md` con: el pipeline (176 / 315 / 3 builds), las 17 aserciones del script E2E (a) + las 12 de cleanup, y el checklist HTTP (b) ítem por ítem. Borrar del scratchpad `e2e-contabilidad.js` al cerrar (el cleanup del propio script ya dejó ambas orgs y sus 3 usuarios en 0).

---

## Verificación final del plan

- `pnpm test` (**176**: SIN cambios — la cuadratura viva es inline) + `pnpm supabase test db` (**315**: 279 previos + `contabilidad.test.sql` `plan(36)`, 16 archivos) + `pnpm build --concurrency=1` (**3 apps**) verdes.
- Ciclo completo (spec §10): cada empresa activa el módulo desde `/configuracion/modulos` → nace con un plan de cuentas pyme chileno y su histórico contabilizado (libro diario y mayor cuadrados: `Σdebe = Σhaber` global e igual por asiento) → emitir una venta, registrar un pago o recibir un anticipo crea su asiento SOLO y trazable desde el documento (hook nunca-lanza; el catch-up `contabilizar_pendientes` es el mismo motor idempotente) → **ningún asiento descuadrado entra jamás a la base**: toda vía (manual, reversa, hook, catch-up) pasa por `app._insertar_asiento` que valida `Σdebe = Σhaber > 0` y líneas hoja de la empresa antes de escribir; un asiento manual descuadrado es imposible de guardar (botón deshabilitado + RPC que rechaza) → los asientos son inmutables: corregir es `revertir_asiento` (inverso ligado, una sola reversa) → el contador opera el módulo y el vendedor ni lo ve (RLS select POR ROL, primera del repo) → los exports CSV del diario y el mayor abren en Excel con el guard módulo+rol en paridad página/route (lección P12) → la demo nace con todo poblado y la 2ª organización sin activar muestra el gating.
- **Riesgo aceptado**: el disparo del hook desde las Server Actions/route handlers y el mapeo HTTP no corren en CI (el repo no levanta servidor); quedan cubiertos por el checklist manual del Step 3 + los goldens de `contabilizar_documento`/`contabilizar_pendientes` de pgTAP — mismo trato que los Planes 13 y 14.
- Criterio de éxito del spec §10 cumplido.

