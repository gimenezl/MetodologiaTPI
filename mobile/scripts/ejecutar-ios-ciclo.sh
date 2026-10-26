#!/usr/bin/env bash
# EPT-119: ciclo económico conectado en un simulador de iPhone propio. El backend (Supabase + Next + Dirección en la
# web) corre en el job Linux y llega por túnel HTTPS; aquí solo vive el simulador con la app real.
# Uso: bash mobile/scripts/ejecutar-ios-ciclo.sh <ruta-a-la-app>
set -euo pipefail
export EPT_IOS_STEP_STARTED_AT="$(node -e 'console.log(Date.now())')"
# Presupuesto propio del step (30 min): incluye la espera de la decisión de Dirección en la web.
export EPT_IOS_PRESUPUESTO_MS=1800000

APP="$1"
SALIDA="${RUNNER_TEMP:?RUNNER_TEMP requerido}/evidencia-movil-ios"
mkdir -p "$SALIDA"

UDID="$(node mobile/scripts/ios-simulador.mjs crear)"
echo "Simulador del ciclo: $UDID" | tee "$SALIDA/ios-simulador-ciclo.txt"

finalizar() {
  resultado=$?
  node mobile/scripts/ios-simulador.mjs limpiar || resultado=1
  exit "$resultado"
}
trap finalizar EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

xcrun simctl boot "$UDID"
open -a "$DEVELOPER_DIR/Applications/Simulator.app" --args -CurrentDeviceUDID "$UDID"
xcrun simctl bootstatus "$UDID" -b
xcrun simctl install "$UDID" "$APP"
xcrun simctl listapps "$UDID" | grep -F 'org.educarparatransformar.app'

# Comprobante sintético en la fototeca del simulador (selector de fotos del sistema).
ARCHIVOS="$(mktemp -d)"
node mobile/scripts/archivos-prueba.mjs "$ARCHIVOS"
xcrun simctl addmedia "$UDID" "$ARCHIVOS/comprobante-ci.png"

set +e
# El driver XCUITest de Maestro a veces no arranca a tiempo («driver not ready»). Solo esa firma, que ocurre ANTES de
# ejecutar ningún paso, se reintenta una vez; el fallo de un paso del flujo nunca se reintenta.
correr_maestro() {
  local etiqueta="$1" flujo="$2" intento resultado
  for intento in 1 2; do
    maestro --device "$UDID" test --format junit --output "$SALIDA/maestro-$etiqueta.xml" \
      --debug-output "$SALIDA/$etiqueta-debug" --flatten-debug-output \
      --test-output-dir "$SALIDA/maestro-$etiqueta" "$flujo" 2>&1 | tee "$SALIDA/$etiqueta-intento$intento.out"
    resultado="${PIPESTATUS[0]}"
    if [ "$resultado" -eq 0 ]; then return 0; fi
    grep -q 'driver not ready' "$SALIDA/$etiqueta-intento$intento.out" || return "$resultado"
    echo "Driver de iOS no listo antes de ejecutar pasos: se reintenta una sola vez ($etiqueta)."
  done
  return "$resultado"
}

correr_maestro ciclo-pago mobile/maestro/ciclo-pago.yaml
estado=$?
if [ "$estado" -eq 0 ]; then
  # Dirección decide en la web (job Linux); se espera al estado real del pago, sin esperas fijas.
  node mobile/scripts/ciclo-espera-remota.mjs ios
  estado=$?
fi
if [ "$estado" -eq 0 ]; then
  correr_maestro ciclo-estado mobile/maestro/ciclo-estado.yaml
  estado=$?
fi
if [ "$estado" -eq 0 ]; then
  node mobile/scripts/ios-completitud.mjs "$SALIDA" ciclo
  estado=$?
fi
node mobile/scripts/diagnostico-ios.mjs "$UDID" pantalla || true
set -e
exit "$estado"
