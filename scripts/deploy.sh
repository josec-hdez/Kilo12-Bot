#!/usr/bin/env bash
# Actualiza el bot en el VPS: trae main, construye la imagen con la versión (commit
# corto) y las notas (títulos de los PR mezclados desde el despliegue anterior) y la
# levanta. Al arrancar con una versión nueva, el bot avisa a todos los autorizados.
#
# Uso, desde la carpeta del repositorio en el VPS:  ./scripts/deploy.sh
set -euo pipefail

cd "$(dirname "$0")/.."

previous=$(git rev-parse HEAD)
git pull --ff-only

APP_VERSION=$(git rev-parse --short HEAD)
# El cuerpo de un commit de merge de GitHub es el título del PR. Una nota por línea,
# unidas con "\n" escrito como texto para que viajen en una sola variable.
RELEASE_NOTES=$(git log --merges --format=%b "${previous}..HEAD" | sed '/^[[:space:]]*$/d' | awk '{ printf "%s%s", (NR > 1 ? "\\n" : ""), $0 }')
export APP_VERSION RELEASE_NOTES

echo "Desplegando v${APP_VERSION}"
docker compose up -d --build
