// Diagnóstico de lectura limitado al simulador y a los artifacts de este job.
import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { arch } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

function archivos(directory, depth = 0) {
  if (!existsSync(directory) || depth > 4) return []
  return readdirSync(directory)
    .slice(0, 100)
    .flatMap((name) => {
      const path = join(directory, name),
        stat = lstatSync(path)
      if (stat.isSymbolicLink()) return []
      return stat.isDirectory() && !name.endsWith('.xcresult') ? archivos(path, depth + 1) : [path]
    })
}

function ejecutar(command, args, timeout = 4000) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout, maxBuffer: 262144 })
  return `exit=${result.status ?? 'no disponible'} error=${result.error?.code ?? 'ninguno'} timedout=${result.error?.code === 'ETIMEDOUT'}\n${result.stdout ?? ''}${result.stderr ?? ''}`
}

export function recopilar({ directory, derived, udid, flujo = 'final', run = ejecutar, ahora = () => performance.now(), presupuestoMs = 10000 }) {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(udid) || !/^(?:smoke|recuperacion|recibos|final)$/u.test(flujo)) {
    throw new Error('Identidad de simulador o flujo inválida; no se capturan recursos desconocidos.')
  }
  const limite = ahora() + presupuestoMs
  const prefijo = resolve(directory, `${flujo}-debug`) + sep
  const logs = archivos(directory).filter((path) => path.endsWith('.log') && lstatSync(path).size <= 2097152 && (flujo === 'final' || resolve(path).startsWith(prefijo)))
  const ports = new Set(),
    pids = new Set()
  let versionMaestro
  for (const path of logs) {
    const text = readFileSync(path, 'utf8')
    versionMaestro ??= text.match(/Maestro Version: (\d+\.\d+\.\d+(?:[-.a-z0-9]+)?)/iu)?.[1]
    for (const match of text.matchAll(new RegExp(`Selected device ${udid} using port (\\d+)\\b`, 'giu'))) {
      const port = Number(match[1])
      if (port > 0 && port <= 65535) ports.add(port)
    }
    if (basename(path).startsWith('xctest_runner')) {
      for (const match of text.matchAll(/xcodebuild\[(\d+):\d+\]/gu)) pids.add(match[1])
    }
  }
  const entries = [`arquitectura=${arch()} node=${process.version} simulador=${udid} flujo=${flujo}`]
  const capture = (label, command, args) => {
    const restante = Math.floor(limite - ahora())
    entries.push(`\n## ${label}\n${restante <= 0 ? 'omitted=budget_exhausted timedout=false' : run(command, args, Math.min(4000, restante))}`)
  }
  capture('Xcode', 'xcodebuild', ['-version'])
  entries.push(`\n## Maestro\nversion=${versionMaestro ?? 'no-disponible'} fuente=registro_original`)
  for (const pid of [...pids].slice(-4)) {
    // comm, nunca args/command: no se exponen argv ni el entorno del proceso.
    capture(`Proceso XCTest registrado pid=${pid}`, 'ps', ['-p', pid, '-o', 'pid=,ppid=,stat=,comm='])
  }
  for (const port of [...ports].slice(-4)) {
    capture(`Listener del puerto registrado=${port}`, 'lsof', ['-nP', '-a', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpcn'])
    capture(`Estado HTTP del driver puerto=${port}`, 'curl', [
      '--silent',
      '--show-error',
      '--noproxy',
      '*',
      '--connect-timeout',
      '1',
      '--max-time',
      '2',
      '-w',
      '\nhttp_status=%{http_code}\n',
      `http://127.0.0.1:${port}/status`,
    ])
  }
  if (!ports.size) entries.push('\nPuerto no registrado para este UDID; no se supone ni explora otro puerto.')
  capture('Lanzamiento/crash del driver en el simulador seleccionado', 'xcrun', [
    'simctl',
    'spawn',
    udid,
    'log',
    'show',
    '--last',
    '3m',
    '--style',
    'compact',
    '--predicate',
    'process == "maestro-driver-ios" OR process == "Runner" OR eventMessage CONTAINS "dev.mobile.maestro-driver-ios"',
  ])
  // Solo DerivedData del build de este job; no se recorre HOME ni DiagnosticReports global.
  for (const bundle of archivos(join(derived, 'Logs', 'Test'))
    .filter((path) => path.endsWith('.xcresult'))
    .slice(-4)) {
    capture(`Resumen xcresult propio ${basename(bundle)}`, 'xcrun', [
      'xcresulttool',
      'get',
      'test-results',
      'summary',
      '--path',
      bundle,
    ])
  }
  const target = join(directory, `${flujo}-diagnostico.txt`)
  writeFileSync(target, `${entries.join('\n')}\n`, 'utf8')
  return target
}


/** Captura complementaria acotada; los flujos conservan sus capturas originales. */
export function capturarPantalla({ directory, udid, run = ejecutar }) {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(udid)) throw new Error('Identidad de simulador inválida')
  console.log('stage=ios-screenshot-final inicio timeout_ms=5000')
  const result = run('xcrun', ['simctl', 'io', udid, 'screenshot', join(directory, 'ios-final.png')], 5000)
  writeFileSync(join(directory, 'screenshot-final-diagnostico.txt'), result, 'utf8')
  console.log('stage=ios-screenshot-final fin')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const temp = process.env.RUNNER_TEMP
  if (!temp) throw new Error('RUNNER_TEMP requerido')
  const directory = join(temp, 'evidencia-movil-ios')
  const udid =
    process.argv[2] ||
    readFileSync(join(directory, 'ios-simulador.txt'), 'utf8').match(/Simulador: ([0-9a-f-]{36})/iu)?.[1]
  if (process.argv[3] === 'pantalla') capturarPantalla({ directory, udid })
  else {
    const flujo = process.argv[3] ?? 'final'
    console.log(`stage=ios-diagnostico-${flujo} inicio presupuesto_ms=10000`)
    recopilar({ directory, derived: join(temp, 'derived'), udid, flujo })
    console.log(`stage=ios-diagnostico-${flujo} fin`)
  }
}
