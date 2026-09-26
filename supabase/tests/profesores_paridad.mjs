import { execFileSync } from 'node:child_process'
import {
  cantidadDeCaracteres,
  especialidadValida,
  normalizarEspecialidad,
  normalizarMotivo,
} from '../../src/lib/profesores.ts'

/**
 * Paridad del contrato de texto de profesores (EPT-58).
 *
 * La base normaliza y valida la especialidad y el motivo en la migración A;
 * el formulario y la API usan `src/lib/profesores.ts`. Esta prueba demuestra
 * que deciden igual: los mismos textos pasan por las cuatro funciones de
 * PostgreSQL y por sus copias de TypeScript, y se exige coincidencia total.
 *
 * Los casos cubren cada uno de los veintiséis espacios del contrato, U+0085
 * (que `\s` de JavaScript no incluye), caracteres que NO son espacio
 * (U+200B, U+180E), los límites de 2 y 100 caracteres, caracteres fuera del
 * plano básico (que `length` cuenta dos veces) y 600 textos aleatorios.
 * Node 24 importa el módulo TypeScript directamente, sin copiar la lógica.
 *
 *     node supabase/tests/profesores_paridad.mjs
 */

const CONTENEDOR =
  process.env.EPT_SUPABASE_DB_CONTAINER ?? 'supabase_db_educar-para-transformar'

const ESPACIOS = [
  9, 10, 11, 12, 13, 32, 0x85, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004,
  0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
  0xfeff,
].map((punto) => String.fromCodePoint(punto))
const NO_ESPACIOS = [0x200b, 0x180e, 0x2060].map((punto) => String.fromCodePoint(punto))
const ASTRAL = String.fromCodePoint(0x1f642)

const casos = ['', 'A', 'AB', 'A B', 'x'.repeat(100), 'x'.repeat(101), ASTRAL, ASTRAL + ASTRAL]
for (const espacio of ESPACIOS) {
  casos.push(
    espacio,
    espacio + espacio,
    `${espacio}${espacio}Ciencias${espacio}${espacio}Naturales${espacio}`,
    `A${espacio}B`,
    `${espacio}Licencia${espacio}médica${espacio}`
  )
}
for (const caracter of NO_ESPACIOS) casos.push(`A${caracter}B`, `${caracter}AB${caracter}`)
casos.push(
  `${'x'.repeat(99)}${ASTRAL}`,
  `${'x'.repeat(100)}${ASTRAL}`,
  ` ${'x'.repeat(100)} `,
  `${ASTRAL}${ESPACIOS[0]}${ASTRAL}`
)

// Textos aleatorios con semilla fija: la corrida es reproducible.
let semilla = 58
const aleatorio = () => {
  semilla = (semilla * 1103515245 + 12345) % 2147483648
  return semilla / 2147483648
}
const ALFABETO = ['a', 'b', 'Z', 'ñ', 'é', '1', '-', ASTRAL, ...ESPACIOS, ...NO_ESPACIOS]
for (let i = 0; i < 600; i += 1) {
  const largo = Math.floor(aleatorio() * 110)
  let texto = ''
  for (let j = 0; j < largo; j += 1) texto += ALFABETO[Math.floor(aleatorio() * ALFABETO.length)]
  casos.push(texto)
}

// Los textos viajan como JSON dentro de un literal con delimitador propio: ningún
// carácter del caso puede cerrarlo.
const entrada = JSON.stringify(casos)
if (entrada.includes('$paridad$')) throw new Error('El delimitador aparece en los datos.')

const sql = `SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'i', t.i,
    'normalizada', app_private.normalizar_especialidad(t.v),
    'valida', app_private.especialidad_valida(t.v),
    'validaNormalizada', app_private.especialidad_valida(app_private.normalizar_especialidad(t.v)),
    'caracteres', pg_catalog.char_length(t.v),
    'motivo', app_private.normalizar_motivo_estado(t.v)
  ) ORDER BY t.i)
FROM pg_catalog.jsonb_array_elements_text($paridad$${entrada}$paridad$::jsonb)
     WITH ORDINALITY AS t(v, i);`

const salida = execFileSync(
  'docker',
  ['exec', '-i', CONTENEDOR, 'psql', '-X', '-q', '-A', '-t', '-U', 'postgres', '-d', 'postgres',
   '-v', 'ON_ERROR_STOP=1'],
  { input: sql, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
)
const base = JSON.parse(salida.trim())

if (base.length !== casos.length) {
  console.error(`FALLO  la base devolvió ${base.length} resultados para ${casos.length} casos`)
  process.exit(1)
}

let diferencias = 0
let validas = 0
base.forEach((fila, indice) => {
  const texto = casos[indice]
  const aplicacion = {
    normalizada: normalizarEspecialidad(texto),
    valida: especialidadValida(texto),
    validaNormalizada: especialidadValida(normalizarEspecialidad(texto)),
    caracteres: cantidadDeCaracteres(texto),
    motivo: normalizarMotivo(texto),
  }
  if (aplicacion.validaNormalizada) validas += 1
  for (const campo of ['normalizada', 'valida', 'validaNormalizada', 'caracteres', 'motivo']) {
    if (fila[campo] !== aplicacion[campo]) {
      diferencias += 1
      const puntos = Array.from(texto, (c) => c.codePointAt(0).toString(16)).join(' ')
      console.error(
        `FALLO  caso ${indice} [${puntos}] ${campo}: base ${JSON.stringify(fila[campo])}, aplicación ${JSON.stringify(aplicacion[campo])}`
      )
    }
  }
})

// Controles de que los casos discriminan: hay válidos e inválidos, y cada
// espacio del contrato colapsa en la base.
const colapsan = ESPACIOS.every(
  (espacio) =>
    normalizarEspecialidad(`${espacio}${espacio}Ciencias${espacio}${espacio}Naturales${espacio}`) ===
    'Ciencias Naturales'
)
if (validas === 0 || validas === casos.length || !colapsan) {
  console.error('FALLO  los casos no discriminan')
  process.exit(1)
}

if (diferencias > 0) {
  console.error(`${diferencias} diferencia(s) entre la base y la aplicación.`)
  process.exit(1)
}

console.log(
  `OK PARIDAD EPT-58: ${casos.length} textos (${validas} válidos una vez normalizados) deciden igual en ` +
    'PostgreSQL y en src/lib/profesores.ts: normalización, validez antes y después de normalizar, largo y motivo'
)
