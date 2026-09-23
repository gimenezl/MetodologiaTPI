import { execFileSync } from 'node:child_process'
import { seSuperponen } from '../../src/lib/horarios.ts'

/**
 * Paridad de la comparación de intervalos (EPT-39).
 *
 * La regla vive en PostgreSQL (`app_private.intervalos_se_superponen`) y el
 * servidor tiene una copia en `src/lib/horarios.ts` para anticiparla. Esta
 * prueba demuestra que las dos son la MISMA función: genera todas las franjas
 * posibles sobre cinco puntos de borde y dos días, compara todos los pares en
 * los dos órdenes con ambas implementaciones y exige coincidencia total.
 *
 * Los puntos de borde cubren igualdad, contigüidad, contención y solapamiento
 * parcial en todas sus combinaciones. Node 24 importa el módulo TypeScript
 * directamente (eliminación de tipos), sin transpilar ni copiar la lógica.
 *
 *     node supabase/tests/horarios_paridad.mjs
 */

const CONTENEDOR =
  process.env.EPT_SUPABASE_DB_CONTAINER ?? 'supabase_db_educar-para-transformar'

const PUNTOS = ['09:00', '09:30', '10:00', '10:30', '11:00']
const DIAS = [1, 2]

const franjas = []
for (const dia of DIAS) {
  for (let i = 0; i < PUNTOS.length; i += 1) {
    for (let j = i + 1; j < PUNTOS.length; j += 1) {
      franjas.push({ dia_semana: dia, hora_inicio: PUNTOS[i], hora_fin: PUNTOS[j] })
    }
  }
}

const pares = []
for (const a of franjas) for (const b of franjas) pares.push([a, b])

const valores = pares
  .map(
    ([a, b], indice) =>
      `(${indice}, ${a.dia_semana}::SMALLINT, '${a.hora_inicio}'::TIME, '${a.hora_fin}'::TIME, ` +
      `${b.dia_semana}::SMALLINT, '${b.hora_inicio}'::TIME, '${b.hora_fin}'::TIME)`
  )
  .join(',\n')

const sql = `SELECT indice || ':' || app_private.intervalos_se_superponen(da, ia, fa, db, ib, fb)
FROM (VALUES ${valores}) AS p(indice, da, ia, fa, db, ib, fb)
ORDER BY indice;`

const salida = execFileSync(
  'docker',
  ['exec', '-i', CONTENEDOR, 'psql', '-X', '-q', '-A', '-t', '-U', 'postgres', '-d', 'postgres',
   '-v', 'ON_ERROR_STOP=1'],
  { input: sql, encoding: 'utf8' }
)

const base = new Map(
  salida
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((linea) => {
      const [indice, valor] = linea.split(':')
      return [Number(indice), valor === 'true']
    })
)

let diferencias = 0
let superpuestos = 0
pares.forEach(([a, b], indice) => {
  const aplicacion = seSuperponen(a, b)
  if (aplicacion) superpuestos += 1
  if (base.get(indice) !== aplicacion) {
    diferencias += 1
    console.error(
      `FALLO  ${JSON.stringify(a)} vs ${JSON.stringify(b)}: base ${base.get(indice)}, aplicación ${aplicacion}`
    )
  }
})

if (base.size !== pares.length) {
  console.error(`FALLO  la base devolvió ${base.size} resultados para ${pares.length} pares`)
  process.exit(1)
}

// Controles de que la matriz no es trivial: contiene pares de los dos tipos,
// y los contiguos del mismo día existen y no se superponen.
const contiguos = pares.filter(
  ([a, b]) => a.dia_semana === b.dia_semana && a.hora_fin === b.hora_inicio
)
if (superpuestos === 0 || superpuestos === pares.length || contiguos.length === 0
    || contiguos.some(([a, b]) => seSuperponen(a, b))) {
  console.error('FALLO  la matriz de casos no discrimina')
  process.exit(1)
}

if (diferencias > 0) {
  console.error(`${diferencias} diferencia(s) entre la base y la aplicación.`)
  process.exit(1)
}

console.log(
  `OK PARIDAD: ${pares.length} pares (${superpuestos} superpuestos, ${contiguos.length} contiguos) ` +
    'deciden igual en PostgreSQL y en src/lib/horarios.ts'
)
