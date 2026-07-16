# Plan 14: Pago de suscripciones del SaaS (MercadoPago + Webpay Plus) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Autoservicio de pago de suscripción: el dueño paga 1 mes con MercadoPago o Webpay Plus desde `/configuracion/suscripcion` y la organización se extiende y activa sola — dinero ORGANIZACIÓN→PLATAFORMA con credenciales de plataforma en env, doble vía de confirmación y cero dinero invisible.

**Architecture:** Migración 0019 (`pagos_suscripcion` + `unique(organizacion_id)` en suscripciones + 3 RPCs: crear authenticated dueno/admin de la ORG, confirmar/abortar service_role); `packages/pagos` gana módulo Webpay (WebpayPlus REST v1.2 + MockWebpay), referencia de suscripción propia, selectores FAIL-CLOSED y `notificationUrl` opcional en crearPreferencia; rutas en apps/erp: webhook plataforma MP + retorno-mp (lookup) + retorno Webpay (commit) + simulador mock; UI: página de suscripción + tarjeta + columna admin.

**Tech Stack:** Postgres 17 (RLS, pgTAP), Next.js 15 (Server Actions + route handlers), Vitest (TDD), Transbank Webpay Plus REST v1.2, MP Checkout Pro.

**Spec:** `docs/superpowers/specs/2026-07-16-plan14-suscripciones-pago-design.md` (2 lentes opus aplicados; §3 schema/RPCs/mensajes, §4 pasarelas, §5 flujos y §8 tests son CONTRATO).

## Global Constraints

- Nivel ORGANIZACIÓN, no empresa: rol vía `app.tiene_rol(org, array['dueno','admin'])` (0001 — NO `tiene_rol_en_empresa`); RLS de `pagos_suscripcion` por esa misma función; CERO escritura directa authenticated (sin policies/grants de escritura); `grant select` a authenticated + service_role completo; GRANTs explícitos obligatorios.
- Dinero de PLATAFORMA: credenciales SOLO env server-side (`MP_PLATAFORMA_ACCESS_TOKEN`, `MP_PLATAFORMA_WEBHOOK_SECRET`, `TBK_COMMERCE_CODE`, `TBK_API_KEY`, `TBK_AMBIENTE`, `PASARELA_SUSCRIPCIONES=mock|real`); JAMÁS en BD, cliente ni logs (adapters loguean solo `error.message`).
- Selectores FAIL-CLOSED (`pasarelaSuscripciones`, `webpaySuscripciones` en packages/pagos): `'mock'`→mocks, `'real'`→reales, otro/ausente → THROW. JAMÁS default a mock. NO se reusa `pasarelaPorAmbiente` (su `?? 'mock'` fallaría abierto). La action valida env ANTES de la RPC (sin filas `pendiente` huérfanas).
- Monto SIEMPRE de BD: `crear_pago_suscripcion` copia `planes.precio_clp` bajo lock y genera `buy_order` DENTRO (`substr(replace(gen_random_uuid()::text,'-',''),1,25)`); retorna jsonb `{id, buy_order}`. `confirmar_pago_suscripcion(p_pago, p_referencia, p_monto) returns text` `'extendido'|'revision'|'noop'`: idempotente dentro del lock + backstop 23505→`'noop'`; procede desde `pendiente` Y `abortado` (plata gana sobre anulación de UI); `p_monto <> monto` → `'revision'` con referencia guardada SIN extender (handler emite `console.error('ALERTA ...')`); feliz: `pagado` + lock org + `update suscripciones set hasta = (greatest(current_date, coalesce(hasta, o.trial_hasta, current_date)) + interval '1 month')::date` (0 filas → raise) + org `'activa'`. `abortar_pago_suscripcion`: `where id = ... and estado = 'pendiente'` (jamás degrada pagado/revision; 0 filas = no-op).
- Migración 0019 incluye `alter table suscripciones add constraint suscripciones_organizacion_unica unique (organizacion_id)`. Índice único parcial `(pasarela, referencia_externa) where referencia_externa is not null` en pagos_suscripcion. Estados: `pendiente|pagado|abortado|revision`; pasarelas: `mercadopago|webpay`; `buy_order text not null unique` ≤26 alfanumérico.
- Mensajes contractuales EXACTOS (5): `'Tu rol no permite pagar la suscripción'`, `'La organización no tiene un plan asignado'`, `'El plan actual no requiere pago'`, `'Método de pago no soportado'`, `'El pago no existe'`. + 1 de action: `'Los pagos de suscripción no están disponibles todavía'`.
- Webpay Plus REST v1.2: base integración `https://webpay3gint.transbank.cl` / producción `https://webpay3g.transbank.cl`; `POST /rswebpaytransaction/api/webpay/v1.2/transactions` (crear: buy_order, session_id, amount, return_url) y `PUT .../transactions/{token}` (commit); headers `Tbk-Api-Key-Id`/`Tbk-Api-Key-Secret`; `autorizado = response_code === 0 && status === 'AUTHORIZED'`; envío por FORMULARIO AUTO-POST con `token_ws` oculto (no query); re-commit lanza → el retorno redirige SIN banner (la BD manda). INVARIANTE: jamás commitear un token fuera del retorno síncrono.
- Retorno Webpay `/api/pagos-suscripcion/retorno` (GET|POST, lee formData Y query: token_ws/TBK_TOKEN/TBK_ORDEN_COMPRA); retorno MP `/api/pagos-suscripcion/retorno-mp` (lookup `obtenerPago(payment_id)` server-side — segunda vía; la query jamás es fuente de verdad); webhook `/api/webhooks/suscripciones/mercadopago` (orden §5: env→firma con headers PLANOS via .get()→obtenerPago→approved→parsearReferenciaSuscripcion→buy_order BD==referencia→RPC; mapeo 200/500 enumerado). MIDDLEWARE: añadir `api/pagos-suscripcion` al negative-lookahead del matcher (`api/webhooks` ya está; `mock-pago-suscripcion` queda cubierto por el prefijo `mock-pago` existente — VERIFICAR contra el regex real).
- Referencia suscripción: `armarReferenciaSuscripcion({pagoId, buyOrder})` → `'suscripcion:{pagoId}:{buyOrder}'`; parseo estricto 3 segmentos → null. NO tocar `armarReferencia`/`parsearReferencia` del Plan 13. `crearPreferencia` gana `notificationUrl?: string` OPCIONAL (aditivo: llamadores del Plan 13 intactos).
- Simulador `/mock-pago-suscripcion/[id]`: gate estricto `PASARELA_SUSCRIPCIONES === 'mock'` (si no notFound); aprueba MP (store mock + POST al webhook con CABECERA_FIRMA_MOCK) o Webpay (redirect al retorno con token_ws mock). MockWebpay: store módulo respaldado en globalThis (lección Plan 13 next dev).
- UI español; queries org-scoped; page `/configuracion/suscripcion` guard dueno/admin; admin: embed `suscripciones (hasta)` devuelve ARRAY → `[0]`.
- Conteos finales EXACTOS: pgTAP **269** (242 + 27, `plan(27)`), unit **163** (core 126 + auth 2 + dte 10 + **pagos 25** = 14 actuales + 11 nuevos: webpay 6, referencia-suscripción 3, selectores fail-closed 2), 3 apps build.
- CERO BOM literal (secuencia de escape; byte-scan `grep -c` exit 1 = pass); UTF-8 sin BOM; Windows/PowerShell 5.1 (`&&` no encadena; PATH refresh en shells nuevas).

---

### Task 1: Migración `supabase/migrations/00000000000019_suscripciones_pago.sql`

**Files:**
- Create: `supabase/migrations/00000000000019_suscripciones_pago.sql`

**Interfaces:**
- Consumes: `organizaciones` (0001 — `plan_id`, `estado`, `trial_hasta`; tabla de PLATAFORMA sin `empresa_id`, así que las FK son SIMPLES: `references public.organizaciones (id)`), `planes` (0001 — `precio_clp`/`activo`, leídos bajo el lock de la org; nunca del cliente), `suscripciones` (0001 — blanco del constraint nuevo y del `update` de `confirmar`), `app.tiene_rol(org uuid, roles text[])` (0001 — rol dueño/admin de la ORG, NO `tiene_rol_en_empresa`).
- Produces: tabla `pagos_suscripcion` (RLS: `select` dueño/admin vía `app.tiene_rol` + `grant select` a authenticated; CERO escritura directa — ni policy ni grant de insert/update/delete; service_role completo) + índice único parcial `pagos_suscripcion_referencia_idx` (idempotencia backstop); constraint `suscripciones_organizacion_unica unique (organizacion_id)` sobre la tabla existente; 3 RPCs — `crear_pago_suscripcion` (authenticated, rol dueño/admin), `confirmar_pago_suscripcion` y `abortar_pago_suscripcion` (SOLO service_role; candado pgTAP 42501). Migración COMPLETA (sin marca de Task siguiente — las 3 RPCs viven en este mismo archivo).
- ESPEJOS leídos antes de escribir: `0001` (tablas de plataforma con FK simple; `app.tiene_rol`; policy `duenos ven suscripciones`; grants Data API — service_role NO hereda las tablas nuevas del `grant ... on all tables` de 0001, se re-otorga explícito), `0018` (patrón tabla CERO-escritura-directa con policy de solo-select + `grant select` authenticated + service_role completo; `revoke ... from anon, public` y luego `grant ... to service_role`; idempotencia DENTRO del lock con backstop 23505; check inline de estados), `0002` (`registrar_organizacion` inserta EXACTAMENTE una `suscripciones` por org — sustento del constraint unique). Convención del schema: comentarios SQL en ASCII (sin tildes); mensajes de usuario con tildes correctas.
- Mensajes byte-exactos (contrato pgTAP, spec §3 — los 5): `'Tu rol no permite pagar la suscripción'`, `'La organización no tiene un plan asignado'`, `'El plan actual no requiere pago'`, `'Método de pago no soportado'`, `'El pago no existe'`. (`'La suscripción de la organización no existe'` NO es contractual: guarda el invariante que el `unique (organizacion_id)` ya garantiza — inalcanzable en operación normal.)

- [ ] **Step 1: Escribir la migración**

`supabase/migrations/00000000000019_suscripciones_pago.sql`:

```sql
-- Suscripciones de pago (Plan 14): pago autoservicio de la suscripcion del SaaS
-- por la ORGANIZACION (dinero organizacion -> plataforma, credenciales en env del
-- servidor). Tabla pagos_suscripcion (CERO escritura directa: dueno/admin solo
-- leen; service_role escribe via RPC), el constraint unique(organizacion_id) sobre
-- suscripciones que vuelve GARANTIA el invariante 1-fila-por-org, y 3 RPCs: crear
-- (authenticated dueno/admin de la org), confirmar y abortar (SOLO service_role: el
-- webhook y los retornos corren con el admin client).
--
-- Regla de oro del plan: ningun peso cobrado por la pasarela queda sin acreditar.
-- confirmar_pago_suscripcion es idempotente bajo lock y confirma DESDE pendiente Y
-- DESDE abortado (plata real gana sobre una anulacion de UI); monto discrepante ->
-- 'revision' (dinero registrado, jamas invisible) sin extender. Tablas de
-- PLATAFORMA (organizaciones/planes) sin empresa_id: las FK son SIMPLES.

-- ---------- suscripciones: una fila por organizacion ----------
-- registrar_organizacion (0002) inserta exactamente una y nada mas escribe la
-- tabla; el constraint vuelve garantia el invariante que el update de
-- confirmar_pago_suscripcion asume (extender toca EXACTAMENTE una fila).
alter table public.suscripciones
  add constraint suscripciones_organizacion_unica unique (organizacion_id);

-- ---------- pagos_suscripcion (un pago por periodo; sin recurrencia) ----------
-- monto se COPIA de planes.precio_clp al crear (jamas del cliente). buy_order:
-- <=26 chars alfanumerico (limite Webpay), no enumerable, generado DENTRO de
-- crear_pago_suscripcion; viaja como buy_order (Webpay) y en el external_reference
-- (MP). referencia_externa: mp_payment_id o token Webpay, null hasta confirmar.
create table public.pagos_suscripcion (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id),
  plan_id uuid not null references public.planes (id),
  monto integer not null check (monto > 0),
  pasarela text not null check (pasarela in ('mercadopago', 'webpay')),
  buy_order text not null unique,
  referencia_externa text,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'pagado', 'abortado', 'revision')),
  pagado_en timestamptz,
  creado_en timestamptz not null default now()
);

-- Idempotencia backstop: un mismo pago externo (pasarela, referencia) acredita a lo
-- mas una fila. Parcial: los pendientes (referencia null) no compiten por el slot.
create unique index pagos_suscripcion_referencia_idx
  on public.pagos_suscripcion (pasarela, referencia_externa)
  where referencia_externa is not null;

-- ---------- RLS ----------
alter table public.pagos_suscripcion enable row level security;

-- Solo dueno/admin de la ORG leen su historial; CERO escritura directa (ni policy
-- ni grant de insert/update/delete para authenticated) -- todo entra por RPC
-- service_role, patron links_pago/anticipos de 0018.
create policy "duenos ven pagos de suscripcion" on public.pagos_suscripcion
  for select to authenticated
  using (app.tiene_rol(organizacion_id, array['dueno', 'admin']));

-- ---------- Grants Data API (leccion 0001) ----------
-- El grant "on all tables" de 0001 solo cubrio las tablas de entonces; una tabla
-- nueva necesita su grant a service_role explicito.
grant select on public.pagos_suscripcion to authenticated;
grant select, insert, update, delete on public.pagos_suscripcion to service_role;

-- ---------- Crear pago (authenticated; rol dueno/admin de la ORG) ----------
-- Valida rol -> lockea la org -> lee plan y precio en BD -> genera buy_order no
-- enumerable DENTRO de la RPC (la no-enumerabilidad es invariante estructural, no
-- cortesia del llamador) -> inserta pendiente con monto = precio_clp. Retorna
-- {id, buy_order} para que la action arme la preferencia/transaccion.
create or replace function public.crear_pago_suscripcion(p_organizacion uuid, p_pasarela text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_plan uuid;
  v_precio integer;
  v_buy_order text;
  v_id uuid;
begin
  if not app.tiene_rol(p_organizacion, array['dueno', 'admin']) then
    raise exception 'Tu rol no permite pagar la suscripción';
  end if;

  -- Lock de la organizacion: el plan/precio se leen bajo el, no del cliente.
  select plan_id into v_plan
  from organizaciones where id = p_organizacion
  for update;

  -- Plan null o inactivo -> mismo mensaje; precio 0 -> no se cobra.
  select precio_clp into v_precio
  from planes where id = v_plan and activo;
  if v_plan is null or v_precio is null then
    raise exception 'La organización no tiene un plan asignado';
  end if;
  if v_precio = 0 then
    raise exception 'El plan actual no requiere pago';
  end if;

  if p_pasarela not in ('mercadopago', 'webpay') then
    raise exception 'Método de pago no soportado';
  end if;

  -- buy_order: 25 hex de un uuid sin guiones (<=26, no enumerable, unico).
  v_buy_order := substr(replace(gen_random_uuid()::text, '-', ''), 1, 25);
  insert into pagos_suscripcion (organizacion_id, plan_id, monto, pasarela, buy_order)
  values (p_organizacion, v_plan, v_precio, p_pasarela, v_buy_order)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'buy_order', v_buy_order);
end $$;
revoke execute on function public.crear_pago_suscripcion(uuid, text) from anon, public;
grant execute on function public.crear_pago_suscripcion(uuid, text) to authenticated;

-- ---------- Confirmar pago (SOLO service_role; idempotente; doble via) ----------
-- Webhook y retorno pueden llegar en cualquier orden y repetirse: idempotente bajo
-- el lock del pago. Confirma DESDE pendiente Y DESDE abortado (plata real gana sobre
-- una anulacion de UI). monto discrepante -> 'revision' (dinero registrado, jamas
-- invisible) SIN extender. Feliz: pagado + extiende un mes DESDE el mayor entre hoy,
-- el hasta actual y el fin de trial (no se pierden dias gratis) + org 'activa'.
create or replace function public.confirmar_pago_suscripcion(p_pago uuid, p_referencia text, p_monto integer)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  v_estado text;
  v_monto integer;
  v_org uuid;
  v_trial date;
begin
  -- Lock del pago: dos confirmaciones del mismo pago se serializan aqui.
  select estado, monto, organizacion_id into v_estado, v_monto, v_org
  from pagos_suscripcion where id = p_pago
  for update;
  if not found then
    raise exception 'El pago no existe';
  end if;

  -- Idempotencia primaria dentro del lock.
  if v_estado = 'pagado' then
    return 'noop';
  end if;

  -- Manipulacion (la preferencia/transaccion se crea con el monto de BD): registra
  -- el dinero en 'revision' y NO extiende; el handler emite console.error ALERTA.
  if p_monto <> v_monto then
    -- Backstop 23505 tambien en esta rama: una referencia ya usada llegando con un monto
    -- distinto JAMAS debe volverse 500/retry-loop; se resuelve idempotente 'noop' (misma red
    -- del camino feliz). Edge inalcanzable en operacion normal, pero cerrado por si acaso.
    begin
      update pagos_suscripcion
      set estado = 'revision', referencia_externa = p_referencia
      where id = p_pago;
    exception when unique_violation then
      return 'noop';
    end;
    return 'revision';
  end if;

  -- Marca pagado; backstop 23505 del indice unico parcial -> noop (otra via ya
  -- acredito con la misma referencia).
  begin
    update pagos_suscripcion
    set estado = 'pagado', referencia_externa = p_referencia, pagado_en = now()
    where id = p_pago;
  exception when unique_violation then
    return 'noop';
  end;

  -- Lock de la organizacion y su trial_hasta bajo ese lock (join implicito).
  select trial_hasta into v_trial
  from organizaciones where id = v_org
  for update;

  -- Extiende un mes desde el mayor entre hoy, el hasta actual y el fin de trial.
  update suscripciones
  set hasta = (greatest(current_date, coalesce(hasta, v_trial, current_date)) + interval '1 month')::date
  where organizacion_id = v_org;
  if not found then
    raise exception 'La suscripción de la organización no existe';
  end if;

  update organizaciones set estado = 'activa' where id = v_org;
  return 'extendido';
end $$;
revoke execute on function public.confirmar_pago_suscripcion(uuid, text, integer) from anon, public, authenticated;
grant execute on function public.confirmar_pago_suscripcion(uuid, text, integer) to service_role;

-- ---------- Abortar pago (SOLO service_role) ----------
-- Retorno Webpay con TBK_TOKEN = usuario anulo. Solo degrada un pendiente;
-- pagado/revision intactos (jamas degradar dinero confirmado). 0 filas = no-op.
create or replace function public.abortar_pago_suscripcion(p_pago uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  update pagos_suscripcion set estado = 'abortado'
  where id = p_pago and estado = 'pendiente';
end $$;
revoke execute on function public.abortar_pago_suscripcion(uuid) from anon, public, authenticated;
grant execute on function public.abortar_pago_suscripcion(uuid) to service_role;
```

- [ ] **Step 2: Aplicar y verificar**

Run: `pnpm supabase db reset` → aplica **0001-0019** (19 migraciones) sin errores.
Run: `pnpm supabase test db` → **13 archivos, 242 asserts** existentes siguen verdes (esta migración es puramente aditiva: tabla + constraint + 3 RPCs nuevas, no toca nada previo). El archivo `suscripciones_pago.test.sql` lo escribe una task posterior — aún no existe.

Matriz de privilegios de las 3 RPCs (doble vía: crear = authenticated, confirmar/abortar = solo service_role):

```
docker exec supabase_db_ERP_Transportes psql -U postgres -d postgres -c "select has_function_privilege('authenticated','public.crear_pago_suscripcion(uuid,text)','execute') as crear_auth, has_function_privilege('anon','public.crear_pago_suscripcion(uuid,text)','execute') as crear_anon, has_function_privilege('service_role','public.confirmar_pago_suscripcion(uuid,text,integer)','execute') as conf_sr, has_function_privilege('authenticated','public.confirmar_pago_suscripcion(uuid,text,integer)','execute') as conf_auth, has_function_privilege('service_role','public.abortar_pago_suscripcion(uuid)','execute') as abort_sr, has_function_privilege('authenticated','public.abortar_pago_suscripcion(uuid)','execute') as abort_auth;"
```

→ `crear_auth = t`, `crear_anon = f`, `conf_sr = t`, `conf_auth = f` (candado 42501), `abort_sr = t`, `abort_auth = f`.

Constraint unique presente sobre suscripciones:

```
docker exec supabase_db_ERP_Transportes psql -U postgres -d postgres -c "select conname, pg_get_constraintdef(oid) as def from pg_constraint where conname = 'suscripciones_organizacion_unica';"
```

→ una fila: `def = UNIQUE (organizacion_id)`.

Flujo feliz + idempotencia (crear→confirmar→`hasta` extendido→org `activa`, con ROLLBACK — no ensucia la BD):

```
docker exec -i supabase_db_ERP_Transportes psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
begin;
insert into organizaciones (rut, razon_social, plan_id, estado, trial_hasta)
select '55555555K', 'Smoke SpA', id, 'trial', current_date + 5 from planes where nombre = 'Básico';
insert into suscripciones (organizacion_id, plan_id)
select id, plan_id from organizaciones where rut = '55555555K';
insert into pagos_suscripcion (organizacion_id, plan_id, monto, pasarela, buy_order)
select o.id, o.plan_id, pl.precio_clp, 'webpay', 'smokebuyorder00000000001'
from organizaciones o join planes pl on pl.id = o.plan_id where o.rut = '55555555K';
select confirmar_pago_suscripcion(
  (select id from pagos_suscripcion where buy_order = 'smokebuyorder00000000001'),
  'tbk:smoke',
  (select monto from pagos_suscripcion where buy_order = 'smokebuyorder00000000001')) as resultado;
select confirmar_pago_suscripcion(
  (select id from pagos_suscripcion where buy_order = 'smokebuyorder00000000001'),
  'tbk:smoke',
  (select monto from pagos_suscripcion where buy_order = 'smokebuyorder00000000001')) as resultado_idem;
select o.estado, s.hasta, (current_date + 5 + interval '1 month')::date = s.hasta as hasta_ok
from organizaciones o join suscripciones s on s.organizacion_id = o.id where o.rut = '55555555K';
rollback;
SQL
```

→ `resultado = extendido`; `resultado_idem = noop`; última fila `estado = activa`, `hasta_ok = t` (extiende desde el fin de trial `current_date + 5`, no desde hoy).

Byte-scan del archivo (JAMÁS BOM U+FEFF):

```
grep -c $'\xEF\xBB\xBF' supabase/migrations/00000000000019_suscripciones_pago.sql
```

→ imprime `0` y sale con status 1 (sin coincidencias = pass).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/00000000000019_suscripciones_pago.sql
git commit -m "feat(db): pago de suscripciones — tabla, constraint y RPCs con doble vía"
```

---

### Task 2: pgTAP de pago de suscripciones

**Files:**
- Create: `supabase/tests/database/suscripciones_pago.test.sql`

**Interfaces:**
- Consumes: migración 0019 (Task 1: tabla `pagos_suscripcion` con RLS de solo lectura para dueño/admin + `grant select` a authenticated + CERO escritura directa; constraint `suscripciones_organizacion_unica unique (organizacion_id)`; RPCs `crear_pago_suscripcion` authenticated dueño/admin, `confirmar_pago_suscripcion` / `abortar_pago_suscripcion` SOLO service_role); `registrar_organizacion` (0002 — el CAMINO REAL que crea organización + empresa homónima + membresía dueño + fila `suscripciones` con `hasta` nulo, y deja la org en `trial` con `trial_hasta = current_date + 14`); tablas `planes`/`organizaciones`/`suscripciones` y `app.tiene_rol` (0001).
- RUTs NUEVOS reservados para este archivo (válidos módulo 11; verificados ÚNICOS GLOBALES con grep contra TODOS los `*.test.sql`, `scripts/seed-demo.mjs` y el código de apps — no colisionan con `761111116/761112228/761212125/761234560/762222221/762223333/763333337/763334449/763434346/764444442/764646460/765432103/765432104/765555558/766666663/767777779/768888884/769111115/769222227/769333339/769444440/769555552`, el seed `771234569`/`778899000` ni los E2E `999999999/888888888/666666666/765000017`): `777000012` (Org A, feliz + candados), `777000020` (Org C, extensión con `hasta` futuro), `777000039` (Org SP, sin plan), `777000047` (Org P0, plan precio 0), `777000055` (Org IDEM, revisión sin extender), `777000063` (Org X, abortado→confirmado gana), `777000071` (Org B, aislamiento cross-org).
- Rol de las RPCs y candados (contrato spec §3): `crear_pago_suscripcion` es authenticated con rol `app.tiene_rol(org, array['dueno','admin'])` — un vendedor de la MISMA org y un dueño de OTRA org reciben el mismo mensaje de rol. `confirmar_pago_suscripcion` y `abortar_pago_suscripcion` son SOLO service_role (revoke anon/public/authenticated + grant service_role): security definer SIN guardia de rol interna, el grant ES el candado (42501 desde authenticated). La escritura directa en `pagos_suscripcion` está cerrada para authenticated (solo `grant select`).
- Mensajes byte-exactos (contrato spec §3, los 5): `'Tu rol no permite pagar la suscripción'`, `'La organización no tiene un plan asignado'`, `'El plan actual no requiere pago'`, `'Método de pago no soportado'`, `'El pago no existe'`.
- Presupuesto EXACTO de `plan(27)` — mapeo del contrato (spec §8 / part-0), contado A MANO. Fechas del flujo con `current_date`: la suite corre en una sola transacción, así que `current_date` es estable y los goldens de `hasta` se calculan con la MISMA expresión de la RPC (`greatest(...) + interval '1 month'`), nunca una fecha literal — inmune al calendario. Los orígenes REALES (orgs/suscripciones/miembros) nacen por `registrar_organizacion`; los `pagos_suscripcion` de los casos de confirmar/abortar se siembran directo como superusuario con ids fijos (patrón cobranza/mercadopago: el superusuario salta grants/RLS), y las validaciones de `crear_pago_suscripcion` se ejercitan con la RPC real. Reparto (7 crear / 9 confirmar / 2 abortar / 7 candados / 2 extensión):
  1. `crear` feliz retorna un `id` (dueño, mercadopago)
  2. `crear` feliz retorna `buy_order` de 25 caracteres alfanuméricos (dueño, webpay; `^[0-9a-f]{25}$`)
  3. `crear` vendedor de la org → `'Tu rol no permite pagar la suscripción'`
  4. `crear` dueño de OTRA org → `'Tu rol no permite pagar la suscripción'`
  5. `crear` org sin plan (`plan_id` nulo) → `'La organización no tiene un plan asignado'`
  6. `crear` plan precio 0 → `'El plan actual no requiere pago'`
  7. `crear` pasarela inválida → `'Método de pago no soportado'`
  8. `confirmar` feliz retorna `'extendido'`
  9. `confirmar` idempotente: segundo confirmar del mismo pago → `'noop'`
  10. `confirmar` monto ≠ pago → `'revision'`
  11. `abortar` degrada un `pendiente` a `'abortado'`
  12. `confirmar` sobre un `abortado` gana: retorna `'extendido'` (plata real sobre anulación de UI)
  13. `abortar` NO degrada un `pagado` (queda `'pagado'`)
  14. `confirmar` de un pago inexistente lanza `'El pago no existe'`
  15. `confirmar` feliz: `suscripciones.hasta` extendido un mes desde `trial_hasta`
  16. `confirmar` feliz: la org queda `'activa'`
  17. extensión desde trial: `hasta` NO colapsa a `current_date + 1 mes` (usó `trial_hasta` vía coalesce)
  18. extensión con `hasta` futuro: `greatest` extiende desde `hasta`, no desde hoy
  19. revisión NO extendió: la org de la revisión sigue sin `hasta` y en `trial`
  20. candado: authenticated NO ejecuta `confirmar_pago_suscripcion` → 42501
  21. candado: authenticated NO ejecuta `abortar_pago_suscripcion` → 42501
  22. candado: insert directo en `pagos_suscripcion` (authenticated) → 42501
  23. candado: update directo en `pagos_suscripcion` (authenticated) → 42501
  24. candado RLS cross-org: un dueño de otra org ve 0 pagos ajenos
  25. candado: anónimo denegado de plano → 42501
  26. backstop 23505: un SEGUNDO pago `pendiente` distinto confirmado con la MISMA `(pasarela, referencia_externa)` de uno ya `pagado` → `'noop'` Y el segundo pago sigue `pendiente` (jamás doble acreditación; segundo pago intacto)
  27. candado RLS mismo-org: un VENDEDOR de la misma org ve 0 pagos (select solo dueño/admin)
- Secuencia de roles (bug conocido: `reset role` vuelve al rol de sesión superusuario, NO a authenticated): este archivo JAMÁS usa `reset role`; cada frontera de fase re-declara EXPLÍCITAMENTE `set local role ...` y, para authenticated, también `set local request.jwt.claims`. Las lecturas de estado del bloque confirmar/abortar corren bajo `service_role` (que tiene `BYPASSRLS = t`, verificado contra la BD) para no depender de la sesión de un dueño.

- [ ] **Step 1: Escribir el test**

`supabase/tests/database/suscripciones_pago.test.sql`:

```sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'ana@s.cl'),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'beto@s.cl'),
  ('00000000-0000-0000-0000-000000000000', '77777777-7777-7777-7777-777777777777', 'authenticated', 'authenticated', 'vero@s.cl');

-- Plan gratis (precio 0) para el caso "El plan actual no requiere pago". El seed de
-- 0001 solo trae Básico/Pro/Empresa (todos > 0); este es el único precio 0 de la suite.
insert into public.planes (id, nombre, precio_clp)
values ('00000000-0000-0000-0000-0000000000f0', 'Gratis', 0);

-- ===== Orgs por el CAMINO REAL (registrar_organizacion): cada una nace con plan
--       Básico (29990 > 0), estado 'trial', trial_hasta = current_date + 14 y una
--       fila suscripciones con hasta nulo. Ana es dueña de A/C/SP/P0/IDEM/X. =====
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select registrar_organizacion('777000012', 'Org A');      -- feliz + candados
select registrar_organizacion('777000020', 'Org C');      -- extensión con hasta futuro
select registrar_organizacion('777000039', 'Org SP');     -- se le quita el plan
select registrar_organizacion('777000047', 'Org P0');     -- se le pone el plan gratis
select registrar_organizacion('777000055', 'Org IDEM');   -- revisión sin extender
select registrar_organizacion('777000063', 'Org X');      -- abortado -> confirmado

-- Beto: dueño de B (otra org, para rol cross-org y aislamiento RLS).
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
select registrar_organizacion('777000071', 'Org B');

-- ===== Ajustes de fixtures (superusuario: salta grants/RLS) =====
set local role postgres;

-- Vero, vendedora de A (rol sin permiso de pago).
insert into public.miembros (usuario_id, organizacion_id, rol)
values ('77777777-7777-7777-7777-777777777777',
        (select id from organizaciones where rut = '777000012'), 'vendedor');

-- Org C: ya activa y pagada hasta una fecha FUTURA (para probar greatest).
update public.suscripciones set hasta = current_date + 90
  where organizacion_id = (select id from organizaciones where rut = '777000020');
update public.organizaciones set estado = 'activa' where rut = '777000020';

-- Org SP: sin plan asignado. Org P0: plan precio 0.
update public.organizaciones set plan_id = null where rut = '777000039';
update public.organizaciones set plan_id = '00000000-0000-0000-0000-0000000000f0' where rut = '777000047';

-- Pagos sembrados (ids fijos) para confirmar/abortar. monto = precio Básico (29990);
-- confirmar compara p_monto contra ESTE monto, no contra el plan.
insert into public.pagos_suscripcion (id, organizacion_id, plan_id, monto, pasarela, buy_order, estado)
values
  ('a0000001-0000-0000-0000-000000000001', (select id from organizaciones where rut = '777000012'),
   (select id from planes where nombre = 'Básico'), 29990, 'mercadopago', 'bopa', 'pendiente'),
  ('a0000002-0000-0000-0000-000000000002', (select id from organizaciones where rut = '777000020'),
   (select id from planes where nombre = 'Básico'), 29990, 'mercadopago', 'bopc', 'pendiente'),
  ('a0000003-0000-0000-0000-000000000003', (select id from organizaciones where rut = '777000055'),
   (select id from planes where nombre = 'Básico'), 29990, 'mercadopago', 'bopr', 'pendiente'),
  ('a0000004-0000-0000-0000-000000000004', (select id from organizaciones where rut = '777000063'),
   (select id from planes where nombre = 'Básico'), 29990, 'mercadopago', 'bopx', 'pendiente'),
  -- Backstop 23505 (assert 26): un segundo pendiente mercadopago de A; se confirma con la
  -- MISMA referencia 'mp:pa' que PA ya acredito -> colision en el indice unico parcial.
  ('a0000005-0000-0000-0000-000000000005', (select id from organizaciones where rut = '777000012'),
   (select id from planes where nombre = 'Básico'), 29990, 'mercadopago', 'bopb', 'pendiente');

-- ===== crear_pago_suscripcion (authenticated; rol dueño/admin) =====
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- 1) Feliz: retorna un id de pago.
select ok(
  (crear_pago_suscripcion((select id from organizaciones where rut = '777000012'), 'mercadopago') ->> 'id') is not null,
  'crear_pago_suscripcion feliz retorna un id de pago'
);

-- 2) Feliz: el buy_order es de 25 caracteres alfanuméricos (hex de gen_random_uuid).
select ok(
  (crear_pago_suscripcion((select id from organizaciones where rut = '777000012'), 'webpay') ->> 'buy_order') ~ '^[0-9a-f]{25}$',
  'el buy_order es de 25 caracteres alfanuméricos'
);

-- 5) Org sin plan (plan_id nulo).
select throws_ok(
  $$select crear_pago_suscripcion((select id from organizaciones where rut = '777000039'), 'mercadopago')$$,
  'P0001', 'La organización no tiene un plan asignado',
  'una org sin plan no puede pagar'
);

-- 6) Plan precio 0.
select throws_ok(
  $$select crear_pago_suscripcion((select id from organizaciones where rut = '777000047'), 'mercadopago')$$,
  'P0001', 'El plan actual no requiere pago',
  'un plan de precio 0 no ofrece pago'
);

-- 7) Pasarela inválida (rol y plan OK, pasarela no soportada).
select throws_ok(
  $$select crear_pago_suscripcion((select id from organizaciones where rut = '777000012'), 'paypal')$$,
  'P0001', 'Método de pago no soportado',
  'una pasarela desconocida es rechazada'
);

-- 3) Vendedora de la MISMA org: sin permiso de pago.
set local request.jwt.claims to '{"sub": "77777777-7777-7777-7777-777777777777", "role": "authenticated"}';
select throws_ok(
  $$select crear_pago_suscripcion((select id from organizaciones where rut = '777000012'), 'mercadopago')$$,
  'P0001', 'Tu rol no permite pagar la suscripción',
  'un vendedor no puede pagar la suscripción'
);

-- 4) Dueño de OTRA org (Beto no es miembro de A): mismo mensaje de rol.
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
select throws_ok(
  $$select crear_pago_suscripcion((select id from organizaciones where rut = '777000012'), 'mercadopago')$$,
  'P0001', 'Tu rol no permite pagar la suscripción',
  'un miembro de otra org no puede pagar una suscripción ajena'
);

-- ===== confirmar / abortar (SOLO service_role) =====
set local role service_role;

-- 8) Feliz: confirmar extiende y retorna 'extendido' (A: trial, hasta nulo).
select is(
  confirmar_pago_suscripcion('a0000001-0000-0000-0000-000000000001', 'mp:pa', 29990),
  'extendido',
  'confirmar un pago pendiente retorna extendido'
);

-- 9) Idempotente: el segundo confirmar del mismo pago (ya pagado) es 'noop' y no re-extiende.
select is(
  confirmar_pago_suscripcion('a0000001-0000-0000-0000-000000000001', 'mp:pa', 29990),
  'noop',
  'reconfirmar un pago ya pagado es noop'
);

-- Setup EXT2: confirmar el pago de C (hasta futuro) — leído por el assert 18.
select confirmar_pago_suscripcion('a0000002-0000-0000-0000-000000000002', 'mp:pc', 29990);

-- 10) Monto distinto al del pago → 'revision' (no extiende).
select is(
  confirmar_pago_suscripcion('a0000003-0000-0000-0000-000000000003', 'mp:pr', 999),
  'revision',
  'confirmar con un monto distinto marca revision'
);

-- 11) Abortar degrada un pendiente a 'abortado' (setup del assert; leído a continuación).
select abortar_pago_suscripcion('a0000004-0000-0000-0000-000000000004');
select is(
  (select estado from pagos_suscripcion where id = 'a0000004-0000-0000-0000-000000000004'),
  'abortado',
  'abortar degrada un pago pendiente a abortado'
);

-- 12) Confirmar sobre un abortado GANA: la plata real vence a la anulación de UI.
select is(
  confirmar_pago_suscripcion('a0000004-0000-0000-0000-000000000004', 'mp:px', 29990),
  'extendido',
  'confirmar sobre un abortado extiende igual (la plata real gana)'
);

-- 13) Abortar NO degrada un pago ya pagado (setup + assert): PA quedó 'pagado'.
select abortar_pago_suscripcion('a0000001-0000-0000-0000-000000000001');
select is(
  (select estado from pagos_suscripcion where id = 'a0000001-0000-0000-0000-000000000001'),
  'pagado',
  'abortar no degrada un pago ya pagado'
);

-- 14) Confirmar un pago inexistente lanza.
select throws_ok(
  $$select confirmar_pago_suscripcion('dead0000-0000-0000-0000-000000000000', 'mp:none', 1)$$,
  'P0001', 'El pago no existe',
  'confirmar un pago inexistente lanza'
);

-- 15) hasta se extiende un mes desde trial_hasta (A nació en trial con hasta nulo:
--     greatest(current_date, coalesce(null, trial_hasta, current_date)) + 1 mes).
select is(
  (select hasta from suscripciones
   where organizacion_id = (select id from organizaciones where rut = '777000012')),
  ((current_date + 14) + interval '1 month')::date,
  'la suscripción se extiende un mes desde trial_hasta'
);

-- 16) La org queda activa tras pagar (trial -> activa).
select is(
  (select estado from organizaciones where rut = '777000012'),
  'activa',
  'la org queda activa tras el pago'
);

-- 17) Extensión desde trial: hasta NO colapsa a current_date + 1 mes (usó trial_hasta).
select ok(
  (select hasta from suscripciones
   where organizacion_id = (select id from organizaciones where rut = '777000012'))
  <> (current_date + interval '1 month')::date,
  'pagar en trial extiende desde trial_hasta, no desde hoy'
);

-- 18) Extensión con hasta futuro: greatest extiende desde hasta (current_date + 90), no desde hoy.
select is(
  (select hasta from suscripciones
   where organizacion_id = (select id from organizaciones where rut = '777000020')),
  ((current_date + 90) + interval '1 month')::date,
  'pagar con hasta futuro usa greatest y extiende desde hasta'
);

-- 19) La revisión no extendió: IDEM sigue sin hasta y en trial.
select is(
  coalesce((select hasta from suscripciones
            where organizacion_id = (select id from organizaciones where rut = '777000055'))::text, 'sin-hasta')
  || '/' ||
  (select estado from organizaciones where rut = '777000055'),
  'sin-hasta/trial',
  'un pago en revision no extiende ni activa la org'
);

-- 26) Backstop 23505 anti-doble-acreditación: PA (a0000001) ya está 'pagado' con
--     referencia 'mp:pa'. Un SEGUNDO pago pendiente mercadopago (a0000005) confirmado con
--     esa MISMA referencia colisiona en el índice único parcial → el handler devuelve
--     'noop' y el UPDATE se revierte, así el segundo pago sigue 'pendiente' (jamás doble
--     acreditación; segundo pago intacto). Se asserta ambos hechos en una expresión.
select is(
  confirmar_pago_suscripcion('a0000005-0000-0000-0000-000000000005', 'mp:pa', 29990)
  || '/' ||
  (select estado from pagos_suscripcion where id = 'a0000005-0000-0000-0000-000000000005'),
  'noop/pendiente',
  'un segundo pago con una referencia ya acreditada es noop y queda pendiente (backstop 23505)'
);

-- ===== Candados (authenticated / anon) =====
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- 20) authenticated NO ejecuta confirmar (solo service_role; el grant ES el candado).
select throws_ok(
  $$select confirmar_pago_suscripcion('a0000001-0000-0000-0000-000000000001', 'x', 1)$$,
  '42501', 'permission denied for function confirmar_pago_suscripcion',
  'authenticated no puede ejecutar confirmar_pago_suscripcion'
);

-- 21) authenticated NO ejecuta abortar.
select throws_ok(
  $$select abortar_pago_suscripcion('a0000001-0000-0000-0000-000000000001')$$,
  '42501', 'permission denied for function abortar_pago_suscripcion',
  'authenticated no puede ejecutar abortar_pago_suscripcion'
);

-- 22) Escritura directa denegada: insert (toda escritura es por RPC service_role).
select throws_ok(
  $$insert into pagos_suscripcion (organizacion_id, plan_id, monto, pasarela, buy_order)
    values (gen_random_uuid(), gen_random_uuid(), 1000, 'mercadopago', 'bohack')$$,
  '42501', 'permission denied for table pagos_suscripcion',
  'authenticated no puede insertar directamente en pagos_suscripcion'
);

-- 23) Escritura directa denegada: update.
select throws_ok(
  $$update pagos_suscripcion set monto = 1
    where organizacion_id = (select id from organizaciones where rut = '777000012')$$,
  '42501', 'permission denied for table pagos_suscripcion',
  'authenticated no puede editar directamente pagos_suscripcion'
);

-- 24) RLS cross-org: Beto (dueño de B, sin pagos) no ve ningún pago de las orgs de Ana.
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
select is(
  (select count(*) from pagos_suscripcion),
  0::bigint,
  'un dueño de otra org no ve pagos de suscripción ajenos'
);

-- 27) RLS mismo-org: Vero es VENDEDORA de A (777000012); el select solo lo ve dueño/admin,
--     así que aun siendo miembro de A ve 0 pagos. Cierra el otro flanco del cross-org (24).
set local request.jwt.claims to '{"sub": "77777777-7777-7777-7777-777777777777", "role": "authenticated"}';
select is(
  (select count(*) from pagos_suscripcion),
  0::bigint,
  'un vendedor de la misma org no ve pagos de suscripción (RLS solo dueño/admin)'
);

-- 25) Anónimo denegado de plano.
set local role anon;
set local request.jwt.claims to '{"role": "anon"}';
select throws_ok(
  'select count(*) from pagos_suscripcion',
  '42501', 'permission denied for table pagos_suscripcion',
  'un anónimo no puede consultar pagos_suscripcion'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Ejecutar**

Run: `pnpm supabase test db`
Expected: 14 archivos, **269 asserts** (aislamiento 6, cobranza 16, combustible 18, compras 19, cotizaciones 27, inventario 10, maestros 11, mercadopago 31, por_pagar 18, registro 7, reportes 11, suscripciones_pago **27**, transporte 59, ventas 9), todos verdes. Si un assert de `suscripciones_pago` falla, el sospechoso es la migración 0019 (Task 1) — NO debilitar el test. Única adaptación permitida: el TEXTO exacto de los mensajes nativos de Postgres en los asserts 22, 23 y 25 (`permission denied for table ...`) y 20, 21 (`permission denied for function ...`), si la versión los formula distinto; los CÓDIGOS de error (42501/P0001), los mensajes de RPC del contrato §3, los goldens de `hasta`/estado y los conteos son el contrato.

Diagnóstico rápido si cae un grupo:
- Asserts 1-7 (`crear_pago_suscripcion`): revisa el ORDEN rol → plan → pasarela (rol primero: vendedor y otra-org dan el mismo mensaje ANTES de mirar el plan); `buy_order` = `substr(replace(gen_random_uuid()::text,'-',''),1,25)`.
- Asserts 8-14 (`confirmar`/`abortar`): idempotencia dentro del lock (`pagado`→`noop`); procede desde `pendiente` Y `abortado`; `p_monto <> monto`→`revision` sin extender; `abortar` solo degrada `pendiente`.
- Asserts 15-19 (extensión): `hasta = (greatest(current_date, coalesce(hasta, o.trial_hasta, current_date)) + interval '1 month')::date` + org `'activa'`; la revisión no toca `suscripciones` ni `organizaciones`.
- Assert 26 (backstop 23505): con PA (`a0000001`) ya `pagado`/`mp:pa`, confirmar un segundo pendiente mercadopago (`a0000005`) con `mp:pa` colisiona en `pagos_suscripcion_referencia_idx` → el handler `unique_violation` devuelve `'noop'` y revierte el UPDATE (segundo pago sigue `pendiente`). Si falla: revisa el `begin/exception` del camino feliz en 0019.
- Asserts 20-25, 27 (candados): `confirmar`/`abortar` con `grant` SOLO a service_role; `pagos_suscripcion` con `grant select` (sin insert/update) a authenticated y sin grant a anon; RLS por `app.tiene_rol(organizacion_id, array['dueno','admin'])` — ni un dueño ajeno (24) ni un vendedor de la misma org (27) ven filas.

Byte-scan del archivo (JAMÁS BOM U+FEFF):

```
grep -c $'\xEF\xBB\xBF' supabase/tests/database/suscripciones_pago.test.sql
```

→ imprime `0` y sale con status 1 (sin coincidencias = pass).

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/database/suscripciones_pago.test.sql
git commit -m "test(db): pgTAP de pago de suscripciones — extensión, doble vía y candados"
```

---

### Task 3: Regenerar tipos `@suite/db`

**Files:**
- Modify: `packages/db/src/types.ts` (regenerado)

**Interfaces:**
- Consumes: migración 0019 aplicada (Tasks 1-2: tabla `pagos_suscripcion` con sus índices y CHECKs, el constraint `suscripciones_organizacion_unica` sobre `suscripciones`, y las RPCs `crear_pago_suscripcion` / `confirmar_pago_suscripcion` / `abortar_pago_suscripcion`). El `db reset` de la task de pgTAP dejó el Postgres local con 0001-0019 → `gen` lee ESE estado (`--local`).
- Produces: `types.ts` regenerado — lo consumen el webhook de suscripciones, los retornos, la Server Action y las páginas ERP (Tasks siguientes) vía `@suite/db`. BLOCKED de las tasks de rutas/UI si algún símbolo falta (tipos incompletos ocultarían un error de compilación hasta runtime).

- [ ] **Step 1: Regenerar y verificar**

Run: `pnpm --filter @suite/db gen`

Expected: `types.ts` gana estos símbolos:
- Tabla `pagos_suscripcion` (Row/Insert/Update bajo `Tables`, como las tablas de 0018).
- **3 Functions nuevas** bajo `Functions`: `crear_pago_suscripcion`, `confirmar_pago_suscripcion`, `abortar_pago_suscripcion`.
- **Sin símbolo nuevo** por el constraint `suscripciones_organizacion_unica` ni por los CHECKs de `pagos_suscripcion` (`estado`, `pasarela`, `monto > 0`, buy_order único): Postgres no expone constraints ni CHECKs en los tipos — son restricciones, no tipos. No confundir "sin diff de esos" con "la migración no aplicó". `suscripciones` tampoco cambia de forma (el constraint no altera columnas).

Verificación (PowerShell) — los 4 símbolos que SÍ deben aparecer (refresca el PATH primero en una shell nueva de PowerShell 5.1):

```powershell
$simbolos = 'pagos_suscripcion', 'crear_pago_suscripcion',
  'confirmar_pago_suscripcion', 'abortar_pago_suscripcion'
foreach ($s in $simbolos) {
  if (-not (Select-String -Path packages/db/src/types.ts -Pattern $s -SimpleMatch -Quiet)) { "FALTA: $s" }
}
```

Expected: sin salida (los 4 presentes). Nota de subcadenas: ninguno es subcadena de otro, así que `-SimpleMatch` sin dos puntos basta. En particular la TABLA es `pagos_suscripcion` (plural `pagos`) y las RPCs llevan `_pago_suscripcion` (singular `pago`): `pagos_suscripcion` NO es subcadena de `crear_pago_suscripcion` → cada símbolo se verifica de forma independiente. (No aplica el truco del colon de la task espejo del Plan 13, donde `aplicar_anticipo` sí era subcadena de `aplicar_anticipo_manual`.)

Cualquier línea `FALTA:` significa que 0019 no aplicó completa → **BLOCKED** (no seguir a rutas/UI con tipos incompletos). Triage:
- Falta `pagos_suscripcion` → falló el bloque `create table` de 0019 (correr `pnpm supabase db reset` y releer el error de 0019).
- Faltan RPCs → falló el bloque de funciones; `pnpm supabase db reset` y releer el error de 0019.
- Los 4 presentes pero `confirmar`/`abortar` no ejecutan luego → problema de grants (candado service_role), NO de tipos: se cubre en la task de pgTAP, no aquí.

Run: `pnpm tsc --noEmit -p packages/db/tsconfig.json` → sin errores.
Run: `pnpm build --concurrency=1` → 3 apps.

Byte-scan del archivo regenerado (JAMÁS BOM U+FEFF; `gen` de supabase escribe UTF-8 sin BOM, pero se verifica; salida vacía / exit 1 = pass):

```
grep -c $'\xEF\xBB\xBF' packages/db/src/types.ts
```

→ imprime `0` y sale con status 1 (sin coincidencias = pass).

- [ ] **Step 2: Commit**

```bash
git add packages/db/src/types.ts
git commit -m "chore(db): tipos regenerados con pagos de suscripción"
```

---

### Task 4: `packages/pagos` — módulo Webpay + referencia de suscripción + selectores fail-closed (TDD)

**Files:**
- Create: `packages/pagos/src/webpay.ts`, `packages/pagos/src/referencia-suscripcion.ts`, `packages/pagos/src/suscripciones.ts`
- Create (tests): `packages/pagos/src/webpay.test.ts`, `packages/pagos/src/referencia-suscripcion.test.ts`, `packages/pagos/src/suscripciones.test.ts`
- Modify: `packages/pagos/src/tipos.ts` (`SolicitudPreferencia` gana `notificationUrl?`), `packages/pagos/src/mercadopago.ts` (viaja como `notification_url`), `packages/pagos/src/index.ts` (exports nuevos)

**Interfaces:**
- Consumes: el paquete `packages/pagos` REAL del Plan 13 (`tipos.ts`, `mercadopago.ts`, `mock.ts`, `seleccionar.ts`, `referencia.ts`, `index.ts`) — léelo antes de escribir; el módulo Webpay ESPEJA `mercadopago.ts` (cliente HTTP `pedir` con logging saneado) y `MockWebpay` ESPEJA el store `globalThis` de `mock.ts`. Globales de Node (`node:crypto`, `fetch`) heredados como hoy (sin `@types/node` en devDeps). `apps/erp` YA depende de `@suite/pagos` (Plan 13, Task 5) → NO se toca `apps/erp/package.json` ni `pnpm-lock.yaml`: no hay paquete nuevo ni dependencia nueva.
- Produces (LOCKED, spec §4): `interface PasarelaWebpay` (`crear`/`confirmar` — NO es `PasarelaPagos`: Webpay no tiene webhook ni firma) + `type TbkAmbiente`; `WebpayPlus` (Transbank REST v1.2, constructor `commerceCode`/`apiKey`/`ambiente`, headers `Tbk-Api-Key-*`, logging SOLO `error.message`) y `MockWebpay` (store módulo respaldado en `globalThis`, `confirmar` autoriza una vez); `armarReferenciaSuscripcion`/`parsearReferenciaSuscripcion` (3 segmentos estrictos → null) + `ReferenciaSuscripcion`; selectores FAIL-CLOSED `pasarelaSuscripciones`/`webpaySuscripciones`; `SolicitudPreferencia.notificationUrl?`. Los consumen (tasks posteriores): la Server Action de crear pago (`crearPreferencia` con `notificationUrl` + `crear` de Webpay), el webhook de suscripciones (`parsearReferenciaSuscripcion`), los retornos MP/Webpay (`confirmar`, `parsearReferenciaSuscripcion`) y el helper de app que envuelve los selectores con las env de PLATAFORMA.
- Decisión — FAIL-CLOSED, NO se reusa `pasarelaPorAmbiente` del Plan 13: su contrato `mock|mercadopago` con default `?? 'mock'` fallaría ABIERTO al mock con la perilla ausente (aceptable en Plan 13 por estar gated en credenciales por-empresa; INaceptable aquí — dinero de PLATAFORMA). Los selectores nuevos: `'mock'` → mocks, `'real'` → reales, cualquier otro valor o ausente → `throw 'Pasarela de suscripciones no configurada'`. JAMÁS default a mock.
- Decisión — `notificationUrl` ADITIVO: `crearPreferencia` pasa `notification_url: solicitud.notificationUrl` al body; `undefined` → `JSON.stringify` lo omite, así los llamadores del Plan 13 (que no lo setean) mandan exactamente el mismo body de hoy. No se agrega un test de MP para esto (el conteo del paquete es 25 = 14 + 11; la ausencia de regresión la fijan los 2 tests de `crearPreferencia` ya existentes, que no hacen `toEqual` del body completo, y `tsc`).
- Decisión — `MockWebpay.confirmar` autoriza UNA vez: `crear` guarda `token → {buyOrder, monto}` en el store; el primer `confirmar(token)` devuelve `{autorizado: true, ...}` y consume la entrada; el segundo `confirmar(token)` lanza (espejo del re-commit que Transbank real rechaza — el retorno lo trata vía idempotencia de BD: si el pago ya está `pagado`, ni llama a `confirmar`).
- Decisión — `MockWebpay.crear` usa token DETERMINISTA `'mock-tbk-' + solicitud.buyOrder` (guarda la transacción bajo esa clave y lo retorna; `confirmar` la busca por la misma clave) y devuelve `url = solicitud.returnUrl` — la `url` es IRRELEVANTE para el flujo mock (el simulador nunca la usa: su Server Action Webpay llama `crear` para sembrar el store y luego redirige al retorno con el token retornado). El store va en `globalThis.__suiteWebpayMockStore` (lección Plan 13: en `next dev` el simulador y el retorno son rutas distintas con SU propia instancia del módulo; un `const` de módulo se reinicializaría vacío entre recompilaciones).
- Wiring: `pnpm-workspace.yaml` (cubre `packages/*`) y `turbo.json` (`tasks.test = {}`, sin filtros) NO se tocan — los archivos nuevos viven en `packages/pagos` ya existente.

- [ ] **Step 1: Tests que fallan**

`packages/pagos/src/referencia-suscripcion.test.ts` (3 tests — round-trip, malformada→null, buyOrder inválido→null):

```ts
import { describe, expect, it } from 'vitest'
import {
  armarReferenciaSuscripcion,
  parsearReferenciaSuscripcion,
} from './referencia-suscripcion'
import type { ReferenciaSuscripcion } from './referencia-suscripcion'

const PAGO = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa'
const BUY_ORDER = 'a1b2c3d4e5f6a7b8c9d0e1f2a'

describe('referencia de suscripción', () => {
  it('round-trip: armar y parsear preserva pagoId y buyOrder', () => {
    const ref: ReferenciaSuscripcion = { pagoId: PAGO, buyOrder: BUY_ORDER }
    expect(armarReferenciaSuscripcion(ref)).toBe(`suscripcion:${PAGO}:${BUY_ORDER}`)
    expect(parsearReferenciaSuscripcion(armarReferenciaSuscripcion(ref))).toEqual(ref)
  })

  it('una referencia malformada (≠3 segmentos, prefijo ajeno o pagoId no-uuid) → null', () => {
    expect(parsearReferenciaSuscripcion(`suscripcion:${PAGO}`)).toBe(null)
    expect(parsearReferenciaSuscripcion(`suscripcion:${PAGO}:${BUY_ORDER}:extra`)).toBe(null)
    // La referencia del Plan 13 (4 segmentos, tipo 'factura') JAMÁS parsea aquí.
    expect(parsearReferenciaSuscripcion(`factura:${PAGO}:${BUY_ORDER}:x`)).toBe(null)
    expect(parsearReferenciaSuscripcion(`suscripcion:no-uuid:${BUY_ORDER}`)).toBe(null)
  })

  it('un buyOrder inválido (no alfanumérico o > 26 chars) → null', () => {
    expect(parsearReferenciaSuscripcion(`suscripcion:${PAGO}:tiene-guion`)).toBe(null)
    expect(parsearReferenciaSuscripcion(`suscripcion:${PAGO}:${'x'.repeat(27)}`)).toBe(null)
  })
})
```

`packages/pagos/src/webpay.test.ts` (6 tests — mock crear, mock confirmar una vez, WebpayPlus crear headers, commit PUT, no-logging, re-commit/red lanza):

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MockWebpay, WebpayPlus } from './webpay'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const CREAR_MOCK = {
  buyOrder: 'a1b2c3d4e5f6a7b8c9d0e1f2a',
  sessionId: 'pago-1',
  monto: 19900,
  returnUrl: 'https://erp/api/pagos-suscripcion/retorno',
} as const

describe('MockWebpay', () => {
  it('crear usa un token determinista por buyOrder y refleja el returnUrl', async () => {
    const { token, url } = await new MockWebpay().crear(CREAR_MOCK)
    expect(token).toBe('mock-tbk-a1b2c3d4e5f6a7b8c9d0e1f2a')
    expect(url).toBe('https://erp/api/pagos-suscripcion/retorno')
  })

  it('confirmar autoriza UNA vez con buyOrder/monto guardados; el re-commit lanza', async () => {
    const wp = new MockWebpay()
    const { token } = await wp.crear(CREAR_MOCK)
    expect(await wp.confirmar(token)).toEqual({
      autorizado: true,
      buyOrder: 'a1b2c3d4e5f6a7b8c9d0e1f2a',
      monto: 19900,
    })
    await expect(wp.confirmar(token)).rejects.toThrow()
  })
})

describe('WebpayPlus.crear', () => {
  it('hace POST a la URL de integración con los headers Tbk y el body correcto', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ token: 'tbk-token-1', url: 'https://webpay3gint.transbank.cl/webpayserver/initTransaction' }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const resultado = await new WebpayPlus('597055555532', 'API-KEY-XYZ', 'integracion').crear({
      buyOrder: 'a1b2c3d4e5f6a7b8c9d0e1f2a',
      sessionId: 'pago-1',
      monto: 19900,
      returnUrl: 'https://erp/api/pagos-suscripcion/retorno',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { method: string; headers: Record<string, string>; body: string },
    ]
    expect(url).toBe('https://webpay3gint.transbank.cl/rswebpaytransaction/api/webpay/v1.2/transactions')
    expect(init.method).toBe('POST')
    expect(init.headers['Tbk-Api-Key-Id']).toBe('597055555532')
    expect(init.headers['Tbk-Api-Key-Secret']).toBe('API-KEY-XYZ')
    const body = JSON.parse(init.body)
    expect(body.buy_order).toBe('a1b2c3d4e5f6a7b8c9d0e1f2a')
    expect(body.session_id).toBe('pago-1')
    expect(body.amount).toBe(19900)
    expect(body.return_url).toBe('https://erp/api/pagos-suscripcion/retorno')
    expect(resultado).toEqual({ token: 'tbk-token-1', url: 'https://webpay3gint.transbank.cl/webpayserver/initTransaction' })
  })
})

describe('WebpayPlus.confirmar', () => {
  it('hace PUT al token en la URL de producción y mapea autorizado/buyOrder/monto', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        buy_order: 'a1b2c3d4e5f6a7b8c9d0e1f2a',
        status: 'AUTHORIZED',
        response_code: 0,
        amount: 19900,
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const resultado = await new WebpayPlus('597055555532', 'API-KEY', 'produccion').confirmar('tbk-token-1')

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { method: string }]
    expect(url).toBe('https://webpay3g.transbank.cl/rswebpaytransaction/api/webpay/v1.2/transactions/tbk-token-1')
    expect(init.method).toBe('PUT')
    expect(resultado).toEqual({ autorizado: true, buyOrder: 'a1b2c3d4e5f6a7b8c9d0e1f2a', monto: 19900 })
  })

  it('no filtra el commerceCode ni el apiKey en los logs (serializa objetos)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const wp = new WebpayPlus('COMMERCE-SECRETO', 'API-KEY-SECRETO', 'integracion')

    await expect(wp.confirmar('token-1')).rejects.toThrow()

    // Lección Plan 13: map + JSON.stringify (join a secas daría '[object Object]'
    // y no vería un secreto que hubiese viajado dentro de un arg objeto).
    const loggeado = errSpy.mock.calls
      .flat()
      .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
      .join(' ')
    expect(loggeado).toContain('500')
    expect(loggeado).not.toContain('COMMERCE-SECRETO')
    expect(loggeado).not.toContain('API-KEY-SECRETO')
  })

  it('lanza limpio ante un re-commit rechazado o un error de red', async () => {
    // Transbank responde no-ok a un token ya commiteado (re-commit); cubre igual 5xx/red.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 422, json: async () => ({}) })))
    const wp = new WebpayPlus('597055555532', 'API-KEY', 'integracion')
    await expect(wp.confirmar('token-ya-usado')).rejects.toThrow('Webpay respondió 422')
  })
})
```

`packages/pagos/src/suscripciones.test.ts` (2 tests — perilla 'real' → reales; ausente/desconocida → throw):

```ts
import { describe, expect, it } from 'vitest'
import { MercadoPagoPasarela } from './mercadopago'
import { WebpayPlus } from './webpay'
import { pasarelaSuscripciones, webpaySuscripciones } from './suscripciones'

describe('selectores fail-closed de suscripciones', () => {
  it("perilla 'real' construye los adaptadores reales", () => {
    expect(pasarelaSuscripciones('real', 'token')).toBeInstanceOf(MercadoPagoPasarela)
    expect(webpaySuscripciones('real', '597055555532', 'api-key', 'integracion')).toBeInstanceOf(WebpayPlus)
  })

  it('perilla ausente o desconocida lanza — JAMÁS cae a mock (dinero de plataforma)', () => {
    expect(() => pasarelaSuscripciones(undefined, 'token')).toThrow('Pasarela de suscripciones no configurada')
    expect(() => pasarelaSuscripciones('produccion', 'token')).toThrow('Pasarela de suscripciones no configurada')
    expect(() => webpaySuscripciones(undefined, 'c', 'k', 'integracion')).toThrow('Pasarela de suscripciones no configurada')
    expect(() => webpaySuscripciones('mercadopago', 'c', 'k', 'integracion')).toThrow('Pasarela de suscripciones no configurada')
    // 'real' con ambiente ausente o inválido TAMBIÉN lanza — un TBK_AMBIENTE olvidado jamás
    // cae a integración (mandaría pagos reales al ambiente de pruebas de Transbank).
    expect(() => webpaySuscripciones('real', 'c', 'k', undefined)).toThrow('Pasarela de suscripciones no configurada')
    expect(() => webpaySuscripciones('real', 'c', 'k', 'sandbox')).toThrow('Pasarela de suscripciones no configurada')
  })
})
```

- [ ] **Step 2: Verificar que fallan**

Run: `pnpm --filter @suite/pagos test`
Expected: FAIL — `Cannot find module './webpay'` / `'./referencia-suscripcion'` / `'./suscripciones'` (los módulos de implementación aún no existen). Los 14 tests previos (referencia 4, mock 3, mercadopago 7) siguen verdes.

- [ ] **Step 3: Implementación**

`packages/pagos/src/referencia-suscripcion.ts` (armar + parseo estricto de 3 segmentos; NO cruza con `referencia.ts` del Plan 13):

```ts
// Referencia propia de suscripciones (spec §4): "suscripcion:{pagoId}:{buyOrder}".
// NO se cruza con armarReferencia del Plan 13 (4 segmentos con enum de tipos): el
// prefijo fijo 'suscripcion' nunca es un tipo del enum {factura, proforma,
// cotizacion} y el conteo de segmentos difiere → ninguna parsea a la otra.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// buy_order de Webpay: <=26 chars alfanumericos (crear_pago_suscripcion genera 25).
const BUY_ORDER = /^[0-9a-zA-Z]{1,26}$/

export interface ReferenciaSuscripcion {
  pagoId: string
  buyOrder: string
}

export function armarReferenciaSuscripcion(ref: ReferenciaSuscripcion): string {
  return `suscripcion:${ref.pagoId}:${ref.buyOrder}`
}

// Parseo ESTRICTO: exactamente 3 segmentos, prefijo literal 'suscripcion', pagoId
// uuid valido y buyOrder alfanumerico <=26. Cualquier desviacion → null (el webhook
// lo vuelve 200 no-op: una referencia mal formada nunca dispara un registro de dinero).
export function parsearReferenciaSuscripcion(texto: string): ReferenciaSuscripcion | null {
  const seg = texto.split(':')
  if (seg.length !== 3) return null
  const [prefijo, pagoId, buyOrder] = seg
  if (prefijo !== 'suscripcion') return null
  if (pagoId === undefined || buyOrder === undefined) return null
  if (!UUID.test(pagoId)) return null
  if (!BUY_ORDER.test(buyOrder)) return null
  return { pagoId, buyOrder }
}
```

`packages/pagos/src/webpay.ts` (interface propia; `WebpayPlus` REST v1.2 + `MockWebpay` con store `globalThis`):

```ts
// Interface propia de Webpay (spec §4). PasarelaWebpay NO es PasarelaPagos: Webpay
// no tiene webhook ni firma — el ciclo es crear → redirect → retorno → commit
// server-to-server (confirmar). Mock y real la implementan por igual.
export interface PasarelaWebpay {
  crear(solicitud: {
    buyOrder: string
    sessionId: string
    monto: number
    returnUrl: string
  }): Promise<{ token: string; url: string }>
  confirmar(token: string): Promise<{ autorizado: boolean; buyOrder: string; monto: number }>
}

export type TbkAmbiente = 'integracion' | 'produccion'

const BASE_INTEGRACION = 'https://webpay3gint.transbank.cl'
const BASE_PRODUCCION = 'https://webpay3g.transbank.cl'
const RUTA = '/rswebpaytransaction/api/webpay/v1.2/transactions'

// Adaptador de Webpay Plus (Transbank REST v1.2). commerceCode y apiKey llegan por
// constructor desde las env de PLATAFORMA y viajan en los headers Tbk-Api-Key-Id /
// Tbk-Api-Key-Secret; JAMAS se loguean (solo error.message, espejo de MercadoPagoPasarela).
export class WebpayPlus implements PasarelaWebpay {
  private readonly base: string

  constructor(
    private readonly commerceCode: string,
    private readonly apiKey: string,
    ambiente: TbkAmbiente,
  ) {
    this.base = ambiente === 'produccion' ? BASE_PRODUCCION : BASE_INTEGRACION
  }

  async crear(solicitud: {
    buyOrder: string
    sessionId: string
    monto: number
    returnUrl: string
  }): Promise<{ token: string; url: string }> {
    const data = await this.pedir('POST', RUTA, {
      buy_order: solicitud.buyOrder,
      session_id: solicitud.sessionId,
      amount: solicitud.monto,
      return_url: solicitud.returnUrl,
    })
    return { token: String(data.token), url: String(data.url) }
  }

  async confirmar(token: string): Promise<{ autorizado: boolean; buyOrder: string; monto: number }> {
    // El commit (PUT) es la UNICA fuente de verdad: autorizacion y monto salen de aca,
    // jamas de los params del retorno. autorizado = response_code 0 Y status AUTHORIZED.
    const data = await this.pedir('PUT', `${RUTA}/${encodeURIComponent(token)}`)
    const autorizado = Number(data.response_code) === 0 && data.status === 'AUTHORIZED'
    return {
      autorizado,
      buyOrder: String(data.buy_order ?? ''),
      monto: Math.round(Number(data.amount)),
    }
  }

  // Cliente HTTP minimo (espejo de MercadoPagoPasarela.pedir). LOGGING: jamas headers,
  // config ni body — solo error.message saneado. commerceCode/apiKey nunca se loguean.
  private async pedir(
    metodo: string,
    ruta: string,
    cuerpo?: unknown,
  ): Promise<Record<string, unknown>> {
    try {
      const res = await fetch(this.base + ruta, {
        method: metodo,
        headers: {
          'Tbk-Api-Key-Id': this.commerceCode,
          'Tbk-Api-Key-Secret': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      })
      if (!res.ok) throw new Error(`Webpay respondió ${res.status}`)
      return (await res.json()) as Record<string, unknown>
    } catch (error) {
      console.error('Webpay:', error instanceof Error ? error.message : 'error desconocido')
      throw error
    }
  }
}

// Store a nivel de MODULO respaldado en globalThis (leccion Plan 13, espejo de mock.ts):
// crear (Server Action del simulador, solo dev) escribe token→{buyOrder, monto} y el
// retorno, en OTRA instancia de MockWebpay, lo lee en confirmar. En `next dev` cada ruta
// recompila con su propia instancia del modulo; un `const` normal se reinicializaria
// vacio en cada recompilacion. Solo dev/mock; en produccion no se usa MockWebpay.
interface SolicitudWebpayGuardada {
  buyOrder: string
  monto: number
}
interface GlobalConStoreWebpay {
  __suiteWebpayMockStore?: Record<string, SolicitudWebpayGuardada>
}
const gw = globalThis as unknown as GlobalConStoreWebpay
const STORE_WEBPAY: Record<string, SolicitudWebpayGuardada> = (gw.__suiteWebpayMockStore ??= {})

// Pasarela Webpay simulada: opera el ciclo sin credenciales. crear guarda la solicitud
// bajo un token DETERMINISTA ('mock-tbk-' + buyOrder) y lo retorna; el simulador (Server
// Action Webpay) llama crear para sembrar el store y luego redirige al retorno con ese
// token. La url retornada es IRRELEVANTE para el flujo mock (nadie la consume): refleja el
// returnUrl. confirmar autoriza UNA vez (consume la entrada); el re-commit del mismo token
// lanza, como Transbank real (el retorno lo trata via idempotencia de BD: si el pago ya
// esta pagado, ni llama a confirmar).
export class MockWebpay implements PasarelaWebpay {
  async crear(solicitud: {
    buyOrder: string
    sessionId: string
    monto: number
    returnUrl: string
  }): Promise<{ token: string; url: string }> {
    const token = 'mock-tbk-' + solicitud.buyOrder
    STORE_WEBPAY[token] = { buyOrder: solicitud.buyOrder, monto: solicitud.monto }
    return { token, url: solicitud.returnUrl }
  }

  async confirmar(token: string): Promise<{ autorizado: boolean; buyOrder: string; monto: number }> {
    const guardada = STORE_WEBPAY[token]
    if (guardada === undefined) {
      throw new Error('Webpay: transacción no encontrada o ya confirmada')
    }
    delete STORE_WEBPAY[token]
    return { autorizado: true, buyOrder: guardada.buyOrder, monto: guardada.monto }
  }
}
```

`packages/pagos/src/suscripciones.ts` (selectores FAIL-CLOSED; NO reusa `pasarelaPorAmbiente`):

```ts
import { MercadoPagoPasarela } from './mercadopago'
import { MockPasarela } from './mock'
import { MockWebpay, WebpayPlus } from './webpay'
import type { PasarelaPagos } from './tipos'
import type { PasarelaWebpay } from './webpay'

// Selectores FAIL-CLOSED de suscripciones (spec §4). A diferencia de pasarelaPorAmbiente
// del Plan 13 (default '?? mock', aceptable por estar gated en credenciales por-empresa),
// aqui el dinero es de PLATAFORMA: una env olvidada NO puede caer a mock. 'mock' → mocks,
// 'real' → adaptadores reales, cualquier otro valor o ausente → THROW (los botones muestran
// 'no disponibles'). La perilla PASARELA_SUSCRIPCIONES gobierna los DOS metodos.
const ERROR_NO_CONFIGURADA = 'Pasarela de suscripciones no configurada'

// MP de plataforma: el token descifrado (o el propio access token de plataforma en claro
// desde env) lo inyecta el llamador; este selector solo elige Mock vs real por la perilla.
export function pasarelaSuscripciones(
  perilla: string | undefined,
  tokenDescifrado: string,
): PasarelaPagos {
  if (perilla === 'mock') return new MockPasarela()
  if (perilla === 'real') return new MercadoPagoPasarela(tokenDescifrado)
  throw new Error(ERROR_NO_CONFIGURADA)
}

export function webpaySuscripciones(
  perilla: string | undefined,
  commerceCode: string,
  apiKey: string,
  tbkAmbiente: string | undefined,
): PasarelaWebpay {
  if (perilla === 'mock') return new MockWebpay()
  if (perilla === 'real') {
    // Ambiente FAIL-CLOSED: solo 'integracion' | 'produccion' pasan. Un TBK_AMBIENTE ausente
    // o basura JAMAS cae a integracion por defecto — un olvido en produccion mandaria pagos
    // REALES al ambiente de pruebas de Transbank. El narrowing deja tbkAmbiente como
    // TbkAmbiente exacto para el ctor (que queda tipado estricto).
    if (tbkAmbiente !== 'integracion' && tbkAmbiente !== 'produccion') {
      throw new Error(ERROR_NO_CONFIGURADA)
    }
    return new WebpayPlus(commerceCode, apiKey, tbkAmbiente)
  }
  throw new Error(ERROR_NO_CONFIGURADA)
}
```

**Modify `packages/pagos/src/tipos.ts`** — `SolicitudPreferencia` gana `notificationUrl?` (ADITIVO). Diff exacto contra el archivo real (única línea agregada, más su comentario):

```
 export interface SolicitudPreferencia {
   titulo: string
   monto: number
   externalReference: string
   urlRetorno: string
+  // Plan 14 (aditivo): si se define, viaja como notification_url de la preferencia
+  // (webhook de PLATAFORMA por-preferencia). Los llamadores del Plan 13 lo omiten.
+  notificationUrl?: string
 }
```

Resultado (bloque completo tras el edit):

```ts
export interface SolicitudPreferencia {
  titulo: string
  monto: number
  externalReference: string
  urlRetorno: string
  // Plan 14 (aditivo): si se define, viaja como notification_url de la preferencia
  // (webhook de PLATAFORMA por-preferencia). Los llamadores del Plan 13 lo omiten.
  notificationUrl?: string
}
```

**Modify `packages/pagos/src/mercadopago.ts`** — `crearPreferencia` pasa `notification_url` (ADITIVO). Diff exacto contra el archivo real (única línea de datos agregada dentro del body, más su comentario):

```
   async crearPreferencia(solicitud: SolicitudPreferencia): Promise<Preferencia> {
     const data = await this.pedir('POST', '/checkout/preferences', {
       items: [{ title: solicitud.titulo, quantity: 1, unit_price: solicitud.monto, currency_id: 'CLP' }],
       external_reference: solicitud.externalReference,
       back_urls: { success: solicitud.urlRetorno },
       auto_return: 'approved',
+      // notification_url por PREFERENCIA (Plan 14): enruta el webhook de PLATAFORMA sin
+      // depender de configurar la cuenta MP. undefined → JSON.stringify lo omite, asi el
+      // body de los llamadores del Plan 13 (sin notificationUrl) queda idéntico al de hoy.
+      notification_url: solicitud.notificationUrl,
     })
     return { preferenciaId: String(data.id), url: String(data.init_point) }
   }
```

Resultado (método completo tras el edit):

```ts
  async crearPreferencia(solicitud: SolicitudPreferencia): Promise<Preferencia> {
    const data = await this.pedir('POST', '/checkout/preferences', {
      items: [{ title: solicitud.titulo, quantity: 1, unit_price: solicitud.monto, currency_id: 'CLP' }],
      external_reference: solicitud.externalReference,
      back_urls: { success: solicitud.urlRetorno },
      auto_return: 'approved',
      // notification_url por PREFERENCIA (Plan 14): enruta el webhook de PLATAFORMA sin
      // depender de configurar la cuenta MP. undefined → JSON.stringify lo omite, asi el
      // body de los llamadores del Plan 13 (sin notificationUrl) queda idéntico al de hoy.
      notification_url: solicitud.notificationUrl,
    })
    return { preferenciaId: String(data.id), url: String(data.init_point) }
  }
```

**Modify `packages/pagos/src/index.ts`** — agrega los exports nuevos. Diff exacto contra el archivo real (tipos vía `export type` por `isolatedModules`):

```
 export * from './tipos'
 export { armarReferencia, parsearReferencia } from './referencia'
 export { MockPasarela, registrarPagoMock, CABECERA_FIRMA_MOCK } from './mock'
 export { MercadoPagoPasarela } from './mercadopago'
 export { pasarelaPorAmbiente } from './seleccionar'
+export { armarReferenciaSuscripcion, parsearReferenciaSuscripcion } from './referencia-suscripcion'
+export type { ReferenciaSuscripcion } from './referencia-suscripcion'
+export { MockWebpay, WebpayPlus } from './webpay'
+export type { PasarelaWebpay, TbkAmbiente } from './webpay'
+export { pasarelaSuscripciones, webpaySuscripciones } from './suscripciones'
```

Resultado (archivo completo tras el edit):

```ts
export * from './tipos'
export { armarReferencia, parsearReferencia } from './referencia'
export { MockPasarela, registrarPagoMock, CABECERA_FIRMA_MOCK } from './mock'
export { MercadoPagoPasarela } from './mercadopago'
export { pasarelaPorAmbiente } from './seleccionar'
export { armarReferenciaSuscripcion, parsearReferenciaSuscripcion } from './referencia-suscripcion'
export type { ReferenciaSuscripcion } from './referencia-suscripcion'
export { MockWebpay, WebpayPlus } from './webpay'
export type { PasarelaWebpay, TbkAmbiente } from './webpay'
export { pasarelaSuscripciones, webpaySuscripciones } from './suscripciones'
```

- [ ] **Step 4: Verificar que pasan**

Run: `pnpm --filter @suite/pagos test`
Expected: PASS — **25 tests** (referencia 4, mock 3, mercadopago 7, referencia-suscripción 3, webpay 6, suscripciones 2).

Run: `pnpm --filter @suite/pagos exec tsc --noEmit -p tsconfig.json`
Expected: sin errores — fuente Y tests compilan estrictos (`strict` + `noUncheckedIndexedAccess` + `isolatedModules`).

Run: `pnpm test`
Expected: **163 tests** (core 126, auth 2, dte 10, pagos 25).

- [ ] **Step 5: Byte-scan (JAMÁS BOM literal)**

El BOM UTF-8 son los bytes `EF BB BF`; salida vacía / exit 1 = pass:

```
grep -rlP '\xEF\xBB\xBF' packages/pagos ; echo "exit=$? (1 = sin BOM = pass)"
```

Expected: sin rutas listadas, `exit=1`.

- [ ] **Step 6: Commit**

```bash
git add packages/pagos
git commit -m "feat(pagos): webpay plus, referencia de suscripción y selectores fail-closed"
```

---

### Task 5: Rutas de pago de suscripciones + middleware + simulador

**Files:**
- Create: `apps/erp/app/api/webhooks/suscripciones/mercadopago/route.ts`, `apps/erp/app/api/pagos-suscripcion/retorno/route.ts`, `apps/erp/app/api/pagos-suscripcion/retorno-mp/route.ts`, `apps/erp/app/mock-pago-suscripcion/[id]/acciones.ts`, `apps/erp/app/mock-pago-suscripcion/[id]/page.tsx`, `apps/erp/componentes/formulario-mock-suscripcion.tsx`
- Modify: `apps/erp/middleware.ts` (añade `api/pagos-suscripcion` al negative-lookahead del matcher)

**Interfaces:**
- Consumes de **`@suite/pagos`** (creado por la Task 4 de `packages/pagos`; ESA task es la fuente de verdad de estos nombres — este archivo declara el contrato que consume): `pasarelaSuscripciones(perilla: string | undefined, tokenDescifrado: string): PasarelaPagos` (selector FAIL-CLOSED: `'mock'` → `MockPasarela`, `'real'` → `MercadoPagoPasarela`, otro/ausente → THROW); `webpaySuscripciones(perilla: string | undefined, commerceCode: string, apiKey: string, tbkAmbiente: string | undefined): PasarelaWebpay` (ídem con `MockWebpay`/`WebpayPlus`; en `'real'` valida FAIL-CLOSED `tbkAmbiente ∈ {integracion, produccion}` o THROW); `PasarelaWebpay.confirmar(token: string): Promise<{ autorizado: boolean; buyOrder: string; monto: number }>` (commit server-to-server; re-commit de un token ya commiteado LANZA); `armarReferenciaSuscripcion(p: { pagoId: string; buyOrder: string }): string` → `'suscripcion:{pagoId}:{buyOrder}'`; `parsearReferenciaSuscripcion(texto: string): { pagoId: string; buyOrder: string } | null` (estricto: 3 segmentos, uuid + buy_order válidos; malformado → `null`); `registrarPagoMock(p: { mpPaymentId: string; monto: number; externalReference: string }): void` (escribe un pago `approved` en el store del mock — solo dev; lo lee `obtenerPago` del webhook); `CABECERA_FIRMA_MOCK: Record<string, string>` (cabeceras que `MockPasarela.verificarFirma` acepta); tipos `PasarelaPagos` (`obtenerPago`/`verificarFirma`/`crearPreferencia`). **Contrato mock UNIFICADO que este simulador implementa** (`[id]` = **pagoId**, no buy_order): la page consulta el pago por `.eq('id', id)` vía admin y muestra el botón según `?metodo=`. Aprobar MP → Server Action que hace `registrarPagoMock({ externalReference: armarReferenciaSuscripcion({pagoId, buyOrder}) })` + POST al webhook con `CABECERA_FIRMA_MOCK` → redirect a `/configuracion/suscripcion`. Aprobar Webpay → Server Action que llama `webpaySuscripciones('mock', ...).crear({ buyOrder, sessionId: pagoId, monto, returnUrl })` para SEMBRAR el store del `MockWebpay` (token determinista `'mock-tbk-' + buyOrder`) y luego `redirect('/api/pagos-suscripcion/retorno?token_ws=' + token)` (GET; el retorno ya acepta query). Así `MockPasarela.crearPreferencia` del Plan 13 (con su url `/mock-pago`) JAMÁS entra en este flujo.
- Consumes existentes: `clienteAdmin` de `@suite/auth/admin` (service_role; el webhook y los retornos no tienen sesión, el simulador lee sin depender de ella); `formatearCLP` de `@suite/core`; `Encabezado`, `Tarjeta`, `Boton` de `@suite/ui`; tipos `@suite/db` regenerados (tabla `pagos_suscripcion`, RPCs `confirmar_pago_suscripcion`/`abortar_pago_suscripcion`). `@suite/pagos` es **server-only** (route handlers + Server Actions) → NO entra en `transpilePackages`.
- Espejos estructurales OBLIGATORIOS (leídos completos antes de escribir): `apps/erp/app/api/webhooks/mercadopago/[empresaId]/route.ts` (orden del webhook, `extraerDataId`, firma con headers PLANOS via `.get()`, mapeo 200/500 enumerado, ALERTA sobre pago aprobado, despacho P0001→200 vs error de BD→500); `apps/erp/app/mock-pago/[id]/page.tsx` + `acciones.ts` (simulador: gate por env, lectura con `clienteAdmin`, `registrarPagoMock` + POST al webhook real con `CABECERA_FIRMA_MOCK`, id determinista, `revalidatePath`); `apps/erp/componentes/formulario-mock-pago.tsx` (`useActionState`); `apps/erp/middleware.ts` (matcher REAL — regex citada abajo); `apps/erp/lib/emision.ts` (patrón admin client server-only).
- Produces: webhook de PLATAFORMA `POST /api/webhooks/suscripciones/mercadopago` (orden §5, credenciales SOLO de env, RPC idempotente); retorno Webpay `GET|POST /api/pagos-suscripcion/retorno` (commit → resolver por buy_order → confirmar/abortar); retorno MP `GET /api/pagos-suscripcion/retorno-mp` (segunda vía: lookup server-side de `payment_id`); simulador `/mock-pago-suscripcion/[id]` (`[id]` = pagoId; gate `PASARELA_SUSCRIPCIONES === 'mock'`) con dos Server Actions (aprobar MP → webhook; aprobar Webpay → siembra store + retorno); matcher del middleware con `api/pagos-suscripcion` excluido.
- **Decisión — middleware (diff contra el regex REAL).** El matcher hoy es `matcher: ['/((?!_next/static|_next/image|favicon.ico|api/webhooks|mock-pago).*)']`. Se AÑADE una sola alternativa, `api/pagos-suscripcion`, al negative-lookahead. Verificado contra el regex real: (a) el webhook `api/webhooks/suscripciones/mercadopago` YA está excluido por el prefijo `api/webhooks` existente → NO requiere cambio; (b) el simulador `mock-pago-suscripcion/...` YA está cubierto por el prefijo `mock-pago` existente — la alternativa `mock-pago` casa el prefijo de `mock-pago-suscripcion`, el negative-lookahead falla, el path NO casa el matcher y el middleware NO corre (acceso público preservado) → NO requiere cambio; (c) SOLO los retornos `api/pagos-suscripcion/retorno` y `.../retorno-mp` quedan fuera y DEBEN añadirse: sin la exclusión, una sesión expirada durante el pago redirige el retorno a `/login` y se pierde el `token_ws` (commit nunca ocurre = cargo sin confirmar).
- **Decisión — 200 vs 500 del webhook (§5, enumerado como comentario + código):** 200 no-op (MP NO reintenta): plataforma sin credenciales (env), `PASARELA_SUSCRIPCIONES` ausente/desconocida (fail-closed), cuerpo sin `data.id`, firma inválida o vencida, pago no aprobado, pago inexistente, referencia malformada, pago de BD inexistente o `buy_order != referencia`, RPC en `'revision'` (dinero registrado + ALERTA), RPC `P0001` (pago inexistente). 500 (MP reintenta): red/5xx al consultar el pago, error de BD (cargar el pago o confirmar). Todo no-op **sobre un pago APROBADO** emite `console.error` de **ALERTA**.
- **Decisión — env de plataforma:** helpers LOCALES en cada route (`cfgPlataforma` en el webhook, `tokenPlataforma` en retorno-mp) leen `MP_PLATAFORMA_ACCESS_TOKEN`/`MP_PLATAFORMA_WEBHOOK_SECRET` y devuelven los valores o `null` — JAMÁS los imprimen. El retorno Webpay pasa `TBK_COMMERCE_CODE`/`TBK_API_KEY` (con `?? ''`) y `TBK_AMBIENTE` **CRUDO** (sin `?? ''`) al selector fail-closed, que valida el ambiente (`integracion`|`produccion` o THROW — un `?? ''` mandaría un ambiente vacío que el selector rechaza igual, pero pasarlo crudo deja el fallo en un solo lugar). En modo `mock` local, `MP_PLATAFORMA_WEBHOOK_SECRET` debe valer `'mock'` (lo que `MockPasarela.verificarFirma` acepta) y `MP_PLATAFORMA_ACCESS_TOKEN` cualquier valor no vacío (el mock lo ignora) — documentado en `.env.example` por la task de config.

- [ ] **Step 1: Webhook de plataforma `apps/erp/app/api/webhooks/suscripciones/mercadopago/route.ts`**

```ts
import { clienteAdmin } from '@suite/auth/admin'
import { pasarelaSuscripciones, parsearReferenciaSuscripcion, type PasarelaPagos } from '@suite/pagos'

// Webhook de MercadoPago de la PLATAFORMA (Plan 14, spec §5). POST público: MP no trae sesión.
// Una sola "empresa" = la plataforma; credenciales SOLO de env (JAMÁS de BD, a diferencia del
// webhook por-empresa del Plan 13). El dinero se registra vía service_role (clienteAdmin) con la
// RPC idempotente confirmar_pago_suscripcion. Excluido del middleware por el prefijo api/webhooks.
//
// Mapeo 200 vs 500 (spec §5, ENUMERADO):
//  200 no-op (MP NO reintenta): plataforma sin credenciales (env); PASARELA_SUSCRIPCIONES
//      ausente/desconocida (fail-closed); cuerpo sin data.id; firma inválida o vencida; pago no
//      aprobado; pago inexistente; referencia malformada; pago de BD inexistente o buy_order !=
//      referencia; RPC en 'revision' (dinero registrado, alerta); RPC P0001 (pago inexistente).
//  500 (MP reintenta): red/5xx al consultar el pago; error de BD (cargar el pago o confirmar).
// Todo no-op sobre un pago APROBADO emite console.error de ALERTA: un peso aprobado jamás puede
// quedar solo en un log de paso.

// Credenciales de PLATAFORMA SOLO desde env server-side; JAMÁS de BD ni del cliente. Devuelve los
// valores o null — nunca los imprime (fail-closed: sin config, el webhook no procesa).
function cfgPlataforma(): { token: string; secret: string } | null {
  const token = process.env.MP_PLATAFORMA_ACCESS_TOKEN
  const secret = process.env.MP_PLATAFORMA_WEBHOOK_SECRET
  if (!token || !secret) return null
  return { token, secret }
}

// MP notifica con { data: { id } } en el body (webhooks v2) o ?data.id= en la query (IPN legacy).
function extraerDataId(cuerpo: unknown, url: string): string | null {
  const id = (cuerpo as { data?: { id?: unknown } } | null)?.data?.id
  if (typeof id === 'string' && id !== '') return id
  if (typeof id === 'number') return String(id)
  const qp = new URL(url).searchParams.get('data.id')
  return qp && qp !== '' ? qp : null
}

export async function POST(req: Request) {
  // (1) Plataforma configurada (env server-only). Sin config → 200 no-op (config, no dinero aún).
  const cfg = cfgPlataforma()
  if (!cfg) {
    console.error('webhook suscripciones: plataforma sin credenciales de MercadoPago (env)')
    return new Response(null, { status: 200 })
  }

  // (2) data.id del cuerpo (webhooks v2) o de la query (IPN legacy).
  let cuerpo: unknown = null
  try {
    cuerpo = await req.json()
  } catch {
    cuerpo = null
  }
  const dataId = extraerDataId(cuerpo, req.url)
  if (!dataId) {
    console.error('webhook suscripciones: cuerpo sin data.id')
    return new Response(null, { status: 200 })
  }

  // (3) Pasarela por la perilla PROPIA de suscripciones (FAIL-CLOSED: ausente/desconocida → throw).
  let pasarela: PasarelaPagos
  try {
    pasarela = pasarelaSuscripciones(process.env.PASARELA_SUSCRIPCIONES, cfg.token)
  } catch {
    console.error('webhook suscripciones: PASARELA_SUSCRIPCIONES ausente o desconocida; pagos no disponibles')
    return new Response(null, { status: 200 })
  }

  // (4) Firma x-signature (headers PLANOS via .get(); secret de PLATAFORMA). Inválida o vencida → no-op.
  if (
    !pasarela.verificarFirma(
      { 'x-signature': req.headers.get('x-signature'), 'x-request-id': req.headers.get('x-request-id') },
      dataId,
      cfg.secret,
    )
  ) {
    console.error('webhook suscripciones: firma inválida o vencida')
    return new Response(null, { status: 200 })
  }

  // (5) Consulta el pago con el token de la PLATAFORMA. Red/5xx → 500 (MP reintenta).
  let pago: { estado: string; monto: number; externalReference: string } | null
  try {
    pago = await pasarela.obtenerPago(dataId)
  } catch (e) {
    console.error('webhook suscripciones: error al consultar el pago:', e instanceof Error ? e.message : 'desconocido')
    return new Response(null, { status: 500 })
  }
  if (!pago) {
    console.error('webhook suscripciones: pago inexistente en MercadoPago:', dataId)
    return new Response(null, { status: 200 })
  }

  // (6) Solo pagos aprobados producen registro.
  if (pago.estado !== 'approved') {
    console.error('webhook suscripciones: pago no aprobado (' + pago.estado + ')')
    return new Response(null, { status: 200 })
  }

  // (7) external_reference DEL PAGO: "suscripcion:{pagoId}:{buyOrder}" estricto.
  const ref = parsearReferenciaSuscripcion(pago.externalReference)
  if (!ref) {
    console.error('ALERTA webhook suscripciones: pago APROBADO con referencia inválida, sin registrar:', dataId)
    return new Response(null, { status: 200 })
  }

  const admin = clienteAdmin()

  // (8) buy_order de la fila de BD == el de la referencia (consistencia interna; la referencia sola no basta).
  const { data: pagoBd, error: ePago } = await admin
    .from('pagos_suscripcion')
    .select('buy_order')
    .eq('id', ref.pagoId)
    .maybeSingle()
  if (ePago) {
    console.error('webhook suscripciones: error de BD al cargar el pago; MP reintentará:', ePago.message)
    return new Response(null, { status: 500 })
  }
  if (!pagoBd || pagoBd.buy_order !== ref.buyOrder) {
    console.error('ALERTA webhook suscripciones: pago APROBADO cuyo buy_order no coincide, sin registrar:', dataId)
    return new Response(null, { status: 200 })
  }

  // (9) Confirma con el MONTO DEL PAGO (service_role). Idempotente; 'revision' → ALERTA (no extiende).
  const { data: resultado, error: eRpc } = await admin.rpc('confirmar_pago_suscripcion', {
    p_pago: ref.pagoId,
    p_referencia: 'mp:' + dataId,
    p_monto: pago.monto,
  })
  if (eRpc) {
    // Validación de la RPC (pago inexistente) = SQLSTATE P0001: permanente → no-op + alerta.
    if (eRpc.code === 'P0001') {
      console.error('ALERTA webhook suscripciones: pago APROBADO rechazado por la RPC, sin registrar:', eRpc.message)
      return new Response(null, { status: 200 })
    }
    // Error de BD/infra: transitorio → 500 para que MP reintente.
    console.error('webhook suscripciones: error de BD al confirmar; MP reintentará:', eRpc.message)
    return new Response(null, { status: 500 })
  }
  if (resultado === 'revision') {
    console.error('ALERTA pago suscripción en revisión: monto no coincide con el registrado, sin extender:', ref.pagoId)
  }

  return new Response(null, { status: 200 })
}
```

- [ ] **Step 2: Retorno Webpay `apps/erp/app/api/pagos-suscripcion/retorno/route.ts`**

```ts
import { clienteAdmin } from '@suite/auth/admin'
import { webpaySuscripciones } from '@suite/pagos'

// Retorno de Webpay Plus (Plan 14, spec §5). Transbank vuelve por POST form-encoded (o el usuario
// refresca → GET); por eso se leen token_ws/TBK_TOKEN/TBK_ORDEN_COMPRA de formData Y de la query.
// EXCLUIDO del middleware (api/pagos-suscripcion): una sesión expirada durante el pago NO debe
// redirigir el retorno a /login — se perdería el token_ws y el commit jamás ocurriría (cargo sin
// confirmar). El commit es la ÚNICA fuente de verdad (jamás confiar en los params para monto/auth).
// INVARIANTE: un token de Webpay se commitea SOLO aquí, en el retorno síncrono — nunca un job
// posterior (Transbank auto-reversa lo no commiteado; un commit tardío crearía un cobro fantasma).

function valor(v: FormDataEntryValue | null | undefined): string | null {
  return typeof v === 'string' && v !== '' ? v : null
}

function redirigir(req: Request, ruta: string): Response {
  return Response.redirect(new URL(ruta, req.url), 303)
}

async function manejar(req: Request): Promise<Response> {
  const q = new URL(req.url).searchParams
  let form: FormData | null = null
  if (req.method === 'POST') {
    try {
      form = await req.formData()
    } catch {
      form = null
    }
  }
  const leer = (k: string) => valor(form?.get(k)) ?? valor(q.get(k))

  const tokenWs = leer('token_ws')
  const tbkToken = leer('TBK_TOKEN')
  const tbkOrden = leer('TBK_ORDEN_COMPRA')

  const admin = clienteAdmin()

  // Sin token_ws: anulación del usuario (TBK_TOKEN) o timeout del formulario (solo TBK_ORDEN_COMPRA).
  // No hubo commit → se aborta el pendiente por su buy_order (abortar_pago_suscripcion solo degrada
  // 'pendiente'; jamás toca un pago ya confirmado).
  if (!tokenWs) {
    if (tbkOrden) {
      const { data: pago } = await admin
        .from('pagos_suscripcion')
        .select('id')
        .eq('buy_order', tbkOrden)
        .maybeSingle()
      if (pago) await admin.rpc('abortar_pago_suscripcion', { p_pago: pago.id })
    } else {
      console.error('retorno webpay: retorno sin token_ws ni orden de compra' + (tbkToken ? ' (TBK_TOKEN presente)' : ''))
    }
    return redirigir(req, '/configuracion/suscripcion?resultado=webpay-abortado')
  }

  // Commit server-to-server (fail-closed por perilla; en 'real' liga a las credenciales de env).
  // Re-commit de un token ya commiteado → Transbank/mock LANZAN → redirect SIN banner: la BD manda
  // (si el pago ya está 'pagado', la idempotencia de la RPC no duplica ni degrada).
  let commit: { autorizado: boolean; buyOrder: string; monto: number }
  try {
    const webpay = webpaySuscripciones(
      process.env.PASARELA_SUSCRIPCIONES,
      process.env.TBK_COMMERCE_CODE ?? '',
      process.env.TBK_API_KEY ?? '',
      process.env.TBK_AMBIENTE,
    )
    commit = await webpay.confirmar(tokenWs)
  } catch (e) {
    console.error('retorno webpay: commit falló o token ya commiteado:', e instanceof Error ? e.message : 'desconocido')
    return redirigir(req, '/configuracion/suscripcion')
  }

  // El commit devuelve el buy_order (el token no está en BD aún): se resuelve el pago por él.
  const { data: pago } = await admin
    .from('pagos_suscripcion')
    .select('id')
    .eq('buy_order', commit.buyOrder)
    .maybeSingle()
  if (!pago) {
    console.error('ALERTA retorno webpay: commit sin pago local para buy_order', commit.buyOrder)
    return redirigir(req, '/configuracion/suscripcion')
  }

  // No autorizado: se aborta el pendiente (jamás confirma dinero no cobrado).
  if (!commit.autorizado) {
    await admin.rpc('abortar_pago_suscripcion', { p_pago: pago.id })
    return redirigir(req, '/configuracion/suscripcion?resultado=webpay-fallido')
  }

  // Autorizado: confirma con el MONTO DEL COMMIT (service_role). Idempotente; 'revision' → ALERTA.
  const { data: resultado, error } = await admin.rpc('confirmar_pago_suscripcion', {
    p_pago: pago.id,
    p_referencia: 'tbk:' + tokenWs,
    p_monto: commit.monto,
  })
  if (error) {
    console.error('retorno webpay: error al confirmar:', error.message)
    return redirigir(req, '/configuracion/suscripcion')
  }
  if (resultado === 'revision') {
    console.error('ALERTA pago suscripción en revisión: monto Webpay no coincide con el registrado:', pago.id)
  }
  return redirigir(req, '/configuracion/suscripcion?resultado=webpay-ok')
}

export async function GET(req: Request): Promise<Response> {
  return manejar(req)
}

export async function POST(req: Request): Promise<Response> {
  return manejar(req)
}
```

- [ ] **Step 3: Retorno MP `apps/erp/app/api/pagos-suscripcion/retorno-mp/route.ts`**

```ts
import { clienteAdmin } from '@suite/auth/admin'
import { pasarelaSuscripciones, parsearReferenciaSuscripcion, type PasarelaPagos } from '@suite/pagos'

// Retorno de MercadoPago (Plan 14, spec §5): SEGUNDA vía de confirmación. Si el webhook se perdiera,
// un pago approved quedaría cobrado sin acreditar. MP agrega ?payment_id= al back_url; la query
// JAMÁS es fuente de verdad — se consulta el pago server-side con el token de la PLATAFORMA. Mismo
// pipeline que el webhook + RPC idempotente (si el webhook ya confirmó → 'noop', igual redirige ok).
// Cualquier error, falta de payment_id o pago no-approved: redirect a la página SIN confirmar
// (?resultado=mp-pendiente); el webhook es la vía primaria. EXCLUIDO del middleware.

// Token de PLATAFORMA SOLO desde env server-side; sin él no hay segunda vía. Nunca lo imprime.
function tokenPlataforma(): string | null {
  return process.env.MP_PLATAFORMA_ACCESS_TOKEN || null
}

function redirigir(req: Request, ruta: string): Response {
  return Response.redirect(new URL(ruta, req.url), 303)
}

export async function GET(req: Request): Promise<Response> {
  const paymentId = new URL(req.url).searchParams.get('payment_id')
  if (!paymentId) return redirigir(req, '/configuracion/suscripcion?resultado=mp-pendiente')

  const token = tokenPlataforma()
  if (!token) {
    console.error('retorno mp: plataforma sin token de MercadoPago (env)')
    return redirigir(req, '/configuracion/suscripcion?resultado=mp-pendiente')
  }

  let pasarela: PasarelaPagos
  try {
    pasarela = pasarelaSuscripciones(process.env.PASARELA_SUSCRIPCIONES, token)
  } catch {
    console.error('retorno mp: PASARELA_SUSCRIPCIONES ausente o desconocida')
    return redirigir(req, '/configuracion/suscripcion?resultado=mp-pendiente')
  }

  let pago: { estado: string; monto: number; externalReference: string } | null
  try {
    pago = await pasarela.obtenerPago(paymentId)
  } catch (e) {
    console.error('retorno mp: error al consultar el pago:', e instanceof Error ? e.message : 'desconocido')
    return redirigir(req, '/configuracion/suscripcion?resultado=mp-pendiente')
  }
  if (!pago || pago.estado !== 'approved') {
    return redirigir(req, '/configuracion/suscripcion?resultado=mp-pendiente')
  }

  const ref = parsearReferenciaSuscripcion(pago.externalReference)
  if (!ref) {
    console.error('ALERTA retorno mp: pago APROBADO con referencia inválida, sin registrar:', paymentId)
    return redirigir(req, '/configuracion/suscripcion?resultado=mp-pendiente')
  }

  const admin = clienteAdmin()
  const { data: pagoBd } = await admin
    .from('pagos_suscripcion')
    .select('buy_order')
    .eq('id', ref.pagoId)
    .maybeSingle()
  if (!pagoBd || pagoBd.buy_order !== ref.buyOrder) {
    console.error('ALERTA retorno mp: pago APROBADO cuyo buy_order no coincide, sin registrar:', paymentId)
    return redirigir(req, '/configuracion/suscripcion?resultado=mp-pendiente')
  }

  const { data: resultado, error } = await admin.rpc('confirmar_pago_suscripcion', {
    p_pago: ref.pagoId,
    p_referencia: 'mp:' + paymentId,
    p_monto: pago.monto,
  })
  if (error) {
    console.error('retorno mp: error al confirmar:', error.message)
    return redirigir(req, '/configuracion/suscripcion?resultado=mp-pendiente')
  }
  if (resultado === 'revision') {
    console.error('ALERTA pago suscripción en revisión: monto MP no coincide con el registrado:', ref.pagoId)
  }
  return redirigir(req, '/configuracion/suscripcion?resultado=mp-ok')
}
```

- [ ] **Step 4: Server Action del simulador `apps/erp/app/mock-pago-suscripcion/[id]/acciones.ts`**

```ts
'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { clienteAdmin } from '@suite/auth/admin'
import {
  armarReferenciaSuscripcion,
  registrarPagoMock,
  webpaySuscripciones,
  CABECERA_FIRMA_MOCK,
} from '@suite/pagos'

// Estado type-only de la action (permitido en un archivo 'use server': los tipos se borran).
export type EstadoMockSuscripcion = { error?: string }

// Carga el pago por su id (= [id] del simulador = pagoId) con admin (service_role): el
// pagador tiene sesión pero pagos_suscripcion no tiene escritura directa y el lookup no
// depende de ella. Solo modo mock (la page ya hizo notFound() fuera de él).
async function cargarPago(pagoId: string) {
  const admin = clienteAdmin()
  const { data } = await admin
    .from('pagos_suscripcion')
    .select('id, buy_order, monto')
    .eq('id', pagoId)
    .maybeSingle()
  return data
}

// MercadoPago (mock): registra el pago aprobado en el store del mock y dispara el webhook
// REAL de la plataforma con CABECERA_FIRMA_MOCK (ejercita firma + obtenerPago + RPC, vía
// primaria); al confirmar, redirige a la suscripción. La action de la Task 6 en modo mock
// NO crea preferencia: redirige aquí, así MockPasarela.crearPreferencia (url /mock-pago del
// Plan 13) nunca entra en este flujo.
export async function aprobarMpSuscripcion(
  _prev: EstadoMockSuscripcion,
  formData: FormData,
): Promise<EstadoMockSuscripcion> {
  // Defensa en profundidad: el simulador solo existe en modo mock (la page ya hace notFound()).
  if (process.env.PASARELA_SUSCRIPCIONES !== 'mock') return { error: 'El simulador de suscripciones no está disponible' }

  const pagoId = String(formData.get('pago_id') ?? '')
  const pago = await cargarPago(pagoId)
  if (!pago) return { error: 'No se encontró el pago de suscripción' }

  // external_reference con el MISMO formato estricto que parsea el webhook.
  const externalReference = armarReferenciaSuscripcion({ pagoId: pago.id, buyOrder: pago.buy_order })
  // Id determinista por pago: re-simular reusa el MISMO id → el webhook lo dedup (idempotencia).
  const mpPaymentId = 'mock-sub-' + pago.id
  // Store en memoria del mock: que obtenerPago(id) del webhook devuelva este pago aprobado.
  registrarPagoMock({ mpPaymentId, monto: pago.monto, externalReference })

  const h = await headers()
  const host = h.get('host') ?? ''
  const proto = h.get('x-forwarded-proto') ?? 'http'
  let respuesta: Response
  try {
    respuesta = await fetch(`${proto}://${host}/api/webhooks/suscripciones/mercadopago`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...CABECERA_FIRMA_MOCK },
      body: JSON.stringify({ data: { id: mpPaymentId } }),
      cache: 'no-store',
    })
  } catch {
    return { error: 'No se pudo contactar el webhook' }
  }
  if (!respuesta.ok) return { error: `El webhook respondió ${respuesta.status}` }
  redirect('/configuracion/suscripcion?resultado=mp-ok')
}

// Webpay (mock): SIEMBRA el store del MockWebpay llamando crear (token determinista
// 'mock-tbk-' + buyOrder) y redirige al retorno SÍNCRONO con ese token; el retorno commitea
// (MockWebpay.confirmar) y confirma/aborta el pago por su buy_order. En 'mock' el selector
// ignora commerceCode/apiKey/ambiente, así que se pasan valores placeholder.
export async function aprobarWebpaySuscripcion(
  _prev: EstadoMockSuscripcion,
  formData: FormData,
): Promise<EstadoMockSuscripcion> {
  if (process.env.PASARELA_SUSCRIPCIONES !== 'mock') return { error: 'El simulador de suscripciones no está disponible' }

  const pagoId = String(formData.get('pago_id') ?? '')
  const pago = await cargarPago(pagoId)
  if (!pago) return { error: 'No se encontró el pago de suscripción' }

  const h = await headers()
  const host = h.get('host') ?? ''
  const proto = h.get('x-forwarded-proto') ?? 'http'
  const returnUrl = `${proto}://${host}/api/pagos-suscripcion/retorno`
  const webpay = webpaySuscripciones('mock', '', '', 'integracion')
  const { token } = await webpay.crear({ buyOrder: pago.buy_order, sessionId: pago.id, monto: pago.monto, returnUrl })
  redirect('/api/pagos-suscripcion/retorno?token_ws=' + token)
}
```

- [ ] **Step 5: Botón del simulador `apps/erp/componentes/formulario-mock-suscripcion.tsx`**

```tsx
'use client'

import { useActionState } from 'react'
import { Boton } from '@suite/ui'
import type { EstadoMockSuscripcion } from '../app/mock-pago-suscripcion/[id]/acciones'

// Botón único del simulador: ambos métodos (MP y Webpay) submitan una Server Action que en
// ÉXITO REDIRIGE (MP → /configuracion/suscripcion; Webpay → el retorno síncrono), así que aquí
// solo se muestran errores. El pagoId viaja oculto; la etiqueta la fija la page según ?metodo=.
export function FormularioMockSuscripcion({
  accion,
  pagoId,
  etiqueta,
}: {
  accion: (prev: EstadoMockSuscripcion, formData: FormData) => Promise<EstadoMockSuscripcion>
  pagoId: string
  etiqueta: string
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoMockSuscripcion)

  return (
    <form action={enviar}>
      <input type="hidden" name="pago_id" value={pagoId} />
      <Boton type="submit" disabled={pendiente}>
        {pendiente ? 'Procesando…' : etiqueta}
      </Boton>
      {estado.error && <p className="mt-2 text-sm text-red-600">{estado.error}</p>}
    </form>
  )
}
```

- [ ] **Step 6: Página del simulador `apps/erp/app/mock-pago-suscripcion/[id]/page.tsx`**

```tsx
import { notFound } from 'next/navigation'
import { clienteAdmin } from '@suite/auth/admin'
import { formatearCLP } from '@suite/core'
import { Encabezado, Tarjeta } from '@suite/ui'
import { FormularioMockSuscripcion } from '../../../componentes/formulario-mock-suscripcion'
import { aprobarMpSuscripcion, aprobarWebpaySuscripcion } from './acciones'

export default async function MockPagoSuscripcion({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ metodo?: string }>
}) {
  // Simulador SOLO modo mock (gate estricto): fuera de él la ruta no existe.
  if (process.env.PASARELA_SUSCRIPCIONES !== 'mock') notFound()
  const { id } = await params
  // [id] = pagoId (contrato unificado). El pagador tiene sesión ERP, pero el simulador lee con
  // admin (service_role) por id: pagos_suscripcion no tiene escritura directa y el lookup no
  // depende de la sesión.
  const admin = clienteAdmin()
  const { data: pago } = await admin
    .from('pagos_suscripcion')
    .select('id, buy_order, pasarela, monto, estado, plan_id')
    .eq('id', id)
    .maybeSingle()
  if (!pago) notFound()
  const { data: plan } = await admin
    .from('planes')
    .select('nombre')
    .eq('id', pago.plan_id)
    .maybeSingle()

  // El método lo trae ?metodo= (lo pone la action de la Task 6 al redirigir); si falta o es
  // inválido, cae al pasarela ya guardado en el pago (ambos coinciden por construcción).
  const { metodo } = await searchParams
  const pasarela = metodo === 'webpay' || metodo === 'mercadopago' ? metodo : pago.pasarela
  const esWebpay = pasarela === 'webpay'
  const nombreMetodo = esWebpay ? 'Webpay Plus' : 'MercadoPago'

  return (
    <div className="mx-auto max-w-lg p-8">
      <Encabezado titulo={'Pago simulado de suscripción (' + nombreMetodo + ')'} />
      <Tarjeta>
        <p className="text-sm text-slate-600">Entorno de prueba: no se cobra dinero real.</p>
        <p className="mt-4 text-sm text-slate-500">{plan?.nombre ?? 'Plan'}</p>
        <p className="mt-1 text-3xl font-semibold text-slate-900">{formatearCLP(pago.monto)}</p>
        <p className="mt-1 text-sm text-slate-500">
          {pago.estado === 'pagado'
            ? 'Este pago ya figura como acreditado; volver a simular no lo duplica.'
            : 'Presiona el botón para simular un pago aprobado.'}
        </p>
        <div className="mt-6">
          <FormularioMockSuscripcion
            accion={esWebpay ? aprobarWebpaySuscripcion : aprobarMpSuscripcion}
            pagoId={pago.id}
            etiqueta={esWebpay ? 'Aprobar pago Webpay' : 'Aprobar pago MercadoPago'}
          />
        </div>
      </Tarjeta>
    </div>
  )
}
```

- [ ] **Step 7: Middleware — excluir los retornos de suscripción (diff exacto contra el regex REAL)**

`apps/erp/middleware.ts`: el matcher REAL hoy es `matcher: ['/((?!_next/static|_next/image|favicon.ico|api/webhooks|mock-pago).*)']`. Se añade UNA alternativa, `api/pagos-suscripcion`, al negative-lookahead. El webhook (`api/webhooks/...`) ya lo cubre `api/webhooks`; el simulador (`mock-pago-suscripcion/...`) ya lo cubre el prefijo `mock-pago` (verificado: la alternativa `mock-pago` casa el prefijo → el path NO casa el matcher → middleware NO corre → público). Solo los retornos quedaban fuera.

```diff
 export const config = {
-  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/webhooks|mock-pago).*)'],
+  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/webhooks|api/pagos-suscripcion|mock-pago).*)'],
 }
```

- [ ] **Step 8: Verificar y commit**

Requisito previo: `@suite/pagos` (Task 4: `pasarelaSuscripciones`, `webpaySuscripciones` FAIL-CLOSED por ambiente, `armarReferenciaSuscripcion`, `parsearReferenciaSuscripcion`, `MockWebpay` con token determinista `'mock-tbk-' + buyOrder`) y los tipos `@suite/db` regenerados (tabla `pagos_suscripcion`, RPCs `confirmar_pago_suscripcion`/`abortar_pago_suscripcion`) ya deben existir.

Refrescar el PATH en la shell nueva (Windows) antes de construir. `&&` NO encadena en PowerShell 5.1 → un comando por línea.

Run (3 apps compilan sin errores):

```
pnpm --filter erp build
pnpm --filter admin build
pnpm --filter web build
```

En el listado de rutas de `erp` deben aparecer las cuatro rutas dinámicas (`ƒ`, usan `clienteAdmin`/`headers()`/`request`):

```
ƒ /api/webhooks/suscripciones/mercadopago
ƒ /api/pagos-suscripcion/retorno
ƒ /api/pagos-suscripcion/retorno-mp
ƒ /mock-pago-suscripcion/[id]
```

Byte-scan (CERO BOM literal U+FEFF en los archivos nuevos/tocados; 0 coincidencias = pass):

```bash
grep -rlP '\xEF\xBB\xBF' apps/erp/app/api/webhooks/suscripciones apps/erp/app/api/pagos-suscripcion apps/erp/app/mock-pago-suscripcion apps/erp/componentes/formulario-mock-suscripcion.tsx apps/erp/middleware.ts && echo "FALLA: hay BOM" || echo "sin BOM (pass)"
```

Commit:

```bash
git add apps/erp/app/api/webhooks/suscripciones apps/erp/app/api/pagos-suscripcion apps/erp/app/mock-pago-suscripcion apps/erp/componentes/formulario-mock-suscripcion.tsx apps/erp/middleware.ts
git commit -m "feat(erp): webhook de plataforma, retornos webpay/mp y simulador de suscripciones"
```

---

### Task 6: ERP — página de suscripción con pago MP/Webpay + columna admin

**Files:**
- Create: `apps/erp/app/configuracion/suscripcion/page.tsx`
- Create: `apps/erp/app/configuracion/suscripcion/acciones.ts`
- Create: `apps/erp/componentes/formulario-pagar-suscripcion.tsx`
- Modify: `apps/erp/app/configuracion/page.tsx` (tarjeta "Suscripción")
- Modify: `apps/admin/app/page.tsx` (columna "Suscrita hasta")
- Modify: `apps/erp/.env.example` (6 vars de plataforma + credenciales públicas Transbank + runbook)

**Interfaces:**
- Consumes (tasks previas del Plan 14): RPC `crear_pago_suscripcion(p_organizacion, p_pasarela) returns jsonb {id, buy_order}` (Task 1/2, authenticated dueno/admin); de `@suite/pagos` los selectores FAIL-CLOSED `pasarelaSuscripciones(perilla, tokenDescifrado)` / `webpaySuscripciones(perilla, commerceCode, apiKey, tbkAmbiente)`, `armarReferenciaSuscripcion({pagoId, buyOrder})` y `crearPreferencia` con `notificationUrl?` (Task 3/4); tipos regenerados de `@suite/db` con `pagos_suscripcion` (Task 4). Del schema: `app.tiene_rol` implícito en la RLS de `suscripciones`/`pagos_suscripcion`; `organizaciones`/`planes` legibles por miembros (0001).
- Produces: la ruta de autoservicio `/configuracion/suscripcion` (guard dueno/admin de la ORG), la Server Action `pagarSuscripcion`, el client component del auto-POST de Webpay, la tarjeta de acceso y la columna admin; documentación de la config de plataforma en `.env.example`.
- ESPEJOS leídos antes de escribir: `apps/erp/app/configuracion/pagos/page.tsx` + `acciones.ts` (page async con `obtenerEmpresaActiva`, action `_prev/formData`, `headers()` para el origin), `apps/erp/componentes/formulario-pagos.tsx` y `formulario-mock-pago.tsx` (`useActionState`, `import type` de la action 'use server'), `apps/erp/app/combustible/importar.ts` (guard de rol real: `auth.getUser()` + query de `miembros` filtrada por `usuario_id`), `apps/erp/app/page.tsx` (insignias de estado de la org), `apps/admin/app/page.tsx` (tabla + embed `planes (nombre)`), `apps/erp/app/mock-pago/[id]/acciones.ts` (redirect/return de una action de pago).
- Mensaje EXACTO de la action (contrato): `'Los pagos de suscripción no están disponibles todavía'`. Los 5 mensajes contractuales de la RPC llegan por `error.message` sin reescribir.

- [ ] **Step 1: Server Action `pagarSuscripcion`**

`apps/erp/app/configuracion/suscripcion/acciones.ts`:

```ts
'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@suite/auth/server'
import { armarReferenciaSuscripcion, pasarelaSuscripciones, webpaySuscripciones } from '@suite/pagos'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'

// Estado de la action (tipos permitidos en un archivo 'use server': se borran al
// compilar). `webpay` viaja al client component para el auto-POST con token_ws.
export type EstadoPagoSuscripcion = { error?: string; webpay?: { url: string; token: string } }

const NO_DISPONIBLE = 'Los pagos de suscripción no están disponibles todavía'

export async function pagarSuscripcion(
  _prev: EstadoPagoSuscripcion,
  formData: FormData,
): Promise<EstadoPagoSuscripcion> {
  // El método lo trae el botón submit (name="metodo").
  const metodo = String(formData.get('metodo') ?? '')
  if (metodo !== 'mercadopago' && metodo !== 'webpay') return { error: 'Método de pago no soportado' }

  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return { error: 'No tienes una organización activa' }

  // Config de PLATAFORMA validada ANTES de la RPC (para no dejar filas `pendiente`
  // huérfanas). Fail-closed: solo 'mock' | 'real'; en 'real' el credencial del
  // método elegido debe existir (los selectores no exigen token no vacío).
  const perilla = process.env.PASARELA_SUSCRIPCIONES
  if (perilla !== 'mock' && perilla !== 'real') return { error: NO_DISPONIBLE }
  if (perilla === 'real') {
    // MP real necesita el access token Y el webhook secret (sin secret el webhook no verifica
    // firma → la confirmación quedaría solo en el retorno-mp; se exige antes de crear el pago).
    if (metodo === 'mercadopago' && (!process.env.MP_PLATAFORMA_ACCESS_TOKEN || !process.env.MP_PLATAFORMA_WEBHOOK_SECRET)) return { error: NO_DISPONIBLE }
    if (metodo === 'webpay' && (!process.env.TBK_COMMERCE_CODE || !process.env.TBK_API_KEY)) return { error: NO_DISPONIBLE }
  }

  const supabase = await crearClienteServidor()

  // Datos para armar la preferencia/transacción: razón social (título) y precio del
  // plan (monto). Leer no crea filas. ponytail: el monto autoritativo lo copia la
  // RPC desde planes.precio_clp bajo lock; este es el MISMO valor (precio estable).
  // Si difiriera, confirmar_pago_suscripcion mandaría el pago a 'revision', nunca
  // extendería con un monto equivocado.
  const { data: org } = await supabase
    .from('organizaciones')
    .select('razon_social, planes (nombre, precio_clp)')
    .eq('id', activa.organizacion_id)
    .single()
  const plan = org?.planes
  if (!org || !plan) return { error: 'La organización no tiene un plan asignado' }
  const monto = plan.precio_clp

  // RPC: valida rol/plan/monto y genera el buy_order (no enumerable) DENTRO de BD.
  const { data: creado, error: eCrear } = await supabase.rpc('crear_pago_suscripcion', {
    p_organizacion: activa.organizacion_id,
    p_pasarela: metodo,
  })
  if (eCrear) return { error: eCrear.message }
  const { id: pagoId, buy_order: buyOrder } = creado as { id: string; buy_order: string }

  // Modo mock: NO se crea preferencia ni transacción real. Se redirige DIRECTO al simulador
  // local (id = pagoId), que registra el pago aprobado (MP → webhook) o siembra el store de
  // MockWebpay y va al retorno (Webpay). Así el contrato del simulador es uno solo y
  // MockPasarela.crearPreferencia del Plan 13 (url /mock-pago) jamás entra en este flujo.
  if (perilla === 'mock') {
    redirect(`/mock-pago-suscripcion/${pagoId}?metodo=${metodo}`)
  }

  const h = await headers()
  const host = h.get('host') ?? ''
  const proto = h.get('x-forwarded-proto') ?? 'https'
  const origin = `${proto}://${host}`

  if (metodo === 'mercadopago') {
    const pasarela = pasarelaSuscripciones(perilla, process.env.MP_PLATAFORMA_ACCESS_TOKEN ?? '')
    const pref = await pasarela.crearPreferencia({
      titulo: `Suscripción ${plan.nombre} — ${org.razon_social}`,
      monto,
      externalReference: armarReferenciaSuscripcion({ pagoId, buyOrder }),
      // back_url: la segunda vía de confirmación (lookup del payment server-side).
      urlRetorno: `${origin}/api/pagos-suscripcion/retorno-mp`,
      // notification_url POR PREFERENCIA: el webhook de plataforma no depende de
      // configurar la cuenta MP.
      notificationUrl: `${origin}/api/webhooks/suscripciones/mercadopago`,
    })
    redirect(pref.url)
  }

  // Webpay: crear() devuelve {token, url}; el envío es un FORMULARIO AUTO-POST con
  // token_ws oculto (mecanismo canónico de Transbank, no query string). La action
  // no puede auto-postear: devuelve {url, token} y el client component lo hace.
  const webpay = webpaySuscripciones(
    perilla,
    process.env.TBK_COMMERCE_CODE ?? '',
    process.env.TBK_API_KEY ?? '',
    process.env.TBK_AMBIENTE,
  )
  const tx = await webpay.crear({
    buyOrder,
    sessionId: pagoId,
    monto,
    returnUrl: `${origin}/api/pagos-suscripcion/retorno`,
  })
  return { webpay: { url: tx.url, token: tx.token } }
}
```

- [ ] **Step 2: Client component del auto-POST de Webpay**

`apps/erp/componentes/formulario-pagar-suscripcion.tsx`:

```tsx
'use client'

import { useActionState, useEffect, useRef } from 'react'
import { Boton } from '@suite/ui'
import type { EstadoPagoSuscripcion } from '../app/configuracion/suscripcion/acciones'

export function FormularioPagarSuscripcion({
  accion,
}: {
  accion: (prev: EstadoPagoSuscripcion, formData: FormData) => Promise<EstadoPagoSuscripcion>
}) {
  const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoPagoSuscripcion)
  const formWebpay = useRef<HTMLFormElement>(null)

  // MercadoPago redirige server-side (redirect() en la action). Webpay se envía por
  // FORMULARIO AUTO-POST con token_ws oculto: cuando la action devuelve el token, el
  // form oculto se auto-submitea hacia la URL de la transacción de Transbank.
  useEffect(() => {
    if (estado.webpay) formWebpay.current?.submit()
  }, [estado.webpay])

  return (
    <>
      <form action={enviar} className="flex flex-wrap items-center gap-3">
        <Boton type="submit" name="metodo" value="mercadopago" disabled={pendiente}>
          {pendiente ? 'Redirigiendo…' : 'Pagar 1 mes con MercadoPago'}
        </Boton>
        <Boton type="submit" name="metodo" value="webpay" variante="secundario" disabled={pendiente}>
          {pendiente ? 'Redirigiendo…' : 'Pagar 1 mes con Webpay'}
        </Boton>
        {estado.error && <span className="w-full text-sm text-red-600">{estado.error}</span>}
      </form>

      {estado.webpay && (
        <form ref={formWebpay} method="POST" action={estado.webpay.url} className="hidden">
          <input type="hidden" name="token_ws" value={estado.webpay.token} />
        </form>
      )}
    </>
  )
}
```

- [ ] **Step 3: Página de suscripción (guard dueno/admin, estados, historial, banner)**

`apps/erp/app/configuracion/suscripcion/page.tsx`:

```tsx
import { crearClienteServidor } from '@suite/auth/server'
import { formatearCLP } from '@suite/core'
import { Encabezado, Insignia, Tarjeta } from '@suite/ui'
import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
import { FormularioPagarSuscripcion } from '../../../componentes/formulario-pagar-suscripcion'
import { pagarSuscripcion } from './acciones'

type Tono = 'verde' | 'amarillo' | 'rojo' | 'gris'

function fmtFecha(iso: string | null): string {
  return iso ? new Date(iso + 'T00:00:00').toLocaleDateString('es-CL') : '—'
}

// Banner por ?resultado= de las rutas de retorno (Task 5). TODOS los valores usados.
const BANNERS: Record<string, { tono: Tono; texto: string }> = {
  'mp-ok': { tono: 'verde', texto: 'Pago recibido. Tu suscripción quedó al día.' },
  'mp-pendiente': { tono: 'amarillo', texto: 'Estamos confirmando tu pago con MercadoPago. Si ya pagaste, se acreditará en unos minutos.' },
  'webpay-ok': { tono: 'verde', texto: 'Pago recibido. Tu suscripción quedó al día.' },
  'webpay-fallido': { tono: 'rojo', texto: 'El pago con Webpay no se completó. No se realizó ningún cobro.' },
  'webpay-abortado': { tono: 'gris', texto: 'Cancelaste el pago. No se realizó ningún cobro.' },
}

const ESTADO_PAGO: Record<string, { tono: Tono; texto: string }> = {
  pendiente: { tono: 'amarillo', texto: 'Pendiente' },
  pagado: { tono: 'verde', texto: 'Pagado' },
  abortado: { tono: 'gris', texto: 'Abortado' },
  revision: { tono: 'rojo', texto: 'En revisión' },
}

const PASARELAS: Record<string, string> = { mercadopago: 'MercadoPago', webpay: 'Webpay' }

export default async function PaginaSuscripcion({
  searchParams,
}: {
  searchParams: Promise<{ resultado?: string }>
}) {
  const { activa } = await obtenerEmpresaActiva()
  if (!activa) return <Encabezado titulo="Sin organización activa" />

  const supabase = await crearClienteServidor()

  // Guard rol dueño/admin de la ORG — patrón real del repo (importar.ts): query de
  // `miembros` filtrada por el usuario actual. app.tiene_rol vive en el schema `app`,
  // que el Data API no expone, así que no se llama por .rpc().
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data: miembro } = user
    ? await supabase
        .from('miembros')
        .select('rol')
        .eq('organizacion_id', activa.organizacion_id)
        .eq('usuario_id', user.id)
        .eq('estado', 'activo')
        .maybeSingle()
    : { data: null }
  if (!miembro || (miembro.rol !== 'dueno' && miembro.rol !== 'admin')) {
    return (
      <div>
        <Encabezado titulo="Suscripción" />
        <Tarjeta className="max-w-2xl">
          <p className="text-sm text-slate-600">Solo el dueño o el administrador de la organización pueden gestionar la suscripción.</p>
        </Tarjeta>
      </div>
    )
  }

  const [{ data: org }, { data: suscripcion }, { data: pagos }] = await Promise.all([
    supabase
      .from('organizaciones')
      .select('razon_social, estado, trial_hasta, planes (nombre, precio_clp)')
      .eq('id', activa.organizacion_id)
      .single(),
    supabase.from('suscripciones').select('hasta').eq('organizacion_id', activa.organizacion_id).maybeSingle(),
    supabase
      .from('pagos_suscripcion')
      .select('id, creado_en, pasarela, monto, estado')
      .eq('organizacion_id', activa.organizacion_id)
      .order('creado_en', { ascending: false }),
  ])

  const plan = org?.planes
  const hasta = suscripcion?.hasta ?? null
  const hoy = new Date().toISOString().slice(0, 10)
  const vencida = hasta !== null && hasta < hoy

  const { resultado } = await searchParams
  const banner = resultado ? BANNERS[resultado] : undefined

  return (
    <div>
      <Encabezado titulo="Suscripción" />

      {banner && (
        <div className="mb-4">
          <Insignia tono={banner.tono}>{banner.texto}</Insignia>
        </div>
      )}

      <Tarjeta className="mb-4 max-w-2xl">
        <h2 className="mb-2 text-lg font-semibold text-slate-800">{org?.razon_social}</h2>
        <dl className="grid grid-cols-1 gap-1 text-sm text-slate-600 sm:grid-cols-2">
          <div>Plan: <span className="font-medium text-slate-800">{plan?.nombre ?? '—'}</span></div>
          <div>Precio mensual: <span className="font-medium text-slate-800">{plan ? formatearCLP(plan.precio_clp) : '—'}</span></div>
        </dl>
        <div className="mt-3">
          {org?.estado === 'trial' && <Insignia tono="amarillo">Período de prueba hasta el {fmtFecha(org.trial_hasta)}</Insignia>}
          {org?.estado === 'suspendida' && <Insignia tono="rojo">Organización suspendida. Contáctanos para reactivarla.</Insignia>}
          {org?.estado === 'activa' && !vencida && <Insignia tono="verde">Activa hasta el {fmtFecha(hasta)}</Insignia>}
          {org?.estado === 'activa' && vencida && <Insignia tono="rojo">Vencida el {fmtFecha(hasta)}</Insignia>}
        </div>
      </Tarjeta>

      {plan && plan.precio_clp > 0 ? (
        <Tarjeta className="mb-4 max-w-2xl">
          <h3 className="mb-1 text-sm font-medium text-slate-700">Pagar 1 mes</h3>
          <p className="mb-4 text-sm text-slate-600">
            Extiende tu suscripción un mes ({formatearCLP(plan.precio_clp)}). Elige un medio de pago.
          </p>
          <FormularioPagarSuscripcion accion={pagarSuscripcion} />
        </Tarjeta>
      ) : (
        <Tarjeta className="mb-4 max-w-2xl">
          <p className="text-sm text-slate-600">Tu plan actual no requiere pago.</p>
        </Tarjeta>
      )}

      <Tarjeta className="max-w-2xl">
        <h3 className="mb-3 text-sm font-medium text-slate-700">Historial de pagos</h3>
        {(pagos ?? []).length === 0 ? (
          <p className="text-sm text-slate-400">Aún no hay pagos registrados.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="pb-2 font-medium">Fecha</th>
                <th className="pb-2 font-medium">Medio</th>
                <th className="pb-2 font-medium">Monto</th>
                <th className="pb-2 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody>
              {(pagos ?? []).map((p) => {
                const est = ESTADO_PAGO[p.estado] ?? { tono: 'gris' as Tono, texto: p.estado }
                return (
                  <tr key={p.id} className="border-t border-slate-100">
                    <td className="py-2">{new Date(p.creado_en).toLocaleDateString('es-CL')}</td>
                    <td className="py-2">{PASARELAS[p.pasarela] ?? p.pasarela}</td>
                    <td className="py-2 tabular-nums">{formatearCLP(p.monto)}</td>
                    <td className="py-2"><Insignia tono={est.tono}>{est.texto}</Insignia></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Tarjeta>
    </div>
  )
}
```

- [ ] **Step 4: Tarjeta "Suscripción" en `/configuracion`**

En `apps/erp/app/configuracion/page.tsx`, añadir un `<Link>` más DENTRO del `grid` existente (después de la tarjeta de Módulos):

```tsx
        <Link href="/configuracion/suscripcion" className="block">
          <Tarjeta className="h-full transition hover:border-marca-500">
            <h2 className="mb-1 text-lg font-semibold text-slate-800">Suscripción</h2>
            <p className="text-sm text-slate-600">Estado de tu plan y pago mensual con MercadoPago o Webpay.</p>
          </Tarjeta>
        </Link>
```

- [ ] **Step 5: Columna "Suscrita hasta" en el admin (3002)**

En `apps/admin/app/page.tsx`: (a) agregar `suscripciones (hasta)` al `select`; (b) un `<th>` tras "Trial hasta"; (c) un `<td>` que toma `[0]` del ARRAY que PostgREST devuelve (con el `unique (organizacion_id)` nuevo es a lo más una fila).

El `select` pasa de:

```ts
    .select('id, rut, razon_social, estado, trial_hasta, creado_en, planes (nombre)')
```

a:

```ts
    .select('id, rut, razon_social, estado, trial_hasta, creado_en, planes (nombre), suscripciones (hasta)')
```

El `<thead>` gana una cabecera tras "Trial hasta":

```tsx
            <th align="left">Trial hasta</th>
            <th align="left">Suscrita hasta</th>
            <th align="left">Acciones</th>
```

Y cada fila, un `<td>` tras el de `trial_hasta` (el embed es un ARRAY → `[0]`; sin fila o `hasta` null → guion, formato es-CL):

```tsx
              <td>{new Date(org.trial_hasta + 'T00:00:00').toLocaleDateString('es-CL')}</td>
              <td>
                {org.suscripciones?.[0]?.hasta
                  ? new Date(org.suscripciones[0].hasta + 'T00:00:00').toLocaleDateString('es-CL')
                  : '—'}
              </td>
```

- [ ] **Step 6: Documentar la config de plataforma en `.env.example`**

Anexar al FINAL de `apps/erp/.env.example` (tras la línea `PASARELA_PAGOS=mock`), sin tocar lo existente:

```
# ============ Suscripción del SaaS (Plan 14) — cobro ORGANIZACIÓN → PLATAFORMA ============
# Credenciales de la PLATAFORMA (NO las de MercadoPago por-empresa del Plan 13).
# Server-only: JAMÁS en BD ni en el cliente. Fail-closed: sin PASARELA_SUSCRIPCIONES
# válido los botones muestran "Los pagos de suscripción no están disponibles todavía".
# En modo mock: PASARELA_SUSCRIPCIONES=mock, MP_PLATAFORMA_WEBHOOK_SECRET=mock (el simulador
# postea con CABECERA_FIRMA_MOCK y el webhook mock la acepta) y MP_PLATAFORMA_ACCESS_TOKEN
# cualquier valor no vacío (el mock lo ignora); las TBK_* pueden quedar vacías.
PASARELA_SUSCRIPCIONES=          # mock | real (ausente u otro valor = pagos deshabilitados)
MP_PLATAFORMA_ACCESS_TOKEN=      # Access Token de la cuenta MercadoPago de la plataforma
MP_PLATAFORMA_WEBHOOK_SECRET=    # Clave del webhook (firma x-signature). En modo mock DEBE valer 'mock'
TBK_COMMERCE_CODE=               # Código de comercio Webpay Plus
TBK_API_KEY=                     # API key secreta de Webpay Plus
TBK_AMBIENTE=                    # integracion | produccion (obligatorio en modo real; fail-closed)

# Para probar Webpay real sin convenio: credenciales PÚBLICAS de integración de
# Transbank (transbankdevelopers.cl), con TBK_AMBIENTE=integracion:
#   TBK_COMMERCE_CODE=597055555532
#   TBK_API_KEY=579B532A7440BB0C9079DED94D31EA1615BACEB56610332264630D42D0A36B1C

# Conciliación manual (excepcional; la doble vía webhook+retorno la evita): si una org
# reporta "pagué y no se activó" y el pago figura pendiente/revision, busca su buy_order
# en el panel MP / portal Transbank; si el cobro existe, ejecútalo como service_role:
#   select confirmar_pago_suscripcion('<pago_id>', '<referencia>', <monto>);
```

- [ ] **Step 7: Verificar (build 3 apps)**

Run: `pnpm build --concurrency=1` → 3 apps compilan (erp con la página/action/componente nuevos; admin con la columna; web sin cambios). OJO: el build pisa el `.next` de los dev servers → reiniciar `pnpm --filter erp dev` ANTES del click-through de la Task 7.

Type-check puntual del ERP (sin levantar server): `pnpm --filter erp exec tsc --noEmit` → sin errores (la action referencia `crear_pago_suscripcion` y `pagos_suscripcion` de los tipos regenerados en la Task 4; los selectores y `armarReferenciaSuscripcion` de `@suite/pagos`).

Byte-scan de los archivos nuevos/tocados (JAMÁS BOM U+FEFF; `\xEF\xBB\xBF` es la secuencia de bytes, no un literal en el archivo):

```
grep -lc $'\xEF\xBB\xBF' apps/erp/app/configuracion/suscripcion/page.tsx apps/erp/app/configuracion/suscripcion/acciones.ts apps/erp/componentes/formulario-pagar-suscripcion.tsx apps/erp/app/configuracion/page.tsx apps/admin/app/page.tsx apps/erp/.env.example
```

→ ninguna coincidencia (exit 1) = pass; sin líneas impresas.

- [ ] **Step 8: Commit**

```bash
git add apps/erp/app/configuracion/suscripcion apps/erp/componentes/formulario-pagar-suscripcion.tsx apps/erp/app/configuracion/page.tsx apps/admin/app/page.tsx apps/erp/.env.example
git commit -m "feat(erp): página de suscripción con pago MP/Webpay y columna admin"
```

---

### Task 7: Pipeline + verificación integral (E2E de datos + checklist HTTP)

**Files:** ninguno de producción (script y comandos en scratchpad, se borran al cerrar).

- [ ] **Step 1: Pipeline**

Run: `pnpm --filter @suite/db gen` — commitear solo si hay diff (`chore(db): tipos regenerados`; ya regenerados en la Task 4, aquí es verificación).
Run: `pnpm test` — **163 tests** (core 126 incl. tct; auth 2; dte 10; **pagos 25**: los 14 del Plan 13 + 11 nuevos → webpay 6 [crear/confirmar contra MockWebpay, headers `Tbk-*` con fetch interceptado, no-logging con serialización de objetos, re-commit lanza limpio], referencia-suscripción 3 [round-trip + malformadas], selectores fail-closed 2).
Run: `pnpm supabase test db` — **269 asserts** (los 13 archivos previos suman 242 + `suscripciones_pago.test.sql` `plan(27)`), todos verdes.
Run: `pnpm build --concurrency=1` — 3 apps. OJO: el build pisa el `.next` de los dev servers → reiniciar `pnpm --filter erp dev` ANTES del click-through del Step 3.

- [ ] **Step 2: E2E de capa de datos (script Node en scratchpad)**

**Partición explícita de la verificación** — la pieza central (webhook + retornos) son route handlers HTTP, no RPCs; se parte en 3 capas sin hueco:

- **(a) Capa de datos y de dinero** (crear → confirmar → extensión → org activa, idempotencia, revisión, abortar, confirmar-gana-abortado, extensión desde trial y desde `hasta` futuro, aislamiento cross-org) → ESTE script. `confirmar_pago_suscripcion`/`abortar_pago_suscripcion` son **service_role**: el script las llama con el admin client vía `.rpc()` — réplica EXACTA de lo que el webhook/retorno hacen tras verificar firma o commitear el token. `crear_pago_suscripcion` es authenticated: se llama con la sesión del dueño. Así el spec §8 (todo el ciclo de dinero) queda cubierto SIN HTTP.
- **(b) El HTTP real** (webhook de plataforma + retorno-mp con lookup + retorno Webpay con commit + auto-POST del client component + simulador mock) → click-through manual del Step 3 (un script Node no forja la sesión SSR, ni el auto-POST del navegador, ni el commit contra Transbank).
- **(c) Firma x-signature de MP, `armar/parsearReferenciaSuscripcion`, headers `Tbk-*` y "el adaptador no loguea secretos"** → ya cubiertos por los 11 unit nuevos de `packages/pagos` (verdes en Step 1).

**Riesgo aceptado (documentado):** el mapeo HTTP 200/500 de los route handlers (spec §5) se cubre por el checklist manual del Step 3 + los unit de firma/adaptadores de `packages/pagos`; el repo NO levanta un servidor HTTP en CI, así que NO se agregan tests HTTP automatizados de los routes — **mismo riesgo aceptado del Plan 13**.

Patrón de siempre (`createRequire` sobre `packages/auth/package.json`; usuarios reales vía `admin.auth.admin.createUser` + `registrar_organizacion` como authenticated; RUT org1 `999999999` y org2 `888888888` — NO fixtures ni demo). `registrar_organizacion` asigna el plan **Básico** (`precio_clp = 29990`), deja la org en `trial` con `trial_hasta = current_date + 14` y una `suscripcion` con `hasta = null`: la extensión feliz parte DESDE el trial.

**Sombra deliberada del stand-in (documentada, no hueco):** el script no crea preferencias ni transacciones (no consulta MP/Transbank); confirma directo con `confirmar_pago_suscripcion` pasando la referencia y el monto que en producción vienen del payment consultado (MP) o del commit (Webpay) — fiel, porque la RPC no consulta la pasarela: valida y persiste.

`scratchpad/e2e-suscripciones.js`:

```js
// E2E capa de datos del Plan 14. Ejecutar desde la raíz del repo con el stack local
// arriba (`pnpm supabase start`):
//   SERVICE_ROLE_KEY=... ANON_KEY=... node <scratchpad>/e2e-suscripciones.js
// (ambas keys salen de `pnpm supabase status`). Borra sus propios datos al final.
const { createRequire } = require('node:module')
const { randomUUID } = require('node:crypto')
const path = require('node:path')
const req = createRequire(path.join(process.cwd(), 'packages/auth/package.json'))
const { createClient } = req('@supabase/supabase-js')

const URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321'
const ANON = process.env.ANON_KEY
const SERVICE = process.env.SERVICE_ROLE_KEY
if (!ANON || !SERVICE) throw new Error('Faltan ANON_KEY / SERVICE_ROLE_KEY (ver pnpm supabase status)')

const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } })

let ok = 0
function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT FALLÓ: ' + msg)
  ok++
  console.log('  ok ' + ok + ': ' + msg)
}

// Espejo de (date + interval '1 month')::date de Postgres: mismo día del mes
// siguiente, con clamp al último día cuando no existe (31 ene -> 28/29 feb).
function masUnMes(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  const ultimo = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  return new Date(Date.UTC(y, m, Math.min(d, ultimo))).toISOString().slice(0, 10)
}

async function crearUsuarioOrg(email, rut) {
  const { data: u, error: eu } = await admin.auth.admin.createUser({ email, password: 'secret1234', email_confirm: true })
  if (eu) throw eu
  const cli = createClient(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } })
  const { error: es } = await cli.auth.signInWithPassword({ email, password: 'secret1234' })
  if (es) throw es
  const { data: org, error: eo } = await cli.rpc('registrar_organizacion', { p_rut: rut, p_razon_social: 'E2E ' + rut })
  if (eo) throw eo
  return { userId: u.user.id, orgId: org, cli }
}

async function hastaDe(orgId) {
  const { data } = await admin.from('suscripciones').select('hasta').eq('organizacion_id', orgId).single()
  return data.hasta
}

async function main() {
  const o1 = await crearUsuarioOrg('e2e-sub-1@example.com', '999999999')
  const o2 = await crearUsuarioOrg('e2e-sub-2@example.com', '888888888')
  const { data: orgRow } = await admin.from('organizaciones').select('trial_hasta').eq('id', o1.orgId).single()
  const trialHasta = orgRow.trial_hasta

  // --- Crear (feliz, MP): pendiente, 29990, buy_order de 25 chars ---
  const { data: c1, error: e1 } = await o1.cli.rpc('crear_pago_suscripcion', { p_organizacion: o1.orgId, p_pasarela: 'mercadopago' })
  if (e1) throw e1
  const pago1 = c1.id
  assert(typeof c1.buy_order === 'string' && c1.buy_order.length === 25, 'crear devuelve buy_order de 25 chars')
  let p = (await admin.from('pagos_suscripcion').select('estado, monto, pasarela').eq('id', pago1).single()).data
  assert(p.estado === 'pendiente' && p.monto === 29990 && p.pasarela === 'mercadopago', 'pago1 pendiente / 29990 / mercadopago')

  // --- Confirmar: extiende DESDE trial_hasta + org activa ---
  const { data: r1, error: er1 } = await admin.rpc('confirmar_pago_suscripcion', { p_pago: pago1, p_referencia: 'mp:PMT-1', p_monto: 29990 })
  if (er1) throw er1
  assert(r1 === 'extendido', 'confirmar pago1 -> extendido')
  const hasta1 = masUnMes(trialHasta)
  assert((await hastaDe(o1.orgId)) === hasta1, 'hasta = trial_hasta + 1 mes (extiende desde el trial)')
  assert((await admin.from('organizaciones').select('estado').eq('id', o1.orgId).single()).data.estado === 'activa', 'org1 quedó activa')
  p = (await admin.from('pagos_suscripcion').select('estado, referencia_externa').eq('id', pago1).single()).data
  assert(p.estado === 'pagado' && p.referencia_externa === 'mp:PMT-1', 'pago1 pagado con referencia mp:PMT-1')

  // --- Idempotencia: reconfirmar mismo pago -> noop, sin mover hasta ---
  assert((await admin.rpc('confirmar_pago_suscripcion', { p_pago: pago1, p_referencia: 'mp:PMT-1', p_monto: 29990 })).data === 'noop', 'reconfirmar -> noop')
  assert((await hastaDe(o1.orgId)) === hasta1, 'hasta sin cambios tras el noop')

  // --- Greatest desde hasta futuro (Webpay): extiende sobre hasta1, no sobre hoy ---
  const { data: c2 } = await o1.cli.rpc('crear_pago_suscripcion', { p_organizacion: o1.orgId, p_pasarela: 'webpay' })
  assert((await admin.rpc('confirmar_pago_suscripcion', { p_pago: c2.id, p_referencia: 'tbk:TKN-2', p_monto: 29990 })).data === 'extendido', 'confirmar pago2 (webpay) -> extendido')
  const hasta2 = masUnMes(hasta1)
  assert((await hastaDe(o1.orgId)) === hasta2, 'greatest tomó el hasta futuro: hasta1 + 1 mes')

  // --- Revisión (monto != stored): marca revision, guarda referencia, NO extiende ---
  const { data: c3 } = await o1.cli.rpc('crear_pago_suscripcion', { p_organizacion: o1.orgId, p_pasarela: 'mercadopago' })
  assert((await admin.rpc('confirmar_pago_suscripcion', { p_pago: c3.id, p_referencia: 'mp:PMT-3', p_monto: 999 })).data === 'revision', 'monto != -> revision')
  p = (await admin.from('pagos_suscripcion').select('estado, referencia_externa').eq('id', c3.id).single()).data
  assert(p.estado === 'revision' && p.referencia_externa === 'mp:PMT-3', 'pago3 en revision con referencia guardada')
  assert((await hastaDe(o1.orgId)) === hasta2, 'revision NO extiende la suscripción')

  // --- Abortar + confirmar-gana-abortado (plata real cobrada gana sobre la anulación) ---
  const { data: c4 } = await o1.cli.rpc('crear_pago_suscripcion', { p_organizacion: o1.orgId, p_pasarela: 'webpay' })
  const { error: eab } = await admin.rpc('abortar_pago_suscripcion', { p_pago: c4.id })
  if (eab) throw eab
  assert((await admin.from('pagos_suscripcion').select('estado').eq('id', c4.id).single()).data.estado === 'abortado', 'abortar pendiente -> abortado')
  assert((await admin.rpc('confirmar_pago_suscripcion', { p_pago: c4.id, p_referencia: 'tbk:TKN-4', p_monto: 29990 })).data === 'extendido', 'confirmar del abortado -> extendido (gana la plata real)')
  assert((await admin.from('pagos_suscripcion').select('estado').eq('id', c4.id).single()).data.estado === 'pagado', 'pago4 quedó pagado (no degradado)')
  assert((await hastaDe(o1.orgId)) === masUnMes(hasta2), 'confirmar del abortado sí extiende')

  // --- Pago inexistente ---
  const e12 = (await admin.rpc('confirmar_pago_suscripcion', { p_pago: randomUUID(), p_referencia: 'x', p_monto: 29990 })).error
  assert(e12 && /El pago no existe/.test(e12.message), 'confirmar pago inexistente -> "El pago no existe"')

  // --- Rol: un dueño ajeno no crea pago de otra org ---
  const e13 = (await o2.cli.rpc('crear_pago_suscripcion', { p_organizacion: o1.orgId, p_pasarela: 'mercadopago' })).error
  assert(e13 && /Tu rol no permite pagar la suscripción/.test(e13.message), 'org2 no crea pago de org1 -> mensaje de rol')

  // --- Cross-org RLS: org2 no ve los pagos de org1 ---
  const ajenos = (await o2.cli.from('pagos_suscripcion').select('id').eq('organizacion_id', o1.orgId)).data
  assert((ajenos ?? []).length === 0, 'org2 no ve pagos_suscripcion de org1 (RLS del invoker)')

  console.log('\n' + ok + ' aserciones de datos verdes\n')

  // --- Cleanup FK-safe (cada delete -> count 0), en orden de dependencia ---
  const orgs = [o1.orgId, o2.orgId]
  for (const tabla of ['pagos_suscripcion', 'suscripciones', 'empresas', 'miembros', 'organizaciones']) {
    const col = tabla === 'organizaciones' ? 'id' : 'organizacion_id'
    await admin.from(tabla).delete().in(col, orgs)
    const { count } = await admin.from(tabla).select('*', { count: 'exact', head: true }).in(col, orgs)
    assert((count ?? 0) === 0, 'cleanup ' + tabla + ' -> 0')
  }
  await admin.auth.admin.deleteUser(o1.userId)
  await admin.auth.admin.deleteUser(o2.userId)
  console.log('cleanup completo (' + ok + ' asserts totales)')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
```

Cubre los 14 escenarios del spec §8 en **20 aserciones de datos + 5 de cleanup**. Si alguna falla: defecto real → **BLOCKED** con detalle.

- [ ] **Step 3: Click-through del flujo completo HTTP (webhook + retornos + simulador + auto-POST)**

Checklist (browser + dev server en modo mock; documentar el resultado de CADA ítem en el reporte). Poner `PASARELA_SUSCRIPCIONES=mock` en `apps/erp/.env.local` y reiniciar `pnpm --filter erp dev` (puerto 3001) tras el build.

1. **Config mock + acceso**: login demo `demo@suite-erp.cl` / `demo1234` como **dueño** (resembrar si la demo está vencida — es perecible). `/configuracion` muestra la tarjeta **Suscripción**; abrirla → estado de la org (trial/activa/vencida/suspendida), plan y precio CLP, historial vacío o previo.
2. **Pagar con MercadoPago (mock) → el webhook confirma**: botón **Pagar 1 mes con MercadoPago** → la action (modo mock) redirige DIRECTO a `/mock-pago-suscripcion/{pagoId}?metodo=mercadopago` (sin crear preferencia) → **Aprobar pago MercadoPago** → la Server Action `registrarPagoMock` + POST con `CABECERA_FIRMA_MOCK` al webhook `/api/webhooks/suscripciones/mercadopago` → la RPC extiende y activa → redirige a `/configuracion/suscripcion?resultado=mp-ok`: banner `mp-ok`, la org queda **Activa hasta** un mes más adelante y el pago aparece **Pagado** en el historial.
3. **Pagar con Webpay (mock) → retorno commitea**: botón **Pagar 1 mes con Webpay** → la action (modo mock) redirige DIRECTO a `/mock-pago-suscripcion/{pagoId}?metodo=webpay` → **Aprobar pago Webpay** → la Server Action llama `webpaySuscripciones('mock').crear` (siembra el store del MockWebpay, token determinista `'mock-tbk-'+buyOrder`) y redirige a `/api/pagos-suscripcion/retorno?token_ws=...` → el retorno commitea (`MockWebpay.confirmar`) → banner `webpay-ok`, historial con el pago Webpay **Pagado**, `hasta` +1 mes sobre el anterior. (El auto-POST del client component de la Task 6 queda SOLO para el flujo Webpay REAL.)
4. **Refresh del retorno = idempotente**: recargar la URL de retorno de Webpay (re-commit del token ya commiteado, que Transbank rechaza) → **NO duplica ni degrada**: la página muestra el estado real de BD (sin banner o el que corresponda), un solo pago `pagado`.
5. **Anulación Webpay (`TBK_TOKEN`)**: repetir el flujo Webpay y en el simulador elegir **anular** → el retorno llega con `TBK_TOKEN` → `abortar_pago_suscripcion` → banner `webpay-abortado`; el pago figura **Abortado** y `hasta` NO cambia.
6. **retorno-mp con webhook "caído" (la doble vía funciona)**: aprobar un pago MP en el simulador SIN dejar que el webhook confirme (simular su caída), luego navegar al `back_url` `/api/pagos-suscripcion/retorno-mp?payment_id=...` → el lookup `obtenerPago` server-side confirma igual → org activa, pago **Pagado**, banner `mp-ok` (segunda vía de confirmación cerrada).
7. **Firma inválida MP → sin efectos**: POST manual al webhook con `x-signature` basura (PowerShell: `Invoke-WebRequest -Method POST -Uri "http://localhost:3001/api/webhooks/suscripciones/mercadopago" -Headers @{'x-signature'='ts=1,v1=deadbeef'} -Body '{"data":{"id":"1"}}'`) → **HTTP 200** y `/configuracion/suscripcion` SIN cambios (ningún pago nuevo); log de alerta server-side.
8. **Vendedor no ve botones**: login como **vendedor** de la misma org → `/configuracion/suscripcion` muestra el mensaje "Solo el dueño o el administrador…" (sin botones de pago).
9. **Otra org aislada**: como dueño de una **segunda org**, entrar a `/configuracion/suscripcion` → ve su propia suscripción e historial, **cero** filas de la primera org.
10. **Banner de resultados**: visitar la página con cada `?resultado=` (`mp-ok`, `mp-pendiente`, `webpay-ok`, `webpay-fallido`, `webpay-abortado`) → renderiza el banner correcto y con el tono correcto.

- [ ] **Step 4: Reporte y cleanup**

`.superpowers/sdd/task-7-plan14-report.md` con: el pipeline (163 / 269 / 3 builds), las 20 aserciones del script E2E (a) + las 5 de cleanup, y el checklist HTTP (b) ítem por ítem. Borrar del scratchpad `e2e-suscripciones.js` al cerrar (el cleanup del propio script ya dejó ambas orgs y sus usuarios en 0).

---

## Verificación final del plan

- `pnpm test` (**163**: core 126, auth 2, dte 10, pagos 25) + `pnpm supabase test db` (**269**: 242 previos + `suscripciones_pago.test.sql` `plan(27)`) + `pnpm build --concurrency=1` (**3 apps**) verdes.
- Ciclo completo (spec §10): con `PASARELA_SUSCRIPCIONES=mock`, el dueño entra a `/configuracion/suscripcion` y paga 1 mes por **MercadoPago** o **Webpay** vía el simulador → sin intervención del admin la organización queda `activa` con `hasta` un mes más adelante y el pago visible en el historial → **doble vía de confirmación**: el webhook de plataforma (MP) y el retorno con lookup del payment, o el commit síncrono del retorno (Webpay), confirman el mismo pago sin duplicar (idempotencia bajo lock: repetir webhook/retorno da `noop`) → un monto manipulado nunca extiende (va a `revision`, nunca dinero invisible) → una anulación Webpay aborta el pendiente, pero un cobro real gana sobre un pendiente abortado → pagar durante el trial extiende DESDE el fin del trial y sobre un `hasta` futuro usa `greatest` → un vendedor no puede pagar y otra org no ve nada (RLS + guard de rol) → credenciales de plataforma SOLO en env server-side, fail-closed sin la perilla → operando completo con mocks hasta las credenciales reales (MP producción, Webpay integración con las credenciales públicas de Transbank).
- **Riesgo aceptado**: los route handlers HTTP (webhook de plataforma, retorno-mp, retorno Webpay) no corren en CI (el repo no levanta servidor); quedan cubiertos por el checklist manual del Step 3 + los unit de firma/adaptadores de `packages/pagos` — mismo trato que el Plan 13.
- Criterio de éxito del spec §10 cumplido.

