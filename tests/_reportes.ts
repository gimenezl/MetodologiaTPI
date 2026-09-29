import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Herramientas compartidas por las suites de reportes (EPT-63): base local,
 * sembrado de volumen, valores esperados independientes y lectura de CSV.
 *
 * Solo se usan contra la base local descartable. `psql` sobre el contenedor
 * local prepara y verifica datos; nunca participa de lo que se prueba.
 */

export const CONTENEDOR = process.env.EPT_SUPABASE_DB_CONTAINER ?? 'supabase_db_educar-para-transformar'
export const NORTE = 'e0000000-0000-4000-8000-000000000020'
export const DEPORTE_BENCH_1 = 'b6000000-0000-4000-8000-000000000001'
export const REPORTES = [
  'alumnos-por-curso',
  'alumnos-por-materia',
  'alumnos-por-deporte',
  'alumnos-por-horario',
  'alumnos-por-recorrido',
  'docentes-por-nivel',
] as const

// ----------------------------------------------------------------
// Base local: siembra, oráculos y limpieza
// ----------------------------------------------------------------

export function psql(sentencia: string, usuario = 'postgres') {
  return execFileSync(
    'docker',
    ['exec', '-i', CONTENEDOR, 'psql', '-X', '-q', '-A', '-t', '-U', usuario, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
    { input: sentencia, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }
  ).trim()
}

export const cuenta = (sentencia: string) => Number(psql(sentencia))

export function ejecutarGuion(archivo: string) {
  return psql(fs.readFileSync(path.join('supabase/tests', archivo), 'utf8'), 'supabase_admin')
}

/** Valores esperados: consultas independientes, escritas con joins sobre las tablas base. */
export const ESPERADO = {
  matriculasVigentes: () => cuenta(`SELECT count(*) FROM public.matriculas WHERE fecha_cierre IS NULL`),
  matriculasTodas: () => cuenta(`SELECT count(*) FROM public.matriculas`),
  materias: () =>
    cuenta(`SELECT count(*) FROM public.matriculas m
            JOIN public.materias_cursos mc ON mc.curso_id = m.curso_id AND mc.activo
            JOIN public.actividades a ON a.id = mc.materia_id AND a.activo
            WHERE m.fecha_cierre IS NULL`),
  deportivasActivas: () => cuenta(`SELECT count(*) FROM public.inscripciones_deportivas WHERE estado = 'ACTIVA'`),
  deportivasTodas: () => cuenta(`SELECT count(*) FROM public.inscripciones_deportivas`),
  franjas: () =>
    cuenta(`SELECT
      (SELECT count(*) FROM public.matriculas m
         JOIN public.materias_cursos mc ON mc.curso_id = m.curso_id AND mc.activo
         JOIN public.actividades a ON a.id = mc.materia_id AND a.activo
         JOIN public.materias_cursos_horarios ah ON ah.asignacion_id = mc.id AND ah.activo
         WHERE m.fecha_cierre IS NULL)
      +
      (SELECT count(*) FROM public.inscripciones_deportivas i
         JOIN public.grupos_deportivos g ON g.id = i.grupo_id AND g.activo
         JOIN public.grupos_deportivos_horarios gh ON gh.grupo_id = g.id AND gh.activo
         WHERE i.estado = 'ACTIVA')`),
  transporteActivo: () =>
    cuenta(`SELECT count(*) FROM public.inscripciones_servicios i
            JOIN public.servicios_escolares s ON s.id = i.servicio_id
            WHERE s.tipo = 'TRANSPORTE' AND i.estado = 'ACTIVA'`),
  transporteTodo: () =>
    cuenta(`SELECT count(*) FROM public.inscripciones_servicios i
            JOIN public.servicios_escolares s ON s.id = i.servicio_id WHERE s.tipo = 'TRANSPORTE'`),
  docentes: () =>
    cuenta(`SELECT
      (SELECT count(*) FROM public.materias_cursos mc
         JOIN public.actividades a ON a.id = mc.materia_id AND a.activo
         WHERE mc.activo AND mc.profesor_id IS NOT NULL)
      + (SELECT count(*) FROM public.grupos_deportivos WHERE activo)`),
  idMateria: (nombre: string) => psql(`SELECT id FROM public.actividades WHERE nombre = '${nombre}'`),
}

export function limpiarVolumen() {
  ejecutarGuion('reportes_benchmark_limpieza.sql')
}

/** Vuelve a dejar en su lugar un apellido que este archivo alteró a propósito. */
const APELLIDOS_ESPECIALES = [
  { n: 1, apellido: '=1+1 Fórmula', nombre: 'Ana' },
  { n: 2, apellido: 'Comillas "dobles"; y punto y coma', nombre: 'Beto' },
  { n: 3, apellido: 'Con\nsalto', nombre: 'Cami' },
]

export function sembrarVolumen() {
  limpiarVolumen()
  ejecutarGuion('reportes_benchmark_datos.sql')
  // Tres alumnos con nombres que rompen un CSV ingenuo. La limpieza los borra.
  for (const { n, apellido, nombre } of APELLIDOS_ESPECIALES) {
    psql(
      `UPDATE public.perfiles SET apellido = ${dollar(apellido)}, nombre = ${dollar(nombre)}
       WHERE id = 'b9000000-0000-4000-8000-${String(n).padStart(12, '0')}'`,
      'supabase_admin'
    )
  }
}

function dollar(valor: string) {
  return `$e63$${valor}$e63$`
}

/** Parser mínimo de CSV RFC 4180 con separador «;»: el mismo que produce la exportación. */
export function analizarCsv(texto: string): string[][] {
  const filas: string[][] = []
  let fila: string[] = []
  let celda = ''
  let entrecomillada = false
  for (let i = 0; i < texto.length; i += 1) {
    const c = texto[i]
    if (entrecomillada) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          celda += '"'
          i += 1
        } else entrecomillada = false
      } else celda += c
    } else if (c === '"') entrecomillada = true
    else if (c === ';') {
      fila.push(celda)
      celda = ''
    } else if (c === '\r' && texto[i + 1] === '\n') {
      fila.push(celda)
      filas.push(fila)
      fila = []
      celda = ''
      i += 1
    } else celda += c
  }
  if (celda !== '' || fila.length > 0) {
    fila.push(celda)
    filas.push(fila)
  }
  return filas
}
