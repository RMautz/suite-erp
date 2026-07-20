-- Finiquitos y vacaciones (Plan 20), Task 1: DDL + capa contable. trabajadores
-- gana nombres/apellido_paterno/apellido_materno (backfill UNICO con la
-- heuristica de separarNombre; nombre se CONSERVA como display), contratos
-- gana isapre (catalogo de 7 slugs; null = contrato antiguo o fonasa), nacen
-- vacaciones_tomadas (RLS por rol; INSERT + DELETE directo dueno/admin, sin
-- UPDATE -- precedente gastos_vehiculo 0017) y finiquitos (INMUTABLE:
-- snapshot completo, CERO escritura directa -- solo las RPCs de Task 2 la
-- mueven). Capa contable: origen 'finiquito' + 2 anclas ('5.1.07'
-- Indemnizaciones / '2.1.08' Finiquitos por pagar -> catalogo 33/18/5) y
-- re-creates de activar_contabilidad, contabilizar_documento (asiento de 2
-- lineas por el total), contabilizar_pendientes y revision_periodo (reglas 1
-- y 6). Task 2 anexa emitir/pagar/anular_finiquito tras la marca del final.

-- ---------- trabajadores: nombres y apellidos separados (Previred campos 3-5) ----------
-- nombre se CONSERVA como columna de display (todo el resto del sistema la
-- sigue leyendo sin cambios); la nueva convencion de escritura la compone la
-- Server Action desde los 3 campos (helper nombreCompleto de core, task de
-- UI). Backfill UNICO con la heuristica de separarNombre de core (paridad
-- byte a byte): ultimas 2 palabras = apellidos; 2 palabras = 1 nombre + 1
-- paterno; 1 palabra (borde teorico) = nombres y paterno '' (cadena vacia:
-- satisface el not null, igual que el paterno '' de core).
alter table public.trabajadores
  add column nombres text,
  add column apellido_paterno text,
  add column apellido_materno text;

update public.trabajadores t
set nombres = case when array_length(p.partes, 1) >= 3
                   then array_to_string(p.partes[1:array_length(p.partes, 1) - 2], ' ')
                   else p.partes[1] end,
    apellido_paterno = case when array_length(p.partes, 1) >= 3 then p.partes[array_length(p.partes, 1) - 1]
                            when array_length(p.partes, 1) = 2 then p.partes[2]
                            else '' end,
    apellido_materno = case when array_length(p.partes, 1) >= 3 then p.partes[array_length(p.partes, 1)]
                            else null end
from (select id, regexp_split_to_array(trim(nombre), '\s+') as partes from public.trabajadores) p
where p.id = t.id;

-- Tras el backfill quedan obligatorios (los formularios capturan los 3 campos
-- y la action compone nombre; apellido_materno sigue opcional).
alter table public.trabajadores
  alter column nombres set not null,
  alter column apellido_paterno set not null;

-- ---------- contratos.isapre (catalogo ISAPRES de core; codigo Previred) ----------
-- null = contrato isapre ANTIGUO sin institucion declarada (-> Previred
-- codigo 0, limite declarado del spec SS2.2) o contrato fonasa. Con null el
-- CHECK pasa (logica SQL de tres valores); la action exige isapre para
-- contratos nuevos con salud = 'isapre' (fail-closed en la app).
alter table public.contratos
  add column isapre text
    check (isapre in ('cruzblanca', 'banmedica', 'colmena', 'consalud', 'vidatres', 'nuevamasvida', 'esencial'));

-- ---------- vacaciones_tomadas (registro manual de dias tomados) ----------
-- Los trabajadores NO son usuarios: registra dueno/admin. Sin maquina de
-- estados ni efectos derivados: corregir = eliminar y re-crear (DELETE
-- directo, precedente gastos_vehiculo 0017; sin UPDATE). Sin validacion de
-- solape (v1: el saldo igual resta -- limite declarado del spec SS2.3).
create table public.vacaciones_tomadas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  trabajador_id uuid not null,
  desde date not null,
  hasta date not null,
  dias_habiles integer not null check (dias_habiles > 0),
  comentario text,
  creado_en timestamptz not null default now(),
  check (hasta >= desde),
  foreign key (empresa_id, trabajador_id) references public.trabajadores (empresa_id, id)
);
create index vacaciones_tomadas_trabajador_idx
  on public.vacaciones_tomadas (empresa_id, trabajador_id, desde desc);

-- ---------- finiquitos (INMUTABLE; snapshot completo, spec SS2.5) ----------
-- Estados: emitido -> pagado; emitido o pagado -> anulado (con motivo; anular
-- reactiva contrato y trabajador -- RPCs de Task 2). El snapshot de calculo +
-- contexto hace que el finiquito se explique solo aunque cambien el contrato
-- o los indicadores. CERO escritura directa: solo emitir/pagar/anular_finiquito.
create table public.finiquitos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  trabajador_id uuid not null,
  contrato_id uuid not null,
  causal text not null check (causal in ('renuncia', 'mutuo_acuerdo', 'necesidades_empresa', 'vencimiento_plazo', 'conducta_grave')),
  fecha_termino date not null,
  aviso_dado boolean not null default false,
  estado text not null default 'emitido' check (estado in ('emitido', 'pagado', 'anulado')),
  -- Inputs del cliente (lo UNICO que la RPC no recalcula).
  otros_haberes integer not null default 0 check (otros_haberes >= 0),
  otros_descuentos integer not null default 0 check (otros_descuentos >= 0),
  comentario text,
  -- Snapshot del calculo (CLP enteros; reglas 1-6 del spec SS3).
  sueldo_base integer not null,
  anos_servicio integer not null,
  indemnizacion_anos integer not null,
  indemnizacion_aviso integer not null,
  feriado_dias numeric(6, 2) not null,
  feriado_monto integer not null,
  total integer not null,
  -- Snapshot de contexto (auditabilidad: UF del periodo de termino).
  uf integer not null,
  emitido_en timestamptz,
  pagado_en timestamptz,
  anulado_en timestamptz,
  motivo_anulacion text,
  creado_en timestamptz not null default now(),
  unique (empresa_id, id),
  foreign key (empresa_id, trabajador_id) references public.trabajadores (empresa_id, id),
  foreign key (empresa_id, contrato_id) references public.contratos (empresa_id, id)
);
-- Un finiquito NO-anulado por contrato: anular libera el contrato y se puede
-- volver a emitir (patron liquidaciones_periodo_idx 0025).
create unique index finiquitos_contrato_idx
  on public.finiquitos (empresa_id, contrato_id) where estado <> 'anulado';

-- ---------- RLS ----------
alter table public.vacaciones_tomadas enable row level security;
alter table public.finiquitos enable row level security;

-- vacaciones: datos RRHH sensibles -> SELECT por rol (patron trabajadores
-- 0025, NO el mis_empresas de gastos_vehiculo); escribe dueno/admin. La
-- policy de delete filtra por FILA: un rol sin permiso "borra" 0 filas SIN
-- error -- la app verifica el conteo con .select('id') (leccion 0017).
create policy "contables ven vacaciones" on public.vacaciones_tomadas
  for select to authenticated
  using (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin', 'contador']));
create policy "duenos registran vacaciones" on public.vacaciones_tomadas
  for insert to authenticated
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']));
create policy "duenos eliminan vacaciones" on public.vacaciones_tomadas
  for delete to authenticated
  using (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']));

-- finiquitos: SELECT por rol; CERO escritura directa (ni policy ni grant).
create policy "contables ven finiquitos" on public.finiquitos
  for select to authenticated
  using (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin', 'contador']));

-- ---------- Grants Data API (leccion Plan 1: sin esto todo da 42501) ----------
-- vacaciones SIN update (inmutable: corregir = eliminar y re-crear);
-- finiquitos solo select (solo las RPCs de Task 2 escriben).
grant select, insert, delete on public.vacaciones_tomadas to authenticated;
grant select on public.finiquitos to authenticated;
grant select, insert, update, delete on public.vacaciones_tomadas, public.finiquitos to service_role;

-- ---------- asientos.origen: se suma 'finiquito' ----------
-- drop + re-add (un CHECK no admite ALTER en su lugar; patron 0018/0022/0024/0025).
-- Lista vigente = la de 0025 (con 'remuneracion') + 'finiquito'.
alter table public.asientos drop constraint asientos_origen_check;
alter table public.asientos add constraint asientos_origen_check
  check (origen in
    ('manual', 'venta', 'nota_credito', 'compra', 'pago', 'pago_proveedor', 'anticipo', 'reversa', 'cierre', 'remuneracion', 'finiquito'));

-- ---------- Backfill: las 2 anclas nuevas en empresas ya activas ----------
-- Ninguna tiene fila pristina del seed que reclamar ('Indemnizaciones' /
-- 'Finiquitos por pagar' jamas existieron en catalogos previos): solo insert
-- codigo-libre por empresa (patron 0026; JAMAS on conflict do nothing --
-- dejaria empresas sin ancla y contabilizar reventaria).
insert into public.cuentas_contables (empresa_id, codigo, nombre, tipo, acepta_movimientos, clave_sistema)
select e.id,
       (select '5.1.0' || n from generate_series(6, 99) as n
        where not exists (select 1 from public.cuentas_contables c2
                          where c2.empresa_id = e.id and c2.codigo = '5.1.0' || n)
        order by n limit 1),
       'Indemnizaciones', 'gasto', true, 'gasto_indemnizaciones'
from public.empresas e
where exists (select 1 from public.cuentas_contables c
              where c.empresa_id = e.id and c.clave_sistema is not null)
  and not exists (select 1 from public.cuentas_contables c
                  where c.empresa_id = e.id and c.clave_sistema = 'gasto_indemnizaciones');

insert into public.cuentas_contables (empresa_id, codigo, nombre, tipo, acepta_movimientos, clave_sistema)
select e.id,
       (select '2.1.0' || n from generate_series(6, 99) as n
        where not exists (select 1 from public.cuentas_contables c2
                          where c2.empresa_id = e.id and c2.codigo = '2.1.0' || n)
        order by n limit 1),
       'Finiquitos por pagar', 'pasivo', true, 'finiquitos_por_pagar'
from public.empresas e
where exists (select 1 from public.cuentas_contables c
              where c.empresa_id = e.id and c.clave_sistema is not null)
  and not exists (select 1 from public.cuentas_contables c
                  where c.empresa_id = e.id and c.clave_sistema = 'finiquitos_por_pagar');

-- ---------- RE-CREATE activar_contabilidad (VERBATIM 0026 + 2 anclas) ----------
-- Cambios contra 0026: filas nuevas '2.1.08' Finiquitos por pagar
-- (finiquitos_por_pagar) y '5.1.07' Indemnizaciones (gasto_indemnizaciones).
-- El catalogo queda en 33 cuentas / 18 claves / 5 grupos.
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
      (p_empresa, '2.1.07', 'Leyes sociales por pagar',   'pasivo',     true,  'leyes_sociales_por_pagar'),
      (p_empresa, '2.1.08', 'Finiquitos por pagar',       'pasivo',     true,  'finiquitos_por_pagar'),
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
      (p_empresa, '5.1.05', 'Gastos generales',           'gasto',      true,  null),
      (p_empresa, '5.1.06', 'Leyes sociales',             'gasto',      true,  'gasto_leyes_sociales'),
      (p_empresa, '5.1.07', 'Indemnizaciones',            'gasto',      true,  'gasto_indemnizaciones');
  end if;

  update empresas set modulo_contabilidad = true where id = p_empresa;
end $$;
revoke execute on function public.activar_contabilidad(uuid) from anon, public;
grant execute on function public.activar_contabilidad(uuid) to authenticated;

-- ---------- RE-CREATE contabilizar_documento (VERBATIM 0026 + rama 'finiquito') ----------
-- Cambios contra 0026: v_fin en el declare y la rama nueva. Regla: asiento de
-- 2 lineas por el TOTAL neto -- debe Indemnizaciones(total) / haber
-- Finiquitos por pagar(total). Total 0 -> el filtro deja 0 lineas y el noop
-- compartido lo absorbe; anulado -> not found -> noop. Fecha = fecha_termino;
-- el clamp de app._fecha_contable (linea compartida) la respeta contra
-- ejercicios cerrados.
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
  v_fin record;
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
    select periodo, trabajador_id, total_imponible, no_imponibles, total_descuentos, liquido, total_aportes
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
    -- Debe Gasto remuneraciones(imponible + no imponibles) + Gasto leyes
    -- sociales(total_aportes) / Haber Remuneraciones por pagar(liquido) +
    -- Retenciones por pagar(descuentos) + Leyes sociales por pagar(aportes).
    -- Con total_aportes = 0 (pre-P19) el filtro omite las lineas 2 y 5.
    select coalesce(jsonb_agg(jsonb_build_object('cuentaId', cuenta, 'debe', debe, 'haber', haber) order by ord), '[]'::jsonb)
    into v_lineas
    from (
                    select 1 as ord, (select id from cuentas_contables where empresa_id = p_empresa and clave_sistema = 'gasto_remuneraciones')     as cuenta, (v_liq.total_imponible + v_liq.no_imponibles) as debe, 0 as haber
      union all select 2,          (select id from cuentas_contables where empresa_id = p_empresa and clave_sistema = 'gasto_leyes_sociales'),      v_liq.total_aportes, 0
      union all select 3,          (select id from cuentas_contables where empresa_id = p_empresa and clave_sistema = 'remuneraciones_por_pagar'),            0, v_liq.liquido
      union all select 4,          (select id from cuentas_contables where empresa_id = p_empresa and clave_sistema = 'retenciones_por_pagar'),               0, v_liq.total_descuentos
      union all select 5,          (select id from cuentas_contables where empresa_id = p_empresa and clave_sistema = 'leyes_sociales_por_pagar'),            0, v_liq.total_aportes
    ) s where debe > 0 or haber > 0;

  elsif p_origen = 'finiquito' then
    -- Finiquito emitido o pagado; anulado -> not found -> noop.
    select fecha_termino, trabajador_id, total
    into v_fin
    from finiquitos
    where id = p_referencia and empresa_id = p_empresa and estado in ('emitido', 'pagado')
    for update;
    if not found then return 'noop'; end if;
    -- Fecha = fecha de termino (el clamp compartido la pasa despues por
    -- app._fecha_contable).
    v_fecha := v_fin.fecha_termino;
    v_glosa := 'Finiquito ' ||
      (select nombre from trabajadores where id = v_fin.trabajador_id and empresa_id = p_empresa);
    -- Debe Indemnizaciones(total) / Haber Finiquitos por pagar(total): 2
    -- lineas por el TOTAL neto (spec SS4). Con total = 0 el filtro deja 0
    -- lineas y el noop compartido lo absorbe.
    select coalesce(jsonb_agg(jsonb_build_object('cuentaId', cuenta, 'debe', debe, 'haber', haber) order by ord), '[]'::jsonb)
    into v_lineas
    from (
                    select 1 as ord, (select id from cuentas_contables where empresa_id = p_empresa and clave_sistema = 'gasto_indemnizaciones') as cuenta, v_fin.total as debe, 0 as haber
      union all select 2,          (select id from cuentas_contables where empresa_id = p_empresa and clave_sistema = 'finiquitos_por_pagar'),             0, v_fin.total
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

-- ---------- RE-CREATE contabilizar_pendientes (VERBATIM 0025 + 1 rama) ----------
-- La 0026 NO la re-creo (cuerpo vigente = 0025). Unico cambio: el union all
-- de finiquitos emitidos/pagados sin asiento (fecha = fecha_termino, la misma
-- de la rama de contabilizar_documento; el order by clampeado queda intacto).
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
      union all select 'finiquito', f.id, f.fecha_termino
      from finiquitos f
      where f.empresa_id = p_empresa and f.estado in ('emitido', 'pagado')
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

-- ---------- RE-CREATE revision_periodo (VERBATIM 0026 + 'finiquito' en reglas 1 y 6) ----------
-- Cambios contra 0026: la subconsulta de la regla 1 suma los finiquitos
-- emitidos/pagados sin asiento (fecha = fecha_termino, la MISMA de
-- contabilizar_documento) y la regla 6 gana la rama 'finiquito' en el case y
-- en el filtro de origenes. Reglas 2-5 y 7, estado final, revoke y grant:
-- byte a byte desde 0026.
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
    union all select 'remuneracion', l.id, (to_date(l.periodo || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date
    from liquidaciones l
    where l.empresa_id = p_empresa and l.estado in ('emitida', 'pagada')
    union all select 'finiquito', f.id, f.fecha_termino
    from finiquitos f
    where f.empresa_id = p_empresa and f.estado in ('emitido', 'pagado')
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
  -- fecha por origen que contabilizar_documento (P19: 'remuneracion' = ultimo
  -- dia del mes del periodo; P20: 'finiquito' = fecha_termino).
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
        when 'remuneracion'   then (select (to_date(l.periodo || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date
                                    from liquidaciones l   where l.id = a.referencia_id and l.empresa_id = a.empresa_id)
        when 'finiquito'      then (select f.fecha_termino                          from finiquitos f        where f.id = a.referencia_id and f.empresa_id = a.empresa_id)
      end as fecha_doc
    ) d
    where a.empresa_id = p_empresa
      and a.fecha >= v_desde and a.fecha < v_hasta
      and a.referencia_id is not null
      and a.origen in ('venta', 'nota_credito', 'compra', 'pago', 'pago_proveedor', 'anticipo', 'remuneracion', 'finiquito')
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

-- ===== RPCs de finiquitos (Task 2) =====
-- ================== Finiquitos: RPCs (Task 2) ==================
-- security definer + set search_path = public. emitir NO crea asientos y
-- anular NO revierte asientos (hooks nunca-lanza de la Server Action, patron
-- P18) => ninguna toma el advisory lock del correlativo. La carrera de doble
-- emision la cierra el unique parcial de finiquitos (backstop 23505 ->
-- mensaje contractual); la de reactivacion, contratos_vigente_idx.

-- ---------- Emitir finiquito (calculo AUTORITATIVO, spec SS3) ----------
-- Orden de validacion (spec SS3.7 + guard de los lentes): rol -> contrato
-- vigente -> indicadores -> duplicado -> termino anterior al primer contrato.
-- p_fecha_termino null => periodo null => 0 filas de indicadores =>
-- mismo mensaje (fail-closed). Una causal fuera del catalogo la rechaza el
-- CHECK de la tabla (backstop; el select de la UI no la produce).
-- La formula de vacaciones VIVE aqui (spec SS2.4): primer contrato via
-- min(fecha_inicio) sobre TODOS los contratos del trabajador (continuidad
-- laboral) y suma de vacaciones_tomadas. El feriado usa el sueldo_base VIGENTE
-- SIN tope 90 UF; las indemnizaciones usan la base topada.
create or replace function public.emitir_finiquito(
  p_empresa uuid, p_trabajador uuid, p_causal text, p_fecha_termino date,
  p_aviso_dado boolean, p_otros_haberes integer, p_otros_descuentos integer,
  p_comentario text
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_con record;
  v_ind record;
  v_periodo text;
  v_aviso boolean := coalesce(p_aviso_dado, false);
  v_haberes integer := coalesce(p_otros_haberes, 0);
  v_descuentos integer := coalesce(p_otros_descuentos, 0);
  v_comentario text := nullif(trim(coalesce(p_comentario, '')), '');
  v_inicio date;
  v_edad interval;
  v_anos integer;
  v_base integer;
  v_indem_anos integer;
  v_indem_aviso integer;
  v_meses integer;
  v_devengados numeric(6, 2);
  v_tomados numeric;
  v_feriado_dias numeric(6, 2);
  v_feriado_monto integer;
  v_total integer;
  v_id uuid;
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'contador']) then
    raise exception 'Tu rol no permite emitir finiquitos';
  end if;

  -- Contrato vigente (a lo mas uno: contratos_vigente_idx). Mensaje P18.
  select * into v_con
  from contratos
  where empresa_id = p_empresa and trabajador_id = p_trabajador and vigente;
  if not found then
    raise exception 'El trabajador no tiene contrato vigente';
  end if;

  -- Indicadores del periodo de TERMINO (la UF del tope 90 UF sale de aqui).
  v_periodo := to_char(p_fecha_termino, 'YYYY-MM');
  select * into v_ind from indicadores_previsionales where periodo = v_periodo;
  if not found then
    raise exception 'No hay indicadores previsionales para el período';
  end if;

  -- Chequeo amable ANTES de calcular; el unique parcial es el backstop atomico.
  if exists (
    select 1 from finiquitos
    where empresa_id = p_empresa and contrato_id = v_con.id and estado <> 'anulado'
  ) then
    raise exception 'Ya existe un finiquito para este contrato';
  end if;

  -- SS3.1: anos de servicio desde el PRIMER contrato (continuidad laboral);
  -- fraccion > 6 meses (m > 6, o m = 6 con dias sobrantes) suma 1; tope 11.
  select min(fecha_inicio) into v_inicio
  from contratos
  where empresa_id = p_empresa and trabajador_id = p_trabajador;
  -- Guard de fechas (lentes): un termino anterior al primer contrato daria
  -- age() negativo -> anos negativos en el snapshot o aviso pagado sin devengo.
  if p_fecha_termino < v_inicio then
    raise exception 'La fecha de término no puede ser anterior al inicio del primer contrato';
  end if;
  v_edad := age(p_fecha_termino, v_inicio);
  v_anos := extract(year from v_edad)::integer;
  if extract(month from v_edad)::integer > 6
     or (extract(month from v_edad)::integer = 6 and extract(day from v_edad)::integer > 0) then
    v_anos := v_anos + 1;
  end if;
  v_anos := least(v_anos, 11);

  -- SS3.2: base topada en 90 UF del periodo de termino.
  v_base := least(v_con.sueldo_base, round(90 * v_ind.uf)::integer);

  -- SS3.3-3.4: indemnizaciones solo por necesidades de la empresa; el aviso
  -- omitido agrega un mes de la base topada.
  if p_causal = 'necesidades_empresa' then
    v_indem_anos := v_base * v_anos;
    v_indem_aviso := case when v_aviso then 0 else v_base end;
  else
    v_indem_anos := 0;
    v_indem_aviso := 0;
  end if;

  -- SS2.4 + SS3.5: feriado proporcional. meses COMPLETOS (los dias sobrantes
  -- no cuentan) x 1.25, menos los dias tomados; nunca negativo. El monto usa
  -- el sueldo_base VIGENTE sin tope (simplificacion v1 declarada en el spec:
  -- sin conversion habiles->corridos ni cotizaciones sobre el feriado).
  v_meses := extract(year from v_edad)::integer * 12 + extract(month from v_edad)::integer;
  v_devengados := round(v_meses * 1.25, 2);
  select coalesce(sum(dias_habiles), 0) into v_tomados
  from vacaciones_tomadas
  where empresa_id = p_empresa and trabajador_id = p_trabajador;
  v_feriado_dias := greatest(v_devengados - v_tomados, 0);
  v_feriado_monto := round(v_con.sueldo_base::numeric * v_feriado_dias / 30)::integer;

  -- SS3.6: total + guard fail-closed.
  v_total := v_indem_anos + v_indem_aviso + v_feriado_monto + v_haberes - v_descuentos;
  if v_total < 0 then
    raise exception 'El total del finiquito no puede ser negativo: revisa los descuentos';
  end if;

  -- SS3.7: efectos atomicos + snapshot completo. Un raise posterior (backstop
  -- 23505) revierte tambien estos updates: la RPC es una sola sentencia.
  update contratos set vigente = false
  where empresa_id = p_empresa and id = v_con.id;
  update trabajadores set activo = false
  where empresa_id = p_empresa and id = p_trabajador;

  begin
    insert into finiquitos (
      empresa_id, trabajador_id, contrato_id, causal, fecha_termino, aviso_dado,
      estado, otros_haberes, otros_descuentos, comentario,
      sueldo_base, anos_servicio, indemnizacion_anos, indemnizacion_aviso,
      feriado_dias, feriado_monto, total, uf, emitido_en)
    values (
      p_empresa, p_trabajador, v_con.id, p_causal, p_fecha_termino, v_aviso,
      'emitido', v_haberes, v_descuentos, v_comentario,
      v_con.sueldo_base, v_anos, v_indem_anos, v_indem_aviso,
      v_feriado_dias, v_feriado_monto, v_total, v_ind.uf, now())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Ya existe un finiquito para este contrato';
  end;
  return v_id;
end $$;
revoke execute on function public.emitir_finiquito(uuid, uuid, text, date, boolean, integer, integer, text) from anon, public;
grant execute on function public.emitir_finiquito(uuid, uuid, text, date, boolean, integer, integer, text) to authenticated;

-- ---------- Pagar finiquito (mismos roles; emitido -> pagado) ----------
-- El update re-evalua el estado bajo el row lock: dos pagos concurrentes dejan
-- al segundo con 0 filas -> mensaje contractual (patron 0025).
create or replace function public.pagar_finiquito(p_empresa uuid, p_finiquito uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'contador']) then
    raise exception 'Tu rol no permite emitir finiquitos';
  end if;
  update finiquitos
  set estado = 'pagado', pagado_en = now()
  where id = p_finiquito and empresa_id = p_empresa and estado = 'emitido';
  if not found then
    raise exception 'Solo se puede pagar un finiquito emitido';
  end if;
end $$;
revoke execute on function public.pagar_finiquito(uuid, uuid) from anon, public;
grant execute on function public.pagar_finiquito(uuid, uuid) to authenticated;

-- ---------- Anular finiquito (emitido O pagado -> anulado; REACTIVA) ----------
-- Reactiva contrato (vigente = true) y trabajador (activo = true) validando
-- ANTES que el puesto siga libre; contratos_vigente_idx es el backstop atomico
-- de la carrera contrato-nuevo-vs-anulacion (23505). La reversa contable NO va
-- aqui (hook nunca-lanza, patron 0025). Tras anular, el unique parcial libera
-- el contrato y se puede volver a emitir.
create or replace function public.anular_finiquito(
  p_empresa uuid, p_finiquito uuid, p_motivo text
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_motivo text;
  v_fin record;
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'contador']) then
    raise exception 'Tu rol no permite emitir finiquitos';
  end if;
  v_motivo := nullif(trim(coalesce(p_motivo, '')), '');
  if v_motivo is null then
    raise exception 'Indica el motivo de la anulación';
  end if;
  -- Row lock: dos anulaciones concurrentes dejan a la segunda leyendo
  -- 'anulado' bajo el lock -> mensaje contractual.
  select * into v_fin
  from finiquitos
  where id = p_finiquito and empresa_id = p_empresa
  for update;
  if not found or v_fin.estado not in ('emitido', 'pagado') then
    raise exception 'Solo se puede anular un finiquito emitido o pagado';
  end if;
  if exists (
    select 1 from contratos
    where empresa_id = p_empresa and trabajador_id = v_fin.trabajador_id
      and vigente and id <> v_fin.contrato_id
  ) then
    raise exception 'El trabajador ya tiene otro contrato vigente';
  end if;
  update finiquitos
  set estado = 'anulado', anulado_en = now(), motivo_anulacion = v_motivo
  where id = p_finiquito and empresa_id = p_empresa;
  update contratos set vigente = true
  where empresa_id = p_empresa and id = v_fin.contrato_id;
  update trabajadores set activo = true
  where empresa_id = p_empresa and id = v_fin.trabajador_id;
end $$;
revoke execute on function public.anular_finiquito(uuid, uuid, text) from anon, public;
grant execute on function public.anular_finiquito(uuid, uuid, text) to authenticated;
