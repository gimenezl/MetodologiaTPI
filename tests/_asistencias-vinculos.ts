import { execFileSync } from 'node:child_process'

/**
 * Escenario sintético de las pruebas de asistencias por vínculo vigente
 * (EPT-66, unidad D). Solo base local descartable.
 *
 * Crea, con las RPC reales de la Dirección, cuatro alumnos SIN cuenta (DNI
 * ficticios 99966xxx) y la estructura mínima para que el docente de prueba
 * (`tests/auth.setup.ts`) tenga cada tipo de vínculo con uno de ellos:
 *
 *   a1 · curso A · vínculo ACADÉMICO únicamente (el docente dicta una materia en A)
 *   a2 · curso A · vínculo ACADÉMICO y DEPORTIVO (también está en el grupo del docente)
 *   a3 · curso B · vínculo DEPORTIVO únicamente (curso B sin materias del docente)
 *   a4 · curso B · SIN vínculo con el docente
 *
 * No toca a ninguna identidad que siembra el setup. `limpiarEscenario` retira
 * todo como propietario de las tablas; ese borrado no representa ninguna
 * operación de la aplicación, que no tiene DELETE.
 */

const CONTENEDOR = process.env.EPT_SUPABASE_DB_CONTAINER ?? 'supabase_db_educar-para-transformar'

export const DNI = {
  directora: '99900001',
  docente: '99900004',
  a1: '99966001',
  a2: '99966002',
  a3: '99966003',
  a4: '99966004',
} as const

export type ClaveAlumno = 'a1' | 'a2' | 'a3' | 'a4'

const ID = {
  cursoA: 'e2e66d00-0000-4000-8000-0000000000c1',
  cursoB: 'e2e66d00-0000-4000-8000-0000000000c2',
  a1: 'e2e66d00-0000-4000-8000-0000000000a1',
  a2: 'e2e66d00-0000-4000-8000-0000000000a2',
  a3: 'e2e66d00-0000-4000-8000-0000000000a3',
  a4: 'e2e66d00-0000-4000-8000-0000000000a4',
} as const

export const ALUMNOS: Record<ClaveAlumno, { id: string; dni: string; nombre: string; apellido: string; legajo: string }> = {
  a1: { id: ID.a1, dni: DNI.a1, nombre: 'Uma', apellido: 'Vinculo Academico', legajo: 'LEG-66D-E1' },
  a2: { id: ID.a2, dni: DNI.a2, nombre: 'Dani', apellido: 'Vinculo Doble', legajo: 'LEG-66D-E2' },
  a3: { id: ID.a3, dni: DNI.a3, nombre: 'Tomi', apellido: 'Vinculo Deportivo', legajo: 'LEG-66D-E3' },
  a4: { id: ID.a4, dni: DNI.a4, nombre: 'Nora', apellido: 'Sin Vinculo', legajo: 'LEG-66D-E4' },
}

export const NOMBRE_MATERIA = 'E2E EPT66D Materia'
export const NOMBRE_GRUPO = 'E2E EPT66D Grupo'
const LISTA_ALUMNOS = Object.values(ALUMNOS).map((a) => `'${a.id}'`).join(', ')

export function sql(sentencia: string): string {
  return execFileSync(
    'docker',
    ['exec', '-i', CONTENEDOR, 'psql', '-X', '-q', '-A', '-t', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
    { input: sentencia, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  ).trim()
}

/**
 * Oráculo SQL del contrato: alumnos con vínculo vigente con el docente. Está
 * escrito aparte del código bajo prueba (matrícula vigente + asignación activa de
 * materia CURRICULAR activa, o inscripción deportiva ACTIVA en grupo ACTIVO).
 */
export function sqlAlumnosVinculados(docenteId: string): string {
  return `
    SELECT m.alumno_id
    FROM public.matriculas m
    JOIN public.materias_cursos mc ON mc.curso_id = m.curso_id AND mc.activo AND mc.profesor_id = '${docenteId}'
    JOIN public.actividades a ON a.id = mc.materia_id AND a.tipo = 'CURRICULAR' AND a.activo
    WHERE m.fecha_cierre IS NULL
    UNION
    SELECT i.alumno_id
    FROM public.inscripciones_deportivas i
    JOIN public.grupos_deportivos g ON g.id = i.grupo_id AND g.activo AND g.profesor_id = '${docenteId}'
    WHERE i.estado = 'ACTIVA'
  `
}

export function idPerfil(dni: string): string {
  return sql(`SELECT id FROM public.perfiles WHERE dni = '${dni}'`)
}

/** Etiqueta con el formato de la pantalla de asistencias: «Apellido, Nombre (legajo)». */
export function etiquetaDe(clave: ClaveAlumno): string {
  const a = ALUMNOS[clave]
  return `${a.apellido}, ${a.nombre} (${a.legajo})`
}

/** Ejecuta sentencias como la Dirección de prueba (RPC reales, con su JWT). */
export function comoDirector(sentencias: string): string {
  return sql(`
    SELECT user_id AS dirsub FROM public.perfiles WHERE dni = '${DNI.directora}' \\gset
    BEGIN;
    SET LOCAL ROLE authenticated;
    SELECT set_config('request.jwt.claims', '{"sub":"' || :'dirsub' || '"}', true) \\g /dev/null
    ${sentencias}
    COMMIT;
  `)
}

export function limpiarEscenario() {
  sql(`
    BEGIN;
    DELETE FROM public.asistencias WHERE estudiante_id IN (${LISTA_ALUMNOS});
    DELETE FROM public.inscripciones_deportivas WHERE alumno_id IN (${LISTA_ALUMNOS});
    DELETE FROM public.grupos_deportivos_horarios
      WHERE grupo_id IN (SELECT id FROM public.grupos_deportivos WHERE nombre = '${NOMBRE_GRUPO}');
    DELETE FROM public.grupos_deportivos WHERE nombre = '${NOMBRE_GRUPO}';
    DELETE FROM public.horarios h
      WHERE h.dia_semana = 7 AND h.hora_inicio = '18:00' AND h.hora_fin = '19:00'
        AND NOT EXISTS (SELECT 1 FROM public.grupos_deportivos_horarios f WHERE f.horario_id = h.id);
    DELETE FROM public.materias_cursos WHERE curso_id IN ('${ID.cursoA}', '${ID.cursoB}');
    DELETE FROM public.actividades WHERE tipo = 'CURRICULAR' AND nombre = '${NOMBRE_MATERIA}';
    DELETE FROM public.matriculas WHERE alumno_id IN (${LISTA_ALUMNOS});
    DELETE FROM public.alumnos WHERE perfil_id IN (${LISTA_ALUMNOS});
    DELETE FROM public.perfiles WHERE id IN (${LISTA_ALUMNOS});
    DELETE FROM public.cursos WHERE id IN ('${ID.cursoA}', '${ID.cursoB}');
    COMMIT;
  `)
}

export function prepararEscenario() {
  limpiarEscenario()
  const doc = idPerfil(DNI.docente)
  sql(`
    BEGIN;
    INSERT INTO public.cursos (id, nivel_id, denominacion, division, activo)
    VALUES ('${ID.cursoA}', (SELECT id FROM public.niveles WHERE nombre = 'INICIAL'), 'E2E EPT66D', 'A', TRUE),
           ('${ID.cursoB}', (SELECT id FROM public.niveles WHERE nombre = 'INICIAL'), 'E2E EPT66D', 'B', TRUE);

    INSERT INTO public.perfiles (id, rol_id, nombre, apellido, dni, legajo_nro)
    SELECT v.id::UUID, (SELECT id FROM public.roles WHERE nombre = 'ESTUDIANTE'), v.nombre, v.apellido, v.dni, v.legajo
    FROM (VALUES
      ${Object.values(ALUMNOS)
        .map((a) => `('${a.id}', '${a.nombre}', '${a.apellido}', '${a.dni}', '${a.legajo}')`)
        .join(',\n      ')}
    ) AS v(id, nombre, apellido, dni, legajo);

    INSERT INTO public.matriculas (alumno_id, curso_id) VALUES
      ('${ID.a1}', '${ID.cursoA}'), ('${ID.a2}', '${ID.cursoA}'),
      ('${ID.a3}', '${ID.cursoB}'), ('${ID.a4}', '${ID.cursoB}');
    UPDATE public.alumnos SET estado = 'ACTIVO' WHERE perfil_id IN (${LISTA_ALUMNOS});
    COMMIT;
  `)
  comoDirector(`
    SELECT (public.crear_materia('${NOMBRE_MATERIA}')).id;
    SELECT (public.asignar_materia_curso(
      (SELECT id FROM public.materias WHERE nombre = '${NOMBRE_MATERIA}'), '${ID.cursoA}', '${doc}')).id;
    SELECT (public.crear_grupo_deportivo('e0000000-0000-4000-8000-000000000101',
      (SELECT id FROM public.niveles WHERE nombre = 'INICIAL'), '${NOMBRE_GRUPO}', 10, '${doc}')).id;
    SELECT (public.agregar_horario_grupo_deportivo(
      (SELECT id FROM public.grupos_deportivos WHERE nombre = '${NOMBRE_GRUPO}'), 7::SMALLINT, '18:00', '19:00')).id;
    SELECT (public.inscribir_alumno_en_grupo_deportivo('${ID.a2}',
      (SELECT id FROM public.grupos_deportivos WHERE nombre = '${NOMBRE_GRUPO}'))).id;
    SELECT (public.inscribir_alumno_en_grupo_deportivo('${ID.a3}',
      (SELECT id FROM public.grupos_deportivos WHERE nombre = '${NOMBRE_GRUPO}'))).id;
  `)
}

const ASIGNACION = `(SELECT mc.id FROM public.materias_cursos mc
   JOIN public.actividades a ON a.id = mc.materia_id
   WHERE a.nombre = '${NOMBRE_MATERIA}' AND mc.curso_id = '${ID.cursoA}')`

/** Revoca el vínculo ACADÉMICO del docente: desactiva su asignación (RPC de la Dirección). */
export function revocarAcademico() {
  comoDirector(`SELECT (public.cambiar_estado_asignacion(${ASIGNACION}, FALSE)).id;`)
}

export function restaurarAcademico() {
  comoDirector(`SELECT (public.cambiar_estado_asignacion(${ASIGNACION}, TRUE)).id;`)
}

/** Revoca el vínculo DEPORTIVO de un alumno: cancela su inscripción activa (RPC de la Dirección). */
export function revocarDeportivo(clave: 'a2' | 'a3') {
  comoDirector(`
    SELECT (public.cancelar_inscripcion_deportiva_administrativa(
      (SELECT id FROM public.inscripciones_deportivas WHERE alumno_id = '${ALUMNOS[clave].id}' AND estado = 'ACTIVA'))).id;
  `)
}

export function filasDe(clave: ClaveAlumno, fecha: string): { estado: string; registrante: string }[] {
  const salida = sql(`
    SELECT a.estado || '|' || COALESCE(p.dni, '-')
    FROM public.asistencias a LEFT JOIN public.perfiles p ON p.id = a.docente_id
    WHERE a.estudiante_id = '${ALUMNOS[clave].id}' AND a.fecha = '${fecha}'
  `)
  return salida
    .split('\n')
    .filter(Boolean)
    .map((linea) => {
      const [estado, registrante] = linea.split('|')
      return { estado, registrante }
    })
}

/** Siembra una asistencia como propietario, a nombre de quien tenga ese DNI (o sin registrante). */
export function sembrarAsistencia(clave: ClaveAlumno, fecha: string, estado: string, dniRegistrante: string | null) {
  sql(`
    INSERT INTO public.asistencias (estudiante_id, fecha, estado, docente_id)
    VALUES ('${ALUMNOS[clave].id}', '${fecha}', '${estado}',
            ${dniRegistrante ? `(SELECT id FROM public.perfiles WHERE dni = '${dniRegistrante}')` : 'NULL'});
  `)
}

export function borrarAsistencias(fecha: string) {
  sql(`DELETE FROM public.asistencias WHERE estudiante_id IN (${LISTA_ALUMNOS}) AND fecha = '${fecha}';`)
}
