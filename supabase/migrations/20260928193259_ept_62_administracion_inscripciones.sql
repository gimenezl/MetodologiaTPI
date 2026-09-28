-- ============================================================
-- EDUCAR PARA TRANSFORMAR — Administración de inscripciones (EPT-62, RF16)
-- ============================================================
-- Migración aditiva. No modifica ni renumera 001 a 016, ni las de EPT-57,
-- EPT-58, EPT-59, EPT-60 ni EPT-61.
--
-- RF16 pide consultar, confirmar, cancelar y controlar la unicidad de las
-- inscripciones académicas, deportivas y de servicios. Son TRES modelos con
-- esquemas y reglas distintos, y esta migración NO los funde en una tabla
-- única de inscripciones:
--
--   * académico  → public.matriculas              (008, 009, 016)
--   * deportivo  → public.inscripciones_deportivas (014, 015)
--   * servicios  → public.inscripciones_servicios  (013; comedor y, desde 20260927220114,
--                                                   transporte, distinguidos por
--                                                   servicios_escolares.tipo)
--
-- El modelo legado public.inscripciones (actividades CURRICULAR/TALLER) queda
-- FUERA de esta migración: no se lee, no se modifica y no se afirma nada sobre
-- su historial.
--
-- ============================================================
-- DECISIONES DE PRODUCTO APROBADAS (contrato de esta migración)
-- ============================================================
--   1. «Confirmar» es una acción administrativa REAL y registrada, distinta de
--      «consultar». Solo Dirección confirma una inscripción vigente. Se
--      persiste quién y cuándo, y solo Dirección puede consultarlo.
--   2. La confirmación es POSTERIOR al alta y NO condiciona la vigencia ni el
--      derecho de uso: las altas siguen dejando la matrícula o la inscripción
--      activa de inmediato. Ningún flujo existente consulta la confirmación.
--   3. Confirmar dos veces es idempotente: no cambia a la primera persona ni la
--      primera fecha. Una inscripción cancelada o una matrícula cerrada no se
--      confirma. Si se confirma y luego se cancela o se cierra, la marca
--      histórica se conserva.
--   4. Dirección cancela, en nombre del alumno, inscripciones de SERVICIOS y de
--      DEPORTES mediante operaciones administrativas NUEVAS. Las RPC de
--      cancelación propia (013, 014) no se tocan: siguen exigiendo ESTUDIANTE y
--      auth.uid() propietario.
--   5. Matrícula académica: NO se inventa una cancelación. El cierre
--      administrativo se efectúa con el flujo vigente de 008 (inactivar_alumno o
--      cambiar_curso_alumno), que cierra la matrícula con su motivo y mantiene
--      el invariante «alumno ACTIVO ⇔ exactamente una matrícula vigente».
--   6. Sin borrado físico en ninguno de los tres modelos.
--
-- ============================================================
-- ALMACENAMIENTO DE LA CONFIRMACIÓN: TABLA DE AUDITORÍA PROPIA
-- ============================================================
-- Alternativa descartada: columnas `confirmada_por` / `confirmada_en` en las
-- tres tablas de inscripción. Esas tablas conceden SELECT a `authenticated`
-- fila a fila (el alumno ve las suyas): una columna nueva se filtraría a cada
-- alumno, con el perfil de la persona de Dirección que confirmó. Restringirla
-- exigiría privilegios por columna y reescribir las vistas de 013, 014 y 008.
--
-- Elegida: `public.confirmaciones_inscripcion`, append-only, con RLS de lectura
-- SOLO para Dirección. Cada fila identifica inequívocamente la inscripción con
-- una clave foránea propia por dominio (exactamente una no nula, garantizado
-- por un CHECK) y ON DELETE RESTRICT; un índice único por clave garantiza como
-- máximo UNA confirmación por inscripción. El historial se conserva aunque la
-- inscripción se cancele o la matrícula se cierre.
--
-- ============================================================
-- ORDEN DE BLOQUEOS Y CARRERAS
-- ============================================================
-- Todas las operaciones de esta migración bloquean primero LA FILA de la
-- inscripción (`FOR UPDATE`), el mismo bloqueo que toma la cancelación propia
-- (013/014) al hacer UPDATE, y solo después lo que su trigger necesite
-- (alumno y grupo en deportes: 015). Es el orden fila → alumno → grupo que ya
-- sigue la baja del alumno, así que no se agregan ciclos de espera.
--
--   * Confirmar y cancelar/cerrar la misma fila se serializan por ese bloqueo:
--     si gana la confirmación, la baja procede y la marca se conserva; si gana
--     la baja, la confirmación relee la fila y se rechaza (P6202).
--   * Dos confirmaciones simultáneas: la segunda espera, encuentra la
--     confirmación de la primera y la devuelve sin cambiarla.
--   * Dos cancelaciones administrativas simultáneas: la segunda espera y se
--     rechaza con P6203 (ya cancelada). Ninguna baja se aplica dos veces.
--   * Cancelar frente a un alta nueva: la unicidad, el cupo y el límite siguen
--     decididos por los triggers y los índices de 013/014/015, que no se
--     modifican.
--   * Cerrar una matrícula (008) toma `alumnos` y luego la fila de la
--     matrícula; confirmar toma solo la fila de la matrícula: no hay ciclo.
--
-- ============================================================
-- CÓDIGOS SQLSTATE PROPIOS
-- ============================================================
-- Bloque nuevo P6201–P6204, sin colisión con P550x–P561x (006–EPT-58/59/61),
-- P590x–P597x (EPT-59/60/61).
--   P6201  la inscripción o la matrícula no existe (o no es del tipo pedido)
--   P6202  la inscripción está cancelada o la matrícula cerrada: no se confirma
--   P6203  la inscripción ya estaba cancelada
--   P6204  la confirmación es un registro histórico protegido
-- Reutilizados: P5505 (identidad ausente) y 42501 (rol insuficiente).
--
-- ============================================================
-- REVERSIÓN NO DESTRUCTIVA
-- ============================================================
-- Esta migración no cambia ninguna fila ni ningún trigger de las tablas
-- existentes. Revertir el comportamiento sin perder la auditoría:
--
--   DROP FUNCTION public.confirmar_matricula(uuid);
--   DROP FUNCTION public.confirmar_inscripcion_deportiva(uuid);
--   DROP FUNCTION public.confirmar_inscripcion_servicio(uuid, public.tipo_servicio_escolar);
--   DROP FUNCTION public.cancelar_inscripcion_deportiva_administrativa(uuid);
--   DROP FUNCTION public.cancelar_inscripcion_servicio_administrativa(uuid, public.tipo_servicio_escolar);
--   DROP FUNCTION app_private.confirmar_matricula(uuid);
--   DROP FUNCTION app_private.confirmar_inscripcion_deportiva(uuid);
--   DROP FUNCTION app_private.confirmar_inscripcion_servicio(uuid, public.tipo_servicio_escolar);
--   DROP FUNCTION app_private.cancelar_inscripcion_deportiva_administrativa(uuid);
--   DROP FUNCTION app_private.cancelar_inscripcion_servicio_administrativa(uuid, public.tipo_servicio_escolar);
--   DROP VIEW public.matriculas_administracion;
--   DROP VIEW public.inscripciones_deportivas_administracion;
--   DROP VIEW public.inscripciones_servicios_administracion;
--
-- La tabla `confirmaciones_inscripcion` y su tipo se CONSERVAN: soltarlos
-- destruiría el registro de quién confirmó. Las bajas administrativas ya
-- aplicadas son cancelaciones lógicas ordinarias y no se revierten.
-- ============================================================


-- ================================================================
-- 1. PRECONDICIONES Y HUELLAS DE PRESERVACIÓN
-- ================================================================
DO $$
BEGIN
    IF pg_catalog.to_regclass('public.matriculas') IS NULL
       OR pg_catalog.to_regclass('public.inscripciones_deportivas') IS NULL
       OR pg_catalog.to_regclass('public.inscripciones_servicios') IS NULL
       OR pg_catalog.to_regclass('public.servicios_escolares') IS NULL
       OR pg_catalog.to_regclass('public.perfiles') IS NULL
       OR pg_catalog.to_regclass('public.cursos') IS NULL
       OR pg_catalog.to_regclass('public.niveles') IS NULL
       OR pg_catalog.to_regclass('public.alumnos') IS NULL
    THEN
        RAISE EXCEPTION
            'Migración EPT-62: faltan tablas base; la base no corresponde a 001–016 + EPT-57/58/59/60/61.';
    END IF;

    IF pg_catalog.to_regprocedure('app_private.es_director()') IS NULL
       OR pg_catalog.to_regprocedure('app_private.perfil_actual()') IS NULL
       OR pg_catalog.to_regprocedure('app_private.acceso_bloqueado()') IS NULL
       OR pg_catalog.to_regprocedure('public.es_director_actual()') IS NULL
       OR pg_catalog.to_regprocedure('app_private.validar_inscripcion_servicio()') IS NULL
       OR pg_catalog.to_regprocedure('app_private.validar_inscripcion_deportiva()') IS NULL
    THEN
        RAISE EXCEPTION
            'Migración EPT-62: faltan funciones de 003–015 o EPT-59; la base no corresponde a lo esperado.';
    END IF;

    IF pg_catalog.to_regclass('public.confirmaciones_inscripcion') IS NOT NULL
       OR pg_catalog.to_regtype('public.dominio_inscripcion') IS NOT NULL
    THEN
        RAISE EXCEPTION
            'Migración EPT-62: ya existe el registro de confirmaciones; revisá el estado de la base antes de continuar.';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('public', 'app_private')
          AND p.proname IN ('confirmar_matricula', 'confirmar_inscripcion_deportiva',
                            'confirmar_inscripcion_servicio',
                            'cancelar_inscripcion_deportiva_administrativa',
                            'cancelar_inscripcion_servicio_administrativa')
    ) THEN
        RAISE EXCEPTION
            'Migración EPT-62: ya existen objetos de administración de inscripciones; revisá el estado de la base antes de continuar.';
    END IF;
END $$;

-- Esta migración no escribe ninguna de estas tres tablas: se comparan al final
-- por cantidad y por huella de contenido.
CREATE TEMPORARY TABLE ept_062_conteos_iniciales (
    relacion TEXT PRIMARY KEY,
    cantidad BIGINT NOT NULL,
    huella   TEXT NOT NULL
) ON COMMIT DROP;

INSERT INTO ept_062_conteos_iniciales (relacion, cantidad, huella)
VALUES
    ('matriculas',
        (SELECT pg_catalog.count(*) FROM public.matriculas),
        (SELECT pg_catalog.md5(COALESCE(pg_catalog.string_agg(
             pg_catalog.concat_ws('|', id, alumno_id, curso_id, fecha_inicio, fecha_cierre, motivo_cierre),
             ';' ORDER BY id), ''))
         FROM public.matriculas)),
    ('inscripciones_deportivas',
        (SELECT pg_catalog.count(*) FROM public.inscripciones_deportivas),
        (SELECT pg_catalog.md5(COALESCE(pg_catalog.string_agg(
             pg_catalog.concat_ws('|', id, alumno_id, grupo_id, deporte_id, estado,
                                  fecha_inscripcion, fecha_cancelacion),
             ';' ORDER BY id), ''))
         FROM public.inscripciones_deportivas)),
    ('inscripciones_servicios',
        (SELECT pg_catalog.count(*) FROM public.inscripciones_servicios),
        (SELECT pg_catalog.md5(COALESCE(pg_catalog.string_agg(
             pg_catalog.concat_ws('|', id, alumno_id, servicio_id, estado,
                                  fecha_inscripcion, fecha_cancelacion),
             ';' ORDER BY id), ''))
         FROM public.inscripciones_servicios));


-- ================================================================
-- 2. REGISTRO DE CONFIRMACIONES
-- ================================================================
CREATE TYPE public.dominio_inscripcion AS ENUM ('MATRICULA', 'DEPORTE', 'SERVICIO');

CREATE TABLE public.confirmaciones_inscripcion (
    id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
    dominio public.dominio_inscripcion NOT NULL,
    -- Una clave foránea por dominio: la integridad referencial la garantiza la
    -- base y no una convención. ON DELETE RESTRICT: una inscripción confirmada
    -- no puede desaparecer, ni siquiera por el propietario.
    matricula_id UUID
        REFERENCES public.matriculas(id) ON DELETE RESTRICT,
    inscripcion_deportiva_id UUID
        REFERENCES public.inscripciones_deportivas(id) ON DELETE RESTRICT,
    inscripcion_servicio_id UUID
        REFERENCES public.inscripciones_servicios(id) ON DELETE RESTRICT,
    -- Perfil de la persona de Dirección que confirmó. Lo deriva la función de
    -- `auth.uid()`; ninguna operación lo recibe como parámetro.
    confirmada_por UUID NOT NULL
        REFERENCES public.perfiles(id) ON DELETE RESTRICT,
    confirmada_en TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT confirmaciones_inscripcion_un_solo_destino CHECK (
        (dominio = 'MATRICULA'
            AND matricula_id IS NOT NULL
            AND inscripcion_deportiva_id IS NULL
            AND inscripcion_servicio_id IS NULL)
        OR (dominio = 'DEPORTE'
            AND inscripcion_deportiva_id IS NOT NULL
            AND matricula_id IS NULL
            AND inscripcion_servicio_id IS NULL)
        OR (dominio = 'SERVICIO'
            AND inscripcion_servicio_id IS NOT NULL
            AND matricula_id IS NULL
            AND inscripcion_deportiva_id IS NULL)
    )
);

COMMENT ON TABLE public.confirmaciones_inscripcion IS
    'Registro append-only de las confirmaciones administrativas de Dirección sobre matrículas, inscripciones deportivas e inscripciones a servicios. Como máximo una por inscripción. Solo Dirección la consulta. La confirmación es posterior al alta y no condiciona la vigencia.';
COMMENT ON COLUMN public.confirmaciones_inscripcion.confirmada_por IS
    'Perfil de Dirección que confirmó. Dato interno: nunca se expone al alumno, al padre ni al docente.';

-- Como máximo UNA confirmación por inscripción: es la autoridad de la
-- idempotencia ante dos confirmaciones concurrentes. Cada índice también cubre
-- la clave foránea correspondiente.
CREATE UNIQUE INDEX idx_confirmaciones_inscripcion_matricula
    ON public.confirmaciones_inscripcion (matricula_id)
    WHERE matricula_id IS NOT NULL;
CREATE UNIQUE INDEX idx_confirmaciones_inscripcion_deportiva
    ON public.confirmaciones_inscripcion (inscripcion_deportiva_id)
    WHERE inscripcion_deportiva_id IS NOT NULL;
CREATE UNIQUE INDEX idx_confirmaciones_inscripcion_servicio
    ON public.confirmaciones_inscripcion (inscripcion_servicio_id)
    WHERE inscripcion_servicio_id IS NOT NULL;

-- Índice de la clave foránea hacia perfiles (consulta «qué confirmó esta persona»).
CREATE INDEX idx_confirmaciones_inscripcion_confirmada_por
    ON public.confirmaciones_inscripcion (confirmada_por);


-- ================================================================
-- 3. INVARIANTES DEL REGISTRO
-- ================================================================
-- Defensa en profundidad: aunque el único camino de escritura sean las
-- funciones de la sección 4, la base rechaza por sí misma
--   * confirmar algo que no está vigente;
--   * modificar o borrar una confirmación ya registrada.
-- La fecha la sella la base, no quien escribe.
CREATE OR REPLACE FUNCTION app_private.proteger_confirmacion_inscripcion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_vigente BOOLEAN;
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P6204',
            MESSAGE = 'La confirmación de una inscripción es un registro histórico y no puede modificarse ni eliminarse.';
    END IF;

    -- TG_OP = 'INSERT'. La vigencia se lee con la fila bloqueada FOR SHARE,
    -- de modo que una baja en curso se ordene antes o después de la marca.
    IF NEW.dominio = 'MATRICULA' THEN
        SELECT (m.fecha_cierre IS NULL) INTO v_vigente
        FROM public.matriculas m
        WHERE m.id = NEW.matricula_id
        FOR SHARE;
    ELSIF NEW.dominio = 'DEPORTE' THEN
        SELECT (i.estado = 'ACTIVA') INTO v_vigente
        FROM public.inscripciones_deportivas i
        WHERE i.id = NEW.inscripcion_deportiva_id
        FOR SHARE;
    ELSE
        SELECT (i.estado = 'ACTIVA') INTO v_vigente
        FROM public.inscripciones_servicios i
        WHERE i.id = NEW.inscripcion_servicio_id
        FOR SHARE;
    END IF;

    -- Si la fila no existe, la clave foránea conserva su SQLSTATE 23503.
    IF v_vigente IS NOT NULL AND NOT v_vigente THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P6202',
            MESSAGE = 'Una inscripción cancelada o una matrícula cerrada no puede confirmarse.';
    END IF;

    NEW.confirmada_en := pg_catalog.now();
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.proteger_confirmacion_inscripcion()
    FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER proteger_confirmacion_inscripcion_antes_de_escribir
    BEFORE INSERT OR UPDATE OR DELETE ON public.confirmaciones_inscripcion
    FOR EACH ROW
    EXECUTE FUNCTION app_private.proteger_confirmacion_inscripcion();


-- ================================================================
-- 4. OPERACIONES PRIVILEGIADAS
-- ================================================================
-- Viven en `app_private` (la Data API no las expone). Todas verifican
-- `auth.uid()` y el rol DIRECTOR dentro de la base, en ese orden y antes de
-- mirar cualquier otro dato, para no revelar la existencia de filas a quien
-- no administra. Ninguna recibe actor, rol, usuario, perfil ni alumno: lo único
-- que reciben es el identificador de la inscripción (y, en servicios, el tipo
-- para no operar un recorrido de transporte desde una ruta del comedor).
-- Cada una es una transacción completa: un rechazo no deja nada persistido.

-- ----------------------------------------------------------------
-- 4.1 Confirmar una matrícula
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.confirmar_matricula(p_matricula_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_cierre       TIMESTAMP WITH TIME ZONE;
    v_confirmacion public.confirmaciones_inscripcion;
    v_ya           BOOLEAN := TRUE;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    IF NOT app_private.es_director() THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Solo la dirección puede confirmar matrículas.';
    END IF;

    IF p_matricula_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P6201', MESSAGE = 'La matrícula solicitada no existe.';
    END IF;

    -- Bloqueo de la fila: serializa con el cierre (inactivación o cambio de
    -- curso) y con otra confirmación. `fecha_cierre` se lee DESPUÉS de esperar,
    -- así que refleja un cierre que confirmó mientras tanto.
    SELECT m.fecha_cierre INTO v_cierre
    FROM public.matriculas m
    WHERE m.id = p_matricula_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P6201', MESSAGE = 'La matrícula solicitada no existe.';
    END IF;

    IF v_cierre IS NOT NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P6202',
            MESSAGE = 'La matrícula ya está cerrada y no puede confirmarse.';
    END IF;

    SELECT c.* INTO v_confirmacion
    FROM public.confirmaciones_inscripcion c
    WHERE c.matricula_id = p_matricula_id;

    IF NOT FOUND THEN
        v_ya := FALSE;
        INSERT INTO public.confirmaciones_inscripcion (dominio, matricula_id, confirmada_por)
        VALUES ('MATRICULA', p_matricula_id, app_private.perfil_actual())
        RETURNING * INTO v_confirmacion;
    END IF;

    RETURN app_private.describir_confirmacion(v_confirmacion, p_matricula_id, v_ya);
END;
$$;

-- Proyección estable de una confirmación para el servidor. Se declara antes de
-- su uso en tiempo de ejecución; PL/pgSQL resuelve el nombre al ejecutar.
CREATE OR REPLACE FUNCTION app_private.describir_confirmacion(
    p_confirmacion public.confirmaciones_inscripcion,
    p_inscripcion_id UUID,
    p_ya_confirmada BOOLEAN
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT pg_catalog.jsonb_build_object(
        'dominio', p_confirmacion.dominio,
        'inscripcion_id', p_inscripcion_id,
        'confirmada_en', p_confirmacion.confirmada_en,
        'confirmada_por_nombre',
            (SELECT pg_catalog.concat_ws(' ', p.nombre, p.apellido)
             FROM public.perfiles p WHERE p.id = p_confirmacion.confirmada_por),
        'ya_confirmada', p_ya_confirmada
    );
$$;

-- ----------------------------------------------------------------
-- 4.2 Confirmar una inscripción deportiva
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.confirmar_inscripcion_deportiva(p_inscripcion_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_estado       public.estado_inscripcion_deportiva;
    v_confirmacion public.confirmaciones_inscripcion;
    v_ya           BOOLEAN := TRUE;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    IF NOT app_private.es_director() THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Solo la dirección puede confirmar inscripciones deportivas.';
    END IF;

    IF p_inscripcion_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P6201', MESSAGE = 'La inscripción solicitada no existe.';
    END IF;

    SELECT i.estado INTO v_estado
    FROM public.inscripciones_deportivas i
    WHERE i.id = p_inscripcion_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P6201', MESSAGE = 'La inscripción solicitada no existe.';
    END IF;

    IF v_estado <> 'ACTIVA' THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P6202',
            MESSAGE = 'La inscripción está cancelada y no puede confirmarse.';
    END IF;

    SELECT c.* INTO v_confirmacion
    FROM public.confirmaciones_inscripcion c
    WHERE c.inscripcion_deportiva_id = p_inscripcion_id;

    IF NOT FOUND THEN
        v_ya := FALSE;
        INSERT INTO public.confirmaciones_inscripcion
            (dominio, inscripcion_deportiva_id, confirmada_por)
        VALUES ('DEPORTE', p_inscripcion_id, app_private.perfil_actual())
        RETURNING * INTO v_confirmacion;
    END IF;

    RETURN app_private.describir_confirmacion(v_confirmacion, p_inscripcion_id, v_ya);
END;
$$;

-- ----------------------------------------------------------------
-- 4.3 Confirmar una inscripción a un servicio (comedor o transporte)
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.confirmar_inscripcion_servicio(
    p_inscripcion_id UUID,
    p_tipo           public.tipo_servicio_escolar
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_estado       public.estado_inscripcion_servicio;
    v_confirmacion public.confirmaciones_inscripcion;
    v_ya           BOOLEAN := TRUE;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    IF NOT app_private.es_director() THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Solo la dirección puede confirmar inscripciones a servicios.';
    END IF;

    IF p_inscripcion_id IS NULL OR p_tipo IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P6201', MESSAGE = 'La inscripción solicitada no existe.';
    END IF;

    -- Una inscripción de otro tipo de servicio responde igual que una
    -- inexistente: la ruta del comedor no opera sobre el transporte.
    SELECT i.estado INTO v_estado
    FROM public.inscripciones_servicios i
    JOIN public.servicios_escolares s ON s.id = i.servicio_id
    WHERE i.id = p_inscripcion_id
      AND s.tipo = p_tipo
    FOR UPDATE OF i;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P6201', MESSAGE = 'La inscripción solicitada no existe.';
    END IF;

    IF v_estado <> 'ACTIVA' THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P6202',
            MESSAGE = 'La inscripción está cancelada y no puede confirmarse.';
    END IF;

    SELECT c.* INTO v_confirmacion
    FROM public.confirmaciones_inscripcion c
    WHERE c.inscripcion_servicio_id = p_inscripcion_id;

    IF NOT FOUND THEN
        v_ya := FALSE;
        INSERT INTO public.confirmaciones_inscripcion
            (dominio, inscripcion_servicio_id, confirmada_por)
        VALUES ('SERVICIO', p_inscripcion_id, app_private.perfil_actual())
        RETURNING * INTO v_confirmacion;
    END IF;

    RETURN app_private.describir_confirmacion(v_confirmacion, p_inscripcion_id, v_ya);
END;
$$;

-- ----------------------------------------------------------------
-- 4.4 Cancelación administrativa de una inscripción deportiva
-- ----------------------------------------------------------------
-- No llama a `cancelar_inscripcion_deportiva` (014): esa exige ESTUDIANTE y
-- alumno propietario, y debe seguir haciéndolo. Las reglas de la baja (bloqueo
-- de alumno y grupo, sellado de `fecha_cancelacion`, transición única) las
-- aplica el trigger `validar_inscripcion_deportiva` de 015 sobre el mismo
-- UPDATE, exactamente como en la baja propia.
CREATE OR REPLACE FUNCTION app_private.cancelar_inscripcion_deportiva_administrativa(
    p_inscripcion_id UUID
)
RETURNS public.inscripciones_deportivas
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_estado      public.estado_inscripcion_deportiva;
    v_inscripcion public.inscripciones_deportivas;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    IF NOT app_private.es_director() THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Solo la dirección puede cancelar inscripciones deportivas en nombre de un alumno.';
    END IF;

    IF p_inscripcion_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P6201', MESSAGE = 'La inscripción solicitada no existe.';
    END IF;

    SELECT i.estado INTO v_estado
    FROM public.inscripciones_deportivas i
    WHERE i.id = p_inscripcion_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P6201', MESSAGE = 'La inscripción solicitada no existe.';
    END IF;

    IF v_estado = 'CANCELADA' THEN
        RAISE EXCEPTION USING ERRCODE = 'P6203', MESSAGE = 'La inscripción ya estaba cancelada.';
    END IF;

    UPDATE public.inscripciones_deportivas
    SET estado = 'CANCELADA'
    WHERE id = p_inscripcion_id
    RETURNING * INTO v_inscripcion;

    RETURN v_inscripcion;
END;
$$;

-- ----------------------------------------------------------------
-- 4.5 Cancelación administrativa de una inscripción a un servicio
-- ----------------------------------------------------------------
-- No llama a `cancelar_inscripcion_servicio` (013): exige ESTUDIANTE y alumno
-- propietario. El sellado de la fecha y la transición única los aplica el
-- trigger `validar_inscripcion_servicio` (013/EPT-60) sobre el mismo UPDATE.
CREATE OR REPLACE FUNCTION app_private.cancelar_inscripcion_servicio_administrativa(
    p_inscripcion_id UUID,
    p_tipo           public.tipo_servicio_escolar
)
RETURNS public.inscripciones_servicios
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_estado      public.estado_inscripcion_servicio;
    v_inscripcion public.inscripciones_servicios;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    IF NOT app_private.es_director() THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Solo la dirección puede cancelar inscripciones a servicios en nombre de un alumno.';
    END IF;

    IF p_inscripcion_id IS NULL OR p_tipo IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P6201', MESSAGE = 'La inscripción solicitada no existe.';
    END IF;

    SELECT i.estado INTO v_estado
    FROM public.inscripciones_servicios i
    JOIN public.servicios_escolares s ON s.id = i.servicio_id
    WHERE i.id = p_inscripcion_id
      AND s.tipo = p_tipo
    FOR UPDATE OF i;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P6201', MESSAGE = 'La inscripción solicitada no existe.';
    END IF;

    IF v_estado = 'CANCELADA' THEN
        RAISE EXCEPTION USING ERRCODE = 'P6203', MESSAGE = 'La inscripción ya estaba cancelada.';
    END IF;

    UPDATE public.inscripciones_servicios
    SET estado = 'CANCELADA'
    WHERE id = p_inscripcion_id
    RETURNING * INTO v_inscripcion;

    RETURN v_inscripcion;
END;
$$;

REVOKE ALL ON FUNCTION app_private.describir_confirmacion(public.confirmaciones_inscripcion, UUID, BOOLEAN)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.confirmar_matricula(UUID)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.confirmar_inscripcion_deportiva(UUID)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.confirmar_inscripcion_servicio(UUID, public.tipo_servicio_escolar)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.cancelar_inscripcion_deportiva_administrativa(UUID)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.cancelar_inscripcion_servicio_administrativa(UUID, public.tipo_servicio_escolar)
    FROM PUBLIC, anon, authenticated, service_role;

-- `describir_confirmacion` la invocan las otras funciones como propietario:
-- no necesita EXECUTE para ningún rol de aplicación. Las cinco operaciones sí
-- lo necesitan para los envoltorios SECURITY INVOKER.
GRANT EXECUTE ON FUNCTION app_private.confirmar_matricula(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.confirmar_inscripcion_deportiva(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.confirmar_inscripcion_servicio(UUID, public.tipo_servicio_escolar)
    TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.cancelar_inscripcion_deportiva_administrativa(UUID)
    TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.cancelar_inscripcion_servicio_administrativa(UUID, public.tipo_servicio_escolar)
    TO authenticated;


-- ================================================================
-- 5. ENVOLTORIOS PÚBLICOS PARA POSTGREST
-- ================================================================
CREATE OR REPLACE FUNCTION public.confirmar_matricula(p_matricula_id UUID)
RETURNS JSONB
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT app_private.confirmar_matricula(p_matricula_id);
$$;

CREATE OR REPLACE FUNCTION public.confirmar_inscripcion_deportiva(p_inscripcion_id UUID)
RETURNS JSONB
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT app_private.confirmar_inscripcion_deportiva(p_inscripcion_id);
$$;

CREATE OR REPLACE FUNCTION public.confirmar_inscripcion_servicio(
    p_inscripcion_id UUID,
    p_tipo           public.tipo_servicio_escolar
)
RETURNS JSONB
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT app_private.confirmar_inscripcion_servicio(p_inscripcion_id, p_tipo);
$$;

CREATE OR REPLACE FUNCTION public.cancelar_inscripcion_deportiva_administrativa(
    p_inscripcion_id UUID
)
RETURNS public.inscripciones_deportivas
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT * FROM app_private.cancelar_inscripcion_deportiva_administrativa(p_inscripcion_id);
$$;

CREATE OR REPLACE FUNCTION public.cancelar_inscripcion_servicio_administrativa(
    p_inscripcion_id UUID,
    p_tipo           public.tipo_servicio_escolar
)
RETURNS public.inscripciones_servicios
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT * FROM app_private.cancelar_inscripcion_servicio_administrativa(p_inscripcion_id, p_tipo);
$$;

-- Los privilegios por defecto de Supabase conceden EXECUTE sobre funciones
-- nuevas de `public` a anon; se parte de cero y se concede lo mínimo.
REVOKE ALL ON FUNCTION public.confirmar_matricula(UUID)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.confirmar_inscripcion_deportiva(UUID)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.confirmar_inscripcion_servicio(UUID, public.tipo_servicio_escolar)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cancelar_inscripcion_deportiva_administrativa(UUID)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cancelar_inscripcion_servicio_administrativa(UUID, public.tipo_servicio_escolar)
    FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.confirmar_matricula(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirmar_inscripcion_deportiva(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirmar_inscripcion_servicio(UUID, public.tipo_servicio_escolar)
    TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancelar_inscripcion_deportiva_administrativa(UUID)
    TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancelar_inscripcion_servicio_administrativa(UUID, public.tipo_servicio_escolar)
    TO authenticated;


-- ================================================================
-- 6. PRIVILEGIOS MÍNIMOS Y RLS DEL REGISTRO
-- ================================================================
ALTER TABLE public.confirmaciones_inscripcion ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.confirmaciones_inscripcion
    FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.confirmaciones_inscripcion TO authenticated;

-- Solo Dirección lee el registro. Un alumno, un padre o un docente no obtienen
-- un error que delate una confirmación: simplemente no hay filas.
CREATE POLICY "La dirección consulta las confirmaciones de inscripciones"
    ON public.confirmaciones_inscripcion
    FOR SELECT TO authenticated
    USING ((SELECT public.es_director_actual()));

-- Réplica de la política RESTRICTIVE de bloqueo de cuenta (EPT-59): esa
-- migración solo cubrió las tablas que existían entonces. Mismo predicado,
-- mismo nombre, mismo alcance FOR ALL.
CREATE POLICY "Bloqueo de acceso sin datos protegidos"
    ON public.confirmaciones_inscripcion
    AS RESTRICTIVE FOR ALL TO authenticated
    USING (NOT (SELECT app_private.acceso_bloqueado()))
    WITH CHECK (NOT (SELECT app_private.acceso_bloqueado()));

-- No se crea ninguna política INSERT, UPDATE ni DELETE permisiva. Aunque
-- alguien otorgara el privilegio por error, RLS seguiría rechazando la
-- escritura directa, y el trigger de la sección 3 rechazaría el resto.


-- ================================================================
-- 7. LECTURAS ADMINISTRATIVAS (una por dominio)
-- ================================================================
-- `security_invoker = true`: respetan RLS y privilegios de quien consulta. La
-- cláusula `es_director_actual()` es redundante con las políticas de las tablas
-- de origen (que ya limitan a un alumno a lo suyo) pero garantiza que ni siquiera
-- las filas propias de un alumno lleguen por esta vía, con o sin confirmación.
-- Incluyen las canceladas y las cerradas. Son la base reutilizable de las
-- lecturas del listado administrativo (y de EPT-63); no son un reporte.
CREATE VIEW public.matriculas_administracion
WITH (security_invoker = true) AS
SELECT
    m.id,
    m.alumno_id,
    p.nombre                       AS alumno_nombre,
    p.apellido                     AS alumno_apellido,
    p.legajo_nro,
    a.estado                       AS alumno_estado,
    c.id                           AS curso_id,
    c.denominacion                 AS curso_denominacion,
    c.division                     AS curso_division,
    n.id                           AS nivel_id,
    n.nombre                       AS nivel_nombre,
    m.fecha_inicio,
    m.fecha_cierre,
    m.motivo_cierre,
    (m.fecha_cierre IS NULL)       AS vigente,
    (k.id IS NOT NULL)             AS confirmada,
    k.confirmada_en,
    pc.nombre                      AS confirmada_por_nombre,
    pc.apellido                    AS confirmada_por_apellido
FROM public.matriculas m
JOIN public.alumnos a ON a.perfil_id = m.alumno_id
JOIN public.perfiles p ON p.id = m.alumno_id
JOIN public.cursos c ON c.id = m.curso_id
JOIN public.niveles n ON n.id = c.nivel_id
LEFT JOIN public.confirmaciones_inscripcion k ON k.matricula_id = m.id
LEFT JOIN public.perfiles pc ON pc.id = k.confirmada_por
WHERE (SELECT public.es_director_actual());

CREATE VIEW public.inscripciones_deportivas_administracion
WITH (security_invoker = true) AS
SELECT
    i.id,
    i.alumno_id,
    p.nombre                       AS alumno_nombre,
    p.apellido                     AS alumno_apellido,
    p.legajo_nro,
    a.estado                       AS alumno_estado,
    i.grupo_id,
    g.nombre                       AS grupo_nombre,
    i.deporte_id,
    d.nombre                       AS deporte_nombre,
    g.nivel_id,
    n.nombre                       AS nivel_nombre,
    i.estado,
    i.fecha_inscripcion,
    i.fecha_cancelacion,
    (k.id IS NOT NULL)             AS confirmada,
    k.confirmada_en,
    pc.nombre                      AS confirmada_por_nombre,
    pc.apellido                    AS confirmada_por_apellido
FROM public.inscripciones_deportivas i
JOIN public.alumnos a ON a.perfil_id = i.alumno_id
JOIN public.perfiles p ON p.id = i.alumno_id
JOIN public.grupos_deportivos g ON g.id = i.grupo_id
JOIN public.deportes d ON d.id = i.deporte_id
JOIN public.niveles n ON n.id = g.nivel_id
LEFT JOIN public.confirmaciones_inscripcion k ON k.inscripcion_deportiva_id = i.id
LEFT JOIN public.perfiles pc ON pc.id = k.confirmada_por
WHERE (SELECT public.es_director_actual());

CREATE VIEW public.inscripciones_servicios_administracion
WITH (security_invoker = true) AS
SELECT
    i.id,
    i.alumno_id,
    p.nombre                       AS alumno_nombre,
    p.apellido                     AS alumno_apellido,
    p.legajo_nro,
    a.estado                       AS alumno_estado,
    i.servicio_id,
    s.tipo                         AS servicio_tipo,
    s.codigo                       AS servicio_codigo,
    s.nombre                       AS servicio_nombre,
    s.activo                       AS servicio_activo,
    i.estado,
    i.fecha_inscripcion,
    i.fecha_cancelacion,
    (k.id IS NOT NULL)             AS confirmada,
    k.confirmada_en,
    pc.nombre                      AS confirmada_por_nombre,
    pc.apellido                    AS confirmada_por_apellido
FROM public.inscripciones_servicios i
JOIN public.alumnos a ON a.perfil_id = i.alumno_id
JOIN public.perfiles p ON p.id = i.alumno_id
JOIN public.servicios_escolares s ON s.id = i.servicio_id
LEFT JOIN public.confirmaciones_inscripcion k ON k.inscripcion_servicio_id = i.id
LEFT JOIN public.perfiles pc ON pc.id = k.confirmada_por
WHERE (SELECT public.es_director_actual());

COMMENT ON VIEW public.matriculas_administracion IS
    'Matrículas (vigentes y cerradas) con alumno, curso, nivel y estado de confirmación. Solo Dirección obtiene filas.';
COMMENT ON VIEW public.inscripciones_deportivas_administracion IS
    'Inscripciones deportivas (activas y canceladas) con alumno, grupo, deporte, nivel y estado de confirmación. Solo Dirección obtiene filas.';
COMMENT ON VIEW public.inscripciones_servicios_administracion IS
    'Inscripciones a servicios escolares (comedor y transporte, activas y canceladas) con alumno, servicio y estado de confirmación. Solo Dirección obtiene filas.';

REVOKE ALL ON public.matriculas_administracion
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.inscripciones_deportivas_administracion
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.inscripciones_servicios_administracion
    FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON public.matriculas_administracion TO authenticated;
GRANT SELECT ON public.inscripciones_deportivas_administracion TO authenticated;
GRANT SELECT ON public.inscripciones_servicios_administracion TO authenticated;


-- ================================================================
-- 8. AUTOVERIFICACIÓN
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
    -- Ninguna fila de los tres modelos cambió.
    FOREACH v_relacion IN ARRAY ARRAY['matriculas', 'inscripciones_deportivas', 'inscripciones_servicios']
    LOOP
        SELECT cantidad, huella INTO v_antes
        FROM ept_062_conteos_iniciales WHERE relacion = v_relacion;

        EXECUTE pg_catalog.format('SELECT pg_catalog.count(*) FROM public.%I', v_relacion)
        INTO v_despues;

        IF v_despues <> v_antes.cantidad THEN
            RAISE EXCEPTION 'Autoverificación EPT-62: % cambió de % a % filas.',
                v_relacion, v_antes.cantidad, v_despues;
        END IF;
    END LOOP;

    SELECT pg_catalog.md5(COALESCE(pg_catalog.string_agg(
               pg_catalog.concat_ws('|', id, alumno_id, curso_id, fecha_inicio, fecha_cierre, motivo_cierre),
               ';' ORDER BY id), ''))
    INTO v_huella FROM public.matriculas;
    IF v_huella <> (SELECT huella FROM ept_062_conteos_iniciales WHERE relacion = 'matriculas') THEN
        RAISE EXCEPTION 'Autoverificación EPT-62: cambió el contenido de public.matriculas.';
    END IF;

    SELECT pg_catalog.md5(COALESCE(pg_catalog.string_agg(
               pg_catalog.concat_ws('|', id, alumno_id, grupo_id, deporte_id, estado,
                                    fecha_inscripcion, fecha_cancelacion),
               ';' ORDER BY id), ''))
    INTO v_huella FROM public.inscripciones_deportivas;
    IF v_huella <> (SELECT huella FROM ept_062_conteos_iniciales
                    WHERE relacion = 'inscripciones_deportivas') THEN
        RAISE EXCEPTION 'Autoverificación EPT-62: cambió el contenido de public.inscripciones_deportivas.';
    END IF;

    SELECT pg_catalog.md5(COALESCE(pg_catalog.string_agg(
               pg_catalog.concat_ws('|', id, alumno_id, servicio_id, estado,
                                    fecha_inscripcion, fecha_cancelacion),
               ';' ORDER BY id), ''))
    INTO v_huella FROM public.inscripciones_servicios;
    IF v_huella <> (SELECT huella FROM ept_062_conteos_iniciales
                    WHERE relacion = 'inscripciones_servicios') THEN
        RAISE EXCEPTION 'Autoverificación EPT-62: cambió el contenido de public.inscripciones_servicios.';
    END IF;

    IF EXISTS (SELECT 1 FROM public.confirmaciones_inscripcion) THEN
        RAISE EXCEPTION 'Autoverificación EPT-62: la migración no debe registrar confirmaciones.';
    END IF;

    -- Ningún privilegio de escritura, de borrado ni de truncado para los roles
    -- de aplicación sobre el registro ni sobre las tres tablas de inscripción.
    FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        FOREACH v_tabla IN ARRAY ARRAY[
            'public.confirmaciones_inscripcion', 'public.matriculas',
            'public.inscripciones_deportivas', 'public.inscripciones_servicios'
        ] LOOP
            FOREACH v_privilegio IN ARRAY ARRAY[
                'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
            ] LOOP
                IF pg_catalog.has_table_privilege(v_rol, v_tabla, v_privilegio) THEN
                    RAISE EXCEPTION 'Autoverificación EPT-62: % conserva % sobre %.',
                        v_rol, v_privilegio, v_tabla;
                END IF;
            END LOOP;
        END LOOP;

        IF pg_catalog.has_table_privilege(v_rol, 'public.confirmaciones_inscripcion', 'SELECT')
           AND v_rol = 'anon' THEN
            RAISE EXCEPTION 'Autoverificación EPT-62: anon puede leer las confirmaciones.';
        END IF;
    END LOOP;

    -- El registro tiene RLS, política de lectura solo para Dirección y la
    -- política RESTRICTIVE de bloqueo de cuenta; ninguna política permisiva de
    -- escritura.
    IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class
            WHERE oid = 'public.confirmaciones_inscripcion'::pg_catalog.regclass) THEN
        RAISE EXCEPTION 'Autoverificación EPT-62: el registro de confirmaciones no tiene RLS.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_policies
        WHERE schemaname = 'public' AND tablename = 'confirmaciones_inscripcion'
          AND cmd <> 'SELECT' AND permissive = 'PERMISSIVE'
    ) THEN
        RAISE EXCEPTION 'Autoverificación EPT-62: existe una política permisiva de escritura sobre el registro.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_policies
        WHERE schemaname = 'public' AND tablename = 'confirmaciones_inscripcion'
          AND policyname = 'Bloqueo de acceso sin datos protegidos'
          AND permissive = 'RESTRICTIVE'
    ) THEN
        RAISE EXCEPTION 'Autoverificación EPT-62: falta la política RESTRICTIVE de bloqueo de cuenta.';
    END IF;

    -- Las operaciones privadas: SECURITY DEFINER, search_path vacío, ejecutables
    -- solo por `authenticated` (salvo el auxiliar, que ningún rol ejecuta).
    FOREACH v_firma IN ARRAY ARRAY[
        'app_private.confirmar_matricula(uuid)'::pg_catalog.regprocedure,
        'app_private.confirmar_inscripcion_deportiva(uuid)'::pg_catalog.regprocedure,
        'app_private.confirmar_inscripcion_servicio(uuid,public.tipo_servicio_escolar)'::pg_catalog.regprocedure,
        'app_private.cancelar_inscripcion_deportiva_administrativa(uuid)'::pg_catalog.regprocedure,
        'app_private.cancelar_inscripcion_servicio_administrativa(uuid,public.tipo_servicio_escolar)'::pg_catalog.regprocedure
    ] LOOP
        IF NOT (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid = v_firma)
           OR (SELECT proconfig FROM pg_catalog.pg_proc WHERE oid = v_firma)
               IS DISTINCT FROM ARRAY['search_path=""']
           OR pg_catalog.has_function_privilege('anon', v_firma, 'EXECUTE')
           OR pg_catalog.has_function_privilege('service_role', v_firma, 'EXECUTE')
           OR NOT pg_catalog.has_function_privilege('authenticated', v_firma, 'EXECUTE') THEN
            RAISE EXCEPTION
                'Autoverificación EPT-62: % no es SECURITY DEFINER con search_path vacío o sus privilegios de ejecución no son los previstos.',
                v_firma;
        END IF;
    END LOOP;

    FOREACH v_firma IN ARRAY ARRAY[
        'app_private.describir_confirmacion(public.confirmaciones_inscripcion,uuid,boolean)'::pg_catalog.regprocedure,
        'app_private.proteger_confirmacion_inscripcion()'::pg_catalog.regprocedure
    ] LOOP
        IF pg_catalog.has_function_privilege('anon', v_firma, 'EXECUTE')
           OR pg_catalog.has_function_privilege('authenticated', v_firma, 'EXECUTE')
           OR pg_catalog.has_function_privilege('service_role', v_firma, 'EXECUTE') THEN
            RAISE EXCEPTION 'Autoverificación EPT-62: % es ejecutable por un rol de aplicación.', v_firma;
        END IF;
    END LOOP;

    -- Los envoltorios públicos: SECURITY INVOKER mínimo, sin SECURITY DEFINER en
    -- un esquema expuesto y sin EXECUTE para anon ni service_role.
    FOREACH v_firma IN ARRAY ARRAY[
        'public.confirmar_matricula(uuid)'::pg_catalog.regprocedure,
        'public.confirmar_inscripcion_deportiva(uuid)'::pg_catalog.regprocedure,
        'public.confirmar_inscripcion_servicio(uuid,public.tipo_servicio_escolar)'::pg_catalog.regprocedure,
        'public.cancelar_inscripcion_deportiva_administrativa(uuid)'::pg_catalog.regprocedure,
        'public.cancelar_inscripcion_servicio_administrativa(uuid,public.tipo_servicio_escolar)'::pg_catalog.regprocedure
    ] LOOP
        IF (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid = v_firma)
           OR (SELECT proconfig FROM pg_catalog.pg_proc WHERE oid = v_firma)
               IS DISTINCT FROM ARRAY['search_path=""']
           OR pg_catalog.has_function_privilege('anon', v_firma, 'EXECUTE')
           OR pg_catalog.has_function_privilege('service_role', v_firma, 'EXECUTE')
           OR NOT pg_catalog.has_function_privilege('authenticated', v_firma, 'EXECUTE') THEN
            RAISE EXCEPTION 'Autoverificación EPT-62: el envoltorio % no es SECURITY INVOKER mínimo.', v_firma;
        END IF;
    END LOOP;

    -- Ninguna operación recibe identidad, rol, actor, perfil ni alumno.
    IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('public', 'app_private')
          AND p.proname IN ('confirmar_matricula', 'confirmar_inscripcion_deportiva',
                            'confirmar_inscripcion_servicio',
                            'cancelar_inscripcion_deportiva_administrativa',
                            'cancelar_inscripcion_servicio_administrativa')
          AND EXISTS (
              SELECT 1 FROM pg_catalog.unnest(COALESCE(p.proargnames, ARRAY[]::TEXT[])) AS nombre
              WHERE nombre ILIKE '%user%' OR nombre ILIKE '%rol%'
                 OR nombre ILIKE '%actor%' OR nombre ILIKE '%perfil%'
                 OR nombre ILIKE '%alumno%' OR nombre ILIKE '%director%'
          )
    ) THEN
        RAISE EXCEPTION 'Autoverificación EPT-62: una operación acepta identidad, rol, actor o alumno del llamador.';
    END IF;

    -- Las vistas administrativas: security_invoker y sin acceso de anon.
    FOREACH v_tabla IN ARRAY ARRAY[
        'matriculas_administracion', 'inscripciones_deportivas_administracion',
        'inscripciones_servicios_administracion'
    ] LOOP
        IF NOT EXISTS (
               SELECT 1 FROM pg_catalog.pg_class c
               WHERE c.oid = pg_catalog.to_regclass('public.' || v_tabla)
                 AND c.reloptions @> ARRAY['security_invoker=true']::TEXT[])
           OR pg_catalog.has_table_privilege('anon', 'public.' || v_tabla, 'SELECT') THEN
            RAISE EXCEPTION 'Autoverificación EPT-62: la vista % no es security_invoker o es legible por anon.', v_tabla;
        END IF;
    END LOOP;

    -- Las tablas existentes conservan exactamente sus triggers: esta migración
    -- no agrega ni quita ninguno.
    IF (SELECT pg_catalog.array_agg(t.tgname::TEXT ORDER BY t.tgname)
        FROM pg_catalog.pg_trigger t
        WHERE t.tgrelid = 'public.inscripciones_servicios'::pg_catalog.regclass
          AND NOT t.tgisinternal AND t.tgenabled = 'O')
       IS DISTINCT FROM ARRAY['validar_inscripcion_servicio_antes_de_escribir']::TEXT[] THEN
        RAISE EXCEPTION 'Autoverificación EPT-62: cambió el conjunto de triggers de inscripciones_servicios.';
    END IF;

    RAISE NOTICE
        'Migración EPT-62: registro de confirmaciones y 5 operaciones administrativas instalados; % matrícula(s), % inscripción(es) deportiva(s) y % inscripción(es) a servicios preservadas sin cambios.',
        (SELECT pg_catalog.count(*) FROM public.matriculas),
        (SELECT pg_catalog.count(*) FROM public.inscripciones_deportivas),
        (SELECT pg_catalog.count(*) FROM public.inscripciones_servicios);
END $$;
