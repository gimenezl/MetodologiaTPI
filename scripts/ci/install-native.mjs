// Download only immutable, digest-pinned official archives. Never cache runtime state.
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm, lstat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { createZstdDecompress } from 'node:zlib'
import { pathToFileURL } from 'node:url'

export async function digest(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

export function validateManifest(manifest, service, pin) {
  if (manifest.service !== service || manifest.version !== pin.version || manifest.target !== 'darwin-arm64' ||
    manifest.arch !== 'arm64' || manifest.portable !== true || manifest.source_commit !== pin.source_commit ||
    manifest.os_floor?.kind !== 'macos' || !/^\d+(?:\.\d+)*$/u.test(String(manifest.os_floor.floor)) ||
    Number.parseInt(manifest.os_floor.floor, 10) > 15) {
    throw new Error(`Manifest incompatible: ${service}`)
  }
}

export async function rejectSymlinkAncestors(path) {
  let current = resolve(path)
  while (true) {
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error('Symlink in native artifact path')
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
}

async function asset(cache, tag, name, sha) {
  const directory = join(cache, tag)
  await rejectSymlinkAncestors(directory)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const target = join(directory, name)
  try {
    if ((await lstat(target)).isSymbolicLink()) throw new Error('Symlink in binary cache')
    if (await digest(target) === sha) return target
    throw new Error('Immutable cached archive digest mismatch')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const partial = `${target}.partial`
  const response = await fetch(`https://github.com/supabase/slim-services/releases/download/${tag}/${name}`, { signal: AbortSignal.timeout(90_000) })
  if (!response.ok || !response.body) throw new Error(`Official asset unavailable: ${name}`)
  let created = false
  const output = createWriteStream(partial, { flags: 'wx', mode: 0o600 })
  output.once('open', () => { created = true })
  try {
    await pipeline(Readable.fromWeb(response.body), output)
    if (await digest(partial) !== sha) throw new Error(`Official asset digest mismatch: ${name}`)
    await rename(partial, target)
  } finally {
    if (created) await rm(partial, { force: true })
  }
  return target
}

export async function install(cache, destination) {
  const lock = JSON.parse(await readFile(new URL('./native-services.lock.json', import.meta.url), 'utf8'))
  await rejectSymlinkAncestors(destination)
  await mkdir(destination, { recursive: true, mode: 0o700 })
  for (const [service, pin] of Object.entries(lock.services)) {
    const stem = `${pin.tag}-darwin-arm64`
    const archiveName = `${stem}.tar.zst`
    const archive = await asset(cache, pin.tag, archiveName, pin.archive_sha256)
    const manifestFile = await asset(cache, pin.tag, `${stem}.manifest.json`, pin.manifest_sha256)
    const sums = await asset(cache, pin.tag, 'SHA256SUMS', pin.sums_sha256)
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8'))
    validateManifest(manifest, service, pin)
    if (!(await readFile(sums, 'utf8')).split('\n').some(line => line.trim() === `${pin.archive_sha256}  ${archiveName}`)) {
      throw new Error(`Release checksum list does not bind archive: ${service}`)
    }
    // Re-extract from verified archives each run; cached extracted executables are not trusted.
    await pipeline(createReadStream(archive), createZstdDecompress(), createWriteStream(join(destination, `${service}.tar`), { flags: 'wx', mode: 0o600 }))
    console.log(`Native archive verified: ${service}; version=${pin.version}; source=${pin.source_commit}`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('The native iOS harness requires macOS ARM64')
  const cache = process.env.EPT_NATIVE_BINARY_CACHE
  const destination = process.env.EPT_NATIVE_ARTIFACT_DIR
  if (!cache || !destination) throw new Error('Missing isolated native artifact directories')
  await install(cache, destination)
}
