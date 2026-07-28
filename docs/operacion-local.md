# Operación local: mantener la página arriba con Docker

Las 3 apps corren como contenedores compilados con **reinicio automático** (si el
proceso crashea, Docker lo levanta solo; verificado matando el proceso interno).
Supabase local sigue siendo del CLI (`npx supabase start`), también en Docker.

## Comandos

| Acción | Comando |
|---|---|
| Dejar todo arriba (compila si hace falta) | `docker compose up -d --build` |
| Ver estado | `docker compose ps` |
| Ver logs de una app | `docker compose logs -f erp` |
| Pausar los contenedores | `docker compose stop` |
| Reanudar | `docker compose up -d` |

Arranque completo desde cero (tras reiniciar la máquina): Docker Desktop →
`npx supabase start` → `docker compose up -d`.

## Para que TODO vuelva solo tras un reinicio de Windows

Único paso manual (una vez): Docker Desktop → **Settings → General →
"Start Docker Desktop when you sign in"**. Con eso, al iniciar sesión Windows
levanta Docker, y Docker levanta los contenedores de Supabase y de las 3 apps
(política `unless-stopped`).

## Desarrollo vs contenedores

Los contenedores sirven la versión COMPILADA (sin hot-reload). Mismos puertos que
los dev servers, así que no conviven:

- **Desarrollar**: `docker compose stop` y levantar `pnpm --filter <app> dev`.
- **Volver a "siempre arriba"** con los cambios: matar los dev servers y
  `docker compose up -d --build` (el build usa caché: solo recompila lo tocado).

## host.docker.internal

Los `.env.local` usan `NEXT_PUBLIC_SUPABASE_URL=http://host.docker.internal:54321`:
esa URL resuelve DESDE los contenedores (gateway de Docker) y DESDE el navegador
del host (Docker Desktop la agrega al archivo hosts de Windows). Sirve igual para
los dev servers, así que no hay que cambiarla al alternar modos. En producción no
aplica nada de esto (Supabase cloud + Vercel).

## Nota

El `Dockerfile` copia los `.env.local` (gitignoreados) porque las `NEXT_PUBLIC_*`
se inlinean al compilar. La imagen `suite-erp:local` es de uso local: no publicarla
en ningún registry.
