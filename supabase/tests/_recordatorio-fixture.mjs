import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Fixture sintético de EPT-115. Solo opera sobre un stack propio llamado `ept115`
 * (contenedor supabase_db_ept115) y nunca toca datos reales.
 */
export const id = (n) => `b1150000-0000-4000-8000-${String(n).padStart(12, '0')}`
export const hijo1 = id(1) // cuota + dos deportes + transporte + comedor
export const hijo2 = id(2) // solo cuota (nivel B)
export const hijo3 = id(3) // otra familia
export const hijo4 = id(4) // nombre largo con acentos
export const director = id(5)
export const profesor = id(6)
export const contenedor = process.env.EPT_SUPABASE_DB_CONTAINER
export const DOMINIO = 'ept115.test'

export function sql(s) {
  return execFileSync('docker', ['exec', '-i', contenedor, 'psql', '-X', '-q', '-A', '-t',
    '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], { input: s, encoding: 'utf8' }).trim()
}

export function entorno() {
  const workdir = process.env.EPT_SUPABASE_WORKDIR
  if (!workdir || !contenedor) throw new Error('Se exige stack aislado explícito.')
  const config = readFileSync(path.join(workdir, 'supabase/config.toml'), 'utf8')
  const proyecto = /^project_id\s*=\s*"([^"]+)"/mu.exec(config)?.[1]
  // ept115: stack local propio; ept104: el stack desechable del runner de CI (config.toml con ese project_id).
  if (contenedor !== `supabase_db_${proyecto}` || !['ept115', 'ept104'].includes(proyecto)) throw new Error('Solo stack desechable propio (ept115 o ept104 en CI).')
  const local = JSON.parse(execFileSync('npx', ['--yes', 'supabase@2.117.0', 'status', '-o', 'json', '--workdir', workdir],
    { shell: process.platform === 'win32', encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
  if (new URL(local.API_URL).hostname !== '127.0.0.1' || new URL(local.DB_URL).hostname !== '127.0.0.1') {
    throw new Error('Destino no local.')
  }
  const puertos = execFileSync('docker', ['port', contenedor, '5432/tcp'], { encoding: 'utf8' })
  if (!puertos.includes(`:${new URL(local.DB_URL).port}`)) throw new Error('API y contenedor no coinciden.')
  return local
}

const alumnosFixture = `('${hijo1}','${hijo2}','${hijo3}','${hijo4}')`
const perfilesFixture = `('${hijo1}','${hijo2}','${hijo3}','${hijo4}','${director}','${profesor}')`

export const limpieza = `
BEGIN;
DELETE FROM public.envios_correo_facturas WHERE envio_id IN
  (SELECT e.id FROM public.envios_correo e JOIN public.perfiles p ON p.id=e.padre_id WHERE p.dni LIKE '94115%');
DELETE FROM public.envios_correo WHERE padre_id IN (SELECT id FROM public.perfiles WHERE dni LIKE '94115%');
DELETE FROM public.items_factura WHERE alumno_id IN ${alumnosFixture};
DELETE FROM public.facturas WHERE alumno_id IN ${alumnosFixture};
DELETE FROM app_private.facturacion_avisos WHERE alumno_id IN ${alumnosFixture};
DELETE FROM app_private.facturacion_intentos WHERE alumno_id IN ${alumnosFixture};
ALTER TABLE app_private.facturacion_composiciones DISABLE TRIGGER composicion_inmutable;
DELETE FROM app_private.facturacion_composiciones WHERE alumno_id IN ${alumnosFixture};
ALTER TABLE app_private.facturacion_composiciones ENABLE TRIGGER composicion_inmutable;
DELETE FROM public.tarifas WHERE nivel_id IN (SELECT id FROM public.niveles WHERE nombre LIKE 'Nivel EPT115%')
 OR deporte_id IN ('${id(31)}','${id(32)}') OR servicio_id IN ('${id(41)}','${id(42)}');
DELETE FROM public.inscripciones_servicios WHERE alumno_id IN ${alumnosFixture};
DELETE FROM public.inscripciones_deportivas WHERE alumno_id IN ${alumnosFixture};
DELETE FROM public.grupos_deportivos_horarios WHERE grupo_id IN ('${id(51)}','${id(52)}');
DELETE FROM public.grupos_deportivos WHERE id IN ('${id(51)}','${id(52)}');
DELETE FROM public.horarios WHERE id IN ('${id(91)}','${id(92)}');
DELETE FROM public.deportes WHERE id IN ('${id(31)}','${id(32)}');
DELETE FROM public.servicios_escolares WHERE id IN ('${id(41)}','${id(42)}');
DELETE FROM public.padres_hijos WHERE hijo_id IN ${alumnosFixture} OR padre_id IN (SELECT id FROM public.perfiles WHERE dni LIKE '94115%');
DELETE FROM public.matriculas WHERE alumno_id IN ${alumnosFixture};
DELETE FROM public.alumnos WHERE perfil_id IN ${alumnosFixture};
DELETE FROM public.profesores WHERE perfil_id='${profesor}';
DELETE FROM public.perfiles WHERE id IN ${perfilesFixture};
DELETE FROM public.cursos WHERE id IN ('${id(11)}','${id(12)}');
DELETE FROM public.niveles WHERE nombre LIKE 'Nivel EPT115%';
DELETE FROM app_private.recordatorio_reloj;
UPDATE app_private.recordatorio_config SET habilitada=false;
COMMIT;`

export function sembrar() {
  sql(`BEGIN;
    INSERT INTO public.niveles(nombre,activo,orden) VALUES('Nivel EPT115 A',true,9501),('Nivel EPT115 B',true,9502);
    INSERT INTO public.perfiles(id,user_id,rol_id,nombre,apellido,dni,legajo_nro)
    SELECT x.id::UUID,x.id::UUID,r.id,x.nombre,x.apellido,x.dni,x.legajo FROM (VALUES
      ('${hijo1}','ESTUDIANTE','Ana','Pérez','94115001','EPT115-1'),
      ('${hijo2}','ESTUDIANTE','Bruno','Pérez','94115002','EPT115-2'),
      ('${hijo3}','ESTUDIANTE','Carla','Gómez','94115003','EPT115-3'),
      ('${hijo4}','ESTUDIANTE','María de los Ángeles Concepción del Rosario','Fernández de la Peña y Rodríguez Montenegro','94115004','EPT115-4'),
      ('${director}','DIRECTOR','Dir','EPT115','94115005',NULL),
      ('${profesor}','DOCENTE','Prof','EPT115','94115006',NULL))
      x(id,rol,nombre,apellido,dni,legajo) JOIN public.roles r ON r.nombre=x.rol;
    INSERT INTO public.cursos(id,nivel_id,denominacion,division,activo) VALUES
      ('${id(11)}',(SELECT id FROM public.niveles WHERE nombre='Nivel EPT115 A'),'Curso EPT115 A','A',true),
      ('${id(12)}',(SELECT id FROM public.niveles WHERE nombre='Nivel EPT115 B'),'Curso EPT115 B','A',true);
    INSERT INTO public.matriculas(id,alumno_id,curso_id) VALUES
      ('${id(21)}','${hijo1}','${id(11)}'),('${id(22)}','${hijo2}','${id(12)}'),
      ('${id(23)}','${hijo3}','${id(11)}'),('${id(24)}','${hijo4}','${id(11)}');
    UPDATE public.alumnos SET estado='ACTIVO' WHERE perfil_id IN ${alumnosFixture};
    INSERT INTO public.servicios_escolares(id,tipo,codigo,nombre) VALUES
      ('${id(41)}','TRANSPORTE','EPT115-T','Transporte EPT115'),('${id(42)}','COMEDOR','EPT115-C','Comedor EPT115');
    INSERT INTO public.inscripciones_servicios(id,alumno_id,servicio_id) VALUES
      ('${id(61)}','${hijo1}','${id(41)}'),('${id(62)}','${hijo1}','${id(42)}');
    INSERT INTO public.deportes(id,nombre) VALUES('${id(31)}','Deporte EPT115 A'),('${id(32)}','Deporte EPT115 B');
    INSERT INTO public.grupos_deportivos(id,deporte_id,nivel_id,nombre,cupo,profesor_id) VALUES
      ('${id(51)}','${id(31)}',(SELECT id FROM public.niveles WHERE nombre='Nivel EPT115 A'),'Grupo EPT115 A',20,'${profesor}'),
      ('${id(52)}','${id(32)}',(SELECT id FROM public.niveles WHERE nombre='Nivel EPT115 A'),'Grupo EPT115 B',20,'${profesor}');
    INSERT INTO public.horarios(id,dia_semana,hora_inicio,hora_fin) VALUES('${id(91)}',1,'20:01','21:01'),('${id(92)}',2,'20:01','21:01');
    INSERT INTO public.grupos_deportivos_horarios(grupo_id,horario_id)
      SELECT x.grupo::UUID,h.id FROM (VALUES('${id(51)}',1),('${id(52)}',2)) x(grupo,dia)
      JOIN public.horarios h ON h.dia_semana=x.dia AND h.id IN ('${id(91)}','${id(92)}');
    INSERT INTO public.inscripciones_deportivas(id,alumno_id,grupo_id) VALUES
      ('${id(71)}','${hijo1}','${id(51)}'),('${id(72)}','${hijo1}','${id(52)}');
    COMMIT;`)
}

export function tarifas() {
  sql(`INSERT INTO public.tarifas(concepto,nivel_id,deporte_id,servicio_id,importe,desde,hasta) VALUES
    ('CUOTA',(SELECT id FROM public.niveles WHERE nombre='Nivel EPT115 A'),NULL,NULL,100.10,'2020-01-01',NULL),
    ('CUOTA',(SELECT id FROM public.niveles WHERE nombre='Nivel EPT115 B'),NULL,NULL,200.20,'2020-01-01',NULL),
    ('DEPORTE',NULL,'${id(31)}',NULL,0,'2020-01-01',NULL),
    ('DEPORTE',NULL,'${id(32)}',NULL,20.20,'2020-01-01',NULL),
    ('TRANSPORTE',NULL,NULL,'${id(41)}',30.30,'2020-01-01',NULL),
    ('COMEDOR',NULL,NULL,'${id(42)}',40.40,'2020-01-01',NULL);`)
}

/** Captura y emite la factura por el mismo camino de EPT-104. */
export function facturar(alumno, periodo) {
  sql(`SELECT app_private.capturar_facturacion('${alumno}','${periodo}');`)
  return JSON.parse(sql(`SELECT app_private.emitir_facturacion('${alumno}','${periodo}');`))
}

export const vincular = (padre, hijo) =>
  sql(`INSERT INTO public.padres_hijos(padre_id,hijo_id) VALUES('${padre}','${hijo}') ON CONFLICT DO NOTHING;`)
export const desvincular = (padre, hijo) =>
  sql(`DELETE FROM public.padres_hijos WHERE padre_id='${padre}' AND hijo_id='${hijo}';`)
export const perfilDe = (email) =>
  sql(`SELECT p.id FROM public.perfiles p JOIN auth.users u ON u.id=p.user_id WHERE u.email='${email}';`)
export const reloj = (fecha) =>
  sql(`DELETE FROM app_private.recordatorio_reloj; INSERT INTO app_private.recordatorio_reloj(hoy) VALUES('${fecha}');`)
export const compuerta = (v) => sql(`UPDATE app_private.recordatorio_config SET habilitada=${v};`)
export const envio = (padre, fecha) => JSON.parse(sql(`SELECT COALESCE(row_to_json(e),'null'::json) FROM
  (SELECT estado,intentos,ultimo_error,enviado_en IS NOT NULL AS enviado,frontera_smtp_en IS NOT NULL AS frontera,
          reserva_token IS NOT NULL AS reservado,periodo,ultimo_intento_fecha
     FROM public.envios_correo WHERE padre_id='${padre}' AND tipo='RECORDATORIO_MENSUAL' AND fecha_programada='${fecha}') e;`) || 'null')
