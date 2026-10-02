import { readFileSync } from 'node:fs'
import { SesionPsql } from './_sesion-psql.mjs'

/**
 * Migración 30 (asistencias por vínculo vigente) sobre datos existentes (EPT-66 D).
 *
 * Siembra asistencias con las formas que puede haber en una base real —con y
 * sin registrante, de alumnos con y sin vínculo, y una sin alumno— sobre el
 * esquema 29, aplica la migración que se le pasa por argumento y comprueba que:
 *
 *   · el conteo y la huella del contenido son los mismos (la migración no
 *     modifica ningún dato);
 *   · cada fila conserva sus relaciones (alumno y registrante en `perfiles`);
 *   · tras migrar, Dirección sigue viendo todas, un DOCENTE solo las de su
 *     alumno vinculado, y el registrante de las filas existentes no cambió.
 *
 * Solo se informan agregados: ninguna identidad ni dato personal.
 *
 * Uso (la base debe estar en el esquema 29, anterior a la migración):
 *
 *     EPT_SUPABASE_DB_CONTAINER=supabase_db_<proyecto> \
 *       node supabase/tests/asistencias_migracion_sobre_datos.mjs \
 *       supabase/migrations/<migración 30>.sql
 */

const migraciones = process.argv.slice(2)
if (migraciones.length === 0) {
  console.error('FALLO: indicá la migración que se aplica.')
  process.exit(2)
}

const ID = {
  director: 'a66d7000-0000-4000-8000-000000000001',
  docente: 'a66d7000-0000-4000-8000-000000000002',
  otroDocente: 'a66d7000-0000-4000-8000-000000000003',
  vinculado: 'a66d7000-0000-4000-8000-000000000011',
  ajeno: 'a66d7000-0000-4000-8000-000000000012',
  curso: 'a66d7000-0000-4000-8000-0000000000c1',
}
const PERFILES = Object.values(ID).filter((id) => id !== ID.curso)

const FILAS = [
  // [id, alumno, fecha, estado, registrante]
  ['a66d7000-0000-4000-8000-0000000000a1', ID.vinculado, '2031-12-01', 'PRESENTE', ID.docente],
  ['a66d7000-0000-4000-8000-0000000000a2', ID.vinculado, '2031-12-02', 'AUSENTE', ID.director],
  ['a66d7000-0000-4000-8000-0000000000a3', ID.ajeno, '2031-12-01', 'JUSTIFICADO', ID.otroDocente],
  ['a66d7000-0000-4000-8000-0000000000a4', ID.ajeno, '2031-12-02', 'PRESENTE', null],
  ['a66d7000-0000-4000-8000-0000000000a5', null, '2031-12-03', 'PRESENTE', ID.docente],
]
const IDS_FILAS = FILAS.map(([id]) => `'${id}'`).join(', ')

const huella = `
  SELECT pg_catalog.count(*)::text || '|' || pg_catalog.md5(COALESCE(pg_catalog.string_agg(
    pg_catalog.concat_ws(',', a.id, a.estudiante_id, a.fecha, a.estado, a.docente_id),
    ';' ORDER BY a.id), ''))
  FROM public.asistencias a`

const relaciones = `
  SELECT pg_catalog.count(*)::text
  FROM public.asistencias a
  LEFT JOIN public.perfiles e ON e.id = a.estudiante_id
  LEFT JOIN public.perfiles d ON d.id = a.docente_id
  WHERE (a.estudiante_id IS NULL OR e.id IS NOT NULL) AND (a.docente_id IS NULL OR d.id IS NOT NULL)`

const registrantes = `
  SELECT COALESCE(pg_catalog.string_agg(COALESCE(right(a.docente_id::text, 2), '-'), ',' ORDER BY a.id), '')
  FROM public.asistencias a WHERE a.id IN (${IDS_FILAS})`

const sesion = new SesionPsql('M', 'EPT66D')
const limpiar = () =>
  sesion.ejecutar(
    `RESET ROLE;
     BEGIN;
     DELETE FROM public.asistencias WHERE id IN (${IDS_FILAS});
     DELETE FROM public.materias_cursos WHERE curso_id = '${ID.curso}';
     DELETE FROM public.actividades WHERE tipo = 'CURRICULAR' AND nombre = 'Materia migración EPT66D';
     DELETE FROM public.matriculas WHERE alumno_id IN ('${ID.vinculado}', '${ID.ajeno}');
     DELETE FROM public.alumnos WHERE perfil_id IN ('${ID.vinculado}', '${ID.ajeno}');
     DELETE FROM public.profesores WHERE perfil_id IN (${PERFILES.map((id) => `'${id}'`).join(', ')});
     DELETE FROM public.perfiles WHERE id IN (${PERFILES.map((id) => `'${id}'`).join(', ')});
     DELETE FROM public.cursos WHERE id = '${ID.curso}';
     COMMIT;`,
    'limpiar'
  )

function afirmar(condicion, mensaje) {
  if (!condicion) throw new Error(mensaje)
}

async function comoActor(sub, expresion, etiqueta) {
  await sesion.ejecutar(
    `SET ROLE authenticated; SELECT set_config('request.jwt.claims', '{"sub":"${sub}"}', false);`,
    `como_${etiqueta}`
  )
  try {
    return await sesion.escalar(expresion, etiqueta)
  } finally {
    await sesion.ejecutar('RESET ROLE;', `fin_${etiqueta}`)
  }
}

try {
  await limpiar()
  await sesion.ejecutar(
    `BEGIN;
     INSERT INTO public.cursos (id, nivel_id, denominacion, division, activo)
     VALUES ('${ID.curso}', (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'), 'MIGRACION EPT66D', 'A', TRUE);
     INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni, legajo_nro)
     SELECT v.id, v.id, r.id, 'Prueba', v.apellido, v.dni, v.legajo
     FROM (VALUES
       ('${ID.director}'::uuid,    'DIRECTOR',   'Directora M', '96670001', NULL),
       ('${ID.docente}'::uuid,     'DOCENTE',    'Docente M',   '96670002', NULL),
       ('${ID.otroDocente}'::uuid, 'DOCENTE',    'Otro M',      '96670003', NULL),
       ('${ID.vinculado}'::uuid,   'ESTUDIANTE', 'Vinculado M', '96670011', 'LEG-66D-M1'),
       ('${ID.ajeno}'::uuid,       'ESTUDIANTE', 'Ajeno M',     '96670012', 'LEG-66D-M2')
     ) AS v(id, rol, apellido, dni, legajo)
     JOIN public.roles r ON r.nombre = v.rol;
     -- Solo el alumno vinculado se matricula: el ajeno queda INACTIVO y sin curso.
     INSERT INTO public.matriculas (alumno_id, curso_id) VALUES ('${ID.vinculado}', '${ID.curso}');
     UPDATE public.alumnos SET estado = 'ACTIVO' WHERE perfil_id = '${ID.vinculado}';
     ${FILAS.map(
       ([id, alumno, fecha, estado, registrante]) =>
         `INSERT INTO public.asistencias (id, estudiante_id, fecha, estado, docente_id)
          VALUES ('${id}', ${alumno ? `'${alumno}'` : 'NULL'}, '${fecha}', '${estado}', ${registrante ? `'${registrante}'` : 'NULL'});`
     ).join('\n     ')}
     COMMIT;`,
    'sembrar'
  )

  const antes = await sesion.escalar(`(${huella})`, 'huella_antes')
  const relacionesAntes = await sesion.escalar(`(${relaciones})`, 'relaciones_antes')
  const registrantesAntes = await sesion.escalar(`(${registrantes})`, 'registrantes_antes')
  const [conteoAntes] = antes.split('|')
  afirmar(Number(conteoAntes) >= FILAS.length, `Se esperaban al menos ${FILAS.length} asistencias y hay ${conteoAntes}`)
  console.log(`ANTES: ${conteoAntes} asistencia(s), ${relacionesAntes} con sus relaciones íntegras`)

  // Con las políticas «Staff» vigentes, un DOCENTE ve todas las filas sembradas (esquema 29).
  const veAntes = await comoActor(
    ID.docente,
    `(SELECT pg_catalog.count(*) FROM public.asistencias WHERE id IN (${IDS_FILAS}))`,
    'docente_antes'
  )
  afirmar(veAntes === String(FILAS.length), `En el esquema 29 el DOCENTE debía ver las ${FILAS.length} filas y vio ${veAntes}`)

  for (const archivo of migraciones) {
    const sql = readFileSync(archivo, 'utf8')
    await sesion.ejecutar(`BEGIN;\n${sql}\nCOMMIT;`, `aplicar_${archivo.split('/').pop()}`)
    const despues = await sesion.escalar(`(${huella})`, 'huella_despues')
    const relacionesDespues = await sesion.escalar(`(${relaciones})`, 'relaciones_despues')
    const registrantesDespues = await sesion.escalar(`(${registrantes})`, 'registrantes_despues')
    afirmar(despues === antes, `Tras ${archivo} cambió el contenido o el conteo: antes ${antes} · después ${despues}`)
    afirmar(relacionesDespues === relacionesAntes, `Tras ${archivo} se perdieron relaciones`)
    afirmar(registrantesDespues === registrantesAntes, `Tras ${archivo} cambió algún registrante: ${registrantesAntes} → ${registrantesDespues}`)
    console.log(`OK ${archivo.split('/').pop()}: mismo conteo (${conteoAntes}), misma huella, ${relacionesDespues} relaciones íntegras y registrantes intactos`)
  }

  const veDirector = await comoActor(
    ID.director,
    `(SELECT pg_catalog.count(*) FROM public.asistencias WHERE id IN (${IDS_FILAS}))`,
    'director_despues'
  )
  afirmar(veDirector === String(FILAS.length), `Dirección debía seguir viendo las ${FILAS.length} filas y vio ${veDirector}`)
  console.log(`OK Dirección conserva el acceso global tras migrar (${veDirector}/${FILAS.length})`)

  // Sin vínculo, el DOCENTE ya no ve ninguna de las filas existentes.
  const veSinVinculo = await comoActor(
    ID.docente,
    `(SELECT pg_catalog.count(*) FROM public.asistencias WHERE id IN (${IDS_FILAS}))`,
    'docente_sin_vinculo'
  )
  afirmar(veSinVinculo === '0', `Sin vínculo el DOCENTE debía ver 0 filas y vio ${veSinVinculo}`)

  // Con una materia en el curso del alumno vinculado, solo ve las filas de ese alumno.
  await sesion.ejecutar(
    `SET ROLE authenticated;
     SELECT set_config('request.jwt.claims', '{"sub":"${ID.director}"}', false);
     SELECT (public.crear_materia('Materia migración EPT66D')).id;
     SELECT (public.asignar_materia_curso((SELECT id FROM public.materias WHERE nombre = 'Materia migración EPT66D'),
                                          '${ID.curso}', '${ID.docente}')).id;
     RESET ROLE;`,
    'vincular'
  )
  const veVinculado = await comoActor(
    ID.docente,
    `(SELECT pg_catalog.count(*) FROM public.asistencias WHERE id IN (${IDS_FILAS}) AND estudiante_id = '${ID.vinculado}')`,
    'docente_vinculado'
  )
  const veTotal = await comoActor(
    ID.docente,
    `(SELECT pg_catalog.count(*) FROM public.asistencias WHERE id IN (${IDS_FILAS}))`,
    'docente_total'
  )
  afirmar(veVinculado === '2' && veTotal === '2', `El DOCENTE vinculado debía ver 2 de ${FILAS.length} filas y vio ${veVinculado}/${veTotal}`)
  console.log(`OK un DOCENTE con vínculo ve solo las ${veTotal} filas de su alumno (de ${FILAS.length}); sin vínculo, 0`)

  await limpiar()
  const restos = await sesion.escalar(`(SELECT pg_catalog.count(*) FROM public.perfiles WHERE id IN (${PERFILES.map((id) => `'${id}'`).join(', ')}))`, 'restos')
  afirmar(restos === '0', `Quedaron ${restos} perfiles sintéticos`)
  console.log('OK: las asistencias existentes sobreviven a la migración 30 sin pérdida de conteo, contenido, relaciones ni registrante')
} catch (error) {
  console.error(`FALLO: ${error.message}`)
  process.exitCode = 1
  await limpiar().catch(() => {})
} finally {
  await sesion.cerrar()
}
