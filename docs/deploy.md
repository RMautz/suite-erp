# Runbook de deploy — Suite ERP

Este documento describe, paso a paso, cómo llevar el monorepo `suite-erp` desde el
estado actual (rama `feature/plan1-fundacion`, todo verde en local) a producción:
repo en GitHub con CI corriendo, proyecto Supabase productivo, y las 3 apps
(`web`, `erp`, `admin`) publicadas en Vercel.

Requiere cuentas del operador humano (GitHub, Supabase, Vercel) — ninguno de estos
pasos se puede ejecutar de forma no interactiva. La primera vez, el operador debe
estar disponible para autorizar los distintos login (`gh auth login`,
`pnpm supabase login`, login de Vercel en el navegador).

Todos los comandos de PowerShell asumen Windows 11 / PowerShell 5.1, donde `&&` no
funciona (usar `;`). Ejecutar siempre desde la raíz del repo.

**Nota (Windows):** si Node/pnpm/gh se instalaron recientemente y la terminal abierta
no los encuentra ("no se reconoce como comando"), refresca el PATH de la sesión con:

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')
```

O simplemente abre una terminal nueva.

---

## 1. Prerrequisito: repo en GitHub

1. Instalar y autenticar la CLI de GitHub si no está ya:

   ```powershell
   gh auth login
   ```

   Seguir el flujo interactivo (login por navegador recomendado).

2. Crear el repo privado y hacer push del contenido actual en un solo paso:

   ```powershell
   gh repo create suite-erp --private --source . --push
   ```

   Alternativa manual (sin `gh`): crear el repo vacío `suite-erp` (privado) desde
   github.com, luego:

   ```powershell
   git remote add origin https://github.com/<usuario>/suite-erp.git
   git push -u origin feature/plan1-fundacion
   ```

   Nota: `.github/workflows/ci.yml` dispara en `push` a `master`/`main` y en todo
   `pull_request`. Si se hace push solo de la rama de feature, Actions no correrá
   hasta abrir el PR contra `main` (o hasta mergear). Abrir el PR y confirmar que
   el check de CI corre.

3. Verificar que Actions corre en verde: en GitHub → pestaña **Actions** → el
   workflow `CI` debe completar los 3 pasos (`pnpm test`, `supabase start` +
   `supabase test db`, `pnpm build`) sin errores. El job usa valores dummy de
   entorno (ver `.github/workflows/ci.yml`), no depende del proyecto Supabase
   real — es seguro correrlo antes de tener producción lista.

---

## 2. Supabase producción

### 2.1 Crear el proyecto

1. En [supabase.com](https://supabase.com) → **New project**:
   - Nombre: `suite-erp-prod`
   - Región: `sa-east-1` (São Paulo) — la más cercana a Chile.
   - Contraseña de base de datos: generarla y **guardarla de inmediato en un
     gestor de contraseñas**. No se puede recuperar después, solo resetear.
2. Esperar a que el proyecto termine de aprovisionar (unos minutos).
3. Anotar el **project ref** (visible en la URL del dashboard,
   `https://supabase.com/dashboard/project/<ref>`, y en Settings → General).
4. **Recuperación de contraseña** (Authentication → URL Configuration): agregar
   `https://<dominio-web>/auth/confirm` a **Redirect URLs** (la lista es exacta).
   Si falta, GoTrue descarta el `redirectTo` y el correo de recuperación sale
   apuntando al Site URL sin `/auth/confirm` — el flujo falla en silencio (el
   usuario ve el éxito genérico pero el enlace no restablece).
5. **Rate limiting del chat de ventas** (ANTES de exponer la landing pública):
   la RPC `crear_lead` está abierta a `anon` y la action `responderVentas` dispara
   un correo por lead (tope parcial de 30/día por proceso en el código). Para
   producción: límite por IP en Vercel (WAF/middleware) o proxy sobre ambas rutas,
   o el rate limiter de Supabase para la RPC. Sin esto, un script puede inflar la
   tabla `leads` y quemar cuota de Resend.

### 2.2 Vincular y aplicar migraciones

```powershell
pnpm supabase login
```

Esto abre el navegador para autorizar la CLI (interactivo, requiere que el
operador esté presente).

```powershell
pnpm supabase link --project-ref <ref-del-proyecto>
```

Pedirá la contraseña de base de datos guardada en el paso 2.1.

```powershell
pnpm supabase db push
```

Esto aplica, en orden, las 2 migraciones existentes en `supabase/migrations/`:

| Migración | Contenido |
|---|---|
| `00000000000001_plataforma.sql` | Esquema `app`; tablas `planes`, `organizaciones`, `suscripciones`, `empresas`, `miembros`; funciones `app.mis_organizaciones()` / `app.tiene_rol()`; políticas RLS; GRANTs de Data API; seed de los 3 planes (Básico/Pro/Empresa). |
| `00000000000002_registro.sql` | `app.normalizar_rut()`, `app.validar_rut()`, RPC `public.registrar_organizacion()` (crea organización + empresa + membresía dueño en una transacción) y su GRANT a `authenticated`. |

Resultado esperado: ambas migraciones se aplican sin errores. Si `db push` falla
por permisos de schema, revisar que la migración 1 incluya
`grant usage on schema app to anon, authenticated;` (ya está en el archivo).

### 2.3 Configurar Auth para v1

En el dashboard del proyecto:

1. **Authentication → Providers → Email** → desactivar **"Confirm email"**.
   Esta es la decisión v1 documentada en las Global Constraints del plan
   (`docs/superpowers/plans/2026-07-07-fase1-plan1-fundacion.md`, línea 32): el
   registro crea sesión inmediata sin confirmación por correo; se revisita cuando
   exista cobro automático. **Sin este cambio el smoke test del paso 4 falla**
   porque el usuario queda sin sesión tras registrarse.
2. **Authentication → Providers → Email → Minimum password length**: subir de 6
   (default) a **8**. El default local en `supabase/config.toml`
   (`minimum_password_length = 6`) es solo para desarrollo; el formulario de
   registro del portal (`apps/web`) ya valida 8+ caracteres en el cliente, pero el
   proyecto hosted debe exigir el mismo mínimo en el servidor o un RUT válido con
   contraseña de 6-7 caracteres pasaría el frontend de otro cliente API y sería
   aceptado igual.

### 2.4 Ubicación de las API keys

**Settings → API** en el dashboard del proyecto:

- `Project URL` → usar como `NEXT_PUBLIC_SUPABASE_URL` en las 3 apps.
- `anon` `public` key → usar como `NEXT_PUBLIC_SUPABASE_ANON_KEY` en las 3 apps.
- `service_role` key (sección "Project API keys", marcada como secreta) → usar
  **solo** como `SUPABASE_SERVICE_ROLE_KEY` en `admin`. Nunca exponerla con
  prefijo `NEXT_PUBLIC_` ni en `web`/`erp`.

---

## 3. Vercel: 3 proyectos

Para cada app se crea un proyecto Vercel separado apuntando al mismo repo, con
distinto **Root Directory**. Vercel detecta el monorepo Turborepo automáticamente.

En Vercel → **Add New… → Project** → importar `suite-erp` → repetir 3 veces:

| Proyecto Vercel | Root Directory |
|---|---|
| `suite-erp-web` | `apps/web` |
| `suite-erp-erp` | `apps/erp` |
| `suite-erp-admin` | `apps/admin` |

Tras crear los 3, anotar sus URLs (`https://<nombre>.vercel.app`, Vercel asigna
el subdominio según el nombre de proyecto elegido).

> **⚠️ Importante — límite de `*.vercel.app`:** mientras las 3 apps vivan en
> subdominios `*.vercel.app`, **solo la app `web` es utilizable** (registro y
> login). `erp` y `admin` **redirigen en bucle al login** de `web`: su
> middleware exige sesión, la cookie que emite `web` es host-only, y
> `vercel.app` está en la Public Suffix List — no existe un dominio raíz común
> entre `<algo>.vercel.app` y `<otro-algo>.vercel.app` en el que una cookie
> pueda ser válida para ambos. No hay forma de completar el login cruzado a
> `erp`/`admin` sin dominio propio. El smoke test en `*.vercel.app` (§4) queda
> limitado a probar el registro en `web`; el resto del flujo requiere primero
> configurar un dominio propio (§5) y solo entonces se puede correr el smoke
> test completo (§6).

### 3.1 Variables de entorno por app

Configurar en cada proyecto Vercel → **Settings → Environment Variables**,
ambiente **Production** (y Preview si se quiere que los PR deploys funcionen
contra el mismo proyecto Supabase — opcional). Fuente: `apps/*/.env.example` de
cada app.

**`apps/web` (`.env.example`):**

| Variable | Valor en producción |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL de `suite-erp-prod` (§2.4) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key de `suite-erp-prod` (§2.4) |
| `NEXT_PUBLIC_URL_ERP` | URL Vercel del proyecto `suite-erp-erp` |
| `NEXT_PUBLIC_COOKIE_DOMAIN` | **vacía** (ver §3.2) |

**`apps/erp` (`.env.example`):**

| Variable | Valor en producción |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL de `suite-erp-prod` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key de `suite-erp-prod` |
| `NEXT_PUBLIC_URL_WEB` | URL Vercel del proyecto `suite-erp-web` |
| `NEXT_PUBLIC_COOKIE_DOMAIN` | **vacía** |

**`apps/admin` (`.env.example`):**

| Variable | Valor en producción |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL de `suite-erp-prod` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key de `suite-erp-prod` |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key de `suite-erp-prod` — **solo admin** |
| `NEXT_PUBLIC_URL_WEB` | URL Vercel del proyecto `suite-erp-web` |
| `NEXT_PUBLIC_COOKIE_DOMAIN` | **vacía** |
| `ADMIN_EMAILS` | `rpmautz@gmail.com` — **solo admin** |

Las URLs cruzadas (`NEXT_PUBLIC_URL_ERP` en web, `NEXT_PUBLIC_URL_WEB` en erp y
admin) solo se conocen una vez creados los 3 proyectos Vercel — completar esta
tabla después de tener las 3 URLs, y volver a desplegar (`Redeploy`) las apps
cuyo valor cambió, ya que las `NEXT_PUBLIC_*` se inyectan en build time.

### 3.2 Por qué `NEXT_PUBLIC_COOKIE_DOMAIN` queda vacía

Mientras las 3 apps vivan en subdominios distintos de `vercel.app`
(`suite-erp-web.vercel.app`, `suite-erp-erp.vercel.app`, ...), no se puede
compartir una cookie de sesión entre ellas — son dominios distintos a efectos de
cookies, y `vercel.app` está en la Public Suffix List (no hay un sufijo común
de dos niveles del que colgar una cookie de dominio, como sí lo hay con
`.dominio.cl`). Dejar `NEXT_PUBLIC_COOKIE_DOMAIN` vacía hace que cada app emita
su cookie en su propio dominio; el resultado **no es** "el usuario debe
loguearse de nuevo" sino que `erp`/`admin` quedan inutilizables — ver el aviso
de arriba. Este comportamiento es esperado en v1 y se resuelve en el §5
(dominio propio), prerrequisito del smoke test completo del §6.

---

## 4. Smoke test parcial en `*.vercel.app` (solo `web`)

Una vez las 3 apps están desplegadas y las env vars completas (con redeploy si
hizo falta), en `*.vercel.app` solo se puede verificar el registro en `web` —
ver el aviso de §3. **No** intentar todavía el login cruzado a `erp`/`admin`:
entra en el bucle descrito arriba. Ese tramo del smoke test se retoma en el §6,
después de configurar el dominio propio (§5).

1. Abrir la URL de `suite-erp-web` → **Registrarse** con un RUT de prueba válido
   (por ejemplo un RUT real generado con `formatearRut`/`validarRut` de
   `@suite/core`, o cualquier RUT que pase el dígito verificador) y contraseña de
   8+ caracteres → debe crear la cuenta y quedar con sesión iniciada (sin
   confirmación de email, por la config del §2.3).
2. Confirmar en el Table Editor de `suite-erp-prod` que aparece la fila nueva en
   `organizaciones` (`estado = 'trial'`), y una fila asociada en `empresas` y en
   `miembros`.

No borrar todavía la organización de prueba — se reutiliza en el §6 para
terminar el smoke test completo una vez configurado el dominio propio. Si el
dominio propio no se va a configurar de inmediato, seguir el §4.1 para
limpiarla ahora y repetir el registro más adelante.

### 4.1 Borrar la organización de prueba

Desde el SQL Editor del dashboard de `suite-erp-prod`, borrar en orden
FK-safe (hijos antes que padres) usando el RUT de prueba usado en el paso 1:

```sql
-- 1. Reemplazar '<RUT-NORMALIZADO>' por el RUT de prueba normalizado
--    (solo dígitos + K, tal como lo guarda app.normalizar_rut()).
--    Por ejemplo, si registraste con `76.543.210-3`, en la BD quedó `765432103` — usa ese valor en los WHERE.
with org as (
  select id from public.organizaciones where rut = '<RUT-NORMALIZADO>'
)
delete from public.suscripciones where organizacion_id in (select id from org);

with org as (
  select id from public.organizaciones where rut = '<RUT-NORMALIZADO>'
)
delete from public.miembros where organizacion_id in (select id from org);

with org as (
  select id from public.organizaciones where rut = '<RUT-NORMALIZADO>'
)
delete from public.empresas where organizacion_id in (select id from org);

delete from public.organizaciones where rut = '<RUT-NORMALIZADO>';

-- 2. Borrar el usuario de prueba de auth.users (requiere permisos de service_role;
--    hacerlo desde Authentication → Users → buscar el correo → Delete user,
--    es más simple que SQL directo sobre auth.users).
```

Orden de dependencias (de hijo a padre, según los `references` de
`00000000000001_plataforma.sql`): `suscripciones` y `miembros` referencian
`organizaciones`; `empresas` también referencia `organizaciones`; borrar los tres
antes de borrar la fila de `organizaciones`. El usuario en `auth.users` se borra
al final (o vía el panel de Authentication, más simple que SQL crudo sobre el
schema `auth`).

---

## 5. Dominio propio (prerrequisito del smoke test completo)

`erp` y `admin` no son utilizables en `*.vercel.app` (§3). Antes de poder
completar el smoke test (login → ERP → admin → activar, §6) hace falta un
dominio propio. Cuando se compre uno (ej. en [NIC Chile](https://www.nic.cl)
para un `.cl`):

1. En Vercel, agregar el dominio a cada uno de los 3 proyectos con el subdominio
   correspondiente, por ejemplo:
   - `www.dominio.cl` → proyecto `suite-erp-web`
   - `erp.dominio.cl` → proyecto `suite-erp-erp`
   - `admin.dominio.cl` → proyecto `suite-erp-admin`
2. Configurar los registros DNS que Vercel indique (usualmente `CNAME` a
   `cname.vercel-dns.com`, o los `A`/`ALIAS` que Vercel muestre) en el panel del
   registrador (NIC Chile u otro DNS que se use).
3. Una vez el dominio propio resuelve en las 3 apps, actualizar
   `NEXT_PUBLIC_COOKIE_DOMAIN=.dominio.cl` en las **3 apps** en Vercel (mismo
   dominio raíz con punto inicial, para que la cookie sea válida en todos los
   subdominios) y hacer **Redeploy** de las 3 (variable `NEXT_PUBLIC_*`, se
   incrusta en build time).
4. Esto habilita el SSO real: login en `web` deja una cookie visible también en
   `erp` y `admin`, sin pedir login de nuevo al cruzar de app — recién con esto
   `erp` y `admin` dejan de estar en bucle de login.

---

## 6. Smoke test completo (con dominio propio)

Con el dominio propio activo (§5) y las 3 apps redesplegadas con
`NEXT_PUBLIC_COOKIE_DOMAIN=.dominio.cl`, retomar el smoke test del §4:

1. Abrir `www.dominio.cl` → si la organización de prueba del §4 sigue existiendo
   iniciar sesión con las mismas credenciales; si se borró (§4.1), registrarse
   de nuevo.
2. Clic en "Entrar al ERP" (`erp.dominio.cl`) → la cookie de sesión ahora es
   válida en el subdominio → debe verse la organización directamente, sin pedir
   login otra vez (banner de trial incluido, `estado = 'trial'`).
3. Abrir `admin.dominio.cl` y loguearse con el correo listado en `ADMIN_EMAILS`
   (`rpmautz@gmail.com`) → debe verse la tabla de organizaciones, incluida la de
   prueba → pulsar **Activar** → el estado pasa a `activa`.
4. Confirmar en `erp.dominio.cl` (recargar) que el banner de trial desaparece.

Terminado el smoke test, borrar la organización de prueba siguiendo el §4.1.

---

## 7. Aplicar migraciones futuras

Cualquier migración nueva agregada a `supabase/migrations/` después de un merge a
`main` se aplica a producción con:

```powershell
pnpm supabase db push
```

(Requiere que el proyecto ya esté enlazado — `pnpm supabase link` solo hace falta
una vez por máquina/checkout, o de nuevo si se reclona el repo.)

---

## 8. Nota de mantenimiento: GRANTs en tablas nuevas

Desde que Supabase dejó de auto-exponer tablas nuevas de `public` a los roles del
Data API (`anon`, `authenticated`, `service_role`) sin GRANT explícito (ver
comentario en `supabase/migrations/00000000000001_plataforma.sql`, sección
"Grants Data API"), **toda migración futura que cree tablas en `public` debe
incluir sus propios `grant` explícitos** junto a las políticas RLS — de lo
contrario la tabla queda con RLS activo pero sin ningún rol autorizado a tocarla,
y las queries fallan con "permission denied" incluso con una policy correcta.
Esta fue una lección de la Task 4 del plan 1: RLS filtra filas, el GRANT de tabla
es el permiso de acceso que debe existir antes de que la policy aplique.

Patrón a replicar (ver la migración 1 como referencia):

```sql
grant select on public.<tabla_nueva> to authenticated;
-- + insert/update/delete según corresponda a las policies definidas
grant select, insert, update, delete on public.<tabla_nueva> to service_role;
```
