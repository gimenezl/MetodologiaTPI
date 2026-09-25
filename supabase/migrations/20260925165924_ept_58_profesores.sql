-- ============================================================
-- EDUCAR PARA TRANSFORMAR — Administración de profesores, etapa A (EPT-58)
-- ============================================================
-- Migración aditiva. No modifica ni renumera 001–016 ni
-- 20260924225451_ept_57_horarios_academicos.sql.
--
-- EPT-58 se entrega en tres etapas: A (esta migración) → aplicación → B.
-- Esta etapa agrega el esquema que la aplicación de la etapa 2 va a usar y NO
-- cambia la política «Directores y docentes ven todos los perfiles» (005):
-- la aplicación publicada antes de A debe comportarse igual después de A. El
-- cierre de esa lectura global es la migración B, que se aplica solo cuando la
-- aplicación de la etapa 2 ya no depende de ella.
--
-- ============================================================
-- MODELO
-- ============================================================
--   1. `public.perfiles` sigue siendo la única fuente de la identidad. El
--      número de legajo visible es `perfiles.legajo_nro`, que ya es único sin
--      distinguir mayúsculas (008). No se crea otro número ni se copia ningún
--      dato personal. El correo vive en Auth y esta migración no lo lee.
--
--   2. `public.profesores` es la ficha 1:1 de un perfil DOCENTE: especialidad y
--      estado. La clave primaria ES el perfil y la clave foránea es ON DELETE
--      RESTRICT: un perfil con ficha no se puede borrar.
--
--   3. `public.profesores_estados_historial` registra cada cambio de estado con
--      fecha, actor y motivo opcional. Es de solo agregado.
--
--   4. Las materias, cursos, niveles, grupos y franjas a cargo NO se copian: se
--      derivan de `materias_cursos` (EPT-56), `materias_cursos_horarios`
--      (EPT-57), `grupos_deportivos` (EPT-11) y `grupos_deportivos_horarios`
--      (EPT-12). No hay una segunda fuente de asignaciones.
--
-- ============================================================
-- INVARIANTES Y CÓMO SE GARANTIZAN
-- ============================================================
-- | Invariante                                          | Garantía                         |
-- |-----------------------------------------------------|----------------------------------|
-- | Una ficha por perfil, sin borrado del perfil        | PK = FK ON DELETE RESTRICT       |
-- | Todo DOCENTE existente o nuevo tiene ficha          | backfill + trigger AFTER INSERT  |
-- | Especialidad normalizada de 2 a 100 caracteres      | CHECK + normalización en la RPC  |
-- | Ficha completa = legajo + especialidad              | derivado; la RPC exige ambos     |
-- | Inactivar sin asignaciones ni grupos activos        | RPC con ficha bloqueada          |
-- | Docente INACTIVO nunca queda a cargo                | trigger BEFORE con ficha FOR SHARE|
-- | Reactivar con ficha completa y rol DOCENTE vigente  | RPC con ficha y perfil bloqueados|
-- | Historial solo agregable                            | sin GRANT + trigger que rechaza  |
-- |                                                     | UPDATE, DELETE y TRUNCATE        |
-- | Escrituras solo de la dirección                     | RPC + es_director() en la base   |
-- | Lectura: dirección todo, docente lo propio          | RPC + RLS                        |
--
-- ============================================================
-- ORDEN DE BLOQUEOS
-- ============================================================
--     profesores  →  actividades  →  cursos  →  perfiles  →  materias_cursos
--     profesores  →  deportes  →  niveles  →  perfiles  →  grupos_deportivos
--
-- El trigger nuevo sobre `materias_cursos` y `grupos_deportivos` se llama
-- `a_exigir_profesor_activo` para dispararse ANTES que los triggers de 012 y
-- 014 (PostgreSQL los ordena por nombre). Así la ficha se bloquea primero, en
-- el mismo orden en que la bloquean las RPC de esta migración (ficha → perfil).
-- Con el orden inverso, editar el legajo de un profesor mientras otra
-- transacción le asigna una materia podría formar un ciclo de espera.
--
--   * Asignar, cambiar el responsable o reactivar una asignación o un grupo:
--     el trigger toma la ficha `FOR SHARE`.
--   * Inactivar o reactivar la ficha: la RPC toma la ficha `FOR NO KEY UPDATE`
--     y recién después cuenta asignaciones (o bloquea el perfil `FOR SHARE`).
--
-- `FOR SHARE` entra en conflicto con `FOR NO KEY UPDATE`, así que una
-- asignación y un cambio de estado del mismo profesor quedan serializados:
--
--   * Si la asignación bloquea primero, la inactivación espera y, al avanzar,
--     su conteo (una sentencia nueva, con instantánea nueva) ya ve la
--     asignación confirmada y rechaza con P5610.
--   * Si el cambio de estado bloquea primero, la asignación espera y relee la
--     ficha ya confirmada: si quedó INACTIVO, rechaza con P5605.
--
-- ============================================================
-- CÓDIGOS SQLSTATE PROPIOS
-- ============================================================
-- Bloque nuevo P5600–P5612, sin colisión con P5500–P5598.
--   P5600  el profesor solicitado no existe
--   P5601  la dirección debe indicar qué profesor consulta
--   P5602  el legajo es obligatorio para completar la ficha
--   P5603  la especialidad es obligatoria
--   P5604  la especialidad debe tener entre 2 y 100 caracteres
--   P5605  el profesor está inactivo y no puede quedar a cargo
--   P5606  el estado solicitado no es válido
--   P5607  el motivo supera los 500 caracteres
--   P5608  el profesor ya está en el estado solicitado
--   P5609  el historial de estados es de solo agregado
--   P5610  la inactivación choca con asignaciones o grupos activos
--   P5611  la reactivación exige el rol DOCENTE vigente
--   P5612  la reactivación exige la ficha completa
-- Reutilizados: P5505 (identidad), 42501 (rol), P5515 (legajo inválido, 008),
-- 23505 (legajo duplicado, índices de 001/008).
-- ============================================================


-- ================================================================
-- 1. PRECONDICIONES Y CONTEOS DE PRESERVACIÓN
-- ================================================================
DO $$
BEGIN
    IF pg_catalog.to_regclass('public.perfiles') IS NULL
       OR pg_catalog.to_regclass('public.roles') IS NULL
       OR pg_catalog.to_regclass('public.materias_cursos') IS NULL
       OR pg_catalog.to_regclass('public.materias_cursos_horarios') IS NULL
       OR pg_catalog.to_regclass('public.grupos_deportivos') IS NULL
       OR pg_catalog.to_regclass('public.grupos_deportivos_horarios') IS NULL
       OR pg_catalog.to_regclass('public.horarios') IS NULL
    THEN
        RAISE EXCEPTION
            'Migración EPT-58 A: faltan tablas base; la base no corresponde a 001–016 + EPT-57.';
    END IF;

    IF pg_catalog.to_regprocedure('app_private.es_director()') IS NULL
       OR pg_catalog.to_regprocedure('app_private.rol_actual()') IS NULL
       OR pg_catalog.to_regprocedure('app_private.perfil_actual()') IS NULL
       OR pg_catalog.to_regprocedure('app_private.legajo_valido(text)') IS NULL
       OR pg_catalog.to_regprocedure('public.es_director_actual()') IS NULL
    THEN
        RAISE EXCEPTION
            'Migración EPT-58 A: faltan funciones de identidad de 003–008.';
    END IF;

    IF pg_catalog.to_regclass('public.profesores') IS NOT NULL
       OR pg_catalog.to_regclass('public.profesores_estados_historial') IS NOT NULL
    THEN
        RAISE EXCEPTION
            'Migración EPT-58 A: ya existen objetos de profesores; revisá el estado de la base antes de continuar.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.roles WHERE nombre = 'DOCENTE') THEN
        RAISE EXCEPTION 'Migración EPT-58 A: no existe el rol DOCENTE en el catálogo.';
    END IF;
END $$;

-- Las filas existentes de estas tablas no deben cambiar. Se comparan al final
-- por cantidad y por huella de contenido.
CREATE TEMPORARY TABLE ept_058_conteos_iniciales (
    relacion TEXT PRIMARY KEY,
    cantidad BIGINT NOT NULL,
    huella   TEXT NOT NULL
) ON COMMIT DROP;

INSERT INTO ept_058_conteos_iniciales (relacion, cantidad, huella)
VALUES
    ('perfiles',
        (SELECT pg_catalog.count(*) FROM public.perfiles),
        (SELECT pg_catalog.md5(COALESCE(pg_catalog.string_agg(
             pg_catalog.concat_ws('|', id, user_id, rol_id, nombre, apellido, dni,
                                  direccion, telefono, legajo_nro, fecha_nacimiento),
             ';' ORDER BY id), ''))
         FROM public.perfiles)),
    ('materias_cursos',
        (SELECT pg_catalog.count(*) FROM public.materias_cursos),
        (SELECT pg_catalog.md5(COALESCE(pg_catalog.string_agg(
             pg_catalog.concat_ws('|', id, materia_id, curso_id, profesor_id, activo,
                                  fecha_creacion, fecha_actualizacion),
             ';' ORDER BY id), ''))
         FROM public.materias_cursos)),
    ('grupos_deportivos',
        (SELECT pg_catalog.count(*) FROM public.grupos_deportivos),
        (SELECT pg_catalog.md5(COALESCE(pg_catalog.string_agg(
             pg_catalog.concat_ws('|', id, deporte_id, nivel_id, nombre, cupo, profesor_id,
                                  activo, fecha_creacion, fecha_actualizacion),
             ';' ORDER BY id), ''))
         FROM public.grupos_deportivos));


-- ================================================================
-- 2. CATÁLOGO DE ESTADOS
-- ================================================================
-- Tipo propio, igual que `estado_alumno` (008): el generador de tipos lo
-- proyecta como una unión exacta de TypeScript.
CREATE TYPE public.estado_profesor AS ENUM ('ACTIVO', 'INACTIVO');


-- ================================================================
-- 3. CONTRATO DE TEXTO: ESPECIALIDAD Y MOTIVO
-- ================================================================
-- Conjunto de espacios en blanco: exactamente el de `nombre_materia_valido`
-- (012), escrito como clase de expresión regular. Incluye U+0085, que `\s` de
-- JavaScript no incluye: el cliente y el servidor deben usar la misma clase
-- explícita para que la normalización sea equivalente.
--
--   U+0009–U+000D, U+0020, U+0085, U+00A0, U+1680, U+2000–U+200A, U+2028,
--   U+2029, U+202F, U+205F, U+3000, U+FEFF
--
-- Especialidad: se reemplaza cada tramo de espacios por un único espacio ASCII
-- y se recortan los extremos. «  Ciencias  Naturales » queda
-- «Ciencias Naturales». La base normaliza en la RPC y el CHECK rechaza
-- cualquier valor almacenado que no esté normalizado.
CREATE OR REPLACE FUNCTION app_private.normalizar_especialidad(p_texto TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT pg_catalog.btrim(
        pg_catalog.regexp_replace(
            p_texto,
            '[\u0009-\u000D \u0085   -     　﻿]+',
            ' ',
            'g'
        ),
        ' '
    );
$$;

CREATE OR REPLACE FUNCTION app_private.especialidad_valida(p_especialidad TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT p_especialidad IS NOT NULL
       AND p_especialidad OPERATOR(pg_catalog.=) app_private.normalizar_especialidad(p_especialidad)
       AND pg_catalog.char_length(p_especialidad) BETWEEN 2 AND 100;
$$;

-- Motivo: texto libre opcional. Solo se recortan los extremos (un motivo puede
-- tener varias líneas) y un motivo vacío se guarda como NULL.
CREATE OR REPLACE FUNCTION app_private.normalizar_motivo_estado(p_texto TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT NULLIF(
        pg_catalog.regexp_replace(
            p_texto,
            '^[\u0009-\u000D \u0085   -     　﻿]+|[\u0009-\u000D \u0085   -     　﻿]+$',
            '',
            'g'
        ),
        ''
    );
$$;

CREATE OR REPLACE FUNCTION app_private.motivo_estado_valido(p_motivo TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT p_motivo IS NOT NULL
       AND p_motivo OPERATOR(pg_catalog.=) app_private.normalizar_motivo_estado(p_motivo)
       AND pg_catalog.char_length(p_motivo) BETWEEN 1 AND 500;
$$;

-- Ningún rol de aplicación escribe directamente estas tablas, así que el CHECK
-- solo lo evalúa el propietario (las RPC SECURITY DEFINER). No se concede
-- EXECUTE a nadie.
REVOKE ALL ON FUNCTION app_private.normalizar_especialidad(TEXT)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.especialidad_valida(TEXT)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.normalizar_motivo_estado(TEXT)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.motivo_estado_valido(TEXT)
    FROM PUBLIC, anon, authenticated, service_role;


-- ================================================================
-- 4. FICHA DE PROFESOR
-- ================================================================
CREATE TABLE public.profesores (
    -- La clave primaria ES la del perfil: relación 1:1 sin identificador nuevo.
    perfil_id UUID PRIMARY KEY
        REFERENCES public.perfiles(id) ON DELETE RESTRICT,
    -- NULL mientras la dirección no la cargue. Nunca se inventa.
    especialidad VARCHAR(100),
    estado public.estado_profesor NOT NULL DEFAULT 'ACTIVO',
    fecha_alta TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    fecha_actualizacion TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT profesores_especialidad_valida
        CHECK (especialidad IS NULL OR app_private.especialidad_valida(especialidad) IS TRUE)
);

COMMENT ON TABLE public.profesores IS
    'Ficha 1:1 de un perfil DOCENTE: especialidad y estado. La identidad y el legajo viven únicamente en public.perfiles; el correo, en Auth. Nunca se elimina.';
COMMENT ON COLUMN public.profesores.especialidad IS
    'Especialidad textual libre y no única, normalizada (espacios colapsados y recortados), de 2 a 100 caracteres. NULL = ficha incompleta.';
COMMENT ON COLUMN public.profesores.estado IS
    'ACTIVO o INACTIVO. Inactivar no bloquea el inicio de sesión: eso pertenece a EPT-59.';


-- ================================================================
-- 5. HISTORIAL DE ESTADOS
-- ================================================================
CREATE TABLE public.profesores_estados_historial (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    profesor_id UUID NOT NULL
        REFERENCES public.profesores(perfil_id) ON DELETE RESTRICT,
    estado_anterior public.estado_profesor NOT NULL,
    estado_nuevo public.estado_profesor NOT NULL,
    motivo VARCHAR(500),
    -- Perfil de quien hizo el cambio, derivado de la sesión dentro de la RPC.
    actor_id UUID NOT NULL
        REFERENCES public.perfiles(id) ON DELETE RESTRICT,
    fecha TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT profesores_estados_historial_transicion
        CHECK (estado_anterior <> estado_nuevo),
    CONSTRAINT profesores_estados_historial_motivo_valido
        CHECK (motivo IS NULL OR app_private.motivo_estado_valido(motivo) IS TRUE)
);

COMMENT ON TABLE public.profesores_estados_historial IS
    'Historial de solo agregado de los cambios de estado de cada ficha de profesor: fecha, actor y motivo opcional. No admite modificación ni borrado.';

-- Historial de un profesor, más reciente primero; también indexa la FK.
CREATE INDEX idx_profesores_estados_historial_profesor
    ON public.profesores_estados_historial (profesor_id, fecha DESC);

-- Índice de la FK hacia el perfil del actor.
CREATE INDEX idx_profesores_estados_historial_actor
    ON public.profesores_estados_historial (actor_id);

-- La negación por privilegios (sección 12) alcanza a todos los roles de
-- aplicación. El trigger la extiende al propietario: ni una limpieza manual por
-- error puede reescribir la historia sin deshabilitarlo explícitamente.
CREATE OR REPLACE FUNCTION app_private.impedir_cambios_historial_profesor()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION USING
        ERRCODE = 'P5609',
        MESSAGE = 'El historial de estados de un profesor es de solo agregado: no se modifica ni se elimina.';
END;
$$;

REVOKE ALL ON FUNCTION app_private.impedir_cambios_historial_profesor()
    FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER impedir_modificar_historial_profesor
    BEFORE UPDATE OR DELETE ON public.profesores_estados_historial
    FOR EACH ROW
    EXECUTE FUNCTION app_private.impedir_cambios_historial_profesor();

-- RLS no alcanza a TRUNCATE: se rechaza con un trigger de sentencia.
CREATE TRIGGER impedir_vaciar_historial_profesor
    BEFORE TRUNCATE ON public.profesores_estados_historial
    FOR EACH STATEMENT
    EXECUTE FUNCTION app_private.impedir_cambios_historial_profesor();


-- ================================================================
-- 6. TODO PERFIL DOCENTE NUEVO TIENE FICHA
-- ================================================================
-- Un DOCENTE nace por `/api/usuarios` (trigger de 010 dentro de la transacción
-- de GoTrue) o por un alta directa de la dirección. El trigger cubre las dos:
-- venga por donde venga, el perfil queda con ficha ACTIVO e incompleta, nunca
-- con legajo o especialidad inventados. Igual que 008 con los estudiantes, solo
-- el alta dispara la ficha: la transición de rol es de EPT-59.
CREATE OR REPLACE FUNCTION app_private.registrar_profesor_de_perfil()
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
        WHERE r.id = NEW.rol_id AND r.nombre = 'DOCENTE'
    ) THEN
        INSERT INTO public.profesores (perfil_id)
        VALUES (NEW.id)
        ON CONFLICT (perfil_id) DO NOTHING;
    END IF;

    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION app_private.registrar_profesor_de_perfil()
    FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER registrar_profesor_al_crear_perfil
    AFTER INSERT ON public.perfiles
    FOR EACH ROW
    EXECUTE FUNCTION app_private.registrar_profesor_de_perfil();


-- ================================================================
-- 7. INCORPORACIÓN DE LOS DOCENTES EXISTENTES
-- ================================================================
-- Quedan ACTIVO y sin especialidad. Los que tampoco tienen legajo se muestran
-- como «Ficha incompleta» hasta que la dirección los complete.
INSERT INTO public.profesores (perfil_id, estado)
SELECT p.id, 'ACTIVO'
FROM public.perfiles p
JOIN public.roles r ON r.id = p.rol_id
WHERE r.nombre = 'DOCENTE'
ON CONFLICT (perfil_id) DO NOTHING;


-- ================================================================
-- 8. UN PROFESOR INACTIVO NUNCA QUEDA A CARGO
-- ================================================================
-- Amplía las validaciones de 012 (asignaciones) y 014 (grupos) sin editarlas.
-- Se exige una ficha ACTIVO cuando la relación nace, cuando cambia el
-- responsable o cuando la relación se reactiva. Conservar o inactivar una
-- relación existente nunca lo exige: el historial de un docente inactivo
-- tiene que poder cerrarse.
--
-- Si el perfil no tiene ficha, la decisión queda en manos de 012/014: un perfil
-- inexistente sigue devolviendo P5533/P5564 y uno sin rol DOCENTE, P5535/P5565.
CREATE OR REPLACE FUNCTION app_private.exigir_profesor_activo()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_estado public.estado_profesor;
BEGIN
    IF NEW.profesor_id IS NULL THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE'
       AND NEW.profesor_id IS NOT DISTINCT FROM OLD.profesor_id
       AND NOT (NEW.activo AND NOT OLD.activo) THEN
        RETURN NEW;
    END IF;

    -- FOR SHARE entra en conflicto con el FOR NO KEY UPDATE que toma el
    -- cambio de estado: la asignación y la inactivación quedan serializadas.
    SELECT pr.estado
    INTO v_estado
    FROM public.profesores pr
    WHERE pr.perfil_id = NEW.profesor_id
    FOR SHARE;

    IF FOUND AND v_estado = 'INACTIVO' THEN
        IF TG_TABLE_NAME = 'grupos_deportivos' THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P5605',
                MESSAGE = 'El profesor está inactivo y no puede quedar a cargo de un grupo deportivo.';
        END IF;

        RAISE EXCEPTION USING
            ERRCODE = 'P5605',
            MESSAGE = 'El profesor está inactivo y no puede quedar a cargo de una asignación de materia.';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.exigir_profesor_activo()
    FROM PUBLIC, anon, authenticated, service_role;

-- El prefijo `a_` lo dispara antes que `validar_*` de 012/014 (ver el orden de
-- bloqueos en la cabecera).
CREATE TRIGGER a_exigir_profesor_activo
    BEFORE INSERT OR UPDATE OF profesor_id, activo ON public.materias_cursos
    FOR EACH ROW
    EXECUTE FUNCTION app_private.exigir_profesor_activo();

CREATE TRIGGER a_exigir_profesor_activo
    BEFORE INSERT OR UPDATE OF profesor_id, activo ON public.grupos_deportivos
    FOR EACH ROW
    EXECUTE FUNCTION app_private.exigir_profesor_activo();


-- ================================================================
-- 9. OPERACIONES DE LECTURA
-- ================================================================
-- Todas viven en `app_private`, que la Data API no expone, y derivan la
-- identidad de `auth.uid()`. La dirección consulta cualquier ficha; un docente,
-- solo la propia. Cualquier otro actor recibe 42501.

-- Resuelve qué ficha puede consultar la sesión. Pedir otra ficha como docente
-- se rechaza sin revelar si existe.
CREATE OR REPLACE FUNCTION app_private.profesor_consultable(p_profesor_id UUID)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_rol    TEXT;
    v_perfil UUID;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    v_rol := app_private.rol_actual();
    v_perfil := app_private.perfil_actual();

    IF v_rol = 'DIRECTOR' THEN
        IF p_profesor_id IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P5601', MESSAGE = 'Indicá qué profesor querés consultar.';
        END IF;

        IF NOT EXISTS (SELECT 1 FROM public.profesores pr WHERE pr.perfil_id = p_profesor_id) THEN
            RAISE EXCEPTION USING ERRCODE = 'P5600', MESSAGE = 'El profesor solicitado no existe.';
        END IF;

        RETURN p_profesor_id;
    END IF;

    IF v_rol = 'DOCENTE' AND v_perfil IS NOT NULL THEN
        IF p_profesor_id IS NOT NULL AND p_profesor_id <> v_perfil THEN
            RAISE EXCEPTION USING
                ERRCODE = '42501',
                MESSAGE = 'Solo podés consultar tu propia ficha de profesor.';
        END IF;

        IF NOT EXISTS (SELECT 1 FROM public.profesores pr WHERE pr.perfil_id = v_perfil) THEN
            RAISE EXCEPTION USING ERRCODE = 'P5600', MESSAGE = 'No encontramos tu ficha de profesor.';
        END IF;

        RETURN v_perfil;
    END IF;

    RAISE EXCEPTION USING
        ERRCODE = '42501',
        MESSAGE = 'Solo la dirección o el propio docente pueden consultar fichas de profesores.';
END;
$$;

REVOKE ALL ON FUNCTION app_private.profesor_consultable(UUID)
    FROM PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------
-- 9.1 Listado de fichas (DIRECTOR)
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.listar_profesores()
RETURNS TABLE (
    perfil_id            UUID,
    nombre               TEXT,
    apellido             TEXT,
    legajo_nro           TEXT,
    especialidad         TEXT,
    estado               public.estado_profesor,
    ficha_completa       BOOLEAN,
    rol_docente_vigente  BOOLEAN,
    asignaciones_activas INTEGER,
    grupos_activos       INTEGER,
    fecha_alta           TIMESTAMP WITH TIME ZONE,
    fecha_actualizacion  TIMESTAMP WITH TIME ZONE
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
            MESSAGE = 'Solo la dirección puede listar las fichas de profesores.';
    END IF;

    RETURN QUERY
    SELECT pr.perfil_id,
           p.nombre::TEXT,
           p.apellido::TEXT,
           p.legajo_nro::TEXT,
           pr.especialidad::TEXT,
           pr.estado,
           (p.legajo_nro IS NOT NULL AND pr.especialidad IS NOT NULL),
           (r.nombre IS NOT DISTINCT FROM 'DOCENTE'),
           (SELECT pg_catalog.count(*)::INTEGER
            FROM public.materias_cursos mc
            WHERE mc.profesor_id = pr.perfil_id AND mc.activo),
           (SELECT pg_catalog.count(*)::INTEGER
            FROM public.grupos_deportivos g
            WHERE g.profesor_id = pr.perfil_id AND g.activo),
           pr.fecha_alta,
           pr.fecha_actualizacion
    FROM public.profesores pr
    JOIN public.perfiles p ON p.id = pr.perfil_id
    LEFT JOIN public.roles r ON r.id = p.rol_id
    ORDER BY p.apellido, p.nombre, pr.perfil_id;
END;
$$;

-- ----------------------------------------------------------------
-- 9.2 Ficha con datos personales (DIRECTOR cualquiera; DOCENTE la propia)
-- ----------------------------------------------------------------
-- No devuelve el correo: vive en Auth y no forma parte de la ficha.
CREATE OR REPLACE FUNCTION app_private.consultar_ficha_profesor(p_profesor_id UUID DEFAULT NULL)
RETURNS TABLE (
    perfil_id           UUID,
    nombre              TEXT,
    apellido            TEXT,
    dni                 TEXT,
    legajo_nro          TEXT,
    especialidad        TEXT,
    estado              public.estado_profesor,
    ficha_completa      BOOLEAN,
    rol_docente_vigente BOOLEAN,
    telefono            TEXT,
    direccion           TEXT,
    fecha_nacimiento    DATE,
    fecha_alta          TIMESTAMP WITH TIME ZONE,
    fecha_actualizacion TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_profesor UUID;
BEGIN
    v_profesor := app_private.profesor_consultable(p_profesor_id);

    RETURN QUERY
    SELECT pr.perfil_id,
           p.nombre::TEXT,
           p.apellido::TEXT,
           p.dni::TEXT,
           p.legajo_nro::TEXT,
           pr.especialidad::TEXT,
           pr.estado,
           (p.legajo_nro IS NOT NULL AND pr.especialidad IS NOT NULL),
           (r.nombre IS NOT DISTINCT FROM 'DOCENTE'),
           p.telefono::TEXT,
           p.direccion,
           p.fecha_nacimiento,
           pr.fecha_alta,
           pr.fecha_actualizacion
    FROM public.profesores pr
    JOIN public.perfiles p ON p.id = pr.perfil_id
    LEFT JOIN public.roles r ON r.id = p.rol_id
    WHERE pr.perfil_id = v_profesor;
END;
$$;

-- ----------------------------------------------------------------
-- 9.3 Asignaciones a cargo, vigentes e históricas
-- ----------------------------------------------------------------
-- Una fila por relación que HOY referencia al profesor. `vigente` es el estado
-- de la propia relación (`materias_cursos.activo` o `grupos_deportivos.activo`):
-- las relaciones inactivas se devuelven marcadas, no se mezclan con las
-- vigentes. `actividad_activa` y `curso_activo` informan si la materia, el
-- deporte o el curso se inactivaron por su lado.
CREATE OR REPLACE FUNCTION app_private.listar_asignaciones_profesor(p_profesor_id UUID DEFAULT NULL)
RETURNS TABLE (
    tipo                TEXT,
    relacion_id         UUID,
    vigente             BOOLEAN,
    actividad_nombre    TEXT,
    grupo_nombre        TEXT,
    curso_id            UUID,
    curso_denominacion  TEXT,
    curso_division      TEXT,
    nivel_id            INTEGER,
    nivel_nombre        TEXT,
    actividad_activa    BOOLEAN,
    curso_activo        BOOLEAN,
    fecha_actualizacion TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_profesor UUID;
BEGIN
    v_profesor := app_private.profesor_consultable(p_profesor_id);

    RETURN QUERY
    SELECT a.tipo, a.relacion_id, a.vigente, a.actividad_nombre, a.grupo_nombre,
           a.curso_id, a.curso_denominacion, a.curso_division, a.nivel_id,
           a.nivel_nombre, a.actividad_activa, a.curso_activo, a.fecha_actualizacion
    FROM (
        SELECT 'MATERIA'::TEXT AS tipo,
               mc.id AS relacion_id,
               mc.activo AS vigente,
               ac.nombre::TEXT AS actividad_nombre,
               NULL::TEXT AS grupo_nombre,
               c.id AS curso_id,
               c.denominacion::TEXT AS curso_denominacion,
               c.division::TEXT AS curso_division,
               n.id AS nivel_id,
               n.nombre::TEXT AS nivel_nombre,
               ac.activo AS actividad_activa,
               c.activo AS curso_activo,
               mc.fecha_actualizacion
        FROM public.materias_cursos mc
        JOIN public.actividades ac ON ac.id = mc.materia_id
        JOIN public.cursos c ON c.id = mc.curso_id
        JOIN public.niveles n ON n.id = c.nivel_id
        WHERE mc.profesor_id = v_profesor

        UNION ALL

        SELECT 'GRUPO_DEPORTIVO'::TEXT,
               g.id,
               g.activo,
               d.nombre::TEXT,
               g.nombre::TEXT,
               NULL::UUID,
               NULL::TEXT,
               NULL::TEXT,
               n.id,
               n.nombre::TEXT,
               d.activo,
               NULL::BOOLEAN,
               g.fecha_actualizacion
        FROM public.grupos_deportivos g
        JOIN public.deportes d ON d.id = g.deporte_id
        JOIN public.niveles n ON n.id = g.nivel_id
        WHERE g.profesor_id = v_profesor
    ) AS a
    ORDER BY a.vigente DESC, a.tipo, a.actividad_nombre, a.curso_denominacion,
             a.curso_division, a.grupo_nombre, a.relacion_id;
END;
$$;

-- ----------------------------------------------------------------
-- 9.4 Horarios a cargo
-- ----------------------------------------------------------------
-- Solo franjas activas de relaciones vigentes. Se vinculan con 9.3 por
-- `tipo` + `relacion_id`.
CREATE OR REPLACE FUNCTION app_private.listar_horarios_profesor(p_profesor_id UUID DEFAULT NULL)
RETURNS TABLE (
    tipo        TEXT,
    relacion_id UUID,
    franja_id   UUID,
    dia_semana  SMALLINT,
    hora_inicio TIME WITHOUT TIME ZONE,
    hora_fin    TIME WITHOUT TIME ZONE
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_profesor UUID;
BEGIN
    v_profesor := app_private.profesor_consultable(p_profesor_id);

    RETURN QUERY
    SELECT h.tipo, h.relacion_id, h.franja_id, h.dia_semana, h.hora_inicio, h.hora_fin
    FROM (
        SELECT 'MATERIA'::TEXT AS tipo,
               mc.id AS relacion_id,
               f.id AS franja_id,
               ho.dia_semana,
               ho.hora_inicio,
               ho.hora_fin
        FROM public.materias_cursos mc
        JOIN public.materias_cursos_horarios f ON f.asignacion_id = mc.id AND f.activo
        JOIN public.horarios ho ON ho.id = f.horario_id
        WHERE mc.profesor_id = v_profesor AND mc.activo

        UNION ALL

        SELECT 'GRUPO_DEPORTIVO'::TEXT,
               g.id,
               gh.id,
               ho.dia_semana,
               ho.hora_inicio,
               ho.hora_fin
        FROM public.grupos_deportivos g
        JOIN public.grupos_deportivos_horarios gh ON gh.grupo_id = g.id AND gh.activo
        JOIN public.horarios ho ON ho.id = gh.horario_id
        WHERE g.profesor_id = v_profesor AND g.activo
    ) AS h
    ORDER BY h.dia_semana, h.hora_inicio, h.hora_fin, h.tipo, h.relacion_id, h.franja_id;
END;
$$;

-- ----------------------------------------------------------------
-- 9.5 Historial de estados (DIRECTOR)
-- ----------------------------------------------------------------
-- Es información administrativa: el motivo y el actor son de la dirección. El
-- docente ve su estado vigente en la ficha, no el historial.
CREATE OR REPLACE FUNCTION app_private.listar_historial_estados_profesor(p_profesor_id UUID)
RETURNS TABLE (
    id              BIGINT,
    estado_anterior public.estado_profesor,
    estado_nuevo    public.estado_profesor,
    motivo          TEXT,
    fecha           TIMESTAMP WITH TIME ZONE,
    actor_id        UUID,
    actor_nombre    TEXT,
    actor_apellido  TEXT
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
            MESSAGE = 'Solo la dirección puede consultar el historial de estados de un profesor.';
    END IF;

    IF p_profesor_id IS NULL
       OR NOT EXISTS (SELECT 1 FROM public.profesores pr WHERE pr.perfil_id = p_profesor_id) THEN
        RAISE EXCEPTION USING ERRCODE = 'P5600', MESSAGE = 'El profesor solicitado no existe.';
    END IF;

    RETURN QUERY
    SELECT h.id, h.estado_anterior, h.estado_nuevo, h.motivo::TEXT, h.fecha,
           h.actor_id, p.nombre::TEXT, p.apellido::TEXT
    FROM public.profesores_estados_historial h
    JOIN public.perfiles p ON p.id = h.actor_id
    WHERE h.profesor_id = p_profesor_id
    ORDER BY h.fecha DESC, h.id DESC;
END;
$$;

-- ----------------------------------------------------------------
-- 9.6 Consulta mínima de estudiantes para Asistencias y Cupos
-- ----------------------------------------------------------------
-- La migración B quitará a DOCENTE la lectura global de `perfiles`. Esta
-- función conserva exactamente el conjunto que hoy muestran Asistencias y
-- Cupos (todos los perfiles ESTUDIANTE) con solo cuatro columnas: sin DNI,
-- domicilio, teléfono ni fecha de nacimiento. No filtra por curso: ese
-- recorte requiere un contrato aparte.
CREATE OR REPLACE FUNCTION app_private.listar_estudiantes_para_gestion()
RETURNS TABLE (
    id         UUID,
    nombre     TEXT,
    apellido   TEXT,
    legajo_nro TEXT
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

    IF app_private.rol_actual() IS DISTINCT FROM 'DIRECTOR'
       AND app_private.rol_actual() IS DISTINCT FROM 'DOCENTE' THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Solo la dirección o un docente pueden consultar el listado de estudiantes.';
    END IF;

    RETURN QUERY
    SELECT p.id, p.nombre::TEXT, p.apellido::TEXT, p.legajo_nro::TEXT
    FROM public.perfiles p
    JOIN public.roles r ON r.id = p.rol_id
    WHERE r.nombre = 'ESTUDIANTE'
    ORDER BY p.apellido, p.nombre, p.id;
END;
$$;


-- ================================================================
-- 10. OPERACIONES DE ESCRITURA (DIRECTOR)
-- ================================================================
-- Verifican `auth.uid()` y el rol DIRECTOR dentro de la base; ninguna recibe
-- actor, rol ni usuario como parámetro. Cada una es una transacción completa:
-- un rechazo no deja nada persistido. No existe ninguna operación de borrado.

-- ----------------------------------------------------------------
-- 10.1 Completar o corregir la ficha
-- ----------------------------------------------------------------
-- Exige legajo y especialidad juntos: la ficha se guarda completa o no se
-- guarda. El legajo se valida con el contrato de 008 y su unicidad la
-- garantizan los índices de 001/008 (23505).
CREATE OR REPLACE FUNCTION app_private.actualizar_ficha_profesor(
    p_profesor_id  UUID,
    p_legajo_nro   TEXT,
    p_especialidad TEXT
)
RETURNS public.profesores
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_especialidad TEXT;
    v_ficha        public.profesores;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    IF NOT app_private.es_director() THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Solo la dirección puede modificar fichas de profesores.';
    END IF;

    IF p_profesor_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5600', MESSAGE = 'El profesor solicitado no existe.';
    END IF;

    IF p_legajo_nro IS NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5602',
            MESSAGE = 'El número de legajo es obligatorio para completar la ficha.';
    END IF;

    IF NOT app_private.legajo_valido(p_legajo_nro) THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5515',
            MESSAGE = 'El número de legajo no es válido: debe tener entre 1 y 50 caracteres, sin espacios al principio ni al final.';
    END IF;

    v_especialidad := app_private.normalizar_especialidad(p_especialidad);

    IF v_especialidad IS NULL OR v_especialidad = '' THEN
        RAISE EXCEPTION USING ERRCODE = 'P5603', MESSAGE = 'La especialidad es obligatoria.';
    END IF;

    IF NOT app_private.especialidad_valida(v_especialidad) THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5604',
            MESSAGE = 'La especialidad debe tener entre 2 y 100 caracteres.';
    END IF;

    -- Primer eslabón del orden de bloqueos: la ficha, después el perfil.
    PERFORM 1
    FROM public.profesores pr
    WHERE pr.perfil_id = p_profesor_id
    FOR NO KEY UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P5600', MESSAGE = 'El profesor solicitado no existe.';
    END IF;

    UPDATE public.perfiles
    SET legajo_nro = p_legajo_nro
    WHERE id = p_profesor_id
      AND legajo_nro IS DISTINCT FROM p_legajo_nro;

    UPDATE public.profesores
    SET especialidad = v_especialidad,
        fecha_actualizacion = NOW()
    WHERE perfil_id = p_profesor_id
    RETURNING * INTO v_ficha;

    RETURN v_ficha;
END;
$$;

-- ----------------------------------------------------------------
-- 10.2 Inactivar o reactivar
-- ----------------------------------------------------------------
-- Inactivar se rechaza si queda alguna relación vigente a cargo. El mensaje
-- dice cuántas y el DETAIL, en JSON, cuáles: la dirección sabe qué reasignar.
-- Reactivar exige la ficha completa y el rol DOCENTE vigente.
-- Cada cambio agrega exactamente una fila al historial, con el perfil del
-- actor derivado de la sesión.
CREATE OR REPLACE FUNCTION app_private.cambiar_estado_profesor(
    p_profesor_id UUID,
    p_estado      TEXT,
    p_motivo      TEXT DEFAULT NULL
)
RETURNS public.profesores
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_nuevo        public.estado_profesor;
    v_actual       public.estado_profesor;
    v_especialidad TEXT;
    v_motivo       TEXT;
    v_legajo       TEXT;
    v_rol          TEXT;
    v_asignaciones JSONB;
    v_grupos       JSONB;
    v_cant_asig    INTEGER;
    v_cant_grupos  INTEGER;
    v_actor        UUID;
    v_ficha        public.profesores;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    IF NOT app_private.es_director() THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Solo la dirección puede cambiar el estado de un profesor.';
    END IF;

    IF p_estado IS NULL OR p_estado NOT IN ('ACTIVO', 'INACTIVO') THEN
        RAISE EXCEPTION USING ERRCODE = 'P5606', MESSAGE = 'El estado solicitado debe ser ACTIVO o INACTIVO.';
    END IF;
    v_nuevo := p_estado::public.estado_profesor;

    v_motivo := app_private.normalizar_motivo_estado(p_motivo);
    IF v_motivo IS NOT NULL AND pg_catalog.char_length(v_motivo) > 500 THEN
        RAISE EXCEPTION USING ERRCODE = 'P5607', MESSAGE = 'El motivo no puede superar los 500 caracteres.';
    END IF;

    IF p_profesor_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5600', MESSAGE = 'El profesor solicitado no existe.';
    END IF;

    -- Primer eslabón del orden de bloqueos. Serializa con las asignaciones,
    -- que toman esta misma fila FOR SHARE.
    SELECT pr.estado, pr.especialidad
    INTO v_actual, v_especialidad
    FROM public.profesores pr
    WHERE pr.perfil_id = p_profesor_id
    FOR NO KEY UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P5600', MESSAGE = 'El profesor solicitado no existe.';
    END IF;

    IF v_actual = v_nuevo THEN
        IF v_nuevo = 'ACTIVO' THEN
            RAISE EXCEPTION USING ERRCODE = 'P5608', MESSAGE = 'El profesor ya está activo.';
        END IF;
        RAISE EXCEPTION USING ERRCODE = 'P5608', MESSAGE = 'El profesor ya está inactivo.';
    END IF;

    IF v_nuevo = 'INACTIVO' THEN
        -- Sentencias posteriores al bloqueo: ven toda asignación confirmada por
        -- una transacción que tuviera la ficha tomada.
        SELECT pg_catalog.count(*)::INTEGER,
               COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                   'asignacion_id', mc.id,
                   'materia', ac.nombre,
                   'curso', pg_catalog.concat_ws(' ', c.denominacion, c.division),
                   'nivel', n.nombre
               ) ORDER BY ac.nombre, c.denominacion, c.division), '[]'::JSONB)
        INTO v_cant_asig, v_asignaciones
        FROM public.materias_cursos mc
        JOIN public.actividades ac ON ac.id = mc.materia_id
        JOIN public.cursos c ON c.id = mc.curso_id
        JOIN public.niveles n ON n.id = c.nivel_id
        WHERE mc.profesor_id = p_profesor_id AND mc.activo;

        SELECT pg_catalog.count(*)::INTEGER,
               COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                   'grupo_id', g.id,
                   'deporte', d.nombre,
                   'grupo', g.nombre,
                   'nivel', n.nombre
               ) ORDER BY d.nombre, g.nombre), '[]'::JSONB)
        INTO v_cant_grupos, v_grupos
        FROM public.grupos_deportivos g
        JOIN public.deportes d ON d.id = g.deporte_id
        JOIN public.niveles n ON n.id = g.nivel_id
        WHERE g.profesor_id = p_profesor_id AND g.activo;

        IF v_cant_asig > 0 OR v_cant_grupos > 0 THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P5610',
                MESSAGE = pg_catalog.format(
                    'No se puede inactivar al profesor: tiene %s asignación(es) de materia activa(s) y %s grupo(s) deportivo(s) activo(s) a cargo. Reasignalos o inactivalos primero.',
                    v_cant_asig, v_cant_grupos),
                DETAIL = pg_catalog.jsonb_build_object(
                    'asignaciones', v_asignaciones,
                    'grupos', v_grupos
                )::TEXT;
        END IF;
    ELSE
        -- El perfil se bloquea después de la ficha: un cambio concurrente de
        -- legajo o de rol espera o es esperado, nunca se cruza.
        SELECT p.legajo_nro, r.nombre
        INTO v_legajo, v_rol
        FROM public.perfiles p
        LEFT JOIN public.roles r ON r.id = p.rol_id
        WHERE p.id = p_profesor_id
        FOR SHARE OF p;

        IF v_rol IS DISTINCT FROM 'DOCENTE' THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P5611',
                MESSAGE = 'Para reactivar la ficha, la persona debe conservar el rol DOCENTE.';
        END IF;

        IF v_legajo IS NULL OR v_especialidad IS NULL THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P5612',
                MESSAGE = 'Para reactivar, completá el legajo y la especialidad de la ficha.';
        END IF;
    END IF;

    v_actor := app_private.perfil_actual();

    UPDATE public.profesores
    SET estado = v_nuevo,
        fecha_actualizacion = NOW()
    WHERE perfil_id = p_profesor_id
    RETURNING * INTO v_ficha;

    INSERT INTO public.profesores_estados_historial (
        profesor_id, estado_anterior, estado_nuevo, motivo, actor_id
    )
    VALUES (p_profesor_id, v_actual, v_nuevo, v_motivo, v_actor);

    RETURN v_ficha;
END;
$$;

REVOKE ALL ON FUNCTION app_private.listar_profesores()
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.consultar_ficha_profesor(UUID)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.listar_asignaciones_profesor(UUID)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.listar_horarios_profesor(UUID)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.listar_historial_estados_profesor(UUID)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.listar_estudiantes_para_gestion()
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.actualizar_ficha_profesor(UUID, TEXT, TEXT)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.cambiar_estado_profesor(UUID, TEXT, TEXT)
    FROM PUBLIC, anon, authenticated, service_role;

-- Los envoltorios SECURITY INVOKER necesitan ejecutar la operación privada.
-- Cada una vuelve a validar `auth.uid()` y el rol dentro de PostgreSQL.
GRANT EXECUTE ON FUNCTION app_private.listar_profesores() TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.consultar_ficha_profesor(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.listar_asignaciones_profesor(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.listar_horarios_profesor(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.listar_historial_estados_profesor(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.listar_estudiantes_para_gestion() TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.actualizar_ficha_profesor(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.cambiar_estado_profesor(UUID, TEXT, TEXT) TO authenticated;


-- ================================================================
-- 11. ENVOLTORIOS PÚBLICOS PARA POSTGREST
-- ================================================================
CREATE OR REPLACE FUNCTION public.listar_profesores()
RETURNS TABLE (
    perfil_id            UUID,
    nombre               TEXT,
    apellido             TEXT,
    legajo_nro           TEXT,
    especialidad         TEXT,
    estado               public.estado_profesor,
    ficha_completa       BOOLEAN,
    rol_docente_vigente  BOOLEAN,
    asignaciones_activas INTEGER,
    grupos_activos       INTEGER,
    fecha_alta           TIMESTAMP WITH TIME ZONE,
    fecha_actualizacion  TIMESTAMP WITH TIME ZONE
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT * FROM app_private.listar_profesores();
$$;

CREATE OR REPLACE FUNCTION public.consultar_ficha_profesor(p_profesor_id UUID DEFAULT NULL)
RETURNS TABLE (
    perfil_id           UUID,
    nombre              TEXT,
    apellido            TEXT,
    dni                 TEXT,
    legajo_nro          TEXT,
    especialidad        TEXT,
    estado              public.estado_profesor,
    ficha_completa      BOOLEAN,
    rol_docente_vigente BOOLEAN,
    telefono            TEXT,
    direccion           TEXT,
    fecha_nacimiento    DATE,
    fecha_alta          TIMESTAMP WITH TIME ZONE,
    fecha_actualizacion TIMESTAMP WITH TIME ZONE
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT * FROM app_private.consultar_ficha_profesor(p_profesor_id);
$$;

CREATE OR REPLACE FUNCTION public.listar_asignaciones_profesor(p_profesor_id UUID DEFAULT NULL)
RETURNS TABLE (
    tipo                TEXT,
    relacion_id         UUID,
    vigente             BOOLEAN,
    actividad_nombre    TEXT,
    grupo_nombre        TEXT,
    curso_id            UUID,
    curso_denominacion  TEXT,
    curso_division      TEXT,
    nivel_id            INTEGER,
    nivel_nombre        TEXT,
    actividad_activa    BOOLEAN,
    curso_activo        BOOLEAN,
    fecha_actualizacion TIMESTAMP WITH TIME ZONE
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT * FROM app_private.listar_asignaciones_profesor(p_profesor_id);
$$;

CREATE OR REPLACE FUNCTION public.listar_horarios_profesor(p_profesor_id UUID DEFAULT NULL)
RETURNS TABLE (
    tipo        TEXT,
    relacion_id UUID,
    franja_id   UUID,
    dia_semana  SMALLINT,
    hora_inicio TIME WITHOUT TIME ZONE,
    hora_fin    TIME WITHOUT TIME ZONE
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT * FROM app_private.listar_horarios_profesor(p_profesor_id);
$$;

CREATE OR REPLACE FUNCTION public.listar_historial_estados_profesor(p_profesor_id UUID)
RETURNS TABLE (
    id              BIGINT,
    estado_anterior public.estado_profesor,
    estado_nuevo    public.estado_profesor,
    motivo          TEXT,
    fecha           TIMESTAMP WITH TIME ZONE,
    actor_id        UUID,
    actor_nombre    TEXT,
    actor_apellido  TEXT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT * FROM app_private.listar_historial_estados_profesor(p_profesor_id);
$$;

CREATE OR REPLACE FUNCTION public.listar_estudiantes_para_gestion()
RETURNS TABLE (
    id         UUID,
    nombre     TEXT,
    apellido   TEXT,
    legajo_nro TEXT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT * FROM app_private.listar_estudiantes_para_gestion();
$$;

CREATE OR REPLACE FUNCTION public.actualizar_ficha_profesor(
    p_profesor_id  UUID,
    p_legajo_nro   TEXT,
    p_especialidad TEXT
)
RETURNS public.profesores
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT app_private.actualizar_ficha_profesor(p_profesor_id, p_legajo_nro, p_especialidad);
$$;

CREATE OR REPLACE FUNCTION public.cambiar_estado_profesor(
    p_profesor_id UUID,
    p_estado      TEXT,
    p_motivo      TEXT DEFAULT NULL
)
RETURNS public.profesores
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT app_private.cambiar_estado_profesor(p_profesor_id, p_estado, p_motivo);
$$;

-- Los privilegios por defecto de Supabase conceden EXECUTE sobre funciones
-- nuevas de `public` a anon; se parte de cero y se concede lo mínimo.
REVOKE ALL ON FUNCTION public.listar_profesores() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.consultar_ficha_profesor(UUID) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.listar_asignaciones_profesor(UUID) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.listar_horarios_profesor(UUID) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.listar_historial_estados_profesor(UUID) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.listar_estudiantes_para_gestion() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.actualizar_ficha_profesor(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cambiar_estado_profesor(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.listar_profesores() TO authenticated;
GRANT EXECUTE ON FUNCTION public.consultar_ficha_profesor(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_asignaciones_profesor(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_horarios_profesor(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_historial_estados_profesor(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_estudiantes_para_gestion() TO authenticated;
GRANT EXECUTE ON FUNCTION public.actualizar_ficha_profesor(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cambiar_estado_profesor(UUID, TEXT, TEXT) TO authenticated;


-- ================================================================
-- 12. PRIVILEGIOS MÍNIMOS Y RLS
-- ================================================================
-- Se revoca todo, también a `service_role`: ninguna operación normal de
-- EPT-58 usa la clave de servicio, y así el historial es de solo agregado para
-- todos los roles de aplicación. Las escrituras pasan por las RPC.
ALTER TABLE public.profesores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profesores_estados_historial ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.profesores FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.profesores_estados_historial FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.profesores_estados_historial_id_seq
    FROM PUBLIC, anon, authenticated, service_role;

-- Solo lectura directa, filtrada por RLS. `anon` no recibe nada.
GRANT SELECT ON public.profesores TO authenticated;
GRANT SELECT ON public.profesores_estados_historial TO authenticated;

-- Una sola política por tabla y comando (advisor `multiple_permissive_policies`).
-- El docente ve su propia ficha solo mientras conserva el rol DOCENTE. Los
-- nombres respetan el límite de 63 bytes de PostgreSQL (la «ó» ocupa dos).
CREATE POLICY "Dirección y docente propio ven fichas de profesores"
    ON public.profesores
    FOR SELECT TO authenticated
    USING (
        (SELECT public.es_director_actual())
        OR (
            perfil_id = (SELECT app_private.perfil_actual())
            AND (SELECT app_private.rol_actual()) = 'DOCENTE'
        )
    );

CREATE POLICY "Dirección ve el historial de estados de profesores"
    ON public.profesores_estados_historial
    FOR SELECT TO authenticated
    USING ((SELECT public.es_director_actual()));

-- No se crea ninguna política INSERT, UPDATE ni DELETE. Aunque alguien
-- otorgara el privilegio por error, RLS seguiría rechazando la escritura.


-- ================================================================
-- 13. AUTOVERIFICACIÓN
-- ================================================================
DO $$
DECLARE
    v_relacion   TEXT;
    v_antes      RECORD;
    v_despues    BIGINT;
    v_huella     TEXT;
    v_rol        TEXT;
    v_tabla      TEXT;
    v_privilegio TEXT;
    v_docentes   BIGINT;
    v_fichas     BIGINT;
BEGIN
    -- 13.1 Ninguna fila anterior cambió.
    FOREACH v_relacion IN ARRAY ARRAY['perfiles', 'materias_cursos', 'grupos_deportivos'] LOOP
        SELECT cantidad, huella INTO v_antes
        FROM ept_058_conteos_iniciales WHERE relacion = v_relacion;

        EXECUTE pg_catalog.format('SELECT pg_catalog.count(*) FROM public.%I', v_relacion)
        INTO v_despues;

        IF v_despues <> v_antes.cantidad THEN
            RAISE EXCEPTION 'Autoverificación EPT-58 A: % cambió de % a % filas.',
                v_relacion, v_antes.cantidad, v_despues;
        END IF;
    END LOOP;

    SELECT pg_catalog.md5(COALESCE(pg_catalog.string_agg(
               pg_catalog.concat_ws('|', id, user_id, rol_id, nombre, apellido, dni,
                                    direccion, telefono, legajo_nro, fecha_nacimiento),
               ';' ORDER BY id), ''))
    INTO v_huella FROM public.perfiles;
    IF v_huella <> (SELECT huella FROM ept_058_conteos_iniciales WHERE relacion = 'perfiles') THEN
        RAISE EXCEPTION 'Autoverificación EPT-58 A: cambió el contenido de public.perfiles.';
    END IF;

    SELECT pg_catalog.md5(COALESCE(pg_catalog.string_agg(
               pg_catalog.concat_ws('|', id, materia_id, curso_id, profesor_id, activo,
                                    fecha_creacion, fecha_actualizacion),
               ';' ORDER BY id), ''))
    INTO v_huella FROM public.materias_cursos;
    IF v_huella <> (SELECT huella FROM ept_058_conteos_iniciales WHERE relacion = 'materias_cursos') THEN
        RAISE EXCEPTION 'Autoverificación EPT-58 A: cambió el contenido de public.materias_cursos.';
    END IF;

    SELECT pg_catalog.md5(COALESCE(pg_catalog.string_agg(
               pg_catalog.concat_ws('|', id, deporte_id, nivel_id, nombre, cupo, profesor_id,
                                    activo, fecha_creacion, fecha_actualizacion),
               ';' ORDER BY id), ''))
    INTO v_huella FROM public.grupos_deportivos;
    IF v_huella <> (SELECT huella FROM ept_058_conteos_iniciales WHERE relacion = 'grupos_deportivos') THEN
        RAISE EXCEPTION 'Autoverificación EPT-58 A: cambió el contenido de public.grupos_deportivos.';
    END IF;

    -- 13.2 Backfill 1:1 solo de DOCENTE, ACTIVO, sin datos inventados.
    SELECT pg_catalog.count(*) INTO v_docentes
    FROM public.perfiles p JOIN public.roles r ON r.id = p.rol_id
    WHERE r.nombre = 'DOCENTE';

    SELECT pg_catalog.count(*) INTO v_fichas FROM public.profesores;

    IF v_fichas <> v_docentes THEN
        RAISE EXCEPTION 'Autoverificación EPT-58 A: % ficha(s) para % perfil(es) DOCENTE.',
            v_fichas, v_docentes;
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.profesores pr
        JOIN public.perfiles p ON p.id = pr.perfil_id
        LEFT JOIN public.roles r ON r.id = p.rol_id
        WHERE r.nombre IS DISTINCT FROM 'DOCENTE'
           OR pr.estado <> 'ACTIVO'
           OR pr.especialidad IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'Autoverificación EPT-58 A: hay fichas de otro rol, no ACTIVO o con especialidad inventada.';
    END IF;

    IF EXISTS (SELECT 1 FROM public.profesores_estados_historial) THEN
        RAISE EXCEPTION 'Autoverificación EPT-58 A: la migración no debe escribir historial.';
    END IF;

    -- 13.3 Ningún privilegio de escritura directa; anon sin lectura.
    FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
        FOREACH v_tabla IN ARRAY ARRAY['public.profesores', 'public.profesores_estados_historial'] LOOP
            FOREACH v_privilegio IN ARRAY ARRAY[
                'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
            ] LOOP
                IF pg_catalog.has_table_privilege(v_rol, v_tabla, v_privilegio) THEN
                    RAISE EXCEPTION 'Autoverificación EPT-58 A: % conserva % sobre %.',
                        v_rol, v_privilegio, v_tabla;
                END IF;
            END LOOP;
        END LOOP;

        IF pg_catalog.has_sequence_privilege(v_rol, 'public.profesores_estados_historial_id_seq', 'USAGE')
           OR pg_catalog.has_sequence_privilege(v_rol, 'public.profesores_estados_historial_id_seq', 'UPDATE') THEN
            RAISE EXCEPTION 'Autoverificación EPT-58 A: % puede usar la secuencia del historial.', v_rol;
        END IF;
    END LOOP;

    IF pg_catalog.has_table_privilege('anon', 'public.profesores', 'SELECT')
       OR pg_catalog.has_table_privilege('anon', 'public.profesores_estados_historial', 'SELECT') THEN
        RAISE EXCEPTION 'Autoverificación EPT-58 A: anon puede leer objetos de profesores.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_class
        WHERE oid IN ('public.profesores'::pg_catalog.regclass,
                      'public.profesores_estados_historial'::pg_catalog.regclass)
          AND NOT relrowsecurity
    ) THEN
        RAISE EXCEPTION 'Autoverificación EPT-58 A: una tabla nueva no tiene RLS.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_policies
        WHERE schemaname = 'public'
          AND tablename IN ('profesores', 'profesores_estados_historial')
          AND cmd <> 'SELECT'
    ) THEN
        RAISE EXCEPTION 'Autoverificación EPT-58 A: existe una política de escritura sobre profesores.';
    END IF;

    -- 13.4 Funciones: search_path vacío, DEFINER solo en app_private, nada
    -- ejecutable por anon.
    IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('public', 'app_private')
          AND p.proname IN (
              'normalizar_especialidad', 'especialidad_valida', 'normalizar_motivo_estado',
              'motivo_estado_valido', 'impedir_cambios_historial_profesor',
              'registrar_profesor_de_perfil', 'exigir_profesor_activo', 'profesor_consultable',
              'listar_profesores', 'consultar_ficha_profesor', 'listar_asignaciones_profesor',
              'listar_horarios_profesor', 'listar_historial_estados_profesor',
              'listar_estudiantes_para_gestion', 'actualizar_ficha_profesor',
              'cambiar_estado_profesor'
          )
          AND (
              p.proconfig IS DISTINCT FROM ARRAY['search_path=""']
              OR (n.nspname = 'public' AND p.prosecdef)
              OR pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
          )
    ) THEN
        RAISE EXCEPTION
            'Autoverificación EPT-58 A: una función de profesores no fija search_path vacío, es SECURITY DEFINER en public o es ejecutable por anon.';
    END IF;

    -- 13.5 La lectura global de perfiles NO se toca en la etapa A.
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_policies
        WHERE schemaname = 'public' AND tablename = 'perfiles'
          AND policyname = 'Directores y docentes ven todos los perfiles'
    ) THEN
        RAISE EXCEPTION 'Autoverificación EPT-58 A: la política amplia de perfiles debe seguir vigente hasta la migración B.';
    END IF;

    RAISE NOTICE 'Migración EPT-58 A: % ficha(s) de profesor incorporada(s) desde perfiles DOCENTE.', v_fichas;
END $$;
