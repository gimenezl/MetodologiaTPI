-- ============================================================
-- EDUCAR PARA TRANSFORMAR — Reportes oficiales de la Dirección (EPT-63, RF17)
-- ============================================================
-- Migración aditiva. No modifica ni renumera 001 a 016, ni las de EPT-57 a
-- EPT-62, y no escribe ninguna fila: solo agrega funciones de lectura.
--
-- RF17 pide los listados oficiales de la Dirección: alumnos por curso, materia,
-- deporte, nivel, horario y recorrido, y docentes por nivel, con el responsable
-- (el PROFESOR responsable de una materia o de un grupo deportivo). Cada reporte
-- debe obtenerse en menos de un minuto y leer las MISMAS relaciones que usan las
-- operaciones diarias. No se copia ningún dato: solo se leen las tablas.
--
-- ============================================================
-- DISEÑO: SEIS REPORTES CON GRANO DECLARADO Y FILTROS CRUZADOS
-- ============================================================
-- No son nueve listados aislados. Cada reporte declara UNA relación como grano
-- (una fila = una relación), y todos aceptan el mismo conjunto de filtros
-- combinables. Un filtro cuya dimensión pertenece al grano del reporte acota las
-- FILAS; los demás seleccionan ALUMNOS mediante una semiunión (EXISTS) sobre su
-- situación vigente. Como una semiunión nunca multiplica filas, un alumno con
-- varias materias, varios deportes y varias franjas no aparece duplicado por un
-- cruce. Ningún resultado es un producto cartesiano.
--
--   reporte                      grano (una fila =)                          origen de los datos
--   ---------------------------  ------------------------------------------  ---------------------------------
--   reporte_alumnos_curso        una matrícula (alumno × curso × período)    matriculas
--   reporte_alumnos_materia      una matrícula VIGENTE × materia del curso   matriculas × materias_cursos
--   reporte_alumnos_deporte      una inscripción deportiva                   inscripciones_deportivas
--   reporte_alumnos_horario      un alumno × una franja semanal              matriculas/materias_cursos_horarios
--                                                                            e inscripciones/grupos_..._horarios
--   reporte_alumnos_recorrido    una inscripción a un recorrido              inscripciones_servicios (TRANSPORTE)
--   reporte_docentes_nivel       un docente × una asignación                 materias_cursos y grupos_deportivos
--
-- El «nivel» de un alumno se deriva SIEMPRE de su matrícula vigente → curso →
-- nivel (008); nunca se copia. Alumno × materia se deriva de las materias
-- asignadas al curso de su matrícula (materias_cursos, 012): no existe una
-- inscripción individual por materia y esta migración no la inventa.
--
-- Semántica de los filtros (todos opcionales y combinables, conjuntivos):
--   * curso, nivel, materia, deporte, recorrido, horario, responsable: ver la
--     columna «fila» de la tabla de cada función. Lo que no acota la fila
--     selecciona alumnos por su situación VIGENTE.
--   * origen (ACADEMICO | DEPORTIVO): solo en horario y docentes, donde cada
--     fila identifica el suyo. Nunca se mezclan relaciones en una misma columna.
--   * incluir historial: solo donde el esquema REGISTRA la historia con fechas.
--
-- ============================================================
-- HISTORIAL: QUÉ SE PUEDE AFIRMAR Y QUÉ NO
-- ============================================================
-- Por defecto se muestran las relaciones activas o vigentes. Con
-- `p_incluir_historial = true`:
--   * matrícula        → se agregan las cerradas, con fecha_cierre y motivo (008).
--   * deportes         → se agregan las CANCELADAS, con su fecha (014).
--   * recorrido        → se agregan las CANCELADAS, con su fecha (013, EPT-60).
-- En materias, horarios y docentes el parámetro NO existe: `materias_cursos` y
-- `grupos_deportivos` guardan solo el estado actual (`activo`) y el responsable
-- actual (`profesor_id`); no registran desde ni hasta cuándo una asignación
-- estuvo vigente ni quién fue el responsable anterior. Presentar esas filas como
-- «historia» sería afirmar lo que el esquema no sabe. Por la misma razón, la
-- columna «responsable» de una inscripción deportiva CANCELADA es el responsable
-- ACTUAL del grupo, no necesariamente el de la fecha de la inscripción.
--
-- ============================================================
-- SEGURIDAD EN DOS FRONTERAS
-- ============================================================
--   1. Servidor/API: sesión + rol DIRECTOR (src/services/autorizacion.ts).
--   2. PostgreSQL (esta migración): cada función se ejecuta como SECURITY
--      INVOKER —RLS y privilegios de quien consulta siguen vigentes— y ADEMÁS
--      exige explícitamente `public.es_director_actual()` antes de leer nada.
--
-- `security_invoker` por sí solo NO demuestra exclusividad de Dirección: varias
-- tablas de origen admiten SELECT a cualquier sesión autenticada (cursos,
-- niveles, horarios, deportes, servicios_escolares) y otras a cada alumno sobre
-- sus propias filas. Por eso el predicado de Dirección es explícito.
-- Un actor que no es Dirección recibe 42501 (o P5505 sin identidad) ANTES de que
-- se lea cualquier fila; nunca obtiene «cero filas» que delaten datos.
-- EXECUTE solo para `authenticated`. Ninguna función recibe actor, rol ni
-- perfil: la identidad la deriva PostgreSQL de `auth.uid()`.
--
-- Privacidad: los reportes NO exponen `confirmada_por` ni ninguna variante de
-- nombre o identificador del confirmador, ni la marca de confirmación de
-- EPT-62. No se reutilizan `matriculas_administracion` ni las otras dos vistas
-- de EPT-62 (traen esas columnas y unen `confirmaciones_inscripcion` sin que un
-- reporte las necesite): los reportes leen las MISMAS tablas base de las que esas
-- vistas derivan, sin la unión. Tampoco se exponen DNI, teléfono, domicilio ni
-- fecha de nacimiento.
--
-- ============================================================
-- PAGINACIÓN
-- ============================================================
-- `p_limite` (1–1000) y `p_desplazamiento` (≥ 0). El orden es TOTAL: el último
-- criterio es la clave de la fila, de modo que dos páginas nunca repiten ni
-- saltean filas. Cada fila trae `total_filas` (el total del conjunto filtrado,
-- calculado con una ventana): quien pide una página fuera de rango recibe cero
-- filas. La API recorta cada respuesta a 1000 filas SIN error; la exportación y
-- la impresión recorren TODAS las páginas con `leerTodasLasFilas`.
--
-- ============================================================
-- CÓDIGOS SQLSTATE PROPIOS
-- ============================================================
-- Bloque nuevo P6301, sin colisión con P550x–P561x, P590x–P597x ni P6201–P6204.
--   P6301  un parámetro del reporte es inválido (página, origen, texto)
-- Reutilizados: P5505 (identidad ausente) y 42501 (rol insuficiente).
--
-- ============================================================
-- REVERSIÓN NO DESTRUCTIVA
-- ============================================================
-- La migración no toca ninguna fila ni ninguna tabla. Para revertirla:
--
--   DROP FUNCTION public.catalogos_reportes();
--   DROP FUNCTION public.reporte_docentes_nivel(text, integer, uuid, integer, uuid, uuid, uuid, text, integer, integer);
--   DROP FUNCTION public.reporte_alumnos_recorrido(text, integer, uuid, integer, uuid, uuid, uuid, uuid, boolean, integer, integer);
--   DROP FUNCTION public.reporte_alumnos_horario(text, integer, uuid, integer, uuid, uuid, uuid, uuid, text, integer, integer);
--   DROP FUNCTION public.reporte_alumnos_deporte(text, integer, uuid, integer, uuid, uuid, uuid, uuid, boolean, integer, integer);
--   DROP FUNCTION public.reporte_alumnos_materia(text, integer, uuid, integer, uuid, uuid, uuid, uuid, integer, integer);
--   DROP FUNCTION public.reporte_alumnos_curso(text, integer, uuid, integer, uuid, uuid, uuid, uuid, boolean, integer, integer);
--   DROP FUNCTION app_private.reporte_alumnos_filtrados(text, integer, uuid, integer, uuid, uuid, uuid, uuid);
--   DROP FUNCTION app_private.preparar_reporte(text, integer, integer, text);
--   DROP FUNCTION app_private.exigir_director_reporte();
-- ============================================================


-- ================================================================
-- 1. PRECONDICIONES
-- ================================================================
DO $$
BEGIN
    IF pg_catalog.to_regclass('public.matriculas') IS NULL
       OR pg_catalog.to_regclass('public.alumnos') IS NULL
       OR pg_catalog.to_regclass('public.perfiles') IS NULL
       OR pg_catalog.to_regclass('public.cursos') IS NULL
       OR pg_catalog.to_regclass('public.niveles') IS NULL
       OR pg_catalog.to_regclass('public.actividades') IS NULL
       OR pg_catalog.to_regclass('public.materias_cursos') IS NULL
       OR pg_catalog.to_regclass('public.materias_cursos_horarios') IS NULL
       OR pg_catalog.to_regclass('public.horarios') IS NULL
       OR pg_catalog.to_regclass('public.deportes') IS NULL
       OR pg_catalog.to_regclass('public.grupos_deportivos') IS NULL
       OR pg_catalog.to_regclass('public.grupos_deportivos_horarios') IS NULL
       OR pg_catalog.to_regclass('public.inscripciones_deportivas') IS NULL
       OR pg_catalog.to_regclass('public.inscripciones_servicios') IS NULL
       OR pg_catalog.to_regclass('public.servicios_escolares') IS NULL
       OR pg_catalog.to_regclass('public.paradas_recorrido') IS NULL
       OR pg_catalog.to_regclass('public.profesores') IS NULL
       OR pg_catalog.to_regclass('public.roles') IS NULL
    THEN
        RAISE EXCEPTION
            'Migración EPT-63: faltan tablas base; la base no corresponde a 001–016 + EPT-57/58/59/60/61/62.';
    END IF;

    IF pg_catalog.to_regprocedure('public.es_director_actual()') IS NULL THEN
        RAISE EXCEPTION
            'Migración EPT-63: falta public.es_director_actual(); la base no corresponde a lo esperado.';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('public', 'app_private')
          AND (p.proname LIKE 'reporte\_%' OR p.proname IN ('catalogos_reportes',
                                                            'exigir_director_reporte',
                                                            'preparar_reporte'))
    ) THEN
        RAISE EXCEPTION
            'Migración EPT-63: ya existen objetos de reportes; revisá el estado de la base antes de continuar.';
    END IF;
END $$;


-- ================================================================
-- 2. AUXILIARES PRIVADOS
-- ================================================================
-- Viven en `app_private` (la Data API no lo expone). Son SECURITY INVOKER: no
-- elevan ningún privilegio, así que RLS sigue decidiendo qué filas se leen.

-- Guardia de Dirección. Identidad primero, rol después y antes de mirar
-- cualquier dato: quien no administra no aprende nada sobre las filas.
CREATE OR REPLACE FUNCTION app_private.exigir_director_reporte()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    IF NOT (SELECT public.es_director_actual()) THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Solo la dirección puede consultar los reportes oficiales.';
    END IF;
END;
$$;

-- Guardia común de cada reporte: Dirección, validación de los parámetros de
-- página y de origen, y normalización del texto de búsqueda. Devuelve el patrón
-- ILIKE ya escapado (NULL si no hay búsqueda), de modo que un `%` o un `_` que
-- escriba la persona se busque literalmente.
CREATE OR REPLACE FUNCTION app_private.preparar_reporte(
    p_busqueda       text,
    p_limite         integer,
    p_desplazamiento integer,
    p_origen         text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_texto text;
BEGIN
    PERFORM app_private.exigir_director_reporte();

    IF p_limite IS NULL OR p_limite < 1 OR p_limite > 1000 THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P6301',
            MESSAGE = 'El tamaño de página debe estar entre 1 y 1000.';
    END IF;

    IF p_desplazamiento IS NULL OR p_desplazamiento < 0 THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P6301',
            MESSAGE = 'El desplazamiento no puede ser negativo.';
    END IF;

    IF p_origen IS NOT NULL AND p_origen NOT IN ('ACADEMICO', 'DEPORTIVO') THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P6301',
            MESSAGE = 'El origen debe ser ACADEMICO o DEPORTIVO.';
    END IF;

    v_texto := pg_catalog.btrim(p_busqueda);
    IF v_texto IS NULL OR v_texto = '' THEN
        RETURN NULL;
    END IF;

    IF pg_catalog.char_length(v_texto) > 100 THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P6301',
            MESSAGE = 'El texto de búsqueda no puede superar los 100 caracteres.';
    END IF;

    RETURN '%' || pg_catalog.regexp_replace(v_texto, '([\\%_])', '\\\1', 'g') || '%';
END;
$$;

-- Alumnos que cumplen los filtros que NO acotan filas del reporte que llama.
-- Cada filtro no nulo agrega UNA semiunión (EXISTS) sobre la situación VIGENTE
-- del alumno:
--   nivel / curso  → matrícula vigente en ese nivel / curso
--   materia        → matrícula vigente en un curso con esa materia activa
--   deporte        → inscripción deportiva ACTIVA en ese deporte
--   recorrido      → inscripción ACTIVA a ese recorrido
--   horario        → una franja activa con ese horario, ACADÉMICA o DEPORTIVA
--   responsable    → una materia activa de su curso o un grupo de una
--                    inscripción ACTIVA cuyo profesor responsable sea esa persona
--   texto          → apellido, nombre, «apellido nombre», «nombre apellido» o
--                    legajo contienen el patrón
--
-- Es SQL dinámico solo para incluir las semiuniones que hacen falta: el texto
-- lo componen fragmentos fijos de esta función y ningún valor del llamador se
-- concatena, todos viajan como parámetros ($1…$8). Devuelve identificadores
-- únicos: un alumno nunca se repite.
CREATE OR REPLACE FUNCTION app_private.reporte_alumnos_filtrados(
    p_patron      text,
    p_nivel_id    integer,
    p_curso_id    uuid,
    p_materia_id  integer,
    p_deporte_id  uuid,
    p_servicio_id uuid,
    p_horario_id  uuid,
    p_profesor_id uuid
)
RETURNS SETOF uuid
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
ROWS 3000
AS $$
DECLARE
    v_sql text := 'SELECT a.perfil_id FROM public.alumnos a WHERE TRUE';
BEGIN
    PERFORM app_private.exigir_director_reporte();

    IF p_patron IS NOT NULL THEN
        v_sql := v_sql
            || ' AND EXISTS (SELECT 1 FROM public.perfiles p WHERE p.id = a.perfil_id'
            || ' AND (p.apellido ILIKE $1 OR p.nombre ILIKE $1'
            || ' OR (p.apellido || '' '' || p.nombre) ILIKE $1'
            || ' OR (p.nombre || '' '' || p.apellido) ILIKE $1'
            || ' OR p.legajo_nro ILIKE $1))';
    END IF;

    IF p_nivel_id IS NOT NULL OR p_curso_id IS NOT NULL THEN
        v_sql := v_sql
            || ' AND EXISTS (SELECT 1 FROM public.matriculas m'
            || ' JOIN public.cursos c ON c.id = m.curso_id'
            || ' WHERE m.alumno_id = a.perfil_id AND m.fecha_cierre IS NULL'
            || CASE WHEN p_nivel_id IS NOT NULL THEN ' AND c.nivel_id = $2' ELSE '' END
            || CASE WHEN p_curso_id IS NOT NULL THEN ' AND m.curso_id = $3' ELSE '' END
            || ')';
    END IF;

    IF p_materia_id IS NOT NULL THEN
        v_sql := v_sql
            || ' AND EXISTS (SELECT 1 FROM public.matriculas m'
            || ' JOIN public.materias_cursos mc ON mc.curso_id = m.curso_id AND mc.activo'
            || ' JOIN public.actividades ma ON ma.id = mc.materia_id AND ma.activo'
            || ' WHERE m.alumno_id = a.perfil_id AND m.fecha_cierre IS NULL'
            || ' AND mc.materia_id = $4)';
    END IF;

    IF p_deporte_id IS NOT NULL THEN
        v_sql := v_sql
            || ' AND EXISTS (SELECT 1 FROM public.inscripciones_deportivas i'
            || ' WHERE i.alumno_id = a.perfil_id AND i.estado = ''ACTIVA'''
            || ' AND i.deporte_id = $5)';
    END IF;

    IF p_servicio_id IS NOT NULL THEN
        v_sql := v_sql
            || ' AND EXISTS (SELECT 1 FROM public.inscripciones_servicios i'
            || ' WHERE i.alumno_id = a.perfil_id AND i.estado = ''ACTIVA'''
            || ' AND i.servicio_id = $6)';
    END IF;

    IF p_horario_id IS NOT NULL THEN
        v_sql := v_sql
            || ' AND (EXISTS (SELECT 1 FROM public.matriculas m'
            || ' JOIN public.materias_cursos mc ON mc.curso_id = m.curso_id AND mc.activo'
            || ' JOIN public.materias_cursos_horarios ah ON ah.asignacion_id = mc.id AND ah.activo'
            || ' WHERE m.alumno_id = a.perfil_id AND m.fecha_cierre IS NULL'
            || ' AND ah.horario_id = $7)'
            || ' OR EXISTS (SELECT 1 FROM public.inscripciones_deportivas i'
            || ' JOIN public.grupos_deportivos g ON g.id = i.grupo_id AND g.activo'
            || ' JOIN public.grupos_deportivos_horarios gh ON gh.grupo_id = g.id AND gh.activo'
            || ' WHERE i.alumno_id = a.perfil_id AND i.estado = ''ACTIVA'''
            || ' AND gh.horario_id = $7))';
    END IF;

    IF p_profesor_id IS NOT NULL THEN
        v_sql := v_sql
            || ' AND (EXISTS (SELECT 1 FROM public.matriculas m'
            || ' JOIN public.materias_cursos mc ON mc.curso_id = m.curso_id AND mc.activo'
            || ' WHERE m.alumno_id = a.perfil_id AND m.fecha_cierre IS NULL'
            || ' AND mc.profesor_id = $8)'
            || ' OR EXISTS (SELECT 1 FROM public.inscripciones_deportivas i'
            || ' JOIN public.grupos_deportivos g ON g.id = i.grupo_id AND g.activo'
            || ' WHERE i.alumno_id = a.perfil_id AND i.estado = ''ACTIVA'''
            || ' AND g.profesor_id = $8))';
    END IF;

    RETURN QUERY EXECUTE v_sql
        USING p_patron, p_nivel_id, p_curso_id, p_materia_id,
              p_deporte_id, p_servicio_id, p_horario_id, p_profesor_id;
END;
$$;

REVOKE ALL ON FUNCTION app_private.exigir_director_reporte()
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.preparar_reporte(text, integer, integer, text)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.reporte_alumnos_filtrados(text, integer, uuid, integer, uuid, uuid, uuid, uuid)
    FROM PUBLIC, anon, authenticated, service_role;

-- SECURITY INVOKER: quien ejecuta el reporte ejecuta también estos auxiliares,
-- así que `authenticated` necesita EXECUTE. Cada uno vuelve a exigir Dirección.
GRANT EXECUTE ON FUNCTION app_private.exigir_director_reporte() TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.preparar_reporte(text, integer, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.reporte_alumnos_filtrados(text, integer, uuid, integer, uuid, uuid, uuid, uuid)
    TO authenticated;


-- ================================================================
-- 3. ALUMNOS POR CURSO Y NIVEL
-- ================================================================
-- Grano: una MATRÍCULA (alumno × curso × período).
-- Fila:    nivel, curso, historial (propios de la matrícula).
-- Alumno:  materia, deporte, recorrido, horario, responsable, texto.
CREATE OR REPLACE FUNCTION public.reporte_alumnos_curso(
    p_busqueda          text    DEFAULT NULL,
    p_nivel_id          integer DEFAULT NULL,
    p_curso_id          uuid    DEFAULT NULL,
    p_materia_id        integer DEFAULT NULL,
    p_deporte_id        uuid    DEFAULT NULL,
    p_servicio_id       uuid    DEFAULT NULL,
    p_horario_id        uuid    DEFAULT NULL,
    p_profesor_id       uuid    DEFAULT NULL,
    p_incluir_historial boolean DEFAULT false,
    p_limite            integer DEFAULT 100,
    p_desplazamiento    integer DEFAULT 0
)
RETURNS TABLE (
    id                 uuid,
    alumno_apellido    text,
    alumno_nombre      text,
    legajo_nro         text,
    alumno_estado      public.estado_alumno,
    nivel_id           integer,
    nivel_nombre       text,
    curso_id           uuid,
    curso_denominacion text,
    curso_division     text,
    fecha_inicio       timestamp with time zone,
    fecha_cierre       timestamp with time zone,
    motivo_cierre      public.motivo_cierre_matricula,
    vigente            boolean,
    total_filas        bigint
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
SET plan_cache_mode = force_custom_plan
AS $$
#variable_conflict use_column
DECLARE
    v_patron text;
    v_cruces boolean;
BEGIN
    v_patron := app_private.preparar_reporte(p_busqueda, p_limite, p_desplazamiento);
    v_cruces := v_patron IS NOT NULL OR p_materia_id IS NOT NULL OR p_deporte_id IS NOT NULL
                OR p_servicio_id IS NOT NULL OR p_horario_id IS NOT NULL OR p_profesor_id IS NOT NULL;

    RETURN QUERY
    SELECT m.id,
           p.apellido::text,
           p.nombre::text,
           p.legajo_nro::text,
           a.estado,
           c.nivel_id,
           n.nombre::text,
           c.id,
           c.denominacion::text,
           c.division::text,
           m.fecha_inicio,
           m.fecha_cierre,
           m.motivo_cierre,
           (m.fecha_cierre IS NULL),
           pg_catalog.count(*) OVER ()
    FROM public.matriculas m
    JOIN public.alumnos a ON a.perfil_id = m.alumno_id
    JOIN public.perfiles p ON p.id = m.alumno_id
    JOIN public.cursos c ON c.id = m.curso_id
    JOIN public.niveles n ON n.id = c.nivel_id
    WHERE (p_incluir_historial OR m.fecha_cierre IS NULL)
      AND (p_nivel_id IS NULL OR c.nivel_id = p_nivel_id)
      AND (p_curso_id IS NULL OR m.curso_id = p_curso_id)
      AND (NOT v_cruces OR m.alumno_id IN (
              SELECT f.alumno
              FROM app_private.reporte_alumnos_filtrados(
                       v_patron, NULL, NULL, p_materia_id, p_deporte_id,
                       p_servicio_id, p_horario_id, p_profesor_id) AS f(alumno)))
    ORDER BY p.apellido, p.nombre, m.fecha_inicio DESC, m.id
    LIMIT p_limite OFFSET p_desplazamiento;
END;
$$;


-- ================================================================
-- 4. ALUMNOS POR MATERIA
-- ================================================================
-- Grano: una matrícula VIGENTE × una materia ACTIVA de su curso. La materia del
-- alumno se deriva de las asignadas al curso: no hay inscripción por materia.
-- Fila:    nivel, curso, materia, responsable.
-- Alumno:  deporte, recorrido, horario, texto.
-- Sin historial: `materias_cursos` no registra desde cuándo rige una asignación.
CREATE OR REPLACE FUNCTION public.reporte_alumnos_materia(
    p_busqueda       text    DEFAULT NULL,
    p_nivel_id       integer DEFAULT NULL,
    p_curso_id       uuid    DEFAULT NULL,
    p_materia_id     integer DEFAULT NULL,
    p_deporte_id     uuid    DEFAULT NULL,
    p_servicio_id    uuid    DEFAULT NULL,
    p_horario_id     uuid    DEFAULT NULL,
    p_profesor_id    uuid    DEFAULT NULL,
    p_limite         integer DEFAULT 100,
    p_desplazamiento integer DEFAULT 0
)
RETURNS TABLE (
    id                   text,
    alumno_apellido      text,
    alumno_nombre        text,
    legajo_nro           text,
    nivel_id             integer,
    nivel_nombre         text,
    curso_id             uuid,
    curso_denominacion   text,
    curso_division       text,
    materia_id           integer,
    materia_nombre       text,
    responsable_apellido text,
    responsable_nombre   text,
    total_filas          bigint
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
SET plan_cache_mode = force_custom_plan
AS $$
#variable_conflict use_column
DECLARE
    v_patron text;
    v_cruces boolean;
BEGIN
    v_patron := app_private.preparar_reporte(p_busqueda, p_limite, p_desplazamiento);
    v_cruces := v_patron IS NOT NULL OR p_deporte_id IS NOT NULL
                OR p_servicio_id IS NOT NULL OR p_horario_id IS NOT NULL;

    RETURN QUERY
    SELECT (m.id::text || ':' || mc.id::text),
           p.apellido::text,
           p.nombre::text,
           p.legajo_nro::text,
           c.nivel_id,
           n.nombre::text,
           c.id,
           c.denominacion::text,
           c.division::text,
           ma.id,
           ma.nombre::text,
           pr.apellido::text,
           pr.nombre::text,
           pg_catalog.count(*) OVER ()
    FROM public.matriculas m
    JOIN public.alumnos a ON a.perfil_id = m.alumno_id
    JOIN public.perfiles p ON p.id = m.alumno_id
    JOIN public.cursos c ON c.id = m.curso_id
    JOIN public.niveles n ON n.id = c.nivel_id
    JOIN public.materias_cursos mc ON mc.curso_id = m.curso_id AND mc.activo
    JOIN public.actividades ma ON ma.id = mc.materia_id AND ma.activo AND ma.tipo = 'CURRICULAR'
    LEFT JOIN public.perfiles pr ON pr.id = mc.profesor_id
    WHERE m.fecha_cierre IS NULL
      AND (p_nivel_id IS NULL OR c.nivel_id = p_nivel_id)
      AND (p_curso_id IS NULL OR m.curso_id = p_curso_id)
      AND (p_materia_id IS NULL OR ma.id = p_materia_id)
      AND (p_profesor_id IS NULL OR mc.profesor_id = p_profesor_id)
      AND (NOT v_cruces OR m.alumno_id IN (
              SELECT f.alumno
              FROM app_private.reporte_alumnos_filtrados(
                       v_patron, NULL, NULL, NULL, p_deporte_id,
                       p_servicio_id, p_horario_id, NULL) AS f(alumno)))
    ORDER BY p.apellido, p.nombre, ma.nombre, m.id, mc.id
    LIMIT p_limite OFFSET p_desplazamiento;
END;
$$;


-- ================================================================
-- 5. ALUMNOS POR DEPORTE
-- ================================================================
-- Grano: una INSCRIPCIÓN DEPORTIVA. El nivel es el del GRUPO.
-- Fila:    nivel (del grupo), deporte, responsable (del grupo), historial.
-- Alumno:  curso, materia, recorrido, horario, texto.
CREATE OR REPLACE FUNCTION public.reporte_alumnos_deporte(
    p_busqueda          text    DEFAULT NULL,
    p_nivel_id          integer DEFAULT NULL,
    p_curso_id          uuid    DEFAULT NULL,
    p_materia_id        integer DEFAULT NULL,
    p_deporte_id        uuid    DEFAULT NULL,
    p_servicio_id       uuid    DEFAULT NULL,
    p_horario_id        uuid    DEFAULT NULL,
    p_profesor_id       uuid    DEFAULT NULL,
    p_incluir_historial boolean DEFAULT false,
    p_limite            integer DEFAULT 100,
    p_desplazamiento    integer DEFAULT 0
)
RETURNS TABLE (
    id                   uuid,
    alumno_apellido      text,
    alumno_nombre        text,
    legajo_nro           text,
    curso_denominacion   text,
    curso_division       text,
    nivel_id             integer,
    nivel_nombre         text,
    deporte_id           uuid,
    deporte_nombre       text,
    grupo_id             uuid,
    grupo_nombre         text,
    responsable_apellido text,
    responsable_nombre   text,
    estado               public.estado_inscripcion_deportiva,
    fecha_inscripcion    timestamp with time zone,
    fecha_cancelacion    timestamp with time zone,
    total_filas          bigint
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
SET plan_cache_mode = force_custom_plan
AS $$
#variable_conflict use_column
DECLARE
    v_patron text;
    v_cruces boolean;
BEGIN
    v_patron := app_private.preparar_reporte(p_busqueda, p_limite, p_desplazamiento);
    v_cruces := v_patron IS NOT NULL OR p_curso_id IS NOT NULL OR p_materia_id IS NOT NULL
                OR p_servicio_id IS NOT NULL OR p_horario_id IS NOT NULL;

    RETURN QUERY
    SELECT i.id,
           p.apellido::text,
           p.nombre::text,
           p.legajo_nro::text,
           c.denominacion::text,
           c.division::text,
           g.nivel_id,
           n.nombre::text,
           d.id,
           d.nombre::text,
           g.id,
           g.nombre::text,
           pr.apellido::text,
           pr.nombre::text,
           i.estado,
           i.fecha_inscripcion,
           i.fecha_cancelacion,
           pg_catalog.count(*) OVER ()
    FROM public.inscripciones_deportivas i
    JOIN public.alumnos a ON a.perfil_id = i.alumno_id
    JOIN public.perfiles p ON p.id = i.alumno_id
    JOIN public.grupos_deportivos g ON g.id = i.grupo_id
    JOIN public.deportes d ON d.id = i.deporte_id
    JOIN public.niveles n ON n.id = g.nivel_id
    LEFT JOIN public.perfiles pr ON pr.id = g.profesor_id
    LEFT JOIN public.matriculas m ON m.alumno_id = i.alumno_id AND m.fecha_cierre IS NULL
    LEFT JOIN public.cursos c ON c.id = m.curso_id
    WHERE (p_incluir_historial OR i.estado = 'ACTIVA')
      AND (p_nivel_id IS NULL OR g.nivel_id = p_nivel_id)
      AND (p_deporte_id IS NULL OR i.deporte_id = p_deporte_id)
      AND (p_profesor_id IS NULL OR g.profesor_id = p_profesor_id)
      AND (NOT v_cruces OR i.alumno_id IN (
              SELECT f.alumno
              FROM app_private.reporte_alumnos_filtrados(
                       v_patron, NULL, p_curso_id, p_materia_id, NULL,
                       p_servicio_id, p_horario_id, NULL) AS f(alumno)))
    ORDER BY p.apellido, p.nombre, d.nombre, i.fecha_inscripcion DESC, i.id
    LIMIT p_limite OFFSET p_desplazamiento;
END;
$$;


-- ================================================================
-- 6. ALUMNOS POR HORARIO
-- ================================================================
-- Grano: un ALUMNO × una FRANJA SEMANAL de una actividad que cursa hoy. Dos
-- orígenes que NO se mezclan: ACADEMICO (franja de una materia del curso de su
-- matrícula vigente) y DEPORTIVO (franja del grupo de una inscripción ACTIVA).
-- Cada fila lleva su origen. Una misma franja horaria que el alumno tenga por
-- las dos vías aparece en DOS filas —una por origen—, que es exactamente el caso
-- que Dirección quiere ver (una superposición).
-- Fila:    horario, origen, nivel (de la actividad), materia, deporte,
--          responsable.
-- Alumno:  curso, recorrido, texto.
-- Sin historial: las franjas y los grupos guardan solo su estado actual.
CREATE OR REPLACE FUNCTION public.reporte_alumnos_horario(
    p_busqueda       text     DEFAULT NULL,
    p_nivel_id       integer  DEFAULT NULL,
    p_curso_id       uuid     DEFAULT NULL,
    p_materia_id     integer  DEFAULT NULL,
    p_deporte_id     uuid     DEFAULT NULL,
    p_servicio_id    uuid     DEFAULT NULL,
    p_horario_id     uuid     DEFAULT NULL,
    p_profesor_id    uuid     DEFAULT NULL,
    p_origen         text     DEFAULT NULL,
    p_limite         integer  DEFAULT 100,
    p_desplazamiento integer  DEFAULT 0
)
RETURNS TABLE (
    id                   text,
    origen               text,
    alumno_apellido      text,
    alumno_nombre        text,
    legajo_nro           text,
    dia_semana           smallint,
    hora_inicio          time without time zone,
    hora_fin             time without time zone,
    actividad_nombre     text,
    curso_denominacion   text,
    curso_division       text,
    grupo_nombre         text,
    nivel_id             integer,
    nivel_nombre         text,
    responsable_apellido text,
    responsable_nombre   text,
    total_filas          bigint
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
SET plan_cache_mode = force_custom_plan
AS $$
#variable_conflict use_column
DECLARE
    v_patron text;
    v_cruces boolean;
BEGIN
    v_patron := app_private.preparar_reporte(p_busqueda, p_limite, p_desplazamiento, p_origen);
    v_cruces := v_patron IS NOT NULL OR p_curso_id IS NOT NULL OR p_servicio_id IS NOT NULL;

    RETURN QUERY
    WITH franjas AS (
        SELECT 'ACADEMICO'::text                            AS origen,
               ('A:' || m.id::text || ':' || ah.id::text)   AS fila_id,
               m.alumno_id                                  AS alumno_id,
               h.dia_semana                                 AS dia_semana,
               h.hora_inicio                                AS hora_inicio,
               h.hora_fin                                   AS hora_fin,
               ma.nombre::text                              AS actividad_nombre,
               c.denominacion::text                         AS curso_denominacion,
               c.division::text                             AS curso_division,
               NULL::text                                   AS grupo_nombre,
               c.nivel_id                                   AS nivel_id,
               mc.profesor_id                               AS responsable_id
        FROM public.matriculas m
        JOIN public.cursos c ON c.id = m.curso_id
        JOIN public.materias_cursos mc ON mc.curso_id = m.curso_id AND mc.activo
        JOIN public.actividades ma ON ma.id = mc.materia_id AND ma.activo AND ma.tipo = 'CURRICULAR'
        JOIN public.materias_cursos_horarios ah ON ah.asignacion_id = mc.id AND ah.activo
        JOIN public.horarios h ON h.id = ah.horario_id
        WHERE m.fecha_cierre IS NULL
          AND (p_origen IS NULL OR p_origen = 'ACADEMICO')
          AND p_deporte_id IS NULL
          AND (p_nivel_id IS NULL OR c.nivel_id = p_nivel_id)
          AND (p_materia_id IS NULL OR ma.id = p_materia_id)
          AND (p_horario_id IS NULL OR h.id = p_horario_id)
          AND (p_profesor_id IS NULL OR mc.profesor_id = p_profesor_id)
        UNION ALL
        SELECT 'DEPORTIVO'::text,
               ('D:' || i.id::text || ':' || gh.id::text),
               i.alumno_id,
               h.dia_semana,
               h.hora_inicio,
               h.hora_fin,
               d.nombre::text,
               NULL::text,
               NULL::text,
               g.nombre::text,
               g.nivel_id,
               g.profesor_id
        FROM public.inscripciones_deportivas i
        JOIN public.grupos_deportivos g ON g.id = i.grupo_id AND g.activo
        JOIN public.deportes d ON d.id = i.deporte_id
        JOIN public.grupos_deportivos_horarios gh ON gh.grupo_id = g.id AND gh.activo
        JOIN public.horarios h ON h.id = gh.horario_id
        WHERE i.estado = 'ACTIVA'
          AND (p_origen IS NULL OR p_origen = 'DEPORTIVO')
          AND p_materia_id IS NULL
          AND (p_nivel_id IS NULL OR g.nivel_id = p_nivel_id)
          AND (p_deporte_id IS NULL OR i.deporte_id = p_deporte_id)
          AND (p_horario_id IS NULL OR h.id = p_horario_id)
          AND (p_profesor_id IS NULL OR g.profesor_id = p_profesor_id)
    )
    SELECT f.fila_id,
           f.origen,
           p.apellido::text,
           p.nombre::text,
           p.legajo_nro::text,
           f.dia_semana,
           f.hora_inicio,
           f.hora_fin,
           f.actividad_nombre,
           f.curso_denominacion,
           f.curso_division,
           f.grupo_nombre,
           f.nivel_id,
           n.nombre::text,
           pr.apellido::text,
           pr.nombre::text,
           pg_catalog.count(*) OVER ()
    FROM franjas f
    JOIN public.perfiles p ON p.id = f.alumno_id
    JOIN public.niveles n ON n.id = f.nivel_id
    LEFT JOIN public.perfiles pr ON pr.id = f.responsable_id
    WHERE (NOT v_cruces OR f.alumno_id IN (
              SELECT x.alumno
              FROM app_private.reporte_alumnos_filtrados(
                       v_patron, NULL, p_curso_id, NULL, NULL,
                       p_servicio_id, NULL, NULL) AS x(alumno)))
    ORDER BY f.dia_semana, f.hora_inicio, f.hora_fin, p.apellido, p.nombre, f.origen, f.fila_id
    LIMIT p_limite OFFSET p_desplazamiento;
END;
$$;


-- ================================================================
-- 7. ALUMNOS POR RECORRIDO DE TRANSPORTE
-- ================================================================
-- Grano: una INSCRIPCIÓN a un recorrido de TRANSPORTE (el comedor es otro
-- servicio y no entra). El nivel y el curso son los VIGENTES del alumno.
-- Fila:    recorrido, historial.
-- Alumno:  nivel, curso, materia, deporte, horario, responsable, texto.
CREATE OR REPLACE FUNCTION public.reporte_alumnos_recorrido(
    p_busqueda          text    DEFAULT NULL,
    p_nivel_id          integer DEFAULT NULL,
    p_curso_id          uuid    DEFAULT NULL,
    p_materia_id        integer DEFAULT NULL,
    p_deporte_id        uuid    DEFAULT NULL,
    p_servicio_id       uuid    DEFAULT NULL,
    p_horario_id        uuid    DEFAULT NULL,
    p_profesor_id       uuid    DEFAULT NULL,
    p_incluir_historial boolean DEFAULT false,
    p_limite            integer DEFAULT 100,
    p_desplazamiento    integer DEFAULT 0
)
RETURNS TABLE (
    id                 uuid,
    alumno_apellido    text,
    alumno_nombre      text,
    legajo_nro         text,
    nivel_id           integer,
    nivel_nombre       text,
    curso_denominacion text,
    curso_division     text,
    recorrido_id       uuid,
    recorrido_codigo   text,
    recorrido_nombre   text,
    paradas            text,
    estado             public.estado_inscripcion_servicio,
    fecha_inscripcion  timestamp with time zone,
    fecha_cancelacion  timestamp with time zone,
    total_filas        bigint
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
SET plan_cache_mode = force_custom_plan
AS $$
#variable_conflict use_column
DECLARE
    v_patron text;
    v_cruces boolean;
BEGIN
    v_patron := app_private.preparar_reporte(p_busqueda, p_limite, p_desplazamiento);
    v_cruces := v_patron IS NOT NULL OR p_nivel_id IS NOT NULL OR p_curso_id IS NOT NULL
                OR p_materia_id IS NOT NULL OR p_deporte_id IS NOT NULL
                OR p_horario_id IS NOT NULL OR p_profesor_id IS NOT NULL;

    RETURN QUERY
    SELECT i.id,
           p.apellido::text,
           p.nombre::text,
           p.legajo_nro::text,
           c.nivel_id,
           n.nombre::text,
           c.denominacion::text,
           c.division::text,
           s.id,
           s.codigo::text,
           s.nombre::text,
           pa.paradas,
           i.estado,
           i.fecha_inscripcion,
           i.fecha_cancelacion,
           pg_catalog.count(*) OVER ()
    FROM public.inscripciones_servicios i
    JOIN public.servicios_escolares s ON s.id = i.servicio_id AND s.tipo = 'TRANSPORTE'
    JOIN public.alumnos a ON a.perfil_id = i.alumno_id
    JOIN public.perfiles p ON p.id = i.alumno_id
    LEFT JOIN public.matriculas m ON m.alumno_id = i.alumno_id AND m.fecha_cierre IS NULL
    LEFT JOIN public.cursos c ON c.id = m.curso_id
    LEFT JOIN public.niveles n ON n.id = c.nivel_id
    LEFT JOIN LATERAL (
        SELECT pg_catalog.string_agg(pr.orden::text || '. ' || pr.nombre, ' → ' ORDER BY pr.orden) AS paradas
        FROM public.paradas_recorrido pr
        WHERE pr.servicio_id = s.id
    ) pa ON TRUE
    WHERE (p_incluir_historial OR i.estado = 'ACTIVA')
      AND (p_servicio_id IS NULL OR i.servicio_id = p_servicio_id)
      AND (NOT v_cruces OR i.alumno_id IN (
              SELECT f.alumno
              FROM app_private.reporte_alumnos_filtrados(
                       v_patron, p_nivel_id, p_curso_id, p_materia_id, p_deporte_id,
                       NULL, p_horario_id, p_profesor_id) AS f(alumno)))
    ORDER BY s.codigo, p.apellido, p.nombre, i.fecha_inscripcion DESC, i.id
    LIMIT p_limite OFFSET p_desplazamiento;
END;
$$;


-- ================================================================
-- 8. DOCENTES POR NIVEL
-- ================================================================
-- Grano: un DOCENTE × una ASIGNACIÓN vigente como responsable. Dos orígenes que
-- no se mezclan: ACADEMICO (responsable de una materia asignada a un curso) y
-- DEPORTIVO (responsable de un grupo deportivo). Un docente con asignación en
-- ambos orígenes del mismo nivel aparece una vez por asignación, cada una con
-- su origen. Un docente sin ninguna asignación vigente no tiene nivel y no
-- aparece.
-- Todos los filtros acotan filas. `curso` y `materia` solo existen en el origen
-- académico y `deporte` solo en el deportivo; pedir dos dimensiones que no
-- comparten origen devuelve el conjunto vacío, que es lo que corresponde.
-- Sin historial: `materias_cursos` y `grupos_deportivos` guardan solo el
-- responsable actual.
CREATE OR REPLACE FUNCTION public.reporte_docentes_nivel(
    p_busqueda       text    DEFAULT NULL,
    p_nivel_id       integer DEFAULT NULL,
    p_curso_id       uuid    DEFAULT NULL,
    p_materia_id     integer DEFAULT NULL,
    p_deporte_id     uuid    DEFAULT NULL,
    p_horario_id     uuid    DEFAULT NULL,
    p_profesor_id    uuid    DEFAULT NULL,
    p_origen         text    DEFAULT NULL,
    p_limite         integer DEFAULT 100,
    p_desplazamiento integer DEFAULT 0
)
RETURNS TABLE (
    id                 text,
    origen             text,
    docente_apellido   text,
    docente_nombre     text,
    docente_estado     public.estado_profesor,
    especialidad       text,
    nivel_id           integer,
    nivel_nombre       text,
    actividad_nombre   text,
    curso_denominacion text,
    curso_division     text,
    grupo_nombre       text,
    total_filas        bigint
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
SET plan_cache_mode = force_custom_plan
AS $$
#variable_conflict use_column
DECLARE
    v_patron text;
BEGIN
    v_patron := app_private.preparar_reporte(p_busqueda, p_limite, p_desplazamiento, p_origen);

    RETURN QUERY
    WITH asignaciones AS (
        SELECT 'ACADEMICO'::text              AS origen,
               ('A:' || mc.id::text)          AS fila_id,
               mc.profesor_id                 AS docente_id,
               c.nivel_id                     AS nivel_id,
               ma.nombre::text                AS actividad_nombre,
               c.denominacion::text           AS curso_denominacion,
               c.division::text               AS curso_division,
               NULL::text                     AS grupo_nombre
        FROM public.materias_cursos mc
        JOIN public.cursos c ON c.id = mc.curso_id
        JOIN public.actividades ma ON ma.id = mc.materia_id AND ma.activo AND ma.tipo = 'CURRICULAR'
        WHERE mc.activo
          AND mc.profesor_id IS NOT NULL
          AND (p_origen IS NULL OR p_origen = 'ACADEMICO')
          AND p_deporte_id IS NULL
          AND (p_nivel_id IS NULL OR c.nivel_id = p_nivel_id)
          AND (p_curso_id IS NULL OR mc.curso_id = p_curso_id)
          AND (p_materia_id IS NULL OR mc.materia_id = p_materia_id)
          AND (p_profesor_id IS NULL OR mc.profesor_id = p_profesor_id)
          AND (p_horario_id IS NULL OR EXISTS (
                  SELECT 1
                  FROM public.materias_cursos_horarios ah
                  WHERE ah.asignacion_id = mc.id AND ah.activo AND ah.horario_id = p_horario_id))
        UNION ALL
        SELECT 'DEPORTIVO'::text,
               ('D:' || g.id::text),
               g.profesor_id,
               g.nivel_id,
               d.nombre::text,
               NULL::text,
               NULL::text,
               g.nombre::text
        FROM public.grupos_deportivos g
        JOIN public.deportes d ON d.id = g.deporte_id
        WHERE g.activo
          AND (p_origen IS NULL OR p_origen = 'DEPORTIVO')
          AND p_curso_id IS NULL
          AND p_materia_id IS NULL
          AND (p_nivel_id IS NULL OR g.nivel_id = p_nivel_id)
          AND (p_deporte_id IS NULL OR g.deporte_id = p_deporte_id)
          AND (p_profesor_id IS NULL OR g.profesor_id = p_profesor_id)
          AND (p_horario_id IS NULL OR EXISTS (
                  SELECT 1
                  FROM public.grupos_deportivos_horarios gh
                  WHERE gh.grupo_id = g.id AND gh.activo AND gh.horario_id = p_horario_id))
    )
    SELECT x.fila_id,
           x.origen,
           p.apellido::text,
           p.nombre::text,
           pf.estado,
           pf.especialidad::text,
           x.nivel_id,
           n.nombre::text,
           x.actividad_nombre,
           x.curso_denominacion,
           x.curso_division,
           x.grupo_nombre,
           pg_catalog.count(*) OVER ()
    FROM asignaciones x
    JOIN public.perfiles p ON p.id = x.docente_id
    JOIN public.niveles n ON n.id = x.nivel_id
    LEFT JOIN public.profesores pf ON pf.perfil_id = x.docente_id
    WHERE (v_patron IS NULL
           OR p.apellido ILIKE v_patron
           OR p.nombre ILIKE v_patron
           OR (p.apellido || ' ' || p.nombre) ILIKE v_patron
           OR (p.nombre || ' ' || p.apellido) ILIKE v_patron)
    ORDER BY n.nombre, p.apellido, p.nombre, x.origen, x.actividad_nombre, x.fila_id
    LIMIT p_limite OFFSET p_desplazamiento;
END;
$$;


-- ================================================================
-- 9. CATÁLOGOS DE LOS FILTROS
-- ================================================================
-- Una sola lectura para poblar todos los selectores de la pantalla. Devuelve un
-- documento (una fila), de modo que ningún catálogo se recorta por el tope de
-- 1000 filas de la Data API. Solo Dirección.
CREATE OR REPLACE FUNCTION public.catalogos_reportes()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    PERFORM app_private.exigir_director_reporte();

    RETURN pg_catalog.jsonb_build_object(
        'niveles', (
            SELECT COALESCE(pg_catalog.jsonb_agg(
                       pg_catalog.jsonb_build_object('id', n.id, 'nombre', n.nombre)
                       ORDER BY n.id), '[]'::jsonb)
            FROM public.niveles n),
        'cursos', (
            SELECT COALESCE(pg_catalog.jsonb_agg(
                       pg_catalog.jsonb_build_object(
                           'id', c.id, 'nivel_id', c.nivel_id,
                           'denominacion', c.denominacion, 'division', c.division,
                           'activo', c.activo)
                       ORDER BY c.nivel_id, c.denominacion, c.division), '[]'::jsonb)
            FROM public.cursos c),
        'materias', (
            SELECT COALESCE(pg_catalog.jsonb_agg(
                       pg_catalog.jsonb_build_object('id', a.id, 'nombre', a.nombre, 'activo', a.activo)
                       ORDER BY a.nombre), '[]'::jsonb)
            FROM public.actividades a
            WHERE a.tipo = 'CURRICULAR'),
        'deportes', (
            SELECT COALESCE(pg_catalog.jsonb_agg(
                       pg_catalog.jsonb_build_object('id', d.id, 'nombre', d.nombre, 'activo', d.activo)
                       ORDER BY d.nombre), '[]'::jsonb)
            FROM public.deportes d),
        'recorridos', (
            SELECT COALESCE(pg_catalog.jsonb_agg(
                       pg_catalog.jsonb_build_object(
                           'id', s.id, 'codigo', s.codigo, 'nombre', s.nombre, 'activo', s.activo)
                       ORDER BY s.codigo), '[]'::jsonb)
            FROM public.servicios_escolares s
            WHERE s.tipo = 'TRANSPORTE'),
        'horarios', (
            SELECT COALESCE(pg_catalog.jsonb_agg(
                       pg_catalog.jsonb_build_object(
                           'id', h.id, 'dia_semana', h.dia_semana,
                           'hora_inicio', pg_catalog.to_char(h.hora_inicio, 'HH24:MI'),
                           'hora_fin', pg_catalog.to_char(h.hora_fin, 'HH24:MI'))
                       ORDER BY h.dia_semana, h.hora_inicio, h.hora_fin), '[]'::jsonb)
            FROM public.horarios h),
        'profesores', (
            SELECT COALESCE(pg_catalog.jsonb_agg(
                       pg_catalog.jsonb_build_object(
                           'id', p.id, 'apellido', p.apellido, 'nombre', p.nombre)
                       ORDER BY p.apellido, p.nombre, p.id), '[]'::jsonb)
            FROM public.perfiles p
            JOIN public.roles r ON r.id = p.rol_id
            WHERE r.nombre = 'DOCENTE')
    );
END;
$$;


-- ================================================================
-- 10. PRIVILEGIOS DE LAS FUNCIONES PÚBLICAS
-- ================================================================
-- Los privilegios por defecto de Supabase conceden EXECUTE sobre funciones
-- nuevas de `public` a anon: se parte de cero y se concede lo mínimo.
REVOKE ALL ON FUNCTION public.reporte_alumnos_curso(text, integer, uuid, integer, uuid, uuid, uuid, uuid, boolean, integer, integer)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reporte_alumnos_materia(text, integer, uuid, integer, uuid, uuid, uuid, uuid, integer, integer)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reporte_alumnos_deporte(text, integer, uuid, integer, uuid, uuid, uuid, uuid, boolean, integer, integer)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reporte_alumnos_horario(text, integer, uuid, integer, uuid, uuid, uuid, uuid, text, integer, integer)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reporte_alumnos_recorrido(text, integer, uuid, integer, uuid, uuid, uuid, uuid, boolean, integer, integer)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reporte_docentes_nivel(text, integer, uuid, integer, uuid, uuid, uuid, text, integer, integer)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.catalogos_reportes()
    FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.reporte_alumnos_curso(text, integer, uuid, integer, uuid, uuid, uuid, uuid, boolean, integer, integer)
    TO authenticated;
GRANT EXECUTE ON FUNCTION public.reporte_alumnos_materia(text, integer, uuid, integer, uuid, uuid, uuid, uuid, integer, integer)
    TO authenticated;
GRANT EXECUTE ON FUNCTION public.reporte_alumnos_deporte(text, integer, uuid, integer, uuid, uuid, uuid, uuid, boolean, integer, integer)
    TO authenticated;
GRANT EXECUTE ON FUNCTION public.reporte_alumnos_horario(text, integer, uuid, integer, uuid, uuid, uuid, uuid, text, integer, integer)
    TO authenticated;
GRANT EXECUTE ON FUNCTION public.reporte_alumnos_recorrido(text, integer, uuid, integer, uuid, uuid, uuid, uuid, boolean, integer, integer)
    TO authenticated;
GRANT EXECUTE ON FUNCTION public.reporte_docentes_nivel(text, integer, uuid, integer, uuid, uuid, uuid, text, integer, integer)
    TO authenticated;
GRANT EXECUTE ON FUNCTION public.catalogos_reportes() TO authenticated;

COMMENT ON FUNCTION public.reporte_alumnos_curso(text, integer, uuid, integer, uuid, uuid, uuid, uuid, boolean, integer, integer) IS
    'Reporte oficial: alumnos por curso y nivel. Grano: una matrícula. Solo Dirección. Historial: matrículas cerradas.';
COMMENT ON FUNCTION public.reporte_alumnos_materia(text, integer, uuid, integer, uuid, uuid, uuid, uuid, integer, integer) IS
    'Reporte oficial: alumnos por materia (derivada de las materias asignadas al curso de la matrícula vigente) con el profesor responsable. Grano: matrícula vigente × materia. Solo Dirección. Sin historial verificable.';
COMMENT ON FUNCTION public.reporte_alumnos_deporte(text, integer, uuid, integer, uuid, uuid, uuid, uuid, boolean, integer, integer) IS
    'Reporte oficial: alumnos por deporte y nivel del grupo, con el profesor responsable. Grano: una inscripción deportiva. Solo Dirección. Historial: inscripciones canceladas.';
COMMENT ON FUNCTION public.reporte_alumnos_horario(text, integer, uuid, integer, uuid, uuid, uuid, uuid, text, integer, integer) IS
    'Reporte oficial: alumnos por horario, con origen ACADEMICO o DEPORTIVO en cada fila. Grano: alumno × franja semanal. Solo Dirección. Sin historial verificable.';
COMMENT ON FUNCTION public.reporte_alumnos_recorrido(text, integer, uuid, integer, uuid, uuid, uuid, uuid, boolean, integer, integer) IS
    'Reporte oficial: alumnos por recorrido de transporte. Grano: una inscripción a un recorrido. Solo Dirección. Historial: inscripciones canceladas.';
COMMENT ON FUNCTION public.reporte_docentes_nivel(text, integer, uuid, integer, uuid, uuid, uuid, text, integer, integer) IS
    'Reporte oficial: docentes por nivel, con origen ACADEMICO o DEPORTIVO en cada fila. Grano: docente × asignación vigente. Solo Dirección. Sin historial verificable.';
COMMENT ON FUNCTION public.catalogos_reportes() IS
    'Catálogos de los filtros de los reportes oficiales (niveles, cursos, materias, deportes, recorridos, horarios, profesores) en un solo documento. Solo Dirección.';


-- ================================================================
-- 11. AUTOVERIFICACIÓN
-- ================================================================
DO $$
DECLARE
    v_firma   pg_catalog.regprocedure;
    v_rol     TEXT;
    v_columna TEXT;
BEGIN
    -- Las siete funciones públicas: SECURITY INVOKER, search_path vacío,
    -- ejecutables solo por authenticated.
    FOREACH v_firma IN ARRAY ARRAY[
        'public.reporte_alumnos_curso(text,integer,uuid,integer,uuid,uuid,uuid,uuid,boolean,integer,integer)'::pg_catalog.regprocedure,
        'public.reporte_alumnos_materia(text,integer,uuid,integer,uuid,uuid,uuid,uuid,integer,integer)'::pg_catalog.regprocedure,
        'public.reporte_alumnos_deporte(text,integer,uuid,integer,uuid,uuid,uuid,uuid,boolean,integer,integer)'::pg_catalog.regprocedure,
        'public.reporte_alumnos_horario(text,integer,uuid,integer,uuid,uuid,uuid,uuid,text,integer,integer)'::pg_catalog.regprocedure,
        'public.reporte_alumnos_recorrido(text,integer,uuid,integer,uuid,uuid,uuid,uuid,boolean,integer,integer)'::pg_catalog.regprocedure,
        'public.reporte_docentes_nivel(text,integer,uuid,integer,uuid,uuid,uuid,text,integer,integer)'::pg_catalog.regprocedure,
        'public.catalogos_reportes()'::pg_catalog.regprocedure
    ] LOOP
        IF (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid = v_firma)
           OR NOT (COALESCE((SELECT proconfig FROM pg_catalog.pg_proc WHERE oid = v_firma),
                            ARRAY[]::TEXT[]) @> ARRAY['search_path=""'])
           OR pg_catalog.has_function_privilege('anon', v_firma, 'EXECUTE')
           OR pg_catalog.has_function_privilege('service_role', v_firma, 'EXECUTE')
           OR NOT pg_catalog.has_function_privilege('authenticated', v_firma, 'EXECUTE') THEN
            RAISE EXCEPTION
                'Autoverificación EPT-63: % no es SECURITY INVOKER con search_path vacío o sus privilegios de ejecución no son los previstos.',
                v_firma;
        END IF;
    END LOOP;

    -- Los tres auxiliares privados: SECURITY INVOKER, search_path vacío,
    -- ejecutables solo por authenticated.
    FOREACH v_firma IN ARRAY ARRAY[
        'app_private.exigir_director_reporte()'::pg_catalog.regprocedure,
        'app_private.preparar_reporte(text,integer,integer,text)'::pg_catalog.regprocedure,
        'app_private.reporte_alumnos_filtrados(text,integer,uuid,integer,uuid,uuid,uuid,uuid)'::pg_catalog.regprocedure
    ] LOOP
        IF (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid = v_firma)
           OR NOT (COALESCE((SELECT proconfig FROM pg_catalog.pg_proc WHERE oid = v_firma),
                            ARRAY[]::TEXT[]) @> ARRAY['search_path=""'])
           OR pg_catalog.has_function_privilege('anon', v_firma, 'EXECUTE')
           OR pg_catalog.has_function_privilege('service_role', v_firma, 'EXECUTE')
           OR NOT pg_catalog.has_function_privilege('authenticated', v_firma, 'EXECUTE') THEN
            RAISE EXCEPTION
                'Autoverificación EPT-63: el auxiliar % no es SECURITY INVOKER con search_path vacío o sus privilegios no son los previstos.',
                v_firma;
        END IF;
    END LOOP;

    -- Ninguna función de reportes recibe identidad, rol, actor o perfil, y
    -- ninguna devuelve datos del confirmador de EPT-62.
    IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('public', 'app_private')
          AND (p.proname LIKE 'reporte\_%' OR p.proname IN ('catalogos_reportes',
                                                            'exigir_director_reporte',
                                                            'preparar_reporte'))
          AND EXISTS (
              SELECT 1
              FROM pg_catalog.unnest(COALESCE(p.proargnames, ARRAY[]::TEXT[])) AS nombre
              WHERE nombre ILIKE '%user%' OR nombre ILIKE '%rol%'
                 OR nombre ILIKE '%actor%' OR nombre ILIKE '%perfil%'
                 OR nombre ILIKE '%director%' OR nombre ILIKE '%confirm%'
          )
    ) THEN
        RAISE EXCEPTION
            'Autoverificación EPT-63: una función de reportes acepta o devuelve identidad, rol, actor o datos del confirmador.';
    END IF;

    -- Todas las funciones de reportes son de solo lectura (STABLE).
    IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('public', 'app_private')
          AND (p.proname LIKE 'reporte\_%' OR p.proname IN ('catalogos_reportes',
                                                            'exigir_director_reporte',
                                                            'preparar_reporte'))
          AND p.provolatile <> 's'
    ) THEN
        RAISE EXCEPTION 'Autoverificación EPT-63: una función de reportes no es STABLE.';
    END IF;

    -- La migración no toca las tablas de origen: ningún rol de aplicación
    -- obtuvo privilegios nuevos sobre ellas.
    FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        FOREACH v_columna IN ARRAY ARRAY[
            'public.matriculas', 'public.materias_cursos', 'public.grupos_deportivos',
            'public.inscripciones_deportivas', 'public.inscripciones_servicios'
        ] LOOP
            IF pg_catalog.has_table_privilege(v_rol, v_columna, 'INSERT')
               OR pg_catalog.has_table_privilege(v_rol, v_columna, 'UPDATE')
               OR pg_catalog.has_table_privilege(v_rol, v_columna, 'DELETE')
               OR pg_catalog.has_table_privilege(v_rol, v_columna, 'TRUNCATE') THEN
                RAISE EXCEPTION 'Autoverificación EPT-63: % conserva escritura sobre %.', v_rol, v_columna;
            END IF;
        END LOOP;
    END LOOP;

    RAISE NOTICE
        'Migración EPT-63: 6 reportes oficiales, el catálogo de filtros y 3 auxiliares instalados; ninguna fila ni tabla modificada.';
END $$;
