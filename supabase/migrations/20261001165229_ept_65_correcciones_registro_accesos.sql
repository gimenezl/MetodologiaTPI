-- ============================================================
-- EDUCAR PARA TRANSFORMAR — Correcciones del registro de accesos con QR (EPT-65, RF21)
-- ============================================================
-- Migración CORRECTIVA y aditiva sobre 20261001012522_ept_65_registro_accesos_qr.sql.
-- No reescribe esa migración (que pudo haberse aplicado fuera del stack local) ni
-- ninguna anterior: la deja intacta y la corrige hacia adelante.
--
-- Contiene tres cambios independientes:
--
--   1. El kid del QR se ata a la credencial. La firma HMAC solo prueba que el
--      payload lo firmó una clave del servidor; si tras una rotación k1 -> k2 la
--      clave k1 sigue en el llavero y se filtra, alguien podría armar un payload
--      EPT1.k1.<id>.<hmac> para una credencial emitida con k2 (el id no es secreto:
--      Dirección lo lee por RLS). registrar_acceso_servicio recibe ahora el kid ya
--      verificado por el servidor (p_clave_kid) y devuelve NO_RECONOCIDO, sin
--      evento, si no coincide con el clave_kid inmutable de la credencial. Cambia
--      la firma de la función (un argumento más): la anterior se retira.
--
--   2. Anulación y purga de retención. anular_acceso_servicio relee anonimizado_en
--      bajo bloqueo y se niega si la purga anonimizó el evento mientras esperaba;
--      depurar_accesos_servicios anonimiza primero los eventos y después las
--      anulaciones DE ESOS eventos, en una sentencia nueva que ve lo confirmado
--      mientras esperaba. Antes, en ambos órdenes quedaba una anulación
--      identificable sobre un evento anonimizado.
--
--   3. Límite por volumen aprobado por Lucas (01/10/2026): 150 solicitudes por
--      cuenta cada 5 minutos con un bloqueo de 2 minutos. El límite de 10 firmas
--      inválidas cada 10 minutos y su bloqueo de 15 minutos NO cambian. Como el
--      bloqueo ya no es común, parametros_limite_escaneo() devuelve dos bloqueos.
--      Con un bloqueo (2 min) más corto que la ventana (5 min), tras una ráfaga la
--      cuenta puede volver a bloquearse hasta que las solicitudes envejezcan fuera
--      de la ventana: el techo real es 150 por ventana deslizante. Las solicitudes
--      rechazadas no suman, así que converge. Siguen siendo valores medidos en
--      local, no en producción.
--
-- Los privilegios no se amplían: la operación de registro y el límite siguen siendo
-- solo de service_role. No toca datos: la autoverificación lo comprueba.
-- ============================================================

-- ================================================================
-- 1. PRECONDICIONES
-- ================================================================
DO $$
BEGIN
    IF pg_catalog.to_regclass('public.accesos_servicios') IS NULL
       OR pg_catalog.to_regprocedure('app_private.registrar_acceso_servicio(uuid,uuid,uuid,uuid,public.sentido_acceso_transporte)') IS NULL
       OR pg_catalog.to_regprocedure('public.registrar_acceso_servicio(uuid,uuid,uuid,uuid,public.sentido_acceso_transporte)') IS NULL
       OR pg_catalog.to_regprocedure('app_private.parametros_limite_escaneo()') IS NULL THEN
        RAISE EXCEPTION 'Precondición EPT-65: falta la migración 20261001012522 (registro de accesos con QR).';
    END IF;
END $$;

CREATE TEMPORARY TABLE ept_065b_conteos (relacion TEXT PRIMARY KEY, cantidad BIGINT NOT NULL) ON COMMIT DROP;
INSERT INTO ept_065b_conteos
SELECT 'accesos_servicios', pg_catalog.count(*) FROM public.accesos_servicios
UNION ALL SELECT 'anulaciones_accesos_servicios', pg_catalog.count(*) FROM public.anulaciones_accesos_servicios
UNION ALL SELECT 'credenciales_qr', pg_catalog.count(*) FROM public.credenciales_qr
UNION ALL SELECT 'perfiles', pg_catalog.count(*) FROM public.perfiles;


-- ================================================================
-- 2. EL KID DEL QR SE ATA A LA CREDENCIAL
-- ================================================================
-- Se retiran las firmas anteriores (sin p_clave_kid): una función que acepta un
-- registro sin el kid dejaría abierto el defecto. Primero el envoltorio público.
DROP FUNCTION public.registrar_acceso_servicio(UUID, UUID, UUID, UUID, public.sentido_acceso_transporte);
DROP FUNCTION app_private.registrar_acceso_servicio(UUID, UUID, UUID, UUID, public.sentido_acceso_transporte);

CREATE OR REPLACE FUNCTION app_private.registrar_acceso_servicio(
    p_actor_user_id UUID,
    p_intento_id    UUID,
    p_credencial_id UUID,
    p_clave_kid     TEXT,
    p_servicio_id   UUID,
    p_sentido       public.sentido_acceso_transporte
)
RETURNS TABLE (
    codigo_resultado TEXT,
    alumno_nombre    TEXT,
    alumno_apellido  TEXT,
    alumno_legajo    TEXT,
    sellado_en       TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_operador        UUID;
    v_tipo            public.tipo_servicio_escolar;
    v_previo_id       UUID;
    v_alumno          UUID;
    v_kid             TEXT;
    v_estado_alumno   public.estado_alumno;
    v_estado_cred     public.estado_credencial_qr;
    v_acceso          public.estado_acceso;
    v_servicio_activo BOOLEAN;
    v_inscripcion     UUID;
    v_dia             DATE;
    v_motivo          public.motivo_denegacion_acceso;
    v_evento          public.accesos_servicios;
BEGIN
    -- 1. Identidad del operador (revalidada, con su fila de perfil bloqueada).
    v_operador := app_private.operador_de_escaneo(p_actor_user_id);

    IF p_intento_id IS NULL OR p_credencial_id IS NULL OR p_servicio_id IS NULL
       OR p_clave_kid IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5651', MESSAGE = 'Los datos del escaneo no son válidos.';
    END IF;

    -- 2. El servicio declarado existe y el sentido es coherente con su tipo.
    SELECT s.tipo INTO v_tipo FROM public.servicios_escolares s WHERE s.id = p_servicio_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P5652', MESSAGE = 'El servicio declarado no existe.';
    END IF;
    IF (v_tipo = 'TRANSPORTE') IS DISTINCT FROM (p_sentido IS NOT NULL) THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5653',
            MESSAGE = 'El sentido es obligatorio en transporte y no corresponde al comedor.';
    END IF;

    -- 3. Reintento ya resuelto (camino rápido; se repite después de esperar).
    SELECT e.id INTO v_previo_id
    FROM public.accesos_servicios e
    WHERE e.operador_perfil_id = v_operador AND e.intento_id = p_intento_id;
    IF FOUND THEN
        RETURN QUERY SELECT * FROM app_private.respuesta_de_intento(v_previo_id, p_credencial_id, p_servicio_id, p_sentido);
        RETURN;
    END IF;

    -- 4. Credencial → alumno, SIN bloquear: `alumno_id` y `clave_kid` son inmutables
    --    y las filas no se borran. Un identificador inexistente no deja ningún evento.
    --    El `kid` del QR tiene que ser el MISMO con el que se firmó esta credencial:
    --    si no, una clave retenida tras una rotación podría falsificar el QR de una
    --    credencial emitida con otra clave. No deja evento (el QR no corresponde).
    SELECT c.alumno_id, c.clave_kid INTO v_alumno, v_kid
    FROM public.credenciales_qr c WHERE c.id = p_credencial_id;
    IF NOT FOUND OR v_kid IS DISTINCT FROM p_clave_kid THEN
        RETURN QUERY SELECT 'NO_RECONOCIDO'::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT,
                            NULL::TIMESTAMP WITH TIME ZONE;
        RETURN;
    END IF;

    -- 5. Primero el alumno (orden del dominio). Serializa con revocar, reponer,
    --    inactivar, reactivar, otro escaneo y una anulación del mismo alumno.
    SELECT a.estado INTO v_estado_alumno
    FROM public.alumnos a
    WHERE a.perfil_id = v_alumno
    FOR NO KEY UPDATE;

    -- Relectura del intento tras esperar: pudo confirmar un reintento idéntico.
    SELECT e.id INTO v_previo_id
    FROM public.accesos_servicios e
    WHERE e.operador_perfil_id = v_operador AND e.intento_id = p_intento_id;
    IF FOUND THEN
        RETURN QUERY SELECT * FROM app_private.respuesta_de_intento(v_previo_id, p_credencial_id, p_servicio_id, p_sentido);
        RETURN;
    END IF;

    -- 6. Relectura de la credencial, del perfil del alumno, del servicio y de la
    --    inscripción, en el orden del dominio. Lo que leen es el estado vigente
    --    DESPUÉS de esperar cualquier cambio concurrente.
    SELECT c.estado INTO v_estado_cred
    FROM public.credenciales_qr c
    WHERE c.id = p_credencial_id
    FOR SHARE;

    SELECT p.estado_acceso INTO v_acceso
    FROM public.perfiles p
    WHERE p.id = v_alumno
    FOR SHARE;

    SELECT s.activo INTO v_servicio_activo
    FROM public.servicios_escolares s
    WHERE s.id = p_servicio_id
    FOR SHARE;

    SELECT i.id INTO v_inscripcion
    FROM public.inscripciones_servicios i
    WHERE i.alumno_id = v_alumno
      AND i.servicio_id = p_servicio_id
      AND i.estado = 'ACTIVA'
    FOR SHARE;

    v_dia := ((pg_catalog.clock_timestamp() AT TIME ZONE 'America/Argentina/Buenos_Aires'))::DATE;

    -- 7. Decisión. El primer motivo que aplica gana; el operador solo ve el
    --    genérico (salvo YA_REGISTRADO).
    IF v_estado_cred IS DISTINCT FROM 'ACTIVA' THEN
        v_motivo := 'CREDENCIAL_REVOCADA';
    ELSIF v_estado_alumno IS DISTINCT FROM 'ACTIVO' THEN
        v_motivo := 'ALUMNO_INACTIVO';
    ELSIF v_acceso IS DISTINCT FROM 'HABILITADO' THEN
        v_motivo := 'ACCESO_BLOQUEADO';
    ELSIF v_servicio_activo IS DISTINCT FROM TRUE THEN
        v_motivo := 'SERVICIO_INACTIVO';
    ELSIF v_inscripcion IS NULL THEN
        -- Solo para el motivo interno: ¿está inscripto en OTRO recorrido?
        IF v_tipo = 'TRANSPORTE' AND EXISTS (
            SELECT 1
            FROM public.inscripciones_servicios i2
            JOIN public.servicios_escolares s2 ON s2.id = i2.servicio_id
            WHERE i2.alumno_id = v_alumno AND i2.estado = 'ACTIVA' AND s2.tipo = 'TRANSPORTE'
        ) THEN
            v_motivo := 'RECORRIDO_DISTINTO';
        ELSE
            v_motivo := 'SIN_INSCRIPCION';
        END IF;
    ELSIF EXISTS (
        SELECT 1
        FROM public.accesos_servicios e
        WHERE e.alumno_id = v_alumno
          AND e.servicio_id = p_servicio_id
          AND e.sentido IS NOT DISTINCT FROM p_sentido
          AND e.resultado = 'REGISTRADO'
          AND e.dia_servicio = v_dia
          AND NOT EXISTS (
              SELECT 1 FROM public.anulaciones_accesos_servicios n WHERE n.acceso_id = e.id
          )
    ) THEN
        v_motivo := 'YA_REGISTRADO';
    ELSE
        v_motivo := NULL;
    END IF;

    -- 8. Inserción. Si un reintento idéntico concurrente confirmó entre la
    --    relectura y acá (mismo operador e intento con otro alumno, que no
    --    comparte el candado), el índice único lo detecta y se responde con el
    --    resultado ya guardado.
    BEGIN
        INSERT INTO public.accesos_servicios (
            intento_id, operador_perfil_id, credencial_id, alumno_id, servicio_id, sentido,
            resultado, motivo_denegacion
        )
        VALUES (
            p_intento_id, v_operador, p_credencial_id, v_alumno, p_servicio_id, p_sentido,
            CASE WHEN v_motivo IS NULL THEN 'REGISTRADO'::public.resultado_acceso_servicio
                 ELSE 'DENEGADO'::public.resultado_acceso_servicio END,
            v_motivo
        )
        RETURNING * INTO v_evento;
    EXCEPTION
        WHEN unique_violation THEN
            SELECT e.id INTO v_previo_id
            FROM public.accesos_servicios e
            WHERE e.operador_perfil_id = v_operador AND e.intento_id = p_intento_id;
            IF NOT FOUND THEN
                RAISE;
            END IF;
            RETURN QUERY SELECT * FROM app_private.respuesta_de_intento(v_previo_id, p_credencial_id, p_servicio_id, p_sentido);
            RETURN;
    END;

    IF v_motivo IS NULL THEN
        RETURN QUERY
        SELECT 'REGISTRADO'::TEXT, p.nombre::TEXT, p.apellido::TEXT, p.legajo_nro::TEXT, v_evento.registrado_en
        FROM public.perfiles p
        WHERE p.id = v_alumno;
        RETURN;
    END IF;

    RETURN QUERY
    SELECT CASE WHEN v_motivo = 'YA_REGISTRADO' THEN 'YA_REGISTRADO' ELSE 'NO_HABILITADO' END,
           NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TIMESTAMP WITH TIME ZONE;
END;
$$;

REVOKE ALL ON FUNCTION app_private.registrar_acceso_servicio(
    UUID, UUID, UUID, TEXT, UUID, public.sentido_acceso_transporte
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.registrar_acceso_servicio(
    UUID, UUID, UUID, TEXT, UUID, public.sentido_acceso_transporte
) TO service_role;

CREATE OR REPLACE FUNCTION public.registrar_acceso_servicio(
    p_actor_user_id UUID,
    p_intento_id    UUID,
    p_credencial_id UUID,
    p_clave_kid     TEXT,
    p_servicio_id   UUID,
    p_sentido       public.sentido_acceso_transporte DEFAULT NULL
)
RETURNS TABLE (
    codigo_resultado TEXT,
    alumno_nombre    TEXT,
    alumno_apellido  TEXT,
    alumno_legajo    TEXT,
    sellado_en       TIMESTAMP WITH TIME ZONE
)
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT * FROM app_private.registrar_acceso_servicio(
        p_actor_user_id, p_intento_id, p_credencial_id, p_clave_kid, p_servicio_id, p_sentido);
$$;

REVOKE ALL ON FUNCTION public.registrar_acceso_servicio(
    UUID, UUID, UUID, TEXT, UUID, public.sentido_acceso_transporte
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.registrar_acceso_servicio(
    UUID, UUID, UUID, TEXT, UUID, public.sentido_acceso_transporte
) TO service_role;


-- ================================================================
-- 3. ANULACIÓN Y PURGA: NINGUNA ANULACIÓN IDENTIFICABLE SOBRE UN EVENTO ANONIMIZADO
-- ================================================================
-- CREATE OR REPLACE conserva los privilegios de cada función (misma firma).
CREATE OR REPLACE FUNCTION app_private.anular_acceso_servicio(
    p_acceso_id UUID,
    p_motivo    TEXT
)
RETURNS public.anulaciones_accesos_servicios
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_motivo     TEXT;
    v_alumno     UUID;
    v_resultado  public.resultado_acceso_servicio;
    v_anonimizado TIMESTAMP WITH TIME ZONE;
    v_anulacion  public.anulaciones_accesos_servicios;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    IF NOT app_private.es_director() THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Solo la dirección puede anular un acceso.';
    END IF;

    v_motivo := pg_catalog.btrim(p_motivo);
    IF v_motivo IS NULL OR pg_catalog.char_length(v_motivo) NOT BETWEEN 3 AND 200 THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5664',
            MESSAGE = 'El motivo debe tener entre 3 y 200 caracteres.';
    END IF;

    IF p_acceso_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5665', MESSAGE = 'El acceso solicitado no existe.';
    END IF;

    -- `alumno_id` es inmutable salvo la anonimización: se lee sin bloquear para
    -- decidir qué alumno bloquear primero (mismo orden que el registro).
    SELECT e.alumno_id INTO v_alumno FROM public.accesos_servicios e WHERE e.id = p_acceso_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P5665', MESSAGE = 'El acceso solicitado no existe.';
    END IF;
    IF v_alumno IS NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5666',
            MESSAGE = 'El acceso ya fue anonimizado y no puede anularse.';
    END IF;

    PERFORM 1 FROM public.alumnos a WHERE a.perfil_id = v_alumno FOR NO KEY UPDATE;

    SELECT e.resultado, e.anonimizado_en INTO v_resultado, v_anonimizado
    FROM public.accesos_servicios e
    WHERE e.id = p_acceso_id
    FOR SHARE;

    -- Relectura tras esperar: la purga pudo anonimizarlo mientras se esperaba el
    -- bloqueo. Una anulación identificable sobre un evento anonimizado no se
    -- puede crear (nunca volvería a ser anonimizada).
    IF v_anonimizado IS NOT NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5666',
            MESSAGE = 'El acceso ya fue anonimizado y no puede anularse.';
    END IF;

    IF v_resultado IS DISTINCT FROM 'REGISTRADO' THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5663',
            MESSAGE = 'Solo se puede anular un acceso registrado.';
    END IF;

    IF EXISTS (SELECT 1 FROM public.anulaciones_accesos_servicios n WHERE n.acceso_id = p_acceso_id) THEN
        RAISE EXCEPTION USING ERRCODE = 'P5667', MESSAGE = 'El acceso ya estaba anulado.';
    END IF;

    BEGIN
        INSERT INTO public.anulaciones_accesos_servicios (acceso_id, anulado_por, motivo)
        VALUES (p_acceso_id, app_private.perfil_actual(), v_motivo)
        RETURNING * INTO v_anulacion;
    EXCEPTION
        WHEN unique_violation THEN
            RAISE EXCEPTION USING ERRCODE = 'P5667', MESSAGE = 'El acceso ya estaba anulado.';
    END;

    RETURN v_anulacion;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.depurar_accesos_servicios(p_fin_ciclo_lectivo DATE)
RETURNS app_private.depuraciones_accesos_servicios
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_ahora       TIMESTAMP WITH TIME ZONE := pg_catalog.clock_timestamp();
    v_hoy         DATE := ((pg_catalog.clock_timestamp() AT TIME ZONE 'America/Argentina/Buenos_Aires'))::DATE;
    v_corte       TIMESTAMP WITH TIME ZONE := pg_catalog.clock_timestamp() - INTERVAL '90 days';
    v_accesos     INTEGER;
    v_ids         UUID[];
    v_anulaciones INTEGER;
    v_denegados   INTEGER;
    v_contadores  INTEGER;
    v_registro    app_private.depuraciones_accesos_servicios;
BEGIN
    IF p_fin_ciclo_lectivo IS NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5668',
            MESSAGE = 'Hay que indicar la fecha de fin del ciclo lectivo.';
    END IF;

    IF p_fin_ciclo_lectivo + 90 >= v_hoy THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5668',
            MESSAGE = 'Todavía no pasaron 90 días desde el fin del ciclo lectivo indicado.';
    END IF;

    -- Habilita las guardas SOLO dentro de esta transacción.
    PERFORM pg_catalog.set_config('ept65.mantenimiento', 'on', TRUE);

    -- Primero los eventos; sus anulaciones DESPUÉS y en una sentencia nueva. Una
    -- anulación concurrente retiene el bloqueo del evento hasta confirmar, así que
    -- esta sentencia espera, y la siguiente ya ve la anulación confirmada (en el
    -- orden inverso, `anular_acceso_servicio` relee `anonimizado_en` y se niega).
    WITH anonimizados AS (
        UPDATE public.accesos_servicios e
        SET intento_id = NULL, operador_perfil_id = NULL, credencial_id = NULL,
            alumno_id = NULL, anonimizado_en = v_ahora
        WHERE e.resultado = 'REGISTRADO'
          AND e.anonimizado_en IS NULL
          AND e.dia_servicio <= p_fin_ciclo_lectivo
        RETURNING e.id
    )
    SELECT pg_catalog.count(*), COALESCE(pg_catalog.array_agg(a.id), '{}'::UUID[])
    INTO v_accesos, v_ids
    FROM anonimizados a;

    UPDATE public.anulaciones_accesos_servicios n
    SET anulado_por = NULL, motivo = NULL, anonimizada_en = v_ahora
    WHERE n.anonimizada_en IS NULL
      AND n.acceso_id = ANY (v_ids);
    GET DIAGNOSTICS v_anulaciones = ROW_COUNT;

    DELETE FROM public.accesos_servicios e
    WHERE e.resultado = 'DENEGADO' AND e.registrado_en < v_corte;
    GET DIAGNOSTICS v_denegados = ROW_COUNT;

    DELETE FROM app_private.contadores_escaneo c
    WHERE c.ocurrido_en < v_ahora - INTERVAL '24 hours';
    GET DIAGNOSTICS v_contadores = ROW_COUNT;

    PERFORM pg_catalog.set_config('ept65.mantenimiento', 'off', TRUE);

    INSERT INTO app_private.depuraciones_accesos_servicios (
        fin_ciclo_lectivo, corte_denegados, accesos_anonimizados,
        anulaciones_anonimizadas, denegados_eliminados, contadores_eliminados
    )
    VALUES (p_fin_ciclo_lectivo, v_corte, v_accesos, v_anulaciones, v_denegados, v_contadores)
    RETURNING * INTO v_registro;

    RETURN v_registro;
END;
$$;

REVOKE ALL ON FUNCTION app_private.depurar_accesos_servicios(DATE)
    FROM PUBLIC, anon, authenticated, service_role;


-- ================================================================
-- 4. LÍMITE POR VOLUMEN: 150 SOLICITUDES / 5 MIN, BLOQUEO DE 2 MIN
-- ================================================================
-- Cambia el tipo de retorno (dos bloqueos), por eso se retira y se vuelve a crear.
-- Las dos funciones que la leen se reemplazan más abajo, en esta misma migración.
DROP FUNCTION app_private.parametros_limite_escaneo();

-- VALORES APROBADOS POR LUCAS el 01/10/2026 tras la medición local (ver
-- docs/evidence/EPT-65.md, sección 16.1). No están medidos en producción.
CREATE FUNCTION app_private.parametros_limite_escaneo()
RETURNS TABLE (
    solicitudes_maximas INTEGER,
    ventana_solicitudes INTERVAL,
    bloqueo_solicitudes INTERVAL,
    invalidos_maximos   INTEGER,
    ventana_invalidos   INTERVAL,
    bloqueo_invalidos   INTERVAL
)
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT 150, INTERVAL '5 minutes', INTERVAL '2 minutes',
           10, INTERVAL '10 minutes', INTERVAL '15 minutes';
$$;

REVOKE ALL ON FUNCTION app_private.parametros_limite_escaneo()
    FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION app_private.consumir_cupo_escaneo(p_actor_user_id UUID)
RETURNS TABLE (permitido BOOLEAN, reintentar_en_segundos INTEGER)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_operador UUID;
    v_max      INTEGER;
    v_ventana  INTERVAL;
    v_bloqueo  INTERVAL;
    v_hasta    TIMESTAMP WITH TIME ZONE;
    v_ahora    TIMESTAMP WITH TIME ZONE;
BEGIN
    v_operador := app_private.operador_de_escaneo(p_actor_user_id);

    SELECT l.solicitudes_maximas, l.ventana_solicitudes, l.bloqueo_solicitudes
    INTO v_max, v_ventana, v_bloqueo
    FROM app_private.parametros_limite_escaneo() l;

    PERFORM pg_catalog.pg_advisory_xact_lock(65001, pg_catalog.hashtext(v_operador::TEXT));
    v_ahora := pg_catalog.clock_timestamp();

    -- Retención de 24 horas de los propios contadores del operador.
    DELETE FROM app_private.contadores_escaneo c
    WHERE c.operador_perfil_id = v_operador
      AND c.ocurrido_en < v_ahora - INTERVAL '24 hours';

    SELECT pg_catalog.max(c.bloqueado_hasta) INTO v_hasta
    FROM app_private.contadores_escaneo c
    WHERE c.operador_perfil_id = v_operador AND c.tipo = 'BLOQUEO' AND c.bloqueado_hasta > v_ahora;

    IF v_hasta IS NOT NULL THEN
        RETURN QUERY SELECT FALSE, GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_hasta - v_ahora)))::INTEGER);
        RETURN;
    END IF;

    IF (SELECT pg_catalog.count(*)
        FROM app_private.contadores_escaneo c
        WHERE c.operador_perfil_id = v_operador AND c.tipo = 'SOLICITUD'
          AND c.ocurrido_en > v_ahora - v_ventana) >= v_max THEN
        INSERT INTO app_private.contadores_escaneo (operador_perfil_id, tipo, ocurrido_en, bloqueado_hasta)
        VALUES (v_operador, 'BLOQUEO', v_ahora, v_ahora + v_bloqueo);
        RETURN QUERY SELECT FALSE, GREATEST(1, CEIL(EXTRACT(EPOCH FROM v_bloqueo))::INTEGER);
        RETURN;
    END IF;

    INSERT INTO app_private.contadores_escaneo (operador_perfil_id, tipo, ocurrido_en)
    VALUES (v_operador, 'SOLICITUD', v_ahora);

    RETURN QUERY SELECT TRUE, 0;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.registrar_escaneo_invalido(p_actor_user_id UUID)
RETURNS TABLE (bloqueado BOOLEAN, reintentar_en_segundos INTEGER)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_operador UUID;
    v_max      INTEGER;
    v_ventana  INTERVAL;
    v_bloqueo  INTERVAL;
    v_ahora    TIMESTAMP WITH TIME ZONE;
BEGIN
    v_operador := app_private.operador_de_escaneo(p_actor_user_id);

    SELECT l.invalidos_maximos, l.ventana_invalidos, l.bloqueo_invalidos
    INTO v_max, v_ventana, v_bloqueo
    FROM app_private.parametros_limite_escaneo() l;

    PERFORM pg_catalog.pg_advisory_xact_lock(65001, pg_catalog.hashtext(v_operador::TEXT));
    v_ahora := pg_catalog.clock_timestamp();

    INSERT INTO app_private.contadores_escaneo (operador_perfil_id, tipo, ocurrido_en)
    VALUES (v_operador, 'INVALIDO', v_ahora);

    IF (SELECT pg_catalog.count(*)
        FROM app_private.contadores_escaneo c
        WHERE c.operador_perfil_id = v_operador AND c.tipo = 'INVALIDO'
          AND c.ocurrido_en > v_ahora - v_ventana) >= v_max
       AND NOT EXISTS (
           SELECT 1 FROM app_private.contadores_escaneo c
           WHERE c.operador_perfil_id = v_operador AND c.tipo = 'BLOQUEO' AND c.bloqueado_hasta > v_ahora
       ) THEN
        INSERT INTO app_private.contadores_escaneo (operador_perfil_id, tipo, ocurrido_en, bloqueado_hasta)
        VALUES (v_operador, 'BLOQUEO', v_ahora, v_ahora + v_bloqueo);
        RETURN QUERY SELECT TRUE, GREATEST(1, CEIL(EXTRACT(EPOCH FROM v_bloqueo))::INTEGER);
        RETURN;
    END IF;

    RETURN QUERY SELECT FALSE, 0;
END;
$$;

REVOKE ALL ON FUNCTION app_private.consumir_cupo_escaneo(UUID)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.registrar_escaneo_invalido(UUID)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.consumir_cupo_escaneo(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION app_private.registrar_escaneo_invalido(UUID) TO service_role;


-- ================================================================
-- 5. AUTOVERIFICACIÓN
-- ================================================================
DO $$
DECLARE
    v_firma pg_catalog.regprocedure;
    v_p     RECORD;
BEGIN
    -- Las firmas anteriores desaparecieron.
    IF pg_catalog.to_regprocedure('app_private.registrar_acceso_servicio(uuid,uuid,uuid,uuid,public.sentido_acceso_transporte)') IS NOT NULL
       OR pg_catalog.to_regprocedure('public.registrar_acceso_servicio(uuid,uuid,uuid,uuid,public.sentido_acceso_transporte)') IS NOT NULL THEN
        RAISE EXCEPTION 'Autoverificación EPT-65b: quedó una firma de registrar_acceso_servicio sin kid.';
    END IF;

    -- Operación privilegiada y límites: SOLO service_role (y nada para PUBLIC).
    FOREACH v_firma IN ARRAY ARRAY[
        'app_private.registrar_acceso_servicio(uuid,uuid,uuid,text,uuid,public.sentido_acceso_transporte)'::pg_catalog.regprocedure,
        'public.registrar_acceso_servicio(uuid,uuid,uuid,text,uuid,public.sentido_acceso_transporte)'::pg_catalog.regprocedure,
        'app_private.consumir_cupo_escaneo(uuid)'::pg_catalog.regprocedure,
        'app_private.registrar_escaneo_invalido(uuid)'::pg_catalog.regprocedure
    ] LOOP
        IF pg_catalog.has_function_privilege('anon', v_firma, 'EXECUTE')
           OR pg_catalog.has_function_privilege('authenticated', v_firma, 'EXECUTE')
           OR NOT pg_catalog.has_function_privilege('service_role', v_firma, 'EXECUTE')
           OR EXISTS (
               SELECT 1 FROM pg_catalog.pg_proc p, pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
               WHERE p.oid = v_firma AND a.grantee = 0
           ) THEN
            RAISE EXCEPTION 'Autoverificación EPT-65b: % no es ejecutable solo por service_role.', v_firma;
        END IF;
    END LOOP;

    -- Internas y mantenimiento: ningún rol de aplicación.
    FOREACH v_firma IN ARRAY ARRAY[
        'app_private.parametros_limite_escaneo()'::pg_catalog.regprocedure,
        'app_private.depurar_accesos_servicios(date)'::pg_catalog.regprocedure
    ] LOOP
        IF pg_catalog.has_function_privilege('anon', v_firma, 'EXECUTE')
           OR pg_catalog.has_function_privilege('authenticated', v_firma, 'EXECUTE')
           OR pg_catalog.has_function_privilege('service_role', v_firma, 'EXECUTE') THEN
            RAISE EXCEPTION 'Autoverificación EPT-65b: % es ejecutable por un rol de aplicación.', v_firma;
        END IF;
    END LOOP;

    -- Dirección conserva sus dos operaciones (anular y listar no cambiaron de firma).
    IF NOT pg_catalog.has_function_privilege('authenticated', 'public.anular_acceso_servicio(uuid,text)'::pg_catalog.regprocedure, 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', 'public.anular_acceso_servicio(uuid,text)'::pg_catalog.regprocedure, 'EXECUTE') THEN
        RAISE EXCEPTION 'Autoverificación EPT-65b: los privilegios de anular_acceso_servicio cambiaron.';
    END IF;

    -- Valores aprobados del límite.
    SELECT * INTO v_p FROM app_private.parametros_limite_escaneo();
    IF v_p.solicitudes_maximas <> 150 OR v_p.ventana_solicitudes <> INTERVAL '5 minutes'
       OR v_p.bloqueo_solicitudes <> INTERVAL '2 minutes'
       OR v_p.invalidos_maximos <> 10 OR v_p.ventana_invalidos <> INTERVAL '10 minutes'
       OR v_p.bloqueo_invalidos <> INTERVAL '15 minutes' THEN
        RAISE EXCEPTION 'Autoverificación EPT-65b: los parámetros del límite no son los aprobados.';
    END IF;

    -- La migración no altera datos.
    IF EXISTS (
        SELECT 1 FROM ept_065b_conteos c
        WHERE c.cantidad IS DISTINCT FROM CASE c.relacion
            WHEN 'accesos_servicios' THEN (SELECT pg_catalog.count(*) FROM public.accesos_servicios)
            WHEN 'anulaciones_accesos_servicios' THEN (SELECT pg_catalog.count(*) FROM public.anulaciones_accesos_servicios)
            WHEN 'credenciales_qr' THEN (SELECT pg_catalog.count(*) FROM public.credenciales_qr)
            WHEN 'perfiles' THEN (SELECT pg_catalog.count(*) FROM public.perfiles)
        END
    ) THEN
        RAISE EXCEPTION 'Autoverificación EPT-65b: la migración alteró datos.';
    END IF;

    RAISE NOTICE 'Migración EPT-65b: kid atado a la credencial, anulación/purga corregidas y límite 150/5 min con bloqueo de 2 min.';
END $$;
