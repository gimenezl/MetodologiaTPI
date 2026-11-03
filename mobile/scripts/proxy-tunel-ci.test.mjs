import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import { capacidad, crearProxy } from './proxy-tunel-ci.mjs'

test('gateway denies direct and forged privileged requests before forwarding', async () => {
  const seed = '1'.repeat(64)
  let calls = 0
  const target = createServer((req, res) => { calls++; res.writeHead(200); res.end(req.url) }).listen(0, '127.0.0.1')
  await once(target, 'listening')
  const proxy = crearProxy({ seed, nombre: 'supabase', targetPort: target.address().port }).listen(0, '127.0.0.1')
  await once(proxy, 'listening')
  const base = `http://127.0.0.1:${proxy.address().port}`
  try {
    for (const path of ['/rest/v1/data', `/ci/${'0'.repeat(64)}/rest/v1/data`, '/ci/nope/rest/v1/data']) {
      const response = await fetch(base + path, { headers: { authorization: 'Bearer forged-service-role' } })
      assert.equal(response.status, 403)
    }
    assert.equal(calls, 0)
    const token = capacidad(seed, 'supabase')
    const response = await fetch(`${base}/ci/${token}/rest/v1/data?select=id`)
    assert.equal(response.status, 200)
    assert.equal(await response.text(), '/rest/v1/data?select=id')
    assert.equal(calls, 1)
    assert.notEqual(capacidad(seed, 'api'), token)
  } finally {
    await Promise.all([new Promise(r => proxy.close(r)), new Promise(r => target.close(r))])
  }
})

test('gateway rejects missing or malformed secret configuration', () => {
  assert.throws(() => capacidad('public-run-data', 'supabase'))
  assert.throws(() => capacidad('1'.repeat(64), 'unknown'))
})

test('CI runs the external denial and shutdown check before opening fixture tunnels', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8')
  const install = workflow.indexOf('- name: Instalar cloudflared 2026.10.1')
  const check = workflow.indexOf('- name: Verificar denegación externa y cierre de túnel sintético', install)
  const fixture = workflow.indexOf('- name: Fixture del ciclo económico (iOS)', check)
  const stage = workflow.slice(check, fixture)
  assert.ok(install >= 0 && check > install && fixture > check)
  assert.match(stage, /EPT_TUNNEL_LIVE: '1'/u)
  assert.match(stage, /node --test mobile\/scripts\/proxy-tunel-live\.test\.mjs/u)
  assert.doesNotMatch(stage, /continue-on-error|\|\|\s*true/u)
})
