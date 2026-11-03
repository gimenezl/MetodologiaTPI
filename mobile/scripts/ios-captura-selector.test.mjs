import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { iniciarCapturaSelector } from './ios-captura-selector.mjs'

test('capture retains only complete allowlisted events and closes the stream', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'selector-ci-'))
  try {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough()
    child.kill = signal => { queueMicrotask(() => child.emit('close', 0, signal)); return true }
    let args
    const cerrar = iniciarCapturaSelector({ directory, udid: '600A45A3-B3A0-4A39-8A9C-5D051F9FDA9C', crear: (...a) => { args = a; return child } })
    child.stdout.write('secret EPT_CI_SELECTOR:mont'); child.stdout.write('ado secret\nEPT_CI_SELECTOR:desconocido secret\nEPT_CI_SELECTOR:montado123 secret\nEPT_CI_SELECTOR:montadoX secret\n')
    child.stderr.write('secret stderr\n')
    await cerrar()
    assert.match(args[1].at(-1), /com.facebook.react.log/u)
    assert.match(args[1].at(-1), /process == "EducarparaTransformar"/u)
    assert.equal(readFileSync(join(directory, 'selector-ci.log'), 'utf8'), 'EPT_CI_SELECTOR:montado\n')
    assert.equal(JSON.parse(readFileSync(join(directory, 'selector-ci-estado.json'))).cerrado, true)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('unconfirmed shutdown and capture errors never claim a closed successful stream', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'selector-ci-error-'))
  try {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough()
    const signals = []; child.kill = signal => { signals.push(signal); return true }
    const cerrar = iniciarCapturaSelector({ directory, udid: '600A45A3-B3A0-4A39-8A9C-5D051F9FDA9C', crear: () => child, graciaMs: 5 })
    await cerrar()
    assert.deepEqual(signals, ['SIGTERM', 'SIGKILL'])
    assert.deepEqual(JSON.parse(readFileSync(join(directory, 'selector-ci-estado.json'))), { cerrado: false, error: true })
    assert.throws(() => iniciarCapturaSelector({ directory, udid: 'invalid' }), /inválido/u)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
