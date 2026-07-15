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
