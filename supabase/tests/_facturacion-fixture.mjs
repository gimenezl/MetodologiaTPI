import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

export const id = (n) => `b1040000-0000-4000-8000-${String(n).padStart(12, '0')}`
export const alumno = id(1)
export const alumno2 = id(2)
export const director = id(3)
export const profesor = id(4)
export const contenedor = process.env.EPT_SUPABASE_DB_CONTAINER
export function sql(s) {
  return execFileSync('docker', ['exec', '-i', contenedor, 'psql', '-X', '-q', '-A', '-t',
    '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], { input: s, encoding: 'utf8' }).trim()
}
export function entorno() {
  const workdir = process.env.EPT_SUPABASE_WORKDIR
  if (!workdir || !contenedor) throw new Error('Se exige stack aislado explícito.')
  const config = readFileSync(path.join(workdir, 'supabase/config.toml'), 'utf8')
  const proyecto = /^project_id\s*=\s*"([^"]+)"/mu.exec(config)?.[1]
  if (contenedor !== `supabase_db_${proyecto}` || proyecto !== 'ept104') throw new Error('Solo stack ept104 propio.')
  const local = JSON.parse(execFileSync('npx', ['--yes', 'supabase@2.117.0', 'status', '-o', 'json', '--workdir', workdir],
    { shell: process.platform === 'win32', encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
  if (new URL(local.API_URL).hostname !== '127.0.0.1' || new URL(local.DB_URL).hostname !== '127.0.0.1') {
    throw new Error('Destino no local.')
  }
  const puertos = execFileSync('docker', ['port', contenedor, '5432/tcp'], { encoding: 'utf8' })
  if (!puertos.includes(`:${new URL(local.DB_URL).port}`)) throw new Error('API y contenedor no coinciden.')
  return local
}
export const limpieza = `
BEGIN;
DELETE FROM public.items_factura WHERE alumno_id IN ('${alumno}','${alumno2}');
DELETE FROM public.facturas WHERE alumno_id IN ('${alumno}','${alumno2}');
DELETE FROM app_private.facturacion_avisos WHERE alumno_id IN ('${alumno}','${alumno2}');
DELETE FROM app_private.facturacion_intentos WHERE alumno_id IN ('${alumno}','${alumno2}');
ALTER TABLE app_private.facturacion_composiciones DISABLE TRIGGER composicion_inmutable;
DELETE FROM app_private.facturacion_composiciones WHERE alumno_id IN ('${alumno}','${alumno2}');
ALTER TABLE app_private.facturacion_composiciones ENABLE TRIGGER composicion_inmutable;
DELETE FROM public.tarifas WHERE nivel_id IN (SELECT id FROM public.niveles WHERE nombre LIKE 'Nivel EPT104%')
 OR deporte_id IN ('${id(31)}','${id(32)}') OR servicio_id IN ('${id(41)}','${id(42)}');
DELETE FROM public.inscripciones_servicios WHERE alumno_id IN ('${alumno}','${alumno2}');
DELETE FROM public.inscripciones_deportivas WHERE alumno_id IN ('${alumno}','${alumno2}');
DELETE FROM public.grupos_deportivos_horarios WHERE grupo_id IN ('${id(51)}','${id(52)}','${id(53)}');
DELETE FROM public.grupos_deportivos WHERE id IN ('${id(51)}','${id(52)}','${id(53)}');
DELETE FROM public.horarios WHERE id IN ('${id(91)}','${id(92)}');
DELETE FROM public.deportes WHERE id IN ('${id(31)}','${id(32)}');
DELETE FROM public.servicios_escolares WHERE id IN ('${id(41)}','${id(42)}');
DELETE FROM public.matriculas WHERE alumno_id IN ('${alumno}','${alumno2}');
DELETE FROM public.alumnos WHERE perfil_id IN ('${alumno}','${alumno2}');
DELETE FROM public.profesores WHERE perfil_id='${profesor}';
DELETE FROM public.perfiles WHERE id IN ('${alumno}','${alumno2}','${director}','${profesor}');
DELETE FROM public.cursos WHERE id IN ('${id(11)}','${id(12)}');
DELETE FROM public.niveles WHERE nombre LIKE 'Nivel EPT104%';
COMMIT;`

export function sembrar() {
  sql(`BEGIN;
    INSERT INTO public.niveles(nombre,activo,orden) VALUES('Nivel EPT104 A',true,9401),('Nivel EPT104 B',true,9402);
    INSERT INTO public.perfiles(id,user_id,rol_id,nombre,apellido,dni,legajo_nro)
    SELECT x.id::UUID,x.id::UUID,r.id,'Prueba','EPT104',x.dni,x.legajo FROM (VALUES
      ('${alumno}','ESTUDIANTE','94104001','EPT104-1'),('${alumno2}','ESTUDIANTE','94104002','EPT104-2'),
      ('${director}','DIRECTOR','94104003',NULL),('${profesor}','DOCENTE','94104004',NULL))
      x(id,rol,dni,legajo) JOIN public.roles r ON r.nombre=x.rol;
    INSERT INTO public.cursos(id,nivel_id,denominacion,division,activo) VALUES
      ('${id(11)}',(SELECT id FROM public.niveles WHERE nombre='Nivel EPT104 A'),'Curso EPT104 A','A',true),
      ('${id(12)}',(SELECT id FROM public.niveles WHERE nombre='Nivel EPT104 B'),'Curso EPT104 B','A',true);
    INSERT INTO public.matriculas(id,alumno_id,curso_id) VALUES
      ('${id(21)}','${alumno}','${id(11)}'),('${id(22)}','${alumno2}','${id(12)}');
    UPDATE public.alumnos SET estado='ACTIVO' WHERE perfil_id IN ('${alumno}','${alumno2}');
    INSERT INTO public.servicios_escolares(id,tipo,codigo,nombre) VALUES
      ('${id(41)}','TRANSPORTE','EPT104-T','Transporte EPT104'),('${id(42)}','COMEDOR','EPT104-C','Comedor EPT104');
    INSERT INTO public.inscripciones_servicios(id,alumno_id,servicio_id) VALUES
      ('${id(61)}','${alumno}','${id(41)}'),('${id(62)}','${alumno}','${id(42)}');
    INSERT INTO public.deportes(id,nombre) VALUES('${id(31)}','Deporte EPT104 A'),('${id(32)}','Deporte EPT104 B');
    INSERT INTO public.grupos_deportivos(id,deporte_id,nivel_id,nombre,cupo,profesor_id) VALUES
      ('${id(51)}','${id(31)}',(SELECT id FROM public.niveles WHERE nombre='Nivel EPT104 A'),'Grupo EPT104 A',20,'${profesor}'),
      ('${id(52)}','${id(32)}',(SELECT id FROM public.niveles WHERE nombre='Nivel EPT104 A'),'Grupo EPT104 B',20,'${profesor}');
    INSERT INTO public.horarios(id,dia_semana,hora_inicio,hora_fin) VALUES('${id(91)}',1,'20:01','21:01'),('${id(92)}',2,'20:01','21:01');
    INSERT INTO public.grupos_deportivos_horarios(grupo_id,horario_id)
      SELECT x.grupo::UUID,h.id FROM (VALUES('${id(51)}',1),('${id(52)}',2)) x(grupo,dia)
      JOIN public.horarios h ON h.dia_semana=x.dia AND h.id IN ('${id(91)}','${id(92)}');
    INSERT INTO public.inscripciones_deportivas(id,alumno_id,grupo_id) VALUES
      ('${id(71)}','${alumno}','${id(51)}'),('${id(72)}','${alumno}','${id(52)}');
    COMMIT;`)
}
export function tarifas() {
  sql(`INSERT INTO public.tarifas(concepto,nivel_id,deporte_id,servicio_id,importe,desde,hasta) VALUES
    ('CUOTA',(SELECT id FROM public.niveles WHERE nombre='Nivel EPT104 A'),NULL,NULL,100.10,'2050-01-01','2050-12-31'),
    ('CUOTA',(SELECT id FROM public.niveles WHERE nombre='Nivel EPT104 B'),NULL,NULL,200.20,'2050-01-01',NULL),
    ('DEPORTE',NULL,'${id(31)}',NULL,0,'2050-01-01',NULL),
    ('DEPORTE',NULL,'${id(32)}',NULL,20.20,'2050-01-01',NULL),
    ('TRANSPORTE',NULL,NULL,'${id(41)}',30.30,'2050-01-01',NULL),
    ('COMEDOR',NULL,NULL,'${id(42)}',40.40,'2050-01-01',NULL);`)
}
export const capturar = (a, p) => sql(`SELECT app_private.capturar_facturacion('${a}','${p}');`)
export const emitir = (a, p) => JSON.parse(sql(`SELECT app_private.emitir_facturacion('${a}','${p}');`))
export function negativa(sentencia, esperado) {
  const resultado = sql(`DO $$ BEGIN BEGIN ${sentencia}; RAISE EXCEPTION 'NO_RECHAZADA';
    EXCEPTION WHEN OTHERS THEN PERFORM pg_catalog.set_config('ept104.resultado',SQLSTATE,false); END; END $$;
    SELECT pg_catalog.current_setting('ept104.resultado');`)
  if (resultado !== esperado) throw new Error(`Negativa: ${resultado}, esperado ${esperado}`)
}
