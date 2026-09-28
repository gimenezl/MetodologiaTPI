-- ============================================================
-- EDUCAR PARA TRANSFORMAR — Administración de deportes y grupos (EPT-61)
-- ============================================================
-- Migración aditiva. No modifica ni renumera 001 a 016, ni las de EPT-57,
-- EPT-58, EPT-59 ni EPT-60 (20260927220114_transporte_recorridos.sql).
--
-- EPT-11 (014) dejó un único alta de grupos («la administración integral es
-- EPT-61») y un catálogo de deportes sembrado sin ninguna operación de
-- escritura. Esta migración agrega lo que faltaba para que la dirección
-- administre el catálogo y los grupos, SIN tablas nuevas, SIN columnas nuevas,
-- SIN historial nuevo, SIN borrado físico y SIN ningún GRANT de escritura sobre
-- las tablas: toda escritura sigue pasando por funciones SECURITY DEFINER.
--
-- ============================================================
-- DECISIONES DE PRODUCTO APROBADAS (contrato de esta migración)
-- ============================================================
--   1. El profesor responsable es obligatorio POR GRUPO, no por deporte. Las
--      operaciones del catálogo no reciben profesor. Un grupo nunca queda sin
--      profesor (columna NOT NULL) y su profesor debe ser DOCENTE y ACTIVO: lo
--      siguen garantizando los triggers de 014 y de EPT-58, que esta migración
--      NO duplica ni debilita.
--   2. El catálogo puede ampliarse más allá de los seis deportes sembrados:
--      `crear_deporte`.
--   3. No se puede inactivar un deporte mientras tenga grupos ACTIVOS. Sí se
--      puede reactivar.
--   4. No se puede inactivar un grupo mientras tenga inscripciones ACTIVAS. Se
--      puede reactivar solo si siguen válidos su deporte, su nivel y su
--      profesor.
--   5. El cupo no puede quedar por debajo de la ocupación (inscripciones
--      activas). La regla ya existía (P5581, trigger de 014): se conserva tal
--      cual y `editar_grupo_deportivo` solo la expone.
--   6. Sin tablas de historial nuevas, sin borrado físico, sin GRANT de
--      escritura, sin tocar datos ni inscripciones existentes.
--   7. Nivel y deporte de un grupo son inmutables para la edición (solo se
--      editan nombre, cupo y profesor). Renombrar un deporte conserva la
--      protección de 014 (ver «Qué permite y qué no el renombrado»).
--   8. Solo DIRECTOR administra. Cuentas BLOQUEADAS (EPT-59), DOCENTE,
--      ESTUDIANTE, PADRE, PERSONAL, anónimo y sesión sin perfil son rechazados.
--
-- ============================================================
-- OPERACIONES NUEVAS (esquema `app_private`, expuestas por envoltorios `public`)
-- ============================================================
--   crear_deporte(p_nombre)                                   -> public.deportes
--   renombrar_deporte(p_deporte_id, p_nombre)                 -> public.deportes
--   cambiar_estado_deporte(p_deporte_id, p_activo)            -> public.deportes
--   editar_grupo_deportivo(p_grupo_id, p_nombre, p_cupo,
--                          p_profesor_id)                     -> public.grupos_deportivos
--   cambiar_estado_grupo_deportivo(p_grupo_id, p_activo)      -> public.grupos_deportivos
--
-- Patrón idéntico a 012 y 014: la función real vive en `app_private` (que la
-- Data API no expone), es SECURITY DEFINER con `search_path = ''` y valida
-- `auth.uid()` y `es_director()` dentro de PostgreSQL; el envoltorio de
-- `public` es SECURITY INVOKER y solo delega. Ninguna operación recibe actor,
-- rol ni usuario como parámetro.
--
-- Cada operación es una transacción completa: un rechazo no deja nada
-- persistido. Repetir el estado actual NO es un error y devuelve la fila sin
-- tocarla (mismo criterio que `establecer_recorrido_transporte`, EPT-60), de
-- modo que un reintento de red no falla ni actualiza `fecha_actualizacion`.
--
-- ============================================================
-- INVARIANTES Y CÓMO SE GARANTIZAN
-- ============================================================
-- | Invariante                                            | Garantía                            |
-- |-------------------------------------------------------|-------------------------------------|
-- | Solo la dirección habilitada administra               | RPC + es_director() (HABILITADO)    |
-- | Cuenta bloqueada: ni RPC ni lectura de las tablas     | es_director() + política RESTRICTIVE |
-- |                                                       | de EPT-59 (ya presente, verificada)  |
-- | Nombre de deporte recortado, de 1 a 100 caracteres    | CHECK de 014 + validación en la RPC |
-- | Deporte único por nombre normalizado                  | índice único de 014 -> P5971         |
-- | Deporte con grupos: nombre normalizado inmutable      | trigger de 014 (P5580), conservado   |
-- | Deporte con grupos ACTIVOS no se inactiva             | RPC con la fila del deporte bloqueada|
-- | Grupo con inscripciones ACTIVAS no se inactiva        | RPC con la fila del grupo bloqueada  |
-- | Cupo entre 1 y 100 y nunca menor que la ocupación     | CHECK + trigger de 014 (P5566/P5581) |
-- | Profesor DOCENTE al asignarlo o cambiarlo             | trigger de 014 (P5564/P5565)         |
-- | Profesor ACTIVO al asignarlo, cambiarlo o reactivar   | trigger de EPT-58 (P5605)            |
-- | Profesor con rol DOCENTE vigente al reactivar         | RPC con ficha y perfil bloqueados    |
-- | Deporte y nivel activos al reactivar un grupo         | trigger de 014 (P5561/P5563)         |
-- | Grupo único por deporte, nivel y nombre               | índice único de 014 -> P5973         |
-- | Deporte y nivel del grupo inmutables por la edición   | la RPC no los recibe                 |
-- | Reactivar sin choque horario con alumnos retenidos    | trigger de EPT-57 (conservado)       |
-- | Sin borrado físico                                    | sin GRANT, sin política, sin RPC     |
-- | Sin escritura directa de las tablas                   | sin GRANT ni política de escritura   |
--
-- Las reglas 3 y 4 viven en las RPC, no en triggers, a propósito. La única
-- escritura de las aplicaciones sobre estas tablas es la RPC (ningún rol tiene
-- INSERT, UPDATE ni DELETE), así que la RPC ES la autoridad de la aplicación.
-- Un trigger de inactivación también frenaría la «administración de datos» del
-- propietario, que EPT-57 documenta como camino válido: un grupo dado de baja
-- por esa vía puede conservar inscripciones ACTIVAS
-- (`validar_reactivacion_grupo_con_academia` las revalida al reactivar). Esta
-- migración no agrega ningún trigger, deja idéntico el conjunto de triggers de
-- `deportes` y `grupos_deportivos` y no cambia lo que puede hacer el propietario.
--
-- ============================================================
-- QUÉ PERMITE Y QUÉ NO EL RENOMBRADO DE UN DEPORTE
-- ============================================================
-- La identidad de un deporte es su nombre normalizado, `UPPER(BTRIM(nombre))`
-- (índice único de 014). El trigger `proteger_identidad_deporte` de 014 no se
-- toca:
--   * Deporte SIN grupos (activos o inactivos): puede tomar cualquier nombre
--     válido que no colisione con otro deporte.
--   * Deporte CON al menos un grupo (aunque esté inactivo): solo puede cambiar
--     el nombre cuando el nombre normalizado resultante es el MISMO, es decir,
--     únicamente cambios de mayúsculas y minúsculas («Fútbol» -> «FÚTBOL»).
--     Cualquier otro cambio («Fútbol» -> «Futbol», «Fútbol» -> «Fútbol 5»,
--     «Artes  Marciales» con espacio doble) se rechaza con P5580.
-- Este comportamiento es exactamente el de 014; solo se documenta.
--
-- ============================================================
-- ORDEN DE BLOQUEOS
-- ============================================================
--     (ept57_configuracion_horaria)  ->  alumnos  ->  grupos_deportivos
--         ->  profesores  ->  deportes  ->  niveles  ->  perfiles
--
-- Es el orden que ya siguen la inscripción (014/015: alumno -> grupo ->
-- deporte) y EPT-58 (ficha -> deporte -> nivel -> perfil). Los dos flujos
-- administrativos nuevos toman los mismos bloqueos que la inscripción sobre el
-- mismo objeto, así que se serializan contra ella:
--
--   * Inactivar / reactivar / editar un grupo: `grupos_deportivos FOR NO KEY
--     UPDATE`, el mismo bloqueo que toma el alta y la baja de una inscripción y
--     el cambio de cupo. El conteo de inscripciones activas es una sentencia
--     POSTERIOR al bloqueo, con instantánea nueva: ve todo lo que confirmó una
--     transacción que tuviera el grupo tomado.
--       - Alta y «inactivar» simultáneas: gana quien bloquea primero. Si gana
--         el alta, la inactivación cuenta la inscripción y se rechaza (P5975).
--         Si gana la inactivación, el alta relee el grupo ya inactivo y se
--         rechaza (P5569). Nunca queda un grupo inactivo con una inscripción
--         activa.
--       - Alta y reducción de cupo simultáneas: el trigger de 014 cuenta con el
--         grupo bloqueado. Nunca queda cupo menor que la ocupación.
--     No toma `alumnos`: no sabe qué alumnos hay, y bloquearlos en sentido
--     contrario al de la inscripción (grupo -> alumno) crearía ciclos.
--
--   * Inactivar / reactivar un deporte: `deportes FOR NO KEY UPDATE`, que entra
--     en conflicto con el `deportes FOR SHARE` que toman el alta y la
--     reactivación de un grupo (trigger de 014) y la inscripción. El conteo de
--     grupos activos es posterior al bloqueo. Si gana el alta o la
--     reactivación del grupo, la inactivación cuenta el grupo activo
--     y se rechaza (P5974). Si gana la inactivación, el alta relee el deporte
--     ya inactivo y se rechaza (P5561). Nunca queda un deporte inactivo con un
--     grupo activo.
--
--   * Reactivar un grupo toma antes que nada el bloqueo consultivo
--     `ept57_configuracion_horaria`. El trigger de EPT-57 lo toma DESPUÉS de
--     que el UPDATE bloquea la fila del grupo, mientras que la carga de
--     franjas deportivas y académicas lo toma ANTES de bloquear el grupo o los
--     alumnos: sin este orden, reactivar un grupo mientras se le agrega una
--     franja podía cerrar un ciclo de espera (40P01). Tomarlo primero repite
--     el orden de las franjas y elimina el ciclo. Solo la reactivación lo toma:
--     inactivar y editar no disparan ese trigger.
--
--   * La reactivación revisa además que el profesor siga siendo DOCENTE
--     (ficha `FOR SHARE` y luego perfil `FOR SHARE`: el orden de EPT-58).
--
-- ============================================================
-- HUECO DETECTADO Y CUBIERTO EN LA REACTIVACIÓN
-- ============================================================
-- Al reactivar un grupo, 014 revalida deporte y nivel activos, y EPT-58
-- revalida que la ficha del profesor no esté INACTIVO. Ninguno revalida que el
-- perfil del profesor conserve el rol DOCENTE (014 solo lo mira cuando el
-- profesor se elige o cambia). EPT-59 exige inactivar la ficha y liberar los
-- grupos ACTIVOS antes de quitar el rol DOCENTE, de modo que un grupo INACTIVO
-- puede conservar como responsable a un perfil que ya no es DOCENTE. La RPC
-- `cambiar_estado_grupo_deportivo` lo rechaza con P5565 antes de reactivar.
--
-- Como un grupo inactivo puede quedar con un profesor inactivo, la edición
-- (`editar_grupo_deportivo`) también se permite sobre grupos inactivos: es la
-- forma de asignar otro docente antes de reactivar.
--
-- ============================================================
-- CÓDIGOS SQLSTATE PROPIOS
-- ============================================================
-- Bloque nuevo P5970–P5975, sin colisión con P550x–P558x (006–015), P559x,
-- P560x (EPT-57/58/59) ni P596x (EPT-60).
--   P5970  el nombre del deporte no es válido
--   P5971  ya existe un deporte con ese nombre normalizado
--   P5972  el estado solicitado no es válido (NULL)
--   P5973  ya existe un grupo con ese deporte, nivel y nombre
--   P5974  no se puede inactivar un deporte con grupos activos
--   P5975  no se puede inactivar un grupo con inscripciones activas
-- Reutilizados: P5505 (identidad), 42501 (rol), P5560 (deporte inexistente),
-- P5561 (deporte inactivo), P5563 (nivel inactivo), P5564 (profesor
-- inexistente o ausente), P5565 (perfil sin rol DOCENTE), P5566 (cupo
-- inválido), P5567 (nombre de grupo inválido), P5568 (grupo inexistente),
-- P5580 (identidad protegida), P5581 (cupo menor que la ocupación) y P5605
-- (profesor inactivo, EPT-58).
--
-- ============================================================
-- REVERSIÓN NO DESTRUCTIVA
-- ============================================================
-- Esta migración no crea tablas, columnas ni triggers y no cambia datos, así que
-- revertirla es soltar sus diez funciones y nada más (no se toca ninguna fila):
--
--   DROP FUNCTION public.crear_deporte(text);
--   DROP FUNCTION public.renombrar_deporte(uuid, text);
--   DROP FUNCTION public.cambiar_estado_deporte(uuid, boolean);
--   DROP FUNCTION public.editar_grupo_deportivo(uuid, text, integer, uuid);
--   DROP FUNCTION public.cambiar_estado_grupo_deportivo(uuid, boolean);
--   DROP FUNCTION app_private.crear_deporte(text);
--   DROP FUNCTION app_private.renombrar_deporte(uuid, text);
--   DROP FUNCTION app_private.cambiar_estado_deporte(uuid, boolean);
--   DROP FUNCTION app_private.editar_grupo_deportivo(uuid, text, integer, uuid);
--   DROP FUNCTION app_private.cambiar_estado_grupo_deportivo(uuid, boolean);
--
-- La prueba supabase/tests/deportes_administracion_rls.sql ejecuta esos DROP
-- dentro de su transacción y comprueba que las filas y los triggers no cambian.
-- ============================================================


-- ================================================================
-- 1. PRECONDICIONES Y CONTEOS DE PRESERVACIÓN
-- ================================================================
DO $$
BEGIN
    IF pg_catalog.to_regclass('public.deportes') IS NULL
       OR pg_catalog.to_regclass('public.grupos_deportivos') IS NULL
       OR pg_catalog.to_regclass('public.inscripciones_deportivas') IS NULL
       OR pg_catalog.to_regclass('public.profesores') IS NULL
       OR pg_catalog.to_regclass('public.perfiles') IS NULL
       OR pg_catalog.to_regclass('public.roles') IS NULL
    THEN
        RAISE EXCEPTION
            'Migración EPT-61: faltan tablas base; la base no corresponde a 001–016 + EPT-57/58/59/60.';
    END IF;

    IF pg_catalog.to_regprocedure('app_private.es_director()') IS NULL
       OR pg_catalog.to_regprocedure('app_private.texto_servicio_valido(text,integer)') IS NULL
       OR pg_catalog.to_regprocedure('app_private.validar_grupo_deportivo()') IS NULL
       OR pg_catalog.to_regprocedure('app_private.proteger_identidad_deporte()') IS NULL
       OR pg_catalog.to_regprocedure('app_private.exigir_profesor_activo()') IS NULL
       OR pg_catalog.to_regprocedure('app_private.acceso_bloqueado()') IS NULL
    THEN
        RAISE EXCEPTION
            'Migración EPT-61: faltan funciones de 003–014, EPT-58 o EPT-59; la base no corresponde a lo esperado.';
    END IF;

    -- Los triggers de 014 y EPT-58 que esta migración se apoya en NO duplicar.
    IF NOT EXISTS (
           SELECT 1 FROM pg_catalog.pg_trigger
           WHERE tgrelid = 'public.grupos_deportivos'::pg_catalog.regclass
             AND tgname = 'validar_grupo_deportivo_antes_de_escribir')
       OR NOT EXISTS (
           SELECT 1 FROM pg_catalog.pg_trigger
           WHERE tgrelid = 'public.grupos_deportivos'::pg_catalog.regclass
             AND tgname = 'a_exigir_profesor_activo')
       OR NOT EXISTS (
           SELECT 1 FROM pg_catalog.pg_trigger
           WHERE tgrelid = 'public.deportes'::pg_catalog.regclass
             AND tgname = 'proteger_identidad_deporte_antes_de_actualizar')
    THEN
        RAISE EXCEPTION
            'Migración EPT-61: faltan los triggers de validación de 014 o EPT-58 sobre deportes o grupos.';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('public', 'app_private')
          AND p.proname IN ('crear_deporte', 'renombrar_deporte', 'cambiar_estado_deporte',
                            'editar_grupo_deportivo', 'cambiar_estado_grupo_deportivo')
    ) THEN
        RAISE EXCEPTION
            'Migración EPT-61: ya existen objetos de administración de deportes; revisá el estado de la base antes de continuar.';
    END IF;
END $$;

-- Esta migración no escribe ninguna de estas tres tablas: se comparan al final
-- por cantidad y por huella de contenido.
CREATE TEMPORARY TABLE ept_061_conteos_iniciales (
    relacion TEXT PRIMARY KEY,
    cantidad BIGINT NOT NULL,
    huella   TEXT NOT NULL
) ON COMMIT DROP;

INSERT INTO ept_061_conteos_iniciales (relacion, cantidad, huella)
VALUES
    ('deportes',
        (SELECT pg_catalog.count(*) FROM public.deportes),
        (SELECT pg_catalog.md5(COALESCE(pg_catalog.string_agg(
             pg_catalog.concat_ws('|', id, nombre, activo, fecha_creacion, fecha_actualizacion),
             ';' ORDER BY id), ''))
         FROM public.deportes)),
    ('grupos_deportivos',
        (SELECT pg_catalog.count(*) FROM public.grupos_deportivos),
        (SELECT pg_catalog.md5(COALESCE(pg_catalog.string_agg(
             pg_catalog.concat_ws('|', id, deporte_id, nivel_id, nombre, cupo, profesor_id,
                                  activo, fecha_creacion, fecha_actualizacion),
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
-- 2. OPERACIONES PRIVILEGIADAS: CATÁLOGO DE DEPORTES
-- ================================================================
-- Ninguna recibe profesor (decisión 1). Todas verifican `auth.uid()` y el rol
-- DIRECTOR dentro de la base, en ese orden y antes de mirar cualquier otro
-- dato, para no revelar la existencia de filas a quien no administra.

-- ----------------------------------------------------------------
-- 2.1 Alta de un deporte
-- ----------------------------------------------------------------
-- El nombre debe llegar recortado: la base lo rechaza en lugar de corregirlo
-- en silencio (mismo contrato que 012, 013 y 014). La unicidad la decide el
-- índice de 014 sobre el nombre normalizado; la carrera entre dos altas del
-- mismo nombre la resuelve ese índice, y su violación se traduce a P5971.
CREATE OR REPLACE FUNCTION app_private.crear_deporte(p_nombre TEXT)
RETURNS public.deportes
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_deporte public.deportes;
    v_indice  TEXT;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    IF NOT app_private.es_director() THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Solo la dirección puede administrar el catálogo de deportes.';
    END IF;

    IF NOT app_private.texto_servicio_valido(p_nombre, 100) THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5970',
            MESSAGE = 'El nombre del deporte debe tener entre 1 y 100 caracteres, sin espacios al principio ni al final.';
    END IF;

    BEGIN
        INSERT INTO public.deportes (nombre)
        VALUES (p_nombre)
        RETURNING * INTO v_deporte;
    EXCEPTION WHEN unique_violation THEN
        GET STACKED DIAGNOSTICS v_indice = CONSTRAINT_NAME;
        IF v_indice = 'idx_deportes_nombre_normalizado' THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P5971',
                MESSAGE = 'Ya existe un deporte con ese nombre.';
        END IF;
        RAISE;
    END;

    RETURN v_deporte;
END;
$$;

-- ----------------------------------------------------------------
-- 2.2 Renombrar un deporte
-- ----------------------------------------------------------------
-- La protección de identidad es la de 014 (ver la cabecera): con grupos solo
-- se admite un cambio de mayúsculas y minúsculas. La fila se bloquea antes de
-- que el trigger mire los grupos, y el alta de un grupo toma la misma fila
-- `FOR SHARE`: no se puede crear un grupo mientras el nombre cambia.
CREATE OR REPLACE FUNCTION app_private.renombrar_deporte(
    p_deporte_id UUID,
    p_nombre     TEXT
)
RETURNS public.deportes
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_deporte public.deportes;
    v_indice  TEXT;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    IF NOT app_private.es_director() THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Solo la dirección puede administrar el catálogo de deportes.';
    END IF;

    IF p_deporte_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5560', MESSAGE = 'El deporte solicitado no existe.';
    END IF;

    IF NOT app_private.texto_servicio_valido(p_nombre, 100) THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5970',
            MESSAGE = 'El nombre del deporte debe tener entre 1 y 100 caracteres, sin espacios al principio ni al final.';
    END IF;

    SELECT d.* INTO v_deporte
    FROM public.deportes d
    WHERE d.id = p_deporte_id
    FOR NO KEY UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P5560', MESSAGE = 'El deporte solicitado no existe.';
    END IF;

    -- Mismo nombre exacto: nada que cambiar.
    IF v_deporte.nombre = p_nombre THEN
        RETURN v_deporte;
    END IF;

    BEGIN
        UPDATE public.deportes
        SET nombre = p_nombre
        WHERE id = p_deporte_id
        RETURNING * INTO v_deporte;
    EXCEPTION WHEN unique_violation THEN
        GET STACKED DIAGNOSTICS v_indice = CONSTRAINT_NAME;
        IF v_indice = 'idx_deportes_nombre_normalizado' THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P5971',
                MESSAGE = 'Ya existe un deporte con ese nombre.';
        END IF;
        RAISE;
    END;

    RETURN v_deporte;
END;
$$;

-- ----------------------------------------------------------------
-- 2.3 Inactivar o reactivar un deporte
-- ----------------------------------------------------------------
-- Inactivar no toca los grupos ni las inscripciones: se rechaza si queda algún
-- grupo activo (P5974), así que un deporte inactivado por esta vía solo tiene
-- grupos inactivos, que se conservan como historial. El mensaje dice cuántos
-- grupos activos hay y el DETAIL, en JSON, cuáles: la dirección sabe qué
-- inactivar primero.
CREATE OR REPLACE FUNCTION app_private.cambiar_estado_deporte(
    p_deporte_id UUID,
    p_activo     BOOLEAN
)
RETURNS public.deportes
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_deporte  public.deportes;
    v_cantidad INTEGER;
    v_grupos   JSONB;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    IF NOT app_private.es_director() THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Solo la dirección puede administrar el catálogo de deportes.';
    END IF;

    IF p_activo IS NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5972',
            MESSAGE = 'Indicá si el deporte debe quedar activo o inactivo.';
    END IF;

    IF p_deporte_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5560', MESSAGE = 'El deporte solicitado no existe.';
    END IF;

    -- Se bloquea la fila antes de contar los grupos: el alta y la reactivación
    -- de un grupo esperan o son esperadas, nunca se cruzan.
    SELECT d.* INTO v_deporte
    FROM public.deportes d
    WHERE d.id = p_deporte_id
    FOR NO KEY UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P5560', MESSAGE = 'El deporte solicitado no existe.';
    END IF;

    IF v_deporte.activo = p_activo THEN
        RETURN v_deporte;
    END IF;

    IF NOT p_activo THEN
        -- Sentencia posterior al bloqueo: ve todo grupo confirmado por una
        -- transacción que tuviera el deporte tomado (alta o reactivación).
        SELECT pg_catalog.count(*)::INTEGER,
               COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                   'grupo_id', g.id,
                   'grupo', g.nombre,
                   'nivel', n.nombre
               ) ORDER BY n.orden NULLS LAST, g.nombre), '[]'::JSONB)
        INTO v_cantidad, v_grupos
        FROM public.grupos_deportivos g
        JOIN public.niveles n ON n.id = g.nivel_id
        WHERE g.deporte_id = p_deporte_id
          AND g.activo;

        IF v_cantidad > 0 THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P5974',
                MESSAGE = pg_catalog.format(
                    'No se puede inactivar el deporte: tiene %s grupo(s) activo(s). Inactivá esos grupos primero.',
                    v_cantidad),
                DETAIL = pg_catalog.jsonb_build_object('grupos', v_grupos)::TEXT;
        END IF;
    END IF;

    UPDATE public.deportes
    SET activo = p_activo
    WHERE id = p_deporte_id
    RETURNING * INTO v_deporte;

    RETURN v_deporte;
END;
$$;


-- ================================================================
-- 3. OPERACIONES PRIVILEGIADAS: GRUPOS DEPORTIVOS
-- ================================================================
-- El alta sigue siendo `crear_grupo_deportivo` de 014, sin cambios.

-- ----------------------------------------------------------------
-- 3.1 Editar nombre, cupo y profesor de un grupo
-- ----------------------------------------------------------------
-- Reemplazo completo: los tres datos son obligatorios, como en
-- `actualizar_recorrido` (EPT-60). El deporte y el nivel no se reciben: son la
-- identidad de la oferta (decisión 7). También se edita un grupo inactivo (ver
-- la cabecera). Las reglas de nombre, cupo y profesor las aplican los
-- triggers de 014 y EPT-58 con la fila del grupo bloqueada; esta operación
-- solo las expone:
--   * cupo menor que la ocupación  -> P5581 (014, se conserva tal cual)
--   * profesor inexistente         -> P5564; sin rol DOCENTE -> P5565
--   * profesor INACTIVO            -> P5605
CREATE OR REPLACE FUNCTION app_private.editar_grupo_deportivo(
    p_grupo_id    UUID,
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
    v_grupo  public.grupos_deportivos;
    v_indice TEXT;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    IF NOT app_private.es_director() THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Solo la dirección puede editar grupos deportivos.';
    END IF;

    IF p_grupo_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5568', MESSAGE = 'El grupo deportivo solicitado no existe.';
    END IF;

    IF NOT app_private.texto_servicio_valido(p_nombre, 100) THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5567',
            MESSAGE = 'El nombre del grupo debe tener entre 1 y 100 caracteres, sin espacios al principio ni al final.';
    END IF;

    IF p_cupo IS NULL OR p_cupo < 1 OR p_cupo > 100 THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5566',
            MESSAGE = 'El cupo debe ser un número entero entre 1 y 100.';
    END IF;

    IF p_profesor_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5564', MESSAGE = 'El profesor solicitado no existe.';
    END IF;

    -- Mismo bloqueo que toma la inscripción: serializa la edición (en
    -- particular la reducción de cupo) con toda alta y baja de este grupo.
    SELECT g.* INTO v_grupo
    FROM public.grupos_deportivos g
    WHERE g.id = p_grupo_id
    FOR NO KEY UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P5568', MESSAGE = 'El grupo deportivo solicitado no existe.';
    END IF;

    IF v_grupo.nombre = p_nombre
       AND v_grupo.cupo = p_cupo
       AND v_grupo.profesor_id = p_profesor_id THEN
        RETURN v_grupo;
    END IF;

    BEGIN
        UPDATE public.grupos_deportivos
        SET nombre = p_nombre,
            cupo = p_cupo,
            profesor_id = p_profesor_id
        WHERE id = p_grupo_id
        RETURNING * INTO v_grupo;
    EXCEPTION WHEN unique_violation THEN
        GET STACKED DIAGNOSTICS v_indice = CONSTRAINT_NAME;
        IF v_indice = 'idx_grupos_deportivos_identidad' THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P5973',
                MESSAGE = 'Ya existe un grupo con ese nombre para el mismo deporte y nivel.';
        END IF;
        RAISE;
    END;

    RETURN v_grupo;
END;
$$;

-- ----------------------------------------------------------------
-- 3.2 Inactivar o reactivar un grupo
-- ----------------------------------------------------------------
-- Inactivar: se rechaza si hay inscripciones activas (P5975); el mensaje dice
-- cuántas y nunca quiénes. Reactivar: 014 revalida deporte y nivel activos (P5561,
-- P5563), EPT-58 revalida la ficha del profesor (P5605) y EPT-57 revalida los
-- choques horarios de las inscripciones activas conservadas; esta operación
-- agrega la comprobación que faltaba, que el profesor siga siendo DOCENTE.
CREATE OR REPLACE FUNCTION app_private.cambiar_estado_grupo_deportivo(
    p_grupo_id UUID,
    p_activo   BOOLEAN
)
RETURNS public.grupos_deportivos
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_grupo   public.grupos_deportivos;
    v_rol     TEXT;
    v_activas BIGINT;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    IF NOT app_private.es_director() THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Solo la dirección puede cambiar el estado de un grupo deportivo.';
    END IF;

    IF p_activo IS NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5972',
            MESSAGE = 'Indicá si el grupo debe quedar activo o inactivo.';
    END IF;

    IF p_grupo_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5568', MESSAGE = 'El grupo deportivo solicitado no existe.';
    END IF;

    -- Primer eslabón del orden de bloqueos, solo para reactivar: es el mismo
    -- bloqueo consultivo que toma el trigger de reactivación de EPT-57, pero
    -- tomado ANTES de la fila del grupo, como lo toman las franjas.
    IF p_activo THEN
        PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtext('ept57_configuracion_horaria'));
    END IF;

    SELECT g.* INTO v_grupo
    FROM public.grupos_deportivos g
    WHERE g.id = p_grupo_id
    FOR NO KEY UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P5568', MESSAGE = 'El grupo deportivo solicitado no existe.';
    END IF;

    IF v_grupo.activo = p_activo THEN
        RETURN v_grupo;
    END IF;

    IF NOT p_activo THEN
        -- Sentencia posterior al bloqueo del grupo: toda alta y toda baja de
        -- inscripción toma este mismo bloqueo antes de tocar la suya.
        SELECT pg_catalog.count(*) INTO v_activas
        FROM public.inscripciones_deportivas i
        WHERE i.grupo_id = p_grupo_id
          AND i.estado = 'ACTIVA';

        IF v_activas > 0 THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P5975',
                MESSAGE = pg_catalog.format(
                    'No se puede inactivar el grupo: tiene %s inscripción(es) activa(s). Cada alumno debe cancelar la suya antes.',
                    v_activas);
        END IF;
    END IF;

    IF p_activo THEN
        -- Ficha primero y perfil después: el orden de EPT-58. Sin ficha, la
        -- decisión sobre existencia y rol queda en la lectura del perfil.
        PERFORM 1
        FROM public.profesores pr
        WHERE pr.perfil_id = v_grupo.profesor_id
        FOR SHARE;

        SELECT r.nombre INTO v_rol
        FROM public.perfiles p
        LEFT JOIN public.roles r ON r.id = p.rol_id
        WHERE p.id = v_grupo.profesor_id
        FOR SHARE OF p;

        IF v_rol IS DISTINCT FROM 'DOCENTE' THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P5565',
                MESSAGE = 'El profesor responsable del grupo ya no tiene el rol DOCENTE. Asigná otro profesor antes de reactivar el grupo.';
        END IF;
    END IF;

    UPDATE public.grupos_deportivos
    SET activo = p_activo
    WHERE id = p_grupo_id
    RETURNING * INTO v_grupo;

    RETURN v_grupo;
END;
$$;


-- ================================================================
-- 4. PRIVILEGIOS DE LAS OPERACIONES Y ENVOLTORIOS PÚBLICOS
-- ================================================================
-- Se parte de cero y se concede lo mínimo. `service_role` tampoco ejecuta
-- nada: estas operaciones dependen de la sesión de un DIRECTOR.
REVOKE ALL ON FUNCTION app_private.crear_deporte(TEXT)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.renombrar_deporte(UUID, TEXT)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.cambiar_estado_deporte(UUID, BOOLEAN)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.editar_grupo_deportivo(UUID, TEXT, INTEGER, UUID)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.cambiar_estado_grupo_deportivo(UUID, BOOLEAN)
    FROM PUBLIC, anon, authenticated, service_role;

-- Los envoltorios SECURITY INVOKER necesitan ejecutar la operación privada.
-- Cada una vuelve a validar auth.uid() y el rol dentro de PostgreSQL.
GRANT EXECUTE ON FUNCTION app_private.crear_deporte(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.renombrar_deporte(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.cambiar_estado_deporte(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.editar_grupo_deportivo(UUID, TEXT, INTEGER, UUID)
    TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.cambiar_estado_grupo_deportivo(UUID, BOOLEAN)
    TO authenticated;

CREATE OR REPLACE FUNCTION public.crear_deporte(p_nombre TEXT)
RETURNS public.deportes
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT app_private.crear_deporte(p_nombre);
$$;

CREATE OR REPLACE FUNCTION public.renombrar_deporte(
    p_deporte_id UUID,
    p_nombre     TEXT
)
RETURNS public.deportes
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT app_private.renombrar_deporte(p_deporte_id, p_nombre);
$$;

CREATE OR REPLACE FUNCTION public.cambiar_estado_deporte(
    p_deporte_id UUID,
    p_activo     BOOLEAN
)
RETURNS public.deportes
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT app_private.cambiar_estado_deporte(p_deporte_id, p_activo);
$$;

CREATE OR REPLACE FUNCTION public.editar_grupo_deportivo(
    p_grupo_id    UUID,
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
    SELECT app_private.editar_grupo_deportivo(p_grupo_id, p_nombre, p_cupo, p_profesor_id);
$$;

CREATE OR REPLACE FUNCTION public.cambiar_estado_grupo_deportivo(
    p_grupo_id UUID,
    p_activo   BOOLEAN
)
RETURNS public.grupos_deportivos
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT app_private.cambiar_estado_grupo_deportivo(p_grupo_id, p_activo);
$$;

-- Los privilegios por defecto de Supabase conceden EXECUTE sobre funciones
-- nuevas de `public` a anon; se parte de cero y se concede lo mínimo.
REVOKE ALL ON FUNCTION public.crear_deporte(TEXT)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.renombrar_deporte(UUID, TEXT)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cambiar_estado_deporte(UUID, BOOLEAN)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.editar_grupo_deportivo(UUID, TEXT, INTEGER, UUID)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cambiar_estado_grupo_deportivo(UUID, BOOLEAN)
    FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.crear_deporte(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.renombrar_deporte(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cambiar_estado_deporte(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.editar_grupo_deportivo(UUID, TEXT, INTEGER, UUID)
    TO authenticated;
GRANT EXECUTE ON FUNCTION public.cambiar_estado_grupo_deportivo(UUID, BOOLEAN)
    TO authenticated;


-- ================================================================
-- 5. AUTOVERIFICACIÓN
-- ================================================================
-- Esta migración no crea tablas ni políticas: las tres tablas deportivas
-- conservan las de 014 y la política RESTRICTIVE de bloqueo de cuenta que
-- EPT-59 agregó a toda tabla existente. Se comprueba que siguen así.
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
    -- Ninguna fila cambia.
    FOREACH v_relacion IN ARRAY ARRAY['deportes', 'grupos_deportivos', 'inscripciones_deportivas']
    LOOP
        SELECT cantidad, huella INTO v_antes
        FROM ept_061_conteos_iniciales WHERE relacion = v_relacion;

        EXECUTE pg_catalog.format('SELECT pg_catalog.count(*) FROM public.%I', v_relacion)
        INTO v_despues;

        IF v_despues <> v_antes.cantidad THEN
            RAISE EXCEPTION 'Autoverificación EPT-61: % cambió de % a % filas.',
                v_relacion, v_antes.cantidad, v_despues;
        END IF;
    END LOOP;

    SELECT pg_catalog.md5(COALESCE(pg_catalog.string_agg(
               pg_catalog.concat_ws('|', id, nombre, activo, fecha_creacion, fecha_actualizacion),
               ';' ORDER BY id), ''))
    INTO v_huella FROM public.deportes;
    IF v_huella <> (SELECT huella FROM ept_061_conteos_iniciales WHERE relacion = 'deportes') THEN
        RAISE EXCEPTION 'Autoverificación EPT-61: cambió el contenido de public.deportes.';
    END IF;

    SELECT pg_catalog.md5(COALESCE(pg_catalog.string_agg(
               pg_catalog.concat_ws('|', id, deporte_id, nivel_id, nombre, cupo, profesor_id,
                                    activo, fecha_creacion, fecha_actualizacion),
               ';' ORDER BY id), ''))
    INTO v_huella FROM public.grupos_deportivos;
    IF v_huella <> (SELECT huella FROM ept_061_conteos_iniciales WHERE relacion = 'grupos_deportivos') THEN
        RAISE EXCEPTION 'Autoverificación EPT-61: cambió el contenido de public.grupos_deportivos.';
    END IF;

    SELECT pg_catalog.md5(COALESCE(pg_catalog.string_agg(
               pg_catalog.concat_ws('|', id, alumno_id, grupo_id, deporte_id, estado,
                                    fecha_inscripcion, fecha_cancelacion),
               ';' ORDER BY id), ''))
    INTO v_huella FROM public.inscripciones_deportivas;
    IF v_huella <> (SELECT huella FROM ept_061_conteos_iniciales
                    WHERE relacion = 'inscripciones_deportivas') THEN
        RAISE EXCEPTION 'Autoverificación EPT-61: cambió el contenido de public.inscripciones_deportivas.';
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
                    RAISE EXCEPTION 'Autoverificación EPT-61: % conserva % sobre %.',
                        v_rol, v_privilegio, v_tabla;
                END IF;
            END LOOP;
        END LOOP;
    END LOOP;

    -- RLS habilitado, sin políticas PERMISSIVE de escritura y con la política
    -- RESTRICTIVE de bloqueo de cuenta de EPT-59 en las tres tablas.
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_class
        WHERE oid IN (
            'public.deportes'::pg_catalog.regclass,
            'public.grupos_deportivos'::pg_catalog.regclass,
            'public.inscripciones_deportivas'::pg_catalog.regclass
        )
          AND NOT relrowsecurity
    ) THEN
        RAISE EXCEPTION 'Autoverificación EPT-61: una tabla deportiva no tiene RLS.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_policies
        WHERE schemaname = 'public'
          AND tablename IN ('deportes', 'grupos_deportivos', 'inscripciones_deportivas')
          AND cmd <> 'SELECT'
          AND permissive = 'PERMISSIVE'
    ) THEN
        RAISE EXCEPTION 'Autoverificación EPT-61: existe una política permisiva de escritura sobre tablas deportivas.';
    END IF;

    FOREACH v_tabla IN ARRAY ARRAY['deportes', 'grupos_deportivos', 'inscripciones_deportivas'] LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_policies
            WHERE schemaname = 'public' AND tablename = v_tabla
              AND policyname = 'Bloqueo de acceso sin datos protegidos'
              AND permissive = 'RESTRICTIVE'
        ) THEN
            RAISE EXCEPTION 'Autoverificación EPT-61: falta la política RESTRICTIVE de bloqueo de cuenta en %.', v_tabla;
        END IF;
    END LOOP;

    -- Las operaciones privadas: SECURITY DEFINER, search_path vacío, ejecutables
    -- solo por `authenticated`.
    FOREACH v_firma IN ARRAY ARRAY[
        'app_private.crear_deporte(text)'::pg_catalog.regprocedure,
        'app_private.renombrar_deporte(uuid,text)'::pg_catalog.regprocedure,
        'app_private.cambiar_estado_deporte(uuid,boolean)'::pg_catalog.regprocedure,
        'app_private.editar_grupo_deportivo(uuid,text,integer,uuid)'::pg_catalog.regprocedure,
        'app_private.cambiar_estado_grupo_deportivo(uuid,boolean)'::pg_catalog.regprocedure
    ] LOOP
        IF NOT (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid = v_firma)
           OR (SELECT proconfig FROM pg_catalog.pg_proc WHERE oid = v_firma)
               IS DISTINCT FROM ARRAY['search_path=""']
           OR pg_catalog.has_function_privilege('anon', v_firma, 'EXECUTE')
           OR pg_catalog.has_function_privilege('service_role', v_firma, 'EXECUTE')
           OR NOT pg_catalog.has_function_privilege('authenticated', v_firma, 'EXECUTE') THEN
            RAISE EXCEPTION
                'Autoverificación EPT-61: % no es SECURITY DEFINER con search_path vacío o sus privilegios de ejecución no son los previstos.',
                v_firma;
        END IF;
    END LOOP;

    -- Los envoltorios públicos: SECURITY INVOKER mínimo, sin SECURITY DEFINER
    -- en un esquema expuesto.
    FOREACH v_firma IN ARRAY ARRAY[
        'public.crear_deporte(text)'::pg_catalog.regprocedure,
        'public.renombrar_deporte(uuid,text)'::pg_catalog.regprocedure,
        'public.cambiar_estado_deporte(uuid,boolean)'::pg_catalog.regprocedure,
        'public.editar_grupo_deportivo(uuid,text,integer,uuid)'::pg_catalog.regprocedure,
        'public.cambiar_estado_grupo_deportivo(uuid,boolean)'::pg_catalog.regprocedure
    ] LOOP
        IF (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid = v_firma)
           OR (SELECT proconfig FROM pg_catalog.pg_proc WHERE oid = v_firma)
               IS DISTINCT FROM ARRAY['search_path=""']
           OR pg_catalog.has_function_privilege('anon', v_firma, 'EXECUTE')
           OR pg_catalog.has_function_privilege('service_role', v_firma, 'EXECUTE')
           OR NOT pg_catalog.has_function_privilege('authenticated', v_firma, 'EXECUTE') THEN
            RAISE EXCEPTION 'Autoverificación EPT-61: el envoltorio % no es SECURITY INVOKER mínimo.', v_firma;
        END IF;
    END LOOP;

    -- Ninguna operación recibe identidad, rol ni actor del llamador, ni el
    -- profesor en las del catálogo de deportes (decisión 1).
    IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('public', 'app_private')
          AND p.proname IN ('crear_deporte', 'renombrar_deporte', 'cambiar_estado_deporte',
                            'editar_grupo_deportivo', 'cambiar_estado_grupo_deportivo')
          AND EXISTS (
              SELECT 1 FROM pg_catalog.unnest(COALESCE(p.proargnames, ARRAY[]::TEXT[])) AS nombre
              WHERE nombre ILIKE '%user%' OR nombre ILIKE '%rol%'
                 OR nombre ILIKE '%actor%' OR nombre ILIKE '%perfil%'
                 OR nombre ILIKE '%nivel%'
          )
    ) THEN
        RAISE EXCEPTION 'Autoverificación EPT-61: una operación acepta identidad, rol, perfil o nivel del llamador.';
    END IF;

    -- Decisión 1: las operaciones del catálogo no reciben profesor. Decisión 7:
    -- la edición de un grupo no recibe deporte ni nivel.
    IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('public', 'app_private')
          AND (
              (p.proname IN ('crear_deporte', 'renombrar_deporte', 'cambiar_estado_deporte')
               AND EXISTS (
                   SELECT 1 FROM pg_catalog.unnest(COALESCE(p.proargnames, ARRAY[]::TEXT[])) AS nombre
                   WHERE nombre ILIKE '%profesor%'))
              OR (p.proname = 'editar_grupo_deportivo'
               AND EXISTS (
                   SELECT 1 FROM pg_catalog.unnest(COALESCE(p.proargnames, ARRAY[]::TEXT[])) AS nombre
                   WHERE nombre ILIKE '%deporte%' OR nombre ILIKE '%nivel%'))
          )
    ) THEN
        RAISE EXCEPTION 'Autoverificación EPT-61: el catálogo recibe profesor o la edición de grupos recibe deporte o nivel.';
    END IF;

    -- Esta migración no agrega triggers: los de 014, EPT-57 y EPT-58 sobre
    -- deportes y grupos son exactamente los que había.
    IF (SELECT pg_catalog.array_agg(t.tgname::TEXT ORDER BY t.tgname)
        FROM pg_catalog.pg_trigger t
        WHERE t.tgrelid = 'public.grupos_deportivos'::pg_catalog.regclass
          AND NOT t.tgisinternal AND t.tgenabled = 'O')
       IS DISTINCT FROM ARRAY['a_exigir_profesor_activo', 'validar_grupo_deportivo_antes_de_escribir',
                              'validar_reactivacion_grupo_con_academia']::TEXT[]
       OR (SELECT pg_catalog.array_agg(t.tgname::TEXT ORDER BY t.tgname)
           FROM pg_catalog.pg_trigger t
           WHERE t.tgrelid = 'public.deportes'::pg_catalog.regclass
             AND NOT t.tgisinternal AND t.tgenabled = 'O')
          IS DISTINCT FROM ARRAY['proteger_identidad_deporte_antes_de_actualizar']::TEXT[] THEN
        RAISE EXCEPTION 'Autoverificación EPT-61: cambió el conjunto de triggers de deportes o de grupos deportivos.';
    END IF;

    RAISE NOTICE
        'Migración EPT-61: 5 operaciones de administración instaladas (sin triggers nuevos); % deporte(s), % grupo(s) y % inscripción(es) deportiva(s) preservados sin cambios.',
        (SELECT pg_catalog.count(*) FROM public.deportes),
        (SELECT pg_catalog.count(*) FROM public.grupos_deportivos),
        (SELECT pg_catalog.count(*) FROM public.inscripciones_deportivas);
END $$;
