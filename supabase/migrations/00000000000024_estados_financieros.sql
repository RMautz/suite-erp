-- Estados financieros (Plan 17), capa 1 (Task 1): cierres_ejercicio (historia
-- del cierre anual; solo las RPCs la mueven), origen 'cierre' en asientos, la
-- 11a ancla 'utilidad_ejercicio' (contrapartida del asiento de cierre; seed +
-- backfill), el helper app._fecha_contable (documentos tardios caen al primer
-- dia del ejercicio abierto), el candado de periodo en app._insertar_asiento
-- (ningun asiento entra a un ejercicio cerrado, por NINGUNA via) y el candado
-- de cierre en revertir_asiento (el asiento de cierre solo se deshace con
-- reabrir_ejercicio: una reversa directa consumiria la unica reversa permitida
-- y dejaria el anio irrecuperable). Task 2 anexa cerrar_ejercicio,
-- reabrir_ejercicio y revision_periodo tras la marca final.
--
-- Sin escape hatch en el candado: el ORDEN de operaciones de las RPCs de Task 2
-- lo hace innecesario — cerrar_ejercicio crea su asiento ANTES de marcar la
-- fila 'cerrado'; reabrir_ejercicio marca 'reabierto' ANTES de crear la reversa.

-- ---------- cierres_ejercicio (un anio esta cerrado si su fila esta 'cerrado') ----------
-- 'reabierto' deja la fila como historia y el anio vuelve a estar abierto;
-- re-cerrar la vuelve a 'cerrado' con asiento_cierre_id nuevo (update en la RPC).
-- CERO escritura directa (sin grants de insert/update/delete a authenticated):
-- solo cerrar_ejercicio / reabrir_ejercicio la mueven, bajo el advisory lock.
create table public.cierres_ejercicio (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  anio integer not null check (anio between 2000 and 2100),
  estado text not null default 'cerrado' check (estado in ('cerrado', 'reabierto')),
  asiento_cierre_id uuid not null,          -- el asiento de cierre vigente o el ultimo si reabierto
  resultado integer not null,               -- utilidad (+) o perdida (-) calculada al cerrar, CLP enteros
  creado_por uuid not null,
  creado_en timestamptz not null default now(),
  reabierto_por uuid,
  reabierto_en timestamptz,
  unique (empresa_id, anio),
  unique (empresa_id, id),
  foreign key (empresa_id, asiento_cierre_id) references public.asientos (empresa_id, id)
);

alter table public.cierres_ejercicio enable row level security;
create policy "contables ven cierres" on public.cierres_ejercicio
  for select to authenticated
  using (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin', 'contador']));

-- Grants Data API (leccion Plan 1): solo select; service_role completo.
grant select on public.cierres_ejercicio to authenticated;
grant select, insert, update, delete on public.cierres_ejercicio to service_role;

-- ---------- asientos.origen: se suma 'cierre' ----------
-- El CHECK inline de 0022 (auto-nombrado asientos_origen_check) no admite ALTER
-- en su lugar: drop + re-add con la lista extendida (patron 0018/0022). El
-- asiento de cierre lleva referencia_id null: la anti-doble-ejecucion vive en
-- la fila de cierres_ejercicio bajo el advisory lock, no en el indice parcial.
alter table public.asientos drop constraint asientos_origen_check;
alter table public.asientos add constraint asientos_origen_check
  check (origen in
    ('manual', 'venta', 'nota_credito', 'compra', 'pago', 'pago_proveedor', 'anticipo', 'reversa', 'cierre'));

-- ---------- Backfill: 11a ancla en toda empresa que ya tenga catalogo ----------
-- Mismo insert idempotente por clave que la siembra: si la empresa tiene
-- catalogo (alguna clave_sistema) y aun no tiene 'utilidad_ejercicio', se la
-- agrega. Empresas sin catalogo la reciben al activar (re-create de abajo).
-- Codigo POR EMPRESA: el menor '3.1.0'||n libre con n >= 3 ('3.1.03' casi
-- siempre) — una empresa pudo crear su propia '3.1.03' via guardar_cuenta y el
-- unique (empresa_id, codigo) de 0022 abortaria la migracion. JAMAS
-- on conflict do nothing: dejaria empresas sin ancla y el cierre reventaria.
insert into public.cuentas_contables (empresa_id, codigo, nombre, tipo, acepta_movimientos, clave_sistema)
select e.id,
       (select '3.1.0' || n from generate_series(3, 99) as n
        where not exists (select 1 from public.cuentas_contables c2
                          where c2.empresa_id = e.id and c2.codigo = '3.1.0' || n)
        order by n limit 1),
       'Utilidad del ejercicio', 'patrimonio', true, 'utilidad_ejercicio'
from public.empresas e
where exists (select 1 from public.cuentas_contables c
              where c.empresa_id = e.id and c.clave_sistema is not null)
  and not exists (select 1 from public.cuentas_contables c
                  where c.empresa_id = e.id and c.clave_sistema = 'utilidad_ejercicio');

-- ---------- RE-CREATE activar_contabilidad (VERBATIM 0022 + 1 fila) ----------
-- Unico cambio: el catalogo suma la 11a ancla '3.1.03' Utilidad del ejercicio
-- (hoja de patrimonio, clave 'utilidad_ejercicio'): contrapartida del asiento
-- de cierre. El catalogo queda en 28 cuentas / 11 claves / 5 grupos.
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
      (p_empresa, '3.1.03', 'Utilidad del ejercicio',     'patrimonio', true,  'utilidad_ejercicio'),
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

-- ---------- app._fecha_contable (SIN grants: la llaman las RPCs) ----------
-- Fecha contable de un documento tardio: si el anio de p_fecha esta cerrado,
-- retorna el primer dia del primer ejercicio abierto tras la racha de anios
-- cerrados CONSECUTIVOS (2025 y 2026 cerrados -> 2027-01-01); si no, p_fecha
-- intacta. Los asientos manuales y reversas NO se clampean: el candado del
-- helper los rechaza y el usuario elige otra fecha.
create or replace function app._fecha_contable(p_empresa uuid, p_fecha date)
returns date
language plpgsql security definer
set search_path = public
as $$
declare
  v_anio integer := extract(year from p_fecha)::integer;
begin
  if not exists (select 1 from cierres_ejercicio
                 where empresa_id = p_empresa and anio = v_anio and estado = 'cerrado') then
    return p_fecha;
  end if;
  while exists (select 1 from cierres_ejercicio
                where empresa_id = p_empresa and anio = v_anio + 1 and estado = 'cerrado') loop
    v_anio := v_anio + 1;
  end loop;
  return make_date(v_anio + 1, 1, 1);
end $$;
revoke execute on function app._fecha_contable(uuid, date) from anon, public;

-- ---------- RE-CREATE app._insertar_asiento (VERBATIM 0022 + candado de periodo) ----------
-- Unico cambio: el candado al inicio del begin — ningun asiento puede caer en
-- un ejercicio cerrado, por NINGUNA via (TODA creacion pasa por este helper).
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
  -- Candado de periodo (P17): un ejercicio cerrado no recibe asientos.
  if exists (select 1 from cierres_ejercicio
             where empresa_id = p_empresa
               and anio = extract(year from p_fecha)::integer
               and estado = 'cerrado') then
    raise exception 'El ejercicio % está cerrado', extract(year from p_fecha)::integer;
  end if;

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

-- ---------- RE-CREATE revertir_asiento (VERBATIM 0022 + candado de cierre) ----------
-- Unico cambio: el asiento de cierre NO se revierte por aqui — la unica via es
-- reabrir_ejercicio. Una reversa directa naceria con current_date (anio abierto:
-- el candado de periodo no la frena), consumiria la unica reversa permitida
-- (asientos_reversa_idx) y reabrir_ejercicio reventaria para siempre con
-- unique_violation: el anio quedaria cerrado e irrecuperable. Los mensajes de
-- 0022 ('El asiento ya fue revertido', etc.) quedan INTACTOS.
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
  -- Candado de cierre (P17): el asiento de cierre solo se deshace reabriendo.
  if v_origen = 'cierre' then
    raise exception 'El cierre solo se deshace reabriendo el ejercicio';
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

-- ---------- RE-CREATE contabilizar_documento (VERBATIM 0022 + 1 linea) ----------
-- Unico cambio: la fecha calculada pasa por app._fecha_contable antes de crear
-- (documentos tardios caen al primer dia del ejercicio abierto; nada se
-- rechaza — el auditor lo deja como observacion, regla asientos_tardios).
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

-- ---------- RE-CREATE contabilizar_pendientes (VERBATIM 0022 + order by clampeado) ----------
-- Unico cambio: el orden del recorrido usa la fecha CONTABLE (clampeada) para
-- que el correlativo siga cronologico aunque haya documentos tardios.
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

-- ===== RPCs de cierre y revision (Task 2) =====

-- ================== Cierre de ejercicio y Contador Auditor (Task 2) ==================
-- security definer + set search_path = public. cerrar/reabrir toman PRIMERO el
-- advisory xact-lock del correlativo (patron 0022): tambien serializa la fila
-- de cierres_ejercicio (anti doble-cierre concurrente). revision_periodo es
-- solo lectura: no crea asientos, no toma el candado.

-- ---------- Cerrar ejercicio (dueno/admin/contador; asiento ANTES de la marca) ----------
-- Una linea inversa por cuenta de resultado con saldo del anio (excluyendo
-- cierres previos y sus reversas) la deja en 0; contrapartida unica a
-- 'utilidad_ejercicio' (haber si utilidad, debe si perdida). Sin cuentas de
-- resultado con saldo neto <> 0 -> noop (null, ni asiento ni fila — patron noop
-- P16). El "cierre en orden" usa el MISMO criterio del noop (saldo neto por
-- cuenta <> 0, no la mera existencia de lineas): un anio con solo movimientos
-- de balance, o cuyas lineas de resultado netean 0 por cuenta, cierra en noop
-- (sin fila) y no debe bloquear los cierres siguientes.
create or replace function public.cerrar_ejercicio(p_empresa uuid, p_anio integer)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_abierto integer;
  v_lineas jsonb;
  v_resultado bigint;
  v_utilidad uuid;
  v_asiento uuid;
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'contador']) then
    raise exception 'Tu rol no permite cerrar el ejercicio';
  end if;
  if not exists (select 1 from empresas where id = p_empresa and modulo_contabilidad) then
    raise exception 'La contabilidad no está activada';
  end if;
  if p_anio is null or p_anio >= extract(year from current_date)::integer then
    raise exception 'Solo se puede cerrar un ejercicio terminado';
  end if;

  -- Candado del correlativo PRIMERO (patron 0022).
  perform pg_advisory_xact_lock(hashtextextended('asientos:' || p_empresa::text, 42));

  if exists (select 1 from cierres_ejercicio
             where empresa_id = p_empresa and anio = p_anio and estado = 'cerrado') then
    raise exception 'El ejercicio % ya está cerrado', p_anio;
  end if;

  -- Cierre EN ORDEN: el anio mas antiguo abierto con algo que cerrar, primero.
  -- Criterio UNIFICADO con el noop y la regla 7 (Global Constraints): alguna
  -- cuenta de resultado con saldo neto <> 0 en el anio (mismo having que arma
  -- las lineas del cierre) — la mera existencia de lineas que netean 0 NO cuenta.
  select min(t.anio) into v_abierto
  from (
    select extract(year from a.fecha)::integer as anio
    from asientos_lineas l
    join asientos a on a.id = l.asiento_id and a.empresa_id = l.empresa_id
    join cuentas_contables c on c.id = l.cuenta_id and c.empresa_id = l.empresa_id
    where l.empresa_id = p_empresa
      and extract(year from a.fecha)::integer < p_anio
      and c.tipo in ('ingreso', 'gasto')
      and a.origen <> 'cierre'
      and not exists (
        select 1 from asientos x
        where x.empresa_id = p_empresa and x.id = a.reversa_de and x.origen = 'cierre')
    group by extract(year from a.fecha)::integer, l.cuenta_id
    having sum(l.debe - l.haber) <> 0
  ) t
  where not exists (
    select 1 from cierres_ejercicio ce
    where ce.empresa_id = p_empresa and ce.anio = t.anio and ce.estado = 'cerrado');
  if v_abierto is not null then
    raise exception 'Cierra primero el ejercicio %', v_abierto;
  end if;

  -- Saldos de resultado del anio (excluyendo cierres previos y sus reversas):
  -- linea inversa por cuenta; el neto (haber - debe) es el resultado.
  select coalesce(jsonb_agg(jsonb_build_object(
           'cuentaId', s.cuenta_id,
           'debe',  case when s.saldo < 0 then -s.saldo else 0 end,
           'haber', case when s.saldo > 0 then s.saldo else 0 end) order by s.codigo), '[]'::jsonb),
         coalesce(sum(-s.saldo), 0)
  into v_lineas, v_resultado
  from (
    select l.cuenta_id, c.codigo, sum(l.debe - l.haber)::bigint as saldo
    from asientos_lineas l
    join asientos a on a.id = l.asiento_id and a.empresa_id = l.empresa_id
    join cuentas_contables c on c.id = l.cuenta_id and c.empresa_id = l.empresa_id
    where l.empresa_id = p_empresa
      and extract(year from a.fecha)::integer = p_anio
      and c.tipo in ('ingreso', 'gasto')
      and a.origen <> 'cierre'
      and not exists (
        select 1 from asientos x
        where x.empresa_id = p_empresa and x.id = a.reversa_de and x.origen = 'cierre')
    group by l.cuenta_id, c.codigo
    having sum(l.debe - l.haber) <> 0
  ) s;

  -- Sin movimientos de resultado -> noop (ni asiento ni fila).
  if jsonb_array_length(v_lineas) = 0 then
    return null;
  end if;

  -- Contrapartida unica (si el resultado es exactamente 0, las lineas cuadran solas).
  if v_resultado <> 0 then
    select id into v_utilidad from cuentas_contables
    where empresa_id = p_empresa and clave_sistema = 'utilidad_ejercicio';
    v_lineas := v_lineas || jsonb_build_array(jsonb_build_object(
      'cuentaId', v_utilidad,
      'debe',  case when v_resultado < 0 then -v_resultado else 0 end,
      'haber', case when v_resultado > 0 then v_resultado else 0 end));
  end if;

  -- Asiento PRIMERO (la fila aun no esta 'cerrado': el candado del helper no
  -- bloquea); referencia_id null (la anti-doble-ejecucion es la fila + el lock).
  v_asiento := app._insertar_asiento(
    p_empresa, make_date(p_anio, 12, 31), 'Cierre del ejercicio ' || p_anio,
    'cierre', null, null, auth.uid(), v_lineas);

  -- LUEGO la marca: insert la primera vez; al re-cerrar tras reabrir, la fila
  -- vuelve a 'cerrado' con el asiento nuevo (update via on conflict).
  insert into cierres_ejercicio (empresa_id, anio, asiento_cierre_id, resultado, creado_por)
  values (p_empresa, p_anio, v_asiento, v_resultado::integer, auth.uid())
  on conflict (empresa_id, anio) do update
    set estado = 'cerrado', asiento_cierre_id = excluded.asiento_cierre_id,
        resultado = excluded.resultado, creado_por = excluded.creado_por,
        creado_en = now(), reabierto_por = null, reabierto_en = null;

  return v_asiento;
end $$;
revoke execute on function public.cerrar_ejercicio(uuid, integer) from anon, public;
grant execute on function public.cerrar_ejercicio(uuid, integer) to authenticated;

-- ---------- Reabrir ejercicio (dueno/admin/contador; marca ANTES de la reversa) ----------
-- Solo el ultimo cierre vigente se reabre (sin cierre posterior 'cerrado').
-- La reversa liga reversa_de = asiento_cierre_id con la MISMA fecha 31-dic (no
-- contamina el ejercicio siguiente). La unicidad una-reversa-por-asiento (0022)
-- se respeta: cada re-cierre crea asiento nuevo, cada reapertura revierte el vigente.
create or replace function public.reabrir_ejercicio(p_empresa uuid, p_anio integer)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_cierre record;
  v_posterior integer;
  v_lineas jsonb;
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'contador']) then
    raise exception 'Tu rol no permite reabrir el ejercicio';
  end if;

  -- Candado del correlativo PRIMERO (patron 0022).
  perform pg_advisory_xact_lock(hashtextextended('asientos:' || p_empresa::text, 42));

  select * into v_cierre from cierres_ejercicio
  where empresa_id = p_empresa and anio = p_anio and estado = 'cerrado'
  for update;
  if not found then
    raise exception 'El ejercicio % no está cerrado', p_anio;
  end if;

  select max(anio) into v_posterior from cierres_ejercicio
  where empresa_id = p_empresa and anio > p_anio and estado = 'cerrado';
  if v_posterior is not null then
    raise exception 'Reabre primero el ejercicio %', v_posterior;
  end if;

  -- Marca PRIMERO (el candado del helper deja de bloquear el anio), LUEGO la reversa.
  update cierres_ejercicio
  set estado = 'reabierto', reabierto_por = auth.uid(), reabierto_en = now()
  where id = v_cierre.id and empresa_id = p_empresa;

  -- Lineas inversas del asiento de cierre vigente (debe <-> haber, patron revertir_asiento).
  select jsonb_agg(jsonb_build_object('cuentaId', cuenta_id, 'debe', haber, 'haber', debe, 'glosa', glosa))
  into v_lineas
  from asientos_lineas
  where empresa_id = p_empresa and asiento_id = v_cierre.asiento_cierre_id;

  return app._insertar_asiento(
    p_empresa, make_date(p_anio, 12, 31), 'Reapertura del ejercicio ' || p_anio,
    'reversa', null, v_cierre.asiento_cierre_id, auth.uid(), v_lineas);
end $$;
revoke execute on function public.reabrir_ejercicio(uuid, integer) from anon, public;
grant execute on function public.reabrir_ejercicio(uuid, integer) to authenticated;

-- ---------- Revision del periodo (Contador Auditor: 7 reglas deterministas) ----------
-- Solo lectura; jsonb {periodo, estado, observaciones}. severidad critica >
-- media > ok; estado = la peor presente (sin observaciones -> 'ok'). Los
-- montos van crudos en el detalle (CLP enteros, sin separador de miles: los
-- goldens pgTAP comparan byte a byte; la UI puede reformatear).
create or replace function public.revision_periodo(p_empresa uuid, p_anio integer, p_mes integer)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_desde date;
  v_hasta date;             -- exclusivo (primer dia del mes siguiente)
  v_obs jsonb := '[]'::jsonb;
  v_n bigint;
  v_libro bigint;
  v_cuenta bigint;
  v_actual bigint;
  v_meses integer;
  v_prom numeric;
  v_doc record;
  v_ant record;
  v_tar record;
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'contador']) then
    raise exception 'Tu rol no permite ver la revisión';
  end if;
  -- Periodo valido (tras el rol): sin esto, make_date reventaria con un error
  -- crudo de Postgres ante p_mes fuera de 1-12.
  if p_anio is null or p_mes is null or p_mes not between 1 and 12 then
    raise exception 'Período no válido';
  end if;

  v_desde := make_date(p_anio, p_mes, 1);
  v_hasta := (v_desde + interval '1 month')::date;

  -- Regla 1: documentos_sin_contabilizar (CRITICA). Mismo criterio de
  -- pendientes de contabilizar_pendientes (0022), acotado al periodo.
  select count(*) into v_n from (
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
  where t.fecha >= v_desde and t.fecha < v_hasta
    and not exists (
      select 1 from asientos x
      where x.empresa_id = p_empresa and x.origen = t.origen and x.referencia_id = t.referencia_id);
  if v_n > 0 then
    v_obs := v_obs || jsonb_build_array(jsonb_build_object(
      'regla', 'documentos_sin_contabilizar', 'severidad', 'critica',
      'titulo', 'Documentos sin contabilizar',
      'detalle', v_n || case when v_n = 1
        then ' documento del período sin asiento contable'
        else ' documentos del período sin asiento contable' end,
      'enlace_tipo', null, 'enlace_id', null));
  end if;

  -- Regla 2: iva_descuadrado (CRITICA). IVA debito del libro de ventas del mes
  -- (0011: NC con signo negativo) vs movimientos del mes en la cuenta ancla.
  select coalesce(sum(iva), 0) into v_libro
  from libro_ventas
  where empresa_id = p_empresa and fecha >= v_desde and fecha < v_hasta;
  select coalesce(sum(l.haber - l.debe), 0) into v_cuenta
  from asientos_lineas l
  join asientos a on a.id = l.asiento_id and a.empresa_id = l.empresa_id
  join cuentas_contables c on c.id = l.cuenta_id and c.empresa_id = l.empresa_id
  where l.empresa_id = p_empresa and c.clave_sistema = 'iva_debito'
    and a.fecha >= v_desde and a.fecha < v_hasta;
  if v_libro <> v_cuenta then
    v_obs := v_obs || jsonb_build_array(jsonb_build_object(
      'regla', 'iva_descuadrado', 'severidad', 'critica',
      'titulo', 'IVA débito descuadrado',
      'detalle', 'IVA débito del libro de ventas: $' || v_libro
        || ' · movimientos de la cuenta: $' || v_cuenta
        || ' · diferencia: $' || (v_libro - v_cuenta),
      'enlace_tipo', null, 'enlace_id', null));
  end if;

  -- Regla 3: facturas_vencidas_sin_gestion (MEDIA). Con saldo, vencidas hace
  -- mas de 30 dias y sin recordatorio (0020) en los ultimos 30 dias.
  for v_doc in
    select s.documento_id, s.folio, s.saldo, s.fecha_vencimiento
    from saldos_documentos s
    where s.empresa_id = p_empresa and s.tipo = 'factura' and s.saldo > 0
      and s.fecha_vencimiento < current_date - 30
      and not exists (
        select 1 from correos_enviados ce
        where ce.empresa_id = p_empresa and ce.tipo = 'recordatorio'
          and ce.referencia_id = s.documento_id
          and ce.creado_en > now() - interval '30 days')
    order by s.fecha_vencimiento, s.documento_id
  loop
    v_obs := v_obs || jsonb_build_array(jsonb_build_object(
      'regla', 'facturas_vencidas_sin_gestion', 'severidad', 'media',
      'titulo', 'Factura vencida sin gestión',
      'detalle', 'Factura N° ' || v_doc.folio || ' vencida el ' || v_doc.fecha_vencimiento
        || ' con saldo $' || v_doc.saldo || ' y sin recordatorio en los últimos 30 días',
      'enlace_tipo', 'documento_venta', 'enlace_id', v_doc.documento_id));
  end loop;

  -- Regla 4: anomalia_vs_promedio (MEDIA). Banda 60%-140% del promedio de los
  -- hasta 6 meses anteriores CON datos; minimo 2 meses para opinar (filosofia
  -- del semaforo del dashboard). Ventas por libro_ventas; gastos por compras activas.
  select coalesce(sum(total), 0) into v_actual
  from libro_ventas
  where empresa_id = p_empresa and fecha >= v_desde and fecha < v_hasta;
  select count(*), avg(m.monto) into v_meses, v_prom
  from (
    select date_trunc('month', fecha)::date as mes, sum(total) as monto
    from libro_ventas
    where empresa_id = p_empresa
      and fecha >= (v_desde - interval '6 months')::date and fecha < v_desde
    group by 1
  ) m;
  if v_meses >= 2 and (v_actual < 0.6 * v_prom or v_actual > 1.4 * v_prom) then
    v_obs := v_obs || jsonb_build_array(jsonb_build_object(
      'regla', 'anomalia_vs_promedio', 'severidad', 'media',
      'titulo', 'Ventas fuera de lo normal',
      'detalle', 'Ventas del mes: $' || v_actual || ' · promedio de los últimos '
        || v_meses || ' meses: $' || round(v_prom)::bigint || ' · banda normal: 60%-140%',
      'enlace_tipo', null, 'enlace_id', null));
  end if;
  select coalesce(sum(total), 0) into v_actual
  from documentos_compra
  where empresa_id = p_empresa and estado = 'activa'
    and fecha_emision >= v_desde and fecha_emision < v_hasta;
  select count(*), avg(m.monto) into v_meses, v_prom
  from (
    select date_trunc('month', fecha_emision)::date as mes, sum(total) as monto
    from documentos_compra
    where empresa_id = p_empresa and estado = 'activa'
      and fecha_emision >= (v_desde - interval '6 months')::date and fecha_emision < v_desde
    group by 1
  ) m;
  if v_meses >= 2 and (v_actual < 0.6 * v_prom or v_actual > 1.4 * v_prom) then
    v_obs := v_obs || jsonb_build_array(jsonb_build_object(
      'regla', 'anomalia_vs_promedio', 'severidad', 'media',
      'titulo', 'Gastos fuera de lo normal',
      'detalle', 'Gastos del mes: $' || v_actual || ' · promedio de los últimos '
        || v_meses || ' meses: $' || round(v_prom)::bigint || ' · banda normal: 60%-140%',
      'enlace_tipo', null, 'enlace_id', null));
  end if;

  -- Regla 5: anticipos_sin_aplicar (MEDIA). Recibidos hace mas de 60 dias.
  for v_ant in
    select a.id, a.monto, a.recibido_en::date as recibido
    from anticipos a
    where a.empresa_id = p_empresa and a.estado = 'recibido'
      and a.recibido_en < now() - interval '60 days'
    order by a.recibido_en, a.id
  loop
    v_obs := v_obs || jsonb_build_array(jsonb_build_object(
      'regla', 'anticipos_sin_aplicar', 'severidad', 'media',
      'titulo', 'Anticipo sin aplicar',
      'detalle', 'Anticipo de $' || v_ant.monto || ' recibido el ' || v_ant.recibido
        || ' sigue sin aplicarse (más de 60 días)',
      'enlace_tipo', 'anticipo', 'enlace_id', v_ant.id));
  end loop;

  -- Regla 6: asientos_tardios (MEDIA). Asientos automaticos del periodo cuya
  -- fecha difiere de la del documento origen (el clamping de app._fecha_contable
  -- o cualquier descalce): join por origen/referencia_id, misma expresion de
  -- fecha por origen que contabilizar_documento.
  for v_tar in
    select a.id, a.numero, a.fecha, d.fecha_doc
    from asientos a
    cross join lateral (
      select case a.origen
        when 'venta'          then (select coalesce(v.emitido_en, v.creado_en)::date from documentos_venta v  where v.id = a.referencia_id and v.empresa_id = a.empresa_id)
        when 'nota_credito'   then (select coalesce(v.emitido_en, v.creado_en)::date from documentos_venta v  where v.id = a.referencia_id and v.empresa_id = a.empresa_id)
        when 'compra'         then (select c.fecha_emision                          from documentos_compra c where c.id = a.referencia_id and c.empresa_id = a.empresa_id)
        when 'pago'           then (select p.fecha                                  from pagos p             where p.id = a.referencia_id and p.empresa_id = a.empresa_id)
        when 'pago_proveedor' then (select pp.fecha                                 from pagos_proveedor pp  where pp.id = a.referencia_id and pp.empresa_id = a.empresa_id)
        when 'anticipo'       then (select an.recibido_en::date                     from anticipos an        where an.id = a.referencia_id and an.empresa_id = a.empresa_id)
      end as fecha_doc
    ) d
    where a.empresa_id = p_empresa
      and a.fecha >= v_desde and a.fecha < v_hasta
      and a.referencia_id is not null
      and a.origen in ('venta', 'nota_credito', 'compra', 'pago', 'pago_proveedor', 'anticipo')
      and d.fecha_doc is not null and d.fecha_doc <> a.fecha
    order by a.numero
  loop
    v_obs := v_obs || jsonb_build_array(jsonb_build_object(
      'regla', 'asientos_tardios', 'severidad', 'media',
      'titulo', 'Asiento con fecha distinta al documento',
      'detalle', 'Asiento N° ' || v_tar.numero || ' con fecha ' || v_tar.fecha
        || ' registra un documento del ' || v_tar.fecha_doc,
      'enlace_tipo', 'asiento', 'enlace_id', v_tar.id));
  end loop;

  -- Regla 7: ejercicio_anterior_abierto (MEDIA, CTA al cierre asistido).
  -- Criterio UNIFICADO con el noop y el candado de orden de cerrar_ejercicio
  -- (Global Constraints): alguna cuenta de resultado con saldo neto <> 0 en el
  -- anio anterior (un anio sin nada que cerrar no genera observacion).
  if exists (
       select 1
       from asientos_lineas l
       join asientos a on a.id = l.asiento_id and a.empresa_id = l.empresa_id
       join cuentas_contables c on c.id = l.cuenta_id and c.empresa_id = l.empresa_id
       where l.empresa_id = p_empresa
         and extract(year from a.fecha)::integer = p_anio - 1
         and c.tipo in ('ingreso', 'gasto')
         and a.origen <> 'cierre'
         and not exists (
           select 1 from asientos x
           where x.empresa_id = p_empresa and x.id = a.reversa_de and x.origen = 'cierre')
       group by l.cuenta_id
       having sum(l.debe - l.haber) <> 0)
     and not exists (
       select 1 from cierres_ejercicio ce
       where ce.empresa_id = p_empresa and ce.anio = p_anio - 1 and ce.estado = 'cerrado') then
    v_obs := v_obs || jsonb_build_array(jsonb_build_object(
      'regla', 'ejercicio_anterior_abierto', 'severidad', 'media',
      'titulo', 'Ejercicio anterior sin cerrar',
      'detalle', 'El ejercicio ' || (p_anio - 1) || ' tiene movimientos de resultado y aún no está cerrado',
      'enlace_tipo', 'cierre', 'enlace_id', null));
  end if;

  return jsonb_build_object(
    'periodo', jsonb_build_object('anio', p_anio, 'mes', p_mes),
    'estado', case
      when v_obs @> '[{"severidad": "critica"}]'::jsonb then 'critica'
      when v_obs @> '[{"severidad": "media"}]'::jsonb then 'media'
      else 'ok' end,
    'observaciones', v_obs);
end $$;
revoke execute on function public.revision_periodo(uuid, integer, integer) from anon, public;
grant execute on function public.revision_periodo(uuid, integer, integer) to authenticated;
