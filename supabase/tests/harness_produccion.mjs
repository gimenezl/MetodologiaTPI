/**
 * Los bancos de pruebas de interfaz no existen en producción. Se comprueba.
 *
 * La revisión objetó, con razón, que la evidencia anterior miraba el código
 * fuente: leía la condición `NODE_ENV === 'production' || EPT_UI_HARNESS !== '1'`
 * y daba por demostrado el resultado. Eso no prueba nada sobre el binario que
 * se despliega; prueba que alguien escribió una condición.
 *
 * Acá se compila la aplicación en modo producción sobre un directorio limpio,
 * se levanta con `EPT_UI_HARNESS=1` —el peor escenario: la variable encendida
 * por error en el servidor real— y se pide cada ruta por HTTP.
 *
 * Cuatro comprobaciones independientes:
 *
 *   1. La respuesta de cada banco es idéntica, byte a byte, a la de una ruta
 *      que nunca existió. Comparar longitudes no alcanzaba.
 *   2. Los manifiestos de rutas no registran los bancos.
 *   3. Ningún artefacto compilado es un `page.banco` ni contiene sus datos.
 *   4. Ningún cuerpo filtra rastros del banco ni los segmentos de su URL.
 *
 * Para que un 404 signifique algo, primero se comprueba que el servidor sirve
 * una ruta legítima. Un servidor caído devolvería 404 en todo.
 *
 *     node supabase/tests/harness_produccion.mjs
 *
 * Todas las peticiones tienen límite de espera, el arranque también, y el
 * servidor se cierra siempre: ante éxito, error, tiempo agotado o excepción.
 * Las piezas que esto usa se prueban aparte, en `harness_produccion_negativas.mjs`.
 */

import { spawn } from 'node:child_process'
import { rmSync } from 'node:fs'
import {
  compararConControl,
  detener,
  entornoAcotado,
  esperarAlServidor,
  filtracionesEn,
  pedir,
  puertoOcupado,
  revisarArtefactos,
} from './_arnes-produccion.mjs'

const PUERTO = 3123
const BASE = `http://127.0.0.1:${PUERTO}`

const RUTAS_DE_BANCO = ['/pruebas-ui/alumnos', '/pruebas-ui/cursos', '/pruebas-ui/niveles']
const RUTA_LEGITIMA = '/login'

/**
 * Ruta de control: no existe ni existió nunca. Su 404 es la referencia contra
 * la que se compara el de los bancos.
 *
 * Sin esta comparación, un 404 no dice lo suficiente. Next incluye los
 * segmentos de la URL en la carga RSC de toda ruta que el enrutador conoce, de
 * modo que una ruta presente pero negada responde distinto de una ausente.
 */
const RUTA_INEXISTENTE = '/pruebas-ui/no-existe-esta-ruta'
const OTRA_RUTA_INEXISTENTE = '/otra/ruta/que-no-existe'

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
      env: entornoAcotado(),
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

let servidor = null

async function principal() {
  // Nadie puede estar escuchando ya en el puerto. Si un servidor de una corrida
  // anterior sigue vivo, `next start` no lo consigue y el arnés termina midiendo
  // ese binario viejo sin enterarse.
  if (await puertoOcupado(`${BASE}${RUTA_LEGITIMA}`)) {
    throw new Error(
      `el puerto ${PUERTO} ya está ocupado. Cerrá ese proceso antes de correr esta ` +
        'prueba: de lo contrario mediría un servidor que no corresponde a este código.'
    )
  }

  // El build se hace sobre un directorio limpio. Una corrida de Playwright deja
  // un build de desarrollo bajo `.next/dev` que sí contiene los bancos: para eso
  // existe. Medir sobre esos restos hacía que el arnés hablara de otro build.
  rmSync('.next', { recursive: true, force: true })

  console.log('Compilando en modo producción. Puede tardar varios minutos.')
  const compilacion = await ejecutar('npx', ['next', 'build'])
  if (compilacion.codigo !== 0) {
    console.error(compilacion.salida.slice(-4000))
    throw new Error('la compilación de producción no terminó bien')
  }
  console.log('OK  la aplicación compila en modo producción')

  const { problemas, manifiestosRevisados } = revisarArtefactos('.next')
  afirmar(
    manifiestosRevisados > 0,
    `se encontró al menos un manifiesto de rutas (${manifiestosRevisados})`
  )
  afirmar(
    problemas.length === 0,
    `ningún artefacto de producción corresponde al banco ni contiene sus datos${
      problemas.length ? `\n       ${problemas.slice(0, 5).join('\n       ')}` : ''
    }`
  )

  servidor = spawn('npx', ['next', 'start', '--port', String(PUERTO)], {
    env: entornoAcotado(),
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let registro = ''
  servidor.stdout.on('data', (t) => {
    registro += t
  })
  servidor.stderr.on('data', (t) => {
    registro += t
  })

  if (!(await esperarAlServidor(`${BASE}${RUTA_LEGITIMA}`))) {
    console.error(registro.slice(-4000))
    throw new Error('el servidor de producción no llegó a atender peticiones a tiempo')
  }

  // Control positivo: sin esto, un 404 no distingue «ruta ausente» de
  // «servidor roto».
  const legitima = await pedir(`${BASE}${RUTA_LEGITIMA}`)
  afirmar(
    legitima.status === 200,
    `una ruta legítima responde 200 (${RUTA_LEGITIMA} devolvió ${legitima.status})`
  )

  const control = await pedir(`${BASE}${RUTA_INEXISTENTE}`)
  const cuerpoControl = await control.text()
  afirmar(
    control.status === 404,
    `la ruta de control responde 404 (${RUTA_INEXISTENTE} devolvió ${control.status})`
  )

  // La referencia sólo sirve si es estable.
  const segundaControl = await pedir(`${BASE}${OTRA_RUTA_INEXISTENTE}`)
  afirmar(
    compararConControl(await segundaControl.text(), cuerpoControl).iguales,
    'dos rutas inexistentes producen el mismo cuerpo: la referencia es estable'
  )

  for (const ruta of RUTAS_DE_BANCO) {
    const respuesta = await pedir(`${BASE}${ruta}`)
    afirmar(
      respuesta.status === 404,
      `${ruta} responde 404 en producción aun con EPT_UI_HARNESS=1 (devolvió ${respuesta.status})`
    )

    const cuerpo = await respuesta.text()
    const { rastros, segmentos } = filtracionesEn(cuerpo, ruta)
    afirmar(
      rastros.length === 0,
      `${ruta} no sirve contenido del banco${
        rastros.length ? ` (apareció: ${rastros.join(', ')})` : ''
      }`
    )
    afirmar(
      segmentos.length === 0,
      `${ruta} no filtra sus segmentos en el cuerpo${
        segmentos.length ? ` (apareció: ${segmentos.join(', ')})` : ''
      }`
    )

    const comparacion = compararConControl(cuerpo, cuerpoControl)
    afirmar(
      comparacion.iguales,
      `${ruta} responde exactamente igual que una ruta inexistente ` +
        `(SHA-256 ${comparacion.huella.slice(0, 16)}… contra ` +
        `${comparacion.huellaControl.slice(0, 16)}… de control)`
    )
  }
}

// El resultado se acumula y el código de salida se asigna después del cierre.
// Llamar a `process.exit` dentro del `try` impediría que el `finally` bajara el
// servidor, y el puerto quedaría tomado para la próxima corrida.
try {
  await principal()
} catch (error) {
  fallos += 1
  console.error(`FALLO  ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await detener(servidor)
  const sigueVivo = await puertoOcupado(`${BASE}${RUTA_LEGITIMA}`)
  afirmar(!sigueVivo, `el puerto ${PUERTO} quedó libre al terminar`)
}

if (fallos > 0) {
  console.error(`\n${fallos} afirmación(es) incumplida(s).`)
  process.exitCode = 1
} else {
  console.log('\nTodas las afirmaciones se cumplieron.')
}
