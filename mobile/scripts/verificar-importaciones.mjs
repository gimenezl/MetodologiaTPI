// Aislamiento del bundle móvil (EPT-102): importaciones prohibidas, dependencias DOM/servidor y secretos.
//
//   node scripts/verificar-importaciones.mjs                 # fuentes y paquete
//   node scripts/verificar-importaciones.mjs --bundle dist/android --bundle dist/ios   # artefactos exportados
//
// Sale con código 1 y lista cada hallazgo. Una lista vacía es el único resultado válido.
import { Buffer } from 'node:buffer'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ_POR_DEFECTO = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const EXTENSIONES_FUENTE = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])
const CARPETAS_FUENTE = ['src', 'app']

// Módulos del servidor, del navegador o de Node que no pertenecen a un bundle nativo.
const MODULOS_PROHIBIDOS = [
  /^next$/u, /^next\//u, /^react-dom(?:\/|$)/u, /^react-native-web(?:\/|$)/u, /^@supabase\/ssr$/u,
  /^server-only$/u, /^client-only$/u, /^node:/u,
  /^(?:fs|path|os|child_process|http|https|net|tls|dns|stream|zlib|worker_threads|cluster|vm)$/u,
  /supabase\.server(?:\.|$|\/)/u, /supabase\.admin(?:\.|$|\/)/u, /nodemailer/u, /(?:^|\/)services\/supabase/u,
]

const DEPENDENCIAS_PROHIBIDAS = new Set([
  'next', 'react-dom', 'react-native-web', '@supabase/ssr', 'react-native-webview', '@expo/dom-webview', 'nodemailer', 'server-only',
])

// El único archivo que nombra la clave privilegiada es la guarda que la rechaza.
export const ARCHIVOS_EXENTOS_DE_TEXTO_PRIVADO = new Set(['src/configuracion/entorno.ts'])

const TEXTO_PRIVADO = [
  { patron: /service[_-]?role/iu, motivo: 'referencia a service_role' },
  { patron: /SUPABASE_SERVICE/u, motivo: 'variable SUPABASE_SERVICE_*' },
  { patron: /sb_secret_[A-Za-z0-9]{20,}/u, motivo: 'clave secreta sb_secret_*' },
  { patron: /EXPO_PUBLIC_[A-Z0-9_]*(?:SECRET|SERVICE|PRIVATE|PASSWORD|TOKEN)/u, motivo: 'variable EXPO_PUBLIC_* con nombre de secreto' },
]

const PATRON_JWT = /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/gu

const PATRONES_BUNDLE = [
  { patron: /next\/headers/u, motivo: 'next/headers en el bundle' },
  { patron: /next\/cache/u, motivo: 'next/cache en el bundle' },
  { patron: /SUPABASE_SERVICE_ROLE_KEY/u, motivo: 'SUPABASE_SERVICE_ROLE_KEY en el bundle' },
  { patron: /supabase\.server/u, motivo: 'cliente supabase.server en el bundle' },
  { patron: /supabase\.admin/u, motivo: 'cliente supabase.admin en el bundle' },
  // El texto «@supabase/ssr» aparece en un mensaje de error de supabase-js: se detecta el cliente SSR por su API.
  { patron: /createServerClient/u, motivo: 'cliente SSR de Supabase (createServerClient) en el bundle' },
  { patron: /sb_secret_[A-Za-z0-9]{20,}/u, motivo: 'clave secreta sb_secret_* en el bundle' },
]

export function especificadoresDe(texto) {
  const salida = new Set()
  const patrones = [
    /(?:^|[\s;])(?:import|export)\s[^'"`;]*?\sfrom\s*['"]([^'"]+)['"]/gu,
    /(?:^|[\s;])import\s*['"]([^'"]+)['"]/gu,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gu,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/gu,
  ]
  for (const patron of patrones) for (const m of texto.matchAll(patron)) salida.add(m[1])
  return [...salida]
}

function* archivos(directorio, filtro) {
  if (!existsSync(directorio)) return
  for (const nombre of readdirSync(directorio)) {
    if (nombre === 'node_modules' || nombre === '.git') continue
    const ruta = join(directorio, nombre)
    const info = statSync(ruta)
    if (info.isDirectory()) yield* archivos(ruta, filtro)
    else if (!filtro || filtro(ruta)) yield ruta
  }
}

function decodificarCarga(segmento) {
  try {
    return JSON.parse(Buffer.from(segmento, 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

export function verificarProyecto(raiz = RAIZ_POR_DEFECTO) {
  const problemas = []
  const rel = ruta => relative(raiz, ruta).split(sep).join('/')

  for (const carpeta of CARPETAS_FUENTE) {
    for (const archivo of archivos(join(raiz, carpeta), r => EXTENSIONES_FUENTE.has(extname(r)))) {
      const texto = readFileSync(archivo, 'utf8')
      const id = rel(archivo)
      for (const esp of especificadoresDe(texto)) {
        if (MODULOS_PROHIBIDOS.some(p => p.test(esp))) problemas.push(`${id}: importación prohibida «${esp}»`)
        if (esp.startsWith('.')) {
          const destino = resolve(dirname(archivo), esp)
          if (relative(raiz, destino).startsWith('..')) problemas.push(`${id}: la importación «${esp}» sale de mobile/`)
        }
      }
      if (/\b(?:document|window)\.(?:getElementById|querySelector|addEventListener|location|localStorage)\b/u.test(texto) && !id.startsWith('src/compartido/')) {
        problemas.push(`${id}: usa APIs del DOM`)
      }
    }
  }

  const paquete = join(raiz, 'package.json')
  if (existsSync(paquete)) {
    const json = JSON.parse(readFileSync(paquete, 'utf8'))
    for (const nombre of Object.keys({ ...json.dependencies, ...json.devDependencies })) {
      if (DEPENDENCIAS_PROHIBIDAS.has(nombre)) problemas.push(`package.json: dependencia prohibida «${nombre}»`)
    }
  }

  const candidatos = [
    ...CARPETAS_FUENTE.flatMap(c => [...archivos(join(raiz, c), r => EXTENSIONES_FUENTE.has(extname(r)))]),
    ...['app.config.ts', '.env.example', 'app.json'].map(n => join(raiz, n)).filter(existsSync),
  ]
  for (const archivo of candidatos) {
    const id = rel(archivo)
    const texto = readFileSync(archivo, 'utf8')
    if (!ARCHIVOS_EXENTOS_DE_TEXTO_PRIVADO.has(id)) {
      for (const { patron, motivo } of TEXTO_PRIVADO) if (patron.test(texto)) problemas.push(`${id}: ${motivo}`)
    }
    for (const jwt of texto.match(PATRON_JWT) ?? []) {
      const carga = decodificarCarga(jwt.split('.')[1] ?? '')
      if (!carga || carga.role !== 'anon') problemas.push(`${id}: JWT embebido con rol distinto de anon`)
    }
  }
  for (const nombre of readdirSync(raiz)) {
    if (/^\.env(?:\..+)?$/u.test(nombre) && nombre !== '.env.example') problemas.push(`${nombre}: archivo de entorno local presente en el paquete`)
  }
  return problemas
}

export function verificarBundle(directorio) {
  const problemas = []
  if (!existsSync(directorio)) return [`${directorio}: no existe (¿se exportó el bundle?)`]
  let cantidad = 0
  for (const archivo of archivos(directorio)) {
    cantidad++
    const texto = readFileSync(archivo).toString('latin1')
    const id = archivo.split(sep).join('/')
    for (const { patron, motivo } of PATRONES_BUNDLE) if (patron.test(texto)) problemas.push(`${id}: ${motivo}`)
    for (const jwt of texto.match(PATRON_JWT) ?? []) {
      const carga = decodificarCarga(jwt.split('.')[1] ?? '')
      if (carga && carga.role && carga.role !== 'anon') problemas.push(`${id}: JWT con rol «${carga.role}» en el bundle`)
    }
  }
  if (cantidad === 0) problemas.push(`${directorio}: sin archivos`)
  return problemas
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const argumentos = process.argv.slice(2)
  const bundles = []
  for (let i = 0; i < argumentos.length; i++) if (argumentos[i] === '--bundle' && argumentos[i + 1]) bundles.push(argumentos[++i])
  const problemas = bundles.length ? bundles.flatMap(b => verificarBundle(resolve(b))) : verificarProyecto()
  if (problemas.length) {
    console.error(problemas.join('\n'))
    process.exit(1)
  }
  console.log(bundles.length ? `Bundles sin hallazgos (${bundles.length}).` : 'Fuentes y paquete sin hallazgos.')
}
