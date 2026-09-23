-- ============================================================
-- EDUCAR PARA TRANSFORMAR — Compatibilidad horaria deportiva (EPT-12)
-- ============================================================
-- Migración aditiva. No modifica ni renumera 001 a 014: las funciones de 014
-- que cambian se reemplazan acá con CREATE OR REPLACE.
--
-- Cubre EPT-38 (horarios y su relación con los grupos), EPT-39 (una única
-- comparación de intervalos), EPT-40 (la regla en el alta del alumno y en el
-- alta administrativa), EPT-41 (el conflicto identifica deporte, día y rango).
--
-- ============================================================
-- CONTRATO DE HORARIOS
-- ============================================================
--   * Día de semana: entero de 1 a 7, con 1 = lunes y 7 = domingo (ISO 8601,
--     igual que `EXTRACT(ISODOW ...)`).
--   * Hora de inicio y de fin: TIME sin zona horaria. Un horario semanal es
--     recurrente y local a la escuela; no representa un instante.
--   * Cada franja es el intervalo SEMIABIERTO [inicio, fin): incluye el
--     inicio y excluye el fin. Por eso dos franjas contiguas —una termina
--     exactamente cuando empieza la otra— NO se superponen.
--   * inicio < fin. Una franja no cruza la medianoche.
--
-- Condición canónica de superposición, única en toda la base:
--
--     mismo día  Y  inicio_a < fin_b  Y  inicio_b < fin_a
--
-- La implementa `app_private.intervalos_se_superponen`. Toda comprobación de
-- esta migración la invoca; no hay una segunda fórmula. El servidor tiene una
-- copia exacta en `src/lib/horarios.ts`, probada contra esta función.
--
-- ============================================================
-- MODELO
-- ============================================================
--   1. `public.horarios`: catálogo de franjas semanales (día, inicio, fin),
--      únicas por esa terna. No sabe nada de deportes: EPT-57 puede
--      relacionarlo con materias o cursos sin tocar esta tabla.
--
--   2. `public.grupos_deportivos_horarios`: relación explícita grupo ↔
--      horario. Un grupo puede tener varias franjas. La baja es lógica
--      (`activo = FALSE`) y volver a asignar una franja crea una fila nueva,
--      igual que las inscripciones.
--
-- ============================================================
-- INVARIANTES Y CÓMO SE GARANTIZAN
-- ============================================================
-- | Invariante                                              | Garantía                             |
-- |---------------------------------------------------------|--------------------------------------|
-- | Día entre 1 y 7                                         | CHECK                                |
-- | Inicio anterior al fin                                  | CHECK                                |
-- | Una sola fila por (día, inicio, fin) en el catálogo     | UNIQUE                               |
-- | Un horario del catálogo no cambia                       | trigger BEFORE UPDATE                |
-- | La misma franja no se asigna dos veces activa al grupo  | índice único parcial                 |
-- | Las franjas activas de un grupo no se superponen        | trigger con grupo bloqueado          |
-- | Asignar una franja no crea conflictos a los inscriptos  | trigger con grupo bloqueado          |
-- | Sin horario cargado no hay inscripción nueva            | trigger de inscripción (P5583)       |
-- | Ningún alumno con dos grupos activos superpuestos       | trigger de inscripción (P5584)       |
-- | Una inscripción cancelada no participa del conflicto    | filtro estado = 'ACTIVA'             |
-- | Alumno y DIRECTOR pasan por la misma regla              | ambos insertan; decide el trigger    |
-- | Solo DIRECTOR configura horarios o inscribe a terceros  | RPC + es_director()                  |
-- | Historial conservado, sin borrado físico                | sin DELETE, FK RESTRICT              |
--
-- ============================================================
-- ORDEN DE BLOQUEOS (extiende el de 014)
-- ============================================================
--     alumnos  →  grupos_deportivos (por id)  →  deportes
--
-- Alta (alumno o DIRECTOR): el trigger bloquea al alumno (FOR NO KEY UPDATE,
-- como en 014) y después, en UNA sentencia ordenada por id, el grupo pedido y
-- todos los grupos donde el alumno ya tiene una inscripción ACTIVA. Bloquear
-- los grupos propios es lo que impide que una franja nueva se cuele en uno de
-- ellos mientras se evalúa el alta. El orden por id evita ciclos entre dos
-- altas que tocan los mismos grupos en sentido inverso.
--
-- Franjas (DIRECTOR): toman primero un bloqueo consultivo de transacción,
-- único para toda la configuración de horarios deportivos, y después el grupo.
-- El bloqueo consultivo serializa dos cambios de franjas en grupos distintos
-- que comparten alumnos; sin él, cada uno validaría contra el estado anterior
-- del otro. Es una operación administrativa infrecuente: serializarla no
-- tiene costo real. Nunca se toma en el camino del alta, así que no hay ciclo.
--
-- ============================================================
-- CÓDIGOS SQLSTATE PROPIOS
-- ============================================================
-- Bloque nuevo P5583–P5592, contiguo al de 014 y sin colisión.
--   P5583  el grupo no tiene horarios cargados
--   P5584  el horario del grupo se superpone con otra actividad del alumno
--   P5585  el día de semana no es válido
--   P5586  el rango horario no es válido
--   P5587  la franja ya está asignada al grupo
--   P5588  la franja se superpone con otra franja del mismo grupo
--   P5589  la franja generaría un conflicto a alumnos ya inscriptos
--   P5590  la franja no existe en ese grupo
--   P5591  la franja ya estaba dada de baja
--   P5592  la operación alteraría la identidad de un horario o de una franja
-- Reutilizados: P5505, 42501, P5568, P5570–P5577 (014).
-- ============================================================


-- ================================================================
-- 1. PRECONDICIONES
-- ================================================================
DO $$
BEGIN
    IF pg_catalog.to_regclass('public.grupos_deportivos') IS NULL
       OR pg_catalog.to_regclass('public.inscripciones_deportivas') IS NULL
       OR pg_catalog.to_regclass('public.deportes') IS NULL
       OR pg_catalog.to_regclass('public.alumnos') IS NULL
    THEN
        RAISE EXCEPTION
            'Migración 015: faltan las tablas deportivas de 014; la base no corresponde a 001–014.';
    END IF;

    IF pg_catalog.to_regprocedure('app_private.validar_inscripcion_deportiva()') IS NULL
       OR pg_catalog.to_regprocedure('app_private.inscribir_en_grupo_deportivo(uuid)') IS NULL
       OR pg_catalog.to_regprocedure('app_private.nivel_alumno(uuid)') IS NULL
       OR pg_catalog.to_regprocedure('app_private.es_director()') IS NULL
       OR pg_catalog.to_regprocedure('app_private.rol_actual()') IS NULL
       OR pg_catalog.to_regprocedure('app_private.perfil_actual()') IS NULL
       OR pg_catalog.to_regprocedure('public.es_director_actual()') IS NULL
    THEN
        RAISE EXCEPTION
            'Migración 015: faltan funciones de 003–014; la base no corresponde a 001–014.';
    END IF;

    IF pg_catalog.to_regclass('public.horarios') IS NOT NULL
       OR pg_catalog.to_regclass('public.grupos_deportivos_horarios') IS NOT NULL
    THEN
        RAISE EXCEPTION
            'Migración 015: ya existen objetos de horarios; revisá el estado de la base antes de continuar.';
    END IF;
END $$;

CREATE TEMPORARY TABLE ept_015_conteos_iniciales (
    relacion TEXT PRIMARY KEY,
    cantidad BIGINT NOT NULL,
    huella   TEXT NOT NULL
) ON COMMIT DROP;

-- La migración no escribe filas deportivas: se comprueba al final por huella.
INSERT INTO ept_015_conteos_iniciales (relacion, cantidad, huella)
VALUES
    ('grupos_deportivos',
        (SELECT pg_catalog.count(*) FROM public.grupos_deportivos),
        (SELECT pg_catalog.md5(COALESCE(pg_catalog.string_agg(
             pg_catalog.concat_ws('|', id, deporte_id, nivel_id, nombre, cupo, profesor_id, activo),
             ';' ORDER BY id), ''))
         FROM public.grupos_deportivos)),
    ('inscripciones_deportivas',
        (SELECT pg_catalog.count(*) FROM public.inscripciones_deportivas),
        (SELECT pg_catalog.md5(COALESCE(pg_catalog.string_agg(
             pg_catalog.concat_ws('|', id, alumno_id, grupo_id, deporte_id, estado,
                                  fecha_inscripcion, fecha_cancelacion),
             ';' ORDER BY id), ''))
         FROM public.inscripciones_deportivas));


-- ================================================================
-- 2. COMPARACIÓN DE INTERVALOS (EPT-39)
-- ================================================================
-- Única definición de superposición. IMMUTABLE y sin acceso a tablas: se
-- puede evaluar en cualquier contexto y probar exhaustivamente.
CREATE OR REPLACE FUNCTION app_private.intervalos_se_superponen(
    p_dia_a    SMALLINT,
    p_inicio_a TIME,
    p_fin_a    TIME,
    p_dia_b    SMALLINT,
    p_inicio_b TIME,
    p_fin_b    TIME
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
    -- Semiabiertos [inicio, fin): la igualdad fin_a = inicio_b NO superpone.
    SELECT p_dia_a = p_dia_b
       AND p_inicio_a < p_fin_b
       AND p_inicio_b < p_fin_a;
$$;

COMMENT ON FUNCTION app_private.intervalos_se_superponen(SMALLINT, TIME, TIME, SMALLINT, TIME, TIME) IS
    'Única comparación de franjas semanales: mismo día e intersección de intervalos semiabiertos [inicio, fin). Las franjas contiguas no se superponen.';

REVOKE ALL ON FUNCTION app_private.intervalos_se_superponen(SMALLINT, TIME, TIME, SMALLINT, TIME, TIME)
    FROM PUBLIC, anon, authenticated, service_role;

-- Nombre del día para los mensajes. 1 = lunes … 7 = domingo.
CREATE OR REPLACE FUNCTION app_private.nombre_dia_semana(p_dia SMALLINT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
    SELECT (ARRAY['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'])[p_dia];
$$;

REVOKE ALL ON FUNCTION app_private.nombre_dia_semana(SMALLINT)
    FROM PUBLIC, anon, authenticated, service_role;


-- ================================================================
-- 3. CATÁLOGO DE HORARIOS (EPT-38)
-- ================================================================
CREATE TABLE public.horarios (
    id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
    dia_semana SMALLINT NOT NULL,
    hora_inicio TIME WITHOUT TIME ZONE NOT NULL,
    hora_fin TIME WITHOUT TIME ZONE NOT NULL,
    fecha_creacion TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT horarios_dia_semana_valido CHECK (dia_semana BETWEEN 1 AND 7),
    CONSTRAINT horarios_rango_valido CHECK (hora_inicio < hora_fin),
    CONSTRAINT horarios_franja_unica UNIQUE (dia_semana, hora_inicio, hora_fin)
);

COMMENT ON TABLE public.horarios IS
    'Catálogo de franjas semanales recurrentes. Intervalo semiabierto [hora_inicio, hora_fin). Reutilizable por otros módulos (EPT-57).';
COMMENT ON COLUMN public.horarios.dia_semana IS
    'Día de la semana ISO 8601: 1 = lunes … 7 = domingo.';
COMMENT ON COLUMN public.horarios.hora_inicio IS
    'Inicio incluido de la franja, hora local de la escuela sin zona horaria.';
COMMENT ON COLUMN public.horarios.hora_fin IS
    'Fin excluido de la franja: una franja que empieza a esta hora es contigua, no superpuesta.';

-- Una fila del catálogo puede estar referenciada por muchos grupos: cambiar su
-- día o su rango movería a todos sin validar ningún conflicto.
CREATE OR REPLACE FUNCTION app_private.proteger_identidad_horario()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.dia_semana IS DISTINCT FROM OLD.dia_semana
       OR NEW.hora_inicio IS DISTINCT FROM OLD.hora_inicio
       OR NEW.hora_fin IS DISTINCT FROM OLD.hora_fin
       OR NEW.id IS DISTINCT FROM OLD.id THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5592',
            MESSAGE = 'Un horario del catálogo no puede modificarse; asigná otra franja.';
    END IF;
    NEW.fecha_creacion := OLD.fecha_creacion;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.proteger_identidad_horario()
    FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER proteger_identidad_horario_antes_de_actualizar
    BEFORE UPDATE ON public.horarios
    FOR EACH ROW
    EXECUTE FUNCTION app_private.proteger_identidad_horario();


-- ================================================================
-- 4. RELACIÓN GRUPO ↔ HORARIO (EPT-38)
-- ================================================================
CREATE TABLE public.grupos_deportivos_horarios (
    id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
    grupo_id UUID NOT NULL
        REFERENCES public.grupos_deportivos(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    horario_id UUID NOT NULL
        REFERENCES public.horarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_alta TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    fecha_baja TIMESTAMP WITH TIME ZONE,
    CONSTRAINT grupos_deportivos_horarios_baja_coherente
        CHECK (activo = (fecha_baja IS NULL)),
    CONSTRAINT grupos_deportivos_horarios_baja_posterior
        CHECK (fecha_baja IS NULL OR fecha_baja >= fecha_alta)
);

COMMENT ON TABLE public.grupos_deportivos_horarios IS
    'Franjas semanales de cada grupo deportivo. Un grupo puede tener varias. La baja es lógica y reasignar una franja crea una fila nueva. Nunca se elimina.';

-- Una misma franja no se asigna dos veces ACTIVA al mismo grupo. Parcial: la
-- historia de bajas no colisiona con una reasignación.
CREATE UNIQUE INDEX idx_grupos_deportivos_horarios_unica_activa
    ON public.grupos_deportivos_horarios (grupo_id, horario_id)
    WHERE activo;

-- Franjas activas de un grupo (listados y validaciones) e índice de la FK a
-- grupos. No es parcial para que cubra la clave foránea completa.
CREATE INDEX idx_grupos_deportivos_horarios_grupo
    ON public.grupos_deportivos_horarios (grupo_id, activo);

-- Índice de la FK hacia el catálogo.
CREATE INDEX idx_grupos_deportivos_horarios_horario
    ON public.grupos_deportivos_horarios (horario_id);


-- ================================================================
-- 5. ÍNDICE DE LA CLAVE FORÁNEA COMPUESTA DE 014
-- ================================================================
-- Hallazgo del advisor `unindexed_foreign_keys` sobre
-- `inscripciones_deportivas_grupo_deporte_fk (grupo_id, deporte_id)`: el índice
-- `(grupo_id, estado)` de 014 no tiene `deporte_id` como segunda columna, así
-- que no cubre la clave compuesta. Sin este índice, un cambio sobre la fila
-- referenciada de `grupos_deportivos` recorre `inscripciones_deportivas`
-- completa para comprobar la restricción. 014 no se edita: se corrige acá.
CREATE INDEX idx_inscripciones_deportivas_grupo_deporte
    ON public.inscripciones_deportivas (grupo_id, deporte_id);


-- ================================================================
-- 6. CONFLICTO DE UN ALUMNO CON UN GRUPO (EPT-39, EPT-41)
-- ================================================================
-- Devuelve la PRIMERA franja activa de otro grupo ACTIVO del alumno que se
-- superpone con alguna franja activa del grupo pedido, con el deporte, el
-- grupo, el día y el rango que originan el conflicto. Cero filas = compatible.
--
-- Solo mira inscripciones del alumno indicado: el conflicto nunca revela datos
-- de otra persona. Las inscripciones CANCELADAS no participan. El grupo pedido
-- se excluye a sí mismo (un duplicado es otra regla, P5575).
--
-- No es ejecutable por los roles de aplicación: la invocan el trigger de alta
-- y las consultas de compatibilidad, que ya resolvieron quién es el alumno.
CREATE OR REPLACE FUNCTION app_private.primer_conflicto_horario(
    p_alumno_id UUID,
    p_grupo_id  UUID
)
RETURNS TABLE (
    deporte_nombre TEXT,
    grupo_id       UUID,
    grupo_nombre   TEXT,
    dia_semana     SMALLINT,
    hora_inicio    TIME,
    hora_fin       TIME,
    nuevo_dia_semana  SMALLINT,
    nuevo_hora_inicio TIME,
    nuevo_hora_fin    TIME
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT d.nombre::TEXT, g.id, g.nombre::TEXT,
           he.dia_semana, he.hora_inicio, he.hora_fin,
           hn.dia_semana, hn.hora_inicio, hn.hora_fin
    FROM public.inscripciones_deportivas i
    JOIN public.grupos_deportivos g ON g.id = i.grupo_id
    JOIN public.deportes d ON d.id = g.deporte_id
    JOIN public.grupos_deportivos_horarios fe ON fe.grupo_id = g.id AND fe.activo
    JOIN public.horarios he ON he.id = fe.horario_id
    JOIN public.grupos_deportivos_horarios fn ON fn.grupo_id = p_grupo_id AND fn.activo
    JOIN public.horarios hn ON hn.id = fn.horario_id
    WHERE i.alumno_id = p_alumno_id
      AND i.estado = 'ACTIVA'
      AND i.grupo_id <> p_grupo_id
      AND app_private.intervalos_se_superponen(
              hn.dia_semana, hn.hora_inicio, hn.hora_fin,
              he.dia_semana, he.hora_inicio, he.hora_fin)
    ORDER BY he.dia_semana, he.hora_inicio, d.nombre, g.nombre
    LIMIT 1;
$$;

REVOKE ALL ON FUNCTION app_private.primer_conflicto_horario(UUID, UUID)
    FROM PUBLIC, anon, authenticated, service_role;

-- Mensaje y detalle estructurado del conflicto. El detalle viaja en JSON por
-- el campo DETAIL para que el servidor construya el texto sin interpretar el
-- mensaje; ambos contienen exactamente los mismos datos.
CREATE OR REPLACE FUNCTION app_private.lanzar_conflicto_horario(
    p_deporte TEXT,
    p_grupo   TEXT,
    p_dia     SMALLINT,
    p_inicio  TIME,
    p_fin     TIME
)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION USING
        ERRCODE = 'P5584',
        MESSAGE = pg_catalog.format(
            'Conflicto de horario con %s (%s): %s de %s a %s.',
            p_deporte, p_grupo, app_private.nombre_dia_semana(p_dia),
            pg_catalog.to_char(p_inicio, 'HH24:MI'), pg_catalog.to_char(p_fin, 'HH24:MI')),
        DETAIL = pg_catalog.json_build_object(
            'deporte', p_deporte,
            'grupo', p_grupo,
            'dia_semana', p_dia,
            'hora_inicio', pg_catalog.to_char(p_inicio, 'HH24:MI'),
            'hora_fin', pg_catalog.to_char(p_fin, 'HH24:MI'))::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION app_private.lanzar_conflicto_horario(TEXT, TEXT, SMALLINT, TIME, TIME)
    FROM PUBLIC, anon, authenticated, service_role;


-- ================================================================
-- 7. INVARIANTES DE INSCRIPCIÓN, AHORA CON HORARIOS (EPT-40)
-- ================================================================
-- Reemplaza la función de 014. Todo lo anterior se conserva en el mismo orden
-- y con los mismos códigos; cambian dos cosas:
--   a) después del alumno se bloquean, en una sentencia ordenada por id, el
--      grupo pedido y los grupos donde el alumno ya está ACTIVO;
--   b) al final, después de todas las reglas de 014, se exige que el grupo
--      tenga horario (P5583) y que no se superponga con los grupos activos del
--      alumno (P5584).
-- Las comprobaciones de horario van al final a propósito: ninguna respuesta
-- que EPT-11 ya daba cambia de código por esta historia.
CREATE OR REPLACE FUNCTION app_private.validar_inscripcion_deportiva()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_estado_alumno  public.estado_alumno;
    v_nivel_alumno   INTEGER;
    v_grupo          public.grupos_deportivos;
    v_deporte_activo BOOLEAN;
    v_activas        BIGINT;
    v_ocupados       BIGINT;
    v_conflicto      RECORD;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.alumno_id IS DISTINCT FROM OLD.alumno_id
           OR NEW.grupo_id IS DISTINCT FROM OLD.grupo_id
           OR NEW.deporte_id IS DISTINCT FROM OLD.deporte_id
           OR NEW.fecha_inscripcion IS DISTINCT FROM OLD.fecha_inscripcion THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P5580',
                MESSAGE = 'El alumno, el grupo, el deporte y la fecha de alta de una inscripción no pueden modificarse.';
        END IF;

        IF OLD.estado = 'CANCELADA' AND NEW.estado = 'CANCELADA' THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P5579',
                MESSAGE = 'La inscripción ya está cancelada.';
        END IF;

        IF OLD.estado = 'CANCELADA' AND NEW.estado = 'ACTIVA' THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P5580',
                MESSAGE = 'Una inscripción cancelada no se reactiva. Volvé a inscribirte para registrar un ciclo nuevo.';
        END IF;

        IF NEW.estado = 'CANCELADA' THEN
            -- Mismo orden que 014: alumno y luego grupo. La baja libera la
            -- plaza y también el horario: desde que confirma, la fila deja de
            -- ser ACTIVA y ya no participa de ningún conflicto.
            PERFORM 1 FROM public.alumnos a
            WHERE a.perfil_id = OLD.alumno_id
            FOR NO KEY UPDATE;

            PERFORM 1 FROM public.grupos_deportivos g
            WHERE g.id = OLD.grupo_id
            FOR NO KEY UPDATE;

            NEW.fecha_cancelacion := NOW();
        END IF;

        RETURN NEW;
    END IF;

    IF NEW.estado IS DISTINCT FROM 'ACTIVA' OR NEW.fecha_cancelacion IS NOT NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5580',
            MESSAGE = 'Una inscripción nueva solo puede crearse en estado ACTIVA.';
    END IF;

    -- 1) Alumno: se bloquea primero. Serializa todas las altas y bajas del
    --    mismo alumno: es lo que hace exactos el límite de dos deportes y la
    --    compatibilidad horaria entre dos altas simultáneas.
    SELECT a.estado INTO v_estado_alumno
    FROM public.alumnos a
    WHERE a.perfil_id = NEW.alumno_id
    FOR NO KEY UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5570',
            MESSAGE = 'La persona indicada no tiene legajo académico de alumno.';
    END IF;

    IF v_estado_alumno <> 'ACTIVO' THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5571',
            MESSAGE = 'Solo un alumno con estado ACTIVO puede inscribirse a un deporte.';
    END IF;

    v_nivel_alumno := app_private.nivel_alumno(NEW.alumno_id);
    IF v_nivel_alumno IS NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5572',
            MESSAGE = 'El alumno no tiene un curso vigente del que derivar su nivel.';
    END IF;

    -- 2) Grupos: el pedido y los activos del alumno, en orden de id. Mientras
    --    el alumno está bloqueado su conjunto de grupos activos no cambia, así
    --    que la lista es estable. Estos bloqueos serializan el alta con el cupo
    --    del grupo pedido (014) y con cualquier cambio de franjas de los
    --    grupos involucrados (sección 8).
    PERFORM 1
    FROM public.grupos_deportivos g
    WHERE g.id = NEW.grupo_id
       OR g.id IN (
           SELECT i.grupo_id FROM public.inscripciones_deportivas i
           WHERE i.alumno_id = NEW.alumno_id AND i.estado = 'ACTIVA'
       )
    ORDER BY g.id
    FOR NO KEY UPDATE;

    SELECT * INTO v_grupo
    FROM public.grupos_deportivos g
    WHERE g.id = NEW.grupo_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P5568', MESSAGE = 'El grupo deportivo solicitado no existe.';
    END IF;

    IF NOT v_grupo.activo THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5569',
            MESSAGE = 'El grupo deportivo está inactivo y no admite inscripciones.';
    END IF;

    SELECT d.activo INTO v_deporte_activo
    FROM public.deportes d
    WHERE d.id = v_grupo.deporte_id
    FOR SHARE;

    IF NOT v_deporte_activo THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5561',
            MESSAGE = 'El deporte está inactivo y no admite inscripciones.';
    END IF;

    NEW.deporte_id := v_grupo.deporte_id;

    IF v_grupo.nivel_id <> v_nivel_alumno THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5573',
            MESSAGE = 'El grupo no corresponde a tu nivel educativo.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.inscripciones_deportivas i
        WHERE i.alumno_id = NEW.alumno_id
          AND i.grupo_id = NEW.grupo_id
          AND i.estado = 'ACTIVA'
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5575',
            MESSAGE = 'Ya estás inscripto en este grupo.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.inscripciones_deportivas i
        WHERE i.alumno_id = NEW.alumno_id
          AND i.deporte_id = NEW.deporte_id
          AND i.estado = 'ACTIVA'
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5576',
            MESSAGE = 'Ya estás inscripto en otro grupo de este deporte.';
    END IF;

    SELECT pg_catalog.count(*) INTO v_activas
    FROM public.inscripciones_deportivas i
    WHERE i.alumno_id = NEW.alumno_id
      AND i.estado = 'ACTIVA';

    IF v_activas >= 2 THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5577',
            MESSAGE = 'Ya tenés dos deportes activos, que es el máximo permitido. Cancelá uno para inscribirte en otro.';
    END IF;

    SELECT pg_catalog.count(*) INTO v_ocupados
    FROM public.inscripciones_deportivas i
    WHERE i.grupo_id = NEW.grupo_id
      AND i.estado = 'ACTIVA';

    IF v_ocupados >= v_grupo.cupo THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5574',
            MESSAGE = 'El grupo no tiene plazas disponibles.';
    END IF;

    -- 3) Horario (EPT-12). Un grupo sin franjas activas no puede decir si
    --    choca con otra actividad: se rechaza en lugar de suponer que no.
    IF NOT EXISTS (
        SELECT 1 FROM public.grupos_deportivos_horarios f
        WHERE f.grupo_id = NEW.grupo_id AND f.activo
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5583',
            MESSAGE = 'El grupo todavía no tiene horarios cargados y no admite inscripciones.';
    END IF;

    SELECT * INTO v_conflicto
    FROM app_private.primer_conflicto_horario(NEW.alumno_id, NEW.grupo_id);

    IF FOUND THEN
        PERFORM app_private.lanzar_conflicto_horario(
            v_conflicto.deporte_nombre, v_conflicto.grupo_nombre,
            v_conflicto.dia_semana, v_conflicto.hora_inicio, v_conflicto.hora_fin);
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.validar_inscripcion_deportiva()
    FROM PUBLIC, anon, authenticated, service_role;


-- ================================================================
-- 8. INVARIANTES DE LAS FRANJAS DE UN GRUPO
-- ================================================================
-- Autoridad de las reglas de franjas, también si alguien escribiera la tabla
-- por fuera de las RPC.
CREATE OR REPLACE FUNCTION app_private.validar_franja_grupo_deportivo()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_horario    public.horarios;
    v_otra       RECORD;
    v_afectados  BIGINT;
BEGIN
    -- Serializa toda la configuración de franjas deportivas (ver cabecera).
    -- La clave es fija y propia de esta tabla.
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext('public.grupos_deportivos_horarios'));

    IF TG_OP = 'UPDATE' THEN
        IF NEW.id IS DISTINCT FROM OLD.id
           OR NEW.grupo_id IS DISTINCT FROM OLD.grupo_id
           OR NEW.horario_id IS DISTINCT FROM OLD.horario_id
           OR NEW.fecha_alta IS DISTINCT FROM OLD.fecha_alta THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P5592',
                MESSAGE = 'El grupo, el horario y la fecha de alta de una franja no pueden modificarse.';
        END IF;

        IF NOT OLD.activo AND NOT NEW.activo THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P5591',
                MESSAGE = 'La franja ya estaba dada de baja.';
        END IF;

        -- Reasignar una franja es una fila nueva, que vuelve a validarse.
        IF NOT OLD.activo AND NEW.activo THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P5592',
                MESSAGE = 'Una franja dada de baja no se reactiva. Asignala de nuevo al grupo.';
        END IF;

        IF NOT NEW.activo THEN
            -- Quitar una franja nunca crea un conflicto. Bloquea el grupo para
            -- ordenarse con las altas que lo están evaluando.
            PERFORM 1 FROM public.grupos_deportivos g
            WHERE g.id = OLD.grupo_id
            FOR NO KEY UPDATE;
            NEW.fecha_baja := NOW();
        END IF;

        RETURN NEW;
    END IF;

    -- A partir de acá, TG_OP = 'INSERT'. Una franja nueva nace activa.
    IF NOT NEW.activo OR NEW.fecha_baja IS NOT NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5592',
            MESSAGE = 'Una franja nueva solo puede crearse activa.';
    END IF;
    NEW.fecha_alta := NOW();

    -- El grupo se bloquea como en el alta de inscripciones: ninguna alta puede
    -- evaluar este grupo mientras cambia su horario, y viceversa.
    PERFORM 1 FROM public.grupos_deportivos g
    WHERE g.id = NEW.grupo_id
    FOR NO KEY UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P5568', MESSAGE = 'El grupo deportivo solicitado no existe.';
    END IF;

    SELECT * INTO v_horario FROM public.horarios h WHERE h.id = NEW.horario_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P5586', MESSAGE = 'El horario solicitado no existe.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.grupos_deportivos_horarios f
        WHERE f.grupo_id = NEW.grupo_id AND f.horario_id = NEW.horario_id AND f.activo
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5587',
            MESSAGE = 'Esa franja ya está asignada al grupo.';
    END IF;

    -- Dos franjas del mismo grupo no pueden superponerse entre sí.
    SELECT h.dia_semana, h.hora_inicio, h.hora_fin INTO v_otra
    FROM public.grupos_deportivos_horarios f
    JOIN public.horarios h ON h.id = f.horario_id
    WHERE f.grupo_id = NEW.grupo_id
      AND f.activo
      AND app_private.intervalos_se_superponen(
              v_horario.dia_semana, v_horario.hora_inicio, v_horario.hora_fin,
              h.dia_semana, h.hora_inicio, h.hora_fin)
    ORDER BY h.dia_semana, h.hora_inicio
    LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5588',
            MESSAGE = pg_catalog.format(
                'La franja se superpone con otra franja del grupo: %s de %s a %s.',
                app_private.nombre_dia_semana(v_otra.dia_semana),
                pg_catalog.to_char(v_otra.hora_inicio, 'HH24:MI'),
                pg_catalog.to_char(v_otra.hora_fin, 'HH24:MI')),
            DETAIL = pg_catalog.json_build_object(
                'dia_semana', v_otra.dia_semana,
                'hora_inicio', pg_catalog.to_char(v_otra.hora_inicio, 'HH24:MI'),
                'hora_fin', pg_catalog.to_char(v_otra.hora_fin, 'HH24:MI'))::TEXT;
    END IF;

    -- Una franja nueva no puede superponerse con otra actividad ACTIVA de los
    -- alumnos que ya están inscriptos en el grupo: la regla de EPT-12 vale
    -- para el estado resultante, no solo para el momento del alta. El mensaje
    -- informa el deporte, el día, el rango y CUÁNTOS alumnos, nunca quiénes.
    SELECT d.nombre::TEXT AS deporte_nombre, g2.nombre::TEXT AS grupo_nombre,
           h2.dia_semana, h2.hora_inicio, h2.hora_fin
    INTO v_otra
    FROM public.inscripciones_deportivas propia
    JOIN public.inscripciones_deportivas otra
      ON otra.alumno_id = propia.alumno_id
     AND otra.estado = 'ACTIVA'
     AND otra.grupo_id <> propia.grupo_id
    JOIN public.grupos_deportivos g2 ON g2.id = otra.grupo_id
    JOIN public.deportes d ON d.id = g2.deporte_id
    JOIN public.grupos_deportivos_horarios f2 ON f2.grupo_id = g2.id AND f2.activo
    JOIN public.horarios h2 ON h2.id = f2.horario_id
    WHERE propia.grupo_id = NEW.grupo_id
      AND propia.estado = 'ACTIVA'
      AND app_private.intervalos_se_superponen(
              v_horario.dia_semana, v_horario.hora_inicio, v_horario.hora_fin,
              h2.dia_semana, h2.hora_inicio, h2.hora_fin)
    ORDER BY h2.dia_semana, h2.hora_inicio, d.nombre, g2.nombre
    LIMIT 1;

    IF FOUND THEN
        SELECT pg_catalog.count(DISTINCT propia.alumno_id) INTO v_afectados
        FROM public.inscripciones_deportivas propia
        JOIN public.inscripciones_deportivas otra
          ON otra.alumno_id = propia.alumno_id
         AND otra.estado = 'ACTIVA'
         AND otra.grupo_id <> propia.grupo_id
        JOIN public.grupos_deportivos_horarios f2 ON f2.grupo_id = otra.grupo_id AND f2.activo
        JOIN public.horarios h2 ON h2.id = f2.horario_id
        WHERE propia.grupo_id = NEW.grupo_id
          AND propia.estado = 'ACTIVA'
          AND app_private.intervalos_se_superponen(
                  v_horario.dia_semana, v_horario.hora_inicio, v_horario.hora_fin,
                  h2.dia_semana, h2.hora_inicio, h2.hora_fin);

        RAISE EXCEPTION USING
            ERRCODE = 'P5589',
            MESSAGE = pg_catalog.format(
                'La franja se superpone con %s (%s): %s de %s a %s, donde %s de este grupo.',
                v_otra.deporte_nombre, v_otra.grupo_nombre,
                app_private.nombre_dia_semana(v_otra.dia_semana),
                pg_catalog.to_char(v_otra.hora_inicio, 'HH24:MI'),
                pg_catalog.to_char(v_otra.hora_fin, 'HH24:MI'),
                CASE WHEN v_afectados = 1 THEN 'participa 1 alumno'
                     ELSE pg_catalog.format('participan %s alumnos', v_afectados) END),
            DETAIL = pg_catalog.json_build_object(
                'deporte', v_otra.deporte_nombre,
                'grupo', v_otra.grupo_nombre,
                'dia_semana', v_otra.dia_semana,
                'hora_inicio', pg_catalog.to_char(v_otra.hora_inicio, 'HH24:MI'),
                'hora_fin', pg_catalog.to_char(v_otra.hora_fin, 'HH24:MI'),
                'alumnos_afectados', v_afectados)::TEXT;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.validar_franja_grupo_deportivo()
    FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER validar_franja_grupo_deportivo_antes_de_escribir
    BEFORE INSERT OR UPDATE ON public.grupos_deportivos_horarios
    FOR EACH ROW
    EXECUTE FUNCTION app_private.validar_franja_grupo_deportivo();


-- ================================================================
-- 9. OPERACIONES PRIVILEGIADAS
-- ================================================================
-- Viven en `app_private`, que la Data API no expone. Cada una vuelve a
-- resolver `auth.uid()` y el rol dentro de PostgreSQL.

-- ----------------------------------------------------------------
-- Asignar una franja a un grupo (DIRECTOR)
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.agregar_horario_grupo_deportivo(
    p_grupo_id    UUID,
    p_dia_semana  SMALLINT,
    p_hora_inicio TIME,
    p_hora_fin    TIME
)
RETURNS public.grupos_deportivos_horarios
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_horario_id UUID;
    v_franja     public.grupos_deportivos_horarios;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    IF NOT app_private.es_director() THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Solo la dirección puede configurar los horarios de los grupos deportivos.';
    END IF;

    IF p_grupo_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5568', MESSAGE = 'El grupo deportivo solicitado no existe.';
    END IF;

    IF p_dia_semana IS NULL OR p_dia_semana < 1 OR p_dia_semana > 7 THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5585',
            MESSAGE = 'El día debe ser un número entre 1 (lunes) y 7 (domingo).';
    END IF;

    IF p_hora_inicio IS NULL OR p_hora_fin IS NULL OR p_hora_inicio >= p_hora_fin THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5586',
            MESSAGE = 'La hora de inicio debe ser anterior a la hora de fin.';
    END IF;

    -- Buscar o crear la franja del catálogo. ON CONFLICT resuelve la carrera
    -- entre dos altas simultáneas de la misma terna.
    INSERT INTO public.horarios (dia_semana, hora_inicio, hora_fin)
    VALUES (p_dia_semana, p_hora_inicio, p_hora_fin)
    ON CONFLICT (dia_semana, hora_inicio, hora_fin) DO NOTHING;

    SELECT h.id INTO v_horario_id
    FROM public.horarios h
    WHERE h.dia_semana = p_dia_semana
      AND h.hora_inicio = p_hora_inicio
      AND h.hora_fin = p_hora_fin;

    -- El trigger de la sección 8 valida grupo, duplicado, superposición
    -- interna y conflictos de los inscriptos con el grupo bloqueado.
    INSERT INTO public.grupos_deportivos_horarios (grupo_id, horario_id)
    VALUES (p_grupo_id, v_horario_id)
    RETURNING * INTO v_franja;

    RETURN v_franja;
END;
$$;

-- ----------------------------------------------------------------
-- Dar de baja una franja (DIRECTOR). Baja lógica, nunca DELETE.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.dar_de_baja_horario_grupo_deportivo(
    p_grupo_id  UUID,
    p_franja_id UUID
)
RETURNS public.grupos_deportivos_horarios
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_activo BOOLEAN;
    v_franja public.grupos_deportivos_horarios;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    IF NOT app_private.es_director() THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Solo la dirección puede configurar los horarios de los grupos deportivos.';
    END IF;

    UPDATE public.grupos_deportivos_horarios
    SET activo = FALSE
    WHERE id = p_franja_id
      AND grupo_id = p_grupo_id
      AND activo
    RETURNING * INTO v_franja;

    IF v_franja.id IS NULL THEN
        SELECT f.activo INTO v_activo
        FROM public.grupos_deportivos_horarios f
        WHERE f.id = p_franja_id AND f.grupo_id = p_grupo_id;

        IF v_activo IS FALSE THEN
            RAISE EXCEPTION USING ERRCODE = 'P5591', MESSAGE = 'La franja ya estaba dada de baja.';
        END IF;

        RAISE EXCEPTION USING
            ERRCODE = 'P5590',
            MESSAGE = 'La franja no existe en ese grupo.';
    END IF;

    RETURN v_franja;
END;
$$;

-- ----------------------------------------------------------------
-- Alta administrativa (DIRECTOR inscribe a un alumno)
-- ----------------------------------------------------------------
-- Inserta la MISMA fila que el alta del alumno y la valida el MISMO trigger:
-- cupo, nivel, estado, duplicados, máximo de dos, horario y conflicto. La única
-- diferencia es quién es el alumno: acá lo elige la dirección. Los rechazos de
-- 014 hablan en segunda persona al alumno; para la dirección se reformulan en
-- tercera persona conservando el código.
CREATE OR REPLACE FUNCTION app_private.inscribir_alumno_en_grupo_deportivo(
    p_alumno_id UUID,
    p_grupo_id  UUID
)
RETURNS public.inscripciones_deportivas
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_inscripcion public.inscripciones_deportivas;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    IF NOT app_private.es_director() THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Solo la dirección puede inscribir a un alumno en un deporte.';
    END IF;

    IF p_alumno_id IS NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5570',
            MESSAGE = 'La persona indicada no tiene legajo académico de alumno.';
    END IF;

    IF p_grupo_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5568', MESSAGE = 'El grupo deportivo solicitado no existe.';
    END IF;

    BEGIN
        INSERT INTO public.inscripciones_deportivas (alumno_id, grupo_id)
        VALUES (p_alumno_id, p_grupo_id)
        RETURNING * INTO v_inscripcion;
    EXCEPTION
        WHEN SQLSTATE 'P5571' THEN
            RAISE EXCEPTION USING ERRCODE = 'P5571',
                MESSAGE = 'El alumno no está ACTIVO y no puede inscribirse a un deporte.';
        WHEN SQLSTATE 'P5573' THEN
            RAISE EXCEPTION USING ERRCODE = 'P5573',
                MESSAGE = 'El grupo no corresponde al nivel educativo del alumno.';
        WHEN SQLSTATE 'P5575' THEN
            RAISE EXCEPTION USING ERRCODE = 'P5575',
                MESSAGE = 'El alumno ya está inscripto en este grupo.';
        WHEN SQLSTATE 'P5576' THEN
            RAISE EXCEPTION USING ERRCODE = 'P5576',
                MESSAGE = 'El alumno ya está inscripto en otro grupo de este deporte.';
        WHEN SQLSTATE 'P5577' THEN
            RAISE EXCEPTION USING ERRCODE = 'P5577',
                MESSAGE = 'El alumno ya tiene dos deportes activos, que es el máximo permitido.';
    END;

    RETURN v_inscripcion;
END;
$$;

-- ----------------------------------------------------------------
-- Consulta de compatibilidad por grupo (EPT-12: «consultar antes de confirmar»)
-- ----------------------------------------------------------------
-- Para cada grupo ACTIVO del nivel del alumno informa si tiene horario y, si
-- lo tiene, el primer conflicto con las actividades ACTIVAS del alumno. Usa
-- exactamente `primer_conflicto_horario`, la misma función del alta: lo que la
-- pantalla anticipa es lo que la base decidiría. Es informativa; el alta lo
-- vuelve a evaluar con el alumno y los grupos bloqueados.
CREATE OR REPLACE FUNCTION app_private.compatibilidad_grupos_de_alumno(p_alumno_id UUID)
RETURNS TABLE (
    grupo_id            UUID,
    tiene_horario       BOOLEAN,
    conflicto_deporte   TEXT,
    conflicto_grupo     TEXT,
    conflicto_dia_semana  SMALLINT,
    conflicto_hora_inicio TIME,
    conflicto_hora_fin    TIME
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT g.id,
           EXISTS (SELECT 1 FROM public.grupos_deportivos_horarios f
                   WHERE f.grupo_id = g.id AND f.activo),
           c.deporte_nombre, c.grupo_nombre, c.dia_semana, c.hora_inicio, c.hora_fin
    FROM public.grupos_deportivos g
    JOIN public.deportes d ON d.id = g.deporte_id
    LEFT JOIN LATERAL app_private.primer_conflicto_horario(p_alumno_id, g.id) c ON TRUE
    WHERE g.activo
      AND d.activo
      AND g.nivel_id = app_private.nivel_alumno(p_alumno_id)
    ORDER BY d.nombre, g.nombre;
$$;

REVOKE ALL ON FUNCTION app_private.compatibilidad_grupos_de_alumno(UUID)
    FROM PUBLIC, anon, authenticated, service_role;

-- Estudiante: siempre sobre sí mismo. No recibe identidad.
CREATE OR REPLACE FUNCTION app_private.consultar_compatibilidad_horaria()
RETURNS TABLE (
    grupo_id            UUID,
    tiene_horario       BOOLEAN,
    conflicto_deporte   TEXT,
    conflicto_grupo     TEXT,
    conflicto_dia_semana  SMALLINT,
    conflicto_hora_inicio TIME,
    conflicto_hora_fin    TIME
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_perfil_id UUID;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    v_perfil_id := app_private.perfil_actual();
    IF v_perfil_id IS NULL OR app_private.rol_actual() IS DISTINCT FROM 'ESTUDIANTE' THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Solo un estudiante puede consultar su compatibilidad horaria.';
    END IF;

    RETURN QUERY SELECT * FROM app_private.compatibilidad_grupos_de_alumno(v_perfil_id);
END;
$$;

-- Dirección: sobre el alumno que elige, para anticipar el alta administrativa.
CREATE OR REPLACE FUNCTION app_private.consultar_compatibilidad_horaria_alumno(p_alumno_id UUID)
RETURNS TABLE (
    grupo_id            UUID,
    tiene_horario       BOOLEAN,
    conflicto_deporte   TEXT,
    conflicto_grupo     TEXT,
    conflicto_dia_semana  SMALLINT,
    conflicto_hora_inicio TIME,
    conflicto_hora_fin    TIME
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    IF NOT app_private.es_director() THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Solo la dirección puede consultar la compatibilidad horaria de un alumno.';
    END IF;

    IF p_alumno_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.alumnos a WHERE a.perfil_id = p_alumno_id
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5570',
            MESSAGE = 'La persona indicada no tiene legajo académico de alumno.';
    END IF;

    RETURN QUERY SELECT * FROM app_private.compatibilidad_grupos_de_alumno(p_alumno_id);
END;
$$;

REVOKE ALL ON FUNCTION app_private.agregar_horario_grupo_deportivo(UUID, SMALLINT, TIME, TIME)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.dar_de_baja_horario_grupo_deportivo(UUID, UUID)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.inscribir_alumno_en_grupo_deportivo(UUID, UUID)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.consultar_compatibilidad_horaria()
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.consultar_compatibilidad_horaria_alumno(UUID)
    FROM PUBLIC, anon, authenticated, service_role;

-- Los envoltorios SECURITY INVOKER necesitan ejecutar la operación privada.
GRANT EXECUTE ON FUNCTION app_private.agregar_horario_grupo_deportivo(UUID, SMALLINT, TIME, TIME)
    TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.dar_de_baja_horario_grupo_deportivo(UUID, UUID)
    TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.inscribir_alumno_en_grupo_deportivo(UUID, UUID)
    TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.consultar_compatibilidad_horaria() TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.consultar_compatibilidad_horaria_alumno(UUID)
    TO authenticated;


-- ================================================================
-- 10. ENVOLTORIOS PÚBLICOS PARA POSTGREST
-- ================================================================
CREATE OR REPLACE FUNCTION public.agregar_horario_grupo_deportivo(
    p_grupo_id    UUID,
    p_dia_semana  SMALLINT,
    p_hora_inicio TIME,
    p_hora_fin    TIME
)
RETURNS public.grupos_deportivos_horarios
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT app_private.agregar_horario_grupo_deportivo(
        p_grupo_id, p_dia_semana, p_hora_inicio, p_hora_fin);
$$;

CREATE OR REPLACE FUNCTION public.dar_de_baja_horario_grupo_deportivo(
    p_grupo_id  UUID,
    p_franja_id UUID
)
RETURNS public.grupos_deportivos_horarios
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT app_private.dar_de_baja_horario_grupo_deportivo(p_grupo_id, p_franja_id);
$$;

CREATE OR REPLACE FUNCTION public.inscribir_alumno_en_grupo_deportivo(
    p_alumno_id UUID,
    p_grupo_id  UUID
)
RETURNS public.inscripciones_deportivas
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT app_private.inscribir_alumno_en_grupo_deportivo(p_alumno_id, p_grupo_id);
$$;

CREATE OR REPLACE FUNCTION public.consultar_compatibilidad_horaria()
RETURNS TABLE (
    grupo_id            UUID,
    tiene_horario       BOOLEAN,
    conflicto_deporte   TEXT,
    conflicto_grupo     TEXT,
    conflicto_dia_semana  SMALLINT,
    conflicto_hora_inicio TIME,
    conflicto_hora_fin    TIME
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT * FROM app_private.consultar_compatibilidad_horaria();
$$;

CREATE OR REPLACE FUNCTION public.consultar_compatibilidad_horaria_alumno(p_alumno_id UUID)
RETURNS TABLE (
    grupo_id            UUID,
    tiene_horario       BOOLEAN,
    conflicto_deporte   TEXT,
    conflicto_grupo     TEXT,
    conflicto_dia_semana  SMALLINT,
    conflicto_hora_inicio TIME,
    conflicto_hora_fin    TIME
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT * FROM app_private.consultar_compatibilidad_horaria_alumno(p_alumno_id);
$$;

REVOKE ALL ON FUNCTION public.agregar_horario_grupo_deportivo(UUID, SMALLINT, TIME, TIME)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dar_de_baja_horario_grupo_deportivo(UUID, UUID)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.inscribir_alumno_en_grupo_deportivo(UUID, UUID)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consultar_compatibilidad_horaria() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consultar_compatibilidad_horaria_alumno(UUID)
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.agregar_horario_grupo_deportivo(UUID, SMALLINT, TIME, TIME)
    TO authenticated;
GRANT EXECUTE ON FUNCTION public.dar_de_baja_horario_grupo_deportivo(UUID, UUID)
    TO authenticated;
GRANT EXECUTE ON FUNCTION public.inscribir_alumno_en_grupo_deportivo(UUID, UUID)
    TO authenticated;
GRANT EXECUTE ON FUNCTION public.consultar_compatibilidad_horaria() TO authenticated;
GRANT EXECUTE ON FUNCTION public.consultar_compatibilidad_horaria_alumno(UUID)
    TO authenticated;


-- ================================================================
-- 11. PRIVILEGIOS MÍNIMOS Y RLS
-- ================================================================
-- Se revoca todo antes de conceder: los privilegios por defecto de `public`
-- alcanzan a anon y también a TRUNCATE.

-- ----------------------------------------------------------------
-- Horarios: catálogo institucional sin datos personales
-- ----------------------------------------------------------------
ALTER TABLE public.horarios ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.horarios FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.horarios TO authenticated;

CREATE POLICY "Los horarios son visibles para las sesiones autenticadas"
    ON public.horarios
    FOR SELECT TO authenticated
    USING (TRUE);

-- ----------------------------------------------------------------
-- Franjas de grupos: las ve quien ve el grupo
-- ----------------------------------------------------------------
-- La subconsulta respeta la RLS de `grupos_deportivos` (014): el director ve
-- todos los grupos, el estudiante los de su nivel y aquellos donde tiene o
-- tuvo una inscripción, y el resto de los roles ninguno. No hay recursión: la
-- política de grupos no consulta esta tabla.
ALTER TABLE public.grupos_deportivos_horarios ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.grupos_deportivos_horarios FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.grupos_deportivos_horarios TO authenticated;

CREATE POLICY "Las franjas son visibles para quien ve el grupo"
    ON public.grupos_deportivos_horarios
    FOR SELECT TO authenticated
    USING (grupo_id IN (SELECT g.id FROM public.grupos_deportivos g));

-- No se crea ninguna política INSERT, UPDATE ni DELETE: toda escritura pasa
-- por las RPC de la sección 9.


-- ================================================================
-- 12. AUTOVERIFICACIÓN
-- ================================================================
DO $$
DECLARE
    v_relacion   TEXT;
    v_antes      RECORD;
    v_despues    BIGINT;
    v_huella     TEXT;
    v_privilegio TEXT;
    v_rol        TEXT;
    v_tabla      TEXT;
    v_firma      pg_catalog.regprocedure;
BEGIN
    -- La migración no altera grupos ni inscripciones existentes.
    SELECT cantidad, huella INTO v_antes
    FROM ept_015_conteos_iniciales WHERE relacion = 'grupos_deportivos';
    SELECT pg_catalog.count(*),
           pg_catalog.md5(COALESCE(pg_catalog.string_agg(
               pg_catalog.concat_ws('|', id, deporte_id, nivel_id, nombre, cupo, profesor_id, activo),
               ';' ORDER BY id), ''))
    INTO v_despues, v_huella
    FROM public.grupos_deportivos;
    IF v_despues <> v_antes.cantidad OR v_huella <> v_antes.huella THEN
        RAISE EXCEPTION 'Autoverificación 015: cambió public.grupos_deportivos.';
    END IF;

    SELECT cantidad, huella INTO v_antes
    FROM ept_015_conteos_iniciales WHERE relacion = 'inscripciones_deportivas';
    SELECT pg_catalog.count(*),
           pg_catalog.md5(COALESCE(pg_catalog.string_agg(
               pg_catalog.concat_ws('|', id, alumno_id, grupo_id, deporte_id, estado,
                                    fecha_inscripcion, fecha_cancelacion),
               ';' ORDER BY id), ''))
    INTO v_despues, v_huella
    FROM public.inscripciones_deportivas;
    IF v_despues <> v_antes.cantidad OR v_huella <> v_antes.huella THEN
        RAISE EXCEPTION 'Autoverificación 015: cambió public.inscripciones_deportivas.';
    END IF;

    -- La comparación canónica responde como se documenta en la cabecera.
    IF NOT app_private.intervalos_se_superponen(1::SMALLINT, '10:00', '11:00', 1::SMALLINT, '10:00', '11:00')
       OR NOT app_private.intervalos_se_superponen(1::SMALLINT, '10:00', '11:00', 1::SMALLINT, '10:30', '11:30')
       OR NOT app_private.intervalos_se_superponen(1::SMALLINT, '10:00', '11:00', 1::SMALLINT, '09:30', '10:30')
       OR NOT app_private.intervalos_se_superponen(1::SMALLINT, '10:00', '11:00', 1::SMALLINT, '10:15', '10:45')
       OR NOT app_private.intervalos_se_superponen(1::SMALLINT, '10:15', '10:45', 1::SMALLINT, '10:00', '11:00')
       OR app_private.intervalos_se_superponen(1::SMALLINT, '10:00', '11:00', 1::SMALLINT, '11:00', '12:00')
       OR app_private.intervalos_se_superponen(1::SMALLINT, '11:00', '12:00', 1::SMALLINT, '10:00', '11:00')
       OR app_private.intervalos_se_superponen(1::SMALLINT, '10:00', '11:00', 2::SMALLINT, '10:00', '11:00')
    THEN
        RAISE EXCEPTION 'Autoverificación 015: la comparación de intervalos no respeta el contrato semiabierto.';
    END IF;

    -- Ningún privilegio de escritura ni de borrado para los roles de aplicación.
    FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        FOREACH v_tabla IN ARRAY ARRAY['public.horarios', 'public.grupos_deportivos_horarios'] LOOP
            FOREACH v_privilegio IN ARRAY ARRAY[
                'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
            ] LOOP
                IF pg_catalog.has_table_privilege(v_rol, v_tabla, v_privilegio) THEN
                    RAISE EXCEPTION 'Autoverificación 015: % conserva % sobre %.',
                        v_rol, v_privilegio, v_tabla;
                END IF;
            END LOOP;
        END LOOP;
    END LOOP;

    IF pg_catalog.has_table_privilege('anon', 'public.horarios', 'SELECT')
       OR pg_catalog.has_table_privilege('anon', 'public.grupos_deportivos_horarios', 'SELECT') THEN
        RAISE EXCEPTION 'Autoverificación 015: anon puede leer horarios.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_class
        WHERE oid IN ('public.horarios'::pg_catalog.regclass,
                      'public.grupos_deportivos_horarios'::pg_catalog.regclass)
          AND NOT relrowsecurity
    ) THEN
        RAISE EXCEPTION 'Autoverificación 015: una tabla de horarios no tiene RLS.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_policies
        WHERE schemaname = 'public'
          AND tablename IN ('horarios', 'grupos_deportivos_horarios')
          AND cmd <> 'SELECT'
    ) THEN
        RAISE EXCEPTION 'Autoverificación 015: existe una política de escritura sobre horarios.';
    END IF;

    FOREACH v_firma IN ARRAY ARRAY[
        'app_private.primer_conflicto_horario(uuid,uuid)'::pg_catalog.regprocedure,
        'app_private.validar_inscripcion_deportiva()'::pg_catalog.regprocedure,
        'app_private.validar_franja_grupo_deportivo()'::pg_catalog.regprocedure,
        'app_private.proteger_identidad_horario()'::pg_catalog.regprocedure,
        'app_private.agregar_horario_grupo_deportivo(uuid,smallint,time,time)'::pg_catalog.regprocedure,
        'app_private.dar_de_baja_horario_grupo_deportivo(uuid,uuid)'::pg_catalog.regprocedure,
        'app_private.inscribir_alumno_en_grupo_deportivo(uuid,uuid)'::pg_catalog.regprocedure,
        'app_private.compatibilidad_grupos_de_alumno(uuid)'::pg_catalog.regprocedure,
        'app_private.consultar_compatibilidad_horaria()'::pg_catalog.regprocedure,
        'app_private.consultar_compatibilidad_horaria_alumno(uuid)'::pg_catalog.regprocedure
    ] LOOP
        IF NOT (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid = v_firma)
           OR (SELECT proconfig FROM pg_catalog.pg_proc WHERE oid = v_firma)
               IS DISTINCT FROM ARRAY['search_path=""']
           OR pg_catalog.has_function_privilege('anon', v_firma, 'EXECUTE') THEN
            RAISE EXCEPTION
                'Autoverificación 015: % no es SECURITY DEFINER con search_path vacío o es ejecutable por anon.',
                v_firma;
        END IF;
    END LOOP;

    -- Las funciones internas no son ejecutables por los roles de aplicación.
    FOREACH v_firma IN ARRAY ARRAY[
        'app_private.intervalos_se_superponen(smallint,time,time,smallint,time,time)'::pg_catalog.regprocedure,
        'app_private.primer_conflicto_horario(uuid,uuid)'::pg_catalog.regprocedure,
        'app_private.compatibilidad_grupos_de_alumno(uuid)'::pg_catalog.regprocedure,
        'app_private.lanzar_conflicto_horario(text,text,smallint,time,time)'::pg_catalog.regprocedure
    ] LOOP
        IF pg_catalog.has_function_privilege('authenticated', v_firma, 'EXECUTE')
           OR pg_catalog.has_function_privilege('anon', v_firma, 'EXECUTE') THEN
            RAISE EXCEPTION 'Autoverificación 015: % es ejecutable por un rol de aplicación.', v_firma;
        END IF;
    END LOOP;

    FOREACH v_firma IN ARRAY ARRAY[
        'public.agregar_horario_grupo_deportivo(uuid,smallint,time,time)'::pg_catalog.regprocedure,
        'public.dar_de_baja_horario_grupo_deportivo(uuid,uuid)'::pg_catalog.regprocedure,
        'public.inscribir_alumno_en_grupo_deportivo(uuid,uuid)'::pg_catalog.regprocedure,
        'public.consultar_compatibilidad_horaria()'::pg_catalog.regprocedure,
        'public.consultar_compatibilidad_horaria_alumno(uuid)'::pg_catalog.regprocedure
    ] LOOP
        IF (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid = v_firma)
           OR (SELECT proconfig FROM pg_catalog.pg_proc WHERE oid = v_firma)
               IS DISTINCT FROM ARRAY['search_path=""']
           OR pg_catalog.has_function_privilege('anon', v_firma, 'EXECUTE')
           OR NOT pg_catalog.has_function_privilege('authenticated', v_firma, 'EXECUTE') THEN
            RAISE EXCEPTION 'Autoverificación 015: el envoltorio % no es SECURITY INVOKER mínimo.', v_firma;
        END IF;
    END LOOP;

    -- La consulta del estudiante no acepta identidad del llamador.
    IF (SELECT pronargs FROM pg_catalog.pg_proc
        WHERE oid = 'public.consultar_compatibilidad_horaria()'::pg_catalog.regprocedure) <> 0 THEN
        RAISE EXCEPTION 'Autoverificación 015: la consulta del estudiante recibe parámetros.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conrelid = 'public.grupos_deportivos_horarios'::pg_catalog.regclass
          AND contype = 'f'
          AND (confdeltype <> 'r' OR confupdtype <> 'r')
    ) THEN
        RAISE EXCEPTION 'Autoverificación 015: una clave foránea de franjas no es RESTRICT.';
    END IF;

    -- El índice nuevo cubre la clave foránea compuesta de 014, en su orden.
    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_index x
        JOIN pg_catalog.pg_constraint c
          ON c.conname = 'inscripciones_deportivas_grupo_deporte_fk'
         AND c.conrelid = x.indrelid
        WHERE x.indrelid = 'public.inscripciones_deportivas'::pg_catalog.regclass
          AND (x.indkey::SMALLINT[])[0:1] = c.conkey
    ) THEN
        RAISE EXCEPTION 'Autoverificación 015: ningún índice cubre la clave foránea compuesta (grupo_id, deporte_id).';
    END IF;

    RAISE NOTICE
        'Migración 015: % grupo(s) deportivo(s) sin horario; deberán recibir franjas antes de aceptar inscripciones nuevas.',
        (SELECT pg_catalog.count(*) FROM public.grupos_deportivos);
END $$;
