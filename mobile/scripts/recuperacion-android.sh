#!/usr/bin/env bash
# Escenario focal de recuperación de contraseña (EPT-106) en el emulador Android, con correo y enlace reales:
#   1. la app pide el correo a Auth (GoTrue local);
#   2. Mailpit lo captura y este script entrega el enlace al teléfono (el enlace no se imprime);
#   3. la app cambia la contraseña, rechaza la anterior, cambia desde Mi cuenta y rechaza el enlace usado.
# Uso: bash mobile/scripts/recuperacion-android.sh <directorio-de-evidencia>
set -euo pipefail

SALIDA="${1:?directorio de evidencia requerido}"
stage() { python3 scripts/ci/run-stage.py --stage "$1" --seconds "$2" -- "${@:3}"; }

stage android-maestro-recuperacion-solicitud 150 maestro test --format junit --output "$SALIDA/maestro-recuperacion-solicitud.xml" \
  --test-output-dir "$SALIDA/maestro-recuperacion-solicitud" mobile/maestro/recuperacion-solicitud.yaml

ENLACE="$(node mobile/scripts/recuperacion-enlace.mjs)"
test -n "$ENLACE"
echo "::add-mask::$ENLACE"
export MAESTRO_RECUPERACION_ENLACE="$ENLACE"

stage android-maestro-recuperacion-cambio 240 maestro test --format junit --output "$SALIDA/maestro-recuperacion-cambio.xml" \
  --test-output-dir "$SALIDA/maestro-recuperacion-cambio" mobile/maestro/recuperacion-cambio.yaml
