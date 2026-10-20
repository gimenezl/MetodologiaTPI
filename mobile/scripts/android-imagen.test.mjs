import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import test from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PAQUETE, prepararImagen, resolverSdk, localizarSdkmanager } from './android-imagen.mjs'

function paquete(root, partial = false) {
  const dir = join(root, ...PAQUETE.split(';')); mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.xml'), `<localPackage path="${PAQUETE}"/>`)
  writeFileSync(join(dir, 'source.properties'), 'AndroidVersion.ApiLevel=34\nSystemImage.Abi=x86_64\nSystemImage.TagId=google_apis\n')
  for (const file of ['system.img', 'userdata.img', 'kernel-ranchu', 'ramdisk.img']) if (!(partial && file === 'kernel-ranchu')) writeFileSync(join(dir, file), Buffer.alloc(file === 'system.img' ? 1048576 : 1))
}
function caso(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'ept113-imagen-test-')), sdk = join(dir, 'sdk'), temp = join(dir, 'tmp')
  mkdirSync(sdk); mkdirSync(temp)
  mkdirSync(join(sdk, 'cmdline-tools/latest/bin'), { recursive: true })
  writeFileSync(join(sdk, 'cmdline-tools/latest/bin/sdkmanager'), '#!/bin/sh\n', { mode: 0o755 })
  try { fn({ sdk, temp }) } finally { rmSync(dir, { recursive: true, force: true }) }
}
function ejecucion(respuestas, llamadas, partial = false) {
  return (cmd, args, options) => {
    llamadas.push({ cmd, args, options })
    if (args.includes('--help')) return { status: 0, stdout: 'Usage:\n--sdk_root --list_installed --verbose' }
    if (args.includes('--version')) return { status: 0, stdout: '12.0\n' }
    if (args.includes('--list_installed')) return { status: 0, stdout: PAQUETE }
    const r = respuestas.shift()
    if (r.status === 0) paquete(args.find(a => a.startsWith('--sdk_root=')).slice(11), partial)
    return r
  }
}
test('primer éxito publica solo imagen verificada y SDK la reconoce', () => caso(({ sdk, temp }) => {
  const llamadas = []
  prepararImagen({ sdk, temp, ejecutar: ejecucion([{ status: 0 }], llamadas) })
  assert.equal(llamadas.filter(c => c.args.includes('--install')).length, 1)
  assert.ok(existsSync(join(sdk, ...PAQUETE.split(';'), 'system.img')))
  const install = llamadas.find(c => c.args.includes('--install'))
  assert.ok(install.options.env.ANDROID_USER_HOME.startsWith(temp))
  assert.ok(install.options.env.JAVA_TOOL_OPTIONS.includes('-Duser.home='))
  assert.equal(JSON.parse(readFileSync(join(temp, 'evidencia-movil-android/sdk-imagen/resultado.json'))).publicada, true)
}))
test('solo ZIP habilita una segunda descarga aislada, sin borrar caché global', () => caso(({ sdk, temp }) => {
  const llamadas = []
  prepararImagen({ sdk, temp, ejecutar: ejecucion([{ status: 1, stderr: 'Error on ZipFile unknown archive' }, { status: 0 }], llamadas) })
  const installs = llamadas.filter(c => c.args.includes('--install'))
  assert.equal(installs.length, 2)
  assert.notEqual(installs[0].args[0], installs[1].args[0])
  assert.ok(existsSync(installs[0].args[0].slice(11)))
  assert.ok(installs.every(c => c.cmd === localizarSdkmanager(sdk) && c.options.timeout <= 210000))
}))
test('segundo ZIP falla cerrado; otros errores y timeouts nunca reintentan', () => {
  for (const respuestas of [[{ status: 1, stderr: 'Error on ZipFile' }, { status: 1, stderr: 'Error on ZipFile' }], [{ status: 1, stderr: 'license rejected' }], [{ status: null, error: { code: 'ETIMEDOUT' }, stderr: 'Error on ZipFile' }]]) caso(({ sdk, temp }) => {
    const llamadas = [], esperadas = respuestas.length
    assert.throws(() => prepararImagen({ sdk, temp, ejecutar: ejecucion([...respuestas], llamadas) }))
    assert.equal(llamadas.filter(c => c.args.includes('--install')).length, esperadas)
    assert.ok(!existsSync(join(sdk, ...PAQUETE.split(';'))))
  })
})
test('exit0 con imagen parcial no publica y no reintenta', () => caso(({ sdk, temp }) => {
  const llamadas = []
  assert.throws(() => prepararImagen({ sdk, temp, ejecutar: ejecucion([{ status: 0 }], llamadas, true) }))
  assert.equal(llamadas.filter(c => c.args.includes('--install')).length, 1)
  assert.ok(!existsSync(join(sdk, ...PAQUETE.split(';'))))
}))
test('discovery absoluto no depende de PATH y raíces ambiguas/binario ausente fallan sin retry', () => caso(({ sdk, temp }) => {
  assert.equal(resolverSdk({ home: sdk, sdkRoot: sdk }), resolverSdk({ home: sdk }))
  assert.throws(() => resolverSdk({ home: sdk, sdkRoot: temp }), /ambigua/u)
  assert.throws(() => resolverSdk({}), /ausente/u)
  assert.ok(localizarSdkmanager(sdk).endsWith('sdkmanager'))
  const vacio = join(temp, 'sdk-vacio'); mkdirSync(vacio)
  assert.throws(() => prepararImagen({ sdk: vacio, temp, ejecutar: () => assert.fail('No lanzar un binario ausente') }), /sin sdkmanager/u)
}))
test('SDK12 Usage exit1 legítimo y versión exit0 permiten instalar, sin alterar instalación estricta', () => caso(({ sdk, temp }) => {
  const llamadas = [], run = ejecucion([{ status: 0 }], llamadas)
  prepararImagen({ sdk, temp, ejecutar: (cmd, args, opts) => args.includes('--help') ? { status: 1, stderr: 'Usage:\n sdkmanager --sdk_root --list_installed --verbose' } : run(cmd, args, opts) })
  assert.equal(llamadas.filter(c => c.args.includes('--install')).length, 1)
  const metadata = JSON.parse(readFileSync(join(temp, 'evidencia-movil-android/sdk-imagen/resultado.json')))
  assert.deepEqual(metadata.ayuda, { exit: 1, error: null })
  assert.equal(metadata.versionEjecutable, '12.0')
}))
test('ayuda incompleta/fatal/error/exit2 o versión no exit0 nunca inicia descarga ni retry', () => {
  const completa = 'Usage:\n--sdk_root --list_installed --verbose'
  for (const [ayuda, version] of [
    [{ status: 1, stdout: 'Usage:\n--sdk_root' }, null],
    [{ status: 1, stdout: completa, stderr: 'Error: Java no disponible' }, null],
    [{ status: null, stdout: completa, error: { code: 'ENOENT' } }, null],
    [{ status: 2, stdout: completa }, null],
    [{ status: 1, stdout: completa }, { status: 1, stdout: '12.0' }],
    [{ status: 1, stdout: completa }, { status: 0, stdout: 'no-verificable' }],
  ]) caso(({ sdk, temp }) => {
    assert.throws(() => prepararImagen({ sdk, temp, ejecutar: (_, args) => {
      if (args.includes('--help')) return ayuda
      if (args.includes('--version')) return version
      assert.fail('Ayuda/versión inválida no permite instalar ni listar paquetes')
    } }))
    assert.equal(JSON.parse(readFileSync(join(temp, 'evidencia-movil-android/sdk-imagen/resultado.json'))).intentos.length, 0)
  })
})
test('FATAL explícito junto a Usage y flags válidos bloquea antes de versión e instalación', () => {
  for (const fatal of ['FATAL: internal sdkmanager failure', 'fatal error: internal sdkmanager failure']) caso(({ sdk, temp }) => {
    const calls = []
    assert.throws(() => prepararImagen({ sdk, temp, ejecutar: (_, args) => {
      calls.push(args)
      if (args.includes('--help')) return { status: 1, stdout: 'Usage:\n--sdk_root --list_installed --verbose', stderr: fatal }
      if (args.includes('--version')) return { status: 0, stdout: '12.0' }
      return { status: 0 }
    } }), /Ayuda/u)
    assert.deepEqual(calls, [['--help']])
    assert.equal(JSON.parse(readFileSync(join(temp, 'evidencia-movil-android/sdk-imagen/resultado.json'))).intentos.length, 0)
  })
})
test('paquete existente completo se reutiliza; parcial se preserva sin sobrescribir', () => {
  for (const partial of [false, true]) caso(({ sdk, temp }) => {
    paquete(sdk, partial); const llamadas = []
    const run = () => prepararImagen({ sdk, temp, ejecutar: ejecucion([], llamadas) })
    if (partial) assert.throws(run); else run()
    assert.equal(llamadas.filter(c => c.args.includes('--install')).length, 0)
    assert.ok(existsSync(join(sdk, ...PAQUETE.split(';'), 'system.img')))
  })
})
test('preflight antecede al action sin modificar API, arquitectura o presupuesto del job', () => {
  const y = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8')
  assert.ok(y.indexOf('--stage android-sdk-image --seconds 220') < y.indexOf('uses: reactivecircus/android-emulator-runner@a421e43855164a8197daf9d8d40fe71c6996bb0d'))
  assert.match(y, /api-level: 34\s+arch: x86_64\s+target: google_apis/u)
  assert.match(y, /name: CI \/ móvil Android[\s\S]*?timeout-minutes: 30/u)
  assert.match(y, /evidencia-movil-android\/sdk-imagen\//u)
})
