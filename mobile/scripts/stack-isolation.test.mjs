import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'

test('cleanup does not touch a foreign stack or another CI run', () => {
  for (const prefix of ['foreign-stack-', 'ept105-supabase-']) {
    const directory = mkdtempSync(join(tmpdir(), prefix))
    try {
      mkdirSync(join(directory, 'supabase'))
      const config = 'project_id = "ept105-123456abcdef"\n'
      writeFileSync(join(directory, 'supabase/config.toml'), config)
      writeFileSync(join(directory, 'owner.json'), JSON.stringify({ run: 'other-run', attempt: '1' }))
      const result = spawnSync(process.execPath, [join(import.meta.dirname, 'supabase-local.mjs'), 'stop'], {
        encoding: 'utf8', timeout: 5000,
        env: { ...process.env, EPT_MOBILE_SUPABASE_WORKDIR: directory, EPT_SUPABASE_CLI_ENTRY: 'must-not-run', GITHUB_RUN_ID: 'owned-run', GITHUB_RUN_ATTEMPT: '1' },
      })
      assert.equal(result.status, 0, result.stderr)
      assert.equal(readFileSync(join(directory, 'supabase/config.toml'), 'utf8'), config)
      assert.doesNotMatch(result.stderr, /supabase-stop|cleanup-supabase|must-not-run/u)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }
})
