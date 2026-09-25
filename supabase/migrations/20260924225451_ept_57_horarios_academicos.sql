-- EPT-57: franjas académicas y compatibilidad bidireccional con deportes.
-- El catálogo de 015 no se modifica: solo se reutilizan o insertan ternas nuevas.

CREATE TABLE public.materias_cursos_horarios (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    asignacion_id uuid NOT NULL REFERENCES public.materias_cursos(id) ON DELETE RESTRICT,
    horario_id uuid NOT NULL REFERENCES public.horarios(id) ON DELETE RESTRICT,
    activo boolean NOT NULL DEFAULT true,
    fecha_alta timestamptz NOT NULL DEFAULT now(),
    fecha_baja timestamptz,
    CONSTRAINT materias_cursos_horarios_estado CHECK (activo = (fecha_baja IS NULL)),
    CONSTRAINT materias_cursos_horarios_fecha CHECK (fecha_baja IS NULL OR fecha_baja >= fecha_alta)
);
CREATE UNIQUE INDEX materias_cursos_horarios_unica_activa
    ON public.materias_cursos_horarios(asignacion_id, horario_id) WHERE activo;
CREATE INDEX materias_cursos_horarios_asignacion ON public.materias_cursos_horarios(asignacion_id, activo);
CREATE INDEX materias_cursos_horarios_horario ON public.materias_cursos_horarios(horario_id);

-- Las reactivaciones y reasignaciones no borran la historia de la relación.
CREATE TABLE public.materias_cursos_horarios_historial (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    franja_id uuid NOT NULL REFERENCES public.materias_cursos_horarios(id) ON DELETE RESTRICT,
    asignacion_anterior uuid NOT NULL,
    horario_anterior uuid NOT NULL,
    activo_anterior boolean NOT NULL,
    fecha_baja_anterior timestamptz,
    asignacion_nueva uuid NOT NULL,
    horario_nuevo uuid NOT NULL,
    activo_nuevo boolean NOT NULL,
    cambiado_en timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX materias_cursos_horarios_historial_franja ON public.materias_cursos_horarios_historial(franja_id, cambiado_en DESC);

-- Un bloqueo compartido serializa cambios de franjas deportivas y académicas.
CREATE FUNCTION app_private.bloquear_configuracion_horaria()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('ept57_configuracion_horaria'));
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app_private.bloquear_configuracion_horaria() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER a_bloquear_configuracion_deportiva
    BEFORE INSERT OR UPDATE ON public.grupos_deportivos_horarios
    FOR EACH ROW EXECUTE FUNCTION app_private.bloquear_configuracion_horaria();

-- La función privada devuelve solo el primer conflicto del alumno y no se
-- expone a los roles de aplicación. Todas las comparaciones invocan 015.
CREATE FUNCTION app_private.primer_conflicto_academico_deportivo(
    p_alumno uuid, p_curso uuid, p_horario uuid DEFAULT NULL, p_grupo uuid DEFAULT NULL
)
RETURNS TABLE(actividad text, dia smallint, inicio time, fin time)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT d.nombre::text || ' (' || g.nombre::text || ')', hs.dia_semana,
           hs.hora_inicio, hs.hora_fin
    FROM public.inscripciones_deportivas i
    JOIN public.grupos_deportivos g ON g.id = i.grupo_id AND g.activo
    JOIN public.deportes d ON d.id = g.deporte_id
    JOIN public.grupos_deportivos_horarios gh ON gh.grupo_id = g.id AND gh.activo
    JOIN public.horarios hs ON hs.id = gh.horario_id
    JOIN public.materias_cursos mc ON mc.curso_id = p_curso AND mc.activo
    JOIN public.materias_cursos_horarios ah ON ah.asignacion_id = mc.id AND ah.activo
    JOIN public.horarios ha ON ha.id = ah.horario_id
    WHERE i.alumno_id = p_alumno AND i.estado = 'ACTIVA'
      AND (p_horario IS NULL OR ah.horario_id = p_horario)
      AND (p_grupo IS NULL OR i.grupo_id = p_grupo)
      AND app_private.intervalos_se_superponen(
            ha.dia_semana, ha.hora_inicio, ha.hora_fin,
            hs.dia_semana, hs.hora_inicio, hs.hora_fin)
    ORDER BY hs.dia_semana, hs.hora_inicio, d.nombre, g.nombre LIMIT 1;
$$;
REVOKE ALL ON FUNCTION app_private.primer_conflicto_academico_deportivo(uuid,uuid,uuid,uuid)
    FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION app_private.lanzar_conflicto_academico_deportivo(
    p_actividad text, p_dia smallint, p_inicio time, p_fin time
)
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
    RAISE EXCEPTION USING ERRCODE = 'P5595',
      MESSAGE = pg_catalog.format('Conflicto con %s: %s de %s a %s.',
        p_actividad, app_private.nombre_dia_semana(p_dia),
        pg_catalog.to_char(p_inicio, 'HH24:MI'), pg_catalog.to_char(p_fin, 'HH24:MI')),
      DETAIL = pg_catalog.json_build_object('actividad', p_actividad, 'dia_semana', p_dia,
        'hora_inicio', pg_catalog.to_char(p_inicio, 'HH24:MI'),
        'hora_fin', pg_catalog.to_char(p_fin, 'HH24:MI'))::text;
END;
$$;
REVOKE ALL ON FUNCTION app_private.lanzar_conflicto_academico_deportivo(text,smallint,time,time)
    FROM PUBLIC, anon, authenticated, service_role;

-- El trigger valida también escrituras de servicio o SQL directo. El índice
-- parcial es la garantía final de duplicados ante concurrencia.
CREATE FUNCTION app_private.validar_franja_academica()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_curso uuid;
    v_horario public.horarios;
    v_otra record;
    v_alumno record;
    v_conflicto record;
BEGIN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('ept57_configuracion_horaria'));
    IF TG_OP = 'UPDATE' THEN
        IF NEW.id IS DISTINCT FROM OLD.id OR NEW.fecha_alta IS DISTINCT FROM OLD.fecha_alta THEN
            RAISE EXCEPTION USING ERRCODE = 'P5596', MESSAGE = 'La identidad y fecha de alta de la franja son inmutables.';
        END IF;
        IF NEW.asignacion_id IS NOT DISTINCT FROM OLD.asignacion_id
           AND NEW.horario_id IS NOT DISTINCT FROM OLD.horario_id
           AND NEW.activo IS NOT DISTINCT FROM OLD.activo THEN RETURN NEW; END IF;
    END IF;
    IF NOT NEW.activo THEN
        NEW.fecha_baja := COALESCE(NEW.fecha_baja, now());
        RETURN NEW;
    END IF;
    NEW.fecha_baja := NULL;
    SELECT mc.curso_id INTO v_curso FROM public.materias_cursos mc
    WHERE mc.id = NEW.asignacion_id AND mc.activo;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P5593', MESSAGE = 'La asignación de materia debe existir y estar activa.';
    END IF;
    SELECT * INTO v_horario FROM public.horarios h WHERE h.id = NEW.horario_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'La franja del catálogo no existe.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.materias_cursos_horarios f
               WHERE f.asignacion_id=NEW.asignacion_id AND f.horario_id=NEW.horario_id
                 AND f.activo AND f.id<>NEW.id) THEN
        RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Esa franja ya está asignada a esta materia y curso.';
    END IF;
    SELECT a.nombre::text AS actividad, h.dia_semana, h.hora_inicio, h.hora_fin INTO v_otra
    FROM public.materias_cursos_horarios f
    JOIN public.materias_cursos mc ON mc.id = f.asignacion_id AND mc.activo
    JOIN public.actividades a ON a.id = mc.materia_id
    JOIN public.horarios h ON h.id = f.horario_id
    WHERE mc.curso_id = v_curso AND f.activo AND f.id <> NEW.id
      AND app_private.intervalos_se_superponen(v_horario.dia_semana,
        v_horario.hora_inicio, v_horario.hora_fin,
        h.dia_semana, h.hora_inicio, h.hora_fin)
    ORDER BY h.dia_semana, h.hora_inicio LIMIT 1;
    IF FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P5594',
          MESSAGE = pg_catalog.format('La franja se superpone con %s: %s de %s a %s.',
            v_otra.actividad, app_private.nombre_dia_semana(v_otra.dia_semana),
            pg_catalog.to_char(v_otra.hora_inicio, 'HH24:MI'),
            pg_catalog.to_char(v_otra.hora_fin, 'HH24:MI')),
          DETAIL = pg_catalog.json_build_object('actividad',v_otra.actividad,
            'dia_semana',v_otra.dia_semana,
            'hora_inicio',pg_catalog.to_char(v_otra.hora_inicio,'HH24:MI'),
            'hora_fin',pg_catalog.to_char(v_otra.hora_fin,'HH24:MI'))::text;
    END IF;
    -- Bloquear alumnos activos ordenadamente coordina con el alta deportiva.
    FOR v_alumno IN
        SELECT a.perfil_id FROM public.matriculas m
        JOIN public.alumnos a ON a.perfil_id = m.alumno_id
        WHERE m.curso_id = v_curso AND m.fecha_cierre IS NULL
        ORDER BY a.perfil_id FOR NO KEY UPDATE OF a
    LOOP
        SELECT d.nombre::text || ' (' || g.nombre::text || ')' AS actividad,
               h.dia_semana AS dia, h.hora_inicio AS inicio, h.hora_fin AS fin
        INTO v_conflicto
        FROM public.inscripciones_deportivas i
        JOIN public.grupos_deportivos g ON g.id = i.grupo_id AND g.activo
        JOIN public.deportes d ON d.id = g.deporte_id
        JOIN public.grupos_deportivos_horarios gh ON gh.grupo_id = g.id AND gh.activo
        JOIN public.horarios h ON h.id = gh.horario_id
        WHERE i.alumno_id = v_alumno.perfil_id AND i.estado = 'ACTIVA'
          AND app_private.intervalos_se_superponen(v_horario.dia_semana,
            v_horario.hora_inicio, v_horario.hora_fin,
            h.dia_semana, h.hora_inicio, h.hora_fin)
        ORDER BY h.dia_semana, h.hora_inicio LIMIT 1;
        IF FOUND THEN
            PERFORM app_private.lanzar_conflicto_academico_deportivo(
                v_conflicto.actividad, v_conflicto.dia, v_conflicto.inicio, v_conflicto.fin);
        END IF;
    END LOOP;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app_private.validar_franja_academica() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER validar_franja_academica
    BEFORE INSERT OR UPDATE ON public.materias_cursos_horarios
    FOR EACH ROW EXECUTE FUNCTION app_private.validar_franja_academica();

CREATE FUNCTION app_private.registrar_cambio_franja_academica()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF ROW(NEW.asignacion_id,NEW.horario_id,NEW.activo,NEW.fecha_baja)
       IS DISTINCT FROM ROW(OLD.asignacion_id,OLD.horario_id,OLD.activo,OLD.fecha_baja) THEN
        INSERT INTO public.materias_cursos_horarios_historial
          (franja_id,asignacion_anterior,horario_anterior,activo_anterior,fecha_baja_anterior,
           asignacion_nueva,horario_nuevo,activo_nuevo)
        VALUES (NEW.id,OLD.asignacion_id,OLD.horario_id,OLD.activo,OLD.fecha_baja,
                NEW.asignacion_id,NEW.horario_id,NEW.activo);
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app_private.registrar_cambio_franja_academica() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER registrar_cambio_franja_academica
    AFTER UPDATE ON public.materias_cursos_horarios
    FOR EACH ROW EXECUTE FUNCTION app_private.registrar_cambio_franja_academica();

-- Alta deportiva: 015 ya bloqueó al alumno y validó cupo, nivel y conflictos
-- entre deportes. Una excepción AFTER INSERT revierte toda la inscripción.
CREATE FUNCTION app_private.validar_alta_deportiva_con_academia()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_curso uuid; v_conflicto record;
BEGIN
    SELECT m.curso_id INTO v_curso FROM public.matriculas m
    WHERE m.alumno_id = NEW.alumno_id AND m.fecha_cierre IS NULL;
    IF v_curso IS NULL THEN RETURN NEW; END IF;
    SELECT a.nombre::text AS actividad, h.dia_semana AS dia,
           h.hora_inicio AS inicio, h.hora_fin AS fin INTO v_conflicto
    FROM public.materias_cursos mc
    JOIN public.actividades a ON a.id = mc.materia_id
    JOIN public.materias_cursos_horarios f ON f.asignacion_id = mc.id AND f.activo
    JOIN public.horarios h ON h.id = f.horario_id
    JOIN public.grupos_deportivos_horarios gh ON gh.grupo_id = NEW.grupo_id AND gh.activo
    JOIN public.horarios hs ON hs.id = gh.horario_id
    WHERE mc.curso_id = v_curso AND mc.activo
      AND app_private.intervalos_se_superponen(h.dia_semana,h.hora_inicio,h.hora_fin,
        hs.dia_semana,hs.hora_inicio,hs.hora_fin)
    ORDER BY h.dia_semana,h.hora_inicio LIMIT 1;
    IF FOUND THEN
        PERFORM app_private.lanzar_conflicto_academico_deportivo(
            v_conflicto.actividad,v_conflicto.dia,v_conflicto.inicio,v_conflicto.fin);
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app_private.validar_alta_deportiva_con_academia() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER validar_alta_deportiva_con_academia
    AFTER INSERT ON public.inscripciones_deportivas
    FOR EACH ROW EXECUTE FUNCTION app_private.validar_alta_deportiva_con_academia();

-- Añadir una franja deportiva también puede generar un conflicto cruzado.
CREATE FUNCTION app_private.validar_franja_deportiva_con_academia()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_horario public.horarios; v_conflicto record;
BEGIN
    IF NOT NEW.activo THEN RETURN NEW; END IF;
    SELECT * INTO v_horario FROM public.horarios WHERE id = NEW.horario_id;
    SELECT a.nombre::text AS actividad, h.dia_semana AS dia,
           h.hora_inicio AS inicio, h.hora_fin AS fin INTO v_conflicto
    FROM public.inscripciones_deportivas i
    JOIN public.matriculas m ON m.alumno_id = i.alumno_id AND m.fecha_cierre IS NULL
    JOIN public.materias_cursos mc ON mc.curso_id = m.curso_id AND mc.activo
    JOIN public.actividades a ON a.id = mc.materia_id
    JOIN public.materias_cursos_horarios f ON f.asignacion_id = mc.id AND f.activo
    JOIN public.horarios h ON h.id = f.horario_id
    WHERE i.grupo_id = NEW.grupo_id AND i.estado = 'ACTIVA'
      AND app_private.intervalos_se_superponen(v_horario.dia_semana,
        v_horario.hora_inicio,v_horario.hora_fin,h.dia_semana,h.hora_inicio,h.hora_fin)
    ORDER BY h.dia_semana,h.hora_inicio LIMIT 1;
    IF FOUND THEN
        PERFORM app_private.lanzar_conflicto_academico_deportivo(
            v_conflicto.actividad,v_conflicto.dia,v_conflicto.inicio,v_conflicto.fin);
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app_private.validar_franja_deportiva_con_academia() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER validar_franja_deportiva_con_academia
    AFTER INSERT OR UPDATE OF activo ON public.grupos_deportivos_horarios
    FOR EACH ROW EXECUTE FUNCTION app_private.validar_franja_deportiva_con_academia();

-- Reactivar una asignación académica con franjas guardadas vuelve a validar.
CREATE FUNCTION app_private.validar_reactivacion_asignacion_con_horarios()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_franja record; v_conflicto record;
BEGIN
    IF NOT NEW.activo OR OLD.activo THEN RETURN NEW; END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('ept57_configuracion_horaria'));
    FOR v_franja IN
        SELECT f.id,h.dia_semana,h.hora_inicio,h.hora_fin
        FROM public.materias_cursos_horarios f
        JOIN public.horarios h ON h.id=f.horario_id
        WHERE f.asignacion_id=NEW.id AND f.activo
    LOOP
        SELECT a.nombre::text AS actividad,h.dia_semana AS dia,
               h.hora_inicio AS inicio,h.hora_fin AS fin INTO v_conflicto
        FROM public.materias_cursos mc
        JOIN public.materias_cursos_horarios f ON f.asignacion_id=mc.id AND f.activo
        JOIN public.horarios h ON h.id=f.horario_id
        JOIN public.actividades a ON a.id=mc.materia_id
        WHERE mc.curso_id=NEW.curso_id AND mc.id<>NEW.id AND mc.activo
          AND app_private.intervalos_se_superponen(v_franja.dia_semana,
            v_franja.hora_inicio,v_franja.hora_fin,h.dia_semana,h.hora_inicio,h.hora_fin)
        LIMIT 1;
        IF FOUND THEN
            PERFORM app_private.lanzar_conflicto_academico_deportivo(
                v_conflicto.actividad,v_conflicto.dia,v_conflicto.inicio,v_conflicto.fin);
        END IF;
    END LOOP;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app_private.validar_reactivacion_asignacion_con_horarios() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER validar_reactivacion_asignacion_con_horarios
    AFTER UPDATE OF activo ON public.materias_cursos
    FOR EACH ROW EXECUTE FUNCTION app_private.validar_reactivacion_asignacion_con_horarios();

-- API privada: la base decide la identidad y el rol, no acepta actor en el cuerpo.
CREATE FUNCTION app_private.configurar_horario_materia(
    p_asignacion_id uuid,p_dia smallint,p_inicio time,p_fin time,p_franja_id uuid DEFAULT NULL
)
RETURNS public.materias_cursos_horarios LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_horario uuid; v_franja public.materias_cursos_horarios;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE='P5505',MESSAGE='Se requiere una identidad autenticada.';
    END IF;
    IF NOT app_private.es_director() THEN
        RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Solo la dirección administra horarios académicos.';
    END IF;
    IF p_dia IS NULL OR p_dia NOT BETWEEN 1 AND 7 THEN
        RAISE EXCEPTION USING ERRCODE='P5585',MESSAGE='El día debe estar entre 1 y 7.';
    END IF;
    IF p_inicio IS NULL OR p_fin IS NULL OR p_inicio >= p_fin
       OR p_inicio >= '24:00' OR p_fin >= '24:00'
       OR p_inicio <> pg_catalog.date_trunc('second',p_inicio::interval)::time
       OR p_fin <> pg_catalog.date_trunc('second',p_fin::interval)::time THEN
        RAISE EXCEPTION USING ERRCODE='P5586',MESSAGE='El rango horario no es válido.';
    END IF;
    INSERT INTO public.horarios(dia_semana,hora_inicio,hora_fin)
    VALUES(p_dia,p_inicio,p_fin) ON CONFLICT(dia_semana,hora_inicio,hora_fin) DO NOTHING;
    SELECT id INTO v_horario FROM public.horarios
    WHERE dia_semana=p_dia AND hora_inicio=p_inicio AND hora_fin=p_fin;
    IF p_franja_id IS NULL THEN
        INSERT INTO public.materias_cursos_horarios(asignacion_id,horario_id)
        VALUES(p_asignacion_id,v_horario) RETURNING * INTO v_franja;
    ELSE
        UPDATE public.materias_cursos_horarios
        SET asignacion_id=p_asignacion_id,horario_id=v_horario,activo=true
        WHERE id=p_franja_id RETURNING * INTO v_franja;
        IF NOT FOUND THEN
            RAISE EXCEPTION USING ERRCODE='P5597',MESSAGE='La franja académica no existe.';
        END IF;
    END IF;
    RETURN v_franja;
END;
$$;
CREATE FUNCTION app_private.cambiar_estado_horario_materia(p_franja_id uuid,p_activo boolean)
RETURNS public.materias_cursos_horarios LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_franja public.materias_cursos_horarios;
BEGIN
    IF (SELECT auth.uid()) IS NULL THEN
        RAISE EXCEPTION USING ERRCODE='P5505',MESSAGE='Se requiere una identidad autenticada.';
    END IF;
    IF NOT app_private.es_director() THEN
        RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Solo la dirección administra horarios académicos.';
    END IF;
    IF p_activo IS NULL THEN
        RAISE EXCEPTION USING ERRCODE='P5598',MESSAGE='El estado de la franja no es válido.';
    END IF;
    UPDATE public.materias_cursos_horarios SET activo=p_activo
    WHERE id=p_franja_id RETURNING * INTO v_franja;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE='P5597',MESSAGE='La franja académica no existe.';
    END IF;
    RETURN v_franja;
END;
$$;
REVOKE ALL ON FUNCTION app_private.configurar_horario_materia(uuid,smallint,time,time,uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.cambiar_estado_horario_materia(uuid,boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.configurar_horario_materia(uuid,smallint,time,time,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.cambiar_estado_horario_materia(uuid,boolean) TO authenticated;

CREATE FUNCTION public.configurar_horario_materia(
    p_asignacion_id uuid,p_dia smallint,p_inicio time,p_fin time,p_franja_id uuid DEFAULT NULL
)
RETURNS public.materias_cursos_horarios LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
    SELECT app_private.configurar_horario_materia(p_asignacion_id,p_dia,p_inicio,p_fin,p_franja_id);
$$;
CREATE FUNCTION public.cambiar_estado_horario_materia(p_franja_id uuid,p_activo boolean)
RETURNS public.materias_cursos_horarios LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
    SELECT app_private.cambiar_estado_horario_materia(p_franja_id,p_activo);
$$;
REVOKE ALL ON FUNCTION public.configurar_horario_materia(uuid,smallint,time,time,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cambiar_estado_horario_materia(uuid,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.configurar_horario_materia(uuid,smallint,time,time,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cambiar_estado_horario_materia(uuid,boolean) TO authenticated;

ALTER TABLE public.materias_cursos_horarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.materias_cursos_horarios_historial ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.materias_cursos_horarios FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.materias_cursos_horarios_historial FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.materias_cursos_horarios TO authenticated;
GRANT SELECT ON public.materias_cursos_horarios_historial TO authenticated;
CREATE POLICY "Dirección consulta franjas académicas" ON public.materias_cursos_horarios
  FOR SELECT TO authenticated USING ((SELECT public.es_director_actual()));
CREATE POLICY "Dirección consulta historial de franjas académicas" ON public.materias_cursos_horarios_historial
  FOR SELECT TO authenticated USING ((SELECT public.es_director_actual()));

-- Al reactivar una asignación conservada, sus franjas vuelven a participar.
-- Esto completa la comprobación académica anterior con los deportes vigentes.
CREATE FUNCTION app_private.validar_reactivacion_asignacion_deportes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_alumno record; v_conflicto record;
BEGIN
    IF NOT NEW.activo OR OLD.activo THEN RETURN NEW; END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('ept57_configuracion_horaria'));
    FOR v_alumno IN
        SELECT a.perfil_id FROM public.matriculas m
        JOIN public.alumnos a ON a.perfil_id=m.alumno_id
        WHERE m.curso_id=NEW.curso_id AND m.fecha_cierre IS NULL
        ORDER BY a.perfil_id FOR NO KEY UPDATE OF a
    LOOP
        SELECT d.nombre::text || ' (' || g.nombre::text || ')' AS actividad,
               hs.dia_semana AS dia, hs.hora_inicio AS inicio, hs.hora_fin AS fin
        INTO v_conflicto
        FROM public.materias_cursos_horarios f
        JOIN public.horarios h ON h.id=f.horario_id
        JOIN public.inscripciones_deportivas i ON i.alumno_id=v_alumno.perfil_id AND i.estado='ACTIVA'
        JOIN public.grupos_deportivos g ON g.id=i.grupo_id AND g.activo
        JOIN public.deportes d ON d.id=g.deporte_id
        JOIN public.grupos_deportivos_horarios gh ON gh.grupo_id=g.id AND gh.activo
        JOIN public.horarios hs ON hs.id=gh.horario_id
        WHERE f.asignacion_id=NEW.id AND f.activo
          AND app_private.intervalos_se_superponen(h.dia_semana,h.hora_inicio,h.hora_fin,
            hs.dia_semana,hs.hora_inicio,hs.hora_fin)
        LIMIT 1;
        IF FOUND THEN
            PERFORM app_private.lanzar_conflicto_academico_deportivo(
                v_conflicto.actividad,v_conflicto.dia,v_conflicto.inicio,v_conflicto.fin);
        END IF;
    END LOOP;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app_private.validar_reactivacion_asignacion_deportes() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER validar_reactivacion_asignacion_deportes
    AFTER UPDATE OF activo ON public.materias_cursos
    FOR EACH ROW EXECUTE FUNCTION app_private.validar_reactivacion_asignacion_deportes();

-- Una matrícula nueva o reabierta también debe respetar el estado resultante.
CREATE FUNCTION app_private.validar_matricula_con_deportes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_conflicto record;
BEGIN
    IF NEW.fecha_cierre IS NOT NULL THEN RETURN NEW; END IF;
    PERFORM 1 FROM public.alumnos a WHERE a.perfil_id=NEW.alumno_id FOR NO KEY UPDATE;
    SELECT a.nombre::text AS actividad,h.dia_semana AS dia,
           h.hora_inicio AS inicio,h.hora_fin AS fin INTO v_conflicto
    FROM public.materias_cursos mc
    JOIN public.actividades a ON a.id=mc.materia_id
    JOIN public.materias_cursos_horarios f ON f.asignacion_id=mc.id AND f.activo
    JOIN public.horarios h ON h.id=f.horario_id
    JOIN public.inscripciones_deportivas i ON i.alumno_id=NEW.alumno_id AND i.estado='ACTIVA'
    JOIN public.grupos_deportivos g ON g.id=i.grupo_id AND g.activo
    JOIN public.grupos_deportivos_horarios gh ON gh.grupo_id=g.id AND gh.activo
    JOIN public.horarios hs ON hs.id=gh.horario_id
    WHERE mc.curso_id=NEW.curso_id AND mc.activo
      AND app_private.intervalos_se_superponen(h.dia_semana,h.hora_inicio,h.hora_fin,
        hs.dia_semana,hs.hora_inicio,hs.hora_fin)
    LIMIT 1;
    IF FOUND THEN
        PERFORM app_private.lanzar_conflicto_academico_deportivo(
            v_conflicto.actividad,v_conflicto.dia,v_conflicto.inicio,v_conflicto.fin);
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app_private.validar_matricula_con_deportes() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER validar_matricula_con_deportes
    AFTER INSERT OR UPDATE OF curso_id,fecha_cierre ON public.matriculas
    FOR EACH ROW EXECUTE FUNCTION app_private.validar_matricula_con_deportes();
