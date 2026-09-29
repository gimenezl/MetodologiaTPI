-- ============================================================
-- EDUCAR PARA TRANSFORMAR — Verificación de los reportes oficiales (EPT-63, RF17)
-- ============================================================
-- Verifica la migración 20260929012923_ept_63_reportes_oficiales.sql.
--
-- Ejecutar exclusivamente contra la base local descartable. Todo ocurre dentro
-- de una transacción con ROLLBACK: no deja datos residuales.
--
--     docker cp supabase/tests/reportes_oficiales_rls.sql \
--       supabase_db_educar-para-transformar:/tmp/
--     docker exec supabase_db_educar-para-transformar \
--       psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 \
--       -f /tmp/reportes_oficiales_rls.sql
--
-- Cada comprobación imprime `OK <código>` o aborta con `FALLO <código>`. Una
-- recursión de políticas (42P17) cuenta como fallo aunque llegue como
-- «denegación».
--
--   Criterios de RF17 y del contrato aprobado
--     [RF17-cruces]     los reportes admiten cruces entre dimensiones y no multiplican filas
--     [RF17-responsable] «responsable» es el PROFESOR de la materia o del grupo
--     [RF17-origen]     horario y docentes identifican su origen sin mezclar relaciones
--     [RF17-historial]  historial solo donde el esquema lo registra
--     [RF17-privacidad] ningún reporte expone al confirmador ni datos personales sensibles
--     [RF17-seguridad]  solo Dirección, por sesión y por PostgreSQL
--     [RF17-paginacion] orden total, total exacto y páginas sin repetir ni saltear
--
--   Mapa de secciones
--     A. permisos: EXECUTE, RLS y Dirección explícita por función y por actor
--     B. datos correctos por reporte (recuentos exactos sobre datos conocidos)
--     C. cruces: filtros combinables sin duplicar filas
--     D. historial: donde existe, se muestra; donde no, el parámetro no existe
--     E. origen académico y deportivo sin mezclar; docente en ambos orígenes
--     F. privacidad: sin confirmador, sin datos personales sensibles
--     G. paginación y validación de parámetros
--     H. catálogos de los filtros
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
    SELECT ('ea630000-0000-4000-8000-0000000000' || p_sufijo)::UUID;
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

CREATE FUNCTION pg_temp.valor(p_resultado TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
    IF p_resultado NOT LIKE 'OK:%' THEN
        RAISE EXCEPTION 'FALLO se esperaba éxito y se obtuvo %', p_resultado;
    END IF;
    RETURN pg_catalog.substr(p_resultado, 4);
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

-- Ejecuta como la directora habilitada (01) y devuelve OK:<valor> o E:<SQLSTATE>.
CREATE FUNCTION pg_temp.dir(p_sql TEXT)
RETURNS TEXT LANGUAGE sql AS $$
    SELECT pg_temp.ejecutar('authenticated', pg_temp.u('01'), p_sql);
$$;

-- Ejecuta un alta con la RPC real, exige éxito y guarda el identificador devuelto.
CREATE FUNCTION pg_temp.crear(p_clave TEXT, p_sql TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
    v TEXT;
BEGIN
    v := pg_temp.dir(p_sql);
    PERFORM pg_temp.esperar(v, 'OK', 'datos: ' || p_clave);
    PERFORM pg_temp.guardar(p_clave, pg_temp.valor(v));
END;
$$;

CREATE FUNCTION pg_temp.como(p_sufijo TEXT, p_sql TEXT)
RETURNS TEXT LANGUAGE sql AS $$
    SELECT pg_temp.ejecutar('authenticated', pg_temp.u(p_sufijo), p_sql);
$$;

-- ALCANCE: la base puede traer datos de otras suites (identidades y matrículas
-- de Playwright, por ejemplo). Todo lo que crea ESTA prueba lleva la marca
-- «EPT63» —en el legajo de los alumnos y en el nombre de los docentes—, y toda
-- lectura de un reporte que no traiga su propia búsqueda se acota a esa marca.
-- Así los recuentos exactos no dependen de la base en la que se corre.
CREATE FUNCTION pg_temp.acotar(p_llamada TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN p_llamada NOT LIKE 'public.reporte\_%' OR p_llamada LIKE '%p_busqueda%' THEN p_llamada
        WHEN p_llamada LIKE '%()' THEN pg_catalog.regexp_replace(p_llamada, '\(\)$', '(p_busqueda => ''EPT63'')')
        ELSE pg_catalog.regexp_replace(p_llamada, '\(', '(p_busqueda => ''EPT63'', ')
    END;
$$;

-- Filas de un reporte como arreglo JSON, vistas por la directora 01.
-- `p_llamada` es la llamada completa, por ejemplo
-- 'public.reporte_alumnos_curso(p_materia_id => 5)'.
CREATE FUNCTION pg_temp.filas(p_llamada TEXT)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
    v TEXT;
BEGIN
    v := pg_temp.dir(pg_catalog.format(
        'SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(f)), ''[]''::jsonb)::TEXT FROM %s AS f', pg_temp.acotar(p_llamada)));
    IF v NOT LIKE 'OK:%' THEN
        RAISE EXCEPTION 'FALLO la lectura % devolvió %', p_llamada, v;
    END IF;
    RETURN pg_catalog.substr(v, 4)::JSONB;
END;
$$;

CREATE FUNCTION pg_temp.n(p_llamada TEXT)
RETURNS BIGINT LANGUAGE sql AS $$
    SELECT pg_catalog.jsonb_array_length(pg_temp.filas(p_llamada));
$$;

-- Cantidad de identificadores DISTINTOS: si difiere de `n`, hay filas repetidas.
CREATE FUNCTION pg_temp.n_distintas(p_llamada TEXT)
RETURNS BIGINT LANGUAGE sql AS $$
    SELECT pg_catalog.count(DISTINCT e ->> 'id')
    FROM pg_catalog.jsonb_array_elements(pg_temp.filas(p_llamada)) AS e;
$$;

CREATE FUNCTION pg_temp.total(p_llamada TEXT)
RETURNS BIGINT LANGUAGE sql AS $$
    SELECT COALESCE(pg_catalog.max((e ->> 'total_filas')::BIGINT), 0)
    FROM pg_catalog.jsonb_array_elements(pg_temp.filas(p_llamada)) AS e;
$$;

-- Verifica el recuento exacto Y que ninguna fila se repite ni el total miente.
CREATE FUNCTION pg_temp.contar(p_llamada TEXT, p_esperado BIGINT, p_mensaje TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
    v_n BIGINT := pg_temp.n(p_llamada);
BEGIN
    IF v_n <> p_esperado THEN
        RAISE EXCEPTION 'FALLO % → % filas, se esperaban %', p_mensaje, v_n, p_esperado;
    END IF;
    IF pg_temp.n_distintas(p_llamada) <> v_n THEN
        RAISE EXCEPTION 'FALLO % → hay filas repetidas', p_mensaje;
    END IF;
    IF v_n > 0 AND pg_temp.total(p_llamada) <> v_n THEN
        RAISE EXCEPTION 'FALLO % → total_filas (%) no coincide con las filas (%)',
            p_mensaje, pg_temp.total(p_llamada), v_n;
    END IF;
END;
$$;


-- ================================================================
-- DATOS SINTÉTICOS
-- ================================================================
WITH base_libre AS (
    SELECT base
    FROM generate_series(93000000, 93999980, 20) AS g(base)
    WHERE NOT EXISTS (
        SELECT 1 FROM public.perfiles p
        WHERE p.dni IN (SELECT (base + k)::TEXT FROM generate_series(1, 20) AS s(k))
    )
    ORDER BY base
    LIMIT 1
), identidades(sufijo, rol, nombre, apellido, legajo, desplazamiento, estado_acceso) AS (
    VALUES
        ('01', 'DIRECTOR',   'Directora', 'Confirmadora Uno', NULL,             1, 'HABILITADO'),
        ('02', 'DIRECTOR',   'Directora', 'Bloqueada',        NULL,             2, 'BLOQUEADO'),
        ('03', 'DOCENTE',    'Ana EPT63', 'Zorrilla',         NULL,             3, 'HABILITADO'),
        ('04', 'DOCENTE',    'Beto EPT63','Yáñez',            NULL,             4, 'HABILITADO'),
        ('05', 'PADRE',      'Pablo',     'Padre',            NULL,             5, 'HABILITADO'),
        ('06', 'PERSONAL',   'Paula',     'Personal',         NULL,             6, 'HABILITADO'),
        ('07', 'ESTUDIANTE', 'Uno',       'Alumna A',         'LEG-EPT63-0007', 7, 'HABILITADO'),
        ('08', 'ESTUDIANTE', 'Dos',       'Alumno B',         'LEG-EPT63-0008', 8, 'HABILITADO'),
        ('09', 'ESTUDIANTE', 'Tres',      'Alumno C',         'LEG-EPT63-0009', 9, 'HABILITADO'),
        ('0a', 'ESTUDIANTE', 'Cuatro',    'Alumna D',         'LEG-EPT63-000A', 10, 'HABILITADO'),
        ('0b', 'ESTUDIANTE', 'Cinco',     'Alumno E',         'LEG-EPT63-000B', 11, 'HABILITADO'),
        ('0d', 'ESTUDIANTE', 'Seis',      'Alumno F',         'LEG-EPT63-000D', 12, 'HABILITADO')
)
INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni, legajo_nro, estado_acceso)
SELECT pg_temp.u(i.sufijo), pg_temp.u(i.sufijo), r.id, i.nombre, i.apellido,
       (b.base + i.desplazamiento)::TEXT, i.legajo, i.estado_acceso::public.estado_acceso
FROM identidades i
JOIN public.roles r ON r.nombre = i.rol
CROSS JOIN base_libre b;

-- La cuenta autenticada sin perfil es `…0c`: no tiene fila.

INSERT INTO public.cursos (id, nivel_id, denominacion, division, activo)
VALUES (pg_temp.u('c1'), (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'),   'Curso EPT63 A', 'A', TRUE),
       (pg_temp.u('c2'), (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'),   'Curso EPT63 B', 'B', TRUE),
       (pg_temp.u('c3'), (SELECT id FROM public.niveles WHERE nombre = 'SECUNDARIO'), 'Curso EPT63 C', 'C', TRUE);

INSERT INTO public.matriculas (alumno_id, curso_id)
VALUES (pg_temp.u('07'), pg_temp.u('c1')),
       (pg_temp.u('08'), pg_temp.u('c1')),
       (pg_temp.u('09'), pg_temp.u('c2')),
       (pg_temp.u('0a'), pg_temp.u('c3')),
       (pg_temp.u('0b'), pg_temp.u('c1')),
       (pg_temp.u('0d'), pg_temp.u('c1'));

UPDATE public.alumnos SET estado = 'ACTIVO'
WHERE perfil_id IN (SELECT pg_temp.u(s) FROM unnest(ARRAY['07', '08', '09', '0a', '0b', '0d']) AS s);

SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

INSERT INTO fx (clave, valor)
SELECT 'nivel_primario', id::TEXT FROM public.niveles WHERE nombre = 'PRIMARIO';
INSERT INTO fx (clave, valor)
SELECT 'nivel_secundario', id::TEXT FROM public.niveles WHERE nombre = 'SECUNDARIO';

-- Materias y asignaciones con las RPC vigentes (012, EPT-57).
SELECT pg_temp.crear('m1', $$SELECT (public.crear_materia('Matemática EPT63')).id::TEXT$$);
SELECT pg_temp.crear('m2', $$SELECT (public.crear_materia('Lengua EPT63')).id::TEXT$$);
SELECT pg_temp.crear('m3', $$SELECT (public.crear_materia('Plástica EPT63')).id::TEXT$$);
SELECT pg_temp.crear('m4', $$SELECT (public.crear_materia('Ciencias EPT63')).id::TEXT$$);
SELECT pg_temp.crear('m5', $$SELECT (public.crear_materia('Física EPT63')).id::TEXT$$);

SELECT pg_temp.crear('a_m1_c1', pg_catalog.format('SELECT (public.asignar_materia_curso(%s, %L, %L)).id::TEXT', pg_temp.fx('m1'), pg_temp.u('c1'), pg_temp.u('03')));
SELECT pg_temp.crear('a_m2_c1', pg_catalog.format('SELECT (public.asignar_materia_curso(%s, %L, %L)).id::TEXT', pg_temp.fx('m2'), pg_temp.u('c1'), pg_temp.u('03')));
SELECT pg_temp.crear('a_m3_c1', pg_catalog.format('SELECT (public.asignar_materia_curso(%s, %L, NULL)).id::TEXT', pg_temp.fx('m3'), pg_temp.u('c1')));
SELECT pg_temp.crear('a_m2_c2', pg_catalog.format('SELECT (public.asignar_materia_curso(%s, %L, %L)).id::TEXT', pg_temp.fx('m2'), pg_temp.u('c2'), pg_temp.u('03')));
SELECT pg_temp.crear('a_m4_c2', pg_catalog.format('SELECT (public.asignar_materia_curso(%s, %L, %L)).id::TEXT', pg_temp.fx('m4'), pg_temp.u('c2'), pg_temp.u('04')));
SELECT pg_temp.crear('a_m5_c3', pg_catalog.format('SELECT (public.asignar_materia_curso(%s, %L, %L)).id::TEXT', pg_temp.fx('m5'), pg_temp.u('c3'), pg_temp.u('04')));

-- Franjas académicas: c1 lunes y miércoles 08:00 (Matemática), martes 08:00
-- (Lengua), jueves 08:00 (Plástica sin profesor); c2 miércoles 10:00 (Lengua);
-- c3 lunes 10:00 (Física).
SELECT pg_temp.crear('f_m1_lun', pg_catalog.format('SELECT (public.configurar_horario_materia(%L, 1::smallint, %L, %L, NULL)).id::TEXT', pg_temp.fx('a_m1_c1'), '08:00', '09:00'));
SELECT pg_temp.crear('f_m1_mie', pg_catalog.format('SELECT (public.configurar_horario_materia(%L, 3::smallint, %L, %L, NULL)).id::TEXT', pg_temp.fx('a_m1_c1'), '08:00', '09:00'));
SELECT pg_temp.crear('f_m2_mar', pg_catalog.format('SELECT (public.configurar_horario_materia(%L, 2::smallint, %L, %L, NULL)).id::TEXT', pg_temp.fx('a_m2_c1'), '08:00', '09:00'));
SELECT pg_temp.crear('f_m3_jue', pg_catalog.format('SELECT (public.configurar_horario_materia(%L, 4::smallint, %L, %L, NULL)).id::TEXT', pg_temp.fx('a_m3_c1'), '08:00', '09:00'));
SELECT pg_temp.crear('f_m2c2_mie', pg_catalog.format('SELECT (public.configurar_horario_materia(%L, 3::smallint, %L, %L, NULL)).id::TEXT', pg_temp.fx('a_m2_c2'), '10:00', '11:00'));
SELECT pg_temp.crear('f_m5_lun', pg_catalog.format('SELECT (public.configurar_horario_materia(%L, 1::smallint, %L, %L, NULL)).id::TEXT', pg_temp.fx('a_m5_c3'), '10:00', '11:00'));

-- Grupos deportivos: g1 Fútbol PRIMARIO (docente 03, dos franjas), g2 Natación
-- PRIMARIO (docente 04, una franja), g3 Vóley SECUNDARIO (docente 04, una franja).
SELECT pg_temp.crear('g1', pg_catalog.format('SELECT (public.crear_grupo_deportivo(%L, %s, %L, 10, %L)).id::TEXT',
    'e0000000-0000-4000-8000-000000000101', pg_temp.fx('nivel_primario'), 'Fútbol EPT63', pg_temp.u('03')));
SELECT pg_temp.crear('g2', pg_catalog.format('SELECT (public.crear_grupo_deportivo(%L, %s, %L, 10, %L)).id::TEXT',
    'e0000000-0000-4000-8000-000000000102', pg_temp.fx('nivel_primario'), 'Natación EPT63', pg_temp.u('04')));
SELECT pg_temp.crear('g3', pg_catalog.format('SELECT (public.crear_grupo_deportivo(%L, %s, %L, 10, %L)).id::TEXT',
    'e0000000-0000-4000-8000-000000000105', pg_temp.fx('nivel_secundario'), 'Vóley EPT63', pg_temp.u('04')));

SELECT pg_temp.crear('gf1_vie', pg_catalog.format('SELECT (public.agregar_horario_grupo_deportivo(%L, 5::smallint, %L, %L)).id::TEXT', pg_temp.fx('g1'), '15:00', '16:00'));
SELECT pg_temp.crear('gf1_sab', pg_catalog.format('SELECT (public.agregar_horario_grupo_deportivo(%L, 6::smallint, %L, %L)).id::TEXT', pg_temp.fx('g1'), '10:00', '11:00'));
SELECT pg_temp.crear('gf2_lun', pg_catalog.format('SELECT (public.agregar_horario_grupo_deportivo(%L, 1::smallint, %L, %L)).id::TEXT', pg_temp.fx('g2'), '15:00', '16:00'));
SELECT pg_temp.crear('gf3_mar', pg_catalog.format('SELECT (public.agregar_horario_grupo_deportivo(%L, 2::smallint, %L, %L)).id::TEXT', pg_temp.fx('g3'), '10:00', '11:00'));

-- Inscripciones deportivas (administrativas, por Dirección) y de transporte
-- (propias, con la RPC del alumno).
SELECT pg_temp.crear('i_07_g1', pg_catalog.format('SELECT (public.inscribir_alumno_en_grupo_deportivo(%L, %L)).id::TEXT', pg_temp.u('07'), pg_temp.fx('g1')));
SELECT pg_temp.crear('i_08_g2', pg_catalog.format('SELECT (public.inscribir_alumno_en_grupo_deportivo(%L, %L)).id::TEXT', pg_temp.u('08'), pg_temp.fx('g2')));
SELECT pg_temp.crear('i_0a_g3', pg_catalog.format('SELECT (public.inscribir_alumno_en_grupo_deportivo(%L, %L)).id::TEXT', pg_temp.u('0a'), pg_temp.fx('g3')));
SELECT pg_temp.crear('i_0b_g1', pg_catalog.format('SELECT (public.inscribir_alumno_en_grupo_deportivo(%L, %L)).id::TEXT', pg_temp.u('0b'), pg_temp.fx('g1')));

SELECT pg_temp.esperar(pg_temp.como('0b', pg_catalog.format('SELECT (public.cancelar_inscripcion_deportiva(%L)).id::TEXT', pg_temp.fx('i_0b_g1'))),
    'OK', 'datos: 0b cancela g1');

-- Cada alumno inscribe su propio recorrido con su propia sesión.
CREATE FUNCTION pg_temp.transporte(p_sufijo TEXT, p_clave TEXT, p_servicio TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
    v TEXT;
BEGIN
    v := pg_temp.como(p_sufijo, pg_catalog.format('SELECT (public.establecer_recorrido_transporte(%L)).id::TEXT', p_servicio));
    PERFORM pg_temp.esperar(v, 'OK', 'datos: transporte ' || p_clave);
    PERFORM pg_temp.guardar(p_clave, pg_temp.valor(v));
END;
$$;

SELECT pg_temp.transporte('07', 't_07', 'e0000000-0000-4000-8000-000000000020');
SELECT pg_temp.transporte('08', 't_08', 'e0000000-0000-4000-8000-000000000021');
SELECT pg_temp.transporte('0a', 't_0a', 'e0000000-0000-4000-8000-000000000020');
SELECT pg_temp.transporte('0b', 't_0b', 'e0000000-0000-4000-8000-000000000020');

SELECT pg_temp.esperar(pg_temp.como('0b', pg_catalog.format('SELECT (public.cancelar_inscripcion_servicio(%L)).id::TEXT', pg_temp.fx('t_0b'))),
    'OK', 'datos: 0b cancela el recorrido');

-- Historial académico: 0b cambia de curso (c1 → c2) y 0d se inactiva.
SELECT pg_temp.esperar(pg_temp.dir(pg_catalog.format('SELECT (public.cambiar_curso_alumno(%L, %L))::TEXT', pg_temp.u('0b'), pg_temp.u('c2'))),
    'OK', 'datos: 0b cambia de curso');
SELECT pg_temp.esperar(pg_temp.dir(pg_catalog.format('SELECT (public.inactivar_alumno(%L))::TEXT', pg_temp.u('0d'))),
    'OK', 'datos: 0d se inactiva');

-- Una confirmación de EPT-62 sobre la matrícula de 07: sus datos NO pueden
-- aparecer en ningún reporte.
SELECT pg_temp.esperar(pg_temp.dir(pg_catalog.format(
    'SELECT public.confirmar_matricula((SELECT m.id FROM public.matriculas m WHERE m.alumno_id = %L AND m.fecha_cierre IS NULL))::TEXT',
    pg_temp.u('07'))), 'OK', 'datos: confirmación de la matrícula de 07');

-- Huella de las tablas de origen: los reportes no escriben.
CREATE FUNCTION pg_temp.huella()
RETURNS TEXT LANGUAGE sql AS $$
    SELECT pg_catalog.md5(
        (SELECT COALESCE(pg_catalog.string_agg(t::TEXT, ';' ORDER BY t.id), '') FROM public.matriculas t)
        || (SELECT COALESCE(pg_catalog.string_agg(t::TEXT, ';' ORDER BY t.id), '') FROM public.materias_cursos t)
        || (SELECT COALESCE(pg_catalog.string_agg(t::TEXT, ';' ORDER BY t.id), '') FROM public.grupos_deportivos t)
        || (SELECT COALESCE(pg_catalog.string_agg(t::TEXT, ';' ORDER BY t.id), '') FROM public.inscripciones_deportivas t)
        || (SELECT COALESCE(pg_catalog.string_agg(t::TEXT, ';' ORDER BY t.id), '') FROM public.inscripciones_servicios t)
        || (SELECT COALESCE(pg_catalog.string_agg(t::TEXT, ';' ORDER BY t.id), '') FROM public.confirmaciones_inscripcion t));
$$;

SELECT pg_temp.guardar('h_datos', pg_temp.huella());


-- ================================================================
-- A. PERMISOS: EXECUTE, RLS y DIRECCIÓN EXPLÍCITA
-- ================================================================
-- A1. Las siete funciones públicas y los tres auxiliares: SECURITY INVOKER (no
-- elevan privilegios), EXECUTE solo para authenticated. El propietario de las
-- tablas base nunca las ejecuta por otro camino que el de quien consulta.
DO $$
DECLARE
    r RECORD;
    v_n INTEGER := 0;
BEGIN
    FOR r IN
        SELECT n.nspname, p.proname, p.oid, p.prosecdef, p.proconfig, p.provolatile
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE (n.nspname = 'public' AND (p.proname LIKE 'reporte\_%' OR p.proname = 'catalogos_reportes'))
           OR (n.nspname = 'app_private' AND p.proname IN ('exigir_director_reporte', 'preparar_reporte', 'reporte_alumnos_filtrados'))
    LOOP
        v_n := v_n + 1;
        PERFORM pg_temp.exigir(NOT r.prosecdef, 'A1 ' || r.proname || ' es SECURITY DEFINER');
        PERFORM pg_temp.exigir(r.proconfig @> ARRAY['search_path=""'], 'A1 ' || r.proname || ' sin search_path vacío');
        PERFORM pg_temp.exigir(r.provolatile = 's', 'A1 ' || r.proname || ' no es STABLE');
        PERFORM pg_temp.exigir(NOT has_function_privilege('anon', r.oid, 'EXECUTE'), 'A1 anon ejecuta ' || r.proname);
        PERFORM pg_temp.exigir(NOT has_function_privilege('service_role', r.oid, 'EXECUTE'), 'A1 service_role ejecuta ' || r.proname);
        PERFORM pg_temp.exigir(has_function_privilege('authenticated', r.oid, 'EXECUTE'), 'A1 authenticated no ejecuta ' || r.proname);
    END LOOP;
    PERFORM pg_temp.exigir(v_n = 10, 'A1 se esperaban 10 funciones y hay ' || v_n);
    PERFORM pg_temp.ok('A1 [RF17-seguridad]: 7 funciones públicas y 3 auxiliares, SECURITY INVOKER, STABLE, search_path vacío, EXECUTE solo authenticated');
END $$;

-- A2. Denegación por actor en cada función pública. El orden de chequeo es
-- identidad → rol → parámetros: un actor que no es Dirección no aprende nada.
DO $$
DECLARE
    v_actor RECORD;
    v_fn    RECORD;
    v_res   TEXT;
    v_h     TEXT := pg_temp.huella();
    v_total INTEGER := 0;
BEGIN
    FOR v_fn IN
        SELECT * FROM (VALUES
            ('reporte_alumnos_curso',     'public.reporte_alumnos_curso()'),
            ('reporte_alumnos_materia',   'public.reporte_alumnos_materia()'),
            ('reporte_alumnos_deporte',   'public.reporte_alumnos_deporte()'),
            ('reporte_alumnos_horario',   'public.reporte_alumnos_horario()'),
            ('reporte_alumnos_recorrido', 'public.reporte_alumnos_recorrido()'),
            ('reporte_docentes_nivel',    'public.reporte_docentes_nivel()'),
            ('catalogos_reportes',        'public.catalogos_reportes()')
        ) AS t(nombre, llamada)
    LOOP
        FOR v_actor IN
            SELECT * FROM (VALUES
                ('ESTUDIANTE con datos', 'authenticated', pg_temp.u('07')),
                ('ESTUDIANTE ajeno',     'authenticated', pg_temp.u('08')),
                ('PADRE',                'authenticated', pg_temp.u('05')),
                ('DOCENTE responsable',  'authenticated', pg_temp.u('03')),
                ('PERSONAL',             'authenticated', pg_temp.u('06')),
                ('DIRECTOR bloqueada',   'authenticated', pg_temp.u('02')),
                ('cuenta sin perfil',    'authenticated', pg_temp.u('0c'))
            ) AS a(etiqueta, rol, sub)
        LOOP
            v_res := pg_temp.ejecutar(v_actor.rol, v_actor.sub,
                pg_catalog.format('SELECT pg_catalog.count(*)::TEXT FROM (SELECT * FROM %s) AS f', v_fn.llamada));
            IF v_fn.nombre = 'catalogos_reportes' THEN
                v_res := pg_temp.ejecutar(v_actor.rol, v_actor.sub, 'SELECT public.catalogos_reportes()::TEXT');
            END IF;
            PERFORM pg_temp.esperar(v_res, '42501', 'A2 ' || v_actor.etiqueta || ' → ' || v_fn.nombre);
            v_total := v_total + 1;
        END LOOP;

        -- Sin identidad (rol authenticated sin `sub`): P5505.
        v_res := pg_temp.ejecutar('authenticated', NULL,
            CASE WHEN v_fn.nombre = 'catalogos_reportes' THEN 'SELECT public.catalogos_reportes()::TEXT'
                 ELSE pg_catalog.format('SELECT pg_catalog.count(*)::TEXT FROM (SELECT * FROM %s) AS f', v_fn.llamada) END);
        PERFORM pg_temp.esperar(v_res, 'P5505', 'A2 sin identidad → ' || v_fn.nombre);

        -- anon no tiene EXECUTE: 42501 por privilegio, antes de cualquier lectura.
        v_res := pg_temp.ejecutar('anon', NULL,
            CASE WHEN v_fn.nombre = 'catalogos_reportes' THEN 'SELECT public.catalogos_reportes()::TEXT'
                 ELSE pg_catalog.format('SELECT pg_catalog.count(*)::TEXT FROM (SELECT * FROM %s) AS f', v_fn.llamada) END);
        PERFORM pg_temp.esperar(v_res, '42501', 'A2 anon → ' || v_fn.nombre);

        -- La directora habilitada sí lee.
        v_res := pg_temp.dir(
            CASE WHEN v_fn.nombre = 'catalogos_reportes' THEN 'SELECT public.catalogos_reportes()::TEXT'
                 ELSE pg_catalog.format('SELECT pg_catalog.count(*)::TEXT FROM (SELECT * FROM %s) AS f', v_fn.llamada) END);
        PERFORM pg_temp.esperar(v_res, 'OK', 'A2 directora → ' || v_fn.nombre);
    END LOOP;

    PERFORM pg_temp.exigir(pg_temp.huella() = v_h, 'A2 los reportes modificaron datos');
    PERFORM pg_temp.ok('A2 [RF17-seguridad]: 7 funciones × (7 actores no autorizados → 42501, sin identidad → P5505, anon → 42501); la directora lee; ' || v_total || ' denegaciones sin recursión');
END $$;

-- A3. Los auxiliares privados tampoco se pueden usar directamente: quien no es
-- Dirección recibe 42501 antes de leer un solo alumno.
DO $$
BEGIN
    PERFORM pg_temp.esperar(pg_temp.como('07',
        'SELECT pg_catalog.count(*)::TEXT FROM app_private.reporte_alumnos_filtrados(NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)'),
        '42501', 'A3 estudiante llama al auxiliar de alumnos');
    PERFORM pg_temp.esperar(pg_temp.como('03',
        'SELECT pg_catalog.count(*)::TEXT FROM app_private.reporte_alumnos_filtrados(NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)'),
        '42501', 'A3 docente llama al auxiliar de alumnos');
    PERFORM pg_temp.esperar(pg_temp.como('05', 'SELECT app_private.preparar_reporte(NULL, 10, 0)'),
        '42501', 'A3 padre llama a preparar_reporte');
    PERFORM pg_temp.esperar(pg_temp.como('06', 'SELECT app_private.exigir_director_reporte()::TEXT'),
        '42501', 'A3 personal llama a la guardia');
    PERFORM pg_temp.esperar(pg_temp.dir('SELECT app_private.exigir_director_reporte()::TEXT'),
        'OK', 'A3 la directora pasa la guardia');
    PERFORM pg_temp.ok('A3 [RF17-seguridad]: los auxiliares privados repiten la exigencia de Dirección');
END $$;

-- A4. Las vistas de administración de EPT-62 (que sí exponen al confirmador) no
-- son la fuente de los reportes y siguen sin dar filas a quien no es Dirección.
DO $$
BEGIN
    PERFORM pg_temp.esperar(pg_temp.como('07', 'SELECT pg_catalog.count(*)::TEXT FROM public.matriculas_administracion'),
        'OK', 'A4 lectura de la vista por el estudiante');
    PERFORM pg_temp.exigir(pg_temp.valor(pg_temp.como('07', 'SELECT pg_catalog.count(*)::TEXT FROM public.matriculas_administracion')) = '0',
        'A4 el estudiante ve filas en la vista de administración');
    PERFORM pg_temp.exigir(pg_temp.valor(pg_temp.como('03', 'SELECT pg_catalog.count(*)::TEXT FROM public.inscripciones_deportivas_administracion')) = '0',
        'A4 el docente ve filas en la vista deportiva de administración');
    PERFORM pg_temp.ok('A4 [RF17-seguridad]: las vistas de EPT-62 siguen devolviendo cero filas a quien no es Dirección');
END $$;


-- ================================================================
-- B. DATOS CORRECTOS POR REPORTE
-- ================================================================
-- Conocidos: 5 matrículas vigentes (07, 08 en c1; 09 y 0b en c2; 0a en c3),
-- 2 cerradas (0b en c1 por cambio de curso; 0d por inactivación).
DO $$
BEGIN
    -- B1. Alumnos por curso.
    PERFORM pg_temp.contar('public.reporte_alumnos_curso()', 5, 'B1 matrículas vigentes');
    PERFORM pg_temp.contar('public.reporte_alumnos_curso(p_curso_id => ' || quote_literal(pg_temp.u('c1')) || '::uuid)', 2, 'B1 curso c1 vigente');
    PERFORM pg_temp.contar('public.reporte_alumnos_curso(p_curso_id => ' || quote_literal(pg_temp.u('c2')) || '::uuid)', 2, 'B1 curso c2 vigente');
    PERFORM pg_temp.contar('public.reporte_alumnos_curso(p_nivel_id => ' || pg_temp.fx('nivel_primario') || ')', 4, 'B1 nivel PRIMARIO');
    PERFORM pg_temp.contar('public.reporte_alumnos_curso(p_nivel_id => ' || pg_temp.fx('nivel_secundario') || ')', 1, 'B1 nivel SECUNDARIO');
    PERFORM pg_temp.ok('B1 [RF17]: alumnos por curso y nivel — 5 matrículas vigentes; c1=2, c2=2; PRIMARIO=4, SECUNDARIO=1');

    -- B2. Alumnos por materia: 07 y 08 (c1) × 3 materias, 09 y 0b (c2) × 2, 0a (c3) × 1.
    PERFORM pg_temp.contar('public.reporte_alumnos_materia()', 11, 'B2 alumno × materia');
    PERFORM pg_temp.contar('public.reporte_alumnos_materia(p_materia_id => ' || pg_temp.fx('m2') || ')', 4, 'B2 Lengua en c1 y c2');
    PERFORM pg_temp.contar('public.reporte_alumnos_materia(p_materia_id => ' || pg_temp.fx('m3') || ')', 2, 'B2 Plástica (sin profesor)');
    PERFORM pg_temp.ok('B2 [RF17]: alumnos por materia derivada del curso — 11 filas; Lengua=4, Plástica=2 (sin inscripción individual por materia)');

    -- B3. Alumnos por deporte: 3 activas y 1 cancelada.
    PERFORM pg_temp.contar('public.reporte_alumnos_deporte()', 3, 'B3 inscripciones activas');
    PERFORM pg_temp.contar('public.reporte_alumnos_deporte(p_deporte_id => ''e0000000-0000-4000-8000-000000000101''::uuid)', 1, 'B3 Fútbol activo');
    PERFORM pg_temp.contar('public.reporte_alumnos_deporte(p_nivel_id => ' || pg_temp.fx('nivel_secundario') || ')', 1, 'B3 grupo de nivel SECUNDARIO');
    PERFORM pg_temp.ok('B3 [RF17]: alumnos por deporte — 3 inscripciones activas; Fútbol=1; nivel del GRUPO');

    -- B4. Alumnos por horario: 11 académicas + 4 deportivas.
    PERFORM pg_temp.contar('public.reporte_alumnos_horario()', 15, 'B4 alumno × franja');
    PERFORM pg_temp.contar('public.reporte_alumnos_horario(p_origen => ''ACADEMICO'')', 11, 'B4 origen académico');
    PERFORM pg_temp.contar('public.reporte_alumnos_horario(p_origen => ''DEPORTIVO'')', 4, 'B4 origen deportivo');
    PERFORM pg_temp.ok('B4 [RF17]: alumnos por horario — 15 franjas (11 académicas + 4 deportivas)');

    -- B5. Alumnos por recorrido: 3 activas y 1 cancelada.
    PERFORM pg_temp.contar('public.reporte_alumnos_recorrido()', 3, 'B5 recorridos activos');
    PERFORM pg_temp.contar('public.reporte_alumnos_recorrido(p_servicio_id => ''e0000000-0000-4000-8000-000000000020''::uuid)', 2, 'B5 recorrido Norte');
    PERFORM pg_temp.contar('public.reporte_alumnos_recorrido(p_servicio_id => ''e0000000-0000-4000-8000-000000000021''::uuid)', 1, 'B5 recorrido Sur');
    PERFORM pg_temp.ok('B5 [RF17]: alumnos por recorrido — 3 activos; Norte=2, Sur=1; el comedor no entra');

    -- B6. Docentes por nivel: 03 → m1c1, m2c1, m2c2, g1; 04 → m4c2, m5c3, g2, g3.
    PERFORM pg_temp.contar('public.reporte_docentes_nivel()', 8, 'B6 docente × asignación');
    PERFORM pg_temp.contar('public.reporte_docentes_nivel(p_nivel_id => ' || pg_temp.fx('nivel_primario') || ')', 6, 'B6 PRIMARIO');
    PERFORM pg_temp.contar('public.reporte_docentes_nivel(p_nivel_id => ' || pg_temp.fx('nivel_secundario') || ')', 2, 'B6 SECUNDARIO');
    PERFORM pg_temp.ok('B6 [RF17]: docentes por nivel — 8 asignaciones (PRIMARIO=6, SECUNDARIO=2); la materia sin profesor no genera fila');
END $$;

-- B7. Responsable = PROFESOR de la materia o del grupo (no el padre/tutor).
DO $$
DECLARE
    v JSONB;
BEGIN
    v := pg_temp.filas('public.reporte_alumnos_materia(p_materia_id => ' || pg_temp.fx('m1') || ')');
    PERFORM pg_temp.exigir(pg_catalog.jsonb_array_length(v) = 2
        AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v) e
                        WHERE e ->> 'responsable_apellido' IS DISTINCT FROM 'Zorrilla'), 'B7 responsable de Matemática');
    v := pg_temp.filas('public.reporte_alumnos_materia(p_materia_id => ' || pg_temp.fx('m3') || ')');
    PERFORM pg_temp.exigir(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v) e WHERE e -> 'responsable_apellido' <> 'null'::jsonb),
        'B7 la materia sin profesor debe mostrar responsable vacío');
    v := pg_temp.filas('public.reporte_alumnos_deporte()');
    PERFORM pg_temp.exigir(EXISTS (SELECT 1 FROM jsonb_array_elements(v) e
                                   WHERE e ->> 'deporte_nombre' = 'Fútbol' AND e ->> 'responsable_apellido' = 'Zorrilla'),
        'B7 responsable del grupo de Fútbol');
    PERFORM pg_temp.exigir(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(pg_temp.filas('public.reporte_alumnos_deporte()')) e
                                       WHERE e::TEXT ILIKE '%Padre%'), 'B7 aparece un padre en el reporte deportivo');
    PERFORM pg_temp.ok('B7 [RF17-responsable]: el responsable es el profesor de la materia o del grupo; vacío si la asignación no tiene profesor; nunca un padre');
END $$;


-- ================================================================
-- C. CRUCES SIN DUPLICAR FILAS
-- ================================================================
DO $$
DECLARE
    v_c1 TEXT := quote_literal(pg_temp.u('c1')) || '::uuid';
    v_fut TEXT := '''e0000000-0000-4000-8000-000000000101''::uuid';
    v_nor TEXT := '''e0000000-0000-4000-8000-000000000020''::uuid';
BEGIN
    -- 07 tiene 3 materias, 1 deporte con 2 franjas y 1 recorrido: crucen lo que
    -- crucen, aparece UNA vez en un reporte de un grano por alumno.
    PERFORM pg_temp.contar('public.reporte_alumnos_curso(p_materia_id => ' || pg_temp.fx('m1') || ')', 2, 'C1 curso × materia');
    PERFORM pg_temp.contar('public.reporte_alumnos_curso(p_materia_id => ' || pg_temp.fx('m1') || ', p_deporte_id => ' || v_fut || ')', 1, 'C1 curso × materia × deporte');
    PERFORM pg_temp.contar('public.reporte_alumnos_curso(p_materia_id => ' || pg_temp.fx('m1') || ', p_deporte_id => ' || v_fut || ', p_servicio_id => ' || v_nor || ')', 1, 'C1 curso × materia × deporte × recorrido');
    PERFORM pg_temp.contar('public.reporte_alumnos_curso(p_materia_id => ' || pg_temp.fx('m1') || ', p_deporte_id => ' || v_fut || ', p_servicio_id => ' || v_nor || ', p_profesor_id => ' || quote_literal(pg_temp.u('03')) || '::uuid)', 1, 'C1 × responsable');
    PERFORM pg_temp.contar('public.reporte_alumnos_curso(p_nivel_id => ' || pg_temp.fx('nivel_primario') || ', p_servicio_id => ' || v_nor || ')', 1, 'C1 nivel × recorrido');
    PERFORM pg_temp.contar('public.reporte_alumnos_curso(p_curso_id => ' || v_c1 || ', p_servicio_id => ' || v_nor || ')', 1, 'C1 curso × recorrido');
    PERFORM pg_temp.contar('public.reporte_alumnos_curso(p_curso_id => ' || v_c1 || ', p_deporte_id => ''e0000000-0000-4000-8000-000000000106''::uuid)', 0, 'C1 cruce sin coincidencias');
    PERFORM pg_temp.ok('C1 [RF17-cruces]: curso × materia × deporte × recorrido × responsable sobre matrículas — 07 nunca se repite pese a 3 materias, 2 franjas y 1 recorrido');

    -- Reporte por horario: el cruce con curso/recorrido selecciona alumnos y no multiplica las franjas.
    PERFORM pg_temp.contar('public.reporte_alumnos_horario(p_curso_id => ' || v_c1 || ')', 11, 'C2 franjas de los alumnos de c1');
    PERFORM pg_temp.contar('public.reporte_alumnos_horario(p_servicio_id => ' || v_nor || ')', 8, 'C2 franjas de quienes viajan por Norte');
    PERFORM pg_temp.contar('public.reporte_alumnos_horario(p_servicio_id => ' || v_nor || ', p_origen => ''DEPORTIVO'')', 3, 'C2 Norte × deportivo');
    PERFORM pg_temp.ok('C2 [RF17-cruces]: alumnos por horario cruzado con curso y recorrido — una fila por franja real, sin producto cartesiano');

    -- Filtros propios del grano del reporte.
    PERFORM pg_temp.contar('public.reporte_alumnos_materia(p_profesor_id => ' || quote_literal(pg_temp.u('03')) || '::uuid)', 6, 'C3 materias del responsable 03');
    PERFORM pg_temp.contar('public.reporte_alumnos_materia(p_profesor_id => ' || quote_literal(pg_temp.u('03')) || '::uuid, p_curso_id => ' || v_c1 || ')', 4, 'C3 responsable × curso');
    PERFORM pg_temp.contar('public.reporte_alumnos_materia(p_nivel_id => ' || pg_temp.fx('nivel_secundario') || ')', 1, 'C3 materias del nivel SECUNDARIO');
    PERFORM pg_temp.contar('public.reporte_alumnos_materia(p_deporte_id => ' || v_fut || ')', 3, 'C3 materias de los alumnos que juegan Fútbol');
    PERFORM pg_temp.contar('public.reporte_alumnos_deporte(p_curso_id => ' || v_c1 || ')', 2, 'C3 deportes de los alumnos de c1');
    PERFORM pg_temp.contar('public.reporte_alumnos_deporte(p_materia_id => ' || pg_temp.fx('m5') || ')', 1, 'C3 deportes de quienes cursan Física');
    PERFORM pg_temp.contar('public.reporte_alumnos_deporte(p_profesor_id => ' || quote_literal(pg_temp.u('04')) || '::uuid)', 2, 'C3 grupos del responsable 04');
    PERFORM pg_temp.contar('public.reporte_alumnos_recorrido(p_nivel_id => ' || pg_temp.fx('nivel_secundario') || ')', 1, 'C3 recorridos de alumnos del nivel SECUNDARIO');
    PERFORM pg_temp.contar('public.reporte_alumnos_recorrido(p_deporte_id => ' || v_fut || ')', 1, 'C3 recorridos de quienes juegan Fútbol');
    PERFORM pg_temp.ok('C3 [RF17-cruces]: filtros combinables entre dominios en materia, deporte y recorrido');

    -- Texto de búsqueda: apellido, nombre, «apellido nombre» y legajo; sin inyección.
    PERFORM pg_temp.contar('public.reporte_alumnos_curso(p_busqueda => ''Alumna A'')', 1, 'C4 búsqueda por apellido y nombre');
    PERFORM pg_temp.contar('public.reporte_alumnos_curso(p_busqueda => ''LEG-EPT63-0008'')', 1, 'C4 búsqueda por legajo');
    PERFORM pg_temp.contar('public.reporte_alumnos_curso(p_busqueda => ''alumno'')', 3, 'C4 búsqueda sin distinguir mayúsculas');
    PERFORM pg_temp.contar('public.reporte_alumnos_curso(p_busqueda => ''%'')', 0, 'C4 el comodín % se busca literalmente');
    PERFORM pg_temp.contar('public.reporte_alumnos_curso(p_busqueda => ''_'')', 0, 'C4 el comodín _ se busca literalmente');
    PERFORM pg_temp.contar('public.reporte_alumnos_curso(p_busqueda => ''x''''; DROP TABLE public.perfiles; --'')', 0, 'C4 texto hostil');
    PERFORM pg_temp.exigir(to_regclass('public.perfiles') IS NOT NULL, 'C4 la tabla de perfiles sigue existiendo');
    PERFORM pg_temp.contar('public.reporte_docentes_nivel(p_busqueda => ''Zorrilla'')', 4, 'C4 búsqueda de docente');
    PERFORM pg_temp.ok('C4: búsqueda por apellido, nombre, legajo, sin distinguir mayúsculas; % y _ literales; texto hostil inofensivo');
END $$;


-- ================================================================
-- D. HISTORIAL: DONDE EXISTE SE MUESTRA, DONDE NO EXISTE NO SE OFRECE
-- ================================================================
DO $$
DECLARE
    v JSONB;
BEGIN
    -- D1. Matrículas: cerradas con fecha y motivo.
    PERFORM pg_temp.contar('public.reporte_alumnos_curso(p_incluir_historial => true)', 7, 'D1 matrículas con historial');
    v := pg_temp.filas('public.reporte_alumnos_curso(p_incluir_historial => true)');
    PERFORM pg_temp.exigir((SELECT count(*) FROM jsonb_array_elements(v) e WHERE (e ->> 'vigente')::BOOLEAN) = 5
                           AND (SELECT count(*) FROM jsonb_array_elements(v) e
                                WHERE NOT (e ->> 'vigente')::BOOLEAN
                                  AND e ->> 'fecha_cierre' IS NOT NULL
                                  AND e ->> 'motivo_cierre' IN ('CAMBIO_DE_CURSO', 'INACTIVACION')) = 2,
        'D1 las dos matrículas cerradas deben traer fecha y motivo');
    PERFORM pg_temp.exigir((SELECT count(*) FROM jsonb_array_elements(v) e WHERE e ->> 'motivo_cierre' = 'CAMBIO_DE_CURSO') = 1
                           AND (SELECT count(*) FROM jsonb_array_elements(v) e WHERE e ->> 'motivo_cierre' = 'INACTIVACION') = 1,
        'D1 un cambio de curso y una inactivación');
    PERFORM pg_temp.contar('public.reporte_alumnos_curso(p_incluir_historial => true, p_curso_id => ' || quote_literal(pg_temp.u('c1')) || '::uuid)', 4,
        'D1 c1 con historial: 07, 08, el que se fue (0b) y el inactivado (0d)');
    PERFORM pg_temp.contar('public.reporte_alumnos_curso(p_curso_id => ' || quote_literal(pg_temp.u('c1')) || '::uuid)', 2, 'D1 c1 sin historial');
    PERFORM pg_temp.ok('D1 [RF17-historial]: 5 vigentes + 2 cerradas (una CAMBIO_DE_CURSO, una INACTIVACION) con fecha y motivo; el curso c1 pasa de 2 a 4');

    -- D2. Deportes y recorrido: las canceladas figuran con su fecha.
    PERFORM pg_temp.contar('public.reporte_alumnos_deporte(p_incluir_historial => true)', 4, 'D2 deportes con historial');
    v := pg_temp.filas('public.reporte_alumnos_deporte(p_incluir_historial => true)');
    PERFORM pg_temp.exigir((SELECT count(*) FROM jsonb_array_elements(v) e
                            WHERE e ->> 'estado' = 'CANCELADA' AND e ->> 'fecha_cancelacion' IS NOT NULL) = 1,
        'D2 la inscripción deportiva cancelada debe traer su fecha');
    PERFORM pg_temp.contar('public.reporte_alumnos_recorrido(p_incluir_historial => true)', 4, 'D2 recorridos con historial');
    v := pg_temp.filas('public.reporte_alumnos_recorrido(p_incluir_historial => true)');
    PERFORM pg_temp.exigir((SELECT count(*) FROM jsonb_array_elements(v) e
                            WHERE e ->> 'estado' = 'CANCELADA' AND e ->> 'fecha_cancelacion' IS NOT NULL) = 1,
        'D2 la inscripción de transporte cancelada debe traer su fecha');
    PERFORM pg_temp.ok('D2 [RF17-historial]: deportes y recorrido con historial muestran la cancelada y su fecha; por defecto solo las activas');
END $$;

-- D3. Donde el esquema NO registra historial, el parámetro no existe: no hay
-- forma de pedir «historia» de materias, horarios ni docentes.
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT p.proname, pg_get_function_arguments(p.oid) AS args
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN ('reporte_alumnos_materia', 'reporte_alumnos_horario', 'reporte_docentes_nivel')
    LOOP
        PERFORM pg_temp.exigir(r.args NOT ILIKE '%historial%', 'D3 ' || r.proname || ' ofrece historial que el esquema no registra');
    END LOOP;
    FOR r IN
        SELECT p.proname, pg_get_function_arguments(p.oid) AS args
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN ('reporte_alumnos_curso', 'reporte_alumnos_deporte', 'reporte_alumnos_recorrido')
    LOOP
        PERFORM pg_temp.exigir(r.args ILIKE '%p_incluir_historial%', 'D3 ' || r.proname || ' debería ofrecer historial');
    END LOOP;
    PERFORM pg_temp.ok('D3 [RF17-historial]: materia, horario y docentes NO ofrecen historial (el esquema solo guarda el estado actual); curso, deporte y recorrido sí');
END $$;

-- D4. Una asignación dada de baja deja de figurar como vigente y no reaparece
-- como historia.
DO $$
DECLARE
    v_antes BIGINT;
BEGIN
    v_antes := pg_temp.n('public.reporte_docentes_nivel()');
    PERFORM pg_temp.esperar(pg_temp.dir(pg_catalog.format('SELECT (public.cambiar_estado_asignacion(%L, false)).activo::TEXT', pg_temp.fx('a_m4_c2'))),
        'OK', 'D4 baja de la asignación de Ciencias');
    PERFORM pg_temp.contar('public.reporte_docentes_nivel()', v_antes - 1, 'D4 la asignación dada de baja no figura');
    PERFORM pg_temp.contar('public.reporte_alumnos_materia(p_materia_id => ' || pg_temp.fx('m4') || ')', 0, 'D4 la materia dada de baja no figura por alumno');
    PERFORM pg_temp.esperar(pg_temp.dir(pg_catalog.format('SELECT (public.cambiar_estado_asignacion(%L, true)).activo::TEXT', pg_temp.fx('a_m4_c2'))),
        'OK', 'D4 reactivación');
    PERFORM pg_temp.contar('public.reporte_docentes_nivel()', v_antes, 'D4 al reactivarla vuelve');
    PERFORM pg_temp.ok('D4 [RF17-historial]: una asignación de baja sale del reporte vigente y no se presenta como historia');
END $$;


-- ================================================================
-- E. ORIGEN ACADÉMICO Y DEPORTIVO SIN MEZCLAR
-- ================================================================
DO $$
DECLARE
    v JSONB;
    v_lun TEXT;
    v_lun15 TEXT;
BEGIN
    -- E1. El docente 03 tiene asignación académica Y deportiva en PRIMARIO: dos
    -- orígenes, filas distintas, ninguna fila mezclada.
    v := pg_temp.filas('public.reporte_docentes_nivel(p_profesor_id => ' || quote_literal(pg_temp.u('03')) || '::uuid, p_nivel_id => ' || pg_temp.fx('nivel_primario') || ')');
    PERFORM pg_temp.exigir(pg_catalog.jsonb_array_length(v) = 4, 'E1 el docente 03 debería tener 4 asignaciones en PRIMARIO');
    PERFORM pg_temp.exigir((SELECT count(*) FROM jsonb_array_elements(v) e WHERE e ->> 'origen' = 'ACADEMICO') = 3
                           AND (SELECT count(*) FROM jsonb_array_elements(v) e WHERE e ->> 'origen' = 'DEPORTIVO') = 1, 'E1 3 académicas y 1 deportiva');
    PERFORM pg_temp.exigir(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v) e
                                       WHERE e ->> 'origen' = 'ACADEMICO' AND (e ->> 'grupo_nombre' IS NOT NULL OR e ->> 'curso_denominacion' IS NULL)),
        'E1 una fila académica lleva grupo o le falta el curso');
    PERFORM pg_temp.exigir(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v) e
                                       WHERE e ->> 'origen' = 'DEPORTIVO' AND (e ->> 'curso_denominacion' IS NOT NULL OR e ->> 'grupo_nombre' IS NULL)),
        'E1 una fila deportiva lleva curso o le falta el grupo');
    PERFORM pg_temp.exigir((SELECT count(DISTINCT e ->> 'id') FROM jsonb_array_elements(v) e) = 4, 'E1 hay filas repetidas');
    PERFORM pg_temp.exigir((SELECT count(DISTINCT e ->> 'docente_apellido') FROM jsonb_array_elements(v) e) = 1, 'E1 es una sola persona, con 4 filas');
    PERFORM pg_temp.ok('E1 [RF17-origen]: docente con asignación académica y deportiva en el mismo nivel → una fila por asignación, cada una con su origen y sus columnas propias');

    -- E2. Cruce de docentes con horario: integra ambos orígenes.
    v_lun   := (SELECT id::TEXT FROM public.horarios WHERE dia_semana = 1 AND hora_inicio = '08:00' AND hora_fin = '09:00');
    v_lun15 := (SELECT id::TEXT FROM public.horarios WHERE dia_semana = 1 AND hora_inicio = '15:00' AND hora_fin = '16:00');
    PERFORM pg_temp.contar('public.reporte_docentes_nivel(p_horario_id => ' || quote_literal(v_lun) || '::uuid)', 1, 'E2 docentes con franja lunes 08:00');
    PERFORM pg_temp.contar('public.reporte_docentes_nivel(p_horario_id => ' || quote_literal(v_lun15) || '::uuid)', 1, 'E2 docentes con franja lunes 15:00 (deportiva)');
    v := pg_temp.filas('public.reporte_docentes_nivel(p_horario_id => ' || quote_literal(v_lun15) || '::uuid)');
    PERFORM pg_temp.exigir(v -> 0 ->> 'origen' = 'DEPORTIVO' AND v -> 0 ->> 'docente_apellido' = 'Yáñez', 'E2 la franja deportiva es del docente 04');
    PERFORM pg_temp.contar('public.reporte_docentes_nivel(p_origen => ''DEPORTIVO'')', 3, 'E2 solo grupos');
    PERFORM pg_temp.contar('public.reporte_docentes_nivel(p_origen => ''ACADEMICO'')', 5, 'E2 solo materias');
    PERFORM pg_temp.contar('public.reporte_docentes_nivel(p_deporte_id => ''e0000000-0000-4000-8000-000000000102''::uuid)', 1, 'E2 por deporte');
    PERFORM pg_temp.contar('public.reporte_docentes_nivel(p_materia_id => ' || pg_temp.fx('m2') || ')', 2, 'E2 por materia');
    PERFORM pg_temp.contar('public.reporte_docentes_nivel(p_materia_id => ' || pg_temp.fx('m2') || ', p_deporte_id => ''e0000000-0000-4000-8000-000000000101''::uuid)', 0,
        'E2 materia y deporte a la vez no comparten origen: vacío');
    PERFORM pg_temp.contar('public.reporte_docentes_nivel(p_curso_id => ' || quote_literal(pg_temp.u('c1')) || '::uuid)', 2, 'E2 por curso (solo académico)');
    PERFORM pg_temp.ok('E2 [RF17-origen]: docentes cruzados con horario, origen, materia, deporte y curso; un cruce sin origen común da vacío en lugar de mezclar');

    -- E3. Horarios: el origen identifica cada fila y la misma franja por dos vías son dos filas.
    v := pg_temp.filas('public.reporte_alumnos_horario(p_horario_id => ' || quote_literal(v_lun) || '::uuid)');
    PERFORM pg_temp.exigir(pg_catalog.jsonb_array_length(v) = 2
                           AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v) e WHERE e ->> 'origen' <> 'ACADEMICO'),
        'E3 lunes 08:00 son las dos franjas académicas de Matemática (07 y 08)');
    v := pg_temp.filas('public.reporte_alumnos_horario(p_horario_id => ' || quote_literal(v_lun15) || '::uuid)');
    PERFORM pg_temp.exigir(pg_catalog.jsonb_array_length(v) = 1 AND v -> 0 ->> 'origen' = 'DEPORTIVO' AND v -> 0 ->> 'actividad_nombre' = 'Natación',
        'E3 lunes 15:00 es la franja deportiva de Natación');
    v := pg_temp.filas('public.reporte_alumnos_horario(p_profesor_id => ' || quote_literal(pg_temp.u('03')) || '::uuid)');
    PERFORM pg_temp.exigir(pg_catalog.jsonb_array_length(v) = 10, 'E3 franjas del responsable 03: 4 + 2 + 2 académicas y 2 deportivas');
    PERFORM pg_temp.contar('public.reporte_alumnos_horario(p_deporte_id => ''e0000000-0000-4000-8000-000000000101''::uuid)', 2, 'E3 deporte acota las filas a las franjas deportivas');
    PERFORM pg_temp.contar('public.reporte_alumnos_horario(p_materia_id => ' || pg_temp.fx('m1') || ')', 4, 'E3 materia acota las filas a sus franjas');
    PERFORM pg_temp.contar('public.reporte_alumnos_horario(p_materia_id => ' || pg_temp.fx('m1') || ', p_deporte_id => ''e0000000-0000-4000-8000-000000000101''::uuid)', 0,
        'E3 materia y deporte a la vez: vacío');
    PERFORM pg_temp.contar('public.reporte_alumnos_horario(p_nivel_id => ' || pg_temp.fx('nivel_secundario') || ')', 2, 'E3 nivel de la actividad');
    PERFORM pg_temp.ok('E3 [RF17-origen]: horarios identifican origen ACADEMICO/DEPORTIVO por fila; materia, deporte, nivel, horario y responsable acotan filas');
END $$;

-- E4. La misma franja horaria por las dos vías queda en dos filas. Se construye
-- con un alumno de c3 (lunes 10:00 académico) y un grupo con franja los martes:
-- aquí se comprueba el invariante de identidad de fila con datos ya existentes.
DO $$
DECLARE
    v JSONB;
BEGIN
    v := pg_temp.filas('public.reporte_alumnos_horario()');
    PERFORM pg_temp.exigir((SELECT count(DISTINCT e ->> 'id') FROM jsonb_array_elements(v) e) = pg_catalog.jsonb_array_length(v),
        'E4 el identificador de fila no es único');
    PERFORM pg_temp.exigir(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v) e WHERE e ->> 'id' NOT LIKE 'A:%' AND e ->> 'id' NOT LIKE 'D:%'),
        'E4 el identificador debe declarar su origen');
    PERFORM pg_temp.exigir(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v) e WHERE (e ->> 'id' LIKE 'A:%') <> (e ->> 'origen' = 'ACADEMICO')),
        'E4 el identificador y el origen no coinciden');
    PERFORM pg_temp.ok('E4 [RF17-origen]: el identificador de cada fila declara su origen y es único');
END $$;


-- ================================================================
-- F. PRIVACIDAD
-- ================================================================
DO $$
DECLARE
    v_todo TEXT;
    v_fn   TEXT;
    v_cols TEXT;
BEGIN
    -- F1. Ninguna columna de ningún reporte tiene que ver con el confirmador,
    -- con documentos o con datos de contacto.
    FOR v_fn IN
        SELECT p.oid::regprocedure::TEXT
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND (p.proname LIKE 'reporte\_%' OR p.proname = 'catalogos_reportes')
    LOOP
        v_cols := pg_get_function_result(v_fn::regprocedure) || ' ' || pg_get_function_arguments(v_fn::regprocedure);
        PERFORM pg_temp.exigir(v_cols !~* '(confirm|dni|telefono|direccion|nacimiento|user_id|email|correo)',
            'F1 columnas o argumentos sensibles en ' || v_fn || ': ' || v_cols);
    END LOOP;
    PERFORM pg_temp.ok('F1 [RF17-privacidad]: ninguna columna ni argumento de los reportes alude al confirmador, DNI, contacto, domicilio ni nacimiento');

    -- F2. Con una confirmación real registrada, ningún valor de ningún reporte
    -- (ni con historial) contiene a la persona que confirmó.
    PERFORM pg_temp.exigir((SELECT count(*) FROM public.confirmaciones_inscripcion) = 1, 'F2 debería haber una confirmación registrada');
    v_todo := concat_ws(' ',
        pg_temp.filas('public.reporte_alumnos_curso(p_incluir_historial => true, p_limite => 1000)')::TEXT,
        pg_temp.filas('public.reporte_alumnos_materia(p_limite => 1000)')::TEXT,
        pg_temp.filas('public.reporte_alumnos_deporte(p_incluir_historial => true, p_limite => 1000)')::TEXT,
        pg_temp.filas('public.reporte_alumnos_horario(p_limite => 1000)')::TEXT,
        pg_temp.filas('public.reporte_alumnos_recorrido(p_incluir_historial => true, p_limite => 1000)')::TEXT,
        pg_temp.filas('public.reporte_docentes_nivel(p_limite => 1000)')::TEXT,
        pg_temp.valor(pg_temp.dir('SELECT public.catalogos_reportes()::TEXT')));
    PERFORM pg_temp.exigir(v_todo NOT ILIKE '%Confirmadora%', 'F2 el apellido de quien confirmó aparece en un reporte');
    PERFORM pg_temp.exigir(v_todo NOT ILIKE '%confirm%', 'F2 aparece una clave o valor sobre confirmación');
    PERFORM pg_temp.exigir(v_todo NOT ILIKE '%' || pg_temp.u('01')::TEXT || '%', 'F2 aparece el identificador del confirmador');
    PERFORM pg_temp.exigir(v_todo NOT ILIKE '%dni%' AND v_todo NOT ILIKE '%telefono%', 'F2 datos personales sensibles');
    PERFORM pg_temp.ok('F2 [RF17-privacidad]: con una confirmación real registrada, ni las filas ni los catálogos de los 6 reportes mencionan al confirmador');
END $$;


-- ================================================================
-- G. PAGINACIÓN Y VALIDACIÓN DE PARÁMETROS
-- ================================================================
DO $$
DECLARE
    v_p1 JSONB; v_p2 JSONB; v_p3 JSONB; v_todas JSONB;
    v_ids TEXT[];
BEGIN
    -- G1. Páginas de 4 sobre 15 franjas: 4 + 4 + 4 + 3, sin repetir ni saltear, con el
    -- mismo orden que la lectura completa.
    v_todas := pg_temp.filas('public.reporte_alumnos_horario(p_limite => 1000)');
    v_p1 := pg_temp.filas('public.reporte_alumnos_horario(p_limite => 4, p_desplazamiento => 0)');
    v_p2 := pg_temp.filas('public.reporte_alumnos_horario(p_limite => 4, p_desplazamiento => 4)');
    v_p3 := pg_temp.filas('public.reporte_alumnos_horario(p_limite => 4, p_desplazamiento => 12)');
    PERFORM pg_temp.exigir(jsonb_array_length(v_todas) = 15 AND jsonb_array_length(v_p1) = 4
                           AND jsonb_array_length(v_p2) = 4 AND jsonb_array_length(v_p3) = 3, 'G1 tamaños de página');
    PERFORM pg_temp.exigir((v_p1 -> 0 ->> 'total_filas')::INT = 15 AND (v_p2 -> 0 ->> 'total_filas')::INT = 15
                           AND (v_p3 -> 0 ->> 'total_filas')::INT = 15, 'G1 total_filas constante en cada página');
    SELECT array_agg(e ->> 'id' ORDER BY o) INTO v_ids FROM jsonb_array_elements(v_p1 || v_p2) WITH ORDINALITY AS t(e, o);
    PERFORM pg_temp.exigir(v_ids = (SELECT array_agg(e ->> 'id' ORDER BY o) FROM jsonb_array_elements(v_todas) WITH ORDINALITY AS t(e, o) WHERE o <= 8),
        'G1 las dos primeras páginas coinciden con el orden de la lectura completa');
    PERFORM pg_temp.exigir((SELECT count(DISTINCT e ->> 'id') FROM jsonb_array_elements(v_p1 || v_p2 || v_p3) e) = 11, 'G1 páginas con filas repetidas');
    PERFORM pg_temp.exigir(pg_temp.n('public.reporte_alumnos_horario(p_limite => 4, p_desplazamiento => 100)') = 0, 'G1 una página fuera de rango debe estar vacía');
    PERFORM pg_temp.ok('G1 [RF17-paginacion]: 15 franjas en páginas de 4 (4+4+4+3), total exacto en cada página, orden idéntico y sin repetidas; fuera de rango = vacío');

    -- G2. Orden total y determinista en los seis reportes: dos lecturas idénticas.
    PERFORM pg_temp.exigir(pg_temp.filas('public.reporte_alumnos_curso(p_incluir_historial => true)') = pg_temp.filas('public.reporte_alumnos_curso(p_incluir_historial => true)'),
        'G2 alumnos por curso no es determinista');
    PERFORM pg_temp.exigir(pg_temp.filas('public.reporte_alumnos_materia()') = pg_temp.filas('public.reporte_alumnos_materia()'), 'G2 materia');
    PERFORM pg_temp.exigir(pg_temp.filas('public.reporte_docentes_nivel()') = pg_temp.filas('public.reporte_docentes_nivel()'), 'G2 docentes');
    PERFORM pg_temp.ok('G2: el orden de los reportes es total y determinista');
END $$;

DO $$
BEGIN
    -- G3. Parámetros inválidos → P6301, nunca un resultado silencioso.
    PERFORM pg_temp.esperar(pg_temp.dir('SELECT count(*)::TEXT FROM public.reporte_alumnos_curso(p_limite => 0)'), 'P6301', 'G3 límite 0');
    PERFORM pg_temp.esperar(pg_temp.dir('SELECT count(*)::TEXT FROM public.reporte_alumnos_curso(p_limite => 1001)'), 'P6301', 'G3 límite 1001');
    PERFORM pg_temp.esperar(pg_temp.dir('SELECT count(*)::TEXT FROM public.reporte_alumnos_curso(p_limite => NULL)'), 'P6301', 'G3 límite NULL');
    PERFORM pg_temp.esperar(pg_temp.dir('SELECT count(*)::TEXT FROM public.reporte_alumnos_curso(p_desplazamiento => -1)'), 'P6301', 'G3 desplazamiento negativo');
    PERFORM pg_temp.esperar(pg_temp.dir('SELECT count(*)::TEXT FROM public.reporte_alumnos_horario(p_origen => ''OTRO'')'), 'P6301', 'G3 origen inválido en horario');
    PERFORM pg_temp.esperar(pg_temp.dir('SELECT count(*)::TEXT FROM public.reporte_docentes_nivel(p_origen => ''otro'')'), 'P6301', 'G3 origen inválido en docentes');
    PERFORM pg_temp.esperar(pg_temp.dir(pg_catalog.format('SELECT count(*)::TEXT FROM public.reporte_alumnos_curso(p_busqueda => %L)', repeat('a', 101))),
        'P6301', 'G3 búsqueda de 101 caracteres');
    PERFORM pg_temp.esperar(pg_temp.dir(pg_catalog.format('SELECT count(*)::TEXT FROM public.reporte_alumnos_curso(p_busqueda => %L)', repeat('a', 100))),
        'OK', 'G3 búsqueda de 100 caracteres');
    PERFORM pg_temp.esperar(pg_temp.dir('SELECT count(*)::TEXT FROM public.reporte_alumnos_curso(p_busqueda => ''   '')'), 'OK', 'G3 búsqueda en blanco = sin búsqueda');
    PERFORM pg_temp.exigir(pg_temp.total('public.reporte_alumnos_curso(p_busqueda => ''   '')') = pg_temp.total('public.reporte_alumnos_curso(p_busqueda => NULL)')
                           AND pg_temp.total('public.reporte_alumnos_curso(p_busqueda => NULL)') >= 5, 'G3 búsqueda en blanco no filtra');
    -- Las validaciones vienen DESPUÉS de la autorización: un estudiante con un parámetro inválido sigue recibiendo 42501.
    PERFORM pg_temp.esperar(pg_temp.como('07', 'SELECT count(*)::TEXT FROM public.reporte_alumnos_curso(p_limite => 0)'), '42501', 'G3 estudiante con parámetro inválido');
    PERFORM pg_temp.ok('G3: límite fuera de 1–1000, desplazamiento negativo, origen y búsqueda inválidos → P6301; la autorización se decide antes');
END $$;


-- ================================================================
-- H. CATÁLOGOS DE LOS FILTROS
-- ================================================================
DO $$
DECLARE
    v JSONB;
BEGIN
    v := pg_temp.valor(pg_temp.dir('SELECT public.catalogos_reportes()::TEXT'))::JSONB;
    PERFORM pg_temp.exigir((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v) AS k)
                           = ARRAY['cursos', 'deportes', 'horarios', 'materias', 'niveles', 'profesores', 'recorridos'], 'H1 claves del documento');
    PERFORM pg_temp.exigir(jsonb_array_length(v -> 'niveles') >= 3 AND jsonb_array_length(v -> 'deportes') >= 6
                           AND jsonb_array_length(v -> 'recorridos') = 4, 'H1 niveles, deportes y recorridos');
    PERFORM pg_temp.exigir(jsonb_array_length(v -> 'profesores') >= 2
                           AND EXISTS (SELECT 1 FROM jsonb_array_elements(v -> 'profesores') e WHERE e ->> 'apellido' = 'Zorrilla'),
        'H1 profesores');
    PERFORM pg_temp.exigir(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v -> 'profesores') e WHERE e ->> 'apellido' IN ('Padre', 'Personal')),
        'H1 solo aparecen docentes entre los responsables posibles');
    PERFORM pg_temp.exigir(EXISTS (SELECT 1 FROM jsonb_array_elements(v -> 'horarios') e
                                   WHERE (e ->> 'dia_semana')::INT = 1 AND e ->> 'hora_inicio' = '08:00' AND e ->> 'hora_fin' = '09:00'), 'H1 horarios legibles');
    PERFORM pg_temp.ok('H1: el catálogo trae niveles, cursos, materias, deportes, recorridos, horarios y solo docentes como responsables');
END $$;


-- ================================================================
-- Z. LOS REPORTES NO ESCRIBEN
-- ================================================================
DO $$
BEGIN
    PERFORM pg_temp.exigir(pg_temp.huella() = pg_temp.fx('h_datos'), 'Z1 los reportes modificaron matrículas, asignaciones, grupos, inscripciones o confirmaciones');
    PERFORM pg_temp.ok('Z1: matrículas, asignaciones, grupos, inscripciones y confirmaciones quedan idénticos tras todas las lecturas');
END $$;

ROLLBACK;
