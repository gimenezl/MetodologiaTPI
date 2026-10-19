#!/usr/bin/env bash
# Inicia un simulador de iPhone, instala la aplicación y recorre el smoke de Maestro (sin backend).
# El E2E con Auth/RLS reales corre en Android; iOS prueba acceso/recuperación y compartir PDF sintético, sin backend.
# Uso: bash mobile/scripts/ejecutar-ios.sh <ruta-a-la-app>
set -euo pipefail

APP="$1"
SALIDA="${RUNNER_TEMP:?RUNNER_TEMP requerido}/evidencia-movil-ios"
mkdir -p "$SALIDA"

xcrun simctl list runtimes | tee "$SALIDA/ios-runtimes.txt"
UDID="$(xcrun simctl list devices available -j | node -e '
  let t = ""; process.stdin.on("data", d => t += d).on("end", () => {
    const dispositivos = Object.entries(JSON.parse(t).devices)
      .filter(([runtime]) => runtime.includes("iOS"))
      .flatMap(([, lista]) => lista)
      .filter(d => /^iPhone/.test(d.name) && d.isAvailable);
    if (!dispositivos.length) { console.error("Sin simuladores de iPhone disponibles"); process.exit(1); }
    console.log(dispositivos[dispositivos.length - 1].udid);
  });')"
echo "Simulador: $UDID" | tee "$SALIDA/ios-simulador.txt"

xcrun simctl boot "$UDID" || true
xcrun simctl bootstatus "$UDID" -b
xcrun simctl install "$UDID" "$APP"
xcrun simctl listapps "$UDID" | grep -F 'org.educarparatransformar.app'

set +e
maestro --device "$UDID" test --format junit --output "$SALIDA/maestro-ios.xml" \
  --debug-output "$SALIDA/smoke-debug" --flatten-debug-output \
  --test-output-dir "$SALIDA/maestro-ios" mobile/maestro/smoke-ios.yaml
estado=$?
node mobile/scripts/diagnostico-ios.mjs "$UDID" smoke || true
# EPT-106: enlace profundo y formularios de recuperación (solo lo nativo; sin correo ni backend).
if [ "$estado" -eq 0 ]; then
  maestro --device "$UDID" test --format junit --output "$SALIDA/maestro-ios-recuperacion.xml" \
    --debug-output "$SALIDA/recuperacion-debug" --flatten-debug-output \
    --test-output-dir "$SALIDA/maestro-ios-recuperacion" mobile/maestro/recuperacion-ios.yaml
  estado=$?
  node mobile/scripts/diagnostico-ios.mjs "$UDID" recuperacion || true
fi
if [ "$estado" -eq 0 ]; then
  maestro --device "$UDID" test --format junit --output "$SALIDA/maestro-ios-recibos.xml" \
    --debug-output "$SALIDA/recibos-debug" --flatten-debug-output \
    --test-output-dir "$SALIDA/maestro-ios-recibos" mobile/maestro/recibos-ios.yaml
  estado=$?
  node mobile/scripts/diagnostico-ios.mjs "$UDID" recibos || true
fi
set -e

xcrun simctl io "$UDID" screenshot "$SALIDA/ios-final.png" || true
exit "$estado"
