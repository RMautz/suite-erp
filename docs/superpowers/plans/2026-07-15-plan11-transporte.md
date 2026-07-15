# Plan 11: Vertical Transporte (flota, tarifario, ODEs y proformas) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Módulo de transporte activable por empresa que replica la operación real del usuario: órdenes de entrega (ODE) con kilo afecto tarifado por destino, agrupadas en PROFORMAS numeradas (PF-000004) con ciclo borrador→enviada→aprobada→facturada que convierten a factura SII — con reversa total y flota/despacho como insumo del Plan 12.

**Architecture:** Migración 0016 en dos capas (tablas+grants+endurecimiento de `empresas`+vista / 7 RPCs security definer). ODEs y proformas SIN escritura directa; `kilo_afecto` SIEMPRE server-side; neto negociable del llamador (patrón cotizaciones); máquina tripartita ODE↔proforma↔documento con locks ordenados y validación post-lock. UI espejo de proveedores (maestros), por-pagar (listas) y cotizaciones (detalle+print). Tres endurecimientos al flujo de emisión existente.

**Tech Stack:** Postgres 17 (RLS, pgTAP), Next.js 15 Server Actions, Vitest (TDD), Tailwind CSS 4.

**Spec:** `docs/superpowers/specs/2026-07-15-plan11-transporte-design.md` (3 rondas de verificación adversarial; §3 schema, §4 RPCs/mensajes y §8 tests son CONTRATO byte-exacto).

## Global Constraints

- Multi-tenant: `empresa_id` + RLS + grants explícitos; FK compuestas `(empresa_id, x_id)`; `unique (empresa_id, id)` en tablas referenciadas por FK compuesta; app queries `.eq('empresa_id', activa.id)` con `activa` de `obtenerEmpresaActiva()`.
- `ordenes_entrega`/`proformas`: CERO escritura directa (ni policies ni grants de escritura) — todo por RPC. Maestros con escritura directa dueno/admin y grant de update POR COLUMNAS: `vehiculos (descripcion, capacidad_kg, activo)`, `conductores (nombre, telefono, activo)`, `destinos (tarifa_kg, activo)` — patente/rut/nombre/empresa_id INMUTABLES.
- Endurecimiento `empresas` (0016): `revoke update from authenticated` + `grant update (razon_social, giro, direccion, comuna, giro_emisor, direccion_emisor, comuna_emisor, resolucion_sii_numero, resolucion_sii_fecha, certificado_cifrado, certificado_password_cifrada, dte_api_key_cifrada, modulo_transporte, factor_volumetrico)` — id/rut/organizacion_id FUERA.
- Roles ciclo transporte = dueno/admin/vendedor; contador/bodeguero solo lectura. `crear_orden_entrega` y `crear_proforma` exigen `modulo_transporte = true`; las demás RPCs funcionan con módulo off.
- **Kilo afecto SIEMPRE server-side**: `v_kilos := round(p_kilos, 2)`; `v_m3 := round(p_m3, 2)`; `v_kilo_afecto := round(greatest(v_kilos, coalesce(v_m3, 0) * v_factor))::integer`; si `< 1` → `'La carga es demasiado pequeña para tarifar'`. Topes: kilos ≤ 1.000.000, m3 ≤ 100.000, `factor_volumetrico between 1 and 10000` (check de tabla). El neto lo manda el llamador (entero ≥ 1, negociable).
- Máquina de proformas EXACTA: borrador→enviada|rechazada; enviada→aprobada|rechazada; aprobada→rechazada|facturada (facturada SOLO vía facturar_proforma); facturada→aprobada SOLO vía anular_estado_pago. Todo rechazo exige motivo y LIBERA las ODEs. ODEs: registrada→facturada (facturar_proforma) / registrada→anulada (motivo; orden de checks: estado ANTES que reserva); facturada→registrada solo vía anular_estado_pago. `asignar_despacho` opera sobre cualquier ODE no-anulada.
- Anti-TOCTOU (contrato): TODA validación post-`for update`; TODA operación multi-ODE con locks `order by id for update` antes del UPDATE masivo (crear_proforma, facturar_proforma, liberación de rechazo, reversa de anular_estado_pago).
- anular_estado_pago: busca proforma por documento_venta_id (0 filas → `'El documento no proviene de una proforma'`); acepta (`tipo='nota_venta' and estado='borrador' and folio is null`) O (`tipo in ('factura','boleta') and estado='rechazado'`); revierte ODEs (conservando proforma_id), proforma a 'aprobada', borra líneas y doc.
- Dinero: `v_neto bigint := Σ netos`; umbral EXACTO `if v_neto + round(v_neto*0.19) > 2147483647` → `'La proforma supera el monto máximo facturable'`; `v_iva := round(v_neto*0.19)::integer` (IVA sobre el neto TOTAL — criterio verificado contra el sistema real del usuario); `check (total = neto + iva)`. Línea de venta: `producto_id = null`, `precio_neto = o.neto`, `exenta = false`, `descripcion = left('ODE N° ' || o.numero || ' ' || destino_nombre || coalesce(' — guías ' || o.docum, ''), 80)`.
- Prospectividad: cambios de `tarifa_kg`/`factor_volumetrico` JAMÁS recalculan ODEs/proformas existentes (pgTAP lo fija).
- Correlativos: `pg_advisory_xact_lock(hashtextextended('ordenes_entrega:' || p_empresa::text, 42))` y `('proformas:' || ...)` + `coalesce(max(numero), 0) + 1` DENTRO del lock. Display proforma: `'PF-' || lpad(numero::text, 6, '0')`.
- CHECKs de BD: `vehiculos.patente ~ '^[A-Z]{4}[0-9]{2}$' or ~ '^[A-Z]{2}[0-9]{4}$'`; `conductores.rut = app.normalizar_rut(rut) and app.validar_rut(rut)`; destinos SOLO índice único CI `(empresa_id, lower(nombre))`.
- Mensajes EXACTOS (contrato pgTAP — lista completa y literal en spec §4; NO inventar variantes): los 34 del spec, incluidos `'La carga es demasiado pequeña para tarifar'`, `'Los kilos superan el máximo admitido'`, `'Los M3 superan el máximo admitido'`, `'No se puede asignar despacho a una orden anulada'`, `'El documento no proviene de una proforma'`.
- Server Actions: claves de mapeo del spec §7; `crear_proforma`/`facturar_proforma`/`anular_estado_pago` por IGUALDAD ESTRICTA del mensaje completo; redirect FUERA de try/catch; `p_empresa: activa.id` siempre.
- Conteos finales: pgTAP **193** (134 + 59, `plan(59)`), unit **118** (core 106 = 83+23, auth 2, dte 10), 3 apps build.
- CERO BOM literal (escribir siempre la secuencia de escape backslash-uFEFF, jamás el carácter; byte-scan = 0; `grep -c` sale con exit 1 cuando el conteo es 0 — eso es el pass); UTF-8 sin BOM; español; Windows/PowerShell 5.1 (`&&` no encadena; prefijar comandos con el refresh de PATH).

---
### Task 1: Migración 0016 — tablas de transporte, endurecimiento de empresas y vista

**Files:**
- Create: `supabase/migrations/00000000000016_transporte.sql`

**Interfaces:**
- Consumes: `empresas` (0001: policy "duenos editan empresas" queda intacta como filtro de fila; 0004: columnas del emisor DTE que la Configuración actualiza y DEBEN quedar en el grant por columnas), `clientes`/`documentos_venta` con `unique (empresa_id, id)` (0004), `app.mis_empresas()`/`app.tiene_rol_en_empresa()` (0003), `app.normalizar_rut()`/`app.validar_rut()` (0002), vista `ventas_por_producto` (0012).
- Produces: columnas `empresas.modulo_transporte` y `empresas.factor_volumetrico`; endurecimiento de `empresas` (update SOLO por columnas — `id`/`rut`/`organizacion_id` inmutables); tablas `vehiculos`, `conductores`, `destinos` (tarifario), `proformas`, `ordenes_entrega` con RLS/grants; vista `ventas_por_producto` recreada con `producto_id is not null`.
- El archivo TERMINA con la marca `-- ===== RPCs (Task 2) =====`: Task 2 ANEXA las 7 RPCs a este mismo archivo — no crear migración 0017.
- `proformas` y `ordenes_entrega`: CERO escritura directa de `authenticated` (ni policies ni grants de insert/update/delete); toda escritura entra por las RPCs de Task 2.

- [ ] **Step 1: Escribir la migración**

`supabase/migrations/00000000000016_transporte.sql`:

```sql
-- Vertical transporte (Plan 11): flota, tarifario por destino, ordenes de
-- entrega (ODE) y proformas numeradas. Modulo activable por empresa
-- (modulo_transporte) con factor volumetrico configurable. De pasada se
-- cierra un hueco pre-existente: empresas permitia update de TODAS sus
-- columnas (incluida organizacion_id) a cualquier dueno/admin.
-- Task 1: tablas + grants + vista. Task 2 anexa las RPCs al final.

-- ---------- empresas: activacion del modulo y factor volumetrico ----------
-- factor_volumetrico: kg por M3 para el kilo afecto (default 250). Los cambios
-- son PROSPECTIVOS: kilo_afecto/neto ya persistidos jamas se recalculan.
alter table public.empresas
  add column if not exists modulo_transporte boolean not null default false,
  add column if not exists factor_volumetrico integer not null default 250
    check (factor_volumetrico between 1 and 10000);

-- ---------- empresas: endurecimiento (update por columnas) ----------
-- La policy "duenos editan empresas" (0001) sigue siendo el filtro de FILA;
-- este grant restringe las COLUMNAS: id/rut/organizacion_id quedan FUERA
-- (un dueno no puede mover su empresa a otra organizacion). La lista incluye
-- las columnas del emisor DTE (0004) que Configuracion actualiza hoy.
revoke update on public.empresas from authenticated;
grant update (razon_social, giro, direccion, comuna, giro_emisor, direccion_emisor, comuna_emisor, resolucion_sii_numero, resolucion_sii_fecha, certificado_cifrado, certificado_password_cifrada, dte_api_key_cifrada, modulo_transporte, factor_volumetrico) on public.empresas to authenticated;

-- ---------- Vehiculos (maestro, espejo de proveedores) ----------
create table public.vehiculos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  -- Patentes chilenas: BBBB99 (actual) o BB9999 (antigua). Mayusculas ya
  -- normalizadas por la app (normalizarPatente en @suite/core).
  patente text not null check (patente ~ '^[A-Z]{4}[0-9]{2}$' or patente ~ '^[A-Z]{2}[0-9]{4}$'),
  descripcion text,
  capacidad_kg integer check (capacidad_kg > 0),
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  unique (empresa_id, patente),
  unique (empresa_id, id)
);

-- ---------- Conductores (maestro, espejo de proveedores) ----------
create table public.conductores (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  -- Ultima linea de defensa: normalizado y con DV correcto tambien en la BD.
  rut text not null check (rut = app.normalizar_rut(rut) and app.validar_rut(rut)),
  nombre text not null,
  telefono text,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  unique (empresa_id, rut),
  unique (empresa_id, id)
);

-- ---------- Destinos (tarifario: $/kg afecto por destino) ----------
-- SOLO indice unico CI (leccion 9b sin la redundancia: el CI implica el plano).
-- nombre/empresa_id son INMUTABLES por grants, asi la colision CI solo puede
-- ocurrir en el insert: un solo punto donde mapear el 23505.
create table public.destinos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  nombre text not null,
  tarifa_kg integer not null check (tarifa_kg > 0),
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  unique (empresa_id, id)
);
create unique index destinos_nombre_ci_idx on public.destinos (empresa_id, lower(nombre));

-- ---------- Proformas (ANTES que ordenes_entrega: la ODE le hace FK) ----------
-- Documento comercial NO tributario, correlativo por empresa (display
-- 'PF-' || lpad(numero, 6, '0')). neto/iva/total ALMACENADOS: sobreviven a la
-- liberacion de ODEs de una rechazada. IVA sobre el neto TOTAL (criterio
-- verificado contra el sistema real del usuario). Maquina de estados en RPC:
-- borrador -> enviada | rechazada; enviada -> aprobada | rechazada;
-- aprobada -> rechazada | facturada (SOLO facturar_proforma);
-- facturada -> aprobada (SOLO anular_estado_pago).
create table public.proformas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  numero integer not null,
  cliente_id uuid not null,
  fecha date not null default current_date,
  neto integer not null default 0 check (neto >= 0),
  iva integer not null default 0 check (iva >= 0),
  total integer not null default 0 check (total >= 0 and total = neto + iva),
  estado text not null default 'borrador'
    check (estado in ('borrador', 'enviada', 'aprobada', 'rechazada', 'facturada')),
  motivo_rechazo text,
  notas text,
  documento_venta_id uuid,
  creado_en timestamptz not null default now(),
  unique (empresa_id, numero),
  unique (empresa_id, id),
  foreign key (empresa_id, cliente_id) references public.clientes (empresa_id, id),
  -- Nota de venta generada por facturar_proforma (nullable hasta facturar).
  foreign key (empresa_id, documento_venta_id) references public.documentos_venta (empresa_id, id)
);
create index proformas_lista_idx on public.proformas (empresa_id, estado, creado_en desc);

-- ---------- Ordenes de entrega (ODE: la unidad comercial del transportista) ----------
-- kilo_afecto = round(max(kilos, m3 * factor_volumetrico)) calculado SIEMPRE
-- server-side en crear_orden_entrega; el neto lo manda el llamador (tarifario
-- como sugerencia, negociable — patron precios de cotizaciones).
create table public.ordenes_entrega (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  numero integer not null,
  cliente_id uuid not null,
  fecha_ingreso date not null,
  destino_id uuid not null,
  -- Guias de despacho asociadas (texto libre, como en su proforma real).
  docum text,
  oc_cliente text,
  bultos integer not null check (bultos > 0),
  kilos numeric(9,2) not null check (kilos > 0),
  m3 numeric(9,2) check (m3 >= 0),
  kilo_afecto integer not null check (kilo_afecto > 0),
  neto integer not null check (neto > 0),
  -- Despacho opcional: al crear o despues via asignar_despacho (insumo Plan 12).
  vehiculo_id uuid,
  conductor_id uuid,
  notas text,
  estado text not null default 'registrada'
    check (estado in ('registrada', 'facturada', 'anulada')),
  motivo_anulacion text,
  -- Reserva: la proforma que agrupa esta ODE (null = libre).
  proforma_id uuid,
  documento_venta_id uuid,
  creado_en timestamptz not null default now(),
  unique (empresa_id, numero),
  unique (empresa_id, id),
  foreign key (empresa_id, cliente_id) references public.clientes (empresa_id, id),
  foreign key (empresa_id, destino_id) references public.destinos (empresa_id, id),
  foreign key (empresa_id, vehiculo_id) references public.vehiculos (empresa_id, id),
  foreign key (empresa_id, conductor_id) references public.conductores (empresa_id, id),
  foreign key (empresa_id, proforma_id) references public.proformas (empresa_id, id),
  foreign key (empresa_id, documento_venta_id) references public.documentos_venta (empresa_id, id)
);
create index ordenes_entrega_lista_idx on public.ordenes_entrega (empresa_id, estado, fecha_ingreso desc);
create index ordenes_entrega_cliente_idx on public.ordenes_entrega (empresa_id, cliente_id, estado);
create index ordenes_entrega_proforma_idx on public.ordenes_entrega (empresa_id, proforma_id) where proforma_id is not null;
create index ordenes_entrega_documento_idx on public.ordenes_entrega (empresa_id, documento_venta_id) where documento_venta_id is not null;

-- ---------- RLS ----------
alter table public.vehiculos enable row level security;
alter table public.conductores enable row level security;
alter table public.destinos enable row level security;
alter table public.proformas enable row level security;
alter table public.ordenes_entrega enable row level security;

-- Maestros: ver miembros; crear/editar dueno/admin (tarifas y flota = dinero;
-- el vendedor NO edita — espejo de proveedores 0008).
create policy "miembros ven vehiculos" on public.vehiculos
  for select to authenticated using (empresa_id in (select app.mis_empresas()));
create policy "duenos crean vehiculos" on public.vehiculos
  for insert to authenticated
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']));
create policy "duenos editan vehiculos" on public.vehiculos
  for update to authenticated
  using (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']))
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']));

create policy "miembros ven conductores" on public.conductores
  for select to authenticated using (empresa_id in (select app.mis_empresas()));
create policy "duenos crean conductores" on public.conductores
  for insert to authenticated
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']));
create policy "duenos editan conductores" on public.conductores
  for update to authenticated
  using (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']))
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']));

create policy "miembros ven destinos" on public.destinos
  for select to authenticated using (empresa_id in (select app.mis_empresas()));
create policy "duenos crean destinos" on public.destinos
  for insert to authenticated
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']));
create policy "duenos editan destinos" on public.destinos
  for update to authenticated
  using (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']))
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']));

-- Proformas y ODEs: solo lectura para miembros. CERO escritura directa
-- (ni policies ni grants — leccion migraciones 4->7): todo entra por RPC.
create policy "miembros ven proformas" on public.proformas
  for select to authenticated using (empresa_id in (select app.mis_empresas()));
create policy "miembros ven ordenes de entrega" on public.ordenes_entrega
  for select to authenticated using (empresa_id in (select app.mis_empresas()));

-- ---------- Grants Data API (leccion Plan 1) ----------
-- Maestros: update POR COLUMNAS — patente/rut/nombre-de-destino/empresa_id
-- son INMUTABLES (renombrar un destino re-mapearia tarifas ya usadas; cambiar
-- una patente rompe la trazabilidad del despacho).
grant select, insert on public.vehiculos, public.conductores, public.destinos to authenticated;
grant update (descripcion, capacidad_kg, activo) on public.vehiculos to authenticated;
grant update (nombre, telefono, activo) on public.conductores to authenticated;
grant update (tarifa_kg, activo) on public.destinos to authenticated;
grant select on public.proformas, public.ordenes_entrega to authenticated;
grant select, insert, update, delete on public.vehiculos, public.conductores, public.destinos, public.proformas, public.ordenes_entrega to service_role;

-- ---------- Vista ventas_por_producto: fuera las lineas sin producto ----------
-- facturar_proforma insertara lineas con producto_id null (flete, no producto);
-- sin este filtro el top de productos agruparia basura por descripcion.
-- Copia exacta de 0012 cambiando SOLO el where; los grants de 0012 persisten.
create or replace view public.ventas_por_producto with (security_invoker = true) as
select
  l.empresa_id,
  coalesce(d.emitido_en, d.creado_en)::date as fecha,
  l.producto_id,
  l.descripcion,
  sum(l.cantidad)::integer as cantidad,
  sum(l.subtotal)::integer as subtotal
from public.documentos_venta_lineas l
join public.documentos_venta d on d.id = l.documento_id and d.empresa_id = l.empresa_id
where d.estado = 'emitido' and d.tipo in ('factura', 'boleta') and l.producto_id is not null
group by l.empresa_id, fecha, l.producto_id, l.descripcion;

-- ===== RPCs (Task 2) =====
```

- [ ] **Step 2: Aplicar y verificar**

Run: `pnpm supabase db reset` → aplica 0001-0016 sin errores.
Run: `pnpm supabase test db` → los 134 asserts existentes siguen verdes (los tests actuales no hacen update de `empresas` como authenticated, así que el endurecimiento no rompe ninguno).
Smoke de grants:

```
docker exec supabase_db_ERP_Transportes psql -U postgres -d postgres -c "select has_column_privilege('authenticated','public.empresas','organizacion_id','update') as org_upd, has_column_privilege('authenticated','public.empresas','razon_social','update') as rs_upd, has_column_privilege('authenticated','public.vehiculos','patente','update') as patente_upd, has_column_privilege('authenticated','public.destinos','tarifa_kg','update') as tarifa_upd;"
```

→ `org_upd = f` (hueco cerrado), `rs_upd = t` (Configuración sigue funcionando), `patente_upd = f` (inmutable), `tarifa_upd = t` (tarifario editable).

```
docker exec supabase_db_ERP_Transportes psql -U postgres -d postgres -c "select has_table_privilege('authenticated','public.ordenes_entrega','insert') as ode_ins, has_table_privilege('authenticated','public.proformas','insert') as pf_ins, has_table_privilege('authenticated','public.ordenes_entrega','select') as ode_sel;"
```

→ `ode_ins = f`, `pf_ins = f` (cero escritura directa), `ode_sel = t`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/00000000000016_transporte.sql
git commit -m "feat(db): transporte — tablas, tarifario, grants y endurecimiento de empresas"
```

---
### Task 2: Migración 0016 — las 7 RPCs del ciclo de transporte

**Files:**
- Modify: `supabase/migrations/00000000000016_transporte.sql` (ANEXAR el bloque completo AL FINAL del archivo, tal como quedó tras Task 1 — no tocar nada de lo ya escrito).

**Interfaces:**
- Consumes: tablas de Task 1 (`vehiculos`, `conductores`, `destinos`, `proformas`, `ordenes_entrega` — todas con `unique (empresa_id, id)`), columnas `empresas.modulo_transporte`/`empresas.factor_volumetrico` (Task 1), `clientes` con `unique (empresa_id, id)` (0004), `documentos_venta`/`documentos_venta_lineas` (0004; `producto_id` es NULLABLE — las líneas de proforma van sin producto), `app.tiene_rol_en_empresa(uuid, text[])` (0003).
- Produces: `crear_orden_entrega(p_empresa uuid, p_cliente uuid, p_fecha date, p_destino uuid, p_docum text, p_oc text, p_bultos integer, p_kilos numeric, p_m3 numeric, p_neto integer, p_vehiculo uuid, p_conductor uuid, p_notas text) returns uuid`; `asignar_despacho(p_empresa uuid, p_orden uuid, p_vehiculo uuid, p_conductor uuid) returns void`; `anular_orden_entrega(p_empresa uuid, p_orden uuid, p_motivo text) returns void`; `crear_proforma(p_empresa uuid, p_cliente uuid, p_ordenes uuid[], p_notas text) returns uuid`; `cambiar_estado_proforma(p_empresa uuid, p_proforma uuid, p_estado text, p_motivo text default null) returns void`; `facturar_proforma(p_empresa uuid, p_proforma uuid) returns uuid`; `anular_estado_pago(p_empresa uuid, p_documento uuid) returns void`.
- `facturar_proforma` NO toma folio ni toca `folios_caf`: la nota de venta nace en `borrador` sin folio (igual que `convertir_cotizacion`); el folio se toma al EMITIR vía `tomar_folio`, flujo existente intacto. `anular_estado_pago` es la ÚNICA vía de `facturada → aprobada` y de `ODE facturada → registrada`.

- [ ] **Step 1: Anexar las 7 RPCs a la migración**

Añadir AL FINAL de `supabase/migrations/00000000000016_transporte.sql`:

```sql
-- ================== RPCs del ciclo de transporte (Task 2) ==================
-- security definer + search_path = public; rol via app.tiene_rol_en_empresa;
-- ciclo completo = dueno/admin/vendedor. Anti-TOCTOU: toda validacion de
-- estado/pertenencia corre DESPUES del for update; toda operacion multi-ODE
-- toma locks en orden estable (order by id) antes del UPDATE masivo.

-- ---------- Crear orden de entrega (kilo afecto SIEMPRE server-side) ----------
-- La RPC ni siquiera recibe kilo_afecto: se deriva de kilos/m3/factor de la
-- empresa. El neto SI viene del llamador (negociable, patron cotizaciones);
-- el tarifario es sugerencia de UI con control por visibilidad.
create or replace function public.crear_orden_entrega(
  p_empresa uuid, p_cliente uuid, p_fecha date, p_destino uuid,
  p_docum text, p_oc text, p_bultos integer, p_kilos numeric, p_m3 numeric,
  p_neto integer, p_vehiculo uuid, p_conductor uuid, p_notas text
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_modulo boolean;
  v_factor integer;
  v_kilos numeric;
  v_m3 numeric;
  v_kilo_afecto integer;
  v_numero integer;
  v_orden uuid;
begin
  -- Rol ANTES que modulo (precedente: cambiar_estado_proforma): si el modulo
  -- se consultara primero, el booleano modulo_transporte de una empresa AJENA
  -- seria un oraculo cross-tenant para quien no es miembro. Con el rol primero,
  -- un no-miembro nunca llega a leer ese booleano.
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'vendedor']) then
    raise exception 'Tu rol no permite registrar órdenes de entrega';
  end if;
  select modulo_transporte, factor_volumetrico into v_modulo, v_factor
  from empresas where id = p_empresa;
  -- Cubre empresa inexistente (v_modulo null) y modulo apagado.
  if not coalesce(v_modulo, false) then
    raise exception 'El módulo de transporte no está activo';
  end if;
  -- Cubre inexistente, ajeno e inactivo con el mismo mensaje.
  if not exists (select 1 from clientes where id = p_cliente and empresa_id = p_empresa and activo) then
    raise exception 'Cliente no válido';
  end if;
  if not exists (select 1 from destinos where id = p_destino and empresa_id = p_empresa and activo) then
    raise exception 'Destino no válido';
  end if;
  if p_fecha is null then
    raise exception 'Ingresa la fecha de ingreso';
  end if;
  if p_bultos is null or p_bultos < 1 then
    raise exception 'Los bultos deben ser un entero mayor a 0';
  end if;
  -- Kilos y M3 se redondean a 2 decimales ANTES de validar y de persistir
  -- (numeric(9,2) en tabla): lo validado es exactamente lo que se guarda.
  v_kilos := round(p_kilos, 2);
  if v_kilos is null or v_kilos <= 0 then
    raise exception 'Los kilos deben ser mayores a 0';
  end if;
  if v_kilos > 1000000 then
    raise exception 'Los kilos superan el máximo admitido';
  end if;
  v_m3 := round(p_m3, 2);
  if v_m3 < 0 then
    raise exception 'Los M3 no pueden ser negativos';
  end if;
  -- Con factor <= 10000 (check de tabla), m3 <= 100000 garantiza que
  -- m3 * factor cabe siempre en int4.
  if v_m3 > 100000 then
    raise exception 'Los M3 superan el máximo admitido';
  end if;
  if p_neto is null or p_neto < 1 then
    raise exception 'El neto debe ser un entero mayor a 0';
  end if;
  -- Vehiculo/conductor OPCIONALES al crear (tambien via asignar_despacho).
  if p_vehiculo is not null and not exists (
    select 1 from vehiculos where id = p_vehiculo and empresa_id = p_empresa and activo
  ) then
    raise exception 'Vehículo no válido';
  end if;
  if p_conductor is not null and not exists (
    select 1 from conductores where id = p_conductor and empresa_id = p_empresa and activo
  ) then
    raise exception 'Conductor no válido';
  end if;

  -- Kilo afecto server-side, verificado contra la proforma real del usuario:
  -- max(175, 1.26*250) = 315; max(787, 2.88*250) = 787.
  v_kilo_afecto := round(greatest(v_kilos, coalesce(v_m3, 0) * v_factor))::integer;
  if v_kilo_afecto < 1 then
    raise exception 'La carga es demasiado pequeña para tarifar';
  end if;

  -- Serializa la numeracion por empresa (patron cotizaciones).
  perform pg_advisory_xact_lock(hashtextextended('ordenes_entrega:' || p_empresa::text, 42));
  select coalesce(max(numero), 0) + 1 into v_numero
  from ordenes_entrega where empresa_id = p_empresa;

  insert into ordenes_entrega (
    empresa_id, numero, cliente_id, fecha_ingreso, destino_id, docum, oc_cliente,
    bultos, kilos, m3, kilo_afecto, neto, vehiculo_id, conductor_id, notas
  )
  values (
    p_empresa, v_numero, p_cliente, p_fecha, p_destino,
    nullif(trim(coalesce(p_docum, '')), ''), nullif(trim(coalesce(p_oc, '')), ''),
    p_bultos, v_kilos, v_m3, v_kilo_afecto, p_neto, p_vehiculo, p_conductor,
    nullif(trim(coalesce(p_notas, '')), '')
  )
  returning id into v_orden;

  return v_orden;
end $$;
revoke execute on function public.crear_orden_entrega(uuid, uuid, date, uuid, text, text, integer, numeric, numeric, integer, uuid, uuid, text) from anon, public;
grant execute on function public.crear_orden_entrega(uuid, uuid, date, uuid, text, text, integer, numeric, numeric, integer, uuid, uuid, text) to authenticated;

-- ---------- Asignar despacho (funciona con modulo off; insumo del Plan 12) ----------
create or replace function public.asignar_despacho(
  p_empresa uuid, p_orden uuid, p_vehiculo uuid, p_conductor uuid
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_estado text;
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'vendedor']) then
    raise exception 'Tu rol no permite asignar despachos';
  end if;

  select estado into v_estado
  from ordenes_entrega where id = p_orden and empresa_id = p_empresa
  for update;
  if not found then
    -- Cubre por igual inexistente y de-otro-tenant, sin distinguirlos.
    raise exception 'La orden de entrega no existe';
  end if;
  -- registrada O facturada valen: el despacho fisico es independiente
  -- de la facturacion.
  if v_estado = 'anulada' then
    raise exception 'No se puede asignar despacho a una orden anulada';
  end if;
  if p_vehiculo is not null and not exists (
    select 1 from vehiculos where id = p_vehiculo and empresa_id = p_empresa and activo
  ) then
    raise exception 'Vehículo no válido';
  end if;
  if p_conductor is not null and not exists (
    select 1 from conductores where id = p_conductor and empresa_id = p_empresa and activo
  ) then
    raise exception 'Conductor no válido';
  end if;

  -- null = desasignar: la RPC pisa ambos campos con lo que llega.
  update ordenes_entrega set vehiculo_id = p_vehiculo, conductor_id = p_conductor
  where id = p_orden and empresa_id = p_empresa;
end $$;
revoke execute on function public.asignar_despacho(uuid, uuid, uuid, uuid) from anon, public;
grant execute on function public.asignar_despacho(uuid, uuid, uuid, uuid) to authenticated;

-- ---------- Anular orden de entrega (solo registrada y libre) ----------
create or replace function public.anular_orden_entrega(
  p_empresa uuid, p_orden uuid, p_motivo text
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_orden record;
  v_motivo text;
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'vendedor']) then
    raise exception 'Tu rol no permite anular órdenes de entrega';
  end if;

  select estado, proforma_id into v_orden
  from ordenes_entrega where id = p_orden and empresa_id = p_empresa
  for update;
  if not found then
    raise exception 'La orden de entrega no existe';
  end if;

  v_motivo := nullif(trim(coalesce(p_motivo, '')), '');
  if v_motivo is null then
    raise exception 'La anulación requiere un motivo';
  end if;
  -- Orden de checks FIJADO por contrato: estado ANTES que reserva
  -- (una facturada reservada reclama por estado, no por proforma).
  if v_orden.estado <> 'registrada' then
    raise exception 'Solo se puede anular una orden registrada';
  end if;
  if v_orden.proforma_id is not null then
    raise exception 'La orden está en una proforma; recházala primero';
  end if;

  update ordenes_entrega set estado = 'anulada', motivo_anulacion = v_motivo
  where id = p_orden and empresa_id = p_empresa;
end $$;
revoke execute on function public.anular_orden_entrega(uuid, uuid, text) from anon, public;
grant execute on function public.anular_orden_entrega(uuid, uuid, text) to authenticated;

-- ---------- Crear proforma (agrupa ODEs registradas de UN cliente) ----------
-- IVA REAL sobre el neto TOTAL: round(neto * 0.19) — verificado contra el
-- sistema del usuario (43.289 = round(227.836 * 0.19) <> suma de IVAs por linea).
create or replace function public.crear_proforma(
  p_empresa uuid, p_cliente uuid, p_ordenes uuid[], p_notas text
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_proforma uuid;
  v_numero integer;
  v_ordenes uuid[];
  v_validas integer;
  v_neto bigint;
  v_iva integer;
begin
  -- Rol ANTES que modulo (mismo precedente que crear_orden_entrega y
  -- cambiar_estado_proforma): evita que el booleano modulo_transporte de una
  -- empresa ajena sea un oraculo cross-tenant para un no-miembro.
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'vendedor']) then
    raise exception 'Tu rol no permite gestionar proformas';
  end if;
  if not exists (select 1 from empresas where id = p_empresa and modulo_transporte) then
    raise exception 'El módulo de transporte no está activo';
  end if;
  if coalesce(array_length(p_ordenes, 1), 0) < 1 then
    raise exception 'La proforma necesita al menos una orden de entrega';
  end if;
  -- Dedup: la misma ODE repetida en el array cuenta y se reserva UNA vez.
  select array_agg(distinct x) into v_ordenes from unnest(p_ordenes) x;
  if not exists (select 1 from clientes where id = p_cliente and empresa_id = p_empresa and activo) then
    raise exception 'Cliente no válido';
  end if;

  -- Locks en orden estable ANTES de validar (anti-TOCTOU / anti-deadlock):
  -- dos crear_proforma concurrentes sobre la misma ODE se serializan aqui.
  perform 1 from ordenes_entrega
  where id = any(v_ordenes) and empresa_id = p_empresa
  order by id
  for update;

  -- Un solo conteo post-lock cubre inexistente/ajena, no-registrada,
  -- de otro cliente y ya reservada, con el mismo mensaje.
  select count(*) into v_validas
  from ordenes_entrega
  where id = any(v_ordenes) and empresa_id = p_empresa
    and estado = 'registrada' and cliente_id = p_cliente and proforma_id is null;
  if v_validas <> array_length(v_ordenes, 1) then
    raise exception 'Hay una orden no válida, de otro cliente, ya facturada o en otra proforma';
  end if;

  -- Dinero en bigint: el umbral neto+iva se chequea ANTES de castear a int4
  -- (sin esto, la suma grande revienta con 22003 en vez de un mensaje claro).
  select sum(neto)::bigint into v_neto
  from ordenes_entrega
  where id = any(v_ordenes) and empresa_id = p_empresa;
  if v_neto + round(v_neto * 0.19) > 2147483647 then
    raise exception 'La proforma supera el monto máximo facturable';
  end if;
  v_iva := round(v_neto * 0.19)::integer;

  -- Serializa la numeracion por empresa (display 'PF-' || lpad(numero, 6, '0')).
  perform pg_advisory_xact_lock(hashtextextended('proformas:' || p_empresa::text, 42));
  select coalesce(max(numero), 0) + 1 into v_numero
  from proformas where empresa_id = p_empresa;

  insert into proformas (empresa_id, numero, cliente_id, neto, iva, total, notas)
  values (p_empresa, v_numero, p_cliente, v_neto::integer, v_iva, v_neto::integer + v_iva,
          nullif(trim(coalesce(p_notas, '')), ''))
  returning id into v_proforma;

  update ordenes_entrega set proforma_id = v_proforma
  where id = any(v_ordenes) and empresa_id = p_empresa;

  return v_proforma;
end $$;
revoke execute on function public.crear_proforma(uuid, uuid, uuid[], text) from anon, public;
grant execute on function public.crear_proforma(uuid, uuid, uuid[], text) to authenticated;

-- ---------- Cambiar estado de proforma ('facturada' vetada aqui) ----------
create or replace function public.cambiar_estado_proforma(
  p_empresa uuid, p_proforma uuid, p_estado text, p_motivo text default null
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_actual text;
  v_motivo text;
begin
  -- Rol ANTES del lookup: un rol sin permiso no aprende si la proforma existe.
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'vendedor']) then
    raise exception 'Tu rol no permite gestionar proformas';
  end if;

  -- Lock: una transicion no se cruza con facturar/deshacer en vuelo.
  select estado into v_actual
  from proformas where id = p_proforma and empresa_id = p_empresa
  for update;
  if not found then
    -- Cubre por igual inexistente y de-otro-tenant, sin distinguirlos.
    raise exception 'La proforma no existe';
  end if;

  -- borrador -> enviada | rechazada; enviada -> aprobada | rechazada;
  -- aprobada -> rechazada. 'facturada' SOLO via facturar_proforma;
  -- facturada -> aprobada SOLO via anular_estado_pago.
  if p_estado is null or not (
    (v_actual = 'borrador' and p_estado in ('enviada', 'rechazada')) or
    (v_actual = 'enviada' and p_estado in ('aprobada', 'rechazada')) or
    (v_actual = 'aprobada' and p_estado = 'rechazada')
  ) then
    raise exception 'Transición de estado no válida';
  end if;

  v_motivo := nullif(trim(coalesce(p_motivo, '')), '');
  if p_estado = 'rechazada' and v_motivo is null then
    raise exception 'El rechazo requiere un motivo';
  end if;

  if p_estado = 'rechazada' then
    -- Todo rechazo LIBERA las ODEs: locks ordenados ANTES del update masivo.
    perform 1 from ordenes_entrega
    where proforma_id = p_proforma and empresa_id = p_empresa
    order by id
    for update;
    update ordenes_entrega set proforma_id = null
    where proforma_id = p_proforma and empresa_id = p_empresa;
  end if;

  update proformas
  set estado = p_estado,
      -- p_motivo solo se persiste al rechazar; en el resto queda null.
      motivo_rechazo = case when p_estado = 'rechazada' then v_motivo else null end
  where id = p_proforma and empresa_id = p_empresa;
end $$;
revoke execute on function public.cambiar_estado_proforma(uuid, uuid, text, text) from anon, public;
grant execute on function public.cambiar_estado_proforma(uuid, uuid, text, text) to authenticated;

-- ---------- Facturar proforma (aprobada -> nota de venta en borrador) ----------
-- Sin folio ni folios_caf: el folio se toma al EMITIR (tomar_folio), flujo
-- existente intacto.
create or replace function public.facturar_proforma(p_empresa uuid, p_proforma uuid)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_pf record;
  v_doc uuid;
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'vendedor']) then
    raise exception 'Tu rol no permite facturar proformas';
  end if;

  -- Lock: el check de estado corre DENTRO del lock (doble facturacion imposible).
  select estado, cliente_id, neto, iva, total into v_pf
  from proformas where id = p_proforma and empresa_id = p_empresa
  for update;
  if not found then
    raise exception 'La proforma no existe';
  end if;
  if v_pf.estado <> 'aprobada' then
    raise exception 'Solo se puede facturar una proforma aprobada';
  end if;

  -- Re-lock de SUS ODEs en orden estable y re-validacion post-lock
  -- (cinturon y tirantes: no hay camino natural que las saque de
  -- 'registrada' estando reservadas; se fija igual por contrato).
  perform 1 from ordenes_entrega
  where proforma_id = p_proforma and empresa_id = p_empresa
  order by id
  for update;
  if exists (
    select 1 from ordenes_entrega
    where proforma_id = p_proforma and empresa_id = p_empresa and estado <> 'registrada'
  ) then
    raise exception 'Hay una orden no válida, de otro cliente, ya facturada o en otra proforma';
  end if;

  -- Nota de venta en borrador con los totales DE LA PROFORMA
  -- (flete de carga AFECTO: exento = 0).
  insert into documentos_venta (empresa_id, tipo, cliente_id, estado, neto, exento, iva, total)
  values (p_empresa, 'nota_venta', v_pf.cliente_id, 'borrador', v_pf.neto, 0, v_pf.iva, v_pf.total)
  returning id into v_doc;

  -- Una linea por ODE, SIN producto (no contamina ventas_por_producto).
  -- left(..., 80) = tope NmbItem del DTE SII (evita rechazos con SimpleAPI).
  insert into documentos_venta_lineas (empresa_id, documento_id, producto_id, descripcion, cantidad, precio_neto, exenta, subtotal)
  select o.empresa_id, v_doc, null::uuid,
         left('ODE N° ' || o.numero || ' ' || d.nombre || coalesce(' — guías ' || o.docum, ''), 80),
         1, o.neto, false, o.neto
  from ordenes_entrega o
  join destinos d on d.id = o.destino_id and d.empresa_id = o.empresa_id
  where o.proforma_id = p_proforma and o.empresa_id = p_empresa
  order by o.numero;

  update ordenes_entrega set estado = 'facturada', documento_venta_id = v_doc
  where proforma_id = p_proforma and empresa_id = p_empresa;

  update proformas set estado = 'facturada', documento_venta_id = v_doc
  where id = p_proforma and empresa_id = p_empresa;

  return v_doc;
end $$;
revoke execute on function public.facturar_proforma(uuid, uuid) from anon, public;
grant execute on function public.facturar_proforma(uuid, uuid) to authenticated;

-- ---------- Deshacer estado de pago (reversa total de facturar_proforma) ----------
-- Acepta: nota de venta en borrador SIN folio (nada consumido) O DTE
-- factura/boleta RECHAZADO por el SII (folio consumido = gap justificable).
-- Con factura ACEPTADA: nota de credito, nada se libera (v1).
create or replace function public.anular_estado_pago(p_empresa uuid, p_documento uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_doc record;
  v_proforma uuid;
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'vendedor']) then
    raise exception 'Tu rol no permite anular estados de pago';
  end if;

  select tipo, estado, folio into v_doc
  from documentos_venta where id = p_documento and empresa_id = p_empresa
  for update;
  if not found then
    raise exception 'El documento no existe';
  end if;

  -- Solo documentos nacidos de una proforma son deshacibles por aqui:
  -- una nota de venta de comercio en borrador NO entra por esta puerta.
  select id into v_proforma
  from proformas where documento_venta_id = p_documento and empresa_id = p_empresa
  for update;
  if not found then
    raise exception 'El documento no proviene de una proforma';
  end if;

  if not (
    (v_doc.tipo = 'nota_venta' and v_doc.estado = 'borrador' and v_doc.folio is null) or
    (v_doc.tipo in ('factura', 'boleta') and v_doc.estado = 'rechazado')
  ) then
    raise exception 'Solo se puede deshacer un estado de pago en borrador o rechazado';
  end if;

  -- Reversa: locks ordenados; las ODEs vuelven a 'registrada' CONSERVANDO
  -- proforma_id (la proforma vuelve a 'aprobada' con su nomina intacta).
  perform 1 from ordenes_entrega
  where documento_venta_id = p_documento and empresa_id = p_empresa
  order by id
  for update;
  update ordenes_entrega set estado = 'registrada', documento_venta_id = null
  where documento_venta_id = p_documento and empresa_id = p_empresa;

  update proformas set estado = 'aprobada', documento_venta_id = null
  where id = v_proforma and empresa_id = p_empresa;

  -- El definer borra lineas y documento (authenticated no tiene delete;
  -- las FK a este doc ya quedaron en null arriba).
  delete from documentos_venta_lineas where documento_id = p_documento and empresa_id = p_empresa;
  delete from documentos_venta where id = p_documento and empresa_id = p_empresa;
end $$;
revoke execute on function public.anular_estado_pago(uuid, uuid) from anon, public;
grant execute on function public.anular_estado_pago(uuid, uuid) to authenticated;
```

- [ ] **Step 2: Aplicar y verificar**

Run: `pnpm supabase db reset` → aplica 0001-0016 sin errores.
Run: `pnpm supabase test db` → los 134 asserts existentes siguen verdes.

Smoke de privilegios (las 7 de una vez):

```
docker exec supabase_db_ERP_Transportes psql -U postgres -d postgres -c "select proname, has_function_privilege('anon', oid, 'execute') as anon, has_function_privilege('authenticated', oid, 'execute') as auth from pg_proc where proname in ('crear_orden_entrega','asignar_despacho','anular_orden_entrega','crear_proforma','cambiar_estado_proforma','facturar_proforma','anular_estado_pago') order by proname;"
```

→ 7 filas, `anon = f` y `auth = t` en TODAS.

Smoke funcional por RPC (superuser sin JWT: `auth.uid()` es null → las 7 RPCs validan el rol ANTES que cualquier otra cosa, así que el primer guard SIEMPRE es el de rol, incluidas las dos que además exigen módulo activo):

```
docker exec supabase_db_ERP_Transportes psql -U postgres -d postgres -c "select crear_orden_entrega('00000000-0000-0000-0000-000000000001', null, null, null, null, null, null, null, null, null, null, null, null);"
```
→ `ERROR:  Tu rol no permite registrar órdenes de entrega`

```
docker exec supabase_db_ERP_Transportes psql -U postgres -d postgres -c "select crear_proforma('00000000-0000-0000-0000-000000000001', null, null, null);"
```
→ `ERROR:  Tu rol no permite gestionar proformas`

```
docker exec supabase_db_ERP_Transportes psql -U postgres -d postgres -c "select asignar_despacho('00000000-0000-0000-0000-000000000001', gen_random_uuid(), null, null);"
```
→ `ERROR:  Tu rol no permite asignar despachos`

```
docker exec supabase_db_ERP_Transportes psql -U postgres -d postgres -c "select anular_orden_entrega('00000000-0000-0000-0000-000000000001', gen_random_uuid(), 'x');"
```
→ `ERROR:  Tu rol no permite anular órdenes de entrega`

```
docker exec supabase_db_ERP_Transportes psql -U postgres -d postgres -c "select cambiar_estado_proforma('00000000-0000-0000-0000-000000000001', gen_random_uuid(), 'enviada');"
```
→ `ERROR:  Tu rol no permite gestionar proformas`

```
docker exec supabase_db_ERP_Transportes psql -U postgres -d postgres -c "select facturar_proforma('00000000-0000-0000-0000-000000000001', gen_random_uuid());"
```
→ `ERROR:  Tu rol no permite facturar proformas`

```
docker exec supabase_db_ERP_Transportes psql -U postgres -d postgres -c "select anular_estado_pago('00000000-0000-0000-0000-000000000001', gen_random_uuid());"
```
→ `ERROR:  Tu rol no permite anular estados de pago`

(Los caminos felices y el resto de la matriz de mensajes quedan fijados por pgTAP en la task siguiente.)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/00000000000016_transporte.sql
git commit -m "feat(db): RPCs del ciclo de transporte — ODEs, despacho, proformas y estado de pago"
```

---
### Task 3: pgTAP de transporte

**Files:**
- Create: `supabase/tests/database/transporte.test.sql`

**Interfaces:**
- Consumes: migración 0016 (Tasks 1-2): tablas `vehiculos`/`conductores`/`destinos`/`ordenes_entrega`/`proformas`, las 7 RPCs (`crear_orden_entrega`, `asignar_despacho`, `anular_orden_entrega`, `crear_proforma`, `cambiar_estado_proforma`, `facturar_proforma`, `anular_estado_pago`), el endurecimiento de `empresas` y `documentos_venta`/`documentos_venta_lineas` (0004).
- RUTs NUEVOS reservados para este archivo (válidos módulo 11; únicos GLOBALES — sin colisión con tests `7611/7622/7633/7644/7655/7666/7677/76543210x`, seed `771234569`/`778899000` ni E2E `999999999`/`888888888`): `768888884` (Org/Empresa A), `761112228` (Org/Empresa B), `761234560` (Cliente A), `762223333` (Cliente Inactivo A), `763334449` (Cliente B). Conductores con DV real: `123456785` (Carlos Soto), `111111111` (inactivo), `222222222` (Chofer B); `123456780` es DELIBERADAMENTE inválido (el DV correcto de 12345678 es 5) para el CHECK.
- Presupuesto EXACTO de `plan(59)` — los 34 mensajes del contrato §4 quedan TODOS testeados al menos una vez. Los ítems del spec §8 cuyo mensaje se repite quedan cubiertos por el assert canónico de ese mensaje y/o por SETUP que aborta el archivo si falla (documentado inline): feliz de crear_proforma → assert 29 (totales); duplicados→una vez → assert 29 (un doble conteo daría 369586, no 227836); rechazo desde enviada libera → la creación de P3 con la MISMA ODE (setup) + assert 39; correlativo de proformas → assert 39 (numero 3); no-aprobada de facturar → assert 48 (mismo mensaje que el doble); doble-anular → assert 50 (mismo mensaje de estado); módulo off en crear_proforma → assert 1 (mismo mensaje); vendedor permitido → setup de la ODE 2 + assert 2; cliente/vehículo inactivos en crear_orden_entrega → asserts 33 y 43 (mismos mensajes, guardas hermanas testeadas en 10 y 11); cross-tenant DIRECTO de crear_proforma/anular_orden/facturar contra un blanco de empresa B → asserts 31/45/46 (ya no solo por identidad de mensaje: cada uno apunta a un objeto real de B); cross-tenant de cambiar_estado_proforma → assert 37 (mismo mecanismo, blanco de B).
- Fixtures de B (`ordenes_entrega`/`proformas`) y la simulación de emisión/rechazo SII se hacen como superuser vía `reset role` (patrón cotizaciones.test.sql: el fixture directo salta grants y RLS a propósito).

- [ ] **Step 1: Escribir el test**

`supabase/tests/database/transporte.test.sql`:

```sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(59);

insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'ana@a.cl'),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'beto@b.cl'),
  ('00000000-0000-0000-0000-000000000000', '55555555-5555-5555-5555-555555555555', 'authenticated', 'authenticated', 'ces@a.cl'),
  ('00000000-0000-0000-0000-000000000000', '66666666-6666-6666-6666-666666666666', 'authenticated', 'authenticated', 'dora@a.cl'),
  ('00000000-0000-0000-0000-000000000000', '77777777-7777-7777-7777-777777777777', 'authenticated', 'authenticated', 'vero@a.cl');

-- RUT nuevos, únicos GLOBALES: no colisionan con otros tests (7611/7622/7633/7644/7655/7666/7677/76543210x),
-- el seed (771234569, 778899000) ni los E2E (999999999, 888888888).
insert into public.organizaciones (id, rut, razon_social)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '768888884', 'Org A'),
       ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '761112228', 'Org B');

-- La empresa A nace con el módulo ACTIVO (factor default 250); la B queda con el default (off).
insert into public.empresas (id, organizacion_id, rut, razon_social, modulo_transporte)
values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '768888884', 'Transportes A', true),
       ('eeeeeeee-0000-0000-0000-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '761112228', 'Empresa B', false);

insert into public.miembros (usuario_id, organizacion_id, rol)
values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'dueno'),
       ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'dueno'),
       ('55555555-5555-5555-5555-555555555555', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'contador'),
       ('66666666-6666-6666-6666-666666666666', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bodeguero'),
       ('77777777-7777-7777-7777-777777777777', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'vendedor');

insert into public.clientes (id, empresa_id, rut, razon_social)
values ('cccccccc-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '761234560', 'Cliente A'),
       ('cccccccc-0000-0000-0000-bbbbbbbbbbbb', 'eeeeeeee-0000-0000-0000-bbbbbbbbbbbb', '763334449', 'Cliente B');
insert into public.clientes (id, empresa_id, rut, razon_social, activo)
values ('cccccccc-1111-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '762223333', 'Cliente Inactivo', false);

-- Flota: VA activo de A; VB de B (para "vehículo ajeno"); KA activo, KI inactivo, KB de B.
insert into public.vehiculos (id, empresa_id, patente, descripcion)
values ('aaaa0001-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'ABCD12', 'Camión 3/4'),
       ('aaaa0002-0000-0000-0000-bbbbbbbbbbbb', 'eeeeeeee-0000-0000-0000-bbbbbbbbbbbb', 'WXYZ89', 'Camión B');
insert into public.conductores (id, empresa_id, rut, nombre)
values ('bbbb0001-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '123456785', 'Carlos Soto'),
       ('bbbb0003-0000-0000-0000-bbbbbbbbbbbb', 'eeeeeeee-0000-0000-0000-bbbbbbbbbbbb', '222222222', 'Chofer B');
insert into public.conductores (id, empresa_id, rut, nombre, activo)
values ('bbbb0002-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '111111111', 'Pedro Retirado', false);

-- Tarifario: Coyhaique $450/kg (la fila real: 315 × 450 = 141750), Puerto Aysén $120/kg; Castro es de B.
insert into public.destinos (id, empresa_id, nombre, tarifa_kg)
values ('dddd0001-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'Coyhaique', 450),
       ('dddd0002-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'Puerto Aysén', 120),
       ('dddd0003-0000-0000-0000-bbbbbbbbbbbb', 'eeeeeeee-0000-0000-0000-bbbbbbbbbbbb', 'Castro', 300);

-- Fixtures de B por insert directo (superuser salta grants/RLS a propósito, patrón cotizaciones):
-- OB y PB son los blancos cross-tenant y las filas del aislamiento de Beto.
insert into public.ordenes_entrega (id, empresa_id, numero, cliente_id, fecha_ingreso, destino_id, bultos, kilos, kilo_afecto, neto)
values ('0de00001-0000-0000-0000-bbbbbbbbbbbb', 'eeeeeeee-0000-0000-0000-bbbbbbbbbbbb', 1,
        'cccccccc-0000-0000-0000-bbbbbbbbbbbb', current_date, 'dddd0003-0000-0000-0000-bbbbbbbbbbbb', 1, 10, 10, 1000);
insert into public.proformas (id, empresa_id, numero, cliente_id, neto, iva, total)
values ('ff000001-0000-0000-0000-bbbbbbbbbbbb', 'eeeeeeee-0000-0000-0000-bbbbbbbbbbbb', 1,
        'cccccccc-0000-0000-0000-bbbbbbbbbbbb', 1000, 190, 1190);

-- Documentos: DVA0 = nota de venta de COMERCIO de A (jamás vino de una proforma); DVB = doc de B.
insert into public.documentos_venta (id, empresa_id, tipo, cliente_id)
values ('d0c00001-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'nota_venta', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa'),
       ('d0c00002-0000-0000-0000-bbbbbbbbbbbb', 'eeeeeeee-0000-0000-0000-bbbbbbbbbbbb', 'nota_venta', 'cccccccc-0000-0000-0000-bbbbbbbbbbbb');

-- ===== Ana (dueña A): las ODEs reales de su pantalla =====
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- Setup: ODE 1 = la fila REAL de PF-000004 (175 kg / 1.26 M3), con despacho asignado AL CREAR.
-- Si crear_orden_entrega fallara, el archivo entero aborta (feliz cubierto sin assert propio).
select crear_orden_entrega('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
  current_date, 'dddd0001-0000-0000-0000-aaaaaaaaaaaa', 'GD 4521, GD 4522', 'OC-9014',
  2, 175, 1.26, 141750, 'aaaa0001-0000-0000-0000-aaaaaaaaaaaa', 'bbbb0001-0000-0000-0000-aaaaaaaaaaaa', null);

-- Setup: Vero (vendedora) registra la ODE 2 (787 kg / 2.88 M3): el rol vendedor SÍ opera el ciclo.
set local request.jwt.claims to '{"sub": "77777777-7777-7777-7777-777777777777", "role": "authenticated"}';
select crear_orden_entrega('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
  current_date, 'dddd0002-0000-0000-0000-aaaaaaaaaaaa', 'GD 4600', null,
  5, 787, 2.88, 86086, null, null, null);

-- Setup: Ana sube el factor a 300 y registra la ODE 3 (100 kg / 1.00 M3: gana el volumen, 300).
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
update public.empresas set factor_volumetrico = 300 where id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa';
select crear_orden_entrega('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
  current_date, 'dddd0002-0000-0000-0000-aaaaaaaaaaaa', null, null,
  1, 100, 1.00, 30000, null, null, 'Carga voluminosa');

-- Setup: Ana apaga el módulo (el toggle bloquea crear_*; NO borra ni esconde datos).
update public.empresas set modulo_transporte = false where id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa';

-- 1) Con el módulo apagado no se registran ODEs (crear_proforma comparte guard y mensaje).
select throws_ok(
  $$select crear_orden_entrega('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
    current_date, 'dddd0001-0000-0000-0000-aaaaaaaaaaaa', null, null, 1, 10, null, 1000, null, null, null)$$,
  'P0001', 'El módulo de transporte no está activo',
  'con el módulo apagado no se registran órdenes de entrega'
);

-- 2) Con el módulo apagado la RLS NO cambia (las 3 ODEs siguen visibles) y el kilo afecto
--    persistido es el server-side: los DOS valores reales de su proforma y el factor 300.
select results_eq(
  $$select numero, kilo_afecto from ordenes_entrega
    where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' order by numero$$,
  $$values (1, 315), (2, 787), (3, 300)$$,
  'kilo afecto server-side (max(175, 1.26×250)=315; max(787, 2.88×250)=787; 1.00×300=300), correlativo secuencial y RLS intacta con módulo off'
);

-- Setup: módulo de vuelta.
update public.empresas set modulo_transporte = true where id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa';

-- ===== Matriz de roles: contador y bodeguero NO operan NINGUNA de las 7 RPCs =====
set local request.jwt.claims to '{"sub": "66666666-6666-6666-6666-666666666666", "role": "authenticated"}';

-- 3) Dora (bodeguera) no registra ODEs.
select throws_ok(
  $$select crear_orden_entrega('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
    current_date, 'dddd0001-0000-0000-0000-aaaaaaaaaaaa', null, null, 1, 10, null, 1000, null, null, null)$$,
  'P0001', 'Tu rol no permite registrar órdenes de entrega',
  'la bodeguera no puede registrar órdenes de entrega'
);

-- 4) Dora no anula ODEs.
select throws_ok(
  $$select anular_orden_entrega('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from ordenes_entrega where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1),
    'Error de digitación')$$,
  'P0001', 'Tu rol no permite anular órdenes de entrega',
  'la bodeguera no puede anular órdenes de entrega'
);

-- 5) Dora no gestiona proformas (el rol se valida ANTES del lookup: el blanco es de B y aun así el mensaje es de rol).
select throws_ok(
  $$select cambiar_estado_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    'ff000001-0000-0000-0000-bbbbbbbbbbbb', 'enviada')$$,
  'P0001', 'Tu rol no permite gestionar proformas',
  'la bodeguera no puede gestionar proformas (rol antes del lookup)'
);

-- 6) Dora no anula estados de pago.
select throws_ok(
  $$select anular_estado_pago('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'd0c00001-0000-0000-0000-aaaaaaaaaaaa')$$,
  'P0001', 'Tu rol no permite anular estados de pago',
  'la bodeguera no puede anular estados de pago'
);

set local request.jwt.claims to '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated"}';

-- 7) Ces (contador) no asigna despachos.
select throws_ok(
  $$select asignar_despacho('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from ordenes_entrega where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1),
    null, null)$$,
  'P0001', 'Tu rol no permite asignar despachos',
  'el contador no puede asignar despachos'
);

-- 8) Ces no crea proformas.
select throws_ok(
  $$select crear_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
    array[(select id from ordenes_entrega where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1)],
    null)$$,
  'P0001', 'Tu rol no permite gestionar proformas',
  'el contador no puede crear proformas'
);

-- 9) Ces no factura proformas.
select throws_ok(
  $$select facturar_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'ff000001-0000-0000-0000-bbbbbbbbbbbb')$$,
  'P0001', 'Tu rol no permite facturar proformas',
  'el contador no puede facturar proformas'
);

-- ===== Ana: validaciones de crear_orden_entrega =====
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- 10) Destino ajeno (mismo mensaje que inexistente o inactivo).
select throws_ok(
  $$select crear_orden_entrega('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
    current_date, 'dddd0003-0000-0000-0000-bbbbbbbbbbbb', null, null, 1, 10, null, 1000, null, null, null)$$,
  'P0001', 'Destino no válido',
  'no se tarifa contra un destino de otra empresa'
);

-- 11) Conductor inactivo (misma guarda que el vehículo; 'Vehículo no válido' se testea en asignar_despacho).
select throws_ok(
  $$select crear_orden_entrega('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
    current_date, 'dddd0001-0000-0000-0000-aaaaaaaaaaaa', null, null, 1, 10, null, 1000,
    null, 'bbbb0002-0000-0000-0000-aaaaaaaaaaaa', null)$$,
  'P0001', 'Conductor no válido',
  'un conductor inactivo no recibe despachos al crear'
);

-- 12) Fecha de ingreso obligatoria.
select throws_ok(
  $$select crear_orden_entrega('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
    null, 'dddd0001-0000-0000-0000-aaaaaaaaaaaa', null, null, 1, 10, null, 1000, null, null, null)$$,
  'P0001', 'Ingresa la fecha de ingreso',
  'la fecha de ingreso es obligatoria'
);

-- 13) Bultos 0.
select throws_ok(
  $$select crear_orden_entrega('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
    current_date, 'dddd0001-0000-0000-0000-aaaaaaaaaaaa', null, null, 0, 10, null, 1000, null, null, null)$$,
  'P0001', 'Los bultos deben ser un entero mayor a 0',
  'los bultos no pueden ser 0'
);

-- 14) Kilos 0.
select throws_ok(
  $$select crear_orden_entrega('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
    current_date, 'dddd0001-0000-0000-0000-aaaaaaaaaaaa', null, null, 1, 0, null, 1000, null, null, null)$$,
  'P0001', 'Los kilos deben ser mayores a 0',
  'los kilos no pueden ser 0'
);

-- 15) Tope de kilos (1.000.000).
select throws_ok(
  $$select crear_orden_entrega('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
    current_date, 'dddd0001-0000-0000-0000-aaaaaaaaaaaa', null, null, 1, 1000001, null, 1000, null, null, null)$$,
  'P0001', 'Los kilos superan el máximo admitido',
  'los kilos tienen tope: 1000001 se rechaza con mensaje claro, no con overflow'
);

-- 16) M3 negativos.
select throws_ok(
  $$select crear_orden_entrega('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
    current_date, 'dddd0001-0000-0000-0000-aaaaaaaaaaaa', null, null, 1, 10, -0.5, 1000, null, null, null)$$,
  'P0001', 'Los M3 no pueden ser negativos',
  'los M3 no pueden ser negativos'
);

-- 17) Tope de M3 (100.000): con factor ≤ 10000 el producto siempre cabe en int4.
select throws_ok(
  $$select crear_orden_entrega('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
    current_date, 'dddd0001-0000-0000-0000-aaaaaaaaaaaa', null, null, 1, 10, 100001, 1000, null, null, null)$$,
  'P0001', 'Los M3 superan el máximo admitido',
  'los M3 tienen tope: 100001 se rechaza con mensaje claro'
);

-- 18) Neto 0 (el neto lo manda el llamador, pero entero >= 1).
select throws_ok(
  $$select crear_orden_entrega('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
    current_date, 'dddd0001-0000-0000-0000-aaaaaaaaaaaa', null, null, 1, 10, null, 0, null, null, null)$$,
  'P0001', 'El neto debe ser un entero mayor a 0',
  'el neto no puede ser 0'
);

-- 19) 0.4 kg sin M3: round(max(0.4, 0)) = 0 kg afecto — demasiado pequeño para tarifar.
select throws_ok(
  $$select crear_orden_entrega('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
    current_date, 'dddd0001-0000-0000-0000-aaaaaaaaaaaa', null, null, 1, 0.4, null, 1000, null, null, null)$$,
  'P0001', 'La carga es demasiado pequeña para tarifar',
  'una carga de 0.4 kg sin volumen no se puede tarifar'
);

-- ===== Escritura directa denegada: TODO entra por RPC (patrón cotizaciones assert 26) =====

-- 20) insert directo a ordenes_entrega.
select throws_ok(
  $$insert into ordenes_entrega (empresa_id, numero, cliente_id, fecha_ingreso, destino_id, bultos, kilos, kilo_afecto, neto)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 999, 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
            current_date, 'dddd0001-0000-0000-0000-aaaaaaaaaaaa', 1, 10, 10, 1000)$$,
  '42501', 'permission denied for table ordenes_entrega',
  'authenticated no puede insertar directamente en ordenes_entrega'
);

-- 21) update directo a ordenes_entrega.
select throws_ok(
  $$update ordenes_entrega set neto = 999999
    where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1$$,
  '42501', 'permission denied for table ordenes_entrega',
  'authenticated no puede actualizar directamente ordenes_entrega'
);

-- 22) insert directo a proformas.
select throws_ok(
  $$insert into proformas (empresa_id, numero, cliente_id, neto, iva, total)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 999, 'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 0, 0, 0)$$,
  '42501', 'permission denied for table proformas',
  'authenticated no puede insertar directamente en proformas'
);

-- 23) update directo a proformas.
select throws_ok(
  $$update proformas set estado = 'aprobada'
    where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'$$,
  '42501', 'permission denied for table proformas',
  'authenticated no puede actualizar directamente proformas'
);

-- ===== CHECKs de BD y endurecimiento de empresas =====

-- 24) Patente fuera de los dos formatos chilenos (AAAA99 / AA9999).
select throws_ok(
  $$insert into vehiculos (empresa_id, patente)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'ABC123')$$,
  '23514', null,
  'una patente fuera de formato se rechaza por CHECK'
);

-- 25) RUT de conductor con DV incorrecto (el DV real de 12345678 es 5).
select throws_ok(
  $$insert into conductores (empresa_id, rut, nombre)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '123456780', 'Chofer Falso')$$,
  '23514', null,
  'un RUT de conductor inválido se rechaza por CHECK'
);

-- 26) Destino duplicado case-insensitive ('coyhaique' choca con 'Coyhaique').
select throws_ok(
  $$insert into destinos (empresa_id, nombre, tarifa_kg)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'coyhaique', 500)$$,
  '23505', null,
  'el tarifario no admite el mismo destino con otra capitalización'
);

-- 27) Factor volumétrico fuera de rango (tope 10000).
select throws_ok(
  $$update empresas set factor_volumetrico = 10001
    where id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'$$,
  '23514', null,
  'el factor volumétrico tiene tope 10000 por CHECK'
);

-- 28) organizacion_id quedó FUERA del grant por columnas: ni la dueña puede moverse de organización.
select throws_ok(
  $$update empresas set organizacion_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
    where id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'$$,
  '42501', 'permission denied for table empresas',
  'la dueña no puede reasignar la empresa a otra organización'
);

-- ===== crear_proforma: la proforma REAL de su pantalla =====

-- Setup: P1 con las DOS ODEs reales; la ODE 1 va DUPLICADA en el array a propósito
-- (si contara dos veces, el neto daría 369586 y el assert 29 fallaría).
select crear_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
  array[
    (select id from ordenes_entrega where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1),
    (select id from ordenes_entrega where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1),
    (select id from ordenes_entrega where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 2)
  ], 'Consolidado Coyhaique');

-- 29) Totales DORADOS de la pantalla real: 141750 + 86086 = 227836; IVA sobre el neto TOTAL.
select is(
  (select neto::text || '/' || iva::text || '/' || total::text
   from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1),
  '227836/43289/271125',
  'los totales de su sistema real: neto 227836, iva 43289 (round(227836×0.19)), total 271125; la ODE duplicada contó una sola vez'
);

-- 30) Una ODE ya reservada no entra en otra proforma (mismo guard y mensaje cubren la ODE cross-tenant).
select throws_ok(
  $$select crear_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
    array[(select id from ordenes_entrega where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1)],
    null)$$,
  'P0001', 'Hay una orden no válida, de otro cliente, ya facturada o en otra proforma',
  'una ODE reservada no entra en una segunda proforma'
);

-- 31) crear_proforma con una ODE de B en el array (cross-tenant DIRECTO: la ODE
--     de B nunca cumple empresa_id = A, así que cae en el mismo conteo post-lock).
select throws_ok(
  $$select crear_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
    array['0de00001-0000-0000-0000-bbbbbbbbbbbb'::uuid], null)$$,
  'P0001', 'Hay una orden no válida, de otro cliente, ya facturada o en otra proforma',
  'una ODE de otra empresa en el array no arma una proforma'
);

-- 32) Proforma vacía.
select throws_ok(
  $$select crear_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
    array[]::uuid[], null)$$,
  'P0001', 'La proforma necesita al menos una orden de entrega',
  'una proforma no se crea sin ODEs'
);

-- 33) Cliente desactivado (mismo mensaje que inexistente o ajeno; cubre también la guarda de crear_orden_entrega).
select throws_ok(
  $$select crear_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-1111-0000-0000-aaaaaaaaaaaa',
    array[(select id from ordenes_entrega where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 3)],
    null)$$,
  'P0001', 'Cliente no válido',
  'no se factura a un cliente desactivado'
);

-- Setup: ODE 4 con neto 1.900.000.000 (cabe en int4; neto + IVA no).
select crear_orden_entrega('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
  current_date, 'dddd0002-0000-0000-0000-aaaaaaaaaaaa', null, null,
  1, 1000, null, 1900000000, null, null, null);

-- 34) Overflow BORDE: Σ netos ≤ 2147483647 pero neto + round(neto×0.19) = 2.261.000.000 lo supera
--     — mensaje del contrato, JAMÁS un 22003 crudo.
select throws_ok(
  $$select crear_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
    array[(select id from ordenes_entrega where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 4)],
    null)$$,
  'P0001', 'La proforma supera el monto máximo facturable',
  'el overflow de int4 en neto+iva se ataja con el mensaje del contrato, no con 22003'
);

-- ===== Transiciones de proforma =====

-- 35) 'facturada' está vetada en la RPC de estado (y borrador→facturada es además inválida).
select throws_ok(
  $$select cambiar_estado_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1), 'facturada')$$,
  'P0001', 'Transición de estado no válida',
  'facturada solo se alcanza vía facturar_proforma'
);

-- 36) Motivo de puro whitespace = motivo vacío (nullif/trim los iguala).
select throws_ok(
  $$select cambiar_estado_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1), 'rechazada', '   ')$$,
  'P0001', 'El rechazo requiere un motivo',
  'el motivo de rechazo no puede ser vacío ni whitespace'
);

-- 37) La proforma de B "no existe" para la empresa A.
select throws_ok(
  $$select cambiar_estado_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    'ff000001-0000-0000-0000-bbbbbbbbbbbb', 'enviada')$$,
  'P0001', 'La proforma no existe',
  'una proforma de otra empresa da el mismo mensaje que una inexistente'
);

-- ===== Prospectividad: subir tarifa y factor NO recalcula lo persistido =====
update public.destinos set tarifa_kg = 999
where id = 'dddd0001-0000-0000-0000-aaaaaaaaaaaa' and empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa';
update public.empresas set factor_volumetrico = 500 where id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa';

-- 38) La ODE 1 (315/141750), la ODE 3 (300: nació con factor 300, no 500) y la proforma quedan INTACTAS.
select is(
  (select o1.kilo_afecto::text || '/' || o1.neto::text || '/' || o3.kilo_afecto::text || '/' || p.neto::text || '/' || p.total::text
   from ordenes_entrega o1, ordenes_entrega o3, proformas p
   where o1.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and o1.numero = 1
     and o3.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and o3.numero = 3
     and p.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and p.numero = 1),
  '315/141750/300/227836/271125',
  'prospectividad: subir la tarifa (450 a 999) y el factor (300 a 500) no recalcula ODEs ni proformas existentes'
);

-- ===== Rechazos que LIBERAN (desde enviada y desde aprobada) =====

-- Setup: ODE 5 y P2; P2 se rechaza desde ENVIADA.
select crear_orden_entrega('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
  current_date, 'dddd0002-0000-0000-0000-aaaaaaaaaaaa', null, null,
  1, 50, null, 6000, null, null, null);
select crear_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
  array[(select id from ordenes_entrega where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 5)], null);
select cambiar_estado_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 2), 'enviada');
select cambiar_estado_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 2), 'rechazada', 'El cliente no aceptó la tarifa');

-- Setup: P3 con la MISMA ODE — esta creación PRUEBA que el rechazo desde enviada la liberó
-- (si no, 'Hay una orden no válida...' abortaría el archivo). P3 llega a aprobada y se rechaza.
select crear_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
  array[(select id from ordenes_entrega where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 5)], null);
select cambiar_estado_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 3), 'enviada');
select cambiar_estado_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 3), 'aprobada');
select cambiar_estado_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 3), 'rechazada', 'Se cayó el negocio');

-- 39) El rechazo desde APROBADA libera la ODE; el correlativo de proformas es secuencial (P3 = 3).
select is(
  (select p.numero::text || '/' || p.estado || '/' || coalesce(o.proforma_id::text, 'libre') || '/' || o.estado
   from proformas p, ordenes_entrega o
   where p.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and p.numero = 3
     and o.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and o.numero = 5),
  '3/rechazada/libre/registrada',
  'el rechazo desde aprobada libera la ODE (y el desde enviada también: P3 pudo re-reservarla) con correlativo 3'
);

-- ===== anular_orden_entrega y asignar_despacho =====

-- 40) La anulación exige motivo (whitespace = vacío).
select throws_ok(
  $$select anular_orden_entrega('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from ordenes_entrega where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 5), '   ')$$,
  'P0001', 'La anulación requiere un motivo',
  'la anulación no acepta motivo vacío ni whitespace'
);

-- 41) Una ODE reservada en una proforma no se anula (el orden de checks pone estado ANTES que reserva).
select throws_ok(
  $$select anular_orden_entrega('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from ordenes_entrega where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1),
    'Error de digitación')$$,
  'P0001', 'La orden está en una proforma; recházala primero',
  'una ODE reservada exige rechazar la proforma antes de anularse'
);

-- Setup: anulación feliz de la ODE 5 (libre); si fallara, el archivo aborta.
select anular_orden_entrega('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from ordenes_entrega where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 5),
  'Carga retirada por el cliente');

-- 42) A una ODE anulada no se le asigna despacho.
select throws_ok(
  $$select asignar_despacho('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from ordenes_entrega where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 5),
    'aaaa0001-0000-0000-0000-aaaaaaaaaaaa', 'bbbb0001-0000-0000-0000-aaaaaaaaaaaa')$$,
  'P0001', 'No se puede asignar despacho a una orden anulada',
  'una ODE anulada no recibe despacho'
);

-- 43) Vehículo de otra empresa (mismo mensaje que inexistente o inactivo).
select throws_ok(
  $$select asignar_despacho('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from ordenes_entrega where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 2),
    'aaaa0002-0000-0000-0000-bbbbbbbbbbbb', null)$$,
  'P0001', 'Vehículo no válido',
  'no se despacha con un vehículo de otra empresa'
);

-- 44) La ODE de B "no existe" para asignar_despacho.
select throws_ok(
  $$select asignar_despacho('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    '0de00001-0000-0000-0000-bbbbbbbbbbbb', null, null)$$,
  'P0001', 'La orden de entrega no existe',
  'una ODE de otra empresa da el mismo mensaje que una inexistente'
);

-- 45) La ODE de B "no existe" para anular_orden_entrega (cross-tenant DIRECTO, no solo por
--     identidad de mensaje con el assert 44).
select throws_ok(
  $$select anular_orden_entrega('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    '0de00001-0000-0000-0000-bbbbbbbbbbbb', 'Motivo cualquiera')$$,
  'P0001', 'La orden de entrega no existe',
  'anular_orden_entrega contra una ODE de otra empresa da el mismo mensaje que una inexistente'
);

-- 46) La proforma de B "no existe" para facturar_proforma (cross-tenant DIRECTO).
select throws_ok(
  $$select facturar_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    'ff000001-0000-0000-0000-bbbbbbbbbbbb')$$,
  'P0001', 'La proforma no existe',
  'facturar_proforma contra una proforma de otra empresa da el mismo mensaje que una inexistente'
);

-- ===== Ciclo completo: P1 enviada, aprobada y facturada =====
select cambiar_estado_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1), 'enviada');
select cambiar_estado_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1), 'aprobada');
select facturar_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1));

-- 47) La nota de venta nace en borrador, enlazada, con 2 líneas SIN producto y la descripción
--     'ODE N° <n> <destino> — guías <docum>' recortada a 80 (tope NmbItem del DTE), exenta = false.
select is(
  (select d.tipo || '/' || d.estado || '/' || d.total::text || '/'
        || (select count(*)::text from documentos_venta_lineas l2
            where l2.documento_id = d.id and l2.empresa_id = d.empresa_id) || '/'
        || l.precio_neto::text || '/' || l.exenta::text || '/' || l.descripcion
   from proformas p
   join documentos_venta d on d.id = p.documento_venta_id and d.empresa_id = p.empresa_id
   join documentos_venta_lineas l on l.documento_id = d.id and l.empresa_id = d.empresa_id
     and l.producto_id is null and l.precio_neto = 141750
   where p.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and p.numero = 1
     and p.estado = 'facturada'),
  'nota_venta/borrador/271125/2/141750/false/ODE N° 1 Coyhaique — guías GD 4521, GD 4522',
  'facturar crea la nota de venta en borrador con líneas sin producto y descripción ODE/destino/guías (left 80)'
);

-- 48) Nada se factura dos veces (mismo mensaje cubre facturar una no-aprobada).
select throws_ok(
  $$select facturar_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1))$$,
  'P0001', 'Solo se puede facturar una proforma aprobada',
  'una proforma facturada no se factura dos veces'
);

-- 49) El despacho físico es independiente de la facturación: se asigna sobre una ODE FACTURADA.
select lives_ok(
  $$select asignar_despacho('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from ordenes_entrega where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 2),
    'aaaa0001-0000-0000-0000-aaaaaaaaaaaa', 'bbbb0001-0000-0000-0000-aaaaaaaaaaaa')$$,
  'el despacho se asigna incluso con la ODE ya facturada'
);

-- 50) Una ODE facturada no se anula (mismo mensaje de estado cubre el doble-anular).
select throws_ok(
  $$select anular_orden_entrega('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from ordenes_entrega where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1),
    'Ya no corresponde')$$,
  'P0001', 'Solo se puede anular una orden registrada',
  'una ODE facturada no se anula por esta vía'
);

-- ===== anular_estado_pago: la reversa total =====

-- Setup: deshacer el estado de pago en BORRADOR (feliz); el assert 51 verifica la reversa completa.
select anular_estado_pago('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select documento_venta_id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1));

-- 51) Reversa: ODEs a registrada CONSERVANDO proforma y despacho (el del assert 49), proforma a
--     aprobada sin documento, y el doc borrado (solo queda DVA0 como nota de venta de A).
select is(
  (select o.estado || '/' || (o.proforma_id is not null)::text || '/' || (o.vehiculo_id is not null)::text
        || '/' || p.estado || '/' || (p.documento_venta_id is null)::text || '/'
        || (select count(*)::text from documentos_venta
            where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and tipo = 'nota_venta')
   from ordenes_entrega o, proformas p
   where o.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and o.numero = 2
     and p.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and p.numero = 1),
  'registrada/true/true/aprobada/true/1',
  'deshacer el borrador revierte: ODEs a registrada conservando proforma y despacho, proforma a aprobada y documento eliminado'
);

-- Setup: re-facturar (P1 volvió a aprobada) y simular la EMISIÓN al SII (superuser: folio consumido).
select facturar_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1));
reset role;
update public.documentos_venta set tipo = 'factura', folio = 778, estado = 'emitido'
where id = (select documento_venta_id from proformas
            where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1);
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- 52) Con folio VÁLIDO (emitido) no hay reversa: para eso existe la nota de crédito.
select throws_ok(
  $$select anular_estado_pago('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select documento_venta_id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1))$$,
  'P0001', 'Solo se puede deshacer un estado de pago en borrador o rechazado',
  'una factura emitida con folio válido no se deshace'
);

-- Setup: el SII RECHAZA el DTE (superuser): folio consumido = gap justificable.
reset role;
update public.documentos_venta set estado = 'rechazado'
where id = (select documento_venta_id from proformas
            where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1);
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- 53) Un DTE rechazado por el SII SÍ se deshace (la mecánica de reversa ya quedó fijada en el 51).
select lives_ok(
  $$select anular_estado_pago('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select documento_venta_id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1))$$,
  'un DTE rechazado por el SII se deshace: el folio consumido queda como gap justificable'
);

-- 54) Una nota de venta de COMERCIO en borrador no es deshacible por aquí (no proviene de proforma).
select throws_ok(
  $$select anular_estado_pago('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'd0c00001-0000-0000-0000-aaaaaaaaaaaa')$$,
  'P0001', 'El documento no proviene de una proforma',
  'una nota de venta de comercio no se deshace como estado de pago'
);

-- 55) El documento de B "no existe" para la empresa A.
select throws_ok(
  $$select anular_estado_pago('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'd0c00002-0000-0000-0000-bbbbbbbbbbbb')$$,
  'P0001', 'El documento no existe',
  'un documento de otra empresa da el mismo mensaje que uno inexistente'
);

-- ===== Aislamiento y anónimo =====

-- 56) Beto (org B) ve SOLO sus 5 filas en las 5 tablas nuevas (las ~10 de A serían visibles si la RLS fallara).
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
select is(
  (select count(*) from vehiculos) + (select count(*) from conductores) + (select count(*) from destinos)
    + (select count(*) from ordenes_entrega) + (select count(*) from proformas),
  5::bigint,
  'Beto ve solo lo suyo: una fila por tabla de transporte, nada de la empresa A'
);

-- 57) Anónimo denegado de plano.
set local request.jwt.claims to '{"role": "anon"}';
set local role anon;
select throws_ok(
  'select count(*) from ordenes_entrega',
  '42501', 'permission denied for table ordenes_entrega',
  'un anónimo no puede consultar órdenes de entrega'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Ejecutar**

Run: `pnpm supabase test db`
Expected: 11 archivos, **193 asserts** (aislamiento 6, cobranza 16, compras 19, cotizaciones 27, inventario 10, maestros 11, por_pagar 18, registro 7, reportes 11, transporte 59, ventas 9), todos verdes. Si un assert de transporte falla, el sospechoso es la migración 0016 (Tasks 1-2) — NO debilitar el test (única adaptación permitida: el TEXTO exacto de mensajes nativos de Postgres en los asserts 20-28 y 57, si la versión los formula distinto; el CÓDIGO de error, los mensajes de las RPCs y los valores dorados son el contrato).

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/database/transporte.test.sql
git commit -m "test(db): pgTAP de transporte — ODEs, tarifario, proformas y reversas"
```

---
### Task 4: Regenerar tipos `@suite/db`

**Files:**
- Modify: `packages/db/src/types.ts` (regenerado)

- [ ] **Step 1: Regenerar y verificar**

Run: `pnpm --filter @suite/db gen`
Expected: `types.ts` gana 14 símbolos: tablas `vehiculos`, `conductores`, `destinos`, `ordenes_entrega`, `proformas`; Functions `crear_orden_entrega`, `asignar_despacho`, `anular_orden_entrega`, `crear_proforma`, `cambiar_estado_proforma`, `facturar_proforma`, `anular_estado_pago`; y en la Row de `empresas`, las columnas nuevas `modulo_transporte` y `factor_volumetrico`.

Verificación (PowerShell):

```powershell
$simbolos = 'vehiculos', 'conductores', 'destinos', 'ordenes_entrega', 'proformas',
  'crear_orden_entrega', 'asignar_despacho', 'anular_orden_entrega', 'crear_proforma',
  'cambiar_estado_proforma', 'facturar_proforma', 'anular_estado_pago',
  'modulo_transporte', 'factor_volumetrico'
foreach ($s in $simbolos) {
  if (-not (Select-String -Path packages/db/src/types.ts -Pattern $s -Quiet)) { "FALTA: $s" }
}
```

Expected: sin salida (los 14 símbolos presentes). Cualquier línea `FALTA:` significa que la migración 0016 no aplicó completa → BLOCKED (no seguir a las tasks de UI con tipos incompletos).

Run: `pnpm tsc --noEmit -p packages/db/tsconfig.json` → sin errores.
Run: `pnpm build --concurrency=1` → 3 apps.

- [ ] **Step 2: Commit**

```bash
git add packages/db/src/types.ts
git commit -m "chore(db): tipos regenerados con transporte"
```

---
### Task 5: `@suite/core` — kilo afecto, patentes y proformas (TDD)

**Files:**
- Create: `packages/core/src/transporte.ts`
- Create: `packages/core/src/transporte.test.ts`
- Modify: `packages/core/src/index.ts` (agregar `export * from './transporte'`)

**Interfaces:**
- Consumes: nada del monorepo (funciones puras). ESPEJO de formato y estilo: `packages/core/src/cotizaciones.ts` / `.test.ts` — léelos antes de escribir estos archivos.
- Produces (LOCKED, spec §5): `kiloAfecto(kilos: number, m3: number | null, factor: number): number` — lo consume `/entregas/nueva` (kilo afecto EN VIVO y neto sugerido `kiloAfecto × tarifa_kg`); `normalizarPatente(patente: string): string`, `validarPatente(patente: string): boolean`, `formatearPatente(patente: string): string` — los consume `/flota` (la BD persiste la forma NORMALIZADA; el CHECK de `vehiculos.patente` exige `^[A-Z]{4}[0-9]{2}$` o `^[A-Z]{2}[0-9]{4}$`); `export type EstadoProforma = 'borrador' | 'enviada' | 'aprobada' | 'rechazada' | 'facturada'` y `formatearNumeroProforma(numero: number): string` — los consumen las páginas de `/proformas` (display `PF-000004`); `puedeTransicionarProforma(desde: EstadoProforma, hacia: EstadoProforma): boolean` — espejo unitario de la máquina de estados de las RPCs: se testea aquí pero NO lo consume la UI (las transiciones válidas las decide el servidor).
- Se reusan sin tocar: `validarRut`/`formatearRut`, `formatearCLP`, helpers de fechas.

- [ ] **Step 1: Test que falla**

`packages/core/src/transporte.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  formatearNumeroProforma,
  formatearPatente,
  kiloAfecto,
  normalizarPatente,
  puedeTransicionarProforma,
  validarPatente,
} from './transporte'

describe('kiloAfecto', () => {
  it('el volumen manda cuando supera al peso (fila real: 175 kg, 1.26 M3, factor 250)', () => {
    expect(kiloAfecto(175, 1.26, 250)).toBe(315)
  })
  it('el peso manda cuando supera al volumen (fila real: 787 kg, 2.88 M3, factor 250)', () => {
    expect(kiloAfecto(787, 2.88, 250)).toBe(787)
  })
  it('sin M3 tarifa por peso puro', () => {
    expect(kiloAfecto(100, null, 250)).toBe(100)
  })
  it('el factor volumétrico de la empresa cambia el resultado', () => {
    expect(kiloAfecto(175, 1.26, 300)).toBe(378)
  })
  it('frontera .5: 0.29 × 250 = 72.50 redondea a 73 como en Postgres (no 72 por flotantes)', () => {
    expect(kiloAfecto(10, 0.29, 250)).toBe(73)
  })
})

describe('normalizarPatente', () => {
  it('sube a mayúsculas y quita el guion', () => {
    expect(normalizarPatente('bbcl-23')).toBe('BBCL23')
  })
  it('quita espacios, puntos y punto medio', () => {
    expect(normalizarPatente(' ab·12.34 ')).toBe('AB1234')
  })
  it('una patente ya normalizada queda igual', () => {
    expect(normalizarPatente('BBCL23')).toBe('BBCL23')
  })
})

describe('validarPatente', () => {
  it('acepta el formato nuevo (4 letras + 2 dígitos)', () => {
    expect(validarPatente('BBCL23')).toBe(true)
  })
  it('acepta el formato antiguo (2 letras + 4 dígitos)', () => {
    expect(validarPatente('AB1234')).toBe(true)
  })
  it('rechaza 3 letras + 3 dígitos (no es formato chileno)', () => {
    expect(validarPatente('ABC123')).toBe(false)
  })
  it('exige entrada normalizada: minúsculas no validan', () => {
    expect(validarPatente('bbcl23')).toBe(false)
  })
  it('rechaza largos incorrectos y vacío', () => {
    expect(validarPatente('BBCL234')).toBe(false)
    expect(validarPatente('')).toBe(false)
  })
})

describe('formatearPatente', () => {
  it('separa letras y dígitos con guion', () => {
    expect(formatearPatente('BBCL23')).toBe('BBCL-23')
    expect(formatearPatente('AB1234')).toBe('AB-1234')
  })
  it('normaliza antes de formatear', () => {
    expect(formatearPatente('bb cl23')).toBe('BBCL-23')
  })
})

describe('puedeTransicionarProforma', () => {
  it('borrador puede enviarse', () => {
    expect(puedeTransicionarProforma('borrador', 'enviada')).toBe(true)
  })
  it('borrador puede rechazarse (proforma mal armada)', () => {
    expect(puedeTransicionarProforma('borrador', 'rechazada')).toBe(true)
  })
  it('enviada puede aprobarse o rechazarse', () => {
    expect(puedeTransicionarProforma('enviada', 'aprobada')).toBe(true)
    expect(puedeTransicionarProforma('enviada', 'rechazada')).toBe(true)
  })
  it('aprobada puede rechazarse (el rechazo libera las ODEs incluso aquí)', () => {
    expect(puedeTransicionarProforma('aprobada', 'rechazada')).toBe(true)
  })
  it('aprobada puede facturarse (en el servidor SOLO vía facturar_proforma)', () => {
    expect(puedeTransicionarProforma('aprobada', 'facturada')).toBe(true)
  })
  it('ninguna otra transición es válida', () => {
    // facturada→aprobada existe en el servidor SOLO vía anular_estado_pago, no por aquí.
    expect(puedeTransicionarProforma('facturada', 'aprobada')).toBe(false)
    expect(puedeTransicionarProforma('facturada', 'rechazada')).toBe(false)
    expect(puedeTransicionarProforma('rechazada', 'enviada')).toBe(false)
    expect(puedeTransicionarProforma('borrador', 'aprobada')).toBe(false)
    expect(puedeTransicionarProforma('enviada', 'facturada')).toBe(false)
  })
})

describe('formatearNumeroProforma', () => {
  it('rellena a 6 dígitos (el correlativo real del usuario)', () => {
    expect(formatearNumeroProforma(4)).toBe('PF-000004')
  })
  it('sobre 6 dígitos no rellena ni trunca', () => {
    expect(formatearNumeroProforma(123456)).toBe('PF-123456')
  })
})
```

- [ ] **Step 2: Verificar que falla**

Run: `pnpm --filter @suite/core test`
Expected: FAIL — `Cannot find module './transporte'`.

- [ ] **Step 3: Implementación mínima**

`packages/core/src/transporte.ts`:

```ts
export type EstadoProforma = 'borrador' | 'enviada' | 'aprobada' | 'rechazada' | 'facturada'

// Kilo afecto: reproduce la aritmética numeric(9,2) de crear_orden_entrega, donde
// v_kilos := round(p_kilos, 2) y v_m3 := round(p_m3, 2) se redondean a 2 decimales
// ANTES de comparar. El toFixed(2) en cada paso normaliza el flotante de JS: 0.29 * 250
// es 72.49999999999999 (redondearía a 72) pero en Postgres, con numeric exacto, es 72.50
// (redondea a 73) — el segundo toFixed(2), sobre el producto v_m3 × factor, replica eso.
export function kiloAfecto(kilos: number, m3: number | null, factor: number): number {
  const k = Number(kilos.toFixed(2))
  const v = m3 == null ? 0 : Number(m3.toFixed(2))
  return Math.round(Math.max(k, Number((v * factor).toFixed(2))))
}

// Patentes chilenas: formato nuevo BBCL23 (4 letras + 2 dígitos) y antiguo AB1234
// (2 letras + 4 dígitos) — espejo del CHECK de vehiculos.patente (migración 0016).
const PATENTE_NUEVA = /^[A-Z]{4}\d{2}$/
const PATENTE_ANTIGUA = /^[A-Z]{2}\d{4}$/

export function normalizarPatente(patente: string): string {
  return patente.replace(/[\s.\-·]/g, '').toUpperCase()
}

// Valida la forma NORMALIZADA (lo que se persiste); la UI normaliza antes de validar.
export function validarPatente(patente: string): boolean {
  return PATENTE_NUEVA.test(patente) || PATENTE_ANTIGUA.test(patente)
}

export function formatearPatente(patente: string): string {
  const p = normalizarPatente(patente)
  if (!validarPatente(p)) return p
  return p.replace(/^([A-Z]+)/, '$1-')
}

// Máquina de estados de proformas (espejo exacto de cambiar_estado_proforma +
// facturar_proforma). SOLO topología: en el servidor 'facturada' se alcanza SOLO
// vía facturar_proforma, y facturada→aprobada SOLO vía anular_estado_pago (por eso
// aquí es false: no es una transición pedible a la RPC de estado).
const TRANSICIONES: Record<EstadoProforma, readonly EstadoProforma[]> = {
  borrador: ['enviada', 'rechazada'],
  enviada: ['aprobada', 'rechazada'],
  aprobada: ['rechazada', 'facturada'],
  rechazada: [],
  facturada: [],
}

export function puedeTransicionarProforma(desde: EstadoProforma, hacia: EstadoProforma): boolean {
  return TRANSICIONES[desde].includes(hacia)
}

// Espejo de 'PF-' || lpad(numero::text, 6, '0') — padStart no trunca sobre 6 dígitos
// (lpad sí lo haría, pero es irrelevante bajo 1.000.000 de proformas).
export function formatearNumeroProforma(numero: number): string {
  return 'PF-' + String(numero).padStart(6, '0')
}
```

En `packages/core/src/index.ts` agregar al final: `export * from './transporte'`

- [ ] **Step 4: Verificar que pasa**

Run: `pnpm --filter @suite/core test`
Expected: PASS — **106 tests** (83 existentes + 23 nuevos: kiloAfecto 5, patentes 10, transiciones 6, formatearNumeroProforma 2).

Run: `pnpm test`
Expected: **118 tests** (core 106, auth 2, dte 10).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/transporte.ts packages/core/src/transporte.test.ts packages/core/src/index.ts
git commit -m "feat(core): kilo afecto, patentes chilenas y transiciones de proforma (TDD)"
```

---
### Task 6: Endurecimiento del flujo de emisión

**Files:**
- Modify: `apps/erp/lib/emision.ts` (early-return en `registrarMovimientosDocumento` con array filtrado vacío)
- Modify: `apps/erp/app/ventas/emitir.ts` (claim atómico del documento ANTES de `tomar_folio` + catch que no atasca)

**Interfaces:**
- Consumes: RPC `registrar_movimientos_documento` (solo service_role, advisory lock por documento — Plan 4), RPC `tomar_folio` en contexto de usuario, `documentos_venta` con estados `borrador`/`pendiente_envio`/`emitido`/`rechazado`, `credencialesEmpresa` y `clienteAdmin`.
- Produces: (1) `registrarMovimientosDocumento` que NO llama la RPC cuando ninguna línea tiene `producto_id` — las facturas nacidas de proformas de transporte (todas sus líneas con `producto_id = null`, Task 2 `facturar_proforma`) dejan de crear la bodega `'Principal'` fantasma, tanto al emitir como al anular con NC; (2) `emitirDocumento` con claim: dos clics concurrentes sobre el mismo borrador consumen UN solo folio; (3) catch que revierte a `'borrador'` cuando no se consumió folio (certificado/CAF faltante ya no deja el documento atascado en `pendiente_envio`) y deja `pendiente_envio` cuando el folio ya se tomó (reintento idempotente intacto).
- `emitirNotaCredito` NO se toca (su NC nace dentro de la función; no hay claim que hacer). Se beneficia igual del punto (1) vía `registrarMovimientosDocumento`.

- [ ] **Step 1: Early-return en `registrarMovimientosDocumento`**

En `apps/erp/lib/emision.ts`, reemplazar el cuerpo de `registrarMovimientosDocumento` (líneas 49-71 actuales). Diff exacto:

```diff
 export async function registrarMovimientosDocumento(
   empresaId: string,
   documentoId: string,
   lineas: { producto_id: string | null; cantidad: number }[],
   signo: 1 | -1,
   motivo: string
 ): Promise<void> {
+  // Sin líneas con producto (p. ej. factura nacida de una proforma de transporte:
+  // todas sus líneas llevan producto_id = null) no hay stock que mover, y llamar
+  // la RPC igual crearía la bodega 'Principal' fantasma en empresas que jamás
+  // han usado inventario. Early-return antes de tocar la BD.
+  const conProducto = lineas
+    .filter((l): l is { producto_id: string; cantidad: number } => l.producto_id !== null)
+    .map((l) => ({ productoId: l.producto_id, cantidad: l.cantidad }))
+  if (conProducto.length === 0) return
   try {
     const admin = clienteAdmin()
     const { error } = await admin.rpc('registrar_movimientos_documento', {
       p_empresa: empresaId,
       p_documento: documentoId,
-      p_lineas: lineas
-        .filter((l): l is { producto_id: string; cantidad: number } => l.producto_id !== null)
-        .map((l) => ({ productoId: l.producto_id, cantidad: l.cantidad })) as unknown as Json,
+      p_lineas: conProducto as unknown as Json,
       p_signo: signo,
       p_motivo: motivo,
     })
     if (error) console.error('registrarMovimientosDocumento:', error.message)
   } catch (e) {
     console.error('registrarMovimientosDocumento:', e)
   }
 }
```

Nada más cambia en `emision.ts` (imports, `credencialesEmpresa` y los re-exports quedan intactos).

- [ ] **Step 2: Claim del documento y catch endurecido en `emitirDocumento`**

En `apps/erp/app/ventas/emitir.ts`, reemplazar COMPLETA la función `emitirDocumento` por esta versión (imports del archivo, `TIPOS_EMISIBLES`, `estadoDocumento` y `emitirNotaCredito` quedan EXACTAMENTE como están):

```ts
export async function emitirDocumento(formData: FormData): Promise<void> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return
  const id = String(formData.get('id') ?? '')
  const tipo = String(formData.get('tipo') ?? '') as TipoDocumento
  if (!TIPOS_EMISIBLES.includes(tipo as (typeof TIPOS_EMISIBLES)[number])) return

  const supabase = await crearClienteServidor()
  // Verifica que el documento pertenece a la empresa activa y está emitible (RLS lo acota).
  const { data: doc } = await supabase
    .from('documentos_venta')
    .select('id, tipo, estado, folio, cliente_id, neto, exento, iva, total')
    .eq('id', id)
    .eq('empresa_id', activa.id)
    .single()
  if (!doc || (doc.estado !== 'borrador' && doc.estado !== 'pendiente_envio')) return
  // No cambiar el tipo de un documento ya tributario (evita cruzar folio con el CAF equivocado).
  if (doc.tipo !== 'nota_venta' && doc.tipo !== tipo) return

  const admin = clienteAdmin()
  // Fuera del try: el catch decide con folioPersistido si revierte a 'borrador' (nada
  // persistido, nada que reintentar) o deja 'pendiente_envio' (folio YA escrito en la fila).
  let folio = doc.folio
  let folioPersistido = folio !== null // reintento: la fila ya traía folio persistido
  try {
    // Claim atómico ANTES de tomar folio: dos clics simultáneos sobre el mismo
    // borrador → solo uno pasa; el perdedor sale SIN consumir folio. Un doc ya
    // en pendiente_envio (reintento) no se re-clama: su folio ya está reservado
    // o se reserva más abajo con el guard .is('folio', null).
    if (doc.estado === 'borrador') {
      const { data: reclamado, error: eClaim } = await admin
        .from('documentos_venta')
        .update({ estado: 'pendiente_envio' })
        .eq('id', id)
        .eq('empresa_id', activa.id)
        .eq('estado', 'borrador')
        .select('id')
      if (eClaim) throw new Error('No se pudo iniciar la emisión; reintenta')
      if ((reclamado ?? []).length === 0) return // otra emisión concurrente ya tomó el documento
    }

    const cred = await credencialesEmpresa(activa.id, tipo)

    // Reserva de folio SOLO si aún no tiene (idempotencia ante reintento).
    // tomar_folio en contexto de USUARIO (valida pertenencia por auth.uid()).
    if (folio === null) {
      const { data: nuevo, error: eFolio } = await supabase.rpc('tomar_folio', { p_empresa: activa.id, p_tipo: tipo })
      if (eFolio || nuevo === null) throw new Error(eFolio?.message ?? 'No hay folios disponibles')
      folio = nuevo as number
      // El folio DEBE quedar persistido antes de continuar: si este write falla, abortamos
      // para que el reintento reutilice el mismo folio (nunca dos folios para una venta).
      const { data: reservado, error: eUpd } = await admin
        .from('documentos_venta')
        .update({ tipo, folio, estado: 'pendiente_envio' })
        .eq('id', id)
        .eq('empresa_id', activa.id)
        .is('folio', null)
        .select('id')
      if (eUpd) throw new Error('No se pudo reservar el folio; reintenta')
      if ((reservado ?? []).length === 0) return // otra emisión concurrente ya reservó el folio
      // Folio PERSISTIDO recién aquí: si este write hubiera fallado, el folio ya tomado
      // se pierde como gap (misma familia que el gap ya aceptado de un DTE rechazado por el SII).
      folioPersistido = true
    }

    const [{ data: emp }, { data: cli }, { data: lineas }] = await Promise.all([
      admin.from('empresas').select('rut, razon_social, giro_emisor, direccion_emisor, comuna_emisor').eq('id', activa.id).single(),
      admin.from('clientes').select('rut, razon_social, giro, direccion, comuna').eq('id', doc.cliente_id).single(),
      admin.from('documentos_venta_lineas').select('producto_id, descripcion, cantidad, precio_neto, exenta').eq('documento_id', id),
    ])

    const proveedor = proveedorPorAmbiente(process.env.DTE_AMBIENTE ?? 'certificacion')
    const resultado = await proveedor.emitirDTE({
      tipo,
      codigoSii: CODIGO_SII[tipo]!,
      folio: folio!,
      emisor: {
        rut: emp!.rut, razonSocial: emp!.razon_social, giro: emp!.giro_emisor ?? '',
        direccion: emp!.direccion_emisor ?? '', comuna: emp!.comuna_emisor ?? '',
      },
      receptor: {
        rut: cli!.rut, razonSocial: cli!.razon_social, giro: cli!.giro ?? undefined,
        direccion: cli!.direccion ?? undefined, comuna: cli!.comuna ?? undefined,
      },
      lineas: (lineas ?? []).map((l) => ({ descripcion: l.descripcion, cantidad: l.cantidad, precioNeto: l.precio_neto, exenta: l.exenta })),
      neto: doc.neto, exento: doc.exento, iva: doc.iva, total: doc.total,
      credenciales: cred,
    })

    const estado = estadoDocumento(resultado.estado)
    await admin
      .from('documentos_venta')
      .update({
        tipo,
        folio,
        estado,
        track_id: resultado.trackId,
        xml_timbrado: resultado.xmlTimbrado,
        pdf_ruta: resultado.pdfBase64,
        error_emision: resultado.error,
        emitido_en: estado === 'emitido' ? new Date().toISOString() : null,
        intentos: doc.estado === 'pendiente_envio' ? 2 : 1,
      })
      .eq('id', id)
      .eq('empresa_id', activa.id)

    if (estado === 'emitido') {
      await registrarMovimientosDocumento(
        activa.id,
        id,
        (lineas ?? []).map((l) => ({ producto_id: l.producto_id, cantidad: l.cantidad })),
        -1,
        'Venta ' + tipo + ' folio ' + folio
      )
    }
  } catch (e) {
    // La decisión es sobre folio PERSISTIDO, no sobre la variable local `folio`: si se
    // tomó un folio pero el UPDATE que lo escribe falló, `folio` ya no es null pero la
    // fila jamás lo guardó — ese folio se pierde como gap (misma familia que el gap ya
    // aceptado de un DTE rechazado por el SII). Sin folio persistido el documento vuelve
    // a 'borrador' (un certificado o CAF faltante ya no lo deja atascado en pendiente_envio);
    // con folio persistido queda 'pendiente_envio': el reintento reutiliza el MISMO folio
    // (guard .is('folio', null) más arriba).
    await admin
      .from('documentos_venta')
      .update({
        estado: folioPersistido ? 'pendiente_envio' : 'borrador',
        error_emision: e instanceof Error ? e.message : 'Error de emisión',
      })
      .eq('id', id)
      .eq('empresa_id', activa.id)
  }

  revalidatePath('/ventas')
  revalidatePath('/ventas/' + id)
}
```

Cambios respecto de la versión actual (para revisar el diff): (a) `let folio = doc.folio` y el nuevo `let folioPersistido = folio !== null` suben FUERA del try; (b) bloque de claim nuevo al inicio del try, solo cuando `doc.estado === 'borrador'`; (c) `folioPersistido = true` se marca justo después de que el UPDATE de reserva de folio confirma 1 fila (no antes: si ese UPDATE falla, el folio tomado nunca se marca persistido); (d) el catch calcula `estado: folioPersistido ? 'pendiente_envio' : 'borrador'` en vez de `'pendiente_envio'` fijo — decide por lo que quedó ESCRITO en la fila, no por si `folio` (variable local) dejó de ser null; (e) los TRES `update` de `admin` dentro de `emitirDocumento` (reserva de folio, persistencia final, catch) suman `.eq('empresa_id', activa.id)` — cinturón simétrico al `.eq('empresa_id', activa.id)` que ya tenía el claim. Todo lo demás es byte-idéntico al archivo actual. `emitirNotaCredito` NO se modifica: su flujo ya crea la NC antes del folio y su catch solo actúa con `ncId` creado.

Los tres caminos que NO deben romperse:
- **Emisión normal**: borrador → claim (1 fila) → folio → persistencia → emitirDTE → emitido + movimientos.
- **Reintento (0006)**: doc `pendiente_envio` con folio → claim se salta (guard `doc.estado === 'borrador'`) → reserva se salta (`folio !== null`) → re-emite con el mismo folio, `intentos: 2`.
- **NC**: `emitirNotaCredito` intacta; con líneas sin producto (factura de proforma) la restitución de stock hace early-return sin crear bodega.

- [ ] **Step 3: Verificar**

Run: `pnpm --filter erp build` → compila sin errores.

Nota — qué valida qué (para no sobre-reclamar cobertura): aquí SOLO se verifica que compila. El E2E integral de la Task 12 (Step 2, puntos 8-9) SOLO replica el endurecimiento (1) — emisión y NC sin bodega `'Principal'` fantasma — porque esos puntos son una réplica admin del camino feliz que un script Node puede simular sin invocar la Server Action real. El claim atómico (2, doble folio) y el catch por folio persistido (3, revierte a borrador) exigen invocar `emitirDocumento` de verdad con concurrencia o con un proveedor que falle; eso NO lo cubre el script de Task 12 y queda en la checklist de Task 12 Step 3 (Playwright o manual contra el dev server, documentada en el reporte).

- [ ] **Step 4: Commit**

```bash
git add apps/erp/lib/emision.ts apps/erp/app/ventas/emitir.ts
git commit -m "fix(erp): emisión endurecida — claim de folio, catch sin atasco y sin bodega fantasma"
```

---
### Task 7: Configuración de módulos + NAV condicional

**Files:**
- Create: `apps/erp/app/configuracion/page.tsx` (índice con tarjetas DTE / Módulos), `apps/erp/app/configuracion/modulos/acciones.ts`, `apps/erp/app/configuracion/modulos/page.tsx`, `apps/erp/componentes/formulario-modulos.tsx` (form client — mismo patrón `formulario-emisor.tsx` que usa `/configuracion/dte`)
- Modify: `apps/erp/lib/empresa-activa.ts` (select + `EmpresaResumen` ganan `modulo_transporte`), `apps/erp/app/layout.tsx` (NAV: Configuración → `/configuracion`; entradas de transporte condicionales)

**Interfaces:**
- Consumes: columnas `empresas.modulo_transporte` y `empresas.factor_volumetrico` (migración 0016, Task 1 — el grant de update por columnas las incluye; RLS restringe el update a dueno/admin, patrón `/configuracion/dte`: error → mensaje, 0 filas → denegación de rol); tipos `@suite/db` regenerados (Task 4); `EstadoForm` de `apps/erp/app/tipos.ts`; `Boton`, `Campo`, `Entrada`, `Encabezado`, `Tarjeta` de `@suite/ui`; `obtenerEmpresaActiva`.
- Produces: `EmpresaResumen` con `modulo_transporte: boolean` — lo consumen el NAV de este task y los guards `notFound()` de las páginas de Tasks 8-11 (`if (!activa.modulo_transporte) notFound()`); índice `/configuracion`; `/configuracion/modulos` con toggle + factor volumétrico 1-10000 y copy de prospectividad; NAV con Flota/Tarifario/Entregas/Proformas entre Cotizaciones y Ventas SOLO si `activa?.modulo_transporte`.
- El update de `empresas` es DIRECTO (`.eq('id', activa.id)`, sin RPC): mismo mecanismo que `guardarEmisor` — la seguridad la ponen el grant por columnas y la policy de update de la 0016.
- Transitorio esperado: con el módulo activado a mano, los links `/flota`, `/tarifario`, `/entregas` y `/proformas` 404ean hasta Tasks 8-11; el seed demo lo trae apagado, así que el NAV por defecto no cambia.

- [ ] **Step 1: `EmpresaResumen` gana `modulo_transporte`**

`apps/erp/lib/empresa-activa.ts` completo queda así (cambian el interface y el select; el resto es idéntico — el campo es aditivo, `SelectorEmpresa` y `app/acciones.ts` no se tocan):

```ts
import 'server-only'
import { cookies } from 'next/headers'
import { crearClienteServidor } from '@suite/auth/server'

export const COOKIE_EMPRESA = 'empresa_activa'

export interface EmpresaResumen {
  id: string
  rut: string
  razon_social: string
  modulo_transporte: boolean
}

export async function obtenerEmpresas(): Promise<EmpresaResumen[]> {
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase
    .from('empresas')
    .select('id, rut, razon_social, modulo_transporte')
    .order('razon_social')
  if (error) throw new Error('No se pudieron cargar tus empresas')
  return data ?? []
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

- [ ] **Step 2: NAV condicional**

`apps/erp/app/layout.tsx` completo queda así (el `const NAV` de módulo desaparece: el NAV depende de la empresa activa y se arma dentro del componente):

```tsx
import type { ReactNode } from 'react'
import { BarraLateral } from '@suite/ui'
import './globals.css'
import { cambiarEmpresaActiva } from './acciones'
import { BotonCerrarSesion } from '../componentes/boton-cerrar-sesion'
import { SelectorEmpresa } from '../componentes/selector-empresa'
import { obtenerEmpresaActiva } from '../lib/empresa-activa'

export const metadata = { title: 'Suite ERP' }

export default async function LayoutRaiz({ children }: { children: ReactNode }) {
  const { activa, empresas } = await obtenerEmpresaActiva()
  // El NAV depende de la empresa activa: las entradas de transporte solo existen
  // con el módulo activo. Esto es UX, no seguridad: RLS y las RPCs siguen
  // mandando aunque alguien navegue a mano.
  const nav = [
    { href: '/', etiqueta: 'Inicio' },
    { href: '/productos', etiqueta: 'Productos' },
    { href: '/clientes', etiqueta: 'Clientes' },
    { href: '/importar', etiqueta: 'Importar' },
    { href: '/cotizaciones', etiqueta: 'Cotizaciones' },
    ...(activa?.modulo_transporte
      ? [
          { href: '/flota', etiqueta: 'Flota' },
          { href: '/tarifario', etiqueta: 'Tarifario' },
          { href: '/entregas', etiqueta: 'Entregas' },
          { href: '/proformas', etiqueta: 'Proformas' },
        ]
      : []),
    { href: '/ventas', etiqueta: 'Ventas' },
    { href: '/inventario', etiqueta: 'Inventario' },
    { href: '/compras', etiqueta: 'Compras' },
    { href: '/cobranza', etiqueta: 'Cobranza' },
    { href: '/por-pagar', etiqueta: 'Por pagar' },
    { href: '/reportes', etiqueta: 'Reportes' },
    { href: '/configuracion', etiqueta: 'Configuración' },
  ]
  return (
    <html lang="es">
      <body className="bg-slate-100 text-slate-900 antialiased">
        <div className="flex">
          <div className="print:hidden">
            <BarraLateral
              titulo="Suite ERP"
              items={nav}
              pie={
                <div className="grid gap-2">
                  {activa && <SelectorEmpresa empresas={empresas} activaId={activa.id} accion={cambiarEmpresaActiva} />}
                  <BotonCerrarSesion />
                </div>
              }
            />
          </div>
          <main className="min-h-screen flex-1 p-8 print:p-0">{children}</main>
        </div>
      </body>
    </html>
  )
}
```

- [ ] **Step 3: Índice de configuración**

`apps/erp/app/configuracion/page.tsx`:

```tsx
import Link from 'next/link'
import { Encabezado, Tarjeta } from '@suite/ui'

export default function PaginaConfiguracion() {
  return (
    <div>
      <Encabezado titulo="Configuración" />
      <div className="grid max-w-3xl grid-cols-1 gap-4 sm:grid-cols-2">
        <Link href="/configuracion/dte" className="block">
          <Tarjeta className="h-full transition hover:border-marca-500">
            <h2 className="mb-1 text-lg font-semibold text-slate-800">Facturación electrónica</h2>
            <p className="text-sm text-slate-600">Datos del emisor, certificado digital y folios CAF.</p>
          </Tarjeta>
        </Link>
        <Link href="/configuracion/modulos" className="block">
          <Tarjeta className="h-full transition hover:border-marca-500">
            <h2 className="mb-1 text-lg font-semibold text-slate-800">Módulos</h2>
            <p className="text-sm text-slate-600">Activa el módulo de transporte y define el factor volumétrico.</p>
          </Tarjeta>
        </Link>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Server Action de módulos**

`apps/erp/app/configuracion/modulos/acciones.ts` (espejo de `guardarEmisor` en `../dte/acciones.ts`: update directo con RLS; error → mensaje, 0 filas → denegación de rol):

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@suite/auth/server'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import type { EstadoForm } from '../../tipos'

export async function guardarModulos(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const moduloTransporte = formData.get('modulo_transporte') === 'on'
  const factor = Number(String(formData.get('factor_volumetrico') ?? '').trim())
  // Mismo rango que el check de la tabla (0016): rechazar aquí da mensaje claro
  // en vez de un 23514 crudo.
  if (!Number.isInteger(factor) || factor < 1 || factor > 10000) {
    return { error: 'El factor volumétrico debe ser un entero entre 1 y 10000' }
  }

  const supabase = await crearClienteServidor()
  const { data, error } = await supabase
    .from('empresas')
    .update({ modulo_transporte: moduloTransporte, factor_volumetrico: factor })
    .eq('id', activa.id)
    .select('id')
  if (error) return { error: 'No se pudo guardar la configuración de módulos' }
  if ((data ?? []).length === 0) return { error: 'No se pudo guardar: solo el dueño o admin puede cambiar los módulos' }

  // El NAV condicional vive en el layout raíz: revalidar todo el árbol.
  revalidatePath('/', 'layout')
  return {}
}
```

- [ ] **Step 5: Formulario client de módulos**

`apps/erp/componentes/formulario-modulos.tsx` (mismo patrón `formulario-emisor.tsx`):

```tsx
'use client'

import { useActionState } from 'react'
import { Boton, Campo, Entrada, Tarjeta } from '@suite/ui'
import type { EstadoForm } from '../app/tipos'

export function FormularioModulos({
  accion,
  inicial,
}: {
  accion: (prev: EstadoForm, formData: FormData) => Promise<EstadoForm>
  inicial: { moduloTransporte: boolean; factorVolumetrico: number }
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoForm)
  return (
    <Tarjeta className="max-w-2xl">
      <form action={enviar} className="grid gap-4">
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            name="modulo_transporte"
            defaultChecked={inicial.moduloTransporte}
            className="h-4 w-4 rounded border-slate-300 text-marca-600 focus:ring-marca-500"
          />
          <span className="text-sm font-medium text-slate-700">
            Módulo de transporte (flota, tarifario, entregas y proformas)
          </span>
        </label>
        <Campo etiqueta="Factor volumétrico (kg por M3, entre 1 y 10000)">
          <Entrada
            name="factor_volumetrico"
            type="number"
            inputMode="numeric"
            min={1}
            max={10000}
            step={1}
            defaultValue={inicial.factorVolumetrico}
            required
            className="max-w-xs"
          />
        </Campo>
        <p className="text-sm text-slate-500">
          Los cambios del factor volumétrico son prospectivos: las órdenes de entrega y
          proformas ya registradas no se recalculan. Apagar el módulo solo oculta las
          pantallas; no borra ni bloquea los datos existentes.
        </p>
        <div className="flex items-center justify-end gap-2">
          {estado.error && <span className="mr-auto text-sm text-red-600">{estado.error}</span>}
          <Boton type="submit" disabled={pendiente}>{pendiente ? 'Guardando…' : 'Guardar módulos'}</Boton>
        </div>
      </form>
    </Tarjeta>
  )
}
```

- [ ] **Step 6: Página de módulos**

`apps/erp/app/configuracion/modulos/page.tsx` (espejo estructural de `../dte/page.tsx`):

```tsx
import { crearClienteServidor } from '@suite/auth/server'
import { Encabezado } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { FormularioModulos } from '../../../componentes/formulario-modulos'
import { guardarModulos } from './acciones'

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
    </div>
  )
}
```

- [ ] **Step 7: Verificar y commit**

Run: `pnpm --filter erp build` → compila sin errores; el listado de rutas incluye `/configuracion` y `/configuracion/modulos`.
Run: `pnpm tsc --noEmit -p apps/erp/tsconfig.json` → sin errores.

```bash
git add apps/erp/app/configuracion/page.tsx apps/erp/app/configuracion/modulos/acciones.ts apps/erp/app/configuracion/modulos/page.tsx apps/erp/componentes/formulario-modulos.tsx apps/erp/lib/empresa-activa.ts apps/erp/app/layout.tsx
git commit -m "feat(erp): configuración de módulos y NAV condicional de transporte"
```

---
### Task 8: ERP — Flota (vehículos y conductores)

**Files:**
- Create: `apps/erp/app/flota/acciones.ts`, `apps/erp/componentes/formulario-vehiculo.tsx`, `apps/erp/componentes/formulario-conductor.tsx`, `apps/erp/app/flota/page.tsx`

**Interfaces:**
- Consumes: tablas `vehiculos`/`conductores` (migración 0016 — escritura directa dueno/admin; grant de update POR COLUMNAS: `vehiculos (descripcion, capacidad_kg, activo)`, `conductores (nombre, telefono, activo)` — patente/rut/empresa_id INMUTABLES); tipos `@suite/db` regenerados (Task 4); `normalizarPatente`/`validarPatente`/`formatearPatente` (spec §5, Task 5) y `limpiarRut`/`validarRut`/`formatearRut` de `@suite/core`; `obtenerEmpresaActiva` con `activa.modulo_transporte` en `EmpresaResumen` (Task 7 — NAV condicional); componentes `@suite/ui` (`Boton`, `Campo`, `Encabezado`, `Entrada`, `Insignia`, `Tabla`, `Tarjeta`, `Td`, `Th`, `Tr`).
- Espejo estructural: `apps/erp/app/inventario/proveedores/acciones.ts` (insert/update directos scoped, mapeo 23505/42501, alternar activo) y `apps/erp/componentes/formulario-proveedor.tsx` (useActionState + EstadoForm) — léelos completos antes de escribir.
- Produces: página `/flota` con DOS secciones (vehículos y conductores) en una sola ruta; edición vía query params `ev` (vehículo) / `ec` (conductor); Server Actions `guardarVehiculo`, `alternarActivoVehiculo`, `guardarConductor`, `alternarActivoConductor`.
- Inmutabilidad en edición: el formulario NI ENVÍA patente/RUT (input `disabled`, sin `name`) y el update solo toca columnas del grant — cinturón doble: aunque alguien forjara el POST, el grant por columnas lo rechaza con 42501.
- Guard de módulo: `notFound()` si `!activa.modulo_transporte` — UX, no seguridad (la RLS/grants ya protegen los datos).

- [ ] **Step 1: Server Actions de flota**

`apps/erp/app/flota/acciones.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { limpiarRut, normalizarPatente, validarPatente, validarRut } from '@suite/core'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import type { EstadoForm } from '../tipos'

export async function guardarVehiculo(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const id = String(formData.get('id') ?? '')
  const descripcion = String(formData.get('descripcion') ?? '').trim()
  const capacidadCruda = String(formData.get('capacidad_kg') ?? '').trim()
  const capacidadKg = capacidadCruda === '' ? null : Number(capacidadCruda)
  if (capacidadKg !== null && (!Number.isInteger(capacidadKg) || capacidadKg < 1)) {
    return { error: 'La capacidad debe ser un entero de kilos mayor a 0 (o dejarse vacía)' }
  }

  const supabase = await crearClienteServidor()
  if (id) {
    // Solo columnas del grant: patente y empresa_id son inmutables (grant por columnas de 0016).
    const { data, error } = await supabase
      .from('vehiculos')
      .update({ descripcion: descripcion || null, capacidad_kg: capacidadKg })
      .eq('id', id)
      .eq('empresa_id', activa.id)
      .select('id')
    if (error) {
      if (error.code === '42501') return { error: 'Tu rol no permite editar vehículos' }
      return { error: 'No se pudo guardar el vehículo' }
    }
    if ((data ?? []).length === 0) {
      return { error: 'No se pudo guardar: el vehículo no existe o tu rol no permite editarlo' }
    }
  } else {
    const patente = normalizarPatente(String(formData.get('patente') ?? ''))
    if (!validarPatente(patente)) {
      return { error: 'La patente no es válida (formatos AAAA00 o AA0000)' }
    }
    const { error } = await supabase.from('vehiculos').insert({
      empresa_id: activa.id,
      patente,
      descripcion: descripcion || null,
      capacidad_kg: capacidadKg,
    })
    if (error) {
      if (error.code === '23505') return { error: 'Ya existe un vehículo con esa patente' }
      if (error.code === '42501') return { error: 'Tu rol no permite crear vehículos' }
      return { error: 'No se pudo crear el vehículo' }
    }
  }
  revalidatePath('/flota')
  redirect('/flota')
}

export async function alternarActivoVehiculo(formData: FormData): Promise<void> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return
  const id = String(formData.get('id') ?? '')
  const activo = String(formData.get('activo') ?? '') === 'true'
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase
    .from('vehiculos')
    .update({ activo: !activo })
    .eq('id', id)
    .eq('empresa_id', activa.id)
    .select('id')
  if (error || (data ?? []).length === 0) {
    console.error('alternarActivoVehiculo:', error ?? 'sin filas')
    return
  }
  revalidatePath('/flota')
}

export async function guardarConductor(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const id = String(formData.get('id') ?? '')
  const nombre = String(formData.get('nombre') ?? '').trim()
  const telefono = String(formData.get('telefono') ?? '').trim()
  if (nombre === '') return { error: 'El nombre es obligatorio' }

  const supabase = await crearClienteServidor()
  if (id) {
    // Solo columnas del grant: rut y empresa_id son inmutables (grant por columnas de 0016).
    const { data, error } = await supabase
      .from('conductores')
      .update({ nombre, telefono: telefono || null })
      .eq('id', id)
      .eq('empresa_id', activa.id)
      .select('id')
    if (error) {
      if (error.code === '42501') return { error: 'Tu rol no permite editar conductores' }
      return { error: 'No se pudo guardar el conductor' }
    }
    if ((data ?? []).length === 0) {
      return { error: 'No se pudo guardar: el conductor no existe o tu rol no permite editarlo' }
    }
  } else {
    const rutCrudo = String(formData.get('rut') ?? '').trim()
    if (!validarRut(rutCrudo)) return { error: 'El RUT ingresado no es válido' }
    const { error } = await supabase.from('conductores').insert({
      empresa_id: activa.id,
      // Normalizado como clientes/proveedores: el check de 0016 exige rut = app.normalizar_rut(rut).
      rut: limpiarRut(rutCrudo),
      nombre,
      telefono: telefono || null,
    })
    if (error) {
      if (error.code === '23505') return { error: 'Ya existe un conductor con ese RUT' }
      if (error.code === '42501') return { error: 'Tu rol no permite crear conductores' }
      return { error: 'No se pudo crear el conductor' }
    }
  }
  revalidatePath('/flota')
  redirect('/flota')
}

export async function alternarActivoConductor(formData: FormData): Promise<void> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return
  const id = String(formData.get('id') ?? '')
  const activo = String(formData.get('activo') ?? '') === 'true'
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase
    .from('conductores')
    .update({ activo: !activo })
    .eq('id', id)
    .eq('empresa_id', activa.id)
    .select('id')
  if (error || (data ?? []).length === 0) {
    console.error('alternarActivoConductor:', error ?? 'sin filas')
    return
  }
  revalidatePath('/flota')
}
```

- [ ] **Step 2: Formulario de vehículo (cliente)**

`apps/erp/componentes/formulario-vehiculo.tsx` (espejo de `formulario-proveedor.tsx`; en edición la patente se muestra `disabled` — un input disabled no viaja en el POST):

```tsx
'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { Boton, Campo, Entrada, Tarjeta } from '@suite/ui'
import type { EstadoForm } from '../app/tipos'

export interface VehiculoEditable {
  id?: string
  patente: string
  descripcion: string
  capacidad_kg: string
}

const VACIO: VehiculoEditable = { patente: '', descripcion: '', capacidad_kg: '' }

export function FormularioVehiculo({
  accion, inicial = VACIO,
}: {
  accion: (prev: EstadoForm, formData: FormData) => Promise<EstadoForm>
  inicial?: VehiculoEditable
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoForm)
  return (
    <Tarjeta className="max-w-2xl">
      <form action={enviar} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {inicial.id && <input type="hidden" name="id" value={inicial.id} />}
        {inicial.id ? (
          <Campo etiqueta="Patente (no editable)"><Entrada value={inicial.patente} disabled /></Campo>
        ) : (
          <Campo etiqueta="Patente *"><Entrada name="patente" defaultValue={inicial.patente} placeholder="ABCD12" required /></Campo>
        )}
        <Campo etiqueta="Descripción"><Entrada name="descripcion" defaultValue={inicial.descripcion} placeholder="Camión 3/4" /></Campo>
        <Campo etiqueta="Capacidad (kg)"><Entrada name="capacidad_kg" inputMode="numeric" defaultValue={inicial.capacidad_kg} /></Campo>
        <div className="flex items-center justify-end gap-2 sm:col-span-3">
          {estado.error && <span className="mr-auto text-sm text-red-600">{estado.error}</span>}
          {inicial.id && <Link className="text-sm text-slate-500 hover:underline" href="/flota">Cancelar</Link>}
          <Boton type="submit" disabled={pendiente}>
            {pendiente ? 'Guardando…' : inicial.id ? 'Guardar cambios' : 'Agregar vehículo'}
          </Boton>
        </div>
      </form>
    </Tarjeta>
  )
}
```

- [ ] **Step 3: Formulario de conductor (cliente)**

`apps/erp/componentes/formulario-conductor.tsx` (mismo patrón; RUT `disabled` en edición):

```tsx
'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { Boton, Campo, Entrada, Tarjeta } from '@suite/ui'
import type { EstadoForm } from '../app/tipos'

export interface ConductorEditable {
  id?: string
  rut: string
  nombre: string
  telefono: string
}

const VACIO: ConductorEditable = { rut: '', nombre: '', telefono: '' }

export function FormularioConductor({
  accion, inicial = VACIO,
}: {
  accion: (prev: EstadoForm, formData: FormData) => Promise<EstadoForm>
  inicial?: ConductorEditable
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoForm)
  return (
    <Tarjeta className="max-w-2xl">
      <form action={enviar} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {inicial.id && <input type="hidden" name="id" value={inicial.id} />}
        {inicial.id ? (
          <Campo etiqueta="RUT (no editable)"><Entrada value={inicial.rut} disabled /></Campo>
        ) : (
          <Campo etiqueta="RUT *"><Entrada name="rut" defaultValue={inicial.rut} placeholder="12.345.678-5" required /></Campo>
        )}
        <Campo etiqueta="Nombre *"><Entrada name="nombre" defaultValue={inicial.nombre} required /></Campo>
        <Campo etiqueta="Teléfono"><Entrada name="telefono" defaultValue={inicial.telefono} /></Campo>
        <div className="flex items-center justify-end gap-2 sm:col-span-3">
          {estado.error && <span className="mr-auto text-sm text-red-600">{estado.error}</span>}
          {inicial.id && <Link className="text-sm text-slate-500 hover:underline" href="/flota">Cancelar</Link>}
          <Boton type="submit" disabled={pendiente}>
            {pendiente ? 'Guardando…' : inicial.id ? 'Guardar cambios' : 'Agregar conductor'}
          </Boton>
        </div>
      </form>
    </Tarjeta>
  )
}
```

- [ ] **Step 4: Página `/flota` con las dos secciones**

`apps/erp/app/flota/page.tsx` (una sola ruta; el `key` de cada formulario fuerza el remount al pasar de alta a edición y entre filas — sin él `useActionState`/`defaultValue` conservan el estado anterior):

```tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearPatente, formatearRut } from '@suite/core'
import { Boton, Encabezado, Insignia, Tabla, Td, Th, Tr } from '@suite/ui'
import { FormularioConductor } from '../../componentes/formulario-conductor'
import { FormularioVehiculo } from '../../componentes/formulario-vehiculo'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import { alternarActivoConductor, alternarActivoVehiculo, guardarConductor, guardarVehiculo } from './acciones'

export default async function PaginaFlota({
  searchParams,
}: {
  searchParams: Promise<{ ev?: string; ec?: string }>
}) {
  const { ev = '', ec = '' } = await searchParams
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  if (!activa.modulo_transporte) notFound()
  const supabase = await crearClienteServidor()
  const [{ data: vehiculos }, { data: conductores }] = await Promise.all([
    supabase.from('vehiculos').select('id, patente, descripcion, capacidad_kg, activo').eq('empresa_id', activa.id).order('patente'),
    supabase.from('conductores').select('id, rut, nombre, telefono, activo').eq('empresa_id', activa.id).order('nombre'),
  ])
  const vehiculoEdit = (vehiculos ?? []).find((v) => v.id === ev) ?? null
  const conductorEdit = (conductores ?? []).find((c) => c.id === ec) ?? null
  return (
    <div>
      <Encabezado titulo="Flota" />
      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold text-slate-800">Vehículos</h2>
        <div className="mb-4">
          <FormularioVehiculo
            key={vehiculoEdit?.id ?? 'nuevo-vehiculo'}
            accion={guardarVehiculo}
            inicial={vehiculoEdit ? {
              id: vehiculoEdit.id,
              patente: formatearPatente(vehiculoEdit.patente),
              descripcion: vehiculoEdit.descripcion ?? '',
              capacidad_kg: vehiculoEdit.capacidad_kg === null ? '' : String(vehiculoEdit.capacidad_kg),
            } : undefined}
          />
        </div>
        <Tabla>
          <thead><tr><Th>Patente</Th><Th>Descripción</Th><Th className="text-right">Capacidad (kg)</Th><Th>Estado</Th><Th /></tr></thead>
          <tbody>
            {(vehiculos ?? []).map((v) => (
              <Tr key={v.id}>
                <Td className="font-mono">{formatearPatente(v.patente)}</Td>
                <Td>{v.descripcion ?? '—'}</Td>
                <Td className="text-right font-mono">{v.capacidad_kg ?? '—'}</Td>
                <Td>{v.activo ? <Insignia tono="verde">Activo</Insignia> : <Insignia tono="gris">Inactivo</Insignia>}</Td>
                <Td>
                  <div className="flex items-center justify-end gap-3">
                    <Link className="text-sm text-marca-700 hover:underline" href={`/flota?ev=${v.id}`}>Editar</Link>
                    <form action={alternarActivoVehiculo}>
                      <input type="hidden" name="id" value={v.id} /><input type="hidden" name="activo" value={String(v.activo)} />
                      <Boton variante="secundario" type="submit" className="px-2 py-1 text-xs">{v.activo ? 'Desactivar' : 'Reactivar'}</Boton>
                    </form>
                  </div>
                </Td>
              </Tr>
            ))}
            {(vehiculos ?? []).length === 0 && <Tr><Td colSpan={5} className="py-8 text-center text-slate-500">No hay vehículos todavía.</Td></Tr>}
          </tbody>
        </Tabla>
      </section>
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-800">Conductores</h2>
        <div className="mb-4">
          <FormularioConductor
            key={conductorEdit?.id ?? 'nuevo-conductor'}
            accion={guardarConductor}
            inicial={conductorEdit ? {
              id: conductorEdit.id,
              rut: formatearRut(conductorEdit.rut),
              nombre: conductorEdit.nombre,
              telefono: conductorEdit.telefono ?? '',
            } : undefined}
          />
        </div>
        <Tabla>
          <thead><tr><Th>RUT</Th><Th>Nombre</Th><Th>Teléfono</Th><Th>Estado</Th><Th /></tr></thead>
          <tbody>
            {(conductores ?? []).map((c) => (
              <Tr key={c.id}>
                <Td className="font-mono">{formatearRut(c.rut)}</Td>
                <Td>{c.nombre}</Td>
                <Td>{c.telefono ?? '—'}</Td>
                <Td>{c.activo ? <Insignia tono="verde">Activo</Insignia> : <Insignia tono="gris">Inactivo</Insignia>}</Td>
                <Td>
                  <div className="flex items-center justify-end gap-3">
                    <Link className="text-sm text-marca-700 hover:underline" href={`/flota?ec=${c.id}`}>Editar</Link>
                    <form action={alternarActivoConductor}>
                      <input type="hidden" name="id" value={c.id} /><input type="hidden" name="activo" value={String(c.activo)} />
                      <Boton variante="secundario" type="submit" className="px-2 py-1 text-xs">{c.activo ? 'Desactivar' : 'Reactivar'}</Boton>
                    </form>
                  </div>
                </Td>
              </Tr>
            ))}
            {(conductores ?? []).length === 0 && <Tr><Td colSpan={5} className="py-8 text-center text-slate-500">No hay conductores todavía.</Td></Tr>}
          </tbody>
        </Tabla>
      </section>
    </div>
  )
}
```

- [ ] **Step 5: Verificar y commit**

Run: `pnpm --filter erp build` → compila sin errores y la ruta `/flota` aparece en el listado de rutas del output.

```bash
git add apps/erp/app/flota apps/erp/componentes/formulario-vehiculo.tsx apps/erp/componentes/formulario-conductor.tsx
git commit -m "feat(erp): flota — vehículos y conductores"
```

---
### Task 9: ERP — Tarifario de destinos

**Files:**
- Create: `apps/erp/app/tarifario/acciones.ts`, `apps/erp/componentes/formulario-destino.tsx`, `apps/erp/app/tarifario/page.tsx`

**Interfaces:**
- Consumes: tabla `destinos` (migración 0016 — insert/update directos SOLO dueno/admin: tarifas = dinero, vendedor NO edita; índice único CI `(empresa_id, lower(nombre))`; grant de update POR COLUMNAS `(tarifa_kg, activo)` — nombre/empresa_id inmutables, la colisión CI solo puede ocurrir en el insert); tipos `@suite/db` regenerados (Task 4); `formatearCLP` de `@suite/core`; `obtenerEmpresaActiva` con `activa.modulo_transporte` en `EmpresaResumen` (Task 7 — NAV condicional); componentes `@suite/ui`.
- Espejo estructural: mapeo del 23505 del índice CI como `resolverCategoria` en `apps/erp/app/productos/acciones.ts`; formulario y alternar-activo como `apps/erp/app/inventario/proveedores/` — léelos antes de escribir.
- Produces: página `/tarifario` (alta inline, editar tarifa vía query param `e`, activar/desactivar, copy de prospectividad); Server Actions `guardarDestino` y `alternarActivoDestino`.
- Guard de módulo: `notFound()` si `!activa.modulo_transporte` — UX, no seguridad.

- [ ] **Step 1: Server Actions del tarifario**

`apps/erp/app/tarifario/acciones.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import type { EstadoForm } from '../tipos'

export async function guardarDestino(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const id = String(formData.get('id') ?? '')
  const tarifaCruda = String(formData.get('tarifa_kg') ?? '').trim()
  const tarifaKg = Number(tarifaCruda)
  if (tarifaCruda === '' || !Number.isInteger(tarifaKg) || tarifaKg < 1) {
    return { error: 'La tarifa debe ser un entero CLP mayor a 0' }
  }

  const supabase = await crearClienteServidor()
  if (id) {
    // Solo columnas del grant: nombre y empresa_id son inmutables (grant por columnas de 0016).
    const { data, error } = await supabase
      .from('destinos')
      .update({ tarifa_kg: tarifaKg })
      .eq('id', id)
      .eq('empresa_id', activa.id)
      .select('id')
    if (error) {
      if (error.code === '42501') return { error: 'Tu rol no permite gestionar el tarifario' }
      return { error: 'No se pudo guardar el destino' }
    }
    if ((data ?? []).length === 0) {
      return { error: 'No se pudo guardar: el destino no existe o tu rol no permite editarlo' }
    }
  } else {
    const nombre = String(formData.get('nombre') ?? '').trim()
    if (nombre === '') return { error: 'El nombre del destino es obligatorio' }
    const { error } = await supabase.from('destinos').insert({
      empresa_id: activa.id,
      nombre,
      tarifa_kg: tarifaKg,
    })
    if (error) {
      // El índice CI (empresa_id, lower(nombre)) lanza 23505 también con variantes de caso (patrón categorías 0015).
      if (error.code === '23505') return { error: 'Ese destino ya existe' }
      if (error.code === '42501') return { error: 'Tu rol no permite gestionar el tarifario' }
      return { error: 'No se pudo crear el destino' }
    }
  }
  revalidatePath('/tarifario')
  redirect('/tarifario')
}

export async function alternarActivoDestino(formData: FormData): Promise<void> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return
  const id = String(formData.get('id') ?? '')
  const activo = String(formData.get('activo') ?? '') === 'true'
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase
    .from('destinos')
    .update({ activo: !activo })
    .eq('id', id)
    .eq('empresa_id', activa.id)
    .select('id')
  if (error || (data ?? []).length === 0) {
    console.error('alternarActivoDestino:', error ?? 'sin filas')
    return
  }
  revalidatePath('/tarifario')
}
```

- [ ] **Step 2: Formulario de destino (cliente)**

`apps/erp/componentes/formulario-destino.tsx` (un solo componente para alta y edición; en edición el nombre va `disabled` — no viaja en el POST y el update solo toca `tarifa_kg`):

```tsx
'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { Boton, Campo, Entrada, Tarjeta } from '@suite/ui'
import type { EstadoForm } from '../app/tipos'

export interface DestinoEditable {
  id?: string
  nombre: string
  tarifa_kg: string
}

const VACIO: DestinoEditable = { nombre: '', tarifa_kg: '' }

export function FormularioDestino({
  accion, inicial = VACIO,
}: {
  accion: (prev: EstadoForm, formData: FormData) => Promise<EstadoForm>
  inicial?: DestinoEditable
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoForm)
  return (
    <Tarjeta className="max-w-2xl">
      <form action={enviar} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {inicial.id && <input type="hidden" name="id" value={inicial.id} />}
        {inicial.id ? (
          <Campo etiqueta="Destino (no editable)"><Entrada value={inicial.nombre} disabled /></Campo>
        ) : (
          <Campo etiqueta="Destino *"><Entrada name="nombre" defaultValue={inicial.nombre} placeholder="Punta Arenas" required /></Campo>
        )}
        <Campo etiqueta="Tarifa por kg afecto (CLP) *">
          <Entrada name="tarifa_kg" inputMode="numeric" defaultValue={inicial.tarifa_kg} required />
        </Campo>
        <div className="flex items-center justify-end gap-2 sm:col-span-3">
          {estado.error && <span className="mr-auto text-sm text-red-600">{estado.error}</span>}
          {inicial.id && <Link className="text-sm text-slate-500 hover:underline" href="/tarifario">Cancelar</Link>}
          <Boton type="submit" disabled={pendiente}>
            {pendiente ? 'Guardando…' : inicial.id ? 'Guardar tarifa' : 'Agregar destino'}
          </Boton>
        </div>
      </form>
    </Tarjeta>
  )
}
```

- [ ] **Step 3: Página `/tarifario`**

`apps/erp/app/tarifario/page.tsx` (el `key` del formulario fuerza el remount entre alta y edición; el copy de prospectividad es CONTRATO del spec §6 — los cambios de tarifa jamás recalculan lo persistido):

```tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP } from '@suite/core'
import { Boton, Encabezado, Insignia, Tabla, Td, Th, Tr } from '@suite/ui'
import { FormularioDestino } from '../../componentes/formulario-destino'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import { alternarActivoDestino, guardarDestino } from './acciones'

export default async function PaginaTarifario({
  searchParams,
}: {
  searchParams: Promise<{ e?: string }>
}) {
  const { e = '' } = await searchParams
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  if (!activa.modulo_transporte) notFound()
  const supabase = await crearClienteServidor()
  const { data: destinos } = await supabase
    .from('destinos')
    .select('id, nombre, tarifa_kg, activo')
    .eq('empresa_id', activa.id)
    .order('nombre')
  const destinoEdit = (destinos ?? []).find((d) => d.id === e) ?? null
  return (
    <div>
      <Encabezado titulo="Tarifario de destinos" />
      <p className="mb-4 max-w-2xl text-sm text-slate-500">
        Los cambios de tarifa aplican solo a órdenes de entrega NUEVAS: lo ya registrado conserva su kilo
        afecto y su neto. Solo dueño o administrador pueden modificar el tarifario.
      </p>
      <div className="mb-4">
        <FormularioDestino
          key={destinoEdit?.id ?? 'nuevo-destino'}
          accion={guardarDestino}
          inicial={destinoEdit ? {
            id: destinoEdit.id,
            nombre: destinoEdit.nombre,
            tarifa_kg: String(destinoEdit.tarifa_kg),
          } : undefined}
        />
      </div>
      <Tabla>
        <thead><tr><Th>Destino</Th><Th className="text-right">Tarifa por kg afecto</Th><Th>Estado</Th><Th /></tr></thead>
        <tbody>
          {(destinos ?? []).map((d) => (
            <Tr key={d.id}>
              <Td>{d.nombre}</Td>
              <Td className="text-right font-mono">{formatearCLP(d.tarifa_kg)}/kg</Td>
              <Td>{d.activo ? <Insignia tono="verde">Activo</Insignia> : <Insignia tono="gris">Inactivo</Insignia>}</Td>
              <Td>
                <div className="flex items-center justify-end gap-3">
                  <Link className="text-sm text-marca-700 hover:underline" href={`/tarifario?e=${d.id}`}>Editar tarifa</Link>
                  <form action={alternarActivoDestino}>
                    <input type="hidden" name="id" value={d.id} /><input type="hidden" name="activo" value={String(d.activo)} />
                    <Boton variante="secundario" type="submit" className="px-2 py-1 text-xs">{d.activo ? 'Desactivar' : 'Reactivar'}</Boton>
                  </form>
                </div>
              </Td>
            </Tr>
          ))}
          {(destinos ?? []).length === 0 && <Tr><Td colSpan={4} className="py-8 text-center text-slate-500">No hay destinos todavía.</Td></Tr>}
        </tbody>
      </Tabla>
    </div>
  )
}
```

- [ ] **Step 4: Verificar y commit**

Run: `pnpm --filter erp build` → compila sin errores y la ruta `/tarifario` aparece en el listado de rutas del output.

```bash
git add apps/erp/app/tarifario apps/erp/componentes/formulario-destino.tsx
git commit -m "feat(erp): tarifario de destinos"
```

---
### Task 10: ERP — Entregas (ODEs)

**Files:**
- Create: `apps/erp/app/entregas/estados.ts`, `apps/erp/app/entregas/acciones.ts`, `apps/erp/app/entregas/page.tsx`, `apps/erp/app/entregas/nueva/page.tsx`, `apps/erp/componentes/formulario-orden-entrega.tsx`, `apps/erp/componentes/formulario-anular-orden.tsx`, `apps/erp/componentes/formulario-despacho.tsx`

**Interfaces:**
- Consumes: tabla `ordenes_entrega` con embeds vía FK compuesta `clientes (razon_social)`, `destinos (nombre)`, `proformas (numero)`, `vehiculos (patente)`, `conductores (nombre)` (migración 0016 + tipos regenerados en tasks previas; mismo mecanismo de embed probado en `cotizaciones → clientes`); maestros `destinos`/`vehiculos`/`conductores` y `empresas.factor_volumetrico` (select directo); RPCs `crear_orden_entrega(p_empresa uuid, p_cliente uuid, p_fecha date, p_destino uuid, p_docum text, p_oc text, p_bultos integer, p_kilos numeric, p_m3 numeric, p_neto integer, p_vehiculo uuid, p_conductor uuid, p_notas text) returns uuid`, `anular_orden_entrega(p_empresa uuid, p_orden uuid, p_motivo text)`, `asignar_despacho(p_empresa uuid, p_orden uuid, p_vehiculo uuid, p_conductor uuid)`; `kiloAfecto`/`formatearCLP`/`formatearNumeroProforma`/`rangoDeMes` de `@suite/core`; `obtenerEmpresaActiva` con `EmpresaResumen.modulo_transporte` (lo produce la task de Configuración/NAV); `EstadoForm` de `apps/erp/app/tipos.ts`; componentes `@suite/ui`.
- Produces: páginas `/entregas` (nómina espejo de la del usuario, filtros GET `cliente`/`destino`/`estado`/`mes`, totales al pie, anular y asignar despacho inline) y `/entregas/nueva`; Server Actions `crearOrdenEntrega`/`anularOrdenEntrega`/`asignarDespacho` con firma `(prev: EstadoForm, formData: FormData) => Promise<EstadoForm>`; `estados.ts` con `TONO_ESTADO`/`ETIQUETA_ESTADO`/`ESTADOS_ORDEN`; componentes `FormularioOrdenEntrega`, `FormularioAnularOrden`, `FormularioDespacho`. El link `PF-...` de la columna Estado apunta a `/proformas/[id]`, que 404ea hasta Task 11 — transitorio esperado.
- Guard de módulo: `notFound()` si `!activa.modulo_transporte` en ambas páginas — UX, no seguridad (la RPC re-valida server-side).

- [ ] **Step 1: Mapas de estado centralizados**

`apps/erp/app/entregas/estados.ts` (mismo patrón `apps/erp/app/cotizaciones/estados.ts`):

```ts
export const TONO_ESTADO: Record<string, 'verde' | 'amarillo' | 'rojo' | 'gris'> = {
  registrada: 'amarillo',
  facturada: 'verde',
  anulada: 'rojo',
}

export const ETIQUETA_ESTADO: Record<string, string> = {
  registrada: 'Registrada',
  facturada: 'Facturada',
  anulada: 'Anulada',
}

export const ESTADOS_ORDEN = ['registrada', 'facturada', 'anulada'] as const
```

- [ ] **Step 2: Server Actions**

`apps/erp/app/entregas/acciones.ts` (estructura espejo de `apps/erp/app/cotizaciones/acciones.ts`: validaciones antes del RPC, casts documentados, claves de mapeo del spec §7):

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import type { EstadoForm } from '../tipos'

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/

export async function crearOrdenEntrega(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const cliente = String(formData.get('cliente_id') ?? '')
  const fecha = String(formData.get('fecha_ingreso') ?? '').trim()
  const destino = String(formData.get('destino_id') ?? '')
  const docum = String(formData.get('docum') ?? '').trim()
  const oc = String(formData.get('oc_cliente') ?? '').trim()
  const notas = String(formData.get('notas') ?? '').trim()
  const vehiculo = String(formData.get('vehiculo_id') ?? '')
  const conductor = String(formData.get('conductor_id') ?? '')
  const bultos = Number(formData.get('bultos'))
  const kilos = Number(formData.get('kilos'))
  const m3Crudo = String(formData.get('m3') ?? '').trim()
  const m3 = m3Crudo === '' ? null : Number(m3Crudo)
  const neto = Number(formData.get('neto'))

  if (!cliente) return { error: 'Selecciona un cliente' }
  if (!FECHA_ISO.test(fecha)) return { error: 'Ingresa la fecha de ingreso' }
  if (!destino) return { error: 'Selecciona un destino' }
  if (!Number.isInteger(bultos) || bultos < 1) return { error: 'Los bultos deben ser un entero mayor a 0' }
  if (!Number.isFinite(kilos) || kilos <= 0) return { error: 'Los kilos deben ser mayores a 0' }
  if (m3 !== null && (!Number.isFinite(m3) || m3 < 0)) return { error: 'Los M3 no pueden ser negativos' }
  if (!Number.isInteger(neto) || neto < 1) return { error: 'El neto debe ser un entero mayor a 0' }

  const supabase = await crearClienteServidor()
  // p_docum/p_oc/p_m3/p_vehiculo/p_conductor/p_notas aceptan NULL en SQL, pero el codegen no
  // refleja la nulabilidad de argumentos de función: casts solo de tipo (criterio cotizaciones).
  // kilo_afecto NO viaja: lo calcula SIEMPRE la RPC server-side.
  const { error } = await supabase.rpc('crear_orden_entrega', {
    p_empresa: activa.id,
    p_cliente: cliente,
    p_fecha: fecha,
    p_destino: destino,
    p_docum: (docum || null) as string,
    p_oc: (oc || null) as string,
    p_bultos: bultos,
    p_kilos: kilos,
    p_m3: m3 as number,
    p_neto: neto,
    p_vehiculo: (vehiculo || null) as string,
    p_conductor: (conductor || null) as string,
    p_notas: (notas || null) as string,
  })
  if (error) {
    // Claves de mapeo del spec §7 — substrings únicos dentro del set de crear_orden_entrega.
    // 'módulo' antes que 'rol' por claridad; 'kilos deben'/'kilos superan' y 'M3 no'/'M3 superan'
    // desambiguan mínimos de topes; 'bultos' se chequea antes que 'neto' (comparten 'entero mayor a 0').
    if (error.message.includes('módulo')) return { error: 'El módulo de transporte no está activo' }
    if (error.message.includes('rol')) return { error: 'Tu rol no permite registrar órdenes de entrega' }
    if (error.message.includes('Cliente')) return { error: 'Cliente no válido' }
    if (error.message.includes('Destino')) return { error: 'Destino no válido' }
    if (error.message.includes('Vehículo')) return { error: 'Vehículo no válido' }
    if (error.message.includes('Conductor')) return { error: 'Conductor no válido' }
    if (error.message.includes('fecha')) return { error: 'Ingresa la fecha de ingreso' }
    if (error.message.includes('bultos')) return { error: 'Los bultos deben ser un entero mayor a 0' }
    if (error.message.includes('kilos deben')) return { error: 'Los kilos deben ser mayores a 0' }
    if (error.message.includes('kilos superan')) return { error: 'Los kilos superan el máximo admitido' }
    if (error.message.includes('M3 no')) return { error: 'Los M3 no pueden ser negativos' }
    if (error.message.includes('M3 superan')) return { error: 'Los M3 superan el máximo admitido' }
    if (error.message.includes('neto')) return { error: 'El neto debe ser un entero mayor a 0' }
    if (error.message.includes('tarifar')) return { error: 'La carga es demasiado pequeña para tarifar' }
    return { error: 'No se pudo registrar la orden de entrega' }
  }
  revalidatePath('/entregas')
  redirect('/entregas')
}

export async function anularOrdenEntrega(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  const orden = String(formData.get('orden_id') ?? '')
  const motivo = String(formData.get('motivo') ?? '').trim()
  if (!orden) return { error: 'Orden no válida' }
  if (!motivo) return { error: 'La anulación requiere un motivo' }
  const supabase = await crearClienteServidor()
  const { error } = await supabase.rpc('anular_orden_entrega', {
    p_empresa: activa.id,
    p_orden: orden,
    p_motivo: motivo,
  })
  if (error) {
    // Claves del spec §7: 'rol' / 'motivo' / 'no existe' / 'registrada' / 'recházala'.
    if (error.message.includes('rol')) return { error: 'Tu rol no permite anular órdenes de entrega' }
    if (error.message.includes('motivo')) return { error: 'La anulación requiere un motivo' }
    if (error.message.includes('recházala')) return { error: 'La orden está en una proforma; recházala primero' }
    if (error.message.includes('registrada')) return { error: 'Solo se puede anular una orden registrada' }
    if (error.message.includes('no existe')) return { error: 'La orden de entrega no existe' }
    return { error: 'No se pudo anular la orden de entrega' }
  }
  revalidatePath('/entregas')
  return {}
}

export async function asignarDespacho(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  const orden = String(formData.get('orden_id') ?? '')
  const vehiculo = String(formData.get('vehiculo_id') ?? '')
  const conductor = String(formData.get('conductor_id') ?? '')
  if (!orden) return { error: 'Orden no válida' }
  const supabase = await crearClienteServidor()
  // p_vehiculo/p_conductor aceptan NULL en SQL (null = desasignar): cast solo de tipo.
  const { error } = await supabase.rpc('asignar_despacho', {
    p_empresa: activa.id,
    p_orden: orden,
    p_vehiculo: (vehiculo || null) as string,
    p_conductor: (conductor || null) as string,
  })
  if (error) {
    // Claves del spec §7: 'rol' / 'no existe' / 'anulada' / 'Vehículo' / 'Conductor'.
    if (error.message.includes('rol')) return { error: 'Tu rol no permite asignar despachos' }
    if (error.message.includes('no existe')) return { error: 'La orden de entrega no existe' }
    if (error.message.includes('anulada')) return { error: 'No se puede asignar despacho a una orden anulada' }
    if (error.message.includes('Vehículo')) return { error: 'Vehículo no válido' }
    if (error.message.includes('Conductor')) return { error: 'Conductor no válido' }
    return { error: 'No se pudo asignar el despacho' }
  }
  revalidatePath('/entregas')
  return {}
}
```

- [ ] **Step 3: Formulario de nueva orden con kilo afecto en vivo y neto sugerido**

`apps/erp/componentes/formulario-orden-entrega.tsx` (espejo estructural de `apps/erp/componentes/formulario-cotizacion.tsx`). Regla EXACTA del spec §6 para el neto: mientras NO haya edición manual, el input muestra el sugerido DERIVADO (`kilo_afecto × tarifa` del destino) y se re-sugiere solo con cada cambio de destino/kilos/M3; al editar a mano queda `negociado` y deja de re-sugerirse; cambiar el DESTINO limpia la marca y vuelve a sugerir; el botón "Usar sugerido" también limpia la marca:

```tsx
'use client'

import { useActionState, useState } from 'react'
import { formatearCLP, kiloAfecto } from '@suite/core'
import { Boton, Campo, Entrada, Selector, Tarjeta } from '@suite/ui'
import type { EstadoForm } from '../app/tipos'

interface ClienteOpcion { id: string; razon_social: string }
interface DestinoOpcion { id: string; nombre: string; tarifa_kg: number }
interface VehiculoOpcion { id: string; patente: string }
interface ConductorOpcion { id: string; nombre: string }

const HOY = () => new Date().toISOString().slice(0, 10)

export function FormularioOrdenEntrega({
  accion,
  clientes,
  destinos,
  vehiculos,
  conductores,
  factor,
}: {
  accion: (prev: EstadoForm, formData: FormData) => Promise<EstadoForm>
  clientes: ClienteOpcion[]
  destinos: DestinoOpcion[]
  vehiculos: VehiculoOpcion[]
  conductores: ConductorOpcion[]
  factor: number
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoForm)
  const [destinoId, setDestinoId] = useState('')
  const [kilos, setKilos] = useState('')
  const [m3, setM3] = useState('')
  const [netoManual, setNetoManual] = useState(0)
  const [negociado, setNegociado] = useState(false)

  const destino = destinos.find((d) => d.id === destinoId)
  const kilosNum = Number(kilos)
  const m3Num = m3 === '' ? null : Number(m3)
  // Kilo afecto EN VIVO con la misma aritmética de la RPC (kiloAfecto de @suite/core).
  // Solo display: el valor que persiste lo calcula SIEMPRE el servidor.
  const ka = Number.isFinite(kilosNum) && kilosNum > 0 ? kiloAfecto(kilosNum, m3Num, factor) : 0
  const sugerido = destino && ka > 0 ? ka * destino.tarifa_kg : 0
  // Derivado, no efecto: mientras no esté negociado, el input refleja el sugerido en vivo.
  const neto = negociado ? netoManual : sugerido

  return (
    <form action={enviar} className="max-w-3xl">
      <Tarjeta className="mb-4">
        <div className="grid gap-3 md:grid-cols-3">
          <Campo etiqueta="Cliente *">
            <Selector name="cliente_id" required defaultValue="">
              <option value="" disabled>Selecciona…</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>{c.razon_social}</option>
              ))}
            </Selector>
          </Campo>
          <Campo etiqueta="Fecha de ingreso *">
            <Entrada type="date" name="fecha_ingreso" required defaultValue={HOY()} />
          </Campo>
          <Campo etiqueta="Destino *">
            <Selector
              name="destino_id"
              required
              value={destinoId}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => { setDestinoId(e.currentTarget.value); setNegociado(false) }}
            >
              <option value="" disabled>Selecciona…</option>
              {destinos.map((d) => (
                <option key={d.id} value={d.id}>{d.nombre} — {formatearCLP(d.tarifa_kg)}/kg</option>
              ))}
            </Selector>
          </Campo>
          <Campo etiqueta="Docum (guías)">
            <Entrada name="docum" placeholder="Opcional" />
          </Campo>
          <Campo etiqueta="OC del cliente">
            <Entrada name="oc_cliente" placeholder="Opcional" />
          </Campo>
          <Campo etiqueta="Bultos *">
            <Entrada type="number" name="bultos" min={1} step={1} required />
          </Campo>
          <Campo etiqueta="Kilos *">
            <Entrada type="number" name="kilos" min={0.01} step={0.01} required value={kilos} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setKilos(e.currentTarget.value)} />
          </Campo>
          <Campo etiqueta="M3">
            <Entrada type="number" name="m3" min={0} step={0.01} value={m3} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setM3(e.currentTarget.value)} />
          </Campo>
          <Campo etiqueta="Vehículo">
            <Selector name="vehiculo_id" defaultValue="">
              <option value="">Sin asignar</option>
              {vehiculos.map((v) => (
                <option key={v.id} value={v.id}>{v.patente}</option>
              ))}
            </Selector>
          </Campo>
          <Campo etiqueta="Conductor">
            <Selector name="conductor_id" defaultValue="">
              <option value="">Sin asignar</option>
              {conductores.map((c) => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
            </Selector>
          </Campo>
          <Campo etiqueta="Notas">
            <Entrada name="notas" placeholder="Opcional" />
          </Campo>
        </div>
      </Tarjeta>

      <Tarjeta className="mb-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="text-sm">
            Kilo afecto: <strong>{ka > 0 ? ka.toLocaleString('es-CL') : '—'}</strong>
            {destino && <span className="ml-2 text-slate-500">Tarifa {destino.nombre}: {formatearCLP(destino.tarifa_kg)}/kg afecto</span>}
          </div>
          <Campo etiqueta={negociado ? 'Neto (negociado)' : 'Neto (sugerido)'}>
            <Entrada
              type="number"
              name="neto"
              min={1}
              step={1}
              required
              value={neto === 0 ? '' : neto}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                setNetoManual(Math.max(0, Math.trunc(Number(e.currentTarget.value)) || 0))
                setNegociado(true)
              }}
              className="w-36 text-right"
            />
          </Campo>
          {negociado && sugerido > 0 && (
            <Boton variante="secundario" type="button" onClick={() => setNegociado(false)}>
              Usar sugerido ({formatearCLP(sugerido)})
            </Boton>
          )}
        </div>
      </Tarjeta>

      <div className="flex items-center justify-end gap-2">
        {estado.error && <span className="mr-auto text-sm text-red-600">{estado.error}</span>}
        <Boton type="submit" disabled={pendiente}>{pendiente ? 'Guardando…' : 'Registrar orden'}</Boton>
      </div>
    </form>
  )
}
```

- [ ] **Step 4: Formularios inline de anulación y despacho**

`apps/erp/componentes/formulario-anular-orden.tsx` (espejo de `apps/erp/componentes/formulario-anular.tsx`):

```tsx
'use client'

import { useActionState, useState } from 'react'
import { Boton, Entrada } from '@suite/ui'
import { anularOrdenEntrega } from '../app/entregas/acciones'
import type { EstadoForm } from '../app/tipos'

export function FormularioAnularOrden({ ordenId }: { ordenId: string }) {
  const [abierto, setAbierto] = useState(false)
  const [estado, enviar, pendiente] = useActionState(anularOrdenEntrega, {} as EstadoForm)
  if (!abierto) {
    return <Boton variante="secundario" type="button" className="px-2 py-1 text-xs" onClick={() => setAbierto(true)}>Anular</Boton>
  }
  return (
    <form action={enviar} className="flex items-center gap-2">
      <input type="hidden" name="orden_id" value={ordenId} />
      <Entrada name="motivo" placeholder="Motivo *" required className="w-40 text-xs" />
      <Boton variante="secundario" type="submit" disabled={pendiente} className="px-2 py-1 text-xs">{pendiente ? '…' : 'Confirmar'}</Boton>
      {estado.error && <span className="text-xs text-red-600">{estado.error}</span>}
    </form>
  )
}
```

`apps/erp/componentes/formulario-despacho.tsx` (mismo patrón abre/cierra; opera sobre cualquier ODE no anulada, la RPC valida):

```tsx
'use client'

import { useActionState, useState } from 'react'
import { Boton, Selector } from '@suite/ui'
import { asignarDespacho } from '../app/entregas/acciones'
import type { EstadoForm } from '../app/tipos'

interface VehiculoOpcion { id: string; patente: string }
interface ConductorOpcion { id: string; nombre: string }

export function FormularioDespacho({
  ordenId,
  vehiculoId,
  conductorId,
  actual,
  vehiculos,
  conductores,
}: {
  ordenId: string
  vehiculoId: string | null
  conductorId: string | null
  // Etiqueta del despacho vigente (patente o conductor), resuelta por la página vía embed
  // — cubre vehículos/conductores hoy inactivos que las listas de opciones ya no traen.
  actual: string | null
  vehiculos: VehiculoOpcion[]
  conductores: ConductorOpcion[]
}) {
  const [abierto, setAbierto] = useState(false)
  const [estado, enviar, pendiente] = useActionState(asignarDespacho, {} as EstadoForm)
  if (!abierto) {
    return (
      <Boton variante="secundario" type="button" className="px-2 py-1 text-xs" onClick={() => setAbierto(true)}>
        {actual ?? 'Despacho'}
      </Boton>
    )
  }
  return (
    <form action={enviar} className="flex items-center gap-1">
      <input type="hidden" name="orden_id" value={ordenId} />
      <Selector name="vehiculo_id" defaultValue={vehiculoId ?? ''} className="w-32 text-xs">
        <option value="">Sin vehículo</option>
        {vehiculos.map((v) => (
          <option key={v.id} value={v.id}>{v.patente}</option>
        ))}
      </Selector>
      <Selector name="conductor_id" defaultValue={conductorId ?? ''} className="w-32 text-xs">
        <option value="">Sin conductor</option>
        {conductores.map((c) => (
          <option key={c.id} value={c.id}>{c.nombre}</option>
        ))}
      </Selector>
      <Boton variante="secundario" type="submit" disabled={pendiente} className="px-2 py-1 text-xs">{pendiente ? '…' : 'Asignar'}</Boton>
      {estado.error && <span className="text-xs text-red-600">{estado.error}</span>}
    </form>
  )
}
```

- [ ] **Step 5: Página de nueva orden**

`apps/erp/app/entregas/nueva/page.tsx` (espejo de `apps/erp/app/cotizaciones/nueva/page.tsx` + guard de módulo; el factor volumétrico se lee de `empresas` — cambios de factor son prospectivos, el form solo lo usa para el display en vivo):

```tsx
import { notFound } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { Encabezado } from '@suite/ui'
import { FormularioOrdenEntrega } from '../../../componentes/formulario-orden-entrega'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { crearOrdenEntrega } from '../acciones'

export default async function NuevaOrdenEntrega() {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  if (!activa.modulo_transporte) notFound()
  const supabase = await crearClienteServidor()
  const [{ data: empresa }, { data: clientes }, { data: destinos }, { data: vehiculos }, { data: conductores }] = await Promise.all([
    supabase.from('empresas').select('factor_volumetrico').eq('id', activa.id).single(),
    supabase.from('clientes').select('id, razon_social').eq('empresa_id', activa.id).eq('activo', true).order('razon_social'),
    supabase.from('destinos').select('id, nombre, tarifa_kg').eq('empresa_id', activa.id).eq('activo', true).order('nombre'),
    supabase.from('vehiculos').select('id, patente').eq('empresa_id', activa.id).eq('activo', true).order('patente'),
    supabase.from('conductores').select('id, nombre').eq('empresa_id', activa.id).eq('activo', true).order('nombre'),
  ])
  return (
    <div>
      <Encabezado titulo="Nueva orden de entrega" />
      <FormularioOrdenEntrega
        accion={crearOrdenEntrega}
        clientes={clientes ?? []}
        destinos={destinos ?? []}
        vehiculos={vehiculos ?? []}
        conductores={conductores ?? []}
        factor={empresa?.factor_volumetrico ?? 250}
      />
    </div>
  )
}
```

- [ ] **Step 6: Página de lista (nómina)**

`apps/erp/app/entregas/page.tsx` (espejo estructural de `apps/erp/app/cotizaciones/page.tsx` con las columnas de la NÓMINA real del usuario; filtro `mes` con `rangoDeMes` sobre `fecha_ingreso`; el filtro de destinos incluye inactivos porque hay ODEs históricas con ellos):

```tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP, formatearNumeroProforma, rangoDeMes } from '@suite/core'
import { Boton, Encabezado, Entrada, Insignia, Selector, Tabla, Td, Th, Tr } from '@suite/ui'
import { FormularioAnularOrden } from '../../componentes/formulario-anular-orden'
import { FormularioDespacho } from '../../componentes/formulario-despacho'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import { ESTADOS_ORDEN, ETIQUETA_ESTADO, TONO_ESTADO } from './estados'

const NUM = (n: number | null) => (n == null ? '—' : n.toLocaleString('es-CL', { maximumFractionDigits: 2 }))

export default async function PaginaEntregas({
  searchParams,
}: {
  searchParams: Promise<{ cliente?: string; destino?: string; estado?: string; mes?: string }>
}) {
  const { cliente = '', destino = '', estado = '', mes = '' } = await searchParams
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  if (!activa.modulo_transporte) notFound()
  const rango = rangoDeMes(mes)
  const supabase = await crearClienteServidor()
  const [{ data: clientes }, { data: destinos }, { data: vehiculos }, { data: conductores }, consulta] = await Promise.all([
    supabase.from('clientes').select('id, razon_social').eq('empresa_id', activa.id).eq('activo', true).order('razon_social'),
    supabase.from('destinos').select('id, nombre').eq('empresa_id', activa.id).order('nombre'),
    supabase.from('vehiculos').select('id, patente').eq('empresa_id', activa.id).eq('activo', true).order('patente'),
    supabase.from('conductores').select('id, nombre').eq('empresa_id', activa.id).eq('activo', true).order('nombre'),
    (() => {
      let q = supabase
        .from('ordenes_entrega')
        .select('id, numero, fecha_ingreso, docum, oc_cliente, bultos, kilos, m3, kilo_afecto, neto, estado, proforma_id, vehiculo_id, conductor_id, clientes (razon_social), destinos (nombre), proformas (numero), vehiculos (patente), conductores (nombre)')
        .eq('empresa_id', activa.id)
        .order('numero', { ascending: false })
        .limit(200)
      if (cliente) q = q.eq('cliente_id', cliente)
      if (destino) q = q.eq('destino_id', destino)
      if ((ESTADOS_ORDEN as readonly string[]).includes(estado)) q = q.eq('estado', estado)
      if (rango) q = q.gte('fecha_ingreso', rango.desde).lte('fecha_ingreso', rango.hasta)
      return q
    })(),
  ])
  const filas = consulta.data ?? []
  // Totales sin anuladas: una carga anulada no suma ni kilos ni plata.
  const vivas = filas.filter((f) => f.estado !== 'anulada')
  const tot = vivas.reduce(
    (a, f) => ({
      bultos: a.bultos + f.bultos,
      kilos: a.kilos + f.kilos,
      m3: a.m3 + (f.m3 ?? 0),
      kiloAfecto: a.kiloAfecto + f.kilo_afecto,
      neto: a.neto + f.neto,
    }),
    { bultos: 0, kilos: 0, m3: 0, kiloAfecto: 0, neto: 0 }
  )
  return (
    <div>
      <Encabezado titulo="Órdenes de entrega">
        <Link href="/entregas/nueva"><Boton>Nueva orden</Boton></Link>
      </Encabezado>
      <form className="mb-4 flex flex-wrap items-center gap-3" action="/entregas" method="get">
        <Selector name="cliente" defaultValue={cliente} className="max-w-xs">
          <option value="">Todos los clientes</option>
          {(clientes ?? []).map((c) => <option key={c.id} value={c.id}>{c.razon_social}</option>)}
        </Selector>
        <Selector name="destino" defaultValue={destino} className="max-w-xs">
          <option value="">Todos los destinos</option>
          {(destinos ?? []).map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
        </Selector>
        <Selector name="estado" defaultValue={estado} className="max-w-xs">
          <option value="">Todos los estados</option>
          {ESTADOS_ORDEN.map((e) => <option key={e} value={e}>{ETIQUETA_ESTADO[e]}</option>)}
        </Selector>
        <Entrada type="month" name="mes" defaultValue={mes} className="w-40" />
        <Boton variante="secundario" type="submit">Filtrar</Boton>
        <Link className="text-sm text-marca-700 hover:underline" href="/entregas">Limpiar</Link>
      </form>
      <Tabla>
        <thead>
          <tr>
            <Th>N° ODE</Th><Th>Fecha ingreso</Th><Th>Cliente</Th><Th>Destino</Th><Th>Docum</Th><Th>OC</Th>
            <Th className="text-right">Bultos</Th><Th className="text-right">Kilos</Th><Th className="text-right">M3</Th>
            <Th className="text-right">Kilo afecto</Th><Th className="text-right">Neto</Th><Th>Estado</Th><Th>Despacho</Th><Th />
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <Tr key={f.id}>
              <Td>{f.numero}</Td>
              <Td>{new Date(f.fecha_ingreso + 'T00:00:00').toLocaleDateString('es-CL')}</Td>
              <Td>{f.clientes?.razon_social ?? '—'}</Td>
              <Td>{f.destinos?.nombre ?? '—'}</Td>
              <Td>{f.docum ?? '—'}</Td>
              <Td>{f.oc_cliente ?? '—'}</Td>
              <Td className="text-right">{f.bultos}</Td>
              <Td className="text-right">{NUM(f.kilos)}</Td>
              <Td className="text-right">{NUM(f.m3)}</Td>
              <Td className="text-right">{NUM(f.kilo_afecto)}</Td>
              <Td className="text-right font-mono">{formatearCLP(f.neto)}</Td>
              <Td>
                <Insignia tono={TONO_ESTADO[f.estado] ?? 'gris'}>{ETIQUETA_ESTADO[f.estado] ?? f.estado}</Insignia>
                {f.proforma_id && f.proformas && (
                  <Link className="ml-1 text-xs text-marca-700 hover:underline" href={`/proformas/${f.proforma_id}`}>
                    {formatearNumeroProforma(f.proformas.numero)}
                  </Link>
                )}
              </Td>
              <Td>
                {f.estado !== 'anulada' && (
                  <FormularioDespacho
                    ordenId={f.id}
                    vehiculoId={f.vehiculo_id}
                    conductorId={f.conductor_id}
                    actual={f.vehiculos?.patente ?? f.conductores?.nombre ?? null}
                    vehiculos={vehiculos ?? []}
                    conductores={conductores ?? []}
                  />
                )}
              </Td>
              <Td>
                {f.estado === 'registrada' && !f.proforma_id && <FormularioAnularOrden ordenId={f.id} />}
              </Td>
            </Tr>
          ))}
          {filas.length === 0 && <Tr><Td colSpan={14} className="py-8 text-center text-slate-500">No hay órdenes de entrega {cliente || destino || estado || mes ? 'que coincidan' : 'todavía'}.</Td></Tr>}
        </tbody>
      </Tabla>
      <div className="mt-3 flex flex-wrap justify-end gap-6 text-sm">
        <span className="text-slate-500">Totales (sin anuladas):</span>
        <span>Órdenes: <strong>{vivas.length}</strong></span>
        <span>Bultos: <strong>{tot.bultos}</strong></span>
        <span>Kilos: <strong>{NUM(tot.kilos)}</strong></span>
        <span>M3: <strong>{NUM(tot.m3)}</strong></span>
        <span>Kilo afecto: <strong>{NUM(tot.kiloAfecto)}</strong></span>
        <span>Neto: <strong className="font-mono">{formatearCLP(tot.neto)}</strong></span>
      </div>
    </div>
  )
}
```

- [ ] **Step 7: Verificar build y commit**

Run (PowerShell, desde la raíz del repo):

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User'); pnpm --filter erp build
```

Salida esperada: compila sin errores y las rutas `/entregas` y `/entregas/nueva` aparecen en el listado de rutas del output (el link `PF-...` a `/proformas/[id]` 404ea hasta Task 11 — transitorio esperado).

```bash
git add apps/erp/app/entregas apps/erp/componentes/formulario-orden-entrega.tsx apps/erp/componentes/formulario-anular-orden.tsx apps/erp/componentes/formulario-despacho.tsx
git commit -m "feat(erp): órdenes de entrega — registro, despacho y anulación"
```

---
### Task 11: ERP — Proformas

**Files:**
- Create: `apps/erp/app/proformas/estados.ts`, `apps/erp/app/proformas/acciones.ts`, `apps/erp/app/proformas/page.tsx`, `apps/erp/app/proformas/nueva/page.tsx`, `apps/erp/app/proformas/[id]/page.tsx`, `apps/erp/componentes/formulario-proforma.tsx`, `apps/erp/componentes/acciones-proforma.tsx`

**Interfaces:**
- Consumes: tabla `proformas` con embeds vía FK compuesta `clientes (razon_social, rut)` y `documentos_venta (folio, estado, emitido_en)`; `ordenes_entrega` por `proforma_id` (Task 10 las crea; migración 0016 + tipos regenerados en tasks previas); RPCs `crear_proforma(p_empresa uuid, p_cliente uuid, p_ordenes uuid[], p_notas text) returns uuid`, `cambiar_estado_proforma(p_empresa uuid, p_proforma uuid, p_estado text, p_motivo text default null)`, `facturar_proforma(p_empresa uuid, p_proforma uuid) returns uuid`, `anular_estado_pago(p_empresa uuid, p_documento uuid)`; `formatearNumeroProforma`/`formatearCLP`/`formatearRut` de `@suite/core`; `BotonImprimir` EXISTENTE (`apps/erp/componentes/boton-imprimir.tsx`, Plan 9 — se reusa, no se recrea) y el layout ya apto para impresión (Plan 9 dejó la barra lateral en `print:hidden` y `main` con `print:p-0`: NO tocar `apps/erp/app/layout.tsx`); `obtenerEmpresaActiva` con `EmpresaResumen.modulo_transporte`; `EstadoForm`.
- Produces: páginas `/proformas` (lista), `/proformas/nueva` (checkboxes de ODEs libres con totales en vivo) y `/proformas/[id]` (encabezado espejo de la pantalla real + nómina + totales + vista imprimible "PROFORMA — Documento no tributario"); Server Actions `crearProforma`/`cambiarEstadoProforma`/`facturarProforma`/`anularEstadoPago`; `estados.ts` con `TONO_ESTADO`/`ETIQUETA_ESTADO`; componentes `FormularioProforma` y `AccionesProforma`.
- Mapeo de errores: `cambiar_estado_proforma` por claves de substring (`'rol'`/`'Transición'`/`'motivo'`/`'no existe'`); `crear_proforma`/`facturar_proforma`/`anular_estado_pago` por IGUALDAD ESTRICTA del mensaje completo (contrato spec §7). `redirect` SIEMPRE fuera de try/catch.
- EXCEPCIÓN rechazada (contrato spec §6): el detalle de una proforma `rechazada` muestra SOLO encabezado + motivo + totales ALMACENADOS — sin nómina ni botón Imprimir (sus ODEs fueron liberadas y ya pueden ser de otras proformas).

- [ ] **Step 1: Mapas de estado centralizados**

`apps/erp/app/proformas/estados.ts` (mismo patrón `apps/erp/app/cotizaciones/estados.ts`):

```ts
export const TONO_ESTADO: Record<string, 'verde' | 'amarillo' | 'rojo' | 'gris'> = {
  borrador: 'gris',
  enviada: 'amarillo',
  aprobada: 'verde',
  rechazada: 'rojo',
  facturada: 'verde',
}

export const ETIQUETA_ESTADO: Record<string, string> = {
  borrador: 'Borrador',
  enviada: 'Enviada',
  aprobada: 'Aprobada',
  rechazada: 'Rechazada',
  facturada: 'Facturada',
}
```

- [ ] **Step 2: Server Actions**

`apps/erp/app/proformas/acciones.ts` (estructura espejo de `apps/erp/app/cotizaciones/acciones.ts`; los sets de igualdad estricta devuelven el mensaje de la RPC tal cual — ya viene en español para el usuario):

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import type { EstadoForm } from '../tipos'

// IGUALDAD ESTRICTA del mensaje completo (contrato spec §7): cualquier otro error cae al genérico.
const ERRORES_CREAR = new Set([
  'El módulo de transporte no está activo',
  'Tu rol no permite gestionar proformas',
  'La proforma necesita al menos una orden de entrega',
  'Cliente no válido',
  'Hay una orden no válida, de otro cliente, ya facturada o en otra proforma',
  'La proforma supera el monto máximo facturable',
])

export async function crearProforma(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const cliente = String(formData.get('cliente_id') ?? '')
  const notas = String(formData.get('notas') ?? '').trim()
  if (!cliente) return { error: 'Selecciona un cliente' }

  let ordenes: string[]
  try {
    ordenes = JSON.parse(String(formData.get('ordenes') ?? '[]')) as string[]
  } catch {
    return { error: 'Las órdenes seleccionadas no son válidas' }
  }
  if (!Array.isArray(ordenes) || ordenes.length === 0) return { error: 'Selecciona al menos una orden de entrega' }
  if (ordenes.some((o) => typeof o !== 'string' || !o)) return { error: 'Las órdenes seleccionadas no son válidas' }

  const supabase = await crearClienteServidor()
  // p_notas acepta NULL en SQL, pero el codegen no refleja la nulabilidad de argumentos
  // de función: cast solo de tipo (mismo criterio que cotizaciones).
  const { data, error } = await supabase.rpc('crear_proforma', {
    p_empresa: activa.id,
    p_cliente: cliente,
    p_ordenes: ordenes,
    p_notas: (notas || null) as string,
  })
  if (error) {
    if (ERRORES_CREAR.has(error.message)) return { error: error.message }
    return { error: 'No se pudo crear la proforma' }
  }
  revalidatePath('/proformas')
  revalidatePath('/entregas')
  // redirect lanza NEXT_REDIRECT: va FUERA de cualquier try/catch. data = uuid de la proforma.
  redirect(`/proformas/${data}`)
}

const ESTADOS_DESTINO = ['enviada', 'aprobada', 'rechazada'] as const

export async function cambiarEstadoProforma(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  const proforma = String(formData.get('proforma_id') ?? '')
  const estado = String(formData.get('estado') ?? '')
  const motivo = String(formData.get('motivo') ?? '').trim()
  if (!proforma) return { error: 'Proforma no válida' }
  if (!(ESTADOS_DESTINO as readonly string[]).includes(estado)) return { error: 'Estado de destino no válido' }
  if (estado === 'rechazada' && motivo === '') return { error: 'El rechazo requiere un motivo' }
  const supabase = await crearClienteServidor()
  const { error } = await supabase.rpc('cambiar_estado_proforma', {
    p_empresa: activa.id,
    p_proforma: proforma,
    p_estado: estado,
    p_motivo: (motivo || null) as string,
  })
  if (error) {
    // Claves del spec §7: 'rol' / 'Transición' / 'motivo' / 'no existe'.
    if (error.message.includes('rol')) return { error: 'Tu rol no permite gestionar proformas' }
    if (error.message.includes('Transición')) return { error: 'Transición de estado no válida' }
    if (error.message.includes('motivo')) return { error: 'El rechazo requiere un motivo' }
    if (error.message.includes('no existe')) return { error: 'La proforma no existe' }
    return { error: 'No se pudo cambiar el estado de la proforma' }
  }
  revalidatePath('/proformas')
  revalidatePath(`/proformas/${proforma}`)
  revalidatePath('/entregas') // el rechazo libera ODEs
  return {}
}

const ERRORES_FACTURAR = new Set([
  'Tu rol no permite facturar proformas',
  'La proforma no existe',
  'Solo se puede facturar una proforma aprobada',
  'Hay una orden no válida, de otro cliente, ya facturada o en otra proforma',
])

export async function facturarProforma(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  const proforma = String(formData.get('proforma_id') ?? '')
  if (!proforma) return { error: 'Proforma no válida' }
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase.rpc('facturar_proforma', {
    p_empresa: activa.id,
    p_proforma: proforma,
  })
  if (error) {
    if (ERRORES_FACTURAR.has(error.message)) return { error: error.message }
    return { error: 'No se pudo facturar la proforma' }
  }
  revalidatePath('/proformas')
  revalidatePath(`/proformas/${proforma}`)
  revalidatePath('/entregas')
  revalidatePath('/ventas')
  // redirect lanza NEXT_REDIRECT: va FUERA de cualquier try/catch. data = uuid de la nota de venta creada.
  redirect(`/ventas/${data}`)
}

const ERRORES_DESHACER = new Set([
  'Tu rol no permite anular estados de pago',
  'El documento no existe',
  'El documento no proviene de una proforma',
  'Solo se puede deshacer un estado de pago en borrador o rechazado',
])

export async function anularEstadoPago(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  const documento = String(formData.get('documento_id') ?? '')
  const proforma = String(formData.get('proforma_id') ?? '')
  if (!documento) return { error: 'Documento no válido' }
  const supabase = await crearClienteServidor()
  const { error } = await supabase.rpc('anular_estado_pago', {
    p_empresa: activa.id,
    p_documento: documento,
  })
  if (error) {
    if (ERRORES_DESHACER.has(error.message)) return { error: error.message }
    return { error: 'No se pudo deshacer el estado de pago' }
  }
  revalidatePath('/proformas')
  if (proforma) revalidatePath(`/proformas/${proforma}`)
  revalidatePath('/entregas')
  revalidatePath('/ventas') // el documento de venta fue eliminado
  return {}
}
```

- [ ] **Step 3: Formulario de nueva proforma con totales en vivo**

`apps/erp/componentes/formulario-proforma.tsx` (espejo estructural de `apps/erp/componentes/formulario-cotizacion.tsx`; cambiar de cliente resetea la selección; `iva = Math.round(neto * 0.19)` — mismo criterio del servidor: IVA sobre el neto TOTAL):

```tsx
'use client'

import { useActionState, useState } from 'react'
import { formatearCLP } from '@suite/core'
import { Boton, Campo, Entrada, Selector, Tabla, Tarjeta, Td, Th, Tr } from '@suite/ui'
import type { EstadoForm } from '../app/tipos'

interface ClienteOpcion { id: string; razon_social: string }
interface OrdenDisponible {
  id: string
  cliente_id: string
  numero: number
  fecha_ingreso: string
  destino_nombre: string
  bultos: number
  kilos: number
  m3: number | null
  kilo_afecto: number
  neto: number
}

const NUM = (n: number | null) => (n == null ? '—' : n.toLocaleString('es-CL', { maximumFractionDigits: 2 }))

export function FormularioProforma({
  accion,
  clientes,
  ordenes,
}: {
  accion: (prev: EstadoForm, formData: FormData) => Promise<EstadoForm>
  clientes: ClienteOpcion[]
  ordenes: OrdenDisponible[]
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoForm)
  const [clienteId, setClienteId] = useState('')
  const [seleccion, setSeleccion] = useState<string[]>([])

  const disponibles = ordenes.filter((o) => o.cliente_id === clienteId)
  const elegidas = disponibles.filter((o) => seleccion.includes(o.id))
  const bultos = elegidas.reduce((s, o) => s + o.bultos, 0)
  const m3 = elegidas.reduce((s, o) => s + (o.m3 ?? 0), 0)
  const totalKiloAfecto = elegidas.reduce((s, o) => s + o.kilo_afecto, 0)
  const neto = elegidas.reduce((s, o) => s + o.neto, 0)
  const iva = Math.round(neto * 0.19)
  const total = neto + iva

  function alternar(id: string) {
    setSeleccion((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  }

  return (
    <form action={enviar}>
      <input type="hidden" name="ordenes" value={JSON.stringify(seleccion)} />
      <Tarjeta className="mb-4 max-w-3xl">
        <div className="flex flex-wrap items-end gap-3">
          <Campo etiqueta="Cliente *">
            <Selector
              name="cliente_id"
              required
              value={clienteId}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => { setClienteId(e.currentTarget.value); setSeleccion([]) }}
            >
              <option value="" disabled>Selecciona…</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>{c.razon_social}</option>
              ))}
            </Selector>
          </Campo>
          <Campo etiqueta="Notas">
            <Entrada name="notas" placeholder="Opcional" />
          </Campo>
        </div>
      </Tarjeta>

      <Tabla>
        <thead>
          <tr><Th /><Th>N° ODE</Th><Th>Fecha ingreso</Th><Th>Destino</Th><Th className="text-right">Bultos</Th><Th className="text-right">Kilos</Th><Th className="text-right">M3</Th><Th className="text-right">Kilo afecto</Th><Th className="text-right">Neto</Th></tr>
        </thead>
        <tbody>
          {disponibles.map((o) => (
            <Tr key={o.id}>
              <Td><input type="checkbox" checked={seleccion.includes(o.id)} onChange={() => alternar(o.id)} /></Td>
              <Td>{o.numero}</Td>
              <Td>{new Date(o.fecha_ingreso + 'T00:00:00').toLocaleDateString('es-CL')}</Td>
              <Td>{o.destino_nombre}</Td>
              <Td className="text-right">{o.bultos}</Td>
              <Td className="text-right">{NUM(o.kilos)}</Td>
              <Td className="text-right">{NUM(o.m3)}</Td>
              <Td className="text-right">{NUM(o.kilo_afecto)}</Td>
              <Td className="text-right font-mono">{formatearCLP(o.neto)}</Td>
            </Tr>
          ))}
          {disponibles.length === 0 && (
            <Tr><Td colSpan={9} className="py-6 text-center text-slate-500">{clienteId ? 'El cliente no tiene órdenes de entrega libres.' : 'Selecciona un cliente para ver sus órdenes libres.'}</Td></Tr>
          )}
        </tbody>
      </Tabla>

      <div className="mt-4 flex flex-col items-end gap-1 text-sm">
        <div>Bultos: <strong>{bultos}</strong></div>
        <div>M3: <strong>{NUM(m3)}</strong></div>
        <div>Kilo afecto: <strong>{NUM(totalKiloAfecto)}</strong></div>
        <div>Neto: <strong>{formatearCLP(neto)}</strong></div>
        <div>IVA (19%): <strong>{formatearCLP(iva)}</strong></div>
        <div className="text-lg">Total: <strong>{formatearCLP(total)}</strong></div>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2">
        {estado.error && <span className="mr-auto text-sm text-red-600">{estado.error}</span>}
        <Boton type="submit" disabled={pendiente || seleccion.length === 0}>{pendiente ? 'Guardando…' : 'Crear proforma'}</Boton>
      </div>
    </form>
  )
}
```

- [ ] **Step 4: Acciones por estado**

`apps/erp/componentes/acciones-proforma.tsx` (espejo estructural de `apps/erp/componentes/acciones-cotizacion.tsx`; en `facturada`, el botón "Deshacer estado de pago" aparece SOLO si el documento enlazado está `borrador` o `rechazado` — `docEstado` lo consulta la página del detalle):

```tsx
'use client'

import Link from 'next/link'
import { useActionState, useState } from 'react'
import { Boton, Entrada } from '@suite/ui'
import { anularEstadoPago, cambiarEstadoProforma, facturarProforma } from '../app/proformas/acciones'
import type { EstadoForm } from '../app/tipos'

function BotonEstado({
  proformaId,
  estado,
  etiqueta,
}: {
  proformaId: string
  estado: 'enviada' | 'aprobada'
  etiqueta: string
}) {
  const [resultado, enviar, pendiente] = useActionState(cambiarEstadoProforma, {} as EstadoForm)
  return (
    <form action={enviar} className="flex items-center gap-2">
      <input type="hidden" name="proforma_id" value={proformaId} />
      <input type="hidden" name="estado" value={estado} />
      <Boton type="submit" disabled={pendiente}>{pendiente ? '…' : etiqueta}</Boton>
      {resultado.error && <span className="text-xs text-red-600">{resultado.error}</span>}
    </form>
  )
}

function FormularioRechazo({ proformaId }: { proformaId: string }) {
  const [abierto, setAbierto] = useState(false)
  const [resultado, enviar, pendiente] = useActionState(cambiarEstadoProforma, {} as EstadoForm)
  if (!abierto) {
    return <Boton variante="peligro" type="button" onClick={() => setAbierto(true)}>Rechazar</Boton>
  }
  return (
    <form action={enviar} className="flex items-center gap-2">
      <input type="hidden" name="proforma_id" value={proformaId} />
      <input type="hidden" name="estado" value="rechazada" />
      <Entrada name="motivo" placeholder="Motivo del rechazo *" required className="w-56 text-xs" />
      <Boton variante="peligro" type="submit" disabled={pendiente} className="px-2 py-1 text-xs">{pendiente ? '…' : 'Confirmar rechazo'}</Boton>
      {resultado.error && <span className="text-xs text-red-600">{resultado.error}</span>}
    </form>
  )
}

function BotonFacturar({ proformaId }: { proformaId: string }) {
  const [resultado, enviar, pendiente] = useActionState(facturarProforma, {} as EstadoForm)
  return (
    <form action={enviar} className="flex items-center gap-2">
      <input type="hidden" name="proforma_id" value={proformaId} />
      <Boton type="submit" disabled={pendiente}>{pendiente ? 'Facturando…' : 'Facturar'}</Boton>
      {resultado.error && <span className="text-xs text-red-600">{resultado.error}</span>}
    </form>
  )
}

function BotonDeshacer({ proformaId, documentoId }: { proformaId: string; documentoId: string }) {
  const [resultado, enviar, pendiente] = useActionState(anularEstadoPago, {} as EstadoForm)
  return (
    <form action={enviar} className="flex items-center gap-2">
      <input type="hidden" name="documento_id" value={documentoId} />
      <input type="hidden" name="proforma_id" value={proformaId} />
      <Boton variante="peligro" type="submit" disabled={pendiente}>{pendiente ? '…' : 'Deshacer estado de pago'}</Boton>
      {resultado.error && <span className="text-xs text-red-600">{resultado.error}</span>}
    </form>
  )
}

export function AccionesProforma({
  proformaId,
  estado,
  documentoVentaId,
  docEstado,
}: {
  proformaId: string
  estado: string
  documentoVentaId: string | null
  docEstado: string | null
}) {
  if (estado === 'borrador') {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <BotonEstado proformaId={proformaId} estado="enviada" etiqueta="Enviar" />
        <FormularioRechazo proformaId={proformaId} />
      </div>
    )
  }
  if (estado === 'enviada') {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <BotonEstado proformaId={proformaId} estado="aprobada" etiqueta="Aprobar" />
        <FormularioRechazo proformaId={proformaId} />
      </div>
    )
  }
  if (estado === 'aprobada') {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <BotonFacturar proformaId={proformaId} />
        <FormularioRechazo proformaId={proformaId} />
      </div>
    )
  }
  if (estado === 'facturada' && documentoVentaId) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/ventas/${documentoVentaId}`}>
          <Boton variante="secundario" type="button">Ver documento de venta</Boton>
        </Link>
        {(docEstado === 'borrador' || docEstado === 'rechazado') && (
          <BotonDeshacer proformaId={proformaId} documentoId={documentoVentaId} />
        )}
      </div>
    )
  }
  return null
}
```

- [ ] **Step 5: Página de nueva proforma**

`apps/erp/app/proformas/nueva/page.tsx` (guard de módulo; solo ODEs `registrada` LIBRES — `proforma_id` null):

```tsx
import { notFound } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { Encabezado } from '@suite/ui'
import { FormularioProforma } from '../../../componentes/formulario-proforma'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { crearProforma } from '../acciones'

export default async function NuevaProforma() {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  if (!activa.modulo_transporte) notFound()
  const supabase = await crearClienteServidor()
  const [{ data: clientes }, { data: libres }] = await Promise.all([
    supabase.from('clientes').select('id, razon_social').eq('empresa_id', activa.id).eq('activo', true).order('razon_social'),
    supabase
      .from('ordenes_entrega')
      .select('id, cliente_id, numero, fecha_ingreso, bultos, kilos, m3, kilo_afecto, neto, destinos (nombre)')
      .eq('empresa_id', activa.id)
      .eq('estado', 'registrada')
      .is('proforma_id', null)
      .order('numero'),
  ])
  const ordenes = (libres ?? []).map((o) => ({
    id: o.id,
    cliente_id: o.cliente_id,
    numero: o.numero,
    fecha_ingreso: o.fecha_ingreso,
    destino_nombre: o.destinos?.nombre ?? '—',
    bultos: o.bultos,
    kilos: o.kilos,
    m3: o.m3,
    kilo_afecto: o.kilo_afecto,
    neto: o.neto,
  }))
  return (
    <div>
      <Encabezado titulo="Nueva proforma" />
      <FormularioProforma accion={crearProforma} clientes={clientes ?? []} ordenes={ordenes} />
    </div>
  )
}
```

- [ ] **Step 6: Página de lista**

`apps/erp/app/proformas/page.tsx` (espejo estructural de `apps/erp/app/cotizaciones/page.tsx`, sin filtros — la lista de proformas es corta por diseño; folio FAV vía embed del documento enlazado):

```tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP, formatearNumeroProforma } from '@suite/core'
import { Boton, Encabezado, Insignia, Tabla, Td, Th, Tr } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import { ETIQUETA_ESTADO, TONO_ESTADO } from './estados'

export default async function PaginaProformas() {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  if (!activa.modulo_transporte) notFound()
  const supabase = await crearClienteServidor()
  const { data: profs } = await supabase
    .from('proformas')
    .select('id, numero, fecha, total, estado, clientes (razon_social), documentos_venta (folio)')
    .eq('empresa_id', activa.id)
    .order('numero', { ascending: false })
    .limit(100)
  return (
    <div>
      <Encabezado titulo="Proformas">
        <Link href="/proformas/nueva"><Boton>Nueva proforma</Boton></Link>
      </Encabezado>
      <Tabla>
        <thead><tr><Th>N°</Th><Th>Cliente</Th><Th>Fecha</Th><Th className="text-right">Total</Th><Th>Estado</Th><Th>Folio FAV</Th></tr></thead>
        <tbody>
          {(profs ?? []).map((p) => (
            <Tr key={p.id}>
              <Td><Link className="text-marca-700 hover:underline" href={`/proformas/${p.id}`}>{formatearNumeroProforma(p.numero)}</Link></Td>
              <Td>{p.clientes?.razon_social ?? '—'}</Td>
              <Td>{new Date(p.fecha + 'T00:00:00').toLocaleDateString('es-CL')}</Td>
              <Td className="text-right font-mono">{formatearCLP(p.total)}</Td>
              <Td><Insignia tono={TONO_ESTADO[p.estado] ?? 'gris'}>{ETIQUETA_ESTADO[p.estado] ?? p.estado}</Insignia></Td>
              <Td>{p.estado === 'facturada' ? (p.documentos_venta?.folio ?? '— (sin folio)') : '—'}</Td>
            </Tr>
          ))}
          {(profs ?? []).length === 0 && <Tr><Td colSpan={6} className="py-8 text-center text-slate-500">No hay proformas todavía.</Td></Tr>}
        </tbody>
      </Tabla>
    </div>
  )
}
```

- [ ] **Step 7: Página de detalle con nómina, totales e impresión**

`apps/erp/app/proformas/[id]/page.tsx` (espejo estructural de `apps/erp/app/cotizaciones/[id]/page.tsx`; encabezado espejo de la pantalla real del usuario: PF-N°, cliente+RUT, fecha, estado y Nro./fecha FAV si está facturada; bultos/M3/kilo afecto DERIVADOS de las ODEs, neto/IVA/total ALMACENADOS; el layout ya es apto para impresión desde el Plan 9):

```tsx
import { notFound } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP, formatearNumeroProforma, formatearRut } from '@suite/core'
import { Encabezado, Insignia, Tabla, Tarjeta, Td, Th, Tr } from '@suite/ui'
import { AccionesProforma } from '../../../componentes/acciones-proforma'
import { BotonImprimir } from '../../../componentes/boton-imprimir'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { ETIQUETA_ESTADO, TONO_ESTADO } from '../estados'

const NUM = (n: number | null) => (n == null ? '—' : n.toLocaleString('es-CL', { maximumFractionDigits: 2 }))

export default async function DetalleProforma({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  if (!activa.modulo_transporte) notFound()
  const supabase = await crearClienteServidor()
  const { data: prof } = await supabase
    .from('proformas')
    .select('*, clientes (razon_social, rut), documentos_venta (folio, estado, emitido_en)')
    .eq('id', id).eq('empresa_id', activa.id).single()
  if (!prof) notFound()

  const rechazada = prof.estado === 'rechazada'
  // Una proforma rechazada ya liberó sus ODEs (pueden ser de otras proformas):
  // solo encabezado + motivo + totales ALMACENADOS, sin nómina ni Imprimir.
  const consultaOdes = rechazada
    ? null
    : await supabase
        .from('ordenes_entrega')
        .select('numero, fecha_ingreso, docum, oc_cliente, bultos, kilos, m3, kilo_afecto, neto, destinos (nombre)')
        .eq('empresa_id', activa.id).eq('proforma_id', id).order('numero')
  const odes = consultaOdes?.data ?? []
  const totBultos = odes.reduce((s, o) => s + o.bultos, 0)
  const totM3 = odes.reduce((s, o) => s + (o.m3 ?? 0), 0)
  const totKiloAfecto = odes.reduce((s, o) => s + o.kilo_afecto, 0)

  const fav = prof.documentos_venta
  const fecha = new Date(prof.fecha + 'T00:00:00').toLocaleDateString('es-CL')

  return (
    <div>
      <div className="print:hidden">
        <Encabezado titulo={`Proforma ${formatearNumeroProforma(prof.numero)}`}>
          <Insignia tono={TONO_ESTADO[prof.estado] ?? 'gris'}>{ETIQUETA_ESTADO[prof.estado] ?? prof.estado}</Insignia>
          {!rechazada && <BotonImprimir />}
        </Encabezado>
      </div>

      <div className="mb-4 hidden print:block">
        <h1 className="text-xl font-bold">{activa.razon_social}</h1>
        <p className="text-sm text-slate-600">{formatearRut(activa.rut)}</p>
        <h2 className="mt-2 text-lg font-semibold">PROFORMA — Documento no tributario</h2>
        <p className="text-sm">{formatearNumeroProforma(prof.numero)}</p>
      </div>

      <Tarjeta className="mb-4 max-w-3xl">
        <p><strong>Cliente:</strong> {prof.clientes?.razon_social} ({prof.clientes && formatearRut(prof.clientes.rut)})</p>
        <p className="mt-1 text-sm text-slate-600">Fecha: {fecha}</p>
        {prof.estado === 'facturada' && (
          <p className="mt-1 text-sm text-slate-600">
            Nro. FAV: {fav?.folio ?? '— (sin folio)'} · Fecha FAV: {fav?.emitido_en ? new Date(fav.emitido_en).toLocaleDateString('es-CL') : '—'}
          </p>
        )}
        {prof.notas && <p className="mt-1 text-sm text-slate-600">Notas: {prof.notas}</p>}
        {rechazada && prof.motivo_rechazo && (
          <p className="mt-2 text-sm text-red-700"><strong>Motivo de rechazo:</strong> {prof.motivo_rechazo}</p>
        )}
      </Tarjeta>

      {!rechazada && (
        <Tabla>
          <thead>
            <tr>
              <Th>N° ODE</Th><Th>Fecha ingreso</Th><Th>Destino</Th><Th>Docum</Th><Th>OC</Th>
              <Th className="text-right">Bultos</Th><Th className="text-right">Kilos</Th><Th className="text-right">M3</Th>
              <Th className="text-right">Kilo afecto</Th><Th className="text-right">Neto</Th>
            </tr>
          </thead>
          <tbody>
            {odes.map((o) => (
              <Tr key={o.numero}>
                <Td>{o.numero}</Td>
                <Td>{new Date(o.fecha_ingreso + 'T00:00:00').toLocaleDateString('es-CL')}</Td>
                <Td>{o.destinos?.nombre ?? '—'}</Td>
                <Td>{o.docum ?? '—'}</Td>
                <Td>{o.oc_cliente ?? '—'}</Td>
                <Td className="text-right">{o.bultos}</Td>
                <Td className="text-right">{NUM(o.kilos)}</Td>
                <Td className="text-right">{NUM(o.m3)}</Td>
                <Td className="text-right">{NUM(o.kilo_afecto)}</Td>
                <Td className="text-right font-mono">{formatearCLP(o.neto)}</Td>
              </Tr>
            ))}
          </tbody>
        </Tabla>
      )}

      <div className="mt-4 flex flex-col items-end gap-1 text-sm">
        {!rechazada && (
          <>
            <div>Bultos: <strong>{totBultos}</strong></div>
            <div>M3: <strong>{NUM(totM3)}</strong></div>
            <div>Kilo afecto: <strong>{NUM(totKiloAfecto)}</strong></div>
          </>
        )}
        <div>Neto: <strong>{formatearCLP(prof.neto)}</strong></div>
        <div>IVA (19%): <strong>{formatearCLP(prof.iva)}</strong></div>
        <div className="text-lg">Total: <strong>{formatearCLP(prof.total)}</strong></div>
      </div>

      <p className="mt-6 hidden text-sm text-slate-600 print:block">Documento no tributario: no constituye factura ni comprobante fiscal.</p>

      <div className="mt-6 flex flex-wrap items-center gap-3 print:hidden">
        <AccionesProforma
          proformaId={prof.id}
          estado={prof.estado}
          documentoVentaId={prof.documento_venta_id}
          docEstado={fav?.estado ?? null}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 8: Verificar build y commit**

Run (PowerShell, desde la raíz del repo):

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User'); pnpm --filter erp build
```

Salida esperada: compila sin errores y las rutas `/proformas`, `/proformas/nueva` y `/proformas/[id]` aparecen en el listado de rutas del output.

```bash
git add apps/erp/app/proformas apps/erp/componentes/formulario-proforma.tsx apps/erp/componentes/acciones-proforma.tsx
git commit -m "feat(erp): proformas — ciclo completo, facturación e impresión"
```

---
### Task 12: Pipeline + verificación integral (E2E)

**Files:** ninguno de producción (script en scratchpad, se borra).

- [ ] **Step 1: Pipeline**

Run: `pnpm --filter @suite/db gen` — commitear solo si diff (`chore(db): tipos regenerados`).
Run: `pnpm test` — **118 tests** (core 106 incl. transporte, auth 2, dte 10).
Run: `pnpm supabase test db` — **193 asserts** (los archivos existentes suman 134 + transporte `plan(59)`), todos verdes.
Run: `pnpm build --concurrency=1` — 3 apps.

- [ ] **Step 2: E2E integral (script Node en scratchpad)**

Patrón de siempre (createRequire sobre `packages/auth/package.json`; usuario real vía `admin.auth.admin.createUser` + `registrar_organizacion` como authenticated; RUT org `999999999` — NO fixtures ni demo `771234569`; cliente, destinos, flota y activación del módulo como authenticated — service_role no accede al schema `app`):

1. Org 1 (RUT `999999999`) + cliente activo (RUT `765000017`; DV a mano — cuerpo `76500001`, dígitos × peso de derecha a izquierda (2,3,4,5,6,7,2,3): 1×2 + 0×3 + 0×4 + 0×5 + 0×6 + 5×7 + 6×2 + 7×3 = 2+0+0+0+0+35+12+21 = 70; `11 - (70 mod 11)` = `11 - 4` = `7` → DV `7`, RUT módulo-11 válido, sin colisión con `765555558` de `cotizaciones.test.sql` ni con ningún otro RUT del repo). Activación como dueño (el grant por columnas de 0016 lo permite): `update empresas set modulo_transporte = true, factor_volumetrico = 250` → re-leer y assert `true`/`250`. Capturar `count(*)` de `bodegas` de la empresa (esperado 0: `registrar_organizacion` no crea ninguna) — es la línea base del assert de bodega fantasma.
2. Tarifario y flota (insert directo como dueño): destinos `Antofagasta` (`tarifa_kg` 120) y `Calama` (`tarifa_kg` 90) — 2 destinos, tarifas distintas; vehículo patente `BBCL23` (capacidad 12000); conductor RUT `123456785` nombre `Pedro Soto`.
3. 4 ODEs vía `crear_orden_entrega` (fecha_ingreso hoy; vehículo/conductor null — se asignan después):
   - ODE 1: Antofagasta, docum `G-1001, G-1002`, oc `OC-77`, bultos 5, kilos 175, m3 1.26, **neto NEGOCIADO 98836** — el sugerido sería `kiloAfecto × tarifa = 315 × 120 = 37800`; persistir un neto distinto prueba que el server NO recalcula el neto del llamador. (La regla UI de re-sugerencia — editar neto → cambiar destino → re-sugiere — es de `/entregas/nueva` y se cubre en el click-through de la demo.)
   - ODE 2: Calama, docum `G-2001`, bultos 10, kilos 787, m3 2.88, neto 75000 (sugerido 70830).
   - ODE 3: Antofagasta, SIN docum, solo-peso (m3 null), bultos 2, kilos 450, neto 54000 (= el sugerido 450 × 120).
   - ODE 4: Calama, solo-peso, bultos 1, kilos 100, neto 9000 (= el sugerido 100 × 90).
   Asserts: correlativos `numero` 1-4; `kilo_afecto` calculado server-side = **315 / 787 / 450 / 100**; estado `registrada`; `neto` de ODE 1 = 98836 (≠ 37800).
4. Proforma 1 = `crear_proforma(cliente, [ODE1, ODE2, ODE3])` → asserts: `numero` = 1 (display `PF-000001`), estado `borrador`, **totales dorados contra cálculo a mano: neto 227836 (98836+75000+54000), iva 43289 (= round(227836 × 0.19) sobre el neto TOTAL, no Σ de IVAs por línea), total 271125**; ODEs 1-3 con `proforma_id` seteado; ODE 4 libre.
5. `cambiar_estado_proforma` → `enviada` → `aprobada` (assert de estado en cada paso). La vista imprimible «PROFORMA — Documento no tributario» es UI: click-through de la demo.
6. `facturar_proforma` → retorna `docId1`: `documentos_venta` tipo `nota_venta` estado `borrador` folio null, mismo cliente y totales 227836/43289/271125; **3 líneas con `producto_id` NULL**, cantidad 1, `exenta` false, `precio_neto` = neto de su ODE, descripciones EXACTAS (`left(..., 80)`):
   - `ODE N° 1 Antofagasta — guías G-1001, G-1002`
   - `ODE N° 2 Calama — guías G-2001`
   - `ODE N° 3 Antofagasta`
   ODEs 1-3 `facturada` + `documento_venta_id = docId1`; proforma `facturada` + `documento_venta_id = docId1`. Doble `facturar_proforma` → error EXACTO `'Solo se puede facturar una proforma aprobada'`.
7. **Deshacer y re-facturar**: `anular_estado_pago(docId1)` (nota de venta en borrador sin folio) → asserts: documento y sus líneas eliminados (count 0); ODEs 1-3 de vuelta a `registrada` con `documento_venta_id` null y `proforma_id` CONSERVADO; proforma de vuelta a `aprobada` con `documento_venta_id` null. Re-facturar → `docId2` (id NUEVO) con las mismas 3 líneas y totales.
8. **Emisión sin bodega fantasma** (réplica admin del camino feliz POST-fix de `emitir.ts`, que un script Node no puede invocar): update `{ tipo: 'factura', folio: 1, estado: 'emitido', emitido_en: now }` sobre `docId2`; como TODAS las líneas tienen `producto_id` null, el array filtrado queda VACÍO → el código post-fix hace early-return y NO llama `registrar_movimientos_documento` (la réplica debe imitar exactamente eso). Asserts: 0 filas en `movimientos_stock` de la empresa y `bodegas` sigue en la línea base 0 — si la réplica llamara la RPC igual, esta crearía `'Bodega Principal'` y el assert lo delata.
9. **NC tampoco crea bodega**: insert admin de `documentos_venta` tipo `nota_credito` estado `emitido` folio 1 con `documento_referencia_id = docId2`, mismos totales, y líneas copiadas de la factura (`producto_id` null); réplica post-fix de la restitución (signo +1): array filtrado vacío → NO llamar la RPC. Asserts: `movimientos_stock` sigue en 0 y `bodegas` sigue en 0.
10. **Despacho sobre una ODE facturada**: `asignar_despacho(ODE 1, vehiculo, conductor)` → OK (facturada no es anulada; el despacho físico es independiente de la facturación) → assert `vehiculo_id`/`conductor_id` persistidos; `asignar_despacho(ODE 1, null, null)` → desasigna (vuelven a null).
11. **Rechazo desde aprobada**: proforma 2 = `crear_proforma(cliente, [ODE4])` → `enviada` → `aprobada` → `cambiar_estado_proforma` a `rechazada` con motivo `'  cliente desistió  '` → asserts: proforma `rechazada` con `motivo_rechazo = 'cliente desistió'` (trim); ODE 4 `registrada` con `proforma_id` NULL (liberada). Luego `anular_orden_entrega(ODE4, 'carga retirada por el cliente')` → estado `anulada` + `motivo_anulacion`; y `asignar_despacho` sobre la anulada → error EXACTO `'No se puede asignar despacho a una orden anulada'`.
12. **Aislamiento**: org 2 (RUT `888888888`, mismo patrón de registro) ve 0 filas en `vehiculos`/`conductores`/`destinos`/`ordenes_entrega`/`proformas`; sus RPCs contra la proforma 1 → `'La proforma no existe'` y contra la ODE 1 → `'La orden de entrega no existe'`.
13. **Módulo off**: dueño org 1: `update empresas set modulo_transporte = false` → `crear_orden_entrega` → error EXACTO `'El módulo de transporte no está activo'`; `crear_proforma` → mismo mensaje; pero `asignar_despacho` sobre la ODE 2 (facturada) SIGUE funcionando — apagar solo bloquea la creación. El ocultamiento del NAV es UI (click-through).
14. Cleanup FK-safe, cada delete seguido de `select count(*)` = **0** para las filas de ambas orgs: `documentos_venta_lineas` → `ordenes_entrega` → `proformas` → `documentos_venta` (la NC primero por la auto-referencia `documento_referencia_id`) → `vehiculos` → `conductores` → `destinos` → `clientes` → verificar `bodegas`/`productos`/`movimientos_stock` en 0 → `suscripciones` → `miembros` → `empresas` → `organizaciones` → `auth.users` (ambos usuarios) + borrar el script.

Si alguna aserción falla: defecto real → BLOCKED con detalle.

- [ ] **Step 3: Reporte**

`.superpowers/sdd/task-12-plan11-report.md` con todo; nota: click-through del usuario en la demo (re-sugerencia del neto al cambiar destino, botón «usar sugerido», Imprimir de la proforma, NAV que aparece/desaparece con el toggle).

Checklist adicional de verificación de los endurecimientos de Task 6 (Playwright o manual contra el dev server — el script Node de Step 2 NO invoca `emitirDocumento`, solo replica su resultado final; documentar el resultado de cada ítem en el reporte):
- (a) emitir dos veces seguidas el mismo borrador consume UN folio y no atasca.
- (b) emitir sin certificado/CAF configurado deja el documento en borrador (no en pendiente_envio) y el Deshacer sigue disponible.

---

## Verificación final del plan

- `pnpm test` (**118**) + `pnpm supabase test db` (**193**) + `pnpm build` (3 apps) verdes.
- Ciclo completo: módulo activado con factor propio → tarifario y flota cargados → ODE digitada con kilo afecto server-side y neto sugerido-pero-negociable → proforma `PF-000001` idéntica a la real (nómina completa, IVA sobre el neto TOTAL: 227836/43289/271125) → enviada → aprobada → facturada a nota de venta con líneas sin producto (`left(..., 80)`) → emisión sin bodega fantasma y NC igual → deshacer estado de pago revierte y se re-factura → el rechazo libera ODEs incluso aprobadas y la anulación exige motivo → despacho asignable a cualquier ODE no anulada → correlativos sin saltos, todo aislado por empresa y el módulo off bloquea la creación por API.
- Criterio de éxito del spec §10 cumplido.
