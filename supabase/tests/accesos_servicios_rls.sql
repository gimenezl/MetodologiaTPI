-- ============================================================
-- EDUCAR PARA TRANSFORMAR — Verificación del registro de accesos con QR (EPT-65, RF21)
-- ============================================================
-- Verifica la migración 20261001012522_ept_65_registro_accesos_qr.sql.
--
-- Ejecutar exclusivamente contra la base local descartable. Todo ocurre dentro
-- de una transacción con ROLLBACK: no deja datos residuales.
--
--     docker cp supabase/tests/accesos_servicios_rls.sql \
--       supabase_db_ept65:/tmp/
--     docker exec supabase_db_ept65 \
--       psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 \
--       -f /tmp/accesos_servicios_rls.sql
--
-- (En Git Bash exportar MSYS_NO_PATHCONV=1 antes de docker cp/exec.)
--
-- Cada comprobación imprime `OK <código>` o aborta con `FALLO <código>`.
--
--   Mapa de secciones
--     A. estructura: privilegios de tabla y de función, RLS, política de bloqueo
--     B. actores: quién puede ejecutar qué (matriz por rol)
--     C. comedor: primer acceso, repetición, cambio de día de Buenos Aires
--     D. transporte: IDA, VUELTA, repetición, recorrido declarado
--     E. denegaciones: motivos internos y respuesta genérica
--     F. idempotencia: reintento, reuso con otros argumentos, otro operador
--     G. anulación: libera el cupo, no borra historia, no se repite
--     H. lectura de Dirección y privacidad por actor
--     I. límite de intentos por cuenta operadora
--     J. ataque directo: id conocido sin payload firmado
--     K. retención: anonimización, eliminación y mantenimiento cerrado
--     L. auditoría de EPT-64: consultar_validez_credencial_qr
--
-- Todos los datos son sintéticos: DNI en un rango libre elegido en tiempo de
-- ejecución, sin correspondencia con ninguna persona real.

\set ON_ERROR_STOP on
\pset tuples_only on
\o /dev/null

BEGIN;

-- ================================================================
-- 0. HERRAMIENTAS
-- ================================================================
CREATE FUNCTION pg_temp.u(p_sufijo TEXT)
RETURNS UUID LANGUAGE sql IMMUTABLE AS $$
    SELECT ('ea650000-0000-4000-8000-0000000000' || p_sufijo)::UUID;
$$;

CREATE FUNCTION pg_temp.ejecutar(p_rol TEXT, p_sub UUID, p_sql TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
    v TEXT;
BEGIN
    BEGIN
        PERFORM pg_catalog.set_config('request.jwt.claims',
            CASE WHEN p_sub IS NULL THEN pg_catalog.json_build_object('role', p_rol)::TEXT
                 ELSE pg_catalog.json_build_object('sub', p_sub, 'role', p_rol)::TEXT END,
            true);
        EXECUTE pg_catalog.format('SET LOCAL ROLE %I', p_rol);
        EXECUTE p_sql INTO v;
        RESET ROLE;
        PERFORM pg_catalog.set_config('request.jwt.claims', '{}', true);
        v := 'OK:' || COALESCE(v, '<NULL>');
    EXCEPTION WHEN OTHERS THEN
        RESET ROLE;
        PERFORM pg_catalog.set_config('request.jwt.claims', '{}', true);
        v := 'E:' || SQLSTATE;
    END;
    RETURN v;
END;
$$;

-- Ejecuta como el propietario (postgres) y devuelve OK:<valor> o E:<SQLSTATE>.
CREATE FUNCTION pg_temp.propietario(p_sql TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
    v TEXT;
BEGIN
    BEGIN
        EXECUTE p_sql INTO v;
        v := 'OK:' || COALESCE(v, '<NULL>');
    EXCEPTION WHEN OTHERS THEN
        v := 'E:' || SQLSTATE;
    END;
    RETURN v;
END;
$$;

CREATE FUNCTION pg_temp.esperar(p_resultado TEXT, p_esperado TEXT, p_mensaje TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    IF p_resultado = 'E:42P17' THEN
        RAISE EXCEPTION 'FALLO % → recursión de políticas (42P17)', p_mensaje;
    END IF;
    IF (p_esperado = 'OK' AND p_resultado NOT LIKE 'OK%')
       OR (p_esperado <> 'OK' AND p_resultado IS DISTINCT FROM 'E:' || p_esperado) THEN
        RAISE EXCEPTION 'FALLO % → se obtuvo %, se esperaba %', p_mensaje, p_resultado, p_esperado;
    END IF;
    RAISE NOTICE 'OK %', p_mensaje;
END;
$$;

CREATE FUNCTION pg_temp.exigir(p_condicion BOOLEAN, p_mensaje TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    IF p_condicion IS NOT TRUE THEN
        RAISE EXCEPTION 'FALLO %', p_mensaje;
    END IF;
    RAISE NOTICE 'OK %', p_mensaje;
END;
$$;

CREATE FUNCTION pg_temp.valor(p_resultado TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
    IF p_resultado NOT LIKE 'OK:%' THEN
        RAISE EXCEPTION 'FALLO se esperaba éxito y se obtuvo %', p_resultado;
    END IF;
    RETURN pg_catalog.substr(p_resultado, 4);
END;
$$;

CREATE FUNCTION pg_temp.esperar_valor(p_resultado TEXT, p_esperado TEXT, p_mensaje TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    IF p_resultado IS DISTINCT FROM 'OK:' || p_esperado THEN
        RAISE EXCEPTION 'FALLO % → se obtuvo %, se esperaba OK:%', p_mensaje, p_resultado, p_esperado;
    END IF;
    RAISE NOTICE 'OK %', p_mensaje;
END;
$$;

CREATE TEMPORARY TABLE fx (clave TEXT PRIMARY KEY, valor TEXT NOT NULL) ON COMMIT DROP;

CREATE FUNCTION pg_temp.fx(p_clave TEXT)
RETURNS TEXT LANGUAGE sql STABLE AS $$
    SELECT valor FROM fx WHERE clave = p_clave;
$$;

CREATE FUNCTION pg_temp.guardar(p_clave TEXT, p_valor TEXT)
RETURNS VOID LANGUAGE sql AS $$
    INSERT INTO fx (clave, valor) VALUES (p_clave, p_valor)
    ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor;
$$;

-- Como Dirección (sesión de usuario con auth.uid() = 01).
CREATE FUNCTION pg_temp.dir(p_sql TEXT)
RETURNS TEXT LANGUAGE sql AS $$
    SELECT pg_temp.ejecutar('authenticated', pg_temp.u('01'), p_sql);
$$;

CREATE FUNCTION pg_temp.como(p_sufijo TEXT, p_sql TEXT)
RETURNS TEXT LANGUAGE sql AS $$
    SELECT pg_temp.ejecutar('authenticated', pg_temp.u(p_sufijo), p_sql);
$$;

-- Como el servidor: service_role, SIN identidad de usuario en el JWT.
CREATE FUNCTION pg_temp.srv(p_sql TEXT)
RETURNS TEXT LANGUAGE sql AS $$
    SELECT pg_temp.ejecutar('service_role', NULL, p_sql);
$$;

-- Escaneo completo como el servidor: devuelve el código de resultado.
-- p_actor es el sufijo del usuario; p_intento un UUID (texto); p_cred el id.
CREATE FUNCTION pg_temp.escanear(p_actor TEXT, p_intento TEXT, p_cred TEXT, p_serv TEXT, p_sentido TEXT DEFAULT NULL)
RETURNS TEXT LANGUAGE sql AS $$
    SELECT pg_temp.srv(pg_catalog.format(
        'SELECT codigo_resultado FROM public.registrar_acceso_servicio(%L, %L, %L, ''k1'', %L, %L)',
        pg_temp.u(p_actor), p_intento, p_cred, p_serv, p_sentido));
$$;

CREATE FUNCTION pg_temp.intento() RETURNS TEXT LANGUAGE sql AS $$
    SELECT pg_catalog.gen_random_uuid()::TEXT;
$$;

-- Eventos del alumno (vistos como propietario).
CREATE FUNCTION pg_temp.eventos(p_alumno UUID, p_resultado TEXT DEFAULT NULL)
RETURNS BIGINT LANGUAGE sql AS $$
    SELECT pg_catalog.count(*) FROM public.accesos_servicios
    WHERE alumno_id = p_alumno AND (p_resultado IS NULL OR resultado::TEXT = p_resultado);
$$;

CREATE FUNCTION pg_temp.total_eventos() RETURNS BIGINT LANGUAGE sql AS $$
    SELECT pg_catalog.count(*) FROM public.accesos_servicios;
$$;


-- ================================================================
-- DATOS SINTÉTICOS
-- ================================================================
WITH base_libre AS (
    SELECT base
    FROM generate_series(93000000, 93999980, 40) AS g(base)
    WHERE NOT EXISTS (
        SELECT 1 FROM public.perfiles p
        WHERE p.dni IN (SELECT (base + k)::TEXT FROM generate_series(1, 40) AS s(k))
    )
    ORDER BY base
    LIMIT 1
), identidades(sufijo, rol, nombre, apellido, legajo, desplazamiento, estado_acceso) AS (
    VALUES
        ('01', 'DIRECTOR',   'Directora', 'Operadora Uno',     NULL,             1,  'HABILITADO'),
        ('02', 'DIRECTOR',   'Directora', 'Bloqueada',         NULL,             2,  'BLOQUEADO'),
        ('03', 'PERSONAL',   'Paula',     'Personal Uno',      NULL,             3,  'HABILITADO'),
        ('04', 'PERSONAL',   'Pedro',     'Personal Bloqueado', NULL,            4,  'BLOQUEADO'),
        ('05', 'DOCENTE',    'Ana',       'Docente',           NULL,             5,  'HABILITADO'),
        ('06', 'PADRE',      'Pablo',     'Padre',             NULL,             6,  'HABILITADO'),
        ('07', 'PERSONAL',   'Pilar',     'Personal Dos',      NULL,             7,  'HABILITADO'),
        ('10', 'ESTUDIANTE', 'Uno',       'Alumna Comedor',    'LEG-EPT65-0010', 10, 'HABILITADO'),
        ('11', 'ESTUDIANTE', 'Dos',       'Alumno Sur',        'LEG-EPT65-0011', 11, 'HABILITADO'),
        ('12', 'ESTUDIANTE', 'Tres',      'Alumna Inactivada', 'LEG-EPT65-0012', 12, 'HABILITADO'),
        ('13', 'ESTUDIANTE', 'Cuatro',    'Alumno Bloqueado',  'LEG-EPT65-0013', 13, 'HABILITADO'),
        ('14', 'ESTUDIANTE', 'Cinco',     'Alumna Sin Servicio','LEG-EPT65-0014', 14, 'HABILITADO'),
        ('15', 'ESTUDIANTE', 'Seis',      'Alumno Revocado',   'LEG-EPT65-0015', 15, 'HABILITADO'),
        ('16', 'ESTUDIANTE', 'Siete',     'Alumna Cancelada',  'LEG-EPT65-0016', 16, 'HABILITADO'),
        ('17', 'ESTUDIANTE', 'Ocho',      'Alumno Este',       'LEG-EPT65-0017', 17, 'HABILITADO'),
        ('18', 'ESTUDIANTE', 'Nueve',     'Alumna Anulada',    'LEG-EPT65-0018', 18, 'HABILITADO'),
        ('19', 'ESTUDIANTE', 'Diez',      'Alumno Cambio Dia', 'LEG-EPT65-0019', 19, 'HABILITADO'),
        ('1a', 'ESTUDIANTE', 'Once',      'Alumna Retencion',  'LEG-EPT65-001A', 20, 'HABILITADO'),
        ('1b', 'ESTUDIANTE', 'Doce',      'Alumno Intento',    'LEG-EPT65-001B', 21, 'HABILITADO')
)
INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni, legajo_nro, estado_acceso)
SELECT pg_temp.u(i.sufijo), pg_temp.u(i.sufijo), r.id, i.nombre, i.apellido,
       (b.base + i.desplazamiento)::TEXT, i.legajo, i.estado_acceso::public.estado_acceso
FROM identidades i
JOIN public.roles r ON r.nombre = i.rol
CROSS JOIN base_libre b;

-- La cuenta autenticada sin perfil es `…0c`: no tiene fila en perfiles.

INSERT INTO public.cursos (id, nivel_id, denominacion, division, activo)
VALUES (pg_temp.u('c1'), (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'), 'Curso EPT65', 'A', TRUE);

INSERT INTO public.matriculas (alumno_id, curso_id)
SELECT pg_temp.u(s), pg_temp.u('c1')
FROM (VALUES ('10'), ('11'), ('12'), ('13'), ('14'), ('15'), ('16'), ('17'), ('18'), ('19'), ('1a'), ('1b')) AS t(s);

UPDATE public.alumnos SET estado = 'ACTIVO'
WHERE perfil_id IN (SELECT pg_temp.u(s) FROM (VALUES ('10'), ('11'), ('12'), ('13'), ('14'), ('15'),
                    ('16'), ('17'), ('18'), ('19'), ('1a'), ('1b')) AS t(s));

SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

-- Servicios del catálogo (sembrados por 013 y EPT-60).
SELECT pg_temp.guardar('comedor', 'e0000000-0000-4000-8000-000000000010');
SELECT pg_temp.guardar('norte',   'e0000000-0000-4000-8000-000000000020');
SELECT pg_temp.guardar('sur',     'e0000000-0000-4000-8000-000000000021');
SELECT pg_temp.guardar('este',    'e0000000-0000-4000-8000-000000000022');

-- Inscripciones activas (escritas como propietario: pasan por el trigger de 013/060).
INSERT INTO public.inscripciones_servicios (alumno_id, servicio_id)
VALUES (pg_temp.u('10'), pg_temp.fx('comedor')::UUID),
       (pg_temp.u('10'), pg_temp.fx('norte')::UUID),
       (pg_temp.u('11'), pg_temp.fx('comedor')::UUID),
       (pg_temp.u('11'), pg_temp.fx('sur')::UUID),
       (pg_temp.u('12'), pg_temp.fx('comedor')::UUID),
       (pg_temp.u('13'), pg_temp.fx('comedor')::UUID),
       (pg_temp.u('15'), pg_temp.fx('comedor')::UUID),
       (pg_temp.u('16'), pg_temp.fx('comedor')::UUID),
       (pg_temp.u('17'), pg_temp.fx('este')::UUID),
       (pg_temp.u('18'), pg_temp.fx('comedor')::UUID),
       (pg_temp.u('19'), pg_temp.fx('comedor')::UUID),
       (pg_temp.u('1a'), pg_temp.fx('comedor')::UUID),
       (pg_temp.u('1b'), pg_temp.fx('comedor')::UUID);

-- Credenciales: se emiten por la operación real de Dirección (EPT-64).
DO $$
DECLARE
    v_s TEXT;
    v_id TEXT;
BEGIN
    FOREACH v_s IN ARRAY ARRAY['10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '1a', '1b'] LOOP
        v_id := pg_temp.valor(pg_temp.dir(pg_catalog.format(
            'SELECT (public.emitir_credencial_qr(%L, %L)).id::TEXT', pg_temp.u(v_s), 'k1')));
        PERFORM pg_temp.guardar('cred_' || v_s, v_id);
    END LOOP;
END $$;

SELECT pg_temp.guardar('desconocida', 'ea650000-0000-4000-8000-0000000000ff');


-- ================================================================
-- A. ESTRUCTURA
-- ================================================================
DO $$
DECLARE
    v_tabla TEXT;
    v_rol   TEXT;
    v_priv  TEXT;
BEGIN
    FOREACH v_tabla IN ARRAY ARRAY['public.accesos_servicios', 'public.anulaciones_accesos_servicios',
                                   'app_private.contadores_escaneo', 'app_private.depuraciones_accesos_servicios'] LOOP
        PERFORM pg_temp.exigir(
            (SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid = v_tabla::pg_catalog.regclass),
            '[A1] RLS activa en ' || v_tabla);
        FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
            FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
                PERFORM pg_temp.exigir(
                    NOT pg_catalog.has_table_privilege(v_rol, v_tabla, v_priv),
                    '[A2] ' || v_rol || ' no tiene ' || v_priv || ' sobre ' || v_tabla);
            END LOOP;
        END LOOP;
    END LOOP;
END $$;

SELECT pg_temp.exigir(
    (SELECT pg_catalog.count(*) FROM pg_catalog.pg_policies
     WHERE schemaname = 'public' AND tablename IN ('accesos_servicios', 'anulaciones_accesos_servicios')
       AND policyname = 'Bloqueo de acceso sin datos protegidos' AND permissive = 'RESTRICTIVE') = 2
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies
                    WHERE schemaname = 'public' AND tablename IN ('accesos_servicios', 'anulaciones_accesos_servicios')
                      AND permissive = 'PERMISSIVE'),
    '[A3] solo la política restrictiva de bloqueo; ninguna política permisiva');

-- EXECUTE de la operación privilegiada y del límite: SOLO service_role.
DO $$
DECLARE
    v_firma TEXT;
BEGIN
    FOREACH v_firma IN ARRAY ARRAY[
        'public.registrar_acceso_servicio(uuid,uuid,uuid,text,uuid,public.sentido_acceso_transporte)',
        'public.consumir_cupo_escaneo(uuid)',
        'public.registrar_escaneo_invalido(uuid)',
        'app_private.registrar_acceso_servicio(uuid,uuid,uuid,text,uuid,public.sentido_acceso_transporte)',
        'app_private.consumir_cupo_escaneo(uuid)',
        'app_private.registrar_escaneo_invalido(uuid)'
    ] LOOP
        PERFORM pg_temp.exigir(
            NOT pg_catalog.has_function_privilege('anon', v_firma::pg_catalog.regprocedure, 'EXECUTE')
            AND NOT pg_catalog.has_function_privilege('authenticated', v_firma::pg_catalog.regprocedure, 'EXECUTE')
            AND pg_catalog.has_function_privilege('service_role', v_firma::pg_catalog.regprocedure, 'EXECUTE')
            AND NOT EXISTS (
                SELECT 1 FROM pg_catalog.pg_proc p,
                     pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
                WHERE p.oid = v_firma::pg_catalog.regprocedure AND a.grantee = 0),
            '[A4] ' || v_firma || ' la ejecuta solo service_role (ni anon, ni authenticated, ni PUBLIC)');
    END LOOP;

    FOREACH v_firma IN ARRAY ARRAY[
        'app_private.operador_de_escaneo(uuid)',
        'app_private.respuesta_de_intento(uuid,uuid,uuid,public.sentido_acceso_transporte)',
        'app_private.parametros_limite_escaneo()',
        'app_private.depurar_accesos_servicios(date)'
    ] LOOP
        PERFORM pg_temp.exigir(
            NOT pg_catalog.has_function_privilege('anon', v_firma::pg_catalog.regprocedure, 'EXECUTE')
            AND NOT pg_catalog.has_function_privilege('authenticated', v_firma::pg_catalog.regprocedure, 'EXECUTE')
            AND NOT pg_catalog.has_function_privilege('service_role', v_firma::pg_catalog.regprocedure, 'EXECUTE'),
            '[A5] ' || v_firma || ' no la ejecuta ningún rol de aplicación');
    END LOOP;
END $$;

-- La operación privilegiada es la única que recibe un actor como argumento.
SELECT pg_temp.exigir(
    (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc p
     JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname IN ('anular_acceso_servicio', 'listar_accesos_servicios')
       AND (p.proargnames[1:p.pronargs]::TEXT ~* 'actor|user|perfil|rol')) = 0,
    '[A6] las operaciones de Dirección no aceptan actor: lo derivan de auth.uid()');


-- ================================================================
-- B. ACTORES: QUIÉN PUEDE EJECUTAR LA OPERACIÓN
-- ================================================================
-- Como `authenticated` (con su propio usuario como «actor») la operación no
-- existe: sin EXECUTE falla con 42501 sea cual sea el rol de aplicación.
DO $$
DECLARE
    v_s   TEXT;
    v_sql TEXT;
BEGIN
    FOREACH v_s IN ARRAY ARRAY['01', '02', '03', '04', '05', '06', '10', '0c'] LOOP
        v_sql := pg_catalog.format(
            'SELECT codigo_resultado FROM public.registrar_acceso_servicio(%L, %L, %L, ''k1'', %L, NULL)',
            pg_temp.u(v_s), pg_catalog.gen_random_uuid(), pg_temp.fx('cred_10'), pg_temp.fx('comedor'));
        PERFORM pg_temp.esperar(pg_temp.como(v_s, v_sql), '42501',
            '[B1] authenticated (' || v_s || ') no ejecuta registrar_acceso_servicio, ni como su propio actor');
    END LOOP;
END $$;

SELECT pg_temp.esperar(
    pg_temp.ejecutar('anon', NULL, pg_catalog.format(
        'SELECT codigo_resultado FROM public.registrar_acceso_servicio(%L, %L, %L, ''k1'', %L, NULL)',
        pg_temp.u('03'), pg_catalog.gen_random_uuid(), pg_temp.fx('cred_10'), pg_temp.fx('comedor'))),
    '42501', '[B2] anon no ejecuta registrar_acceso_servicio');

-- Con service_role el actor se revalida en la base.
SELECT pg_temp.esperar_valor(
    pg_temp.escanear('01', pg_temp.intento(), pg_temp.fx('cred_14'), pg_temp.fx('comedor')),
    'NO_HABILITADO', '[B3] DIRECTOR habilitado opera (alumna sin inscripción → NO_HABILITADO)');
SELECT pg_temp.esperar_valor(
    pg_temp.escanear('03', pg_temp.intento(), pg_temp.fx('cred_14'), pg_temp.fx('comedor')),
    'NO_HABILITADO', '[B4] PERSONAL habilitado opera');

DO $$
DECLARE
    v_s TEXT;
BEGIN
    -- Bloqueados, docente, padre, estudiante y cuenta sin perfil: la base rechaza
    -- aunque el servidor (por error) los enviara como actor.
    FOREACH v_s IN ARRAY ARRAY['02', '04', '05', '06', '10', '0c'] LOOP
        PERFORM pg_temp.esperar(
            pg_temp.escanear(v_s, pg_temp.intento(), pg_temp.fx('cred_10'), pg_temp.fx('comedor')),
            '42501', '[B5] actor ' || v_s || ' (bloqueado, docente, padre, estudiante o sin perfil) es rechazado por la base');
    END LOOP;
END $$;

SELECT pg_temp.esperar(
    pg_temp.srv(pg_catalog.format(
        'SELECT codigo_resultado FROM public.registrar_acceso_servicio(NULL, %L, %L, ''k1'', %L, NULL)',
        pg_catalog.gen_random_uuid(), pg_temp.fx('cred_10'), pg_temp.fx('comedor'))),
    'P5505', '[B6] sin actor → P5505');
SELECT pg_temp.esperar(
    pg_temp.srv(pg_catalog.format(
        'SELECT codigo_resultado FROM public.registrar_acceso_servicio(%L, %L, %L, ''k1'', %L, NULL)',
        pg_catalog.gen_random_uuid(), pg_catalog.gen_random_uuid(), pg_temp.fx('cred_10'), pg_temp.fx('comedor'))),
    '42501', '[B7] un actor inventado (usuario inexistente) → 42501');

SELECT pg_temp.exigir(pg_temp.total_eventos() = (SELECT pg_catalog.count(*) FROM public.accesos_servicios
                                                  WHERE operador_perfil_id IN (pg_temp.u('01'), pg_temp.u('03'))),
    '[B8] ninguna ejecución rechazada dejó un evento de un actor no autorizado');

-- Argumentos nulos con un actor válido: error, sin evento.
SELECT pg_temp.esperar(
    pg_temp.srv(pg_catalog.format(
        'SELECT codigo_resultado FROM public.registrar_acceso_servicio(%L, NULL, %L, ''k1'', %L, NULL)',
        pg_temp.u('03'), pg_temp.fx('cred_10'), pg_temp.fx('comedor'))),
    'P5651', '[B9] intento nulo → P5651');


-- ================================================================
-- C. COMEDOR
-- ================================================================
DO $$
DECLARE
    v_intento TEXT := pg_catalog.gen_random_uuid()::TEXT;
    v_antes   TIMESTAMPTZ := pg_catalog.clock_timestamp();
    v_resp    RECORD;
BEGIN
    SELECT * INTO v_resp FROM public.registrar_acceso_servicio(pg_temp.u('03'), v_intento::UUID,
        pg_temp.fx('cred_10')::UUID, 'k1', pg_temp.fx('comedor')::UUID, NULL);
    -- Como propietario: se comprueba la forma de la respuesta.
    PERFORM pg_temp.exigir(v_resp.codigo_resultado = 'REGISTRADO'
        AND v_resp.alumno_nombre = 'Uno' AND v_resp.alumno_apellido = 'Alumna Comedor'
        AND v_resp.alumno_legajo = 'LEG-EPT65-0010'
        AND v_resp.sellado_en BETWEEN v_antes AND pg_catalog.clock_timestamp(),
        '[C1] primer acceso al comedor: REGISTRADO con nombre, apellido, legajo y hora sellada por la base');
END $$;

SELECT pg_temp.exigir(
    pg_temp.eventos(pg_temp.u('10'), 'REGISTRADO') = 1
    AND (SELECT sentido IS NULL AND dia_servicio = (pg_catalog.clock_timestamp() AT TIME ZONE 'America/Argentina/Buenos_Aires')::DATE
         FROM public.accesos_servicios WHERE alumno_id = pg_temp.u('10')),
    '[C2] queda una fila REGISTRADO, sin sentido, con el día de Buenos Aires');

SELECT pg_temp.esperar_valor(
    pg_temp.escanear('03', pg_temp.intento(), pg_temp.fx('cred_10'), pg_temp.fx('comedor')),
    'YA_REGISTRADO', '[C3] segundo acceso el mismo día → YA_REGISTRADO');
SELECT pg_temp.exigir(
    pg_temp.eventos(pg_temp.u('10'), 'REGISTRADO') = 1 AND pg_temp.eventos(pg_temp.u('10'), 'DENEGADO') = 1
    AND (SELECT motivo_denegacion::TEXT FROM public.accesos_servicios
         WHERE alumno_id = pg_temp.u('10') AND resultado = 'DENEGADO') = 'YA_REGISTRADO',
    '[C4] el repetido persiste un DENEGADO con motivo interno YA_REGISTRADO y no duplica el REGISTRADO');

-- Otro operador, mismo día: sigue siendo YA_REGISTRADO.
SELECT pg_temp.esperar_valor(
    pg_temp.escanear('07', pg_temp.intento(), pg_temp.fx('cred_10'), pg_temp.fx('comedor')),
    'YA_REGISTRADO', '[C5] otro operador el mismo día → YA_REGISTRADO');

-- Cambio de día de Buenos Aires: un acceso de AYER no bloquea el de HOY.
ALTER TABLE public.accesos_servicios DISABLE TRIGGER proteger_acceso_servicio_antes_de_escribir;
INSERT INTO public.accesos_servicios (intento_id, operador_perfil_id, credencial_id, alumno_id, servicio_id,
                                      resultado, registrado_en)
VALUES (pg_catalog.gen_random_uuid(), pg_temp.u('03'), pg_temp.fx('cred_19')::UUID, pg_temp.u('19'),
        pg_temp.fx('comedor')::UUID, 'REGISTRADO',
        ((((pg_catalog.clock_timestamp() AT TIME ZONE 'America/Argentina/Buenos_Aires')::DATE - 1)::TIMESTAMP
          + TIME '12:00') AT TIME ZONE 'America/Argentina/Buenos_Aires'));
ALTER TABLE public.accesos_servicios ENABLE TRIGGER proteger_acceso_servicio_antes_de_escribir;

SELECT pg_temp.esperar_valor(
    pg_temp.escanear('03', pg_temp.intento(), pg_temp.fx('cred_19'), pg_temp.fx('comedor')),
    'REGISTRADO', '[C6] el acceso de ayer (BA) no bloquea el de hoy');
SELECT pg_temp.esperar_valor(
    pg_temp.escanear('03', pg_temp.intento(), pg_temp.fx('cred_19'), pg_temp.fx('comedor')),
    'YA_REGISTRADO', '[C7] y el de hoy sí bloquea al segundo de hoy');

-- El día es el de Buenos Aires, no el de UTC: 02:30 UTC es 23:30 del día anterior en BA.
ALTER TABLE public.accesos_servicios DISABLE TRIGGER proteger_acceso_servicio_antes_de_escribir;
INSERT INTO public.accesos_servicios (intento_id, operador_perfil_id, credencial_id, alumno_id, servicio_id,
                                      resultado, registrado_en)
VALUES (pg_catalog.gen_random_uuid(), pg_temp.u('03'), pg_temp.fx('cred_1b')::UUID, pg_temp.u('1b'),
        pg_temp.fx('comedor')::UUID, 'REGISTRADO', TIMESTAMPTZ '2030-03-10 02:30:00+00');
SELECT pg_temp.exigir(
    (SELECT dia_servicio FROM public.accesos_servicios
     WHERE alumno_id = pg_temp.u('1b') AND registrado_en = TIMESTAMPTZ '2030-03-10 02:30:00+00') = DATE '2030-03-09',
    '[C8] 02:30 UTC del 10/03 pertenece al 09/03 de Buenos Aires');
-- Limpieza de la fila de prueba, con la guarda desactivada solo aquí.
DELETE FROM public.accesos_servicios WHERE alumno_id = pg_temp.u('1b');
ALTER TABLE public.accesos_servicios ENABLE TRIGGER proteger_acceso_servicio_antes_de_escribir;


-- ================================================================
-- D. TRANSPORTE
-- ================================================================
SELECT pg_temp.esperar_valor(
    pg_temp.escanear('03', pg_temp.intento(), pg_temp.fx('cred_10'), pg_temp.fx('norte'), 'IDA'),
    'REGISTRADO', '[D1] transporte IDA en el recorrido propio → REGISTRADO');
SELECT pg_temp.esperar_valor(
    pg_temp.escanear('03', pg_temp.intento(), pg_temp.fx('cred_10'), pg_temp.fx('norte'), 'IDA'),
    'YA_REGISTRADO', '[D2] repetir IDA el mismo día → YA_REGISTRADO');
SELECT pg_temp.esperar_valor(
    pg_temp.escanear('03', pg_temp.intento(), pg_temp.fx('cred_10'), pg_temp.fx('norte'), 'VUELTA'),
    'REGISTRADO', '[D3] VUELTA el mismo día es otro sentido → REGISTRADO');
SELECT pg_temp.esperar_valor(
    pg_temp.escanear('03', pg_temp.intento(), pg_temp.fx('cred_10'), pg_temp.fx('norte'), 'VUELTA'),
    'YA_REGISTRADO', '[D4] repetir VUELTA → YA_REGISTRADO');
SELECT pg_temp.exigir(
    (SELECT pg_catalog.count(*) FROM public.accesos_servicios
     WHERE alumno_id = pg_temp.u('10') AND servicio_id = pg_temp.fx('norte')::UUID AND resultado = 'REGISTRADO') = 2,
    '[D5] exactamente dos REGISTRADO de transporte (IDA y VUELTA)');

-- El recorrido lo declara el operador: otro recorrido se deniega.
SELECT pg_temp.esperar_valor(
    pg_temp.escanear('03', pg_temp.intento(), pg_temp.fx('cred_11'), pg_temp.fx('norte'), 'IDA'),
    'NO_HABILITADO', '[D6] el alumno del recorrido SUR escaneado en NORTE → NO_HABILITADO');
SELECT pg_temp.exigir(
    (SELECT motivo_denegacion::TEXT FROM public.accesos_servicios
     WHERE alumno_id = pg_temp.u('11') AND resultado = 'DENEGADO') = 'RECORRIDO_DISTINTO',
    '[D7] el motivo interno es RECORRIDO_DISTINTO');
SELECT pg_temp.esperar_valor(
    pg_temp.escanear('03', pg_temp.intento(), pg_temp.fx('cred_11'), pg_temp.fx('sur'), 'IDA'),
    'REGISTRADO', '[D8] y en su recorrido propio sí se registra');
-- Un alumno sin transporte en un recorrido: SIN_INSCRIPCION, mismo mensaje genérico.
SELECT pg_temp.esperar_valor(
    pg_temp.escanear('03', pg_temp.intento(), pg_temp.fx('cred_14'), pg_temp.fx('norte'), 'IDA'),
    'NO_HABILITADO', '[D9] alumna sin transporte → NO_HABILITADO');
SELECT pg_temp.exigir(
    (SELECT motivo_denegacion::TEXT FROM public.accesos_servicios
     WHERE alumno_id = pg_temp.u('14') AND servicio_id = pg_temp.fx('norte')::UUID LIMIT 1) = 'SIN_INSCRIPCION',
    '[D10] el motivo interno es SIN_INSCRIPCION');

-- Coherencia sentido / servicio y servicio desconocido: error, sin evento.
SELECT pg_temp.esperar(
    pg_temp.escanear('03', pg_temp.intento(), pg_temp.fx('cred_10'), pg_temp.fx('norte'), NULL),
    'P5653', '[D11] transporte sin sentido → P5653');
SELECT pg_temp.esperar(
    pg_temp.escanear('03', pg_temp.intento(), pg_temp.fx('cred_10'), pg_temp.fx('comedor'), 'IDA'),
    'P5653', '[D12] comedor con sentido → P5653');
SELECT pg_temp.esperar(
    pg_temp.escanear('03', pg_temp.intento(), pg_temp.fx('cred_10'), 'ea650000-0000-4000-8000-00000000fffe', NULL),
    'P5652', '[D13] servicio inexistente → P5652');


-- ================================================================
-- E. DENEGACIONES
-- ================================================================
-- Credencial desconocida: NO_RECONOCIDO y NINGÚN evento.
DO $$
DECLARE
    v_antes BIGINT := pg_temp.total_eventos();
BEGIN
    PERFORM pg_temp.esperar_valor(
        pg_temp.escanear('03', pg_temp.intento(), pg_temp.fx('desconocida'), pg_temp.fx('comedor')),
        'NO_RECONOCIDO', '[E1] credencial inexistente → NO_RECONOCIDO');
    PERFORM pg_temp.exigir(pg_temp.total_eventos() = v_antes,
        '[E2] un identificador inexistente no deja ningún evento');
END $$;

-- El kid del QR tiene que ser el MISMO con el que se emitió la credencial: una clave
-- retenida tras una rotación no sirve para falsificar el QR de otra credencial.
DO $$
DECLARE
    v_antes BIGINT := pg_temp.total_eventos();
BEGIN
    PERFORM pg_temp.esperar_valor(
        pg_temp.srv(pg_catalog.format(
            'SELECT codigo_resultado FROM public.registrar_acceso_servicio(%L, %L, %L, ''k9'', %L, NULL)',
            pg_temp.u('03'), pg_temp.intento(), pg_temp.fx('cred_10'), pg_temp.fx('comedor'))),
        'NO_RECONOCIDO', '[E2b] un kid distinto al de la credencial → NO_RECONOCIDO');
    PERFORM pg_temp.exigir(pg_temp.total_eventos() = v_antes,
        '[E2c] un kid que no corresponde no deja ningún evento');
END $$;
SELECT pg_temp.esperar(
    pg_temp.srv(pg_catalog.format(
        'SELECT codigo_resultado FROM public.registrar_acceso_servicio(%L, %L, %L, NULL, %L, NULL)',
        pg_temp.u('03'), pg_temp.intento(), pg_temp.fx('cred_10'), pg_temp.fx('comedor'))),
    'P5651', '[E2d] sin kid → P5651');

-- Credencial revocada.
SELECT pg_temp.valor(pg_temp.dir(pg_catalog.format(
    'SELECT (public.revocar_credencial_qr(%L, %L)).id::TEXT', pg_temp.fx('cred_15'), 'Revocada por la prueba')));
SELECT pg_temp.esperar_valor(
    pg_temp.escanear('03', pg_temp.intento(), pg_temp.fx('cred_15'), pg_temp.fx('comedor')),
    'NO_HABILITADO', '[E3] credencial revocada → NO_HABILITADO');
SELECT pg_temp.exigir(
    (SELECT motivo_denegacion::TEXT FROM public.accesos_servicios WHERE alumno_id = pg_temp.u('15')) = 'CREDENCIAL_REVOCADA',
    '[E4] persiste DENEGADO con motivo CREDENCIAL_REVOCADA');

-- Alumno inactivo.
SELECT pg_temp.valor(pg_temp.dir(pg_catalog.format('SELECT public.inactivar_alumno(%L)::TEXT', pg_temp.u('12'))));
SELECT pg_temp.esperar_valor(
    pg_temp.escanear('03', pg_temp.intento(), pg_temp.fx('cred_12'), pg_temp.fx('comedor')),
    'NO_HABILITADO', '[E5] alumno inactivo → NO_HABILITADO');
SELECT pg_temp.exigir(
    (SELECT motivo_denegacion::TEXT FROM public.accesos_servicios WHERE alumno_id = pg_temp.u('12')) = 'ALUMNO_INACTIVO',
    '[E6] persiste DENEGADO con motivo ALUMNO_INACTIVO');

-- Perfil del alumno bloqueado (EPT-59).
UPDATE public.perfiles SET estado_acceso = 'BLOQUEADO' WHERE id = pg_temp.u('13');
SELECT pg_temp.esperar_valor(
    pg_temp.escanear('03', pg_temp.intento(), pg_temp.fx('cred_13'), pg_temp.fx('comedor')),
    'NO_HABILITADO', '[E7] perfil del alumno bloqueado → NO_HABILITADO');
SELECT pg_temp.exigir(
    (SELECT motivo_denegacion::TEXT FROM public.accesos_servicios WHERE alumno_id = pg_temp.u('13')) = 'ACCESO_BLOQUEADO',
    '[E8] persiste DENEGADO con motivo ACCESO_BLOQUEADO');

-- Inscripción cancelada (como Dirección, por la operación real de EPT-62).
SELECT pg_temp.valor(pg_temp.dir(pg_catalog.format(
    'SELECT (public.cancelar_inscripcion_servicio_administrativa(%L, ''COMEDOR'')).id::TEXT',
    (SELECT i.id FROM public.inscripciones_servicios i WHERE i.alumno_id = pg_temp.u('16') AND i.estado = 'ACTIVA'))));
SELECT pg_temp.esperar_valor(
    pg_temp.escanear('03', pg_temp.intento(), pg_temp.fx('cred_16'), pg_temp.fx('comedor')),
    'NO_HABILITADO', '[E9] inscripción cancelada → NO_HABILITADO');
SELECT pg_temp.exigir(
    (SELECT motivo_denegacion::TEXT FROM public.accesos_servicios WHERE alumno_id = pg_temp.u('16')) = 'SIN_INSCRIPCION',
    '[E10] persiste DENEGADO con motivo SIN_INSCRIPCION');

-- Servicio (recorrido) desactivado.
SELECT pg_temp.valor(pg_temp.dir(pg_catalog.format(
    'SELECT (public.actualizar_recorrido(%L, %L, false)).id::TEXT',
    pg_temp.fx('este'), 'Recorrido Este (ficticio)')));
SELECT pg_temp.esperar_valor(
    pg_temp.escanear('03', pg_temp.intento(), pg_temp.fx('cred_17'), pg_temp.fx('este'), 'IDA'),
    'NO_HABILITADO', '[E11] recorrido desactivado → NO_HABILITADO');
SELECT pg_temp.exigir(
    (SELECT motivo_denegacion::TEXT FROM public.accesos_servicios WHERE alumno_id = pg_temp.u('17')) = 'SERVICIO_INACTIVO',
    '[E12] persiste DENEGADO con motivo SERVICIO_INACTIVO');

-- La confirmación administrativa de EPT-62 NO es requisito: ninguna inscripción
-- de este fixture fue confirmada y el alumno 10 se registró en C1.
SELECT pg_temp.exigir(
    NOT EXISTS (SELECT 1 FROM public.confirmaciones_inscripcion),
    '[E13] sin ninguna confirmación administrativa, el acceso de la sección C se registró igual');

-- Ninguna respuesta de denegación revela datos del alumno.
SELECT pg_temp.exigir(
    (SELECT pg_catalog.count(*) FROM public.registrar_acceso_servicio(
        pg_temp.u('03'), pg_catalog.gen_random_uuid(), pg_temp.fx('cred_15')::UUID, 'k1', pg_temp.fx('comedor')::UUID, NULL) r
     WHERE r.codigo_resultado = 'NO_HABILITADO' AND r.alumno_nombre IS NULL AND r.alumno_apellido IS NULL
       AND r.alumno_legajo IS NULL AND r.sellado_en IS NULL) = 1,
    '[E14] una denegación no devuelve nombre, apellido, legajo ni hora');


-- ================================================================
-- F. IDEMPOTENCIA
-- ================================================================
DO $$
DECLARE
    v_intento TEXT := pg_catalog.gen_random_uuid()::TEXT;
    v_total   BIGINT;
BEGIN
    PERFORM pg_temp.guardar('intento_a', v_intento);
    PERFORM pg_temp.esperar_valor(
        pg_temp.escanear('03', v_intento, pg_temp.fx('cred_18'), pg_temp.fx('comedor')),
        'REGISTRADO', '[F1] primer intento: REGISTRADO');
    v_total := pg_temp.total_eventos();
    PERFORM pg_temp.esperar_valor(
        pg_temp.escanear('03', v_intento, pg_temp.fx('cred_18'), pg_temp.fx('comedor')),
        'REGISTRADO', '[F2] mismo operador, mismo intento y mismos argumentos → el resultado previo (REGISTRADO)');
    PERFORM pg_temp.exigir(pg_temp.total_eventos() = v_total,
        '[F3] el reintento no duplica el evento');
    -- El reintento devuelve también la misma hora sellada.
    PERFORM pg_temp.exigir(
        (SELECT sellado_en FROM public.registrar_acceso_servicio(pg_temp.u('03'), v_intento::UUID,
            pg_temp.fx('cred_18')::UUID, 'k1', pg_temp.fx('comedor')::UUID, NULL))
        = (SELECT registrado_en FROM public.accesos_servicios WHERE intento_id = v_intento::UUID),
        '[F4] el reintento devuelve la hora ya sellada, no una nueva');
END $$;

-- Reuso del mismo intento con argumentos distintos: INTENTO_REUTILIZADO sin alterar el evento.
DO $$
DECLARE
    v_intento TEXT := pg_temp.fx('intento_a');
    v_total   BIGINT := pg_temp.total_eventos();
BEGIN
    PERFORM pg_temp.esperar_valor(
        pg_temp.escanear('03', v_intento, pg_temp.fx('cred_10'), pg_temp.fx('comedor')),
        'INTENTO_REUTILIZADO', '[F5] mismo intento, otra credencial → INTENTO_REUTILIZADO');
    PERFORM pg_temp.esperar_valor(
        pg_temp.escanear('03', v_intento, pg_temp.fx('cred_18'), pg_temp.fx('norte'), 'IDA'),
        'INTENTO_REUTILIZADO', '[F6] mismo intento, otro servicio → INTENTO_REUTILIZADO');
    PERFORM pg_temp.exigir(pg_temp.total_eventos() = v_total
        AND (SELECT resultado::TEXT FROM public.accesos_servicios WHERE intento_id = v_intento::UUID) = 'REGISTRADO'
        AND (SELECT credencial_id FROM public.accesos_servicios WHERE intento_id = v_intento::UUID) = pg_temp.fx('cred_18')::UUID,
        '[F7] el evento original queda intacto');
END $$;

-- Otro operador con el MISMO UUID: no ve ni toca el intento del primero.
SELECT pg_temp.esperar_valor(
    pg_temp.escanear('07', pg_temp.fx('intento_a'), pg_temp.fx('cred_18'), pg_temp.fx('comedor')),
    'YA_REGISTRADO',
    '[F8] otro operador con el mismo UUID se procesa por su cuenta (no recibe el REGISTRADO del primero)');
SELECT pg_temp.exigir(
    (SELECT pg_catalog.count(*) FROM public.accesos_servicios WHERE intento_id = pg_temp.fx('intento_a')::UUID) = 2
    AND (SELECT pg_catalog.count(DISTINCT operador_perfil_id) FROM public.accesos_servicios
         WHERE intento_id = pg_temp.fx('intento_a')::UUID) = 2,
    '[F9] la unicidad del intento es POR operador: dos filas, dos operadores');

-- Reintento de una DENEGACIÓN: mismo resultado y sin duplicar.
DO $$
DECLARE
    v_intento TEXT := pg_catalog.gen_random_uuid()::TEXT;
    v_antes   BIGINT;
BEGIN
    PERFORM pg_temp.esperar_valor(
        pg_temp.escanear('03', v_intento, pg_temp.fx('cred_14'), pg_temp.fx('comedor')),
        'NO_HABILITADO', '[F10] intento denegado la primera vez');
    v_antes := pg_temp.total_eventos();
    PERFORM pg_temp.esperar_valor(
        pg_temp.escanear('03', v_intento, pg_temp.fx('cred_14'), pg_temp.fx('comedor')),
        'NO_HABILITADO', '[F11] el reintento de una denegación devuelve lo mismo');
    PERFORM pg_temp.exigir(pg_temp.total_eventos() = v_antes, '[F12] y no duplica el DENEGADO');
END $$;

-- La unicidad (operador, intento) la garantiza un índice, no solo la lógica.
SELECT pg_temp.esperar(
    pg_temp.propietario(pg_catalog.format(
        'INSERT INTO public.accesos_servicios (intento_id, operador_perfil_id, credencial_id, alumno_id, servicio_id, resultado, motivo_denegacion)
         VALUES (%L, %L, %L, %L, %L, ''DENEGADO'', ''SIN_INSCRIPCION'')',
        pg_temp.fx('intento_a'), pg_temp.u('03'), pg_temp.fx('cred_14'), pg_temp.u('14'), pg_temp.fx('comedor'))),
    '23505', '[F13] el índice único impide repetir (operador, intento)');


-- ================================================================
-- G. ANULACIÓN
-- ================================================================
DO $$
DECLARE
    v_acceso TEXT := (SELECT id::TEXT FROM public.accesos_servicios
                      WHERE alumno_id = pg_temp.u('18') AND resultado = 'REGISTRADO');
BEGIN
    PERFORM pg_temp.guardar('acceso_18', v_acceso);
    PERFORM pg_temp.esperar(pg_temp.como('03', pg_catalog.format(
        'SELECT (public.anular_acceso_servicio(%L, %L)).acceso_id::TEXT', v_acceso, 'Intento de PERSONAL')),
        '42501', '[G1] PERSONAL no anula');
    PERFORM pg_temp.esperar(pg_temp.como('10', pg_catalog.format(
        'SELECT (public.anular_acceso_servicio(%L, %L)).acceso_id::TEXT', v_acceso, 'Intento de alumno')),
        '42501', '[G2] el alumno no anula');
    PERFORM pg_temp.esperar(pg_temp.como('02', pg_catalog.format(
        'SELECT (public.anular_acceso_servicio(%L, %L)).acceso_id::TEXT', v_acceso, 'Director bloqueado')),
        '42501', '[G3] un Director bloqueado no anula');
    PERFORM pg_temp.esperar(pg_temp.dir(pg_catalog.format(
        'SELECT (public.anular_acceso_servicio(%L, %L)).acceso_id::TEXT', v_acceso, 'ab')),
        'P5664', '[G4] motivo de 2 caracteres → P5664');
    PERFORM pg_temp.esperar(pg_temp.dir(pg_catalog.format(
        'SELECT (public.anular_acceso_servicio(%L, %L)).acceso_id::TEXT', v_acceso, pg_catalog.repeat('x', 201))),
        'P5664', '[G5] motivo de 201 caracteres → P5664');
    PERFORM pg_temp.esperar(pg_temp.dir(pg_catalog.format(
        'SELECT (public.anular_acceso_servicio(%L, %L)).acceso_id::TEXT', v_acceso, '     ')),
        'P5664', '[G6] motivo en blanco → P5664');
    PERFORM pg_temp.esperar(pg_temp.dir(pg_catalog.format(
        'SELECT (public.anular_acceso_servicio(%L, %L)).acceso_id::TEXT', pg_temp.fx('desconocida'), 'Motivo válido')),
        'P5665', '[G7] un acceso inexistente → P5665');
    PERFORM pg_temp.esperar(pg_temp.dir(pg_catalog.format(
        'SELECT (public.anular_acceso_servicio(%L, %L)).acceso_id::TEXT',
        (SELECT id FROM public.accesos_servicios WHERE alumno_id = pg_temp.u('15') AND resultado = 'DENEGADO' LIMIT 1),
        'Motivo válido')),
        'P5663', '[G8] un DENEGADO no se anula → P5663');
    PERFORM pg_temp.exigir(NOT EXISTS (SELECT 1 FROM public.anulaciones_accesos_servicios),
        '[G9] ningún intento rechazado dejó una anulación');
END $$;

-- Anulación válida (con espacios laterales: se recortan).
SELECT pg_temp.esperar_valor(pg_temp.dir(pg_catalog.format(
    'SELECT (public.anular_acceso_servicio(%L, %L)).acceso_id::TEXT', pg_temp.fx('acceso_18'), '  Lectura de la credencial equivocada  ')),
    pg_temp.fx('acceso_18'), '[G10] Dirección anula un REGISTRADO con motivo');
SELECT pg_temp.exigir(
    (SELECT motivo FROM public.anulaciones_accesos_servicios WHERE acceso_id = pg_temp.fx('acceso_18')::UUID)
        = 'Lectura de la credencial equivocada'
    AND (SELECT anulado_por FROM public.anulaciones_accesos_servicios WHERE acceso_id = pg_temp.fx('acceso_18')::UUID) = pg_temp.u('01'),
    '[G11] la anulación guarda el motivo recortado y la autora sacada de la sesión');
SELECT pg_temp.esperar(pg_temp.dir(pg_catalog.format(
    'SELECT (public.anular_acceso_servicio(%L, %L)).acceso_id::TEXT', pg_temp.fx('acceso_18'), 'Segunda anulación')),
    'P5667', '[G12] no se anula dos veces → P5667');
SELECT pg_temp.exigir(
    (SELECT resultado::TEXT FROM public.accesos_servicios WHERE id = pg_temp.fx('acceso_18')::UUID) = 'REGISTRADO'
    AND (SELECT pg_catalog.count(*) FROM public.anulaciones_accesos_servicios) = 1,
    '[G13] el evento original no se editó ni se borró y hay una sola anulación');

-- Un acceso anulado NO bloquea el nuevo registro legítimo del día.
SELECT pg_temp.esperar_valor(
    pg_temp.escanear('03', pg_temp.intento(), pg_temp.fx('cred_18'), pg_temp.fx('comedor')),
    'REGISTRADO', '[G14] tras anular, un nuevo escaneo legítimo del mismo día se REGISTRA');
SELECT pg_temp.exigir(pg_temp.eventos(pg_temp.u('18'), 'REGISTRADO') = 2,
    '[G15] la historia se conserva: dos REGISTRADO, uno anulado y uno vigente');
SELECT pg_temp.esperar_valor(
    pg_temp.escanear('03', pg_temp.intento(), pg_temp.fx('cred_18'), pg_temp.fx('comedor')),
    'YA_REGISTRADO', '[G16] y el nuevo vuelve a bloquear al siguiente');

-- Anular el segundo y reintentar, otra vez libera.
SELECT pg_temp.valor(pg_temp.dir(pg_catalog.format(
    'SELECT (public.anular_acceso_servicio(%L, %L)).acceso_id::TEXT',
    (SELECT e.id FROM public.accesos_servicios e
      WHERE e.alumno_id = pg_temp.u('18') AND e.resultado = 'REGISTRADO'
        AND NOT EXISTS (SELECT 1 FROM public.anulaciones_accesos_servicios n WHERE n.acceso_id = e.id)),
    'Segundo error de lectura')));
SELECT pg_temp.esperar_valor(
    pg_temp.escanear('03', pg_temp.intento(), pg_temp.fx('cred_18'), pg_temp.fx('comedor')),
    'REGISTRADO', '[G17] se puede anular y volver a registrar más de una vez en el día');

-- Escrituras directas sobre el historial: ni el propietario.
SELECT pg_temp.esperar(pg_temp.propietario(pg_catalog.format(
    'UPDATE public.accesos_servicios SET resultado = ''DENEGADO'', motivo_denegacion = ''SIN_INSCRIPCION'' WHERE id = %L',
    pg_temp.fx('acceso_18'))), 'P5662', '[G18] el propietario no edita un evento');
SELECT pg_temp.esperar(pg_temp.propietario(pg_catalog.format(
    'DELETE FROM public.accesos_servicios WHERE id = %L', pg_temp.fx('acceso_18'))),
    'P5662', '[G19] el propietario no borra un REGISTRADO');
SELECT pg_temp.esperar(pg_temp.propietario(pg_catalog.format(
    'DELETE FROM public.accesos_servicios WHERE alumno_id = %L AND resultado = ''DENEGADO''', pg_temp.u('15'))),
    'P5662', '[G20] el propietario no borra una denegación fuera del mantenimiento');
SELECT pg_temp.esperar(pg_temp.propietario(pg_catalog.format(
    'UPDATE public.anulaciones_accesos_servicios SET motivo = ''Otro motivo'' WHERE acceso_id = %L', pg_temp.fx('acceso_18'))),
    'P5662', '[G21] el propietario no edita una anulación');
SELECT pg_temp.esperar(pg_temp.propietario(pg_catalog.format(
    'DELETE FROM public.anulaciones_accesos_servicios WHERE acceso_id = %L', pg_temp.fx('acceso_18'))),
    'P5662', '[G22] el propietario no borra una anulación');
SELECT pg_temp.esperar(pg_temp.propietario('TRUNCATE public.accesos_servicios CASCADE'),
    'P5662', '[G23] ni el propietario vacía los eventos');
SELECT pg_temp.esperar(pg_temp.propietario('TRUNCATE public.anulaciones_accesos_servicios'),
    'P5662', '[G24] ni el propietario vacía las anulaciones');
-- Una fila no nace anulada ni anonimizada, y el sentido se valida en la base.
SELECT pg_temp.esperar(pg_temp.propietario(pg_catalog.format(
    'INSERT INTO public.accesos_servicios (intento_id, operador_perfil_id, credencial_id, alumno_id, servicio_id, resultado, anonimizado_en)
     VALUES (gen_random_uuid(), %L, %L, %L, %L, ''REGISTRADO'', now())',
    pg_temp.u('03'), pg_temp.fx('cred_14'), pg_temp.u('14'), pg_temp.fx('comedor'))),
    'P5662', '[G25] un acceso no puede nacer anonimizado');
SELECT pg_temp.esperar(pg_temp.propietario(pg_catalog.format(
    'INSERT INTO public.accesos_servicios (intento_id, operador_perfil_id, credencial_id, alumno_id, servicio_id, resultado)
     VALUES (gen_random_uuid(), %L, %L, %L, %L, ''REGISTRADO'')',
    pg_temp.u('03'), pg_temp.fx('cred_18'), pg_temp.u('18'), pg_temp.fx('comedor'))),
    'P5660', '[G26] aun por fuera de la operación, la base no admite dos REGISTRADO vigentes el mismo día');


-- ================================================================
-- H. LECTURA DE DIRECCIÓN Y PRIVACIDAD POR ACTOR
-- ================================================================
SELECT pg_temp.exigir(
    pg_temp.valor(pg_temp.dir(
        'SELECT pg_catalog.count(*)::TEXT FROM public.listar_accesos_servicios(NULL, NULL, NULL, 100, 0)'))::BIGINT
        >= 10,
    '[H1] Dirección lista los eventos');
SELECT pg_temp.exigir(
    (SELECT pg_catalog.count(*) FROM public.accesos_servicios) =
    pg_temp.valor(pg_temp.dir(
        'SELECT total::TEXT FROM public.listar_accesos_servicios(NULL, NULL, NULL, 1, 0)'))::BIGINT,
    '[H2] el total devuelto coincide con la cantidad real de filas');
SELECT pg_temp.exigir(
    pg_temp.valor(pg_temp.dir(
        'SELECT pg_catalog.count(*)::TEXT FROM public.listar_accesos_servicios(NULL, NULL, NULL, 5000, 0)'))::BIGINT <= 100,
    '[H3] el límite máximo de página es 100');
SELECT pg_temp.exigir(
    pg_temp.valor(pg_temp.dir(
        'SELECT pg_catalog.count(*)::TEXT FROM public.listar_accesos_servicios(NULL, ''DENEGADO'', NULL, 100, 0)'))::BIGINT
        = (SELECT pg_catalog.count(*) FROM public.accesos_servicios WHERE resultado = 'DENEGADO'),
    '[H4] el filtro por resultado devuelve solo denegaciones');
SELECT pg_temp.exigir(
    pg_temp.valor(pg_temp.dir(pg_catalog.format(
        'SELECT pg_catalog.count(*)::TEXT FROM public.listar_accesos_servicios(NULL, NULL, %L, 100, 0)', pg_temp.fx('norte'))))::BIGINT
        = (SELECT pg_catalog.count(*) FROM public.accesos_servicios WHERE servicio_id = pg_temp.fx('norte')::UUID),
    '[H5] el filtro por servicio funciona');
SELECT pg_temp.exigir(
    pg_temp.valor(pg_temp.dir(
        'SELECT motivo_denegacion::TEXT FROM public.listar_accesos_servicios(NULL, ''DENEGADO'', NULL, 100, 0) LIMIT 1')) <> '<NULL>',
    '[H6] Dirección ve el motivo interno de las denegaciones');
SELECT pg_temp.exigir(
    pg_temp.valor(pg_temp.dir(
        'SELECT pg_catalog.count(*)::TEXT FROM public.listar_accesos_servicios(CURRENT_DATE + 3650, NULL, NULL, 100, 0)'))::BIGINT = 0,
    '[H7] el filtro por día devuelve cero filas para un día sin accesos');

-- Ningún otro actor lee nada, ni por la función ni por la tabla.
DO $$
DECLARE
    v_s TEXT;
BEGIN
    FOREACH v_s IN ARRAY ARRAY['02', '03', '04', '05', '06', '10', '0c'] LOOP
        PERFORM pg_temp.esperar(pg_temp.como(v_s,
            'SELECT pg_catalog.count(*)::TEXT FROM public.listar_accesos_servicios(NULL, NULL, NULL, 10, 0)'),
            '42501', '[H8] el actor ' || v_s || ' (PERSONAL, bloqueado, docente, padre, estudiante, sin perfil) no lista accesos');
        PERFORM pg_temp.esperar(pg_temp.como(v_s, 'SELECT pg_catalog.count(*)::TEXT FROM public.accesos_servicios'),
            '42501', '[H9] el actor ' || v_s || ' no lee la tabla de accesos');
        PERFORM pg_temp.esperar(pg_temp.como(v_s, 'SELECT pg_catalog.count(*)::TEXT FROM public.anulaciones_accesos_servicios'),
            '42501', '[H10] el actor ' || v_s || ' no lee la tabla de anulaciones');
    END LOOP;
END $$;
SELECT pg_temp.esperar(pg_temp.dir('SELECT pg_catalog.count(*)::TEXT FROM public.accesos_servicios'),
    '42501', '[H11] ni siquiera Dirección lee la tabla: solo la función de lectura');
SELECT pg_temp.esperar(pg_temp.ejecutar('anon', NULL,
    'SELECT pg_catalog.count(*)::TEXT FROM public.listar_accesos_servicios(NULL, NULL, NULL, 10, 0)'),
    '42501', '[H12] anon no lista accesos');
SELECT pg_temp.esperar(pg_temp.ejecutar('anon', NULL, 'SELECT pg_catalog.count(*)::TEXT FROM public.accesos_servicios'),
    '42501', '[H13] anon no lee la tabla');
SELECT pg_temp.esperar(pg_temp.srv('SELECT pg_catalog.count(*)::TEXT FROM public.accesos_servicios'),
    '42501', '[H14] service_role no lee la tabla: solo ejecuta las operaciones');
SELECT pg_temp.esperar(pg_temp.srv(
    'SELECT pg_catalog.count(*)::TEXT FROM public.listar_accesos_servicios(NULL, NULL, NULL, 10, 0)'),
    '42501', '[H15] service_role tampoco ejecuta la lectura de Dirección');


-- ================================================================
-- I. LÍMITE DE INTENTOS POR CUENTA OPERADORA
-- ================================================================
SELECT pg_temp.exigir(
    (SELECT (solicitudes_maximas, ventana_solicitudes, invalidos_maximos, ventana_invalidos, bloqueo)
          = (60, INTERVAL '5 minutes', 10, INTERVAL '10 minutes', INTERVAL '15 minutes')
     FROM app_private.parametros_limite_escaneo()),
    '[I1] los parámetros iniciales son 60/5 min, 10/10 min y bloqueo de 15 min (valores de prueba, no medidos)');

DO $$
DECLARE
    v_res TEXT;
    v_i   INTEGER;
    v_permitidas INTEGER := 0;
BEGIN
    DELETE FROM app_private.contadores_escaneo;
    FOR v_i IN 1..60 LOOP
        v_res := pg_temp.srv(pg_catalog.format('SELECT permitido::TEXT FROM public.consumir_cupo_escaneo(%L)', pg_temp.u('03')));
        IF v_res = 'OK:true' THEN v_permitidas := v_permitidas + 1; END IF;
    END LOOP;
    PERFORM pg_temp.exigir(v_permitidas = 60, '[I2] las primeras 60 solicitudes se permiten');

    v_res := pg_temp.srv(pg_catalog.format('SELECT permitido::TEXT || '':'' || reintentar_en_segundos::TEXT FROM public.consumir_cupo_escaneo(%L)', pg_temp.u('03')));
    PERFORM pg_temp.exigir(v_res LIKE 'OK:false:%' AND pg_catalog.split_part(v_res, ':', 3)::INTEGER BETWEEN 890 AND 900,
        '[I3] la solicitud 61 se rechaza con un reintento de unos 15 minutos (' || v_res || ')');

    -- Mientras dura el bloqueo, todo se rechaza sin consumir más cupo.
    v_res := pg_temp.srv(pg_catalog.format('SELECT permitido::TEXT FROM public.consumir_cupo_escaneo(%L)', pg_temp.u('03')));
    PERFORM pg_temp.esperar_valor(v_res, 'false', '[I4] el bloqueo se mantiene');
    PERFORM pg_temp.exigir(
        (SELECT pg_catalog.count(*) FROM app_private.contadores_escaneo c
         WHERE c.operador_perfil_id = pg_temp.u('03') AND c.tipo = 'SOLICITUD') = 60,
        '[I5] las solicitudes rechazadas no suman contadores');

    -- El límite es por cuenta: otro operador no se ve afectado.
    PERFORM pg_temp.esperar_valor(
        pg_temp.srv(pg_catalog.format('SELECT permitido::TEXT FROM public.consumir_cupo_escaneo(%L)', pg_temp.u('07'))),
        'true', '[I6] el límite es por cuenta operadora: otro operador sigue operando');
    PERFORM pg_temp.esperar_valor(
        pg_temp.srv(pg_catalog.format('SELECT permitido::TEXT FROM public.consumir_cupo_escaneo(%L)', pg_temp.u('01'))),
        'true', '[I7] la Dirección tiene su propio contador');

    -- Vencido el bloqueo vuelve a operar.
    UPDATE app_private.contadores_escaneo
    SET bloqueado_hasta = pg_catalog.clock_timestamp() - INTERVAL '1 second'
    WHERE operador_perfil_id = pg_temp.u('03') AND tipo = 'BLOQUEO';
    UPDATE app_private.contadores_escaneo
    SET ocurrido_en = pg_catalog.clock_timestamp() - INTERVAL '16 minutes'
    WHERE operador_perfil_id = pg_temp.u('03');
    PERFORM pg_temp.esperar_valor(
        pg_temp.srv(pg_catalog.format('SELECT permitido::TEXT FROM public.consumir_cupo_escaneo(%L)', pg_temp.u('03'))),
        'true', '[I8] vencidos el bloqueo y la ventana, el operador vuelve a operar');
END $$;

-- Inválidos: 10 en 10 minutos bloquean 15 minutos.
DO $$
DECLARE
    v_i INTEGER;
    v_res TEXT;
BEGIN
    DELETE FROM app_private.contadores_escaneo;
    FOR v_i IN 1..9 LOOP
        v_res := pg_temp.srv(pg_catalog.format('SELECT bloqueado::TEXT FROM public.registrar_escaneo_invalido(%L)', pg_temp.u('03')));
        PERFORM pg_temp.exigir(v_res = 'OK:false', '[I9] inválido ' || v_i || ' de 9 no bloquea');
    END LOOP;
    PERFORM pg_temp.esperar_valor(
        pg_temp.srv(pg_catalog.format('SELECT permitido::TEXT FROM public.consumir_cupo_escaneo(%L)', pg_temp.u('03'))),
        'true', '[I10] con 9 inválidos todavía se permite escanear');
    PERFORM pg_temp.esperar_valor(
        pg_temp.srv(pg_catalog.format('SELECT bloqueado::TEXT FROM public.registrar_escaneo_invalido(%L)', pg_temp.u('03'))),
        'true', '[I11] el décimo inválido dispara el bloqueo');
    PERFORM pg_temp.esperar_valor(
        pg_temp.srv(pg_catalog.format('SELECT permitido::TEXT FROM public.consumir_cupo_escaneo(%L)', pg_temp.u('03'))),
        'false', '[I12] bloqueada la cuenta por inválidos, la siguiente solicitud se rechaza');
    PERFORM pg_temp.exigir(
        (SELECT pg_catalog.count(*) FROM app_private.contadores_escaneo
         WHERE operador_perfil_id = pg_temp.u('03') AND tipo = 'BLOQUEO') = 1,
        '[I13] un solo bloqueo registrado');
    DELETE FROM app_private.contadores_escaneo;
END $$;

-- Quién puede consumir cupo: solo operadores reales.
SELECT pg_temp.esperar(pg_temp.srv(pg_catalog.format('SELECT permitido::TEXT FROM public.consumir_cupo_escaneo(%L)', pg_temp.u('05'))),
    '42501', '[I14] un docente no consume cupo de escaneo');
SELECT pg_temp.esperar(pg_temp.srv(pg_catalog.format('SELECT permitido::TEXT FROM public.consumir_cupo_escaneo(%L)', pg_temp.u('04'))),
    '42501', '[I15] un PERSONAL bloqueado no consume cupo de escaneo');
SELECT pg_temp.esperar(pg_temp.srv('SELECT permitido::TEXT FROM public.consumir_cupo_escaneo(NULL)'),
    'P5505', '[I16] sin actor → P5505');
SELECT pg_temp.esperar(pg_temp.como('03', pg_catalog.format('SELECT permitido::TEXT FROM public.consumir_cupo_escaneo(%L)', pg_temp.u('03'))),
    '42501', '[I17] authenticated no ejecuta el límite');
SELECT pg_temp.esperar(pg_temp.como('03', pg_catalog.format('SELECT bloqueado::TEXT FROM public.registrar_escaneo_invalido(%L)', pg_temp.u('03'))),
    '42501', '[I18] authenticated no ejecuta el contador de inválidos');
SELECT pg_temp.esperar(pg_temp.como('03', 'SELECT pg_catalog.count(*)::TEXT FROM app_private.contadores_escaneo'),
    '42501', '[I19] el operador no lee los contadores');


-- ================================================================
-- J. ATAQUE DIRECTO: ID CONOCIDO, SIN PAYLOAD FIRMADO
-- ================================================================
-- Dirección y PERSONAL conocen un credencial_id válido (el de la alumna 14), pero
-- NO el payload firmado. Ninguna vía de la Data API crea un REGISTRADO.
DO $$
DECLARE
    v_antes BIGINT := pg_temp.total_eventos();
    v_s     TEXT;
    v_cred  TEXT := pg_temp.fx('cred_14');
BEGIN
    FOREACH v_s IN ARRAY ARRAY['01', '03'] LOOP
        -- RPC pública con el propio usuario como actor.
        PERFORM pg_temp.esperar(pg_temp.como(v_s, pg_catalog.format(
            'SELECT codigo_resultado FROM public.registrar_acceso_servicio(%L, %L, %L, ''k1'', %L, NULL)',
            pg_temp.u(v_s), pg_catalog.gen_random_uuid(), v_cred, pg_temp.fx('comedor'))),
            '42501', '[J1] ' || v_s || ' no registra por la RPC pública, ni con su propio actor');
        -- Con un actor inventado.
        PERFORM pg_temp.esperar(pg_temp.como(v_s, pg_catalog.format(
            'SELECT codigo_resultado FROM public.registrar_acceso_servicio(%L, %L, %L, ''k1'', %L, NULL)',
            pg_catalog.gen_random_uuid(), pg_catalog.gen_random_uuid(), v_cred, pg_temp.fx('comedor'))),
            '42501', '[J2] ' || v_s || ' no registra por la RPC pública con un actor inventado');
        -- La operación del esquema privado.
        PERFORM pg_temp.esperar(pg_temp.como(v_s, pg_catalog.format(
            'SELECT codigo_resultado FROM app_private.registrar_acceso_servicio(%L, %L, %L, ''k1'', %L, NULL)',
            pg_temp.u(v_s), pg_catalog.gen_random_uuid(), v_cred, pg_temp.fx('comedor'))),
            '42501', '[J3] ' || v_s || ' no registra por app_private');
        -- Funciones auxiliares.
        PERFORM pg_temp.esperar(pg_temp.como(v_s, pg_catalog.format(
            'SELECT app_private.operador_de_escaneo(%L)::TEXT', pg_temp.u(v_s))),
            '42501', '[J4] ' || v_s || ' no ejecuta operador_de_escaneo');
        PERFORM pg_temp.esperar(pg_temp.como(v_s, pg_catalog.format(
            'SELECT codigo_resultado FROM app_private.respuesta_de_intento(%L, %L, %L, NULL)',
            (SELECT id FROM public.accesos_servicios LIMIT 1), v_cred, pg_temp.fx('comedor'))),
            '42501', '[J5] ' || v_s || ' no ejecuta respuesta_de_intento');
        PERFORM pg_temp.esperar(pg_temp.como(v_s, 'SELECT app_private.depurar_accesos_servicios(DATE ''2000-01-01'')::TEXT'),
            '42501', '[J6] ' || v_s || ' no ejecuta el mantenimiento');
        -- Escritura directa de la tabla.
        PERFORM pg_temp.esperar(pg_temp.como(v_s, pg_catalog.format(
            'INSERT INTO public.accesos_servicios (intento_id, operador_perfil_id, credencial_id, alumno_id, servicio_id, resultado)
             VALUES (gen_random_uuid(), %L, %L, %L, %L, ''REGISTRADO'') RETURNING id::TEXT',
            pg_temp.u(v_s), v_cred, pg_temp.u('14'), pg_temp.fx('comedor'))),
            '42501', '[J7] ' || v_s || ' no inserta en la tabla');
    END LOOP;
    PERFORM pg_temp.exigir(pg_temp.total_eventos() = v_antes,
        '[J8] ningún ataque directo creó un evento');
END $$;

-- Con service_role directo a la tabla tampoco: solo las operaciones.
SELECT pg_temp.esperar(pg_temp.srv(pg_catalog.format(
    'INSERT INTO public.accesos_servicios (intento_id, operador_perfil_id, credencial_id, alumno_id, servicio_id, resultado)
     VALUES (gen_random_uuid(), %L, %L, %L, %L, ''REGISTRADO'') RETURNING id::TEXT',
    pg_temp.u('03'), pg_temp.fx('cred_14'), pg_temp.u('14'), pg_temp.fx('comedor'))),
    '42501', '[J9] ni service_role inserta directo: solo ejecuta la operación');

-- EXECUTE por la vía de pseudo-usuario sin sesión en el JWT: sin sub, sin operación.
SELECT pg_temp.esperar(pg_temp.ejecutar('authenticated', NULL, pg_catalog.format(
    'SELECT codigo_resultado FROM public.registrar_acceso_servicio(%L, %L, %L, ''k1'', %L, NULL)',
    pg_temp.u('03'), pg_catalog.gen_random_uuid(), pg_temp.fx('cred_14'), pg_temp.fx('comedor'))),
    '42501', '[J10] authenticated sin sub tampoco');


-- ================================================================
-- K. RETENCIÓN: ANONIMIZACIÓN, ELIMINACIÓN Y MANTENIMIENTO CERRADO
-- ================================================================
-- Fixture de retención: eventos con fechas pasadas (la guarda se desactiva solo
-- aquí, en la prueba, para poder fechar hacia atrás).
ALTER TABLE public.accesos_servicios DISABLE TRIGGER proteger_acceso_servicio_antes_de_escribir;
-- Un REGISTRADO del ciclo anterior (antes del fin de ciclo), con una anulación.
INSERT INTO public.accesos_servicios (id, intento_id, operador_perfil_id, credencial_id, alumno_id, servicio_id,
                                      resultado, registrado_en)
VALUES (pg_temp.u('e1'), pg_catalog.gen_random_uuid(), pg_temp.u('03'), pg_temp.fx('cred_1a')::UUID, pg_temp.u('1a'),
        pg_temp.fx('comedor')::UUID, 'REGISTRADO', TIMESTAMPTZ '2025-11-10 15:00:00+00'),
       (pg_temp.u('e2'), pg_catalog.gen_random_uuid(), pg_temp.u('03'), pg_temp.fx('cred_1a')::UUID, pg_temp.u('1a'),
        pg_temp.fx('comedor')::UUID, 'REGISTRADO', TIMESTAMPTZ '2025-11-11 15:00:00+00');
-- Una denegación antigua (más de 90 días) y una reciente.
INSERT INTO public.accesos_servicios (id, intento_id, operador_perfil_id, credencial_id, alumno_id, servicio_id,
                                      resultado, motivo_denegacion, registrado_en)
VALUES (pg_temp.u('e3'), pg_catalog.gen_random_uuid(), pg_temp.u('03'), pg_temp.fx('cred_1a')::UUID, pg_temp.u('1a'),
        pg_temp.fx('comedor')::UUID, 'DENEGADO', 'SIN_INSCRIPCION', pg_catalog.clock_timestamp() - INTERVAL '120 days'),
       (pg_temp.u('e4'), pg_catalog.gen_random_uuid(), pg_temp.u('03'), pg_temp.fx('cred_1a')::UUID, pg_temp.u('1a'),
        pg_temp.fx('comedor')::UUID, 'DENEGADO', 'SIN_INSCRIPCION', pg_catalog.clock_timestamp() - INTERVAL '30 days');
-- Un REGISTRADO del ciclo en curso (posterior al fin de ciclo que se depura).
INSERT INTO public.accesos_servicios (id, intento_id, operador_perfil_id, credencial_id, alumno_id, servicio_id,
                                      resultado, registrado_en)
VALUES (pg_temp.u('e5'), pg_catalog.gen_random_uuid(), pg_temp.u('03'), pg_temp.fx('cred_1a')::UUID, pg_temp.u('1a'),
        pg_temp.fx('comedor')::UUID, 'REGISTRADO', pg_catalog.clock_timestamp() - INTERVAL '2 days');
ALTER TABLE public.accesos_servicios ENABLE TRIGGER proteger_acceso_servicio_antes_de_escribir;

-- Una anulación del evento antiguo e1 (pasa por la guarda: e1 es REGISTRADO).
SELECT pg_temp.valor(pg_temp.dir(pg_catalog.format(
    'SELECT (public.anular_acceso_servicio(%L, %L)).acceso_id::TEXT', pg_temp.u('e1'), 'Motivo con datos personales de prueba')));
-- Contadores antiguos y recientes.
INSERT INTO app_private.contadores_escaneo (operador_perfil_id, tipo, ocurrido_en)
VALUES (pg_temp.u('03'), 'SOLICITUD', pg_catalog.clock_timestamp() - INTERVAL '2 days'),
       (pg_temp.u('03'), 'SOLICITUD', pg_catalog.clock_timestamp() - INTERVAL '1 hour');

-- Roles de aplicación: ningún privilegio, ni siquiera declarando el mantenimiento.
SELECT pg_temp.esperar(pg_temp.srv('SELECT app_private.depurar_accesos_servicios(DATE ''2025-12-20'')::TEXT'),
    '42501', '[K1] service_role no ejecuta el mantenimiento');
SELECT pg_temp.esperar(pg_temp.dir('SELECT app_private.depurar_accesos_servicios(DATE ''2025-12-20'')::TEXT'),
    '42501', '[K2] ni siquiera Dirección ejecuta el mantenimiento');
SELECT pg_temp.esperar(pg_temp.ejecutar('anon', NULL, 'SELECT app_private.depurar_accesos_servicios(DATE ''2025-12-20'')::TEXT'),
    '42501', '[K3] anon no ejecuta el mantenimiento');
SELECT pg_catalog.set_config('ept65.mantenimiento', 'on', true);
SELECT pg_temp.esperar(pg_temp.srv('DELETE FROM public.accesos_servicios WHERE resultado = ''DENEGADO'' RETURNING id::TEXT'),
    '42501', '[K4] declarar la variable de mantenimiento no da privilegio de DELETE a service_role');
SELECT pg_temp.esperar(pg_temp.como('01', 'UPDATE public.accesos_servicios SET alumno_id = NULL RETURNING id::TEXT'),
    '42501', '[K5] ni a Dirección');
SELECT pg_catalog.set_config('ept65.mantenimiento', 'off', true);

-- Aún no vencieron los 90 días para el ciclo en curso.
SELECT pg_temp.esperar(pg_temp.propietario(
    'SELECT app_private.depurar_accesos_servicios((CURRENT_DATE - 30)::DATE)::TEXT'),
    'P5668', '[K6] el mantenimiento no corre antes de fin de ciclo + 90 días');
SELECT pg_temp.esperar(pg_temp.propietario('SELECT app_private.depurar_accesos_servicios(NULL)::TEXT'),
    'P5668', '[K7] sin fecha de fin de ciclo no corre');

-- Propietario con la variable declarada pero modificando algo que no es anonimizar: rechazo.
SELECT pg_catalog.set_config('ept65.mantenimiento', 'on', true);
SELECT pg_temp.esperar(pg_temp.propietario(pg_catalog.format(
    'UPDATE public.accesos_servicios SET resultado = ''DENEGADO'', motivo_denegacion = ''SIN_INSCRIPCION'', alumno_id = NULL,
            credencial_id = NULL, operador_perfil_id = NULL, intento_id = NULL, anonimizado_en = now() WHERE id = %L', pg_temp.u('e2'))),
    'P5662', '[K8] el mantenimiento no puede cambiar el resultado de un evento');
SELECT pg_temp.esperar(pg_temp.propietario(pg_catalog.format(
    'DELETE FROM public.accesos_servicios WHERE id = %L', pg_temp.u('e2'))),
    'P5662', '[K9] el mantenimiento no puede eliminar un REGISTRADO');
SELECT pg_catalog.set_config('ept65.mantenimiento', 'off', true);

-- Mantenimiento real: fin de ciclo 20/12/2025 (más de 90 días atrás).
DO $$
DECLARE
    v_reg app_private.depuraciones_accesos_servicios;
BEGIN
    v_reg := app_private.depurar_accesos_servicios(DATE '2025-12-20');
    PERFORM pg_temp.exigir(v_reg.accesos_anonimizados >= 2 AND v_reg.anulaciones_anonimizadas = 1
        AND v_reg.denegados_eliminados = 1 AND v_reg.contadores_eliminados >= 1
        AND v_reg.ejecutada_por = SESSION_USER AND v_reg.fin_ciclo_lectivo = DATE '2025-12-20',
        '[K10] el mantenimiento anonimiza, elimina y deja su registro de auditoría');
END $$;

SELECT pg_temp.exigir(
    (SELECT alumno_id IS NULL AND credencial_id IS NULL AND operador_perfil_id IS NULL AND intento_id IS NULL
            AND anonimizado_en IS NOT NULL AND resultado = 'REGISTRADO' AND servicio_id = pg_temp.fx('comedor')::UUID
            AND dia_servicio = DATE '2025-11-10'
     FROM public.accesos_servicios WHERE id = pg_temp.u('e1')),
    '[K11] el evento anonimizado conserva servicio, resultado y día, y pierde operador, alumno, credencial e intento');
SELECT pg_temp.exigir(
    (SELECT anulado_por IS NULL AND motivo IS NULL AND anonimizada_en IS NOT NULL
     FROM public.anulaciones_accesos_servicios WHERE acceso_id = pg_temp.u('e1')),
    '[K12] la anulación se anonimiza: sin autora ni motivo libre');
SELECT pg_temp.exigir(NOT EXISTS (SELECT 1 FROM public.accesos_servicios WHERE id = pg_temp.u('e3')),
    '[K13] la denegación de más de 90 días se eliminó');
SELECT pg_temp.exigir(EXISTS (SELECT 1 FROM public.accesos_servicios WHERE id = pg_temp.u('e4')),
    '[K14] la denegación reciente se conserva');
SELECT pg_temp.exigir(
    (SELECT alumno_id = pg_temp.u('1a') AND anonimizado_en IS NULL FROM public.accesos_servicios WHERE id = pg_temp.u('e5')),
    '[K15] el evento del ciclo vigente sigue identificable');
SELECT pg_temp.exigir(NOT EXISTS (SELECT 1 FROM app_private.contadores_escaneo WHERE ocurrido_en < pg_catalog.clock_timestamp() - INTERVAL '24 hours')
    AND EXISTS (SELECT 1 FROM app_private.contadores_escaneo WHERE ocurrido_en > pg_catalog.clock_timestamp() - INTERVAL '2 hours'),
    '[K16] los contadores de más de 24 horas se eliminaron y el reciente se conserva');
SELECT pg_temp.exigir(
    (SELECT pg_catalog.count(*) FROM app_private.depuraciones_accesos_servicios) = 1,
    '[K17] la ejecución quedó auditada');
SELECT pg_temp.esperar(pg_temp.propietario('UPDATE app_private.depuraciones_accesos_servicios SET accesos_anonimizados = 0'),
    'P5662', '[K18] la auditoría de mantenimiento es de solo agregado');
SELECT pg_temp.esperar(pg_temp.propietario('DELETE FROM app_private.depuraciones_accesos_servicios'),
    'P5662', '[K19] ni se borra');
SELECT pg_temp.esperar(pg_temp.propietario('TRUNCATE app_private.depuraciones_accesos_servicios'),
    'P5662', '[K20] ni se vacía');

-- Un acceso anonimizado ya no admite anulación ni se reanonimiza.
SELECT pg_temp.esperar(pg_temp.dir(pg_catalog.format(
    'SELECT (public.anular_acceso_servicio(%L, %L)).acceso_id::TEXT', pg_temp.u('e2'), 'Intento sobre anonimizado')),
    'P5666', '[K22] un acceso anonimizado no se anula (P5666)');
-- Las filas anonimizadas no estorban a un escaneo legítimo del mismo alumno.
SELECT pg_temp.esperar_valor(
    pg_temp.escanear('03', pg_temp.intento(), pg_temp.fx('cred_1a'), pg_temp.fx('comedor')),
    'REGISTRADO', '[K23] el evento e5 es de hace 2 días: no es «hoy» y no bloquea el registro de hoy');


-- ================================================================
-- L. AUDITORÍA DE EPT-64: consultar_validez_credencial_qr
-- ================================================================
SELECT pg_temp.exigir(
    pg_catalog.has_function_privilege('authenticated', 'public.consultar_validez_credencial_qr(uuid)'::pg_catalog.regprocedure, 'EXECUTE')
    AND NOT pg_catalog.has_function_privilege('anon', 'public.consultar_validez_credencial_qr(uuid)'::pg_catalog.regprocedure, 'EXECUTE')
    AND NOT pg_catalog.has_function_privilege('service_role', 'public.consultar_validez_credencial_qr(uuid)'::pg_catalog.regprocedure, 'EXECUTE'),
    '[L1] la función de EPT-64 está concedida a authenticated (no a anon ni a service_role)');
SELECT pg_temp.esperar(pg_temp.como('03', pg_catalog.format(
    'SELECT valida::TEXT FROM public.consultar_validez_credencial_qr(%L)', pg_temp.fx('cred_14'))),
    '42501', '[L2] PERSONAL no la ejecuta: la función exige Dirección habilitada dentro de la base');
DO $$
DECLARE
    v_antes BIGINT := pg_temp.total_eventos();
BEGIN
    PERFORM pg_temp.esperar_valor(pg_temp.dir(pg_catalog.format(
        'SELECT valida::TEXT FROM public.consultar_validez_credencial_qr(%L)', pg_temp.fx('cred_14'))),
        'true', '[L3] Dirección la ejecuta con solo el id: lee la validez efectiva (ya lee ese dato por RLS)');
    PERFORM pg_temp.exigir(pg_temp.total_eventos() = v_antes,
        '[L4] pero NO registra ni crea ningún acceso: es solo lectura y no es un escaneo');
END $$;
SELECT pg_temp.exigir(
    pg_temp.valor(pg_temp.dir(pg_catalog.format(
        'SELECT pg_catalog.count(*)::TEXT FROM public.credenciales_qr WHERE id = %L', pg_temp.fx('cred_14'))))::BIGINT = 1,
    '[L5] Dirección ya lee el id y el estado de toda credencial por RLS: la función no le da una capacidad nueva');

ROLLBACK;
