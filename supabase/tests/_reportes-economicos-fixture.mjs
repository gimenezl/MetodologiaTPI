// Datos sintéticos exclusivos de EPT-112. Solo base descartable de bucle local.
export const ID = (n) => `b1120000-0000-4000-8000-${String(n).padStart(12, '0')}`
export const roles = {
  director: 'DIRECTOR',
  padre: 'PADRE',
  estudiante: 'ESTUDIANTE',
  docente: 'DOCENTE',
  personal: 'PERSONAL',
  bloqueado: 'DIRECTOR',
  otraFamilia: 'PADRE',
  otroAlumno: 'ESTUDIANTE',
}
export function fixture(a) {
  const nivel = "(SELECT id FROM public.niveles WHERE nombre='PRIMARIO')"
  const deporte = "'e0000000-0000-4000-8000-000000000101'"
  const transporte = "(SELECT id FROM public.servicios_escolares WHERE tipo='TRANSPORTE' ORDER BY codigo LIMIT 1)"
  const comedor = "(SELECT id FROM public.servicios_escolares WHERE codigo='COMEDOR')"
  const items = [
    [1, 1, 'CUOTA', 60],
    [2, 1, 'DEPORTE', 20],
    [3, 1, 'TRANSPORTE', 20],
    [4, 2, 'CUOTA', 100],
    [5, 3, 'CUOTA', 60],
    [6, 3, 'COMEDOR', 40],
    ...Array.from({ length: 7 }, (_, i) => [i + 7, i + 4, 'CUOTA', i === 3 ? 0 : 100]),
  ]
  const pagos = [
    [1, [1, 5], 120, 119, '2030-01-10', 'APROBADO'],
    [2, [2, 3], 40, 40, '2030-02-10', 'APROBADO'],
    [3, [4], 100, 100, '2030-03-10', 'APROBADO'],
    [4, [11], 100, 100, '2030-06-15', 'APROBADO'],
    [5, [12], 100, 100, '2028-12-31', 'APROBADO'],
    [6, [13], 100, 100, '2030-12-31', 'APROBADO'],
    [7, [8], 100, 100, '2030-04-10', 'PENDIENTE_VERIFICACION'],
    [8, [9], 100, 100, '2030-05-10', 'RECHAZADO'],
    [9, [7], 100, 100, '2030-06-01', 'PENDIENTE_VERIFICACION'],
  ]
  return `
    INSERT INTO public.cursos(id,nivel_id,denominacion,division) VALUES
      ('${ID(101)}',${nivel},'EPT112 Primero','A'),('${ID(102)}',${nivel},'EPT112 Segundo','A'),
      ('${ID(103)}',${nivel},'EPT112 Tercero','A'),('${ID(104)}',${nivel},'EPT112 Primero','B');
    INSERT INTO public.matriculas(id,alumno_id,curso_id,fecha_inicio) VALUES
      ('${ID(201)}','${a.estudiante}','${ID(101)}','2029-01-01T03:00:00Z'),
      ('${ID(204)}','${a.otroAlumno}','${ID(104)}','2029-01-01T03:00:00Z');
    UPDATE public.alumnos SET estado='ACTIVO' WHERE perfil_id IN ('${a.estudiante}','${a.otroAlumno}');
    INSERT INTO public.padres_hijos(padre_id,hijo_id) VALUES
      ('${a.padre}','${a.estudiante}'),('${a.otraFamilia}','${a.otroAlumno}');
    INSERT INTO public.grupos_deportivos(id,deporte_id,nivel_id,nombre,cupo,profesor_id)
      VALUES('${ID(301)}',${deporte},${nivel},'EPT112 grupo',20,'${a.docente}');
    INSERT INTO public.horarios(dia_semana,hora_inicio,hora_fin) VALUES(2,'19:00','20:00'),(4,'19:00','20:00') ON CONFLICT DO NOTHING;
    INSERT INTO public.grupos_deportivos_horarios(grupo_id,horario_id)
      SELECT '${ID(301)}',id FROM public.horarios WHERE dia_semana IN (2,4) AND hora_inicio='19:00' AND hora_fin='20:00';
    INSERT INTO public.inscripciones_deportivas(id,alumno_id,grupo_id) VALUES('${ID(401)}','${a.estudiante}','${ID(301)}');
    INSERT INTO public.inscripciones_servicios(id,alumno_id,servicio_id) VALUES
      ('${ID(402)}','${a.estudiante}',${transporte}),('${ID(403)}','${a.estudiante}',${comedor});
    INSERT INTO public.tarifas(id,concepto,nivel_id,deporte_id,servicio_id,importe,desde) VALUES
      ('${ID(501)}','CUOTA',${nivel},NULL,NULL,100,'2029-01-01'),
      ('${ID(502)}','DEPORTE',NULL,${deporte},NULL,20,'2029-01-01'),
      ('${ID(503)}','TRANSPORTE',NULL,NULL,${transporte},20,'2029-01-01'),
      ('${ID(504)}','COMEDOR',NULL,NULL,${comedor},40,'2029-01-01');
    INSERT INTO public.facturas(id,alumno_id,periodo,vencimiento,total) VALUES
      ${Array.from({ length: 10 }, (_, i) => `('${ID(601 + i)}','${a.estudiante}','2030-${String(i + 1).padStart(2, '0')}-01','2030-${String(i + 1).padStart(2, '0')}-10',${i === 6 ? 0 : 100})`).join(',')};
    INSERT INTO public.items_factura(id,factura_id,alumno_id,tipo,tarifa_id,matricula_id,inscripcion_deportiva_id,inscripcion_servicio_id,importe) VALUES
      ${items
        .map(
          ([n, f, tipo, importe]) => `('${ID(700 + n)}','${ID(600 + f)}','${a.estudiante}','${tipo}',
        '${ID({ CUOTA: 501, DEPORTE: 502, TRANSPORTE: 503, COMEDOR: 504 }[tipo])}',
        ${tipo === 'CUOTA' ? `'${ID(201)}'` : 'NULL'},${tipo === 'DEPORTE' ? `'${ID(401)}'` : 'NULL'},
        ${tipo === 'TRANSPORTE' ? `'${ID(402)}'` : tipo === 'COMEDOR' ? `'${ID(403)}'` : 'NULL'},${importe})`
        )
        .join(',')};
    ${pagos
      .map(
        ([n, ids, total, informado, fecha, estado]) => `
      INSERT INTO public.pagos(id,padre_id,alumno_id,total_calculado,importe_informado,fecha_transferencia,numero_operacion,estado,verificado_por,verificado_en,motivo_rechazo)
      VALUES('${ID(800 + n)}','${a.padre}','${a.estudiante}',${total},${informado},'${fecha}','EPT112-${n}','${estado}',
        ${estado === 'PENDIENTE_VERIFICACION' ? 'NULL,NULL,NULL' : `'${a.director}',now(),${estado === 'RECHAZADO' ? "'Motivo sintético'" : 'NULL'}`});
      INSERT INTO public.imputaciones_pago(pago_id,item_factura_id,alumno_id,importe,activa)
        SELECT '${ID(800 + n)}',id,alumno_id,importe,${estado !== 'RECHAZADO'} FROM public.items_factura
        WHERE id IN (${ids.map((x) => `'${ID(700 + x)}'`).join(',')});
      UPDATE public.items_factura SET estado_pago='${estado === 'APROBADO' ? 'PAGADO' : estado === 'RECHAZADO' ? 'PENDIENTE' : 'EN_VERIFICACION'}'
        WHERE id IN (${ids.map((x) => `'${ID(700 + x)}'`).join(',')});`
      )
      .join('\n')}
    INSERT INTO public.comprobantes_pago(id,pago_id,subido_por,ruta_archivo,tipo_mime,tamano_bytes)
      SELECT '${ID(900)}','${ID(807)}','${a.padre}','${ID(807)}/${ID(900)}.png','image/png',100;
    INSERT INTO public.comprobantes_pago(id,pago_id,subido_por,ruta_archivo,tipo_mime,tamano_bytes) VALUES
      ('${ID(901)}','${ID(801)}','${a.padre}','${ID(801)}/${ID(901)}.png','image/png',100),
      ('${ID(902)}','${ID(801)}','${a.padre}','${ID(801)}/${ID(902)}.png','image/png',100),
      ('${ID(903)}','${ID(809)}','${a.padre}','${ID(809)}/${ID(903)}.png','image/png',100);
    UPDATE public.inscripciones_servicios SET estado='CANCELADA' WHERE id='${ID(402)}';
    INSERT INTO public.inscripciones_servicios(id,alumno_id,servicio_id)
      SELECT '${ID(404)}','${a.estudiante}',id FROM public.servicios_escolares
      WHERE tipo='TRANSPORTE' ORDER BY codigo OFFSET 1 LIMIT 1;
    UPDATE public.inscripciones_deportivas SET estado='CANCELADA' WHERE id='${ID(401)}';
    UPDATE public.matriculas SET fecha_cierre='2030-06-15T15:00:00Z',motivo_cierre='CAMBIO_DE_CURSO' WHERE id='${ID(201)}';
    INSERT INTO public.matriculas(id,alumno_id,curso_id,fecha_inicio,fecha_cierre,motivo_cierre)
      VALUES('${ID(202)}','${a.estudiante}','${ID(102)}','2030-06-15T15:00:00Z','2030-12-31T03:00:00Z','CAMBIO_DE_CURSO');
    INSERT INTO public.matriculas(id,alumno_id,curso_id,fecha_inicio)
      VALUES('${ID(203)}','${a.estudiante}','${ID(103)}','2030-12-31T03:00:00Z');
  `
}
export function limpiarEconomia() {
  const propio = "id::TEXT LIKE 'b1120000-%'"
  return `
    DELETE FROM public.comprobantes_pago WHERE ${propio};
    DELETE FROM public.imputaciones_pago WHERE pago_id::TEXT LIKE 'b1120000-%';
    DELETE FROM public.recibos WHERE pago_id::TEXT LIKE 'b1120000-%';
    DELETE FROM public.pagos WHERE ${propio}; DELETE FROM public.items_factura WHERE ${propio};
    DELETE FROM public.facturas WHERE ${propio};
    DELETE FROM public.inscripciones_deportivas WHERE ${propio};
    DELETE FROM public.inscripciones_servicios WHERE ${propio};
    DELETE FROM public.grupos_deportivos_horarios WHERE grupo_id='${ID(301)}';
    DELETE FROM public.grupos_deportivos WHERE ${propio}; DELETE FROM public.tarifas WHERE ${propio};
  `
}
