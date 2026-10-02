-- ============================================================
-- EDUCAR PARA TRANSFORMAR — Usuarios, permisos y bloqueo de acceso (EPT-59)
-- ============================================================
-- Verifica la migración 20260926190000_ept_59_usuarios_permisos.sql dentro de
-- PostgreSQL, sin GoTrue ni HTTP.
--
-- Ejecutar exclusivamente contra la base local descartable después de
-- `supabase db reset`. Todo ocurre dentro de una transacción con ROLLBACK.
--
-- Se ejecuta con `supabase_admin`, el superusuario de la imagen local:
--
--     docker exec -i supabase_db_educar-para-transformar \
--       psql -X -U supabase_admin -d postgres -v ON_ERROR_STOP=1 \
--       < supabase/tests/usuarios_permisos_rls.sql
--
-- Motivo: el enlace D5 se prueba reproduciendo la escritura de GoTrue en
-- `auth.users` con el rol `supabase_auth_admin`, y `postgres` no puede asumirlo
-- (mismo criterio que `usuarios_alta_atomica.sql`). Las cuentas Auth de los
-- actores también se insertan como superusuario. Cada comprobación de permisos
-- se ejecuta con `SET LOCAL ROLE anon|authenticated|service_role|postgres`, de
-- modo que RLS y los privilegios se evalúan igual que en producción.
--
-- Cada comprobación imprime `OK …` o aborta con `FALLO …`. Una recursión de
-- políticas (42P17) cuenta como fallo aunque llegue como «denegación».
--
-- Todos los datos son sintéticos: DNI del rango 95.900.xxx y correos del
-- dominio reservado `ept59.invalid`. Ningún código de verificación se imprime.

\set ON_ERROR_STOP on
\pset tuples_only on
\o /dev/null

BEGIN;

-- ================================================================
-- 0. HERRAMIENTAS
-- ================================================================
CREATE FUNCTION pg_temp.u(p_sufijo TEXT)
RETURNS UUID LANGUAGE sql IMMUTABLE AS $$
    SELECT ('f5900000-0000-4000-8000-0000000000' || p_sufijo)::UUID;
$$;

CREATE FUNCTION pg_temp.claims(p_rol TEXT, p_sub UUID)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN p_sub IS NULL THEN pg_catalog.json_build_object('role', p_rol)::TEXT
                ELSE pg_catalog.json_build_object('sub', p_sub, 'role', p_rol)::TEXT END;
$$;

-- Ejecuta una consulta como el actor y SIEMPRE revierte sus efectos con una
-- excepción centinela. Devuelve el valor producido o `E:<SQLSTATE>`.
CREATE FUNCTION pg_temp.intentar(p_rol TEXT, p_sub UUID, p_sql TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
    v TEXT;
BEGIN
    BEGIN
        PERFORM pg_catalog.set_config('request.jwt.claims', pg_temp.claims(p_rol, p_sub), true);
        EXECUTE pg_catalog.format('SET LOCAL ROLE %I', p_rol);
        EXECUTE p_sql INTO v;
        RAISE EXCEPTION USING ERRCODE = 'P5999', MESSAGE = 'centinela';
    EXCEPTION
        WHEN SQLSTATE 'P5999' THEN NULL;
        WHEN OTHERS THEN v := 'E:' || SQLSTATE;
    END;
    RETURN COALESCE(v, '<NULL>');
END;
$$;

-- Ejecuta como el actor y CONSERVA los efectos si no hay error.
-- Devuelve `OK:<valor>` o `E:<SQLSTATE>`.
CREATE FUNCTION pg_temp.ejecutar(p_rol TEXT, p_sub UUID, p_sql TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
    v TEXT;
BEGIN
    BEGIN
        PERFORM pg_catalog.set_config('request.jwt.claims', pg_temp.claims(p_rol, p_sub), true);
        EXECUTE pg_catalog.format('SET LOCAL ROLE %I', p_rol);
        -- TRUNCATE no devuelve filas: no admite INTO.
        IF p_sql ILIKE 'TRUNCATE%' THEN
            EXECUTE p_sql;
        ELSE
            EXECUTE p_sql INTO v;
        END IF;
        RESET ROLE;
        PERFORM pg_catalog.set_config('request.jwt.claims', '{}', true);
        v := 'OK:' || COALESCE(v, '<NULL>');
    EXCEPTION WHEN OTHERS THEN
        v := 'E:' || SQLSTATE;
    END;
    RETURN v;
END;
$$;

CREATE FUNCTION pg_temp.exigir(p_condicion BOOLEAN, p_mensaje TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    IF p_condicion IS NOT TRUE THEN
        RAISE EXCEPTION 'FALLO %', p_mensaje;
    END IF;
END;
$$;

CREATE FUNCTION pg_temp.ok(p_mensaje TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    RAISE NOTICE 'OK %', p_mensaje;
END;
$$;

-- Exige un SQLSTATE puntual (o éxito con 'OK') y nunca 42P17.
CREATE FUNCTION pg_temp.esperar(p_resultado TEXT, p_esperado TEXT, p_mensaje TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    IF p_resultado = 'E:42P17' THEN
        RAISE EXCEPTION 'FALLO % → recursión de políticas (42P17)', p_mensaje;
    END IF;
    IF (p_esperado = 'OK' AND p_resultado NOT LIKE 'OK:%')
       OR (p_esperado <> 'OK' AND p_resultado IS DISTINCT FROM p_esperado) THEN
        RAISE EXCEPTION 'FALLO % → se obtuvo %, se esperaba %', p_mensaje, p_resultado, p_esperado;
    END IF;
END;
$$;

-- Reproduce el alta de GoTrue v2.196.0: INSERT y luego UPDATE del
-- `app_metadata`, con el rol de GoTrue.
CREATE FUNCTION pg_temp.alta_como_gotrue(p_id UUID, p_email TEXT, p_app JSONB, p_user JSONB DEFAULT '{}')
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    SET LOCAL ROLE supabase_auth_admin;
    INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data,
                            raw_user_meta_data, created_at, updated_at)
    VALUES (p_id, 'authenticated', 'authenticated', p_email, now(),
            '{"provider": "email", "providers": ["email"]}', p_user, now(), now());
    UPDATE auth.users
    SET raw_app_meta_data = raw_app_meta_data || p_app
    WHERE id = p_id;
    RESET ROLE;
END;
$$;

-- Igual, pero un rechazo del trigger revierte todo (como GoTrue) y se
-- devuelve el SQLSTATE.
CREATE FUNCTION pg_temp.intentar_alta(p_id UUID, p_email TEXT, p_app JSONB, p_user JSONB DEFAULT '{}')
RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
    BEGIN
        PERFORM pg_temp.alta_como_gotrue(p_id, p_email, p_app, p_user);
        RETURN 'OK:';
    EXCEPTION WHEN OTHERS THEN
        RETURN 'E:' || SQLSTATE;
    END;
END;
$$;

CREATE TEMPORARY TABLE fx (clave TEXT PRIMARY KEY, valor TEXT NOT NULL);
CREATE FUNCTION pg_temp.fx(p_clave TEXT)
RETURNS TEXT LANGUAGE sql STABLE AS $$
    SELECT valor FROM fx WHERE clave = p_clave;
$$;

CREATE TEMPORARY TABLE resultados (
    fase    TEXT NOT NULL,
    actor   TEXT NOT NULL,
    objeto  TEXT NOT NULL,
    op      TEXT NOT NULL,
    res     TEXT NOT NULL
);


-- ================================================================
-- 1. DATOS SINTÉTICOS
-- ================================================================
-- Si la base trae Directores efectivos ajenos a la prueba, se neutralizan
-- dentro de esta transacción (se revierte al final): la regla del último
-- Director cuenta Directores de toda la base.
DO $$
DECLARE v_n INTEGER;
BEGIN
    UPDATE auth.users u SET banned_until = 'infinity'
    WHERE u.id IN (
        SELECT p.user_id FROM public.perfiles p JOIN public.roles r ON r.id = p.rol_id
        WHERE r.nombre = 'DIRECTOR' AND p.user_id IS NOT NULL
    ) AND u.id::TEXT NOT LIKE 'f5900000-%';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE NOTICE 'Preparación: % cuenta(s) de Dirección ajenas a la prueba neutralizadas en esta transacción.', v_n;
END $$;

-- Cuentas Auth de los actores con sesión (confirmadas, no anónimas).
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data,
                        raw_user_meta_data, created_at, updated_at)
SELECT pg_temp.u(s), 'authenticated', 'authenticated', 'actor.' || s || '@ept59.invalid', now(),
       '{"provider": "email", "providers": ["email"]}', '{}', now(), now()
FROM pg_catalog.unnest(ARRAY['01', '02', '03', '04', '05', '06', '07']) AS s;

-- Perfiles. Sin cuenta salvo los actores 01–06.
INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni, legajo_nro)
SELECT pg_temp.u(v.s), CASE WHEN v.cuenta THEN pg_temp.u(v.s) END, r.id,
       'Prueba', v.apellido, '959000' || v.s_dni, v.legajo
FROM (VALUES
    ('01', '01', TRUE,  'DIRECTOR',   'Dirección uno',        NULL),
    ('02', '02', TRUE,  'DIRECTOR',   'Dirección dos',        NULL),
    ('03', '03', TRUE,  'DOCENTE',    'Docente',              'LEG-EPT59-DOC'),
    ('04', '04', TRUE,  'ESTUDIANTE', 'Estudiante',           'LEG-EPT59-EST'),
    ('05', '05', TRUE,  'PADRE',      'Familia',              NULL),
    ('06', '06', TRUE,  'PERSONAL',   'Personal',             NULL),
    ('08', '08', TRUE,  'DIRECTOR',   'Dirección sin efecto', NULL),
    ('10', '10', FALSE, 'PADRE',      'Padre sin hijos',      NULL),
    ('11', '11', FALSE, 'PADRE',      'Padre con hijo',       NULL),
    ('12', '12', FALSE, 'DOCENTE',    'Docente activo',       NULL),
    ('13', '13', FALSE, 'DOCENTE',    'Docente con materia',  NULL),
    ('14', '14', FALSE, 'DOCENTE',    'Docente con grupo',    NULL),
    ('15', '15', FALSE, 'DOCENTE',    'Docente inactivo',     NULL),
    ('16', '16', FALSE, 'PERSONAL',   'Personal A',           NULL),
    ('17', '17', FALSE, 'PERSONAL',   'Personal ex docente',  NULL),
    ('18', '18', FALSE, 'ESTUDIANTE', 'Estudiante sin cuenta', NULL),
    ('19', '19', FALSE, 'PERSONAL',   'Personal C',           NULL),
    ('1a', '20', FALSE, NULL,         'Sin rol',              NULL),
    ('1c', '21', FALSE, 'DOCENTE',    'Docente sin cuenta',   NULL),
    ('1d', '22', FALSE, 'PERSONAL',   'Personal bloqueado',   NULL),
    ('1e', '23', FALSE, 'PERSONAL',   'Personal batería',     NULL),
    ('1f', '24', FALSE, 'PERSONAL',   'Personal intentos',    NULL),
    ('20', '25', FALSE, 'PERSONAL',   'Personal vencimiento', NULL),
    ('21', '26', FALSE, 'PERSONAL',   'Docente sin ficha',    NULL),
    ('22', '27', FALSE, 'PERSONAL',   'Personal reserva',     NULL),
    ('23', '28', FALSE, 'PERSONAL',   'Personal consulta',    NULL)
) AS v(s, s_dni, cuenta, rol, apellido, legajo)
LEFT JOIN public.roles r ON r.nombre = v.rol;

-- Un DIRECTOR sin cuenta solo puede existir por datos previos: se inserta como
-- propietario para probar que D5 no lo acepta.
INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni)
VALUES (pg_temp.u('1b'), NULL, (SELECT id FROM public.roles WHERE nombre = 'DIRECTOR'),
        'Prueba', 'Dirección sin cuenta', '95900029');

-- `21`: perfil DOCENTE sin ficha (dato previo a EPT-58): nace PERSONAL y se
-- cambia el rol por fuera del trigger de alta.
UPDATE public.perfiles SET rol_id = (SELECT id FROM public.roles WHERE nombre = 'DOCENTE')
WHERE id = pg_temp.u('21');

-- `17`: ex docente con ficha INACTIVO conservada.
INSERT INTO public.profesores (perfil_id, estado, especialidad)
VALUES (pg_temp.u('17'), 'INACTIVO', 'Música');

-- Ficha completa del docente con sesión.
UPDATE public.profesores SET especialidad = 'Historia' WHERE perfil_id = pg_temp.u('03');

-- Cursos y matrícula del estudiante con sesión.
INSERT INTO public.cursos (id, nivel_id, denominacion, division, activo)
VALUES (pg_temp.u('c1'), (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'), 'Curso EPT59', 'A', TRUE),
       (pg_temp.u('c2'), (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'), 'Curso EPT59', 'B', TRUE);

INSERT INTO public.matriculas (alumno_id, curso_id) VALUES (pg_temp.u('04'), pg_temp.u('c1'));
UPDATE public.alumnos SET estado = 'ACTIVO' WHERE perfil_id = pg_temp.u('04');
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

INSERT INTO public.padres_hijos (padre_id, hijo_id)
VALUES (pg_temp.u('05'), pg_temp.u('04')),
       (pg_temp.u('11'), pg_temp.u('18'));

-- Contenido de las superficies públicas y de los formularios.
INSERT INTO public.galeria (url, descripcion) VALUES ('https://ejemplo.invalid/ept59.png', 'Galería EPT59');
INSERT INTO public.menu_escolar (dia_semana, descripcion) VALUES ('LUNES', 'Menú EPT59');
INSERT INTO public.noticias (titulo, contenido) VALUES ('Noticia EPT59', 'Contenido EPT59');
INSERT INTO public.opiniones (nombre_usuario, comentario, aprobado)
VALUES ('Prueba', 'Opinión aprobada EPT59', TRUE), ('Prueba', 'Opinión pendiente EPT59', FALSE);
INSERT INTO public.postulaciones (nombre, apellido, email, telefono, puesto, mensaje)
VALUES ('Prueba', 'Postulante', 'postulante@ept59.invalid', '0000', 'Docente', 'Mensaje');
INSERT INTO public.solicitudes_inscripcion (datos_aspirante) VALUES ('{"nombre": "Prueba"}');
INSERT INTO public.asistencias (estudiante_id, docente_id, fecha, estado)
VALUES (pg_temp.u('04'), pg_temp.u('03'), CURRENT_DATE, 'PRESENTE');
INSERT INTO public.inscripciones (estudiante_id, actividad_id)
VALUES (pg_temp.u('04'), (SELECT id FROM public.actividades WHERE tipo = 'TALLER' ORDER BY id LIMIT 1));

-- Estructura académica y deportiva creada por las RPC de la dirección.
DO $$
DECLARE
    v TEXT;
    D1 CONSTANT UUID := pg_temp.u('01');
BEGIN
    v := pg_temp.ejecutar('authenticated', D1, $q$SELECT (public.crear_materia('Materia EPT59')).id::TEXT$q$);
    PERFORM pg_temp.esperar(v, 'OK', 'fixture crear_materia');
    INSERT INTO fx VALUES ('materia', pg_catalog.substr(v, 4));

    v := pg_temp.ejecutar('authenticated', D1, pg_catalog.format(
        'SELECT (public.asignar_materia_curso(%s, %L, %L)).id::TEXT',
        pg_temp.fx('materia'), pg_temp.u('c1'), pg_temp.u('03')));
    PERFORM pg_temp.esperar(v, 'OK', 'fixture asignar_materia_curso');
    INSERT INTO fx VALUES ('asig', pg_catalog.substr(v, 4));

    v := pg_temp.ejecutar('authenticated', D1, pg_catalog.format(
        'SELECT (public.configurar_horario_materia(%L, 1::smallint, %L, %L, NULL)).id::TEXT',
        pg_temp.fx('asig'), '08:00', '09:00'));
    PERFORM pg_temp.esperar(v, 'OK', 'fixture configurar_horario_materia');
    INSERT INTO fx VALUES ('franja', pg_catalog.substr(v, 4));

    v := pg_temp.ejecutar('authenticated', D1, pg_catalog.format(
        'SELECT (public.crear_grupo_deportivo(%L, %s, %L, 10, %L)).id::TEXT',
        'e0000000-0000-4000-8000-000000000101',
        (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'), 'Grupo EPT59', pg_temp.u('03')));
    PERFORM pg_temp.esperar(v, 'OK', 'fixture crear_grupo_deportivo');
    INSERT INTO fx VALUES ('grupo', pg_catalog.substr(v, 4));

    v := pg_temp.ejecutar('authenticated', D1, pg_catalog.format(
        'SELECT (public.agregar_horario_grupo_deportivo(%L, 3::smallint, %L, %L)).id::TEXT',
        pg_temp.fx('grupo'), '18:00', '19:00'));
    PERFORM pg_temp.esperar(v, 'OK', 'fixture agregar_horario_grupo_deportivo');
    INSERT INTO fx VALUES ('gfranja', pg_catalog.substr(v, 4));

    v := pg_temp.ejecutar('authenticated', pg_temp.u('04'), pg_catalog.format(
        'SELECT (public.inscribir_en_grupo_deportivo(%L)).id::TEXT', pg_temp.fx('grupo')));
    PERFORM pg_temp.esperar(v, 'OK', 'fixture inscribir_en_grupo_deportivo');
    INSERT INTO fx VALUES ('insc_dep', pg_catalog.substr(v, 4));

    v := pg_temp.ejecutar('authenticated', pg_temp.u('04'), pg_catalog.format(
        'SELECT (public.inscribir_en_servicio(%L)).id::TEXT', 'e0000000-0000-4000-8000-000000000010'));
    PERFORM pg_temp.esperar(v, 'OK', 'fixture inscribir_en_servicio');
    INSERT INTO fx VALUES ('insc_serv', pg_catalog.substr(v, 4));

    -- EPT-64: una credencial QR vigente del estudiante 04 (la emite la Dirección con la RPC real).
    v := pg_temp.ejecutar('authenticated', D1, pg_catalog.format(
        'SELECT (public.emitir_credencial_qr(%L, %L)).id::TEXT', pg_temp.u('04'), 'k1'));
    PERFORM pg_temp.esperar(v, 'OK', 'fixture emitir_credencial_qr');
    INSERT INTO fx VALUES ('cred_qr', pg_catalog.substr(v, 4));

    v := pg_temp.ejecutar('authenticated', D1, $q$SELECT (public.crear_nivel('NIVEL EPT59')).id::TEXT$q$);
    PERFORM pg_temp.esperar(v, 'OK', 'fixture crear_nivel');
    INSERT INTO fx VALUES ('nivel', pg_catalog.substr(v, 4));

    -- 13 y 14 quedan a cargo mientras están ACTIVO; después la ficha pasa a
    -- INACTIVO por fuera de la RPC (dato previo inconsistente que la
    -- transición de rol igual debe rechazar).
    v := pg_temp.ejecutar('authenticated', D1, pg_catalog.format(
        'SELECT (public.asignar_materia_curso(%s, %L, %L)).id::TEXT',
        pg_temp.fx('materia'), pg_temp.u('c2'), pg_temp.u('13')));
    PERFORM pg_temp.esperar(v, 'OK', 'fixture asignación del docente 13');

    v := pg_temp.ejecutar('authenticated', D1, pg_catalog.format(
        'SELECT (public.crear_grupo_deportivo(%L, %s, %L, 10, %L)).id::TEXT',
        'e0000000-0000-4000-8000-000000000102',
        (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'), 'Grupo EPT59 docente 14', pg_temp.u('14')));
    PERFORM pg_temp.esperar(v, 'OK', 'fixture grupo del docente 14');

    UPDATE public.profesores SET estado = 'INACTIVO' WHERE perfil_id IN (pg_temp.u('13'), pg_temp.u('14'));

    -- 15 pasa a INACTIVO por la RPC: deja historial de estados de profesor.
    v := pg_temp.ejecutar('authenticated', D1, pg_catalog.format(
        'SELECT (public.cambiar_estado_profesor(%L, %L, %L)).estado::TEXT',
        pg_temp.u('15'), 'INACTIVO', 'Licencia'));
    PERFORM pg_temp.esperar(v, 'OK:INACTIVO', 'fixture inactivar docente 15');

    -- Reserva D5 persistente para las consultas de la batería.
    v := pg_temp.ejecutar('authenticated', D1, pg_catalog.format(
        'SELECT estado FROM public.reservar_vinculo_cuenta(%L, %L, %L, %L, NULL, true)',
        pg_temp.u('f1'), pg_temp.u('23'), '95900028', 'TITULAR'));
    PERFORM pg_temp.esperar(v, 'OK:PENDIENTE', 'fixture reserva D5 persistente');

    PERFORM pg_temp.ok('00: datos sintéticos, estructura académica, deportiva, servicios y reserva D5 creados');
END $$;


-- ================================================================
-- 2. CATÁLOGO
-- ================================================================
DO $$
DECLARE
    v_nuevas TEXT[] := ARRAY[
        'mi_estado_acceso', 'cambiar_rol_perfil', 'cambiar_acceso_perfil', 'estado_acceso_de',
        'listar_usuarios', 'consultar_usuario', 'listar_historial_usuario',
        'reservar_vinculo_cuenta', 'consultar_vinculo', 'cancelar_vinculo',
        'emitir_desafio_vinculo', 'anular_desafio_vinculo', 'verificar_desafio_vinculo',
        'datos_para_enlace'
    ];
    v_servidor TEXT[] := ARRAY['emitir_desafio_vinculo', 'anular_desafio_vinculo',
                               'verificar_desafio_vinculo', 'datos_para_enlace'];
    v_internas TEXT[] := ARRAY['es_director_efectivo', 'contar_directores_efectivos',
                               'vincular_cuenta_de_alta', 'describir_vinculo', 'director_habilitado',
                               'reserva_para_servidor', 'normalizar_motivo_cambio', 'enmascarar_correo',
                               'impedir_cambios_historial_perfiles', 'impedir_borrar_vinculos_cuenta'];
    r RECORD;
    v_faltan TEXT;
BEGIN
    -- 2.1 DEFINER solo en app_private, con search_path vacío.
    FOR r IN
        SELECT n.nspname, p.proname, p.oid, p.prosecdef, p.proconfig
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('public', 'app_private')
          AND (p.proname = ANY (v_nuevas) OR p.proname = ANY (v_internas)
               OR p.proname = 'acceso_bloqueado'
               OR (n.nspname = 'app_private' AND p.proname IN ('es_director', 'rol_actual', 'perfil_actual', 'mis_hijos_ids')))
    LOOP
        PERFORM pg_temp.exigir(r.proconfig = ARRAY['search_path=""'],
            pg_catalog.format('2.1 %s.%s sin search_path vacío', r.nspname, r.proname));
        PERFORM pg_temp.exigir(NOT (r.nspname = 'public' AND r.prosecdef),
            pg_catalog.format('2.1 public.%s es SECURITY DEFINER', r.proname));
        PERFORM pg_temp.exigir(r.nspname = 'public' OR r.prosecdef
                               OR r.proname IN ('normalizar_motivo_cambio', 'enmascarar_correo',
                                                'impedir_cambios_historial_perfiles', 'impedir_borrar_vinculos_cuenta'),
            pg_catalog.format('2.1 app_private.%s debería ser SECURITY DEFINER', r.proname));
        PERFORM pg_temp.exigir(NOT pg_catalog.has_function_privilege('anon', r.oid, 'EXECUTE'),
            pg_catalog.format('2.1 anon ejecuta %s.%s', r.nspname, r.proname));

        IF r.proname = ANY (v_servidor) THEN
            PERFORM pg_temp.exigir(pg_catalog.has_function_privilege('service_role', r.oid, 'EXECUTE')
                                   AND NOT pg_catalog.has_function_privilege('authenticated', r.oid, 'EXECUTE'),
                pg_catalog.format('2.2 %s.%s debe ser solo de service_role', r.nspname, r.proname));
        ELSIF r.proname = ANY (v_nuevas) THEN
            PERFORM pg_temp.exigir(pg_catalog.has_function_privilege('authenticated', r.oid, 'EXECUTE')
                                   AND NOT pg_catalog.has_function_privilege('service_role', r.oid, 'EXECUTE'),
                pg_catalog.format('2.2 %s.%s debe ser solo de authenticated', r.nspname, r.proname));
        ELSIF r.proname = ANY (v_internas) THEN
            PERFORM pg_temp.exigir(NOT pg_catalog.has_function_privilege('authenticated', r.oid, 'EXECUTE')
                                   AND NOT pg_catalog.has_function_privilege('service_role', r.oid, 'EXECUTE'),
                pg_catalog.format('2.2 %s.%s interna es ejecutable', r.nspname, r.proname));
        ELSE
            PERFORM pg_temp.exigir(pg_catalog.has_function_privilege('authenticated', r.oid, 'EXECUTE')
                                   AND NOT pg_catalog.has_function_privilege('service_role', r.oid, 'EXECUTE'),
                pg_catalog.format('2.2 %s.%s perdió o amplió privilegios', r.nspname, r.proname));
        END IF;
    END LOOP;
    PERFORM pg_temp.ok('01: DEFINER solo en app_private con search_path vacío; envoltorios INVOKER; EXECUTE exacto (4 solo service_role, internas de nadie, nada para anon)');

    -- 2.3 RLS en tablas nuevas y privilegios mínimos.
    PERFORM pg_temp.exigir((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.perfiles_historial'::regclass)
                           AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'app_private.vinculos_cuenta'::regclass),
        '2.3 tablas nuevas sin RLS');
    PERFORM pg_temp.exigir(NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'app_private' AND tablename = 'vinculos_cuenta'),
        '2.3 vinculos_cuenta no debe tener políticas');
    PERFORM pg_temp.exigir(NOT pg_catalog.has_table_privilege('authenticated', 'app_private.vinculos_cuenta', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
                           AND NOT pg_catalog.has_table_privilege('service_role', 'app_private.vinculos_cuenta', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
                           AND NOT pg_catalog.has_table_privilege('anon', 'app_private.vinculos_cuenta', 'SELECT'),
        '2.3 un rol de aplicación accede a vinculos_cuenta');
    PERFORM pg_temp.exigir(pg_catalog.has_table_privilege('authenticated', 'public.perfiles_historial', 'SELECT')
                           AND NOT pg_catalog.has_table_privilege('authenticated', 'public.perfiles_historial', 'INSERT,UPDATE,DELETE,TRUNCATE')
                           AND NOT pg_catalog.has_table_privilege('anon', 'public.perfiles_historial', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
                           AND NOT pg_catalog.has_table_privilege('service_role', 'public.perfiles_historial', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
                           AND NOT pg_catalog.has_sequence_privilege('authenticated', 'public.perfiles_historial_id_seq', 'USAGE,UPDATE'),
        '2.3 privilegios del historial fuera de contrato');
    PERFORM pg_temp.exigir(NOT pg_catalog.has_table_privilege('authenticated', 'public.perfiles', 'DELETE')
                           AND NOT pg_catalog.has_table_privilege('anon', 'public.perfiles', 'DELETE'),
        '2.3 DELETE sobre perfiles');
    PERFORM pg_temp.ok('02: RLS en perfiles_historial y vinculos_cuenta; historial solo SELECT para authenticated; sin DELETE en perfiles');

    -- 2.4 Ningún TRUNCATE para anon/authenticated en public.
    SELECT pg_catalog.string_agg(c.relname || '/' || x.rol, ', ') INTO v_faltan
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN (VALUES ('anon'), ('authenticated')) AS x(rol)
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm', 'p', 'f')
      AND pg_catalog.has_table_privilege(x.rol, c.oid, 'TRUNCATE');
    PERFORM pg_temp.exigir(v_faltan IS NULL, '2.4 TRUNCATE abierto: ' || COALESCE(v_faltan, ''));
    PERFORM pg_temp.ok('03: ninguna tabla ni vista de public admite TRUNCATE de anon o authenticated');

    -- 2.5 Toda tabla con RLS y con la política restrictiva de bloqueo.
    SELECT pg_catalog.string_agg(c.relname, ', ') INTO v_faltan
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND (NOT c.relrowsecurity OR NOT EXISTS (
          SELECT 1 FROM pg_policies p
          WHERE p.schemaname = 'public' AND p.tablename = c.relname
            AND p.permissive = 'RESTRICTIVE'
            AND p.policyname LIKE 'Bloqueo de acceso sin datos protegidos%'
            AND p.roles = ARRAY['authenticated']::name[]));
    PERFORM pg_temp.exigir(v_faltan IS NULL, '2.5 tablas sin bloqueo restrictivo: ' || COALESCE(v_faltan, ''));

    -- Las excepciones públicas coinciden exactamente.
    SELECT pg_catalog.string_agg(t.relname || ':' || k.cmd, ', ' ORDER BY t.relname, k.cmd) INTO v_faltan
    FROM (SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'r') t
    CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) k(cmd)
    WHERE NOT EXISTS (
        SELECT 1 FROM pg_policies p
        WHERE p.schemaname = 'public' AND p.tablename = t.relname AND p.permissive = 'RESTRICTIVE'
          AND (p.cmd = k.cmd OR p.cmd = 'ALL'));
    PERFORM pg_temp.exigir(v_faltan = 'actividades:SELECT, galeria:SELECT, menu_escolar:SELECT, noticias:SELECT, postulaciones:INSERT, solicitudes_inscripcion:INSERT',
        '2.5 excepciones públicas distintas: ' || COALESCE(v_faltan, '(ninguna)'));
    PERFORM pg_temp.ok('04: las ' || (SELECT pg_catalog.count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                                      WHERE n.nspname = 'public' AND c.relkind = 'r')
                       || ' tablas de public tienen RLS y bloqueo restrictivo; excepciones públicas exactas');

    -- 2.6 UPDATE directo de identidad, rol y acceso: sin privilegio de columna.
    PERFORM pg_temp.exigir(NOT pg_catalog.has_column_privilege('authenticated', 'public.perfiles', 'rol_id', 'UPDATE')
                           AND NOT pg_catalog.has_column_privilege('authenticated', 'public.perfiles', 'user_id', 'UPDATE')
                           AND NOT pg_catalog.has_column_privilege('authenticated', 'public.perfiles', 'estado_acceso', 'UPDATE'),
        '2.6 privilegio de UPDATE sobre rol_id, user_id o estado_acceso');
    PERFORM pg_temp.ok('05: authenticated no tiene UPDATE de columna sobre rol_id, user_id ni estado_acceso');
END $$;


-- ================================================================
-- 3. MATRIZ DE PERMISOS: TABLAS, VISTAS Y RPC POR ACTOR
-- ================================================================
-- INSERT válidos: el que tenga permiso debería poder hacerlos. El resto de
-- las relaciones se prueba con DEFAULT VALUES.
CREATE TEMPORARY TABLE inserciones (tabla TEXT PRIMARY KEY, sql TEXT NOT NULL);
INSERT INTO inserciones VALUES
    ('asistencias', pg_catalog.format(
        'INSERT INTO public.asistencias (estudiante_id, docente_id, fecha, estado) VALUES (%L, %L, CURRENT_DATE - 1, %L)',
        pg_temp.u('04'), pg_temp.u('03'), 'AUSENTE')),
    ('cursos', pg_catalog.format(
        'INSERT INTO public.cursos (nivel_id, denominacion, division) VALUES (%s, %L, %L)',
        (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'), 'Curso EPT59 batería', 'Z')),
    ('galeria', $s$INSERT INTO public.galeria (url) VALUES ('https://ejemplo.invalid/bateria.png')$s$),
    ('menu_escolar', $s$INSERT INTO public.menu_escolar (dia_semana, descripcion) VALUES ('MARTES', 'Menú batería')$s$),
    ('noticias', $s$INSERT INTO public.noticias (titulo, contenido) VALUES ('Noticia batería', 'Contenido')$s$),
    ('inscripciones', pg_catalog.format(
        'INSERT INTO public.inscripciones (estudiante_id, actividad_id) VALUES (%L, %s)',
        pg_temp.u('04'), (SELECT id FROM public.actividades WHERE tipo = 'TALLER' ORDER BY id DESC LIMIT 1))),
    ('opiniones', $s$INSERT INTO public.opiniones (comentario) VALUES ('Opinión de batería')$s$),
    ('padres_hijos', pg_catalog.format(
        'INSERT INTO public.padres_hijos (padre_id, hijo_id) VALUES (%L, %L)', pg_temp.u('10'), pg_temp.u('04'))),
    ('perfiles', pg_catalog.format(
        'INSERT INTO public.perfiles (nombre, apellido, dni, rol_id) VALUES (%L, %L, %L, %s)',
        'Prueba', 'Alta batería', '95900990', (SELECT id FROM public.roles WHERE nombre = 'PERSONAL'))),
    ('postulaciones', $s$INSERT INTO public.postulaciones (nombre, apellido, email, telefono, puesto, mensaje) VALUES ('Prueba', 'Batería', 'bateria@ept59.invalid', '0000', 'Docente', 'Mensaje')$s$),
    ('solicitudes_inscripcion', $s$INSERT INTO public.solicitudes_inscripcion (datos_aspirante) VALUES ('{"nombre": "Batería"}')$s$);

-- RPC: tipo v = valor escalar, n = cantidad de filas, x = operación (solo
-- importa si se completa). Una fila por envoltorio público ejecutable por
-- authenticated, más los auxiliares de identidad de app_private.
CREATE TEMPORARY TABLE rpcs (nombre TEXT PRIMARY KEY, sql TEXT NOT NULL, bloqueado TEXT);

CREATE FUNCTION pg_temp.rpc(p_nombre TEXT, p_tipo TEXT, p_expr TEXT, p_bloqueado TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE sql AS $$
    INSERT INTO rpcs VALUES (p_nombre,
        CASE p_tipo
            WHEN 'v' THEN 'SELECT ''v='' || COALESCE((' || p_expr || ')::TEXT, ''<NULL>'')'
            WHEN 'n' THEN 'SELECT ''n='' || pg_catalog.count(*) FROM ' || p_expr || ' AS f'
            ELSE 'SELECT ''ok'' FROM (SELECT ' || p_expr || ') AS f LIMIT 1'
        END,
        p_bloqueado);
$$;

DO $$
DECLARE
    DOC TEXT := pg_temp.u('03'); EST TEXT := pg_temp.u('04'); EST2 TEXT := pg_temp.u('18');
    PER TEXT := pg_temp.u('06'); PER2 TEXT := pg_temp.u('1e'); DOCA TEXT := pg_temp.u('12');
    DOCI TEXT := pg_temp.u('15');
    C1 TEXT := pg_temp.u('c1'); C2 TEXT := pg_temp.u('c2');
    MAT TEXT := pg_temp.fx('materia'); ASIG TEXT := pg_temp.fx('asig'); FR TEXT := pg_temp.fx('franja');
    GR TEXT := pg_temp.fx('grupo'); GFR TEXT := pg_temp.fx('gfranja'); NIV TEXT := pg_temp.fx('nivel');
    IDEP TEXT := pg_temp.fx('insc_dep'); ISERV TEXT := pg_temp.fx('insc_serv');
    CRED TEXT := pg_temp.fx('cred_qr');
    f TEXT := 'e0000000-0000-4000-8000-000000000101';
    s TEXT := 'e0000000-0000-4000-8000-000000000010';
    t TEXT := 'e0000000-0000-4000-8000-000000000020';
    OPF TEXT := pg_temp.u('f1'); OPB TEXT := pg_temp.u('f2'); PERB TEXT := pg_temp.u('22');
BEGIN
    PERFORM pg_temp.rpc('public.actualizar_ficha_profesor', 'x', pg_catalog.format('public.actualizar_ficha_profesor(%L, %L, %L)', DOC, 'LEG-EPT59-BAT', 'Geografía'));
    PERFORM pg_temp.rpc('public.actualizar_recorrido', 'x', pg_catalog.format('public.actualizar_recorrido(%L, %L, true)', t, 'Recorrido Norte (batería EPT59)'));
    PERFORM pg_temp.rpc('public.agregar_horario_grupo_deportivo', 'x', pg_catalog.format('public.agregar_horario_grupo_deportivo(%L, 4::smallint, %L, %L)', GR, '10:00', '11:00'));
    PERFORM pg_temp.rpc('public.asignar_materia_curso', 'x', pg_catalog.format('public.asignar_materia_curso(%s, %L, %L)', MAT, C2, DOC));
    PERFORM pg_temp.rpc('public.calcular_porcentaje_asistencia', 'v', pg_catalog.format('public.calcular_porcentaje_asistencia(%L)', EST));
    -- EPT-63: reportes oficiales (solo Dirección habilitada; el resto recibe 42501).
    PERFORM pg_temp.rpc('public.catalogos_reportes', 'v', 'public.catalogos_reportes()');
    PERFORM pg_temp.rpc('public.reporte_alumnos_curso', 'n', 'public.reporte_alumnos_curso()');
    PERFORM pg_temp.rpc('public.reporte_alumnos_deporte', 'n', 'public.reporte_alumnos_deporte()');
    PERFORM pg_temp.rpc('public.reporte_alumnos_horario', 'n', 'public.reporte_alumnos_horario()');
    PERFORM pg_temp.rpc('public.reporte_alumnos_materia', 'n', 'public.reporte_alumnos_materia()');
    PERFORM pg_temp.rpc('public.reporte_alumnos_recorrido', 'n', 'public.reporte_alumnos_recorrido()');
    PERFORM pg_temp.rpc('public.reporte_docentes_nivel', 'n', 'public.reporte_docentes_nivel()');
    PERFORM pg_temp.rpc('public.cambiar_curso_alumno', 'x', pg_catalog.format('public.cambiar_curso_alumno(%L, %L)', EST, C2));
    PERFORM pg_temp.rpc('public.cambiar_estado_asignacion', 'x', pg_catalog.format('public.cambiar_estado_asignacion(%L, false)', ASIG));
    PERFORM pg_temp.rpc('public.cambiar_estado_deporte', 'x', pg_catalog.format('public.cambiar_estado_deporte(%L, false)', 'e0000000-0000-4000-8000-000000000103'));
    PERFORM pg_temp.rpc('public.cambiar_estado_grupo_deportivo', 'x', pg_catalog.format('public.cambiar_estado_grupo_deportivo((SELECT id FROM public.grupos_deportivos WHERE nombre = %L), false)', 'Grupo EPT59 docente 14'));
    PERFORM pg_temp.rpc('public.cambiar_estado_horario_materia', 'x', pg_catalog.format('public.cambiar_estado_horario_materia(%L, false)', FR));
    PERFORM pg_temp.rpc('public.cambiar_estado_materia', 'x', pg_catalog.format('public.cambiar_estado_materia(%s, false)', MAT));
    PERFORM pg_temp.rpc('public.cambiar_estado_nivel', 'x', pg_catalog.format('public.cambiar_estado_nivel(%s, false)', NIV));
    PERFORM pg_temp.rpc('public.cambiar_estado_profesor', 'x', pg_catalog.format('public.cambiar_estado_profesor(%L, %L, NULL)', DOCA, 'INACTIVO'));
    PERFORM pg_temp.rpc('public.cambiar_profesor_asignacion', 'x', pg_catalog.format('public.cambiar_profesor_asignacion(%L, %L)', ASIG, DOCA));
    PERFORM pg_temp.rpc('public.cancelar_inscripcion_deportiva', 'x', pg_catalog.format('public.cancelar_inscripcion_deportiva(%L)', IDEP));
    PERFORM pg_temp.rpc('public.cancelar_inscripcion_servicio', 'x', pg_catalog.format('public.cancelar_inscripcion_servicio(%L)', ISERV));
    -- EPT-62: administración de inscripciones (solo Dirección habilitada completa).
    PERFORM pg_temp.rpc('public.cancelar_inscripcion_deportiva_administrativa', 'x', pg_catalog.format('public.cancelar_inscripcion_deportiva_administrativa(%L)', IDEP));
    PERFORM pg_temp.rpc('public.cancelar_inscripcion_servicio_administrativa', 'x', pg_catalog.format('public.cancelar_inscripcion_servicio_administrativa(%L, ''COMEDOR'')', ISERV));
    PERFORM pg_temp.rpc('public.confirmar_inscripcion_deportiva', 'x', pg_catalog.format('public.confirmar_inscripcion_deportiva(%L)', IDEP));
    PERFORM pg_temp.rpc('public.confirmar_inscripcion_servicio', 'x', pg_catalog.format('public.confirmar_inscripcion_servicio(%L, ''COMEDOR'')', ISERV));
    PERFORM pg_temp.rpc('public.confirmar_matricula', 'x', pg_catalog.format('public.confirmar_matricula((SELECT m.id FROM public.matriculas m WHERE m.alumno_id = %L AND m.fecha_cierre IS NULL))', EST));
    -- EPT-64: credencial digital QR. Solo Dirección habilitada opera y consulta; cada intento se revierte.
    PERFORM pg_temp.rpc('public.emitir_credencial_qr', 'x', pg_catalog.format('public.emitir_credencial_qr(%L, %L)', EST2, 'k1'));
    PERFORM pg_temp.rpc('public.reponer_credencial_qr', 'x', pg_catalog.format('public.reponer_credencial_qr(%L, %L, %L)', CRED, 'k1', 'Prueba de batería'));
    PERFORM pg_temp.rpc('public.revocar_credencial_qr', 'x', pg_catalog.format('public.revocar_credencial_qr(%L, %L)', CRED, 'Prueba de batería'));
    PERFORM pg_temp.rpc('public.historial_credenciales_qr', 'n', pg_catalog.format('public.historial_credenciales_qr(%L)', EST));
    PERFORM pg_temp.rpc('public.consultar_validez_credencial_qr', 'n', pg_catalog.format('public.consultar_validez_credencial_qr(%L)', CRED));
    -- EPT-65: registro de accesos con QR. Solo Dirección habilitada anula y consulta; la operación
    -- que REGISTRA (registrar_acceso_servicio) y el límite de intentos no la ejecuta ningún usuario
    -- autenticado y por eso no figuran en esta batería. Cada intento se revierte.
    PERFORM pg_temp.rpc('public.anular_acceso_servicio', 'x', pg_catalog.format('public.anular_acceso_servicio(%L, %L)', CRED, 'Prueba de batería'));
    PERFORM pg_temp.rpc('public.listar_accesos_servicios', 'n', 'public.listar_accesos_servicios(NULL, NULL, NULL, 10, 0)');
    PERFORM pg_temp.rpc('public.configurar_horario_materia', 'x', pg_catalog.format('public.configurar_horario_materia(%L, 2::smallint, %L, %L, NULL)', ASIG, '09:00', '10:00'));
    PERFORM pg_temp.rpc('public.consultar_compatibilidad_horaria', 'n', 'public.consultar_compatibilidad_horaria()');
    PERFORM pg_temp.rpc('public.consultar_compatibilidad_horaria_alumno', 'n', pg_catalog.format('public.consultar_compatibilidad_horaria_alumno(%L)', EST));
    PERFORM pg_temp.rpc('public.consultar_detalle_hijo', 'v', pg_catalog.format('public.consultar_detalle_hijo(%L)', EST));
    PERFORM pg_temp.rpc('public.consultar_ficha_profesor', 'n', pg_catalog.format('public.consultar_ficha_profesor(%L)', DOC));
    PERFORM pg_temp.rpc('public.corregir_identidad_alumno', 'x', pg_catalog.format('public.corregir_identidad_alumno(%L, %L, %L)', EST, '95900044', 'LEG-EPT59-EST2'));
    PERFORM pg_temp.rpc('public.crear_alumno', 'x', pg_catalog.format('public.crear_alumno(%L, %L, %L, %L, NULL, NULL, NULL, NULL, NULL)', 'Prueba', 'Alumno batería', '95900991', 'INACTIVO'));
    PERFORM pg_temp.rpc('public.crear_deporte', 'x', $e$public.crear_deporte('Deporte batería EPT61')$e$);
    PERFORM pg_temp.rpc('public.crear_grupo_deportivo', 'x', pg_catalog.format('public.crear_grupo_deportivo(%L, %s, %L, 5, %L)', f, (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'), 'Grupo batería EPT59', DOC));
    PERFORM pg_temp.rpc('public.crear_materia', 'x', $e$public.crear_materia('Materia batería EPT59')$e$);
    PERFORM pg_temp.rpc('public.crear_nivel', 'x', $e$public.crear_nivel('NIVEL BATERIA EPT59')$e$);
    PERFORM pg_temp.rpc('public.dar_de_baja_horario_grupo_deportivo', 'x', pg_catalog.format('public.dar_de_baja_horario_grupo_deportivo(%L, %L)', GR, GFR));
    PERFORM pg_temp.rpc('public.editar_grupo_deportivo', 'x', pg_catalog.format('public.editar_grupo_deportivo(%L, %L, 10, %L)', GR, 'Grupo EPT59 editado', DOC));
    PERFORM pg_temp.rpc('public.es_director_actual', 'v', 'public.es_director_actual()');
    PERFORM pg_temp.rpc('public.establecer_recorrido_transporte', 'x', pg_catalog.format('public.establecer_recorrido_transporte(%L)', t));
    PERFORM pg_temp.rpc('public.inactivar_alumno', 'x', pg_catalog.format('public.inactivar_alumno(%L)', EST));
    -- EPT-66: inscripciones legadas (alumno propio, hijo vinculado y Dirección; el resto recibe 42501).
    PERFORM pg_temp.rpc('public.inscribir_actividad_legada', 'x', pg_catalog.format('public.inscribir_actividad_legada(%L, %s)', EST, (SELECT id FROM public.actividades WHERE tipo = 'TALLER' AND activo ORDER BY id DESC LIMIT 1)));
    PERFORM pg_temp.rpc('public.dar_baja_inscripcion_legada', 'x', 'public.dar_baja_inscripcion_legada(''00000000-0000-4000-8000-000000000066'')');
    PERFORM pg_temp.rpc('public.listar_inscripciones_actividades_legadas', 'n', pg_catalog.format('public.listar_inscripciones_actividades_legadas(%L)', EST));
    PERFORM pg_temp.rpc('public.listar_inscriptos_actividad_legada', 'n', pg_catalog.format('public.listar_inscriptos_actividad_legada(%s)', (SELECT id FROM public.actividades WHERE tipo = 'TALLER' ORDER BY id DESC LIMIT 1)));
    PERFORM pg_temp.rpc('public.consultar_cupos_actividades_legadas', 'n', 'public.consultar_cupos_actividades_legadas()');
    PERFORM pg_temp.rpc('public.inscribir_alumno_en_grupo_deportivo', 'x', pg_catalog.format('public.inscribir_alumno_en_grupo_deportivo(%L, %L)', EST, GR));
    PERFORM pg_temp.rpc('public.inscribir_en_grupo_deportivo', 'x', pg_catalog.format('public.inscribir_en_grupo_deportivo(%L)', GR));
    PERFORM pg_temp.rpc('public.inscribir_en_servicio', 'x', pg_catalog.format('public.inscribir_en_servicio(%L)', s));
    PERFORM pg_temp.rpc('public.listar_asignaciones_profesor', 'n', pg_catalog.format('public.listar_asignaciones_profesor(%L)', DOC));
    PERFORM pg_temp.rpc('public.listar_estudiantes_para_gestion', 'n', 'public.listar_estudiantes_para_gestion()');
    PERFORM pg_temp.rpc('public.listar_grupos_deportivos', 'n', 'public.listar_grupos_deportivos()');
    PERFORM pg_temp.rpc('public.listar_historial_estados_profesor', 'n', pg_catalog.format('public.listar_historial_estados_profesor(%L)', DOCI));
    PERFORM pg_temp.rpc('public.listar_horarios_profesor', 'n', pg_catalog.format('public.listar_horarios_profesor(%L)', DOC));
    PERFORM pg_temp.rpc('public.listar_profesores', 'n', 'public.listar_profesores()');
    PERFORM pg_temp.rpc('public.matricular_hijo', 'x', pg_catalog.format('public.matricular_hijo(%L, %L)', EST2, C1));
    PERFORM pg_temp.rpc('public.reactivar_alumno', 'x', pg_catalog.format('public.reactivar_alumno(%L, %L)', EST2, C1));
    -- EPT-66 D: registro de asistencias por vínculo vigente (el docente de la batería dicta en el
    -- curso del estudiante, así que su alta es válida; un bloqueado recibe 42501; cada intento se revierte).
    PERFORM pg_temp.rpc('public.registrar_asistencia', 'x', pg_catalog.format('public.registrar_asistencia(%L, CURRENT_DATE - 2, %L)', EST, 'PRESENTE'));
    PERFORM pg_temp.rpc('public.renombrar_deporte', 'x', pg_catalog.format('public.renombrar_deporte(%L, %L)', 'e0000000-0000-4000-8000-000000000103', 'Atletismo batería EPT61'));
    PERFORM pg_temp.rpc('public.renombrar_materia', 'x', pg_catalog.format('public.renombrar_materia(%s, %L)', MAT, 'Materia EPT59 renombrada'));
    PERFORM pg_temp.rpc('public.renombrar_nivel', 'x', pg_catalog.format('public.renombrar_nivel(%s, %L)', NIV, 'NIVEL EPT59 RENOMBRADO'));
    PERFORM pg_temp.rpc('public.rol_actual', 'v', 'public.rol_actual()');
    PERFORM pg_temp.rpc('public.mi_estado_acceso', 'v', 'public.mi_estado_acceso()', 'v=BLOQUEADO');
    PERFORM pg_temp.rpc('public.cambiar_rol_perfil', 'x', pg_catalog.format('public.cambiar_rol_perfil(%L, %L, %L, %L)', PER2, 'PERSONAL', 'PADRE', 'Prueba de batería'));
    PERFORM pg_temp.rpc('public.cambiar_acceso_perfil', 'x', pg_catalog.format('public.cambiar_acceso_perfil(%L, %L, %L, %L)', PER2, 'HABILITADO', 'BLOQUEADO', 'Prueba de batería'));
    PERFORM pg_temp.rpc('public.estado_acceso_de', 'n', pg_catalog.format('public.estado_acceso_de(%L)', PER));
    PERFORM pg_temp.rpc('public.listar_usuarios', 'n', 'public.listar_usuarios(NULL, 100, 0)');
    PERFORM pg_temp.rpc('public.consultar_usuario', 'n', pg_catalog.format('public.consultar_usuario(%L)', PER));
    PERFORM pg_temp.rpc('public.listar_historial_usuario', 'n', pg_catalog.format('public.listar_historial_usuario(%L)', PER2));
    PERFORM pg_temp.rpc('public.reservar_vinculo_cuenta', 'x', pg_catalog.format('public.reservar_vinculo_cuenta(%L, %L, %L, %L, NULL, true)', OPB, PERB, '95900027', 'TITULAR'));
    PERFORM pg_temp.rpc('public.consultar_vinculo', 'n', pg_catalog.format('public.consultar_vinculo(%L)', OPF));
    PERFORM pg_temp.rpc('public.cancelar_vinculo', 'x', pg_catalog.format('public.cancelar_vinculo(%L)', OPF));
    PERFORM pg_temp.rpc('public.emitir_desafio_vinculo', 'x', pg_catalog.format('public.emitir_desafio_vinculo(%L, %L, %L)', OPF, pg_temp.u('01'), 'bateria.d5@ept59.invalid'));
    PERFORM pg_temp.rpc('public.anular_desafio_vinculo', 'x', pg_catalog.format('public.anular_desafio_vinculo(%L, %L)', OPF, pg_temp.u('01')));
    PERFORM pg_temp.rpc('public.verificar_desafio_vinculo', 'x', pg_catalog.format('public.verificar_desafio_vinculo(%L, %L, %L)', OPF, pg_temp.u('01'), '000000'));
    PERFORM pg_temp.rpc('public.datos_para_enlace', 'x', pg_catalog.format('public.datos_para_enlace(%L, %L)', OPF, pg_temp.u('01')));
    PERFORM pg_temp.rpc('app_private.es_director', 'v', 'app_private.es_director()');
    PERFORM pg_temp.rpc('app_private.rol_actual', 'v', 'app_private.rol_actual()');
    PERFORM pg_temp.rpc('app_private.perfil_actual', 'v', 'app_private.perfil_actual()');
    PERFORM pg_temp.rpc('app_private.mis_hijos_ids', 'n', 'app_private.mis_hijos_ids()');
    PERFORM pg_temp.rpc('app_private.nivel_actual', 'v', 'app_private.nivel_actual()');
    PERFORM pg_temp.rpc('app_private.acceso_bloqueado', 'v', 'app_private.acceso_bloqueado()', 'v=true');
    PERFORM pg_temp.rpc('app_private.mi_estado_acceso', 'v', 'app_private.mi_estado_acceso()', 'v=BLOQUEADO');
END $$;

-- La lista cubre TODOS los envoltorios públicos ejecutables por authenticated.
DO $$
DECLARE v_faltan TEXT;
BEGIN
    SELECT pg_catalog.string_agg(DISTINCT p.proname, ', ') INTO v_faltan
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
      AND p.prorettype <> 'trigger'::regtype
      AND pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT EXISTS (SELECT 1 FROM rpcs r WHERE r.nombre = 'public.' || p.proname);
    PERFORM pg_temp.exigir(v_faltan IS NULL, '06 RPC sin cubrir en la batería: ' || COALESCE(v_faltan, ''));
    PERFORM pg_temp.ok('06: la batería cubre los ' || (SELECT pg_catalog.count(*) FROM rpcs WHERE nombre LIKE 'public.%')
                       || ' envoltorios públicos ejecutables por authenticated y 7 auxiliares de app_private');
END $$;

CREATE FUNCTION pg_temp.bateria(p_fase TEXT, p_actor TEXT, p_rol TEXT, p_sub UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
    r   RECORD;
    q   RECORD;
    v_col TEXT;
    v_ins TEXT;
BEGIN
    FOR r IN
        SELECT c.oid, c.relname
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v')
        ORDER BY c.relname
    LOOP
        INSERT INTO resultados VALUES (p_fase, p_actor, r.relname, 'SELECT', pg_temp.intentar(p_rol, p_sub,
            pg_catalog.format('SELECT ''n='' || pg_catalog.count(*) FROM public.%I', r.relname)));

        SELECT a.attname INTO v_col
        FROM pg_attribute a
        WHERE a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped
          AND a.attgenerated = '' AND a.attidentity = ''
        ORDER BY pg_catalog.has_column_privilege(p_rol, r.oid, a.attnum, 'UPDATE') DESC, a.attnum
        LIMIT 1;

        INSERT INTO resultados VALUES (p_fase, p_actor, r.relname, 'UPDATE', pg_temp.intentar(p_rol, p_sub,
            pg_catalog.format('WITH x AS (UPDATE public.%I SET %I = %I RETURNING 1) SELECT ''n='' || pg_catalog.count(*) FROM x',
                              r.relname, v_col, v_col)));

        INSERT INTO resultados VALUES (p_fase, p_actor, r.relname, 'DELETE', pg_temp.intentar(p_rol, p_sub,
            pg_catalog.format('WITH x AS (DELETE FROM public.%I RETURNING 1) SELECT ''n='' || pg_catalog.count(*) FROM x',
                              r.relname)));

        v_ins := COALESCE((SELECT i.sql FROM inserciones i WHERE i.tabla = r.relname),
                          pg_catalog.format('INSERT INTO public.%I DEFAULT VALUES', r.relname));
        INSERT INTO resultados VALUES (p_fase, p_actor, r.relname, 'INSERT', pg_temp.intentar(p_rol, p_sub,
            pg_catalog.format('WITH x AS (%s RETURNING 1) SELECT ''n='' || pg_catalog.count(*) FROM x', v_ins)));
    END LOOP;

    FOR q IN SELECT nombre, sql FROM rpcs ORDER BY nombre LOOP
        INSERT INTO resultados VALUES (p_fase, p_actor, q.nombre, 'RPC', pg_temp.intentar(p_rol, p_sub, q.sql));
    END LOOP;
END;
$$;

CREATE FUNCTION pg_temp.res(p_fase TEXT, p_actor TEXT, p_objeto TEXT, p_op TEXT)
RETURNS TEXT LANGUAGE sql STABLE AS $$
    SELECT res FROM resultados WHERE fase = p_fase AND actor = p_actor AND objeto = p_objeto AND op = p_op;
$$;

-- Bloqueo y reactivación por la segunda Dirección, con el RPC real.
CREATE FUNCTION pg_temp.cambiar_acceso(p_perfil UUID, p_esperado TEXT, p_nuevo TEXT)
RETURNS TEXT LANGUAGE sql AS $$
    SELECT pg_temp.ejecutar('authenticated', pg_temp.u('02'), pg_catalog.format(
        'SELECT estado_acceso::TEXT FROM public.cambiar_acceso_perfil(%L, %L, %L, %L)',
        p_perfil, p_esperado, p_nuevo, 'Prueba de bloqueo EPT-59'));
$$;

DO $$
DECLARE
    r RECORD;
    v TEXT;
    v_publicas TEXT[] := ARRAY['actividades', 'galeria', 'menu_escolar', 'noticias', 'opiniones'];
    v_malos TEXT;
BEGIN
    PERFORM pg_temp.bateria('base', 'anon', 'anon', NULL);
    PERFORM pg_temp.bateria('base', 'sin_perfil', 'authenticated', pg_temp.u('07'));

    FOR r IN SELECT * FROM (VALUES
        ('DIRECTOR', pg_temp.u('01')), ('DOCENTE', pg_temp.u('03')), ('ESTUDIANTE', pg_temp.u('04')),
        ('PADRE', pg_temp.u('05')), ('PERSONAL', pg_temp.u('06'))) AS t(actor, sub)
    LOOP
        PERFORM pg_temp.bateria('habilitado', r.actor, 'authenticated', r.sub);

        -- El JWT del actor sigue siendo el mismo: se bloquea su perfil y se
        -- vuelve a usar exactamente la misma sesión.
        v := pg_temp.cambiar_acceso(r.sub, 'HABILITADO', 'BLOQUEADO');
        PERFORM pg_temp.esperar(v, 'OK:BLOQUEADO', 'bloquear ' || r.actor);
        PERFORM pg_temp.bateria('bloqueado', r.actor, 'authenticated', r.sub);

        v := pg_temp.cambiar_acceso(r.sub, 'BLOQUEADO', 'HABILITADO');
        PERFORM pg_temp.esperar(v, 'OK:HABILITADO', 'reactivar ' || r.actor);
        PERFORM pg_temp.bateria('reactivado', r.actor, 'authenticated', r.sub);
    END LOOP;

    -- Ninguna evaluación terminó en recursión de políticas.
    SELECT pg_catalog.string_agg(fase || '/' || actor || '/' || objeto || '/' || op, ', ') INTO v_malos
    FROM resultados WHERE res = 'E:42P17';
    PERFORM pg_temp.exigir(v_malos IS NULL, '07 recursión 42P17 en: ' || COALESCE(v_malos, ''));
    PERFORM pg_temp.ok('07: ' || (SELECT pg_catalog.count(*) FROM resultados)
                       || ' evaluaciones (17 baterías: anon, sin perfil y 5 roles habilitado/bloqueado/reactivado) sin 42P17');

    -- 3.1 Superficies públicas: el bloqueado ve exactamente lo que ve anon.
    SELECT pg_catalog.string_agg(b.actor || '/' || b.objeto || ' ' || b.res || '≠' || a.res, ', ') INTO v_malos
    FROM resultados b
    JOIN resultados a ON a.fase = 'base' AND a.actor = 'anon' AND a.objeto = b.objeto AND a.op = b.op
    WHERE b.fase = 'bloqueado' AND b.op = 'SELECT' AND b.objeto = ANY (v_publicas)
      AND b.res IS DISTINCT FROM a.res;
    PERFORM pg_temp.exigir(v_malos IS NULL, '08 lectura pública distinta de anon: ' || COALESCE(v_malos, ''));
    PERFORM pg_temp.exigir(pg_temp.res('base', 'anon', 'opiniones', 'SELECT') = 'n='
                           || (SELECT pg_catalog.count(*) FROM public.opiniones WHERE aprobado),
        '08 anon debería ver solo opiniones aprobadas');
    PERFORM pg_temp.exigir(pg_temp.res('habilitado', 'DIRECTOR', 'opiniones', 'SELECT') = 'n='
                           || (SELECT pg_catalog.count(*) FROM public.opiniones),
        '08 la Dirección habilitada debería ver todas las opiniones');
    PERFORM pg_temp.ok('08: bloqueados de los 5 roles leen actividades, galería, menú, noticias y opiniones aprobadas igual que anon');

    -- Opinión pendiente: el bloqueado puede dejarla igual que anon.
    SELECT pg_catalog.string_agg(b.actor || ' ' || b.res, ', ') INTO v_malos
    FROM resultados b
    WHERE b.fase = 'bloqueado' AND b.objeto = 'opiniones' AND b.op = 'INSERT'
      AND b.res IS DISTINCT FROM pg_temp.res('base', 'anon', 'opiniones', 'INSERT');
    PERFORM pg_temp.exigir(v_malos IS NULL AND pg_temp.res('base', 'anon', 'opiniones', 'INSERT') = 'n=1',
        '09 opinión pendiente de bloqueado distinta de anon: ' || COALESCE(v_malos, pg_temp.res('base', 'anon', 'opiniones', 'INSERT')));
    PERFORM pg_temp.ok('09: un bloqueado deja una opinión pendiente igual que anon');

    -- Formularios públicos: el bloqueo no cambia el resultado del INSERT de
    -- authenticated (sin privilegio desde 002/011, igual habilitado que bloqueado).
    SELECT pg_catalog.string_agg(b.actor || '/' || b.objeto || ' ' || b.res || '≠' || h.res, ', ') INTO v_malos
    FROM resultados b
    JOIN resultados h ON h.fase = 'habilitado' AND h.actor = b.actor AND h.objeto = b.objeto AND h.op = 'INSERT'
    WHERE b.fase = 'bloqueado' AND b.op = 'INSERT'
      AND b.objeto IN ('postulaciones', 'solicitudes_inscripcion')
      AND b.res IS DISTINCT FROM h.res;
    PERFORM pg_temp.exigir(v_malos IS NULL, '10 formularios públicos distintos para bloqueado: ' || COALESCE(v_malos, ''));
    PERFORM pg_temp.exigir(pg_temp.res('base', 'anon', 'postulaciones', 'INSERT') = 'n=1'
                           AND pg_temp.res('base', 'anon', 'solicitudes_inscripcion', 'INSERT') = 'n=1',
        '10 anon debería poder enviar los formularios públicos');
    PERFORM pg_temp.ok('10: postulaciones y solicitudes: anon envía; authenticated obtiene lo mismo bloqueado que habilitado');

    -- 3.2 Resto de relaciones: cero filas protegidas y ninguna escritura.
    SELECT pg_catalog.string_agg(b.actor || '/' || b.objeto || '/' || b.op || ' ' || b.res, ', ') INTO v_malos
    FROM resultados b
    WHERE b.fase = 'bloqueado' AND b.op <> 'RPC'
      AND NOT (b.op = 'SELECT' AND b.objeto = ANY (v_publicas))
      AND NOT (b.op = 'INSERT' AND b.objeto IN ('opiniones', 'postulaciones', 'solicitudes_inscripcion'))
      AND NOT (b.objeto = 'materias' AND b.op = 'SELECT')
      AND NOT (b.res = 'n=0' OR (b.op <> 'SELECT' AND b.res LIKE 'E:%') OR b.res = 'E:42501');
    PERFORM pg_temp.exigir(v_malos IS NULL, '11 un bloqueado ve o modifica filas protegidas: ' || COALESCE(v_malos, ''));

    -- `materias` es una vista sobre `actividades` (superficie pública): un
    -- bloqueado ve las mismas materias que anon ve en `actividades`.
    SELECT pg_catalog.string_agg(b.actor || ' ' || b.res, ', ') INTO v_malos
    FROM resultados b
    WHERE b.fase = 'bloqueado' AND b.objeto = 'materias' AND b.op = 'SELECT'
      AND b.res IS DISTINCT FROM pg_temp.intentar('anon', NULL,
          $q$SELECT 'n=' || pg_catalog.count(*) FROM public.actividades WHERE tipo = 'CURRICULAR'$q$);
    PERFORM pg_temp.exigir(v_malos IS NULL, '11 vista materias para bloqueado: ' || COALESCE(v_malos, ''));

    -- Toda escritura que el mismo actor lograba habilitado, bloqueado se
    -- rechaza por RLS (42501), no por otra regla.
    SELECT pg_catalog.string_agg(b.actor || '/' || b.objeto || '/' || b.op || ' ' || h.res || '→' || b.res, ', ') INTO v_malos
    FROM resultados b
    JOIN resultados h ON h.fase = 'habilitado' AND h.actor = b.actor AND h.objeto = b.objeto AND h.op = b.op
    WHERE b.fase = 'bloqueado' AND b.op IN ('INSERT', 'UPDATE', 'DELETE')
      AND b.objeto NOT IN ('opiniones', 'postulaciones', 'solicitudes_inscripcion')
      AND h.res LIKE 'n=%' AND h.res <> 'n=0'
      AND NOT (b.res = 'E:42501' OR b.res = 'n=0');
    PERFORM pg_temp.exigir(v_malos IS NULL, '11 escritura habilitada no rechazada al bloquear: ' || COALESCE(v_malos, ''));
    PERFORM pg_temp.ok('11: bloqueados ven 0 filas protegidas en ' ||
        (SELECT pg_catalog.count(DISTINCT objeto) FROM resultados WHERE fase = 'bloqueado' AND op = 'SELECT')
        || ' relaciones y toda escritura que lograban habilitados queda rechazada');

    -- La Dirección habilitada efectivamente escribía (la prueba anterior no es vacía).
    PERFORM pg_temp.exigir(pg_temp.res('habilitado', 'DIRECTOR', 'cursos', 'INSERT') = 'n=1'
                           AND pg_temp.res('habilitado', 'DIRECTOR', 'perfiles', 'INSERT') = 'n=1'
                           AND pg_temp.res('habilitado', 'DIRECTOR', 'padres_hijos', 'INSERT') = 'n=1'
                           AND pg_temp.res('habilitado', 'DOCENTE', 'asistencias', 'INSERT') = 'n=1'
                           -- EPT-66: con la contracción aplicada el alumno ya no inserta directo (42501)
                           -- y su alta pasa por la función legada; con la expansión sola sigue siendo n=1.
                           AND pg_temp.res('habilitado', 'ESTUDIANTE', 'inscripciones', 'INSERT') =
                               CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_policies
                                                 WHERE schemaname = 'public' AND tablename = 'inscripciones'
                                                   AND policyname = 'Dirección consulta las inscripciones')
                                    THEN 'E:42501' ELSE 'n=1' END
                           AND pg_temp.res('bloqueado', 'DIRECTOR', 'cursos', 'INSERT') = 'E:42501'
                           AND pg_temp.res('bloqueado', 'DIRECTOR', 'perfiles', 'INSERT') = 'E:42501'
                           AND pg_temp.res('bloqueado', 'DOCENTE', 'asistencias', 'INSERT') = 'E:42501'
                           AND pg_temp.res('bloqueado', 'ESTUDIANTE', 'inscripciones', 'INSERT') = 'E:42501',
        '12 las altas de referencia no se comportan como se espera');
    PERFORM pg_temp.exigir(pg_temp.res('habilitado', 'ESTUDIANTE', 'perfiles', 'SELECT') = 'n=1'
                           AND pg_temp.res('bloqueado', 'ESTUDIANTE', 'perfiles', 'SELECT') = 'n=0'
                           AND pg_temp.res('habilitado', 'PADRE', 'perfiles', 'SELECT') = 'n=2'
                           AND pg_temp.res('bloqueado', 'PADRE', 'perfiles', 'SELECT') = 'n=0',
        '12 «Perfil propio» sigue abierto para un bloqueado');
    PERFORM pg_temp.ok('12: Dirección, docente y estudiante escriben habilitados y reciben 42501 bloqueados; ni el perfil propio queda visible');

    -- 3.3 RPC: un bloqueado recibe error o nada protegido.
    SELECT pg_catalog.string_agg(b.actor || '/' || b.objeto || ' ' || b.res, ', ') INTO v_malos
    FROM resultados b
    JOIN rpcs q ON q.nombre = b.objeto
    WHERE b.fase = 'bloqueado' AND b.op = 'RPC'
      AND NOT CASE
          WHEN q.bloqueado IS NOT NULL THEN b.res = q.bloqueado
          ELSE b.res LIKE 'E:%' OR b.res IN ('v=<NULL>', 'v=false', 'n=0', 'v=0')
      END;
    PERFORM pg_temp.exigir(v_malos IS NULL, '13 RPC con datos para un bloqueado: ' || COALESCE(v_malos, ''));

    -- Las operaciones que el actor completaba habilitado ahora fallan.
    SELECT pg_catalog.string_agg(b.actor || '/' || b.objeto, ', ') INTO v_malos
    FROM resultados b
    JOIN resultados h ON h.fase = 'habilitado' AND h.actor = b.actor AND h.objeto = b.objeto AND h.op = 'RPC'
    WHERE b.fase = 'bloqueado' AND b.op = 'RPC' AND h.res = 'ok' AND b.res NOT LIKE 'E:%';
    PERFORM pg_temp.exigir(v_malos IS NULL, '13 operación completada por un bloqueado: ' || COALESCE(v_malos, ''));
    PERFORM pg_temp.exigir((SELECT pg_catalog.count(*) FROM resultados
                            WHERE fase = 'habilitado' AND actor = 'DIRECTOR' AND op = 'RPC' AND res = 'ok') >= 20,
        '13 la Dirección habilitada debería completar la mayoría de las operaciones');
    PERFORM pg_temp.ok('13: ' || (SELECT pg_catalog.count(*) FROM rpcs) || ' RPC por rol: bloqueado recibe error o nada; '
        || (SELECT pg_catalog.count(*) FROM resultados WHERE fase = 'habilitado' AND actor = 'DIRECTOR' AND op = 'RPC' AND res = 'ok')
        || ' operaciones de Dirección completadas habilitada quedan rechazadas bloqueada');

    -- Las cuatro del desafío D5 nunca son ejecutables con un JWT de usuario.
    SELECT pg_catalog.string_agg(b.fase || '/' || b.actor || '/' || b.objeto || ' ' || b.res, ', ') INTO v_malos
    FROM resultados b
    WHERE b.op = 'RPC'
      AND b.objeto IN ('public.emitir_desafio_vinculo', 'public.anular_desafio_vinculo',
                       'public.verificar_desafio_vinculo', 'public.datos_para_enlace')
      AND b.res <> 'E:42501';
    PERFORM pg_temp.exigir(v_malos IS NULL, '14 desafío D5 accesible sin service_role: ' || COALESCE(v_malos, ''));
    PERFORM pg_temp.ok('14: emitir/anular/verificar/datos_para_enlace devuelven 42501 a anon y a todo authenticated, incluida la Dirección');

    -- 3.4 Reactivar devuelve exactamente el comportamiento habilitado.
    SELECT pg_catalog.string_agg(h.actor || '/' || h.objeto || '/' || h.op || ' ' || h.res || '→' || a.res, ', ') INTO v_malos
    FROM resultados h
    JOIN resultados a ON a.fase = 'reactivado' AND a.actor = h.actor AND a.objeto = h.objeto AND a.op = h.op
    WHERE h.fase = 'habilitado'
      AND h.objeto <> 'perfiles_historial'
      AND h.res IS DISTINCT FROM a.res;
    PERFORM pg_temp.exigir(v_malos IS NULL, '15 la reactivación no restituye: ' || COALESCE(v_malos, ''));
    PERFORM pg_temp.ok('15: al reactivar, los 5 roles recuperan exactamente sus resultados habilitados (salvo el historial, que crece)');

    -- 3.5 Auxiliares de identidad por actor.
    PERFORM pg_temp.exigir(
        pg_temp.res('habilitado', 'DIRECTOR', 'public.rol_actual', 'RPC') = 'v=DIRECTOR'
        AND pg_temp.res('bloqueado', 'DIRECTOR', 'public.rol_actual', 'RPC') = 'v=<NULL>'
        AND pg_temp.res('habilitado', 'DIRECTOR', 'public.es_director_actual', 'RPC') = 'v=true'
        AND pg_temp.res('bloqueado', 'DIRECTOR', 'public.es_director_actual', 'RPC') = 'v=false'
        AND pg_temp.res('habilitado', 'PADRE', 'app_private.mis_hijos_ids', 'RPC') = 'n=1'
        AND pg_temp.res('bloqueado', 'PADRE', 'app_private.mis_hijos_ids', 'RPC') = 'n=0'
        AND pg_temp.res('habilitado', 'ESTUDIANTE', 'app_private.perfil_actual', 'RPC') = 'v=' || pg_temp.u('04')
        AND pg_temp.res('bloqueado', 'ESTUDIANTE', 'app_private.perfil_actual', 'RPC') = 'v=<NULL>'
        AND pg_temp.res('habilitado', 'ESTUDIANTE', 'app_private.nivel_actual', 'RPC') <> 'v=<NULL>'
        AND pg_temp.res('bloqueado', 'ESTUDIANTE', 'app_private.nivel_actual', 'RPC') = 'v=<NULL>'
        AND pg_temp.res('habilitado', 'PADRE', 'public.consultar_detalle_hijo', 'RPC') LIKE 'v={%'
        AND pg_temp.res('bloqueado', 'PADRE', 'public.consultar_detalle_hijo', 'RPC') LIKE 'E:%',
        '16 auxiliares de identidad fuera de contrato');
    PERFORM pg_temp.ok('16: rol_actual, es_director_actual, perfil_actual, nivel_actual y mis_hijos_ids ignoran al bloqueado');

    -- 3.6 mi_estado_acceso por actor.
    PERFORM pg_temp.exigir(pg_temp.res('base', 'anon', 'public.mi_estado_acceso', 'RPC') = 'E:42501', '17 anon ejecuta mi_estado_acceso');
    PERFORM pg_temp.exigir(pg_temp.intentar('authenticated', NULL, 'SELECT public.mi_estado_acceso()') = 'SIN_SESION', '17 sin sub');
    PERFORM pg_temp.exigir(pg_temp.res('base', 'sin_perfil', 'public.mi_estado_acceso', 'RPC') = 'v=SIN_PERFIL', '17 sin perfil');
    PERFORM pg_temp.exigir((SELECT pg_catalog.count(*) FROM resultados
                            WHERE objeto = 'public.mi_estado_acceso' AND fase = 'habilitado' AND res = 'v=HABILITADO') = 5
                           AND (SELECT pg_catalog.count(*) FROM resultados
                                WHERE objeto = 'public.mi_estado_acceso' AND fase = 'bloqueado' AND res = 'v=BLOQUEADO') = 5,
        '17 mi_estado_acceso por rol');
    PERFORM pg_temp.ok('17: mi_estado_acceso: anon 42501, SIN_SESION, SIN_PERFIL, HABILITADO ×5 y BLOQUEADO ×5');
END $$;

-- Formularios con privilegio concedido: la política restrictiva no agrega
-- ninguna condición al INSERT de postulaciones ni de solicitudes. El GRANT
-- vive en una subtransacción que se revierte.
DO $$
DECLARE
    v_post TEXT;
    v_soli TEXT;
    v TEXT;
BEGIN
    v := pg_temp.cambiar_acceso(pg_temp.u('06'), 'HABILITADO', 'BLOQUEADO');
    PERFORM pg_temp.esperar(v, 'OK:BLOQUEADO', '18 bloquear PERSONAL');
    BEGIN
        GRANT INSERT ON public.postulaciones, public.solicitudes_inscripcion TO authenticated;
        v_post := pg_temp.intentar('authenticated', pg_temp.u('06'),
            (SELECT 'WITH x AS (' || sql || ' RETURNING 1) SELECT ''n='' || pg_catalog.count(*) FROM x' FROM inserciones WHERE tabla = 'postulaciones'));
        v_soli := pg_temp.intentar('authenticated', pg_temp.u('06'),
            (SELECT 'WITH x AS (' || sql || ' RETURNING 1) SELECT ''n='' || pg_catalog.count(*) FROM x' FROM inserciones WHERE tabla = 'solicitudes_inscripcion'));
        RAISE EXCEPTION USING ERRCODE = 'P5999';
    EXCEPTION WHEN SQLSTATE 'P5999' THEN NULL;
    END;
    PERFORM pg_temp.exigir(v_post = 'n=1' AND v_soli = 'n=1',
        pg_catalog.format('18 formulario público con privilegio: %s / %s', v_post, v_soli));
    PERFORM pg_temp.exigir(NOT pg_catalog.has_table_privilege('authenticated', 'public.postulaciones', 'INSERT'),
        '18 el GRANT temporal no se revirtió');
    v := pg_temp.cambiar_acceso(pg_temp.u('06'), 'BLOQUEADO', 'HABILITADO');
    PERFORM pg_temp.esperar(v, 'OK:HABILITADO', '18 reactivar PERSONAL');
    PERFORM pg_temp.ok('18: con privilegio de INSERT, un bloqueado envía postulaciones y solicitudes como anon (sin restricción adicional)');
END $$;


-- ================================================================
-- 4. TRANSICIONES DE ROL Y DE ACCESO
-- ================================================================
CREATE FUNCTION pg_temp.rol(p_actor UUID, p_perfil UUID, p_esperado TEXT, p_nuevo TEXT,
                            p_motivo TEXT DEFAULT 'Cambio de rol de prueba')
RETURNS TEXT LANGUAGE sql AS $$
    SELECT pg_temp.ejecutar('authenticated', p_actor, pg_catalog.format(
        'SELECT rol || ''|'' || historial_id FROM public.cambiar_rol_perfil(%L, %L, %L, %L)',
        p_perfil, p_esperado, p_nuevo, p_motivo));
$$;

CREATE FUNCTION pg_temp.rol_de(p_perfil UUID)
RETURNS TEXT LANGUAGE sql STABLE AS $$
    SELECT r.nombre FROM public.perfiles p LEFT JOIN public.roles r ON r.id = p.rol_id WHERE p.id = p_perfil;
$$;

CREATE FUNCTION pg_temp.historial(p_perfil UUID)
RETURNS BIGINT LANGUAGE sql STABLE AS $$
    SELECT pg_catalog.count(*) FROM public.perfiles_historial WHERE perfil_id = p_perfil;
$$;

DO $$
DECLARE
    D1 CONSTANT UUID := pg_temp.u('01');
    v TEXT;
    v_h public.perfiles_historial%ROWTYPE;
    v_ficha_antes TEXT;
    v_ficha_despues TEXT;
BEGIN
    -- 4.1 Identidad y autorización.
    PERFORM pg_temp.esperar(pg_temp.ejecutar('anon', NULL, $q$SELECT (public.cambiar_rol_perfil(NULL, NULL, 'PERSONAL', 'Motivo válido')).rol$q$),
        'E:42501', '20 anon');
    PERFORM pg_temp.esperar(pg_temp.ejecutar('authenticated', NULL, pg_catalog.format(
        'SELECT (public.cambiar_rol_perfil(%L, %L, %L, %L)).rol', pg_temp.u('16'), 'PERSONAL', 'PADRE', 'Motivo válido')),
        'E:P5505', '20 sin identidad');
    PERFORM pg_temp.esperar(pg_temp.rol(pg_temp.u('03'), pg_temp.u('16'), 'PERSONAL', 'PADRE'), 'E:42501', '20 DOCENTE');
    PERFORM pg_temp.esperar(pg_temp.rol(pg_temp.u('07'), pg_temp.u('16'), 'PERSONAL', 'PADRE'), 'E:42501', '20 sin perfil');
    PERFORM pg_temp.ok('20: cambiar_rol_perfil: anon 42501, sin identidad P5505, DOCENTE y sin perfil 42501');

    -- 4.2 Validación de entrada.
    PERFORM pg_temp.esperar(pg_temp.rol(D1, pg_temp.u('16'), 'PERSONAL', 'PADRE', 'Abcd'), 'E:P5901', '21 motivo de 4');
    PERFORM pg_temp.esperar(pg_temp.rol(D1, pg_temp.u('16'), 'PERSONAL', 'PADRE', pg_catalog.repeat('x', 501)), 'E:P5901', '21 motivo de 501');
    PERFORM pg_temp.esperar(pg_temp.rol(D1, pg_temp.u('16'), 'PERSONAL', 'PADRE', '   '), 'E:P5901', '21 motivo vacío');
    PERFORM pg_temp.esperar(pg_temp.rol(D1, pg_temp.u('16'), 'PERSONAL', NULL), 'E:P5902', '21 rol nuevo NULL');
    PERFORM pg_temp.esperar(pg_temp.rol(D1, pg_temp.u('16'), 'PERSONAL', 'SUPERADMIN'), 'E:P5902', '21 rol inexistente');
    PERFORM pg_temp.esperar(pg_temp.rol(D1, pg_temp.u('ff'), 'PERSONAL', 'PADRE'), 'E:P5904', '21 perfil inexistente');
    PERFORM pg_temp.esperar(pg_temp.rol(D1, D1, 'DIRECTOR', 'PERSONAL'), 'E:P5903', '21 cambio propio');
    PERFORM pg_temp.esperar(pg_temp.rol(D1, pg_temp.u('16'), 'PERSONAL', 'PERSONAL'), 'E:P5906', '21 mismo rol');
    PERFORM pg_temp.exigir(pg_temp.historial(pg_temp.u('16')) = 0, '21 un rechazo escribió historial');
    PERFORM pg_temp.ok('21: motivo 4/501/vacío P5901, rol NULL/inexistente P5902, inexistente P5904, propio P5903, mismo rol P5906, sin historial');

    -- 4.3 Valor esperado obsoleto: P5909 y ningún cambio.
    PERFORM pg_temp.esperar(pg_temp.rol(D1, pg_temp.u('16'), 'PADRE', 'DOCENTE'), 'E:P5909', '22 esperado obsoleto');
    PERFORM pg_temp.exigir(pg_temp.rol_de(pg_temp.u('16')) = 'PERSONAL' AND pg_temp.historial(pg_temp.u('16')) = 0
                           AND NOT EXISTS (SELECT 1 FROM public.profesores WHERE perfil_id = pg_temp.u('16')),
        '22 el rechazo P5909 cambió algo');
    PERFORM pg_temp.esperar(pg_temp.rol(D1, pg_temp.u('1a'), NULL, 'PERSONAL'), 'OK', '22 desde rol NULL con esperado NULL');
    PERFORM pg_temp.ok('22: esperado obsoleto P5909 sin cambios; un perfil sin rol se corrige con esperado NULL');

    -- 4.4 ESTUDIANTE en ambos sentidos.
    PERFORM pg_temp.esperar(pg_temp.rol(D1, pg_temp.u('18'), 'ESTUDIANTE', 'PERSONAL'), 'E:P5907', '23 ESTUDIANTE→PERSONAL');
    PERFORM pg_temp.esperar(pg_temp.rol(D1, pg_temp.u('19'), 'PERSONAL', 'ESTUDIANTE'), 'E:P5907', '23 PERSONAL→ESTUDIANTE');
    PERFORM pg_temp.ok('23: ESTUDIANTE no entra ni sale por cambio de rol (P5907)');

    -- 4.5 PADRE con y sin hijos, en ambos sentidos.
    PERFORM pg_temp.esperar(pg_temp.rol(D1, pg_temp.u('11'), 'PADRE', 'PERSONAL'), 'E:P5910', '24 PADRE con hijo');
    PERFORM pg_temp.esperar(pg_temp.rol(D1, pg_temp.u('10'), 'PADRE', 'PERSONAL'), 'OK', '24 PADRE sin hijos');
    PERFORM pg_temp.esperar(pg_temp.rol(D1, pg_temp.u('19'), 'PERSONAL', 'PADRE'), 'OK', '24 PERSONAL→PADRE');
    PERFORM pg_temp.esperar(pg_temp.rol(D1, pg_temp.u('19'), 'PADRE', 'PERSONAL'), 'OK', '24 PADRE→PERSONAL sin hijos');
    PERFORM pg_temp.exigir(pg_temp.rol_de(pg_temp.u('11')) = 'PADRE'
                           AND EXISTS (SELECT 1 FROM public.padres_hijos WHERE padre_id = pg_temp.u('11')),
        '24 el PADRE con hijos cambió');
    PERFORM pg_temp.ok('24: PADRE con hijos P5910; sin hijos sale; PERSONAL↔PADRE en ambos sentidos');

    -- 4.6 Salida de DOCENTE.
    PERFORM pg_temp.esperar(pg_temp.rol(D1, pg_temp.u('12'), 'DOCENTE', 'PERSONAL'), 'E:P5911', '25 ficha ACTIVO');
    PERFORM pg_temp.esperar(pg_temp.rol(D1, pg_temp.u('13'), 'DOCENTE', 'PERSONAL'), 'E:P5911', '25 materia activa');
    PERFORM pg_temp.esperar(pg_temp.rol(D1, pg_temp.u('14'), 'DOCENTE', 'PERSONAL'), 'E:P5911', '25 grupo activo');
    PERFORM pg_temp.esperar(pg_temp.rol(D1, pg_temp.u('21'), 'DOCENTE', 'PERSONAL'), 'E:P5911', '25 sin ficha');
    SELECT pg_catalog.concat_ws('|', perfil_id, especialidad, estado, fecha_alta, fecha_actualizacion) INTO v_ficha_antes
    FROM public.profesores WHERE perfil_id = pg_temp.u('15');
    PERFORM pg_temp.esperar(pg_temp.rol(D1, pg_temp.u('15'), 'DOCENTE', 'PERSONAL'), 'OK', '25 INACTIVO sin asignaciones');
    SELECT pg_catalog.concat_ws('|', perfil_id, especialidad, estado, fecha_alta, fecha_actualizacion) INTO v_ficha_despues
    FROM public.profesores WHERE perfil_id = pg_temp.u('15');
    PERFORM pg_temp.exigir(v_ficha_antes = v_ficha_despues, '25 la ficha del ex docente cambió');
    PERFORM pg_temp.ok('25: DOCENTE con ficha ACTIVO, materia activa, grupo activo o sin ficha P5911; INACTIVO sin asignaciones sale y conserva la ficha');

    -- 4.7 Entrada a DOCENTE.
    PERFORM pg_temp.esperar(pg_temp.rol(D1, pg_temp.u('16'), 'PERSONAL', 'DOCENTE'), 'OK', '26 PERSONAL→DOCENTE');
    PERFORM pg_temp.exigir((SELECT pg_catalog.count(*) FROM public.profesores
                            WHERE perfil_id = pg_temp.u('16') AND estado = 'ACTIVO' AND especialidad IS NULL) = 1,
        '26 no se creó exactamente una ficha ACTIVO');
    SELECT pg_catalog.concat_ws('|', perfil_id, especialidad, estado, fecha_alta, fecha_actualizacion) INTO v_ficha_antes
    FROM public.profesores WHERE perfil_id = pg_temp.u('17');
    PERFORM pg_temp.esperar(pg_temp.rol(D1, pg_temp.u('17'), 'PERSONAL', 'DOCENTE'), 'OK', '26 ex docente vuelve');
    SELECT pg_catalog.concat_ws('|', perfil_id, especialidad, estado, fecha_alta, fecha_actualizacion) INTO v_ficha_despues
    FROM public.profesores WHERE perfil_id = pg_temp.u('17');
    PERFORM pg_temp.exigir(v_ficha_antes = v_ficha_despues AND v_ficha_despues LIKE '%|INACTIVO|%',
        '26 la ficha INACTIVO existente cambió');
    PERFORM pg_temp.ok('26: entrar a DOCENTE crea exactamente una ficha ACTIVO; una ficha INACTIVO previa queda intacta');

    -- 4.8 Contenido del historial.
    SELECT * INTO v_h FROM public.perfiles_historial
    WHERE perfil_id = pg_temp.u('10') ORDER BY id DESC LIMIT 1;
    PERFORM pg_temp.exigir(v_h.tipo = 'ROL' AND v_h.valor_anterior = 'PADRE' AND v_h.valor_nuevo = 'PERSONAL'
                           AND v_h.motivo = 'Cambio de rol de prueba' AND v_h.actor_perfil_id = D1
                           AND v_h.fecha = now() AND v_h.operacion_id IS NULL,
        '27 historial de rol con contenido inesperado');
    PERFORM pg_temp.esperar(pg_temp.rol(D1, pg_temp.u('1e'), 'PERSONAL', 'PADRE', E'  Motivo \t con   espacios  '), 'OK', '27 motivo normalizado');
    PERFORM pg_temp.exigir((SELECT motivo FROM public.perfiles_historial WHERE perfil_id = pg_temp.u('1e') ORDER BY id DESC LIMIT 1)
                           = 'Motivo con espacios', '27 el motivo no se normalizó');
    PERFORM pg_temp.exigir((SELECT valor_anterior IS NULL FROM public.perfiles_historial
                            WHERE perfil_id = pg_temp.u('1a') AND tipo = 'ROL'), '27 anterior NULL');
    PERFORM pg_temp.ok('27: historial ROL con actor, anterior, nuevo, motivo normalizado y fecha');

    -- 4.9 UPDATE directo de rol, cuenta o acceso por la Dirección.
    PERFORM pg_temp.esperar(pg_temp.ejecutar('authenticated', D1, pg_catalog.format(
        'UPDATE public.perfiles SET rol_id = 1 WHERE id = %L RETURNING 1', pg_temp.u('06'))), 'E:42501', '28 rol_id');
    PERFORM pg_temp.esperar(pg_temp.ejecutar('authenticated', D1, pg_catalog.format(
        'UPDATE public.perfiles SET user_id = %L WHERE id = %L RETURNING 1', pg_temp.u('07'), pg_temp.u('19'))), 'E:42501', '28 user_id');
    PERFORM pg_temp.esperar(pg_temp.ejecutar('authenticated', D1, pg_catalog.format(
        'UPDATE public.perfiles SET estado_acceso = %L WHERE id = %L RETURNING 1', 'BLOQUEADO', pg_temp.u('06'))), 'E:42501', '28 estado_acceso');
    PERFORM pg_temp.esperar(pg_temp.ejecutar('authenticated', D1, pg_catalog.format(
        'UPDATE public.perfiles SET telefono = %L WHERE id = %L RETURNING 1', '0000', pg_temp.u('06'))), 'OK:1', '28 datos personales');
    PERFORM pg_temp.ok('28: la Dirección no actualiza rol_id, user_id ni estado_acceso directamente (42501); los datos personales sí');

    -- 4.10 Historial de solo agregado, incluso para postgres.
    PERFORM pg_temp.esperar(pg_temp.ejecutar('postgres', NULL,
        'UPDATE public.perfiles_historial SET motivo = ''Reescrito'' RETURNING 1'), 'E:P5908', '29 UPDATE postgres');
    PERFORM pg_temp.esperar(pg_temp.ejecutar('postgres', NULL,
        'DELETE FROM public.perfiles_historial RETURNING 1'), 'E:P5908', '29 DELETE postgres');
    PERFORM pg_temp.esperar(pg_temp.ejecutar('postgres', NULL,
        'TRUNCATE public.perfiles_historial'), 'E:P5908', '29 TRUNCATE postgres');
    PERFORM pg_temp.esperar(pg_temp.ejecutar('authenticated', D1,
        'UPDATE public.perfiles_historial SET motivo = ''Reescrito'' RETURNING 1'), 'E:42501', '29 UPDATE Dirección');
    PERFORM pg_temp.esperar(pg_temp.ejecutar('authenticated', D1,
        'DELETE FROM public.perfiles_historial RETURNING 1'), 'E:42501', '29 DELETE Dirección');
    PERFORM pg_temp.esperar(pg_temp.ejecutar('authenticated', D1,
        'TRUNCATE public.perfiles_historial'), 'E:42501', '29 TRUNCATE Dirección');
    PERFORM pg_temp.esperar(pg_temp.ejecutar('authenticated', D1, pg_catalog.format(
        'INSERT INTO public.perfiles_historial (perfil_id, tipo, valor_nuevo, motivo, actor_perfil_id) VALUES (%L, %L, %L, %L, %L) RETURNING 1',
        D1, 'ROL', 'DIRECTOR', 'Inserción directa', D1)), 'E:42501', '29 INSERT Dirección');
    PERFORM pg_temp.esperar(pg_temp.ejecutar('postgres', NULL, pg_catalog.format(
        'DELETE FROM app_private.vinculos_cuenta WHERE operacion_id = %L RETURNING 1', pg_temp.u('f1'))), 'E:P5939', '29 reservas DELETE postgres');
    PERFORM pg_temp.esperar(pg_temp.ejecutar('postgres', NULL, 'TRUNCATE app_private.vinculos_cuenta'), 'E:P5939', '29 reservas TRUNCATE postgres');
    PERFORM pg_temp.ok('29: historial: UPDATE/DELETE/TRUNCATE P5908 para postgres y 42501 para la Dirección; reservas D5 tampoco se borran (P5939)');

    -- 4.11 Cambio de acceso: validaciones.
    PERFORM pg_temp.esperar(pg_temp.ejecutar('authenticated', D1, pg_catalog.format(
        'SELECT estado_acceso::TEXT FROM public.cambiar_acceso_perfil(%L, %L, NULL, %L)', pg_temp.u('06'), 'HABILITADO', 'Motivo válido')),
        'E:P5902', '30 estado NULL');
    PERFORM pg_temp.esperar(pg_temp.ejecutar('authenticated', D1, pg_catalog.format(
        'SELECT estado_acceso::TEXT FROM public.cambiar_acceso_perfil(%L, %L, %L, %L)', pg_temp.u('06'), 'BLOQUEADO', 'HABILITADO', 'Motivo válido')),
        'E:P5909', '30 esperado obsoleto');
    PERFORM pg_temp.esperar(pg_temp.ejecutar('authenticated', D1, pg_catalog.format(
        'SELECT estado_acceso::TEXT FROM public.cambiar_acceso_perfil(%L, %L, %L, %L)', pg_temp.u('06'), 'HABILITADO', 'HABILITADO', 'Motivo válido')),
        'E:P5906', '30 mismo estado');
    PERFORM pg_temp.esperar(pg_temp.ejecutar('authenticated', D1, pg_catalog.format(
        'SELECT estado_acceso::TEXT FROM public.cambiar_acceso_perfil(%L, %L, %L, %L)', D1, 'HABILITADO', 'BLOQUEADO', 'Motivo válido')),
        'E:P5903', '30 autobloqueo');
    PERFORM pg_temp.esperar(pg_temp.ejecutar('authenticated', D1, pg_catalog.format(
        'SELECT estado_acceso::TEXT FROM public.cambiar_acceso_perfil(%L, %L, %L, %L)', pg_temp.u('06'), 'HABILITADO', 'BLOQUEADO', 'Uno')),
        'E:P5901', '30 motivo corto');
    PERFORM pg_temp.esperar(pg_temp.ejecutar('authenticated', pg_temp.u('03'), pg_catalog.format(
        'SELECT estado_acceso::TEXT FROM public.cambiar_acceso_perfil(%L, %L, %L, %L)', pg_temp.u('06'), 'HABILITADO', 'BLOQUEADO', 'Motivo válido')),
        'E:42501', '30 DOCENTE');
    PERFORM pg_temp.esperar(pg_temp.ejecutar('authenticated', D1, pg_catalog.format(
        'SELECT (SELECT estado_acceso::TEXT || ''|'' || user_id FROM public.estado_acceso_de(%L))', pg_temp.u('06'))),
        'OK:HABILITADO|' || pg_temp.u('06'), '30 estado_acceso_de');
    SELECT * INTO v_h FROM public.perfiles_historial
    WHERE perfil_id = pg_temp.u('06') AND tipo = 'ACCESO' ORDER BY id DESC LIMIT 1;
    PERFORM pg_temp.exigir(v_h.valor_anterior = 'BLOQUEADO' AND v_h.valor_nuevo = 'HABILITADO'
                           AND v_h.actor_perfil_id = pg_temp.u('02') AND v_h.motivo = 'Prueba de bloqueo EPT-59',
        '30 historial de acceso con contenido inesperado');
    PERFORM pg_temp.ok('30: cambiar_acceso_perfil: NULL P5902, obsoleto P5909, igual P5906, autobloqueo P5903, motivo P5901, DOCENTE 42501; historial ACCESO');
END $$;


-- ================================================================
-- 5. ÚLTIMO DIRECTOR EFECTIVO
-- ================================================================
-- El actor 08 es DIRECTOR habilitado en la base, pero su cuenta Auth no es
-- efectiva (el JWT sigue siendo válido). D1 se banea en Auth dentro de esta
-- sección para que D2 sea el único Director efectivo.
DO $$
DECLARE
    A  CONSTANT UUID := pg_temp.u('08');
    D2 CONSTANT UUID := pg_temp.u('02');
    r RECORD;
BEGIN
    UPDATE auth.users SET banned_until = now() + INTERVAL '1 day' WHERE id = pg_temp.u('01');

    FOR r IN SELECT * FROM (VALUES
        ('sin cuenta Auth', NULL::TEXT),
        ('borrada', 'deleted_at'),
        ('baneada', 'banned_until'),
        ('sin correo confirmado', 'email_confirmed_at'),
        ('anónima', 'is_anonymous')) AS t(estado, columna)
    LOOP
        DELETE FROM auth.users WHERE id = A;
        IF r.columna IS NOT NULL THEN
            INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data,
                                    raw_user_meta_data, created_at, updated_at, deleted_at, banned_until, is_anonymous)
            VALUES (A, 'authenticated', 'authenticated', 'actor.08@ept59.invalid',
                    CASE WHEN r.columna = 'email_confirmed_at' THEN NULL ELSE now() END,
                    '{"provider": "email", "providers": ["email"]}', '{}', now(), now(),
                    CASE WHEN r.columna = 'deleted_at' THEN now() END,
                    CASE WHEN r.columna = 'banned_until' THEN now() + INTERVAL '1 day' END,
                    r.columna = 'is_anonymous');
        END IF;

        PERFORM pg_temp.esperar(pg_temp.rol(A, D2, 'DIRECTOR', 'PERSONAL'), 'E:P5912', '31 degradar, único otro ' || r.estado);
        PERFORM pg_temp.esperar(pg_temp.ejecutar('authenticated', A, pg_catalog.format(
            'SELECT estado_acceso::TEXT FROM public.cambiar_acceso_perfil(%L, %L, %L, %L)', D2, 'HABILITADO', 'BLOQUEADO', 'Motivo válido')),
            'E:P5912', '31 bloquear, único otro ' || r.estado);
        PERFORM pg_temp.exigir(NOT app_private.es_director_efectivo(A), '31 el actor figura efectivo: ' || r.estado);
    END LOOP;

    -- Con otro Director efectivo, sí.
    UPDATE auth.users SET deleted_at = NULL, banned_until = NULL, email_confirmed_at = now(), is_anonymous = FALSE
    WHERE id = A;
    PERFORM pg_temp.exigir(app_private.es_director_efectivo(A), '31 el actor debería ser efectivo');
    PERFORM pg_temp.esperar(pg_temp.ejecutar('authenticated', A, pg_catalog.format(
        'SELECT estado_acceso::TEXT FROM public.cambiar_acceso_perfil(%L, %L, %L, %L)', D2, 'HABILITADO', 'BLOQUEADO', 'Motivo válido')),
        'OK:BLOQUEADO', '31 bloquear con otro efectivo');
    PERFORM pg_temp.esperar(pg_temp.ejecutar('authenticated', A, pg_catalog.format(
        'SELECT estado_acceso::TEXT FROM public.cambiar_acceso_perfil(%L, %L, %L, %L)', D2, 'BLOQUEADO', 'HABILITADO', 'Motivo válido')),
        'OK:HABILITADO', '31 reactivar');
    PERFORM pg_temp.esperar(pg_temp.rol(A, D2, 'DIRECTOR', 'PERSONAL'), 'OK', '31 degradar con otro efectivo');
    PERFORM pg_temp.esperar(pg_temp.rol(A, D2, 'PERSONAL', 'DIRECTOR'), 'OK', '31 restituir DIRECTOR');

    -- El último Director efectivo no puede degradarse ni bloquearse a sí mismo.
    PERFORM pg_temp.esperar(pg_temp.rol(A, A, 'DIRECTOR', 'PERSONAL'), 'E:P5903', '31 autodegradación');

    -- Vuelta al estado general: D1 efectivo, A sin cuenta efectiva.
    UPDATE auth.users SET banned_until = NULL WHERE id = pg_temp.u('01');
    DELETE FROM auth.users WHERE id = A;
    PERFORM pg_temp.ok('31: con el único otro Director sin cuenta, borrado, baneado, sin confirmar o anónimo: degradar y bloquear P5912; con otro efectivo, se permite; autodegradación P5903');
END $$;

-- Consultas de la Dirección: efectividad, enmascarado y búsqueda literal.
DO $$
DECLARE
    D1 CONSTANT UUID := pg_temp.u('01');
    v TEXT;
BEGIN
    v := pg_temp.ejecutar('authenticated', D1, pg_catalog.format(
        'SELECT es_director_efectivo || ''|'' || cuenta_existente || ''|'' || correo_enmascarado || ''|'' || puede_vincular FROM public.consultar_usuario(%L)',
        pg_temp.u('02')));
    PERFORM pg_temp.esperar(v, 'OK:true|true|a***@ept59.invalid|false', '32 consultar_usuario Director');
    v := pg_temp.ejecutar('authenticated', D1, pg_catalog.format(
        'SELECT es_director_efectivo || ''|'' || tiene_cuenta || ''|'' || cuenta_existente FROM public.consultar_usuario(%L)', pg_temp.u('08')));
    PERFORM pg_temp.esperar(v, 'OK:false|true|false', '32 consultar_usuario huérfano');
    v := pg_temp.ejecutar('authenticated', D1, pg_catalog.format(
        'SELECT puede_vincular || ''|'' || (vinculo_pendiente_operacion IS NULL) FROM public.consultar_usuario(%L)', pg_temp.u('23')));
    PERFORM pg_temp.esperar(v, 'OK:true|false', '32 consultar_usuario con reserva');
    v := pg_temp.ejecutar('authenticated', D1, $q$SELECT pg_catalog.count(*) || '|' || max(total) FROM public.listar_usuarios('Dirección', 50, 0)$q$);
    PERFORM pg_temp.esperar(v, 'OK:4|4', '32 búsqueda por apellido');
    v := pg_temp.ejecutar('authenticated', D1, $q$SELECT pg_catalog.count(*) FROM public.listar_usuarios('959000_1', 50, 0)$q$);
    PERFORM pg_temp.esperar(v, 'OK:0', '32 comodín _ literal');
    v := pg_temp.ejecutar('authenticated', D1, $q$SELECT pg_catalog.count(*) FROM public.listar_usuarios('%', 50, 0)$q$);
    PERFORM pg_temp.esperar(v, 'OK:0', '32 comodín % literal');
    v := pg_temp.ejecutar('authenticated', D1, $q$SELECT pg_catalog.count(*) FROM public.listar_usuarios(NULL, 3, 1)$q$);
    PERFORM pg_temp.esperar(v, 'OK:3', '32 paginado');
    PERFORM pg_temp.ok('32: listar/consultar usuarios: Director efectivo, cuenta huérfana, correo enmascarado, búsqueda con comodines literales y paginado');
END $$;


-- ================================================================
-- 6. ALTA DIRECTA DE PERFILES
-- ================================================================
CREATE FUNCTION pg_temp.alta(p_actor UUID, p_dni TEXT, p_rol TEXT, p_extra TEXT DEFAULT '', p_valores TEXT DEFAULT '')
RETURNS TEXT LANGUAGE sql AS $$
    SELECT pg_temp.ejecutar('authenticated', p_actor, pg_catalog.format(
        'INSERT INTO public.perfiles (nombre, apellido, dni, rol_id%s) VALUES (%L, %L, %L, %s%s) RETURNING id::TEXT',
        p_extra, 'Prueba', 'Alta directa', p_dni,
        COALESCE((SELECT id::TEXT FROM public.roles WHERE nombre = p_rol), 'NULL'), p_valores));
$$;

DO $$
DECLARE
    D1 CONSTANT UUID := pg_temp.u('01');
    v TEXT;
BEGIN
    PERFORM pg_temp.esperar(pg_temp.alta(D1, '95900101', 'PERSONAL', ', user_id', pg_catalog.format(', %L', pg_temp.u('07'))), 'E:42501', '33 con user_id');
    PERFORM pg_temp.esperar(pg_temp.alta(D1, '95900102', NULL), 'E:42501', '33 rol NULL');
    PERFORM pg_temp.esperar(pg_temp.alta(D1, '95900103', 'DIRECTOR'), 'E:42501', '33 DIRECTOR');
    PERFORM pg_temp.esperar(pg_temp.alta(D1, '95900104', 'PERSONAL', ', estado_acceso', ', ''BLOQUEADO'''), 'E:42501', '33 BLOQUEADO');
    PERFORM pg_temp.esperar(pg_temp.alta(pg_temp.u('03'), '95900105', 'PERSONAL'), 'E:42501', '33 DOCENTE');

    PERFORM pg_temp.esperar(pg_temp.alta(D1, '95900106', 'ESTUDIANTE'), 'OK', '33 ESTUDIANTE');
    PERFORM pg_temp.esperar(pg_temp.alta(D1, '95900107', 'PADRE'), 'OK', '33 PADRE');
    PERFORM pg_temp.esperar(pg_temp.alta(D1, '95900108', 'PERSONAL'), 'OK', '33 PERSONAL');
    v := pg_temp.alta(D1, '95900109', 'DOCENTE');
    PERFORM pg_temp.esperar(v, 'OK', '33 DOCENTE sin cuenta');
    PERFORM pg_temp.exigir(EXISTS (SELECT 1 FROM public.profesores WHERE perfil_id = pg_catalog.substr(v, 4)::UUID AND estado = 'ACTIVO'),
        '33 el DOCENTE sin cuenta no recibió ficha');
    PERFORM pg_temp.exigir(EXISTS (SELECT 1 FROM public.perfiles p JOIN public.alumnos a ON a.perfil_id = p.id WHERE p.dni = '95900106'),
        '33 el ESTUDIANTE no recibió fila académica');

    -- Forma exacta de `aceptarSolicitud` (src/services/inscripciones.service.ts).
    v := pg_temp.ejecutar('authenticated', D1, pg_catalog.format(
        'INSERT INTO public.perfiles (nombre, apellido, dni, fecha_nacimiento, telefono, direccion, rol_id, legajo_nro) VALUES (%L, %L, %L, %L, %L, %L, %s, %L) RETURNING id::TEXT',
        'Prueba', 'Aspirante', '95900110', '2015-03-01', '0000', 'Calle 1',
        (SELECT id FROM public.roles WHERE nombre = 'ESTUDIANTE'), '2026-9901'));
    PERFORM pg_temp.esperar(v, 'OK', '33 aceptación de solicitud');
    PERFORM pg_temp.exigir((SELECT estado_acceso = 'HABILITADO' AND user_id IS NULL FROM public.perfiles WHERE dni = '95900110'),
        '33 la aceptación de solicitud no quedó habilitada y sin cuenta');
    PERFORM pg_temp.ok('33: alta directa: user_id, rol NULL, DIRECTOR o BLOQUEADO 42501; ESTUDIANTE/DOCENTE(ficha)/PADRE/PERSONAL sin cuenta y aceptación de solicitud aceptados');
END $$;


-- ================================================================
-- 7. VÍNCULO PRESENCIAL (D5): RESERVA
-- ================================================================
CREATE FUNCTION pg_temp.reservar(p_actor UUID, p_op UUID, p_perfil UUID, p_dni TEXT,
                                 p_modalidad TEXT DEFAULT 'TITULAR', p_rep TEXT DEFAULT NULL, p_doc BOOLEAN DEFAULT TRUE)
RETURNS TEXT LANGUAGE sql AS $$
    SELECT pg_temp.ejecutar('authenticated', p_actor, pg_catalog.format(
        'SELECT estado || ''|'' || intentos_restantes FROM public.reservar_vinculo_cuenta(%L, %L, %L, %L, %L, %L)',
        p_op, p_perfil, p_dni, p_modalidad, p_rep, p_doc));
$$;

CREATE FUNCTION pg_temp.servidor(p_sql TEXT)
RETURNS TEXT LANGUAGE sql AS $$
    SELECT pg_temp.ejecutar('service_role', NULL, p_sql);
$$;

DO $$
DECLARE
    D1 CONSTANT UUID := pg_temp.u('01');
    D2 CONSTANT UUID := pg_temp.u('02');
    v TEXT;
BEGIN
    -- 18 = ESTUDIANTE sin cuenta (con alumno y padre); 1c = DOCENTE sin cuenta.
    PERFORM pg_temp.esperar(pg_temp.reservar(D1, pg_temp.u('a1'), pg_temp.u('18'), '95900018', 'TITULAR', NULL, FALSE), 'E:P5920', '34 sin constancia');
    PERFORM pg_temp.esperar(pg_temp.reservar(D1, pg_temp.u('a1'), pg_temp.u('18'), '95900018', 'OTRA'), 'E:P5920', '34 modalidad');
    PERFORM pg_temp.esperar(pg_temp.reservar(D1, pg_temp.u('a1'), pg_temp.u('18'), '95900018', 'REPRESENTANTE'), 'E:P5920', '34 representante sin DNI');
    PERFORM pg_temp.esperar(pg_temp.reservar(D1, pg_temp.u('a1'), pg_temp.u('18'), '95900018', 'REPRESENTANTE', '12ab'), 'E:P5920', '34 DNI de representante');
    PERFORM pg_temp.esperar(pg_temp.reservar(D1, pg_temp.u('a1'), pg_temp.u('18'), '95900018', 'TITULAR', '30111222'), 'E:P5920', '34 titular con representante');
    PERFORM pg_temp.esperar(pg_temp.reservar(D1, pg_temp.u('a1'), pg_temp.u('18'), '95900099'), 'E:P5927', '34 DNI distinto');
    PERFORM pg_temp.esperar(pg_temp.reservar(D1, pg_temp.u('a1'), pg_temp.u('06'), '95900006'), 'E:P5924', '34 cuenta previa');
    PERFORM pg_temp.esperar(pg_temp.reservar(D1, pg_temp.u('a1'), pg_temp.u('1a'), '95900020'), 'OK', '34 perfil corregido a PERSONAL en la sección 4');
    PERFORM pg_temp.esperar(pg_temp.ejecutar('authenticated', D1, pg_catalog.format('SELECT estado FROM public.cancelar_vinculo(%L)', pg_temp.u('a1'))), 'OK:CANCELADA', '34 cancelar');
    PERFORM pg_temp.esperar(pg_temp.ejecutar('authenticated', D1, pg_catalog.format('SELECT estado FROM public.cancelar_vinculo(%L)', pg_temp.u('a1'))), 'OK:CANCELADA', '34 cancelar idempotente');
    PERFORM pg_temp.esperar(pg_temp.reservar(D1, pg_temp.u('a2'), pg_temp.u('1b'), '95900029'), 'E:P5926', '34 DIRECTOR sin cuenta');

    -- Un perfil sin rol (se crea como propietario: la política ya no lo admite).
    INSERT INTO public.perfiles (id, rol_id, nombre, apellido, dni) VALUES (pg_temp.u('30'), NULL, 'Prueba', 'Sin rol D5', '95900030');
    PERFORM pg_temp.esperar(pg_temp.reservar(D1, pg_temp.u('a2'), pg_temp.u('30'), '95900030'), 'E:P5926', '34 rol NULL');

    PERFORM pg_temp.esperar(pg_temp.cambiar_acceso(pg_temp.u('1d'), 'HABILITADO', 'BLOQUEADO'), 'OK:BLOQUEADO', '34 bloquear sin cuenta');
    PERFORM pg_temp.esperar(pg_temp.reservar(D1, pg_temp.u('a2'), pg_temp.u('1d'), '95900022'), 'E:P5925', '34 bloqueado');
    PERFORM pg_temp.esperar(pg_temp.reservar(D1, pg_temp.u('a2'), pg_temp.u('ff'), '95900022'), 'E:P5904', '34 inexistente');
    PERFORM pg_temp.esperar(pg_temp.reservar(pg_temp.u('03'), pg_temp.u('a2'), pg_temp.u('18'), '95900018'), 'E:42501', '34 DOCENTE');
    PERFORM pg_temp.esperar(pg_temp.ejecutar('anon', NULL, pg_catalog.format(
        'SELECT estado FROM public.reservar_vinculo_cuenta(%L, %L, %L, %L, NULL, true)', pg_temp.u('a2'), pg_temp.u('18'), '95900018', 'TITULAR')),
        'E:42501', '34 anon');

    -- Reserva válida e idempotencia por operación.
    PERFORM pg_temp.esperar(pg_temp.reservar(D1, pg_temp.u('a3'), pg_temp.u('18'), '95900018', 'REPRESENTANTE', '30111222'), 'OK:PENDIENTE|5', '35 reserva');
    PERFORM pg_temp.esperar(pg_temp.reservar(D1, pg_temp.u('a3'), pg_temp.u('18'), '95900018', 'REPRESENTANTE', '30111222'), 'OK:PENDIENTE|5', '35 reintento idempotente');
    PERFORM pg_temp.esperar(pg_temp.reservar(D1, pg_temp.u('a3'), pg_temp.u('19'), '95900019'), 'E:P5921', '35 operación reutilizada con otro perfil');
    PERFORM pg_temp.esperar(pg_temp.reservar(D2, pg_temp.u('a3'), pg_temp.u('18'), '95900018', 'REPRESENTANTE', '30111222'), 'E:P5921', '35 operación reutilizada por otro Director');
    PERFORM pg_temp.esperar(pg_temp.reservar(D2, pg_temp.u('a4'), pg_temp.u('18'), '95900018'), 'E:P5922', '35 segunda reserva activa');
    PERFORM pg_temp.exigir((SELECT pg_catalog.count(*) FROM app_private.vinculos_cuenta WHERE perfil_id = pg_temp.u('18')) = 1,
        '35 la reserva duplicada dejó filas');

    -- Vencimiento.
    PERFORM pg_temp.esperar(pg_temp.reservar(D1, pg_temp.u('a5'), pg_temp.u('20'), '95900025'), 'OK:PENDIENTE|5', '36 reserva a vencer');
    UPDATE app_private.vinculos_cuenta SET vence_en = now() - INTERVAL '1 second' WHERE operacion_id = pg_temp.u('a5');
    PERFORM pg_temp.esperar(pg_temp.reservar(D1, pg_temp.u('a5'), pg_temp.u('20'), '95900025'), 'E:P5923', '36 reintento vencido');
    PERFORM pg_temp.esperar(pg_temp.ejecutar('authenticated', D1, pg_catalog.format('SELECT estado FROM public.consultar_vinculo(%L)', pg_temp.u('a5'))), 'OK:VENCIDA', '36 estado efectivo');
    PERFORM pg_temp.esperar(pg_temp.reservar(D2, pg_temp.u('a6'), pg_temp.u('20'), '95900025'), 'OK:PENDIENTE|5', '36 nueva reserva tras vencimiento');
    PERFORM pg_temp.exigir((SELECT estado FROM app_private.vinculos_cuenta WHERE operacion_id = pg_temp.u('a5')) = 'VENCIDA',
        '36 la reserva vencida no quedó marcada');
    PERFORM pg_temp.ok('34-36: reserva D5: constancia/modalidad P5920, DNI P5927, cuenta previa P5924, DIRECTOR o sin rol P5926, bloqueado P5925, reutilización P5921, segunda activa P5922, vencida P5923 y reemplazo');
END $$;


-- ================================================================
-- 8. VÍNCULO PRESENCIAL (D5): DESAFÍO
-- ================================================================
CREATE TEMPORARY TABLE codigos (operacion_id UUID PRIMARY KEY, codigo TEXT NOT NULL);

CREATE FUNCTION pg_temp.emitir(p_op UUID, p_director UUID, p_correo TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE v TEXT;
BEGIN
    v := pg_temp.servidor(pg_catalog.format(
        'SELECT codigo || ''|'' || correo FROM public.emitir_desafio_vinculo(%L, %L, %L)', p_op, p_director, p_correo));
    IF v LIKE 'OK:%' THEN
        INSERT INTO codigos VALUES (p_op, pg_catalog.split_part(pg_catalog.substr(v, 4), '|', 1))
        ON CONFLICT (operacion_id) DO UPDATE SET codigo = EXCLUDED.codigo;
        RETURN 'OK:' || pg_catalog.split_part(v, '|', 2);  -- nunca se devuelve el código
    END IF;
    RETURN v;
END;
$$;

CREATE FUNCTION pg_temp.verificar(p_op UUID, p_director UUID, p_codigo TEXT)
RETURNS TEXT LANGUAGE sql AS $$
    SELECT pg_temp.servidor(pg_catalog.format(
        'SELECT resultado || ''|'' || intentos_restantes FROM public.verificar_desafio_vinculo(%L, %L, %L)', p_op, p_director, p_codigo));
$$;

CREATE FUNCTION pg_temp.codigo_incorrecto(p_op UUID)
RETURNS TEXT LANGUAGE sql STABLE AS $$
    SELECT pg_catalog.lpad(((codigo::INTEGER + 1) % 1000000)::TEXT, 6, '0') FROM codigos WHERE operacion_id = p_op;
$$;

DO $$
DECLARE
    D1 CONSTANT UUID := pg_temp.u('01');
    D2 CONSTANT UUID := pg_temp.u('02');
    OP CONSTANT UUID := pg_temp.u('a3');
    v TEXT;
    v_res app_private.vinculos_cuenta%ROWTYPE;
    i INTEGER;
BEGIN
    -- 8.1 Emisión: validaciones.
    PERFORM pg_temp.esperar(pg_temp.emitir(pg_temp.u('ee'), D1, 'est2@ept59.invalid'), 'E:P5930', '37 reserva inexistente');
    PERFORM pg_temp.esperar(pg_temp.emitir(OP, D2, 'est2@ept59.invalid'), 'E:P5935', '37 otro Director');
    PERFORM pg_temp.esperar(pg_temp.emitir(OP, D1, 'no-es-un-correo'), 'E:P5928', '37 correo inválido');
    PERFORM pg_temp.esperar(pg_temp.emitir(OP, D1, pg_catalog.repeat('a', 250) || '@x.io'), 'E:P5928', '37 correo largo');
    PERFORM pg_temp.esperar(pg_temp.emitir(OP, D1, 'ACTOR.06@ept59.invalid'), 'E:P5931', '37 correo en uso');
    PERFORM pg_temp.esperar(pg_temp.emitir(pg_temp.u('a5'), D1, 'vencida@ept59.invalid'), 'E:P5933', '37 reserva vencida');

    -- 8.2 Emisión válida: solo se guarda el hash.
    PERFORM pg_temp.esperar(pg_temp.emitir(OP, D1, '  Est2@EPT59.invalid '), 'OK:est2@ept59.invalid', '38 emitir');
    SELECT * INTO v_res FROM app_private.vinculos_cuenta WHERE operacion_id = OP;
    PERFORM pg_temp.exigir((SELECT codigo ~ '^[0-9]{6}$' FROM codigos WHERE operacion_id = OP), '38 el código no tiene 6 dígitos');
    PERFORM pg_temp.exigir(v_res.desafio_hash IS NOT NULL
                           AND v_res.desafio_hash LIKE '$2a$08$%'
                           AND v_res.desafio_hash <> (SELECT codigo FROM codigos WHERE operacion_id = OP)
                           AND pg_catalog.strpos(v_res.desafio_hash, (SELECT codigo FROM codigos WHERE operacion_id = OP)) = 0,
        '38 el código quedó guardado en claro o sin bcrypt');
    PERFORM pg_temp.exigir(NOT EXISTS (
            SELECT 1 FROM pg_catalog.jsonb_each_text(pg_catalog.to_jsonb(v_res)) e
            WHERE e.value = (SELECT codigo FROM codigos WHERE operacion_id = OP)),
        '38 alguna columna de la reserva contiene el código');
    PERFORM pg_temp.exigir(v_res.correo = 'est2@ept59.invalid' AND v_res.desafios_emitidos = 1 AND v_res.desafio_intentos = 0
                           AND v_res.desafio_vence_en = LEAST(now() + INTERVAL '10 minutes', v_res.vence_en),
        '38 datos del desafío inesperados');
    PERFORM pg_temp.esperar(pg_temp.emitir(OP, D1, 'otro@ept59.invalid'), 'E:P5929', '38 otro correo');
    PERFORM pg_temp.esperar(pg_temp.ejecutar('authenticated', D1, pg_catalog.format(
        'SELECT correo_enmascarado || ''|'' || desafio_emitido FROM public.consultar_vinculo(%L)', OP)), 'OK:e***@ept59.invalid|true', '38 consulta segura');
    PERFORM pg_temp.ok('37-38: emitir: inexistente P5930, otro Director P5935, correo P5928/P5931, vencida P5933; válido guarda solo el hash bcrypt, nunca el código; otro correo P5929');

    -- 8.3 Datos para enlace antes de verificar.
    PERFORM pg_temp.esperar(pg_temp.servidor(pg_catalog.format('SELECT estado FROM public.datos_para_enlace(%L, %L)', OP, D1)), 'E:P5944', '39 sin verificar');

    -- 8.4 Código incorrecto: no lanza y consume un intento.
    PERFORM pg_temp.esperar(pg_temp.verificar(OP, D1, pg_temp.codigo_incorrecto(OP)), 'OK:INCORRECTO|4', '39 incorrecto');
    PERFORM pg_temp.exigir((SELECT desafio_intentos FROM app_private.vinculos_cuenta WHERE operacion_id = OP) = 1,
        '39 el intento incorrecto no se registró');
    PERFORM pg_temp.esperar(pg_temp.verificar(OP, D1, 'abcdef'), 'OK:INCORRECTO|3', '39 formato inválido');
    PERFORM pg_temp.esperar(pg_temp.verificar(OP, D2, '000000'), 'E:P5935', '39 otro Director');

    -- 8.5 Código correcto e idempotencia.
    PERFORM pg_temp.esperar(pg_temp.verificar(OP, D1, (SELECT codigo FROM codigos WHERE operacion_id = OP)), 'OK:VERIFICADO|2', '40 correcto');
    PERFORM pg_temp.esperar(pg_temp.verificar(OP, D1, '000000'), 'OK:VERIFICADO|2', '40 reintento');
    PERFORM pg_temp.exigir((SELECT desafio_hash IS NULL AND correo_verificado_en IS NOT NULL FROM app_private.vinculos_cuenta WHERE operacion_id = OP),
        '40 la verificación no anuló el hash');
    PERFORM pg_temp.esperar(pg_temp.servidor(pg_catalog.format('SELECT correo || ''|'' || estado || ''|'' || vinculado FROM public.datos_para_enlace(%L, %L)', OP, D1)),
        'OK:est2@ept59.invalid|PENDIENTE|false', '40 datos para enlace');
    PERFORM pg_temp.ok('39-40: incorrecto no lanza y descuenta intentos; otro Director P5935; correcto VERIFICADO idempotente; datos_para_enlace P5944 antes y datos después');

    -- 8.6 Cinco intentos agotan el desafío.
    PERFORM pg_temp.esperar(pg_temp.reservar(D1, pg_temp.u('a7'), pg_temp.u('1f'), '95900024'), 'OK:PENDIENTE|5', '41 reserva');
    PERFORM pg_temp.esperar(pg_temp.emitir(pg_temp.u('a7'), D1, 'intentos@ept59.invalid'), 'OK:intentos@ept59.invalid', '41 emitir');
    FOR i IN 1..5 LOOP
        PERFORM pg_temp.esperar(pg_temp.verificar(pg_temp.u('a7'), D1, pg_temp.codigo_incorrecto(pg_temp.u('a7'))),
            'OK:INCORRECTO|' || (5 - i), '41 intento ' || i);
    END LOOP;
    PERFORM pg_temp.exigir((SELECT desafio_hash IS NULL FROM app_private.vinculos_cuenta WHERE operacion_id = pg_temp.u('a7')),
        '41 el quinto intento no anuló el hash');
    PERFORM pg_temp.esperar(pg_temp.verificar(pg_temp.u('a7'), D1, (SELECT codigo FROM codigos WHERE operacion_id = pg_temp.u('a7'))),
        'OK:SIN_INTENTOS|0', '41 correcto después de agotar');

    -- Reenvío: nuevo código, intentos a cero; el código anterior ya no sirve.
    PERFORM pg_temp.esperar(pg_temp.emitir(pg_temp.u('a7'), D1, 'intentos@ept59.invalid'), 'OK:intentos@ept59.invalid', '41 reenvío');
    PERFORM pg_temp.exigir((SELECT desafio_intentos = 0 AND desafios_emitidos = 2 FROM app_private.vinculos_cuenta WHERE operacion_id = pg_temp.u('a7')),
        '41 el reenvío no reinició los intentos');

    -- Anulación por fallo de transporte.
    PERFORM pg_temp.esperar(pg_temp.servidor(pg_catalog.format('SELECT public.anular_desafio_vinculo(%L, %L)::TEXT', pg_temp.u('a7'), D1)), 'OK:<NULL>', '41 anular');
    PERFORM pg_temp.esperar(pg_temp.verificar(pg_temp.u('a7'), D1, (SELECT codigo FROM codigos WHERE operacion_id = pg_temp.u('a7'))), 'E:P5936', '41 sin desafío vigente');

    -- Límite de envíos.
    UPDATE app_private.vinculos_cuenta SET desafios_emitidos = 5 WHERE operacion_id = pg_temp.u('a7');
    PERFORM pg_temp.esperar(pg_temp.emitir(pg_temp.u('a7'), D1, 'intentos@ept59.invalid'), 'E:P5932', '41 límite de envíos');

    -- Vencimiento del desafío.
    UPDATE app_private.vinculos_cuenta SET desafios_emitidos = 1 WHERE operacion_id = pg_temp.u('a7');
    PERFORM pg_temp.esperar(pg_temp.emitir(pg_temp.u('a7'), D1, 'intentos@ept59.invalid'), 'OK:intentos@ept59.invalid', '41 emitir otra vez');
    UPDATE app_private.vinculos_cuenta SET desafio_vence_en = now() - INTERVAL '1 second' WHERE operacion_id = pg_temp.u('a7');
    PERFORM pg_temp.esperar(pg_temp.verificar(pg_temp.u('a7'), D1, (SELECT codigo FROM codigos WHERE operacion_id = pg_temp.u('a7'))), 'OK:VENCIDO|0', '41 desafío vencido');
    PERFORM pg_temp.exigir((SELECT desafio_hash IS NULL AND correo_verificado_en IS NULL FROM app_private.vinculos_cuenta WHERE operacion_id = pg_temp.u('a7')),
        '41 el desafío vencido no se anuló');

    -- Correo reservado por otra operación vigente.
    PERFORM pg_temp.esperar(pg_temp.emitir(pg_temp.u('a6'), D2, 'intentos@ept59.invalid'), 'E:P5931', '41 correo de otra reserva vigente');
    PERFORM pg_temp.ok('41: cinco intentos agotan (hash anulado, SIN_INTENTOS), reenvío reinicia, anulación P5936, límite de envíos P5932, desafío vencido VENCIDO, correo de otra reserva P5931');
END $$;


-- ================================================================
-- 9. VÍNCULO PRESENCIAL (D5): ENLACE DENTRO DE GOTRUE
-- ================================================================
DO $$
DECLARE
    D1 CONSTANT UUID := pg_temp.u('01');
    D2 CONSTANT UUID := pg_temp.u('02');
    OP CONSTANT UUID := pg_temp.u('a3');
    EST2 CONSTANT UUID := pg_temp.u('18');
    v_cuenta UUID;
    v_pedido JSONB;
    v_rel_antes TEXT;
    v_rel_despues TEXT;
    v_hist BIGINT;
    v TEXT;
BEGIN
    SELECT cuenta_id INTO v_cuenta FROM app_private.vinculos_cuenta WHERE operacion_id = OP;
    v_pedido := pg_catalog.jsonb_build_object('ept_vinculo', pg_catalog.jsonb_build_object('operacion_id', OP::TEXT));

    SELECT pg_catalog.concat_ws('#',
        (SELECT pg_catalog.concat_ws('|', a.perfil_id, a.estado, a.fecha_alta, a.fecha_actualizacion) FROM public.alumnos a WHERE a.perfil_id = EST2),
        (SELECT pg_catalog.string_agg(pg_catalog.concat_ws('|', ph.padre_id, ph.hijo_id, ph.fecha_creacion), ';') FROM public.padres_hijos ph WHERE ph.hijo_id = EST2),
        (SELECT pg_catalog.concat_ws('|', p.id, p.nombre, p.apellido, p.dni, p.rol_id, p.legajo_nro, p.fecha_creacion) FROM public.perfiles p WHERE p.id = EST2))
    INTO v_rel_antes;

    -- 9.1 Solo `raw_app_meta_data` autoriza: la misma clave en user_metadata no hace nada.
    PERFORM pg_temp.esperar(pg_temp.intentar_alta(v_cuenta, 'est2@ept59.invalid', '{}', v_pedido), 'OK:', '42 user_metadata');
    PERFORM pg_temp.exigir((SELECT user_id FROM public.perfiles WHERE id = EST2) IS NULL
                           AND (SELECT estado FROM app_private.vinculos_cuenta WHERE operacion_id = OP) = 'PENDIENTE',
        '42 raw_user_meta_data enlazó la cuenta');
    DELETE FROM auth.users WHERE id = v_cuenta;
    PERFORM pg_temp.ok('42: ept_vinculo en raw_user_meta_data no enlaza ni cambia la reserva');

    -- 9.2 Rechazos: GoTrue revierte la cuenta entera; el perfil sigue sin cuenta.
    PERFORM pg_temp.esperar(pg_temp.intentar_alta(v_cuenta, 'est2@ept59.invalid',
        pg_catalog.jsonb_build_object('ept_vinculo', pg_catalog.jsonb_build_object('operacion_id', OP::TEXT, 'perfil_id', EST2::TEXT))), 'E:P5940', '43 clave extra');
    PERFORM pg_temp.esperar(pg_temp.intentar_alta(v_cuenta, 'est2@ept59.invalid',
        pg_catalog.jsonb_build_object('ept_vinculo', pg_catalog.jsonb_build_object('operacion_id', 12))), 'E:P5940', '43 tipo');
    PERFORM pg_temp.esperar(pg_temp.intentar_alta(v_cuenta, 'est2@ept59.invalid',
        pg_catalog.jsonb_build_object('ept_vinculo', 'texto')), 'E:P5940', '43 no objeto');
    PERFORM pg_temp.esperar(pg_temp.intentar_alta(v_cuenta, 'est2@ept59.invalid',
        v_pedido || pg_catalog.jsonb_build_object('ept_alta', pg_catalog.jsonb_build_object('nombre', 'X'))), 'E:P5940', '43 con ept_alta');
    PERFORM pg_temp.esperar(pg_temp.intentar_alta(pg_temp.u('ed'), 'est2@ept59.invalid', v_pedido), 'E:P5941', '43 otra cuenta');
    PERFORM pg_temp.esperar(pg_temp.intentar_alta(v_cuenta, 'otro@ept59.invalid', v_pedido), 'E:P5942', '43 otro correo');
    PERFORM pg_temp.esperar(pg_temp.intentar_alta(v_cuenta, 'est2@ept59.invalid',
        pg_catalog.jsonb_build_object('ept_vinculo', pg_catalog.jsonb_build_object('operacion_id', pg_temp.u('ee')::TEXT))), 'E:P5941', '43 operación inexistente');

    -- Reserva sin verificar (a6: sin desafío) → P5944.
    PERFORM pg_temp.esperar(pg_temp.emitir(pg_temp.u('a6'), D2, 'vence@ept59.invalid'), 'OK:vence@ept59.invalid', '43 emitir a6');
    PERFORM pg_temp.esperar(pg_temp.intentar_alta(
        (SELECT cuenta_id FROM app_private.vinculos_cuenta WHERE operacion_id = pg_temp.u('a6')), 'vence@ept59.invalid',
        pg_catalog.jsonb_build_object('ept_vinculo', pg_catalog.jsonb_build_object('operacion_id', pg_temp.u('a6')::TEXT))), 'E:P5944', '43 sin verificar');

    -- Director ya no habilitado → P5945.
    PERFORM pg_temp.esperar(pg_temp.cambiar_acceso(D1, 'HABILITADO', 'BLOQUEADO'), 'OK:BLOQUEADO', '43 bloquear D1');
    PERFORM pg_temp.esperar(pg_temp.intentar_alta(v_cuenta, 'est2@ept59.invalid', v_pedido), 'E:P5945', '43 Director bloqueado');
    PERFORM pg_temp.esperar(pg_temp.cambiar_acceso(D1, 'BLOQUEADO', 'HABILITADO'), 'OK:HABILITADO', '43 reactivar D1');

    -- Perfil bloqueado → P5947.
    PERFORM pg_temp.esperar(pg_temp.cambiar_acceso(EST2, 'HABILITADO', 'BLOQUEADO'), 'OK:BLOQUEADO', '43 bloquear perfil');
    PERFORM pg_temp.esperar(pg_temp.intentar_alta(v_cuenta, 'est2@ept59.invalid', v_pedido), 'E:P5947', '43 perfil bloqueado');
    PERFORM pg_temp.esperar(pg_temp.cambiar_acceso(EST2, 'BLOQUEADO', 'HABILITADO'), 'OK:HABILITADO', '43 reactivar perfil');

    -- Perfil que recibió otra cuenta por otro camino → P5946.
    UPDATE public.perfiles SET user_id = pg_temp.u('07') WHERE id = EST2;
    PERFORM pg_temp.esperar(pg_temp.intentar_alta(v_cuenta, 'est2@ept59.invalid', v_pedido), 'E:P5946', '43 perfil con cuenta');
    UPDATE public.perfiles SET user_id = NULL WHERE id = EST2;

    -- Reserva vencida → P5943.
    UPDATE app_private.vinculos_cuenta SET vence_en = now() - INTERVAL '1 second' WHERE operacion_id = OP;
    PERFORM pg_temp.esperar(pg_temp.intentar_alta(v_cuenta, 'est2@ept59.invalid', v_pedido), 'E:P5943', '43 reserva vencida');
    UPDATE app_private.vinculos_cuenta SET vence_en = now() + INTERVAL '15 minutes' WHERE operacion_id = OP;

    PERFORM pg_temp.exigir(NOT EXISTS (SELECT 1 FROM auth.users WHERE id IN (v_cuenta, pg_temp.u('ed')))
                           AND (SELECT user_id FROM public.perfiles WHERE id = EST2) IS NULL
                           AND pg_temp.historial(EST2) = 2,
        '43 un rechazo dejó cuenta, enlace o historial de vínculo');
    PERFORM pg_temp.ok('43: enlace rechazado sin cuenta residual: contrato P5940, cuenta P5941, correo P5942, vencida P5943, sin verificar P5944, Director P5945, con cuenta P5946, bloqueado P5947');

    -- 9.3 Enlace correcto.
    PERFORM pg_temp.esperar(pg_temp.intentar_alta(v_cuenta, 'Est2@ept59.invalid', v_pedido), 'OK:', '44 enlace');
    SELECT pg_catalog.concat_ws('#',
        (SELECT pg_catalog.concat_ws('|', a.perfil_id, a.estado, a.fecha_alta, a.fecha_actualizacion) FROM public.alumnos a WHERE a.perfil_id = EST2),
        (SELECT pg_catalog.string_agg(pg_catalog.concat_ws('|', ph.padre_id, ph.hijo_id, ph.fecha_creacion), ';') FROM public.padres_hijos ph WHERE ph.hijo_id = EST2),
        (SELECT pg_catalog.concat_ws('|', p.id, p.nombre, p.apellido, p.dni, p.rol_id, p.legajo_nro, p.fecha_creacion) FROM public.perfiles p WHERE p.id = EST2))
    INTO v_rel_despues;
    PERFORM pg_temp.exigir(v_rel_antes = v_rel_despues, '44 cambiaron el perfil, su alumno o su vínculo familiar');
    PERFORM pg_temp.exigir((SELECT user_id FROM public.perfiles WHERE id = EST2) = v_cuenta, '44 el perfil no quedó enlazado');
    PERFORM pg_temp.exigir(NOT ((SELECT raw_app_meta_data FROM auth.users WHERE id = v_cuenta) ? 'ept_vinculo'), '44 la clave quedó en auth.users');
    PERFORM pg_temp.exigir((SELECT estado = 'COMPLETADA' AND completada_en IS NOT NULL AND desafio_hash IS NULL
                            FROM app_private.vinculos_cuenta WHERE operacion_id = OP), '44 la reserva no quedó COMPLETADA');
    PERFORM pg_temp.exigir(EXISTS (SELECT 1 FROM public.perfiles_historial
                                   WHERE perfil_id = EST2 AND tipo = 'VINCULO' AND valor_anterior = 'SIN_CUENTA'
                                     AND valor_nuevo = 'CUENTA_VINCULADA' AND actor_perfil_id = D1 AND operacion_id = OP
                                     AND motivo = 'Vinculación presencial con verificación de correo'),
        '44 falta el historial VINCULO');
    SELECT pg_temp.historial(EST2) INTO v_hist;

    -- Reintento del mismo enlace: idempotente.
    SET LOCAL ROLE supabase_auth_admin;
    UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data || v_pedido WHERE id = v_cuenta;
    RESET ROLE;
    PERFORM pg_temp.exigir(pg_temp.historial(EST2) = v_hist
                           AND NOT ((SELECT raw_app_meta_data FROM auth.users WHERE id = v_cuenta) ? 'ept_vinculo'),
        '44 el reintento no fue idempotente');

    -- La cuenta nueva opera como ESTUDIANTE habilitado.
    PERFORM pg_temp.esperar(pg_temp.ejecutar('authenticated', v_cuenta, 'SELECT public.mi_estado_acceso() || ''|'' || public.rol_actual()'),
        'OK:HABILITADO|ESTUDIANTE', '44 sesión de la cuenta vinculada');

    -- Después del éxito, la operación no se reutiliza.
    PERFORM pg_temp.esperar(pg_temp.verificar(OP, D1, '000000'), 'E:P5933', '44 verificar tras completar');
    PERFORM pg_temp.esperar(pg_temp.emitir(OP, D1, 'est2@ept59.invalid'), 'E:P5933', '44 emitir tras completar');
    PERFORM pg_temp.esperar(pg_temp.ejecutar('authenticated', D1, pg_catalog.format('SELECT estado FROM public.cancelar_vinculo(%L)', OP)), 'E:P5933', '44 cancelar tras completar');
    PERFORM pg_temp.esperar(pg_temp.reservar(D1, OP, EST2, '95900018', 'REPRESENTANTE', '30111222'), 'OK:COMPLETADA|2', '44 reserva idempotente devuelve COMPLETADA');
    PERFORM pg_temp.esperar(pg_temp.servidor(pg_catalog.format('SELECT estado || ''|'' || vinculado FROM public.datos_para_enlace(%L, %L)', OP, D1)),
        'OK:COMPLETADA|true', '44 reconciliación');
    PERFORM pg_temp.ok('44: enlace correcto: mismo id de perfil, alumno y vínculo familiar intactos, reserva COMPLETADA, historial VINCULO, reintento idempotente y operación no reutilizable');
END $$;

-- 9.4 Un DOCENTE sin cuenta conserva su ficha al vincularse.
DO $$
DECLARE
    D1 CONSTANT UUID := pg_temp.u('01');
    OP CONSTANT UUID := pg_temp.u('a8');
    DOC CONSTANT UUID := pg_temp.u('1c');
    v_ficha_antes TEXT;
    v_cuenta UUID;
BEGIN
    SELECT pg_catalog.concat_ws('|', perfil_id, especialidad, estado, fecha_alta, fecha_actualizacion) INTO v_ficha_antes
    FROM public.profesores WHERE perfil_id = DOC;
    PERFORM pg_temp.esperar(pg_temp.reservar(D1, OP, DOC, '95900021'), 'OK:PENDIENTE|5', '45 reserva');
    PERFORM pg_temp.esperar(pg_temp.emitir(OP, D1, 'docente.d5@ept59.invalid'), 'OK:docente.d5@ept59.invalid', '45 emitir');
    PERFORM pg_temp.esperar(pg_temp.verificar(OP, D1, (SELECT codigo FROM codigos WHERE operacion_id = OP)), 'OK:VERIFICADO|4', '45 verificar');
    SELECT cuenta_id INTO v_cuenta FROM app_private.vinculos_cuenta WHERE operacion_id = OP;
    PERFORM pg_temp.esperar(pg_temp.intentar_alta(v_cuenta, 'docente.d5@ept59.invalid',
        pg_catalog.jsonb_build_object('ept_vinculo', pg_catalog.jsonb_build_object('operacion_id', OP::TEXT))), 'OK:', '45 enlace');
    PERFORM pg_temp.exigir((SELECT user_id FROM public.perfiles WHERE id = DOC) = v_cuenta
                           AND v_ficha_antes = (SELECT pg_catalog.concat_ws('|', perfil_id, especialidad, estado, fecha_alta, fecha_actualizacion)
                                                FROM public.profesores WHERE perfil_id = DOC),
        '45 la ficha cambió al vincular');
    PERFORM pg_temp.esperar(pg_temp.ejecutar('authenticated', v_cuenta, 'SELECT pg_catalog.count(*) FROM public.consultar_ficha_profesor(NULL)'),
        'OK:1', '45 el docente vinculado ve su ficha');
    PERFORM pg_temp.ok('45: un DOCENTE sin cuenta se vincula y conserva su ficha; ve su ficha con la cuenta nueva');
END $$;

-- ================================================================
-- 10. CORRECCIONES DE LA AUDITORÍA INDEPENDIENTE (D6)
-- ================================================================
-- Hallazgo 4: DIRECTOR solo para una cuenta confirmada (P5913).
-- Hallazgo 1: el alta atómica no adopta un perfil huérfano (P5914).
-- Hallazgo 6: topes de envío por correo y por Director (P5932).
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data,
                        raw_user_meta_data, created_at, updated_at)
VALUES (pg_temp.u('e3'), 'authenticated', 'authenticated', 'sin.confirmar@ept59.invalid', NULL,
        '{"provider": "email", "providers": ["email"]}', '{}', now(), now());

INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni, fecha_creacion)
SELECT pg_temp.u(v.s), v.cuenta, (SELECT id FROM public.roles WHERE nombre = 'PERSONAL'),
       'Prueba', v.apellido, v.dni, v.creado
FROM (VALUES
    ('e0', NULL::UUID,     'Auditoría sin cuenta',     '95900090', now()),
    ('e3', pg_temp.u('e3'), 'Auditoría sin confirmar', '95900091', now()),
    ('e1', pg_temp.u('e1'), 'Auditoría huérfano',      '95900092', now() - INTERVAL '1 day'),
    ('e5', NULL::UUID,     'Auditoría envíos A',       '95900093', now()),
    ('e6', NULL::UUID,     'Auditoría envíos B',       '95900094', now()),
    ('e7', NULL::UUID,     'Auditoría envíos C',       '95900095', now()),
    ('e8', NULL::UUID,     'Auditoría envíos D',       '95900096', now())
) AS v(s, cuenta, apellido, dni, creado);

DO $$
DECLARE
    D1 CONSTANT UUID := pg_temp.u('01');
    D2 CONSTANT UUID := pg_temp.u('02');
    v_alta JSONB;
    v_op UUID;
BEGIN
    -- 10.1 Promoción a DIRECTOR.
    PERFORM pg_temp.esperar(pg_temp.rol(D1, pg_temp.u('e0'), 'PERSONAL', 'DIRECTOR'), 'E:P5913', '46 DIRECTOR sin cuenta');
    PERFORM pg_temp.esperar(pg_temp.rol(D1, pg_temp.u('e3'), 'PERSONAL', 'DIRECTOR'), 'E:P5913', '46 DIRECTOR sin confirmar');
    PERFORM pg_temp.exigir(pg_temp.rol_de(pg_temp.u('e0')) = 'PERSONAL' AND pg_temp.historial(pg_temp.u('e0')) = 0
                           AND pg_temp.rol_de(pg_temp.u('e3')) = 'PERSONAL',
        '46 un rechazo cambió el rol o escribió historial');
    PERFORM pg_temp.ok('46: solo una cuenta confirmada recibe el rol DIRECTOR (P5913), sin cambios parciales');

    -- 10.2 Perfil huérfano: una cuenta nueva con su `user_id` no lo adopta.
    v_alta := pg_catalog.jsonb_build_object('ept_alta', pg_catalog.jsonb_build_object(
        'nombre', 'Prueba', 'apellido', 'Auditoría huérfano', 'dni', '95900092',
        'rol_id', (SELECT id FROM public.roles WHERE nombre = 'PERSONAL')));
    PERFORM pg_temp.esperar(pg_temp.intentar_alta(pg_temp.u('e1'), 'huerfano@ept59.invalid', v_alta), 'E:P5914', '47 adopción de huérfano');
    PERFORM pg_temp.exigir(NOT EXISTS (SELECT 1 FROM auth.users WHERE id = pg_temp.u('e1'))
                           AND (SELECT user_id FROM public.perfiles WHERE id = pg_temp.u('e1')) = pg_temp.u('e1'),
        '47 quedó una cuenta o cambió el perfil');

    -- El alta legítima sigue creando su perfil y es idempotente en su misma transacción.
    v_alta := pg_catalog.jsonb_build_object('ept_alta', pg_catalog.jsonb_build_object(
        'nombre', 'Prueba', 'apellido', 'Auditoría alta nueva', 'dni', '95900097',
        'rol_id', (SELECT id FROM public.roles WHERE nombre = 'PERSONAL')));
    PERFORM pg_temp.esperar(pg_temp.intentar_alta(pg_temp.u('e2'), 'alta.nueva@ept59.invalid', v_alta), 'OK:', '47 alta nueva');
    SET LOCAL ROLE supabase_auth_admin;
    UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data || v_alta WHERE id = pg_temp.u('e2');
    RESET ROLE;
    PERFORM pg_temp.exigir((SELECT pg_catalog.count(*) FROM public.perfiles WHERE user_id = pg_temp.u('e2')) = 1,
        '47 el alta nueva no quedó con exactamente un perfil');
    PERFORM pg_temp.ok('47: el alta atómica no entrega un perfil huérfano (P5914) y conserva su idempotencia');

    -- 10.3 Tope por correo: 10 envíos por hora sumando operaciones.
    FOREACH v_op IN ARRAY ARRAY[pg_temp.u('b5'), pg_temp.u('b6')] LOOP
        PERFORM pg_temp.esperar(pg_temp.reservar(D1, v_op,
            CASE WHEN v_op = pg_temp.u('b5') THEN pg_temp.u('e5') ELSE pg_temp.u('e6') END,
            CASE WHEN v_op = pg_temp.u('b5') THEN '95900093' ELSE '95900094' END), 'OK:PENDIENTE|5', '48 reserva');
        FOR i IN 1..5 LOOP
            PERFORM pg_temp.esperar(pg_temp.emitir(v_op, D1, 'inundado@ept59.invalid'), 'OK:inundado@ept59.invalid', '48 envío ' || i);
        END LOOP;
        PERFORM pg_temp.esperar(pg_temp.emitir(v_op, D1, 'inundado@ept59.invalid'), 'E:P5932', '48 sexto envío de la operación');
        PERFORM pg_temp.esperar(pg_temp.ejecutar('authenticated', D1,
            pg_catalog.format('SELECT estado FROM public.cancelar_vinculo(%L)', v_op)), 'OK', '48 cancelar');
    END LOOP;
    PERFORM pg_temp.esperar(pg_temp.reservar(D1, pg_temp.u('b7'), pg_temp.u('e7'), '95900095'), 'OK:PENDIENTE|5', '48 reserva C');
    PERFORM pg_temp.esperar(pg_temp.emitir(pg_temp.u('b7'), D1, 'inundado@ept59.invalid'), 'E:P5932', '48 undécimo envío al mismo correo');
    PERFORM pg_temp.esperar(pg_temp.emitir(pg_temp.u('b7'), D1, 'otro.buzon@ept59.invalid'), 'OK:otro.buzon@ept59.invalid', '48 otro correo sigue permitido');
    PERFORM pg_temp.ok('48: un correo recibe como máximo 10 códigos por hora aunque se cancele y se reserve de nuevo');

    -- 10.4 Tope por Director: 60 envíos por hora, sumando operaciones.
    -- Se descuenta lo que D2 ya envió en esta transacción para llegar justo a 60.
    INSERT INTO app_private.vinculos_cuenta (operacion_id, perfil_id, director_perfil_id, modalidad,
        documento_verificado_en, estado, vence_en, correo, desafio_emitido_en, desafios_emitidos)
    SELECT gen_random_uuid(), pg_temp.u('e8'), D2, 'TITULAR', now(), 'CANCELADA', now() + INTERVAL '15 minutes',
           'tope.' || g || '@ept59.invalid', now(), 1
    FROM pg_catalog.generate_series(1, 60 - (
        SELECT COALESCE(SUM(v.desafios_emitidos), 0)::INTEGER FROM app_private.vinculos_cuenta v
        WHERE v.director_perfil_id = D2 AND v.desafio_emitido_en > now() - INTERVAL '1 hour')) AS g;
    PERFORM pg_temp.esperar(pg_temp.reservar(D2, pg_temp.u('b8'), pg_temp.u('e8'), '95900096'), 'OK:PENDIENTE|5', '49 reserva');
    PERFORM pg_temp.esperar(pg_temp.emitir(pg_temp.u('b8'), D2, 'director.tope@ept59.invalid'), 'E:P5932', '49 envío 61 del Director');
    PERFORM pg_temp.ok('49: un Director envía a lo sumo 60 códigos por hora, sumando operaciones');

    -- 10.5 Ronda 2 (A1): un rol de aplicación no fija `fecha_creacion` al insertar.
    PERFORM pg_temp.esperar(pg_temp.ejecutar('authenticated', D1, pg_catalog.format(
        'INSERT INTO public.perfiles (nombre, apellido, dni, rol_id, fecha_creacion) '
        'VALUES (''Prueba'', ''Fecha futura'', ''95900098'', (SELECT id FROM public.roles WHERE nombre = ''PERSONAL''), %L) '
        'RETURNING (fecha_creacion = transaction_timestamp())::TEXT', '2099-01-01T00:00:00Z')), 'OK:true', '50 fecha forzada');
    PERFORM pg_temp.ok('50: al insertar un legajo, la base fija fecha_creacion aunque el cliente envíe otra');
END $$;

\o
SELECT 'Resumen EPT-59: ' || pg_catalog.count(*) || ' evaluaciones de la matriz registradas.' FROM resultados;

ROLLBACK;
