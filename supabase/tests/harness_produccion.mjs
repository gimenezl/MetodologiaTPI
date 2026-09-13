/**
 * Los bancos de pruebas de interfaz no existen en producción. Se comprueba.
 *
 * La revisión objetó, con razón, que la evidencia anterior miraba el código
 * fuente: leía la condición `NODE_ENV === 'production' || EPT_UI_HARNESS !== '1'`
 * y daba por demostrado el resultado. Eso no prueba nada sobre el binario que
 * se despliega; prueba que alguien escribió una condición.
 *
 * Acá se compila la aplicación en modo producción, se levanta con
 * `EPT_UI_HARNESS=1` —es decir, en el peor escenario: la variable encendida por
 * error en el servidor real— y se pide cada ruta por HTTP. Las tres tienen que
 * responder 404.
 *
 * Para que un 404 signifique algo, primero se comprueba que el servidor sirve
 * una ruta legítima. Un servidor caído devolvería 404 en todo y la prueba
 * pasaría sin haber probado nada.
 *
 *     node supabase/tests/harness_produccion.mjs
 *
 * Sale con código distinto de cero ante la primera afirmación incumplida.
 */

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as esperar } from 'node:timers/promises'

const PUERTO = 3123
const BASE = `http://127.0.0.1:${PUERTO}`

const RUTAS_DE_BANCO = ['/pruebas-ui/alumnos', '/pruebas-ui/cursos', '/pruebas-ui/niveles']
const RUTA_LEGITIMA = '/login'

/**
 * Ruta de control: no existe ni existio nunca. Su 404 es la referencia contra
 * la que se compara el de los bancos.
 *
 * Sin esta comparacion, un 404 no dice lo suficiente. Next incluye los
 * segmentos de la URL en la carga RSC de toda ruta que el enrutador conoce, de
 * modo que una ruta presente pero negada responde distinto de una ausente, y
 * cualquiera puede deducir que el banco esta ahi. Que las dos respuestas
 * coincidan es lo que demuestra que el banco no llego al binario.
 */
const RUTA_INEXISTENTE = '/pruebas-ui/no-existe-esta-ruta'

/**
 * Identidades sinteticas que solo existen en los bancos.
 *
 * Son datos de fixture: si aparecen en un artefacto compilado o en una
 * respuesta, el banco llego a produccion.
 */
const IDENTIDADES_DEL_BANCO = [
  'Arrieta',
  'Zalazar',
  'LEG-2027-018',
  'LEG-2026-233',
  '48213907',
  '49660312',
]

/**
 * Rastros que no deben aparecer en la respuesta de un 404.
 *
 * Suma el titulo del formulario real. Ese texto si esta —legitimamente— en el
 * binario de produccion, porque la pantalla de alumnos lo usa; lo que no puede
 * pasar es que lo devuelva una ruta que responde 404.
 */
const RASTROS_EN_RESPUESTA = [...IDENTIDADES_DEL_BANCO, 'Nuevo legajo académico']

/** Huella de un cuerpo, para compararlo byte a byte sin volcarlo. */
function digerir(texto) {
  return createHash('sha256').update(texto, 'utf8').digest('hex')
}

/**
 * Credenciales de relleno. La compilación necesita que las variables existan,
 * pero este proceso no habla con ninguna base: sólo pide páginas y mira el
 * código de estado. Nunca se apunta a un proyecto real.
 */
const ENTORNO = {
  ...process.env,
  NODE_ENV: 'production',
  EPT_UI_HARNESS: '1',
  NEXT_PUBLIC_SUPABASE_URL: 'https://placeholder-pruebas.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'placeholder-anon-key-solo-para-pruebas',
  NEXT_TELEMETRY_DISABLED: '1',
}

let fallos = 0

function afirmar(condicion, descripcion) {
  if (condicion) {
    console.log(`OK  ${descripcion}`)
    return
  }
  fallos += 1
  console.error(`FALLO  ${descripcion}`)
}

function ejecutar(comando, argumentos) {
  return new Promise((resolver, rechazar) => {
    const proceso = spawn(comando, argumentos, {
      env: ENTORNO,
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let salida = ''
    proceso.stdout.on('data', (fragmento) => {
      salida += fragmento
    })
    proceso.stderr.on('data', (fragmento) => {
      salida += fragmento
    })
    proceso.on('error', rechazar)
    proceso.on('close', (codigo) => resolver({ codigo, salida }))
  })
}

async function esperarAlServidor(intentos = 90) {
  for (let intento = 0; intento < intentos; intento += 1) {
    try {
      const respuesta = await fetch(`${BASE}${RUTA_LEGITIMA}`, { redirect: 'manual' })
      if (respuesta.status > 0) return true
    } catch {
      // Todavía no escucha.
    }
    await esperar(1000)
  }
  return false
}

/**
 * Nadie puede estar escuchando ya en el puerto.
 *
 * Si un servidor de una corrida anterior sigue vivo, `next start` no consigue
 * el puerto y la prueba termina midiendo ese binario viejo sin enterarse. Las
 * afirmaciones pasarían o fallarían por un código que ya no es el del árbol.
 */
async function puertoOcupado() {
  try {
    await fetch(`${BASE}${RUTA_LEGITIMA}`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(2000),
    })
    return true
  } catch {
    return false
  }
}

if (await puertoOcupado()) {
  console.error(
    `FALLO  el puerto ${PUERTO} ya está ocupado. Cerrá ese proceso antes de correr ` +
      'esta prueba: de lo contrario mediría un servidor que no corresponde a este código.'
  )
  process.exit(1)
}

console.log('Compilando en modo producción. Puede tardar varios minutos.')
const compilacion = await ejecutar('npx', ['next', 'build'])
if (compilacion.codigo !== 0) {
  console.error(compilacion.salida.slice(-4000))
  console.error('FALLO  la compilación de producción no terminó bien')
  process.exit(1)
}
console.log('OK  la aplicación compila en modo producción')

/**
 * Detiene el servidor y todo lo que colgo de el.
 *
 * En Windows el proceso se lanza a traves del interprete, asi que `kill()`
 * termina el interprete y deja vivo al servidor: el puerto queda ocupado, las
 * tuberias abiertas y este proceso no llega nunca a salir. `taskkill /T` baja
 * el arbol completo.
 */
async function detener(proceso) {
  if (proceso.exitCode !== null) return
  const terminado = new Promise((resolver) => proceso.once('exit', resolver))
  if (process.platform === 'win32') {
    await ejecutar('taskkill', ['/pid', String(proceso.pid), '/T', '/F'])
  } else {
    proceso.kill('SIGTERM')
  }
  await Promise.race([terminado, esperar(5000)])
}

/**
 * Comprueba que el banco no esta en lo que se compilo.
 *
 * Una respuesta 404 dice lo que el servidor contesta hoy; el manifiesto y los
 * artefactos dicen lo que se desplego. Son dos preguntas distintas y las dos
 * importan: un banco presente en el build es una ruta a un paso de quedar
 * accesible por un cambio de configuracion.
 */
function revisarArtefactos() {
  const manifiestos = [
    '.next/server/app-paths-manifest.json',
    '.next/app-path-routes-manifest.json',
    '.next/routes-manifest.json',
  ]

  let revisados = 0
  for (const relativo of manifiestos) {
    if (!existsSync(relativo)) continue
    revisados += 1
    const contenido = readFileSync(relativo, 'utf8')
    afirmar(
      !contenido.includes('pruebas-ui'),
      `${relativo} no registra ninguna ruta de banco`
    )
  }
  afirmar(revisados > 0, `se encontro al menos un manifiesto de rutas (${revisados})`)

  // Ningun archivo compilado se llama como los bancos.
  const modulos = archivosDe('.next').filter(
    (archivo) => archivo.includes('page.banco') || archivo.includes('pruebas-ui')
  )
  afirmar(
    modulos.length === 0,
    `ningun artefacto compilado corresponde a un banco${
      modulos.length ? ` (${modulos.slice(0, 5).join(', ')})` : ''
    }`
  )

  // Ni contiene sus datos. Se recorre el servidor compilado, que es lo que se
  // ejecuta, buscando las identidades sinteticas del banco.
  const conRastros = []
  for (const archivo of archivosDe('.next/server')) {
    if (!/\.(js|json|html|rsc)$/.test(archivo)) continue
    let contenido
    try {
      contenido = readFileSync(archivo, 'utf8')
    } catch {
      continue
    }
    if (IDENTIDADES_DEL_BANCO.some((rastro) => contenido.includes(rastro))) {
      conRastros.push(archivo)
    }
  }
  afirmar(
    conRastros.length === 0,
    `ningun artefacto del servidor contiene datos del banco${
      conRastros.length ? ` (${conRastros.slice(0, 5).join(', ')})` : ''
    }`
  )
}

/** Lista recursiva de archivos, tolerante a directorios ausentes. */
function archivosDe(raiz) {
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

revisarArtefactos()

const servidor = spawn('npx', ['next', 'start', '--port', String(PUERTO)], {
  env: ENTORNO,
  shell: process.platform === 'win32',
  stdio: ['ignore', 'pipe', 'pipe'],
})
let registroServidor = ''
servidor.stdout.on('data', (fragmento) => {
  registroServidor += fragmento
})
servidor.stderr.on('data', (fragmento) => {
  registroServidor += fragmento
})

try {
  const arranco = await esperarAlServidor()
  if (!arranco) {
    console.error(registroServidor.slice(-4000))
    console.error('FALLO  el servidor de producción no llegó a atender peticiones')
    process.exit(1)
  }

  // Control positivo: sin esto, un 404 no distingue «ruta ausente» de
  // «servidor roto».
  const legitima = await fetch(`${BASE}${RUTA_LEGITIMA}`, { redirect: 'manual' })
  afirmar(
    legitima.status === 200,
    `una ruta legítima responde 200 (${RUTA_LEGITIMA} devolvió ${legitima.status})`
  )

  // Referencia: el 404 de una ruta que nunca existio.
  const control = await fetch(`${BASE}${RUTA_INEXISTENTE}`, { redirect: 'manual' })
  const cuerpoControl = await control.text()
  const huellaControl = digerir(cuerpoControl)
  afirmar(
    control.status === 404,
    `la ruta de control responde 404 (${RUTA_INEXISTENTE} devolvió ${control.status})`
  )

  // La referencia solo sirve si es estable: dos rutas inexistentes distintas
  // tienen que producir exactamente el mismo cuerpo. Si no lo fueran, la
  // comparacion de abajo no probaria nada.
  const segundaControl = await fetch(`${BASE}/otra/ruta/que-no-existe`, {
    redirect: 'manual',
  })
  afirmar(
    digerir(await segundaControl.text()) === huellaControl,
    'dos rutas inexistentes producen el mismo cuerpo: la referencia es estable'
  )

  for (const ruta of RUTAS_DE_BANCO) {
    const respuesta = await fetch(`${BASE}${ruta}`, { redirect: 'manual' })
    afirmar(
      respuesta.status === 404,
      `${ruta} responde 404 en producción aun con EPT_UI_HARNESS=1 (devolvió ${respuesta.status})`
    )

    const cuerpo = await respuesta.text()

    const filtrados = RASTROS_EN_RESPUESTA.filter((rastro) => cuerpo.includes(rastro))
    afirmar(
      filtrados.length === 0,
      `${ruta} no sirve contenido del banco${filtrados.length ? ` (apareció: ${filtrados.join(', ')})` : ''}`
    )

    // Tampoco filtra los segmentos de su propia URL. Next los incluye en la
    // carga RSC de toda ruta que el enrutador conoce, asi que verlos ahi seria
    // la señal de que el banco sigue registrado.
    const segmentos = ruta.split('/').filter(Boolean)
    const filtradosSegmentos = segmentos.filter((segmento) => cuerpo.includes(segmento))
    afirmar(
      filtradosSegmentos.length === 0,
      `${ruta} no filtra sus segmentos en el cuerpo${
        filtradosSegmentos.length ? ` (apareció: ${filtradosSegmentos.join(', ')})` : ''
      }`
    )

    // La prueba fuerte: la respuesta es identica, byte a byte, a la de una
    // ruta que nunca existio. Comparar longitudes no alcanzaba: dos cuerpos
    // distintos del mismo tamaño pasaban.
    const huella = digerir(cuerpo)
    afirmar(
      huella === huellaControl,
      `${ruta} responde exactamente igual que una ruta inexistente ` +
        `(SHA-256 ${huella.slice(0, 16)}… contra ${huellaControl.slice(0, 16)}… de control)`
    )
  }
} finally {
  await detener(servidor)
}

if (fallos > 0) {
  console.error(`\n${fallos} afirmación(es) incumplida(s).`)
  process.exit(1)
}
console.log('\nTodas las afirmaciones se cumplieron.')
