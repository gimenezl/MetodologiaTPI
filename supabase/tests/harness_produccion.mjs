/**
 * Los bancos de pruebas de interfaz no existen en producción. Se comprueba.
 *
 * La evidencia de una revisión anterior miraba el código fuente: leía la
 * condición que excluye los bancos y daba por demostrado el resultado. Eso no
 * prueba nada sobre el binario que se despliega.
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
 *   3. Ningún artefacto compilado es un `page.banco` ni contiene sus datos, y
 *      todos los artefactos del servidor se pudieron leer.
 *   4. Ningún cuerpo filtra rastros del banco ni los segmentos de su URL.
 *
 * Para que un 404 signifique algo, primero se comprueba que el servidor sirve
 * una ruta legítima. Un servidor caído devolvería 404 en todo.
 *
 *     node supabase/tests/harness_produccion.mjs
 *
 * Límites: `next build` tiene un techo configurable con `EPT_LIMITE_BUILD_MS`
 * (por defecto 15 minutos); al vencer se detiene el árbol completo de procesos
 * y la prueba falla mostrando la salida acumulada. El arranque, cada petición y
 * el cierre también tienen límite. El servidor se cierra siempre: ante éxito,
 * error, tiempo agotado o excepción. Las piezas se prueban aparte, en
 * `harness_produccion_negativas.mjs`.
 */

import { spawn } from 'node:child_process'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  CLI_NEXT,
  LIMITE_BUILD_POR_DEFECTO_MS,
  RAIZ,
  compararConControl,
  detener,
  ejecutarConLimite,
  entornoAcotado,
  esperarAlServidor,
  exigirPuertoLibre,
  filtracionesEn,
  leerLimite,
  pedir,
  puertoOcupado,
  revisarArtefactos,
} from './_arnes-produccion.mjs'

const PUERTO = 3123
const BASE = `http://127.0.0.1:${PUERTO}`

const RUTAS_DE_BANCO = [
  '/pruebas-ui/alumnos',
  '/pruebas-ui/cursos',
  '/pruebas-ui/niveles',
  '/pruebas-ui/comedor',
  '/pruebas-ui/deportes',
  '/pruebas-ui/hijos',
]
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

let servidor = null

async function principal() {
  const limiteBuildMs = leerLimite('EPT_LIMITE_BUILD_MS', LIMITE_BUILD_POR_DEFECTO_MS)

  await exigirPuertoLibre(`${BASE}${RUTA_LEGITIMA}`)

  // El build se hace sobre un directorio limpio. Una corrida de Playwright deja
  // un build de desarrollo bajo `.next/dev` que sí contiene los bancos: para eso
  // existe. Medir sobre esos restos hacía que el arnés hablara de otro build.
  const salidaDelBuild = join(RAIZ, '.next')
  rmSync(salidaDelBuild, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })

  console.log(`Compilando en modo producción (límite: ${limiteBuildMs} ms).`)
  const compilacion = await ejecutarConLimite(process.execPath, [CLI_NEXT, 'build'], {
    cwd: RAIZ,
    env: entornoAcotado(),
    limiteMs: limiteBuildMs,
  })
  if (compilacion.vencido) {
    console.error(compilacion.registro.slice(-4000))
    throw new Error(
      `la compilación superó el límite de ${limiteBuildMs} ms; se detuvo con todo su árbol de procesos`
    )
  }
  if (compilacion.error || compilacion.codigo !== 0) {
    console.error(compilacion.registro.slice(-4000))
    throw new Error(
      `la compilación de producción no terminó bien (código ${compilacion.codigo}` +
        `${compilacion.error ? `, ${compilacion.error.message}` : ''})`
    )
  }
  afirmar(true, `la aplicación compila en modo producción (${compilacion.duracionMs} ms)`)

  const { problemas, manifiestosRevisados, artefactosLeidos } = revisarArtefactos(salidaDelBuild)
  afirmar(
    manifiestosRevisados > 0,
    `se encontró al menos un manifiesto de rutas legible (${manifiestosRevisados})`
  )
  afirmar(artefactosLeidos > 0, `se leyeron los artefactos del servidor (${artefactosLeidos})`)
  afirmar(
    problemas.length === 0,
    `ningún artefacto de producción corresponde al banco, contiene sus datos o quedó sin leer${
      problemas.length ? `\n       ${problemas.slice(0, 5).join('\n       ')}` : ''
    }`
  )

  servidor = spawn(process.execPath, [CLI_NEXT, 'start', '--port', String(PUERTO)], {
    cwd: RAIZ,
    env: entornoAcotado(),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
    windowsHide: true,
  })
  let registro = ''
  const acumular = (t) => {
    registro = (registro + t).slice(-16_000)
  }
  servidor.stdout.on('data', acumular)
  servidor.stderr.on('data', acumular)

  if (!(await esperarAlServidor(`${BASE}${RUTA_LEGITIMA}`, { proceso: servidor }))) {
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
  afirmar(
    !servidor || servidor.exitCode !== null || servidor.signalCode !== null,
    'el proceso del servidor terminó al cerrar'
  )
  afirmar(!(await puertoOcupado(`${BASE}${RUTA_LEGITIMA}`)), `el puerto ${PUERTO} quedó libre al terminar`)
}

if (fallos > 0) {
  console.error(`\n${fallos} afirmación(es) incumplida(s).`)
  process.exitCode = 1
} else {
  console.log('\nTodas las afirmaciones se cumplieron.')
}
