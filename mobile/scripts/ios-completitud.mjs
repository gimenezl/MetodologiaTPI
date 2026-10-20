// Un JUnit padre aprobado no sustituye la prueba de que terminaron los tres subflujos.
import { lstatSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const FLUJOS = ['smoke', 'recuperacion', 'recibos']
function archivos(dir, depth = 0) {
  if (depth > 6) throw new Error('Árbol de evidencia inesperado')
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name), st = lstatSync(path)
    if (st.isSymbolicLink()) return []
    return st.isDirectory() ? archivos(path, depth + 1) : [path]
  })
}
export function comprobarCompletitud(directory) {
  const files = archivos(directory)
  const candidatos = files.filter(p => basename(p) === 'commands.json' && lstatSync(p).size <= 8388608).map(p => JSON.parse(readFileSync(p, 'utf8'))).filter(Array.isArray)
  const completos = candidatos.filter(commands => FLUJOS.every(f => commands.some(c => c.command?.takeScreenshotCommand?.path === `ept113-ios-${f}-completado`)))
  if (completos.length !== 1) throw new Error('No se demuestra la ejecución completa única de los tres subflujos iOS')
  let anterior = -1
  const flujos = FLUJOS.map(flujo => {
    const nombre = `ept113-ios-${flujo}-completado`
    const matches = completos[0].filter(c => c.command?.takeScreenshotCommand?.path === nombre)
    if (matches.length !== 1 || matches[0].metadata?.status !== 'COMPLETED' || !Number.isSafeInteger(matches[0].metadata.timestamp) || matches[0].metadata.timestamp <= anterior) throw new Error('Subflujo ausente, repetido, fuera de orden o incompleto')
    anterior = matches[0].metadata.timestamp
    const imagen = files.filter(p => basename(p) === `${nombre}.png`)
    if (imagen.length !== 1 || readFileSync(imagen[0]).subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Captura final de subflujo no verificada')
    return { flujo, estado: 'completado', timestamp: anterior }
  })
  writeFileSync(join(directory, 'completitud-ios.json'), JSON.stringify({ esperado: FLUJOS, completados: flujos }), { mode: 0o600 })
  return flujos
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) comprobarCompletitud(process.argv[2])
