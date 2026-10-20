import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { gestionarSimulador, RUNTIME, DEVICE } from './ios-simulador.mjs'
import { comprobarCompletitud, FLUJOS } from './ios-completitud.mjs'
const udid = '600A45A3-B3A0-4A39-8A9C-5D051F9FDA9C'
function caso(fn) {
  const directory = mkdtempSync(join(tmpdir(), 'ept113-sesion-'))
  try { fn(directory) } finally { rmSync(directory, { recursive: true, force: true }) }
}
test('crea solo runtime/type explícitos; limpieza solo identidad propia con deadline total5s', () => caso(directory => {
  const calls = [], base = { directory, run: '123', attempt: '1' }
  const ejecutar = (_, args, opts) => { calls.push({ args, opts }); return { status: 0, stdout: args.includes('runtimes') ? JSON.stringify({ runtimes: [{ identifier: RUNTIME, isAvailable: true }] }) : udid } }
  assert.equal(gestionarSimulador({ ...base, accion: 'crear', ejecutar }), udid)
  assert.deepEqual(calls[1].args, ['simctl', 'create', 'EPT113-123-1', DEVICE, RUNTIME])
  assert.throws(() => gestionarSimulador({ ...base, run: 'otro', accion: 'limpiar', ejecutar: () => assert.fail('No tocar otro simulador') }), /ajeno/u)
  calls.length = 0; let tiempo = 0
  gestionarSimulador({ ...base, accion: 'limpiar', ahora: () => tiempo, ejecutar: (...args) => { tiempo += 2000; return ejecutar(...args) } })
  assert.deepEqual(calls.map(c => c.args), [['simctl', 'shutdown', udid], ['simctl', 'delete', udid]])
  assert.deepEqual(calls.map(c => c.opts.timeout), [5000, 3000])
  assert.equal(JSON.parse(readFileSync(join(directory, 'simulador-propio.json'))).eliminado, true)
}))
test('runtime ausente/creación inválida fallan sin usar otro; timeout limpieza no inventa eliminación', () => caso(directory => {
  const base = { directory, run: '123', attempt: '1' }
  assert.throws(() => gestionarSimulador({ ...base, accion: 'crear', ejecutar: () => ({ status: 0, stdout: '{"runtimes":[]}' }) }), /Runtime/u)
  writeFileSync(join(directory, 'simulador-propio.json'), JSON.stringify({ ...base, udid, creado: true, runtime: RUNTIME, device: DEVICE }))
  assert.throws(() => gestionarSimulador({ ...base, accion: 'limpiar', ejecutar: () => ({ status: null, error: { code: 'ETIMEDOUT' } }) }), /no confirmada/u)
  assert.notEqual(JSON.parse(readFileSync(join(directory, 'simulador-propio.json'))).eliminado, true)
}))
test('una sesión llama los tres originales en orden y conserva aislamiento y todas las aserciones', () => {
  const wrapper = readFileSync(new URL('../maestro/suite-ios.yaml', import.meta.url), 'utf8')
  assert.deepEqual([...wrapper.matchAll(/^- runFlow: (.+)$/gmu)].map(m => m[1]), FLUJOS.map(f => f === 'smoke' ? 'smoke-ios.yaml' : `${f}-ios.yaml`))
  for (const flujo of FLUJOS) assert.match(readFileSync(new URL(`../maestro/${flujo}-ios.yaml`, import.meta.url), 'utf8'), /- launchApp:\s+clearState: true/u)
  const runner = readFileSync(new URL('./ejecutar-ios.sh', import.meta.url), 'utf8')
  assert.equal((runner.match(/^maestro --device/gmu) ?? []).length, 1)
  assert.match(runner, /ios-completitud.mjs "\$SALIDA"/u)
  assert.match(runner, /if \[ "\$estado" -eq 0 \] && \[ "\$completitud" -ne 0 \]; then estado=1; fi/u)
  assert.ok(runner.indexOf('open -a') < runner.indexOf('simctl bootstatus'))
  assert.match(runner, /ios-simulador.mjs limpiar \|\| resultado=1/u)
})
test('prueba real de tres marcadores/PNG ordenados; JUnit padre, parciales y duplicados no bastan', () => {
  for (const variante of ['completo', 'parcial', 'fallido', 'duplicado', 'orden', 'png']) caso(directory => {
    const commands = FLUJOS.map((flujo, index) => ({ command: { takeScreenshotCommand: { path: `ept113-ios-${flujo}-completado` } }, metadata: { status: 'COMPLETED', timestamp: index + 1 } }))
    if (variante === 'parcial') commands.pop()
    if (variante === 'fallido') commands[1].metadata.status = 'FAILED'
    if (variante === 'duplicado') commands.push(commands[0])
    if (variante === 'orden') commands[1].metadata.timestamp = 0
    mkdirSync(join(directory, 'suite'))
    writeFileSync(join(directory, 'suite/commands.json'), JSON.stringify(commands))
    writeFileSync(join(directory, 'maestro-ios.xml'), '<testsuite tests="1" failures="0"/>')
    for (const f of FLUJOS) writeFileSync(join(directory, `ept113-ios-${f}-completado.png`), Buffer.from(variante === 'png' ? 'vacio' : '89504e470d0a1a0a', variante === 'png' ? 'utf8' : 'hex'))
    if (variante === 'completo') assert.equal(comprobarCompletitud(directory).length, 3)
    else assert.throws(() => comprobarCompletitud(directory))
  })
})
