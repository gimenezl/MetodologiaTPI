/**
 * Piezas reutilizables del arnés de producción.
 *
 * Viven aparte para que las pruebas negativas puedan ejercitarlas sin compilar
 * la aplicación entera. Un arnés que nadie prueba es una afirmación más, y este
 * ya falló dos veces por medir el artefacto equivocado: un servidor de una
 * corrida anterior escuchando en el puerto, y el build de desarrollo que deja
 * Playwright bajo `.next/dev`.
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as esperar } from 'node:timers/promises'

/** Cuánto se espera cada respuesta HTTP. */
export const LIMITE_PETICION_MS = 10_000

/** Cuánto se espera, como máximo, a que el servidor empiece a atender. */
export const LIMITE_ARRANQUE_MS = 120_000

/** Identidades sintéticas que sólo existen en los bancos. */
export const IDENTIDADES_DEL_BANCO = [
  'Arrieta',
  'Zalazar',
  'LEG-2027-018',
  'LEG-2026-233',
  '48213907',
  '49660312',
]

/** Rastros que no deben aparecer en la respuesta de un 404. */
export const RASTROS_EN_RESPUESTA = [...IDENTIDADES_DEL_BANCO, 'Nuevo legajo académico']

/** Huella de un cuerpo, para compararlo byte a byte sin volcarlo. */
export function digerir(texto) {
  return createHash('sha256').update(texto, 'utf8').digest('hex')
}

/**
 * Pide una URL con un límite de espera explícito.
 *
 * Sin esto, un servidor que acepta la conexión y nunca contesta dejaba el arnés
 * colgado para siempre: ni pasaba, ni fallaba, ni liberaba el puerto. Un
 * proceso que no termina es peor que uno que falla, porque no avisa.
 */
export async function pedir(url, opciones = {}) {
  const limite = opciones.limiteMs ?? LIMITE_PETICION_MS
  const respuesta = await fetch(url, {
    redirect: 'manual',
    ...opciones,
    signal: AbortSignal.timeout(limite),
  })
  return respuesta
}

/**
 * Espera a que el servidor empiece a atender, con un techo global.
 *
 * Devuelve `true` si contestó a tiempo. Nunca se queda esperando de más: cada
 * intento tiene su propio límite y el conjunto también.
 */
export async function esperarAlServidor(url, { limiteMs = LIMITE_ARRANQUE_MS } = {}) {
  const vence = Date.now() + limiteMs
  while (Date.now() < vence) {
    try {
      const respuesta = await pedir(url, { limiteMs: 3000 })
      if (respuesta.status > 0) return true
    } catch {
      // Todavía no atiende, o no contestó a tiempo.
    }
    await esperar(1000)
  }
  return false
}

/**
 * Variables que recibe el proceso hijo.
 *
 * Es una lista blanca a propósito. Heredar el entorno completo le pasaría al
 * servidor cualquier secreto que hubiera en la sesión —empezando por
 * `SUPABASE_SERVICE_ROLE_KEY`— sin que lo necesite para nada: este arnés sólo
 * pide páginas y mira códigos de estado.
 */
export function entornoAcotado(extra = {}) {
  const base = {
    PATH: process.env.PATH,
    SYSTEMROOT: process.env.SYSTEMROOT,
    WINDIR: process.env.WINDIR,
    COMSPEC: process.env.COMSPEC,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    NODE_ENV: 'production',
    NEXT_TELEMETRY_DISABLED: '1',
    // El peor escenario: la variable del banco encendida por error.
    EPT_UI_HARNESS: '1',
    // Credenciales de relleno. Este proceso no habla con ninguna base.
    NEXT_PUBLIC_SUPABASE_URL: 'https://placeholder-pruebas.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'placeholder-anon-key-solo-para-pruebas',
    ...extra,
  }
  return Object.fromEntries(Object.entries(base).filter(([, valor]) => valor !== undefined))
}

/**
 * Detiene un proceso y todo lo que colgó de él.
 *
 * En Windows el proceso se lanza a través del intérprete, así que `kill()`
 * termina el intérprete y deja vivo al servidor: el puerto queda ocupado, las
 * tuberías abiertas y el arnés no llega nunca a salir. `taskkill /T` baja el
 * árbol completo.
 */
export async function detener(proceso) {
  if (!proceso || proceso.exitCode !== null) return
  const terminado = new Promise((resolver) => proceso.once('exit', resolver))
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/pid', String(proceso.pid), '/T', '/F'], { stdio: 'ignore' })
    } catch {
      // Ya no estaba.
    }
  } else {
    proceso.kill('SIGTERM')
  }
  await Promise.race([terminado, esperar(5000)])
}

/** Lista recursiva de archivos, tolerante a directorios ausentes. */
export function archivosDe(raiz) {
  if (!existsSync(raiz)) return []
  const pendientes = [raiz]
  const encontrados = []
  while (pendientes.length > 0) {
    const actual = pendientes.pop()
    for (const entrada of readdirSync(actual, { withFileTypes: true })) {
      const completo = join(actual, entrada.name)
      if (entrada.isDirectory()) pendientes.push(completo)
      else encontrados.push(completo)
    }
  }
  return encontrados
}

/**
 * Revisa lo que se compiló, no lo que el servidor contesta hoy.
 *
 * Son dos preguntas distintas y las dos importan: un banco presente en el build
 * es una ruta a un paso de quedar accesible por un cambio de configuración.
 *
 * Devuelve una lista de problemas; vacía significa que está limpio.
 */
export function revisarArtefactos(raiz = '.next') {
  const problemas = []

  const manifiestos = [
    join(raiz, 'server', 'app-paths-manifest.json'),
    join(raiz, 'app-path-routes-manifest.json'),
    join(raiz, 'routes-manifest.json'),
  ]

  let revisados = 0
  for (const relativo of manifiestos) {
    if (!existsSync(relativo)) continue
    revisados += 1
    if (readFileSync(relativo, 'utf8').includes('pruebas-ui')) {
      problemas.push(`${relativo} registra una ruta de banco`)
    }
  }
  if (revisados === 0) {
    problemas.push('no se encontró ningún manifiesto de rutas: el build no se puede auditar')
  }

  // Se excluyen `dev` y `cache`, que no son salida de producción: el build de
  // desarrollo sí contiene los bancos, y confundirlos sería medir otra cosa.
  const modulos = archivosDe(raiz)
    .filter((archivo) => !/[\\/](dev|cache)[\\/]/.test(archivo))
    .filter((archivo) => archivo.includes('page.banco') || archivo.includes('pruebas-ui'))
  for (const modulo of modulos.slice(0, 5)) {
    problemas.push(`el artefacto ${modulo} corresponde a un banco`)
  }

  for (const archivo of archivosDe(join(raiz, 'server'))) {
    if (!/\.(js|json|html|rsc)$/.test(archivo)) continue
    let contenido
    try {
      contenido = readFileSync(archivo, 'utf8')
    } catch {
      continue
    }
    if (IDENTIDADES_DEL_BANCO.some((rastro) => contenido.includes(rastro))) {
      problemas.push(`el artefacto ${archivo} contiene datos del banco`)
    }
  }

  return { problemas, manifiestosRevisados: revisados }
}

/**
 * Compara la respuesta de un banco con la de una ruta que nunca existió.
 *
 * Comparar longitudes no alcanzaba: dos cuerpos distintos del mismo tamaño
 * pasaban. Se compara por SHA-256.
 */
export function compararConControl(cuerpo, cuerpoControl) {
  const huella = digerir(cuerpo)
  const huellaControl = digerir(cuerpoControl)
  return {
    iguales: huella === huellaControl,
    huella,
    huellaControl,
    mismaLongitud: cuerpo.length === cuerpoControl.length,
  }
}

/** Rastros del banco o segmentos de la propia URL presentes en un cuerpo. */
export function filtracionesEn(cuerpo, ruta) {
  const rastros = RASTROS_EN_RESPUESTA.filter((rastro) => cuerpo.includes(rastro))
  const segmentos = ruta
    .split('/')
    .filter(Boolean)
    .filter((segmento) => cuerpo.includes(segmento))
  return { rastros, segmentos }
}

/** ¿Hay alguien escuchando en esa URL? */
export async function puertoOcupado(url) {
  try {
    await pedir(url, { limiteMs: 2000 })
    return true
  } catch {
    return false
  }
}
