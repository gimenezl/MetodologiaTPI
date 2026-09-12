-- ============================================================
-- EDUCAR PARA TRANSFORMAR — Estado académico del alumno (EPT-9 / EPT-20)
-- ============================================================
-- Migración aditiva. No modifica ni renumera 001 a 007.
--
-- ============================================================
-- MODELO
-- ============================================================
-- Tres piezas, deliberadamente separadas:
--
--   1. `public.perfiles` sigue siendo la ÚNICA fuente de verdad de la identidad
--      de una persona. Ya tiene `dni` y `legajo_nro` únicos y `user_id` nullable,
--      así que un legajo académico puede existir sin cuenta de acceso sin
--      inventar un usuario de Auth falso. Esta migración no duplica ni un solo
--      dato personal fuera de esa tabla.
--
--   2. `public.alumnos` es la extensión académica 1:1 de un perfil ESTUDIANTE.
--      Guarda el estado (`ACTIVO` / `INACTIVO`) y nada más. Es una tabla aparte
--      y no una columna en `perfiles` por dos razones: `perfiles` aloja los
--      cinco roles y una columna académica quedaría nula para cuatro de ellos, y
--      una tabla propia permite una superficie RLS exacta para EPT-9 sin tocar
--      las políticas de `perfiles`, cuya administración general pertenece a
--      EPT-59.
--
--   3. `public.matriculas` es la relación TEMPORAL alumno-curso. Una fila por
--      período. `fecha_cierre IS NULL` significa vigente. Cambiar de curso cierra
--      la fila anterior y abre otra: la historia nunca se sobrescribe ni se borra.
--
-- El nivel NO se persiste en ninguna de las tres. Se deriva siempre de
-- `cursos.nivel_id` a través de la matrícula vigente. Las vistas del final de
-- esta migración son la única forma en que la aplicación lo lee.
--
-- ============================================================
-- INVARIANTES Y CÓMO SE GARANTIZAN
-- ============================================================
-- | Invariante                                   | Garantía                    |
-- |----------------------------------------------|-----------------------------|
-- | Como máximo una matrícula activa por alumno  | índice único parcial        |
-- | ACTIVO ⇒ exactamente una matrícula y legajo  | trigger de restricción      |
-- |                                              | diferido (se evalúa al      |
-- |                                              | COMMIT, no fila por fila)   |
-- | INACTIVO ⇒ ninguna matrícula activa          | mismo trigger diferido      |
-- | Solo cursos activos en asignaciones nuevas   | trigger BEFORE con FOR SHARE|
-- | Curso con matrículas activas no se inactiva  | trigger BEFORE en cursos    |
-- | DNI de 7 u 8 dígitos ASCII, único global     | CHECK + UNIQUE preexistente |
-- | Legajo único, manual, obligatorio si ACTIVO  | UNIQUE + CHECK + trigger    |
-- | Sin borrado físico de alumnos ni historial   | sin GRANT y sin política    |
--
-- ============================================================
-- ORDEN DE BLOQUEOS (prevención de interbloqueos)
-- ============================================================
-- Todas las operaciones que escriben toman sus bloqueos en este orden:
--
--     alumnos  →  cursos  →  matriculas
--
--   * Asignar / cambiar / reactivar: `alumnos FOR UPDATE`, luego el trigger de
--     matrículas toma `cursos FOR SHARE`, luego escribe en `matriculas`.
--   * Inactivar alumno: `alumnos FOR UPDATE`, luego cierra en `matriculas`
--     (cerrar no toma bloqueo sobre `cursos`).
--   * Inactivar curso: entra por `cursos` y solo lee `matriculas`. Nunca sube a
--     `alumnos`, por lo que no puede cerrar un ciclo con las anteriores.
--
-- `FOR SHARE` sobre el curso entra en conflicto con el UPDATE de `activo`, así
-- que una asignación nueva y una inactivación del mismo curso quedan
-- serializadas: gana la primera que bloquea y la segunda ve el estado ya
-- confirmado. Es el mismo mecanismo que 007 usa para niveles.
--
-- ============================================================
-- CÓDIGOS SQLSTATE PROPIOS
-- ============================================================
-- Continúan la familia P55xx de 006/007, en un bloque nuevo para no colisionar.
--   P5503  el recurso solicitado no existe               (reutilizado)
--   P5504  la referencia elegida está inactiva           (reutilizado)
--   P5505  se requiere una identidad autenticada         (reutilizado)
--   P5510  el DNI no cumple el contrato
--   P5511  alumno ACTIVO sin exactamente una matrícula activa
--   P5512  alumno ACTIVO sin número de legajo
--   P5513  alumno INACTIVO con una matrícula activa
--   P5514  no se puede inactivar un curso con matrículas activas
--   P5515  el número de legajo no cumple el contrato
--   P5516  el estado académico solicitado no es válido
--   42501  el rol de la sesión no está autorizado        (reutilizado)
-- ============================================================


-- ================================================================
-- 1. VERIFICACIÓN PREVIA DE LOS DATOS EXISTENTES
-- ================================================================
-- Antes de imponer el contrato de DNI y legajo se comprueba que los datos
-- actuales lo cumplan. Si no lo cumplen, la migración FALLA sin modificar
-- ninguna fila: corregir información personal automáticamente sería inventar
-- datos de una persona real.
--
-- Los mensajes de error informan cantidades e identificadores internos, nunca
-- el DNI ni el nombre. Un error de migración no es lugar para datos personales.

-- El contrato del DNI se declara una sola vez y se reutiliza en el CHECK, en las
-- funciones y en la verificación previa.
--
-- La clase se enumera dígito por dígito a propósito. En una expresión regular de
-- PostgreSQL `\d` equivale a `[[:digit:]]` y SÍ acepta dígitos no ASCII (por
-- ejemplo el arábigo-índico `٨`), y un rango como `[0-9]` depende del orden de
-- la colación. La enumeración explícita es la única forma que no depende del
-- entorno. En JavaScript, en cambio, `\d` sin la bandera `u` ya es ASCII, por lo
-- que el esquema Zod equivalente puede seguir usándolo.
CREATE OR REPLACE FUNCTION app_private.dni_valido(p_dni TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT p_dni IS NOT NULL
       AND p_dni OPERATOR(pg_catalog.~) '^[0123456789]{7,8}$';
$$;

REVOKE ALL ON FUNCTION app_private.dni_valido(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.dni_valido(TEXT) TO service_role;

-- El legajo es manual y no se autogenera. El contrato solo exige que, cuando
-- exista, sea un texto recortado, no vacío y de hasta 50 caracteres.
CREATE OR REPLACE FUNCTION app_private.legajo_valido(p_legajo TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT p_legajo IS NULL
        OR (
            p_legajo OPERATOR(pg_catalog.=) pg_catalog.btrim(p_legajo)
            AND pg_catalog.char_length(p_legajo) BETWEEN 1 AND 50
        );
$$;

REVOKE ALL ON FUNCTION app_private.legajo_valido(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.legajo_valido(TEXT) TO service_role;

DO $$
DECLARE
    dni_invalidos      BIGINT;
    legajo_invalidos   BIGINT;
    legajo_ambiguos    BIGINT;
BEGIN
    SELECT pg_catalog.count(*) INTO dni_invalidos
    FROM public.perfiles p
    WHERE NOT app_private.dni_valido(p.dni);

    IF dni_invalidos > 0 THEN
        RAISE EXCEPTION
            'No se puede aplicar el contrato de DNI: % perfil(es) tienen un DNI que no es una cadena de 7 u 8 dígitos ASCII. Corregilos explícitamente con la persona titular antes de aplicar la migración; esta migración nunca normaliza datos personales por su cuenta.',
            dni_invalidos;
    END IF;

    SELECT pg_catalog.count(*) INTO legajo_invalidos
    FROM public.perfiles p
    WHERE NOT app_private.legajo_valido(p.legajo_nro);

    IF legajo_invalidos > 0 THEN
        RAISE EXCEPTION
            'No se puede aplicar el contrato de legajo: % perfil(es) tienen un número de legajo vacío o con espacios laterales. Corregilos explícitamente antes de aplicar la migración.',
            legajo_invalidos;
    END IF;

    SELECT pg_catalog.count(*) INTO legajo_ambiguos
    FROM (
        SELECT pg_catalog.upper(p.legajo_nro) AS normalizado
        FROM public.perfiles p
        WHERE p.legajo_nro IS NOT NULL
        GROUP BY pg_catalog.upper(p.legajo_nro)
        HAVING pg_catalog.count(*) > 1
    ) AS d;

    IF legajo_ambiguos > 0 THEN
        RAISE EXCEPTION
            'No se puede aplicar la unicidad de legajo sin distinguir mayúsculas: existen % grupo(s) de legajos que solo difieren en mayúsculas/minúsculas. Unificalos explícitamente antes de aplicar la migración.',
            legajo_ambiguos;
    END IF;
END $$;


-- ================================================================
-- 2. CONTRATO DE IDENTIDAD EN `perfiles`
-- ================================================================
-- `dni` ya era NOT NULL y UNIQUE desde 001, y toda la aplicación valida 7-8
-- dígitos con Zod desde entonces. Acá la base se pone al día con el contrato que
-- la aplicación ya afirmaba: la unicidad global del DNI es la garantía central
-- sobre la que se apoya todo el legajo académico.
ALTER TABLE public.perfiles
    ADD CONSTRAINT perfiles_dni_valido
        CHECK (app_private.dni_valido(dni) IS TRUE),
    ADD CONSTRAINT perfiles_legajo_valido
        CHECK (app_private.legajo_valido(legajo_nro) IS TRUE);

-- `legajo_nro` ya tenía UNIQUE exacto desde 001. Se agrega la unicidad sin
-- distinguir mayúsculas porque el número lo tipea una persona: sin este índice,
-- «A-100» y «a-100» serían dos alumnos distintos que en el listado se ven igual.
-- Es aditivo: el UNIQUE original se conserva.
CREATE UNIQUE INDEX idx_perfiles_legajo_normalizado
    ON public.perfiles (pg_catalog.upper(legajo_nro))
    WHERE legajo_nro IS NOT NULL;

-- ----------------------------------------------------------------
-- Cierre del borrado físico de personas
-- ----------------------------------------------------------------
-- Verificado sobre esta misma base antes de escribir la migración:
--
--   SET LOCAL ROLE anon; TRUNCATE public.perfiles CASCADE;   -- funcionaba
--
-- RLS no se aplica a TRUNCATE: es un privilegio de tabla, no una operación de
-- fila. `perfiles` recibió TRUNCATE y DELETE para `anon` y `authenticated` por
-- los privilegios por defecto del esquema `public`, así que cualquier visitante
-- sin autenticar podía vaciar la tabla y, en cascada, `inscripciones` y
-- `asistencias`. El historial académico que introduce esta migración cuelga de
-- `perfiles`, de modo que cerrarlo es requisito de EPT-9, no una mejora
-- oportunista.
--
-- El DELETE ya estaba denegado por RLS (no hay política DELETE en `perfiles`),
-- pero se revoca igual para que la negación sea explícita a nivel privilegio y
-- no dependa de que nadie agregue una política en el futuro.
--
-- `service_role` no se toca: la frontera privilegiada de `/api/usuarios` y el
-- setup local de pruebas lo siguen necesitando.
REVOKE DELETE, TRUNCATE ON public.perfiles FROM PUBLIC, anon, authenticated;

-- El resto de las tablas del esquema conserva sus privilegios amplios de origen.
-- Repararlas en conjunto pertenece a EPT-66 y queda registrado en la evidencia.


-- ================================================================
-- 3. CATÁLOGOS DE ESTADO
-- ================================================================
-- Se usan tipos enumerados en lugar de VARCHAR + CHECK porque son la garantía
-- más fuerte en la base y porque el generador de tipos de Supabase los proyecta
-- como una unión exacta de TypeScript, que es justamente lo que EPT-21 exige.
CREATE TYPE public.estado_alumno AS ENUM ('ACTIVO', 'INACTIVO');

-- Distingue por qué se cerró una matrícula, de modo que el historial se explica
-- solo sin necesidad de inferirlo a partir de las fechas.
CREATE TYPE public.motivo_cierre_matricula AS ENUM ('CAMBIO_DE_CURSO', 'INACTIVACION');


-- ================================================================
-- 4. ALUMNOS: EXTENSIÓN ACADÉMICA DEL PERFIL
-- ================================================================
CREATE TABLE public.alumnos (
    -- La clave primaria ES la del perfil: relación 1:1 sin identificador nuevo y
    -- sin ninguna posibilidad de duplicar la identidad de una persona.
    perfil_id UUID PRIMARY KEY
        REFERENCES public.perfiles(id) ON DELETE RESTRICT,
    estado public.estado_alumno NOT NULL,
    fecha_alta TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    fecha_actualizacion TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.alumnos IS
    'Estado académico del perfil ESTUDIANTE. No guarda datos personales: la identidad vive únicamente en public.perfiles.';


-- ================================================================
-- 5. MATRÍCULAS: RELACIÓN TEMPORAL ALUMNO-CURSO
-- ================================================================
CREATE TABLE public.matriculas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    alumno_id UUID NOT NULL
        REFERENCES public.alumnos(perfil_id) ON DELETE RESTRICT,
    -- ON DELETE RESTRICT: un curso referenciado por la historia no se puede
    -- borrar. La baja de cursos ya era lógica desde 003.
    curso_id UUID NOT NULL
        REFERENCES public.cursos(id) ON DELETE RESTRICT,
    fecha_inicio TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    -- NULL es el marcador inequívoco de matrícula vigente.
    fecha_cierre TIMESTAMP WITH TIME ZONE,
    motivo_cierre public.motivo_cierre_matricula,
    CONSTRAINT matriculas_cierre_coherente
        CHECK ((fecha_cierre IS NULL) = (motivo_cierre IS NULL)),
    CONSTRAINT matriculas_cierre_posterior
        CHECK (fecha_cierre IS NULL OR fecha_cierre >= fecha_inicio)
);

COMMENT ON TABLE public.matriculas IS
    'Historial de la relación alumno-curso. Una fila por período; fecha_cierre NULL indica la matrícula vigente. El nivel se deriva de cursos.nivel_id y nunca se copia acá.';

-- Garantía dura de «como máximo una matrícula activa por alumno». Un índice
-- único parcial no depende de que la aplicación consulte antes de escribir: dos
-- transacciones concurrentes no pueden confirmar las dos, y la que pierde
-- devuelve SQLSTATE 23505.
CREATE UNIQUE INDEX idx_matriculas_una_activa_por_alumno
    ON public.matriculas (alumno_id)
    WHERE fecha_cierre IS NULL;

-- Índice del historial y de la clave foránea hacia alumnos.
CREATE INDEX idx_matriculas_alumno_historial
    ON public.matriculas (alumno_id, fecha_inicio DESC);

-- Índice de la clave foránea hacia cursos. Lo usa el control de inactivación de
-- un curso, que cuenta sus matrículas vigentes.
CREATE INDEX idx_matriculas_curso
    ON public.matriculas (curso_id)
    WHERE fecha_cierre IS NULL;


-- ================================================================
-- 6. IDENTIDAD DE LA SESIÓN
-- ================================================================
-- Igual que `app_private.es_director()` (003) y `app_private.rol_actual()`
-- (005): vive en el esquema privado, no recibe parámetros y deriva todo de
-- `auth.uid()`, de modo que quien llama no puede elegir qué persona se inspecciona.
CREATE OR REPLACE FUNCTION app_private.perfil_actual()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT p.id
    FROM public.perfiles p
    WHERE p.user_id = (SELECT auth.uid())
    LIMIT 1;
$$;

REVOKE ALL ON FUNCTION app_private.perfil_actual() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.perfil_actual() TO authenticated;


-- ================================================================
-- 7. COHERENCIA ENTRE ESTADO, MATRÍCULA Y LEGAJO
-- ================================================================
-- La regla «ACTIVO ⇔ exactamente una matrícula activa + legajo» cruza filas y
-- tablas, así que no puede expresarse con un CHECK. Se comprueba con triggers de
-- restricción DIFERIDOS: durante la transacción el estado puede ser
-- transitoriamente incoherente (cerrar una matrícula y abrir otra son dos
-- sentencias), y al COMMIT tiene que ser válido. Si no lo es, la transacción
-- entera se cae y no persiste ninguna parte.
CREATE OR REPLACE FUNCTION app_private.validar_coherencia_alumno(p_alumno_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_estado  public.estado_alumno;
    v_legajo  VARCHAR(50);
    v_activas BIGINT;
BEGIN
    SELECT a.estado, p.legajo_nro
    INTO v_estado, v_legajo
    FROM public.alumnos a
    JOIN public.perfiles p ON p.id = a.perfil_id
    WHERE a.perfil_id = p_alumno_id;

    -- El perfil no es un alumno, o el alumno dejó de existir dentro de la misma
    -- transacción. En ninguno de los dos casos hay una regla académica que exigir.
    IF NOT FOUND THEN
        RETURN;
    END IF;

    SELECT pg_catalog.count(*)
    INTO v_activas
    FROM public.matriculas m
    WHERE m.alumno_id = p_alumno_id
      AND m.fecha_cierre IS NULL;

    IF v_estado = 'ACTIVO' THEN
        IF v_activas <> 1 THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P5511',
                MESSAGE = 'Un estudiante activo debe tener exactamente una matrícula vigente.';
        END IF;

        IF v_legajo IS NULL THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P5512',
                MESSAGE = 'Un estudiante activo debe tener un número de legajo.';
        END IF;
    ELSE
        IF v_activas <> 0 THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P5513',
                MESSAGE = 'Un estudiante inactivo no puede conservar una matrícula vigente.';
        END IF;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION app_private.validar_coherencia_alumno(UUID)
    FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION app_private.exigir_coherencia_academica()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_alumno_id UUID;
BEGIN
    -- Cada rama es una sentencia propia y no una expresión CASE: PL/pgSQL
    -- resuelve todos los campos que aparecen en una misma expresión, y
    -- `alumnos` no tiene columna `id` ni `perfiles` tiene `perfil_id`.
    IF TG_TABLE_NAME = 'alumnos' THEN
        v_alumno_id := NEW.perfil_id;
    ELSIF TG_TABLE_NAME = 'perfiles' THEN
        v_alumno_id := NEW.id;
    ELSIF TG_OP = 'DELETE' THEN
        v_alumno_id := OLD.alumno_id;
    ELSE
        v_alumno_id := NEW.alumno_id;
    END IF;

    PERFORM app_private.validar_coherencia_alumno(v_alumno_id);
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION app_private.exigir_coherencia_academica()
    FROM PUBLIC, anon, authenticated;

CREATE CONSTRAINT TRIGGER exigir_coherencia_al_cambiar_alumno
    AFTER INSERT OR UPDATE ON public.alumnos
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION app_private.exigir_coherencia_academica();

CREATE CONSTRAINT TRIGGER exigir_coherencia_al_cambiar_matricula
    AFTER INSERT OR UPDATE OR DELETE ON public.matriculas
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION app_private.exigir_coherencia_academica();

-- Quitarle el legajo a un estudiante activo rompe la misma regla, así que la
-- corrección de identidad también queda cubierta. Para un perfil que no es
-- alumno la validación devuelve enseguida y no cuesta nada.
CREATE CONSTRAINT TRIGGER exigir_coherencia_al_cambiar_legajo
    AFTER UPDATE OF legajo_nro ON public.perfiles
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION app_private.exigir_coherencia_academica();


-- ================================================================
-- 8. TODO PERFIL ESTUDIANTE TIENE LEGAJO ACADÉMICO
-- ================================================================
-- Un perfil ESTUDIANTE puede nacer por esta historia o por la frontera
-- privilegiada preexistente `/api/usuarios`. El trigger garantiza que, venga por
-- donde venga, quede con un estado académico explícito e INACTIVO, nunca con un
-- curso o un legajo inventados.
CREATE OR REPLACE FUNCTION app_private.registrar_alumno_de_perfil()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.rol_id IS NULL THEN
        RETURN NULL;
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.roles r
        WHERE r.id = NEW.rol_id AND r.nombre = 'ESTUDIANTE'
    ) THEN
        INSERT INTO public.alumnos (perfil_id, estado)
        VALUES (NEW.id, 'INACTIVO')
        ON CONFLICT (perfil_id) DO NOTHING;
    END IF;

    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION app_private.registrar_alumno_de_perfil()
    FROM PUBLIC, anon, authenticated;

CREATE TRIGGER registrar_alumno_al_crear_perfil
    AFTER INSERT ON public.perfiles
    FOR EACH ROW
    EXECUTE FUNCTION app_private.registrar_alumno_de_perfil();


-- ================================================================
-- 9. SOLO CURSOS ACTIVOS EN ASIGNACIONES NUEVAS
-- ================================================================
CREATE OR REPLACE FUNCTION app_private.validar_curso_activo_matricula()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_curso_activo BOOLEAN;
BEGIN
    -- Cerrar una matrícula histórica debe seguir funcionando aunque su curso ya
    -- esté inactivo: cerrar no es asignar.
    IF NEW.fecha_cierre IS NOT NULL THEN
        RETURN NEW;
    END IF;

    -- Conservar la relación vigente tampoco es una asignación nueva.
    IF TG_OP = 'UPDATE'
       AND OLD.fecha_cierre IS NULL
       AND NEW.curso_id IS NOT DISTINCT FROM OLD.curso_id THEN
        RETURN NEW;
    END IF;

    -- FOR SHARE entra en conflicto con el UPDATE de `cursos.activo`. Así la
    -- asignación y la inactivación del mismo curso quedan ordenadas por la
    -- primera transacción que bloquea, sin que dos asignaciones a cursos
    -- distintos se bloqueen entre sí.
    SELECT c.activo
    INTO v_curso_activo
    FROM public.cursos c
    WHERE c.id = NEW.curso_id
    FOR SHARE;

    IF FOUND AND NOT v_curso_activo THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5504',
            MESSAGE = 'Solo pueden asignarse cursos activos a una matrícula nueva.';
    END IF;

    -- Si el curso no existe, la clave foránea conserva su SQLSTATE 23503.
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.validar_curso_activo_matricula()
    FROM PUBLIC, anon, authenticated;

CREATE TRIGGER validar_curso_activo_en_matricula
    BEFORE INSERT OR UPDATE OF curso_id, fecha_cierre ON public.matriculas
    FOR EACH ROW
    EXECUTE FUNCTION app_private.validar_curso_activo_matricula();


-- ================================================================
-- 10. UN CURSO CON MATRÍCULAS VIGENTES NO SE INACTIVA
-- ================================================================
-- Complemento simétrico del trigger anterior. Entre los dos, una asignación
-- nueva y una inactivación del mismo curso nunca pueden confirmar las dos:
--
--   * Si la asignación bloquea primero, la inactivación espera, y cuando avanza
--     ya cuenta la matrícula confirmada y se rechaza con P5514.
--   * Si la inactivación bloquea primero, la asignación espera, y cuando avanza
--     relee la fila y encuentra `activo = false`, y se rechaza con P5504.
CREATE OR REPLACE FUNCTION app_private.proteger_curso_con_matriculas()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_matriculas_activas BIGINT;
BEGIN
    -- Solo interesa la transición de activo a inactivo.
    IF NOT (OLD.activo AND NOT NEW.activo) THEN
        RETURN NEW;
    END IF;

    SELECT pg_catalog.count(*)
    INTO v_matriculas_activas
    FROM public.matriculas m
    WHERE m.curso_id = NEW.id
      AND m.fecha_cierre IS NULL;

    IF v_matriculas_activas > 0 THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5514',
            MESSAGE = 'No se puede inactivar un curso con estudiantes matriculados. Reasignalos o inactivalos primero.';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.proteger_curso_con_matriculas()
    FROM PUBLIC, anon, authenticated;

CREATE TRIGGER proteger_curso_con_matriculas_vigentes
    BEFORE UPDATE OF activo ON public.cursos
    FOR EACH ROW
    EXECUTE FUNCTION app_private.proteger_curso_con_matriculas();


-- ================================================================
-- 11. INCORPORACIÓN DE LOS PERFILES ESTUDIANTE EXISTENTES
-- ================================================================
-- Quedan INACTIVO y sin matrícula. No se les inventa curso ni legajo: el
-- director los completa explícitamente cuando corresponda.
INSERT INTO public.alumnos (perfil_id, estado)
SELECT p.id, 'INACTIVO'
FROM public.perfiles p
JOIN public.roles r ON r.id = p.rol_id
WHERE r.nombre = 'ESTUDIANTE'
ON CONFLICT (perfil_id) DO NOTHING;


-- ================================================================
-- 12. OPERACIONES ACADÉMICAS PRIVILEGIADAS
-- ================================================================
-- Todas viven en `app_private`, que la Data API no expone. Todas verifican
-- `auth.uid()` y el rol DIRECTOR internamente: ninguna acepta el rol, el usuario
-- ni el perfil autorizado como parámetro. Cada una es una transacción completa,
-- de modo que un rechazo no deja nada persistido.

-- ----------------------------------------------------------------
-- 12.1 Alta administrativa del legajo académico
-- ----------------------------------------------------------------
-- No toca `auth.users`: un legajo académico puede existir sin cuenta de acceso y
-- vincularse después. Tampoco escribe en vínculos parentales: el tutor no es
-- requisito de esta historia.
CREATE OR REPLACE FUNCTION app_private.crear_alumno(
    p_nombre           TEXT,
    p_apellido         TEXT,
    p_dni              TEXT,
    p_estado           TEXT,
    p_legajo_nro       TEXT    DEFAULT NULL,
    p_curso_id         UUID    DEFAULT NULL,
    p_fecha_nacimiento DATE    DEFAULT NULL,
    p_telefono         TEXT    DEFAULT NULL,
    p_direccion        TEXT    DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_rol_estudiante INTEGER;
    v_estado         public.estado_alumno;
    v_perfil_id      UUID;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    IF NOT app_private.es_director() THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Solo un DIRECTOR puede administrar legajos académicos.';
    END IF;

    IF p_estado IS NULL OR p_estado NOT IN ('ACTIVO', 'INACTIVO') THEN
        RAISE EXCEPTION USING ERRCODE = 'P5516', MESSAGE = 'El estado académico debe ser ACTIVO o INACTIVO.';
    END IF;
    v_estado := p_estado::public.estado_alumno;

    IF NOT app_private.dni_valido(p_dni) THEN
        RAISE EXCEPTION USING ERRCODE = 'P5510', MESSAGE = 'El DNI debe ser una cadena de 7 u 8 dígitos.';
    END IF;

    IF NOT app_private.legajo_valido(p_legajo_nro) THEN
        RAISE EXCEPTION USING ERRCODE = 'P5515', MESSAGE = 'El número de legajo no es válido.';
    END IF;

    IF p_nombre IS NULL
       OR p_nombre <> pg_catalog.btrim(p_nombre)
       OR pg_catalog.char_length(p_nombre) NOT BETWEEN 1 AND 100
       OR p_apellido IS NULL
       OR p_apellido <> pg_catalog.btrim(p_apellido)
       OR pg_catalog.char_length(p_apellido) NOT BETWEEN 1 AND 100 THEN
        RAISE EXCEPTION USING ERRCODE = 'P5501', MESSAGE = 'El nombre y el apellido no son válidos.';
    END IF;

    -- La decisión académica se exige por adelantado para dar un mensaje preciso.
    -- El trigger diferido vuelve a comprobarlo al COMMIT de todos modos.
    IF v_estado = 'ACTIVO' THEN
        IF p_curso_id IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P5511', MESSAGE = 'Un estudiante activo debe tener exactamente una matrícula vigente.';
        END IF;
        IF p_legajo_nro IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P5512', MESSAGE = 'Un estudiante activo debe tener un número de legajo.';
        END IF;
    ELSIF p_curso_id IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5513', MESSAGE = 'Un estudiante inactivo no puede conservar una matrícula vigente.';
    END IF;

    SELECT r.id INTO v_rol_estudiante
    FROM public.roles r WHERE r.nombre = 'ESTUDIANTE';

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P5503', MESSAGE = 'No existe el rol ESTUDIANTE en el catálogo.';
    END IF;

    INSERT INTO public.perfiles (
        user_id, rol_id, nombre, apellido, dni,
        legajo_nro, fecha_nacimiento, telefono, direccion
    )
    VALUES (
        NULL, v_rol_estudiante, p_nombre, p_apellido, p_dni,
        p_legajo_nro, p_fecha_nacimiento, p_telefono, p_direccion
    )
    RETURNING id INTO v_perfil_id;

    -- `registrar_alumno_al_crear_perfil` ya dejó la fila académica en INACTIVO.
    UPDATE public.alumnos
    SET estado = v_estado,
        fecha_actualizacion = NOW()
    WHERE perfil_id = v_perfil_id;

    IF v_estado = 'ACTIVO' THEN
        INSERT INTO public.matriculas (alumno_id, curso_id)
        VALUES (v_perfil_id, p_curso_id);
    END IF;

    RETURN v_perfil_id;
END;
$$;

-- ----------------------------------------------------------------
-- 12.2 Corrección de DNI y legajo
-- ----------------------------------------------------------------
-- Conserva `perfiles.id` y, con él, todas las relaciones: matrículas,
-- asistencias e inscripciones siguen apuntando a la misma persona.
CREATE OR REPLACE FUNCTION app_private.corregir_identidad_alumno(
    p_alumno_id  UUID,
    p_dni        TEXT,
    p_legajo_nro TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_estado public.estado_alumno;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    IF NOT app_private.es_director() THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Solo un DIRECTOR puede administrar legajos académicos.';
    END IF;

    IF NOT app_private.dni_valido(p_dni) THEN
        RAISE EXCEPTION USING ERRCODE = 'P5510', MESSAGE = 'El DNI debe ser una cadena de 7 u 8 dígitos.';
    END IF;

    IF NOT app_private.legajo_valido(p_legajo_nro) THEN
        RAISE EXCEPTION USING ERRCODE = 'P5515', MESSAGE = 'El número de legajo no es válido.';
    END IF;

    -- Bloqueo sobre `alumnos`, primer eslabón del orden documentado.
    SELECT a.estado INTO v_estado
    FROM public.alumnos a
    WHERE a.perfil_id = p_alumno_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P5503', MESSAGE = 'El legajo académico solicitado no existe.';
    END IF;

    -- El trigger diferido rechaza esto igual al COMMIT, pero comprobarlo acá da
    -- un mensaje preciso en lugar de un fallo genérico al cerrar la transacción.
    IF v_estado = 'ACTIVO' AND p_legajo_nro IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5512',
            MESSAGE = 'Un estudiante activo debe tener un número de legajo.';
    END IF;

    UPDATE public.perfiles
    SET dni = p_dni,
        legajo_nro = p_legajo_nro
    WHERE id = p_alumno_id;

    UPDATE public.alumnos
    SET fecha_actualizacion = NOW()
    WHERE perfil_id = p_alumno_id;

    RETURN p_alumno_id;
END;
$$;

-- ----------------------------------------------------------------
-- 12.3 Cambio de curso
-- ----------------------------------------------------------------
-- Cierra la matrícula vigente y abre otra dentro de la misma transacción. El
-- índice único parcial impide que dos cambios concurrentes dejen dos vigentes.
CREATE OR REPLACE FUNCTION app_private.cambiar_curso_alumno(
    p_alumno_id UUID,
    p_curso_id  UUID
)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_estado    public.estado_alumno;
    v_matricula UUID;
    v_curso_actual UUID;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    IF NOT app_private.es_director() THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Solo un DIRECTOR puede administrar legajos académicos.';
    END IF;

    IF p_curso_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5503', MESSAGE = 'El curso solicitado no existe.';
    END IF;

    SELECT a.estado INTO v_estado
    FROM public.alumnos a
    WHERE a.perfil_id = p_alumno_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P5503', MESSAGE = 'El legajo académico solicitado no existe.';
    END IF;

    IF v_estado <> 'ACTIVO' THEN
        RAISE EXCEPTION USING ERRCODE = 'P5513',
            MESSAGE = 'Un estudiante inactivo no tiene matrícula. Reactivalo eligiendo un curso.';
    END IF;

    SELECT m.id, m.curso_id INTO v_matricula, v_curso_actual
    FROM public.matriculas m
    WHERE m.alumno_id = p_alumno_id AND m.fecha_cierre IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P5511',
            MESSAGE = 'Un estudiante activo debe tener exactamente una matrícula vigente.';
    END IF;

    IF v_curso_actual = p_curso_id THEN
        RAISE EXCEPTION USING ERRCODE = 'P5516',
            MESSAGE = 'El estudiante ya está matriculado en ese curso.';
    END IF;

    UPDATE public.matriculas
    SET fecha_cierre = NOW(),
        motivo_cierre = 'CAMBIO_DE_CURSO'
    WHERE id = v_matricula;

    INSERT INTO public.matriculas (alumno_id, curso_id)
    VALUES (p_alumno_id, p_curso_id);

    UPDATE public.alumnos
    SET fecha_actualizacion = NOW()
    WHERE perfil_id = p_alumno_id;

    RETURN p_alumno_id;
END;
$$;

-- ----------------------------------------------------------------
-- 12.4 Inactivación
-- ----------------------------------------------------------------
-- Cambia el estado y cierra la matrícula vigente atómicamente. Conserva la
-- identidad, el legajo y todo el historial: no borra ninguna fila.
CREATE OR REPLACE FUNCTION app_private.inactivar_alumno(p_alumno_id UUID)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_estado public.estado_alumno;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    IF NOT app_private.es_director() THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Solo un DIRECTOR puede administrar legajos académicos.';
    END IF;

    SELECT a.estado INTO v_estado
    FROM public.alumnos a
    WHERE a.perfil_id = p_alumno_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P5503', MESSAGE = 'El legajo académico solicitado no existe.';
    END IF;

    IF v_estado = 'INACTIVO' THEN
        RAISE EXCEPTION USING ERRCODE = 'P5516', MESSAGE = 'El estudiante ya está inactivo.';
    END IF;

    UPDATE public.matriculas
    SET fecha_cierre = NOW(),
        motivo_cierre = 'INACTIVACION'
    WHERE alumno_id = p_alumno_id
      AND fecha_cierre IS NULL;

    UPDATE public.alumnos
    SET estado = 'INACTIVO',
        fecha_actualizacion = NOW()
    WHERE perfil_id = p_alumno_id;

    RETURN p_alumno_id;
END;
$$;

-- ----------------------------------------------------------------
-- 12.5 Reactivación
-- ----------------------------------------------------------------
-- Exige elegir un curso activo. El legajo tiene que existir: la coherencia la
-- vuelve a comprobar el trigger diferido al COMMIT.
CREATE OR REPLACE FUNCTION app_private.reactivar_alumno(
    p_alumno_id UUID,
    p_curso_id  UUID
)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_estado public.estado_alumno;
    v_legajo VARCHAR(50);
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    IF NOT app_private.es_director() THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Solo un DIRECTOR puede administrar legajos académicos.';
    END IF;

    IF p_curso_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5511',
            MESSAGE = 'Para reactivar un estudiante hay que elegir un curso activo.';
    END IF;

    SELECT a.estado, p.legajo_nro
    INTO v_estado, v_legajo
    FROM public.alumnos a
    JOIN public.perfiles p ON p.id = a.perfil_id
    WHERE a.perfil_id = p_alumno_id
    FOR UPDATE OF a;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P5503', MESSAGE = 'El legajo académico solicitado no existe.';
    END IF;

    IF v_estado = 'ACTIVO' THEN
        RAISE EXCEPTION USING ERRCODE = 'P5516', MESSAGE = 'El estudiante ya está activo.';
    END IF;

    IF v_legajo IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5512',
            MESSAGE = 'Un estudiante activo debe tener un número de legajo.';
    END IF;

    INSERT INTO public.matriculas (alumno_id, curso_id)
    VALUES (p_alumno_id, p_curso_id);

    UPDATE public.alumnos
    SET estado = 'ACTIVO',
        fecha_actualizacion = NOW()
    WHERE perfil_id = p_alumno_id;

    RETURN p_alumno_id;
END;
$$;

REVOKE ALL ON FUNCTION app_private.crear_alumno(TEXT, TEXT, TEXT, TEXT, TEXT, UUID, DATE, TEXT, TEXT)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.corregir_identidad_alumno(UUID, TEXT, TEXT)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.cambiar_curso_alumno(UUID, UUID)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.inactivar_alumno(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.reactivar_alumno(UUID, UUID) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION app_private.crear_alumno(TEXT, TEXT, TEXT, TEXT, TEXT, UUID, DATE, TEXT, TEXT)
    TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.corregir_identidad_alumno(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.cambiar_curso_alumno(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.inactivar_alumno(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.reactivar_alumno(UUID, UUID) TO authenticated;


-- ================================================================
-- 13. ENVOLTORIOS PÚBLICOS PARA POSTGREST
-- ================================================================
-- SECURITY INVOKER: la lógica privilegiada queda contenida en `app_private`,
-- que la Data API no expone. Cada función interna revalida identidad y rol.
CREATE OR REPLACE FUNCTION public.crear_alumno(
    p_nombre           TEXT,
    p_apellido         TEXT,
    p_dni              TEXT,
    p_estado           TEXT,
    p_legajo_nro       TEXT DEFAULT NULL,
    p_curso_id         UUID DEFAULT NULL,
    p_fecha_nacimiento DATE DEFAULT NULL,
    p_telefono         TEXT DEFAULT NULL,
    p_direccion        TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT app_private.crear_alumno(
        p_nombre, p_apellido, p_dni, p_estado,
        p_legajo_nro, p_curso_id, p_fecha_nacimiento, p_telefono, p_direccion
    );
$$;

CREATE OR REPLACE FUNCTION public.corregir_identidad_alumno(
    p_alumno_id  UUID,
    p_dni        TEXT,
    p_legajo_nro TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT app_private.corregir_identidad_alumno(p_alumno_id, p_dni, p_legajo_nro);
$$;

CREATE OR REPLACE FUNCTION public.cambiar_curso_alumno(p_alumno_id UUID, p_curso_id UUID)
RETURNS UUID
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT app_private.cambiar_curso_alumno(p_alumno_id, p_curso_id);
$$;

CREATE OR REPLACE FUNCTION public.inactivar_alumno(p_alumno_id UUID)
RETURNS UUID
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT app_private.inactivar_alumno(p_alumno_id);
$$;

CREATE OR REPLACE FUNCTION public.reactivar_alumno(p_alumno_id UUID, p_curso_id UUID)
RETURNS UUID
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT app_private.reactivar_alumno(p_alumno_id, p_curso_id);
$$;

REVOKE ALL ON FUNCTION public.crear_alumno(TEXT, TEXT, TEXT, TEXT, TEXT, UUID, DATE, TEXT, TEXT)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.corregir_identidad_alumno(UUID, TEXT, TEXT)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cambiar_curso_alumno(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.inactivar_alumno(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reactivar_alumno(UUID, UUID) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.crear_alumno(TEXT, TEXT, TEXT, TEXT, TEXT, UUID, DATE, TEXT, TEXT)
    TO authenticated;
GRANT EXECUTE ON FUNCTION public.corregir_identidad_alumno(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cambiar_curso_alumno(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.inactivar_alumno(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reactivar_alumno(UUID, UUID) TO authenticated;

-- No existe ninguna función de borrado. La baja es lógica y el historial se
-- conserva completo.


-- ================================================================
-- 14. PRIVILEGIOS MÍNIMOS Y RLS
-- ================================================================
-- `GRANT ALL ON ALL TABLES` de 001 fue una instantánea y no alcanza a estas
-- tablas, pero los privilegios por defecto del esquema `public` sí las alcanzan.
-- Se parte de cero en las dos.
ALTER TABLE public.alumnos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matriculas ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.alumnos FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.matriculas FROM PUBLIC, anon, authenticated;

-- Solo lectura. Todas las escrituras pasan por los envoltorios públicos, que
-- revalidan identidad y rol dentro de la base. Sin INSERT, sin UPDATE, sin
-- DELETE y sin TRUNCATE para ningún rol de aplicación.
GRANT SELECT ON public.alumnos TO authenticated;
GRANT SELECT ON public.matriculas TO authenticated;

-- ----------------------------------------------------------------
-- Lectura de alumnos
-- ----------------------------------------------------------------
DROP POLICY IF EXISTS "El director consulta todos los legajos academicos" ON public.alumnos;
CREATE POLICY "El director consulta todos los legajos academicos" ON public.alumnos
    FOR SELECT TO authenticated
    USING ((SELECT public.es_director_actual()));

-- Acceso a lo propio y nada más. Un estudiante ajeno no obtiene un error que
-- delate la existencia del otro legajo: simplemente no hay filas.
-- DOCENTE, PADRE y PERSONAL no tienen fila académica propia, así que esta
-- política tampoco les devuelve nada. `anon` queda fuera por falta de GRANT.
DROP POLICY IF EXISTS "El estudiante consulta su propio legajo academico" ON public.alumnos;
CREATE POLICY "El estudiante consulta su propio legajo academico" ON public.alumnos
    FOR SELECT TO authenticated
    USING (perfil_id = (SELECT app_private.perfil_actual()));

-- ----------------------------------------------------------------
-- Lectura del historial de matrículas
-- ----------------------------------------------------------------
DROP POLICY IF EXISTS "El director consulta todo el historial academico" ON public.matriculas;
CREATE POLICY "El director consulta todo el historial academico" ON public.matriculas
    FOR SELECT TO authenticated
    USING ((SELECT public.es_director_actual()));

DROP POLICY IF EXISTS "El estudiante consulta su propio historial academico" ON public.matriculas;
CREATE POLICY "El estudiante consulta su propio historial academico" ON public.matriculas
    FOR SELECT TO authenticated
    USING (alumno_id = (SELECT app_private.perfil_actual()));

-- No se crea ninguna política de INSERT, UPDATE ni DELETE. Aunque alguien
-- otorgara el privilegio por error, RLS seguiría rechazando la escritura directa.


-- ================================================================
-- 15. VISTAS DE LECTURA
-- ================================================================
-- `security_invoker = true` (PostgreSQL 15+) hace que la vista respete las
-- políticas RLS de quien consulta, en lugar de las del dueño. Sin esa opción una
-- vista sería un agujero que expondría todos los legajos.
--
-- El nivel se resuelve acá, en la lectura, a partir de `cursos.nivel_id`. No hay
-- ninguna copia persistida del nivel en `alumnos` ni en `matriculas`.
CREATE VIEW public.alumnos_academicos
WITH (security_invoker = true) AS
SELECT
    a.perfil_id                     AS id,
    p.nombre,
    p.apellido,
    p.dni,
    p.legajo_nro,
    p.fecha_nacimiento,
    p.telefono,
    p.direccion,
    a.estado,
    a.fecha_actualizacion,
    (p.user_id IS NOT NULL)         AS tiene_cuenta,
    m.id                            AS matricula_id,
    m.fecha_inicio                  AS matricula_desde,
    c.id                            AS curso_id,
    c.denominacion                  AS curso_denominacion,
    c.division                      AS curso_division,
    c.activo                        AS curso_activo,
    n.id                            AS nivel_id,
    n.nombre                        AS nivel_nombre
FROM public.alumnos a
JOIN public.perfiles p ON p.id = a.perfil_id
LEFT JOIN public.matriculas m
       ON m.alumno_id = a.perfil_id AND m.fecha_cierre IS NULL
LEFT JOIN public.cursos c ON c.id = m.curso_id
LEFT JOIN public.niveles n ON n.id = c.nivel_id;

COMMENT ON VIEW public.alumnos_academicos IS
    'Situación académica vigente de cada alumno con el nivel derivado del curso. Respeta RLS mediante security_invoker.';

CREATE VIEW public.matriculas_historial
WITH (security_invoker = true) AS
SELECT
    m.id,
    m.alumno_id,
    m.fecha_inicio,
    m.fecha_cierre,
    m.motivo_cierre,
    c.id           AS curso_id,
    c.denominacion AS curso_denominacion,
    c.division     AS curso_division,
    c.activo       AS curso_activo,
    n.id           AS nivel_id,
    n.nombre       AS nivel_nombre
FROM public.matriculas m
JOIN public.cursos c ON c.id = m.curso_id
JOIN public.niveles n ON n.id = c.nivel_id;

COMMENT ON VIEW public.matriculas_historial IS
    'Historial completo de cursos por alumno, incluidos los cursos hoy inactivos. Respeta RLS mediante security_invoker.';

REVOKE ALL ON public.alumnos_academicos FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.matriculas_historial FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.alumnos_academicos TO authenticated;
GRANT SELECT ON public.matriculas_historial TO authenticated;
