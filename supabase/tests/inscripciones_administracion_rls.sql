-- ============================================================
-- EDUCAR PARA TRANSFORMAR — Verificación de la administración de inscripciones (EPT-62, RF16)
-- ============================================================
-- Verifica la migración 20260928193259_ept_62_administracion_inscripciones.sql.
--
-- Ejecutar exclusivamente contra la base local descartable. Todo ocurre dentro
-- de una transacción con ROLLBACK: no deja datos residuales.
--
--     docker cp supabase/tests/inscripciones_administracion_rls.sql \
--       supabase_db_educar-para-transformar:/tmp/
--     docker exec supabase_db_educar-para-transformar \
--       psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 \
--       -f /tmp/inscripciones_administracion_rls.sql
--
-- Cada comprobación imprime `OK <código>` o aborta con `FALLO <código>`. Una
-- recursión de políticas (42P17) cuenta como fallo aunque llegue como
-- «denegación». El código de cada comprobación aparece entre corchetes con el
-- criterio de RF16 o la decisión de producto que prueba:
--
--   Criterios de RF16
--     [RF16-consultar]  la Dirección consulta las inscripciones de los tres modelos
--     [RF16-confirmar]  la Dirección confirma una inscripción vigente
--     [RF16-cancelar]   la Dirección cancela en nombre del alumno o cierra la matrícula
--     [RF16-unicidad]   la unicidad y los límites de cada modelo siguen vigentes
--
--   Decisiones de producto de la migración (cabecera de la migración)
--     [D1] confirmar es una acción real, registrada, solo de Dirección
--     [D2] la confirmación es posterior al alta y no condiciona la vigencia
--     [D3] confirmar es idempotente; lo cancelado o cerrado no se confirma; la
--          marca histórica se conserva
--     [D4] Dirección cancela servicios y deportes con operaciones nuevas; las RPC
--          de cancelación propia (013, 014) no cambian
--     [D5] la matrícula no se cancela: se cierra con el flujo de 008
--     [D6] sin borrado físico en los tres modelos
--
-- Mapa de secciones
--   A. permisos, privilegios, RLS y EXECUTE
--   B. confirmar por dominio: primera vez, idempotencia, errores de identidad
--   C. cancelación administrativa: efectos, repetición, cupo, límite, reinscripción
--   D. matrícula cerrada: no se confirma
--   E. historia preservada tras cancelar o cerrar
--   F. las RPC del alumno siguen igual
--   G. la confirmación no condiciona la vigencia
--   H. lecturas: RLS del registro y vistas administrativas
--   I. sin borrado físico y registro append-only
--   J. unicidad e invariantes que las operaciones nuevas no rompen
--
-- Todos los datos son sintéticos: DNI en un rango libre elegido en tiempo de
-- ejecución, sin correspondencia con ninguna persona real.

\set ON_ERROR_STOP on
-- Solo interesan los avisos OK/FALLO: las consultas no imprimen filas.
\pset tuples_only on
\o /dev/null

BEGIN;

-- ================================================================
-- 0. HERRAMIENTAS
-- ================================================================
CREATE FUNCTION pg_temp.u(p_sufijo TEXT)
RETURNS UUID LANGUAGE sql IMMUTABLE AS $$
    SELECT ('ea620000-0000-4000-8000-0000000000' || p_sufijo)::UUID;
$$;

-- Ejecuta como el actor y CONSERVA los efectos si no hay error. Devuelve
-- `OK:<valor>` o `E:<SQLSTATE>`. Con `p_sub` NULL la sesión no tiene `sub`.
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

-- Ejecuta como propietario (el rol de la sesión) y devuelve `OK` o `E:<SQLSTATE>`.
CREATE FUNCTION pg_temp.propietario(p_sql TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
    EXECUTE p_sql;
    RETURN 'OK';
EXCEPTION WHEN OTHERS THEN
    RETURN 'E:' || SQLSTATE;
END;
$$;

-- `p_esperado` es 'OK' o un SQLSTATE. Nunca acepta 42P17.
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

-- Valor devuelto por una operación ejecutada con éxito (`OK:<valor>`).
CREATE FUNCTION pg_temp.valor(p_resultado TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
    IF p_resultado NOT LIKE 'OK:%' THEN
        RAISE EXCEPTION 'FALLO se esperaba éxito y se obtuvo %', p_resultado;
    END IF;
    RETURN pg_catalog.substr(p_resultado, 4);
END;
$$;

CREATE FUNCTION pg_temp.jv(p_resultado TEXT)
RETURNS JSONB LANGUAGE sql AS $$
    SELECT pg_temp.valor(p_resultado)::JSONB;
$$;

CREATE TEMPORARY TABLE fx (clave TEXT PRIMARY KEY, valor TEXT NOT NULL) ON COMMIT DROP;

CREATE FUNCTION pg_temp.fx(p_clave TEXT)
RETURNS TEXT LANGUAGE sql STABLE AS $$
    SELECT valor FROM fx WHERE clave = p_clave;
$$;

CREATE FUNCTION pg_temp.fxu(p_clave TEXT)
RETURNS UUID LANGUAGE sql STABLE AS $$
    SELECT valor::UUID FROM fx WHERE clave = p_clave;
$$;

CREATE FUNCTION pg_temp.guardar(p_clave TEXT, p_valor TEXT)
RETURNS VOID LANGUAGE sql AS $$
    INSERT INTO fx (clave, valor) VALUES (p_clave, p_valor)
    ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor;
$$;

-- Huella del contenido completo de una tabla y de las tres tablas de inscripción.
CREATE FUNCTION pg_temp.huella(p_tabla TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
    v TEXT;
BEGIN
    EXECUTE pg_catalog.format(
        'SELECT pg_catalog.md5(COALESCE(pg_catalog.string_agg(t::TEXT, %L ORDER BY t.id), %L)) FROM public.%I t',
        ';', '', p_tabla) INTO v;
    RETURN v;
END;
$$;

CREATE FUNCTION pg_temp.huella3()
RETURNS TEXT LANGUAGE sql AS $$
    SELECT pg_catalog.md5(pg_temp.huella('matriculas')
                          || pg_temp.huella('inscripciones_deportivas')
                          || pg_temp.huella('inscripciones_servicios'));
$$;

-- Plantillas de las cinco operaciones (siete llamadas: confirmar y cancelar
-- servicios se ejercen con COMEDOR y con TRANSPORTE).
CREATE FUNCTION pg_temp.plantilla(p_op TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE p_op
        WHEN 'conf_mat' THEN 'SELECT public.confirmar_matricula(%L)::TEXT'
        WHEN 'conf_dep' THEN 'SELECT public.confirmar_inscripcion_deportiva(%L)::TEXT'
        WHEN 'conf_com' THEN 'SELECT public.confirmar_inscripcion_servicio(%L, ''COMEDOR'')::TEXT'
        WHEN 'conf_tra' THEN 'SELECT public.confirmar_inscripcion_servicio(%L, ''TRANSPORTE'')::TEXT'
        WHEN 'canc_dep' THEN 'SELECT (public.cancelar_inscripcion_deportiva_administrativa(%L)).id::TEXT'
        WHEN 'canc_com' THEN 'SELECT (public.cancelar_inscripcion_servicio_administrativa(%L, ''COMEDOR'')).id::TEXT'
        WHEN 'canc_tra' THEN 'SELECT (public.cancelar_inscripcion_servicio_administrativa(%L, ''TRANSPORTE'')).id::TEXT'
    END;
$$;

CREATE FUNCTION pg_temp.op(p_rol TEXT, p_sub UUID, p_op TEXT, p_id UUID)
RETURNS TEXT LANGUAGE sql AS $$
    SELECT pg_temp.ejecutar(p_rol, p_sub, pg_catalog.format(pg_temp.plantilla(p_op), p_id));
$$;

-- La directora habilitada (01) y la otra directora habilitada (03).
CREATE FUNCTION pg_temp.dir(p_op TEXT, p_id UUID)
RETURNS TEXT LANGUAGE sql AS $$
    SELECT pg_temp.op('authenticated', pg_temp.u('01'), p_op, p_id);
$$;

CREATE FUNCTION pg_temp.dir2(p_op TEXT, p_id UUID)
RETURNS TEXT LANGUAGE sql AS $$
    SELECT pg_temp.op('authenticated', pg_temp.u('03'), p_op, p_id);
$$;

CREATE FUNCTION pg_temp.dirsql(p_sql TEXT)
RETURNS TEXT LANGUAGE sql AS $$
    SELECT pg_temp.ejecutar('authenticated', pg_temp.u('01'), p_sql);
$$;

CREATE FUNCTION pg_temp.est(p_sufijo TEXT, p_sql TEXT)
RETURNS TEXT LANGUAGE sql AS $$
    SELECT pg_temp.ejecutar('authenticated', pg_temp.u(p_sufijo), p_sql);
$$;

-- Lecturas del registro y de las tablas, como propietario.
CREATE FUNCTION pg_temp.total_conf()
RETURNS BIGINT LANGUAGE sql AS $$
    SELECT pg_catalog.count(*) FROM public.confirmaciones_inscripcion;
$$;

-- p_dom: MATRICULA, DEPORTE, COMEDOR o TRANSPORTE.
CREATE FUNCTION pg_temp.n_conf(p_dom TEXT, p_id UUID)
RETURNS BIGINT LANGUAGE sql AS $$
    SELECT pg_catalog.count(*) FROM public.confirmaciones_inscripcion c
    WHERE CASE p_dom WHEN 'MATRICULA' THEN c.matricula_id
                     WHEN 'DEPORTE' THEN c.inscripcion_deportiva_id
                     ELSE c.inscripcion_servicio_id END = p_id;
$$;

CREATE FUNCTION pg_temp.conf_id(p_dom TEXT, p_id UUID)
RETURNS UUID LANGUAGE sql AS $$
    SELECT c.id FROM public.confirmaciones_inscripcion c
    WHERE CASE p_dom WHEN 'MATRICULA' THEN c.matricula_id
                     WHEN 'DEPORTE' THEN c.inscripcion_deportiva_id
                     ELSE c.inscripcion_servicio_id END = p_id;
$$;

CREATE FUNCTION pg_temp.conf_fila(p_dom TEXT, p_id UUID)
RETURNS TEXT LANGUAGE sql AS $$
    SELECT c::TEXT FROM public.confirmaciones_inscripcion c
    WHERE c.id = pg_temp.conf_id(p_dom, p_id);
$$;

CREATE FUNCTION pg_temp.tabla_de(p_dom TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE p_dom WHEN 'DEPORTE' THEN 'inscripciones_deportivas' ELSE 'inscripciones_servicios' END;
$$;

CREATE FUNCTION pg_temp.vista_de(p_dom TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE p_dom WHEN 'MATRICULA' THEN 'matriculas_administracion'
                      WHEN 'DEPORTE' THEN 'inscripciones_deportivas_administracion'
                      ELSE 'inscripciones_servicios_administracion' END;
$$;

CREATE FUNCTION pg_temp.estado_de(p_dom TEXT, p_id UUID)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
    v TEXT;
BEGIN
    EXECUTE pg_catalog.format('SELECT estado::TEXT FROM public.%I WHERE id = %L',
                              pg_temp.tabla_de(p_dom), p_id) INTO v;
    RETURN v;
END;
$$;

CREATE FUNCTION pg_temp.cancelada_en(p_dom TEXT, p_id UUID)
RETURNS TIMESTAMP WITH TIME ZONE LANGUAGE plpgsql AS $$
DECLARE
    v TIMESTAMP WITH TIME ZONE;
BEGIN
    EXECUTE pg_catalog.format('SELECT fecha_cancelacion FROM public.%I WHERE id = %L',
                              pg_temp.tabla_de(p_dom), p_id) INTO v;
    RETURN v;
END;
$$;

CREATE FUNCTION pg_temp.xmin_de(p_dom TEXT, p_id UUID)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
    v TEXT;
BEGIN
    EXECUTE pg_catalog.format('SELECT xmin::TEXT FROM public.%I WHERE id = %L',
                              pg_temp.tabla_de(p_dom), p_id) INTO v;
    RETURN v;
END;
$$;

CREATE FUNCTION pg_temp.filas_de(p_dom TEXT, p_alumno UUID)
RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE
    v BIGINT;
BEGIN
    EXECUTE pg_catalog.format('SELECT pg_catalog.count(*) FROM public.%I WHERE alumno_id = %L',
                              pg_temp.tabla_de(p_dom), p_alumno) INTO v;
    RETURN v;
END;
$$;

-- Fila de la vista administrativa como JSON, vista por la directora 01. NULL si no aparece.
CREATE FUNCTION pg_temp.ver(p_dom TEXT, p_id UUID)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
    v TEXT;
BEGIN
    v := pg_temp.dirsql(pg_catalog.format(
        'SELECT pg_catalog.to_jsonb(v)::TEXT FROM public.%I v WHERE v.id = %L',
        pg_temp.vista_de(p_dom), p_id));
    IF v = 'OK:<NULL>' THEN
        RETURN NULL;
    END IF;
    RETURN pg_temp.jv(v);
END;
$$;

CREATE FUNCTION pg_temp.filas(p_rol TEXT, p_sub UUID, p_relacion TEXT)
RETURNS TEXT LANGUAGE sql AS $$
    SELECT pg_temp.ejecutar(p_rol, p_sub, 'SELECT pg_catalog.count(*)::TEXT FROM public.' || p_relacion);
$$;

CREATE FUNCTION pg_temp.crear_grupo(p_clave TEXT, p_deporte TEXT, p_nombre TEXT, p_cupo INTEGER, p_dia INTEGER)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
    v TEXT;
BEGIN
    v := pg_temp.dirsql(pg_catalog.format(
        'SELECT (public.crear_grupo_deportivo(%L, %s, %L, %s, %L)).id::TEXT',
        p_deporte, (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'),
        p_nombre, p_cupo, pg_temp.u('04')));
    PERFORM pg_temp.esperar(v, 'OK', 'datos: grupo ' || p_clave);
    PERFORM pg_temp.guardar(p_clave, pg_temp.valor(v));
    PERFORM pg_temp.esperar(pg_temp.dirsql(pg_catalog.format(
        'SELECT (public.agregar_horario_grupo_deportivo(%L, %s::smallint, %L, %L)).id::TEXT',
        pg_temp.fx(p_clave), p_dia, '08:00', '09:00')), 'OK', 'datos: franja ' || p_clave);
END;
$$;

-- Alta como alumno y registro del id: `p_tipo` es 'dep' (grupo), 'com' o 'tra' (N o S).
CREATE FUNCTION pg_temp.sql_alta(p_tipo TEXT, p_arg TEXT)
RETURNS TEXT LANGUAGE sql AS $$
    SELECT CASE p_tipo
        WHEN 'dep' THEN pg_catalog.format('SELECT (public.inscribir_en_grupo_deportivo(%L)).id::TEXT', pg_temp.fx(p_arg))
        WHEN 'com' THEN 'SELECT (public.inscribir_en_servicio(''e0000000-0000-4000-8000-000000000010'')).id::TEXT'
        WHEN 'tra' THEN pg_catalog.format('SELECT (public.establecer_recorrido_transporte(%L)).id::TEXT',
                            CASE p_arg WHEN 'N' THEN 'e0000000-0000-4000-8000-000000000020'
                                       ELSE 'e0000000-0000-4000-8000-000000000021' END)
    END;
$$;

CREATE FUNCTION pg_temp.alta(p_clave TEXT, p_sufijo TEXT, p_tipo TEXT, p_arg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
    v TEXT;
BEGIN
    v := pg_temp.est(p_sufijo, pg_temp.sql_alta(p_tipo, p_arg));
    PERFORM pg_temp.esperar(v, 'OK', 'datos: alta ' || p_clave);
    PERFORM pg_temp.guardar(p_clave, pg_temp.valor(v));
END;
$$;


-- ================================================================
-- DATOS SINTÉTICOS
-- ================================================================
WITH base_libre AS (
    SELECT base
    FROM generate_series(94000000, 94999980, 20) AS g(base)
    WHERE NOT EXISTS (
        SELECT 1 FROM public.perfiles p
        WHERE p.dni IN (SELECT (base + k)::TEXT FROM generate_series(1, 16) AS s(k))
    )
    ORDER BY base
    LIMIT 1
), identidades(sufijo, rol, apellido, legajo, desplazamiento, estado_acceso) AS (
    VALUES
        ('01', 'DIRECTOR',   'Directora Uno',       NULL,             1, 'HABILITADO'),
        ('02', 'DIRECTOR',   'Directora Bloqueada', NULL,             2, 'BLOQUEADO'),
        ('03', 'DIRECTOR',   'Directora Dos',       NULL,             3, 'HABILITADO'),
        ('04', 'DOCENTE',    'Docente',             NULL,             4, 'HABILITADO'),
        ('05', 'PADRE',      'Padre',               NULL,             5, 'HABILITADO'),
        ('06', 'PERSONAL',   'Personal',            NULL,             6, 'HABILITADO'),
        ('07', 'ESTUDIANTE', 'Alumna A',            'LEG-EPT62-0007', 7, 'HABILITADO'),
        ('08', 'ESTUDIANTE', 'Alumno B',            'LEG-EPT62-0008', 8, 'HABILITADO'),
        ('09', 'ESTUDIANTE', 'Alumno C',            'LEG-EPT62-0009', 9, 'HABILITADO'),
        ('0a', 'ESTUDIANTE', 'Alumno D',            'LEG-EPT62-000A', 10, 'HABILITADO'),
        ('0b', 'ESTUDIANTE', 'Alumno E',            'LEG-EPT62-000B', 11, 'HABILITADO'),
        ('0d', 'ESTUDIANTE', 'Alumno F',            'LEG-EPT62-000D', 12, 'HABILITADO')
)
INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni, legajo_nro, estado_acceso)
SELECT pg_temp.u(i.sufijo), pg_temp.u(i.sufijo), r.id, 'Prueba', i.apellido,
       (b.base + i.desplazamiento)::TEXT, i.legajo, i.estado_acceso::public.estado_acceso
FROM identidades i
JOIN public.roles r ON r.nombre = i.rol
CROSS JOIN base_libre b;

-- La cuenta autenticada sin perfil es `…0c`: no tiene fila.

INSERT INTO public.cursos (id, nivel_id, denominacion, division, activo)
VALUES (pg_temp.u('c1'), (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'),
        'Curso EPT-62 A', 'A', TRUE),
       (pg_temp.u('c2'), (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'),
        'Curso EPT-62 B', 'B', TRUE);

INSERT INTO public.matriculas (alumno_id, curso_id)
SELECT pg_temp.u(s), pg_temp.u('c1') FROM unnest(ARRAY['07', '08', '09', '0a', '0b', '0d']) AS s;

UPDATE public.alumnos SET estado = 'ACTIVO'
WHERE perfil_id IN (SELECT pg_temp.u(s) FROM unnest(ARRAY['07', '08', '09', '0a', '0b', '0d']) AS s);

SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

-- Matrículas vigentes de partida.
INSERT INTO fx (clave, valor)
SELECT k, (SELECT m.id::TEXT FROM public.matriculas m WHERE m.alumno_id = pg_temp.u(s) AND m.fecha_cierre IS NULL)
FROM (VALUES ('mA', '07'), ('mB1', '08'), ('mD', '0a'), ('mE1', '0b'), ('mF', '0d')) AS v(k, s);

-- Grupos deportivos con las RPC vigentes (014, EPT-57): una franja por grupo, en
-- días distintos para que un mismo alumno no tenga superposición.
SELECT pg_temp.crear_grupo('g1', 'e0000000-0000-4000-8000-000000000101', 'Fútbol EPT62 A',   5, 1);
SELECT pg_temp.crear_grupo('g2', 'e0000000-0000-4000-8000-000000000102', 'Natación EPT62',   5, 2);
SELECT pg_temp.crear_grupo('g3', 'e0000000-0000-4000-8000-000000000105', 'Vóley EPT62 cupo1', 1, 3);
SELECT pg_temp.crear_grupo('g4', 'e0000000-0000-4000-8000-000000000106', 'Básquet EPT62',    5, 4);
SELECT pg_temp.crear_grupo('g5', 'e0000000-0000-4000-8000-000000000101', 'Fútbol EPT62 B',   5, 5);

-- Alta de las inscripciones de partida con las RPC de los alumnos (013, 014, EPT-60).
SELECT pg_temp.alta('iA_g1', '07', 'dep', 'g1');
SELECT pg_temp.alta('sA_com', '07', 'com', NULL);
SELECT pg_temp.alta('sA_tra', '07', 'tra', 'N');
SELECT pg_temp.alta('iB_g3', '08', 'dep', 'g3');
SELECT pg_temp.alta('sB_com', '08', 'com', NULL);
SELECT pg_temp.alta('sB_tra', '08', 'tra', 'S');
SELECT pg_temp.alta('iC_g1', '09', 'dep', 'g1');
SELECT pg_temp.alta('iC_g2', '09', 'dep', 'g2');
SELECT pg_temp.alta('sF_com', '0d', 'com', NULL);

SELECT pg_temp.guardar('h_datos', pg_temp.huella3());


-- ================================================================
-- A. PERMISOS, PRIVILEGIOS, RLS Y EXECUTE
-- ================================================================
-- A1. Denegación por rol en las CINCO funciones (siete llamadas: confirmar y
-- cancelar servicio con COMEDOR y con TRANSPORTE). El orden de chequeo de la
-- migración es identidad, rol, id: un actor sin rol de Dirección no aprende
-- si la fila existe.
DO $$
DECLARE
    v_actor RECORD;
    v_op    RECORD;
    v_res   TEXT;
    v_h     TEXT := pg_temp.huella3();
BEGIN
    FOR v_actor IN
        SELECT * FROM (VALUES
            ('ESTUDIANTE dueña',    'authenticated', pg_temp.u('07')),
            ('ESTUDIANTE ajeno',    'authenticated', pg_temp.u('08')),
            ('PADRE',               'authenticated', pg_temp.u('05')),
            ('DOCENTE',             'authenticated', pg_temp.u('04')),
            ('PERSONAL',            'authenticated', pg_temp.u('06')),
            ('SIN PERFIL',          'authenticated', pg_temp.u('0c')),
            ('DIRECTOR BLOQUEADO',  'authenticated', pg_temp.u('02')),
            ('ANON',                'anon',          NULL::UUID)
        ) AS a(etiqueta, rol, sub)
    LOOP
        FOR v_op IN
            SELECT * FROM (VALUES
                ('conf_mat', 'mA'), ('conf_dep', 'iA_g1'), ('conf_com', 'sA_com'), ('conf_tra', 'sA_tra'),
                ('canc_dep', 'iA_g1'), ('canc_com', 'sA_com'), ('canc_tra', 'sA_tra')
            ) AS o(op, clave)
        LOOP
            v_res := pg_temp.op(v_actor.rol, v_actor.sub, v_op.op, pg_temp.fxu(v_op.clave));
            IF v_res = 'E:42P17' THEN
                RAISE EXCEPTION 'FALLO A1: % / % → recursión de políticas (42P17)', v_actor.etiqueta, v_op.op;
            END IF;
            IF v_res <> 'E:42501' THEN
                RAISE EXCEPTION 'FALLO A1: % / % → se obtuvo %, se esperaba E:42501', v_actor.etiqueta, v_op.op, v_res;
            END IF;
        END LOOP;
    END LOOP;

    IF pg_temp.total_conf() <> 0 OR pg_temp.huella3() <> v_h OR v_h <> pg_temp.fx('h_datos') THEN
        RAISE EXCEPTION 'FALLO A1: una denegación dejó una confirmación o cambió una fila';
    END IF;
    PERFORM pg_temp.ok('A1 [D1, D4 solo Dirección]: ESTUDIANTE (dueña y ajeno), PADRE, DOCENTE, PERSONAL, sin perfil, DIRECTOR bloqueado (EPT-59) y anon reciben 42501 en las cinco funciones; sin 42P17 y sin efectos');
END $$;

-- A2. Un id nulo no cambia la respuesta a quien no administra (no delata nada),
-- y una sesión sin identidad recibe P5505 en las cinco funciones.
DO $$
DECLARE
    v_op  RECORD;
    v_res TEXT;
BEGIN
    FOR v_op IN
        SELECT * FROM (VALUES ('conf_mat'), ('conf_dep'), ('conf_com'), ('conf_tra'),
                              ('canc_dep'), ('canc_com'), ('canc_tra')) AS o(op)
    LOOP
        PERFORM pg_temp.esperar(pg_temp.op('authenticated', pg_temp.u('07'), v_op.op, NULL::UUID),
                                '42501', 'A2 estudiante con id nulo ' || v_op.op);
        PERFORM pg_temp.esperar(pg_temp.op('anon', NULL, v_op.op, NULL::UUID),
                                '42501', 'A2 anon con id nulo ' || v_op.op);
        v_res := pg_temp.op('authenticated', NULL, v_op.op, pg_temp.fxu('mA'));
        IF v_res <> 'E:P5505' THEN
            RAISE EXCEPTION 'FALLO A2: sin identidad / % → se obtuvo %, se esperaba E:P5505', v_op.op, v_res;
        END IF;
    END LOOP;
    IF pg_temp.total_conf() <> 0 OR pg_temp.huella3() <> pg_temp.fx('h_datos') THEN
        RAISE EXCEPTION 'FALLO A2: una denegación cambió datos';
    END IF;
    PERFORM pg_temp.ok('A2 [D1]: un id nulo recibe 42501 para estudiante y anon (el rol se chequea antes que el id); una sesión authenticated sin identidad recibe P5505 en las cinco funciones');
END $$;

-- A3. Dirección habilitada SÍ pasa el control de permisos: llega a la lógica y
-- responde P6201 ante una fila inexistente (ni 42501 ni P5505).
DO $$
DECLARE
    v_op RECORD;
BEGIN
    FOR v_op IN
        SELECT * FROM (VALUES ('conf_mat'), ('conf_dep'), ('conf_com'), ('conf_tra'),
                              ('canc_dep'), ('canc_com'), ('canc_tra')) AS o(op)
    LOOP
        PERFORM pg_temp.esperar(pg_temp.dir(v_op.op, pg_catalog.gen_random_uuid()), 'P6201',
                                'A3 directora 01 ' || v_op.op);
        PERFORM pg_temp.esperar(pg_temp.dir2(v_op.op, pg_catalog.gen_random_uuid()), 'P6201',
                                'A3 directora 03 ' || v_op.op);
    END LOOP;
    PERFORM pg_temp.ok('A3 [D1, D4]: las dos directoras habilitadas pasan el control de identidad y de rol en las cinco funciones (responden P6201 ante una fila inexistente)');
END $$;

-- A4. Privilegios de tabla: ningún rol de aplicación escribe ninguno de los
-- cuatro objetos, ni a nivel de tabla ni de columna. Sobre el registro, solo
-- authenticated lee.
DO $$
DECLARE
    v_rol   TEXT;
    v_tabla TEXT;
    v_priv  TEXT;
BEGIN
    FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        FOREACH v_tabla IN ARRAY ARRAY[
            'public.confirmaciones_inscripcion', 'public.matriculas',
            'public.inscripciones_deportivas', 'public.inscripciones_servicios'
        ] LOOP
            FOREACH v_priv IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
                IF has_table_privilege(v_rol, v_tabla, v_priv) THEN
                    RAISE EXCEPTION 'FALLO A4: % conserva % sobre %', v_rol, v_priv, v_tabla;
                END IF;
            END LOOP;
            IF has_any_column_privilege(v_rol, v_tabla, 'INSERT')
               OR has_any_column_privilege(v_rol, v_tabla, 'UPDATE')
               OR has_any_column_privilege(v_rol, v_tabla, 'REFERENCES') THEN
                RAISE EXCEPTION 'FALLO A4: % conserva un privilegio de columna de escritura sobre %', v_rol, v_tabla;
            END IF;
        END LOOP;
    END LOOP;

    FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
        IF has_table_privilege('service_role', 'public.confirmaciones_inscripcion', v_priv) THEN
            RAISE EXCEPTION 'FALLO A4: service_role conserva % sobre el registro de confirmaciones', v_priv;
        END IF;
    END LOOP;

    IF has_table_privilege('anon', 'public.confirmaciones_inscripcion', 'SELECT')
       OR NOT has_table_privilege('authenticated', 'public.confirmaciones_inscripcion', 'SELECT') THEN
        RAISE EXCEPTION 'FALLO A4: la lectura del registro no quedó limitada a authenticated';
    END IF;

    IF EXISTS (
        SELECT 1 FROM unnest(ARRAY['public.matriculas_administracion',
                                   'public.inscripciones_deportivas_administracion',
                                   'public.inscripciones_servicios_administracion']) AS v(vista)
        WHERE has_table_privilege('anon', v.vista, 'SELECT')
           OR NOT has_table_privilege('authenticated', v.vista, 'SELECT')
           OR has_table_privilege('authenticated', v.vista, 'INSERT')
           OR has_table_privilege('authenticated', v.vista, 'UPDATE')
           OR has_table_privilege('authenticated', v.vista, 'DELETE')
    ) THEN
        RAISE EXCEPTION 'FALLO A4: los privilegios de las vistas administrativas no son SELECT solo para authenticated';
    END IF;
    PERFORM pg_temp.ok('A4 [D6, RF16-consultar]: anon y authenticated sin INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES ni TRIGGER (tabla ni columna) sobre confirmaciones, matrículas e inscripciones; service_role sin acceso al registro; vistas administrativas solo SELECT para authenticated');
END $$;

-- A5. RLS del registro: activa, una única política permisiva (lectura), la
-- restrictiva de bloqueo de cuenta presente y ninguna política de escritura.
DO $$
BEGIN
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.confirmaciones_inscripcion'::regclass) THEN
        RAISE EXCEPTION 'FALLO A5: el registro de confirmaciones no tiene RLS';
    END IF;
    IF (SELECT count(*) FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'confirmaciones_inscripcion'
          AND permissive = 'PERMISSIVE') <> 1
       OR NOT EXISTS (SELECT 1 FROM pg_policies
                      WHERE schemaname = 'public' AND tablename = 'confirmaciones_inscripcion'
                        AND permissive = 'PERMISSIVE' AND cmd = 'SELECT'
                        AND roles = ARRAY['authenticated']::NAME[]
                        AND qual LIKE '%es_director_actual%') THEN
        RAISE EXCEPTION 'FALLO A5: la única política permisiva del registro debe ser SELECT solo para Dirección';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies
               WHERE schemaname = 'public' AND tablename = 'confirmaciones_inscripcion'
                 AND permissive = 'PERMISSIVE' AND cmd <> 'SELECT') THEN
        RAISE EXCEPTION 'FALLO A5: existe una política permisiva de escritura sobre el registro';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                   WHERE schemaname = 'public' AND tablename = 'confirmaciones_inscripcion'
                     AND policyname = 'Bloqueo de acceso sin datos protegidos'
                     AND permissive = 'RESTRICTIVE' AND cmd = 'ALL') THEN
        RAISE EXCEPTION 'FALLO A5: falta la política RESTRICTIVE de bloqueo de cuenta en el registro';
    END IF;
    -- Ninguna de las tres tablas de inscripción tiene política que conceda borrado.
    IF EXISTS (SELECT 1 FROM pg_policies
               WHERE schemaname = 'public'
                 AND tablename IN ('matriculas', 'inscripciones_deportivas', 'inscripciones_servicios',
                                   'confirmaciones_inscripcion')
                 AND permissive = 'PERMISSIVE' AND cmd IN ('DELETE', 'ALL', 'INSERT', 'UPDATE')) THEN
        RAISE EXCEPTION 'FALLO A5: existe una política permisiva de escritura o borrado sobre los modelos de inscripción';
    END IF;
    PERFORM pg_temp.ok('A5 [D1, D6]: registro con RLS, única política permisiva = SELECT solo Dirección, RESTRICTIVE de bloqueo de cuenta presente; ninguna política permisiva de INSERT, UPDATE, DELETE ni ALL en los cuatro objetos');
END $$;

-- A6. EXECUTE: solo authenticated en envoltorios y en app_private de las cinco
-- operaciones; ninguno para anon, service_role ni PUBLIC. Los auxiliares, para nadie.
DO $$
DECLARE
    v_firma regprocedure;
BEGIN
    FOREACH v_firma IN ARRAY ARRAY[
        'app_private.confirmar_matricula(uuid)'::regprocedure,
        'app_private.confirmar_inscripcion_deportiva(uuid)'::regprocedure,
        'app_private.confirmar_inscripcion_servicio(uuid,public.tipo_servicio_escolar)'::regprocedure,
        'app_private.cancelar_inscripcion_deportiva_administrativa(uuid)'::regprocedure,
        'app_private.cancelar_inscripcion_servicio_administrativa(uuid,public.tipo_servicio_escolar)'::regprocedure
    ] LOOP
        IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_firma)
           OR (SELECT proconfig FROM pg_proc WHERE oid = v_firma) IS DISTINCT FROM ARRAY['search_path=""'] THEN
            RAISE EXCEPTION 'FALLO A6: % no es SECURITY DEFINER con search_path vacío', v_firma;
        END IF;
    END LOOP;
    FOREACH v_firma IN ARRAY ARRAY[
        'public.confirmar_matricula(uuid)'::regprocedure,
        'public.confirmar_inscripcion_deportiva(uuid)'::regprocedure,
        'public.confirmar_inscripcion_servicio(uuid,public.tipo_servicio_escolar)'::regprocedure,
        'public.cancelar_inscripcion_deportiva_administrativa(uuid)'::regprocedure,
        'public.cancelar_inscripcion_servicio_administrativa(uuid,public.tipo_servicio_escolar)'::regprocedure
    ] LOOP
        IF (SELECT prosecdef FROM pg_proc WHERE oid = v_firma)
           OR (SELECT proconfig FROM pg_proc WHERE oid = v_firma) IS DISTINCT FROM ARRAY['search_path=""'] THEN
            RAISE EXCEPTION 'FALLO A6: el envoltorio % no es SECURITY INVOKER con search_path vacío', v_firma;
        END IF;
    END LOOP;

    FOREACH v_firma IN ARRAY ARRAY[
        'app_private.confirmar_matricula(uuid)'::regprocedure,
        'app_private.confirmar_inscripcion_deportiva(uuid)'::regprocedure,
        'app_private.confirmar_inscripcion_servicio(uuid,public.tipo_servicio_escolar)'::regprocedure,
        'app_private.cancelar_inscripcion_deportiva_administrativa(uuid)'::regprocedure,
        'app_private.cancelar_inscripcion_servicio_administrativa(uuid,public.tipo_servicio_escolar)'::regprocedure,
        'public.confirmar_matricula(uuid)'::regprocedure,
        'public.confirmar_inscripcion_deportiva(uuid)'::regprocedure,
        'public.confirmar_inscripcion_servicio(uuid,public.tipo_servicio_escolar)'::regprocedure,
        'public.cancelar_inscripcion_deportiva_administrativa(uuid)'::regprocedure,
        'public.cancelar_inscripcion_servicio_administrativa(uuid,public.tipo_servicio_escolar)'::regprocedure
    ] LOOP
        IF NOT has_function_privilege('authenticated', v_firma, 'EXECUTE')
           OR has_function_privilege('anon', v_firma, 'EXECUTE')
           OR has_function_privilege('service_role', v_firma, 'EXECUTE') THEN
            RAISE EXCEPTION 'FALLO A6: los privilegios de ejecución de % no son solo authenticated', v_firma;
        END IF;
        -- ACL exacta: solo el propietario y authenticated (ningún PUBLIC = grantee 0).
        IF EXISTS (
            SELECT 1 FROM pg_proc p, LATERAL aclexplode(p.proacl) a
            WHERE p.oid = v_firma
              AND a.grantee NOT IN (p.proowner, 'authenticated'::regrole::oid)
        ) OR (SELECT proacl FROM pg_proc WHERE oid = v_firma) IS NULL THEN
            RAISE EXCEPTION 'FALLO A6: la ACL de % concede EXECUTE a alguien más que el propietario y authenticated', v_firma;
        END IF;
    END LOOP;

    FOREACH v_firma IN ARRAY ARRAY[
        'app_private.describir_confirmacion(public.confirmaciones_inscripcion,uuid,boolean)'::regprocedure,
        'app_private.proteger_confirmacion_inscripcion()'::regprocedure
    ] LOOP
        IF has_function_privilege('anon', v_firma, 'EXECUTE')
           OR has_function_privilege('authenticated', v_firma, 'EXECUTE')
           OR has_function_privilege('service_role', v_firma, 'EXECUTE') THEN
            RAISE EXCEPTION 'FALLO A6: el auxiliar % es ejecutable por un rol de aplicación', v_firma;
        END IF;
        IF EXISTS (
            SELECT 1 FROM pg_proc p, LATERAL aclexplode(p.proacl) a
            WHERE p.oid = v_firma AND a.grantee <> p.proowner
        ) OR (SELECT proacl FROM pg_proc WHERE oid = v_firma) IS NULL THEN
            RAISE EXCEPTION 'FALLO A6: la ACL del auxiliar % concede EXECUTE a alguien además del propietario', v_firma;
        END IF;
    END LOOP;

    -- Ninguna operación recibe identidad, rol, actor, perfil ni alumno.
    IF EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('public', 'app_private')
          AND p.proname IN ('confirmar_matricula', 'confirmar_inscripcion_deportiva',
                            'confirmar_inscripcion_servicio',
                            'cancelar_inscripcion_deportiva_administrativa',
                            'cancelar_inscripcion_servicio_administrativa')
          AND EXISTS (SELECT 1 FROM unnest(COALESCE(p.proargnames, ARRAY[]::TEXT[])) AS a
                      WHERE a ILIKE '%user%' OR a ILIKE '%rol%' OR a ILIKE '%actor%'
                         OR a ILIKE '%perfil%' OR a ILIKE '%alumno%' OR a ILIKE '%director%'
                         OR a ILIKE '%confirmada%')
    ) THEN
        RAISE EXCEPTION 'FALLO A6: una operación acepta identidad, rol, actor, alumno o confirmador del llamador';
    END IF;
    PERFORM pg_temp.ok('A6 [D1, D4]: las diez firmas (5 envoltorios INVOKER + 5 DEFINER de app_private) ejecutables solo por authenticated (ACL exacta: sin anon, service_role ni PUBLIC); los dos auxiliares sin EXECUTE para nadie; ninguna recibe identidad, rol, actor ni alumno');
END $$;

-- A7. Intento REAL de escritura directa como Dirección habilitada, como
-- estudiante y como anon: 42501 en INSERT, UPDATE, DELETE y TRUNCATE.
DO $$
DECLARE
    v_actor RECORD;
    v_sql   RECORD;
    v_res   TEXT;
    v_h     TEXT := pg_temp.huella3();
BEGIN
    FOR v_actor IN
        SELECT * FROM (VALUES
            ('DIRECTORA',  'authenticated', pg_temp.u('01')),
            ('ESTUDIANTE', 'authenticated', pg_temp.u('07')),
            ('ANON',       'anon',          NULL::UUID)
        ) AS a(etiqueta, rol, sub)
    LOOP
        FOR v_sql IN
            SELECT * FROM (VALUES
                ('INSERT confirmaciones', pg_catalog.format(
                    'WITH x AS (INSERT INTO public.confirmaciones_inscripcion (dominio, matricula_id, confirmada_por) VALUES (''MATRICULA'', %L, %L) RETURNING 1) SELECT count(*)::TEXT FROM x',
                    pg_temp.fx('mA'), pg_temp.u('01'))),
                ('UPDATE confirmaciones', 'WITH x AS (UPDATE public.confirmaciones_inscripcion SET confirmada_en = now() RETURNING 1) SELECT count(*)::TEXT FROM x'),
                ('DELETE confirmaciones', 'WITH x AS (DELETE FROM public.confirmaciones_inscripcion RETURNING 1) SELECT count(*)::TEXT FROM x'),
                ('TRUNCATE confirmaciones', 'TRUNCATE public.confirmaciones_inscripcion'),
                ('INSERT matriculas', pg_catalog.format(
                    'WITH x AS (INSERT INTO public.matriculas (alumno_id, curso_id) VALUES (%L, %L) RETURNING 1) SELECT count(*)::TEXT FROM x',
                    pg_temp.u('07'), pg_temp.u('c2'))),
                ('UPDATE matriculas', 'WITH x AS (UPDATE public.matriculas SET fecha_cierre = now() RETURNING 1) SELECT count(*)::TEXT FROM x'),
                ('DELETE matriculas', 'WITH x AS (DELETE FROM public.matriculas RETURNING 1) SELECT count(*)::TEXT FROM x'),
                ('TRUNCATE matriculas', 'TRUNCATE public.matriculas CASCADE'),
                ('INSERT deportivas', pg_catalog.format(
                    'WITH x AS (INSERT INTO public.inscripciones_deportivas (alumno_id, grupo_id) VALUES (%L, %L) RETURNING 1) SELECT count(*)::TEXT FROM x',
                    pg_temp.u('07'), pg_temp.fx('g2'))),
                ('UPDATE deportivas', 'WITH x AS (UPDATE public.inscripciones_deportivas SET estado = ''CANCELADA'' RETURNING 1) SELECT count(*)::TEXT FROM x'),
                ('DELETE deportivas', 'WITH x AS (DELETE FROM public.inscripciones_deportivas RETURNING 1) SELECT count(*)::TEXT FROM x'),
                ('TRUNCATE deportivas', 'TRUNCATE public.inscripciones_deportivas CASCADE'),
                ('INSERT servicios', pg_catalog.format(
                    'WITH x AS (INSERT INTO public.inscripciones_servicios (alumno_id, servicio_id) VALUES (%L, %L) RETURNING 1) SELECT count(*)::TEXT FROM x',
                    pg_temp.u('08'), 'e0000000-0000-4000-8000-000000000010')),
                ('UPDATE servicios', 'WITH x AS (UPDATE public.inscripciones_servicios SET estado = ''CANCELADA'' RETURNING 1) SELECT count(*)::TEXT FROM x'),
                ('DELETE servicios', 'WITH x AS (DELETE FROM public.inscripciones_servicios RETURNING 1) SELECT count(*)::TEXT FROM x'),
                ('TRUNCATE servicios', 'TRUNCATE public.inscripciones_servicios CASCADE')
            ) AS s(etiqueta, sql)
        LOOP
            -- El estudiante y anon solo intentan sobre el registro y una tabla por dominio
            -- para no multiplicar la matriz sin aportar cobertura.
            v_res := pg_temp.ejecutar(v_actor.rol, v_actor.sub, v_sql.sql);
            IF v_res <> 'E:42501' THEN
                RAISE EXCEPTION 'FALLO A7: % / % → se obtuvo %, se esperaba E:42501', v_actor.etiqueta, v_sql.etiqueta, v_res;
            END IF;
        END LOOP;
    END LOOP;
    IF pg_temp.huella3() <> v_h OR pg_temp.total_conf() <> 0 THEN
        RAISE EXCEPTION 'FALLO A7: un intento de escritura directa cambió datos';
    END IF;
    PERFORM pg_temp.ok('A7 [D1, D6, RF16-unicidad]: la Dirección, un estudiante y anon reciben 42501 al intentar INSERT, UPDATE, DELETE y TRUNCATE directos sobre el registro, matrículas, inscripciones deportivas e inscripciones a servicios; no cambia ninguna fila');
END $$;


-- ================================================================
-- B. CONFIRMAR POR DOMINIO
-- ================================================================
SELECT pg_temp.guardar('h_b0', pg_temp.huella3());

-- B1. Primera confirmación de cada dominio: la hace la directora 01, la
-- persona confirmadora la deriva la base de auth.uid() y la fecha la sella la
-- base (transaction now(), no un valor del llamador).
DO $$
DECLARE
    v_dom  RECORD;
    v_id   UUID;
    v_res  TEXT;
    v_j    JSONB;
    v_fila public.confirmaciones_inscripcion;
BEGIN
    FOR v_dom IN
        SELECT * FROM (VALUES
            ('MATRICULA',  'conf_mat', 'mA',     'MATRICULA'),
            ('DEPORTE',    'conf_dep', 'iA_g1',  'DEPORTE'),
            ('COMEDOR',    'conf_com', 'sA_com', 'SERVICIO'),
            ('TRANSPORTE', 'conf_tra', 'sA_tra', 'SERVICIO')
        ) AS d(dom, op, clave, dominio)
    LOOP
        v_id := pg_temp.fxu(v_dom.clave);
        v_res := pg_temp.dir(v_dom.op, v_id);
        PERFORM pg_temp.esperar(v_res, 'OK', 'B1 primera confirmación ' || v_dom.dom);
        v_j := pg_temp.jv(v_res);

        SELECT * INTO v_fila FROM public.confirmaciones_inscripcion c
        WHERE c.id = pg_temp.conf_id(v_dom.dom, v_id);
        IF v_fila.id IS NULL THEN
            RAISE EXCEPTION 'FALLO B1: % no dejó fila de confirmación', v_dom.dom;
        END IF;

        IF v_j->>'dominio' <> v_dom.dominio
           OR (v_j->>'inscripcion_id')::UUID <> v_id
           OR (v_j->>'ya_confirmada')::BOOLEAN IS NOT FALSE
           OR v_j->>'confirmada_por_nombre' <> 'Prueba Directora Uno'
           OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v_j) AS k)
              <> ARRAY['confirmada_en', 'confirmada_por_nombre', 'dominio', 'inscripcion_id', 'ya_confirmada'] THEN
            RAISE EXCEPTION 'FALLO B1: % devolvió un contenido inesperado: %', v_dom.dom, v_j;
        END IF;
        IF v_fila.confirmada_por <> pg_temp.u('01') THEN
            RAISE EXCEPTION 'FALLO B1: % no quedó confirmada por el perfil de la directora', v_dom.dom;
        END IF;
        IF v_fila.confirmada_en IS NULL OR v_fila.confirmada_en <> pg_catalog.now()
           OR (v_j->>'confirmada_en')::TIMESTAMP WITH TIME ZONE <> v_fila.confirmada_en THEN
            RAISE EXCEPTION 'FALLO B1: % no tiene la fecha sellada por la base', v_dom.dom;
        END IF;
        IF pg_temp.n_conf(v_dom.dom, v_id) <> 1 OR v_fila.dominio::TEXT <> v_dom.dominio THEN
            RAISE EXCEPTION 'FALLO B1: % no dejó exactamente una confirmación de su dominio', v_dom.dom;
        END IF;

        PERFORM pg_temp.guardar('conf_fila_' || v_dom.dom, v_fila::TEXT);
    END LOOP;
    PERFORM pg_temp.ok('B1 [RF16-confirmar, D1]: matrícula, deporte, comedor y transporte se confirman; confirmada_por = perfil de la directora, confirmada_en sellado por la base, ya_confirmada=false, exactamente una fila de auditoría y un jsonb con solo cinco claves (sin exponer el UUID del confirmador)');
END $$;

-- B2 y B3. Repetir confirmar es idempotente: misma directora y OTRA directora
-- reciben la misma fila de auditoría, sin tocarla y sin cambiar al confirmador.
DO $$
DECLARE
    v_actor RECORD;
    v_dom   RECORD;
    v_id    UUID;
    v_res   TEXT;
    v_j     JSONB;
BEGIN
    FOR v_actor IN SELECT * FROM (VALUES ('01', 'B2'), ('03', 'B3')) AS a(sufijo, codigo) LOOP
        FOR v_dom IN
            SELECT * FROM (VALUES
                ('MATRICULA',  'conf_mat', 'mA'),
                ('DEPORTE',    'conf_dep', 'iA_g1'),
                ('COMEDOR',    'conf_com', 'sA_com'),
                ('TRANSPORTE', 'conf_tra', 'sA_tra')
            ) AS d(dom, op, clave)
        LOOP
            v_id := pg_temp.fxu(v_dom.clave);
            v_res := pg_temp.op('authenticated', pg_temp.u(v_actor.sufijo), v_dom.op, v_id);
            PERFORM pg_temp.esperar(v_res, 'OK', v_actor.codigo || ' repetición ' || v_dom.dom);
            v_j := pg_temp.jv(v_res);

            IF (v_j->>'ya_confirmada')::BOOLEAN IS NOT TRUE
               OR v_j->>'confirmada_por_nombre' <> 'Prueba Directora Uno'
               OR (v_j->>'confirmada_en')::TIMESTAMP WITH TIME ZONE
                  <> (SELECT c.confirmada_en FROM public.confirmaciones_inscripcion c
                      WHERE c.id = pg_temp.conf_id(v_dom.dom, v_id)) THEN
                RAISE EXCEPTION 'FALLO %: % debe devolver ya_confirmada=true con el confirmador y la fecha originales (%)',
                    v_actor.codigo, v_dom.dom, v_j;
            END IF;
            IF pg_temp.n_conf(v_dom.dom, v_id) <> 1
               OR pg_temp.conf_fila(v_dom.dom, v_id) <> pg_temp.fx('conf_fila_' || v_dom.dom) THEN
                RAISE EXCEPTION 'FALLO %: % modificó o duplicó la fila de auditoría', v_actor.codigo, v_dom.dom;
            END IF;
        END LOOP;
    END LOOP;
    PERFORM pg_temp.ok('B2 [D3 idempotencia]: repetir la confirmación de matrícula, deporte, comedor y transporte por la MISMA directora devuelve ya_confirmada=true, mismo id, confirmador y fecha; count(*) sigue en 1');
    PERFORM pg_temp.ok('B3 [D3 idempotencia]: OTRA directora (03) recibe la misma fila de auditoría (id, confirmada_por y confirmada_en idénticos, sin reemplazar a la primera confirmadora); count(*) sigue en 1');
END $$;

-- B4. Confirmar no altera las filas de las tres tablas (huella md5 antes/después).
DO $$
BEGIN
    PERFORM pg_temp.exigir(pg_temp.huella3() = pg_temp.fx('h_b0'),
        'B4: confirmar (primera vez, repetida y por otra directora) cambió alguna fila de matrículas, inscripciones deportivas o inscripciones a servicios');
    PERFORM pg_temp.exigir(pg_temp.total_conf() = 4, 'B4: el registro debería tener exactamente cuatro confirmaciones');
    PERFORM pg_temp.ok('B4 [D2 no condiciona la vigencia]: la huella md5 de matrículas + inscripciones deportivas + inscripciones a servicios es idéntica antes y después de confirmar; el registro tiene exactamente cuatro filas');
END $$;

-- B5. Fila inexistente, id nulo, tipo equivocado y dominio cruzado → P6201, sin
-- filas nuevas ni cambios.
DO $$
DECLARE
    v_op  RECORD;
    v_h   TEXT := pg_temp.huella3();
    v_n   BIGINT := pg_temp.total_conf();
BEGIN
    FOR v_op IN
        SELECT * FROM (VALUES ('conf_mat'), ('conf_dep'), ('conf_com'), ('conf_tra'),
                              ('canc_dep'), ('canc_com'), ('canc_tra')) AS o(op)
    LOOP
        PERFORM pg_temp.esperar(pg_temp.dir(v_op.op, pg_catalog.gen_random_uuid()), 'P6201', 'B5 inexistente ' || v_op.op);
        PERFORM pg_temp.esperar(pg_temp.dir(v_op.op, NULL::UUID), 'P6201', 'B5 nulo ' || v_op.op);
    END LOOP;

    -- Tipo de servicio equivocado: el id de transporte con COMEDOR y viceversa.
    PERFORM pg_temp.esperar(pg_temp.dir('conf_com', pg_temp.fxu('sA_tra')), 'P6201', 'B5 confirmar transporte como COMEDOR');
    PERFORM pg_temp.esperar(pg_temp.dir('conf_tra', pg_temp.fxu('sA_com')), 'P6201', 'B5 confirmar comedor como TRANSPORTE');
    PERFORM pg_temp.esperar(pg_temp.dir('canc_com', pg_temp.fxu('sB_tra')), 'P6201', 'B5 cancelar transporte como COMEDOR');
    PERFORM pg_temp.esperar(pg_temp.dir('canc_tra', pg_temp.fxu('sB_com')), 'P6201', 'B5 cancelar comedor como TRANSPORTE');
    -- Tipo nulo.
    PERFORM pg_temp.esperar(pg_temp.dirsql(pg_catalog.format(
        'SELECT public.confirmar_inscripcion_servicio(%L, NULL)::TEXT', pg_temp.fx('sA_com'))), 'P6201', 'B5 confirmar con tipo nulo');
    PERFORM pg_temp.esperar(pg_temp.dirsql(pg_catalog.format(
        'SELECT (public.cancelar_inscripcion_servicio_administrativa(%L, NULL)).id::TEXT', pg_temp.fx('sB_com'))), 'P6201', 'B5 cancelar con tipo nulo');
    -- Dominio cruzado: el id de una inscripción a servicio en la operación deportiva, etc.
    PERFORM pg_temp.esperar(pg_temp.dir('conf_dep', pg_temp.fxu('sA_com')), 'P6201', 'B5 servicio en confirmar deporte');
    PERFORM pg_temp.esperar(pg_temp.dir('canc_dep', pg_temp.fxu('sB_com')), 'P6201', 'B5 servicio en cancelar deporte');
    PERFORM pg_temp.esperar(pg_temp.dir('conf_mat', pg_temp.fxu('iA_g1')), 'P6201', 'B5 deporte en confirmar matrícula');
    PERFORM pg_temp.esperar(pg_temp.dir('conf_com', pg_temp.fxu('mA')), 'P6201', 'B5 matrícula en confirmar comedor');

    IF pg_temp.huella3() <> v_h OR pg_temp.total_conf() <> v_n THEN
        RAISE EXCEPTION 'FALLO B5: un rechazo P6201 dejó una fila o cambió datos';
    END IF;
    PERFORM pg_temp.ok('B5 [D3, RF16-confirmar, RF16-cancelar]: fila inexistente o id nulo → P6201 en las cinco funciones; id de transporte con COMEDOR y viceversa, tipo nulo y ids de otro dominio → P6201 (responde igual que una inexistente); sin filas nuevas ni cambios');
END $$;


-- ================================================================
-- C. CANCELACIÓN ADMINISTRATIVA
-- ================================================================
-- C1. Estado previo: el cupo lleno, el máximo de dos deportes y las reglas de
-- unicidad de 014/015 rechazan con sus códigos de siempre (la alumna E y C).
DO $$
BEGIN
    -- Vóley (cupo 1) ocupado por B: E no entra.
    PERFORM pg_temp.esperar(pg_temp.est('0b', pg_temp.sql_alta('dep', 'g3')), 'P5574', 'C1 cupo lleno');
    -- C está en Fútbol A y Natación: mismo grupo, mismo deporte y tercer deporte.
    PERFORM pg_temp.esperar(pg_temp.est('09', pg_temp.sql_alta('dep', 'g1')), 'P5575', 'C1 mismo grupo');
    PERFORM pg_temp.esperar(pg_temp.est('09', pg_temp.sql_alta('dep', 'g5')), 'P5576', 'C1 mismo deporte, otro grupo');
    PERFORM pg_temp.esperar(pg_temp.est('09', pg_temp.sql_alta('dep', 'g4')), 'P5577', 'C1 tercer deporte');
    -- Comedor y transporte: un servicio activo por alumno.
    PERFORM pg_temp.esperar(pg_temp.est('08', pg_temp.sql_alta('com', NULL)), '23505', 'C1 comedor duplicado');
    PERFORM pg_temp.ok('C1 [RF16-unicidad]: con todo activo, cupo lleno P5574, mismo grupo P5575, mismo deporte P5576 y tercer deporte P5577 se rechazan por RPC del alumno; un comedor duplicado se rechaza con 23505');
END $$;

-- C2. Cancelación administrativa válida de deporte, comedor y transporte sobre
-- filas SIN confirmar de la alumna B: estado CANCELADA, fecha sellada por la
-- base, misma fila (sin DELETE), y la fila sigue en la vista administrativa.
DO $$
DECLARE
    v_dom    RECORD;
    v_id     UUID;
    v_antes  BIGINT;
    v_res    TEXT;
    v_j      JSONB;
BEGIN
    FOR v_dom IN
        SELECT * FROM (VALUES
            ('DEPORTE',    'canc_dep', 'iB_g3'),
            ('COMEDOR',    'canc_com', 'sB_com'),
            ('TRANSPORTE', 'canc_tra', 'sB_tra')
        ) AS d(dom, op, clave)
    LOOP
        v_id := pg_temp.fxu(v_dom.clave);
        v_antes := pg_temp.filas_de(v_dom.dom, pg_temp.u('08'));
        IF pg_temp.estado_de(v_dom.dom, v_id) <> 'ACTIVA' OR pg_temp.cancelada_en(v_dom.dom, v_id) IS NOT NULL THEN
            RAISE EXCEPTION 'FALLO C2: % no partía ACTIVA y sin fecha de cancelación', v_dom.dom;
        END IF;

        v_res := pg_temp.dir(v_dom.op, v_id);
        PERFORM pg_temp.esperar(v_res, 'OK', 'C2 cancelación administrativa ' || v_dom.dom);

        IF pg_temp.valor(v_res) <> v_id::TEXT THEN
            RAISE EXCEPTION 'FALLO C2: % devolvió otra fila', v_dom.dom;
        END IF;
        IF pg_temp.estado_de(v_dom.dom, v_id) <> 'CANCELADA' THEN
            RAISE EXCEPTION 'FALLO C2: % no quedó CANCELADA', v_dom.dom;
        END IF;
        IF pg_temp.cancelada_en(v_dom.dom, v_id) IS NULL OR pg_temp.cancelada_en(v_dom.dom, v_id) <> pg_catalog.now() THEN
            RAISE EXCEPTION 'FALLO C2: % no tiene la fecha de cancelación sellada por la base', v_dom.dom;
        END IF;
        IF pg_temp.filas_de(v_dom.dom, pg_temp.u('08')) <> v_antes THEN
            RAISE EXCEPTION 'FALLO C2: % cambió la cantidad de filas (¿borrado físico?)', v_dom.dom;
        END IF;

        v_j := pg_temp.ver(v_dom.dom, v_id);
        IF v_j IS NULL OR v_j->>'estado' <> 'CANCELADA' OR v_j->>'fecha_cancelacion' IS NULL
           OR (v_j->>'confirmada')::BOOLEAN IS NOT FALSE THEN
            RAISE EXCEPTION 'FALLO C2: la vista administrativa no muestra la % cancelada y sin confirmar (%)', v_dom.dom, v_j;
        END IF;
    END LOOP;
    PERFORM pg_temp.ok('C2 [RF16-cancelar, D4]: la Dirección cancela una inscripción deportiva, una de comedor y una de transporte de la alumna B: estado CANCELADA, fecha_cancelacion sellada por la base, misma fila devuelta, misma cantidad de filas (sin DELETE) y la fila sigue visible en la vista administrativa');
END $$;

-- C3. Liberación de cupo y de límite por la baja administrativa.
--   * Vóley (cupo 1): B fue cancelada por Dirección; E ahora entra.
--   * C tiene dos deportes: tras la baja administrativa de Fútbol A entra a
--     Básquet, y volver a Fútbol A vuelve a chocar con el máximo (P5577).
DO $$
DECLARE
    v_res TEXT;
BEGIN
    v_res := pg_temp.est('0b', pg_temp.sql_alta('dep', 'g3'));
    PERFORM pg_temp.esperar(v_res, 'OK', 'C3 E entra a Vóley con el cupo liberado');
    PERFORM pg_temp.guardar('iE_g3', pg_temp.valor(v_res));
    PERFORM pg_temp.exigir((SELECT count(*) FROM public.inscripciones_deportivas
                            WHERE grupo_id = pg_temp.fxu('g3') AND estado = 'ACTIVA') = 1,
        'C3: el cupo de Vóley debe quedar exactamente en uno');
    -- Otra alumna sigue sin entrar: el cupo volvió a llenarse.
    PERFORM pg_temp.esperar(pg_temp.est('08', pg_temp.sql_alta('dep', 'g3')), 'P5574', 'C3 cupo lleno de nuevo');

    PERFORM pg_temp.esperar(pg_temp.dir('canc_dep', pg_temp.fxu('iC_g1')), 'OK', 'C3 baja administrativa de C en Fútbol A');
    v_res := pg_temp.est('09', pg_temp.sql_alta('dep', 'g4'));
    PERFORM pg_temp.esperar(v_res, 'OK', 'C3 C entra a Básquet con el límite liberado');
    PERFORM pg_temp.guardar('iC_g4', pg_temp.valor(v_res));
    PERFORM pg_temp.esperar(pg_temp.est('09', pg_temp.sql_alta('dep', 'g1')), 'P5577', 'C3 volver a Fútbol A choca con el máximo');
    PERFORM pg_temp.exigir((SELECT count(*) FROM public.inscripciones_deportivas
                            WHERE alumno_id = pg_temp.u('09') AND estado = 'ACTIVA') = 2,
        'C3: C debe tener exactamente dos deportes activos');
    PERFORM pg_temp.ok('C3 [RF16-cancelar, RF16-unicidad, D4]: la baja administrativa libera la plaza (Vóley cupo 1: P5574 antes, éxito después y P5574 otra vez cuando se llena) y libera un lugar del máximo de dos deportes (Básquet entra; volver a Fútbol A vuelve a dar P5577)');
END $$;

-- C4. Repetir la cancelación administrativa → P6203, sin reescribir la fila.
DO $$
DECLARE
    v_dom RECORD;
    v_id  UUID;
    v_x   TEXT;
    v_f   TIMESTAMP WITH TIME ZONE;
BEGIN
    FOR v_dom IN
        SELECT * FROM (VALUES
            ('DEPORTE',    'canc_dep', 'iB_g3'),
            ('COMEDOR',    'canc_com', 'sB_com'),
            ('TRANSPORTE', 'canc_tra', 'sB_tra')
        ) AS d(dom, op, clave)
    LOOP
        v_id := pg_temp.fxu(v_dom.clave);
        v_x := pg_temp.xmin_de(v_dom.dom, v_id);
        v_f := pg_temp.cancelada_en(v_dom.dom, v_id);
        PERFORM pg_temp.esperar(pg_temp.dir(v_dom.op, v_id), 'P6203', 'C4 repetir cancelación ' || v_dom.dom);
        PERFORM pg_temp.esperar(pg_temp.dir2(v_dom.op, v_id), 'P6203', 'C4 repetir por otra directora ' || v_dom.dom);
        IF pg_temp.xmin_de(v_dom.dom, v_id) <> v_x OR pg_temp.cancelada_en(v_dom.dom, v_id) IS DISTINCT FROM v_f THEN
            RAISE EXCEPTION 'FALLO C4: la repetición reescribió la fila de %', v_dom.dom;
        END IF;
    END LOOP;
    PERFORM pg_temp.ok('C4 [D3, RF16-cancelar]: repetir la cancelación administrativa (misma y otra directora) de deporte, comedor y transporte → P6203; la fila no se reescribe (xmin y fecha_cancelacion intactos)');
END $$;

-- C5. Confirmar una inscripción cancelada → P6202, sin fila de confirmación.
DO $$
DECLARE
    v_dom RECORD;
    v_n   BIGINT := pg_temp.total_conf();
BEGIN
    FOR v_dom IN
        SELECT * FROM (VALUES
            ('DEPORTE',    'conf_dep', 'iB_g3'),
            ('COMEDOR',    'conf_com', 'sB_com'),
            ('TRANSPORTE', 'conf_tra', 'sB_tra')
        ) AS d(dom, op, clave)
    LOOP
        PERFORM pg_temp.esperar(pg_temp.dir(v_dom.op, pg_temp.fxu(v_dom.clave)), 'P6202',
                                'C5 confirmar cancelada ' || v_dom.dom);
        PERFORM pg_temp.esperar(pg_temp.dir2(v_dom.op, pg_temp.fxu(v_dom.clave)), 'P6202',
                                'C5 confirmar cancelada por otra directora ' || v_dom.dom);
        IF pg_temp.n_conf(v_dom.dom, pg_temp.fxu(v_dom.clave)) <> 0 THEN
            RAISE EXCEPTION 'FALLO C5: % dejó una confirmación sobre una inscripción cancelada', v_dom.dom;
        END IF;
    END LOOP;
    PERFORM pg_temp.exigir(pg_temp.total_conf() = v_n, 'C5: el registro cambió de tamaño');
    PERFORM pg_temp.ok('C5 [D3, RF16-confirmar]: confirmar una inscripción cancelada (deporte, comedor, transporte) → P6202 para cualquiera de las dos directoras; ninguna fila de confirmación nueva');
END $$;

-- C6. Reinscripción tras la baja administrativa: es una FILA NUEVA y el ciclo
-- cancelado se conserva (comedor y transporte de B).
DO $$
DECLARE
    v_res TEXT;
BEGIN
    v_res := pg_temp.est('08', pg_temp.sql_alta('com', NULL));
    PERFORM pg_temp.esperar(v_res, 'OK', 'C6 B se reinscribe al comedor');
    PERFORM pg_temp.guardar('sB_com2', pg_temp.valor(v_res));
    v_res := pg_temp.est('08', pg_temp.sql_alta('tra', 'S'));
    PERFORM pg_temp.esperar(v_res, 'OK', 'C6 B se reinscribe a TR-SUR');
    PERFORM pg_temp.guardar('sB_tra2', pg_temp.valor(v_res));

    IF pg_temp.fx('sB_com2') = pg_temp.fx('sB_com') OR pg_temp.fx('sB_tra2') = pg_temp.fx('sB_tra') THEN
        RAISE EXCEPTION 'FALLO C6: la reinscripción reutilizó la fila cancelada';
    END IF;
    IF (SELECT count(*) FROM public.inscripciones_servicios
        WHERE alumno_id = pg_temp.u('08') AND servicio_id = 'e0000000-0000-4000-8000-000000000010') <> 2
       OR (SELECT count(*) FROM public.inscripciones_servicios
           WHERE alumno_id = pg_temp.u('08') AND servicio_id = 'e0000000-0000-4000-8000-000000000021') <> 2
       OR pg_temp.estado_de('COMEDOR', pg_temp.fxu('sB_com')) <> 'CANCELADA'
       OR pg_temp.estado_de('COMEDOR', pg_temp.fxu('sB_com2')) <> 'ACTIVA'
       OR pg_temp.estado_de('TRANSPORTE', pg_temp.fxu('sB_tra')) <> 'CANCELADA'
       OR pg_temp.estado_de('TRANSPORTE', pg_temp.fxu('sB_tra2')) <> 'ACTIVA' THEN
        RAISE EXCEPTION 'FALLO C6: no quedaron un ciclo cancelado y uno activo por servicio';
    END IF;
    IF pg_temp.n_conf('COMEDOR', pg_temp.fxu('sB_com2')) <> 0 OR pg_temp.n_conf('TRANSPORTE', pg_temp.fxu('sB_tra2')) <> 0 THEN
        RAISE EXCEPTION 'FALLO C6: la fila nueva nace confirmada';
    END IF;
    PERFORM pg_temp.ok('C6 [RF16-cancelar, RF16-unicidad, D4]: tras la baja administrativa el alumno se reinscribe como FILA NUEVA (comedor y transporte): dos filas por servicio, una CANCELADA y una ACTIVA, y la nueva no está confirmada');
END $$;


-- ================================================================
-- D. MATRÍCULA CERRADA: NO SE CONFIRMA
-- ================================================================
-- D1. Cierre por cambio de curso (B, sin confirmar) y por inactivación (F, sin
-- confirmar), con el flujo de 008. Confirmar la matrícula cerrada → P6202.
SELECT pg_temp.dirsql(pg_catalog.format('SELECT public.cambiar_curso_alumno(%L, %L)::TEXT', pg_temp.u('08'), pg_temp.u('c2')));
SELECT pg_temp.dirsql(pg_catalog.format('SELECT public.inactivar_alumno(%L)::TEXT', pg_temp.u('0d')));
-- Ejerce los triggers diferidos de 008 (coherencia estado ⇔ matrícula vigente).
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

DO $$
DECLARE
    v_n BIGINT := pg_temp.total_conf();
BEGIN
    IF (SELECT motivo_cierre::TEXT FROM public.matriculas WHERE id = pg_temp.fxu('mB1')) IS DISTINCT FROM 'CAMBIO_DE_CURSO'
       OR (SELECT fecha_cierre FROM public.matriculas WHERE id = pg_temp.fxu('mB1')) IS NULL THEN
        RAISE EXCEPTION 'FALLO D1: el cambio de curso no cerró la matrícula de B con su motivo';
    END IF;
    IF (SELECT motivo_cierre::TEXT FROM public.matriculas WHERE id = pg_temp.fxu('mF')) IS DISTINCT FROM 'INACTIVACION'
       OR (SELECT estado::TEXT FROM public.alumnos WHERE perfil_id = pg_temp.u('0d')) <> 'INACTIVO'
       OR EXISTS (SELECT 1 FROM public.matriculas WHERE alumno_id = pg_temp.u('0d') AND fecha_cierre IS NULL) THEN
        RAISE EXCEPTION 'FALLO D1: inactivar_alumno no dejó a F INACTIVO con la matrícula cerrada (INACTIVACION) y sin matrícula vigente';
    END IF;

    PERFORM pg_temp.esperar(pg_temp.dir('conf_mat', pg_temp.fxu('mB1')), 'P6202', 'D1 confirmar matrícula cerrada por cambio de curso');
    PERFORM pg_temp.esperar(pg_temp.dir2('conf_mat', pg_temp.fxu('mB1')), 'P6202', 'D1 confirmar matrícula cerrada por cambio de curso (otra directora)');
    PERFORM pg_temp.esperar(pg_temp.dir('conf_mat', pg_temp.fxu('mF')), 'P6202', 'D1 confirmar matrícula cerrada por inactivación');
    IF pg_temp.n_conf('MATRICULA', pg_temp.fxu('mB1')) <> 0 OR pg_temp.n_conf('MATRICULA', pg_temp.fxu('mF')) <> 0
       OR pg_temp.total_conf() <> v_n THEN
        RAISE EXCEPTION 'FALLO D1: se registró una confirmación sobre una matrícula cerrada';
    END IF;

    -- La matrícula nueva de B (tras el cambio de curso) es vigente y NO está confirmada.
    IF (SELECT count(*) FROM public.matriculas WHERE alumno_id = pg_temp.u('08') AND fecha_cierre IS NULL) <> 1
       OR EXISTS (SELECT 1 FROM public.confirmaciones_inscripcion c
                  JOIN public.matriculas m ON m.id = c.matricula_id
                  WHERE m.alumno_id = pg_temp.u('08')) THEN
        RAISE EXCEPTION 'FALLO D1: B debe tener una única matrícula vigente y sin confirmación';
    END IF;
    PERFORM pg_temp.ok('D1 [D3, D5, RF16-confirmar]: una matrícula cerrada por cambio_curso_alumno o por inactivar_alumno (motivos CAMBIO_DE_CURSO e INACTIVACION) no se confirma (P6202, para las dos directoras) y no deja fila; la matrícula nueva tras el cambio de curso es vigente y no está confirmada');
END $$;


-- ================================================================
-- E. HISTORIA PRESERVADA
-- ================================================================
-- E1. Deporte: confirmar (B1) y luego cancelar por Dirección conserva la
-- confirmación (mismos datos) y las vistas muestran confirmada=true en la fila
-- cancelada. Reinscribirse crea una fila nueva sin confirmar.
DO $$
DECLARE
    v_id  UUID := pg_temp.fxu('iA_g1');
    v_res TEXT;
    v_j   JSONB;
    v_jn  JSONB;
BEGIN
    PERFORM pg_temp.esperar(pg_temp.dir('canc_dep', v_id), 'OK', 'E1 cancelar deporte confirmado');
    IF pg_temp.conf_fila('DEPORTE', v_id) <> pg_temp.fx('conf_fila_DEPORTE') OR pg_temp.n_conf('DEPORTE', v_id) <> 1 THEN
        RAISE EXCEPTION 'FALLO E1: la baja cambió o borró la confirmación deportiva';
    END IF;
    v_j := pg_temp.ver('DEPORTE', v_id);
    IF v_j->>'estado' <> 'CANCELADA' OR (v_j->>'confirmada')::BOOLEAN IS NOT TRUE
       OR v_j->>'confirmada_por_nombre' <> 'Prueba' OR v_j->>'confirmada_por_apellido' <> 'Directora Uno'
       OR v_j->>'confirmada_en' IS NULL THEN
        RAISE EXCEPTION 'FALLO E1: la vista no muestra la baja como confirmada por la directora (%)', v_j;
    END IF;

    v_res := pg_temp.est('07', pg_temp.sql_alta('dep', 'g1'));
    PERFORM pg_temp.esperar(v_res, 'OK', 'E1 A se reinscribe a Fútbol A');
    PERFORM pg_temp.guardar('iA_g1b', pg_temp.valor(v_res));
    v_jn := pg_temp.ver('DEPORTE', pg_temp.fxu('iA_g1b'));
    IF pg_temp.fx('iA_g1b') = v_id::TEXT
       OR (SELECT count(*) FROM public.inscripciones_deportivas
           WHERE alumno_id = pg_temp.u('07') AND grupo_id = pg_temp.fxu('g1')) <> 2
       OR v_jn->>'estado' <> 'ACTIVA' OR (v_jn->>'confirmada')::BOOLEAN IS NOT FALSE
       OR pg_temp.n_conf('DEPORTE', pg_temp.fxu('iA_g1b')) <> 0 THEN
        RAISE EXCEPTION 'FALLO E1: la reinscripción no es una fila nueva sin confirmar que conserva el ciclo cancelado';
    END IF;
    PERFORM pg_temp.ok('E1 [D3, D4, RF16-cancelar]: confirmar y luego cancelar un deporte conserva la confirmación (fila idéntica) y la vista muestra estado CANCELADA con confirmada=true y el nombre de quien confirmó; la reinscripción es una fila nueva ACTIVA sin confirmar y el ciclo cancelado sigue');
END $$;

-- E2. Comedor: la alumna cancela SU inscripción confirmada (RPC de 013, sin
-- cambios); la confirmación se conserva.
DO $$
DECLARE
    v_id UUID := pg_temp.fxu('sA_com');
    v_j  JSONB;
BEGIN
    PERFORM pg_temp.esperar(pg_temp.est('07', pg_catalog.format(
        'SELECT (public.cancelar_inscripcion_servicio(%L)).id::TEXT', v_id)), 'OK', 'E2 la alumna cancela su comedor confirmado');
    IF pg_temp.estado_de('COMEDOR', v_id) <> 'CANCELADA'
       OR pg_temp.conf_fila('COMEDOR', v_id) <> pg_temp.fx('conf_fila_COMEDOR')
       OR pg_temp.n_conf('COMEDOR', v_id) <> 1 THEN
        RAISE EXCEPTION 'FALLO E2: la baja propia no dejó CANCELADA con la confirmación intacta';
    END IF;
    v_j := pg_temp.ver('COMEDOR', v_id);
    IF v_j->>'estado' <> 'CANCELADA' OR (v_j->>'confirmada')::BOOLEAN IS NOT TRUE
       OR v_j->>'servicio_tipo' <> 'COMEDOR' THEN
        RAISE EXCEPTION 'FALLO E2: la vista no muestra el comedor cancelado y confirmado (%)', v_j;
    END IF;
    PERFORM pg_temp.ok('E2 [D3, D4]: la alumna puede cancelar SU inscripción de comedor ya confirmada por la RPC de 013; la confirmación se conserva y la vista muestra CANCELADA con confirmada=true');
END $$;

-- E3. Transporte: cancelación administrativa de la fila confirmada; la
-- confirmación se conserva; la alumna se reinscribe (fila nueva).
DO $$
DECLARE
    v_id  UUID := pg_temp.fxu('sA_tra');
    v_res TEXT;
    v_j   JSONB;
BEGIN
    PERFORM pg_temp.esperar(pg_temp.dir('canc_tra', v_id), 'OK', 'E3 cancelar transporte confirmado');
    IF pg_temp.conf_fila('TRANSPORTE', v_id) <> pg_temp.fx('conf_fila_TRANSPORTE') OR pg_temp.n_conf('TRANSPORTE', v_id) <> 1 THEN
        RAISE EXCEPTION 'FALLO E3: la baja cambió o borró la confirmación de transporte';
    END IF;
    v_j := pg_temp.ver('TRANSPORTE', v_id);
    IF v_j->>'estado' <> 'CANCELADA' OR (v_j->>'confirmada')::BOOLEAN IS NOT TRUE
       OR v_j->>'servicio_tipo' <> 'TRANSPORTE' OR v_j->>'servicio_codigo' <> 'TR-NORTE' THEN
        RAISE EXCEPTION 'FALLO E3: la vista no muestra el transporte cancelado y confirmado (%)', v_j;
    END IF;
    v_res := pg_temp.est('07', pg_temp.sql_alta('tra', 'N'));
    PERFORM pg_temp.esperar(v_res, 'OK', 'E3 A se reinscribe a TR-NORTE');
    PERFORM pg_temp.guardar('sA_tra2', pg_temp.valor(v_res));
    IF pg_temp.fx('sA_tra2') = v_id::TEXT OR pg_temp.n_conf('TRANSPORTE', pg_temp.fxu('sA_tra2')) <> 0 THEN
        RAISE EXCEPTION 'FALLO E3: la reinscripción no es una fila nueva sin confirmar';
    END IF;
    PERFORM pg_temp.ok('E3 [D3, D4, RF16-cancelar]: confirmar y luego cancelar el transporte conserva la confirmación; la vista muestra CANCELADA con confirmada=true (servicio_tipo TRANSPORTE); la reinscripción es una fila nueva sin confirmar');
END $$;

-- E4. Matrícula cerrada por INACTIVACIÓN tras confirmarse (alumno D).
DO $$
BEGIN
    PERFORM pg_temp.esperar(pg_temp.dir('conf_mat', pg_temp.fxu('mD')), 'OK', 'E4 confirmar la matrícula de D');
    PERFORM pg_temp.guardar('conf_fila_mD', pg_temp.conf_fila('MATRICULA', pg_temp.fxu('mD')));
END $$;
SELECT pg_temp.dirsql(pg_catalog.format('SELECT public.inactivar_alumno(%L)::TEXT', pg_temp.u('0a')));
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

DO $$
DECLARE
    v_j JSONB := pg_temp.ver('MATRICULA', pg_temp.fxu('mD'));
BEGIN
    IF pg_temp.conf_fila('MATRICULA', pg_temp.fxu('mD')) <> pg_temp.fx('conf_fila_mD')
       OR pg_temp.n_conf('MATRICULA', pg_temp.fxu('mD')) <> 1 THEN
        RAISE EXCEPTION 'FALLO E4: la inactivación cambió o borró la confirmación de la matrícula';
    END IF;
    IF (v_j->>'vigente')::BOOLEAN IS NOT FALSE OR (v_j->>'confirmada')::BOOLEAN IS NOT TRUE
       OR v_j->>'motivo_cierre' <> 'INACTIVACION' OR v_j->>'alumno_estado' <> 'INACTIVO'
       OR v_j->>'confirmada_en' IS NULL OR v_j->>'confirmada_por_apellido' <> 'Directora Uno' THEN
        RAISE EXCEPTION 'FALLO E4: la vista no muestra la matrícula cerrada y confirmada (%)', v_j;
    END IF;
    PERFORM pg_temp.esperar(pg_temp.dir('conf_mat', pg_temp.fxu('mD')), 'P6202', 'E4 reconfirmar la matrícula cerrada');
    IF EXISTS (SELECT 1 FROM public.matriculas WHERE alumno_id = pg_temp.u('0a') AND fecha_cierre IS NULL)
       OR (SELECT estado::TEXT FROM public.alumnos WHERE perfil_id = pg_temp.u('0a')) <> 'INACTIVO' THEN
        RAISE EXCEPTION 'FALLO E4: D debe quedar INACTIVO sin matrícula vigente (invariante de 008)';
    END IF;
    PERFORM pg_temp.ok('E4 [D3, D5, RF16-cancelar]: confirmar la matrícula y luego cerrarla con inactivar_alumno conserva la confirmación; la vista muestra vigente=false, confirmada=true, motivo INACTIVACION y alumno INACTIVO sin matrícula vigente (invariante de 008); reconfirmar la cerrada → P6202');
END $$;

-- E5. Matrícula cerrada por CAMBIO DE CURSO tras confirmarse (alumno E): la
-- matrícula nueva NO está confirmada.
DO $$
BEGIN
    PERFORM pg_temp.esperar(pg_temp.dir('conf_mat', pg_temp.fxu('mE1')), 'OK', 'E5 confirmar la matrícula de E');
    PERFORM pg_temp.guardar('conf_fila_mE1', pg_temp.conf_fila('MATRICULA', pg_temp.fxu('mE1')));
END $$;
SELECT pg_temp.dirsql(pg_catalog.format('SELECT public.cambiar_curso_alumno(%L, %L)::TEXT', pg_temp.u('0b'), pg_temp.u('c2')));
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

DO $$
DECLARE
    v_j1 JSONB := pg_temp.ver('MATRICULA', pg_temp.fxu('mE1'));
    v_j2 JSONB;
    v_m2 UUID;
BEGIN
    IF pg_temp.conf_fila('MATRICULA', pg_temp.fxu('mE1')) <> pg_temp.fx('conf_fila_mE1')
       OR pg_temp.n_conf('MATRICULA', pg_temp.fxu('mE1')) <> 1 THEN
        RAISE EXCEPTION 'FALLO E5: el cambio de curso cambió o borró la confirmación de la matrícula';
    END IF;
    IF (v_j1->>'vigente')::BOOLEAN IS NOT FALSE OR (v_j1->>'confirmada')::BOOLEAN IS NOT TRUE
       OR v_j1->>'motivo_cierre' <> 'CAMBIO_DE_CURSO' OR v_j1->>'alumno_estado' <> 'ACTIVO' THEN
        RAISE EXCEPTION 'FALLO E5: la vista no muestra la matrícula anterior cerrada y confirmada (%)', v_j1;
    END IF;

    SELECT m.id INTO v_m2 FROM public.matriculas m
    WHERE m.alumno_id = pg_temp.u('0b') AND m.fecha_cierre IS NULL;
    v_j2 := pg_temp.ver('MATRICULA', v_m2);
    IF v_m2 IS NULL OR v_m2 = pg_temp.fxu('mE1')
       OR (v_j2->>'vigente')::BOOLEAN IS NOT TRUE OR (v_j2->>'confirmada')::BOOLEAN IS NOT FALSE
       OR v_j2->>'confirmada_en' IS NOT NULL OR v_j2->>'confirmada_por_nombre' IS NOT NULL
       OR v_j2->>'curso_denominacion' <> 'Curso EPT-62 B'
       OR pg_temp.n_conf('MATRICULA', v_m2) <> 0 THEN
        RAISE EXCEPTION 'FALLO E5: la matrícula nueva debe ser vigente, del curso nuevo y NO confirmada (%)', v_j2;
    END IF;
    PERFORM pg_temp.guardar('mE2', v_m2::TEXT);
    PERFORM pg_temp.esperar(pg_temp.dir('conf_mat', pg_temp.fxu('mE1')), 'P6202', 'E5 reconfirmar la matrícula anterior');
    PERFORM pg_temp.ok('E5 [D3, D5, RF16-cancelar]: confirmar y luego cambiar de curso conserva la confirmación de la matrícula anterior (vigente=false, motivo CAMBIO_DE_CURSO); la matrícula NUEVA es vigente, del curso nuevo y NO está confirmada; reconfirmar la anterior → P6202');
END $$;


-- ================================================================
-- F. LAS RPC DEL ALUMNO SIGUEN IGUAL
-- ================================================================
-- Filas activas de partida: A en Fútbol A (iA_g1b) y transporte (sA_tra2); B en
-- comedor (sB_com2).
DO $$
DECLARE
    v_h TEXT := pg_temp.huella3();
BEGIN
    -- F1. Un DIRECTOR no puede usar las RPC de cancelación propia (exigen ESTUDIANTE).
    PERFORM pg_temp.esperar(pg_temp.dirsql(pg_catalog.format(
        'SELECT (public.cancelar_inscripcion_servicio(%L)).id::TEXT', pg_temp.fx('sB_com2'))), '42501', 'F1 director con cancelar_inscripcion_servicio');
    PERFORM pg_temp.esperar(pg_temp.dirsql(pg_catalog.format(
        'SELECT (public.cancelar_inscripcion_deportiva(%L)).id::TEXT', pg_temp.fx('iA_g1b'))), '42501', 'F1 director con cancelar_inscripcion_deportiva');
    PERFORM pg_temp.esperar(pg_temp.ejecutar('authenticated', pg_temp.u('03'), pg_catalog.format(
        'SELECT (public.cancelar_inscripcion_deportiva(%L)).id::TEXT', pg_temp.fx('iA_g1b'))), '42501', 'F1 otra directora con cancelar_inscripcion_deportiva');
    IF pg_temp.huella3() <> v_h THEN
        RAISE EXCEPTION 'FALLO F1: un rechazo cambió datos';
    END IF;
    PERFORM pg_temp.ok('F1 [D4]: un DIRECTOR que llama a cancelar_inscripcion_servicio o cancelar_inscripcion_deportiva recibe 42501: la cancelación propia sigue exigiendo ESTUDIANTE; la Dirección solo cancela con las operaciones administrativas');

    -- F2. Un alumno no cancela la inscripción ajena: P5555 en servicios, P5578 en deportes.
    PERFORM pg_temp.esperar(pg_temp.est('08', pg_catalog.format(
        'SELECT (public.cancelar_inscripcion_servicio(%L)).id::TEXT', pg_temp.fx('sA_tra2'))), 'P5555', 'F2 servicio ajeno');
    PERFORM pg_temp.esperar(pg_temp.est('08', pg_catalog.format(
        'SELECT (public.cancelar_inscripcion_deportiva(%L)).id::TEXT', pg_temp.fx('iA_g1b'))), 'P5578', 'F2 deporte ajeno');
    PERFORM pg_temp.esperar(pg_temp.est('07', pg_catalog.format(
        'SELECT (public.cancelar_inscripcion_servicio(%L)).id::TEXT', pg_temp.fx('sB_com2'))), 'P5555', 'F2 servicio ajeno (A sobre B)');
    IF pg_temp.huella3() <> v_h
       OR pg_temp.estado_de('DEPORTE', pg_temp.fxu('iA_g1b')) <> 'ACTIVA'
       OR pg_temp.estado_de('TRANSPORTE', pg_temp.fxu('sA_tra2')) <> 'ACTIVA' THEN
        RAISE EXCEPTION 'FALLO F2: una baja ajena alteró datos';
    END IF;
    PERFORM pg_temp.ok('F2 [D4]: un alumno que intenta cancelar la inscripción ajena recibe P5555 (servicios) o P5578 (deportes) y la fila queda ACTIVA');
END $$;

-- F3. El alumno cancela SU inscripción deportiva ya confirmada; se conserva la
-- confirmación. La alumna se reinscribe después como fila nueva.
DO $$
DECLARE
    v_id  UUID := pg_temp.fxu('iC_g2');
    v_res TEXT;
BEGIN
    PERFORM pg_temp.esperar(pg_temp.dir('conf_dep', v_id), 'OK', 'F3 confirmar la inscripción de C en Natación');
    PERFORM pg_temp.guardar('conf_fila_iC_g2', pg_temp.conf_fila('DEPORTE', v_id));
    PERFORM pg_temp.esperar(pg_temp.est('09', pg_catalog.format(
        'SELECT (public.cancelar_inscripcion_deportiva(%L)).id::TEXT', v_id)), 'OK', 'F3 C cancela SU inscripción confirmada');
    IF pg_temp.estado_de('DEPORTE', v_id) <> 'CANCELADA'
       OR pg_temp.conf_fila('DEPORTE', v_id) <> pg_temp.fx('conf_fila_iC_g2')
       OR pg_temp.n_conf('DEPORTE', v_id) <> 1 THEN
        RAISE EXCEPTION 'FALLO F3: la baja propia de una inscripción confirmada no conservó la confirmación';
    END IF;
    -- C libera su lugar y vuelve a Fútbol A: fila nueva junto al ciclo cancelado por Dirección.
    v_res := pg_temp.est('09', pg_temp.sql_alta('dep', 'g1'));
    PERFORM pg_temp.esperar(v_res, 'OK', 'F3 C se reinscribe a Fútbol A');
    PERFORM pg_temp.guardar('iC_g1b', pg_temp.valor(v_res));
    IF (SELECT count(*) FROM public.inscripciones_deportivas
        WHERE alumno_id = pg_temp.u('09') AND grupo_id = pg_temp.fxu('g1')) <> 2
       OR pg_temp.estado_de('DEPORTE', pg_temp.fxu('iC_g1')) <> 'CANCELADA'
       OR pg_temp.estado_de('DEPORTE', pg_temp.fxu('iC_g1b')) <> 'ACTIVA' THEN
        RAISE EXCEPTION 'FALLO F3: la reinscripción no dejó un ciclo cancelado y uno activo';
    END IF;
    PERFORM pg_temp.ok('F3 [D3, D4]: un alumno puede cancelar SU inscripción deportiva ya confirmada (RPC de 014 sin cambios), la confirmación se conserva y, al reinscribirse, queda una fila nueva ACTIVA junto al ciclo cancelado');
END $$;


-- ================================================================
-- G. LA CONFIRMACIÓN NO CONDICIONA LA VIGENCIA
-- ================================================================
-- E acaba de inscribirse (Vóley, iE_g3) y ahora suma el comedor: ninguna de las
-- dos filas fue confirmada y ambas son plenamente vigentes.
DO $$
DECLARE
    v_res  TEXT;
    v_cols TEXT;
BEGIN
    v_res := pg_temp.est('0b', pg_temp.sql_alta('com', NULL));
    PERFORM pg_temp.esperar(v_res, 'OK', 'G1 E se inscribe al comedor');
    PERFORM pg_temp.guardar('sE_com', pg_temp.valor(v_res));

    IF pg_temp.estado_de('COMEDOR', pg_temp.fxu('sE_com')) <> 'ACTIVA'
       OR pg_temp.estado_de('DEPORTE', pg_temp.fxu('iE_g3')) <> 'ACTIVA'
       OR pg_temp.n_conf('COMEDOR', pg_temp.fxu('sE_com')) <> 0
       OR pg_temp.n_conf('DEPORTE', pg_temp.fxu('iE_g3')) <> 0 THEN
        RAISE EXCEPTION 'FALLO G1: una alta reciente debe nacer ACTIVA y sin confirmación';
    END IF;

    -- Aparece en sus vistas propias *_detalle, ACTIVA, sin ninguna columna de confirmación.
    IF pg_temp.est('0b', pg_catalog.format(
        'SELECT (SELECT estado::TEXT FROM public.inscripciones_servicios_detalle WHERE id = %L)', pg_temp.fx('sE_com'))) <> 'OK:ACTIVA'
       OR pg_temp.est('0b', pg_catalog.format(
        'SELECT (SELECT estado::TEXT FROM public.inscripciones_deportivas_detalle WHERE id = %L)', pg_temp.fx('iE_g3'))) <> 'OK:ACTIVA' THEN
        RAISE EXCEPTION 'FALLO G1: la alta sin confirmar no aparece ACTIVA en las vistas propias del alumno';
    END IF;
    SELECT pg_catalog.string_agg(column_name, ',') INTO v_cols
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('inscripciones_servicios_detalle', 'inscripciones_deportivas_detalle')
      AND column_name ILIKE '%confirm%';
    IF v_cols IS NOT NULL THEN
        RAISE EXCEPTION 'FALLO G1: las vistas propias del alumno exponen columnas de confirmación (%)', v_cols;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public'
                 AND table_name IN ('matriculas', 'inscripciones_deportivas', 'inscripciones_servicios')
                 AND column_name ILIKE '%confirm%') THEN
        RAISE EXCEPTION 'FALLO G1: las tablas de inscripción cargan una columna de confirmación';
    END IF;
    PERFORM pg_temp.ok('G1 [D2]: una alta reciente (comedor y deporte) nace ACTIVA sin confirmación, aparece en las vistas propias del alumno y ni las vistas propias ni las tres tablas tienen columna de confirmación');

    -- G2. Sin confirmar, el alumno cancela por su cuenta (servicio y deporte).
    PERFORM pg_temp.esperar(pg_temp.est('0b', pg_catalog.format(
        'SELECT (public.cancelar_inscripcion_servicio(%L)).id::TEXT', pg_temp.fx('sE_com'))), 'OK', 'G2 E cancela el comedor sin confirmar');
    PERFORM pg_temp.esperar(pg_temp.est('0b', pg_catalog.format(
        'SELECT (public.cancelar_inscripcion_deportiva(%L)).id::TEXT', pg_temp.fx('iE_g3'))), 'OK', 'G2 E cancela Vóley sin confirmar');
    IF pg_temp.estado_de('COMEDOR', pg_temp.fxu('sE_com')) <> 'CANCELADA'
       OR pg_temp.estado_de('DEPORTE', pg_temp.fxu('iE_g3')) <> 'CANCELADA'
       OR pg_temp.n_conf('COMEDOR', pg_temp.fxu('sE_com')) <> 0
       OR pg_temp.n_conf('DEPORTE', pg_temp.fxu('iE_g3')) <> 0 THEN
        RAISE EXCEPTION 'FALLO G2: la baja propia sin confirmar dejó un estado inesperado';
    END IF;
    PERFORM pg_temp.ok('G2 [D2, D4]: sin ninguna confirmación, el alumno cancela por su cuenta su comedor y su deporte con las RPC de 013 y 014; no aparece ninguna confirmación');

    -- G3. Ningún flujo existente lee la confirmación: ninguna función de 008, 013, 014
    -- ni de las altas menciona el registro.
    IF EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('public', 'app_private')
          AND p.prosrc ILIKE '%confirmaciones_inscripcion%'
          AND p.proname NOT IN ('confirmar_matricula', 'confirmar_inscripcion_deportiva',
                                'confirmar_inscripcion_servicio', 'proteger_confirmacion_inscripcion',
                                'describir_confirmacion')
    ) OR EXISTS (
        SELECT 1 FROM pg_trigger t
        WHERE NOT t.tgisinternal
          AND t.tgrelid IN ('public.matriculas'::regclass, 'public.inscripciones_deportivas'::regclass,
                            'public.inscripciones_servicios'::regclass)
          AND (pg_get_triggerdef(t.oid) ILIKE '%confirm%')
    ) THEN
        RAISE EXCEPTION 'FALLO G3: alguna función o trigger existente lee o depende de la confirmación';
    END IF;
    PERFORM pg_temp.ok('G3 [D2]: solo las funciones de la migración mencionan el registro de confirmaciones; ninguna función de alta, baja o cierre ni trigger de las tres tablas lo consulta');
END $$;


-- ================================================================
-- H. LECTURAS: RLS DEL REGISTRO Y VISTAS ADMINISTRATIVAS
-- ================================================================
DO $$
DECLARE
    v_actor RECORD;
    v_rel   TEXT;
    v_res   TEXT;
    v_total BIGINT;
BEGIN
    -- H1. El registro: solo Dirección habilitada ve filas; ni siquiera el dueño de la
    -- inscripción confirmada ve la suya.
    v_total := pg_temp.total_conf();
    IF v_total < 6 THEN
        RAISE EXCEPTION 'FALLO H1: el registro debería tener al menos seis confirmaciones (tiene %)', v_total;
    END IF;
    FOR v_actor IN
        SELECT * FROM (VALUES
            ('ESTUDIANTE dueña de matrícula, deporte, comedor y transporte confirmados', 'authenticated', pg_temp.u('07')),
            ('ESTUDIANTE dueña de matrícula cerrada confirmada (D)', 'authenticated', pg_temp.u('0a')),
            ('ESTUDIANTE dueña de matrícula cerrada confirmada (E)', 'authenticated', pg_temp.u('0b')),
            ('ESTUDIANTE dueña de deporte confirmado (C)', 'authenticated', pg_temp.u('09')),
            ('PADRE',              'authenticated', pg_temp.u('05')),
            ('DOCENTE',            'authenticated', pg_temp.u('04')),
            ('PERSONAL',           'authenticated', pg_temp.u('06')),
            ('SIN PERFIL',         'authenticated', pg_temp.u('0c')),
            ('SIN IDENTIDAD',      'authenticated', NULL::UUID),
            ('DIRECTOR BLOQUEADO', 'authenticated', pg_temp.u('02'))
        ) AS a(etiqueta, rol, sub)
    LOOP
        v_res := pg_temp.filas(v_actor.rol, v_actor.sub, 'confirmaciones_inscripcion');
        IF v_res = 'E:42P17' THEN
            RAISE EXCEPTION 'FALLO H1: % → recursión de políticas (42P17)', v_actor.etiqueta;
        END IF;
        IF v_res <> 'OK:0' THEN
            RAISE EXCEPTION 'FALLO H1: % ve confirmaciones (%)', v_actor.etiqueta, v_res;
        END IF;
    END LOOP;
    PERFORM pg_temp.esperar(pg_temp.filas('anon', NULL, 'confirmaciones_inscripcion'), '42501', 'H1 anon lee el registro');
    IF pg_temp.filas('authenticated', pg_temp.u('01'), 'confirmaciones_inscripcion') <> 'OK:' || v_total
       OR pg_temp.filas('authenticated', pg_temp.u('03'), 'confirmaciones_inscripcion') <> 'OK:' || v_total THEN
        RAISE EXCEPTION 'FALLO H1: la Dirección habilitada no ve todo el registro';
    END IF;
    PERFORM pg_temp.ok('H1 [D1, RF16-consultar]: ESTUDIANTE (incluidos los dueños de filas confirmadas), PADRE, DOCENTE, PERSONAL, sin perfil, sin identidad y DIRECTOR bloqueado ven 0 filas del registro (sin error que delate); anon recibe 42501; las dos directoras habilitadas ven todo');

    -- H2. Las tres vistas administrativas: 0 filas para todo actor que no sea Dirección
    -- (incluido el alumno dueño de la fila y el director bloqueado); 42501 para anon.
    FOREACH v_rel IN ARRAY ARRAY['matriculas_administracion', 'inscripciones_deportivas_administracion',
                                 'inscripciones_servicios_administracion'] LOOP
        FOR v_actor IN
            SELECT * FROM (VALUES
                ('ESTUDIANTE dueña A',  'authenticated', pg_temp.u('07')),
                ('ESTUDIANTE dueño B',  'authenticated', pg_temp.u('08')),
                ('ESTUDIANTE dueño C',  'authenticated', pg_temp.u('09')),
                ('ESTUDIANTE dueño E',  'authenticated', pg_temp.u('0b')),
                ('PADRE',               'authenticated', pg_temp.u('05')),
                ('DOCENTE',             'authenticated', pg_temp.u('04')),
                ('PERSONAL',            'authenticated', pg_temp.u('06')),
                ('SIN PERFIL',          'authenticated', pg_temp.u('0c')),
                ('SIN IDENTIDAD',       'authenticated', NULL::UUID),
                ('DIRECTOR BLOQUEADO',  'authenticated', pg_temp.u('02'))
            ) AS a(etiqueta, rol, sub)
        LOOP
            v_res := pg_temp.filas(v_actor.rol, v_actor.sub, v_rel);
            IF v_res = 'E:42P17' THEN
                RAISE EXCEPTION 'FALLO H2: % / % → recursión de políticas (42P17)', v_actor.etiqueta, v_rel;
            END IF;
            IF v_res <> 'OK:0' THEN
                RAISE EXCEPTION 'FALLO H2: % ve filas de % (%)', v_actor.etiqueta, v_rel, v_res;
            END IF;
        END LOOP;
        PERFORM pg_temp.esperar(pg_temp.filas('anon', NULL, v_rel), '42501', 'H2 anon lee ' || v_rel);
    END LOOP;
    PERFORM pg_temp.ok('H2 [RF16-consultar, D1]: las vistas matriculas_administracion, inscripciones_deportivas_administracion e inscripciones_servicios_administracion devuelven 0 filas a estudiantes (también al dueño de la fila), padre, docente, personal, sin perfil, sin identidad y director bloqueado; anon recibe 42501');

    -- H3. La Dirección habilitada ve TODAS las filas de los tres modelos (vigentes, canceladas y cerradas).
    IF pg_temp.filas('authenticated', pg_temp.u('01'), 'matriculas_administracion')
           <> 'OK:' || (SELECT count(*) FROM public.matriculas)
       OR pg_temp.filas('authenticated', pg_temp.u('03'), 'matriculas_administracion')
           <> 'OK:' || (SELECT count(*) FROM public.matriculas)
       OR pg_temp.filas('authenticated', pg_temp.u('01'), 'inscripciones_deportivas_administracion')
           <> 'OK:' || (SELECT count(*) FROM public.inscripciones_deportivas)
       OR pg_temp.filas('authenticated', pg_temp.u('03'), 'inscripciones_deportivas_administracion')
           <> 'OK:' || (SELECT count(*) FROM public.inscripciones_deportivas)
       OR pg_temp.filas('authenticated', pg_temp.u('01'), 'inscripciones_servicios_administracion')
           <> 'OK:' || (SELECT count(*) FROM public.inscripciones_servicios)
       OR pg_temp.filas('authenticated', pg_temp.u('03'), 'inscripciones_servicios_administracion')
           <> 'OK:' || (SELECT count(*) FROM public.inscripciones_servicios) THEN
        RAISE EXCEPTION 'FALLO H3: una vista administrativa no devuelve todas las filas de su modelo';
    END IF;
    PERFORM pg_temp.ok('H3 [RF16-consultar]: las dos directoras habilitadas obtienen de cada vista administrativa exactamente tantas filas como la tabla de origen (vigentes, canceladas y cerradas)');
END $$;

-- H4. Contenido de las vistas para Dirección: campos correctos por dominio.
DO $$
DECLARE
    v_m  JSONB;
    v_d  JSONB;
    v_s  JSONB;
BEGIN
    -- Matrícula vigente confirmada (A): curso, nivel, alumno y confirmación.
    v_m := pg_temp.ver('MATRICULA', pg_temp.fxu('mA'));
    IF v_m IS NULL
       OR (v_m->>'vigente')::BOOLEAN IS NOT TRUE OR (v_m->>'confirmada')::BOOLEAN IS NOT TRUE
       OR v_m->>'confirmada_en' IS NULL
       OR v_m->>'confirmada_por_nombre' <> 'Prueba' OR v_m->>'confirmada_por_apellido' <> 'Directora Uno'
       OR v_m->>'alumno_nombre' <> 'Prueba' OR v_m->>'alumno_apellido' <> 'Alumna A'
       OR v_m->>'legajo_nro' <> 'LEG-EPT62-0007' OR v_m->>'alumno_estado' <> 'ACTIVO'
       OR v_m->>'curso_denominacion' <> 'Curso EPT-62 A' OR v_m->>'curso_division' <> 'A'
       OR v_m->>'nivel_nombre' <> 'PRIMARIO' OR v_m->>'fecha_cierre' IS NOT NULL
       OR v_m->>'motivo_cierre' IS NOT NULL THEN
        RAISE EXCEPTION 'FALLO H4: la vista de matrículas no devuelve los campos esperados (%)', v_m;
    END IF;

    -- Inscripción deportiva vigente sin confirmar (A, fila nueva).
    v_d := pg_temp.ver('DEPORTE', pg_temp.fxu('iA_g1b'));
    IF v_d IS NULL
       OR v_d->>'estado' <> 'ACTIVA' OR (v_d->>'confirmada')::BOOLEAN IS NOT FALSE
       OR v_d->>'confirmada_en' IS NOT NULL OR v_d->>'confirmada_por_nombre' IS NOT NULL
       OR v_d->>'confirmada_por_apellido' IS NOT NULL
       OR v_d->>'deporte_nombre' <> 'Fútbol' OR v_d->>'grupo_nombre' <> 'Fútbol EPT62 A'
       OR v_d->>'nivel_nombre' <> 'PRIMARIO' OR v_d->>'alumno_apellido' <> 'Alumna A'
       OR v_d->>'fecha_cancelacion' IS NOT NULL THEN
        RAISE EXCEPTION 'FALLO H4: la vista deportiva no devuelve los campos esperados (%)', v_d;
    END IF;

    -- Inscripción a servicio vigente sin confirmar (A, transporte): tipo, código, servicio.
    v_s := pg_temp.ver('TRANSPORTE', pg_temp.fxu('sA_tra2'));
    IF v_s IS NULL
       OR v_s->>'servicio_tipo' <> 'TRANSPORTE' OR v_s->>'servicio_codigo' <> 'TR-NORTE'
       OR v_s->>'estado' <> 'ACTIVA' OR (v_s->>'confirmada')::BOOLEAN IS NOT FALSE
       OR (v_s->>'servicio_activo')::BOOLEAN IS NOT TRUE
       OR v_s->>'alumno_apellido' <> 'Alumna A' THEN
        RAISE EXCEPTION 'FALLO H4: la vista de servicios no devuelve los campos esperados (%)', v_s;
    END IF;
    v_s := pg_temp.ver('COMEDOR', pg_temp.fxu('sB_com2'));
    IF v_s IS NULL OR v_s->>'servicio_tipo' <> 'COMEDOR' OR v_s->>'estado' <> 'ACTIVA'
       OR (v_s->>'confirmada')::BOOLEAN IS NOT FALSE THEN
        RAISE EXCEPTION 'FALLO H4: la vista de servicios no distingue el comedor (%)', v_s;
    END IF;
    PERFORM pg_temp.ok('H4 [RF16-consultar]: para Dirección las vistas devuelven los campos correctos: matrícula (vigente, curso, división, nivel, alumno, confirmada, confirmada_en, confirmador), deporte (deporte, grupo, nivel, estado, sin marca cuando no se confirmó) y servicio (servicio_tipo COMEDOR/TRANSPORTE, código, estado, confirmada)');
END $$;


-- ================================================================
-- I. SIN BORRADO FÍSICO Y REGISTRO APPEND-ONLY
-- ================================================================
-- I1. Ninguna función de eliminación ni cancelación de MATRÍCULA; ninguna de las
-- funciones nuevas escribe matrículas ni alumnos (el invariante de 008 sigue
-- siendo del flujo de 008).
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('public', 'app_private')
          AND (p.proname ~* 'cancel.*matr' OR p.proname ~* 'matr.*cancel'
               OR p.proname ~* 'anular.*matr' OR p.proname ~* 'matr.*anular')
    ) THEN
        RAISE EXCEPTION 'FALLO I1: existe una función de cancelación de matrícula';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('public', 'app_private')
          AND (p.proname ~* '(elimin|borrar|delete|remove|purg|destroy).*(matr|inscrip|confirm)'
               OR p.proname ~* '(matr|inscrip|confirm).*(elimin|borrar|delete|remove|purg|destroy)')
    ) THEN
        RAISE EXCEPTION 'FALLO I1: existe una función de eliminación de matrículas, inscripciones o confirmaciones';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'app_private'
          AND p.proname IN ('confirmar_matricula', 'confirmar_inscripcion_deportiva',
                            'confirmar_inscripcion_servicio',
                            'cancelar_inscripcion_deportiva_administrativa',
                            'cancelar_inscripcion_servicio_administrativa',
                            'proteger_confirmacion_inscripcion', 'describir_confirmacion')
          AND (p.prosrc ~* '(update|insert\s+into|delete\s+from)\s+public\.(matriculas|alumnos)'
               OR p.prosrc ~* 'delete\s+from')
    ) THEN
        RAISE EXCEPTION 'FALLO I1: una función nueva escribe matrículas o alumnos, o contiene un DELETE';
    END IF;
    PERFORM pg_temp.ok('I1 [D5, D6]: no existe ninguna función de cancelación de matrícula ni de eliminación de matrículas, inscripciones o confirmaciones; ninguna función nueva contiene DELETE ni escribe matrículas o alumnos');
END $$;

-- I2. FK ON DELETE RESTRICT: ni el propietario borra una inscripción o matrícula
-- CONFIRMADA (23503); la fila y su confirmación siguen ahí.
DO $$
DECLARE
    v_h TEXT := pg_temp.huella3();
BEGIN
    IF (SELECT count(*) FROM pg_constraint
        WHERE conrelid = 'public.confirmaciones_inscripcion'::regclass AND contype = 'f') <> 4
       OR EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.confirmaciones_inscripcion'::regclass
                    AND contype = 'f' AND confdeltype <> 'r') THEN
        RAISE EXCEPTION 'FALLO I2: las cuatro claves foráneas del registro deben ser ON DELETE RESTRICT';
    END IF;

    PERFORM pg_temp.esperar(pg_temp.propietario(pg_catalog.format(
        'DELETE FROM public.inscripciones_deportivas WHERE id = %L', pg_temp.fx('iA_g1'))), '23503', 'I2 borrar deporte confirmado (cancelado)');
    PERFORM pg_temp.esperar(pg_temp.propietario(pg_catalog.format(
        'DELETE FROM public.inscripciones_servicios WHERE id = %L', pg_temp.fx('sA_tra'))), '23503', 'I2 borrar transporte confirmado (cancelado)');
    PERFORM pg_temp.esperar(pg_temp.propietario(pg_catalog.format(
        'DELETE FROM public.inscripciones_servicios WHERE id = %L', pg_temp.fx('sA_com'))), '23503', 'I2 borrar comedor confirmado (cancelado)');
    PERFORM pg_temp.esperar(pg_temp.propietario(pg_catalog.format(
        'DELETE FROM public.matriculas WHERE id = %L', pg_temp.fx('mE1'))), '23503', 'I2 borrar matrícula confirmada (cerrada)');
    PERFORM pg_temp.esperar(pg_temp.propietario(pg_catalog.format(
        'DELETE FROM public.matriculas WHERE id = %L', pg_temp.fx('mA'))), '23503', 'I2 borrar matrícula confirmada (vigente)');
    IF pg_temp.huella3() <> v_h THEN
        RAISE EXCEPTION 'FALLO I2: un DELETE rechazado dejó cambios';
    END IF;
    PERFORM pg_temp.ok('I2 [D6]: cuatro claves foráneas ON DELETE RESTRICT; ni el propietario puede borrar una inscripción deportiva, de comedor, de transporte o una matrícula (vigente o cerrada) CONFIRMADA: 23503 y nada cambia');
END $$;

-- I3. El registro es append-only: UPDATE y DELETE dan P6204 incluso al propietario.
DO $$
DECLARE
    v_fila TEXT := pg_temp.conf_fila('MATRICULA', pg_temp.fxu('mA'));
    v_n    BIGINT := pg_temp.total_conf();
BEGIN
    PERFORM pg_temp.esperar(pg_temp.propietario(pg_catalog.format(
        'UPDATE public.confirmaciones_inscripcion SET confirmada_por = %L WHERE id = %L',
        pg_temp.u('03'), pg_temp.conf_id('MATRICULA', pg_temp.fxu('mA')))), 'P6204', 'I3 UPDATE del confirmador');
    PERFORM pg_temp.esperar(pg_temp.propietario(pg_catalog.format(
        'UPDATE public.confirmaciones_inscripcion SET confirmada_en = now() - interval ''1 day'' WHERE id = %L',
        pg_temp.conf_id('MATRICULA', pg_temp.fxu('mA')))), 'P6204', 'I3 UPDATE de la fecha');
    PERFORM pg_temp.esperar(pg_temp.propietario(pg_catalog.format(
        'UPDATE public.confirmaciones_inscripcion SET id = id WHERE id = %L',
        pg_temp.conf_id('MATRICULA', pg_temp.fxu('mA')))), 'P6204', 'I3 UPDATE nulo');
    PERFORM pg_temp.esperar(pg_temp.propietario(pg_catalog.format(
        'DELETE FROM public.confirmaciones_inscripcion WHERE id = %L',
        pg_temp.conf_id('MATRICULA', pg_temp.fxu('mA')))), 'P6204', 'I3 DELETE');
    PERFORM pg_temp.esperar(pg_temp.propietario('DELETE FROM public.confirmaciones_inscripcion'), 'P6204', 'I3 DELETE masivo');
    PERFORM pg_temp.esperar(pg_temp.propietario('UPDATE public.confirmaciones_inscripcion SET confirmada_en = now()'), 'P6204', 'I3 UPDATE masivo');
    PERFORM pg_temp.esperar(pg_temp.propietario('TRUNCATE public.confirmaciones_inscripcion'), 'P6204', 'I3 TRUNCATE');
    IF pg_temp.conf_fila('MATRICULA', pg_temp.fxu('mA')) <> v_fila OR pg_temp.total_conf() <> v_n THEN
        RAISE EXCEPTION 'FALLO I3: una confirmación cambió o desapareció';
    END IF;
    PERFORM pg_temp.ok('I3 [D3, D6]: el trigger de protección da P6204 a todo UPDATE y DELETE de una confirmación, también al propietario (por fila y masivos); la fila queda idéntica');
END $$;

-- I4. INSERT directo del propietario: las reglas de la base valen sin pasar por
-- las funciones (P6202 no vigente, 23503 sin fila, 23514 destino múltiple o
-- dominio cruzado, 23505 duplicado) y la fecha la sella la base aunque se pase otra.
DO $$
DECLARE
    v_dir UUID := pg_temp.u('01');
    v_n   BIGINT := pg_temp.total_conf();
    v_en  TIMESTAMP WITH TIME ZONE;
BEGIN
    PERFORM pg_temp.esperar(pg_temp.propietario(pg_catalog.format(
        'INSERT INTO public.confirmaciones_inscripcion (dominio, inscripcion_deportiva_id, confirmada_por) VALUES (''DEPORTE'', %L, %L)',
        pg_temp.fx('iB_g3'), v_dir)), 'P6202', 'I4 deporte cancelado');
    PERFORM pg_temp.esperar(pg_temp.propietario(pg_catalog.format(
        'INSERT INTO public.confirmaciones_inscripcion (dominio, inscripcion_servicio_id, confirmada_por) VALUES (''SERVICIO'', %L, %L)',
        pg_temp.fx('sB_com'), v_dir)), 'P6202', 'I4 servicio cancelado');
    PERFORM pg_temp.esperar(pg_temp.propietario(pg_catalog.format(
        'INSERT INTO public.confirmaciones_inscripcion (dominio, matricula_id, confirmada_por) VALUES (''MATRICULA'', %L, %L)',
        pg_temp.fx('mB1'), v_dir)), 'P6202', 'I4 matrícula cerrada');
    PERFORM pg_temp.esperar(pg_temp.propietario(pg_catalog.format(
        'INSERT INTO public.confirmaciones_inscripcion (dominio, matricula_id, confirmada_por) VALUES (''MATRICULA'', %L, %L)',
        pg_catalog.gen_random_uuid(), v_dir)), '23503', 'I4 matrícula inexistente');
    PERFORM pg_temp.esperar(pg_temp.propietario(pg_catalog.format(
        'INSERT INTO public.confirmaciones_inscripcion (dominio, matricula_id, inscripcion_servicio_id, confirmada_por) VALUES (''MATRICULA'', %L, %L, %L)',
        pg_temp.fx('mE2'), pg_temp.fx('sF_com'), v_dir)), '23514', 'I4 dos destinos');
    PERFORM pg_temp.esperar(pg_temp.propietario(pg_catalog.format(
        'INSERT INTO public.confirmaciones_inscripcion (dominio, inscripcion_servicio_id, confirmada_por) VALUES (''MATRICULA'', %L, %L)',
        pg_temp.fx('sF_com'), v_dir)), '23514', 'I4 dominio cruzado');
    PERFORM pg_temp.esperar(pg_temp.propietario(pg_catalog.format(
        'INSERT INTO public.confirmaciones_inscripcion (dominio, matricula_id, confirmada_por) VALUES (''MATRICULA'', %L, %L)',
        pg_temp.fx('mA'), v_dir)), '23505', 'I4 duplicado');
    PERFORM pg_temp.esperar(pg_temp.propietario(pg_catalog.format(
        'INSERT INTO public.confirmaciones_inscripcion (dominio, matricula_id, confirmada_por) VALUES (''MATRICULA'', %L, %L)',
        pg_temp.fx('mE2'), pg_catalog.gen_random_uuid())), '23503', 'I4 confirmador inexistente');
    PERFORM pg_temp.exigir(pg_temp.total_conf() = v_n, 'I4: un INSERT rechazado dejó una fila');

    -- La fecha la sella la base: se ignora la que pasa quien escribe.
    PERFORM pg_temp.esperar(pg_temp.propietario(pg_catalog.format(
        'INSERT INTO public.confirmaciones_inscripcion (dominio, inscripcion_servicio_id, confirmada_por, confirmada_en) VALUES (''SERVICIO'', %L, %L, ''2000-01-01 00:00:00+00'')',
        pg_temp.fx('sF_com'), v_dir)), 'OK', 'I4 inserción válida con fecha ajena');
    SELECT c.confirmada_en INTO v_en FROM public.confirmaciones_inscripcion c
    WHERE c.inscripcion_servicio_id = pg_temp.fxu('sF_com');
    IF v_en IS DISTINCT FROM pg_catalog.now() THEN
        RAISE EXCEPTION 'FALLO I4: la base no selló la fecha de confirmación (%)', v_en;
    END IF;
    PERFORM pg_temp.ok('I4 [D1, D3, D6]: el registro se defiende solo, sin pasar por las funciones: confirmar algo cancelado o cerrado → P6202, fila inexistente o confirmador inexistente → 23503, dos destinos o dominio cruzado → 23514, duplicado → 23505; y la base sella confirmada_en aunque el que escribe pase otra fecha');
END $$;


-- ================================================================
-- J. UNICIDAD E INVARIANTES QUE LAS OPERACIONES NUEVAS NO ROMPEN
-- ================================================================
-- J1. Por el camino privilegiado (propietario), los triggers y los índices de
-- 013, 014 y 015 siguen decidiendo, con los mismos códigos, después de que las
-- operaciones nuevas cancelaron y confirmaron.
DO $$
DECLARE
    v_h TEXT := pg_temp.huella3();
BEGIN
    -- Comedor: una inscripción activa por alumno y servicio (índice único, 23505).
    PERFORM pg_temp.esperar(pg_temp.propietario(pg_catalog.format(
        'INSERT INTO public.inscripciones_servicios (alumno_id, servicio_id) VALUES (%L, %L)',
        pg_temp.u('08'), 'e0000000-0000-4000-8000-000000000010')), '23505', 'J1 comedor duplicado');
    -- Transporte: máximo un recorrido activo (P5961) con A en TR-NORTE.
    PERFORM pg_temp.esperar(pg_temp.propietario(pg_catalog.format(
        'INSERT INTO public.inscripciones_servicios (alumno_id, servicio_id) VALUES (%L, %L)',
        pg_temp.u('07'), 'e0000000-0000-4000-8000-000000000021')), 'P5961', 'J1 segundo recorrido');
    -- Deportes: mismo grupo P5575, mismo deporte P5576, máximo de dos P5577.
    PERFORM pg_temp.esperar(pg_temp.propietario(pg_catalog.format(
        'INSERT INTO public.inscripciones_deportivas (alumno_id, grupo_id) VALUES (%L, %L)',
        pg_temp.u('07'), pg_temp.fx('g1'))), 'P5575', 'J1 mismo grupo');
    PERFORM pg_temp.esperar(pg_temp.propietario(pg_catalog.format(
        'INSERT INTO public.inscripciones_deportivas (alumno_id, grupo_id) VALUES (%L, %L)',
        pg_temp.u('07'), pg_temp.fx('g5'))), 'P5576', 'J1 mismo deporte, otro grupo');
    PERFORM pg_temp.esperar(pg_temp.propietario(pg_catalog.format(
        'INSERT INTO public.inscripciones_deportivas (alumno_id, grupo_id) VALUES (%L, %L)',
        pg_temp.u('09'), pg_temp.fx('g2'))), 'P5577', 'J1 máximo de dos deportes');
    -- Cupo: Vóley (cupo 1) sigue liberado tras la baja de E; una inscripción
    -- desde el camino privilegiado lo ocupa y la siguiente da P5574.
    PERFORM pg_temp.esperar(pg_temp.propietario(pg_catalog.format(
        'INSERT INTO public.inscripciones_deportivas (alumno_id, grupo_id) VALUES (%L, %L)',
        pg_temp.u('08'), pg_temp.fx('g3'))), 'OK', 'J1 el cupo liberado por la baja se puede ocupar');
    PERFORM pg_temp.esperar(pg_temp.propietario(pg_catalog.format(
        'INSERT INTO public.inscripciones_deportivas (alumno_id, grupo_id) VALUES (%L, %L)',
        pg_temp.u('07'), pg_temp.fx('g3'))), 'P5574', 'J1 cupo excedido');
    IF (SELECT count(*) FROM public.inscripciones_deportivas
        WHERE grupo_id = pg_temp.fxu('g3') AND estado = 'ACTIVA') <> 1 THEN
        RAISE EXCEPTION 'FALLO J1: el cupo de Vóley se excedió';
    END IF;
    IF pg_temp.huella3() = v_h THEN
        RAISE EXCEPTION 'FALLO J1: la inscripción privilegiada válida no quedó registrada';
    END IF;
    PERFORM pg_temp.ok('J1 [RF16-unicidad]: tras las bajas y confirmaciones administrativas, la escritura privilegiada sigue recibiendo 23505 (comedor duplicado), P5961 (segundo recorrido), P5575, P5576, P5577 y P5574; el cupo liberado por la baja se puede ocupar y no se excede');
END $$;

-- J2. Nunca queda un alumno ACTIVO sin exactamente una matrícula vigente ni un
-- INACTIVO con matrícula vigente, después de ejercer las cinco funciones nuevas
-- sobre todos los datos y de los cierres de 008 (el trigger diferido lo exige).
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

DO $$
DECLARE
    v_h TEXT := pg_temp.huella('matriculas');
    v_op RECORD;
BEGIN
    -- Las cinco funciones, sobre todas las matrículas e inscripciones del fixture,
    -- como cada directora: pueden confirmar o cancelar, pero jamás tocan matrículas.
    FOR v_op IN SELECT m.id FROM public.matriculas m WHERE m.alumno_id IN (
        SELECT pg_temp.u(s) FROM unnest(ARRAY['07', '08', '09', '0a', '0b', '0d']) AS s) LOOP
        PERFORM pg_temp.dir2('conf_mat', v_op.id);
    END LOOP;
    FOR v_op IN SELECT i.id FROM public.inscripciones_servicios i WHERE i.alumno_id IN (
        SELECT pg_temp.u(s) FROM unnest(ARRAY['07', '08', '09', '0a', '0b', '0d']) AS s) LOOP
        PERFORM pg_temp.dir2('canc_com', v_op.id);
        PERFORM pg_temp.dir2('canc_tra', v_op.id);
        PERFORM pg_temp.dir2('conf_com', v_op.id);
        PERFORM pg_temp.dir2('conf_tra', v_op.id);
    END LOOP;
    FOR v_op IN SELECT i.id FROM public.inscripciones_deportivas i WHERE i.alumno_id IN (
        SELECT pg_temp.u(s) FROM unnest(ARRAY['07', '08', '09', '0a', '0b', '0d']) AS s) LOOP
        PERFORM pg_temp.dir2('canc_dep', v_op.id);
        PERFORM pg_temp.dir2('conf_dep', v_op.id);
    END LOOP;
END $$;
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

DO $$
BEGIN
    -- Toda matrícula sigue con sus datos de cierre (solo 008 las escribe).
    IF EXISTS (
        SELECT 1 FROM public.alumnos a
        WHERE a.perfil_id IN (SELECT pg_temp.u(s) FROM unnest(ARRAY['07', '08', '09', '0a', '0b', '0d']) AS s)
          AND (
            (a.estado = 'ACTIVO'
             AND (SELECT count(*) FROM public.matriculas m
                  WHERE m.alumno_id = a.perfil_id AND m.fecha_cierre IS NULL) <> 1)
            OR (a.estado = 'INACTIVO'
                AND EXISTS (SELECT 1 FROM public.matriculas m
                            WHERE m.alumno_id = a.perfil_id AND m.fecha_cierre IS NULL))
          )
    ) THEN
        RAISE EXCEPTION 'FALLO J2: hay un alumno ACTIVO sin exactamente una matrícula vigente, o un INACTIVO con matrícula vigente';
    END IF;
    IF (SELECT count(*) FROM public.alumnos
        WHERE perfil_id IN (SELECT pg_temp.u(s) FROM unnest(ARRAY['07', '08', '09', '0b']) AS s)
          AND estado = 'ACTIVO') <> 4
       OR (SELECT count(*) FROM public.alumnos
           WHERE perfil_id IN (SELECT pg_temp.u(s) FROM unnest(ARRAY['0a', '0d']) AS s)
             AND estado = 'INACTIVO') <> 2 THEN
        RAISE EXCEPTION 'FALLO J2: los estados de los alumnos del fixture no son los que dejaron los flujos de 008';
    END IF;
    PERFORM pg_temp.ok('J2 [D5, RF16-unicidad]: tras ejercer confirmar y cancelar sobre todas las matrículas e inscripciones del fixture, ningún alumno ACTIVO queda sin exactamente una matrícula vigente ni ningún INACTIVO con matrícula vigente (invariante de 008, ejercido con SET CONSTRAINTS ALL IMMEDIATE); las funciones nuevas no modifican matrículas ni alumnos');
END $$;

-- J3. Las cancelaciones administrativas de J2 dejaron las filas (sin borrado), y
-- toda fila confirmada sigue con su confirmación.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.confirmaciones_inscripcion c
        WHERE (c.matricula_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.matriculas m WHERE m.id = c.matricula_id))
           OR (c.inscripcion_deportiva_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.inscripciones_deportivas i WHERE i.id = c.inscripcion_deportiva_id))
           OR (c.inscripcion_servicio_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.inscripciones_servicios i WHERE i.id = c.inscripcion_servicio_id))
    ) THEN
        RAISE EXCEPTION 'FALLO J3: una confirmación quedó sin su inscripción';
    END IF;
    IF (SELECT count(*) FROM public.inscripciones_servicios
        WHERE alumno_id = pg_temp.u('07')) <> 3
       OR (SELECT count(*) FROM public.inscripciones_deportivas
           WHERE alumno_id = pg_temp.u('07')) <> 2 THEN
        RAISE EXCEPTION 'FALLO J3: la alumna A perdió o ganó filas por las cancelaciones administrativas';
    END IF;
    PERFORM pg_temp.ok('J3 [D6, D3]: después de todas las cancelaciones administrativas no falta ninguna fila (la alumna A conserva sus 3 inscripciones a servicios y 2 deportivas, canceladas y activas) y ninguna confirmación quedó huérfana');
END $$;

ROLLBACK;

-- Si el script llega hasta acá sin FALLO, las garantías de EPT-62 (RF16) quedan
-- demostradas sin dejar datos.
