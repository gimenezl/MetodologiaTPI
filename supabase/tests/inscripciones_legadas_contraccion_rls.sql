-- ============================================================
-- EDUCAR PARA TRANSFORMAR — Inscripciones legadas, CONTRACCIÓN (EPT-66)
-- ============================================================
-- Ejecutar exclusivamente contra una base local descartable con las DOS
-- migraciones de EPT-66 aplicadas (expansión y contracción). Todo ocurre dentro de
-- una transacción con ROLLBACK: nunca confirma datos.
--
--     psql -v ON_ERROR_STOP=1 -f supabase/tests/inscripciones_legadas_contraccion_rls.sql
--
-- Cada comprobación imprime `OK <n>` o aborta con `FALLO <n>`. Con la contracción
-- sin aplicar, la suite se omite de forma explícita (ver inscripciones_legadas_expansion_rls.sql).
--
-- Cubre: escritura directa y DELETE cerrados para todos los roles (incluido el
-- propietario por trigger), lectura acotada (propio, hijo vinculado, hijo ajeno,
-- alumno ajeno, Dirección, DOCENTE, PERSONAL, sin perfil, cuenta bloqueada y
-- anónimo), fila BAJA inmutable, RPC operativas, cupos agregados, privilegios de
-- galería, menú y noticias, INSERT públicos de los formularios y privilegios por
-- defecto.

\set ON_ERROR_STOP on

SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_policies
               WHERE schemaname = 'public' AND tablename = 'inscripciones'
                 AND policyname = 'Dirección consulta las inscripciones') AS contraida \gset
\if :contraida
\else
    \echo 'OMITIDA: la contracción de EPT-66 todavía no está aplicada; corresponde inscripciones_legadas_expansion_rls.sql'
    \quit
\endif

BEGIN;

-- ================================================================
-- ARNÉS DE LA PRUEBA
-- ================================================================
CREATE SCHEMA ept66_t;
GRANT USAGE ON SCHEMA ept66_t TO PUBLIC;

CREATE FUNCTION ept66_t.como(p_sub UUID, p_rol TEXT, p_sql TEXT) RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE
    v_resultado TEXT;
BEGIN
    PERFORM pg_catalog.set_config(
        'request.jwt.claims',
        pg_catalog.json_build_object('sub', p_sub, 'role', p_rol)::TEXT,
        TRUE);
    EXECUTE pg_catalog.format('SET LOCAL ROLE %I', p_rol);
    BEGIN
        EXECUTE p_sql;
        v_resultado := 'OK';
    EXCEPTION WHEN OTHERS THEN
        v_resultado := SQLSTATE;
    END;
    RESET ROLE;
    PERFORM pg_catalog.set_config('request.jwt.claims', '', TRUE);
    RETURN v_resultado;
END;
$$;

CREATE FUNCTION ept66_t.valor(p_sub UUID, p_rol TEXT, p_sql TEXT) RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE
    v_valor TEXT;
BEGIN
    PERFORM pg_catalog.set_config(
        'request.jwt.claims',
        pg_catalog.json_build_object('sub', p_sub, 'role', p_rol)::TEXT,
        TRUE);
    EXECUTE pg_catalog.format('SET LOCAL ROLE %I', p_rol);
    BEGIN
        EXECUTE p_sql INTO v_valor;
    EXCEPTION WHEN OTHERS THEN
        v_valor := 'ERR:' || SQLSTATE;
    END;
    RESET ROLE;
    PERFORM pg_catalog.set_config('request.jwt.claims', '', TRUE);
    RETURN v_valor;
END;
$$;

-- Como el propietario (sin cambiar de rol): 'OK' o el SQLSTATE.
CREATE FUNCTION ept66_t.propietario(p_sql TEXT) RETURNS TEXT
LANGUAGE plpgsql AS $$
BEGIN
    BEGIN
        EXECUTE p_sql;
        RETURN 'OK';
    EXCEPTION WHEN OTHERS THEN
        RETURN SQLSTATE;
    END;
END;
$$;

CREATE FUNCTION ept66_t.afirmar(p_numero TEXT, p_obtenido TEXT, p_esperado TEXT) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
    IF p_obtenido IS DISTINCT FROM p_esperado THEN
        RAISE EXCEPTION 'FALLO %: se esperaba «%» y se obtuvo «%»', p_numero, p_esperado, p_obtenido;
    END IF;
    RAISE NOTICE 'OK %', p_numero;
END;
$$;

-- ================================================================
-- DATOS SINTÉTICOS (rango de DNI reservado 97…, nunca datos reales)
-- ================================================================
INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni, legajo_nro)
SELECT v.id, v.id, r.id, 'Prueba', v.apellido, v.dni, v.legajo
FROM (VALUES
    ('a6600000-0000-4000-8000-000000000001'::UUID, 'DIRECTOR',   'Directora',   '97660001', NULL),
    ('a6600000-0000-4000-8000-000000000002'::UUID, 'ESTUDIANTE', 'Propio',      '97660002', 'LEG-66-02'),
    ('a6600000-0000-4000-8000-000000000003'::UUID, 'ESTUDIANTE', 'Ajeno',       '97660003', 'LEG-66-03'),
    ('a6600000-0000-4000-8000-000000000004'::UUID, 'PADRE',      'Vinculado',   '97660004', NULL),
    ('a6600000-0000-4000-8000-000000000005'::UUID, 'PADRE',      'SinHijos',    '97660005', NULL),
    ('a6600000-0000-4000-8000-000000000006'::UUID, 'DOCENTE',    'Docente',     '97660006', NULL),
    ('a6600000-0000-4000-8000-000000000007'::UUID, 'PERSONAL',   'Personal',    '97660007', NULL),
    ('a6600000-0000-4000-8000-000000000008'::UUID, 'ESTUDIANTE', 'Bloqueado',   '97660008', 'LEG-66-08'),
    ('a6600000-0000-4000-8000-000000000009'::UUID, 'PADRE',      'Bloqueado',   '97660009', NULL),
    ('a6600000-0000-4000-8000-000000000010'::UUID, 'ESTUDIANTE', 'Hermano',     '97660010', 'LEG-66-10')
) AS v(id, rol, apellido, dni, legajo)
JOIN public.roles r ON r.nombre = v.rol;

INSERT INTO public.padres_hijos (padre_id, hijo_id) VALUES
    ('a6600000-0000-4000-8000-000000000004', 'a6600000-0000-4000-8000-000000000002'),
    ('a6600000-0000-4000-8000-000000000004', 'a6600000-0000-4000-8000-000000000010');

UPDATE public.perfiles SET estado_acceso = 'BLOQUEADO'
WHERE id IN ('a6600000-0000-4000-8000-000000000008', 'a6600000-0000-4000-8000-000000000009');

INSERT INTO public.actividades (id, nombre, tipo, cupo_maximo, activo) VALUES
    (96601, 'Taller EPT-66 de un lugar', 'TALLER', 1, TRUE),
    (96602, 'Taller EPT-66 de dos lugares', 'TALLER', 2, TRUE),
    (96603, 'Deporte EPT-66', 'DEPORTE', 5, TRUE),
    (96606, 'Taller EPT-66 que se elimina', 'TALLER', 5, TRUE),
    (96607, 'Taller EPT-66 de reinscripción', 'TALLER', 3, TRUE);

-- Filas sembradas por el propietario SIN pasar por las funciones (como los datos
-- legados): ACTIVO del propio, ACTIVO del hermano, dos ACTIVO del ajeno y dos BAJA
-- anteriores a EPT-66 (sin fecha_baja) del ajeno.
INSERT INTO public.inscripciones (id, estudiante_id, actividad_id, estado) VALUES
    ('b6600000-0000-4000-8000-000000000011', 'a6600000-0000-4000-8000-000000000002', 96602, 'ACTIVO'),
    ('b6600000-0000-4000-8000-000000000012', 'a6600000-0000-4000-8000-000000000010', 96602, 'ACTIVO'),
    ('b6600000-0000-4000-8000-000000000013', 'a6600000-0000-4000-8000-000000000003', 96601, 'ACTIVO'),
    ('b6600000-0000-4000-8000-000000000014', 'a6600000-0000-4000-8000-000000000003', 96602, 'BAJA'),
    ('b6600000-0000-4000-8000-000000000015', 'a6600000-0000-4000-8000-000000000003', 96606, 'ACTIVO'),
    ('b6600000-0000-4000-8000-000000000016', 'a6600000-0000-4000-8000-000000000003', 96607, 'BAJA');

CREATE TEMPORARY TABLE ept66_huella_previa ON COMMIT DROP AS
SELECT id, estudiante_id, actividad_id, estado, fecha_inscripcion
FROM public.inscripciones WHERE id = 'b6600000-0000-4000-8000-000000000014';

CREATE FUNCTION ept66_t.dir() RETURNS UUID LANGUAGE sql IMMUTABLE AS $$ SELECT 'a6600000-0000-4000-8000-000000000001'::UUID $$;
CREATE FUNCTION ept66_t.propio() RETURNS UUID LANGUAGE sql IMMUTABLE AS $$ SELECT 'a6600000-0000-4000-8000-000000000002'::UUID $$;
CREATE FUNCTION ept66_t.ajeno() RETURNS UUID LANGUAGE sql IMMUTABLE AS $$ SELECT 'a6600000-0000-4000-8000-000000000003'::UUID $$;
CREATE FUNCTION ept66_t.padre() RETURNS UUID LANGUAGE sql IMMUTABLE AS $$ SELECT 'a6600000-0000-4000-8000-000000000004'::UUID $$;
CREATE FUNCTION ept66_t.padre_sin_hijos() RETURNS UUID LANGUAGE sql IMMUTABLE AS $$ SELECT 'a6600000-0000-4000-8000-000000000005'::UUID $$;
CREATE FUNCTION ept66_t.docente() RETURNS UUID LANGUAGE sql IMMUTABLE AS $$ SELECT 'a6600000-0000-4000-8000-000000000006'::UUID $$;
CREATE FUNCTION ept66_t.personal() RETURNS UUID LANGUAGE sql IMMUTABLE AS $$ SELECT 'a6600000-0000-4000-8000-000000000007'::UUID $$;
CREATE FUNCTION ept66_t.alumno_bloqueado() RETURNS UUID LANGUAGE sql IMMUTABLE AS $$ SELECT 'a6600000-0000-4000-8000-000000000008'::UUID $$;
CREATE FUNCTION ept66_t.padre_bloqueado() RETURNS UUID LANGUAGE sql IMMUTABLE AS $$ SELECT 'a6600000-0000-4000-8000-000000000009'::UUID $$;
CREATE FUNCTION ept66_t.hermano() RETURNS UUID LANGUAGE sql IMMUTABLE AS $$ SELECT 'a6600000-0000-4000-8000-000000000010'::UUID $$;
CREATE FUNCTION ept66_t.sin_perfil() RETURNS UUID LANGUAGE sql IMMUTABLE AS $$ SELECT 'a6600000-0000-4000-8000-0000000000ff'::UUID $$;

-- ================================================================
-- 1. ESTRUCTURA Y PRIVILEGIOS
-- ================================================================
SELECT ept66_t.afirmar('1a políticas exactas de inscripciones',
    (SELECT pg_catalog.string_agg(polname, ' | ' ORDER BY polname) FROM pg_catalog.pg_policy
     WHERE polrelid = 'public.inscripciones'::pg_catalog.regclass),
    'Alumno consulta sus inscripciones | Bloqueo de acceso sin datos protegidos | Dirección consulta las inscripciones | Padre consulta las inscripciones de sus hijos');
SELECT ept66_t.afirmar('1b ya no existe la lectura global USING (true)',
    (SELECT pg_catalog.count(*)::TEXT FROM pg_catalog.pg_policy
     WHERE polrelid = 'public.inscripciones'::pg_catalog.regclass
       AND pg_catalog.pg_get_expr(polqual, polrelid) = 'true'), '0');
SELECT ept66_t.afirmar('1c ninguna política de escritura queda, salvo la restrictiva de bloqueo',
    (SELECT pg_catalog.count(*)::TEXT FROM pg_catalog.pg_policy
     WHERE polrelid = 'public.inscripciones'::pg_catalog.regclass
       AND polcmd IN ('a', 'w', 'd') AND polpermissive), '0');
SELECT ept66_t.afirmar('1d privilegios de tabla: anon ninguno',
    (SELECT pg_catalog.count(*)::TEXT FROM pg_catalog.unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
     WHERE pg_catalog.has_table_privilege('anon', 'public.inscripciones', p)), '0');
SELECT ept66_t.afirmar('1e privilegios de tabla: authenticated solo SELECT',
    (SELECT pg_catalog.string_agg(p, ',' ORDER BY p) FROM pg_catalog.unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
     WHERE pg_catalog.has_table_privilege('authenticated', 'public.inscripciones', p)), 'SELECT');
SELECT ept66_t.afirmar('1f privilegios de tabla: service_role solo SELECT',
    (SELECT pg_catalog.string_agg(p, ',' ORDER BY p) FROM pg_catalog.unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
     WHERE pg_catalog.has_table_privilege('service_role', 'public.inscripciones', p)), 'SELECT');
SELECT ept66_t.afirmar('1g los cinco triggers de inscripciones existen y están habilitados',
    (SELECT pg_catalog.string_agg(tgname, ',' ORDER BY tgname) FROM pg_catalog.pg_trigger
     WHERE tgrelid = 'public.inscripciones'::pg_catalog.regclass AND NOT tgisinternal AND tgenabled = 'O'),
    'bloquear_inscripcion_deportiva_legada,impedir_borrado_inscripcion_legada,impedir_vaciado_inscripciones_legadas,proteger_inscripcion_legada,trigger_verificar_cupo');

-- ================================================================
-- 2. LECTURA DIRECTA ACOTADA (SELECT sobre la tabla)
-- ================================================================
-- Filas sembradas: propio 1 ACTIVO · hermano 1 ACTIVO · ajeno 2 ACTIVO + 2 BAJA.
SELECT ept66_t.afirmar('2a el alumno propio ve solo lo suyo (1 fila)',
    ept66_t.valor(ept66_t.propio(), 'authenticated', $q$SELECT pg_catalog.count(*)::TEXT FROM public.inscripciones$q$), '1');
SELECT ept66_t.afirmar('2b el alumno propio no ve filas ajenas',
    ept66_t.valor(ept66_t.propio(), 'authenticated',
        pg_catalog.format($q$SELECT pg_catalog.count(*)::TEXT FROM public.inscripciones WHERE estudiante_id = %L$q$, ept66_t.ajeno())), '0');
SELECT ept66_t.afirmar('2c el padre ve las inscripciones de sus dos hijos vinculados y ninguna del ajeno',
    ept66_t.valor(ept66_t.padre(), 'authenticated',
        $q$SELECT pg_catalog.count(*)::TEXT || '/' || pg_catalog.count(*) FILTER (WHERE estudiante_id = 'a6600000-0000-4000-8000-000000000003')::TEXT FROM public.inscripciones$q$), '2/0');
SELECT ept66_t.afirmar('2d un padre sin hijos no ve ninguna',
    ept66_t.valor(ept66_t.padre_sin_hijos(), 'authenticated', $q$SELECT pg_catalog.count(*)::TEXT FROM public.inscripciones$q$), '0');
SELECT ept66_t.afirmar('2e un alumno ajeno ve solo lo suyo (4 filas, ninguna de propio ni hermano)',
    ept66_t.valor(ept66_t.ajeno(), 'authenticated',
        $q$SELECT pg_catalog.count(*)::TEXT || '/' || pg_catalog.count(*) FILTER (WHERE estudiante_id <> 'a6600000-0000-4000-8000-000000000003')::TEXT FROM public.inscripciones$q$), '4/0');
SELECT ept66_t.afirmar('2f Dirección ve las seis',
    ept66_t.valor(ept66_t.dir(), 'authenticated', $q$SELECT pg_catalog.count(*)::TEXT FROM public.inscripciones WHERE id::TEXT LIKE 'b6600000%'$q$), '6');
SELECT ept66_t.afirmar('2g DOCENTE no ve ninguna (no existe contrato de alumno a cargo)',
    ept66_t.valor(ept66_t.docente(), 'authenticated', $q$SELECT pg_catalog.count(*)::TEXT FROM public.inscripciones$q$), '0');
SELECT ept66_t.afirmar('2h PERSONAL no ve ninguna',
    ept66_t.valor(ept66_t.personal(), 'authenticated', $q$SELECT pg_catalog.count(*)::TEXT FROM public.inscripciones$q$), '0');
SELECT ept66_t.afirmar('2i una sesión sin perfil no ve ninguna',
    ept66_t.valor(ept66_t.sin_perfil(), 'authenticated', $q$SELECT pg_catalog.count(*)::TEXT FROM public.inscripciones$q$), '0');
SELECT ept66_t.afirmar('2j un alumno BLOQUEADO no ve ninguna',
    ept66_t.valor(ept66_t.alumno_bloqueado(), 'authenticated', $q$SELECT pg_catalog.count(*)::TEXT FROM public.inscripciones$q$), '0');
SELECT ept66_t.afirmar('2k un padre BLOQUEADO no ve las de su hijo',
    ept66_t.valor(ept66_t.padre_bloqueado(), 'authenticated', $q$SELECT pg_catalog.count(*)::TEXT FROM public.inscripciones$q$), '0');
SELECT ept66_t.afirmar('2l el anónimo no puede leer la tabla (42501)',
    ept66_t.valor(NULL, 'anon', $q$SELECT pg_catalog.count(*)::TEXT FROM public.inscripciones$q$), 'ERR:42501');

-- ================================================================
-- 3. ESCRITURA DIRECTA CERRADA PARA TODOS LOS ROLES
-- ================================================================
CREATE FUNCTION ept66_t.ins() RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
    SELECT $q$INSERT INTO public.inscripciones (estudiante_id, actividad_id, estado) VALUES ('a6600000-0000-4000-8000-000000000002', 96602, 'ACTIVO')$q$ $$;
CREATE FUNCTION ept66_t.upd() RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
    SELECT $q$UPDATE public.inscripciones SET estado = 'BAJA' WHERE id = 'b6600000-0000-4000-8000-000000000011'$q$ $$;
CREATE FUNCTION ept66_t.del() RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
    SELECT $q$DELETE FROM public.inscripciones WHERE id = 'b6600000-0000-4000-8000-000000000011'$q$ $$;
CREATE FUNCTION ept66_t.trunc() RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
    SELECT $q$TRUNCATE public.inscripciones$q$ $$;

SELECT ept66_t.afirmar('3a ' || a.etiqueta || ' no inserta, actualiza, borra ni vacía (42501 en las cuatro)',
    ept66_t.como(a.sub, a.rol, ept66_t.ins()) || '/' || ept66_t.como(a.sub, a.rol, ept66_t.upd()) || '/' ||
    ept66_t.como(a.sub, a.rol, ept66_t.del()) || '/' || ept66_t.como(a.sub, a.rol, ept66_t.trunc()),
    '42501/42501/42501/42501')
FROM (VALUES
    ('anon', NULL::UUID, 'anon'),
    ('el alumno propio', ept66_t.propio(), 'authenticated'),
    ('el padre vinculado', ept66_t.padre(), 'authenticated'),
    ('Dirección', ept66_t.dir(), 'authenticated'),
    ('DOCENTE', ept66_t.docente(), 'authenticated'),
    ('PERSONAL', ept66_t.personal(), 'authenticated'),
    ('service_role', NULL::UUID, 'service_role')
) AS a(etiqueta, sub, rol);

SELECT ept66_t.afirmar('3b las filas sembradas siguen idénticas tras todos los intentos',
    (SELECT pg_catalog.count(*)::TEXT FROM public.inscripciones WHERE id::TEXT LIKE 'b6600000%' AND estado IN ('ACTIVO', 'BAJA')), '6');

-- ================================================================
-- 4. NI EL PROPIETARIO BORRA O REESCRIBE LA HISTORIA
-- ================================================================
SELECT ept66_t.afirmar('4a el propietario no borra una inscripción (P6608)', ept66_t.propietario(ept66_t.del()), 'P6608');
SELECT ept66_t.afirmar('4b el propietario no vacía la tabla (P6608)', ept66_t.propietario(ept66_t.trunc()), 'P6608');
SELECT ept66_t.afirmar('4c la fila BAJA no se reactiva (P6609)',
    ept66_t.propietario($q$UPDATE public.inscripciones SET estado = 'ACTIVO' WHERE id = 'b6600000-0000-4000-8000-000000000014'$q$), 'P6609');
SELECT ept66_t.afirmar('4d la fila BAJA no cambia ningún dato (P6609)',
    ept66_t.propietario($q$UPDATE public.inscripciones SET fecha_baja = pg_catalog.now() WHERE id = 'b6600000-0000-4000-8000-000000000014'$q$), 'P6609');
SELECT ept66_t.afirmar('4e una fila ACTIVO no cambia de alumno (P6609)',
    ept66_t.propietario($q$UPDATE public.inscripciones SET estudiante_id = 'a6600000-0000-4000-8000-000000000003' WHERE id = 'b6600000-0000-4000-8000-000000000011'$q$), 'P6609');
SELECT ept66_t.afirmar('4f una fila ACTIVO no cambia de actividad (P6609)',
    ept66_t.propietario($q$UPDATE public.inscripciones SET actividad_id = 96601 WHERE id = 'b6600000-0000-4000-8000-000000000011'$q$), 'P6609');
SELECT ept66_t.afirmar('4g una fila ACTIVO no cambia su fecha de inscripción (P6609)',
    ept66_t.propietario($q$UPDATE public.inscripciones SET fecha_inscripcion = now() - interval '1 year' WHERE id = 'b6600000-0000-4000-8000-000000000011'$q$), 'P6609');
SELECT ept66_t.afirmar('4h la fila BAJA anterior a EPT-66 quedó intacta',
    (SELECT (i.id = h.id AND i.estudiante_id = h.estudiante_id AND i.actividad_id = h.actividad_id
             AND i.estado = h.estado AND i.fecha_inscripcion = h.fecha_inscripcion AND i.fecha_baja IS NULL)::TEXT
     FROM public.inscripciones i JOIN ept66_huella_previa h USING (id)), 'true');
SELECT ept66_t.afirmar('4i un UPDATE directo a BAJA registra la fecha de baja',
    ept66_t.propietario($q$UPDATE public.inscripciones SET estado = 'BAJA' WHERE id = 'b6600000-0000-4000-8000-000000000012'$q$), 'OK');
SELECT ept66_t.afirmar('4j …y la fecha quedó registrada',
    (SELECT (estado = 'BAJA' AND fecha_baja IS NOT NULL)::TEXT FROM public.inscripciones
     WHERE id = 'b6600000-0000-4000-8000-000000000012'), 'true');
-- Se restaura el estado del hermano para las pruebas siguientes.
ALTER TABLE public.inscripciones DISABLE TRIGGER USER;
UPDATE public.inscripciones SET estado = 'ACTIVO', fecha_baja = NULL WHERE id = 'b6600000-0000-4000-8000-000000000012';
ALTER TABLE public.inscripciones ENABLE TRIGGER USER;

-- El borrado en cascada de una actividad (no es un DELETE de aplicación) sigue
-- siendo posible: es la vía con la que se limpian los datos de prueba.
SELECT ept66_t.afirmar('4k eliminar una actividad arrastra sus inscripciones por cascada (no es un DELETE directo)',
    ept66_t.propietario($q$DELETE FROM public.actividades WHERE id = 96606$q$), 'OK');
SELECT ept66_t.afirmar('4l …y la inscripción de esa actividad se fue con ella',
    (SELECT pg_catalog.count(*)::TEXT FROM public.inscripciones WHERE id = 'b6600000-0000-4000-8000-000000000015'), '0');

-- ================================================================
-- 5. LAS FUNCIONES SIGUEN OPERANDO
-- ================================================================
-- Se libera la actividad de un lugar (96601) del ajeno por la función.
SELECT ept66_t.afirmar('5a el alumno ajeno da de baja su inscripción (función)',
    ept66_t.como(ept66_t.ajeno(), 'authenticated', $q$SELECT public.dar_baja_inscripcion_legada('b6600000-0000-4000-8000-000000000013')$q$), 'OK');
SELECT ept66_t.afirmar('5b …la fila se conserva como BAJA con fecha',
    (SELECT (estado = 'BAJA' AND fecha_baja IS NOT NULL)::TEXT FROM public.inscripciones WHERE id = 'b6600000-0000-4000-8000-000000000013'), 'true');
SELECT ept66_t.afirmar('5c el alumno propio se inscribe a la actividad liberada',
    ept66_t.como(ept66_t.propio(), 'authenticated',
        pg_catalog.format($q$SELECT public.inscribir_actividad_legada(%L, 96601)$q$, ept66_t.propio())), 'OK');
SELECT ept66_t.afirmar('5d cupo completo para otro alumno (23514)',
    ept66_t.como(ept66_t.ajeno(), 'authenticated',
        pg_catalog.format($q$SELECT public.inscribir_actividad_legada(%L, 96601)$q$, ept66_t.ajeno())), '23514');
SELECT ept66_t.afirmar('5e reinscripción: el alumno ajeno vuelve a una actividad donde tenía una BAJA',
    ept66_t.como(ept66_t.ajeno(), 'authenticated',
        pg_catalog.format($q$SELECT public.inscribir_actividad_legada(%L, 96607)$q$, ept66_t.ajeno())), 'OK');
SELECT ept66_t.afirmar('5e2 …como fila NUEVA: dos filas (una ACTIVO, la BAJA anterior intacta con el mismo id)',
    (SELECT pg_catalog.count(*)::TEXT || '/' || pg_catalog.count(*) FILTER (WHERE estado = 'ACTIVO')::TEXT || '/' ||
            pg_catalog.count(*) FILTER (WHERE id = 'b6600000-0000-4000-8000-000000000016' AND estado = 'BAJA')::TEXT
     FROM public.inscripciones WHERE estudiante_id = ept66_t.ajeno() AND actividad_id = 96607), '2/1/1');
SELECT ept66_t.afirmar('5f el padre inscribe a su hijo vinculado y no al ajeno',
    ept66_t.como(ept66_t.padre(), 'authenticated',
        pg_catalog.format($q$SELECT public.inscribir_actividad_legada(%L, 96601)$q$, ept66_t.ajeno())), 'P6602');
SELECT ept66_t.afirmar('5g Dirección lee el listado de un alumno',
    ept66_t.valor(ept66_t.dir(), 'authenticated',
        pg_catalog.format($q$SELECT pg_catalog.count(*)::TEXT FROM public.listar_inscripciones_actividades_legadas(%L, TRUE)$q$, ept66_t.ajeno())), '4');
SELECT ept66_t.afirmar('5h DOCENTE sigue recibiendo 42501 en las funciones',
    ept66_t.como(ept66_t.docente(), 'authenticated',
        pg_catalog.format($q$SELECT public.inscribir_actividad_legada(%L, 96602)$q$, ept66_t.propio())), '42501');
SELECT ept66_t.afirmar('5i el anónimo no ejecuta las funciones (42501)',
    ept66_t.como(NULL, 'anon',
        pg_catalog.format($q$SELECT public.inscribir_actividad_legada(%L, 96602)$q$, ept66_t.propio())), '42501');
SELECT ept66_t.afirmar('5j una cuenta bloqueada no ejecuta las funciones (42501)',
    ept66_t.como(ept66_t.padre_bloqueado(), 'authenticated',
        pg_catalog.format($q$SELECT public.inscribir_actividad_legada(%L, 96602)$q$, ept66_t.hermano())), '42501');

-- ================================================================
-- 6. CUPOS AGREGADOS (sin pares alumno–actividad) PARA CUALQUIER CUENTA HABILITADA
-- ================================================================
SELECT ept66_t.afirmar('6a DOCENTE consulta los cupos agregados',
    ept66_t.valor(ept66_t.docente(), 'authenticated',
        $q$SELECT (pg_catalog.count(*) > 0)::TEXT FROM public.consultar_cupos_actividades_legadas()$q$), 'true');
SELECT ept66_t.afirmar('6b el conteo agregado coincide con las inscripciones activas aunque el rol no las vea',
    ept66_t.valor(ept66_t.docente(), 'authenticated',
        $q$SELECT inscriptos::TEXT FROM public.consultar_cupos_actividades_legadas() WHERE actividad_id = 96602$q$),
    (SELECT pg_catalog.count(*)::TEXT FROM public.inscripciones WHERE actividad_id = 96602 AND estado = 'ACTIVO'));

-- ================================================================
-- 7. galeria, menu_escolar Y noticias: SOLO LECTURA
-- ================================================================
SELECT ept66_t.afirmar('7a anon y authenticated solo conservan SELECT en galería, menú y noticias',
    (SELECT pg_catalog.count(*)::TEXT
     FROM (VALUES ('public.galeria'), ('public.menu_escolar'), ('public.noticias')) t(tabla)
     CROSS JOIN (VALUES ('anon'), ('authenticated')) r(rol)
     CROSS JOIN pg_catalog.unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
     WHERE pg_catalog.has_table_privilege(r.rol, t.tabla, p)), '0');
SELECT ept66_t.afirmar('7b anon sigue leyendo galería, menú y noticias',
    ept66_t.como(NULL, 'anon', $q$SELECT 1 FROM public.galeria LIMIT 1$q$) || '/' ||
    ept66_t.como(NULL, 'anon', $q$SELECT 1 FROM public.menu_escolar LIMIT 1$q$) || '/' ||
    ept66_t.como(NULL, 'anon', $q$SELECT 1 FROM public.noticias LIMIT 1$q$), 'OK/OK/OK');
SELECT ept66_t.afirmar('7c anon no vacía ni borra galería, menú ni noticias (42501)',
    ept66_t.como(NULL, 'anon', $q$TRUNCATE public.galeria$q$) || '/' ||
    ept66_t.como(NULL, 'anon', $q$DELETE FROM public.menu_escolar$q$) || '/' ||
    ept66_t.como(NULL, 'anon', $q$TRUNCATE public.noticias$q$), '42501/42501/42501');
SELECT ept66_t.afirmar('7d Dirección tampoco escribe galería, menú ni noticias directamente (42501)',
    ept66_t.como(ept66_t.dir(), 'authenticated', $q$INSERT INTO public.noticias (titulo, contenido) VALUES ('x', 'y')$q$) || '/' ||
    ept66_t.como(ept66_t.dir(), 'authenticated', $q$UPDATE public.menu_escolar SET descripcion = descripcion$q$), '42501/42501');

-- ================================================================
-- 8. LOS INSERT PÚBLICOS DE LOS FORMULARIOS SIGUEN EN PIE
-- ================================================================
SELECT ept66_t.afirmar('8a anon envía una solicitud de inscripción',
    ept66_t.como(NULL, 'anon', $q$INSERT INTO public.solicitudes_inscripcion (datos_aspirante) VALUES ('{"nombre": "Prueba EPT-66"}')$q$), 'OK');
SELECT ept66_t.afirmar('8b anon envía una postulación laboral',
    ept66_t.como(NULL, 'anon', $q$INSERT INTO public.postulaciones (nombre, apellido, email, telefono, puesto, mensaje) VALUES ('Prueba', 'EPT-66', 'ept66@ejemplo.invalid', '0000', 'Docente', 'Mensaje')$q$), 'OK');
SELECT ept66_t.afirmar('8c anon deja una opinión pendiente',
    ept66_t.como(NULL, 'anon', $q$INSERT INTO public.opiniones (comentario) VALUES ('Opinión de prueba EPT-66 pendiente')$q$), 'OK');

-- ================================================================
-- 9. PRIVILEGIOS POR DEFECTO PARA OBJETOS FUTUROS
-- ================================================================
CREATE TABLE public.ept66_tabla_nueva (id INTEGER PRIMARY KEY);
CREATE SEQUENCE public.ept66_secuencia_nueva;
CREATE FUNCTION public.ept66_funcion_nueva() RETURNS INTEGER LANGUAGE sql AS $$ SELECT 1 $$;

SELECT ept66_t.afirmar('9a una tabla nueva no se otorga a anon ni a authenticated',
    (SELECT pg_catalog.count(*)::TEXT FROM pg_catalog.unnest(ARRAY['anon', 'authenticated']) r
     CROSS JOIN pg_catalog.unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) p
     WHERE pg_catalog.has_table_privilege(r, 'public.ept66_tabla_nueva', p)), '0');
SELECT ept66_t.afirmar('9b una secuencia nueva no se otorga a anon ni a authenticated',
    (SELECT pg_catalog.count(*)::TEXT FROM pg_catalog.unnest(ARRAY['anon', 'authenticated']) r
     CROSS JOIN pg_catalog.unnest(ARRAY['USAGE','SELECT','UPDATE']) p
     WHERE pg_catalog.has_sequence_privilege(r, 'public.ept66_secuencia_nueva', p)), '0');
SELECT ept66_t.afirmar('9c una función nueva no recibe ACL explícita para anon ni authenticated',
    (SELECT (COALESCE(pg_catalog.array_to_string(p.proacl, ','), '') NOT LIKE '%anon=%'
             AND COALESCE(pg_catalog.array_to_string(p.proacl, ','), '') NOT LIKE '%authenticated=%')::TEXT
     FROM pg_catalog.pg_proc p WHERE p.oid = 'public.ept66_funcion_nueva()'::pg_catalog.regprocedure), 'true');
SELECT ept66_t.afirmar('9d service_role conserva el acceso por defecto a una tabla nueva',
    pg_catalog.has_table_privilege('service_role', 'public.ept66_tabla_nueva', 'SELECT')::TEXT, 'true');

-- ================================================================
-- 10. HISTORIA CONSERVADA
-- ================================================================
SELECT ept66_t.afirmar('10a ninguna fila BAJA se perdió: las dos anteriores siguen y la baja por función suma una más',
    (SELECT pg_catalog.count(*)::TEXT FROM public.inscripciones WHERE id::TEXT LIKE 'b6600000%' AND estado = 'BAJA'), '3');

ROLLBACK;
