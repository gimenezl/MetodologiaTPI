#!/usr/bin/env bash
# EPT-119/EPT-121: el log del runner XCTest mostró «Mach error -308 (server died)» e «Invalid device state»: el servicio
# CoreSimulator murió y el reintento reutilizaba el mismo simulador roto. Antes de reintentar se lo apaga, se reinicia el
# servicio, se lo vuelve a arrancar y se reinstala la app. Uso: source ios-reiniciar-simulador.sh; reiniciar_simulador UDID APP
reiniciar_simulador() {
  local udid="$1" app="$2"
  xcrun simctl shutdown "$udid" || true
  killall -9 com.apple.CoreSimulator.CoreSimulatorService 2>/dev/null || true
  sleep 5
  xcrun simctl boot "$udid"
  xcrun simctl bootstatus "$udid" -b
  xcrun simctl install "$udid" "$app"
}

# EPT-121: el plazo de arranque del driver de Maestro no se respeta de forma fiable (run 40767553107: el primer intento
# tardó ~12 min en fallar con 120 s configurados). Ejecuta el comando redirigiendo su salida a un archivo y, si en
# `limite_s` segundos no aparece «Waiting for flows to complete» (el driver conectó y los flujos empezaron), lo mata y
# deja la firma «driver not ready» para que el reintento reinicie el simulador. Uso: vigilar_maestro LIMITE SALIDA CMD...
vigilar_maestro() {
  local limite="$1" salida="$2" pid inicio=$SECONDS resultado
  shift 2
  "$@" > "$salida" 2>&1 &
  pid=$!
  tail -f "$salida" &
  local cola=$!
  while kill -0 "$pid" 2>/dev/null; do
    if ! grep -q 'Waiting for flows to complete' "$salida" && [ $((SECONDS - inicio)) -ge "$limite" ]; then
      echo "iOS driver not ready (vigilancia: sin conexión tras ${limite}s)" >> "$salida"
      pkill -TERM -P "$pid" 2>/dev/null || true
      pkill -f 'maestro.cli' 2>/dev/null || true
      kill -TERM "$pid" 2>/dev/null || true
      break
    fi
    sleep 5
  done
  wait "$pid" 2>/dev/null
  resultado=$?
  sleep 1
  kill "$cola" 2>/dev/null || true
  grep -q 'driver not ready' "$salida" && [ "$resultado" -eq 0 ] && resultado=1
  return "$resultado"
}
