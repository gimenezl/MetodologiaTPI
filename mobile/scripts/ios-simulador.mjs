import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const RUNTIME = 'com.apple.CoreSimulator.SimRuntime.iOS-26-2'
export const DEVICE = 'com.apple.CoreSimulator.SimDeviceType.iPhone-16e'
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu
export function gestionarSimulador({ accion, directory, run, attempt, ejecutar = spawnSync, ahora = () => performance.now() }) {
  if (!run || !attempt || !['crear', 'limpiar'].includes(accion)) throw new Error('Identidad de ejecución o acción inválida')
  const path = join(directory, 'simulador-propio.json')
  if (accion === 'crear') {
    const result = ejecutar('xcrun', ['simctl', 'list', 'runtimes', '-j'], { encoding: 'utf8', timeout: 60000, maxBuffer: 1048576 })
    if (result.error || result.status !== 0 || !JSON.parse(result.stdout).runtimes?.some(r => r.identifier === RUNTIME && r.isAvailable)) throw new Error('Runtime iOS 26.2 no disponible, no se elige otro implícitamente')
    const crear = ejecutar('xcrun', ['simctl', 'create', `EPT113-${run}-${attempt}`, DEVICE, RUNTIME], { encoding: 'utf8', timeout: 60000 })
    const udid = crear.stdout?.trim()
    if (crear.error || crear.status !== 0 || !uuid.test(udid ?? '')) throw new Error('No se pudo verificar el simulador creado')
    writeFileSync(path, JSON.stringify({ run, attempt, udid, runtime: RUNTIME, device: DEVICE, creado: true, inicio: new Date().toISOString() }), { mode: 0o600 })
    return udid
  }
  const own = JSON.parse(readFileSync(path, 'utf8'))
  if (own.run !== run || own.attempt !== attempt || !own.creado || own.runtime !== RUNTIME || own.device !== DEVICE || !uuid.test(own.udid)) throw new Error('Simulador ajeno, se preserva')
  if (own.eliminado) return
  const limite = ahora() + 5000
  try {
    for (const accion of ['shutdown', 'delete']) {
      const timeout = Math.floor(limite - ahora())
      if (timeout <= 0) throw new Error('Limpieza del simulador propio incompleta')
      const r = ejecutar('xcrun', ['simctl', accion, own.udid], { encoding: 'utf8', timeout })
      if (r.error || r.status !== 0) throw new Error(`Limpieza ${accion} no confirmada`)
      own[accion === 'shutdown' ? 'detenido' : 'eliminado'] = true
    }
  } catch (error) { own.error = error.message; throw error }
  finally { own.fin = new Date().toISOString(); writeFileSync(path, JSON.stringify(own), { mode: 0o600 }) }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const udid = gestionarSimulador({ accion: process.argv[2], directory: join(process.env.RUNNER_TEMP, 'evidencia-movil-ios'), run: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT })
  if (udid) console.log(udid)
}
