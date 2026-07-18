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
