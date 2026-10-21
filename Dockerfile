# Etapa de compilación. better-sqlite3 trae binarios precompilados para linux x64/arm64;
# python3, make y g++ quedan como respaldo si npm tuviera que compilarlo.
FROM node:22-bookworm-slim AS builder
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# Etapa final: solo lo necesario para ejecutar el bot.
FROM node:22-bookworm-slim
ENV NODE_ENV=production
# Versión y notas que fija scripts/deploy.sh. Vacías (build sin el script): no hay aviso.
ARG APP_VERSION=
ARG RELEASE_NOTES=
ENV APP_VERSION=$APP_VERSION RELEASE_NOTES=$RELEASE_NOTES
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./
# Migraciones SQL: se aplican al arrancar.
COPY drizzle ./drizzle
RUN mkdir -p /app/data && chown -R node:node /app
USER node
CMD ["node", "dist/main.js"]
