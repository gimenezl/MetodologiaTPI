// Aislamiento del bundle móvil (EPT-102): importaciones prohibidas, dependencias DOM/servidor y secretos.
//
//   node scripts/verificar-importaciones.mjs                 # fuentes y paquete
//   node scripts/verificar-importaciones.mjs --bundle dist/android --bundle dist/ios   # artefactos exportados
//
// Sale con código 1 y lista cada hallazgo. Una lista vacía es el único resultado válido.
import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
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
  /^(?:fs|path|os|child_process|http|https|net|tls|dns|stream|zlib|worker_threads|cluster|vm|crypto|buffer|util|events|url)(?:\/.*)?$/u,
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
]

const PATRON_CLAVE_SECRETA = /sb_secret_[A-Za-z0-9]{20,}/u
const MOTIVO_CLAVE_SECRETA = 'clave secreta sb_secret_* en el bundle'

export function cadenasDeHermes(dump) {
  return [...dump.matchAll(/^s\d+\[[^\]]+\]: (.*)$/gmu)].map(coincidencia => coincidencia[1])
}

function analizarInstruccion(linea) {
  const coincidencia = /^\s{2,}([A-Za-z][A-Za-z0-9]*)\s+(.*)$/u.exec(linea)
  if (!coincidencia) return null
  return {
    operacion: coincidencia[1],
    operandos: coincidencia[2],
    registros: [...coincidencia[2].matchAll(/\br(\d+)\b/gu)].map(registro => `r${registro[1]}`),
  }
}

function llamadasDeGuardiaSupabase(lineas) {
  const seguras = new Set()
  let funcion = ''
  let tipoFuncion = ''
  let inicioFuncion = 0
  const siguiente = indice => {
    for (let actual = indice + 1; actual < lineas.length; actual++) {
      if (/^\s*L\d+:\s*$/u.test(lineas[actual])) continue
      const instruccion = analizarInstruccion(lineas[actual])
      if (instruccion) return { indice: actual, instruccion }
    }
    return null
  }
  const textoLiteral = instruccion => /^r\d+,\s+"((?:\\.|[^"\\])*)"/u.exec(instruccion.operandos)?.[1]

  for (let indice = 0; indice < lineas.length; indice++) {
    const encabezado = /^(Function|NCFunction|Constructor|NCConstructor)<([^>(]+)/u.exec(lineas[indice])
    if (encabezado) {
      tipoFuncion = encabezado[1]
      funcion = encabezado[2]
      inicioFuncion = indice
    }
    if (funcion !== 'fetchWithAuth' && !(tipoFuncion === 'Constructor' && funcion === 'SupabaseClient')) continue

    const primero = analizarInstruccion(lineas[indice])
    if (!primero || primero.operacion !== 'GetByIdShort' || !primero.operandos.endsWith('"startsWith"')) continue
    const [metodoPublicable, receptor] = primero.registros
    const cargaPublicable = siguiente(indice)
    const llamadaPublicable = cargaPublicable && siguiente(cargaPublicable.indice)
    const ramaPublicable = llamadaPublicable && siguiente(llamadaPublicable.indice)
    const segundoMetodo = ramaPublicable && siguiente(ramaPublicable.indice)
    const cargaSecreta = segundoMetodo && siguiente(segundoMetodo.indice)
    const llamadaSecreta = cargaSecreta && siguiente(cargaSecreta.indice)
    if (!llamadaSecreta) continue

    const [registroPublicable] = cargaPublicable.instruccion.registros
    const [resultadoPublicable, metodoPublicableLlamada, receptorPublicable, argumentoPublicable] = llamadaPublicable.instruccion.registros
    const [resultadoSecreto] = llamadaSecreta.instruccion.registros
    const [metodoSecreto, receptorSecreto] = segundoMetodo.instruccion.registros
    const [argumentoSecreto] = cargaSecreta.instruccion.registros
    const asignacionesReceptor = lineas.slice(inicioFuncion, indice).filter(linea => {
      const instruccion = analizarInstruccion(linea)
      return instruccion?.registros[0] === receptor
        && /^(?:LoadParam|LoadConstString|LoadFromEnvironment|Mov|Add|AddS)$/u.test(instruccion.operacion)
    })
    const ultimaAsignacionReceptor = analizarInstruccion(asignacionesReceptor.at(-1) ?? '')
    const etiquetaRama = /^([A-Za-z]\w*),/u.exec(ramaPublicable.instruccion.operandos)?.[1]
    const etiquetaUnion = new RegExp(`^\\s*${etiquetaRama}:\\s*$`, 'u')
    let indiceUnion = llamadaSecreta.indice + 1
    while (indiceUnion < lineas.length && !analizarInstruccion(lineas[indiceUnion]) && !etiquetaUnion.test(lineas[indiceUnion])) indiceUnion++
    if (indiceUnion < lineas.length && etiquetaUnion.test(lineas[indiceUnion])) indiceUnion++
    const continuacion = siguiente(indiceUnion - 1)
    const esRamaFinal = continuacion?.instruccion.operacion === 'JmpTrueLong'
      && continuacion.instruccion.registros[0] === resultadoSecreto
    const movimiento = continuacion?.instruccion.operacion === 'Mov' ? continuacion : null
    const negacion = movimiento && siguiente(movimiento.indice)
    const almacenamiento = negacion && siguiente(negacion.indice)
    const regsMovimiento = movimiento?.instruccion.registros ?? []
    const regsNegacion = negacion?.instruccion.registros ?? []
    const regsAlmacenamiento = almacenamiento?.instruccion.registros ?? []

    const formaExacta = primero.registros.length === 2
      && cargaPublicable.instruccion.operacion === 'LoadConstString'
      && textoLiteral(cargaPublicable.instruccion) === 'sb_publishable_'
      && llamadaPublicable.instruccion.operacion === 'Call2'
      && metodoPublicableLlamada === metodoPublicable
      && receptorPublicable === receptor
      && argumentoPublicable === registroPublicable
      && ramaPublicable.instruccion.operacion === 'JmpTrue'
      && ramaPublicable.instruccion.registros[0] === resultadoPublicable
      && segundoMetodo.instruccion.operacion === 'GetByIdShort'
      && segundoMetodo.instruccion.operandos.endsWith('"startsWith"')
      && receptorSecreto === receptor
      && cargaSecreta.instruccion.operacion === 'LoadConstString'
      && textoLiteral(cargaSecreta.instruccion) === 'sb_secret_'
      && llamadaSecreta.instruccion.operacion === 'Call2'
      && llamadaSecreta.instruccion.registros[1] === metodoSecreto
      && llamadaSecreta.instruccion.registros[2] === receptor
      && llamadaSecreta.instruccion.registros[3] === argumentoSecreto
      && ultimaAsignacionReceptor?.operacion === 'LoadParam'
      && etiquetaRama !== undefined
      && etiquetaUnion.test(lineas[indiceUnion - 1])
      && (esRamaFinal || (
        funcion === 'fetchWithAuth'
        && movimiento?.instruccion.operacion === 'Mov'
        && regsMovimiento[1] === resultadoSecreto
        && negacion?.instruccion.operacion === 'Not'
        && regsNegacion[1] === regsMovimiento[0]
        && almacenamiento?.instruccion.operacion === 'StoreNPToEnvironment'
        && regsAlmacenamiento.includes(regsNegacion[0])
      ))
    if (formaExacta) seguras.add(llamadaSecreta.indice)
  }
  return seguras
}

export function contieneClaveSecretaHermes(dump) {
  if (cadenasDeHermes(dump).some(cadena => PATRON_CLAVE_SECRETA.test(cadena))) return true

  const lineas = dump.split('\n')
  const llamadasSeguras = llamadasDeGuardiaSupabase(lineas)
  const registros = new Map()
  for (const [indice, linea] of lineas.entries()) {
    const encabezado = /^(?:Function|NCFunction|Constructor|NCConstructor)<([^>(]+)/u.exec(linea)
    if (encabezado) {
      registros.clear()
      continue
    }
    const instruccion = analizarInstruccion(linea)
    if (!instruccion) continue
    const { operacion, operandos, registros: regs } = instruccion
    const destino = regs[0]

    if (operacion === 'LoadConstString') {
      const literal = /^r\d+,\s+"((?:\\.|[^"\\])*)"/u.exec(operandos)?.[1]
      if (literal !== undefined) registros.set(destino, literal)
      else registros.delete(destino)
      continue
    }
    if (operacion === 'Mov' && regs.length >= 2) {
      if (registros.has(regs[1])) registros.set(destino, registros.get(regs[1]))
      else registros.delete(destino)
      continue
    }
    if ((operacion === 'Add' || operacion === 'AddS') && regs.length >= 3) {
      const izquierda = registros.get(regs[1])
      const derecha = registros.get(regs[2])
      if ((izquierda ?? '').includes('sb_secret_') || (derecha ?? '').includes('sb_secret_')) {
        if (izquierda === undefined || derecha === undefined) return true
        const combinado = izquierda + derecha
        if (PATRON_CLAVE_SECRETA.test(combinado)) return true
        registros.set(destino, combinado)
      } else if (izquierda !== undefined && derecha !== undefined) {
        registros.set(destino, izquierda + derecha)
      } else registros.delete(destino)
      continue
    }
    if (operacion === 'GetByIdShort') {
      registros.delete(destino)
      continue
    }
    if (/^Call/u.test(operacion)) {
      const contienePrefijo = regs.slice(2).some(registro => (registros.get(registro) ?? '').includes('sb_secret_'))
      if (contienePrefijo && !llamadasSeguras.has(indice)) return true
      registros.delete(destino)
      continue
    }

    if (regs.some(registro => (registros.get(registro) ?? '').includes('sb_secret_'))) return true
    if (destino) registros.delete(destino)
  }
  return false
}

function analizarCadenasHermes(archivo, raiz) {
  const plataformas = {
    linux: ['linux64-bin', 'hermesc'],
    darwin: ['osx-bin', 'hermesc'],
    win32: ['win64-bin', 'hermesc.exe'],
  }
  const plataforma = plataformas[process.platform]
  if (!plataforma) return [`${archivo}: no se puede inspeccionar el bytecode Hermes en esta plataforma`]

  const compilador = join(raiz, 'node_modules', 'hermes-compiler', 'hermesc', ...plataforma)
  const resultado = spawnSync(compilador, ['-b', '-dump-bytecode', archivo], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  })
  if (resultado.error || resultado.status !== 0) {
    return [`${archivo}: no se pudo inspeccionar el bytecode Hermes`]
  }
  return contieneClaveSecretaHermes(resultado.stdout)
    ? [`${archivo}: ${MOTIVO_CLAVE_SECRETA}`]
    : []
}

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
  // Un `.env.local` es legítimo en desarrollo (está en .gitignore), pero sus variables EXPO_PUBLIC_* se incrustan en
  // el bundle: se aplica el mismo escaneo de secretos que a las fuentes.
  for (const nombre of readdirSync(raiz)) {
    if (!/^\.env(?:\..+)?$/u.test(nombre) || nombre === '.env.example') continue
    const texto = readFileSync(join(raiz, nombre), 'utf8')
    for (const { patron, motivo } of TEXTO_PRIVADO) if (patron.test(texto)) problemas.push(`${nombre}: ${motivo}`)
    for (const jwt of texto.match(PATRON_JWT) ?? []) {
      const carga = decodificarCarga(jwt.split('.')[1] ?? '')
      if (!carga || carga.role !== 'anon') problemas.push(`${nombre}: JWT embebido con rol distinto de anon`)
    }
  }
  return problemas
}

export function verificarBundle(directorio) {
  const problemas = []
  if (!existsSync(directorio)) return [`${directorio}: no existe (¿se exportó el bundle?)`]
  let cantidad = 0
  for (const archivo of archivos(directorio)) {
    cantidad++
    const contenido = readFileSync(archivo)
    const esHermes = contenido.subarray(0, 4).toString('hex') === 'c61fbc03'
    const texto = contenido.toString('latin1')
    const id = archivo.split(sep).join('/')
    for (const { patron, motivo } of PATRONES_BUNDLE) if (patron.test(texto)) problemas.push(`${id}: ${motivo}`)
    if (esHermes) problemas.push(...analizarCadenasHermes(archivo, RAIZ_POR_DEFECTO))
    else if (PATRON_CLAVE_SECRETA.test(texto)) problemas.push(`${id}: ${MOTIVO_CLAVE_SECRETA}`)
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
  for (let i = 0; i < argumentos.length; i++) {
    if (argumentos[i] !== '--bundle') {
      console.error(`Argumento no reconocido: ${argumentos[i]}`)
      process.exit(2)
    }
    if (!argumentos[i + 1]) {
      console.error('--bundle requiere un directorio')
      process.exit(2)
    }
    bundles.push(argumentos[++i])
  }
  const problemas = bundles.length ? bundles.flatMap(b => verificarBundle(resolve(b))) : verificarProyecto()
  if (problemas.length) {
    console.error(problemas.join('\n'))
    process.exit(1)
  }
  console.log(bundles.length ? `Bundles sin hallazgos (${bundles.length}).` : 'Fuentes y paquete sin hallazgos.')
}
