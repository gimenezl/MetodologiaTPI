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
