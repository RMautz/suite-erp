# Imagen UNICA del monorepo (operacion local "siempre arriba", 2026-07-24): se
# compilan las 3 apps una vez y los 3 contenedores del compose la comparten, cada
# uno con su comando. Los .env.local (gitignoreados) SI viajan al build porque las
# NEXT_PUBLIC_* se inlinean al compilar — la imagen es local, no se publica.
FROM node:22-alpine

RUN corepack enable
WORKDIR /repo

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm build --concurrency=1

EXPOSE 3000 3001 3002
# El comando lo pone cada servicio del compose: pnpm --filter <app> start
CMD ["pnpm", "--filter", "web", "start"]
