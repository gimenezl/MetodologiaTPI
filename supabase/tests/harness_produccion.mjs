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
  afirmar(
    control.status === 404,
    `la ruta de control responde 404 (${RUTA_INEXISTENTE} devolvió ${control.status})`
  )

  // Rastros del contenido del banco que jamas deben aparecer en produccion.
  const RASTROS = [
    'Nuevo legajo académico',
    'Arrieta',
    'LEG-2027-018',
    '48213907',
  ]

  for (const ruta of RUTAS_DE_BANCO) {
    const respuesta = await fetch(`${BASE}${ruta}`, { redirect: 'manual' })
    afirmar(
      respuesta.status === 404,
      `${ruta} responde 404 en producción aun con EPT_UI_HARNESS=1 (devolvió ${respuesta.status})`
    )

    const cuerpo = await respuesta.text()

    const filtrados = RASTROS.filter((rastro) => cuerpo.includes(rastro))
    afirmar(
      filtrados.length === 0,
      `${ruta} no sirve contenido del banco${filtrados.length ? ` (apareció: ${filtrados.join(', ')})` : ''}`
    )

    // La prueba fuerte: la respuesta no se distingue de la de una ruta que no
    // existe, asi que el 404 no confirma que el banco este ahi.
    afirmar(
      cuerpo.length === cuerpoControl.length,
      `${ruta} responde igual que una ruta inexistente, sin revelar que existe ` +
        `(${cuerpo.length} bytes contra ${cuerpoControl.length} de control)`
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
