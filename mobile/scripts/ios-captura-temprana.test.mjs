import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { iniciarCapturaXCTest } from './ios-captura-temprana.mjs'
const udid = '600A45A3-B3A0-4A39-8A9C-5D051F9FDA9C'
function hijo(cierra = true) {
  const child = new EventEmitter()
  child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.signals = []
  child.kill = signal => { child.signals.push(signal); if (cierra) queueMicrotask(() => child.emit('close', 0, signal)); return true }
  return child
}
test('captura solo procesos de XCTest del UDID elegido antes del primer Maestro; cierra sin reiniciar driver', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ept113-observacion-'))
  try {
    const child = hijo(), calls = []
    const cerrar = iniciarCapturaXCTest({ directory, udid, crear: (...args) => { calls.push(args); return child } })
    child.stdout.write('testmanagerd evento sintético\n'); child.stderr.write('xctestdaemon diagnóstico\n')
    await cerrar()
    assert.equal(calls.length, 1); assert.equal(calls[0][0], 'xcrun')
    assert.deepEqual(calls[0][1].slice(0, 4), ['simctl', 'spawn', udid, 'log'])
    assert.match(calls[0][1].at(-1), /testmanagerd.*xctestdaemon/u)
    assert.doesNotMatch(calls[0][1].join(' '), /boot|install|launch|terminate/u)
    assert.deepEqual(child.signals, ['SIGTERM'])
    assert.match(readFileSync(join(directory, 'xctest-temprano.log'), 'utf8'), /evento sintético/u)
    assert.equal(JSON.parse(readFileSync(join(directory, 'xctest-temprano.json'))).cerrado, true)
    const script = readFileSync(new URL('./ejecutar-ios.sh', import.meta.url), 'utf8')
    assert.ok(script.indexOf('ios-captura-temprana.mjs') < script.indexOf('maestro --device'))
    assert.match(script, /trap finalizar_captura EXIT/u)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
test('tope de bytes conserva prefijo y señala truncamiento sin exceder cuota', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ept113-observacion-cuota-'))
  try {
    const child = hijo(); const cerrar = iniciarCapturaXCTest({ directory, udid, maximoBytes: 4, crear: () => child })
    child.stdout.write('123456789'); await new Promise(resolve => setImmediate(resolve)); await cerrar()
    assert.equal(readFileSync(join(directory, 'xctest-temprano.log'), 'utf8'), '1234')
    assert.equal(JSON.parse(readFileSync(join(directory, 'xctest-temprano.json'))).truncado, true)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
test('cierre no confirmado queda explícito tras gracia acotada, no se fabrica proceso cerrado', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ept113-observacion-cierre-'))
  try {
    const child = hijo(false); const cerrar = iniciarCapturaXCTest({ directory, udid, graciaMs: 5, crear: () => child })
    await cerrar()
    const estado = JSON.parse(readFileSync(join(directory, 'xctest-temprano.json')))
    assert.deepEqual(child.signals, ['SIGTERM', 'SIGKILL']); assert.equal(estado.cierreNoConfirmado, true); assert.equal(estado.cerrado, false)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
test('error del recolector y UDID inválido no alteran readiness ni se confunden con evidencia disponible', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ept113-observacion-error-'))
  try {
    assert.throws(() => iniciarCapturaXCTest({ directory, udid: 'otro', crear: () => assert.fail('No debe iniciar') }), /inválido/u)
    const child = hijo(); const cerrar = iniciarCapturaXCTest({ directory, udid, crear: () => child })
    child.emit('error', { code: 'ENOENT' }); await cerrar()
    assert.equal(JSON.parse(readFileSync(join(directory, 'xctest-temprano.json'))).error, 'ENOENT')
    assert.deepEqual(child.signals, [])
  } finally { rmSync(directory, { recursive: true, force: true }) }
})


test('captura temprana pasa por sanitario existente sin publicar texto sensible', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ept113-observacion-saneada-'))
  try {
    const child = hijo(); const cerrar = iniciarCapturaXCTest({ directory, udid, crear: () => child })
    child.stdout.write('Authorization: Bearer synthetic-capture-token\nTEST_PASSWORD=synthetic-capture-password\n')
    await cerrar()
    const script = new URL('../../scripts/ci/run-stage.py', import.meta.url)
    const result = spawnSync(process.platform === 'win32' ? 'python' : 'python3', [fileURLToPath(script), '--sanitize-directory', directory], {
      encoding: 'utf8', env: { ...process.env, TEST_PASSWORD: 'synthetic-capture-password' }, timeout: 5000,
    })
    assert.equal(result.status, 0, result.stderr)
    assert.doesNotMatch(readFileSync(join(directory, 'xctest-temprano.log'), 'utf8'), /synthetic-capture-token|synthetic-capture-password/u)
    assert.equal(JSON.parse(readFileSync(join(directory, 'xctest-temprano.json'))).cerrado, true)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
