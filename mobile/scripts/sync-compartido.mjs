// Copia reproducible de módulos PUROS del servidor web a mobile/src/compartido.
// No hay enlaces simbólicos ni importaciones fuera de mobile/: Metro solo ve archivos propios.
// `--check` falla si la copia difiere de la fuente (deriva) o si la fuente deja de ser pura.
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const destino = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'compartido')

export const FUENTES = [
  { origen: 'src/lib/errores.ts', salida: 'errores.ts' },
  { origen: 'src/types/database.generated.ts', salida: 'database.generated.ts' },
]

const IMPORTACION = /^\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/gmu

export function importacionesDe(texto) {
  return [...texto.matchAll(IMPORTACION)].map(m => m[1] ?? m[2] ?? m[3])
}

export function encabezado(origen, sha) {
  return `// GENERADO por mobile/scripts/sync-compartido.mjs desde ${origen}. No editar a mano.\n// sha256 de la fuente: ${sha}\n`
}

export function generar({ base = raiz } = {}) {
  return FUENTES.map(({ origen, salida }) => {
    const fuente = readFileSync(join(base, origen), 'utf8').replace(/\r\n/gu, '\n')
    const prohibidas = importacionesDe(fuente).filter(esp => !esp.startsWith('.'))
    if (prohibidas.length) throw new Error(`${origen} importa módulos no puros: ${prohibidas.join(', ')}`)
    const relativas = importacionesDe(fuente)
    if (relativas.length) throw new Error(`${origen} importa módulos relativos; no es autocontenido: ${relativas.join(', ')}`)
    const sha = createHash('sha256').update(fuente).digest('hex')
    return { salida, contenido: encabezado(origen, sha) + fuente }
  })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const modo = process.argv.includes('--check') ? 'check' : 'sync'
  const archivos = generar()
  let deriva = false
  for (const { salida, contenido } of archivos) {
    const ruta = join(destino, salida)
    if (modo === 'sync') { mkdirSync(destino, { recursive: true }); writeFileSync(ruta, contenido); continue }
    const actual = existsSync(ruta) ? readFileSync(ruta, 'utf8').replace(/\r\n/gu, '\n') : null
    if (actual !== contenido) { deriva = true; console.error(`Deriva en mobile/src/compartido/${salida}: ejecutar npm run compartido:sync`) }
  }
  if (deriva) process.exit(1)
  console.log(modo === 'sync' ? 'Compartido sincronizado.' : 'Compartido sin deriva.')
}
