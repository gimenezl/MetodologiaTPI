// Diagnóstico A/B, nunca evidencia de aceptación del gate de la aplicación.
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { iniciarCapturaXCTest } from './ios-captura-temprana.mjs'

export function verificarFuente(run, artifact) {
  if (run.id !== 39338153901 || run.head_sha !== 'b3b82f4983d00540ddfa5cfea078a347e6f8e5b2' || run.status !== 'completed' ||
    artifact.id !== 12227059866 || artifact.expired || artifact.workflow_run?.id !== run.id ||
    artifact.name !== 'movil-ios-6735186e2fe1038d9f89971fbbede47735ee54e1') throw new Error('Fuente ajena o no verificable')
}
export function seleccionarBase(devices) {
  const device = devices.devices?.['com.apple.CoreSimulator.SimRuntime.iOS-26-2']?.find(d => d.name === 'iPhone 16e' && d.isAvailable)
  if (!device || !/^[0-9a-f-]{36}$/iu.test(device.udid)) throw new Error('Simulador base exacto no disponible')
  return device.udid
}
export function validarCaso(caso) {
  if (!['baseline', 'gui'].includes(caso)) throw new Error('Caso experimental inválido')
  return caso
}
export function requiereBoot(state) {
  if (state === 'Booted') return false
  if (state === 'Shutdown') return true
  throw new Error('Estado inicial no verificable')
}
async function ejecutar(caso) {
  validarCaso(caso)
  const temp = process.env.RUNNER_TEMP
  if (!temp) throw new Error('RUNNER_TEMP requerido')
  const salida = join(temp, 'experimento-ios'); mkdirSync(salida, { recursive: true })
  const metadata = { caso, aceptacion: false, inicio: new Date().toISOString(), runtime: 'iOS-26-2', xcode: '26.5', maestro: '2.11.0', errores: [], etapas: [] }
  const guardar = () => writeFileSync(join(salida, 'caso.json'), JSON.stringify(metadata), { mode: 0o600 })
  guardar()
  const comando = (nombre, cmd, args, timeout = 10000) => {
    const inicio = performance.now(), etapa = { nombre, inicio: new Date().toISOString(), timeout, estado: 'en-curso' }
    metadata.etapas.push(etapa); guardar()
    const r = spawnSync(cmd, args, { encoding: 'utf8', timeout, maxBuffer: 1048576 })
    Object.assign(etapa, { duracionMs: performance.now() - inicio, exit: r.status, error: r.error?.code ?? null, estado: r.error || r.status !== 0 ? 'fallo' : 'completa' }); guardar()
    writeFileSync(join(salida, `${nombre}.log`), `${r.stdout ?? ''}\n${r.stderr ?? ''}`, { mode: 0o600 })
    if (r.error || r.status !== 0) throw new Error(`${nombre}: ${r.error?.code ?? r.status}`)
    return r.stdout
  }
  let udid, creado = false, cerrarSim, host
  let hostBytes = 0, hostTruncado = false
  try {
    host = spawn('log', ['stream', '--style', 'compact', '--level', 'info', '--predicate', 'process == "xcodebuild" OR process == "testmanagerd" OR process == "xctestdaemon" OR process == "Simulator" OR process == "CoreSimulatorService"'], { stdio: ['ignore', 'pipe', 'pipe'] })
    const recibir = b => { const libre = 2097152 - hostBytes; if (libre > 0) { appendFileSync(join(salida, 'host.log'), b.subarray(0, libre)); hostBytes += Math.min(libre, b.length) }; if (b.length > libre) { hostTruncado = true; host.kill('SIGTERM') } }
    host.stdout.on('data', recibir); host.stderr.on('data', recibir)
    host.on('error', e => { metadata.errores.push(`host:${e.code}`); guardar() })
    comando('xcode', 'xcodebuild', ['-version'])
    comando('arquitectura', 'uname', ['-m'])
    comando('maestro-version', 'maestro', ['--version'], 20000)
    const devices = JSON.parse(comando('devices', 'xcrun', ['simctl', 'list', 'devices', 'available', '-j'], 45000))
    udid = seleccionarBase(devices)
    let estadoInicial = devices.devices['com.apple.CoreSimulator.SimRuntime.iOS-26-2'].find(d => d.udid === udid).state
    if (caso === 'gui') {
      udid = comando('crear', 'xcrun', ['simctl', 'create', 'EPT113-experimento', 'com.apple.CoreSimulator.SimDeviceType.iPhone-16e', 'com.apple.CoreSimulator.SimRuntime.iOS-26-2']).trim()
      if (!/^[0-9a-f-]{36}$/iu.test(udid)) throw new Error('UDID creado inválido')
      creado = true; estadoInicial = 'Shutdown'
    }
    metadata.udid = udid; guardar()
    metadata.estadoInicial = estadoInicial; guardar()
    if (requiereBoot(estadoInicial)) comando('boot', 'xcrun', ['simctl', 'boot', udid], 30000)
    cerrarSim = iniciarCapturaXCTest({ directory: salida, udid })
    if (caso === 'gui') comando('gui', 'open', ['-a', `${process.env.DEVELOPER_DIR}/Applications/Simulator.app`, '--args', '-CurrentDeviceUDID', udid])
    comando('bootstatus', 'xcrun', ['simctl', 'bootstatus', udid, '-b'], 180000)
    const apps = readdirSync(join(temp, 'app')).filter(f => f.endsWith('.app'))
    if (apps.length !== 1) throw new Error('App fuente ambigua')
    comando('install', 'xcrun', ['simctl', 'install', udid, join(temp, 'app', apps[0])], 30000)
    const inicioMaestro = performance.now(), etapaMaestro = { nombre: 'maestro', estado: 'en-curso', inicio: new Date().toISOString() }
    metadata.etapas.push(etapaMaestro); guardar()
    const maestro = spawn('maestro', ['--device', udid, 'test', '--format', 'junit', '--output', join(salida, 'smoke.xml'), '--debug-output', join(salida, 'debug'), '--flatten-debug-output', '--test-output-dir', join(salida, 'capturas'), 'mobile/maestro/smoke-ios.yaml'], { stdio: ['ignore', 'pipe', 'pipe'] })
    let bytes = 0
    const log = b => { const libre = 1048576 - bytes; if (libre > 0) appendFileSync(join(salida, 'maestro.log'), b.subarray(0, libre)); bytes += b.length }
    maestro.stdout.on('data', log); maestro.stderr.on('data', log)
    metadata.exit = await new Promise((ok, fail) => { maestro.once('error', fail); maestro.once('close', ok) })
    Object.assign(etapaMaestro, { estado: metadata.exit === 0 ? 'completa' : 'fallo', exit: metadata.exit, duracionMs: performance.now() - inicioMaestro }); guardar()
    metadata.maestroTruncado = bytes > 1048576
    comando('procesos', 'ps', ['-axo', 'pid=,ppid=,stat=,comm='])
    comando('launchctl', 'xcrun', ['simctl', 'spawn', udid, 'launchctl', 'list'])
    const listeners = spawnSync('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN'], { encoding: 'utf8', timeout: 5000, maxBuffer: 1048576 })
    writeFileSync(join(salida, 'listeners.log'), `exit=${listeners.status} error=${listeners.error?.code ?? 'ninguno'}\n${listeners.stdout ?? ''}\n${listeners.stderr ?? ''}`, { mode: 0o600 })
    // No se interpreta un proceso vivo como prueba de readiness ni como flujo aprobado.
    metadata.resultado = metadata.exit === 0 ? 'smoke-ejecutado-no-aceptacion' : 'smoke-fallido'
  } catch (error) { metadata.errores.push(error.message); metadata.exit = 1 }
  finally {
    await cerrarSim?.()
    if (host?.exitCode === null) { host.kill('SIGTERM'); await new Promise(ok => { const t = setTimeout(() => { host.kill('SIGKILL'); ok() }, 1000); host.once('close', () => { clearTimeout(t); ok() }) }) }
    if (udid) { try { comando('shutdown', 'xcrun', ['simctl', 'shutdown', udid]) } catch (e) { metadata.errores.push(e.message) } }
    if (creado) { try { comando('delete-propio', 'xcrun', ['simctl', 'delete', udid]) } catch (e) { metadata.errores.push(e.message) } }
    metadata.hostBytes = hostBytes; metadata.hostTruncado = hostTruncado; metadata.fin = new Date().toISOString(); guardar()
  }
  process.exitCode = metadata.exit === 0 && metadata.errores.length === 0 ? 0 : 1
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv[2] === 'verificar') verificarFuente(JSON.parse(readFileSync(process.argv[3])), JSON.parse(readFileSync(process.argv[4])))
  else await ejecutar(process.argv[2])
}
