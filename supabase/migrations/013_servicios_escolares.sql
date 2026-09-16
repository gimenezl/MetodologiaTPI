-- ============================================================
-- EDUCAR PARA TRANSFORMAR — Servicios escolares e inscripciones (EPT-10)
-- ============================================================
-- Migración aditiva. No modifica ni renumera 001 a 012.
--
-- ============================================================
-- POR QUÉ UN MODELO NUEVO Y NO `public.inscripciones`
-- ============================================================
-- `public.inscripciones` (001) es la inscripción a una ACTIVIDAD: apunta a
-- `actividades` (deportes, talleres y materias) y su unicidad es total
-- `UNIQUE (estudiante_id, actividad_id)`. Reutilizarla para el comedor tendría
-- tres consecuencias inaceptables para esta historia:
--
--   1. Mezclaría inscripciones académicas, deportivas y de servicios escolares
--      en una misma relación, cuando EPT-11 (deportes) todavía es dueño de esa
--      tabla y de sus reglas de cupo.
--   2. Su unicidad total convierte el reingreso en una reactivación de la misma
--      fila, de modo que el ciclo anterior se pierde. EPT-10 exige conservar el
--      historial completo de altas y bajas.
--   3. Sus claves foráneas son `ON DELETE CASCADE`: borrar una actividad o un
--      perfil borraría el historial en silencio.
--
-- Por eso se crean relaciones propias y claramente nombradas. `inscripciones`
-- no se toca: no se le agregan columnas, privilegios, políticas ni filas.
--
-- ============================================================
-- MODELO
-- ============================================================
--   1. `public.servicios_escolares` es el CATÁLOGO de servicios. El comedor es
--      una fila reproducible, sembrada por esta migración con un identificador
--      fijo. `tipo` distingue COMEDOR de TRANSPORTE.
--
--   2. `public.inscripciones_servicios` es la INSCRIPCIÓN de un alumno a un
--      servicio concreto. Separar catálogo e inscripción es lo que hace que la
--      estructura sirva después para transporte (EPT-29): incorporar los cuatro
--      recorridos de EPT-60 es agregar filas al catálogo, no crear tablas.
--      Esta migración NO siembra ningún recorrido ni inventa sus atributos.
--
--   3. La baja es lógica. Cancelar cambia `estado` a CANCELADA y sella
--      `fecha_cancelacion`; nunca borra la fila. Volver a inscribirse crea una
--      fila NUEVA, así que cada ciclo queda registrado por separado.
--
--   4. El vínculo con el legajo es estructural, no una copia. `alumno_id` es el
--      `perfil_id` del alumno, y `perfiles.legajo_nro` es único y 1:1 con ese
--      perfil. Además, desde 008 un alumno ACTIVO no puede existir sin legajo
--      (P5512) y solo un alumno ACTIVO puede inscribirse. Una copia del legajo
--      podría quedar desactualizada ante una corrección de identidad; la
--      derivación no.
--
-- ============================================================
-- INVARIANTES Y CÓMO SE GARANTIZAN
-- ============================================================
-- | Invariante                                          | Garantía                     |
-- |-----------------------------------------------------|------------------------------|
-- | Una sola inscripción ACTIVA por alumno y servicio   | índice único parcial         |
-- | El alumno de la inscripción es el de la sesión      | RPC deriva de auth.uid()     |
-- | Solo un alumno ACTIVO se inscribe                   | trigger BEFORE + FOR SHARE   |
-- | Solo un perfil con rol ESTUDIANTE se inscribe       | RPC + rol derivado en la base|
-- | El alumno inscripto tiene legajo                    | trigger BEFORE (y P5512, 008)|
-- | Solo un servicio activo admite altas                | trigger BEFORE + FOR SHARE   |
-- | Alumno, servicio y fecha de alta inmutables         | trigger BEFORE               |
-- | La única transición es ACTIVA → CANCELADA           | trigger BEFORE               |
-- | Coherencia estado/fecha de cancelación              | CHECK                        |
-- | Historial conservado                                | sin DELETE y FK RESTRICT     |
-- | Sin borrado físico                                  | sin GRANT, política ni RPC   |
--
-- ============================================================
-- ORDEN DE BLOQUEOS
-- ============================================================
--     alumnos  →  perfiles  →  servicios_escolares  →  inscripciones_servicios
--
-- El trigger toma FOR SHARE en ese orden y ninguna operación sube en sentido
-- contrario, de modo que no hay ciclos. Dos altas simultáneas del mismo alumno
-- y servicio se serializan en el índice único parcial: confirma una sola y la
-- otra recibe SQLSTATE 23505. Un alta concurrente con la inactivación de su
-- servicio queda serializada por el bloqueo compartido sobre la fila.
--
-- ============================================================
-- CÓDIGOS SQLSTATE PROPIOS
-- ============================================================
-- Bloque nuevo P555x, sin colisión con 006–012.
--   P5505  se requiere una identidad autenticada          (reutilizado)
--   42501  el rol de la sesión no está autorizado         (reutilizado)
--   23505  ya existe una inscripción activa               (índice único parcial)
--   P5550  el servicio solicitado no existe
--   P5551  el servicio está inactivo
--   P5552  la sesión no corresponde a un alumno
--   P5553  el alumno no está ACTIVO
--   P5554  el alumno no tiene número de legajo
--   P5555  la inscripción no existe o no pertenece al alumno de la sesión
--   P5556  la inscripción ya está cancelada
--   P5557  la operación alteraría la identidad de una inscripción
--   P5558  la transición de estado solicitada no es válida
-- ============================================================


-- ================================================================
-- 1. PRECONDICIONES Y CONTEOS DE PRESERVACIÓN
-- ================================================================
DO $$
BEGIN
    IF pg_catalog.to_regclass('public.alumnos') IS NULL
       OR pg_catalog.to_regclass('public.perfiles') IS NULL
       OR pg_catalog.to_regclass('public.roles') IS NULL
       OR pg_catalog.to_regclass('public.inscripciones') IS NULL
    THEN
        RAISE EXCEPTION
            'Migración 013: faltan tablas base; la base no corresponde a 001–012.';
    END IF;

    IF pg_catalog.to_regprocedure('app_private.perfil_actual()') IS NULL
       OR pg_catalog.to_regprocedure('app_private.es_director()') IS NULL
       OR pg_catalog.to_regprocedure('app_private.rol_actual()') IS NULL
    THEN
        RAISE EXCEPTION
            'Migración 013: faltan las funciones de identidad de 003–008; la base no corresponde a 001–012.';
    END IF;

    IF pg_catalog.to_regclass('public.servicios_escolares') IS NOT NULL
       OR pg_catalog.to_regclass('public.inscripciones_servicios') IS NOT NULL
    THEN
        RAISE EXCEPTION
            'Migración 013: ya existen objetos de servicios escolares; revisá el estado de la base antes de continuar.';
    END IF;
END $$;

CREATE TEMPORARY TABLE ept_013_conteos_iniciales (
    relacion TEXT PRIMARY KEY,
    cantidad BIGINT NOT NULL
) ON COMMIT DROP;

INSERT INTO ept_013_conteos_iniciales (relacion, cantidad)
VALUES
    ('inscripciones', (SELECT pg_catalog.count(*) FROM public.inscripciones)),
    ('actividades', (SELECT pg_catalog.count(*) FROM public.actividades)),
    ('alumnos', (SELECT pg_catalog.count(*) FROM public.alumnos)),
    ('matriculas', (SELECT pg_catalog.count(*) FROM public.matriculas)),
    ('perfiles', (SELECT pg_catalog.count(*) FROM public.perfiles));


-- ================================================================
-- 2. CATÁLOGOS DE ESTADO
-- ================================================================
-- Tipos enumerados por la misma razón que en 008: son la garantía más fuerte en
-- la base y el generador de tipos de Supabase los proyecta como una unión exacta
-- de TypeScript.
--
-- `TRANSPORTE` existe en el tipo desde ahora porque RF5 y RF10 ya lo nombran y
-- porque EPT-29 pide una estructura reutilizable. Esta migración NO crea ningún
-- servicio de transporte: los cuatro recorridos y sus atributos son una decisión
-- de producto que pertenece a EPT-60.
CREATE TYPE public.tipo_servicio_escolar AS ENUM ('COMEDOR', 'TRANSPORTE');

-- ACTIVA y CANCELADA son los dos únicos estados de una inscripción. No hay un
-- estado de eliminación: la fila cancelada es el historial.
CREATE TYPE public.estado_inscripcion_servicio AS ENUM ('ACTIVA', 'CANCELADA');


-- ================================================================
-- 3. CONTRATO DE TEXTO DEL CATÁLOGO
-- ================================================================
-- Mismo conjunto de espacios en blanco laterales que `nombre_materia_valido`
-- (012). La API recorta antes de enviar; la base rechaza lo que llegue sin
-- recortar en lugar de corregirlo en silencio.
CREATE OR REPLACE FUNCTION app_private.texto_servicio_valido(
    p_texto  TEXT,
    p_maximo INTEGER
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT p_texto IS NOT NULL
       AND p_maximo IS NOT NULL
       AND pg_catalog.char_length(p_texto) BETWEEN 1 AND p_maximo
       AND p_texto = pg_catalog.btrim(
           p_texto,
           pg_catalog.concat(
               pg_catalog.chr(9),     -- tabulación
               pg_catalog.chr(10),    -- salto de línea
               pg_catalog.chr(11),    -- tabulación vertical
               pg_catalog.chr(12),    -- avance de página
               pg_catalog.chr(13),    -- retorno de carro
               pg_catalog.chr(32),    -- espacio ASCII
               pg_catalog.chr(133),   -- next line
               pg_catalog.chr(160),   -- espacio no separable
               pg_catalog.chr(5760),  -- ogham space mark
               pg_catalog.chr(8192),  -- en quad
               pg_catalog.chr(8193),  -- em quad
               pg_catalog.chr(8194),  -- en space
               pg_catalog.chr(8195),  -- em space
               pg_catalog.chr(8196),  -- three-per-em space
               pg_catalog.chr(8197),  -- four-per-em space
               pg_catalog.chr(8198),  -- six-per-em space
               pg_catalog.chr(8199),  -- figure space
               pg_catalog.chr(8200),  -- punctuation space
               pg_catalog.chr(8201),  -- thin space
               pg_catalog.chr(8202),  -- hair space
               pg_catalog.chr(8232),  -- line separator
               pg_catalog.chr(8233),  -- paragraph separator
               pg_catalog.chr(8239),  -- narrow no-break space
               pg_catalog.chr(8287),  -- medium mathematical space
               pg_catalog.chr(12288), -- ideographic space
               pg_catalog.chr(65279)  -- zero width no-break space / BOM
           )
       );
$$;

-- El CHECK del catálogo se evalúa en cada UPDATE de la fila, así que el rol que
-- pueda actualizar el catálogo necesita EXECUTE. Hoy ningún rol de aplicación
-- escribe el catálogo; `service_role` lo necesita en el entorno local de
-- pruebas, igual que en 012.
REVOKE ALL ON FUNCTION app_private.texto_servicio_valido(TEXT, INTEGER)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.texto_servicio_valido(TEXT, INTEGER)
    TO authenticated, service_role;


-- ================================================================
-- 4. CATÁLOGO DE SERVICIOS ESCOLARES
-- ================================================================
CREATE TABLE public.servicios_escolares (
    id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
    tipo public.tipo_servicio_escolar NOT NULL,
    -- Identidad estable y legible del servicio. Es la clave por la que la
    -- aplicación y las pruebas lo resuelven sin depender de un UUID sembrado.
    codigo VARCHAR(30) NOT NULL,
    nombre VARCHAR(100) NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    fecha_actualizacion TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT servicios_escolares_codigo_unico UNIQUE (codigo),
    CONSTRAINT servicios_escolares_codigo_valido
        CHECK (app_private.texto_servicio_valido(codigo, 30) IS TRUE),
    CONSTRAINT servicios_escolares_nombre_valido
        CHECK (app_private.texto_servicio_valido(nombre, 100) IS TRUE)
);

COMMENT ON TABLE public.servicios_escolares IS
    'Catálogo de servicios escolares inscribibles. El comedor es una fila sembrada por la migración 013. Los recorridos de transporte son filas que agregará EPT-60; 013 no inventa ninguno.';

COMMENT ON COLUMN public.servicios_escolares.codigo IS
    'Identidad estable del servicio, única en todo el catálogo. La aplicación resuelve el comedor por codigo = ''COMEDOR''.';

-- Sirve al listado administrativo por tipo y al filtro de servicios activos.
CREATE INDEX idx_servicios_escolares_tipo_activo
    ON public.servicios_escolares (tipo, activo);

-- ----------------------------------------------------------------
-- Semilla reproducible del comedor
-- ----------------------------------------------------------------
-- El identificador es un literal fijo y no un valor generado: un `db reset`
-- vuelve a producir exactamente la misma fila, de modo que la evidencia y las
-- pruebas son reproducibles. No se siembra ningún servicio de transporte.
INSERT INTO public.servicios_escolares (id, tipo, codigo, nombre, activo)
VALUES (
    'e0000000-0000-4000-8000-000000000010',
    'COMEDOR',
    'COMEDOR',
    'Comedor escolar',
    TRUE
);


-- ================================================================
-- 5. INSCRIPCIONES A SERVICIOS ESCOLARES
-- ================================================================
CREATE TABLE public.inscripciones_servicios (
    id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
    -- ON DELETE RESTRICT en las dos referencias: el historial de inscripciones
    -- nunca desaparece por el borrado de una fila relacionada.
    alumno_id UUID NOT NULL
        REFERENCES public.alumnos(perfil_id) ON DELETE RESTRICT,
    servicio_id UUID NOT NULL
        REFERENCES public.servicios_escolares(id) ON DELETE RESTRICT,
    estado public.estado_inscripcion_servicio NOT NULL DEFAULT 'ACTIVA',
    fecha_inscripcion TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    -- Marcador inequívoco de la baja lógica.
    fecha_cancelacion TIMESTAMP WITH TIME ZONE,
    CONSTRAINT inscripciones_servicios_cancelacion_coherente
        CHECK ((estado = 'CANCELADA') = (fecha_cancelacion IS NOT NULL)),
    CONSTRAINT inscripciones_servicios_cancelacion_posterior
        CHECK (fecha_cancelacion IS NULL OR fecha_cancelacion >= fecha_inscripcion)
);

COMMENT ON TABLE public.inscripciones_servicios IS
    'Inscripción de un alumno a un servicio escolar. La baja es lógica y el reingreso crea una fila nueva, de modo que se conservan todos los ciclos. Nunca se elimina.';

-- Autoridad única de «una sola inscripción activa por alumno y servicio» ante
-- concurrencia. Al ser PARCIAL sobre estado = 'ACTIVA', las filas canceladas
-- quedan fuera y el reingreso puede crear una fila nueva sin colisionar con el
-- historial. Dos altas simultáneas no pueden confirmar las dos: la perdedora
-- recibe SQLSTATE 23505.
CREATE UNIQUE INDEX idx_inscripciones_servicios_una_activa
    ON public.inscripciones_servicios (alumno_id, servicio_id)
    WHERE estado = 'ACTIVA';

-- Índice del historial propio del alumno y de la clave foránea hacia alumnos.
CREATE INDEX idx_inscripciones_servicios_alumno
    ON public.inscripciones_servicios (alumno_id, fecha_inscripcion DESC);

-- Índice de la clave foránea hacia el catálogo y de la consulta administrativa,
-- que lista por servicio y estado.
CREATE INDEX idx_inscripciones_servicios_servicio
    ON public.inscripciones_servicios (servicio_id, estado);


-- ================================================================
-- 6. INVARIANTES DE INSCRIPCIÓN
-- ================================================================
-- Esta función es la autoridad única de las reglas de fila, también ante
-- concurrencia y también si alguien escribiera la tabla por fuera de las RPC.
CREATE OR REPLACE FUNCTION app_private.validar_inscripcion_servicio()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_estado_alumno  public.estado_alumno;
    v_legajo         VARCHAR(50);
    v_servicio_activo BOOLEAN;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        -- La identidad de una inscripción es el trío alumno–servicio–alta.
        -- Cambiar cualquiera de los tres reescribiría el historial.
        IF NEW.alumno_id IS DISTINCT FROM OLD.alumno_id
           OR NEW.servicio_id IS DISTINCT FROM OLD.servicio_id
           OR NEW.fecha_inscripcion IS DISTINCT FROM OLD.fecha_inscripcion THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P5557',
                MESSAGE = 'El alumno, el servicio y la fecha de alta de una inscripción no pueden modificarse.';
        END IF;

        -- La única transición admitida es la baja lógica. Volver a inscribirse
        -- es una fila nueva, nunca la reactivación de una cancelada: así se
        -- conservan todos los ciclos anteriores.
        IF OLD.estado = 'CANCELADA' AND NEW.estado = 'ACTIVA' THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P5558',
                MESSAGE = 'Una inscripción cancelada no se reactiva. Volvé a inscribirte para registrar un ciclo nuevo.';
        END IF;

        IF OLD.estado = 'CANCELADA' AND NEW.estado = 'CANCELADA' THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P5556',
                MESSAGE = 'La inscripción ya está cancelada.';
        END IF;

        IF NEW.estado = 'CANCELADA' THEN
            -- La fecha de baja la sella la base, no quien llama.
            NEW.fecha_cancelacion := NOW();
        END IF;

        RETURN NEW;
    END IF;

    -- A partir de acá, TG_OP = 'INSERT'. Una inscripción nueva siempre nace
    -- ACTIVA: no se admite sembrar historial cancelado por esta vía.
    IF NEW.estado <> 'ACTIVA' THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5558',
            MESSAGE = 'Una inscripción nueva solo puede crearse en estado ACTIVA.';
    END IF;

    SELECT a.estado, p.legajo_nro
    INTO v_estado_alumno, v_legajo
    FROM public.alumnos a
    JOIN public.perfiles p ON p.id = a.perfil_id
    WHERE a.perfil_id = NEW.alumno_id
    FOR SHARE OF a, p;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5552',
            MESSAGE = 'La persona indicada no tiene legajo académico de alumno.';
    END IF;

    IF v_estado_alumno <> 'ACTIVO' THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5553',
            MESSAGE = 'Solo un alumno con estado ACTIVO puede inscribirse a un servicio escolar.';
    END IF;

    -- Desde 008 un alumno ACTIVO no puede existir sin legajo (P5512). Esta
    -- comprobación es la defensa en profundidad que hace explícito el vínculo
    -- que exige EPT-10, en lugar de darlo por supuesto.
    IF v_legajo IS NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5554',
            MESSAGE = 'El alumno no tiene número de legajo y no puede inscribirse.';
    END IF;

    SELECT s.activo
    INTO v_servicio_activo
    FROM public.servicios_escolares s
    WHERE s.id = NEW.servicio_id
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5550',
            MESSAGE = 'El servicio solicitado no existe.';
    END IF;

    IF NOT v_servicio_activo THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5551',
            MESSAGE = 'El servicio está inactivo y no admite nuevas inscripciones.';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.validar_inscripcion_servicio()
    FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER validar_inscripcion_servicio_antes_de_escribir
    BEFORE INSERT OR UPDATE ON public.inscripciones_servicios
    FOR EACH ROW
    EXECUTE FUNCTION app_private.validar_inscripcion_servicio();

-- Un servicio con inscripciones no puede cambiar de tipo ni de código: el
-- historial quedaría atribuido a otro servicio.
CREATE OR REPLACE FUNCTION app_private.proteger_identidad_servicio()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF (NEW.tipo IS DISTINCT FROM OLD.tipo OR NEW.codigo IS DISTINCT FROM OLD.codigo)
       AND EXISTS (
           SELECT 1 FROM public.inscripciones_servicios i
           WHERE i.servicio_id = OLD.id
       ) THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5557',
            MESSAGE = 'Un servicio con inscripciones no puede cambiar de tipo ni de código.';
    END IF;

    NEW.fecha_creacion := OLD.fecha_creacion;
    NEW.fecha_actualizacion := NOW();
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.proteger_identidad_servicio()
    FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER proteger_identidad_servicio_antes_de_actualizar
    BEFORE UPDATE ON public.servicios_escolares
    FOR EACH ROW
    EXECUTE FUNCTION app_private.proteger_identidad_servicio();


-- ================================================================
-- 7. VISTA DE LECTURA
-- ================================================================
-- `security_invoker = true`: la vista respeta las políticas RLS y los
-- privilegios de quien consulta, nunca los del propietario. Una sola vista
-- sirve a los dos actores porque RLS ya decide qué filas ve cada uno: el
-- estudiante solo las propias, el director todas.
--
-- El legajo se resuelve acá, en la lectura, desde `perfiles`. No hay ninguna
-- copia persistida en `inscripciones_servicios`.
CREATE VIEW public.inscripciones_servicios_detalle
WITH (security_invoker = true) AS
SELECT
    i.id,
    i.alumno_id,
    p.nombre            AS alumno_nombre,
    p.apellido          AS alumno_apellido,
    p.legajo_nro,
    a.estado            AS alumno_estado,
    i.servicio_id,
    s.tipo              AS servicio_tipo,
    s.codigo            AS servicio_codigo,
    s.nombre            AS servicio_nombre,
    s.activo            AS servicio_activo,
    i.estado,
    i.fecha_inscripcion,
    i.fecha_cancelacion
FROM public.inscripciones_servicios i
JOIN public.alumnos a ON a.perfil_id = i.alumno_id
JOIN public.perfiles p ON p.id = i.alumno_id
JOIN public.servicios_escolares s ON s.id = i.servicio_id;

COMMENT ON VIEW public.inscripciones_servicios_detalle IS
    'Inscripciones a servicios escolares con alumno, legajo y servicio resueltos, incluidas las canceladas. Respeta RLS mediante security_invoker.';


-- ================================================================
-- 8. OPERACIONES PRIVILEGIADAS
-- ================================================================
-- Todas viven en `app_private`, que la Data API no expone. Todas derivan la
-- identidad del alumno de `auth.uid()`; ninguna recibe alumno, perfil, usuario,
-- legajo ni rol como parámetro, de modo que el navegador no puede elegir en
-- nombre de quién opera. No existe ninguna operación de eliminación.

CREATE OR REPLACE FUNCTION app_private.inscribir_en_servicio(p_servicio_id UUID)
RETURNS public.inscripciones_servicios
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_perfil_id   UUID;
    v_rol         TEXT;
    v_inscripcion public.inscripciones_servicios;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    IF p_servicio_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5550', MESSAGE = 'El servicio solicitado no existe.';
    END IF;

    v_perfil_id := app_private.perfil_actual();
    v_rol := app_private.rol_actual();

    IF v_perfil_id IS NULL OR v_rol IS DISTINCT FROM 'ESTUDIANTE' THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Solo un estudiante puede inscribirse a un servicio escolar.';
    END IF;

    -- El alumno es SIEMPRE el de la sesión. El trigger de la sección 6 verifica
    -- su estado, su legajo y el servicio, también ante concurrencia.
    INSERT INTO public.inscripciones_servicios (alumno_id, servicio_id)
    VALUES (v_perfil_id, p_servicio_id)
    RETURNING * INTO v_inscripcion;

    RETURN v_inscripcion;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.cancelar_inscripcion_servicio(p_inscripcion_id UUID)
RETURNS public.inscripciones_servicios
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_perfil_id   UUID;
    v_rol         TEXT;
    v_inscripcion public.inscripciones_servicios;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    v_perfil_id := app_private.perfil_actual();
    v_rol := app_private.rol_actual();

    IF v_perfil_id IS NULL OR v_rol IS DISTINCT FROM 'ESTUDIANTE' THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Solo un estudiante puede cancelar su inscripción a un servicio escolar.';
    END IF;

    -- El filtro por `alumno_id` es lo que impide cancelar la inscripción de otra
    -- persona. Una inscripción ajena no produce un error distinto del de una
    -- inexistente: no se delata que exista.
    UPDATE public.inscripciones_servicios
    SET estado = 'CANCELADA'
    WHERE id = p_inscripcion_id
      AND alumno_id = v_perfil_id
      AND estado = 'ACTIVA'
    RETURNING * INTO v_inscripcion;

    IF v_inscripcion.id IS NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P5555',
            MESSAGE = 'No encontramos una inscripción activa tuya para cancelar.';
    END IF;

    RETURN v_inscripcion;
END;
$$;

REVOKE ALL ON FUNCTION app_private.inscribir_en_servicio(UUID)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.cancelar_inscripcion_servicio(UUID)
    FROM PUBLIC, anon, authenticated, service_role;

-- Los envoltorios SECURITY INVOKER necesitan ejecutar la operación privada.
-- Cada una vuelve a validar auth.uid() y el rol dentro de PostgreSQL.
GRANT EXECUTE ON FUNCTION app_private.inscribir_en_servicio(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.cancelar_inscripcion_servicio(UUID) TO authenticated;


-- ================================================================
-- 9. ENVOLTORIOS PÚBLICOS PARA POSTGREST
-- ================================================================
-- Punto de entrada único para que el servidor de la aplicación resuelva el rol
-- de la sesión sin leer datos que el propio actor pueda editar. Es el mismo
-- patrón de `public.es_director_actual()` (003): SECURITY INVOKER, la lógica
-- privilegiada queda contenida en `app_private.rol_actual()` (005), que deriva
-- todo de `auth.uid()` contra `perfiles` + `roles`. `perfiles.rol_id` no tiene
-- privilegio de UPDATE para ningún rol de aplicación (011), así que la fuente
-- que decide la autorización no es modificable por quien se autoriza.
CREATE OR REPLACE FUNCTION public.rol_actual()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT app_private.rol_actual();
$$;

CREATE OR REPLACE FUNCTION public.inscribir_en_servicio(p_servicio_id UUID)
RETURNS public.inscripciones_servicios
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT app_private.inscribir_en_servicio(p_servicio_id);
$$;

CREATE OR REPLACE FUNCTION public.cancelar_inscripcion_servicio(p_inscripcion_id UUID)
RETURNS public.inscripciones_servicios
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT app_private.cancelar_inscripcion_servicio(p_inscripcion_id);
$$;

-- Los privilegios por defecto de Supabase conceden EXECUTE sobre funciones
-- nuevas de `public` a anon; se parte de cero y se concede lo mínimo.
REVOKE ALL ON FUNCTION public.rol_actual() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.inscribir_en_servicio(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancelar_inscripcion_servicio(UUID) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.rol_actual() TO authenticated;
GRANT EXECUTE ON FUNCTION public.inscribir_en_servicio(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancelar_inscripcion_servicio(UUID) TO authenticated;


-- ================================================================
-- 10. PRIVILEGIOS MÍNIMOS Y RLS
-- ================================================================
-- `GRANT ALL ON ALL TABLES` de 001 fue una instantánea sobre las tablas de
-- entonces y no alcanza a estas; aun así se revoca explícitamente antes de
-- conceder, para no depender de los privilegios por defecto del esquema.

-- ----------------------------------------------------------------
-- Catálogo de servicios: lectura para cualquier sesión autenticada
-- ----------------------------------------------------------------
-- El estudiante necesita saber que el comedor existe para poder inscribirse, y
-- el director para consultar el listado. Es un catálogo institucional sin datos
-- personales, así que la lectura se concede a `authenticated` y a nadie más.
-- No hay privilegio ni política de escritura para ningún rol de aplicación.
ALTER TABLE public.servicios_escolares ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.servicios_escolares FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.servicios_escolares TO authenticated;

CREATE POLICY "Los servicios escolares son visibles para las sesiones autenticadas"
    ON public.servicios_escolares
    FOR SELECT TO authenticated
    USING (TRUE);

-- ----------------------------------------------------------------
-- Inscripciones: cada alumno ve lo suyo; el director ve el listado
-- ----------------------------------------------------------------
ALTER TABLE public.inscripciones_servicios ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.inscripciones_servicios FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.inscripciones_servicios TO authenticated;

-- Acceso a lo propio y nada más. Un estudiante ajeno no obtiene un error que
-- delate la existencia de otra inscripción: simplemente no hay filas.
-- DOCENTE, PADRE y PERSONAL no tienen legajo académico propio, así que esta
-- política tampoco les devuelve nada. `anon` queda fuera por falta de GRANT.
-- El predicado exige además conservar el rol ESTUDIANTE, igual que hicieron las
-- políticas académicas en 009: el acceso propio es consecuencia del rol vigente
-- y no de un vínculo histórico.
CREATE POLICY "El estudiante consulta sus propias inscripciones a servicios"
    ON public.inscripciones_servicios
    FOR SELECT TO authenticated
    USING (
        alumno_id = (SELECT app_private.perfil_actual())
        AND (SELECT app_private.rol_actual()) = 'ESTUDIANTE'
    );

CREATE POLICY "El director consulta todas las inscripciones a servicios"
    ON public.inscripciones_servicios
    FOR SELECT TO authenticated
    USING ((SELECT public.es_director_actual()));

-- No se crea ninguna política INSERT, UPDATE ni DELETE en ninguna de las dos
-- tablas. Aunque alguien otorgara el privilegio por error, RLS seguiría
-- rechazando la escritura directa.

REVOKE ALL ON public.inscripciones_servicios_detalle FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.inscripciones_servicios_detalle TO authenticated;


-- ================================================================
-- 11. AUTOVERIFICACIÓN
-- ================================================================
DO $$
DECLARE
    v_relacion   TEXT;
    v_antes      BIGINT;
    v_despues    BIGINT;
    v_privilegio TEXT;
    v_rol        TEXT;
    v_tabla      TEXT;
    v_firma      pg_catalog.regprocedure;
BEGIN
    FOREACH v_relacion IN ARRAY ARRAY[
        'inscripciones', 'actividades', 'alumnos', 'matriculas', 'perfiles'
    ] LOOP
        SELECT cantidad INTO v_antes
        FROM ept_013_conteos_iniciales WHERE relacion = v_relacion;

        v_despues := CASE v_relacion
            WHEN 'inscripciones' THEN (SELECT pg_catalog.count(*) FROM public.inscripciones)
            WHEN 'actividades' THEN (SELECT pg_catalog.count(*) FROM public.actividades)
            WHEN 'alumnos' THEN (SELECT pg_catalog.count(*) FROM public.alumnos)
            WHEN 'matriculas' THEN (SELECT pg_catalog.count(*) FROM public.matriculas)
            WHEN 'perfiles' THEN (SELECT pg_catalog.count(*) FROM public.perfiles)
        END;

        IF v_despues <> v_antes THEN
            RAISE EXCEPTION 'Autoverificación 013: % cambió de % a % filas.',
                v_relacion, v_antes, v_despues;
        END IF;
    END LOOP;

    IF (SELECT pg_catalog.count(*) FROM public.servicios_escolares
        WHERE codigo = 'COMEDOR' AND tipo = 'COMEDOR' AND activo) <> 1 THEN
        RAISE EXCEPTION 'Autoverificación 013: el servicio de comedor no quedó sembrado y activo.';
    END IF;

    IF EXISTS (SELECT 1 FROM public.servicios_escolares WHERE tipo = 'TRANSPORTE') THEN
        RAISE EXCEPTION
            'Autoverificación 013: se sembró un servicio de transporte; los recorridos son decisión de EPT-60.';
    END IF;

    IF EXISTS (SELECT 1 FROM public.inscripciones_servicios) THEN
        RAISE EXCEPTION 'Autoverificación 013: la migración creó inscripciones.';
    END IF;

    -- Ningún privilegio de escritura ni de borrado para los roles de aplicación.
    FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        FOREACH v_tabla IN ARRAY ARRAY[
            'public.servicios_escolares', 'public.inscripciones_servicios'
        ] LOOP
            FOREACH v_privilegio IN ARRAY ARRAY[
                'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
            ] LOOP
                IF pg_catalog.has_table_privilege(v_rol, v_tabla, v_privilegio) THEN
                    RAISE EXCEPTION 'Autoverificación 013: % conserva % sobre %.',
                        v_rol, v_privilegio, v_tabla;
                END IF;
            END LOOP;
        END LOOP;
    END LOOP;

    IF pg_catalog.has_table_privilege('anon', 'public.servicios_escolares', 'SELECT')
       OR pg_catalog.has_table_privilege('anon', 'public.inscripciones_servicios', 'SELECT')
       OR pg_catalog.has_table_privilege('anon', 'public.inscripciones_servicios_detalle', 'SELECT') THEN
        RAISE EXCEPTION 'Autoverificación 013: anon puede leer objetos de servicios escolares.';
    END IF;

    IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class
            WHERE oid = 'public.servicios_escolares'::pg_catalog.regclass)
       OR NOT (SELECT relrowsecurity FROM pg_catalog.pg_class
               WHERE oid = 'public.inscripciones_servicios'::pg_catalog.regclass) THEN
        RAISE EXCEPTION 'Autoverificación 013: una tabla de servicios escolares no tiene RLS.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_policies
        WHERE schemaname = 'public'
          AND tablename IN ('servicios_escolares', 'inscripciones_servicios')
          AND cmd <> 'SELECT'
    ) THEN
        RAISE EXCEPTION 'Autoverificación 013: existe una política de escritura sobre servicios escolares.';
    END IF;

    IF NOT ('security_invoker=true' = ANY (
        COALESCE((SELECT reloptions FROM pg_catalog.pg_class
                  WHERE oid = 'public.inscripciones_servicios_detalle'::pg_catalog.regclass),
                 ARRAY[]::TEXT[])
    )) THEN
        RAISE EXCEPTION 'Autoverificación 013: la vista de inscripciones no es security_invoker.';
    END IF;

    -- Las funciones privilegiadas viven en app_private, fijan search_path vacío
    -- y no son ejecutables por anon; los envoltorios públicos son INVOKER.
    FOREACH v_firma IN ARRAY ARRAY[
        'app_private.inscribir_en_servicio(uuid)'::pg_catalog.regprocedure,
        'app_private.cancelar_inscripcion_servicio(uuid)'::pg_catalog.regprocedure,
        'app_private.validar_inscripcion_servicio()'::pg_catalog.regprocedure,
        'app_private.proteger_identidad_servicio()'::pg_catalog.regprocedure
    ] LOOP
        IF NOT (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid = v_firma)
           OR (SELECT proconfig FROM pg_catalog.pg_proc WHERE oid = v_firma)
               IS DISTINCT FROM ARRAY['search_path=""']
           OR pg_catalog.has_function_privilege('anon', v_firma, 'EXECUTE') THEN
            RAISE EXCEPTION
                'Autoverificación 013: % no es SECURITY DEFINER con search_path vacío o es ejecutable por anon.',
                v_firma;
        END IF;
    END LOOP;

    FOREACH v_firma IN ARRAY ARRAY[
        'public.rol_actual()'::pg_catalog.regprocedure,
        'public.inscribir_en_servicio(uuid)'::pg_catalog.regprocedure,
        'public.cancelar_inscripcion_servicio(uuid)'::pg_catalog.regprocedure
    ] LOOP
        IF (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid = v_firma)
           OR (SELECT proconfig FROM pg_catalog.pg_proc WHERE oid = v_firma)
               IS DISTINCT FROM ARRAY['search_path=""']
           OR pg_catalog.has_function_privilege('anon', v_firma, 'EXECUTE')
           OR NOT pg_catalog.has_function_privilege('authenticated', v_firma, 'EXECUTE') THEN
            RAISE EXCEPTION 'Autoverificación 013: el envoltorio % no es SECURITY INVOKER mínimo.', v_firma;
        END IF;
    END LOOP;

    -- Ninguna RPC acepta identidad, rol ni legajo del llamador.
    IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('public', 'app_private')
          AND p.proname IN ('inscribir_en_servicio', 'cancelar_inscripcion_servicio')
          AND EXISTS (
              SELECT 1 FROM pg_catalog.unnest(COALESCE(p.proargnames, ARRAY[]::TEXT[])) AS nombre
              WHERE nombre ILIKE '%user%' OR nombre ILIKE '%rol%'
                 OR nombre ILIKE '%actor%' OR nombre ILIKE '%alumno%'
                 OR nombre ILIKE '%perfil%' OR nombre ILIKE '%legajo%'
          )
    ) THEN
        RAISE EXCEPTION 'Autoverificación 013: una RPC de servicios acepta identidad, rol o legajo del llamador.';
    END IF;

    -- Las claves foráneas del historial son restrictivas.
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conrelid = 'public.inscripciones_servicios'::pg_catalog.regclass
          AND contype = 'f'
          AND confdeltype <> 'r'
    ) THEN
        RAISE EXCEPTION
            'Autoverificación 013: una clave foránea de inscripciones_servicios no es ON DELETE RESTRICT.';
    END IF;

    -- Ninguna de las dos tablas depende de una secuencia, así que no hay
    -- privilegios de secuencia que revocar ni que puedan quedar expuestos.
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_attribute a
        JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attrelid IN (
                  'public.servicios_escolares'::pg_catalog.regclass,
                  'public.inscripciones_servicios'::pg_catalog.regclass
              )
          AND pg_catalog.pg_get_expr(d.adbin, d.adrelid) ILIKE '%nextval%'
    ) THEN
        RAISE EXCEPTION 'Autoverificación 013: una tabla de servicios escolares depende de una secuencia.';
    END IF;

    RAISE NOTICE
        'Migración 013: catálogo de servicios escolares creado con % servicio(s) (comedor sembrado); % inscripción(es) de actividades preservada(s) sin cambios.',
        (SELECT pg_catalog.count(*) FROM public.servicios_escolares),
        (SELECT pg_catalog.count(*) FROM public.inscripciones);
END $$;
