import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const RUNTIME = 'com.apple.CoreSimulator.SimRuntime.iOS-26-2'
export const DEVICE = 'com.apple.CoreSimulator.SimDeviceType.iPhone-16e'
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu
export function presupuestoLimpieza({ inicioStep, reloj = () => Date.now(), ahora = () => performance.now() }) {
  const inicio = Number(inicioStep), transcurrido = reloj() - inicio
  if (!/^\d+$/u.test(String(inicioStep)) || !Number.isSafeInteger(inicio) || transcurrido < 0 || transcurrido >= 720000) throw new Error('Inicio del step ausente, inválido o agotado')
  // Tras validar la fecha compartida, el presupuesto restante solo decrece con reloj monotónico.
  const limite = ahora() + 720000 - transcurrido - 2000
  return () => {
    const restante = Math.floor(limite - ahora())
    if (restante <= 0) throw new Error('Presupuesto restante del step agotado; limpieza no confirmada')
    return restante
  }
}
export function gestionarSimulador({ accion, directory, run, attempt, inicioStep, reloj, ejecutar = spawnSync, ahora = () => performance.now() }) {
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
  let restante
  own.limpieza = []
  const observar = (accion, args) => {
    const timeout = restante(), inicio = ahora()
    const r = ejecutar('xcrun', args, { encoding: 'utf8', timeout, maxBuffer: 65536 })
    const estado = { accion, timeout, duracionMs: ahora() - inicio, exit: r.status, error: r.error?.code ?? null }
    own.limpieza.push(estado)
    writeFileSync(join(directory, `limpieza-${accion}.log`), `${JSON.stringify(estado)}\n${r.stdout ?? ''}\n${r.stderr ?? ''}`.slice(0, 65536), { mode: 0o600 })
    if (r.error || r.status !== 0) throw new Error(`Limpieza ${accion} no confirmada`)
    return r.stdout
  }
  try {
    restante = presupuestoLimpieza({ inicioStep, reloj, ahora })
    for (const accion of ['shutdown', 'delete']) {
      observar(accion, ['simctl', accion, own.udid])
      own[accion === 'shutdown' ? 'detenido' : 'borradoSolicitado'] = true
    }
    const devices = JSON.parse(observar('readback', ['simctl', 'list', 'devices', '-j']))
    const listas = devices.devices && typeof devices.devices === 'object' && !Array.isArray(devices.devices) ? Object.values(devices.devices) : null
    if (!listas || listas.some(l => !Array.isArray(l) || l.some(d => !d || !uuid.test(d.udid ?? ''))) || listas.flat().some(d => d.udid === own.udid)) throw new Error('El readback no confirma ausencia del simulador propio')
    own.eliminado = true
  } catch (error) { own.error = error.message; throw error }
  finally { own.fin = new Date().toISOString(); writeFileSync(path, JSON.stringify(own), { mode: 0o600 }) }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const udid = gestionarSimulador({ accion: process.argv[2], directory: join(process.env.RUNNER_TEMP, 'evidencia-movil-ios'), run: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT, inicioStep: process.env.EPT_IOS_STEP_STARTED_AT })
  if (udid) console.log(udid)
}
