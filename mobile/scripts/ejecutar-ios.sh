#!/usr/bin/env bash
set -euo pipefail
APP="$1"
SALIDA="${RUNNER_TEMP:?}/evidencia-movil-ios"
mkdir -p "$SALIDA"
capture() { python3 scripts/ci/run-stage.py --capture --stage "$1" --seconds "$2" -- "${@:3}"; }
stage() { python3 scripts/ci/run-stage.py --stage "$1" --seconds "$2" -- "${@:3}"; }
UDID="${EPT_IOS_UDID:?}"
printf 'simulador=%s arquitectura=%s\n' "$UDID" "${EPT_IOS_ARCH:?}" > "$SALIDA/ios-simulador.txt"
stage ios-device-status 15 xcrun simctl list devices available
state=$(capture ios-device-json 15 xcrun simctl list devices available -j | node -e 'let t="";process.stdin.on("data",d=>t+=d).on("end",()=>{const d=Object.values(JSON.parse(t).devices).flat().find(d=>d.udid===process.env.EPT_IOS_UDID);if(!d)process.exit(1);console.log(d.state)})')
if [ "$state" != Booted ]; then stage ios-boot 30 xcrun simctl boot "$UDID"; fi
stage ios-bootstatus 120 xcrun simctl bootstatus "$UDID" -b
binary="$APP/$(capture ios-bundle-name 15 /usr/libexec/PlistBuddy -c 'Print CFBundleExecutable' "$APP/Info.plist")"
capture ios-artifact-arch 15 lipo -archs "$binary" | grep -Fx "${EPT_IOS_ARCH}"
stage ios-install 60 xcrun simctl install "$UDID" "$APP"
capture ios-installed 15 xcrun simctl listapps "$UDID" | grep -F 'org.educarparatransformar.app'
stage ios-app-launch 30 xcrun simctl launch "$UDID" org.educarparatransformar.app
stage maestro-version 15 maestro --version
status=0
stage ios-maestro 240 maestro --device "$UDID" test --format junit --output "$SALIDA/maestro-ios.xml" \
  --test-output-dir "$SALIDA/maestro-ios" mobile/maestro/verificacion.yaml || status=$?
# Safe metadata only; no simulator log archive containing session payloads.
stage ios-driver-processes 10 ps -axo pid,ppid,pcpu,rss,comm || true
stage ios-driver-ports 10 lsof -n -iTCP -sTCP:LISTEN -Fpcn || true
exit "$status"
