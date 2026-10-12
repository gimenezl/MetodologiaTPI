#!/usr/bin/env bash
# Instala el APK en el emulador ya iniciado y recorre login real contra Supabase local.
# Uso: bash mobile/scripts/ejecutar-android.sh <ruta-al-apk>
set -euo pipefail

APK="$1"
SALIDA="${RUNNER_TEMP:?RUNNER_TEMP requerido}/evidencia-movil-android"
mkdir -p "$SALIDA"

adb wait-for-device
adb shell getprop ro.build.version.release > "$SALIDA/android-version.txt"
adb shell getprop ro.product.cpu.abi >> "$SALIDA/android-version.txt"
adb install -r "$APK"
adb shell pm list packages | grep -F 'org.educarparatransformar.app'

# Maestro conserva sus capturas en el directorio indicado; el resultado queda en JUnit.
set +e
maestro test --format junit --output "$SALIDA/maestro-android.xml" \
  --test-output-dir "$SALIDA/maestro-android" mobile/maestro/verificacion.yaml
estado=$?
set -e
exit "$estado"
