#!/usr/bin/env bash
# Inicia un simulador de iPhone, instala la aplicación y recorre el smoke de Maestro (sin backend).
# El E2E con Auth/RLS reales corre en Android; iOS prueba acceso/recuperación y compartir PDF sintético, sin backend.
# Uso: bash mobile/scripts/ejecutar-ios.sh <ruta-a-la-app>
set -euo pipefail

APP="$1"
SALIDA="${RUNNER_TEMP:?RUNNER_TEMP requerido}/evidencia-movil-ios"
mkdir -p "$SALIDA"

xcrun simctl list runtimes | tee "$SALIDA/ios-runtimes.txt"
# Identidad explicita y dispositivo propio, nunca el ultimo del orden JSON.
UDID="$(node mobile/scripts/ios-simulador.mjs crear)"
echo "Simulador: $UDID" | tee "$SALIDA/ios-simulador.txt"
CAPTURA_PID=""

# Recolector propio: se cierra también si Maestro falla o el step recibe TERM.
finalizar_captura() {
  resultado=$?
  if [ -n "$CAPTURA_PID" ]; then
  kill -TERM "$CAPTURA_PID" 2>/dev/null || true
  # Límite de cierre del recolector propio, no una espera de readiness del driver.
  for intento in {1..20}; do
    kill -0 "$CAPTURA_PID" 2>/dev/null || break
    sleep 0.1
  done
  if kill -0 "$CAPTURA_PID" 2>/dev/null; then kill -KILL "$CAPTURA_PID" 2>/dev/null || true; fi
  wait "$CAPTURA_PID" 2>/dev/null || true
  fi
  node mobile/scripts/ios-simulador.mjs limpiar || resultado=1
  exit "$resultado"
}
trap finalizar_captura EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

xcrun simctl boot "$UDID"
node mobile/scripts/ios-captura-temprana.mjs "$UDID" &
CAPTURA_PID=$!
open -a "$DEVELOPER_DIR/Applications/Simulator.app" --args -CurrentDeviceUDID "$UDID"
xcrun simctl bootstatus "$UDID" -b
xcrun simctl install "$UDID" "$APP"
xcrun simctl listapps "$UDID" | grep -F 'org.educarparatransformar.app'

set +e
# Una sola sesion del driver; cada subflujo conserva clearState y sus aserciones.
maestro --device "$UDID" test --format junit --output "$SALIDA/maestro-ios.xml" \
  --debug-output "$SALIDA/suite-debug" --flatten-debug-output \
  --test-output-dir "$SALIDA/maestro-ios" mobile/maestro/suite-ios.yaml
estado=$?
node mobile/scripts/ios-completitud.mjs "$SALIDA"
completitud=$?
if [ "$estado" -eq 0 ] && [ "$completitud" -ne 0 ]; then estado=1; fi
node mobile/scripts/diagnostico-ios.mjs "$UDID" final || true
node mobile/scripts/diagnostico-ios.mjs "$UDID" pantalla || true
set -e
exit "$estado"
