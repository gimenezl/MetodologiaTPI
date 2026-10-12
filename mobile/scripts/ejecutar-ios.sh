#!/usr/bin/env bash
# Inicia un simulador de iPhone, instala la aplicación y recorre login real contra Supabase local.
# Uso: bash mobile/scripts/ejecutar-ios.sh <ruta-a-la-app>
set -euo pipefail

APP="$1"
SALIDA="${RUNNER_TEMP:?RUNNER_TEMP requerido}/evidencia-movil-ios"
mkdir -p "$SALIDA"

xcrun simctl list runtimes > "$SALIDA/ios-runtimes.txt"
UDID="$(xcrun simctl list devices available -j | node -e '
  let t = ""; process.stdin.on("data", d => t += d).on("end", () => {
    const dispositivos = Object.entries(JSON.parse(t).devices)
      .filter(([runtime]) => runtime.includes("iOS"))
      .flatMap(([, lista]) => lista)
      .filter(d => /^iPhone/.test(d.name) && d.isAvailable);
    if (!dispositivos.length) { console.error("Sin simuladores de iPhone disponibles"); process.exit(1); }
    console.log(dispositivos[dispositivos.length - 1].udid);
  });')"
echo "Simulador: $UDID" > "$SALIDA/ios-simulador.txt"

xcrun simctl boot "$UDID" || true
xcrun simctl bootstatus "$UDID" -b
xcrun simctl install "$UDID" "$APP"
xcrun simctl listapps "$UDID" | grep -F 'org.educarparatransformar.app'

set +e
maestro --device "$UDID" test --format junit --output "$SALIDA/maestro-ios.xml" \
  --test-output-dir "$SALIDA/maestro-ios" mobile/maestro/verificacion.yaml
estado=$?
set -e
exit "$estado"
