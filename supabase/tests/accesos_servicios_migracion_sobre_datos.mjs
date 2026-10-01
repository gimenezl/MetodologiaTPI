import { execFileSync } from 'node:child_process'

/**
 * La migración de EPT-65 es aditiva y se aplica sobre datos existentes (RF21).
 *
 * Reproduce lo que hará el despliegue: lleva la base local descartable a la migración ANTERIOR
 * (EPT-64), siembra datos funcionales reales del modelo (personas, alumnos, matrículas,
 * inscripciones a comedor y transporte, credenciales QR), saca una huella de TODAS las tablas de
 * `public`, aplica SOLO la migración pendiente con `supabase migration up` y vuelve a sacar la huella.
 *
 * Demuestra que:
 *   1. ninguna tabla preexistente cambió ni una fila (misma cantidad y mismo MD5 del contenido);
 *   2. las tablas nuevas existen y están vacías;
 *   3. el ledger quedó con la migración nueva como última y sin huecos;
 *   4. la operación privilegiada quedó cerrada a los roles de aplicación.
 *
 * SOLO contra la base local descartable: el script resetea la base. Se niega a correr si el
 * contenedor o el directorio de trabajo no son los esperados.
 *
 *     EPT_SUPABASE_WORKDIR=E:/Escritorio/codigo/_sb-ept65 \
 *       node supabase/tests/accesos_servicios_migracion_sobre_datos.mjs
 */

const DIRECTORIO = process.env.EPT_SUPABASE_WORKDIR
const CONTENEDOR = process.env.EPT_SUPABASE_DB_CONTAINER ?? 'supabase_db_ept65'
const ANTERIOR = '20260929224534'
const NUEVA = '20261001012522'
const CORRECTIVA = '20261001165229'
const TABLAS_NUEVAS = ['accesos_servicios', 'anulaciones_accesos_servicios']

if (!DIRECTORIO) {
  console.error('FALLO  hay que indicar EPT_SUPABASE_WORKDIR: este script resetea la base local.')
  process.exit(1)
}
if (!/^supabase_db_/u.test(CONTENEDOR)) {
  console.error('FALLO  el contenedor de base de datos no es de Supabase local.')
  process.exit(1)
}

let fallos = 0
function afirmar(condicion, descripcion) {
  if (condicion) console.log(`OK  ${descripcion}`)
  else {
    fallos += 1
    console.error(`FALLO  ${descripcion}`)
  }
}

function cli(argumentos) {
  return execFileSync('npx', ['supabase', ...argumentos, '--workdir', DIRECTORIO], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024,
  })
}

function psql(entrada) {
  return execFileSync(
    'docker',
    ['exec', '-i', CONTENEDOR, 'psql', '-X', '-q', '-t', '-A', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
    { input: entrada, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  )
}

const uuid = (n) => `ea650003-0000-4000-8000-${String(n).padStart(12, '0')}`

/** Huella de cada tabla de `public` (excepto las nuevas): filas y MD5 de su contenido. */
function huellas() {
  const salida = psql(`
    SELECT pg_catalog.format(
      'SELECT %L AS tabla, pg_catalog.count(*) AS filas, pg_catalog.md5(COALESCE(pg_catalog.string_agg(t::TEXT, ''|'' ORDER BY t::TEXT), '''')) AS huella FROM public.%I t',
      c.relname, c.relname)
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND c.relname NOT IN (${TABLAS_NUEVAS.map((t) => `'${t}'`).join(', ')})
    ORDER BY c.relname
    \\gexec
  `)
  const mapa = new Map()
  for (const linea of salida.split(/\r?\n/u).filter(Boolean)) {
    const [tabla, filas, huella] = linea.split('|')
    mapa.set(tabla, { filas: Number(filas), huella })
  }
  return mapa
}

const SIEMBRA = `
  BEGIN;
  INSERT INTO public.cursos (id, nivel_id, denominacion, division, activo)
  VALUES ('${uuid(1)}', (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO' LIMIT 1), 'MIGRACIÓN EPT-65', 'A', TRUE);
  INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni)
  VALUES ('${uuid(10)}', '${uuid(10)}', (SELECT id FROM public.roles WHERE nombre = 'DIRECTOR'), 'Directora', 'Migración', '98650010'),
         ('${uuid(11)}', '${uuid(11)}', (SELECT id FROM public.roles WHERE nombre = 'PERSONAL'), 'Personal', 'Migración', '98650011');
  INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni, legajo_nro)
  VALUES ('${uuid(20)}', '${uuid(20)}', (SELECT id FROM public.roles WHERE nombre = 'ESTUDIANTE'), 'Alumno', 'Uno Migración', '98650020', 'LEG-MIG65-20'),
         ('${uuid(21)}', '${uuid(21)}', (SELECT id FROM public.roles WHERE nombre = 'ESTUDIANTE'), 'Alumno', 'Dos Migración', '98650021', 'LEG-MIG65-21'),
         ('${uuid(22)}', '${uuid(22)}', (SELECT id FROM public.roles WHERE nombre = 'ESTUDIANTE'), 'Alumno', 'Tres Migración', '98650022', 'LEG-MIG65-22');
  INSERT INTO public.matriculas (alumno_id, curso_id)
  VALUES ('${uuid(20)}', '${uuid(1)}'), ('${uuid(21)}', '${uuid(1)}'), ('${uuid(22)}', '${uuid(1)}');
  UPDATE public.alumnos SET estado = 'ACTIVO' WHERE perfil_id IN ('${uuid(20)}', '${uuid(21)}', '${uuid(22)}');
  INSERT INTO public.inscripciones_servicios (alumno_id, servicio_id)
  VALUES ('${uuid(20)}', 'e0000000-0000-4000-8000-000000000010'),
         ('${uuid(20)}', 'e0000000-0000-4000-8000-000000000020'),
         ('${uuid(21)}', 'e0000000-0000-4000-8000-000000000010');
  INSERT INTO public.credenciales_qr (id, alumno_id, clave_kid, emitida_por)
  VALUES ('${uuid(30)}', '${uuid(20)}', 'k1', '${uuid(10)}'),
         ('${uuid(31)}', '${uuid(21)}', 'k1', '${uuid(10)}');
  COMMIT;
`

console.log(`1. Reset de la base local hasta la migración anterior (${ANTERIOR}).`)
cli(['db', 'reset', '--version', ANTERIOR, '--no-seed'])
afirmar(
  psql(`SELECT pg_catalog.to_regclass('public.credenciales_qr') IS NOT NULL AND pg_catalog.to_regclass('public.accesos_servicios') IS NULL;`).trim() === 't',
  'la base parte con EPT-64 y SIN las tablas de EPT-65'
)

console.log('2. Siembra de datos funcionales sintéticos.')
psql(SIEMBRA)

const antes = huellas()
afirmar(antes.size > 20, `se tomó la huella de ${antes.size} tablas de public`)
afirmar(
  (antes.get('perfiles')?.filas ?? 0) >= 5 &&
    (antes.get('credenciales_qr')?.filas ?? 0) === 2 &&
    (antes.get('inscripciones_servicios')?.filas ?? 0) === 3,
  'la siembra dejó personas, alumnos, inscripciones y credenciales'
)

console.log(`3. Se aplican SOLO las migraciones pendientes (${NUEVA} y ${CORRECTIVA}) con «supabase migration up».`)
const salida = cli(['migration', 'up', '--local'])
afirmar(
  salida.includes(NUEVA) && salida.includes(CORRECTIVA) && !salida.includes('20260929224534_ept_64'),
  'migration up aplicó únicamente las dos migraciones de EPT-65'
)

const despues = huellas()
afirmar(despues.size === antes.size, 'las mismas tablas preexistentes antes y después')
const distintas = [...antes.entries()].filter(([tabla, h]) => {
  const d = despues.get(tabla)
  return !d || d.filas !== h.filas || d.huella !== h.huella
})
afirmar(
  distintas.length === 0,
  `ninguna tabla preexistente cambió (${antes.size} comparadas por cantidad y MD5 del contenido)` +
    (distintas.length ? `: ${distintas.map(([t]) => t).join(', ')}` : '')
)

console.log('4. Estado posterior.')
afirmar(
  psql(`SELECT ${TABLAS_NUEVAS.map((t) => `(SELECT pg_catalog.count(*) FROM public.${t})`).join(' + ')};`).trim() === '0',
  'las tablas nuevas existen y están vacías'
)
const ledger = psql(`SELECT pg_catalog.string_agg(version, ',' ORDER BY version) FROM supabase_migrations.schema_migrations;`).trim().split(',')
afirmar(ledger.at(-1) === CORRECTIVA && ledger.includes(NUEVA) && ledger.includes(ANTERIOR), `el ledger termina en ${CORRECTIVA} y conserva ${NUEVA} y ${ANTERIOR}`)
afirmar(new Set(ledger).size === ledger.length && ledger.length === 27, `el ledger tiene 27 versiones sin duplicados (tiene ${ledger.length})`)
afirmar(
  psql(`
    SELECT NOT pg_catalog.has_function_privilege('authenticated', 'public.registrar_acceso_servicio(uuid,uuid,uuid,text,uuid,public.sentido_acceso_transporte)'::pg_catalog.regprocedure, 'EXECUTE')
       AND NOT pg_catalog.has_function_privilege('anon', 'public.registrar_acceso_servicio(uuid,uuid,uuid,text,uuid,public.sentido_acceso_transporte)'::pg_catalog.regprocedure, 'EXECUTE')
       AND pg_catalog.has_function_privilege('service_role', 'public.registrar_acceso_servicio(uuid,uuid,uuid,text,uuid,public.sentido_acceso_transporte)'::pg_catalog.regprocedure, 'EXECUTE');
  `).trim() === 't',
  'la operación privilegiada quedó solo para service_role tras aplicar sobre datos'
)

console.log(`5. La migración CORRECTIVA (${CORRECTIVA}) sobre una base donde la original (${NUEVA}) YA registró accesos.`)
// Es el escenario del despliegue si la migración original llegó a aplicarse: hay eventos,
// una anulación y una denegación reales que la corrección no puede tocar.
cli(['db', 'reset', '--version', NUEVA, '--no-seed'])
afirmar(
  psql(`SELECT pg_catalog.to_regprocedure('public.registrar_acceso_servicio(uuid,uuid,uuid,uuid,public.sentido_acceso_transporte)') IS NOT NULL;`).trim() === 't',
  'la base parte con la migración original (firma de cinco argumentos) y SIN la correctiva'
)
psql(SIEMBRA)
psql(`
  INSERT INTO public.credenciales_qr (id, alumno_id, clave_kid, emitida_por)
  VALUES ('${uuid(32)}', '${uuid(22)}', 'k1', '${uuid(10)}');
`)
const COMEDOR_ID = 'e0000000-0000-4000-8000-000000000010'
const escanearOriginal = (credencial) =>
  psql(`SELECT codigo_resultado FROM public.registrar_acceso_servicio('${uuid(11)}', pg_catalog.gen_random_uuid(), '${credencial}', '${COMEDOR_ID}', NULL);`).trim()
afirmar(escanearOriginal(uuid(30)) === 'REGISTRADO', 'la original registra el acceso del alumno uno')
afirmar(escanearOriginal(uuid(31)) === 'REGISTRADO', 'la original registra el acceso del alumno dos')
afirmar(escanearOriginal(uuid(32)) === 'NO_HABILITADO', 'la original deniega al alumno tres (sin inscripción) y persiste la denegación')
// Dirección no lee la tabla (por diseño): el id lo resuelve el propietario.
const eventoAnulado = psql(`SELECT id FROM public.accesos_servicios WHERE credencial_id = '${uuid(31)}' AND resultado = 'REGISTRADO';`).trim()
psql(`
  SET ROLE authenticated;
  SELECT pg_catalog.set_config('request.jwt.claims', '{"sub":"${uuid(10)}"}', false);
  SELECT public.anular_acceso_servicio('${eventoAnulado}', 'Anulación de la prueba de migración');
`)

const FILAS_DE_EVENTOS = `
  SELECT 'accesos' AS t, pg_catalog.count(*) AS filas, pg_catalog.md5(COALESCE(pg_catalog.string_agg(x::TEXT, '|' ORDER BY x::TEXT), '')) FROM public.accesos_servicios x
  UNION ALL SELECT 'anulaciones', pg_catalog.count(*), pg_catalog.md5(COALESCE(pg_catalog.string_agg(x::TEXT, '|' ORDER BY x::TEXT), '')) FROM public.anulaciones_accesos_servicios x
  UNION ALL SELECT 'contadores', pg_catalog.count(*), pg_catalog.md5(COALESCE(pg_catalog.string_agg(x::TEXT, '|' ORDER BY x::TEXT), '')) FROM app_private.contadores_escaneo x`
const eventosAntes = psql(`${FILAS_DE_EVENTOS};`).trim()
afirmar(/accesos\|3\|/u.test(eventosAntes) && /anulaciones\|1\|/u.test(eventosAntes), 'antes de corregir hay 3 eventos (2 REGISTRADO y 1 DENEGADO) y 1 anulación')

const salidaCorrectiva = cli(['migration', 'up', '--local'])
afirmar(
  salidaCorrectiva.includes(CORRECTIVA) && !salidaCorrectiva.includes(NUEVA),
  'migration up aplicó únicamente la migración correctiva'
)
afirmar(
  psql(`${FILAS_DE_EVENTOS};`).trim() === eventosAntes,
  'la corrección no cambió ni una fila de eventos, anulaciones ni contadores (cantidad y MD5 idénticos)'
)
afirmar(
  psql(`SELECT pg_catalog.to_regprocedure('public.registrar_acceso_servicio(uuid,uuid,uuid,uuid,public.sentido_acceso_transporte)') IS NULL
          AND pg_catalog.to_regprocedure('app_private.registrar_acceso_servicio(uuid,uuid,uuid,uuid,public.sentido_acceso_transporte)') IS NULL;`).trim() === 't',
  'las firmas de la original sin kid desaparecieron'
)
const escanearCorregido = (credencial, kid) =>
  psql(`SELECT codigo_resultado FROM public.registrar_acceso_servicio('${uuid(11)}', pg_catalog.gen_random_uuid(), '${credencial}', '${kid}', '${COMEDOR_ID}', NULL);`).trim()
afirmar(escanearCorregido(uuid(30), 'k9') === 'NO_RECONOCIDO', 'con un kid que no es el de la credencial: NO_RECONOCIDO')
afirmar(
  psql(`SELECT pg_catalog.count(*) FROM public.accesos_servicios;`).trim() === '3',
  'un kid que no corresponde no dejó ningún evento'
)
afirmar(escanearCorregido(uuid(30), 'k1') === 'YA_REGISTRADO', 'con el kid correcto el acceso ya registrado sigue siendo YA_REGISTRADO')
afirmar(escanearCorregido(uuid(31), 'k1') === 'REGISTRADO', 'el acceso anulado antes de corregir libera el cupo: se vuelve a registrar')
afirmar(
  psql(`SELECT solicitudes_maximas || '/' || ventana_solicitudes || '/' || bloqueo_solicitudes || ' ' || invalidos_maximos || '/' || ventana_invalidos || '/' || bloqueo_invalidos FROM app_private.parametros_limite_escaneo();`).trim() ===
    '150/00:05:00/00:02:00 10/00:10:00/00:15:00',
  'los límites aprobados quedaron en 150/5 min con bloqueo de 2 min y 10/10 min con bloqueo de 15 min'
)

console.log('6. Limpieza: la base vuelve al estado de las migraciones, sin los datos sembrados.')
cli(['db', 'reset', '--no-seed'])
afirmar(psql(`SELECT pg_catalog.count(*) FROM public.perfiles WHERE dni LIKE '9865%';`).trim() === '0', 'la base quedó sin los datos de la prueba')

if (fallos > 0) {
  console.error(`\n${fallos} afirmación(es) fallaron.`)
  process.exit(1)
}
console.log('\nTodas las afirmaciones se cumplieron.')
