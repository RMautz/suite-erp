-- MercadoPago (Plan 13): links de pago, anticipos y metodo 'mercadopago' en
-- pagos. Capa 1 (Task 1): ALTER de empresas con las credenciales cifradas,
-- las tablas links_pago y anticipos (CERO escritura directa: solo lectura de
-- miembros; service_role escribe via RPC) y el metodo 'mercadopago' habilitado
-- en pagos. Task 2 anexa las 6 RPCs tras la marca del final.
--
-- Regla de oro del plan: ningun peso aprobado por MP queda sin registro local
-- (pago conciliado, o anticipo que se aplica al facturar el origen) y ningun
-- anticipo queda varado (registrar_anticipo_mp jamas valida estado; el rechazo
-- de una proforma con anticipo recibido queda bloqueado en Task 2).

-- ---------- empresas: credenciales MP cifradas (AES-256-GCM, helper de dte) ----------
-- Mismo trust boundary server-only que el certificado DTE (misma env
-- DTE_ENCRYPTION_KEY): el ciphertext es visible a miembros via Data API pero
-- inutil sin la clave, y la app JAMAS lo incluye en un select del cliente.
alter table public.empresas
  add column if not exists mp_access_token_cifrado text,
  add column if not exists mp_webhook_secret_cifrado text;

-- Grant ADITIVO: los grants por columna se acumulan sobre los de 0016 — NO se
-- re-declara aquella lista. Solo estas 2 columnas nuevas ganan update.
grant update (mp_access_token_cifrado, mp_webhook_secret_cifrado) on public.empresas to authenticated;

-- ---------- links_pago (un link vigente por objeto; la UI muestra la URL) ----------
-- origen_tipo/origen_id apuntan a factura (documentos_venta), proforma o
-- cotizacion: es polimorfico, sin FK unica sobre el origen. cliente_id (FK
-- compuesta) lo deriva crear_link_pago de la fila base bajo lock.
create table public.links_pago (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  origen_tipo text not null check (origen_tipo in ('factura', 'proforma', 'cotizacion')),
  origen_id uuid not null,
  cliente_id uuid not null,
  monto integer not null check (monto > 0),
  preferencia_id text not null,
  url text not null,
  estado text not null default 'vigente' check (estado in ('vigente', 'pagado', 'reemplazado')),
  -- El payment MP que pago este link (lo marca registrar_pago_mp/anticipo_mp).
  mp_payment_id text,
  creado_en timestamptz not null default now(),
  unique (empresa_id, id),
  foreign key (empresa_id, cliente_id) references public.clientes (empresa_id, id)
);
-- Un solo link VIGENTE por objeto: regenerar reemplaza al anterior bajo el lock
-- de crear_link_pago (Task 2). Parcial: pagado/reemplazado no ocupan el slot.
create unique index links_pago_vigente_idx on public.links_pago (empresa_id, origen_tipo, origen_id) where estado = 'vigente';
create index links_pago_origen_idx on public.links_pago (empresa_id, origen_tipo, origen_id);

-- ---------- anticipos (dinero recibido antes de la factura; jamas varado) ----------
-- origen_tipo 'excedente' = pago MP mayor al saldo de una factura (el origen es
-- esa misma factura); 'proforma'/'cotizacion' = anticipo puro. mp_payment_id
-- NOT NULL y unico por empresa: la idempotencia del webhook se apoya aqui.
create table public.anticipos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  cliente_id uuid not null,
  origen_tipo text not null check (origen_tipo in ('proforma', 'cotizacion', 'excedente')),
  origen_id uuid not null,
  monto integer not null check (monto > 0),
  mp_payment_id text not null,
  estado text not null default 'recibido' check (estado in ('recibido', 'aplicado')),
  -- Se llenan al aplicar (aplicar_anticipo / aplicar_anticipo_manual, Task 2).
  documento_venta_id uuid,
  pago_id uuid,
  recibido_en timestamptz not null default now(),
  unique (empresa_id, id),
  unique (empresa_id, mp_payment_id),
  foreign key (empresa_id, cliente_id) references public.clientes (empresa_id, id),
  foreign key (empresa_id, documento_venta_id) references public.documentos_venta (empresa_id, id),
  foreign key (empresa_id, pago_id) references public.pagos (empresa_id, id)
);
create index anticipos_origen_idx on public.anticipos (empresa_id, origen_tipo, origen_id);

-- ---------- RLS ----------
alter table public.links_pago enable row level security;
alter table public.anticipos enable row level security;

-- Solo lectura de miembros; CERO escritura directa (ni policy ni grant de
-- insert/update/delete para authenticated) — todo entra por RPC service_role,
-- patron proformas/ordenes_entrega de 0016.
create policy "miembros ven links de pago" on public.links_pago
  for select to authenticated using (empresa_id in (select app.mis_empresas()));
create policy "miembros ven anticipos" on public.anticipos
  for select to authenticated using (empresa_id in (select app.mis_empresas()));

-- ---------- Grants Data API (leccion Plan 1) ----------
grant select on public.links_pago, public.anticipos to authenticated;
grant select, insert, update, delete on public.links_pago, public.anticipos to service_role;

-- ---------- pagos: metodo 'mercadopago' + idempotencia por payment ----------
-- mp_payment_id nullable (los pagos manuales no lo llevan) con unique PARCIAL:
-- un payment MP registra a lo mas un pago por empresa (backstop de la
-- idempotencia de registrar_pago_mp).
alter table public.pagos add column if not exists mp_payment_id text;
create unique index pagos_mp_payment_idx on public.pagos (empresa_id, mp_payment_id) where mp_payment_id is not null;

-- Re-create del CHECK de metodo agregando 'mercadopago'. El constraint inline
-- de 0010 se llama pagos_metodo_check (convencion tabla_columna_check de
-- Postgres, confirmada contra la BD); se dropea y re-crea porque un CHECK no
-- admite ALTER en su lugar. Acepta todos los metodos previos: la data existente
-- (los 211 pgTAP) sigue validando.
alter table public.pagos drop constraint pagos_metodo_check;
alter table public.pagos add constraint pagos_metodo_check
  check (metodo in ('efectivo', 'transferencia', 'tarjeta', 'cheque', 'otro', 'mercadopago'));

-- ===== RPCs (Task 2) =====
