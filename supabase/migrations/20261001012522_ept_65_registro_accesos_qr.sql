-- ============================================================
-- EDUCAR PARA TRANSFORMAR — Registro de accesos con QR (EPT-65, RF21)
-- ============================================================
-- Migración aditiva. No modifica ni renumera ninguna migración anterior y no
-- altera ninguna tabla, vista, función ni trigger existente. EPT-64 (RF20) emite
-- y revoca credenciales; esta migración registra el USO de una credencial en el
-- comedor o en el transporte.
--
-- ============================================================
-- CONTRATO APROBADO (resumen de lo que esta migración hace cumplir)
-- ============================================================
--   1. Solo DIRECTOR y PERSONAL habilitados registran accesos, cada uno con su
--      propia cuenta. Alumno, padre, docente, anónimo, sin perfil y bloqueado no.
--   2. La base NO verifica la firma del QR: no conoce la clave HMAC. El servidor
--      verifica formato, versión, kid y firma ANTES de invocar la operación. La
--      operación privilegiada solo la ejecuta `service_role`; ningún usuario
--      autenticado puede llamarla, ni siquiera conociendo un `credencial_id`.
--   3. Como la operación se invoca con `service_role`, `auth.uid()` es NULO y el
--      actor llega como argumento (`p_actor_user_id`). Esa excepción respecto del
--      diseño de EPT-64 (que deriva el actor de `auth.uid()`) se compensa así: el
--      servidor obtiene el actor de la sesión verificada (nunca del cuerpo de la
--      petición) y PostgreSQL REVALIDA en CADA ejecución que ese usuario tenga un
--      perfil DIRECTOR o PERSONAL con acceso HABILITADO, bajo bloqueo de la fila
--      del perfil. La garantía de firma vive en la frontera servidor → base.
--   4. Una sola transacción evalúa, con bloqueos y relectura tras esperar:
--      credencial ACTIVA, alumno ACTIVO, perfil HABILITADO, servicio activo e
--      inscripción ACTIVA del tipo correcto (en transporte, del recorrido que el
--      operador declara). La confirmación administrativa de EPT-62 NO es requisito.
--   5. Comedor: como máximo un acceso REGISTRADO vigente por alumno y día de
--      Buenos Aires. Transporte: como máximo uno por alumno, recorrido, día de
--      Buenos Aires y sentido (IDA o VUELTA): ambos sentidos el mismo día son
--      válidos. Un acceso ANULADO no cuenta: libera el cupo del día sin borrar
--      la historia.
--   6. La fecha y la hora las sella la base. La respuesta es un conjunto cerrado
--      (REGISTRADO, YA_REGISTRADO, NO_HABILITADO, NO_RECONOCIDO) más
--      INTENTO_REUTILIZADO para un reintento con argumentos distintos. Un rechazo
--      de negocio RETORNA (no hace RAISE) y persiste una fila DENEGADO cuando la
--      credencial fue reconocida; un error de autorización o técnico no deja
--      ningún evento parcial.
--   7. No se crea evento para un payload malformado, de firma inválida o de kid
--      desconocido (el servidor lo rechaza antes de llegar acá) ni para un
--      identificador de credencial inexistente. Nada de lo que se guarda permite
--      reconstruir un QR: no hay payload, firma, clave, DNI, IP, user-agent ni
--      imagen.
--   8. `intento_id` (UUID por escaneo) vuelve idempotente el reintento por
--      timeout: mismo operador + mismo intento + mismos argumentos devuelve el
--      resultado previo sin duplicar; mismos operador/intento con otros
--      argumentos devuelve INTENTO_REUTILIZADO sin alterar nada; otro operador
--      con el mismo UUID no ve ni toca el intento ajeno.
--   9. Solo Dirección lee eventos y denegaciones, y solo por una función de solo
--      lectura. Ningún rol de aplicación tiene privilegio alguno sobre las
--      tablas: ni SELECT, ni INSERT, ni UPDATE, ni DELETE.
--  10. Dirección anula un REGISTRADO erróneo agregando UNA fila de anulación con
--      motivo de 3 a 200 caracteres. El evento original no se edita ni se borra.
--  11. Límite de intentos por cuenta operadora, atómico y ANTES de verificar la
--      firma: 60 solicitudes en 5 minutos y 10 inválidos en 10 minutos; superar
--      cualquiera bloquea 15 minutos. SON VALORES INICIALES DE PRUEBA, NO medidos
--      en producción: deben someterse a una prueba de carga y de usabilidad antes
--      de fijarse como umbral productivo. Viven en una sola función
--      (`parametros_limite_escaneo`).
--  12. Retención (política de producto, NO una afirmación legal): los eventos
--      identificables se conservan hasta el fin del ciclo lectivo + 90 días y
--      luego se anonimizan; los DENEGADO se eliminan a los 90 días; los
--      contadores duran 24 horas. Los roles de aplicación solo AGREGAN eventos;
--      la excepción de mantenimiento es una función cerrada a todos ellos, que se
--      ejecuta a mano (runbook manual en v1; esta migración NO habilita pg_cron),
--      deja un registro de auditoría de solo agregado y está probada.
--
-- ============================================================
-- POR QUÉ UN `credencial_id` NO ALCANZA
-- ============================================================
-- Dirección lee todos los identificadores de `credenciales_qr` por RLS, y el
-- identificador viaja en claro dentro del payload y de las APIs de tarjeta. Si la
-- operación aceptara el identificador de un `authenticated`, cualquier operador
-- con acceso a la Data API registraría «escaneos» sin QR ni firma. Por eso la
-- operación NO tiene EXECUTE para anon ni authenticated y NO hay política ni
-- privilegio de escritura sobre las tablas: el único camino de escritura es el
-- servidor, después de comprobar el HMAC con una clave que la base nunca ve.
--
-- ============================================================
-- ORDEN DE BLOQUEOS (verificado contra EPT-64, EPT-59, 008, 013, 060 y 062)
-- ============================================================
--   perfil del OPERADOR (FOR SHARE)
--     → [lectura sin bloqueo de la credencial: su `alumno_id` es inmutable]
--     → alumnos del alumno (FOR NO KEY UPDATE)
--     → credencial (FOR SHARE, relectura)
--     → perfil del ALUMNO (FOR SHARE)
--     → servicio (FOR SHARE)
--     → inscripción (FOR SHARE)
--     → INSERT del evento.
--   El tramo alumnos → perfiles → servicios → inscripciones es el orden del
--   dominio (013). Ninguna operación vigente lo toma al revés:
--     * emitir/reponer/revocar (064) y inactivar/reactivar (008) toman primero
--       `alumnos`, que conflictúa con FOR NO KEY UPDATE: se serializan.
--     * cancelar inscripción (013, 062) solo toma la fila de la inscripción y su
--       trigger no toma `alumnos` en un UPDATE: espera, o es esperada, sin ciclo.
--     * establecer_recorrido_transporte (060) usa el mismo orden alumnos →
--       servicio → inscripción.
--     * cambiar_acceso_perfil (059) toma el advisory 59001 y la fila de `perfiles`
--       del afectado; ningún trigger de `perfiles` toca `alumnos` en un cambio de
--       `estado_acceso`. Un operador bloqueado mientras escanea espera el fin del
--       escaneo; uno bloqueado ANTES no puede registrar.
--   Los contadores de límite usan un advisory lock propio (65001) por operador,
--   que ninguna otra operación toma.
--
-- ============================================================
-- CÓDIGOS SQLSTATE (P565x–P566x, sin colisión con P5500–P5627, P5901–P5975, P6201–P6301)
-- ============================================================
--   P5505 sin identidad                  42501 el actor no es operador habilitado
--   P5651 argumentos del escaneo inválidos
--   P5652 el servicio declarado no existe
--   P5653 el sentido no corresponde al servicio (obligatorio en transporte, ausente en comedor)
--   P5660 ya existe un acceso vigente para ese alumno, servicio, día y sentido (defensa del trigger)
--   P5662 operación no permitida sobre el historial de accesos
--   P5663 solo un acceso REGISTRADO puede anularse
--   P5664 motivo de anulación inválido
--   P5665 el acceso no existe
--   P5666 el acceso ya fue anonimizado
--   P5667 el acceso ya estaba anulado
--   P5668 la depuración todavía no corresponde


-- ================================================================
-- 1. PRECONDICIONES
-- ================================================================
DO $$
BEGIN
    IF pg_catalog.to_regclass('public.credenciales_qr') IS NULL
       OR pg_catalog.to_regclass('public.servicios_escolares') IS NULL
       OR pg_catalog.to_regclass('public.inscripciones_servicios') IS NULL
       OR pg_catalog.to_regclass('public.alumnos') IS NULL
       OR pg_catalog.to_regclass('public.perfiles') IS NULL
       OR pg_catalog.to_regclass('public.roles') IS NULL
    THEN
        RAISE EXCEPTION
            'Migración EPT-65: faltan tablas base; la base no corresponde a 001–025.';
    END IF;

    IF pg_catalog.to_regprocedure('app_private.es_director()') IS NULL
       OR pg_catalog.to_regprocedure('app_private.perfil_actual()') IS NULL
    THEN
        RAISE EXCEPTION
            'Migración EPT-65: faltan las funciones de identidad; la base no corresponde a 001–025.';
    END IF;

    IF pg_catalog.to_regclass('public.accesos_servicios') IS NOT NULL
       OR pg_catalog.to_regclass('public.anulaciones_accesos_servicios') IS NOT NULL
    THEN
        RAISE EXCEPTION
            'Migración EPT-65: ya existen objetos de registro de accesos; revisá el estado de la base antes de continuar.';
    END IF;
END $$;

CREATE TEMPORARY TABLE ept_065_conteos_iniciales (
    relacion TEXT PRIMARY KEY,
    cantidad BIGINT NOT NULL
) ON COMMIT DROP;

INSERT INTO ept_065_conteos_iniciales (relacion, cantidad)
VALUES
    ('credenciales_qr', (SELECT pg_catalog.count(*) FROM public.credenciales_qr)),
    ('inscripciones_servicios', (SELECT pg_catalog.count(*) FROM public.inscripciones_servicios)),
    ('servicios_escolares', (SELECT pg_catalog.count(*) FROM public.servicios_escolares)),
    ('alumnos', (SELECT pg_catalog.count(*) FROM public.alumnos)),
    ('perfiles', (SELECT pg_catalog.count(*) FROM public.perfiles));


-- ================================================================
-- 2. TIPOS
-- ================================================================
CREATE TYPE public.sentido_acceso_transporte AS ENUM ('IDA', 'VUELTA');

CREATE TYPE public.resultado_acceso_servicio AS ENUM ('REGISTRADO', 'DENEGADO');

-- Motivo INTERNO de una denegación: solo lo lee Dirección. Al operador se le
-- responde de forma genérica (NO_HABILITADO) salvo YA_REGISTRADO.
CREATE TYPE public.motivo_denegacion_acceso AS ENUM (
    'YA_REGISTRADO',
    'CREDENCIAL_REVOCADA',
    'ALUMNO_INACTIVO',
    'ACCESO_BLOQUEADO',
    'SERVICIO_INACTIVO',
    'SIN_INSCRIPCION',
    'RECORRIDO_DISTINTO'
);


-- ================================================================
-- 3. EVENTOS DE ACCESO
-- ================================================================
CREATE TABLE public.accesos_servicios (
    id                  UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
    -- UUID que genera el navegador por cada escaneo. No identifica a nadie por sí
    -- solo: su unicidad es POR operador.
    intento_id          UUID,
    operador_perfil_id  UUID REFERENCES public.perfiles (id) ON DELETE RESTRICT,
    credencial_id       UUID REFERENCES public.credenciales_qr (id) ON DELETE RESTRICT,
    alumno_id           UUID REFERENCES public.alumnos (perfil_id) ON DELETE RESTRICT,
    -- Servicio (comedor) o recorrido (transporte) que el OPERADOR declara.
    servicio_id         UUID NOT NULL REFERENCES public.servicios_escolares (id) ON DELETE RESTRICT,
    sentido             public.sentido_acceso_transporte,
    resultado           public.resultado_acceso_servicio NOT NULL,
    motivo_denegacion   public.motivo_denegacion_acceso,
    -- Sellada por la base (trigger), nunca por el cliente.
    registrado_en       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT pg_catalog.clock_timestamp(),
    -- Día de servicio en Buenos Aires: sirve a la regla de un acceso por día. La
    -- conversión de zona sobre un timestamptz es inmutable, así que puede ser una
    -- columna generada.
    dia_servicio        DATE GENERATED ALWAYS AS (
                            ((registrado_en AT TIME ZONE 'America/Argentina/Buenos_Aires'))::DATE
                        ) STORED,
    anonimizado_en      TIMESTAMP WITH TIME ZONE,

    CONSTRAINT accesos_servicios_resultado_motivo CHECK (
        (resultado = 'REGISTRADO' AND motivo_denegacion IS NULL)
        OR (resultado = 'DENEGADO' AND motivo_denegacion IS NOT NULL)
    ),
    -- O el evento es identificable (todos los vínculos presentes) o fue
    -- anonimizado (ninguno). Un estado intermedio no existe.
    CONSTRAINT accesos_servicios_identificadores_coherentes CHECK (
        (anonimizado_en IS NULL
            AND intento_id IS NOT NULL AND operador_perfil_id IS NOT NULL
            AND credencial_id IS NOT NULL AND alumno_id IS NOT NULL)
        OR (anonimizado_en IS NOT NULL AND resultado = 'REGISTRADO'
            AND intento_id IS NULL AND operador_perfil_id IS NULL
            AND credencial_id IS NULL AND alumno_id IS NULL)
    )
);

COMMENT ON TABLE public.accesos_servicios IS
    'Eventos de acceso por QR al comedor o al transporte (RF21). Solo se agregan filas: ningún rol de aplicación tiene privilegios y el único camino de escritura es la operación privilegiada registrar_acceso_servicio, que invoca el servidor después de verificar la firma HMAC. No guarda payload, firma, clave, DNI, IP ni user-agent.';
COMMENT ON COLUMN public.accesos_servicios.intento_id IS
    'UUID del intento de escaneo (idempotencia por operador). Se elimina al anonimizar.';
COMMENT ON COLUMN public.accesos_servicios.motivo_denegacion IS
    'Motivo INTERNO de una denegación: lo lee solo Dirección; el operador recibe una respuesta genérica.';
COMMENT ON COLUMN public.accesos_servicios.registrado_en IS
    'Sellada por la base al insertar (clock_timestamp), nunca por el navegador.';

-- Autoridad de la idempotencia ante reintentos concurrentes.
CREATE UNIQUE INDEX idx_accesos_servicios_intento_por_operador
    ON public.accesos_servicios (operador_perfil_id, intento_id)
    WHERE intento_id IS NOT NULL;

-- Regla «un acceso por día»: busca REGISTRADO del alumno y servicio en el día.
CREATE INDEX idx_accesos_servicios_alumno_dia
    ON public.accesos_servicios (alumno_id, servicio_id, dia_servicio)
    WHERE resultado = 'REGISTRADO' AND alumno_id IS NOT NULL;

-- Consulta de Dirección (más reciente primero) y depuración por antigüedad.
CREATE INDEX idx_accesos_servicios_registrado
    ON public.accesos_servicios (registrado_en DESC, id);
CREATE INDEX idx_accesos_servicios_dia
    ON public.accesos_servicios (dia_servicio, resultado);

-- Índices de las claves foráneas restantes.
CREATE INDEX idx_accesos_servicios_credencial
    ON public.accesos_servicios (credencial_id) WHERE credencial_id IS NOT NULL;
CREATE INDEX idx_accesos_servicios_servicio
    ON public.accesos_servicios (servicio_id);


-- ================================================================
-- 4. ANULACIONES (fila agregada; el evento original no se toca)
-- ================================================================
CREATE TABLE public.anulaciones_accesos_servicios (
    -- La clave primaria ES el evento anulado: impide anular dos veces.
    acceso_id       UUID PRIMARY KEY REFERENCES public.accesos_servicios (id) ON DELETE RESTRICT,
    anulado_por     UUID REFERENCES public.perfiles (id) ON DELETE RESTRICT,
    motivo          TEXT,
    anulado_en      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT pg_catalog.clock_timestamp(),
    anonimizada_en  TIMESTAMP WITH TIME ZONE,

    CONSTRAINT anulaciones_accesos_servicios_motivo_valido CHECK (
        motivo IS NULL
        OR (pg_catalog.char_length(motivo) BETWEEN 3 AND 200
            AND motivo = pg_catalog.btrim(motivo))
    ),
    CONSTRAINT anulaciones_accesos_servicios_coherente CHECK (
        (anonimizada_en IS NULL AND anulado_por IS NOT NULL AND motivo IS NOT NULL)
        OR (anonimizada_en IS NOT NULL AND anulado_por IS NULL AND motivo IS NULL)
    )
);

COMMENT ON TABLE public.anulaciones_accesos_servicios IS
    'Anulación de un acceso REGISTRADO erróneo (RF21). Es una fila agregada con motivo libre de 3 a 200 caracteres: el evento original no se edita ni se elimina. Un acceso anulado deja de contar para la regla de un acceso por día.';

CREATE INDEX idx_anulaciones_accesos_servicios_por
    ON public.anulaciones_accesos_servicios (anulado_por) WHERE anulado_por IS NOT NULL;


-- ================================================================
-- 5. CONTADORES DE LÍMITE Y AUDITORÍA DE MANTENIMIENTO (app_private)
-- ================================================================
-- Los contadores son datos operativos efímeros (24 horas), no historia: al
-- borrar un perfil se van con él (ON DELETE CASCADE).
CREATE TABLE app_private.contadores_escaneo (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    operador_perfil_id  UUID NOT NULL REFERENCES public.perfiles (id) ON DELETE CASCADE,
    tipo                TEXT NOT NULL CHECK (tipo IN ('SOLICITUD', 'INVALIDO', 'BLOQUEO')),
    ocurrido_en         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT pg_catalog.clock_timestamp(),
    bloqueado_hasta     TIMESTAMP WITH TIME ZONE,
    CONSTRAINT contadores_escaneo_bloqueo_coherente
        CHECK ((tipo = 'BLOQUEO') = (bloqueado_hasta IS NOT NULL))
);

COMMENT ON TABLE app_private.contadores_escaneo IS
    'Contadores de solicitudes e inválidos por operador y bloqueos temporales (RF21). No guardan payload. Se conservan 24 horas.';

CREATE INDEX idx_contadores_escaneo_operador
    ON app_private.contadores_escaneo (operador_perfil_id, tipo, ocurrido_en DESC);
CREATE INDEX idx_contadores_escaneo_antiguedad
    ON app_private.contadores_escaneo (ocurrido_en);

CREATE TABLE app_private.depuraciones_accesos_servicios (
    id                          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ejecutada_en                TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT pg_catalog.clock_timestamp(),
    -- `session_user` es quien abrió la conexión; `current_user` sería el
    -- propietario de la función.
    ejecutada_por               TEXT NOT NULL DEFAULT SESSION_USER,
    fin_ciclo_lectivo           DATE NOT NULL,
    corte_denegados             TIMESTAMP WITH TIME ZONE NOT NULL,
    accesos_anonimizados        INTEGER NOT NULL,
    anulaciones_anonimizadas    INTEGER NOT NULL,
    denegados_eliminados        INTEGER NOT NULL,
    contadores_eliminados       INTEGER NOT NULL
);

COMMENT ON TABLE app_private.depuraciones_accesos_servicios IS
    'Registro de auditoría de solo agregado de cada ejecución del mantenimiento de retención de accesos (RF21).';


-- ================================================================
-- 6. PARÁMETROS DEL LÍMITE (una sola definición)
-- ================================================================
-- VALORES INICIALES DE PRUEBA. No están medidos en producción y no deben
-- presentarse como umbral productivo hasta pasar una prueba de carga y de
-- usabilidad (ver docs/evidence/EPT-65.md).
CREATE OR REPLACE FUNCTION app_private.parametros_limite_escaneo()
RETURNS TABLE (
    solicitudes_maximas INTEGER,
    ventana_solicitudes INTERVAL,
    invalidos_maximos   INTEGER,
    ventana_invalidos   INTERVAL,
    bloqueo             INTERVAL
)
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT 60, INTERVAL '5 minutes', 10, INTERVAL '10 minutes', INTERVAL '15 minutes';
$$;

REVOKE ALL ON FUNCTION app_private.parametros_limite_escaneo()
    FROM PUBLIC, anon, authenticated, service_role;


-- ================================================================
-- 7. GUARDAS DE LAS TABLAS (defensa en profundidad)
-- ================================================================
-- La barrera real es que ningún rol de aplicación tiene privilegios sobre las
-- tablas. Estas guardas protegen además contra un error del propietario: ni él
-- reescribe un evento. La única excepción es el mantenimiento de retención, que
-- se declara con una variable de transacción que SOLO fija esa función. Un rol
-- de aplicación podría fijar la variable, pero sin privilegio de UPDATE ni de
-- DELETE no llega a ninguna fila.

-- 7.1 Eventos
CREATE OR REPLACE FUNCTION app_private.proteger_acceso_servicio()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_mantenimiento BOOLEAN :=
        pg_catalog.current_setting('ept65.mantenimiento', TRUE) IS NOT DISTINCT FROM 'on';
    v_tipo          public.tipo_servicio_escolar;
    v_dia           DATE;
BEGIN
    IF TG_OP = 'DELETE' THEN
        -- Solo el mantenimiento elimina, y solo denegaciones vencidas.
        IF NOT v_mantenimiento OR OLD.resultado IS DISTINCT FROM 'DENEGADO' THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P5662',
                MESSAGE = 'Los accesos registrados no se eliminan: el historial se conserva.';
        END IF;
        RETURN OLD;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        -- Solo la anonimización del mantenimiento: los identificadores pasan a
        -- NULL, se sella la fecha y todo lo demás queda idéntico.
        IF NOT v_mantenimiento
           OR OLD.resultado IS DISTINCT FROM 'REGISTRADO'
           OR OLD.anonimizado_en IS NOT NULL
           OR NEW.anonimizado_en IS NULL
           OR NEW.id IS DISTINCT FROM OLD.id
           OR NEW.servicio_id IS DISTINCT FROM OLD.servicio_id
           OR NEW.sentido IS DISTINCT FROM OLD.sentido
           OR NEW.resultado IS DISTINCT FROM OLD.resultado
           OR NEW.motivo_denegacion IS DISTINCT FROM OLD.motivo_denegacion
           OR NEW.registrado_en IS DISTINCT FROM OLD.registrado_en
           OR NEW.intento_id IS NOT NULL
           OR NEW.operador_perfil_id IS NOT NULL
           OR NEW.credencial_id IS NOT NULL
           OR NEW.alumno_id IS NOT NULL THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P5662',
                MESSAGE = 'Un acceso registrado no se modifica: solo el mantenimiento puede anonimizarlo.';
        END IF;
        RETURN NEW;
    END IF;

    -- TG_OP = 'INSERT'
    IF NEW.anonimizado_en IS NOT NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5662',
            MESSAGE = 'Un acceso no nace anonimizado.';
    END IF;

    -- La fecha y la hora las sella la base: ni el propietario retrocede un evento.
    NEW.registrado_en := pg_catalog.clock_timestamp();

    SELECT s.tipo INTO v_tipo
    FROM public.servicios_escolares s
    WHERE s.id = NEW.servicio_id
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P5652', MESSAGE = 'El servicio declarado no existe.';
    END IF;

    IF (v_tipo = 'TRANSPORTE') IS DISTINCT FROM (NEW.sentido IS NOT NULL) THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5653',
            MESSAGE = 'El sentido es obligatorio en transporte y no corresponde al comedor.';
    END IF;

    IF NEW.resultado = 'REGISTRADO' THEN
        v_dia := ((NEW.registrado_en AT TIME ZONE 'America/Argentina/Buenos_Aires'))::DATE;

        -- Serializa con cualquier otro alta o anulación del mismo alumno, aun si
        -- alguien escribiera por fuera de la operación privilegiada.
        PERFORM 1 FROM public.alumnos a WHERE a.perfil_id = NEW.alumno_id FOR NO KEY UPDATE;

        IF EXISTS (
            SELECT 1
            FROM public.accesos_servicios e
            WHERE e.alumno_id = NEW.alumno_id
              AND e.servicio_id = NEW.servicio_id
              AND e.sentido IS NOT DISTINCT FROM NEW.sentido
              AND e.resultado = 'REGISTRADO'
              AND e.dia_servicio = v_dia
              AND NOT EXISTS (
                  SELECT 1 FROM public.anulaciones_accesos_servicios n WHERE n.acceso_id = e.id
              )
        ) THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P5660',
                MESSAGE = 'Ya existe un acceso vigente para ese alumno, servicio, día y sentido.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.proteger_acceso_servicio()
    FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER proteger_acceso_servicio_antes_de_escribir
    BEFORE INSERT OR UPDATE OR DELETE ON public.accesos_servicios
    FOR EACH ROW
    EXECUTE FUNCTION app_private.proteger_acceso_servicio();

-- 7.2 Anulaciones
CREATE OR REPLACE FUNCTION app_private.proteger_anulacion_acceso()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_mantenimiento BOOLEAN :=
        pg_catalog.current_setting('ept65.mantenimiento', TRUE) IS NOT DISTINCT FROM 'on';
    v_resultado     public.resultado_acceso_servicio;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5662',
            MESSAGE = 'Las anulaciones no se eliminan: el historial se conserva.';
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF NOT v_mantenimiento
           OR OLD.anonimizada_en IS NOT NULL
           OR NEW.anonimizada_en IS NULL
           OR NEW.acceso_id IS DISTINCT FROM OLD.acceso_id
           OR NEW.anulado_en IS DISTINCT FROM OLD.anulado_en
           OR NEW.anulado_por IS NOT NULL
           OR NEW.motivo IS NOT NULL THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P5662',
                MESSAGE = 'Una anulación no se modifica: solo el mantenimiento puede anonimizarla.';
        END IF;
        RETURN NEW;
    END IF;

    -- TG_OP = 'INSERT'
    IF NEW.anonimizada_en IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5662', MESSAGE = 'Una anulación no nace anonimizada.';
    END IF;

    SELECT e.resultado INTO v_resultado
    FROM public.accesos_servicios e
    WHERE e.id = NEW.acceso_id
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P5665', MESSAGE = 'El acceso solicitado no existe.';
    END IF;

    IF v_resultado IS DISTINCT FROM 'REGISTRADO' THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5663',
            MESSAGE = 'Solo se puede anular un acceso registrado.';
    END IF;

    NEW.anulado_en := pg_catalog.clock_timestamp();
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.proteger_anulacion_acceso()
    FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER proteger_anulacion_acceso_antes_de_escribir
    BEFORE INSERT OR UPDATE OR DELETE ON public.anulaciones_accesos_servicios
    FOR EACH ROW
    EXECUTE FUNCTION app_private.proteger_anulacion_acceso();

-- 7.3 TRUNCATE no dispara triggers de fila.
CREATE OR REPLACE FUNCTION app_private.impedir_vaciar_historial_accesos()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION USING
        ERRCODE = 'P5662',
        MESSAGE = 'El historial de accesos no puede vaciarse.';
END;
$$;

REVOKE ALL ON FUNCTION app_private.impedir_vaciar_historial_accesos()
    FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER impedir_vaciar_accesos_servicios
    BEFORE TRUNCATE ON public.accesos_servicios
    FOR EACH STATEMENT EXECUTE FUNCTION app_private.impedir_vaciar_historial_accesos();

CREATE TRIGGER impedir_vaciar_anulaciones_accesos
    BEFORE TRUNCATE ON public.anulaciones_accesos_servicios
    FOR EACH STATEMENT EXECUTE FUNCTION app_private.impedir_vaciar_historial_accesos();

-- 7.4 La auditoría del mantenimiento es de solo agregado.
CREATE OR REPLACE FUNCTION app_private.impedir_modificar_depuraciones()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION USING
        ERRCODE = 'P5662',
        MESSAGE = 'El registro de depuraciones es de solo agregado.';
END;
$$;

REVOKE ALL ON FUNCTION app_private.impedir_modificar_depuraciones()
    FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER impedir_modificar_depuraciones_accesos
    BEFORE UPDATE OR DELETE ON app_private.depuraciones_accesos_servicios
    FOR EACH ROW EXECUTE FUNCTION app_private.impedir_modificar_depuraciones();

CREATE TRIGGER impedir_vaciar_depuraciones_accesos
    BEFORE TRUNCATE ON app_private.depuraciones_accesos_servicios
    FOR EACH STATEMENT EXECUTE FUNCTION app_private.impedir_modificar_depuraciones();


-- ================================================================
-- 8. PRIVILEGIOS MÍNIMOS Y RLS DE LAS TABLAS
-- ================================================================
ALTER TABLE public.accesos_servicios            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.anulaciones_accesos_servicios ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.contadores_escaneo       ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.depuraciones_accesos_servicios ENABLE ROW LEVEL SECURITY;

-- Los privilegios por defecto de Supabase concederían ALL sobre tablas nuevas de
-- `public` a anon, authenticated y service_role: se parte de cero y NO se concede
-- nada. Dirección lee por la función de solo lectura, no por la tabla.
REVOKE ALL ON public.accesos_servicios             FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.anulaciones_accesos_servicios FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON app_private.contadores_escaneo       FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON app_private.depuraciones_accesos_servicios
    FROM PUBLIC, anon, authenticated, service_role;

-- Réplica de la política RESTRICTIVE de bloqueo de cuenta (EPT-59): mismo
-- nombre, mismo predicado, mismo alcance. No hay NINGUNA política permisiva: con
-- RLS activo y sin política, un rol que llegara a tener privilegio no vería ni
-- escribiría ninguna fila.
CREATE POLICY "Bloqueo de acceso sin datos protegidos"
    ON public.accesos_servicios
    AS RESTRICTIVE FOR ALL TO authenticated
    USING (NOT (SELECT app_private.acceso_bloqueado()))
    WITH CHECK (NOT (SELECT app_private.acceso_bloqueado()));

CREATE POLICY "Bloqueo de acceso sin datos protegidos"
    ON public.anulaciones_accesos_servicios
    AS RESTRICTIVE FOR ALL TO authenticated
    USING (NOT (SELECT app_private.acceso_bloqueado()))
    WITH CHECK (NOT (SELECT app_private.acceso_bloqueado()));


-- ================================================================
-- 9. OPERACIONES INTERNAS
-- ================================================================

-- 9.1 Identidad del operador, revalidada en cada ejecución
-- ----------------------------------------------------------------
-- Recibe el usuario que el servidor obtuvo de la sesión verificada y comprueba,
-- BAJO BLOQUEO de la fila del perfil, que sea DIRECTOR o PERSONAL con acceso
-- HABILITADO. Devuelve el identificador del perfil.
CREATE OR REPLACE FUNCTION app_private.operador_de_escaneo(p_actor_user_id UUID)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_perfil UUID;
    v_rol    TEXT;
    v_acceso public.estado_acceso;
BEGIN
    IF p_actor_user_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    -- FOR SHARE: un bloqueo concurrente (UPDATE de la fila) espera a que termine
    -- esta operación; si el bloqueo ya confirmó, se lee el estado nuevo.
    SELECT p.id, r.nombre, p.estado_acceso
    INTO v_perfil, v_rol, v_acceso
    FROM public.perfiles p
    JOIN public.roles r ON r.id = p.rol_id
    WHERE p.user_id = p_actor_user_id
    FOR SHARE OF p;

    IF NOT FOUND
       OR v_rol NOT IN ('DIRECTOR', 'PERSONAL')
       OR v_acceso IS DISTINCT FROM 'HABILITADO' THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Solo la dirección o el personal habilitados registran accesos.';
    END IF;

    RETURN v_perfil;
END;
$$;

REVOKE ALL ON FUNCTION app_private.operador_de_escaneo(UUID)
    FROM PUBLIC, anon, authenticated, service_role;

-- 9.2 Respuesta de un intento ya resuelto (reintento por timeout)
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.respuesta_de_intento(
    p_acceso_id     UUID,
    p_credencial_id UUID,
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
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_previo public.accesos_servicios;
BEGIN
    SELECT e.* INTO v_previo FROM public.accesos_servicios e WHERE e.id = p_acceso_id;

    -- Mismo intento con otros argumentos: no se devuelve nada del primero.
    IF v_previo.credencial_id IS DISTINCT FROM p_credencial_id
       OR v_previo.servicio_id IS DISTINCT FROM p_servicio_id
       OR v_previo.sentido IS DISTINCT FROM p_sentido THEN
        RETURN QUERY SELECT 'INTENTO_REUTILIZADO'::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT,
                            NULL::TIMESTAMP WITH TIME ZONE;
        RETURN;
    END IF;

    IF v_previo.resultado = 'REGISTRADO' THEN
        RETURN QUERY
        SELECT 'REGISTRADO'::TEXT, p.nombre::TEXT, p.apellido::TEXT, p.legajo_nro::TEXT, v_previo.registrado_en
        FROM public.perfiles p
        WHERE p.id = v_previo.alumno_id;
        RETURN;
    END IF;

    RETURN QUERY
    SELECT CASE WHEN v_previo.motivo_denegacion = 'YA_REGISTRADO' THEN 'YA_REGISTRADO' ELSE 'NO_HABILITADO' END,
           NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TIMESTAMP WITH TIME ZONE;
END;
$$;

REVOKE ALL ON FUNCTION app_private.respuesta_de_intento(UUID, UUID, UUID, public.sentido_acceso_transporte)
    FROM PUBLIC, anon, authenticated, service_role;


-- ================================================================
-- 10. OPERACIÓN PRIVILEGIADA: REGISTRAR UN ACCESO (solo service_role)
-- ================================================================
CREATE OR REPLACE FUNCTION app_private.registrar_acceso_servicio(
    p_actor_user_id UUID,
    p_intento_id    UUID,
    p_credencial_id UUID,
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

    IF p_intento_id IS NULL OR p_credencial_id IS NULL OR p_servicio_id IS NULL THEN
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

    -- 4. Credencial → alumno, SIN bloquear: `alumno_id` es inmutable y las filas no
    --    se borran. Un identificador inexistente no deja ningún evento.
    SELECT c.alumno_id INTO v_alumno FROM public.credenciales_qr c WHERE c.id = p_credencial_id;
    IF NOT FOUND THEN
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
    UUID, UUID, UUID, UUID, public.sentido_acceso_transporte
) FROM PUBLIC, anon, authenticated, service_role;


-- ================================================================
-- 11. LÍMITE DE INTENTOS POR CUENTA OPERADORA (solo service_role)
-- ================================================================
-- Atómico: un advisory lock por operador serializa el conteo y la inserción, así
-- que dos solicitudes simultáneas no pueden superar el tope. Se invoca ANTES de
-- verificar la firma y no recibe ni guarda el payload.

-- 11.1 Una solicitud: ¿se permite?
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

    SELECT l.solicitudes_maximas, l.ventana_solicitudes, l.bloqueo
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

-- 11.2 Un intento inválido (firma, formato, versión o kid): cuenta y puede bloquear.
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

    SELECT l.invalidos_maximos, l.ventana_invalidos, l.bloqueo
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


-- ================================================================
-- 12. OPERACIONES DE DIRECCIÓN (authenticated; el actor sale de auth.uid())
-- ================================================================

-- 12.1 Anular un acceso REGISTRADO
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

    SELECT e.resultado INTO v_resultado
    FROM public.accesos_servicios e
    WHERE e.id = p_acceso_id
    FOR SHARE;

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

-- 12.2 Consulta de solo lectura (solo Dirección)
CREATE OR REPLACE FUNCTION app_private.listar_accesos_servicios(
    p_dia           DATE,
    p_resultado     public.resultado_acceso_servicio,
    p_servicio_id   UUID,
    p_limite        INTEGER,
    p_desplazamiento INTEGER
)
RETURNS TABLE (
    total                BIGINT,
    id                   UUID,
    registrado_en        TIMESTAMP WITH TIME ZONE,
    dia_servicio         DATE,
    resultado            public.resultado_acceso_servicio,
    motivo_denegacion    public.motivo_denegacion_acceso,
    servicio_nombre      TEXT,
    servicio_tipo        public.tipo_servicio_escolar,
    sentido              public.sentido_acceso_transporte,
    alumno_nombre        TEXT,
    alumno_apellido      TEXT,
    alumno_legajo        TEXT,
    operador_nombre      TEXT,
    anulado              BOOLEAN,
    anulado_en           TIMESTAMP WITH TIME ZONE,
    anulado_por_nombre   TEXT,
    anulado_motivo       TEXT,
    anonimizado          BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_limite INTEGER := LEAST(GREATEST(COALESCE(p_limite, 50), 1), 100);
    v_desde  INTEGER := GREATEST(COALESCE(p_desplazamiento, 0), 0);
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    IF NOT app_private.es_director() THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Solo la dirección puede consultar los accesos registrados.';
    END IF;

    RETURN QUERY
    SELECT pg_catalog.count(*) OVER (),
           e.id,
           e.registrado_en,
           e.dia_servicio,
           e.resultado,
           e.motivo_denegacion,
           s.nombre::TEXT,
           s.tipo,
           e.sentido,
           pa.nombre::TEXT,
           pa.apellido::TEXT,
           pa.legajo_nro::TEXT,
           pg_catalog.concat_ws(' ', po.nombre, po.apellido),
           (n.acceso_id IS NOT NULL),
           n.anulado_en,
           pg_catalog.concat_ws(' ', pn.nombre, pn.apellido),
           n.motivo,
           (e.anonimizado_en IS NOT NULL)
    FROM public.accesos_servicios e
    JOIN public.servicios_escolares s ON s.id = e.servicio_id
    LEFT JOIN public.perfiles pa ON pa.id = e.alumno_id
    LEFT JOIN public.perfiles po ON po.id = e.operador_perfil_id
    LEFT JOIN public.anulaciones_accesos_servicios n ON n.acceso_id = e.id
    LEFT JOIN public.perfiles pn ON pn.id = n.anulado_por
    WHERE (p_dia IS NULL OR e.dia_servicio = p_dia)
      AND (p_resultado IS NULL OR e.resultado = p_resultado)
      AND (p_servicio_id IS NULL OR e.servicio_id = p_servicio_id)
    ORDER BY e.registrado_en DESC, e.id
    LIMIT v_limite OFFSET v_desde;
END;
$$;

REVOKE ALL ON FUNCTION app_private.anular_acceso_servicio(UUID, TEXT)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.listar_accesos_servicios(
    DATE, public.resultado_acceso_servicio, UUID, INTEGER, INTEGER
) FROM PUBLIC, anon, authenticated, service_role;


-- ================================================================
-- 13. MANTENIMIENTO DE RETENCIÓN (cerrado a todo rol de aplicación)
-- ================================================================
-- Runbook MANUAL en v1: lo ejecuta el propietario de la base (o quien reciba
-- el privilegio de forma explícita y documentada) con
--     SELECT * FROM app_private.depurar_accesos_servicios('<fin de ciclo lectivo>');
-- No se programa con pg_cron: habilitarlo requiere una aprobación nueva. El
-- responsable institucional y la primera fecha de depuración están PENDIENTES
-- de definición (ver docs/evidence/EPT-65.md): esta función no los inventa.
--
-- Qué hace, en una sola transacción:
--   * anonimiza los eventos REGISTRADO con día de servicio <= fin del ciclo
--     lectivo, siempre que ya hayan pasado 90 días desde esa fecha: quita el
--     operador, el alumno, la credencial y el intento, y conserva servicio,
--     sentido, resultado y fecha para estadística;
--   * anonimiza las anulaciones de esos eventos (autor y motivo libre);
--   * elimina las denegaciones de más de 90 días;
--   * elimina los contadores de más de 24 horas;
--   * deja una fila en el registro de auditoría de solo agregado.
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

    UPDATE public.anulaciones_accesos_servicios n
    SET anulado_por = NULL, motivo = NULL, anonimizada_en = v_ahora
    WHERE n.anonimizada_en IS NULL
      AND n.acceso_id IN (
          SELECT e.id FROM public.accesos_servicios e
          WHERE e.resultado = 'REGISTRADO'
            AND e.anonimizado_en IS NULL
            AND e.dia_servicio <= p_fin_ciclo_lectivo
      );
    GET DIAGNOSTICS v_anulaciones = ROW_COUNT;

    UPDATE public.accesos_servicios e
    SET intento_id = NULL, operador_perfil_id = NULL, credencial_id = NULL,
        alumno_id = NULL, anonimizado_en = v_ahora
    WHERE e.resultado = 'REGISTRADO'
      AND e.anonimizado_en IS NULL
      AND e.dia_servicio <= p_fin_ciclo_lectivo;
    GET DIAGNOSTICS v_accesos = ROW_COUNT;

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

-- Cerrada a TODO rol de aplicación. No se concede a nadie: el propietario es
-- quien la ejecuta, y cualquier otro privilegio debe otorgarse de forma
-- explícita, documentada y auditada.
REVOKE ALL ON FUNCTION app_private.depurar_accesos_servicios(DATE)
    FROM PUBLIC, anon, authenticated, service_role;


-- ================================================================
-- 14. ENVOLTORIOS PÚBLICOS (SECURITY INVOKER) Y EXECUTE MÍNIMO
-- ================================================================
-- PostgREST solo expone `public`; los envoltorios llaman a la operación privada.
-- Las tres operaciones del servidor (`service_role`) y las dos de Dirección
-- (`authenticated`) son las únicas con EXECUTE.
CREATE OR REPLACE FUNCTION public.consumir_cupo_escaneo(p_actor_user_id UUID)
RETURNS TABLE (permitido BOOLEAN, reintentar_en_segundos INTEGER)
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT * FROM app_private.consumir_cupo_escaneo(p_actor_user_id);
$$;

CREATE OR REPLACE FUNCTION public.registrar_escaneo_invalido(p_actor_user_id UUID)
RETURNS TABLE (bloqueado BOOLEAN, reintentar_en_segundos INTEGER)
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT * FROM app_private.registrar_escaneo_invalido(p_actor_user_id);
$$;

CREATE OR REPLACE FUNCTION public.registrar_acceso_servicio(
    p_actor_user_id UUID,
    p_intento_id    UUID,
    p_credencial_id UUID,
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
        p_actor_user_id, p_intento_id, p_credencial_id, p_servicio_id, p_sentido);
$$;

CREATE OR REPLACE FUNCTION public.anular_acceso_servicio(p_acceso_id UUID, p_motivo TEXT)
RETURNS public.anulaciones_accesos_servicios
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT * FROM app_private.anular_acceso_servicio(p_acceso_id, p_motivo);
$$;

CREATE OR REPLACE FUNCTION public.listar_accesos_servicios(
    p_dia            DATE DEFAULT NULL,
    p_resultado      public.resultado_acceso_servicio DEFAULT NULL,
    p_servicio_id    UUID DEFAULT NULL,
    p_limite         INTEGER DEFAULT 50,
    p_desplazamiento INTEGER DEFAULT 0
)
RETURNS TABLE (
    total                BIGINT,
    id                   UUID,
    registrado_en        TIMESTAMP WITH TIME ZONE,
    dia_servicio         DATE,
    resultado            public.resultado_acceso_servicio,
    motivo_denegacion    public.motivo_denegacion_acceso,
    servicio_nombre      TEXT,
    servicio_tipo        public.tipo_servicio_escolar,
    sentido              public.sentido_acceso_transporte,
    alumno_nombre        TEXT,
    alumno_apellido      TEXT,
    alumno_legajo        TEXT,
    operador_nombre      TEXT,
    anulado              BOOLEAN,
    anulado_en           TIMESTAMP WITH TIME ZONE,
    anulado_por_nombre   TEXT,
    anulado_motivo       TEXT,
    anonimizado          BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT * FROM app_private.listar_accesos_servicios(
        p_dia, p_resultado, p_servicio_id, p_limite, p_desplazamiento);
$$;

-- Se parte de cero: los privilegios por defecto concederían EXECUTE a anon.
REVOKE ALL ON FUNCTION public.consumir_cupo_escaneo(UUID)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.registrar_escaneo_invalido(UUID)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.registrar_acceso_servicio(
    UUID, UUID, UUID, UUID, public.sentido_acceso_transporte
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.anular_acceso_servicio(UUID, TEXT)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.listar_accesos_servicios(
    DATE, public.resultado_acceso_servicio, UUID, INTEGER, INTEGER
) FROM PUBLIC, anon, authenticated, service_role;

-- El servidor (service_role) ejecuta el límite y el registro. `GRANT USAGE ON
-- SCHEMA app_private TO service_role` ya lo otorgó EPT-59.
GRANT EXECUTE ON FUNCTION app_private.consumir_cupo_escaneo(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION app_private.registrar_escaneo_invalido(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION app_private.registrar_acceso_servicio(
    UUID, UUID, UUID, UUID, public.sentido_acceso_transporte
) TO service_role;
GRANT EXECUTE ON FUNCTION public.consumir_cupo_escaneo(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.registrar_escaneo_invalido(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.registrar_acceso_servicio(
    UUID, UUID, UUID, UUID, public.sentido_acceso_transporte
) TO service_role;

-- Dirección (authenticated): cada operación revalida auth.uid() y el rol.
GRANT EXECUTE ON FUNCTION app_private.anular_acceso_servicio(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.listar_accesos_servicios(
    DATE, public.resultado_acceso_servicio, UUID, INTEGER, INTEGER
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.anular_acceso_servicio(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_accesos_servicios(
    DATE, public.resultado_acceso_servicio, UUID, INTEGER, INTEGER
) TO authenticated;


-- ================================================================
-- 15. AUTOVERIFICACIÓN
-- ================================================================
DO $$
DECLARE
    v_firma  pg_catalog.regprocedure;
    v_tabla  pg_catalog.regclass;
    v_rol    TEXT;
    v_priv   TEXT;
BEGIN
    -- Tablas: RLS activo y NINGÚN privilegio para ningún rol de aplicación.
    FOREACH v_tabla IN ARRAY ARRAY[
        'public.accesos_servicios'::pg_catalog.regclass,
        'public.anulaciones_accesos_servicios'::pg_catalog.regclass,
        'app_private.contadores_escaneo'::pg_catalog.regclass,
        'app_private.depuraciones_accesos_servicios'::pg_catalog.regclass
    ] LOOP
        IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid = v_tabla) THEN
            RAISE EXCEPTION 'Autoverificación EPT-65: % no tiene RLS.', v_tabla;
        END IF;
        FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
            FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
                IF pg_catalog.has_table_privilege(v_rol, v_tabla, v_priv) THEN
                    RAISE EXCEPTION 'Autoverificación EPT-65: % tiene % sobre %.', v_rol, v_priv, v_tabla;
                END IF;
            END LOOP;
        END LOOP;
    END LOOP;

    -- Política de bloqueo de cuenta (EPT-59) y ninguna política permisiva.
    IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_policies p
        WHERE p.schemaname = 'public'
          AND p.tablename IN ('accesos_servicios', 'anulaciones_accesos_servicios')
          AND p.policyname = 'Bloqueo de acceso sin datos protegidos'
          AND p.permissive = 'RESTRICTIVE') <> 2
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_policies p
                  WHERE p.schemaname = 'public'
                    AND p.tablename IN ('accesos_servicios', 'anulaciones_accesos_servicios')
                    AND p.permissive = 'PERMISSIVE') THEN
        RAISE EXCEPTION 'Autoverificación EPT-65: las políticas de las tablas no son las previstas.';
    END IF;

    -- Operación privilegiada y límites: SOLO service_role.
    FOREACH v_firma IN ARRAY ARRAY[
        'app_private.registrar_acceso_servicio(uuid,uuid,uuid,uuid,public.sentido_acceso_transporte)'::pg_catalog.regprocedure,
        'app_private.consumir_cupo_escaneo(uuid)'::pg_catalog.regprocedure,
        'app_private.registrar_escaneo_invalido(uuid)'::pg_catalog.regprocedure,
        'public.registrar_acceso_servicio(uuid,uuid,uuid,uuid,public.sentido_acceso_transporte)'::pg_catalog.regprocedure,
        'public.consumir_cupo_escaneo(uuid)'::pg_catalog.regprocedure,
        'public.registrar_escaneo_invalido(uuid)'::pg_catalog.regprocedure
    ] LOOP
        IF pg_catalog.has_function_privilege('anon', v_firma, 'EXECUTE')
           OR pg_catalog.has_function_privilege('authenticated', v_firma, 'EXECUTE')
           OR NOT pg_catalog.has_function_privilege('service_role', v_firma, 'EXECUTE')
           OR EXISTS (
               SELECT 1 FROM pg_catalog.pg_proc p, pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
               WHERE p.oid = v_firma AND a.grantee = 0
           ) THEN
            RAISE EXCEPTION 'Autoverificación EPT-65: % no es ejecutable solo por service_role.', v_firma;
        END IF;
    END LOOP;

    -- Operaciones de Dirección: authenticated sí, anon no.
    FOREACH v_firma IN ARRAY ARRAY[
        'app_private.anular_acceso_servicio(uuid,text)'::pg_catalog.regprocedure,
        'app_private.listar_accesos_servicios(date,public.resultado_acceso_servicio,uuid,integer,integer)'::pg_catalog.regprocedure,
        'public.anular_acceso_servicio(uuid,text)'::pg_catalog.regprocedure,
        'public.listar_accesos_servicios(date,public.resultado_acceso_servicio,uuid,integer,integer)'::pg_catalog.regprocedure
    ] LOOP
        IF pg_catalog.has_function_privilege('anon', v_firma, 'EXECUTE')
           OR pg_catalog.has_function_privilege('service_role', v_firma, 'EXECUTE')
           OR NOT pg_catalog.has_function_privilege('authenticated', v_firma, 'EXECUTE') THEN
            RAISE EXCEPTION 'Autoverificación EPT-65: los privilegios de % no son los previstos.', v_firma;
        END IF;
    END LOOP;

    -- Internas y mantenimiento: ningún rol de aplicación.
    FOREACH v_firma IN ARRAY ARRAY[
        'app_private.operador_de_escaneo(uuid)'::pg_catalog.regprocedure,
        'app_private.respuesta_de_intento(uuid,uuid,uuid,public.sentido_acceso_transporte)'::pg_catalog.regprocedure,
        'app_private.parametros_limite_escaneo()'::pg_catalog.regprocedure,
        'app_private.depurar_accesos_servicios(date)'::pg_catalog.regprocedure,
        'app_private.proteger_acceso_servicio()'::pg_catalog.regprocedure,
        'app_private.proteger_anulacion_acceso()'::pg_catalog.regprocedure,
        'app_private.impedir_vaciar_historial_accesos()'::pg_catalog.regprocedure,
        'app_private.impedir_modificar_depuraciones()'::pg_catalog.regprocedure
    ] LOOP
        IF pg_catalog.has_function_privilege('anon', v_firma, 'EXECUTE')
           OR pg_catalog.has_function_privilege('authenticated', v_firma, 'EXECUTE')
           OR pg_catalog.has_function_privilege('service_role', v_firma, 'EXECUTE') THEN
            RAISE EXCEPTION 'Autoverificación EPT-65: % es ejecutable por un rol de aplicación.', v_firma;
        END IF;
    END LOOP;

    -- Ninguna columna guarda material de firma ni datos de dispositivo.
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_attribute a
        WHERE a.attrelid IN ('public.accesos_servicios'::pg_catalog.regclass,
                             'public.anulaciones_accesos_servicios'::pg_catalog.regclass)
          AND a.attnum > 0 AND NOT a.attisdropped
          AND (a.attname ~* 'payload|firma|secret|token|clave|dni|ip|agente|user_agent|imagen')
          AND a.attname NOT IN ('operador_perfil_id')
    ) THEN
        RAISE EXCEPTION 'Autoverificación EPT-65: una columna parece guardar material de firma o datos de dispositivo.';
    END IF;

    -- Triggers esperados.
    IF (SELECT pg_catalog.array_agg(t.tgname::TEXT ORDER BY t.tgname)
        FROM pg_catalog.pg_trigger t
        WHERE t.tgrelid = 'public.accesos_servicios'::pg_catalog.regclass
          AND NOT t.tgisinternal AND t.tgenabled = 'O')
       IS DISTINCT FROM ARRAY['impedir_vaciar_accesos_servicios',
                              'proteger_acceso_servicio_antes_de_escribir']::TEXT[] THEN
        RAISE EXCEPTION 'Autoverificación EPT-65: los triggers de accesos_servicios no son los previstos.';
    END IF;

    -- Conteos de preservación: la migración no altera datos funcionales.
    IF EXISTS (
        SELECT 1 FROM ept_065_conteos_iniciales c
        WHERE c.cantidad IS DISTINCT FROM CASE c.relacion
            WHEN 'credenciales_qr' THEN (SELECT pg_catalog.count(*) FROM public.credenciales_qr)
            WHEN 'inscripciones_servicios' THEN (SELECT pg_catalog.count(*) FROM public.inscripciones_servicios)
            WHEN 'servicios_escolares' THEN (SELECT pg_catalog.count(*) FROM public.servicios_escolares)
            WHEN 'alumnos' THEN (SELECT pg_catalog.count(*) FROM public.alumnos)
            WHEN 'perfiles' THEN (SELECT pg_catalog.count(*) FROM public.perfiles)
        END
    ) THEN
        RAISE EXCEPTION 'Autoverificación EPT-65: la migración alteró datos funcionales.';
    END IF;

    RAISE NOTICE 'Migración EPT-65: 4 tablas, operación privilegiada solo para service_role y 2 operaciones de Dirección instaladas.';
END $$;
