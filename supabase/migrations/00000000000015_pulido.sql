-- Plan 9b: pulido. (A) Categorías únicas sin distinguir mayúsculas:
-- 'Repuestos' y 'repuestos' eran filas distintas bajo unique (empresa_id, nombre).
-- El unique original queda (redundante pero inofensivo); este índice es el que bloquea.
create unique index categorias_producto_nombre_ci_idx
  on public.categorias_producto (empresa_id, lower(nombre));

-- Igual a 0010 salvo el order by del loop: locks de documentos en orden estable (anti-deadlock).
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

  for v_app in select * from jsonb_array_elements(p_aplicaciones) order by value->>'documentoId' loop
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

-- Igual a 0013 salvo el order by del loop: locks de documentos en orden estable (anti-deadlock).
create or replace function public.registrar_pago_proveedor(
  p_empresa uuid, p_proveedor uuid, p_fecha date, p_metodo text, p_monto integer,
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
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin']) then
    raise exception 'Tu rol no permite registrar pagos a proveedores';
  end if;
  if p_metodo is null or p_metodo not in ('efectivo', 'transferencia', 'tarjeta', 'cheque', 'otro') then
    raise exception 'Método de pago no válido';
  end if;
  if p_monto is null or p_monto <= 0 then
    raise exception 'El monto del pago debe ser mayor a 0';
  end if;
  if not exists (select 1 from proveedores where id = p_proveedor and empresa_id = p_empresa) then
    raise exception 'Proveedor no encontrado en la empresa';
  end if;
  if p_aplicaciones is null or jsonb_array_length(p_aplicaciones) = 0 then
    raise exception 'El pago debe aplicarse a al menos un documento';
  end if;

  insert into pagos_proveedor (empresa_id, proveedor_id, fecha, metodo, monto, referencia, notas)
  values (p_empresa, p_proveedor, coalesce(p_fecha, current_date), p_metodo, p_monto,
          nullif(trim(coalesce(p_referencia, '')), ''), nullif(trim(coalesce(p_notas, '')), ''))
  returning id into v_pago;

  for v_app in select * from jsonb_array_elements(p_aplicaciones) order by value->>'documentoId' loop
    select d.id, d.total into v_doc
    from documentos_compra d
    where d.id = (v_app->>'documentoId')::uuid and d.empresa_id = p_empresa
      and d.proveedor_id = p_proveedor and d.estado = 'activa'
    for update;
    if not found then
      raise exception 'Documento no válido o no pertenece al proveedor';
    end if;
    v_monto_app := (v_app->>'monto')::integer;
    if v_monto_app is null or v_monto_app <= 0 then
      raise exception 'El monto aplicado debe ser mayor a 0';
    end if;

    select (v_doc.total
      - coalesce((select sum(a.monto) from pagos_proveedor_aplicaciones a
                  join pagos_proveedor pg on pg.id = a.pago_id and pg.empresa_id = a.empresa_id
                  where a.documento_id = v_doc.id and a.empresa_id = p_empresa and pg.estado = 'activo'), 0)
    ) into v_saldo;
    if v_monto_app > v_saldo then
      raise exception 'El monto aplicado supera el saldo del documento (saldo: $%)', v_saldo;
    end if;

    insert into pagos_proveedor_aplicaciones (empresa_id, pago_id, documento_id, monto)
    values (p_empresa, v_pago, v_doc.id, v_monto_app);
    v_suma := v_suma + v_monto_app;
  end loop;

  if v_suma <> p_monto then
    raise exception 'La suma de las aplicaciones debe ser igual al monto del pago';
  end if;

  return v_pago;
end $$;
revoke execute on function public.registrar_pago_proveedor(uuid, uuid, date, text, integer, text, text, jsonb) from anon, public;
grant execute on function public.registrar_pago_proveedor(uuid, uuid, date, text, integer, text, text, jsonb) to authenticated;
