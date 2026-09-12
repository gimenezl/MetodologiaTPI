import { esperarBloqueo, SesionPsql } from './_sesion-psql.mjs'

// El arnés de dos conexiones reales vive en `_sesion-psql.mjs`, compartido con
// la prueba de concurrencia del legajo académico (EPT-9).

function insercion(tipo, nivelId, sufijo) {
  if (tipo === 'cursos') {
    return `INSERT INTO public.cursos (nivel_id, denominacion, division)
            VALUES (${nivelId}, 'Concurrencia EPT-55 ${sufijo}', 'C')`
  }
  return `INSERT INTO public.actividades (nombre, tipo, cupo_maximo, nivel_id)
          VALUES ('Concurrencia EPT-55 ${sufijo}', 'TALLER', 20, ${nivelId})`
}

function borrado(tipo, sufijo) {
  if (tipo === 'cursos') {
    return `DELETE FROM public.cursos WHERE denominacion = 'Concurrencia EPT-55 ${sufijo}'`
  }
  return `DELETE FROM public.actividades WHERE nombre = 'Concurrencia EPT-55 ${sufijo}'`
}

function conteo(tipo, sufijo) {
  if (tipo === 'cursos') {
    return `SELECT pg_catalog.count(*) FROM public.cursos
            WHERE denominacion = 'Concurrencia EPT-55 ${sufijo}'`
  }
  return `SELECT pg_catalog.count(*) FROM public.actividades
          WHERE nombre = 'Concurrencia EPT-55 ${sufijo}'`
}

async function probarAsignacionPrimero(sesionA, sesionB, pids, nivelId, tipo) {
  const sufijo = `${tipo} asignación primero`
  await sesionA.ejecutar(
    `UPDATE public.niveles SET activo = TRUE WHERE id = ${nivelId};
     ${borrado(tipo, sufijo)};
     BEGIN;
     ${insercion(tipo, nivelId, sufijo)};`,
    `${tipo}_asignacion_preparada`
  )

  const inactivacion = sesionB.ejecutar(
    `UPDATE public.niveles SET activo = FALSE WHERE id = ${nivelId};`,
    `${tipo}_inactivacion_pendiente`
  )
  await esperarBloqueo(sesionA, pids.a, pids.b)
  await sesionA.ejecutar('COMMIT;', `${tipo}_confirmar_asignacion`)
  await inactivacion

  const relaciones = await sesionA.escalar(
    `(${conteo(tipo, sufijo)})`,
    `${tipo}_verificar_historia`
  )
  const activo = await sesionA.escalar(
    `(SELECT activo FROM public.niveles WHERE id = ${nivelId})`,
    `${tipo}_verificar_inactivo`
  )
  if (relaciones !== '1' || activo !== 'false') {
    throw new Error(`${tipo}: la asignación ganadora no quedó como historia inactiva`)
  }
  console.log(`OK CONCURRENCIA ${tipo}: asignación primero conserva historia`)
}

async function probarInactivacionPrimero(sesionA, sesionB, pids, nivelId, tipo) {
  const sufijo = `${tipo} inactivación primero`
  await sesionA.ejecutar(
    `${borrado(tipo, sufijo)};
     UPDATE public.niveles SET activo = TRUE WHERE id = ${nivelId};
     BEGIN;
     UPDATE public.niveles SET activo = FALSE WHERE id = ${nivelId};`,
    `${tipo}_inactivacion_preparada`
  )

  const asignacion = sesionB.ejecutar(
    `DO $prueba$
     BEGIN
       BEGIN
         ${insercion(tipo, nivelId, sufijo)};
         RAISE EXCEPTION 'La asignación concurrente debía rechazarse';
       EXCEPTION WHEN SQLSTATE 'P5504' THEN
         NULL;
       END;
     END
     $prueba$;`,
    `${tipo}_asignacion_pendiente`
  )
  await esperarBloqueo(sesionA, pids.a, pids.b)
  await sesionA.ejecutar('COMMIT;', `${tipo}_confirmar_inactivacion`)
  await asignacion

  const relaciones = await sesionA.escalar(
    `(${conteo(tipo, sufijo)})`,
    `${tipo}_verificar_rechazo`
  )
  if (relaciones !== '0') {
    throw new Error(`${tipo}: se persistió una asignación después de la inactivación`)
  }
  console.log(`OK CONCURRENCIA ${tipo}: inactivación primero rechaza P5504`)
}

const sesionA = new SesionPsql('A', 'EPT55')
const sesionB = new SesionPsql('B', 'EPT55')

try {
  const pidA = Number(await sesionA.escalar('pg_catalog.pg_backend_pid()', 'pid'))
  const pidB = Number(await sesionB.escalar('pg_catalog.pg_backend_pid()', 'pid'))

  await sesionA.ejecutar(
    `DELETE FROM public.cursos WHERE denominacion LIKE 'Concurrencia EPT-55%';
     DELETE FROM public.actividades WHERE nombre LIKE 'Concurrencia EPT-55%';
     DELETE FROM public.niveles WHERE nombre = 'CONCURRENCIA EPT-55';
     INSERT INTO public.niveles (nombre, activo, orden, es_institucional)
     VALUES ('CONCURRENCIA EPT-55', TRUE, 990000, FALSE);`,
    'preparar_fixture'
  )
  const nivelId = Number(
    await sesionA.escalar(
      `(SELECT id FROM public.niveles WHERE nombre = 'CONCURRENCIA EPT-55')`,
      'nivel_id'
    )
  )
  const pids = { a: pidA, b: pidB }

  for (const tipo of ['cursos', 'actividades']) {
    await probarAsignacionPrimero(sesionA, sesionB, pids, nivelId, tipo)
    await probarInactivacionPrimero(sesionA, sesionB, pids, nivelId, tipo)
  }

  await sesionA.ejecutar(
    `DELETE FROM public.cursos WHERE denominacion LIKE 'Concurrencia EPT-55%';
     DELETE FROM public.actividades WHERE nombre LIKE 'Concurrencia EPT-55%';
     DELETE FROM public.niveles WHERE id = ${nivelId};`,
    'limpiar_fixture'
  )
} finally {
  await Promise.allSettled([sesionA.ejecutar('ROLLBACK;', 'rollback'), sesionB.ejecutar('ROLLBACK;', 'rollback')])
  await Promise.allSettled([sesionA.cerrar(), sesionB.cerrar()])
}
