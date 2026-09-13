/**
 * Pruebas negativas del arnés de producción.
 *
 * Un arnés que nadie prueba es una afirmación más. Éste ya falló dos veces por
 * medir el artefacto equivocado —un servidor de una corrida anterior que seguía
 * escuchando, y el build de desarrollo que deja Playwright—, y las dos veces
 * informó «todo en orden». Acá se le presentan las situaciones que tiene que
 * detectar y se comprueba que las detecta.
 *
 *     node supabase/tests/harness_produccion_negativas.mjs
 *
 * No compila la aplicación ni toca la base: levanta servidores de mentira y
 * arma directorios de artefactos sintéticos. Corre en segundos.
 */

import { spawn } from 'node:child_process'
import http from 'node:http'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

let fallos = 0

function afirmar(condicion, descripcion) {
  if (condicion) {
    console.log(`OK  ${descripcion}`)
    return
  }
  fallos += 1
  console.error(`FALLO  ${descripcion}`)
}

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

const temporales = []
function directorioTemporal() {
  const ruta = mkdtempSync(join(tmpdir(), 'ept9-arnes-'))
  temporales.push(ruta)
  return ruta
}

try {
  // ---------------------------------------------------------------
  // 1. Un servidor que acepta la conexión y nunca responde.
  // ---------------------------------------------------------------
  {
    // Sin límite de espera, esto colgaba el arnés para siempre: ni pasaba, ni
    // fallaba, ni liberaba el puerto.
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
      afirmar(corto, 'una petición sin respuesta se corta en lugar de colgarse')
      afirmar(tardo < 5000, `y se corta a tiempo (tardó ${tardo} ms)`)

      const arranco = await esperarAlServidor(`${mudo.url}/login`, { limiteMs: 3000 })
      afirmar(
        arranco === false,
        'la espera de arranque se rinde con un servidor que no contesta'
      )
    } finally {
      await mudo.cerrar()
    }
  }

  // ---------------------------------------------------------------
  // 2. Un proceso que falla durante el arranque.
  // ---------------------------------------------------------------
  {
    const proceso = spawn(
      process.execPath,
      ['-e', 'console.error("arranque roto"); process.exit(1)'],
      { env: entornoAcotado(), stdio: ['ignore', 'pipe', 'pipe'] }
    )
    const arranco = await esperarAlServidor('http://127.0.0.1:3312/login', {
      limiteMs: 3000,
    })
    afirmar(arranco === false, 'un proceso que muere al arrancar no se da por levantado')

    await detener(proceso)
    afirmar(proceso.exitCode !== null, 'y el proceso queda terminado, no colgado')
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
    afirmar(
      comparacion.mismaLongitud === true,
      'el caso límite existe: dos cuerpos distintos con la misma longitud'
    )
    afirmar(
      comparacion.iguales === false,
      'y la comparación por SHA-256 los distingue, que es lo que la de longitud no hacía'
    )
    afirmar(
      compararConControl(uno, uno).iguales === true,
      'dos cuerpos idénticos sí se dan por iguales'
    )
  }

  // ---------------------------------------------------------------
  // 5. Un banco presente en el manifiesto o en los artefactos.
  // ---------------------------------------------------------------
  {
    // 5a. Manifiesto que registra el banco.
    const conBanco = directorioTemporal()
    mkdirSync(join(conBanco, 'server'), { recursive: true })
    writeFileSync(
      join(conBanco, 'server', 'app-paths-manifest.json'),
      JSON.stringify({ '/pruebas-ui/alumnos/page': 'app/pruebas-ui/alumnos/page.js' })
    )
    const r5a = revisarArtefactos(conBanco)
    afirmar(
      r5a.problemas.some((p) => p.includes('registra una ruta de banco')),
      'se detecta un banco registrado en el manifiesto de rutas'
    )

    // 5b. Artefacto compilado con nombre de banco.
    const conModulo = directorioTemporal()
    mkdirSync(join(conModulo, 'server', 'chunks'), { recursive: true })
    writeFileSync(join(conModulo, 'routes-manifest.json'), '{}')
    writeFileSync(join(conModulo, 'server', 'chunks', 'page.banco.tsx.js'), 'x')
    const r5b = revisarArtefactos(conModulo)
    afirmar(
      r5b.problemas.some((p) => p.includes('corresponde a un banco')),
      'se detecta un artefacto compilado con nombre de banco'
    )

    // 5c. Artefacto que contiene datos del fixture.
    const conDatos = directorioTemporal()
    mkdirSync(join(conDatos, 'server'), { recursive: true })
    writeFileSync(join(conDatos, 'routes-manifest.json'), '{}')
    writeFileSync(
      join(conDatos, 'server', 'pagina.js'),
      'const alumna = { apellido: "Arrieta", legajo: "LEG-2027-018" }'
    )
    const r5c = revisarArtefactos(conDatos)
    afirmar(
      r5c.problemas.some((p) => p.includes('contiene datos del banco')),
      'se detecta un artefacto que contiene datos del fixture'
    )

    // 5d. Sin ningún manifiesto, el build no se puede auditar y se dice.
    const sinNada = directorioTemporal()
    const r5d = revisarArtefactos(sinNada)
    afirmar(
      r5d.manifiestosRevisados === 0 &&
        r5d.problemas.some((p) => p.includes('no se puede auditar')),
      'un build sin manifiestos se informa como no auditable, no como limpio'
    )

    // 5e. Un build limpio no produce falsos positivos.
    const limpio = directorioTemporal()
    mkdirSync(join(limpio, 'server'), { recursive: true })
    writeFileSync(join(limpio, 'routes-manifest.json'), '{"routes":[]}')
    writeFileSync(join(limpio, 'server', 'pagina.js'), 'export const x = 1')
    const r5e = revisarArtefactos(limpio)
    afirmar(r5e.problemas.length === 0, 'un build limpio no produce ningún problema')

    // 5f. El build de desarrollo no cuenta como salida de producción.
    const conDev = directorioTemporal()
    mkdirSync(join(conDev, 'dev', 'static'), { recursive: true })
    mkdirSync(join(conDev, 'server'), { recursive: true })
    writeFileSync(join(conDev, 'routes-manifest.json'), '{}')
    writeFileSync(join(conDev, 'dev', 'static', 'page.banco.tsx.js'), 'x')
    const r5f = revisarArtefactos(conDev)
    afirmar(
      r5f.problemas.length === 0,
      'los restos del build de desarrollo no se confunden con producción'
    )
  }

  // ---------------------------------------------------------------
  // 6. Filtraciones en el cuerpo.
  // ---------------------------------------------------------------
  {
    const conRastro = filtracionesEn('… apellido Arrieta …', '/pruebas-ui/alumnos')
    afirmar(conRastro.rastros.includes('Arrieta'), 'se detecta un rastro del banco')

    const conSegmento = filtracionesEn('{"c":["","pruebas-ui","alumnos"]}', '/pruebas-ui/alumnos')
    afirmar(
      conSegmento.segmentos.length === 2,
      'se detectan los segmentos de la URL filtrados en el cuerpo'
    )

    const limpio = filtracionesEn('<html>404</html>', '/pruebas-ui/alumnos')
    afirmar(
      limpio.rastros.length === 0 && limpio.segmentos.length === 0,
      'un cuerpo limpio no produce falsos positivos'
    )
  }

  // ---------------------------------------------------------------
  // 7. El entorno acotado no arrastra secretos.
  // ---------------------------------------------------------------
  {
    process.env.EPT_SECRETO_DE_PRUEBA = 'no-deberia-viajar'
    const entorno = entornoAcotado()
    afirmar(
      entorno.EPT_SECRETO_DE_PRUEBA === undefined,
      'una variable ajena no llega al proceso hijo'
    )
    afirmar(
      entorno.SUPABASE_SERVICE_ROLE_KEY === undefined,
      'la clave de servicio no llega al proceso hijo'
    )
    afirmar(
      entorno.EPT_UI_HARNESS === '1' && entorno.NODE_ENV === 'production',
      'y sí llega lo que el arnés necesita: producción con la variable del banco encendida'
    )
    delete process.env.EPT_SECRETO_DE_PRUEBA
  }

  // ---------------------------------------------------------------
  // 8. El cierre se ejecuta siempre, y libera el puerto.
  // ---------------------------------------------------------------
  {
    const vivo = await servidorDeMentira((peticion, respuesta) => {
      respuesta.writeHead(200)
      respuesta.end('ok')
    }, 3314)
    afirmar(
      (await puertoOcupado('http://127.0.0.1:3314/login')) === true,
      'un puerto ocupado se detecta como ocupado'
    )
    await vivo.cerrar()
    afirmar(
      (await puertoOcupado('http://127.0.0.1:3314/login')) === false,
      'y un puerto libre se detecta como libre: es lo que comprueba el cierre del arnés'
    )

    // Un proceso hijo con descendencia también se baja entero.
    const padre = spawn(
      process.execPath,
      ['-e', 'setInterval(() => {}, 1000)'],
      { env: entornoAcotado(), stdio: 'ignore' }
    )
    await detener(padre)
    afirmar(padre.exitCode !== null || padre.killed, 'el cierre termina el proceso hijo')
  }
} catch (error) {
  fallos += 1
  console.error(`FALLO  ${error instanceof Error ? error.message : String(error)}`)
} finally {
  for (const ruta of temporales) rmSync(ruta, { recursive: true, force: true })
}

if (fallos > 0) {
  console.error(`\n${fallos} afirmación(es) incumplida(s).`)
  process.exitCode = 1
} else {
  console.log('\nTodas las afirmaciones se cumplieron.')
}
