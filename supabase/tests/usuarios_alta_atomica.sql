-- ============================================================
-- EDUCAR PARA TRANSFORMAR — Alta atómica de cuenta y perfil (EPT-9)
-- ============================================================
-- Verifica la migración 010 dentro de PostgreSQL, sin GoTrue ni HTTP.
--
-- Ejecutar exclusivamente contra la base local descartable después de
-- `supabase db reset`. Todo ocurre dentro de una transacción con ROLLBACK.
--
-- Se ejecuta con `supabase_admin`, el superusuario de la imagen local:
--
--     docker exec -i supabase_db_educar-para-transformar \
--       psql -X -U supabase_admin -d postgres -v ON_ERROR_STOP=1 \
--       < supabase/tests/usuarios_alta_atomica.sql
--
-- GoTrue escribe `auth.users` como `supabase_auth_admin`, y `postgres` no es
-- miembro de ese rol ni debe serlo. Solo un superusuario puede asumirlo para
-- reproducir la escritura sin conceder ningún privilegio nuevo. La función del
-- trigger sigue ejecutándose con los privilegios de su dueño, igual que en
-- producción.
--
-- Cada alta reproduce lo que hace GoTrue v2.196.0 en `auth.admin.createUser`,
-- verificado sobre la pila local antes de escribir la migración: con el rol
-- `supabase_auth_admin`, un INSERT en `auth.users` y, en la misma transacción,
-- un UPDATE que agrega el `app_metadata` del administrador. Los rechazos se
-- ejecutan dentro de un bloque con excepción, que PostgreSQL revierte como una
-- subtransacción: es el mismo efecto que la reversión completa de GoTrue.
--
-- La prueba contra GoTrue real vive en `usuarios_reconciliacion.mjs`.
--
-- Todos los datos son sintéticos. Los DNI pertenecen al rango 89.1xx.xxx y los
-- correos a un dominio reservado; ninguno corresponde a una persona real.

\set ON_ERROR_STOP on

BEGIN;

-- Datos de apoyo: un perfil existente que ocupa un DNI y un legajo.
INSERT INTO public.perfiles (user_id, rol_id, nombre, apellido, dni, legajo_nro)
VALUES (NULL, (SELECT id FROM public.roles WHERE nombre = 'ESTUDIANTE'),
        'Prueba', 'Ocupante', '89100900', 'LEG-SQL-ALTA-900');

-- Reproduce el alta de GoTrue: INSERT y luego UPDATE del `app_metadata`.
CREATE FUNCTION pg_temp.alta_como_gotrue(p_id UUID, p_email TEXT, p_alta JSONB)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    SET LOCAL ROLE supabase_auth_admin;
    INSERT INTO auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
                            created_at, updated_at)
    VALUES (p_id, 'authenticated', 'authenticated', p_email,
            '{"provider": "email", "providers": ["email"]}', '{}', now(), now());
    UPDATE auth.users
    SET raw_app_meta_data = raw_app_meta_data || pg_catalog.jsonb_build_object('ept_alta', p_alta)
    WHERE id = p_id;
    RESET ROLE;
END;
$$;


-- ================================================================
-- 1. ESTRUCTURA Y FRONTERA DE PRIVILEGIOS
-- ================================================================
DO $$
DECLARE
    v_definer BOOLEAN;
    v_config  TEXT[];
    v_tipo    SMALLINT;
    v_cols    TEXT;
    v_when    TEXT;
BEGIN
    SELECT p.prosecdef, p.proconfig INTO v_definer, v_config
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'app_private' AND p.proname = 'registrar_perfil_de_alta';

    IF v_definer IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'FALLO 1.1: la función no es SECURITY DEFINER';
    END IF;
    IF v_config IS DISTINCT FROM ARRAY['search_path=""'] THEN
        RAISE EXCEPTION 'FALLO 1.2: la función no fija search_path vacío: %', v_config;
    END IF;
    RAISE NOTICE 'OK 1: la función es SECURITY DEFINER con search_path vacío';

    IF has_function_privilege('anon', 'app_private.registrar_perfil_de_alta()', 'EXECUTE')
       OR has_function_privilege('authenticated', 'app_private.registrar_perfil_de_alta()', 'EXECUTE')
       OR has_function_privilege('service_role', 'app_private.registrar_perfil_de_alta()', 'EXECUTE')
    THEN
        RAISE EXCEPTION 'FALLO 2: un rol de aplicación puede invocar la función';
    END IF;
    RAISE NOTICE 'OK 2: ningún rol de aplicación puede invocar la función';

    SELECT t.tgtype, pg_get_triggerdef(t.oid)
    INTO v_tipo, v_when
    FROM pg_trigger t
    WHERE t.tgrelid = 'auth.users'::regclass
      AND t.tgname = 'registrar_perfil_al_crear_cuenta'
      AND t.tgenabled = 'O';

    IF v_when IS NULL
       OR v_when NOT ILIKE '%BEFORE INSERT OR UPDATE OF raw_app_meta_data ON auth.users%'
       OR v_when NOT ILIKE '%FOR EACH ROW%'
       OR v_when NOT ILIKE '%WHEN ((new.raw_app_meta_data ? ''ept_alta''::text))%'
       OR v_when NOT ILIKE '%EXECUTE FUNCTION app_private.registrar_perfil_de_alta()%'
    THEN
        RAISE EXCEPTION 'FALLO 3: el trigger no tiene la forma esperada: %', v_when;
    END IF;
    RAISE NOTICE 'OK 3: trigger BEFORE INSERT OR UPDATE OF raw_app_meta_data, por fila, con WHEN y habilitado';

    -- La premisa de seguridad: `raw_app_meta_data` solo llega por la API
    -- administrativa de GoTrue, porque ningún rol de aplicación escribe
    -- `auth.users` por SQL.
    IF has_table_privilege('anon', 'auth.users', 'INSERT, UPDATE')
       OR has_table_privilege('authenticated', 'auth.users', 'INSERT, UPDATE')
       OR has_table_privilege('service_role', 'auth.users', 'INSERT, UPDATE')
    THEN
        RAISE EXCEPTION 'FALLO 4: un rol de aplicación puede escribir auth.users';
    END IF;
    RAISE NOTICE 'OK 4: anon, authenticated y service_role no pueden escribir auth.users';

    -- Y el rol de GoTrue no recibió ningún privilegio sobre `perfiles`: el
    -- perfil se crea con los privilegios del dueño de la función, no con los
    -- suyos.
    IF has_table_privilege('supabase_auth_admin', 'public.perfiles', 'INSERT, UPDATE, DELETE') THEN
        RAISE EXCEPTION 'FALLO 5: supabase_auth_admin recibió privilegios sobre perfiles';
    END IF;
    RAISE NOTICE 'OK 5: supabase_auth_admin no tiene privilegios propios sobre perfiles';
END;
$$;


-- ================================================================
-- 2. ALTAS QUE DEBEN CONFIRMARSE
-- ================================================================
DO $$
DECLARE
    v_id     UUID := '89100001-0000-4000-8000-000000000001';
    v_perfil public.perfiles%ROWTYPE;
    v_app    JSONB;
BEGIN
    PERFORM pg_temp.alta_como_gotrue(v_id, 'sql.alta.1@ept.local', jsonb_build_object(
        'nombre', 'Prueba', 'apellido', 'Docente', 'dni', '89100001',
        'rol_id', (SELECT id FROM public.roles WHERE nombre = 'DOCENTE'),
        'telefono', '0362 4000001', 'direccion', NULL, 'legajo_nro', NULL));

    SELECT * INTO v_perfil FROM public.perfiles WHERE user_id = v_id;
    IF NOT FOUND
       OR v_perfil.dni <> '89100001'
       OR v_perfil.nombre <> 'Prueba'
       OR v_perfil.apellido <> 'Docente'
       OR v_perfil.telefono IS DISTINCT FROM '0362 4000001'
       OR v_perfil.direccion IS NOT NULL
       OR v_perfil.legajo_nro IS NOT NULL
    THEN
        RAISE EXCEPTION 'FALLO 6: el alta no creó el perfil con los datos pedidos';
    END IF;
    RAISE NOTICE 'OK 6: el UPDATE de app_metadata de GoTrue crea el perfil en la misma transacción';

    IF EXISTS (SELECT 1 FROM public.alumnos WHERE perfil_id = v_perfil.id) THEN
        RAISE EXCEPTION 'FALLO 7: un DOCENTE recibió legajo académico';
    END IF;
    RAISE NOTICE 'OK 7: un rol que no es ESTUDIANTE no recibe legajo académico';

    SELECT raw_app_meta_data INTO v_app FROM auth.users WHERE id = v_id;
    IF v_app ? 'ept_alta' THEN
        RAISE EXCEPTION 'FALLO 8.1: los datos del alta quedaron en raw_app_meta_data: %', v_app;
    END IF;
    IF v_app IS DISTINCT FROM '{"provider": "email", "providers": ["email"]}'::jsonb THEN
        RAISE EXCEPTION 'FALLO 8.2: se alteró el resto de raw_app_meta_data: %', v_app;
    END IF;
    RAISE NOTICE 'OK 8: la clave ept_alta se retira y el resto de app_metadata queda intacto';
END;
$$;

DO $$
DECLARE
    v_id     UUID := '89100002-0000-4000-8000-000000000002';
    v_estado public.estado_alumno;
BEGIN
    PERFORM pg_temp.alta_como_gotrue(v_id, 'sql.alta.2@ept.local', jsonb_build_object(
        'nombre', 'Prueba', 'apellido', 'Estudiante', 'dni', '89100002',
        'rol_id', (SELECT id FROM public.roles WHERE nombre = 'ESTUDIANTE'),
        'legajo_nro', 'LEG-SQL-ALTA-002'));

    SELECT a.estado INTO v_estado
    FROM public.alumnos a JOIN public.perfiles p ON p.id = a.perfil_id
    WHERE p.user_id = v_id;
    IF v_estado IS DISTINCT FROM 'INACTIVO' THEN
        RAISE EXCEPTION 'FALLO 9: el ESTUDIANTE no nació con legajo académico INACTIVO: %', v_estado;
    END IF;

    -- Las restricciones diferidas de 008 se comprueban ya, no al final.
    SET CONSTRAINTS ALL IMMEDIATE;
    SET CONSTRAINTS ALL DEFERRED;
    RAISE NOTICE 'OK 9: un ESTUDIANTE nace con perfil y legajo académico INACTIVO coherentes';
END;
$$;

-- Una versión de GoTrue que escribiera app_metadata desde el INSERT.
DO $$
DECLARE
    v_id  UUID := '89100003-0000-4000-8000-000000000003';
    v_rol INTEGER := (SELECT id FROM public.roles WHERE nombre = 'PERSONAL');
    v_app JSONB;
BEGIN
    SET LOCAL ROLE supabase_auth_admin;
    INSERT INTO auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
                            created_at, updated_at)
    VALUES (v_id, 'authenticated', 'authenticated', 'sql.alta.3@ept.local',
            jsonb_build_object('provider', 'email', 'ept_alta', jsonb_build_object(
                'nombre', 'Prueba', 'apellido', 'Insert', 'dni', '89100003', 'rol_id', v_rol)),
            '{}', now(), now());
    RESET ROLE;

    IF NOT EXISTS (SELECT 1 FROM public.perfiles WHERE user_id = v_id AND dni = '89100003') THEN
        RAISE EXCEPTION 'FALLO 10.1: el INSERT con app_metadata no creó el perfil';
    END IF;
    SELECT raw_app_meta_data INTO v_app FROM auth.users WHERE id = v_id;
    IF v_app ? 'ept_alta' THEN
        RAISE EXCEPTION 'FALLO 10.2: el INSERT dejó ept_alta en la fila';
    END IF;
    RAISE NOTICE 'OK 10: un alta que trae app_metadata desde el INSERT también crea el perfil y retira la clave';
END;
$$;

-- El mismo alta que vuelve a pasar: no duplica ni falla.
DO $$
DECLARE
    v_id  UUID := '89100001-0000-4000-8000-000000000001';
    v_rol INTEGER := (SELECT id FROM public.roles WHERE nombre = 'DOCENTE');
BEGIN
    SET LOCAL ROLE supabase_auth_admin;
    UPDATE auth.users
    SET raw_app_meta_data = raw_app_meta_data || jsonb_build_object('ept_alta', jsonb_build_object(
        'nombre', 'Prueba', 'apellido', 'Docente', 'dni', '89100001', 'rol_id', v_rol,
        'telefono', '0362 4000001', 'direccion', NULL, 'legajo_nro', NULL))
    WHERE id = v_id;
    RESET ROLE;

    IF (SELECT count(*) FROM public.perfiles WHERE user_id = v_id) <> 1 THEN
        RAISE EXCEPTION 'FALLO 11: repetir el mismo alta duplicó o perdió el perfil';
    END IF;
    RAISE NOTICE 'OK 11: repetir exactamente el mismo alta es idempotente';
END;
$$;


-- ================================================================
-- 3. ALTAS QUE DEBEN REVERTIRSE POR COMPLETO
-- ================================================================
-- Cada caso comprueba que no quedó NADA: ni la cuenta, ni un perfil, ni un
-- legajo académico. Es exactamente la garantía que la compensación anterior no
-- podía dar.
CREATE FUNCTION pg_temp.exigir_rechazo(
    p_caso TEXT, p_id UUID, p_email TEXT, p_alta JSONB, p_sqlstate TEXT, p_descripcion TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_sqlstate TEXT;
BEGIN
    BEGIN
        PERFORM pg_temp.alta_como_gotrue(p_id, p_email, p_alta);
        v_sqlstate := 'sin error';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    END;
    RESET ROLE;

    IF v_sqlstate IS DISTINCT FROM p_sqlstate THEN
        RAISE EXCEPTION 'FALLO %: se esperaba SQLSTATE % y se obtuvo %', p_caso, p_sqlstate, v_sqlstate;
    END IF;
    IF EXISTS (SELECT 1 FROM auth.users WHERE id = p_id OR email = p_email) THEN
        RAISE EXCEPTION 'FALLO %: la cuenta sobrevivió al rechazo', p_caso;
    END IF;
    IF EXISTS (SELECT 1 FROM public.perfiles WHERE user_id = p_id) THEN
        RAISE EXCEPTION 'FALLO %: quedó un perfil de la cuenta rechazada', p_caso;
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.alumnos a
        LEFT JOIN public.perfiles p ON p.id = a.perfil_id
        WHERE p.id IS NULL
    ) THEN
        RAISE EXCEPTION 'FALLO %: quedó un legajo académico huérfano', p_caso;
    END IF;
    RAISE NOTICE 'OK %: %; no quedó cuenta, perfil ni legajo', p_caso, p_descripcion;
END;
$$;

SELECT pg_temp.exigir_rechazo('12', '89100012-0000-4000-8000-000000000012', 'sql.alta.12@ept.local',
    jsonb_build_object('nombre', 'Prueba', 'apellido', 'DniRepetido', 'dni', '89100900',
                       'rol_id', (SELECT id FROM public.roles WHERE nombre = 'DOCENTE')),
    '23505', 'un DNI ya registrado revierte también la cuenta');

SELECT pg_temp.exigir_rechazo('13', '89100013-0000-4000-8000-000000000013', 'sql.alta.13@ept.local',
    jsonb_build_object('nombre', 'Prueba', 'apellido', 'LegajoRepetido', 'dni', '89100013',
                       'rol_id', (SELECT id FROM public.roles WHERE nombre = 'ESTUDIANTE'),
                       'legajo_nro', 'leg-sql-alta-900'),
    '23505', 'un legajo que solo difiere en mayúsculas revierte también la cuenta');

SELECT pg_temp.exigir_rechazo('14', '89100014-0000-4000-8000-000000000014', 'sql.alta.14@ept.local',
    jsonb_build_object('nombre', 'Prueba', 'apellido', 'RolInexistente', 'dni', '89100014',
                       'rol_id', 999999),
    '23503', 'un rol inexistente revierte también la cuenta');

SELECT pg_temp.exigir_rechazo('15', '89100015-0000-4000-8000-000000000015', 'sql.alta.15@ept.local',
    jsonb_build_object('nombre', 'Prueba', 'apellido', 'DniInvalido', 'dni', '123',
                       'rol_id', (SELECT id FROM public.roles WHERE nombre = 'DOCENTE')),
    '23514', 'un DNI que no cumple el contrato revierte también la cuenta');

SELECT pg_temp.exigir_rechazo('16', '89100016-0000-4000-8000-000000000016', 'sql.alta.16@ept.local',
    '"no es un objeto"'::jsonb,
    'P5520', 'un pedido de alta que no es un objeto se rechaza');

SELECT pg_temp.exigir_rechazo('17', '89100017-0000-4000-8000-000000000017', 'sql.alta.17@ept.local',
    jsonb_build_object('nombre', 'Prueba', 'apellido', 'ClaveExtra', 'dni', '89100017',
                       'rol_id', (SELECT id FROM public.roles WHERE nombre = 'DOCENTE'),
                       'rol', 'DIRECTOR'),
    'P5520', 'una clave que el perfil no admite se rechaza en lugar de ignorarse');

SELECT pg_temp.exigir_rechazo('18', '89100018-0000-4000-8000-000000000018', 'sql.alta.18@ept.local',
    jsonb_build_object('nombre', 'Prueba', 'apellido', 'TipoInvalido', 'dni', '89100018',
                       'rol_id', '4'),
    'P5520', 'un rol enviado como texto se rechaza');

SELECT pg_temp.exigir_rechazo('19', '89100019-0000-4000-8000-000000000019', 'sql.alta.19@ept.local',
    jsonb_build_object('apellido', 'SinNombre', 'dni', '89100019',
                       'rol_id', (SELECT id FROM public.roles WHERE nombre = 'DOCENTE')),
    'P5520', 'un pedido sin nombre se rechaza');


-- ================================================================
-- 4. LO QUE NO DEBE DISPARAR NI MODIFICAR NADA
-- ================================================================
-- Una cuenta que ya tiene perfil no se pisa con otros datos.
DO $$
DECLARE
    v_id       UUID := '89100001-0000-4000-8000-000000000001';
    v_rol      INTEGER := (SELECT id FROM public.roles WHERE nombre = 'DIRECTOR');
    v_sqlstate TEXT;
    v_app      JSONB;
BEGIN
    BEGIN
        SET LOCAL ROLE supabase_auth_admin;
        UPDATE auth.users
        SET raw_app_meta_data = raw_app_meta_data || jsonb_build_object('ept_alta', jsonb_build_object(
            'nombre', 'Otra', 'apellido', 'Persona', 'dni', '89100020', 'rol_id', v_rol))
        WHERE id = v_id;
        v_sqlstate := 'sin error';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    END;
    RESET ROLE;

    IF v_sqlstate IS DISTINCT FROM 'P5521' THEN
        RAISE EXCEPTION 'FALLO 20.1: se esperaba P5521 y se obtuvo %', v_sqlstate;
    END IF;
    IF (SELECT dni FROM public.perfiles WHERE user_id = v_id) <> '89100001'
       OR EXISTS (SELECT 1 FROM public.perfiles WHERE dni = '89100020')
    THEN
        RAISE EXCEPTION 'FALLO 20.2: se modificó o duplicó el perfil existente';
    END IF;
    SELECT raw_app_meta_data INTO v_app FROM auth.users WHERE id = v_id;
    IF v_app ? 'ept_alta' THEN
        RAISE EXCEPTION 'FALLO 20.3: el intento rechazado dejó ept_alta en la cuenta';
    END IF;
    RAISE NOTICE 'OK 20: una cuenta con perfil no acepta otro perfil ni cambia el que tiene';
END;
$$;

-- `raw_user_meta_data` lo controla el usuario: nunca crea un perfil.
DO $$
DECLARE
    v_id  UUID := '89100021-0000-4000-8000-000000000021';
    v_rol INTEGER := (SELECT id FROM public.roles WHERE nombre = 'DIRECTOR');
BEGIN
    SET LOCAL ROLE supabase_auth_admin;
    INSERT INTO auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
                            created_at, updated_at)
    VALUES (v_id, 'authenticated', 'authenticated', 'sql.alta.21@ept.local',
            '{"provider": "email", "providers": ["email"]}',
            jsonb_build_object('ept_alta', jsonb_build_object(
                'nombre', 'Intruso', 'apellido', 'Publico', 'dni', '89100021', 'rol_id', v_rol)),
            now(), now());
    UPDATE auth.users
    SET raw_user_meta_data = raw_user_meta_data || '{"email_verified": false}'
    WHERE id = v_id;
    RESET ROLE;

    IF EXISTS (SELECT 1 FROM public.perfiles WHERE user_id = v_id OR dni = '89100021') THEN
        RAISE EXCEPTION 'FALLO 21: raw_user_meta_data creó un perfil';
    END IF;
    RAISE NOTICE 'OK 21: un ept_alta en raw_user_meta_data (autorregistro) no crea ningún perfil';
END;
$$;

-- Las escrituras ordinarias de GoTrue no pasan por la función.
DO $$
DECLARE
    v_id    UUID := '89100002-0000-4000-8000-000000000002';
    v_antes BIGINT;
BEGIN
    SELECT count(*) INTO v_antes FROM public.perfiles;
    SET LOCAL ROLE supabase_auth_admin;
    UPDATE auth.users
    SET last_sign_in_at = now(), raw_app_meta_data = raw_app_meta_data || '{"providers": ["email"]}'
    WHERE id = v_id;
    RESET ROLE;

    IF (SELECT count(*) FROM public.perfiles) <> v_antes THEN
        RAISE EXCEPTION 'FALLO 22: una escritura ordinaria en auth.users modificó perfiles';
    END IF;
    RAISE NOTICE 'OK 22: un inicio de sesión o un cambio de app_metadata sin ept_alta no toca perfiles';
END;
$$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM auth.users WHERE raw_app_meta_data ? 'ept_alta') THEN
        RAISE EXCEPTION 'FALLO 23: quedaron datos del alta en auth.users';
    END IF;
    RAISE NOTICE 'OK 23: ninguna cuenta conserva datos personales del alta en app_metadata';
END;
$$;

ROLLBACK;
