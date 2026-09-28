import { esperarBloqueo, SesionPsql } from './_sesion-psql.mjs'

/**
 * Concurrencia real de la administración de inscripciones (EPT-62, RF16).
 *
 * Usa DOS conexiones PostgreSQL independientes: cada `SesionPsql` es un
 * proceso `psql` propio, así que compiten de verdad por los bloqueos de fila.
 * La coordinación es determinista (`pg_blocking_pids`), nunca por tiempo: la
 * sesión A abre su transacción y ejecuta su operación; la sesión B lanza la
 * suya y se comprueba que quedó bloqueada por A antes de que A confirme.
 *
 * Orden de bloqueos que ejercen las operaciones (migración EPT-62, 013, 014, 015):
 *
 *   confirmar_*                    fila de la inscripción o matrícula (FOR UPDATE)
 *                                  → INSERT de la confirmación (índice único).
 *   cancelar_*_administrativa      fila de la inscripción (FOR UPDATE)
 *     · servicios                  → UPDATE (el trigger de 013 no bloquea nada más)
 *     · deportes                   → UPDATE → alumno → grupo (trigger de 015)
 *   cancelar_inscripcion_servicio  UPDATE de la fila (bloqueo de fila)
 *   cancelar_inscripcion_deportiva UPDATE de la fila → alumno → grupo
 *   inscribir_en_grupo_deportivo   alumno → grupos (el pedido y los activos, por id)
 *   establecer_recorrido_transporte alumno → servicio (SHARE) → fila activa (FOR UPDATE)
 *   inactivar_alumno / cambiar_curso_alumno   alumno → fila de la matrícula vigente
 *
 * No hay ciclos: toda operación toma primero la fila de la inscripción o el
 * alumno y solo después el grupo. Las carreras de abajo lo demuestran: ninguna
 * termina en 40P01 y todas dejan un desenlace determinista.
 *
 * Demuestra que, en TODOS los órdenes, no queda estado parcial (conteos
 * exactos de confirmaciones, estado, fecha_cancelacion y activas):
 *   1. Confirmar frente a cancelar administrativamente la misma inscripción
 *      (deporte, comedor y transporte), en ambos órdenes.
 *   2. Confirmar frente al cierre de matrícula (inactivar_alumno y
 *      cambiar_curso_alumno), en ambos órdenes.
 *   3. Doble confirmación simultánea (matrícula, deporte, comedor, transporte),
 *      con dos directoras distintas o la misma: dos éxitos y UNA fila de auditoría.
 *   4. Doble cancelación administrativa simultánea: un éxito y P6203, con una
 *      sola fecha_cancelacion.
 *   5. Cancelación administrativa frente a un alta nueva o a otra baja:
 *      (a) deporte: reinscripción y cupo; (b) transporte: cambio de recorrido;
 *      (c) cancelación propia del alumno de la misma inscripción.
 *   6. Confirmar frente a la cancelación propia del alumno, en ambos órdenes.
 *
 * Corre contra la base local descartable. Crea sus propios datos sintéticos y
 * los borra al final como propietario, en UNA transacción (la invariante
 * académica de 008 usa triggers diferidos que miran los dos lados). La tabla de
 * confirmaciones es append-only por trigger: la limpieza lo desactiva solo
 * dentro de esa transacción y solo para las filas del fixture. Los conteos se
 * hacen como propietario: con la identidad de un alumno, RLS ocultaría filas
 * ajenas y el conteo mentiría a favor de la prueba.
 */

const ID = {
  dir1: 'ea62c000-0000-4000-8000-000000000001',
  dir2: 'ea62c000-0000-4000-8000-000000000002',
  docente: 'ea62c000-0000-4000-8000-000000000003',
  s1: 'ea62c000-0000-4000-8000-000000000011',
  s2: 'ea62c000-0000-4000-8000-000000000012',
  s3: 'ea62c000-0000-4000-8000-000000000013',
  s4: 'ea62c000-0000-4000-8000-000000000014',
  s5: 'ea62c000-0000-4000-8000-000000000015',
  s6: 'ea62c000-0000-4000-8000-000000000016',
  s7: 'ea62c000-0000-4000-8000-000000000017',
  s8: 'ea62c000-0000-4000-8000-000000000018',
  s9: 'ea62c000-0000-4000-8000-000000000019',
  s10: 'ea62c000-0000-4000-8000-00000000001a',
  s11: 'ea62c000-0000-4000-8000-00000000001b',
  curso1: 'ea62c000-0000-4000-8000-0000000000c1',
  curso2: 'ea62c000-0000-4000-8000-0000000000c2',
}
const ALUMNOS = [
  ID.s1, ID.s2, ID.s3, ID.s4, ID.s5, ID.s6, ID.s7, ID.s8, ID.s9, ID.s10, ID.s11,
]
const PERFILES = [ID.dir1, ID.dir2, ID.docente, ...ALUMNOS]

const COMEDOR = 'e0000000-0000-4000-8000-000000000010'
const TR_NORTE = 'e0000000-0000-4000-8000-000000000020'
const TR_SUR = 'e0000000-0000-4000-8000-000000000021'
const FUTBOL = 'e0000000-0000-4000-8000-000000000101'
const NATACION = 'e0000000-0000-4000-8000-000000000102'
const VOLEY = 'e0000000-0000-4000-8000-000000000105'
const GRUPO_PREFIJO = 'Concurrencia EPT-62'
/** El minuto 26 hace inconfundibles las franjas de esta prueba. */
const FRANJA = { inicio: '18:26', fin: '19:26' }
const TRIGGER_REGISTRO = 'proteger_confirmacion_inscripcion_antes_de_escribir'

const lista = (ids) => ids.map((id) => `'${id}'`).join(', ')

function como(sub) {
  return `SET ROLE authenticated;
          SELECT set_config('request.jwt.claims', '{"sub":"${sub}"}', false);`
}

/**
 * Ejecuta una expresión escalar y guarda su desenlace en variables de sesión:
 * `ept62.res` ('OK' o el SQLSTATE del rechazo) y `ept62.val` (el valor devuelto).
 * Los avisos de `psql` van a la salida de error; una variable de sesión es
 * legible desde el flujo que lee el arnés. Con `BEGIN` previo el rechazo no
 * aborta la transacción: queda dentro de un subbloque.
 */
function tolerante(expresion) {
  return `DO $prueba$
          BEGIN
            PERFORM pg_catalog.set_config('ept62.res', '', false);
            PERFORM pg_catalog.set_config('ept62.val', '', false);
            BEGIN
              PERFORM pg_catalog.set_config('ept62.val',
                COALESCE((${expresion})::text, '<NULL>'), false);
              PERFORM pg_catalog.set_config('ept62.res', 'OK', false);
            EXCEPTION WHEN OTHERS THEN
              PERFORM pg_catalog.set_config('ept62.res', SQLSTATE, false);
            END;
          END
          $prueba$;`
}

async function desenlace(sesion, etiqueta) {
  const res = await sesion.escalar(`pg_catalog.current_setting('ept62.res', true)`, `${etiqueta}_res`)
  const val = await sesion.escalar(`pg_catalog.current_setting('ept62.val', true)`, `${etiqueta}_val`)
  return { res, val }
}

function afirmar(condicion, mensaje) {
  if (!condicion) throw new Error(mensaje)
}

let numero = 0
function ok(mensaje) {
  numero += 1
  console.log(`OK CONCURRENCIA ${numero}: ${mensaje}`)
}

const sesionA = new SesionPsql('A', 'EPT62')
const sesionB = new SesionPsql('B', 'EPT62')
let pids

/** Consulta como propietario. */
async function consultar(sesion, expresion, etiqueta) {
  await sesion.ejecutar('RESET ROLE;', `${etiqueta}_propietario`)
  return sesion.escalar(expresion, etiqueta)
}

/**
 * Patrón común: A abre transacción y ejecuta; B ejecuta su operación tolerante
 * y queda bloqueada; se verifica el bloqueo (B espera a A); A confirma; B
 * termina. Devuelve el desenlace de A y de B.
 */
async function carrera({ actorA, exprA, actorB, exprB, etiqueta, antesDeA = '' }) {
  await sesionA.ejecutar(
    `${como(actorA)} BEGIN; ${antesDeA} ${tolerante(exprA)}`,
    `${etiqueta}_a`
  )
  const pendiente = sesionB.ejecutar(`${como(actorB)} ${tolerante(exprB)}`, `${etiqueta}_b`)
  await esperarBloqueo(sesionA, pids.a, pids.b)
  const resA = await desenlace(sesionA, `${etiqueta}_a`)
  await sesionA.ejecutar('COMMIT;', `${etiqueta}_commit`)
  await pendiente
  const resB = await desenlace(sesionB, `${etiqueta}_b`)
  return { a: resA, b: resB }
}

// ---------------------------------------------------------------------------
// Operaciones por dominio (las tres inscripciones; la matrícula va aparte).
// ---------------------------------------------------------------------------
const DOM = {
  DEPORTE: {
    tabla: 'inscripciones_deportivas',
    columnaConf: 'inscripcion_deportiva_id',
    alta: (grupo) => `(public.inscribir_en_grupo_deportivo('${grupo}')).id`,
    confirmar: (id) => `public.confirmar_inscripcion_deportiva('${id}')`,
    cancelarAdm: (id) => `(public.cancelar_inscripcion_deportiva_administrativa('${id}')).id`,
    cancelarPropia: (id) => `(public.cancelar_inscripcion_deportiva('${id}')).id`,
    errorPropiaTrasBaja: 'P5579',
  },
  COMEDOR: {
    tabla: 'inscripciones_servicios',
    columnaConf: 'inscripcion_servicio_id',
    alta: () => `(public.inscribir_en_servicio('${COMEDOR}')).id`,
    confirmar: (id) => `public.confirmar_inscripcion_servicio('${id}', 'COMEDOR')`,
    cancelarAdm: (id) => `(public.cancelar_inscripcion_servicio_administrativa('${id}', 'COMEDOR')).id`,
    cancelarPropia: (id) => `(public.cancelar_inscripcion_servicio('${id}')).id`,
    errorPropiaTrasBaja: 'P5555',
  },
  TRANSPORTE: {
    tabla: 'inscripciones_servicios',
    columnaConf: 'inscripcion_servicio_id',
    alta: () => `(public.establecer_recorrido_transporte('${TR_NORTE}')).id`,
    confirmar: (id) => `public.confirmar_inscripcion_servicio('${id}', 'TRANSPORTE')`,
    cancelarAdm: (id) =>
      `(public.cancelar_inscripcion_servicio_administrativa('${id}', 'TRANSPORTE')).id`,
    cancelarPropia: (id) => `(public.cancelar_inscripcion_servicio('${id}')).id`,
    errorPropiaTrasBaja: 'P5555',
  },
}
let grupos

/** Alta de una inscripción nueva como alumno (RPC vigente). Devuelve el id. */
async function alta(alumno, dominio, grupo = undefined) {
  await sesionA.ejecutar(como(alumno), `como_alumno_${dominio}`)
  const id = await sesionA.escalar(`(SELECT ${DOM[dominio].alta(grupo ?? grupos.a)})`, `alta_${dominio}`)
  await sesionA.ejecutar('RESET ROLE;', `alta_${dominio}_propietario`)
  return id
}

const estadoDe = (dominio, id, etiqueta) =>
  consultar(sesionA, `(SELECT estado FROM public.${DOM[dominio].tabla} WHERE id = '${id}')`, etiqueta)

const canceladaEn = (dominio, id, etiqueta) =>
  consultar(
    sesionA,
    `(SELECT fecha_cancelacion FROM public.${DOM[dominio].tabla} WHERE id = '${id}')`,
    etiqueta
  )

const nConfirmaciones = async (dominio, id, etiqueta) =>
  Number(
    await consultar(
      sesionA,
      `(SELECT pg_catalog.count(*) FROM public.confirmaciones_inscripcion
        WHERE ${DOM[dominio].columnaConf} = '${id}')`,
      etiqueta
    )
  )

const confirmadaPor = (dominio, id, etiqueta) =>
  consultar(
    sesionA,
    `(SELECT confirmada_por FROM public.confirmaciones_inscripcion
      WHERE ${DOM[dominio].columnaConf} = '${id}')`,
    etiqueta
  )

const nConfirmacionesMatricula = async (matricula, etiqueta) =>
  Number(
    await consultar(
      sesionA,
      `(SELECT pg_catalog.count(*) FROM public.confirmaciones_inscripcion WHERE matricula_id = '${matricula}')`,
      etiqueta
    )
  )

const activasDe = async (dominio, alumno, etiqueta, extra = '') =>
  Number(
    await consultar(
      sesionA,
      `(SELECT pg_catalog.count(*) FROM public.${DOM[dominio].tabla}
        WHERE alumno_id = '${alumno}' AND estado = 'ACTIVA' ${extra})`,
      etiqueta
    )
  )

const totalFilas = async (dominio, alumno, etiqueta, extra = '') =>
  Number(
    await consultar(
      sesionA,
      `(SELECT pg_catalog.count(*) FROM public.${DOM[dominio].tabla}
        WHERE alumno_id = '${alumno}' ${extra})`,
      etiqueta
    )
  )

const soloComedor = `AND servicio_id = '${COMEDOR}'`
const soloTransporte = `AND servicio_id IN ('${TR_NORTE}', '${TR_SUR}')`
const extraDe = (dominio) =>
  dominio === 'COMEDOR' ? soloComedor : dominio === 'TRANSPORTE' ? soloTransporte : ''

const matriculaVigente = (alumno, etiqueta) =>
  consultar(
    sesionA,
    `(SELECT id FROM public.matriculas WHERE alumno_id = '${alumno}' AND fecha_cierre IS NULL)`,
    etiqueta
  )

// ---------------------------------------------------------------------------
// Limpieza y fixture en UNA transacción cada una.
// ---------------------------------------------------------------------------
async function limpiar(etiqueta) {
  await sesionA.ejecutar(
    `RESET ROLE;
     BEGIN;
     -- El registro es append-only por trigger: se desactiva SOLO acá, dentro de esta
     -- transacción y SOLO para las filas del fixture, y se reactiva antes del COMMIT.
     ALTER TABLE public.confirmaciones_inscripcion DISABLE TRIGGER ${TRIGGER_REGISTRO};
     DELETE FROM public.confirmaciones_inscripcion c
      WHERE c.confirmada_por IN (${lista(PERFILES)})
         OR c.matricula_id IN (SELECT id FROM public.matriculas WHERE alumno_id IN (${lista(ALUMNOS)}))
         OR c.inscripcion_deportiva_id IN
              (SELECT id FROM public.inscripciones_deportivas WHERE alumno_id IN (${lista(ALUMNOS)}))
         OR c.inscripcion_servicio_id IN
              (SELECT id FROM public.inscripciones_servicios WHERE alumno_id IN (${lista(ALUMNOS)}));
     ALTER TABLE public.confirmaciones_inscripcion ENABLE TRIGGER ${TRIGGER_REGISTRO};
     DELETE FROM public.inscripciones_deportivas WHERE alumno_id IN (${lista(ALUMNOS)});
     DELETE FROM public.inscripciones_servicios WHERE alumno_id IN (${lista(ALUMNOS)});
     DELETE FROM public.grupos_deportivos_horarios
       WHERE grupo_id IN (SELECT id FROM public.grupos_deportivos WHERE profesor_id = '${ID.docente}');
     DELETE FROM public.grupos_deportivos WHERE profesor_id = '${ID.docente}';
     DELETE FROM public.horarios h
       WHERE h.hora_inicio = '${FRANJA.inicio}' AND h.hora_fin = '${FRANJA.fin}'
         AND NOT EXISTS (SELECT 1 FROM public.grupos_deportivos_horarios f WHERE f.horario_id = h.id);
     DELETE FROM public.matriculas WHERE alumno_id IN (${lista(ALUMNOS)});
     DELETE FROM public.alumnos WHERE perfil_id IN (${lista(ALUMNOS)});
     -- Desde EPT-58 el perfil DOCENTE tiene ficha y la FK es RESTRICT.
     DELETE FROM public.profesores WHERE perfil_id IN (${lista(PERFILES)});
     DELETE FROM public.perfiles WHERE id IN (${lista(PERFILES)});
     DELETE FROM public.cursos WHERE id IN ('${ID.curso1}', '${ID.curso2}');
     COMMIT;`,
    etiqueta
  )
}

async function crearFixture() {
  const fila = (id, rol, apellido, dni, legajo) =>
    `('${id}', '${rol}', '${apellido}', '${dni}', ${legajo ? `'${legajo}'` : 'NULL'})`
  await sesionA.ejecutar(
    `RESET ROLE;
     BEGIN;
     INSERT INTO public.cursos (id, nivel_id, denominacion, division, activo) VALUES
       ('${ID.curso1}', (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'),
        'CONCURRENCIA EPT-62 A', 'A', TRUE),
       ('${ID.curso2}', (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'),
        'CONCURRENCIA EPT-62 B', 'B', TRUE);

     INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni, legajo_nro)
     SELECT v.id::UUID, v.id::UUID, r.id, 'Prueba', v.apellido, v.dni, v.legajo
     FROM (VALUES
       ${fila(ID.dir1, 'DIRECTOR', 'Directora Uno', '98620001', null)},
       ${fila(ID.dir2, 'DIRECTOR', 'Directora Dos', '98620002', null)},
       ${fila(ID.docente, 'DOCENTE', 'Docente', '98620003', null)},
       ${fila(ID.s1, 'ESTUDIANTE', 'Uno', '98620011', 'LEG-EPT62-C11')},
       ${fila(ID.s2, 'ESTUDIANTE', 'Dos', '98620012', 'LEG-EPT62-C12')},
       ${fila(ID.s3, 'ESTUDIANTE', 'Tres', '98620013', 'LEG-EPT62-C13')},
       ${fila(ID.s4, 'ESTUDIANTE', 'Cuatro', '98620014', 'LEG-EPT62-C14')},
       ${fila(ID.s5, 'ESTUDIANTE', 'Cinco', '98620015', 'LEG-EPT62-C15')},
       ${fila(ID.s6, 'ESTUDIANTE', 'Seis', '98620016', 'LEG-EPT62-C16')},
       ${fila(ID.s7, 'ESTUDIANTE', 'Siete', '98620017', 'LEG-EPT62-C17')},
       ${fila(ID.s8, 'ESTUDIANTE', 'Ocho', '98620018', 'LEG-EPT62-C18')},
       ${fila(ID.s9, 'ESTUDIANTE', 'Nueve', '98620019', 'LEG-EPT62-C19')},
       ${fila(ID.s10, 'ESTUDIANTE', 'Diez', '98620020', 'LEG-EPT62-C20')},
       ${fila(ID.s11, 'ESTUDIANTE', 'Once', '98620021', 'LEG-EPT62-C21')}
     ) AS v(id, rol, apellido, dni, legajo)
     JOIN public.roles r ON r.nombre = v.rol;

     INSERT INTO public.matriculas (alumno_id, curso_id)
     SELECT a, '${ID.curso1}' FROM unnest(ARRAY[${lista(ALUMNOS)}]::UUID[]) AS a;
     UPDATE public.alumnos SET estado = 'ACTIVO' WHERE perfil_id IN (${lista(ALUMNOS)});
     COMMIT;`,
    'fixture'
  )
}

async function crearGrupo(clave, deporte, cupo, dia) {
  await sesionA.ejecutar(como(ID.dir1), `como_director_${clave}`)
  const id = await sesionA.escalar(
    `(SELECT (public.crear_grupo_deportivo('${deporte}',
        (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'),
        '${GRUPO_PREFIJO} ${clave}', ${cupo}, '${ID.docente}')).id)`,
    `grupo_${clave}`
  )
  await sesionA.escalar(
    `(SELECT (public.agregar_horario_grupo_deportivo('${id}', ${dia}::SMALLINT,
        '${FRANJA.inicio}', '${FRANJA.fin}')).id)`,
    `franja_${clave}`
  )
  await sesionA.ejecutar('RESET ROLE;', `grupo_${clave}_propietario`)
  return id
}

// ---------------------------------------------------------------------------
// 1. Confirmar frente a cancelar administrativamente la misma inscripción.
//
//    Confirmar toma la fila (FOR UPDATE) y después inserta la confirmación;
//    cancelar administrativamente también toma la fila (FOR UPDATE) antes de
//    su UPDATE (y, en deportes, del alumno y del grupo). Las dos se
//    serializan por ese primer bloqueo.
//      * gana confirmar: la baja espera, releé la fila ACTIVA y procede; la
//        inscripción queda CANCELADA y la marca se conserva.
//      * gana cancelar: la confirmación espera, relee la fila ya CANCELADA y
//        se rechaza con P6202; no hay fila de confirmación.
// ---------------------------------------------------------------------------
async function probarConfirmarVsCancelarAdministrativa(dominio) {
  const d = DOM[dominio]

  // 1.x Gana confirmar (dir1); cancela dir2.
  {
    const id = await alta(ID.s1, dominio)
    const r = await carrera({
      actorA: ID.dir1,
      exprA: d.confirmar(id),
      actorB: ID.dir2,
      exprB: d.cancelarAdm(id),
      etiqueta: `confirmar_primero_${dominio}`,
    })
    afirmar(r.a.res === 'OK' && JSON.parse(r.a.val).ya_confirmada === false,
      `${dominio}: la confirmación ganadora terminó en ${r.a.res} ${r.a.val}`)
    afirmar(r.b.res === 'OK', `${dominio}: la baja tras la confirmación terminó en ${r.b.res}, se esperaba OK`)
    const estado = await estadoDe(dominio, id, `${dominio}_estado_1`)
    const fecha = await canceladaEn(dominio, id, `${dominio}_fecha_1`)
    const n = await nConfirmaciones(dominio, id, `${dominio}_n_1`)
    const por = await confirmadaPor(dominio, id, `${dominio}_por_1`)
    const activas = await activasDe(dominio, ID.s1, `${dominio}_activas_1`, extraDe(dominio))
    afirmar(estado === 'CANCELADA' && fecha !== '<NULL>' && fecha !== '' && n === 1 && por === ID.dir1 && activas === 0,
      `${dominio} confirmar→cancelar: estado=${estado}, fecha=${fecha}, confirmaciones=${n}, por=${por}, activas=${activas}`)
    ok(`${dominio}: confirmar primero y cancelar después — la baja espera la fila, procede, y la inscripción queda CANCELADA con su fecha y UNA confirmación conservada (por la directora que confirmó); sin activas residuales`)
  }

  // 1.y Gana cancelar (dir1); confirma dir2.
  {
    const id = await alta(ID.s1, dominio)
    const r = await carrera({
      actorA: ID.dir1,
      exprA: d.cancelarAdm(id),
      actorB: ID.dir2,
      exprB: d.confirmar(id),
      etiqueta: `cancelar_primero_${dominio}`,
    })
    afirmar(r.a.res === 'OK', `${dominio}: la baja ganadora terminó en ${r.a.res}`)
    afirmar(r.b.res === 'P6202', `${dominio}: la confirmación tras la baja terminó en ${r.b.res}, se esperaba P6202`)
    const estado = await estadoDe(dominio, id, `${dominio}_estado_2`)
    const fecha = await canceladaEn(dominio, id, `${dominio}_fecha_2`)
    const n = await nConfirmaciones(dominio, id, `${dominio}_n_2`)
    const activas = await activasDe(dominio, ID.s1, `${dominio}_activas_2`, extraDe(dominio))
    afirmar(estado === 'CANCELADA' && fecha !== '<NULL>' && fecha !== '' && n === 0 && activas === 0,
      `${dominio} cancelar→confirmar: estado=${estado}, fecha=${fecha}, confirmaciones=${n}, activas=${activas}`)
    ok(`${dominio}: cancelar primero y confirmar después — la confirmación espera la fila, la relee CANCELADA y recibe P6202; cero filas de confirmación y sin activas`)
  }
}

// ---------------------------------------------------------------------------
// 2. Confirmar frente al cierre de matrícula.
//
//    inactivar_alumno y cambiar_curso_alumno toman alumnos y luego la fila de
//    la matrícula vigente; confirmar toma solo la fila de la matrícula. No hay
//    ciclo: la espera es siempre por la fila de la matrícula.
// ---------------------------------------------------------------------------
async function probarConfirmarVsCierreDeMatricula() {
  // 2a. Confirmar primero, inactivar después (S2): la inactivación espera la
  //     fila, cierra la matrícula conservando la confirmación.
  {
    const m = await matriculaVigente(ID.s2, 'matricula_s2')
    const r = await carrera({
      actorA: ID.dir1,
      exprA: `public.confirmar_matricula('${m}')`,
      actorB: ID.dir2,
      exprB: `public.inactivar_alumno('${ID.s2}')`,
      etiqueta: 'confirmar_e_inactivar',
    })
    afirmar(r.a.res === 'OK' && r.b.res === 'OK',
      `confirmar→inactivar terminó en A=${r.a.res}, B=${r.b.res}`)
    const cierre = await consultar(sesionA, `(SELECT motivo_cierre FROM public.matriculas WHERE id = '${m}')`, 's2_cierre')
    const estado = await consultar(sesionA, `(SELECT estado FROM public.alumnos WHERE perfil_id = '${ID.s2}')`, 's2_estado')
    const n = await nConfirmacionesMatricula(m, 's2_n')
    const vigentes = await consultar(sesionA,
      `(SELECT pg_catalog.count(*) FROM public.matriculas WHERE alumno_id = '${ID.s2}' AND fecha_cierre IS NULL)`, 's2_vigentes')
    afirmar(cierre === 'INACTIVACION' && estado === 'INACTIVO' && n === 1 && vigentes === '0',
      `confirmar→inactivar: motivo=${cierre}, estado=${estado}, confirmaciones=${n}, vigentes=${vigentes}`)
    ok('matrícula: confirmar primero e inactivar después — la inactivación espera la fila de la matrícula y la cierra (INACTIVACION); la confirmación se conserva, el alumno queda INACTIVO sin matrícula vigente')
  }

  // 2b. Inactivar primero, confirmar después (S3): la confirmación espera la
  //     fila, la relee cerrada y se rechaza con P6202.
  {
    const m = await matriculaVigente(ID.s3, 'matricula_s3')
    const r = await carrera({
      actorA: ID.dir1,
      exprA: `public.inactivar_alumno('${ID.s3}')`,
      actorB: ID.dir2,
      exprB: `public.confirmar_matricula('${m}')`,
      etiqueta: 'inactivar_y_confirmar',
    })
    afirmar(r.a.res === 'OK' && r.b.res === 'P6202',
      `inactivar→confirmar terminó en A=${r.a.res}, B=${r.b.res}; se esperaba OK y P6202`)
    const n = await nConfirmacionesMatricula(m, 's3_n')
    const estado = await consultar(sesionA, `(SELECT estado FROM public.alumnos WHERE perfil_id = '${ID.s3}')`, 's3_estado')
    afirmar(n === 0 && estado === 'INACTIVO', `inactivar→confirmar: confirmaciones=${n}, estado=${estado}`)
    ok('matrícula: inactivar primero y confirmar después — la confirmación relee la matrícula cerrada y recibe P6202; cero filas de confirmación')
  }

  // 2c. Confirmar primero, cambiar de curso después (S4): el cambio espera la
  //     fila, cierra la anterior (confirmada) y abre una nueva SIN confirmar.
  {
    const m = await matriculaVigente(ID.s4, 'matricula_s4')
    const r = await carrera({
      actorA: ID.dir1,
      exprA: `public.confirmar_matricula('${m}')`,
      actorB: ID.dir2,
      exprB: `public.cambiar_curso_alumno('${ID.s4}', '${ID.curso2}')`,
      etiqueta: 'confirmar_y_cambiar_curso',
    })
    afirmar(r.a.res === 'OK' && r.b.res === 'OK', `confirmar→cambio de curso terminó en A=${r.a.res}, B=${r.b.res}`)
    const cierre = await consultar(sesionA, `(SELECT motivo_cierre FROM public.matriculas WHERE id = '${m}')`, 's4_cierre')
    const n = await nConfirmacionesMatricula(m, 's4_n')
    const nueva = await matriculaVigente(ID.s4, 's4_nueva')
    afirmar(cierre === 'CAMBIO_DE_CURSO' && n === 1 && nueva !== m && nueva !== '<NULL>',
      `confirmar→cambio de curso: motivo=${cierre}, confirmaciones=${n}, nueva=${nueva}`)
    afirmar((await nConfirmacionesMatricula(nueva, 's4_n_nueva')) === 0, 'la matrícula nueva nació confirmada')
    ok('matrícula: confirmar primero y cambiar de curso después — el cambio espera la fila, cierra la anterior con su confirmación intacta y abre una matrícula nueva SIN confirmar')
  }

  // 2d. Cambiar de curso primero, confirmar la matrícula ANTERIOR después (S5).
  {
    const m = await matriculaVigente(ID.s5, 'matricula_s5')
    const r = await carrera({
      actorA: ID.dir1,
      exprA: `public.cambiar_curso_alumno('${ID.s5}', '${ID.curso2}')`,
      actorB: ID.dir2,
      exprB: `public.confirmar_matricula('${m}')`,
      etiqueta: 'cambiar_curso_y_confirmar',
    })
    afirmar(r.a.res === 'OK' && r.b.res === 'P6202',
      `cambio de curso→confirmar terminó en A=${r.a.res}, B=${r.b.res}; se esperaba OK y P6202`)
    const n = await nConfirmacionesMatricula(m, 's5_n')
    const nueva = await matriculaVigente(ID.s5, 's5_nueva')
    afirmar(n === 0 && nueva !== m, `cambio de curso→confirmar: confirmaciones=${n}`)
    afirmar((await nConfirmacionesMatricula(nueva, 's5_n_nueva')) === 0, 'la matrícula nueva nació confirmada')
    ok('matrícula: cambiar de curso primero y confirmar la anterior después — recibe P6202; sin confirmaciones sobre ninguna de las dos matrículas')
  }
}

// ---------------------------------------------------------------------------
// 3. Doble confirmación simultánea.
//    La segunda espera el bloqueo de la fila, encuentra la confirmación de la
//    primera (nueva sentencia, nueva instantánea) y la devuelve sin cambiarla.
//    Una sola fila de auditoría; el índice único es la autoridad de respaldo.
// ---------------------------------------------------------------------------
const nombreDe = { [ID.dir1]: 'Prueba Directora Uno', [ID.dir2]: 'Prueba Directora Dos' }
const filasConfirmables = {}

async function probarDobleConfirmacion(dominio, expresion, id, actorA, actorB, esMatricula = false) {
  const r = await carrera({
    actorA,
    exprA: expresion,
    actorB,
    exprB: expresion,
    etiqueta: `doble_confirmacion_${dominio}`,
  })
  afirmar(r.a.res === 'OK' && r.b.res === 'OK',
    `${dominio}: la doble confirmación terminó en A=${r.a.res}, B=${r.b.res}; se esperaban dos éxitos`)
  const ja = JSON.parse(r.a.val)
  const jb = JSON.parse(r.b.val)
  afirmar(ja.ya_confirmada === false && jb.ya_confirmada === true,
    `${dominio}: ya_confirmada A=${ja.ya_confirmada}, B=${jb.ya_confirmada}`)
  afirmar(ja.confirmada_en === jb.confirmada_en && ja.confirmada_por_nombre === jb.confirmada_por_nombre
    && jb.confirmada_por_nombre === nombreDe[actorA],
    `${dominio}: la segunda confirmación no devolvió el confirmador y la fecha de la primera (${JSON.stringify(jb)})`)
  const n = esMatricula
    ? await nConfirmacionesMatricula(id, `${dominio}_n_doble`)
    : await nConfirmaciones(dominio, id, `${dominio}_n_doble`)
  const filaPor = await consultar(
    sesionA,
    esMatricula
      ? `(SELECT confirmada_por FROM public.confirmaciones_inscripcion WHERE matricula_id = '${id}')`
      : `(SELECT confirmada_por FROM public.confirmaciones_inscripcion WHERE ${DOM[dominio].columnaConf} = '${id}')`,
    `${dominio}_por_doble`
  )
  afirmar(n === 1 && filaPor === actorA,
    `${dominio}: confirmaciones=${n}, confirmada_por=${filaPor}; se esperaba una sola, de la primera directora`)
  const distintas = actorA !== actorB
  ok(`${dominio}: dos confirmaciones simultáneas (${distintas ? 'dos directoras distintas' : 'la misma directora'}) — dos éxitos, la segunda con ya_confirmada=true, mismo confirmador y fecha, exactamente UNA fila de auditoría`)
}

// ---------------------------------------------------------------------------
// 4. Doble cancelación administrativa simultánea (sobre las filas confirmadas
//    del escenario 3): un éxito y un P6203; una sola fecha_cancelacion, la de
//    la transacción ganadora; la confirmación se conserva.
// ---------------------------------------------------------------------------
async function probarDobleCancelacion(dominio, id, actorA, actorB) {
  const r = await carrera({
    actorA,
    exprA: DOM[dominio].cancelarAdm(id),
    actorB,
    exprB: DOM[dominio].cancelarAdm(id),
    etiqueta: `doble_cancelacion_${dominio}`,
    antesDeA: `SELECT pg_catalog.set_config('ept62.ts', pg_catalog.now()::text, false);`,
  })
  afirmar(r.a.res === 'OK' && r.b.res === 'P6203',
    `${dominio}: la doble cancelación terminó en A=${r.a.res}, B=${r.b.res}; se esperaba OK y P6203`)
  const estado = await estadoDe(dominio, id, `${dominio}_estado_doble`)
  const mismaFecha = await consultar(
    sesionA,
    `(SELECT fecha_cancelacion = '${await sesionA.escalar(`pg_catalog.current_setting('ept62.ts')`, `${dominio}_ts`)}'::timestamptz
        FROM public.${DOM[dominio].tabla} WHERE id = '${id}')`,
    `${dominio}_fecha_doble`
  )
  const n = await nConfirmaciones(dominio, id, `${dominio}_n_cancelacion`)
  afirmar(estado === 'CANCELADA' && mismaFecha === 'true' && n === 1,
    `${dominio}: estado=${estado}, fecha de la transacción ganadora=${mismaFecha}, confirmaciones=${n}`)
  ok(`${dominio}: dos cancelaciones administrativas simultáneas — un éxito y un P6203; una sola fecha_cancelacion (la de la transacción ganadora) y la confirmación previa intacta`)
}

// ---------------------------------------------------------------------------
// 5a. Cancelación administrativa de un deporte frente a un alta del alumno.
//
//     La baja toma fila → alumno → grupo; el alta toma alumno → grupos. Los
//     dos se cruzan en el bloqueo del alumno, no en un ciclo.
//       X. gana la baja: el alta del alumno a OTRO grupo del MISMO deporte
//          espera el bloqueo del alumno; al confirmarse la baja ya no hay una
//          inscripción activa del deporte y el alta PROCEDE (éxito posterior a
//          la baja, nunca P5576/23505). Resultado: exactamente una activa del
//          deporte.
//       Y. gana el alta (a un deporte distinto): la baja espera el bloqueo del
//          alumno y luego procede. Resultado: una baja y un alta, sin pérdidas.
//     Cupo: la baja libera la plaza; otra alumna que esperaba el grupo la
//     ocupa y el cupo nunca se excede.
// ---------------------------------------------------------------------------
async function probarBajaFrenteAAlta() {
  // X
  const g1 = await alta(ID.s7, 'DEPORTE', grupos.a)
  const r = await carrera({
    actorA: ID.dir1,
    exprA: DOM.DEPORTE.cancelarAdm(g1),
    actorB: ID.s7,
    exprB: DOM.DEPORTE.alta(grupos.e),
    etiqueta: 'baja_y_reinscripcion',
  })
  afirmar(r.a.res === 'OK' && r.b.res === 'OK',
    `baja→reinscripción al mismo deporte terminó en A=${r.a.res}, B=${r.b.res}; se esperaba OK y OK`)
  const nuevo = r.b.val
  afirmar(nuevo !== g1 && (await estadoDe('DEPORTE', g1, 's7_estado_1')) === 'CANCELADA'
    && (await estadoDe('DEPORTE', nuevo, 's7_estado_nuevo')) === 'ACTIVA',
    'la reinscripción no dejó una baja y un alta activa')
  const activasFutbol = Number(await consultar(sesionA,
    `(SELECT pg_catalog.count(*) FROM public.inscripciones_deportivas
      WHERE alumno_id = '${ID.s7}' AND estado = 'ACTIVA' AND deporte_id = '${FUTBOL}')`, 's7_futbol'))
  afirmar(activasFutbol === 1, `quedaron ${activasFutbol} inscripciones activas de Fútbol`)
  ok('deporte: la baja administrativa en curso y la reinscripción del alumno al mismo deporte (otro grupo) — el alta espera el bloqueo del alumno y, con la baja ya confirmada, PROCEDE (no P5576 ni 23505); queda exactamente UNA activa del deporte')

  // Y
  const g2 = nuevo
  const r2 = await carrera({
    actorA: ID.s7,
    exprA: DOM.DEPORTE.alta(grupos.b),
    actorB: ID.dir2,
    exprB: DOM.DEPORTE.cancelarAdm(g2),
    etiqueta: 'reinscripcion_y_baja',
  })
  afirmar(r2.a.res === 'OK' && r2.b.res === 'OK',
    `reinscripción→baja terminó en A=${r2.a.res}, B=${r2.b.res}; se esperaba OK y OK`)
  afirmar((await estadoDe('DEPORTE', g2, 's7_estado_2')) === 'CANCELADA'
    && (await estadoDe('DEPORTE', r2.a.val, 's7_estado_2b')) === 'ACTIVA', 'no quedó una baja y un alta activa')
  const activas = await activasDe('DEPORTE', ID.s7, 's7_activas_final')
  const total = await totalFilas('DEPORTE', ID.s7, 's7_total_final')
  afirmar(activas === 1 && total === 3, `quedaron ${activas} activas y ${total} filas; se esperaban 1 y 3 (sin filas perdidas)`)
  ok('deporte: el alta del alumno (a otro deporte) en curso y la baja administrativa de otra inscripción suya — la baja espera el bloqueo del alumno y procede; una activa y tres filas (ninguna perdida, ningún doble cupo)')

  // Cupo: Vóley (cupo 1). S8 ocupa la plaza; S11 espera el grupo mientras Dirección da de baja a S8.
  const plaza = await alta(ID.s8, 'DEPORTE', grupos.c)
  const r3 = await carrera({
    actorA: ID.dir1,
    exprA: DOM.DEPORTE.cancelarAdm(plaza),
    actorB: ID.s11,
    exprB: DOM.DEPORTE.alta(grupos.c),
    etiqueta: 'baja_y_plaza',
  })
  afirmar(r3.a.res === 'OK' && r3.b.res === 'OK',
    `baja→ocupar la plaza terminó en A=${r3.a.res}, B=${r3.b.res}; se esperaba OK y OK`)
  const ocupacion = Number(await consultar(sesionA,
    `(SELECT pg_catalog.count(*) FROM public.inscripciones_deportivas
      WHERE grupo_id = '${grupos.c}' AND estado = 'ACTIVA')`, 'ocupacion_voley'))
  afirmar(ocupacion === 1 && (await estadoDe('DEPORTE', plaza, 'plaza_estado')) === 'CANCELADA',
    `Vóley quedó con ${ocupacion} activa(s)`)
  // Y no se puede exceder: otra alta directa al mismo grupo lleno recibe P5574.
  await sesionA.ejecutar(como(ID.s9), 'como_s9_cupo')
  await sesionA.ejecutar(tolerante(DOM.DEPORTE.alta(grupos.c)), 'alta_cupo_excedido')
  const excedido = await desenlace(sesionA, 'alta_cupo_excedido')
  afirmar(excedido.res === 'P5574', `el alta sobre el grupo lleno terminó en ${excedido.res}, se esperaba P5574`)
  ok('deporte: cupo 1 — la baja administrativa libera la plaza y la alumna que esperaba el grupo la ocupa; el cupo nunca se excede (una activa; un alta posterior recibe P5574)')
}

// ---------------------------------------------------------------------------
// 5b. Cancelación administrativa de un recorrido frente a establecer_recorrido_transporte.
//
//     El alta del alumno toma alumno → servicio (SHARE) → la fila activa (FOR
//     UPDATE); la baja administrativa toma la fila (FOR UPDATE). La espera es
//     por la fila activa.
//       X. gana la baja: el alumno espera la fila, la relee CANCELADA (ya no
//          es activa), no cancela nada y crea el recorrido nuevo.
//       Y. gana el cambio del alumno: la baja espera la fila, la relee ya
//          CANCELADA por el cambio y recibe P6203.
//     En ambos: nunca dos recorridos activos y ninguna fila se pierde.
// ---------------------------------------------------------------------------
async function probarBajaFrenteACambioDeRecorrido() {
  const norte = await alta(ID.s8, 'TRANSPORTE')

  // X
  const r = await carrera({
    actorA: ID.dir1,
    exprA: DOM.TRANSPORTE.cancelarAdm(norte),
    actorB: ID.s8,
    exprB: `(public.establecer_recorrido_transporte('${TR_SUR}')).id`,
    etiqueta: 'baja_y_cambio_recorrido',
  })
  afirmar(r.a.res === 'OK' && r.b.res === 'OK',
    `baja→cambio de recorrido terminó en A=${r.a.res}, B=${r.b.res}; se esperaba OK y OK`)
  const sur = r.b.val
  afirmar((await estadoDe('TRANSPORTE', norte, 's8_norte')) === 'CANCELADA'
    && (await estadoDe('TRANSPORTE', sur, 's8_sur')) === 'ACTIVA' && sur !== norte,
    'el cambio no dejó TR-NORTE cancelado y TR-SUR activo')
  afirmar((await activasDe('TRANSPORTE', ID.s8, 's8_activas_1', soloTransporte)) === 1
    && (await totalFilas('TRANSPORTE', ID.s8, 's8_total_1', soloTransporte)) === 2,
    'tras la baja y el cambio debería haber un recorrido activo y dos filas')
  ok('transporte: la baja administrativa en curso y establecer_recorrido_transporte del alumno — el alumno espera la fila activa, la relee CANCELADA, no cancela nada y crea el recorrido nuevo; un activo y dos filas')

  // Y
  const r2 = await carrera({
    actorA: ID.s8,
    exprA: `(public.establecer_recorrido_transporte('${TR_NORTE}')).id`,
    actorB: ID.dir2,
    exprB: DOM.TRANSPORTE.cancelarAdm(sur),
    etiqueta: 'cambio_recorrido_y_baja',
  })
  afirmar(r2.a.res === 'OK' && r2.b.res === 'P6203',
    `cambio de recorrido→baja terminó en A=${r2.a.res}, B=${r2.b.res}; se esperaba OK y P6203`)
  afirmar((await estadoDe('TRANSPORTE', sur, 's8_sur_2')) === 'CANCELADA'
    && (await estadoDe('TRANSPORTE', r2.a.val, 's8_norte_2')) === 'ACTIVA', 'el cambio no dejó una baja y un recorrido activo')
  afirmar((await activasDe('TRANSPORTE', ID.s8, 's8_activas_2', soloTransporte)) === 1
    && (await totalFilas('TRANSPORTE', ID.s8, 's8_total_2', soloTransporte)) === 3,
    'tras el cambio y la baja rechazada debería haber un recorrido activo y tres filas')
  ok('transporte: el cambio de recorrido del alumno en curso y la baja administrativa del recorrido que deja — la baja espera la fila, la relee ya CANCELADA por el cambio y recibe P6203; un activo y tres filas, sin dos recorridos activos')
}

// ---------------------------------------------------------------------------
// 5c. Cancelación administrativa frente a la cancelación propia de la misma
//     inscripción. Las dos escriben la MISMA fila: una gana y la otra recibe el
//     error de «ya cancelada» de su propio circuito.
//       X. gana la administrativa: la propia relee la fila CANCELADA y recibe
//          P5555 (servicios) o P5579 (deportes).
//       Y. gana la propia: la administrativa relee la fila y recibe P6203.
// ---------------------------------------------------------------------------
async function probarBajaAdministrativaFrenteABajaPropia(dominio) {
  const d = DOM[dominio]

  {
    const id = await alta(ID.s9, dominio, grupos.a)
    const r = await carrera({
      actorA: ID.dir1,
      exprA: d.cancelarAdm(id),
      actorB: ID.s9,
      exprB: d.cancelarPropia(id),
      etiqueta: `adm_y_propia_${dominio}`,
    })
    afirmar(r.a.res === 'OK' && r.b.res === d.errorPropiaTrasBaja,
      `${dominio}: administrativa→propia terminó en A=${r.a.res}, B=${r.b.res}; se esperaba OK y ${d.errorPropiaTrasBaja}`)
    afirmar((await estadoDe(dominio, id, `${dominio}_estado_5c1`)) === 'CANCELADA'
      && (await activasDe(dominio, ID.s9, `${dominio}_activas_5c1`, extraDe(dominio))) === 0,
      `${dominio}: no quedó CANCELADA y sin activas`)
    ok(`${dominio}: baja administrativa y baja propia de la misma inscripción (gana la administrativa) — la propia relee la fila cancelada y recibe ${d.errorPropiaTrasBaja}; una sola cancelación`)
  }

  {
    const id = await alta(ID.s9, dominio, grupos.a)
    const r = await carrera({
      actorA: ID.s9,
      exprA: d.cancelarPropia(id),
      actorB: ID.dir2,
      exprB: d.cancelarAdm(id),
      etiqueta: `propia_y_adm_${dominio}`,
      antesDeA: `SELECT pg_catalog.set_config('ept62.ts', pg_catalog.now()::text, false);`,
    })
    afirmar(r.a.res === 'OK' && r.b.res === 'P6203',
      `${dominio}: propia→administrativa terminó en A=${r.a.res}, B=${r.b.res}; se esperaba OK y P6203`)
    const mismaFecha = await consultar(
      sesionA,
      `(SELECT fecha_cancelacion = pg_catalog.current_setting('ept62.ts')::timestamptz
          FROM public.${d.tabla} WHERE id = '${id}')`,
      `${dominio}_fecha_5c2`
    )
    afirmar((await estadoDe(dominio, id, `${dominio}_estado_5c2`)) === 'CANCELADA' && mismaFecha === 'true',
      `${dominio}: estado o fecha inesperados tras la baja propia y la administrativa`)
    ok(`${dominio}: baja propia y baja administrativa de la misma inscripción (gana la propia) — la administrativa relee la fila cancelada y recibe P6203; la fecha es la de la baja propia`)
  }
}

// ---------------------------------------------------------------------------
// 6. Confirmar frente a la cancelación propia del alumno.
//      * gana confirmar: la baja propia espera la fila, procede; queda
//        CANCELADA con la confirmación conservada.
//      * gana la baja propia: la confirmación espera la fila, la relee
//        CANCELADA y recibe P6202; cero confirmaciones.
// ---------------------------------------------------------------------------
async function probarConfirmarFrenteABajaPropia(dominio) {
  const d = DOM[dominio]

  {
    const id = await alta(ID.s10, dominio, grupos.a)
    const r = await carrera({
      actorA: ID.dir1,
      exprA: d.confirmar(id),
      actorB: ID.s10,
      exprB: d.cancelarPropia(id),
      etiqueta: `confirmar_y_propia_${dominio}`,
    })
    afirmar(r.a.res === 'OK' && r.b.res === 'OK',
      `${dominio}: confirmar→baja propia terminó en A=${r.a.res}, B=${r.b.res}; se esperaba OK y OK`)
    afirmar((await estadoDe(dominio, id, `${dominio}_estado_6a`)) === 'CANCELADA'
      && (await nConfirmaciones(dominio, id, `${dominio}_n_6a`)) === 1
      && (await confirmadaPor(dominio, id, `${dominio}_por_6a`)) === ID.dir1
      && (await activasDe(dominio, ID.s10, `${dominio}_activas_6a`, extraDe(dominio))) === 0,
      `${dominio}: estado final inesperado tras confirmar y cancelar por el alumno`)
    ok(`${dominio}: confirmar primero y baja propia después — la baja espera la fila y procede; queda CANCELADA con la confirmación conservada`)
  }

  {
    const id = await alta(ID.s10, dominio, grupos.a)
    const r = await carrera({
      actorA: ID.s10,
      exprA: d.cancelarPropia(id),
      actorB: ID.dir2,
      exprB: d.confirmar(id),
      etiqueta: `propia_y_confirmar_${dominio}`,
    })
    afirmar(r.a.res === 'OK' && r.b.res === 'P6202',
      `${dominio}: baja propia→confirmar terminó en A=${r.a.res}, B=${r.b.res}; se esperaba OK y P6202`)
    afirmar((await estadoDe(dominio, id, `${dominio}_estado_6b`)) === 'CANCELADA'
      && (await nConfirmaciones(dominio, id, `${dominio}_n_6b`)) === 0
      && (await activasDe(dominio, ID.s10, `${dominio}_activas_6b`, extraDe(dominio))) === 0,
      `${dominio}: estado final inesperado tras cancelar por el alumno y confirmar`)
    ok(`${dominio}: baja propia primero y confirmar después — la confirmación relee la fila CANCELADA y recibe P6202; cero confirmaciones`)
  }
}

try {
  pids = {
    a: Number(await sesionA.escalar('pg_catalog.pg_backend_pid()', 'pid')),
    b: Number(await sesionB.escalar('pg_catalog.pg_backend_pid()', 'pid')),
  }

  // ------------------------------------------------------------------
  // Limpieza inicial idempotente (por si una corrida anterior murió a la
  // mitad) y fixture sintético en UNA transacción. Los DNI viven en un rango
  // ficticio (98620001 en adelante) y no corresponden a personas reales.
  // ------------------------------------------------------------------
  await limpiar('limpieza_inicial')
  await crearFixture()

  grupos = {
    a: await crearGrupo('a', FUTBOL, 10, 1),
    b: await crearGrupo('b', NATACION, 10, 2),
    c: await crearGrupo('c', VOLEY, 1, 3),
    e: await crearGrupo('e', FUTBOL, 10, 5),
  }

  // 1. Confirmar frente a cancelar administrativamente, en ambos órdenes.
  for (const dominio of ['DEPORTE', 'COMEDOR', 'TRANSPORTE']) {
    await probarConfirmarVsCancelarAdministrativa(dominio)
  }

  // 2. Confirmar frente al cierre de matrícula.
  await probarConfirmarVsCierreDeMatricula()

  // 3. Doble confirmación simultánea (S6), con dos directoras distintas y con la misma.
  const matriculaS6 = await matriculaVigente(ID.s6, 'matricula_s6')
  await probarDobleConfirmacion('MATRICULA', `public.confirmar_matricula('${matriculaS6}')`,
    matriculaS6, ID.dir1, ID.dir2, true)
  const dep6 = await alta(ID.s6, 'DEPORTE', grupos.a)
  await probarDobleConfirmacion('DEPORTE', DOM.DEPORTE.confirmar(dep6), dep6, ID.dir2, ID.dir1)
  const com6 = await alta(ID.s6, 'COMEDOR')
  await probarDobleConfirmacion('COMEDOR', DOM.COMEDOR.confirmar(com6), com6, ID.dir1, ID.dir1)
  const tra6 = await alta(ID.s6, 'TRANSPORTE')
  await probarDobleConfirmacion('TRANSPORTE', DOM.TRANSPORTE.confirmar(tra6), tra6, ID.dir1, ID.dir2)

  // 4. Doble cancelación administrativa simultánea, sobre las mismas filas confirmadas.
  await probarDobleCancelacion('DEPORTE', dep6, ID.dir1, ID.dir2)
  await probarDobleCancelacion('COMEDOR', com6, ID.dir2, ID.dir1)
  await probarDobleCancelacion('TRANSPORTE', tra6, ID.dir1, ID.dir2)

  // 5. Cancelación administrativa frente a un alta nueva o a otra baja.
  await probarBajaFrenteAAlta()
  await probarBajaFrenteACambioDeRecorrido()
  for (const dominio of ['COMEDOR', 'DEPORTE']) {
    await probarBajaAdministrativaFrenteABajaPropia(dominio)
  }

  // 6. Confirmar frente a la cancelación propia del alumno.
  for (const dominio of ['COMEDOR', 'DEPORTE', 'TRANSPORTE']) {
    await probarConfirmarFrenteABajaPropia(dominio)
  }

  // ------------------------------------------------------------------
  // Limpieza final y comprobación de que no quedan restos ni el trigger
  // del registro desactivado.
  // ------------------------------------------------------------------
  await limpiar('limpieza_final')
  const restos = await consultar(
    sesionA,
    `(SELECT (SELECT pg_catalog.count(*) FROM public.perfiles WHERE id IN (${lista(PERFILES)}))
          + (SELECT pg_catalog.count(*) FROM public.matriculas WHERE alumno_id IN (${lista(ALUMNOS)}))
          + (SELECT pg_catalog.count(*) FROM public.inscripciones_deportivas WHERE alumno_id IN (${lista(ALUMNOS)}))
          + (SELECT pg_catalog.count(*) FROM public.inscripciones_servicios WHERE alumno_id IN (${lista(ALUMNOS)}))
          + (SELECT pg_catalog.count(*) FROM public.confirmaciones_inscripcion
              WHERE confirmada_por IN (${lista(PERFILES)}))
          + (SELECT pg_catalog.count(*) FROM public.grupos_deportivos WHERE profesor_id = '${ID.docente}')
          + (SELECT pg_catalog.count(*) FROM public.cursos WHERE id IN ('${ID.curso1}', '${ID.curso2}')))`,
    'restos'
  )
  afirmar(restos === '0', `La limpieza dejó ${restos} fila(s) de prueba`)
  const trigger = await consultar(
    sesionA,
    `(SELECT tgenabled FROM pg_catalog.pg_trigger
      WHERE tgrelid = 'public.confirmaciones_inscripcion'::regclass AND tgname = '${TRIGGER_REGISTRO}')`,
    'trigger_registro'
  )
  afirmar(trigger === 'O', `El trigger del registro quedó en estado ${trigger}, se esperaba O (habilitado)`)
  console.log(`OK CONCURRENCIA: ${numero} carreras de administración de inscripciones demostradas, sin 40P01, sin estado parcial, y la base queda limpia (trigger append-only habilitado)`)
} finally {
  await Promise.allSettled([
    sesionA.ejecutar('ROLLBACK;', 'rollback'),
    sesionB.ejecutar('ROLLBACK;', 'rollback'),
  ])
  await Promise.allSettled([sesionA.cerrar(), sesionB.cerrar()])
}
