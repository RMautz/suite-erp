-- Combustible y gastos por vehiculo (Plan 12): cargas de combustible (import
-- TCT de Copec y carga manual), gastos manuales por vehiculo y vista de
-- rentabilidad mensual (ingresos de ODEs facturadas - combustible - gastos).
-- PRIMER delete directo del schema: cargas y gastos no tienen maquina de
-- estados ni efectos derivados (corregir = borrar y re-crear), asi que
-- dueno/admin borran directo. SIN update: ni policy ni grant (candado).

-- ---------- Cargas de combustible (fila del reporte TCT o carga manual) ----------
create table public.cargas_combustible (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  vehiculo_id uuid not null,
  -- Cruce del RUT chofer del import contra conductores DE LA EMPRESA.
  conductor_id uuid,
  fecha date not null,
  -- Primer uso de time en el schema: PostgREST lo sirve como string 'HH:MM:SS'.
  -- Distingue dos cargas del mismo camion el mismo dia; null en las manuales.
  hora time,
  litros numeric(9,2) not null check (litros > 0),
  -- Informativo: monto es LA fuente de verdad. NO se valida monto = litros x
  -- precio (Copec redondea distinto: 349,13 x 1123 = 392.073 <> 392.076 real).
  precio_litro integer check (precio_litro > 0),
  monto integer not null check (monto > 0),
  estacion text,
  comuna text,
  -- Guia de despacho Copec: la clave de dedup del import (null en manuales).
  guia text,
  -- Minimizacion (Ley 21.719): se persiste SOLO cuando NO hubo match en
  -- conductores (con conductor_id, el RUT ya vive alla); se elimina con la carga.
  rut_chofer text,
  tarjeta text,
  -- CRUDO: el reporte real trae basura (casi siempre 1); sin check a proposito.
  odometro integer,
  producto text not null default 'Diésel',
  origen text not null check (origen in ('tct', 'manual')),
  creado_en timestamptz not null default now(),
  foreign key (empresa_id, vehiculo_id) references public.vehiculos (empresa_id, id),
  foreign key (empresa_id, conductor_id) references public.conductores (empresa_id, id)
);
-- Dedup del import: guia unica POR EMPRESA. Parcial: las cargas manuales van
-- sin guia y no chocan entre si (re-digitar duplica; se corrige eliminando).
create unique index cargas_combustible_guia_idx on public.cargas_combustible (empresa_id, guia) where guia is not null;
create index cargas_combustible_vehiculo_idx on public.cargas_combustible (empresa_id, vehiculo_id, fecha desc);
create index cargas_combustible_fecha_idx on public.cargas_combustible (empresa_id, fecha desc);

-- ---------- Gastos por vehiculo (manuales) ----------
create table public.gastos_vehiculo (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  vehiculo_id uuid not null,
  fecha date not null,
  categoria text not null check (categoria in ('peaje', 'mantencion', 'neumaticos', 'seguro', 'permiso', 'otro')),
  monto integer not null check (monto > 0),
  notas text,
  creado_en timestamptz not null default now(),
  foreign key (empresa_id, vehiculo_id) references public.vehiculos (empresa_id, id)
);
create index gastos_vehiculo_vehiculo_idx on public.gastos_vehiculo (empresa_id, vehiculo_id, fecha desc);

-- ---------- RLS ----------
alter table public.cargas_combustible enable row level security;
alter table public.gastos_vehiculo enable row level security;

-- Costos = dinero: escribe dueno/admin; el vendedor solo mira (espejo de los
-- maestros 0008/0016). PRIMER delete directo del schema: sin maquina de
-- estados ni efectos derivados, la correccion es eliminar y re-crear; la
-- policy de delete filtra por FILA, asi que un rol sin permiso "borra" 0
-- filas SIN error — por eso la app verifica el conteo con .select('id').
create policy "miembros ven cargas de combustible" on public.cargas_combustible
  for select to authenticated using (empresa_id in (select app.mis_empresas()));
create policy "duenos crean cargas de combustible" on public.cargas_combustible
  for insert to authenticated
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']));
create policy "duenos eliminan cargas de combustible" on public.cargas_combustible
  for delete to authenticated
  using (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']));

create policy "miembros ven gastos de vehiculo" on public.gastos_vehiculo
  for select to authenticated using (empresa_id in (select app.mis_empresas()));
create policy "duenos crean gastos de vehiculo" on public.gastos_vehiculo
  for insert to authenticated
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']));
create policy "duenos eliminan gastos de vehiculo" on public.gastos_vehiculo
  for delete to authenticated
  using (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']));

-- ---------- Grants Data API (leccion Plan 1) ----------
-- SIN update para authenticated (ni grant ni policy): cargas y gastos son
-- inmutables; corregir = eliminar y re-crear (Task 2 fija el candado en pgTAP).
grant select, insert, delete on public.cargas_combustible, public.gastos_vehiculo to authenticated;
grant select, insert, update, delete on public.cargas_combustible, public.gastos_vehiculo to service_role;

-- ---------- Vista rentabilidad_vehiculo (security_invoker) ----------
-- Fila por (empresa_id, vehiculo_id, mes) con vehiculo_id NULLABLE: las ODEs
-- facturadas sin vehiculo caen en la fila "Sin asignar" de la UI. Ingresos =
-- neto de ODEs FACTURADAS por mes de fecha_ingreso (devengo operacional;
-- deshacer un estado de pago las saca solo: derivacion, no copia). SIN cast
-- ::integer en las sumas: quedan en el tipo ancho natural de sum() (PostgREST
-- serializa numero igual) — sin el overflow latente de las vistas del Plan 7.
-- Cada sub-agregado agrupa por empresa_id: la fila "Sin asignar" jamas mezcla
-- empresas. Margen y % los calcula la pagina.
create view public.rentabilidad_vehiculo with (security_invoker = true) as
select empresa_id, vehiculo_id, mes,
       sum(ingresos) as ingresos,
       sum(combustible) as combustible,
       sum(gastos) as gastos
from (
  select o.empresa_id, o.vehiculo_id,
         date_trunc('month', o.fecha_ingreso)::date as mes,
         sum(o.neto) as ingresos, 0 as combustible, 0 as gastos
  from public.ordenes_entrega o
  where o.estado = 'facturada'
  group by o.empresa_id, o.vehiculo_id, mes
  union all
  select c.empresa_id, c.vehiculo_id,
         date_trunc('month', c.fecha)::date as mes,
         0, sum(c.monto), 0
  from public.cargas_combustible c
  group by c.empresa_id, c.vehiculo_id, mes
  union all
  select g.empresa_id, g.vehiculo_id,
         date_trunc('month', g.fecha)::date as mes,
         0, 0, sum(g.monto)
  from public.gastos_vehiculo g
  group by g.empresa_id, g.vehiculo_id, mes
) partes
group by empresa_id, vehiculo_id, mes;

-- Grant EXPLICITO tambien para la vista (leccion 42501 del Plan 7: una vista
-- sin grant da permission denied aunque el invoker vea las tablas base); el
-- pgTAP POSITIVO de Task 2 lo fija para siempre.
grant select on public.rentabilidad_vehiculo to authenticated, service_role;
