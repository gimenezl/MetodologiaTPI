import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { recopilar, capturarPantalla } from './diagnostico-ios.mjs'

const root = resolve(import.meta.dirname, '../..')
const udid = '600A45A3-B3A0-4A39-8A9C-5D051F9FDA9C'
const bash =
  process.platform === 'win32'
    ? join(
        dirname(dirname(spawnSync('where.exe', ['git'], { encoding: 'utf8' }).stdout.trim().split(/\r?\n/u)[0])),
        'bin/bash.exe'
      )
    : 'bash'

test('diagnóstico limitado al UDID, puerto y procesos registrados; sanitario existente elimina datos privados', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ept112-ios-diagnostico-'))
  try {
    const output = join(directory, 'evidencia'),
      derived = join(directory, 'derived')
    mkdirSync(output)
    mkdirSync(join(derived, 'Logs/Test/propio.xcresult'), { recursive: true })
    writeFileSync(
      join(output, 'maestro.log'),
      `Selected device ${udid} using port 23456\nSelected device otro using port 34567\nSelected device ${udid} using port 99999`
    )
    writeFileSync(join(output, 'xctest_runner.log'), 'xcodebuild[123:456] aviso')
    const calls = []
    const target = recopilar({
      directory: output,
      derived,
      udid,
      run(command, args) {
        calls.push([command, args])
        return 'TEST_PASSWORD=privado-fixture\nBearer secreto-fixture\nhttp://localhost:23456/status\n/Users/runner/privado\nsb_secret_fixture-123456\n'
      },
    })
    assert.deepEqual(
      calls.find(([name]) => name === 'ps'),
      ['ps', ['-p', '123', '-o', 'pid=,ppid=,stat=,comm=']]
    )
    assert.equal(calls.filter(([name]) => name === 'curl').length, 1)
    assert.ok(calls.find(([name]) => name === 'curl')[1].includes('http://127.0.0.1:23456/status'))
    assert.ok(calls.some(([name, args]) => name === 'xcrun' && args[0] === 'simctl' && args[2] === udid))
    assert.ok(
      calls.some(([name, args]) => name === 'xcrun' && args[0] === 'xcresulttool' && args.at(-1).startsWith(derived))
    )
    const sanitized = spawnSync(
      process.platform === 'win32' ? 'python' : 'python3',
      ['scripts/ci/run-stage.py', '--sanitize-directory', output],
      {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, TEST_PASSWORD: 'privado-fixture' },
        timeout: 5000,
      }
    )
    assert.equal(sanitized.status, 0, sanitized.stderr)
    assert.doesNotMatch(
      readFileSync(target, 'utf8'),
      /privado-fixture|secreto-fixture|localhost|\/Users\/runner|sb_secret_/u
    )
    assert.throws(
      () =>
        recopilar({
          directory: output,
          derived,
          udid: 'desconocido',
          run() {
            assert.fail('No debe consultar')
          },
        }),
      /Identidad/u
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('sin puerto del UDID no se consulta un puerto supuesto', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ept112-ios-sin-puerto-'))
  try {
    const calls = []
    const target = recopilar({
      directory,
      derived: join(directory, 'derived'),
      udid,
      run(name) {
        calls.push(name)
        return 'no disponible'
      },
    })
    assert.ok(!calls.includes('curl') && !calls.includes('lsof') && !calls.includes('ps'))
    assert.match(readFileSync(target, 'utf8'), /Puerto no registrado/u)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

for (const exit of [0, 7]) {
  test(`script conserva diagnóstico temprano y exit ${exit}, sin omitir condiciones de los flujos`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'ept112-ios-script-'))
    try {
      const bin = join(directory, 'bin'),
        trace = join(directory, 'traza.txt')
      mkdirSync(bin)
      const fake = (name, body) => writeFileSync(join(bin, name), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 })
      fake(
        'xcrun',
        `if [[ "$*" == "simctl list runtimes -j" ]]; then echo '{"runtimes":[{"identifier":"com.apple.CoreSimulator.SimRuntime.iOS-26-2","isAvailable":true}]}'; elif [[ "$*" == "simctl create"* ]]; then echo '${udid}'; else echo org.educarparatransformar.app; fi`
      )
      fake(
        'maestro',
        `if [[ "$1" == "--version" ]]; then echo 2.11.0; exit 0; fi
printf '%s\\n' "$*" >> "$TRAZA_PRUEBA"
debug=''; while [[ $# -gt 0 ]]; do if [[ "$1" == "--debug-output" ]]; then debug="$2"; shift; fi; shift; done
if [[ -n "$debug" ]]; then mkdir -p "$debug"; echo 'Selected device ${udid} using port 23456' > "$debug/maestro.log"; fi
if [[ ${exit} -eq 0 ]]; then
  printf '[{"command":{"takeScreenshotCommand":{"path":"ept113-ios-smoke-completado"}},"metadata":{"status":"COMPLETED","timestamp":1}},{"command":{"takeScreenshotCommand":{"path":"ept113-ios-recuperacion-completado"}},"metadata":{"status":"COMPLETED","timestamp":2}},{"command":{"takeScreenshotCommand":{"path":"ept113-ios-recibos-completado"}},"metadata":{"status":"COMPLETED","timestamp":3}}]' > "$debug/commands.json"
  for flujo in smoke recuperacion recibos; do printf '\\211PNG\\r\\n\\032\\n' > "$debug/ept113-ios-$flujo-completado.png"; done
fi
exit ${exit}`
      )
      for (const name of ['ps', 'lsof', 'curl', 'xcodebuild', 'open']) fake(name, 'echo diagnostico-sintetico')
      // Windows no ejecuta scripts POSIX sin extensión desde spawnSync de Node.
      // El adaptador existe solo en este proceso de prueba, no en el runner de producción.
      const shim = join(directory, 'posix-test.cjs')
      if (process.platform === 'win32') writeFileSync(shim, `const cp=require('node:child_process'); const original=cp.spawnSync; cp.spawnSync=(cmd,args,opts)=>cmd==='xcrun'?original(${JSON.stringify(bash)},[${JSON.stringify(join(bin, 'xcrun'))},...args],opts):original(cmd,args,opts); require('node:module').syncBuiltinESMExports();`)
      const result = spawnSync(bash, ['mobile/scripts/ejecutar-ios.sh', 'app-sintetica.app'], {
        cwd: root,
        encoding: 'utf8',
        timeout: 15000,
        env: {
          ...process.env,
          PATH: `${bin}${delimiter}${process.env.PATH}`,
          RUNNER_TEMP: directory,
          TRAZA_PRUEBA: trace,
          GITHUB_RUN_ID: 'synthetic-run',
          GITHUB_RUN_ATTEMPT: '1',
          DEVELOPER_DIR: directory,
          ...(process.platform === 'win32' ? { NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --require "${shim.replaceAll(String.fromCharCode(92), "/")}"` } : {}),
        },
      })
      assert.equal(result.status, exit, result.stderr)
      const calls = readFileSync(trace, 'utf8').trim().split(/\r?\n/u)
      assert.equal(calls.length, 1)
      for (const call of calls) {
        assert.match(call, /--debug-output .*--flatten-debug-output --test-output-dir/u)
        assert.match(call, /suite-ios.yaml/u)
      }
      assert.ok(existsSync(join(directory, 'evidencia-movil-ios/suite-debug/maestro.log')))
      assert.ok(existsSync(join(directory, 'evidencia-movil-ios/final-diagnostico.txt')))
      assert.equal(existsSync(join(directory, 'evidencia-movil-ios/completitud-ios.json')), exit === 0)
      assert.equal(JSON.parse(readFileSync(join(directory, 'evidencia-movil-ios/simulador-propio.json'))).eliminado, true)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
}

test('workflow sanea diagnóstico antes del upload sin alterar presupuestos ni gates', () => {
  const workflow = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8')
  const ios = workflow.slice(workflow.indexOf('  mobile-ios:'), workflow.indexOf('  gate:'))
  assert.match(ios, /timeout-minutes: 40/u)
  assert.match(ios, /MAESTRO_DRIVER_STARTUP_TIMEOUT: '120000'/u)
  assert.ok(ios.indexOf('--sanitize-directory') < ios.indexOf('- name: Subir evidencia iOS'))
  assert.match(ios, /--sanitize-directory "\$RUNNER_TEMP\/evidencia-movil-ios"/u)
  assert.match(workflow, /test "\$IOS" = success/u)
})

test('upload iOS evalúa la condición real y solo publica tras sanitario exitoso', () => {
  const workflow = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8')
  const sanitario = workflow.slice(
    workflow.indexOf('      - name: Sanear artifacts iOS'),
    workflow.indexOf('      - name: Subir evidencia iOS')
  )
  const upload = workflow.slice(workflow.indexOf('      - name: Subir evidencia iOS'), workflow.indexOf('  gate:'))
  const id = sanitario.match(/^        id: ([a-z_]+)$/mu)?.[1]
  assert.ok(id, 'El sanitario debe tener identidad explícita')
  assert.doesNotMatch(sanitario, /continue-on-error:/u)
  const condicion = upload.match(/^        if: (.+)$/mu)?.[1]
  assert.equal(condicion, `always() && steps.${id}.outcome == 'success'`)
  // Ejecuta la expresión extraída del workflow, no una política paralela del mock.
  const permiteUpload = new Function('always', 'steps', `return (${condicion})`)
  for (const outcome of ['failure', 'skipped', 'cancelled', 'success']) {
    assert.equal(
      permiteUpload(() => true, { [id]: { outcome } }),
      outcome === 'success',
      outcome
    )
  }
})


test('diagnóstico por flujo conserva originales y no consulta drivers anteriores ni lanza JVM para versión', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ept113-ios-flujo-'))
  try {
    for (const flujo of ['smoke', 'recibos']) {
      mkdirSync(join(directory, `${flujo}-debug`))
      writeFileSync(join(directory, `${flujo}-debug`, 'maestro.log'), `Maestro Version: 2.11.0\nSelected device ${udid} using port ${flujo === 'smoke' ? 12345 : 23456}`)
    }
    const calls = []
    const output = recopilar({ directory, derived: directory, udid, flujo: 'recibos', run: (command, args) => { calls.push([command, args]); return 'exit=0 timedout=false' } })
    assert.ok(calls.some(([command, args]) => command === 'curl' && args.includes('http://127.0.0.1:23456/status')))
    assert.ok(!calls.some(([, args]) => args.join(' ').includes('12345')))
    assert.ok(!calls.some(([command]) => command === 'maestro'))
    assert.match(readFileSync(output, 'utf8'), /version=2.11.0 fuente=registro_original/u)
    assert.match(readFileSync(join(directory, 'smoke-debug/maestro.log'), 'utf8'), /12345/u)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
test('presupuesto global agota comandos pendientes con omitted y versión ausente no inventada', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ept113-ios-presupuesto-'))
  try {
    let tiempo = 0
    const calls = []
    const output = recopilar({ directory, derived: directory, udid, ahora: () => tiempo, presupuestoMs: 10000, run: (_command, _args, timeout) => { calls.push(timeout); tiempo += timeout; return 'exit=143 error=ETIMEDOUT timedout=true' } })
    const text = readFileSync(output, 'utf8')
    assert.ok(tiempo <= 10000)
    assert.deepEqual(calls, [4000, 4000])
    assert.match(text, /version=no-disponible/u)
    assert.match(text, /timedout=true/u)
    // Sin puertos/PIDs solo existen dos comandos; presupuesto cero omite ambos.
    const omitted = recopilar({ directory, derived: directory, udid, presupuestoMs: 0, run: () => assert.fail('No ejecutar fuera de presupuesto') })
    assert.match(readFileSync(omitted, 'utf8'), /omitted=budget_exhausted/u)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
test('screenshot final siempre usa límite5s y conserva resultado timeout explícito', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ept113-ios-pantalla-'))
  try {
    for (const estado of ['exit=0 timedout=false', 'exit=143 error=ETIMEDOUT timedout=true']) {
      capturarPantalla({ directory, udid, run: (command, args, timeout) => {
        assert.equal(command, 'xcrun'); assert.equal(timeout, 5000)
        assert.deepEqual(args.slice(0, 4), ['simctl', 'io', udid, 'screenshot'])
        return estado
      } })
      assert.equal(readFileSync(join(directory, 'screenshot-final-diagnostico.txt'), 'utf8'), estado)
    }
  } finally { rmSync(directory, { recursive: true, force: true }) }
})


test('upload Android falla cerrado si el sanitario no termina con éxito', () => {
  const workflow = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8')
  const sanitario = workflow.slice(workflow.indexOf('      - name: Sanear artifacts nativos'), workflow.indexOf('      - name: Subir evidencia Android'))
  const upload = workflow.slice(workflow.indexOf('      - name: Subir evidencia Android'), workflow.indexOf('  mobile-ios:'))
  const id = sanitario.match(/^        id: ([a-z_]+)$/mu)?.[1]
  assert.equal(id, 'sanear_android')
  assert.doesNotMatch(sanitario, /continue-on-error:/u)
  const condicion = upload.match(/^        if: (.+)$/mu)?.[1]
  assert.equal(condicion, `always() && steps.${id}.outcome == 'success'`)
  const permite = new Function('always', 'steps', `return (${condicion})`)
  for (const outcome of ['failure', 'skipped', 'cancelled', 'success']) assert.equal(permite(() => true, { [id]: { outcome } }), outcome === 'success')
})


test('Maestro CLI hereda opt-out oficial de telemetría en CI nativo sin bypass ni cambios de presupuesto', () => {
  const workflow = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8')
  const android = workflow.slice(workflow.indexOf('  mobile-android:'), workflow.indexOf('  mobile-ios:'))
  const ios = workflow.slice(workflow.indexOf('  mobile-ios:'), workflow.indexOf('  gate:'))
  assert.match(android, /    env:\n      MAESTRO_CLI_NO_ANALYTICS: '1'/u)
  assert.match(ios, /MAESTRO_CLI_NO_ANALYTICS: '1'\n        run: bash mobile\/scripts\/ejecutar-ios.sh/u)
  assert.match(android, /timeout-minutes: 30/u)
  assert.match(ios, /timeout-minutes: 12/u)
  assert.match(ios, /timeout-minutes: 40/u)
  for (const script of ['ejecutar-android.sh', 'ejecutar-ios.sh']) assert.doesNotMatch(readFileSync(join(root, 'mobile/scripts', script), 'utf8'), /env -i|unset MAESTRO_CLI_NO_ANALYTICS/u)
  assert.doesNotMatch(android + ios, /continue-on-error:/u)
})


test('scroll UP de Hasta preserva visibilidad completa, plazo y asserts con cadencia medida', () => {
  const flow = readFileSync(join(root, 'mobile/maestro/consultas.yaml'), 'utf8')
  const rango = flow.slice(flow.indexOf('# Un rango invertido'), flow.indexOf('# Inscripciones del hijo'))
  assert.match(rango, /id: 'periodo-hasta'\n    direction: UP\n    speed: 80\n    visibilityPercentage: 100\n    timeout: 15000/u)
  assert.match(rango, /- assertVisible: 'La fecha desde no puede ser posterior a la fecha hasta.'/u)
  assert.equal((flow.match(/speed: 80/gu) ?? []).length, 1)
})
test('presupuesto UI medido no cambia DB, full ni fallback', () => {
  const yml = readFileSync(join(root, '.github/workflows/local-tests.yml'), 'utf8')
  const expression = yml.match(/timeout-minutes: \$\{\{ (.+) \}\}/u)?.[1]
  assert.ok(expression)
  const seleccionar = new Function('inputs', `return (${expression})`)
  for (const [kind, expected] of [['full', 30], ['db', 12], ['ui', 10], ['otro', 8]]) assert.equal(seleccionar({ kind }), expected)
  const workflow = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8')
  assert.match(workflow.slice(workflow.indexOf('  fast:'), workflow.indexOf('  plan:')), /timeout-minutes: 8/u)
})
