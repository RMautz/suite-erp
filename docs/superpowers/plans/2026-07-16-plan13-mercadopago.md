# Plan 13: MercadoPago (links, anticipos y conciliación) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Links de pago MP desde facturas (saldo), proformas y cotizaciones (total → anticipo), con webhook POR EMPRESA que registra el dinero solo — ningún peso aprobado sin registro, ningún anticipo varado — operando completo con MockPasarela hasta las credenciales reales.

**Architecture:** Migración 0018 (links_pago + anticipos + pagos.mp_payment_id + 6 RPCs incl. re-creates de `cambiar_estado_proforma` con bloqueo de rechazo-con-anticipo y `registrar_pago` con método 'mercadopago'); `packages/pagos` (interface + Mock + MP real, patrón packages/dte, cifrado compartido); webhook `/api/webhooks/mercadopago/[empresaId]` (firma → payment consultado → despacho service_role); hook `aplicarAnticipoDocumento` nunca-lanza en lib/emision.ts; UI: config credenciales, botones de link en 3 detalles, sección Anticipos en /cobranza.

**Tech Stack:** Postgres 17 (RLS, pgTAP), Next.js 15 (Server Actions + route handler POST), Vitest (TDD), AES-256-GCM (helper dte).

**Spec:** `docs/superpowers/specs/2026-07-16-plan13-mercadopago-design.md` (2 lentes opus aplicados; §2 decisiones, §3 schema/RPCs/mensajes, §5 webhook y §8 tests son CONTRATO).

## Global Constraints

- Multi-tenant: `empresa_id` + RLS + grants explícitos; FK compuestas; queries de UI `.eq('empresa_id', activa.id)`.
- `links_pago`/`anticipos`: policy `select` miembros + `grant select` a authenticated (la UI los lee); CERO escritura directa; service_role completo. `pagos.mp_payment_id` con unique parcial `(empresa_id, mp_payment_id) where mp_payment_id is not null`; CHECK de `pagos.metodo` re-creado con `'mercadopago'`.
- `empresas`: grant ADITIVO `grant update (mp_access_token_cifrado, mp_webhook_secret_cifrado)` (NO re-declarar la lista de 0016). Columnas cifradas JAMÁS en selects del cliente.
- Alcance de links (contrato): factura emitida factura/boleta con saldo > 0 (`p_monto = saldo` INLINE bajo lock de la fila — patrón registrar_pago, NUNCA la vista); proforma `enviada`/`aprobada` (`p_monto = total`); cotización SOLO `aceptada` (`p_monto = total`). Un link `vigente` por objeto (índice único parcial; regenerar reemplaza bajo el mismo lock).
- Dinero NUNCA varado (contrato): `registrar_anticipo_mp` valida SOLO existencia+tenencia del origen (jamás estado); `cambiar_estado_proforma` re-creada bloquea rechazo con anticipo `recibido` (`for update` del anticipo dentro del lock) → `'La proforma tiene un anticipo recibido; gestiona la devolución primero'`; excedente de `registrar_pago_mp` (monto > saldo, o saldo 0) → fila `anticipos` `origen_tipo='excedente'` (origen = documento) — jamás nota de texto.
- Idempotencia: por `(empresa, mp_payment_id)` DENTRO del lock del documento en `registrar_pago_mp` (unique backstop; tras 23505 RE-SELECT del existente); ídem `registrar_anticipo_mp`.
- `aplicar_anticipo` (service_role, hook) y `aplicar_anticipo_manual` (authenticated, rol dueno/admin/vendedor): lock del documento + `for update` del anticipo; aplica hasta el saldo con pago método 'mercadopago'; doble aplicación imposible.
- Hook de emisión: helper `aplicarAnticipoDocumento(empresaId, docId)` en `apps/erp/lib/emision.ts` con contrato "NUNCA lanza" (espejo de registrarMovimientosDocumento — si lanzara, el catch de emitirDocumento revertiría un DTE vivo); llamado en el bloque `emitido` DESPUÉS de registrar movimientos.
- Webhook (contrato §5): empresa desde la URL `[empresaId]`; orden: uuid válido → secret/token de esa empresa (sin configurar → 200) → `verificarFirma` (x-signature HMAC ts+v1, frescura ±5 min) → `obtenerPago(data.id)` (red/5xx → 500 retry) → solo `approved` → external_reference DEL PAYMENT (4 segmentos estrictos; empresa ≠ URL → 200+alerta) → despacho con el monto DEL payment → 200. Errores BD → 500. Todo no-op permanente con log de alerta.
- `packages/pagos`: interface exacta del spec §4; MockPasarela + página `/mock-pago/[id]` (solo dev) que dispara el webhook real; MercadoPagoPasarela con logging SOLO `error.message` (jamás headers/config/body — test lo fija).
- Método manual 'mercadopago' en LOS CUATRO puntos: CHECK tabla, whitelist interna de `registrar_pago` (re-create en 0018), `METODOS` de cobranza/acciones.ts, `<Selector>` de formulario-pago.tsx. Por-pagar NO lo gana.
- Mensajes EXACTOS (contrato pgTAP, lista literal en spec §3 — 11 mensajes de RPC + 1 de action). Roles: crear_link/aplicar_manual = dueno/admin/vendedor.
- Conteos finales: pgTAP **240** (211 + 29, `plan(29)`), unit **152** (core 126 + auth 2 + dte 10 + **pagos 14**), 3 apps build.
- CERO BOM literal (secuencia de escape backslash-uFEFF; byte-scan = 0, `grep -c` exit 1 = pass); UTF-8 sin BOM; español; Windows/PowerShell 5.1 (`&&` no encadena; prefijar el refresh de PATH).

---

### Task 1: Migración 0018 — tablas, ALTER de pagos y empresas (capa 1)

**Files:**
- Create: `supabase/migrations/00000000000018_mercadopago.sql`

**Interfaces:**
- Consumes: `empresas` (0001/0004/0016 — blanco del ALTER; la FK de `empresa_id`), `clientes` con `unique (empresa_id, id)` (0004 — blanco de las FK compuestas de `cliente_id`), `documentos_venta` con `unique (empresa_id, id)` (0004 — blanco de la FK de `anticipos.documento_venta_id`), `pagos` con `unique (empresa_id, id)` (0010 — blanco de la FK de `anticipos.pago_id`, y objeto del ALTER de `metodo`/`mp_payment_id`), `app.mis_empresas()` (0003 — policies de select).
- Produces: columnas `empresas.mp_access_token_cifrado`/`mp_webhook_secret_cifrado` (cifradas, grant update ADITIVO de SOLO esas 2); tablas `links_pago` y `anticipos` (RLS: solo lectura de miembros; CERO escritura directa; service_role completo); índice único parcial `links_pago_vigente_idx` (un link vigente por objeto) y `pagos_mp_payment_idx` (idempotencia del webhook); `pagos.mp_payment_id` + CHECK de `pagos.metodo` re-creado con `'mercadopago'`. El archivo termina con la marca `-- ===== RPCs (Task 2) =====`; Task 2 anexa las 6 RPCs tras ella.
- ESPEJOS leídos antes de escribir: `0016` (ALTER `empresas` + grant por columnas ADITIVO), `0017` (tablas nuevas con policy de select + grants), `0010` (`pagos`: FK compuesta, `unique (empresa_id, id)`, el CHECK inline `pagos_metodo_check`). Convención del schema: comentarios SQL en ASCII (sin tildes); mensajes de usuario con tildes correctas.

- [ ] **Step 1: Escribir la migración (capa 1)**

`supabase/migrations/00000000000018_mercadopago.sql`:

```sql
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
```

- [ ] **Step 2: Aplicar y verificar**

Run: `pnpm supabase db reset` → aplica 0001-0018 sin errores.
Run: `pnpm supabase test db` → **12 archivos, 211 asserts** existentes siguen verdes (el CHECK re-creado acepta los datos previos; los re-creates de RPC llegan en Task 2 y son aditivos). El archivo `mercadopago.test.sql` (29 asserts) lo escribe una task posterior — aún no existe.

Smoke de grants (contrato de escritura de una vez):

```
docker exec supabase_db_ERP_Transportes psql -U postgres -d postgres -c "select has_table_privilege('authenticated','public.links_pago','select') as lp_sel, has_table_privilege('authenticated','public.links_pago','insert') as lp_ins, has_table_privilege('authenticated','public.anticipos','select') as an_sel, has_table_privilege('authenticated','public.anticipos','insert') as an_ins, has_table_privilege('service_role','public.links_pago','insert') as lp_sr, has_column_privilege('authenticated','public.empresas','mp_access_token_cifrado','update') as tok_upd, has_column_privilege('authenticated','public.empresas','razon_social','update') as rs_upd;"
```

→ `lp_sel = t`, `lp_ins = f` (CERO escritura directa), `an_sel = t`, `an_ins = f`, `lp_sr = t` (service_role escribe), `tok_upd = t` (grant nuevo), `rs_upd = t` (la lista de 0016 SIGUE viva: el grant por columna fue ADITIVO, no reemplazo).

Smoke del CHECK de metodo (acepta 'mercadopago'):

```
docker exec supabase_db_ERP_Transportes psql -U postgres -d postgres -c "select pg_get_constraintdef(oid) from pg_constraint where conname = 'pagos_metodo_check';"
```

→ una fila cuyo `CHECK (...)` incluye `'mercadopago'` junto a los cinco metodos previos.

Smoke de los índices únicos parciales:

```
docker exec supabase_db_ERP_Transportes psql -U postgres -d postgres -c "select indexname, indexdef from pg_indexes where indexname in ('links_pago_vigente_idx','pagos_mp_payment_idx') order by indexname;"
```

→ dos filas: `links_pago_vigente_idx` = `CREATE UNIQUE INDEX ... (empresa_id, origen_tipo, origen_id) WHERE (estado = 'vigente')`; `pagos_mp_payment_idx` = `CREATE UNIQUE INDEX ... (empresa_id, mp_payment_id) WHERE (mp_payment_id IS NOT NULL)`.

Byte-scan del archivo (JAMÁS BOM U+FEFF):

```
grep -c $'\xEF\xBB\xBF' supabase/migrations/00000000000018_mercadopago.sql
```

→ imprime `0` y sale con status 1 (sin coincidencias = pass).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/00000000000018_mercadopago.sql
git commit -m "feat(db): mercadopago — links de pago, anticipos y método en pagos"
```

---

### Task 2: Migración 0018 — las 6 RPCs (+ 2 re-creates)

**Files:**
- Modify: `supabase/migrations/00000000000018_mercadopago.sql` (anexa DESPUÉS de la marca `-- ===== RPCs (Task 2) =====` de Task 1; la marca se conserva, patrón 0016).

**Interfaces:**
- Consumes (Task 1, mismo archivo): tablas `links_pago`, `anticipos`, `pagos.mp_payment_id`, el CHECK de `metodo` con `'mercadopago'`. Del schema previo: `documentos_venta`/`pagos`/`pagos_aplicaciones` (0004/0010 — saldo INLINE), `proformas` (0016), `cotizaciones` (0014), `app.tiene_rol_en_empresa()` (0003).
- Produces: 5 RPCs nuevas — `crear_link_pago` (authenticated, rol d/a/v), `registrar_pago_mp` / `registrar_anticipo_mp` / `aplicar_anticipo` (SOLO service_role), `aplicar_anticipo_manual` (authenticated, rol d/a/v) — más 2 RE-CREATES: `cambiar_estado_proforma` (VERBATIM de 0016 + bloqueo de rechazo con anticipo recibido) y `registrar_pago` (VERBATIM de 0015 + `'mercadopago'` en la whitelist interna).
- ESPEJOS: el saldo INLINE bajo lock es copia exacta del de `registrar_pago` (0010 líneas 137-144 / 0015 líneas 61-68) — la vista `saldos_documentos` NO es lockeable. Grants execute: patrón de 0010/0016 (`revoke ... from anon, public`; luego `grant ... to authenticated` para las de usuario, `to service_role` para las del webhook — `service_role` NO hereda execute de authenticated, confirmado contra la BD).
- Mensajes byte-exactos (contrato pgTAP, spec §3): `'Tu rol no permite generar links de pago'`, `'El documento no existe'`, `'Solo se generan links para facturas emitidas con saldo'`, `'La proforma no permite link de pago en su estado actual'`, `'La cotización no permite link de pago en su estado actual'`, `'El monto no coincide con el saldo del documento'`, `'El monto no coincide con el total del documento'`, `'La proforma tiene un anticipo recibido; gestiona la devolución primero'`, `'Tu rol no permite aplicar anticipos'`, `'El anticipo no existe o ya fue aplicado'`, `'El documento no permite aplicar el anticipo'`.

- [ ] **Step 1: Anexar las RPCs tras la marca**

Agregar al FINAL de `supabase/migrations/00000000000018_mercadopago.sql` (después de la línea `-- ===== RPCs (Task 2) =====`):

```sql
-- ================== RPCs de MercadoPago (Task 2) ==================
-- security definer + set search_path = public; revoke/grant como los espejos.
-- registrar_pago_mp, registrar_anticipo_mp y aplicar_anticipo son SOLO
-- service_role (el webhook y el hook de emision corren con el admin client);
-- crear_link_pago y aplicar_anticipo_manual son authenticated (rol d/a/v).
-- Saldo INLINE bajo el lock de la fila base (patron registrar_pago 0010/0015):
-- la vista saldos_documentos no es lockeable.

-- ---------- Crear link de pago (rol d/a/v; valida por tipo bajo lock) ----------
-- Factura emitida (paga el SALDO), proforma enviada/aprobada o cotizacion
-- aceptada (pagan el TOTAL como anticipo). Reemplaza el link vigente anterior
-- del mismo objeto bajo el mismo lock (un link vigente por objeto).
create or replace function public.crear_link_pago(
  p_empresa uuid, p_id uuid, p_origen_tipo text, p_origen uuid,
  p_preferencia text, p_url text, p_monto integer
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_cliente uuid;
  v_estado text;
  v_total integer;
  v_saldo integer;
  v_link uuid;
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'vendedor']) then
    raise exception 'Tu rol no permite generar links de pago';
  end if;

  if p_origen_tipo = 'factura' then
    -- Lock de la factura y saldo INLINE (patron registrar_pago; NO la vista).
    select cliente_id into v_cliente
    from documentos_venta
    where id = p_origen and empresa_id = p_empresa
      and estado = 'emitido' and tipo in ('factura', 'boleta')
    for update;
    if not found then
      raise exception 'Solo se generan links para facturas emitidas con saldo';
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
    where d.id = p_origen and d.empresa_id = p_empresa;
    if v_saldo <= 0 then
      raise exception 'Solo se generan links para facturas emitidas con saldo';
    end if;
    if p_monto is null or p_monto <> v_saldo then
      raise exception 'El monto no coincide con el saldo del documento';
    end if;
  elsif p_origen_tipo = 'proforma' then
    select cliente_id, estado, total into v_cliente, v_estado, v_total
    from proformas where id = p_origen and empresa_id = p_empresa
    for update;
    if not found then
      raise exception 'El documento no existe';
    end if;
    if v_estado not in ('enviada', 'aprobada') then
      raise exception 'La proforma no permite link de pago en su estado actual';
    end if;
    if p_monto is null or p_monto <> v_total then
      raise exception 'El monto no coincide con el total del documento';
    end if;
  elsif p_origen_tipo = 'cotizacion' then
    select cliente_id, estado, total into v_cliente, v_estado, v_total
    from cotizaciones where id = p_origen and empresa_id = p_empresa
    for update;
    if not found then
      raise exception 'El documento no existe';
    end if;
    if v_estado <> 'aceptada' then
      raise exception 'La cotización no permite link de pago en su estado actual';
    end if;
    if p_monto is null or p_monto <> v_total then
      raise exception 'El monto no coincide con el total del documento';
    end if;
  else
    raise exception 'El documento no existe';
  end if;

  -- Reemplaza el vigente anterior bajo el mismo lock (un link vigente por objeto);
  -- el indice unico parcial links_pago_vigente_idx es el backstop.
  update links_pago set estado = 'reemplazado'
  where empresa_id = p_empresa and origen_tipo = p_origen_tipo and origen_id = p_origen
    and estado = 'vigente';

  insert into links_pago (id, empresa_id, origen_tipo, origen_id, cliente_id, monto, preferencia_id, url)
  values (p_id, p_empresa, p_origen_tipo, p_origen, v_cliente, p_monto, p_preferencia, p_url)
  returning id into v_link;

  return v_link;
end $$;
revoke execute on function public.crear_link_pago(uuid, uuid, text, uuid, text, text, integer) from anon, public;
grant execute on function public.crear_link_pago(uuid, uuid, text, uuid, text, text, integer) to authenticated;

-- ---------- Registrar pago MP (SOLO service_role; idempotente; excedente) ----------
-- min(recibido, saldo) al pago (metodo 'mercadopago'); el excedente -> fila en
-- anticipos ('excedente', origen = el documento); saldo 0 -> todo a excedente
-- (sin fila en pagos). Marca el link 'pagado'. Idempotente por (empresa,
-- mp_payment_id): exists DENTRO del lock del doc + unique parcial de backstop.
create or replace function public.registrar_pago_mp(
  p_empresa uuid, p_documento uuid, p_monto integer,
  p_mp_payment_id text, p_link uuid
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_cliente uuid;
  v_saldo integer;
  v_aplicado integer;
  v_excedente integer;
  v_pago uuid;
begin
  -- Lock del documento: dos webhooks del mismo payment lockean el MISMO doc y
  -- se serializan; la idempotencia se resuelve dentro del lock.
  select cliente_id into v_cliente
  from documentos_venta
  where id = p_documento and empresa_id = p_empresa
    and estado = 'emitido' and tipo in ('factura', 'boleta')
  for update;
  if not found then
    raise exception 'El documento no existe';
  end if;

  -- Idempotencia primaria: este payment ya se registro (como pago o excedente).
  if exists (select 1 from pagos where empresa_id = p_empresa and mp_payment_id = p_mp_payment_id)
     or exists (select 1 from anticipos where empresa_id = p_empresa and mp_payment_id = p_mp_payment_id) then
    return;
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

  -- min(recibido, saldo) al pago; saldo 0 (o ya sobrepagado) -> todo a excedente.
  v_aplicado := greatest(least(p_monto, v_saldo), 0);
  v_excedente := p_monto - v_aplicado;

  -- El unique parcial (empresa_id, mp_payment_id) es el backstop: si un segundo
  -- webhook del mismo payment se cuela en paralelo, el 23505 lo vuelve no-op
  -- (re-select implicito: el existente ya cubre el registro, nada mas que hacer).
  begin
    if v_aplicado > 0 then
      insert into pagos (empresa_id, cliente_id, metodo, monto, mp_payment_id)
      values (p_empresa, v_cliente, 'mercadopago', v_aplicado, p_mp_payment_id)
      returning id into v_pago;
      insert into pagos_aplicaciones (empresa_id, pago_id, documento_id, monto)
      values (p_empresa, v_pago, p_documento, v_aplicado);
    end if;
    if v_excedente > 0 then
      insert into anticipos (empresa_id, cliente_id, origen_tipo, origen_id, monto, mp_payment_id)
      values (p_empresa, v_cliente, 'excedente', p_documento, v_excedente, p_mp_payment_id);
    end if;
  exception when unique_violation then
    return;
  end;

  update links_pago set estado = 'pagado', mp_payment_id = p_mp_payment_id
  where id = p_link and empresa_id = p_empresa;
end $$;
revoke execute on function public.registrar_pago_mp(uuid, uuid, integer, text, uuid) from anon, public;
grant execute on function public.registrar_pago_mp(uuid, uuid, integer, text, uuid) to service_role;

-- ---------- Registrar anticipo MP (SOLO service_role; jamas valida estado) ----------
-- Valida SOLO existencia + tenencia del origen (proforma/cotizacion) — NUNCA su
-- estado: el dinero aprobado se registra aunque el origen haya avanzado o sido
-- rechazado entre el pago y el webhook. Inserta 'recibido'; marca el link 'pagado'.
create or replace function public.registrar_anticipo_mp(
  p_empresa uuid, p_origen_tipo text, p_origen uuid, p_monto integer,
  p_mp_payment_id text, p_link uuid
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_cliente uuid;
begin
  if p_origen_tipo = 'proforma' then
    select cliente_id into v_cliente from proformas
    where id = p_origen and empresa_id = p_empresa;
  elsif p_origen_tipo = 'cotizacion' then
    select cliente_id into v_cliente from cotizaciones
    where id = p_origen and empresa_id = p_empresa;
  else
    raise exception 'El documento no existe';
  end if;
  if v_cliente is null then
    raise exception 'El documento no existe';
  end if;

  -- Idempotente por (empresa, mp_payment_id): exists primero; el unique es
  -- backstop y tras 23505 se re-selecciona el existente (no-op) y se retorna.
  if exists (select 1 from anticipos where empresa_id = p_empresa and mp_payment_id = p_mp_payment_id) then
    return;
  end if;

  begin
    insert into anticipos (empresa_id, cliente_id, origen_tipo, origen_id, monto, mp_payment_id)
    values (p_empresa, v_cliente, p_origen_tipo, p_origen, p_monto, p_mp_payment_id);
  exception when unique_violation then
    return;
  end;

  update links_pago set estado = 'pagado', mp_payment_id = p_mp_payment_id
  where id = p_link and empresa_id = p_empresa;
end $$;
revoke execute on function public.registrar_anticipo_mp(uuid, text, uuid, integer, text, uuid) from anon, public;
grant execute on function public.registrar_anticipo_mp(uuid, text, uuid, integer, text, uuid) to service_role;

-- ---------- Aplicar anticipo (SOLO service_role; hook de emision) ----------
-- Al emitir la factura del origen: el anticipo 'recibido' cuyo origen se facturo
-- en ESTE documento se aplica hasta el saldo (pago 'mercadopago', mp_payment_id
-- del anticipo) y queda 'aplicado'. Sin anticipo -> no-op. Doble aplicacion
-- imposible: el estado se decide bajo el lock del doc + for update del anticipo.
create or replace function public.aplicar_anticipo(p_empresa uuid, p_documento uuid)
returns void
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
  -- Lock del documento primero (orden estable doc -> anticipo, igual que el manual).
  select cliente_id into v_cliente
  from documentos_venta
  where id = p_documento and empresa_id = p_empresa
    and estado = 'emitido' and tipo in ('factura', 'boleta')
  for update;
  if not found then
    return;
  end if;

  -- Anticipo recibido cuyo origen (proforma/cotizacion) se facturo en este doc.
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
    return;
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
    return;
  end if;

  insert into pagos (empresa_id, cliente_id, metodo, monto, mp_payment_id)
  values (p_empresa, v_cliente, 'mercadopago', v_aplicado, v_ant.mp_payment_id)
  returning id into v_pago;
  insert into pagos_aplicaciones (empresa_id, pago_id, documento_id, monto)
  values (p_empresa, v_pago, p_documento, v_aplicado);

  update anticipos set estado = 'aplicado', pago_id = v_pago, documento_venta_id = p_documento
  where id = v_ant.id and empresa_id = p_empresa;
end $$;
revoke execute on function public.aplicar_anticipo(uuid, uuid) from anon, public;
grant execute on function public.aplicar_anticipo(uuid, uuid) to service_role;

-- ---------- Aplicar anticipo manual (authenticated; boton de /cobranza) ----------
-- Rol d/a/v elige un anticipo 'recibido' y una factura emitida CON saldo del
-- MISMO cliente. Misma aplicacion que el hook, con las validaciones extra.
create or replace function public.aplicar_anticipo_manual(
  p_empresa uuid, p_anticipo uuid, p_documento uuid
)
returns void
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

  -- Lock del documento primero (mismo orden doc -> anticipo que el hook).
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

  insert into pagos (empresa_id, cliente_id, metodo, monto, mp_payment_id)
  values (p_empresa, v_doc.cliente_id, 'mercadopago', v_aplicado, v_ant.mp_payment_id)
  returning id into v_pago;
  insert into pagos_aplicaciones (empresa_id, pago_id, documento_id, monto)
  values (p_empresa, v_pago, p_documento, v_aplicado);

  update anticipos set estado = 'aplicado', pago_id = v_pago, documento_venta_id = p_documento
  where id = v_ant.id and empresa_id = p_empresa;
end $$;
revoke execute on function public.aplicar_anticipo_manual(uuid, uuid, uuid) from anon, public;
grant execute on function public.aplicar_anticipo_manual(uuid, uuid, uuid) to authenticated;

-- ---------- RE-CREATE cambiar_estado_proforma (VERBATIM 0016 + bloqueo) ----------
-- Copia EXACTA de 0016 salvo el bloque marcado (0018): al transitar a
-- 'rechazada', si la proforma tiene un anticipo 'recibido' se bloquea (la
-- devolucion es manual en MP, fuera de v1). El lock del anticipo va DENTRO del
-- lock de la proforma -> la decision no se cruza con un webhook en vuelo.
create or replace function public.cambiar_estado_proforma(
  p_empresa uuid, p_proforma uuid, p_estado text, p_motivo text default null
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_actual text;
  v_motivo text;
begin
  -- Rol ANTES del lookup: un rol sin permiso no aprende si la proforma existe.
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'vendedor']) then
    raise exception 'Tu rol no permite gestionar proformas';
  end if;

  -- Lock: una transicion no se cruza con facturar/deshacer en vuelo.
  select estado into v_actual
  from proformas where id = p_proforma and empresa_id = p_empresa
  for update;
  if not found then
    -- Cubre por igual inexistente y de-otro-tenant, sin distinguirlos.
    raise exception 'La proforma no existe';
  end if;

  -- borrador -> enviada | rechazada; enviada -> aprobada | rechazada;
  -- aprobada -> rechazada. 'facturada' SOLO via facturar_proforma;
  -- facturada -> aprobada SOLO via anular_estado_pago.
  if p_estado is null or not (
    (v_actual = 'borrador' and p_estado in ('enviada', 'rechazada')) or
    (v_actual = 'enviada' and p_estado in ('aprobada', 'rechazada')) or
    (v_actual = 'aprobada' and p_estado = 'rechazada')
  ) then
    raise exception 'Transición de estado no válida';
  end if;

  v_motivo := nullif(trim(coalesce(p_motivo, '')), '');
  if p_estado = 'rechazada' and v_motivo is null then
    raise exception 'El rechazo requiere un motivo';
  end if;

  if p_estado = 'rechazada' then
    -- BLOQUEO (0018): una proforma con anticipo recibido no se rechaza hasta
    -- resolver la devolucion. Lock del anticipo dentro del lock de la proforma.
    perform 1 from anticipos
    where origen_tipo = 'proforma' and origen_id = p_proforma
      and empresa_id = p_empresa and estado = 'recibido'
    for update;
    if found then
      raise exception 'La proforma tiene un anticipo recibido; gestiona la devolución primero';
    end if;
    -- Todo rechazo LIBERA las ODEs: locks ordenados ANTES del update masivo.
    perform 1 from ordenes_entrega
    where proforma_id = p_proforma and empresa_id = p_empresa
    order by id
    for update;
    update ordenes_entrega set proforma_id = null
    where proforma_id = p_proforma and empresa_id = p_empresa;
  end if;

  update proformas
  set estado = p_estado,
      -- p_motivo solo se persiste al rechazar; en el resto queda null.
      motivo_rechazo = case when p_estado = 'rechazada' then v_motivo else null end
  where id = p_proforma and empresa_id = p_empresa;
end $$;
revoke execute on function public.cambiar_estado_proforma(uuid, uuid, text, text) from anon, public;
grant execute on function public.cambiar_estado_proforma(uuid, uuid, text, text) to authenticated;

-- ---------- RE-CREATE registrar_pago (VERBATIM 0015 + 'mercadopago') ----------
-- Copia EXACTA de la version vigente (0015, con el order by anti-deadlock) salvo
-- 'mercadopago' agregado a la whitelist interna de metodos (diff de 1 linea):
-- el pago manual gana el metodo sin abrir escritura directa.
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
  if p_metodo is null or p_metodo not in ('efectivo', 'transferencia', 'tarjeta', 'cheque', 'otro', 'mercadopago') then
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
```

**Diff exacto vs 0016 — `cambiar_estado_proforma`** (único cambio; todo lo demás es VERBATIM): dentro de `if p_estado = 'rechazada' then`, ANTES del `perform 1 from ordenes_entrega ...`, se inserta el bloque:

```sql
    -- BLOQUEO (0018): una proforma con anticipo recibido no se rechaza hasta
    -- resolver la devolucion. Lock del anticipo dentro del lock de la proforma.
    perform 1 from anticipos
    where origen_tipo = 'proforma' and origen_id = p_proforma
      and empresa_id = p_empresa and estado = 'recibido'
    for update;
    if found then
      raise exception 'La proforma tiene un anticipo recibido; gestiona la devolución primero';
    end if;
```

**Diff exacto vs 0015 — `registrar_pago`** (única línea cambiada; todo lo demás es VERBATIM):

```
- if p_metodo is null or p_metodo not in ('efectivo', 'transferencia', 'tarjeta', 'cheque', 'otro') then
+ if p_metodo is null or p_metodo not in ('efectivo', 'transferencia', 'tarjeta', 'cheque', 'otro', 'mercadopago') then
```

- [ ] **Step 2: Aplicar y verificar**

Run: `pnpm supabase db reset` → aplica 0001-0018 (con las 7 RPCs) sin errores.
Run: `pnpm supabase test db` → **12 archivos, 211 asserts** intactos: los re-creates son aditivos — `cambiar_estado_proforma` solo bloquea cuando existe un anticipo recibido (el schema de test previo no tiene ninguno → `found` es false → fluye igual que 0016); `registrar_pago` acepta un método más. El archivo `mercadopago.test.sql` (29 asserts) llega en una task posterior.

Smoke de existencia + grants de execute por RPC (el reparto authenticated vs service_role):

```
docker exec supabase_db_ERP_Transportes psql -U postgres -d postgres -c "select p.proname, has_function_privilege('authenticated', p.oid, 'execute') as auth_exec, has_function_privilege('service_role', p.oid, 'execute') as sr_exec, has_function_privilege('anon', p.oid, 'execute') as anon_exec from pg_proc p where p.proname in ('crear_link_pago','registrar_pago_mp','registrar_anticipo_mp','aplicar_anticipo','aplicar_anticipo_manual','cambiar_estado_proforma','registrar_pago') order by p.proname;"
```

Salida esperada (7 filas):

```
        proname          | auth_exec | sr_exec | anon_exec
-------------------------+-----------+---------+-----------
 aplicar_anticipo        | f         | t       | f
 aplicar_anticipo_manual | t         | f       | f
 cambiar_estado_proforma | t         | f       | f
 crear_link_pago         | t         | f       | f
 registrar_anticipo_mp   | f         | t       | f
 registrar_pago          | t         | f       | f
 registrar_pago_mp       | f         | t       | f
```

Los 3 RPCs del webhook/hook (`aplicar_anticipo`, `registrar_anticipo_mp`, `registrar_pago_mp`): `auth_exec = f`, `sr_exec = t` (SOLO service_role). Los de usuario (`crear_link_pago`, `aplicar_anticipo_manual`) y los re-creates: `auth_exec = t`. Nadie con `anon_exec = t`.

Smoke del bloqueo de mensaje (el texto byte-exacto vive en el código):

```
docker exec supabase_db_ERP_Transportes psql -U postgres -d postgres -c "select prosrc like '%La proforma tiene un anticipo recibido; gestiona la devolución primero%' as bloqueo, prosrc like '%''mercadopago''%' as whitelist from pg_proc where proname = 'cambiar_estado_proforma';"
```

→ `bloqueo = t` (el mensaje exacto está presente); el mismo query sobre `registrar_pago` con el segundo predicado → `whitelist = t` (`'mercadopago'` en la whitelist interna).

Byte-scan del archivo (JAMÁS BOM U+FEFF):

```
grep -c $'\xEF\xBB\xBF' supabase/migrations/00000000000018_mercadopago.sql
```

→ imprime `0` y sale con status 1 (pass).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/00000000000018_mercadopago.sql
git commit -m "feat(db): RPCs de mercadopago — links, conciliación, anticipos y bloqueo de rechazo"
```

---

### Task 3: pgTAP de mercadopago

**Files:**
- Create: `supabase/tests/database/mercadopago.test.sql`

**Interfaces:**
- Consumes: migración 0018 (Task 1: tablas `links_pago` y `anticipos`, columna `pagos.mp_payment_id`, y RPCs `crear_link_pago`, `registrar_pago_mp`, `registrar_anticipo_mp`, `aplicar_anticipo`, `aplicar_anticipo_manual`, más los re-creates de `cambiar_estado_proforma` con bloqueo de rechazo-con-anticipo y de `registrar_pago` con método `'mercadopago'`); las RPCs de 0016 para fabricar el flujo real (`crear_orden_entrega`, `crear_proforma`, `cambiar_estado_proforma`, `facturar_proforma`); las de 0014 (`crear_cotizacion`, `cambiar_estado_cotizacion`) para la cotización enviada; `registrar_pago` de 0010; `saldos_documentos` de 0010 para leer saldos; `documentos_venta` (0004) sembrado directo como en cobranza.test.sql.
- RUTs NUEVOS reservados para este archivo (válidos módulo 11; únicos GLOBALES — verificado con grep contra TODOS los tests `7611/7622/7633/7644/7655/7666/7677/7688/76121212x/76343434x/76464646x/76888888x/76111222x/76123456x/76333444x/76222333x/76543210x`, el seed `771234569`/`778899000` y los E2E `999999999`/`888888888`/`666666666`/`765000017`): `769111115` (Org/Empresa A), `769222227` (Org/Empresa B), `769333339` (Cliente A1), `769444440` (Cliente A2, para el test de documento de otro cliente), `769555552` (Cliente B).
- Presupuesto EXACTO de `plan(29)` — mapeo del spec §8 contado A MANO. **Cuatro caminos felices son SETUP sin assert propio** (patrón cotizaciones/transporte: si la llamada fallara, la transacción aborta y todo el archivo cae rojo): `crear_link_pago` de la vendedora (link reusado por el reemplazo → assert 8), `registrar_anticipo_mp` feliz sobre PF1 (probado por `aplicar_anticipo` feliz → assert 16), `registrar_anticipo_mp` feliz sobre PF3 se funde en el test de idempotencia (assert 14), y `aplicar_anticipo_manual` feliz (probado por el "ya fue aplicado" → assert 20). El resto es 1 assert por comportamiento:
  1. factura sin saldo → 42501/P0001 `'Solo se generan links para facturas emitidas con saldo'`
  2. `crear_link_pago` monto ≠ saldo → `'El monto no coincide con el saldo del documento'`
  3. proforma en borrador → `'La proforma no permite link de pago en su estado actual'`
  4. `crear_link_pago` monto ≠ total → `'El monto no coincide con el total del documento'`
  5. cotización enviada (NO — solo aceptada) → `'La cotización no permite link de pago en su estado actual'`
  6. contador NO genera links → `'Tu rol no permite generar links de pago'`
  7. contador NO aplica anticipos → `'Tu rol no permite aplicar anticipos'`
  8. link vigente único (regenerar → el viejo `reemplazado`, un solo `vigente`)
  9. rechazo de proforma SIN anticipo → fluye igual que 0016 (lives_ok)
  10. `registrar_pago_mp` feliz + IDEMPOTENTE (dos webhooks del mismo `mp_payment_id` → saldo baja UNA vez a 40000 y un solo pago)
  11. `registrar_pago_mp` monto > saldo → pago por el saldo (0) + anticipo `excedente` por la diferencia (20000)
  12. `registrar_pago_mp` saldo 0 → sin pago, todo a `excedente` (30000)
  13. `registrar_anticipo_mp` con ORIGEN RECHAZADO igual registra (proforma `rechazada` + anticipo `recibido`)
  14. `registrar_anticipo_mp` idempotente (mismo `mp_payment_id` dos veces → un solo anticipo)
  15. rechazo de proforma CON anticipo `recibido` → BLOQUEADO `'La proforma tiene un anticipo recibido; gestiona la devolución primero'`
  16. `aplicar_anticipo` feliz (post-emisión simulada → saldo 0 y anticipo `aplicado`)
  17. `aplicar_anticipo` doble aplicación imposible (segunda llamada no crea un segundo pago)
  18. `aplicar_anticipo` sin anticipo → no-op (saldo intacto)
  19. `aplicar_anticipo_manual` documento de otro cliente → `'El documento no permite aplicar el anticipo'`
  20. `aplicar_anticipo_manual` anticipo ya aplicado → `'El anticipo no existe o ya fue aplicado'`
  21. cross-tenant de una RPC authenticated (A pide link sobre la empresa B → rol denegado)
  22. `pagos.metodo` acepta `'mercadopago'` (insert vía `registrar_pago` re-creada)
  23. candado de escritura directa: insert en `links_pago` → 42501
  24. candado de escritura directa: update en `anticipos` → 42501
  25. candado de ejecución: `registrar_pago_mp` como authenticated → 42501 (solo service_role; sin guardia de rol interna, el grant ES el candado)
  26. candado de ejecución: `registrar_anticipo_mp` como authenticated → 42501 (solo service_role)
  27. candado de ejecución: `aplicar_anticipo` como authenticated → 42501 (solo service_role)
  28. aislamiento de las 2 tablas + select POSITIVO de miembro (Beto ve solo sus 2 filas)
  29. anónimo denegado de plano (42501)
- Fechas FIJAS (julio 2026), jamás `current_date` en el flujo de documentos: los saldos y montos deben cuadrar a mano siempre. La validez de la cotización sí usa `current_date + 30` (no se asserta, solo debe ser futura).

- [ ] **Step 1: Escribir el test**

`supabase/tests/database/mercadopago.test.sql`:

```sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'ana@a.cl'),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'beto@b.cl'),
  ('00000000-0000-0000-0000-000000000000', '55555555-5555-5555-5555-555555555555', 'authenticated', 'authenticated', 'ces@a.cl'),
  ('00000000-0000-0000-0000-000000000000', '77777777-7777-7777-7777-777777777777', 'authenticated', 'authenticated', 'vero@a.cl');

-- RUT nuevos, únicos GLOBALES: no colisionan con otros tests (7611/7622/7633/7644/
-- 7655/7666/7677/7688/76121212x/76343434x/76464646x/76888888x/76123456x), el seed
-- (771234569, 778899000) ni los E2E (999999999, 888888888, 666666666, 765000017).
insert into public.organizaciones (id, rut, razon_social)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '769111115', 'Org A'),
       ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '769222227', 'Org B');

-- A nace con el módulo ACTIVO (las RPCs de ODE lo exigen); B queda off (solo siembra fijas).
insert into public.empresas (id, organizacion_id, rut, razon_social, modulo_transporte)
values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '769111115', 'Transportes A', true),
       ('eeeeeeee-0000-0000-0000-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '769222227', 'Empresa B', false);

insert into public.miembros (usuario_id, organizacion_id, rol)
values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'dueno'),
       ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'dueno'),
       ('55555555-5555-5555-5555-555555555555', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'contador'),
       ('77777777-7777-7777-7777-777777777777', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'vendedor');

-- A1 (blanco principal), A2 (para "documento de otro cliente"), B (dueño de las filas de aislamiento).
insert into public.clientes (id, empresa_id, rut, razon_social)
values ('cccccccc-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '769333339', 'Cliente A1'),
       ('cccccccc-1111-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '769444440', 'Cliente A2'),
       ('cccccccc-0000-0000-0000-bbbbbbbbbbbb', 'eeeeeeee-0000-0000-0000-bbbbbbbbbbbb', '769555552', 'Cliente B');

insert into public.vehiculos (id, empresa_id, patente, descripcion)
values ('aaaa0001-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'ABCD12', 'Camión A');
insert into public.destinos (id, empresa_id, nombre, tarifa_kg)
values ('dddd0001-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'Coyhaique', 450);
-- P1 afecto para la cotización.
insert into public.productos (id, empresa_id, sku, nombre, precio_neto, exento)
values ('99999999-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'P1', 'Producto Afecto', 10000, false);

-- Facturas emitidas por insert DIRECTO (superuser salta grants/RLS, patrón cobranza.test.sql).
-- neto = total, iva/exento 0: documentos_venta no cruza-chequea total = neto+iva+exento.
insert into public.documentos_venta (id, empresa_id, tipo, cliente_id, folio, estado, neto, exento, iva, total, emitido_en)
values ('dddddddd-0000-0000-0000-000000000101', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'factura', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 101, 'emitido', 100000, 0, 0, 100000, now()),
       ('dddddddd-0000-0000-0000-000000000102', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'factura', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 102, 'emitido', 50000, 0, 0, 50000, now()),
       ('dddddddd-0000-0000-0000-000000000103', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'factura', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 103, 'emitido', 100000, 0, 0, 100000, now()),
       ('dddddddd-0000-0000-0000-000000000104', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'factura', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 104, 'emitido', 50000, 0, 0, 50000, now()),
       ('dddddddd-0000-0000-0000-000000000105', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'factura', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 105, 'emitido', 50000, 0, 0, 50000, now()),
       ('dddddddd-0000-0000-0000-000000000106', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'factura', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 106, 'emitido', 71400, 0, 0, 71400, now()),
       ('dddddddd-0000-0000-0000-000000000107', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'factura', 'cccccccc-1111-0000-0000-aaaaaaaaaaaa', 107, 'emitido', 40000, 0, 0, 40000, now());
-- NC que deja el 102 en saldo 0 (para "factura sin saldo"): total - NC = 0.
insert into public.documentos_venta (id, empresa_id, tipo, cliente_id, folio, estado, neto, exento, iva, total, documento_referencia_id, emitido_en)
values ('dddddddd-0000-0000-0000-0000000001c2', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'nota_credito', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 202, 'emitido', 50000, 0, 0, 50000, 'dddddddd-0000-0000-0000-000000000102', now());

-- Fixtures de B por insert directo: 1 link + 1 anticipo, blancos del aislamiento POSITIVO
-- (origen_id es polimórfico, SIN FK: uuid dummy; cliente_id sí es FK compuesta a B).
insert into public.links_pago (empresa_id, origen_tipo, origen_id, cliente_id, monto, preferencia_id, url)
values ('eeeeeeee-0000-0000-0000-bbbbbbbbbbbb', 'factura', 'a0a0a0a0-0000-0000-0000-0000000000b1', 'cccccccc-0000-0000-0000-bbbbbbbbbbbb', 1000, 'pref-b', 'https://mp/b');
insert into public.anticipos (empresa_id, cliente_id, origen_tipo, origen_id, monto, mp_payment_id)
values ('eeeeeeee-0000-0000-0000-bbbbbbbbbbbb', 'cccccccc-0000-0000-0000-bbbbbbbbbbbb', 'proforma', 'a0a0a0a0-0000-0000-0000-0000000000b2', 1000, 'mp-b');

-- ===== Ana (dueña A): ODEs y proformas por el camino REAL (fechas fijas julio 2026) =====
-- Si cualquier setup fallara, el archivo entero aborta (feliz cubierto sin assert propio).
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select crear_orden_entrega('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
  date '2026-07-10', 'dddd0001-0000-0000-0000-aaaaaaaaaaaa', 'GD 1', null,
  1, 100, null, 100000, 'aaaa0001-0000-0000-0000-aaaaaaaaaaaa', null, null);
select crear_orden_entrega('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
  date '2026-07-10', 'dddd0001-0000-0000-0000-aaaaaaaaaaaa', 'GD 2', null,
  1, 100, null, 50000, null, null, null);
select crear_orden_entrega('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
  date '2026-07-10', 'dddd0001-0000-0000-0000-aaaaaaaaaaaa', 'GD 3', null,
  1, 100, null, 60000, null, null, null);

-- PF1 (numero 1): total 119000 → el flujo de aplicar_anticipo. PF2 (numero 2): total 59500 →
-- origen rechazado. PF3 (numero 3): total 71400 → anticipo del botón manual.
select crear_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
  array[(select id from ordenes_entrega where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1)], null);
select crear_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
  array[(select id from ordenes_entrega where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 2)], null);
select crear_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
  array[(select id from ordenes_entrega where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 3)], null);

-- ===== crear_link_pago: validaciones por tipo (Ana) =====

-- 1) Factura sin saldo: el 102 quedó en 0 por la NC → no se genera link.
select throws_ok(
  $$select crear_link_pago('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', gen_random_uuid(), 'factura',
    'dddddddd-0000-0000-0000-000000000102', 'pref-x', 'https://mp/x', 1)$$,
  'P0001', 'Solo se generan links para facturas emitidas con saldo',
  'no se genera link para una factura sin saldo'
);

-- 2) Factura con saldo pero monto ≠ saldo (saldo 100000, monto 50000).
select throws_ok(
  $$select crear_link_pago('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', gen_random_uuid(), 'factura',
    'dddddddd-0000-0000-0000-000000000101', 'pref-x', 'https://mp/x', 50000)$$,
  'P0001', 'El monto no coincide con el saldo del documento',
  'el monto del link debe igualar el saldo de la factura'
);

-- 3) Proforma en borrador (PF1 aún sin enviar) no admite link.
select throws_ok(
  $$select crear_link_pago('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', gen_random_uuid(), 'proforma',
    (select id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1),
    'pref-x', 'https://mp/x', 119000)$$,
  'P0001', 'La proforma no permite link de pago en su estado actual',
  'una proforma en borrador no admite link de pago'
);

-- Enviar PF1: ya admite link (enviada/aprobada pagan el TOTAL como anticipo).
select cambiar_estado_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1), 'enviada');

-- 4) Proforma enviada pero monto ≠ total (total 119000, monto 1).
select throws_ok(
  $$select crear_link_pago('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', gen_random_uuid(), 'proforma',
    (select id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1),
    'pref-x', 'https://mp/x', 1)$$,
  'P0001', 'El monto no coincide con el total del documento',
  'el monto del link debe igualar el total de la proforma'
);

-- Cotización enviada (numero 1): total 10000 + iva 1900 = 11900. Solo 'aceptada' admite link.
select crear_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
  current_date + 30, null,
  '[{"productoId":"99999999-0000-0000-0000-aaaaaaaaaaaa","cantidad":1,"precioNeto":10000}]'::jsonb);
select cambiar_estado_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from cotizaciones where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1), 'enviada');

-- 5) Cotización 'enviada' (no 'aceptada') no admite link, con el monto correcto: falla por ESTADO.
select throws_ok(
  $$select crear_link_pago('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', gen_random_uuid(), 'cotizacion',
    (select id from cotizaciones where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1),
    'pref-x', 'https://mp/x', 11900)$$,
  'P0001', 'La cotización no permite link de pago en su estado actual',
  'solo una cotización aceptada admite link; la enviada no'
);

-- ===== Roles (Ces contador) =====
set local request.jwt.claims to '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated"}';

-- 6) El contador NO genera links (rol dueno/admin/vendedor).
select throws_ok(
  $$select crear_link_pago('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', gen_random_uuid(), 'factura',
    'dddddddd-0000-0000-0000-000000000101', 'pref-x', 'https://mp/x', 100000)$$,
  'P0001', 'Tu rol no permite generar links de pago',
  'el contador no puede generar links de pago'
);

-- 7) El contador tampoco aplica anticipos: el rol se chequea ANTES de mirar el anticipo
--    (por eso un id de anticipo inexistente igual da el mensaje de rol).
select throws_ok(
  $$select aplicar_anticipo_manual('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    '00000000-0000-0000-0000-000000000000', 'dddddddd-0000-0000-0000-000000000106')$$,
  'P0001', 'Tu rol no permite aplicar anticipos',
  'el contador no puede aplicar anticipos'
);

-- ===== Vendedora (Vero): crea el link de DOC_LINK — SETUP (vendedor SÍ genera links) =====
set local request.jwt.claims to '{"sub": "77777777-7777-7777-7777-777777777777", "role": "authenticated"}';
select crear_link_pago('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', gen_random_uuid(), 'factura',
  'dddddddd-0000-0000-0000-000000000101', 'pref-doclink-1', 'https://mp/doclink-1', 100000);

-- ===== Ana: regenerar reemplaza; links de los flujos de pago/anticipo =====
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- SETUP: regenerar el link del 101 → el nuevo vigente, el viejo pasa a 'reemplazado'.
select crear_link_pago('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', gen_random_uuid(), 'factura',
  'dddddddd-0000-0000-0000-000000000101', 'pref-doclink-2', 'https://mp/doclink-2', 100000);

-- 8) Un solo link vigente por objeto; el anterior quedó 'reemplazado'.
select is(
  (select count(*) from links_pago
   where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and origen_id = 'dddddddd-0000-0000-0000-000000000101' and estado = 'vigente')::text
  || '/' ||
  (select estado from links_pago where preferencia_id = 'pref-doclink-1'),
  '1/reemplazado',
  'regenerar deja un solo link vigente y el anterior reemplazado'
);

-- SETUP: links de los tres flujos de registrar_pago_mp (monto = saldo al crearlos).
select crear_link_pago('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', gen_random_uuid(), 'factura',
  'dddddddd-0000-0000-0000-000000000103', 'pref-pay1', 'https://mp/pay1', 100000);
select crear_link_pago('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', gen_random_uuid(), 'factura',
  'dddddddd-0000-0000-0000-000000000104', 'pref-pay2', 'https://mp/pay2', 50000);
select crear_link_pago('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', gen_random_uuid(), 'factura',
  'dddddddd-0000-0000-0000-000000000105', 'pref-pay3', 'https://mp/pay3', 50000);

-- SETUP: link de PF1 (enviada) para el anticipo que se aplicará al facturar.
select crear_link_pago('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', gen_random_uuid(), 'proforma',
  (select id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1),
  'pref-pf-aplicar', 'https://mp/pf-aplicar', 119000);

-- PF2: enviar + link + rechazar (sin anticipo aún) — el rechazo fluye igual que 0016.
select cambiar_estado_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 2), 'enviada');
select crear_link_pago('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', gen_random_uuid(), 'proforma',
  (select id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 2),
  'pref-pf-rech', 'https://mp/pf-rech', 59500);

-- 9) Rechazo de proforma SIN anticipo recibido: fluye (mismo comportamiento que 0016).
select lives_ok(
  $$select cambiar_estado_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 2),
    'rechazada', 'Sin acuerdo comercial')$$,
  'una proforma sin anticipo se rechaza sin bloqueo'
);

-- PF3: enviar + link (para el anticipo del botón manual).
select cambiar_estado_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 3), 'enviada');
select crear_link_pago('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', gen_random_uuid(), 'proforma',
  (select id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 3),
  'pref-pf-manual', 'https://mp/pf-manual', 71400);

-- El 105 baja a saldo 0 por una NC ANTES del webhook (carrera saldo-cambió): el link ya existía.
set local role postgres;
insert into public.documentos_venta (id, empresa_id, tipo, cliente_id, folio, estado, neto, exento, iva, total, documento_referencia_id, emitido_en)
values ('dddddddd-0000-0000-0000-0000000001c5', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'nota_credito', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 205, 'emitido', 50000, 0, 0, 50000, 'dddddddd-0000-0000-0000-000000000105', now());
reset role;

-- ===== Webhook (service_role): registrar dinero. p_link estable por preferencia_id
--       (tras el primer pago el link pasa a 'pagado', así que no se filtra por estado). =====
set local role service_role;

-- Pago del 103 dos veces con el MISMO mp_payment_id (dos webhooks del mismo payment).
select registrar_pago_mp('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'dddddddd-0000-0000-0000-000000000103',
  60000, 'mp-pay1', (select id from links_pago where preferencia_id = 'pref-pay1'));
select registrar_pago_mp('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'dddddddd-0000-0000-0000-000000000103',
  60000, 'mp-pay1', (select id from links_pago where preferencia_id = 'pref-pay1'));
-- Pago del 104 MAYOR al saldo (saldo 50000, pago 70000): pago por 50000 + excedente 20000.
select registrar_pago_mp('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'dddddddd-0000-0000-0000-000000000104',
  70000, 'mp-pay2', (select id from links_pago where preferencia_id = 'pref-pay2'));
-- Pago del 105 con saldo 0 (NC lo neteó): sin fila en pagos, todo a excedente 30000.
select registrar_pago_mp('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'dddddddd-0000-0000-0000-000000000105',
  30000, 'mp-pay3', (select id from links_pago where preferencia_id = 'pref-pay3'));

-- Anticipo de PF1 (se aplicará al facturar). Anticipo de PF2 RECHAZADA (el dinero se registra igual).
select registrar_anticipo_mp('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'proforma',
  (select id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1),
  119000, 'mp-ant-aplicar', (select id from links_pago where preferencia_id = 'pref-pf-aplicar'));
select registrar_anticipo_mp('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'proforma',
  (select id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 2),
  59500, 'mp-ant-rech', (select id from links_pago where preferencia_id = 'pref-pf-rech'));
-- Anticipo de PF3 dos veces con el mismo mp_payment_id (idempotencia): un solo anticipo.
select registrar_anticipo_mp('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'proforma',
  (select id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 3),
  71400, 'mp-ant-manual', (select id from links_pago where preferencia_id = 'pref-pf-manual'));
select registrar_anticipo_mp('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'proforma',
  (select id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 3),
  71400, 'mp-ant-manual', (select id from links_pago where preferencia_id = 'pref-pf-manual'));
reset role;

-- ===== Ana: los efectos del webhook cuadran a mano =====
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- 10) registrar_pago_mp feliz + IDEMPOTENTE: el saldo del 103 baja UNA vez a 40000
--     y existe un solo pago para 'mp-pay1' (el segundo webhook no duplicó nada).
select is(
  (select saldo from saldos_documentos where documento_id = 'dddddddd-0000-0000-0000-000000000103')::text
  || '/' ||
  (select count(*) from pagos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and mp_payment_id = 'mp-pay1')::text,
  '40000/1',
  'dos webhooks del mismo payment: el saldo baja una vez a 40000 y hay un solo pago'
);

-- 11) monto > saldo: el 104 queda en saldo 0 (pago por el saldo) y el excedente 20000 va a anticipos.
select is(
  (select saldo from saldos_documentos where documento_id = 'dddddddd-0000-0000-0000-000000000104')::text
  || '/' ||
  (select monto from anticipos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and origen_tipo = 'excedente' and origen_id = 'dddddddd-0000-0000-0000-000000000104')::text,
  '0/20000',
  'pago mayor al saldo: pago por el saldo y excedente como anticipo'
);

-- 12) saldo 0: sin pago (0 filas para 'mp-pay3') y TODO el monto (30000) va a excedente.
select is(
  (select count(*) from pagos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and mp_payment_id = 'mp-pay3')::text
  || '/' ||
  (select monto from anticipos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
     and origen_tipo = 'excedente' and origen_id = 'dddddddd-0000-0000-0000-000000000105')::text,
  '0/30000',
  'pago sobre saldo 0: ningún pago y todo el monto como excedente'
);

-- 13) ORIGEN RECHAZADO igual registra: PF2 está 'rechazada' y su anticipo quedó 'recibido'.
select is(
  (select estado from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 2)
  || '/' ||
  (select estado from anticipos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and mp_payment_id = 'mp-ant-rech'),
  'rechazada/recibido',
  'un anticipo se registra aunque el origen ya esté rechazado: el dinero jamás se pierde'
);

-- 14) registrar_anticipo_mp idempotente: dos webhooks del mismo payment → un solo anticipo.
select is(
  (select count(*) from anticipos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and mp_payment_id = 'mp-ant-manual'),
  1::bigint,
  'el mismo mp_payment_id no duplica el anticipo'
);

-- 15) Rechazo de PF1 (que tiene anticipo 'recibido') → BLOQUEADO con el mensaje exacto.
select throws_ok(
  $$select cambiar_estado_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1),
    'rechazada', 'Cliente se arrepintió')$$,
  'P0001', 'La proforma tiene un anticipo recibido; gestiona la devolución primero',
  'no se rechaza una proforma con un anticipo recibido encima'
);

-- Emisión simulada de PF1: aprobar → facturar → el service_role la deja 'emitido' con folio
-- (el hook aplicarAnticipoDocumento vive en la app, no en un trigger, así que aquí NO auto-aplica).
select cambiar_estado_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1), 'aprobada');
select facturar_proforma('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1));
set local role postgres;
update public.documentos_venta set tipo = 'factura', estado = 'emitido', folio = 110, emitido_en = now()
where id = (select documento_venta_id from public.proformas
            where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1);
reset role;

-- ===== aplicar_anticipo (service_role, el hook de emisión) =====
set local role service_role;
-- Aplica el anticipo de PF1 a su factura emitida; segunda llamada = doble aplicación (no-op);
-- tercera sobre DOC_LINK (sin anticipo asociado) = no-op.
select aplicar_anticipo('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select documento_venta_id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1));
select aplicar_anticipo('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select documento_venta_id from proformas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1));
select aplicar_anticipo('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'dddddddd-0000-0000-0000-000000000101');
reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- 16) aplicar_anticipo feliz: la factura de PF1 (total 119000) queda en saldo 0 y el anticipo 'aplicado'.
select is(
  (select saldo from saldos_documentos
   where documento_id = (select documento_venta_id from proformas
                         where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1))::text
  || '/' ||
  (select estado from anticipos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and mp_payment_id = 'mp-ant-aplicar'),
  '0/aplicado',
  'al facturar, el anticipo se aplica solo: saldo 0 y anticipo aplicado'
);

-- 17) Doble aplicación imposible: la segunda llamada NO creó un segundo pago (uno solo).
select is(
  (select count(*) from pagos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and mp_payment_id = 'mp-ant-aplicar'),
  1::bigint,
  'aplicar un anticipo ya aplicado no genera un segundo pago'
);

-- 18) Sin anticipo → no-op: DOC_LINK (factura sin anticipo asociado) sigue con su saldo intacto.
select is(
  (select saldo from saldos_documentos where documento_id = 'dddddddd-0000-0000-0000-000000000101'),
  100000,
  'aplicar_anticipo sobre un documento sin anticipo no altera su saldo'
);

-- ===== aplicar_anticipo_manual (Ana): el botón de /cobranza =====

-- 19) El anticipo de A1 no aplica a una factura de A2 (documento de otro cliente).
select throws_ok(
  $$select aplicar_anticipo_manual('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from anticipos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and mp_payment_id = 'mp-ant-manual'),
    'dddddddd-0000-0000-0000-000000000107')$$,
  'P0001', 'El documento no permite aplicar el anticipo',
  'un anticipo no se aplica a la factura de otro cliente'
);

-- SETUP: aplicar el anticipo manual a una factura del MISMO cliente (A1, saldo 71400).
select aplicar_anticipo_manual('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from anticipos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and mp_payment_id = 'mp-ant-manual'),
  'dddddddd-0000-0000-0000-000000000106');

-- 20) Aplicar dos veces el mismo anticipo → error (ya fue aplicado): prueba también el feliz previo.
select throws_ok(
  $$select aplicar_anticipo_manual('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from anticipos where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and mp_payment_id = 'mp-ant-manual'),
    'dddddddd-0000-0000-0000-000000000106')$$,
  'P0001', 'El anticipo no existe o ya fue aplicado',
  'un anticipo ya aplicado no se vuelve a aplicar'
);

-- 21) Cross-tenant: Ana (no es miembro de B) pide un link sobre la empresa B → rol denegado.
select throws_ok(
  $$select crear_link_pago('eeeeeeee-0000-0000-0000-bbbbbbbbbbbb', gen_random_uuid(), 'factura',
    'dddddddd-0000-0000-0000-000000000107', 'pref-x', 'https://mp/x', 40000)$$,
  'P0001', 'Tu rol no permite generar links de pago',
  'un usuario no puede operar links sobre una empresa ajena'
);

-- 22) pagos.metodo acepta 'mercadopago' (CHECK + whitelist de registrar_pago re-creados en 0018).
select lives_ok(
  $$select registrar_pago('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-1111-0000-0000-aaaaaaaaaaaa',
    current_date, 'mercadopago', 40000, 'MP-REF', null,
    '[{"documentoId":"dddddddd-0000-0000-0000-000000000107","monto":40000}]'::jsonb)$$,
  'un pago manual con método mercadopago se registra'
);

-- 23) Escritura directa en links_pago denegada (toda escritura es por RPC/service_role).
select throws_ok(
  $$insert into links_pago (empresa_id, origen_tipo, origen_id, cliente_id, monto, preferencia_id, url)
    values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'factura', 'dddddddd-0000-0000-0000-000000000101',
            'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 1000, 'pref-hack', 'https://mp/hack')$$,
  '42501', 'permission denied for table links_pago',
  'authenticated no puede insertar directamente en links_pago'
);

-- 24) Escritura directa en anticipos denegada (update sin grant).
select throws_ok(
  $$update anticipos set monto = 1 where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'$$,
  '42501', 'permission denied for table anticipos',
  'authenticated no puede editar directamente los anticipos'
);

-- 25-27) authenticated NO ejecuta las RPCs service_role del webhook/hook. Esas RPCs son
--        security definer SIN guardia de rol/tenant interna (confían en service_role): su
--        ÚNICO candado es el grant. Una regresión que agregue `grant execute ... to
--        authenticated` dejaría a cualquier usuario fabricar pagos/anticipos — el grant ES
--        el candado, y aquí se testea (siguen bajo la sesión authenticated de Ana).
select throws_ok(
  $$select registrar_pago_mp('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    'dddddddd-0000-0000-0000-000000000101', 100000, 'mp-hack', null)$$,
  '42501', 'permission denied for function registrar_pago_mp',
  'authenticated no puede ejecutar registrar_pago_mp (solo service_role)'
);
select throws_ok(
  $$select registrar_anticipo_mp('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'proforma',
    '00000000-0000-0000-0000-000000000000', 100000, 'mp-hack2', null)$$,
  '42501', 'permission denied for function registrar_anticipo_mp',
  'authenticated no puede ejecutar registrar_anticipo_mp (solo service_role)'
);
select throws_ok(
  $$select aplicar_anticipo('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    'dddddddd-0000-0000-0000-000000000101')$$,
  '42501', 'permission denied for function aplicar_anticipo',
  'authenticated no puede ejecutar aplicar_anticipo (solo service_role)'
);

-- 28) Aislamiento + select POSITIVO: Beto ve SOLO sus 2 filas sembradas (1 link + 1 anticipo);
--     las muchas filas de A son invisibles por RLS.
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
select is(
  (select count(*) from links_pago) + (select count(*) from anticipos),
  2::bigint,
  'Beto ve solo su link y su anticipo: aislamiento de las 2 tablas y select positivo de miembro'
);

-- 29) Anónimo denegado de plano.
set local request.jwt.claims to '{"role": "anon"}';
set local role anon;
select throws_ok(
  'select count(*) from links_pago',
  '42501', 'permission denied for table links_pago',
  'un anónimo no puede consultar links_pago'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Ejecutar**

Run: `pnpm supabase test db`
Expected: 13 archivos, **240 asserts** (aislamiento 6, cobranza 16, combustible 18, compras 19, cotizaciones 27, inventario 10, maestros 11, mercadopago **29**, por_pagar 18, registro 7, reportes 11, transporte 59, ventas 9), todos verdes. Si un assert de mercadopago falla, el sospechoso es la migración 0018 (Task 1) — NO debilitar el test. Única adaptación permitida: el TEXTO exacto de los mensajes nativos de Postgres en los asserts 23, 24 y 29 (`permission denied for table ...`) y 25-27 (`permission denied for function ...`), si la versión los formula distinto; los CÓDIGOS de error (42501/P0001), los mensajes de RPC del contrato §3, los goldens de saldo/excedente y los conteos son el contrato.

Diagnóstico rápido si cae un grupo:
- Asserts 1-5 (validaciones de `crear_link_pago`): revisa el orden estado-antes-de-monto y el saldo INLINE bajo lock (no la vista).
- Asserts 10-12 (`registrar_pago_mp`): revisa `min(monto, saldo)` y la fila `excedente` (origen = documento); saldo 0 → sin pago.
- Assert 13 (`registrar_anticipo_mp` origen rechazado): la RPC valida SOLO existencia+tenencia, JAMÁS estado.
- Assert 15 (bloqueo de rechazo): el `for update` del anticipo `recibido` dentro del lock de la proforma.
- Assert 16-17 (`aplicar_anticipo`): el join documento→proforma→anticipo y la idempotencia por estado dentro del lock.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/database/mercadopago.test.sql
git commit -m "test(db): pgTAP de mercadopago — idempotencia, excedentes, anticipos y bloqueo de rechazo"
```

---

### Task 4: Regenerar tipos `@suite/db`

**Files:**
- Modify: `packages/db/src/types.ts` (regenerado)

**Interfaces:**
- Consumes: migración 0018 aplicada (Tasks 1-2: tablas `links_pago` y `anticipos`, columnas `pagos.mp_payment_id` + `empresas.mp_access_token_cifrado`/`mp_webhook_secret_cifrado`, y las RPCs `crear_link_pago`/`registrar_pago_mp`/`registrar_anticipo_mp`/`aplicar_anticipo`/`aplicar_anticipo_manual` + los RE-CREATE de `cambiar_estado_proforma` y `registrar_pago`).
- Produces: `types.ts` regenerado — lo consumen `packages/pagos`, el webhook y las páginas ERP (Tasks siguientes) vía `@suite/db`. BLOCKED de las tasks de webhook/UI si algún símbolo falta (tipos incompletos ocultarían un error de compilación hasta runtime).

- [ ] **Step 1: Regenerar y verificar**

Run: `pnpm --filter @suite/db gen`

Expected: `types.ts` gana estos símbolos:
- Tablas `links_pago` y `anticipos` (Row/Insert/Update bajo `Tables`, como las tablas de 0016).
- Columnas nuevas en tablas existentes: `mp_payment_id` en `pagos`, y `mp_access_token_cifrado` + `mp_webhook_secret_cifrado` en `empresas` (Row/Insert/Update).
- **5 Functions nuevas** bajo `Functions`: `crear_link_pago`, `registrar_pago_mp`, `registrar_anticipo_mp`, `aplicar_anticipo`, `aplicar_anticipo_manual`.
- `cambiar_estado_proforma` y `registrar_pago` YA existían: 0018 solo RE-CREATE su cuerpo con la MISMA firma → **sin símbolo nuevo** (Postgres no expone el cuerpo en los tipos; el CHECK de `pagos.metodo` con `'mercadopago'` tampoco aparece — es un constraint, no un tipo). No confundir "sin diff en esos dos" con "la migración no aplicó".

Verificación (PowerShell) — los 10 símbolos que SÍ deben aparecer:

```powershell
$simbolos = 'links_pago', 'anticipos', 'mp_payment_id', 'mp_access_token_cifrado',
  'mp_webhook_secret_cifrado', 'crear_link_pago', 'registrar_pago_mp',
  'registrar_anticipo_mp', 'aplicar_anticipo:', 'aplicar_anticipo_manual'
foreach ($s in $simbolos) {
  if (-not (Select-String -Path packages/db/src/types.ts -Pattern $s -SimpleMatch -Quiet)) { "FALTA: $s" }
}
```

Expected: sin salida (los 10 presentes). Notas del patrón `aplicar_anticipo`: la clave generada es `aplicar_anticipo:` (con los dos puntos) → `-SimpleMatch` la distingue de `aplicar_anticipo_manual:`, así ambas se verifican por separado; sin los dos puntos, `aplicar_anticipo` sería subcadena de la manual y una de las dos podría faltar sin que se note.

Cualquier línea `FALTA:` significa que 0018 no aplicó completa → **BLOCKED** (no seguir a `packages/pagos`/webhook/UI con tipos incompletos). Triage:
- Faltan `links_pago`/`anticipos` pero está `mp_payment_id` → falló el bloque `create table` de 0018.
- Faltan las columnas `mp_*` de `empresas` → falló el `alter table empresas` (revisar que el grant sea ADITIVO y no re-declare la lista de 0016).
- Faltan RPCs → falló el bloque de funciones; correr `pnpm supabase db reset` y releer el error de 0018.

Run: `pnpm tsc --noEmit -p packages/db/tsconfig.json` → sin errores.
Run: `pnpm build --concurrency=1` → 3 apps.

- [ ] **Step 2: Commit**

```bash
git add packages/db/src/types.ts
git commit -m "chore(db): tipos regenerados con mercadopago"
```

---

### Task 5: `packages/pagos` — pasarela con Mock y MercadoPago (TDD)

**Files:**
- Create: `packages/pagos/package.json`, `packages/pagos/tsconfig.json`, `packages/pagos/vitest.config.ts`
- Create: `packages/pagos/src/tipos.ts`, `packages/pagos/src/referencia.ts`, `packages/pagos/src/mock.ts`, `packages/pagos/src/mercadopago.ts`, `packages/pagos/src/seleccionar.ts`, `packages/pagos/src/index.ts`
- Create (tests): `packages/pagos/src/referencia.test.ts`, `packages/pagos/src/mock.test.ts`, `packages/pagos/src/mercadopago.test.ts`
- Modify: `apps/erp/package.json` (agrega la dependencia `"@suite/pagos": "workspace:*"` — la consumen el webhook de Task 6 y la UI de Task 8)

**Interfaces:**
- Consumes: globales de Node (`node:crypto`, `Buffer`, `fetch`) resueltos vía `@types/node`/`DOM` como en `@suite/dte` (que NO declara `@types/node` en devDeps — se hereda hoisteado; NO lo agregues). El paquete YA NO descifra: no depende de `@suite/dte` (el descifrado del token vive en el helper de app `pasarelaParaEmpresa`, Task 8). ESPEJO estructural COMPLETO: `packages/dte/` (`package.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts`, `src/tipos.ts`, `src/mock.ts` + sus `*.test.ts`) — léelo antes de escribir. TEMPLATE de formato TDD: Task 4 del Plan 12 (`@suite/core` parsers).
- Produces (LOCKED, spec §4): `interface PasarelaPagos` + tipos (`TipoReferencia`, `ReferenciaPago`, `SolicitudPreferencia`, `Preferencia`, `PagoConsultado`, `EncabezadosFirma`); `armarReferencia`/`parsearReferencia` (round-trip + parseo estricto → null si mal formado); `MockPasarela` + `registrarPagoMock`/`CABECERA_FIRMA_MOCK` (store del mock a nivel de MÓDULO: el simulador escribe con `registrarPagoMock` y el webhook, en otra instancia, lo lee con `obtenerPago`); `MercadoPagoPasarela`; `pasarelaPorAmbiente(ambiente, tokenDescifrado)` (selección por env; recibe el token YA descifrado, NO descifra). Los consumen (tasks posteriores): el helper de app `pasarelaParaEmpresa` (Task 8) que envuelve `pasarelaPorAmbiente` para la Server Action de generación de link (`crearPreferencia` → RPC `crear_link_pago`), el route handler del webhook (`pasarelaPorAmbiente` → `verificarFirma` → `obtenerPago` → despacho) y el simulador mock (`registrarPagoMock` + `CABECERA_FIRMA_MOCK`).
- Decisión — `pasarelaPorAmbiente` NO se unit-testea: es wiring (espeja `proveedorPorAmbiente` de `@suite/dte/src/index.ts`, que tampoco tiene test); su corrección la fija `tsc` + los consumidores aguas abajo. `registrarPagoMock`/`CABECERA_FIRMA_MOCK` tampoco: son el andamiaje dev del simulador y se ejercitan en el click-through E2E (Task 9 Step 3), no en unit. Los 14 tests cubren la lógica pura: referencia (4), Mock (3), firma real + no-logging + armado de preferencia (7).
- Decisión — el token llega DESCIFRADO al constructor de `MercadoPagoPasarela` (nunca lo lee del entorno); `pasarelaPorAmbiente(ambiente, tokenDescifrado)` solo elige Mock vs MercadoPago por env y liga la instancia al token YA descifrado — NO descifra. El descifrado del `mp_access_token_cifrado` vive en el helper de app `pasarelaParaEmpresa` (`apps/erp/lib/pagos.ts`, Task 8), espejo EXACTO de cómo `apps/erp/lib/emision.ts` (`credencialesEmpresa`) arma las credenciales DTE.
- Decisión — `verificarFirma` recibe un reloj inyectable (`ahora: () => number`, default `Date.now`) SOLO para que los tests fijen la ventana de frescura ±5 min; ningún otro estado se inyecta. `ts` de MP se interpreta en segundos Unix (el reloj es la perilla de calibración si MP cambiara la unidad).
- Wiring: `pnpm-workspace.yaml` ya cubre `packages/*` y `turbo.json` corre `test` en todo paquete con ese script — NO se toca ninguno de los dos (verificado: `turbo.json.tasks.test = {}`, sin filtros por paquete). SÍ se toca `apps/erp/package.json`: agrega `"@suite/pagos": "workspace:*"` en `dependencies` (junto a `@suite/dte`) — sin esa entrada pnpm no enlaza el paquete y los imports de Tasks 6/8 fallan. Luego `pnpm install` registra el workspace nuevo y enlaza el bin de `vitest`.

- [ ] **Step 1: Andamiaje del paquete**

`packages/pagos/package.json` (espejo de `packages/dte/package.json`; SIN dependencias de runtime: el paquete ya no descifra, así que no depende de `@suite/dte`):

```json
{
  "name": "@suite/pagos",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": { "test": "vitest run" },
  "devDependencies": { "typescript": "^5.7.0", "vitest": "^3.0.0" }
}
```

`packages/pagos/tsconfig.json` (idéntico a `packages/dte/tsconfig.json`):

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

`packages/pagos/vitest.config.ts` (idéntico a `packages/dte/vitest.config.ts`):

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { environment: 'node' },
})
```

En `apps/erp/package.json`, dentro de `dependencies`, agrega la línea (orden alfabético, junto a las otras `@suite/*`):

```json
    "@suite/pagos": "workspace:*",
```

Run (registra el workspace nuevo y enlaza `vitest`; refresca el PATH primero en una shell nueva de PowerShell 5.1):

```
pnpm install
```

Expected: instala sin errores; `pnpm-lock.yaml` gana la entrada de `@suite/pagos` y `apps/erp` la enlaza como dependencia workspace.

- [ ] **Step 2: Tests que fallan**

`packages/pagos/src/referencia.test.ts` (4 tests — round-trip, ≠4 segmentos, empresa no-uuid, tipo inválido):

```ts
import { describe, expect, it } from 'vitest'
import { armarReferencia, parsearReferencia } from './referencia'
import type { ReferenciaPago } from './tipos'

const E = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
const O = 'aaaa0001-0000-0000-0000-aaaaaaaaaaaa'
const L = 'cccccccc-0000-0000-0000-aaaaaaaaaaaa'

describe('referencia de pago', () => {
  it('round-trip: armar y parsear preserva factura, proforma y cotización', () => {
    for (const tipo of ['factura', 'proforma', 'cotizacion'] as const) {
      const ref: ReferenciaPago = { tipo, empresaId: E, objetoId: O, linkId: L }
      expect(armarReferencia(ref)).toBe(`${tipo}:${E}:${O}:${L}`)
      expect(parsearReferencia(armarReferencia(ref))).toEqual(ref)
    }
  })

  it('una referencia con ≠ 4 segmentos → null', () => {
    expect(parsearReferencia(`factura:${E}:${O}`)).toBe(null)
    expect(parsearReferencia(`factura:${E}:${O}:${L}:extra`)).toBe(null)
  })

  it('empresa_id que no es un uuid → null', () => {
    expect(parsearReferencia(`factura:no-uuid:${O}:${L}`)).toBe(null)
  })

  it('un tipo fuera del enum → null', () => {
    expect(parsearReferencia(`boleta:${E}:${O}:${L}`)).toBe(null)
  })
})
```

`packages/pagos/src/mock.test.ts` (3 tests — crear preferencia, obtener del registro inyectado, verificar firma mock):

```ts
import { describe, expect, it } from 'vitest'
import { MockPasarela } from './mock'
import type { PagoConsultado } from './tipos'

describe('MockPasarela', () => {
  it('crea una preferencia mock- con URL a la página local /mock-pago/', async () => {
    const { preferenciaId, url } = await new MockPasarela().crearPreferencia({
      titulo: 'Factura N° 1',
      monto: 11900,
      externalReference: 'factura:e:o:l',
      urlRetorno: 'https://erp/ok',
    })
    expect(preferenciaId).toMatch(/^mock-/)
    expect(url).toBe('/mock-pago/' + preferenciaId)
  })

  it('obtenerPago devuelve el pago del registro inyectado y null si no existe', async () => {
    const pago: PagoConsultado = { estado: 'approved', monto: 11900, externalReference: 'factura:e:o:l' }
    const mock = new MockPasarela({ 'pay-1': pago })
    expect(await mock.obtenerPago('pay-1')).toEqual(pago)
    expect(await mock.obtenerPago('pay-desconocido')).toBe(null)
  })

  it('verificarFirma acepta el secreto mock y rechaza cualquier otro', () => {
    const mock = new MockPasarela()
    expect(mock.verificarFirma({}, 'data-1', 'mock')).toBe(true)
    expect(mock.verificarFirma({}, 'data-1', 'otro')).toBe(false)
  })
})
```

`packages/pagos/src/mercadopago.test.ts` (7 tests — firma real 4, armado de preferencia 2, no-logging 1). El vector `HMAC_OK` está calculado A MANO con `node:crypto` fuera del código bajo prueba y el primer test lo re-verifica antes de usarlo:

```ts
import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MercadoPagoPasarela } from './mercadopago'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// Vector HMAC calculado A MANO (node crypto, fuera del código bajo prueba):
//   secret   = 'mi-secreto-webhook'
//   manifest = 'id:123456;request-id:req-abc-789;ts:1704908010;'
const SECRETO = 'mi-secreto-webhook'
const DATA_ID = '123456'
const REQUEST_ID = 'req-abc-789'
const TS = '1704908010'
const TS_MS = 1704908010 * 1000
const HMAC_OK = '9bda5031e5458d288acc84092eadc5df02f5db686040e5b004efc27e8ade3ba5'

function headers(v1: string) {
  return { 'x-signature': `ts=${TS},v1=${v1}`, 'x-request-id': REQUEST_ID }
}

describe('MercadoPagoPasarela.verificarFirma', () => {
  it('acepta el vector HMAC conocido dentro de la ventana de frescura', () => {
    // El golden vector ES HMAC-SHA256(secret, manifest) genuino (comprobado aquí).
    const manifest = `id:${DATA_ID};request-id:${REQUEST_ID};ts:${TS};`
    expect(createHmac('sha256', SECRETO).update(manifest).digest('hex')).toBe(HMAC_OK)

    const mp = new MercadoPagoPasarela('token-no-usado', () => TS_MS)
    expect(mp.verificarFirma(headers(HMAC_OK), DATA_ID, SECRETO)).toBe(true)
  })

  it('rechaza una firma con v1 incorrecto', () => {
    const mp = new MercadoPagoPasarela('token', () => TS_MS)
    expect(mp.verificarFirma(headers('00'.repeat(32)), DATA_ID, SECRETO)).toBe(false)
  })

  it('rechaza un ts fuera de la ventana de ±5 min aunque el HMAC calce', () => {
    const mp = new MercadoPagoPasarela('token', () => TS_MS + 6 * 60 * 1000)
    expect(mp.verificarFirma(headers(HMAC_OK), DATA_ID, SECRETO)).toBe(false)
  })

  it('rechaza cuando faltan los headers de firma', () => {
    const mp = new MercadoPagoPasarela('token', () => TS_MS)
    expect(mp.verificarFirma({}, DATA_ID, SECRETO)).toBe(false)
    expect(mp.verificarFirma({ 'x-signature': `ts=${TS},v1=${HMAC_OK}` }, DATA_ID, SECRETO)).toBe(false)
  })
})

describe('MercadoPagoPasarela.crearPreferencia', () => {
  it('envía título, monto y external_reference a /checkout/preferences con Bearer del token', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ id: 'pref-123', init_point: 'https://mp/checkout?pref=pref-123' }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    await new MercadoPagoPasarela('TOKEN-XYZ').crearPreferencia({
      titulo: 'Factura N° 42',
      monto: 11900,
      externalReference: 'factura:e:o:l',
      urlRetorno: 'https://erp/ok',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { method: string; headers: Record<string, string>; body: string },
    ]
    expect(url).toBe('https://api.mercadopago.com/checkout/preferences')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer TOKEN-XYZ')
    const body = JSON.parse(init.body)
    expect(body.items[0].title).toBe('Factura N° 42')
    expect(body.items[0].unit_price).toBe(11900)
    expect(body.external_reference).toBe('factura:e:o:l')
  })

  it('devuelve el preferenciaId y la url (init_point) que responde MercadoPago', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ id: 'pref-999', init_point: 'https://mp/checkout?pref=pref-999' }),
      })),
    )
    const pref = await new MercadoPagoPasarela('t').crearPreferencia({
      titulo: 'x',
      monto: 1000,
      externalReference: 'proforma:e:o:l',
      urlRetorno: 'https://erp/ok',
    })
    expect(pref).toEqual({ preferenciaId: 'pref-999', url: 'https://mp/checkout?pref=pref-999' })
  })
})

describe('MercadoPagoPasarela: no filtra secretos en los logs', () => {
  it('ante un error HTTP loguea solo el mensaje saneado, jamás el token ni el Bearer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const mp = new MercadoPagoPasarela('TOKEN-SUPER-SECRETO')

    await expect(mp.obtenerPago('pay-1')).rejects.toThrow()

    const loggeado = errSpy.mock.calls.flat().join(' ')
    expect(loggeado).toContain('500')
    expect(loggeado).not.toContain('TOKEN-SUPER-SECRETO')
    expect(loggeado).not.toContain('Bearer')
  })
})
```

- [ ] **Step 3: Verificar que fallan**

Run: `pnpm --filter @suite/pagos test`
Expected: FAIL — `Cannot find module './referencia'` / `'./mock'` / `'./mercadopago'` (los módulos de implementación aún no existen).

- [ ] **Step 4: Implementación**

`packages/pagos/src/tipos.ts` (interface LOCKED del spec §4 + tipos de apoyo):

```ts
// Contrato del adaptador de pagos (spec §4). PasarelaPagos abstrae MercadoPago
// para que la app opere igual contra el Mock (dev/E2E) y contra el proveedor
// real, seleccionados por env como el proveedor DTE.

// Tipo del segmento `tipo` del external_reference: el origen del link de pago.
export type TipoReferencia = 'factura' | 'proforma' | 'cotizacion'

// external_reference despiezado: "{tipo}:{empresaId}:{objetoId}:{linkId}".
export interface ReferenciaPago {
  tipo: TipoReferencia
  empresaId: string
  objetoId: string
  linkId: string
}

export interface SolicitudPreferencia {
  titulo: string
  monto: number
  externalReference: string
  urlRetorno: string
}

export interface Preferencia {
  preferenciaId: string
  url: string
}

// Lo mínimo que el webhook necesita de un pago consultado a MP. `estado` es el
// status crudo de MP ('approved' | 'pending' | 'rejected' | ...); el webhook
// solo actúa sobre 'approved'.
export interface PagoConsultado {
  estado: string
  monto: number
  externalReference: string
}

// Headers relevantes para verificar la firma del webhook. En el route handler
// se arman con request.headers.get(...), que devuelve string | null.
export interface EncabezadosFirma {
  'x-signature'?: string | null
  'x-request-id'?: string | null
}

export interface PasarelaPagos {
  crearPreferencia(solicitud: SolicitudPreferencia): Promise<Preferencia>
  obtenerPago(mpPaymentId: string): Promise<PagoConsultado | null>
  verificarFirma(headers: EncabezadosFirma, dataId: string, secret: string): boolean
}
```

`packages/pagos/src/referencia.ts` (armar + parseo estricto de 4 segmentos / enum / uuids):

```ts
import type { ReferenciaPago, TipoReferencia } from './tipos'

const TIPOS: readonly TipoReferencia[] = ['factura', 'proforma', 'cotizacion']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function esTipoReferencia(v: string): v is TipoReferencia {
  return (TIPOS as readonly string[]).includes(v)
}

// "{tipo}:{empresaId}:{objetoId}:{linkId}" (~120 chars < 256 de MP).
export function armarReferencia(ref: ReferenciaPago): string {
  return `${ref.tipo}:${ref.empresaId}:${ref.objetoId}:${ref.linkId}`
}

// Parseo ESTRICTO: exactamente 4 segmentos, tipo en el enum y los 3 ids uuids
// válidos. Cualquier desviación → null (el webhook lo convierte en 200 no-op:
// una referencia mal formada nunca dispara un registro de dinero).
export function parsearReferencia(texto: string): ReferenciaPago | null {
  const seg = texto.split(':')
  if (seg.length !== 4) return null
  const [tipo, empresaId, objetoId, linkId] = seg
  if (tipo === undefined || empresaId === undefined || objetoId === undefined || linkId === undefined) {
    return null
  }
  if (!esTipoReferencia(tipo)) return null
  if (!UUID.test(empresaId) || !UUID.test(objetoId) || !UUID.test(linkId)) return null
  return { tipo, empresaId, objetoId, linkId }
}
```

`packages/pagos/src/mock.ts` (patrón `MockDTE`; registro inyectable; firma mock):

```ts
import { randomUUID } from 'node:crypto'
import type {
  EncabezadosFirma,
  PagoConsultado,
  PasarelaPagos,
  Preferencia,
  SolicitudPreferencia,
} from './tipos'

// Store a nivel de MÓDULO: el simulador (Server Action, solo dev) escribe con
// registrarPagoMock y el webhook, en OTRA instancia de MockPasarela, lo lee con
// obtenerPago. Un registro por-instancia no cruzaría ese límite proceso→proceso.
const STORE: Record<string, PagoConsultado> = {}

// Cabeceras de firma que MockPasarela.verificarFirma acepta (ignora su contenido:
// solo el secret === 'mock' importa). El simulador las manda al webhook real.
export const CABECERA_FIRMA_MOCK: Record<string, string> = {
  'x-signature': 'mock',
  'x-request-id': 'mock',
}

// El simulador registra un pago aprobado en el store del módulo; el webhook lo
// consulta después con obtenerPago(mpPaymentId). Solo dev (modo mock).
export function registrarPagoMock(pago: {
  mpPaymentId: string
  monto: number
  externalReference: string
}): void {
  STORE[pago.mpPaymentId] = {
    estado: 'approved',
    monto: pago.monto,
    externalReference: pago.externalReference,
  }
}

// Pasarela simulada (patrón MockDTE): opera el ciclo completo sin credenciales.
// crearPreferencia devuelve una URL a la página local /mock-pago/[id] (solo dev)
// que dispara el webhook REAL con firma mock. obtenerPago lee el registro
// inyectado por constructor (unit tests) y, si no está, el store de módulo que
// alimenta registrarPagoMock (simulador → webhook).
export class MockPasarela implements PasarelaPagos {
  constructor(private readonly registro: Record<string, PagoConsultado> = {}) {}

  async crearPreferencia(_solicitud: SolicitudPreferencia): Promise<Preferencia> {
    const preferenciaId = 'mock-' + randomUUID()
    return { preferenciaId, url: '/mock-pago/' + preferenciaId }
  }

  async obtenerPago(mpPaymentId: string): Promise<PagoConsultado | null> {
    return this.registro[mpPaymentId] ?? STORE[mpPaymentId] ?? null
  }

  verificarFirma(_headers: EncabezadosFirma, _dataId: string, secret: string): boolean {
    return secret === 'mock'
  }
}
```

`packages/pagos/src/mercadopago.ts` (Checkout Pro; firma x-signature; logging saneado):

```ts
import { createHmac, timingSafeEqual } from 'node:crypto'
import type {
  EncabezadosFirma,
  PagoConsultado,
  PasarelaPagos,
  Preferencia,
  SolicitudPreferencia,
} from './tipos'

const BASE = 'https://api.mercadopago.com'
const FRESCURA_MS = 5 * 60 * 1000

// Adaptador de MercadoPago Checkout Pro. El access token llega DESCIFRADO por el
// constructor (nunca lo lee del entorno). `ahora` es inyectable SOLO para que los
// tests fijen la ventana de frescura de la firma; en producción es Date.now.
export class MercadoPagoPasarela implements PasarelaPagos {
  constructor(
    private readonly token: string,
    private readonly ahora: () => number = () => Date.now(),
  ) {}

  async crearPreferencia(solicitud: SolicitudPreferencia): Promise<Preferencia> {
    const data = await this.pedir('POST', '/checkout/preferences', {
      items: [{ title: solicitud.titulo, quantity: 1, unit_price: solicitud.monto, currency_id: 'CLP' }],
      external_reference: solicitud.externalReference,
      back_urls: { success: solicitud.urlRetorno },
      auto_return: 'approved',
    })
    return { preferenciaId: String(data.id), url: String(data.init_point) }
  }

  async obtenerPago(mpPaymentId: string): Promise<PagoConsultado | null> {
    const data = await this.pedir('GET', `/v1/payments/${encodeURIComponent(mpPaymentId)}`)
    if (data.status == null) return null
    return {
      estado: String(data.status),
      monto: Math.round(Number(data.transaction_amount)),
      externalReference: String(data.external_reference ?? ''),
    }
  }

  // Esquema x-signature de MP: el header trae `ts=<unix>,v1=<hmac hex>`. Se
  // reconstruye el manifest `id:{data.id};request-id:{x-request-id};ts:{ts};`,
  // se calcula HMAC-SHA256(secret) y se compara contra v1 en tiempo constante.
  // Rechaza si faltan headers, si el ts sale de ±5 min o si el HMAC no calza.
  verificarFirma(headers: EncabezadosFirma, dataId: string, secret: string): boolean {
    const firma = headers['x-signature']
    const requestId = headers['x-request-id']
    if (!firma || !requestId) return false

    const partes = new Map<string, string>()
    for (const trozo of firma.split(',')) {
      const i = trozo.indexOf('=')
      if (i > 0) partes.set(trozo.slice(0, i).trim(), trozo.slice(i + 1).trim())
    }
    const ts = partes.get('ts')
    const v1 = partes.get('v1')
    if (!ts || !v1) return false

    // ts de MP es un timestamp Unix en segundos; el reloj inyectable es la
    // perilla de calibración si MP cambiara la unidad.
    const tsMs = Number(ts) * 1000
    if (!Number.isFinite(tsMs) || Math.abs(this.ahora() - tsMs) > FRESCURA_MS) return false

    const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`
    const esperado = Buffer.from(createHmac('sha256', secret).update(manifest).digest('hex'), 'hex')
    const recibido = Buffer.from(v1, 'hex')
    return esperado.length === recibido.length && timingSafeEqual(esperado, recibido)
  }

  // Cliente HTTP mínimo. LOGGING: jamás headers, config ni body — solo el
  // error.message saneado (un test lo fija). El Bearer del token nunca se loguea.
  private async pedir(
    metodo: string,
    ruta: string,
    cuerpo?: unknown,
  ): Promise<Record<string, unknown>> {
    try {
      const res = await fetch(BASE + ruta, {
        method: metodo,
        headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
        body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      })
      if (!res.ok) throw new Error(`MercadoPago respondió ${res.status}`)
      return (await res.json()) as Record<string, unknown>
    } catch (error) {
      console.error('MercadoPago:', error instanceof Error ? error.message : 'error desconocido')
      throw error
    }
  }
}
```

`packages/pagos/src/seleccionar.ts` (selección por env — espejo de `proveedorPorAmbiente`; recibe el token YA descifrado, NO descifra):

```ts
import { MercadoPagoPasarela } from './mercadopago'
import { MockPasarela } from './mock'
import type { PasarelaPagos } from './tipos'

// Selección por env (patrón de proveedorPorAmbiente en @suite/dte). 'mock' opera
// sin credenciales; 'mercadopago' liga la pasarela al token de la empresa que
// llega YA descifrado (el descifrado vive en el helper de app pasarelaParaEmpresa
// de apps/erp/lib/pagos.ts, espejo de credencialesEmpresa). El ambiente lo pasa
// el llamador (process.env.PASARELA_PAGOS). Env desconocida → error claro.
export function pasarelaPorAmbiente(ambiente: string | undefined, tokenDescifrado: string): PasarelaPagos {
  const pasarela = ambiente ?? 'mock'
  if (pasarela === 'mock') return new MockPasarela()
  if (pasarela !== 'mercadopago') {
    throw new Error(`Pasarela de pagos desconocida: ${pasarela}`)
  }
  return new MercadoPagoPasarela(tokenDescifrado)
}
```

`packages/pagos/src/index.ts` (barrel — espejo de `packages/dte/src/index.ts`):

```ts
export * from './tipos'
export { armarReferencia, parsearReferencia } from './referencia'
export { MockPasarela, registrarPagoMock, CABECERA_FIRMA_MOCK } from './mock'
export { MercadoPagoPasarela } from './mercadopago'
export { pasarelaPorAmbiente } from './seleccionar'
```

- [ ] **Step 5: Verificar que pasan**

Run: `pnpm --filter @suite/pagos test`
Expected: PASS — **14 tests** (referencia 4, mock 3, mercadopago 7: firma 4 + armado 2 + no-logging 1).

Run: `pnpm --filter @suite/pagos exec tsc --noEmit -p tsconfig.json`
Expected: sin errores — fuente Y tests compilan estrictos (`strict` + `noUncheckedIndexedAccess`).

Run: `pnpm test`
Expected: **152 tests** (core 126, auth 2, dte 10, pagos 14).

Byte-scan (CERO BOM literal en los archivos nuevos; el BOM UTF-8 son los bytes `EF BB BF`; salida vacía / exit 1 = pass):

```
grep -rlP '\xEF\xBB\xBF' packages/pagos ; echo "exit=$? (1 = sin BOM = pass)"
```

Expected: sin rutas listadas, `exit=1`.

- [ ] **Step 6: Wiring (sin cambios en turbo/workspace)**

`pnpm-workspace.yaml` ya declara `packages/*` y `turbo.json` corre `test` en todo paquete con el script (`tasks.test = {}`, sin filtros por paquete) — NO se editan. Verificación de que `turbo run test` toma el paquete nuevo:

```
pnpm test --filter @suite/pagos
```

Expected: turbo ejecuta la task `test` de `@suite/pagos` (14 verdes) sin tocar `turbo.json`.

- [ ] **Step 7: Commit**

```bash
git add packages/pagos pnpm-lock.yaml
git commit -m "feat(pagos): pasarela de pagos con MockPasarela y adaptador MercadoPago (TDD)"
```

---

### Task 6: Webhook por empresa + simulador mock + hook de aplicación de anticipos

**Files:**
- Create: `apps/erp/app/api/webhooks/mercadopago/[empresaId]/route.ts`, `apps/erp/app/mock-pago/[id]/page.tsx`, `apps/erp/app/mock-pago/[id]/acciones.ts`, `apps/erp/componentes/formulario-mock-pago.tsx`
- Modify: `apps/erp/lib/emision.ts` (helper `aplicarAnticipoDocumento` nunca-lanza), `apps/erp/app/ventas/emitir.ts` (llamada en el bloque `emitido`), `apps/erp/middleware.ts` (excluir del auth-redirect las dos rutas públicas), `apps/erp/.env.example` (documentar `PASARELA_PAGOS`)

**Interfaces:**
- Consumes de **`@suite/pagos`** (creado por la task de `packages/pagos`; ESA task es la fuente de verdad de estos nombres — este archivo declara el contrato que consume): `pasarelaPorAmbiente(ambiente: string | undefined, token: string): PasarelaPagos` (selección por env, patrón `proveedorPorAmbiente` de `@suite/dte`; instancia ligada al token de la empresa); `PasarelaPagos.verificarFirma(headers: { 'x-signature'?: string | null; 'x-request-id'?: string | null }, dataId: string, secret: string): boolean` (objeto plano tipo `EncabezadosFirma`, NO el `Headers` de Fetch — el route lo arma con `.get()`); `PasarelaPagos.obtenerPago(mpPaymentId: string): Promise<{ estado: string; monto: number; externalReference: string } | null>`; `parsearReferencia(ref: string): { tipo: 'factura' | 'proforma' | 'cotizacion'; empresaId: string; objetoId: string; linkId: string } | null` (estricto: 4 segmentos, tipo en enum, UUIDs válidos — malformado → `null`); `armarReferencia(p: { tipo: 'factura' | 'proforma' | 'cotizacion'; empresaId: string; objetoId: string; linkId: string }): string`; `registrarPagoMock(p: { mpPaymentId: string; monto: number; externalReference: string }): void` (escribe un pago `approved` en el store en memoria del mock — solo dev; lo lee `obtenerPago` del webhook); `CABECERA_FIRMA_MOCK: Record<string, string>` (cabeceras de firma que `MockPasarela.verificarFirma` acepta).
- Consumes existentes: `clienteAdmin` de `@suite/auth/admin` (service_role; el webhook y el simulador NO tienen sesión); `descifrar` de `@suite/dte`; `formatearCLP` de `@suite/core`; `@suite/ui` (`Boton`, `Encabezado`, `Tarjeta`); tipos `@suite/db` regenerados (task de tipos: tablas `links_pago`/`anticipos` y RPCs `registrar_pago_mp`/`registrar_anticipo_mp`/`aplicar_anticipo`). `@suite/pagos` es **server-only** (se usa solo en el route handler y en las Server Actions, igual que `@suite/dte`) → NO requiere entrar en `transpilePackages` de `next.config.ts`.
- Espejos estructurales OBLIGATORIOS (léelos completos antes de escribir): `apps/erp/lib/emision.ts` (`registrarMovimientosDocumento` — el patrón exacto "NUNCA lanza": `try` + `clienteAdmin` + `admin.rpc` + `console.error` del `error.message`, y el `catch` que también loguea); `apps/erp/app/reportes/libro-ventas/export/route.ts` (forma de un route handler que devuelve `Response`); `apps/erp/app/configuracion/dte/acciones.ts` (Server Action con `clienteAdmin`/descifrado y validaciones).
- Produces: webhook público `POST /api/webhooks/mercadopago/[empresaId]` con el ORDEN EXACTO del spec §5 y el mapeo 200/500 enumerado del spec §2; página `/mock-pago/[id]` + Server Action `simularPago` (solo dev, `PASARELA_PAGOS==='mock'`); helper `aplicarAnticipoDocumento(empresaId, documentoId)` en `lib/emision.ts` (nunca-lanza) llamado por `emitirDocumento` en el bloque `emitido`.
- **Decisión — middleware (hallazgo que rompe el webhook si se omite):** `apps/erp/middleware.ts` corre `actualizarSesion`, que REDIRIGE a `/login` toda petición sin sesión, y su `matcher` cubre TODO salvo `_next/static|_next/image|favicon.ico`. El webhook es `POST público` (§5) y `/mock-pago` lo abre el pagador (sin cuenta ERP) → ambos serían redirigidos a `/login` y jamás llegarían al handler (el `fetch` del simulador seguiría el 302 y `respuesta.ok` sería un falso positivo). Fix mínimo: sumar `api/webhooks|mock-pago` al negative-lookahead del matcher. La page además se auto-gatea por env (`notFound()`), así que en producción la ruta pública no existe.
- **Decisión — 200 vs 500 (§2, enumerado y codificado como comentario + código):** 200 no-op (MP NO reintenta): `empresaId` no-uuid, body no parseable / sin `data.id`, empresa inexistente, empresa sin credenciales, firma inválida o vencida, pago no aprobado, pago inexistente, `external_reference` malformado o con empresa ≠ URL, validación de la RPC (origen inexistente/ajeno = SQLSTATE `P0001`). 500 (MP reintenta): red/5xx al consultar el pago, fallo de descifrado, error de BD. Todo no-op **sobre un pago APROBADO** emite `console.error` de **ALERTA** (un peso aprobado jamás queda solo en un log de paso).
- **Decisión — id de pago determinista en el mock:** el simulador usa `mpPaymentId = 'mock-pay-' + link.id` y lee el link de la BD (no del store del mock, que es por-proceso y no sobrevive un restart del dev server). Re-simular reusa el MISMO id → la idempotencia por `mp_payment_id` del webhook lo dedup (el propio simulador demuestra la idempotencia).
- **Cuidado (Plan 11):** el bloque `try/catch` de `emitirDocumento` gira alrededor de `folioPersistido`/el claim atómico; la ÚNICA edición aquí es sumar la llamada al helper DENTRO del `if (estado === 'emitido')` existente, DESPUÉS de `registrarMovimientosDocumento`. No se toca nada del claim ni del folio.

- [ ] **Step 1: Helper `aplicarAnticipoDocumento` (nunca-lanza) en `lib/emision.ts`**

En `apps/erp/lib/emision.ts`, agrega esta función DESPUÉS de `registrarMovimientosDocumento` (antes del `export { CODIGO_SII, proveedorPorAmbiente }` final). `clienteAdmin` ya está importado en la línea 2 — no se agregan imports.

```ts
// Aplica un anticipo `recibido` a la factura recién emitida cuyo origen (proforma/cotización)
// enlaza a ese documento. Delegado a la RPC aplicar_anticipo (solo service_role): bajo lock del
// documento aplica el anticipo hasta el saldo con un pago método 'mercadopago'; sin anticipo, no-op.
// NUNCA lanza — espejo de registrarMovimientosDocumento: si lanzara, el catch de emitirDocumento
// revertiría un DTE ya vivo (re-emisión con el mismo folio). El fallo best-effort se recupera con
// el botón "Aplicar" manual de /cobranza (que también cubre la emisión anterior al webhook).
export async function aplicarAnticipoDocumento(empresaId: string, documentoId: string): Promise<void> {
  try {
    const admin = clienteAdmin()
    const { error } = await admin.rpc('aplicar_anticipo', {
      p_empresa: empresaId,
      p_documento: documentoId,
    })
    if (error) console.error('aplicarAnticipoDocumento:', error.message)
  } catch (e) {
    console.error('aplicarAnticipoDocumento:', e)
  }
}
```

- [ ] **Step 2: Llamar el hook en `emitirDocumento` (diff exacto contra el archivo real)**

En `apps/erp/app/ventas/emitir.ts`, dos cambios quirúrgicos: el import (línea 9) y la llamada dentro del bloque `emitido` existente (líneas 127-135). El resto del archivo (claim atómico, `folioPersistido`, `catch`) queda intacto.

```diff
-import { credencialesEmpresa, registrarMovimientosDocumento } from '../../lib/emision'
+import { aplicarAnticipoDocumento, credencialesEmpresa, registrarMovimientosDocumento } from '../../lib/emision'
```

```diff
     if (estado === 'emitido') {
       await registrarMovimientosDocumento(
         activa.id,
         id,
         (lineas ?? []).map((l) => ({ producto_id: l.producto_id, cantidad: l.cantidad })),
         -1,
         'Venta ' + tipo + ' folio ' + folio
       )
+      // Anticipo recibido por un link de pago sobre la proforma/cotización de origen: se aplica
+      // solo al emitirse la factura. NUNCA lanza (espejo de registrarMovimientosDocumento): si
+      // lanzara, el catch revertiría un DTE vivo. Fallo best-effort → botón "Aplicar" en /cobranza.
+      await aplicarAnticipoDocumento(activa.id, id)
     }
```

`emitirNotaCredito` NO se toca: los anticipos se aplican a la factura del origen, jamás a una nota de crédito.

- [ ] **Step 3: Webhook por empresa `apps/erp/app/api/webhooks/mercadopago/[empresaId]/route.ts`**

```ts
import { clienteAdmin } from '@suite/auth/admin'
import { descifrar } from '@suite/dte'
import { pasarelaPorAmbiente, parsearReferencia } from '@suite/pagos'

// Webhook de MercadoPago POR EMPRESA (Plan 13, spec §5). POST público: MP no trae sesión, y la
// empresa viaja en la URL porque el payload de MP solo trae data.id (fuera de banda). El dinero se
// registra vía service_role (clienteAdmin). Idempotente por mp_payment_id (dentro de la RPC).
//
// Mapeo 200 vs 500 (spec §2, ENUMERADO):
//  200 no-op (MP NO reintenta): empresaId no-uuid; body no parseable o sin data.id; empresa
//      inexistente; empresa sin credenciales; firma inválida o vencida; pago no aprobado; pago
//      inexistente; external_reference malformado o con empresa != URL; validación de la RPC
//      (origen inexistente/ajeno, SQLSTATE P0001).
//  500 (MP reintenta): red/5xx al consultar el pago; fallo de descifrado; error de BD.
// Todo no-op sobre un pago APROBADO emite console.error de ALERTA: un peso aprobado jamás puede
// quedar solo en un log de paso.

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function clave(): string {
  const k = process.env.DTE_ENCRYPTION_KEY
  if (!k) throw new Error('Falta DTE_ENCRYPTION_KEY')
  return k
}

// MP notifica con { data: { id } } en el body (webhooks v2) o ?data.id= en la query (IPN legacy).
function extraerDataId(cuerpo: unknown, url: string): string | null {
  const id = (cuerpo as { data?: { id?: unknown } } | null)?.data?.id
  if (typeof id === 'string' && id !== '') return id
  if (typeof id === 'number') return String(id)
  const qp = new URL(url).searchParams.get('data.id')
  return qp && qp !== '' ? qp : null
}

export async function POST(req: Request, { params }: { params: Promise<{ empresaId: string }> }) {
  const { empresaId } = await params

  // (1) Empresa desde la URL: uuid válido o no-op.
  if (!RE_UUID.test(empresaId)) {
    console.error('webhook mercadopago: empresaId de la URL no es un uuid válido:', empresaId)
    return new Response(null, { status: 200 })
  }

  let cuerpo: unknown = null
  try {
    cuerpo = await req.json()
  } catch {
    cuerpo = null
  }
  const dataId = extraerDataId(cuerpo, req.url)
  if (!dataId) {
    console.error('webhook mercadopago: cuerpo sin data.id para la empresa', empresaId)
    return new Response(null, { status: 200 })
  }

  const admin = clienteAdmin()

  // (2) Credenciales cifradas de ESA empresa (service_role: el endpoint no tiene sesión).
  const { data: emp, error: eEmp } = await admin
    .from('empresas')
    .select('mp_access_token_cifrado, mp_webhook_secret_cifrado')
    .eq('id', empresaId)
    .maybeSingle()
  if (eEmp) {
    console.error('webhook mercadopago: error de BD al cargar credenciales:', eEmp.message)
    return new Response(null, { status: 500 })
  }
  if (!emp) {
    console.error('webhook mercadopago: empresa inexistente:', empresaId)
    return new Response(null, { status: 200 })
  }
  if (!emp.mp_access_token_cifrado || !emp.mp_webhook_secret_cifrado) {
    console.error('webhook mercadopago: empresa sin credenciales de MercadoPago:', empresaId)
    return new Response(null, { status: 200 })
  }

  let token: string
  let secret: string
  try {
    const k = clave()
    token = descifrar(emp.mp_access_token_cifrado, k).toString('utf8')
    secret = descifrar(emp.mp_webhook_secret_cifrado, k).toString('utf8')
  } catch {
    // Descifrado fallido (clave del servidor mal configurada): transitorio → MP reintenta.
    console.error('webhook mercadopago: fallo al descifrar credenciales de', empresaId)
    return new Response(null, { status: 500 })
  }

  const pasarela = pasarelaPorAmbiente(process.env.PASARELA_PAGOS, token)

  // (3) Firma x-signature (HMAC ts+v1, frescura ±5 min). Inválida o vencida → no-op.
  // req.headers es un Headers de Fetch: sus valores salen por .get(), no por corchete;
  // se arma el objeto plano EncabezadosFirma que verificarFirma indexa.
  if (
    !pasarela.verificarFirma(
      { 'x-signature': req.headers.get('x-signature'), 'x-request-id': req.headers.get('x-request-id') },
      dataId,
      secret,
    )
  ) {
    console.error('webhook mercadopago: firma inválida o vencida para', empresaId)
    return new Response(null, { status: 200 })
  }

  // (4) Consulta el pago con el token de la empresa. Red/5xx → 500 (MP reintenta).
  let pago: { estado: string; monto: number; externalReference: string } | null
  try {
    pago = await pasarela.obtenerPago(dataId)
  } catch (e) {
    console.error('webhook mercadopago: error al consultar el pago:', e instanceof Error ? e.message : 'desconocido')
    return new Response(null, { status: 500 })
  }
  if (!pago) {
    console.error('webhook mercadopago: pago inexistente en MercadoPago:', dataId)
    return new Response(null, { status: 200 })
  }

  // (5) Solo pagos aprobados producen registro.
  if (pago.estado !== 'approved') {
    console.error('webhook mercadopago: pago no aprobado (' + pago.estado + ') para', empresaId)
    return new Response(null, { status: 200 })
  }

  // (6) external_reference DEL PAGO (única fuente). Formato estricto; su empresa == la de la URL.
  const ref = parsearReferencia(pago.externalReference)
  if (!ref) {
    console.error('ALERTA webhook mercadopago: pago APROBADO con external_reference inválido, sin registrar:', empresaId, dataId)
    return new Response(null, { status: 200 })
  }
  if (ref.empresaId !== empresaId) {
    console.error('ALERTA webhook mercadopago: pago APROBADO cuya empresa no coincide con la URL, sin registrar:', empresaId, dataId)
    return new Response(null, { status: 200 })
  }

  // (7) Despacho con el MONTO DEL PAGO (service_role). Factura -> pago; proforma/cotización -> anticipo.
  let eRpc
  if (ref.tipo === 'factura') {
    const { error } = await admin.rpc('registrar_pago_mp', {
      p_empresa: empresaId,
      p_documento: ref.objetoId,
      p_monto: pago.monto,
      p_mp_payment_id: dataId,
      p_link: ref.linkId,
    })
    eRpc = error
  } else {
    const { error } = await admin.rpc('registrar_anticipo_mp', {
      p_empresa: empresaId,
      p_origen_tipo: ref.tipo,
      p_origen: ref.objetoId,
      p_monto: pago.monto,
      p_mp_payment_id: dataId,
      p_link: ref.linkId,
    })
    eRpc = error
  }
  if (eRpc) {
    // Validación de la RPC (origen inexistente/ajeno) = SQLSTATE P0001: permanente -> no-op + alerta.
    if (eRpc.code === 'P0001') {
      console.error('ALERTA webhook mercadopago: pago APROBADO rechazado por la RPC, sin registrar:', empresaId, eRpc.message)
      return new Response(null, { status: 200 })
    }
    // Error de BD/infra: transitorio -> 500 para que MP reintente.
    console.error('webhook mercadopago: error de BD al registrar; MP reintentará:', empresaId, eRpc.message)
    return new Response(null, { status: 500 })
  }

  return new Response(null, { status: 200 })
}
```

- [ ] **Step 4: Server Action del simulador `apps/erp/app/mock-pago/[id]/acciones.ts`**

```ts
'use server'

import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { clienteAdmin } from '@suite/auth/admin'
import { armarReferencia, registrarPagoMock, CABECERA_FIRMA_MOCK } from '@suite/pagos'

// Estado type-only de la action (permitido en un archivo 'use server': los tipos se borran).
export type EstadoMockPago = { ok?: boolean; error?: string }

export async function simularPago(_prev: EstadoMockPago, formData: FormData): Promise<EstadoMockPago> {
  // Defensa en profundidad: el simulador solo existe en modo mock (la page ya hace notFound()).
  if (process.env.PASARELA_PAGOS !== 'mock') return { error: 'El simulador de pagos no está disponible' }

  const preferenciaId = String(formData.get('preferencia_id') ?? '')
  // El pagador no tiene sesión: admin (service_role) para leer el link por su preferencia.
  const admin = clienteAdmin()
  const { data: link } = await admin
    .from('links_pago')
    .select('id, empresa_id, origen_tipo, origen_id, monto')
    .eq('preferencia_id', preferenciaId)
    .maybeSingle()
  if (!link) return { error: 'No se encontró el link de pago' }

  // external_reference con el MISMO formato estricto que parsea el webhook (empresa == la de la URL).
  const externalReference = armarReferencia({
    tipo: link.origen_tipo as 'factura' | 'proforma' | 'cotizacion',
    empresaId: link.empresa_id,
    objetoId: link.origen_id,
    linkId: link.id,
  })
  // Id determinista por link: re-simular reusa el MISMO id -> el webhook lo dedup (idempotencia).
  const mpPaymentId = 'mock-pay-' + link.id
  // Store en memoria del mock: que obtenerPago(id) del webhook devuelva este pago aprobado.
  registrarPagoMock({ mpPaymentId, monto: link.monto, externalReference })

  const h = await headers()
  const host = h.get('host') ?? ''
  const proto = h.get('x-forwarded-proto') ?? 'http'
  // POST al webhook REAL de la empresa: ejercita la URL por empresa y todo el flujo (firma incluida).
  let respuesta: Response
  try {
    respuesta = await fetch(`${proto}://${host}/api/webhooks/mercadopago/${link.empresa_id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...CABECERA_FIRMA_MOCK },
      body: JSON.stringify({ data: { id: mpPaymentId } }),
      cache: 'no-store',
    })
  } catch {
    return { error: 'No se pudo contactar el webhook' }
  }
  if (!respuesta.ok) return { error: `El webhook respondió ${respuesta.status}` }
  revalidatePath('/mock-pago/' + preferenciaId)
  return { ok: true }
}
```

- [ ] **Step 5: Botón del simulador `apps/erp/componentes/formulario-mock-pago.tsx`**

```tsx
'use client'

import { useActionState } from 'react'
import { Boton } from '@suite/ui'
import type { EstadoMockPago } from '../app/mock-pago/[id]/acciones'

export function FormularioMockPago({
  accion,
  preferenciaId,
}: {
  accion: (prev: EstadoMockPago, formData: FormData) => Promise<EstadoMockPago>
  preferenciaId: string
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoMockPago)
  return (
    <form action={enviar}>
      <input type="hidden" name="preferencia_id" value={preferenciaId} />
      {estado.ok ? (
        <p className="text-sm font-medium text-green-700">Pago simulado enviado. Revisa Cobranza.</p>
      ) : (
        <Boton type="submit" disabled={pendiente}>
          {pendiente ? 'Procesando…' : 'Simular pago aprobado'}
        </Boton>
      )}
      {estado.error && <p className="mt-2 text-sm text-red-600">{estado.error}</p>}
    </form>
  )
}
```

- [ ] **Step 6: Página del simulador `apps/erp/app/mock-pago/[id]/page.tsx`**

```tsx
import { notFound } from 'next/navigation'
import { clienteAdmin } from '@suite/auth/admin'
import { formatearCLP } from '@suite/core'
import { Encabezado, Tarjeta } from '@suite/ui'
import { FormularioMockPago } from '../../../componentes/formulario-mock-pago'
import { simularPago } from './acciones'

export default async function MockPago({ params }: { params: Promise<{ id: string }> }) {
  // Simulador SOLO dev: fuera de modo mock la ruta no existe.
  if (process.env.PASARELA_PAGOS !== 'mock') notFound()
  const { id } = await params
  // El pagador no tiene sesión ERP: admin (service_role) para leer el link por su preferencia.
  const admin = clienteAdmin()
  const { data: link } = await admin
    .from('links_pago')
    .select('id, empresa_id, origen_tipo, origen_id, monto, estado')
    .eq('preferencia_id', id)
    .maybeSingle()
  if (!link) notFound()

  return (
    <div className="mx-auto max-w-lg p-8">
      <Encabezado titulo="Pago simulado (MercadoPago)" />
      <Tarjeta>
        <p className="text-sm text-slate-600">Entorno de prueba: no se cobra dinero real.</p>
        <p className="mt-4 text-3xl font-semibold text-slate-900">{formatearCLP(link.monto)}</p>
        <p className="mt-1 text-sm text-slate-500">
          {link.estado === 'pagado'
            ? 'Este link ya figura como pagado; volver a simular no duplica el pago.'
            : 'Presiona el botón para simular un pago aprobado.'}
        </p>
        <div className="mt-6">
          <FormularioMockPago accion={simularPago} preferenciaId={id} />
        </div>
      </Tarjeta>
    </div>
  )
}
```

- [ ] **Step 7: Middleware — dejar pasar el webhook y el simulador (diff exacto)**

`apps/erp/middleware.ts`: sin el fix, `actualizarSesion` redirige a `/login` toda petición sin sesión y el matcher cubre estas rutas → el webhook público y `/mock-pago` nunca llegarían al handler.

```diff
 export const config = {
-  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
+  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/webhooks|mock-pago).*)'],
 }
```

- [ ] **Step 8: Documentar `PASARELA_PAGOS` en `.env.example`**

`apps/erp/.env.example` documenta hoy `DTE_ENCRYPTION_KEY`/`DTE_AMBIENTE`. Agrega la variable que selecciona la pasarela: sin ella el webhook y la Server Action caen a `MockPasarela` (default `mock`). Un deploy real que la olvide sirve links Mock muertos, así que debe estar documentada:

```
# Pasarela de pagos: 'mock' (default, sin credenciales reales) o 'mercadopago'.
PASARELA_PAGOS=mock
```

- [ ] **Step 9: Verificar y commit**

Requisito previo: `@suite/pagos` (task de `packages/pagos`) y los tipos `@suite/db` regenerados ya deben existir (RPCs `registrar_pago_mp`/`registrar_anticipo_mp`/`aplicar_anticipo` y tabla `links_pago`).

Run: `pnpm --filter erp build` → compila sin errores; el listado de rutas incluye `ƒ /api/webhooks/mercadopago/[empresaId]` y `ƒ /mock-pago/[id]` (dinámicas — usan `clienteAdmin`/`headers()`).

Byte-scan (CERO BOM literal en los archivos nuevos/tocados; 0 coincidencias = pass):

```bash
grep -rlP '\xEF\xBB\xBF' apps/erp/app/api apps/erp/app/mock-pago apps/erp/componentes/formulario-mock-pago.tsx apps/erp/lib/emision.ts apps/erp/app/ventas/emitir.ts apps/erp/middleware.ts && echo "FALLA: hay BOM" || echo "sin BOM (pass)"
```

```bash
git add apps/erp/app/api/webhooks apps/erp/app/mock-pago apps/erp/componentes/formulario-mock-pago.tsx apps/erp/lib/emision.ts apps/erp/app/ventas/emitir.ts apps/erp/middleware.ts apps/erp/.env.example
git commit -m "feat(erp): webhook mercadopago por empresa, simulador mock y aplicación de anticipos al emitir"
```

---

### Task 7: Configuración de credenciales MercadoPago (cifradas)

**Files:**
- Create: `apps/erp/app/configuracion/pagos/page.tsx`, `apps/erp/app/configuracion/pagos/acciones.ts`, `apps/erp/componentes/formulario-pagos.tsx`
- Modify: `apps/erp/app/configuracion/page.tsx` (tarjeta "Pagos (MercadoPago)")

**Interfaces:**
- Consumes: `cifrar` de `@suite/dte` (AES-256-GCM, misma env `DTE_ENCRYPTION_KEY` que el certificado DTE); `crearClienteServidor` de `@suite/auth/server`; `obtenerEmpresaActiva` de `../../../lib/empresa-activa`; `EstadoForm` de `../../tipos`; `headers` de `next/headers` (para la URL absoluta del webhook); `@suite/ui` (`Boton`, `Campo`, `Entrada`, `Encabezado`, `Insignia`, `Tarjeta`); columnas `empresas.mp_access_token_cifrado`/`mp_webhook_secret_cifrado` (migración 0018, con `grant update` ADITIVO a `authenticated` — la task de migración) vía tipos `@suite/db` regenerados.
- Espejos EXACTOS (léelos completos antes de escribir): `apps/erp/app/configuracion/dte/acciones.ts` (`cargarCertificado` — `claveCifrado()`, `cifrar(Buffer.from(x,'utf8'), clave)`, `.update(...).eq('id', activa.id).select('id')`, y el `(data ?? []).length === 0` que delata el 0-filas de rol insuficiente); `apps/erp/app/configuracion/dte/page.tsx` (server select del cifrado → boolean `tieneCert`, NUNCA el valor); `apps/erp/componentes/formulario-certificado.tsx` (client `useActionState` + render del `estado.error`); `apps/erp/app/configuracion/page.tsx` (grid de tarjetas-Link).
- Produces: página `/configuracion/pagos` (estado configurado ✓/✗ sin mostrar valores; URL del webhook de la empresa con botón copiar); Server Action `guardarCredencialesMp` (token + secret cifrados); tarjeta "Pagos (MercadoPago)" en `/configuracion`.
- **Decisión — el ciphertext NO se muestra:** la page hace `select` server-side de las columnas cifradas SOLO para calcular el booleano `configurado` (espejo exacto de `tieneCert` en la page de DTE); jamás pasa el valor al cliente. El grant de `select` de `empresas` es a nivel de tabla (0001, `grant select ... on public.empresas`), así que el `select` server-side de las columnas nuevas funciona sin grant adicional.
- **Decisión — URL absoluta del webhook:** se arma con `headers()` (`host` + `x-forwarded-proto ?? 'https'`) para reflejar el dominio real donde corre la app: `{proto}://{host}/api/webhooks/mercadopago/{activa.id}`. El botón copiar es cliente (`navigator.clipboard`), por eso el bloque URL + copiar vive en el mismo componente cliente que el formulario.
- **Decisión — gating:** la tarjeta en `/configuracion` se muestra siempre (como la de DTE); el permiso dueño/admin lo impone la action (0 filas actualizadas → mensaje claro), no la UI. MercadoPago no depende del módulo transporte.

- [ ] **Step 1: Server Action `apps/erp/app/configuracion/pagos/acciones.ts`**

Espejo de `cargarCertificado` (misma `claveCifrado()`, mismo mapeo de 0-filas a "solo dueño/admin").

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { crearClienteServidor } from '@suite/auth/server'
import { cifrar } from '@suite/dte'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import type { EstadoForm } from '../../tipos'

function claveCifrado(): string {
  const clave = process.env.DTE_ENCRYPTION_KEY
  if (!clave) throw new Error('Falta DTE_ENCRYPTION_KEY en el servidor')
  return clave
}

export async function guardarCredencialesMp(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const token = String(formData.get('mp_access_token') ?? '').trim()
  const secret = String(formData.get('mp_webhook_secret') ?? '').trim()
  if (token === '') return { error: 'Ingresa el Access Token de MercadoPago' }
  if (secret === '') return { error: 'Ingresa la clave secreta del webhook' }

  const clave = claveCifrado()
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase
    .from('empresas')
    .update({
      mp_access_token_cifrado: cifrar(Buffer.from(token, 'utf8'), clave),
      mp_webhook_secret_cifrado: cifrar(Buffer.from(secret, 'utf8'), clave),
    })
    .eq('id', activa.id)
    .select('id')
  if (error) return { error: 'No se pudo guardar la configuración de MercadoPago' }
  if ((data ?? []).length === 0) return { error: 'No se pudo guardar: solo el dueño o admin puede configurar los pagos' }

  revalidatePath('/configuracion/pagos')
  return {}
}
```

- [ ] **Step 2: Componente cliente `apps/erp/componentes/formulario-pagos.tsx`**

Formulario de credenciales (`useActionState`, espejo de `FormularioCertificado`) + bloque de la URL del webhook con botón copiar (cliente).

```tsx
'use client'

import { useActionState, useState } from 'react'
import { Boton, Campo, Entrada, Insignia, Tarjeta } from '@suite/ui'
import type { EstadoForm } from '../app/tipos'

export function FormularioPagos({
  accion,
  configurado,
  webhookUrl,
}: {
  accion: (prev: EstadoForm, formData: FormData) => Promise<EstadoForm>
  configurado: boolean
  webhookUrl: string
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoForm)
  const [copiado, setCopiado] = useState(false)

  async function copiar() {
    try {
      await navigator.clipboard.writeText(webhookUrl)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch {
      // El navegador puede bloquear el portapapeles (sin https/permiso): el usuario copia a mano.
    }
  }

  return (
    <Tarjeta className="max-w-2xl">
      <div className="mb-4 flex items-center gap-2">
        <span className="text-sm font-medium text-slate-700">Estado:</span>
        {configurado ? <Insignia tono="verde">Configurado</Insignia> : <Insignia tono="amarillo">Sin configurar</Insignia>}
      </div>
      <form action={enviar} className="grid grid-cols-1 gap-4">
        <Campo etiqueta="Access Token de MercadoPago *">
          <Entrada name="mp_access_token" type="password" required autoComplete="off" />
        </Campo>
        <Campo etiqueta="Clave secreta del webhook *">
          <Entrada name="mp_webhook_secret" type="password" required autoComplete="off" />
        </Campo>
        <div className="flex items-center justify-end gap-2">
          {estado.error && <span className="mr-auto text-sm text-red-600">{estado.error}</span>}
          <Boton type="submit" disabled={pendiente}>{pendiente ? 'Guardando…' : 'Guardar credenciales'}</Boton>
        </div>
      </form>
      <p className="mt-2 text-xs text-slate-500">
        Las credenciales se guardan cifradas y solo se usan en el servidor al cobrar. Nunca se muestran ni se descargan.
      </p>
      <div className="mt-6 border-t border-slate-200 pt-4">
        <span className="mb-1 block text-sm font-medium text-slate-700">URL del webhook (pégala en tu cuenta de MercadoPago)</span>
        <div className="flex items-center gap-2">
          <code className="flex-1 overflow-x-auto rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-800">{webhookUrl}</code>
          <Boton type="button" variante="secundario" onClick={copiar}>{copiado ? 'Copiado' : 'Copiar'}</Boton>
        </div>
      </div>
    </Tarjeta>
  )
}
```

- [ ] **Step 3: Página `apps/erp/app/configuracion/pagos/page.tsx`**

```tsx
import { headers } from 'next/headers'
import { crearClienteServidor } from '@suite/auth/server'
import { Encabezado } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { FormularioPagos } from '../../../componentes/formulario-pagos'
import { guardarCredencialesMp } from './acciones'

export default async function ConfigPagos() {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />

  const supabase = await crearClienteServidor()
  // Solo para el booleano configurado ✓/✗: el ciphertext jamás se renderiza (espejo de tieneCert).
  const { data: empresa } = await supabase
    .from('empresas')
    .select('mp_access_token_cifrado, mp_webhook_secret_cifrado')
    .eq('id', activa.id)
    .single()
  const configurado = Boolean(empresa?.mp_access_token_cifrado) && Boolean(empresa?.mp_webhook_secret_cifrado)

  const h = await headers()
  const host = h.get('host') ?? ''
  const proto = h.get('x-forwarded-proto') ?? 'https'
  const webhookUrl = `${proto}://${host}/api/webhooks/mercadopago/${activa.id}`

  return (
    <div>
      <Encabezado titulo="Pagos (MercadoPago)" />
      <p className="mb-4 max-w-2xl text-sm text-slate-600">
        Conecta tu cuenta de MercadoPago para cobrar con links de pago. El Access Token y la clave del
        webhook se guardan cifrados; el ERP solo los usa en el servidor.
      </p>
      <FormularioPagos accion={guardarCredencialesMp} configurado={configurado} webhookUrl={webhookUrl} />
    </div>
  )
}
```

- [ ] **Step 4: Tarjeta "Pagos (MercadoPago)" en `/configuracion` (diff exacto)**

`apps/erp/app/configuracion/page.tsx`: inserta la tarjeta entre la de facturación electrónica y la de módulos.

```diff
         <Link href="/configuracion/dte" className="block">
           <Tarjeta className="h-full transition hover:border-marca-500">
             <h2 className="mb-1 text-lg font-semibold text-slate-800">Facturación electrónica</h2>
             <p className="text-sm text-slate-600">Datos del emisor, certificado digital y folios CAF.</p>
           </Tarjeta>
         </Link>
+        <Link href="/configuracion/pagos" className="block">
+          <Tarjeta className="h-full transition hover:border-marca-500">
+            <h2 className="mb-1 text-lg font-semibold text-slate-800">Pagos (MercadoPago)</h2>
+            <p className="text-sm text-slate-600">Credenciales de MercadoPago para cobrar con links de pago.</p>
+          </Tarjeta>
+        </Link>
         <Link href="/configuracion/modulos" className="block">
```

- [ ] **Step 5: Verificar y commit**

Requisito previo: la migración 0018 (columnas `mp_*_cifrado` con `grant update` aditivo) y los tipos `@suite/db` regenerados ya deben existir.

Run: `pnpm --filter erp build` → compila sin errores; el listado incluye `ƒ /configuracion/pagos` (dinámica — usa `cookies()`/`headers()`).

Byte-scan (CERO BOM literal; 0 coincidencias = pass):

```bash
grep -rlP '\xEF\xBB\xBF' apps/erp/app/configuracion/pagos apps/erp/componentes/formulario-pagos.tsx apps/erp/app/configuracion/page.tsx && echo "FALLA: hay BOM" || echo "sin BOM (pass)"
```

```bash
git add apps/erp/app/configuracion/pagos apps/erp/componentes/formulario-pagos.tsx apps/erp/app/configuracion/page.tsx
git commit -m "feat(erp): configuración de credenciales MercadoPago cifradas"
```

---

### Task 8: ERP — links de pago en los 3 detalles + anticipos en cobranza + método manual

**Files:**
- Create: `apps/erp/lib/pagos.ts`, `apps/erp/app/pagos-mp/acciones.ts`, `apps/erp/componentes/generar-link-pago.tsx`, `apps/erp/componentes/formulario-aplicar-anticipo.tsx`
- Modify: `apps/erp/app/ventas/[id]/page.tsx`, `apps/erp/app/proformas/[id]/page.tsx`, `apps/erp/app/cotizaciones/[id]/page.tsx`, `apps/erp/app/cobranza/page.tsx`, `apps/erp/app/cobranza/acciones.ts`, `apps/erp/componentes/formulario-pago.tsx`

**Interfaces:**
- Consumes el helper de app `pasarelaParaEmpresa(empresaId: string): Promise<PasarelaPagos | null>` (`apps/erp/lib/pagos.ts`, creado en el Step 1 de esta task — espejo de `credencialesEmpresa` de `lib/emision.ts`: admin client porque las columnas cifradas NO tienen grant a authenticated, lee `mp_access_token_cifrado`, descifra con `DTE_ENCRYPTION_KEY`, `null` si no está configurada, si no `pasarelaPorAmbiente(process.env.PASARELA_PAGOS, token)` de `@suite/pagos`); `PasarelaPagos.crearPreferencia({ titulo, monto, externalReference, urlRetorno }): Promise<{ preferenciaId: string; url: string }>` (spec §4).
- Consumes RPCs de la migración 0018 vía tipos `@suite/db` regenerados: **`crear_link_pago(p_empresa, p_id, p_origen_tipo, p_origen, p_preferencia, p_url, p_monto) returns uuid`** (Task 2 la crea con `p_id` como 2º arg) y `aplicar_anticipo_manual(p_empresa, p_anticipo, p_documento)`. El `link_id` se genera en la Server Action (`crypto.randomUUID`) y se pasa como `p_id` porque la preferencia MP (con `preferencia_id`/`url` NOT NULL) y el `external_reference` que embebe el `link_id` (spec §2/§25, 4 segmentos) se arman ANTES de la RPC; el webhook (§5) parsea ese `link_id` para `p_link`, así que la fila debe persistir ESE id.
- Consumes tablas/vistas (tipos regenerados): `links_pago` (select miembros), `anticipos` (select miembros), `saldos_documentos`, `proformas`, `cotizaciones`, `documentos_venta`. TODAS las queries `.eq('empresa_id', activa.id)`.
- Espejos estructurales — léelos antes de escribir: `apps/erp/app/cobranza/page.tsx` + `acciones.ts` + `apps/erp/componentes/formulario-pago.tsx` (useActionState + prop `accion` + mapeo de mensajes de RPC por substring), `apps/erp/componentes/acciones-proforma.tsx` (toggle inline con `useState` sin `window.confirm`), `apps/erp/app/cobranza/pagos/nuevo/page.tsx` (facturas con saldo por cliente).
- Produces: Server Actions `generarLinkPago` (nueva ruta `pagos-mp`) y `aplicarAnticipoManual` (en cobranza); componentes `GenerarLinkPago` (link vigente + copiar / botón generar) y `FormularioAplicarAnticipo` (selector de facturas del mismo cliente, inline); método `'mercadopago'` en `METODOS` y en el `<Selector>` del formulario de pago; sección **Anticipos** en `/cobranza`; links de pago en los 3 detalles (factura emitida con saldo, proforma enviada/aprobada, cotización SOLO aceptada).
- Mensajes de action (spec §3): pre-RPC `'MercadoPago no está configurado para esta empresa'`; RPC re-mapeadas `'Tu rol no permite generar links de pago'`, `'El saldo cambió; vuelve a generar el link'` (carrera saldo/monto/total), `'Tu rol no permite aplicar anticipos'`, `'El anticipo no existe o ya fue aplicado'`, `'El documento no permite aplicar el anticipo'`.

- [ ] **Step 1: Helper de app `pasarelaParaEmpresa` + Server Action `generarLinkPago`**

`apps/erp/lib/pagos.ts` (espejo de `credencialesEmpresa` de `lib/emision.ts`: admin client — las columnas cifradas NO tienen grant a `authenticated` —, descifra el token MP con `DTE_ENCRYPTION_KEY`, `null` si la empresa no está configurada; `@suite/pagos` ya NO descifra):

```ts
import 'server-only'
import { clienteAdmin } from '@suite/auth/admin'
import { descifrar } from '@suite/dte'
import { pasarelaPorAmbiente, type PasarelaPagos } from '@suite/pagos'

function clave(): string {
  const k = process.env.DTE_ENCRYPTION_KEY
  if (!k) throw new Error('Falta DTE_ENCRYPTION_KEY')
  return k
}

// Devuelve la pasarela ligada al token MP de la empresa, o null si NO está configurada.
// SOLO server-side: usa service_role (clienteAdmin) para leer la columna cifrada (sin
// grant a authenticated) y la descifra con DTE_ENCRYPTION_KEY — espejo EXACTO de
// credencialesEmpresa. En modo mock, pasarelaPorAmbiente ignora el token.
export async function pasarelaParaEmpresa(empresaId: string): Promise<PasarelaPagos | null> {
  const admin = clienteAdmin()
  const { data: emp, error } = await admin
    .from('empresas')
    .select('mp_access_token_cifrado')
    .eq('id', empresaId)
    .single()
  if (error || !emp?.mp_access_token_cifrado) return null
  const token = descifrar(emp.mp_access_token_cifrado, clave()).toString('utf8')
  return pasarelaPorAmbiente(process.env.PASARELA_PAGOS, token)
}
```

`apps/erp/app/pagos-mp/acciones.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearNumeroProforma } from '@suite/core'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import { pasarelaParaEmpresa } from '../../lib/pagos'
import type { EstadoForm } from '../tipos'

const TIPOS = ['factura', 'proforma', 'cotizacion'] as const
type TipoOrigen = (typeof TIPOS)[number]

const RUTA: Record<TipoOrigen, string> = { factura: 'ventas', proforma: 'proformas', cotizacion: 'cotizaciones' }

export async function generarLinkPago(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  const tipo = String(formData.get('tipo') ?? '')
  const objetoId = String(formData.get('id') ?? '')
  if (!(TIPOS as readonly string[]).includes(tipo) || !objetoId) return { error: 'Origen de pago no válido' }
  const origen = tipo as TipoOrigen

  // Config MP de la empresa (token cifrado, descifrado server-side). Sin config → mensaje claro.
  const pasarela = await pasarelaParaEmpresa(activa.id)
  if (!pasarela) return { error: 'MercadoPago no está configurado para esta empresa' }

  const supabase = await crearClienteServidor()

  // Título (razón social + folio / PF-N° / N° cotización) y monto según el tipo, leyendo el
  // objeto scoped a la empresa. El monto es el que crear_link_pago re-valida bajo lock.
  let titulo: string
  let monto: number
  if (origen === 'factura') {
    const { data } = await supabase
      .from('saldos_documentos')
      .select('tipo, folio, saldo, cliente_razon_social')
      .eq('empresa_id', activa.id)
      .eq('documento_id', objetoId)
      .maybeSingle()
    if (!data || (data.saldo ?? 0) <= 0) return { error: 'Solo se generan links para facturas emitidas con saldo' }
    titulo = `${data.cliente_razon_social} — ${data.tipo === 'factura' ? 'Factura' : 'Boleta'} ${data.folio ?? ''}`.trim()
    monto = data.saldo ?? 0
  } else if (origen === 'proforma') {
    const { data } = await supabase
      .from('proformas')
      .select('numero, total, clientes (razon_social)')
      .eq('empresa_id', activa.id)
      .eq('id', objetoId)
      .maybeSingle()
    if (!data) return { error: 'El documento no existe' }
    titulo = `${data.clientes?.razon_social ?? ''} — Proforma ${formatearNumeroProforma(data.numero)}`.trim()
    monto = data.total
  } else {
    const { data } = await supabase
      .from('cotizaciones')
      .select('numero, total, clientes (razon_social)')
      .eq('empresa_id', activa.id)
      .eq('id', objetoId)
      .maybeSingle()
    if (!data) return { error: 'El documento no existe' }
    titulo = `${data.clientes?.razon_social ?? ''} — Cotización N° ${data.numero}`.trim()
    monto = data.total
  }

  // external_reference (spec §2): "{tipo}:{empresa_id}:{objeto_id}:{link_id}". El link_id se
  // genera acá porque la preferencia se crea ANTES de crear_link_pago (preferencia_id/url son
  // NOT NULL) y el webhook parsea link_id de la referencia — la fila persiste ESTE id (p_id).
  const linkId = crypto.randomUUID()
  const referencia = `${origen}:${activa.id}:${objetoId}:${linkId}`
  const h = await headers()
  const base = `${h.get('x-forwarded-proto') ?? 'http'}://${h.get('host') ?? 'localhost:3000'}`
  const urlRetorno = `${base}/${RUTA[origen]}/${objetoId}`

  let preferencia: { preferenciaId: string; url: string }
  try {
    preferencia = await pasarela.crearPreferencia({ titulo, monto, externalReference: referencia, urlRetorno })
  } catch {
    return { error: 'No se pudo generar el link de pago' }
  }

  const { error } = await supabase.rpc('crear_link_pago', {
    p_empresa: activa.id,
    p_id: linkId,
    p_origen_tipo: origen,
    p_origen: objetoId,
    p_preferencia: preferencia.preferenciaId,
    p_url: preferencia.url,
    p_monto: monto,
  })
  if (error) {
    if (error.message.includes('rol')) return { error: 'Tu rol no permite generar links de pago' }
    // Saldo/monto/total ya no calzan (otro abono, link viejo): la preferencia queda huérfana
    // y expira sola (spec §2) — el usuario regenera.
    if (error.message.includes('saldo') || error.message.includes('monto') || error.message.includes('total')) {
      return { error: 'El saldo cambió; vuelve a generar el link' }
    }
    return { error: 'No se pudo generar el link de pago' }
  }
  revalidatePath(`/${RUTA[origen]}/${objetoId}`)
  return {}
}
```

- [ ] **Step 2: Componente `GenerarLinkPago` (cliente)**

`apps/erp/componentes/generar-link-pago.tsx`:

```tsx
'use client'

import { useActionState, useState } from 'react'
import { Boton } from '@suite/ui'
import { generarLinkPago } from '../app/pagos-mp/acciones'
import type { EstadoForm } from '../app/tipos'

export function GenerarLinkPago({
  tipo,
  id,
  linkVigente,
}: {
  tipo: 'factura' | 'proforma' | 'cotizacion'
  id: string
  linkVigente: { url: string } | null
}) {
  const [estado, enviar, pendiente] = useActionState(generarLinkPago, {} as EstadoForm)
  const [copiado, setCopiado] = useState(false)
  return (
    <div className="flex flex-col gap-2">
      {linkVigente && (
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={linkVigente.url}
            target="_blank"
            rel="noreferrer"
            className="break-all text-sm text-marca-700 hover:underline"
          >
            {linkVigente.url}
          </a>
          <Boton
            variante="secundario"
            type="button"
            className="px-2 py-1 text-xs"
            onClick={() => {
              navigator.clipboard.writeText(linkVigente.url)
              setCopiado(true)
            }}
          >
            {copiado ? 'Copiado' : 'Copiar'}
          </Boton>
        </div>
      )}
      <form action={enviar} className="flex items-center gap-2">
        <input type="hidden" name="tipo" value={tipo} />
        <input type="hidden" name="id" value={id} />
        <Boton variante={linkVigente ? 'secundario' : 'primario'} type="submit" disabled={pendiente}>
          {pendiente ? 'Generando…' : linkVigente ? 'Regenerar link' : 'Generar link de pago'}
        </Boton>
        {estado.error && <span className="text-xs text-red-600">{estado.error}</span>}
      </form>
    </div>
  )
}
```

- [ ] **Step 3: Componente `FormularioAplicarAnticipo` (cliente)**

`apps/erp/componentes/formulario-aplicar-anticipo.tsx` (espejo del toggle inline de `acciones-proforma.tsx`; la action llega por prop, como `FormularioPago`):

```tsx
'use client'

import { useActionState, useState } from 'react'
import { formatearCLP } from '@suite/core'
import { Boton, Selector } from '@suite/ui'
import type { EstadoForm } from '../app/tipos'

interface FacturaOpcion {
  documentoId: string
  etiqueta: string
  saldo: number
}

export function FormularioAplicarAnticipo({
  anticipoId,
  facturas,
  accion,
}: {
  anticipoId: string
  facturas: FacturaOpcion[]
  accion: (prev: EstadoForm, formData: FormData) => Promise<EstadoForm>
}) {
  const [abierto, setAbierto] = useState(false)
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoForm)
  if (facturas.length === 0) {
    return <span className="text-xs text-slate-400">Sin facturas con saldo</span>
  }
  if (!abierto) {
    return (
      <Boton variante="secundario" type="button" className="px-2 py-1 text-xs" onClick={() => setAbierto(true)}>
        Aplicar
      </Boton>
    )
  }
  return (
    <form action={enviar} className="flex flex-wrap items-center justify-end gap-2">
      <input type="hidden" name="anticipo_id" value={anticipoId} />
      <Selector name="documento_id" required defaultValue="" className="max-w-xs text-xs">
        <option value="" disabled>Factura…</option>
        {facturas.map((f) => (
          <option key={f.documentoId} value={f.documentoId}>
            {f.etiqueta} · {formatearCLP(f.saldo)}
          </option>
        ))}
      </Selector>
      <Boton type="submit" disabled={pendiente} className="px-2 py-1 text-xs">{pendiente ? '…' : 'Confirmar'}</Boton>
      <Boton variante="secundario" type="button" className="px-2 py-1 text-xs" onClick={() => setAbierto(false)}>No</Boton>
      {estado.error && <span className="text-xs text-red-600">{estado.error}</span>}
    </form>
  )
}
```

- [ ] **Step 4: `/ventas/[id]` — cobro con link (factura emitida con saldo)**

`apps/erp/app/ventas/[id]/page.tsx` (queda EXACTAMENTE así — se agregan el import, el bloque de cobro y la tarjeta al final):

```tsx
import { notFound } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP, formatearRut } from '@suite/core'
import { Boton, Encabezado, Insignia, Tabla, Tarjeta, Td, Th, Tr } from '@suite/ui'
import { GenerarLinkPago } from '../../../componentes/generar-link-pago'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { emitirDocumento, emitirNotaCredito } from '../emitir'

export default async function DetalleVenta({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const supabase = await crearClienteServidor()
  const { data: doc } = await supabase
    .from('documentos_venta')
    .select('*, clientes (razon_social, rut), documentos_venta_lineas (descripcion, cantidad, precio_neto, subtotal)')
    .eq('id', id).eq('empresa_id', activa.id).single()
  if (!doc) notFound()

  const emitible = doc.estado === 'borrador' || doc.estado === 'pendiente_envio'
  const esNotaVenta = doc.tipo === 'nota_venta'

  // Cobro con link MP: solo factura/boleta emitida con saldo > 0.
  const cobrable = doc.estado === 'emitido' && doc.tipo !== 'nota_credito' && doc.tipo !== 'nota_venta'
  let saldo = 0
  let linkPago: { url: string } | null = null
  if (cobrable) {
    const [{ data: fila }, { data: link }] = await Promise.all([
      supabase.from('saldos_documentos').select('saldo').eq('empresa_id', activa.id).eq('documento_id', doc.id).maybeSingle(),
      supabase.from('links_pago').select('url')
        .eq('empresa_id', activa.id).eq('origen_tipo', 'factura').eq('origen_id', doc.id).eq('estado', 'vigente').maybeSingle(),
    ])
    saldo = fila?.saldo ?? 0
    linkPago = link ? { url: link.url } : null
  }

  return (
    <div>
      <Encabezado titulo={`${doc.tipo.replace('_', ' ')} ${doc.folio ? '· folio ' + doc.folio : ''}`}>
        <Insignia tono={doc.estado === 'emitido' ? 'verde' : doc.estado === 'rechazado' ? 'rojo' : doc.estado === 'pendiente_envio' ? 'amarillo' : 'gris'}>
          {doc.estado.replace('_', ' ')}
        </Insignia>
      </Encabezado>

      <Tarjeta className="mb-4 max-w-3xl">
        <p><strong>Cliente:</strong> {doc.clientes?.razon_social} ({doc.clientes && formatearRut(doc.clientes.rut)})</p>
        {doc.error_emision && <p className="mt-2 text-sm text-amber-700">Último error: {doc.error_emision}</p>}
      </Tarjeta>

      <Tabla>
        <thead><tr><Th>Descripción</Th><Th>Cantidad</Th><Th className="text-right">Precio</Th><Th className="text-right">Subtotal</Th></tr></thead>
        <tbody>
          {doc.documentos_venta_lineas.map((l: { descripcion: string; cantidad: number; precio_neto: number; subtotal: number }, i: number) => (
            <Tr key={i}><Td>{l.descripcion}</Td><Td>{l.cantidad}</Td><Td className="text-right">{formatearCLP(l.precio_neto)}</Td><Td className="text-right">{formatearCLP(l.subtotal)}</Td></Tr>
          ))}
        </tbody>
      </Tabla>

      <div className="mt-4 flex flex-col items-end gap-1 text-sm">
        <div>Neto: <strong>{formatearCLP(doc.neto)}</strong></div>
        {doc.exento > 0 && <div>Exento: <strong>{formatearCLP(doc.exento)}</strong></div>}
        <div>IVA: <strong>{formatearCLP(doc.iva)}</strong></div>
        <div className="text-lg">Total: <strong>{formatearCLP(doc.total)}</strong></div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {emitible && (esNotaVenta || doc.tipo === 'factura') && (
          <form action={emitirDocumento}>
            <input type="hidden" name="id" value={doc.id} /><input type="hidden" name="tipo" value="factura" />
            <Boton type="submit">Emitir factura</Boton>
          </form>
        )}
        {emitible && (esNotaVenta || doc.tipo === 'boleta') && (
          <form action={emitirDocumento}>
            <input type="hidden" name="id" value={doc.id} /><input type="hidden" name="tipo" value="boleta" />
            <Boton variante="secundario" type="submit">Emitir boleta</Boton>
          </form>
        )}
        {doc.estado === 'emitido' && doc.tipo !== 'nota_credito' && (
          <>
            <a href={`/ventas/${doc.id}/pdf`} target="_blank" rel="noreferrer"><Boton variante="secundario" type="button">Descargar PDF</Boton></a>
            <form action={emitirNotaCredito}>
              <input type="hidden" name="referencia_id" value={doc.id} /><input type="hidden" name="razon" value="Anula documento" />
              <Boton variante="peligro" type="submit">Anular con nota de crédito</Boton>
            </form>
          </>
        )}
      </div>

      {cobrable && saldo > 0 && (
        <Tarjeta className="mt-6 max-w-3xl">
          <h2 className="text-lg font-semibold text-slate-900">Cobro con MercadoPago</h2>
          <p className="mt-1 text-sm text-slate-600">
            Saldo pendiente: <strong className="font-mono">{formatearCLP(saldo)}</strong>. Genera un link para que el cliente pague en línea.
          </p>
          <div className="mt-3">
            <GenerarLinkPago tipo="factura" id={doc.id} linkVigente={linkPago} />
          </div>
        </Tarjeta>
      )}
    </div>
  )
}
```

- [ ] **Step 5: `/proformas/[id]` — anticipo con link (enviada/aprobada)**

En `apps/erp/app/proformas/[id]/page.tsx`: agrega el import y la consulta del link vigente, y renderiza la tarjeta al final.

Import nuevo (junto a los demás de `componentes`, tras `BotonImprimir`):

```tsx
import { GenerarLinkPago } from '../../../componentes/generar-link-pago'
```

Consulta del link vigente — insértala justo ANTES de `const fav = prof.documentos_venta`:

```tsx
  const conLinkPago = prof.estado === 'enviada' || prof.estado === 'aprobada'
  let linkPago: { url: string } | null = null
  if (conLinkPago) {
    const { data: link } = await supabase
      .from('links_pago')
      .select('url')
      .eq('empresa_id', activa.id).eq('origen_tipo', 'proforma').eq('origen_id', prof.id).eq('estado', 'vigente')
      .maybeSingle()
    linkPago = link ? { url: link.url } : null
  }
```

Tarjeta — insértala DESPUÉS del `<div className="mt-6 flex flex-wrap items-center gap-3 print:hidden">…</div>` que contiene `<AccionesProforma …/>`, antes del `</div>` de cierre del componente:

```tsx
      {conLinkPago && (
        <Tarjeta className="mt-6 max-w-3xl print:hidden">
          <h2 className="text-lg font-semibold text-slate-900">Anticipo con MercadoPago</h2>
          <p className="mt-1 text-sm text-slate-600">
            Cobra el total de la proforma (<strong className="font-mono">{formatearCLP(prof.total)}</strong>) como anticipo;
            se aplicará solo al facturarla.
          </p>
          <div className="mt-3">
            <GenerarLinkPago tipo="proforma" id={prof.id} linkVigente={linkPago} />
          </div>
        </Tarjeta>
      )}
```

(`Tarjeta` y `formatearCLP` ya están importados en este archivo.)

- [ ] **Step 6: `/cotizaciones/[id]` — anticipo con link (SOLO aceptada)**

En `apps/erp/app/cotizaciones/[id]/page.tsx`: agrega el import, la consulta del link vigente y la tarjeta.

Import nuevo (tras `BotonImprimir`):

```tsx
import { GenerarLinkPago } from '../../../componentes/generar-link-pago'
```

Consulta del link vigente — insértala justo ANTES de `const hoy = new Date().toISOString().slice(0, 10)`:

```tsx
  let linkPago: { url: string } | null = null
  if (cot.estado === 'aceptada') {
    const { data: link } = await supabase
      .from('links_pago')
      .select('url')
      .eq('empresa_id', activa.id).eq('origen_tipo', 'cotizacion').eq('origen_id', cot.id).eq('estado', 'vigente')
      .maybeSingle()
    linkPago = link ? { url: link.url } : null
  }
```

Tarjeta — insértala DESPUÉS del `<div className="mt-6 flex flex-wrap items-center gap-3 print:hidden">…</div>` (el de `<AccionesCotizacion …/>`), antes del `</div>` de cierre:

```tsx
      {cot.estado === 'aceptada' && (
        <Tarjeta className="mt-6 max-w-3xl print:hidden">
          <h2 className="text-lg font-semibold text-slate-900">Anticipo con MercadoPago</h2>
          <p className="mt-1 text-sm text-slate-600">
            Cobra el total de la cotización (<strong className="font-mono">{formatearCLP(cot.total)}</strong>) como anticipo;
            se aplicará solo al facturarla.
          </p>
          <div className="mt-3">
            <GenerarLinkPago tipo="cotizacion" id={cot.id} linkVigente={linkPago} />
          </div>
        </Tarjeta>
      )}
```

(`Tarjeta` y `formatearCLP` ya están importados en este archivo.)

- [ ] **Step 7: `/cobranza` — método `'mercadopago'` + action `aplicarAnticipoManual`**

`apps/erp/app/cobranza/acciones.ts` (queda EXACTAMENTE así — `METODOS` gana `'mercadopago'` y se agrega la action al final):

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import type { Json } from '@suite/db'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import type { EstadoForm } from '../tipos'

const METODOS = ['efectivo', 'transferencia', 'tarjeta', 'cheque', 'mercadopago', 'otro'] as const

type AplicacionEntrada = { documentoId: string; monto: number }

export async function registrarPago(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const cliente = String(formData.get('cliente_id') ?? '')
  const metodo = String(formData.get('metodo') ?? '')
  const fecha = String(formData.get('fecha') ?? '').trim()
  const referencia = String(formData.get('referencia') ?? '').trim()
  const notas = String(formData.get('notas') ?? '').trim()
  const monto = Math.trunc(Number(String(formData.get('monto') ?? '').trim()))
  if (!cliente) return { error: 'Selecciona un cliente' }
  if (!(METODOS as readonly string[]).includes(metodo)) return { error: 'Selecciona un método de pago' }
  if (!Number.isInteger(monto) || monto <= 0) return { error: 'El monto debe ser un entero mayor a 0' }

  let aplicaciones: AplicacionEntrada[]
  try {
    aplicaciones = (JSON.parse(String(formData.get('aplicaciones') ?? '[]')) as AplicacionEntrada[]).filter((a) => a.monto > 0)
  } catch {
    return { error: 'Las aplicaciones del pago no son válidas' }
  }
  if (aplicaciones.length === 0) return { error: 'Aplica el pago a al menos un documento' }
  for (const a of aplicaciones) {
    if (!a.documentoId || !Number.isInteger(a.monto) || a.monto < 1) {
      return { error: 'Cada aplicación necesita documento y monto entero mayor a 0' }
    }
  }

  const supabase = await crearClienteServidor()
  // p_aplicaciones es jsonb en SQL; el generador de tipos lo tipa como Json, no como el shape real: castea sólo el tipo.
  // p_fecha/p_referencia/p_notas aceptan NULL en SQL (coalesce/nullif), pero el generador no refleja la nulabilidad
  // de argumentos de función: castea sólo el tipo, no el valor (mismo criterio que compras/acciones.ts).
  const { error } = await supabase.rpc('registrar_pago', {
    p_empresa: activa.id,
    p_cliente: cliente,
    p_fecha: (fecha || null) as string,
    p_metodo: metodo,
    p_monto: monto,
    p_referencia: (referencia || null) as string,
    p_notas: (notas || null) as string,
    p_aplicaciones: aplicaciones.map((a) => ({ documentoId: a.documentoId, monto: a.monto })) as unknown as Json,
  })
  if (error) {
    if (error.message.includes('rol')) return { error: 'Tu rol no permite registrar pagos' }
    if (error.message.includes('saldo')) return { error: error.message }
    if (error.message.includes('suma')) return { error: 'La suma de las aplicaciones debe ser igual al monto del pago' }
    if (error.message.includes('cobrable')) return { error: 'Hay un documento no cobrable o de otro cliente' }
    return { error: 'No se pudo registrar el pago' }
  }
  revalidatePath('/cobranza')
  revalidatePath('/cobranza/pagos')
  redirect('/cobranza')
}

export async function anularPago(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  const pago = String(formData.get('pago_id') ?? '')
  const motivo = String(formData.get('motivo') ?? '').trim()
  if (!pago) return { error: 'Pago no válido' }
  if (motivo === '') return { error: 'La anulación requiere un motivo' }
  const supabase = await crearClienteServidor()
  const { error } = await supabase.rpc('anular_pago', { p_empresa: activa.id, p_pago: pago, p_motivo: motivo })
  if (error) {
    if (error.message.includes('rol')) return { error: 'Tu rol no permite anular pagos' }
    if (error.message.includes('anulado')) return { error: 'El pago no existe o ya está anulado' }
    return { error: 'No se pudo anular el pago' }
  }
  revalidatePath('/cobranza')
  revalidatePath('/cobranza/pagos')
  return {}
}

// Aplica un anticipo 'recibido' a una factura emitida con saldo del MISMO cliente (spec §3).
// La RPC valida rol, existencia/estado del anticipo y que el documento admita la aplicación;
// aquí solo se re-mapean sus mensajes exactos (documento antes que anticipo: el mensaje de
// documento contiene la palabra "anticipo").
export async function aplicarAnticipoManual(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  const anticipo = String(formData.get('anticipo_id') ?? '')
  const documento = String(formData.get('documento_id') ?? '')
  if (!anticipo) return { error: 'Anticipo no válido' }
  if (!documento) return { error: 'Selecciona una factura' }
  const supabase = await crearClienteServidor()
  const { error } = await supabase.rpc('aplicar_anticipo_manual', {
    p_empresa: activa.id,
    p_anticipo: anticipo,
    p_documento: documento,
  })
  if (error) {
    if (error.message.includes('rol')) return { error: 'Tu rol no permite aplicar anticipos' }
    if (error.message.includes('documento')) return { error: 'El documento no permite aplicar el anticipo' }
    if (error.message.includes('anticipo')) return { error: 'El anticipo no existe o ya fue aplicado' }
    return { error: 'No se pudo aplicar el anticipo' }
  }
  revalidatePath('/cobranza')
  return {}
}
```

- [ ] **Step 8: `/cobranza` — sección Anticipos**

`apps/erp/app/cobranza/page.tsx` (queda EXACTAMENTE así — se agregan `formatearNumeroProforma`, el componente y la action a los imports, el bloque de anticipos tras cargar los saldos, y la sección al final):

```tsx
import Link from 'next/link'
import { crearClienteServidor } from '@suite/auth/server'
import { estaVencido, formatearCLP, formatearNumeroProforma } from '@suite/core'
import { Boton, Encabezado, Insignia, Selector, Tabla, Td, Th, Tr } from '@suite/ui'
import { FormularioAplicarAnticipo } from '../../componentes/formulario-aplicar-anticipo'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import { aplicarAnticipoManual } from './acciones'

const HOY = () => new Date().toISOString().slice(0, 10)

export default async function PaginaCobranza({
  searchParams,
}: {
  searchParams: Promise<{ cliente?: string; vencidas?: string }>
}) {
  const { cliente = '', vencidas = '' } = await searchParams
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const supabase = await crearClienteServidor()
  const [{ data: clientes }, consultaSaldos] = await Promise.all([
    supabase.from('clientes').select('id, razon_social').eq('empresa_id', activa.id).eq('activo', true).order('razon_social'),
    (() => {
      let q = supabase
        .from('saldos_documentos')
        .select('documento_id, tipo, folio, cliente_id, cliente_razon_social, total, emitido_en, fecha_vencimiento, pagado, notas_credito, saldo')
        .eq('empresa_id', activa.id)
        .neq('saldo', 0)
        .order('fecha_vencimiento', { ascending: true })
        .limit(200)
      if (cliente) q = q.eq('cliente_id', cliente)
      return q
    })(),
  ])
  const hoy = HOY()
  let filas = consultaSaldos.data ?? []
  if (vencidas === '1') filas = filas.filter((f) => estaVencido(f.fecha_vencimiento, hoy, f.saldo ?? 0))
  const porCobrar = filas.reduce((s, f) => s + Math.max(0, f.saldo ?? 0), 0)
  const vencido = filas.filter((f) => estaVencido(f.fecha_vencimiento, hoy, f.saldo ?? 0)).reduce((s, f) => s + (f.saldo ?? 0), 0)

  // ---- Anticipos MercadoPago: etiqueta del origen (PF-N° / cotización N° / excedente de
  // factura folio X) por queries por tipo + Map, y facturas emitidas con saldo por cliente
  // para el botón Aplicar (mismo cliente). `.in('id', [])` devuelve 0 filas sin error.
  const { data: anticipos } = await supabase
    .from('anticipos')
    .select('id, origen_tipo, origen_id, monto, estado, recibido_en, cliente_id, clientes (razon_social)')
    .eq('empresa_id', activa.id)
    .order('recibido_en', { ascending: false })
    .limit(200)
  const listaAnticipos = anticipos ?? []
  const idsPF = [...new Set(listaAnticipos.filter((a) => a.origen_tipo === 'proforma').map((a) => a.origen_id))]
  const idsCot = [...new Set(listaAnticipos.filter((a) => a.origen_tipo === 'cotizacion').map((a) => a.origen_id))]
  const idsFac = [...new Set(listaAnticipos.filter((a) => a.origen_tipo === 'excedente').map((a) => a.origen_id))]
  const [refsPF, refsCot, refsFac, saldosAplicables] = await Promise.all([
    supabase.from('proformas').select('id, numero').eq('empresa_id', activa.id).in('id', idsPF),
    supabase.from('cotizaciones').select('id, numero').eq('empresa_id', activa.id).in('id', idsCot),
    supabase.from('documentos_venta').select('id, folio').eq('empresa_id', activa.id).in('id', idsFac),
    supabase.from('saldos_documentos').select('documento_id, tipo, folio, cliente_id, saldo').eq('empresa_id', activa.id).gt('saldo', 0).limit(500),
  ])
  const mapaPF = new Map((refsPF.data ?? []).map((p) => [p.id, p.numero]))
  const mapaCot = new Map((refsCot.data ?? []).map((c) => [c.id, c.numero]))
  const mapaFac = new Map((refsFac.data ?? []).map((f) => [f.id, f.folio]))
  const facturasPorCliente = new Map<string, { documentoId: string; etiqueta: string; saldo: number }[]>()
  for (const s of saldosAplicables.data ?? []) {
    if (!s.documento_id || !s.cliente_id) continue
    const arr = facturasPorCliente.get(s.cliente_id) ?? []
    arr.push({ documentoId: s.documento_id, etiqueta: `${s.tipo === 'factura' ? 'Factura' : 'Boleta'} ${s.folio ?? '—'}`, saldo: s.saldo ?? 0 })
    facturasPorCliente.set(s.cliente_id, arr)
  }
  function etiquetaAnticipo(a: { origen_tipo: string; origen_id: string }): string {
    if (a.origen_tipo === 'proforma') {
      const n = mapaPF.get(a.origen_id)
      return n ? formatearNumeroProforma(n) : 'Proforma'
    }
    if (a.origen_tipo === 'cotizacion') {
      const n = mapaCot.get(a.origen_id)
      return n != null ? `Cotización N° ${n}` : 'Cotización'
    }
    const folio = mapaFac.get(a.origen_id)
    return `Excedente de factura ${folio ?? '—'}`
  }

  return (
    <div>
      <Encabezado titulo="Cuentas por cobrar">
        <div className="flex items-center gap-2">
          <Link href="/cobranza/pagos"><Boton variante="secundario">Pagos</Boton></Link>
          <Link href="/cobranza/pagos/nuevo"><Boton>Registrar pago</Boton></Link>
        </div>
      </Encabezado>
      <form className="mb-4 flex flex-wrap items-center gap-3" action="/cobranza" method="get">
        <Selector name="cliente" defaultValue={cliente} className="max-w-xs">
          <option value="">Todos los clientes</option>
          {(clientes ?? []).map((c) => <option key={c.id} value={c.id}>{c.razon_social}</option>)}
        </Selector>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" name="vencidas" value="1" defaultChecked={vencidas === '1'} /> Solo vencidas
        </label>
        <Boton variante="secundario" type="submit">Filtrar</Boton>
        <Link className="text-sm text-marca-700 hover:underline" href="/cobranza">Limpiar</Link>
      </form>
      <Tabla>
        <thead><tr><Th>Documento</Th><Th>Cliente</Th><Th>Emisión</Th><Th>Vencimiento</Th><Th className="text-right">Total</Th><Th className="text-right">Pagado</Th><Th className="text-right">Saldo</Th><Th /></tr></thead>
        <tbody>
          {filas.map((f) => {
            const venc = estaVencido(f.fecha_vencimiento, hoy, f.saldo ?? 0)
            return (
              <Tr key={f.documento_id}>
                <Td>{f.tipo === 'factura' ? 'Factura' : 'Boleta'} {f.folio ?? '—'}</Td>
                <Td>{f.cliente_razon_social}</Td>
                <Td>{f.emitido_en ? new Date(f.emitido_en).toLocaleDateString('es-CL') : '—'}</Td>
                <Td>{f.fecha_vencimiento ? new Date(f.fecha_vencimiento + 'T00:00:00').toLocaleDateString('es-CL') : '—'}</Td>
                <Td className="text-right font-mono">{formatearCLP(f.total ?? 0)}</Td>
                <Td className="text-right font-mono">{formatearCLP((f.pagado ?? 0) + (f.notas_credito ?? 0))}</Td>
                <Td className="text-right font-mono">{(f.saldo ?? 0) < 0 ? <span className="text-marca-700">{formatearCLP(f.saldo ?? 0)} (a favor)</span> : formatearCLP(f.saldo ?? 0)}</Td>
                <Td>{venc && <Insignia tono="rojo">Vencida</Insignia>}</Td>
              </Tr>
            )
          })}
          {filas.length === 0 && <Tr><Td colSpan={8} className="py-8 text-center text-slate-500">No hay documentos con saldo {cliente || vencidas ? 'que coincidan' : 'pendiente'}.</Td></Tr>}
        </tbody>
      </Tabla>
      <div className="mt-3 flex justify-end gap-6 text-sm">
        <span>Por cobrar: <strong className="font-mono">{formatearCLP(porCobrar)}</strong></span>
        <span className="text-red-600">Vencido: <strong className="font-mono">{formatearCLP(vencido)}</strong></span>
      </div>

      <section className="mt-10">
        <h2 className="mb-3 text-lg font-semibold text-slate-800">Anticipos</h2>
        <Tabla>
          <thead><tr><Th>Cliente</Th><Th>Origen</Th><Th className="text-right">Monto</Th><Th>Estado</Th><Th>Fecha</Th><Th /></tr></thead>
          <tbody>
            {listaAnticipos.map((a) => (
              <Tr key={a.id}>
                <Td>{a.clientes?.razon_social ?? '—'}</Td>
                <Td>{etiquetaAnticipo(a)}</Td>
                <Td className="text-right font-mono">{formatearCLP(a.monto)}</Td>
                <Td>{a.estado === 'aplicado' ? <Insignia tono="verde">Aplicado</Insignia> : <Insignia tono="amarillo">Recibido</Insignia>}</Td>
                <Td>{new Date(a.recibido_en).toLocaleDateString('es-CL')}</Td>
                <Td className="text-right">
                  {a.estado === 'recibido' && (
                    <FormularioAplicarAnticipo anticipoId={a.id} facturas={facturasPorCliente.get(a.cliente_id) ?? []} accion={aplicarAnticipoManual} />
                  )}
                </Td>
              </Tr>
            ))}
            {listaAnticipos.length === 0 && <Tr><Td colSpan={6} className="py-8 text-center text-slate-500">No hay anticipos registrados.</Td></Tr>}
          </tbody>
        </Tabla>
      </section>
    </div>
  )
}
```

- [ ] **Step 9: `formulario-pago.tsx` — opción MercadoPago**

En `apps/erp/componentes/formulario-pago.tsx`, dentro del `<Selector name="metodo" …>`, agrega la opción `mercadopago` entre `cheque` y `otro` (el resto del archivo no cambia):

```tsx
            <Selector name="metodo" required defaultValue="transferencia">
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia</option>
              <option value="tarjeta">Tarjeta</option>
              <option value="cheque">Cheque</option>
              <option value="mercadopago">MercadoPago</option>
              <option value="otro">Otro</option>
            </Selector>
```

- [ ] **Step 10: Verificar y commit**

Byte-scan (CERO BOM literal en los archivos nuevos/tocados de esta task; la marca se busca con la secuencia de escape, jamás el carácter):

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')
$archivos = @(
  'apps/erp/lib/pagos.ts',
  'apps/erp/app/pagos-mp/acciones.ts',
  'apps/erp/componentes/generar-link-pago.tsx',
  'apps/erp/componentes/formulario-aplicar-anticipo.tsx',
  'apps/erp/app/ventas/[id]/page.tsx',
  'apps/erp/app/proformas/[id]/page.tsx',
  'apps/erp/app/cotizaciones/[id]/page.tsx',
  'apps/erp/app/cobranza/page.tsx',
  'apps/erp/app/cobranza/acciones.ts',
  'apps/erp/componentes/formulario-pago.tsx'
)
foreach ($a in $archivos) {
  $bytes = [System.IO.File]::ReadAllBytes($a)
  if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) { "BOM: $a" }
}
```

Expected: sin salida (ningún archivo con BOM).

Run: `pnpm --filter erp build`
Expected: compila sin errores; en el listado de rutas aparecen `/ventas/[id]`, `/proformas/[id]`, `/cotizaciones/[id]` y `/cobranza` (la ruta `pagos-mp` es solo Server Action, no genera page). Si `crear_link_pago` / `aplicar_anticipo_manual` / `anticipos` / `links_pago` no tipan, la migración 0018 + regeneración de tipos (tasks previas) no está aplicada → BLOCKED (no adaptar esta task: los tipos son el contrato).

```bash
git add apps/erp/lib/pagos.ts apps/erp/app/pagos-mp apps/erp/componentes/generar-link-pago.tsx apps/erp/componentes/formulario-aplicar-anticipo.tsx apps/erp/app/ventas apps/erp/app/proformas apps/erp/app/cotizaciones apps/erp/app/cobranza apps/erp/componentes/formulario-pago.tsx
git commit -m "feat(erp): links de pago, anticipos en cobranza y método mercadopago"
```

---

### Task 9: Pipeline + verificación integral (E2E con MockPasarela)

**Files:** ninguno de producción (script y comandos en scratchpad, se borran al cerrar).

- [ ] **Step 1: Pipeline**

Run: `pnpm --filter @suite/db gen` — commitear solo si diff (`chore(db): tipos regenerados`).
Run: `pnpm test` — **152 tests** (core 126 incl. tct; auth 2; dte 10; **pagos 14**: external_reference armar/parsear round-trip + malformados, MockPasarela crear/obtener/verificar firma, firma x-signature real con vector HMAC + ts viejo, título del link, adaptador no loguea secretos).
Run: `pnpm supabase test db` — **240 asserts** (los 12 archivos existentes suman 211 + `mercadopago.test.sql` `plan(29)`), todos verdes.
Run: `pnpm build --concurrency=1` — 3 apps. OJO: el build pisa el `.next` de los dev servers → reiniciar `pnpm --filter erp dev` ANTES del click-through del Step 3.

- [ ] **Step 2: E2E de capa de datos (script Node en scratchpad)**

**Partición explícita de la verificación** — la pieza central (el webhook) es un route handler HTTP, no una RPC; se parte en 3 capas sin hueco:

- **(a) Capa de datos y de dinero** (idempotencia, excedentes, anticipos, bloqueo de rechazo, aplicar, aislamiento) → ESTE script. Las RPCs `registrar_pago_mp`/`registrar_anticipo_mp`/`aplicar_anticipo` son **service_role**: el script las llama con el admin client vía `.rpc()` — réplica EXACTA de lo que el webhook hace tras verificar firma y consultar el payment. Las RPCs authenticated (`crear_link_pago`, `cambiar_estado_proforma`, `aplicar_anticipo_manual`) se llaman con la sesión del usuario. Así el spec §8 (todo el ciclo de dinero) queda cubierto SIN HTTP.
- **(b) El HTTP real** (webhook + firma + `obtenerPago` de la MockPasarela + página `/mock-pago` + hook `aplicarAnticipoDocumento` disparado por `emitirDocumento`) → click-through manual del Step 3 (un script Node no forja la sesión SSR ni dispara la Server Action de emisión).
- **(c) Firma x-signature, `external_reference` y "el adaptador no loguea secretos"** → ya cubiertos por los 14 unit tests de `packages/pagos` (verdes en Step 1).

**Riesgo aceptado (documentado):** el mapeo HTTP 200/500 del route handler (spec §2/§5) se cubre por el checklist manual del Step 3 (ítems 3-8) + los unit tests de firma de `packages/pagos`; el repo NO levanta un servidor HTTP en CI, así que NO se agregan tests HTTP automatizados del route.

Patrón de siempre (`createRequire` sobre `packages/auth/package.json`; usuarios reales vía `admin.auth.admin.createUser` + `registrar_organizacion` como authenticated; RUT org1 `999999999` y org2 `888888888` — NO fixtures ni demo `771234569`; cliente/destino/flota y activación del módulo como authenticated; service_role SOLO para: siembra de facturas emitidas, alta de miembros y cleanup). Para que el resultado no dependa del día: `const mes = new Date().toISOString().slice(0, 7) + '-01'`; todas las fechas usan ese primer día del mes.

**Sombras deliberadas del stand-in (documentadas, no huecos):**
- `crear_link_pago` guarda `preferencia_id`/`url` que en producción vienen de `crearPreferencia`; el script pasa valores mock (`'pref-e2e-1'`, `'https://mock/mock-pago/...'`) directo — la RPC NO consulta la pasarela, solo persiste, así que es fiel.
- `facturar_proforma` deja un `nota_venta` en `'borrador'`; el script lo lleva a `'emitido'` (tipo `'factura'`, `emitido_en = now()`, folio) por **service_role insert/update directo** — espejo EXACTO del sembrado de `cobranza.test.sql`, porque el E2E no puede invocar `emitirDocumento`. El wiring real emisión→hook se prueba en (b).

Setup:
1. Org1 (RUT `999999999`) + dueño; activar `modulo_transporte = true` + `factor_volumetrico` (las proformas nacen de ODEs). Cliente activo RUT `765000017` (módulo-11 válido, sin colisión con fixtures/demo), destino, vehículo `BBCL23`, conductor (para las ODEs). Org2 (RUT `888888888`) + su propio dueño (SIN activar módulo — el aislamiento no lo necesita).
2. **Facturas emitidas sembradas por service_role** (insert directo, `estado='emitido'`, `tipo='factura'`, `emitido_en=now()`, `cliente_id`=Cliente A): **F1** total 100000 (pago feliz + idempotencia + regenerar link), **F2** total 100000 (excedente + saldo-0), **F4** total 80000 (aplicar manual).

Asserts (cada uno aborta con detalle si falla):

*Factura → link → pago (feliz, idempotencia, regenerar):*
1. `crear_link_pago(org1, link_F1, 'factura', F1, 'pref-e2e-1', 'https://mock/...', 100000)` [dueño] con `link_F1 = randomUUID()` (2º arg `p_id`, que la RPC persiste como id de la fila y retorna); `links_pago` de F1 = 1 fila `vigente`, monto 100000.
2. `crear_link_pago(org1, link_F1b, 'factura', F1, 'pref-e2e-2', 'https://mock/...', 100000)` [dueño] con `link_F1b = randomUUID()`, de nuevo → el anterior queda `reemplazado`, el nuevo `vigente`; **un solo `vigente`** por objeto (índice único parcial). Usar `link_F1b` de aquí en adelante.
3. `registrar_pago_mp(org1, F1, 100000, 'PMT-A', link_F1b)` [service_role] → 1 pago con `metodo='mercadopago'` y `mp_payment_id='PMT-A'`, saldo de F1 = 0, `link_F1b` = `pagado`.
4. `registrar_pago_mp(org1, F1, 100000, 'PMT-A', link_F1b)` [service_role] OTRA VEZ (mismo payment) → **idempotente**: pagos de F1 sigue = 1, saldo sigue 0 (dos webhooks del mismo payment no duplican).

*Excedente y saldo-0:*
5. `crear_link_pago(org1, link_F2, 'factura', F2, 'pref-e2e-3', 'https://mock/...', 100000)` [dueño] con `link_F2 = randomUUID()`.
6. `registrar_pago_mp(org1, F2, 150000, 'PMT-B', link_F2)` [service_role] → pago por el **saldo** (100000, `metodo='mercadopago'`), saldo F2 = 0, y **excedente** en `anticipos`: `origen_tipo='excedente'`, `origen_id=F2`, monto 50000, `mp_payment_id='PMT-B'`, `estado='recibido'`.
7. `registrar_pago_mp(org1, F2, 30000, 'PMT-C', link_F2)` [service_role] con saldo ya en 0 → **sin fila nueva en `pagos`**; todo (30000) va a `anticipos` `origen_tipo='excedente'`, `mp_payment_id='PMT-C'` (ningún peso aprobado queda sin registro).

*Proforma → anticipo → bloqueo de rechazo → aplicar (auto):*
8. Fabricar proforma: `crear_orden_entrega` + `asignar_despacho` (patrón transporte) → `crear_proforma(org1, cliente, [ODE])` → `cambiar_estado_proforma` a `'enviada'` → `'aprobada'`. Proforma total = **P** (leer el total real de la proforma; el link paga el TOTAL).
9. `crear_link_pago(org1, link_PF, 'proforma', proforma_id, 'pref-e2e-4', 'https://mock/...', P)` [dueño] con `link_PF = randomUUID()`; `registrar_anticipo_mp(org1, 'proforma', proforma_id, P, 'PMT-D', link_PF)` [service_role] → `anticipos` = 1 fila `origen_tipo='proforma'`, `estado='recibido'`, `mp_payment_id='PMT-D'`; `link_PF` = `pagado`.
10. `registrar_anticipo_mp(org1, 'proforma', proforma_id, P, 'PMT-D', link_PF)` [service_role] OTRA VEZ → **idempotente**: anticipos de esa proforma sigue = 1.
11. `cambiar_estado_proforma(org1, proforma_id, 'rechazada')` [dueño] → **throws** con mensaje EXACTO `'La proforma tiene un anticipo recibido; gestiona la devolución primero'` (el dinero encima bloquea el rechazo). La proforma sigue `'aprobada'`.
12. `facturar_proforma(org1, proforma_id)` [dueño] → crea `nota_venta` borrador; **service_role** lo lleva a `estado='emitido'`, `tipo='factura'`, `emitido_en=now()`, folio → `doc_PF` con saldo = P.
13. `aplicar_anticipo(org1, doc_PF)` [service_role, = el hook] → el anticipo `'PMT-D'` pasa a `'aplicado'` con `pago_id`/`documento_venta_id` seteados; se crea 1 pago `metodo='mercadopago'`, `mp_payment_id='PMT-D'`; saldo de `doc_PF` = 0.
14. `aplicar_anticipo(org1, doc_PF)` [service_role] OTRA VEZ → **no-op** (anticipo ya `aplicado`): pagos de `doc_PF` sigue = 1, saldo sigue 0 (doble aplicación imposible).

*Cotización → anticipo:*
15. `crear_cotizacion(...)` [dueño] → `cambiar_estado_cotizacion(org1, cot_id, 'aceptada', ...)`. Total = **C**. `crear_link_pago(org1, link_COT, 'cotizacion', cot_id, 'pref-e2e-5', 'https://mock/...', C)` [dueño] con `link_COT = randomUUID()`; `registrar_anticipo_mp(org1, 'cotizacion', cot_id, C, 'PMT-E', link_COT)` [service_role] → anticipo `origen_tipo='cotizacion'`, `estado='recibido'`, `mp_payment_id='PMT-E'`.

*Aplicar manual (botón de /cobranza):*
16. `aplicar_anticipo_manual(org1, anticipo_PMT-E, F4)` [dueño] → el anticipo `'PMT-E'` pasa a `'aplicado'`; se crea 1 pago `metodo='mercadopago'` en F4 hasta su saldo; saldo de F4 = 0.
17. `aplicar_anticipo_manual(org1, anticipo_PMT-E, F4)` [dueño] OTRA VEZ → **throws** `'El anticipo no existe o ya fue aplicado'` (ya aplicado).

*Aislamiento cross-tenant (org2):*
18. Como dueño de **org2**: `crear_link_pago(org1, randomUUID(), 'factura', F1, 'pref-x', 'url', 100000)` → **throws** `'Tu rol no permite generar links de pago'` (`tiene_rol_en_empresa` es false para un usuario ajeno).
19. Como dueño de org2: `select` sobre `links_pago` y `anticipos` → **0 filas de org1** (RLS del invoker aísla; los `.eq('empresa_id', org2)` de la UI son backstop).
20. `registrar_pago_mp(org2, F1, 100000, 'PMT-Z', null)` [service_role] → **throws** `'El documento no existe'` (F1 no pertenece a org2); F1 sin cambios (sigue con 1 pago, saldo 0).

Si alguna aserción falla: defecto real → **BLOCKED** con detalle.

- [ ] **Step 3: Click-through del flujo completo HTTP (webhook + MockPasarela + hook de emisión)**

Checklist (browser + dev server; documentar el resultado de CADA ítem en el reporte):

1. Dev server reiniciado tras el build (`pnpm --filter erp dev`, puerto 3001); login `demo@suite-erp.cl` / `demo1234` (resembrar si la demo está vencida — es perecible).
2. **Configurar el mock**: la MockPasarela es el DEFAULT (espejo de `proveedorPorAmbiente` — sin `PAGOS_AMBIENTE=produccion` ni credenciales reales queda en mock, sin tocar env). En `/configuracion/pagos` (dueño/admin) guardar token + secret MOCK de la empresa demo → estado **configurado ✓**; copiar la URL de webhook que muestra la tarjeta (`{base}/api/webhooks/mercadopago/{empresaId}`).
3. **Factura → link → pago aparece**: `/ventas/[id]` de una factura emitida con saldo → botón **Generar link** → aparece la URL (`/mock-pago/[id]`) + copiar. Abrir `/mock-pago/[id]` → muestra el monto → **Simular pago aprobado** (POST al webhook REAL de la empresa con firma mock) → en `/cobranza` el pago aparece con método `mercadopago` y la factura queda en saldo 0. Re-clic **Simular pago aprobado** (mismo payment) → `/cobranza` **NO duplica** el pago (idempotencia por `mp_payment_id`).
4. **Proforma → anticipo → bloqueo → facturar+emitir → aplicado solo**: `/proformas/[id]` (aprobada) → Generar link → `/mock-pago` → Simular → `/cobranza` sección **Anticipos**: fila `recibido` (cliente, origen PF-N°, monto, fecha). Intentar **rechazar** la proforma en `/proformas/[id]` → error `'La proforma tiene un anticipo recibido; gestiona la devolución primero'`. Facturar la proforma → **emitir el DTE** (`emitirDocumento`, que dispara el hook `aplicarAnticipoDocumento`) → el anticipo pasa a `aplicado` **solo** y la factura queda saldada (saldo 0, un pago `mercadopago`).
5. **Cotización → anticipo → aplicar manual**: `/cotizaciones/[id]` (aceptada) → Generar link → `/mock-pago` → Simular → Anticipos: fila `recibido` origen cotización N°. Botón **Aplicar** → modal elige una factura emitida con saldo del MISMO cliente → el anticipo pasa a `aplicado` y la factura queda saldada.
6. **Regenerar link**: en la misma factura, Generar link de nuevo → el anterior queda `reemplazado`, vigente el nuevo (un solo link vigente por objeto).
7. **Firma inválida → sin efectos**: POST manual al webhook con `x-signature` basura (PowerShell `Invoke-WebRequest -Method POST -Uri "{base}/api/webhooks/mercadopago/{empresaId}" -Headers @{'x-signature'='ts=1,v1=deadbeef'} -Body '{"data":{"id":"1"}}'`) → **HTTP 200** y `/cobranza` SIN cambios (ningún pago/anticipo nuevo); log de alerta server-side en el no-op permanente.
8. **URL de otra empresa → sin efectos**: configurar una **segunda empresa** con su propio mock; disparar el `/mock-pago` de un pago cuyo `external_reference` lleva la empresa A contra la URL de webhook de la empresa **B** (segmento empresa ≠ `[empresaId]`) → **HTTP 200**, sin efectos en A ni en B (200 + alerta).
9. **El token cifrado JAMÁS viaja al cliente**: en `/configuracion/pagos` inspeccionar el HTML/red → solo el estado ✓/✗, nunca el token; los selects de `/cobranza` y de las páginas de detalle no traen `mp_access_token_cifrado`/`mp_webhook_secret_cifrado`.

- [ ] **Step 4: Reporte y cleanup**

Cleanup FK-safe del script (service_role), cada delete seguido de `select count(*)` = **0** para las filas de ambas orgs, en ORDEN de dependencia:
`anticipos` → `links_pago` → `pagos_aplicaciones` → `pagos` → `documentos_venta_lineas` → `ordenes_entrega` → `proformas` → `cotizaciones_lineas` → `cotizaciones` → `documentos_venta` → `vehiculos` → `conductores` → `destinos` → `clientes` → `suscripciones` → `miembros` → `empresas` → `organizaciones` → `auth.users` (los usuarios creados) + borrar el script.

`.superpowers/sdd/task-9-plan13-report.md` con el resultado del pipeline (152 / 240 / 3 builds), las 20 aserciones del script E2E (a) y el checklist HTTP (b) ítem por ítem; borrar del scratchpad el script al cerrar.

---

## Verificación final del plan

- `pnpm test` (**152**: core 126, auth 2, dte 10, pagos 14) + `pnpm supabase test db` (**240**: 211 previos + mercadopago `plan(29)`) + `pnpm build --concurrency=1` (**3 apps**) verdes.
- Ciclo completo: se configura MercadoPago cifrado por empresa (token/secret que jamás viajan al cliente ni a los logs) → link de pago desde una factura emitida (por su saldo), una proforma aprobada o una cotización aceptada (por su total → anticipo) → el cliente paga y el webhook POR EMPRESA registra el dinero solo, conciliado contra la factura o como anticipo → **ningún peso aprobado queda sin registro**: webhook repetido no duplica (idempotencia por `mp_payment_id`), pago mayor al saldo se parte en pago + excedente-anticipo, y el anticipo se aplica solo al emitir la factura del origen (hook nunca-lanza) o con el botón de /cobranza → una proforma con plata encima NO se puede rechazar sin resolver la devolución → firma inválida o payment de otra empresa no producen efectos (200 + alerta, sin tocar dinero) → todo aislado por empresa y operando completo con MockPasarela hasta las credenciales reales.
- Criterio de éxito del spec §10 cumplido.

