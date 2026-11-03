import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createClient } from '@supabase/supabase-js'
import { capacidad, crearProxy } from './proxy-tunel-ci.mjs'

test('actual Supabase JS client preserves the CI capability for auth, REST and storage', async () => {
  const seed = '2'.repeat(64)
  const paths = []
  const target = createServer((req, res) => {
    paths.push(req.url)
    res.writeHead(400, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ message: 'synthetic backend', error: 'synthetic' }))
  }).listen(0, '127.0.0.1')
  await once(target, 'listening')
  const proxy = crearProxy({ seed, nombre: 'supabase', targetPort: target.address().port }).listen(0, '127.0.0.1')
  await once(proxy, 'listening')
  const base = `http://127.0.0.1:${proxy.address().port}/ci/${capacidad(seed, 'supabase')}`
  const client = createClient(base, 'synthetic-anon-key', { auth: { persistSession: false, autoRefreshToken: false } })
  try {
    await client.auth.signInWithPassword({ email: 'synthetic@example.invalid', password: 'synthetic' })
    await client.from('fixture').select('*')
    await client.storage.from('synthetic').upload('fixture.txt', new Blob(['synthetic']))
    assert.ok(paths.some(path => path.startsWith('/auth/v1/token?')))
    assert.ok(paths.some(path => path.startsWith('/rest/v1/fixture?')))
    assert.ok(paths.some(path => path.startsWith('/storage/v1/object/synthetic/fixture.txt')))
  } finally {
    await Promise.all([new Promise(r => proxy.close(r)), new Promise(r => target.close(r))])
  }
})
