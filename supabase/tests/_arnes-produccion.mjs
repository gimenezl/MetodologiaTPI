/**
 * Piezas reutilizables del arnés de producción.
 *
 * Viven aparte para que las pruebas negativas puedan ejercitarlas sin compilar
 * la aplicación entera. Un arnés que nadie prueba es una afirmación más, y este
 * ya falló por medir el artefacto equivocado —un servidor de una corrida
 * anterior escuchando en el puerto, el build de desarrollo que deja Playwright
 * bajo `.next/dev`— y por poder quedar colgado para siempre en `next build`.
 */

import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path, { join } from 'node:path'
import { setTimeout as esperar } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

/** Raíz del worktree, independiente del directorio desde el que se invoque. */
export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * CLI de Next, ejecutado directamente con Node.
 *
 * Sin `npx` ni intérprete de comandos: así el proceso raíz del árbol es Node, y
 * detenerlo no depende de que el intérprete propague la señal a sus hijos.
 */
export const CLI_NEXT = join(RAIZ, 'node_modules', 'next', 'dist', 'bin', 'next')

/** Cuánto se espera cada respuesta HTTP. */
export const LIMITE_PETICION_MS = 10_000

/** Cuánto se espera, como máximo, a que el servidor empiece a atender. */
export const LIMITE_ARRANQUE_MS = 120_000

/** Cuánto puede durar, como máximo, `next build`. Configurable con `EPT_LIMITE_BUILD_MS`. */
export const LIMITE_BUILD_POR_DEFECTO_MS = 15 * 60_000

/** Cuánto se espera a que un árbol de procesos termine después de matarlo. */
export const GRACIA_DE_CIERRE_MS = 10_000

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

/**
 * Espera `ms` o hasta que se cancele.
 *
 * El temporizador mantiene vivo el proceso mientras corre —así una espera nunca
 * termina con Node saliendo a mitad de camino— y se cancela en cuanto la
 * carrera la gana otra promesa, para no retrasar la salida del arnés.
 */
export async function carreraConPlazo(promesa, ms) {
  const controlador = new AbortController()
  try {
    return await Promise.race([
      promesa,
      esperar(ms, undefined, { signal: controlador.signal }).then(
        () => undefined,
        () => undefined
      ),
    ])
  } finally {
    controlador.abort()
  }
}

/** Huella de un cuerpo, para compararlo byte a byte sin volcarlo. */
export function digerir(texto) {
  return createHash('sha256').update(texto, 'utf8').digest('hex')
}

/**
 * Lee un límite en milisegundos desde una variable de entorno.
 *
 * Un valor presente pero inválido es un error, no una excusa para usar el valor
 * por defecto en silencio: quien lo configuró cree que rige.
 */
export function leerLimite(nombre, porDefecto, entorno = process.env) {
  const crudo = entorno[nombre]
  if (crudo === undefined || crudo === '') return porDefecto
  if (!/^\d+$/u.test(crudo)) {
    throw new Error(`${nombre} debe ser un entero positivo de milisegundos (recibido: «${crudo}»)`)
  }
  const valor = Number(crudo)
  if (!Number.isSafeInteger(valor) || valor <= 0) {
    throw new Error(`${nombre} debe ser un entero positivo de milisegundos (recibido: «${crudo}»)`)
  }
  return valor
}

/**
 * Pide una URL con un límite de espera explícito.
 *
 * Sin esto, un servidor que acepta la conexión y nunca contesta dejaba el arnés
 * colgado para siempre: ni pasaba, ni fallaba, ni liberaba el puerto.
 */
export async function pedir(url, opciones = {}) {
  const { limiteMs = LIMITE_PETICION_MS, ...resto } = opciones
  return fetch(url, {
    redirect: 'manual',
    ...resto,
    signal: AbortSignal.timeout(limiteMs),
  })
}

/**
 * Espera a que el servidor empiece a atender, con un techo global.
 *
 * Devuelve `true` si contestó a tiempo. Cada intento tiene su propio límite y
 * el conjunto también. Si se le pasa el proceso, deja de esperar en cuanto el
 * proceso termina: esperar a un servidor muerto es perder el tiempo del límite.
 */
export async function esperarAlServidor(url, { limiteMs = LIMITE_ARRANQUE_MS, proceso } = {}) {
  const vence = Date.now() + limiteMs
  while (Date.now() < vence) {
    if (proceso && (proceso.exitCode !== null || proceso.signalCode !== null)) return false
    try {
      const restante = Math.max(1, Math.min(3000, vence - Date.now()))
      const respuesta = await pedir(url, { limiteMs: restante })
      if (respuesta.status > 0) return true
    } catch {
      // Todavía no atiende, o no contestó a tiempo.
    }
    // Este temporizador SÍ mantiene vivo el proceso: es la espera principal.
    // Sin referencia, si el proceso observado ya murió no queda nada pendiente
    // y Node terminaría a mitad de la espera.
    await esperar(Math.max(0, Math.min(1000, vence - Date.now())))
  }
  return false
}

/**
 * Variables que recibe el proceso hijo.
 *
 * Es una lista blanca a propósito. Heredar el entorno completo le pasaría al
 * servidor cualquier secreto que hubiera en la sesión —empezando por
 * `SUPABASE_SERVICE_ROLE_KEY`— sin que lo necesite para nada: este arnés sólo
 * compila, pide páginas y mira códigos de estado.
 *
 * `extra` no puede reintroducir la clave de servicio: se descarta aunque se pida.
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
  delete base.SUPABASE_SERVICE_ROLE_KEY
  return Object.fromEntries(Object.entries(base).filter(([, valor]) => valor !== undefined))
}

/** ¿Sigue vivo un proceso? No envía ninguna señal: solo pregunta. */
export function procesoVivo(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

/**
 * Recupera los descendientes que Windows todavía atribuye al PID raíz.
 *
 * `taskkill /T` no siempre puede reconstruir el árbol si el padre ya terminó.
 * Win32_Process conserva `ParentProcessId`, así que se toma una foto acotada y
 * solo se devuelven procesos cuya cadena llega al hijo lanzado por este arnés.
 */
function descendientesWindows(pid, graciaMs) {
  try {
    const script = [
      '$ErrorActionPreference = "Stop"',
      '$p = Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId',
      '$p | ConvertTo-Json -Compress',
    ].join('; ')
    const salida = execFileSync(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
      { encoding: 'utf8', timeout: graciaMs, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim()
    if (!salida) return []
    const procesos = JSON.parse(salida)
    const lista = Array.isArray(procesos) ? procesos : [procesos]
    const porPadre = new Map()
    for (const item of lista) {
      const procesoId = Number(item.ProcessId)
      const padreId = Number(item.ParentProcessId)
      if (!Number.isInteger(procesoId) || !Number.isInteger(padreId)) continue
      const hijos = porPadre.get(padreId) ?? []
      hijos.push(procesoId)
      porPadre.set(padreId, hijos)
    }
    const pendientes = [...(porPadre.get(pid) ?? [])]
    const encontrados = []
    while (pendientes.length > 0) {
      const actual = pendientes.pop()
      if (encontrados.includes(actual)) continue
      encontrados.push(actual)
      pendientes.push(...(porPadre.get(actual) ?? []))
    }
    return encontrados
  } catch {
    // La eliminación principal todavía se intenta; el llamador verificará el
    // resultado. No se amplía el alcance a búsquedas por nombre ni por puerto.
    return []
  }
}

/**
 * Detiene un proceso lanzado por este arnés y todo lo que colgó de él.
 *
 * Solo actúa sobre el PID de un hijo propio que todavía no terminó: nunca busca
 * procesos por nombre ni por puerto, de modo que no puede matar nada ajeno al
 * worktree. En Windows `taskkill /T` baja el árbol completo; en POSIX el hijo se
 * lanza como líder de su propio grupo y se mata el grupo.
 *
 * Termina en tiempo acotado aunque un descendiente retenga las tuberías: si
 * después de la gracia el proceso no informó su fin, se cortan sus flujos.
 */
export async function detener(proceso, { graciaMs = GRACIA_DE_CIERRE_MS } = {}) {
  if (!proceso || typeof proceso.pid !== 'number') return
  const raizViva = proceso.exitCode === null && proceso.signalCode === null
  const terminado = raizViva
    ? new Promise((resolver) => proceso.once('exit', resolver))
    : Promise.resolve()
  if (process.platform === 'win32') {
    const descendientes = descendientesWindows(proceso.pid, graciaMs)
    // Nunca se señala un PID raíz que ya terminó: podría haber sido reutilizado
    // por un proceso ajeno. Si sigue vivo, `/T` es la vía primaria.
    if (raizViva) {
      try {
        execFileSync('taskkill', ['/pid', String(proceso.pid), '/T', '/F'], {
          stdio: 'ignore',
          timeout: graciaMs,
          windowsHide: true,
        })
      } catch {
        // Puede haber terminado entre la comprobación y `taskkill`.
      }
    }
    // Si la raíz ya murió, `/T` puede no encontrarla. Se eliminan solamente los
    // PID que la foto de Win32_Process vinculó con ese hijo propio.
    for (const pid of descendientes.reverse()) {
      try {
        execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
          stdio: 'ignore',
          timeout: graciaMs,
          windowsHide: true,
        })
      } catch {
        // Ya terminó o fue eliminado junto con un ancestro.
      }
    }
  } else {
    try {
      process.kill(-proceso.pid, 'SIGKILL')
    } catch {
      try {
        proceso.kill('SIGKILL')
      } catch {
        // Ya no estaba.
      }
    }
  }

  await carreraConPlazo(terminado, graciaMs)
  proceso.stdout?.destroy()
  proceso.stderr?.destroy()
}

/**
 * Lanza un proceso con un límite de duración y conserva su salida.
 *
 * - `limiteMs` es obligatorio: no existe un proceso sin límite.
 * - Al vencer, se detiene el árbol completo con `detener`.
 * - stdout y stderr se conservan (los últimos `maximoRegistro` caracteres), así
 *   una compilación que falla o se cuelga deja ver por qué.
 * - Se resuelve siempre, en tiempo acotado: `limiteMs` más la gracia de cierre.
 *
 * Devuelve `{ codigo, vencido, error, registro, duracionMs, pid }`.
 */
export function ejecutarConLimite(
  comando,
  argumentos,
  { limiteMs, cwd = RAIZ, env = entornoAcotado(), maximoRegistro = 64_000, graciaMs = GRACIA_DE_CIERRE_MS } = {}
) {
  if (!Number.isSafeInteger(limiteMs) || limiteMs <= 0) {
    throw new Error('ejecutarConLimite exige un límite positivo en milisegundos')
  }

  return new Promise((resolver) => {
    const inicio = Date.now()
    let registro = ''
    let vencido = false
    let resuelto = false
    let proceso

    const terminar = (resultado) => {
      if (resuelto) return
      resuelto = true
      clearTimeout(temporizador)
      resolver({ registro, vencido, duracionMs: Date.now() - inicio, pid: proceso?.pid ?? null, ...resultado })
    }

    try {
      proceso = spawn(comando, argumentos, {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
        windowsHide: true,
      })
    } catch (error) {
      resolver({ codigo: null, vencido: false, error, registro, duracionMs: 0, pid: null })
      return
    }

    const acumular = (fragmento) => {
      registro = (registro + fragmento).slice(-maximoRegistro)
    }
    proceso.stdout.on('data', acumular)
    proceso.stderr.on('data', acumular)

    const temporizador = setTimeout(async () => {
      vencido = true
      await detener(proceso, { graciaMs })
      terminar({ codigo: proceso.exitCode, error: null })
    }, limiteMs)

    proceso.once('error', (error) => terminar({ codigo: null, error }))
    proceso.once('exit', async (codigo) => {
      if (vencido) return
      // Terminó por su cuenta: el límite ya no corre, aunque la lectura final
      // de las tuberías tarde un poco.
      clearTimeout(temporizador)
      // Un descendiente puede seguir con las tuberías abiertas: se da una gracia
      // corta para leer lo último y después se cortan.
      await carreraConPlazo(
        new Promise((r) => proceso.once('close', r)),
        Math.min(graciaMs, 2000)
      )
      // El código del padre puede ser 0 aunque haya dejado trabajadores vivos.
      // Se conserva el grupo y se baja antes de resolver como éxito.
      await detener(proceso, { graciaMs })
      proceso.stdout.destroy()
      proceso.stderr.destroy()
      terminar({ codigo, error: null })
    })
  })
}

/**
 * Ejecuta `trabajo` con un directorio temporal que se borra siempre.
 *
 * Se borra ante éxito, excepción o tiempo agotado: el `finally` no depende de
 * que el trabajo termine bien.
 */
export async function conDirectorioTemporal(prefijo, trabajo) {
  const directorio = mkdtempSync(join(tmpdir(), prefijo))
  try {
    return await trabajo(directorio)
  } finally {
    rmSync(directorio, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}

/** Lista recursiva de archivos. Un directorio ilegible es un error, no un vacío. */
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
 * Falla cerrado: un artefacto que no se puede leer es un problema, no un
 * archivo que se saltea. La versión anterior lo ignoraba en silencio, y un
 * artefacto ilegible es justamente uno que no se revisó.
 *
 * Devuelve una lista de problemas; vacía significa que está limpio.
 */
export function revisarArtefactos(raiz = join(RAIZ, '.next'), { leer = readFileSync } = {}) {
  const problemas = []

  const manifiestos = [
    join(raiz, 'server', 'app-paths-manifest.json'),
    join(raiz, 'app-path-routes-manifest.json'),
    join(raiz, 'routes-manifest.json'),
  ]

  let revisados = 0
  for (const manifiesto of manifiestos) {
    if (!existsSync(manifiesto)) continue
    let contenido
    try {
      contenido = leer(manifiesto, 'utf8')
    } catch {
      problemas.push(`no se pudo leer el manifiesto ${manifiesto}`)
      continue
    }
    revisados += 1
    if (contenido.includes('pruebas-ui')) {
      problemas.push(`${manifiesto} registra una ruta de banco`)
    }
  }
  if (revisados === 0) {
    problemas.push('no se encontró ningún manifiesto de rutas legible: el build no se puede auditar')
  }

  let archivos
  try {
    archivos = archivosDe(raiz)
  } catch (error) {
    problemas.push(`no se pudo recorrer ${raiz}: ${error instanceof Error ? error.message : String(error)}`)
    return { problemas, manifiestosRevisados: revisados, artefactosLeidos: 0 }
  }

  // Se excluyen `dev` y `cache`, que no son salida de producción: el build de
  // desarrollo sí contiene los bancos, y confundirlos sería medir otra cosa.
  const deProduccion = archivos.filter((archivo) => !/[\\/](dev|cache)[\\/]/u.test(archivo))

  const modulos = deProduccion.filter(
    (archivo) => archivo.includes('page.banco') || archivo.includes('pruebas-ui')
  )
  for (const modulo of modulos.slice(0, 5)) {
    problemas.push(`el artefacto ${modulo} corresponde a un banco`)
  }

  let leidos = 0
  const servidor = join(raiz, 'server')
  for (const archivo of deProduccion) {
    if (!archivo.startsWith(servidor)) continue
    if (!/\.(js|json|html|rsc)$/u.test(archivo)) continue
    let contenido
    try {
      contenido = leer(archivo, 'utf8')
    } catch {
      problemas.push(`no se pudo leer el artefacto ${archivo}`)
      continue
    }
    leidos += 1
    if (IDENTIDADES_DEL_BANCO.some((rastro) => contenido.includes(rastro))) {
      problemas.push(`el artefacto ${archivo} contiene datos del banco`)
    }
  }

  return { problemas, manifiestosRevisados: revisados, artefactosLeidos: leidos }
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

/**
 * Exige que nadie esté escuchando ya en la URL.
 *
 * Si un servidor de una corrida anterior sigue vivo, el nuevo no consigue el
 * puerto y el arnés termina midiendo ese binario viejo sin enterarse. No se
 * mata a quien lo ocupa: podría no ser de este worktree.
 */
export async function exigirPuertoLibre(url) {
  if (await puertoOcupado(url)) {
    throw new Error(
      `${url} ya está ocupado. Cerrá ese proceso antes de correr esta prueba: ` +
        'de lo contrario mediría un servidor que no corresponde a este código.'
    )
  }
}
