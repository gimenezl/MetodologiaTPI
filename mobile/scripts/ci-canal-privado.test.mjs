import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crearPar, cifrar, descifrar } from './ci-canal-privado.mjs'

test('encrypted handshake is confidential and bound to the run and attempt', () => {
  const { publicKey, privateKey } = crearPar()
  const content = { credential: 'synthetic-confidential-value', url: 'https://example.invalid' }
  const message = cifrar(publicKey, content, 123, 2)
  assert.ok(!message.includes(content.credential))
  assert.deepEqual(descifrar(privateKey, message, 123, 2), content)
  assert.throws(() => descifrar(privateKey, message, 124, 2))
  assert.throws(() => descifrar(privateKey, message, 123, 3))
  const changed = JSON.parse(message)
  changed.tag = `${changed.tag[0] === 'A' ? 'B' : 'A'}${changed.tag.slice(1)}`
  assert.throws(() => descifrar(privateKey, JSON.stringify(changed), 123, 2))
  assert.throws(() => descifrar(crearPar().privateKey, message, 123, 2))
})

test('invalid contexts and oversized envelopes fail closed', () => {
  const { publicKey, privateKey } = crearPar()
  assert.throws(() => cifrar(publicKey, {}, '1\nINJECTED=1', 1))
  assert.throws(() => cifrar(publicKey, { data: 'x'.repeat(17_000) }, 1, 1))
  assert.throws(() => descifrar(privateKey, 'x'.repeat(33_000), 1, 1))
  assert.throws(() => descifrar(privateKey, '{"v":1}', 1, 1))
})

test('separate processes exchange only ciphertext and remove plaintext after sealing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'private-ci-test-'))
  const script = fileURLToPath(new URL('./ci-canal-privado.mjs', import.meta.url))
  const envFile = join(dir, 'github-env')
  const priv = join(dir, 'private.pem'), pub = join(dir, 'public.pem')
  const plain = join(dir, 'plaintext.json'), sealed = join(dir, 'sealed.json'), output = join(dir, 'output.json')
  const seed = 'a'.repeat(64)
  const run = (args, extra = {}) => spawnSync(process.execPath, [script, ...args], {
    env: { ...process.env, GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2', GITHUB_ENV: envFile, ...extra }, encoding: 'utf8',
  })
  try {
    assert.equal(run(['keygen', priv, pub]).status, 0)
    writeFileSync(plain, JSON.stringify({ marker: 'private-fixture' }))
    assert.equal(run(['seal', pub, plain, sealed], { EPT_CICLO_CLAVE: seed }).status, 0)
    assert.throws(() => readFileSync(plain))
    const uploaded = readFileSync(sealed, 'utf8')
    assert.ok(!uploaded.includes(seed) && !uploaded.includes('private-fixture'))
    assert.equal(run(['open', priv, sealed, output]).status, 0)
    assert.deepEqual(JSON.parse(readFileSync(output, 'utf8')), { marker: 'private-fixture' })
    assert.equal(readFileSync(envFile, 'utf8'), `EPT_CICLO_CLAVE=${seed}\n`)
    assert.notEqual(run(['open', priv, sealed, join(dir, 'wrong-attempt.json')], { GITHUB_RUN_ATTEMPT: '3' }).status, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
