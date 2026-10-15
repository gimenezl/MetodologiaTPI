#!/usr/bin/env bash
set -euo pipefail
capture() { python3 scripts/ci/run-stage.py --capture --stage "$1" --seconds "$2" -- "${@:3}"; }
stage() { python3 scripts/ci/run-stage.py --stage "$1" --seconds "$2" -- "${@:3}"; }
test "$(uname -m)" = arm64
stage ios-owned-create 190 python3 mobile/scripts/ios-simulator.py create
fingerprint="$( { capture ios-xcode-version 15 xcodebuild -version; capture ios-sdk-version 20 xcrun --sdk iphonesimulator --show-sdk-version; uname -m; printf 'Release\n'; } | shasum -a 256 | cut -d ' ' -f 1)"
printf 'EPT_IOS_TOOLCHAIN=%s\n' "$fingerprint" >> "$GITHUB_ENV"
stage ios-xcode-diagnostic 15 xcodebuild -version
stage ios-sdk-diagnostic 20 xcrun --sdk iphonesimulator --show-sdk-version
