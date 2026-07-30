# Suite ERP

ERP SaaS multi-tenant para pymes chilenas: facturación electrónica (SII), ventas,
cobranza (correo + WhatsApp), inventario, transporte, remuneraciones/Previred,
contabilidad, y un bot de WhatsApp para consultar la empresa desde el teléfono.

Monorepo pnpm + Turbo. Las carpetas siguen las convenciones de sus herramientas
(pnpm workspace, Supabase CLI, Vercel, Docker) — este mapa las agrupa por rol.

## Mapa del repositorio

### Frontend — `apps/`

| App | Puerto | Qué es |
|---|---|---|
| [`apps/web`](apps/web) | 3000 | Sitio público: landing con chat de ventas (leads), login/registro, recuperación de contraseña, consultas a administración |
| [`apps/erp`](apps/erp) | 3001 | La aplicación: dashboard, ventas/DTE, cobranza, inventario, transporte, RRHH, contabilidad, configuración, simuladores mock y widget del bot |
| [`apps/admin`](apps/admin) | 3002 | Panel de plataforma: organizaciones, recaudación, indicadores, tickets (consultas) y leads |

### Backend

| Carpeta | Qué es |
|---|---|
| [`supabase/migrations`](supabase/migrations) | El esquema completo: 31 migraciones (tablas, RLS, RPCs `security definer`) — la lógica autoritativa vive en SQL |
| [`supabase/tests/database`](supabase/tests/database) | Suite pgTAP (23 archivos): RLS multi-tenant, RPCs y mensajes byte-exactos. Corre con `npx supabase test db` |
| [`packages/`](packages) | Librerías compartidas: `core` (dominio puro: RUT, IVA, remuneraciones…), `db` (tipos generados), `auth` (clientes Supabase SSR), `correo`, `pagos`, `dte`, `whatsapp`, `bot`, `ui` |
| [`scripts/seed-demo.mjs`](scripts/seed-demo.mjs) | Datos demo chilenos (correr tras `supabase db reset`) |

### Documentación — `docs/`

Ver el índice en [`docs/README.md`](docs/README.md): guía de deploy, operación local
con Docker, credenciales pendientes, y los specs/planes de cada fase en
`docs/superpowers/`.

### Agentes y tooling (no es fuente)

`.superpowers/`, `.remember/`, `.playwright-mcp/` son carpetas de trabajo de los
agentes (rutas fijas de sus plugins, gitignoreadas). `graphify-out/` sí se
versiona: es el mapa navegable del código. `.github/workflows` corre la suite
pgTAP en CI.

## Comandos esenciales

```bash
# Desarrollo (hot-reload)
npx supabase start          # backend local (Docker)
pnpm dev                    # las 3 apps

# Página siempre arriba (contenedores compilados, ver docs/operacion-local.md)
docker compose up -d --build

# Verificación
npx supabase test db        # pgTAP (23 archivos)
pnpm test                   # unit de packages
pnpm build --concurrency=1  # 3 apps (NUNCA con los dev servers corriendo)
```

Credenciales y URLs del entorno local: `docs/operacion-local.md` y el seed.
