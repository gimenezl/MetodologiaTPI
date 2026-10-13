#!/usr/bin/env bash
set -euo pipefail
mode="${1:-web}"
case "$mode" in web|--isolated) ;; *) echo 'Modo instalador desconocido' >&2; exit 1 ;; esac
npm install --prefix "$RUNNER_TEMP/supabase-cli" --no-save --package-lock=false supabase@2.117.0
entry="$RUNNER_TEMP/supabase-cli/node_modules/supabase/dist/supabase.js"
node "$entry" --version | grep -Fx '2.117.0'
if [ "$mode" = --isolated ]; then
  printf 'EPT_SUPABASE_CLI_ENTRY=%s\n' "$entry" >> "${GITHUB_ENV:?}"
  node "$entry" start --help
  exit 0
fi
ln -s "$RUNNER_TEMP/supabase-cli/node_modules/supabase" node_modules/supabase
ln -s "$RUNNER_TEMP/supabase-cli/node_modules/.bin/supabase" node_modules/.bin/supabase
git diff --exit-code -- package.json package-lock.json
node --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
for (const name of ['@supabase/auth-js', '@supabase/supabase-js', 'next', '@playwright/test']) {
  const actual = JSON.parse(readFileSync(`node_modules/${name}/package.json`, 'utf8')).version;
  const expected = lock.packages[`node_modules/${name}`].version;
  if (actual !== expected) throw new Error(`${name}: ${actual} != lock ${expected}`);
  console.log(`${name}: ${actual} (lock verificado)`);
}
NODE
