import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const linux = process.platform === 'linux'
const script = fileURLToPath(new URL('./tunel-efimero.mjs', import.meta.url))
const wait = milliseconds => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)

test('tunnel cleanup stops both owned process groups', { skip: !linux }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tunnel-stop-'))
  const processes = []
  try {
    mkdirSync(join(dir, '.privado'))
    for (const name of ['supabase', 'api', 'proxy']) {
      const child = spawn('sleep', ['180'], { detached: true, stdio: 'ignore' })
      child.unref()
      processes.push(child.pid)
      writeFileSync(join(dir, '.privado', `${name}.pid`), String(child.pid))
    }
    const result = spawnSync(process.execPath, [script, 'stop', dir], { encoding: 'utf8', timeout: 25_000 })
    assert.equal(result.status, 0, result.stderr)
  } finally {
    for (const pid of processes) try { process.kill(-pid, 'SIGKILL') } catch { /* already stopped */ }
    rmSync(dir, { recursive: true, force: true })
  }
})

test('tunnel cleanup fails closed if a process group ignores termination', { skip: !linux, timeout: 25_000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tunnel-stop-'))
  let pid
  try {
    mkdirSync(join(dir, '.privado'))
    const child = spawn('sh', ['-c', 'trap : TERM; while :; do sleep 1; done'], { detached: true, stdio: 'ignore' })
    child.unref()
    pid = child.pid
    writeFileSync(join(dir, '.privado', 'supabase.pid'), String(pid))
    wait(200)
    const result = spawnSync(process.execPath, [script, 'stop', dir], { encoding: 'utf8', timeout: 20_000 })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /No se pudo comprobar el cierre/u)
  } finally {
    if (pid) try { process.kill(-pid, 'SIGKILL') } catch { /* already stopped */ }
    rmSync(dir, { recursive: true, force: true })
  }
})

test('tunnel cleanup rejects missing process identity when an endpoint was issued', { skip: !linux }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tunnel-stop-'))
  try {
    mkdirSync(join(dir, '.privado'))
    writeFileSync(join(dir, 'urls.json'), '{}')
    const result = spawnSync(process.execPath, [script, 'stop', dir], { encoding: 'utf8', timeout: 5_000 })
    assert.equal(result.status, 1)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
