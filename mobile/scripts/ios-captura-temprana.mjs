// Observación del driver durante el flujo; no altera su readiness ni vuelve a iniciarlo.
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { appendFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function iniciarCapturaXCTest({ directory, udid, crear = spawn, maximoBytes = 1048576, graciaMs = 1000 }) {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(udid)) throw new Error('Simulador inválido')
  const archivo = join(directory, 'xctest-temprano.log'), metadata = join(directory, 'xctest-temprano.json')
  const estado = { udid, inicio: new Date().toISOString(), bytes: 0, truncado: false, cerrado: false, error: null, exit: null, signal: null }
  const guardar = () => writeFileSync(metadata, JSON.stringify(estado), { encoding: 'utf8', mode: 0o600 })
  writeFileSync(archivo, '', { mode: 0o600 })
  guardar()
  const proceso = crear('xcrun', ['simctl', 'spawn', udid, 'log', 'stream', '--style', 'compact', '--level', 'info', '--predicate',
    'process == "testmanagerd" OR process == "xctestdaemon" OR process == "xctest" OR process == "Runner" OR eventMessage CONTAINS "dev.mobile.maestro-driver-ios"'],
  { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  let cerrar, timer
  const fin = new Promise(resolve => { cerrar = resolve })
  const terminar = (exit, signal) => {
    if (estado.cerrado) return
    clearTimeout(timer)
    estado.cerrado = true; estado.exit = exit; estado.signal = signal
    estado.fin = new Date().toISOString(); guardar(); cerrar()
  }
  const recibir = data => {
    const bytes = Buffer.from(data), disponibles = maximoBytes - estado.bytes
    if (disponibles > 0) { appendFileSync(archivo, bytes.subarray(0, disponibles)); estado.bytes += Math.min(bytes.length, disponibles) }
    if (bytes.length > disponibles) { estado.truncado = true; guardar(); void cerrarCaptura() }
  }
  proceso.stdout.on('data', recibir); proceso.stderr.on('data', recibir)
  proceso.on('error', error => { estado.error = error.code ?? 'captura-no-disponible'; terminar(null, null) })
  proceso.on('close', terminar)
  async function cerrarCaptura() {
    if (!estado.cerrado && !timer) {
      proceso.kill('SIGTERM')
      if (!estado.cerrado) timer = setTimeout(() => {
        proceso.kill('SIGKILL')
        estado.cierreNoConfirmado = true; guardar(); cerrar()
      }, graciaMs)
    }
    await fin
  }
  return cerrarCaptura
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.env.RUNNER_TEMP) throw new Error('RUNNER_TEMP requerido')
  const cerrar = iniciarCapturaXCTest({ directory: join(process.env.RUNNER_TEMP, 'evidencia-movil-ios'), udid: process.argv[2] })
  console.log('stage=ios-xctest-observacion inicio')
  process.once('SIGTERM', () => { void cerrar() })
  process.once('SIGINT', () => { void cerrar() })
}
