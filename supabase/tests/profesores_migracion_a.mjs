/**
 * EPT-58 — Aplicar la migración A sobre una base con datos previos.
 *
 * Reproduce el camino de producción: la base ya tiene perfiles de todos los
 * roles, docentes con y sin legajo y docentes a cargo de asignaciones y grupos,
 * y recién entonces se aplica A. Comprueba el backfill 1:1, que ninguna fila
 * previa cambie y que la lectura amplia de perfiles siga vigente (etapa A).
 *
 * Precondición: la base local está en la versión anterior a A.
 *
 *     npx supabase db reset --local --version 20260924225451
 *     node supabase/tests/profesores_migracion_a.mjs
 *
 * Aplica A con `supabase migration up --local`, así que al terminar la base
 * queda con A aplicada. Solo corre contra el contenedor local descartable.
 */

import { execFileSync } from 'node:child_process'

const CONTENEDOR =
  process.env.EPT_SUPABASE_DB_CONTAINER ?? 'supabase_db_educar-para-transformar'
const VERSION_A = '20260925165924'

const ID = {
  director: 'f5820000-0000-4000-8000-000000000001',
  conLegajo: 'f5820000-0000-4000-8000-000000000002',
  sinLegajo: 'f5820000-0000-4000-8000-000000000003',
  aCargo: 'f5820000-0000-4000-8000-000000000004',
  estudiante: 'f5820000-0000-4000-8000-000000000005',
  personal: 'f5820000-0000-4000-8000-000000000006',
  curso: 'f5820000-0000-4000-8000-0000000000c1',
  grupo: 'f5820000-0000-4000-8000-0000000000d1',
}
const PERFILES = Object.values(ID).slice(0, 6)
const lista = (valores) => valores.map((v) => `'${v}'`).join(',')

let fallos = 0
function afirmar(condicion, descripcion) {
  if (condicion) {
    console.log(`OK  ${descripcion}`)
    return
  }
  fallos += 1
  console.error(`FALLO  ${descripcion}`)
}

function psql(sql) {
  return execFileSync(
    'docker',
    ['exec', '-i', CONTENEDOR, 'psql', '-X', '-q', '-A', '-t', '-U', 'postgres', '-d', 'postgres',
     '-v', 'ON_ERROR_STOP=1'],
    { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  ).trim()
}

const valor = (expresion) => psql(`SELECT ${expresion};`)

// Huella de todas las filas de las tablas que A no debe tocar.
const HUELLAS = `
  SELECT pg_catalog.md5(COALESCE(pg_catalog.string_agg(
           pg_catalog.concat_ws('|', id, user_id, rol_id, nombre, apellido, dni, direccion,
                                telefono, legajo_nro, fecha_nacimiento), ';' ORDER BY id), ''))
  FROM public.perfiles
  UNION ALL
  SELECT pg_catalog.md5(COALESCE(pg_catalog.string_agg(
           pg_catalog.concat_ws('|', id, materia_id, curso_id, profesor_id, activo,
                                fecha_creacion, fecha_actualizacion), ';' ORDER BY id), ''))
  FROM public.materias_cursos
  UNION ALL
  SELECT pg_catalog.md5(COALESCE(pg_catalog.string_agg(
           pg_catalog.concat_ws('|', id, deporte_id, nivel_id, nombre, cupo, profesor_id, activo,
                                fecha_creacion, fecha_actualizacion), ';' ORDER BY id), ''))
  FROM public.grupos_deportivos;`

// 1. Precondición: A todavía no está aplicada.
const aplicada = valor(
  `(SELECT pg_catalog.count(*) FROM supabase_migrations.schema_migrations WHERE version = '${VERSION_A}')`
)
if (aplicada !== '0' || valor(`pg_catalog.to_regclass('public.profesores') IS NULL`) !== 't') {
  console.error(
    'FALLO  la migración A ya está aplicada. Llevá la base a la versión anterior con:\n' +
      '       npx supabase db reset --local --version 20260924225451'
  )
  process.exit(1)
}
console.log('OK  la base local está en la versión anterior a A')

// 2. Datos previos, confirmados como en producción.
psql(`
  BEGIN;
  INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni, legajo_nro)
  SELECT v.id::uuid, v.id::uuid, r.id, v.nombre, v.apellido, v.dni, v.legajo
  FROM (VALUES
    ('${ID.director}',   'DIRECTOR',   'Dora',   'Dirección Previa', '95820001', NULL),
    ('${ID.conLegajo}',  'DOCENTE',    'Lía',    'Con Legajo',       '95820002', 'LEG-EPT58-PREVIO-1'),
    ('${ID.sinLegajo}',  'DOCENTE',    'Saúl',   'Sin Legajo',       '95820003', NULL),
    ('${ID.aCargo}',     'DOCENTE',    'Ana',    'A Cargo',          '95820004', 'LEG-EPT58-PREVIO-2'),
    ('${ID.estudiante}', 'ESTUDIANTE', 'Eva',    'Estudiante Previa','95820005', 'LEG-EPT58-PREVIO-3'),
    ('${ID.personal}',   'PERSONAL',   'Pía',    'Personal Previo',  '95820006', NULL)
  ) AS v(id, rol, nombre, apellido, dni, legajo)
  JOIN public.roles r ON r.nombre = v.rol;
  INSERT INTO public.cursos (id, nivel_id, denominacion, division, activo)
  VALUES ('${ID.curso}', (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'),
          'Curso previo EPT58', 'A', TRUE);
  INSERT INTO public.grupos_deportivos (id, deporte_id, nivel_id, nombre, cupo, profesor_id)
  VALUES ('${ID.grupo}', 'e0000000-0000-4000-8000-000000000101',
          (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'), 'Grupo previo EPT58', 10, '${ID.aCargo}');
  SET LOCAL ROLE authenticated;
  SELECT set_config('request.jwt.claims', '{"sub":"${ID.director}"}', true);
  SELECT public.asignar_materia_curso((public.crear_materia('Materia previa EPT58')).id,
                                      '${ID.curso}', '${ID.aCargo}');
  COMMIT;`)
console.log('OK  datos previos sembrados: docentes con y sin legajo, a cargo de una materia y un grupo')

const huellasAntes = psql(HUELLAS)
const docentesAntes = psql(`
  SELECT pg_catalog.string_agg(p.id::TEXT, ',' ORDER BY p.id)
  FROM public.perfiles p JOIN public.roles r ON r.id = p.rol_id WHERE r.nombre = 'DOCENTE';`)
const cantidadDocentes = docentesAntes.split(',').filter(Boolean).length

// 3. Aplicar A exactamente como se aplicaría una migración pendiente.
// `execFileSync` lanza si el comando termina con un código distinto de 0.
execFileSync('npx', ['supabase', 'migration', 'up', '--local'], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
  stdio: ['ignore', 'pipe', 'pipe'],
})
console.log('OK  `supabase migration up --local` terminó con código 0')
afirmar(
  valor(`(SELECT pg_catalog.count(*) FROM supabase_migrations.schema_migrations WHERE version = '${VERSION_A}')`) === '1',
  'A quedó registrada en el historial local de migraciones'
)

// 4. Backfill 1:1 solo de DOCENTE, ACTIVO, sin datos inventados.
const fichas = psql(`
  SELECT pg_catalog.string_agg(pr.perfil_id::TEXT, ',' ORDER BY pr.perfil_id) FROM public.profesores pr;`)
afirmar(fichas === docentesAntes, `una ficha por cada uno de los ${cantidadDocentes} perfil(es) DOCENTE previos`)
afirmar(
  valor(`(SELECT pg_catalog.count(*) FROM public.profesores WHERE estado <> 'ACTIVO' OR especialidad IS NOT NULL)`) === '0',
  'todas las fichas nacen ACTIVO y sin especialidad inventada'
)
afirmar(
  valor(`(SELECT pg_catalog.count(*) FROM public.profesores WHERE perfil_id IN (${lista([ID.director, ID.estudiante, ID.personal])}))`) === '0',
  'ningún perfil DIRECTOR, ESTUDIANTE o PERSONAL recibió ficha'
)
afirmar(
  valor(`(SELECT pg_catalog.count(*) FROM public.profesores_estados_historial)`) === '0',
  'el historial nace vacío'
)
afirmar(
  valor(`(SELECT legajo_nro IS NULL FROM public.perfiles WHERE id = '${ID.sinLegajo}')`) === 't',
  'al docente sin legajo no se le inventa uno (ficha incompleta)'
)

// 5. Ninguna fila previa cambió.
afirmar(psql(HUELLAS) === huellasAntes, 'perfiles, materias_cursos y grupos_deportivos conservan huella idéntica')
afirmar(
  valor(`(SELECT pg_catalog.count(*) FROM public.materias_cursos WHERE profesor_id = '${ID.aCargo}' AND activo)
         + (SELECT pg_catalog.count(*) FROM public.grupos_deportivos WHERE profesor_id = '${ID.aCargo}' AND activo)`) === '2',
  'la asignación y el grupo del docente a cargo siguen vigentes'
)

// 6. La etapa A no cambia la lectura de perfiles de la aplicación publicada.
afirmar(
  valor(`EXISTS (SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname = 'public'
         AND tablename = 'perfiles' AND policyname = 'Directores y docentes ven todos los perfiles')`) === 't',
  'la política «Directores y docentes ven todos los perfiles» sigue vigente'
)
const vistosPorDocente = psql(`
  BEGIN;
  SET LOCAL ROLE authenticated;
  SELECT set_config('request.jwt.claims', '{"sub":"${ID.conLegajo}"}', true) \\g /dev/null
  SELECT pg_catalog.count(*) FROM public.perfiles;
  ROLLBACK;`)
afirmar(
  vistosPorDocente === valor('(SELECT pg_catalog.count(*) FROM public.perfiles)'),
  'un DOCENTE sigue leyendo todos los perfiles, como antes de A'
)

// 7. Limpieza del fixture sembrado (sin historial: A no escribió ninguno).
psql(`
  BEGIN;
  DELETE FROM public.materias_cursos WHERE curso_id = '${ID.curso}';
  DELETE FROM public.grupos_deportivos WHERE id = '${ID.grupo}';
  DELETE FROM public.actividades WHERE nombre = 'Materia previa EPT58' AND tipo = 'CURRICULAR';
  DELETE FROM public.profesores WHERE perfil_id IN (${lista(PERFILES)});
  DELETE FROM public.alumnos WHERE perfil_id IN (${lista(PERFILES)});
  DELETE FROM public.perfiles WHERE id IN (${lista(PERFILES)});
  DELETE FROM public.cursos WHERE id = '${ID.curso}';
  COMMIT;`)
afirmar(
  valor(`(SELECT pg_catalog.count(*) FROM public.perfiles WHERE id IN (${lista(PERFILES)}))`) === '0',
  'fixture eliminado sin residuos'
)

if (fallos > 0) {
  console.error(`\n${fallos} afirmación(es) incumplida(s).`)
  process.exit(1)
}
console.log('\nTodas las afirmaciones se cumplieron.')
