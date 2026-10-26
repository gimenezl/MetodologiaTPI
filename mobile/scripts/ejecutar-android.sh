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

# Archivos sintéticos para el selector real del sistema (EPT-109): se generan y se copian a Descargas.
ARCHIVOS="$(mktemp -d)"
node mobile/scripts/archivos-prueba.mjs "$ARCHIVOS"
stage android-push-archivos 60 adb push "$ARCHIVOS/comprobante-ci.pdf" /sdcard/Download/comprobante-ci.pdf
stage android-push-archivos 60 adb push "$ARCHIVOS/comprobante-ci.png" /sdcard/Download/comprobante-ci.png
# Indexa los archivos para que el selector los liste (el escaneo manual es inofensivo si ya figuran).
adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Download/comprobante-ci.pdf > /dev/null || true
adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Download/comprobante-ci.png > /dev/null || true

# Maestro conserva sus capturas en el directorio indicado; el resultado queda en JUnit.
set +e
stage android-maestro 240 maestro test --format junit --output "$SALIDA/maestro-android.xml" \
  --test-output-dir "$SALIDA/maestro-android" mobile/maestro/verificacion.yaml
estado=$?
if [ "$estado" -eq 0 ]; then
  stage android-stop-comprobante 20 node mobile/scripts/android-detener.mjs &&
  stage android-maestro-comprobante 240 maestro test --format junit --output "$SALIDA/maestro-comprobante.xml" \
    --test-output-dir "$SALIDA/maestro-comprobante" mobile/maestro/comprobante.yaml
  estado=$?
fi
if [ "$estado" -eq 0 ]; then
  # EPT-110: escenarios focales y separados (cada uno con su propio presupuesto, sin ampliar el monolito).
  stage android-stop-consultas 20 node mobile/scripts/android-detener.mjs &&
  stage android-maestro-consultas 180 maestro test --format junit --output "$SALIDA/maestro-consultas.xml" \
    --test-output-dir "$SALIDA/maestro-consultas" mobile/maestro/consultas.yaml
  estado=$?
fi
if [ "$estado" -eq 0 ]; then
  stage android-stop-consultas-estudiante 20 node mobile/scripts/android-detener.mjs &&
  stage android-maestro-consultas-estudiante 150 maestro test --format junit --output "$SALIDA/maestro-consultas-estudiante.xml" \
    --test-output-dir "$SALIDA/maestro-consultas-estudiante" mobile/maestro/consultas-estudiante.yaml
  estado=$?
fi
if [ "$estado" -eq 0 ]; then
  # EPT-114: deuda por ítem, escenario focal y separado (presupuesto propio, sin ampliar el monolito).
  stage android-stop-deuda 20 node mobile/scripts/android-detener.mjs &&
  stage android-maestro-deuda 150 maestro test --format junit --output "$SALIDA/maestro-deuda.xml" \
    --test-output-dir "$SALIDA/maestro-deuda" mobile/maestro/deuda.yaml
  estado=$?
fi
if [ "$estado" -eq 0 ]; then
  stage android-stop-recibos 20 node mobile/scripts/android-detener.mjs &&
  stage android-maestro-recibos 180 maestro test --format junit --output "$SALIDA/maestro-recibos.xml" \
    --test-output-dir "$SALIDA/maestro-recibos" mobile/maestro/recibos.yaml
  estado=$?
fi
if [ "$estado" -eq 0 ]; then
  # EPT-119: ciclo económico conectado sobre los mismos registros: la app paga y carga; Dirección aprueba uno y
  # rechaza otro desde la web real; la app y los informes reflejan el mismo estado y los importes esperados.
  stage android-stop-ciclo 20 node mobile/scripts/android-detener.mjs &&
  stage android-maestro-ciclo-pago 240 maestro test --format junit --output "$SALIDA/maestro-ciclo-pago.xml" \
    --test-output-dir "$SALIDA/maestro-ciclo-pago" mobile/maestro/ciclo-pago.yaml &&
  stage android-ciclo-decidir 240 node mobile/scripts/ciclo-economico.mjs decidir android &&
  stage android-stop-ciclo-estado 20 node mobile/scripts/android-detener.mjs &&
  stage android-maestro-ciclo-estado 240 maestro test --format junit --output "$SALIDA/maestro-ciclo-estado.xml" \
    --test-output-dir "$SALIDA/maestro-ciclo-estado" mobile/maestro/ciclo-estado.yaml &&
  stage android-ciclo-verificar 120 node mobile/scripts/ciclo-economico.mjs verificar android
  estado=$?
fi
if [ "$estado" -eq 0 ]; then
  # EPT-106: recuperación y cambio de contraseña con correo y enlace reales (Mailpit local).
  bash mobile/scripts/recuperacion-android.sh "$SALIDA"
  estado=$?
fi
set -e
exit "$estado"
