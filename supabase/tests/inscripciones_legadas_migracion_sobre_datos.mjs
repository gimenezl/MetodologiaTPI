import { readFileSync } from 'node:fs'
import { SesionPsql } from './_sesion-psql.mjs'

/**
 * Migración sobre datos legados (EPT-66).
 *
 * Siembra tres inscripciones legadas (dos activas y una baja, como las tres
 * filas que existen en producción), aplica las migraciones que se le pasan por
 * argumento —en orden— y comprueba que, tras cada una:
 *
 *   · el conteo de filas es el mismo;
 *   · el contenido (id, alumno, actividad, estado y fecha de inscripción) tiene
 *     la misma huella;
 *   · cada fila conserva sus relaciones (alumno en `perfiles`, actividad en
 *     `actividades`);
 *   · las filas sembradas siguen leyéndose por sus identificadores.
 *
 * Solo se informan agregados: ninguna identidad ni dato personal.
 *
 * Uso (la base debe estar en el estado ANTERIOR a las migraciones que se pasan):
 *
 *     EPT_PSQL_CONEXION="-h 127.0.0.1 -p 54399 -U postgres -d ept_prueba" \
 *       node supabase/tests/inscripciones_legadas_migracion_sobre_datos.mjs \
 *       supabase/migrations/<expansion>.sql [supabase/migrations/<contraccion>.sql]
 *
 * Con la expansión sola o con expansión + contracción, según los argumentos.
 */

const migraciones = process.argv.slice(2)
if (migraciones.length === 0) {
  console.error('FALLO: indicá al menos una migración para aplicar, en orden.')
  process.exit(2)
}

const ALUMNO_1 = 'e6600000-0000-4000-8000-000000000001'
const ALUMNO_2 = 'e6600000-0000-4000-8000-000000000002'
const ALUMNO_3 = 'e6600000-0000-4000-8000-000000000003'
const ACTIVIDAD_1 = 96621
const ACTIVIDAD_2 = 96622
const FILAS = [
  ['e6600000-0000-4000-8000-0000000000a1', ALUMNO_1, ACTIVIDAD_1, 'ACTIVO'],
  ['e6600000-0000-4000-8000-0000000000a2', ALUMNO_2, ACTIVIDAD_1, 'ACTIVO'],
  ['e6600000-0000-4000-8000-0000000000a3', ALUMNO_3, ACTIVIDAD_2, 'BAJA'],
]

const huella = `
  SELECT pg_catalog.count(*)::text || '|' || pg_catalog.md5(COALESCE(pg_catalog.string_agg(
    pg_catalog.concat_ws(',', i.id, i.estudiante_id, i.actividad_id, i.estado, i.fecha_inscripcion),
    ';' ORDER BY i.id), ''))
  FROM public.inscripciones i`

const relaciones = `
  SELECT pg_catalog.count(*)::text
  FROM public.inscripciones i
  JOIN public.perfiles p ON p.id = i.estudiante_id
  JOIN public.actividades a ON a.id = i.actividad_id`

const sembradas = `
  SELECT pg_catalog.count(*)::text FROM public.inscripciones
  WHERE id IN (${FILAS.map(([id]) => `'${id}'`).join(', ')})`

const sesion = new SesionPsql('M', 'EPT66')
try {
  await sesion.ejecutar(
    `BEGIN;
     ALTER TABLE public.inscripciones DISABLE TRIGGER USER;
     DELETE FROM public.inscripciones WHERE id IN (${FILAS.map(([id]) => `'${id}'`).join(', ')});
     ALTER TABLE public.inscripciones ENABLE TRIGGER USER;
     DELETE FROM public.alumnos WHERE perfil_id IN ('${ALUMNO_1}', '${ALUMNO_2}', '${ALUMNO_3}');
     DELETE FROM public.perfiles WHERE id IN ('${ALUMNO_1}', '${ALUMNO_2}', '${ALUMNO_3}');
     DELETE FROM public.actividades WHERE id IN (${ACTIVIDAD_1}, ${ACTIVIDAD_2});
     COMMIT;
     BEGIN;
     INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni, legajo_nro)
     SELECT v.id, v.id, r.id, 'Prueba', v.apellido, v.dni, v.legajo
     FROM (VALUES
       ('${ALUMNO_1}'::uuid, 'Legada 1', '97662001', 'LEG-66-M1'),
       ('${ALUMNO_2}'::uuid, 'Legada 2', '97662002', 'LEG-66-M2'),
       ('${ALUMNO_3}'::uuid, 'Legada 3', '97662003', 'LEG-66-M3')
     ) AS v(id, apellido, dni, legajo)
     JOIN public.roles r ON r.nombre = 'ESTUDIANTE';
     INSERT INTO public.actividades (id, nombre, tipo, cupo_maximo, activo) VALUES
       (${ACTIVIDAD_1}, 'Taller legado de migración 1', 'TALLER', 10, TRUE),
       (${ACTIVIDAD_2}, 'Actividad legada de migración 2', 'CURRICULAR', 10, TRUE);
     ${FILAS.map(([id, alumno, actividad, estado]) =>
       `INSERT INTO public.inscripciones (id, estudiante_id, actividad_id, estado) VALUES ('${id}', '${alumno}', ${actividad}, '${estado}');`
     ).join('\n     ')}
     COMMIT;`,
    'sembrar_filas_legadas'
  )

  const antes = await sesion.escalar(`(${huella})`, 'huella_antes')
  const relacionesAntes = await sesion.escalar(`(${relaciones})`, 'relaciones_antes')
  const [conteoAntes] = antes.split('|')
  if (Number(conteoAntes) < FILAS.length) {
    throw new Error(`Se esperaban al menos ${FILAS.length} filas antes de migrar y hay ${conteoAntes}`)
  }
  console.log(`ANTES: ${conteoAntes} fila(s) de inscripciones, ${relacionesAntes} con sus relaciones íntegras`)

  for (const archivo of migraciones) {
    const sql = readFileSync(archivo, 'utf8')
    await sesion.ejecutar(`BEGIN;\n${sql}\nCOMMIT;`, `aplicar_${archivo.split('/').pop()}`)
    const despues = await sesion.escalar(`(${huella})`, 'huella_despues')
    const relacionesDespues = await sesion.escalar(`(${relaciones})`, 'relaciones_despues')
    const sobrevivientes = await sesion.escalar(`(${sembradas})`, 'sembradas_despues')
    if (despues !== antes) {
      throw new Error(`Tras ${archivo} cambió el contenido o el conteo: antes ${antes} · después ${despues}`)
    }
    if (relacionesDespues !== relacionesAntes) {
      throw new Error(`Tras ${archivo} se perdieron relaciones: antes ${relacionesAntes} · después ${relacionesDespues}`)
    }
    if (sobrevivientes !== String(FILAS.length)) {
      throw new Error(`Tras ${archivo} no sobreviven las ${FILAS.length} filas legadas sembradas (${sobrevivientes})`)
    }
    console.log(`OK ${archivo.split('/').pop()}: mismo conteo (${conteoAntes}), misma huella, ${relacionesDespues} relaciones íntegras y ${sobrevivientes}/${FILAS.length} filas legadas sembradas`)
  }

  await sesion.ejecutar(
    `BEGIN;
     ALTER TABLE public.inscripciones DISABLE TRIGGER USER;
     DELETE FROM public.inscripciones WHERE id IN (${FILAS.map(([id]) => `'${id}'`).join(', ')});
     ALTER TABLE public.inscripciones ENABLE TRIGGER USER;
     DELETE FROM public.alumnos WHERE perfil_id IN ('${ALUMNO_1}', '${ALUMNO_2}', '${ALUMNO_3}');
     DELETE FROM public.perfiles WHERE id IN ('${ALUMNO_1}', '${ALUMNO_2}', '${ALUMNO_3}');
     DELETE FROM public.actividades WHERE id IN (${ACTIVIDAD_1}, ${ACTIVIDAD_2});
     COMMIT;`,
    'limpiar'
  )
  const apagados = await sesion.escalar(
    `(SELECT pg_catalog.count(*) FROM pg_catalog.pg_trigger
      WHERE tgrelid = 'public.inscripciones'::pg_catalog.regclass AND NOT tgisinternal AND tgenabled <> 'O')`,
    'triggers_apagados')
  if (apagados !== '0') throw new Error(`Quedaron ${apagados} trigger(s) de inscripciones deshabilitados`)
  console.log('OK: las filas legadas sobreviven a la migración sin pérdida de conteo, contenido ni relaciones')
} catch (error) {
  console.error(`FALLO: ${error.message}`)
  process.exitCode = 1
} finally {
  await sesion.cerrar()
}
