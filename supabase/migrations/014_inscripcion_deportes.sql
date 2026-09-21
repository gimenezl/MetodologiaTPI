-- ============================================================
-- EDUCAR PARA TRANSFORMAR — Inscripción a deportes (EPT-11)
-- ============================================================
-- Migración aditiva. No modifica ni renumera 001 a 013.
--
-- Cubre EPT-32 (modelo de deportes y grupos), EPT-33 (corrección de las
-- escrituras de inscripciones antes de exponer el flujo del cliente) y EPT-35
-- (máximo de dos deportes activos en la base, seguro ante concurrencia).
--
-- ============================================================
-- POR QUÉ UN CATÁLOGO DEPORTIVO PROPIO Y NO `public.actividades`
-- ============================================================
-- `public.actividades` (001) reúne materias, deportes y talleres. Sus filas
-- DEPORTE no representan un deporte, sino una oferta con cupo y un nivel
-- opcional: son, en la práctica, grupos sin profesor. Usarlas como catálogo
-- tendría tres consecuencias inaceptables para las reglas de esta historia:
--
--   1. La identidad del deporte decide la regla «dos deportes distintos como
--      máximo» y «no dos grupos del mismo deporte». En producción hay 22
--      actividades con 7 grupos duplicados por tipo, nivel y nombre
--      normalizado (docs/evidence/RECUPERACION-SUPABASE-PRODUCCION.md). Con dos
--      filas «Fútbol», un alumno podría quedar en dos grupos del mismo deporte.
--      Equiparar esas filas por nombre sería una conversión sin prueba.
--   2. Imponer unicidad sobre las filas DEPORTE abortaría la migración en
--      producción por esos mismos duplicados, y fusionarlas destruiría datos.
--   3. `actividades` tiene contrato propio verificado por 011 y 012 (dos
--      políticas, UPDATE solo de `cupo_maximo`); cambiarlo arriesga materias.
--
-- Por eso se crea `public.deportes`, un catálogo mínimo con identidad
-- normalizada única. Las filas DEPORTE de `actividades` y sus inscripciones
-- quedan como HISTÓRICO: no se convierten, no se fusionan y no se borran.
--
-- ============================================================
-- MODELO
-- ============================================================
--   1. `public.deportes`: catálogo con nombre único normalizado y baja lógica.
--      Se siembran con identificador fijo los seis deportes que la migración
--      001 versiona como DEPORTE. No se deriva nada de las filas existentes.
--
--   2. `public.grupos_deportivos`: la oferta concreta. Relaciona deporte, nivel
--      educativo, cupo y un profesor responsable con rol real DOCENTE. Es la
--      entidad a la que EPT-12/EPT-57 asociarán horarios.
--
--   3. `public.inscripciones_deportivas`: la inscripción de un alumno a un
--      grupo. Cada inscripción ACTIVA ocupa exactamente una plaza del cupo. La
--      baja es lógica; volver a inscribirse crea una fila nueva.
--
-- La ocupación NO se guarda: se cuenta siempre sobre las inscripciones ACTIVAS
-- bajo el bloqueo de la fila del grupo. Un contador persistido podría
-- desincronizarse; el conteo es la única fuente de verdad, así que una baja no
-- puede liberar una plaza dos veces ni un reintento puede ocupar dos.
--
-- ============================================================
-- INVARIANTES Y CÓMO SE GARANTIZAN
-- ============================================================
-- | Invariante                                          | Garantía                         |
-- |-----------------------------------------------------|----------------------------------|
-- | Nombre de deporte único normalizado                 | índice único                     |
-- | Grupo único por deporte, nivel y nombre             | índice único                     |
-- | Profesor responsable con rol real DOCENTE           | trigger BEFORE + FOR SHARE       |
-- | Deporte y nivel activos al crear un grupo           | trigger BEFORE + FOR SHARE       |
-- | Cupo entre 1 y 100 y nunca menor que la ocupación   | CHECK + trigger con fila bloqueada|
-- | Deporte de la inscripción = deporte del grupo       | FK compuesta (grupo, deporte)    |
-- | Un solo grupo activo por alumno y deporte           | índice único parcial             |
-- | Mismo grupo no duplicado                            | trigger + índice único parcial   |
-- | Como máximo dos deportes activos por alumno         | trigger con alumno bloqueado     |
-- | Nunca más inscripciones activas que el cupo         | trigger con grupo bloqueado      |
-- | Nivel del grupo = nivel derivado del alumno         | trigger (matrícula vigente)      |
-- | Solo un alumno ACTIVO se inscribe                   | trigger con alumno bloqueado     |
-- | El alumno es el de la sesión                        | RPC deriva de auth.uid()         |
-- | Solo ESTUDIANTE se inscribe o cancela               | RPC + rol derivado en la base    |
-- | Solo DIRECTOR crea grupos                           | RPC + es_director()              |
-- | Única transición ACTIVA → CANCELADA                 | trigger BEFORE                   |
-- | Historial conservado, sin borrado físico            | sin DELETE, FK RESTRICT          |
-- | Sin escrituras deportivas por la vía legada         | trigger sobre `inscripciones`    |
--
-- ============================================================
-- ORDEN DE BLOQUEOS
-- ============================================================
--     alumnos  →  grupos_deportivos  →  deportes  →  inscripciones_deportivas
--
-- Alta: el trigger toma `alumnos FOR NO KEY UPDATE` (serializa las altas del
-- mismo alumno y se ordena con las operaciones académicas de 008/009, que
-- también empiezan por `alumnos FOR UPDATE`), luego `grupos_deportivos FOR NO
-- KEY UPDATE` (serializa las altas del mismo grupo y el cambio de cupo) y
-- `deportes FOR SHARE`. Baja: la fila de la inscripción queda bloqueada por el
-- propio UPDATE; el trigger toma luego alumno y grupo en el mismo orden. Un
-- cambio de cupo solo bloquea el grupo. Ninguna operación sube en sentido
-- contrario, de modo que no hay ciclos.
--
-- `FOR NO KEY UPDATE` y no `FOR UPDATE`: no entra en conflicto con el `FOR KEY
-- SHARE` que toman las claves foráneas de otras tablas hacia esas filas.
--
-- ============================================================
-- CÓDIGOS SQLSTATE PROPIOS
-- ============================================================
-- Bloque nuevo P556x–P558x, sin colisión con 006–013.
--   P5505  se requiere una identidad autenticada              (reutilizado)
--   42501  el rol de la sesión no está autorizado             (reutilizado)
--   23505  grupo duplicado o inscripción activa duplicada     (índice único)
--   P5560  el deporte no existe
--   P5561  el deporte está inactivo
--   P5562  el nivel educativo no existe
--   P5563  el nivel educativo está inactivo
--   P5564  el profesor no existe
--   P5565  el perfil elegido no tiene el rol DOCENTE
--   P5566  el cupo no es válido
--   P5567  el nombre del grupo no es válido
--   P5568  el grupo no existe
--   P5569  el grupo está inactivo
--   P5570  la sesión no corresponde a un alumno
--   P5571  el alumno no está ACTIVO
--   P5572  el alumno no tiene un curso vigente
--   P5573  el grupo no corresponde al nivel del alumno
--   P5574  el grupo no tiene cupo disponible
--   P5575  el alumno ya está inscripto en ese grupo
--   P5576  el alumno ya está inscripto en otro grupo del mismo deporte
--   P5577  el alumno ya tiene dos deportes activos
--   P5578  la inscripción no existe o no pertenece al alumno de la sesión
--   P5579  la inscripción ya está cancelada
--   P5580  la operación alteraría la identidad o la transición es inválida
--   P5581  el cupo quedaría por debajo de las inscripciones activas
--   P5582  las inscripciones deportivas legadas son de solo lectura
-- ============================================================


-- ================================================================
-- 1. PRECONDICIONES Y CONTEOS DE PRESERVACIÓN
-- ================================================================
DO $$
BEGIN
    IF pg_catalog.to_regclass('public.alumnos') IS NULL
       OR pg_catalog.to_regclass('public.matriculas') IS NULL
       OR pg_catalog.to_regclass('public.cursos') IS NULL
       OR pg_catalog.to_regclass('public.niveles') IS NULL
       OR pg_catalog.to_regclass('public.perfiles') IS NULL
       OR pg_catalog.to_regclass('public.roles') IS NULL
       OR pg_catalog.to_regclass('public.actividades') IS NULL
       OR pg_catalog.to_regclass('public.inscripciones') IS NULL
       OR pg_catalog.to_regclass('public.inscripciones_servicios') IS NULL
    THEN
        RAISE EXCEPTION
            'Migración 014: faltan tablas base; la base no corresponde a 001–013.';
    END IF;

    IF pg_catalog.to_regprocedure('app_private.perfil_actual()') IS NULL
       OR pg_catalog.to_regprocedure('app_private.es_director()') IS NULL
       OR pg_catalog.to_regprocedure('app_private.rol_actual()') IS NULL
       OR pg_catalog.to_regprocedure('app_private.texto_servicio_valido(text,integer)') IS NULL
       OR pg_catalog.to_regprocedure('public.es_director_actual()') IS NULL
    THEN
        RAISE EXCEPTION
            'Migración 014: faltan las funciones de identidad de 003–013; la base no corresponde a 001–013.';
    END IF;

    IF pg_catalog.to_regclass('public.deportes') IS NOT NULL
       OR pg_catalog.to_regclass('public.grupos_deportivos') IS NOT NULL
       OR pg_catalog.to_regclass('public.inscripciones_deportivas') IS NOT NULL
    THEN
        RAISE EXCEPTION
            'Migración 014: ya existen objetos deportivos; revisá el estado de la base antes de continuar.';
    END IF;
END $$;

CREATE TEMPORARY TABLE ept_014_conteos_iniciales (
    relacion TEXT PRIMARY KEY,
    cantidad BIGINT NOT NULL,
    huella   TEXT
) ON COMMIT DROP;

INSERT INTO ept_014_conteos_iniciales (relacion, cantidad, huella)
VALUES
    ('inscripciones',
        (SELECT pg_catalog.count(*) FROM public.inscripciones),
        (SELECT pg_catalog.md5(COALESCE(pg_catalog.string_agg(
             pg_catalog.concat_ws('|', id, estudiante_id, actividad_id, estado, fecha_inscripcion),
             ';' ORDER BY id), ''))
         FROM public.inscripciones)),
    ('actividades',
        (SELECT pg_catalog.count(*) FROM public.actividades),
        (SELECT pg_catalog.md5(COALESCE(pg_catalog.string_agg(
             pg_catalog.concat_ws('|', id, nombre, tipo, cupo_maximo, nivel_id, activo),
             ';' ORDER BY id), ''))
         FROM public.actividades)),
    ('alumnos', (SELECT pg_catalog.count(*) FROM public.alumnos), NULL),
    ('matriculas', (SELECT pg_catalog.count(*) FROM public.matriculas), NULL),
    ('perfiles', (SELECT pg_catalog.count(*) FROM public.perfiles), NULL),
    ('inscripciones_servicios',
        (SELECT pg_catalog.count(*) FROM public.inscripciones_servicios), NULL);


-- ================================================================
-- 2. CATÁLOGO DE ESTADOS
-- ================================================================
-- Tipo propio y no el de 013: son dominios distintos y cada uno debe poder
-- evolucionar sin arrastrar al otro.
CREATE TYPE public.estado_inscripcion_deportiva AS ENUM ('ACTIVA', 'CANCELADA');


-- ================================================================
-- 3. NIVEL DERIVADO DEL ALUMNO
-- ================================================================
-- El nivel de un alumno NUNCA viene del navegador: se deriva de su matrícula
-- vigente → curso → nivel (008). NULL significa «sin curso vigente».
CREATE OR REPLACE FUNCTION app_private.nivel_alumno(p_alumno_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT c.nivel_id
    FROM public.matriculas m
    JOIN public.cursos c ON c.id = m.curso_id
    WHERE m.alumno_id = p_alumno_id
      AND m.fecha_cierre IS NULL
    LIMIT 1;
$$;

-- Solo la usan otras funciones privilegiadas, que corren como propietario.
REVOKE ALL ON FUNCTION app_private.nivel_alumno(UUID)
    FROM PUBLIC, anon, authenticated, service_role;

-- Nivel de la sesión actual. No recibe parámetros: quien llama no puede elegir
-- qué persona se inspecciona. Lo usa la política de lectura de grupos.
CREATE OR REPLACE FUNCTION app_private.nivel_actual()
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT app_private.nivel_alumno(app_private.perfil_actual());
$$;

REVOKE ALL ON FUNCTION app_private.nivel_actual()
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.nivel_actual() TO authenticated;


-- ================================================================
-- 4. CATÁLOGO DE DEPORTES
-- ================================================================
CREATE TABLE public.deportes (
    id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
    nombre VARCHAR(100) NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    fecha_actualizacion TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    -- Mismo contrato de texto que el catálogo de 013: recortado y no vacío.
    CONSTRAINT deportes_nombre_valido
        CHECK (app_private.texto_servicio_valido(nombre, 100) IS TRUE)
);

COMMENT ON TABLE public.deportes IS
    'Catálogo de deportes con identidad normalizada única. Las filas DEPORTE de public.actividades son histórico y no se convierten a este catálogo.';

-- Autoridad de la identidad del deporte: sobre ella descansan las reglas «dos
-- deportes distintos» y «un solo grupo por deporte».
CREATE UNIQUE INDEX idx_deportes_nombre_normalizado
    ON public.deportes (pg_catalog.upper(pg_catalog.btrim(nombre)));

-- ----------------------------------------------------------------
-- Semilla reproducible
-- ----------------------------------------------------------------
-- Son exactamente los seis nombres que 001 versiona con tipo DEPORTE. Se
-- escriben como literales con identificador fijo: no se leen de
-- `actividades`, así que ningún duplicado ni ninguna fila de producción se
-- equipara con un deporte del catálogo. Un catálogo sin grupos es inerte;
-- ampliarlo o corregirlo es administración de deportes (EPT-61).
INSERT INTO public.deportes (id, nombre) VALUES
    ('e0000000-0000-4000-8000-000000000101', 'Fútbol'),
    ('e0000000-0000-4000-8000-000000000102', 'Natación'),
    ('e0000000-0000-4000-8000-000000000103', 'Atletismo'),
    ('e0000000-0000-4000-8000-000000000104', 'Artes Marciales'),
    ('e0000000-0000-4000-8000-000000000105', 'Vóley'),
    ('e0000000-0000-4000-8000-000000000106', 'Básquet');


-- ================================================================
-- 5. GRUPOS DEPORTIVOS
-- ================================================================
CREATE TABLE public.grupos_deportivos (
    id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
    -- ON DELETE RESTRICT en las tres referencias: el historial nunca desaparece
    -- por el borrado de una fila relacionada.
    deporte_id UUID NOT NULL
        REFERENCES public.deportes(id) ON DELETE RESTRICT,
    nivel_id INTEGER NOT NULL
        REFERENCES public.niveles(id) ON DELETE RESTRICT,
    nombre VARCHAR(100) NOT NULL,
    cupo INTEGER NOT NULL,
    profesor_id UUID NOT NULL
        REFERENCES public.perfiles(id) ON DELETE RESTRICT,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    fecha_actualizacion TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT grupos_deportivos_nombre_valido
        CHECK (app_private.texto_servicio_valido(nombre, 100) IS TRUE),
    -- Cada inscripción activa ocupa una plaza: el cupo es un número de plazas.
    CONSTRAINT grupos_deportivos_cupo_valido
        CHECK (cupo BETWEEN 1 AND 100),
    -- Destino de la clave foránea compuesta de las inscripciones. Garantiza
    -- estructuralmente que el deporte de una inscripción es el de su grupo.
    CONSTRAINT grupos_deportivos_id_deporte_unico UNIQUE (id, deporte_id)
);

COMMENT ON TABLE public.grupos_deportivos IS
    'Oferta deportiva concreta: deporte, nivel, cupo en plazas y profesor responsable DOCENTE. La ocupación se cuenta sobre las inscripciones ACTIVAS; no se persiste.';

COMMENT ON COLUMN public.grupos_deportivos.cupo IS
    'Cantidad de plazas. Cada inscripción ACTIVA ocupa una; la cancelación la libera.';

-- Un grupo por deporte, nivel y nombre normalizado. Comienza por deporte_id,
-- así que también indexa esa clave foránea.
CREATE UNIQUE INDEX idx_grupos_deportivos_identidad
    ON public.grupos_deportivos (deporte_id, nivel_id, pg_catalog.upper(pg_catalog.btrim(nombre)));

-- Listado del alumno (grupos activos de su nivel) e índice de la FK a niveles.
CREATE INDEX idx_grupos_deportivos_nivel
    ON public.grupos_deportivos (nivel_id, activo);

-- Índice de la FK hacia perfiles.
CREATE INDEX idx_grupos_deportivos_profesor
    ON public.grupos_deportivos (profesor_id);


-- ================================================================
-- 6. INSCRIPCIONES DEPORTIVAS
-- ================================================================
CREATE TABLE public.inscripciones_deportivas (
    id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
    alumno_id UUID NOT NULL
        REFERENCES public.alumnos(perfil_id) ON DELETE RESTRICT,
    grupo_id UUID NOT NULL,
    -- Copia controlada del deporte del grupo. La completa el trigger y la FK
    -- compuesta impide que difiera del grupo. Existe para que el índice único
    -- parcial pueda expresar «un solo grupo activo por deporte».
    deporte_id UUID NOT NULL
        REFERENCES public.deportes(id) ON DELETE RESTRICT,
    estado public.estado_inscripcion_deportiva NOT NULL DEFAULT 'ACTIVA',
    fecha_inscripcion TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    fecha_cancelacion TIMESTAMP WITH TIME ZONE,
    CONSTRAINT inscripciones_deportivas_grupo_deporte_fk
        FOREIGN KEY (grupo_id, deporte_id)
        REFERENCES public.grupos_deportivos (id, deporte_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT inscripciones_deportivas_cancelacion_coherente
        CHECK ((estado = 'CANCELADA') = (fecha_cancelacion IS NOT NULL)),
    CONSTRAINT inscripciones_deportivas_cancelacion_posterior
        CHECK (fecha_cancelacion IS NULL OR fecha_cancelacion >= fecha_inscripcion)
);

COMMENT ON TABLE public.inscripciones_deportivas IS
    'Inscripción de un alumno a un grupo deportivo. Cada fila ACTIVA ocupa una plaza. La baja es lógica y el reingreso crea una fila nueva. Nunca se elimina.';

-- Autoridad dura de «un solo grupo activo por alumno y deporte», que implica
-- también «no duplicar el mismo grupo». Al ser PARCIAL, las filas canceladas
-- quedan fuera y el reingreso no colisiona con el historial.
CREATE UNIQUE INDEX idx_inscripciones_deportivas_una_por_deporte
    ON public.inscripciones_deportivas (alumno_id, deporte_id)
    WHERE estado = 'ACTIVA';

-- Conteo de ocupación por grupo e índice de la FK compuesta.
CREATE INDEX idx_inscripciones_deportivas_grupo
    ON public.inscripciones_deportivas (grupo_id, estado);

-- Historial propio del alumno e índice de la FK hacia alumnos.
CREATE INDEX idx_inscripciones_deportivas_alumno
    ON public.inscripciones_deportivas (alumno_id, fecha_inscripcion DESC);

-- Índice de la FK simple hacia deportes.
CREATE INDEX idx_inscripciones_deportivas_deporte
    ON public.inscripciones_deportivas (deporte_id);


-- ================================================================
-- 7. INVARIANTES DE GRUPO
-- ================================================================
CREATE OR REPLACE FUNCTION app_private.validar_grupo_deportivo()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_deporte_activo BOOLEAN;
    v_nivel_activo   BOOLEAN;
    v_rol_id         INTEGER;
    v_rol_nombre     TEXT;
    v_ocupados       BIGINT;
BEGIN
    IF NOT app_private.texto_servicio_valido(NEW.nombre, 100) THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5567',
            MESSAGE = 'El nombre del grupo debe tener entre 1 y 100 caracteres, sin espacios al principio ni al final.';
    END IF;

    IF NEW.cupo IS NULL OR NEW.cupo < 1 OR NEW.cupo > 100 THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5566',
            MESSAGE = 'El cupo debe ser un número entero entre 1 y 100.';
    END IF;

    IF TG_OP = 'UPDATE' THEN
        -- Deporte y nivel son la identidad de la oferta. Si ya hay
        -- inscripciones, cambiarlos reescribiría el historial.
        IF (NEW.deporte_id IS DISTINCT FROM OLD.deporte_id
            OR NEW.nivel_id IS DISTINCT FROM OLD.nivel_id)
           AND EXISTS (
               SELECT 1 FROM public.inscripciones_deportivas i
               WHERE i.grupo_id = OLD.id
           ) THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P5580',
                MESSAGE = 'Un grupo con inscripciones no puede cambiar de deporte ni de nivel.';
        END IF;

        -- La fila del grupo ya está bloqueada por este UPDATE, y toda alta
        -- toma el mismo bloqueo antes de contar: el conteo es exacto.
        IF NEW.cupo < OLD.cupo THEN
            SELECT pg_catalog.count(*) INTO v_ocupados
            FROM public.inscripciones_deportivas i
            WHERE i.grupo_id = OLD.id AND i.estado = 'ACTIVA';

            IF v_ocupados > NEW.cupo THEN
                RAISE EXCEPTION USING
                    ERRCODE = 'P5581',
                    MESSAGE = pg_catalog.format(
                        'El cupo no puede ser menor que las %s inscripciones activas del grupo.',
                        v_ocupados);
            END IF;
        END IF;

        NEW.fecha_creacion := OLD.fecha_creacion;
        NEW.fecha_actualizacion := NOW();
    END IF;

    -- Deporte y nivel se validan al crear, al cambiarlos o al reactivar el grupo.
    IF TG_OP = 'INSERT'
       OR NEW.deporte_id IS DISTINCT FROM OLD.deporte_id
       OR (NEW.activo AND NOT OLD.activo) THEN
        SELECT d.activo INTO v_deporte_activo
        FROM public.deportes d
        WHERE d.id = NEW.deporte_id
        FOR SHARE;

        IF NOT FOUND THEN
            RAISE EXCEPTION USING ERRCODE = 'P5560', MESSAGE = 'El deporte solicitado no existe.';
        END IF;
        IF NOT v_deporte_activo THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P5561',
                MESSAGE = 'El deporte está inactivo y no admite grupos nuevos.';
        END IF;
    END IF;

    IF TG_OP = 'INSERT'
       OR NEW.nivel_id IS DISTINCT FROM OLD.nivel_id
       OR (NEW.activo AND NOT OLD.activo) THEN
        SELECT n.activo INTO v_nivel_activo
        FROM public.niveles n
        WHERE n.id = NEW.nivel_id
        FOR SHARE;

        IF NOT FOUND THEN
            RAISE EXCEPTION USING ERRCODE = 'P5562', MESSAGE = 'El nivel educativo solicitado no existe.';
        END IF;
        IF NOT v_nivel_activo THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P5563',
                MESSAGE = 'El nivel educativo está inactivo y no admite grupos nuevos.';
        END IF;
    END IF;

    -- El rol se valida cuando el profesor se elige o cambia. Si más adelante el
    -- perfil deja de ser DOCENTE, el grupo histórico se conserva (igual que 012).
    IF TG_OP = 'INSERT' OR NEW.profesor_id IS DISTINCT FROM OLD.profesor_id THEN
        SELECT p.rol_id INTO v_rol_id
        FROM public.perfiles p
        WHERE p.id = NEW.profesor_id
        FOR SHARE;

        IF NOT FOUND THEN
            RAISE EXCEPTION USING ERRCODE = 'P5564', MESSAGE = 'El profesor solicitado no existe.';
        END IF;

        SELECT r.nombre INTO v_rol_nombre
        FROM public.roles r
        WHERE r.id = v_rol_id;

        IF v_rol_nombre IS DISTINCT FROM 'DOCENTE' THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P5565',
                MESSAGE = 'La persona seleccionada no tiene el rol DOCENTE.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.validar_grupo_deportivo()
    FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER validar_grupo_deportivo_antes_de_escribir
    BEFORE INSERT OR UPDATE ON public.grupos_deportivos
    FOR EACH ROW
    EXECUTE FUNCTION app_private.validar_grupo_deportivo();


-- ================================================================
-- 8. INVARIANTES DE INSCRIPCIÓN
-- ================================================================
-- Autoridad única de las reglas de fila, también ante concurrencia y también
-- si alguien escribiera la tabla por fuera de las RPC.
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

        -- Volver a inscribirse es una fila nueva, nunca la reactivación de una
        -- cancelada: así se conservan todos los ciclos y se revalida el cupo.
        IF OLD.estado = 'CANCELADA' AND NEW.estado = 'ACTIVA' THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P5580',
                MESSAGE = 'Una inscripción cancelada no se reactiva. Volvé a inscribirte para registrar un ciclo nuevo.';
        END IF;

        IF NEW.estado = 'CANCELADA' THEN
            -- Mismo orden que el alta: alumno y luego grupo. Así una baja y un
            -- alta simultáneas del mismo grupo se serializan y la plaza
            -- liberada se ve de forma determinista.
            PERFORM 1 FROM public.alumnos a
            WHERE a.perfil_id = OLD.alumno_id
            FOR NO KEY UPDATE;

            PERFORM 1 FROM public.grupos_deportivos g
            WHERE g.id = OLD.grupo_id
            FOR NO KEY UPDATE;

            -- La fecha de baja la sella la base, no quien llama.
            NEW.fecha_cancelacion := NOW();
        END IF;

        RETURN NEW;
    END IF;

    -- A partir de acá, TG_OP = 'INSERT'. Una inscripción nueva nace ACTIVA.
    IF NEW.estado IS DISTINCT FROM 'ACTIVA' OR NEW.fecha_cancelacion IS NOT NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5580',
            MESSAGE = 'Una inscripción nueva solo puede crearse en estado ACTIVA.';
    END IF;

    -- 1) Alumno: se bloquea primero. Serializa todas las altas y bajas del
    --    mismo alumno, que es lo que hace exacto el límite de dos deportes.
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

    -- El nivel se deriva de la matrícula vigente. Los cambios de curso toman
    -- el mismo bloqueo de `alumnos`, así que no pueden cruzarse con esta alta.
    v_nivel_alumno := app_private.nivel_alumno(NEW.alumno_id);
    IF v_nivel_alumno IS NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5572',
            MESSAGE = 'El alumno no tiene un curso vigente del que derivar su nivel.';
    END IF;

    -- 2) Grupo: se bloquea después. Serializa las altas del mismo grupo y el
    --    cambio de cupo, que es lo que hace exacto el conteo de plazas.
    SELECT * INTO v_grupo
    FROM public.grupos_deportivos g
    WHERE g.id = NEW.grupo_id
    FOR NO KEY UPDATE;

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

    -- El deporte de la inscripción es SIEMPRE el del grupo.
    NEW.deporte_id := v_grupo.deporte_id;

    IF v_grupo.nivel_id <> v_nivel_alumno THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5573',
            MESSAGE = 'El grupo no corresponde a tu nivel educativo.';
    END IF;

    -- Duplicados con mensaje preciso. El índice único parcial es la garantía
    -- de respaldo; con el alumno bloqueado estas consultas ya son exactas.
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

    -- Límite de dos deportes distintos. El índice parcial garantiza una fila
    -- activa por deporte, así que contar filas es contar deportes.
    SELECT pg_catalog.count(*) INTO v_activas
    FROM public.inscripciones_deportivas i
    WHERE i.alumno_id = NEW.alumno_id
      AND i.estado = 'ACTIVA';

    IF v_activas >= 2 THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5577',
            MESSAGE = 'Ya tenés dos deportes activos, que es el máximo permitido. Cancelá uno para inscribirte en otro.';
    END IF;

    -- Plazas. La fila del grupo está bloqueada: nadie más puede contar ni
    -- ocupar la última plaza hasta que esta transacción termine.
    SELECT pg_catalog.count(*) INTO v_ocupados
    FROM public.inscripciones_deportivas i
    WHERE i.grupo_id = NEW.grupo_id
      AND i.estado = 'ACTIVA';

    IF v_ocupados >= v_grupo.cupo THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5574',
            MESSAGE = 'El grupo no tiene plazas disponibles.';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.validar_inscripcion_deportiva()
    FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER validar_inscripcion_deportiva_antes_de_escribir
    BEFORE INSERT OR UPDATE ON public.inscripciones_deportivas
    FOR EACH ROW
    EXECUTE FUNCTION app_private.validar_inscripcion_deportiva();

-- Un deporte con grupos no puede cambiar de nombre normalizado: los grupos y
-- las inscripciones quedarían atribuidos a otro deporte.
CREATE OR REPLACE FUNCTION app_private.proteger_identidad_deporte()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF pg_catalog.upper(pg_catalog.btrim(NEW.nombre))
           IS DISTINCT FROM pg_catalog.upper(pg_catalog.btrim(OLD.nombre))
       AND EXISTS (
           SELECT 1 FROM public.grupos_deportivos g WHERE g.deporte_id = OLD.id
       ) THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5580',
            MESSAGE = 'Un deporte con grupos no puede cambiar de nombre.';
    END IF;

    NEW.fecha_creacion := OLD.fecha_creacion;
    NEW.fecha_actualizacion := NOW();
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.proteger_identidad_deporte()
    FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER proteger_identidad_deporte_antes_de_actualizar
    BEFORE UPDATE ON public.deportes
    FOR EACH ROW
    EXECUTE FUNCTION app_private.proteger_identidad_deporte();


-- ================================================================
-- 9. EPT-33: LA VÍA LEGADA NO ACEPTA ESCRITURAS DEPORTIVAS
-- ================================================================
-- `public.inscripciones` (001/011) sigue siendo la inscripción de talleres y
-- materias. Para DEPORTE, sus reglas son incompatibles con esta historia: sin
-- límite de dos, cupo verificado sin bloqueo, borrado físico y altas en nombre
-- de terceros. En lugar de reescribir sus políticas —que sostienen el flujo de
-- TALLER—, un trigger rechaza cualquier alta, cambio o borrado que involucre
-- una actividad DEPORTE. Las filas DEPORTE existentes quedan como histórico de
-- solo lectura: siguen visibles, no se convierten ni se borran.
--
-- El trigger aplica a todo rol, incluido el propietario: el histórico no se
-- corrige por esta vía.
CREATE OR REPLACE FUNCTION app_private.bloquear_inscripcion_deportiva_legada()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') AND EXISTS (
        SELECT 1 FROM public.actividades a
        WHERE a.id = OLD.actividad_id AND a.tipo = 'DEPORTE'
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5582',
            MESSAGE = 'Las inscripciones deportivas anteriores son históricas y de solo lectura.';
    END IF;

    IF TG_OP IN ('INSERT', 'UPDATE') AND EXISTS (
        SELECT 1 FROM public.actividades a
        WHERE a.id = NEW.actividad_id AND a.tipo = 'DEPORTE'
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5582',
            MESSAGE = 'La inscripción a deportes se realiza por grupo deportivo desde la sección Deportes.';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.bloquear_inscripcion_deportiva_legada()
    FROM PUBLIC, anon, authenticated, service_role;

-- El nombre ordena este trigger antes que `trigger_verificar_cupo` (001): el
-- rechazo por DEPORTE no depende de que haya cupo legado.
CREATE TRIGGER bloquear_inscripcion_deportiva_legada
    BEFORE INSERT OR UPDATE OR DELETE ON public.inscripciones
    FOR EACH ROW
    EXECUTE FUNCTION app_private.bloquear_inscripcion_deportiva_legada();


-- ================================================================
-- 10. VISTA DE LECTURA
-- ================================================================
-- `security_invoker = true`: respeta RLS y privilegios de quien consulta. El
-- estudiante ve solo sus filas; el director, todas.
CREATE VIEW public.inscripciones_deportivas_detalle
WITH (security_invoker = true) AS
SELECT
    i.id,
    i.alumno_id,
    p.nombre     AS alumno_nombre,
    p.apellido   AS alumno_apellido,
    p.legajo_nro,
    i.grupo_id,
    g.nombre     AS grupo_nombre,
    i.deporte_id,
    d.nombre     AS deporte_nombre,
    g.nivel_id,
    n.nombre     AS nivel_nombre,
    i.estado,
    i.fecha_inscripcion,
    i.fecha_cancelacion
FROM public.inscripciones_deportivas i
JOIN public.perfiles p ON p.id = i.alumno_id
JOIN public.grupos_deportivos g ON g.id = i.grupo_id
JOIN public.deportes d ON d.id = i.deporte_id
JOIN public.niveles n ON n.id = g.nivel_id;

COMMENT ON VIEW public.inscripciones_deportivas_detalle IS
    'Inscripciones deportivas con alumno, legajo, grupo, deporte y nivel resueltos, incluidas las canceladas. Respeta RLS mediante security_invoker.';


-- ================================================================
-- 11. OPERACIONES PRIVILEGIADAS
-- ================================================================
-- Viven en `app_private`, que la Data API no expone. Las del alumno derivan su
-- identidad de `auth.uid()` y no reciben alumno, perfil, rol ni nivel.

-- ----------------------------------------------------------------
-- Listado de grupos con disponibilidad
-- ----------------------------------------------------------------
-- SECURITY DEFINER porque la ocupación cuenta inscripciones de TODOS los
-- alumnos, que RLS no le muestra a un estudiante. Solo devuelve números
-- agregados, nunca filas ajenas. El alcance lo decide la base:
--   * DIRECTOR: todos los grupos, activos e inactivos.
--   * ESTUDIANTE: solo grupos activos, de deporte activo y de SU nivel derivado.
--   * cualquier otro rol: rechazo.
-- La disponibilidad es informativa; el alta la vuelve a verificar con el grupo
-- bloqueado, así que nunca se promete una plaza que otro ya ocupó.
CREATE OR REPLACE FUNCTION app_private.listar_grupos_deportivos()
RETURNS TABLE (
    grupo_id              UUID,
    grupo_nombre          TEXT,
    deporte_id            UUID,
    deporte_nombre        TEXT,
    deporte_activo        BOOLEAN,
    nivel_id              INTEGER,
    nivel_nombre          TEXT,
    profesor_id           UUID,
    profesor_nombre       TEXT,
    profesor_apellido     TEXT,
    cupo                  INTEGER,
    ocupados              INTEGER,
    disponibles           INTEGER,
    activo                BOOLEAN,
    inscripcion_propia_id UUID
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
    v_rol       TEXT;
    v_perfil_id UUID;
    v_nivel_id  INTEGER;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    v_rol := app_private.rol_actual();
    v_perfil_id := app_private.perfil_actual();

    IF v_rol = 'DIRECTOR' THEN
        RETURN QUERY
        SELECT g.id, g.nombre::TEXT, d.id, d.nombre::TEXT, d.activo,
               n.id, n.nombre::TEXT,
               g.profesor_id, p.nombre::TEXT, p.apellido::TEXT,
               g.cupo, o.ocupados, GREATEST(g.cupo - o.ocupados, 0), g.activo,
               NULL::UUID
        FROM public.grupos_deportivos g
        JOIN public.deportes d ON d.id = g.deporte_id
        JOIN public.niveles n ON n.id = g.nivel_id
        JOIN public.perfiles p ON p.id = g.profesor_id
        CROSS JOIN LATERAL (
            SELECT pg_catalog.count(*)::INTEGER AS ocupados
            FROM public.inscripciones_deportivas i
            WHERE i.grupo_id = g.id AND i.estado = 'ACTIVA'
        ) o
        ORDER BY d.nombre, n.orden NULLS LAST, g.nombre;
        RETURN;
    END IF;

    IF v_rol = 'ESTUDIANTE' AND v_perfil_id IS NOT NULL THEN
        v_nivel_id := app_private.nivel_alumno(v_perfil_id);

        -- Sin curso vigente no hay nivel del que derivar grupos elegibles.
        IF v_nivel_id IS NULL THEN
            RETURN;
        END IF;

        -- El profesor se identifica por nombre; su identificador interno no
        -- se expone al estudiante.
        RETURN QUERY
        SELECT g.id, g.nombre::TEXT, d.id, d.nombre::TEXT, d.activo,
               n.id, n.nombre::TEXT,
               NULL::UUID, p.nombre::TEXT, p.apellido::TEXT,
               g.cupo, o.ocupados, GREATEST(g.cupo - o.ocupados, 0), g.activo,
               (SELECT i.id FROM public.inscripciones_deportivas i
                WHERE i.grupo_id = g.id
                  AND i.alumno_id = v_perfil_id
                  AND i.estado = 'ACTIVA')
        FROM public.grupos_deportivos g
        JOIN public.deportes d ON d.id = g.deporte_id
        JOIN public.niveles n ON n.id = g.nivel_id
        JOIN public.perfiles p ON p.id = g.profesor_id
        CROSS JOIN LATERAL (
            SELECT pg_catalog.count(*)::INTEGER AS ocupados
            FROM public.inscripciones_deportivas i
            WHERE i.grupo_id = g.id AND i.estado = 'ACTIVA'
        ) o
        WHERE g.nivel_id = v_nivel_id
          AND g.activo
          AND d.activo
        ORDER BY d.nombre, g.nombre;
        RETURN;
    END IF;

    RAISE EXCEPTION USING
        ERRCODE = '42501',
        MESSAGE = 'Solo un estudiante o la dirección pueden consultar los grupos deportivos.';
END;
$$;

-- ----------------------------------------------------------------
-- Alta mínima de un grupo (DIRECTOR)
-- ----------------------------------------------------------------
-- Es el mínimo que exige EPT-11 para que el flujo exista. No hay edición,
-- inactivación ni borrado: la administración integral es EPT-61.
CREATE OR REPLACE FUNCTION app_private.crear_grupo_deportivo(
    p_deporte_id  UUID,
    p_nivel_id    INTEGER,
    p_nombre      TEXT,
    p_cupo        INTEGER,
    p_profesor_id UUID
)
RETURNS public.grupos_deportivos
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_grupo public.grupos_deportivos;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    IF NOT app_private.es_director() THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Solo la dirección puede crear grupos deportivos.';
    END IF;

    IF p_deporte_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5560', MESSAGE = 'El deporte solicitado no existe.';
    END IF;
    IF p_nivel_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5562', MESSAGE = 'El nivel educativo solicitado no existe.';
    END IF;
    IF p_profesor_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5564', MESSAGE = 'El profesor solicitado no existe.';
    END IF;

    -- El trigger de la sección 7 valida nombre, cupo, deporte, nivel y rol
    -- DOCENTE con las filas bloqueadas.
    INSERT INTO public.grupos_deportivos (deporte_id, nivel_id, nombre, cupo, profesor_id)
    VALUES (p_deporte_id, p_nivel_id, p_nombre, p_cupo, p_profesor_id)
    RETURNING * INTO v_grupo;

    RETURN v_grupo;
END;
$$;

-- ----------------------------------------------------------------
-- Alta y baja del alumno de la sesión
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.inscribir_en_grupo_deportivo(p_grupo_id UUID)
RETURNS public.inscripciones_deportivas
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_perfil_id   UUID;
    v_rol         TEXT;
    v_inscripcion public.inscripciones_deportivas;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    v_perfil_id := app_private.perfil_actual();
    v_rol := app_private.rol_actual();

    IF v_perfil_id IS NULL OR v_rol IS DISTINCT FROM 'ESTUDIANTE' THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Solo un estudiante puede inscribirse a un deporte.';
    END IF;

    IF p_grupo_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5568', MESSAGE = 'El grupo deportivo solicitado no existe.';
    END IF;

    -- El alumno es SIEMPRE el de la sesión. El deporte lo completa el trigger a
    -- partir del grupo; el nivel, el cupo y el límite los verifica el trigger
    -- con alumno y grupo bloqueados.
    INSERT INTO public.inscripciones_deportivas (alumno_id, grupo_id)
    VALUES (v_perfil_id, p_grupo_id)
    RETURNING * INTO v_inscripcion;

    RETURN v_inscripcion;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.cancelar_inscripcion_deportiva(p_inscripcion_id UUID)
RETURNS public.inscripciones_deportivas
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_perfil_id   UUID;
    v_rol         TEXT;
    v_estado      public.estado_inscripcion_deportiva;
    v_inscripcion public.inscripciones_deportivas;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    v_perfil_id := app_private.perfil_actual();
    v_rol := app_private.rol_actual();

    IF v_perfil_id IS NULL OR v_rol IS DISTINCT FROM 'ESTUDIANTE' THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Solo un estudiante puede cancelar su inscripción a un deporte.';
    END IF;

    -- El filtro por `alumno_id` impide cancelar la inscripción de otra persona.
    -- Una inscripción ajena responde igual que una inexistente: no se delata.
    UPDATE public.inscripciones_deportivas
    SET estado = 'CANCELADA'
    WHERE id = p_inscripcion_id
      AND alumno_id = v_perfil_id
      AND estado = 'ACTIVA'
    RETURNING * INTO v_inscripcion;

    IF v_inscripcion.id IS NULL THEN
        -- Un reintento sobre una baja propia ya confirmada se distingue de una
        -- inscripción inexistente o ajena, para que la pantalla pueda decir la
        -- verdad sin revelar filas de terceros.
        SELECT i.estado INTO v_estado
        FROM public.inscripciones_deportivas i
        WHERE i.id = p_inscripcion_id
          AND i.alumno_id = v_perfil_id;

        IF v_estado = 'CANCELADA' THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P5579',
                MESSAGE = 'La inscripción ya está cancelada.';
        END IF;

        RAISE EXCEPTION USING
            ERRCODE = 'P5578',
            MESSAGE = 'No encontramos una inscripción deportiva activa tuya para cancelar.';
    END IF;

    RETURN v_inscripcion;
END;
$$;

REVOKE ALL ON FUNCTION app_private.listar_grupos_deportivos()
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.crear_grupo_deportivo(UUID, INTEGER, TEXT, INTEGER, UUID)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.inscribir_en_grupo_deportivo(UUID)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.cancelar_inscripcion_deportiva(UUID)
    FROM PUBLIC, anon, authenticated, service_role;

-- Los envoltorios SECURITY INVOKER necesitan ejecutar la operación privada.
-- Cada una vuelve a validar auth.uid() y el rol dentro de PostgreSQL.
GRANT EXECUTE ON FUNCTION app_private.listar_grupos_deportivos() TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.crear_grupo_deportivo(UUID, INTEGER, TEXT, INTEGER, UUID)
    TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.inscribir_en_grupo_deportivo(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.cancelar_inscripcion_deportiva(UUID) TO authenticated;


-- ================================================================
-- 12. ENVOLTORIOS PÚBLICOS PARA POSTGREST
-- ================================================================
CREATE OR REPLACE FUNCTION public.listar_grupos_deportivos()
RETURNS TABLE (
    grupo_id              UUID,
    grupo_nombre          TEXT,
    deporte_id            UUID,
    deporte_nombre        TEXT,
    deporte_activo        BOOLEAN,
    nivel_id              INTEGER,
    nivel_nombre          TEXT,
    profesor_id           UUID,
    profesor_nombre       TEXT,
    profesor_apellido     TEXT,
    cupo                  INTEGER,
    ocupados              INTEGER,
    disponibles           INTEGER,
    activo                BOOLEAN,
    inscripcion_propia_id UUID
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT * FROM app_private.listar_grupos_deportivos();
$$;

CREATE OR REPLACE FUNCTION public.crear_grupo_deportivo(
    p_deporte_id  UUID,
    p_nivel_id    INTEGER,
    p_nombre      TEXT,
    p_cupo        INTEGER,
    p_profesor_id UUID
)
RETURNS public.grupos_deportivos
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT app_private.crear_grupo_deportivo(
        p_deporte_id, p_nivel_id, p_nombre, p_cupo, p_profesor_id);
$$;

CREATE OR REPLACE FUNCTION public.inscribir_en_grupo_deportivo(p_grupo_id UUID)
RETURNS public.inscripciones_deportivas
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT app_private.inscribir_en_grupo_deportivo(p_grupo_id);
$$;

CREATE OR REPLACE FUNCTION public.cancelar_inscripcion_deportiva(p_inscripcion_id UUID)
RETURNS public.inscripciones_deportivas
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT app_private.cancelar_inscripcion_deportiva(p_inscripcion_id);
$$;

-- Los privilegios por defecto de Supabase conceden EXECUTE sobre funciones
-- nuevas de `public` a anon; se parte de cero y se concede lo mínimo.
REVOKE ALL ON FUNCTION public.listar_grupos_deportivos() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crear_grupo_deportivo(UUID, INTEGER, TEXT, INTEGER, UUID)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.inscribir_en_grupo_deportivo(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancelar_inscripcion_deportiva(UUID) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.listar_grupos_deportivos() TO authenticated;
GRANT EXECUTE ON FUNCTION public.crear_grupo_deportivo(UUID, INTEGER, TEXT, INTEGER, UUID)
    TO authenticated;
GRANT EXECUTE ON FUNCTION public.inscribir_en_grupo_deportivo(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancelar_inscripcion_deportiva(UUID) TO authenticated;


-- ================================================================
-- 13. PRIVILEGIOS MÍNIMOS Y RLS
-- ================================================================
-- Se revoca todo antes de conceder, para no depender de los privilegios por
-- defecto del esquema `public` (que alcanzan también a TRUNCATE).

-- ----------------------------------------------------------------
-- Deportes: catálogo institucional sin datos personales
-- ----------------------------------------------------------------
ALTER TABLE public.deportes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.deportes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.deportes TO authenticated;

CREATE POLICY "Los deportes son visibles para las sesiones autenticadas"
    ON public.deportes
    FOR SELECT TO authenticated
    USING (TRUE);

-- ----------------------------------------------------------------
-- Grupos: el director todos; el estudiante los de su nivel y los propios
-- ----------------------------------------------------------------
-- Una sola política por tabla y comando: dos políticas permisivas se evalúan
-- las dos en cada fila (advisor `multiple_permissive_policies`). El OR explícito
-- expresa el mismo acceso con una sola evaluación.
ALTER TABLE public.grupos_deportivos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.grupos_deportivos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.grupos_deportivos TO authenticated;

-- El estudiante ve los grupos activos de su nivel derivado y, además, los
-- grupos donde tiene o tuvo una inscripción, para poder leer su historial aun
-- si después cambió de curso. La subconsulta respeta la RLS de inscripciones,
-- que no consulta grupos, así que no hay recursión.
CREATE POLICY "Grupos deportivos visibles para la dirección y para el estudiante de su nivel"
    ON public.grupos_deportivos
    FOR SELECT TO authenticated
    USING (
        (SELECT public.es_director_actual())
        OR (
            (SELECT app_private.rol_actual()) = 'ESTUDIANTE'
            AND (
                (activo AND nivel_id = (SELECT app_private.nivel_actual()))
                OR id IN (
                    SELECT i.grupo_id
                    FROM public.inscripciones_deportivas i
                    WHERE i.alumno_id = (SELECT app_private.perfil_actual())
                )
            )
        )
    );

-- ----------------------------------------------------------------
-- Inscripciones: cada alumno lo suyo; el director el listado
-- ----------------------------------------------------------------
ALTER TABLE public.inscripciones_deportivas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inscripciones_deportivas FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.inscripciones_deportivas TO authenticated;

-- El acceso propio exige además conservar el rol ESTUDIANTE, como 009 y 013.
CREATE POLICY "Inscripciones deportivas visibles para la dirección y para su alumno"
    ON public.inscripciones_deportivas
    FOR SELECT TO authenticated
    USING (
        (SELECT public.es_director_actual())
        OR (
            alumno_id = (SELECT app_private.perfil_actual())
            AND (SELECT app_private.rol_actual()) = 'ESTUDIANTE'
        )
    );

-- No se crea ninguna política INSERT, UPDATE ni DELETE en estas tres tablas.
-- DOCENTE, PADRE y PERSONAL no reciben ninguna lectura nueva: EPT-11 no les
-- asigna poderes deportivos.

REVOKE ALL ON public.inscripciones_deportivas_detalle FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.inscripciones_deportivas_detalle TO authenticated;


-- ================================================================
-- 14. AUTOVERIFICACIÓN
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
    -- Ninguna fila anterior cambia. `inscripciones` y `actividades` se comparan
    -- además por huella de contenido: el histórico DEPORTE queda intacto.
    FOREACH v_relacion IN ARRAY ARRAY[
        'inscripciones', 'actividades', 'alumnos', 'matriculas', 'perfiles',
        'inscripciones_servicios'
    ] LOOP
        SELECT cantidad, huella INTO v_antes
        FROM ept_014_conteos_iniciales WHERE relacion = v_relacion;

        EXECUTE pg_catalog.format('SELECT pg_catalog.count(*) FROM public.%I', v_relacion)
        INTO v_despues;

        IF v_despues <> v_antes.cantidad THEN
            RAISE EXCEPTION 'Autoverificación 014: % cambió de % a % filas.',
                v_relacion, v_antes.cantidad, v_despues;
        END IF;
    END LOOP;

    SELECT pg_catalog.md5(COALESCE(pg_catalog.string_agg(
               pg_catalog.concat_ws('|', id, estudiante_id, actividad_id, estado, fecha_inscripcion),
               ';' ORDER BY id), ''))
    INTO v_huella FROM public.inscripciones;
    IF v_huella <> (SELECT huella FROM ept_014_conteos_iniciales WHERE relacion = 'inscripciones') THEN
        RAISE EXCEPTION 'Autoverificación 014: cambió el contenido de public.inscripciones.';
    END IF;

    SELECT pg_catalog.md5(COALESCE(pg_catalog.string_agg(
               pg_catalog.concat_ws('|', id, nombre, tipo, cupo_maximo, nivel_id, activo),
               ';' ORDER BY id), ''))
    INTO v_huella FROM public.actividades;
    IF v_huella <> (SELECT huella FROM ept_014_conteos_iniciales WHERE relacion = 'actividades') THEN
        RAISE EXCEPTION 'Autoverificación 014: cambió el contenido de public.actividades.';
    END IF;

    IF (SELECT pg_catalog.count(*) FROM public.deportes WHERE activo) <> 6 THEN
        RAISE EXCEPTION 'Autoverificación 014: el catálogo de deportes no quedó sembrado con seis deportes activos.';
    END IF;

    IF EXISTS (SELECT 1 FROM public.grupos_deportivos)
       OR EXISTS (SELECT 1 FROM public.inscripciones_deportivas) THEN
        RAISE EXCEPTION 'Autoverificación 014: la migración creó grupos o inscripciones.';
    END IF;

    -- Ningún privilegio de escritura ni de borrado para los roles de aplicación.
    FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        FOREACH v_tabla IN ARRAY ARRAY[
            'public.deportes', 'public.grupos_deportivos', 'public.inscripciones_deportivas'
        ] LOOP
            FOREACH v_privilegio IN ARRAY ARRAY[
                'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
            ] LOOP
                IF pg_catalog.has_table_privilege(v_rol, v_tabla, v_privilegio) THEN
                    RAISE EXCEPTION 'Autoverificación 014: % conserva % sobre %.',
                        v_rol, v_privilegio, v_tabla;
                END IF;
            END LOOP;
        END LOOP;
    END LOOP;

    IF pg_catalog.has_table_privilege('anon', 'public.deportes', 'SELECT')
       OR pg_catalog.has_table_privilege('anon', 'public.grupos_deportivos', 'SELECT')
       OR pg_catalog.has_table_privilege('anon', 'public.inscripciones_deportivas', 'SELECT')
       OR pg_catalog.has_table_privilege('anon', 'public.inscripciones_deportivas_detalle', 'SELECT') THEN
        RAISE EXCEPTION 'Autoverificación 014: anon puede leer objetos deportivos.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_class
        WHERE oid IN (
            'public.deportes'::pg_catalog.regclass,
            'public.grupos_deportivos'::pg_catalog.regclass,
            'public.inscripciones_deportivas'::pg_catalog.regclass
        )
          AND NOT relrowsecurity
    ) THEN
        RAISE EXCEPTION 'Autoverificación 014: una tabla deportiva no tiene RLS.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_policies
        WHERE schemaname = 'public'
          AND tablename IN ('deportes', 'grupos_deportivos', 'inscripciones_deportivas')
          AND cmd <> 'SELECT'
    ) THEN
        RAISE EXCEPTION 'Autoverificación 014: existe una política de escritura sobre tablas deportivas.';
    END IF;

    IF NOT ('security_invoker=true' = ANY (
        COALESCE((SELECT reloptions FROM pg_catalog.pg_class
                  WHERE oid = 'public.inscripciones_deportivas_detalle'::pg_catalog.regclass),
                 ARRAY[]::TEXT[])
    )) THEN
        RAISE EXCEPTION 'Autoverificación 014: la vista de inscripciones deportivas no es security_invoker.';
    END IF;

    FOREACH v_firma IN ARRAY ARRAY[
        'app_private.nivel_alumno(uuid)'::pg_catalog.regprocedure,
        'app_private.nivel_actual()'::pg_catalog.regprocedure,
        'app_private.listar_grupos_deportivos()'::pg_catalog.regprocedure,
        'app_private.crear_grupo_deportivo(uuid,integer,text,integer,uuid)'::pg_catalog.regprocedure,
        'app_private.inscribir_en_grupo_deportivo(uuid)'::pg_catalog.regprocedure,
        'app_private.cancelar_inscripcion_deportiva(uuid)'::pg_catalog.regprocedure,
        'app_private.validar_grupo_deportivo()'::pg_catalog.regprocedure,
        'app_private.validar_inscripcion_deportiva()'::pg_catalog.regprocedure,
        'app_private.proteger_identidad_deporte()'::pg_catalog.regprocedure,
        'app_private.bloquear_inscripcion_deportiva_legada()'::pg_catalog.regprocedure
    ] LOOP
        IF NOT (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid = v_firma)
           OR (SELECT proconfig FROM pg_catalog.pg_proc WHERE oid = v_firma)
               IS DISTINCT FROM ARRAY['search_path=""']
           OR pg_catalog.has_function_privilege('anon', v_firma, 'EXECUTE') THEN
            RAISE EXCEPTION
                'Autoverificación 014: % no es SECURITY DEFINER con search_path vacío o es ejecutable por anon.',
                v_firma;
        END IF;
    END LOOP;

    FOREACH v_firma IN ARRAY ARRAY[
        'public.listar_grupos_deportivos()'::pg_catalog.regprocedure,
        'public.crear_grupo_deportivo(uuid,integer,text,integer,uuid)'::pg_catalog.regprocedure,
        'public.inscribir_en_grupo_deportivo(uuid)'::pg_catalog.regprocedure,
        'public.cancelar_inscripcion_deportiva(uuid)'::pg_catalog.regprocedure
    ] LOOP
        IF (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid = v_firma)
           OR (SELECT proconfig FROM pg_catalog.pg_proc WHERE oid = v_firma)
               IS DISTINCT FROM ARRAY['search_path=""']
           OR pg_catalog.has_function_privilege('anon', v_firma, 'EXECUTE')
           OR NOT pg_catalog.has_function_privilege('authenticated', v_firma, 'EXECUTE') THEN
            RAISE EXCEPTION 'Autoverificación 014: el envoltorio % no es SECURITY INVOKER mínimo.', v_firma;
        END IF;
    END LOOP;

    -- Ninguna RPC del alumno acepta identidad, rol, nivel ni cupo del llamador.
    IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('public', 'app_private')
          AND p.proname IN ('inscribir_en_grupo_deportivo', 'cancelar_inscripcion_deportiva',
                            'listar_grupos_deportivos')
          AND EXISTS (
              SELECT 1 FROM pg_catalog.unnest(COALESCE(p.proargnames, ARRAY[]::TEXT[]))
                  WITH ORDINALITY AS a(nombre, orden)
              WHERE orden <= p.pronargs
                AND (nombre ILIKE '%user%' OR nombre ILIKE '%rol%'
                     OR nombre ILIKE '%alumno%' OR nombre ILIKE '%perfil%'
                     OR nombre ILIKE '%nivel%' OR nombre ILIKE '%cupo%'
                     OR nombre ILIKE '%estado%')
          )
    ) THEN
        RAISE EXCEPTION 'Autoverificación 014: una RPC del alumno acepta identidad, rol, nivel o cupo del llamador.';
    END IF;

    -- Las claves foráneas del historial son restrictivas.
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conrelid IN (
                  'public.grupos_deportivos'::pg_catalog.regclass,
                  'public.inscripciones_deportivas'::pg_catalog.regclass
              )
          AND contype = 'f'
          AND confdeltype <> 'r'
    ) THEN
        RAISE EXCEPTION 'Autoverificación 014: una clave foránea deportiva no es ON DELETE RESTRICT.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_trigger
        WHERE tgrelid = 'public.inscripciones'::pg_catalog.regclass
          AND tgname = 'bloquear_inscripcion_deportiva_legada'
          AND tgenabled = 'O'
    ) THEN
        RAISE EXCEPTION 'Autoverificación 014: falta el bloqueo de la vía deportiva legada.';
    END IF;

    RAISE NOTICE
        'Migración 014: % deporte(s) sembrado(s); % inscripción(es) deportiva(s) legada(s) conservada(s) como histórico de solo lectura.',
        (SELECT pg_catalog.count(*) FROM public.deportes),
        (SELECT pg_catalog.count(*) FROM public.inscripciones i
         JOIN public.actividades a ON a.id = i.actividad_id
         WHERE a.tipo = 'DEPORTE');
END $$;
