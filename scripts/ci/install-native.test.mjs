import assert from 'node:assert/strict'
import { readFile, mkdtemp, writeFile, rm, realpath, mkdir, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { digest, install, validateManifest } from './install-native.mjs'

const lock = JSON.parse(await readFile(new URL('./native-services.lock.json', import.meta.url), 'utf8'))

test('pins bind four official native services and every provenance digest', () => {
  assert.equal(lock.repository, 'https://github.com/supabase/slim-services')
  assert.equal(lock.target, 'darwin-arm64')
  assert.deepEqual(Object.keys(lock.services), ['postgres', 'auth', 'postgrest', 'storage'])
  for (const [service, pin] of Object.entries(lock.services)) {
    assert.match(pin.tag, new RegExp(`^${service}-`, 'u'))
    for (const field of ['archive_sha256', 'manifest_sha256', 'sums_sha256']) assert.match(pin[field], /^[0-9a-f]{64}$/u)
    assert.match(pin.source_commit, /^[0-9a-f]{40}$/u)
  }
})

test('manifest rejects incompatible architecture, source, portable flag and OS floor', () => {
  const pin = lock.services.postgres
  const manifest = { service: 'postgres', version: pin.version, source_commit: pin.source_commit, target: 'darwin-arm64', arch: 'arm64', portable: true, os_floor: { kind: 'macos', floor: '14.0' } }
  assert.doesNotThrow(() => validateManifest(manifest, 'postgres', pin))
  for (const mutation of [{ service: 'foreign' }, { target: 'linux-arm64' }, { arch: 'x64' }, { source_commit: 'foreign' }, { portable: false }, { version: 'latest' }, { os_floor: { kind: 'macos', floor: 'unknown' } }, { os_floor: { kind: 'macos', floor: '16' } }]) {
    assert.throws(() => validateManifest({ ...manifest, ...mutation }, 'postgres', pin))
  }
})

test('streamed SHA256 rejects altered bytes', async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'ept105-digest-'))
  try {
    const path = join(root, 'archive')
    await writeFile(path, 'abc')
    assert.equal(await digest(path), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    await writeFile(path, 'abd')
    assert.notEqual(await digest(path), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  } finally {
    await rm(root, { recursive: true })
  }
})

test('corrupt immutable cache fails closed before download or extraction', async t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('Unexpected download in cache rejection test'))
  const root = await mkdtemp(join(await realpath(tmpdir()), 'ept105-cache-'))
  try {
    const pin = lock.services.postgres
    const directory = join(root, pin.tag)
    await mkdir(directory)
    await writeFile(join(directory, `${pin.tag}-darwin-arm64.tar.zst`), 'corrupt')
    await assert.rejects(install(root, join(root, 'extracted')), /cached archive digest mismatch/u)
  } finally {
    await rm(root, { recursive: true })
  }
})

test('symlink ancestor is rejected before reading cache or downloading', async t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('Unexpected download in ancestor rejection test'))
  const root = await mkdtemp(join(await realpath(tmpdir()), 'ept105-ancestor-'))
  try {
    const target = join(root, 'target')
    const alias = join(root, 'alias')
    await mkdir(target)
    await symlink(target, alias, process.platform === 'win32' ? 'junction' : 'dir')
    await assert.rejects(install(join(alias, 'cache'), join(root, 'extracted')), /Symlink in native artifact path/u)
  } finally {
    await rm(root, { recursive: true })
  }
})

test('symlink cache entry is rejected rather than trusted by digest', async t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('Unexpected download in entry rejection test'))
  const root = await mkdtemp(join(await realpath(tmpdir()), 'ept105-entry-'))
  try {
    const pin = lock.services.postgres
    const directory = join(root, pin.tag)
    const target = join(root, 'target')
    await mkdir(directory)
    await mkdir(target)
    await symlink(target, join(directory, `${pin.tag}-darwin-arm64.tar.zst`), process.platform === 'win32' ? 'junction' : 'dir')
    await assert.rejects(install(root, join(root, 'extracted')), /Symlink in binary cache/u)
  } finally {
    await rm(root, { recursive: true })
  }
})
