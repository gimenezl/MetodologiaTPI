#!/usr/bin/env bash
set -euo pipefail
capture() { python3 scripts/ci/run-stage.py --capture --stage "$1" --seconds "$2" -- "${@:3}"; }
stage() { python3 scripts/ci/run-stage.py --stage "$1" --seconds "$2" -- "${@:3}"; }
test "$(uname -m)" = arm64
UDID="$(capture ios-list 15 xcrun simctl list devices available -j | node -e '
let text="";process.stdin.on("data", d=>text+=d).on("end",()=>{
const entries=Object.entries(JSON.parse(text).devices).filter(([runtime])=>runtime.includes("iOS")).sort(([a],[b])=>a.localeCompare(b,undefined,{numeric:true}));
const phones=entries.flatMap(([,devices])=>devices).filter(d=>d.isAvailable&&/^iPhone/.test(d.name));
if(!phones.length)process.exit(1);console.log(phones.at(-1).udid);});')"
test -n "$UDID"
printf 'EPT_IOS_UDID=%s\nEPT_IOS_ARCH=arm64\n' "$UDID" >> "${GITHUB_ENV:?}"
fingerprint="$( { capture ios-xcode-version 15 xcodebuild -version; capture ios-sdk-version 15 xcrun --sdk iphonesimulator --show-sdk-version; uname -m; printf 'Release\n'; } | shasum -a 256 | cut -d ' ' -f 1)"
printf 'EPT_IOS_TOOLCHAIN=%s\n' "$fingerprint" >> "$GITHUB_ENV"
stage ios-runtimes 15 xcrun simctl list runtimes
