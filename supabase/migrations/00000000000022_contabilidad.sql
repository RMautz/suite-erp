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
