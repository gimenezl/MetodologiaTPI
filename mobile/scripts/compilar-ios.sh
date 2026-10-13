#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT/mobile/ios"
workspace=$(find . -maxdepth 1 -name '*.xcworkspace' | head -n 1)
test -n "$workspace"
scheme="$(basename "$workspace" .xcworkspace)"
python3 "$ROOT/scripts/ci/run-stage.py" --stage ios-build --seconds 720 -- \
  xcodebuild -workspace "$workspace" -scheme "$scheme" -configuration Release \
  -sdk iphonesimulator -destination "platform=iOS Simulator,id=${EPT_IOS_UDID:?}" \
  -derivedDataPath "$RUNNER_TEMP/derived" ARCHS="${EPT_IOS_ARCH:?}" ONLY_ACTIVE_ARCH=YES \
  CODE_SIGN_IDENTITY=- CODE_SIGNING_REQUIRED=YES CODE_SIGNING_ALLOWED=YES DEVELOPMENT_TEAM= build
