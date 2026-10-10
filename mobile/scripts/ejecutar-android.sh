#!/usr/bin/env bash
# Instala el APK en el emulador ya iniciado y recorre el flujo de verificación con Maestro.
# Uso: bash mobile/scripts/ejecutar-android.sh <ruta-al-apk>
set -euo pipefail

APK="$1"
SALIDA="evidencia-movil"
mkdir -p "$SALIDA"

adb wait-for-device
adb shell getprop ro.build.version.release | tee "$SALIDA/android-version.txt"
adb shell getprop ro.product.cpu.abi | tee -a "$SALIDA/android-version.txt"
adb install -r "$APK"
adb shell pm list packages | grep -F 'org.educarparatransformar.app'

# Maestro conserva sus capturas en el directorio indicado; el resultado queda en JUnit.
set +e
maestro test --format junit --output "$SALIDA/maestro-android.xml" \
  --test-output-dir "$SALIDA/maestro-android" mobile/maestro/verificacion.yaml
estado=$?
set -e

adb exec-out screencap -p > "$SALIDA/android-final.png" || true
adb logcat -d -t 800 '*:E' > "$SALIDA/logcat-errores.txt" || true
exit "$estado"
