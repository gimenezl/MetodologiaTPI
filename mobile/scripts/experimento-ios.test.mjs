import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { verificarFuente, seleccionarBase, validarCaso, requiereBoot, crearPresupuesto } from './experimento-ios.mjs'
test('solo acepta fuente propia exacta, nunca otro run, head o artifact', () => {
  const run = { id: 39338153901, head_sha: 'b3b82f4983d00540ddfa5cfea078a347e6f8e5b2', status: 'completed' }
  const artifact = { id: 12227059866, workflow_run: { id: run.id }, name: 'movil-ios-6735186e2fe1038d9f89971fbbede47735ee54e1' }
  verificarFuente(run, artifact)
  for (const r of [{ ...run, id: 1 }, { ...run, head_sha: 'otro' }, { ...run, status: 'in_progress' }]) assert.throws(() => verificarFuente(r, artifact))
  for (const a of [{ ...artifact, id: 1 }, { ...artifact, expired: true }, { ...artifact, workflow_run: { id: 1 } }]) assert.throws(() => verificarFuente(run, a))
})
test('casos y selección son cerrados, no dependen del último elemento JSON', () => {
  assert.equal(validarCaso('baseline'), 'baseline'); assert.equal(validarCaso('gui'), 'gui')
  for (const c of ['', 'full', 'otro']) assert.throws(() => validarCaso(c))
  const udid = '600A45A3-B3A0-4A39-8A9C-5D051F9FDA9C'
  assert.equal(seleccionarBase({ devices: { 'com.apple.CoreSimulator.SimRuntime.iOS-26-2': [{ name: 'iPhone 16e', isAvailable: true, udid }] } }), udid)
  assert.throws(() => seleccionarBase({ devices: {} }))
})
test('routing mantiene aceptación predeterminada y separa experimento con sanitizado fail-closed', () => {
  const y = readFileSync('.github/workflows/full.yml', 'utf8')
  assert.match(y, /default: full/u); assert.match(y, /case "\$MODE" in full\|ept113-ios-diagnostico\) ;; \*\) exit 1/u)
  assert.equal((y.match(/if: needs.mode.outputs.mode == 'full'/gu) ?? []).length, 2)
  assert.match(y, /if: always\(\) && needs.mode.outputs.mode == 'full'/u)
  assert.match(y, /--seconds 360/u); assert.match(y, /steps.sanitize.outcome == 'success'/u)
  assert.match(y, /MAESTRO_DRIVER_STARTUP_TIMEOUT: '120000'/u)
  assert.doesNotMatch(y, /secrets\.|supabase.*start|npm ci|expo prebuild/u)
})
test('sanitizador real preserva JSON y elimina credenciales del diagnóstico', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ept113-experimento-'))
  try {
    writeFileSync(join(dir, 'caso.json'), JSON.stringify({ caso: 'gui', aceptacion: false }))
    writeFileSync(join(dir, 'host.log'), 'Bearer ept113-sintetico\n')
    const r = spawnSync('python', ['scripts/ci/run-stage.py', '--sanitize-directory', dir], { encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr)
    const data = readFileSync(join(dir, 'caso.json'), 'utf8')
    assert.equal(JSON.parse(data).aceptacion, false)
    assert.doesNotMatch(readFileSync(join(dir, 'host.log'), 'utf8'), /ept113-sintetico/u)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
test('cold services comparten un deadline, observación previa y estado inicial explícito', () => {
  assert.equal(requiereBoot('Booted'), false)
  assert.equal(requiereBoot('Shutdown'), true)
  for (const s of ['Booting', undefined, 'otro']) assert.throws(() => requiereBoot(s))
  const s = readFileSync('mobile/scripts/experimento-ios.mjs', 'utf8')
  assert.doesNotMatch(s, /timeout = 10000|\], (?:10000|30000|45000|180000)\)/u)
  assert.match(s, /const timeout = restante\(limpiando\)/u)
  assert.ok(s.indexOf("host = spawn('log'") < s.indexOf("comando('devices'"))
  assert.ok(s.indexOf('cerrarSim = iniciarCapturaXCTest') < s.indexOf("comando('bootstatus'"))
  assert.ok(s.indexOf("comando('gui'") < s.indexOf("comando('bootstatus'"))
  assert.match(s, /metadata.etapas.push\(etapa\); guardar\(\)/u)
  assert.match(readFileSync('.github/workflows/full.yml', 'utf8'), /--seconds 360/u)
})
test('un deadline total reserva cinco segundos y nunca se renueva por comando', () => {
  let ahora = 100
  const restante = crearPresupuesto(() => ahora)
  assert.equal(restante(), 355000)
  ahora += 200000; assert.equal(restante(), 155000)
  ahora += 155000; assert.throws(() => restante(), /incompleto/u)
  assert.equal(restante(true), 5000)
  ahora += 4999; assert.equal(restante(true), 1)
  ahora++; assert.throws(() => restante(true), /incompleto/u)
  const s = readFileSync('mobile/scripts/experimento-ios.mjs', 'utf8')
  assert.match(s, /completo: false/u)
  assert.match(s, /metadata.completo = metadata.exit === 0/u)
  assert.match(s, /metadata.resultado \?\?= 'caso-incompleto'/u)
  assert.match(s, /limpiando = true/u)
})
