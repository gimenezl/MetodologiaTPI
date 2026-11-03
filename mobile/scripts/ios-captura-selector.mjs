import { spawn } from 'node:child_process'
import { appendFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const EVENTOS = new Set(['montado', 'desmontado', 'inicio', 'descartado-contexto', 'aplicado', 'elegido', 'cancelado', 'permiso_denegado', 'sin_camara', 'invalido', 'error'])
export function iniciarCapturaSelector({ directory, udid, crear = spawn, graciaMs = 1000 }) {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(udid)) throw new Error('Simulador inválido')
  const archivo = join(directory, 'selector-ci.log'), estado = join(directory, 'selector-ci-estado.json')
  writeFileSync(archivo, '', { mode: 0o600 })
  const p = crear('xcrun', ['simctl', 'spawn', udid, 'log', 'stream', '--style', 'compact', '--level', 'info', '--predicate', 'process == "EducarparaTransformar" AND subsystem == "com.facebook.react.log" AND category == "javascript"'], { stdio: ['ignore', 'pipe', 'pipe'] })
  let resto = '', cerrado = false, error = false, timer, cerrarFin
  const fin = new Promise(resolve => { cerrarFin = resolve })
  p.stdout.setEncoding('utf8')
  p.stdout.on('data', chunk => {
    resto += chunk
    const lineas = resto.split('\n'); resto = lineas.pop().slice(-4096)
    for (const linea of lineas) {
      const coincidencia = linea.match(/EPT_CI_SELECTOR:([a-z_-]+)(?![A-Za-z0-9_-])/u)
      if (coincidencia && EVENTOS.has(coincidencia[1])) appendFileSync(archivo, `EPT_CI_SELECTOR:${coincidencia[1]}\n`)
    }
  })
  // Never persist arbitrary stderr or simulator log lines.
  p.stderr.resume()
  const terminar = (exit, signal) => {
    if (cerrado) return
    cerrado = true; clearTimeout(timer)
    writeFileSync(estado, JSON.stringify({ cerrado: true, error, exit, signal }), { mode: 0o600 })
    cerrarFin()
  }
  p.on('error', () => { error = true; terminar(null, null) })
  p.on('close', terminar)
  return async () => {
    if (!cerrado) {
      p.kill('SIGTERM')
      timer = setTimeout(() => { p.kill('SIGKILL'); writeFileSync(estado, JSON.stringify({ cerrado: false, error: true }), { mode: 0o600 }); cerrarFin() }, graciaMs)
    }
    await fin
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const cerrar = iniciarCapturaSelector({ directory: join(process.env.RUNNER_TEMP, 'evidencia-movil-ios'), udid: process.argv[2] })
  process.once('SIGTERM', () => { void cerrar() })
  process.once('SIGINT', () => { void cerrar() })
}
