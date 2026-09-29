/**
 * Reportes oficiales de Dirección (EPT-63, RF17): definiciones, filtros, formato
 * y exportación CSV.
 *
 * Este módulo no depende de Next, de React ni de Supabase: lo usan el servidor
 * (rutas y servicio), la pantalla y la vista imprimible, y se prueba de forma
 * aislada. La pantalla, la impresión y el CSV salen de las MISMAS columnas, de
 * modo que nunca pueden mostrar cosas distintas.
 *
 * Son seis reportes, cada uno con su GRANO declarado (qué es una fila). Los
 * filtros son los mismos en todos y se combinan; un filtro cuya dimensión
 * pertenece al grano acota las filas y los demás seleccionan alumnos según su
 * situación vigente (ver la cabecera de la migración 20260929012923).
 *
 * Privacidad: ninguna columna de este módulo alude al confirmador de EPT-62 ni a
 * documentos, contacto o domicilio. Una columna nueva tiene que pasar por la
 * prueba `reportes-lib.spec.ts`, que lo comprueba.
 */

// ----------------------------------------------------------------
// Reportes y filtros
// ----------------------------------------------------------------

export const IDS_REPORTE = [
  'alumnos-por-curso',
  'alumnos-por-materia',
  'alumnos-por-deporte',
  'alumnos-por-horario',
  'alumnos-por-recorrido',
  'docentes-por-nivel',
] as const

export type IdReporte = (typeof IDS_REPORTE)[number]

export function esIdReporte(valor: unknown): valor is IdReporte {
  return typeof valor === 'string' && (IDS_REPORTE as readonly string[]).includes(valor)
}

/** Dimensiones por las que se filtra. `q` es el texto libre (nombre, apellido o legajo). */
export const IDS_FILTRO = [
  'q',
  'nivel',
  'curso',
  'materia',
  'deporte',
  'recorrido',
  'horario',
  'responsable',
  'origen',
  'historial',
] as const

export type IdFiltro = (typeof IDS_FILTRO)[number]

export type Origen = 'ACADEMICO' | 'DEPORTIVO'

export type FiltrosReporte = {
  q?: string
  nivel?: number
  curso?: string
  materia?: number
  deporte?: string
  recorrido?: string
  horario?: string
  responsable?: string
  origen?: Origen
  historial: boolean
}

export const FILTROS_VACIOS: FiltrosReporte = { historial: false }

/** Filas por página que la pantalla ofrece. */
export const TAMANOS_PAGINA = [25, 50, 100] as const
export const TAMANO_PAGINA_POR_DEFECTO = 50

/**
 * Máximo de filas que la vista imprimible acepta. Por encima de esto el
 * navegador ya no imprime con soltura y el listado impreso no lo leería nadie:
 * se avisa con el total y se ofrece acotar o exportar. No es un recorte
 * silencioso — la pantalla nunca muestra un listado parcial como si fuera
 * completo.
 */
export const MAXIMO_FILAS_IMPRESION = 10_000

export type DefinicionReporte = {
  id: IdReporte
  /** Nombre de la función de PostgreSQL. */
  rpc:
    | 'reporte_alumnos_curso'
    | 'reporte_alumnos_materia'
    | 'reporte_alumnos_deporte'
    | 'reporte_alumnos_horario'
    | 'reporte_alumnos_recorrido'
    | 'reporte_docentes_nivel'
  titulo: string
  descripcion: string
  /** Qué es UNA fila. Se muestra en pantalla y en la impresión. */
  grano: string
  /** Filtros que el reporte admite. Uno que no figure acá se rechaza, no se ignora. */
  filtros: readonly IdFiltro[]
  /** Solo se ofrece donde el esquema registra la historia con fechas. */
  historial: boolean
  /** Por qué no hay historial, cuando no lo hay. */
  sinHistorial?: string
  /** Aclaración sobre qué filtros acotan filas y cuáles seleccionan alumnos. */
  nota?: string
}

const SIN_HISTORIAL_ASIGNACIONES =
  'El esquema guarda solo el estado actual de las asignaciones: no registra desde cuándo rigen ni quién fue el responsable anterior. Por eso este reporte muestra únicamente la situación vigente.'

export const REPORTES: Record<IdReporte, DefinicionReporte> = {
  'alumnos-por-curso': {
    id: 'alumnos-por-curso',
    rpc: 'reporte_alumnos_curso',
    titulo: 'Alumnos por curso y nivel',
    descripcion: 'Quién cursa (o cursó) en cada curso y nivel.',
    grano: 'Una fila por matrícula: un alumno en un curso durante un período.',
    filtros: ['q', 'nivel', 'curso', 'materia', 'deporte', 'recorrido', 'horario', 'responsable', 'historial'],
    historial: true,
    nota:
      'Nivel y curso acotan las matrículas. Materia, deporte, recorrido, horario y responsable seleccionan a los alumnos según su situación vigente.',
  },
  'alumnos-por-materia': {
    id: 'alumnos-por-materia',
    rpc: 'reporte_alumnos_materia',
    titulo: 'Alumnos por materia',
    descripcion: 'Las materias de cada alumno y su profesor responsable.',
    grano:
      'Una fila por alumno y materia. La materia se deriva de las asignadas al curso de la matrícula vigente: no existe una inscripción individual por materia.',
    filtros: ['q', 'nivel', 'curso', 'materia', 'deporte', 'recorrido', 'horario', 'responsable'],
    historial: false,
    sinHistorial: SIN_HISTORIAL_ASIGNACIONES,
    nota:
      'Nivel, curso, materia y responsable acotan las filas. Deporte, recorrido y horario seleccionan a los alumnos según su situación vigente.',
  },
  'alumnos-por-deporte': {
    id: 'alumnos-por-deporte',
    rpc: 'reporte_alumnos_deporte',
    titulo: 'Alumnos por deporte',
    descripcion: 'Quién está inscripto en cada grupo deportivo y quién es su profesor responsable.',
    grano:
      'Una fila por inscripción deportiva. El nivel es el del grupo; el responsable, el profesor actual del grupo.',
    filtros: ['q', 'nivel', 'curso', 'materia', 'deporte', 'recorrido', 'horario', 'responsable', 'historial'],
    historial: true,
    nota:
      'Nivel, deporte y responsable acotan las inscripciones. Curso, materia, recorrido y horario seleccionan a los alumnos según su situación vigente. En el historial, el responsable es el actual del grupo, no necesariamente el de la fecha de la inscripción.',
  },
  'alumnos-por-horario': {
    id: 'alumnos-por-horario',
    rpc: 'reporte_alumnos_horario',
    titulo: 'Alumnos por horario',
    descripcion: 'Las franjas semanales de cada alumno, académicas y deportivas.',
    grano:
      'Una fila por alumno y franja semanal. Cada fila identifica su origen (académico o deportivo); una misma franja por las dos vías figura en dos filas.',
    filtros: ['q', 'nivel', 'curso', 'materia', 'deporte', 'recorrido', 'horario', 'responsable', 'origen'],
    historial: false,
    sinHistorial: SIN_HISTORIAL_ASIGNACIONES,
    nota:
      'Horario, origen, nivel de la actividad, materia, deporte y responsable acotan las franjas. Curso y recorrido seleccionan a los alumnos. Pedir una materia y un deporte a la vez no devuelve filas: no comparten origen.',
  },
  'alumnos-por-recorrido': {
    id: 'alumnos-por-recorrido',
    rpc: 'reporte_alumnos_recorrido',
    titulo: 'Alumnos por recorrido',
    descripcion: 'Quién viaja en cada recorrido de transporte.',
    grano:
      'Una fila por inscripción a un recorrido de transporte. El nivel y el curso son los vigentes del alumno.',
    filtros: ['q', 'nivel', 'curso', 'materia', 'deporte', 'recorrido', 'horario', 'responsable', 'historial'],
    historial: true,
    nota:
      'El recorrido acota las inscripciones. Nivel, curso, materia, deporte, horario y responsable seleccionan a los alumnos según su situación vigente.',
  },
  'docentes-por-nivel': {
    id: 'docentes-por-nivel',
    rpc: 'reporte_docentes_nivel',
    titulo: 'Docentes por nivel',
    descripcion: 'Los profesores responsables de materias y de grupos deportivos, por nivel.',
    grano:
      'Una fila por docente y asignación vigente. Cada fila identifica su origen (académico o deportivo). Un docente sin asignaciones vigentes no tiene nivel y no figura.',
    filtros: ['q', 'nivel', 'curso', 'materia', 'deporte', 'horario', 'responsable', 'origen'],
    historial: false,
    sinHistorial: SIN_HISTORIAL_ASIGNACIONES,
    nota:
      'Todos los filtros acotan las asignaciones. Curso y materia existen solo en el origen académico y el deporte solo en el deportivo: pedir dos que no comparten origen no devuelve filas.',
  },
}

export const LISTA_REPORTES: readonly DefinicionReporte[] = IDS_REPORTE.map((id) => REPORTES[id])

/** Etiquetas de los filtros, en el orden en que la pantalla los muestra. */
export const ETIQUETAS_FILTRO: Record<IdFiltro, string> = {
  q: 'Buscar por nombre, apellido o legajo',
  nivel: 'Nivel',
  curso: 'Curso',
  materia: 'Materia',
  deporte: 'Deporte',
  recorrido: 'Recorrido',
  horario: 'Horario',
  responsable: 'Profesor responsable',
  origen: 'Origen',
  historial: 'Incluir historial',
}

// ----------------------------------------------------------------
// Lectura de los filtros desde la URL
// ----------------------------------------------------------------

export type ParametrosCrudos = Record<string, string | string[] | undefined>

export type ErrorDeFiltro = { campo: string; mensaje: string }

export type ResultadoFiltros =
  | { ok: true; filtros: FiltrosReporte; pagina: number; tamano: number }
  | { ok: false; errores: ErrorDeFiltro[] }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ENTERO_POSITIVO = /^[1-9][0-9]{0,8}$/

/** Convierte un `URLSearchParams` en el formato que usa `searchParams` de una página. */
export function parametrosDesdeUrl(busqueda: URLSearchParams): ParametrosCrudos {
  const crudos: ParametrosCrudos = {}
  for (const clave of new Set(busqueda.keys())) {
    const valores = busqueda.getAll(clave)
    crudos[clave] = valores.length === 1 ? valores[0] : valores
  }
  return crudos
}

const CLAVES_DE_PAGINA = ['pagina', 'tamano'] as const

/**
 * Valida los parámetros de un reporte. Devuelve TODOS los errores, no solo el
 * primero, para que la pantalla los muestre juntos.
 *
 * Reglas:
 *  - un valor vacío equivale a «sin filtro» (así llega un `<select>` sin elegir);
 *  - un filtro que el reporte no admite se RECHAZA en lugar de ignorarse: si
 *    alguien pide `historial` donde no hay historia, no puede creer que lo tiene;
 *  - un parámetro repetido o desconocido se rechaza;
 *  - `historial` acepta solo `1` o `true`.
 */
export function leerFiltros(reporte: DefinicionReporte, crudos: ParametrosCrudos): ResultadoFiltros {
  const errores: ErrorDeFiltro[] = []
  const filtros: FiltrosReporte = { historial: false }
  let pagina = 1
  let tamano: number = TAMANO_PAGINA_POR_DEFECTO

  const admitidos = new Set<string>([...reporte.filtros, ...CLAVES_DE_PAGINA])

  for (const [clave, valorCrudo] of Object.entries(crudos)) {
    if (valorCrudo === undefined) continue

    if (!admitidos.has(clave)) {
      const conocido = (IDS_FILTRO as readonly string[]).includes(clave)
      errores.push({
        campo: clave,
        mensaje: conocido
          ? `El filtro «${ETIQUETAS_FILTRO[clave as IdFiltro].toLowerCase()}» no aplica a este reporte.`
          : `El parámetro «${clave}» no existe.`,
      })
      continue
    }

    if (Array.isArray(valorCrudo)) {
      errores.push({ campo: clave, mensaje: `El parámetro «${clave}» se envió más de una vez.` })
      continue
    }

    const valor = valorCrudo.trim()
    if (valor === '') continue

    switch (clave) {
      case 'q':
        if (valor.length > 100) {
          errores.push({ campo: clave, mensaje: 'La búsqueda no puede superar los 100 caracteres.' })
        } else {
          filtros.q = valor
        }
        break
      case 'nivel':
      case 'materia':
        if (!ENTERO_POSITIVO.test(valor)) {
          errores.push({ campo: clave, mensaje: `El valor de «${ETIQUETAS_FILTRO[clave].toLowerCase()}» no es válido.` })
        } else {
          filtros[clave] = Number(valor)
        }
        break
      case 'curso':
      case 'deporte':
      case 'recorrido':
      case 'horario':
      case 'responsable':
        if (!UUID.test(valor)) {
          errores.push({ campo: clave, mensaje: `El valor de «${ETIQUETAS_FILTRO[clave].toLowerCase()}» no es válido.` })
        } else {
          filtros[clave] = valor.toLowerCase()
        }
        break
      case 'origen':
        if (valor !== 'ACADEMICO' && valor !== 'DEPORTIVO') {
          errores.push({ campo: clave, mensaje: 'El origen debe ser académico o deportivo.' })
        } else {
          filtros.origen = valor
        }
        break
      case 'historial':
        if (valor !== '1' && valor !== 'true') {
          errores.push({ campo: clave, mensaje: 'El valor de «incluir historial» no es válido.' })
        } else {
          filtros.historial = true
        }
        break
      case 'pagina':
        if (!ENTERO_POSITIVO.test(valor)) {
          errores.push({ campo: clave, mensaje: 'El número de página no es válido.' })
        } else {
          pagina = Number(valor)
        }
        break
      case 'tamano': {
        const candidato = Number(valor)
        if (!(TAMANOS_PAGINA as readonly number[]).includes(candidato)) {
          errores.push({ campo: clave, mensaje: `El tamaño de página debe ser ${TAMANOS_PAGINA.join(', ')}.` })
        } else {
          tamano = candidato
        }
        break
      }
    }
  }

  if (errores.length > 0) return { ok: false, errores }
  return { ok: true, filtros, pagina, tamano }
}

/**
 * Argumentos con los que se llama a la función de PostgreSQL de un reporte.
 * Solo se envían los filtros presentes: los demás quedan en su valor por defecto
 * (`NULL`), que en la base significa «sin filtro».
 */
export function argumentosRpc(
  reporte: DefinicionReporte,
  filtros: FiltrosReporte,
  limite: number,
  desplazamiento: number
): Record<string, string | number | boolean> {
  const args: Record<string, string | number | boolean> = {
    p_limite: limite,
    p_desplazamiento: desplazamiento,
  }
  const admite = (f: IdFiltro) => reporte.filtros.includes(f)

  if (admite('q') && filtros.q) args.p_busqueda = filtros.q
  if (admite('nivel') && filtros.nivel !== undefined) args.p_nivel_id = filtros.nivel
  if (admite('curso') && filtros.curso) args.p_curso_id = filtros.curso
  if (admite('materia') && filtros.materia !== undefined) args.p_materia_id = filtros.materia
  if (admite('deporte') && filtros.deporte) args.p_deporte_id = filtros.deporte
  if (admite('recorrido') && filtros.recorrido) args.p_servicio_id = filtros.recorrido
  if (admite('horario') && filtros.horario) args.p_horario_id = filtros.horario
  if (admite('responsable') && filtros.responsable) args.p_profesor_id = filtros.responsable
  if (admite('origen') && filtros.origen) args.p_origen = filtros.origen
  if (reporte.historial && filtros.historial) args.p_incluir_historial = true
  return args
}

/** Vuelve a serializar los filtros como parámetros de URL (enlaces de paginación, exportación, impresión). */
export function parametrosDeUrl(filtros: FiltrosReporte, extra: Record<string, string | number> = {}) {
  const parametros = new URLSearchParams()
  if (filtros.q) parametros.set('q', filtros.q)
  if (filtros.nivel !== undefined) parametros.set('nivel', String(filtros.nivel))
  if (filtros.curso) parametros.set('curso', filtros.curso)
  if (filtros.materia !== undefined) parametros.set('materia', String(filtros.materia))
  if (filtros.deporte) parametros.set('deporte', filtros.deporte)
  if (filtros.recorrido) parametros.set('recorrido', filtros.recorrido)
  if (filtros.horario) parametros.set('horario', filtros.horario)
  if (filtros.responsable) parametros.set('responsable', filtros.responsable)
  if (filtros.origen) parametros.set('origen', filtros.origen)
  if (filtros.historial) parametros.set('historial', '1')
  for (const [clave, valor] of Object.entries(extra)) parametros.set(clave, String(valor))
  return parametros
}

// ----------------------------------------------------------------
// Filas
// ----------------------------------------------------------------

type Base = { id: string; total_filas: number }
type Persona = { alumno_apellido: string; alumno_nombre: string; legajo_nro: string | null }
type Responsable = { responsable_apellido: string | null; responsable_nombre: string | null }

export type FilaAlumnosCurso = Base &
  Persona & {
    alumno_estado: 'ACTIVO' | 'INACTIVO'
    nivel_id: number
    nivel_nombre: string
    curso_id: string
    curso_denominacion: string
    curso_division: string
    fecha_inicio: string
    fecha_cierre: string | null
    motivo_cierre: 'CAMBIO_DE_CURSO' | 'INACTIVACION' | null
    vigente: boolean
  }

export type FilaAlumnosMateria = Base &
  Persona &
  Responsable & {
    nivel_id: number
    nivel_nombre: string
    curso_id: string
    curso_denominacion: string
    curso_division: string
    materia_id: number
    materia_nombre: string
  }

export type FilaAlumnosDeporte = Base &
  Persona &
  Responsable & {
    curso_denominacion: string | null
    curso_division: string | null
    nivel_id: number
    nivel_nombre: string
    deporte_id: string
    deporte_nombre: string
    grupo_id: string
    grupo_nombre: string
    estado: 'ACTIVA' | 'CANCELADA'
    fecha_inscripcion: string
    fecha_cancelacion: string | null
  }

export type FilaAlumnosHorario = Base &
  Persona &
  Responsable & {
    origen: Origen
    dia_semana: number
    hora_inicio: string
    hora_fin: string
    actividad_nombre: string
    curso_denominacion: string | null
    curso_division: string | null
    grupo_nombre: string | null
    nivel_id: number
    nivel_nombre: string
  }

export type FilaAlumnosRecorrido = Base &
  Persona & {
    nivel_id: number | null
    nivel_nombre: string | null
    curso_denominacion: string | null
    curso_division: string | null
    recorrido_id: string
    recorrido_codigo: string
    recorrido_nombre: string
    paradas: string | null
    estado: 'ACTIVA' | 'CANCELADA'
    fecha_inscripcion: string
    fecha_cancelacion: string | null
  }

export type FilaDocentesNivel = Base & {
  origen: Origen
  docente_apellido: string
  docente_nombre: string
  docente_estado: 'ACTIVO' | 'INACTIVO' | null
  especialidad: string | null
  nivel_id: number
  nivel_nombre: string
  actividad_nombre: string
  curso_denominacion: string | null
  curso_division: string | null
  grupo_nombre: string | null
}

export type FilaReporte =
  | FilaAlumnosCurso
  | FilaAlumnosMateria
  | FilaAlumnosDeporte
  | FilaAlumnosHorario
  | FilaAlumnosRecorrido
  | FilaDocentesNivel

// ----------------------------------------------------------------
// Formato
// ----------------------------------------------------------------

/**
 * `timeZone` explícito y sin reloj de 12 horas: sin ellos el servidor (Node/ICU) y
 * el navegador formatean distinto y React descarta el árbol hidratado.
 */
const FORMATO_FECHA = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'America/Argentina/Buenos_Aires',
})

export const VACIO = '—'

/** «15/09/2026». Un valor ausente o inválido es «—». */
export function fecha(valor: string | null | undefined): string {
  if (!valor) return VACIO
  const momento = new Date(valor)
  return Number.isNaN(momento.getTime()) ? VACIO : FORMATO_FECHA.format(momento)
}

/** «08:00» a partir de «08:00:00». */
export function hora(valor: string | null | undefined): string {
  if (!valor) return VACIO
  return valor.slice(0, 5)
}

const DIAS = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'] as const

export function nombreDia(dia: number): string {
  return DIAS[dia] ?? VACIO
}

/** «Apellido» y «Nombre» de una persona; vacío si no hay ninguno. */
function textoOVacio(valor: string | null | undefined): string {
  return valor && valor.trim() !== '' ? valor : VACIO
}

export function nombreCurso(denominacion: string | null, division: string | null): string {
  if (!denominacion) return VACIO
  return division ? `${denominacion} ${division}` : denominacion
}

function responsable(fila: Responsable): string {
  const partes = [fila.responsable_apellido, fila.responsable_nombre].filter(
    (parte): parte is string => Boolean(parte && parte.trim())
  )
  return partes.length > 0 ? partes.join(', ') : 'Sin responsable'
}

const ETIQUETA_ORIGEN: Record<Origen, string> = { ACADEMICO: 'Académico', DEPORTIVO: 'Deportivo' }
const ETIQUETA_ESTADO_INSCRIPCION = { ACTIVA: 'Activa', CANCELADA: 'Cancelada' } as const
const ETIQUETA_MOTIVO = { CAMBIO_DE_CURSO: 'Cambio de curso', INACTIVACION: 'Inactivación' } as const

// ----------------------------------------------------------------
// Columnas
// ----------------------------------------------------------------

export type Columna<F extends FilaReporte = FilaReporte> = {
  clave: string
  encabezado: string
  valor: (fila: F) => string
}

function columnasAlumno<F extends FilaReporte & Persona>(): Columna<F>[] {
  return [
    { clave: 'apellido', encabezado: 'Apellido', valor: (f) => f.alumno_apellido },
    { clave: 'nombre', encabezado: 'Nombre', valor: (f) => f.alumno_nombre },
    { clave: 'legajo', encabezado: 'Legajo', valor: (f) => textoOVacio(f.legajo_nro) },
  ]
}

const COLUMNAS: { [K in IdReporte]: Columna<never>[] } = {
  'alumnos-por-curso': [
    ...columnasAlumno<FilaAlumnosCurso>(),
    { clave: 'nivel', encabezado: 'Nivel', valor: (f: FilaAlumnosCurso) => f.nivel_nombre },
    { clave: 'curso', encabezado: 'Curso', valor: (f: FilaAlumnosCurso) => nombreCurso(f.curso_denominacion, f.curso_division) },
    { clave: 'situacion', encabezado: 'Situación', valor: (f: FilaAlumnosCurso) => (f.vigente ? 'Vigente' : 'Cerrada') },
    { clave: 'desde', encabezado: 'Desde', valor: (f: FilaAlumnosCurso) => fecha(f.fecha_inicio) },
    { clave: 'hasta', encabezado: 'Hasta', valor: (f: FilaAlumnosCurso) => fecha(f.fecha_cierre) },
    {
      clave: 'motivo',
      encabezado: 'Motivo de cierre',
      valor: (f: FilaAlumnosCurso) => (f.motivo_cierre ? ETIQUETA_MOTIVO[f.motivo_cierre] : VACIO),
    },
  ] as Columna<never>[],
  'alumnos-por-materia': [
    ...columnasAlumno<FilaAlumnosMateria>(),
    { clave: 'nivel', encabezado: 'Nivel', valor: (f: FilaAlumnosMateria) => f.nivel_nombre },
    { clave: 'curso', encabezado: 'Curso', valor: (f: FilaAlumnosMateria) => nombreCurso(f.curso_denominacion, f.curso_division) },
    { clave: 'materia', encabezado: 'Materia', valor: (f: FilaAlumnosMateria) => f.materia_nombre },
    { clave: 'responsable', encabezado: 'Profesor responsable', valor: (f: FilaAlumnosMateria) => responsable(f) },
  ] as Columna<never>[],
  'alumnos-por-deporte': [
    ...columnasAlumno<FilaAlumnosDeporte>(),
    { clave: 'curso', encabezado: 'Curso vigente', valor: (f: FilaAlumnosDeporte) => nombreCurso(f.curso_denominacion, f.curso_division) },
    { clave: 'nivel', encabezado: 'Nivel del grupo', valor: (f: FilaAlumnosDeporte) => f.nivel_nombre },
    { clave: 'deporte', encabezado: 'Deporte', valor: (f: FilaAlumnosDeporte) => f.deporte_nombre },
    { clave: 'grupo', encabezado: 'Grupo', valor: (f: FilaAlumnosDeporte) => f.grupo_nombre },
    { clave: 'responsable', encabezado: 'Profesor responsable', valor: (f: FilaAlumnosDeporte) => responsable(f) },
    { clave: 'estado', encabezado: 'Estado', valor: (f: FilaAlumnosDeporte) => ETIQUETA_ESTADO_INSCRIPCION[f.estado] },
    { clave: 'inscripcion', encabezado: 'Inscripción', valor: (f: FilaAlumnosDeporte) => fecha(f.fecha_inscripcion) },
    { clave: 'cancelacion', encabezado: 'Cancelación', valor: (f: FilaAlumnosDeporte) => fecha(f.fecha_cancelacion) },
  ] as Columna<never>[],
  'alumnos-por-horario': [
    { clave: 'dia', encabezado: 'Día', valor: (f: FilaAlumnosHorario) => nombreDia(f.dia_semana) },
    { clave: 'inicio', encabezado: 'Inicio', valor: (f: FilaAlumnosHorario) => hora(f.hora_inicio) },
    { clave: 'fin', encabezado: 'Fin', valor: (f: FilaAlumnosHorario) => hora(f.hora_fin) },
    ...columnasAlumno<FilaAlumnosHorario>(),
    { clave: 'origen', encabezado: 'Origen', valor: (f: FilaAlumnosHorario) => ETIQUETA_ORIGEN[f.origen] },
    { clave: 'actividad', encabezado: 'Actividad', valor: (f: FilaAlumnosHorario) => f.actividad_nombre },
    {
      clave: 'detalle',
      encabezado: 'Curso o grupo',
      valor: (f: FilaAlumnosHorario) =>
        f.origen === 'ACADEMICO' ? nombreCurso(f.curso_denominacion, f.curso_division) : textoOVacio(f.grupo_nombre),
    },
    { clave: 'nivel', encabezado: 'Nivel', valor: (f: FilaAlumnosHorario) => f.nivel_nombre },
    { clave: 'responsable', encabezado: 'Profesor responsable', valor: (f: FilaAlumnosHorario) => responsable(f) },
  ] as Columna<never>[],
  'alumnos-por-recorrido': [
    ...columnasAlumno<FilaAlumnosRecorrido>(),
    { clave: 'nivel', encabezado: 'Nivel vigente', valor: (f: FilaAlumnosRecorrido) => textoOVacio(f.nivel_nombre) },
    { clave: 'curso', encabezado: 'Curso vigente', valor: (f: FilaAlumnosRecorrido) => nombreCurso(f.curso_denominacion, f.curso_division) },
    { clave: 'recorrido', encabezado: 'Recorrido', valor: (f: FilaAlumnosRecorrido) => `${f.recorrido_nombre} (${f.recorrido_codigo})` },
    { clave: 'paradas', encabezado: 'Paradas', valor: (f: FilaAlumnosRecorrido) => textoOVacio(f.paradas) },
    { clave: 'estado', encabezado: 'Estado', valor: (f: FilaAlumnosRecorrido) => ETIQUETA_ESTADO_INSCRIPCION[f.estado] },
    { clave: 'inscripcion', encabezado: 'Inscripción', valor: (f: FilaAlumnosRecorrido) => fecha(f.fecha_inscripcion) },
    { clave: 'cancelacion', encabezado: 'Cancelación', valor: (f: FilaAlumnosRecorrido) => fecha(f.fecha_cancelacion) },
  ] as Columna<never>[],
  'docentes-por-nivel': [
    { clave: 'nivel', encabezado: 'Nivel', valor: (f: FilaDocentesNivel) => f.nivel_nombre },
    { clave: 'apellido', encabezado: 'Apellido', valor: (f: FilaDocentesNivel) => f.docente_apellido },
    { clave: 'nombre', encabezado: 'Nombre', valor: (f: FilaDocentesNivel) => f.docente_nombre },
    { clave: 'especialidad', encabezado: 'Especialidad', valor: (f: FilaDocentesNivel) => textoOVacio(f.especialidad) },
    {
      clave: 'estado',
      encabezado: 'Estado del docente',
      valor: (f: FilaDocentesNivel) => (f.docente_estado === 'INACTIVO' ? 'Inactivo' : f.docente_estado === 'ACTIVO' ? 'Activo' : VACIO),
    },
    { clave: 'origen', encabezado: 'Origen', valor: (f: FilaDocentesNivel) => ETIQUETA_ORIGEN[f.origen] },
    { clave: 'actividad', encabezado: 'Materia o deporte', valor: (f: FilaDocentesNivel) => f.actividad_nombre },
    {
      clave: 'detalle',
      encabezado: 'Curso o grupo',
      valor: (f: FilaDocentesNivel) =>
        f.origen === 'ACADEMICO' ? nombreCurso(f.curso_denominacion, f.curso_division) : textoOVacio(f.grupo_nombre),
    },
  ] as Columna<never>[],
}

/** Columnas de un reporte, en el orden en que se muestran y se exportan. */
export function columnasDe(id: IdReporte): Columna[] {
  return COLUMNAS[id] as unknown as Columna[]
}

/** Título de la tarjeta de una fila en pantallas angostas: siempre la persona. */
export function tituloDeFila(id: IdReporte, fila: FilaReporte): string {
  const apellido = columnasDe(id).find((c) => c.clave === 'apellido')?.valor(fila) ?? ''
  const nombre = columnasDe(id).find((c) => c.clave === 'nombre')?.valor(fila) ?? ''
  return `${apellido}, ${nombre}`
}

/** Claves de las columnas que ya componen el título de la tarjeta. */
export const CLAVES_DEL_TITULO: readonly string[] = ['apellido', 'nombre']

/** Texto de cada celda de una fila, en el orden de las columnas. */
export function celdasDeFila(id: IdReporte, fila: FilaReporte): string[] {
  return columnasDe(id).map((columna) => columna.valor(fila))
}

// ----------------------------------------------------------------
// Descripción de los filtros aplicados
// ----------------------------------------------------------------

export type Catalogos = {
  niveles: { id: number; nombre: string }[]
  cursos: { id: string; nivel_id: number; denominacion: string; division: string; activo: boolean }[]
  materias: { id: number; nombre: string; activo: boolean }[]
  deportes: { id: string; nombre: string; activo: boolean }[]
  recorridos: { id: string; codigo: string; nombre: string; activo: boolean }[]
  horarios: { id: string; dia_semana: number; hora_inicio: string; hora_fin: string }[]
  profesores: { id: string; apellido: string; nombre: string }[]
}

export function etiquetaHorario(horario: Catalogos['horarios'][number]): string {
  return `${nombreDia(horario.dia_semana)} ${horario.hora_inicio} a ${horario.hora_fin}`
}

/**
 * Filtros aplicados, ya en palabras («Nivel: Primario»), para el encabezado de
 * la pantalla y de la impresión. Un identificador que el catálogo no conoce se
 * muestra como «desconocido» en lugar de inventar un nombre.
 */
export function describirFiltros(
  reporte: DefinicionReporte,
  filtros: FiltrosReporte,
  catalogos: Catalogos | null
): { etiqueta: string; valor: string }[] {
  const lista: { etiqueta: string; valor: string }[] = []
  const buscar = <T extends { id: string | number }>(items: T[] | undefined, id: string | number, texto: (item: T) => string) => {
    const encontrado = items?.find((item) => item.id === id)
    return encontrado ? texto(encontrado) : 'desconocido'
  }

  if (filtros.q) lista.push({ etiqueta: 'Búsqueda', valor: filtros.q })
  if (filtros.nivel !== undefined)
    lista.push({ etiqueta: 'Nivel', valor: buscar(catalogos?.niveles, filtros.nivel, (n) => n.nombre) })
  if (filtros.curso)
    lista.push({ etiqueta: 'Curso', valor: buscar(catalogos?.cursos, filtros.curso, (c) => `${c.denominacion} ${c.division}`) })
  if (filtros.materia !== undefined)
    lista.push({ etiqueta: 'Materia', valor: buscar(catalogos?.materias, filtros.materia, (m) => m.nombre) })
  if (filtros.deporte)
    lista.push({ etiqueta: 'Deporte', valor: buscar(catalogos?.deportes, filtros.deporte, (d) => d.nombre) })
  if (filtros.recorrido)
    lista.push({ etiqueta: 'Recorrido', valor: buscar(catalogos?.recorridos, filtros.recorrido, (r) => `${r.nombre} (${r.codigo})`) })
  if (filtros.horario)
    lista.push({ etiqueta: 'Horario', valor: buscar(catalogos?.horarios, filtros.horario, etiquetaHorario) })
  if (filtros.responsable)
    lista.push({
      etiqueta: 'Profesor responsable',
      valor: buscar(catalogos?.profesores, filtros.responsable, (p) => `${p.apellido}, ${p.nombre}`),
    })
  if (filtros.origen) lista.push({ etiqueta: 'Origen', valor: ETIQUETA_ORIGEN[filtros.origen] })
  lista.push({
    etiqueta: 'Historial',
    valor: reporte.historial ? (filtros.historial ? 'Incluido' : 'No incluido (solo vigentes)') : 'No disponible',
  })
  return lista
}

// ----------------------------------------------------------------
// CSV
// ----------------------------------------------------------------

/**
 * Separador de campos: punto y coma. En una planilla configurada en español de
 * Argentina el separador de listas es «;», y con «,» cada fila se abriría en una
 * sola columna. LibreOffice y Google Sheets detectan ambos.
 */
export const SEPARADOR_CSV = ';'
export const SALTO_CSV = '\r\n'

/** Marca de orden de bytes UTF-8: sin ella, Excel lee las tildes como caracteres rotos. */
export const BOM_UTF8 = '﻿'

/**
 * Celda de CSV, con dos defensas:
 *
 *  1. Escape (RFC 4180): si contiene el separador, comillas, o un salto de línea,
 *     se encierra entre comillas y las comillas internas se duplican.
 *  2. Neutralización de fórmulas de planilla (inyección CSV): una celda que
 *     empieza con `=`, `+`, `-`, `@`, tabulación o retorno de carro —incluso
 *     precedida por espacios— se ejecutaría como fórmula al abrirla. Se antepone
 *     un apóstrofo, que las planillas muestran como texto.
 */
export function celdaCsv(valor: string): string {
  let texto = valor
  if (/^[\s]*[=+\-@]/.test(texto) || /^[\t\r]/.test(texto)) texto = `'${texto}`
  if (texto.includes(SEPARADOR_CSV) || /["\r\n]/.test(texto)) texto = `"${texto.replace(/"/g, '""')}"`
  return texto
}

export function filaCsv(celdas: readonly string[]): string {
  return celdas.map(celdaCsv).join(SEPARADOR_CSV)
}

/** CSV completo de un reporte: BOM, encabezados legibles en español y una línea por fila. */
export function construirCsv(id: IdReporte, filas: readonly FilaReporte[]): string {
  const encabezados = columnasDe(id).map((columna) => columna.encabezado)
  const lineas = [filaCsv(encabezados), ...filas.map((fila) => filaCsv(celdasDeFila(id, fila)))]
  return BOM_UTF8 + lineas.join(SALTO_CSV) + SALTO_CSV
}

const FORMATO_FECHA_ARCHIVO = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: 'America/Argentina/Buenos_Aires',
})

/** «reporte-alumnos-por-curso-2026-09-29.csv». */
export function nombreArchivoCsv(id: IdReporte, ahora: Date = new Date()): string {
  return `reporte-${id}-${FORMATO_FECHA_ARCHIVO.format(ahora)}.csv`
}
