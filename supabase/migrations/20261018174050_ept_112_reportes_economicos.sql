-- EPT-112. Lectura económica, sin tablas, DML ni permisos de escritura nuevos.
-- Saldo vigente EPT-107; fecha de transferencia civil, nunca instante supuesto.
CREATE FUNCTION app_private.curso_reporte_economico(p_alumno UUID, p_fecha DATE)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_desde TIMESTAMPTZ; v_hasta TIMESTAMPTZ; v_cantidad BIGINT; v_completa BOOLEAN;
        v_curso UUID; v_resultado JSONB;
BEGIN
  PERFORM app_private.exigir_director_reporte();
  v_desde := p_fecha::TIMESTAMP AT TIME ZONE 'America/Argentina/Buenos_Aires';
  v_hasta := (p_fecha + 1)::TIMESTAMP AT TIME ZONE 'America/Argentina/Buenos_Aires';
  -- Intervalos [inicio,cierre). Un cierre a medianoche no ocupa el día siguiente.
  SELECT count(*), bool_and(m.fecha_inicio <= v_desde AND
         (m.fecha_cierre IS NULL OR m.fecha_cierre >= v_hasta)), min(m.curso_id::TEXT)::UUID
    INTO v_cantidad, v_completa, v_curso
    FROM public.matriculas m WHERE m.alumno_id = p_alumno
      AND m.fecha_inicio < v_hasta AND (m.fecha_cierre IS NULL OR m.fecha_cierre > v_desde)
      AND (m.fecha_cierre IS NULL OR m.fecha_cierre > m.fecha_inicio);
  IF v_cantidad = 1 AND v_completa THEN
    SELECT jsonb_build_object('curso_id',c.id,'curso',c.denominacion,
      'nivel_id',n.id,'nivel',n.nombre,'causa',NULL) INTO v_resultado
    FROM public.cursos c JOIN public.niveles n ON n.id=c.nivel_id WHERE c.id=v_curso;
    RETURN v_resultado;
  END IF;
  RETURN jsonb_build_object('curso_id',NULL,'curso','Curso no determinable',
    'nivel_id',NULL,'nivel',NULL,'causa',CASE WHEN v_cantidad>1
      THEN 'Varias matrículas posibles' ELSE 'Historial insuficiente' END);
END $$;

CREATE FUNCTION public.reporte_economico(
  p_reporte TEXT, p_desde DATE, p_hasta DATE, p_filtros JSONB DEFAULT '{}'::JSONB,
  p_pagina INTEGER DEFAULT 1, p_tamano INTEGER DEFAULT 50, p_huella TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = ''
-- El tamaño y rama varían mucho entre filtros: no reutilizar un plan genérico
-- elegido con otro reporte o cardinalidad en una conexión PostgREST preparada.
SET plan_cache_mode = 'force_custom_plan' AS $$
DECLARE v_resultado JSONB; v_clave TEXT; v_valor TEXT;
BEGIN
  -- Siempre antes del identificador, filtros y consultas, también por PostgREST.
  PERFORM app_private.exigir_director_reporte();
  IF p_reporte IS NULL OR p_reporte NOT IN ('ingresos','completos','incompletos','deportes','recorridos')
    OR p_desde IS NULL OR p_hasta IS NULL OR NOT isfinite(p_desde) OR NOT isfinite(p_hasta)
    OR p_desde > p_hasta OR p_desde < DATE '0001-01-01' OR p_hasta > DATE '9998-12-31'
    OR p_pagina IS NULL OR p_pagina NOT BETWEEN 1 AND 1000000
    OR p_tamano IS NULL OR p_tamano NOT IN (25,50,100)
    OR p_filtros IS NULL OR jsonb_typeof(p_filtros)<>'object'
    OR (p_huella IS NOT NULL AND p_huella !~ '^[a-f0-9]{32}$') THEN
    RAISE EXCEPTION USING ERRCODE='P6890', MESSAGE='Los filtros del reporte no son válidos.';
  END IF;
  FOR v_clave, v_valor IN SELECT key,value FROM jsonb_each_text(p_filtros) LOOP
    IF v_valor IS NULL OR length(v_valor)>100 OR
      v_clave NOT IN ('anio','nivel','curso','causa','deporte','recorrido','horario','profesor') OR
      (v_clave IN ('anio','nivel') AND v_valor !~ '^[1-9][0-9]{0,3}$') OR
      (v_clave='causa' AND v_valor NOT IN ('Historial insuficiente','Varias matrículas posibles')) OR
      (v_clave IN ('deporte','recorrido','horario','profesor') AND
        v_valor !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') OR
      (v_clave IN ('deporte','horario','profesor') AND p_reporte<>'deportes') OR
      (v_clave='recorrido' AND p_reporte<>'recorridos') THEN
      RAISE EXCEPTION USING ERRCODE='P6890', MESSAGE='Los filtros del reporte no son válidos.';
    END IF;
  END LOOP;
  WITH aprobadas AS MATERIALIZED (
    SELECT ip.pago_id,ip.item_factura_id,ip.importe,i.factura_id,i.alumno_id,i.tipo,
      i.inscripcion_deportiva_id,i.inscripcion_servicio_id,p.fecha_transferencia
    FROM public.imputaciones_pago ip JOIN public.pagos p ON p.id=ip.pago_id AND p.alumno_id=ip.alumno_id
    JOIN public.items_factura i ON i.id=ip.item_factura_id AND i.alumno_id=ip.alumno_id
    WHERE ip.activa AND p.estado='APROBADO'
  ), por_pago AS MATERIALIZED (
    -- Una sola fila materializada evita que estadísticas aún pequeñas elijan
    -- recorrer el agregado completo por cada pago (producto cuadrático).
    SELECT jsonb_object_agg(pago_id::TEXT,imputado) AS importes
    FROM (SELECT pago_id,sum(importe)*100 AS imputado FROM aprobadas GROUP BY pago_id) x
  ), estado AS MATERIALIZED (
    SELECT * FROM public.estado_cuotas_alumno WHERE p_reporte IN ('completos','incompletos')
  ), relaciones AS (
    SELECT a.pago_id,a.factura_id,a.alumno_id,a.fecha_transferencia,sum(a.importe) AS importe
    FROM aprobadas a GROUP BY a.pago_id,a.factura_id,a.alumno_id,a.fecha_transferencia
  ), horarios AS (
    SELECT gh.grupo_id, jsonb_agg(jsonb_build_object('id',h.id,'dia',h.dia_semana,
      'desde',h.hora_inicio,'hasta',h.hora_fin) ORDER BY h.dia_semana,h.hora_inicio,h.id) AS lista
    FROM public.grupos_deportivos_horarios gh JOIN public.horarios h ON h.id=gh.horario_id
    GROUP BY gh.grupo_id
  ), origen AS (
    -- RF17: un pago, no una fila por archivo, ítem ni factura.
    SELECT p.id::TEXT AS id,p.alumno_id,p.id AS pago_id,NULL::UUID AS factura_id,
      NULL::UUID AS item_id,p.fecha_transferencia AS fecha,'Transferencia'::TEXT AS criterio,
      (p.importe_informado*100)::NUMERIC AS informado,
      COALESCE((pp.importes->>p.id::TEXT)::NUMERIC,0) AS imputado,
      NULL::UUID AS deporte_id,NULL::UUID AS recorrido_id,NULL::UUID AS profesor_id,
      NULL::TEXT AS concepto,NULL::TEXT AS profesor,NULL::INTEGER AS nivel_deportivo_id,
      NULL::TEXT AS nivel_deportivo,'[]'::JSONB AS horarios
    FROM public.pagos p CROSS JOIN por_pago pp WHERE p_reporte='ingresos' AND p.estado='APROBADO'
    UNION ALL
    -- RF18/19: relación pago-factura; la clasificación procede del saldo vigente completo.
    SELECT r.pago_id::TEXT||'/'||r.factura_id,r.alumno_id,r.pago_id,r.factura_id,NULL::UUID,
      r.fecha_transferencia,'Transferencia',NULL::NUMERIC,r.importe*100,
      NULL::UUID,NULL::UUID,NULL::UUID,NULL::TEXT,NULL::TEXT,NULL::INTEGER,NULL::TEXT,'[]'::JSONB
    FROM relaciones r JOIN estado ec ON ec.factura_id=r.factura_id
    WHERE (p_reporte='completos' AND ec.saldo_centavos<=0)
       OR (p_reporte='incompletos' AND ec.saldo_centavos>0)
    UNION ALL
    -- Sin NINGÚN pago aprobado histórico, no solo sin pagos dentro del intervalo.
    -- Una factura cero también es completa; no se inventa un pago de importe cero.
    SELECT 'factura/'||ec.factura_id,ec.alumno_id,NULL::UUID,ec.factura_id,NULL::UUID,
      ec.vencimiento,'Vencimiento',NULL::NUMERIC,0::NUMERIC,
      NULL::UUID,NULL::UUID,NULL::UUID,NULL::TEXT,NULL::TEXT,NULL::INTEGER,NULL::TEXT,'[]'::JSONB
    FROM estado ec
    WHERE ((p_reporte='incompletos' AND ec.saldo_centavos>0) OR
      (p_reporte='completos' AND ec.saldo_centavos<=0))
      AND NOT EXISTS (SELECT 1 FROM aprobadas a WHERE a.factura_id=ec.factura_id)
    UNION ALL
    -- RF20/21: una imputación de ítem, referenciada a su inscripción real.
    SELECT a.pago_id::TEXT||'/'||a.item_factura_id,a.alumno_id,a.pago_id,a.factura_id,a.item_factura_id,
      a.fecha_transferencia,'Transferencia',NULL::NUMERIC,a.importe*100,d.deporte_id,s.servicio_id,
      g.profesor_id,COALESCE(dep.nombre,se.nombre)::TEXT,
      CASE WHEN pr.id IS NULL THEN NULL ELSE pr.apellido||', '||pr.nombre END,
      g.nivel_id,n.nombre::TEXT,COALESCE(h.lista,'[]'::JSONB)
    FROM aprobadas a
    LEFT JOIN public.inscripciones_deportivas d ON d.id=a.inscripcion_deportiva_id
    LEFT JOIN public.grupos_deportivos g ON g.id=d.grupo_id
    LEFT JOIN public.deportes dep ON dep.id=d.deporte_id
    LEFT JOIN public.niveles n ON n.id=g.nivel_id
    LEFT JOIN public.perfiles pr ON pr.id=g.profesor_id
    LEFT JOIN horarios h ON h.grupo_id=g.id
    LEFT JOIN public.inscripciones_servicios s ON s.id=a.inscripcion_servicio_id
    LEFT JOIN public.servicios_escolares se ON se.id=s.servicio_id
    WHERE (p_reporte='deportes' AND a.tipo='DEPORTE') OR (p_reporte='recorridos' AND a.tipo='TRANSPORTE')
  ), temporal AS MATERIALIZED (
    SELECT * FROM origen WHERE fecha BETWEEN p_desde AND p_hasta
  ), cursos AS MATERIALIZED (
    SELECT x.alumno_id,x.fecha,app_private.curso_reporte_economico(x.alumno_id,x.fecha) AS curso
    FROM (SELECT DISTINCT alumno_id,fecha FROM temporal) x
  ), filas AS MATERIALIZED (
    SELECT o.*,extract(year FROM o.fecha)::INTEGER AS anio,p.apellido||', '||p.nombre AS alumno,
      p.legajo_nro,c.curso,ec.periodo,ec.total_centavos,ec.saldo_centavos,ec.inconsistente
    FROM temporal o JOIN public.perfiles p ON p.id=o.alumno_id
    JOIN cursos c ON c.alumno_id=o.alumno_id AND c.fecha=o.fecha
    LEFT JOIN estado ec ON ec.factura_id=o.factura_id
    WHERE (NOT p_filtros ? 'anio' OR extract(year FROM o.fecha)::TEXT=p_filtros->>'anio')
      AND (NOT p_filtros ? 'nivel' OR COALESCE(o.nivel_deportivo_id::TEXT,c.curso->>'nivel_id')=p_filtros->>'nivel')
      AND (NOT p_filtros ? 'curso' OR c.curso->>'curso'=p_filtros->>'curso')
      AND (NOT p_filtros ? 'causa' OR c.curso->>'causa'=p_filtros->>'causa')
      AND (NOT p_filtros ? 'deporte' OR o.deporte_id=(p_filtros->>'deporte')::UUID)
      AND (NOT p_filtros ? 'recorrido' OR o.recorrido_id=(p_filtros->>'recorrido')::UUID)
      AND (NOT p_filtros ? 'profesor' OR o.profesor_id=(p_filtros->>'profesor')::UUID)
      AND (NOT p_filtros ? 'horario' OR EXISTS (SELECT 1 FROM jsonb_array_elements(o.horarios) h
        WHERE h->>'id'=p_filtros->>'horario'))
  ), documentos AS MATERIALIZED (
    SELECT f.id,f.fecha,jsonb_build_object('id',f.id,'alumno_id',f.alumno_id,'alumno',f.alumno,
      'legajo',f.legajo_nro,'pago_id',f.pago_id,'factura_id',f.factura_id,'item_id',f.item_id,
      'fecha',f.fecha,'criterio_fecha',f.criterio,'anio',f.anio,'curso',f.curso,
      'informado_centavos',round(f.informado)::TEXT,'imputado_centavos',round(f.imputado)::TEXT,
      'diferencia_centavos',round(f.informado-f.imputado)::TEXT,
      'total_factura_centavos',f.total_centavos::TEXT,'saldo_centavos',f.saldo_centavos::TEXT,
      'periodo',f.periodo,'inconsistente',COALESCE(f.inconsistente,FALSE),
      'concepto',f.concepto,'deporte_id',f.deporte_id,'recorrido_id',f.recorrido_id,
      'profesor',f.profesor,'profesor_id',f.profesor_id,'nivel_deportivo',f.nivel_deportivo,
      'horarios',f.horarios) AS doc FROM filas f
  ), facturas_unicas AS (
    SELECT DISTINCT factura_id,total_centavos,saldo_centavos FROM filas WHERE factura_id IS NOT NULL
  ), grupos AS (
    SELECT anio,curso->>'nivel' AS nivel,curso->>'curso' AS curso,curso->>'causa' AS causa,
      concepto,count(*) AS filas,round(COALESCE(sum(imputado),0))::TEXT AS imputado_centavos
    FROM filas GROUP BY anio,curso->>'nivel',curso->>'curso',curso->>'causa',concepto
  ), resumen AS (
    SELECT count(*) AS total,round(COALESCE(sum(informado),0))::TEXT AS informado_centavos,
      round(COALESCE(sum(imputado),0))::TEXT AS imputado_centavos,
      round(COALESCE(sum(informado-imputado) FILTER (WHERE informado IS NOT NULL),0))::TEXT AS diferencia_centavos
    FROM filas
  )
  SELECT jsonb_build_object('filas',COALESCE((SELECT jsonb_agg(x.doc ORDER BY x.fecha DESC,x.id)
      FROM (SELECT * FROM documentos ORDER BY fecha DESC,id LIMIT p_tamano
        OFFSET (p_pagina::BIGINT-1)*p_tamano) x),'[]'::JSONB),
    'total',r.total,'pagina',p_pagina,'tamano',p_tamano,
    'totales',jsonb_build_object('informado_centavos',CASE WHEN p_reporte='ingresos' THEN r.informado_centavos END,
      'imputado_centavos',r.imputado_centavos,
      'diferencia_centavos',CASE WHEN p_reporte='ingresos' THEN r.diferencia_centavos END,
      'facturas',(SELECT count(*) FROM facturas_unicas),
      'total_facturas_centavos',COALESCE((SELECT sum(total_centavos)::TEXT FROM facturas_unicas),'0'),
      'saldo_facturas_centavos',COALESCE((SELECT sum(saldo_centavos)::TEXT FROM facturas_unicas),'0')),
    'grupos',COALESCE((SELECT jsonb_agg(to_jsonb(g) ORDER BY g.anio,g.nivel,g.curso,g.causa,g.concepto) FROM grupos g),'[]'::JSONB),
    'huella',md5(COALESCE((SELECT string_agg(doc::TEXT,'' ORDER BY fecha DESC,id) FROM documentos),'')),
    'leido_en',statement_timestamp(),'fecha_corte',app_private.fecha_negocio(statement_timestamp()))
  INTO v_resultado FROM resumen r;
  -- Se comunica una versión nueva, no se publica una página mezclada con la anterior.
  IF p_huella IS NOT NULL AND p_huella<>v_resultado->>'huella' THEN
    RETURN jsonb_build_object('actualizado',TRUE,'huella',v_resultado->>'huella');
  END IF;
  RETURN v_resultado;
END $$;

REVOKE ALL ON FUNCTION app_private.curso_reporte_economico(UUID,DATE) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.reporte_economico(TEXT,DATE,DATE,JSONB,INTEGER,INTEGER,TEXT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION app_private.curso_reporte_economico(UUID,DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reporte_economico(TEXT,DATE,DATE,JSONB,INTEGER,INTEGER,TEXT) TO authenticated;
COMMENT ON FUNCTION public.reporte_economico(TEXT,DATE,DATE,JSONB,INTEGER,INTEGER,TEXT) IS
  'EPT-112 RF17-21. Solo DIRECTOR habilitado. Una instantánea por lectura, saldo vigente EPT-107, centavos exactos como texto; huella de contenido entre páginas. Sin escrituras.';
