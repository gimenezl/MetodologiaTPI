/**
 * Política reproducible de los tipos generados.
 *
 * `supabase gen types typescript` termina su salida con una línea en blanco.
 * Versionarla tal cual haría fallar `git diff --check`, que señala
 * «new blank line at EOF». Versionar otra cosa sin decirlo sería peor: la
 * evidencia anterior afirmaba que el archivo del repositorio y la salida del
 * generador eran literalmente idénticos, y no lo eran.
 *
 * La política es explícita: **se versiona la salida normalizada**, y la
 * normalización consiste en una sola regla, aplicada siempre igual:
 *
 *   quitar las líneas finales en blanco y dejar exactamente un salto de línea.
 *
 * Nada más. No se toca el contenido, no se reordena, no se edita a mano. Este
 * archivo es la única forma de regenerar los tipos.
 *
 *     node supabase/tests/tipos-generados.mjs             # verifica
 *     node supabase/tests/tipos-generados.mjs --escribir  # regenera
 *
 * La verificación genera dos veces para demostrar que el generador es
 * determinista, y compara byte a byte contra el archivo versionado.
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

const DESTINO = 'src/types/database.generated.ts'
const escribir = process.argv.includes('--escribir')

let fallos = 0

function afirmar(condicion, descripcion) {
  if (condicion) {
    console.log(`OK  ${descripcion}`)
    return
  }
  fallos += 1
  console.error(`FALLO  ${descripcion}`)
}

/** La única regla de normalización. */
function normalizar(salida) {
  return `${salida.replace(/[\r\n]+$/u, '')}\n`
}

function huella(texto) {
  return createHash('sha256').update(texto, 'utf8').digest('hex')
}

/**
 * Versión del CLI con la que se generaron los tipos versionados.
 *
 * `npx supabase` sin versión resuelve la última publicada, y la 2.118.0 cambió
 * el formato de `gen types` (salida sin formatear): regenerar con ella
 * reescribía miles de líneas sin ningún cambio de esquema. Se fija la versión
 * para que la regeneración sea reproducible; cambiarla es una decisión
 * explícita, con `EPT_SUPABASE_CLI`.
 */
const VERSION_CLI = process.env.EPT_SUPABASE_CLI ?? '2.117.0'

function generar() {
  return execFileSync('npx', ['--yes', `supabase@${VERSION_CLI}`, 'gen', 'types', 'typescript', '--local'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    maxBuffer: 32 * 1024 * 1024,
  })
}

console.log('Generando los tipos desde la base local.')
const primera = generar()
const segunda = generar()

const crudaUno = huella(primera)
const crudaDos = huella(segunda)
afirmar(
  crudaUno === crudaDos,
  `dos generaciones seguidas producen la misma salida cruda (SHA-256 ${crudaUno.slice(0, 16)}…)`
)

const normalizada = normalizar(primera)
const huellaNormalizada = huella(normalizada)
afirmar(
  huella(normalizar(segunda)) === huellaNormalizada,
  `y la misma salida normalizada (SHA-256 ${huellaNormalizada.slice(0, 16)}…)`
)

// Se informa la diferencia exacta entre lo crudo y lo versionado, para que
// nadie tenga que suponerla.
console.log(
  `    cruda ${primera.length} bytes · normalizada ${normalizada.length} bytes · ` +
    `diferencia ${primera.length - normalizada.length} byte(s) de línea en blanco final`
)

if (escribir) {
  writeFileSync(DESTINO, normalizada, 'utf8')
  console.log(`OK  ${DESTINO} reescrito desde la base local`)
  process.exit(0)
}

const versionado = readFileSync(DESTINO, 'utf8')
afirmar(
  versionado === normalizada,
  `${DESTINO} coincide byte a byte con la salida normalizada`
)

if (versionado !== normalizada) {
  console.error(
    `    versionado ${versionado.length} bytes (SHA-256 ${huella(versionado).slice(0, 16)}…) ` +
      `contra normalizada ${normalizada.length} bytes (SHA-256 ${huellaNormalizada.slice(0, 16)}…)`
  )
  console.error('    Regenerá con: node supabase/tests/tipos-generados.mjs --escribir')
}

// El archivo versionado no puede tener la línea en blanco final que hace
// fallar la comprobación de espacios de Git.
afirmar(
  !/\n\s*\n$/u.test(versionado),
  `${DESTINO} no termina en una línea en blanco`
)

if (fallos > 0) {
  console.error(`\n${fallos} afirmación(es) incumplida(s).`)
  process.exit(1)
}
console.log('\nTodas las afirmaciones se cumplieron.')
