/**
 * EPT-58 — Prueba local de la compensación no destructiva R-A.
 *
 * Aplica `docs/evidence/EPT-58/reversion/R-A_compensacion_no_destructiva.sql`
 * sobre fichas e historial reales y comprueba que:
 *
 *   * ninguna ficha ni fila de historial cambia (condición aprobada del
 *     contrato: ninguna reversión borra datos creados después de A);
 *   * el comportamiento de A se retira: vuelve la regla previa de
 *     asignaciones y un DOCENTE nuevo ya no recibe ficha;
 *   * la FK RESTRICT y la guarda de solo agregado del historial siguen;
 *   * la superficie pública queda sin EXECUTE;
 *   * R-A se niega a correr mientras B siga aplicada.
 *
 * Todo ocurre en transacciones con ROLLBACK: la base local no cambia.
 *
 *     node supabase/tests/profesores_reversion_a.mjs
 */

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CONTENEDOR =
  process.env.EPT_SUPABASE_DB_CONTAINER ?? 'supabase_db_educar-para-transformar'
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const R_A = readFileSync(
  path.join(RAIZ, 'docs', 'evidence', 'EPT-58', 'reversion', 'R-A_compensacion_no_destructiva.sql'),
  'utf8'
)

function psql(sql) {
  return spawnSync(
    'docker',
    ['exec', '-i', CONTENEDOR, 'psql', '-X', '-q', '-U', 'postgres', '-d', 'postgres',
     '-v', 'ON_ERROR_STOP=1'],
    { input: sql, encoding: 'utf8' }
  )
}

const DIRECTOR = 'f5830000-0000-4000-8000-000000000001'
const ACTIVO = 'f5830000-0000-4000-8000-000000000002'
const INACTIVO = 'f5830000-0000-4000-8000-000000000003'
const NUEVO = 'f5830000-0000-4000-8000-000000000004'
const CURSO = 'f5830000-0000-4000-8000-0000000000c1'

const FIXTURE = `
INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni, legajo_nro)
SELECT v.id::uuid, v.id::uuid, r.id, 'Prueba', v.apellido, v.dni, v.legajo
FROM (VALUES
  ('${DIRECTOR}', 'DIRECTOR', 'Dirección R-A', '95830001', NULL),
  ('${ACTIVO}',   'DOCENTE',  'Activo R-A',    '95830002', 'LEG-EPT58-RA-1'),
  ('${INACTIVO}', 'DOCENTE',  'Inactivo R-A',  '95830003', 'LEG-EPT58-RA-2')
) AS v(id, rol, apellido, dni, legajo)
JOIN public.roles r ON r.nombre = v.rol;
INSERT INTO public.cursos (id, nivel_id, denominacion, division, activo)
VALUES ('${CURSO}', (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'), 'Curso R-A EPT58', 'A', TRUE);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"${DIRECTOR}"}', true);
SELECT public.actualizar_ficha_profesor('${ACTIVO}', 'LEG-EPT58-RA-1', 'Lengua');
SELECT public.actualizar_ficha_profesor('${INACTIVO}', 'LEG-EPT58-RA-2', 'Música');
SELECT public.cambiar_estado_profesor('${INACTIVO}', 'INACTIVO', 'Licencia');
SELECT public.cambiar_estado_profesor('${INACTIVO}', 'ACTIVO', 'Regreso');
SELECT public.cambiar_estado_profesor('${INACTIVO}', 'INACTIVO', 'Nueva licencia');
SELECT public.crear_materia('Materia R-A EPT58');
RESET ROLE;
CREATE TEMPORARY TABLE ept58_ra_antes ON COMMIT DROP AS
  SELECT (SELECT pg_catalog.count(*) FROM public.profesores) AS fichas,
         (SELECT pg_catalog.count(*) FROM public.profesores_estados_historial) AS historial,
         (SELECT pg_catalog.md5(pg_catalog.string_agg(pg_catalog.concat_ws('|', perfil_id, especialidad, estado,
                  fecha_alta, fecha_actualizacion), ';' ORDER BY perfil_id)) FROM public.profesores) AS huella_fichas,
         (SELECT pg_catalog.md5(pg_catalog.string_agg(pg_catalog.concat_ws('|', id, profesor_id, estado_anterior,
                  estado_nuevo, motivo, actor_id, fecha), ';' ORDER BY id)) FROM public.profesores_estados_historial) AS huella_historial;
`

const VERIFICACION = `
DO $$
DECLARE
  v_antes RECORD;
  v_codigo TEXT;
BEGIN
  SELECT * INTO v_antes FROM ept58_ra_antes;

  IF (SELECT pg_catalog.count(*) FROM public.profesores) <> v_antes.fichas
     OR (SELECT pg_catalog.count(*) FROM public.profesores_estados_historial) <> v_antes.historial
     OR (SELECT pg_catalog.md5(pg_catalog.string_agg(pg_catalog.concat_ws('|', perfil_id, especialidad, estado,
          fecha_alta, fecha_actualizacion), ';' ORDER BY perfil_id)) FROM public.profesores) <> v_antes.huella_fichas
     OR (SELECT pg_catalog.md5(pg_catalog.string_agg(pg_catalog.concat_ws('|', id, profesor_id, estado_anterior,
          estado_nuevo, motivo, actor_id, fecha), ';' ORDER BY id)) FROM public.profesores_estados_historial) <> v_antes.huella_historial
  THEN
    RAISE EXCEPTION 'FALLO R-A: cambiaron fichas o historial.';
  END IF;
  IF v_antes.historial < 3 THEN
    RAISE EXCEPTION 'FALLO R-A: el fixture no generó historial que conservar.';
  END IF;
  RAISE NOTICE 'OK R-A 1: % ficha(s) y % fila(s) de historial idénticas después de la compensación', v_antes.fichas, v_antes.historial;

  -- Vuelve la regla previa a A: 012 acepta un DOCENTE aunque su ficha diga INACTIVO.
  PERFORM set_config('request.jwt.claims', '{"sub":"${DIRECTOR}"}', true);
  SET LOCAL ROLE authenticated;
  PERFORM public.asignar_materia_curso((SELECT id FROM public.materias WHERE nombre = 'Materia R-A EPT58'),
                                       '${CURSO}', '${INACTIVO}');
  BEGIN
    PERFORM * FROM public.listar_profesores();
    v_codigo := 'OK';
  EXCEPTION WHEN OTHERS THEN
    v_codigo := SQLSTATE;
  END;
  RESET ROLE;
  IF v_codigo <> '42501' THEN
    RAISE EXCEPTION 'FALLO R-A: la superficie pública sigue ejecutable (%).', v_codigo;
  END IF;
  RAISE NOTICE 'OK R-A 2: la guarda de A se retiró (regla previa) y la superficie pública quedó sin EXECUTE';

  -- Un DOCENTE nuevo ya no recibe ficha.
  INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni)
  SELECT '${NUEVO}', NULL, r.id, 'Prueba', 'Nuevo R-A', '95830004' FROM public.roles r WHERE r.nombre = 'DOCENTE';
  IF EXISTS (SELECT 1 FROM public.profesores WHERE perfil_id = '${NUEVO}') THEN
    RAISE EXCEPTION 'FALLO R-A: el alta automática de fichas sigue activa.';
  END IF;
  RAISE NOTICE 'OK R-A 3: el alta automática de fichas se retiró';

  -- Las protecciones de los datos conservados siguen vigentes.
  BEGIN
    DELETE FROM public.profesores_estados_historial WHERE profesor_id = '${INACTIVO}';
    v_codigo := 'OK';
  EXCEPTION WHEN OTHERS THEN
    v_codigo := SQLSTATE;
  END;
  IF v_codigo <> 'P5609' THEN
    RAISE EXCEPTION 'FALLO R-A: el historial dejó de ser de solo agregado (%).', v_codigo;
  END IF;
  BEGIN
    DELETE FROM public.perfiles WHERE id = '${ACTIVO}';
    v_codigo := 'OK';
  EXCEPTION WHEN OTHERS THEN
    v_codigo := SQLSTATE;
  END;
  IF v_codigo <> '23503' THEN
    RAISE EXCEPTION 'FALLO R-A: una ficha dejó de proteger su perfil (%).', v_codigo;
  END IF;
  RAISE NOTICE 'OK R-A 4: historial de solo agregado y FK RESTRICT conservados';
END $$;
`

let fallos = 0

// 1. Compensación sobre datos reales, en una transacción que se revierte.
const corrida = psql(`\\set ON_ERROR_STOP on\nBEGIN;\n${FIXTURE}\n${R_A}\n${VERIFICACION}\nROLLBACK;\n`)
const avisos = `${corrida.stdout}\n${corrida.stderr}`
for (const linea of avisos.split(/\r?\n/u)) {
  const aviso = /NOTICE: {2}((?:OK|R-A).*)$/u.exec(linea)
  if (aviso) console.log(aviso[1].startsWith('OK') ? aviso[1] : `OK  ${aviso[1]}`)
}
if (corrida.status !== 0) {
  fallos += 1
  console.error(`FALLO  la compensación terminó con código ${corrida.status}:\n${corrida.stderr}`)
}

// 2. Con B aplicada (simulada quitando la política amplia), R-A se niega.
const conB = psql(`\\set ON_ERROR_STOP on\nBEGIN;\nDROP POLICY "Directores y docentes ven todos los perfiles" ON public.perfiles;\n${R_A}\nROLLBACK;\n`)
if (conB.status !== 0 && /R-A: la migración B sigue aplicada/u.test(conB.stderr)) {
  console.log('OK  con B aplicada, R-A se niega a correr y no cambia nada')
} else {
  fallos += 1
  console.error(`FALLO  R-A no respetó la precondición de B (código ${conB.status}).`)
}

// 3. La base local quedó como estaba.
const residuos = psql(`SELECT pg_catalog.count(*) FROM public.perfiles WHERE id::TEXT LIKE 'f5830000-%';
SELECT pg_catalog.count(*) FROM pg_catalog.pg_trigger WHERE tgname IN ('a_exigir_profesor_activo', 'registrar_profesor_al_crear_perfil');`)
const [perfiles, triggers] = residuos.stdout.split(/\r?\n/u).map((l) => l.trim()).filter((l) => /^\d+$/u.test(l))
if (perfiles === '0' && triggers === '3') {
  console.log('OK  sin residuos: la base local conserva A completa (3 triggers) y ningún perfil del fixture')
} else {
  fallos += 1
  console.error(`FALLO  residuos después del ROLLBACK: perfiles=${perfiles}, triggers=${triggers}`)
}

if (fallos > 0) {
  console.error(`\n${fallos} afirmación(es) incumplida(s).`)
  process.exit(1)
}
console.log('\nTodas las afirmaciones se cumplieron.')
