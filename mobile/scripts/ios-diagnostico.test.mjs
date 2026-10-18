import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { recopilar } from './diagnostico-ios.mjs'

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
        `if [[ "$*" == "simctl list devices available -j" ]]; then echo '{"devices":{"iOS":[{"name":"iPhone de prueba","isAvailable":true,"udid":"${udid}"}]}}'; else echo org.educarparatransformar.app; fi`
      )
      fake(
        'maestro',
        `if [[ "$1" == "--version" ]]; then echo 2.11.0; exit 0; fi
printf '%s\\n' "$*" >> "$TRAZA_PRUEBA"
debug=''; while [[ $# -gt 0 ]]; do if [[ "$1" == "--debug-output" ]]; then debug="$2"; shift; fi; shift; done
if [[ -n "$debug" ]]; then mkdir -p "$debug"; echo 'Selected device ${udid} using port 23456' > "$debug/maestro.log"; fi
exit ${exit}`
      )
      for (const name of ['ps', 'lsof', 'curl', 'xcodebuild']) fake(name, 'echo diagnostico-sintetico')
      const result = spawnSync(bash, ['mobile/scripts/ejecutar-ios.sh', 'app-sintetica.app'], {
        cwd: root,
        encoding: 'utf8',
        timeout: 15000,
        env: {
          ...process.env,
          PATH: `${bin}${delimiter}${process.env.PATH}`,
          RUNNER_TEMP: directory,
          TRAZA_PRUEBA: trace,
        },
      })
      assert.equal(result.status, exit, result.stderr)
      const calls = readFileSync(trace, 'utf8').trim().split(/\r?\n/u)
      assert.equal(calls.length, exit === 0 ? 2 : 1)
      for (const [index, call] of calls.entries()) {
        assert.match(call, /--debug-output .*--flatten-debug-output --test-output-dir/u)
        assert.match(call, index === 0 ? /smoke-ios.yaml/u : /recuperacion-ios.yaml/u)
      }
      assert.ok(existsSync(join(directory, 'evidencia-movil-ios/smoke-debug/maestro.log')))
      assert.ok(existsSync(join(directory, 'evidencia-movil-ios/smoke-diagnostico.txt')))
      assert.equal(existsSync(join(directory, 'evidencia-movil-ios/recuperacion-debug/maestro.log')), exit === 0)
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
