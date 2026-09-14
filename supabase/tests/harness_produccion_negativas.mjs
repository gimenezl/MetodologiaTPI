/**
 * Pruebas negativas del arnés de producción.
 *
 * Un arnés que nadie prueba es una afirmación más. Éste ya falló por medir el
 * artefacto equivocado y podía quedar colgado para siempre en `next build`.
 * Acá se le presentan las situaciones que tiene que manejar —compilaciones que
 * fallan, que nunca terminan, procesos con hijos y nietos que retienen las
 * tuberías, servidores que no contestan, puertos ocupados, artefactos
 * ilegibles, secretos en el entorno— y se comprueba que las maneja en tiempo
 * acotado y sin dejar nada vivo.
 *
 *     node supabase/tests/harness_produccion_negativas.mjs
 *
 * No compila la aplicación ni toca la base: usa procesos y servidores de
 * mentira y directorios temporales que se borran siempre.
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { join } from 'node:path'
import { setTimeout as esperar } from 'node:timers/promises'
import {
  GRACIA_DE_CIERRE_MS,
  compararConControl,
  conDirectorioTemporal,
  detener,
  ejecutarConLimite,
  entornoAcotado,
  esperarAlServidor,
  exigirPuertoLibre,
  filtracionesEn,
  leerLimite,
  pedir,
  procesoVivo,
  puertoOcupado,
  revisarArtefactos,
} from './_arnes-produccion.mjs'

let fallos = 0
let afirmaciones = 0

function afirmar(condicion, descripcion) {
  afirmaciones += 1
  if (condicion) {
    console.log(`OK  ${descripcion}`)
    return
  }
  fallos += 1
  console.error(`FALLO  ${descripcion}`)
}

/** Techo para cualquier caso que dependa de un límite más la gracia de cierre. */
const TECHO_ACOTADO_MS = GRACIA_DE_CIERRE_MS + 8_000

/** Levanta un servidor de mentira y devuelve su URL y cómo cerrarlo. */
async function servidorDeMentira(manejador, puerto) {
  const servidor = http.createServer(manejador)
  await new Promise((resolver, rechazar) => {
    servidor.once('error', rechazar)
    servidor.listen(puerto, '127.0.0.1', resolver)
  })
  return {
    url: `http://127.0.0.1:${puerto}`,
    cerrar: () =>
      new Promise((resolver) => {
        servidor.closeAllConnections?.()
        servidor.close(resolver)
      }),
  }
}

/** Procesos lanzados directamente por esta prueba: se detienen siempre al final. */
const lanzados = []
function lanzar(argumentos, opciones = {}) {
  const proceso = spawn(process.execPath, argumentos, {
    env: entornoAcotado(),
    stdio: 'ignore',
    windowsHide: true,
    ...opciones,
  })
  lanzados.push(proceso)
  return proceso
}

/** Espera, con límite, a que exista un archivo. */
async function esperarArchivo(ruta, limiteMs) {
  const vence = Date.now() + limiteMs
  while (Date.now() < vence) {
    if (existsSync(ruta)) return true
    await esperar(100)
  }
  return false
}

try {
  // ---------------------------------------------------------------
  // 1. Un servidor que acepta la conexión y nunca responde.
  // ---------------------------------------------------------------
  {
    const mudo = await servidorDeMentira(() => {
      // A propósito: nunca se contesta.
    }, 3311)
    try {
      const empezo = Date.now()
      let corto = false
      try {
        await pedir(`${mudo.url}/login`, { limiteMs: 1500 })
      } catch {
        corto = true
      }
      const tardo = Date.now() - empezo
      afirmar(corto, 'petición sin respuesta: se corta en lugar de colgarse')
      afirmar(tardo < 5000, `petición sin respuesta: se corta a tiempo (${tardo} ms)`)

      const arranco = await esperarAlServidor(`${mudo.url}/login`, { limiteMs: 3000 })
      afirmar(arranco === false, 'arranque: la espera se rinde con un servidor que no contesta')
    } finally {
      await mudo.cerrar()
    }
  }

  // ---------------------------------------------------------------
  // 2. Arranque: un proceso que muere y otro que nunca escucha.
  // ---------------------------------------------------------------
  {
    const muerto = lanzar(['-e', 'process.exit(1)'])
    const empezo = Date.now()
    const arranco = await esperarAlServidor('http://127.0.0.1:3312/login', {
      limiteMs: 20_000,
      proceso: muerto,
    })
    const tardo = Date.now() - empezo
    afirmar(arranco === false, 'arranque: un proceso que muere no se da por levantado')
    afirmar(tardo < 10_000, `arranque: se deja de esperar en cuanto el proceso muere (${tardo} ms de 20000)`)

    const sordo = lanzar(['-e', 'setInterval(() => {}, 1000)'])
    const inicioSordo = Date.now()
    const arrancoSordo = await esperarAlServidor('http://127.0.0.1:3315/login', {
      limiteMs: 2500,
      proceso: sordo,
    })
    const tardoSordo = Date.now() - inicioSordo
    afirmar(arrancoSordo === false, 'arranque: un proceso vivo que nunca escucha agota el límite')
    afirmar(tardoSordo < 6000, `arranque: el límite de arranque se respeta (${tardoSordo} ms)`)
    await detener(sordo)
    afirmar(!procesoVivo(sordo.pid), 'arranque: el proceso que no escuchaba quedó terminado')
  }

  // ---------------------------------------------------------------
  // 3. Una respuesta HTTP inválida.
  // ---------------------------------------------------------------
  {
    const roto = await servidorDeMentira((peticion, respuesta) => {
      respuesta.socket.end('esto no es HTTP\r\n\r\n')
    }, 3313)
    try {
      let fallo = false
      try {
        await pedir(`${roto.url}/login`, { limiteMs: 2000 })
      } catch {
        fallo = true
      }
      afirmar(fallo, 'una respuesta que no es HTTP se trata como fallo')
    } finally {
      await roto.cerrar()
    }
  }

  // ---------------------------------------------------------------
  // 4. Dos cuerpos distintos del mismo tamaño.
  // ---------------------------------------------------------------
  {
    const uno = 'AAAABBBBCCCC'
    const otro = 'AAAABBBBCCCD'
    const comparacion = compararConControl(uno, otro)
    afirmar(comparacion.mismaLongitud === true, 'comparación: existe el caso de misma longitud')
    afirmar(comparacion.iguales === false, 'comparación: SHA-256 distingue cuerpos de igual longitud')
    afirmar(compararConControl(uno, uno).iguales === true, 'comparación: cuerpos idénticos se dan por iguales')
  }

  // ---------------------------------------------------------------
  // 5. Artefactos: bancos presentes, ilegibles o ausentes.
  // ---------------------------------------------------------------
  await conDirectorioTemporal('ept9-arnes-', async (raiz) => {
    const caso = (nombre) => {
      const ruta = join(raiz, nombre)
      mkdirSync(join(ruta, 'server'), { recursive: true })
      return ruta
    }

    const conBanco = caso('manifiesto')
    writeFileSync(
      join(conBanco, 'server', 'app-paths-manifest.json'),
      JSON.stringify({ '/pruebas-ui/alumnos/page': 'app/pruebas-ui/alumnos/page.js' })
    )
    afirmar(
      revisarArtefactos(conBanco).problemas.some((p) => p.includes('registra una ruta de banco')),
      'artefactos: se detecta un banco registrado en el manifiesto'
    )

    const conModulo = caso('modulo')
    mkdirSync(join(conModulo, 'server', 'chunks'), { recursive: true })
    writeFileSync(join(conModulo, 'routes-manifest.json'), '{}')
    writeFileSync(join(conModulo, 'server', 'chunks', 'page.banco.tsx.js'), 'x')
    afirmar(
      revisarArtefactos(conModulo).problemas.some((p) => p.includes('corresponde a un banco')),
      'artefactos: se detecta un módulo compilado con nombre de banco'
    )

    const conDatos = caso('datos')
    writeFileSync(join(conDatos, 'routes-manifest.json'), '{}')
    writeFileSync(join(conDatos, 'server', 'pagina.js'), 'const alumna = { apellido: "Arrieta" }')
    afirmar(
      revisarArtefactos(conDatos).problemas.some((p) => p.includes('contiene datos del banco')),
      'artefactos: se detecta un artefacto con datos del fixture'
    )

    const sinNada = caso('vacio')
    const vacio = revisarArtefactos(sinNada)
    afirmar(
      vacio.manifiestosRevisados === 0 && vacio.problemas.some((p) => p.includes('no se puede auditar')),
      'artefactos: un build sin manifiestos es no auditable, no limpio'
    )

    const limpio = caso('limpio')
    writeFileSync(join(limpio, 'routes-manifest.json'), '{"routes":[]}')
    writeFileSync(join(limpio, 'server', 'pagina.js'), 'export const x = 1')
    const revisionLimpia = revisarArtefactos(limpio)
    afirmar(
      revisionLimpia.problemas.length === 0 && revisionLimpia.artefactosLeidos === 1,
      'artefactos: un build limpio no produce falsos positivos y se lee entero'
    )

    const conDev = caso('dev')
    mkdirSync(join(conDev, 'dev', 'static'), { recursive: true })
    writeFileSync(join(conDev, 'routes-manifest.json'), '{}')
    writeFileSync(join(conDev, 'dev', 'static', 'page.banco.tsx.js'), 'x')
    afirmar(
      revisarArtefactos(conDev).problemas.length === 0,
      'artefactos: los restos del build de desarrollo no se confunden con producción'
    )

    // Ilegibles: la versión anterior los salteaba en silencio.
    const ilegible = caso('ilegible')
    writeFileSync(join(ilegible, 'routes-manifest.json'), '{}')
    writeFileSync(join(ilegible, 'server', 'pagina.js'), 'export const x = 1')
    const leerQueFalla = (ruta, codificacion) => {
      if (ruta.endsWith('pagina.js')) throw Object.assign(new Error('EACCES'), { code: 'EACCES' })
      return readFileSync(ruta, codificacion)
    }
    const conIlegible = revisarArtefactos(ilegible, { leer: leerQueFalla })
    afirmar(
      conIlegible.problemas.some((p) => p.includes('no se pudo leer el artefacto')),
      'artefactos: un artefacto ilegible es un problema, no un archivo que se saltea'
    )

    const manifiestoIlegible = caso('manifiesto-ilegible')
    writeFileSync(join(manifiestoIlegible, 'routes-manifest.json'), '{}')
    const conManifiestoIlegible = revisarArtefactos(manifiestoIlegible, {
      leer: () => {
        throw new Error('EACCES')
      },
    })
    afirmar(
      conManifiestoIlegible.manifiestosRevisados === 0 &&
        conManifiestoIlegible.problemas.some((p) => p.includes('no se pudo leer el manifiesto')),
      'artefactos: un manifiesto ilegible deja el build como no auditable'
    )
  })

  // ---------------------------------------------------------------
  // 6. Filtraciones en el cuerpo.
  // ---------------------------------------------------------------
  {
    afirmar(filtracionesEn('… apellido Arrieta …', '/pruebas-ui/alumnos').rastros.includes('Arrieta'),
      'filtraciones: se detecta un rastro del banco')
    afirmar(filtracionesEn('{"c":["","pruebas-ui","alumnos"]}', '/pruebas-ui/alumnos').segmentos.length === 2,
      'filtraciones: se detectan los segmentos de la URL')
    const limpio = filtracionesEn('<html>404</html>', '/pruebas-ui/alumnos')
    afirmar(limpio.rastros.length === 0 && limpio.segmentos.length === 0,
      'filtraciones: un cuerpo limpio no produce falsos positivos')
  }

  // ---------------------------------------------------------------
  // 7. Límites configurables.
  // ---------------------------------------------------------------
  {
    afirmar(leerLimite('EPT_LIMITE_X', 500, {}) === 500, 'límites: sin variable rige el valor por defecto')
    afirmar(leerLimite('EPT_LIMITE_X', 500, { EPT_LIMITE_X: '1200' }) === 1200, 'límites: un entero válido se respeta')
    for (const invalido of ['abc', '-5', '0', '1.5', '10ms']) {
      let rechazado = false
      try {
        leerLimite('EPT_LIMITE_X', 500, { EPT_LIMITE_X: invalido })
      } catch {
        rechazado = true
      }
      afirmar(rechazado, `límites: «${invalido}» se rechaza en lugar de caer al valor por defecto`)
    }
    let sinLimite = false
    try {
      ejecutarConLimite(process.execPath, ['-e', ''], {})
    } catch {
      sinLimite = true
    }
    afirmar(sinLimite, 'límites: no se puede ejecutar un proceso sin límite')
  }

  // ---------------------------------------------------------------
  // 8. Compilación: correcta, con error, colgada y con descendencia bloqueada.
  // ---------------------------------------------------------------
  {
    const correcta = await ejecutarConLimite(
      process.execPath,
      ['-e', 'console.log("compilación terminada"); process.exit(0)'],
      { limiteMs: 20_000 }
    )
    afirmar(
      correcta.codigo === 0 && !correcta.vencido && correcta.registro.includes('compilación terminada'),
      'build correcto: código 0, sin vencer y con su salida conservada'
    )

    const conError = await ejecutarConLimite(
      process.execPath,
      ['-e', 'console.error("Type error: algo no compila"); process.exit(1)'],
      { limiteMs: 20_000 }
    )
    afirmar(
      conError.codigo === 1 && !conError.vencido && conError.registro.includes('Type error: algo no compila'),
      'build con error: código 1, sin vencer y con stderr conservado'
    )

    const inicioColgado = Date.now()
    const colgada = await ejecutarConLimite(
      process.execPath,
      ['-e', 'console.log("empezando"); setInterval(() => {}, 1000)'],
      { limiteMs: 1500 }
    )
    const duracionColgada = Date.now() - inicioColgado
    afirmar(colgada.vencido === true, 'build colgado: se declara vencido')
    afirmar(duracionColgada < TECHO_ACOTADO_MS, `build colgado: termina en tiempo acotado (${duracionColgada} ms)`)
    afirmar(colgada.registro.includes('empezando'), 'build colgado: conserva la salida previa al corte')
    afirmar(!procesoVivo(colgada.pid), 'build colgado: el proceso raíz quedó terminado')

    await conDirectorioTemporal('ept9-arbol-', async (directorio) => {
      const pids = join(directorio, 'pids.json')
      writeFileSync(join(directorio, 'nieto.cjs'), 'setInterval(() => {}, 1000)\n')
      writeFileSync(
        join(directorio, 'hijo.cjs'),
        `const { spawn } = require('node:child_process')
const { writeFileSync } = require('node:fs')
const path = require('node:path')
// El nieto hereda las tuberías: si no se lo mata, la salida nunca se cierra.
const nieto = spawn(process.execPath, [path.join(__dirname, 'nieto.cjs')], { stdio: 'inherit' })
writeFileSync(process.env.EPT_PIDS, JSON.stringify({ hijo: process.pid, nieto: nieto.pid }))
setInterval(() => {}, 1000)
`
      )
      writeFileSync(
        join(directorio, 'build-falso.cjs'),
        `const { spawn } = require('node:child_process')
const path = require('node:path')
console.log('compilando con trabajadores')
spawn(process.execPath, [path.join(__dirname, 'hijo.cjs')], { stdio: 'inherit' })
setInterval(() => {}, 1000)
`
      )

      const inicio = Date.now()
      const promesa = ejecutarConLimite(process.execPath, [join(directorio, 'build-falso.cjs')], {
        cwd: directorio,
        env: entornoAcotado({ EPT_PIDS: pids }),
        limiteMs: 4000,
      })
      const aparecieron = await esperarArchivo(pids, 3500)
      const arbol = await promesa
      const duracion = Date.now() - inicio

      afirmar(aparecieron, 'árbol bloqueado: el hijo y el nieto llegaron a arrancar')
      const { hijo, nieto } = aparecieron ? JSON.parse(readFileSync(pids, 'utf8')) : {}
      afirmar(arbol.vencido === true, 'árbol bloqueado: el build se declara vencido')
      afirmar(duracion < TECHO_ACOTADO_MS, `árbol bloqueado: termina en tiempo acotado aunque el nieto retenga las tuberías (${duracion} ms)`)
      afirmar(!procesoVivo(arbol.pid), 'árbol bloqueado: el proceso raíz quedó terminado')
      afirmar(Boolean(hijo) && !procesoVivo(hijo), 'árbol bloqueado: el hijo quedó terminado')
      afirmar(Boolean(nieto) && !procesoVivo(nieto), 'árbol bloqueado: el nieto quedó terminado')
    })

    await conDirectorioTemporal('ept9-padre-termina-', async (directorio) => {
      const pids = join(directorio, 'pids.json')
      writeFileSync(join(directorio, 'descendiente.cjs'), 'setInterval(() => {}, 1000)\n')
      writeFileSync(
        join(directorio, 'padre.cjs'),
        `const { spawn } = require('node:child_process')
const { writeFileSync } = require('node:fs')
const path = require('node:path')
const descendiente = spawn(process.execPath, [path.join(__dirname, 'descendiente.cjs')], {
  detached: process.platform === 'win32',
  stdio: 'ignore',
  windowsHide: true,
})
descendiente.unref()
writeFileSync(process.env.EPT_PIDS, JSON.stringify({ descendiente: descendiente.pid }))
// El padre termina bien antes que su descendiente y deja las tuberías abiertas.
`
      )

      const resultado = await ejecutarConLimite(process.execPath, [join(directorio, 'padre.cjs')], {
        cwd: directorio,
        env: entornoAcotado({ EPT_PIDS: pids }),
        limiteMs: 5000,
      })
      const aparecieron = await esperarArchivo(pids, 1000)
      const { descendiente } = aparecieron ? JSON.parse(readFileSync(pids, 'utf8')) : {}

      afirmar(aparecieron, 'padre terminado: el descendiente llegó a arrancar')
      afirmar(resultado.codigo === 0 && !resultado.vencido, 'padre terminado: se conserva el código de éxito del padre')
      afirmar(
        Boolean(descendiente) && !procesoVivo(descendiente),
        'padre terminado: el descendiente también queda terminado antes de resolver'
      )
    })

    const inexistente = await ejecutarConLimite('comando-que-no-existe-ept9', [], { limiteMs: 5000 })
    afirmar(
      inexistente.error !== null && inexistente.error !== undefined && !inexistente.vencido,
      'comando inexistente: se informa el error en lugar de colgarse'
    )
  }

  // ---------------------------------------------------------------
  // 9. Secretos: el entorno acotado no los arrastra.
  // ---------------------------------------------------------------
  {
    const previo = process.env.SUPABASE_SERVICE_ROLE_KEY
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'secreto-de-prueba-que-no-debe-viajar'
    process.env.EPT_SECRETO_DE_PRUEBA = 'no-deberia-viajar'
    try {
      const entorno = entornoAcotado()
      afirmar(entorno.EPT_SECRETO_DE_PRUEBA === undefined, 'secretos: una variable ajena no llega al hijo')
      afirmar(entorno.SUPABASE_SERVICE_ROLE_KEY === undefined, 'secretos: la clave de servicio no está en el entorno acotado')
      afirmar(
        entornoAcotado({ SUPABASE_SERVICE_ROLE_KEY: 'forzada' }).SUPABASE_SERVICE_ROLE_KEY === undefined,
        'secretos: ni siquiera pidiéndola explícitamente se reintroduce'
      )
      const hijo = await ejecutarConLimite(
        process.execPath,
        ['-e', 'process.stdout.write([process.env.SUPABASE_SERVICE_ROLE_KEY, process.env.EPT_SECRETO_DE_PRUEBA].map((v) => v ?? "ausente").join(","))'],
        { limiteMs: 10_000, env: entornoAcotado() }
      )
      afirmar(hijo.registro === 'ausente,ausente', `secretos: el proceso hijo real no ve ninguno (${hijo.registro})`)
      afirmar(
        entornoAcotado().EPT_UI_HARNESS === '1' && entornoAcotado().NODE_ENV === 'production',
        'secretos: sí llega lo que el arnés necesita'
      )
    } finally {
      if (previo === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY
      else process.env.SUPABASE_SERVICE_ROLE_KEY = previo
      delete process.env.EPT_SECRETO_DE_PRUEBA
    }
  }

  // ---------------------------------------------------------------
  // 10. Puertos y limpieza.
  // ---------------------------------------------------------------
  {
    const vivo = await servidorDeMentira((peticion, respuesta) => {
      respuesta.writeHead(200)
      respuesta.end('ok')
    }, 3314)
    let rechazado = false
    try {
      await exigirPuertoLibre('http://127.0.0.1:3314/login')
    } catch {
      rechazado = true
    }
    afirmar(rechazado, 'puerto ocupado: el arnés se niega a medir un servidor ajeno')
    await vivo.cerrar()
    let aceptado = true
    try {
      await exigirPuertoLibre('http://127.0.0.1:3314/login')
    } catch {
      aceptado = false
    }
    afirmar(aceptado && !(await puertoOcupado('http://127.0.0.1:3314/login')), 'puerto libre: se detecta como libre')

    let rutaExito = ''
    const valor = await conDirectorioTemporal('ept9-limpieza-', async (directorio) => {
      rutaExito = directorio
      writeFileSync(join(directorio, 'x.txt'), 'x')
      return 'hecho'
    })
    afirmar(valor === 'hecho' && !existsSync(rutaExito), 'limpieza: el directorio temporal se borra al terminar bien')

    let rutaFallo = ''
    let propagado = false
    try {
      await conDirectorioTemporal('ept9-limpieza-', async (directorio) => {
        rutaFallo = directorio
        writeFileSync(join(directorio, 'x.txt'), 'x')
        throw new Error('fallo a propósito')
      })
    } catch {
      propagado = true
    }
    afirmar(propagado && rutaFallo !== '' && !existsSync(rutaFallo), 'limpieza: también se borra cuando el trabajo falla, y el error se propaga')

    const inexistente = { pid: 2_147_483_647, exitCode: 0, signalCode: null, once: () => {} }
    await detener(inexistente)
    afirmar(procesoVivo(process.pid), 'cierre: un PID inexistente no amplía la búsqueda ni afecta procesos ajenos')
  }
} catch (error) {
  fallos += 1
  console.error(`FALLO  ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
} finally {
  for (const proceso of lanzados) await detener(proceso)
  afirmar(lanzados.every((proceso) => !procesoVivo(proceso.pid)), 'no quedó ningún proceso lanzado por la prueba')
}

console.log(`\n${afirmaciones} afirmaciones, ${fallos} incumplida(s).`)
process.exitCode = fallos > 0 ? 1 : 0
