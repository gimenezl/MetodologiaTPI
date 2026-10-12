#!/usr/bin/env bash
set -euo pipefail

# Supabase local exige Docker. El runner iOS usa Colima si no recibe un daemon.
if docker info >/dev/null 2>&1; then
  echo 'Docker local disponible para Supabase efímero.'
  exit 0
fi

brew install colima docker
colima start --vm-type vz --cpu 4 --memory 6 --disk 50
docker_host="unix://${HOME}/.colima/default/docker.sock"
export DOCKER_HOST="$docker_host"
docker info >/dev/null
printf 'DOCKER_HOST=%s\n' "$docker_host" >> "$GITHUB_ENV"
echo 'Daemon Docker efímero disponible para el stack local de pruebas.'
