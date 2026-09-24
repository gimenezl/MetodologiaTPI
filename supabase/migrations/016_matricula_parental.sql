-- Matrícula parental: vínculo comprobado en la base y operación indivisible.
-- Los bloqueos de escritura respetan alumnos → cursos → matrículas (migración 008).

-- Una sola política SELECT por tabla evita re-evaluar tres políticas
-- permisivas por fila. Conserva exactamente los predicados de 008/009 para
-- DIRECTOR y ESTUDIANTE, y suma el vínculo parental sin recursión RLS.
DROP POLICY "El director consulta todos los legajos academicos" ON public.alumnos;
DROP POLICY "El estudiante consulta su propio legajo academico" ON public.alumnos;
CREATE POLICY "Consulta académica por actor" ON public.alumnos
    FOR SELECT TO authenticated
    USING (
        (SELECT public.es_director_actual())
        OR (perfil_id = (SELECT app_private.perfil_actual())
            AND (SELECT app_private.rol_actual()) = 'ESTUDIANTE')
        OR ((SELECT app_private.rol_actual()) = 'PADRE'
            AND perfil_id IN (SELECT app_private.mis_hijos_ids()))
    );

DROP POLICY "El director consulta todo el historial academico" ON public.matriculas;
DROP POLICY "El estudiante consulta su propio historial academico" ON public.matriculas;
CREATE POLICY "Consulta de matrículas por actor" ON public.matriculas
    FOR SELECT TO authenticated
    USING (
        (SELECT public.es_director_actual())
        OR (alumno_id = (SELECT app_private.perfil_actual())
            AND (SELECT app_private.rol_actual()) = 'ESTUDIANTE')
        OR ((SELECT app_private.rol_actual()) = 'PADRE'
            AND alumno_id IN (SELECT app_private.mis_hijos_ids()))
    );

-- El vínculo saliente puede sobrevivir a un cambio posterior del rol del
-- antiguo padre. Las cuatro políticas de 011 que usan mis_hijos_ids()
-- necesitan la misma comprobación del rol vigente. Se reemplazan únicamente
-- esas ramas; los permisos de staff, estudiante y perfil propio permanecen.
DROP POLICY "Padres ven perfiles de sus hijos" ON public.perfiles;
CREATE POLICY "Padres ven perfiles de sus hijos" ON public.perfiles
    FOR SELECT TO authenticated
    USING ((SELECT app_private.rol_actual()) = 'PADRE'
        AND id IN (SELECT app_private.mis_hijos_ids()));

DROP POLICY "Padres ven asistencias de sus hijos" ON public.asistencias;
CREATE POLICY "Padres ven asistencias de sus hijos" ON public.asistencias
    FOR SELECT TO authenticated
    USING ((SELECT app_private.rol_actual()) = 'PADRE'
        AND estudiante_id IN (SELECT app_private.mis_hijos_ids()));

DROP POLICY "Padre inscribe a sus hijos" ON public.inscripciones;
CREATE POLICY "Padre inscribe a sus hijos" ON public.inscripciones
    FOR INSERT TO authenticated
    WITH CHECK ((SELECT app_private.rol_actual()) = 'PADRE'
        AND estudiante_id IN (SELECT app_private.mis_hijos_ids()));

DROP POLICY "Padre da de baja a sus hijos" ON public.inscripciones;
CREATE POLICY "Padre da de baja a sus hijos" ON public.inscripciones
    FOR DELETE TO authenticated
    USING ((SELECT app_private.rol_actual()) = 'PADRE'
        AND estudiante_id IN (SELECT app_private.mis_hijos_ids()));

CREATE OR REPLACE FUNCTION app_private.matricular_hijo(p_hijo_id UUID, p_curso_id UUID)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_padre_id UUID;
    v_rol_hijo TEXT;
    v_estado public.estado_alumno;
    v_legajo TEXT;
    v_matricula_id UUID;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;

    IF (SELECT app_private.rol_actual()) IS DISTINCT FROM 'PADRE' THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Solo un padre puede matricular a un hijo.';
    END IF;

    v_padre_id := app_private.perfil_actual();
    IF v_padre_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'No se encontró un perfil parental válido.';
    END IF;

    -- El mismo error cubre UUID inexistente y persona ajena. El bloqueo impide
    -- que el vínculo se elimine mientras esta operación está en curso.
    PERFORM 1 FROM public.padres_hijos ph
    WHERE ph.padre_id = v_padre_id AND ph.hijo_id = p_hijo_id
    FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P5520', MESSAGE = 'El hijo solicitado no está disponible.';
    END IF;

    SELECT r.nombre, p.legajo_nro, a.estado
    INTO v_rol_hijo, v_legajo, v_estado
    FROM public.alumnos a
    JOIN public.perfiles p ON p.id = a.perfil_id
    JOIN public.roles r ON r.id = p.rol_id
    WHERE a.perfil_id = p_hijo_id
    FOR UPDATE OF a;
    IF NOT FOUND OR v_rol_hijo IS DISTINCT FROM 'ESTUDIANTE' THEN
        RAISE EXCEPTION USING ERRCODE = 'P5521', MESSAGE = 'El hijo no tiene un legajo académico válido.';
    END IF;
    IF v_legajo IS NULL OR pg_catalog.btrim(v_legajo) = '' THEN
        RAISE EXCEPTION USING ERRCODE = 'P5521', MESSAGE = 'El hijo necesita un número de legajo válido.';
    END IF;
    IF v_estado IS DISTINCT FROM 'INACTIVO' THEN
        RAISE EXCEPTION USING ERRCODE = 'P5522', MESSAGE = 'El alumno ya está activo.';
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.matriculas m
        WHERE m.alumno_id = p_hijo_id AND m.fecha_cierre IS NULL
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P5523', MESSAGE = 'El alumno ya tiene una matrícula vigente.';
    END IF;

    -- El trigger de 008 toma el curso FOR SHARE y comprueba que siga activo.
    -- Su verificación y este INSERT ocurren en la misma transacción.
    INSERT INTO public.matriculas (alumno_id, curso_id)
    VALUES (p_hijo_id, p_curso_id)
    RETURNING id INTO v_matricula_id;

    UPDATE public.alumnos
    SET estado = 'ACTIVO', fecha_actualizacion = pg_catalog.now()
    WHERE perfil_id = p_hijo_id;

    RETURN v_matricula_id;
END;
$$;

REVOKE ALL ON FUNCTION app_private.matricular_hijo(UUID, UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.matricular_hijo(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.matricular_hijo(p_hijo_id UUID, p_curso_id UUID)
RETURNS UUID
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT app_private.matricular_hijo(p_hijo_id, p_curso_id);
$$;

REVOKE ALL ON FUNCTION public.matricular_hijo(UUID, UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.matricular_hijo(UUID, UUID) TO authenticated;

-- Proyección privada de los otros dos dominios académicos. No se amplían sus
-- políticas RLS: el padre nunca recibe acceso directo a tablas de terceros.
-- Solo se devuelven asignaciones del curso vigente del hijo vinculado y sus
-- inscripciones deportivas ACTIVAS, sin identificadores de otras personas.
CREATE OR REPLACE FUNCTION app_private.consultar_detalle_hijo(p_hijo_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_padre_id UUID;
    v_materias JSONB;
    v_deportes JSONB;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P5505', MESSAGE = 'Se requiere una identidad autenticada.';
    END IF;
    IF (SELECT app_private.rol_actual()) IS DISTINCT FROM 'PADRE' THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Solo un padre puede consultar este detalle.';
    END IF;
    v_padre_id := app_private.perfil_actual();
    IF NOT EXISTS (
        SELECT 1 FROM public.padres_hijos ph
        WHERE ph.padre_id = v_padre_id AND ph.hijo_id = p_hijo_id
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P5520', MESSAGE = 'El hijo solicitado no está disponible.';
    END IF;

    SELECT COALESCE(pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
            'materia', a.nombre,
            'docente', CASE WHEN p.id IS NULL THEN NULL
                ELSE pg_catalog.concat_ws(' ', p.nombre, p.apellido) END
        ) ORDER BY a.nombre), '[]'::jsonb)
    INTO v_materias
    FROM public.matriculas m
    JOIN public.materias_cursos mc ON mc.curso_id = m.curso_id AND mc.activo
    JOIN public.actividades a ON a.id = mc.materia_id AND a.tipo = 'CURRICULAR' AND a.activo
    LEFT JOIN public.perfiles p ON p.id = mc.profesor_id
    WHERE m.alumno_id = p_hijo_id AND m.fecha_cierre IS NULL;

    SELECT COALESCE(pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object('deporte', d.nombre, 'grupo', g.nombre)
        ORDER BY d.nombre, g.nombre), '[]'::jsonb)
    INTO v_deportes
    FROM public.inscripciones_deportivas i
    JOIN public.grupos_deportivos g ON g.id = i.grupo_id
    JOIN public.deportes d ON d.id = i.deporte_id
    WHERE i.alumno_id = p_hijo_id AND i.estado = 'ACTIVA';

    RETURN pg_catalog.jsonb_build_object('materias', v_materias, 'deportes', v_deportes);
END;
$$;

REVOKE ALL ON FUNCTION app_private.consultar_detalle_hijo(UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.consultar_detalle_hijo(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.consultar_detalle_hijo(p_hijo_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT app_private.consultar_detalle_hijo(p_hijo_id);
$$;

REVOKE ALL ON FUNCTION public.consultar_detalle_hijo(UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consultar_detalle_hijo(UUID) TO authenticated;
