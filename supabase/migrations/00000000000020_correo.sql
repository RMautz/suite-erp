-- Correo transaccional (Plan 10): registro de los correos efectivamente enviados
-- (cotizacion, proforma, documento de venta emitido, recordatorio de vencidas). La
-- Server Action escribe UNA fila SOLO cuando el proveedor confirma el envio: la tabla
-- es el log de lo mandado, sirve al anti-spam de recordatorios ("hay un recordatorio
-- de ESTE documento hace < 3 dias?") y al "Enviado el X" de las pantallas. Registro
-- operativo, no dinero: insert directo desde la action, patron documentos_compra
-- (0013). Log INMUTABLE: authenticated solo lee e inserta (sin update/delete).

-- ---------- Tabla ----------
create table public.correos_enviados (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  tipo text not null check (tipo in ('cotizacion', 'proforma', 'documento', 'recordatorio')),
  -- referencia_id apunta a cotizaciones / proformas / documentos_venta segun tipo.
  -- SIN FK dura: una columna no puede referenciar 3 tablas. La action valida el objeto
  -- scoped a la empresa ANTES de enviar; aqui es traza + clave del anti-spam.
  referencia_id uuid not null,
  para text not null,
  asunto text not null,
  -- id que devuelve el proveedor de correo (Resend o el mock): trazabilidad del envio,
  -- no una FK.
  proveedor_id text not null,
  creado_en timestamptz not null default now()
);

-- Anti-spam de recordatorios (ultimo envio de ESTE documento) y "Enviado el X".
create index correos_enviados_ref_idx
  on public.correos_enviados (empresa_id, tipo, referencia_id, creado_en desc);

-- ---------- RLS ----------
alter table public.correos_enviados enable row level security;

-- Los miembros de la empresa ven su historial de envios.
create policy "miembros ven correos enviados" on public.correos_enviados
  for select to authenticated
  using (empresa_id in (select app.mis_empresas()));

-- Enviar un correo lo registra por insert directo desde la action. Vendedor incluido
-- (calza con los roles de las RPCs de cotizacion/proforma; documentos_compra usa solo
-- dueno/admin, aqui se amplia a proposito). SIN update/delete: log inmutable.
create policy "vendedores registran correos enviados" on public.correos_enviados
  for insert to authenticated
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin', 'vendedor']));

-- ---------- Grants Data API (leccion 0001: sin esto todo da 42501) ----------
grant select, insert on public.correos_enviados to authenticated;
grant select, insert, update, delete on public.correos_enviados to service_role;
