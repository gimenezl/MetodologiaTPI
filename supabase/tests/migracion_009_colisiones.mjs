/**
 * La autoverificación de la 009 no puede abortar por datos legítimos.
 *
 * La primera versión de esa autoverificación insertaba filas en
 * `public.perfiles` con un DNI y un legajo fijos. Sobre una base que ya
 * contuviera cualquiera de esos valores, el INSERT chocaba con la restricción
 * única, la migración abortaba y el centro educativo se quedaba sin poder
 * migrar por tener un dato correcto. Una comprobación no puede consumir
 * identificadores productivos.
 *
 * Esta prueba reconstruye 001 → 008 en una base descartable, siembra
 * exactamente los identificadores que colisionaban, aplica la 009 y comprueba
 * que termina bien y que el contrato quedó vigente. Después la aplica otra vez,
 * para demostrar que es idempotente, y por último degrada la restricción al
 * defecto original para comprobar que la guardia falla de verdad.
 *
 *     node supabase/tests/migracion_009_colisiones.mjs
 *
 * Trabaja sobre una base propia dentro de la misma instancia local, así que no
 * interfiere con la base de la aplicación ni con otra corrida.
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const CONTENEDOR =
  process.env.EPT_SUPABASE_DB_CONTAINER ?? 'supabase_db_educar-para-transformar'

const BASE_PRUEBA = 'ept9_prueba_migracion'
const DIRECTORIO = 'supabase/migrations'

let fallos = 0

function afirmar(condicion, descripcion) {
  if (condicion) {
    console.log(`OK  ${descripcion}`)
    return
  }
  fallos += 1
  console.error(`FALLO  ${descripcion}`)
}

/** Ejecuta SQL contra una base de la instancia local. Devuelve {codigo, salida}. */
function psql(base, sentencia, { detenerAlError = true } = {}) {
  const argumentos = [
    'exec', '-i', CONTENEDOR, 'psql', '-X', '-q', '-A', '-t',
    '-U', 'postgres', '-d', base,
  ]
  if (detenerAlError) argumentos.push('-v', 'ON_ERROR_STOP=1')

  try {
    const salida = execFileSync('docker', argumentos, {
      input: sentencia,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return { codigo: 0, salida }
  } catch (error) {
    return {
      codigo: error.status ?? 1,
      salida: `${error.stdout ?? ''}${error.stderr ?? ''}`,
    }
  }
}

function escalar(base, expresion) {
  const { codigo, salida } = psql(base, `SELECT ${expresion};`)
  if (codigo !== 0) throw new Error(`Consulta fallida: ${salida}`)
  return salida.trim()
}

function leerMigracion(nombre) {
  return fs.readFileSync(path.join(DIRECTORIO, nombre), 'utf8')
}

const migraciones = fs
  .readdirSync(DIRECTORIO)
  .filter((archivo) => archivo.endsWith('.sql'))
  .sort()

const hasta008 = migraciones.filter((archivo) => archivo < '009')
const la009 = migraciones.find((archivo) => archivo.startsWith('009'))

if (hasta008.length === 0 || !la009) {
  console.error('FALLO  no se encontraron las migraciones esperadas')
  process.exit(1)
}

/**
 * Sustituto mínimo del esquema `auth`.
 *
 * Las migraciones sólo usan `auth.uid()`; `auth.users` aparece únicamente en un
 * comentario. Se recrea esa función para que la base descartable pueda aplicar
 * la cadena completa sin depender del arranque de Supabase. Devuelve la
 * identidad de `request.jwt.claims`, igual que la real.
 */
const ESQUEMA_AUTH = `
CREATE SCHEMA IF NOT EXISTS auth;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
    SELECT NULLIF(
        pg_catalog.current_setting('request.jwt.claims', true)::json ->> 'sub',
        ''
    )::uuid;
$$;

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
`

console.log(`Reconstruyendo ${hasta008.length} migraciones en «${BASE_PRUEBA}».`)

// La base se recrea desde cero en cada corrida.
psql('postgres', `DROP DATABASE IF EXISTS ${BASE_PRUEBA} WITH (FORCE);`)
const creada = psql('postgres', `CREATE DATABASE ${BASE_PRUEBA};`)
if (creada.codigo !== 0) {
  console.error(creada.salida)
  console.error('FALLO  no se pudo crear la base descartable')
  process.exit(1)
}

try {
  const auth = psql(BASE_PRUEBA, ESQUEMA_AUTH)
  if (auth.codigo !== 0) {
    console.error(auth.salida)
    throw new Error('no se pudo preparar el esquema auth')
  }

  for (const archivo of hasta008) {
    const resultado = psql(BASE_PRUEBA, leerMigracion(archivo))
    if (resultado.codigo !== 0) {
      console.error(resultado.salida.slice(-2000))
      throw new Error(`la migración ${archivo} no aplicó`)
    }
  }
  afirmar(true, `001 → 008 aplican sobre una base limpia (${hasta008.length} archivos)`)

  // ================================================================
  // Siembra: exactamente los identificadores que la 009 consumía.
  // ================================================================
  const siembra = psql(
    BASE_PRUEBA,
    `INSERT INTO public.perfiles (rol_id, nombre, apellido, dni, legajo_nro)
     VALUES
       ((SELECT id FROM public.roles WHERE nombre = 'DOCENTE'),
        'Dato', 'Legitimo', '90090001', 'LEG-AUTOTEST'),
       ((SELECT id FROM public.roles WHERE nombre = 'DOCENTE'),
        'Otro', 'Legitimo', '90090002', 'LEG 2027 018');`
  )
  if (siembra.codigo !== 0) {
    console.error(siembra.salida)
    throw new Error('no se pudo sembrar la colisión')
  }
  afirmar(
    true,
    'la base contiene los DNI 90090001 y 90090002 y los legajos «LEG-AUTOTEST» y «LEG 2027 018»'
  )

  // ================================================================
  // La 009 tiene que aplicar igual.
  // ================================================================
  const primera = psql(BASE_PRUEBA, leerMigracion(la009))
  afirmar(
    primera.codigo === 0,
    `la 009 aplica sobre datos que colisionan con su propia verificación (salida ${primera.codigo})`
  )
  if (primera.codigo !== 0) console.error(primera.salida.slice(-2500))

  // Los datos sembrados siguen intactos: la migración no los tocó.
  afirmar(
    escalar(BASE_PRUEBA, `pg_catalog.count(*) FROM public.perfiles WHERE dni IN ('90090001','90090002')`) === '2',
    'los perfiles legítimos sobreviven a la migración'
  )
  afirmar(
    escalar(BASE_PRUEBA, `pg_catalog.count(*) FROM public.perfiles WHERE legajo_nro = 'LEG 2027 018'`) === '1',
    'el legajo legítimo sobrevive a la migración'
  )

  // ================================================================
  // El contrato Unicode quedó vigente sobre la tabla real.
  // ================================================================
  const CASOS = [
    ['cadena vacia', "''"],
    ['espacios ASCII', 'pg_catalog.repeat(pg_catalog.chr(32), 3)'],
    ['tabulacion', 'pg_catalog.chr(9)'],
    ['salto de linea', 'pg_catalog.chr(10)'],
    ['retorno de carro', 'pg_catalog.chr(13)'],
    ['espacio no separable solo', 'pg_catalog.chr(160)'],
    ['espacio EM solo', 'pg_catalog.chr(8195)'],
    ['ws inicial ASCII', "pg_catalog.chr(32) || 'LEG-CONTRATO'"],
    ['ws final ASCII', "'LEG-CONTRATO' || pg_catalog.chr(32)"],
    ['ws inicial no separable', "pg_catalog.chr(160) || 'LEG-CONTRATO'"],
    ['ws final EM', "'LEG-CONTRATO' || pg_catalog.chr(8195)"],
    ['ws final BOM', "'LEG-CONTRATO' || pg_catalog.chr(65279)"],
  ]

  const comprobarContrato = (etiqueta) => {
    const casos = CASOS.map(([nombre, expresion]) => `('${nombre}', ${expresion})`).join(',\n            ')
    const resultado = psql(
      BASE_PRUEBA,
      `DO $prueba$
       DECLARE
           v_caso      RECORD;
           v_perfil    UUID;
           v_aceptados TEXT := '';
       BEGIN
           FOR v_caso IN
               SELECT * FROM (VALUES
            ${casos}
               ) AS c(etiqueta, valor)
           LOOP
               BEGIN
                   INSERT INTO public.perfiles (rol_id, nombre, apellido, dni, legajo_nro)
                   VALUES ((SELECT id FROM public.roles WHERE nombre = 'DOCENTE'),
                           'Contrato', 'Unicode', '90099999', v_caso.valor)
                   RETURNING id INTO v_perfil;
                   v_aceptados := v_aceptados || v_caso.etiqueta || '; ';
                   DELETE FROM public.perfiles WHERE id = v_perfil;
               EXCEPTION WHEN check_violation THEN
                   NULL;
               END;
           END LOOP;

           IF v_aceptados <> '' THEN
               RAISE EXCEPTION 'la tabla acepta legajos invalidos: %', v_aceptados;
           END IF;
       END
       $prueba$;`
    )
    afirmar(
      resultado.codigo === 0,
      `${etiqueta}: los doce casos de espacio en blanco Unicode se rechazan`
    )
    if (resultado.codigo !== 0) console.error(resultado.salida.slice(-800))
  }

  comprobarContrato('tras la primera aplicación')

  // ================================================================
  // Idempotencia: aplicarla otra vez conserva el contrato.
  // ================================================================
  const segunda = psql(BASE_PRUEBA, leerMigracion(la009))
  afirmar(segunda.codigo === 0, `la 009 se puede volver a aplicar (salida ${segunda.codigo})`)
  if (segunda.codigo !== 0) console.error(segunda.salida.slice(-2500))

  comprobarContrato('tras la segunda aplicación')

  afirmar(
    escalar(BASE_PRUEBA, `pg_catalog.count(*) FROM public.perfiles WHERE dni IN ('90090001','90090002')`) === '2',
    'la segunda aplicación tampoco toca los datos legítimos'
  )

  // ================================================================
  // La guardia falla de verdad si la restricción queda inoperante.
  // ================================================================
  const seccion7 = leerMigracion(la009).slice(
    leerMigracion(la009).indexOf('-- 7. AUTOVERIFICACION')
  )

  const degradada = psql(
    BASE_PRUEBA,
    `BEGIN;
     ALTER TABLE public.perfiles DROP CONSTRAINT perfiles_legajo_valido;
     ALTER TABLE public.perfiles
         ADD CONSTRAINT perfiles_legajo_valido
             CHECK (
                 legajo_nro IS NULL
                 OR (
                     pg_catalog.char_length(legajo_nro) BETWEEN 1 AND 50
                     AND legajo_nro OPERATOR(pg_catalog.=) pg_catalog.btrim(legajo_nro, '')
                 )
             );
     ${seccion7}
     ROLLBACK;`
  )
  afirmar(
    degradada.codigo !== 0,
    `con la restricción vaciada, la autoverificación aborta (salida ${degradada.codigo})`
  )
  afirmar(
    degradada.salida.includes('no rechaza'),
    'y el mensaje nombra los casos que la restricción dejó pasar'
  )

  // El ROLLBACK dejó la restricción buena.
  comprobarContrato('tras revertir la degradación')
} finally {
  psql('postgres', `DROP DATABASE IF EXISTS ${BASE_PRUEBA} WITH (FORCE);`)
}

if (fallos > 0) {
  console.error(`\n${fallos} afirmación(es) incumplida(s).`)
  process.exit(1)
}
console.log('\nTodas las afirmaciones se cumplieron.')
