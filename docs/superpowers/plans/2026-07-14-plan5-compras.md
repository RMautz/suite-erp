# Plan 5: Compras (OC + recepción parcial + hardening TOCTOU) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar el ciclo de abastecimiento — orden de compra a proveedor → recepción (parcial o total) → entrada automática de stock con costo trazado — y cerrar el TOCTOU de ventas del Plan 4 con una RPC serializada por advisory lock.

**Architecture:** Espejo de Ventas: `ordenes_compra`+líneas y `recepciones`+líneas como documentos propios; toda mutación de negocio vía RPCs security-definer (creación de OC con numeración correlativa atómica; recepción atómica con `for update` que valida pendientes, escribe el ledger y deriva el estado). El helper de emisión (`emision.ts`) pasa a delegar en una RPC solo-service_role con `pg_advisory_xact_lock`.

**Tech Stack:** Next.js 15 App Router (Server Actions + `useActionState`), Supabase (Postgres 17, RLS, pgTAP), Turborepo, Vitest, TypeScript.

**Spec:** `docs/superpowers/specs/2026-07-14-plan5-compras-design.md` (aprobado 2026-07-14).

## Global Constraints

- Multi-tenant: toda tabla nueva lleva `empresa_id` + RLS + grants explícitos (sin grant todo da 42501 antes de evaluar RLS); toda referencia cross-tabla tenant-scoped usa FK compuesta `(empresa_id, x_id) references tabla (empresa_id, id)`; toda tabla referenciada lleva `unique (empresa_id, id)`.
- En app code, TODA query/mutación se acota con `.eq('empresa_id', activa.id)` y `activa` viene de `obtenerEmpresaActiva()` (cookie validada), JAMÁS del formulario.
- Toda mutación con `.select('id')` que devuelve 0 filas = error explícito (RLS filtra en silencio, no lanza).
- Escrituras de compras: los `insert` de las 4 tablas SOLO vía RPC (sin insert directo de `authenticated`); `ordenes_compra` admite `update` directo restringido por RLS a `dueno`/`admin` y por grant de columnas a (`estado`, `actualizado_en`) — solo transiciones enviar/cancelar.
- Matriz de roles: crear/enviar/cancelar OC = `dueno`/`admin`; registrar recepción = `dueno`/`admin`/`bodeguero`; lectura = cualquier miembro.
- Estados OC: `borrador → enviada → recibida_parcial → recibida_total`; `cancelada` solo desde `borrador`/`enviada` (guard que ya garantiza "sin recepciones": toda recepción saca la OC de `enviada` en su misma transacción).
- `movimientos_stock` es inmutable: solo select para authenticated; los inserts de recepción salen DENTRO de `registrar_recepcion`; los de venta/NC vía `registrar_movimientos_documento` (SOLO service_role).
- Invariante de emisión (Plan 4, se conserva): `registrarMovimientosDocumento` en `emision.ts` NUNCA lanza y corre después de persistir el documento `emitido`.
- CLP entero (sin decimales); identificadores ASCII; dominio y copy de usuario en español.
- JAMÁS emitir el carácter BOM literal en ningún archivo (UTF-8 sin BOM).
- Windows/PowerShell 5.1: `&&` no encadena; prefijar cada comando con el refresh de PATH (ver memoria del proyecto).

---

### Task 1: `@suite/core` — lógica de compras (TDD)

**Files:**
- Create: `packages/core/src/compras.ts`
- Create: `packages/core/src/compras.test.ts`
- Modify: `packages/core/src/index.ts` (agregar `export * from './compras'`)

**Interfaces:**
- Consumes: nada (funciones puras).
- Produces: `pendienteLinea(linea: LineaOrdenCompra): number`, `estadoOrdenTrasRecepcion(lineas: LineaOrdenCompra[]): 'recibida_parcial' | 'recibida_total'`, `totalOrden(lineas: { cantidad: number; costoUnitario: number }[]): number`, tipo `LineaOrdenCompra = { cantidadPedida: number; cantidadRecibida: number }`. Los usan las Tasks 5-7 (UI) y conceptualmente replican la lógica de la RPC de Task 2.

- [ ] **Step 1: Test que falla**

`packages/core/src/compras.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { estadoOrdenTrasRecepcion, pendienteLinea, totalOrden } from './compras'

describe('pendienteLinea', () => {
  it('resta lo recibido de lo pedido', () => {
    expect(pendienteLinea({ cantidadPedida: 10, cantidadRecibida: 4 })).toBe(6)
  })
  it('nunca es negativo', () => {
    expect(pendienteLinea({ cantidadPedida: 5, cantidadRecibida: 9 })).toBe(0)
  })
})

describe('estadoOrdenTrasRecepcion', () => {
  it('parcial si alguna línea tiene pendiente', () => {
    expect(
      estadoOrdenTrasRecepcion([
        { cantidadPedida: 10, cantidadRecibida: 10 },
        { cantidadPedida: 5, cantidadRecibida: 3 },
      ])
    ).toBe('recibida_parcial')
  })
  it('total si todas las líneas están completas', () => {
    expect(
      estadoOrdenTrasRecepcion([
        { cantidadPedida: 10, cantidadRecibida: 10 },
        { cantidadPedida: 5, cantidadRecibida: 5 },
      ])
    ).toBe('recibida_total')
  })
})

describe('totalOrden', () => {
  it('suma cantidad x costo por línea (CLP entero)', () => {
    expect(
      totalOrden([
        { cantidad: 10, costoUnitario: 1500 },
        { cantidad: 2, costoUnitario: 89900 },
      ])
    ).toBe(194800)
  })
  it('orden vacía vale 0', () => {
    expect(totalOrden([])).toBe(0)
  })
})
```

- [ ] **Step 2: Verificar que falla**

Run: `pnpm --filter @suite/core test`
Expected: FAIL — `Cannot find module './compras'` (o equivalente).

- [ ] **Step 3: Implementación mínima**

`packages/core/src/compras.ts`:

```ts
export type LineaOrdenCompra = { cantidadPedida: number; cantidadRecibida: number }

export function pendienteLinea(linea: LineaOrdenCompra): number {
  return Math.max(0, linea.cantidadPedida - linea.cantidadRecibida)
}

export function estadoOrdenTrasRecepcion(lineas: LineaOrdenCompra[]): 'recibida_parcial' | 'recibida_total' {
  return lineas.some((l) => pendienteLinea(l) > 0) ? 'recibida_parcial' : 'recibida_total'
}

export function totalOrden(lineas: { cantidad: number; costoUnitario: number }[]): number {
  return lineas.reduce((s, l) => s + Math.round(l.cantidad * l.costoUnitario), 0)
}
```

En `packages/core/src/index.ts` agregar: `export * from './compras'`

- [ ] **Step 4: Verificar que pasa**

Run: `pnpm --filter @suite/core test`
Expected: PASS — 51 tests (45 existentes + 6 nuevos).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/compras.ts packages/core/src/compras.test.ts packages/core/src/index.ts
git commit -m "feat(core): lógica de compras (pendiente, estado de OC, total) TDD"
```

---

### Task 2: Migración 0009 — compras + hardening

**Files:**
- Create: `supabase/migrations/00000000000009_compras.sql`

**Interfaces:**
- Consumes: `app.mis_empresas()`, `app.tiene_rol_en_empresa(uuid, text[])`, tablas `proveedores`/`productos`/`bodegas`/`movimientos_stock`/`documentos_venta` (todas con `unique (empresa_id, id)`).
- Produces: tablas `ordenes_compra`, `ordenes_compra_lineas`, `recepciones`, `recepciones_lineas`; columna `movimientos_stock.referencia_recepcion_id`; RPCs `crear_orden_compra(p_empresa uuid, p_proveedor uuid, p_lineas jsonb, p_notas text) returns uuid`, `registrar_recepcion(p_empresa uuid, p_orden uuid, p_bodega uuid, p_lineas jsonb, p_notas text) returns uuid`, `registrar_movimientos_documento(p_empresa uuid, p_documento uuid, p_lineas jsonb, p_signo integer, p_motivo text) returns void`.
- Formas jsonb: OC `[{"productoId": "<uuid>", "cantidad": 10, "costoUnitario": 1500}]`; recepción `[{"ordenLineaId": "<uuid>", "cantidad": 4}]`; movimientos doc `[{"productoId": "<uuid>", "cantidad": 2}]`.

- [ ] **Step 1: Escribir la migración**

`supabase/migrations/00000000000009_compras.sql`:

```sql
-- Compras: ordenes de compra, recepciones parciales y hardening TOCTOU de ventas.

-- ---------- Ordenes de compra ----------
create table public.ordenes_compra (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  numero integer not null,
  proveedor_id uuid not null,
  estado text not null default 'borrador'
    check (estado in ('borrador', 'enviada', 'recibida_parcial', 'recibida_total', 'cancelada')),
  notas text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  unique (empresa_id, numero),
  unique (empresa_id, id),
  foreign key (empresa_id, proveedor_id) references public.proveedores (empresa_id, id)
);
create index ordenes_compra_estado_idx on public.ordenes_compra (empresa_id, estado);

create table public.ordenes_compra_lineas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  orden_id uuid not null,
  producto_id uuid not null,
  descripcion text not null,
  cantidad_pedida integer not null check (cantidad_pedida > 0),
  costo_unitario integer not null check (costo_unitario >= 0),
  cantidad_recibida integer not null default 0
    check (cantidad_recibida >= 0 and cantidad_recibida <= cantidad_pedida),
  unique (empresa_id, id),
  foreign key (empresa_id, orden_id) references public.ordenes_compra (empresa_id, id),
  foreign key (empresa_id, producto_id) references public.productos (empresa_id, id)
);
create index ordenes_compra_lineas_orden_idx on public.ordenes_compra_lineas (empresa_id, orden_id);

-- ---------- Recepciones (una entrega física = un documento) ----------
create table public.recepciones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  orden_id uuid not null,
  bodega_id uuid not null,
  notas text,
  creado_en timestamptz not null default now(),
  unique (empresa_id, id),
  foreign key (empresa_id, orden_id) references public.ordenes_compra (empresa_id, id),
  foreign key (empresa_id, bodega_id) references public.bodegas (empresa_id, id)
);
create index recepciones_orden_idx on public.recepciones (empresa_id, orden_id);

create table public.recepciones_lineas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  recepcion_id uuid not null,
  orden_linea_id uuid not null,
  producto_id uuid not null,
  cantidad integer not null check (cantidad > 0),
  costo_unitario integer not null check (costo_unitario >= 0),
  unique (empresa_id, id),
  foreign key (empresa_id, recepcion_id) references public.recepciones (empresa_id, id),
  foreign key (empresa_id, orden_linea_id) references public.ordenes_compra_lineas (empresa_id, id),
  foreign key (empresa_id, producto_id) references public.productos (empresa_id, id)
);
create index recepciones_lineas_recepcion_idx on public.recepciones_lineas (empresa_id, recepcion_id);

-- ---------- Ledger: referencia a la recepción (espejo de referencia_documento_id) ----------
alter table public.movimientos_stock add column referencia_recepcion_id uuid;
alter table public.movimientos_stock
  add constraint movimientos_stock_recepcion_fk
  foreign key (empresa_id, referencia_recepcion_id) references public.recepciones (empresa_id, id);
create index movimientos_stock_recepcion_idx on public.movimientos_stock (empresa_id, referencia_recepcion_id);

-- ---------- RLS ----------
alter table public.ordenes_compra enable row level security;
alter table public.ordenes_compra_lineas enable row level security;
alter table public.recepciones enable row level security;
alter table public.recepciones_lineas enable row level security;

create policy "miembros ven ordenes" on public.ordenes_compra
  for select to authenticated using (empresa_id in (select app.mis_empresas()));
create policy "miembros ven lineas de orden" on public.ordenes_compra_lineas
  for select to authenticated using (empresa_id in (select app.mis_empresas()));
create policy "miembros ven recepciones" on public.recepciones
  for select to authenticated using (empresa_id in (select app.mis_empresas()));
create policy "miembros ven lineas de recepcion" on public.recepciones_lineas
  for select to authenticated using (empresa_id in (select app.mis_empresas()));

-- Transiciones simples (enviar/cancelar) por update directo, SOLO dueno/admin.
-- El grant de columnas (abajo) limita el update a (estado, actualizado_en).
-- Tolerancia v1 (spec §3): un dueno podria forzar un estado de su PROPIA empresa via API;
-- no cruza tenant y no crea stock (el stock solo entra por registrar_recepcion).
create policy "duenos transicionan ordenes" on public.ordenes_compra
  for update to authenticated
  using (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']))
  with check (app.tiene_rol_en_empresa(empresa_id, array['dueno', 'admin']));

-- ---------- Grants Data API (leccion Plan 1) ----------
grant select on public.ordenes_compra, public.ordenes_compra_lineas,
  public.recepciones, public.recepciones_lineas to authenticated;
grant update (estado, actualizado_en) on public.ordenes_compra to authenticated;
grant select, insert, update, delete on public.ordenes_compra, public.ordenes_compra_lineas,
  public.recepciones, public.recepciones_lineas to service_role;

-- ---------- Crear orden de compra (numeracion correlativa atomica) ----------
-- Descripcion y validaciones DEL PRODUCTO (fuente de verdad), como crear_documento_venta.
create or replace function public.crear_orden_compra(
  p_empresa uuid, p_proveedor uuid, p_lineas jsonb, p_notas text
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_orden uuid;
  v_numero integer;
  v_linea jsonb;
  v_nombre text;
  v_cant integer;
  v_costo integer;
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin']) then
    raise exception 'Tu rol no permite crear órdenes de compra';
  end if;
  if not exists (select 1 from proveedores where id = p_proveedor and empresa_id = p_empresa and activo) then
    raise exception 'Proveedor no encontrado en la empresa';
  end if;
  if p_lineas is null or jsonb_array_length(p_lineas) = 0 then
    raise exception 'La orden debe tener al menos una línea';
  end if;

  -- Serializa la numeracion por empresa (dos creaciones concurrentes no chocan el unique).
  perform pg_advisory_xact_lock(hashtextextended('ordenes_compra:' || p_empresa::text, 42));
  select coalesce(max(numero), 0) + 1 into v_numero from ordenes_compra where empresa_id = p_empresa;

  insert into ordenes_compra (empresa_id, numero, proveedor_id, notas)
  values (p_empresa, v_numero, p_proveedor, nullif(trim(coalesce(p_notas, '')), ''))
  returning id into v_orden;

  for v_linea in select * from jsonb_array_elements(p_lineas) loop
    select nombre into v_nombre
    from productos
    where id = (v_linea->>'productoId')::uuid and empresa_id = p_empresa and activo;
    if not found then
      raise exception 'Producto no encontrado o inactivo en la empresa';
    end if;
    v_cant := (v_linea->>'cantidad')::integer;
    v_costo := (v_linea->>'costoUnitario')::integer;
    if v_cant is null or v_cant < 1 then
      raise exception 'La cantidad debe ser al menos 1';
    end if;
    if v_costo is null or v_costo < 0 then
      raise exception 'El costo unitario no puede ser negativo';
    end if;
    insert into ordenes_compra_lineas (empresa_id, orden_id, producto_id, descripcion, cantidad_pedida, costo_unitario)
    values (p_empresa, v_orden, (v_linea->>'productoId')::uuid, v_nombre, v_cant, v_costo);
  end loop;

  return v_orden;
end $$;
revoke execute on function public.crear_orden_compra(uuid, uuid, jsonb, text) from anon, public;
grant execute on function public.crear_orden_compra(uuid, uuid, jsonb, text) to authenticated;

-- ---------- Registrar recepcion (atomica, serializada por for update) ----------
create or replace function public.registrar_recepcion(
  p_empresa uuid, p_orden uuid, p_bodega uuid, p_lineas jsonb, p_notas text
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_recepcion uuid;
  v_estado text;
  v_numero integer;
  v_proveedor uuid;
  v_linea jsonb;
  v_ol record;
  v_cant integer;
  v_pendiente integer;
begin
  if not app.tiene_rol_en_empresa(p_empresa, array['dueno', 'admin', 'bodeguero']) then
    raise exception 'Tu rol no permite recibir mercadería';
  end if;
  if p_lineas is null or jsonb_array_length(p_lineas) = 0 then
    raise exception 'La recepción debe tener al menos una línea';
  end if;

  -- Lock de la orden: dos recepciones concurrentes (o una recepcion vs una cancelacion)
  -- se serializan aqui; el estado se re-valida DESPUES de adquirir el lock.
  select estado, numero, proveedor_id into v_estado, v_numero, v_proveedor
  from ordenes_compra where id = p_orden and empresa_id = p_empresa
  for update;
  if not found then
    raise exception 'Orden no encontrada en la empresa';
  end if;
  if v_estado not in ('enviada', 'recibida_parcial') then
    raise exception 'La orden no está en un estado que permita recepción';
  end if;

  insert into recepciones (empresa_id, orden_id, bodega_id, notas)
  values (p_empresa, p_orden, p_bodega, nullif(trim(coalesce(p_notas, '')), ''))
  returning id into v_recepcion;

  for v_linea in select * from jsonb_array_elements(p_lineas) loop
    select id, producto_id, costo_unitario, cantidad_pedida, cantidad_recibida into v_ol
    from ordenes_compra_lineas
    where id = (v_linea->>'ordenLineaId')::uuid and orden_id = p_orden and empresa_id = p_empresa;
    if not found then
      raise exception 'Línea de la orden no encontrada';
    end if;
    v_cant := (v_linea->>'cantidad')::integer;
    if v_cant is null or v_cant < 1 then
      raise exception 'La cantidad debe ser al menos 1';
    end if;
    v_pendiente := v_ol.cantidad_pedida - v_ol.cantidad_recibida;
    if v_cant > v_pendiente then
      raise exception 'La cantidad recibida supera lo pendiente (pendiente: %)', v_pendiente;
    end if;

    insert into recepciones_lineas (empresa_id, recepcion_id, orden_linea_id, producto_id, cantidad, costo_unitario)
    values (p_empresa, v_recepcion, v_ol.id, v_ol.producto_id, v_cant, v_ol.costo_unitario);

    update ordenes_compra_lineas set cantidad_recibida = cantidad_recibida + v_cant where id = v_ol.id;

    insert into movimientos_stock (empresa_id, producto_id, bodega_id, tipo, cantidad, motivo, proveedor_id, referencia_recepcion_id)
    values (p_empresa, v_ol.producto_id, p_bodega, 'entrada', v_cant,
            'Recepción OC N° ' || v_numero, v_proveedor, v_recepcion);
  end loop;

  update ordenes_compra
  set estado = case
        when exists (select 1 from ordenes_compra_lineas where orden_id = p_orden and cantidad_recibida < cantidad_pedida)
        then 'recibida_parcial' else 'recibida_total' end,
      actualizado_en = now()
  where id = p_orden;

  return v_recepcion;
end $$;
revoke execute on function public.registrar_recepcion(uuid, uuid, uuid, jsonb, text) from anon, public;
grant execute on function public.registrar_recepcion(uuid, uuid, uuid, jsonb, text) to authenticated;

-- ---------- Hardening TOCTOU de ventas (review Plan 4): SOLO service_role ----------
-- Sin check de pertenencia: auth.uid() es null bajo service_role y el UNICO ejecutor
-- permitido es service_role (nuestro backend confiable) — el revoke ES la frontera.
create or replace function public.registrar_movimientos_documento(
  p_empresa uuid, p_documento uuid, p_lineas jsonb, p_signo integer, p_motivo text
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_bodega uuid;
  v_linea jsonb;
  v_prod uuid;
  v_cant integer;
begin
  if p_signo not in (1, -1) then
    raise exception 'El signo debe ser 1 o -1';
  end if;

  -- Serializa por documento: el check de idempotencia y los inserts corren dentro
  -- del lock — cierra el double-decrement de reintentos simultaneos (Plan 4).
  perform pg_advisory_xact_lock(hashtextextended(p_documento::text, 42));

  if exists (select 1 from movimientos_stock
             where empresa_id = p_empresa and referencia_documento_id = p_documento) then
    return; -- ya registrados (reintento)
  end if;

  select id into v_bodega from bodegas where empresa_id = p_empresa and activo order by creado_en limit 1;
  if v_bodega is null then
    insert into bodegas (empresa_id, nombre) values (p_empresa, 'Bodega Principal') returning id into v_bodega;
  end if;

  for v_linea in select * from jsonb_array_elements(coalesce(p_lineas, '[]'::jsonb)) loop
    v_prod := nullif(v_linea->>'productoId', '')::uuid;
    v_cant := (v_linea->>'cantidad')::integer;
    if v_prod is null or v_cant is null or v_cant = 0 then
      continue; -- linea sin producto (p.ej. la linea sintetica de una NC)
    end if;
    insert into movimientos_stock (empresa_id, producto_id, bodega_id, tipo, cantidad, motivo, referencia_documento_id)
    values (p_empresa, v_prod, v_bodega,
            case when p_signo < 0 then 'salida' else 'entrada' end,
            p_signo * abs(v_cant), p_motivo, p_documento);
  end loop;
end $$;
revoke execute on function public.registrar_movimientos_documento(uuid, uuid, jsonb, integer, text) from anon, authenticated, public;
grant execute on function public.registrar_movimientos_documento(uuid, uuid, jsonb, integer, text) to service_role;
```

- [ ] **Step 2: Aplicar y verificar**

Run: `pnpm supabase db reset` (timeout largo)
Expected: aplica 0001-0009 sin errores.

Run: `pnpm supabase test db`
Expected: 42 asserts existentes siguen verdes (los tests de compras llegan en Task 3).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/00000000000009_compras.sql
git commit -m "feat(db): compras (OC, recepciones) y RPC serializada de movimientos por documento"
```

---

### Task 3: pgTAP de compras

**Files:**
- Create: `supabase/tests/database/compras.test.sql`

**Interfaces:**
- Consumes: migración 0009 completa (Task 2). Fixtures con el MISMO patrón de `ventas.test.sql`/`inventario.test.sql` (usuarios/orgs/empresas/miembros insertados como postgres, luego `set local role authenticated` + `request.jwt.claims`).
- RUTs de fixtures reservados: `761111116` (Org A), `762222221` (Org B), `765432103` (cliente A). NO usar otros valores en datos demo committeados.

- [ ] **Step 1: Escribir el test**

`supabase/tests/database/compras.test.sql`:

```sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'ana@a.cl'),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'beto@b.cl'),
  ('00000000-0000-0000-0000-000000000000', '55555555-5555-5555-5555-555555555555', 'authenticated', 'authenticated', 'ces@a.cl'),
  ('00000000-0000-0000-0000-000000000000', '66666666-6666-6666-6666-666666666666', 'authenticated', 'authenticated', 'dora@a.cl');

insert into public.organizaciones (id, rut, razon_social)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '761111116', 'Org A'),
       ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '762222221', 'Org B');

insert into public.empresas (id, organizacion_id, rut, razon_social)
values ('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '761111116', 'Empresa A'),
       ('eeeeeeee-0000-0000-0000-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '762222221', 'Empresa B');

insert into public.miembros (usuario_id, organizacion_id, rol)
values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'dueno'),
       ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'dueno'),
       ('55555555-5555-5555-5555-555555555555', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'contador'),
       ('66666666-6666-6666-6666-666666666666', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bodeguero');

insert into public.productos (id, empresa_id, sku, nombre, precio_neto)
values ('99999999-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'P1', 'Producto A', 10000);

insert into public.bodegas (id, empresa_id, nombre)
values ('bbbb0000-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'Bodega A');

insert into public.proveedores (id, empresa_id, rut, razon_social)
values ('dddd0000-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '765432103', 'Proveedor A');

insert into public.clientes (id, empresa_id, rut, razon_social)
values ('cccccccc-0000-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', '765432103', 'Cliente A');

insert into public.documentos_venta (id, empresa_id, tipo, cliente_id, estado, neto, exento, iva, total)
values ('dddddddd-1111-0000-0000-aaaaaaaaaaaa', 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'factura',
        'cccccccc-0000-0000-0000-aaaaaaaaaaaa', 'emitido', 10000, 0, 1900, 11900);

-- ===== Ana (duena A) =====
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- 1) Ana crea una OC via RPC.
select lives_ok(
  $$select crear_orden_compra('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'dddd0000-0000-0000-0000-aaaaaaaaaaaa',
    '[{"productoId":"99999999-0000-0000-0000-aaaaaaaaaaaa","cantidad":10,"costoUnitario":1500}]'::jsonb, 'primera OC')$$,
  'la dueña crea una orden de compra'
);
-- 2) El numero correlativo parte en 1.
select is( (select numero from ordenes_compra where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' limit 1),
  1, 'el numero correlativo parte en 1' );
-- 3) La descripcion viene DEL PRODUCTO.
select is( (select descripcion from ordenes_compra_lineas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' limit 1),
  'Producto A', 'la descripción de la línea viene del producto' );

-- 4) Dora (bodeguera) NO crea OC.
set local request.jwt.claims to '{"sub": "66666666-6666-6666-6666-666666666666", "role": "authenticated"}';
select throws_ok(
  $$select crear_orden_compra('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa', 'dddd0000-0000-0000-0000-aaaaaaaaaaaa',
    '[{"productoId":"99999999-0000-0000-0000-aaaaaaaaaaaa","cantidad":1,"costoUnitario":1}]'::jsonb, null)$$,
  'P0001', 'Tu rol no permite crear órdenes de compra',
  'la bodeguera no puede crear órdenes de compra'
);

-- 5) Recibir en borrador esta prohibido.
select throws_ok(
  $$select registrar_recepcion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from ordenes_compra where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' limit 1),
    'bbbb0000-0000-0000-0000-aaaaaaaaaaaa',
    '[{"ordenLineaId":"00000000-0000-0000-0000-000000000000","cantidad":1}]'::jsonb, null)$$,
  'P0001', 'La orden no está en un estado que permita recepción',
  'no se puede recibir una orden en borrador'
);

-- 6) Ana marca la OC enviada (update directo con guard de estado).
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select is(
  (with u as (
     update ordenes_compra set estado = 'enviada'
     where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and estado = 'borrador'
     returning 1)
   select count(*) from u),
  1::bigint, 'la dueña marca la orden enviada'
);

-- 7) Dora (bodeguera) registra una recepcion parcial (4 de 10).
set local request.jwt.claims to '{"sub": "66666666-6666-6666-6666-666666666666", "role": "authenticated"}';
select lives_ok(
  $$select registrar_recepcion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from ordenes_compra where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' limit 1),
    'bbbb0000-0000-0000-0000-aaaaaaaaaaaa',
    (select jsonb_build_array(jsonb_build_object('ordenLineaId', id, 'cantidad', 4))
       from ordenes_compra_lineas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' limit 1), 'entrega 1')$$,
  'la bodeguera registra una recepción parcial'
);
-- 8) El stock subio a 4.
select is( (select cantidad from stock_actual where producto_id = '99999999-0000-0000-0000-aaaaaaaaaaaa'),
  4, 'el stock refleja la recepción (4)' );
-- 9) La OC quedo recibida_parcial.
select is( (select estado from ordenes_compra where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' limit 1),
  'recibida_parcial', 'la orden queda recibida parcial' );

-- 10) Sobre-recepcion rechazada (7 > pendiente 6).
select throws_ok(
  $$select registrar_recepcion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from ordenes_compra where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' limit 1),
    'bbbb0000-0000-0000-0000-aaaaaaaaaaaa',
    (select jsonb_build_array(jsonb_build_object('ordenLineaId', id, 'cantidad', 7))
       from ordenes_compra_lineas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' limit 1), null)$$,
  'P0001', 'La cantidad recibida supera lo pendiente (pendiente: 6)',
  'la sobre-recepción se rechaza con el pendiente en el mensaje'
);

-- 11) Recibir el resto (6) completa la orden.
select lives_ok(
  $$select registrar_recepcion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from ordenes_compra where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' limit 1),
    'bbbb0000-0000-0000-0000-aaaaaaaaaaaa',
    (select jsonb_build_array(jsonb_build_object('ordenLineaId', id, 'cantidad', 6))
       from ordenes_compra_lineas where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' limit 1), 'entrega 2')$$,
  'la bodeguera recibe el resto'
);
-- 12) La OC quedo recibida_total.
select is( (select estado from ordenes_compra where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' limit 1),
  'recibida_total', 'la orden queda recibida total' );

-- 13) Cancelar una orden recibida no hace nada (guard de estado: 0 filas).
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select is(
  (with u as (
     update ordenes_compra set estado = 'cancelada'
     where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' and estado in ('borrador', 'enviada')
     returning 1)
   select count(*) from u),
  0::bigint, 'no se puede cancelar una orden ya recibida'
);

-- 14) Beto (org B) no ve las OCs de A.
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
select is( (select count(*) from ordenes_compra), 0::bigint, 'Beto no ve órdenes de la empresa A' );

-- 15) Ces (contador A) no puede recibir mercaderia.
set local request.jwt.claims to '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated"}';
select throws_ok(
  $$select registrar_recepcion('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    (select id from ordenes_compra where empresa_id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa' limit 1),
    'bbbb0000-0000-0000-0000-aaaaaaaaaaaa',
    '[{"ordenLineaId":"00000000-0000-0000-0000-000000000000","cantidad":1}]'::jsonb, null)$$,
  'P0001', 'Tu rol no permite recibir mercadería',
  'el contador no puede recibir mercadería'
);

-- 16) authenticated NO puede ejecutar la RPC de movimientos por documento.
select throws_ok(
  $$select registrar_movimientos_documento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
    'dddddddd-1111-0000-0000-aaaaaaaaaaaa', '[]'::jsonb, -1, 'x')$$,
  '42501', 'permission denied for function registrar_movimientos_documento',
  'un usuario autenticado no puede ejecutar registrar_movimientos_documento'
);

-- 17-18) service_role la ejecuta y es idempotente (2 llamadas -> 1 fila).
set local role service_role;
-- Primera llamada: setup sin assert (si falla, aborta la transacción del test igual).
select registrar_movimientos_documento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
  'dddddddd-1111-0000-0000-aaaaaaaaaaaa',
  '[{"productoId":"99999999-0000-0000-0000-aaaaaaaaaaaa","cantidad":2}]'::jsonb, -1, 'Venta factura folio 1');
-- 17) Segunda llamada (reintento) no lanza.
select lives_ok(
  $$select registrar_movimientos_documento('eeeeeeee-0000-0000-0000-aaaaaaaaaaaa',
      'dddddddd-1111-0000-0000-aaaaaaaaaaaa',
      '[{"productoId":"99999999-0000-0000-0000-aaaaaaaaaaaa","cantidad":2}]'::jsonb, -1, 'Venta factura folio 1')$$,
  'service_role reintenta la RPC sin error'
);
reset role;
-- 18) El reintento no duplico filas.
select is(
  (select count(*) from public.movimientos_stock
   where referencia_documento_id = 'dddddddd-1111-0000-0000-aaaaaaaaaaaa'),
  1::bigint, 'el reintento no duplica movimientos (idempotente bajo el lock)'
);

-- 19) Anonimo denegado de plano.
set local request.jwt.claims to '{"role": "anon"}';
set local role anon;
select throws_ok(
  'select count(*) from ordenes_compra',
  '42501', 'permission denied for table ordenes_compra',
  'un anónimo no puede consultar órdenes de compra'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Ejecutar**

Run: `pnpm supabase test db`
Expected: 6 archivos, **61 asserts** (aislamiento 6, compras 19, inventario 10, maestros 10, registro 7, ventas 9), todos verdes. Si un assert de compras falla, el sospechoso es la migración de Task 2 — NO debilitar el test.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/database/compras.test.sql
git commit -m "test(db): ciclo de compra, roles, aislamiento e idempotencia serializada con pgTAP"
```

---

### Task 4: Regenerar tipos `@suite/db`

**Files:**
- Modify: `packages/db/src/types.ts` (regenerado)

**Interfaces:**
- Produces: tipo `Database` con `ordenes_compra`, `ordenes_compra_lineas`, `recepciones`, `recepciones_lineas`, la columna `referencia_recepcion_id` en movimientos_stock y las RPCs `crear_orden_compra`, `registrar_recepcion`, `registrar_movimientos_documento` en Functions.

- [ ] **Step 1: Regenerar y verificar**

Run: `pnpm --filter @suite/db gen`
Expected: `types.ts` incluye las 4 tablas nuevas, la columna y las 3 RPCs (verificar por grep antes de commitear).

Run: `pnpm tsc --noEmit -p packages/db/tsconfig.json`
Expected: sin errores.

Run: `pnpm build --concurrency=1`
Expected: las 3 apps compilan.

- [ ] **Step 2: Commit**

```bash
git add packages/db/src/types.ts
git commit -m "feat(db): tipos regenerados con tablas de compras"
```

---

### Task 5: ERP — lista de OCs + nueva OC + NAV

**Files:**
- Create: `apps/erp/app/compras/page.tsx`, `apps/erp/app/compras/acciones.ts`, `apps/erp/app/compras/nueva/page.tsx`, `apps/erp/componentes/formulario-orden-compra.tsx`
- Modify: `apps/erp/app/layout.tsx` (NAV: agregar Compras entre Inventario y Configuración)

**Interfaces:**
- Consumes: RPC `crear_orden_compra`, `totalOrden`/`formatearCLP` de `@suite/core`, `EstadoForm` de `apps/erp/app/tipos.ts`, `obtenerEmpresaActiva`, `@suite/ui`.
- Produces: Server Action `crearOrdenCompra(prev, formData): Promise<EstadoForm>`; constantes `TONO_ESTADO`/`ETIQUETA_ESTADO` exportadas desde `apps/erp/app/compras/estados.ts` (crear también ese archivo) que reusan las Tasks 6-7.

- [ ] **Step 1: Constantes de estado**

`apps/erp/app/compras/estados.ts`:

```ts
export const TONO_ESTADO: Record<string, 'verde' | 'amarillo' | 'rojo' | 'gris'> = {
  borrador: 'gris',
  enviada: 'amarillo',
  recibida_parcial: 'amarillo',
  recibida_total: 'verde',
  cancelada: 'rojo',
}

export const ETIQUETA_ESTADO: Record<string, string> = {
  borrador: 'Borrador',
  enviada: 'Enviada',
  recibida_parcial: 'Recibida parcial',
  recibida_total: 'Recibida total',
  cancelada: 'Cancelada',
}

export const ESTADOS_OC = ['borrador', 'enviada', 'recibida_parcial', 'recibida_total', 'cancelada'] as const
```

- [ ] **Step 2: Server Action de creación**

`apps/erp/app/compras/acciones.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import type { EstadoForm } from '../tipos'

type LineaEntrada = { productoId: string; cantidad: number; costoUnitario: number }

export async function crearOrdenCompra(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const proveedor = String(formData.get('proveedor_id') ?? '')
  const notas = String(formData.get('notas') ?? '').trim()
  if (!proveedor) return { error: 'Selecciona un proveedor' }

  let lineas: LineaEntrada[]
  try {
    lineas = JSON.parse(String(formData.get('lineas') ?? '[]')) as LineaEntrada[]
  } catch {
    return { error: 'Las líneas de la orden no son válidas' }
  }
  if (!Array.isArray(lineas) || lineas.length === 0) return { error: 'Agrega al menos una línea' }
  for (const l of lineas) {
    if (!l.productoId || !Number.isInteger(l.cantidad) || l.cantidad < 1) {
      return { error: 'Cada línea necesita producto y cantidad entera mayor a 0' }
    }
    if (!Number.isInteger(l.costoUnitario) || l.costoUnitario < 0) {
      return { error: 'El costo unitario debe ser un entero mayor o igual a 0' }
    }
  }

  const supabase = await crearClienteServidor()
  const { data: ordenId, error } = await supabase.rpc('crear_orden_compra', {
    p_empresa: activa.id,
    p_proveedor: proveedor,
    p_lineas: lineas.map((l) => ({ productoId: l.productoId, cantidad: l.cantidad, costoUnitario: l.costoUnitario })),
    p_notas: notas || null,
  })
  if (error || !ordenId) {
    return { error: error?.message.includes('rol') ? 'Tu rol no permite crear órdenes de compra' : 'No se pudo crear la orden' }
  }
  revalidatePath('/compras')
  redirect('/compras/' + ordenId)
}
```

Nota de tipos: si el tipo generado de `p_lineas`/`p_notas` exige `Json`/no-null, castear el valor (`as unknown as Json`, `p_notas: (notas || null) as string`) con un comentario de una línea explicando el gap del generador (mismo criterio documentado que Task 7 del Plan 4). NO usar `any` ni `@ts-ignore`.

- [ ] **Step 3: Formulario (client) con líneas dinámicas**

`apps/erp/componentes/formulario-orden-compra.tsx` (espejo de `formulario-venta.tsx`, con costo editable):

```tsx
'use client'

import { useActionState, useState } from 'react'
import { Boton, Campo, Entrada, Selector, Tabla, Td, Th, Tr, Tarjeta } from '@suite/ui'
import { formatearCLP, totalOrden } from '@suite/core'
import type { EstadoForm } from '../app/tipos'

interface ProductoOpcion { id: string; nombre: string }
interface ProveedorOpcion { id: string; razon_social: string }
interface LineaOc { productoId: string; descripcion: string; cantidad: number; costoUnitario: number }

export function FormularioOrdenCompra({
  accion,
  productos,
  proveedores,
}: {
  accion: (prev: EstadoForm, formData: FormData) => Promise<EstadoForm>
  productos: ProductoOpcion[]
  proveedores: ProveedorOpcion[]
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoForm)
  const [lineas, setLineas] = useState<LineaOc[]>([])

  function agregar(productoId: string) {
    const p = productos.find((x) => x.id === productoId)
    if (!p) return
    setLineas((ls) => [...ls, { productoId: p.id, descripcion: p.nombre, cantidad: 1, costoUnitario: 0 }])
  }
  function cambiar(i: number, campo: 'cantidad' | 'costoUnitario', valor: number) {
    setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, [campo]: Math.max(campo === 'cantidad' ? 1 : 0, Math.trunc(valor) || 0) } : l)))
  }
  function quitar(i: number) {
    setLineas((ls) => ls.filter((_, j) => j !== i))
  }

  const total = totalOrden(lineas.map((l) => ({ cantidad: l.cantidad, costoUnitario: l.costoUnitario })))

  return (
    <form action={enviar}>
      <input type="hidden" name="lineas" value={JSON.stringify(lineas.map(({ descripcion: _d, ...resto }) => resto))} />
      <Tarjeta className="mb-4 max-w-3xl">
        <div className="flex flex-wrap items-end gap-3">
          <Campo etiqueta="Proveedor *">
            <Selector name="proveedor_id" required defaultValue="">
              <option value="" disabled>Selecciona…</option>
              {proveedores.map((p) => <option key={p.id} value={p.id}>{p.razon_social}</option>)}
            </Selector>
          </Campo>
          <Campo etiqueta="Agregar producto">
            <Selector value="" onChange={(e: React.ChangeEvent<HTMLSelectElement>) => { agregar(e.currentTarget.value); e.currentTarget.value = '' }}>
              <option value="" disabled>Selecciona…</option>
              {productos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </Selector>
          </Campo>
          <Campo etiqueta="Notas"><Entrada name="notas" placeholder="Opcional" /></Campo>
        </div>
      </Tarjeta>

      <Tabla>
        <thead>
          <tr><Th>Producto</Th><Th>Cantidad</Th><Th className="text-right">Costo unitario</Th><Th className="text-right">Subtotal</Th><Th /></tr>
        </thead>
        <tbody>
          {lineas.map((l, i) => (
            <Tr key={i}>
              <Td>{l.descripcion}</Td>
              <Td><Entrada type="number" min={1} value={l.cantidad} onChange={(e: React.ChangeEvent<HTMLInputElement>) => cambiar(i, 'cantidad', Number(e.currentTarget.value))} className="w-20" /></Td>
              <Td className="text-right"><Entrada type="number" min={0} value={l.costoUnitario} onChange={(e: React.ChangeEvent<HTMLInputElement>) => cambiar(i, 'costoUnitario', Number(e.currentTarget.value))} className="w-28 text-right" /></Td>
              <Td className="text-right">{formatearCLP(Math.round(l.cantidad * l.costoUnitario))}</Td>
              <Td><Boton variante="secundario" type="button" className="px-2 py-1 text-xs" onClick={() => quitar(i)}>Quitar</Boton></Td>
            </Tr>
          ))}
          {lineas.length === 0 && <Tr><Td colSpan={5} className="py-6 text-center text-slate-500">Agrega productos a la orden.</Td></Tr>}
        </tbody>
      </Tabla>

      <div className="mt-4 flex flex-col items-end text-sm">
        <div className="text-lg">Total: <strong>{formatearCLP(total)}</strong></div>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2">
        {estado.error && <span className="mr-auto text-sm text-red-600">{estado.error}</span>}
        <Boton type="submit" disabled={pendiente || lineas.length === 0}>{pendiente ? 'Creando…' : 'Crear orden de compra'}</Boton>
      </div>
    </form>
  )
}
```

- [ ] **Step 4: Páginas lista y nueva**

`apps/erp/app/compras/page.tsx`:

```tsx
import Link from 'next/link'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP, totalOrden } from '@suite/core'
import { Boton, Encabezado, Entrada, Insignia, Selector, Tabla, Td, Th, Tr } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../lib/empresa-activa'
import { ESTADOS_OC, ETIQUETA_ESTADO, TONO_ESTADO } from './estados'

export default async function PaginaCompras({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string; q?: string }>
}) {
  const { estado = '', q = '' } = await searchParams
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const supabase = await crearClienteServidor()
  let consulta = supabase
    .from('ordenes_compra')
    .select('id, numero, estado, creado_en, proveedores (razon_social), ordenes_compra_lineas (cantidad_pedida, costo_unitario)')
    .eq('empresa_id', activa.id)
    .order('numero', { ascending: false })
    .limit(100)
  if ((ESTADOS_OC as readonly string[]).includes(estado)) consulta = consulta.eq('estado', estado)
  const { data } = await consulta
  const qLimpia = q.trim().toLowerCase()
  const ordenes = (data ?? []).filter((o) => !qLimpia || (o.proveedores?.razon_social ?? '').toLowerCase().includes(qLimpia))
  return (
    <div>
      <Encabezado titulo="Órdenes de compra">
        <Link href="/compras/nueva"><Boton>Nueva orden</Boton></Link>
      </Encabezado>
      <form className="mb-4 flex flex-wrap items-end gap-3" action="/compras" method="get">
        <Selector name="estado" defaultValue={estado} className="max-w-xs">
          <option value="">Todos los estados</option>
          {ESTADOS_OC.map((e) => <option key={e} value={e}>{ETIQUETA_ESTADO[e]}</option>)}
        </Selector>
        <Entrada name="q" defaultValue={q} placeholder="Buscar por proveedor…" className="max-w-xs" />
        <Boton variante="secundario" type="submit">Filtrar</Boton>
        <Link className="text-sm text-marca-700 hover:underline" href="/compras">Limpiar</Link>
      </form>
      <Tabla>
        <thead><tr><Th>N°</Th><Th>Proveedor</Th><Th>Fecha</Th><Th>Estado</Th><Th className="text-right">Total</Th></tr></thead>
        <tbody>
          {ordenes.map((o) => (
            <Tr key={o.id}>
              <Td><Link className="text-marca-700 hover:underline" href={`/compras/${o.id}`}>OC {o.numero}</Link></Td>
              <Td>{o.proveedores?.razon_social ?? '—'}</Td>
              <Td>{new Date(o.creado_en).toLocaleDateString('es-CL')}</Td>
              <Td><Insignia tono={TONO_ESTADO[o.estado] ?? 'gris'}>{ETIQUETA_ESTADO[o.estado] ?? o.estado}</Insignia></Td>
              <Td className="text-right font-mono">
                {formatearCLP(totalOrden((o.ordenes_compra_lineas ?? []).map((l) => ({ cantidad: l.cantidad_pedida, costoUnitario: l.costo_unitario }))))}
              </Td>
            </Tr>
          ))}
          {ordenes.length === 0 && <Tr><Td colSpan={5} className="py-8 text-center text-slate-500">No hay órdenes {estado || q ? 'que coincidan' : 'todavía'}.</Td></Tr>}
        </tbody>
      </Tabla>
    </div>
  )
}
```

`apps/erp/app/compras/nueva/page.tsx`:

```tsx
import { crearClienteServidor } from '@suite/auth/server'
import { Encabezado } from '@suite/ui'
import { FormularioOrdenCompra } from '../../../componentes/formulario-orden-compra'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { crearOrdenCompra } from '../acciones'

export default async function NuevaOrdenCompra() {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const supabase = await crearClienteServidor()
  const [{ data: productos }, { data: proveedores }] = await Promise.all([
    supabase.from('productos').select('id, nombre').eq('empresa_id', activa.id).eq('activo', true).order('nombre'),
    supabase.from('proveedores').select('id, razon_social').eq('empresa_id', activa.id).eq('activo', true).order('razon_social'),
  ])
  return (
    <div>
      <Encabezado titulo="Nueva orden de compra" />
      <FormularioOrdenCompra
        accion={crearOrdenCompra}
        productos={(productos ?? []).map((p) => ({ id: p.id, nombre: p.nombre }))}
        proveedores={(proveedores ?? []).map((p) => ({ id: p.id, razon_social: p.razon_social }))}
      />
    </div>
  )
}
```

Modificar `apps/erp/app/layout.tsx` — en el `NAV`, después de `{ href: '/inventario', etiqueta: 'Inventario' },` agregar:

```tsx
  { href: '/compras', etiqueta: 'Compras' },
```

- [ ] **Step 5: Verificar**

Run: `pnpm --filter erp build`
Expected: build sin errores. (El link `OC {numero}` a `/compras/[id]` 404ea hasta Task 6 — esperado, mismo patrón transitorio que Plan 4 Task 5→7.)

- [ ] **Step 6: Commit**

```bash
git add apps/erp/app/compras apps/erp/componentes/formulario-orden-compra.tsx apps/erp/app/layout.tsx
git commit -m "feat(erp): lista y creación de órdenes de compra"
```

---

### Task 6: ERP — detalle de OC + transiciones

**Files:**
- Create: `apps/erp/app/compras/[id]/page.tsx`
- Modify: `apps/erp/app/compras/acciones.ts` (agregar `marcarEnviada` y `cancelarOrden`)

**Interfaces:**
- Consumes: `TONO_ESTADO`/`ETIQUETA_ESTADO` (Task 5), `pendienteLinea`/`totalOrden`/`formatearCLP` de `@suite/core`, tabla `ordenes_compra` (update directo columnas estado/actualizado_en, RLS dueno/admin).
- Produces: Server Actions `marcarEnviada(formData): Promise<void>` y `cancelarOrden(formData): Promise<void>`; la página `/compras/[id]` que Task 7 enlaza.

- [ ] **Step 1: Acciones de transición**

Agregar al final de `apps/erp/app/compras/acciones.ts`:

```ts
// Transiciones simples por update directo (RLS: dueno/admin; grant solo columnas estado/actualizado_en).
// El guard .eq('estado', ...) + .select('id') convierte 0 filas de RLS/estado en no-op explícito.
export async function marcarEnviada(formData: FormData): Promise<void> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return
  const id = String(formData.get('id') ?? '')
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase
    .from('ordenes_compra')
    .update({ estado: 'enviada', actualizado_en: new Date().toISOString() })
    .eq('id', id).eq('empresa_id', activa.id).eq('estado', 'borrador')
    .select('id')
  if (error || (data ?? []).length === 0) { console.error('marcarEnviada:', error ?? 'sin filas'); return }
  revalidatePath('/compras')
  revalidatePath('/compras/' + id)
}

export async function cancelarOrden(formData: FormData): Promise<void> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return
  const id = String(formData.get('id') ?? '')
  const supabase = await crearClienteServidor()
  const { data, error } = await supabase
    .from('ordenes_compra')
    .update({ estado: 'cancelada', actualizado_en: new Date().toISOString() })
    .eq('id', id).eq('empresa_id', activa.id).in('estado', ['borrador', 'enviada'])
    .select('id')
  if (error || (data ?? []).length === 0) { console.error('cancelarOrden:', error ?? 'sin filas'); return }
  revalidatePath('/compras')
  revalidatePath('/compras/' + id)
}
```

- [ ] **Step 2: Página de detalle**

`apps/erp/app/compras/[id]/page.tsx`:

```tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP, pendienteLinea, totalOrden } from '@suite/core'
import { Boton, Encabezado, Insignia, Tabla, Tarjeta, Td, Th, Tr } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { cancelarOrden, marcarEnviada } from '../acciones'
import { ETIQUETA_ESTADO, TONO_ESTADO } from '../estados'

export default async function DetalleOrdenCompra({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const supabase = await crearClienteServidor()
  const { data: oc } = await supabase
    .from('ordenes_compra')
    .select(`id, numero, estado, notas, creado_en, proveedores (razon_social),
      ordenes_compra_lineas (id, descripcion, cantidad_pedida, cantidad_recibida, costo_unitario),
      recepciones (id, creado_en, notas, bodegas (nombre), recepciones_lineas (cantidad))`)
    .eq('id', id).eq('empresa_id', activa.id)
    .single()
  if (!oc) notFound()

  const lineas = oc.ordenes_compra_lineas ?? []
  const total = totalOrden(lineas.map((l) => ({ cantidad: l.cantidad_pedida, costoUnitario: l.costo_unitario })))
  const puedeRecibir = oc.estado === 'enviada' || oc.estado === 'recibida_parcial'

  return (
    <div>
      <Encabezado titulo={`Orden de compra N° ${oc.numero}`}>
        <div className="flex items-center gap-2">
          {oc.estado === 'borrador' && (
            <form action={marcarEnviada}><input type="hidden" name="id" value={oc.id} /><Boton type="submit">Marcar enviada</Boton></form>
          )}
          {(oc.estado === 'borrador' || oc.estado === 'enviada') && (
            <form action={cancelarOrden}><input type="hidden" name="id" value={oc.id} /><Boton variante="secundario" type="submit">Cancelar</Boton></form>
          )}
          {puedeRecibir && <Link href={`/compras/${oc.id}/recepcion`}><Boton>Registrar recepción</Boton></Link>}
        </div>
      </Encabezado>

      <div className="mb-4 flex items-center gap-3 text-sm text-slate-600">
        <Insignia tono={TONO_ESTADO[oc.estado] ?? 'gris'}>{ETIQUETA_ESTADO[oc.estado] ?? oc.estado}</Insignia>
        <span>Proveedor: <strong>{oc.proveedores?.razon_social ?? '—'}</strong></span>
        <span>Fecha: {new Date(oc.creado_en).toLocaleDateString('es-CL')}</span>
        {oc.notas && <span>Notas: {oc.notas}</span>}
      </div>

      <Tabla>
        <thead><tr><Th>Producto</Th><Th className="text-right">Pedido</Th><Th className="text-right">Recibido</Th><Th className="text-right">Pendiente</Th><Th className="text-right">Costo unitario</Th><Th className="text-right">Subtotal</Th></tr></thead>
        <tbody>
          {lineas.map((l) => (
            <Tr key={l.id}>
              <Td>{l.descripcion}</Td>
              <Td className="text-right font-mono">{l.cantidad_pedida}</Td>
              <Td className="text-right font-mono">{l.cantidad_recibida}</Td>
              <Td className="text-right font-mono">{pendienteLinea({ cantidadPedida: l.cantidad_pedida, cantidadRecibida: l.cantidad_recibida })}</Td>
              <Td className="text-right">{formatearCLP(l.costo_unitario)}</Td>
              <Td className="text-right">{formatearCLP(Math.round(l.cantidad_pedida * l.costo_unitario))}</Td>
            </Tr>
          ))}
        </tbody>
      </Tabla>
      <div className="mt-3 text-right text-lg">Total: <strong>{formatearCLP(total)}</strong></div>

      <div className="mt-6 max-w-2xl">
        <h2 className="mb-2 text-lg font-semibold text-slate-800">Recepciones</h2>
        <Tarjeta>
          <ul className="space-y-1 text-sm">
            {(oc.recepciones ?? []).map((r) => (
              <li key={r.id} className="flex justify-between">
                <span>{new Date(r.creado_en).toLocaleDateString('es-CL')} — {r.bodegas?.nombre ?? '—'}{r.notas ? ` · ${r.notas}` : ''}</span>
                <span className="font-mono">{(r.recepciones_lineas ?? []).reduce((s, l) => s + l.cantidad, 0)} unidades</span>
              </li>
            ))}
            {(oc.recepciones ?? []).length === 0 && <li className="text-slate-500">Sin recepciones todavía.</li>}
          </ul>
        </Tarjeta>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Verificar**

Run: `pnpm --filter erp build`
Expected: build sin errores. (El link a `/compras/[id]/recepcion` 404ea hasta Task 7 — transitorio esperado.)

- [ ] **Step 4: Commit**

```bash
git add apps/erp/app/compras
git commit -m "feat(erp): detalle de orden de compra con transiciones y recepciones"
```

---

### Task 7: ERP — registrar recepción

**Files:**
- Create: `apps/erp/app/compras/[id]/recepcion/page.tsx`, `apps/erp/componentes/formulario-recepcion.tsx`
- Modify: `apps/erp/app/compras/acciones.ts` (agregar `registrarRecepcion`)

**Interfaces:**
- Consumes: RPC `registrar_recepcion` (Task 2), `pendienteLinea` de `@suite/core`, página de detalle (Task 6) a la que redirige.
- Produces: Server Action `registrarRecepcion(prev, formData): Promise<EstadoForm>`.

- [ ] **Step 1: Server Action**

Agregar al final de `apps/erp/app/compras/acciones.ts`:

```ts
type LineaRecepcion = { ordenLineaId: string; cantidad: number }

export async function registrarRecepcion(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una empresa activa' }

  const orden = String(formData.get('orden_id') ?? '')
  const bodega = String(formData.get('bodega_id') ?? '')
  const notas = String(formData.get('notas') ?? '').trim()
  if (!orden || !bodega) return { error: 'Selecciona la bodega de destino' }

  let lineas: LineaRecepcion[]
  try {
    lineas = (JSON.parse(String(formData.get('lineas') ?? '[]')) as LineaRecepcion[]).filter((l) => l.cantidad > 0)
  } catch {
    return { error: 'Las cantidades de la recepción no son válidas' }
  }
  if (lineas.length === 0) return { error: 'Ingresa al menos una cantidad a recibir' }
  for (const l of lineas) {
    if (!l.ordenLineaId || !Number.isInteger(l.cantidad) || l.cantidad < 1) {
      return { error: 'Las cantidades deben ser enteros mayores a 0' }
    }
  }

  const supabase = await crearClienteServidor()
  const { error } = await supabase.rpc('registrar_recepcion', {
    p_empresa: activa.id,
    p_orden: orden,
    p_bodega: bodega,
    p_lineas: lineas.map((l) => ({ ordenLineaId: l.ordenLineaId, cantidad: l.cantidad })),
    p_notas: notas || null,
  })
  if (error) {
    if (error.message.includes('rol')) return { error: 'Tu rol no permite recibir mercadería' }
    if (error.message.includes('pendiente')) return { error: error.message }
    if (error.message.includes('estado')) return { error: 'La orden no está en un estado que permita recepción' }
    return { error: 'No se pudo registrar la recepción' }
  }
  revalidatePath('/compras')
  revalidatePath('/compras/' + orden)
  redirect('/compras/' + orden)
}
```

(Misma nota de tipos jsonb que Task 5 Step 2 si el generador exige `Json`.)

- [ ] **Step 2: Formulario (client)**

`apps/erp/componentes/formulario-recepcion.tsx`:

```tsx
'use client'

import { useActionState, useState } from 'react'
import { Boton, Campo, Entrada, Selector, Tabla, Tarjeta, Td, Th, Tr } from '@suite/ui'
import type { EstadoForm } from '../app/tipos'

interface BodegaOpcion { id: string; nombre: string }
interface LineaPendiente { id: string; descripcion: string; pendiente: number }

export function FormularioRecepcion({
  accion,
  ordenId,
  bodegas,
  lineas,
}: {
  accion: (prev: EstadoForm, formData: FormData) => Promise<EstadoForm>
  ordenId: string
  bodegas: BodegaOpcion[]
  lineas: LineaPendiente[]
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoForm)
  const [cantidades, setCantidades] = useState<Record<string, number>>(
    Object.fromEntries(lineas.map((l) => [l.id, l.pendiente]))
  )

  function cambiar(id: string, max: number, valor: number) {
    setCantidades((c) => ({ ...c, [id]: Math.min(max, Math.max(0, Math.trunc(valor) || 0)) }))
  }

  const payload = lineas.map((l) => ({ ordenLineaId: l.id, cantidad: cantidades[l.id] ?? 0 }))
  const totalARecibir = payload.reduce((s, l) => s + l.cantidad, 0)

  return (
    <form action={enviar}>
      <input type="hidden" name="orden_id" value={ordenId} />
      <input type="hidden" name="lineas" value={JSON.stringify(payload)} />
      <Tarjeta className="mb-4 max-w-2xl">
        <div className="flex flex-wrap items-end gap-3">
          <Campo etiqueta="Bodega de destino *">
            <Selector name="bodega_id" required defaultValue="">
              <option value="" disabled>Selecciona…</option>
              {bodegas.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
            </Selector>
          </Campo>
          <Campo etiqueta="Notas"><Entrada name="notas" placeholder="Ej: guía de despacho 1234" /></Campo>
        </div>
      </Tarjeta>

      <Tabla>
        <thead><tr><Th>Producto</Th><Th className="text-right">Pendiente</Th><Th className="text-right">Recibir ahora</Th></tr></thead>
        <tbody>
          {lineas.map((l) => (
            <Tr key={l.id}>
              <Td>{l.descripcion}</Td>
              <Td className="text-right font-mono">{l.pendiente}</Td>
              <Td className="text-right">
                <Entrada type="number" min={0} max={l.pendiente} value={cantidades[l.id] ?? 0}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => cambiar(l.id, l.pendiente, Number(e.currentTarget.value))}
                  className="w-24 text-right" />
              </Td>
            </Tr>
          ))}
        </tbody>
      </Tabla>

      <div className="mt-4 flex items-center justify-end gap-2">
        {estado.error && <span className="mr-auto text-sm text-red-600">{estado.error}</span>}
        <Boton type="submit" disabled={pendiente || totalARecibir === 0}>{pendiente ? 'Registrando…' : 'Registrar recepción'}</Boton>
      </div>
    </form>
  )
}
```

- [ ] **Step 3: Página**

`apps/erp/app/compras/[id]/recepcion/page.tsx`:

```tsx
import { notFound, redirect } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { pendienteLinea } from '@suite/core'
import { Encabezado } from '@suite/ui'
import { FormularioRecepcion } from '../../../../componentes/formulario-recepcion'
import { obtenerEmpresaActiva } from '../../../../lib/empresa-activa'
import { registrarRecepcion } from '../../acciones'

export default async function PaginaRecepcion({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin empresa activa" />
  const supabase = await crearClienteServidor()
  const [{ data: oc }, { data: bodegas }] = await Promise.all([
    supabase.from('ordenes_compra')
      .select('id, numero, estado, ordenes_compra_lineas (id, descripcion, cantidad_pedida, cantidad_recibida)')
      .eq('id', id).eq('empresa_id', activa.id).single(),
    supabase.from('bodegas').select('id, nombre').eq('empresa_id', activa.id).eq('activo', true).order('nombre'),
  ])
  if (!oc) notFound()
  if (oc.estado !== 'enviada' && oc.estado !== 'recibida_parcial') redirect('/compras/' + id)

  const lineas = (oc.ordenes_compra_lineas ?? [])
    .map((l) => ({ id: l.id, descripcion: l.descripcion, pendiente: pendienteLinea({ cantidadPedida: l.cantidad_pedida, cantidadRecibida: l.cantidad_recibida }) }))
    .filter((l) => l.pendiente > 0)

  return (
    <div>
      <Encabezado titulo={`Recepción — OC N° ${oc.numero}`} />
      <FormularioRecepcion
        accion={registrarRecepcion}
        ordenId={oc.id}
        bodegas={(bodegas ?? []).map((b) => ({ id: b.id, nombre: b.nombre }))}
        lineas={lineas}
      />
    </div>
  )
}
```

- [ ] **Step 4: Verificar**

Run: `pnpm --filter erp build`
Expected: build sin errores.

- [ ] **Step 5: Commit**

```bash
git add apps/erp/app/compras apps/erp/componentes/formulario-recepcion.tsx
git commit -m "feat(erp): recepción de mercadería con entrada automática de stock"
```

---

### Task 8: Hardening — `emision.ts` delega en la RPC serializada

**Files:**
- Modify: `apps/erp/lib/emision.ts` (SOLO el cuerpo de `registrarMovimientosDocumento`; firma intacta)

**Interfaces:**
- Consumes: RPC `registrar_movimientos_documento` (Task 2), `clienteAdmin` (ya importado).
- Produces: misma función exportada `registrarMovimientosDocumento(empresaId, documentoId, lineas, signo, motivo): Promise<void>` — los call sites en `apps/erp/app/ventas/emitir.ts` NO cambian.

- [ ] **Step 1: Reemplazar el cuerpo**

Reemplazar la implementación COMPLETA de `registrarMovimientosDocumento` en `apps/erp/lib/emision.ts` (dejando `credencialesEmpresa` y el resto del archivo intactos) por:

```ts
// Registra movimientos de stock para un documento emitido. signo = -1 descuenta (venta),
// signo = +1 restituye (nota de crédito). Delegado a la RPC registrar_movimientos_documento
// (solo service_role): advisory lock por documento — el check de idempotencia y los inserts
// corren serializados en la BD, cerrando el TOCTOU de reintentos simultáneos (review Plan 4).
// Nunca lanza — el stock se puede reconciliar con un ajuste.
export async function registrarMovimientosDocumento(
  empresaId: string,
  documentoId: string,
  lineas: { producto_id: string | null; cantidad: number }[],
  signo: 1 | -1,
  motivo: string
): Promise<void> {
  try {
    const admin = clienteAdmin()
    const { error } = await admin.rpc('registrar_movimientos_documento', {
      p_empresa: empresaId,
      p_documento: documentoId,
      p_lineas: lineas
        .filter((l): l is { producto_id: string; cantidad: number } => l.producto_id !== null)
        .map((l) => ({ productoId: l.producto_id, cantidad: l.cantidad })),
      p_signo: signo,
      p_motivo: motivo,
    })
    if (error) console.error('registrarMovimientosDocumento:', error.message)
  } catch (e) {
    console.error('registrarMovimientosDocumento:', e)
  }
}
```

(Misma nota de tipos jsonb que Task 5 Step 2 si el generador exige `Json` para `p_lineas`.)

- [ ] **Step 2: Verificar**

Run: `pnpm --filter erp build`
Expected: build sin errores. La idempotencia y la resolución/creación de "Bodega Principal" quedaron cubiertas por pgTAP assert 17 (Task 3); no se re-testean aquí.

- [ ] **Step 3: Commit**

```bash
git add apps/erp/lib/emision.ts
git commit -m "fix(erp): movimientos por documento vía RPC con advisory lock (cierra TOCTOU)"
```

---

### Task 9: Regenerar tipos + CI verde + verificación integral (E2E)

**Files:**
- Modify: `packages/db/src/types.ts` (solo si el gen produce diff)
- Ninguno de producción para la verificación (scripts en scratchpad, se borran al final).

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: evidencia de que el ciclo de compras funciona de punta a punta y de que el TOCTOU quedó cerrado.

- [ ] **Step 1: Pipeline**

Run: `pnpm --filter @suite/db gen` — commitear solo si hay diff (`chore(db): tipos regenerados`).
Run: `pnpm test` — Expected: `@suite/core` 51 (incl. compras), `@suite/auth` 2, `@suite/dte` 10, verdes.
Run: `pnpm supabase test db` — Expected: **61 asserts** verdes (6+19+10+10+7+9).
Run: `pnpm build --concurrency=1` — Expected: 3 apps compilan.

- [ ] **Step 2: E2E integral (script Node en scratchpad)**

Con Supabase local corriendo, un script que usando `@supabase/supabase-js` (resuelto con `createRequire` sobre `packages/auth/package.json`):

1. Crea usuario+org por el camino real (`registrar_organizacion`; RUT válido NO-fixture, p.ej. `771234569` — los fixtures pgTAP reservan `765432103`/`761111116`/`762222221`); siembra producto, proveedor y bodega.
2. Crea una OC vía `crear_orden_compra` (1 producto, cantidad 10, costo 1500) → asserts: numero = 1, estado `borrador`, descripción = nombre del producto.
3. Marca `enviada` (update directo como el usuario) → assert estado.
4. Recepción parcial de 4 vía `registrar_recepcion` → asserts: stock_actual = 4, movimiento `entrada` con `referencia_recepcion_id` y `proveedor_id`, motivo `Recepción OC N° 1`, OC `recibida_parcial`.
5. Sobre-recepción de 7 → assert: error `pendiente: 6`.
6. Recepción de 6 → asserts: stock = 10, OC `recibida_total`.
7. **Concurrencia (cierre del TOCTOU):** inserta un documento_venta `emitido` (admin) y dispara DOS `admin.rpc('registrar_movimientos_documento', …)` simultáneos (`Promise.all`) con las mismas líneas → assert: exactamente 1 fila de `salida` para esa `referencia_documento_id` (en Plan 4 este mismo experimento produjo 2).
8. Aislamiento: una segunda org no ve OCs/recepciones/stock de la primera.
9. Cleanup FK-safe (movimientos → recepciones_lineas → recepciones → ordenes_compra_lineas → ordenes_compra → documentos_venta_lineas → documentos_venta → bodegas/proveedores/productos/clientes → suscripciones/miembros/empresas/organizaciones → auth.users) y verificación de 0 filas. Borrar el script.

Si alguna aserción falla, es un defecto real → reportar BLOCKED con detalle.

- [ ] **Step 3: Reporte y commit**

Escribir el reporte a `.superpowers/sdd/task-9-plan5-report.md` con salidas del pipeline y del E2E (cada aserción), evidencia de limpieza y `git status` limpio. Commit solo si hubo cambios de tipos.

---

## Verificación final del plan

Al completar las 9 tasks:

- `pnpm test` — core (incl. compras), auth, dte verdes (51+2+10).
- `pnpm supabase test db` — 61 asserts pgTAP verdes.
- `pnpm build` — 3 apps compilan.
- Ciclo completo: crear OC numerada → enviar → recibir parcial (stock sube con costo y referencia en el ledger) → recibir el resto → `recibida_total` → cancelación bloqueada tras recibir → todo aislado por empresa.
- TOCTOU cerrado: dos registros simultáneos de movimientos para el mismo documento producen exactamente un set de filas.
- Criterio de éxito del Plan 5 (spec §11) cumplido.
