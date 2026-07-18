# Rubros de empresa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute this plan task-by-task with fresh subagents, or superpowers:executing-plans when running it in a dedicated session. Read the Global Constraints before ANY task.

**Goal:** Al crear la cuenta, la Pyme declara su rubro (`negocio` | `transporte`) con tarjetas visuales en el registro; el rubro pasa a ser la única fuente de verdad de los módulos habilitados y solo el admin de plataforma (panel 3002) puede cambiarlo después vía `cambiar_rubro`.

**Architecture:** Migración 0023 agrega `empresas.rubro` (CHECK + backfill desde `modulo_transporte`), conserva `modulo_transporte` como flag derivado no escribible por `authenticated` (grants de UPDATE **e INSERT** re-emitidos por columnas), y concentra el mapping rubro→módulos en dos RPCs: `registrar_organizacion(p_rut, p_razon_social, p_rubro default 'negocio')` y `cambiar_rubro(p_empresa, p_rubro)` solo service_role. Las 3 apps consumen la constante compartida `RUBROS` de `@suite/core`.

**Tech Stack:** Postgres/Supabase local (migraciones SQL + pgTAP), monorepo pnpm/turbo con Next.js (apps web 3000, erp 3001, admin 3002), TypeScript compartido en `packages/core` y `packages/db`, seed demo en `scripts/seed-demo.mjs`, E2E manual con Playwright MCP.

Spec: `docs/superpowers/specs/2026-07-18-rubros-empresa-design.md`.

## Global Constraints

- **Mensajes byte-exactos** (no parafrasear, no cambiar tildes):
  - BD: `'Rubro no válido'` y `'Empresa no encontrada'` (ambas RPCs).
  - Web: `'Elige el rubro de tu Pyme'` (validación fail-closed del registro).
- **Invariante:** `modulo_transporte = (rubro = 'transporte')` en TODA fila. Solo existen DOS vías de escritura y ambas setean los dos campos juntos: `registrar_organizacion` (registro) y `cambiar_rubro` (service_role-only, panel admin). Ningún otro código escribe `modulo_transporte` ni `rubro` — los grants de 0023 (UPDATE **e INSERT** por columnas, ambos re-emitidos sin esos campos) lo hacen imposible para `authenticated` (42501), también en filas nuevas.
- **`RUBROS` de `@suite/core` es la ÚNICA fuente de etiquetas** (código, nombre, descripción) en las 3 apps. Prohibido hardcodear nombres de rubro en la UI.
- **Prohibido el BOM U+FEFF** en cualquier archivo creado o modificado (SQL, TS, TSX). Cada task con archivos nuevos verifica los primeros bytes.
- **Copy es-CL** en toda la UI y mensajes.
- **Conteos contractuales:** tras Task 2 la suite pgTAP queda en **327 asserts en 17 archivos** (315 baseline + 12 nuevos) — ese es el total que TODO el plan cita, incluido el pipeline de Task 7. Unit tests: **176, sin cambios** (ninguna task agrega unit tests). Builds: las **3 apps** compilan.
- **NO tocar** `apps/erp/lib/empresa-activa.ts` ni el NAV: `EmpresaResumen` y el layout siguen leyendo `modulo_transporte` (flag derivado). Tampoco tocar `apps/web/app/registro/exito/page.tsx` ni `PanelContabilidad`.
- **Reiniciar los dev servers tras cada `pnpm build`** (gotcha del repo: el build pisa los `.next` de los dev servers en 3000-3002 → 500s hasta reiniciar).

## Contexto verificado en el repo (no repetir esta investigación al ejecutar)

- Grants de `update` sobre `public.empresas` para `authenticated` vigentes hoy (grep en TODAS las migraciones): 0016:21-22 (revoke total + grant de 14 columnas, incluye `modulo_transporte`) **más** 0018:22 (`mp_access_token_cifrado`, `mp_webhook_secret_cifrado`). Total vigente: 16 columnas. Como `revoke update on public.empresas from authenticated` borra TODOS los grants de update (también los de 0018), el grant re-emitido debe listar las 15 columnas finales: las 16 vigentes menos `modulo_transporte` (y sin `rubro`, que nunca lo tuvo).
- Grant de `insert` sobre `public.empresas` para `authenticated`: sigue siendo el de TABLA completa de 0001:135 (`grant select, insert, update on public.empresas to authenticated`) — nunca se revocó ni se acotó por columnas (grep en las 22 migraciones). Como un grant de tabla cubre columnas futuras, sin re-emitirlo un dueño podría INSERTAR una empresa nueva con `modulo_transporte`/`rubro` a gusto vía PostgREST (la policy `"duenos crean empresas"` de 0001:113-115 se lo permite en su propia org) y romper el invariante o auto-otorgarse el módulo transporte. Por eso 0023 también re-emite el INSERT por columnas. OJO: NO revocar el insert a secas — `aislamiento.test.sql:55-61` espera que el insert cruzado de Ana falle con el mensaje de RLS (`new row violates row-level security policy for table "empresas"`); con revoke total fallaría antes con `permission denied for table empresas` y ese assert se rompería. El grant por columnas mantiene el privilegio (y el mensaje de RLS) intacto. Ningún código de apps ni el seed inserta `empresas` como `authenticated` (grep: solo selects/updates; los fixtures pgTAP insertan como superuser antes de `set local role`; el seed usa service_role; `registrar_organizacion` es security definer owner postgres).
- `registrar_organizacion(text, text)` vigente: 0002:39-90 (cuerpo copiado verbatim en Task 1).
- `service_role` tiene grant completo sobre `empresas` desde 0001:139 (`grant select, insert, update, delete on all tables in schema public to service_role`), y `bypassrls`: los asserts de Task 2 bajo `service_role` leen `empresas` sin fixture extra.
- `transporte.test.sql:91` y `:111` hacen `update public.empresas set modulo_transporte = ...` con rol `authenticated` (Ana). Tras 0023 fallan con 42501 y abortan el archivo → Task 2 los parchea con el patrón `reset role` que el mismo archivo ya usa en la línea 690. Sus 59 asserts no cambian.
- Contenedor BD local: `supabase_db_ERP_Transportes` (project_id `ERP_Transportes` en `supabase/config.toml`).
- Nombre del CHECK inline de columna: convención `tabla_columna_check` → `empresas_rubro_check` (misma convención confirmada en 0022 para `documentos_venta_total_check`).

### RUTs nuevos para pgTAP (módulo 11, sin colisión)

RUTs ya ocupados en la suite: 761111116, 762222221, 765432103/4, 763333337, 764444442, 765555558, 766666663, 767777779, 768888884, 761112228, 761234560, 763334449, 762223333, 761212125, 763434346, 764646460, 769010007, 769020002, 769031006, 769040005, 769111115, 769222227, 769333339, 769444440, 769555552, 770000014, 770000022, 777000012..777000071, 123456785, 123456780, 111111111, 222222222. Seed (`scripts/seed-demo.mjs`): 771234569, 778899000, 772506309, 768901201, 965112006, 76455180K, 776803308, 78120450-1. E2E: 999999999, 888888888. El prefijo **7696060x** está libre en todo el repo (grep `7696060` = 0 coincidencias).

Cálculo del dígito verificador (factores 2,3,4,5,6,7,2,3 desde la derecha; DV = 11 − (suma mod 11), 11→'0', 10→'K'):

- Cuerpo **76960601**: 1·2 + 0·3 + 6·4 + 0·5 + 6·6 + 9·7 + 6·2 + 7·3 = 2+0+24+0+36+63+12+21 = **158**; 158 mod 11 = 4; DV = 11−4 = **7** → `76.960.601-7` (normalizado `769606017`).
- Cuerpo **76960602**: 2·2 + 0 + 24 + 0 + 36 + 63 + 12 + 21 = **160**; 160 mod 11 = 6; DV = **5** → `76.960.602-5` (normalizado `769606025`).
- Cuerpo **76960603**: 3·2 + 0 + 24 + 0 + 36 + 63 + 12 + 21 = **162**; 162 mod 11 = 8; DV = **3** → `76.960.603-3` (normalizado `769606033`).

---

### Task 1: Migración 0023 — `empresas.rubro`, backfill, grant endurecido, `registrar_organizacion` con rubro y `cambiar_rubro`

**Files:**
- Create: `supabase/migrations/00000000000023_rubros.sql`

**Interfaces:**
- Consumes: `app.normalizar_rut(text)`, `app.validar_rut(text)` (0002); tablas `organizaciones`, `empresas`, `miembros`, `suscripciones`, `planes` (0001); `auth.uid()`.
- Produces:
  - Columna `public.empresas.rubro text not null default 'negocio'` con `check (rubro in ('negocio','transporte'))` (constraint `empresas_rubro_check`).
  - `public.registrar_organizacion(p_rut text, p_razon_social text, p_rubro text default 'negocio') returns uuid` — security definer, execute solo `authenticated`. Errores nuevos: `'Rubro no válido'`.
  - `public.cambiar_rubro(p_empresa uuid, p_rubro text) returns void` — security definer, execute SOLO `service_role`. Errores: `'Rubro no válido'`, `'Empresa no encontrada'`.
  - Grant de update por columnas de `empresas` re-emitido SIN `modulo_transporte` ni `rubro` (15 columnas).
  - Grant de **insert** por columnas de `empresas` re-emitido SIN `modulo_transporte`, `rubro` ni `modulo_contabilidad` (17 columnas) — cierra la vía INSERT que el grant de tabla de 0001:135 dejaba abierta (cubre columnas futuras), y de paso el mismo hueco pre-existente de `modulo_contabilidad` (0022 tampoco lo tocó).

- [ ] **Step 1: Verificar el estado vivo de los grants de columna (pre-condición de la lista final)**

  ```bash
  docker ps --format '{{.Names}}' | grep supabase_db
  ```

  Salida esperada:

  ```
  supabase_db_ERP_Transportes
  ```

  (Si el nombre difiere, usar el que aparezca en TODOS los comandos `docker exec` siguientes.)

  ```bash
  docker exec -i supabase_db_ERP_Transportes psql -U postgres -d postgres -c "select column_name from information_schema.column_privileges where table_schema='public' and table_name='empresas' and grantee='authenticated' and privilege_type='UPDATE' order by 1;"
  ```

  Salida esperada (16 filas — las 14 de 0016 más las 2 de 0018):

  ```
        column_name
  -------------------------------
   certificado_cifrado
   certificado_password_cifrada
   comuna
   comuna_emisor
   direccion
   direccion_emisor
   dte_api_key_cifrada
   factor_volumetrico
   giro
   giro_emisor
   modulo_transporte
   mp_access_token_cifrado
   mp_webhook_secret_cifrado
   razon_social
   resolucion_sii_fecha
   resolucion_sii_numero
  (16 rows)
  ```

  Si aparece alguna columna extra no listada aquí, DETENERSE y agregarla a la lista del grant del Step 2 (salvo `modulo_transporte` y `rubro`, que quedan fuera a propósito).

- [ ] **Step 2: Escribir la migración completa**

  Crear `supabase/migrations/00000000000023_rubros.sql` con este contenido EXACTO (sin BOM; el cuerpo de `registrar_organizacion` es el de 0002 verbatim + validación de rubro + insert de `empresas` con ambos campos):

  ```sql
  -- Rubros de empresa: la Pyme declara su rubro ('negocio' | 'transporte') al
  -- registrarse y el sistema habilita los modulos correspondientes. El rubro es
  -- la UNICA fuente de verdad; modulo_transporte se conserva como flag DERIVADO
  -- (los ~30 consumidores actuales no se tocan) pero deja de ser escribible por
  -- authenticated: se re-emite el grant de columnas de empresas SIN
  -- modulo_transporte y sin rubro (patron modulo_contabilidad 0022: la columna
  -- solo se mueve por RPC).
  --
  -- Invariante: modulo_transporte = (rubro = 'transporte') en TODA fila —
  -- garantizado porque las unicas dos vias de escritura (registrar_organizacion
  -- y cambiar_rubro) setean ambos campos juntos.

  -- ---------- empresas.rubro + backfill ----------
  -- Agregar un rubro futuro = extender este CHECK en una migracion nueva (mas
  -- las validaciones de las 2 RPCs de abajo y la constante RUBROS de @suite/core).
  alter table public.empresas
    add column if not exists rubro text not null default 'negocio'
      check (rubro in ('negocio', 'transporte'));

  -- Backfill: derivar del flag actual. Nadie gana ni pierde modulos.
  update public.empresas set rubro = 'transporte' where modulo_transporte;

  -- ---------- empresas: re-emision de los grants de columnas ----------
  -- UPDATE: el revoke borra TODOS los grants de update de authenticated (los 14
  -- de 0016 Y los 2 de mercadopago 0018), por eso el grant nuevo re-lista TODO
  -- lo que sigue permitido: la lista vigente MENOS modulo_transporte (solo por
  -- RPC) y sin rubro (nunca lo tuvo). Un update directo de authenticated sobre
  -- modulo_transporte o rubro falla con 42501.
  revoke update on public.empresas from authenticated;
  grant update (razon_social, giro, direccion, comuna, giro_emisor, direccion_emisor, comuna_emisor, resolucion_sii_numero, resolucion_sii_fecha, certificado_cifrado, certificado_password_cifrada, dte_api_key_cifrada, factor_volumetrico, mp_access_token_cifrado, mp_webhook_secret_cifrado) on public.empresas to authenticated;

  -- INSERT: el grant de TABLA de 0001 (select, insert, update) cubria columnas
  -- futuras, asi que un dueno podia insertar una segunda empresa en su org con
  -- modulo_transporte/rubro/modulo_contabilidad a gusto (la policy "duenos crean
  -- empresas" lo permite) y saltarse el control "solo plataforma". Se re-emite
  -- por columnas SIN esos 3 campos custodiados. NO revocar a secas sin re-grant:
  -- aislamiento.test.sql espera el mensaje de RLS en el insert cruzado, y sin
  -- privilegio de insert fallaria antes con "permission denied for table".
  -- Nadie inserta empresas como authenticated en apps/seed (verificado); el
  -- unico camino real es registrar_organizacion (security definer).
  revoke insert on public.empresas from authenticated;
  grant insert (organizacion_id, rut, razon_social, giro, direccion, comuna, giro_emisor, direccion_emisor, comuna_emisor, resolucion_sii_numero, resolucion_sii_fecha, certificado_cifrado, certificado_password_cifrada, dte_api_key_cifrada, factor_volumetrico, mp_access_token_cifrado, mp_webhook_secret_cifrado) on public.empresas to authenticated;

  -- ---------- registrar_organizacion: gana p_rubro (cambia la firma) ----------
  -- DROP + CREATE porque cambia la firma: un create or replace dejaria viva la
  -- version (text, text). El default 'negocio' mantiene compatible cualquier
  -- llamada existente sin el parametro (registro web actual, seed org 2).
  drop function public.registrar_organizacion(text, text);

  create function public.registrar_organizacion(p_rut text, p_razon_social text, p_rubro text default 'negocio')
  returns uuid
  language plpgsql security definer
  set search_path = public
  as $$
  declare
    v_usuario uuid := auth.uid();
    v_rut text;
    v_org uuid;
    v_plan uuid;
  begin
    if v_usuario is null then
      raise exception 'Debes iniciar sesión para registrar una organización';
    end if;
    if not app.validar_rut(p_rut) then
      raise exception 'El RUT ingresado no es válido';
    end if;
    if coalesce(trim(p_razon_social), '') = '' then
      raise exception 'La razón social es obligatoria';
    end if;
    -- Validacion temprana del rubro (el guard "is null" importa: null not in (...)
    -- evalua a null y el if no dispararia; sin el guard, un null reventaria recien
    -- en el not null de la columna con un 23502 criptico).
    if p_rubro is null or p_rubro not in ('negocio', 'transporte') then
      raise exception 'Rubro no válido';
    end if;

    -- Guardar normalizado: la restricción unique compara byte a byte, así que
    -- '76.543.210-3' y '765432103' deben ser la misma fila.
    v_rut := app.normalizar_rut(p_rut);

    select id into v_plan from planes where nombre = 'Básico';
    if v_plan is null then
      raise exception 'No existe el plan Básico; contacta a soporte';
    end if;

    begin
      insert into organizaciones (rut, razon_social, plan_id)
      values (v_rut, trim(p_razon_social), v_plan)
      returning id into v_org;
    exception when unique_violation then
      raise exception 'Ya existe una organización registrada con el RUT %', p_rut;
    end;

    -- Rubro y flag derivado SIEMPRE juntos (invariante de cabecera).
    insert into empresas (organizacion_id, rut, razon_social, rubro, modulo_transporte)
    values (v_org, v_rut, trim(p_razon_social), p_rubro, p_rubro = 'transporte');

    insert into miembros (usuario_id, organizacion_id, rol)
    values (v_usuario, v_org, 'dueno');

    insert into suscripciones (organizacion_id, plan_id)
    values (v_org, v_plan);

    return v_org;
  end $$;

  revoke execute on function public.registrar_organizacion(text, text, text) from anon, public;
  grant execute on function public.registrar_organizacion(text, text, text) to authenticated;

  -- ---------- cambiar_rubro (SOLO service_role: el panel admin 3002) ----------
  -- UNICA via de cambio post-registro; concentra el mapping rubro -> modulos
  -- junto con registrar_organizacion. Cambiar transporte -> negocio solo oculta
  -- el NAV y las paginas de transporte (UX): los datos de flota, entregas,
  -- proformas y combustible quedan intactos y reaparecen si se revierte.
  create function public.cambiar_rubro(p_empresa uuid, p_rubro text)
  returns void
  language plpgsql security definer
  set search_path = public
  as $$
  begin
    if p_rubro is null or p_rubro not in ('negocio', 'transporte') then
      raise exception 'Rubro no válido';
    end if;
    -- Existencia validada por el propio update (found): equivalente al select
    -- previo del diseño pero en una sola pasada y sin ventana TOCTOU.
    update empresas
    set rubro = p_rubro, modulo_transporte = (p_rubro = 'transporte')
    where id = p_empresa;
    if not found then
      raise exception 'Empresa no encontrada';
    end if;
  end $$;

  -- Los tenants no pueden ni verla: execute SOLO para service_role.
  revoke execute on function public.cambiar_rubro(uuid, text) from public, anon, authenticated;
  grant execute on function public.cambiar_rubro(uuid, text) to service_role;
  ```

- [ ] **Step 3: Verificar que el archivo no tiene BOM**

  ```bash
  head -c 3 "supabase/migrations/00000000000023_rubros.sql" | od -An -tx1
  ```

  Salida esperada (los tres primeros bytes son `-- `, JAMÁS `ef bb bf`):

  ```
   2d 2d 20
  ```

- [ ] **Step 4: Validación en vivo — aplicar el SQL con BEGIN…ROLLBACK contra la BD local**

  Desde la raíz del repo (Git Bash; el contenedor es el del Step 1):

  ```bash
  { echo 'begin;'; cat supabase/migrations/00000000000023_rubros.sql; echo 'rollback;'; } | docker exec -i supabase_db_ERP_Transportes psql -U postgres -d postgres -v ON_ERROR_STOP=1
  ```

  Salida esperada (el `UPDATE n` del backfill depende de cuántas empresas tengan `modulo_transporte = true` en la BD local — con la demo sembrada es `UPDATE 1`, con la BD recién reseteada `UPDATE 0`; cualquier ERROR aborta por `ON_ERROR_STOP` y hay que corregir antes de seguir):

  ```
  BEGIN
  ALTER TABLE
  UPDATE 1
  REVOKE
  GRANT
  REVOKE
  GRANT
  DROP FUNCTION
  CREATE FUNCTION
  REVOKE
  GRANT
  CREATE FUNCTION
  REVOKE
  GRANT
  ROLLBACK
  ```

- [ ] **Step 5: Commit**

  ```bash
  git add supabase/migrations/00000000000023_rubros.sql
  git commit -m "feat(db): rubro de empresa — columna con backfill, registro con rubro y cambiar_rubro solo plataforma"
  ```

  Salida esperada: un commit nuevo en la rama de trabajo con 1 archivo creado.

---

### Task 2: pgTAP `rubros.test.sql` (archivo 17) + parche mínimo a `transporte.test.sql`

**Files:**
- Create: `supabase/tests/database/rubros.test.sql`
- Modify: `supabase/tests/database/transporte.test.sql` (2 hunks de setup, líneas ~90-91 y ~110-111; sus 59 asserts no cambian)
- Test: toda la suite pgTAP (`npx supabase test db`)

**Interfaces:**
- Consumes: `public.registrar_organizacion(p_rut text, p_razon_social text, p_rubro text default 'negocio') returns uuid`; `public.cambiar_rubro(p_empresa uuid, p_rubro text) returns void`; columna `empresas.rubro` + constraint `empresas_rubro_check` (todo de Task 1).
- Produces: 12 asserts nuevos → suite total **327 asserts en 17 archivos** (315 + 12). Este total es contractual: Task 7 lo cita tal cual.

Conteo de los 12 asserts (fija `plan(12)`): (1) registrar con rubro transporte, (2) registrar default negocio, (3) rubro inválido al registrar, (4) authenticated no ejecuta `cambiar_rubro`, (5) update directo de `modulo_transporte` denegado, (6) update directo de `rubro` denegado, (7) insert directo con `modulo_transporte` denegado (el grant de INSERT por columnas de 0023), (8) `cambiar_rubro` transporte→negocio mueve ambos campos, (9) `cambiar_rubro` negocio→transporte mueve ambos de vuelta, (10) empresa inexistente, (11) rubro inválido en `cambiar_rubro`, (12) CHECK rechaza valor fuera del catálogo en escritura cruda.

- [ ] **Step 1: Parchear `transporte.test.sql` — los dos toggles de setup pasan a superuser**

  Motivo: las líneas 91 y 111 actualizan `modulo_transporte` con rol `authenticated` (Ana); tras 0023 fallan con 42501 y abortan el archivo. Mismo patrón `reset role` que el propio archivo usa en la línea 690. Ningún assert cambia (siguen siendo 59).

  Hunk 1 — reemplazar EXACTAMENTE esto (líneas 90-91):

  ```sql
  -- Setup: Ana apaga el módulo (el toggle bloquea crear_*; NO borra ni esconde datos).
  update public.empresas set modulo_transporte = false where id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa';
  ```

  por esto:

  ```sql
  -- Setup: módulo off vía superuser (0023: modulo_transporte ya no es escribible
  -- por authenticated — deriva del rubro y solo lo mueve la plataforma). El
  -- toggle bloquea crear_*; NO borra ni esconde datos.
  reset role;
  update public.empresas set modulo_transporte = false where id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa';
  set local role authenticated;
  set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
  ```

  Hunk 2 — reemplazar EXACTAMENTE esto (líneas 110-111 del archivo original):

  ```sql
  -- Setup: módulo de vuelta.
  update public.empresas set modulo_transporte = true where id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa';
  ```

  por esto:

  ```sql
  -- Setup: módulo de vuelta (vía superuser, mismo motivo 0023).
  reset role;
  update public.empresas set modulo_transporte = true where id = 'eeeeeeee-0000-0000-0000-aaaaaaaaaaaa';
  set local role authenticated;
  set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
  ```

  (En ambos puntos el contexto activo era Ana con rol authenticated, así que la restauración deja el archivo exactamente como estaba para las líneas siguientes.)

- [ ] **Step 2: Escribir `supabase/tests/database/rubros.test.sql` completo**

  Contenido EXACTO (sin BOM):

  ```sql
  begin;
  create extension if not exists pgtap with schema extensions;
  select plan(12);

  -- Rita registra sus organizaciones por la RPC (camino real). RUT nuevos, únicos
  -- GLOBALES (módulo 11, cálculo en el plan): 769606017 / 769606025 / 769606033
  -- no aparecen en ningún test, el seed (771234569, 778899000, 772506309,
  -- 768901201, 965112006, 76455180K, 776803308) ni los E2E (999999999, 888888888).
  insert into auth.users (instance_id, id, aud, role, email)
  values ('00000000-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444', 'authenticated', 'authenticated', 'rita@rubros.cl');

  set local role authenticated;
  set local request.jwt.claims to '{"sub": "44444444-4444-4444-4444-444444444444", "role": "authenticated"}';

  -- SETUP (felices sin assert propio, patrón contabilidad: si fallaran, el archivo
  -- entero aborta): registro con rubro explícito y registro sin el parámetro.
  select registrar_organizacion('76.960.601-7', 'Rubros Transporte SpA', 'transporte');
  select registrar_organizacion('76.960.602-5', 'Rubros Negocio SpA');

  -- 1) Registrar con rubro transporte deja AMBOS campos coherentes.
  select is(
    (select rubro || '/' || modulo_transporte from empresas where rut = '769606017'),
    'transporte/true',
    'registrar con rubro transporte enciende rubro y modulo_transporte juntos'
  );

  -- 2) Sin p_rubro rige el default: negocio con el módulo apagado.
  select is(
    (select rubro || '/' || modulo_transporte from empresas where rut = '769606025'),
    'negocio/false',
    'registrar sin rubro usa el default negocio con el módulo apagado'
  );

  -- 3) Rubro fuera del catálogo: rechazo temprano, mensaje byte-exacto.
  select throws_ok(
    $$select registrar_organizacion('76.960.603-3', 'Rubros Inválida SpA', 'minera')$$,
    'P0001', 'Rubro no válido',
    'registrar con un rubro fuera del catálogo es rechazado'
  );

  -- 4) cambiar_rubro es SOLO service_role: authenticated → 42501 (el grant ES el candado).
  select throws_ok(
    $$select cambiar_rubro((select id from empresas where rut = '769606017'), 'negocio')$$,
    '42501', 'permission denied for function cambiar_rubro',
    'authenticated no ejecuta cambiar_rubro (solo la plataforma vía service_role)'
  );

  -- 5) Flip crudo del flag bloqueado: modulo_transporte quedó FUERA del grant por
  --    columnas (Rita es dueña: la RLS de fila pasa, el grant de columna no).
  select throws_ok(
    $$update empresas set modulo_transporte = false where rut = '769606017'$$,
    '42501', 'permission denied for table empresas',
    'ni la dueña puede mover modulo_transporte por escritura directa'
  );

  -- 6) rubro tampoco es escribible en directo.
  select throws_ok(
    $$update empresas set rubro = 'negocio' where rut = '769606017'$$,
    '42501', 'permission denied for table empresas',
    'ni la dueña puede mover rubro por escritura directa'
  );

  -- 7) La vía INSERT también está cerrada: el grant de INSERT por columnas de
  --    0023 no incluye modulo_transporte (ni rubro ni modulo_contabilidad), así
  --    que ni la dueña puede autohabilitarse el módulo creando una 2ª empresa.
  select throws_ok(
    $$insert into empresas (organizacion_id, rut, razon_social, modulo_transporte)
      values ((select organizacion_id from empresas where rut = '769606017'), '769606033', 'Colada SpA', true)$$,
    '42501', 'permission denied for table empresas',
    'ni la dueña puede insertar una empresa con modulo_transporte en directo'
  );

  -- ===== cambiar_rubro (service_role: el panel admin; salta RLS, patrón contabilidad) =====
  set local role service_role;

  -- 8) transporte → negocio mueve AMBOS campos.
  select cambiar_rubro((select id from empresas where rut = '769606017'), 'negocio');
  select is(
    (select rubro || '/' || modulo_transporte from empresas where rut = '769606017'),
    'negocio/false',
    'cambiar_rubro a negocio apaga el módulo junto con el rubro'
  );

  -- 9) negocio → transporte de vuelta: reversible sin pérdida.
  select cambiar_rubro((select id from empresas where rut = '769606017'), 'transporte');
  select is(
    (select rubro || '/' || modulo_transporte from empresas where rut = '769606017'),
    'transporte/true',
    'cambiar_rubro a transporte reenciende el módulo junto con el rubro'
  );

  -- 10) Empresa inexistente: mensaje byte-exacto.
  select throws_ok(
    $$select cambiar_rubro('00000000-0000-0000-0000-000000000099', 'negocio')$$,
    'P0001', 'Empresa no encontrada',
    'cambiar_rubro sobre una empresa inexistente reclama'
  );

  -- 11) Rubro fuera del catálogo también en cambiar_rubro.
  select throws_ok(
    $$select cambiar_rubro((select id from empresas where rut = '769606017'), 'minera')$$,
    'P0001', 'Rubro no válido',
    'cambiar_rubro con un rubro fuera del catálogo es rechazado'
  );

  -- 12) Última línea de defensa: el CHECK rechaza la escritura cruda incluso de
  --     service_role (que sí tiene grant de update completo desde 0001).
  select throws_ok(
    $$update empresas set rubro = 'minera' where rut = '769606017'$$,
    '23514', 'new row for relation "empresas" violates check constraint "empresas_rubro_check"',
    'el CHECK rechaza cualquier rubro fuera del catálogo aun en escritura cruda'
  );

  select * from finish();
  rollback;
  ```

- [ ] **Step 3: Verificar que ninguno de los dos archivos tiene BOM**

  ```bash
  head -c 3 supabase/tests/database/rubros.test.sql | od -An -tx1
  head -c 3 supabase/tests/database/transporte.test.sql | od -An -tx1
  ```

  Salida esperada (dos líneas; `be` = `begin`, `2d 2d 20` = `-- `; JAMÁS `ef bb bf`):

  ```
   62 65 67
   2d 2d 20
  ```

- [ ] **Step 4: Resetear la BD local (aplica 0023) y correr la suite completa**

  ```bash
  npx supabase db reset
  ```

  Salida esperada (fragmento final): la lista de migraciones aplicadas termina con `Applying migration 00000000000023_rubros.sql...` y `Finished supabase db reset`. (Nota: el reset borra la demo local; resembrar con `node scripts/seed-demo.mjs` queda para el cierre del plan, NO en esta task.)

  ```bash
  npx supabase test db
  ```

  Salida esperada: los 17 archivos en verde, `rubros.test.sql` incluido con sus 12 asserts y `transporte.test.sql` intacto con 59 (y `aislamiento.test.sql` intacto con 6: el grant de INSERT por columnas conserva el mensaje de RLS de su assert 5):

  ```
  ./aislamiento.test.sql ........... ok
  ./cobranza.test.sql .............. ok
  ./combustible.test.sql ........... ok
  ./compras.test.sql ............... ok
  ./contabilidad.test.sql .......... ok
  ./correos_enviados.test.sql ...... ok
  ./cotizaciones.test.sql .......... ok
  ./inventario.test.sql ............ ok
  ./maestros.test.sql .............. ok
  ./mercadopago.test.sql ........... ok
  ./por_pagar.test.sql ............. ok
  ./registro.test.sql .............. ok
  ./reportes.test.sql .............. ok
  ./rubros.test.sql ................ ok
  ./suscripciones_pago.test.sql .... ok
  ./transporte.test.sql ............ ok
  ./ventas.test.sql ................ ok
  All tests successful.
  Files=17, Tests=327
  Result: PASS
  ```

  (El orden/alineado exacto del listado lo decide pg_prove; lo que DEBE cumplirse es `Files=17, Tests=327, Result: PASS`.)

- [ ] **Step 5: Commit**

  ```bash
  git add supabase/tests/database/rubros.test.sql supabase/tests/database/transporte.test.sql
  git commit -m "test(db): pgTAP de rubros — registro, cambiar_rubro solo plataforma y candados de columna"
  ```

  Salida esperada: un commit nuevo con 1 archivo creado y 1 modificado.

---

### Task 3: Constante compartida `RUBROS` en @suite/core + tipos de `empresas` y RPCs en @suite/db

> Contexto: spec §4 (constante `RUBROS`) y §2/§3 (columna `rubro` y RPCs). Esta task es solo TypeScript compartido: no toca SQL ni apps. La Task 1 (migración 0023) define `cambiar_rubro` con `returns void` → en tipos generados de Supabase eso es `Returns: undefined`.

**Files:**
- Create: `packages/core/src/rubros.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/db/src/types.ts`
- Test: ninguno nuevo (`RUBROS` es data estática sin lógica; la validación fail-closed se cubre en pgTAP Task 2 y el E2E del cierre)

**Interfaces:**
- Produces (`@suite/core`, re-exportado desde `packages/core/src/index.ts`):
  - `export const RUBROS: readonly [{ codigo: 'negocio'; nombre: 'Negocio'; descripcion: string }, { codigo: 'transporte'; nombre: 'Transporte'; descripcion: string }]` (as const)
  - `export type CodigoRubro = (typeof RUBROS)[number]['codigo']` → `'negocio' | 'transporte'`
- Produces (`@suite/db`, tipos de `Database`):
  - `empresas.Row.rubro: string`; `empresas.Insert.rubro?: string`; `empresas.Update.rubro?: string` (columna `text not null default 'negocio'`, así la genera `supabase gen types`)
  - `Functions.registrar_organizacion: { Args: { p_razon_social: string; p_rubro?: string; p_rut: string }; Returns: string }`
  - `Functions.cambiar_rubro: { Args: { p_empresa: string; p_rubro: string }; Returns: undefined }`
- Consumes: nada nuevo (data estática). Consumidores futuros: tarjetas del registro (web, Task 4), Configuración → Módulos (erp, Task 5), selector del panel admin (Task 6).

- [ ] **Step 1: Crear `packages/core/src/rubros.ts`** con el código EXACTO del spec §4 (sin BOM U+FEFF, UTF-8 plano, como el resto del paquete):

```ts
export const RUBROS = [
  { codigo: 'negocio', nombre: 'Negocio', descripcion: 'Comercio y servicios: ventas, compras, inventario y cobranza' },
  { codigo: 'transporte', nombre: 'Transporte', descripcion: 'Todo lo de Negocio más flota, tarifario, entregas, proformas y combustible' },
] as const
export type CodigoRubro = (typeof RUBROS)[number]['codigo']
```

  Verificar que el archivo nuevo no tiene BOM:

```bash
head -c 3 packages/core/src/rubros.ts | od -An -tx1
```

  Salida esperada (los bytes de `exp` de `export`; JAMÁS `ef bb bf`):

```
 65 78 70
```

- [ ] **Step 2: Re-exportar desde `packages/core/src/index.ts`** (patrón del paquete: un `export *` por archivo, se agrega al final). El archivo queda COMPLETO así:

```ts
export * from './rut'
export * from './iva'
export * from './maestros'
export * from './csv'
export * from './ventas'
export * from './stock'
export * from './compras'
export * from './cobranza'
export * from './periodo'
export * from './cotizaciones'
export * from './transporte'
export * from './tct'
export * from './rubros'
```

- [ ] **Step 3: Agregar `rubro` a `empresas` en `packages/db/src/types.ts`** (tres ediciones, mismo shape que generaría `supabase gen types` con la columna `not null default`: requerido en Row, opcional en Insert/Update; orden alfabético del generador → va entre `resolucion_sii_numero` y `rut`).

  Edición 3a — en `empresas.Row` (línea ~1021), reemplazar:

```ts
          resolucion_sii_numero: number | null
          rut: string
```

  por:

```ts
          resolucion_sii_numero: number | null
          rubro: string
          rut: string
```

  Edición 3b — en `empresas.Insert` (línea ~1044), reemplazar:

```ts
          resolucion_sii_numero?: number | null
          rut: string
```

  por:

```ts
          resolucion_sii_numero?: number | null
          rubro?: string
          rut: string
```

  Edición 3c — en `empresas.Update` (línea ~1067), reemplazar:

```ts
          resolucion_sii_numero?: number | null
          rut?: string
```

  por:

```ts
          resolucion_sii_numero?: number | null
          rubro?: string
          rut?: string
```

  Nota: 3b y 3c difieren solo en `rut` (`rut: string` en Insert, `rut?: string` en Update) — usar ese ancla para que cada reemplazo sea único.

- [ ] **Step 4: Actualizar `Functions.registrar_organizacion` en `packages/db/src/types.ts`** (línea ~2832) con el tercer parámetro opcional `p_rubro` (spec §3.1: `default 'negocio'` → opcional en tipos; orden alfabético del generador). Reemplazar:

```ts
      registrar_organizacion: {
        Args: { p_razon_social: string; p_rut: string }
        Returns: string
      }
```

  por:

```ts
      registrar_organizacion: {
        Args: { p_razon_social: string; p_rubro?: string; p_rut: string }
        Returns: string
      }
```

- [ ] **Step 5: Agregar `Functions.cambiar_rubro` en `packages/db/src/types.ts`** (spec §3.2; `returns void` de la Task 1 → `Returns: undefined`, mismo estilo one-liner que `activar_contabilidad`). Va en orden alfabético: después del cierre de `cambiar_estado_proforma` (línea ~2676) y antes de `confirmar_pago_suscripcion` (línea ~2677). Reemplazar:

```ts
      confirmar_pago_suscripcion: {
```

  por:

```ts
      cambiar_rubro: {
        Args: { p_empresa: string; p_rubro: string }
        Returns: undefined
      }
      confirmar_pago_suscripcion: {
```

  Nota: `types.ts` es generado (`pnpm --filter @suite/db gen`); estas ediciones manuales replican byte a byte lo que el generador emitirá tras aplicar la migración 0023 de la Task 1, así el archivo no cambia si alguien regenera después.

- [ ] **Step 6: Verificación de tipos por workspace** (el repo no tiene script `typecheck`; ambos paquetes tienen `tsconfig.json`, se invoca `tsc` directo):

```
pnpm --filter @suite/core exec tsc --noEmit
```

  Salida esperada: sin diagnósticos, exit 0.

```
pnpm --filter @suite/db exec tsc --noEmit
```

  Salida esperada: sin diagnósticos, exit 0.

```
pnpm build
```

  Salida esperada: turbo termina con las 3 apps compiladas (`Tasks: … successful`, 0 failed), exit 0 — baseline verde intacto (tras Tasks 1-2: 327 pgTAP / 176 unit / 3 builds; esta task no agrega ni rompe tests). Recordatorio operativo del repo: `pnpm build` pisa los `.next` de los dev servers → reiniciarlos si estaban corriendo.

- [ ] **Step 7: Commit**

```
git add packages/core/src/rubros.ts packages/core/src/index.ts packages/db/src/types.ts
git commit -m "feat(core): catálogo RUBROS compartido y tipos de rubro en empresas y RPCs"
```

  Salida esperada: commit creado en la rama de trabajo con 3 archivos cambiados.

---

### Task 4: Registro con tarjetas de rubro (apps/web)

> Depende de: la constante `RUBROS` y el tipo `CodigoRubro` ya exportados desde `@suite/core` (Task 3, sección 4 del spec) y la RPC `registrar_organizacion(p_rut, p_razon_social, p_rubro)` ya migrada (Task 1, sección 3.1). NO tocar `apps/web/app/registro/exito/page.tsx`.

**Files:**
- Modify: `apps/web/app/registro/page.tsx` (grupo de tarjetas radio entre razón social y el bloque de error/botón)
- Modify: `apps/web/app/registro/acciones.ts` (leer y validar `rubro`, pasar `p_rubro` a la RPC)
- Test: sin archivo de test nuevo — verificación por build (`pnpm --filter web build`); la validación fail-closed queda cubierta por pgTAP (`rubros.test.sql`, Task 2) y el E2E manual del cierre (Task 7).

**Interfaces:**
- Consumes: `RUBROS: readonly { codigo: 'negocio' | 'transporte'; nombre: string; descripcion: string }[]` desde `@suite/core` (mismo import donde ya vive `validarRut`); RPC `registrar_organizacion(p_rut: text, p_razon_social: text, p_rubro: text default 'negocio')`.
- Produces: `registrar(_prev: EstadoForm, formData: FormData): Promise<EstadoForm>` (misma firma que hoy, ahora valida `rubro` fail-closed con error byte-exacto `'Elige el rubro de tu Pyme'` y envía `p_rubro`); formulario de registro con `input type="radio" name="rubro"` obligatorio, sin preselección.

- [ ] **Step 1: Tarjetas radio en `apps/web/app/registro/page.tsx`**

  Agregar el import de `RUBROS` y el bloque de tarjetas entre el label de razón social y el párrafo de error. Sin preselección (`defaultChecked` ausente); `required` en cada radio hace obligatoria la elección a nivel de navegador, y la acción server la re-valida fail-closed. El input usa `peer sr-only` y la tarjeta (sibling) resalta con `peer-checked` usando la paleta marca, consistente con `CLASES_INPUT`.

  En la cabecera del archivo, cambiar la línea de imports así (línea 3-6 actual):

  ```tsx
  import Link from 'next/link'
  import { useActionState } from 'react'
  import { RUBROS } from '@suite/core'
  import { registrar } from './acciones'
  import type { EstadoForm } from '../tipos'
  ```

  Dentro del `<form>`, inmediatamente después del `</label>` de razón social (línea 43 actual) e inmediatamente antes de `{estado.error && (`, insertar este bloque completo:

  ```tsx
            <fieldset>
              <legend className="mb-1 block text-sm font-medium text-slate-700">Rubro de tu Pyme</legend>
              <div className="grid gap-2">
                {RUBROS.map((r) => (
                  <label key={r.codigo} className="block cursor-pointer">
                    <input
                      type="radio"
                      name="rubro"
                      value={r.codigo}
                      required
                      className="peer sr-only"
                    />
                    <span className="block rounded-md border border-slate-300 px-3 py-2 transition-colors peer-checked:border-marca-500 peer-checked:bg-marca-50 peer-checked:ring-1 peer-checked:ring-marca-500 peer-focus-visible:ring-2 peer-focus-visible:ring-marca-500">
                      <span className="block text-sm font-medium text-slate-900">{r.nombre}</span>
                      <span className="mt-0.5 block text-xs text-slate-500">{r.descripcion}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
  ```

  El archivo completo queda así:

  ```tsx
  'use client'

  import Link from 'next/link'
  import { useActionState } from 'react'
  import { RUBROS } from '@suite/core'
  import { registrar } from './acciones'
  import type { EstadoForm } from '../tipos'

  const inicial: EstadoForm = {}

  const CLASES_INPUT =
    'w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-marca-500 focus:outline-none focus:ring-1 focus:ring-marca-500'

  export default function PaginaRegistro() {
    const [estado, accion, pendiente] = useActionState(registrar, inicial)
    return (
      <main
        className="grid min-h-screen place-items-center bg-slate-50 px-4 py-10"
        style={{ background: 'radial-gradient(900px 420px at 50% -10%, #e0f2fe 0%, rgba(224,242,254,0) 60%), #f8fafc' }}
      >
        <div className="w-full max-w-sm">
          <Link href="/" className="mb-6 block text-center text-2xl font-bold tracking-tight text-slate-900">
            Suite <span className="bg-gradient-to-r from-marca-600 to-cyan-500 bg-clip-text text-transparent">ERP</span>
          </Link>
          <div className="rounded-2xl border border-marca-100 bg-white p-8 shadow-xl shadow-marca-600/10">
            <h1 className="text-xl font-semibold text-slate-900">Crea tu cuenta</h1>
            <p className="mt-1 text-sm text-slate-500">14 días de prueba gratis. Sin tarjeta.</p>
            <form action={accion} className="mt-6 grid gap-4">
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-700">Correo</span>
                <input name="email" type="email" required autoComplete="email" placeholder="tu@empresa.cl" className={CLASES_INPUT} />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-700">Contraseña (mínimo 8 caracteres)</span>
                <input name="password" type="password" required minLength={8} autoComplete="new-password" className={CLASES_INPUT} />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-700">RUT de la empresa</span>
                <input name="rut" placeholder="76.543.210-3" required className={CLASES_INPUT} />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-700">Razón social</span>
                <input name="razon_social" placeholder="Mi Empresa SpA" required className={CLASES_INPUT} />
              </label>
              <fieldset>
                <legend className="mb-1 block text-sm font-medium text-slate-700">Rubro de tu Pyme</legend>
                <div className="grid gap-2">
                  {RUBROS.map((r) => (
                    <label key={r.codigo} className="block cursor-pointer">
                      <input
                        type="radio"
                        name="rubro"
                        value={r.codigo}
                        required
                        className="peer sr-only"
                      />
                      <span className="block rounded-md border border-slate-300 px-3 py-2 transition-colors peer-checked:border-marca-500 peer-checked:bg-marca-50 peer-checked:ring-1 peer-checked:ring-marca-500 peer-focus-visible:ring-2 peer-focus-visible:ring-marca-500">
                        <span className="block text-sm font-medium text-slate-900">{r.nombre}</span>
                        <span className="mt-0.5 block text-xs text-slate-500">{r.descripcion}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              {estado.error && (
                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{estado.error}</p>
              )}
              <button
                type="submit"
                disabled={pendiente}
                className="w-full rounded-lg bg-gradient-to-br from-marca-600 to-marca-700 px-5 py-2.5 font-semibold text-white shadow-lg shadow-marca-600/30 transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pendiente ? 'Creando cuenta…' : 'Crear cuenta'}
              </button>
            </form>
          </div>
          <p className="mt-6 text-center text-sm text-slate-500">
            ¿Ya tienes cuenta?{' '}
            <Link href="/login" className="font-semibold text-marca-700 hover:underline">
              Inicia sesión
            </Link>
          </p>
        </div>
      </main>
    )
  }
  ```

  Nota: guardar el archivo en UTF-8 **sin BOM** (JAMÁS emitir U+FEFF). No tocar `apps/web/app/registro/exito/page.tsx`.

- [ ] **Step 2: Validación fail-closed y `p_rubro` en `apps/web/app/registro/acciones.ts`**

  Leer `rubro` del `formData`, validarlo contra `RUBROS` antes de cualquier llamada a Supabase (fail-closed: ausente, vacío o desconocido → error byte-exacto `'Elige el rubro de tu Pyme'`) y pasarlo como `p_rubro` a la RPC. El archivo completo queda así:

  ```ts
  'use server'

  import { redirect } from 'next/navigation'
  import { RUBROS, validarRut } from '@suite/core'
  import { crearClienteServidor } from '@suite/auth/server'
  import type { EstadoForm } from '../tipos'

  export async function registrar(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
    const email = String(formData.get('email') ?? '').trim()
    const password = String(formData.get('password') ?? '')
    const rut = String(formData.get('rut') ?? '').trim()
    const razonSocial = String(formData.get('razon_social') ?? '').trim()
    const rubro = String(formData.get('rubro') ?? '')

    if (!email.includes('@')) return { error: 'Ingresa un correo válido' }
    if (password.length < 8) return { error: 'La contraseña debe tener al menos 8 caracteres' }
    if (!validarRut(rut)) return { error: 'El RUT ingresado no es válido' }
    if (!razonSocial) return { error: 'Ingresa la razón social de tu empresa' }
    if (!RUBROS.some((r) => r.codigo === rubro)) return { error: 'Elige el rubro de tu Pyme' }

    const supabase = await crearClienteServidor()

    // Reintento tras un fallo posterior (ej. RUT duplicado): si ya hay sesión o el
    // correo ya tiene cuenta, no volver a crear el usuario — así el segundo envío
    // del formulario llega al RPC en vez de morir en "User already registered".
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (user && user.email?.toLowerCase() !== email.toLowerCase()) {
      return {
        error:
          'Ya hay una sesión iniciada con otro correo en este navegador. Cierra esa sesión para registrar una cuenta nueva.',
      }
    }
    if (!user) {
      const { error: errorAuth } = await supabase.auth.signUp({ email, password })
      if (errorAuth?.code === 'user_already_exists') {
        const { error: errorLogin } = await supabase.auth.signInWithPassword({ email, password })
        if (errorLogin) return { error: 'Este correo ya tiene una cuenta. Inicia sesión para continuar.' }
      } else if (errorAuth) {
        console.error('Error de signUp en registro:', errorAuth)
        return { error: 'No se pudo crear la cuenta. Inténtalo de nuevo en unos minutos.' }
      }
    }

    // La BD normaliza y valida el RUT de nuevo (última línea de defensa).
    const { error: errorOrg } = await supabase.rpc('registrar_organizacion', {
      p_rut: rut,
      p_razon_social: razonSocial,
      p_rubro: rubro,
    })
    if (errorOrg) return { error: errorOrg.message }

    redirect('/registro/exito')
  }
  ```

  Nota: la comparación `RUBROS.some((r) => r.codigo === rubro)` es la única fuente de verdad en el cliente web; la RPC re-valida en BD con `'Rubro no válido'` (defensa en profundidad, sección 3.1 del spec). Guardar en UTF-8 sin BOM.

- [ ] **Step 3: Build del workspace web**

  Run:

  ```
  pnpm --filter web build
  ```

  Salida esperada: `next build` compila sin errores de tipos ni de lint y termina con la tabla de rutas de Next (incluye `○ /registro`) y exit code 0. Los otros 2 builds (erp, admin) no se tocan en esta task; el pipeline global (327 pgTAP / 176 unit / 3 builds) se verifica en Task 7.

- [ ] **Step 4: Commit**

  Run:

  ```
  git add apps/web/app/registro/page.tsx apps/web/app/registro/acciones.ts
  git commit -m "feat(web): registro elige rubro con tarjetas y valida fail-closed"
  ```

  Salida esperada: commit creado en la rama del plan con los 2 archivos modificados.

---

### Task 5: ERP Configuración → Módulos — el rubro reemplaza al checkbox de transporte

> Depende de la Task 3 (`RUBROS` / `CodigoRubro` exportados desde `@suite/core`) y de la Task 1 (migración 0023: columna `empresas.rubro` + grant sin `modulo_transporte`). Ejecutar después de ambas.

**Files:**
- Modify: `apps/erp/app/configuracion/modulos/page.tsx`
- Modify: `apps/erp/app/configuracion/modulos/acciones.ts`
- Modify: `apps/erp/componentes/formulario-modulos.tsx`
- Test: sin tests nuevos en esta task (la página no tiene unit tests hoy; la cobertura del invariante vive en pgTAP `rubros.test.sql` de Task 2 y el E2E manual del cierre). Verificación: `pnpm --filter erp build` exit 0.

**Interfaces:**
- Consumes: `RUBROS`, `type CodigoRubro` desde `@suite/core` (Task 3); `crearClienteServidor` de `@suite/auth/server`; `obtenerEmpresaActiva` de `apps/erp/lib/empresa-activa.ts` (SIN cambios — el NAV sigue leyendo `modulo_transporte`); `EstadoForm` de `apps/erp/app/tipos`.
- Produces:
  - `FormularioModulos({ accion, inicial }: { accion: (prev: EstadoForm, formData: FormData) => Promise<EstadoForm>; inicial: { rubro: CodigoRubro; factorVolumetrico: number } })` — cambia la prop `moduloTransporte: boolean` por `rubro: CodigoRubro`.
  - `guardarModulos(_prev: EstadoForm, formData: FormData): Promise<EstadoForm>` — misma firma, pero deja de leer/escribir `modulo_transporte` (el UPDATE con esa columna fallaría con 42501 por el grant re-emitido en 0023).
  - `alternarContabilidad` y `PanelContabilidad` quedan INTACTOS.

- [ ] **Step 1: page.tsx — agregar `rubro` al select y pasarlo al componente**

  Reemplazar el contenido completo de `apps/erp/app/configuracion/modulos/page.tsx` por:

  ```tsx
  import { crearClienteServidor } from '@suite/auth/server'
  import { Encabezado } from '@suite/ui'
  import type { CodigoRubro } from '@suite/core'
  import { obtenerEmpresaActiva } from '../../../lib/empresa-activa'
  import { FormularioModulos } from '../../../componentes/formulario-modulos'
  import { PanelContabilidad } from '../../../componentes/panel-contabilidad'
  import { alternarContabilidad, guardarModulos } from './acciones'

  export default async function ConfigModulos() {
    const { activa } = await obtenerEmpresaActiva()
    if (!activa) return <Encabezado titulo="Sin empresa activa" />

    const supabase = await crearClienteServidor()
    const { data: empresa } = await supabase
      .from('empresas')
      .select('rubro, factor_volumetrico')
      .eq('id', activa.id)
      .single()

    return (
      <div>
        <Encabezado titulo="Módulos" />
        <FormularioModulos
          accion={guardarModulos}
          inicial={{
            rubro: (empresa?.rubro ?? 'negocio') as CodigoRubro,
            factorVolumetrico: empresa?.factor_volumetrico ?? 250,
          }}
        />
        <PanelContabilidad accion={alternarContabilidad} activo={activa.modulo_contabilidad} />
      </div>
    )
  }
  ```

  Notas: el select ya no pide `modulo_transporte` (la página no lo usa); el cast `as CodigoRubro` es seguro porque el CHECK de 0023 garantiza el dominio en la base.

- [ ] **Step 2: formulario-modulos.tsx — checkbox fuera, bloque de rubro solo lectura, factor solo si transporte**

  Reemplazar el contenido completo de `apps/erp/componentes/formulario-modulos.tsx` por:

  ```tsx
  'use client'

  import { useActionState } from 'react'
  import { RUBROS, type CodigoRubro } from '@suite/core'
  import { Boton, Campo, Entrada, Tarjeta } from '@suite/ui'
  import type { EstadoForm } from '../app/tipos'

  export function FormularioModulos({
    accion,
    inicial,
  }: {
    accion: (prev: EstadoForm, formData: FormData) => Promise<EstadoForm>
    inicial: { rubro: CodigoRubro; factorVolumetrico: number }
  }) {
    const [estado, enviar, pendiente] = useActionState(accion, {} as EstadoForm)
    const nombreRubro =
      RUBROS.find((r) => r.codigo === inicial.rubro)?.nombre ?? inicial.rubro
    return (
      <Tarjeta className="max-w-2xl">
        <div className="grid gap-4">
          <div>
            <p className="text-sm font-medium text-slate-700">
              Rubro: <span className="font-semibold">{nombreRubro}</span>
            </p>
            <p className="text-sm text-slate-500">
              El rubro lo asigna la plataforma. Para cambiarlo, contacta a soporte.
            </p>
          </div>
          {inicial.rubro === 'transporte' && (
            <form action={enviar} className="grid gap-4">
              <Campo etiqueta="Factor volumétrico (kg por M3, entre 1 y 10000)">
                <Entrada
                  name="factor_volumetrico"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={10000}
                  step={1}
                  defaultValue={inicial.factorVolumetrico}
                  required
                  className="max-w-xs"
                />
              </Campo>
              <p className="text-sm text-slate-500">
                Los cambios del factor volumétrico son prospectivos: las órdenes de entrega y
                proformas ya registradas no se recalculan.
              </p>
              <div className="flex items-center justify-end gap-2">
                {estado.error && <span className="mr-auto text-sm text-red-600">{estado.error}</span>}
                <Boton type="submit" disabled={pendiente}>{pendiente ? 'Guardando…' : 'Guardar módulos'}</Boton>
              </div>
            </form>
          )}
        </div>
      </Tarjeta>
    )
  }
  ```

  Notas: desaparece el `<input type="checkbox" name="modulo_transporte">`; la nota "Apagar el módulo solo oculta las pantallas…" se elimina (ya no hay toggle que apagar). Con rubro `negocio` la tarjeta muestra solo el bloque de rubro, sin formulario (no hay nada que guardar).

- [ ] **Step 3: acciones.ts — `guardarModulos` deja de tocar `modulo_transporte`**

  En `apps/erp/app/configuracion/modulos/acciones.ts`, reemplazar la función `guardarModulos` completa (líneas 8–32 actuales) por el siguiente bloque; `alternarContabilidad` y el resto del archivo NO se tocan:

  ```ts
  export async function guardarModulos(_prev: EstadoForm, formData: FormData): Promise<EstadoForm> {
    const { activa } = await obtenerEmpresaActiva()
    if (!activa) return { error: 'No tienes una empresa activa' }

    // modulo_transporte ya no se escribe aquí: es un flag derivado del rubro (0023)
    // y su columna no tiene grant de UPDATE — solo se mueve por cambiar_rubro.
    const factor = Number(String(formData.get('factor_volumetrico') ?? '').trim())
    // Mismo rango que el check de la tabla (0016): rechazar aquí da mensaje claro
    // en vez de un 23514 crudo.
    if (!Number.isInteger(factor) || factor < 1 || factor > 10000) {
      return { error: 'El factor volumétrico debe ser un entero entre 1 y 10000' }
    }

    const supabase = await crearClienteServidor()
    const { data, error } = await supabase
      .from('empresas')
      .update({ factor_volumetrico: factor })
      .eq('id', activa.id)
      .select('id')
    if (error) return { error: 'No se pudo guardar la configuración de módulos' }
    if ((data ?? []).length === 0) return { error: 'No se pudo guardar: solo el dueño o admin puede cambiar los módulos' }

    // El NAV condicional vive en el layout raíz: revalidar todo el árbol.
    revalidatePath('/', 'layout')
    return {}
  }
  ```

- [ ] **Step 4: build del workspace erp**

  ```
  pnpm --filter erp build
  ```

  Salida esperada: termina con `✓ Compiled successfully` y exit code 0 (sin errores de tipos; si `RUBROS`/`CodigoRubro` no existen aún en `@suite/core`, la Task 3 no se ejecutó — detenerse y ejecutarla primero).

  Recordatorio (gotcha del repo): `pnpm build` pisa el `.next` de los dev servers — reiniciar los dev servers (puertos 3000-3002) después de este build antes de probar en el navegador.

  Nota: NO hay verificación manual en esta task — el `db reset` de Task 2 borró la demo y el seed recién se corrige en Task 7 (resembrar aquí con el seed viejo dejaría `rubro='negocio'` + `modulo_transporte=true`, rompiendo el invariante). La comprobación en navegador de esta página (bloque "Rubro: Transporte" solo lectura, factor editable, panel Contabilidad intacto, y "Rubro: Negocio" sin formulario) vive en el E2E de Task 7 Step 8, puntos (3) y (4), con la demo resembrada con el seed nuevo.

- [ ] **Step 5: commit**

  ```
  git add apps/erp/app/configuracion/modulos/page.tsx apps/erp/app/configuracion/modulos/acciones.ts apps/erp/componentes/formulario-modulos.tsx
  git commit -m "feat(erp): rubro solo lectura reemplaza al toggle de transporte en Módulos"
  ```

  Salida esperada: commit creado en la rama del plan con 3 archivos modificados.

---

### Task 6: Panel admin — columna Rubro y acción cambiarRubro

**Files:**
- Modify: `apps/admin/app/acciones.ts` (nueva server action `cambiarRubro`)
- Modify: `apps/admin/app/page.tsx` (join `empresas`, columna Rubro con form por empresa)
- Test: sin unit nuevos (server action cubierta por pgTAP de `cambiar_rubro` en Task 2 y por E2E manual al cierre); verificación = `pnpm --filter admin build` exit 0

**Interfaces:**
- Consumes: `RUBROS` desde `@suite/core` (Task 3: `readonly { codigo, nombre, descripcion }[]`); `verificarAdmin(): Promise<void>` de `apps/admin/lib/guardia.ts`; `clienteAdmin()` de `@suite/auth/admin`; RPC `cambiar_rubro(p_empresa uuid, p_rubro text)` (Task 1, migración 0023, solo service_role); componentes `Boton, Td, Th` de `@suite/ui`.
- Produces: `export async function cambiarRubro(formData: FormData): Promise<void>` en `apps/admin/app/acciones.ts`.

- [ ] **Step 1: agregar `cambiarRubro` a `apps/admin/app/acciones.ts`**

  El archivo completo queda así (se agrega el import de `RUBROS` y la función al final; el resto no cambia):

  ```ts
  'use server'

  import { revalidatePath } from 'next/cache'
  import { clienteAdmin } from '@suite/auth/admin'
  import { RUBROS } from '@suite/core'
  import { verificarAdmin } from '../lib/guardia'

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

  async function cambiarEstado(id: string, estado: 'activa' | 'suspendida') {
    if (!UUID.test(id)) return
    await verificarAdmin()
    const admin = clienteAdmin()
    const { error } = await admin.from('organizaciones').update({ estado }).eq('id', id)
    if (error) throw new Error('No se pudo actualizar la organización: ' + error.message)
    revalidatePath('/')
  }

  export async function activarOrganizacion(formData: FormData) {
    await cambiarEstado(String(formData.get('id')), 'activa')
  }

  export async function suspenderOrganizacion(formData: FormData) {
    await cambiarEstado(String(formData.get('id')), 'suspendida')
  }

  export async function cambiarRubro(formData: FormData) {
    const empresaId = String(formData.get('empresa_id'))
    const rubro = String(formData.get('rubro'))
    if (!UUID.test(empresaId)) return
    if (!RUBROS.some((r) => r.codigo === rubro)) return
    await verificarAdmin()
    const admin = clienteAdmin()
    const { error } = await admin.rpc('cambiar_rubro', { p_empresa: empresaId, p_rubro: rubro })
    if (error) throw new Error('No se pudo cambiar el rubro: ' + error.message)
    revalidatePath('/')
  }
  ```

  Notas de patrón (idéntico a `cambiarEstado`): validación fail-closed silenciosa de inputs manipulados (UUID y rubro fuera de `RUBROS` → return, la RPC igualmente los rechazaría), `verificarAdmin()` antes de tocar datos, `clienteAdmin()` (service_role: única audiencia con `execute` sobre `cambiar_rubro`), error → `throw`, éxito → `revalidatePath('/')`.

- [ ] **Step 2: join de empresas y columna Rubro en `apps/admin/app/page.tsx`**

  Cuatro ediciones exactas (old → new):

  **2a — imports** (líneas 2-5):

  ```tsx
  // OLD
  import { formatearCLP, formatearRut } from '@suite/core'
  import { Boton, Encabezado, Insignia, Tabla, Tarjeta, Td, Th, Tr } from '@suite/ui'
  import { verificarAdmin } from '../lib/guardia'
  import { activarOrganizacion, suspenderOrganizacion } from './acciones'
  ```

  ```tsx
  // NEW
  import { RUBROS, formatearCLP, formatearRut } from '@suite/core'
  import { Boton, Encabezado, Insignia, Tabla, Tarjeta, Td, Th, Tr } from '@suite/ui'
  import { verificarAdmin } from '../lib/guardia'
  import { activarOrganizacion, cambiarRubro, suspenderOrganizacion } from './acciones'
  ```

  **2b — select con join empresas** (dentro del `Promise.all`):

  ```tsx
  // OLD
      admin
        .from('organizaciones')
        .select('id, rut, razon_social, estado, trial_hasta, creado_en, planes (nombre, precio_clp), suscripciones (hasta)')
        .order('creado_en', { ascending: false }),
  ```

  ```tsx
  // NEW
      admin
        .from('organizaciones')
        .select(
          'id, rut, razon_social, estado, trial_hasta, creado_en, planes (nombre, precio_clp), suscripciones (hasta), empresas (id, razon_social, rubro)'
        )
        .order('creado_en', { ascending: false }),
  ```

  **2c — encabezado de tabla** (columna Rubro tras "Razón social"):

  ```tsx
  // OLD
                <Th>RUT</Th>
                <Th>Razón social</Th>
                <Th>Plan</Th>
  ```

  ```tsx
  // NEW
                <Th>RUT</Th>
                <Th>Razón social</Th>
                <Th>Rubro</Th>
                <Th>Plan</Th>
  ```

  **2d — celda Rubro** (tras el `<Td>` de razón social, antes del de Plan):

  ```tsx
  // OLD
                  <Td className="font-medium text-slate-900">{org.razon_social}</Td>
                  <Td>
                    {org.planes?.nombre ?? '—'}
  ```

  ```tsx
  // NEW
                  <Td className="font-medium text-slate-900">{org.razon_social}</Td>
                  <Td>
                    {(org.empresas ?? []).length === 0 ? (
                      <span className="text-slate-400">—</span>
                    ) : (
                      <div className="space-y-2">
                        {(org.empresas ?? []).map((emp) => (
                          <form key={emp.id} action={cambiarRubro} className="flex items-center gap-2">
                            <input type="hidden" name="empresa_id" value={emp.id} />
                            {(org.empresas ?? []).length > 1 && (
                              <span className="max-w-32 truncate text-xs text-slate-500" title={emp.razon_social}>
                                {emp.razon_social}
                              </span>
                            )}
                            <select
                              name="rubro"
                              defaultValue={emp.rubro}
                              className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700"
                            >
                              {RUBROS.map((r) => (
                                <option key={r.codigo} value={r.codigo}>
                                  {r.nombre}
                                </option>
                              ))}
                            </select>
                            <Boton type="submit" variante="secundario">
                              Cambiar
                            </Boton>
                          </form>
                        ))}
                      </div>
                    )}
                  </Td>
                  <Td>
                    {org.planes?.nombre ?? '—'}
  ```

  Hoy la relación es 1:1 (una empresa por org), pero el diseño tolera N: con varias empresas los forms se apilan (`space-y-2`) mostrando el nombre de cada una. Cada form es independiente (select + hidden `empresa_id` + Boton secundario), mismo patrón que los forms Activar/Suspender de la celda Acciones.

- [ ] **Step 3: verificar build del workspace admin**

  ```
  pnpm --filter admin build
  ```

  Salida esperada: compila sin errores de tipos ni de lint, termina con el resumen de rutas de Next (`Route (app) ...`) y exit code 0. Los otros 2 builds (web, erp) se verifican en Task 7.

- [ ] **Step 4: commit**

  ```
  git add apps/admin/app/acciones.ts apps/admin/app/page.tsx
  git commit -m "feat(admin): cambio de rubro por empresa desde el panel de plataforma"
  ```

  Salida esperada: commit creado en la rama del plan con los 2 archivos modificados.

---

### Task 7: Seed con rubro, pipeline verde completo y E2E manual de rubros

**Files:**
- Modify: `scripts/seed-demo.mjs` (org 1 nace con `p_rubro: 'transporte'`; el update directo de `modulo_transporte` desaparece)
- Test: suite pgTAP completa (17 archivos, 327 asserts), unit (176), builds (3 apps), E2E manual con Playwright MCP
- Sin archivos de producción nuevos: esta task solo toca el seed y verifica todo lo anterior.

**Interfaces:**
- Consumes: `registrar_organizacion(p_rut text, p_razon_social text, p_rubro text default 'negocio') returns uuid` (Task 1, migración 0023) — org 1 la llama con `p_rubro: 'transporte'`; org 2 sin el parámetro (nace `'negocio'`).
- Consumes: `cambiar_rubro(p_empresa uuid, p_rubro text) returns void` (solo service_role, Task 1) — la ejerce el panel admin en el E2E paso 3.
- Consumes: grants de columnas de `empresas` re-emitidos SIN `modulo_transporte` ni `rubro` (Task 1) — el E2E paso 5 verifica el bloqueo para `authenticated` (42501). OJO: el update directo del seed usa el cliente `admin` (service_role), que conserva el grant COMPLETO de 0001:139 y SÍ pasaría — se elimina para no romper el invariante rubro/modulo_transporte (la empresa ya nace 'transporte' por la RPC), no porque el grant lo impida; la disciplina es no escribir esos campos fuera de `cambiar_rubro`.
- Produces: demo local resembrada donde `Demo Transportes SpA` tiene `rubro='transporte'` + `modulo_transporte=true` (por la RPC, no por update) y `Comercial Ficticia SpA` tiene `rubro='negocio'` + `modulo_transporte=false`.

- [ ] **Step 1: Org 1 del seed pasa `p_rubro: 'transporte'` en la RPC**

En `scripts/seed-demo.mjs`, línea 58, reemplazar:

```js
const { data: orgId, error: eOrg } = await userCli.rpc('registrar_organizacion', { p_rut: '77.123.456-9', p_razon_social: 'Demo Transportes SpA' })
```

por:

```js
const { data: orgId, error: eOrg } = await userCli.rpc('registrar_organizacion', { p_rut: '77.123.456-9', p_razon_social: 'Demo Transportes SpA', p_rubro: 'transporte' })
```

- [ ] **Step 2: El update directo de `modulo_transporte` desaparece — queda solo `factor_volumetrico`**

En `scripts/seed-demo.mjs`, líneas 130-134, reemplazar:

```js
// 8) Módulo de transporte (Plan 11): activado + tarifario + flota + ODEs que replican
//    la proforma real del usuario (PF con neto 227.836 / IVA 43.289 / total 271.125).
const { error: eMod } = await admin.from('empresas')
  .update({ modulo_transporte: true, factor_volumetrico: 250 }).eq('id', empresaId)
if (eMod) die('modulo_transporte', eMod)
```

por:

```js
// 8) Módulo de transporte (Plan 11): la empresa ya nació con rubro 'transporte'
//    (registrar_organizacion setea modulo_transporte junto al rubro). El update
//    directo con service_role SÍ pasaría (los grants de 0023 solo limitan a
//    authenticated; service_role conserva update total de 0001), pero rompería
//    el invariante rubro/modulo_transporte — por eso el flag solo lo mueven
//    registrar_organizacion y cambiar_rubro. Tarifario + flota + ODEs que
//    replican la proforma real del usuario (PF con neto 227.836 / IVA 43.289 /
//    total 271.125).
const { error: eMod } = await admin.from('empresas')
  .update({ factor_volumetrico: 250 }).eq('id', empresaId)
if (eMod) die('factor_volumetrico', eMod)
```

- [ ] **Step 3: Verificar que la org 2 queda SIN `p_rubro`**

La línea 407 NO se toca — se verifica que sigue así (nace `'negocio'` por el default de la RPC, y demuestra el NAV reducido en la demo):

```js
const { error: eOrg2 } = await userCli2.rpc('registrar_organizacion', { p_rut: '78.120.450-1', p_razon_social: 'Comercial Ficticia SpA' })
```

Comprobación rápida de que no quedó ningún otro escritor directo del flag en el seed:

```powershell
Select-String -Path scripts/seed-demo.mjs -Pattern 'modulo_transporte'
```

Salida esperada: solo menciones dentro del comentario del paso 8 (ninguna en un `.update(...)`).

- [ ] **Step 4: Suite pgTAP completa (17 archivos)**

Desde la raíz del repo:

```powershell
npx supabase test db
```

Salida esperada: los 16 archivos previos + `rubros.test.sql` (17 en total), todos `ok`, sin `not ok`. Total de tests: **327** (315 del baseline + 12 nuevos de `rubros.test.sql`, el total contractual que fijó la Task 2). Última línea `All tests successful.`, `Files=17, Tests=327, Result: PASS` y código de salida 0.

- [ ] **Step 5: Unit tests (176)**

```powershell
pnpm test
```

Salida esperada: turbo corre `test` en todos los paquetes/apps con vitest; suma total **176 tests passed** (sin cambios: ninguna task del plan agrega unit tests), `Tasks: N successful, N total`, exit 0.

- [ ] **Step 6: Builds de las 3 apps**

```powershell
pnpm build
```

Salida esperada: `apps/web`, `apps/erp` y `apps/admin` compilan (`✓ Compiled successfully` cada una), `Tasks: … successful`, exit 0.

- [ ] **Step 7: Reiniciar dev servers (gotcha: `pnpm build` pisa el `.next` de los dev servers → 500s)**

```powershell
Get-NetTCPConnection -LocalPort 3000,3001,3002 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -Confirm:$false }
Remove-Item -Recurse -Force apps/web/.next, apps/erp/.next, apps/admin/.next -ErrorAction SilentlyContinue
```

Luego levantar cada app en background (tres comandos separados, `run_in_background`):

```powershell
pnpm --filter web dev
pnpm --filter erp dev
pnpm --filter admin dev
```

Salida esperada: `▲ Next.js … Local: http://localhost:3000` (web), `:3001` (erp), `:3002` (admin), `✓ Ready in …`.

- [ ] **Step 8: E2E manual con Playwright MCP — checklist numerada**

**(1) Resembrar la demo.**

```powershell
npx supabase db reset
```

Salida esperada: `Applying migration …0023_….sql` incluida, `Finished supabase db reset`. Después, gotcha Kong 502 (el reset deja a Kong con el upstream viejo de auth):

```powershell
docker restart supabase_kong_ERP_Transportes
Start-Sleep -Seconds 8
Invoke-RestMethod http://127.0.0.1:54321/auth/v1/health
```

Salida esperada del health: objeto JSON con `name: GoTrue` (HTTP 200). Cargar la clave DTE desde `apps/erp/.env.local` SIN imprimirla y sembrar:

```powershell
$env:DTE_ENCRYPTION_KEY = ((Get-Content apps/erp/.env.local | Where-Object { $_ -like 'DTE_ENCRYPTION_KEY=*' }) -split '=',2)[1]
node scripts/seed-demo.mjs
```

Salida esperada: todas las líneas `✓ …` del seed (usuario, org + empresa, …, 2da organización, correos) y exit 0, sin ningún `✗`. Requiere Node ≥22 (sección 19 del seed).

**(2) Registro nuevo eligiendo la tarjeta Transporte.**
- `browser_navigate` a `http://localhost:3000/registro`.
- `browser_snapshot`: el formulario muestra las 2 tarjetas de rubro (Negocio / Transporte, con nombre + descripción de `RUBROS`), ninguna preseleccionada.
- `browser_fill_form`: email `e2e-rubros@suite-erp.cl`, password `demo1234`, RUT `77.777.777-7` (válido, no colisiona con fixtures pgTAP ni con el seed), razón social `E2E Rubros SpA`.
- `browser_click` en la tarjeta **Transporte** → snapshot: la tarjeta queda resaltada (radio marcado).
- `browser_click` en el botón de enviar → redirige a `/registro/exito`.
- `browser_navigate` a `http://localhost:3001` → `browser_snapshot`: el NAV del ERP **muestra la sección Transporte** (Flota, Tarifario, Entregas, Proformas, Combustible).

**(3) Admin cambia esa empresa a Negocio.**
- `browser_navigate` a `http://localhost:3002` → login `admin@suite-erp.cl` / `admin-suite-2026`.
- `browser_snapshot`: la tabla de organizaciones muestra la columna **Rubro**; la fila `E2E Rubros SpA` muestra **Transporte** (el `nombre` de `RUBROS`; el `value` del option es `transporte`) seleccionado en su `<select>`.
- `browser_select_option` en esa fila → `Negocio`; `browser_click` en **Cambiar** → la fila recarga mostrando **Negocio** seleccionado, sin error.
- Volver a `http://localhost:3001` con la sesión de `e2e-rubros@suite-erp.cl` (si el admin pisó la cookie en localhost, re-login en :3000) y recargar → `browser_snapshot`: el NAV **ya no muestra** la sección Transporte.
- `browser_navigate` a `http://localhost:3001/configuracion/modulos` → snapshot: bloque de solo lectura `Rubro: Negocio` con la nota "El rubro lo asigna la plataforma. Para cambiarlo, contacta a soporte.", **sin** checkbox de transporte y **sin** formulario de factor volumétrico.

**(4) La demo sigue intacta.**
- Login `demo@suite-erp.cl` / `demo1234` en `http://localhost:3000/login` → `browser_navigate` a `http://localhost:3001` → snapshot: NAV **con** sección Transporte y dashboard con los datos del seed (`Demo Transportes SpA` nació con `p_rubro: 'transporte'`, nadie la tocó).

**(5) Verificación de bloqueo: update directo de `modulo_transporte` vía Data API como authenticated FALLA.**

```powershell
$anon = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
$tok = (Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:54321/auth/v1/token?grant_type=password' -Headers @{ apikey = $anon } -ContentType 'application/json' -Body '{"email":"demo@suite-erp.cl","password":"demo1234"}').access_token
try {
  Invoke-RestMethod -Method Patch -Uri 'http://127.0.0.1:54321/rest/v1/empresas?razon_social=eq.Demo%20Transportes%20SpA' -Headers @{ apikey = $anon; Authorization = "Bearer $tok"; Prefer = 'return=representation' } -ContentType 'application/json' -Body '{"modulo_transporte":false}'
  Write-Host 'FALLO DE SEGURIDAD: el update directo paso — revisar el grant de 0023'
} catch { Write-Host ('Bloqueado como se esperaba: ' + $_.ErrorDetails.Message) }
```

Salida esperada: `Bloqueado como se esperaba: {"code":"42501",…"message":"permission denied for table empresas"}` (la clave anon es la JWT pública estándar del stack local, la misma committeada en el seed — solo dev). Repetir el mismo `try/catch` con body `'{"rubro":"negocio"}'` → mismo 42501.

- [ ] **Step 9: Commit**

```powershell
git add scripts/seed-demo.mjs
git commit -m "feat(scripts): la demo nace con rubro transporte via registrar_organizacion"
```

Salida esperada: commit creado en `1 file changed`; `git status` limpio.
