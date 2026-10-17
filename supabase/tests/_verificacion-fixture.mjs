// Solo datos sintéticos para la base local descartable; nunca una conexión remota.
export const ID = n => `b1110000-0000-4000-8000-${String(n).padStart(12, '0')}`
export const roles = { director: 'DIRECTOR', segundo: 'DIRECTOR', padre: 'PADRE', alumno: 'ESTUDIANTE',
  copadre: 'PADRE', ajeno: 'ESTUDIANTE', otraFamilia: 'PADRE', docente: 'DOCENTE', personal: 'PERSONAL', bloqueado: 'DIRECTOR' }
export const actoresFijos = Object.fromEntries(Object.keys(roles).map((k, i) => [k, ID(i + 1)]))
export const PAGO = ID(61)
export const ITEMS = [ID(8011), ID(8021)]
export const CARGA = ID(71)
export const COMPROBANTE = ID(72)
export const SHA = 'a'.repeat(64)

export function perfilesFixture() {
  return `INSERT INTO public.perfiles(id,user_id,rol_id,nombre,apellido,dni,legajo_nro)
    VALUES ${Object.entries(roles).map(([k, rol], i) => `('${actoresFijos[k]}','${actoresFijos[k]}',
      (SELECT id FROM public.roles WHERE nombre='${rol}'),'Prueba','EPT111 ${k}','98111${String(i + 1).padStart(3, '0')}',
      ${['ESTUDIANTE', 'DOCENTE'].includes(rol) ? `'EPT111-${k}'` : 'NULL'})`).join(',')};`
}

export function economiaFixture(a = actoresFijos) {
  return `
    INSERT INTO public.cursos(id,nivel_id,denominacion,division,activo)
    VALUES('${ID(101)}',(SELECT id FROM public.niveles WHERE nombre='PRIMARIO'),'Curso EPT111','A',TRUE);
    INSERT INTO public.matriculas(id,alumno_id,curso_id) VALUES
      ('${ID(701)}','${a.alumno}','${ID(101)}'),('${ID(702)}','${a.ajeno}','${ID(101)}');
    UPDATE public.alumnos SET estado='ACTIVO' WHERE perfil_id IN ('${a.alumno}','${a.ajeno}');
    INSERT INTO public.padres_hijos(padre_id,hijo_id) VALUES
      ('${a.padre}','${a.alumno}'),('${a.copadre}','${a.alumno}'),('${a.otraFamilia}','${a.ajeno}');
    INSERT INTO public.tarifas(id,concepto,nivel_id,importe,desde)
    VALUES('${ID(401)}','CUOTA',(SELECT id FROM public.niveles WHERE nombre='PRIMARIO'),500,'2026-01-01');
    INSERT INTO public.tarifas(id,concepto,deporte_id,importe,desde)
    VALUES('${ID(402)}','DEPORTE','e0000000-0000-4000-8000-000000000101',300,'2026-01-01');
    INSERT INTO public.grupos_deportivos(id,deporte_id,nivel_id,nombre,cupo,profesor_id)
    VALUES('${ID(201)}','e0000000-0000-4000-8000-000000000101',
      (SELECT id FROM public.niveles WHERE nombre='PRIMARIO'),'Grupo EPT111',20,'${a.docente}');
    INSERT INTO public.horarios(dia_semana,hora_inicio,hora_fin) VALUES(1,'17:00','18:00') ON CONFLICT DO NOTHING;
    INSERT INTO public.grupos_deportivos_horarios(grupo_id,horario_id)
      SELECT '${ID(201)}',id FROM public.horarios WHERE dia_semana=1 AND hora_inicio='17:00' AND hora_fin='18:00';
    INSERT INTO public.inscripciones_deportivas(id,alumno_id,grupo_id)
    VALUES('${ID(501)}','${a.alumno}','${ID(201)}');
    INSERT INTO public.facturas(id,alumno_id,periodo,vencimiento,total) VALUES
      ('${ID(801)}','${a.alumno}','2027-01-01','2027-01-10',800),
      ('${ID(802)}','${a.alumno}','2027-02-01','2027-02-10',500),
      ('${ID(803)}','${a.ajeno}','2027-01-01','2027-01-10',500);
    INSERT INTO public.items_factura(id,factura_id,alumno_id,tipo,tarifa_id,matricula_id,inscripcion_deportiva_id,importe) VALUES
      ('${ITEMS[0]}','${ID(801)}','${a.alumno}','CUOTA','${ID(401)}','${ID(701)}',NULL,500),
      ('${ID(8012)}','${ID(801)}','${a.alumno}','DEPORTE','${ID(402)}',NULL,'${ID(501)}',300),
      ('${ITEMS[1]}','${ID(802)}','${a.alumno}','CUOTA','${ID(401)}','${ID(701)}',NULL,500),
      ('${ID(8031)}','${ID(803)}','${a.ajeno}','CUOTA','${ID(401)}','${ID(702)}',NULL,500);
  `
}

export function pagoFixture(a = actoresFijos) {
  return `INSERT INTO public.pagos(id,padre_id,alumno_id,total_calculado,importe_informado,fecha_transferencia,numero_operacion)
    VALUES('${PAGO}','${a.padre}','${a.alumno}',1000,990,'2026-10-17','OP-EPT111');
    INSERT INTO public.imputaciones_pago(pago_id,item_factura_id,alumno_id,importe)
      SELECT '${PAGO}',id,alumno_id,importe FROM public.items_factura WHERE id IN('${ITEMS.join("','")}');
    UPDATE public.items_factura SET estado_pago='EN_VERIFICACION' WHERE id IN('${ITEMS.join("','")}');
    INSERT INTO public.comprobantes_pago(id,pago_id,subido_por,ruta_archivo,tipo_mime,tamano_bytes)
    VALUES('${COMPROBANTE}','${PAGO}','${a.padre}','${PAGO}/${COMPROBANTE}.png','image/png',1234);`
}

export const cargaFixture = (a = actoresFijos) => `INSERT INTO public.cargas_comprobante
  (id,padre_id,pago_id,clave_carga,fecha_transferencia,importe_informado,numero_operacion,tipo_mime_declarado,tamano_declarado,huella_solicitud,ruta_temporal)
  VALUES('${CARGA}','${a.padre}','${PAGO}','${CARGA}','2026-10-17',990,'OP-EPT111','image/png',1234,'${SHA}','${PAGO}/${CARGA}');`

export function limpiarEconomia(a = actoresFijos) {
  return `DELETE FROM public.comprobantes_pago WHERE pago_id IN(SELECT id FROM public.pagos WHERE alumno_id IN('${a.alumno}','${a.ajeno}'));
    DELETE FROM public.cargas_comprobante WHERE pago_id IN(SELECT id FROM public.pagos WHERE alumno_id IN('${a.alumno}','${a.ajeno}'));
    DELETE FROM public.imputaciones_pago WHERE alumno_id IN('${a.alumno}','${a.ajeno}');
    DELETE FROM public.pagos WHERE alumno_id IN('${a.alumno}','${a.ajeno}');
    DELETE FROM public.items_factura WHERE alumno_id IN('${a.alumno}','${a.ajeno}');
    DELETE FROM public.facturas WHERE alumno_id IN('${a.alumno}','${a.ajeno}');
    DELETE FROM public.inscripciones_deportivas WHERE id='${ID(501)}';
    DELETE FROM public.grupos_deportivos_horarios WHERE grupo_id='${ID(201)}';
    DELETE FROM public.grupos_deportivos WHERE id='${ID(201)}';
    DELETE FROM public.tarifas WHERE id IN('${ID(401)}','${ID(402)}');
    DELETE FROM public.matriculas WHERE curso_id='${ID(101)}';
    UPDATE public.alumnos SET estado='INACTIVO' WHERE perfil_id IN('${a.alumno}','${a.ajeno}');
    DELETE FROM public.padres_hijos WHERE hijo_id IN('${a.alumno}','${a.ajeno}');
    DELETE FROM public.cursos WHERE id='${ID(101)}';`
}
