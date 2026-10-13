#!/usr/bin/env bash
set -euo pipefail
stage() { python3 scripts/ci/run-stage.py --stage "$1" --seconds "$2" -- "${@:3}"; }
if stage docker-status 15 docker info --format '{{.Architecture}} {{.NCPU}} {{.MemTotal}}'; then
  echo 'Docker local disponible para Supabase efímero.'
  exit 0
fi
# Preserve the proven Intel/QEMU route; VZ is unavailable on the audited runner.
stage docker-install 120 brew install colima docker qemu
PROFILE="ept105-${GITHUB_RUN_ID:?}-${GITHUB_RUN_ATTEMPT:?}"
printf 'EPT_COLIMA_PROFILE=%s\n' "$PROFILE" >> "${GITHUB_ENV:?}"
stage docker-vm 300 colima start --profile "$PROFILE" --vm-type qemu --mount-type 9p --cpu 4 --memory 6 --disk 50
export DOCKER_HOST="unix://${HOME}/.colima/${PROFILE}/docker.sock"
stage docker-readiness 15 docker info --format '{{.Architecture}} {{.NCPU}} {{.MemTotal}}'
printf 'DOCKER_HOST=%s\n' "$DOCKER_HOST" >> "$GITHUB_ENV"
