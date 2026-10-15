#!/usr/bin/env bash
# Instala el APK en el emulador ya iniciado y recorre login real contra Supabase local.
# Uso: bash mobile/scripts/ejecutar-android.sh <ruta-al-apk>
set -euo pipefail

APK="$1"
SALIDA="${RUNNER_TEMP:?RUNNER_TEMP requerido}/evidencia-movil-android"
mkdir -p "$SALIDA"
capture() { python3 scripts/ci/run-stage.py --capture --stage "$1" --seconds "$2" -- "${@:3}"; }
stage() { python3 scripts/ci/run-stage.py --stage "$1" --seconds "$2" -- "${@:3}"; }

stage android-readiness 60 adb wait-for-device
capture android-device-status 15 adb shell getprop ro.build.version.release > "$SALIDA/android-version.txt"
capture android-device-status 15 adb shell getprop ro.product.cpu.abi >> "$SALIDA/android-version.txt"
stage android-install 60 adb install -r "$APK"
capture android-installed 15 adb shell pm list packages | grep -F 'org.educarparatransformar.app'

# Maestro conserva sus capturas en el directorio indicado; el resultado queda en JUnit.
set +e
stage android-maestro 240 maestro test --format junit --output "$SALIDA/maestro-android.xml" \
  --test-output-dir "$SALIDA/maestro-android" mobile/maestro/verificacion.yaml
estado=$?
set -e
exit "$estado"
