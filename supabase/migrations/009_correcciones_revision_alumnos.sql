-- ============================================================
-- EDUCAR PARA TRANSFORMAR — Correcciones de la revisión de EPT-9
-- ============================================================
-- Migración aditiva. No modifica 001 a 008.
--
-- ============================================================
-- QUÉ PROBLEMAS CIERRA
-- ============================================================
--
-- 1. LAS RESTRICCIONES CHECK EXIGÍAN UN PRIVILEGIO QUE NADIE TENÍA
--
--    La migración 008 definió `perfiles_dni_valido` y `perfiles_legajo_valido`
--    llamando a `app_private.dni_valido()` y `app_private.legajo_valido()`, y
--    revocó su EXECUTE de `authenticated`. En PostgreSQL, la función de una
--    restricción CHECK se ejecuta con los privilegios de quien escribe, así que
--    cualquier inserción legítima desde una sesión `authenticated` fallaba.
--    Reproducido sobre la base local antes de escribir esta migración:
--
--        SET LOCAL ROLE authenticated;
--        INSERT INTO public.perfiles (rol_id, nombre, apellido, dni, legajo_nro)
--        VALUES (…, 'Nuevo', 'Legajo', '94000002', 'LEG-PERM-1');
--        -- ERROR: permission denied for function dni_valido
--
--    El efecto no era teórico: `/dashboard/legajos` inserta perfiles con el
--    cliente del navegador, de modo que el alta de cualquier legajo quedó rota.
--    Las pruebas de EPT-9 no lo detectaron porque su alta pasa por
--    `app_private.crear_alumno`, que es SECURITY DEFINER y corre como su dueño.
--
--    La corrección NO es otorgar EXECUTE: eso convertiría dos funciones del
--    esquema privado en superficie alcanzable por cualquier sesión autenticada.
--    Las restricciones pasan a ser expresiones en línea, inmutables y sin
--    ninguna llamada a función propia. Las funciones se conservan porque
--    `app_private.crear_alumno` y `app_private.corregir_identidad_alumno` las
--    usan para rechazar temprano con un mensaje preciso, y ahí corren con los
--    privilegios del dueño.
--
-- 2. EL CONTRATO DEL LEGAJO NO RECHAZABA ESPACIOS EN BLANCO UNICODE
--
--    `btrim(texto)` sin segundo argumento solo recorta espacios ASCII, así que
--    «LEG-1» seguido de un espacio no separable (U+00A0) o de un espacio EM
--    (U+2003) se aceptaba, y dos legajos visualmente idénticos quedaban como
--    registros distintos. El conjunto se enumera ahora de forma explícita.
--
-- 3. LA LECTURA DEL LEGAJO PROPIO NO EXIGÍA CONSERVAR EL ROL ESTUDIANTE
--
--    Las políticas de 008 comparaban únicamente `perfil_id` con el perfil de la
--    sesión. Un perfil que dejara de ser ESTUDIANTE conservaba el acceso a su
--    legajo académico mientras la fila de `alumnos` existiera. El rol vigente
--    pasa a formar parte del predicado.
--
-- ============================================================
-- POR QUÉ EXPRESIONES EN LÍNEA Y NO UNA FUNCIÓN CON GRANT
-- ============================================================
-- Una restricción CHECK exige una expresión inmutable. `pg_catalog.btrim`,
-- `pg_catalog.char_length` y el operador `~` lo son; `pg_catalog.concat` no,
-- por lo que el conjunto de espacios en blanco se escribe como literal con
-- escapes `\uXXXX` en lugar de construirse con `chr()`. Así la restricción no
-- depende de ningún privilegio y no hay forma de romperla revocando permisos.
--
-- El literal se escribe con escapes legibles, no con los caracteres reales:
-- un revisor tiene que poder ver qué se está rechazando.
-- ============================================================


-- ================================================================
-- 1. LAS FUNCIONES DE VALIDACIÓN, CON EL CONTRATO DEFINITIVO
-- ================================================================
-- Se definen primero para que la verificación previa pueda usarlas. Ya no las
-- invoca ninguna restricción, pero sí las operaciones privilegiadas de 008.
-- Tienen que decir exactamente lo mismo que las restricciones de la sección 3,
-- o un alta rechazada por la función y aceptada por la tabla dejarían de
-- coincidir.
--
-- La clase de dígitos se enumera a propósito: en una expresión regular de
-- PostgreSQL `\d` equivale a `[[:digit:]]` y acepta dígitos no ASCII (por
-- ejemplo el arábigo-índico `٨`, U+0668), y un rango como `[0-9]` depende del
-- orden de la colación.
CREATE OR REPLACE FUNCTION app_private.dni_valido(p_dni TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT p_dni IS NOT NULL
       AND p_dni OPERATOR(pg_catalog.~) '^[0123456789]{7,8}$';
$$;

-- Conjunto de espacios en blanco Unicode que no se admiten en los extremos.
--
-- Se construye con `pg_catalog.chr()` y el operador `||`, los dos IMMUTABLE, en
-- lugar de escribir un literal. La razon es practica: un literal obliga a poner
-- caracteres invisibles en el archivo o a confiar en secuencias de escape, y en
-- los dos casos una herramienta de edicion puede vaciarlo sin que se note. Con
-- puntos de codigo numericos el archivo es ASCII puro, se audita leyendolo y
-- cualquier perdida queda visible en el diff. `pg_catalog.concat` no sirve:
-- es STABLE y una restriccion CHECK exige una expresion inmutable.
--
-- El conjunto es exactamente el mismo que valida el formulario, para que la
-- base y el navegador nunca discrepen. Ver `espacioLateralUnicode` en
-- `src/lib/validations.ts`.
--
-- Punto de codigo y nombre de cada caracter rechazado:
--   9      tabulacion                  10     salto de linea
--   11     tabulacion vertical         12     avance de pagina
--   13     retorno de carro            32     espacio ASCII
--   133    next line                   160    espacio no separable
--   5760   ogham space mark            8192   en quad
--   8193   em quad                     8194   en space
--   8195   em space                    8196   three-per-em
--   8197   four-per-em                 8198   six-per-em
--   8199   figure space                8200   punctuation space
--   8201   thin space                  8202   hair space
--   8232   separador de linea          8233   separador de parrafo
--   8239   narrow no-break             8287   espacio matematico medio
--   12288  espacio ideografico         65279  BOM
CREATE OR REPLACE FUNCTION app_private.legajo_valido(p_legajo TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT p_legajo IS NULL
        OR (
            pg_catalog.char_length(p_legajo) BETWEEN 1 AND 50
            AND p_legajo OPERATOR(pg_catalog.=) pg_catalog.btrim(
                p_legajo,
                pg_catalog.chr(9) || pg_catalog.chr(10) || pg_catalog.chr(11)
                || pg_catalog.chr(12) || pg_catalog.chr(13)
                || pg_catalog.chr(32) || pg_catalog.chr(133)
                || pg_catalog.chr(160) || pg_catalog.chr(5760)
                || pg_catalog.chr(8192) || pg_catalog.chr(8193)
                || pg_catalog.chr(8194) || pg_catalog.chr(8195)
                || pg_catalog.chr(8196) || pg_catalog.chr(8197)
                || pg_catalog.chr(8198) || pg_catalog.chr(8199)
                || pg_catalog.chr(8200) || pg_catalog.chr(8201)
                || pg_catalog.chr(8202) || pg_catalog.chr(8232)
                || pg_catalog.chr(8233) || pg_catalog.chr(8239)
                || pg_catalog.chr(8287) || pg_catalog.chr(12288)
                || pg_catalog.chr(65279)
            )
        );
$$;

-- `CREATE OR REPLACE` conserva los privilegios mínimos de 008: revocadas para
-- PUBLIC, anon y authenticated, con EXECUTE solo para service_role, que las
-- necesita en el setup local de pruebas.


-- ================================================================
-- 2. VERIFICACIÓN PREVIA DE LOS DATOS EXISTENTES
-- ================================================================
-- El contrato se endurece, así que antes se comprueba que ninguna fila actual
-- lo incumpla. Si alguna lo hace, la migración falla sin modificar nada: no
-- corresponde normalizar información personal automáticamente.
--
-- El mensaje informa cantidades, nunca el dato.
DO $$
DECLARE
    legajos_invalidos BIGINT;
    dnis_invalidos    BIGINT;
BEGIN
    SELECT pg_catalog.count(*) INTO dnis_invalidos
    FROM public.perfiles p
    WHERE NOT app_private.dni_valido(p.dni);

    IF dnis_invalidos > 0 THEN
        RAISE EXCEPTION
            'No se puede aplicar el contrato de DNI: % perfil(es) no tienen una cadena de 7 u 8 dígitos ASCII. Corregilos explícitamente con la persona titular antes de aplicar la migración.',
            dnis_invalidos;
    END IF;

    SELECT pg_catalog.count(*) INTO legajos_invalidos
    FROM public.perfiles p
    WHERE NOT app_private.legajo_valido(p.legajo_nro);

    IF legajos_invalidos > 0 THEN
        RAISE EXCEPTION
            'No se puede endurecer el contrato de legajo: % perfil(es) tienen un número visualmente vacío o con espacios en blanco Unicode en los extremos. Corregilos explícitamente antes de aplicar la migración.',
            legajos_invalidos;
    END IF;
END $$;


-- ================================================================
-- 3. RESTRICCIONES EN LÍNEA, SIN DEPENDER DE PRIVILEGIOS
-- ================================================================
-- Se reemplazan las dos restricciones de 008. No es una eliminación
-- destructiva: la columna, sus datos y su unicidad quedan intactos; cambia
-- únicamente la expresión que las valida, y el contrato resultante es más
-- estricto, no más laxo.
ALTER TABLE public.perfiles
    DROP CONSTRAINT IF EXISTS perfiles_dni_valido,
    DROP CONSTRAINT IF EXISTS perfiles_legajo_valido;

ALTER TABLE public.perfiles
    ADD CONSTRAINT perfiles_dni_valido
        CHECK (dni OPERATOR(pg_catalog.~) '^[0123456789]{7,8}$');

-- El legajo es opcional a nivel de columna: la obligatoriedad para un
-- estudiante activo la impone el trigger diferido de 008. Cuando existe, no
-- puede estar visualmente vacío ni tener espacios en blanco Unicode en los
-- extremos. Los espacios interiores se conservan: la descripción aprobada no
-- los prohíbe y recortarlos alteraría el número que cargó una persona.
ALTER TABLE public.perfiles
    ADD CONSTRAINT perfiles_legajo_valido
        CHECK (
            legajo_nro IS NULL
            OR (
                pg_catalog.char_length(legajo_nro) BETWEEN 1 AND 50
                AND legajo_nro OPERATOR(pg_catalog.=) pg_catalog.btrim(
                    legajo_nro,
                    pg_catalog.chr(9) || pg_catalog.chr(10) || pg_catalog.chr(11)
                    || pg_catalog.chr(12) || pg_catalog.chr(13)
                    || pg_catalog.chr(32) || pg_catalog.chr(133)
                    || pg_catalog.chr(160) || pg_catalog.chr(5760)
                    || pg_catalog.chr(8192) || pg_catalog.chr(8193)
                    || pg_catalog.chr(8194) || pg_catalog.chr(8195)
                    || pg_catalog.chr(8196) || pg_catalog.chr(8197)
                    || pg_catalog.chr(8198) || pg_catalog.chr(8199)
                    || pg_catalog.chr(8200) || pg_catalog.chr(8201)
                    || pg_catalog.chr(8202) || pg_catalog.chr(8232)
                    || pg_catalog.chr(8233) || pg_catalog.chr(8239)
                    || pg_catalog.chr(8287) || pg_catalog.chr(12288)
                    || pg_catalog.chr(65279)
                )
            )
        );


-- ================================================================
-- 4. LA LECTURA DEL LEGAJO PROPIO EXIGE CONSERVAR EL ROL ESTUDIANTE
-- ================================================================
-- `app_private.rol_actual()` existe desde 005 y ya resuelve el rol vigente sin
-- activar la RLS de `perfiles`. Añadirlo al predicado convierte el acceso
-- propio en una consecuencia del rol actual, no de un vínculo histórico.
DROP POLICY IF EXISTS "El estudiante consulta su propio legajo academico" ON public.alumnos;
CREATE POLICY "El estudiante consulta su propio legajo academico" ON public.alumnos
    FOR SELECT TO authenticated
    USING (
        perfil_id = (SELECT app_private.perfil_actual())
        AND (SELECT app_private.rol_actual()) = 'ESTUDIANTE'
    );

DROP POLICY IF EXISTS "El estudiante consulta su propio historial academico" ON public.matriculas;
CREATE POLICY "El estudiante consulta su propio historial academico" ON public.matriculas
    FOR SELECT TO authenticated
    USING (
        alumno_id = (SELECT app_private.perfil_actual())
        AND (SELECT app_private.rol_actual()) = 'ESTUDIANTE'
    );

-- Las politicas del DIRECTOR no cambian: siguen derivando de
-- `public.es_director_actual()`, que ya lee el rol vigente. Tampoco se agrega
-- ninguna politica de escritura.


-- ================================================================
-- 5. CAMBIO DE CURSO HACIA EL MISMO CURSO
-- ================================================================
-- 008 ya lo rechaza con P5516. Se reafirma aca con el texto definitivo para que
-- la interfaz, la API y la RPC compartan exactamente el mismo mensaje de
-- dominio, y para dejar documentado que es un error de contrato y no una
-- operacion nula silenciosa: aceptarlo abriria y cerraria un tramo de historial
-- sin que nada haya cambiado.
CREATE OR REPLACE FUNCTION app_private.cambiar_curso_alumno(
    p_alumno_id UUID,
    p_curso_id  UUID
)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_estado       public.estado_alumno;
    v_matricula    UUID;
    v_curso_actual UUID;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    IF NOT app_private.es_director() THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Solo un DIRECTOR puede administrar legajos académicos.';
    END IF;

    IF p_curso_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5503', MESSAGE = 'El curso solicitado no existe.';
    END IF;

    SELECT a.estado INTO v_estado
    FROM public.alumnos a
    WHERE a.perfil_id = p_alumno_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P5503', MESSAGE = 'El legajo académico solicitado no existe.';
    END IF;

    IF v_estado <> 'ACTIVO' THEN
        RAISE EXCEPTION USING ERRCODE = 'P5513',
            MESSAGE = 'Un estudiante inactivo no tiene matrícula. Reactivalo eligiendo un curso.';
    END IF;

    SELECT m.id, m.curso_id INTO v_matricula, v_curso_actual
    FROM public.matriculas m
    WHERE m.alumno_id = p_alumno_id AND m.fecha_cierre IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P5511',
            MESSAGE = 'Un estudiante activo debe tener exactamente una matrícula vigente.';
    END IF;

    IF v_curso_actual = p_curso_id THEN
        RAISE EXCEPTION USING ERRCODE = 'P5516',
            MESSAGE = 'El estudiante ya está matriculado en ese curso. Elegí un curso distinto.';
    END IF;

    UPDATE public.matriculas
    SET fecha_cierre = NOW(),
        motivo_cierre = 'CAMBIO_DE_CURSO'
    WHERE id = v_matricula;

    INSERT INTO public.matriculas (alumno_id, curso_id)
    VALUES (p_alumno_id, p_curso_id);

    UPDATE public.alumnos
    SET fecha_actualizacion = NOW()
    WHERE perfil_id = p_alumno_id;

    RETURN p_alumno_id;
END;
$$;


-- ================================================================
-- 6. LO QUE NO CAMBIA
-- ================================================================
-- No se agregan privilegios. No se crea ninguna política de escritura ni de
-- DELETE. No se otorga EXECUTE de `app_private` a `authenticated`. Los grants
-- de tablas, vistas y secuencias quedan exactamente como los dejó 008.


-- ================================================================
-- 7. AUTOVERIFICACION DEL CONTRATO DEL LEGAJO
-- ================================================================
-- Esta migracion existe, entre otras cosas, porque una restriccion CHECK
-- quedo vigente con un conjunto de recorte vacio: seguia declarada, con su
-- nombre de siempre, y no rechazaba nada. Una restriccion que aparenta
-- cobertura es peor que su ausencia, porque nadie la vuelve a mirar.
--
-- Por eso el contrato se ejerce aca mismo, contra la tabla real, sobre una
-- fila que se descarta. Si un solo caso pasa, la migracion aborta y no deja
-- la base a medio migrar: todo el archivo corre en una transaccion.
--
-- Tambien se comprueba el caso positivo. Una restriccion que rechaza todo
-- pasaria los doce casos negativos sin proteger nada.
DO $$
DECLARE
    v_caso      RECORD;
    v_rol       INTEGER := (SELECT id FROM public.roles WHERE nombre = 'DOCENTE');
    v_perfil    UUID;
    v_aceptados TEXT := '';
BEGIN
    FOR v_caso IN
        SELECT * FROM (VALUES
            ('vacio', ''),
            ('espacios ASCII', pg_catalog.repeat(pg_catalog.chr(32), 3)),
            ('tabulacion', pg_catalog.chr(9)),
            ('salto de linea', pg_catalog.chr(10)),
            ('retorno de carro', pg_catalog.chr(13)),
            ('espacio no separable', pg_catalog.chr(160)),
            ('espacio EM', pg_catalog.chr(8195)),
            ('espacio ASCII inicial', pg_catalog.chr(32) || 'LEG-AUTOTEST'),
            ('espacio ASCII final', 'LEG-AUTOTEST' || pg_catalog.chr(32)),
            ('no separable inicial', pg_catalog.chr(160) || 'LEG-AUTOTEST'),
            ('espacio EM final', 'LEG-AUTOTEST' || pg_catalog.chr(8195)),
            ('BOM final', 'LEG-AUTOTEST' || pg_catalog.chr(65279))
        ) AS c(etiqueta, valor)
    LOOP
        BEGIN
            INSERT INTO public.perfiles (rol_id, nombre, apellido, dni, legajo_nro)
            VALUES (v_rol, 'Autoverificacion', 'Migracion', '90090001', v_caso.valor)
            RETURNING id INTO v_perfil;

            v_aceptados := v_aceptados || v_caso.etiqueta || '; ';
            DELETE FROM public.perfiles WHERE id = v_perfil;
        EXCEPTION WHEN check_violation THEN
            NULL;
        END;
    END LOOP;

    IF v_aceptados <> '' THEN
        RAISE EXCEPTION
            'La restriccion perfiles_legajo_valido no rechaza: %. '
            'El conjunto de espacios en blanco quedo incompleto.', v_aceptados;
    END IF;

    -- Caso positivo: un legajo legitimo, con espacios interiores, se acepta.
    INSERT INTO public.perfiles (rol_id, nombre, apellido, dni, legajo_nro)
    VALUES (v_rol, 'Autoverificacion', 'Migracion', '90090002', 'LEG 2027 018')
    RETURNING id INTO v_perfil;
    DELETE FROM public.perfiles WHERE id = v_perfil;

    RAISE NOTICE 'Contrato del legajo verificado: 12 casos rechazados, 1 aceptado.';
END $$;
