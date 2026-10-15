#!/usr/bin/env bash
set -euo pipefail
APP="$1"
SALIDA="${EPT_IOS_EVIDENCE_DIR:-${RUNNER_TEMP:?}/evidencia-movil-ios}"
mkdir -p "$SALIDA"
capture() { python3 scripts/ci/run-stage.py --capture --stage "$1" --seconds "$2" -- "${@:3}"; }
stage() { printf 'ios_stage=%s remaining_s=%s\n' "$1" "$(( ${EPT_NATIVE_DEADLINE:?} - $(date +%s) ))"; python3 scripts/ci/run-stage.py --stage "$1" --seconds "$2" -- "${@:3}"; }
UDID="${EPT_IOS_UDID:?}"
printf 'simulador=%s arquitectura=%s\n' "$UDID" "${EPT_IOS_ARCH:?}" > "$SALIDA/ios-simulador.txt"
python3 mobile/scripts/ios-simulator.py require-booted
binary="$APP/$(capture ios-bundle-name 15 /usr/libexec/PlistBuddy -c 'Print CFBundleExecutable' "$APP/Info.plist")"
capture ios-artifact-arch 15 lipo -archs "$binary" | tee "$SALIDA/ios-architecture.txt" | grep -Fx "${EPT_IOS_ARCH}"
stage ios-install 60 xcrun simctl install "$UDID" "$APP"
capture ios-installed 15 xcrun simctl listapps "$UDID" | grep -F 'org.educarparatransformar.app'
stage ios-app-launch 30 xcrun simctl launch "$UDID" org.educarparatransformar.app
stage maestro-version 15 maestro --version
capture maestro-test-help 15 maestro test --help | grep -F -- --debug-output
python3 mobile/scripts/ios-simulator.py driver-preflight
status=0
stage ios-maestro 240 maestro --device "$UDID" test --format junit --output "$SALIDA/maestro-ios.xml" \
  --debug-output "$SALIDA/maestro-ios" --flatten-debug-output --test-output-dir "$SALIDA/maestro-ios" mobile/maestro/verificacion.yaml || status=$?
# Source-pinned XCTest logs are retained in the explicit debug directory even on failure.
python3 mobile/scripts/ios-simulator.py status || true
exit "$status"
