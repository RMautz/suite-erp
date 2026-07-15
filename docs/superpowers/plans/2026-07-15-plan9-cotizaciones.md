# Plan 9: Cotizaciones (cotización → nota de venta) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cotizar con precios negociables por línea, gestionar el ciclo borrador→enviada→aceptada/rechazada, y convertir la aceptada en una nota de venta en borrador con los precios COTIZADOS — enganchando con el flujo existente de emisión DTE sin tocarlo.

**Architecture:** Tabla propia `cotizaciones`+líneas (patrón `ordenes_compra`: correlativo por empresa con advisory lock, estados con transiciones validadas); TODA escritura vía 3 RPCs security definer (`crear_cotizacion`, `cambiar_estado_cotizacion`, `convertir_cotizacion`); la conversión inserta `documentos_venta` tipo `'nota_venta'` estado `'borrador'` re-validando producto activo/exención; pantallas bajo `/cotizaciones` espejo de ventas/por-pagar; vista imprimible con variante `print:` de Tailwind.

**Tech Stack:** Next.js 15, Supabase (Postgres 17, RLS, pgTAP), Vitest (TDD en `@suite/core`: 2 funciones puras nuevas), TypeScript, Tailwind CSS 4.

**Spec:** `docs/superpowers/specs/2026-07-15-plan9-cotizaciones-design.md` (aprobado 2026-07-15).

## Global Constraints

- Multi-tenant: tablas nuevas con `empresa_id` + RLS + grants explícitos; FK compuestas `(empresa_id, x_id) references tabla (empresa_id, id)`; `unique (empresa_id, id)` se exige SOLO en las tablas que serán el DESTINO de una FK compuesta de otra tabla — `cotizaciones` lo lleva (`cotizaciones_lineas` le hace FK compuesta vía `cotizacion_id`), `cotizaciones_lineas` NO (nadie le hace FK compuesta a sus filas; espejo de `documentos_venta_lineas`); app queries `.eq('empresa_id', activa.id)` con `activa` de `obtenerEmpresaActiva()`, jamás del formulario.
- `cotizaciones`/`cotizaciones_lineas`: CERO escritura directa de `authenticated` (ni policies ni grants de insert/update/delete — lección migraciones 4→7); policy única de `select` para miembros; `grant select` a authenticated; `grant select, insert, update, delete` a service_role. Toda escritura por RPC.
- Roles: crear/gestionar/convertir = `dueno`/`admin`/`vendedor`; `contador` y `bodeguero` NO escriben; lectura = cualquier miembro.
- Máquina de estados EXACTA: `borrador→enviada|rechazada`; `enviada→aceptada|rechazada` (aceptar exige `fecha_validez >= current_date`); `aceptada→convertida` SOLO vía `convertir_cotizacion` y SIN condición de fecha (la aceptación congela el trato). Todo lo demás → `'Transición de estado no válida'` (incluye `p_estado='convertida'` o valores fuera del enum).
- Precios negociables: `precio_neto` entero `>= 0` viene del llamador; `descripcion` y `exenta` vienen DEL PRODUCTO (jamás del llamador); producto y cliente deben ser de la empresa Y ACTIVOS (`'Producto no válido'` / `'Cliente no válido'` cubren inexistente, ajeno e inactivo).
- Conversión: re-valida por línea producto activo y `productos.exento = linea.exenta`; copia `producto_id`, `descripcion`, `cantidad`, `precio_neto` COTIZADO, `exenta`, `subtotal`; crea `documentos_venta` (`tipo='nota_venta'`, `estado='borrador'`, mismo cliente, totales de la cotización; las notas NO viajan); marca `convertida` + `documento_venta_id`; retorna el id del documento.
- Totales server-side con el MISMO criterio de `crear_documento_venta` (neto = Σ subtotales no exentos, exento = Σ exentos, IVA = round(neto × 0.19) con el mismo redondeo SQL).
- Correlativo: `pg_advisory_xact_lock(hashtextextended('cotizaciones:' || p_empresa::text, 42))` + `select coalesce(max(numero), 0) + 1` DENTRO del lock (patrón `crear_orden_compra` literal).
- Lookups de RPC SIEMPRE `where id = p_cotizacion and empresa_id = p_empresa for update`; 0 filas → `'La cotización no existe'` (no distingue inexistente de otro-tenant).
- Normalización de textos: `p_notas`/`p_motivo` con `nullif(trim(coalesce(..., '')), '')`; motivo whitespace-only = vacío; `p_motivo` solo se persiste al rechazar; `if p_validez is null or p_validez < current_date` → `'La fecha de validez no puede ser anterior a hoy'`.
- Mensajes exactos (contrato pgTAP): `'Tu rol no permite crear cotizaciones'`, `'Tu rol no permite gestionar cotizaciones'`, `'Tu rol no permite convertir cotizaciones'`, `'Cliente no válido'`, `'Producto no válido'`, `'La cotización necesita al menos una línea'`, `'La cantidad debe ser al menos 1'`, `'El precio debe ser un entero mayor o igual a 0'`, `'La fecha de validez no puede ser anterior a hoy'`, `'Transición de estado no válida'`, `'El rechazo requiere un motivo'`, `'La cotización no existe'`, `'La cotización está vencida'`, `'Solo se puede convertir una cotización aceptada'`, `'Un producto de la cotización ya no está disponible o cambió su condición de IVA; crea una nueva cotización'`.
- Insignia **Vencida**: SOLO estados `borrador`/`enviada` con `fecha_validez < hoy` (comparación lexicográfica de fechas ISO); `aceptada`/`rechazada`/`convertida` NUNCA la muestran.
- Tolerancia de casts jsonb (igual `crear_orden_compra`): mensajes contractuales cubren null y fuera de rango tras cast exitoso; valores no casteables abortan con error crudo de Postgres.
- CERO BOM literal en fuentes (escribir siempre el escape `\uFEFF`; verificar con byte-scan `grep -c $'\xEF\xBB\xBF'` = 0); UTF-8 sin BOM; español; CLP entero.
- Windows/PowerShell 5.1: `&&` no encadena; prefijar todo comando con `$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User');`.

---
### Task 1: Migración 0014 — cotizaciones, líneas y RPCs de ciclo de vida

**Files:**
- Create: `supabase/migrations/00000000000014_cotizaciones.sql`

**Interfaces:**
- Consumes: `clientes`/`productos`/`documentos_venta` (todas con `unique (empresa_id, id)` — migración 0004), `documentos_venta_lineas`, `app.mis_empresas()`, `app.tiene_rol_en_empresa(uuid, text[])`.
- Produces: tablas `cotizaciones`, `cotizaciones_lineas`; RPCs `crear_cotizacion(p_empresa uuid, p_cliente uuid, p_validez date, p_notas text, p_lineas jsonb) returns uuid`, `cambiar_estado_cotizacion(p_empresa uuid, p_cotizacion uuid, p_estado text, p_motivo text default null) returns void`, `convertir_cotizacion(p_empresa uuid, p_cotizacion uuid) returns uuid`. jsonb de líneas: `[{"productoId": "<uuid>", "cantidad": 3, "precioNeto": 8000}]`.
- La conversión NO toma folio ni toca `folios_caf`: la nota de venta nace en `borrador` sin folio (igual que `crear_documento_venta`); el folio se toma al EMITIR vía `tomar_folio`, flujo existente intacto.

- [ ] **Step 1: Escribir la migración**

`supabase/migrations/00000000000014_cotizaciones.sql`:

```sql
-- Cotizaciones: paso comercial previo a la venta. Correlativo por empresa
-- (advisory lock, patron ordenes_compra), precios negociables por linea,
-- maquina de estados validada en RPC y conversion a nota de venta en borrador
-- con los precios COTIZADOS. Sin folio SII: el folio se toma al emitir.

-- ---------- Cotizaciones (cabecera) ----------
create table public.cotizaciones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  numero integer not null,
  cliente_id uuid not null,
  -- SIN check contra la fecha de creacion: la validacion vive solo en la RPC,
  -- asi los fixtures de test pueden backdatear via service_role/superuser.
  fecha_validez date not null,
  notas text,
  neto integer not null default 0 check (neto >= 0),
  exento integer not null default 0 check (exento >= 0),
  iva integer not null default 0 check (iva >= 0),
  total integer not null default 0 check (total >= 0 and total = neto + exento + iva),
  estado text not null default 'borrador'
    check (estado in ('borrador', 'enviada', 'aceptada', 'rechazada', 'convertida')),
  motivo_rechazo text,
  documento_venta_id uuid,
  creado_en timestamptz not null default now(),
  unique (empresa_id, numero),
  unique (empresa_id, id),
  foreign key (empresa_id, cliente_id) references public.clientes (empresa_id, id),
  -- Nota de venta generada por la conversion (nullable hasta convertir).
  foreign key (empresa_id, documento_venta_id) references public.documentos_venta (empresa_id, id)
);
create index cotizaciones_lista_idx on public.cotizaciones (empresa_id, estado, creado_en desc);

-- ---------- Lineas (precio COTIZADO, negociado por el vendedor) ----------
create table public.cotizaciones_lineas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  cotizacion_id uuid not null,
  producto_id uuid not null,
  descripcion text not null,
  cantidad integer not null check (cantidad > 0),
  precio_neto integer not null check (precio_neto >= 0),
  exenta boolean not null default false,
  subtotal integer not null check (subtotal >= 0),
  foreign key (empresa_id, cotizacion_id) references public.cotizaciones (empresa_id, id) on delete cascade,
  foreign key (empresa_id, producto_id) references public.productos (empresa_id, id)
);
create index cotizaciones_lineas_cotizacion_idx on public.cotizaciones_lineas (empresa_id, cotizacion_id);

-- ---------- RLS ----------
alter table public.cotizaciones enable row level security;
alter table public.cotizaciones_lineas enable row level security;

create policy "miembros ven cotizaciones" on public.cotizaciones
  for select to authenticated using (empresa_id in (select app.mis_empresas()));
create policy "miembros ven lineas de cotizacion" on public.cotizaciones_lineas
  for select to authenticated using (empresa_id in (select app.mis_empresas()));

-- ---------- Grants Data API (leccion Plan 1) ----------
-- CERO escritura directa de authenticated: toda escritura entra por RPC.
grant select on public.cotizaciones, public.cotizaciones_lineas to authenticated;
grant select, insert, update, delete on public.cotizaciones, public.cotizaciones_lineas to service_role;

-- ---------- Crear cotizacion (numeracion correlativa atomica) ----------
-- descripcion y exenta vienen DEL PRODUCTO (fuente de verdad tributaria);
-- el precio_neto viene del llamador: es la unica diferencia deliberada con
-- crear_documento_venta (precio negociable por linea).
create or replace function public.crear_cotizacion(
  p_empresa uuid, p_cliente uuid, p_validez date, p_notas text, p_lineas jsonb
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_cotizacion uuid;
  v_numero integer;
  v_neto integer := 0;
  v_exento integer := 0;
  v_iva integer;
  v_linea jsonb;
  v_nombre text;
  v_exenta boolean;
  v_cant integer;
  v_precio integer;
  v_sub integer;
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'vendedor']) then
    raise exception 'Tu rol no permite crear cotizaciones';
  end if;
  -- Cubre inexistente, ajeno e inactivo con el mismo mensaje.
  if not exists (select 1 from clientes where id = p_cliente and empresa_id = p_empresa and activo) then
    raise exception 'Cliente no válido';
  end if;
  -- El default hoy+30 lo pone la UI; la RPC no lo suple.
  if p_validez is null or p_validez < current_date then
    raise exception 'La fecha de validez no puede ser anterior a hoy';
  end if;
  if p_lineas is null or jsonb_array_length(p_lineas) = 0 then
    raise exception 'La cotización necesita al menos una línea';
  end if;

  -- Serializa la numeracion por empresa (dos creaciones concurrentes no chocan el unique).
  perform pg_advisory_xact_lock(hashtextextended('cotizaciones:' || p_empresa::text, 42));
  select coalesce(max(numero), 0) + 1 into v_numero from cotizaciones where empresa_id = p_empresa;

  insert into cotizaciones (empresa_id, numero, cliente_id, fecha_validez, notas)
  values (p_empresa, v_numero, p_cliente, p_validez, nullif(trim(coalesce(p_notas, '')), ''))
  returning id into v_cotizacion;

  for v_linea in select * from jsonb_array_elements(p_lineas) loop
    select nombre, exento into v_nombre, v_exenta
    from productos
    where id = (v_linea->>'productoId')::uuid and empresa_id = p_empresa and activo;
    if not found then
      raise exception 'Producto no válido';
    end if;
    v_cant := (v_linea->>'cantidad')::integer;
    v_precio := (v_linea->>'precioNeto')::integer;
    if v_cant is null or v_cant < 1 then
      raise exception 'La cantidad debe ser al menos 1';
    end if;
    if v_precio is null or v_precio < 0 then
      raise exception 'El precio debe ser un entero mayor o igual a 0';
    end if;
    v_sub := round(v_cant * v_precio);
    insert into cotizaciones_lineas (empresa_id, cotizacion_id, producto_id, descripcion, cantidad, precio_neto, exenta, subtotal)
    values (p_empresa, v_cotizacion, (v_linea->>'productoId')::uuid, v_nombre, v_cant, v_precio, v_exenta, v_sub);
    if v_exenta then v_exento := v_exento + v_sub; else v_neto := v_neto + v_sub; end if;
  end loop;

  -- Mismo criterio y redondeo que crear_documento_venta.
  v_iva := round(v_neto * 0.19);
  update cotizaciones set neto = v_neto, exento = v_exento, iva = v_iva, total = v_neto + v_exento + v_iva
  where id = v_cotizacion and empresa_id = p_empresa;

  return v_cotizacion;
end $$;
revoke execute on function public.crear_cotizacion(uuid, uuid, date, text, jsonb) from anon, public;
grant execute on function public.crear_cotizacion(uuid, uuid, date, text, jsonb) to authenticated;

-- ---------- Cambiar estado (maquina de estados; 'convertida' vetada aqui) ----------
create or replace function public.cambiar_estado_cotizacion(
  p_empresa uuid, p_cotizacion uuid, p_estado text, p_motivo text default null
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_actual text;
  v_validez date;
  v_motivo text;
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'vendedor']) then
    raise exception 'Tu rol no permite gestionar cotizaciones';
  end if;

  -- Lock: una transicion no se cruza con una conversion en vuelo.
  select estado, fecha_validez into v_actual, v_validez
  from cotizaciones where id = p_cotizacion and empresa_id = p_empresa
  for update;
  if not found then
    -- Cubre por igual inexistente y de-otro-tenant, sin distinguirlos.
    raise exception 'La cotización no existe';
  end if;

  -- borrador -> enviada | rechazada; enviada -> aceptada | rechazada.
  -- 'convertida' SOLO via convertir_cotizacion; todo lo demas es invalido.
  if p_estado is null or not (
    (v_actual = 'borrador' and p_estado in ('enviada', 'rechazada')) or
    (v_actual = 'enviada' and p_estado in ('aceptada', 'rechazada'))
  ) then
    raise exception 'Transición de estado no válida';
  end if;

  -- Aceptar exige vigencia (una vez aceptada, el trato queda congelado).
  if p_estado = 'aceptada' and v_validez < current_date then
    raise exception 'La cotización está vencida';
  end if;

  v_motivo := nullif(trim(coalesce(p_motivo, '')), '');
  if p_estado = 'rechazada' and v_motivo is null then
    raise exception 'El rechazo requiere un motivo';
  end if;

  update cotizaciones
  set estado = p_estado,
      -- p_motivo solo se persiste al rechazar; en el resto queda null.
      motivo_rechazo = case when p_estado = 'rechazada' then v_motivo else null end
  where id = p_cotizacion and empresa_id = p_empresa;
end $$;
revoke execute on function public.cambiar_estado_cotizacion(uuid, uuid, text, text) from anon, public;
grant execute on function public.cambiar_estado_cotizacion(uuid, uuid, text, text) to authenticated;

-- ---------- Convertir a nota de venta (atomica; sin condicion de fecha) ----------
create or replace function public.convertir_cotizacion(p_empresa uuid, p_cotizacion uuid)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_cot record;
  v_doc uuid;
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'vendedor']) then
    raise exception 'Tu rol no permite convertir cotizaciones';
  end if;

  -- Lock: el check de estado corre DENTRO del lock (doble conversion imposible).
  select estado, cliente_id, neto, exento, iva, total into v_cot
  from cotizaciones where id = p_cotizacion and empresa_id = p_empresa
  for update;
  if not found then
    raise exception 'La cotización no existe';
  end if;
  if v_cot.estado <> 'aceptada' then
    raise exception 'Solo se puede convertir una cotización aceptada';
  end if;

  -- Re-validacion tributaria por linea: el producto sigue activo y su exencion
  -- no cambio desde que se cotizo (la exencion NO es negociable).
  if exists (
    select 1 from cotizaciones_lineas l
    where l.cotizacion_id = p_cotizacion and l.empresa_id = p_empresa
      and not exists (
        select 1 from productos p
        where p.id = l.producto_id and p.empresa_id = l.empresa_id
          and p.activo and p.exento = l.exenta
      )
  ) then
    raise exception 'Un producto de la cotización ya no está disponible o cambió su condición de IVA; crea una nueva cotización';
  end if;

  -- Nota de venta en borrador con los totales COTIZADOS. Sin folio ni folios_caf:
  -- el folio se toma al emitir (tomar_folio), igual que crear_documento_venta.
  -- Las notas de la cotizacion NO viajan (documentos_venta no tiene esa columna).
  insert into documentos_venta (empresa_id, tipo, cliente_id, estado, neto, exento, iva, total)
  values (p_empresa, 'nota_venta', v_cot.cliente_id, 'borrador', v_cot.neto, v_cot.exento, v_cot.iva, v_cot.total)
  returning id into v_doc;

  insert into documentos_venta_lineas (empresa_id, documento_id, producto_id, descripcion, cantidad, precio_neto, exenta, subtotal)
  select l.empresa_id, v_doc, l.producto_id, l.descripcion, l.cantidad, l.precio_neto, l.exenta, l.subtotal
  from cotizaciones_lineas l
  where l.cotizacion_id = p_cotizacion and l.empresa_id = p_empresa;

  update cotizaciones set estado = 'convertida', documento_venta_id = v_doc
  where id = p_cotizacion and empresa_id = p_empresa;

  return v_doc;
end $$;
revoke execute on function public.convertir_cotizacion(uuid, uuid) from anon, public;
grant execute on function public.convertir_cotizacion(uuid, uuid) to authenticated;
```

- [ ] **Step 2: Aplicar y verificar**

Run: `pnpm supabase db reset` → aplica 0001-0014 sin errores.
Run: `pnpm supabase test db` → los 106 asserts existentes siguen verdes (9 archivos).
Smoke: `docker exec supabase_db_ERP_Transportes psql -U postgres -d postgres -c "select has_table_privilege('authenticated','public.cotizaciones','insert');"` → **f** (cero escritura directa); same con `'select'` → **t**; `has_function_privilege('anon','public.crear_cotizacion(uuid,uuid,date,text,jsonb)','execute')` → **f**.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/00000000000014_cotizaciones.sql
git commit -m "feat(db): cotizaciones con correlativo, estados y conversión a nota de venta"
```

---

### Task 2: pgTAP de cotizaciones

**Files:**
- Create: `supabase/tests/database/cotizaciones.test.sql`

**Interfaces:**
- Consumes: migración 0014 (Task 1). RUTs NUEVOS reservados para este archivo (válidos módulo 11 y sin colisión con `761111116`/`762222221`/`765432103`/`765432104` de los tests existentes ni `771234569` del seed): `763333337` (Org/Empresa A), `764444442` (Org/Empresa B), `765555558` (Cliente A), `767777779` (Cliente Inactivo A), `766666663` (Cliente B).
- Fixture "vencida": se backdatea `fecha_validez` vía UPDATE directo con `reset role` (superuser) — la tabla no tiene check contra `creado_en` a propósito para permitirlo.

- [ ] **Step 1: Escribir el test**

`supabase/tests/database/cotizaciones.test.sql`:

```sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'ana@a.cl'),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'beto@b.cl'),
  ('00000000-0000-0000-0000-000000000000', '55555555-5555-5555-5555-555555555555', 'authenticated', 'authenticated', 'ces@a.cl'),
  ('00000000-0000-0000-0000-000000000000', '66666666-6666-6666-6666-666666666666', 'authenticated', 'authenticated', 'dora@a.cl'),
  ('00000000-0000-0000-0000-000000000000', '77777777-7777-7777-7777-777777777777', 'authenticated', 'authenticated', 'vero@a.cl');

-- RUT nuevos: no colisionan con otros tests (7611/7622/76543210x) ni con el seed (771234569).
insert into public.organizaciones (id, rut, razon_social)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '763333337', 'Org A'),
       ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '764444442', 'Org B');

insert into public.empresas (id, organizacion_id, rut, razon_social)
values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '763333337', 'Empresa A'),
       ('eeeeeeee-0000-0000-0000-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '764444442', 'Empresa B');

insert into public.miembros (usuario_id, organizacion_id, rol)
values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'dueno'),
       ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'dueno'),
       ('55555555-5555-5555-5555-555555555555', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'contador'),
       ('66666666-6666-6666-6666-666666666666', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bodeguero'),
       ('77777777-7777-7777-7777-777777777777', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'vendedor');

insert into public.clientes (id, empresa_id, rut, razon_social)
values ('cccccccc-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '765555558', 'Cliente A'),
       ('cccccccc-0000-0000-0000-bbbbbbbbbbbb', 'eeeeeeee-0000-0000-0000-bbbbbbbbbbbb', '766666663', 'Cliente B');
insert into public.clientes (id, empresa_id, rut, razon_social, activo)
values ('cccccccc-1111-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '767777779', 'Cliente Inactivo', false);

-- P1 afecto (lista 10000), P2 exento (lista 5000), P3 afecto (se desactivara), PB de la empresa B.
insert into public.productos (id, empresa_id, sku, nombre, precio_neto, exento)
values ('99999999-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'P1', 'Producto Afecto', 10000, false),
       ('99999999-1111-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'P2', 'Producto Exento', 5000, true),
       ('99999999-2222-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'P3', 'Producto Fragil', 2000, false),
       ('99999999-0000-0000-0000-bbbbbbbbbbbb', 'eeeeeeee-0000-0000-0000-bbbbbbbbbbbb', 'PB', 'Producto B', 7000, false);

-- QB: cotizacion de la empresa B (fixture directo; totales 0 cumplen el check).
insert into public.cotizaciones (id, empresa_id, numero, cliente_id, fecha_validez)
values ('c0c0c0c0-0000-0000-0000-bbbbbbbbbbbb', 'eeeeeeee-0000-0000-0000-bbbbbbbbbbbb', 1,
        'cccccccc-0000-0000-0000-bbbbbbbbbbbb', current_date + 30);

-- ===== Ana (duena A) =====
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- 1) Ana crea C1 con precios negociados (P1: lista 10000 -> cotizado 8000).
--    neto 24000 + exento 10000 + iva 4560 = 38560.
select lives_ok(
  $$select crear_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
    current_date + 30, 'Descuento por volumen',
    '[{"productoId":"99999999-0000-0000-0000-aaaaaaaaaaaa","cantidad":3,"precioNeto":8000},
      {"productoId":"99999999-1111-0000-0000-aaaaaaaaaaaa","cantidad":2,"precioNeto":5000}]'::jsonb)$$,
  'la dueña crea una cotización con precios negociados'
);

-- Setup sin assert: Vero (vendedora) crea C2 — si el rol vendedor no pudiera,
-- esta llamada abortaria la transaccion del test (y el 2 de abajo no existiria).
set local request.jwt.claims to '{"sub": "77777777-7777-7777-7777-777777777777", "role": "authenticated"}';
select crear_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
  current_date + 30, null,
  '[{"productoId":"99999999-0000-0000-0000-aaaaaaaaaaaa","cantidad":1,"precioNeto":10000}]'::jsonb);

-- 2) Correlativo secuencial: 1 (Ana) y 2 (la vendedora SI cotiza).
select results_eq(
  $$select numero from cotizaciones where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' order by numero$$,
  array[1, 2],
  'los correlativos son secuenciales y la vendedora sí cotiza'
);

-- 3) Dora (bodeguera) NO crea cotizaciones.
set local request.jwt.claims to '{"sub": "66666666-6666-6666-6666-666666666666", "role": "authenticated"}';
select throws_ok(
  $$select crear_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
    current_date + 30, null, '[{"productoId":"99999999-0000-0000-0000-aaaaaaaaaaaa","cantidad":1,"precioNeto":1}]'::jsonb)$$,
  'P0001', 'Tu rol no permite crear cotizaciones',
  'la bodeguera no puede crear cotizaciones'
);

-- 4) Ces (contador) NO gestiona cotizaciones.
set local request.jwt.claims to '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated"}';
select throws_ok(
  $$select cambiar_estado_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from cotizaciones where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1), 'enviada')$$,
  'P0001', 'Tu rol no permite gestionar cotizaciones',
  'el contador no puede gestionar cotizaciones'
);

-- 5) Ces (contador) NO convierte cotizaciones (rol denegado en las 3 RPCs).
select throws_ok(
  $$select convertir_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from cotizaciones where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1))$$,
  'P0001', 'Tu rol no permite convertir cotizaciones',
  'el contador no puede convertir cotizaciones'
);

-- ===== Ana: validaciones de crear =====
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- 6) El precio cotizado no puede ser negativo (el precio SI viene del llamador).
select throws_ok(
  $$select crear_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
    current_date + 30, null, '[{"productoId":"99999999-0000-0000-0000-aaaaaaaaaaaa","cantidad":1,"precioNeto":-1}]'::jsonb)$$,
  'P0001', 'El precio debe ser un entero mayor o igual a 0',
  'el precio cotizado no puede ser negativo'
);

-- 7) Producto de otra empresa (mismo mensaje que inexistente o inactivo).
select throws_ok(
  $$select crear_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
    current_date + 30, null, '[{"productoId":"99999999-0000-0000-0000-bbbbbbbbbbbb","cantidad":1,"precioNeto":1000}]'::jsonb)$$,
  'P0001', 'Producto no válido',
  'no se cotiza un producto de otra empresa'
);

-- 8) Cliente inactivo (mismo mensaje que inexistente o ajeno).
select throws_ok(
  $$select crear_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-1111-0000-0000-aaaaaaaaaaaa',
    current_date + 30, null, '[{"productoId":"99999999-0000-0000-0000-aaaaaaaaaaaa","cantidad":1,"precioNeto":1000}]'::jsonb)$$,
  'P0001', 'Cliente no válido',
  'no se cotiza a un cliente inactivo'
);

-- 9) Sin líneas ('[]'::jsonb): la cotización necesita al menos una.
select throws_ok(
  $$select crear_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
    current_date + 30, null, '[]'::jsonb)$$,
  'P0001', 'La cotización necesita al menos una línea',
  'una cotización no se crea sin líneas'
);

-- 10) Cantidad 0 no es válida (mínimo 1).
select throws_ok(
  $$select crear_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
    current_date + 30, null, '[{"productoId":"99999999-0000-0000-0000-aaaaaaaaaaaa","cantidad":0,"precioNeto":1000}]'::jsonb)$$,
  'P0001', 'La cantidad debe ser al menos 1',
  'la cantidad no puede ser 0'
);

-- 11) Validez pasada.
select throws_ok(
  $$select crear_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
    current_date - 1, null, '[{"productoId":"99999999-0000-0000-0000-aaaaaaaaaaaa","cantidad":1,"precioNeto":1000}]'::jsonb)$$,
  'P0001', 'La fecha de validez no puede ser anterior a hoy',
  'la validez no puede ser anterior a hoy'
);

-- ===== Transiciones (C1 sigue en borrador) =====

-- 12) borrador -> aceptada es invalido (hay que enviar primero).
select throws_ok(
  $$select cambiar_estado_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from cotizaciones where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1), 'aceptada')$$,
  'P0001', 'Transición de estado no válida',
  'no se acepta una cotización en borrador'
);

-- 13) p_estado = 'convertida' esta vetado en la RPC de estado (mismo mensaje).
select throws_ok(
  $$select cambiar_estado_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from cotizaciones where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1), 'convertida')$$,
  'P0001', 'Transición de estado no válida',
  'convertida solo se alcanza vía convertir_cotizacion'
);

-- 14) Motivo de puro whitespace = motivo vacio (nullif/trim los iguala).
select throws_ok(
  $$select cambiar_estado_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from cotizaciones where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1), 'rechazada', '   ')$$,
  'P0001', 'El rechazo requiere un motivo',
  'el motivo de rechazo no puede ser vacío ni whitespace'
);

-- 15) Motivo NULL (sin motivo alguno) tampoco es válido para rechazar.
select throws_ok(
  $$select cambiar_estado_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from cotizaciones where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1), 'rechazada', null)$$,
  'P0001', 'El rechazo requiere un motivo',
  'el rechazo sin motivo (NULL) tampoco es válido'
);

-- 16) La cotizacion de la empresa B "no existe" para la empresa A.
select throws_ok(
  $$select cambiar_estado_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    'c0c0c0c0-0000-0000-0000-bbbbbbbbbbbb', 'enviada')$$,
  'P0001', 'La cotización no existe',
  'una cotización de otra empresa da el mismo mensaje que una inexistente'
);

-- 17) Convertir una cotizacion de otra empresa da el mismo mensaje que una inexistente.
select throws_ok(
  $$select convertir_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    'c0c0c0c0-0000-0000-0000-bbbbbbbbbbbb')$$,
  'P0001', 'La cotización no existe',
  'convertir una cotización de otra empresa da el mismo mensaje que una inexistente'
);

-- ===== Vigencia: C2 enviada y luego vencida =====
select cambiar_estado_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from cotizaciones where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 2), 'enviada');
-- Backdate como superuser: la tabla no tiene check contra creado_en a proposito.
reset role;
update public.cotizaciones set fecha_validez = current_date - 1
where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 2;
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- 18) Aceptar una vencida falla.
select throws_ok(
  $$select cambiar_estado_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from cotizaciones where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 2), 'aceptada')$$,
  'P0001', 'La cotización está vencida',
  'una cotización vencida no se puede aceptar'
);

-- ===== Conversion: C1 enviada -> aceptada (vigente) -> vencida -> convertida =====
select cambiar_estado_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from cotizaciones where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1), 'enviada');

-- 19) Convertir una no-aceptada falla.
select throws_ok(
  $$select convertir_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from cotizaciones where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1))$$,
  'P0001', 'Solo se puede convertir una cotización aceptada',
  'una cotización enviada (no aceptada) no se convierte'
);

-- Setup: Ana acepta C1 DENTRO de la vigencia; DESPUES la validez expira
-- (la aceptacion congelo el trato).
select cambiar_estado_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from cotizaciones where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1), 'aceptada');
reset role;
update public.cotizaciones set fecha_validez = current_date - 1
where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1;
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- 20) La aceptada-vencida SI se convierte (sin condicion de fecha).
select lives_ok(
  $$select convertir_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from cotizaciones where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1))$$,
  'una aceptada se convierte aunque la validez haya expirado después de aceptar'
);

-- 21) Nota de venta en borrador, enlazada, con el precio COTIZADO (8000, no 10000 de lista)
--     y los totales de la cotizacion (38560).
select is(
  (select d.tipo || '/' || d.estado || '/' || l.precio_neto::text || '/' || d.total::text
   from cotizaciones c
   join documentos_venta d on d.id = c.documento_venta_id and d.empresa_id = c.empresa_id
   join documentos_venta_lineas l on l.documento_id = d.id and l.empresa_id = d.empresa_id
     and l.producto_id = '99999999-0000-0000-0000-aaaaaaaaaaaa'
   where c.empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and c.numero = 1 and c.estado = 'convertida'),
  'nota_venta/borrador/8000/38560',
  'la conversión crea la nota de venta en borrador con los precios cotizados y queda enlazada'
);

-- 22) Doble conversion imposible (convertida ya no esta aceptada).
select throws_ok(
  $$select convertir_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from cotizaciones where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 1))$$,
  'P0001', 'Solo se puede convertir una cotización aceptada',
  'una cotización convertida no se convierte dos veces'
);

-- ===== Producto cambiado: C3 aceptada y P3 desactivado antes de convertir =====
select crear_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'cccccccc-0000-0000-0000-aaaaaaaaaaaa',
  current_date + 30, null,
  '[{"productoId":"99999999-2222-0000-0000-aaaaaaaaaaaa","cantidad":1,"precioNeto":2000}]'::jsonb);
select cambiar_estado_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from cotizaciones where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 3), 'enviada');
select cambiar_estado_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  (select id from cotizaciones where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 3), 'aceptada');
reset role;
update public.productos set activo = false where id = '99999999-2222-0000-0000-aaaaaaaaaaaa';
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- 23) La conversion re-valida el producto (misma via si cambio la exencion).
select throws_ok(
  $$select convertir_cotizacion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from cotizaciones where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and numero = 3))$$,
  'P0001', 'Un producto de la cotización ya no está disponible o cambió su condición de IVA; crea una nueva cotización',
  'no se convierte si un producto ya no está disponible'
);

-- 24) Beto (org B) solo ve su cotizacion QB: aislamiento en AMBAS tablas
--     (las 3 cotizaciones de A y sus 4 lineas serian visibles si la RLS fallara).
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
select is(
  (select count(*) from cotizaciones) + (select count(*) from cotizaciones_lineas),
  1::bigint,
  'Beto ve solo su cotización: las de la empresa A y sus líneas quedan aisladas'
);

-- 25) Escritura directa denegada: authenticated no puede insertar en cotizaciones (toda escritura es por RPC).
select throws_ok(
  $$insert into cotizaciones (empresa_id, numero, cliente_id, fecha_validez)
    values ('eeeeeeee-0000-0000-0000-bbbbbbbbbbbb', 999, 'cccccccc-0000-0000-0000-bbbbbbbbbbbb', current_date + 30)$$,
  '42501', 'permission denied for table cotizaciones',
  'authenticated no puede insertar directamente en cotizaciones'
);

-- 26) Anonimo denegado de plano.
set local request.jwt.claims to '{"role": "anon"}';
set local role anon;
select throws_ok(
  'select count(*) from cotizaciones',
  '42501', 'permission denied for table cotizaciones',
  'un anónimo no puede consultar cotizaciones'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Ejecutar**

Run: `pnpm supabase test db`
Expected: 10 archivos, **132 asserts** (aislamiento 6, cobranza 16, compras 19, cotizaciones 26, inventario 10, maestros 10, por_pagar 18, registro 7, reportes 11, ventas 9), todos verdes. Si un assert de cotizaciones falla, el sospechoso es la migración de Task 1 — NO debilitar el test (única adaptación permitida: el TEXTO exacto de mensajes nativos de Postgres, como el del assert 26, si la versión lo formula distinto; el CÓDIGO y los mensajes de las RPCs son el contrato).

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/database/cotizaciones.test.sql
git commit -m "test(db): pgTAP de cotizaciones — transiciones, vigencia y conversión"
```

---
### Task 3: Regenerar tipos `@suite/db`

**Files:**
- Modify: `packages/db/src/types.ts` (regenerado)

- [ ] **Step 1: Regenerar y verificar**

Run: `pnpm --filter @suite/db gen`
Expected: `types.ts` gana 5 símbolos: tablas `cotizaciones`, `cotizaciones_lineas`; Functions `crear_cotizacion`, `cambiar_estado_cotizacion`, `convertir_cotizacion` (verificar por grep; faltante → BLOCKED).

Run: `pnpm tsc --noEmit -p packages/db/tsconfig.json` → sin errores.
Run: `pnpm build --concurrency=1` → 3 apps.

- [ ] **Step 2: Commit**

```bash
git add packages/db/src/types.ts
git commit -m "chore(db): tipos regenerados con cotizaciones"
```

---
### Task 4: `@suite/core` — transiciones y vencimiento de cotizaciones (TDD)

**Files:**
- Create: `packages/core/src/cotizaciones.ts`
- Create: `packages/core/src/cotizaciones.test.ts`
- Modify: `packages/core/src/index.ts` (agregar `export * from './cotizaciones'`)

**Interfaces:**
- Produces: `EstadoCotizacion = 'borrador' | 'enviada' | 'aceptada' | 'rechazada' | 'convertida'`; `puedeTransicionarCotizacion(desde: EstadoCotizacion, hacia: EstadoCotizacion): boolean` (SOLO topología de estados — la condición de fecha para aceptar vive en la RPC y en la UI, no aquí); `cotizacionVencida(fechaValidez: string | null, hoy: string, estado: EstadoCotizacion): boolean` (fechas ISO `yyyy-mm-dd`, comparación lexicográfica, mismo criterio que `estaVencido` de cobranza). `cotizacionVencida` y `EstadoCotizacion` los consumen las Tasks 5 y 7 (insignia Vencida en la lista y en el detalle, y la guarda del botón Aceptar). `puedeTransicionarCotizacion` es el espejo unitario de la máquina de estados de la RPC (mandato spec §7): se testea aquí pero NO se consume en la UI — las transiciones válidas las decide el servidor.

- [ ] **Step 1: Test que falla**

`packages/core/src/cotizaciones.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { cotizacionVencida, puedeTransicionarCotizacion } from './cotizaciones'

describe('puedeTransicionarCotizacion', () => {
  it('borrador puede enviarse', () => {
    expect(puedeTransicionarCotizacion('borrador', 'enviada')).toBe(true)
  })
  it('borrador puede rechazarse (vía de corrección de una mal digitada)', () => {
    expect(puedeTransicionarCotizacion('borrador', 'rechazada')).toBe(true)
  })
  it('enviada puede aceptarse', () => {
    expect(puedeTransicionarCotizacion('enviada', 'aceptada')).toBe(true)
  })
  it('enviada puede rechazarse', () => {
    expect(puedeTransicionarCotizacion('enviada', 'rechazada')).toBe(true)
  })
  it('aceptada puede convertirse', () => {
    expect(puedeTransicionarCotizacion('aceptada', 'convertida')).toBe(true)
  })
  it('enviada no puede convertirse sin pasar por aceptada', () => {
    expect(puedeTransicionarCotizacion('enviada', 'convertida')).toBe(false)
  })
  it('ninguna otra transición es válida', () => {
    expect(puedeTransicionarCotizacion('borrador', 'aceptada')).toBe(false)
    expect(puedeTransicionarCotizacion('aceptada', 'enviada')).toBe(false)
    expect(puedeTransicionarCotizacion('rechazada', 'enviada')).toBe(false)
    expect(puedeTransicionarCotizacion('convertida', 'borrador')).toBe(false)
  })
})

describe('cotizacionVencida', () => {
  it('vencida cuando la validez pasó y sigue en borrador o enviada', () => {
    expect(cotizacionVencida('2026-07-01', '2026-07-15', 'borrador')).toBe(true)
    expect(cotizacionVencida('2026-07-01', '2026-07-15', 'enviada')).toBe(true)
  })
  it('no vencida sin fecha de validez', () => {
    expect(cotizacionVencida(null, '2026-07-15', 'enviada')).toBe(false)
  })
  it('vigente el día exacto de la validez (vencida = estrictamente pasada)', () => {
    expect(cotizacionVencida('2026-07-15', '2026-07-15', 'enviada')).toBe(false)
  })
  it('una aceptada nunca se muestra vencida (el trato quedó congelado)', () => {
    expect(cotizacionVencida('2026-07-01', '2026-07-15', 'aceptada')).toBe(false)
  })
  it('rechazada y convertida nunca se muestran vencidas', () => {
    expect(cotizacionVencida('2026-07-01', '2026-07-15', 'rechazada')).toBe(false)
    expect(cotizacionVencida('2026-07-01', '2026-07-15', 'convertida')).toBe(false)
  })
})
```

- [ ] **Step 2: Verificar que falla**

Run: `pnpm --filter @suite/core test`
Expected: FAIL — `Cannot find module './cotizaciones'`.

- [ ] **Step 3: Implementación mínima**

`packages/core/src/cotizaciones.ts`:

```ts
export type EstadoCotizacion = 'borrador' | 'enviada' | 'aceptada' | 'rechazada' | 'convertida'

// Máquina de estados de cotizaciones (espejo exacto de cambiar_estado_cotizacion +
// convertir_cotizacion). SOLO topología: la condición de fecha para aceptar vive en la RPC.
const TRANSICIONES: Record<EstadoCotizacion, readonly EstadoCotizacion[]> = {
  borrador: ['enviada', 'rechazada'],
  enviada: ['aceptada', 'rechazada'],
  aceptada: ['convertida'],
  rechazada: [],
  convertida: [],
}

export function puedeTransicionarCotizacion(desde: EstadoCotizacion, hacia: EstadoCotizacion): boolean {
  return TRANSICIONES[desde].includes(hacia)
}

// Fechas ISO yyyy-mm-dd: la comparación lexicográfica equivale a la cronológica (criterio estaVencido).
// La insignia Vencida solo aplica a borrador/enviada: la aceptada congeló el trato y
// rechazada/convertida son terminales.
export function cotizacionVencida(fechaValidez: string | null, hoy: string, estado: EstadoCotizacion): boolean {
  if (estado !== 'borrador' && estado !== 'enviada') return false
  if (!fechaValidez) return false
  return fechaValidez < hoy
}
```

En `packages/core/src/index.ts` agregar al final: `export * from './cotizaciones'`

- [ ] **Step 4: Verificar que pasa**

Run: `pnpm --filter @suite/core test`
Expected: PASS — 81 tests (69 existentes + 12 nuevos).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/cotizaciones.ts packages/core/src/cotizaciones.test.ts packages/core/src/index.ts
git commit -m "feat(core): transiciones y vencimiento de cotizaciones (TDD)"
```

---
### Task 5: ERP — lista de cotizaciones + NAV

**Files:**
- Create: `apps/erp/app/cotizaciones/estados.ts`, `apps/erp/app/cotizaciones/page.tsx`
- Modify: `apps/erp/app/layout.tsx` (NAV: `{ href: '/cotizaciones', etiqueta: 'Cotizaciones' },` justo ANTES de Ventas)

**Interfaces:**
- Consumes: tabla `cotizaciones` con embed `clientes (razon_social)` vía la FK compuesta (mismo mecanismo probado en `documentos_compra → proveedores` de por-pagar); tipos regenerados (Task 3); `cotizacionVencida`/`EstadoCotizacion`/`formatearCLP`/`formatearFolio` de `@suite/core` (Task 4 produce `cotizacionVencida(fechaValidez: string | null, hoy: string, estado: EstadoCotizacion): boolean` y el tipo `EstadoCotizacion`); `obtenerEmpresaActiva`; componentes `@suite/ui`.
- Produces (además de la página): `apps/erp/app/cotizaciones/estados.ts` con `TONO_ESTADO`, `ETIQUETA_ESTADO`, `ESTADOS_COTIZACION` (mismo patrón `apps/erp/app/compras/estados.ts`) — Task 7 los reimporta como `../estados`, eliminando las copias inline que antes vivían en cada página.
- Produces: página `/cotizaciones` (filtros GET `estado` + `cliente`, orden `creado_en` desc, límite 100, totales al pie) + entrada NAV. Los links a `/cotizaciones/nueva` y `/cotizaciones/[id]` 404ean hasta Tasks 6-7 — transitorio esperado.

- [ ] **Step 1: Entrada NAV**

En `apps/erp/app/layout.tsx`, insertar la entrada de Cotizaciones justo ANTES de Ventas. El bloque `NAV` completo queda:

```tsx
const NAV = [
  { href: '/', etiqueta: 'Inicio' },
  { href: '/productos', etiqueta: 'Productos' },
  { href: '/clientes', etiqueta: 'Clientes' },
  { href: '/importar', etiqueta: 'Importar' },
  { href: '/cotizaciones', etiqueta: 'Cotizaciones' },
  { href: '/ventas', etiqueta: 'Ventas' },
  { href: '/inventario', etiqueta: 'Inventario' },
  { href: '/compras', etiqueta: 'Compras' },
  { href: '/cobranza', etiqueta: 'Cobranza' },
  { href: '/por-pagar', etiqueta: 'Por pagar' },
  { href: '/reportes', etiqueta: 'Reportes' },
  { href: '/configuracion/dte', etiqueta: 'Configuración' },
]
```

Nada más cambia en el layout.

- [ ] **Step 2: Mapas de estado centralizados**

`apps/erp/app/cotizaciones/estados.ts` (mismo patrón `apps/erp/app/compras/estados.ts` — léelo antes de escribir este archivo; Task 7 reimporta estos tres símbolos como `../estados` en vez de mantener copias inline en cada página):

```ts
export const TONO_ESTADO: Record<string, 'verde' | 'amarillo' | 'rojo' | 'gris'> = {
  borrador: 'gris',
  enviada: 'amarillo',
  aceptada: 'verde',
  rechazada: 'rojo',
  convertida: 'verde',
}

export const ETIQUETA_ESTADO: Record<string, string> = {
  borrador: 'Borrador',
  enviada: 'Enviada',
  aceptada: 'Aceptada',
  rechazada: 'Rechazada',
  convertida: 'Convertida',
}

export const ESTADOS_COTIZACION = ['borrador', 'enviada', 'aceptada', 'rechazada', 'convertida'] as const
```

- [ ] **Step 3: Página de lista**

`apps/erp/app/cotizaciones/page.tsx` (espejo estructural de `apps/erp/app/por-pagar/page.tsx` — filtros GET + insignia vencida — y de `apps/erp/app/compras/page.tsx` — filtro por estado, mismo `./estados`):

```tsx
import Link from 'next/link'
import { crearClienteServidor } from '@suite/auth/server'
import { cotizacionVencida, formatearCLP, formatearFolio, type EstadoCotizacion } from '@suite/core'
import { Boton, Encabezado, Insignia, Selector, Tabla, Td, Th, Tr } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import { ESTADOS_COTIZACION, ETIQUETA_ESTADO, TONO_ESTADO } from './estados'

const HOY = () => new Date().toISOString().slice(0, 10)

export default async function PaginaCotizaciones({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string; cliente?: string }>
}) {
  const { estado = '', cliente = '' } = await searchParams
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const supabase = await crearClienteServidor()
  const [{ data: clientes }, consulta] = await Promise.all([
    supabase.from('clientes').select('id, razon_social').eq('empresa_id', activa.id).eq('activo', true).order('razon_social'),
    (() => {
      let q = supabase
        .from('cotizaciones')
        .select('id, numero, fecha_validez, estado, total, creado_en, clientes (razon_social)')
        .eq('empresa_id', activa.id)
        .order('creado_en', { ascending: false })
        .limit(100)
      if ((ESTADOS_COTIZACION as readonly string[]).includes(estado)) q = q.eq('estado', estado)
      if (cliente) q = q.eq('cliente_id', cliente)
      return q
    })(),
  ])
  const hoy = HOY()
  const filas = consulta.data ?? []
  const totalCotizado = filas.reduce((s, c) => s + c.total, 0)
  return (
    <div>
      <Encabezado titulo="Cotizaciones">
        <Link href="/cotizaciones/nueva"><Boton>Nueva cotización</Boton></Link>
      </Encabezado>
      <form className="mb-4 flex flex-wrap items-center gap-3" action="/cotizaciones" method="get">
        <Selector name="estado" defaultValue={estado} className="max-w-xs">
          <option value="">Todos los estados</option>
          {ESTADOS_COTIZACION.map((e) => <option key={e} value={e}>{ETIQUETA_ESTADO[e]}</option>)}
        </Selector>
        <Selector name="cliente" defaultValue={cliente} className="max-w-xs">
          <option value="">Todos los clientes</option>
          {(clientes ?? []).map((cl) => <option key={cl.id} value={cl.id}>{cl.razon_social}</option>)}
        </Selector>
        <Boton variante="secundario" type="submit">Filtrar</Boton>
        <Link className="text-sm text-marca-700 hover:underline" href="/cotizaciones">Limpiar</Link>
      </form>
      <Tabla>
        <thead><tr><Th>N°</Th><Th>Cliente</Th><Th>Creada</Th><Th>Válida hasta</Th><Th className="text-right">Total</Th><Th>Estado</Th><Th /></tr></thead>
        <tbody>
          {filas.map((c) => {
            // estado es text + check en SQL; el codegen lo tipa string — cast solo de tipo, no de valor.
            const vencida = cotizacionVencida(c.fecha_validez, hoy, c.estado as EstadoCotizacion)
            return (
              <Tr key={c.id}>
                <Td><Link className="text-marca-700 hover:underline" href={`/cotizaciones/${c.id}`}>{formatearFolio(c.numero)}</Link></Td>
                <Td>{c.clientes?.razon_social ?? '—'}</Td>
                <Td>{new Date(c.creado_en).toLocaleDateString('es-CL')}</Td>
                <Td>{new Date(c.fecha_validez + 'T00:00:00').toLocaleDateString('es-CL')}</Td>
                <Td className="text-right font-mono">{formatearCLP(c.total)}</Td>
                <Td><Insignia tono={TONO_ESTADO[c.estado] ?? 'gris'}>{ETIQUETA_ESTADO[c.estado] ?? c.estado}</Insignia></Td>
                <Td>{vencida && <Insignia tono="rojo">Vencida</Insignia>}</Td>
              </Tr>
            )
          })}
          {filas.length === 0 && <Tr><Td colSpan={7} className="py-8 text-center text-slate-500">No hay cotizaciones {estado || cliente ? 'que coincidan' : 'todavía'}.</Td></Tr>}
        </tbody>
      </Tabla>
      <div className="mt-3 flex justify-end gap-6 text-sm">
        <span>Cotizaciones: <strong>{filas.length}</strong></span>
        <span>Total: <strong className="font-mono">{formatearCLP(totalCotizado)}</strong></span>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Verificar y commit**

Run: `pnpm --filter erp build` → sin errores (los links a `/cotizaciones/nueva` y `/cotizaciones/[id]` 404ean hasta Tasks 6-7 — transitorio esperado).

```bash
git add apps/erp/app/cotizaciones/estados.ts apps/erp/app/cotizaciones/page.tsx apps/erp/app/layout.tsx
git commit -m "feat(erp): lista de cotizaciones con filtros y NAV"
```

---

### Task 6: ERP — nueva cotización con precios negociables

**Files:**
- Create: `apps/erp/app/cotizaciones/acciones.ts`, `apps/erp/app/cotizaciones/nueva/page.tsx`, `apps/erp/componentes/formulario-cotizacion.tsx`

**Interfaces:**
- Consumes: RPC `crear_cotizacion(p_empresa uuid, p_cliente uuid, p_validez date, p_notas text, p_lineas jsonb) returns uuid` (Task 1, tipos Task 3); `totalesDocumento`/`LineaDocumento`/`formatearCLP` de `@suite/core` (mismos helpers que el formulario de ventas); `EstadoForm` de `apps/erp/app/tipos.ts`; `Json` de `@suite/db`.
- Produces: Server Action `crearCotizacion(prev: EstadoForm, formData: FormData): Promise<EstadoForm>` en `apps/erp/app/cotizaciones/acciones.ts` (Task 7 agrega ahí las actions de estado/conversión); componente `FormularioCotizacion`; página `/cotizaciones/nueva`. Hidden input `lineas`: JSON de `LineaDocumento[]` — la action solo usa `productoId`/`cantidad`/`precioNeto` y la RPC ignora las claves extra (`descripcion`/`exenta` salen DEL PRODUCTO server-side).

- [ ] **Step 1: Server Action**

`apps/erp/app/cotizaciones/acciones.ts` (estructura espejo de `apps/erp/app/por-pagar/acciones.ts`: validaciones antes del RPC, casts documentados, mapeo de errores; espejo de parseo de líneas: `crearNotaVenta` en `apps/erp/app/ventas/acciones.ts`):

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import type { Json } from '@suite/db'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import type { EstadoForm } from '../tipos'

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/

type LineaEntrada = { productoId: string; cantidad: number; precioNeto: number }

export async function crearCotizacion(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const cliente = String(formData.get('cliente_id') ?? '')
  const validez = String(formData.get('fecha_validez') ?? '').trim()
  const notas = String(formData.get('notas') ?? '').trim()
  if (!cliente) return { error: 'Selecciona un cliente' }
  if (!FECHA_ISO.test(validez)) return { error: 'Ingresa la fecha de validez' }

  let lineas: LineaEntrada[]
  try {
    // Sin .filter(): una línea malformada se RECHAZA en el loop de abajo, no se descarta en
    // silencio — el usuario no debe terminar con una cotización sin una línea que creyó incluir.
    lineas = JSON.parse(String(formData.get('lineas') ?? '[]')) as LineaEntrada[]
  } catch {
    return { error: 'Las líneas de la cotización no son válidas' }
  }
  if (lineas.length === 0) return { error: 'Agrega al menos un producto' }
  for (const l of lineas) {
    if (!l.productoId || !Number.isInteger(l.cantidad) || l.cantidad < 1) {
      return { error: 'Cada línea necesita producto y cantidad entera mayor a 0' }
    }
    if (!Number.isInteger(l.precioNeto) || l.precioNeto < 0) {
      return { error: 'Cada línea necesita un precio entero mayor o igual a 0' }
    }
  }

  const supabase = await crearClienteServidor()
  // p_lineas es jsonb en SQL; el generador de tipos lo tipa como Json, no como el shape real: castea sólo el tipo.
  // p_notas acepta NULL en SQL (nullif/trim/coalesce), pero el generador no refleja la nulabilidad de argumentos
  // de función: castea sólo el tipo, no el valor (mismo criterio que por-pagar/acciones.ts).
  const { error } = await supabase.rpc('crear_cotizacion', {
    p_empresa: activa.id,
    p_cliente: cliente,
    p_validez: validez,
    p_notas: (notas || null) as string,
    p_lineas: lineas.map((l) => ({ productoId: l.productoId, cantidad: l.cantidad, precioNeto: l.precioNeto })) as unknown as Json,
  })
  if (error) {
    // Substrings ÚNICOS dentro del set de mensajes de crear_cotizacion (verificado sin colisiones):
    // 'rol' / 'Cliente' / 'Producto' / 'línea' / 'cantidad' / 'precio' / 'validez'.
    // ('al menos' NO sirve: aparece en el mensaje de línea Y en el de cantidad.)
    if (error.message.includes('rol')) return { error: 'Tu rol no permite crear cotizaciones' }
    if (error.message.includes('Cliente')) return { error: 'El cliente no es válido o está inactivo' }
    if (error.message.includes('Producto')) return { error: 'Hay un producto no válido o inactivo en las líneas' }
    if (error.message.includes('línea')) return { error: 'La cotización necesita al menos una línea' }
    if (error.message.includes('cantidad')) return { error: 'La cantidad debe ser al menos 1' }
    if (error.message.includes('precio')) return { error: 'El precio debe ser un entero mayor o igual a 0' }
    if (error.message.includes('validez')) return { error: 'La fecha de validez no puede ser anterior a hoy' }
    return { error: 'No se pudo crear la cotización' }
  }
  revalidatePath('/cotizaciones')
  redirect('/cotizaciones')
}
```

Nota: `redirect` lanza `NEXT_REDIRECT` — queda FUERA del `try` (que solo envuelve el `JSON.parse`), igual que en ventas y por-pagar.

- [ ] **Step 2: Formulario client (líneas dinámicas, precio editable, totales en vivo)**

`apps/erp/componentes/formulario-cotizacion.tsx` (copia de `apps/erp/componentes/formulario-venta.tsx` adaptada: precio editable vía `cambiarPrecio`, campo de validez con default hoy+30, notas; MISMO cálculo de totales con `totalesDocumento`):

```tsx
'use client'

import { useActionState, useState } from 'react'
import { Boton, Campo, Entrada, Selector, Tabla, Td, Th, Tr, Tarjeta } from '@suite/ui'
import { formatearCLP, totalesDocumento, type LineaDocumento } from '@suite/core'
import type { EstadoForm } from '../app/tipos'

interface ProductoOpcion { id: string; nombre: string; precio_neto: number; exento: boolean }
interface ClienteOpcion { id: string; razon_social: string }

// Default de vigencia hoy + 30 (decisión de diseño §2); la RPC solo exige >= hoy.
function hoyMas30(): string {
  const d = new Date()
  d.setDate(d.getDate() + 30)
  return d.toISOString().slice(0, 10)
}

export function FormularioCotizacion({
  accion,
  productos,
  clientes,
}: {
  accion: (prev: EstadoForm, formData: FormData) => Promise<EstadoForm>
  productos: ProductoOpcion[]
  clientes: ClienteOpcion[]
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoForm)
  const [lineas, setLineas] = useState<LineaDocumento[]>([])

  function agregar(productoId: string) {
    const p = productos.find((x) => x.id === productoId)
    if (!p) return
    setLineas((ls) => [
      ...ls,
      { productoId: p.id, descripcion: p.nombre, cantidad: 1, precioNeto: p.precio_neto, exenta: p.exento },
    ])
  }
  function cambiarCantidad(i: number, cantidad: number) {
    setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, cantidad: Math.max(1, cantidad) } : l)))
  }
  function cambiarPrecio(i: number, precio: number) {
    setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, precioNeto: Math.max(0, Math.trunc(precio) || 0) } : l)))
  }
  function quitar(i: number) {
    setLineas((ls) => ls.filter((_, j) => j !== i))
  }

  const totales = totalesDocumento(lineas)

  return (
    <form action={enviar}>
      <input type="hidden" name="lineas" value={JSON.stringify(lineas)} />
      <Tarjeta className="mb-4 max-w-3xl">
        <div className="flex flex-wrap items-end gap-3">
          <Campo etiqueta="Cliente *">
            <Selector name="cliente_id" required defaultValue="">
              <option value="" disabled>Selecciona…</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>{c.razon_social}</option>
              ))}
            </Selector>
          </Campo>
          <Campo etiqueta="Válida hasta *">
            <Entrada type="date" name="fecha_validez" required defaultValue={hoyMas30()} />
          </Campo>
          <Campo etiqueta="Agregar producto">
            <Selector value="" onChange={(e: React.ChangeEvent<HTMLSelectElement>) => { agregar(e.currentTarget.value); e.currentTarget.value = '' }}>
              <option value="" disabled>Selecciona…</option>
              {productos.map((p) => (
                <option key={p.id} value={p.id}>{p.nombre} — {formatearCLP(p.precio_neto)}</option>
              ))}
            </Selector>
          </Campo>
          <Campo etiqueta="Notas">
            <Entrada name="notas" placeholder="Opcional" />
          </Campo>
        </div>
      </Tarjeta>

      <Tabla>
        <thead>
          <tr><Th>Producto</Th><Th>Cantidad</Th><Th className="text-right">Precio neto</Th><Th className="text-right">Subtotal</Th><Th /></tr>
        </thead>
        <tbody>
          {lineas.map((l, i) => (
            <Tr key={i}>
              <Td>{l.descripcion}{l.exenta && ' (exento)'}</Td>
              <Td>
                <Entrada type="number" min={1} value={l.cantidad} onChange={(e: React.ChangeEvent<HTMLInputElement>) => cambiarCantidad(i, Number(e.currentTarget.value))} className="w-20" />
              </Td>
              <Td className="text-right">
                <Entrada type="number" min={0} value={l.precioNeto} onChange={(e: React.ChangeEvent<HTMLInputElement>) => cambiarPrecio(i, Number(e.currentTarget.value))} className="w-28 text-right" />
              </Td>
              <Td className="text-right">{formatearCLP(Math.round(l.cantidad * l.precioNeto))}</Td>
              <Td><Boton variante="secundario" type="button" className="px-2 py-1 text-xs" onClick={() => quitar(i)}>Quitar</Boton></Td>
            </Tr>
          ))}
          {lineas.length === 0 && <Tr><Td colSpan={5} className="py-6 text-center text-slate-500">Agrega productos a la cotización.</Td></Tr>}
        </tbody>
      </Tabla>

      <div className="mt-4 flex flex-col items-end gap-1 text-sm">
        <div>Neto: <strong>{formatearCLP(totales.neto)}</strong></div>
        {totales.exento > 0 && <div>Exento: <strong>{formatearCLP(totales.exento)}</strong></div>}
        <div>IVA (19%): <strong>{formatearCLP(totales.iva)}</strong></div>
        <div className="text-lg">Total: <strong>{formatearCLP(totales.total)}</strong></div>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2">
        {estado.error && <span className="mr-auto text-sm text-red-600">{estado.error}</span>}
        <Boton type="submit" disabled={pendiente || lineas.length === 0}>{pendiente ? 'Guardando…' : 'Guardar cotización'}</Boton>
      </div>
    </form>
  )
}
```

- [ ] **Step 3: Página nueva (server, catálogos scoped)**

`apps/erp/app/cotizaciones/nueva/page.tsx` (espejo de `apps/erp/app/ventas/nueva/page.tsx`; mismos catálogos activos scoped que carga `apps/erp/app/por-pagar/facturas/nueva/page.tsx`):

```tsx
import { crearClienteServidor } from '@suite/auth/server'
import { Encabezado } from '@suite/ui'
import { FormularioCotizacion } from '../../../componentes/formulario-cotizacion'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { crearCotizacion } from '../acciones'

export default async function NuevaCotizacion() {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const supabase = await crearClienteServidor()
  const [{ data: productos }, { data: clientes }] = await Promise.all([
    supabase.from('productos').select('id, nombre, precio_neto, exento').eq('empresa_id', activa.id).eq('activo', true).order('nombre'),
    supabase.from('clientes').select('id, razon_social').eq('empresa_id', activa.id).eq('activo', true).order('razon_social'),
  ])
  return (
    <div>
      <Encabezado titulo="Nueva cotización" />
      <FormularioCotizacion accion={crearCotizacion} productos={productos ?? []} clientes={clientes ?? []} />
    </div>
  )
}
```

- [ ] **Step 4: Verificar y commit**

Run: `pnpm --filter erp build` → sin errores.

```bash
git add apps/erp/app/cotizaciones apps/erp/componentes/formulario-cotizacion.tsx
git commit -m "feat(erp): nueva cotización con precios negociables y totales en vivo"
```

---
### Task 7: ERP — detalle de cotización + acciones de estado + convertir + imprimir

**Files:**
- Create: `apps/erp/app/cotizaciones/[id]/page.tsx`, `apps/erp/componentes/acciones-cotizacion.tsx`, `apps/erp/componentes/boton-imprimir.tsx`
- Modify: `apps/erp/app/cotizaciones/acciones.ts` (AGREGAR `cambiarEstadoCotizacion` y `convertirCotizacion` al final — Task 6 lo creó con `crearCotizacion`), `apps/erp/app/layout.tsx` (barra lateral `print:hidden`, `main` con `print:p-0`)

**Interfaces:**
- Consumes: tablas `cotizaciones`/`cotizaciones_lineas`/`clientes` (select RLS), RPCs `cambiar_estado_cotizacion(p_empresa, p_cotizacion, p_estado, p_motivo)` y `convertir_cotizacion(p_empresa, p_cotizacion) returns uuid` (Task 1), `cotizacionVencida(fechaValidez, hoy, estado)`/`EstadoCotizacion`/`formatearCLP`/`formatearRut` de `@suite/core`, `TONO_ESTADO`/`ETIQUETA_ESTADO` de `apps/erp/app/cotizaciones/estados.ts` (Task 5 — reimportados como `../estados`, sin copias inline), `EstadoForm` de `apps/erp/app/tipos.ts`, `obtenerEmpresaActiva`, `apps/erp/app/cotizaciones/acciones.ts` de Task 6.
- Produces: Server Actions `cambiarEstadoCotizacion(prev, formData): Promise<EstadoForm>` y `convertirCotizacion(prev, formData): Promise<EstadoForm>` (redirect a `/ventas/[docId]` al convertir); componentes client `AccionesCotizacion` y `BotonImprimir`; página `/cotizaciones/[id]` imprimible con `@media print` (variante `print:` de Tailwind 4).

- [ ] **Step 1: Server Actions de estado y conversión (agregar al final de acciones.ts)**

`apps/erp/app/cotizaciones/acciones.ts` ya existe (Task 6, con `crearCotizacion`) e importa `revalidatePath`, `redirect`, `crearClienteServidor`, `obtenerEmpresaActiva` y `EstadoForm` — los mismos de `apps/erp/app/por-pagar/acciones.ts`. Si falta alguno, complétalo con estas rutas exactas:

```ts
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import type { EstadoForm } from '../tipos'
```

Agregar AL FINAL del archivo (sin tocar `crearCotizacion`):

```ts
const ESTADOS_DESTINO = ['enviada', 'aceptada', 'rechazada'] as const

export async function cambiarEstadoCotizacion(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  const cotizacion = String(formData.get('cotizacion_id') ?? '')
  const estado = String(formData.get('estado') ?? '')
  const motivo = String(formData.get('motivo') ?? '').trim()
  if (!cotizacion) return { error: 'Cotización no válida' }
  if (!(ESTADOS_DESTINO as readonly string[]).includes(estado)) return { error: 'Estado de destino no válido' }
  if (estado === 'rechazada' && motivo === '') return { error: 'El rechazo requiere un motivo' }
  const supabase = await crearClienteServidor()
  // p_motivo acepta NULL en SQL (nullif/trim en la RPC), pero el codegen no refleja la
  // nulabilidad de argumentos de función: el cast es sólo de tipo (mismo criterio que por-pagar).
  const { error } = await supabase.rpc('cambiar_estado_cotizacion', {
    p_empresa: activa.id,
    p_cotizacion: cotizacion,
    p_estado: estado,
    p_motivo: (motivo || null) as string,
  })
  if (error) {
    if (error.message.includes('rol')) return { error: 'Tu rol no permite gestionar cotizaciones' }
    if (error.message.includes('Transición')) return { error: 'Esa transición de estado no está permitida' }
    if (error.message.includes('vencida')) return { error: 'La cotización está vencida: ya no se puede aceptar' }
    if (error.message.includes('motivo')) return { error: 'El rechazo requiere un motivo' }
    if (error.message.includes('no existe')) return { error: 'La cotización no existe' }
    return { error: 'No se pudo cambiar el estado de la cotización' }
  }
  revalidatePath('/cotizaciones')
  revalidatePath(`/cotizaciones/${cotizacion}`)
  return {}
}

export async function convertirCotizacion(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }
  const cotizacion = String(formData.get('cotizacion_id') ?? '')
  if (!cotizacion) return { error: 'Cotización no válida' }
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase.rpc('convertir_cotizacion', {
    p_empresa: activa.id,
    p_cotizacion: cotizacion,
  })
  if (error) {
    if (error.message.includes('rol')) return { error: 'Tu rol no permite convertir cotizaciones' }
    if (error.message.includes('condición')) return { error: error.message }
    if (error.message.includes('aceptada')) return { error: 'Solo se puede convertir una cotización aceptada' }
    if (error.message.includes('no existe')) return { error: 'La cotización no existe' }
    return { error: 'No se pudo convertir la cotización' }
  }
  revalidatePath('/cotizaciones')
  revalidatePath('/ventas')
  // redirect lanza NEXT_REDIRECT: va FUERA de cualquier try/catch. data = uuid del documento de venta creado.
  redirect(`/ventas/${data}`)
}
```

Claves de mapeo elegidas SIN colisiones de substring contra los mensajes que cada RPC puede emitir (`'válido'`/`'válida'` aparece en varios mensajes del contrato, por eso NO se usa como clave): en `cambiar_estado_cotizacion` los posibles son rol / `'La cotización no existe'` / `'Transición de estado no válida'` / `'La cotización está vencida'` / `'El rechazo requiere un motivo'` → claves `'rol'`, `'Transición'`, `'vencida'`, `'motivo'`, `'no existe'` (cada una aparece en exactamente un mensaje). En `convertir_cotizacion`: rol / `'La cotización no existe'` / `'Solo se puede convertir una cotización aceptada'` / `'Un producto de la cotización ya no está disponible o cambió su condición de IVA; crea una nueva cotización'` → claves `'rol'`, `'condición'`, `'aceptada'`, `'no existe'`; el mensaje de producto cambiado se devuelve VERBATIM (ya es español amigable y el detalle es útil).

- [ ] **Step 2: Componente client de acciones por estado**

`apps/erp/componentes/acciones-cotizacion.tsx` (mismo patrón `useActionState` por acción de `formulario-anular-pago-proveedor.tsx`; el rechazo abre un motivo inline):

```tsx
'use client'

import { useActionState, useState } from 'react'
import { Boton, Entrada } from '@suite/ui'
import { cambiarEstadoCotizacion, convertirCotizacion } from '../app/cotizaciones/acciones'
import type { EstadoForm } from '../app/tipos'

function BotonEstado({
  cotizacionId,
  estado,
  etiqueta,
  deshabilitado,
  leyenda,
}: {
  cotizacionId: string
  estado: 'enviada' | 'aceptada'
  etiqueta: string
  deshabilitado?: boolean
  leyenda?: string
}) {
  const [resultado, enviar, pendiente] = useActionState(cambiarEstadoCotizacion, {} as EstadoForm)
  return (
    <form action={enviar} className="flex items-center gap-2">
      <input type="hidden" name="cotizacion_id" value={cotizacionId} />
      <input type="hidden" name="estado" value={estado} />
      <Boton type="submit" disabled={pendiente || deshabilitado}>{pendiente ? '…' : etiqueta}</Boton>
      {leyenda && <span className="text-xs text-amber-700">{leyenda}</span>}
      {resultado.error && <span className="text-xs text-red-600">{resultado.error}</span>}
    </form>
  )
}

function FormularioRechazo({ cotizacionId }: { cotizacionId: string }) {
  const [abierto, setAbierto] = useState(false)
  const [resultado, enviar, pendiente] = useActionState(cambiarEstadoCotizacion, {} as EstadoForm)
  if (!abierto) {
    return <Boton variante="peligro" type="button" onClick={() => setAbierto(true)}>Rechazar</Boton>
  }
  return (
    <form action={enviar} className="flex items-center gap-2">
      <input type="hidden" name="cotizacion_id" value={cotizacionId} />
      <input type="hidden" name="estado" value="rechazada" />
      <Entrada name="motivo" placeholder="Motivo del rechazo *" required className="w-56 text-xs" />
      <Boton variante="peligro" type="submit" disabled={pendiente} className="px-2 py-1 text-xs">{pendiente ? '…' : 'Confirmar rechazo'}</Boton>
      {resultado.error && <span className="text-xs text-red-600">{resultado.error}</span>}
    </form>
  )
}

function BotonConvertir({ cotizacionId }: { cotizacionId: string }) {
  const [resultado, enviar, pendiente] = useActionState(convertirCotizacion, {} as EstadoForm)
  return (
    <form action={enviar} className="flex items-center gap-2">
      <input type="hidden" name="cotizacion_id" value={cotizacionId} />
      <Boton type="submit" disabled={pendiente}>{pendiente ? 'Convirtiendo…' : 'Convertir a venta'}</Boton>
      {resultado.error && <span className="text-xs text-red-600">{resultado.error}</span>}
    </form>
  )
}

export function AccionesCotizacion({
  cotizacionId,
  estado,
  vencida,
}: {
  cotizacionId: string
  estado: string
  vencida: boolean
}) {
  if (estado === 'borrador') {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <BotonEstado cotizacionId={cotizacionId} estado="enviada" etiqueta="Enviar" />
        <FormularioRechazo cotizacionId={cotizacionId} />
      </div>
    )
  }
  if (estado === 'enviada') {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <BotonEstado
          cotizacionId={cotizacionId}
          estado="aceptada"
          etiqueta="Aceptar"
          deshabilitado={vencida}
          leyenda={vencida ? 'Vencida: no se puede aceptar' : undefined}
        />
        <FormularioRechazo cotizacionId={cotizacionId} />
      </div>
    )
  }
  if (estado === 'aceptada') {
    return <BotonConvertir cotizacionId={cotizacionId} />
  }
  return null
}
```

`rechazada` y `convertida` retornan `null`: sus estados terminales se muestran en la página (motivo / link a la venta), sin acciones.

- [ ] **Step 3: Botón Imprimir (client mini-componente)**

`apps/erp/componentes/boton-imprimir.tsx`:

```tsx
'use client'

import { Boton } from '@suite/ui'

export function BotonImprimir() {
  return (
    <Boton variante="secundario" type="button" onClick={() => window.print()}>
      Imprimir
    </Boton>
  )
}
```

- [ ] **Step 4: Página de detalle imprimible**

`apps/erp/app/cotizaciones/[id]/page.tsx` (espejo de `apps/erp/app/ventas/[id]/page.tsx`; la insignia **Vencida** usa `cotizacionVencida` de `@suite/core`, que ya retorna `false` para `aceptada`/`rechazada`/`convertida`):

```tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { cotizacionVencida, formatearCLP, formatearRut, type EstadoCotizacion } from '@suite/core'
import { Boton, Encabezado, Insignia, Tabla, Tarjeta, Td, Th, Tr } from '@suite/ui'
import { AccionesCotizacion } from '../../../componentes/acciones-cotizacion'
import { BotonImprimir } from '../../../componentes/boton-imprimir'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { ETIQUETA_ESTADO, TONO_ESTADO } from '../estados'

export default async function DetalleCotizacion({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const supabase = await crearClienteServidor()
  const { data: cot } = await supabase
    .from('cotizaciones')
    .select('*, clientes (razon_social, rut), cotizaciones_lineas (descripcion, cantidad, precio_neto, exenta, subtotal)')
    .eq('id', id).eq('empresa_id', activa.id).single()
  if (!cot) notFound()

  const hoy = new Date().toISOString().slice(0, 10)
  // estado es text + check en SQL; el codegen lo tipa string — cast solo de tipo.
  const vencida = cotizacionVencida(cot.fecha_validez, hoy, cot.estado as EstadoCotizacion)
  const creada = new Date(cot.creado_en).toLocaleDateString('es-CL')
  const validez = new Date(cot.fecha_validez + 'T00:00:00').toLocaleDateString('es-CL')

  return (
    <div>
      <div className="print:hidden">
        <Encabezado titulo={`Cotización N° ${cot.numero}`}>
          <Insignia tono={TONO_ESTADO[cot.estado] ?? 'gris'}>{ETIQUETA_ESTADO[cot.estado] ?? cot.estado}</Insignia>
          {vencida && <Insignia tono="rojo">Vencida</Insignia>}
          <BotonImprimir />
        </Encabezado>
      </div>

      <div className="mb-4 hidden print:block">
        <h1 className="text-xl font-bold">{activa.razon_social}</h1>
        <p className="text-sm text-slate-600">{formatearRut(activa.rut)}</p>
        <h2 className="mt-2 text-lg font-semibold">Cotización N° {cot.numero}</h2>
      </div>

      <Tarjeta className="mb-4 max-w-3xl">
        <p><strong>Cliente:</strong> {cot.clientes?.razon_social} ({cot.clientes && formatearRut(cot.clientes.rut)})</p>
        <p className="mt-1 text-sm text-slate-600">Creada: {creada} · Válida hasta: {validez}</p>
        {cot.notas && <p className="mt-1 text-sm text-slate-600">Notas: {cot.notas}</p>}
        {cot.estado === 'rechazada' && cot.motivo_rechazo && (
          <p className="mt-2 text-sm text-red-700"><strong>Motivo de rechazo:</strong> {cot.motivo_rechazo}</p>
        )}
      </Tarjeta>

      <Tabla>
        <thead><tr><Th>Descripción</Th><Th>Cantidad</Th><Th className="text-right">Precio unitario</Th><Th className="text-right">Subtotal</Th></tr></thead>
        <tbody>
          {cot.cotizaciones_lineas.map((l: { descripcion: string; cantidad: number; precio_neto: number; exenta: boolean; subtotal: number }, i: number) => (
            <Tr key={i}>
              <Td>{l.descripcion}{l.exenta && <span className="ml-1 text-xs text-slate-500">(exenta)</span>}</Td>
              <Td>{l.cantidad}</Td>
              <Td className="text-right">{formatearCLP(l.precio_neto)}</Td>
              <Td className="text-right">{formatearCLP(l.subtotal)}</Td>
            </Tr>
          ))}
        </tbody>
      </Tabla>

      <div className="mt-4 flex flex-col items-end gap-1 text-sm">
        <div>Neto: <strong>{formatearCLP(cot.neto)}</strong></div>
        {cot.exento > 0 && <div>Exento: <strong>{formatearCLP(cot.exento)}</strong></div>}
        <div>IVA: <strong>{formatearCLP(cot.iva)}</strong></div>
        <div className="text-lg">Total: <strong>{formatearCLP(cot.total)}</strong></div>
      </div>

      <p className="mt-6 hidden text-sm text-slate-600 print:block">Cotización válida hasta el {validez}.</p>

      <div className="mt-6 flex flex-wrap items-center gap-3 print:hidden">
        <AccionesCotizacion cotizacionId={cot.id} estado={cot.estado} vencida={vencida} />
        {cot.estado === 'convertida' && cot.documento_venta_id && (
          <Link href={`/ventas/${cot.documento_venta_id}`}>
            <Boton variante="secundario" type="button">Ver nota de venta</Boton>
          </Link>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Layout apto para impresión**

En `apps/erp/app/layout.tsx`, reemplaza el bloque `<div className="flex">` del return (SIN tocar la constante `NAV`, que Task 6 ya dejó con Cotizaciones antes de Ventas): la barra lateral queda envuelta en `print:hidden` y el `main` pierde el padding al imprimir.

Antes:

```tsx
        <div className="flex">
          <BarraLateral
            titulo="Suite ERP"
            items={NAV}
            pie={
              activa && (
                <SelectorEmpresa empresas={empresas} activaId={activa.id} accion={cambiarEmpresaActiva} />
              )
            }
          />
          <main className="min-h-screen flex-1 p-8">{children}</main>
        </div>
```

Después:

```tsx
        <div className="flex">
          <div className="print:hidden">
            <BarraLateral
              titulo="Suite ERP"
              items={NAV}
              pie={
                activa && (
                  <SelectorEmpresa empresas={empresas} activaId={activa.id} accion={cambiarEmpresaActiva} />
                )
              }
            />
          </div>
          <main className="min-h-screen flex-1 p-8 print:p-0">{children}</main>
        </div>
```

Al imprimir queda SOLO el bloque limpio: razón social + RUT de la empresa activa, N° de cotización, cliente, fechas, líneas, totales y validez (encabezado de pantalla, botones y acciones llevan `print:hidden`; el encabezado de impresión es `hidden print:block`).

- [ ] **Step 6: Verificar la variante `print:` con la config Tailwind actual**

Run (bash, desde la raíz del repo):

```bash
ls apps/erp packages/ui | grep -i tailwind; cat apps/erp/postcss.config.mjs; head -3 apps/erp/app/globals.css
```

Salida esperada: NINGÚN `tailwind.config.*` en `apps/erp` ni `packages/ui`; el postcss solo tiene `'@tailwindcss/postcss': {}`; `globals.css` empieza con `@import 'tailwindcss'` (Tailwind 4 CSS-first, sin config JS que restrinja variantes) → las variantes `print:hidden`/`print:block`/`print:p-0` funcionan out-of-the-box, no hay nada que configurar.

- [ ] **Step 7: Verificar build y commit**

Run: `pnpm --filter erp build` → compila sin errores y la ruta `/cotizaciones/[id]` aparece en el listado de rutas del output.

```bash
git add "apps/erp/app/cotizaciones/[id]/page.tsx" apps/erp/app/cotizaciones/acciones.ts apps/erp/componentes/acciones-cotizacion.tsx apps/erp/componentes/boton-imprimir.tsx apps/erp/app/layout.tsx
git commit -m "feat(erp): detalle de cotización con ciclo de estados, conversión e impresión"
```

---
### Task 8: Pipeline + verificación integral (E2E)

**Files:** ninguno de producción (script en scratchpad, se borra).

- [ ] **Step 1: Pipeline**

Run: `pnpm --filter @suite/db gen` — commitear solo si diff (`chore(db): tipos regenerados`).
Run: `pnpm test` — **93 tests** (core 81 incl. cotizaciones, auth 2, dte 10).
Run: `pnpm supabase test db` — **132 asserts** (aislamiento 6, cobranza 16, compras 19, cotizaciones 26, inventario 10, maestros 10, por_pagar 18, registro 7, reportes 11, ventas 9).
Run: `pnpm build --concurrency=1` — 3 apps.

- [ ] **Step 2: E2E integral (script Node en scratchpad)**

Patrón de siempre (createRequire sobre `packages/auth/package.json`; usuario real vía `admin.auth.admin.createUser` + `registrar_organizacion` como authenticated; RUT org `999999999` — NO fixtures ni demo `771234569`; cliente y productos como authenticated — service_role no accede al schema `app`):

1. Org + cliente activo + 2 productos (P1 afecto, precio de lista 10000; P2 exento, precio de lista 5000) + stock inicial 10 c/u vía `registrar_entrada` (bodega de `bodega_por_defecto`) → `crear_cotizacion` con precios NEGOCIADOS bajo lista (P1 a 8000 × 3, P2 a 4000 × 2) → asserts: `numero` = 1, estado `borrador`, líneas con `descripcion`/`exenta` DEL PRODUCTO (no del llamador), neto 24000, exento 8000, iva 4560, total 36560.
2. Rechazo desde borrador: cotización 2 (creada aquí, en borrador) → `cambiar_estado_cotizacion` a `rechazada` con motivo `'  mal digitada  '` → `motivo_rechazo = 'mal digitada'` (trim); reintentar el rechazo SIN motivo sobre la cotización 1 (creada en el paso 1, sigue en borrador — el paso 3 recién la toca) → error `'El rechazo requiere un motivo'`. NO se crea una quinta cotización para este intento: el script termina con exactamente 4 (correlativos 1-4 del paso 6).
3. Ciclo feliz con descuento: cotización 1 → `enviada` → `aceptada` → `convertir_cotizacion` → asserts: retorna `docId`; `documentos_venta` tipo `nota_venta` estado `borrador`, mismo cliente y totales; líneas con `precio_neto` COTIZADO (8000/4000, NO 10000/5000) y `exenta` del producto; cotización `convertida` con `documento_venta_id = docId`; doble conversión → `'Solo se puede convertir una cotización aceptada'`.
4. Emitir la factura (réplica admin del camino feliz de `emitir.ts`, que un script Node no puede invocar): update `{ tipo: 'factura', folio: 1, estado: 'emitido', emitido_en: now }` sobre `docId` + `admin.rpc('registrar_movimientos_documento', { p_empresa, p_documento: docId, p_lineas: [{ productoId, cantidad }, …], p_signo: -1, p_motivo: 'Venta factura folio 1' })` → asserts: movimientos `salida` con `referencia_documento_id = docId`; `stock_actual` P1 = 7 y P2 = 8 (el stock baja al EMITIR, no al cotizar ni convertir).
5. Vencimiento: cotización 3 `enviada`, backdatear `fecha_validez` a ayer (UPDATE como service_role — la tabla no tiene check contra la fecha de creación precisamente para esto) → aceptar → error `'La cotización está vencida'`; cotización 4 `enviada` → `aceptada` vigente → backdatear a ayer → `convertir_cotizacion` SÍ convierte (la aceptación congeló el trato).
6. Correlativos: las 4 cotizaciones tienen `numero` 1, 2, 3, 4 — consecutivos, sin saltos ni repetidos.
7. Aislamiento: org 2 (RUT `888888888`) ve 0 filas en `cotizaciones`/`cotizaciones_lineas` y sus RPCs contra la cotización 1 → `'La cotización no existe'`.
8. Cleanup FK-safe (movimientos_stock → cotizaciones_lineas → cotizaciones → documentos_venta_lineas → documentos_venta → bodegas/productos/clientes → suscripciones/miembros/empresas/organizaciones → auth.users) + 0 filas + borrar script.

Si alguna aserción falla: defecto real → BLOCKED con detalle.

- [ ] **Step 3: Reporte**

`.superpowers/sdd/task-8-plan9-report.md` con todo; nota: click-through del usuario en la demo.

---

## Verificación final del plan

- `pnpm test` (93) + `pnpm supabase test db` (**132**) + `pnpm build` (3 apps) verdes.
- Ciclo completo: cotización con precios negociados por línea → imprimible → enviada → aceptada solo vigente → convertida a nota de venta con los precios COTIZADOS (incluso si venció después de aceptar) → factura emitida baja stock; las rechazadas guardan su motivo, nada se convierte dos veces, correlativos sin saltos, todo aislado por empresa.
- Criterio de éxito del spec §9 cumplido.
