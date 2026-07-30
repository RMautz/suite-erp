-- Cobranza: pagos multi-documento y cuentas por cobrar con saldos derivados.

-- ---------- Pagos (cabecera; baja logica, nunca delete) ----------
create table public.pagos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  cliente_id uuid not null,
  fecha date not null default current_date,
  metodo text not null check (metodo in ('efectivo', 'transferencia', 'tarjeta', 'cheque', 'otro')),
  monto integer not null check (monto > 0),
  referencia text,
  notas text,
  estado text not null default 'activo' check (estado in ('activo', 'anulado')),
  motivo_anulacion text,
  creado_en timestamptz not null default now(),
  unique (empresa_id, id),
  foreign key (empresa_id, cliente_id) references public.clientes (empresa_id, id)
);
create index pagos_cliente_idx on public.pagos (empresa_id, cliente_id);

-- ---------- Aplicaciones (detalle: un pago se reparte entre documentos) ----------
create table public.pagos_aplicaciones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  pago_id uuid not null,
  documento_id uuid not null,
  monto integer not null check (monto > 0),
  unique (empresa_id, id),
  foreign key (empresa_id, pago_id) references public.pagos (empresa_id, id),
  foreign key (empresa_id, documento_id) references public.documentos_venta (empresa_id, id)
);
create index pagos_aplicaciones_doc_idx on public.pagos_aplicaciones (empresa_id, documento_id);

-- ---------- Vista de saldos (security_invoker: RLS del consultante) ----------
-- saldo = total - pagos activos aplicados - NC emitidas que referencian el documento.
-- fecha_vencimiento derivada del condicion_pago_dias ACTUAL del cliente (tolerancia v1:
-- cambiar la condicion recalcula vencimientos historicos).
create view public.saldos_documentos with (security_invoker = true) as
select
  d.empresa_id,
  d.id as documento_id,
  d.tipo,
  d.folio,
  d.cliente_id,
  c.razon_social as cliente_razon_social,
  d.total,
  d.emitido_en,
  (coalesce(d.emitido_en, d.creado_en)::date + c.condicion_pago_dias) as fecha_vencimiento,
  coalesce(p.pagado, 0)::integer as pagado,
  coalesce(n.notas_credito, 0)::integer as notas_credito,
  (d.total - coalesce(p.pagado, 0) - coalesce(n.notas_credito, 0))::integer as saldo
from public.documentos_venta d
join public.clientes c on c.id = d.cliente_id and c.empresa_id = d.empresa_id
left join lateral (
  select sum(a.monto) as pagado
  from public.pagos_aplicaciones a
  join public.pagos pg on pg.id = a.pago_id and pg.empresa_id = a.empresa_id
  where a.documento_id = d.id and a.empresa_id = d.empresa_id and pg.estado = 'activo'
) p on true
left join lateral (
  select sum(nc.total) as notas_credito
  from public.documentos_venta nc
  where nc.documento_referencia_id = d.id and nc.empresa_id = d.empresa_id
    and nc.tipo = 'nota_credito' and nc.estado = 'emitido'
) n on true
where d.estado = 'emitido' and d.tipo in ('factura', 'boleta');

-- ---------- RLS ----------
alter table public.pagos enable row level security;
alter table public.pagos_aplicaciones enable row level security;

create policy "miembros ven pagos" on public.pagos
  for select to authenticated using (empresa_id in (select app.mis_empresas()));
create policy "miembros ven aplicaciones" on public.pagos_aplicaciones
  for select to authenticated using (empresa_id in (select app.mis_empresas()));

-- ---------- Grants Data API (leccion Plan 1) ----------
-- Sin insert/update para authenticated: TODA escritura va por RPC (incluida la anulacion).
grant select on public.pagos, public.pagos_aplicaciones, public.saldos_documentos to authenticated;
grant select, insert, update, delete on public.pagos, public.pagos_aplicaciones to service_role;
grant select on public.saldos_documentos to service_role;

-- ---------- Registrar pago (atomico; for update serializa contra el mismo documento) ----------
create or replace function public.registrar_pago(
  p_empresa uuid, p_cliente uuid, p_fecha date, p_metodo text, p_monto integer,
  p_referencia text, p_notas text, p_aplicaciones jsonb
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_pago uuid;
  v_app jsonb;
  v_doc record;
  v_monto_app integer;
  v_suma integer := 0;
  v_saldo integer;
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'vendedor']) then
    raise exception 'Tu rol no permite registrar pagos';
  end if;
  if p_metodo is null or p_metodo not in ('efectivo', 'transferencia', 'tarjeta', 'cheque', 'otro') then
    raise exception 'Método de pago no válido';
  end if;
  if p_monto is null or p_monto <= 0 then
    raise exception 'El monto del pago debe ser mayor a 0';
  end if;
  if not exists (select 1 from clientes where id = p_cliente and empresa_id = p_empresa) then
    raise exception 'Cliente no encontrado en la empresa';
  end if;
  if p_aplicaciones is null or jsonb_array_length(p_aplicaciones) = 0 then
    raise exception 'El pago debe aplicarse a al menos un documento';
  end if;

  insert into pagos (empresa_id, cliente_id, fecha, metodo, monto, referencia, notas)
  values (p_empresa, p_cliente, coalesce(p_fecha, current_date), p_metodo, p_monto,
          nullif(trim(coalesce(p_referencia, '')), ''), nullif(trim(coalesce(p_notas, '')), ''))
  returning id into v_pago;

  for v_app in select * from jsonb_array_elements(p_aplicaciones) loop
    -- Lock del documento: dos pagos concurrentes al mismo documento se serializan aqui
    -- y el saldo se calcula DENTRO del lock (sin TOCTOU).
    select d.id, d.total into v_doc
    from documentos_venta d
    where d.id = (v_app->>'documentoId')::uuid and d.empresa_id = p_empresa
      and d.cliente_id = p_cliente and d.estado = 'emitido' and d.tipo in ('factura', 'boleta')
    for update;
    if not found then
      raise exception 'Documento no cobrable o no pertenece al cliente';
    end if;
    v_monto_app := (v_app->>'monto')::integer;
    if v_monto_app is null or v_monto_app <= 0 then
      raise exception 'El monto aplicado debe ser mayor a 0';
    end if;

    select (v_doc.total
      - coalesce((select sum(a.monto) from pagos_aplicaciones a
                  join pagos pg on pg.id = a.pago_id and pg.empresa_id = a.empresa_id
                  where a.documento_id = v_doc.id and a.empresa_id = p_empresa and pg.estado = 'activo'), 0)
      - coalesce((select sum(nc.total) from documentos_venta nc
                  where nc.documento_referencia_id = v_doc.id and nc.empresa_id = p_empresa
                    and nc.tipo = 'nota_credito' and nc.estado = 'emitido'), 0)
    ) into v_saldo;
    if v_monto_app > v_saldo then
      raise exception 'El monto aplicado supera el saldo del documento (saldo: $%)', v_saldo;
    end if;

    insert into pagos_aplicaciones (empresa_id, pago_id, documento_id, monto)
    values (p_empresa, v_pago, v_doc.id, v_monto_app);
    v_suma := v_suma + v_monto_app;
  end loop;

  if v_suma <> p_monto then
    raise exception 'La suma de las aplicaciones debe ser igual al monto del pago';
  end if;

  return v_pago;
end $$;
revoke execute on function public.registrar_pago(uuid, uuid, date, text, integer, text, text, jsonb) from anon, public;
grant execute on function public.registrar_pago(uuid, uuid, date, text, integer, text, text, jsonb) to authenticated;

-- ---------- Anular pago (baja logica con motivo; las aplicaciones quedan como historico) ----------
create or replace function public.anular_pago(p_empresa uuid, p_pago uuid, p_motivo text)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin']) then
    raise exception 'Tu rol no permite anular pagos';
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'La anulación requiere un motivo';
  end if;
  update pagos set estado = 'anulado', motivo_anulacion = trim(p_motivo)
  where id = p_pago and empresa_id = p_empresa and estado = 'activo';
  if not found then
    raise exception 'El pago no existe o ya está anulado';
  end if;
end $$;
revoke execute on function public.anular_pago(uuid, uuid, text) from anon, public;
grant execute on function public.anular_pago(uuid, uuid, text) to authenticated;
