// Confidential exchange primitive for ephemeral CI jobs. This module does not
// authenticate the public-key transport or start any services by itself.
import { createCipheriv, createDecipheriv, constants, generateKeyPairSync, privateDecrypt, publicEncrypt, randomBytes } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { appendFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const AAD_PREFIX = 'ept-ios-ci-handshake/v1:'

function contexto(run, attempt) {
  if (!/^[1-9]\d{0,19}$/u.test(String(run)) || !/^[1-9]\d{0,9}$/u.test(String(attempt))) {
    throw new Error('Invalid CI run identity.')
  }
  return Buffer.from(`${AAD_PREFIX}${run}:${attempt}`, 'utf8')
}

export function crearPar() {
  return generateKeyPairSync('rsa', {
    modulusLength: 3072,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
}

export function cifrar(publicKey, contenido, run, attempt) {
  const bytes = Buffer.from(JSON.stringify(contenido), 'utf8')
  if (bytes.length > 16_384) throw new Error('CI handshake exceeds the maximum size.')
  const key = randomBytes(32)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(contexto(run, attempt))
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()])
  const wrapped = publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, key)
  key.fill(0)
  return JSON.stringify({ v: 1, wrapped: wrapped.toString('base64url'), iv: iv.toString('base64url'),
    ciphertext: ciphertext.toString('base64url'), tag: cipher.getAuthTag().toString('base64url') })
}

export function descifrar(privateKey, mensaje, run, attempt) {
  if (typeof mensaje !== 'string' || mensaje.length > 32_768) throw new Error('Invalid CI handshake size.')
  const sobre = JSON.parse(mensaje)
  if (!sobre || sobre.v !== 1 || !['wrapped', 'iv', 'ciphertext', 'tag'].every(k => typeof sobre[k] === 'string' && /^[A-Za-z0-9_-]+$/u.test(sobre[k]))) {
    throw new Error('Invalid CI handshake envelope.')
  }
  const iv = Buffer.from(sobre.iv, 'base64url')
  const tag = Buffer.from(sobre.tag, 'base64url')
  if (iv.length !== 12 || tag.length !== 16) throw new Error('Invalid CI handshake parameters.')
  const key = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(sobre.wrapped, 'base64url'))
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAAD(contexto(run, attempt))
    decipher.setAuthTag(tag)
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(sobre.ciphertext, 'base64url')), decipher.final()]).toString('utf8'))
  } finally {
    key.fill(0)
  }
}

// Files are local to the runner. Only the public key and encrypted envelope may
// be uploaded; the private key, plaintext and seed must never be artifacts.
function ejecutar() {
  const [action, input, output, extra] = process.argv.slice(2)
  const run = process.env.GITHUB_RUN_ID
  const attempt = process.env.GITHUB_RUN_ATTEMPT
  const envFile = process.env.GITHUB_ENV
  contexto(run, attempt)
  if (action === 'keygen') {
    const pair = crearPar()
    writeFileSync(input, pair.privateKey, { mode: 0o600, flag: 'wx' })
    writeFileSync(output, pair.publicKey, { mode: 0o600, flag: 'wx' })
  } else if (action === 'seal') {
    const seed = process.env.EPT_CICLO_CLAVE
    if (!/^[a-f0-9]{64}$/u.test(seed ?? '')) throw new Error('Missing private CI seed.')
    try {
      const payload = JSON.parse(readFileSync(output, 'utf8'))
      writeFileSync(extra, cifrar(readFileSync(input, 'utf8'), { seed, payload }, run, attempt), { mode: 0o600, flag: 'wx' })
    } finally {
      rmSync(output, { force: true })
    }
  } else if (action === 'open') {
    if (!envFile) throw new Error('Missing CI environment file.')
    const result = descifrar(readFileSync(input, 'utf8'), readFileSync(output, 'utf8'), run, attempt)
    if (!result || !/^[a-f0-9]{64}$/u.test(result.seed ?? '') || !result.payload || typeof result.payload !== 'object') {
      throw new Error('Invalid protected handshake payload.')
    }
    console.log(`::add-mask::${result.seed}`)
    appendFileSync(envFile, `EPT_CICLO_CLAVE=${result.seed}\n`, { mode: 0o600 })
    writeFileSync(extra, JSON.stringify(result.payload), { mode: 0o600, flag: 'wx' })
  } else throw new Error('Unknown private channel operation.')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { ejecutar() } catch {
    // Never print parse errors, file contents, URLs or credentials from input.
    console.error('Private CI handshake failed.')
    process.exitCode = 1
  }
}
